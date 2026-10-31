# Implementation Plan: Autopilot mode

**Branch**: `099-autopilot` | **Date**: 2026-10-31 | **Spec**: [spec.md](spec.md)

## Summary

Autopilot is Allow all plus a per-session `autopilot` state, never saved. Each adapter that can do it maps a run to the agent
app's own goal loop:
- Copilot: `mode.set autopilot` and `send({agentMode: 'autopilot'})`;
- Claude Code: `/goal <text>` under `bypassPermissions`;
- Codex: `thread/goal/set` under `never` with `danger-full-access`.

Durbar counts the app's own continuations and stops a run at `limit + 1`. It answers the agent's questions at once with a fixed
sentence, maps each app's end signals to one normalized reason, and clears the goal on every end. The window adds a fourth entry
in the mode menu, a confirmation dialog, a chip state and chat lines. Spec 066's plan card gets *Approve and run on Autopilot…*.

## Technical Context

- **Language**: TypeScript (main, adapters, shared), plain JS in the renderer (`src/renderer/*.js`), Electron.
- **Agent apps**:
  - `@github/copilot-sdk` 1.0.24 (pinned), with the runtime 1.0.101 seen;
  - Claude Code 2.1.309 (the `/goal` probe);
  - Codex 0.163.0 (`thread/goal/*`, stable feature `goals`).
- **Tests**: node unit tests on the adapters' fakes (`scripts/test-*.ts`), the IPC guard tests, a simulator driver with
  screenshots at 1440x900 and 1280x800. 0 AI credits.
- **Real checks**: separate tasks within D7's budget (T090-T094; Copilot runs need an OK each, D11).

## Constitution Check

| Principle | How it holds |
|---|---|
| I Spec Kit | This spec, plan and tasks come first, then code in phases `099-p1..p4`. |
| II Adapters | `capabilities.autopilot`, `setAutopilot()`, and the `autopilot` event are normalized. Vendor calls stay in `copilot.ts`, `claude.ts` and `codex.ts`; nothing about them reaches the renderer. |
| III Safe | Autopilot is only reached through `allow` and the confirmation every time. It is never saved or a default, and it cannot be set from MCP, remote control or schedules. It is blocked wherever Allow all is. Questions get a fixed sentence. Read-only is untouched. No amendment is needed (spec *Constitution*). |
| IV No credits | Fakes and the simulator. The real checks are separate tasks. |
| V Calm UI | One chip word with a glyph, short chat lines, and the 15-agent fit checked by the driver. |
| VI Parity | No paths, no shell. The apps' own APIs. macOS and Windows real runs are a `[KNOWN GAP]`. |
| VII Quality | Unit tests per adapter, IPC tests, a driver, screenshots. |
| VIII Honest | `verified: false` until a real run; the dialog and the tooltip say so. |

## Design

### Types (`src/adapters/capabilities.ts`, `types.ts`, `src/shared/api.ts`)

- `AdapterCapabilities.autopilot?: Readonly<{ capUnit: 'aiu' | 'usd' | 'tokens' | null; verified: boolean }>`.
- `AutopilotSettings = { limit: number /* 1..20 */; cap?: number }`.
- `AgentAdapter.setAutopilot?(sessionId, s: AutopilotSettings | null): Promise<void>` turns Autopilot on or off for the
  session's **next** messages. Off also stops a run (FR-050).
- `AgentEvent` adds `{ type: 'autopilot'; phase: 'started' | 'continued' | 'ended'; runId: string; n: number; limit: number; reason?: AutopilotEnd; spend?: { unit; value } }`,
  with `AutopilotEnd = 'done' | 'cap' | 'limit' | 'no-progress' | 'blocked' | 'stopped' | 'error'`. `eventguard` validates it.
- `question` events get `autoAnswered?: true`.
- `AgentInfo.autopilot?: { limit; cap?; run?: { n; startedAt } }` lives in main memory only.

### The shared core (`src/adapters/autopilot.ts`, pure)

- `AutopilotRun`: a small state machine with the counter, the limit, the end-once guard and the no-progress counter. It takes
  injected `stop()` and `clearGoal()` callbacks and is used by all three adapters, so the rules are written once.
- `AUTOPILOT_ANSWER` and the end-reason words.
- `goalText(text)`: replaces control characters other than newline with a space, and refuses more than 4000 characters for
  Claude Code.
- `isClaudeContinuation(msg)`: a user message with `isSynthetic` whose text starts with `Stop hook feedback:`.
- `codexGoalEnd(status)`: maps `complete` to done, `budgetLimited` and `usageLimited` to cap, `blocked` and `paused` to
  blocked, and `active` to nothing.

### Adapters

- **Copilot** (`copilot.ts`):
  - `setAutopilot` sets `live.autopilot` and calls `mode.set autopilot` or `interactive`;
  - `send` adds `agentMode: 'autopilot'`, `onUserInputRequest` auto-answers, and the elicitation is declined;
  - `onSessionEvent` counts `user.message` with `isAutopilotContinuation: true` (never `assistant.turn_start`, T090), maps
    `session.task_complete`, the objective changes, the limit request and `abort` with `autopilot_credit_limit`;
  - Stop is `mode.set interactive` and then `abort()`;
  - the cap uses the existing `rpc.options.update({sessionLimits})`; a value below 30 is raised to 30 (D9);
  - attachments go with the Autopilot send as today (capability `attachments: true`);
  - the broker keeps answering `onPermissionRequest`: T090 showed the runtime still calls it in autopilot, so there is no
    `permissions.setApproveAll`.
- **Claude Code** (`claude.ts`):
  - `send` on Autopilot writes the user message `/goal <goalText>`;
  - `onControl` answers `AskUserQuestion` with `deny` and `AUTOPILOT_ANSWER`;
  - the stream reader counts `isClaudeContinuation`;
  - a `result` ends the run: `success` with no interrupt is done, `error_max_budget_usd` is cap, and an interrupt by Durbar
    keeps the reason Durbar set; a `system` notification with `key: 'stop-hook-block-cap'` earlier in the run makes the
    `success` result **blocked** (T093);
  - after every end it sends `/goal clear` (free) and ignores its `result` in the chat;
  - Stop is an interrupt and then `/goal clear`;
  - the cap is the existing `--max-budget-usd` with a relaunch.
- **Codex** (`codex.ts`):
  - `send` on Autopilot is `thread/goal/set` in place of `turn/start`, with `tokenBudget` = cap or `null`;
  - `turn/started` after the first in a run counts as a continuation;
  - `thread/goal/updated` maps the end with `codexGoalEnd`, and `thread/goal/cleared` is ignored when Durbar sent the clear;
  - Stop is `goal/clear` and then `turn/interrupt`;
  - `requestUserInput` is auto-answered.

### Main (`src/main/agentops.ts`, `src/main/ipc/agents.ts`)

- `agents:setAutopilot(id, settings | null)`, `fromApp` only. It validates the limit (an integer in 1-20) and the cap (the unit
  from the capability; a Copilot cap below 30 is raised to 30, D9), checks the capability and the organization (`orgRefusal(a, 'allow')` plus the
  Claude hooks advice), then calls `setModeOp(a, 'allow')` when the mode is not already Allow all, then
  `adapter.setAutopilot`.
- It is not added to `SIM_OPEN_CHANNELS` (the simulator fakes it in `sim.ts`), not to the MCP tools, and not to remote control.
- `setModeOp` to `read-only` or `ask` calls `setAutopilot(null)` first (FR-051).
- The folder store never gets `autopilot`: `setSessionMode` keeps `allow`.
- On a restart or a resume, `AgentInfo.autopilot` is undefined, and the chat line of FR-005 is shown.
- The activity log gets `autopilot-on`, `autopilot-end <reason>` and `autopilot-off`, with no prompt text.
- No progress: main takes the folder fingerprint at each `continued` event with the spec 063 runner (read-only), and calls
  `setAutopilot(null)` with reason `no-progress` after two unchanged ones in a row.
- The scheduler (spec 044, 072) sends to a session on Autopilot as a normal message: `AgentMessage.autopilot = false` overrides.

### Renderer

- Mode menu: a fourth item **Autopilot…** where `capabilities.autopilot` is set; greyed out with the organization reason;
  absent in the add-folder dialogs.
- `askDialog` gains a number field and an optional checkbox with a number (or a small `autopilotDialog` built on it), with the
  FR-055 text.
- The chip, the desk line, the List column, the chat lines, the question card variant, and the end card with *Run again on
  Autopilot…*.
- The composer placeholder, the attach button hidden with a tooltip where `autopilot.attachments` is false (Claude Code,
  Codex; D10), and `/goal` refused while on Autopilot.
- The plan card button (FR-060).
- The setting `autopilotLimit` (default 5) in `src/shared/credits.ts`'s settings parser, remembered from the last dialog.

### Simulator (`src/renderer/sim.ts`)

All kinds report `autopilot`. A run takes 2 continuations and then ends done. The `?sim=autopilot-<reason>` scripts drive the
other reasons.

## Phases (one PR each)

1. **p1, core and types**: `autopilot.ts`, the types, the capability, `eventguard`, and the unit tests. No wiring.
2. **p2, adapters**: Claude Code and Codex first (`real:`-backed), then Copilot on the fake SDK, shaped by T090 (`real:`).
3. **p3, main and window**: IPC, the dialog, the chip, the chat, the composer, the simulator, the driver and screenshots, and
   the README.
4. **p4, plan first**: the spec 066 delta built: the button, three adapters, tests, screenshots.

T090 and T093 ran on the SDK, the CLI and the app-server before p1 (owner OKs, D11 and 2026-10-31 11:11 UTC). The real checks
through the built adapters (T091, T092, T094) come after p2 and before `verified: true`.

## Risks

- Copilot's continuation marker (`isAutopilotContinuation`) was seen set in T093 (3 continuations) on SDK 1.0.24; a later SDK
  may change it. The count sits behind one small function, and the fake SDK tests set the field.
- Claude Code's own cap (`stop-hook-block-cap`, 9 consecutive blocks) ends a goal with a `result` that looks like success; the
  adapter must read the notification, or the run would be reported as done (T093).
- Claude's goal judge is a model: "done" is its judgement. The end card says "<App> judged the task done", not "done" as a
  fact.
- No progress is a heuristic, and may stop a run that reads a lot before writing. Two unchanged continuations is a low bar,
  and the setting stays internal until real use.
- A soft cap on Codex can overshoot by one turn. The dialog says so.

## Complexity Tracking

None: no new dependency, no new process, no stored data.

# Feature Specification: Autopilot mode (the agent keeps going until the task is done)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Autopilot mode: a fourth safety mode above Allow all, per session and confirmed each time, only for agent apps that support it; the agent's questions are shown but not waited on, the app keeps going after each turn until the task is done, up to a continuation limit (default 5) and an optional spend cap; Stop ends it; plan approval may offer Approve and run on Autopilot (spec 066 delta)
status: draft
note: spec, plan, tasks; owner answers; probes T090, T093; D13 applied; schedules out; phase 1 (core, types, event guard) built, no adapter or UI
-->

**Feature Branch**: `099-autopilot` (spec). Code branches `099-pN-slug`, one per phase. It touches 003 (the permission modes), 002, 012
and 087 (the adapters, and the Allow all mapping and sandbox), 011 (the caps), 066 (plan first: a delta in this PR), 076 (the
organization policy), 018 (the mode switch) and 010 (the simulator).

**Created**: 2026-10-31

**Status**: Draft. The owner decided the shape (D1-D7), answered Q1-Q4 (D8-D11 below) Q-D (D12) and, in one ruling, Q-A, Q-B and Q-C (D13; Q-A still pending Paco and Ruben). Real probes ran on Claude Code, Codex
and, for Copilot, one autopilot turn capped at 30 AI credits (T090), then longer runs on all three apps with a question,
several continuations and Stop at the limit (T093, *Evidence*). Phase 1 (the core, the types and the event guard) is built; no adapter, IPC or window yet.

**Input**: Owner (Vikram, Telegram DM, 2026-10-31 10:43 UTC): "I go with your suggestions except spend cap as mandatory, have it
optional", answering the coordinator's proposal for an Autopilot mode.

## Why a new spec and not a delta

Autopilot adds a fourth mode, a new per-session state that is never saved, a new adapter capability and events, a new
confirmation dialog, continuation counting in Durbar, and the agent apps' goal APIs (Claude Code `/goal`, Codex
`thread/goal/*`, Copilot `autopilot` mode), across three adapters. A delta to spec 003 or 087 would bury that. Spec 066 gets a
delta in this PR for its one new button (FR-060).

Existing capabilities checked (AGENTS.md FR-031):
- **Self-paced loops (spec 072)** send a prompt again and again on Durbar's timer, within Durbar's limits. Autopilot sends one
  message and lets the agent app continue inside its own goal loop. The two do not share a mechanism. A loop's pass runs in
  its schedule's mode (FR-083; spec 044 FR-180).
- **Reused**: `setModeOp` and the Allow all path (FR-002), the cap paths of spec 011 and 012 FR-150 (FR-022), the question
  card (FR-030), the plan card (FR-060), the organization checks of spec 076 (FR-070), and the git status runner of spec 063
  (FR-023).

Number check (2026-10-31, redone after the review of PR 923):
- `specs/` on `origin/main` ends at 098;
- the remote branches that start with `099` are this spec's own: `099-autopilot` (PR #923) and `099-p1-core` (this phase). No other branch holds `specs/099-autopilot/`, so there is no collision;
- 099 is not in `RETIRED` (`scripts/specs-index.js:48`).

## Context: what exists today

- **The modes**: `PermissionMode = 'read-only' | 'ask' | 'allow'` (`src/adapters/capabilities.ts:8`), `PermMode` (`src/shared/api.ts:23`)
  and `OrgMode` (`src/shared/orgpolicy.ts:12`).
  - The mode is changed by `agents:setMode`, through `setModeOp` (`src/main/agentops.ts:47`), which checks the organization
    first (spec 076 FR-203). It then saves the folder's mode and the session's own mode (`store.setPermMode`,
    `store.setSessionMode`).
  - The Allow all confirmation is `changeModeInner` (`src/renderer/app.js:6106`) for a running session, and `confirmAllow`
    (`app.js:7855`) when adding a folder.
  - A restored Allow all is shown as *restored* (spec 003, 2026-10-21).
- **The Allow all mapping per app**:
  - Copilot: Durbar's `PermissionBroker` approves in `onPermissionRequest`, and the OS sandbox is off (spec 087).
  - Claude Code: `--permission-mode bypassPermissions --allow-dangerously-skip-permissions` (`claudeOptionsFor`,
    `claudeArgs`, `src/adapters/claude.ts:291`). `AskUserQuestion` still goes to the question card in every mode
    (`claudeModes.ts:187`).
  - Codex: `{approvalPolicy: 'never', sandbox: 'danger-full-access'}` (`codexModeSettings`, `codexModes.ts:40`), taking effect
    from the next message (FR-144).
- **Questions**:
  - Copilot `onUserInputRequest`: a question card that waits (`copilot.ts:780`, spec 002 FR-058);
  - Claude `AskUserQuestion` through `can_use_tool`: a card that waits (spec 012 FR-129);
  - Codex `item/tool/requestUserInput` (a plan-mode tool);
  - MCP elicitations: `runElicitation` (spec 012 FR-151).
- **Caps (spec 011)**:
  - Copilot: `sessionLimits.maxAiCredits`, and `rpc.options.update({sessionLimits})` live (`copilot.ts:835`, `1538`). Durbar
    holds a message that is over the cap (FR-071), and the `session_limits_exhausted` flow asks the user.
  - Claude: `--max-budget-usd`, with `capUnit: 'usd'` (spec 012 FR-150).
  - Codex: `caps: false`, so there is no cap today.
- **Plan first (spec 066)**: Copilot approve sends `selectedAction: 'interactive'` and "never autopilot" (FR-003 and its
  Constitution line); Claude switches back to the launch mode; Codex runs a `default` turn with "Go ahead with the plan above."
- **The organization policy (spec 076)**: Copilot `bypassPermissionsDisabled` from `session.managed_settings_resolved`
  (`copilotOrgPolicy.ts:89`); Claude `permissions.disableBypassPermissionsMode` (`claudeOrgPolicy.ts:71`); Codex
  `requirements.toml` `allowed_approval_policies` and `allowed_sandbox_modes` (`codexOrgPolicy.ts:156`). Each of them can
  block Allow all.
- **Missing**: any mode above Allow all; any use of `mode.set autopilot`, `/goal` or `thread/goal/*`; any count of the turns an
  agent app starts on its own; any question that is shown but not waited on.

## Clarifications

### Owner decisions (Vikram, Telegram DM, 2026-10-31 10:43 UTC)

- **D1** Autopilot is a **fourth safety mode, above Allow all**. It includes Allow all, and it is offered only for agent apps
  whose adapter reports support. It is not a separate toggle.
- **D2** **The agent's questions** are shown as cards but not waited on: the agent decides by itself and keeps going.
- **D3** **The spend cap is optional**. The continuation limit defaults to 5.
- **D4** **Scope**: Autopilot is per session and confirmed each time, like Allow all. A folder cannot default to Autopilot. *(Amended 2026-10-31 19:02 UTC, FR-084: a schedule may hold it, confirmed when chosen. **Out of the first build**, pending the other two owners: FR-084.)*
- **D5** **Claude Code**: the Allow all mapping (`bypassPermissions`) plus `/goal <condition>`.
- **D6** **Plan approval** may offer **Approve and run on Autopilot**. This needs a spec 066 delta (FR-060 here, and spec 066
  `## Changes`).
- **D7** **Real checks**: a few credits per app are OK, to settle what is unverified.

### Decisions this spec makes (proposed; open to the owner in review)

- **S1** **The continuation limit is always on**: it cannot be turned off. It defaults to 5, a person can raise it, with a warning above 20 (D13, FR-021), and the
  value last used is remembered as the new default (a Durbar setting, not per folder). Why: it costs no money to keep, it is
  the only stop when no cap is set, and the probes showed that neither Claude Code nor Codex has a turn limit of its own
  (*Evidence*: Claude kept continuing an unreachable goal).
- **S2** **What a goal is**: the text of the message the user sends while in Autopilot, as written. Durbar adds no condition of
  its own. Run 1 of the Claude probe showed that the condition is also the task, so the user writes one thing.
- **S3** **How long Autopilot lasts** (decided: D8):
  - after **done**, the session stays in Autopilot, and the next message is a new run;
  - after **Stop**, a cap, the limit, no progress, blocked, or an error, the session returns to **Allow all**. The end card
    offers *Run again on Autopilot…*, which asks for confirmation again.
- **S4** **Attachments follow each app's goal input** (decided: D10, replacing "no attachments on Autopilot"): Copilot takes
  attachments on Autopilot (`real:` T090); Claude Code `/goal` and Codex `thread/goal/set` take text only, so their attach button
  is hidden on Autopilot, with a tooltip saying why.
- **S5** **Who can turn it on**: Autopilot is turned on only from Durbar's own window, never by MCP tools, remote control, a
  schedule, a restart or a resume. Stop is the other direction, and may also come from remote or phone controls (FR-009).

### Owner decisions on Q1-Q4 (Vikram, Telegram DM, 2026-10-31 11:05 UTC)

"Ok for all except 3 - if copilot support attachments, let's support as well and show it only for it"

- **D8 (Q1, yes)** After a run ends **done**, the session stays in Autopilot. Any other ending returns it to Allow all (S3).
- **D9 (Q2, yes)** A Copilot spend cap below 30 AI credits (the runtime's minimum, *Evidence*) is raised to 30, and the dialog
  says so (FR-022, FR-055).
- **D10 (Q3, changed)** Attachments on Autopilot are supported for each app whose Autopilot path accepts them, and offered only
  there. Copilot's `send` takes attachments with `agentMode: 'autopilot'` (`read:` SDK 1.0.24 `MessageOptions`; `real:` T090).
  Claude Code `/goal` and Codex `thread/goal/set` take text only: the attach button is hidden on Autopilot for them, with a
  tooltip saying why (FR-001, FR-058).
- **D11 (Q4, yes)** One real Copilot probe, session cap 30 AI credits, the cheapest model (T090). The approval covers that one
  probe only; nothing else spends Copilot credits without a new OK.

### Owner decision on Q-D (Vikram, relayed by his coordinating agent, 2026-10-31)

- **D12 (Q-D, yes)** The Autopilot confirmation is a **native dialog the page cannot answer**, reusing `src/main/nativeconfirm.ts` (FR-003, FR-055).

### Owner ruling (Vikram, relayed by his coordinating agent, 2026-10-31 20:52 UTC)

"Warn people and let them override; the app does not impose limits on a person's own money; only organizations may enforce."

- **D13** This applies as follows:
  - **Q-A**: no required spend cap on a scheduled Autopilot. At setup a clear warning, stating "no total limit" when none is set. The cap stays optional, and organization policy may require a cap or forbid it. **Still pending Paco and Ruben, because it reverses D4: it stays out of the first build** (FR-084).
  - **Q-B**: Stop, and only Stop, may come from remote or phone controls (FR-009).
  - **Q-C**: no hard limit on concurrent Autopilot sessions. A warning past a small number, and an organization policy can set a limit (FR-072).
  - **The native confirmation stays** (D12): it is a confirmation, not a limit, and can always be accepted.
  - **Read-only or Ask first to Autopilot**: warn and let them choose rather than refuse. The dialog says the folder becomes Allow all (FR-002, FR-055).
  - **The run limit** stays always on, as a default of 5 that a person can raise with a warning, and it can never be turned off (FR-021). Listed for the owner: the run limit stays as a default, not a hard limit.
  - **The backstop** (FR-021) is a safety bound against a changed app, not a money limit. It stays, and its time limit can be raised the same way.
- **Relayed from the reviewer as consistent with this ruling, recorded with it**: the warning for an unattended run must show the spend, the cap or "no cap" in the user's unit, and the run's end reason is shown (FR-084, spec 044). Stop from remote or phone is in addition: the window always keeps Stop (FR-009).

## User Scenarios

### Story 1 - Hand a task over and walk away (P1)

The user has a Claude Code session in Allow all. They pick **Autopilot…** in the mode menu. The dialog says what changes and
offers a continuation limit (5) and an optional spend cap. They confirm and send "Add a --verbose flag to the CLI and update the
tests". Claude works. When it asks which flag name to use, a question card appears with "Decided by itself (Autopilot)" and no
buttons. Claude picks one and goes on. After its first answer, the app's goal check finds the tests not yet updated, and Claude
continues on its own. The chat shows "Autopilot: continuing (1 of up to 5)". It finishes, and the chat shows "Autopilot ended:
done, after 1 more turn, $0.04".

**Acceptance**:
1. Nothing waits for the user: there are no permission cards (Allow all), and a question is answered at once with the
   decide-by-yourself text (FR-030).
2. Each continuation started by the agent app is counted and shown. The run stops before continuation 6 when the limit is 5
   (FR-020, FR-021).
3. The end is shown with its reason, the number of continuations, and the spend where the app reports it (FR-040).

### Story 2 - Stop at once (P1)

While on Autopilot, the user presses **Stop**. The running turn is aborted, the app's goal is cleared, so nothing continues, and
the session goes back to **Allow all**. The chip and the chat say so (FR-050).

### Story 3 - Only where it is safe and supported (P1)

- **Autopilot…** appears only for agent apps that report the capability (FR-001).
- It is greyed out with the reason when the organization's policy blocks Allow all or the app's goal feature (FR-070).
- In Read-only and Ask first it is offered with a warning: the dialog says the folder becomes Allow all (FR-002, D13).
- It is never offered as a folder's default or when adding a folder (FR-004). On a schedule it is out of the first build (FR-084).
- After a restart or a resume, the session comes back in **Allow all**, never in Autopilot, and the chat says so (FR-005).

### Story 4 - Approve a plan and let it run (P2)

A plan card (spec 066) has a fourth button, **Approve and run on Autopilot…**, not on Codex yet. It asks for the Autopilot confirmation, then
carries out the plan as an Autopilot run whose goal is to carry out the approved plan (FR-060).

### Story 5 - Optional spend cap (P2)

In the dialog the user ticks *Stop at a spend cap* and enters a value in the app's own unit: AI credits for Copilot, dollars
(Claude's estimate) for Claude Code, tokens for Codex. The dialog says what the value counts, because it differs per app: the
session's total on Copilot and Claude Code, this run on Codex (FR-022). It can only tighten a cap the session already has. When
the cap is reached, the run ends with **cap**. Without a cap, the dialog says plainly what still ends the run (FR-022).

## Requirements

### Mode model

- **FR-001** **The capability.** `AdapterCapabilities.autopilot?: Readonly<{ capUnit: 'aiu' | 'usd' | 'tokens' | null; attachments: boolean; planApproval: boolean; verified: boolean }>`.
  - Missing means the app has no Autopilot, and the mode menu does not offer it.
  - `capUnit` is the unit of the optional spend cap (`null`: no cap is possible).
  - `attachments` is true only when the app's Autopilot send takes attachments (D10): Copilot `true` (`real:` T090), Claude
    Code and Codex `false` (their goal input is text).
  - `planApproval` is whether the plan card may offer Autopilot (FR-060): Copilot and Claude Code `true`, Codex `false` until a run checks it.
  - `verified` is true only after a real run is recorded under `## Changes`. Until then the dialog and the chip tooltip say
    *Not verified on a real session yet.*
- **FR-002** **Autopilot is Allow all plus a per-session `autopilot` state**, not a new value of `PermMode`, `OrgMode` or a
  saved mode.
  - `AgentInfo.autopilot?: { limit: number; cap?: number; run?: { continuation: number; startedAt: number } }` holds the state.
  - The window shows it as the fourth mode, and the mode menu lists Read-only, Ask first, Allow all and **Autopilot…**.
  - **From Read-only or Ask first: warn and let them choose** (owner ruling, D13). The menu offers **Autopilot…** in every mode. The native dialog (FR-055) says that the folder becomes Allow all, and that it stays Allow all after Autopilot ends.
    - After the confirmation, and only then, `agents:setAutopilot` sets the session's mode to `allow` through the existing `setModeOp` path: the organization check and the pending approvals. That also saves Allow all as the folder's mode (`store.setPermMode`, `src/main/agentops.ts:63`), which is why the dialog says so. This one dialog replaces the page's Allow all confirmation for this step. **Approvals waiting when this native path enters Autopilot stay waiting** (the page's "Also approve the N requests" option does not exist here): entering Autopilot never answers them. *(Decision by the coordinator, for owner review.)*
    - Cancel changes nothing. If `setModeOp` fails, Autopilot does not turn on, and the reason is shown. If the mode changed and Autopilot then fails to turn on, the session and the folder stay in Allow all, and the chat says so.
  - **Read-only and Ask first can never be combined with Autopilot.** Choosing either one ends Autopilot first (FR-051), so
    no code path leaves `autopilot` set while the mode is not `allow`.
- **FR-003** *(For a schedule, asked when it is chosen or edited: FR-084, out of the first build.)* **The confirmation is asked every time** Autopilot is turned on: from the menu, from *Run again on Autopilot…*, and
  from the plan card. It is a native dialog the page cannot answer, asked by main (D12, FR-055). There is no "don't ask again".
- **FR-004** **Never a default.**
  - Not offered when adding or creating a folder (the `confirmAllow` path), nor as a folder's mode.
  - A scheduled prompt runs in the mode attached to that schedule (FR-083; spec 044 FR-180). While scheduled Autopilot is held (FR-084), a stored `autopilot` on a schedule is **not sent**: the run log records the closed outcome `mode-refused` with a visible reason (spec 044 FR-183, FR-184), and the same holds for a schedule whose target session is on Autopilot.
  - Not settable by Durbar's MCP tools or by remote control.
  - `agents:setAutopilot` is window-only (`fromApp`).
- **FR-005** **Never saved** *(for a session; a schedule stores its own choice: FR-084)*.
  - The folder store keeps `allow` for a session that was on Autopilot (`setSessionMode` gets `allow`).
  - After a restart, a sign-in refresh (spec 012 FR-158), *End session* followed by a message, or a resume from Previous
    sessions, the session is in Allow all. The chat says: "Autopilot ended when this session closed. It is in Allow all."
    Nothing records Autopilot across a restart, so after a restart the line is shown only when the clear of FR-053 reports that a goal or `autopilot` mode was found.
  - `[KNOWN GAP]` Whether a Codex thread, a Claude `--resume` or a resumed Copilot session brings back an active goal or `autopilot` mode is not checked; until it is, Durbar clears the goal on every resume and relaunch before sending anything.
- **FR-006** **The app changes its mode by itself.** When an agent app reports that it entered its own autopilot or goal state
  without Durbar asking, Durbar turns that state off and says so in the chat. Examples: Copilot `session.mode_changed` to
  `autopilot` from remote control; Codex `thread/goal/updated` with `origin` not from Durbar; a `/goal` the user typed in the
  composer. When the session is in Allow all, the chat offers *Autopilot…*. Durbar never follows the app into Autopilot unasked.
- **FR-007** **Never with remote control** (spec 054 FR-011). The check that Allow all and remote control are never on together lives only in the `agents:setMode` handler (`src/main/ipc/agents.ts:157-158`), so it does not cover Autopilot by itself.
  - `agents:setAutopilot` and the plan answer of FR-060 refuse while remote control is on (`remoteOps.has(id)`): "Stop remote control first: Autopilot and remote control from GitHub are never on together."
  - This stays a hard rule under D13: it is about who can steer a session that runs commands unasked, which protects the user's data, not their money.
  - `setRemote` stays refused while on Autopilot. `remoteops.ts:42` checks `modeOf === 'allow'`, which holds only because a session on Autopilot is in `allow` (FR-002); a test pins this so that a later change to that state cannot open it. IPC tests for both directions: T039.
- **FR-008** **Helpers never inherit Autopilot.** A helper or sub-agent started from a session on Autopilot runs at most in Allow all, under the existing rules, and is never on Autopilot itself. Today the agent app starts helpers, not Durbar (`capabilities.helpers`; their events carry `agentId`).
  - `autopilot` is held only for the main session. Nothing copies it to a helper, or to a new session opened from this one.
  - A helper's turn is not a continuation and does not count toward either bound of FR-021: events with an `agentId` or a `parent_tool_use_id`, or on another Codex thread, are left out.
  - A goal is set only on the main session's thread. Test: T028. `[KNOWN GAP]`: whether a helper in a goal turn inherits anything inside the app is not probed.
- **FR-009** **Stop, and only Stop, may come from remote or phone controls** (owner ruling, D13). It is in addition: the window always keeps Stop.
  - A Stop from such a control does what FR-050 does, with reason **stopped**. Nothing else from them reaches a session on Autopilot: no message, no answer, no mode or cap change, and no way to turn it on (FR-004, S5).
  - This does not relax FR-007. The apps' own remote steering (spec 054) can send messages, so it stays off on Autopilot.
  - `[KNOWN GAP]`: no Stop-only remote or phone control exists today, and an app's remote steering cannot be narrowed to Stop. So the path is new work (T098), and until it is built the window is the only Stop.

### Running a goal, per app

- **FR-010** **Copilot.**
  - **On**: the broker in `allow` mode (unchanged), then `session.rpc.mode.set({mode: 'autopilot'})`. `real:` accepted,
    `mode.get` returns `autopilot`, and `session.mode_changed` is emitted.
  - **Send**: `send({prompt, attachments, agentMode: 'autopilot'})`. `real:` T090: accepted with one `file` attachment; the
    `user.message` carries `agentMode: 'autopilot'` and the attachment, and the model read it.
  - **Off**: `mode.set({mode: 'interactive'})`.
  - Durbar keeps `onPermissionRequest` and its broker, so the folder roots, the attachment read paths, the blocked MCP tools
    (spec 069) and the checkpoint `beforeWrite` (spec 065) still apply. It does **not** call `permissions.setApproveAll`.
    `real:` T090: the runtime still calls `onPermissionRequest` in autopilot, once per tool (`read`, `write`, `write`), and
    each approval ran the tool; nothing was auto-denied. So the `setApproveAll` fallback the research note suggested is
    dropped.
- **FR-011** **Claude Code.**
  - **On**: the Allow all launch (`bypassPermissions`, unchanged).
  - **Send**: each message on Autopilot is sent as the user message `/goal <text>`. The CLI answers "Goal set: …" and starts on
    the condition by itself.
  - `<text>` is the user's message (S2), with each run of control characters other than newline replaced by a space. Hidden characters (bidi marks, tag characters, zero-width space; not ZWNJ or ZWJ) are removed, U+2028/9 become newlines, and text with no visible character is empty. Durbar **refuses with a visible reason**, never sending: empty text (all apps); on Claude Code a text that is only `clear`, `stop`, `off`, `reset`, `none` or `cancel` (trimmed, any case: the CLI clears the goal on these), a text over 4000 trimmed characters (the CLI's own limit, `read:` 2.1.316: it answers in plain text, which could read as done), and a line shaped like a slash command, `/word` with no further `/` in that word (it could run a second command; a safe default: `/usr/bin/env is broken` passes, `/tmp is full` is refused). See *Changes* 2026-10-31 (review of 716acc3b).
  - `real:` 2026-10-31: `/goal` works under `--setting-sources "" --strict-mcp-config`.
  - `[KNOWN GAP]`: whether newlines inside the condition survive (the probes used one line); the 4000-character limit and the reserved words are the CLI's own (`read:` 2.1.316 binary, not run), and
    whether such a line really runs a second command is not checked: it is refused as the safe default.
- **FR-012** **Codex.**
  - **On**: the Allow all thread settings (unchanged; from the next message, FR-144).
  - **Send**: `thread/goal/set {threadId, objective: <text>, tokenBudget: <cap or null>, origin: 'user'}` **instead of**
    `turn/start`. It starts the first turn by itself, and every later turn too. A message typed during a run is not a goal (FR-058).
  - **Never** on an ephemeral thread: Codex refuses goals there, and Durbar's sessions are not ephemeral.
  - `real:` 2026-10-31: `goal/set` is accepted with and without `experimentalApi`; a turn starts with no `turn/start`, a
    second one after a short turn, and the goal status becomes `complete`.
  - `[KNOWN GAP]`: the model and effort of goal-started turns come from the thread, not from a `turn/start`. A model switch
    (spec 030 FR-039) during Autopilot applies from the next run; this is not checked.

### Continuation limit and spend cap

- **FR-020** **A continuation** is a turn that the agent app starts on its own after the user's message, without Durbar sending
  anything. Durbar counts them for each run and emits `autopilot {phase: 'continued', n, limit}`.
  - **Claude Code**: one per synthetic user message (`isSynthetic: true`) whose text starts with `Stop hook feedback:`.
    `real:` 2026-10-31.
  - **Codex**: one per `turn/started` after the first in a run. `real:` 2026-10-31.
  - **Copilot**: one per `user.message` with `isAutopilotContinuation: true`. `real:` T093: 3 continuations in the long run,
    each such a `user.message` with `source: 'autopilot'`, empty `content` and `agentMode: 'autopilot'`, with the SDK's
    default options (no `continueOnAutoMode`). `assistant.turn_start` is **not** a signal: T090 had 3 model turns inside one
    user message and no continuation. `session.idle` comes only once, after the last continuation (between them there is only
    `assistant.idle`), so the adapter's turn, which closes on `session.idle`, stays open for the whole run.
  - `[KNOWN GAP]` The continuation count depends on one marker per app; if an app version stops sending it, only the backstop bound (FR-021) ends the run.
- **FR-021** **The limit** is always on (S1) and can never be turned off. It is a default, not a hard limit (D13): default 5, chosen in the dialog, and a person may raise it. Above 20 the form warns at the choice, and the native dialog repeats it: "Above 20 extra turns, this run can spend much more before it stops." The only bound is technical, so that numbers stay sane: an integer from 1 to 1000, which is also what `eventguard` accepts (FR-081). When continuation `limit + 1` starts,
  Durbar stops it at once, in the same way as Stop (FR-050). The run ends with reason **limit**.
  - Claude Code: `interrupt` plus `/goal clear`, `real:` 2026-10-31.
  - Codex: `thread/goal/clear` plus `turn/interrupt`, `real:` 2026-10-31.
  - Copilot: `mode.set interactive` plus `abort()`, `real:` T093 (limit 1, stopped when continuation 2 started).

  The agent app's own limit is never relied on: the SDK has no option for the CLI's `--max-autopilot-continues`, and Codex has
  none. Claude Code has a fixed one that Durbar cannot set: it overrides the goal after 9 consecutive Stop hook blocks
  (`real:` T093, FR-040). With a limit above 8, Claude Code may end the run first; that run ends with **blocked**.

  **The backstop.** Every run has a second bound that does not read the continuation marker. **It is a safety bound against a changed app, not a money limit.** Reaching it stops the run in the same way as Stop and ends it with **error**, worded "Durbar could not confirm this run's turns, so it stopped it." The values are **proposed** (`test:` only, tuned after real use):
  - **Elapsed time, all apps: 2 hours per run by default**, from the run's start, raisable the same way as the limit (D13): a field in the form, a warning at the choice above the default, repeated in the native dialog. It cannot be turned off, and the technical bound is 1 to 168 hours. It is wall-clock time, so time asleep counts: a run may end early, never late.
  - The turn counts below are not settings, because they only fire if an app changed. They grow with the limit the person chose.
  - **Copilot**: more than `100 × (limit + 1)` `assistant.turn_start` events in the main session (not a signal of a continuation, FR-020, so it counts model turns; T090 saw 3 for one message).
  - **Claude Code**: more than `100 × (limit + 1)` main-stream assistant message ids (`claudeMap.ts:144` tracks them). `num_turns` cannot stop a live run, because the whole goal is one `result` (*Evidence*). When that `result` arrives, a `num_turns` over the bound still reports **error** rather than **done**.
  - **Codex**: more than `limit + 1` `turn/completed` notifications of Durbar's thread, leaving out turns the adapter started itself (FR-058). The limit stops a run at `limit + 1` turns, so this fires only if `turn/started` was missed.
- **FR-022** **The optional spend cap** (D3) is off unless the user ticks it. It uses each app's own cap, in its own unit.
  - **What the value counts** differs per app, and the dialog says which:
    - Copilot: the **session's total**. `maxAiCredits` is one cap for the session (`copilot.ts:1538`), counted against all it has spent, including before a resume (the first checkpoint brings that).
    - Claude Code: the **session's total since Durbar opened it**. `--max-budget-usd` is what is left of the session cap (`claude.ts:1164`, `capUsd - spentUsd`), and `spentUsd` starts at 0 when Durbar opens the session.
    - Codex: **this run**. `tokenBudget` belongs to one goal, and Codex has no other cap (`caps: false`).
  - **The lower wins; it never loosens.** On Copilot and Claude Code the cap in force for a run is the lower of the session's cap (spec 011, spec 012 FR-150; `a.maxAiCredits`) and the Autopilot cap. A higher value does not raise it, and the dialog says the session's limit is lower. A value at or below what the session has already spent is refused, with both numbers.
  - **Never saved.** The Autopilot cap stays in `AgentInfo.autopilot.cap`, never in `a.maxAiCredits`, and does not go through `setCapOp`, which saves a Copilot cap for the folder (`store.setMaxAiCredits`).
  - These are the person's own caps, so they stay exact under D13: Durbar imposes no cap of its own, and refusing a value at or below what was spent only stops a run that could do nothing. The person can raise the session's cap.
  - **Restored after the run.** When a run ends, for any reason including done, the app's cap goes back to `a.maxAiCredits`, or to none: at once on Copilot, at the next relaunch on Claude Code. The next run applies the Autopilot cap again. If restoring fails, the tighter cap stays in force and the chat says so. Codex has nothing to restore: the budget goes with the goal (FR-041).
  - **`agents:setCap`, the limit card and `durbar_set_cap` during a run.** They change only the session's own cap, `a.maxAiCredits`.
    - A lower value applies to the run: at once on Copilot, from the next run on Claude Code (its flag is set at launch, and a run does not relaunch).
    - A higher value, or removing the cap, never lifts the Autopilot cap. It takes effect when the run ends.
    - On Codex they are refused, as today (no `setCap`).
    - `durbar_set_cap` (`src/main/mcp/tools.ts:77`) is neither listed nor dispatched today (`CHANGE_TOOLS_ENABLED = false`, spec 041 T038). When it is turned on it follows this rule and its own confirmation, and it can never set the Autopilot cap (FR-004).
  - **Copilot**: `rpc.options.update({sessionLimits: {maxAiCredits}})` when the cap in force differs from the current one.
    - The runtime refuses caps under 30 AI credits at session start (*Evidence*). A cap entered below 30 is raised to 30,
      and the dialog says "Copilot's smallest cap is 30 AI credits, so Autopilot uses 30." (D9). Spec 011 already floors
      every other Copilot cap at 30 (`MIN_CAP`, `src/shared/credits.ts`), so existing caps do not hit the runtime's refusal.
    - When the cap is reached, the `session_limits_exhausted` request is answered `cancel` and the run ends with **cap**.
      The cap card stays only if the restored cap is itself reached, so the user can raise it for later messages.
  - **Claude Code**: `--max-budget-usd` (spec 012 FR-150) for the cap in force; it applies on the relaunch the cap change already
    causes, and that relaunch clears first (FR-053). A `result` with `subtype: error_max_budget_usd` ends the run with **cap**. `[KNOWN GAP]`: a cap reached in the
    middle of a goal was not probed.
  - **Codex**: `tokenBudget` on `thread/goal/set`, in tokens (Codex counts non-cached input plus output, *Evidence*). Goal
    status `budgetLimited` ends the run with **cap**. The cap is soft: the turn that is running finishes (the probe:
    budget 8000, 10,056 used). The dialog says "Codex finishes the turn it is in, so it can go a little over." Status
    `usageLimited` (the user's plan) ends the run with **cap** too, worded "your Codex plan's usage limit".
  - Without a cap, the dialog says: "No spend cap: Autopilot stops when the task is done, at the turn limit, after <hours> hours, when it makes no
    progress, or when you press Stop." When the session has its own cap, it adds: "This session's limit of <value> still applies."
- **FR-023** **No progress.** Durbar ends a run with **no progress** when two continuations in a row leave the session folders'
  fingerprint unchanged:
  - in a git folder, the porcelain status and a hash of the diff, from the existing read-only git status runner (spec 063, `src/main/gitstatus.ts`);
  - elsewhere, no write or edit tool event (`edits.ts`) and no shell command.

  The fingerprint is taken at each continuation start. This is a heuristic: `sim:` and `test:` only, tuned after real use
  (`[KNOWN GAP]`). It would have stopped Claude probe run 3 after continuation 2.

### Ending and Stop

- **FR-030** **Questions are shown, not waited on** (D2). While a run is on, every question the agent asks is answered at once
  with `AUTOPILOT_ANSWER` = "The user is away and will not answer. Decide by yourself, say what you chose, and keep going."
  The card is shown with *Decided by itself (Autopilot)*, no buttons, and the question text. Per app:
  - **Copilot** `onUserInputRequest`: `{answer: AUTOPILOT_ANSWER, wasFreeform: true}`. `askUserDisabled` is not set, so the
    question still reaches the card. `real:` T093: the runtime calls `onUserInputRequest` in autopilot (events
    `user_input.requested` with `question`, `choices` and `allowFreeform`, then `user_input.completed` with the answer); the
    model chose the recommended option, said so, and went on. (In T090 the model decided an ambiguous point without asking.)
  - **Claude Code** `AskUserQuestion` through `can_use_tool`: `deny` with `AUTOPILOT_ANSWER`. `real:` 2026-10-31: the model
    chose the recommended option and finished. `real:` T093: the same inside a `/goal` run, but when the condition itself says
    the user must choose, the goal judge never accepts the model's choice and keeps continuing (FR-040, the CLI's cap).
  - **Codex** `item/tool/requestUserInput`: every question answered with `AUTOPILOT_ANSWER`. In default mode Codex has no such
    tool and asks in plain text, which ends the turn; the goal then continues (`real:` 2026-10-31, without a goal). `real:`
    T093, with a goal: no server request came; each continuation asked again and did no work, and after 3 (another run: 5)
    continuations the model set the goal to `blocked` itself, which ends the run with **blocked**. Durbar does not answer a
    plain-text question: a `turn/start` with `AUTOPILOT_ANSWER` after `blocked` ran one turn (the model chose and did the
    stage) but the goal stayed `blocked` and started no further turn.
  - **MCP elicitations** (all apps): `decline`, and the card says "Declined (Autopilot)". A form or a sign-in cannot be
    decided for the user.
- **FR-040** **End reasons.** Each run ends with exactly one reason, emitted as `autopilot {phase: 'ended', reason, n, spend?}`:
  - **done**:
    - Copilot `session.task_complete` (the model calls the `task_complete` tool), then `session.idle`. `real:` T090, T093:
      `{success: true, summary}` with **no `outcome` field**, so a missing `outcome` or any value other than `blocked` counts
      as done (`outcome: 'blocked'` is `read:` only);
    - Claude a `result` with `subtype: 'success'`, no interrupt from Durbar, and no `stop-hook-block-cap` notification before
      it in the run (`real:`);
    - Codex goal status `complete` (`real:`);
  - **cap** (FR-022);
  - **limit** (FR-021);
  - **no progress** (FR-023);
  - **blocked**:
    - Copilot `session.task_complete` with `outcome: 'blocked'`, or an objective `paused` with a `pauseReason` (`read:`
      SDK 1.0.24);
    - Codex goal status `blocked` (`real:` T093: the model set it itself while waiting for an answer) or `paused` (`read:`
      schema, not seen);
    - Claude a `system` message with `subtype: 'notification'` and `key: 'stop-hook-block-cap'` ("A hook blocked the turn
      from ending 9 consecutive times — overriding and ending turn"), after which the CLI ends the goal with a `result`
      `success`, `terminal_reason: 'completed'` that looks like done. `real:` T093 (13 continuations; the 9 were the ones with
      no tool call; whether a tool call resets the count is not checked). Durbar's limit or no progress usually ends such a
      run first;
  - **stopped** (FR-050);
  - **error** (the turn failed, the process exited, or the backstop was reached, FR-021).

  The chat shows "Autopilot ended: <reason words>, after N more turns[, <spend>]". The desk line and the inbox show the reason
  as a word, and an icon, not colour alone. Every reason except done follows S3.
- **FR-041** After every end, Durbar clears the app's goal, so a later normal message never runs under an old goal (a clear that fails: FR-054):
  - Claude `/goal clear` (free: a `result` with `num_turns: 0`, `real:`);
  - Codex `thread/goal/clear` (`real:`);
  - Copilot `mode.set interactive` when leaving Autopilot (S3). After done it stays in `autopilot` (D8; `real:` T090:
    `mode.get` is still `autopilot` after `session.idle`).
- **FR-050** **Stop** on a session on Autopilot aborts the turn, clears the goal (FR-041), and returns the session to **Allow
  all**, with reason **stopped** (a stop that fails: FR-054). The window always has Stop; a remote or phone Stop is in addition (FR-009). Per app:
  - **Claude Code**: `control_request {subtype: 'interrupt'}`, then `/goal clear`. `real:` 2026-10-31: the interrupt gives a
    `result` with `terminal_reason: aborted_streaming`, **and the goal stays set until `/goal clear`**.
  - **Codex**: `thread/goal/clear {origin: 'user'}` first (so no new turn starts), then `turn/interrupt`. `real:` 2026-10-31:
    `cleared: true`, the turn is `interrupted`, and no further turn starts.
  - **Copilot**: `mode.set interactive` first, then `abort()`. `real:` T093: `session.mode_changed` to `interactive`, the
    events `abort {reason: 'user_initiated'}` and `session.idle {aborted: true, mode: 'interactive'}`, and no event in the
    next 33 s.

  `real:` T093 for all three: after the stop sequence no event, turn or continuation came in the next 33 s.
- **FR-051** **Switching to another mode** during a run ends the run in the same way as Stop (reason **stopped**) before the new
  mode applies. Switching to Allow all is only a stop; switching to Ask first or Read-only then follows the existing switch
  (spec 018, 087).
- **FR-052** End session, quitting Durbar and a sign-in refresh end the run without a card in the chat. The next session is in
  Allow all (FR-005), and its goal is cleared first (FR-053).
- **FR-053** **Clear first on every resume and relaunch.** On every resume or relaunch of a session whose adapter reports `autopilot`, the adapter clears the app's goal **before anything is sent** (where the app has no goal feature, an older Claude Code without `/goal` or an older Codex without `thread/goal/*`, or the command is unknown, there is nothing to clear and the resume proceeds; fail-closed (FR-054) applies only where the feature exists and the clear fails; test on a fake without the feature; decision by the coordinator, for owner review), a held message, a queued one or a scheduled one included. This covers a restart, a sign-in refresh, *End session* followed by a message, Previous sessions, Claude's relaunch with `--resume` (`needsRelaunch`, a cap change included), and Codex's mode-switch relaunch, a fresh child that resumes the same thread (`codex.ts:65`, `send`).
  - Codex `thread/goal/clear`: its goal lives on the thread. Claude Code `/goal clear`. Copilot `mode.set interactive`.
  - It runs on every resume, not only for a session known to have been on Autopilot, because nothing records that across a restart (FR-005).
  - It shows nothing in the chat, except the FR-005 line. A clear with no goal set is not probed (`[KNOWN GAP]`, T091, T092, T094). A failed clear follows FR-054.
- **FR-054** **A stop or clear that fails, fails closed.** This covers an RPC error, a dead child, or `/goal clear` not acknowledged. Durbar waits for the app's answer (Claude "Goal cleared", Codex `cleared: true`, Copilot `session.mode_changed` to `interactive`) for at most 10 seconds (**proposed**).
  - The run guard stays armed: any later continuation is interrupted at once and is not counted as a new run. Nothing is sent to the session meanwhile.
  - If the clear cannot be confirmed, Durbar ends the session and kills its child where it has its own (Claude Code, Codex). The session's history stays.
  - The chat says so: "Durbar could not confirm that Autopilot stopped, so it ended this session's process." The run keeps the reason it was ending with, or **error** if it had none.
  - The next message resumes in Allow all and clears first (FR-053). If that clear fails too, the message is not sent, and the chat says why. Fake adapter tests: T025.

### Window

- **FR-055** **The confirmation** has two steps, and only the second is consent (D12).
  - **The settings form** in the page (`askDialog`) collects the values, and it grants nothing:
    - "Keep going for at most [5] more turns per message", with the warning above 20 (FR-021);
    - "Stop after [2] hours", with the warning above 2 (FR-021);
    - "[ ] Stop at a spend cap of [ ] <unit>" (FR-022: unit words "AI credits", "US dollars (Claude's estimate)", "tokens";
      Copilot minimum 30: a lower value is raised to 30 with the D9 sentence), followed by what the value counts (FR-022): "for this session in total (<spent> so far)" on Copilot and Claude Code, "for this run" on Codex;
    - the no-cap sentence while it is unticked;
    - buttons *Cancel* and *Continue…*.
  - **The native dialog**: main validates the values (FR-002, FR-007, FR-022, FR-070), then asks through `nativeConfirm` (`src/main/nativeconfirm.ts`), as remote control does. The page cannot answer it. Cancel is the default and the Esc answer. It is written in main, from main's own state and the validated values, never from page text:
    - message: "Autopilot for <name>?";
    - detail: "<App> will keep working on each message until it judges the task done, without stopping for you. Edits, shell
      commands, web requests and tools run without asking, in <folder>. When it has a question, it decides by itself. Nothing is
      undone automatically. Stop ends Autopilot at once.";
    - then, from Read-only or Ask first: "This also changes <folder> from <mode> to Allow all, and it stays Allow all after Autopilot ends. New sessions in <folder> start in Allow all." (FR-002), and the spec 087 FR-022c sandbox sentence when this switch turns a sandbox off;
    - then the limit, the hours and the cap as validated, or the no-cap sentence, with the warnings of FR-021 and FR-072 where they apply, then *Not verified on a real session yet.* while `verified` is false;
    - buttons: *Cancel* and *Start Autopilot*.
  - Cancel changes nothing. Tests inject the confirmation (the `deps.confirm` pattern of `remoteops.ts`), and the driver's pictures stop at the form, because it cannot press a native dialog.
  - `nativeconfirm.ts` is on `origin/main` since #931, and this branch was cut before it: merge `main` before T030.
- **FR-056** **The card and the chip.**
  - The mode chip reads **Autopilot** with its own glyph (not colour alone), and during a run "Autopilot · 2/5". Its tooltip
    names the limit, the cap or "no spend cap", and the verified line.
  - The agent card's desk line starts "On Autopilot:".
  - In the List view the mode column says "Autopilot".
  - A session on Autopilot that is idle after **done** sorts like any idle session; an ended run with any other reason
    sorts as *needs me* until it is seen.
  - 15 agents still fit 1440x900 and 1280x800, and no text is under 10.5px (constitution V).
- **FR-057** **In the chat**:
  - a run-start line "Autopilot: working on your message (up to 5 more turns, no spend cap)";
  - one line per continuation, "Autopilot: continuing (2 of up to 5)";
  - the question cards of FR-030;
  - the end card of FR-040, with *Run again on Autopilot…* (except after done) and *Switch to Ask first…*.
- **FR-058** **The composer** on Autopilot:
  - placeholder "Describe the finished result. <App> keeps going until it is done.";
  - the attach button hidden when the app's `autopilot.attachments` is false (Claude Code, Codex), with the tooltip "On
    Autopilot <App> takes text only: its goal is set from your message." (D10); Copilot keeps it;
  - a message typed while a run is on is sent as the app queues it today, as a plain message and never as a new goal (no `/goal`, no `thread/goal/set`, which would replace the objective), and does not start a new count;
  - **Codex**: such a message is a `turn/start`, so it would look like a continuation when its `turn/started` arrives. The adapter records the turn id from each `turn/start` reply and does not count that turn. While a reply is outstanding (`live.turnStarting`), it holds the count for a `turn/started`; if the reply fails, the turn is counted, which errs toward stopping. `[KNOWN GAP]`: what Codex does with a `turn/start` during a goal turn is not probed (T092). A refusal shows as today ("Codex refused the message");
  - `/goal` typed by the user in Claude Code is refused while on Autopilot ("Autopilot sets the goal from your message.").

### Plan first (spec 066 delta)

- **FR-060** *(D13's warn-and-choose is for the mode menu. The button stays hidden in Read-only and Ask first, as the review's item 8 and spec 066's delta have it; the person can change the mode first. Listed for the owner.)* **The plan card** gets **Approve and run on Autopilot…**. It is shown only when the adapter reports `autopilot` with `planApproval`,
  the organization allows it (FR-070), remote control is off (FR-007), and the session's mode is not Read-only or Ask first. In those two modes it is
  hidden: the card's existing line says the plan runs in that mode. Focus stays on plain **Approve** (spec 066 FR-006).
  - **Main validates the answer.** `agents:resolvePlan` (spec 066 FR-007) takes a new kind, `{kind: 'approve-autopilot', limit, cap?}`. Main checks the capability, the organization policy, mode `allow` and remote control off, validates the settings as `agents:setAutopilot` does, and asks the native confirmation (FR-055). Cancel or a failed check leaves the plan unanswered. The window's word is never enough.
  - **The run and its counter start at the plan answer**, with no Durbar send: `autopilot {phase: 'started'}` is emitted then, and the turn that carries out the plan is not a continuation.
  - Pressing it shows the FR-055 form. On confirm, Durbar turns Autopilot on (FR-002) and answers the plan:
    - **Copilot**: `{approved: true, selectedAction: 'autopilot'}`, with mode `autopilot` set by the runtime (`read:`
      `ExitPlanModeAction`; `[KNOWN GAP]`: not exercised in T090).
    - **Claude Code**: `allow` for `ExitPlanMode`, `set_permission_mode` back to the launch mode (`bypassPermissions`), then
      `/goal Carry out the approved plan above, completely, and check the result.`
    - **Codex**: **not offered yet** (`planApproval: false`). Codex sets `collaborationMode` per `turn/start` (`codex.ts:771`) while goal turns take the thread's settings, and `thread/goal/set` has no such field in the probes, so nothing yet shows how the thread leaves `plan`. When a run shows that it does (T092), the answer is `thread/goal/set` with the objective "Carry out the approved plan above, completely, and check the
      result.", in place of the "Go ahead with the plan above." turn.
      `[KNOWN GAP]` Whether turns started by a goal after a `plan` turn run in `default` collaboration mode is not checked; until it is, the button is not offered for Codex.
  - Plain **Approve** is unchanged and never selects autopilot.

### Organization policy

- **FR-070** Autopilot is blocked wherever Allow all is blocked (spec 076 FR-203), with the same reason:
  - Copilot: `bypassPermissionsDisabled` (the runtime's own deny-wins verdict);
  - Claude: `permissions.disableBypassPermissionsMode`;
  - Codex: `allowed_approval_policies` without `never`, or `allowed_sandbox_modes` without `danger-full-access`.

  Advice only, still selectable, with *may be blocked by your organization*: Claude managed settings with `disableAllHooks`
  or `allowManagedHooksOnly`. `/goal` works through a Stop hook ("Stop hook feedback"), so such a policy may stop it
  (`[KNOWN GAP]`). Durbar reads nothing new beyond spec 076's files. `setAutopilot` repeats the check in main.
  Organizations may enforce what a person only gets warned about (D13): require a spend cap, forbid one, or limit concurrent sessions. `[KNOWN GAP]`: none of the policy files of spec 076 has such a key today, so this needs a spec 076 delta before it can be built.
- **FR-072** **Many sessions on Autopilot at once: a warning, no hard limit** (owner ruling, D13). When this session would be past **3** on Autopilot at once (**proposed**), the native dialog says: "<N> sessions are already on Autopilot. Each one spends on its own." The person can always accept it. An organization policy can set a limit (FR-070). T099.

### Simulator and evidence

- **FR-080** **The simulator**: every simulated kind reports `autopilot` (Copilot `aiu`, Claude `usd`, Codex `tokens`; `planApproval` as FR-001). A
  simulated run takes 2 continuations, then ends done. `?sim=` scripts drive each end reason for the driver and the
  screenshots. 0 AI credits.
- **FR-081** **Events**: `autopilot {phase: 'started' | 'continued' | 'ended', runId, n, limit, reason?, spend?}` through
  `eventguard`, and `question` gets `autoAnswered?: true`. There are no vendor names in the renderer (constitution II).

### README (when built)

- **FR-090** The README Safety model gets a fourth bullet after **Allow all**:
  "**Autopilot** (Copilot, Claude Code and Codex where the app supports it): Allow all, and the agent also keeps going after
  each answer until the app judges the task done, and decides its own questions. Each time it asks you to confirm, with a
  limit on extra turns (5 by default, always on) and an optional spend cap. Stop ends it at once. It is never a folder's default
  and is not kept after a restart. <verified line>."
  - The mode-menu sentence lists four modes.
  - *What Durbar does not do* adds: "On Autopilot, a spend cap is soft: Codex finishes the turn it is in."
  - *Costs and caps* adds the per-app cap units of FR-022.

## Success Criteria

- **SC-001** On the simulator, every end reason is reachable and is shown with words and an icon, at both sizes, 15 agents.
- **SC-002** Tests prove that no path sets `autopilot` with a mode other than `allow`, and that nothing saves it for a session or folder; only a schedule's own confirmed choice is stored (FR-084).
- **SC-003** Tests prove that the continuation count stops a run at `limit + 1` for each adapter's fake, and that with the marker removed the backstop still ends it with **error** (FR-021).
- **SC-004** A real run per app is recorded under `## Changes` before `verified` becomes true, as one tiny task within the D7
  budget.

## Constitution

- **III (safe by default)**:
  - In a session, Autopilot is an explicit, per-session opt-in, confirmed every time, never a default, never saved, and named honestly. It
    only adds to Allow all, which is already the explicit opt-in that III names: Read-only stays the default, and Ask first and Read-only cannot combine with it.
  - **On a schedule (FR-084, spec 044 FR-182) this is for the three owners to confirm**: the opt-in is per schedule and agent, stored, and runs unattended. It is out of the first build, and a stored `autopilot` on a schedule is refused until they do (FR-084, Q-A). Whether III needs an amendment is proposed in the PR, not decided here.
  - Questions are answered by a fixed sentence, never by text from the agent.
  - Nothing new is stored. No tokens are read.
- **II (adapters are plug-ins)**: the capability and the events are normalized, and vendor calls stay in the adapters.
- **IV (no AI credits in tests)**: simulator and fakes only. The real checks are the separate, budgeted tasks of D7.
- **V (calm UI)**: one chip word and short lines, with a glyph next to the colour. The 15-agent fit is checked.
- **VI (parity)**: no OS-specific path. The goal APIs are the apps' own; Windows and macOS are not probed (`[KNOWN GAP]`).
- **VIII (honest limits)**: *Evidence* separates `real:`, `read:` and `[KNOWN GAP]`, and the dialog says *Not verified* until
  SC-004.

## Evidence (2026-10-31 probes, full record in the PR body)

Machine: Linux; Copilot CLI 1.0.101 with SDK 1.0.24; Claude Code 2.1.309; Codex 0.163.0. Each probe was one tiny task in an
empty `git init` folder, with the same SDK, flags and JSON-RPC that Durbar's adapters use.

- `real:` **Claude Code**, 3 runs, `haiku`, Durbar's Allow all argv with `--setting-sources "" --strict-mcp-config`,
  **$0.0114** in total:
  - `/goal` works, and the condition is also the task;
  - `AskUserQuestion` still comes through `can_use_tool` under bypass, and a deny with "decide by yourself" made it choose
    and finish;
  - a continuation is a synthetic `Stop hook feedback:` user message, and the whole goal is one `result`;
  - an unreachable goal kept continuing; the CLI's only cap is 9 consecutive Stop hook blocks (T093 below);
  - interrupt ended the run, but **the goal stayed until `/goal clear`**, which cost nothing.
- `real:` **Codex**, 4 runs, `gpt-6-luna`, Allow all thread settings, about 25k non-cached tokens:
  - an ephemeral thread refuses goals;
  - `thread/goal/set` starts the turns itself and continues after a short turn, reaching `complete`;
  - it works without `experimentalApi`;
  - `tokenBudget` 8000 gave `budgetLimited` at 9,522, and the running turn finished at 10,056;
  - `goal/clear` plus `turn/interrupt` stopped it cleanly;
  - in default mode there is no question tool.
- `real:` **Copilot**, setup only, 0 AI credits:
  - `sessionLimits.maxAiCredits: 1` was refused with "Minimum session limit is 30 AI credits";
  - with no model call, `mode.set autopilot` is applied, `options.update({askUserDisabled, continueOnAutoMode})` is
    accepted, and `autopilotObjective.getState()` returns `null`.
- `real:` **Copilot T090**, one autopilot turn, `claude-haiku-5.5` (tied cheapest), cap 30, Allow-all handler, **0.434 AI
  credits** (1 premium request, 3 model calls):
  - the cap of 30 is accepted;
  - `onPermissionRequest` is called for every tool (`read`, `write`, `write`), and approving runs it: no auto-deny;
  - a `file` attachment is accepted with `agentMode: 'autopilot'` and read by the model;
  - the ambiguous "better file name format" was decided by the model; `ask_user` was not called;
  - no continuation: one `user.message`, three model turns, then the `task_complete` tool, `session.task_complete`,
    `session.idle {mode: 'autopilot'}`; the mode stays `autopilot` after idle.
- `real:` **T093 longer runs** (owner OK, Vikram, Telegram, 2026-10-31 11:11 UTC; probe scripts, not the built adapter). One
  staged task on all three apps (a node project in 4 stages, one stage per turn, ask the user ESM or CommonJS first), then a
  second run stopped at limit 1 (when continuation 2 started). **Total: 1.626 AI credits, $0.0228, 65,827 non-cached tokens.**
  - Copilot (`claude-haiku-5.5`, cap 30), 1.100 + 0.526 AI credits: 3 continuations seen (`isAutopilotContinuation: true`,
    `source: 'autopilot'`); `ask_user` reached `onUserInputRequest` and the model chose ESM; ended by `session.task_complete
    {success: true}` with no `outcome`; Stop (`mode.set interactive`, `abort()`) gave `session.idle {aborted: true}`, then
    nothing;
  - Claude Code (`haiku`, `--max-budget-usd 0.30`), $0.0169 + $0.0059: 13 continuations; `AskUserQuestion` denied with the
    answer and the model chose CommonJS; the judge never accepted the goal and the CLI's `stop-hook-block-cap` ended it after 9
    blocks with a `result` that looks like success; Stop (interrupt, `/goal clear`) gave `aborted_streaming` and "Goal
    cleared", then nothing;
  - Codex (`gpt-6-luna`, `tokenBudget` 60000), 26,658 + 31,168 + 8,001 non-cached tokens: 3 and 5 continuations; the question
    came as plain text every turn until the model set `blocked`; a later `turn/start` with the answer ran one turn but left
    the goal `blocked`; Stop (`goal/clear`, `turn/interrupt`) gave `cleared: true`, `interrupted`, `goal: null`, then nothing.
- `read:` **Copilot SDK 1.0.24 types**: `MessageOptions.agentMode`, `ExitPlanModeAction` `autopilot`, `session.task_complete`
  outcomes, `session.autopilot_objective_changed`, abort reason `autopilot_credit_limit`, and
  `permissions.setApproveAll({source: 'autopilot_confirmation'})`. There is no option matching `--max-autopilot-continues`.
- `[KNOWN GAP]`:
  - Copilot: `outcome: 'blocked'`, the cap reached in the middle of a run, plan approval with `autopilot`, and runs through
    the built adapter (T094, needs a new owner OK);
  - Claude's cap in the middle of a goal, a multi-line condition, resume with a goal, whether the goal is still set after the
    `stop-hook-block-cap` override, and whether a tool call resets that count;
  - Codex model switch and `paused`;
  - macOS and Windows;
  - an organization policy on a real managed machine.

## Open questions (asked of the owners, 2026-10-31)

Each recommendation is the reviewer's (rubenlupi, review of PR #923 at `dfe6428e`). Vikram answered all three in one ruling (D13).

- **Q-A (all three owners; constitution III; money), still open for Paco and Ruben**: Autopilot on a recurring schedule with one stored confirmation (FR-084, spec 044 FR-182) runs unattended and has no total spend bound when no cap is set. Should it be allowed, and must a scheduled Autopilot then have a cap? *Reviewer's recommendation*: not before the owners decide; if allowed, a cap is mandatory for a scheduled Autopilot. *Vikram's answer*: no required cap; a clear warning at setup, stating "no total limit" when none is set; an organization policy may require or forbid a cap. Until the other two confirm: FR-084.
- **Q-B**: Can Stop, and only Stop, come from remote or phone controls? *Reviewer's recommendation*: yes, Stop is the safe direction. *Vikram's answer*: yes (FR-009).
- **Q-C**: Should there be an office-wide limit on sessions on Autopilot at once, since spend grows with their number? *Reviewer's recommendation*: yes, a small default. *Vikram's answer*: no hard limit; a warning past a small number; an organization policy can set one (FR-072).

## Changes

- **2026-10-31**: Owner answers to Q1-Q4 recorded as D8-D11 (quote under *Clarifications*). S4 changed from "no attachments on
  Autopilot" to attachments per app capability (FR-001 `attachments`, FR-058). Copilot caps below 30 are raised to 30 (FR-022,
  FR-055). T090 ran (0.434 AI credits): FR-010 keeps the broker and drops the `setApproveAll` fallback; FR-020 names
  `isAutopilotContinuation` as Copilot's signal; FR-040 maps `session.task_complete`; FR-041 records that the mode stays
  `autopilot` after done.
- **2026-10-31 (T093)**: Longer real runs on all three apps (owner OK 11:11 UTC; 1.626 AI credits, $0.0228, 65,827 non-cached
  tokens). FR-020 Copilot marker and FR-030 Copilot `ask_user` are now `real:`; FR-021 and FR-050 Copilot Stop `real:`; FR-040
  fixed: Claude's `stop-hook-block-cap` notification ends a run with **blocked** (its `result` looks like success), Copilot's
  `task_complete` has no `outcome` field, Codex `blocked` is `real:`; FR-030 Codex records that a plain-text question loops
  until the model sets `blocked`. T093 is split: the SDK-level probes are done; T094 keeps the run through the built adapter.
- **2026-10-31 (coordinator choices for the owner to review in the PR; none is an owner decision)**:
  - **Goal text** (FR-011, S2): on Claude Code a message of exactly `clear` would become `/goal clear` and clear the goal, and empty text would send a bare `/goal`. Both are **refused with a visible reason**, never sent. `goalText` returns the text or a refusal reason (`empty`, `reserved`). Over 4000 characters on Claude Code is a warning, not a refusal (replaced by D13, see the entry below).
  - **FR-082 Events are checked in main.** `eventProblems` (`eventguard`) runs only in tests today, so FR-081's bounds would protect nothing at run time. Main MUST validate each `autopilot` event, and `question.autoAnswered`, before using or forwarding it, and drop a bad one with a masked log line; clamping in the renderer is not enough. Task T095 (Phase 3).
  - **FR-083 (first wording, replaced by the entry below) A later message never runs silently under the goal loop.** D8 stands: after a run ends **done**, the session stays in Autopilot. But Copilot's runtime also stays in `autopilot` then (FR-050), so a scheduled message (FR-004), which is a normal message, could run under the app's goal loop with no run counting it. A message that is not a run MUST NOT reach the app in its goal mode: the adapter leaves that mode for the message where it can (Copilot `mode.set interactive`) and returns to it after, without changing what the session shows; where it cannot, the message is **refused with a visible reason**, and the gap is written `[KNOWN GAP]`. Test with the fake adapter. Task T096 (Phase 3). Asked for the alternative of returning the session to its previous mode at a done ending: **not taken**, because it would replace D8, which is the owner's; open for the owner.
  - **Phase 1 corrections to the plan**: `setAutopilot(sessionId, s, reason?)` carries the end reason (plan's no-progress call needs one). `AutopilotRun` takes one injected `halt()` that each adapter writes, because FR-050's order differs per app. An `ended` event's `n` is the continuations that ran, never above `limit`, so "after N more turns" (FR-040) reads 5 with limit 5; `continued` never exceeds `limit`.
- **2026-10-31 18:56 UTC (owner decision, Vikram, relayed by his coordinating agent: "a scheduled prompt runs in the mode attached to that scheduled prompt")**: replaces FR-083's wording above. D8 otherwise stands.
  - **FR-083** A scheduled prompt runs in **its schedule's mode** (spec 044 FR-180). The session's Autopilot state does not decide. The adapter leaves the goal mode for that prompt, applies the schedule's mode for that one turn, and when the turn ends the session returns to what it was, Autopilot included (D8). Unless the schedule's own mode is Autopilot (FR-084), it is not a run: the session's continuation count, limit and end card are untouched, and no `autopilot` event is emitted for it. Where the adapter cannot switch a live session, the prompt is **not sent**: the run log says why, visibly, and it is `[KNOWN GAP]` per app. Fake adapter test for a scheduled prompt after a done ending, for both outcomes. T096.
- **2026-10-31 19:02 UTC (owner ruling, Vikram, relayed by his coordinating agent: schedules support all modes, with a selection on each schedule)**: amends D4, FR-003, FR-004, FR-005, SC-002 and the *Constitution* section. Spec 044 FR-180..FR-184 hold the schedule side.
  - **FR-084 Autopilot on a schedule.** **Out of the first build** (Vikram's ruling, 2026-10-31 19:02 UTC, pending the other two owners, because it reverses D4 and constitution III; spec only; a stored `autopilot` on a schedule is refused until the three owners confirm; *Changes*, *Open questions* Q-A). A schedule may choose Autopilot where the agent has `capabilities.autopilot`; elsewhere it is not offered, and a stored one is refused with a visible reason (spec 044 FR-184). Each due time is **one run**: Autopilot's continuation limit (always on, stored on the schedule, default 5, raised as in FR-021), its optional spend cap (D9 applies; the schedule's own limit, spec 044 FR-015, is separate and whichever is reached first ends it), the same chip and visible state, the same **Stop** (FR-050), questions not waited on (D2). The confirmation is asked when it is chosen or edited and names the schedule and the agent (spec 044 FR-182), not at each run. **Its warning shows the spend** (D13): the cap in the user's unit, or "no cap", and "no total limit" when none is set. The run's end reason is shown on the schedule's row and in its run log. The cap stays optional, and an organization policy may require or forbid one (FR-070). A running one makes the next due time `skipped-busy`. When the run ends, however it ends, the session returns to what it was (FR-083): S3 and D8 apply to a session's own Autopilot, not to a schedule's run. Not on a loop (open, spec 044). T097.
  - **What this changes in earlier decisions, for the owner's eye**: D4 and FR-003 ("confirmed each time") hold for sessions only; a recurring schedule runs many times on one confirmation. FR-005 and SC-002 ("never saved") hold for sessions and folders only. S3 ("any other ending returns to Allow all") does not apply to a schedule's run. A session in Read-only can now carry one Autopilot run (the run's mode is `allow` plus the goal, so FR-002 still holds for the run). **Spend**: each run is bounded by the limit, but the spend cap is optional (D3), so a schedule that recurs has no total bound unless it sets one.
- **2026-10-31 (review of PR #923 by rubenlupi, CHANGES_REQUESTED at `dfe6428e`; applied by Vikram's coordinating agent)**: each code fact was read against the code first. Spec text only.
  - **Item 1**: FR-007 (new), FR-060. T039.
  - **Item 2**: FR-053 (new), FR-005 with its `[KNOWN GAP]`, FR-052. T024.
  - **Item 3**: already answered by FR-083 above: a scheduled prompt or a loop's pass leaves the goal mode and runs in its schedule's mode, or is not sent. The plan's `AgentMessage.autopilot = false` line and T032 are brought into line. No new requirement.
  - **Item 4**: FR-054 (new), FR-041, FR-050. T025. The 10 second wait is proposed.
  - **Item 5**: the backstop in FR-021, FR-020 with its `[KNOWN GAP]`, FR-040 **error**, FR-058 for a typed Codex message, SC-003. T014, T026. **2 hours per run** (a raisable default, D13) and the model-turn bounds are proposed. Differs from the review: Claude's `num_turns` arrives only in the one `result` of a goal, so it cannot stop a live run; main-stream assistant message ids do that, and `num_turns` is the check at the end.
  - **Item 6**: FR-022, FR-055, Story 5. T027. Scope per app, the lower wins, restored after every run, and `durbar_set_cap`. Differs from the review: `durbar_set_cap` is not reachable today (`CHANGE_TOOLS_ENABLED = false`).
  - **Item 7**: FR-001 `planApproval`, FR-060 with its `[KNOWN GAP]`, Story 4, spec 066's delta (FR-006, FR-007 new, FR-005). T040, T042, T092. Until a run checks it, the plan button is not offered for Codex.
  - **Item 8, owner ruling (D13)**: FR-002, Story 3, FR-055. The menu offers Autopilot from Read-only and Ask first, and the native dialog says the folder becomes Allow all and stays so. T030, T033. The plan button stays hidden in those two modes (FR-060), listed for the owner.
  - **Item 9**: FR-008 (new). T028.
  - **Item 10**: T090's stale "not seen" line, `docs/agent-apps.md` (the same line, and the new Claude and Codex facts), the plan's capability type, the capability examples in T020-T022, and the number note. Differs from the review: `origin/099-mcp-test-build` is not on the remote now.
  - **Q-D, owner decision, Vikram, relayed by his coordinating agent, 2026-10-31**: yes. D12, FR-003, FR-055, the plan. T030, T033.
  - **Q-A, Q-B, Q-C**: see the ruling below and *Open questions*.
  - **The three `[KNOWN GAP]` wordings** the review gives are added verbatim (FR-005, FR-020, FR-060).
- **2026-10-31 (schedules out of the first build)**: **Autopilot on a schedule (FR-084, T097, T096 where it depends on Autopilot; spec 044 FR-182's Autopilot half) is out of the first build.** Vikram's ruling, 2026-10-31 19:02 UTC, pending the other two owners, because it reverses D4 and constitution III. It stays spec only. A stored `autopilot` on a schedule is refused until the three owners confirm: not sent, `mode-refused`, a visible reason (spec 044 FR-183, FR-184). The form does not offer it. FR-084's text stands as the draft for that decision. The review's point that a cap might be mandatory for a scheduled Autopilot is Q-A: Vikram's answer is no, pending Paco and Ruben (D13).
  - **While T096 is held** *(coordinator choice awaiting owner review)*: FR-083 still holds, by its own fallback. A scheduled prompt or a loop's pass that is due for a session on Autopilot is **not sent**, and the run log says why (T032). So nothing runs under the goal loop uncounted, and no adapter has to switch modes for one turn yet.
- **2026-10-31 20:52 UTC (owner ruling, Vikram, relayed by his coordinating agent: warn people and let them override; the app does not impose limits on a person's own money; only organizations may enforce)**: D13 under *Clarifications*; FR-002, FR-009 (new), FR-021, FR-055, FR-070, FR-072 (new), FR-084, S1, S5, spec 044's delta. T098, T099. Listed for the owner: the run limit stays as a default, not a hard limit. The reviewer's two additions, relayed as consistent with the ruling, are recorded with it: the spend and end reason on an unattended run (FR-084, spec 044), and the window always keeping Stop (FR-009).
  - **Every number checked against the principle** (a hard limit stays only if it protects user data or is an organization rule). **Changed**:
    - run limit 1-20: now default 5, a warning above 20, technical bound 1-1000, never off (FR-021, T011, T012);
    - backstop time 2 hours: a raisable default, technical bound 1-168 hours, never off (FR-021);
    - goal text 4000 characters on Claude Code: a warning, not a refusal (FR-011, T012); adjusted the same day to a refusal with a reason because the CLI itself refuses it (*Changes*, review of 716acc3b, awaiting owner review).
  - **Kept, with why**:
    - run limit default 5: a default the person can raise;
    - backstop turn counts `100 × (limit + 1)` and Codex `limit + 1`: a safety bound against a changed app, not a money limit, and they grow with the person's limit;
    - no progress after 2 unchanged continuations (FR-023): it ends one run, and *Run again on Autopilot…* overrides it at once; it spends nothing, listed for the owner;
    - Copilot's minimum cap of 30 AI credits (D9): the runtime's own refusal, not Durbar's;
    - Claude's 9 Stop hook blocks: the app's own, Durbar cannot set it;
    - the lower cap wins, and a value at or below what was spent is refused (FR-022): the person's own cap, which they can raise;
    - the 10 second wait for a clear (FR-054): a goal that may still be running, which protects user data;
    - Allow all and remote control never together (FR-007): protects user data;
    - the organization checks (FR-070, spec 044 FR-183): organization rules;
    - D7 and D11 budgets and the 30 credit caps on real checks: our own tests, not the product;
    - `empty` and `reserved` goal text: not limits, the message would do something else (`/goal clear`, a bare `/goal`).
  - **Warnings, new**: more than 3 sessions on Autopilot at once, proposed (FR-072).
  - **Spec 044's new FRs** (FR-180..FR-184) hold no number. Stored `autopilot` refused and no Autopilot on a loop are held or open for the owners, not limits on money. The 10,000 character prompt limit is an older owner decision, not in these FRs, and is not changed.
- **2026-10-31 (Phase 1 built, T010-T014; review of 716acc3b applied; choices awaiting owner review, none is an owner decision)**: `src/adapters/autopilot.ts`, the types, `eventguard`, `scripts/test-autopilot.ts`. No adapter, IPC or UI; no descriptor reports `autopilot`.
  - `AgentInfo.autopilot.run` is `{continuation, startedAt}` as FR-002 has it (the plan said `n`; plan brought into line).
  - **Goal text** (FR-011) **adjusts D13's application, awaiting owner review**: a goal over 4000 trimmed characters on Claude Code is **refused with a reason**, not warned. The CLI answers it in plain text and sends nothing, which could read as done; this is the app's own limit, like Copilot's 30 AI credits, not a limit Durbar adds. `empty` is refused on every app; `reserved` and the 4000 limit apply on Claude Code only (and with no app named, the strictest rules). Reserved: `clear`, `stop`, `off`, `reset`, `none`, `cancel`, trimmed and case-insensitive (`read:` CLI 2.1.316 binary). A line shaped like a slash command (`/word`, no further `/` in that word, after hidden characters are removed) is refused on Claude Code: reading cannot exclude that it runs a second command (a safe default, awaiting review; the first wording refused any line starting with `/`, which was too broad). Hidden characters are removed with `HIDDEN_ALL_RE` (`src/shared/names.ts`) plus LRM, RLM, ALM, U+206A-F and tag characters, joiners kept; U+2028/9 become newlines; a goal with no visible character is `empty`.
  - **Event guard** (T011): the machine never emits `n` above `limit`, so the guard is as tight as the machine: `started` n 0, `continued` n 1 to `limit`, `ended` n 0 to `limit`, `spend` on `ended` only, a `runId` of letters, digits and `._:-`. (An earlier draft of this entry allowed `limit + 1`; that was wrong.)
  - **`AutopilotRun`**: `halt` is called for every end reason, `done` included (FR-041). The guard is armed from the moment of the end until the newest `halt` is confirmed (FR-054); a continuation after the end, confirmed or not, repeats `halt` and is not counted (a later continuation after a confirmed stop means the app is still going). Backstop time counts only forward clock steps between samples, and a clock reading that is not a number ends the run as `error` (fail closed). The core owns no timer: the adapter calls `checkElapsed()` at least every `CLOCK_SAMPLE_MS` (60 s). `[KNOWN GAP]`: a step back between two samples still delays the end by its size; a backstop of turns takes `backstopPer`: 100 by default, 1 for Codex (`limit + 1`, FR-021). Hours 1-168 may be fractional.
  - `isClaudeContinuation` refuses `isSidechain: true` too, and reads `isSynthetic` at the top level of the stream message, counts a marker in any text block, and treats a null `agentId` or `parent_tool_use_id` as the main stream; the probe's exact placement of `isSynthetic` is not checked (`[KNOWN GAP]`, T091).

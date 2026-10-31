# Feature Specification: Autopilot mode (the agent keeps going until the task is done)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Autopilot mode: a fourth safety mode above Allow all, per session and confirmed each time, only for agent apps that support it; the agent's questions are shown but not waited on, the app keeps going after each turn until the task is done, up to a continuation limit (default 5) and an optional spend cap; Stop ends it; plan approval may offer Approve and run on Autopilot (spec 066 delta)
status: draft
note: spec, plan and tasks; owner answers Q1-Q4; real probes on all three apps (T090, and longer runs with questions and Stop, T093); nothing built
-->

**Feature Branch**: `099-autopilot` (spec). Code branches `099-pN-slug`, one per phase. It touches 003 (the permission modes), 002, 012
and 087 (the adapters, and the Allow all mapping and sandbox), 011 (the caps), 066 (plan first: a delta in this PR), 076 (the
organization policy), 018 (the mode switch) and 010 (the simulator).

**Created**: 2026-10-31

**Status**: Draft. The owner decided the shape (D1-D7) and answered Q1-Q4 (D8-D11 below). Real probes ran on Claude Code, Codex
and, for Copilot, one autopilot turn capped at 30 AI credits (T090), then longer runs on all three apps with a question,
several continuations and Stop at the limit (T093, *Evidence*). Nothing is built.

**Input**: Owner (Vikram, Telegram DM, 2026-10-31 10:43 UTC): "I go with your suggestions except spend cap as mandatory, have it
optional", answering the coordinator's proposal for an Autopilot mode.

## Why a new spec and not a delta

Autopilot adds a fourth mode, a new per-session state that is never saved, a new adapter capability and events, a new
confirmation dialog, continuation counting in Durbar, and the agent apps' goal APIs (Claude Code `/goal`, Codex
`thread/goal/*`, Copilot `autopilot` mode), across three adapters. A delta to spec 003 or 087 would bury that. Spec 066 gets a
delta in this PR for its one new button (FR-060).

Existing capabilities checked (AGENTS.md FR-031):
- **Self-paced loops (spec 072)** send a prompt again and again on Durbar's timer, within Durbar's limits. Autopilot sends one
  message and lets the agent app continue inside its own goal loop. The two do not share a mechanism. A loop's pass on a
  session in Autopilot is sent as a normal Allow all message (FR-004).
- **Reused**: `setModeOp` and the Allow all path (FR-002), the cap paths of spec 011 and 012 FR-150 (FR-022), the question
  card (FR-030), the plan card (FR-060), the organization checks of spec 076 (FR-070), and the git status runner of spec 063
  (FR-023).

Number check (2026-10-31):
- `specs/` on `origin/main` ends at 097;
- 098 is on a remote branch (`098-experience-contract`, open PR #919), and no remote branch starts with `099`;
- the open PRs are #915, #919 and #921 (080, 098, 097), and no PR, open or closed, uses 099;
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
- **D4** **Scope**: Autopilot is per session and confirmed each time, like Allow all. A folder cannot default to Autopilot.
- **D5** **Claude Code**: the Allow all mapping (`bypassPermissions`) plus `/goal <condition>`.
- **D6** **Plan approval** may offer **Approve and run on Autopilot**. This needs a spec 066 delta (FR-060 here, and spec 066
  `## Changes`).
- **D7** **Real checks**: a few credits per app are OK, to settle what is unverified.

### Decisions this spec makes (proposed; open to the owner in review)

- **S1** **The continuation limit is always on**: it cannot be turned off. It defaults to 5, the dialog takes 1-20, and the
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
  schedule, a restart or a resume.

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
- It is never offered as a folder's default, when adding a folder, or in schedules (FR-004).
- After a restart or a resume, the session comes back in **Allow all**, never in Autopilot, and the chat says so (FR-005).

### Story 4 - Approve a plan and let it run (P2)

A plan card (spec 066) has a fourth button, **Approve and run on Autopilot…**. It asks for the Autopilot confirmation, then
carries out the plan as an Autopilot run whose goal is to carry out the approved plan (FR-060).

### Story 5 - Optional spend cap (P2)

In the dialog the user ticks *Stop at a spend cap* and enters a value in the app's own unit: AI credits for Copilot, dollars
(Claude's estimate) for Claude Code, tokens for Codex. When the cap is reached, the run ends with **cap** (FR-022). Without a cap,
the dialog says plainly that only done, the continuation limit, no progress, blocked, or Stop end the run.

## Requirements

### Mode model

- **FR-001** **The capability.** `AdapterCapabilities.autopilot?: Readonly<{ capUnit: 'aiu' | 'usd' | 'tokens' | null; attachments: boolean; verified: boolean }>`.
  - Missing means the app has no Autopilot, and the mode menu does not offer it.
  - `capUnit` is the unit of the optional spend cap (`null`: no cap is possible).
  - `attachments` is true only when the app's Autopilot send takes attachments (D10): Copilot `true` (`real:` T090), Claude
    Code and Codex `false` (their goal input is text).
  - `verified` is true only after a real run is recorded under `## Changes`. Until then the dialog and the chip tooltip say
    *Not verified on a real session yet.*
- **FR-002** **Autopilot is Allow all plus a per-session `autopilot` state**, not a new value of `PermMode`, `OrgMode` or a
  saved mode.
  - `AgentInfo.autopilot?: { limit: number; cap?: number; run?: { continuation: number; startedAt: number } }` holds the state.
  - The window shows it as the fourth mode, and the mode menu lists Read-only, Ask first, Allow all and **Autopilot…**.
  - Turning Autopilot on sets the session's mode to `allow` first, through the existing `setModeOp` path: the organization
    check, the sandbox note of spec 087 FR-022c, and the pending approvals.
  - **Read-only and Ask first can never be combined with Autopilot.** Choosing either one ends Autopilot first (FR-051), so
    no code path leaves `autopilot` set while the mode is not `allow`.
- **FR-003** **The confirmation is asked every time** Autopilot is turned on: from the menu, from *Run again on Autopilot…*, and
  from the plan card. There is no "don't ask again".
- **FR-004** **Never a default.**
  - Not offered when adding or creating a folder (the `confirmAllow` path), nor as a folder's mode.
  - Not used by schedules: a scheduled prompt runs in the mode attached to that schedule, never as an Autopilot run (FR-083;
    spec 044 FR-180).
  - Not settable by Durbar's MCP tools or by remote control.
  - `agents:setAutopilot` is window-only (`fromApp`).
- **FR-005** **Never saved.**
  - The folder store keeps `allow` for a session that was on Autopilot (`setSessionMode` gets `allow`).
  - After a restart, a sign-in refresh (spec 012 FR-158), *End session* followed by a message, or a resume from Previous
    sessions, the session is in Allow all. The chat says: "Autopilot ended when this session closed. It is in Allow all."
- **FR-006** **The app changes its mode by itself.** When an agent app reports that it entered its own autopilot or goal state
  without Durbar asking, Durbar turns that state off and says so in the chat. Examples: Copilot `session.mode_changed` to
  `autopilot` from remote control; Codex `thread/goal/updated` with `origin` not from Durbar; a `/goal` the user typed in the
  composer. When the session is in Allow all, the chat offers *Autopilot…*. Durbar never follows the app into Autopilot unasked.

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
  - `<text>` is the user's message (S2), with each run of control characters other than newline replaced by a space. A message
    over 4000 characters is refused in the composer: "On Autopilot a message for Claude Code can be at most 4000 characters."
  - `real:` 2026-10-31: `/goal` works under `--setting-sources "" --strict-mcp-config`.
  - `[KNOWN GAP]`: whether newlines inside the condition survive (the probes used one line); the 4000-character limit is
    Durbar's own choice, not a documented CLI limit.
- **FR-012** **Codex.**
  - **On**: the Allow all thread settings (unchanged; from the next message, FR-144).
  - **Send**: `thread/goal/set {threadId, objective: <text>, tokenBudget: <cap or null>, origin: 'user'}` **instead of**
    `turn/start`. It starts the first turn by itself, and every later turn too.
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
- **FR-021** **The limit** is always on (S1): default 5, range 1-20, chosen in the dialog. When continuation `limit + 1` starts,
  Durbar stops it at once, in the same way as Stop (FR-050). The run ends with reason **limit**.
  - Claude Code: `interrupt` plus `/goal clear`, `real:` 2026-10-31.
  - Codex: `thread/goal/clear` plus `turn/interrupt`, `real:` 2026-10-31.
  - Copilot: `mode.set interactive` plus `abort()`, `real:` T093 (limit 1, stopped when continuation 2 started).

  The agent app's own limit is never relied on: the SDK has no option for the CLI's `--max-autopilot-continues`, and Codex has
  none. Claude Code has a fixed one that Durbar cannot set: it overrides the goal after 9 consecutive Stop hook blocks
  (`real:` T093, FR-040). With a limit above 8, Claude Code may end the run first; that run ends with **blocked**.
- **FR-022** **The optional spend cap** (D3) is off unless the user ticks it. It uses each app's own cap, in its own unit.
  - **Copilot**: the session's AI-credit cap (spec 011): `rpc.options.update({sessionLimits: {maxAiCredits}})` when it
    differs from the current cap.
    - The runtime refuses caps under 30 AI credits at session start (*Evidence*). A cap entered below 30 is raised to 30,
      and the dialog says "Copilot's smallest cap is 30 AI credits, so Autopilot uses 30." (D9). Spec 011 already floors
      every other Copilot cap at 30 (`MIN_CAP`, `src/shared/credits.ts`), so existing caps do not hit the runtime's refusal.
    - When the cap is reached, the `session_limits_exhausted` request is answered `cancel` and the run ends with **cap**.
      The cap card stays, so the user can raise the cap for later messages.
  - **Claude Code**: `--max-budget-usd` (spec 012 FR-150) for the run; it applies on the relaunch the cap change already
    causes. A `result` with `subtype: error_max_budget_usd` ends the run with **cap**. `[KNOWN GAP]`: a cap reached in the
    middle of a goal was not probed.
  - **Codex**: `tokenBudget` on `thread/goal/set`, in tokens (Codex counts non-cached input plus output, *Evidence*). Goal
    status `budgetLimited` ends the run with **cap**. The cap is soft: the turn that is running finishes (the probe:
    budget 8000, 10,056 used). The dialog says "Codex finishes the turn it is in, so it can go a little over." Status
    `usageLimited` (the user's plan) ends the run with **cap** too, worded "your Codex plan's usage limit".
  - Without a cap, the dialog says: "No spend cap: Autopilot stops when the task is done, at the turn limit, when it makes no
    progress, or when you press Stop."
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
  - **error** (the turn failed, or the process exited).

  The chat shows "Autopilot ended: <reason words>, after N more turns[, <spend>]". The desk line and the inbox show the reason
  as a word, and an icon, not colour alone. Every reason except done follows S3.
- **FR-041** After every end, Durbar clears the app's goal, so a later normal message never runs under an old goal:
  - Claude `/goal clear` (free: a `result` with `num_turns: 0`, `real:`);
  - Codex `thread/goal/clear` (`real:`);
  - Copilot `mode.set interactive` when leaving Autopilot (S3). After done it stays in `autopilot` (D8; `real:` T090:
    `mode.get` is still `autopilot` after `session.idle`).
- **FR-050** **Stop** on a session on Autopilot aborts the turn, clears the goal (FR-041), and returns the session to **Allow
  all**, with reason **stopped**. Per app:
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
  Allow all (FR-005).

### Window

- **FR-055** **The confirmation dialog** (`askDialog`):
  - title: "Autopilot for <name>?";
  - body: "<App> will keep working on each message until it judges the task done, without stopping for you. Edits, shell
    commands, web requests and tools run without asking, in <folder>. When it has a question, it decides by itself. Nothing is
    undone automatically. Stop ends Autopilot at once.", then the spec 087 FR-022c sandbox sentence when this switch turns a
    sandbox off, then *Not verified on a real session yet.* while `verified` is false;
  - fields:
    - "Keep going for at most [5] more turns per message" (1-20; FR-021);
    - "[ ] Stop at a spend cap of [ ] <unit>" (FR-022: unit words "AI credits", "US dollars (Claude's estimate)", "tokens";
      Copilot minimum 30: a lower value is raised to 30 with the D9 sentence);
    - the no-cap sentence while it is unticked;
  - buttons: *Cancel* and *Start Autopilot* (`primary warn`), with focus on Cancel. Esc cancels.
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
  - a message typed while a run is on is sent as the app queues it today, and does not start a new count;
  - `/goal` typed by the user in Claude Code is refused while on Autopilot ("Autopilot sets the goal from your message.").

### Plan first (spec 066 delta)

- **FR-060** **The plan card** gets **Approve and run on Autopilot…**. It is shown only when the adapter reports `autopilot`,
  the organization allows it (FR-070), and the session's mode is not Read-only or Ask first. In those two modes it is
  hidden: the card's existing line says the plan runs in that mode.
  - Pressing it shows the FR-055 dialog. On confirm, Durbar turns Autopilot on (FR-002) and answers the plan:
    - **Copilot**: `{approved: true, selectedAction: 'autopilot'}`, with mode `autopilot` set by the runtime (`read:`
      `ExitPlanModeAction`; `[KNOWN GAP]`: not exercised in T090).
    - **Claude Code**: `allow` for `ExitPlanMode`, `set_permission_mode` back to the launch mode (`bypassPermissions`), then
      `/goal Carry out the approved plan above, completely, and check the result.`
    - **Codex**: `thread/goal/set` with the objective "Carry out the approved plan above, completely, and check the
      result.", in place of the "Go ahead with the plan above." turn.
  - Plain **Approve** is unchanged and never selects autopilot.

### Organization policy

- **FR-070** Autopilot is blocked wherever Allow all is blocked (spec 076 FR-203), with the same reason:
  - Copilot: `bypassPermissionsDisabled` (the runtime's own deny-wins verdict);
  - Claude: `permissions.disableBypassPermissionsMode`;
  - Codex: `allowed_approval_policies` without `never`, or `allowed_sandbox_modes` without `danger-full-access`.

  Advice only, still selectable, with *may be blocked by your organization*: Claude managed settings with `disableAllHooks`
  or `allowManagedHooksOnly`. `/goal` works through a Stop hook ("Stop hook feedback"), so such a policy may stop it
  (`[KNOWN GAP]`). Durbar reads nothing new beyond spec 076's files. `setAutopilot` repeats the check in main.

### Simulator and evidence

- **FR-080** **The simulator**: every simulated kind reports `autopilot` (Copilot `aiu`, Claude `usd`, Codex `tokens`). A
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
- **SC-002** Tests prove that no path sets `autopilot` with a mode other than `allow`, and that nothing saves it.
- **SC-003** Tests prove that the continuation count stops a run at `limit + 1` for each adapter's fake.
- **SC-004** A real run per app is recorded under `## Changes` before `verified` becomes true, as one tiny task within the D7
  budget.

## Constitution

- **III (safe by default)**:
  - Autopilot is an explicit, per-session opt-in, confirmed every time, never a default, never saved, and named honestly. It
    only adds to Allow all, which is already the explicit opt-in that III names, so **no amendment is needed**: Read-only stays
    the default, and Ask first and Read-only cannot combine with it.
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
  - **Goal text** (FR-011, S2): on Claude Code a message of exactly `clear` would become `/goal clear` and clear the goal, and empty text would send a bare `/goal`. Both are **refused with a visible reason**, never sent. `goalText` returns the text or a refusal reason (`empty`, `reserved`, `too-long`). The 4000 limit is Claude Code's only.
  - **FR-082 Events are checked in main.** `eventProblems` (`eventguard`) runs only in tests today, so FR-081's bounds would protect nothing at run time. Main MUST validate each `autopilot` event, and `question.autoAnswered`, before using or forwarding it, and drop a bad one with a masked log line; clamping in the renderer is not enough. Task T095 (Phase 3).
  - **FR-083 (first wording, replaced by the entry below) A later message never runs silently under the goal loop.** D8 stands: after a run ends **done**, the session stays in Autopilot. But Copilot's runtime also stays in `autopilot` then (FR-050), so a scheduled message (FR-004), which is a normal message, could run under the app's goal loop with no run counting it. A message that is not a run MUST NOT reach the app in its goal mode: the adapter leaves that mode for the message where it can (Copilot `mode.set interactive`) and returns to it after, without changing what the session shows; where it cannot, the message is **refused with a visible reason**, and the gap is written `[KNOWN GAP]`. Test with the fake adapter. Task T096 (Phase 3). Asked for the alternative of returning the session to its previous mode at a done ending: **not taken**, because it would replace D8, which is the owner's; open for the owner.
  - **Phase 1 corrections to the plan**: `setAutopilot(sessionId, s, reason?)` carries the end reason (plan's no-progress call needs one). `AutopilotRun` takes one injected `halt()` that each adapter writes, because FR-050's order differs per app. An `ended` event's `n` is the continuations that ran, never above `limit`, so "after N more turns" (FR-040) reads 5 with limit 5; `continued` never exceeds `limit`.
- **2026-10-31 18:56 UTC (owner decision, Vikram, relayed by his coordinating agent: "a scheduled prompt runs in the mode attached to that scheduled prompt")**: replaces FR-083's wording above. D8 otherwise stands.
  - **FR-083** A scheduled prompt runs in **its schedule's mode** (spec 044 FR-180). The session's Autopilot state does not decide. The adapter leaves the goal mode for that prompt, applies the schedule's mode for that one turn, and when the turn ends the session returns to what it was, Autopilot included (D8). It is not a run: the continuation count, limit and end card are untouched, and no `autopilot` event is emitted for it. Where the adapter cannot switch a live session, the prompt is **not sent**: the run log says why, visibly, and it is `[KNOWN GAP]` per app. Fake adapter test for a scheduled prompt after a done ending, for both outcomes. T096.
  - **A schedule cannot be set to Autopilot and never counts as a run** (proposed, open to the owner): a schedule is saved and runs unattended, and FR-003 and FR-005 with D4 say Autopilot is confirmed each time and never saved. This is read from those decisions; the owner has not ruled on this case itself.

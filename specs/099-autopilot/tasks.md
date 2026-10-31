# Tasks: 099 Autopilot mode

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: required (constitution VII; SC-001..SC-003): node tests on the fakes and the simulator, 0 AI credits, driver waits with
`until()`. Real checks are separate tasks (T090-T094) within the owner's budget (D7; Copilot runs need an OK each, D11).

**Format**: `- [ ] Tnnn [P?] description (file) [requirements]`. `[P]` means the task can run in parallel. One phase is one PR.
Numbers taken: spec 099, FR-001..FR-090 (sparse by group), T001..T094.

## Phase 0: Spec (this PR)

- [x] T001 Spec, plan, tasks and the specs-index block (`specs/099-autopilot/`), with the probe record in the PR body
- [x] T002 Spec 066 delta under `## Changes` for *Approve and run on Autopilot* [FR-060]
- [x] T003 Owner answers to Q1-Q4 recorded under *Clarifications* (D8-D11), and posted on the PR [Q1-Q4]

## Phase 1: Core and types (PR `099-p1-core`)

- [ ] T010 `AdapterCapabilities.autopilot` (with `attachments`, D10), `AutopilotSettings`, `setAutopilot?`, the `autopilot` event, `question.autoAnswered`,
  `AgentInfo.autopilot` (`capabilities.ts`, `types.ts`, `src/shared/api.ts`) [FR-001, FR-002, FR-081]
- [ ] T011 `eventguard` accepts and bounds the `autopilot` event (`n` 0-21, `limit` 1-20, a known reason) + test [FR-081]
- [ ] T012 `src/adapters/autopilot.ts`: `AutopilotRun` (count, limit, end once, no-progress counter), `AUTOPILOT_ANSWER`,
  `goalText`, `isClaudeContinuation`, `codexGoalEnd` + `scripts/test-autopilot.ts`. Test lines: stop at exactly
  `limit + 1`; a second end is ignored; control characters; 4000 characters; every Codex status [FR-020, FR-021, FR-030, FR-040]
- [ ] T013 `package.json`: `test:autopilot` in the `npm test` list

## Phase 2: Adapters (PR `099-p2-adapters`)

- [ ] T020 Claude Code: `/goal` send, continuation count, `AskUserQuestion` auto-deny, end mapping, `/goal clear` after every
  end and on Stop, `/goal` typed by the user refused while on Autopilot; capability `{capUnit: 'usd', verified: false}`.
  Tests on the scripted CLI fake replay the probe's message shapes (`Stop hook feedback`, `aborted_streaming`, `Goal cleared`,
  `stop-hook-block-cap` before a `success` result ends with blocked)
  [FR-011, FR-020, FR-021, FR-030, FR-040, FR-041, FR-050, FR-058]
- [ ] T021 Codex: `thread/goal/set` in place of `turn/start`, `tokenBudget`, the `turn/started` count, the `goal/updated` mapping,
  Stop with `goal/clear` and then `turn/interrupt`, `requestUserInput` auto-answer, never on an ephemeral thread; capability
  `{capUnit: 'tokens', verified: false}`. Tests on the app-server fake replay the probe's notifications [FR-012, FR-020-FR-022, FR-030, FR-040, FR-050]
- [ ] T022 Copilot on the fake SDK: `mode.set autopilot` and `interactive`, `agentMode`, `onUserInputRequest` auto-answer,
  elicitation declined, `task_complete` and objective mapping, a cap below 30 raised to 30 and `cancel` on exhausted, Stop
  order, attachments sent with `agentMode`, the broker still answering permissions (no `setApproveAll`); capability
  `{capUnit: 'aiu', attachments: true, verified: false}`. Continuations counted from `isAutopilotContinuation` behind a small
  function (T090)
  [FR-010, FR-020-FR-022, FR-030, FR-040, FR-050]
- [ ] T023 [P] FR-006: an app entering its own autopilot or goal without Durbar is switched back and said in the chat, for each
  adapter + tests [FR-006]

## Phase 3: Main and window (PR `099-p3-ui`)

- [ ] T030 `agents:setAutopilot` (`fromApp`), validation, capability and organization checks, `setModeOp('allow')` first,
  `setModeOp` to Read-only or Ask first ends Autopilot first, nothing saved, activity log lines; IPC tests: not from the app
  refused, the MCP tools and remote control have no path, a restart or resume comes back in `allow` [FR-002-FR-005, FR-051, FR-052, FR-070]
- [ ] T031 No progress: the fingerprint at each continuation through the spec 063 runner (read-only), and the end after two
  unchanged ones + tests with a fake runner [FR-023]
- [ ] T032 Schedules and loops send to a session on Autopilot as a normal message + test [FR-004]
- [ ] T033 Renderer: the mode-menu item, the confirmation dialog (limit field, optional cap, no-cap sentence, sandbox note,
  verified line), the remembered `autopilotLimit` setting [FR-003, FR-055, S1]
- [ ] T034 Renderer: the chip with its glyph and `n/limit`, the desk line, the List column, the needs-me sorting after a
  non-done end [FR-056]
- [ ] T035 Renderer: the chat lines, the question card *Decided by itself*, the end card with *Run again on Autopilot…*, the
  composer placeholder, the attach button hidden with its tooltip where `autopilot.attachments` is false; the dialog's
  cap-raised-to-30 line for Copilot [FR-022, FR-055, FR-057, FR-058, S4, D9, D10]
- [ ] T036 Simulator: the capability on every kind, the run with 2 continuations, the `?sim=autopilot-<reason>` scripts [FR-080]
- [ ] T037 Driver `scripts/check-autopilot.js` at 1440x900 and 1280x800, with 15 agents: menu, dialog, chip, every end reason,
  no text under 10.5px; screenshots `docs/screenshots/099-autopilot-*` in `DOC_SHOTS` [SC-001, FR-056]
- [ ] T038 README Safety model, mode-menu sentence, *What Durbar does not do*, *Costs and caps*; changelog fragment [FR-090]

## Phase 4: Plan first (PR `099-p4-plan`)

- [ ] T040 Plan card button and dialog; Copilot `selectedAction: 'autopilot'`, Claude bypass and the plan goal, Codex goal
  objective; hidden in Read-only and Ask first; tests in `scripts/test-plan-mode.ts`; screenshot [FR-060]
- [ ] T041 Spec 066 FR-003 and *Constitution* text updated to match what was built, and the spec 066 delta ticked [FR-060]

## Real checks (D7 budget; one tiny task each, results under `## Changes`)

- [x] T090 **Copilot** (D11: cap 30 AI credits, the runtime minimum), one tiny task on the cheapest model through the SDK the
  way the adapter uses it (nothing is built yet). Done 2026-10-31, 0.434 AI credits: `onPermissionRequest` is called in
  autopilot (no auto-deny), attachments are accepted, `session.task_complete` ends it, the mode stays `autopilot`. Not seen:
  a continuation, `ask_user`, Stop mid-run (still `[KNOWN GAP]` in FR-020, FR-030, FR-050, FR-060)
- [ ] T091 **Claude Code** through the built adapter: one run to done, one to the limit (limit 1), one cap in the middle of a goal
  (`--max-budget-usd` 0.02); a multi-line condition [FR-011, FR-021, FR-022]
- [ ] T092 **Codex** through the built adapter: one run to done, one to the limit (limit 1), one to `budgetLimited`; a model
  switch between runs [FR-012, FR-021, FR-022]
- [x] T093 **Longer probes on all three apps** (owner OK, Vikram, Telegram, 2026-10-31 11:11 UTC; Copilot cap 30): a staged task
  with a question, to done, then a run stopped at limit 1, through the SDK, CLI and app-server the way the adapters use them
  (nothing is built yet). Done 2026-10-31, 1.626 AI credits, $0.0228, 65,827 Codex tokens: Copilot `isAutopilotContinuation`
  and `ask_user` seen, Stop quiet; Claude's `stop-hook-block-cap`; Codex `blocked` [FR-010, FR-020, FR-021, FR-030, FR-040,
  FR-050]
- [ ] T094 **Copilot** through the built adapter (needs a new owner OK, cap 30): a run to done, one to the limit (limit 1), and
  one with `ask_user` [FR-010, FR-020, FR-021, FR-030, FR-050]

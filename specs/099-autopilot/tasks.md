# Tasks: 099 Autopilot mode

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: required (constitution VII; SC-001..SC-003): node tests on the fakes and the simulator, 0 AI credits, driver waits with
`until()`. Real checks are separate tasks (T090-T094) within the owner's budget (D7; Copilot runs need an OK each, D11).

**Format**: `- [ ] Tnnn [P?] description (file) [requirements]`. `[P]` means the task can run in parallel. One phase is one PR.
Numbers taken: spec 099, FR-001..FR-090 (sparse by group; FR-007, FR-008, FR-009, FR-053, FR-054, FR-072 added with the review of PR 923 and D13), T001..T099 (sparse).

## Phase 0: Spec (this PR)

- [x] T001 Spec, plan, tasks and the specs-index block (`specs/099-autopilot/`), with the probe record in the PR body
- [x] T002 Spec 066 delta under `## Changes` for *Approve and run on Autopilot* [FR-060]
- [x] T003 Owner answers to Q1-Q4 recorded under *Clarifications* (D8-D11), and posted on the PR [Q1-Q4]

## Phase 1: Core and types (PR `099-p1-core`)

- [x] T010 `AdapterCapabilities.autopilot` (with `attachments`, D10), `AutopilotSettings`, `setAutopilot?`, the `autopilot` event, `question.autoAnswered`,
  `AgentInfo.autopilot` (`capabilities.ts`, `types.ts`, `src/shared/api.ts`) [FR-001, FR-002, FR-081]
- [x] T011 `eventguard` accepts and bounds the `autopilot` event (`n` 0-1000, `limit` 1-1000, the technical bound of FR-021, a known reason) + test [FR-081]
- [x] T012 `src/adapters/autopilot.ts`: `AutopilotRun` (count, limit, end once, no-progress counter), `AUTOPILOT_ANSWER`,
  `goalText`, `isClaudeContinuation`, `codexGoalEnd` + `scripts/test-autopilot.ts`. Test lines: stop at exactly
  `limit + 1`; a second end is ignored; a limit of 21 and of 1000 accepted, 0 and 1001 refused, none means the default of 5, and it cannot be turned off; control characters; over 4000 characters flagged, not refused; every Codex status [FR-020, FR-021, FR-030, FR-040]
- [x] T013 `package.json`: `test:autopilot` in the `npm test` list
- [x] T014 `AutopilotRun`: the backstop (a second counter and elapsed time from an injected clock, 2 hours by default, raisable, 1-168 hours, ending with `error`), and the guard that stays armed after a failed stop or clear + `scripts/test-autopilot.ts`. Test lines: the marker never comes and the run still ends; exactly at each bound; the guard interrupts a later continuation [FR-021, FR-054, SC-003]

## Phase 2: Adapters (PR `099-p2-adapters`)

- [ ] T020 Claude Code: `/goal` send, continuation count, `AskUserQuestion` auto-deny, end mapping, `/goal clear` after every
  end and on Stop, `/goal` typed by the user refused while on Autopilot; capability `{capUnit: 'usd', attachments: false, planApproval: true, verified: false}`.
  Tests on the scripted CLI fake replay the probe's message shapes (`Stop hook feedback`, `aborted_streaming`, `Goal cleared`,
  `stop-hook-block-cap` before a `success` result ends with blocked)
  [FR-011, FR-020, FR-021, FR-030, FR-040, FR-041, FR-050, FR-058]
- [ ] T021 Codex: `thread/goal/set` in place of `turn/start`, `tokenBudget`, the `turn/started` count, the `goal/updated` mapping,
  Stop with `goal/clear` and then `turn/interrupt`, `requestUserInput` auto-answer, never on an ephemeral thread; capability
  `{capUnit: 'tokens', attachments: false, planApproval: false, verified: false}`. Tests on the app-server fake replay the probe's notifications [FR-012, FR-020-FR-022, FR-030, FR-040, FR-050]
- [x] T022 Copilot on the fake SDK: `mode.set autopilot` and `interactive`, `agentMode`, `onUserInputRequest` auto-answer,
  elicitation declined, `task_complete` and objective mapping, a cap below 30 raised to 30 and `cancel` on exhausted, Stop
  order, attachments sent with `agentMode`, the broker still answering permissions (no `setApproveAll`); capability
  `{capUnit: 'aiu', attachments: true, planApproval: true, verified: false}`. Continuations counted from `isAutopilotContinuation` behind a small
  function (T090)
  [FR-010, FR-020-FR-022, FR-030, FR-040, FR-050]
- [ ] T023 [P] FR-006: an app entering its own autopilot or goal without Durbar is switched back and said in the chat, for each
  adapter + tests [FR-006]
- [ ] T024 Clear first on every resume and relaunch (Codex mode-switch relaunch and Claude `--resume` included), before anything is sent. Fake adapter tests per app: the clear comes first in the recorded order; a failed clear sends nothing [FR-005, FR-052, FR-053]
- [ ] T025 A stop or clear that fails: RPC error, dead child, `/goal clear` not acknowledged. Fake adapter tests per app: the guard interrupts a later continuation, the session is ended after the wait, the chat says so, the next message clears first [FR-041, FR-050, FR-054]
- [ ] T026 Feed the backstop per app, and tell a typed Codex message from a continuation by its `turn/start` id. Fake adapter tests per app with the marker removed: the run ends with `error`; Claude's `num_turns` over the bound reports `error`, not done; Codex: a typed message is not counted, a `turn/started` before its reply is held, a failed reply counts [FR-020, FR-021, FR-040, FR-058]
- [ ] T027 Cap scope per app: the lower wins, a higher value never loosens, a value at or below what was spent is refused, restored after every end (a failed restore leaves the tighter cap), a cap change during a run follows FR-022, nothing reaches `store.setMaxAiCredits`. Fake adapter tests [FR-022]
- [ ] T028 Helpers: helper and sub-agent events do not count toward either bound, a helper gets no goal and no `autopilot` state, a new session opened from this one is not on Autopilot. Fake adapter test [FR-008]

## Phase 3: Main and window (PR `099-p3-ui`)

- [ ] T030 `agents:setAutopilot` (`fromApp`), validation, capability and organization checks, `nativeConfirm` through an injected `confirm` with text written in main (merge `main` first: #931), then `setModeOp('allow')` from Read-only or Ask first,
  `setModeOp` to Read-only or Ask first ends Autopilot first, nothing saved, activity log lines; IPC tests: not from the app
  refused, from Read-only and Ask first the dialog says the folder becomes Allow all and the folder is unchanged until it is accepted, a limit above 20 or hours above 2 carry the warning, Cancel changes nothing, the MCP tools and remote control have no path, a restart or resume comes back in `allow` [FR-002-FR-005, FR-051, FR-052, FR-055, FR-070, D12]
- [ ] T031 No progress: the fingerprint at each continuation through the spec 063 runner (read-only), and the end after two
  unchanged ones + tests with a fake runner [FR-023]
- [ ] T032 While T096 is held: a scheduled prompt or a loop's pass that is due for a session on Autopilot is not sent, and the run log says why; a stored `autopilot` on a schedule is refused + test [FR-004, FR-083, FR-084]
- [ ] T033 Renderer: the mode-menu item (in every mode), the settings form (limit field with its warning above 20, hours field with its warning above 2, optional cap, what the cap counts, no-cap sentence), the remembered `autopilotLimit` setting. The native dialog itself is T030 [FR-002, FR-003, FR-022, FR-055, S1]
- [ ] T034 Renderer: the chip with its glyph and `n/limit`, the desk line, the List column, the needs-me sorting after a
  non-done end [FR-056]
- [ ] T035 Renderer: the chat lines, the question card *Decided by itself*, the end card with *Run again on Autopilot…*, the
  composer placeholder, the attach button hidden with its tooltip where `autopilot.attachments` is false; the dialog's
  cap-raised-to-30 line for Copilot [FR-022, FR-055, FR-057, FR-058, S4, D9, D10]
- [ ] T036 Simulator: the capability on every kind, the run with 2 continuations, the `?sim=autopilot-<reason>` scripts [FR-080]
- [ ] T037 Driver `scripts/check-autopilot.js` at 1440x900 and 1280x800, with 15 agents: menu, dialog, chip, every end reason,
  no text under 10.5px; screenshots `docs/screenshots/099-autopilot-*` in `DOC_SHOTS` [SC-001, FR-056]
- [ ] T038 README Safety model, mode-menu sentence, *What Durbar does not do*, *Costs and caps*; changelog fragment [FR-090]
- [ ] T039 Remote control: `agents:setAutopilot` and the plan answer refused while remote control is on; `setRemote` refused while on Autopilot. IPC tests for both directions [FR-007]

- [ ] T095 Main validates every `autopilot` event and `question.autoAnswered` with `eventguard` before use, and drops a bad one with a masked log line; test on a stand-in with a bad event from a fake adapter [FR-082]
- [ ] T098 Stop, and only Stop, from remote or phone controls: a Stop-only path to FR-050, nothing else accepted from it, the window's Stop unchanged; IPC tests. No such control exists today, so its shape needs its own design first [FR-009, D13]
- [ ] T099 The native dialog warns past 3 sessions on Autopilot at once (proposed), and can always be accepted; IPC test with an injected `confirm` [FR-072, D13]
- [ ] T096 **Held** for the three owners' decision (Vikram's ruling, 2026-10-31 19:02 UTC, pending the other two owners, because it reverses D4 and constitution III; spec *Changes*); until then T032 applies. A scheduled prompt runs in its schedule's mode, leaving the goal mode for that turn and returning after; where the adapter cannot switch, not sent, with a visible reason and a `[KNOWN GAP]`. Fake adapter test for both outcomes after a done ending. Needs spec 044 T140 [FR-083]
- [ ] T097 **Held** for the three owners' decision (Vikram's ruling, 2026-10-31 19:02 UTC, pending the other two owners, because it reverses D4 and constitution III; spec *Changes*, Q-A; D13 for the warning that shows the cap or "no cap" and the end reason on the row). Autopilot on a schedule: one run per due time with the limit, optional cap, visible state and Stop; `skipped-busy` while one runs; the session returns to what it was; not offered without the capability, refused when stored. Fake adapter and simulator tests; 0 credits; a real run is `real:` to do, `[KNOWN GAP]`. Needs spec 044 T140, T141 [FR-084]

## Phase 4: Plan first (PR `099-p4-plan`)

- [ ] T040 Plan card button and form, focus staying on plain Approve; Copilot `selectedAction: 'autopilot'`, Claude bypass and the plan goal; not offered for Codex while `planApproval` is false (its goal objective waits for T092); the run and its counter start at the plan answer; hidden in Read-only and Ask first; tests in `scripts/test-plan-mode.ts`; screenshot [FR-060]
- [ ] T041 Spec 066 FR-003 and *Constitution* text updated to match what was built, and the spec 066 delta ticked [FR-060]
- [ ] T042 `agents:resolvePlan` takes `approve-autopilot`, validated in main: capability, organization policy, mode `allow`, remote control off, settings, the native confirmation. IPC tests: each refusal and a Cancel leave the plan unanswered [FR-060, spec 066 FR-007]

## Real checks (D7 budget; one tiny task each, results under `## Changes`)

- [x] T090 **Copilot** (D11: cap 30 AI credits, the runtime minimum), one tiny task on the cheapest model through the SDK the
  way the adapter uses it (nothing is built yet). Done 2026-10-31, 0.434 AI credits: `onPermissionRequest` is called in
  autopilot (no auto-deny), attachments are accepted, `session.task_complete` ends it, the mode stays `autopilot`. Not seen
  in T090: a continuation, `ask_user`, Stop mid-run (T093 then saw all three). Plan approval with `autopilot` is still `[KNOWN GAP]` (FR-060)
- [ ] T091 **Claude Code** through the built adapter: one run to done, one to the limit (limit 1), one cap in the middle of a goal
  (`--max-budget-usd` 0.02); a multi-line condition; `/goal clear` with no goal set, and whether `--resume` brings a goal back [FR-005, FR-011, FR-021, FR-022, FR-053]
- [ ] T092 **Codex** through the built adapter: one run to done, one to the limit (limit 1), one to `budgetLimited`; a model
  switch between runs; a `turn/start` during a goal turn; `thread/goal/clear` with no goal set, and whether `thread/resume` brings a goal back; whether goal turns after a `plan` turn run in `default` (only then `planApproval` may become true) [FR-005, FR-012, FR-021, FR-022, FR-053, FR-058, FR-060]
- [x] T093 **Longer probes on all three apps** (owner OK, Vikram, Telegram, 2026-10-31 11:11 UTC; Copilot cap 30): a staged task
  with a question, to done, then a run stopped at limit 1, through the SDK, CLI and app-server the way the adapters use them
  (nothing is built yet). Done 2026-10-31, 1.626 AI credits, $0.0228, 65,827 Codex tokens: Copilot `isAutopilotContinuation`
  and `ask_user` seen, Stop quiet; Claude's `stop-hook-block-cap`; Codex `blocked` [FR-010, FR-020, FR-021, FR-030, FR-040,
  FR-050]
- [ ] T094 **Copilot** through the built adapter (needs a new owner OK, cap 30): a run to done, one to the limit (limit 1), and
  one with `ask_user`; whether a resumed session comes back in `autopilot` [FR-005, FR-010, FR-020, FR-021, FR-030, FR-050, FR-053]

# Tasks: MCP servers in a session (spec 058, issue #349)

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md). Delta 2026-10-20 (issue
#364, MCP OAuth sign-in): Phase 8.
**Clarified**: the owner answered Q1-Q11 on 2026-10-20, option A for each (spec.md *Clarifications*). A task that rests on an answer
names it.
**Format**: `[ID] [P?] [Story] Description [FR]`. `[P]` = can run in parallel (different files, no dependency). Each task is one
small PR-sized step with its own test. No task spends AI credits except Phase 6, which needs the owner's go-ahead.

## Phase 0: Clarify (owner)

- [x] T001 Owner answers Q1-Q11 in spec.md; record the answers under spec.md `## Clarifications` and adjust the tasks below (2026-10-20,
  all A)

## Phase 1: Foundation (blocking)

- [ ] T010 [P] Capability fields `mcpStart`, `mcpToggleApplies`, `mcpRestart`, `mcpLogs` and optional members `restartMcpServer`,
  `mcpLogFolder` in `src/adapters/capabilities.ts` / `types.ts`; `McpServerStatus.errorClass` / `needsRestart`; contract C2 lines in
  `scripts/test-adapter-contract.ts`; `fake.ts` members behind its capability switches [FR-010, FR-011, FR-012, FR-013]
- [ ] T011 [P] `src/renderer/mcpwords.js` (UMD): state words and icons, start line, toggle timing, hints; `scripts/test-mcpwords.ts`
  (`test:mcpwords` in `test:serial`) covering every state, unknown tokens and every hint rule, including the sign-in hint that names
  the agent app's own sign-in without running it [FR-001, FR-002, FR-006, FR-052]
- [x] T012 [P] `maskMcpError(text, secretValues)` in `src/shared/redact.ts` (redact with the given values and the env, then URL
  credentials, cut to 300); cases in the redact tests: an extra's header value, an env value, `ghp_` token, `https://user:pass@host`
  [FR-005] (note 2026-10-21: built under spec 019 T013, #360/#362, as `maskMcpError` in `src/main/mcpmask.ts:23` with the cases in
  `scripts/test-mcp-errormask.ts`, not in `redact.ts`)

## Phase 2: User Story 1 + 2, words and errors (P1, MVP)

- [ ] T020 [US1] `agents:mcp` reply adds `app`, `start`, `toggleApplies`, `canRestartSession` (false until T040), per-server
  `errorClass`, `needsRestart`, `canRestart` (false until T030/T031), `logFolder` (false until T050); `AgentMcpEntry` in
  `src/shared/api.ts`; test in new `scripts/test-mcp-session.ts` (`test:mcpsession`) [FR-020]
- [x] T021 [US2] `agents:mcp` masks `error` with `maskMcpError` and the secret values of the extras passed to that agent's session
  (`McpStore.forSession`); test that no secret reaches the reply [FR-005, SC-002] (done 2026-10-21, #349: the reply is built by
  `agentMcpReply` in `src/main/mcpsession.ts`; the test is in `scripts/test-mcp-session.ts`)
- [ ] T022 [P] [US2] Copilot mapper: `errorClassification` (known values only) -> `errorClass`, `session.mcp_server_needs_reconnect` ->
  `needsRestart`; mapper test [FR-011] (note 2026-10-23: the `errorClassification` part is built with T144 for issue #603,
  `copilotErrorClass`; `needs_reconnect` -> `needsRestart` is still open)
- [x] T023 [P] [US2] Codex: `failureReason: reauthenticationRequired` and `authStatus: notLoggedIn` -> `errorClass: 'auth'`; test in
  `test-codex-adapter` [FR-011] (note 2026-10-21: done as part of T095 for #364; tick both there)
  [IMPLEMENTED] with T095 below
- [x] T024 [P] [US2] Claude mapper: `init.mcp_server_errors` -> `failed` rows with their text; mapper test [FR-011]
  (note 2026-10-23: built with T144 for issue #603, `claudeMcpServerErrors` with `errorClass: 'config'`, kept in later `mcp_status` lists)
- [x] T025 [P] [US1] Capability values in the three adapters: Copilot `session`/`live`, Claude `next-message`/`live`, Codex
  `session`/`next-message` (restart and logs stay false here); contract test [FR-010] (done 2026-10-21, #349, with T030/T031: `mcpRestart`
  is true for Copilot and Claude (not on Claude's dev-only SDK transport), false for Codex; `mcpLogs` waits for T050)
- [ ] T026 [US1] Dialog rows: word + icon, hint, *Details* with *Copy*, start line and toggle timing, the two scopes sentence; the
  "applies right away" text only for `live`; `index.html` loads `mcpwords.js` [FR-001, FR-002, FR-003, FR-007, FR-030, FR-033]
- [ ] T027 [US1] Live refresh: when an `mcp` event for the open agent arrives (`app.js`, where `a.mcp` is set), re-render the list and
  keep focus by server name; replaces `repaint`'s 1.5 s re-read after a Restart (`screens.js`, #473) [FR-004]
- [ ] T028 [US1] Simulator: real capability values per kind (Claude and Codex `mcpToggle: true`), servers in every state, a failed one
  with a canned error and hint [FR-040]
- [ ] T029 [US1] Screenshot driver `scripts/shots-058-mcp.js` (Copilot, Claude, Codex dialogs; prints `[058] PASS`); run at 1440x900
  and 1280x800; commit `docs/screenshots/058-mcp-*.png` [FR-042]

## Phase 3: User Story 3, per-server Restart (P2)

- [x] T030 [P] [US3] Copilot `restartMcpServer`: `rpc.mcp.restartServer({serverName})` when present, else `disable` then `enable`
  (Q3); never `stopServer` (Q2) or `reload`; not live rejects; fake SDK gains `restartServer` and a mode without it; adapter test
  [FR-012, SC-003]
- [x] T031 [P] [US3] Claude `restartMcpServer`: control request `mcp_reconnect {serverName}` then `mcp_status` and an `mcp` event; a
  server off at launch rejects with "Switch it on first; it starts with your next message"; not live rejects; fake CLI test [FR-012,
  SC-003]
- [x] T032 [US3] `agents:mcpRestart(id, name)` in main: validation, one restart per server at a time, masked error, activity-log row;
  preload and `DurbarApi`; `canRestart` in `agents:mcp`; test in `test-mcp-session` [FR-020, FR-021]
- [x] T033 [US3] Dialog: *Restart* per row (only `canRestart`, live, switch on), "Restarting…" disabled state, toast with the result;
  Codex footer line [FR-030, FR-031, FR-032]
- [x] T034 [US3] Simulator: canned Restart (Starting -> Running) for Copilot and Claude sim kinds; refresh screenshots [FR-040, FR-042]
  (done 2026-10-21, #349: `scripts/shots-058-mcp-restart.js` in the UI suite; `docs/screenshots/058-mcp-restart-*.png`)

## Phase 4: User Story 4, Restart session with these servers (P2)

- [x] T040 [US4] Extract `endSession(a)` in main (remote off, `adapter.stop`) and use it in `agents:end`; no behaviour change; existing
  tests pass [FR-022]. Review on #473: the pure `endSessionOp` in `agentops.ts` (also used by `agents:remove`) with an order test in
  `test-mcp-session`
- [x] T041 [US4] `agents:mcpRestartSession(id, confirmed)`: validation, `resume` capability, busy check from main's `agentState`
  (`needsConfirm`), `endSession` then `ensureLive` with the same id and current options, no prompt; preload and `DurbarApi`;
  `canRestartSession`; test with a fake adapter: order, same id, new `mcpServers`/`disabledMcpServers`, refusal while busy, failed resume
  leaves the agent ended (Q4) [FR-022, SC-004]
- [x] T042 [US4] Dialog footer button and the confirmation text (Cancel focused) when working/thinking/waiting, grants or remote on;
  after the restart the dialog refreshes; Claude line "servers start with your next message" (Q11) [FR-023, FR-030]
- [x] T043 [US4] Simulator: canned Restart session; screenshots of the confirmation [FR-040, FR-042]
- [x] T044 [US4] Sign-in on Restart session (review note 2): a resume that fails for sign-in returns `errorKind: 'auth'`, marks the app
  signed out and the renderer shows spec 012 FR-157's sign-in card in the chat instead of a toast; `simauth=expired` makes the simulator
  fail the restart that way; test in `test-mcp-session` (auth error vs other error) [FR-027, FR-040, FR-041]

**Note 2026-10-21 (#349, Vikram's agent; split agreed with Paco's agent on #349 and #364).** Built: T030-T034 and T040-T044, plus T021's
reply test and T025. Of T010 only `mcpStart`, `mcpToggleApplies`, `mcpRestart` and `restartMcpServer` (C2 line in the contract test,
fake member `restartMcpServer` with `restartCalls` / `failRestart`); `errorClass` comes with #364's T112, `needsRestart` with T022,
`mcpLogs` / `mcpLogFolder` with T050-T051. Of T020 only `start`, `toggleApplies`, `canRestartSession` and per-server `canRestart`;
`app` and `errorClass` come with #364's T114. Of T028 only the capability values (Claude and Codex `mcpToggle: true`, the 058 fields)
and one failed server (sim-6 `my-notes`); the hint waits for T113. How it was built:
- main: `src/main/mcpsession.ts` (pure: `agentMcpReply`, `mcpRestartOp`, `mcpRestartSessionOp`); `agents:mcpRestart` registered in
  `mcpipc.ts` next to `agents:mcp`; `agents:mcpRestartSession` in `src/main/ipc/agents.ts` next to `agents:end`, which now shares
  `endSession` (T040). Restart session resumes through `ensureLive(a, { quiet: false })`, the same path a message takes, so the start
  options (`startOptionsFor`, with this agent's MCP set) are the current ones; the unit test checks the order, the same id, no prompt,
  the refusals and the failure paths with a stubbed resume, not the option values themselves (those come from `main.ts`).
- Activity log: a new decision `mcp-restart` ("MCP restart") for "MCP server <name> restarted" and "Session restarted with the current
  MCP servers" (no error text).
- Dialog: *Restart* sits before the switch; *Restart session with these servers* is a button under the list, not in the dialog's button
  row, so the dialog stays open and refreshes after it (FR-030 said footer). Until T027 (live refresh, #364) the dialog re-reads the
  list after each call and once more 1.5 s after a Restart. The FR-023 confirmation uses the shared `askDialog` (Cancel focused).
- Not checked on a real account (FR-050): Copilot `restartServer`, Claude `mcp_reconnect`, and a resume with a changed server set.

## Phase 5: User Story 5, Open log folder (P3)

- [ ] T050 [P] [US5] `src/adapters/mcplogdirs.ts` (pure, injected env and platform): Copilot, Claude per server (Q6), Codex (Q7);
  `scripts/test-mcplogdirs.ts` for Linux, macOS and Windows with `COPILOT_HOME`, `CODEX_HOME`, `XDG_CACHE_HOME`, `LOCALAPPDATA`, long
  names -> undefined [FR-013]
- [ ] T051 [US5] `mcpLogFolder` on the three adapters (returns `{root, folder}`) and the `mcpLogs` capability values; contract C2 lines
  [FR-010, FR-013]
- [ ] T054 [P] [US5] `insideRoot(realRoot, realFolder, pathImpl)` (pure) and the realpath step in main (review note 1); tests: symlink out
  of the root (real temp folders on POSIX), `..` in a server name, other Windows drive (`path.win32`), missing root, the normal case
  [FR-026, FR-041]
- [ ] T052 [US5] `agents:mcpRevealLogs(id, name?)`: folder from the adapter, the FR-026 check (T054), `fs.stat` directory check,
  `shell.showItemInFolder`; never
  lists or reads files; `logFolder` flags in `agents:mcp`; test with an injected `shell` and fs [FR-020, FR-024, FR-025]
- [ ] T053 [US5] Dialog: *Open log folder* in the footer (session folders) and in a row's *Details* (per-server folders), worded as "the
  agent app's log folder" with no promise of server output, Claude's link labelled "not documented by Anthropic" (Q6); simulator toast [FR-030, FR-040, FR-051]

## Phase 6: Real checks (needs-owner-approval at the time of the run, Q9; 0 AI credits, no prompt)

Each: a throw-away folder, a throw-away local stdio echo server as a folder extra, Ask first mode, **no prompt sent**. Record results in
research.md and change `read:` to `real:` where confirmed. Do not open or paste log files.

- [x] T060 [needs-owner-approval] Copilot: session starts with the server Running; *Restart* (does `restartServer` exist on the pinned
  runtime, does the row go Starting -> Running); a server with a wrong command shows Failed with its text and `errorClassification`
  value; *Restart session* keeps the id and history; does `~/.copilot/logs` exist [FR-050]
  (done 2026-10-21, real, SDK/runtime 1.0.22, Linux, owner's go-ahead, 2 prompts; spec *Changes* "real Copilot check": servers start
  with the first message, not at create, so Copilot's `mcpStart` is now `next-message`; `restartServer` exists and was used, no
  fallback, `not_configured` -> `pending` -> `connected`; wrong command `failed`, `errorClassification: "os_not_found"`; its restart
  error now without the SDK's prefix; Restart session kept the id and history and the next message started the new server set;
  `~/.copilot/logs` exists)
- [ ] T061 [needs-owner-approval] (not run 2026-10-21: the Copilot check T060 was done first) Claude Code: the CLI is launched only with a message, so: start, then Restart session (expect "Not
  started yet" until the next message, Q11); with an already launched CLI from an earlier spec 012 check, `mcp_reconnect` on a failed
  server; does `mcp-logs-<server>` exist [FR-050]
- [ ] T062 [needs-owner-approval] Codex: list states and `failureReason` for a wrong command; *Restart session* keeps the thread; does
  `~/.codex/log` exist and is anything from the app-server in it (folder listing only by the owner, not by Durbar) [FR-050]
- [ ] T063 Converge: README, spec status and `[KNOWN GAP]` tags after T060-T062

## Phase 7: Docs and close

- [ ] T070 README MCP section: the dialog's words, Restart (Copilot, Claude), Restart session, Open log folder, "not checked on a real
  account yet"; CHANGELOG *Unreleased* line; specs index row; spec 019 `## Changes` note updated from "specified" to "built"
- [ ] T071 `/speckit-converge`: spec, plan and tasks match what was built; tick tasks

## Phase 8: MCP OAuth sign-in (delta 2026-10-20, issue #364)

Spec *Changes* > 2026-10-20 (FR-060..FR-074). Phase 8a needs no owner answer; Phase 8b needed T090 (done 2026-10-20); Phase 8c needs the owner's go-ahead
at the time of the run. Builds on T010 (`errorClass`), T011 (words), T020 (`agents:mcp` fields) and T026 (dialog rows).

**Note 2026-10-21 (analysis for #364 on `main` 6f918af; tasks only, no FR changed).** None of T010, T011, T020, T026 or T027 is built:
`McpServerStatus` has no `errorClass` (`src/adapters/types.ts:255`), there is no `src/renderer/mcpwords.js`, `AgentMcpEntry` is
`{name, origin, status?, error?, defaultOn, off}` (`src/shared/api.ts:390`), and the dialog prints the raw status token with no hint,
*Details* or live refresh (`src/renderer/screens.js:645-667`). Built elsewhere: T012's masking is `maskMcpError` in
`src/main/mcpmask.ts:23` (spec 019 T013, #360/#362; not in `redact.ts`), and `agents:mcp` already masks `error` with the session's values
(`src/main/mcpipc.ts:152`, T021's code; its reply test is still missing). So #364 does not wait for all of #349: it needs only T112-T115
below, split out of T010/T011/T020/T026 (+ T027 whole). The rest of those tasks stays with #349 and builds on these. Stale line
references: `src/main/main.ts:123` is now `main.ts:142` (`outward`); `src/adapters/codex.ts:829-835` (spec, research) is now
`codex.ts:953-959`.

#### Prerequisites for #364 (subset of Phases 1-2; the remainder of T010, T011, T020, T026 follows in #349)

- [x] T112 [P] Subset of T010: only `McpServerStatus.errorClass?` (FR-011's values); no `needsRestart`, no new capability fields, no
  `restartMcpServer` / `mcpLogFolder`. Same PR as T093 (types and contract C2 together) [FR-011, FR-060]
  [IMPLEMENTED] `McpServerStatus.errorClass?` in `src/adapters/types.ts` (PR #473 does not define it). test: `scripts/test-adapter-contract.ts` (type-checked; no adapter sets it yet, mappers are T094-T096)
- [x] T113 [P] Subset of T011: `src/renderer/mcpwords.js` (UMD) with the word and icon for every state and unknown tokens, and the hints
  for `failed` and `needs-auth` (the sign-in hint names the agent app, FR-052/FR-069); `scripts/test-mcpwords.ts` (`test:mcpwords` in
  `test:serial`). Start line and toggle timing wait for T010's capability fields (#349) [FR-001, FR-006, FR-052]
  [IMPLEMENTED] `src/renderer/mcpwords.js` (`stateOf`, `iconSvg`, `hintFor`; icon shapes, an unknown token named as plain text and cut at 40), `test:` `scripts/test-mcpwords.ts` (`test:mcpwords`, in `test:serial`). The hint says "This server needs you to sign in. <App> keeps the sign-in; Agent Durbar never sees it." for needs-auth (or failed with class auth), picks from `errorClass` first and then from the masked text for failed rows, and says nothing when it cannot tell.
- [x] T114 Subset of T020: `agents:mcp` adds per agent the agent app's display name (`app`) and per server `errorClass`; `AgentMcpEntry`
  in `src/shared/api.ts`. Extend `agentMcpReply` (`src/main/mcpsession.ts`, built by #473) and its existing test in
  `scripts/test-mcp-session.ts` (`test:mcpsession`; T021's reply test, masking included, is already there) [FR-020, FR-005]
  [IMPLEMENTED] `agentMcpReply` adds `app` (the adapter's `displayName`) and per server `errorClass` only when the adapter set it; `AgentMcpReply.app`, `AgentMcpEntry.errorClass` in `src/shared/api.ts`. `test:` `scripts/test-mcp-session.ts` (a needs-auth server with a secret in its text, no `errorClass` unless set, no adapter = no name).
- [x] T115 Subset of T026, plus T027 whole: rows show word + icon (T113) and the hint, *Details* with *Copy* for the masked error;
  `index.html` loads `mcpwords.js`; live refresh of the open dialog on an `mcp` event for that agent, focus kept by server name (T027;
  it replaces `repaint`'s 1.5 s re-read after a Restart in `screens.js`, #473, and reuses `repaint` for the focus);
  simulator: the existing needs-auth and failed rows (`src/renderer/sim.ts:514`) get a canned error; screenshots at 1440x900 and
  1280x800. Start line, toggle timing and the two scopes sentence stay in T026 (#349) [FR-001, FR-002, FR-004, FR-030]
  [IMPLEMENTED] `sim:` `scripts/shots-058-mcp-words.js` (in `check:ui`), shots `docs/screenshots/058-mcp-words-*`. Rows show the word and icon, the hint, *Details* (open state kept over repaints) with *Copy* (the masked text only); an `mcp` event for the agent repaints the open dialog after 150 ms (several events = one repaint), keeps the focus by server name (a closed *Details* falls back to the switch) and the scroll position, and says what changed through `#srAnnounce`; the 1.5 s re-read after Restart is gone. The simulator now keeps the last `mcp` event per session (as main's `live`), gives sim agents 5, 10 and 15 a `my-notes` that needs a sign-in (`errorClass: 'auth'`), and emits `mcp` events at the start and end of a canned Restart. `real:` (T060, spec *Changes* 2026-10-21) a real Copilot Restart was followed by `session.mcp_server_removed`, then `status_changed` `not_configured` -> `pending` -> `connected` within about 75 ms, so the dialog can rely on those events instead of the old 1.5 s re-read; `[KNOWN GAP]` that was seen on the adapter's event stream, not with this dialog open on a real account, Claude's restart events are tested on the fake CLI only, and the dialog is not checked against a real runtime event stream, and Copy is checked with a stubbed clipboard (the text written equals the shown error; mutation-checked), not with a real clipboard on macOS or Windows. The announcement, the one-repaint throttle, the 120-character tooltips and the Details/needs-sign-in view in `check:ui-text` (surfaces `agent-mcp-signin`, `agent-mcp-failed`) are asserted and were each mutation-checked (review on #538).
- [x] T117 (issue #544) The MCP dialog's footer never overlaps a long list (body scrolls inside `.dlg.wide`), and a runtime-`disabled` server reads
  who turned it off, with its switch off and disabled and a hint [FR-077, FR-078]
  [IMPLEMENTED] `src/renderer/screens.css` (`.dlg.wide` body scrolls), `mcpwords.js` (`offBy`, `stateOf` context), `screens.js`; `sim:` the simulator keeps a reported list over a switch (`mcpAppOff`). `test:` `scripts/test-mcpwords.ts`; `sim:` `scripts/shots-058-mcp-words.js` (14+ servers at 1440x900, 1280x800, 1280x600; before/after `docs/screenshots/058-mcp-dialog-fit-*`). `[KNOWN GAP]` not seen on a real agent app.
- [x] T118 (issue #544, second report) The MCP dialog's footer is an opaque separate layer above the scrolling body, so a repaint after a switch toggle never puts a row or switch over *Done* [FR-077a]
  [IMPLEMENTED] `src/renderer/screens.css`; `sim:` `scripts/shots-058-mcp-words.js` (toggle the last row off and on at 1440x900, 1280x800, 1280x600: *Done* hit-tested at centre and corners, no element meets the footer; mutation checked), shots `docs/screenshots/058-mcp-dialog-toggle-*`.

#### PR sequence for #364 (each PR ticks its tasks and updates docs; `npm run typecheck && npm run build && npm test`)

1. T091 + T092 + T097: no prerequisite, no UI. Stops the false app sign-in card for the issue's text and masks failed MCP tool cards.
2. T112 + T093: types, contract C2, fake.
3. T094, T095 (folds T023 in), T096: one PR per adapter (owner, 2026-10-21).
4. T113 + T114 + T115: the dialog shows "Needs sign-in" with its hint and *Details*; simulator screenshots. After PRs 1-4 a 401 / OAuth
   challenge reads as needs-auth in the MCP dialog.
5. T098 + T099 + T100: the adapters' `startMcpSignIn` and Copilot `persistent` storage, on the fakes; one PR per adapter (owner, 2026-10-21).
6. T101: main store, IPC, preload, `DurbarApi`.
7. T102 + T110 + T104 (dialog part): Sign in, two-step open, origin tag, terminal steps, Switch off; screenshots.
8. T103 + T111 + T104 (card part) + T108: tool card line, keychain sentence, README, CHANGELOG, specs index.
9. T105-T107 (8c) run on the owner's Mac with a remote OAuth MCP server he chooses, one adapter at a time, after PRs 5-8 merge (owner,
   2026-10-21; still needs his go-ahead at the time); then T109.

**Owner's answers, 2026-10-21 ("Ok todo").** (1) Until T040-T042 (Restart session, #349) exist, the manual steps (T102, T110 texts, FR-068)
say "End this session (More > End session), then send a message to resume it"; they switch to the Restart button once T040-T042 are built.
(2) One PR per adapter for steps 3 and 5. (3) Phase 8c as in step 9. (4) T112-T115 are tracked under #364, with a comment on #349.

### Phase 8a: clarify, signals, classifier, masking (only T090 needs the owner; T091-T097 do not wait for it)

- [x] T090 Owner answers Q12-Q19 (spec *Changes*, open questions); record them under spec.md `## Clarifications` and adjust T098-T104
  (2026-10-20: Q12 B, Q13-Q19 A)
- [x] T091 [P] `src/adapters/mcpauth.ts` `isMcpAuthChallenge(text)`; `scripts/test-mcpauth.ts` (`test:mcpauth` in `test:serial`): the
  issue's exact text, the runtime phrases of research 7.2, negatives (model text, a usage limit, the app's own 401) [FR-061]
- [x] T092 [P] `isAuthError` returns false when `isMcpAuthChallenge` matches; cases in `scripts/test-autherrors.ts` (the issue's text as
  an `error` status gets no `errorKind: 'auth'`) [FR-062, SC-010]
- [x] T093 [P] Types: `mcpSignIn`, `mcpSignInSteps`, `startMcpSignIn?`, `cancelMcpSignIn?`, `ToolCallEvent.mcpAuth`; event guard (only
  on a failed `toolCall` with `mcpServer`); contract C2 lines; `fake.ts` members behind the flags [FR-063, FR-064, FR-068]
  [IMPLEMENTED] types, guard (refuses `mcpAuth` unless `true` on a failed `toolCall` with a non-empty `mcpServer`), C2 lines (`startMcpSignIn` <=> `mcpSignIn`; `cancelMcpSignIn` only with it), fake (`signInCalls`, `signInResult`, omit `startMcpSignIn` / `cancelMcpSignIn`). test: `scripts/test-adapter-contract.ts` (guard cases, mutation-checked; fake-signin setup). No adapter sets the flags yet
- [x] T094 [P] Copilot mapper: a failed MCP tool with challenge text -> `mcpAuth: true` and that server `needs-auth` + `errorClass:
  'auth'` (emit `mcp`); the next status replaces it; `remediation` ignored; mapper test with the issue's text [FR-060, FR-063, SC-010]
  [IMPLEMENTED] `src/adapters/map.ts` (`tool.execution_complete`): failed + `mcpServer` + `isMcpAuthChallenge` -> `mcpAuth: true`, row `needs-auth`/`errorClass: 'auth'` (created if absent), one `mcp` event; `status_changed`/`servers_loaded` replace it; `remediation` not read. test: `scripts/test-events.ts` (issue #364 text; negatives: built-in tool with same text, MCP failure with other text)
- [x] T095 [P] Codex: `failureReason: reauthenticationRequired` -> `needs-auth` + `errorClass: 'auth'` (extends T023, which this
  task now includes: also `authStatus: notLoggedIn` -> `errorClass: 'auth'`; the notification is read at `src/adapters/codex.ts:953-959`); a
  failed MCP tool with challenge text -> `mcpAuth` and a list refresh; `test-codex-adapter` [FR-011, FR-060]
  [IMPLEMENTED] 2026-10-21: `codexMcp.ts` (list: `authStatus: notLoggedIn`, `runtimeStatus: authenticationRequired` -> `needs-auth` + `errorClass: 'auth'`), `codex.ts` (startup notification, same rule; a later plain status clears the class; `mcpAuth` on a toolCall -> the server is marked `needs-auth` at once and kept through one in-flight `refreshMcp` at a time), `codexMap.ts` (`mcpToolCall` failed with `isMcpAuthChallenge` text -> `mcpAuth: true`). test: `scripts/test-codex-adapter.ts` (list, notification, refresh, negatives), `scripts/test-codex-map.ts` (mapper positives and negatives); mutation-checked.
- [x] T096 [P] Claude: a failed `mcp__<server>__<tool>` result with challenge text -> `mcpAuth` and one `mcp_status`; mapper and fake
  CLI tests [FR-060]
  [IMPLEMENTED] `ClaudeMapper.user` sets `mcpAuth` on a failed call of a known MCP server (judged on the same first 4000 characters the classifier reads); `ClaudeAdapter.refreshMcp` sends one `mcp_status` at a time (`mcp` event); a server the challenge named reads `needs-auth` + `errorClass: 'auth'` even when the CLI still says `connected`, until init or a toggle replaces it (`mcpAuthSeen`); the classifier also knows Claude Code 2.1.304's `MCP server "<name>" needs authentication` and `<name> requires authentication. Open this session and run /mcp` (`read:` binary); `claudeMcpServers` gives `errorClass: 'auth'` to a `needs-auth` server (the CLI reports it, `read:` SDK docs; no other class is guessed). test: `scripts/test-claude-map.ts` (3b), `scripts/test-claude-adapter.ts` (fake CLI: server starts `connected`, two failures in flight, one request, list reads `needs-auth`; plain failure, non-MCP tool). Not seen on a real Claude run
- [x] T097 Main masks failed MCP tool cards (`maskMcpText`, the session's secret values, no 300 cut) in the renderer hook
  (`outward`, `src/main/main.ts:142`, next to `maskMcpEvent` in `src/main/mcpmask.ts:36`); extend the existing spec 019 test
  `scripts/test-mcp-errormask.ts` (a header value, a `ghp_` token, a URL with a key, and the wiring check for `toolCall`) [FR-067, SC-011]

### Phase 8b: Sign in, steps and shortcut (after T090)

- [x] T098 [P] Copilot `startMcpSignIn`: `rpc.mcp.oauth.login({serverName, clientName, callbackSuccessMessage})` when it is a function,
  else manual; no URL -> connected; `mcpOAuthTokenStorage: 'persistent'` on create and resume (Q12 B: in the shared `config` of `src/adapters/copilot.ts:576-577`, so
  the FR-158 reconnect at `copilot.ts:337` keeps it; not in `oneShotConfig` or `renameResumeConfig`); fake SDK: recorder, no-method mode, no-URL mode, asserts no
  `handlePendingRequest` and no `onMcpAuthRequest` [FR-064, FR-070, SC-012]
  [IMPLEMENTED] 2026-10-23 (Copilot; FR-070 by #471): `startMcpSignIn` + `mcpSignIn`/`mcpSignInSteps` in `src/adapters/copilot.ts`; fake SDK recorder in `scripts/fakes/copilot-sdk.ts`; test: `scripts/test-mcp-session.ts`. Not run on a real account (T105)
- T099 (Claude Code `startMcpSignIn`) moved to Phase 11 on 2026-10-23, refined by FR-175/FR-176; its checkbox is there.
- T100 (Codex `startMcpSignIn`) moved to Phase 11 on 2026-10-23, refined by FR-177/FR-178 (no `account/login/cancel`); its checkbox is there.
- [x] T101 Main: `src/main/mcpsignin.ts` (pure store, injected clock and opener) and `agents:mcpSignIn` / `agents:mcpOpenSignIn` /
  `agents:mcpCancelSignIn`; `elicitHttpsUrl` check (Q16); host-only replies; drops on connected, Cancel, 10 minutes, End, Restart
  session (the Restart session hook waits for T040/T041, #349, not built on 2026-10-21); `canSignIn`, `signIn`, `signInSteps` in `agents:mcp`; preload and `DurbarApi`; tests: host only, `http:` and user:password
  refused, expiry, Cancel, End, no address in the `DURBAR_LOG` sink or activity log [FR-065, SC-011]
  [IMPLEMENTED] 2026-10-23: `src/main/mcpsignin.ts`, `src/main/mcpipc.ts`, `src/main/mcpsession.ts`, preload, `src/shared/api.ts`; test: `scripts/test-mcp-signin.ts` (`test:mcpsignin`), `test:ipcchannels`, `test:simguard`. Restart session drops the entry through the `stopped` status (#473 exists)
- [x] T102 Dialog: needs-auth row (hint, Sign in, Switch off for this session, terminal steps with Copy; the steps end with "End this session (More > End session), then send a message to resume it" until T040-T042 exist, then the Restart button), two-step open (Q13), waiting and
  time-limit states, toasts, live region; Switch off calls the existing `setMcp` [FR-066, FR-068, FR-069]
  [IMPLEMENTED] 2026-10-23 for Copilot rows (a row shows the block only where `canSignIn` or `signInSteps` came from main; Claude and Codex rows unchanged until T099/T100): `src/renderer/screens.js`, `screens.css`; sim: `scripts/shots-058-mcp-signin.js`
- [ ] T103 Tool card line for `mcpAuth`: "<server> needs you to sign in", **Sign in…** opens the dialog at that row (Q14), **Switch off
  for this session** [FR-063, FR-066]
- [x] T104 Simulator `simmcpauth=1` / `simmcpauth=manual`; screenshots at 1440x900 and 1280x800 (`docs/screenshots/058-mcp-signin-*.png`)
  [FR-071, FR-073]
  [IMPLEMENTED] 2026-10-23, dialog part, Copilot: `simmcpauth=1|manual` (+ `simmcpttl=N`) in `src/renderer/sim.ts`; `docs/screenshots/058-mcp-signin-*-{1440x900,1280x800}.png`. The tool card part waits for T103

- [x] T110 (its manual-steps wording follows T102's: End session, then a message, until T040-T042) Two-step confirm shows the server's origin tag next to the host, and the "different site" line when the registrable
  domains differ (pure helper `signInSiteNote(serverUrl, pageHost)` with unit tests: same domain, other domain, `co.uk`, stdio) [FR-075]
  [IMPLEMENTED] 2026-10-23 (review on #598): `src/main/mcpsignin.ts`, `screens.js`; `test:mcpsignin`
- [ ] T111 Trust confirmation of per-folder extras and the Copilot waiting text say a sign-in may be kept in the system keychain
  after the session [FR-076]

### Phase 8c: real checks (on the owner's Mac, one adapter at a time, after PRs 5-8; needs-owner-approval; 0 AI credits, no prompt; a remote MCP server with OAuth; a browser sign-in on the owner's machine)

Record results in research.md section 7 and change `read:` to `real:`. Do not open, copy or paste any token, keychain entry or log file.

- [ ] T105 [needs-owner-approval] Copilot: a server shows needs-auth (or the issue's tool error with a cached catalog); Sign in returns an
  `authorizationUrl` on the pinned runtime; after the browser step the row goes Running; with `persistent` storage (Q12 B), a later session and the CLI's
  `/mcp auth` share the sign-in [FR-074]
- [x] T116 Real check on CI runners (owner request 2026-10-21, `workflow_dispatch` only, 0 prompts): `scripts/demo-oauth-mcp.ts` (a demo
  MCP server that requires OAuth; unit test `scripts/test-demo-oauth-mcp.ts` in `npm test`), `scripts/mcp-oauth-real.ts` (session A
  signs in through `oauth.login` and a headless browser step; A2 in the same runtime and B in a new runtime connect with no new
  `/authorize`), workflow `.github/workflows/mcp-oauth-real.yml` on `windows-latest` and `ubuntu-latest`; results as `real:` lines in
  research.md 7.7 [FR-070, FR-074]. Done 2026-10-21: run 39680461023, PASS on `windows-latest` and `ubuntu-latest`. Review on #478
  fixed 2026-10-22 (status sequence per session, one line per file with mode bits, resource-bound demo tokens, two more tests); the
  new logging runs on the next dispatch
- [x] T160 (issue #509) Replace the free-form `oses` dispatch input with a closed choice (`both`, `windows-latest`,
  `ubuntu-latest`, `macos-latest`) mapped to a fixed GitHub-hosted runner matrix; validate the YAML and each selection locally.
  Do not dispatch the workflow; it uses the real Copilot runtime and requires owner approval.
- [ ] T106 [needs-owner-approval] Claude Code (after PR A; Q24): with a launched CLI (no prompt), `mcp_authenticate` answers an `authUrl`
  on `127.0.0.1` (docs say a `-p`/SDK run cannot sign in; 2.1.304's program says it can); after the browser step `mcp_status` says
  `connected` without a relaunch; a `claude mcp login <name>` in a terminal is seen by Durbar's `--mcp-config` copy after Restart on
  the row (same key: name, type, url, headers); a server with a pre-registered client, signed in through FR-186's copied `oauth`; what the CLI answers to a second
  `mcp_authenticate` while the first listens (FR-176) [FR-175, FR-176, FR-181, FR-184]
  **CI part** (`scripts/mcp-oauth-real.ts`, `.github/workflows/mcp-oauth-real.yml`, as T116): the demo OAuth server's authorization
  page is `http://127.0.0.1:<port>`, which main refuses by design (Q16, tightened on #598), so the check **drives the adapter's
  `startMcpSignIn` directly; main's address rule is not relaxed and not exercised here**. `workflow_dispatch` only (never
  `pull_request`), each dispatch with the owner's OK, 0 prompts. Secrets: only `ANTHROPIC_API_KEY` (the existing repository secret) in that step's env,
  if the app needs one just to launch with no prompt; whether it does is not known from the read and is the first thing the run
  records (if none: no secret). The demo tokens and the authorization address are never printed: only hosts and state words go to
  the log, as `mcp-oauth-real.ts` does today. **Mac part**: one run on the owner's Mac with a real https provider covers main's path
  (Q16 address rule, host binding, FR-075/FR-185 line, the dialog).
- [ ] T107 [needs-owner-approval] Codex (after PR B; Q24): `mcpServer/oauth/login` with `threadId` accepts a server from Durbar's
  thread override; `mcpServer/oauthLogin/completed` arrives with `loginId`; does the running thread reconnect by itself after
  `invalidate_mcp_runtimes` (then Q20 is moot), or only on a fresh child; a `codex mcp login <name>` in a terminal is seen after
  Restart session; the relaunch keeps mode and servers on a real child (FR-178) [FR-177, FR-178, FR-181, FR-184]
  **CI part** (`scripts/mcp-oauth-real.ts`, `.github/workflows/mcp-oauth-real.yml`, as T116): the demo OAuth server's authorization
  page is `http://127.0.0.1:<port>`, which main refuses by design (Q16, tightened on #598), so the check **drives the adapter's
  `startMcpSignIn` directly; main's address rule is not relaxed and not exercised here**. `workflow_dispatch` only (never
  `pull_request`), each dispatch with the owner's OK, 0 prompts. Secrets: only `OPENAI_API_KEY` (the existing repository secret, given to Codex through `codex login --with-api-key`
  on stdin, never on the command line) in that step's env,
  if the app needs one just to launch with no prompt; whether it does is not known from the read and is the first thing the run
  records (if none: no secret). The demo tokens and the authorization address are never printed: only hosts and state words go to
  the log, as `mcp-oauth-real.ts` does today. **Mac part**: one run on the owner's Mac with a real https provider covers main's path
  (Q16 address rule, host binding, FR-075/FR-185 line, the dialog).
### Phase 8d: docs and close

- [ ] T108 README MCP section (Needs sign-in, Sign in, terminal steps, Switch off for this session, "not checked on a real account yet");
  CHANGELOG *Unreleased* line; specs index row; spec 019 `[KNOWN GAP]` line from "specified" to "built" [FR-074]
- [ ] T109 `/speckit-converge` for the delta: spec, plan and tasks match what was built; tick tasks

**Note 2026-10-21 (spec *Changes* 2026-10-21; numbers unchanged).** Done ahead of the PR sequence, by agreement in the team chat
(Vikram's agent): the FR-070 part of T098 (`mcpOAuthTokenStorage: 'persistent'` on create, resume and the reconnect re-resume, with
fake SDK checks in `test-copilot-model`, `test-authcheck` and `test-copilot-oneshot`) and the trust-confirmation part of T111 (remote
extras only). T098 stays open for `startMcpSignIn`; T111 stays open for the Copilot waiting text (T102).

## Out of scope (owner decisions 2026-10-20)

- No in-app log viewer (Q5); T080 removed. A viewer would need a new spec and the owner's approval.
- No new-session variant of Restart session (Q4), no *Restart session* in the More or card menus (Q10), no Codex "Reload servers" (Q8),
  no early Claude CLI launch after Restart session (Q11), no use of Copilot `stopServer` (Q2).
- Delta 2026-10-20 (issue #364, constitution III, not a question): no call that hands a token, code or callback URL through Durbar (Copilot
  `onMcpAuthRequest`, `oauth.handlePendingRequest`, `oauth.respond`, `oauth.complete`; Claude `mcp_oauth_callback_url`), no client id or
  secret asked from the user, no `redirectUri` of Durbar's own. No "Sign in with another account" (Q19 A): no `forceReauth`, no `mcp_clear_auth`. (Changed 2026-10-23 by the owner for one use only: Copilot's **Sign in again**, FR-164, which re-creates keychain sign-ins saved by older builds.)
- No automatic switch-off after repeated failures (Q17 A); no early Claude CLI launch for a sign-in (Q15 A); no `http:` authorization
  pages (Q16 A); no automatic Restart session after a Codex sign-in (Q18 A).

## Dependencies

- T001 (done) before everything. Phase 1 before Phases 2-5. T020 before T021, T026, T032, T041, T052. T040 before T041 before T044. T054 before T052.
- Phases 3, 4 and 5 are independent of each other after Phase 2. Phase 6 after the phase it checks. Phase 7 last.
- Phase 8: T091, T097, T112 and T113 depend on nothing. T091 before T092 and T094-T096; T112 before T093-T096 and T114; T093 before
  T094-T101; T113 and T114 before T115; T114 before T101; T115 before T102; T090 (done) before T098-T104; T101 before T102-T103; Phase 8c
  after the task it checks; T108-T109 last. T095 includes T023 (same file). Note 2026-10-21: T112-T115 replace the earlier "T010, T011,
  T020, T026 before" for #364; the rest of those tasks builds on T112-T115 in #349.
- MVP = Phases 1-2 (words, masked errors, live refresh): it answers the owner's "not clear how to start them" on its own.

## Phase 9: live status and actions in Settings (delta 2026-10-23, issue #596)

- [x] T120 Spec delta FR-080..FR-087, plan delta and these tasks, committed before code
- [x] T121 [P] Unit tests for `DurbarMcpWords.aggregate` in `scripts/test-mcpwords.ts` (counts and words, urgency order, "uses" rule,
  not-started rows, sorting, caps, unknown tokens) [FR-081, FR-086]
- [x] T122 [P] Simulator driver `scripts/shots-058-mcp-settings.js` (several agents, ~10 servers in mixed states injected as `mcp`
  reports): aggregate words, the expander, Restart and Restart session calling the right chat (recorded on the simulator's bridge),
  Details masked, Open in chat, live refresh, no overlap and 10.5px at 1440x900 and 1280x800; in `scripts/ui-suite.js` [FR-080..FR-085]
- [x] T123 `aggregate` in `src/renderer/mcpwords.js` [FR-081]
- [x] T124 Settings list, expander, actions, live refresh and the attention count in `src/renderer/screens.js` and `screens.css`; the
  shared Restart and Restart session flow used by the chat dialog too; `mcpSession` and the stop hook in `src/renderer/app.js`
  [FR-080, FR-082..FR-086]
- [x] T125 Docs: README MCP section line, `changelog.d/058-mcp-settings-live.md`, screenshots (driver at 1440x900 and 1280x800; the
  linked Settings shots retaken), specs-index block [FR-085]
- [x] T126 `/speckit-converge` for the delta; tick tasks; mutation-check the driver and the unit tests

- [x] T127 Review on #609 (fjcabello): needs-sign-in rows lead with Open in chat, Restart behind More; load sequence numbers and no
  reload while the list is hidden; a needs-sign-in-only case in `test-mcpwords`; the driver pins each (mutation-checked) [FR-082, FR-083]

## Phase 10: fewer macOS keychain prompts (delta 2026-10-23, issue #623, owner report; related #525)

- [x] T130 Spec delta: who reads the keychain, why Always Allow does not stick, the options, FR-160..FR-162 (spec *Changes* 2026-10-23)
- [x] T131 `mac.signIgnore` for the Copilot runtime prebuilds and `scripts/check-runtime-signature.js` in `dist:mac:*`; `test:runtimesign` [FR-160]
- [x] T132 `CopilotAdapter.getClient`: a failed runtime start is not cached; `test:copilotshared` (one runtime for N sessions, session end, retry, per-session modes and folders) [FR-161]
- [x] T133 Docs: README *Keychain prompts on a Mac*, `changelog.d/058-keychain-prompts.md`, `docs/agent-notes.md` entry
- [ ] T134 Mac check list (FR-162) run on a Mac by Paco's team; counts before and after on #623; README and FR-160 `[KNOWN GAP]` updated [FR-162]
- [x] T135 Record the owner's Mac result (FR-162) and the root-cause analysis; FR-163: `listMcpTools` asks nothing of a server that is not connected; `test:copilotshared` counts runtime calls [FR-162, FR-163]
- [ ] T136 (third launch: 0 prompts, real 2026-10-23; the cause of the two rounds is still open) Confirm the cause on the owner's Mac: the program name in the dialog, Durbar running from /Applications, and whether deleting the old `copilot-mcp-oauth*` items in Keychain Access and signing in again gives 0 prompts on the next launch [FR-162]
- [x] T137 Sign in again (owner-approved): per row and for all, the runtime's `forceReauth` sign-in, guards in main, simulator; fakes only [FR-164]
- [ ] T138 On the owner's Mac: Sign in again to all, then quit and reopen: count the prompts (expected 0 if `forceReauth` re-creates the items) [FR-164]
- [x] T139 Review on #625 (fjcabello): FR-160 credits the real CI build and strict verify; FR-162 points to the test pre-release; every mac packaging script runs the check (`--arch` per build, per app); `dispose` stops a runtime that is still starting [FR-160, FR-161]
- [x] T159 Re-review on #625 (fjcabello): a Sign in again entry is not finished by the old "connected"; offered only for a remote server Durbar knows by its https address with a source the runtime named (fail closed); a re-read keeps source and transport; no partition command in README or tasks; the confirmation says the server stays signed out until finished; a second press does nothing; pending servers get their own wording; plan refreshed [FR-163, FR-164]

## Phase 10: MCP health, failure reason, when, Copy diagnostics, chip dot (delta 2026-10-23, issue #603)

- [x] T140 Spec delta FR-090..FR-097, plan delta and these tasks, committed before code
- [x] T141 [P] Unit tests: `scripts/test-mcphealth.ts` (since, ran, afterRunning, restart resets, unchanged state keeps its time) and
  `test-mcpwords` (every reason, text rules shared with the hint, "Failed (reason unknown)", whenText, diagnostics content and masking
  with a planted fake token through `maskMcpError` and `redact`) [FR-090, FR-092, FR-093]
- [x] T142 [P] Adapter tests with fakes: Copilot `errorClassification` values in `test-events` (known values, unknown values set
  nothing, a later `connected` drops the class); Claude `mcp_server_errors` and `config.type` in `test-claude-map`; `agents:mcp`
  reply fields in `test-mcp-session` [FR-091, FR-092]
- [x] T143 [P] Simulator driver `scripts/shots-058-mcp-health.js` (mixed failures injected as `mcp` reports): reason words, time,
  Copy diagnostics content (masked; a planted fake token is not in it), Settings rows, the chip dot and its name at 1440x900 and
  1280x800; in `scripts/ui-suite.js` [FR-093..FR-096]
- [x] T144 Adapters: `errorClass` values, Copilot `copilotErrorClass`, Claude errors and transport (also T022's Copilot class part
  and T024) [FR-091]
- [x] T145 `src/shared/mcphealth.ts`, main's per-session marks and the reply fields [FR-092]
- [x] T146 `mcpwords.js` (`reasonOf`, `whenText`, `diagnostics`, shared classifier); the shared row helper in `screens.js` for the
  chat dialog and Settings; `screens.css` [FR-090, FR-093, FR-095, FR-096]
- [x] T147 The chip dot and `mcpOpts` in `app.js`; `styles.css`; the simulator's fields in `sim.ts` [FR-094]
- [x] T148 Docs (README MCP line, `changelog.d/058-mcp-health.md`, screenshots at 1440x900 and 1280x800 and the linked MCP shots
  retaken), `/speckit-converge`, tick tasks, mutation checks (unit: 12 mutants killed; driver: no page redact() and no chip dot both
  fail it). Also found and fixed: the simulator told the window of an `mcp` event before it kept the new list, so a reply asked for at
  once (the chip's count) read the old one; it now keeps the list first, as main does
- [x] T149 Review on #630 (fjcabello): chip tooltip under 120; home folders to `~` (`maskHomePaths`, shared); OAuth `code`/`state`/token
  query values and any-case `Bearer` (shared `maskSecretUrl`/`redact`); the 5 s re-read keeps Copilot's class; mask each value before
  the cut; bidi marks flattened; UTC time only; 401/403 is "Refused: needs sign-in" before any crash rule; an unmasked-token unit test;
  FR-095 updated. Tests in `test-redact`, `test-mcpwords`, `test-events`; the privacy fixes mutation-checked [FR-090, FR-091, FR-093, FR-094, FR-095]

## Phase 11: Sign in for Claude Code and Codex (delta 2026-10-23, issue #364 step 5; owner priority)

Spec *Changes* 2026-10-23 (FR-175..FR-186, SC-175, SC-176), research 7.8, plan *Delta: Sign in for Claude Code and Codex*. Q20, Q21, Q23, Q24: A; Q22: B (owner, 2026-10-23);
the tasks follow those answers. PR A = Claude Code with the
shared parts; PR B = Codex (Q23 A).

- [x] T150 Spec delta FR-175..FR-186, research 7.8, plan delta and these tasks, committed before code
- [x] T151 [P] Types and contract: `McpSignInResult` browser `ttlMs?`; `McpServerStatus.signInEnd?: 'next-message' | 'failed'` (event
  guard: only those values); capability `mcpSignInNote?`; contract C2 lines (`mcpSignInNote` only with `mcpSignIn` or
  `mcpSignInSteps`); fake adapter options for both; `scripts/test-adapter-contract.ts`, `scripts/test-events.ts` [FR-180]
  [IMPLEMENTED] 2026-10-23 (PR A): `src/adapters/types.ts`, `capabilities.ts` (also `mcpSignInRestart`, see spec *PR A notes*), `eventguard.ts` (`validSignInEnd`), `fake.ts` (`endOnRefresh`, `refreshNames`); the guard's tests are in `test-adapter-contract` (where the other `eventProblems` checks live)
- [x] T152 Main: `McpSignInStore.begin(..., ttlMs)` keeps `min(ttlMs, 10 min)` per entry (`live`, `sweep`, `view`, the poller stop use
  it); `onServers` drops on `connected` or `signInEnd`; `agentMcpReply` adds `signInEnd` and `signInNote`, and `signInSteps` needs only
  `mcpSignInSteps` (`src/main/mcpsession.ts:82`); tests in `scripts/test-mcp-signin.ts` (an entry with `ttlMs` expires at its own limit, Copilot's still at 10 minutes; `ttlMs` = 300000 minus the request time minus 10000, at
  least 30000, with a slow answer on an injected clock;
  a `signInEnd` drops the entry and stops the poller; steps without `mcpSignIn`); mutation-check each [FR-180]
  [IMPLEMENTED] 2026-10-23 (PR A): `src/main/mcpsignin.ts` (`begin(..., ttlMs)`, `recent`), `mcpsession.ts`, `mcpipc.ts` (the FR-176 re-read), `src/shared/mcp.ts` (`signInTtlMs`); `test:mcpsignin`; mutations killed
- [x] T099 Claude Code (PR A) `startMcpSignIn` (`mcp_authenticate {serverName}` only, 30 s; browser with `ttlMs` = 300000 minus the request-to-answer time minus 10000, at least 30000 (FR-175);
  `requiresUserAction: false` -> connected; `callbackExpected: false`, other shapes and control errors -> reject; a timeout and an
  unknown-subtype error -> the terminal steps, a late answer dropped unread, no address in any log; `ttlMs` from the request time;
  after Cancel, one `mcp_status` read on the next focus within 5 minutes; a second Sign in while the first listens; CLI not running ->
  "Send a message first, then sign in."; off at launch or switched off -> reject), `refreshMcpStatus` (`mcp_status`, through
  `withAuthSeen`), `restartMcpServer` clears `mcpAuthSeen` for the name and emits through `withAuthSeen`; capabilities `mcpSignIn`,
  `mcpSignInSteps` (FR-181 text), `mcpSignInNote`; none of them on the SDK transport; tests in `scripts/test-claude-adapter.ts` on the
  test transport (request bodies have no `redirectUri`; no `mcp_oauth_callback_url`, no `mcp_clear_auth`; a poll that still says
  connected keeps a mark-only needs-auth; a needs-auth -> connected poll ends it; mutation-checked) [FR-175, FR-176, FR-181, SC-176]
  [IMPLEMENTED] 2026-10-23 (PR A): `src/adapters/claude.ts`; `test:claudeadapter`; mutations killed. `[KNOWN GAP]` real CLI: T106
- [ ] T100 Codex (PR B) `startMcpSignIn` (`mcpServer/oauth/login {name, threadId, timeoutSecs: 300}`; browser with `ttlMs` = 300000 minus the request-to-answer time minus 10000, at least 30000 (FR-175);
  keep `loginId`; MethodNotFound or error -> reject), the `mcpServer/oauthLogin/completed` branch (by `loginId`, else name + thread;
  success: clear the mark, read the one server, connected -> `mcp`, else `relaunch` + `signInEnd: 'next-message'`; failure: Codex's
  error + `signInEnd: 'failed'`), `refreshMcpStatus` (one server, merged into `live.mcp`); capabilities as T099; no `cancelMcpSignIn`;
  fake app-server answers the method and sends the notification; tests in `scripts/test-codex-adapter.ts` (by `loginId`, without it,
  another thread ignored, failure masked in main, the merge keeps other servers, `account/login/cancel` never sent; an old attempt's
  success after a new one started counts; an old attempt's failure during a new one does not end it; `ttlMs` from the request time;
  the `signInEnd: 'next-message'` relaunch's `thread/resume` carries the same permission mode, sandbox, approval policy and
  `config.mcp_servers` (switched-off servers and tools included) as before, sends no prompt, waits for a running turn, and End session
  drops it; mutation-checked)
  [FR-177, FR-178, FR-181, SC-176]
- [ ] T153 (split: T153a done in PR A, T153b open for PR B) Renderer: the row's note from `signInNote` (replaces the hard-coded sentence at `src/renderer/screens.js:1113`); the
  `signInEnd` states and toasts; Claude's "If you finished in your browser, press Restart on this row." after a mark-only entry expires;
  live region; no new IPC (PR A: Claude parts and the note; PR B: Codex states) [FR-176, FR-182]
  - [x] T153a (PR A, Claude Code) [IMPLEMENTED] 2026-10-23: the note from `signInNote`, Restart kept with `signInRestart`, the time-limit line, the dialog open asks `agents:mcp(id, true)`
  - [ ] T153b (PR B, Codex): the `signInEnd` states and toasts (FR-182)
- [ ] T154 (split: T154a done in PR A, T154b open for PR B) Simulator and screenshots: `simmcpauth=1|manual|codexfail` for the Claude and Codex sim kinds in `src/renderer/sim.ts`;
  `scripts/shots-058-mcp-signin.js` replaces its "Claude and Codex keep today's behaviour" block with their sign-in checks;
  `docs/screenshots/058-mcp-signin-{claude,codex}-*-{1440x900,1280x800}.png` [FR-183, SC-175]
  - [x] T154a (PR A, Claude Code) [IMPLEMENTED] 2026-10-23: the Claude sim kind (`simmcpauth=1|manual`, `simkinds=mixed`), the driver's Claude checks, `058-mcp-signin-claude-{row,steps,confirm,manual}-*.png`
  - [ ] T154b (PR B, Codex): `simmcpauth=codexfail`, the Codex sim kind, the driver's Codex checks and `058-mcp-signin-codex-*` screenshots
- [ ] T155 (split: T155a done in PR A, T155b open for PR B) Docs: README *MCP servers* (Sign in for all three apps, the terminal steps, "not checked on a real account yet" for Claude
  Code and Codex; a *Known limits* line: "Without a system keyring (common on Linux), Claude Code and Codex keep an MCP sign-in in a
  plain `.credentials.json` file in their own settings folder; Agent Durbar does not read or change it."), `changelog.d/<branch>.md`, `docs/agent-notes.md` entry (Claude's undocumented `mcp_authenticate`; `claude mcp login`
  needs a TTY; the token keys of both apps; Codex's cancel does not reach MCP logins), `[IMPLEMENTED]` tags in FR-175..FR-183
  - [x] T155a (PR A, Claude Code) [IMPLEMENTED] 2026-10-23: README (Claude Code Sign in, Known limits incl. the plain `.credentials.json` and "read from 2.1.304 only"), `changelog.d/058-signin-claude.md`, the agent-notes entry, the FR tags
  - [ ] T155b (PR B, Codex): the README and changelog lines for Codex, the Codex FR tags
- [x] T157 (PR A) FR-185: `serverUrlOf` per app (Copilot: extras, Copilot CLI list; Claude Code: extras, `globalFor`; Codex: extras,
  its `config.toml` entry's `url`; no match: no line); tests in `scripts/test-mcp-signin.ts`: a Claude and a Codex agent with a
  same-named Copilot CLI entry on another site show no line; Copilot unchanged; mutation: the old fallback fails the test [FR-185]
- [x] T158 (PR A) FR-186 (Q22 B): `McpServerSpec.oauth?` with the four allow-listed fields; `specOf` copies them from the raw Claude
  entry (own properties only, all-or-nothing on a wrong type, shape or length); `mcpConfigOf` writes `oauth` for http/sse only; no
  log line with a value. Tests in `scripts/test-mcp-global.ts` (it covers `sessionServers`/`specOf`) and `scripts/test-claude-adapter.ts`: a
  valid object is copied exactly; **keys outside the allow-list are dropped while the valid
  fields still copy** (`clientSecret`, `client_secret`, `xaa`, an unknown key, and own `__proto__` / `constructor` keys next to a valid
  `clientId`/`callbackPort`: the copy holds exactly the valid fields); **a bad value in an allow-listed field means nothing is copied**
  (a nested object as `clientId`, a 100 kB `scopes`, `callbackPort` 0, 70000, 1.5 and `"8080"`, `authServerMetadataUrl` `http:` or
  `javascript:`: no `oauth` at all); a non-object `oauth` and a stdio entry copy nothing; the `--mcp-config` JSON
  never holds `clientSecret`; the debug sink holds no field value. Mutation: copying the whole object fails the test; dropping the
  all-or-nothing check fails it; **dropping everything when an extra key is present** (instead of dropping only that key) fails it [FR-186]
- [ ] T156 `/speckit-converge` for this delta after PR B; tick T099, T100 and Phase 11; FR-184 gaps updated from T106/T107

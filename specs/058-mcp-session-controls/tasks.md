# Tasks: MCP servers in a session (spec 058, issue #349)

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md)
**Gate**: Q1-Q11 answered by the owner (`/speckit-clarify`) before T010. Tasks follow the recommended options; a task that depends on a
question names it.
**Format**: `[ID] [P?] [Story] Description [FR]`. `[P]` = can run in parallel (different files, no dependency). Each task is one
small PR-sized step with its own test. No task spends AI credits except Phase 6, which needs the owner's go-ahead.

## Phase 0: Clarify (owner)

- [ ] T001 Owner answers Q1-Q11 in spec.md; record the answers under spec.md `## Clarifications` and adjust the tasks below

## Phase 1: Foundation (blocking)

- [ ] T010 [P] Capability fields `mcpStart`, `mcpToggleApplies`, `mcpRestart`, `mcpLogs` and optional members `restartMcpServer`,
  `mcpLogFolder` in `src/adapters/capabilities.ts` / `types.ts`; `McpServerStatus.errorClass` / `needsRestart`; contract C2 lines in
  `scripts/test-adapter-contract.ts`; `fake.ts` members behind its capability switches [FR-010, FR-011, FR-012, FR-013]
- [ ] T011 [P] `src/renderer/mcpwords.js` (UMD): state words and icons, start line, toggle timing, hints; `scripts/test-mcpwords.ts`
  (`test:mcpwords` in `test:serial`) covering every state, unknown tokens and every hint rule, including the sign-in hint that names
  the agent app's own sign-in without running it [FR-001, FR-002, FR-006, FR-052]
- [ ] T012 [P] `maskMcpError(text, secretValues)` in `src/shared/redact.ts` (redact with the given values and the env, then URL
  credentials, cut to 300); cases in the redact tests: an extra's header value, an env value, `ghp_` token, `https://user:pass@host`
  [FR-005]

## Phase 2: User Story 1 + 2, words and errors (P1, MVP)

- [ ] T020 [US1] `agents:mcp` reply adds `app`, `start`, `toggleApplies`, `canRestartSession` (false until T040), per-server
  `errorClass`, `needsRestart`, `canRestart` (false until T030/T031), `logFolder` (false until T050); `AgentMcpEntry` in
  `src/shared/api.ts`; test in new `scripts/test-mcp-session.ts` (`test:mcpsession`) [FR-020]
- [ ] T021 [US2] `agents:mcp` masks `error` with `maskMcpError` and the secret values of the extras passed to that agent's session
  (`McpStore.forSession`); test that no secret reaches the reply [FR-005, SC-002]
- [ ] T022 [P] [US2] Copilot mapper: `errorClassification` (known values only) -> `errorClass`, `session.mcp_server_needs_reconnect` ->
  `needsRestart`; mapper test [FR-011]
- [ ] T023 [P] [US2] Codex: `failureReason: reauthenticationRequired` and `authStatus: notLoggedIn` -> `errorClass: 'auth'`; test in
  `test-codex-adapter` [FR-011]
- [ ] T024 [P] [US2] Claude mapper: `init.mcp_server_errors` -> `failed` rows with their text; mapper test [FR-011]
- [ ] T025 [P] [US1] Capability values in the three adapters: Copilot `session`/`live`, Claude `next-message`/`live`, Codex
  `session`/`next-message` (restart and logs stay false here); contract test [FR-010]
- [ ] T026 [US1] Dialog rows: word + icon, hint, *Details* with *Copy*, start line and toggle timing, the two scopes sentence; the
  "applies right away" text only for `live`; `index.html` loads `mcpwords.js` [FR-001, FR-002, FR-003, FR-007, FR-030, FR-033]
- [ ] T027 [US1] Live refresh: when an `mcp` event for the open agent arrives (`app.js`, where `a.mcp` is set), re-render the list and
  keep focus by server name [FR-004]
- [ ] T028 [US1] Simulator: real capability values per kind (Claude and Codex `mcpToggle: true`), servers in every state, a failed one
  with a canned error and hint [FR-040]
- [ ] T029 [US1] Screenshot driver `scripts/shots-058-mcp.js` (Copilot, Claude, Codex dialogs; prints `[058] PASS`); run at 1440x900
  and 1280x800; commit `docs/screenshots/058-mcp-*.png` [FR-042]

## Phase 3: User Story 3, per-server Restart (P2)

- [ ] T030 [P] [US3] Copilot `restartMcpServer`: `rpc.mcp.restartServer({serverName})` when present, else `disable` then `enable`
  (Q3); never `stopServer` (Q2) or `reload`; not live rejects; fake SDK gains `restartServer` and a mode without it; adapter test
  [FR-012, SC-003]
- [ ] T031 [P] [US3] Claude `restartMcpServer`: control request `mcp_reconnect {serverName}` then `mcp_status` and an `mcp` event; a
  server off at launch rejects with "Switch it on first; it starts with your next message"; not live rejects; fake CLI test [FR-012,
  SC-003]
- [ ] T032 [US3] `agents:mcpRestart(id, name)` in main: validation, one restart per server at a time, masked error, activity-log row;
  preload and `DurbarApi`; `canRestart` in `agents:mcp`; test in `test-mcp-session` [FR-020, FR-021]
- [ ] T033 [US3] Dialog: *Restart* per row (only `canRestart`, live, switch on), "Restarting…" disabled state, toast with the result;
  Codex footer line [FR-030, FR-031, FR-032]
- [ ] T034 [US3] Simulator: canned Restart (Starting -> Running) for Copilot and Claude sim kinds; refresh screenshots [FR-040, FR-042]

## Phase 4: User Story 4, Restart session with these servers (P2)

- [ ] T040 [US4] Extract `endSession(a)` in main (remote off, `adapter.stop`) and use it in `agents:end`; no behaviour change; existing
  tests pass [FR-022]
- [ ] T041 [US4] `agents:mcpRestartSession(id, confirmed)`: validation, `resume` capability, busy check from main's `agentState`
  (`needsConfirm`), `endSession` then `ensureLive` with the same id and current options, no prompt; preload and `DurbarApi`;
  `canRestartSession`; test with a fake adapter: order, same id, new `mcpServers`/`disabledMcpServers`, refusal while busy, failed resume
  leaves the agent ended (Q4) [FR-022, SC-004]
- [ ] T042 [US4] Dialog footer button and the confirmation text (Cancel focused) when working/thinking/waiting, grants or remote on;
  after the restart the dialog refreshes; Claude line "servers start with your next message" (Q11) [FR-023, FR-030]
- [ ] T043 [US4] Simulator: canned Restart session; screenshots of the confirmation [FR-040, FR-042]

## Phase 5: User Story 5, Open log folder (P3)

- [ ] T050 [P] [US5] `src/adapters/mcplogdirs.ts` (pure, injected env and platform): Copilot, Claude per server (Q6), Codex (Q7);
  `scripts/test-mcplogdirs.ts` for Linux, macOS and Windows with `COPILOT_HOME`, `CODEX_HOME`, `XDG_CACHE_HOME`, `LOCALAPPDATA`, long
  names -> undefined [FR-013]
- [ ] T051 [US5] `mcpLogFolder` on the three adapters and the `mcpLogs` capability values; contract C2 lines [FR-010, FR-013]
- [ ] T052 [US5] `agents:mcpRevealLogs(id, name?)`: folder from the adapter, `fs.stat` directory check, `shell.showItemInFolder`; never
  lists or reads files; `logFolder` flags in `agents:mcp`; test with an injected `shell` and fs [FR-020, FR-024, FR-025]
- [ ] T053 [US5] Dialog: *Open log folder* in the footer (session folders) and in a row's *Details* (per-server folders), worded as "the
  agent app's log folder" with no promise of server output; simulator toast [FR-030, FR-040, FR-051]

## Phase 6: Real checks (needs-owner-approval; 0 AI credits, no prompt)

Each: a throw-away folder, a throw-away local stdio echo server as a folder extra, Ask first mode, **no prompt sent**. Record results in
research.md and change `read:` to `real:` where confirmed. Do not open or paste log files.

- [ ] T060 [needs-owner-approval] Copilot: session starts with the server Running; *Restart* (does `restartServer` exist on the pinned
  runtime, does the row go Starting -> Running); a server with a wrong command shows Failed with its text and `errorClassification`
  value; *Restart session* keeps the id and history; does `~/.copilot/logs` exist [FR-050]
- [ ] T061 [needs-owner-approval] Claude Code: the CLI is launched only with a message, so: start, then Restart session (expect "Not
  started yet" until the next message, Q11); with an already launched CLI from an earlier spec 012 check, `mcp_reconnect` on a failed
  server; does `mcp-logs-<server>` exist [FR-050]
- [ ] T062 [needs-owner-approval] Codex: list states and `failureReason` for a wrong command; *Restart session* keeps the thread; does
  `~/.codex/log` exist and is anything from the app-server in it (folder listing only by the owner, not by Durbar) [FR-050]
- [ ] T063 Converge: README, spec status and `[KNOWN GAP]` tags after T060-T062

## Phase 7: Docs and close

- [ ] T070 README MCP section: the dialog's words, Restart (Copilot, Claude), Restart session, Open log folder, "not checked on a real
  account yet"; CHANGELOG *Unreleased* line; specs index row; spec 019 `## Changes` note updated from "specified" to "built"
- [ ] T071 `/speckit-converge`: spec, plan and tasks match what was built; tick tasks

## Later (not planned; owner decision Q5 B)

- [ ] T080 [needs-owner-approval] Spec a masked last-lines view of a server's log (size caps, `redact` per line, no copy to Durbar's data,
  read only on request) as a new delta; no code before that

## Dependencies

- T001 before everything. Phase 1 before Phases 2-5. T020 before T021, T026, T032, T041, T052. T040 before T041.
- Phases 3, 4 and 5 are independent of each other after Phase 2. Phase 6 after the phase it checks. Phase 7 last.
- MVP = Phases 1-2 (words, masked errors, live refresh): it answers the owner's "not clear how to start them" on its own.

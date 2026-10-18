# Tasks: 041 Durbar MCP server

Spec: [spec.md](spec.md) | Plan: [plan.md](plan.md)

**Tags** (in the task line, before the text):
- `(unit)`: pure logic or a main-process module tested by `scripts/test-*.ts` in `npm test`. No account, no credits, no window.
- `(sim)`: needs the window with the simulator (`DURBAR_SIM=15 DURBAR_SIM_FREEZE=1` and/or `DURBAR_SIM_MAIN`) and a `DURBAR_DRIVER` script; screenshots at 1440x900 and 1280x800. No account, no credits.
- `(needs-owner-approval)`: blocked until the owner says yes in writing (a native dependency, or running a real MCP client). The issue gets the label `needs-owner-approval`. Do not start it.

One task = one issue = one pull request. Tick the task in the same pull request. Every task ends with `npm run typecheck && npm run build && npm test` green. Never run a real agent session, `npm run smoke` or `scripts/capture-raw.ts`. Stop only processes you started, by PID (never `pkill`/`killall`).

## Done (planning, 2026-10-18)

- [x] T001 Spec, clarifications Q1-Q12 (owner: all defaults) and the review decisions FR-050..FR-056 ([spec.md](spec.md)) [FR-001..FR-056]
- [x] T002 Plan: architecture, transport, tool registry, queue and dialog, agent state in main, away-from-agents, audit, testing, phases, risks ([plan.md](plan.md))
- [x] T003 Tasks (this file)
- [ ] T004 Analyze (`/speckit-analyze`): every FR and SC has a task, the spec contradictions listed in [plan.md](plan.md#spec-contradictions-found-while-planning-for-the-coordinator-specmd-not-edited) are settled in a spec `## Changes` entry, no `src/` change in this pull request

## Phase 1: transport, handshake and read tools

Order: T010, T011, T012 and T013 are independent (any order, one at a time per worktree). T014 needs T013. T015 needs T012-T014. T016 needs T010-T012. T017 needs T016. T018 needs T016.

- [ ] T010 (unit) `src/shared/mcpserver.ts` (reserved name `agent-durbar`, bridge flag, marker name, limits, status names) and pure `src/main/mcp/paths.ts` `mcpPaths()`: key file, Unix socket (XDG runtime dir on Linux, userData, per-user tmp fallback when the path is over 103 bytes), Windows pipe name from the random pipe id; tests for `win32`, `darwin` and `linux` from any OS, `DURBAR_USER_DATA` respected (`scripts/test-mcp-paths.ts`) [FR-002, FR-006, FR-032]
- [ ] T011 (unit) `src/main/mcp/auth.ts`: key file create, read, rotate, delete (0600 file, 0700 folder; injected fs), 256-bit key and 128-bit pipe id, HMAC challenge-response both ways; tests: wrong key refused, the key never appears in any message, a reset makes old bridges fail [FR-003, FR-033, SC-004]
- [ ] T012 (unit) `src/main/mcp/jsonrpc.ts`, `protocol.ts`, `tools.ts`: newline framing with a 64 KB cap, JSON-RPC 2.0 errors, `initialize` version negotiation from one supported list, `notifications/initialized`, `ping`, `tools/list` (static registry with descriptions that say every change needs confirmation in Durbar; no FR-028 tool listed), `tools/call` dispatch; fake client `scripts/fakes/mcp-client.ts`; synthetic handshakes `scripts/fixtures/mcp/*.json` for Claude Code, Copilot CLI, VS Code and Claude Desktop (`"provenance": "synthetic"`); malformed, oversized and unknown-method cases (`scripts/test-mcp-protocol.ts`) [FR-004, FR-028, FR-040, US1-2]
- [ ] T013 (unit) Agent state in main: pure `AgentStateTracker` (`src/main/mcp/agentstate.ts`) with the rules of `src/renderer/app.js:1581-1620` (not started, working, thinking, waiting for approval, at credit limit, idle, done, error, ended), helper events ignored, removed with the agent; one `router.onEvent` subscriber in `main.ts`; table test citing the renderer lines (`scripts/test-agentstate.ts`). Renderer unchanged [FR-011, US1-3]
- [ ] T014 (unit) Main-process simulator `DURBAR_SIM_MAIN=N` (`src/main/mcp/simmain.ts`): read through `devEnv` only (ignored when packaged), a separate dev registry with `FakeAdapter` (production descriptors and the `test-router.ts` guard unchanged), N agents over at least two floors (one off) with scripted waiting, limit, error and not-started agents; test that a packaged `devEnv` gives no sim [FR-045, Q10, SC-001]
- [ ] T015 (unit) Read tools `src/main/mcp/readtools.ts` over injected getters: list folders and agents (with state, mode names, cap, `lazy`, `floorOn`), floors, usage totals from `UsageTotalsStore.view()` plus `since` (test: equals baseline plus this run for the same events), settings, MCP state (key names only), request status (stub until T021); `maskSecretArgs` in `src/shared/redact.ts` for `command`/`args`/`url` with `redact()`; tests with planted env, header and extra secrets; 15 agents and 40 folders answered under 200 ms (`scripts/test-mcp-tools.ts`, `scripts/test-redact.ts`) [FR-010, FR-012, FR-013, FR-043, FR-053, FR-054, SC-001, SC-004, US1-3, US1-4]
- [ ] T016 (unit) `McpServerHost` (`src/main/mcp/server.ts`) and the `mcpServer` setting (`src/shared/credits.ts` `AppSettings`/`parseSettings`, `src/main/settings.ts`): listen only when on; off closes connections, removes the socket and the key file, pending requests `denied`; stale socket removed; a second instance detects a live owner and does not serve; 3 connections, 10 calls/s; tests with the fake client on a temp socket (named pipe on the Windows CI runner) and a lifecycle test that no socket exists when off (`scripts/test-mcp-server.ts`) [FR-001, FR-002, FR-003, FR-040, SC-005]
- [ ] T017 (unit) Bridge (`src/main/mcp/bridge.ts`, pure `bridgecore.ts`) and the `--durbar-mcp-bridge` branch at the top of `main.ts` before any handler, store or window: stdio to socket forwarding, 64 KB cap, offline answers ("Durbar is not running" with a key file, "the MCP server is off" without), reconnect on the next call, refuse when `AGENT_DURBAR_RUNTIME` is set, never starts Durbar, exits on stdin end, no window (`app.dock.hide()` on macOS); tests on injected streams; start time measured on the developer's machine and recorded as `sim:` in the spec, not promised (`scripts/test-mcp-bridge.ts`) [FR-005, FR-034, Q2, Q11, US1-1, US1-5]
- [ ] T018 (sim) Settings *MCP server* section (`src/renderer/screens.js`, typed calls in `src/shared/api.ts` and `src/preload/preload.ts`): on/off, *Reset connection key*, copy-paste configs for Claude Code, Copilot CLI, Claude Desktop and VS Code with the reserved name and the exact executable path and flag, the FR-035 same-user text, second-instance and `DURBAR_SIM` notes; 10.5 px minimum; quick check at 1440x900 and 1280x800 (final screenshots in T040) [FR-001, FR-032, FR-035, FR-044]

## Phase 2: change tools with dialog and safeguards

Order: T020 first. T021 can run before or after T020. T022 needs T020 and T021. T023 needs T022. T024 needs T023. Do not release Phase 2 without Phase 3 (US4 is a release blocker).

- [ ] T020 (unit) Move inline IPC bodies into testable functions, window behaviour unchanged: `mcp:upsert`, `mcp:remove`, `mcp:setEnabled` (`src/main/mcpipc.ts:94-104`) into `src/main/mcpops.ts`; `folders:remove` (`main.ts:621-638`) and the default-cap set (`main.ts:468`) into `src/main/folderops.ts`; new `addLazyFolderOp` (as `restoreFolders`, `main.ts:238-251`: saved, `lazy: true`, no `ad.start`) with the path check (absolute, exists, directory or `.code-workspace`, no `~` or control characters, at most 4096); existing tests still green, new op tests [FR-021, FR-023, FR-025, US3-1]
- [ ] T021 (unit) `RequestQueue` (`src/main/mcp/requests.ts`, clock injected): one shown at a time, at most 5 waiting then `busy`, duplicate gets the first id, 30 s wait then `pending`, 10 min `expired`, statuses kept 15 min, `stale` on re-validation, `failed` with the op text, all `denied` when the server goes off, *Deny all from this client*, 60 s refusal of a repeated denied request; a test per status and SC-002 (nothing reaches a store without Apply) (`scripts/test-mcp-requests.ts`) [FR-024, FR-051, SC-002, Q5, Q6]
- [ ] T022 (unit) Change tools (`src/main/mcp/changetools.ts`): set mode (agent or folder, Ask first or Read-only only), set cap or none, default cap, add folder (no floor argument; lands on the last floor), remove folder (counts of agents and running sessions), MCP extra add, edit, remove, turn off (turn on only when already trusted); validation with the window's functions and texts; `refused` for Allow all, for "trust and turn on" and for secret values (key names kept, needs-secrets); never `approvePending`/`clearGrants`; dialog view model with redacted command, args, URL and key names; Apply through the T020 ops and `setModeOp`/`setCapOp` [FR-020, FR-021, FR-023, FR-025, FR-026, FR-027, FR-028, FR-050, FR-053, FR-054, US2-1, US2-6, US3-2, US3-3, US3-4]
- [ ] T023 (sim) Confirmation dialog: main pushes `mcp:confirm`; `mcp:answer` accepted only from the main window's `webContents`, for the shown id, at least 1 s after shown; `src/renderer/mcpconfirm.js` on `askDialog`: Deny default and Escape, Apply inactive about 1 s and never focused, *Deny all from this client*, "N more waiting", self-reported client name and how it connected (FR-056, "reported by the bridge"), full path and command wrapped; no focus theft while typing; window closed gives `denied`; minimized flags the taskbar or Dock, no sound; `scripts/check-dialog-focus.js` extended; driver `scripts/shots-041.js` started [FR-022, FR-044, FR-051, FR-052, FR-056, SC-006, US2-1, US2-2, US2-3]
- [ ] T024 (unit) End to end on the main simulator with the fake client: each change tool through pending, Apply, Deny, Escape, expiry, stale and `failed` (`NO_LIVE_SETTING`); `durbar_request_status` returns the final status; the office state (agents map, stores) changes only after Apply (SC-002) [FR-023, FR-024, SC-002, US2-2, US2-5]

## Phase 3: away from Durbar's agents, and audit

Order: T030 and T031 may start after T010 (in parallel with Phase 2 only in another worktree, since T030 touches `mcpstore.ts`/`mcpipc.ts` that T020 also touches: prefer after T020). T032 needs T021. T033 needs T015, T022 and T032. T034 needs T017 and T023.

- [ ] T030 (unit) `isDurbarBridge` (`src/main/mcp/identity.ts`): reserved name, executable basename per OS (case rules of constitution VI) plus the flag token in any argument or `flag=` form, socket path or pipe name in a URL; `mcpipc.optionsFor` adds matching Copilot CLI entries and the reserved name to `disabledMcpServers` (no change in `src/adapters/copilot.ts`); `McpStore.upsert`, `moveLegacy`, `applyFolderImport` refuse such an extra with a short reason, `forSession` skips it; tests for each way of registering it (reserved name, other name, ambient file, extra, wrapped command), plus the Copilot fake SDK seam showing the name in the session config (`scripts/test-mcp-identity.ts`) [FR-027, FR-030, FR-031, FR-032, SC-003, US4-1, US4-2]
- [ ] T031 (unit) Runtime marker and no-leak: `AGENT_DURBAR_RUNTIME=1` in the runtime's environment only (Copilot client `env` option in `src/adapters/copilot.ts`; Codex through `codexRpc` `env` when its adapter is wired; Claude `[KNOWN GAP]` in the spec), not in Durbar's own `process.env` (VS Code opened from Durbar must not inherit it); planted key, socket path and pipe name absent from every start option, MCP config and saved folder file [FR-033, FR-034, Q9, US4-3]
- [ ] T032 (unit) `AuditLog` (`src/main/mcp/audit.ts`): one line per connection, tool call and outcome; time, client name (truncated, control characters stripped), tool, agent id or folder fingerprint plus display name (never the full path), status; last 100, cleared on quit; `redact()` on every string; `DURBAR_LOG` through `createDebugSink`; *Recent MCP activity* list in the Settings section (`scripts/test-mcp-audit.ts`) [FR-041, FR-042, FR-055, Q12]
- [ ] T033 (unit) SC-004 sweep: planted env value, header value, extra secret, connection key and `--token`/`--api-key=` arguments; none appears in any read tool result, change tool result, dialog view model or audit line [SC-004, FR-012, FR-042, FR-053]
- [ ] T034 (unit) How the request connected (FR-056 display part): the bridge reports its parent process name only where the OS gives it cheaply (Linux `/proc/<ppid>/comm`; otherwise omitted, no extra process spawned), passed in the handshake, shown and audited as "reported by the bridge"; tests for present, absent and hostile (long, control characters) names [FR-056]

## Phase 4: docs and screenshots

Order: after Phases 2 and 3.

- [ ] T040 (sim) Screenshots with `scripts/shots-041.js` (`DURBAR_SIM=15 DURBAR_SIM_FREEZE=1` plus `DURBAR_SIM_MAIN`): the dialog for set mode, add folder with a 4096-character path, MCP extra with a long command, remove folder, and the Settings section with *Recent MCP activity*, at 1440x900 and 1280x800 under `docs/screenshots/041-*.png`; no overlap, clipping or text under 10.5 px; `npm run check:office` green [SC-006, FR-044]
- [ ] T041 (unit) Docs: README (MCP server section: what it does, off by default, the four client configs, every change confirmed, no Allow all or trust over MCP; *Safety model* with FR-035; known limits: same-user isolation, marker best effort, peer check not built, clients and macOS/Windows not verified), CHANGELOG *Unreleased*, `specs/README.md` row, spec status and `[IMPLEMENTED]`/`[KNOWN GAP]`/`test:`/`sim:` tags, `SECURITY.md` if the reporting text changes [FR-001, FR-035, constitution VIII]
- [ ] T042 Converge (`/speckit-converge`): spec, plan and tasks match the code; the agent-state table still matches `src/renderer/app.js`; every documented limit has a test, a `[KNOWN GAP]` and a task; new tasks appended for anything left

## Backlog

- [ ] T050 (needs-owner-approval) `[KNOWN GAP]` FR-056 peer-process refusal: refuse a connection whose peer process descends from one of Durbar's own runtime processes (Linux `SO_PEERCRED`, macOS `LOCAL_PEERPID`, Windows `GetNamedPipeClientProcessId`). Node `net` exposes none of these, so it needs a native module or a small per-OS helper: a new dependency, so owner approval first. Stronger than the FR-034 marker, which an agent can unset [FR-056, FR-034]
- [ ] T051 (needs-owner-approval) Record real handshakes with Claude Code, Copilot CLI, VS Code and Claude Desktop (connection and `tools/list` only, no prompt, no AI credits, but it runs real clients), replace the synthetic fixtures (`"provenance": "recorded"`), and record the per-OS manual SC-005 check and the bridge start time on macOS and Windows; update the `read:` tags [FR-004, FR-006, SC-005]
- [ ] T052 (unit) When the Codex adapter is registered: the FR-031 rule for its ambient config (`~/.codex/config.toml`), inside the Codex adapter or the main-side options builder, with the same `isDurbarBridge` matcher [FR-031]

## Coverage

| Requirement | Tasks |
| --- | --- |
| FR-001..FR-006 | T010, T011, T012, T016, T017, T018 |
| FR-010..FR-013 | T013, T015 |
| FR-020..FR-028 | T012, T020, T022, T023, T024 |
| FR-030..FR-035 | T018, T030, T031, T041 |
| FR-040..FR-045 | T012, T014, T016, T032, T040 |
| FR-050..FR-056 | T015, T021, T022, T023, T032, T034, T050 |
| SC-001 | T014, T015 |
| SC-002 | T021, T024 |
| SC-003 | T030 |
| SC-004 | T011, T015, T033 |
| SC-005 | T016, T051 |
| SC-006 | T023, T040 |

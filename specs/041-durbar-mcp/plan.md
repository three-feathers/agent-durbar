# Implementation Plan: Durbar MCP server

**Branch**: `041-durbar-mcp` (PR #161) | **Spec**: [spec.md](spec.md) | **Tasks**: [tasks.md](tasks.md) | **Date**: 2026-10-18 | **Kind**: forward plan; analyze (T004) fixes done 2026-10-18; no code yet, nothing verified

**Input**: [spec.md](spec.md): FR-001..FR-064, SC-001..SC-006, the owner's decisions Q1-Q12 (*Clarifications*, all defaults), the review decisions FR-050..FR-056, the consistency pass (FR-057, FR-058) and the analyze fixes (FR-059..FR-064, decisions D-a..D-d), all under `## Changes` 2026-10-18.

## Summary

Durbar gets its own MCP server, off by default. The user's MCP client launches **the Durbar executable with a flag** (`--durbar-mcp-bridge`). That bridge process speaks MCP on stdio and forwards each message, after a challenge-response with a per-install key, to the running app over **a per-user Unix socket or Windows named pipe** (Node `net` on all three OSes). There is no network port. The **main process** owns the protocol (a dependency-free subset), the tool registry, the change-request queue, the audit list and a new main-side copy of each agent's office state. Read tools answer from memory. Change tools are validated with the window's own functions, shown in a **main-owned confirmation dialog** in the window, and on Apply run **the same code** as the window's own controls (inline IPC bodies moved into testable functions first), then push the change to the window (FR-059). Switching a mode to Allow all and trusting a new or changed MCP extra are refused over MCP (FR-050; Read-only and Ask first both ways, and turning on an already trusted extra, are allowed with the dialog, D-b and D-d). Durbar's own agents never get the server: matching entries go into `disabledMcpServers`, the extras store refuses it, and a runtime marker makes the bridge refuse (best effort). Everything is tested with `npm test`: a fake MCP client, synthetic handshake fixtures and a main-process simulator (`DURBAR_SIM_MAIN`, Q10). No AI credits are spent and no real agent session runs.

## Technical Context

- **Language**: TypeScript, CommonJS main process, Electron 44 (Node 22). Renderer stays plain HTML/CSS/JS (`src/renderer/`).
- **Dependencies**: **none new** (Q3). JSON-RPC 2.0 + MCP subset, framing, HMAC challenge-response (`crypto`), socket/pipe (`net`) are all Node built-ins. No `@modelcontextprotocol/sdk`.
- **Storage**: one new setting `mcpServer: true` in `durbar-settings.json` (`AppSettings`, `src/shared/credits.ts:45-56`, parsed by `parseSettings` line 58); one new user-only **key file** in userData (`mcp/connection.json`, 0600 in a 0700 folder; deleted when the server is off). No audit file on disk (Q12).
- **Testing**: `npm test` only. Pure modules with injected clock, file system, platform and streams; a fake MCP client over a real socket in a temp folder (named pipe on the Windows CI runner); synthetic handshake fixtures labelled `"provenance": "synthetic"` until a recorded check; the main-process simulator. A `DURBAR_DRIVER` script (`scripts/shots-041.js`) for the dialog and Settings screenshots.
- **Target platforms**: Windows, macOS, Linux (constitution VI). Path and pipe logic is pure and tested for all three from any OS.
- **Performance**: read tools under 200 ms for 15 agents and 40 folders (FR-013); the bridge adds one Electron start per client session (Q2): measured by the CI test T019, recorded `sim:`, not promised.
- **Constraints**: no secrets in any output, log or audit line (FR-042); no adapter vendor type outside `src/adapters/`; 10.5 px text; the dialog fits 1440x900 and 1280x800 with a 4096-character path (FR-044).

## Constitution Check

| Principle | Result |
| --- | --- |
| I Spec Kit | Spec clarified and reviewed (#161); this plan and tasks come before any `src/` change. Bug-style follow-ups go to `## Changes`. OK |
| II Adapter plug-ins | The server lives in `src/main/mcp/` and talks to agents only through `agents`, the `AdapterRouter` and normalized `AgentEvent`s. FR-031 is done in main where `disabledMcpServers` is already built (`src/main/mcpipc.ts:147-152`, from `cliServers` in `src/main/mcpfiles.ts:47-54`), so **`src/adapters/copilot.ts` does not change for FR-031** (it passes the list through, `copilot.ts:181`). The runtime marker (FR-034) is a neutral constant; each adapter decides how to pass it to its runtime (Copilot SDK `env` client option, Codex `codexRpc` `env`), inside `src/adapters/`. OK |
| III Safe by default, no secrets | Off by default; local only, no port; a key file only the bridge reads, never an env value; HMAC challenge-response with 32-byte nonces, `timingSafeEqual` and a 2 s handshake timeout, so the key never crosses the socket (FR-058, FR-061); every change needs a human click in the window; Allow all and trust refused over MCP (FR-050); `approvePending`/`clearGrants` never set (FR-026); secret values refused (Q7); args/URLs go through `redact()` plus secret-flag masking (FR-053); IPC answers checked against the window's `webContents` and the request shown. OK |
| IV No credits in tests | No read or change tool starts a session (an MCP add folder is "not started", FR-025). Tests use a fake client, `FakeAdapter` and `DURBAR_SIM_MAIN`. Recording real client handshakes is a separate `needs-owner-approval` task (T061), spends no credits but runs real clients. OK |
| V Calm UI | One dialog at a time, Deny is the default, Apply inactive about 1 s, no sound, taskbar/dock flag only; 10.5 px minimum; screenshots at 1440x900 and 1280x800 (T050). The office layout is unchanged. OK |
| VI Parity | One pure `mcpPaths()` resolves socket, pipe and key file for `win32`/`darwin`/`linux` with injected env; Unix socket path length handled; the tmp fallback folder is checked with `lstat` (FR-062); the bridge runs on all three CI runners (T019). Manual per-OS check of SC-005 is recorded honestly (T061). `[KNOWN GAP]` until checked on macOS and Windows. |
| VII Quality gates | Each task keeps `npm run typecheck && npm run build && npm test` green and adds its own `scripts/test-*.ts`; the moved handler bodies keep their old tests (`test-agentops.ts`, `test-mcp.ts`). |
| VIII Honest limits | Same-user isolation (FR-035), marker best effort (FR-034), peer-process refusal not built (FR-056, T060), Claude marker (T063) and Codex ambient config (T062) not built, client compatibility `read:` until recorded (T061): all in the README and the spec. |

**Complexity Tracking**: no violation. A second entry point (`--durbar-mcp-bridge`) in the same executable is a deliberate choice (Q2 a), not a new project.

## Architecture

```text
User's MCP client (Claude Code, Copilot CLI, VS Code, Claude Desktop)
   | stdio, newline-delimited JSON-RPC (MCP stdio transport)
   v
Durbar executable --durbar-mcp-bridge        (no window, no stores, no agents)
   bridge core: framing, 64 KB cap, marker check, offline answers ("not running" / "server is off")
   | net: Unix socket (0700 folder) / Windows named pipe (random per-install name)
   | challenge-response with the key file (HMAC-SHA256, both directions), then framed JSON-RPC
   v
Durbar main process (the running app)
   src/main/mcp/server.ts     listen / close with the setting, limits, connections
   src/main/mcp/protocol.ts   initialize, ping, tools/list, tools/call
   src/main/mcp/readtools.ts  -> agents map, FolderStore, SettingsStore, UsageTotalsStore, McpStore + cliServers, AgentStateTracker
   src/main/mcp/changetools.ts -> validate (window functions) -> RequestQueue -> dialog -> Apply -> same ops as the window
   src/main/mcp/audit.ts      ring buffer (100), redact(), DURBAR_LOG sink
   | IPC 'mcp:confirm' (main -> window), 'mcp:answer' (window -> main, sender + request id + time checked)
   v
Renderer: confirmation dialog (dialog.js), Settings > MCP server, Recent MCP activity
```

### Why the protocol lives in main, not in the bridge

The bridge is a thin forwarder plus an offline responder. Parsing, limits, tool dispatch and every decision happen once, in the process that owns the state (constitution III: validate in main). The bridge only needs the framing module and the static tool list (to answer `tools/list` and every `tools/call` with "Durbar is not running" when no socket answers, FR-005).

### Files

| New file | What | Pure? |
| --- | --- | --- |
| `src/shared/mcpserver.ts` | Neutral constants: reserved name `agent-durbar` (FR-032), bridge flag `--durbar-mcp-bridge`, runtime marker name `AGENT_DURBAR_RUNTIME` (not `DURBAR_*`, so `devEnv` never reads it and `redact`'s `DURBAR_.*` exception does not apply), status names, limits (FR-040) | yes |
| `src/main/mcp/paths.ts` | `mcpPaths({ platform, userData, env, uid, pipeId })`: key file, socket path or pipe name, fallback when a Unix socket path is longer than 103 bytes | yes |
| `src/main/mcp/auth.ts` | key file create / read / rotate / delete (mode 0600, folder 0700), 256-bit random key and pipe id, HMAC challenge-response helpers | thin (fs injected) |
| `src/main/mcp/jsonrpc.ts` | newline framing with a 64 KB cap per message, JSON-RPC 2.0 parse/serialize, error codes | yes |
| `src/main/mcp/protocol.ts` | MCP subset: `initialize` (version negotiation from a supported list), `notifications/initialized`, `ping`, `tools/list`, `tools/call`; unknown methods `-32601` | yes |
| `src/main/mcp/tools.ts` | tool registry: names, descriptions ("every change needs your confirmation in Durbar"), JSON input schemas; static, so the bridge can list them offline | yes |
| `src/main/mcp/agentstate.ts` | `AgentStateTracker`: office state word per agent from normalized events (see *Agent state in main*) | yes |
| `src/main/mcp/readtools.ts` | the read tools of FR-010 over injected getters; output shapes with no prompts, values or secrets | yes |
| `src/main/mcp/changetools.ts` | change tools of FR-020 (narrowed by FR-050): validate, describe (dialog model), apply through the moved ops | yes (ops injected) |
| `src/main/mcp/requests.ts` | `RequestQueue`: pending / applied / denied / expired / stale / failed / busy / refused; timers injected | yes |
| `src/main/mcp/audit.ts` | `AuditLog`: last 100 lines in memory, `redact()`, folder fingerprint + display name | yes |
| `src/main/mcp/identity.ts` | `isDurbarBridge({ name, command, args, url })`: reserved name, executable basename (per OS rules) plus flag token, socket path or pipe name in a URL | yes |
| `src/main/mcp/server.ts` | `McpServerHost`: `net` server lifecycle, auth, connection and rate limits, second-instance detection, stale socket removal | no (net), tested on a temp socket |
| `src/main/mcp/bridge.ts` + `bridgecore.ts` | bridge entry (Electron, no window) and its pure core over injected streams and connect function | core pure |
| `src/main/mcp/simmain.ts` | `DURBAR_SIM_MAIN=N`: registers `FakeAdapter` in a dev-only registry and seeds N agents (Q10) | thin |
| `src/main/mcpops.ts` | bodies of `mcp:upsert`, `mcp:remove`, `mcp:setEnabled` moved out of `registerMcpIpc` (`src/main/mcpipc.ts:94-104`) | yes |
| `src/main/folderops.ts` | bodies of `folders:remove` (`main.ts:621-638`) and the default-cap set (`main.ts:468`); new `addLazyFolderOp` (same shape as `restoreFolders`, `main.ts:238-251`, plus path checks) | yes (deps injected) |
| `src/renderer/mcpconfirm.js` | the confirmation dialog view (uses `dialog.js` focus rules) | renderer |
| `scripts/test-mcp-paths.ts`, `test-mcp-protocol.ts`, `test-mcp-server.ts`, `test-mcp-bridge.ts`, `test-mcp-tools.ts`, `test-mcp-requests.ts`, `test-mcp-identity.ts`, `test-mcp-audit.ts`, `test-agentstate.ts` | tests, joined into `npm test` (a new `test:mcpserver` group) | |
| `scripts/fakes/mcp-client.ts` | fake MCP client: scripted handshake + calls over the bridge core or a socket | |
| `scripts/fixtures/mcp/*.json` | handshakes per client, `"provenance": "synthetic"` from the MCP spec and client docs until T061 | |
| `scripts/test-mcp-bridge-electron.ts` | spawns the built Electron binary with the bridge flag and runs `initialize` over stdio (CI, three OSes, T019) | |
| `scripts/shots-041.js` | driver: dialogs and Settings at 1440x900 and 1280x800 | |

Changed: `src/main/main.ts` (wire host, tracker, ops; bridge flag check first), `src/main/mcpipc.ts` (call `mcpops`, add bridge entries to `disabledMcpServers`), `src/main/mcpstore.ts` (refuse reserved name and bridge command in `upsert`/`moveLegacy`, skip in `forSession`), `src/main/mcpimport.ts` (same refusal on import), `src/main/settings.ts` + `src/shared/credits.ts` (`mcpServer` flag), `src/shared/redact.ts` (`maskSecretArgs`), `src/shared/api.ts` + `src/preload/preload.ts` (typed calls, the `office:changed` push of FR-059, the one-way `agents:setPaused`), `src/renderer/app.js` (apply `office:changed`; report pause), `src/renderer/screens.js` (Settings section; refresh extras on `office:changed`), `src/adapters/copilot.ts` (marker in the client `env` only, `{ ...process.env, AGENT_DURBAR_RUNTIME: '1' }`, FR-034, FR-057), `package.json` (`test:mcpserver`).

## Transport, bridge and key file

**Paths (FR-006, one place: `mcpPaths`)**

| OS | Socket / pipe | Key file |
| --- | --- | --- |
| Linux | `$XDG_RUNTIME_DIR/agent-durbar/mcp.sock` when set (0700); else `<userData>/mcp/mcp.sock` | `<userData>/mcp/connection.json` |
| macOS | `<userData>/mcp/mcp.sock` (`~/Library/Application Support/<app>/`); when longer than 103 bytes: `os.tmpdir()` (per-user `/var/folders/...`) `/agent-durbar-<uid>/mcp.sock`, 0700, checked with `lstat` before use: owned by the user, mode 0700, not a symlink, else no listen and Settings says why (FR-062) | same |
| Windows | `\\.\pipe\agent-durbar-mcp-<pipeId>` where `pipeId` comes from the key file (so two installs do not clash; the name is **not** a protection, FR-061) | `%APPDATA%\<app>\mcp\connection.json` (user-only ACL inherited from the profile) |

`DURBAR_USER_DATA` (dev hook) moves both, so tests and drivers never touch the real ones.

**Key file**: `{ v: 1, key: <256-bit hex>, pipeId, socket }`. Written when the server is turned on, rotated by *Reset connection key*, **deleted when the server is turned off**. The bridge uses that to tell "off" (no file) from "not running" (file, nobody listening). See *Spec contradictions* 4. Never an environment variable, never shown, never in a saved folder (FR-003, FR-033).

**Handshake on the socket** (before any JSON-RPC, FR-058, FR-061): server sends `{ hello: 'agent-durbar-mcp/1', nonceS }`; bridge answers `{ nonceB, mac: HMAC(key, 'b' + nonceS + nonceB), marker: false, parent?: <name> }`; server checks and answers `{ ok, mac: HMAC(key, 's' + nonceB + nonceS) }`, and the bridge checks that. Nonces are 32 random bytes; MACs are compared with `crypto.timingSafeEqual` (length checked first); the whole handshake must finish within about 2 s or the server closes the socket; only authenticated connections count toward the cap of 3, so idle unauthenticated sockets cannot lock the user's client out. The key never crosses the wire, so a squatted pipe on Windows (another local process creating the name first) learns nothing; the pipe or socket name protects nothing by itself.

**Bridge entry (Q2 a)**: the very first lines of `main.ts` check `process.argv` for `--durbar-mcp-bridge` **before** any `ipcMain` handler, store or window is created, and hand over to `bridge.ts`. That path: **first** works out the real key file path with `mcpPaths()` from the real `userData` (or `DURBAR_USER_DATA` when that dev hook is set, `main.ts:47-48`), **then** redirects its own `userData` to a bridge-only folder (`app.setPath`, so the bridge's Chromium never touches the app's profile or its lock), GPU disabled (`app.disableHardwareAcceleration()`), no window, `app.dock?.hide()` on macOS, no single-instance logic, no stores, no `restoreFolders`, never starts Durbar (FR-005, Q11), exits when stdin ends. If the marker variable is set it answers `initialize` and refuses every call with the FR-034 message. Offline answers: `initialize` succeeds (so the client shows a clear tool error rather than a dead server), `tools/list` returns the static list, `tools/call` returns `isError` text "Durbar is not running" or "Durbar's MCP server is off: turn it on in Durbar, Settings > MCP server" (US1-1). It reconnects on the next call, so starting Durbar later works without restarting the client. A CI test (T019) spawns the built Electron binary with the flag on the ubuntu, macOS and Windows runners and runs `initialize` and `tools/list` over stdio. Option (c) (`ELECTRON_RUN_AS_NODE=1`) stays the fallback if T019 shows a start that is too slow or a Windows stdio problem; that would be a spec `## Changes` entry.

**Server lifecycle (`McpServerHost`)**: `start()` when the setting is on and the app is ready; `stop()` when turned off (connections close, socket and key file removed, SC-005; it tells the `RequestQueue`, which turns every pending request `denied`, T031) and on `will-quit`. Never started in demo/sample mode (Settings says so). Listening on an existing Unix socket: try to connect; if someone answers, a second Durbar instance has it, so this one does not serve and Settings says so (edge case, no single-instance lock today); if nobody answers, unlink the stale file and listen. Limits (FR-040): 3 authenticated connections, 10 calls/s per connection (token bucket), 64 KB per message, string caps from the window (names 64, model 100, floor id 20, paths 4096). Work is synchronous and small, so the window is not slowed (FR-013).

**Protocol subset (Q3)**: JSON-RPC 2.0 over newline-delimited UTF-8 (MCP stdio transport). `initialize` answers with the client's `protocolVersion` when it is in the supported list, otherwise the newest supported one; capabilities `{ tools: { listChanged: false } }`; `serverInfo` = `agent-durbar` and the app version. `clientInfo.name`/`version` are kept per connection as **self-reported** (control characters stripped, 64 chars). Tool results are `content: [{ type: 'text', text: JSON }]` plus `structuredContent`; errors are `isError: true` results, protocol errors are JSON-RPC errors. Supported revisions are listed in one constant and checked against the fixtures; real clients are `read:` until T061.

## Tool registry

**Read tools** (no confirmation, FR-010..FR-013): `durbar_list_folders`, `durbar_list_agents`, `durbar_list_floors`, `durbar_usage_totals`, `durbar_settings`, `durbar_mcp_state`, `durbar_request_status`.

- Agents and folders include `floorOn` (FR-054) and the state word from the tracker; folders include the saved path (needed to name a folder) and nothing outside saved folders (FR-012).
- Usage totals: office and per folder from `UsageTotalsStore.view()` (`src/main/usagetotalsstore.ts:104`), which already holds the baseline plus every `usage` event recorded this run (`main.ts:100-104`); `since` from `baselineView()`. A test checks `view() == baseline + this run` for the same events the window adds (US1-4).
- MCP state: Copilot CLI list from `cliServers` (`src/main/mcpfiles.ts:47-54`) and extras from `McpStore.list`: names, transport, enabled, trusted, needs-secrets, **key names only**; `command`, `args`, `url` through `redact()` and `maskSecretArgs` (FR-053).
- Simulator note: in `DURBAR_SIM` (renderer) mode the result says the simulated agents are not visible to the server (edge case); in `DURBAR_SIM_MAIN` mode they are.

**Change tools** (FR-020, narrowed by FR-050; each confirmed; **not listed or dispatched until T038**, after the dialog tasks T036 and T037, FR-064): `durbar_set_mode` (agent or folder; Read-only to Ask first or back, D-d; the value is checked against exactly `read-only` and `ask` **before** `setModeOp`, because `validMode` turns any unknown value into Read-only; `allow` gives `refused` "Allow all can only be turned on in Durbar's own window.", anything else "Unknown mode. Use read-only or ask.", FR-060), `durbar_set_cap` (agent; number or `null`), `durbar_set_default_cap`, `durbar_add_folder` (absolute path, optional mode Read-only/Ask first, optional cap; no floor argument, lands on the last floor as the window does, FR-054), `durbar_remove_folder`, `durbar_mcp_extra_add`, `durbar_mcp_extra_edit`, `durbar_mcp_extra_remove`, `durbar_mcp_extra_set_enabled` (turning off; turning on only when the extra is already trusted, its trust hash still matching, D-b; an untrusted one is `refused` per FR-050). Not listed (FR-028): start, send, stop, end, resolve permission or credit limit, reset totals, floors, places, serious mode, the CLI on/off list (Q8).

Validation uses the window's own functions: `validMode` and the agent lookup of `setModeOp` (`src/main/agentops.ts:22-38`), `parseCap` (`src/shared/credits.ts:21`), `validateInput`/`NAME_RE` (`src/shared/mcp.ts:76,105`), the reserved names of `McpStore.upsert` (`src/main/mcpstore.ts:244-249`), `knownKey` (`mcpipc.ts:57`), the new path check (absolute, exists, directory or `.code-workspace`, no `~`, no control characters, at most 4096), folder target lookup matched per OS as the folder store matches (case-insensitive on Windows and macOS, exact on Linux), and the FR-040 string caps (names 64, model 100, floor id 20). Invalid: `refused` at once with the window's text and no dialog (FR-021). Secret values in `env`/`headers` input: refused (Q7); key names are kept, the extra is saved needs-secrets.

**Apply runs the window's code (FR-023)**: modes through `setModeOp(opsDeps, id, mode, {})` (never `approvePending` or `clearGrants`, FR-026); folder mode for each agent of the folder in the same way; caps through `setCapOp`; default cap through `SettingsStore.setDefaultMaxAiCredits` (`src/main/settings.ts:50`); remove folder through the moved `folders:remove` body; extras through the moved `mcp:*` bodies (`McpStore.upsert` already saves a new or changed extra off and untrusted, `mcpstore.ts:262-275`); add folder through `addLazyFolderOp` (saved with `FolderStore.upsert`, added as a `lazy: true` agent, `agent:added` sent to the window; **no `ad.start`**, FR-025). The result returned is the op's result.

**Push to the window after Apply (FR-059, T035)**: the window today learns of a change only from its own call's answer, and main has just two push channels (`agent:event`, `main.ts:89`; `agent:added`, `main.ts:202`). One new channel `office:changed` carries a discriminated payload: `{ kind: 'mode', agentIds, mode }`, `{ kind: 'cap', agentId, maxAiCredits }`, `{ kind: 'defaultCap', value }`, `{ kind: 'mcpExtras', folderKey }` (the open extras screen reloads), `{ kind: 'folderRemoved', removedIds }`; a lazy agent added uses `agent:added` as `addWorkspace` does. The renderer updates the office, chips and open screens from it; the window's own changes keep their current path.

## Confirmation queue and dialog

**`RequestQueue` (main, pure, clock injected)**: one request shown at a time; at most 5 waiting besides the one on screen, more are `busy` (Q6); same connection + tool + target + arguments while pending returns the first id (no second dialog); a request denied for a connection is `refused` for 60 s when sent again identically (FR-051); the tool call waits up to 30 s and then answers `pending` (Q5); a request expires after 10 min (`expired`); final statuses are kept 15 min for `durbar_request_status` (FR-024). On Apply the request is validated again against the current state: target gone or value already equal gives `stale`; an op refusal (`NO_LIVE_SETTING`, `agentops.ts:20`) gives `failed` with that text. Server turned off: every pending request `denied` (the queue owns this, T031).

**IPC (main-owned, FR-022)**: main pushes `mcp:confirm` with a plain view model (request id, client name labelled self-reported, how it connected (FR-056, the bridge's parent name when the bridge reported it, labelled as reported, not verified), action in words, agent name and full folder path, current and new value, for extras the redacted command, args, URL and key names, for remove the number of agents and running sessions, queue count). The window answers `mcp:answer(requestId, 'apply' | 'deny' | 'deny-all')`. Main accepts only when `event.sender` is the main window's `webContents`, the id is the one it shows, and at least 1 s has passed since it was shown (FR-052, enforced in main too, not only by the disabled button). Window closed (`closed`/`window-all-closed`) or Escape: `denied`. Window minimized or hidden: the request waits; `win.flashFrame(true)` (Windows/Linux) or `app.dock.bounce('informational')` (macOS), no sound.

**Dialog view (`src/renderer/mcpconfirm.js`)**: built on `askDialog` (`src/renderer/dialog.js:15`, the same focus trap as the Allow all dialog, `app.js:1701`): buttons **Deny** (default, Escape, focused), **Apply** (inactive for about 1 s, never focused by default), **Deny all from this client**; "N more waiting". If a text field had a key press in the last second, the dialog appears without taking focus and a clear banner says "Durbar needs your decision"; focus moves when typing pauses or on a click (FR-052). Long paths and commands wrap with the full text reachable (FR-044). Settings section: on/off, *Reset connection key*, the four client configs to copy (Claude Code, Copilot CLI, Claude Desktop, VS Code), using the reserved name `agent-durbar` and the exact executable path, the FR-035 same-user text, the second-instance note, and *Recent MCP activity*.

## Agent state in main (the blocker the spec found)

Today the state word exists only in the renderer (`src/renderer/app.js:1581-1620`, labels at `app.js:204`), and `AgentInfo` has no status (`src/shared/api.ts:18-46`). Main already receives every normalized event (`router.onEvent`, `main.ts:89-131`).

**Plan (T014, D-c)**: a pure `AgentStateTracker` in `src/main/mcp/agentstate.ts`, fed by one more `router.onEvent` subscriber in `main.ts`, keyed by agent id, removed when the agent is removed. It returns the office's own **state word** (`LABELS`, `app.js:204`: *Working*, *Thinking*, *Waiting for you*, *Idle*, *Error*, *Done*; *Paused* when paused, `app.js:206-207`) and the **sub-label** the office shows (`setState(a, state, label)`: *Ready*, *Not started*, *Ended*, *Limit reached*, *Done*). Rules copied from `app.js:1581-1620`, each with a test row: new or restored agent gives Idle with Ready or Not started (`app.js:1155`); `status working` and `output` give Working; `toolCall start` switches Thinking to Working and keeps any other state (`app.js:1620`); `thinking` gives Thinking; `status needs-permission` gives Waiting for you; `limit exhausted` gives Waiting for you with Limit reached; `status idle` after work gives Done with Done, otherwise Idle with Ready; `idle` with intent `Aborted` gives Idle with Ready; `status error` gives Error; `status stopped` gives Idle with Ended. Helper events (with `agentId`) never change the main agent's state. *Paused* is a window-only flag (the pause button, `app.js:883`), so the window reports it with a one-way typed IPC `agents:setPaused(id, paused)` that main validates by agent id. The rest of the renderer is not changed, so the two can drift: the test table cites the renderer lines it copies, and T052 (converge) re-checks it. Moving the renderer onto the same module is a later option, not in v1.

**Simulator (Q10 a, T015)**: `DURBAR_SIM` agents live in the renderer (`main.ts:673-682`, `src/renderer/sim.ts`), so the server sees none. `DURBAR_SIM_MAIN=N` (dev hook, read through `devEnv`, ignored in packaged builds) builds a **separate dev registry** with `FakeAdapter` (`src/adapters/fake.ts`) so `PRODUCTION_DESCRIPTORS` (`src/adapters/descriptors.ts:5`) and the `test-router.ts` guard stay as they are, and seeds N main-side agents over at least two floors with scripted events (one waiting, one at the limit, one error, some not started). It can run together with `DURBAR_SIM` for screenshots.

## Keeping it away from Durbar's agents (FR-030..FR-035)

- **FR-030**: no code path adds the server: the extras store refuses it (below), and nothing else writes `mcpServers`. Test: options built for every agent in the sim never contain it.
- **FR-031**: `mcpipc.optionsFor` (`src/main/mcpipc.ts:147-152`) adds to `disabledMcpServers` every Copilot CLI entry (from `cliServers`, which already reads command and args) for which `isDurbarBridge` is true, plus the reserved name. Matching: reserved name (case-insensitive), or executable basename in the Durbar set (`agent-durbar`, `Agent Durbar`, `.exe` on Windows, `electron` only when the args also hold the app path) **and** an argument equal to the flag or starting with `flag=`, or any argument that contains the flag token (covers `sh -c`, `npx` wrappers). The Copilot adapter is not changed: it passes the list through (`copilot.ts:181`). Test also through the Copilot fake SDK seam (`scripts/fakes/copilot-sdk.ts`) that the created session config holds the name. Claude: `strictMcpConfig: true` already (`src/adapters/claudeModes.ts:72`); Codex ambient config (`~/.codex/config.toml`) is task T062 (`[KNOWN GAP]`) when the Codex adapter is registered.
- **FR-032 / FR-027 (refusal)**: `McpStore.upsert`, `moveLegacy` and `applyFolderImport` refuse the reserved name and any extra for which `isDurbarBridge` is true, from the window too (US4-2); `forSession` skips such an extra if an older file has one.
- **FR-033**: the key, socket path and pipe name are never in `process.env`, start options, MCP config, prompts or saved folders. Test with planted values over every start option the sim builds.
- **FR-034 (best effort)**: marker `AGENT_DURBAR_RUNTIME=1` in the runtime's environment only, not in Durbar's own `process.env` (otherwise VS Code opened from Durbar, `src/main/vscode.ts:108-120`, would inherit it and the user's own VS Code MCP client would be refused). Copilot: the SDK's client `env` option (`node_modules/@github/copilot-sdk/dist/types.d.ts:313`, `read:`; the client is built at `src/adapters/copilot.ts:98`). That option **replaces** the inherited environment, so the adapter passes `{ ...process.env, AGENT_DURBAR_RUNTIME: '1' }` (FR-057, T041). Codex: `codexRpc` `env` (`src/adapters/codexRpc.ts:76,223`) the same way when the Codex adapter is wired; Claude: `[KNOWN GAP]` until its adapter exists (T063). An agent can unset it, which is why FR-022 is the gate and FR-056 peer-process refusal is backlog (T060).
- **FR-035**: Settings text and README say plainly that an agent with shell access in Allow all runs as the same user and could reach the socket and read what read tools return, but cannot apply a change without a click.

## Audit and redaction

`AuditLog` (`src/main/mcp/audit.ts`): one line per connection, tool call and change outcome: time, client name (self-reported, truncated), tool, target (agent id, or the folder fingerprint `folderFingerprint` from `src/main/usagetotalsstore.ts:29` plus the display name, **never the full path**, FR-055), status. Last 100, in memory, cleared on quit; shown in Settings as *Recent MCP activity* (Q12). When `DURBAR_LOG` is set, the same lines go through `createDebugSink` (`src/shared/redact.ts:78`). Every string goes through `redact()` (`src/shared/redact.ts:57`). New `maskSecretArgs(args)` in `src/shared/redact.ts` masks the value after `--token`, `--key`, `--secret`, `--password`, `--auth`, `--api-key` (and `--flag=value`), used for read tools, dialog and audit (FR-053); tests in `scripts/test-redact.ts`.

## Testing

- **Fake MCP client** (`scripts/fakes/mcp-client.ts`): plays a fixture handshake (initialize, initialized, tools/list) then scripted calls, through the bridge core (injected streams) and through a real socket/pipe in a temp folder; asserts every response shape.
- **Recorded handshakes**: `scripts/fixtures/mcp/{claude-code,copilot-cli,vscode,claude-desktop}.json`, synthetic until T061; each file has `provenance`. Also malformed, oversized (over 64 KB), burst (over 10/s) and unknown-method cases.
- **Main-process simulator** for read and change tools end to end with `FakeAdapter` and the tracker.
- **Pure units**: paths for three OSes, auth, framing, protocol, queue with a fake clock (every status), identity matcher, audit, redaction, agent state table.
- **SC-004 sweep** (T043): planted env value, header value, extra secret, connection key and a `--token` argument across every read tool, change result, dialog model, `office:changed` payload and audit line.
- **Real bridge in CI** (T019): the built Electron binary with the bridge flag, `initialize` and `tools/list` over stdio, on all three runners.
- **Window push** (T035, T038): each Apply produces the right `office:changed` payload.
- **UI**: `scripts/shots-041.js` (dialogs and Settings at 1440x900 and 1280x800), `scripts/check-dialog-focus.js` extended for the Apply delay and Deny default, `npm run check:office` unchanged.
- **Never**: real Copilot/Claude/Codex sessions, `npm run smoke`, `scripts/capture-raw.ts`.

## Phased approach

| Phase | Needs | Content | Tasks | Credits |
| --- | --- | --- | --- | --- |
| **1 Transport, handshake, read tools** | spec merged | paths, key file, framing and protocol, read-only tool registry, agent state in main, `DURBAR_SIM_MAIN`, read tools with FR-053 masking, server lifecycle, bridge entry and its CI test, Settings on/off section | T010-T020 | none |
| **2 Change tools with dialog and safeguards** | Phase 1 | move inline handler bodies, request queue (FR-051), change tools for mode and caps, folders, extras (FR-050, FR-060), push to the window (FR-059), main-owned dialog (FR-052), then switch the change tools on and test end to end | T030-T038 | none |
| **3 Away from agents, audit** | T040 after T010 and T030, T041 after T010; **T040 and T041 block any release (D-a)** | bridge matcher and `disabledMcpServers`, extras refusal, runtime marker, audit list, SC-004 sweep, FR-056 display | T040-T044 | none |
| **4 Docs and screenshots** | Phases 2 and 3 | screenshots of the dialogs and Settings at 1440x900 and 1280x800, README, CHANGELOG, specs index, spec tags, converge | T050-T052 | none |
| Backlog | owner, or a later adapter | peer-process refusal (FR-056), recorded client handshakes and per-OS checks, Codex ambient config, Claude marker | T060-T063 | none (T061 runs real clients, no prompts) |

**Release rule (D-a):** no release ships any part of this feature, Phase 1 included, before T040 and T041 are merged. Merging task by task behind the off-by-default switch is fine. Change tools stay unlisted until T038 (FR-064), so a build between T030 and T038 cannot ask for changes at all.

## Risks

| Risk | Likelihood | Effect | Mitigation |
| --- | --- | --- | --- |
| Electron as a stdio bridge: slow start, a Dock icon flash on macOS, stdio on a Windows GUI executable | medium | clients time out or the bridge is unusable on one OS | first lines of `main.ts` branch before any setup; separate `userData`, GPU off; `app.dock.hide()`; CI test on three OSes (T019); fallback (c) `ELECTRON_RUN_AS_NODE` via a spec delta; `[KNOWN GAP]` until checked per OS (T061) |
| macOS Dock icon flash before `dock.hide()` runs, and Gatekeeper quarantine of an unsigned download blocking a client-launched start (no dialog the user sees) | medium | a flicker at every client start; the bridge silently fails on a fresh download until the app was opened once | README note (open the app once first); record both in T061; signing is a separate owner decision |
| Agent state in main drifts from the renderer's | medium | wrong "waiting" answers | table test citing `app.js` lines; converge re-check; later move the renderer onto it |
| Same-user process reads the key file or reaches the socket | high (by design) | read tools leak office data; no change without a click | FR-035 text; FR-022 gate; FR-050 removes the two privilege jumps; FR-056 peer check backlog (T060) |
| Windows named pipe squatting or default pipe ACL (Everyone read) | low | a fake server or a reader | mutual HMAC so the key never crosses the wire; nothing but the server nonce is sent before auth; 2 s handshake timeout (the pipe name protects nothing) |
| Unix socket path over 104/108 bytes (long macOS user names) | medium | server cannot listen | length check and per-user tmp fallback in `mcpPaths`, tested |
| Dialog fatigue or a prompt-injected client spamming requests | medium | the user clicks Apply by habit | one at a time, Deny default, 1 s arming in main, Deny all, 60 s repeat refusal, 5 waiting besides the one on screen, no Allow all or new trust over MCP |
| MCP protocol revisions change; clients reject the version | medium | handshake fails | supported-version list in one constant; fixtures per client; T061 records real handshakes |
| Moving inline IPC bodies changes window behaviour | low | regressions | move verbatim like `agentops.ts` did; existing tests plus new op tests in the same task |
| Bridge matcher misses a wrapped command | low | a Copilot agent gets the server | match the flag token in any argument; marker as a second layer; FR-022 as the gate |

## Spec contradictions

The contradictions found while planning were settled in spec.md: the **consistency pass** (`## Changes` 2026-10-18; newer review rules win, FR-057, FR-058) and the **analyze fixes** (`## Changes` 2026-10-18; D-a..D-d, FR-059..FR-064, in-place fixes of superseded text). This plan follows both. None is open.

# Research: 058 MCP servers in a session (status words, Restart, last error, log folder)

Checked 2026-10-20 by reading only. **Nothing was run against a real account, no session was started, no credits were spent, and no
user log file was opened.** Sources:

- Copilot: `@github/copilot-sdk` **1.0.22** as pinned in `package.json:121` (runtime 1.0.98), types in
  `node_modules/@github/copilot-sdk/dist/generated/{rpc,session-events}.d.ts` and its `README.md`; GitHub docs, *Copilot CLI
  configuration directory* (`docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference`).
- Claude Code: no SDK in `node_modules` (Durbar speaks the CLI's stream-json control protocol, spec 012 research 2.3). The
  installed CLI **2.1.304** (`~/.local/share/claude/versions/2.1.304`, strings only, the program file, not user data), and
  the docs `code.claude.com/docs/en/agent-sdk/typescript`, `/mcp`, `/cli-reference`, `/claude-directory`.
- Codex: `openai/codex` on GitHub at `main` `0144894` (read through the API): `codex-rs/app-server-protocol/src/protocol/common.rs`,
  `.../v2/mcp.rs`, `codex-rs/protocol/src/protocol.rs`, `codex-rs/core/src/config/mod.rs`, `codex-rs/app-server/README.md`,
  `docs/install.md`; the developer docs page *Advanced configuration*. Durbar's minimum is Codex 0.163 (`src/adapters/detect.ts:47`);
  `main` may be newer than what users run.

Legend: `read:` = read in types, docs or a program's strings only, never exercised; `real:` = observed on a real account
(earlier specs, cited); `code:` = what Durbar's own code does today (file:line).

## 1. What Durbar does today (code)

| Topic | Today | Where |
| --- | --- | --- |
| Per-agent MCP dialog | Title *MCP servers for <name>*; one row per server: name, origin tag, the **raw status token** (`connected`, `pending`, `failed`, ...) or "not started", the error cut to 160 characters, one switch. No Restart, no log, no "how does it start". | `src/renderer/screens.js:633-656` |
| Intro text | "This agent is running: a switch applies right away." for every adapter that can switch. **Wrong for Codex**, whose switch applies with the next message (spec 012 FR-147). | `src/renderer/screens.js:645` |
| Dialog refresh | Reloads only after a click on a switch; status changes that arrive while it is open are not shown. | `src/renderer/screens.js:648-651` |
| Data to the renderer | `agents:mcp` builds `AgentMcpEntry {name, origin, status?, error?, defaultOn, off}` from the last `mcp` event. **The error text is passed through as the runtime gave it (cut to 300 characters in the adapters), not masked with `redact()`.** | `src/main/mcpipc.ts:124-145`, `src/shared/api.ts:372-383`, `src/adapters/map.ts:291-293`, `src/adapters/claudeMap.ts:87-97`, `src/adapters/codexMcp.ts:46-52`, `src/adapters/codex.ts:829-835` |
| Switch | `agents:setMcp` -> `setMcpOp` -> `adapter.setMcpEnabled`; the choice is kept per agent id for this run. | `src/main/mcpipc.ts:146`, `src/main/agentops.ts:77-95` |
| Normalized status | `McpServerStatus {name, status, source?, transport?, error?}`; status words in the comment: connected, failed, needs-auth, pending, disabled, stopped, not_configured. | `src/adapters/types.ts:249-263` |
| Capabilities | `mcpStatus`, `mcpToggle` only. | `src/adapters/capabilities.ts:33-35` |
| Copilot mapping | `session.mcp_servers_loaded`, `session.mcp_server_status_changed` (status, error), `session.mcp_server_removed`. `errorClassification` and `session.mcp_server_needs_reconnect` are ignored. | `src/adapters/map.ts:182-191` |
| Claude mapping | `system/init.mcp_servers` and the `mcp_status` reply. `init.mcp_server_errors` is ignored. | `src/adapters/claudeMap.ts:197-201`, `src/adapters/claude.ts:630-650` |
| Codex mapping | `mcpServerStatus/list` (`runtimeStatus`, `authStatus`, `toolsError`) and `mcpServer/startupStatus/updated` (`status`, `error`). `failureReason` is ignored. | `src/adapters/codexMcp.ts:36-52`, `src/adapters/codex.ts:829-835, 955-966` |
| End and resume | *End session* calls `adapter.stop(id)` (`src/main/main.ts:587-591`). The next message (or `agents:wake`) calls `ensureLive`, which starts the **same id** with the current `startOptionsFor(a)` (so the current MCP choices), quietly (`src/main/main.ts:284-305`). Each adapter resumes an id that has history: Copilot `getSessionMetadata` then `resumeSession` (`src/adapters/copilot.ts:452-462`), Claude `--resume` when the session file exists (`src/adapters/claude.ts:542-546`), Codex the prior thread (`src/adapters/codex.ts:428-434`). |
| Grants and remote at End | "Approve for this session" grants are dropped when a session ends (constitution III); remote control is turned off first (`src/main/main.ts:589`, spec 054 FR-003). |
| Opening folders | Electron `shell` is used only for `openExternal` today; there is no "reveal in file manager". | `src/main/main.ts:223, 772, 778, 876` |
| Copilot config folder | `copilotDir()` is `DURBAR_COPILOT_DIR` (tests) or `~/.copilot`; it **does not read `COPILOT_HOME`**. | `src/main/mcpfiles.ts:19` |
| Simulator | Sim kinds: Claude and Codex have `mcpToggle: false` although the real adapters have `true` (`src/adapters/claude.ts:65`, `src/adapters/codex.ts:56`). Sim statuses are only `connected` / `disabled` / none. | `src/renderer/sim.ts:123-127, 798-816` |

## 2. Copilot (SDK 1.0.22)

All `session.rpc.mcp.*` methods are marked `@experimental` (`rpc.d.ts:33663`).

| Method | What the types say | Use in 058 | Evidence |
| --- | --- | --- | --- |
| `list()` | Servers with `status`, `source`, `url`, `error` (`McpServer`, `rpc.d.ts:16699-16730`). "Cache misses may start and wait for MCP servers." | Not needed: events already give the list. | `read:` `rpc.d.ts:33670` |
| `listConfigured()` | Effective config without starting anything. | No. | `read:` `rpc.d.ts:33676` |
| `listTools({serverName})` | Live `tools/list`. | No (later: tool count). | `read:` `rpc.d.ts:33684`; `real:` spec 019 research |
| `enable({serverName})` / `disable({serverName})` | Enable/disable for the session. | Already the switch. | `read:` `rpc.d.ts:33690-33696`; `real:` spec 019 research ("took effect live ... did not write anything to `~/.copilot`") |
| `reload()` | "Reloads MCP server connections for the session." All servers. | No (per-server restart exists). | `read:` `rpc.d.ts:33700` |
| `startServer({serverName, config?})` | "Starts an individual MCP server on the live session ... Session-scoped and ephemeral ... Does NOT modify persistent user configuration." | Possible *Start* for a `stopped` server; not needed if Restart covers it. | `read:` `rpc.d.ts:33742`, request `rpc.d.ts:16783-16796` |
| `restartServer({serverName, config?})` | "Restarts an individual MCP server on the live session (stops then starts) ... Session-scoped and ephemeral." | **Per-server Restart.** | `read:` `rpc.d.ts:33748`, request `rpc.d.ts:16666-16676` |
| `stopServer({serverName})` | "Stops an individual MCP server **on the session's host**." No "session-scoped" wording, unlike start and restart. | **Not used** (Q2): Durbar runs one shared Copilot runtime for all its Copilot sessions, so "host" may mean every session. | `read:` `rpc.d.ts:33754`, request `rpc.d.ts:16822-16832` |
| `isServerRunning({serverName})` | `{running}`: "has an active client and transport". | Optional check after Restart. | `read:` `rpc.d.ts:33762`, result `rpc.d.ts:15672-15677` |
| `oauth.*`, `headers.*`, `apps.*`, `resources.*`, `executeSampling`, `setEnvValueMode`, `removeGitHub`, `moveLoadingToBackground` | Sign-in, MCP Apps, sampling, etc. | Out of scope (sign-in stays spec 019's `[KNOWN GAP]`). | `read:` `rpc.d.ts:33706-33860` |
| `session.rpc.debug.collectLogs(...)` | "Collects a session debug log bundle into a local archive or staging directory. Logs are redacted by default." | **Rejected**: it copies log files into a new archive, which this feature must not do. | `read:` `rpc.d.ts:33006-33012`, options `rpc.d.ts:10405-10437` |

Status values (`McpServerStatus`, `session-events.d.ts:1550-1565`): `connected`, `failed`, `needs-auth`, `pending`, `disabled`,
`stopped` ("not running: it may not have started yet, may have been explicitly stopped, or may be quarantined by restrictive managed
policy. It can be restarted on demand when policy permits"), `not_configured`.

Events: `session.mcp_server_status_changed` carries `error` and **`errorClassification`** ("Runtime-produced classification for the
final failed connection; ... Additional string values may be introduced", `session-events.d.ts:13301-13318`); the values are not
listed. `session.mcp_server_needs_reconnect {serverName}` (`session-events.d.ts:13387-13397`) is not mapped today.

When servers start: with the session (create or resume); spec 019 research saw `session.mcp_servers_loaded` right after session
creation with no prompt (`real:`). In Durbar a new agent's session is created when the folder is added (`src/main/main.ts:267`);
a restored agent's session is created when its chat is opened (`agents:wake`) or with its first message (`ensureLive`,
`src/main/main.ts:284-305, 1222-1230`).

Resume and cost: `resumeSession(id, config)` takes the same `mcpServers` / `disabledMcpServers` as create (`read:` spec 019 research
row 1; the resumed-with-new-servers case was not exercised). Session creation and resume are RPCs with no model call: spec 019's probe
counted only its one prompt (`real:` 0.167 AIU for 1 prompt, "everything else was session creation and RPC reads, which use no
credits"), and spec 013 resumed real sessions (`real:` 2026-10-19).

Logs: "Logs are stored in the `logs/` directory under `~/.copilot`. Each session creates a file named `process-{timestamp}-{pid}.log`"
and "`COPILOT_HOME` replaces the entire `~/.copilot` path" (GitHub docs above, `read:`). The SDK also sets `COPILOT_HOME` from its
`baseDirectory` option (`README.md:270`); Durbar does not set it, so the runtime uses the inherited environment. Whether a stdio
server's stderr ends up in that log is **not documented** (`[KNOWN GAP]`). No per-server log file is documented.

## 3. Claude Code (CLI 2.1.304, stream-json control protocol)

| Control request (wire) | SDK method | What it does | Evidence |
| --- | --- | --- | --- |
| `mcp_status` | `mcpServerStatus()` | List with `status` (`connected`, `failed`, `needs-auth`, `pending`, `disabled`), `error?`, `serverInfo?`, `config?`, `scope?`, `source?`, `tools?`. | `read:` docs *McpServerStatus*; `real:` spec 012 FR-133 |
| `mcp_toggle {serverName, enabled}` | `toggleMcpServer()` | "Disabling a server disconnects it and removes its tools." | `read:` docs; `real:` spec 012 FR-133 (off -> `disabled`, on -> `connected`, no prompt) |
| **`mcp_reconnect {serverName}`** | `reconnectMcpServer()` | "Reconnects a disconnected or failed MCP server." (schema description in the CLI). Docs: "Reconnect an MCP server by name"; the interactive `/mcp` menu's **Reconnect** "also discards the cached tool list". | `read:` CLI 2.1.304 strings (`reconnectMcpServer(e){await this.request({subtype:"mcp_reconnect",serverName:e})}` and the schema `"Reconnects a disconnected or failed MCP server."`); docs `/agent-sdk/typescript`, `/mcp` |
| `mcp_set_servers` | `setMcpServers()` | Replace servers added through it. | `read:`; not needed (Durbar passes `--mcp-config` at launch) |
| `mcp_authenticate`, `mcp_clear_auth`, `mcp_oauth_callback_url`, `mcp_read_resource`, `mcp_message` | sign-in, resources | Out of scope. | `read:` CLI strings |

Errors: `McpServerStatus.error`; in stream-json runs "skipped `--mcp-config` servers appear in the `system/init` event's
`mcp_server_errors` field (requires v2.1.219 or later)" (`read:` docs `/mcp`), not mapped today. Claude Code "redacts credential-like
text" from the failure detail of `claude mcp list` / `claude mcp get` (`read:` docs `/mcp`); whether the same holds for `mcp_status`'s
`error` is not stated, so Durbar masks anyway.

When servers start: Durbar's Claude adapter starts nothing on `start()`; it launches the CLI (with `--mcp-config`,
`--strict-mcp-config`, and `--resume` when the session file exists) with the first message (`src/adapters/claude.ts:538-552, 700-740`).
So a Claude server is "not started" until the next message. A server that was off at launch is not in the CLI's config: switching it
on needs a relaunch with the next message (`src/adapters/claude.ts:638-641`, spec 012 FR-133).

Resume and cost: a relaunch with `--resume` and no prompt makes no model call (`real:` spec 012 FR-133, "no prompt"); the next message
pays as usual. Prompt-cache effects on that next message are not measured (`[KNOWN GAP]`).

Logs:
- `~/.claude/debug/`: "Per-session debug logs, written while debug logging is on, such as when you start with `--debug` or run
  `/debug`" (`read:` docs `/claude-directory`). Durbar does not pass `--debug`, so this folder holds nothing from Durbar's sessions.
  `--debug-file <path>` and `CLAUDE_CODE_DEBUG_LOGS_DIR` exist (`read:` docs `/cli-reference`); Durbar will not use them (they would
  make Durbar choose where vendor logs with possible secrets are written).
- Per-server folders: the CLI 2.1.304 has `mcpLogs:(t)=>join(<cache>/<project>, "mcp-logs-"+N(t))`, where `<cache>` is the
  `env-paths`-style cache folder of `"claude-cli"` (with its default `-nodejs` suffix) and `N()` replaces every character outside
  `[A-Za-z0-9]` with `-` (longer than 200 characters: cut and a hash added). By `env-paths` convention that is
  `~/.cache/claude-cli-nodejs/<project>/mcp-logs-<server>/` on Linux (`$XDG_CACHE_HOME` first),
  `~/Library/Caches/claude-cli-nodejs/...` on macOS and `%LOCALAPPDATA%\claude-cli-nodejs\Cache\...` on Windows.
  **`read:` from program strings only; undocumented; whether files are written there without `--debug` is unknown** (`[KNOWN GAP]`).

## 4. Codex (`codex app-server`)

| Method / notification | What it does | Use in 058 | Evidence |
| --- | --- | --- | --- |
| `mcpServerStatus/list {cursor?, limit?, detail?, threadId?, serverName?}` | Per server: `runtimeStatus` (`notStarted`, `starting`, `connected`, `authenticationRequired`, `failed`, `cancelled`; null when unavailable), `authStatus` (`unknown`, `unsupported`, `notLoggedIn`, `bearerToken`, ...), `toolsError`, `serverInfo`, `httpOrigin`. With `threadId` it "reuses the thread's current MCP connection". | Already used. | `read:` `v2/mcp.rs:19-108`, `common.rs:1271-1275`, README "MCP server capabilities"; `real:` spec 012 FR-147 |
| `mcpServer/startupStatus/updated {threadId?, name, status, error?, failureReason?}` | `status`: `starting`, `ready`, `failed`, `cancelled`; `failureReason`: `reauthenticationRequired`. | Already mapped; add `failureReason`. | `read:` `v2/mcp.rs:360-376`, `protocol.rs:3920-3922`, `common.rs:2028` |
| `config/mcpServer/reload {}` | Reloads MCP configuration for loaded threads ("an error does not imply that no changes were applied"). Global scope `mcp-registry`, **no server name**. | **Not in Phase 1** (Q8): not per-server, and whether it keeps the thread's `config.mcp_servers` overrides that Durbar passes is unknown. | `read:` `common.rs:1265-1269`, `v2/mcp.rs:286-291`, README "MCP configuration reload" |
| `mcpServer/oauth/login`, `mcpServer/resource/read`, `mcpServer/tool/call`, `mcpServer/event/stream/*` (experimental) | Sign-in, resources, direct tool calls, a server's notification stream. | Out of scope. `event/stream` carries MCP notifications, not logs. | `read:` `common.rs:1259-1300`, `v2/mcp.rs:156-198` |
| per-server start / stop / restart | **None** in the protocol. | Codex gets no per-server buttons. | `read:` `common.rs` (full client request list) |

When servers start: with `thread/start` / `thread/resume` (startup notifications follow); Durbar's quiet start reads the list with the
first message (`src/adapters/codex.ts:606, 620`, contract C3). A switch applies with the next message on a fresh child that resumes the
same thread (`src/adapters/codex.ts:612-617, 972-983`, spec 012 FR-144/FR-147).

Resume and cost: `thread/resume` starts no turn; Durbar's relaunch for a mode or MCP switch already does it with no extra prompt
(`real:` spec 012 FR-144/FR-147 checks on Codex 0.163).

Logs: "Directory where Codex writes log files (defaults to `$CODEX_HOME/log`)" (`read:` `core/src/config/mod.rs:998-999, 4225-4229`);
`CODEX_HOME` "defaults to `~/.codex`" (`read:` developer docs). But "The TUI records diagnostics in bounded local stores by default. Set
`log_dir` explicitly to enable a plaintext TUI log" (`read:` `docs/install.md:56-60`). What `codex app-server` writes there by default
is **unknown** (`[KNOWN GAP]`).

## 5. Per-adapter capability table (decision input)

| Control | Copilot | Claude Code | Codex |
| --- | --- | --- | --- |
| Status words | 7 states incl. `stopped`, `not_configured` (`read:` types; `real:` connected/failed/disabled in 019) | 5 states (`read:` docs; `real:` connected/disabled in 012) | 6 runtime states + startup states (`read:`; `real:` connected in 012) |
| How a server starts | With the session (folder added, chat of a restored agent opened, or first message) | With the **next message** (the CLI is launched then) | With the session; the list shows after the first message |
| Switch on/off (existing) | Live (`real:` 019) | Live; a server that was off at launch: next message (`real:` 012) | **Next message** (`real:` 012) |
| Per-server Restart | **Yes**: `rpc.mcp.restartServer` (`read:`, experimental) | **Yes**: `mcp_reconnect` (`read:` docs + CLI strings) | **No** |
| Per-server Start | Covered by Restart for a `stopped` server (`restartServer` "stops then starts"), or `startServer` (`read:`) | Switch on (`mcp_toggle`) | No (switch on, next message) |
| Per-server Stop | Switch off (`mcp.disable`, session-scoped, `real:`). `stopServer` not used (Q2) | Switch off (`mcp_toggle`, `real:`) | Switch off, next message |
| Failure text | `error` + `errorClassification` | `error` (+ `init.mcp_server_errors`) | `error` / `toolsError` + `failureReason`, `authStatus` |
| Restart the session with the new set | End + resume same id: conversation kept, no model call (`real:` 013/019) | End + `--resume`: conversation kept, no model call; servers start with the next message (`real:` 012) | End + `thread/resume`: conversation kept, no turn (`real:` 012) |
| Log folder | `<COPILOT_HOME or ~/.copilot>/logs` (`read:` docs); MCP stderr in it unknown | `<cache>/claude-cli-nodejs/<project>/mcp-logs-<server>` (`read:` program strings, undocumented); `~/.claude/debug` only with `--debug` | `<CODEX_HOME or ~/.codex>/log` (`read:` source); app-server content unknown |
| In-app masked log tail | Later phase, owner decision (Q5) | same | same |

## 6. Decisions proposed (pending the owner's answers in spec.md)

1. Keep the switch as the per-session Start/Stop and add **Restart** only where the runtime has a real per-server restart (Copilot,
   Claude). Codex gets none; every adapter that can resume gets **Restart session with these servers**.
2. Map every status to one plain word and one sentence in the renderer, from one pure table; the error is masked in main.
3. Logs: only **reveal the folder** in the system file manager, after main checks that it is an existing directory. Durbar never opens,
   reads, copies or uploads a log file in this feature.
4. Real checks: no-prompt only (0 credits), with a throw-away local stdio server, and only with the owner's go-ahead.

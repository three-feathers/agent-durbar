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
| `stopServer({serverName})` | "Stops an individual MCP server **on the session's host**." No "session-scoped" wording, unlike start and restart. | **Not used** (owner, Q2 A): Durbar runs one shared Copilot runtime for all its Copilot sessions, so "host" may mean every session. | `read:` `rpc.d.ts:33754`, request `rpc.d.ts:16822-16832` |
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

**Correction (real 2026-10-21, T060, SDK/runtime 1.0.22, Linux):** through Durbar's adapter the servers did **not** start at create or
resume: no `session.mcp_server_status_changed` and no server process for 30 s after `createSession` (20 s after a resume); they
started within about 60 ms of the first `send`. Spec 019's probe likely saw them early because it called `rpc.mcp.list()` ("Cache
misses may start and wait for MCP servers"), which Durbar does not call. So Copilot's `mcpStart` is `next-message` (spec *Changes*,
2026-10-21). Also seen: `restartServer` exists and works (`session.mcp_server_removed`, then `not_configured` -> `pending` ->
`connected`); a missing command gives `errorClassification: "os_not_found"`; its `restartServer` rejects with -32603 and the text
"Request session.mcp.restartServer failed with message: …"; a resume with a changed `mcpServers` applies the new set with the next
message; `~/.copilot/logs` exists (existence only).

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
| `mcpServerStatus/list` item `McpServerStatus` | `runtimeStatus`, `authStatus`, `toolsError`, `httpOrigin`, `pluginId`; **no `failureReason`**. | `read:` codex-cli 0.163.0 `generate-ts` `v2/McpServerStatus.ts` (2026-10-21, PR #481 review). | |
| `mcpServer/startupStatus/updated {threadId?, name, status, error?, failureReason?}` | `status`: `starting`, `ready`, `failed`, `cancelled`; `failureReason`: `reauthenticationRequired`. | Already mapped; add `failureReason`. | `read:` `v2/mcp.rs:360-376`, `protocol.rs:3920-3922`, `common.rs:2028` |
| `config/mcpServer/reload {}` | Reloads MCP configuration for loaded threads ("an error does not imply that no changes were applied"). Global scope `mcp-registry`, **no server name**. | **Not used** (owner, Q8 A): not per-server, and whether it keeps the thread's `config.mcp_servers` overrides that Durbar passes is unknown. | `read:` `common.rs:1265-1269`, `v2/mcp.rs:286-291`, README "MCP configuration reload" |
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
| In-app log viewer | No (owner, Q5 A) | No | No |

## 6. Decisions (confirmed by the owner on 2026-10-20: Q1-Q11 all option A, spec.md *Clarifications*)

1. Keep the switch as the per-session Start/Stop and add **Restart** only where the runtime has a real per-server restart (Copilot,
   Claude). Codex gets none; every adapter that can resume gets **Restart session with these servers**.
2. Map every status to one plain word and one sentence in the renderer, from one pure table; the error is masked in main.
3. Logs: only **reveal the folder** in the system file manager, after main checks that it is an existing directory. Durbar never opens,
   reads, copies or uploads a log file in this feature.
4. Real checks: no-prompt only (0 credits), with a throw-away local stdio server, and only with the owner's go-ahead.
5. Review notes from PR #359 (Vikram's agent, non-blocking, 2026-10-20): the log folder must resolve (realpath) under the vendor's own
   root (spec FR-026); a sign-in failure on Restart session goes to spec 012 FR-157's sign-in card (spec FR-027).

## 7. Delta 2026-10-20: MCP OAuth sign-in (issue #364)

Checked 2026-10-20 by reading only. **No session was started, no credits were spent, and no user config, token, keychain or log file
was opened.** Sources (program files and public docs only):

- Copilot: `@github/copilot-sdk` **1.0.22** (`package.json:121`), runtime **1.0.98**: `node_modules/@github/copilot-sdk/dist/generated/rpc.d.ts`,
  `.../session-events.d.ts`, `dist/types.d.ts`, `dist/client.js`, `dist/session.js`, `README.md`; the runtime program's strings
  (`node_modules/@github/copilot-sdk-linux-x64/prebuilds/linux-x64/runtime.node`, `strings` only); GitHub docs *GitHub Copilot CLI
  command reference* (`docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference`, sections "Slash commands",
  "OAuth re-authentication", `copilot login`).
- Claude Code: the docs `code.claude.com/docs/en/mcp` ("Authenticate with remote MCP servers", "Authenticate from the command line") and
  `/agent-sdk/typescript`; the installed CLI **2.1.304** program's strings (the program file, not user data).
- Codex: `openai/codex` at `main` `0144894` (2026-10-20, through the GitHub API): `codex-rs/app-server-protocol/src/protocol/v2/mcp.rs`,
  `.../common.rs`, `codex-rs/app-server/README.md` ("MCP OAuth login", "Enterprise sign-in"), `codex-rs/cli/src/mcp_cmd.rs`,
  `codex-rs/config/defaults.toml`, `codex-rs/core/src/config/mod.rs`.

### 7.1 What Durbar does today (code)

| Topic | Today | Where |
| --- | --- | --- |
| Status `needs-auth` | Passed through from Copilot and Claude; Codex `authenticationRequired` and `authStatus: notLoggedIn` become `needs-auth`. The dialog shows the raw token. | `src/adapters/map.ts:182-191, 291-293`, `src/adapters/claudeMap.ts:87-97`, `src/adapters/codexMcp.ts:33, 47`, `src/renderer/screens.js:633-656` |
| Codex `failureReason` | Not read (`reauthenticationRequired` is lost). | `src/adapters/codex.ts:829-835` |
| Failed MCP tool | `tool.execution_complete.error.message` becomes the card's output; nothing marks the server. | `src/adapters/map.ts:117-122`, card `src/renderer/app.js:2062` |
| Masking | `mcp` events are masked in main (spec 019 FR-021, #362); **tool output is not**. | `src/main/main.ts:123`, `src/main/mcpmask.ts` |
| App sign-in classifier | `/\b401\b/` is a sign-in failure, so the issue's text would read as "Copilot needs you to sign in again" if it ever arrived as an `error` status. | `src/adapters/autherrors.ts:13, 35-41, 52-57` |
| Opening a URL | `shell.openExternal` only for http(s) links (`app:openExternal`), a setup page, a harness sign-in host, and an elicitation's own https URL held in main (FR-154). | `src/main/main.ts:223-227, 772-781, 873-879`; `elicitHttpsUrl` `src/shared/elicit.ts:155-164` |
| Copilot OAuth hooks | None: no `onMcpAuthRequest`, no `mcpOAuthTokenStorage` in the session config. | `src/adapters/copilot.ts:431-447` |

### 7.2 Copilot (SDK 1.0.22)

| Item | What the types or docs say | Use | Evidence |
| --- | --- | --- | --- |
| `session.rpc.mcp.oauth.login(McpOauthLoginRequest)` | "Starts OAuth authentication for a remote MCP server ... manual servers retain the existing direct login behaviour." Request: `serverName`, optional `forceReauth`, `clientName` ("callers driving interactive auth should pass their own surface-specific label"), `callbackSuccessMessage`, `clientId`, `clientSecret`, `publicClient`, `grantType`, `redirectUri`, `loginId`, `expectedInstallationId`. Result `authorizationUrl?`: "URL the caller should open in a browser ... Omitted when cached tokens were still valid ... the server is already reconnected. For the default loopback flow, the runtime starts its listener before returning ... signals completion via session.mcp_server_status_changed." | **Yes** (FR-064) with `serverName`, `clientName`, `callbackSuccessMessage` only. | `read:` `rpc.d.ts:33787-33794` (method), `15837-15877` (request), `15888-15900` (result) |
| `oauth.prepareLogin` / `cancelLogin` | For **owned** installations (`expectedInstallationId`); "Manual MCP OAuth retains its direct `login` path." | No: Durbar's servers are configuration, not owned installations. Hence no cancel for a manual login. | `read:` `rpc.d.ts:33780-33786, 33810-33816`; SDK `README.md:328-333` |
| `oauth.handlePendingRequest`, `oauth.respond`, event `mcp.oauth_required`, `onMcpAuthRequest` | The **host** acquires a token and hands it to the runtime (`McpAuthToken.accessToken`). The SDK registers interest in `mcp.oauth_required` only when `onMcpAuthRequest` is set. | **Never** (Durbar would handle a token; constitution III). | `read:` `rpc.d.ts:33766-33772, 33818-33824`; `types.d.ts:1738-1779, 2283-2288`; `client.js:1401-1405`; `session.js:835-846` |
| `oauth.complete` (host-managed `redirectUri`) | The host receives the callback URL (with the code) and passes it on. | **Never** (the code would pass through Durbar). | `read:` `rpc.d.ts:33795-33801, 15793-15803` |
| `oauth.probe` | "Passively probes ... whether OAuth is required ... Does not start OAuth ... or mutate MCP connection state." | Not now (a network call per dialog open); a later option to confirm a derived needs-auth. | `read:` `rpc.d.ts:33802-33808, 3379-3411` |
| `mcpOAuthTokenStorage` (session config) | `"persistent"` = "tokens are stored in the OS keychain (shared across sessions)"; `"in-memory"` = "discarded when the session ends"; `@default "in-memory"`. Durbar does not set it. | `persistent` (Q12 B, FR-070). | `read:` `types.d.ts:2386-2393`; `client.js:1341, 1625` |
| Status `needs-auth`, `errorClassification` | `McpServerStatus` includes `needs-auth`; `errorClassification` values are not listed ("Additional string values may be introduced"). | FR-060 (status); the auth value of `errorClassification` stays unknown. | `read:` `session-events.d.ts:1550-1565, 13301-13319` |
| Tool error shape | `ToolExecutionCompleteError {code?, message, remediation?}`; `RemediationAction` values are about the Copilot account and sandbox (`sign_in` = "Authenticate again with the Copilot backend"), not MCP. | FR-061 reads `message`; `remediation: sign_in` must **not** be read as an MCP sign-in. | `read:` `session-events.d.ts:7564-7574, 64-76` |
| Runtime texts | `MCP tool catalog changed before tool "`, `Failed to verify cached MCP tools: `, `MCP OAuth challenge required (HTTP `, `MCP server "<name>" requires authentication. Run \`/mcp auth <name>\` to authenticate.`, `Re-authentication required for MCP server "<name>". Run /mcp auth <name>`. | FR-061 phrases. | `real:` issue #364 (first text); `read:` `runtime.node` strings (all) |
| CLI sign-in | `/mcp [config|list|show|add|edit|delete|disable|enable|auth|reload|search] [SERVER-NAME]`; "Use `/mcp auth <server-name>` to trigger a fresh OAuth flow. This opens a browser ... After completing the flow, the server reconnects automatically." `copilot mcp` subcommands are `list`, `get`, `add`, `enable`/`disable`, `remove`: **no** `copilot mcp login`. | FR-068 Copilot steps. | `read:` GitHub docs (command reference, "Slash commands", "OAuth re-authentication", "`copilot mcp` subcommands") |
| Where the CLI keeps MCP tokens | Not stated for MCP. The SDK says `persistent` = OS keychain. (The docs' "system credential store ... or a plain text configuration file under `~/.copilot/`" is about the Copilot account login, not MCP.) | Durbar never touches either. | `read:` as above; `[KNOWN GAP]` |

### 7.3 Claude Code (CLI 2.1.304)

| Item | What the docs or program say | Use | Evidence |
| --- | --- | --- | --- |
| Control request `mcp_authenticate {serverName, redirectUri?}` | The CLI's own SDK sends it (`mcpAuthenticate(e,s){... subtype:"mcp_authenticate",serverName:e,redirectUri:s ...}`). The stream-json control loop handles it: finds the configured server (including `--mcp-config` ones), refuses a managed-policy block, then starts the OAuth flow with `skipBrowserOpen: true` and answers `{authUrl, requiresUserAction: true, callbackExpected: true, redirectScheme, state, callbackPort}` for its localhost callback, or `{requiresUserAction: false}` when no browser step is needed. After the callback it reconnects the server ("Authentication successful. Reconnected to"). | **Yes** (FR-064), with no `redirectUri`. | `read:` CLI 2.1.304 strings only (handler next to `set_prompt_suggestions_paused` and `channel_enable`); **not in the SDK docs** |
| Docs on `-p` / SDK runs | "A `claude -p` or Agent SDK run has no `/mcp` panel, so Claude Code can't run the OAuth flow there. ... complete the sign-in from an interactive session first: run `/mcp` in the session, or `claude mcp login <name>` in your shell." | Contradicts the strings above: settle in T106 before building past the fake. | `read:` docs `/mcp` |
| `mcp_oauth_callback_url {serverName, callbackUrl}` | Paste a callback URL when the localhost redirect fails ("call mcp_authenticate first"). | No (the browser and the CLI are on the same computer). | `read:` CLI strings |
| `mcp_clear_auth {serverName}` | Clears stored credentials. | No (Q19). | `read:` CLI strings |
| Status `needs-auth` | `McpServerStatus.status: "connected" | "failed" | "needs-auth" | "pending" | "disabled"`; "Claude Code marks a remote server as needing authentication when the server responds with `401 Unauthorized` or `403 Forbidden`" (not when the user configured an `Authorization` header). | FR-060. | `read:` docs `/agent-sdk/typescript`, `/mcp` |
| Terminal sign-in | `claude mcp login <name>` ("runs a configured server's OAuth flow directly from your shell"), `--no-browser`, `claude mcp logout <name>`; or `/mcp` > Authenticate. "Claude Code stores OAuth sign-ins per endpoint"; "Authentication tokens are stored securely and refreshed automatically". | FR-068 Claude steps. Reuse for Durbar's `--mcp-config` copy of a server: unverified. | `read:` docs `/mcp` |

### 7.4 Codex (`codex app-server`)

| Item | What the source says | Use | Evidence |
| --- | --- | --- | --- |
| `mcpServer/oauth/login` | Params `name`, `threadId?`, `clientRegistration?` (`auto`/`cimd`/`dcr`), `scopes?`, `timeoutSecs?`; response `authorizationUrl`, `loginId?`. README: "only returns HTTP(S) authorization URLs"; "Call `mcpServer/oauth/login` with a directly configured server's `name` and its connected `threadId`. Open the returned `authorizationUrl` and match `mcpServer/oauthLogin/completed` by `loginId`. ... Use `account/login/cancel` to cancel explicitly. Start a fresh session after success to use the saved grant." | **Yes** (FR-064) with `name`, `threadId`. Whether Durbar's thread `config.mcp_servers` override counts as "directly configured" is unknown (T107). | `read:` `v2/mcp.rs:296-332`, `common.rs:1259-1263`, README "MCP OAuth login", "Enterprise sign-in" |
| `mcpServer/oauthLogin/completed` | `name`, `threadId?`, `loginId?`, `success`, `error?`. | FR-064 completion. | `read:` `v2/mcp.rs:343-355`, `common.rs:2027` |
| Status fields | `McpAuthStatus`: `unknown`, `unsupported`, `notLoggedIn`, `bearerToken`, `oAuth`; `McpServerStartupFailureReason`: `reauthenticationRequired`; `McpServerConnectionStatus` includes `authenticationRequired`. | FR-060. | `read:` `v2/mcp.rs:18-40, 370-378` |
| Token store | `mcp_oauth_credentials_store = "auto"` by default: "keyring if available, otherwise file" (`CODEX_HOME/.credentials.json`). | Durbar never touches it. | `read:` `config/defaults.toml:8`, `core/src/config/mod.rs:930-935` |
| Terminal sign-in | `codex mcp login <name>` ("authenticate with MCP server using OAuth"), `--no-browser`, `--scopes`, `--oauth-client-registration`; `codex mcp logout <name>`. | FR-068 Codex steps (servers in Codex's `config.toml`). | `read:` `cli/src/mcp_cmd.rs:62-80, 213-233` |
| URL elicitation (spec 012 FR-147/FR-151/FR-154) | An MCP server may ask for a URL step through `mcpServer/elicitation/request` with `mode: 'url'`; Durbar already shows it with **Open in browser** (https only, held in main). That is the server's own request inside a working connection, not the transport's OAuth; it stays as built. | Reused pattern for FR-065. | `code:` `src/adapters/codex.ts:888-915`, `src/main/main.ts:873-879` |
| Version | Durbar's minimum is Codex 0.163 (`src/adapters/detect.ts:47`); `main` may be newer. | Feature-detect; an unknown method gives the manual steps. | `[KNOWN GAP]` |

### 7.5 Per-adapter decision table

| | Copilot | Claude Code | Codex |
| --- | --- | --- | --- |
| Durbar can start the runtime's own flow | Yes: `oauth.login` (`read:`, experimental) | Probably: `mcp_authenticate` (`read:` strings; docs say no for `-p`) | Yes: `mcpServer/oauth/login` (`read:`; Durbar's overrides unknown) |
| URL given back to Durbar | `authorizationUrl` | `authUrl` | `authorizationUrl` |
| Callback and token exchange | runtime loopback | CLI localhost | Codex callback listener |
| Durbar touches a token | No | No | No |
| Completion signal | `session.mcp_server_status_changed` | `mcp_status` (asked again) | `mcpServer/oauthLogin/completed`, then a fresh child |
| Cancel | none for a manual login | none documented | `account/login/cancel` |
| Needs-auth signals | status, tool error text | status | status, `authStatus`, `failureReason` |
| Manual fallback | `copilot` then `/mcp auth <name>` | `claude mcp login <name>` | `codex mcp login <name>` |
| Token kept by | runtime (keychain: Durbar sets `persistent`, Q12 B) | CLI (per endpoint) | Codex (keyring or file) |

### 7.6 Decisions (confirmed by the owner on 2026-10-20: Q12 B, Q13-Q19 A, spec.md *Clarifications*)

1. Start each runtime's own flow on an explicit click; main holds the address, the window gets the host; https only; never a
   token-carrying call (`handlePendingRequest`, `onMcpAuthRequest`, `oauth.complete`, `mcp_oauth_callback_url`).
2. Map the issue's 401 to the server's needs-auth from the tool failure (Copilot), and keep it out of the app sign-in classifier.
3. Offer **Switch off for this session** next to every needs-auth signal; mask the failed tool card.
4. Real checks need a remote MCP server with OAuth and a browser sign-in on the owner's machine; they send no prompt (0 AI credits) but
   use real accounts, so they wait for the owner (T105-T107).
5. Owner answers (2026-10-20): Copilot sessions set `mcpOAuthTokenStorage: 'persistent'` (Q12 B); two-step open (Q13); Sign in in the
   dialog row, the card opens the dialog there (Q14); Claude not launched: "Send a message first" + steps (Q15); https only (Q16);
   switch-off offered, never automatic (Q17); Codex "applies with your next message" (Q18); no "another account" (Q19).

### 7.7 Real check on CI runners (T116, 2026-10-21)

Workflow *MCP OAuth real check* (`.github/workflows/mcp-oauth-real.yml`, manual), demo server `scripts/demo-oauth-mcp.ts`, check
`scripts/mcp-oauth-real.ts`. 0 prompts. Results (filled in from the runs):

| Runner | Runtime | A: first state | A: `oauth.login` | A: after the browser step | A2 (same runtime) | B (new runtime) | Keychain / files | Run |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `windows-latest` (win32 10.0.26100 x64, Node 22.23.3) | 1.0.22 (SDK 1.0.22) | `needs-auth` (1 s) | authorization URL on the demo's `/authorize` | `connected` (1 s); demo: +1 registration, +1 `/authorize`, +1 code grant; tool `demo_echo` | `connected`, +0 `/authorize`, +0 grants | **`connected`, +0 `/authorize`, +0 grants (PASS)**; tool `demo_echo` | Credential Manager 1 -> 3 targets: two `LegacyGeneric:target=<64 hex>.copilot-mcp-oauth`; file `~/.copilot/mcp-oauth-config/<hex>.json` | [39680461023](https://github.com/three-feathers/agent-durbar/actions/runs/39680461023) |
| `ubuntu-latest` (linux 7.0.0-1017-azure x64, Node 22.23.3) | 1.0.22 (SDK 1.0.22) | `needs-auth` (1 s) | authorization URL on the demo's `/authorize` | `connected` (1 s); demo: +1 registration, +1 `/authorize`, +1 code grant; tool `demo_echo` | `connected`, +0 `/authorize`, +0 grants | **`connected`, +0 `/authorize`, +0 grants (PASS)**; tool `demo_echo` | no keychain entry; files `~/.copilot/mcp-oauth-config/<hex>.json` and two `<hex>.tokens.json` | [39680461023](https://github.com/three-feathers/agent-durbar/actions/runs/39680461023) |

- `real:` 2026-10-21, run 39680461023 (commit f9458b31, Copilot runtime and SDK 1.0.22, 0 prompts): **FR-070 PASS on Windows and
  Linux.** Session A signed in once (`oauth.login` with `serverName`, `clientName`, `callbackSuccessMessage` only; one registration,
  one `/authorize`, one code grant); A2 in the same runtime and B in a NEW runtime process connected with no new `/authorize`, no new
  grant and no refresh. One 401 each; the settled state was connected within 1 s; transient states were not recorded (the check
  sampled the latest `mcp` event once a second, so a short `needs-auth` before `connected` would not show; review on #478). Since
  2026-10-22 the script logs every `mcp` state per session in order; that runs on the next dispatch (not dispatched yet). Whether a
  tool call with a cached tool catalog and a kept token gets a 401 (the text of #364) stays unverified: it needs a prompt.
- `real:` Windows: `persistent` storage writes Windows Credential Manager generic credentials named
  `<64 hex>.copilot-mcp-oauth` (two new targets for one demo server) plus a client file `~/.copilot/mcp-oauth-config/<hex>.json`
  (names only; no value was read).
- `real:` Linux runner with no desktop keyring (GitHub `ubuntu-latest`): no keyring entry; the runtime fell back to files
  `~/.copilot/mcp-oauth-config/<hex>.json` and `<hex>.tokens.json` (names only; contents not read, so "tokens" is inferred from the
  name). On such a Linux machine the kept MCP sign-in is a file in the user's home folder, not a keyring entry. `[KNOWN GAP]`
  whether that file is encrypted and what its permission bits are was not checked. Since 2026-10-22 the script logs each new file's
  mode bits (`fs.statSync`, never the contents, one line per file); that runs on the next dispatch.
- `real:` `session.rpc.mcp.oauth.probe` on the connected server returned `failed: MCP server probe returned HTTP 404 Not Found`
  against the demo server on both runners (the demo serves only the endpoints listed in its header); the probe is not used by FR-070.
- Run 39680132357 (the first dispatch, commit db47a560) failed before any session: the script read
  `require.resolve('@github/copilot-sdk/package.json')`, which the SDK's `exports` map refuses; fixed in f9458b31.


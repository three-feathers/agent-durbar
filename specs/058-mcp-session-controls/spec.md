# Feature Specification: MCP servers in a session: clear status, Restart, last error and log folder

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: MCP servers in a session (issue #349): plain state words and how servers start per agent app, the masked failure reason with a hint, per-server Restart where the agent app has one (Copilot, Claude Code), Restart session with these servers, Open log folder (reveal only)
status: **Specified and clarified** (spec, research, plan, tasks); the owner answered Q1-Q11 on 2026-10-20 (all option A). Built so far: MCP error and event masking (`maskMcpError`, `maskMcpEvent`; #362, #382); per-server Restart (Copilot, Claude Code) and Restart session with these servers (T030-T034, T040-T044, #349; simulator and fakes, not on a real account); state words and icons, hints, *Details* with *Copy* and live refresh of the open dialog (T113-T115, #364 step 4; simulator and tests; the start line, toggle timing and logs are not built yet); delta 2026-10-20 (issue #364): MCP OAuth sign-in (needs-auth from a 401, start the agent app's own sign-in or show terminal steps, switch off for this session), specified and clarified (owner answered Q12-Q19 on 2026-10-20); built so far (PR 1): the classifier `isMcpAuthChallenge`, `isAuthError` ignoring it, and masking of failed MCP tool cards (T091, T092, T097); PR 2: the types, event guard and fake for sign-in (`errorClass`, `mcpSignIn`, `mcpSignInSteps`, `startMcpSignIn?`, `mcpAuth`; T112, T093); no adapter sets them yet, no sign-in yet; delta 2026-10-23 (issue #596, owner): live state and actions of every server in Settings > MCP servers over the running chats (FR-080..FR-087) built, simulator and unit tests only
-->

**Feature Branch**: `058-mcp-session-controls`
**Created**: 2026-10-20
**Status**: Specified and clarified (spec, research, plan and tasks). Built 2026-10-21 (#349): per-server Restart and Restart session
with these servers (US3, US4; tasks T030-T034, T040-T044), simulator and fakes only. The owner answered Q1-Q11 on 2026-10-20 (all option A,
see *Clarifications*). Delta 2026-10-20 (issue #364, MCP OAuth sign-in, FR-060..FR-076): specified and clarified (the owner answered
Q12-Q19 on 2026-10-20, all the recommended option), no code (see *Changes*).
**Input**: Issue #349. Owner (Paco, 2026-10-20): "in a session, when I open MCP I can enable and disable servers, but I miss VS Code's
start/stop/show logs; it is not clear how to start them."

## Summary

Durbar does not run MCP servers itself. The agent app (Copilot SDK runtime, Claude Code CLI, Codex app-server) starts them with the
session; Durbar only says which to use (spec 019, spec 020, spec 012 FR-133 / FR-147). The per-agent dialog *MCP servers for <name>*
shows a raw status token and a switch, and nothing else.

This feature makes that dialog say, in plain words, **what each state means and how a server starts for this agent app**, shows the
**reason a server failed** (masked), adds a per-server **Restart** where the agent app really has one, adds **Restart session with
these servers** (end and resume, conversation kept), and offers **Open log folder** where the agent app keeps logs, without Durbar ever
reading or copying a log file.

What each agent app can do (evidence in [research.md](research.md), section 5):

| | Copilot | Claude Code | Codex |
| --- | --- | --- | --- |
| A server starts | with the session | with the next message | with the session |
| Switch on/off applies | at once | at once (a server that was off at launch: next message) | next message |
| Per-server Restart | yes (`read:` SDK types) | yes (`read:` docs and CLI) | no |
| Restart session with these servers | yes | yes | yes |
| Log folder | yes (`read:` docs) | per server (`read:` program strings, undocumented) | maybe (`read:` source; content unknown) |

## Clarifications

### Session 2026-10-20

Answered by the owner (Paco, about 08:45 CEST, through the coordinator). He chose option A for all eleven.

- Q1 Controls shape → A: the switch stays as Start/Stop for this session, and each server gets a **Restart** button.
- Q2 Copilot Stop → A: Stop = `mcp.disable` (this session only); `stopServer` is never used.
- Q3 Copilot runtime without `restartServer` → A: Restart = switch that one server off, then on.
- Q4 Restart session scope → A: end and resume the **same** session; the conversation is kept. No "start fresh" variant.
- Q5 Logs → A: only *Open log folder*; no log viewer in the app, now or as a planned later phase.
- Q6 Claude log folder → A: show the per-server folder when it exists, labelled undocumented.
- Q7 Codex log folder → A: show `<CODEX_HOME>/log` when it exists.
- Q8 Codex reload → A: Codex gets only *Restart session with these servers*; no "Reload servers" button.
- Q9 Real checks → A: one no-prompt real check per agent app (0 AI credits), only with the owner's go-ahead at that time.
- Q10 Where Restart session lives → A: only in the MCP dialog.
- Q11 Claude after Restart session → A: Claude's servers start with the next message, and the dialog says so; the CLI is not launched early.

Delta for issue #364 (MCP OAuth sign-in), answered by the owner (Paco, about 10:05 CEST, through the coordinator). He chose the
recommended option for all eight.

- Q12 Copilot token storage → B: `persistent`; the runtime keeps the MCP sign-in in the OS keychain, Durbar never touches it.
- Q13 Opening the browser → A: two steps, "Sign-in page on <host>", then **Open sign-in page**.
- Q14 Where Sign in lives → A: in the MCP dialog row; the tool card's **Sign in…** opens the dialog at that row.
- Q15 Claude CLI not launched yet → A: "Send a message first", plus the terminal steps; the CLI is not launched for a sign-in.
- Q16 Non-https authorization pages → A: refused, and the terminal steps are shown.
- Q17 Repeated failures → A: only **Switch off for this session** is offered; nothing is switched off by itself.
- Q18 Codex after a sign-in → A: "Signed in: applies with your next message" (fresh child, same thread).
- Q19 "Sign in with another account" → A: not offered for now.

## User Scenarios & Testing

### User Story 1 - Understand what a server is doing (Priority: P1)

Paco opens *MCP servers* from a chat's More menu. Each server shows one plain word ("Running", "Starting", "Failed", "Needs sign-in",
"Off for this session", "Stopped", "Not started yet") with an icon, and a short line under the list explains how servers start for this
agent app ("Claude Code starts its servers with your next message").

**Why this priority**: the owner's main confusion ("not clear how to start them") is fixed by words alone, with no runtime risk.

**Independent Test**: simulator with one agent of each kind and servers in every state; the dialog shows the right word and the right
"how it starts" line; unit test on the word table.

**Acceptance Scenarios**:

1. **Given** a Claude agent whose CLI has not been launched yet, **When** the dialog opens, **Then** each enabled server reads "Not
   started yet" and the line says servers start with the next message.
2. **Given** a Copilot agent with a server in `pending`, **When** the runtime reports `connected` while the dialog is open, **Then** the
   row changes to "Running" without closing the dialog.
3. **Given** a Codex agent, **When** Paco switches a server off, **Then** the row says "Off from your next message" and the dialog does
   not claim it applied at once.

### User Story 2 - See why a server failed (Priority: P1)

A failed server shows "Failed", a one-line hint ("The command was not found", "Needs sign-in", "Timed out while starting", ...) and a
*Details* toggle with the agent app's own message, masked, with *Copy*.

**Why this priority**: without the reason, Restart is guesswork.

**Independent Test**: unit tests on the hint table and on masking in main; simulator with a failed server.

**Acceptance Scenarios**:

1. **Given** an error text that contains a header value of one of the folder's MCP extras, **When** the dialog shows it, **Then** the
   value is replaced by `[redacted]` (main masks before the renderer gets it).
2. **Given** an error "spawn npx ENOENT", **Then** the hint says the command was not found and suggests checking it in Settings or the
   folder's extras.

### User Story 3 - Restart one server (Priority: P2)

On Copilot and Claude agents each server row has **Restart**. It restarts only that server in this session; the row goes to
"Starting" and then to the new state, and a short toast says the result. Codex rows have no Restart; the dialog says why and offers
*Restart session with these servers* instead.

**Why this priority**: the VS Code control the owner misses, where the agent app supports it.

**Independent Test**: fake Copilot session (`rpc.mcp.restartServer` recorded), fake Claude CLI (`mcp_reconnect` recorded), simulator.

**Acceptance Scenarios**:

1. **Given** a live Copilot session with a failed server, **When** Paco presses Restart, **Then** the adapter calls the runtime's
   per-server restart for that name only, and the row shows the next reported state.
2. **Given** a Codex agent, **Then** no per-server Restart is shown and never is a session restart run in its place.

### User Story 4 - Restart the session with the current servers (Priority: P2)

After changing Settings or the folder's extras, Paco presses **Restart session with these servers**. Durbar ends the session and resumes
it with the current set. The conversation is kept; a resume spends no AI credits. If the agent is working, thinking or waiting, Durbar
asks first and says what is lost (the running turn, "Approve for this session" grants, remote control).

**Why this priority**: today Settings and folder changes apply only to new sessions (spec 019 FR-008), and the way to apply them is
hidden (End session, then send a message).

**Independent Test**: main-process unit test with a fake adapter (stop then start with the same id and the new options); simulator.

**Acceptance Scenarios**:

1. **Given** an idle agent with no grants and no remote control, **When** Paco presses the button, **Then** no question is asked, the
   session ends and is resumed with the same id and the new server set, and the chat history stays.
2. **Given** a working agent, **When** Paco presses the button, **Then** a confirmation appears with Cancel focused; Cancel changes
   nothing.

### User Story 5 - Find the logs (Priority: P3)

Where the agent app keeps log files, the dialog offers **Open log folder**, which shows that folder in Files / Finder / Explorer. Durbar
does not open or read any file in it.

**Why this priority**: useful for a deeper look; the masked error (US2) covers most cases.

**Independent Test**: unit test of the per-OS path function with injected environment; main test that a missing folder is reported
and nothing is opened; simulator shows the button and a toast.

**Acceptance Scenarios**:

1. **Given** a Copilot agent and an existing `~/.copilot/logs`, **When** Paco presses *Open log folder*, **Then** the folder is shown in
   the system file manager and the renderer never receives the path.
2. **Given** a folder that does not exist, **Then** the button is not shown (or, if it disappeared meanwhile, a toast says no logs were
   found) and nothing is opened.

### Edge Cases

- A server name that the runtime reports but Durbar does not know (`origin: runtime`): words and error work; Restart works if the agent
  app allows it; it cannot be switched off when its default is off (spec 019 behaviour stays).
- An unknown status string from a newer runtime: shown as "Unknown state" plus the escaped token, never dropped.
- Restart pressed twice quickly: the second press is ignored while the first is running (button disabled).
- Restart on a session that ended meanwhile: "This session is not running. Send a message to start it." No session is started.
- Restart session while a permission or question card is open: confirmation (it counts as "waiting"); the pending request ends with the
  session, as with *End session* today (`read:` the adapters' `stop`; not checked by hand for this flow).
- Sub-agents: the dialog is per main agent only (as today).
- A very long error: shown up to 300 characters (as the adapters cut today), with *Copy* copying the masked text.
- Windows paths, macOS `~/Library`, Linux `$XDG_CACHE_HOME`: resolved by one pure function per OS (constitution VI).

## Requirements

### Words and status (P1)

- **FR-001** `[IMPLEMENTED]` (`test:` test-mcpwords; `sim:` shots-058-mcp-words; the "Off from/On from your next message" line waits for T010's `mcpToggleApplies` use in the row, T026) Every server row shows one **word and icon** for its state, from one pure table (no colour alone, constitution V): 
  `connected` "Running"; `pending` "Starting"; `failed` "Failed"; `needs-auth` "Needs sign-in"; `disabled` "Off for this session";
  `stopped` "Stopped"; `not_configured` "Not set up for this session"; no state yet "Not started yet"; anything else "Unknown state"
  followed by the escaped token. A switch the adapter applies with the next message shows "Off from your next message" / "On from your
  next message" until the runtime reports the new state.
- **FR-002** Under the list, **one line says how servers start for this agent app**, chosen from the adapter's normalized start mode
  (FR-010): *with the session* ("Codex starts these servers when the session starts"), *with the next message* ("Copilot / Claude Code
  starts these servers with your next message"; Copilot real 2026-10-21, *Changes*), and
  the switch timing (*at once* or *from your next message*). The current claim "a switch applies right away" is shown only when the
  adapter applies it live.
- **FR-003** The dialog explains the two scopes in one sentence each: **This session** (the switch and Restart; kept until the app is
  closed, as today) and **New sessions** (Settings and the folder's extras; spec 019 FR-008). Wording reviewed against the README's MCP
  section (one word per concept, spec 052).
- **FR-004** `[IMPLEMENTED]` (`sim:` shots-058-mcp-words; not against a real event stream) The dialog **updates while open** when an `mcp` event for that agent arrives (state, error), without losing focus or
  scroll position.

### Errors (P1)

- **FR-005** The runtime's failure text reaches the renderer **only after main masks it**: `redact()` with the environment and header
  values of the session's own MCP servers (the folder's extras, known to main only) plus the process environment, then
  `maskSecretUrl` for URLs, cut to 300 characters. This also closes today's gap where the error reached the renderer unmasked
  (research section 1). Never logged; the `DURBAR_LOG` sink stays as it is.
- **FR-006** `[IMPLEMENTED]` (`test:` test-mcpwords) A **hint** is chosen from the masked text, the state and a normalized error class (FR-011): needs sign-in; command not found
  (`ENOENT`, "command not found", "is not recognized"); permission denied (`EACCES`); timed out; connection refused or host not found;
  the server exited or crashed; configuration error; otherwise none. One short sentence with what to check (Settings, the folder's
  extras, the Copilot CLI list). Pure, unit-tested.
- **FR-007** `[IMPLEMENTED]` (`sim:` shots-058-mcp-words; a needs-sign-in row has it too) A failed row has a *Details* toggle with the masked text and *Copy* (copies the masked text only).

### Adapter surface (adapter-neutral, constitution II)

- **FR-010** `AdapterCapabilities` gains optional, plain fields (missing = today's behaviour):
  - `mcpStart?: 'session' | 'next-message'`: when servers start (Codex `session`; Copilot and Claude `next-message`: real 2026-10-21,
    the Copilot runtime starts them with the first message, *Changes*);
  - `mcpToggleApplies?: 'live' | 'next-message'`: when the switch takes effect (Copilot and Claude `live`, Codex `next-message`);
  - `mcpRestart?: boolean`: `restartMcpServer()` exists (Copilot and Claude true, Codex false);
  - `mcpLogs?: 'session' | 'per-server'`: `mcpLogFolder()` exists (Copilot `session`, Claude `per-server`, Codex `session`;
    Claude's folder labelled undocumented, Q6; Codex's shown only when it exists, Q7).
- **FR-011** `McpServerStatus` gains optional `errorClass?: 'auth' | 'not-found' | 'timeout' | 'exited' | 'config'` (set by the adapter
  only when the vendor says so: Copilot `errorClassification` values once seen, Codex `failureReason: reauthenticationRequired` ->
  `auth`, Codex `authStatus: notLoggedIn` -> `auth`) and `needsRestart?: boolean` (Copilot `session.mcp_server_needs_reconnect`).
  Claude's `init.mcp_server_errors` become `failed` rows with their text. No vendor type leaves the adapter.
- **FR-012** `[IMPLEMENTED]` (`test:` fake SDK and fake CLI; not on a real account, FR-050) `AgentAdapter.restartMcpServer?(sessionId, name): Promise<void>`, present exactly when `mcpRestart` is true (contract C2):
  - Copilot: `session.rpc.mcp.restartServer({ serverName })`; when the runtime does not know that method (an older runtime: it answers
    JSON-RPC MethodNotFound, -32601, or "Unhandled method", as the SDK's own `connect` check reads it) or the SDK object has no such
    method, off then on for that server only (`disable` then `enable`) (Q3); any other error is reported, with no fallback; never
    `stopServer` (Q2); never `reload()` (all servers);
  - Claude: control request `mcp_reconnect { serverName }`, then `mcp_status` for the new list (as FR-133 does after a toggle). A server
    that was off at launch is not in the running CLI: "Switch it on first; it starts with your next message";
  - Codex: not present.
  - A session that is not live: rejects with "This session is not running." Nothing is started.
- **FR-013** `AgentAdapter.mcpLogFolder?(sessionId, name?): { root: string; folder: string } | undefined` returns the folder where the
  agent app keeps logs, and the vendor root it must stay under (FR-026)
  (per server when `mcpLogs` is `per-server`), from a pure per-OS function with injected environment (research sections 2-4):
  Copilot `<COPILOT_HOME or ~/.copilot>/logs`; Claude `<cache>/claude-cli-nodejs/<project>/mcp-logs-<server>` (env-paths
  convention per OS, project and server names sanitized as the CLI does; a name longer than 200 characters gives no folder); Codex
  `<CODEX_HOME or ~/.codex>/log`. Roots: Copilot `<COPILOT_HOME or ~/.copilot>`, Claude the `claude-cli-nodejs` cache root, Codex
  `<CODEX_HOME or ~/.codex>`. The path never reaches the renderer.

### Main process and IPC (constitution III)

- **FR-020** `agents:mcp` adds to its reply: per server `canRestart`, `errorClass`, `needsRestart`, the masked error (FR-005), and a
  `logFolder` flag (FR-024); per agent `start` and `toggleApplies` (FR-010), `canRestartSession` (FR-022) and the agent app's display
  name. No path, no secret value.
- **FR-021** `[IMPLEMENTED]` (`test:` test-mcp-session) `agents:mcpRestart(id, name)`: a known agent id, a server name of 1-64 characters that is in that agent's list; the adapter
  must have `restartMcpServer`; the session must be live. Returns `{ ok, error? }` with a short, masked error. One restart per server
  at a time per agent (a second call while one runs is refused). An activity-log row (spec 052) records "MCP server <name> restarted"
  with no error text.
- **FR-022** `[IMPLEMENTED]` (`test:` test-mcp-session; `sim:` shots-058-mcp-restart) `agents:mcpRestartSession(id, confirmed)`: Restart session with these servers.
  - Allowed when the adapter has `resume` and the agent is a main agent with a session id that can be resumed.
  - When the agent is working, thinking or waiting (main's own state tracker, not the renderer's word), `confirmed` must be `true`;
    otherwise it returns `{ ok: false, needsConfirm: true }` and changes nothing. (The renderer may ask in more cases, FR-023; main
    enforces only this one.)
  - It does what *End session* does (remote control off first, spec 054 FR-003; `adapter.stop`), then starts the **same id** through
    the existing resume path (`ensureLive`) with the current `startOptionsFor(a)`, so Settings, folder extras and this agent's switches
    all apply. No prompt is sent.
  - The renderer is told the result; the chat keeps its history (nothing is reloaded unless the adapter reports a new session id).
  - If the resume fails, the agent stays ended (as after *End session*) and the error is shown; sending a message tries again.
  - **FR-027** `[IMPLEMENTED]` (`test:`, `sim:` simauth=expired) If the resume fails because the sign-in expired (review note 2, PR #359), the result carries `errorKind: 'auth'`
    (the thrown error classified with the existing `isAuthError` / the adapter's `auth` error status), and the renderer closes the MCP
    dialog and shows spec 012 FR-157's sign-in card in that chat (*Sign in*, *Open Settings > Agent apps*, raw text only in *Details*),
    not a plain toast; the app is marked signed out as FR-157 does. For Claude the CLI is not launched by the restart (Q11), so an
    expired sign-in shows with the next message through FR-157's existing path.
  - Always the same session (Q4); there is no new-session variant. For Claude the CLI is not launched by the restart: its servers start
    with the next message, and the dialog says so (Q11). The button lives only in the MCP dialog (Q10).
- **FR-023** `[IMPLEMENTED]` (`sim:`) Confirmation text (renderer, Cancel focused): "Restart <name>'s session with the current MCP servers? The conversation is
  kept and resuming spends no AI credits. <If working:> The running turn stops. <Always:> 'Approve for this session' grants are cleared.
  <If remote on:> Remote control turns off." Shown when the agent is working, thinking or waiting, or has session grants or remote
  control on.
- **FR-024** `agents:mcpRevealLogs(id, name?)`: main asks the agent's adapter for the folder (FR-013), checks with `fs.stat` that it is an
  existing directory (it never lists, opens or reads files in it), then calls Electron `shell.showItemInFolder(folder)` (no shell, no
  command string). A missing folder returns `{ ok: false, error: 'No log folder found for this agent app yet.' }`. The flag in FR-020
  is true only when the adapter has `mcpLogs` and the folder exists and passes FR-026 at the time of the `agents:mcp` call.
- **FR-026** **The log folder stays under the vendor's own root** (review note 1, PR #359; defence in depth: a server name can come from
  a folder extra the user did not write). Before `fs.stat` and `shell.showItemInFolder`, main resolves both the root and the folder
  with `fs.realpathSync` (so symlinks and `..` are resolved), then requires `path.relative(realRoot, realFolder)` to be non-empty, not
  start with `..` and not be absolute (on Windows a different drive gives an absolute relative path). Anything else, a missing root
  included, is refused with the same "No log folder found" message, nothing is opened, and the flag in FR-020 is false. The check is a
  pure function (`insideRoot(realRoot, realFolder, pathImpl)`) plus the realpath step in main.
- **FR-025** Durbar never copies, uploads or stores a vendor log file and never shows log lines in the app. The owner chose no log viewer
  (Q5); a viewer would need a new spec and the owner's approval.

### Dialog (renderer)

- **FR-030** Row layout: name, origin tag (as today), state word and icon, hint (failed only), switch, and **Restart** (only when
  `canRestart`, the session is live and the server's switch is on). Footer buttons: *Restart session with these servers* (when
  `canRestartSession`), *Open log folder* (session-level folders; per-server folders are a small link in the row's *Details*, for Claude labelled "not
  documented by Anthropic", Q6),
  *Settings*, *Folder extras…*, *Done*. Text at least 10.5px; the dialog fits 1280x800 with 12 servers without page overflow (the list
  scrolls inside the dialog).
- **FR-031** `[IMPLEMENTED]` (`sim:`) Restart feedback: the button shows "Restarting…" and is disabled until the call returns; then a toast "Restarted <name>" or
  the masked error; the row then follows the runtime's events (FR-004).
- **FR-032** `[IMPLEMENTED]` (`sim:`; the line sits next to the Restart session button) Codex rows: no Restart; the footer line says "Codex cannot restart one server; use Restart session with these servers".
  No "Reload servers" control (Q8).
- **FR-033** Keyboard and screen readers: every new control is a focusable button with a name ("Restart <server> for <agent>"); state
  changes in the list are announced through the existing polite live region; Esc closes.

### Simulator and tests (constitution IV)

- **FR-040** The simulator gives each kind its real capability values (fixes today's `mcpToggle: false` for the Claude and Codex sim
  kinds) and servers in every state, including a failed one with a hint and a canned Restart that goes Starting -> Running, and a
  canned *Restart session*. *Open log folder* in the simulator shows a toast, never opens a folder. With the page address
  `simauth=expired` (spec 012 FR-157), *Restart session* fails with the sign-in text and shows the sign-in card (FR-027).
- **FR-041** Unit tests (0 credits): the word and hint tables; masking in `agents:mcp` (an extra's header and env value, a URL with
  credentials, a `ghp_` token); `agents:mcpRestart` and `agents:mcpRestartSession` validation and order (stop then start with the same
  id and the new options; refuse without confirmation while busy); the per-OS log folder function (Linux, macOS, Windows, with
  `COPILOT_HOME`, `CODEX_HOME`, `XDG_CACHE_HOME`, `LOCALAPPDATA`); the Copilot adapter on the fake SDK (`restartServer`, the
  fallback, never `stopServer`); the Claude adapter on the fake CLI (`mcp_reconnect` then `mcp_status`); contract C2 lines for the new
  members; the mappers for `errorClassification`, `needs_reconnect`, `failureReason`, `mcp_server_errors`; `insideRoot` and the
  realpath step (a folder that is a symlink out of the root, `..` in a server name, a different Windows drive, a missing root: all
  refused; a real temp-folder symlink case on POSIX, FR-026); `agents:mcpRestartSession` with a resume that throws a sign-in error
  returns `errorKind: 'auth'` and marks the app signed out, while another error does not (FR-027).
- **FR-042** Screenshots of the dialog at 1440x900 and 1280x800 on the simulator (constitution VII).

### Honest limits

- **FR-050** `[KNOWN GAP]` Until the real checks run (tasks Phase 6; one no-prompt check per agent app, only with the owner's go-ahead
  at that time, Q9), Copilot `restartServer`, Claude `mcp_reconnect`, the log folders,
  `errorClassification` values and resume with a changed server set are `read:` only; the README and the dialog's *More* text say
  "not checked on a real account yet" for Restart and the log folder.
  Copilot part done 2026-10-21 (T060, real, Linux; *Changes*): `restartServer`, one `errorClassification` value (`os_not_found`),
  resume with a changed server set, `~/.copilot/logs` exists. Claude `mcp_reconnect`, Codex, macOS and Windows stay `read:`.
- **FR-051** `[KNOWN GAP]` Whether a server's stderr reaches any of the three log folders is not documented; the dialog says "the
  agent app's log folder" and never promises server output.
- **FR-052** `[KNOWN GAP]` MCP sign-in (OAuth) stays out of scope (spec 019): "Needs sign-in" explains it and points to the agent app's
  own sign-in (`copilot`, `claude mcp login <name>`, Codex), without running it. *Superseded 2026-10-20 by the delta for issue #364
  (FR-060..FR-074, see Changes): Durbar starts the agent app's own sign-in where it has one and shows exact terminal steps otherwise.*

## Success Criteria

- **SC-001** On the simulator, every state of every kind shows a word, an icon and the correct "how it starts" line; no raw token is
  shown except after "Unknown state".
- **SC-002** No unmasked secret reaches the renderer in the masking tests (all cases in FR-041).
- **SC-003** Restart on Copilot and Claude calls exactly one per-server runtime request for the named server (fake tests); Codex never
  gets a per-server Restart and no test path turns one into a session restart.
- **SC-004** Restart session keeps the id and the history, applies the new server set and sends no prompt (main test with a fake
  adapter); it refuses while busy without confirmation.
- **SC-005** `npm run typecheck && npm run build && npm test` pass on Linux, macOS and Windows CI; screenshots at both sizes show no
  overflow.

## Key Entities

See [data-model.md](data-model.md): the server row (`AgentMcpEntry` additions), the agent-level MCP facts, the normalized status
additions and the capability fields.

## Assumptions

- The pinned Copilot SDK (1.0.22) keeps `restartServer` with the documented meaning; it is `@experimental`, so the adapter feature-detects
  it.
- Claude Code 2.1.303+ (what spec 012 checked) accepts `mcp_reconnect`; 2.1.304's own SDK code sends it. Older CLIs may reject it; the
  error is shown as it comes.
- Codex versions Durbar supports have no per-server restart.
- No new runtime dependency.

## Relationship to other specs

- **019** (MCP servers, per-agent override): unchanged rules; this feature adds words, errors, Restart and log access to the per-agent
  dialog of FR-009. Dated note added under 019's `## Changes`.
- **020** (CLI list first, folder extras): the "New sessions" scope in FR-003 is 020's; no change to its stores.
- **012** (FR-133 Claude toggle, FR-147 Codex MCP): the switch behaviour stays; FR-012 adds Claude `mcp_reconnect`; FR-002 fixes the
  dialog's wording for Codex's next-message switch. FR-027 reuses FR-157's sign-in card for a Restart session that fails for sign-in.
- **005 / 006** (End session, resume): Restart session reuses *End session* and the existing resume path, with the same confirmation
  rule (005 FR-017).
- **054** (remote control): ended by Restart session as by End session.

## Open questions for the owner (resolved 2026-10-20)

All answered by the owner: option A for each (see *Clarifications*). The options are kept below as the record of what was offered.

- **Q1 Controls shape.** A) Keep the switch as Start/Stop for this session and add **Restart** per server (recommended: one control per
  meaning, no duplicate Stop). B) Replace the switch with VS Code-style Start / Stop / Restart buttons. C) Both.
- **Q2 Copilot Stop.** A) Stop = the existing session-scoped `mcp.disable` (recommended: checked live in spec 019, cannot touch other
  sessions). B) Use `stopServer`, whose types say "on the session's host": with Durbar's shared Copilot runtime that may stop the server
  for every Copilot agent (unverified).
- **Q3 Copilot runtimes without `restartServer`.** A) Restart = off then on for that one server (recommended: still per server). B) Hide
  Restart on such runtimes.
- **Q4 Restart session scope.** A) End and resume the same session: conversation kept (recommended). B) Start a new session in the same
  folder (fresh conversation). C) Offer both (resume as default, "Start fresh" as a second button).
- **Q5 Logs.** A) Phase 1-3 only *Open log folder*; no in-app log text (recommended). B) Also plan a masked last-lines view as a later
  phase now (needs reading vendor log files, with caps and masking). C) No log access at all.
- **Q6 Claude log folder.** A) Offer the per-server `mcp-logs-<server>` folder when it exists, labelled "not documented by Anthropic"
  (recommended). B) Do not offer it for Claude until Anthropic documents it.
- **Q7 Codex log folder.** A) Offer `<CODEX_HOME>/log` when it exists (recommended). B) Hide it until a real check shows what the
  app-server writes there.
- **Q8 Codex reload.** A) No per-server control for Codex; only Restart session (recommended). B) Add a "Reload servers" button using
  `config/mcpServer/reload` (all servers of that Codex process; unknown whether Durbar's per-thread servers survive) after a real check.
- **Q9 Real checks.** A) Allow one no-prompt check per agent app (0 AI credits: start a session with a throw-away local stdio server,
  Restart it, Restart session, open the log folder) with the owner's go-ahead (recommended). B) Simulator and fakes only for now.
- **Q10 Where Restart session lives.** A) In the MCP dialog only (recommended: it is about MCP). B) Also in the chat More menu and the
  office card menu, next to End session.
- **Q11 Claude after Restart session.** A) Accept that Claude's servers start with the next message and say so (recommended: no extra
  process, matches today's lazy launch). B) Launch the Claude CLI right after the restart without a prompt so servers start at once
  (0 credits, one more process per restarted agent).

## Changes

### 2026-10-22: the MCP dialog fits a long list, and a word never contradicts its switch (issue #544)

**Status**: built (T117), simulator and unit tests only; `[KNOWN GAP]` not seen on a real agent app (the owner's macOS build had the bug).

**Problem** (owner, real Mac, a build with #538, 14 servers, `real:` issue #544): (1) with a list taller than the window the footer
buttons (*Settings*, *Folder extras…*, *Done*) sat on the last rows and the last switch drew over *Done*. Cause: `.dlg.wide` is a
flex column with `overflow:auto`, and `.dlg .dbody` has `min-height:0` but visible overflow, so the body shrank to the dialog's
height and its rows spilled over the footer instead of scrolling. (2) Six servers the agent app had turned off itself (runtime status
`disabled`, switch on) read "Off for this session", as if the user had switched them off here.

#### Requirements (delta)

- **FR-077** **The footer never overlaps the rows.** In a wide dialog (`.dlg.wide`, so the agent's MCP dialog) the title and the
  buttons stay in view and only the body scrolls, with a few pixels of padding so the switches' focus ring is not clipped (`.dlg.imp` does the same). At 1440x900,
  1280x800 and 1280x600 with 14 or more servers, no row's box meets the button row and *Done* is visible and clickable. The *Restart session with these servers* row and the "Applies to this agent until the app is closed" line are part of the scrolling body, never on the buttons (owner, macOS, issue #544). Other
  `dialog()` users with a wide body behave the same. [IMPLEMENTED] `sim:` `shots-058-mcp-words.js`.
- **FR-078** **A word says who turned the server off, and never contradicts the switch.** A server the runtime reports `disabled`:
  - reads "Off for this session" only when the user's switch here is off (`off`);
  - "Off in Settings" / "Off in folder extras" when the Settings or extras default is off (the separate "off in ..." tag is then left out);
  - "Off until the session restarts" when Agent Durbar itself passed it as off when the session started (`launchedOff` on the `agents:mcp`
    entry, kept by main from the start options: Copilot `disabledMcpServers`, Codex's disabled list) and the user has since switched it on
    in Settings; its switch stays on, and its hint points to *Restart session with these servers*;
  - "Starting" while the user has just switched it on here (`switchedHere`) and the runtime's old `disabled` has not been replaced yet (no flicker);
  - otherwise the agent app or its config turned it off, and the word is "Off in <app name>" (`app` of the reply; without it
    "Turned off by the agent app"). That row's switch shows off and is disabled, and its hint says where to change it ("Turn it on in
    <app>'s own MCP settings, then restart the session."). Agent Durbar does not claim it can switch it on.
  [IMPLEMENTED] `test:` `test-mcpwords.ts`, `test-mcp-session.ts` (`launchedOff`, `switchedHere`); `sim:` `shots-058-mcp-words.js`.

### 2026-10-23: the footer is its own layer, also after a switch toggle (issue #544, second report)

**Status**: built (T117), simulator only; `[KNOWN GAP]` not seen on a real Mac with this CSS (the owner's dev build of main had the bug).

**Problem** (owner, real Mac, dev build of main f28ed2da, `real:` issue #544): toggling an MCP switch off and on made the overlap worse. The last row (`workiq`, "Off for this session", switch on) sat under the footer, *Settings* / *Folder extras…* / *Done* were drawn over the row text, and after the toggle the last row's switch was drawn over *Done*. Rows and footer shared space and z-order, and the repaint that follows a toggle re-rendered the body into that shared space.

#### Requirements (delta)

- **FR-077a** The wide dialog is a column of three separate things: the scroller (`.dbody`: `flex:1 1 auto; min-height:0; overflow:auto`, its own stacking context at `z-index:0`), and the footer (`.dbtn` and a visible `.derr`: `flex:none`, `position:relative`, `z-index:2`, an opaque `--surface` background). The body's own repaint (toggle, `mcp` event, Details, Restart) never changes that, so no row control (a switch included: its knob is inside the scroller, clipped by it) can paint over *Done* or over the buttons. After each toggle of the last row (off, then on), at 1440x900, 1280x800 and 1280x600: *Done* is fully visible and `elementFromPoint` at its centre and four corners returns *Done* or its child, and no element's visible part (clipped to the scroller) meets the footer's rect. The same rules serve every `dialog({wide:true})` (theme picker, review, trust, add/edit server) and the import and folder-setup dialogs, which are `.dlg.wide.imp` (one rule set, so they cannot drift; the duplicate `.dlg.imp .dbody` rule was removed). The scroller has 5px of padding: the focus ring is a 3px outline 1px off the control, and the old 2px/4px padding clipped the last control's ring (found by the check below).
[IMPLEMENTED] `src/renderer/screens.css`; `sim:` `scripts/shots-058-mcp-words.js`:
  - `footerIntegrity`: after each toggle, *Done* hit-tested and no element's visible part meets the footer;
  - `assertFooterStyle`: the footer's computed background is opaque (alpha 1) and equals the dialog's, its `position` is not `static`, its `z-index` is above the scroller's. It runs at the three sizes and in every built-in theme at 1280x800;
  - `wideDialogOk`: the add-server and trust dialogs at 1280x600 keep every footer button visible and hit-testable, and the first and last control in the scroller show their whole focus ring.
  Mutations (each fails the driver): removing the scroller rules (`Done is visible and nothing covers it`); removing only the footer rules (`the footer is an opaque, positioned layer above the scroller`); padding back to `2px 4px 2px 2px` (`the focus ring of the first and last control is not clipped`). Shots `docs/screenshots/058-mcp-dialog-toggle-*`, `058-mcp-wide-*`.

### 2026-10-20: MCP OAuth sign-in (issue #364)

**Status**: specified and clarified, **no code**. The owner answered Q12-Q19 on 2026-10-20 (Q12 B, the rest A: all the recommended
option; see *Clarifications*). Research: [research.md](research.md) section 7
(read only; no real session, no credits, no user config or token file opened). Plan: [plan.md](plan.md) *Delta: MCP OAuth sign-in*.
Tasks: [tasks.md](tasks.md) Phase 8 (T090-T109).

**Problem** (owner, real Mac, real Copilot session, `main` 2c4129d): two remote MCP servers failed every call with
`MCP tool catalog changed before tool "<server-tool>" could be invoked: Failed to verify cached MCP tools: MCP OAuth challenge required (HTTP 401)`
(`real:` issue #364). The failure showed only on the tool card; the MCP dialog did not say the server needed a sign-in, and Durbar
had no way to sign in (spec 019 `[KNOWN GAP]` "No MCP OAuth flow", FR-052 above). A second risk found in the research: that text
contains `401`, which the spec 012 FR-157 classifier (`src/adapters/autherrors.ts:13`) reads as the *agent app's* sign-in failing.

**What each agent app offers** (research section 7; all `read:`):

| | Copilot (SDK 1.0.22, runtime 1.0.98) | Claude Code (CLI 2.1.304) | Codex (app-server, `main` 0144894) |
| --- | --- | --- | --- |
| Start the runtime's own sign-in | `session.rpc.mcp.oauth.login({serverName})` returns `authorizationUrl`; the runtime runs discovery, PKCE, its loopback callback, token exchange, storage and reconnect | control request `mcp_authenticate {serverName}` returns `authUrl`, `requiresUserAction`; the CLI runs its localhost callback and reconnects (program strings; the docs say `-p`/SDK runs cannot sign in) | `mcpServer/oauth/login {name, threadId}` returns `authorizationUrl`, `loginId`; `mcpServer/oauthLogin/completed` follows; "start a fresh session after success" |
| Who keeps the token | the runtime (`mcpOAuthTokenStorage`: `in-memory` by default, or `persistent` = OS keychain; Durbar sets `persistent`, Q12) | the CLI ("stored securely", per endpoint) | Codex (`mcp_oauth_credentials_store = "auto"`: keyring, else `CODEX_HOME/.credentials.json`) |
| From a terminal | `copilot`, then `/mcp auth <name>` | `claude mcp login <name>` (or `/mcp` > Authenticate) | `codex mcp login <name>` |
| Needs-auth signal | status `needs-auth`; the tool error text of the issue | status `needs-auth` | `runtimeStatus: authenticationRequired`, `authStatus: notLoggedIn`, `failureReason: reauthenticationRequired` |

So Durbar **can start each runtime's own flow and open the system browser on the URL the runtime returns, without ever seeing a
token**. Where the call is missing (older runtime, refused, not live), Durbar shows the exact terminal steps instead.

#### Requirements (delta)

- **FR-060** **Needs sign-in from every source.** A server reads "Needs sign-in" (FR-001's word) when any of these arrives, and the
  adapter emits an `mcp` event with that server's `status: 'needs-auth'` and `errorClass: 'auth'`:
  - the runtime's own status `needs-auth` (Copilot `session.mcp_servers_loaded` / `session.mcp_server_status_changed`, Claude
    `system/init.mcp_servers` / `mcp_status`), Codex `runtimeStatus: authenticationRequired` or `authStatus: notLoggedIn` (both
    already mapped, `src/adapters/codexMcp.ts:33,47`);
  - Codex `mcpServer/startupStatus/updated` with `failureReason: reauthenticationRequired` (today the status is read but the reason is
    ignored, `src/adapters/codex.ts:829-835`);
  - a **failed MCP tool call** (the tool event names its `mcpServer`) whose text FR-061 classifies as an MCP OAuth challenge. Copilot
    can keep reporting such a server as `connected` while its cached tools fail (the issue's case), so the tool failure is the signal.
  The derived state is replaced by the next status the runtime reports for that server (for example `connected` after a sign-in).
  `[IMPLEMENTED]` Copilot (T094) 2026-10-21: `src/adapters/map.ts` (`tool.execution_complete`). `test:` `scripts/test-events.ts`. `[IMPLEMENTED]` Claude (T096) `src/adapters/claude.ts` (`mcpAuthSeen`, `withAuthSeen`): the mark ends with the CLI's own fresh report, i.e. the `mcp` event mapped from `system/init`, and with `setMcpEnabled` for that server. `read:` the CLI sends `init` at the start of each turn in stream-json input as far as the code shows (spec 012's research says "one per session start", docs; `[KNOWN GAP]` not checked on a real run), so the mark may last only until the next message even if the CLI still says `connected`; that is the intended "next status the runtime reports replaces it". The challenge shows at once from the last list the session emitted (`lastMcp`), before `mcp_status` answers, so a slow or timed-out request still shows Needs sign-in (as Codex, #481). `test:` `scripts/test-claude-adapter.ts` (both clears and the immediate emit with `mcp_status` held, mutation-checked). `[KNOWN GAP]` the reconnect path of #473 (`mcp_reconnect`) is not on this branch: whichever PR merges second must also `delete` the name from `mcpAuthSeen` there and test it.
  `[IMPLEMENTED]` Codex (T095, T023) 2026-10-21: the list (`authStatus: notLoggedIn` or `runtimeStatus: authenticationRequired`; list items have no `failureReason`), the startup notification (`failureReason`), and a failed `mcpToolCall` with challenge text (`mcpAuth`): the server is marked `needs-auth` + `errorClass: 'auth'` at once, even when the list says connected, kept through the re-read (one at a time) until the runtime's next status for it or until the server is switched off and on (no reconnect path exists in `codex.ts`). `test:` `scripts/test-codex-adapter.ts`, `scripts/test-codex-map.ts`. `read:` codex-cli 0.163.0 `codex app-server generate-ts` (checked by the PR reviewer; not installed on the author's machine): `v2/McpServerStatus.ts` has `runtimeStatus`, `authStatus`, `toolsError`, `httpOrigin`, `pluginId` and no `failureReason`; `v2/McpServerStatusUpdatedNotification.ts` has `failureReason: "reauthenticationRequired" | null`. Copilot (T094) is built (#480); Claude (T096) is built (#482).
- **FR-061** **One pure classifier**, `isMcpAuthChallenge(text)` in `src/adapters/mcpauth.ts` (vendor phrases stay in adapters,
  constitution II): the issue's text (`MCP OAuth challenge required`), the Copilot runtime's `requires authentication. Run \`/mcp auth`
  and `Re-authentication required for MCP server` (`read:` runtime strings), and Claude's and Codex's equivalents once seen. It is applied
  only to failed MCP tool results and MCP status errors, never to model text or a turn that ended well. Unit-tested with the issue's
  exact text.
  `[IMPLEMENTED]` Claude (T096): a failed MCP call with a challenge marks the server `needs-auth` + `errorClass: 'auth'` in the refreshed list even if the CLI says `connected`, until init or a toggle replaces it. `test:` `scripts/test-claude-adapter.ts`.
  `[IMPLEMENTED]` Claude Code's own strings, both recognised: `MCP server "<name>" needs authentication` and `<name> requires authentication. Open this session and run /mcp to authenticate.` (`read:` from the 2.1.304 binary). `[KNOWN GAP]` neither was seen in a real `tool_result`.
  `[IMPLEMENTED]` the classifier `src/adapters/mcpauth.ts` (PR 1 of #364; the mappers that apply it are T094-T096; Claude's is done, T096). `test:` `scripts/test-mcpauth.ts`.
- **FR-062** **An MCP challenge is not the agent app's sign-in.** Text that `isMcpAuthChallenge` matches never gets
  `errorKind: 'auth'` and never marks the app signed out (spec 012 FR-157): `isAuthError` returns false for it. If such text comes as a
  session-level error, the adapter maps it to the named server's needs-auth when it can name the server, else to a plain error.
  `[IMPLEMENTED]` `isAuthError` returns false for it (T092); the adapters naming the server are T094-T096. `test:` `scripts/test-autherrors.ts`.
- **FR-063** **Tool card.** A failed MCP tool call classified by FR-061 carries `mcpAuth: true` on the normalized `toolCall` event (no
  vendor text). The card adds one line, "<server> needs you to sign in", with **Sign in…** (opens the MCP dialog with focus on that
  server's row) and **Switch off for this session** (FR-066). The card's text is masked (FR-067).
  `[IMPLEMENTED]` Copilot (T094) 2026-10-21: `mcpAuth` is set on the failed card; no card line or button yet (UI). `test:` `scripts/test-events.ts`.
- **FR-064** **Start the agent app's own sign-in.** Capability `mcpSignIn?: boolean` and the optional member
  `startMcpSignIn?(sessionId, name): Promise<{ kind: 'browser'; url: string } | { kind: 'connected' }>`, present exactly when the flag is
  true (contract C2). Each adapter feature-detects the call and rejects with a `manual` error when it is missing or refused:
  - **Copilot**: `session.rpc.mcp.oauth.login({ serverName, clientName: 'Agent Durbar', callbackSuccessMessage })` (`@experimental`).
    No `authorizationUrl` = cached tokens were still valid and the server already reconnected. The result arrives later through
    `session.mcp_server_status_changed`. Durbar **never** registers `onMcpAuthRequest`, never calls `oauth.handlePendingRequest` or
    `oauth.complete` (both would pass tokens or callbacks through Durbar), never sends `clientSecret`, `clientId` or `redirectUri`, and
    does not use `prepareLogin` (owned installations; Durbar's servers are plain configuration).
  - **Claude Code**: control request `mcp_authenticate { serverName }` with **no** `redirectUri` (the CLI keeps its own localhost
    callback). `requiresUserAction: false` = already signed in. Afterwards Durbar asks `mcp_status` every 3 s while the sign-in is open
    (at most 10 minutes) and emits `mcp`. Needs a launched CLI: a needs-auth row only exists after the CLI reported it, so this holds
    except right after *Restart session* (Q11), where the button says "Send a message first". `mcp_oauth_callback_url` (pasting a callback
    URL) is not used.
  - **Codex**: `mcpServer/oauth/login { name, threadId }`; the completion `mcpServer/oauthLogin/completed` is matched by `loginId` (or
    `name` + `threadId` when an older Codex omits it). Success: the row reads "Signed in: applies with your next message", and the next
    message runs on a fresh child that resumes the thread (the FR-147 switch path), because Codex says to start a fresh session to use the
    saved grant (Q18). Failure: the masked `error`.
  - A session that is not live: "This session is not running. Send a message to start it, then sign in." Nothing is started.
- **FR-065** **Main holds the address; the window gets the host.** `agents:mcpSignIn(id, name)`:
  - checks a known main agent, a server name of 1-64 characters in that agent's list whose state is `needs-auth` or `errorClass: 'auth'`,
    the adapter's `startMcpSignIn`, a live session, and one sign-in per server at a time;
  - checks the returned address with `elicitHttpsUrl` (`src/shared/elicit.ts:155`: `https:` only, no user:password, at most 2048
    characters); anything else is refused and the manual steps are shown (Q16);
  - keeps `{url, host}` in memory per agent and server for at most 10 minutes; the reply to the window carries `host` only;
  - never writes the address to the activity log, the `DURBAR_LOG` sink, a debug line or disk; it is dropped on success, Cancel, the
    time limit, *End session*, *Restart session* and app exit.
  `agents:mcpOpenSignIn(id, name)` opens the held address with `shell.openExternal` only after that click (as spec 012 FR-154 does for an
  elicitation URL). `agents:mcpCancelSignIn(id, name)` forgets it (Codex: also `account/login/cancel` when the method exists; Copilot's
  `cancelLogin` is for owned logins only, so a manual login is just forgotten and the runtime's listener ends on its own, `[KNOWN GAP]`).
- **FR-066** **Switch off for this session.** The needs-auth row and the FR-063 card offer **Switch off for this session**: the existing
  `agents:setMcp(id, name, false)` (spec 019 FR-009; Codex from the next message, FR-001's words). No confirmation (it is undone with the
  same switch); toast "Switched <name> off for this session. Turn it back on in MCP servers." Not offered where spec 019 does not allow the
  switch (a runtime-only server whose default is off).
- **FR-067** **Masking.** The text of a failed MCP tool card is masked in main before the window gets it, with the session's own MCP secret
  values and the same steps as spec 019 FR-021 (`maskMcpError` in `src/main/mcpmask.ts`), but without the 300-character cut for the card's
  *Details* (it keeps today's card limit). Before spec 058 only `mcp` events were masked (the `outward` hook in `src/main/main.ts`); tool output was not. The sign-in
  errors (adapter rejections, Codex completion `error`) are masked the same way. No authorization address appears in any text the window
  gets.
  `[IMPLEMENTED]` for the `output` of every MCP `toolCall` after its start (update, complete, failed; review on #466) (the secret masks run on the whole text, then the cut to 50 000 characters, then the slow URL and flag masks on the shorter text, so a secret straddling the cut leaves no head) (`maskMcpText` in `src/main/mcpmask.ts`, applied in `outward`, T097), and for the `output` of every failed tool item in a resumed session's history (`maskMcpHistory`, both resume replies `agents:wake` and `sessions:resume`; history items carry no `mcpServer`, so all failed tools are masked); the sign-in errors are not built yet. `[KNOWN GAP]` not masked: a completed (not failed) tool item in a resumed session's history (spec 005's #361 delta, PR #465, widens history masking to every tool item); a failed Copilot output whose start event was not seen (no `mcpServer`, `map.ts:118-122`), a Codex `mcpToolCall` without `server` (`codexMap.ts:256`), and a JSON key with an unknown value shape (`{"apiKey":"zzzz"}`; the shared rules, inherited from FR-021). `test:` `scripts/test-mcp-errormask.ts` (straddling secret, history), `scripts/test-autherrors.ts` (an app 401 on the same line as the MCP advice stays an auth error).
- **FR-068** **Manual steps when the in-app sign-in cannot run** (no capability, method missing or refused, address refused, Claude not
  launched yet). One short block with the server name filled in and **Copy** for the command, from the adapter's plain capability text
  `mcpSignInSteps` (Durbar never runs it):
  - Copilot: "In a terminal, run `copilot`, type `/mcp auth <name>` and finish in your browser. Then use *Restart session with these
    servers*." Only for servers in the Copilot CLI list; for a folder extra: "This server is only known to Agent Durbar; use Sign in
    here." With `persistent` storage (Q12 B) the runtime keeps MCP sign-ins in the OS keychain; whether that is the same entry the CLI's
    `/mcp auth` writes, so a CLI sign-in is seen by a Durbar session, is unverified (`[KNOWN GAP]`, T105).
  - Claude Code: "In a terminal, run `claude mcp login <name>`, then use *Restart session with these servers*." Only for a server that is
    also in Claude Code's own MCP settings; whether Durbar's `--mcp-config` copy reuses that sign-in is unverified (`[KNOWN GAP]`).
  - Codex: "In a terminal, run `codex mcp login <name>`, then use *Restart session with these servers*." Only for a server in Codex's
    `config.toml`; reuse for Durbar's thread overrides is unverified (`[KNOWN GAP]`).
- **FR-069** **Dialog flow** (renderer, FR-030 layout):
  - Needs-sign-in row: hint "This server needs you to sign in. <App> keeps the sign-in; Agent Durbar never sees it.", **Sign in** (when
    `canSignIn`), **Switch off for this session**, and *How to sign in from a terminal* in *Details* (FR-068).
  - After **Sign in**: "Sign-in page on **<host>**" with **Open sign-in page** and **Cancel** (two steps, Q13). Then "Finish signing in
    in your browser. This row updates when <App> reports the server." Focus stays on the row; changes go through the polite live region.
  - `connected`: "Running" and a toast "Signed in to <name>". Codex: "Signed in: applies with your next message". The time limit: back to
    "Needs sign-in" with "Sign-in was not finished".
  - The tool card's **Sign in…** opens this dialog at that row (Q14). Text at least 10.5px; fits 1280x800 (FR-030).
- **FR-070** **Copilot token storage** (Q12 B): the Copilot session config (create and resume) sets `mcpOAuthTokenStorage: 'persistent'`,
  so the runtime keeps an MCP sign-in in the OS keychain, shared across sessions (`read:` `types.d.ts:2386-2393`). This is the vendor
  runtime's own store, not Durbar storage: Durbar never reads, lists, copies or clears it, and never logs the setting's effect. The
  one-shot session (spec 040 `oneShotConfig`, no MCP) is unchanged. Whether the entry is shared with the Copilot CLI is unverified
  (FR-074, T105).
  `[IMPLEMENTED]` 2026-10-21 (the FR-070 part of T098, see *Changes* 2026-10-21): in the shared `config` of `start()` in
  `src/adapters/copilot.ts`, so create, both resume paths and the FR-158 reconnect re-resume carry it; not in `oneShotConfig` or
  `renameResumeConfig`. `test:` `scripts/test-copilot-model.ts` (create, resume by id, `resumeSessionId`), `scripts/test-authcheck.ts`
  (reconnect), `scripts/test-copilot-oneshot.ts` (one-shot without it). `real:` 2026-10-21 (T116, run 39680461023, CI account,
  runtime 1.0.22, demo OAuth server on loopback): a sign-in in one session served a later session in a new runtime process on
  `windows-latest` (Credential Manager targets `<hex>.copilot-mcp-oauth`) and `ubuntu-latest` (no desktop keyring: files under
  `~/.copilot/mcp-oauth-config/`, research.md 7.7). `[KNOWN GAP]` how many macOS Keychain prompts it adds, a Linux desktop with a
  keyring, a third-party https server, and sharing with the CLI (T105). `[KNOWN GAP]` on Linux without a keyring the kept sign-in is a
  tokens file (`~/.copilot/mcp-oauth-config/<hex>.tokens.json`); whether it is encrypted and its file permissions are unverified (the
  check logs the mode bits from the next dispatch on). `[KNOWN GAP]` whether a tool call with a cached tool catalog and a kept token
  gets a 401 (needs a prompt).
- **FR-071** **Simulator** (constitution IV): page address `simmcpauth=1` gives each sim kind one server in needs-auth and a Copilot tool
  card with the issue's exact text; **Sign in** -> host `auth.example.com` -> **Open sign-in page** shows a toast and opens nothing ->
  "Running" after 2 s (Codex: "applies with your next message"). `simmcpauth=manual` shows the FR-068 steps instead.
- **FR-072** **Tests** (0 credits): the classifier (the issue's text, the runtime phrases, negatives: model text, a usage limit, a 401
  for the agent app's own sign-in); `isAuthError` false for the issue's text; the Copilot mapper (tool failure -> needs-auth +
  `mcpAuth`, cleared by the next status); Codex `failureReason`; the adapters on the fakes (Copilot `oauth.login` with only the allowed
  fields and never `handlePendingRequest`, the no-URL path, a missing method -> manual; Claude `mcp_authenticate` without `redirectUri`,
  `requiresUserAction: false`, "not supported in this context" -> manual; Codex login and completion by `loginId`, an unknown method ->
  manual); main (the window gets the host only, `http:` and user:password refused, the 10-minute limit, Cancel, End drops the address,
  no address in the `DURBAR_LOG` sink, the switch-off shortcut calls `setMcp`); masking of a failed MCP tool card.
- **FR-073** **Screenshots** at 1440x900 and 1280x800 (simulator): the needs-auth row, the two-step sign-in, the tool card line.
- **FR-075** **Where the sign-in page comes from** (review of PR #370, made a requirement by the owner's rule of 2026-10-20). The
  sign-in address comes from the server itself, and a per-folder extra can come from a repository the user did not write. The two-step
  confirm (FR-069) therefore shows the server's **origin tag** next to the host ("Sign-in page on **<host>** · from *this folder's
  extras*" or "· from *your MCP servers*", the same tag words as the row, FR-030). When the host's registrable domain differs from the
  server URL's (remote servers only; compared on the last two labels, or three for a known two-part suffix such as `co.uk`), one plain
  line is added: "This sign-in page is on a different site than the server (<server host>)." Nothing is blocked; the user decides.
  Test (FR-072): same domain shows no line; a folder extra on `mcp.example.com` with a sign-in page on `login.example.net` shows the
  tag and the line; a stdio server shows the tag and no line.
- **FR-076** **A saved sign-in outlives the session** (review of PR #370). With `persistent` storage (FR-070), a sign-in made for a
  per-folder extra stays in the OS keychain after the session ends. The per-folder extras trust confirmation (spec 019) gets one
  more sentence: "If one of these servers asks you to sign in, <App> may keep that sign-in in your system keychain after the session
  ends." The FR-069 waiting text says the same for Copilot ("Copilot keeps this sign-in in your system keychain").
  `[IMPLEMENTED]` 2026-10-21 for the trust confirmation, remote extras only (a stdio server has no OAuth sign-in), with the app left
  generic because the confirmation belongs to the folder, not to one agent app: "If this server asks you to sign in, the agent app may
  keep that sign-in in your system keychain after the session ends (Copilot does)." (`src/renderer/screens.js`, `sim:`
  `scripts/shots-m10.js`, screenshots `m10-folder-trust-*`). The waiting text waits for T102.
- **FR-074** `[KNOWN GAP]` Until the real checks (tasks T105-T107, needs-owner-approval, 0 AI credits, no prompt) run, everything above is
  `read:`: the three login calls, the Claude stream-json handler (the docs say `-p` and SDK runs cannot sign in; the 2.1.304 program
  strings handle `mcp_authenticate` there), whether Codex 0.163 has `mcpServer/oauth/login`, how long each runtime's callback listener
  waits, Copilot's `errorClassification` value for auth, and whether a sign-in made in the agent app's own CLI is seen by Durbar's
  session. The README and the row's *Details* say "not checked on a real account yet" until then.

#### Success criteria (delta)

- **SC-010** On a fake Copilot session, the issue's exact text on a failed MCP tool turns that server's row into "Needs sign-in" with
  Sign in and Switch off, and no spec 012 FR-157 sign-in card appears.
- **SC-011** No authorization address and no secret value reaches the window, the activity log or the `DURBAR_LOG` sink in the tests.
- **SC-012** On the fakes, Sign in makes exactly one runtime call per adapter (Copilot `oauth.login`, Claude `mcp_authenticate`, Codex
  `mcpServer/oauth/login`) and never a call that carries a token.

#### Edge cases (delta)

- Two sign-ins for the same server: the second press is refused while one is open; another server's sign-in may run.
- The session ends or restarts while the browser is open: the held address is dropped; the runtime's listener goes with the session
  (Claude, Codex child) or ends on its own (Copilot, `[KNOWN GAP]`).
- Copilot FR-158 restarts the shared runtime after an app sign-in: with `persistent` storage (Q12 B) the MCP sign-ins are expected to
  survive in the keychain (unverified, T105).
- The same server in two Copilot agents: with `persistent` storage one sign-in is expected to serve both (unverified, T105).
- A server that needs a pre-registered OAuth client (no dynamic registration): the runtime's error is shown masked, with the FR-068 steps;
  Durbar never asks for a client id or secret.
- The authorization server is `http:`: refused (Q16).

#### Open questions for the owner (delta, resolved 2026-10-20)

All answered by the owner: Q12 B, Q13-Q19 A, the recommended option each time (see *Clarifications*). The options are kept
below as the record of what was offered.

- **Q12 Copilot token storage.** A) Keep the SDK default (`in-memory`): sign in again for each Durbar session; nothing is kept after it
  ends. B) `persistent` (recommended): the runtime keeps the sign-in in the OS keychain like the Copilot CLI and VS Code do, so one sign-in
  serves later sessions (and maybe the CLI's `/mcp auth`); Durbar still never reads it. Needs the real check T105 to confirm sharing.
- **Q13 Opening the browser.** A) Two steps (recommended): Sign in, then "Sign-in page on <host>" and **Open sign-in page**, as spec 012
  FR-154 does for an elicitation URL. B) One click: Sign in opens the browser at once.
- **Q14 Where Sign in lives.** A) The MCP dialog row; the tool card's **Sign in…** opens the dialog at that row (recommended: one place
  for state). B) Also start the sign-in straight from the tool card.
- **Q15 Claude not launched yet** (after *Restart session*). A) "Send a message first", plus the FR-068 steps (recommended; matches Q11).
  B) Launch the Claude CLI quietly (no prompt, 0 credits) when Sign in is pressed.
- **Q16 Non-https authorization pages.** A) Refuse and show the FR-068 steps (recommended). B) Allow `http://` for `localhost` only.
- **Q17 Repeated failures.** A) Only offer **Switch off for this session** (recommended). B) Switch the server off by itself after three
  needs-auth failures in one session, with a toast.
- **Q18 Codex after a sign-in.** A) "Applies with your next message" (fresh child, same thread; recommended). B) Run *Restart session with
  these servers* by itself after the sign-in.
- **Q19 "Sign in with another account"** (Copilot `forceReauth`, Claude `mcp_clear_auth`). A) Not offered now (recommended). B) Offer it in
  the row's *Details*.

### 2026-10-21: Copilot keeps MCP sign-ins (FR-070 and the T111 wording first)

**Why now**: the owner (Vikram) found on Windows that an MCP sign-in made in one Durbar Copilot session was not kept for the next
one: `src/adapters/copilot.ts` never set `mcpOAuthTokenStorage`, so the SDK default `in-memory` applied (`read:`
`types.d.ts:2386-2393`). FR-070 is independent of the sign-in flow (T098's `startMcpSignIn`), so it ships on its own.

**Who**: by agreement in the team chat, Vikram's agent takes the FR-070 part of **T098** and the trust-confirmation part of **T111**
(FR-076); Paco (spec owner) keeps the rest of T098 (`startMcpSignIn`, fake SDK recorder) and T111's waiting text (with T102). Task
numbers and Paco's open work (PR #466, branch `058-mcp-oauth-impl`, T112-T115) are unchanged; T098 is ticked by Paco's PR when its
sign-in part lands.

**Done**: FR-070 `[IMPLEMENTED]`; FR-076 trust sentence `[IMPLEMENTED]`; README *MCP servers*, *Keychain prompts on a Mac* and a
*Known limits* line (Copilot CLI sharing unverified, FR-068/FR-074, T105); CHANGELOG. Not run on a real account.

### 2026-10-21: review of PR #473 (Restart and Restart session; Paco's agent)

Five small fixes found in review of the #349 slice, made in the same PR. No new FR; these lines record what changed.

- **FR-030**: *Restart session with these servers* sits under the server list, not in the dialog's footer button row, so the dialog
  stays open and refreshes after it (already noted in tasks.md, 2026-10-21; agreed with Paco's side on #473). The footer keeps
  *Settings*, *Folder extras…* and *Done* (and *Open log folder* once T052 is built).
- **FR-012**: SDK 1.0.22 always has the generated `rpc.mcp.restartServer` (`read:` `dist/generated/rpc.js:2830`), so "when the method
  exists" never chose the fallback. The fallback now runs when the runtime rejects the call as unknown (MethodNotFound, -32601, or
  "Unhandled method"); any other failure is reported (`test:` test-mcp-session).
- **FR-022**: after a confirmed Restart session on a busy agent, the card is Ready, not "Done" with the old output: the window's
  `stopped` handling clears the running turn, so the resume's `idle` is not read as a finished turn (`sim:` shots-058-mcp-restart).
- **FR-022 / FR-023** ("Remote control turns off"): End session's order (remote control off, then the session stops) is a pure helper
  `endSessionOp` in `src/main/agentops.ts`, shared by `agents:end`, `agents:remove` and Restart session, with an order test.
- Tests: the "one restart at a time" checks for both Restart and Restart session now fail when the lock is removed (checked by removing
  each lock), and `test-mcp-session` fails when it exits before its last check.

### 2026-10-21: real Copilot check of Restart and Restart session (T060)

Owner's go-ahead on 2026-10-21 (Telegram, "yes, both", about 1-2 prompts). One real Copilot session through Durbar's own
`CopilotAdapter` (SDK and bundled runtime 1.0.22, Linux), Ask first, a throw-away folder under the OS temp folder, two throw-away local
stdio servers given as the session's servers (`demo`: a 20-line echo server; `broken`: a command that does not exist). No secrets; only
event types, field names, states and the throw-away servers' own text were recorded. Two prompts: one that calls `demo`'s `echo` tool
(proves the server works and gives the session a turn) and one "reply ok" after Restart session.

- real: **the Copilot runtime starts the session's MCP servers with the first message, not at session create**: no
  `session.mcp_server_status_changed` and no server process for 30 s after `createSession`; `pending` then `connected` / `failed` within
  about 60 ms of the first `send`. The same after a resume: no server event for 20 s, the servers started with the next message.
  **Fix (FR-010)**: Copilot's `mcpStart` is now `'next-message'` (was `'session'`), so the dialog and the Restart session toast say the
  servers start with the next message. FR-002's Copilot line reads "Copilot starts these servers with your next message".
- real (FR-012): the runtime has `session.rpc.mcp.restartServer`; Restart used it (no fallback). The server's own events were
  `session.mcp_server_removed`, then `status_changed` `not_configured` -> `pending` -> `connected`, in about 75 ms, with a new server
  process. The dialog's row shows "Not set up for this session" for that moment (FR-001's word for `not_configured`).
- real (FR-011, input for T022): a server whose command does not exist is `failed` with `error` "failed to spawn MCP server process: No
  such file or directory (os error 2): …" and `errorClassification: "os_not_found"` (data keys `configSource, error,
  errorClassification, serverName, status`). `session.mcp_servers_loaded` lists it with `error, name, status`. Mapping it to
  `errorClass: 'not-found'` stays T022.
- real (FR-012): Restart of that failed server: `restartServer` rejects with JSON-RPC -32603 and the text "Request
  session.mcp.restartServer failed with message: failed to spawn MCP server process: …"; no fallback (correct: not MethodNotFound).
  **Fix**: the adapter drops the SDK's "Request <method> failed with message: " prefix, so the dialog shows the server's own reason.
- real (FR-022): Restart session (`stop`, then `start` with `sessionId` = the same id, as `ensureLive` does) kept the id and the
  conversation (`history` 66 items: the first turn's messages and tool calls), and the next message started the **new** server set
  (`demo` and a new `demo2` connected; `broken`, no longer given, absent). A `resumeSessionId` of a session that never had a message
  fails ("Session not found"): `ensureLive` uses `sessionId` (resume when it exists, else create with this id) unless the session is
  in the folder's previous sessions, so Restart session is not affected.
- real (FR-024): `~/.copilot/logs` exists on this machine (checked for existence only; nothing opened).
- Not checked: T061 (Claude Code `mcp_reconnect`) and T062 (Codex) on a real session; macOS and Windows; the off-then-on fallback on an
  older runtime (this runtime has `restartServer`).

### 2026-10-21: real check of FR-070 on CI runners (Windows first; T116)

**Why**: the owner (Vikram, team chat 2026-10-21 20:46 UTC) asked to test the kept MCP sign-in (FR-070, #471) on Windows with a demo
MCP server that needs a real OAuth sign-in. Nobody on the team has a Windows machine, so the check runs on GitHub's `windows-latest`
(and `ubuntu-latest` to compare), started by hand (`workflow_dispatch` only, never on a pull request).

**What** (task T116; it covers the "later session" part of T105 and does not replace T105 on the owner's machine):
- `scripts/demo-oauth-mcp.ts`: a dependency-free demo remote MCP server on loopback that **requires** OAuth (MCP authorization
  2025-06-18): 401 with `WWW-Authenticate: Bearer resource_metadata=...`, protected-resource and authorization-server metadata, dynamic
  client registration, S256 PKCE only, one-use codes, registered redirect URIs only, refresh-token rotation. It auto-approves (no
  consent page) and counts registrations, sign-ins (`/authorize`), grants and requests, never tokens. Its MCP part is Durbar's own
  `McpSession` (spec 041). `scripts/test-demo-oauth-mcp.ts` (in `npm test`) proves the flow is enforced.
- `scripts/mcp-oauth-real.ts`: through Durbar's Copilot adapter and its session config (`persistent`), session A shows the server's
  state, calls `session.rpc.mcp.oauth.login` with only `serverName`, `clientName`, `callbackSuccessMessage` (the call T098 will make;
  until T098 lands the script reaches the live session object, test code only), completes the authorization URL with a plain HTTP
  client (the demo's 302 goes to the runtime's own loopback callback), and waits for `connected`. Session A2 (same runtime) and session
  B (a new adapter, so a new runtime process) must connect with **no new `/authorize`**. Also, names only: Windows Credential Manager
  targets (`cmdkey /list`) and new file names under `~/.copilot`, before and after. **0 prompts**: no message is sent.
- `.github/workflows/mcp-oauth-real.yml`: `workflow_dispatch` only, `contents: read`, the CI Copilot token in the one step's env,
  artifact = the sanitized step log and verdict (no token, no authorization URL beyond host and path, no credential values).

**Limits**: a loopback `http` demo server, not a third-party https one; the browser step is an HTTP client, not a browser; the
Copilot CLI's `/mcp auth` sharing (rest of T105) and the Durbar UI flow (T098-T102) are not part of this check.

Results: see research.md section 7.7. `real:` 2026-10-21, run 39680461023 (runtime 1.0.22, 0 prompts): PASS on `windows-latest`
and `ubuntu-latest`; session B in a new runtime process connected with no new sign-in. Windows keeps it in Credential Manager
(`<hex>.copilot-mcp-oauth`); the Linux runner, with no desktop keyring, kept it in files under `~/.copilot/mcp-oauth-config/`.

**Review on #478 (fjcabello, 2026-10-21; fixed 2026-10-22, no new dispatch)**: research 7.7 now says "one 401 each; the settled state
was connected within 1 s; transient states were not recorded". The check script logs every `mcp` state per session in order
(`statusSequence`, unit-tested in `scripts/test-demo-oauth-mcp.ts`), one log line per new file or Credential Manager target (the
300-character line cap cut the Linux list), and on Linux and macOS each new file's permission bits (`fs.statSync`, never the
contents); these run on the next dispatch. The demo server now binds access tokens to the `resource` (RFC 8707): `/mcp` refuses a
token issued for another resource, and a refresh keeps its resource; the test also redeems a code with a different `redirect_uri`
(400) and checks the server's address is `http://127.0.0.1:` (taken from the bound address). New `[KNOWN GAP]`s in FR-070: the
Linux tokens file's encryption and permissions; the cached-catalog tool call 401.


### 2026-10-23: live status and actions in Settings (owner request, issue #596)

**Status**: specified 2026-10-23, built in the same PR (tasks T120-T126; simulator and unit tests only, not on a real account).

**Input**: owner (Vikram, 2026-10-23, real use on macOS): the per-chat MCP dialog (More > MCP servers, or the MCP chip under the
message box) shows each server's live state with Restart, Details and the switches, but he only found it after being told. He wants
the same in **global Settings > MCP servers**, not only inside a chat. Owner-urgent: it may go past the team's "land before building"
cap (`AGENTS.md`, backlog first), and the PR says so.

**Why this spec owns it** (not spec 069): the state words, icons, hints, *Details*/*Copy*, per-server Restart and *Restart session with
these servers* are spec 058's (FR-001, FR-006, FR-007, FR-012, FR-021, FR-022, T113-T115). Spec 069 owns the *configured* lists in
Settings (add, remove, harmonize, source chips); this delta only shows spec 058's live state and actions in a second place, next to
spec 069's lists, and changes nothing in them.

**Reuse, no parallel version** (AGENTS.md, *Look for an existing capability first*):
- the words, icons and hints are `DurbarMcpWords` (`src/renderer/mcpwords.js`: `stateOf`, `iconSvg`, `hintFor`, `plain`); the
  aggregation is a new pure function in the same helper (`aggregate`), so the two places can never use different words;
- the data is the existing `agents:mcp` reply of each running session (`agentMcpReply` in `src/main/mcpsession.ts`): main already masks
  every error there (FR-005), so the Settings view gets nothing the chat dialog does not; **no new IPC channel**;
- Restart is the existing `agents:mcpRestart` (Copilot `restartServer`, Claude `mcp_reconnect`; Codex has none) and Restart session is
  the existing `agents:mcpRestartSession`, through one shared renderer flow that the chat dialog now uses too (same busy, grants and
  remote-control confirmation, FR-023; same sign-in card on an expired sign-in, FR-027);
- *Open in chat* opens the existing chat dialog (`DurbarScreens.agentMcp`) with the same options the MCP chip passes.

#### Requirements (delta)

- **FR-080** `[IMPLEMENTED]` (`sim:` shots-058-mcp-settings) **Live status in Settings.** Settings > MCP servers starts with a *Live in
  your chats* list: one row per MCP server that a running chat uses or that one of the configured lists in that section has (the Copilot
  CLI list and spec 069's Claude Code and Codex lists). Each row shows the server's name and its **live state aggregated over the running
  chats that use it** (FR-081). A server no running chat uses reads "Not started yet" (FR-001's word). With no running chat the list says
  so in one plain sentence ("No chat is running, so no MCP server is running. Live states show here while a chat runs.") and has no
  actions.
- **FR-081** `[IMPLEMENTED]` (`test:` test-mcpwords) **Aggregation** (`DurbarMcpWords.aggregate`, pure): per server, the running chats
  that use it are counted by state, with FR-001's words and the count: "Running in 3 chats", "Needs sign-in in 1 chat", "Failed in 1
  chat · Running in 2 chats". Order, most urgent first: Failed, Needs sign-in, Starting, unknown states, Not started yet, Running, Not
  set up for this session, Stopped, Off for this session. The row's icon and colour class are those of the most urgent state (never
  colour alone, constitution V). A chat "uses" a server when its `agents:mcp` reply lists it and it is switched on for that chat, or the
  agent app reported a state for it. A chat's server with no reported state counts as "Not started yet" (for example Copilot and Claude
  start servers with the next message). Rows with a failed or needs-sign-in chat come first, then servers a running chat uses, then the rest, each group by name. Names (1-200
  characters) are compared exactly (as `agents:mcp` lists them); at most 200 servers and 50 chats are shown.
- **FR-082** `[IMPLEMENTED]` (`sim:`) **Per-server expander.** Each row has a toggle (a button with `aria-expanded`, named "Show the
  chats that use <server>") that lists the chats using it: the agent's name and folder, that chat's state word and icon, the hint for a
  failed or needs-sign-in state (FR-006, the same words as the chat dialog, with the agent app's name), *Details* with the masked text and
  *Copy* (FR-007; the text came masked from main), and these actions:
  - **Restart** (only when that chat's reply has `canRestart`): restarts this server in this chat only, through `agents:mcpRestart`, with
    FR-031's feedback ("Restarting…", disabled, then a toast). Named "Restart <server> for <agent>".
  - For an agent app with no per-server Restart (Codex): FR-032's line "<App> cannot restart one server; use Restart session with these
    servers".
  - **Restart session with these servers** (when that chat's reply has `canRestartSession`): FR-022 and FR-023 unchanged; the same
    confirmation (busy, session grants, remote control), the same `needsConfirm` round trip, and on an expired sign-in Settings closes
    and the chat shows FR-027's sign-in card.
  - **Open in chat**: closes Settings and opens that chat with its MCP dialog, so the per-chat dialog can be found from Settings.
  - Needs-sign-in rows show the chat dialog's sign-in hint. When issue #364's *Sign in* (FR-064, Paco's) lands, its button is added to
    this row through the same code; this delta builds no sign-in of its own.
- **FR-083** `[IMPLEMENTED]` (`sim:`) **Live refresh.** While Settings is open, an `mcp` event of any running chat (and a chat that
  stops or is ready again) reloads the list (throttled to one reload per 150 ms) without repainting the rest of Settings, keeping the focus on the same
  control (by server, chat and action) and the scroll position; state changes are announced through the existing polite live region, as
  FR-004 does in the chat dialog. An action the user just took is not announced back.
- **FR-084** `[IMPLEMENTED]` (`sim:`) **Finding it.** The *Advanced: MCP servers* heading shows how many servers need attention ("2
  need attention": failed or needs sign-in in at least one chat), and the chat dialog's *Settings* button now opens Settings at its MCP
  servers section (it opened Settings at the top).
- **FR-085** `[IMPLEMENTED]` (`sim:`) **Layout.** Text at least 10.5px; with 10 or more servers and their expanders the list scrolls
  inside Settings' own scroller (no page scroll, no horizontal overflow) at 1440x900 and 1280x800; no control is covered (checked with
  `elementFromPoint`); theme tokens only (`test:theme-tokens`).
- **FR-086** `[IMPLEMENTED]` (`sim:`; `test:` test-mcpwords) **Nothing new leaves main.** The renderer shows only what `agents:mcp`
  returns (masked errors, names, states, flags); *Copy* copies that masked text. No path, no secret value, no new IPC channel.
- **FR-087** `[KNOWN GAP]` Not checked with real agent apps: the aggregation reads the same `mcp` reports as the chat dialog, whose
  real-account limits are FR-050 and FR-051; macOS and Windows not seen (simulator on Linux only).

#### Success criteria (delta)

- **SC-080** From Settings alone, a user can see which servers failed or need a sign-in in which chat, restart one server in one chat,
  restart a chat's session, and reach that chat's own MCP dialog, without opening a chat first.

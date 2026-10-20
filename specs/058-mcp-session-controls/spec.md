# Feature Specification: MCP servers in a session: clear status, Restart, last error and log folder

**Feature Branch**: `058-mcp-session-controls`
**Created**: 2026-10-20
**Status**: Specified and clarified (spec, research, plan and tasks; **no code**). The owner answered Q1-Q11 on 2026-10-20 (all option A,
see *Clarifications*).
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

- **FR-001** Every server row shows one **word and icon** for its state, from one pure table (no colour alone, constitution V):
  `connected` "Running"; `pending` "Starting"; `failed` "Failed"; `needs-auth` "Needs sign-in"; `disabled` "Off for this session";
  `stopped` "Stopped"; `not_configured` "Not set up for this session"; no state yet "Not started yet"; anything else "Unknown state"
  followed by the escaped token. A switch the adapter applies with the next message shows "Off from your next message" / "On from your
  next message" until the runtime reports the new state.
- **FR-002** Under the list, **one line says how servers start for this agent app**, chosen from the adapter's normalized start mode
  (FR-010): *with the session* ("Copilot starts these servers when the session starts: when the folder is added, when you open a
  restored chat, or with the first message"), *with the next message* ("Claude Code starts these servers with your next message"), and
  the switch timing (*at once* or *from your next message*). The current claim "a switch applies right away" is shown only when the
  adapter applies it live.
- **FR-003** The dialog explains the two scopes in one sentence each: **This session** (the switch and Restart; kept until the app is
  closed, as today) and **New sessions** (Settings and the folder's extras; spec 019 FR-008). Wording reviewed against the README's MCP
  section (one word per concept, spec 052).
- **FR-004** The dialog **updates while open** when an `mcp` event for that agent arrives (state, error), without losing focus or
  scroll position.

### Errors (P1)

- **FR-005** The runtime's failure text reaches the renderer **only after main masks it**: `redact()` with the environment and header
  values of the session's own MCP servers (the folder's extras, known to main only) plus the process environment, then
  `maskSecretUrl` for URLs, cut to 300 characters. This also closes today's gap where the error reached the renderer unmasked
  (research section 1). Never logged; the `DURBAR_LOG` sink stays as it is.
- **FR-006** A **hint** is chosen from the masked text, the state and a normalized error class (FR-011): needs sign-in; command not found
  (`ENOENT`, "command not found", "is not recognized"); permission denied (`EACCES`); timed out; connection refused or host not found;
  the server exited or crashed; configuration error; otherwise none. One short sentence with what to check (Settings, the folder's
  extras, the Copilot CLI list). Pure, unit-tested.
- **FR-007** A failed row has a *Details* toggle with the masked text and *Copy* (copies the masked text only).

### Adapter surface (adapter-neutral, constitution II)

- **FR-010** `AdapterCapabilities` gains optional, plain fields (missing = today's behaviour):
  - `mcpStart?: 'session' | 'next-message'`: when servers start (Copilot and Codex `session`, Claude `next-message`);
  - `mcpToggleApplies?: 'live' | 'next-message'`: when the switch takes effect (Copilot and Claude `live`, Codex `next-message`);
  - `mcpRestart?: boolean`: `restartMcpServer()` exists (Copilot and Claude true, Codex false);
  - `mcpLogs?: 'session' | 'per-server'`: `mcpLogFolder()` exists (Copilot `session`, Claude `per-server`, Codex `session`;
    Claude's folder labelled undocumented, Q6; Codex's shown only when it exists, Q7).
- **FR-011** `McpServerStatus` gains optional `errorClass?: 'auth' | 'not-found' | 'timeout' | 'exited' | 'config'` (set by the adapter
  only when the vendor says so: Copilot `errorClassification` values once seen, Codex `failureReason: reauthenticationRequired` ->
  `auth`, Codex `authStatus: notLoggedIn` -> `auth`) and `needsRestart?: boolean` (Copilot `session.mcp_server_needs_reconnect`).
  Claude's `init.mcp_server_errors` become `failed` rows with their text. No vendor type leaves the adapter.
- **FR-012** `AgentAdapter.restartMcpServer?(sessionId, name): Promise<void>`, present exactly when `mcpRestart` is true (contract C2):
  - Copilot: `session.rpc.mcp.restartServer({ serverName })` when the method exists; when it does not (an older runtime), off then on
    for that server only (`disable` then `enable`) (Q3); never `stopServer` (Q2); never `reload()` (all servers);
  - Claude: control request `mcp_reconnect { serverName }`, then `mcp_status` for the new list (as FR-133 does after a toggle). A server
    that was off at launch is not in the running CLI: "Switch it on first; it starts with your next message";
  - Codex: not present.
  - A session that is not live: rejects with "This session is not running." Nothing is started.
- **FR-013** `AgentAdapter.mcpLogFolder?(sessionId, name?): string | undefined` returns the folder where the agent app keeps logs
  (per server when `mcpLogs` is `per-server`), from a pure per-OS function with injected environment (research sections 2-4):
  Copilot `<COPILOT_HOME or ~/.copilot>/logs`; Claude `<cache>/claude-cli-nodejs/<project>/mcp-logs-<server>` (env-paths
  convention per OS, project and server names sanitized as the CLI does; a name longer than 200 characters gives no folder); Codex
  `<CODEX_HOME or ~/.codex>/log`. The path never reaches the renderer.

### Main process and IPC (constitution III)

- **FR-020** `agents:mcp` adds to its reply: per server `canRestart`, `errorClass`, `needsRestart`, the masked error (FR-005), and a
  `logFolder` flag (FR-024); per agent `start` and `toggleApplies` (FR-010), `canRestartSession` (FR-022) and the agent app's display
  name. No path, no secret value.
- **FR-021** `agents:mcpRestart(id, name)`: a known agent id, a server name of 1-64 characters that is in that agent's list; the adapter
  must have `restartMcpServer`; the session must be live. Returns `{ ok, error? }` with a short, masked error. One restart per server
  at a time per agent (a second call while one runs is refused). An activity-log row (spec 052) records "MCP server <name> restarted"
  with no error text.
- **FR-022** `agents:mcpRestartSession(id, confirmed)`: Restart session with these servers.
  - Allowed when the adapter has `resume` and the agent is a main agent with a session id that can be resumed.
  - When the agent is working, thinking or waiting (main's own state tracker, not the renderer's word), `confirmed` must be `true`;
    otherwise it returns `{ ok: false, needsConfirm: true }` and changes nothing. (The renderer may ask in more cases, FR-023; main
    enforces only this one.)
  - It does what *End session* does (remote control off first, spec 054 FR-003; `adapter.stop`), then starts the **same id** through
    the existing resume path (`ensureLive`) with the current `startOptionsFor(a)`, so Settings, folder extras and this agent's switches
    all apply. No prompt is sent.
  - The renderer is told the result; the chat keeps its history (nothing is reloaded unless the adapter reports a new session id).
  - If the resume fails, the agent stays ended (as after *End session*) and the error is shown; sending a message tries again.
  - Always the same session (Q4); there is no new-session variant. For Claude the CLI is not launched by the restart: its servers start
    with the next message, and the dialog says so (Q11). The button lives only in the MCP dialog (Q10).
- **FR-023** Confirmation text (renderer, Cancel focused): "Restart <name>'s session with the current MCP servers? The conversation is
  kept and resuming spends no AI credits. <If working:> The running turn stops. <Always:> 'Approve for this session' grants are cleared.
  <If remote on:> Remote control turns off." Shown when the agent is working, thinking or waiting, or has session grants or remote
  control on.
- **FR-024** `agents:mcpRevealLogs(id, name?)`: main asks the agent's adapter for the folder (FR-013), checks with `fs.stat` that it is an
  existing directory (it never lists, opens or reads files in it), then calls Electron `shell.showItemInFolder(folder)` (no shell, no
  command string). A missing folder returns `{ ok: false, error: 'No log folder found for this agent app yet.' }`. The flag in FR-020
  is true only when the adapter has `mcpLogs` and the folder exists at the time of the `agents:mcp` call.
- **FR-025** Durbar never copies, uploads or stores a vendor log file and never shows log lines in the app. The owner chose no log viewer
  (Q5); a viewer would need a new spec and the owner's approval.

### Dialog (renderer)

- **FR-030** Row layout: name, origin tag (as today), state word and icon, hint (failed only), switch, and **Restart** (only when
  `canRestart`, the session is live and the server's switch is on). Footer buttons: *Restart session with these servers* (when
  `canRestartSession`), *Open log folder* (session-level folders; per-server folders are a small link in the row's *Details*, for Claude labelled "not
  documented by Anthropic", Q6),
  *Settings*, *Folder extras…*, *Done*. Text at least 10.5px; the dialog fits 1280x800 with 12 servers without page overflow (the list
  scrolls inside the dialog).
- **FR-031** Restart feedback: the button shows "Restarting…" and is disabled until the call returns; then a toast "Restarted <name>" or
  the masked error; the row then follows the runtime's events (FR-004).
- **FR-032** Codex rows: no Restart; the footer line says "Codex cannot restart one server; use Restart session with these servers".
  No "Reload servers" control (Q8).
- **FR-033** Keyboard and screen readers: every new control is a focusable button with a name ("Restart <server> for <agent>"); state
  changes in the list are announced through the existing polite live region; Esc closes.

### Simulator and tests (constitution IV)

- **FR-040** The simulator gives each kind its real capability values (fixes today's `mcpToggle: false` for the Claude and Codex sim
  kinds) and servers in every state, including a failed one with a hint and a canned Restart that goes Starting -> Running, and a
  canned *Restart session*. *Open log folder* in the simulator shows a toast, never opens a folder.
- **FR-041** Unit tests (0 credits): the word and hint tables; masking in `agents:mcp` (an extra's header and env value, a URL with
  credentials, a `ghp_` token); `agents:mcpRestart` and `agents:mcpRestartSession` validation and order (stop then start with the same
  id and the new options; refuse without confirmation while busy); the per-OS log folder function (Linux, macOS, Windows, with
  `COPILOT_HOME`, `CODEX_HOME`, `XDG_CACHE_HOME`, `LOCALAPPDATA`); the Copilot adapter on the fake SDK (`restartServer`, the
  fallback, never `stopServer`); the Claude adapter on the fake CLI (`mcp_reconnect` then `mcp_status`); contract C2 lines for the new
  members; the mappers for `errorClassification`, `needs_reconnect`, `failureReason`, `mcp_server_errors`.
- **FR-042** Screenshots of the dialog at 1440x900 and 1280x800 on the simulator (constitution VII).

### Honest limits

- **FR-050** `[KNOWN GAP]` Until the real checks run (tasks Phase 6; one no-prompt check per agent app, only with the owner's go-ahead
  at that time, Q9), Copilot `restartServer`, Claude `mcp_reconnect`, the log folders,
  `errorClassification` values and resume with a changed server set are `read:` only; the README and the dialog's *More* text say
  "not checked on a real account yet" for Restart and the log folder.
- **FR-051** `[KNOWN GAP]` Whether a server's stderr reaches any of the three log folders is not documented; the dialog says "the
  agent app's log folder" and never promises server output.
- **FR-052** `[KNOWN GAP]` MCP sign-in (OAuth) stays out of scope (spec 019): "Needs sign-in" explains it and points to the agent app's
  own sign-in (`copilot`, `claude mcp login <name>`, Codex), without running it.

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
  dialog's wording for Codex's next-message switch.
- **005 / 006** (End session, resume): Restart session reuses *End session* and the existing resume path, with the same confirmation
  rule (005 FR-017).
- **054** (remote control): ended by Restart session as by End session.

## Changes`.
- **020** (CLI list first, folder extras): the "New sessions" scope in FR-003 is 020's; no change to its stores.
- **012** (FR-133 Claude toggle, FR-147 Codex MCP): the switch behaviour stays; FR-012 adds Claude `mcp_reconnect`; FR-002 fixes the
  dialog's wording for Codex's next-message switch.
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

(none yet)

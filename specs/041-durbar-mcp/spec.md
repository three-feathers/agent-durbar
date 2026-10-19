# Feature Specification: Durbar MCP server (configure and query Durbar from an MCP client)

**Feature Branch**: `041-durbar-mcp` (touches 003/018 permission modes, 006 folders, 011 caps and usage totals, 019/020/024 MCP extras and places, 033 floors, 012 adapters and redaction)

**Created**: 2026-10-18

**Status**: Planned 2026-10-18: clarified (owner accepted all Q1-Q12 defaults, see *Clarifications*), [plan](plan.md) and [tasks](tasks.md) drafted, analyze fixes done (`## Changes`, 2026-10-18, analyze fixes). No code yet. Nothing here is verified: every requirement is a target, not a claim.

**Input**: Owner (Ruben, rubenlupi), 2026-10-18: "That the user can also use an MCP against this application to configure it, etc." Durbar exposes its own MCP server, so the user's own MCP client (Claude Code, Copilot CLI, Claude Desktop, VS Code) can, in plain language, read the office (folders, floors, agents and their state, usage totals and caps) and ask for configuration changes (add or remove a folder, permission mode, per-folder MCP extras, credit caps). Every change is confirmed by the user in Durbar's own window.

## Context: what exists today

All configuration is changed by the renderer through the typed preload bridge (`DurbarApi`, `src/shared/api.ts:320-423`) and validated in the main process (constitution III). The main process holds the agents (`agents` map) and the stores; there is no other way in. The MCP server must reuse these validated paths, not copy them:

- **Folders** (spec 006): `FolderStore` in `durbar-folders.json` (`src/main/main.ts:679`, `src/main/folders.ts:104-275`; saved fields `src/main/folders.ts:16-33`). Add goes through a native picker and then `addMany`/`addWorkspace` (`src/main/main.ts:178-230`, `260-275`), which **starts a runtime session** (`ad.start`, `main.ts:193`). Remove ends every session of the folder (`folders:remove`, `main.ts:592-609`). Restored folders come back as "not started" agents (`restoreFolders`, `main.ts:236-249`).
- **Permission mode** (specs 003, 018): per agent, saved per folder; `setModeOp` (`src/main/agentops.ts:25-38`), already free of Electron and unit-tested. Names in the UI: **Read-only / Ask first / Allow all** (`README.md:78`); switching *to* Allow all asks for confirmation in the window today.
- **Credit caps** (spec 011): per agent `setCapOp` (`src/main/agentops.ts:41-56`), default cap `SettingsStore.setDefaultMaxAiCredits` (`src/main/settings.ts:50`, IPC `main.ts:439`); limits `MIN_CAP` 30 and `MAX_CAP` 1,000,000 (`src/shared/credits.ts:10-13`, `parseCap` line 21).
- **Usage totals** (spec 011 FR-026): `UsageTotalsStore` (`src/main/usagetotalsstore.ts:33-115`) keeps two views: `baselineView()` (line 98), the figures saved **before** this run, which the window adds its own live figures to, and `view()` (line 104), the document as it is now, which already holds the baseline plus every `usage` event main recorded this run (`main.ts:100-104`). The read tool uses `view()`.
- **MCP extras and the Copilot CLI list** (specs 019, 020, 024): `McpStore` (`src/main/mcpstore.ts`) with secrets encrypted by `safeStorage` (`src/main/mcpipc.ts:19-36`) and never returned to a view; a trust gate (`setEnabled` needs `trustAck` after the user saw the command, `mcpstore.ts:295-300`, `trustInfo` line 235). The IPC handlers are inline closures in `registerMcpIpc` (`src/main/mcpipc.ts:85-144`), so reuse needs them moved into testable functions the way `agentops.ts` did for modes and caps. `~/.copilot/mcp-config.json` is read only, never written (`src/main/mcpfiles.ts:1-5`).
- **Floors** (spec 033): `FolderStore` floor operations and `floorsState` (`main.ts:556-579`). **Places** (spec 024): `SettingsStore` place map and custom places (`settings.ts:77-140`).
- **Agent state** (working, waiting, error, ...) is known only in the renderer, from normalized events; `AgentInfo` has no status field (`api.ts:18-46`). Main sees the same events (`router.onEvent`, `main.ts:100`, `119`) but does not keep a status.
- **Simulator agents live in the renderer** (`DURBAR_SIM`, `main.ts:644-654`, `src/renderer/sim.ts`); main does not see them. The scripted `FakeAdapter` (`src/adapters/fake.ts:1-7`) is meant for a future main-side simulator (`DURBAR_SIM_MAIN`, spec 012 plan).
- **Debug log**: only the developer hook `DURBAR_LOG` (`main.ts:141-147`), ignored in packaged builds (`src/main/devhooks.ts`). Redaction of secrets in that log (`src/shared/redact.ts`, spec 012 T051, PR #157) is on `main`.
- **Dependencies**: no MCP SDK in `package.json` (runtime deps: `@github/copilot-sdk`, `dompurify`, `marked`). There is no single-instance lock in `main.ts`.
- **Agents load ambient MCP config**: a Copilot session loads `~/.copilot/mcp-config.json` by itself; Durbar can only switch entries off by name (`disabledMcpServers`, `src/adapters/copilot.ts:178-182`). Claude sessions use `strictMcpConfig: true` (spec 012 FR-025, PR #160, on `main`: `src/adapters/claudeModes.ts`). So if the user registers Durbar's MCP server in the Copilot CLI file, every Copilot agent that Durbar starts would get it unless Durbar removes it.

## Clarifications

### Session 2026-10-18 (owner)

Ruben (owner) accepted **all twelve recommended defaults** in Q1-Q12 ("All defaults", 2026-10-18). They are decided:

- Q1 Transport: (a) a stdio bridge launched by the client, a per-user socket or named pipe, and a secret file. No network port.
- Q2 Bridge executable: (a) the Durbar app itself with a flag.
- Q3 MCP implementation: (b) a dependency-free subset (`initialize`, `tools/list`, `tools/call`, `ping`, stdio framing), with tests against recorded client handshakes. No new dependency.
- Q4 Starting sessions and sending prompts: out of v1.
- Q5 Waiting for the user: wait 30 s, then return `pending`; a request expires after 10 min.
- Q6 Queue: one dialog at a time, at most 5 waiting besides the one on screen, extra ones `busy`.
- Q7 Secret values for MCP extras: (a) refused; key names only, and the user types values in Durbar.
- Q8 Floors, places, serious mode and the Copilot CLI on/off list: read-only over MCP in v1.
- Q9 Agent marker (FR-034): best effort, set only in each runtime's environment (FR-057); `[KNOWN GAP]` for any adapter that cannot set it; FR-022 (a human click in Durbar) is the real gate.
- Q10 Simulator: (a) `FakeAdapter` plus a main-process simulator for tests.
- Q11 Durbar not running: the bridge never starts Durbar.
- Q12 Audit: an in-memory *Recent MCP activity* list in Settings (last 100, cleared on quit) plus `DURBAR_LOG` when set; no new file on disk.

The open questions below are kept for the record; each now reads as decided above.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ask my MCP client what Durbar is doing (Priority: P1)

As someone who runs many agents in Durbar, I ask my own assistant (for example Claude Code in a terminal) "which agents are waiting for me?" or "how many AI credits has the office spent since Monday?", and it answers from Durbar, without me switching windows.

**Why this priority**: Read-only, no risk to the office, and it proves the whole channel (switch on, connect, discover tools, answer). Every other story builds on it.

**Independent Test**: With unit tests and a fake client over the chosen local transport, and with the main-process fake adapter, turn the server on, connect, call each read tool, and compare the answers with the stores and the agents map. No AI credits, no real session.

**Acceptance Scenarios**:

1. **Given** the Durbar MCP server is off (the default), **When** a client tries to connect, **Then** the connection is refused with a short message saying to turn it on in Durbar's Settings, and Durbar shows nothing.
2. **Given** the server is on and Durbar is running, **When** the client lists tools, **Then** it sees the read tools of FR-010 and the change tools of FR-020 with short descriptions that say every change needs confirmation in Durbar.
3. **Given** three folders on two floors, one agent waiting for an approval, **When** the client calls the agents tool, **Then** it gets each agent's id, name, folder, floor, adapter kind, permission mode (Read-only / Ask first / Allow all), cap, and state (for example "waiting for approval"), and no prompt, chat text, tool argument, environment value or secret.
4. **Given** usage was recorded before and during this run, **When** the client asks for usage totals, **Then** the office and per-folder figures match what the window shows (saved baseline plus this run).
5. **Given** Durbar is not running, **When** the client calls any tool, **Then** it gets "Durbar is not running" and nothing is started.

---

### User Story 2 - Change a setting from my MCP client, confirmed in Durbar (Priority: P1)

As a user, I tell my assistant "put the agent-durbar folder in Ask first" or "set the default cap to 200 credits". Durbar shows me a dialog saying exactly what was asked and by which client; I click Apply or Deny; my assistant hears the result.

**Why this priority**: This is the owner's goal ("to configure it"). It is P1 together with Story 1 because the confirmation gate is the security design.

**Independent Test**: Unit tests on the request queue and the dialog model (pending, applied, denied, expired), plus a simulator/driver check of the dialog at 1440x900 and 1280x800. The change itself goes through the same functions as the window (`setModeOp`, `setCapOp`, ...), so their existing tests still hold.

**Acceptance Scenarios**:

1. **Given** the server is on, **When** the client asks to set folder X's mode to Ask first, **Then** Durbar's window shows a confirmation dialog naming the client (as it reported itself, marked as such), the folder (full path), the current value and the new value, and the client gets `pending` with a request id.
2. **Given** that dialog, **When** I click Apply, **Then** the change is made through the same code path as the window, the client (on its next call or while waiting) gets `applied` with the new value, and the office shows the new mode.
3. **Given** that dialog, **When** I click Deny, press Escape or close the window, **Then** nothing changes and the client gets `denied`.
4. **Given** a request to switch to **Allow all**, **Then** it is `refused` at once with "Allow all can only be turned on in Durbar's own window." and no dialog (FR-050, FR-060); a switch between Read-only and Ask first, either way, gets the dialog (D-d) and never approves pending requests (no `approvePending` from the MCP path).
5. **Given** I do not answer within the time limit (Q5), **Then** the request expires, nothing changes, and the client gets `expired`.
6. **Given** a request whose input is invalid (unknown folder, cap below 30, unknown mode), **Then** it is refused at once with the same error text the window gives, and no dialog is shown.

---

### User Story 3 - Add or remove folders and manage per-folder MCP extras (Priority: P2)

As a user, I ask my assistant "add ~/code/api to Durbar in Read-only" (it lands on the last floor, as in the window, FR-054) or "add the GitHub MCP server to that folder", and confirm in Durbar.

**Why this priority**: Useful, but each of these has more risk (a new folder, a command that will run, secrets) and needs the dialog to show more detail.

**Independent Test**: Unit tests for path validation, the lazy add, removal counts, MCP extra validation (`validateInput`, reserved names) and the trust step; driver screenshots of the three dialogs.

**Acceptance Scenarios**:

1. **Given** an absolute path to an existing folder or `.code-workspace` file, **When** the client asks to add it, **Then** after Apply it is saved on the last floor (floors are read-only over MCP, FR-054) and shown as a "not started" agent (like a restored folder): no runtime session starts and no AI credits are spent until I send a message in Durbar.
2. **Given** a request to remove a folder, **Then** the dialog says how many agents (and how many running sessions) will end, and only Apply removes it.
3. **Given** a request to add an MCP extra with a command, **Then** the dialog shows the exact command, arguments, URL and the **names** of environment variables and headers; the server is saved off and untrusted; trusting it is done only in Durbar's own MCP extras screen (FR-050), and only an extra I already trusted there can be turned on over MCP (D-b).
4. **Given** a request that carries secret values for an extra, **Then** (default of Q7) the values are refused; the extra is saved with key names only and is marked "needs secrets" so I enter them in Durbar's own MCP extras screen.

---

### User Story 4 - Durbar's own agents never get this server (Priority: P1)

As a user, I can be sure that an agent running inside Durbar cannot use Durbar's MCP server to raise its own permission mode, trust its own MCP server or lift its own cap.

**Why this priority**: Without it, the feature breaks constitution III (an agent could escape its mode). It blocks **any** release of this feature, read-only Phase 1 included (`## Changes` 2026-10-18, analyze fixes, D-a).

**Independent Test**: Unit tests: the session options of every adapter never contain Durbar's server, also when the user registered it in `~/.copilot/mcp-config.json` under any name; the bridge refuses a connection that carries the agent marker; the extras store refuses an extra that points to Durbar's bridge.

**Acceptance Scenarios**:

1. **Given** the user added Durbar's server to `~/.copilot/mcp-config.json` (any name), **When** Durbar starts a Copilot session, **Then** that entry is in the session's `disabledMcpServers` and the agent's tool list does not contain it.
2. **Given** an MCP extra whose command or URL points to Durbar's bridge or endpoint, **Then** saving it is refused with a short reason.
3. **Given** an agent with shell access runs the bridge command itself, **Then** the bridge refuses because the agent marker is present (best effort, see FR-034 and *Known limits*), and any change it might still request needs my click in Durbar.

### Edge Cases

- Several change requests at once: shown one at a time in arrival order; at most 5 waiting besides the one on screen (Q6); more are refused with `busy`.
- The same request twice (same tool and arguments while one is pending): the second gets the first's request id; no second dialog.
- The window is minimized or on another desktop when a request arrives: the dialog waits; the taskbar/dock is flagged (no sound by default, constitution V calm UI).
- The target changes while the dialog is open (agent removed, folder removed, mode changed in the window): Apply re-validates; if the target is gone or the value already equals the request, the client gets `stale` and nothing changes.
- An agent is live and its adapter cannot change that setting while running: the existing refusal (`NO_LIVE_SETTING`, `agentops.ts:20`) is returned as `failed` with that text, after Apply.
- Two Durbar instances (no single-instance lock today): the second one does not open the server and says so in its Settings.
- The server is switched off while requests are pending: they become `denied`, connections close.
- Paths: Windows drive letters and UNC, macOS case-insensitive, Linux case-sensitive: matched exactly as the folder store matches them today; relative paths, `~` and paths with control characters are refused (the client must send an absolute path).
- A huge or malformed JSON-RPC message, or a burst of calls: refused by the limits of FR-040 without slowing the window.
- Simulator mode (`DURBAR_SIM`): the renderer's simulated agents are not in main; the server lists only main's agents and says so (Q10).
- A floor that is off (spec 033): its agents are still listed, marked `floorOn: false`; the server does not hide them (reading is not the office view).
- Demo/sample mode: no server.

## Requirements *(mandatory)*

### Functional Requirements

**Switch, transport and connection**

- **FR-001**: The Durbar MCP server MUST be **off by default**. The user turns it on (and off) in Settings, in a new *MCP server* section that says what it allows, that every change is confirmed in Durbar, and shows the exact client configuration to copy for Claude Code, Copilot CLI, Claude Desktop and VS Code.
- **FR-002**: The server MUST be reachable **only from this computer and this OS user**: no listening on a network interface other than loopback, no remote access, no port forwarding. Transport per Q1 (recommended: a stdio bridge command that the MCP client launches, talking to the running app over a per-user local socket: a Unix domain socket in a user-only folder on macOS/Linux, a named pipe on Windows; both through Node's `net`, so one code path).
- **FR-003**: Every connection MUST present a per-install secret (random, at least 128 bits) that only the bridge can read (a user-only file in Durbar's user data, never an environment variable of the Durbar process, which agents inherit). Turning the server off and on again, or a *Reset connection key* button, MUST make a new one. The secret is never shown in the UI, logs or MCP output.
- **FR-004**: The server MUST speak the MCP protocol (JSON-RPC 2.0; `initialize`, `tools/list`, `tools/call`) at a protocol revision the four target clients accept (Q2). Implementation per Q3 (an MCP SDK dependency needs owner approval; a small dependency-free JSON-RPC implementation is the alternative).
- **FR-005**: When Durbar is not running, the bridge MUST answer every call with "Durbar is not running" and MUST NOT start Durbar (Q11).
- **FR-006**: Behaviour MUST be the same on Windows, macOS and Linux (constitution VI): socket/pipe names and the secret file location resolved in one place, with `path`, and unit-tested for all three from any OS.

**Read tools (allowed once the server is on, no confirmation)**

- **FR-010**: Read tools MUST include: *list folders* (key, display name, floor, hidden, door, adapter kind, mode, cap, number of agents), *list agents* (id, name, folder key, floor, adapter kind, mode, model, cap, state, `lazy`), *list floors* (spec 033 `FloorsState`), *usage totals* (office and per folder, saved baseline plus this run, `since`), *settings* (default cap, serious mode, place map, custom places), *MCP state* (Copilot CLI list names and on/off, per-folder extras with name, transport, command, args, URL, enabled, trusted, needs-secrets, and **key names only** for env and headers), and *request status* (FR-024).
- **FR-011**: Agent state MUST be the office's own state word plus its sub-label, exactly as the office computes them (`src/renderer/app.js:204-207` and `1581-1620`): the word is one of *Working*, *Thinking*, *Waiting for you*, *Idle*, *Error*, *Done*, *Paused*; the sub-label, when the office shows one, is for example *Ready*, *Not started*, *Ended* or *Limit reached* (so an agent at its credit limit is "Waiting for you" with "Limit reached"). *Paused* is a window-only flag, so the window reports it to main (`## Changes` 2026-10-18, analyze fixes, D-c). Main MUST keep it from the normalized events it already receives; no adapter call, no runtime request and **no AI credits** for any read tool.
- **FR-012**: Read tools MUST NOT return prompts, chat text, thinking, tool arguments or results, attachment content, environment values, header values, secrets, the connection secret, session files or paths outside the saved folders. Paths of saved folders are returned (the client needs them to name a folder).
- **FR-013**: Read tools MUST answer from main's in-memory state and stores within 200 ms for 15 agents and 40 folders, and MUST NOT block the window.

**Change tools (each one confirmed in Durbar's window)**

- **FR-020**: Change tools in v1 MUST be: set an agent's or a folder's **permission mode**; set an agent's **cap** or remove it; set the **default cap**; **add a folder or workspace file** (optional mode Read-only or Ask first, optional cap; it lands on the last floor, FR-054); **remove a folder**; **add, edit, remove, turn off** a per-folder **MCP extra**, and turn on one the user already trusted in the window (D-b); a mode switch only between Read-only and Ask first (FR-050, D-d). Floors, places, serious mode and the Copilot CLI on/off list are read-only over MCP in v1 (Q8).
- **FR-021**: No change MUST be applied by the MCP path alone. Each change request MUST first be validated with the same functions the window uses (`setModeOp`, `setCapOp`, `parseCap`, `validMode`, `validateInput` and reserved names of `src/shared/mcp.ts`, folder path checks); an invalid request is refused at once with the window's error text and no dialog.
- **FR-022**: A valid request MUST open a **confirmation dialog in Durbar's main window**, owned by the main process (the renderer cannot answer for a request id it did not receive from main; main checks the answer comes from the app window). The dialog MUST show: that it comes from an MCP client, the client's self-reported name (labelled as self-reported), the action in plain words, the exact target (agent name and folder path), the current value and the new value; for an MCP extra the full command, arguments, URL and key names; for remove, how many agents and running sessions end. Buttons: **Apply** and **Deny** (Deny is the default and Escape); keyboard focus stays in the dialog (spec 003 dialog rules).
- **FR-023**: On Apply, main MUST re-validate against the current state and then run the **same code path** as the window's own control (the IPC handler bodies, moved into testable functions where they are inline today). The result returned is exactly what that code path returns.
- **FR-024**: Every change tool MUST answer with a request id and one status: `pending`, `applied` (with the new value), `denied`, `expired`, `stale`, `failed` (with the error text), `busy` or `refused` (invalid input). The tool waits up to a short time for the user (Q5) and then returns `pending`; the *request status* tool returns the final status later. Statuses are kept in memory for 15 minutes.
- **FR-025**: **Add folder** over MCP MUST add the folder as a "not started" agent (as `restoreFolders` does) and save it; it MUST NOT start a runtime session. The path MUST be absolute, exist, be a directory or a `.code-workspace` file, and be shown in full in the dialog.
- **FR-026**: **Permission mode** over MCP MUST NOT approve pending requests or keep/forget grants beyond what the window's default does (`approvePending` and `clearGrants` are never set from MCP); a switch to Allow all is refused over MCP (FR-050, FR-060).
- **FR-027**: **MCP extras** over MCP: an added or edited extra is saved **off and untrusted**; trust (the spec 020 acknowledgement) is given only in the window (FR-050), and turning on over MCP is allowed only for an extra whose trust still matches (D-b). Secret values per Q7 (default: refused; key names only, marked needs-secrets). An extra whose command or URL points to Durbar's own bridge, socket or endpoint MUST be refused.
- **FR-028**: Starting a session, sending a prompt, stopping or ending a turn, resolving a permission request, resolving a credit-limit request and resetting usage totals MUST NOT be possible over MCP in v1 (Q4). Tools for them MUST NOT be listed.

**Durbar's own agents never get this server**

- **FR-030**: Durbar MUST NOT add its MCP server to any agent's MCP configuration (`mcpServers`, extras, imports) under any adapter.
- **FR-031**: When building a session's options, Durbar MUST add to `disabledMcpServers` every entry of the ambient Copilot CLI list (`~/.copilot/mcp-config.json`) whose command or arguments run Durbar's bridge (matched by the bridge's executable and its flag, not only by name), and the reserved name of FR-032. The same rule MUST apply to any future adapter that loads ambient MCP config (Codex `~/.codex/config.toml`); Claude sessions rely on `strictMcpConfig: true` (spec 012 FR-025).
- **FR-032**: The suggested server name in FR-001's copy-paste config MUST be a reserved name (for example `agent-durbar`) that the MCP extras store refuses (`reserved` list in `McpStore.upsert`).
- **FR-033**: The connection secret and socket name MUST NOT be placed in any agent's environment, working folder, MCP config or prompt, and MUST NOT be stored inside any saved folder.
- **FR-034**: Durbar MUST set a marker variable in the environment of the agent runtimes it starts (where the adapter allows it, see Q9), and the bridge MUST refuse to connect when that marker is present. This is defence in depth only; FR-022 (a human click in Durbar) is the real gate.
- **FR-035**: The Settings section and the docs MUST say plainly that an agent with shell access in Allow all runs as the same OS user and could in principle reach the socket and read what the read tools return; it still cannot apply a change without the user's click.

**Limits, audit, secrets**

- **FR-040**: Inputs MUST be capped: one JSON-RPC message at most 64 KB; strings at the lengths the window already uses (names 64, model 100, floor id 20) and paths at 4096 characters; at most 10 calls per second **per connection** and 3 authenticated connections; at most 5 change requests waiting besides the one on screen (Q6). Over a limit: refused with a short error, the window is not slowed.
- **FR-041**: Every connection, tool call and change outcome MUST be recorded as one audit line: time, client self-reported name, tool, target (agent id, or the folder key hash plus display name, never the full path, FR-055), status. Where: per Q12 (default: an in-memory *Recent MCP activity* list in Settings, last 100 lines; plus `DURBAR_LOG` when that dev hook is set). Lines go through the secret redaction of spec 012 T051 (`src/shared/redact.ts`, on `main`).
- **FR-042**: Nothing in this feature MUST read, store, log or return tokens, environment values, header values, MCP extra secrets or the connection secret (constitution III).
- **FR-043**: No read or change tool MUST spend AI credits or start a runtime session (constitution IV). Model lists, if exposed later, use the cached list only.
- **FR-044**: Text in the Settings section and the dialog MUST be at least 10.5 px; the dialog MUST fit at 1440x900 and 1280x800 with a 4096-character path and a long command (wrapped, not clipped, full text reachable).
- **FR-045**: The whole feature MUST be testable with `npm test` and a fake client, with zero AI credits; dialogs checked with a `DURBAR_DRIVER` script.

### Key Entities

- **MCP server setting**: on/off, connection secret (file, never shown), reserved server name.
- **Connection**: a client session through the bridge; self-reported client name and version (untrusted), open time.
- **Change request**: id, tool, validated arguments, target, current and new value, status (`pending` .. `refused`), created and decided times.
- **Audit line**: time, client name, tool, target label, status; redacted, no secrets.
- Existing entities reused unchanged: Folder (spec 006/033), Agent (`AgentInfo`), Floor, MCP extra (spec 020), Settings (spec 011/024/034).

## Success Criteria *(mandatory)*

- **SC-001**: With the server on, a user can ask their MCP client "which agents are waiting?" and get the right answer in under 2 seconds with 15 agents, with zero AI credits spent by Durbar.
- **SC-002**: 100% of change requests in the automated tests reach the store only after an Apply in the dialog model; none is applied by a denied, expired, stale or invalid request.
- **SC-003**: In tests, no session options built by any adapter contain Durbar's server, for every way of registering it the tests cover (reserved name, other name, ambient file, extra).
- **SC-004**: A planted secret (env value, header value, extra secret, connection secret) never appears in any tool result or audit line (tests with planted values).
- **SC-005**: With the server off, no socket/pipe exists and no port is open (unit test of the lifecycle; manual check per OS recorded honestly).
- **SC-006**: The dialog and the Settings section have no overlap, clipping or text under 10.5 px at 1440x900 and 1280x800.

## Assumptions

- The client's self-reported name is shown but never trusted for anything.
- The user's MCP client is the user's own tool running as the same OS user; protecting against other processes of the same user is out of scope beyond FR-034/FR-035, as it is for Durbar's existing files.
- Usage totals for this run are computed in main for the read tool from the same events the window uses; the window's own computation is unchanged.
- The four named clients support stdio servers; Claude Code, Copilot CLI and VS Code also support HTTP. Not verified on each client: recorded as `read:` until checked.
- No real Copilot, Claude or Codex session is needed to build or test this feature.

## Open questions for the owner (each with a recommended default)

1. **Q1 Transport.** (a) stdio bridge launched by the client (Durbar executable with a flag, or a small script) + per-user socket/named pipe + secret file; works with all four clients including Claude Desktop; no port. (b) Loopback streamable HTTP on `127.0.0.1` with a random port and a bearer token; no bridge, but the token ends up in the client's config file (for Copilot CLI, `~/.copilot/mcp-config.json`, which Durbar's Copilot agents load), and a port is reachable by every local process and by browsers (DNS-rebinding and Origin checks needed). (c) Both. **Recommended: (a)**, (b) later if a client needs it.
2. **Q2 Bridge executable.** (a) The Durbar app itself with a flag (for example `agent-durbar --mcp`): no extra install, but starts an Electron process per client (heavier, and needs a careful no-window path); (b) a small JS file shipped in the app's resources run with the user's `node` (light, but needs Node on PATH); (c) `ELECTRON_RUN_AS_NODE=1` with the app binary (light, no Node needed; relies on that Electron fuse staying enabled). **Recommended: (a)** for v1, measure startup; consider (c) in the plan.
3. **Q3 MCP implementation.** (a) Add `@modelcontextprotocol/sdk` (needs owner approval, brings transitive dependencies); (b) a dependency-free implementation of the small subset needed (`initialize`, `tools/list`, `tools/call`, `ping`, stdio framing) with tests against recorded client handshakes. **Recommended: (b)**, the subset is small and the constitution asks for dependency-light.
4. **Q4 Starting sessions and sending prompts.** In v1? These spend AI credits and are the agents' own channel. **Recommended: out of v1** (FR-028); a later spec could add "send a prompt" with the same confirmation dialog and a credit warning.
5. **Q5 Waiting for the user.** How long does a change tool wait before returning `pending`, and when does a request expire? **Recommended: wait 30 s, expire after 10 min.** (Clients have their own tool-call timeouts; MCP "elicitation" is not used, because the confirmation must be in Durbar, not in the client.)
6. **Q6 Queue size.** **Recommended: one dialog at a time, at most 5 waiting besides the one on screen, extra ones `busy`.**
7. **Q7 Secret values for MCP extras over MCP.** (a) Refuse: key names only, user types values in Durbar (secrets never pass through the client's model context). (b) Accept and encrypt as the window does. **Recommended: (a).**
8. **Q8 Floors, places, serious mode, Copilot CLI on/off list.** Read-only over MCP in v1, or also changeable (with the same dialog)? **Recommended: read-only in v1**, a small follow-up adds them.
9. **Q9 Agent marker (FR-034).** Can Durbar set an environment variable in the runtime it starts? Copilot SDK: the client takes an `env` option that **replaces** the inherited environment (`read:` `@github/copilot-sdk` `dist/types.d.ts`, `CopilotClientOptions.env`), so the adapter passes `{ ...process.env, AGENT_DURBAR_RUNTIME: '1' }`; Codex: `codexRpc` passes `env` (`src/adapters/codexRpc.ts:76`, `223`); Claude: no adapter yet, `[KNOWN GAP]`. Only in each runtime's environment (FR-057). **Recommended:** keep FR-034 as best effort, mark `[KNOWN GAP]` for an adapter that cannot, and rely on FR-022.
10. **Q10 Simulator.** Simulated agents live in the renderer, so the server sees none. (a) Test with `FakeAdapter` in main (unit tests) and add a small main-side sim feed (`DURBAR_SIM_MAIN`, already planned in spec 012); (b) let the renderer mirror its simulated agents to main in sim mode only. **Recommended: (a).**
11. **Q11 Durbar not running.** Should the bridge start Durbar? **Recommended: no** (FR-005): starting the app from a background client is surprising and restores sessions.
12. **Q12 Audit log place.** Packaged builds have no debug log today. **Recommended:** in-memory *Recent MCP activity* in Settings (last 100, cleared on quit) plus `DURBAR_LOG` when set; no new file on disk.

## Known limits (honest, to keep in the README when built)

- `[KNOWN GAP]` Same-user isolation: an agent in Allow all (or with an approved shell command) runs as the user and can reach any file or socket the user can; FR-034 is best effort; changes still need a click in Durbar (FR-022).
- Depended on PR #157 (`redact.ts`) for FR-041 and FR-053, and on PR #160 (`strictMcpConfig`) for the Claude half of FR-031; both are merged on `main` (2026-10-18).
- `[KNOWN GAP]` Nothing verified on a real client, on Windows or on macOS; client compatibility claims are `read:` until a recorded check.
- `[KNOWN GAP]` Peer-process refusal (FR-056) is not built: Node `net` gives no peer credentials, so it needs a native helper (task T060, needs the owner's approval). Until then the FR-034 marker, which an agent can unset, is the only automatic refusal.
- `[KNOWN GAP]` Claude: no Claude adapter is registered yet, so FR-034's marker is not set for Claude runtimes; it is added with that adapter (task T063).
- `[KNOWN GAP]` Codex ambient MCP config (`~/.codex/config.toml`): FR-031's filtering is not built until the Codex adapter is registered (task T062).

## Changes

- **2026-10-19, T014 built (issue #204; unit tests, no visible change).** `src/main/mcp/agentstate.ts`: a pure `AgentStateTracker`, fed by `router.onEvent` in `main.ts`, gives each agent the office's own word and sub-label (FR-011, D-c), copied rule by rule from `src/renderer/app.js` (46 table rows; the header lists the source line of each rule). `toolCall start` only turns Thinking into Working; a send from the window gives Thinking (`noteSend`, called in `agents:send`) and a refused send gives Error (`noteSendFailed`), as the window does. Paused is window-only: the window reports it through a one-way IPC `agents:setPaused` (unknown ids and non-booleans ignored), and main clears every paused flag when the window reloads (`did-finish-load`). A drift guard fails if a copied renderer fragment, or one of the `main.ts` calls, disappears. `[KNOWN GAP]` (T042, converge): sub-agent tool calls are detected only by the `task`/`agent` tool names; the renderer's Stop-time question and limit cleanup is copied only for its state effect; demo-only renderer paths are not copied; the drift guard compares source text, not behaviour, until the renderer rules move into a shared module. Test: `scripts/test-mcp-agentstate.ts`.

- **2026-10-18, T011 built (issue #180; pure code and unit tests, nothing listens yet).** `src/main/mcp/auth.ts`, test: `scripts/test-mcp-auth.ts`.
  - **Key file:** JSON `{version:1, key: 256-bit hex, pipeId}`, written atomically (temp file created `wx` with mode 0600, then rename; folder 0700). Rotation changes the key and the pipe id. A read refuses a symlink, a wrong type, another owner, group or other bits on the file, or a folder with group or other bits, with results `missing`, `unsafe` or `invalid`. After the security review: the file is read through one descriptor opened with `O_NOFOLLOW|O_NONBLOCK` and checked with `fstat` (type, owner, mode, size before reading), so a symlink or FIFO swapped in after the check is refused without blocking; the write path checks the folder the same way; an unknown uid on POSIX fails closed.
  - **Handshake:** a mutual HMAC-SHA256 challenge-response with 32-byte nonces, a role label and a different nonce order per direction (so a reply cannot be reflected), compared with `crypto.timingSafeEqual` after a length check. The bridge MAC also covers the protocol version and the bridge's `marker` and `parent` fields (transcript binding, length-prefixed), so a relay cannot change them. The handshake authenticates the two ends, not each later message: there is no per-message MAC, which is acceptable because a same-user attacker can already read the key file (FR-035) and other users cannot join Durbar's pipe or socket. Equal nonces are refused; the 2 s timeout uses injected timers; a failure sends no reply; errors have fixed texts and never carry key material.
  - **After Paco's review of #184:** the server also refuses a bridge that reports `marker: true` (defence in depth; FR-034 keeps the bridge's own refusal), and the bridge reports the real peer it sent; leftover `connection.json.*.tmp` files are removed on delete and before create, so "server off deletes the key" holds after a crash; `parent` is cleaned like `clientInfo` (control, bidi and zero-width characters and lone surrogates stripped, capped at 64 code points).
  - `[KNOWN GAP]` (T051, which checks it on a real Windows install): on Windows Node exposes no usable owner or mode bits, so the key file's privacy rests on the inherited ACL of `userData`; only link and type are checked there, and without `O_NOFOLLOW` an `lstat`-to-open window remains; T051 also refuses a reparse point or junction in `userData\\mcp`.

- **2026-10-18, T010 built (issue #175; pure code and unit tests, nothing listens yet).** `src/shared/mcpserver.ts` (reserved name, bridge flag, marker, limits, statuses, file names) and `src/main/mcp/paths.ts` (`mcpPaths`, `checkFallbackDir`), test: `scripts/test-mcp-paths.ts`. Decided by the coordinator where the plan was open: the 103-byte Unix socket limit and its per-user tmp fallback apply on Linux too, counted in UTF-8 bytes; `DURBAR_USER_DATA` wins over `XDG_RUNTIME_DIR`, so tests never touch the real runtime dir; an unset, empty or relative `XDG_RUNTIME_DIR` falls back to `<userData>/mcp`; the Windows pipe id must match `[A-Za-z0-9]{8,128}`; when no safe path exists, `socket` is `null` with a reason (never an unsafe path). After review: an `XDG_RUNTIME_DIR` that normalising changes (`..`) is refused, and any socket folder outside `userData` (XDG or the tmp fallback) is marked for the caller's `lstat` check (FR-062), so a misconfigured `XDG_RUNTIME_DIR=/tmp` is checked too; a relative or empty `userData`/`DURBAR_USER_DATA` gives no socket and no key file; a too-long XDG path tries `<userData>/mcp` before the tmp fallback; platforms other than `win32` and `darwin` are treated like Linux. After Paco's review of #178: `mcpPaths` no longer reads `DURBAR_USER_DATA` (the caller applies it to `userData` through the dev hooks, which packaged builds ignore, spec 010) and takes `xdgRuntimeDir` as its own input; `<userData>/mcp` is also marked for the `lstat` check on Unix; a `userData` that normalising changes or that contains NUL gives no socket. `[KNOWN GAP]` (T051): a UNC `userData` (folder redirection) would put the key file on a network share. Note for T017: on Windows the pipe name can be listed and opened by others, so a squatted name must give "cannot listen" (no retry under another name), and nothing but the server nonce is sent before the handshake completes.

- **2026-10-18, T012 built (issue #176; pure code and unit tests, no socket).** `src/main/mcp/jsonrpc.ts` (byte-based newline framing, 64 KB cap per message with the stream kept in sync, CRLF and split UTF-8, JSON-RPC 2.0 errors) and `src/main/mcp/protocol.ts` (`McpSession`: `initialize`, `notifications/initialized`, `ping`, unknown methods `-32601`, a `methods` hook for T013); test: `scripts/test-mcp-protocol.ts`, with a fake client and four **synthetic** handshake fixtures (real clients stay `read:` until T061). Decided by the coordinator: supported protocol versions `2025-06-18`, `2025-03-26`, `2024-11-05` (newest first; an unsupported request gets the newest); a second `initialize` and JSON batches are refused with `-32600`; an oversize message gets `-32600` with `id: null` and is never echoed; `clientInfo` is kept as self-reported, with control, bidi and zero-width (`\p{Cf}`) characters and lone surrogates stripped, capped at 64 code points (after review, to stop name spoofing); a handler that returns nothing answers `{}`; a message of exactly the cap is accepted however its CRLF is split across chunks; after Paco's review of #179: async handlers are awaited and a rejection becomes `-32603`; every framed line, valid or not, counts toward the per-connection rate limit before parsing, lines over the limit get no reply (no amplification), sustained overflow closes the connection, and replies respect write backpressure; `notifications/initialized` counts only after a successful `initialize`; `McpConnection` (`src/main/mcp/connection.ts`) wraps framer, session and writer: replies leave in request order; a full writer pauses replies and drops new lines as overflow, so a peer that does not read its replies is closed after 100 dropped lines or 3 s of drops; T017 must call `drain()` on the socket's drain event; `tools/*` before `initialize` will be refused (T013 adds the gate).

- **2026-10-18, analyze fixes (T004; decided by the coordinator under Ruben's delegation).** `/speckit-analyze` on spec, plan and tasks said "fix first". Decisions:
  - **D-a** Keeping the server away from Durbar's agents (US4: FR-030 to FR-035, FR-057; tasks T040 and T041) blocks **any** release of this feature, the read-only Phase 1 included. Merging behind the off-by-default switch is fine; shipping it in a release is not, until those tasks are merged.
  - **D-b** Turning **on** an MCP extra that the user already trusted in the window (its trust hash still matches) is allowed over MCP with the dialog. Trusting a new or changed extra stays window-only (FR-050).
  - **D-c** Agent state over MCP is the office's own state word plus its sub-label, following `src/renderer/app.js:204-207` and `1581-1620` exactly, *Paused* included (FR-011 rewritten in place).
  - **D-d** A mode change between Read-only and Ask first, in either direction, is allowed with the dialog, because Ask first still asks before every action. Only a switch to Allow all is refused (FR-050 reworded in place; it no longer says "lowering").
  - **FR-059** After an Apply, main MUST push the change to the window the same moment it is made, so the office never shows an old value: the new mode or cap of each agent touched, the new default cap, a refresh of the folder's MCP extras, a removed folder with the ids of its removed agents, and a lazy agent added (`agent:added`, as `addWorkspace` does). A change the window made itself is unchanged.
  - **FR-060** Change tools MUST check a requested mode against the exact values `read-only` and `ask` **before** calling the window's code (the window's `validMode` turns any unknown value into Read-only). Anything else is `refused` with no dialog. Texts: for `allow`: "Allow all can only be turned on in Durbar's own window."; for anything else: "Unknown mode. Use read-only or ask."
  - **FR-061** (extends FR-058) The handshake MUST finish within about 2 s or the connection is closed; only authenticated connections count toward the 3-connection cap (FR-040); nonces are 32 random bytes; MACs are compared with `crypto.timingSafeEqual`. The pipe or socket name is **not** a protection: the key and the HMAC are. Nothing is sent to the peer before it has authenticated, beyond the server's nonce.
  - **FR-062** When the socket has to live in a temporary folder (path too long for a Unix socket), Durbar MUST check that folder with `lstat` before use: owned by the current user, mode 0700, not a symbolic link; otherwise it does not listen and Settings says why.
  - **FR-063** The client configurations shown in Settings (FR-001) MUST name the executable a client can launch later: the AppImage file (`APPIMAGE`) on Linux and the portable executable (`PORTABLE_EXECUTABLE_FILE`) on Windows when Durbar runs that way, otherwise the app's own executable path.
  - **FR-064** Change tools MUST NOT be listed or dispatched in a build that does not have the confirmation dialog (tasks: they are switched on in T038, after the dialog tasks T036 and T037).
  - **Wording**: the rate limit is 10 calls per second **per connection**; the queue holds **at most 5 waiting besides the one on screen** (FR-040, Q6, *Edge Cases* updated in place).
  - **Edge cases also covered by tasks**: demo/sample mode starts no server (T017, T020); the read result says when `DURBAR_SIM` agents are not visible (T016); folder targets are matched per OS as the folder store does (T030).
  - **Fixed in place** (superseded text): *Status*; *Context* on usage totals (`view()`), #157 and #160; US4's release note (D-a); FR-011 (D-c); FR-040 and FR-041 (no "depends on PR", no "detail" option); FR-050 (D-b, D-d); US2-4, US3 intro and US3-1, US3-3, FR-020, FR-026 and FR-027 (FR-050, FR-054, D-b, D-d); FR-056 ("reported by the bridge"); Q6 and Q9 (the Copilot SDK `env` replaces the environment, so the adapter passes `{ ...process.env, AGENT_DURBAR_RUNTIME: '1' }`); three gaps added to *Known limits* (T060 peer check, the Claude marker T063, Codex ambient config T062).

- **2026-10-18, consistency pass after the plan draft (decided by the coordinator under Ruben's delegation).** The plan found places where older text contradicts the review rules (FR-050 to FR-056). The newer rule wins:
  1. US2-4 and FR-026 (switching to Allow all with a warning), and US3-3 and FR-027 (a "Trust and turn on" tick in the dialog), are superseded by **FR-050**: both are refused over MCP in v1 and done in the window.
  2. FR-020 and US3-1 (picking a floor when adding a folder) are superseded by **FR-054**: a folder added over MCP lands on the last floor, as in the window.
  3. FR-041's "full path if detail is on" is superseded by **FR-055**: audit lines never hold the full path.
  4. US1-1's "off, turn it on" message: when the server is off, Durbar deletes the key file and closes the socket, so the bridge can tell **off** (no key file) from **not running** (a key file but no answer) and say which (SC-005 holds: nothing listens while off).
  5. Context: main already has the current usage total (`UsageTotalsStore.view()`, `src/main/usagetotalsstore.ts`), and #157 (redaction) and #160 (`strictMcpConfig`) are merged. `main.ts` line numbers cited in *Context* are from the first draft and may have moved; the plan cites current ones.
  6. FR-004 refers to Q3 (the MCP implementation), not Q2.
  7. FR-056: the parent process name is **reported by the bridge**, not by the OS, because the bridge reads it and an attacker can control the bridge. The dialog labels it that way.
  - **FR-057** The agent marker of FR-034 is set **only in each agent runtime's environment** (for Copilot through the SDK client's `env` option), never in Durbar's own process environment, so tools the user opens from Durbar (for example VS Code) do not inherit it and the user's own MCP client there is not refused.
  - **FR-058** The bridge and the server authenticate each other with the per-install key by an HMAC challenge, so the key itself never crosses the socket or pipe (a squatted Windows pipe learns nothing).

- **2026-10-18, review of #161 by Paco (decided by the coordinator under Ruben's delegation).** The confirmation click is the only real gate: the client name is self-reported, and an agent running as the same user, or the user's own assistant after a prompt injection, can ask for anything. So v1 keeps the two privilege jumps in the window only, and makes the dialog hard to approve by accident.
  - **FR-050** v1 MUST refuse over MCP (status `refused`, reason given): switching a mode **up to Allow all**, and **"Trust and turn on"** for an MCP extra. A change between Read-only and Ask first, in either direction, stays allowed with the dialog (Ask first still asks before every action); turning on an extra the user **already trusted** in the window, and saving an extra off and untrusted, stay allowed with the dialog. The user switches to Allow all, or trusts a new or changed extra, in Durbar's own window (wording per `## Changes` 2026-10-18, analyze fixes, D-b and D-d). This narrows FR-020, FR-026 and FR-027 accordingly.
  - **FR-051** Dialog fatigue:
    - one dialog at a time, showing how many requests are waiting;
    - a **Deny all from this client** button;
    - a request that was denied is refused for 60 s when the same connection sends it again (same tool, same target, same arguments).
  - **FR-052** A stray click or Enter must not approve. **Apply** is inactive for about 1 s after the dialog appears and is never focused by default (Deny is). The dialog never takes focus from a text field the user is typing in without showing it clearly first.
  - **FR-053** Read tools and the dialog MUST NOT show secrets carried in MCP extra **arguments or URLs**: `command`, `args` and `url` go through `redact()` (spec 012 T051), and the value after a flag whose name looks secret (`--token`, `--key`, `--secret`, `--password`, `--auth`, `--api-key`, also in `--flag=value` form) is masked. Env and header values stay excluded (FR-012).
  - **FR-054** *List agents* and *list folders* include `floorOn` (spec 033), so a client sees which agents the office hides. A folder added over MCP lands where the window would put it (the last floor), since floors are read-only over MCP in v1 (Q8).
  - **FR-055** Audit lines (FR-041) name a folder by the folder key hash used by usage totals (spec 011), plus the display name, never the full path.
  - **FR-056** The dialog shows **how** the request connected: the bridge's parent process name, when the OS gives it cheaply, labelled as reported by the bridge (see the consistency pass, item 7). `[KNOWN GAP]` (planned task): refusing a peer whose process is a descendant of one of Durbar's own runtime processes (Linux `SO_PEERCRED`, macOS `LOCAL_PEERPID`, Windows named-pipe client PID). That is stronger than the env marker of FR-034, which an agent can unset. It is left out of v1 and needs its own task.
  - **Related:** #130 (Global Assistant Chat): Durbar's read tools plus the user's own MCP client already give phase 1 of #130 without a built-in assistant; mobile access stays out (loopback only, FR-002). #131 (profiles): the server, socket and secret would be per profile.
- **2026-10-18**: first draft (analyst, for the coordinator). Not reviewed by the owner.

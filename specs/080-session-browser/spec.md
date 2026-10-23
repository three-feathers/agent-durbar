# Feature Specification: Each session gets its own built-in browser

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Session browser (issue #556): a Browser tab per session with its own in-memory profile, wiped at session end; chat links open there; later the agent drives it through a per-session durbar-browser server (no debugging port), gated per mode; per-folder login opt-in last
status: Draft (2026-10-23): spec, plan, research and tasks; Q1-Q4 decided by the coordinator under Ruben's delegation; nothing built
-->

**Feature Branch**: `080-session-browser` (touches 005 chat panel, 045 window hardening, 003/018 permission broker, 041 Durbar MCP, 072 per-session server pattern, 058/069 MCP lists, 001 office desks, 010 simulator)

**Created**: 2026-10-23

**Status**: Draft. Spec, plan, research and tasks only; nothing is built. Every requirement is `[PLANNED]` unless tagged otherwise.

**Input**: Issue #556 (owner request, Ruben, 2026-10-22): "Each session gets its own built-in browser (no more windows popping up everywhere)." Owner input on the issue: Vikram (2026-10-22: show each agent action live, highlight and log it; in-process driving through `webContents.debugger`, no debugging port; an opt-in to keep logins per folder) and Paco (2026-10-22: spec 041 FR-030 rules out Durbar's own server, so use a per-session `durbar-browser` server, the 072 `durbar-loop` pattern). Coordinator defaults under Ruben's delegation (2026-10-23) are listed in *Clarifications*.

## Context: what exists today

- **Chat links open in the system browser.** A click on a link in a chat reply calls `bridge.openExternal`, and main opens only `http(s)` URLs with `shell.openExternal` (`read:` `src/renderer/app.js:2245-2250`, `src/main/ipc/app.ts:22-26`).
- **The chat panel has no tabs.** It shows a header, *Previous sessions*, the chat log, the answer bar and the composer (`read:` `src/renderer/app.js:1866-1895`). Docking and resizing are issue #452, not built.
- **The app window is hardened** (spec 045 FR-004, FR-005):
  - no popups;
  - it shows only the app's own page;
  - web permissions are refused except clipboard writes and notifications;
  - privileged IPC is answered only for the app's main frame (`read:` `src/main/main.ts:774-785`, `src/main/hardening.ts`).
- **Packaged builds never open a debugging endpoint.** The fuses are flipped and the `--remote-debugging-*` switches removed (spec 008 FR-037, FR-038, `real:` packed Linux).
- **Durbar already hands each session its own MCP server list** for all three agent apps (`StartOptions.mcpServers`; research R4). Durbar's own control server (spec 041) is never given to its agents (041 FR-030). A per-session server with a token kept in a 0600 file is the pattern spec 072 set for `durbar-loop` (072 FR-030, FR-031; not built yet).
- **What an agent does today when it browses:**
  - its Playwright or Chrome DevTools MCP server launches its own browser window;
  - a shell `open` / `xdg-open` / `start` opens the system browser;
  - nothing ties that window to the session.

Research: [research.md](research.md) (CDP feasibility, R3; harness injection, R4; design comparison, R5).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A Browser tab in each session's chat (Priority: P1) MVP

I open a session's chat and switch to its **Browser** tab. I type an address (for example my dev server at `http://localhost:3000`) and use the page there, next to the chat. Each session has its own tab with its own cookies. When the session ends, its browser and everything it stored are gone.

**Why this priority**: it is the base every other story needs, and it already gives one place per session with no new windows.

**Independent Test**: on the simulator, open two chats, load the bundled test page in each, set a cookie in one and check the other does not see it; end one session and check its view and storage are gone. Zero credits.

**Acceptance Scenarios**:

1. **Given** a session's chat is open, **When** I choose *Browser*, **Then** the chat panel shows an address bar, Back, Forward, Reload and a page area, and the office still fits (FR-090).
2. **Given** sessions A and B, **When** A's page sets a cookie or local storage value, **Then** B's page never sees it (FR-020). *(test:, sim:)*
3. **Given** a Browser tab with a page open, **When** I end the session, **Then** its view is destroyed, its storage is cleared and no process of it is left (FR-023). *(sim:)*
4. **Given** a Browser tab, **When** a Durbar menu or dialog opens over it, **Then** the menu is fully visible and usable, not hidden behind the page (FR-008). *(sim:)*
5. **Given** I type `file:///etc/passwd` or `chrome://settings`, **Then** the page does not load and the bar says why (FR-024). *(test:)*

---

### User Story 2 - Links the agent prints open in its session's browser (Priority: P1) MVP

The agent writes "the dev server is up at http://localhost:5173" or prints a sign-in link. I click it and it opens in **this session's** Browser tab, not in a random window. An *Open in system browser* choice is always one click away.

**Why this priority**: it removes most of the window clutter with no agent control at all, so it carries no new agent risk.

**Independent Test**: a simulated agent prints a link to the bundled test page; a click opens it in that session's Browser tab; *Open in system browser* goes through the existing `app:openExternal` path. Zero credits.

**Acceptance Scenarios**:

1. **Given** a chat reply with an `http(s)` link, **When** I click it, **Then** the session's Browser tab opens with that page, and the chat stays as it was (FR-030).
2. **Given** the same link, **When** I use its *Open in system browser* menu item (or the modifier click, FR-031), **Then** it opens in the system browser exactly as it does today. *(test:)*
3. **Given** a link in session A, **When** I click it, **Then** it never opens in session B's browser. *(test:)*

---

### User Story 3 - The agent drives its own session's browser (Priority: P2)

I turn on **Let the agent use this browser** for a session. The agent gets browser tools (navigate, read the page, click, type, screenshot). It works only in this session's Browser tab, which I can watch live. Each action is outlined on the page and logged in the chat. The permission mode applies: Read-only never lets it drive, Ask first asks, Allow all lets it work. Form posts and downloads are never silent.

**Why this priority**: this is what stops agents launching their own browser windows. It needs the per-session server (FR-040..FR-049) and careful gating, so it comes after the MVP.

**Independent Test**:

- a scripted fake agent calls the tools against the bundled test page on the simulator and the main-process simulator;
- unit tests cover token-to-session binding, mode gating, the POST and download checks, and the masking of logged arguments.

Zero credits. A real check per agent app is a separate task with the owner's OK (T060).

**Acceptance Scenarios**:

1. **Given** the switch is off (the default), **Then** the session's agent has no browser tools and Durbar adds no server to it (FR-041). *(test:)*
2. **Given** the switch is on, **When** the agent calls `browser_navigate` in session A, **Then** only A's view navigates; no call can name or reach session B (FR-043, SC-003). *(test:)*
3. **Given** Read-only, **When** the agent calls `browser_navigate`, `browser_click` or `browser_type`, **Then** the call is denied as a URL or state change. `browser_snapshot` and `browser_take_screenshot` of the page already open still work (FR-051; see Q1). *(test:)*
4. **Given** Ask first, **When** the agent calls `browser_navigate` to a new host, **Then** I get a request that names the host. *Allow for this session* grants that host only (FR-052). *(test:)*
5. **Given** any mode, **When** an agent action would send a form as a page navigation (POST) or start a download, **Then** Durbar asks first, except in Allow all where it goes ahead and is listed (FR-070, FR-071). *(test:, sim:)*
6. **Given** the agent clicks a file input, **Then** no file chooser opens and the tool answers that uploads are not allowed (FR-073). *(test:)*

---

### User Story 4 - I can see who is driving and take over (Priority: P2)

The Browser tab always says **Agent is using the browser** or **You are using the browser**. When I click or type in the page, I take over. The agent's next browser call waits a short time and then gets "The user is using the browser". When I press **Hand back**, the agent can go on. This is how I log in myself and let the agent continue.

**Why this priority**: the issue's "show plainly who drives" and "the user can take over" safety points; it ships with US3.

**Independent Test**: simulator driver: a fake agent clicks, then the driver clicks in the view; the indicator changes, the next agent call is refused with the takeover text, *Hand back* restores it.

**Acceptance Scenarios**:

1. **Given** the agent is driving, **Then** the bar shows an icon and the words *Agent is using the browser*, and each action briefly outlines its target on the page (FR-060, FR-062). *(sim:)*
2. **Given** the agent is driving, **When** I click in the page, **Then** the bar changes to *You are using the browser*, and agent calls are refused until I press *Hand back* (FR-061). *(test:, sim:)*
3. **Given** I typed a password while driving, **Then** nothing I typed appears in the chat, the activity log or the debug log (FR-064). *(test:)*

---

### User Story 5 - Keep browser logins for a folder (Priority: P3)

Many sessions in one folder use the same test account. I turn on **Keep browser logins for this folder** and confirm. That folder's sessions then share one saved browser profile, so I sign in once. I can clear it or turn it off at any time. It is never shared with another folder.

**Why this priority**: an owner request (Vikram, 2026-10-22), but the safe default (a clean profile per session) must exist first.

**Independent Test**: unit tests of the partition naming and the confirm flow; simulator: two sessions of one folder share a cookie after opt-in, a session of another folder does not.

**Acceptance Scenarios**:

1. **Given** the opt-in is off (default), **Then** every session's browser starts clean (FR-020).
2. **Given** I turn it on, **Then** a confirmation says that every agent session in this folder can act with these logins, and **No** has the focus (FR-081).
3. **Given** it is on, **Then** the folder shows that it keeps browser logins, and *Clear browser logins* empties the profile at once (FR-082, FR-083).

---

### Edge Cases

- **Fifteen sessions with browsers.** Views are created only when a Browser tab is first used. At most `MAX_LIVE_VIEWS` exist at once; the least recently shown one that is idle and not agent-controlled is unloaded: its page is dropped, and it reloads its address when shown again (FR-011).
- **A view and the chat panel at the same time.** In full-screen chat (spec 005) the Browser tab is a tab too; a side-by-side split waits for #452 (Q4).
- **Durbar overlays.** Menus, dialogs, toasts and the slash list are drawn by the app's page, which a native view covers. While one overlaps the view, the view is hidden and a still picture of it is shown (FR-008).
- **Popups and `target=_blank`.**
  - A link that opens a new window loads in the same view.
  - A script popup (`window.open` with features, the usual OAuth pattern) is refused, with an *Open in system browser* offer (FR-026).
  - `[KNOWN GAP]`: popup-based sign-ins do not work in the session browser.
- **Non-web schemes** (`mailto:`, `vscode:`, `slack:`): never opened by themselves. The bar offers to hand the link to the system after a click (FR-024).
- **Certificate errors** (a self-signed `https://localhost`): refused, as Electron does by default (`[KNOWN GAP]`: no "proceed anyway").
- **Web permissions** (camera, microphone, location, notifications, clipboard read, USB, serial, HID, MIDI): refused in the view (FR-025). `[KNOWN GAP]`: sites that need them do not work there.
- **DevTools.** The user cannot open DevTools on the view in packaged builds. Opening DevTools would detach Durbar's debugger (`read:` Electron `debugger` `detach` event).
- **The agent calls a tool while the session is not showing its Browser tab.** It works: the view is offscreen or hidden, not destroyed. The tab gets a small *in use* marker. The panel never switches to it by itself unless *Show the browser when the agent uses it* is on (FR-063).
- **The page crashes or hangs.** The tool answers with an error; the bar offers *Reload*. A crashed view never takes Durbar down.
- **The agent prints a URL through a shell `open`.** Durbar cannot catch it (`[KNOWN GAP]`, FR-032).
- **The session restarts** (model switch, *Restart with these servers*). The view, its partition and its page stay. Only the server's token is made again (FR-044).
- **Sub-agents** share their parent session's browser.

## Requirements *(mandatory)*

### Browser tab and view (US1)

- **FR-001** Each top-level session MAY have one **session browser**: one Electron `WebContentsView` owned by main and shown in that session's chat panel. It is not a separate window.
- **FR-002** The chat panel gets two tabs, **Chat** and **Browser** (`role="tablist"`, keyboard reachable, names read by screen readers). Chat stays the default. The Browser tab shows:
  - Back, Forward and Reload (and Stop while loading);
  - an address field;
  - the driving indicator (FR-060);
  - *Open in system browser*;
  - the page area;
  - a downloads list when there are downloads (FR-072).
- **FR-003** The page area is a native view. The renderer sends main only its bounds and visibility, through typed IPC that main validates: the sender is the app's main frame, and the session id is looked up in main. The renderer never gets the view's page content.
- **FR-004** The view is created on first use of the Browser tab (a click, a link, FR-030, or an agent call, FR-042), never at session start.
- **FR-005** The address field accepts `http:` and `https:` URLs. A bare host or `localhost:3000` is read as `http://` for loopback hosts and `https://` otherwise. Other text is refused with a short reason; no search engine is used (no third party).
- **FR-006** Text in the tab bar and the browser bar is at least 10.5px. State (loading, driving, error) is shown by icon and word, never colour alone. Motion stops under `prefers-reduced-motion`.
- **FR-007** The Browser tab never takes focus or opens by itself, except as FR-030 and FR-063 say.
- **FR-008** **Overlays win.** Whenever a Durbar overlay (menu, dialog, toast, slash list, tooltip) would cover any part of the page area, main hides the view and the renderer shows a still picture of the last frame in its place. The picture is taken by main (`capturePage`), kept in memory only, and dropped when the overlay closes. When the overlay closes, the view is shown again.
- **FR-009** The view follows the panel: resizing, full-screen chat (spec 005) and, later, docking (#452) move its bounds. Closing the chat panel or switching to the Chat tab hides it without unloading the page.
- **FR-010** The view never gets Durbar's preload, Node, the `DurbarApi` bridge or any IPC. Its `webPreferences` are `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webviewTag: false`, `devTools: false` in packaged builds, and its own `partition` (FR-020).
- **FR-011** At most `MAX_LIVE_VIEWS` (plan: 4) views keep a loaded page at once. When a new one is needed, the least recently shown view that is idle and not agent-controlled is unloaded: its page is dropped, its address and partition kept, and it reloads when shown again. The bar says *Reloaded to save memory*. A view the agent is driving is never unloaded.

### Isolation, lifetime and web hardening (US1)

- **FR-020** **One profile per session by default.** Each session browser uses an **in-memory** partition with a random name (`durbar-browser-<128-bit random hex>`), never the `persist:` prefix and never reused. Session A's cookies, storage, cache and logins are never visible to session B (SC-002).
- **FR-021** The partition is never the app window's session, never the default session, and never another session's.
- **FR-022** No page content, cookie, password, form value, screenshot or snapshot of the view is written to disk or to any log by Durbar. The agent receives snapshots and screenshots as tool results (FR-045); that is their purpose. What the agent app stores in its own session files is that app's business (as for every tool result today).
- **FR-023** **Wiped when the session ends.** On *End session*, *Remove session*, folder removal and app quit, main:
  - detaches the debugger;
  - closes the view's `webContents`;
  - calls `clearStorageData()` and `clearCache()` on its partition;
  - drops the partition reference;
  - cancels any download still running (its partial file is deleted).

  No renderer process of it is left (SC-004).
- **FR-024** **Navigation guard.** The view loads only `http:`, `https:` and `about:blank` (and, under `DURBAR_SIM` only, the simulator's test scheme, FR-091). Main refuses everything else on `will-navigate`, `will-redirect` and `will-frame-navigate`: `file:`, `chrome:`, `devtools:`, `data:` and `javascript:` at top level, and custom schemes. A non-web scheme a page or link asks for is shown as *This link wants to open another app* with an *Open* button that goes through `shell.openExternal` after the click. It is never opened automatically.
- **FR-025** **Web permissions refused.** The partition's `setPermissionRequestHandler` and `setPermissionCheckHandler` refuse every permission. Fullscreen is the only exception: it stays inside the view's bounds.
- **FR-026** **New windows.** `setWindowOpenHandler` denies every new window. A plain link with `target=_blank` loads in the same view. A scripted popup is refused, and the bar offers *Open in system browser* for its URL.
- **FR-027** Certificate errors are refused (Electron's default). Nothing allows them per site in v1.
- **FR-028** The view's user agent is Electron's default with no Durbar token, account or path in it.
- **FR-029** Remote debugging stays closed. Nothing in this spec adds a `--remote-debugging-port` or `--remote-debugging-pipe` switch, opens a DevTools HTTP endpoint, or changes a fuse. Spec 008 FR-037..FR-039 still hold, and `check:fuses-launch` stays as it is. Agent control (FR-040) goes only through Durbar's own per-session channel.

### Links open in the session's browser (US2)

- **FR-030** A click on an `http(s)` link in a session's chat (the `.md a` links) opens the link in **that session's** Browser tab: it switches the panel to Browser and loads the URL. The URL check is the existing `isHttpUrl` in main. The click never opens a link in another session's browser.
- **FR-031** Each chat link offers **Open in system browser**: a context-menu item, and Ctrl/Cmd+click. It goes through the existing `app:openExternal` path, unchanged. A Settings choice *Open chat links in: Session browser / System browser* (default: Session browser) switches the plain click.
- **FR-032** `[KNOWN GAP]` URLs the agent opens through a shell command (`open`, `xdg-open`, `start`) or its own MCP browser server still open outside Durbar. FR-101 records a later idea for that.
- **FR-033** Durbar's own sign-in pages (spec 058 FR-065 MCP sign-in, spec 051 harness setup) keep opening in the system browser. The user's password manager and passkeys live there, and those flows' loopback callbacks do not depend on which browser is used.

### Agent control: the `durbar-browser` server (US3)

- **FR-040** A **browser server** with the reserved name `durbar-browser` gives a session's agent the tools of FR-045, and nothing else. It is not spec 041's server: it has its own helper flag, its own socket or pipe name, and no 041 switch (041 FR-030 still holds for 041's server; a spec delta in 041 records this, T001). Transport:
  - the agent app starts Durbar's own executable with a fixed flag and fixed arguments as a stdio MCP server;
  - that helper relays to main over a per-user local socket (a named pipe on Windows) from `src/main/mcp/paths.ts`;
  - there is no TCP port, no shell and no user-controlled text on the command line.
- **FR-041** **Off by default, per session.** The Browser tab has a switch **Let the agent use this browser** (default off). Durbar adds `durbar-browser` to a session's `mcpServers` only while it is on. Turning it on or off for a live session restarts that session when it is idle, as spec 058's *Restart session with these servers* does, and is refused while a turn runs (072 Q7 (a)). A folder setting *Agents in this folder can use their session browser* makes new sessions start with it on.
- **FR-042** The first agent call creates the view if it does not exist (FR-004), loads `about:blank`, and attaches `webContents.debugger` after that load. A debugger command before the first navigation never answers (`sim:` `docs/agent-notes.md:102`).
- **FR-043** **One session only.**
  - Each session with the server gets its own random 256-bit token, kept in main's memory.
  - The token is never put in the server spec's `env` or `args`. Main writes it to a per-session file with mode 0600, in a per-run folder with mode 0700 under Durbar's user-data folder. Only the file's path goes in `args`, and the helper reads the token at start. On Windows this is the same per-user ACL inheritance as 072 FR-031 (`[KNOWN GAP]` there).
  - Main maps token to session. A tool call can only reach the view of the session its token belongs to. Tool arguments never name a session.
  - The token and its file are dropped when the switch is turned off or the session ends, and the folder is emptied at launch.
  - The token is never logged or shown.
  - A test checks, for all three agent apps, that the token is not in the built `mcpServers`, the Claude `--mcp-config` content or argv, or Codex's `thread/start` config.
- **FR-044** A session restart keeps the view and its partition and makes a new token. The old token stops working at once.
- **FR-045** **Tools.** The names follow Playwright MCP's (research R2), so models know their shape. All input is validated in main (types, lengths, ranges). Every action has a timeout, and results are capped in size.

  | Tool | Input | What it does | Kind (FR-050) |
  |---|---|---|---|
  | `browser_snapshot` | none | Text outline of the page's accessibility tree with element refs (`[ref=e12]`), current URL and title; capped at 40,000 characters | read |
  | `browser_take_screenshot` | `fullPage?` | PNG of the view (capped at 2 MB) | read |
  | `browser_wait_for` | `text?` or `seconds` 1-30 | Waits for text to appear or for the time | read |
  | `browser_navigate` | `url` (http/https, ≤ 2048) | Loads the URL (FR-024 applies) | url |
  | `browser_navigate_back` | none | History back | url |
  | `browser_click` | `ref`, `element` (≤ 200, for the log) | Scrolls the element into view, outlines it, clicks its centre | drive |
  | `browser_type` | `ref`, `element`, `text` (≤ 10,000), `submit?` | Focuses and inserts text; `submit` presses Enter | drive |
  | `browser_press_key` | `key` (an allow-list of key names) | One key press | drive |

  There is no tool to run scripts, read cookies or storage, upload files, set files on an input, open tabs, change permissions, intercept requests or reach another session. Refs come only from the latest snapshot of that session; a stale ref is refused with *Take a new snapshot*.
- **FR-046** The tools run in main through `webContents.debugger`, on the page target only: `Page`, `DOM`, `Accessibility`, `Input`, `Overlay` and `Runtime` for Durbar's own fixed helper expressions, never agent text. No CDP endpoint is exposed to any process.
- **FR-047** **Guards.**
  - `McpStore` refuses a user extra named `durbar-browser`, or one that points at the browser helper.
  - An ambient Copilot CLI entry with that name is switched off (`disabledMcpServers`), as 041 FR-031/FR-032 do for `agent-durbar` and 072 FR-033 for `durbar-loop`.
  - The helper refuses to start without a valid token file.
- **FR-048** The MCP dialogs (spec 058, 069) list `durbar-browser` as a Durbar built-in for sessions that have it. Users cannot edit it; it is controlled only by FR-041's switch.
- **FR-049** All browser tool calls of a session are serialized: one at a time per view.

### Permission modes (US3)

- **FR-050** The broker classifies `durbar-browser` calls by tool, not as a generic `mcp` call. The classification lives in the pure permission module (`src/adapters/permissions.ts`) so all three adapters share it:
  - `read`: `browser_snapshot`, `browser_take_screenshot`, `browser_wait_for`;
  - `url` (carrying the target host): `browser_navigate`, `browser_navigate_back`;
  - `drive` (carrying the current page's host): `browser_click`, `browser_type`, `browser_press_key`.

  The tool definitions mark the `read` tools `readOnlyHint: true`; Copilot runs those without a request (`real:` spec 044), which matches.
- **FR-051** **Read-only:** `read` tools are allowed, on whatever page is open (the user opened it, or it was opened earlier). `url` and `drive` are denied with *Read-only: the agent cannot browse or click. Switch to Ask first to let it.* (Constitution III: a URL request changes state and is denied in Read-only; see Q1.)
- **FR-052** **Ask first:**
  - `url` and `drive` calls ask, naming the tool, the host and, for `drive`, the element label;
  - *Allow for this session* grants **that host** for `url` and `drive` (a chip, revocable, dropped at session end);
  - Deny never remembers;
  - a grant never covers FR-070 and FR-071, which ask every time in Ask first.
- **FR-053** **Allow all:** every tool runs. FR-070 and FR-071 still apply (listed, never silent).
- **FR-054** Mode changes apply to the next call. A call already waiting for an answer keeps its request.

### Driving indicator and takeover (US4)

- **FR-060** The browser bar always shows who is driving: *Agent is using the browser* while an agent call runs or ran in the last 5 seconds; *You are using the browser* after the user's input. Icon and word, with an `aria-live="polite"` change. The office desk and the chat strip show a small browser marker (icon with an accessible name; compact densities may show the icon only) while the agent drives.
- **FR-061** **Takeover.**
  - Any user mouse or key input in the view, or a press on *Take over*, makes the user the driver.
  - While the user drives, agent calls wait up to 3 seconds, then answer *The user is using the browser. Try again later.* They are not queued.
  - *Hand back* returns control to the agent.
  - Takeover does not change the permission mode or any grant.
- **FR-062** **Show each action.** Before a `drive` action, Durbar outlines the target element on the page for about a second (`Overlay.highlightNode`; an instant outline under `prefers-reduced-motion`). Every tool call shows in the chat as a tool call with its masked arguments, as any MCP call does today. The bar shows the last action in words (*Clicked "Sign in"*).
- **FR-063** A per-session choice *Show the browser when the agent uses it* (default off) switches the panel to the Browser tab on the agent's first `url` or `drive` call of a turn. Off: the Browser tab label gets an *in use* marker only.
- **FR-064** Nothing the user types or clicks in the view is recorded by Durbar. Agent tool arguments in the chat, the activity log and the debug log go through the existing masking (`src/shared/redact.ts`). `browser_type` text is shown in the chat (the user must see what the agent typed) and is never written to the activity or debug log. The activity log records only the tool name, the host and the result.

### Forms, downloads and uploads (US3)

- **FR-070** **Form posts.** While the agent drives, main pauses top-level and frame document requests (CDP `Fetch` with `resourceType: Document`) whose method is not GET or HEAD, before they leave:
  - Read-only: cannot happen (`drive` is denied);
  - Ask first: a request *The agent's action is sending a form to <host>. Allow?*;
  - Allow all: allowed, with a chat note.

  Requests made with `fetch` or XHR are not paused (`[KNOWN GAP]`: a single-page app can send data that way; in Ask first the click itself already asked or was granted for that host).
- **FR-071** **Downloads.**
  - A download the agent's action starts is cancelled in Read-only, asked in Ask first (file name, size if known, host) and allowed in Allow all.
  - A download the user starts while driving gets the system save dialog.
  - Allowed agent downloads go to a visible per-session folder, `<Downloads>/Agent Durbar/<session name>-<short id>/`. Unsafe file name characters are replaced, and the path is built with `path` and checked to stay inside that folder.
  - Durbar never opens or runs a downloaded file.
- **FR-072** Downloads are listed in the Browser tab (name, size, state, *Show in folder*) and noted in the chat. The list is kept in memory for the session only.
- **FR-073** **No uploads by the agent.** While the agent drives, file choosers are intercepted (`Page.setInterceptFileChooserDialog`) and cancelled, and the tool answers *File uploads are not allowed for the agent*. The user can still upload when driving.

### Keep logins per folder (US5, owner input, later phase)

- **FR-080** A folder setting **Keep browser logins for this folder** (default off). When on, that folder's sessions use one persistent partition, `persist:durbar-folder-<random id saved with the folder>`. The partition is never shared with another folder, and the id is never derived from the path alone.
- **FR-081** Turning it on asks first, with **No** focused: *Every agent session in this folder that can use its browser will act with these logins.*
- **FR-082** The folder shows that it keeps browser logins (chip with icon and word). Its menu has *Clear browser logins* (clears storage and cache at once) and *Turn off* (clears and goes back to FR-020).
- **FR-083** Removing the folder clears and deletes its partition's folder on disk.
- **FR-084** Durbar never reads cookies or storage out of this partition; it only clears it.

### Simulator, layout, platforms (all stories)

- **FR-090** The office still fits 15 agents at 1440x900 and 1280x800, with the chat closed and open, and with the Browser tab open. The tab bar fits a 480px panel (spec 005 FR-040 width). Checked with `check:office` and screenshots.
- **FR-091** **Simulator first.** Under `DURBAR_SIM` main serves bundled test pages (a form, a link page, a download, a file input, a slow page) through a simulator-only scheme on the view's partition. Simulated agents print links to them. The main-process simulator (`src/main/mcp/simmain.ts` pattern) gets a scripted fake agent that calls the FR-045 tools. No network, zero AI credits.
- **FR-092** Windows, macOS and Linux:
  - socket and pipe names, the token folder and the downloads folder are resolved in one place with `path`, and unit-tested for all three from any OS;
  - views and partitions are checked by CI on all three;
  - `[KNOWN GAP]`: a person has used it on Linux only, until a spec records otherwise.
- **FR-093** No renderer or `src/shared` code knows a vendor. The browser server is added as a plain `McpServerSpec`; the adapters need no browser-specific code beyond the shared broker classification (FR-050).

### Out of scope (recorded for later)

- **FR-100** `[OUT OF SCOPE]` A per-session **CDP endpoint**, so that the user's own Playwright MCP (or chrome-devtools-mcp) drives the session browser instead of its own window. Research R3: feasible in principle (Playwright's own extension relay emulates the same thing over `chrome.debugger`), not verified, coupled to undocumented client internals, and much harder to gate per mode. A later spec, owner decision (Q3).
- **FR-101** `[OUT OF SCOPE]` Catching shell-opened URLs by setting `BROWSER` to a Durbar helper in the agent's environment. Many tools ignore `BROWSER`, so this would be partial; a later spec.
- **FR-102** `[OUT OF SCOPE]` More than one tab per session, and a side-by-side split of chat and browser (with #452).

### Key Entities

- **Session browser**: the view of one session. Its partition name, current URL, title, loading state, driver (agent/user), downloads list, `live` or `unloaded` (FR-011). In main's memory only.
- **Browser token**: random per-session secret binding a `durbar-browser` connection to one session's view.
- **Browser grant**: a session grant for one host, scope `url`/`drive` (FR-052), shown and revoked like other grants.
- **Folder login store** (US5): the per-folder persistent partition id, saved with the folder (an id, never content).

## Success Criteria *(mandatory)*

- **SC-001**: With 15 simulated agents, opening the Browser tab in any chat at 1440x900 and 1280x800 causes no overlap, no clipped text and no office scroll (`check:office`).
- **SC-002**: A cookie and a local-storage value set in session A are not readable in session B, in a test that loads the same test origin in both.
- **SC-003**: In a unit test with two sessions and swapped tokens, a tool call with A's token never changes B's view, and a call with a dropped or wrong token is refused.
- **SC-004**: After *End session*, the view's `webContents` is destroyed, its partition is cleared, and a new session loading the same origin sees no old cookie (sim driver).
- **SC-005**: In Read-only, every `url` and `drive` call is denied for all three adapters' broker paths. In Ask first, a document POST and a download each ask even with a host grant (unit tests).
- **SC-006**: The token is absent from every built server config and argv for all three apps (unit test with planted token shapes).
- **SC-007**: Each tool answers within 200 ms of main's work, page load times excluded, on the simulator's test pages.

## Assumptions

- **Electron 44's `WebContentsView` and `webContents.debugger`** behave as documented (research R1). Before the plan relies on them, a simulator check confirms that the view is drawn over the page (FR-008) and that `Fetch`, `Accessibility` and `Page.setInterceptFileChooserDialog` work through the debugger on a view (T010).
- **The relay core and socket host shared with 041 T018 and 072 T032/T033** are built once. Whichever spec lands first builds them, and the others reuse them (coordinate with Ruben, 072 plan).
- **No new runtime dependency.** The snapshot text, refs and tools are Durbar's own code over CDP.

## Known limits

- `[KNOWN GAP]` Same-user isolation: another process of the same OS user (for example an agent in Allow all with a shell) could read a session's token file and drive that one session's browser. This is the same limit as 041 FR-035 and 072. Other users cannot: the token is never in argv or env, the file is 0600 in a 0700 folder, and the socket is per user.
- `[KNOWN GAP]` FR-032 (shell-opened URLs), FR-026 (popup sign-ins), FR-027 (certificate errors), FR-025 (web permissions), FR-070 (fetch/XHR posts).
- `[KNOWN GAP]` An agent that drives a page can read whatever that page shows, including what the user typed into it before. Taking over and logging in yourself means the agent can use that login in that session (that is the point). It cannot read cookies directly (FR-045, FR-084).
- Not verified on any real session: whether each app's model uses the tools well, and token cost of the tool definitions (T060).

## Clarifications

### Session 2026-10-23 (coordinator defaults under Ruben's delegation; analyst recommendations)

- **Embedded view or separate window?** An embedded `WebContentsView` in the chat panel's Browser tab, not a separate window (coordinator default). Research shows it is possible. The overlay rule FR-008 is the price.
- **Which MCP browser servers can attach, and how?** Playwright MCP through a CDP endpoint (`cdpEndpoint` + `cdpHeaders` in its config file), chrome-devtools-mcp through `--wsEndpoint` + `--wsHeaders`. Neither can attach to an Electron view without Durbar serving and emulating a browser-level endpoint (R3). v1 uses Durbar's own `durbar-browser` tools instead (FR-040..FR-046, R5); the endpoint is FR-100, later.
- **Keep a session's profile after it ends?** No by default: in-memory, wiped on close (coordinator default, FR-020, FR-023). The per-folder opt-in is US5 (owner input, Vikram, 2026-10-22), a later phase.
- **No global `--remote-debugging-port`**, ever (FR-029). Agent control only through the per-session, per-user, token-authenticated channel (FR-040, FR-043). The coordinator's "loopback-only" becomes a Unix socket or named pipe, which is stricter than a loopback TCP port.
- **Phase 1 has no agent control:** links open in the session's Browser tab (US1, US2; coordinator default).
- **Driving indicator and takeover:** FR-060, FR-061 (coordinator default).
- **Agent control off by default per session** (FR-041). *Decided by the coordinator under Ruben's delegation (recommended by the analyst):* least privilege, and every session would otherwise carry the tool definitions in its prompt (credits).

### Open questions for an owner

- **Q1 (conflict with the coordinator default, needs an owner).** The coordinator default says "Read-only: the agent can navigate and read, but every form submit or download asks first." Constitution III says Read-only approves reads and **denies** everything that can change state, **URL included**, and that only *Ask first* leaves requests pending. Navigation is a URL request (a GET can log out, delete or buy), and Read-only never asks. **Recommended (FR-051):**
  - **Decided (coordinator under Ruben's delegation, 2026-10-23):** the recommendation (FR-051). Constitution III is non-negotiable, so the coordinator's earlier default is withdrawn: Read-only reads the open page only; Ask first is the "navigate, but ask for forms and downloads" mode. T030 is unblocked.
  - Read-only allows only reading the page that is already open (snapshot, screenshot, wait) and denies navigate, click and type;
  - the user can still open pages there themselves (US1, US2), and the agent can read them;
  - Ask first is the mode for "navigate, but ask me for forms and downloads" (FR-052, FR-070, FR-071).

  The alternative is a constitution amendment that makes navigation a read inside the session browser. It is not recommended.
- **Q2 (owner).** Should a session that has `durbar-browser` on switch off the user's own browser MCP servers (an ambient `playwright` or `chrome-devtools` entry) in that session, so its windows stop popping up? **Recommended:** no automatic switch-off. The Browser tab shows *This session also has <name>, which opens its own windows* with a one-click *Turn off for this session* (spec 058's per-session switch). Automatic switch-off would change a user's setup without asking.
  - **Decided (coordinator, 2026-10-23):** the recommendation: a hint with a one-click switch-off for this session, never automatic.
- **Q3 (owner, later).** Do we want FR-100 (a CDP endpoint for the user's own Playwright MCP) as a follow-up spec? **Recommended:** only if real use shows the built-in tools are not enough. It needs a method allow-list, Origin checks on a loopback port, and a pinned client version range.
  - **Decided (coordinator, 2026-10-23):** not now; revisit only if real use shows the built-in tools are not enough (FR-100 stays out of scope).
- **Q4 (coordinator, with #452).** Side-by-side chat and browser: wait for #452's docking, then add a split (FR-102).
  - **Decided (coordinator, 2026-10-23):** v1 is a Chat | Browser tab; the split waits for #452 (FR-102).

## Changes

(none yet)

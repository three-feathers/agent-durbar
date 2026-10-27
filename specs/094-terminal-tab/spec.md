# Feature Specification: A Terminal tab in the chat, one shell per folder

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Terminal tab (issue #807): a Terminal tab next to Chat and Browser in a chat; one terminal per folder, shared by the folder's chats, started in the folder with the user's login shell; it keeps running until its close button, folder removal or app quit (a quit with a running command warns); user-only, agents never see it; no output logged or saved
status: Draft (2026-10-27): spec, plan, research and tasks; owner decisions of 2026-10-27 recorded; questions Q1-Q8 answered by the owner (the recommended options); nothing built
-->

**Feature Branch**: `094-terminal-tab` (spec); code branches `094-pN-slug`, one per phase

**Created**: 2026-10-27

**Status**: Draft. Nothing is built. The dependency facts in [research.md](research.md) were read from the npm registry and the package tarballs on 2026-10-27 (`read:`); nothing was installed or run.

**Input**: Issue #807 (owner idea, 2026-10-27): "Built-in terminal panel, VS Code style, opened in the room's folder." Owner decisions by Paco on the issue (2026-10-27), recorded under *Clarifications*.

**Number**: 094 (tentative). `specs/` on `origin/main` (0f57c58f) ends at 092; remote branch `093-create-folder` and open PR #810 hold 093; no branch or open PR uses 094 (checked 2026-10-27).

## Context: what exists today

- **The Browser tab (spec 080)**: a chat of a live top-level session shows a `Chat | Browser` tablist under the header. The tabs, the bar and the pane are `src/renderer/browserpane.js` (`tabsHTML`, `paneHTML`, `mount`, `select`, `hide`, `current`, the roving `tabKey`), mounted by `openPanel()` in `src/renderer/app.js`; the page is a native view owned by main (`src/main/browser/*`, IPC `browser:*` in `src/main/ipc/browser.ts`, preload `browser*` in `src/preload/preload.ts`). The browser is **per session** (agent id); this feature is **per folder**. The tablist is hard-coded for two tabs (`select(i?'browser':'chat')`).
- **The chat panel is rebuilt on every `openPanel()`**; a chat's log survives because its element is kept per agent (`getChat(a)`, `chats[a.id]`) and re-appended. The office is hidden while the panel is open (`body.panel-open`).
- **Folders**: a room is a folder or a `.code-workspace`. Main keys a folder by `workspaceFile ?? cwd` (`wsKey`, `src/main/main.ts`); a session's `cwd` is the folder, or the **first folder listed** in a workspace file (`resolveWorkspaceCwd`, `src/adapters/workspace.ts`). Removing a folder ends its sessions (`folders:remove`, `src/main/ipc/folders.ts`; confirm text in `removeFolder()`, `app.js`).
- **Quit**: one `before-quit` handler asks *Quit / Cancel* while agents work (`confirmQuit()`, `workingCount()`, `quitMessage()` in `src/main/daily.ts`); on macOS closing the window only hides it (spec 052 FR-085).
- **Shell choice already exists for one job**: `loginShellCommand()` (`src/main/loginpath.ts`, spec 060) takes `$SHELL` only when it is an absolute path to an existing, known shell, else `/bin/sh`, with an argv array. Windows: `windowsCmd()` (`src/shared/wincmd.ts`) finds `cmd.exe` safely. Child environments: `codexChildEnv()` (`src/adapters/codex.ts`) drops other tools' credentials; `setupEnv()` (`src/main/harnesssetup.ts`) adjusts PATH. Main changes its own environment in two places only: the login PATH (`main.ts`) and `TZ=UTC` under the simulator clock (`main.ts`). No code puts a token into `process.env` (`read:` grep of `src/`, 2026-10-27).
- **The lobby has a decorative *Terminal* place** (spec 024): agents walk there while they run a shell tool (`places.js`). It is shared by all folders and is about agents, not the user.
- **No PTY and no terminal emulator** exist in the repo. Durbar already ships one native N-API module, `koffi` (pulled in by `@github/copilot-sdk`), unpacked from `app.asar` (`package.json` `build.asarUnpack`), with `npmRebuild: false`.

## Clarifications

### Session 2026-10-27 (Paco, owner, on issue #807)

- Where? -> A: **One more tab, like the Browser tab**, next to Chat and Browser in the chat view. Not a bottom panel. Reuse the Browser tab's tab strip and lifecycle code.
- Scope? -> A: **One terminal per folder.** All chats of a folder share it; it starts in that folder.
- Lifetime? -> A: **It keeps running until closed**, like VS Code: leaving the tab or going back to the office does not stop it. It ends with its close button, when the folder is removed, or when the app quits. A quit while a process is still running warns first.
- Agents? -> A: **User-only.** Agents never see or use it; nothing from it reaches a chat unless the user copies it.

### Defaults (confirmed by the owner, 2026-10-27, with Q1-Q8)

- **D1 Shell**: the user's login shell (FR-010). No Settings choice in this version. *(Default; the issue left it open.)*
- **D2 One terminal, no inner tabs.** *(Default; the issue left it open.)*
- **D3 Workspace root**: a `.code-workspace` folder's terminal starts in the **first folder listed** in the file, the same folder its agent sessions use (`resolveWorkspaceCwd`). *(Default; Q1.)*

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run a command in the folder without leaving Durbar (Priority: P1) MVP

Mia is chatting with an agent in `shop-api`. She wants to run the tests herself. She clicks **Terminal** next to Chat and Browser; her own shell starts in `shop-api`, she types `npm test` and reads the result. She goes back to the Chat tab and tells the agent what failed.

**Why this priority**: it is the issue.

**Independent Test**: simulator (`DURBAR_SIM=15`): open a chat, select Terminal; the fake shell's prompt shows the folder; typed text is echoed; switching to Chat and back shows the same screen.

**Acceptance Scenarios**:

1. **Given** a chat of a top-level session is open, **When** I look under the header, **Then** I see a tablist with Chat, Browser (when spec 080 offers it) and **Terminal**; Terminal is not selected and **no shell has started**.
2. **Given** I select Terminal for a folder that has no terminal yet, **Then** one shell starts in that folder, the terminal gets the keyboard focus, and the pane says in one line that this is my own shell, that agents cannot see it and that the folder's permission mode does not apply to it.
3. **Given** a workspace folder, **Then** the shell starts in the first folder listed in the workspace file, and the pane's line names that folder (D3, Q1).
4. **Given** the terminal shows, **Then** its text is at least 10.5px, it fills the pane, and resizing the window resizes the shell's columns and rows.

### User Story 2 - The folder's chats share one terminal that keeps running (Priority: P1) MVP

Mia starts a dev server in the terminal of `shop-api`, goes back to the office, opens a second chat of the same folder and selects Terminal: the same server is still printing there.

**Why this priority**: owner decision (scope and lifetime).

**Independent Test**: simulator: two sessions of one folder (`+ New session`); start the fake long command in one chat's terminal, open the other chat's Terminal tab: same output; a chat of another folder shows a different (not started) terminal.

**Acceptance Scenarios**:

1. **Given** a terminal runs in folder A, **When** I go to the Chat tab, close the chat, go to the office or open another folder's chat, **Then** the shell keeps running and its output keeps arriving (in memory).
2. **Given** two chats of folder A, **When** I select Terminal in either, **Then** both show the same terminal, with the output produced while I was away.
3. **Given** a chat of folder B, **When** I select Terminal, **Then** it is B's own terminal, never A's.
4. **Given** I reopen a chat of A, **Then** it starts on the Chat tab (as spec 080 does), and the Terminal tab label shows that A's terminal is running (a word, not only a dot).

### User Story 3 - Ending the terminal (Priority: P1) MVP

**Acceptance Scenarios**:

1. **Given** the terminal is idle at its prompt, **When** I press its **Close terminal** button, **Then** the shell and its children end and the pane shows "No terminal running" with a **Start terminal** button.
2. **Given** a command runs in the foreground, **When** I press Close terminal, **Then** I am asked first ("A command is still running in this terminal: <name>. Close it?"), Cancel being the default.
3. **Given** I type `exit` (or the shell ends by itself), **Then** the pane keeps the last screen, says "The shell ended (exit code n)" and offers Start terminal.
4. **Given** I remove the folder, **Then** its terminal ends with it; the existing *Remove folder* question also names a running command.
5. **Given** I quit the app (or close the window on Windows or Linux) while any terminal runs a foreground command, **Then** the existing quit question also lists the terminals with a running command; Cancel keeps everything running. With only idle terminals the app quits without a terminal question (Q4).
6. **Given** the app starts again, **Then** no terminal is restored and no earlier output exists anywhere (nothing was saved).

### User Story 4 - Keyboard and screen reader (Priority: P1)

**Acceptance Scenarios**:

1. **Given** focus is on the Terminal tab, **When** I press Enter, Space or Tab into the pane, **Then** the focus is in the terminal and keys go to the shell, **Tab and Esc included** (a shell needs both).
2. **Given** focus is in the terminal, **When** I press the documented leave key (F6, Q2), **Then** the focus goes back to the Terminal tab; the key is listed in the keyboard help sheet and in the pane's hint.
3. **Given** focus is in the terminal, **Then** Esc does **not** close the chat (it goes to the shell); with focus anywhere else in the panel Esc closes the chat as today.
4. **Given** a screen reader, **Then** xterm's screen-reader mode is on: new output is read through its live region, the terminal has an accessible name ("Terminal in shop-api"), and the tab's state ("running", "ended") is in its accessible name.

### User Story 5 - Agents never see it (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a terminal is running, **Then** no agent event, prompt, tool, MCP server (spec 041), remote control (spec 054), session summary, activity row, note, log or saved file gets its input or output.
2. **Given** I select text in the terminal and copy it, **Then** it is on the system clipboard only; I can paste it into the message box myself.

### Edge Cases

- **Folder in Read-only**: the terminal runs whatever I type; the pane line says the folder's mode is for agents only (issue #807, *Mode*). Nothing in the mode chip changes.
- **The folder no longer exists on disk** (moved, deleted): Start terminal shows "The folder <path> was not found" and starts nothing.
- **`$SHELL` missing, relative or not a shell**: the fallback of FR-010 is used and the pane line names the shell that started.
- **Very fast output** (`yes`, a big `cat`): the window stays responsive; main pauses the PTY when the window has not caught up (FR-024) and memory stays capped.
- **Window reload or renderer crash**: the shells keep running in main; the next Terminal tab shows the in-memory replay of recent output (FR-025).
- **Helper (sub-agent) chats**: no tabs, as for the Browser (spec 080).
- **Demo mode (no bridge)** and the plain page without Electron: no Terminal tab.
- **Simulator**: a fake shell in main (FR-040), never a real process.
- **Two windows**: Durbar has one window; nothing to share.
- **macOS window closed (hidden)**: terminals keep running, like agents (spec 052 FR-085).
- **A terminal bell**: ignored (no sound, no toast, no notification).
- **Pasting many lines**: passed to the shell as typed; shells with bracketed paste see one paste. No warning in this version.
- **Links in the output**: plain text in this version (out of scope: opening them in the Browser tab).
- **The Browser's native view and overlays (spec 080 FR-008)**: unaffected; the terminal is plain page content, so menus and dialogs draw over it without any cover logic.

## Requirements *(mandatory)*

### Tab and pane

- **FR-001**: A chat of a live top-level session MUST show a **Terminal** tab in the same tablist as Chat and Browser (spec 080 FR-002), after Browser. The tablist keeps one tab stop with roving focus (Left/Right/Home/End) over all its tabs. The Terminal tab exists when the bridge offers the terminal API; the Browser tab keeps its own rule, so a chat may show `Chat | Terminal` only.
- **FR-002**: Selecting Terminal MUST hide the chat log and Previous sessions exactly as the Browser tab does (`.on-browser` rules), show the terminal pane and keep the composer visible (Q5). Selecting Chat or Browser hides the pane; the terminal keeps running.
- **FR-003**: A reopened chat starts on Chat (spec 080 rule `startTab`); a rebuilt panel of the same chat (rename) keeps its tab.
- **FR-004**: The pane MUST have a one-line bar: the folder (shortened path, full path in the tooltip), the shell name, the words "Your shell; agents can't see it. The folder's mode does not apply.", a **Close terminal** button, and the leave-key hint. With no terminal running it shows "No terminal running" and **Start terminal** instead of the screen.
- **FR-005**: The Terminal tab's label and accessible name MUST carry the state: nothing (never started or closed), "running" (shell alive), "running a command" (FR-031), "ended" (shell exited by itself). Shown with a word, not colour alone.
- **FR-006**: Opening Notes (spec 083 FR-025) or any action that needs the chat log MUST first switch from Terminal to Chat, as it does from Browser today (`DN.showChatTab`).

### One terminal per folder, lifetime

- **FR-007**: There MUST be at most **one terminal per folder key** (`workspaceFile ?? cwd`, the key main already uses). Every chat of the folder shows the same terminal. A terminal starts only when the user selects the Terminal tab (or Start terminal) for a folder without one; nothing starts at app start or when a chat opens.
- **FR-008**: A terminal MUST keep running when the user switches tab, closes the chat, opens another chat or goes to the office, and while the macOS window is hidden.
- **FR-009**: A terminal MUST end only by: its Close terminal button (FR-030), the shell exiting by itself, the folder's removal (`folders:remove`), or the app quitting. Ending kills the shell's whole process tree (FR-033). After an end the folder may start a new terminal; the old screen is dropped when a new one starts.

### Shell, folder, environment (constitution III, VI)

- **FR-010**: The shell (D1) MUST be chosen by a pure function with an injected environment, testable on every OS:
  - **macOS, Linux**: `$SHELL` when it is an absolute path to an existing executable file that is either listed in `/etc/shells` or named like a known shell (the `loginShellCommand` set plus `tcsh`, `csh`, `nu`, `elvish`, `xonsh`, `pwsh`); otherwise `/bin/bash` if it exists, else `/bin/sh`. Arguments: `['-l']` on macOS (a login shell, as Terminal.app starts one), `[]` on Linux (an interactive shell, as Linux terminal apps start one). *[unverified: that every listed shell accepts `-l`; FR-010 tests the argv only.]*
  - **Windows**: PowerShell 7 (`pwsh.exe`) when found on `PATH` (absolute result of the existing `pathDirs` lookup), else Windows PowerShell at `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`, else `windowsCmd(env)` (`cmd.exe`, the `COMSPEC` rule of spec 045). Arguments: `['-NoLogo']` for PowerShell, `[]` for cmd.
- **FR-011**: The shell MUST be spawned with an **argument array** and the folder as `cwd`; Durbar never builds a command string, never runs anything through another shell, and never writes text into the terminal on the user's behalf (no startup command, no `cd`). What the user types reaches the PTY as keystrokes, exactly as in any terminal app.
- **FR-012**: The working folder MUST be looked up in main from the agent id (constitution III: paths are looked up by agent id); the renderer never sends a path. For a workspace it is the first listed folder (D3). A folder that does not exist is refused with a message (edge case).
- **FR-013**: The environment MUST be built by a pure function from a **snapshot of `process.env` taken when main starts** (before any adapter or SDK loads), with the login PATH of spec 060 applied, and then:
  - dropped: every `DURBAR_*` variable (dev hooks, spec 010), every `ELECTRON_*` and `CHROME_*` variable, `ORIGINAL_XDG_CURRENT_DESKTOP` (and `XDG_CURRENT_DESKTOP` restored from it on Linux), `GOOGLE_API_KEY` / `GOOGLE_DEFAULT_CLIENT_ID` / `GOOGLE_DEFAULT_CLIENT_SECRET` (Chromium's), and the simulator's `TZ` when the simulator clock set it;
  - set: `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=AgentDurbar`, `TERM_PROGRAM_VERSION=<app version>`, and on macOS `LANG=<locale>.UTF-8` only when no `LANG`/`LC_ALL`/`LC_CTYPE` is set (an app opened from Finder has none);
  - kept: everything else the user's own session had (Q8).
  The snapshot guarantees that nothing an SDK or adapter adds to `process.env` later reaches the terminal. Values are never logged. *Durbar itself holds no token in its environment today (`read:` grep of `src/` for `process.env` writes, 2026-10-27); the snapshot rule keeps it that way if a dependency ever adds one.*
- **FR-014**: No terminal input or output MUST be **logged, saved or sent** anywhere: not to the `DURBAR_LOG` sink, not to stderr, not to crash markers, not to `localStorage`, not to any file. Scrollback lives in memory only (the renderer's xterm buffer, capped at 5,000 lines, and main's replay buffer, FR-025) and is gone when the terminal ends or the app quits.

### User-only (owner decision)

- **FR-015**: The terminal MUST NOT be reachable by agents: no `AgentAdapter` member, no normalized event, no Durbar MCP tool (spec 041), no remote-control path (spec 054), no schedule (spec 044), no session summary (spec 085), no activity row, no Notes entry. A static test MUST fail when a terminal module is imported from `src/adapters`, `src/main/mcp`, or any IPC module other than the terminal's own (FR-042).
- **FR-016**: Copy MUST put the selection on the system clipboard only. Nothing from the terminal is inserted into the message box or a chat automatically.

### Closing, quitting, removal

- **FR-030**: **Close terminal** ends the terminal at once when the shell is at its prompt; when a foreground command runs (FR-031) it asks first through the shared `askDialog` (Cancel focused).
- **FR-031**: "A command is running" means the PTY's foreground process is not the shell itself (node-pty's `process` name differs from the shell's). On Windows this cannot be told reliably, so every open terminal counts as running a command there. `[KNOWN GAP]` on Windows: the question appears for an idle terminal too.
- **FR-032**: The quit question (spec 052 FR-090, `confirmQuit`) MUST also count terminals with a running command ("1 agent is working and 1 terminal is running a command"). It asks once, Cancel is the default, and the same answer covers the window's close on Windows and Linux. Idle terminals end without a question (Q4).
- **FR-033**: Ending a terminal MUST end its process tree: on macOS and Linux a `SIGHUP` to the shell (what closing a terminal window sends), then `SIGKILL` to its process group after 2 s if still alive; on Windows the existing `killChildTree` (`taskkill /T /F`). All terminals end in `will-quit` (next to `destroyAllViews()`).
- **FR-034**: *Remove folder* (`folders:remove`) MUST end the folder's terminal; the renderer's confirm text (`removeFolder()`) names a running command.

### Data path and IPC (constitution III)

- **FR-020**: The renderer MUST talk to terminals only through a narrow preload API (names in the plan): open, input, resize, close, ack, state, and two events (data, state). Every handler is `fromApp`-checked (`ipcHandle`), takes an **agent id** that main maps to its folder key, and validates every value (input a string at most 64 KB per call; columns 2-500, rows 1-300 as integers; ack a non-negative integer).
- **FR-021**: Main MUST answer with a terminal id it generated (random, not a path) and a state `{tid, folderKey hash or label, open, exited, exitCode, busy, processName, shell}`; output events carry the `tid` and text only.
- **FR-022**: Output MUST reach the renderer in batches (at most one message per 16 ms per terminal, at most 64 KB each).
- **FR-024**: Flow control: when more than 256 KB of output is unacknowledged by the window, main MUST pause the PTY and resume it below 64 KB, so a flood cannot grow memory without bound.
- **FR-025**: Main MUST keep a replay buffer per terminal (the last 256 KB of output, memory only) and send it when a window attaches to a running terminal (after a reload or crash). It is dropped when the terminal ends.

### Display, accessibility, platforms (constitution V, VI)

- **FR-050**: The terminal MUST use xterm.js with **`screenReaderMode: true`**, a font size of at least **10.5px** (default 13px, following the chat text size where it is larger), colours from the theme's semantic tokens for background, foreground, cursor and selection (no theme-specific size, `test:theme`), and a contrast of at least 4.5:1 between foreground and background in every built-in theme.
- **FR-051**: Keyboard policy while the terminal has focus (Q3): every key goes to the shell **except**: the leave key (F6, Q2); on macOS, ⌘ shortcuts (⌘C copy, ⌘V paste, ⌘K palette, ⌘F Go to, ...); on Windows and Linux, `Ctrl+Shift+C` copy and `Ctrl+Shift+V` paste, and the app's `Ctrl+Shift+<letter>` shortcuts (inbox A, next N, schedules S, previous sessions H, notes M). Plain `Ctrl+<letter>`, `Ctrl+Backquote`, `Alt+<letter>`, `Esc`, `Tab`, `F2` and `PageUp/PageDown` go to the shell. The keyboard help sheet lists these rules.
- **FR-052**: Focus: selecting the tab with the keyboard keeps focus on the tab; Enter, Space or Tab from the tab moves focus into the terminal; a click in the pane focuses it; the leave key returns to the Terminal tab. `focus()` calls use `preventScroll` (`innerscroll.js` rule, `test:innerscroll`).
- **FR-053**: The office is unaffected: the terminal lives in the chat panel, which already covers the office; the 15-agent rule (spec 001) and `check:office` results MUST NOT change.
- **FR-054**: The pane MUST fit the chat panel at 1440x900, 1280x800 and the 480px narrow panel without page overflow, with at least 8 terminal rows visible at 1280x800 with the composer at its default height.
- **FR-055**: Windows, macOS and Linux behave the same through the same code; OS differences are only in FR-010 (shell), FR-031 (busy) and FR-033 (kill), each a pure function with an injected platform.

### Simulator and tests (constitution IV, VII)

- **FR-040**: Under the simulator (`DURBAR_SIM`) main MUST use a **fake PTY** (a scripted shell with a prompt, echo, a few fixed commands, a long-running command for the quit question, `exit`) and MUST NOT load node-pty or start any process. The terminal channels are added to `SIM_OPEN_CHANNELS` with their reason; under the simulator the controller accepts simulated agent ids and a simulated folder key from the window (harmless: the fake PTY never touches a path).
- **FR-041**: The terminal controller MUST take its PTY factory, clock and killer as injected dependencies so every rule (one per folder, lifetime, removal, quit count, caps, flow control, replay, no logging) is tested in Node with a fake PTY; CI never needs a real shell for `npm test`.
- **FR-042**: Tests: unit tests for the shell choice, the environment, the controller, the renderer helpers (tab model, key policy, label words) and the static user-only rule; a simulator driver for the tab at 1440x900 and 1280x800 and the narrow panel; `test:ipcchannels` and `test:simguard` updated; the packaged check (nightly and on demand) loads node-pty from the packaged app and runs one fixed, harmless command through it on each OS.
- **FR-043**: Docs: README (feature list, *Safety model*: the terminal is your own shell, not governed by the permission modes; known limits), keyboard help, a `changelog.d/` fragment, the screenshots (`npm run shots:docs` for every linked picture that shows the chat panel), and dated `## Changes` lines in spec 080 (the tablist now has three tabs) and spec 052 (quit question, keyboard sheet).

### Key Entities

- **Terminal**: one per folder key; a PTY with a shell, a terminal id, a state (open, busy, process name, exited, exit code), a replay buffer in memory.
- **Terminal pane**: the tab's view of the folder's terminal in a chat; the xterm instance per folder lives in the window and is re-attached on every panel rebuild (as `getChat()` keeps chat logs).

## Success Criteria *(mandatory)*

- **SC-001**: In the simulator, selecting Terminal shows a working prompt in under 1 s, and two chats of one folder show the same terminal in 100% of driver runs; chats of different folders never share one.
- **SC-002**: Leaving the tab, closing the chat and going to the office never end a terminal (driver: the fake long command still prints when the tab is shown again).
- **SC-003**: The quit question names terminals with a running command, and only those (unit test of the count; driver with the fake long command).
- **SC-004**: No terminal output appears in any file under the profile folder, in the `DURBAR_LOG` sink or on stderr after a driver run that printed a marker string (the driver greps for it).
- **SC-005**: Terminal text is at least 10.5px and the pane fits at 1440x900, 1280x800 and the narrow panel with no page overflow; `check:office` is unchanged.
- **SC-006**: A packaged build on each OS loads the PTY module and runs one fixed command (packaged check), before the feature is called built for that OS.

## Assumptions

- Spec 080's tablist stays the place for chat-level views; a third tab does not change the Browser's behaviour.
- The terminal is not part of the office, the lobby, floors (spec 092) or the list view.
- The user may run anything in their own terminal; Durbar does not filter, read or classify what is typed (it is not an agent).
- The terminal does not survive an app restart (no session restore).

## Out of scope (recorded for later)

- Several terminals per folder, split panes, a terminal per chat (D2).
- A Settings choice of shell or arguments (D1).
- Opening links from the output in the Browser tab; a "send selection to the message box" action.
- Restoring terminals after a restart; saving scrollback.
- A terminal in the office or the lobby (Q6).

## Known gaps (honest limits)

- `[KNOWN GAP]` Nothing is built or run. The dependency facts are `read:` only (registry and tarball listings, 2026-10-27; see research.md).
- `[KNOWN GAP]` Real shells, input methods (IME), copy and paste, and screen readers (VoiceOver, NVDA, Orca) can only be checked on real machines; the simulator checks the fake shell and the DOM.
- `[KNOWN GAP]` Windows cannot tell a running command from an idle prompt (FR-031).
- `[KNOWN GAP]` The Linux prebuilt PTY binary's minimum glibc and the AppImage on older distributions are not known.
- `[KNOWN GAP]` The macOS `spawn-helper` in an ad-hoc signed, quarantined app is not tried (research R4).

## Changes` lines in spec 080 (the tablist now has three tabs) and spec 052 (quit question, keyboard sheet).

### Key Entities

- **Terminal**: one per folder key; a PTY with a shell, a terminal id, a state (open, busy, process name, exited, exit code), a replay buffer in memory.
- **Terminal pane**: the tab's view of the folder's terminal in a chat; the xterm instance per folder lives in the window and is re-attached on every panel rebuild (as `getChat()` keeps chat logs).

## Success Criteria *(mandatory)*

- **SC-001**: In the simulator, selecting Terminal shows a working prompt in under 1 s, and two chats of one folder show the same terminal in 100% of driver runs; chats of different folders never share one.
- **SC-002**: Leaving the tab, closing the chat and going to the office never end a terminal (driver: the fake long command still prints when the tab is shown again).
- **SC-003**: The quit question names terminals with a running command, and only those (unit test of the count; driver with the fake long command).
- **SC-004**: No terminal output appears in any file under the profile folder, in the `DURBAR_LOG` sink or on stderr after a driver run that printed a marker string (the driver greps for it).
- **SC-005**: Terminal text is at least 10.5px and the pane fits at 1440x900, 1280x800 and the narrow panel with no page overflow; `check:office` is unchanged.
- **SC-006**: A packaged build on each OS loads the PTY module and runs one fixed command (packaged check), before the feature is called built for that OS.

## Assumptions

- Spec 080's tablist stays the place for chat-level views; a third tab does not change the Browser's behaviour.
- The terminal is not part of the office, the lobby, floors (spec 092) or the list view.
- The user may run anything in their own terminal; Durbar does not filter, read or classify what is typed (it is not an agent).
- The terminal does not survive an app restart (no session restore).

## Out of scope (recorded for later)

- Several terminals per folder, split panes, a terminal per chat (D2).
- A Settings choice of shell or arguments (D1).
- Opening links from the output in the Browser tab; a "send selection to the message box" action.
- Restoring terminals after a restart; saving scrollback.
- A terminal in the office or the lobby (Q6).

## Known gaps (honest limits)

- `[KNOWN GAP]` Nothing is built or run. The dependency facts are `read:` only (registry and tarball listings, 2026-10-27; see research.md).
- `[KNOWN GAP]` Real shells, input methods (IME), copy and paste, and screen readers (VoiceOver, NVDA, Orca) can only be checked on real machines; the simulator checks the fake shell and the DOM.
- `[KNOWN GAP]` Windows cannot tell a running command from an idle prompt (FR-031).
- `[KNOWN GAP]` The Linux prebuilt PTY binary's minimum glibc and the AppImage on older distributions are not known.
- `[KNOWN GAP]` The macOS `spawn-helper` in an ad-hoc signed, quarantined app is not tried (research R4).

## Questions

Short; each has a recommended answer. Owner: Paco.

1. **Q1 Workspace root**: where does a `.code-workspace` folder's terminal start? (a) **the first listed folder, as the agents do** (recommended); (b) the folder that holds the `.code-workspace` file.
2. **Q2 Leaving the terminal by keyboard** (Esc and Tab belong to the shell): (a) **F6 / Shift+F6** (the usual "next pane" key; Midnight Commander users lose F6) (recommended); (b) `Ctrl+Shift+Backquote`.
3. **Q3 App shortcuts inside the terminal**: (a) **the shell gets plain Ctrl/Alt keys; ⌘ (Mac) and Ctrl+Shift (Windows, Linux) shortcuts stay the app's** (FR-051) (recommended); (b) the app's shortcuts always win (Ctrl+K, Ctrl+F, Ctrl+O would no longer reach bash).
4. **Q4 Quit warning**: (a) **only when a terminal runs a command** (every open terminal on Windows) (recommended); (b) whenever any terminal is open.
5. **Q5 Message box on the Terminal tab**: (a) **stays visible, as on the Browser tab** (paste a result straight to the agent) (recommended); (b) hidden, more rows for the terminal.
6. **Q6 Lobby *Terminal* place**: (a) **stays decorative**: it shows agents running shell tools, is shared by all folders, and linking it to a user-only shell would blur "agents never use it" (recommended); (b) clicking it opens the current chat's Terminal tab.
7. **Q7 PTY package** (research R2): (a) **`node-pty` from Microsoft, exact pin of the first release with Linux prebuilds** (today `1.2.0-beta.18`; the stable `1.2.0` if it is out when phase 1 starts) (recommended); (b) `node-pty@1.1.0` (stable, but builds from source on Linux: a C++ toolchain on every Linux developer machine and CI); (c) `@lydell/node-pty` (per-platform packages, one maintainer).
8. **Q8 Environment**: (a) **the user's own environment minus Durbar's and Electron's internals** (FR-013) (recommended); (b) also drop secret-looking names (the Codex child rule): safer but `gh`, `npm` and cloud CLIs started from Durbar would lose tokens the user exported before opening it.

## Changes

(none yet)

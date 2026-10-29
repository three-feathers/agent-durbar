# Feature Specification: A Terminal tab in the chat, one shell per folder

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Terminal tab (issue #807): a Terminal tab next to Chat and Browser in a chat; one terminal per folder, shared by the folder's chats, started in the folder with the user's login shell; it keeps running until its close button, folder removal or app quit (a quit with a running command warns); user-only, agents never see it; no output logged or saved
status: draft
note: spec, plan, research and tasks drafted; nothing built
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

### Questions Q1-Q8 (Paco, owner, 2026-10-27)

Paco accepted the recommended option of every question in his terminal session on 2026-10-27. He confirmed them again in the terminal on 2026-10-27, and they are recorded on issue #807 (https://github.com/three-feathers/agent-durbar/issues/807#issuecomment-6449867443), since terminal history is not a record (review on #811, item 2). The questions and their options stay under *Questions*.

- Q1 Workspace root -> A: (a) the first listed folder, as the agents do. Paco, 2026-10-27, [#807 comment](https://github.com/three-feathers/agent-durbar/issues/807#issuecomment-6449867443).
- Q2 Leaving the terminal by keyboard -> A: (a) F6 / Shift+F6. Paco, 2026-10-27, [#807 comment](https://github.com/three-feathers/agent-durbar/issues/807#issuecomment-6449867443).
- Q3 App shortcuts inside the terminal -> A: (a) the shell gets plain Ctrl/Alt keys; ⌘ (Mac) and Ctrl+Shift (Windows, Linux) shortcuts stay the app's. Paco, 2026-10-27, [#807 comment](https://github.com/three-feathers/agent-durbar/issues/807#issuecomment-6449867443).
- Q4 Quit warning -> A: (a) only when a terminal runs a command (every open terminal on Windows). Paco, 2026-10-27, [#807 comment](https://github.com/three-feathers/agent-durbar/issues/807#issuecomment-6449867443).
- Q5 Message box on the Terminal tab -> A: (a) stays visible. Paco, 2026-10-27, [#807 comment](https://github.com/three-feathers/agent-durbar/issues/807#issuecomment-6449867443).
- Q6 Lobby *Terminal* place -> A: (a) stays decorative. Paco, 2026-10-27, [#807 comment](https://github.com/three-feathers/agent-durbar/issues/807#issuecomment-6449867443).
- Q7 PTY package -> A: (a) `node-pty`, exact pin of the first release with Linux prebuilds. Paco, 2026-10-27, [#807 comment](https://github.com/three-feathers/agent-durbar/issues/807#issuecomment-6449867443).
- Q8 Environment -> A: (a) the user's own environment minus Durbar's and Electron's internals. Paco, 2026-10-27, [#807 comment](https://github.com/three-feathers/agent-durbar/issues/807#issuecomment-6449867443).

### Questions Q9-Q12 (Paco, owner, 2026-10-27; Q10 the agent's default)

- Q9 Closing the pseudoconsole on Windows -> A: (c) **prove it first**: a packaged Windows check (T016) decides between `conpty.dll` (`useConptyDll: true`) and `taskkill` only; until it has, Durbar never calls a node-pty method that forks (FR-037). Paco, 2026-10-27, [#807 comment](https://github.com/three-feathers/agent-durbar/issues/807#issuecomment-6449867443).
- Q10 What "close" ends on macOS and Linux -> A: (a) hang up like any terminal app and say what survives (FR-033). **Not asked**: the agent's default, which the owner may change (coordinator, 2026-10-27).
- Q11 A cap on open terminals -> A: (a) no cap; the memory per terminal is written down. Paco, 2026-10-27, [#807 comment](https://github.com/three-feathers/agent-durbar/issues/807#issuecomment-6449867443).
- Q12 A user-set navigator shortcut without ⌘ or Ctrl+Shift -> A: (a) the shell wins inside the terminal; the keyboard sheet and Settings > Keyboard say so (FR-051). Paco, 2026-10-27, [#807 comment](https://github.com/three-feathers/agent-durbar/issues/807#issuecomment-6449867443).

### Review on #811 (Vikram's agent, 2026-10-27, at 8a555a91): answers to its questions

Technical answers inside the owner's decisions; none changes a product choice. The cap on terminals went to the owner (Q11).

- FR-021 "folder key hash or label"? -> A: **neither**. Main's state carries no folder identification; the window keys its xterm per folder from the room it already shows (`wsKey` of the agent it opened the terminal for). No path or path-derived value crosses IPC (FR-012, FR-021).
- FR-024 is the ack clamped, and reset on a reload? -> A: **yes, both**. An ack larger than the bytes outstanding is clamped to them; the outstanding count is reset, and a paused PTY resumed, when the window reloads or its renderer goes away; output is sent only to a window that attached since its last load (FR-024).
- FR-025 a replay cut inside an escape sequence or after an alternate-screen switch? -> A: the cut moves forward to the next line break, and the window resets its xterm before it writes the replay. A full-screen program (vim, less, top) may still look wrong after a reload until it redraws: an honest limit (FR-025, *Known gaps*).
- Many folders, no cap? -> A: the memory per terminal is written down (*Known gaps*); no cap (Q11 (a), owner).
- Secrets printed in the output? -> A: shown as printed, never masked; a *Known gaps* line says so (Durbar masks nothing because it records nothing).

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
2. **Given** I select Terminal for a folder that has no terminal yet, **Then** one shell starts in that folder, the terminal gets the keyboard focus, and the pane says in one line that this is my own shell, that agents can't see this terminal but my shell may keep its own history file, and that neither the folder's permission mode nor the OS sandbox applies to it (FR-004).
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

1. **Given** the terminal is idle at its prompt, **When** I press its **Close terminal** button, **Then** the terminal is hung up as when a terminal window closes, the shell ends (FR-033 says what can survive) and the pane shows "No terminal running" with a **Start terminal** button.
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
3. **Given** an agent that can read files or run commands (Allow all, or a mode that allows them), **Then** it can still see what any program on the computer can see: my shell's own history file (`~/.zsh_history`, `~/.bash_history`, PSReadLine's history), the processes I started (`ps`, Task Manager) and the effects of my commands on disk. Durbar does not hide those; the pane line and the README say so (FR-004, FR-017).

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
- **A terminal bell**: ignored (no sound, no toast, no notification) (FR-060).
- **Pasting many lines**: passed to the shell as typed; shells with bracketed paste see one paste, and pasted text cannot end that paste early (FR-060). No warning in this version.
- **Links in the output**: inert in this version, also OSC 8 hyperlinks: no question, no window (FR-060; out of scope: opening them in the Browser tab).
- **A program sets the terminal title, writes the clipboard (OSC 52) or asks about the window (CSI t)**: nothing happens (FR-060).
- **A program detaches from the terminal** (`nohup`, `setsid`, `disown`, a dev server that daemonizes): it keeps running after Close terminal, folder removal and quit, as in any terminal app (FR-033).
- **The Browser's native view and overlays (spec 080 FR-008)**: unaffected; the terminal is plain page content, so menus and dialogs draw over it without any cover logic.

## Requirements *(mandatory)*

### Tab and pane

- **FR-001**: A chat of a live top-level session MUST show a **Terminal** tab in the same tablist as Chat and Browser (spec 080 FR-002), after Browser. The tablist keeps one tab stop with roving focus (Left/Right/Home/End) over all its tabs. The Terminal tab exists when the bridge offers the terminal API; the Browser tab keeps its own rule, so a chat may show `Chat | Terminal` only.
- **FR-002**: Selecting Terminal MUST hide the chat log and Previous sessions exactly as the Browser tab does (`.on-browser` rules), show the terminal pane and keep the composer visible (Q5). Selecting Chat or Browser hides the pane; the terminal keeps running.
- **FR-003**: A reopened chat starts on Chat (spec 080 rule `startTab`); a rebuilt panel of the same chat (rename) keeps its tab.
- **FR-004**: The pane MUST have a one-line bar: the folder (shortened path, full path in the tooltip), the shell name, the words "Your own shell: agents can't see this terminal, but your shell may keep its own history file. The folder's mode and the OS sandbox do not apply." (FR-017), a **Close terminal** button, and the leave-key hint. With no terminal running it shows "No terminal running" and **Start terminal** instead of the screen.
- **FR-005**: The Terminal tab's label and accessible name MUST carry the state: nothing (never started or closed), "running" (shell alive), "running a command" (FR-031), "ended" (shell exited by itself). Shown with a word, not colour alone.
- **FR-006**: Opening Notes (spec 083 FR-025) or any action that needs the chat log MUST first switch from Terminal to Chat, as it does from Browser today (`DN.showChatTab`).

### One terminal per folder, lifetime

- **FR-007**: There MUST be at most **one terminal per folder key** (`workspaceFile ?? cwd`, the key main already uses). Every chat of the folder shows the same terminal. A terminal starts only when the user selects the Terminal tab (or Start terminal) for a folder without one; nothing starts at app start or when a chat opens.
- **FR-008**: A terminal MUST keep running when the user switches tab, closes the chat, opens another chat or goes to the office, and while the macOS window is hidden.
- **FR-009**: A terminal MUST end only by: its Close terminal button (FR-030), the shell exiting by itself, the folder's removal (`folders:remove`), or the app quitting. Ending hangs up the terminal and ends the shell (FR-033, FR-035, FR-037); FR-033 lists what can survive. After an end the folder may start a new terminal; the old screen is dropped when a new one starts.

### Shell, folder, environment (constitution III, VI)

- **FR-010**: The shell (D1) MUST be chosen by a pure function with an injected environment, testable on every OS:
  - **macOS, Linux**: `$SHELL` when it is an absolute path to an existing executable file that is either listed in `/etc/shells` or named like a known shell (the `loginShellCommand` set plus `tcsh`, `csh`, `nu`, `elvish`, `xonsh`, `pwsh`); otherwise `/bin/bash` if it exists, else `/bin/sh`. Arguments: `['-l']` on macOS (a login shell, as Terminal.app starts one), `[]` on Linux (an interactive shell, as Linux terminal apps start one). *[unverified: that every listed shell accepts `-l`; FR-010 tests the argv only.]*
  - **Windows**: PowerShell 7 (`pwsh.exe`) when found on `PATH` (absolute result of the existing `pathDirs` lookup), else Windows PowerShell at `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`, else `windowsCmd(env)` (`cmd.exe`, the `COMSPEC` rule of spec 045). Arguments: `['-NoLogo']` for PowerShell, `[]` for cmd.
- **FR-011**: The shell MUST be spawned with an **argument array** and the folder as `cwd`; Durbar never builds a command string, never runs anything through another shell, and never writes text into the terminal on the user's behalf (no startup command, no `cd`). What the user types reaches the PTY as keystrokes, exactly as in any terminal app.
- **FR-012**: The working folder MUST be looked up in main from the agent id (constitution III: paths are looked up by agent id); the renderer never sends a path. For a workspace it is the first listed folder (D3). A folder that does not exist is refused with a message (edge case).
- **FR-013**: The environment MUST be built by a pure function from a **snapshot of `process.env` taken when main starts** (where: the last point below), with the login PATH of spec 060 applied, and then:
  - dropped: every `DURBAR_*` variable (dev hooks, spec 010), every `ELECTRON_*` and `CHROME_*` variable, `ORIGINAL_XDG_CURRENT_DESKTOP` (and `XDG_CURRENT_DESKTOP` restored from it on Linux), `GOOGLE_API_KEY` / `GOOGLE_DEFAULT_CLIENT_ID` / `GOOGLE_DEFAULT_CLIENT_SECRET` (Chromium's), and the simulator's `TZ` when the simulator clock set it;
  - set: `TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=AgentDurbar`, `TERM_PROGRAM_VERSION=<app version>`, and on macOS `LANG=<locale>.UTF-8` only when no `LANG`/`LC_ALL`/`LC_CTYPE` is set (an app opened from Finder has none);
  - kept: everything else the user's own session had (Q8).
  - **where the snapshot is taken**: a statement at the top of `main.ts` is too late, because `main.ts` starts with 114 static `import` lines (`src/main/main.ts:1-114`: `./browser/views`, `./ipc/agents`, `../adapters/registry`, ...) and the project compiles to CommonJS (`tsconfig.json` `"module": "CommonJS"`), so every imported module runs before main.ts's first statement. The snapshot is a new side-effect-free module `src/main/envsnapshot.ts` that imports nothing and exports a frozen copy (`Object.freeze({ ...process.env })`), and it MUST be the **first** `import` of `src/main/main.ts` (a value import, so TypeScript never drops it). A test pins it: the first `import` line of `main.ts` is the snapshot's, `envsnapshot.ts` has no `import` or `require`, and the export is frozen.
  The snapshot guarantees that nothing an SDK or adapter adds to `process.env` later reaches the terminal. Values are never logged. *Durbar itself holds no token in its environment today (`read:` grep of `src/` for `process.env` writes, 2026-10-27); the snapshot rule keeps it that way if a dependency ever adds one.*
- **FR-014**: No terminal input or output MUST be **logged, saved or sent** anywhere: not to the `DURBAR_LOG` sink, not to stderr, not to crash markers, not to `localStorage`, not to any file. Scrollback lives in memory only (the renderer's xterm buffer, capped at 5,000 lines, and main's replay buffer, FR-025) and is gone when the terminal ends or the app quits.

### User-only (owner decision)

- **FR-015**: The terminal MUST NOT be reachable by agents: no `AgentAdapter` member, no normalized event, no Durbar MCP tool (spec 041), no remote-control path (spec 054), no schedule (spec 044), no session summary (spec 085), no activity row, no Notes entry. A static test MUST fail when a terminal module is imported from `src/adapters`, `src/main/mcp`, or any IPC module other than the terminal's own (FR-042).
- **FR-016**: Copy MUST put the selection on the system clipboard only. Nothing from the terminal is inserted into the message box or a chat automatically.
- **FR-017**: Durbar MUST NOT claim more than it does. "Agents can't see it" means: Durbar gives no agent, adapter, MCP tool or chat the terminal's input or output (FR-014, FR-015). It does not mean the shell is hidden on the computer:
  - the user's shell may write its own history file (`~/.zsh_history`, `~/.bash_history`, PSReadLine's `ConsoleHost_history.txt`), and its processes show in `ps` and Task Manager; an agent that can read files or run commands can see those and the commands' effects;
  - **the OS sandbox does not apply**: the agent apps' own OS sandbox (spec 087) and the permission modes (spec 003) confine agents only; the terminal runs with the user's full rights, also in a Read-only, sandboxed folder.
  The pane line (FR-004) and the README's *Safety model* sentence (FR-043) say both.

### Closing, quitting, removal

- **FR-030**: **Close terminal** ends the terminal at once when the shell is at its prompt; when a foreground command runs (FR-031) it asks first through the shared `askDialog` (Cancel focused).
- **FR-031**: "A command is running" means the PTY's foreground process is not the shell itself (node-pty's `process` name differs from the shell's). On Windows this cannot be told reliably, so every open terminal counts as running a command there. `[KNOWN GAP]` on Windows: the question appears for an idle terminal too.
- **FR-032**: The quit question (spec 052 FR-090, `confirmQuit`) MUST also count terminals with a running command ("1 agent is working and 1 terminal is running a command"). It asks once, Cancel is the default, and the same answer covers the window's close on Windows and Linux. Idle terminals end without a question (Q4).
- **FR-033**: Ending a terminal MUST **hang it up**, as closing a terminal window does, and MUST NOT claim to kill more than that reaches. It is a pure, tested function with injected kill, timer and platform (`src/main/terminal/kill.ts`):
  - **macOS and Linux**: close the PTY master (node-pty's `destroy()`, which then sends `SIGHUP` to the shell, `lib/unixTerminal.js:217-226` in 1.2.0-beta.18, `read:`). The kernel then hangs up the terminal: `SIGHUP` to the shell (the session leader) and to the terminal's foreground process group, and interactive bash and zsh resend `SIGHUP` to their jobs before they exit. After **2 s**, if the shell has not exited, `SIGKILL` to the shell's process group (`-pid`: the shell leads its own session, so its group id is its pid).
  - **pid reuse guard (#721)**: `IPty` has no `exitCode` or `signalCode`, so the terminal wrapper keeps an `exited` flag set by `onExit`; the 2 s `SIGKILL` (and on Windows the tree kill, FR-037) is skipped once it is set, because the pid or group id may already belong to another process. The same guard as `killChildTree` (`src/adapters/detect.ts:423`, the check before its `SIGKILL`).
  - **What can survive** (`[KNOWN GAP]`, the same as in Terminal.app, GNOME Terminal or VS Code): an interactive shell with job control puts every job in **its own process group**, so the 2 s `SIGKILL` to the shell's group does not reach them; a job or program that ignores or handles `SIGHUP`, anything started with `nohup`, `setsid` or `disown`, a program that daemonizes (many dev servers), background jobs of a shell set not to forward the hang-up (zsh `NO_HUP`, fish), and jobs of a shell that was `SIGKILL`ed before it could forward the hang-up. Killing every process of the shell's session (every group in its session id) is not done in this version: it needs a process list per OS (`ps` or `/proc`) (Q10 (a), the agent's default; the owner may change it).
  - **Windows**: FR-037.
- **FR-034**: *Remove folder* (`folders:remove`) MUST end the folder's terminal; the renderer's confirm text (`removeFolder()`) names a running command.
- **FR-035**: **Quit path.** A 2 s timer in `will-quit` never fires (the process is about to exit, and `killChildTree`'s own timer is `unref`'d), so terminals are ended in `before-quit` (`src/main/main.ts:1112`), after the quit is confirmed, in the same capped wait the agents and remote control already use (`capped`, `main.ts:1138`): every terminal is hung up (FR-033, FR-037), main waits until every shell has exited or **2 s** pass, then sends the guarded `SIGKILL` (POSIX) to every shell not seen exiting, then quits. `will-quit` (`main.ts:1144`) keeps only a last synchronous pass for a terminal that is still open there: the guarded `SIGKILL` (POSIX) or the tree kill (Windows), no timer. What survives a quit is what survives a close (FR-033).
- **FR-036**: **Main crash.** Nothing in Durbar runs when main dies, so this is what the OS does, written down honestly: on macOS and Linux the kernel closes the PTY master with the process, which hangs up the terminal exactly as FR-033's first step (the same survivors; no 2 s `SIGKILL`). On Windows the pseudoconsole's handles close with the process; the console host then ends and the processes attached to that console are ended too `[unverified]`; a process with its own console or window, or started detached, survives. Checked on real machines only (research R7).
- **FR-037**: **Windows end path without node-pty's fork.** In node-pty 1.2.0-beta.18 with the default `useConptyDll: false`, `kill()` and `destroy()` call `_getConsoleProcessList()`, which runs `child_process.fork(.../conpty_console_list_agent)` (`lib/windowsPtyAgent.js:193-240`, `read:` from the tarball, 2026-10-27). From the packaged main that fork starts the Electron binary itself; with the `runAsNode` fuse off (`package.json:283`, `scripts/check-fuses.js:16`) it cannot run as Node, so it may start a **second app instance** (Durbar has no single-instance lock: no `requestSingleInstanceLock` in `src/`, `read:` grep) `[unverified]`; node-pty then waits 5 s and kills only the shell pid. Therefore on Windows Durbar MUST NOT call a node-pty method that forks. Ending a terminal on Windows:
  1. `killChildTree` on the shell's pid (`src/adapters/detect.ts:423`: `taskkill /pid <pid> /t /f` from System32, argv only), through the wrapper of FR-033 so its exit guard applies (skipped once the shell exited);
  2. then the pseudoconsole is closed by the path the packaged Windows check picks (Q9 (c), owner: **prove it first**; T016 gates the choice between (a) `useConptyDll: true` and (b) `taskkill` only). Until T016 has proven a path, the rule above stands: no forking node-pty call on Windows. Option (a)'s `kill()` closes the input handle and the pseudoconsole and does not fork, `lib/windowsPtyAgent.js:214-221`, `read:`).
  What survives: a process whose parent already ended (so `taskkill /t` cannot find it through the parent chain), or one started in its own console or window (`start`, `Start-Process`) `[KNOWN GAP]`. The packaged check (FR-042, T016) ends a terminal running a child on Windows and asserts: the shell and the child are gone within 10 s, and no second app process started. Until it passes, FR-037 is `[unverified]` (research R2).

### Data path and IPC (constitution III)

- **FR-020**: The renderer MUST talk to terminals only through a narrow preload API (names in the plan): open, input, resize, close, ack, state, and two events (data, state). Every handler is `fromApp`-checked (`ipcHandle`; `ipcOn` for the invoke-less `input`). Only **open** and **state** take an **agent id**, which main maps to its folder key; **input, resize, ack and close** take the **terminal id** (`tid`) that open returned, and main refuses an unknown `tid`. Every value is validated (input a string at most 64 KB per call; columns 2-500, rows 1-300 as integers; ack a non-negative integer, clamped by FR-024).
- **FR-021**: Main MUST answer with a terminal id it generated (random, not a path) and a state `{tid, open, exited, exitCode, busy, processName, shell}` (`shell` and `processName` are base names such as `zsh` or `npm`, never paths); the state carries **no folder identification**: the window keys its xterm per folder from the room it already shows (review on #811). Output events carry the `tid` and text only.
- **FR-022**: Output MUST reach the renderer in batches (at most one message per 16 ms per terminal, at most 64 KB each).
- **FR-024**: Flow control: when more than 256 KB of output is unacknowledged by the window, main MUST pause the PTY and resume it below 64 KB, so a flood cannot grow memory without bound. And:
  - an ack MUST be clamped to the bytes actually outstanding (a larger value counts as "all of it"; it never makes the count negative);
  - output is sent only to a window that **attached** to that terminal (`terminal:open`) since the window's last load; when the window reloads, navigates to another document or its renderer goes away (`did-start-navigation` of the main frame **with `isSameDocument` false**, so a hash or `pushState` change inside the page never detaches a terminal; `render-process-gone`), every terminal is marked not attached, its outstanding count is reset to 0 and a paused PTY is resumed, so a reload can never leave a shell paused forever; while not attached, output only fills the replay buffer (FR-025), which is capped;
  - tests: an ack above the outstanding bytes, a negative or non-integer ack (refused), a reload while paused (resumed), output while not attached (only the replay buffer grows, and it stays capped).
- **FR-025**: Main MUST keep a replay buffer per terminal (the last 256 KB of output, memory only) and send it when a window attaches to a running terminal (after a reload or crash). When the buffer is cut, the cut moves forward to the next line break, so it does not start inside an escape sequence; the window calls xterm's `reset()` before it writes the replay. A full-screen program (alternate screen: vim, less, top) may look wrong after a reload until it redraws (Ctrl+L): `[KNOWN GAP]`. The buffer is dropped when the terminal ends.
- **FR-026**: Terminal events (`terminal:data`, `terminal:state`) MUST go **only to the app window**: through the app window's own `webContents.send` (`toRenderer`, `src/main/main.ts:217`), handed to the terminal's IPC module as its only way out. Never `BrowserWindow.getAllWindows()`, `webContents.getAllWebContents()` or any broadcast, and never the spec 080 browser views (web pages: `src/main/browser/views.ts:230`), which get no preload at all (`viewWebPreferences`, `src/main/hardening.ts:71`) and so no terminal API; their senders also fail `fromApp` for the terminal channels. Tests: a static test that `src/main/terminal/**` and `src/main/ipc/terminal.ts` contain none of those calls and no `webContents` reference, a `main.ts` wiring test that the module gets `toRenderer`, and a test that `viewWebPreferences` has no `preload` key.

### Display, accessibility, platforms (constitution V, VI)

- **FR-050**: The terminal MUST use xterm.js with **`screenReaderMode: true`**, a font size of at least **10.5px** (default 13px, following the chat text size where it is larger), colours from the theme's semantic tokens for background, foreground, cursor and selection (no theme-specific size, `test:theme`), and a contrast of at least 4.5:1 between foreground and background in every built-in theme.
- **FR-051**: Keyboard policy while the terminal has focus (Q3): every key goes to the shell **except**: the leave keys (F6 and Shift+F6, Q2); on macOS, every ⌘ combination (⌘C copy, ⌘V paste, ⌘K palette, ⌘F Go to, ...); on Windows and Linux, every `Ctrl+Shift+<key>` combination (`Ctrl+Shift+C` copy, `Ctrl+Shift+V` paste, the app's inbox A, next N, schedules S, previous sessions H, notes M; an unused one does nothing). Plain `Ctrl+<letter>`, `Ctrl+Backquote`, `Alt+<letter>`, `Esc`, `Tab`, `F2` and `PageUp/PageDown` go to the shell. The keyboard help sheet lists these rules.
  - **The navigator shortcut is the user's choice** (Settings > Keyboard, spec 074 FR-002; default Ctrl+F, ⌘F on a Mac; `NAV.comboMatches`, `src/renderer/app.js:3067`; allowed combinations `clashOf`, `src/renderer/navigator.js:187`). Inside the terminal it follows the same rule as every other key: a combination with ⌘ (Mac) or Ctrl+Shift (Windows, Linux) opens Go to; any other (the default Ctrl+F on Windows and Linux, or a user-set `Ctrl+<key>` or `Alt+<key>`, or on a Mac `⌃<key>` or `⌃⌥<key>`) goes to the shell, and Go to opens from anywhere outside the terminal (Q12 (a), owner). The keyboard sheet and the Settings > Keyboard row say: "Inside the terminal, Ctrl and Alt keys go to the shell." (FR-056)
- **FR-052**: Focus: selecting the tab with the keyboard keeps focus on the tab; Enter, Space or Tab from the tab moves focus into the terminal; a click in the pane focuses it; the leave key returns to the Terminal tab. `focus()` calls use `preventScroll` (`innerscroll.js` rule, `test:innerscroll`).
- **FR-053**: The office is unaffected: the terminal lives in the chat panel, which already covers the office; the 15-agent rule (spec 001) and `check:office` results MUST NOT change.
- **FR-054**: The pane MUST fit the chat panel at 1440x900, 1280x800 and the 480px narrow panel without page overflow, with at least 8 terminal rows visible at 1280x800 with the composer at its default height.
- **FR-055**: Windows, macOS and Linux behave the same through the same code; OS differences are only in FR-010 (shell), FR-031 (busy), FR-033/FR-037 (end) and FR-051 (⌘ or Ctrl+Shift), each a pure function with an injected platform. A static test fails when `process.platform` is read anywhere in `src/main/terminal/**` or `src/renderer/termpane.js` outside the injection point.
- **FR-056**: **The key guard covers every keydown listener**, not only the global handler at `app.js:3060`. The page has these `document`/`window` keydown listeners today (`read:` grep, 2026-10-27): `app.js:477` (capture phase, Shift+F10 on a coffee figure), `:3060` (global keys: Esc, Ctrl+K, the navigator, Ctrl+O, Ctrl+Backquote, F2, ...), `:3940` (spec 092 floors, PageUp/PageDown), `:5762` (Shift+F10 on a desk), `:7341` (Shift+F10 on a previous session), `:7411` (Enter in the floors pop-over), `dialog.js:76` and `screens.js:559`, `:780` (capture phase, only while a dialog, the theme try-bar or the shortcut recorder is open). `browserpane.js:282`, `:298` are on the Browser tab's own elements. The guard:
  - xterm's `attachCustomKeyEventHandler` returns `false` for the app's keys (FR-051), so xterm leaves them and they reach the app's handlers as today;
  - for every key that goes to the shell, a `keydown` listener on the terminal's host element (`#termView`, bubble phase, after xterm's own textarea listener) calls `stopPropagation()`, so no bubble-phase `document` listener (`:3060`, `:3940`, `:5762`, `:7341`, `:7411`) sees it;
  - the capture-phase listeners run before it, and each acts only on its own target (`:477`: `#stage [data-coffeeid]`, never inside the panel) or while its own modal UI owns the focus (`dialog.js`, `screens.js`); the driver checks that Esc in the terminal with no dialog open reaches the shell;
  - a static test lists every `document`/`window` `keydown` listener in `src/renderer/**` and fails on one that is not in its list with a reason, so a future global handler must say how it treats the terminal;
  - driver cases (FR-042): PageUp/PageDown, Ctrl+Backquote, Ctrl+F (Windows/Linux default navigator key), Esc and Tab inside the terminal reach the fake shell (its input log shows them) and change neither the floor, the open chat, the focus nor the palette; ⌘K / Ctrl+Shift+A still work from the terminal.

### Emulator safety: escape sequences and paste (constitution III)

- **FR-060**: What a program prints into the terminal MUST NOT reach the app, the clipboard, the window or another program, and pasted text MUST NOT break out of a bracketed paste. xterm.js 6.0.0's defaults are not enough for this (`read:` from the tarball, 2026-10-27), so the terminal's options are built by one pure, tested function (`terminalOptions()` in `termpane.js`) and:
  - **links are inert**: `linkHandler` is a no-op handler (`activate` does nothing, `allowNonHttpProtocols: false`). With the default `linkHandler: null`, an **OSC 8** hyperlink's click calls `confirm("Do you want to navigate to <url>?")` and then `window.open()` (`src/browser/OscLinkProvider.ts:89`, `:114-120`); the app window's open handler denies the window (`src/main/main.ts:898`), but the question would still show a program-chosen address. No web-links addon is loaded, so plain URLs are plain text;
  - **no clipboard writes from output**: no clipboard addon is loaded; xterm's core has no OSC 52 handler (its OSC handlers are 0, 1, 2, 4, 8, 10-12, 104, 110-112: `src/common/InputHandler.ts:292-331`), so OSC 52 does nothing;
  - **titles are ignored**: `onTitleChange` (OSC 0, 1, 2 and the CSI 22/23 t title stack) is never subscribed; the title never reaches `document.title`, the tab, the bar or an accessible name;
  - **no window reports**: `windowOptions` stays at its all-off default (`{}`), so CSI t requests (window size in pixels or characters, `InputHandler.ts:2840-2885`) are not answered and do nothing; colour queries (OSC 4, 10-12) are answered with the theme's colours, which is standard terminal behaviour and reveals nothing else;
  - **bell ignored**: `onBell` is never subscribed (no sound, toast or notification);
  - **paste cannot end the bracketed paste early**: xterm 6.0.0 wraps a paste as `ESC[200~` + text + `ESC[201~` without cleaning the text (`src/browser/Clipboard.ts`, `bracketTextForPaste`, `read:`), so a pasted `ESC[201~` would end the paste and the rest would run as typed keys. The pane handles the paste event itself: one `paste` listener on its host element `#termView` in the **capture phase**, which calls **both `preventDefault()` and `stopPropagation()`**, then `term.paste(cleanPaste(text))`. Both calls are needed (review on #811): xterm 6.0.0 registers its own paste handler in the **bubble phase on two elements below `#termView`**, its hidden textarea and its root element (`src/browser/CoreBrowserTerminal.ts:342-344`, `addDisposableListener` without `useCapture`; `term.open(#termView)` appends that root inside `#termView`, `:421`), and its `handlePasteEvent` never checks `defaultPrevented` (`src/browser/Clipboard.ts`). With `preventDefault()` alone xterm still pastes the raw text, so the `ESC[201~` breakout comes back and the text is pasted twice; `stopPropagation()` at `#termView`'s capture step keeps the event from ever reaching xterm's listeners. The pure `cleanPaste` removes every `ESC[200~` and `ESC[201~` (and the 8-bit `U+009B` forms `\u009b200~`, `\u009b201~`), **repeating until none is left** (removing one may join the halves of another);
  - **tests**: `test:termpane` checks `terminalOptions()` (link handler inert, no `windowOptions` key set to true, no addon but fit), a static check that `termpane.js` never subscribes `onTitleChange` or `onBell` and loads no addon other than `FitAddon`, and `cleanPaste` on a hostile matrix (one marker, both markers, nested `ESC[20ESC[201~1~`, 8-bit forms, text without markers unchanged). The driver (FR-042) runs the fake shell's escapes command, which prints an OSC 8 link, an OSC 52 write, OSC 0/2 titles, CSI 14 t / 18 t and a bell, then asserts: clicking the link opens no question (the window's `confirm` replaced by a counter) and no window; the system clipboard still holds a marker the driver put there; `document.title` and the tab's name are unchanged; the fake PTY received no input in reply to CSI t; and a paste of `a ESC[201~ b` with bracketed paste on reaches the fake PTY **exactly once**, as exactly `ESC[200~a b ESC[201~` (spaces only for reading here): the raw text never arrives, which catches a guard that calls `preventDefault()` without `stopPropagation()` (a double paste and the breakout). A `test:termpane` static case checks that the paste listener is registered on `#termView` with `capture: true` and calls both.

### Simulator and tests (constitution IV, VII)

- **FR-040**: Under the simulator (`DURBAR_SIM`) main MUST use a **fake PTY** (a scripted shell with a prompt, echo, a few fixed commands, a long-running command for the quit question, a command that prints the FR-060 escape sequences, `exit`) and MUST NOT load node-pty or start any process. The terminal channels are added to `SIM_OPEN_CHANNELS` with their reason; under the simulator the controller accepts simulated agent ids and a simulated folder key (`simKey`) from the window (harmless: the fake PTY never touches a path). **Outside the simulator `simKey` MUST be ignored**: the folder comes only from the agent id (FR-012), and an unknown agent id is refused even with a `simKey` (test).
- **FR-041**: The terminal controller MUST take its PTY factory, clock and killer as injected dependencies so every rule (one per folder, lifetime, removal, quit count, caps, flow control, replay, no logging) is tested in Node with a fake PTY; CI never needs a real shell for `npm test`.
- **FR-042**: Tests: unit tests for the shell choice, the environment, the start-up snapshot (FR-013), the kill and quit rules (FR-033, FR-035, FR-037), the controller, the renderer helpers (tab model, key policy, label words, terminal options and paste cleaning, FR-060) and the static user-only and app-window-only rules (FR-015, FR-026); a simulator driver for the tab at 1440x900 and 1280x800 and the narrow panel; `test:ipcchannels` and `test:simguard` updated; the packaged check (nightly and on demand) loads node-pty from the packaged app and runs one fixed, harmless command through it on each OS, and on Windows also ends a terminal that runs a child (FR-037).
- **FR-043**: Docs: README (feature list; *Safety model*: the terminal is your own shell, not governed by the permission modes **or the OS sandbox** (spec 087), agents can't see it through Durbar, but your shell may keep its own history file and its processes are visible like any other (FR-017); known limits, including what survives a close (FR-033)), keyboard help, a `changelog.d/` fragment, the screenshots (`npm run shots:docs` for every linked picture that shows the chat panel), and dated `## Changes` lines in spec 080 (the tablist now has three tabs) and spec 052 (quit question, keyboard sheet).

### Key Entities

- **Terminal**: one per folder key; a PTY with a shell, a terminal id, a state (open, busy, process name, exited, exit code), a replay buffer in memory.
- **Terminal pane**: the tab's view of the folder's terminal in a chat; the xterm instance per folder lives in the window and is re-attached on every panel rebuild (as `getChat()` keeps chat logs).

## Success Criteria *(mandatory)*

- **SC-001**: In the simulator, selecting Terminal shows a working prompt in under 1 s, and two chats of one folder show the same terminal in 100% of driver runs; chats of different folders never share one.
- **SC-002**: Leaving the tab, closing the chat and going to the office never end a terminal (driver: the fake long command still prints when the tab is shown again).
- **SC-003**: The quit question names terminals with a running command, and only those (unit test of the count; driver with the fake long command).
- **SC-004**: No terminal output appears in any file under the profile folder, in the `DURBAR_LOG` sink or on stderr after a driver run that printed a marker string (the driver greps for it).
- **SC-005**: Terminal text is at least 10.5px and the pane fits at 1440x900, 1280x800 and the narrow panel with no page overflow; `check:office` is unchanged.
- **SC-006**: A packaged build on each OS loads the PTY module and runs one fixed command (packaged check), before the feature is called built for that OS; on Windows the same check ends a terminal running a child with no second app process (FR-037).
- **SC-007**: Every FR-060 sequence fed through the fake shell does nothing outside the terminal's own screen (no question, window, clipboard change, title change or reply), and a paste with an embedded `ESC[201~` reaches the shell inside one bracketed paste (unit tests and driver).
- **SC-008**: PageUp/PageDown, Ctrl+Backquote, Ctrl+F, Esc and Tab typed in the terminal reach the fake shell in 100% of driver runs and change neither the floor, the chat, the focus nor the palette (FR-056).

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
- `[KNOWN GAP]` "Agents can't see it" is about Durbar only (FR-017): the user's shell may keep its own history file, and its processes and their effects are visible to any program, an agent with file or shell access included. The OS sandbox and the permission modes do not apply to the terminal.
- `[KNOWN GAP]` Closing, removing the folder or quitting hangs the terminal up; jobs in their own process group that ignore `SIGHUP`, and detached programs (`nohup`, `setsid`, `disown`, daemonizing dev servers), keep running (FR-033); on Windows, processes outside the shell's parent chain or with their own console survive (FR-037). Q10 (a) (the agent's default; the owner may change it): no kill by session.
- `[KNOWN GAP]` The Windows end path (FR-037) and what a main crash leaves running on Windows (FR-036) are `[unverified]` until the packaged check and a real machine show them.
- `[KNOWN GAP]` Secrets the user's commands print (a token from `env`, a `.env` from `cat`) are shown as printed and are visible in screen sharing and screenshots. Durbar masks nothing in the terminal because it records nothing (FR-014).
- `[KNOWN GAP]` After a window reload a full-screen program may look wrong until it redraws (FR-025).
- `[KNOWN GAP]` No cap on the number of terminals (one per folder, each started by the user). Estimated memory per terminal: 256 KB of replay in main plus xterm's buffer in the window (5,000 lines; about 7 MB at 120 columns if every line is full, `[unverified]` estimate from xterm's cell size), plus the shell and what it runs. No cap (Q11 (a), owner).

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

Q1-Q8 are answered (all (a), *Clarifications*). From the review on #811 (answers in *Clarifications*):

9. **Q9 Closing the pseudoconsole on Windows** (FR-037; node-pty's `kill()` forks with the default): (a) **`useConptyDll: true`**: ship node-pty's `conpty.dll` and `OpenConsole.exe` (about +1.2 MB on the Windows installer, research R2), whose `kill()` does not fork; `taskkill /t /f` first (recommended); (b) keep the OS's ConPTY and never call `kill()`: only `taskkill`, and node-pty's exit path closes its pipes but not the pseudoconsole (`_cleanUpProcess`), so a console host may stay until quit `[unverified]`; (c) keep `kill()` and prove in the packaged check that the fork works with `runAsNode` off (expected to fail). -> A: (c), Paco, 2026-10-27, [#807 comment](https://github.com/three-feathers/agent-durbar/issues/807#issuecomment-6449867443): T016 decides between (a) and (b).
10. **Q10 What "close" ends on macOS and Linux** (FR-033): (a) **hang up the terminal like any terminal app, then `SIGKILL` the shell's group; say plainly that detached programs and `SIGHUP`-ignoring jobs survive** (recommended: same as Terminal.app and VS Code, no process list needed); (b) also kill every process group in the shell's session (a `ps`/`/proc` lookup per OS, more code and more to test; still misses `setsid` and daemons). -> A: (a), the agent's default (not asked; the owner may change it).
11. **Q11 A cap on open terminals**: (a) **no cap; the memory per terminal is written in *Known gaps* and the README** (each terminal is one the user started) (recommended); (b) at most 10 open terminals; Start terminal on an 11th folder says "Close a terminal first" and names the open ones. -> A: (a), Paco, 2026-10-27, [#807 comment](https://github.com/three-feathers/agent-durbar/issues/807#issuecomment-6449867443).
12. **Q12 A user-set navigator shortcut without ⌘ or Ctrl+Shift** (spec 074, FR-051): (a) **the shell wins inside the terminal** (like the default Ctrl+F on Windows and Linux); the keyboard sheet and Settings > Keyboard say so (recommended); (b) the navigator shortcut always wins, also inside the terminal (that key then never reaches the shell). -> A: (a), Paco, 2026-10-27, [#807 comment](https://github.com/three-feathers/agent-durbar/issues/807#issuecomment-6449867443).

## Changes

### 2026-10-29: index status text kept from before the fixed status words (spec 021 FR-063)

The `status:` of the specs-index block used to read (moved here unchanged; the block now has one status word and a short note):

> Draft (2026-10-27): spec, plan, research and tasks; owner decisions of 2026-10-27 recorded; Q1-Q8, Q9, Q11, Q12 answered by the owner and recorded on #807; Q10 the agent's default (a), changeable by the owner; review on #811 applied; nothing built


(none yet)

# Feature Specification: VS Code integration (open folder, read-only chat history)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: index
title: Open in VS Code, VS Code chat history (read-only)
status: built
note: open: real launch and VS Code store checks on macOS and Windows (T022-T025)
-->

**Feature Branch**: `009-vscode-integration` (reverse-engineered; milestones 1, 6 and packaging)
**Created**: 2026-10-16
**Status**: Implemented (reverse-engineered from `src/main/vscode.ts`, `src/adapters/vscodeChat.ts`, `main.ts`, README, `docs/research.md`)
**Input**: "Open an agent's folder in VS Code in one click, and show the VS Code Copilot Chat history of a folder as a read-only copy."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open in VS Code (Priority: P1)

In the chat header **Open in VS Code** opens the agent's folder (or its `.code-workspace` file) in VS Code, on macOS, Windows and Linux, even when the app was started from Finder/Start menu and has no shell PATH.

**Independent Test**: `npm run test:vscode` (launch planning with injected file systems for all three OSes). Starting VS Code for real: not run on this box (no VS Code).

**Acceptance Scenarios**:

1. **Given** macOS with `code` missing from PATH but VS Code in `/Applications`, **When** I click it, **Then** the bundled `code` binary is used. *(test:)*
2. **Given** Windows with a per-user install, **When** I click it, **Then** `Code.exe` is spawned directly with the path as one argument. *(test:)*
3. **Given** VS Code is not installed, **When** I click it, **Then** a toast explains how to install it. *(test:; text read:)*
4. **Given** a Windows path with `&`, `"`, `%`, `|`, `^` and only `code.cmd` available, **When** I click it, **Then** the launch is refused rather than passed to `cmd.exe`. *(test:)*

---

### User Story 2 - Read VS Code chat history of a folder, read-only (Priority: P2)

In **Previous sessions**, "VS Code chat history" lists chats VS Code saved for this folder; **View** shows a read-only copy with a banner "cannot be continued here".

**Acceptance Scenarios**:

1. **Given** a folder VS Code opened and chatted in, **When** I open the panel, **Then** chats appear newest first with title, date and message count. *(test: with synthetic fixtures; real VS Code stores not read on this box)*
2. **Given** a chat file with unknown parts, a half-written last line, an old flat `.json`, an unknown format version or a huge transcript, **When** viewed, **Then** it shows what is understood plus an honest note, never throws. *(test:)*
3. **Given** VS Code never opened the folder, **When** listed, **Then** the panel says so and offers nothing. *(read:)*

---

### Edge Cases

- `.jsonl` wins over `.json` for the same chat id; empty chats are hidden; reasoning and unsent input are never shown. `[IMPLEMENTED]` test:
- Folders are matched through each store's `workspace.json` (`folder` or `workspace` URI), percent-decoded, case-folded on Windows/macOS; remote URIs (`vscode-remote:`, `vscode-vfs:`) are not matched. `[IMPLEMENTED]` test:
- Limits: files over 64 MB are skipped (counted), at most 150 chats listed, 300 messages and 20,000 characters per text shown, 1.5 M characters per transcript. `[IMPLEMENTED]` test: (some) / read:
- Content is never logged, uploaded or executed; links in transcripts are shown as plain text. `[IMPLEMENTED]` read:

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** `[IMPLEMENTED]` test: `openInVSCode(target)` accepts only an absolute path without NUL, builds a plan per platform (`planVSCodeLaunch`) and spawns `{shell:false, detached, stdio:'ignore'}`; on Windows the only `cmd.exe` route is `code.cmd` and is refused when the path or the `.cmd` file contains cmd metacharacters.
- **FR-002** `[IMPLEMENTED]` test: Discovery order: macOS: PATH, app bundle (system and user Applications), Homebrew, `/usr/local/bin`; Windows: `Code.exe` in user/system/x86 installs, then `Code.exe` next to `code.cmd` on PATH, then `code.cmd`; Linux: PATH, `/usr/bin`, `/usr/local/bin`, `/snap/bin`, `/usr/share/code/bin`. Relative PATH entries are ignored.
- **FR-003** `[IMPLEMENTED]` read: The renderer sends only an agent id; main resolves the workspace file or folder of an agent *it started*.
- **FR-004** `[IMPLEMENTED]` test: Chat stores are looked up under `User/workspaceStorage/<hash>/chatSessions/*.jsonl|json` for `Code`, `Code - Insiders` and `VSCodium` in the OS user-data folders (macOS `~/Library/Application Support`, Windows `%APPDATA%`, Linux `$XDG_CONFIG_HOME` or `~/.config`). `DURBAR_VSCODE_USER_DIR` overrides for tests.
- **FR-005** `[IMPLEMENTED]` test: Parsing is tolerant: append-log (`.jsonl`, VS Code 1.109+ format "version 3") and flat JSON; notes for unreadable lines, unknown part kinds, unknown/missing format versions and truncation; the format note is always shown.
- **FR-006** `[IMPLEMENTED]` read: IPC `vschat:list` / `vschat:read` use opaque keys remembered per agent; the renderer never supplies a path.
- **FR-007** `[IMPLEMENTED]` read: **Copy resume command** puts `copilot --resume <id>` on the clipboard and says to end the session here first and to switch on the VS Code sessions filter "External".
- **FR-008** ~~`[KNOWN GAP]`~~ closed 2026-10-21 (see Changes): **README says Cursor is read too** ("also Insiders, VSCodium, Cursor") but the code lists only `Code`, `Code - Insiders`, `VSCodium` (`vscodeUserDirs`). Either the code or the README is wrong. `read:` (Task T020.)
- **FR-009** `[IMPLEMENTED]` (2026-10-19, FR-015) Was a known gap: "Open in VS Code" started only stable `code`; users with only VS Code Insiders or VSCodium get "VS Code was not found". `read:` (Task T021.)
- **FR-010** `[KNOWN GAP]` Not covered: portable-mode VS Code data, Flatpak/Snap config locations, remote/WSL/Dev Container workspaces, VS Code profiles' separate stores, and empty-window chats. `read:`
- **FR-011** `[KNOWN GAP]` The VS Code store format is **undocumented**; the reader follows VS Code sources and third-party readers and was only run on **synthetic fixtures** in `scripts/fixtures/vscode-fixture.ts`, never on a real store. It can break with any VS Code update (stated to the user in the UI). (Feature 013.)
- **FR-012** `[KNOWN GAP]` That sessions this app creates appear in VS Code's session list (with the "External" filter) is **documented by VS Code, not verified** end to end (no signed-in VS Code on the box). The README says so. Pushing our session into the VS Code *Local* chat view is not possible.
- **FR-013** `[KNOWN GAP]` `code` is not launched with `--reuse-window`/`--new-window` choices; VS Code's own default applies. `read:`
- **FR-014** `[KNOWN GAP]` The real `spawn` of VS Code on macOS and Windows was never run by a person; only plan construction is tested. (Task T022.)

### Key Entities

- **LaunchPlan**: command, args, `via` note.
- **ChatStore / ChatFileRef / VsChatSummary / VsChatTranscript**: where a chat lives, its listing entry, and the read-only blocks (user, assistant, tool, note).

## Success Criteria *(mandatory)*

- **SC-001**: No user-controlled text is ever interpreted by a shell when launching VS Code (test: for Windows metacharacters, read: for the spawn).
- **SC-002**: A malformed, truncated, huge or future-format chat file never crashes or hangs the app (test:).

## Assumptions

- `code <folder>` is VS Code's documented way to open a folder (docs/research.md).
- VS Code's chat storage layout is as described in the file header of `vscodeChat.ts` and may change.

## Changes

### 2026-11-01: "Open with" menu in the chat header (issue #685, task T027)

*Found:* the header has one fixed button, **Open in VS Code** (US1, FR-015). It cannot open the system file manager and does not list the editions that are installed. Nothing in the app says that opening a folder does not move a conversation.

*Built (planned here first, then code):*
- **FR-019** `[IMPLEMENTED]` The header button becomes **Open with**, a menu button using the existing `.more-menu` / `wireMenu` components (arrows, Home/End, Esc, focus back). Items: each **installed** edition from FR-015 (VS Code, VS Code Insiders, VSCodium), then **Show in folder** (labelled for the OS: Finder, File Explorer or file manager, with the words "Show in folder" kept in the hint). An edition that is not installed is not listed. When no editor is installed the menu still offers the folder item. The first menu line says what the menu does: *Opens this folder only. Your conversation stays here.* and names **Continue in another app…** (More menu, spec 030) for a handoff. No item implies a session transfer.
- **FR-020** `[IMPLEMENTED]` (test:) Two channels, both through `ipcHandle` with `fromApp`: `agents:openWithTargets(id)` and `agents:openWith(id, targetId)`. The renderer sends an **agent id and one of the fixed target ids** (`vscode`, `vscode-insiders`, `vscodium`, `folder`); main takes the folder from the agent it started (`a.workspaceFile ?? a.cwd` for an editor, `a.cwd` for the folder item), never from the renderer. An unknown id or target id is refused. Neither channel is in `SIM_OPEN_CHANNELS`: under `DURBAR_SIM` main refuses both (`test:simguard`); the simulator's window uses its own stand-in bridge.
- **FR-021** `[IMPLEMENTED]` (test:) Folder checks before any launch (`src/main/openwith.ts`, pure with an injected file system): the path must be absolute and free of NUL; it is looked at with `lstat` (not followed). It must exist ("This folder no longer exists"), must be a **directory** (a file is refused, so nothing that could run is ever opened), and must **not be a symbolic link** (refused with "is a link; open the real folder"; *owner decision: safer default, see below*). On macOS and Windows a folder whose name is a launchable package (`.app`, `.bundle`, `.workflow`, `.action`, `.prefpane`, `.saver`, `.xpc`, `.kext`, `.framework`, `.plugin`, `.command`) is refused for **Show in folder** because opening it could run it (checked on every OS, one rule). A workspace file (`.code-workspace`) is only ever handed to an editor, never to the file manager.
- **FR-022** `[IMPLEMENTED]` (test:) Editors: discovery is spec 009 FR-002/FR-015 only (`planEdition`; PATH, fixed install folders; never a path a repository supplies). The argument list is exactly `[target]`, no shell (the one guarded `code.cmd` route stays), no flag, so no folder setting, task or workspace file is executed by Durbar and Durbar passes nothing that trusts the folder. A folder is always absolute, so it cannot start with `-` and be read as an option; a relative path (or one that would) is refused before launch. VS Code's CLI has no documented `--` separator, so none is added; absolute paths make it unnecessary.
- **FR-023** `[IMPLEMENTED]` (test:; `real:` once, a scratch folder opened in Finder on macOS) **Show in folder** uses Electron `shell.openPath` on the checked directory, with a fake in tests. `openPath` returns an error string; any non-empty result is shown. It is never called with a file, a link or a missing path.
- **FR-024** `[IMPLEMENTED]` (test:; sim: toast) A failed launch says so: the toast reads *Could not open <target>: <reason>* in the error style; success reads *Opening <target>…*. The spawn result is awaited (existing `spawn`/`error` events).
- **FR-025** `[NOT BUILT, by decision]` Not built, and not implied: same-session handoff (**Continue in <same harness>**) and any driving of one session from two processes. The issue's research table (Copilot `--resume`, Claude Code `--resume`, Codex picker, Cursor) is recorded for the owner; today **Copy resume command** (More menu) and **Continue in another app…** (spec 030, a new session from a reviewed summary) remain the only handoff paths. Cursor as a folder-opening target is not added: its detection and launch were not verified on any OS (issue: "only after cross-platform discovery and launch behavior are verified").
- **Existing `agents:openInVSCode`** stays for the other callers (Continue in VS Code, folder status dialog, profile editor) and is unchanged.
- Tests: `npm run test:openwith` (new): path from main by agent id, a renderer-supplied path ignored, `-` start, missing folder, symlink, file, `.app` folder, argv exactly `[target]` and `shell:false` for each edition on three platforms, only installed editors listed, `openPath` called with a directory only, failure messages. A mutation of the argument list and of the path source must fail it. Simulator driver `scripts/shots-009-openwith.js` at 1440x900 and 1280x800 for the menu (text 11px, inside the window, arrows and Esc, toast). No editor is launched by a test (a fake spawner); one `real:` check opens a scratch folder in the file manager.

*Owner decisions awaiting review (safer defaults taken):* (1) a symbolic-link folder is refused rather than followed; (2) Cursor and other editors are not offered until verified; (3) `.app`-style folders are refused for the file manager; (4) same-session "Continue in <harness>" is not built.

### 2026-10-20: FR-018's open point is specified in spec 056 (planned, not built)

Cross-reference only; nothing here changes yet. The owner chose option A for "resume it in Durbar" (issue #344): [spec 056](../056-continue-vscode-chat/spec.md) adds **Continue in Durbar…** to this view, which starts a **new** Durbar session in the same folder whose first message is a reviewed, redacted copy of the chat. This view stays read-only and nothing is written to VS Code storage. When 056 is built it changes the banner wording of US2 ("It cannot be continued here.") and reads the edge case "Content is never logged, uploaded or executed" as: the file is never uploaded; only text the user reviewed and confirmed is sent as their own message (056 FR-013a).

*Owner decision (Paco, 2026-10-20, 056 Q9):* this reading is accepted. Sending a copy that the user reviewed, edited and confirmed with Start is the user's own message, not an upload of the VS Code chat file; the file itself is still never uploaded, logged or executed. No constitution change.

### 2026-10-19: VS Code chat view opens at the latest message; two new kinds; Continue in VS Code (issue #253, task T026)

*Found (owner, on alpha.6):* (1) **View** on a long VS Code chat (346 messages, "Only the last 300 … are shown") opened away from the end, so the latest messages needed a manual scroll. (2) Two response kinds were skipped with the "not recognised" note: `mcpServersStarting` and `questionCarousel` (VS Code 1.109+). (3) A VS Code chat cannot be continued here (US2, by design), and there was no short way to go and continue it in VS Code.

*Corrected:*
- **FR-016** `[IMPLEMENTED]` (sim: `scripts/shots-009-vschat.js` asserts scrolled to the bottom at 1440x900 and 1280x800; the notes now sit above the transcript) **View** opens scrolled to the **latest** message (the end of the transcript), like a chat. The "only the last N" and "not recognised" notes stay reachable at the top.
- **FR-017** `[IMPLEMENTED]` (test: `scripts/test-vscodechat.ts`, synthetic `.jsonl` and `.json`; the saved user answer is not shown, its shape was never observed: `[KNOWN GAP]`) The reader knows two more kinds: `questionCarousel` is shown as a read-only question block (sanitised Markdown, no controls; each question's title, its message text and its option labels, plus "free text allowed" / "can be skipped" when set; the user's answer is shown only if the saved data carries it; no option is presented as clickable), and `mcpServersStarting` is a known status kind that is not shown (it only lists starting MCP server ids). Neither is counted as "not recognised" any more. Unknown kinds keep the existing note.
- **FR-018** `[IMPLEMENTED]` (sim: toast, same IPC as Open in VS Code; a real VS Code launch is not re-run, see FR-014) A VS Code chat view has **Continue in VS Code**, which opens the chat's folder (or workspace file) in VS Code with the same launcher as *Open in VS Code* (FR-001); the banner keeps saying the chat cannot be continued here. Opening that exact chat in VS Code is not offered (no supported link). Resuming it in Durbar with a summary would read the chat and spend credits: not done, needs the owner.
- Fixtures are synthetic, following only the shape of the two kinds (no private content). Simulator and unit tests; the scroll is checked by a driver at 1440x900 and 1280x800; no AI credits.

### 2026-10-16: FR-008 resolved by removing the claim

README no longer says Cursor's chat history is read (the code lists only `Code`, `Code - Insiders`, `VSCodium`; Cursor's store layout was never checked). Adding Cursor honestly would need its real on-disk format; not done. T020 closed by correcting the README.

### 2026-10-19: Open in VS Code Insiders or VSCodium (T021, FR-009)

*Decision* (made by the agent under the owner's autonomy grant; no owner question was open): prefer stable VS Code, which is the common case and today's behaviour. Then VS Code **Insiders**, then **VSCodium**. The chat-history reader already reads all three (FR-011).

- **FR-015** `[IMPLEMENTED]` "Open in VS Code" tries the editions in order: **VS Code**, **VS Code Insiders**, **VSCodium**. It uses the first one found, by the same rules as for stable:
  - **Windows:** the edition's `.exe` in its usual install folders, then its `.cmd` shim on PATH (or the `.exe` next to it), then the `.cmd` shim in the install folder;
  - **macOS:** the PATH command, then the app bundle's `bin` in `/Applications` and `~/Applications`, then Homebrew paths;
  - **Linux:** the PATH command, then the usual `/usr/bin`, `/usr/local/bin` and `/snap/bin` paths.
  
  Always one absolute path argument, no shell (except the guarded `.cmd` case). The result names the edition it used, and the "not found" message names all three. This closes FR-009.
- `test:` `npm run test:vscode`: the plan for each edition on Linux, macOS and Windows (exe, app bundle, PATH, the guarded `.cmd`) with fake file systems, the order when several are installed, and the old stable cases unchanged. Not run with a real Insiders or VSCodium install; none is installed on the test machine.

### 2026-10-21: known gaps revalidated

- **FR-008** closed. The README no longer says Cursor is read (`grep -i cursor README.md`: no match). The code reads `Code`, `Code - Insiders` and `VSCodium`.
- Still open, unchanged: FR-010..FR-014 (portable or Flatpak VS Code, the undocumented store format, sessions appearing in VS Code's list, window flags, the real `code` spawn on macOS and Windows).

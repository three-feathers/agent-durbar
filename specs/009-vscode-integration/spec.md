# Feature Specification: VS Code integration (open folder, read-only chat history)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: index
title: Open with (VS Code editions, file manager), VS Code chat history (read-only)
status: built
note: open: real launch and VS Code store checks on macOS and Windows (T022-T025)
-->

**Feature Branch**: `009-vscode-integration` (reverse-engineered; milestones 1, 6 and packaging)
**Created**: 2026-10-16
**Status**: Implemented (reverse-engineered from `src/main/vscode.ts`, `src/adapters/vscodeChat.ts`, `main.ts`, README, `docs/research.md`)
**Input**: "Open an agent's folder in VS Code in one click, and show the VS Code Copilot Chat history of a folder as a read-only copy."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open in VS Code (Priority: P1)

*Since 2026-11-01 the header button is **Open with** (FR-019) and the folder status dialog's is **Open in editor** (FR-027); the story below is the one it started as.* In the chat header **Open in VS Code** opens the agent's folder (or its `.code-workspace` file) in VS Code, on macOS, Windows and Linux, even when the app was started from Finder/Start menu and has no shell PATH.

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

### 2026-11-11: openInVSCode on Windows takes only a drive or UNC path; an explicit verbatim flag (issue #1255, FR-028, T030)

*Found* (re-check of CodeQL alert #31, a false positive: there is no shell): `openInVSCode` checked `path.isAbsolute`, which on Windows also accepts a root-relative `\dir` or `/dir`. Code.exe (Chromium) reads an argument starting with `/` as a switch, so such a path would be argument injection (not shell injection). Not reachable today: its one caller, `profiles:openInVSCode`, passes a main-owned profile file, and the Open with route (FR-021) hands on a `realpath` result, which on Windows is a drive or UNC path. Separately, `spawnPlan` switched on `windowsVerbatimArguments` when `plan.args[0] === '/d'`, a guess from the arguments.

- **FR-028** `[IMPLEMENTED]` `test:` (1) On win32, `openInVSCode` accepts only a drive path (`C:\dir`, `C:/dir`) or a UNC path (`\\server\share`); of the `\\?\` forms only `\\?\C:\dir` and `\\?\UNC\server\share`. A root-relative path, `//server/share`, a drive-relative `C:dir`, a bare server, a device path (`\\.\C:\dir`, `\\.\pipe\x`, `\\.\PhysicalDrive0`) and any other `\\?\` form (`\\?\GLOBALROOT\...`) are refused with *path must start with a drive letter or be a UNC path*; a path with a control character (no Windows name has one) is refused as *invalid path*; nothing is spawned. macOS and Linux keep the absolute-path check (a tab is a legal POSIX name there). The same drive-or-UNC rule guards the editors of **Open with** and **Open in editor** (FR-021, FR-027) on the resolved `realpath` result, which on Windows is already a drive or UNC path: *This folder (or workspace file) is not on a drive or a network share, so it was not opened.* **Show in folder** is no argument list and is unchanged; the editors' control-character case is left to FR-022's `.cmd` refusal and to Windows, whose names cannot hold one. `openInVSCode` takes an injected `LaunchEnv` and spawner, so this is tested with the platform forced to `win32`. (2) `LaunchPlan` has an explicit `verbatim` flag, set only by the guarded `.cmd` plan (`planCmd`); `spawnPlan` passes `windowsVerbatimArguments` only for `win32` and `verbatim === true`. The command line is the same as before for every plan this code builds: clarity, not a fix. `npm run test:vscode`, `npm run test:openwith`; device paths and control characters added after the pre-review of #1523. A real launch on Windows was not run (FR-014, T022).
- **FR-028, review of #1523 (2026-11-11)** `[IMPLEMENTED]` `test:` The drive-or-UNC check also refuses forms that name no folder: a `pipe` or `mailslot` share after any server (`\\localhost\pipe\x`, `\\127.0.0.1\pipe\x`, `\\?\UNC\localhost\pipe\x`, `\\*\mailslot\x`), a server starting with `;` (`\;LanmanRedirector\srv\share`) or holding `*`, and a reserved DOS device name in any component (`CON`, `PRN`, `AUX`, `NUL`, `CONIN$`, `CONOUT$`, `COM0`-`COM9`, `LPT0`-`LPT9`, also with superscript digits, with or without an extension or trailing spaces: `C:\NUL`, `C:\x\COM1`, `C:\nul.txt`). Names that only start like one (`C:\console`, `C:\COM10`, `C:\CON foo`, `\\srv\pipes`) still open. On the `.cmd` route (FR-022) the quoted target's trailing backslashes are doubled, so a drive root `C:\` reaches Code.exe as `C:\`, not as `C:"` (a backslash before the closing quote escapes it for the C runtime's argv parser). `npm run test:vscode` now fails when a launch never settles (`process.exitCode = 1` until its last line). Whether Windows really opens a device or pipe for these forms, and the argv reading of `"C:\"`, are `read:` claims; no Windows run.
- **FR-028, re-review of #1523 (2026-11-11)** `[IMPLEMENTED]` `test:` A device name ends at its first `.` or `:` after trailing spaces or dots, as Windows reads it: `C:\NUL:`, `C:\COM1:`, `C:\x\NUL:stream` and `C:\x\CON:foo.txt` are refused, and so is a device in a middle component (`C:\NUL\x`, `\\srv\share\COM1\x`, `\\?\C:\AUX\p`). A `pipe` or `mailslot` share with trailing dots, spaces or a stream (`\\srv\pipe.`, `\\srv\pipe `, `\\srv\pipe:x\y`) is refused, and on Windows so is any `.` or `..` component (`\\srv\.\pipe\x`, `C:\x\..\y`), which a `realpath` result never holds. A table of 23 normal folders (`C:\NULL`, `C:\x\.git`, `C:\x\..config`, `\\10.0.0.1\c$\x`, `C:\Program Files (x86)\App`, ...) still opens. The `.cmd` route's doubling is tested with two and three trailing backslashes. **Merge order with #1542**: #1523 lands first; #1542 then merges main and keeps its `cmdShimArgs` in place of this `planCmd` command line (a drive root stays bare there, so this PR's trailing-backslash doubling goes away on that line) and updates the `args[3]` assert in `test:vscode`. Windows' name reading is a `read:` claim; no Windows run.

### 2026-11-03: pre-review of #976: the fall-through, the resolved path, honest texts (FR-021..FR-027, T029)

- **FR-027, fall-through restored** `[IMPLEMENTED]` `test:` **Open in editor** and **Continue in VS Code** use the first edition in FR-015's order that can open the path, as `planVSCodeLaunch` did: on Windows, VS Code found only as `code.cmd` and a folder with `&` in its name now opens in VSCodium (or Insiders) if that is installed as an `.exe`, instead of refusing. Only when no installed edition can open it is the refusal shown. The menu's own items still each name one edition and refuse for that one.
- **FR-021, FR-023, the resolved path** `[IMPLEMENTED]` `test:` The path is resolved once with `realpath`, also when the agent's folder is not itself a link (a link higher up), and that real path is what is checked and handed on; the link note still appears only when the folder itself is a link. FR-023 now says what is and is not guaranteed (a swap inside the real path's parent after the check is a `[KNOWN GAP]`).
- **FR-022, the refusal text** `[IMPLEMENTED]` `test:` names the characters of `CMD_UNSAFE` that are in the path (each once; a line break as "a line break"), not a fixed list that left out `` ` ``, `<`, `>` and line breaks, and says *workspace file* when the path is the agent's `.code-workspace` file. The editor items' hint says *Opens this workspace in …* for such an agent.
- **Renderer** `[IMPLEMENTED]` `sim:` `shots-009-openwith`: the list is asked again on focus and on Enter, Space and the arrow keys, not only on a pointer, at most once every 3 seconds (each list costs main a PATH scan of file checks); a changed list under an open menu is rebuilt with the focus kept on the same target, the same list leaves the menu alone; after a choice the focus returns to the button; a demo agent's button is a plain **Open in editor** with no menu; the folder status dialog and Continue in VS Code toasts name the edition that answered (or "an editor"), not a fixed "VS Code"; `openInVSCode` in `DurbarApi` returns `note`. The simulator's sim-2 answers with main's link note and, for VSCodium, main's `.cmd` refusal, so the note and the error toast are drawn and checked, escaped.
- **Tests** `test:` the IPC channels on a stand-in `electron` (a plain folder goes to `shell.openPath`, a package to `shell.showItemInFolder`, a link gives the note), `realDeps`, the workspace file's guards, the NUL guard by its own message, `fileManagerHint` per platform; `test-openwith.ts` fails unless it reaches its last line. `real:` none: no editor or file manager was opened.

### 2026-11-02: review of #976: one guarded path, packages recognised by what they are (FR-026, FR-027, T028)

- **FR-026** `[IMPLEMENTED]` `test:` **Show in folder recognises a package positively.** A list of names missed `.pkg`, `.scptd`, `.appex`, any bundle with `Contents/Info.plist`, and Windows `name.{CLSID}` shell folders, and links are followed, so an agent with write access could make its folder lead to one. The check runs on the real path; FR-023 says what a swap after the check can still do. Now, on the real path: on macOS a folder is revealed when its name has an extension or it has an entry called `Contents` (read with `lstat`); on Windows when its name ends in `.{GUID}`; on Linux nothing is treated as a package. Revealing runs nothing, so a false match only means a folder such as `my.project` is selected rather than opened, with the note. Replaces FR-021's list.
- **FR-027** `[IMPLEMENTED]` `test:` **One guarded path to an editor.** `agents:openInVSCode` (Open in editor, Continue in VS Code) goes through `openWith`'s checks with the first edition in FR-015's order that can open the path (the fall-through restored on 2026-11-03), so it has FR-021's checks and FR-022's argv, and refuses a window that is not the app's. Its toast shows the link note. `profiles:openInVSCode` is a different thing: it opens a profile file main listed, not an agent's folder, and stays as it is.
- **The first fill of an open menu:** a menu opened before the first list arrived showed only its note with nothing to focus. An open menu is left alone only once it has items; a first fill fills it and focuses the first item. `sim:` `shots-009-openwith`.
- **Roles:** the note and the items' wrapper inside `role="menu"` are `role="none"`.
- **Test:** the `.cmd` route on PATH now has its own rows (a target or a PATH folder with `&`, `%`, `"` or `^` plans nothing and starts nothing). `real:` not run: no folder has been opened through this path on Windows.

### 2026-11-02: Open with warns instead of refusing (owner's "warn, do not limit", #976)

- **A package-named folder** (recognised as FR-026 says, since the review) is no longer refused for **Show in folder**: it is revealed in the file manager with `shell.showItemInFolder`, which selects it and runs nothing, and the toast says so. `shell.openPath` still never gets one, because that is what would run it.
- **A `.code-workspace` file that is a link** is followed to its real file, which must be a regular `.code-workspace` file, with a note, as a folder is.
- **Still refused, FR-021 and FR-022:** a link to a file as a folder, a path that leads nowhere, and on Windows a path with `&`, `%` or another character `cmd.exe` could misread through a `.cmd`. That last one is a **shell-injection guard**, not a preference: it keeps a folder's name from running as a command. It says how to get there another way.
- **Names:** the two buttons that use the fallback route (folder status dialog, profile editor) read **Open in editor**: they were wrong whenever the route fell back to Insiders or VSCodium.
- **A fix:** the menu's list arriving after the menu opened rebuilt it and dropped the focused item. `test:` `npm run test:openwith`, `shots-009-openwith`; `[KNOWN GAP]` a real reveal and a real launch through a link were not run.

### 2026-11-01: Open with follows a symbolic-link folder, with a note (owner decision, #976)

Vikram's call (relayed, 2026-11-01 03:48 UTC), replacing the safer default of FR-021: a project folder that is a symbolic link is opened, not refused. Main resolves the link to its real path, and every other check of FR-021 and FR-022 then applies to that real path: it must be a directory (a link to a file is refused), a link that leads nowhere says the folder no longer exists, a link to a launchable package is revealed, not opened (2026-11-02 entries above), and the editor or file manager gets the real path as its one argument. The answer carries a note, shown after the toast's usual text: *This folder is a link, so its real folder was opened.* The note holds no path. A `.code-workspace` file that is a link was left refused here, and followed since (2026-11-02). `test:` `npm run test:openwith`; `[KNOWN GAP]` a real launch through a link and a Windows junction were not run.

### 2026-11-01: "Open with" menu in the chat header (issue #685, task T027)

*Found:* the header has one fixed button, **Open in VS Code** (US1, FR-015). It cannot open the system file manager and does not list the editions that are installed. Nothing in the app says that opening a folder does not move a conversation.

*Built (planned here first, then code):*
- **FR-019** `[IMPLEMENTED]` The header button becomes **Open with**, a menu button using the existing `.more-menu` / `wireMenu` components (arrows, Home/End, Esc, focus back). Items: each **installed** edition from FR-015 (VS Code, VS Code Insiders, VSCodium), then **Show in folder** (its hint names the OS's Finder, File Explorer or file manager). An edition that is not installed is not listed. When no editor is installed the menu still offers the folder item. The first menu line says what the menu does: *Opens this folder only. Your conversation stays here.* and, only when the More menu has it (a second agent app installed, spec 030), names **Continue in another app…** for a handoff. No item implies a session transfer.
- **FR-020** `[IMPLEMENTED]` (test:) Two channels, both through `ipcHandle` with `fromApp`: `agents:openWithTargets(id)` and `agents:openWith(id, targetId)`. The renderer sends an **agent id and one of the fixed target ids** (`vscode`, `vscode-insiders`, `vscodium`, `folder`); main takes the folder from the agent it started (`a.workspaceFile ?? a.cwd` for an editor, `a.cwd` for the folder item), never from the renderer. An unknown id or target id is refused. Neither channel is in `SIM_OPEN_CHANNELS`: under `DURBAR_SIM` main refuses both (`test:simguard`); the simulator's window uses its own stand-in bridge.
- **FR-021** `[IMPLEMENTED]` (test:) Folder checks before any launch (`src/main/openwith.ts`, pure with an injected file system): the path must be absolute and free of NUL; it is resolved once with `realpath` (links are followed, *Changes* 2026-11-01, owner decision; `lstat` on the agent's own path only decides the link note) and the real path is looked at with `lstat`. It must exist ("This folder no longer exists"), must be a **directory** (a file is refused, so nothing that could run is ever opened), and what is handed on is that same real path, never the path as the agent gave it (*Changes* 2026-11-03). A package folder is revealed for **Show in folder**, never opened, because opening it could run it (FR-026). A workspace file (`.code-workspace`) is only ever handed to an editor, never to the file manager.
- **FR-022** `[IMPLEMENTED]` (test:) Editors: discovery is spec 009 FR-002/FR-015 only (`planEdition`; PATH, fixed install folders; never a path a repository supplies). The argument list is exactly `[target]`, no shell (the one guarded `code.cmd` route stays), no flag, so no folder setting, task or workspace file is executed by Durbar and Durbar passes nothing that trusts the folder. A folder is always absolute, so it cannot start with `-` and be read as an option; a relative path (or one that would) is refused before launch. VS Code's CLI has no documented `--` separator, so none is added; absolute paths make it unnecessary.
- **FR-023** `[IMPLEMENTED]` (test:; `real:` once on macOS, before the 2026-11-02 and 2026-11-03 changes: a scratch folder opened in Finder through the first version of this route; `[KNOWN GAP]` not re-run since links are followed, packages revealed and the path resolved, so no `real:` run covers the code as it is) **Show in folder** uses Electron `shell.openPath` on the checked real directory, with a fake in tests. `openPath` returns an error string; any non-empty result is shown. **What is guaranteed:** at the moment of Durbar's last check the path given to `openPath` (or to an editor) is the resolved real path, it was a directory (or a regular `.code-workspace` file), and the check and the call run in one synchronous step with no `await` between them. **What is not:** another process that can rename entries inside that real path's parent (for example a running agent, in its own parent folder) can still swap it for a link or a package in the moment between that check and the file manager or editor opening it; a path-based API cannot close this window (it would need an open handle, which `shell.openPath` and an editor's command line do not take). `[KNOWN GAP]`
- **FR-024** `[IMPLEMENTED]` (test:; sim: toast) A failed launch says so: the toast reads *Could not open <target>: <reason>* in the error style; success reads *Opening <target>…*. The spawn result is awaited (existing `spawn`/`error` events).
- **FR-025** `[NOT BUILT, by decision]` Not built, and not implied: same-session handoff (**Continue in <same harness>**) and any driving of one session from two processes. The issue's research table (Copilot `--resume`, Claude Code `--resume`, Codex picker, Cursor) is recorded for the owner; today **Copy resume command** (More menu) and **Continue in another app…** (spec 030, a new session from a reviewed summary) remain the only handoff paths. Cursor as a folder-opening target is not added: its detection and launch were not verified on any OS (issue: "only after cross-platform discovery and launch behavior are verified").
- **Existing `agents:openInVSCode`** stays for the other callers (Continue in VS Code, folder status dialog); it goes through `openWith` since FR-027.
- Tests: `npm run test:openwith` (new): path from main by agent id, a renderer-supplied path ignored, `-` start, missing folder, symlink, file, `.app` folder, argv exactly `[target]` and `shell:false` for each edition on three platforms, only installed editors listed, `openPath` called with a directory only, failure messages. A mutation of the argument list and of the path source must fail it (the planted mutants are listed on PR #976). Simulator driver `scripts/shots-009-openwith.js` at 1440x900 and 1280x800 for the menu (text 10.5px or more, inside the window, arrows and Esc, toast). No editor is launched by a test (a fake spawner); the one `real:` check (FR-023) predates the later changes.

*Owner decisions awaiting review (safer defaults taken):* (2) Cursor and other editors are not offered until verified; (4) same-session "Continue in <harness>" is not built. (1) and (3) were decided: links are followed and package folders revealed (*Changes*, 2026-11).

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

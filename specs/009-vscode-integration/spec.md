# Feature Specification: VS Code integration (open folder, read-only chat history)

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
- **FR-008** `[KNOWN GAP]` **README says Cursor is read too** ("also Insiders, VSCodium, Cursor") but the code lists only `Code`, `Code - Insiders`, `VSCodium` (`vscodeUserDirs`). Either the code or the README is wrong. `read:` (Task T020.)
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

# Feature Specification: Files view and image preview

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: See a session's files and images next to its chat: image preview first, then a drawer with a list and a viewer (CodeMirror 6, lazy), view by default, quick edit, full-screen and collapse, with confinement in main
status: draft
note: spec, plan, tasks; nothing built
-->

**Feature Branch**: `005-design-sweep-specs` (spec, in #1014). The build is one small PR per phase.
**Created**: 2026-11-02
**Status**: Draft: spec, plan and tasks only. Nothing is built, no dependency is added.
**Input**: Owner (Vikram, 2026-11-02), choosing from the mocks: third in his order, after Your door and the floor plan rail (spec 005's `plan.md`). A file view opens from the chat, not a rail icon, with full-screen and collapse icons and a quick edit mode. Research of 2026-11-01 (outside the repo): facts are `read:` from `main`, or `measured:` in a throwaway build, or estimates, and say so.

## Summary

Today a person sees an agent's work through a name chip, tool rows and diffs, and leaves for VS Code to see a file. This adds, in order: thumbnails and a large view for images; then a drawer beside the chat with the session's files, one file at a time, read-only by default, with a quick edit mode. VS Code stays the place for real work. **It is not an IDE:** one file open, one Edit toggle, one *Open in editor*.

## User scenarios

- **US1 (P1) See the image.** I attach a screenshot; the chat shows a thumbnail, and a click shows it large. *Given* an image attached in this run, *When* it is sent, *Then* the chip is a 120 x 84 thumbnail with its name, and Enter or a click opens it fitted to the window; Esc returns focus. *Given* a restart, *Then* the name chip stays and says nothing false.
- **US2 (P1) Read what the agent touched.** From the chat I open "Jonas's files": those Jonas touched first, the whole folder one step down. *Given* a chat, *When* I open it, *Then* the drawer opens beside the chat, the chat narrows and is not covered. *Given* a file with a known request or diff, *Then* that line is highlighted.
- **US3 (P2) Full-screen and collapse.** *Given* a long file, *When* I press full-screen, *Then* it fills the chat's area and a button returns; *When* I press collapse, *Then* the drawer goes, and it stays so across chats (spec 005 FR-196).
- **US4 (P2) Quick edit.** *Given* Ask first or Allow all, *When* I press Edit, fix a line and save, *Then* the file changes only if nobody else changed it since I opened it. *Given* Read-only, *Then* there is no Edit, and main refuses a write anyway.
- **US5 (P3) An agent changes the open file.** *Then* one quiet line offers *Reload* and *Show the change*, and unsaved edits are never dropped without a choice.

## Edge cases

Binary, not UTF-8, over 2 MB; a link pointing out of the folder; a hard link; a secret-looking name; a folder removed while open; two windows; a `.code-workspace` with several folders; a Windows reserved name, alternate data stream or junction; NFD names on macOS; CRLF and a BOM; a 40 megapixel image bomb; an SVG; the simulator (never the real disk); a chat 639 px wide at 1280x800.

## Requirements

### Phase 0: image preview, its own small PR, first (spec 004 owns chips)

- **FR-001** **One channel,** `agents:imagePreview(agentId, ref)`, through `ipcHandle`. `ref` is a token main issued when the user attached the file, never a path, from a small `attachedThisSession` set, since `pickedFiles` forgets after send (004 FR-015). Agent-mentioned images come later, by FR-020's confinement.
- **FR-002** **Checks in main, in order:** `readCapped` at `MAX_ATTACH_BYTES` (10 MB); `sniffImage` (the bytes decide; PNG, JPEG, GIF, WebP, BMP); pixel size from the header, refused over 40 megapixels; **SVG refused,** as for attachments. Returns a reason, with no path in any message.
- **FR-003** **Decoding stays in the sandboxed renderer,** never `nativeImage` in main on untrusted bytes. Bytes arrive as an `ArrayBuffer`, becoming a `data:` URL or a resized bitmap. **No CSP change.** The large view asks again and drops its bytes on close.
- **FR-004** **UI.** A 120 x 84 thumbnail with the name under it; a real button; `DurbarDialog` for the large view (fit to the window, Esc, focus returns) with *Open in default app* (FR-007) and *Copy path*. Alt text is the file name. No animation under Reduced motion. Thumbnails load when in view, at most about 30 live, the rest back to a name chip.
- **FR-005** **Never fetched:** a remote image in a reply stays a stand-in (016's limit stands). Agent-read images are a later step (`ToolCallEvent.imagePath`), per adapter, `[KNOWN GAP]` unchecked against real sessions.
- **FR-006** **What you see is what you attached.** At attach time main records the file's size and sha256 in the token's entry. A preview reads the bytes with `readCapped`, hashes those same bytes, and sends them only on a match; otherwise it refuses, with "This file changed after you attached it", and the name chip stays. So a thumbnail can never differ from the attached file (004 FR-015). The path stays in main, only for the token's life, never reaches the window, and grants no send: FR-015's removal from `pickedFiles` stands. `[KNOWN GAP]` if an adapter passes a path and the agent reads later, a change between attach and read is outside this check.

- **FR-007** **Open in default app: images by their bytes only.** `shell.openPath` runs whatever the system associates with a name, so it is never given the original file. Main takes the token, not a path; reads and hashes as FR-006; `sniffImage` must name a type from its bytes (never the extension, and SVG is refused); then main writes a private copy, `<sha256>.<ext from sniffImage>`, in the app's temp folder, and calls `shell.openPath` on that copy, in main only, never `shell.openExternal`. A file that fails shows no button. So `x.png.exe`, `x.html` with PNG bytes, a link, or a file swapped after the check cannot open as anything but an image. Copies are removed on quit, best effort.

### The drawer

- **FR-010** **Opened from the chat, no rail icon** (owner's chosen mock). The entry is at the right end of the *Chat* and *Browser* row, or that row's place after 005 FR-199, since the header's top row has no room at 1280: "Jonas's files". The **drawer** opens on the right, pushing the chat, one at a time with `#notesDrawer` and Your door, reusing the Notes drawer's pattern. "Drawer" is a design word; the label says "files". **No Library door for now:** the Library means docs tools today (`places.js`).
- **FR-011** **Fit, measured on the mock:** 600 px at 1440x900, chat 620 px beside the rail. At 1280x800 the left rail goes narrow to 52 px while the drawer is open, by 005 FR-196's one trigger (a chat under 620 px beside a full rail), chat 639 px, and the composer's hint hides under about 860 px wide. Text at least 11 px, buttons at least 26 px, no sideways scrolling for code lines (wrapped).
- **FR-012** **Full-screen and collapse icons** (owner). Named buttons in the drawer's header: **full-screen** fills the chat's area, with the rails left as they are, and returns by the same button or Esc; **collapse** closes the drawer to its entry, keeping the file open and the state as 005 FR-196 keeps it. Unsaved edits survive both.
- **FR-013** **A list about a person.** First those files this agent touched (`EditInfo`), then the folder as a tree: own small tree (ARIA `tree`, roving tabindex, `morphHTML`, one level fetched per expand). `.git` hidden; `node_modules` collapsed and counted; links shown and not followed. `[KNOWN GAP]` whether adapters report reads or a request's line number is unchecked. If they do not, the list shows only changed files, and the highlight only applies to a diff. The mock's "read 2 min ago" was invented.
- **FR-014** **View by default.** CodeMirror 6 read-only, wrapped lines, tokens only (070 FR-052), text at least 12 px, one instance destroyed on close. Markdown shows rendered through the existing `marked` and DOMPurify path (016), with a Source toggle. Header: name, Edit, *Open in editor* (`openInVSCode`, or #976's menu).
- **FR-015** **Lazy, one bundled file.** The editor's script is injected only when the view first opens, so start-up is unchanged, like `realoffice/art/people.js`. Languages: markdown, JavaScript and TypeScript, JSON, CSS; the rest plain text. `measured:` 547 KB raw, 189 KB gzip, in Node, not Electron: T003 measures it in Electron against 097 FR-178's budgets. Pinned exact versions at least 2 weeks old, lockfile integrity, spec 045 review, one `esbuild` call in `copy-assets.js` as a devDependency only; the app's own build stays as it is. Not Monaco (25 MB, workers, AMD against this CSP).
- **FR-016** **Caps.** 2 MB at most for view and edit; over it, "Too large to open here" and *Open in editor*. Binary refused by a NUL in the first 8 KB or invalid UTF-8. BOM and line endings kept.

### Quick edit

- **FR-018** **Edit is a mode, a button away** (owner: quick edit). The same editor reconfigures by a `Compartment`; there is no second editor. Save, *Revert to saved* and undo; Esc then Tab leaves the editor. The mode says plainly that it is on. Nothing else is added: no create, rename, delete or move.
- **FR-019** **Read-only means no Edit, in main.** In the Read-only mode the button is absent and `files:write` refuses in main, which knows the session's mode. In Ask first and Allow all a person's own save needs no agent permission. The header stays truthful.

### Safety design (sensitive: analyst, implementer, reviewer; spec 021 FR-038)

- **FR-020** **Confinement in main.** The window sends `(agentId, folderIndex, relative path with "/")`, **never an absolute path**. Main finds the agent (`ownedAgent`), builds roots from its folder or `.code-workspace` (`resolveWorkspaceCwd`, `readCodeWorkspaceFolders`), rejects NUL, `..`, drive letters, UNC and `\\?\`; joins; `realpath`s both; requires the target inside the root (`isInsideRoots`, case-insensitive on Windows and macOS); opens by `readCapped` (`O_NOFOLLOW` where defined). A link pointing out is listed and refused. A hard link is refused, a documented limit (pnpm stores). Re-run on every save.
- **FR-021** **Platforms.** Windows: `:` in a segment, reserved names, trailing dots or spaces, 8.3 names through `realpath`, junctions as links. macOS: case-insensitive volumes, NFD names. Linux: FIFOs and devices refused. Tests inject platform and flags, as `notesfile.ts`'s do.
- **FR-022** **Secret-looking files.** `.env*`, `*.pem`, `*.key`, `*.p12`, `id_rsa*`, `.npmrc`, `.netrc`, `*credentials*`, `.git/config`: listed with a lock and not opened until *Show anyway* (a `DurbarDialog` line, not remembered); never editable; shown through `maskTokenShapes`. No file content or path in a log or error. `[KNOWN GAP]` a heuristic: a secret in `config.json` is not caught, only its token shapes.
- **FR-023** **Write path.** Keep the sha256 from load. On save, re-read and compare, or **conflict, never overwrite**; temp file in the same folder (`O_EXCL`, the original's mode), `fsync`, compare again, rename, one retry on Windows after 200 ms. Lift the shared part of `notesfile.ts` and `checkpoints.ts`; do not copy. Refused: a link, a hard link, a changed file type, a path that left the roots. Honest limit: a tiny window between the last check and the rename stays.
- **FR-024** **An agent or the disk changes the open file.** `EditInfo.files[].path` naming the open file shows one line: *Reload*, *Show the change* (`simpleDiff`), and with unsaved edits *Keep mine* or *Compare*. Outside changes are caught on save and on window focus by re-hashing, no `fs.watch`. Unsaved edits are never discarded without a choice.
- **FR-025** **Window-only.** `files:list`, `files:read`, `files:write` in one `src/main/files.ts`, through `ipcHandle`, in `test:ipcchannels`, **never in `durbar-mcp`**: no agent or MCP tool can call them. No shell and no spawn; the one process is the existing *Open in editor* path. Org policies (076) do not govern what a person views in their own folder, a stated limit.
- **FR-026** **Simulator.** `simguard` refuses these under `DURBAR_SIM`, and the sim answers from a fake tree, never the real disk. No AI credits in any test.

- **FR-027** **Files that run later: refused, or a gesture main owns.** Assumption stated: **the renderer may be compromised** (it shows file contents and agent text), so it can call `files:write` with any arguments, and nothing it says is believed. One pure function in main, `writeClass(realPath, roots)`, decides before FR-023's write, from the final real path:
  - **Never writable, no gesture:** anything under a `.git` segment (hooks, config, and a `.git` file's target), at any depth.
  - **Only after a dialog main itself shows** (`dialog.showMessageBox`, parented to the window, Cancel by default, naming the real path and saying "this file can run code or instruct agents", valid for that one save, not remembered, with no renderer flag to skip it): `.claude/**`, `.mcp.json`, `.vscode/**`, `.github/workflows/**`, `.github/actions/**`, `*.code-workspace`, `package.json`, `.husky/**`, `.devcontainer/**`, `.envrc`, `.gitmodules`, `.gitattributes`, `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `.codex/**`, `.cursor/**`. The list is one table, at any depth, and adding to it is a spec line.
  - In a window's Read-only mode all of this stays refused (FR-019).
- **FR-028** **The forms a protected path can take; each is a test.** `writeClass` compares **every segment of the final real path, the root's part included,** so a root inside `.claude` is protected too:
  - **Links:** a symlink or junction to a protected file, and a linked parent directory (`link/pre-commit` where `link` points at `.git/hooks`), judged by the real path. FR-023 already refuses a link as the target, and the check re-runs right before the rename.
  - **Case:** Unicode case-folded on every platform, including Linux, where over-refusal is the safe side: `.GIT/hooks`, `.Claude/`, `.MCP.JSON`.
  - **Unicode:** NFC before comparing, for NFD names on macOS.
  - **Windows forms:** trailing dots and spaces stripped (`.git./hooks`, `.mcp.json `); `:` refused, so `.mcp.json::$DATA` cannot pass (FR-021); `\\?\`, `\\.\`, UNC and drive letters refused (FR-020); a backslash in a window-sent path refused on every platform; 8.3 short names (`GIT~1`, `MCP~1.JSO`) refused in any segment unless `realpath` shows a long name that passes.
  - **Hard links:** refused (FR-023).
  - `[KNOWN GAP]` a custom `core.hooksPath` or an unlisted runner's config is outside the table; Windows forms are tested by injected platform until a real Windows run; the tiny window of FR-023 stays.

### Not ever, and limits

- **FR-030** **Never:** a terminal here (spec 094), extensions, LSP or autocomplete, debugging, a run or build button, tabs of many files, splits, find in project, refactoring, a git UI, a minimap.
- **FR-031** **Tests.** Each PR: unit tests on confinement, caps, sniffing, hashes with planted mutations; `scripts/check-files.js` at 1440x900 and 1280x800, Flat and Photo, with `until()`: entry, drawer fit, no chat cover, full-screen and collapse with state kept, Read-only has no Edit and main refuses, conflict, lock, keyboard. `[KNOWN GAP]` until a real run: Electron load and memory; forced colours and screen readers on the editor; Windows and macOS; Claude and Copilot image paths.

## Success criteria

- **SC-001** No path chosen by the window can read or write outside a session's roots (adversarial unit tests).
- **SC-002** Start-up and a flat office with no file opened load no editor code (driver).
- **SC-003** A save never overwrites a change it has not seen.
- **SC-004** 15 agents, both sizes: nothing overlaps; text at least 10.5 px.
- **SC-005** No call from a compromised window can write under `.git`, or a file of FR-027's list without main's own dialog, in any form of FR-028 (adversarial unit tests, one per form, with planted mutations).
- **SC-006** *Open in default app* only ever opens a private copy named by its sniffed type, and a preview never shows bytes other than those hashed at attach time.

## Assumptions

`ownedAgent` and `checkFolder` are from #976, open, and may change. Whether spec 065's store can keep "the copy before your save" is unread; until then git is the undo after a save. Line counts are estimates. Mock file text is invented.

## Changes

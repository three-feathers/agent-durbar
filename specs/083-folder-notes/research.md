# Research: Notes (spec 083)

All decisions here are *decided by the coordinator under Ruben's delegation, 2026-10-24*, inside Ruben's binding owner decisions (OD1..OD4 in [spec.md](spec.md)). Evidence is `read:` on `main` at 7d3465b7 unless marked otherwise. Nothing was run against a real agent app (notes never call one).

## R1 Data model and local file

**Decision.** One JSON file per folder, `<userData>/notes/<fingerprint>.json`, `{ version: 1, folderName, notes: Note[], tombstones: {id, deletedAt}[] }`, fingerprint = `folderFingerprint(folderKey)` (`src/main/usagetotalsstore.ts:29`). Folder 0700, file 0600, atomic `wx` temp + rename (the `FolderSetupStore.save` pattern, `src/main/foldersetupstore.ts:39`, with a unique temp name so two processes do not share one `.tmp`).

**Why.** One file per folder keeps a write small (a folder's notes only), lets a corrupt file hurt one folder only (FR-007), and keeps the folder path out of the file, as usage totals already do. Ids are random (`n-` + 12 base-36 characters from `crypto.randomInt`, as `randomPlaceId` in `src/main/settings.ts`), so two processes never make the same id.

**Rejected.** (a) Notes inside `folders.json`: that file is "paths and choices only" by design (constitution III wording, `src/main/folders.ts:47` comments say "never content"); a big note would slow every folder-list write. (b) One file for all folders: a corrupt file loses everything; every save rewrites every note. (c) SQLite: a new native dependency for at most 300 small notes per folder.

## R2 Concurrency

**Facts.** Durbar has one window per process (`new BrowserWindow`, `src/main/main.ts:760`) and **no** single-instance lock (no `requestSingleInstanceLock` in `src/main`), so two processes can share a profile. Installed builds and `npm start` use different profile folders (`docs/agent-notes.md`, *Profile folders*).

**Decision.** Per process: main is the only writer, with a promise queue per folder. Per change: optimistic `rev` (stale edits refused, the window offers *Keep mine* / *Use the saved one*). Across processes: before each write, compare `size`, `mtimeMs` and `ino` with the last read or write; if changed, re-read and merge by `id` (higher `updatedAt` wins; tombstones win over older edits; tombstones capped at 300). The window refetches on `notes:changed`.

**Rejected.** File locks (`proper-lockfile` or `O_EXCL` lock files): a new dependency or stale locks after a crash; the merge already handles the rare two-process case. `fs.watch`: unreliable on network drives and differs by OS; a stat before each write and on open is enough.

## R3 The project file `.durbar/notes.md`

**Decision.** Markdown, one section per note, ordered by `createdAt` then `id`; each section starts with a machine line `<!-- durbar-note id=n-… created=… updated=…[ done] -->`, then `## Title`, a blank line, the text. A text line that starts with `<!-- durbar-note` gets a leading `\` (removed on read). The local store is the source of truth; the file is a mirror that also imports edits; a missing section never deletes (D9).

**Why.** *Round-trip safe*: the marker line, not the heading, splits sections, so a note may contain `##` headings. *Merge-friendly*: sorted by creation, new notes append, each note's lines are contiguous; two branches that each add a note merge without a conflict; an edit touches only its own section. *Stable ids* in the marker. HTML comments do not show in rendered Markdown (GitHub, VS Code preview), so the file reads well. *No session ids* (D8): they mean nothing to others.

**Deletes.** A branch switch or `git checkout -- .durbar/notes.md` can drop sections that the person never meant to delete; treating "missing" as "deleted" would lose notes silently. So deletes happen in Durbar only, and the next write puts a still-existing note back in the file. Documented in the view's help line.

**Conflict markers.** A merge can leave `<<<<<<<` lines. Importing them would make junk notes and overwriting would lose the other side; so Durbar does neither until the file is clean (FR-054).

**Outside input (D7 corrected).** With the switch on, the file is written by others too: an agent with write rights, a teammate's commit after `git pull`, a cloned repo. Imports are therefore `from: file` (*From the project file*), edits set `fileEdited`, and the file is never read while the switch is off (except to count it in the turn-on dialog).

**Write race.** The hash is checked again right before the rename, so an edit made between Durbar's read and its write is imported instead of overwritten. Link swaps: the real path and `lstat` of `.durbar` are checked again right before the rename and the temp file is opened `O_NOFOLLOW` where the OS has it; Node has no `renameat`/`openat`, so a swap in the last few system calls stays possible (`[KNOWN GAP]` in FR-053).

**Keeping it out of commits (question A, owner-confirmed 2026-10-24).** Paco asked whether to recommend or offer `.git/info/exclude`. Default: offer it as a box, on by default, in the turn-on dialog; Durbar appends one anchored line (`/<rel>/.durbar/`) and never touches `.gitignore` (which is committed, so editing it would itself be a change in the person's repo). It runs no git: the file is found by walking up to `.git` (folder, or a worktree's `.git` file → `gitdir` → `commondir`). An exclude line does not untrack an already committed file; the dialog says so. The `.git` file's `gitdir`/`commondir` are untrusted (a planted file could aim the append anywhere), so the target must be a real git directory (regular `HEAD`, `objects/`, owned by the user on POSIX, an existing `info/`), and folder names are escaped for gitignore (`*?[\`, leading `!`/`#`, trailing spaces) with control characters refused (Paco's re-review of PR #702).

**Safety.** The lessons in `docs/agent-notes.md` (*Reading files a repo ships*, 2026-10-23): refuse links (`lstat`), check the real path is inside the folder, open non-blocking (a FIFO swapped in would freeze main), `fstat` must say regular file, size cap. Writing: temp in the same folder and rename (atomic on every OS; Windows `MoveFileEx` replaces, but fails while another program holds the file open without share-delete, hence one retry).

**Rejected.** YAML front matter per note (harder to keep a note's own `---` lines safe); one file per note (`.durbar/notes/<id>.md`: merge-friendly but clutters the project and the issue asked for `notes.md`); JSON in the project (unreadable for the person and the agent).

## R4 Masking: store raw or masked?

**Facts.** Constitution III: "Agent Durbar never reads, stores, logs or transmits tokens." The chat log shows agent output masked (spec 041 FR-065, `DurbarSafeText`); `redact` masks token shapes and env secrets (`src/shared/redact.ts:149`); `redactMarkdown` also catches tokens split by Markdown marks (`:171`). The project file may be committed (OD1).

**Decision.** Store masked, always (D3). Main masks title and text before every write (store, `notes.md`, export) with a new `maskNoteText(text)` next to `redactMarkdown`: it runs `redact` on the text as written (keeping the Markdown) and then masks, in that output, every token-like run that `redactMarkdown`'s plain-text pass finds (the same "both passes, neither wins" rule as `safetext.js` `both`). Display masks again (defence in depth). Imports from `notes.md` and typed notes are masked too: a token typed into a note is still a token.

**Known values (Paco's review of PR #702).** `redact` knows env secrets and token shapes only; a folder's MCP extra can carry a secret with no shape (a plain API key in `env` or a header), which an agent may echo in a reply. So `maskNoteText` first masks the values main already holds for masking MCP output: `extraSecretValues(folderKey)` (`src/main/mcp/readtools.ts:47`) and `secretValuesFor(agentId)` (`src/main/mcpipc.ts:82`, via `mcpSecretValues`, `src/main/mcpmask.ts:10`), in the order `maskMcpText` uses (values, then `redact`).

**Cost.** A real secret in a saved message cannot be recovered from the note. That is the point. The digest (FR-009) is of the raw text but is a 64-bit hash prefix of a long message, kept only locally, never shown.

Insert sends `[redacted]` where the secret was; the note's `hidden` flag makes FR-024 say so before sending. *(Default confirmed by the owner 2026-10-24, question B.)*

**Rejected.** Raw in the local store and masked only in `notes.md` (stores tokens: constitution III); an *unmasked* opt-in (same).

**Tests to copy.** The fuzz corpus of `scripts/test-redact.ts` (shapes inside Markdown, `_x_`, `%3D`, `\n` starts), the bare-token mask-before-cut rule (`docs/agent-notes.md`, 2026-10-23), linear time in CPU time on 20k vs 160k characters.

## R5 `/` or `#` in the composer

**Facts.** Spec 073 built the `/` list (`slashsuggest.js`; `tokenAt` opens it only at a word start, never inside a URL). #581 (no spec yet) asks for library prompts in `/`; Vikram's agent asked on #581 (2026-10-23) to make them "one more source in that list".

**Decision.** `/` (D1). Notes are a source `note` after the app's entries; a note entry carries `insertText`, so picking inserts the text, not `/name` (FR-030, FR-031). #581 can add its prompts the same way, so there is one picker and one set of keys.

**Rejected.** `#`: (1) `#123` (issues) and `# ` (Markdown headings) are typed in messages all the time, so a `#` picker would pop up during normal writing; (2) VS Code Copilot users read `#` as a context reference (`#file`), a different meaning; (3) a second picker doubles the keyboard and screen-reader rules to test.

**Crowding.** Notes come after commands, at most 5 with nothing typed, plus *All notes…*; typing filters them like commands.

## R6 Drawer or tab, and spec 080

**Facts.** Spec 080 FR-002 / spec 005 FR-057 (delta 2026-10-24, not built): tabs *Chat* and *Browser*; the composer is part of the Chat view. 080 FR-008: any overlay over the browser view hides the native view.

**Decision.** A drawer over the chat log of the Chat view (D2, FR-020, FR-025). *Insert* needs the message box visible; a third tab would hide it (or need the composer outside the tabs, a spec 080 change). Opening Notes from the Browser tab selects Chat first, so the drawer is never over the native view.

**Rejected.** A third tab (hides the composer); a popover (too small for search and 300 notes); a side split (waits for docking, #452).

## R7 The marker: emoji or icon

**Facts.** Constitution V: "No emoji, no blur filters in compact scenes." Compact scenes are the office's small desk densities; the chat log is not one. The chat already uses SVG icons for its marks (`ICON(...)`, `CT_IC` in `src/renderer/app.js`), coloured by theme tokens (spec 070), and a theme-token ratchet counts colour literals (`test:theme-tokens`).

**Decision.** An SVG note icon (D4, FR-041). The emoji is not forbidden in the chat, but it renders differently per OS (and as a box on a Linux without a colour emoji font), cannot follow the theme, and would be the only emoji mark in the chat. Ruben may still ask for the emoji (owner question Q1; Paco agrees with the SVG; owner-confirmed 2026-10-24); the change would be one line.

## R8 Shortcut

**Facts.** `TAKEN` (`src/renderer/navigator.js:160`) has no `mod+shift+KeyM`; the global keydown handler has no M (`read:` the handler at `src/renderer/app.js:2324-2390`); macOS `⌘M` (minimize, no Shift) is taken, `⌘⇧M` is not a system shortcut; Electron's default menus (`src/main/appmenu.ts`) use none. IBus owns Ctrl+Shift+U and E on Linux (already in `TAKEN`), not M.

**Decision.** Ctrl+Shift+M / ⌘⇧M ("memo", D5), added to `TAKEN`; `scripts/test-navigator.ts` scans the handler, so it fails if the handler uses it without the row. A person who already recorded it for Go to keeps it (FR-026).

**Rejected.** Ctrl+Shift+N (taken: next agent), Ctrl+Shift+E (IBus emoji), Ctrl+Shift+B ("bookmark": free, but less clear than memo; kept as the fallback if a clash shows up).

## R9 Caps

One `NOTES_LIMITS` object: `textChars` 16,000 (a long agent answer is 2-8k; spec 073 caps an expanded prompt file at 64 KB, a note is smaller), `titleChars` 80, `notesPerFolder` 300, `tombstones` 300. **Byte caps are derived, not chosen** (Paco's review of PR #702 found a 1 MB read cap for a file Durbar could write at about 4.8 MB, and JSON escaping able to pass the 16 MB store cap): control characters other than tab and line feed are removed on save, so one character costs at most 3 bytes of UTF-8 written raw or 2 bytes as a JSON escape; `storeBytes` and `mdBytes` are computed from the character caps (about 15 MB each at these values), the reader refuses above them, and the writer refuses to write above them. The last-written SHA-256 of `notes.md` is persisted in the store document, so a restart does not mistake Durbar's own file for an outside edit.

## R10 Source gone, search, export, delete

- **Source gone (D11)**: the note never depends on its source. *Open source* finds the session among office agents (`resumeIdFor`), then Previous sessions (spec 006's list and open path), else says so. The message is found by digest (role first, `ord` breaks ties).
- **Search**: in the window, over the folder's notes already loaded (at most 300); `DurbarNav.rank` for titles, a substring for the masked text. No index on disk. Ctrl+K only gets a *Notes of <folder>* entry; full-text search across chats is #430.
- **Export**: the `notes.md` format, through main's save dialog, 0600. **Delete**: per note and *Delete all…*, with tombstones. **Remove folder** keeps notes by default, with an unticked *Also delete its notes* box (question C, owner-confirmed 2026-10-24), the only way to delete a removed folder's notes without adding it back. Any data-reset path (none today besides usage totals) must include `notes/`. #559 later.

## R11 Simulator hooks and checks

- `sim.ts`: in-memory notes per room; `simnotes=some|many|long|secret`; the switch answers *Demo: no file written*.
- Unit: `scripts/test-notes.ts` (model, caps, title guess, mask, merge, two stores, corrupt file, IPC validation with fakes), `scripts/test-notesmd.ts` (format, property round trip, conflict markers, CRLF input, escapes, links, FIFO, Windows retry with a fake `fs`).
- Driver: `scripts/check-notes.js` (asserting, added to `ui-suite.js`): save, drawer keys, Insert, `/`, header count, marker, selection, search, view, 480px header, masking with `simnotes=secret`; screenshots at 1440x900 and 1280x800 (`DURBAR_SIM=15`). `check:office` with the drawer open. `npm run shots:docs -- --only <driver>` for any linked picture the change touches.

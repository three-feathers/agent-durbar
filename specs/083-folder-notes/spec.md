# Feature Specification: Notes: save an idea or a message from a session and carry on with it later

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Notes (issue #699): save a message, a selection or a typed idea per folder and carry on with it; a Notes drawer in the chat (Ctrl+Shift+M), insert with one click or from the `/` list, a header count and a saved-message icon; stored masked in local data (0600), opt-in mirror to `.durbar/notes.md` per folder
status: building
note: MVP built; selection save, per-folder screen, project file not built
-->

**Feature Branch**: `083-folder-notes` (touches 005 chat panel and message actions, 073 the `/` list, 074 the shortcut list, 006 the folder menu, 010 simulator)

**Created**: 2026-10-24

**Status**: In progress (2026-10-26): T010..T032 built (store, masking, IPC, simulator, the MVP in the window, the header count, the marker and the search); T033..T050 not built

**Input**: Owner request (Ruben, 2026-10-24, issue #699): "While working in a session, I sometimes get an idea, a good answer from the agent, a plan or a list of next steps that I want to keep and come back to later, often to carry on in that same session or in a new one." Owner decisions in the issue's decision comment (Ruben, 2026-10-24), quoted below.

## Owner decisions (binding)

Ruben (owner), 2026-10-24, issue #699 (body and decision comment):

- **OD1 Storage, option C.** Notes live in Durbar's own local data by default (private, mode 0600). Each folder can opt in to also keep them as `.durbar/notes.md` in the project, with a warning that the file may get committed. Durbar never runs `git add` on it.
- **OD2 Notes are reachable inside the chats**, not only from a separate view:
  - a Notes tab or drawer in the chat panel, next to *Chat* (and *Browser*, spec 080): this session's notes first, then the folder's; save, edit and search there;
  - insert a note into the message box with one click from the drawer, or from the composer with `/` or `#` (the spec picks one, consistent with #581's `/` picker); the text is never sent by itself;
  - a small notes count in the chat header when the session or folder has notes;
  - a discreet marker on a message already saved (the owner wrote 📝; see FR-041 for the constitution check);
  - a keyboard shortcut to open the drawer, checked against the navigator's `TAKEN` list (#548, #587).
- **OD3** The per-folder Notes view stays as the place to manage all notes; the chat drawer is what you use day to day.
- **OD4** (issue body) Saving: from a message's `⋯` → *Save to notes*, from a text selection, or *+ Note* by hand. Each note keeps its Markdown text, a title (editable, guessed from the first line), when it was saved, and a link to the session and message it came from.

## Decisions taken by the coordinator (under Ruben's delegation, 2026-10-24)

Each one is *decided by the coordinator under Ruben's delegation*; the reasons and the rejected options are in [research.md](research.md).

- **D1 `/`, not `#`** (R5). Notes are one more source in spec 073's `/` list (the list #581 will also extend). `#` is rejected: people type `#123` for issues and `# ` for headings in messages, and VS Code users know `#file` as a context reference.
- **D2 A drawer of the Chat view, not a third tab** (R6). Inserting needs the message box, which belongs to the Chat view (spec 080 FR-002, spec 005 FR-057). The drawer covers the chat log only; the composer stays usable under it. With spec 080's tabs, opening Notes switches to *Chat* first.
- **D3 Notes are stored masked** (R4). Main masks every note (title and text, whatever its source, typed by hand too) with the shared masking before anything is written; the raw text is never stored. Display masks again (`DurbarSafeText`). The mask also uses the secret values Durbar knows for that folder and session (FR-005). A secret in a saved message is therefore not recoverable from the note, and *Insert* puts `[redacted]` in the message box where it was, with a visible note (FR-024): safe by default (constitution III: Durbar never stores tokens). *(Unrecoverable, and insert sends `[redacted]`: owner-confirmed 2026-10-24, Paco's question B on PR #702.)*
- **D4 A marker icon, not the emoji** (R7). Constitution V forbids emoji in compact scenes; the chat log is not one, so 📝 is not strictly forbidden there. Durbar draws every other mark in the chat with its own SVG icons (themeable, same on every OS); an emoji depends on the OS font (a Linux without a colour emoji font shows a box). So the marker is a small SVG note icon with the words *Saved to notes* for screen readers and in its tooltip.
- **D5 Shortcut Ctrl+Shift+M (⌘⇧M on a Mac)** ("memo"), free in `TAKEN` today (`read:` `src/renderer/navigator.js:160`); added there.
- **D6 Per folder only.** No global inbox (the issue's question): every note belongs to one folder. `[OUT OF SCOPE]` here (FR-090).
- **D7 Durbar gives the agent no notes tool** in this spec (that needs a spec 041 tool, gated by mode; `[OUT OF SCOPE]`, FR-091). But while a folder's project-file switch is on (FR-050), anything that can write the project folder (an agent with write rights, a `git pull` of someone else's file, an editor) can add or change notes through `.durbar/notes.md`. Such notes are never trusted as the person's own: they are marked `from: file`, *From the project file*, everywhere a note shows (FR-054; corrected after Paco's review of PR #702).
- **D8 The project file holds no session ids.** `.durbar/notes.md` may be committed and shared; session ids and message anchors mean nothing to anyone else, so they stay in the local store only.
- **D9 The local store is the source of truth; the project file is a mirror that also takes edits** (R3). A block removed from `notes.md` (a branch switch, a merge, a hand edit) never deletes a note in Durbar; deletes happen in Durbar.
- **D10 No change on the office floor.** The issue proposed a count on the folder; this spec puts *Notes (N)…* in the folder's `⋯` menu and Ctrl+K instead, so the 15-agent layout does not change.
- **D11 A gone source keeps the note.** When the session or the message a note came from is gone, the note stays, with the words *Source no longer available*.

## What exists today (look for an existing capability first)

`read:` on `main` at 7d3465b7, 2026-10-24.

| Need | Existing capability, reused | Gap |
| --- | --- | --- |
| A message's `⋯` menu | None: messages have only a *Copy* button on agent replies (`addCopyButtons`, `src/renderer/app.js:3158`, spec 005 FR-015). The issue assumed a menu exists. | New per-message `⋯` button, built on the shared menu element `#modeMenu` / `.mode-menu` and the keyboard pattern of the Previous sessions row menu (`openPrevMenu`, `src/renderer/app.js:5896`, spec 006 FR-027: arrows, Esc, right-click, Shift+F10). |
| Dialogs for *+ Note*, Edit, Rename, Delete | `askDialog` with `input.multiline` (`src/renderer/dialog.js:3`, spec 064) | none |
| The `/` picker | Spec 073: `slashsuggest.js` (`tokenAt`, `filter` with `DurbarNav.rank`, `optionHtml`), `slashUpdate` / `slashPick` in `src/renderer/app.js:2050-2110` | A second kind of entry that inserts text instead of `/name`; the list opens only where the adapter lists commands (`slashSupported`, `app.js:2036`). |
| Masking | `redact` / `redactMarkdown` (`src/shared/redact.ts:149`, `:171`), `DurbarSafeText.mask` in the window | A structure-keeping mask for stored Markdown (FR-005). |
| Per-folder data on disk | `FolderStore` (`folders.json`, ids and choices only, `src/main/folders.ts:47`), `FolderSetupStore` (atomic `tmp` + rename, 0600, `src/main/foldersetupstore.ts:39`), `folderFingerprint` (`src/main/usagetotalsstore.ts:29`: SHA-256 of the normalised folder key, never a path on disk) | A store with content in it (notes), one file per folder. |
| The session a message belongs to | `resumeIdFor` in main (`src/main/main.ts:593`) | none |
| Screens | `screens.js` (Schedules, Tools) and `#screen` | A Notes screen per folder. |
| Search ranking | `DurbarNav.rank` (spec 074) | none |
| Shortcut clash rules | `TAKEN` and `clashOf` (`src/renderer/navigator.js:160`), the handler scan in `scripts/test-navigator.ts:222` | one row |
| Simulator | `src/renderer/sim.ts` canned bridge (spec 010) | notes calls |
| #581 prompt library | Not specified yet (issue open, no spec, 2026-10-24). | Notes define the text-inserting `/` entry that #581 can reuse (FR-031). |
| #430 search across chats | Not built. | Out of scope (FR-093). |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Save a reply and use it again in the same chat (Priority: P1) MVP

The agent writes a good plan. I open the reply's `⋯` and choose **Save to notes**. A toast says *Saved to notes*. Later, in the same chat, I press Ctrl+Shift+M: the Notes drawer opens over the chat log with *This session* first. I press **Insert** on the plan: its text lands in the message box under what I had typed. I add "do step 2 now" and send it myself.

**Why this priority**: it is the need in one loop: keep it, find it, carry on.

**Independent Test**: simulator chat; save a canned reply, close and reopen the app with the same `DURBAR_USER_DATA` (main store) or the sim store (renderer), open the drawer, insert. Zero credits.

**Acceptance Scenarios**:

1. **Given** a finished agent reply, **When** I choose `⋯` → *Save to notes*, **Then** a note is stored with the reply's Markdown (masked), a title from its first line, the time, and a link to this session and message; a toast confirms (FR-010, FR-011).
2. **Given** the same reply saved before, **When** I save it again, **Then** no second note is made; the toast says *Already in notes* with *Show* (FR-011).
3. **Given** an open chat, **When** I press Ctrl+Shift+M (⌘⇧M), **Then** the drawer opens with focus on its first row; the same keys or Esc close it and focus returns to where it was; a second Esc then closes the chat as before (FR-020, FR-026).
4. **Given** the drawer, **When** I press *Insert* on a note, **Then** its text goes into the message box at the caret (a blank line before it when the box has text), nothing is sent, and focus is in the box (FR-024).
5. **Given** I type `/pla` in the message box, **When** the `/` list opens, **Then** it shows the note *Plan…* in a *Notes* group after the commands; Enter puts the note's text in place of `/pla` (FR-030).
6. **Given** a note saved from a reply that held a token, **When** I look at the note on disk, in the drawer or after inserting it, **Then** the token is masked everywhere (FR-005).

---

### User Story 2 - See at a glance what I saved (Priority: P2)

In a chat with saved notes, the header shows a small **Notes 3** button. Messages I saved show a small note icon next to their time. I search the drawer for "migration" and find the note from yesterday's session.

**Why this priority**: makes notes discoverable and stops double saves; not needed for the first loop.

**Independent Test**: simulator with `simnotes=some`; header, marker and search checked by a driver.

**Acceptance Scenarios**:

1. **Given** a folder with 3 notes (1 from this session), **When** its chat is open, **Then** the header shows *Notes 3* with the tooltip *1 from this session, 3 in this folder*; with 0 notes it is not shown (FR-040).
2. **Given** a saved message, **When** its chat shows it (live or replayed), **Then** it has the note icon with *Saved to notes* in its accessible name; the icon opens the drawer on that note (FR-041).
3. **Given** the drawer, **When** I type in its search field, **Then** both groups filter by title and text (masked), titles ranked like Ctrl+K (FR-043).

---

### User Story 3 - Save part of a message (Priority: P2)

I select two lines of a long reply. A small **Save to notes** button appears near the selection; it saves just those lines, with the link to the message.

**Independent Test**: simulator driver selects a range in a bubble.

**Acceptance Scenarios**:

1. **Given** a selection inside one message, **When** I press the button (or `⋯` → *Save selection to notes*), **Then** only the selected text is saved, linked to that message (FR-042).
2. **Given** a selection across two messages or outside the chat log, **Then** no button appears.

---

### User Story 4 - Manage all notes of a folder (Priority: P2)

From the folder's `⋯` menu I open **Notes (12)…**: every note of the folder, newest first, with search, *Done*, Edit, Rename, Delete, *Delete all…*, *Export…*, and the switch to keep them in the project too.

**Independent Test**: simulator; the screen opens from the folder menu, Ctrl+K and the drawer's *All notes of this folder…*.

**Acceptance Scenarios**:

1. **Given** a folder with notes, **When** I open its Notes view, **Then** all notes show, done ones in a folded *Done (N)* group (FR-044, FR-045).
2. **Given** *Export…*, **When** I pick a file, **Then** a Markdown file in FR-052's format (no session ids) is written, mode 0600 (FR-048).
3. **Given** *Delete all…*, **When** I confirm (No focused), **Then** the folder's notes are gone from the local store (FR-048).

---

### User Story 5 - Keep the notes in the project for the agent and the team (Priority: P2)

In a folder's Notes view I turn on **Also keep these notes as `.durbar/notes.md` in the project**. A warning says the file may get committed and pushed, that Durbar never adds it to git, and how many notes an existing file would bring in; a box (on) keeps `.durbar/` out of my commits through `.git/info/exclude`. From then on the file mirrors the notes; I can ask an agent to "read .durbar/notes.md", or edit the file in my editor and see the edit in Durbar.

**Independent Test**: unit tests on a temporary folder (format, round trip, imports, symlinks, conflicts); the simulator shows the switch but writes nothing.

**Acceptance Scenarios**:

1. **Given** the switch off (default), **Then** no file is written in the project (FR-050).
2. **Given** I turn it on, **When** the warning is confirmed, **Then** `.durbar/notes.md` is written in FR-052's format, masked, with no session ids (FR-050..FR-053).
3. **Given** I edit a note's text in `notes.md` in my editor, **When** I next open the drawer or Durbar writes, **Then** Durbar takes the edit (masked) (FR-054).
4. **Given** `notes.md` has git conflict markers, **Then** Durbar neither imports nor overwrites it and says why (FR-054).
5. **Given** I turn the switch off, **Then** Durbar stops writing and asks whether to leave or delete the file; it deletes only a file that is exactly what it last wrote (FR-055).
6. **Given** a cloned repository whose committed `.durbar/notes.md` has 4 notes and the switch off, **Then** Durbar never reads the file; **When** I turn the switch on, **Then** the dialog says *4 notes in the existing file will be added* and, after I confirm, they show as *From the project file* (FR-050, FR-054).

---

### User Story 6 - Go back to where a note came from (Priority: P3)

In the drawer I choose **Open source** on a note: the chat it came from opens and scrolls to the message, which is outlined for a moment. If that session is gone, the note says so and stays.

**Acceptance Scenarios**:

1. **Given** a note from a session open in the office, **When** I choose *Open source*, **Then** that chat opens and the message is scrolled into view inside the chat log (FR-046).
2. **Given** a note from a previous session, **Then** it opens the way Previous sessions opens it (no message is sent), then scrolls (FR-046).
3. **Given** the session is gone or the message cannot be found, **Then** the note stays and a toast says which (FR-046, D11).

### Edge Cases

- **Two windows or two Durbar processes.** Durbar has one window, but two Durbar processes on the same profile are possible (no single-instance lock, `read:` `src/main/main.ts:760`). Each write re-reads a file that changed under it and merges by note id (FR-008); an edit made on an old copy is refused as *stale* and the window offers to reload (FR-008).
- **Two chats of the same folder.** Both drawers show the same folder notes; a save in one shows in the other when it repaints (main tells the window, FR-062).
- **A helper (sub-agent) chat.** Notes belong to the root session's folder and link to the root session.
- **Demo chats** use the simulator store and never write to disk (FR-060).
- **A streaming reply** has no `⋯` until it ends (like *Copy*, spec 052 FR-170).
- **A very long message.** Masked first, then cut to the cap at a line end, with a visible last line *[Cut: the message was longer than 16,000 characters.]* (FR-006).
- **The 301st note** of a folder is refused with a reason (FR-006).
- **A corrupt or oversized store file** is never overwritten; the folder's notes are read-only with a banner and a *Start over* choice (FR-007).
- **The folder is removed** from Durbar: its notes stay unless *Also delete its notes* is ticked in the Remove folder dialog; re-adding the folder shows them again (FR-048).
- **A VS Code workspace (`.code-workspace`)** has notes, but the project-file switch is not offered (no single project folder) `[KNOWN GAP]` (FR-050).
- **`notes.md` is a symlink, a folder, a FIFO, or `.durbar` is a link out of the project**: refused, nothing written or read (FR-053, FR-054).
- **A cloned repository with a committed `.durbar/notes.md`**: never read while the switch is off; turning it on says how many notes it adds, and they are marked *From the project file* (FR-050, FR-054).
- **An agent edits `notes.md` while Durbar is about to write**: the hash check right before the rename finds it; the edit is imported, not overwritten (FR-053).
- **Windows: the editor holds `notes.md` open** and the rename fails: one retry, then the error is shown; the local store is unaffected (FR-053).
- **macOS folder-key case.** The fingerprint reuses `normaliseFolderKey`, which lower-cases on Windows only (`src/shared/usagedoc.ts:136`); on macOS, the same folder added with a different case gets a separate notes file, as usage totals do today `[KNOWN GAP]` (constitution VI).

## Requirements *(mandatory)*

### Storage and model

- **FR-001** Notes belong to one folder, keyed by the folder key Durbar already uses (`workspaceFile` else `cwd`, `folderKeyOf`, `src/shared/usagedoc.ts:122`). A helper's notes belong to its root session's folder.
- **FR-002** **Local store (OD1).** One file per folder, `<userData>/notes/<fingerprint>.json`, where the fingerprint is `folderFingerprint(folderKey)` (`src/main/usagetotalsstore.ts:29`). The folder `notes/` is created owner-only (0700) and each file 0600 (POSIX; on Windows the profile folder's ACL applies, as for every Durbar file). The file holds the notes and the folder's display name, never its path. Writes are atomic: a unique temp file in the same folder opened with `wx`, then rename.
- **FR-003** **A note** has: `id` (`n-` and 12 random lowercase letters or digits, uniform, as `randomPlaceId`), `title` (1 to 80 characters, no control characters), `text` (Markdown), `createdAt`, `updatedAt` (ISO 8601 UTC), `rev` (a counter, +1 per change), `done` (boolean), `from` (`agent`, `user`, `selection`, `typed` or `file`), `fileEdited` (true when the project file changed it after it was saved, FR-054), `hidden` (true when masking changed the title or text when it was saved or edited, FR-005, FR-024) and, when it came from a chat, `source`: `{ app, session, role, ord, digest, at }` (agent app id, its session id, `user` or `agent`, the message's place among that role's messages in the chat, a digest of its text, its time).
- **FR-004** **Title guess.** The first non-empty line, Markdown marks removed (headings, list marks, emphasis, links), cut at a word to 80 characters; an empty result is *Note of 24 Oct 10:12*. Editable with *Rename…* (OD4).
- **FR-005** **Masked before stored (D3, constitution III).** Main masks `title` and `text` of every note, whatever its source (a message, a selection, typed by hand, an edit, an import from `notes.md`), before it is written to any file, with one shared function `maskNoteText(text, values)` in `src/shared/redact.ts` that keeps the Markdown as written and masks, in this order: (1) the **known secret values** main has for that folder and session, `values` (the folder's MCP extras' env and header values, `extraSecretValues(folderKey)` as `src/main/mcp/readtools.ts:47` gets them, and the session's values that `secretValuesFor` gives `maskMcpText`, `src/main/mcpipc.ts:82`, built with `mcpSecretValues`, `src/main/mcpmask.ts:10`; values under 4 characters skipped, longest first, as `maskMcpText` does), so a secret that has no token shape (a plain MCP extra's value) is masked too; (2) what `redact` finds (env secrets and token shapes); (3) every token-like run `redactMarkdown` finds on the Markdown-free text (so a token split by `**` or a backtick is masked too). An import from `notes.md` and a typed note use the folder's values (no session). When masking changed anything, the note's `hidden` is set (FR-003). Honest limits (also in *Honest limits*): a secret the person saved on purpose is lost (only `[redacted]` is kept); a secret that is neither a known value nor a known shape is stored as written. The raw text is never stored, logged or sent back to the window; it lives only for the IPC call. Every place that shows a note (drawer, view, `/` list, tooltips, toasts, announcements) masks again with `DurbarSafeText` (spec 041 FR-065), failing closed. *Mask, then cut*, never the other way round. **Controls first (review of the foundation, 2026-10-24):** main removes control characters (`stripControls`, FR-006) from title and text BEFORE the mask, in save, add, update and the title guess, so a token or a known value split by `U+0001`, `U+001B`, `U+0085`, `U+007F` or `U+000B` is still masked; the simulator does the same. **Known values without a prompt:** the folder's values are `McpStore.knownSecretValues(folderKey)` (every secret value of the folder's extras, enabled or not, trusted or not, 4 characters or more, longest first) and the session's `secretValuesFor`; `update` uses both, like save. Neither ever decrypts the vault: `knownSecretValues` returns only values already in memory, and the session's values are read only when `McpStore.noPrompt()` says nothing waits in the vault, so a notes save never causes an OS keychain prompt. `[KNOWN GAP]` While the vault is still locked (no session of that folder has started this run and its values were not typed this run), the known values are not used and only the shapes are masked; a plain value with no token shape is then stored as written.
- **FR-006** **Caps, from one object.** Every cap lives in one `NOTES_LIMITS` object in `src/shared/notes.ts`, and every byte cap is **derived** from the character caps there, never written as its own number, so Durbar never writes a file larger than it will read back (Paco's review of PR #702: the earlier 1 MB read cap for a file Durbar could write at ~4.8 MB, and JSON escaping past 16 MB): **Controls (same review):** a title typed or renamed by the person that contains a control character (a line end and a tab included) is refused with *The title is empty or has control characters.*; in text they are removed, as above. A derived title (the guess, an import) is built from text already stripped.
  - `textChars` 16,000 after masking (longer: cut at the last line end before the cap, plus the visible line *[Cut: the message was longer than 16,000 characters.]*); `titleChars` 80; `notesPerFolder` 300 (the next save is refused with *This folder has 300 notes. Delete or export some first.*); `tombstones` 300 (FR-008), oldest dropped first.
  - Control characters other than tab and line feed are removed from title and text when saved, so a JSON escape costs at most 2 bytes per character (`\"`, `\\`, `\n`, `\t`) and a stored character at most 3 bytes of UTF-8.
  - `noteJsonBytes` = 3 × (`textChars` + `titleChars`) + a fixed allowance for the other fields (ids, times, source); `storeBytes` = `notesPerFolder` × `noteJsonBytes` + `tombstones` × the tombstone size + the document's own fields. A store file over `storeBytes` is not read (FR-007).
  - `noteMdBytes` = 3 × (`textChars` + `titleChars`) + one escape byte per possible marker-like line + the marker line; `mdBytes` = `notesPerFolder` × `noteMdBytes` + the header. `notes.md` over `mdBytes` is not read (FR-054).
  - **Never write what would be refused:** before every write main measures the serialised bytes; a store document or `notes.md` over its cap is not written, the change is refused with the reason, and the files on disk stay as they were. Tests check that a folder filled to every character cap (300 notes of 16,000 three-byte characters, all quotes and backslashes, marker-like lines) writes and reads back, and that one byte more is refused.
- **FR-007** **A file Durbar cannot read is never overwritten.** Unknown `version`, invalid JSON, over the cap, or not a regular file: that folder's notes are read-only (saving is refused with the reason), the drawer and view show *Durbar could not read the notes file of this folder; it is left as it is.* with **Start over…** (`askDialog`, *Cancel* focused), which renames the file to `<fingerprint>.json.bad-<UTC time>` (0600) and starts an empty one. **A file with a note Durbar cannot parse** (the parser drops that note) is read-only too: the good notes show, saving is refused with *N notes in this folder's notes file could not be read; the file is left as it is.*, and only Start over moves it aside, so Durbar never rewrites a file without them. **Start over** is refused unless the folder's file is unreadable or read-only (nothing to start over otherwise). **A file that disappeared** after this process saw it is an empty document, not the cached copy.
- **FR-008** **Concurrency.** Main is the only writer in a process and queues writes per folder. Every change from the window carries the note's `rev`; a different `rev` in the store refuses the change with `stale`, and the window shows the saved version with *Keep mine* / *Use the saved one*. Before each write main compares the file's size, modification time and inode (Windows: file index) with its last read or write; when another process changed it, main reads it again and merges by `id` (the higher `updatedAt` wins; a tombstone `{id, deletedAt}` wins over an older edit), then applies the change. Tests run two stores on one file. **Lock file (review of the foundation):** every change (load, write, rename) runs under `<fingerprint>.lock`, created with `wx`; a lock older than 5 s is a crashed process's and is taken over; a busy one is retried every 20 ms for up to 2 s, then the change is refused with *The notes are busy (another Durbar is writing them). Try again.* A stale lock is first moved to a name of its own (`<fingerprint>.lock.stale-<pid>-<random>`), checked to be the lock judged (same inode and time) and only then deleted; a lock that cannot be moved or removed (EPERM, EACCES, EBUSY) is waited on like a busy one and refused after 2 s, never retried in a tight loop; Start over checks its condition again under the lock. A failure to create the lock with EPERM, EACCES or EBUSY (on Windows, a lock another process just deleted can still be delete-pending) is waited on like a busy lock, never refused at once and never retried in a tight loop; `[KNOWN GAP]` this is reasoned, not verified on Windows. **Takeover guard and lock token (2026-10-26, issue #723):** only the holder of a short-lived `<fingerprint>.takeover` guard (created with `wx`, holding a random token) may break a stale lock, and it looks at the lock again under the guard. A stale lock or guard is broken by moving it aside and checking it is the file that was seen (same inode and same time in nanoseconds) before deleting it, not by a bare delete. The lock holds a random token as well: a holder writes only while the token is still its own, so a holder paused over 5 s that lost its lock refuses with the busy text. A lock or guard is released by checking the token first (a file that is not ours is not touched), then moving it aside, reading the token in the moved file, deleting it if it is ours and putting it back (non-overwriting hard link) if it is not, so a takeover between the check and the delete does not remove the new owner's lock. A read error on the lock other than *missing* (Windows antivirus, EBUSY) is retried a few times 20 ms apart before it counts as lost. Under the guard, `.stale-*` and `.rel-*` files that a crash left for this folder and that are older than 60 s are deleted (other folders' files are never touched). A crashed taker's guard can delay the next takeover by up to 5 s more (writes in that window answer busy after about 2 s). `[KNOWN GAP]` Narrowed, not closed. Remaining windows: (1) a release first checks the token and touches nothing that is not ours; only if a takeover lands between that check and the move (or an identity check finds a different file) is a put-back needed, and then the name is free for a few system calls, a newcomer can take it, the put-back fails and the moved file is dropped; (2) if the move-aside itself is refused (for example EPERM on Windows), the release checks the token again and deletes by path, so a takeover in that instant is still a race; (3) the ownership check happens before `commit()` (temp write, fsync, rename) and nothing re-checks during it, so a holder judged stale and replaced inside that whole window can still write as a second writer; (4) a sweep can delete a `.rel-*` file of a release that has been running for over 60 s. The file is written atomically and the next read merges by id. `[KNOWN GAP]` Written from the code and tested on Linux only. Not run on Windows or macOS: delete-pending EPERM/EACCES/EBUSY on the `wx` create, antivirus EBUSY on reading the lock, `bigint` `ino` and `mtimeNs` from NTFS and APFS, hard links (`linkSync`) on FAT/exFAT or network shares, and whether renaming an open or just-closed lock aside behaves as on Linux. Tested with two and four real processes writing at once.
- **FR-009** **The link is made in main.** The window sends the agent id, the role, the message's `ord` and its raw text; main looks the agent up (never trusting a session id from the window), takes the session from `resumeIdFor`, computes `digest` as the first 16 hex characters of SHA-256 of the raw text with `\r\n` turned into `\n` and the ends trimmed, masks the text (FR-005) and stores it. A 64-bit digest of a long text cannot give the text back; it is still never shown.

### Saving (US1, US3)

- **FR-010** **A `⋯` on every finished message** (an agent reply's bubble and the user's own message; not a tool chip, a thinking block or a request card), next to the existing *Copy*, dimmed but visible at rest, brighter on hover and focus, exactly like *Copy* (spec 052 FR-010; decided by the coordinator under Ruben's delegation, 2026-10-26), with the name *Actions for this message*. It opens the shared menu element (`#modeMenu`, `.mode-menu`) with the Previous sessions row menu's keyboard rules (arrows, Home, End, Esc and Tab close and return focus; right-click, Shift+F10 and the context-menu key on a message open the same menu). Items: **Save to notes** (or **Show in notes** when already saved), **Save selection to notes** (only with a selection inside that message, FR-042), **Copy** (the same as the button). In demo chats too.
- **FR-011** **Save to notes** saves at once, without a dialog, and shows a toast *Saved to notes* with **Rename…** and **Show** (opens the drawer on it). Saving a message whose `session` and `digest` match an existing note makes no new note: the toast says *Already in notes* with **Show**.
- **FR-012** *+ Note* (drawer and view): `askDialog` with a multiline input (*Note*, at most 16,000 characters) and *Save*; the title is guessed (FR-004); `from: typed`, no source.
- **FR-013** **Edit…** opens the same multiline dialog with the note's text; **Rename…** a one-line dialog for the title (the spec 059 pattern). **One rule for what these fields show: the window masks the stored text (and title) once more before it is shown, with the helper Insert uses (`noteBoxText`), and does not open the dialog at all when that mask is unavailable (fail closed).** Both send `rev` (FR-008).
- **FR-014** **Delete…** asks (`askDialog`, *Cancel* focused) *Delete the note "<title>"? This cannot be undone.*; focus goes to the next row, else the previous, else *+ Note* (the FR-027 rule of spec 006).

### The drawer in the chat (US1, OD2, D2)

- **FR-020** **A Notes drawer in the chat panel.** It covers the chat log's box (`#chat`) only: the header, the answer bar and the composer stay visible and usable. `role="region"`, name *Notes*. It is a region of the chat, not a dialog, so it is deliberately **not a focus trap**: Tab can leave it for the header and the message box (decided 2026-10-26). Opened by **Notes…** in the chat's More menu (always there in a main chat), the header count (FR-040), Ctrl+Shift+M (FR-026), Ctrl+K *Notes* and a toast's *Show*; closed by its *Close* button, the same keys or Esc (Esc closes the drawer first, then a second Esc closes the chat as today). The chat log keeps updating under it. Its open/closed state is per window, not saved.
- **FR-021** **Order.** *This session* (notes whose `source.session` is this chat's session), newest first; then *This folder* (the others), newest first; done notes are not in these groups (FR-045). Empty: *No notes yet. Save a message with its ⋯ menu, or add one.* with *+ Note*.
- **FR-022** **A row** shows the title, the time (*24 Oct 10:12*), where it came from (*You*, the agent's name, *Selection*, *Typed*, *From the project file*; *Changed in the project file* when `fileEdited`) and up to two lines of the text as plain words (`DurbarSafeText.excerpt`), with **Insert** (the first button), **Edit…** and a `⋯` with *Rename…*, *Copy*, *Delete…*, *Open source* (FR-046) and *Mark done* (FR-045). Footer: *+ Note* and *All notes of this folder…* (FR-044).
- **FR-023** **Keyboard.** ArrowUp and ArrowDown move between rows (roving `tabindex`), Enter on a row is *Insert*, Tab goes to the row's buttons; every control has a name.
- **FR-024** **Insert (OD2).** The note's text goes into the message box at the caret; when the box has text and the caret is not at a line start, a blank line goes first. The text is never sent by itself. The box grows (spec 005 FR-044) and gets the focus with the caret after the inserted text; the live region says *Inserted the note "<title>"*. When the note's `hidden` is set (FR-003), a note right above the message box says *Parts of this note were hidden when it was saved* (`role="status"`, kept until the box is sent or emptied), so the person sees before sending that `[redacted]` stands where a secret was; a note `from: file` also says *From the project file*. The same notes show when a note is picked from the `/` list (FR-030). In a chat without a usable message box (a helper, a read-only VS Code chat) *Insert* is disabled with its reason.
- **FR-025** **Next to spec 080's Browser tab (D2).** Notes is a drawer of the Chat view, not a third tab. While the Browser tab is selected, opening Notes selects *Chat* first. The drawer is never drawn over the browser view, so spec 080 FR-008 does not apply to it. Until spec 080's tabs exist, nothing about tabs changes.
- **FR-026** **Shortcut (OD2, D5).** Ctrl+Shift+M on Windows and Linux, ⌘⇧M on a Mac, opens or closes the drawer in an open main chat, also from the message box. It is added to `TAKEN` (*the Notes drawer*), so Go to cannot record it, and it is listed in the keyboard help (`?`) and on the More item. When a person's saved Go to combination is already Ctrl+Shift+M, Go to keeps it and the Notes shortcut does nothing (no shortcut is taken away).
- **FR-027** Notes are not offered while the chat is the read-only VS Code chat view (spec 009): no `⋯` save there `[OUT OF SCOPE]`.

### Inserting from the composer (US1, D1)

- **FR-030** **Notes in the `/` list.** Typing `/` in a main chat's message box (spec 073 FR-008 rules for where `/` opens) also lists this folder's notes that are not done, in a group *Notes* after the agent app's entries: this session's first, then the folder's, each by the same ranking as the commands (`DurbarNav.rank` on the title, the first 200 characters of the masked text as keywords). With nothing typed after `/`, at most 5 notes show, plus *All notes…* (opens the drawer). A note row shows a note icon and the title on the first line (the title gets the whole line), then on a second line *note · this session*, *note · this folder* or *note · project file* (`from: file`). Picking a note (Tab, Enter, click) replaces the typed `/word` with the note's text (FR-024's rules), never `/name`, and never sends. The list opens in every main chat that has notes, also where the agent app lists no commands (today `slashSupported` needs adapter support, `src/renderer/app.js:2036`). The announcements count commands and notes apart (*3 commands, 2 notes*).
- **FR-031** **A text entry kind for #581.** The `/` list's entry gets an optional `insertText` (and `source: 'note'`): such an entry inserts that text instead of `/name`. #581's prompts are meant to use the same kind (Vikram's agent's note on #581, 2026-10-23), so there is one picker.

### Seeing what is saved (US2)

- **FR-040** **Header count (OD2).** A small button *Notes N* (N = the folder's notes that are not done) in the chat header's meta row when N > 0, with the tooltip *M from this session, N in this folder*; it opens the drawer (`aria-expanded`, `aria-controls`). It fits the 480px panel (spec 005 FR-040, FR-058) and moves into `⋯` under the same overflow rule as the other header controls if it does not.
- **FR-041** **Marker on saved messages (OD2, D4).** A message that matches a note (same session, role and digest; `ord` breaks ties between equal texts) shows a small SVG note icon (in its meta line for the user's own message, at the bubble's lower edge beside its `⋯` for an agent reply, which has no meta line per bubble), at least 12px, with the accessible name and tooltip *Saved to notes: <title>*. It is a button that opens the drawer on that note. It is drawn with the theme's tokens (spec 070), not an emoji, and is not shown on the office floor. Replayed history (resumed sessions) gets the marker too.
- **FR-042** **Selection save (OD4).** When the selection lies inside one message's text in the chat log, a small *Save to notes* button appears next to the selection's end (placed with `placeMenu`, never over the composer); it saves the selected text with `from: selection` and that message's source. A selection across messages, or outside the log, shows no button. Keyboard: the message's `⋯` has *Save selection to notes* while a selection lies inside it.
- **FR-043** **Search in the drawer.** A search field at the top filters both groups: titles ranked with `DurbarNav.rank`, then notes whose masked text contains the words (case-insensitive); *No notes match "<words>"*. Searching never reads the disk again (the folder's notes are already in the window, at most 300).

### The per-folder Notes view (US4, OD3)

- **FR-044** A **Notes** screen per folder (like Schedules, in `screens.js`): all its notes newest first, search (FR-043), *+ Note*, each note with the drawer's actions, the folded *Done (N)* group, **Export…**, **Delete all…** and the project-file switch (FR-050). Reached from the folder's `⋯` menu (*Notes (N)…*, D10), from the drawer's *All notes of this folder…* and from Ctrl+K (*Notes of <folder>*). Nothing new on the office floor.
- **FR-045** **Done.** *Mark done* moves a note into *Done (N)* (folded); *Mark not done* moves it back. Done notes are not in the `/` list or the header count.
- **FR-046** **Open source (US6, D11).** For a note with a source: when that session is open in the office, its chat opens and the message (found by `role` + `digest`, `ord` first) is revealed inside the chat log (`DurbarScroll.reveal`, never the page) and outlined for 1.2 s (no animation under reduced motion). When it is one of the folder's previous sessions, Durbar opens it exactly as the Previous sessions list does (no message sent), then reveals the message. When the session is gone: toast *The session this note came from is no longer available. The note stays.*; when the message is not found: the chat opens and the toast says *Could not find the message in this session.*
- **FR-047** `[LATER]` **Start a new session with it** (the issue's *Continuing from a note*): needs a first-message field in the New session dialog; its own spec delta. *Continue in this session* is *Insert* (FR-024).
- **FR-048** **Export and delete.** *Export…* writes the folder's notes (done ones included) in FR-052's format to a file the person picks in the system save dialog (main shows it; the window never sends a path), mode 0600. *Delete all…* asks (*Cancel* focused, the count in the text) and removes the notes and keeps tombstones (FR-008). *Remove folder* (spec 006) gets a box **Also delete its notes** (`askDialog` `check`, shown only when the folder has notes, **unticked by default**: a removed folder's notes are kept by default, *owner-confirmed 2026-10-24*, Paco's question C on PR #702); unticked, the dialog says *Its notes stay; they come back if you add the folder again.*; ticked, the folder's store file is deleted after the folder is removed (no tombstones are kept, the file is gone). This is the only way to delete a removed folder's notes without adding it back. **Data reset:** Durbar has no app-wide data reset today (`read:` no reset path in `src/main` other than the usage-totals reset, `src/main/usagetotalsstore.ts:109`); any path that resets or deletes Durbar's data (a future *Reset Durbar*, #559's import with *replace*, a profile wipe in a test helper) must include `<userData>/notes/` (a task for that spec; noted on #559). `[LATER]` #559 export/import includes notes.

### The project file (US5, OD1)

- **FR-050** **Opt-in per folder, off by default.** The Notes view has the switch **Also keep these notes as `.durbar/notes.md` in the project**. The choice is saved in the folder list as `notesFile: true` (a flag only, `SavedFolder`, `src/main/folders.ts`). **While the switch is off, Durbar never reads, stats or writes `notes.md`**, except once at the moment the person turns it on, to count for the dialog. Turning it on asks first (`askDialog`, *Cancel* focused): *Durbar will write every note of this folder to .durbar/notes.md in the project. Agents and anyone with the folder can read it, and it may get committed and pushed with your code. Secrets are masked, but private ideas are not. Durbar never adds it to git.* When a `notes.md` is already there, the dialog also says *N notes in the existing file will be added, marked "From the project file".* (or *The existing file cannot be read; Durbar will not change it.* for FR-054's conflict and parse cases, and the switch then stays off). When the folder is inside a git repository (a `.git` folder or `.git` file found by walking up from the folder, FR-051), the dialog has a box, **on by default**: **Keep it out of commits (adds `.durbar/` to `.git/info/exclude`, local only)**, with the line *If .durbar/notes.md was already committed, this does not remove it from the repository.* *(The box and its default: owner-confirmed 2026-10-24, Paco's question A on PR #702.)* The switch is not offered for a VS Code workspace (`.code-workspace`) `[KNOWN GAP]`, and is greyed with a reason when the folder is not there.
- **FR-051** **Durbar never runs git for it (OD1).** No `git` process at all (no `add`, `commit`, `check-ignore`), and **no edit of `.gitignore`** or any other committed file. The one git-related write is FR-050's opt-in box: Durbar appends exactly one line to the repository's `info/exclude` (local to that clone, never committed): `/<path of the folder from the repository root>/.durbar/` (or `/.durbar/` when the folder is the root), with `/` separators on every OS, only when that exact line is not already there. Finding the file: walk up from the folder's real path to the first `.git`; a `.git` folder gives `<it>/info/exclude`; a `.git` file (a worktree or submodule) is read (at most 4 KB) for its `gitdir:` line, and that folder's `commondir` file (when present) gives the common folder whose `info/exclude` is used. **The target must be a real git directory** (Paco's re-review of PR #702: a `.git` file's `gitdir:` and `commondir` are untrusted, since a folder from a zip or an agent with write access can plant them): the resolved directory (real path, after `gitdir` and `commondir`) must hold a regular `HEAD` file and an `objects/` folder (`lstat`, neither a link), and on POSIX be owned by the current user (`stat().uid === process.getuid()`); its `info/` folder must already exist as a real folder (Durbar never creates `info/`). Anything else is refused with the reason (*not a git repository*, *owned by another user*, *no info folder*) and nothing is written. **The line is escaped** (same review): each path segment's gitignore specials are escaped with `\` (`*`, `?`, `[`, `\`, a leading `!` or `#`, and trailing spaces), and a folder path with a control character or a line break (CR, LF, any U+0000-U+001F or U+007F) is refused with *This folder's name cannot be written to .git/info/exclude safely.*, so the line always matches exactly the folder's `.durbar/` and never adds a second line. Every path is real-path checked; `info/exclude` must be missing or a regular file (`lstat`, not a link), is read at most 1 MB and is opened for append with `O_APPEND`, `O_NOFOLLOW` where the OS has it, and 0600 on create. A refusal (no repository, a link, too big) leaves the switch on and says *Could not add .durbar/ to .git/info/exclude: <reason>*. Turning the switch off leaves the line (it is harmless) and says so. Changed after Paco's review of PR #702 (before: no git-related write at all).
- **FR-052** **Format.** UTF-8 without BOM, LF line ends, one trailing newline; a fixed header; then one section per note, ordered by `createdAt` then `id` (a new note always goes at the end, so two branches that add notes merge cleanly); each section is a marker line `<!-- durbar-note id=… created=… updated=…[ done] -->`, a `## <title>` line, a blank line and the text. No session ids, roles or digests (D8). A text line that starts with `<!-- durbar-note` is written with a leading `\` and read back without it. The exact grammar is in [plan.md](plan.md) *Data model*; parse(write(x)) = x is a tested property.
- **FR-053** **Writing.** After each change (one write per 500 ms at most) and when the switch is turned on, only while it is on. Main checks first: the folder exists; `.durbar` is a real folder (not a link or junction) inside the folder's real path, created if missing; `notes.md` is missing or a regular file (`lstat`, not a link). It writes a temp file in `.durbar`, opened with `O_CREAT | O_EXCL | O_WRONLY` and `O_NOFOLLOW` where `fs.constants.O_NOFOLLOW` exists (not on Windows), 0600 on POSIX. **Right before the rename** it checks again: the real path of `.durbar` is still inside the folder's real path and `lstat(.durbar)` is still a folder, not a link; `lstat(notes.md)` is missing or a regular file; and `notes.md`'s SHA-256 is still the last-written one (FR-054). If the hash differs (an agent, an editor or a `git pull` changed the file since the check), the temp file is deleted, nothing is renamed, the file is imported first (FR-054), and the write runs again on the next cycle: an outside edit is imported, never overwritten. Then it renames the temp file over `notes.md`. On Windows a rename refused because another program has the file open is tried once more after 200 ms, then the view shows *Could not write .durbar/notes.md: <reason>*; the local store is not affected.
  - **The last-written SHA-256 is persisted** in the folder's local store document (`mirror: { sha256, bytes, at }`), written in the same atomic write that follows each successful rename, so after a restart Durbar knows its own file and does not read it as an outside change (Paco's review of PR #702: kept in memory only, a restart made the mirror fail forever).
  - `[KNOWN GAP]` **A race remains.** Node has no `renameat` / `openat`, so between the last check and the rename, a process that can write the project folder could swap `.durbar` for a link and make the rename land elsewhere (the text written is the masked notes). The window is a few system calls; it needs a hostile local process that already has write access to the folder. Recorded, not closed.
- **FR-054** **Reading edits back (D9).** Only while the switch is on (FR-050): when the drawer or view opens and before each write (FR-053), main checks `notes.md`; when its SHA-256 differs from the persisted last-written one, main reads it (at most `mdBytes`, FR-006; opened non-blocking and `O_NOFOLLOW` where available, `fstat` must say regular file) and imports: a section with a known `id` whose title or text changed becomes an edit (masked with the folder's values, FR-005; its `updated` from the marker or the file time; `fileEdited` set); a section whose marker has no `id` or an unknown one (a person adds a note by writing a bare `<!-- durbar-note -->` line, as the file's header says), and a `## ` heading before the first marker, become new notes with `from: file` (*From the project file*; never `typed`: the text may come from an agent or someone else's commit, D7); a `## ` line inside a section is part of that note's text; a section that is gone deletes nothing. A file with git conflict markers (`<<<<<<<`, `=======`, `>>>>>>>` at a line start, outside fenced code) or that does not parse is neither imported nor overwritten: the view and drawer say *.durbar/notes.md has merge conflicts or could not be read. Fix it in your editor; Durbar will not overwrite it until then.*
- **FR-055** **Turning it off** stops writing and asks *Leave the file* / *Delete the file*; *Delete* removes `notes.md` only when its SHA-256 is still what Durbar last wrote (else it is left and the view says why), and removes `.durbar` only when it is then empty.

### Simulator, IPC and checks

- **FR-060** **Simulator (constitution IV, spec 010).** The canned bridge keeps notes in memory per room (nothing on disk) and answers every notes call. Page address `simnotes=some` (3 notes in two sessions, one done), `many` (300), `long` (a 16,000-character note and an 80-character title) and `secret` (notes and a reply with fake token shapes built at run time). The project-file switch shows and answers *Demo: no file written*.
- **FR-061** **UI rules (constitution V).** Text at least 10.5px; states with icon and word; motion only CSS and off under reduced motion; everything reachable by keyboard and named for screen readers; with the drawer open and the header count shown, 15 agents fit on 1440x900 and 1280x800 with the chat open (`check:office`), and the header fits a 480px panel. Screenshots at both sizes (`DURBAR_SIM=15`).
- **FR-062** **IPC (constitution III).** Window-only channels (`fromApp`), every argument validated in main: `notes:list(agentId)`, `notes:save(agentId, {role, ord, text, from})`, `notes:add(agentId, {text})`, `notes:update(agentId, id, rev, {title?, text?, done?})`, `notes:delete(agentId, id, rev)`, `notes:deleteAll(agentId)`, `notes:export(agentId)`, `notes:setFile(agentId, on, {deleteFile?, exclude?})`, `notes:fileCount(agentId)` (FR-050's count, only while turning on), and `removeFolder`'s existing call gets `{deleteNotes?}` (FR-048). Folders are found from the agent id (a folder view passes one of the folder's agents, or the folder key looked up in `FolderStore`); the window never passes a path. After a change main sends `notes:changed {fingerprint}` to the window, which refetches the open folder's notes.
  - **Built now (T013, foundation):** `notes:list`, `notes:save`, `notes:add`, `notes:update`, `notes:delete`, `notes:deleteAll` and `notes:startOver(agentId)` (Start over, FR-007), plus `notes:changed {fingerprint}` to the window. **Later (T040+):** `notes:export`, `notes:setFile`, `notes:fileCount` and `removeFolder {deleteNotes}`; the simulator answers `setFile` already (*Demo: no file written*).
- **FR-063** **Usage of credits:** none. Notes never call an agent app.

### Out of scope

- **FR-090** A global inbox of notes not tied to a folder (D6).
- **FR-091** A Durbar MCP tool for the agent to add notes (spec 041) (D7). Notes that reach Durbar through the project file are in scope (FR-054) and marked `from: file`.
- **FR-092** Sync between computers; anything sent anywhere.
- **FR-093** Search across chats (#430); Ctrl+K finds notes only by the *Notes of <folder>* entry.
- **FR-094** *Turn it into a prompt* for #581's library: after #581 has a spec.

### Key Entities

- **Note**: FR-003. Belongs to one folder; may link to one session and one message.
- **Notes document (local)**: per folder: `version`, `folderName`, `notes[]`, `tombstones[]`, and `mirror` (`sha256`, `bytes`, `at` of the last `notes.md` Durbar wrote, FR-053). Never a path, never raw text.
- **Project notes file**: `.durbar/notes.md`, FR-052; a mirror without links.
- **Text entry of the `/` list**: FR-031.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** From a finished reply, saving it and inserting it back into the message box takes at most 4 actions (`⋯`, *Save to notes*, Ctrl+Shift+M, *Insert*), checked by the driver.
- **SC-002** No token shape from `scripts/test-redact.ts`'s corpus, and a known folder or session secret value without a token shape, planted in a reply, a selection, a typed note or `notes.md`, appears in the store file, `notes.md`, an export, the drawer, the `/` list or the message box after *Insert* (unit and driver checks).
- **SC-003** Two stores writing the same folder file in turns lose no note and resurrect no deleted note (unit test, 1,000 random operations).
- **SC-004** `parse(write(doc))` gives the same notes for 1,000 generated documents (titles and texts with Markdown, `##`, marker-like lines, CRLF, Unicode).
- **SC-005** With `simnotes=many` (300 notes) the drawer opens and the search filters in under 100 ms of the renderer's own time (`performance.measure`, CPU-time rules of `docs/agent-notes.md`).
- **SC-006** With the drawer open, `check:office` passes at 1440x900 and 1280x800 with 15 agents.

## Assumptions

- One Durbar window per process (true today); two processes on one profile are handled by FR-008.
- The chat's message order on replay matches the live order closely enough for `ord`; the digest is the real key (`ord` only breaks ties). Not checked on real history of all three apps `[KNOWN GAP]`.
- Notes are small text; 300 per folder and 16,000 characters each are enough (raise in a delta if not).
- Masking is the shared `redact` rule set plus the folder's and session's known secret values: what it does not recognise as a secret is stored as written (an honest limit, the same as the chat log).

## Honest limits

- Built and checked on the simulator and in unit tests only; on-device checks are Linux only (constitution VI). Windows ACLs (no 0600) and the Windows rename retry are covered by tests with fakes, not by a person on Windows.
- **Masking loses on purpose and misses by design.** A secret a person saves in a note on purpose is lost: only `[redacted]` is stored, and *Insert* puts `[redacted]` in the message (with FR-024's note *Parts of this note were hidden when it was saved*). A secret that is neither a known folder or session value nor a known token shape is stored as written, in the local store and in `notes.md`.
- **The project file is shared input.** With the switch on, notes can arrive from anyone who can write the folder or push to the repository; they are marked *From the project file* but their text is not checked beyond masking. The `.durbar/` exclude line does not untrack a file already committed.
- **The rename race** in FR-053 is open `[KNOWN GAP]`.
- `read:` only for the code facts above; nothing here was run against a real agent app (none is needed: notes never call one).

## Changes

### 2026-10-29: index status text kept from before the fixed status words (spec 021 FR-063)

The `status:` of the specs-index block used to read (moved here unchanged; the block now has one status word and a short note):

> In progress (2026-10-26): foundation (T010..T014), the MVP in the window (T020..T024) and the header count, the saved-message marker and the drawer search (T030..T032) built and checked on the simulator; selection save, the per-folder screen and the project file (T033..T050) are not built; owner decisions OD1..OD4 (Ruben) and coordinator decisions D1..D11 recorded


### 2026-10-24: review fixes (Paco's review of PR #702, request changes; defaults under Ruben's delegation)

*Found by:* Paco's agent's review of PR #702 at a02004ed. *Corrected* (before anything was built):

1. **Masking with known values (FR-005, D3, Honest limits).** `maskNoteText` also masks the folder's and session's known secret values (`extraSecretValues`, `secretValuesFor` / `mcpSecretValues`); the honest limits now say a wanted secret is lost and an unrecognised one is stored as typed.
2. **One `NOTES_LIMITS` object (FR-006, FR-053, FR-054).** Byte caps are derived from the character caps; nothing larger than the read cap is ever written; the last-written SHA-256 is persisted in the store document; tests at the exact caps.
3. **Project-file imports (FR-003, FR-050, FR-054, D7, FR-091).** Imported and file-edited notes are `from: file` / `fileEdited`, shown as *From the project file*; the turn-on dialog counts what an existing file adds; the file is never read while the switch is off; D7 corrected.
4. **Rename checks (FR-053).** Real path and `lstat` checked again right before the rename, `O_NOFOLLOW` where available, a hash re-check that imports an outside edit instead of overwriting it, and the remaining race as a `[KNOWN GAP]`.
5. **Removed folders (FR-048).** *Also delete its notes* in the Remove folder dialog; any data-reset path must include `notes/`.
6. **Hidden parts on insert (FR-024, FR-003 `hidden`).** *Parts of this note were hidden when it was saved*.

**Confirmed by the owner** (Ruben, 2026-10-24, DM to his coordinator: "Ok to all"; recorded on #699); were *defaults confirmed by the owner 2026-10-24* (decided by the coordinator under Ruben's delegation, 2026-10-24; Paco's questions on PR #702; asked of Ruben):
- **(A2)** Paco's re-review of PR #702 (2026-10-24): FR-051's exclude target must be a real git directory owned by the user (no `info/` created), and the anchored line escapes gitignore specials and refuses control characters.
- **(A)** FR-050/FR-051: the turn-on dialog's box *Keep it out of commits (adds `.durbar/` to `.git/info/exclude`, local only)*, on by default; Durbar writes only that one line and never touches `.gitignore`. FR-051 changed accordingly (it forbade this).
- **(B)** D3/FR-024: a secret in a note is unrecoverable, and *Insert* sends `[redacted]` (with item 6's note).
- **(C)** FR-048: a removed folder's notes are kept by default; *Also delete its notes* is unticked.
- **(Q1)** FR-041/D4: the SVG marker stays (Paco agrees), confirmed by Ruben 2026-10-24.
- **(2026-10-25, decided by the coordinator under Ruben's delegation)** FR-008 test: the helper process of `test-notesstore` (`scripts/notes-worker.ts`) retries a *busy* answer (up to 30 times), as a user pressing the button again would. On the Windows runner four real processes can hold the lock past the store's 2 s deadline, and the store then answers *busy* by design (PR #695's CI run 40146239142: one worker exited 2); a worker that stopped at the first *busy* made the test depend on runner speed. Any other refusal still fails the worker, and the test still checks that none of the 40 notes is lost. [KNOWN GAP] not re-run on Windows.

### 2026-10-25: the MVP in the window (T020..T024; decided by the coordinator under Ruben's delegation, ambiguities resolved by the implementer and recorded here)

*Built:* the message `⋯` and *Save to notes* (FR-010, FR-011), the Notes drawer (FR-012..FR-014, FR-020..FR-026), Insert (FR-024), notes in the `/` list (FR-030, FR-031), Ctrl+Shift+M, and the simulator driver. Decisions on points the spec left open:

- **The chat's own session** (FR-021) is main's, not the window's: `notes:list` now also answers `session` (main's `resumeIdFor`, checked with `sessionIdOk`, `''` when unusable), so the drawer can put *This session* first without the window knowing a session id.
- **The message's place `ord`** (FR-009) is its index among that role's bubbles in the chat log's DOM at save time (an agent reply's `.bubble`, a user message's `.bubble`).
- **A ⋯ per bubble, not per turn**: an agent turn that produced several reply bubbles has a `⋯` on each finished one; a thinking block, a tool chip and a request card have none (FR-010). The `⋯` is an SVG with no text, so a bubble's text is unchanged.
- **`Show in notes`** is decided in the window: the menu opens with *Save to notes*; once the message's digest (SHA-256, `DurbarNotes.digestOf`, the same value as main's) is computed the item becomes *Show in notes* when a note of this session, role and digest exists. *Already in notes* (the toast of a second save) is main's `existing` answer.
- **A stale `rev`** (FR-008): *Edit…* and *Rename…* that meet a different saved `rev` ask *This note changed* with **Use the saved one** / **Keep mine** (a second send with the saved `rev`).
- **Insert masks once more** with `maskNoteText` (the shared mask, structure-keeping) and refuses to insert when it is not available (fail closed); *Edit…* and *Rename…* show the text and the title masked again by the same helper, and refuse likewise (the Delete dialog and every row show the title through `DurbarSafeText`).
- **Notes need a live chat in a main session**: a helper's chat, the read-only VS Code chat view and the non-live demo canned chats have no `⋯` and no drawer (FR-027); the simulator's agents are live, so demo mode works.
- **The `/` list while the commands load** shows only *Looking for commands…* (notes join when they arrive), so the first row never starts on a note; with no commands in the app (`simslash=none` in the simulator, Priya's app) the list is named *Notes* and counts *2 notes*.
- **Spec 074 FR-085, saved Go to key:** `loadCombo` keeps a saved Ctrl+Shift+M (it was free when saved); the Go to handler is matched first, so the Notes key then does nothing (`test-navigator`).
- **Not built here** (next slice): the header count (FR-040), the saved-message marker (FR-041), search (FR-043), selection save (FR-042), the per-folder screen, export and *Delete all…* (FR-044..FR-048), the project file (FR-050..FR-054) and *Open source* (FR-046); the row's `⋯` therefore holds *Rename…*, *Copy* and *Delete…* only, and *Mark done* is not offered.

*Evidence:* `test:` `scripts/test-notes.ts` (the window helpers), `test-navigator.ts`, `test-slashcommands.ts`; `sim:` `npm run check:notes` (US1 scenarios 1..6, SC-001's four actions, SC-002) and `check:office` with the drawer open; screenshots: [the drawer at 1440x900](../../docs/screenshots/083-notes-drawer-1440x900.png), [at 1280x800](../../docs/screenshots/083-notes-drawer-1280x800.png), [the `/` list at 1440x900](../../docs/screenshots/083-notes-slash-1440x900.png), [at 1280x800](../../docs/screenshots/083-notes-slash-1280x800.png). `[KNOWN GAP]` no real session and no screen reader were used: the ARIA roles and names are asserted, how a screen reader reads them was not heard.

### 2026-10-26: review fixes of the MVP (independent review of 083-notes-ui at 9d2b8c44; decided by the coordinator under Ruben's delegation)

- **The ⋯ only where it works (FR-010, FR-027).** A chat's log is marked `data-notes` (a main, live chat); the ⋯ is added only inside such a log. The read-only VS Code view, a helper's chat and the canned demo chats have none (before, ~50 dead buttons showed in the VS Code view).
- **"Shown like Copy" (FR-010).** Copy is readable at rest (spec 052: `opacity:1`, not hover-only), so the ⋯ is too; `check-notes` asserts that the two have the same computed opacity. If Copy ever becomes hover-only, the ⋯ follows through the same assert.
- **The `/` list with a query keeps this session's notes first (FR-030)**: each group is ranked on its own, then joined.
- **Masking on every way out of a note:** Insert (box and announcement), *Edit…* and *Rename…* (the fields), the Delete dialog and the row's *Copy* all go through the same shared mask (`noteBoxText`) and refuse when it is not available (fail closed).
- **A stale `rev` shows the saved version (FR-008):** the dialog's line holds the saved title and the first 300 characters of its text, masked; both buttons are driven in `check-notes` by changing the note through the bridge.
- **Drivers follow the platform:** `check-notes` and `check-office-overlap` press ⌘ on a Mac and Ctrl elsewhere and compare the exact shortcut text (⇧⌘M, Ctrl+Shift+M); the office check waits until the drawer is shown instead of a fixed pause.

### 2026-10-26: the header count, the marker and the drawer search (T030..T032; decided by the coordinator under Ruben's delegation, ambiguities resolved by the implementer and recorded here)

*Built:* FR-040, FR-041, FR-043 and SC-005 on the simulator (`npm run check:notes-count`, `check:office` with the count shown and the drawer open). Decisions on points the spec left open:

- **The count** (FR-040) is a pill at the end of the header's meta row, text *Notes N*, name *Notes N. M from this session, N in this folder*; it is built only where notes are on (a main, live chat), so a helper's chat has none, and it is hidden in the read-only VS Code view (FR-027) and back when the view is left. It carries only numbers, so no note text can reach it. At 480px the meta row wraps like its other chips; the driver measures no overlap and nothing leaving the panel.
- **The marker's place** (FR-041): a user message has it in its meta line (*You · 09:30*); an agent reply has no meta line of its own per bubble (one name line per turn, several bubbles), so the marker sits at the bubble's lower edge beside its `⋯`. Name and tooltip are *Saved to notes: <title>*, the title masked (fail closed), set as attributes, never as HTML.
- **`ord` rule** (FR-041): a note marks the message with its session, role and digest. When the chat holds several messages with that digest, only the one at the note's own place (`ord`) is marked; when the digest is unique in the chat, the message is marked whatever its place (a replayed history can number its messages differently). A done note still marks its message. Main saves one note per session and digest, so equal texts share it.
- **Repaint:** the markers are recomputed after every notes fetch, when a reply finishes (live or replayed) and when the VS Code view is left; digests are cached per bubble; deleting the note removes the marker on that repaint.
- **Search** (FR-043): a field at the top of the drawer filters each group on its own: notes whose masked title ranks for the query (`DurbarNav.rank`, in rank order), then the others whose masked text holds every word (case-insensitive); the text of a note is read through `DurbarSafeText`, so a field that cannot be masked never matches. The no-match line is *No notes match "<words>"* with the words masked and cut at 60 characters; the announcement says only how many notes match. Esc clears the search before it closes the drawer; ArrowDown goes to the first row; closing the drawer clears the search.
- **SC-005:** with `simnotes=many` (300 notes) the drawer opens in about 30 to 90 ms and a search runs in about 25 to 35 ms (best of 3, `performance.measure`). Masked rows and texts are cached by note id and `rev`, the drawer paints once per open, and rows use `content-visibility:auto` so only the rows in view are laid out.
- **Replay evidence:** a resumed chat (`simresume=1`) is replayed through the same message builders; the driver saves a replayed message, clears every marker and rebuilds them from the replayed bubbles and the notes. The real runtimes' histories were not run.
- **Not built here:** selection save (T033), the per-folder screen (T034), the project file (T040..T042) and *Open source* (T050).

### 2026-10-26: stale-lock takeover race (issue #723; T061; a fix to FR-008)

*Found by:* `a stale lock taken over by four processes: 40 notes, none lost` failed once on Windows CI (the rerun passed). The worker already retries a `busy` answer and exits 2 on a refusal, so the loss was a real second writer. *Cause:* a process judged the lock stale (`lstat`), another took it over and held a fresh one, and the first then moved that fresh lock aside (the check came too late); in the gap a third process created its own lock, so two writers read the same file and one note was lost. A holder paused over 5 s could also write and delete a lock that was no longer its own. *Fixed (a019a828, then review round 2 in 9863b529):* the takeover guard and the lock token described in FR-008; in round 2 the guard got its own token and is broken by move-aside, the token check also guards Start over, and a transient read error is retried (the old second-race `[KNOWN GAP]` is narrowed, not closed, see FR-008). Tests: a fresh lock appearing between the stale judgement and the move is never touched; a holder that lost its lock does not write or delete. Task numbers taken: T061 (free on `main`, no open PR touches spec 083 tasks).

### 2026-10-26: review rounds 2 and 3 on PR #778 (T061)

Round 2 (independent review of a019a828): the guard has its own token and is broken by move-aside; Start over checks the lock token; a transient read error on the lock is retried; the gap wording was corrected. Round 3 (Vikram's agent): a release is a move-aside plus a token check (no check-then-unlink); the time half of the identity check is tested; leftovers of a crash are swept under the guard; the Windows limits are listed in FR-008. No new task numbers.

### 2026-10-30: saving a selection (T033, FR-042; decided by the coordinator under Ruben's delegation)

*Built:* the floating **Save to notes** button beside a selection and *Save selection to notes* in a message's `⋯`. Decisions on points the spec left open:

- **When the button shows:** one non-collapsed selection whose start and end are inside the same finished message of a main, live chat (an agent reply's bubble or the user's own message) and that holds more than blanks. A selection across messages, outside the log, in the read-only VS Code view, in a helper's or demo chat, or in an unfinished (streaming) reply shows nothing. It appears about 120 ms after the selection stops changing (not while dragging), hides when the selection changes, a dialog opens or the Notes drawer opens (the selection may survive, the button does not come back until a new selection), and follows the chat when it scrolls; it is hidden when the selection's end is scrolled out of the visible log (review round, 2026-10-30).
- **Place:** just below the end of the selection, clamped to the window with `placeMenu`; when that would cover the composer or the answer bar it goes above the selection's start instead, and when neither place is clear of them (and inside the log) there is no button (`DurbarNotes.selButtonTop` returns null; unit-tested). A selection over 65,536 characters gets its own toast, *That selection is too long to save.*, and stores nothing.
- **What is saved:** the selected text (line ends unified, ends trimmed, zero-width marks dropped) with `from: selection` and the message's `role` and `ord`; main masks it like every other save (known values and token shapes only; see the `[KNOWN GAP]` below) and computes the digest of the selected text, so a saved selection does not mark its whole message with the saved-message marker (FR-041 matches whole messages). The buttons' own labels (`Copy`, `⋯`, the marker) are not selectable, so they are never in the text. After a save the selection is cleared; the toast is the one of *Save to notes* (Rename…, Show), or *Already in notes* for the same selection again.
- **Keyboard:** the `⋯` menu (click, right-click or Shift+F10 on the message) adds *Save selection to notes* after *Save to notes* when a selection lies inside that message.
- *Evidence:* `test:` `scripts/test-notes.ts` (`selectionText`, `selButtonTop`); `sim:` `npm run check:ui -- --only check-notes` (selection inside one reply and one user message, across messages, outside the log, the VS Code view, the menu item with and without a selection, a token inside a selection is masked in the store) at 1440x900 and 1280x800; [the button at 1440x900](../../docs/screenshots/083-notes-selection-1440x900.png), [at 1280x800](../../docs/screenshots/083-notes-selection-1280x800.png). `[KNOWN GAP]` a screen reader's browse mode and touch selection handles were not tried; a selection made by keyboard only (caret browsing) was not run. `[KNOWN GAP]` a partial secret selected by hand is stored as selected: main masks known values and token shapes only, so a fragment of a secret (no prefix, half a known value) is kept like pasting it into a typed note. Real mouse input (`sendInputEvent`) covers pressing the floating button and clicking `⋯` with a selection; dragging a selection with the mouse was not driven.


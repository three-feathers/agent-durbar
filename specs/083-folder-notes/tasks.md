---
description: "Tasks for spec 083: notes per folder, reachable inside the chats"
---

# Tasks: Notes (save an idea or a message and carry on later)

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md)

**Prerequisites**: Ruben's owner decisions OD1..OD4 (binding) and the coordinator's D1..D11 are recorded in spec.md. No task waits for an answer: the defaults for Paco's questions A, B, C and Q1 (PR #702) are written in spec.md *Changes* as *owner-confirmed 2026-10-24*; a different answer changes a default, not the structure.

**Rules for every task**:

- simulator and `npm test` only; zero AI credits; no real session, no `npm run smoke`, no `scripts/capture-raw.ts`;
- no shell, no git calls from Durbar (FR-051); no path from the window;
- never log note text, titles, session ids or secret values;
- Durbar runs no git process; the only git-related write is FR-051's one `info/exclude` line; fake tokens in tests are built at run time;
- `npm run typecheck && npm run build && npm test` green;
- UI tasks: `npm run check:office`, screenshots at 1440x900 and 1280x800 with `DURBAR_SIM=15`, and `npm run shots:docs -- --only <drivers>` for linked pictures that show the change;
- renderer comments write "issue 699", never `#699` (theme-token ratchet).

## Format: `[ID] [P?] [Story] Description [FRs]` then the acceptance criteria

---

## Phase 0: Spec deltas

- [x] T001 [P] Spec deltas in the owning specs, each a dated `## Changes` entry pointing to 083. [FR-010, FR-020, FR-026, FR-030, FR-031, FR-044, FR-048]
  - AC1: spec 005: the per-message `⋯` (next to *Copy*), the Notes drawer over `#chat` in the Chat view, *Notes…* in the More menu, the header count.
  - AC2: spec 073: the `note` source and `insertText` entries; the list opens in a chat with notes even without adapter commands.
  - AC3: spec 074: `mod+shift+KeyM` in `TAKEN` (*the Notes drawer*).
  - AC4: spec 006: *Notes (N)…* in the folder `⋯` menu; *Remove folder* keeps notes and says so.
  - AC5: `npm run specs:check` passes.

## Phase 1: Foundation (blocks every story)

- [x] T010 [P] Pure note model in `src/shared/notes.ts`. [FR-003, FR-004, FR-006, FR-008]
  - AC1: `parseNotesDoc` keeps valid notes, drops a bad note and keeps the rest (and counts it: the store then treats a file with a dropped note as read-only, FR-007); returns an error for an unknown version, non-JSON or a document over `storeBytes`.
  - AC2: `guessTitle` removes Markdown marks, cuts at a word to 80, and gives *Note of <date>* for empty text; `cleanTitle` refuses control characters and empty titles.
  - AC3: `applyChange` refuses a stale `rev` with `stale`, bumps `rev` and `updatedAt` otherwise, and refuses the 301st note with the FR-006 text.
  - AC4: `mergeDocs`: the higher `updatedAt` wins; a tombstone wins over an older edit; tombstones are capped at 300, oldest dropped.
  - AC5: `newNoteId` gives `n-` and 12 base-36 characters from an injected uniform random function (no modulo bias).
  - AC6: `scripts/test-notes.ts` (new `test:notes`, added to `npm test`) covers AC1..AC5, plus a 1,000-operation random test of two documents merged in turns: no lost and no resurrected note (SC-003).
  - AC7: `NOTES_LIMITS` is the only place with caps (a static test finds no other cap number in the notes modules); `storeBytes` and `mdBytes` are computed from the character caps; a folder at every cap (300 notes of 16,000 three-byte characters full of quotes, backslashes and marker-like lines) serialises under both caps, and one more character is refused before any write.
  - AC8: control characters other than tab and line feed are removed on save.
- [x] T011 [P] `maskNoteText` in `src/shared/redact.ts`. [FR-005, SC-002]
  - AC1: it masks every token shape of `test-redact`'s corpus planted as written, inside Markdown (`**`, backticks, `_x_`, links, code fences), after `%3D` and `\n`, and split by `**` or a backtick.
  - AC2: the Markdown outside a masked token is unchanged (headings, lists, code fences, `release_notes`).
  - AC3: a bare token across the 16,000 cut leaves no piece of it when the caller masks then cuts (`ghp_` and a run of its body), and a mutation that cuts first fails the test.
  - AC4: linear time: CPU time for 160k characters is under 16x that of 20k (min of 3 interleaved runs, `cpuMs`), and a deliberately quadratic mutation fails.
  - AC5: `redact.ts` still has no imports (`test-liveact`).
  - AC6: `maskNoteText(text, values)` masks known values first (longest first, under 4 characters skipped), including a value with no token shape and one split by `**`; it reports whether anything changed (for `hidden`).
  - AC7: main passes the folder's `extraSecretValues` and the session's `secretValuesFor` values; an import or a typed note gets the folder's (test with fakes).
- [x] T012 `NotesStore` in `src/main/notesstore.ts`. [FR-002, FR-005, FR-006, FR-007, FR-008]
  - AC1: one file per folder at `notes/<folderFingerprint(key)>.json`; folder 0700 and file 0600 on POSIX (checked with `fs.statSync().mode & 0o777`); no folder path in the file.
  - AC2: writes go through a unique `wx` temp file and rename; a crash between the two (fake `fs` throws on rename) leaves the old file intact.
  - AC3: every stored title and text is the output of `maskNoteText`; a test plants a token in each call path (save, add, update, import) and reads the raw file: no token.
  - AC4: a corrupt, oversized or unknown-version file is never written over; saves are refused with the reason; *Start over* renames it to `.bad-<UTC>` (0600) and starts empty.
  - AC5: two `NotesStore` instances on one folder (two processes): each write after the other's re-reads and merges; the stale `rev` path refuses; no lost note in 200 interleaved operations.
  - AC6: writes per folder are queued: two saves started together both land (the test starts both, then awaits `Promise.all`, with an `exit` guard; `docs/agent-notes.md`).
  - AC7: tests in `scripts/test-notes.ts` with a temp `DURBAR_USER_DATA`-like folder and an injected `fs`.
  - AC8: `hidden` is set when masking changed title or text, and not otherwise.
  - AC9: the store document keeps `mirror` (sha256, bytes, at) written with the store's next atomic write; after a fresh `NotesStore` on the same folder, the mirror sees its own `notes.md` as unchanged (restart test).
- [x] T013 IPC, preload and types. [FR-009, FR-062]
  - AC1: `src/main/ipc/notes.ts` registers the FR-062 channels with `fromApp`; `test:ipcchannels` passes with the `import { register as … }` line.
  - AC2: the session id is taken from `resumeIdFor(agentId)` and the app from the agent's adapter id; a session id sent by the window is ignored (test with a fake that sends one).
  - AC3: `digest` = first 16 hex of SHA-256 of `rawDigestInput(text)`; a shared test vector gives the same value as the window helper (T021).
  - AC4: bad input (non-string text, text over 64 KB before masking, unknown agent, unknown note id, non-integer `rev`) is refused with a short reason; nothing is logged with note text.
  - AC5: after a change, `notes:changed {fingerprint}` is sent to the window.
- [x] T014 [P] Simulator notes. [FR-060]
  - AC1: `sim.ts` answers every notes call from an in-memory map per room; nothing is written to disk (`DURBAR_SIM` seal still passes).
  - AC2: `simnotes=some|many|long|secret` seed the store as FR-060 says; `secret` builds its tokens at run time.
  - AC3: the project-file switch answers *Demo: no file written*.

**Checkpoint**: the store, masking and IPC are tested without UI.

## Phase 2: User Story 1, save and insert (P1) MVP

- [x] T020 [US1] The message `⋯` and *Save to notes*. [FR-010, FR-011]
  - AC1: every finished agent bubble and user message has a `⋯` (*Actions for this message*) next to *Copy*; none while streaming, none on tool chips, thinking blocks or request cards.
  - AC2: it opens `#modeMenu` with the `openPrevMenu` keyboard rules; right-click, Shift+F10 and the context-menu key open the same menu; Esc and Tab return focus to the `⋯`.
  - AC3: *Save to notes* saves without a dialog; the toast has *Rename…* and *Show*; a second save of the same message gives *Already in notes*, and the item reads *Show in notes*.
  - AC4: works in demo chats through the simulator store.
- [x] T021 [US1] [P] Window helpers `src/renderer/notes.js` (`window.DurbarNotes`). [FR-021, FR-022, FR-024, FR-030, FR-041]
  - AC1: grouping and order of FR-021 (session first, newest first, done left out); `test:globals` passes (a new global name).
  - AC2: the row view masks title and excerpt with `DurbarSafeText`, failing closed (no mask function gives an empty field).
  - AC3: `insertInto(value, caret, text)` adds a blank line only when the box has text and the caret is not at a line start, and returns the new caret.
  - AC4: `digestInput` equals main's `rawDigestInput` on the shared vector (T013 AC3).
  - AC5: unit tests in `scripts/test-notes.ts` (jsdom-free, pure).
- [x] T022 [US1] The drawer. [FR-012, FR-013, FR-014, FR-020..FR-027]
  - AC1: *Notes…* in More, Ctrl+Shift+M / ⌘⇧M, Ctrl+K *Notes* and a toast's *Show* open it over `#chat` only; the composer stays usable; the log keeps updating under it.
  - AC2: Esc closes the drawer and returns focus; a second Esc closes the chat (driver).
  - AC3: rows follow FR-022, arrow keys move (roving `tabindex`), Enter inserts; the empty state shows its words and *+ Note*.
  - AC4: *+ Note*, *Edit…*, *Rename…*, *Delete…* use `askDialog`; the Edit and Rename fields and the Delete text show the stored text masked again (fail closed, FR-013); Delete focuses *Cancel*, then focus goes to the next row, else previous, else *+ Note*.
  - AC5: *Insert* puts the text in the box per FR-024, sends nothing (the driver checks no `send` call), focuses the box and announces it; it is disabled with a reason in a chat without a usable box.
  - AC6: `TAKEN` has `mod+shift+KeyM`; `test-navigator`'s handler scan passes and fails when the row is removed (mutation); a saved Go to combination equal to it keeps working and the drawer key does nothing (test).
  - AC7: with spec 080's tabs present (or a fake tablist in the driver once they land), opening Notes from Browser selects Chat first. Until then this AC is checked by a unit test on the switch function.
  - AC8: inserting a note with `hidden` shows *Parts of this note were hidden when it was saved* above the box until it is sent or emptied; a `from: file` note shows *From the project file*; the same from the `/` list.
- [x] T023 [US1] Notes in the `/` list. [FR-030, FR-031]
  - AC1: in a chat with notes, `/` lists a *Notes* group after the commands, at most 5 with nothing typed, plus *All notes…*; done notes are not listed.
  - AC2: picking a note replaces the `/word` with the note text (FR-024's blank-line rule), not `/name`, and sends nothing.
  - AC3: the list opens in a chat whose app lists no commands when the folder has notes, and still does not open without notes there (spec 073 unchanged otherwise; `test:slashcommands` and `check:slash-suggest` pass).
  - AC4: note rows are escaped (`optionHtml` with a hostile title) and masked (`simnotes=secret`: no token in the list, its tooltip or the announcement).
  - AC5: announcements count commands and notes apart.
- [x] T024 [US1] Driver, office fit and docs for the MVP. [FR-061, SC-001, SC-002, SC-006]
  - AC1: `scripts/check-notes.js` (asserting, exits 1 on failure, added to `ui-suite.js`) runs US1's scenarios 1..6 with `assert.ok(await until(...))`, including the 4-action loop (SC-001) and `simnotes=secret` (SC-002, in the store dump, the drawer and the message box).
  - AC2: `check:office` passes at 1440x900 and 1280x800 with 15 agents and the drawer open.
  - AC3: screenshots of the drawer and the `/` list at both sizes under `docs/screenshots/`, linked from this spec.
  - AC4: README feature list and *Safety model* get one line each on notes (local, masked, 0600; project file opt-in comes in Phase 4); `changelog.d/083-notes-ui.md` (the fragment is named after its branch); the spec's index block status updated.

**Checkpoint**: MVP: save from a message, drawer, insert (button and `/`), local storage.

## Phase 3: User Stories 2, 3 and 4, seeing and managing (P2)

- [ ] T030 [US2] [P] Header count. [FR-040]
  - AC1: *Notes N* shows when the folder has N > 0 notes not done, with the FR-040 tooltip; not shown at 0.
  - AC2: it opens the drawer (`aria-expanded`, `aria-controls`).
  - AC3: the header fits a 480px panel with the count (driver measures no overlap); `check:office` passes with the count shown.
- [ ] T031 [US2] [P] Saved-message marker. [FR-041]
  - AC1: a saved message (live and replayed history) shows the SVG icon with *Saved to notes: <title>* as name and tooltip, at least 12px, theme-token colours (`test:theme-tokens` passes, no new literal).
  - AC2: matching uses session, role and digest; two equal texts are told apart by `ord` (unit test); deleting the note removes the marker on repaint.
  - AC3: the icon opens the drawer on its note; no marker on the office floor.
- [ ] T032 [US2] [P] Drawer search. [FR-043, SC-005]
  - AC1: the field filters both groups by title rank then text words, case-insensitive, on masked text; the no-match line names the words (masked).
  - AC2: with `simnotes=many` the open and a search take under 100 ms of renderer time (`performance.measure`, best of 3).
- [ ] T033 [US3] Selection save. [FR-042]
  - AC1: a selection inside one bubble shows the button at its end (placed with `placeMenu`, never over the composer); it saves only the selected text with `from: selection` and the message's source.
  - AC2: a selection across messages or outside the log shows no button.
  - AC3: the message `⋯` has *Save selection to notes* while a selection lies inside it (keyboard path).
- [ ] T034 [US4] The per-folder Notes screen. [FR-044, FR-045, FR-048]
  - AC1: reached from the folder `⋯` (*Notes (N)…*), the drawer's *All notes of this folder…* and Ctrl+K *Notes of <folder>*; nothing new on the office floor (`check:office` unchanged).
  - AC2: all notes, search, *Done (N)* folded, *Mark done* / *Mark not done*; done notes leave the `/` list and the count.
  - AC3: *Export…* goes through main's save dialog (the window sends no path) and writes FR-052's format without session ids, mode 0600 (unit test with a fake dialog).
  - AC4: *Delete all…* asks with the count (*Cancel* focused) and leaves tombstones.
  - AC5: screenshots of the screen at both sizes.
  - AC6: *Remove folder*'s dialog has *Also delete its notes* (only when the folder has notes, unticked by default); unticked: the text says the notes stay and re-adding the folder shows them; ticked: the store file is gone after removal (unit test on the store key and the IPC flag).
  - AC7: a note is added on #559 (and in this spec) that any data-reset path must include `<userData>/notes/`.

## Phase 4: User Story 5, the project file (P2)

- [ ] T040 [US5] [P] Format `src/shared/notesmd.ts`. [FR-052, FR-054, SC-004]
  - AC1: `parseNotesMd(writeNotesMd(x))` equals `x` (ids, titles, texts, done, times) for 1,000 generated documents with `##` lines, marker-like lines, code fences, CRLF input, Unicode and empty texts.
  - AC2: notes are written in `createdAt` then `id` order; adding a note only appends lines (a diff test).
  - AC3: conflict markers at a line start outside fenced code make `parse` return `conflict`; inside a fence they do not.
  - AC4: a bare `<!-- durbar-note -->` section and a `## ` heading before the first marker parse as new notes; stray text is reported.
  - AC5: `scripts/test-notesmd.ts` (new `test:notesmd`, in `npm test`).
- [ ] T041 [US5] Mirror in main `src/main/notesfile.ts`. [FR-050, FR-051, FR-053, FR-054]
  - AC1: writes only when `notesFile` is on; while off, no `stat`, read or write of `notes.md` (a counting fake `fs`), except `count` at turn-on; the temp file opened with `O_EXCL` and `O_NOFOLLOW` where defined; 0600 on POSIX; the new `mirror` returned for the store to persist.
  - AC2: refuses a `.durbar` or `notes.md` that is a link (POSIX symlink; Windows junction where the test can make one, skipped otherwise with a printed reason), a real path outside the folder, a folder, or a FIFO (opened non-blocking; a hang test in a child process with a timeout).
  - AC3: reads at most `mdBytes`; edits of known ids import masked with the folder's values and set `fileEdited`; new sections become `from: file` notes (never `typed`); missing sections delete nothing; conflict or parse error: no import and no write, and the state says why.
  - AC4: Windows rename retry: a fake `fs` that throws `EPERM` once succeeds on the second try; twice gives the FR-053 message; the local store is untouched.
  - AC5: no `child_process` use in the module (a static test), no `.gitignore` write.
  - AC6: right before the rename, a swapped `.durbar` (a link, or a real path outside) and a `notes.md` turned into a link are refused (fake `fs` that swaps between the checks); a `notes.md` whose hash changed after the read is not overwritten: the temp file is deleted, the edit imported, the write retried next cycle.
  - AC7: written files never exceed `mdBytes`; a file over `mdBytes` is not read.
  - AC8: `addExclude` finds `info/exclude` from a `.git` folder, a worktree `.git` file (`gitdir` + `commondir`) and a subfolder of the repository, appends the anchored line once (idempotent), refuses a linked or oversized `exclude` with the reason, and runs no process.
  - AC9: `addExclude` refuses, with its reason and no write, a target that is not a real git directory: a `.git` file whose `gitdir` or `commondir` points to a plain folder (no `HEAD`, no `objects/`), to a `HEAD` or `objects` that is a link, to a folder owned by another user (POSIX, a fake `stat` uid), or to a git directory without `info/`; it never creates `info/` (a counting fake `fs` sees no `mkdir`).
  - AC10: the anchored line escapes `*`, `?`, `[`, `\`, a leading `!` or `#` and trailing spaces in every segment, tested with folders named `a*b`, `x?`, `[draft]`, `back\slash`, `!keep`, `#notes`, `trail ` and a nested path; each generated line is checked against a small gitignore matcher in the test to match exactly that folder's `.durbar/`; a name with CR, LF, a tab or another control character is refused with the FR-051 text and nothing is appended.
- [ ] T042 [US5] The switch and its states in the Notes screen. [FR-050, FR-055]
  - AC1: off by default; turning it on shows the FR-050 warning with *Cancel* focused; `notesFile: true` saved in `folders.json` and read back.
  - AC2: not offered for a `.code-workspace`; greyed with a reason when the folder is missing.
  - AC3: the conflict and write-error states show their words in the screen and the drawer.
  - AC4: turning off asks *Leave the file* / *Delete the file*; delete only when the hash matches, else the file stays and the screen says why; `.durbar` removed only when empty.
  - AC5: in the simulator the switch answers *Demo: no file written*; README's *Safety model* line on notes (T024 AC4) now also says the file may be committed and that Durbar never adds it to git.
  - AC6: with an existing `notes.md` the dialog says how many notes it will add (*marked "From the project file"*); an unreadable or conflicted file says so and the switch stays off.
  - AC7: inside a git repository the dialog has *Keep it out of commits (adds `.durbar/` to `.git/info/exclude`, local only)*, on by default, with the already-committed line; outside one it is not shown; turning the switch off leaves the line and says so.

## Phase 5: User Story 6, back to the source (P3)

- [ ] T050 [US6] *Open source*. [FR-046]
  - AC1: an office session: its chat opens and the message is revealed inside `#chat` (`DurbarScroll.reveal`; `document.scrollingElement.scrollTop` stays 0) and outlined 1.2 s; no animation under reduced motion.
  - AC2: a previous session opens through the Previous sessions path (no `send`), then reveals.
  - AC3: a gone session and a missing message give the FR-046 toasts; the note stays.

## Phase 6: Converge

- [ ] T060 `/speckit.converge`: spec statuses and `[IMPLEMENTED]` / `[KNOWN GAP]` tags match what was built; every linked screenshot that shows a changed screen is retaken (`npm run shots:docs -- --only …`); a `docs/agent-notes.md` entry for anything learned the hard way.

## Later (not in this spec's PRs)

- FR-047 *Start a new session with it* (New session dialog first message), its own delta.
- FR-094 *Turn it into a prompt* (#581), after #581 has a spec.
- #559 export/import of notes; #430 search across chats; FR-090 global inbox; FR-091 agent-added notes (spec 041).

## Dependencies

- T001 first (spec deltas). T010, T011, T014 in parallel; T012 after T010 and T011; T013 after T012.
- T020..T023 after T013 and T014 (T021 can start with T010). T024 closes the MVP.
- Phase 3 tasks after T024; T030..T032 in parallel. Phase 4 after T034 (the switch lives in the screen). T050 after T024.

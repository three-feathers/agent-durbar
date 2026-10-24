# Implementation Plan: Notes (save an idea or a message and carry on later)

**Branch**: `083-folder-notes` | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)

## Summary

Main gets a small per-folder notes store (one JSON file per folder in userData, 0600, atomic writes, masked text, merge on outside change) and an optional mirror to `.durbar/notes.md` per folder. A window-only IPC module exposes it by agent id. The window adds a `⋯` per message (shared menu element), a Notes drawer over the chat log of the Chat view, a text-entry kind in spec 073's `/` list, a header count, a saved-message icon, a selection button and a per-folder Notes screen. The simulator answers every call in memory. No adapter change; no credits.

## Technical Context

- **Language**: TypeScript (main, shared), plain JS renderer. **No new dependency.**
- **Storage**: `<userData>/notes/<fingerprint>.json` (0700 folder, 0600 file); `notesFile: true` flag in `folders.json`; optional `<folder>/.durbar/notes.md`.
- **Testing**: `scripts/test-notes.ts`, `scripts/test-notesmd.ts` (unit, temp folders, fake `fs`), additions to `test-redact`, `test-navigator`, `test-slashcommands`, `test-ipcchannels`; driver `scripts/check-notes.js` (in `ui-suite.js`); `check:office`.
- **Platforms**: paths with `path`; folder key normalised by `normaliseFolderKey` (Windows lower-case; macOS case gap as usage totals, spec Edge cases); Windows rename retry; no POSIX-only calls (modes ignored on Windows).
- **Performance**: a folder's notes load once per window per folder and on `notes:changed`; every list and search is in memory (≤ 300 notes); SC-005.

## Reused capabilities (AGENTS.md: look for an existing capability first)

- **Menus**: `#modeMenu` / `.mode-menu`, `closeModeMenu`, `placeMenu`, and the keyboard and right-click rules of `openPrevMenu` (`src/renderer/app.js:5896`, `:2191`). No new popup element.
- **Dialogs**: `askDialog` (`input.multiline`, `returnFocus`, *Cancel* focus) for *+ Note*, Edit, Rename, Delete, Delete all, Start over, the switch warning and turn-off choice.
- **`/` list**: `slashsuggest.js` (`tokenAt`, `filter`, `optionHtml`, `view`, `tip`) and `slashUpdate` / `slashPick` (`src/renderer/app.js:2050-2110`); the change adds a `note` source and `insertText`, and widens `slashSupported`.
- **Masking**: `redact`, `redactMarkdown` (`src/shared/redact.ts`), `DurbarSafeText.mask` / `excerpt`, `DurbarCutText.cutText`.
- **Store patterns**: `FolderSetupStore` (atomic, 0600, tolerant read), `UsageTotalsStore` (fingerprint, injected file path, debounce), `randomPlaceId` (uniform ids).
- **Session of an agent**: `resumeIdFor` (`src/main/main.ts:593`), `agents` map; IPC module pattern of `src/main/ipc/slash.ts` and `ipcguard` `fromApp`.
- **Screens**: `screens.js` (Schedules screen pattern), `#screen`, Ctrl+K entries (`app.js:2614` list).
- **Scrolling and focus**: `DurbarScroll.reveal`, `focusIn` (`innerscroll.js`), never `scrollIntoView`.
- **Ranking**: `DurbarNav.rank`. **Shortcut list**: `TAKEN`. **Icons**: `ICON()`; colours from theme tokens.
- **Previous sessions open path** (spec 006) for *Open source* of an old session.

## Constitution Check

| Principle | How this plan complies |
| --- | --- |
| I Spec Kit | This spec, plan and tasks first; deltas in specs 005, 006, 073, 074 (T001). |
| II Adapters are plug-ins | No adapter change; main uses `resumeIdFor` and the adapter id string only; no vendor type in the renderer or `src/shared`. |
| III Safe, no secrets | Masked before stored (FR-005), never raw on disk or in logs; 0600 files; window-only IPC with validation; no path from the window; no shell, no git (FR-051); repo file read with link, FIFO and size guards. |
| IV No credits | Notes never call an agent app; simulator store; unit tests with fakes. |
| V Calm UI | Drawer inside the panel; nothing on the office floor (D10); 10.5px; icon + word; reduced motion; keyboard and names; 480px header; 15 agents at both sizes (FR-061). The marker is an icon, not an emoji (D4). |
| VI Parity | `path` everywhere; Windows rename retry; mode bits only on POSIX; macOS case gap written as `[KNOWN GAP]`. |
| VII Gates | `typecheck`, `build`, `npm test`; tests for the store (a new store, VII.3); screenshots. |
| VIII Honest limits | Spec *Honest limits*; Windows/macOS by CI and fakes only. |

No violation; no Complexity Tracking entry.

## Data model

### Local document (`notes/<fp>.json`)

```text
{ "version": 1,
  "folderName": "<display name, ≤ 80>",
  "notes": [ {
      "id": "n-[a-z0-9]{12}", "title": "1..80", "text": "≤ 16,000, masked Markdown",
      "createdAt": "ISO UTC", "updatedAt": "ISO UTC", "rev": 1, "done": false,
      "from": "agent|user|selection|typed|file", "fileEdited": false, "hidden": false,
      "source": { "app": "copilot|claude|codex|…", "session": "<id, sessionIdOk>", "role": "user|agent",
                  "ord": 0, "digest": "[0-9a-f]{16}", "at": "ISO UTC" }   // optional
  } ],
  "tombstones": [ { "id": "n-…", "deletedAt": "ISO UTC" } ],
  "mirror": { "sha256": "[0-9a-f]{64}", "bytes": 0, "at": "ISO UTC" } }   // optional: the last notes.md Durbar wrote (FR-053)
```

Parsing is tolerant per note (a bad note is dropped, the rest kept) but a bad document (unknown version, not JSON, over 16 MB) is FR-007. Session ids are checked with `sessionIdOk(app, id)` (`src/shared/sessionid.ts`).

### Project file (`.durbar/notes.md`) grammar

```text
file     := header section*
header   := "# Notes" LF LF "<!-- Kept by Agent Durbar (spec 083). One section per note; keep the durbar-note lines. Secrets are masked. To add a note, start it with a line <!-- durbar-note -->. Notes deleted here come back; delete them in Durbar. -->" LF
section  := LF marker LF "## " title LF LF body LF
marker   := "<!-- durbar-note id=" ID " created=" ISO " updated=" ISO [" done"] " -->"   (written)
          | "<!-- durbar-note" [any attributes] " -->"                                  (read: no or unknown id = a new note)
body     := lines; a line starting with "<!-- durbar-note" is written as "\<!-- durbar-note…"; trailing blank lines trimmed
```

Read: CRLF accepted and turned into LF; a section ends at the next `marker` line at column 0 (code fences do not hide a marker; the write-side escape is what keeps a note's own marker-like line inside it); a `## ` line right after a marker is the title, else the title is guessed (FR-004). Text before the first marker, other than the header, is not imported: a `## ` heading there starts a new note (FR-054); any other stray text is dropped at the next write, and the view says once *Text outside notes in notes.md is not kept* (tested).

## Architecture

### Main

- `src/shared/notes.ts` (pure): types, `NOTES_LIMITS` (character caps, and `storeBytes` / `mdBytes` computed from them, FR-006), `stripControls`, `fitsCap(bytes, cap)`, `parseNotesDoc`, `cleanTitle`, `guessTitle`, `newNoteId(rand)`, `mergeDocs(a, b)`, `applyChange(doc, change, now)` (rev check), `orderForFolder`, `rawDigestInput` (the normalisation both sides use).
- `src/shared/redact.ts`: `maskNoteText(text, env?)` (R4).
- `src/shared/notesmd.ts` (pure): `writeNotesMd(notes)`, `parseNotesMd(text)` → `{ ok, sections, conflict?, strayText? }`.
- `src/main/notesstore.ts`: `NotesStore(dir, { fs?, now?, rand?, platform? })`: `list(folderKey)`, `save`, `update`, `delete`, `deleteAll`, `exportText`; per-folder queue; stat-and-merge; FR-007 read-only state; `notes:changed` callback.
- `src/main/notesfile.ts`: the project mirror, used only while `notesFile` is on: `count(folderPath)` (the turn-on dialog only), `syncOut(folderPath, notes, mirror)` (checks, `O_EXCL`+`O_NOFOLLOW` temp, then right before the rename: real path and `lstat` of `.durbar`, `lstat` of `notes.md`, hash equal to `mirror.sha256`; a different hash aborts and imports first; returns the new `mirror` for the store to persist), `readBack(folderPath, mirror)` (≤ `mdBytes`, imports as `from: file` / `fileEdited`), `remove(folderPath, mirror)`, `addExclude(folderPath)` (walk up to `.git`, `gitdir`/`commondir`, append one anchored line with `O_APPEND`/`O_NOFOLLOW`; no git process, no `.gitignore`); link, real-path, FIFO, size and Windows-retry guards; injected `fs`.
- `src/main/ipc/notes.ts`: `register({ agents, store, file, folders, resumeIdFor, adapterOf, showSaveDialog })`; `fromApp`; `import { register as registerNotes } from './ipc/notes'` (the `test:ipcchannels` rule).
- `src/main/folders.ts`: `notesFile?: true` on `SavedFolder` (parse and write), set through the notes IPC only; *Remove folder*'s path takes `{deleteNotes}` and deletes the folder's store file when set (FR-048).
- **Masking values:** `src/main/ipc/notes.ts` gets `extraSecretValues(folderKey)` (as `mcp/readtools.ts` deps) and `secretValuesFor(agentId)` (`mcpipc.ts`) and passes them to `maskNoteText(text, values)`.
- `src/preload` + `src/shared/api.ts`: the FR-062 calls, typed.

### Window

- `src/renderer/notes.js` (pure, `window.DurbarNotes`, a new global name: `test:globals`): grouping and order (FR-021), row view (masked), search (FR-043), insert text (FR-024's blank-line rule), `digestInput`, marker matching (FR-041), `/` entries from notes (FR-030).
- `src/renderer/app.js`: message `⋯` (FR-010), save calls and toasts, drawer (FR-020..FR-027), `/` list wiring (`slashSupported`, `slashPick` with `insertText`), header count, marker, selection button, Ctrl+Shift+M, Ctrl+K entries, More item.
- `src/renderer/screens.js`: the Notes screen (FR-044..FR-048, FR-050).
- `src/renderer/navigator.js`: one `TAKEN` row. `slashsuggest.js`: `insert` for `insertText`, `optionHtml` for `note` rows, `RANK.note=3`.
- `styles.css`: drawer, rows, marker, count chip; tokens only (theme ratchet); comments say "issue 699", never `#699`.
- Digest in the window: `crypto.subtle.digest('SHA-256', …)` over `DurbarNotes.digestInput(raw)`; main computes its own on save and is the authority; a shared test vector keeps both equal.

### Simulator

- `src/renderer/sim.ts`: the notes calls on the canned bridge, an in-memory map per room, `simnotes=` seeds, fake tokens built at run time (push protection, `docs/agent-notes.md`).

## Project Structure

```text
specs/083-folder-notes/   spec.md, plan.md, research.md, tasks.md
src/shared/               notes.ts, notesmd.ts, redact.ts (maskNoteText), api.ts
src/main/                 notesstore.ts, notesfile.ts, ipc/notes.ts, folders.ts, main.ts (wiring)
src/preload/              the bridge calls
src/renderer/             notes.js, app.js, screens.js, slashsuggest.js, navigator.js, sim.ts, index.html (script tag), styles.css
scripts/                  test-notes.ts, test-notesmd.ts, check-notes.js; test-redact.ts, test-navigator.ts, test-slashcommands.ts, ui-suite.js
docs/                     README feature list and *Safety model* line on notes; changelog.d/083-folder-notes.md; screenshots
```

## Phases

1. **MVP** (US1): T010..T024: store, masking, IPC, simulator, message `⋯` + save, drawer + Insert, `/` notes, shortcut, checks.
2. **Seeing and managing** (US2..US4): T030..T034: count, marker, search, selection save, Notes screen with Done, export and delete.
3. **Project file** (US5): T040..T042.
4. **Back to the source** (US6): T050.
5. **Converge**: T060.

## Complexity Tracking

None.

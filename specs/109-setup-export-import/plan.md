# Implementation Plan: Export and import the whole setup (spec 109)

**Branch**: `109-setup-export-import` (spec) | **Date**: 2026-11-09 | **Spec**: [spec.md](spec.md) | **Issue**: [#559](https://github.com/three-feathers/agent-durbar/issues/559)

## Summary

Four pure modules in `src/shared` describe the file: the format and its allow-lists, portable paths, one that builds the masked, ordered document from the stores' parsed views, and one that checks a hostile file and turns it into a preview and, with the person's choices, into new store documents. A main-process module owns the dialogs, the single pending import, the backup, the journalled all-or-nothing apply and undo, behind six window-only IPC channels. The renderer adds a Settings section and two dialogs built on `askDialog`. No dependency, no adapter change.

## Technical context

- **Language and stack**: TypeScript in `src/shared` (pure, no Electron, no fs) and `src/main`; plain JS in `src/renderer`.
- **Dependencies**: none new. JSON only (`JSON.parse`, `TextDecoder` with `fatal`).
- **Storage**: reads and writes the existing store files only (`durbar-folders.json`, `durbar-settings.json`, `durbar-mcp.json`, `folder-setup.json`, `durbar-schedules.json`, `notes/*.json`); new: `<userData>/setup-backups/<UTC>/` and `<userData>/setup-import.journal`. Renderer display values stay in `localStorage`.
- **Testing**: Node unit tests `scripts/test-setup-*.ts` (in `npm test`, all three OS runners), a simulator driver `scripts/check-setup-transfer.js` with `until()` waits at 1440x900 and 1280x800. Zero AI credits.
- **Targets**: Windows, macOS, Linux.
- **Limits**: file 16 MiB, depth 16, 200,000 values, key 128 chars, string 64 KiB unless the field says less, notes 8 MiB in total; counts from the owning stores (spec FR-053, FR-054).

## Architecture

| Unit | Kind | Job | Spec |
|---|---|---|---|
| `src/shared/setupformat.ts` | pure TS | Constants (`FORMAT`, `SCHEMA_VERSION = 1`, `NEEDS_VALUE`, limits), section order, the canonical serializer (sorted keys, 2-space, LF, final LF), the allow-lists for settings (FR-013) and display (FR-015) with one validator per key, and the migrations table (empty for v1). | FR-001..FR-004, FR-010, FR-013, FR-015, FR-016 |
| `src/shared/setuppath.ts` | pure TS | `toPortable(path, home, platform)` -> `{ base, root?, parts }`; `fromPortable(p, sourceOs, home, platform)` -> local path or `unresolved`; part validation; `~` in MCP text fields; uses `path.win32` / `path.posix` and `normaliseFolderKey`. | FR-040..FR-042, FR-039, FR-090 |
| `src/shared/setupexport.ts` | pure TS | `buildExport(views, choices, mask, env)`: from the stores' parsed views (passed in), applies FR-019..FR-022 (placeholders, drops, masks, then cut), returns the document and a summary (counts, what was left out). `mask` is redact's functions passed in. | FR-013..FR-022 |
| `src/shared/setupimport.ts` | pure TS | `readEnvelope(bytes)` (FR-050..FR-053: decode, parse, the linear walk with depth, count, key length and forbidden keys), `checkDoc(doc)` (FR-054..FR-057: per-field schema through the stores' parsers, unknown-key rules of FR-012), `buildPreview(doc, current, platform, home)` (rows, matching, conflicts, dependencies, disabled reasons), `planApply(doc, preview, choices, current)` -> new store documents (FR-030..FR-038, FR-044..FR-046). | FR-010..FR-012, FR-030..FR-038, FR-044..FR-049, FR-050..FR-058 |
| `src/main/setuptransfer.ts` | main, no Electron import | The pending import (random token, 10 min, FR-065); collecting views from `FolderStore`, `SettingsStore`, `McpStore` (a new read-only `exportView()` that never decrypts the vault), `FolderSetupStore`, the scheduler doc, `NotesStore`; folder checks (`lstat`, `realpath`, inside `userData` refused, FR-043); the busy check (FR-064); backup (FR-060), journal, temp writes, renames, roll back and start-up recovery (FR-061); undo (FR-062). fs, dialogs and `nativeConfirm` are injected. | FR-041, FR-043, FR-060..FR-065 |
| `src/main/ipc/setup.ts` | IPC | Six channels through `ipcHandle` (each `fromAppFrame`): `setup:export(sections, display)`, `setup:importPick()`, `setup:mapFolder(token, rowId)`, `setup:importApply(token, choices)`, `setup:undo()`, `setup:status()` (last backup time). | FR-050, FR-063, FR-065, FR-070 |
| `src/main/notesexport.ts` | existing | `writeNotesExport` reused with `what: 'setup'` and `maxBytes` 16 MiB for the export file. | FR-071 |
| `src/main/schedules.ts` | existing | `pausedReason` gains `'imported'` (parse, show, resume clears it). | FR-035 |
| `src/main/main.ts` | existing | Journal recovery before the stores load; wiring of `setuptransfer` (stores, dialogs, `nativeConfirm`, `userData`). | FR-061 |
| `src/renderer/setupxfer.js` | UMD | Settings > Setup file section, the export dialog, the preview dialog (sections, rows, boxes, mapping choices, mode, summary live region), the display allow-list read and write (shared rules from `setupformat.ts`'s compiled copy, loaded as a page script through `exports-shim.js` like `redact.js`). New script line in `scripts/copy-assets.js`. | FR-046, FR-049, FR-070, FR-080..FR-085 |
| `src/main/appmenu.ts` | existing | macOS File menu *Export setup…*, *Import setup…* open the dialogs only. | FR-084 |
| `src/renderer/sim.ts` | existing | A simulator fake for `setup:*` (fixture preview from `scripts/fixtures/setup/`; apply is a no-op), so drivers need no real profile. | test only |

**IPC validation in main** (constitution III): `sections` is an array of known section names; `display` passes the FR-015 allow-list and validators (unknown keys dropped, bad values refused); `token` is the current pending token (string, 32 hex); `rowId` and every id in `choices` must exist in that token's preview; `choices.mode` is `'merge'` or `'replace'`; per-row values are from closed lists (`take`, `skip`, `missing`, `keepAllowAll`). No channel takes a path or file content. All refusals are short reasons without paths.

**Not exposed**: no tool in the Durbar MCP server (`src/main/mcp/`), no remote-control action (`remoteops.ts`), no schedule action, no `SIM_OPEN_CHANNELS` entry (the simulator uses its fake). `test:setup-ipc` asserts this.

## Existing capability check (spec 021 FR-031)

Reused, not rebuilt: the stores' parsers for every field (`parseSavedFolders`, `parseFloors`, `parseSavedOrder`, `parseSettings` per key, `validateInput`, `NAME_RE`, `cleanSchedule`, `NOTES_LIMITS`); `McpStore.upsert` as `mcpimport.ts`'s `applyFolderImport` uses it (servers off and untrusted, 020 FR-020..FR-031); `redact.ts` masks; `writeNotesExport` and `exportFileName`'s cleaning; main's `showOpenDialog` / `showSaveDialog` pattern; `nativeConfirm`; `ipcHandle` / `fromAppFrame`; `folderFingerprint` / `normaliseFolderKey`; spec 074's `clashOf`; the remove-folder path with its notes box (083 FR-048); `askDialog`; `settingsnav.js`; `orgpolicy.ts`. New: the two shared modules, `setuptransfer.ts`, one IPC file, one renderer module, one `pausedReason` value, `McpStore.exportView()`.

Considered and not reused: `mcpimport.ts`'s preview (VS Code `mcp.json` only; its rules are followed, its parser is not the format here); spec 069's global MCP backups (they back up harness files, which this feature never touches).

## Constitution check

- **I Spec Kit**: spec, plan and tasks before any `src/` code. Pass.
- **II Adapters**: no adapter code; `adapterId` is a stored id; an app not set up here degrades as restore does. Pass.
- **III Safe by default, no secrets**: no secret value is read into the file (FR-020, the vault is never decrypted for export); imported servers off and untrusted, rules re-asked, schedules paused, Allow all not imported without a separate box (FR-030..FR-038); hostile-file rules FR-050..FR-058; main owns every path and dialog; window-only channels validated in main; person-only accept (FR-063). Pass.
- **IV No credits**: unit tests and simulator only; SC-008. Pass.
- **V Calm UI**: 10.5 px floor, both sizes, words not colours, keyboard and screen reader (FR-080..FR-083). Pass.
- **VI Platforms**: pure path module with injected platform and home (FR-090); dialog filters and modes per OS; `[KNOWN GAP]` FR-112, FR-114 for real machines. Pass.
- **VII Quality gates**: tests per group, screenshots in three worlds at both sizes. Pass.
- **VIII Honest limits**: FR-110..FR-115, Q1..Q5. Pass.

## Complexity tracking

None. Multi-file atomic apply uses a journal plus backup instead of one transaction (no database); FR-113 states the limit.

## Test strategy

- **Unit (Node, every OS)**:
  - `test:setup-format`: canonical bytes (twice the same), section order, allow-list classification tests (every `AppSettings` key; every `durbar.*` key found in `src/renderer` by a scan), migrations table.
  - `test:setup-path`: home and non-home paths on win32, darwin, linux with injected homes; drive letters, UNC, case rules, part validation (`..`, `.`, separators, NUL, 256 chars, 65 parts), `~` in MCP fields; cross-OS resolution table.
  - `test:setup-export`: SC-002 planted secrets and user names; placeholders vs drops per FR-020; masking then cut; the whole-text backstop counter; notes over 8 MiB; loops left out.
  - `test:setup-import`: SC-003 hostile fixtures (oversize, UTF-16, NUL, BOM, CRLF, depth 17, 200,001 values, 129-char key, `__proto__` / `constructor` / `prototype` at depth 1 and 10, duplicate folder, unknown major version, unknown section, unknown key in a display item vs a server item, trust fields set, env values present); a CPU-time bound on the 16 MiB fixture (`cpuMs`, agent-notes timing rule); merge and replace matching per section; dependencies; caps; Allow all; SC-004.
  - `test:setup-apply`: SC-001 round trip on temp `userData` folders with the real stores; SC-005 fault injection at every write, `fsync` and rename with an injected fs; journal recovery; SC-006 undo; backup rotation; modes 0600 / 0700 on POSIX.
  - `test:setup-ipc`: each channel refuses another frame, a stale token, unknown ids, bad modes, a path-like argument; no setup tool in the Durbar MCP tool list; no `setup:` channel in `SIM_OPEN_CHANNELS`.
- **Driver (simulator `DURBAR_SIM=15`, both sizes)**: `check-setup-transfer`: Settings > Setup file present in Open office, Real office, Retro arcade; export dialog boxes; preview from the simulator fixture: keyboard order, Space, Esc and focus return, names and descriptions, live region text, 200-row fixture collapsed sections, no overflow, text floor; screenshots.
- **Mutants**: drop the forbidden-key check, skip the placeholder for one env value, let `enabled` through, skip the journal roll back: each must fail a named assertion (checklist: a kill by a compile error does not count).

## Risks

A store gains a field and nobody classifies it (the classification tests fail the build); a secret in free text (FR-111, said in the UI); a hostile file through a parser corner (`JSON.parse` only, allow-list copies, forbidden keys refuse the file); partial apply after a crash (journal); a person importing Allow all by habit (Q1 default unticked).

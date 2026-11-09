# Tasks: 109 Export and import the whole setup

**Input**: [spec.md](spec.md), [plan.md](plan.md). **Tests first**, 0 AI credits, simulator and unit tests only. One PR per group (G1..G9); a task is one issue. Numbers checked against `main`, remote branches and open PRs on 2026-11-09. Every UI group adds simulator screenshots at 1440x900 and 1280x800 (Open office, Real office, Retro arcade), a changelog fragment, and the docs that `docs/rules/docs-sync.md` names.

## Spec

- [ ] T001 Spec, plan, tasks and specs-index block (`specs/109-setup-export-import/`), Refs #559. Test: `npm run specs:check`, `npm run rules:check`, `npm run specs:index`.

## G1: format and paths (pure)

- [ ] T002 [G1] `src/shared/setupformat.ts`: constants, section order, canonical serializer, settings and display allow-lists with validators, the classification lists of what is not exported, migrations table. Test first: `test:setup-format` (same bytes twice except `createdAt`; LF, no BOM, final LF; every `AppSettings` key classified; every `durbar.*` storage key used in `src/renderer` classified; reserved fields for #555 and #452 absent until built) [FR-001, FR-002, FR-003, FR-004, FR-010, FR-013, FR-015, FR-016, FR-017, FR-094]
- [ ] T003 [G1] `src/shared/setuppath.ts`: `toPortable`, `fromPortable`, part validation, `~` in MCP text fields, injected platform and home. Test first: `test:setup-path` (win32, darwin, linux; drive letters, UNC, case rules, `..`, `.`, separators, NUL, 256-char part, 65 parts, foreign `abs` paths unresolved; user name never in output) [FR-039, FR-040, FR-041, FR-042, FR-090]

## G2: export document (pure)

- [ ] T004 [G2] `src/shared/setupexport.ts`: `buildExport` from parsed views with injected masks: placeholders and drops (FR-020's table), mask then cut, the whole-text backstop and its counter, notes 8 MiB limit, loops left out, summary counts; `McpStore.exportView()` that never decrypts the vault. Test first: `test:setup-export` (SC-002 planted env, header, token-shaped arg and URL, tokens in a prompt and a note, `/home/<user>` and `C:\Users\<user>`; every not-exported field absent; mutants: one env value without placeholder, `enabled` kept) [FR-003, FR-013, FR-014, FR-015, FR-017, FR-018, FR-019, FR-019a, FR-019b, FR-019c, FR-019d, FR-020, FR-021, FR-022, FR-091, SC-002]

## G3: import checks and preview (pure)

- [ ] T005 [G3] `src/shared/setupimport.ts` `readEnvelope` and `checkDoc`: decoding, `JSON.parse` only, the linear walk (depth 16, 200,000 values, key 128 chars, `__proto__` / `constructor` / `prototype` refuse the file), strict per-field schema through the stores' parsers and limits, allow-list copies, unknown sections and keys (FR-012), version rules. Test first: `test:setup-import` hostile fixtures (SC-003) and a CPU-time bound on the 16 MiB fixture; mutants: drop the forbidden-key check, accept a newer major version [FR-010, FR-011, FR-012, FR-050, FR-051, FR-052, FR-053, FR-054, FR-055, FR-056, FR-057, FR-058, SC-003]
- [ ] T006 [G3] `buildPreview` and `planApply`: rows, merge and replace matching per section, conflicts, dependencies, disabled reasons (limits, policy, unknown keys), trust fields ignored, servers off and untrusted, accepted digests dropped, schedules paused `'imported'`, `notesProject` off, Allow all as Ask with its box, caps that raise the limit unticked, theme fallback, shortcut clash via `clashOf`. Test first: `test:setup-import` preview cases and SC-004 [FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, FR-036, FR-037, FR-038, FR-044, FR-045, FR-046, FR-047, FR-048, FR-049, SC-004]

## G4: apply, backup, undo (main)

- [ ] T007 [G4] `src/main/setuptransfer.ts`: pending import (token, 10 min), view collection, folder checks (`lstat`, `realpath`, inside `userData` refused), busy check, backup (0700 / 0600, rotation of 3), temp writes, journal, renames, roll back, start-up recovery, undo with a backup first. Test first: `test:setup-apply` (SC-001 round trip on temp profiles with the real stores; SC-005 fault at every write, `fsync` and rename; crash journal; SC-006 undo; modes on POSIX; notes files named from local fingerprints only) [FR-041, FR-043, FR-060, FR-061, FR-062, FR-064, FR-065, FR-093, FR-113, SC-001, SC-005, SC-006]
- [ ] T008 [G4] `src/main/schedules.ts`: `pausedReason` `'imported'` (parse, label "Imported: check and resume", resume clears it). Test: `test:schedules` cases [FR-035]

## G5: IPC and wiring (main)

- [ ] T009 [G5] `src/main/ipc/setup.ts` (six channels, `ipcHandle` + `fromAppFrame`, validation of every argument), wiring in `main.ts` (journal recovery before the stores load; dialogs; `nativeConfirm`), export through `writeNotesExport` (16 MiB, 0600). Test first: `test:setup-ipc` (another frame, stale token, unknown ids, bad mode, path-like arguments refused; no setup tool in the Durbar MCP server; no `setup:` channel in `SIM_OPEN_CHANNELS`; no remote action) [FR-050, FR-061, FR-063, FR-065, FR-070, FR-071, FR-072, FR-092]

## G6: the window

- [ ] T010 [G6] `src/renderer/setupxfer.js` + `scripts/copy-assets.js` line: Settings > **Setup file** section (*Export…*, *Import…*, *Undo import*), the export dialog with section boxes and FR-022's sentence, the result toast. Simulator fake for `setup:*` in `sim.ts` with fixtures in `scripts/fixtures/setup/`. Test: `check-setup-transfer` export steps at both sizes [FR-022, FR-070, FR-072, FR-084]
- [ ] T011 [G6] The preview dialog: mode radio group, sections as `fieldset`s with *All* boxes and collapse over 20 rows, rows with boxes and the mapping radio group, *Choose folder…*, disabled reasons, summary live region, refusal sentence to `#srAnnounce`, display values written last. Test: `check-setup-transfer` (keyboard order, Space, Esc and focus return, accessible names and descriptions, live region text and rate, 200-row fixture, no overflow, 10.5 px floor) [FR-042, FR-046, FR-047, FR-048, FR-049, FR-080, FR-081, FR-082, FR-083, SC-007]
- [ ] T012 [G6] macOS File menu *Export setup…* / *Import setup…* in `appmenu.ts` opening the same dialogs. Test: `test:appmenu` (items present on darwin only, they send the open-dialog message and never apply) [FR-084]

## G7: worlds and docs

- [ ] T013 [G7] Real office and Retro arcade: the section and both dialogs through world tokens only, Retro pixel font at least 10.5 px; screenshots of Settings > Setup file, the export dialog and the preview in Open office, Real office and Retro arcade at 1440x900 and 1280x800 (`DOC_SHOTS` entries); feature inventory row for every world. Test: `check-setup-transfer` in each world; `npm test`'s feature inventory check [FR-085, SC-007]
- [ ] T014 [G7] Docs: README (status, *Safety model* line on imports), `docs/features.md`, `docs/safety.md` (what the file holds and never holds, untrusted on import, backup and undo), `docs/limits.md` (FR-110..FR-115), changelog fragment. Test: `npm run rules:check`, the docs check [FR-022, FR-110, FR-111, FR-112, FR-113, FR-114, FR-115]

## G8: follow-ups the format reserves

- [ ] T015 [G8] When #555 (basement, rooftop) or #452 (chat docking) is specified, add a line to its spec and tasks: "adds its fields to spec 109's export (FR-016) in the same PR". Test: `test:setup-format` classification fails until it does [FR-016, FR-110]

## G9: owner questions and real checks (not in CI)

- [x] T016 [G9] Q1..Q5 answered by the owner (all (A), Vikram, 2026-11-09 07:24 UTC); spec, plan and tasks updated to the answers. Test: `npm run specs:check` [FR-033, FR-040, FR-048, FR-060, FR-022]
- [ ] T017 [G9] Real move between two machines of different OS (macOS to Windows, Linux to macOS) by the machines' owners: mapping, case rules, file modes, dialogs; recorded as `real:` in the spec. No agent session, no credits [FR-114, FR-090, FR-092, FR-093]
- [ ] T018 [G9] Real screen-reader run (NVDA on Windows, VoiceOver on macOS) of the preview, asked of the machines' owners [FR-081]

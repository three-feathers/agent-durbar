# Tasks: Folders, workspaces, sessions and history

## Done (as built)

- [x] T001 Add folder / workspace file dialogs, one agent per workspace, `resolveWorkspaceCwd` with JSONC parsing [FR-001]
- [x] T002 `FolderStore` + `parseSavedFolders`, atomic private writes, tests [FR-002, SC-001]
- [x] T003 Restore as lazy agents; `ensureLive` resume-or-create under the same id [FR-003]
- [x] T004 New session dialog and `#n` naming [FR-004]
- [x] T005 Folders popover: New session, Hide/Show, Remove with confirm [FR-005]
- [x] T006 `previousSessionsFor`, `sameDir`, `cleanTitle`, `eventsToHistory` with caps, tests [FR-006, SC-002]
- [x] T007 Resume IPC with folder re-check and replace-after-success; history replay [FR-007]
- [x] T008 Toast and auto-open for earlier sessions [FR-008]

## Open

- [x] T020 (2026-10-19) Give workspace sessions access to all roots (SDK `additionalDirectories`-style option, check the SDK first) or document the limit in the README. [FR-010, FR-019: Copilot `additionalDirectories`, Claude `--add-dir`, tests, docs]
- [x] T021 (2026-10-19) Decide whether per-folder session count should persist (clarify). [FR-011] Decided 2026-10-19 by the owner: the last session continues (FR-020, FR-021): store, restore, wake IPC with history replay, simulator, real check on Copilot and Claude, docs
- [ ] T022 Extract the main-process add/restore/resume logic into testable modules (inject adapter and store) and add credit-free tests. [FR-015]
- [ ] T023 Capture a real `events.jsonl`/`getEvents()` (redacted) as a fixture and re-run `test:history` on it (needs feature 013). [FR-009]
- [x] T024 Real-session check of lazy start and resume (feature 013). [FR-009]
- [ ] T025 Offer sessions started in subfolders (clarify matching rule). [FR-013]

## Changes 2026-10-18 (issue #170)

- [x] T026 Pure `broadFolderKind(path, home, flavour)` in `src/shared/broadfolder.ts` (home, parent of home, root, else none; Windows drive and UNC roots; case-insensitive on win32/darwin) with `scripts/test-broadfolder.ts` [FR-016]
- [x] T027 Main returns `warnings` with the add result (folders and the folders of a `.code-workspace`); the renderer shows one calm toast; simulator hook; screenshots at 1440x900 and 1280x800; docs [FR-016]

## Changes 2026-10-18 (remove a session, rename a folder)

- [x] T028 `agents:remove` in main (refuses the last main session of a folder and helpers), bridge, simulator; **Remove session** in the chat header with a confirm when busy [FR-017]
- [x] T029 `label` in `SavedFolder` (parse, save, restore) with `test:folders`; `folders:rename` in main, bridge, simulator; Folders > **Rename** dialog; room name everywhere [FR-018]
- [x] T030 Screenshots at 1440x900 and 1280x800, README, CHANGELOG, specs index [FR-017, FR-018]
- [x] T031 Search box in Previous sessions: title filter (case- and accent-insensitive) over Copilot sessions and VS Code chats, "N of M", "No sessions match", Escape clears; matcher unit test, simulator, `check:office` at both sizes, docs (issue #252) [FR-023]

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

- [ ] T020 Give workspace sessions access to all roots (SDK `additionalDirectories`-style option, check the SDK first) or document the limit in the README. [FR-010]
- [ ] T021 Decide whether per-folder session count should persist (clarify). [FR-011]
- [ ] T022 Extract the main-process add/restore/resume logic into testable modules (inject adapter and store) and add credit-free tests. [FR-015]
- [ ] T023 Capture a real `events.jsonl`/`getEvents()` (redacted) as a fixture and re-run `test:history` on it (needs feature 013). [FR-009]
- [ ] T024 Real-session check of lazy start and resume (feature 013). [FR-009]
- [ ] T025 Offer sessions started in subfolders (clarify matching rule). [FR-013]

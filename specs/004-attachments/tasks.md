# Tasks: Attachments

## Done (as built)

- [x] T001 Cap constants, `fmtSize`, `sniffImage`, `sanitizeName`, `stageAttachment` (`src/shared/attachments.ts`) [FR-001..FR-003]
- [x] T002 Unit test in `npm test` [SC-001, SC-002]
- [x] T003 Main-process picker, staging IPC, send-time whitelist and re-check, temp folder cleanup on quit [FR-001, FR-004, FR-006]
- [x] T004 Adapter conversion to SDK `blob`/`file` [FR-005]
- [x] T005 Renderer chips, `n/5` counter, messages that stay until the next action, drop overlay, paste, window-level drop guard [FR-007]
- [x] T006 Real-session check of file + image (m3) and no-credit e2e driver phase `m5`

## Open

- [ ] T020 Magic-byte check for dialog-picked images (reuse `sniffImage` in `agents:pickAttachments`). [FR-009]
- [ ] T021 Sweep stale `agent-durbar-att-*` folders at startup. [FR-010]
- [ ] T022 Reject empty dialog-picked files; image filter on the image button. [FR-012, FR-013]
- [ ] T023 Cap total bytes per message (clarify the number first). [FR-014]
- [ ] T024 Remove sent paths from `pickedFiles`. [FR-015]
- [ ] T025 Hand-check drag/drop/paste on macOS and Windows. [FR-016]

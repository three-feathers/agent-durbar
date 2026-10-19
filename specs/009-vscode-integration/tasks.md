# Tasks: VS Code integration

## Done (as built)

- [x] T001 Pure launch planning for macOS/Windows/Linux, no shell, guarded `cmd.exe` fallback, tests [FR-001, FR-002, SC-001]
- [x] T002 `openInVSCode` spawn wrapper with clear errors [FR-001]
- [x] T003 Chat store discovery per OS and `workspace.json` matching [FR-004]
- [x] T004 Tolerant append-log and flat-JSON parser, transcript builder, size caps, honest notes, tests [FR-005, SC-002]
- [x] T005 IPC with opaque keys; read-only view with banner [FR-006]
- [x] T006 Copy resume command and VS Code "External" hint [FR-007]
- [x] T007 README research notes on VS Code session visibility (documented, not verified) [FR-012]

## Open

- [x] T020 Reconcile Cursor: README claim removed 2026-10-16 (code unchanged; adding Cursor needs a verified store layout). [FR-008]
- [x] T021 (2026-10-19) Offer Insiders/VSCodium for "Open in" (clarify which binary to prefer). [FR-009, FR-015: stable, then Insiders, then VSCodium]
- [ ] T022 Run the real launch on macOS and Windows and record it. [FR-014]
- [ ] T023 Check the reader against a real VS Code chat store (redacted sample as a new fixture) (feature 013). [FR-011]
- [ ] T024 Verify that our sessions appear in VS Code's session list with the External filter (feature 013). [FR-012]
- [ ] T025 Clarify support for portable, Flatpak/Snap and remote workspaces. [FR-010]
- [x] T026 VS Code chat view: open at the latest message; `questionCarousel` read-only block and `mcpServersStarting` as a known hidden kind (synthetic fixtures); Continue in VS Code button; unit tests, simulator, scroll check at both sizes, docs (issue #253) [FR-015, FR-016, FR-017]

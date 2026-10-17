# Tasks: Permission modes, approvals and session grants

## Done (as built)

- [x] T001 `PermissionBroker` pure class with read/ask/allow policy [FR-001, FR-002]
- [x] T002 Grant scopes (folder, command name or exact command, host, tool) [FR-003]
- [x] T003 Approve once / Approve for this session / Deny; revocable chips [FR-004]
- [x] T004 Stop denies pending and keeps grants; End session clears all [FR-005]
- [x] T005 Adapter wiring: broker events -> status/permission/grants events [FR-006, FR-007]
- [x] T006 Renderer: inline notes, settle logic, chips, read-only hint [FR-006]
- [x] T007 IPC handlers with agent-id validation [FR-008]
- [x] T008 Unit test `scripts/test-permissions.ts` in `npm test` [SC-001, SC-002]
- [x] T009 Real-session verification of ask/deny/approve/read-only and grant (milestones 3 and 5)

## Open

- [x] T020 (third delta, FR-028..FR-030) Rename the `allow` mode in the UI to say what it does ("Allow all (no prompts)") in top bar, dialog, chat hint; align README. Spec delta first. [FR-010]
- [x] T021 (spec delta 2026-10-16, FR-023; implement + test) Decide and implement path checks for `read` (inside the folder/workspace roots only) or verify and document that the runtime enforces it; add a test. Needs `/speckit.clarify`. [FR-011]
- [x] T022 (FR-021) Re-confirm (or do not restore) Allow-all folders after a restart; clarify first. [FR-012]
- [x] T023 (FR-022) Option to narrow shell grants (command + first argument) or make the scope visible before approving. [FR-013]
- [x] T024 Switch an agent's mode from the chat header (with confirmation when moving to Allow all). [FR-014] (done in spec 018: header chip + card menu + confirm, tests in permissions)
- [x] T025 (2026-10-17 delta, FR-031/FR-032) Test `grantScope` with Windows paths via an injectable `path` flavor. [FR-016]
- [ ] T026 Collision-proof request ids when `toolCallId` is missing. [Edge case]
- [x] T027 (second delta, FR-025..FR-027) Restore the saved mode exactly incl. Allow edits, with a visible "restored" note; grants stay session-only; tests + README. Reverses T022's downgrade.
- [ ] T028 Windows grant keys: compare case-insensitively and treat `/` and `\` alike (constitution VI), e.g. normalize the folder in `grantScope` for the win32 flavor; update the known-gap test (spec delta 2026-10-17). [FR-032 known gap]

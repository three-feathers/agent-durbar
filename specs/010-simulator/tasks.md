# Tasks: Simulator and developer/test hooks

## Done (as built)

- [x] T001 Simulator producing normalized events and implementing the full bridge [FR-001, SC-001]
- [x] T002 Query/env options (count, freeze, solo rooms, seed, density, open) [FR-002, FR-003]
- [x] T003 Permission, attachment, model, new-session, folder and history stubs [User Story 2]
- [x] T004 Dev hooks: userData, open, pick, log, shot, driver, VS Code user dir [FR-004]
- [x] T005 Synthetic fixtures for tests [FR-005]
- [x] T006 e2e driver phases and headless smoke script [FR-006]
- [x] T007 Re-ran the driver hook headless on 2026-10-16

## Open

- [ ] T020 Run the simulator-based layout/overflow check in CI on Linux (see feature 001 T020). [FR-007]
- [ ] T021 Parameterize `e2e-driver.js` and `smoke.ts` paths via environment/relative fixtures. [FR-008, FR-011]
- [ ] T022 Disable or guard dev hooks when `app.isPackaged` unless `DURBAR_DEV=1`: spec delta written 2026-10-16 (FR-017..FR-020); implement `src/main/devhooks.ts` + `scripts/test-devhooks.ts`. [FR-009]
- [ ] T023 Contract test: simulator events validate against the `AgentEvent` type guard shared with the adapter test (feature 002 T020). [FR-010]

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

- [x] T020 Run the simulator-based layout/overflow check in CI on Linux (see feature 001 T020). [FR-007]
- [x] T021 Parameterize `e2e-driver.js` and `smoke.ts` paths via environment/relative fixtures. [FR-008, FR-011] (2026-10-19: `E2E_DIR`, `E2E_SHOTS`, `E2E_LOGS`, `E2E_HELLO`, `E2E_NOTES`, defaults under the temp folder; `SMOKE_FOLDERS` defaults to `<temp>/durbar-test/{hello-app,notes-app}`)
- [x] T022 Disable or guard dev hooks when `app.isPackaged` unless `DURBAR_DEV=1`: spec delta written 2026-10-16 (FR-017..FR-020); implement `src/main/devhooks.ts` + `scripts/test-devhooks.ts`. [FR-009]
- [x] T023 Contract test: simulator events validate against the `AgentEvent` type guard shared with the adapter test (feature 002 T020). [FR-010]

## 2026-10-22: the simulator never reaches a real agent app (incident on PR #505)

- [x] T024 `src/main/simguard.ts` (pure): `simulatorOn(dev)`, `SIM_OPEN_CHANNELS` with reasons, the refusal text, `simGuardDescriptors` and the inert stand-in adapter. [FR-022, FR-024]
- [x] T025 `src/main/ipcguard.ts`: `ipcHandle` refuses and `ipcOn` drops every channel not on `SIM_OPEN_CHANNELS` in simulator mode, before the handler runs. `main.ts`: registry through `simGuardDescriptors`; scheduler not started and `DURBAR_OPEN` ignored under the simulator; `createdAdapters()` on the driver context; `loginPathReady` uses `simulatorOn`. [FR-023, FR-024, FR-025]
- [x] T026 `scripts/test-simguard.ts` (`npm run test:simguard`, in `npm test`): dynamic refusal of every preload channel, the named spending list, allow-list hygiene, `main.ts` wiring, the stand-in adapter. [FR-026]
- [x] T027 `scripts/check-sim-guard.js` (`npm run check:sim-guard`, in `scripts/ui-suite.js`): the real preload API refused from the page under `DURBAR_SIM=15`, `harnessPlans` still answers, no real adapter created. [FR-026]
- [x] T028 Docs: `docs/agent-notes.md` entry on the driver trap (moved here from PR #505's branch), README *Development*, CHANGELOG, `specs/README.md` row. Check that `scripts/*-real.ts` never set `DURBAR_SIM`. [FR-027]

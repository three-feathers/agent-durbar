# Tasks: 024 places in the office (issue #18)

- [x] T001 Spec + clarifications + plan + tasks before code; specs index entry
- [ ] T002 `src/renderer/places.js`: `PLACES`, `classify()` with the default rules and user overrides; tests in `scripts/test-places.ts` [FR-001, FR-002, FR-010]
- [ ] T003 Visit state machine (`createVisits`: 600 ms debounce, 2 s dwell, newest call wins, leave on stop/end/error/idle, helpers ignored, injectable clock) + `layoutSpots` `+N`; tests [FR-003, FR-010]
- [ ] T004 Lobby band in `stageHTML` between the two halves of the open rooms, counted by `chooseLayout`; place tiles with occupants and accessible labels; hidden in Demo mode [FR-004, FR-006]
- [ ] T005 Walking overlay: empty-chair desk scene, figure glide ~1 s with walking keyframes, max 3 concurrent animations, reduced motion, positions recomputed after each render; card text `at <Place>: <tool>` [FR-005, FR-006]
- [ ] T006 `placeMap` in settings: `src/shared/places.ts` parse/validate (server names and place ids only), `SettingsStore`, IPC `settings:setPlace`, preload/api, simulator bridge; tests [FR-007, FR-010, FR-011]
- [ ] T007 Settings "Places" section in `screens.js` (server list, place picker, default label) [FR-008]
- [ ] T008 `check:office` lobby checks; fit at 1440x900 and 1280x800 with 15 agents [FR-009, SC-002]
- [ ] T009 Simulator driver for SC-001/SC-003, screenshots (lobby with agents, one mid-walk) at both sizes, README status, specs index [FR-010, SC-001, SC-003]
- [ ] T010 Simulator: `bash`/`github`/`playwright`/`my-notes` calls last 1.5-4 s (seeded); with `DURBAR_SIM_FREEZE=1` a fixed set of agents stays mid-call so the lobby is occupied in screenshots [SC-001, FR-010]

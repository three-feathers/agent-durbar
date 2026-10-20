# Tasks: Scheduled prompts (044)

## Phase 1

- [x] T001 Store and pure scheduler with a fake clock; unit tests [FR-001, FR-002]
- [x] T002 Main: timer wiring, busy tracking from events, send through the user's path, IPC [FR-002, FR-003]
- [x] T003 Renderer: Folders panel button and dialog, pause all, next run, chat note [FR-004]
- [x] T004 Simulator store and runs; screenshots at 1440x900 and 1280x800 [FR-005]
- [x] T005 Docs: README, CHANGELOG, specs index [all]

## Phase 2 (issue #291)

- [x] T010 Schedule per session; calendar rules; per-schedule credit cap; the AI's own schedules shown read-only (split into T030..T037 below)

## 2026-10-19: starter kit (issue #128)

- [x] T020 Starter templates in the Schedules dialog (pure module, picker, note) [FR-006]
- [x] T021 "Every day at": anchored intervals in the scheduler and the simulator [FR-007]
- [x] T022 Decision step in the briefing and planning templates; one real check on Claude [FR-008]
- [x] T023 Schedules from the room's ⋯ menu, a room clock chip, the chat header, and Settings > Schedules for all folders [FR-009, FR-010, FR-011]

## 2026-10-20: Phase 2 (issue #291)

- [x] T030 `src/shared/schedrules.ts`: `parseRule`, `nextRuleRun` (local wall clock), unit tests with `TZ=Europe/Zurich` (DST both ways, weekdays, weekly, passed times) [FR-012]
- [x] T031 Scheduler: rules, migration of `every: 1440 + at`, validation of the new fields [FR-012, FR-013, FR-017]
- [x] T032 Per-session target: send and busy check per session, pause when the session is gone, refuse Resume, main wiring [FR-014]
- [x] T033 Per-schedule cap: attribution from usage events until the turn ends, skip and pause at the cap, reset on Resume [FR-015]
- [x] T034 `agentSchedule` event: types, event guard, Copilot mapper, mapper test [FR-016]
- [x] T035 Renderer: calendar choice, Send to, Limit, row states, the agent's own schedules (read-only) [FR-012, FR-014..FR-016]
- [x] T036 Simulator: rules, targets, caps and pause states [FR-018]
- [x] T037 Docs: README, CHANGELOG, specs index; drivers updated for the new form [all]

## 2026-10-20: Read-only wording after the real MCP check

- [x] T040 *Start my day* and the Read-only mode help say an MCP tool runs in Read-only only when its server marks it read-only [FR-019a]

## 2026-10-20: Send to row and session names (issue #371)

- [x] T041 Schedules dialog: the Send to and Limit labels never wrap or sit under their control; the "This session" option is capped at 40 characters with the full name in its title; simulator check `check:sched-sendto`, CHANGELOG [FR-020, FR-021]

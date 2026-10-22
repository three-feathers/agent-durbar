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

- [x] T041 Schedules dialog: the Send to and Limit labels never wrap or sit under their control; the session name moves from the option to a hint line under the select (after the first design was still cut on a real Mac); simulator check `check:sched-sendto`, CHANGELOG [FR-020, FR-021]
- [x] T042 One shared text cutter `cuttext.js` (code points, whitespace, optional word boundary) used by `clipName`, `SHORT`, the grant and schedule-row texts and `attention.clip`, with `test:cuttext` [FR-021]

## 2026-10-22: edit a schedule (issue #522)

- [x] T043 Scheduler: `save` with `edit: true` (editable fields only, main keeps id, folder, pause, done, last and spend; next computed again; a changed past one-time time refused; a done one-time schedule edited with a future time runs again, `done` cleared); any unknown id refused; unit tests in `test:schedules` (keeps id/last/paused/pausedReason/spend, next moves for interval, rule and once and when paused, past time refused and schedule unchanged, edit at 50 schedules passes, a done one-time edited to a future time runs again and to a past time is refused, unknown id refused with and without `edit`, the renderer cannot set paused/done/last/spent) [FR-022, FR-023]
- [x] T044 Simulator `saveSchedule`: the same edit rules (unknown id refused, main-kept fields, next computed again) [FR-026]
- [x] T045 Renderer: Edit… on rows (dialog and Settings), the form in edit mode (filled, Save, Cancel, no template picker, Send to for a targeted schedule), one shared input builder for Add and Save [FR-022]
- [x] T046 Renderer: Settings folder button **Schedules for this folder…**; the prompt toggle with a tooltip of at most 300 characters, also for the agent app's own schedules [FR-024, FR-025]
- [ ] T047 Driver `scripts/check-sched-edit.js` (`npm run check:sched-edit`, in `ui-suite.js`) at 1440x900 and 1280x800 with the shared helpers and condition waits; screenshots `docs/screenshots/044-edit-*.png`; re-run `check:ui-text`, `shots-044-everywhere`, `shots-044-templates`, `check-sched-sendto` [FR-022..FR-026]
- [ ] T048 Docs: README *Scheduled prompts* line, CHANGELOG (or a `changelog.d/` fragment if #518 has merged), the specs index row, tags in spec 044 [all]

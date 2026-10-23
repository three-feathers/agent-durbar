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
- [x] T047 Driver `scripts/check-sched-edit.js` (`npm run check:sched-edit`, in `ui-suite.js`) at 1440x900 and 1280x800 with the shared helpers and condition waits; screenshots `docs/screenshots/044-edit-*.png`; re-run `check:ui-text`, `shots-044-everywhere`, `shots-044-templates`, `check-sched-sendto` [FR-022..FR-026]
- [x] T048 Docs: README *Scheduled prompts* line, CHANGELOG (or a `changelog.d/` fragment if #518 has merged), the specs index row, tags in spec 044 [all]

## 2026-10-23: run history and a folder's schedules (issue #624; waits for #560)

- [x] T058 Owner answers Q1..Q8 (Paco, 2026-10-23: Q1 = A after screenshots, Q2..Q8 the recommended options), recorded in the spec and plan; FR-036..FR-045 written to them [all]
- [ ] T059 `schedules.ts`: `ScheduleRun`, `runs` in the doc, `cleanRuns` on load (no `runs`, bad shapes, orphan ids, bad entries and fields, unknown fields, sort, cut to 50); `test:schedules` cases for loading and migration [FR-036, FR-038]
- [ ] T060 `schedules.ts`: one `record` helper replacing every `s.last =`; folding of busy/paused/held repeats; a loop pass is one entry; `manual` for Run now; `session` and the `no-agent`/`send-error` reason; `test:schedules` cases (log equals `last`, cap, folding and its limits, loop pass, reasons, sessions) [FR-036, FR-037]
- [ ] T061 `schedules.ts`: `remove` and `removeFolder` drop the logs, edits/pause/resume keep them; `runsOf(id)`; `publicDoc` without `runs`; fold-only ticks mark the file dirty instead of saving (flushed by the next real change, on quit via `flush()`, or within 60 min, never more than once per 60 s); tests: pass/fail a full 50×50 document serialised and written in under 25 ms of CPU (`process.cpuUsage`), an every-5-minutes schedule under Pause all for 1 h of fake clock causes at most 2 writes, a real change and `flush()` write the dirty state [FR-037, FR-038, FR-039, FR-043]
- [ ] T062 IPC `schedules:runs` (frame and id checked, read-only), `schedules:list` and `schedules:changed` send `publicDoc`; preload `scheduleRuns`; `DurbarApi` types (`ScheduleRunInfo`, `held`/`ended` in `last.outcome`); `test:ipcchannels` entry [FR-043]
- [ ] T063 Pure `src/renderer/schedhist.js` (`DurbarSchedHist`) with `scripts/test-schedhist.ts` (`npm run test:schedhist`, in `test:serial`): outcome words and icon kinds (all outcomes, `OUTCOME_WORD` moved here), reasons, folded text, empty text, spoken sentence, `hereLabel` for 0/1/50 (the count reuses `schedulesOf`/`folderKeyOf`; no folder predicate in the module) [FR-040, FR-042]
- [ ] T064 Renderer: History button and inline list on every Durbar row (dialog and Settings), newest first, words with icons, first 10 then Show all, live refresh of open lists, empty state, a11y names and order; Open chat / "chat closed"; CSS in theme tokens; four buttons inside the dialog at both sizes [FR-040, FR-041]
- [ ] T065 Renderer: *Schedules here (N)* label (`hereLabel`) on the folder menu item and the Folders panel button, both still opening the folder's existing dialog `openSchedules(r)` (Q1 = A); no Settings filter, no new button; update `shots-044-everywhere` and `shots-006-remove` for the new label [FR-042]
- [ ] T066 Simulator: the run log with the same rules (compared with main's on one sequence in `test:schedules`), `scheduleRuns`, `simsched=1` seed history, opt-in `simws=1` workspace room [FR-044]
- [ ] T067 Driver `scripts/check-sched-history.js` (`npm run check:sched-history`, in `ui-suite.js`) at 1440x900 and 1280x800 per the plan, with its three mutation checks; screenshots `docs/screenshots/044-history-*.png`, `044-folder-here-*.png`; re-run `check:sched-edit`, `check:sched-top`, `shots-044-everywhere`, `shots-006-remove`, `check:sched-sendto`, `shots-001-lobby`, `check:ui-text` [FR-040..FR-044]
- [ ] T068 Docs: README *Scheduled prompts* line (history per schedule, *Schedules here* on a folder) and *Development* (`check:sched-history`, `test:schedhist`); a `changelog.d/044-schedule-history.md` fragment; the spec 044 header (specs-index status line and **Status**); tags `[IMPLEMENTED]`/`[KNOWN GAP]` on FR-036..FR-045; `docs/agent-notes.md` entry if something was learned [all]

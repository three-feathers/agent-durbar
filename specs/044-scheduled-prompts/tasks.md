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

## 2026-10-22: Schedules in the top bar (issue #523)

- [x] T049 Pure `src/renderer/schedtop.js` (`activeCount`, `troubleSince`, `topText`) with `scripts/test-schedtop.ts` (`npm run test:schedtop`, in `test:serial`): done/paused not counted; Pause all text; missed and failed newer than the stamp, done one-time included, `skipped-*` ignored; no stamp = last 24 h; a later `sent` clears it; texts at most 120 characters with 50 schedules; keys text on Windows/Linux and Mac [FR-028, FR-029, FR-033]
- [x] T050 `screens.js`: `openSettings('schedules')` scrolls `#schH` to the top of `.scr-body` with `scrollInBody` and focuses it (`tabindex="-1"`), also when Settings is already open [FR-030]
- [x] T051 `index.html` + `app.js`: `#schedTopBtn` left of Needs you; `renderSchedTop()` from `schedChanged()`, folder and demo changes, detail level; shown rules; count with `rollCount`; paused and badge states; `aria-label`, title; click opens Schedules and sets `durbar.schedSeen`; polite announcement when the badge count grows (not at start) [FR-027, FR-028, FR-029, FR-033]
- [x] T052 `styles.css` (and `themes.css` only to recolour): button, word form from 1920px (2040px on a Mac) and in Simple, icon form below, paused and badge looks in theme tokens, `margin-left:auto` moved from Needs you; measure in DejaVu Sans (Noto Sans was not measured), Expert and Simple, six themes, floors and mixed agent apps, Mac room forced; make room only as measured (chip cap, then the folder filter through a `fitTopbar` step, then gaps); write the measured values into FR-034 [FR-027, FR-034]
- [x] T053 Keys and palette: Ctrl+Shift+S / ⇧⌘S in the global keydown (not under a modal dialog; works in fields and from a chat); a row in the shortcut sheet; the **Schedules** item in `palActions` [FR-031, FR-032]
- [x] T054 Simulator: `simsched=1` seed (reuse #511's if merged; else add it with the same data plus one `failed` last run) [FR-035]
- [x] T055 Driver `scripts/check-sched-top.js` (`npm run check:sched-top`, in `ui-suite.js`) at 1440x900 and 1280x800, Expert and Simple: placement, one row, count, badge and its clearing (also after reload), opening at the section without scrolling the page, Pause all, Ctrl+Shift+S (office, list, chat, not under a dialog), Ctrl+K, the sheet row, demo hides it, reduced motion; screenshots `docs/screenshots/044-topbar-*.png` [FR-027..FR-035]
- [x] T056 Existing checks with the button shown: `shots-052-addleft` (button in `topCheck`, run with `simsched=1`), `check:office`, `check:geometry`, `check:ui-text`, `check:mac-titlebar`, `shots-044-everywhere`, `check:sched-edit`; mutation: without the room-making rule `shots-052-addleft` fails at 1280x800 Expert with floors [FR-034]
- [x] T057 Docs: README (feature line, *Development* commands), CHANGELOG or a `changelog.d/` fragment, `docs/design-rules.md` top-bar order and widths, the Schedules *More* text in Settings, a cross-reference in spec 052 (FR-043, FR-105/FR-164), the specs index row, tags in spec 044; tell #511 about `openSettings('schedules')` and the done one-time miss (coordinator) [all]
  - Note 2026-10-24 (Mac run of `check:sched-top`): the driver branches on the platform's mod key (Meta and the label ⇧⌘S, aria-keyshortcuts `Meta+Shift+S` on macOS; Control and `Ctrl+Shift+S` elsewhere) for the Schedules shortcut and Ctrl+K. Driver only, the app is unchanged. `SCHED_TOP_FORCE_MAC=1` forces the macOS branch for the mutation check. The sheet row and the palette item are checked box by box (`['Ctrl','Shift','S']`, or `['⇧','⌘','S']` on macOS). [KNOWN GAP] the macOS branch is read, not yet run on a Mac.
## 2026-10-23: run history and a folder's schedules (issue #624; waits for #560)

- [x] T058a Analyze of this delta against `origin/main` 9aad254d (2026-10-26): drift noted in the plan, `skipped-door-full` added to FR-036/FR-037/FR-040, the `held` words widened [all]
- [x] T058 Owner answers Q1..Q8 (Paco, 2026-10-23: Q1 = A after screenshots, Q2..Q8 the recommended options), recorded in the spec and plan; FR-036..FR-045 written to them [all]
- [x] T059 `schedules.ts`: `ScheduleRun`, `runs` in the doc, `cleanRuns` on load (no `runs`, bad shapes, orphan ids, bad entries and fields, unknown fields, sort, cut to 50); `test:schedules` cases for loading and migration [FR-036, FR-038]
- [x] T060 `schedules.ts`: one `record` helper replacing every `s.last =`; folding of busy/paused/held repeats; a loop pass is one entry; `manual` for Run now; also `releaseDoorRun`, the `heldBy` hold and `skipped-door-full` (spec 017 sites found by the analyze); `session` and the `no-agent`/`send-error` reason; `test:schedules` cases (log equals `last`, cap, folding and its limits, loop pass, reasons, sessions) [FR-036, FR-037]
- [x] T061 `schedules.ts`: `remove` and `removeFolder` drop the logs, edits/pause/resume keep them; `runsOf(id)`; `publicDoc` without `runs`; fold-only ticks mark the file dirty instead of saving (flushed by the next real change, on quit via `flush()`, or within 60 min, never more than once per 60 s); tests: pass/fail a full 50×50 document serialised and written in under 25 ms of CPU (`process.cpuUsage`), an every-5-minutes schedule under Pause all for 1 h of fake clock causes at most 2 writes, a real change and `flush()` write the dirty state [FR-037, FR-038, FR-039, FR-043]
- [x] T062 IPC `schedules:runs` (frame and id checked, read-only), `schedules:list` and `schedules:changed` send `publicDoc`; preload `scheduleRuns`; `DurbarApi` types (`ScheduleRunInfo`, `held`/`ended` in `last.outcome`); `test:ipcchannels` entry [FR-043]
- [x] T063 Pure `src/renderer/schedhist.js` (`DurbarSchedHist`) with `scripts/test-schedhist.ts` (`npm run test:schedhist`, in `test:serial`): outcome words and icon kinds (all outcomes, `OUTCOME_WORD` moved here), reasons, folded text, empty text, item's parts (time, words, fold, where), `hereLabel` for 0/1/50 (the count reuses `schedulesOf`/`folderKeyOf`; no folder predicate in the module) [FR-040, FR-042]
- [x] T064 Renderer: History button and inline list on every Durbar row (dialog and Settings), newest first, words with icons, first 10 then Show all, live refresh of open lists, empty state, a11y names and order; Open chat / "chat closed"; CSS in theme tokens; four buttons inside the dialog at both sizes [FR-040, FR-041]
- [x] T065 Renderer: *Schedules here (N)* label (`hereLabel`) on the folder menu item and the Folders panel button, both still opening the folder's existing dialog `openSchedules(r)` (Q1 = A); no Settings filter, no new button; update `shots-044-everywhere` and `shots-006-remove` for the new label [FR-042]
- [x] T066 Simulator: the run log with the same rules (compared with main's on one sequence in `test:schedules`), `scheduleRuns`, `simsched=1` seed history, opt-in `simws=1` workspace room [FR-044]
- [x] T067 Driver `scripts/check-sched-history.js` (`npm run check:sched-history`, in `ui-suite.js`) at 1440x900 and 1280x800 per the plan, with its three mutation checks; screenshots `docs/screenshots/044-history-*.png`, `044-folder-here-*.png`; re-run `check:sched-edit`, `check:sched-top`, `shots-044-everywhere`, `shots-006-remove`, `check:sched-sendto`, `shots-001-lobby`, `check:ui-text` [FR-040..FR-044]
- [x] T068 Docs: README *Scheduled prompts* line (history per schedule, *Schedules here* on a folder) and *Development* (`check:sched-history`, `test:schedhist`); a `changelog.d/044-schedule-history.md` fragment; the spec 044 header (specs-index status line and **Status**); tags `[IMPLEMENTED]`/`[KNOWN GAP]` on FR-036..FR-045; `docs/agent-notes.md` entry if something was learned [all]
  - Build notes 2026-10-26 (implementer): T059..T062 `src/main/schedules.ts` (`cleanRuns`, `record`, `runsOf`, `publicDoc`, `runsReply`, `flush`), `src/main/ipc/schedules.ts`, `src/main/main.ts`, `src/preload/preload.ts`, `src/shared/api.ts`, `scripts/test-schedules-runs.ts` (part of `test:schedules`), `scripts/test-ipcchannels.ts`. T063 `src/renderer/schedhist.js`, `scripts/test-schedhist.ts`. T064/T065 `src/renderer/app.js`, `styles.css`, `index.html`, `scripts/copy-assets.js`. T066 `src/renderer/sim.ts` (`simRecord`, `scheduleRuns`, seed history, `simws=1`). T067 `scripts/check-sched-history.js`, `ui-suite.js`; `check-sched-edit`, `shots-044-everywhere` and `shots-006-remove` now expect the History button and the *Schedules here* label.
  - The 25 ms CPU pass/fail (T061) measured about 9 ms for a full 50x50 document (352 KB with long session ids); no need for the unindented form.
  - [KNOWN GAP] the macOS and Windows runs of `check:sched-history` are not run here (Linux, xvfb only); `Open chat` for runs before a restart depends on spec 006 T021 (FR-045).

## 2026-10-23 delta (owner, spec 017 doors)
- [x] T110 Held runs at a door closed by you (FR-110..FR-112; built in spec 017 T012)

## 2026-10-28 delta (owner, issue #843: 10,000 characters, never cut silently)
- [x] T120 `schedules.ts`: `MAX_PROMPT` 10,000; `cleanSchedule` no longer slices; `save` refuses an over-limit prompt that changed (FR-120, FR-123); outcome `skipped-review` (type, `OUTCOMES`, `api.ts`, `schedhist.js` word and icon) used by `tick`, `tickLoop`, `runNow` and `start` (FR-124; `releaseDoorRun` is not checked: held runs carry their own capped copy); unit tests in `test-schedules` / `test-schedules-runs`: parser keeps a 12,000-character prompt whole, nothing sent, outcome logged, edit fixes it; store size with 50 schedules at the maximum
- [x] T121 `schedtemplates.js`: `PROMPT_MAX` and the pure `promptCheck(text)` (count, counter from 80%, error text, `over`); `test-schedules` for the states and for every template under the limit
- [x] T122 Renderer `app.js`: no `maxlength`; counter and error text with `aria-describedby`/`aria-invalid`; Save disabled; templates and Edit… refresh it; the row's "Needs review" line (FR-121, FR-122, FR-124, FR-125); CSS at 10.5 px or more; simulator `save` and rows follow the same rule
- [x] T123 Driver `scripts/check-sched-edit.js`: paste 12,000 characters (error, disabled Save, whole text kept, no sideways scroll at both sizes), a 10,000 prompt row and form layout, a needs-review row with Edit…; the `044-length-*` screenshots come from this driver with `OUT=docs/screenshots` (exact pixel size) and are not in `DOC_SHOTS` (linked from no page); the one linked picture that shows the form is unchanged
- [x] T124 Docs: README *Scheduled prompts* line, `changelog.d/044-sched-prompt-length.md`, spec status tags, the maxlength audit list in the PR
- [x] T125 Review round on #843 (FR-124): a once schedule with an over-limit prompt is paused with `pausedReason: review` instead of done; an edit that fits unpauses it and needs a future time; `start()` records `skipped-review`; a loop test (no send, record, next moved one pass); tests for all
- [x] T126 Doors (FR-126): `Doors.hold` refuses a run that would take the file past `HELD_FILE_CAP`; `test:doors` cases: 200 multi-byte runs at the maximum, 5 doors of ASCII, control characters, and the file still loads
- [x] T127 Form and limit: always-present `role="status"` region announcing only state changes; one number for the limit (the simulator and the row read `PROMPT_MAX`, `test:schedhist` keeps the word equal); screenshots `044-length-*` committed (exact 1440x900 and 1280x800; linked from no page, so not in `DOC_SHOTS`)

## Changes 2026-10-31 (owner decision, spec 021 FR-067): no door

- [ ] T128 In spec 017's removal PR: `hold` and `door` paths out of the scheduler; old outcomes readable; history words. Test: `test-schedules`, `test:schedhist`; an old log with `skipped-door-full` loads; `check:sched-history` at both sizes [FR-127, FR-128]

- [ ] T140 `Schedule.mode` and the agent it was chosen for: parse and validate in main; missing or unknown = no mode; apply for one turn without saving and restore; `skipped-mode` and `mode-refused`; a stored `autopilot` is refused until the three owners confirm (spec 099 FR-084). `test:schedules`: a bad value, a missing value, another agent, a restart mid-turn, a stored `autopilot` not sent [FR-180, FR-181, FR-183, FR-184]
- [ ] T141 Form: required mode with the reused choice, modes the agent lacks not offered, row text, *Choose a mode*; the Allow all confirmation naming the schedule and agent, window only, asked again on an edit; Autopilot not offered in the first build (its confirmation is held with spec 099 T097); IPC tests (not from the app refused, no MCP or remote path). `sim:` both sizes [FR-180, FR-182, FR-184]
- [ ] T142 The first-launch popup listing schedules without a mode, an explicit choice for each, closing leaves them waiting, nothing sent. `test:` and `sim:` both sizes [FR-181]
- [ ] T143 Loops: the field per pass, no Autopilot on a loop (open for the owner). `test:schedules` [FR-180]

# Implementation Plan: Scheduled prompts

**Branch**: `044-scheduled-prompts` | **Date**: 2026-10-19 | **Spec**: [spec.md](spec.md)

## Technical Context

TypeScript main process, plain JS renderer, Electron 44. Storage: one JSON file in user data. Tests: `test:schedules` (pure scheduler with a fake clock and a fake sender; the store), simulator drivers.

## Constitution Check

- I adapters: the scheduler calls the same main-process send path as the user (`agents:send` logic), no adapter specifics. Pass.
- II/III safe by default: runs never change the permission mode or the cap; busy agents are skipped; pause-all; prompt text not logged. Pass.
- IV no credits in tests: fake clock and sender; the simulator for the UI. Pass.
- V calm UI: the UI lives in the Folders panel and a dialog; no new office chrome. Pass.
- VI parity: timers and JSON only. Pass.

## Design

1. `src/main/schedules.ts`: types, `parseSchedules`, `ScheduleStore` (load/save), `Scheduler` (pure: `nextDue(now)`, `tick(now)` with injected `isBusy(folder)` and `send(folder, prompt)`), timer wiring in main.
2. Main tracks each agent's last status from adapter events (`busy` set) for `isBusy`.
3. IPC and preload; `DurbarApi` types.
4. Renderer: Folders row button and dialog, header pause-all switch, next-run text, chat note on the `schedule` notice from main.
5. Simulator: in-memory store and runs.

## Phase 2 (2026-10-20, issue #291)

- `src/shared/schedrules.ts` (pure): `parseRule`, `nextRuleRun` (local Y/M/D h:m, so DST does not shift it), `localTime`. Unit-tested under `TZ=Europe/Zurich` (set before anything reads the time zone) for spring forward, fall back, weekday rollover, weekly with several days and times already passed today. The renderer keeps a copy (`schedtemplates.js` `nextRuleRun`) for the simulator; the test compares both on a matrix.
- `src/main/schedules.ts`: `Schedule` gains `rule`, `target`, `cap`, `spent`, `spentUnknown`, `pausedReason`; outcomes `skipped-cap` and `skipped-ended`. `cleanSchedule` migrates `every: 1440 + at` to a daily rule. `Scheduler` deps change to `isBusy(s)` and gain `hasSession(id)` and `capUnitOf(input)`; new methods `sessionsChanged()` and `noteUsage(sessionId, event)` / `turnEnded(sessionId)` for attribution. `save()` keeps main's own `spent`/`pausedReason`, resets the spend when a cap-paused schedule is resumed, and refuses Resume for an ended session.
- Main: a scheduled send registers the session for attribution; `usage` events and the turn's end go to the scheduler; `sessionsChanged()` after a session is removed.
- Adapters: `agentSchedule` normalized event (types, event guard, Copilot mapper). No change for Claude Code or Codex (nothing to map).
- Renderer: the form gets *On a calendar* (select, time, day checkboxes for weekly), *Send to* when opened from a chat, and *Limit*; rows show the target, the spend and the pause reason; a read-only list of the agent's own schedules.
- Constitution: I (normalized event, no Copilot types in the renderer), II (an ended session pauses, never redirected; caps only stop runs), III (no new logging of prompts), IV (fake clock and simulator only), V (the dialog grows by one line of form; no office layout change), VI (`Date` local time, no OS scheduler). Pass.

## 2026-10-22: edit a schedule (issue #522)

What exists (read on `origin/main` b76b79a3):
- `Scheduler.save` (`src/main/schedules.ts:333`) is already an upsert by id: `cleanSchedule` keeps a valid renderer id (`:118`), `save` replaces the entry with that id and keeps `last`, the spend in the same unit and a pause reason (`:354-366`), and the limit of 50 applies to new ones only (`:343`). It recomputes `next` (it passes `next: undefined`, `:337`) except for a paused recurring schedule, which keeps its old `next` (`:365`). It takes `paused` from the renderer, which is how Pause and Resume work (`app.js` `schedAct`, `:3979-3983`). An unknown but well-formed id is added as a new schedule.
- IPC `schedules:save` (`src/main/ipc/schedules.ts:16`) checks the frame and calls `save`; preload `saveSchedule` (`src/preload/preload.ts:81`); type `DurbarApi.saveSchedule` (`src/shared/api.ts:520`).
- Renderer: `schedRow`/`schedBtns`/`schedLine` (`src/renderer/app.js:3967-3977`) draw a row with Pause/Resume (or *Use the folder's agent*) and Delete; the prompt is `cutText(prompt, 90)` with the whole prompt in `title`. `openSchedules(r, from)` (`:4008`) builds the dialog and its add form; *Add schedule* builds the input (`:4033-4056`). Send to exists only when opened from a chat (`ag`, `:4010`). Settings > Schedules is `renderSchedSettings` (`:4084`), whose folder row button is `data-ss="open"` with the text **Open…** (`:4090`).
- Simulator: `saveSchedule` in `src/renderer/sim.ts:1119` mirrors main, but keeps `old.next` for an interval on any save (`:1136`), so an edit would not move the next run there.
- Tests: `scripts/test-schedules.ts` (fake clock); drivers `scripts/shots-044-everywhere.js` (uses `data-ss="pause"`/`"del"`, not the **Open…** text), `scripts/shots-044-templates.js`, `scripts/check-sched-sendto.js`; all three are in `scripts/ui-suite.js`.

Decision on IPC: **no new channel.** `schedules:save` gets an optional `edit: true`. In `Scheduler.save`:
1. If the input has an `id`: look it up; missing means refused ("That schedule is gone."), with or without `edit` (fixes the resurrection by a stale Pause).
2. With `edit: true`: build the candidate from main's copy (`id`, `folder`, `paused`, `done`) plus only the editable fields from the input (`prompt`, `every`, `at`, `rule`, `target`, `cap`), then run the same `cleanSchedule` and the same checks as today. A done one-time schedule may be edited (owner, Q2): the new when must be in the future (a one-time `at`) and saving clears `done`.
3. The past-time check: for an edit, refuse a one-time `at` in the past when it differs from the old `at`, paused or not; otherwise the current rule.
4. Keep `last`, `pausedReason` (when paused), and `spent`/`spentUnknown` for the same unit, as today. Do **not** keep the old `next` for an edit (skip `:365` when `edit`), so the next run follows the new when.
Why not a new `schedules:update` channel: it would add a preload method, a `DurbarApi` member, a `test:ipcchannels` entry and a second copy of the checks; the edit flag reuses one validated path. The renderer stays untrusted: with `edit`, it cannot set `paused`, `done`, `last` or the spend.

Keep the change inside `save` (and a small helper beside it). Open PR #462 adds `scheduleBusy` after `dueAt` (`schedules.ts:175-196`); do not touch those lines, so the two merge cleanly.

Renderer:
- `schedBtns` gets **Edit…** (`data-sc|ss="edit"`) for rows that are not done. In the dialog it fills the form; in Settings it calls `openSchedules(room, null, { edit: id })`.
- `openSchedules` gains an edit mode: a heading line **Edit schedule**, **Save** and **Cancel** buttons, template picker hidden, form filled from the schedule (radio, minutes, calendar kind, time and days, `datetime-local` from `at`, limit amount). Send to is shown when the schedule has a target or the dialog came from a chat; the target's option uses its live agent's name, else `target.name`. Save sends `{ id, edit: true, folder, prompt, when, target|null, cap|null }`.
- One function builds the input for Add and Save, so the client checks stay the same.
- Settings folder button: **Schedules for this folder…** with a short `title` (FR-168: at most 120 characters).
- Prompt in a row: a `button.sc-p` (cut text, `title` = `cutText(prompt, 300)`, `aria-expanded`) that toggles a `div.sc-full` (`white-space: pre-wrap`, `overflow-wrap: anywhere`, at least 12px). Rows of the agent app's own schedules get the same treatment.

Simulator: `sim.ts` `saveSchedule` follows the same edit rules (unknown id refused, main-kept fields, `next` computed again on edit).

New driver `scripts/check-sched-edit.js` (`npm run check:sched-edit`, added to `scripts/ui-suite.js`), built on `scripts/driver-helpers.js` (`helpers(ctx)`: `until`, `settle`, `load`, `calm`, `js`, `shot`; values through `jsLiteral`), no fixed sleeps, no desk sweeps (pick the desk by selector, as `check-sched-sendto.js` does). At 1440x900 and 1280x800, `DURBAR_SIM=15 DURBAR_SIM_FREEZE=1`:
1. open a folder's dialog from a chat, add *every 60 minutes*; the row shows Edit…, Pause and Delete inside the dialog box;
2. Edit…: the form shows the prompt, *Every* 60, **Save** and **Cancel**, no template picker; change the prompt and pick *Weekdays at 09:00*; Save: same number of rows, same `data-id`, the line reads "weekdays at 09:00", the next run changed;
3. Edit…, change the prompt, Cancel: the row is unchanged; Escape the same;
4. Pause, Edit…, Save: still paused;
5. a targeted schedule edited from Settings shows Send to with the session's name;
6. Settings > Schedules: the folder button reads **Schedules for this folder…**, is one line, inside the panel; Edit… there opens the dialog in edit mode on that schedule;
7. a 2,000-character prompt: the row is one line with "…", its `title` is at most 300 characters, the toggle shows the whole text, nothing in the dialog scrolls sideways, all text at least 10.5px;
8. screenshots `docs/screenshots/044-edit-{dialog,settings,long}-{1440x900,1280x800}.png`.
Then run `check:ui-text`, `shots-044-everywhere`, `shots-044-templates` and `check-sched-sendto` again (the form and the Settings row change).

Constitution: I (no adapter change), II/III (the renderer gains no power: with `edit` it cannot set pause, done, last or spend; no new logging of prompts; an unknown id is refused), IV (fake clock and simulator only, no credits), V (one more button per row, the full prompt only on request; 10.5px minimum; checked at both sizes), VI (no platform code; `datetime-local` and `time` inputs as today). Pass.

Docs in the build PR: README *Scheduled prompts* line (`README.md:68`: say a schedule can be edited, and where); CHANGELOG under *Unreleased*, or a `changelog.d/` fragment if PR #518 is merged by then (follow `origin/main`); the spec 044 row in `specs/README.md` (or the spec's index header if #518 has merged); tick the tasks and mark FR-022..FR-026 `[IMPLEMENTED]`; screenshots.

## 2026-10-22: Schedules in the top bar (issue #523)

What exists is listed in the spec delta (read on `origin/main` 045e4e94). No main-process, IPC, preload or adapter change: the button reads the `SCHED` document the renderer already has (`app.js:3955`, refreshed by `schedChanged()` at `:4147` and `bridge.onSchedules` at `:4149`).

Design:
1. **Pure module** `src/renderer/schedtop.js` (UMD like `cuttext.js`/`keys.js`; script tag right after `schedtemplates.js`, `index.html:116`, away from the tags #511 and #535 add near the end): `activeCount(doc)`, `troubleSince(doc, seenAt, now)` (last outcome `missed`/`failed`, `last.at > (seenAt ?? now - 24 h)`, done ones included), `topText(doc, seenAt, now, {keys, clockOf})` returning `{label, title, count, paused, trouble}`; the clock function is passed in, so the test does not depend on the locale. `scripts/test-schedtop.ts`, `npm run test:schedtop`, added to `test:serial`.
2. **Markup** (`index.html`): `<button class="btn sched-top" id="schedTopBtn" type="button" data-keys-text aria-keyshortcuts="Control+Shift+S" hidden>` with the clock SVG, `<span class="st-word">Schedules</span>`, `<b>` for the count and `<i class="st-mark" aria-hidden="true">` for the badge, inserted between the closing `</div>` of `.controls` and `#inboxBtn` (`index.html:67-69`). No open PR edits these lines (checked: #511, #535, #532, #500 change only script tags or nothing in `index.html`).
3. **Renderer** (`app.js`): `renderSchedTop()` beside `renderInboxBtn`; called from `schedChanged()`, after folders load or change, on demo on/off and on detail level change. It sets `hidden`, the count through `rollCount`, `aria-label`, `title`, the classes `paused` and `trouble`, and announces a grown trouble count (FR-033; the previous count kept in a variable, the first render after start never announces). Click: `openSchedulesView()` = `DurbarScreens.openSettings('schedules')` then `localStorage.setItem('durbar.schedSeen', Date.now())` and `renderSchedTop()`.
4. **Settings section** (`screens.js`): `openSettings` accepts `schedules`; `paintSettings` scrolls `#schH` into `.scr-body` with `scrollInBody` and focuses it (`tabindex="-1"`), as at `:191-192`. When Settings is already open, `open()` repaints at the section (same path).
5. **Keys** (`app.js:1517`): `mod && shiftKey && !altKey && code==='KeyS'` and no modal dialog → `openSchedulesView()`; placed with the Ctrl+Shift+A and Ctrl+Shift+N lines. `openKbdHelp` gets a row; `palActions` gets the item with `ok: () => schedTopShown()` (a function, not `palUsable`, so it is listed with a chat open, when the bar is `display:none`).
6. **CSS** (`styles.css`): `.sched-top` shares `.inbox-btn`'s height, radius and padding; `.sched-top:not([hidden])` takes `margin-left:auto` and the rule at `styles.css:1215` gives Needs you `margin-left:0` after it; `.st-word` hidden below 1920px (2040px on a Mac) except in Simple (`body.simple`, set by `setDetail`, `app.js:96`); `.sched-top.paused` dimmed with the pause glyph; `.st-mark` a 7px dot with a "!" glyph in `--tone-warn-*` tokens (theme tokens, `check:ui-text` literal-colour rules). Below 1440px, only if the measure in step 7 needs it: lower the Defaults chip's cap, then the folder filter, then the gaps. Darwin rules (`styles.css:1455-1475`): the button is `no-drag` (it matches `button` already).
7. **Measure first, then fix the numbers:** run the measuring loop (the spec's table) again with the button built, in DejaVu Sans (Noto Sans was not measured), Expert and Simple, all six themes, floors and mixed agent apps, also with `data-platform="darwin"` forced. Write the measured values into the spec (FR-034) and into `docs/design-rules.md`.

Driver `scripts/check-sched-top.js` (`npm run check:sched-top`, in `ui-suite.js`), built on `driver-helpers.js` (`helpers(ctx)`, condition waits, values through `jsLiteral`), at 1440x900 and 1280x800, Expert and Simple, `DURBAR_SIM=15 DURBAR_SIM_FREEZE=1`:
1. `simsched=1`: the button is shown, left of Needs you, one row (at most 52px), no overlap with any top-bar control, inside the window, text at least 10.5px; the count equals the active schedules; the word shows in Simple and is hidden in Expert below 1920px (and its accessible name still says "Schedules").
2. The missed seed shows the mark; the accessible name says "1 schedule missed or failed a run"; the title is at most 120 characters.
3. Click: Settings opens, `#schH` is focused and near the top of `.scr-body`, the window (`document.scrollingElement.scrollTop`) did not scroll; the mark is gone; it stays gone after a reload (the stamp).
4. Pause all (Settings checkbox): the button has the paused class and the name says "all paused"; switching it off restores it.
5. Ctrl+Shift+S from the office, from the list view and from an open chat's message box opens the same place; under a modal dialog (the shortcut sheet) it does nothing. Ctrl+K, type "sched", Enter: same.
6. The shortcut sheet lists Schedules with the keys.
7. Demo on: the button is hidden and Ctrl+K has no Schedules item.
8. Reduced motion: no roll (`--force-prefers-reduced-motion` run, as #511 does).
9. Screenshots `docs/screenshots/044-topbar-{1440x900,1280x800}.png`, `044-topbar-simple-*.png`, `044-topbar-badge-*.png`.

Existing checks that must still pass with the button: `shots-052-addleft` (add `#schedTopBtn` to its `topCheck`: it is not left of the add buttons and not first in tab order; run under `simsched=1` so the button has a count), `check:office` (its top-bar one-row checks at `check-office-overlap.js:191-204`, `:497-500`), `check:geometry`, `check:ui-text` (tooltip length, 10.5px, colours), `check:mac-titlebar`, `shots-044-everywhere`, `check-sched-edit`. Mutation: hide the room-making rule and `shots-052-addleft` must fail at 1280x800 Expert with floors.

Coordination with #511 (open, not merged; 2026-10-22):
- #511 does not touch the top bar markup or its CSS (checked on `origin/001-office-rail` 61ee65b6), so no conflict in `index.html:15-70` or the top-bar rules.
- #511's `openSchedSettings()` uses `scrollIntoView`, which spec 052 FR-055 forbids (it scrolls the whole page and hides the top bar). #511 landed first with `openSchedSettings()` calling `openSettings('schedules')`; this PR replaces the Postbox click with `openSchedulesView()`. Done: #511 landed first and its Postbox click now goes through `openSchedulesView()`.
- #511's `postMissed` now counts a done one-time schedule too, so it gives the same result as the badge. To keep it that way, `schedtop.js` exports the one predicate `missedOrFailed(s)`; #511 landed first, so this PR makes `postMissed` (`places.js`) call `DurbarSchedTop.missedOrFailed` (`schedtop.js` loads before `places.js`; in Node `places.js` requires it); `test:places` and `test:schedtop` check both.
- `simsched=1` is #511's option, reused here with a fourth (failed) schedule (FR-035).

Constitution: I (no adapter change; renderer only), II/III (no new IPC; the stamp is a time only, no prompt text, nothing logged), IV (simulator and unit tests only, no credits), V (one top-bar control, made room for by the documented width rules, one row at both sizes checked; 10.5px; state shown by a glyph and words, not colour alone; reduced motion), VI (keys through `keys.js` per platform; no platform paths; Mac menu untouched). Pass.

Docs in the build PR: README feature list (`README.md:68`, the Scheduled prompts line: the top-bar button, the badge and Ctrl+Shift+S) and *Development* (`npm run check:sched-top`, `npm run test:schedtop`, next to `check:sched-sendto` at `README.md:254`); CHANGELOG under *Unreleased* (or a `changelog.d/` fragment if #534 has merged by then; follow `origin/main`); `docs/design-rules.md:61` (the top bar's order gains Schedules before Needs you, and the measured widths); the Settings *More* text of Schedules (`screens.js:135`) names the top-bar button; spec 052 gets a one-line cross-reference under FR-105/FR-164 and FR-043 (the sheet) pointing here; the specs index row of 044 (or its header comment if #534 has merged); tick T049-T057 and mark FR-027..FR-035 `[IMPLEMENTED]`; screenshots; replace any README or site screenshot that shows the old top bar (`docs/site/gallery.json` only if a key picture changes).

- Coordination with #511 (2026-10-22, later): `openSchedulesView()` in `app.js` is the single entry that opens Settings at Schedules and sets `durbar.schedSeen`. #511's `openSchedSettings()` (the Postbox click) is gone: the click calls `openSchedulesView()`, so the badge clears the same way (FR-029, FR-030). After merging #511 the `screens.js` section code uses #511's `atSec` flag.

- Coordination with #552 (2026-10-22, review of #560): its Settings > Keyboard rejects a combo that is already taken, using a `TAKEN` list in `navigator.js` that lacks `mod+shift+KeyS`. #552 landed first and already lists `['mod+shift+KeyS','Schedules']` in `TAKEN` with a `clashOf` assertion in `test:navigator` (kept in this PR); without it Go to could be rebound onto Ctrl+Shift+S and both handlers would fire.
- Badge clearing (2026-10-22): `schedSectionShown()` (app.js) tells whether `#schH` is inside Settings' scroller; `renderSchedTop` stamps "seen" when it is and a miss exists, so a failure in front of the user raises nothing and is not announced. A capture-phase scroll listener on `.scr-body` re-runs it, and `renderSchedSettings` calls it after painting.
## 2026-10-23: run history and a folder's schedules (issue #624)

What exists is listed in the spec delta (read on `origin/main` 9a29020b, and #560 on `origin/044-topbar-schedules` ee6c000b). **Order:** build after #560 merges, on a branch from `origin/main` then; re-read #560's merged Settings > Schedules rows (`renderSchedSettings`) before adding History to them. Q1 = A (owner, 2026-10-23): no change to `openSchedulesView()`, `schedSectionShown()` or `renderSchedTop()`. Both PRs insert a dated section right under `## Changes` and append to `plan.md` and `tasks.md`: whichever lands second keeps both (2026-10-23 above 2026-10-22 #523) and counts rows per task id afterwards (`docs/agent-notes.md`, *Union-merging … can duplicate rows*).

### Drift found by the analyze (2026-10-26, `origin/main` 9aad254d; #560 is merged)

- Line numbers in this delta moved (`app.js` rows now near `:6368-6560`, `schedules.ts` sites near `:372-771`, `before-quit` at `main.ts:1112`): use the names.
- Two more outcomes and two more sites set `last` than listed: `skipped-door-full` (spec 017) and `held` from `heldBy`/`hold`, and `releaseDoorRun` (Send all at an opened door) sets `last` at a send. All go through `record`. `skipped-door-full` folds like `held` (same reasoning, FR-037); `releaseDoorRun` gives `sent`/`failed` with a `session`.
- `OUTCOME_WORD` (`app.js:6368`) already has words for `held` and `skipped-door-full`; they move into `schedhist.js`, and `ended` is added.
- `ScheduleInfo.last.outcome` (`api.ts`) lacks only `ended` now.
- `tick()` ends in an unconditional `commit()`: the fold-only path (FR-037) is a flag set by `record` and cleared by any real change in that tick (a new entry, a one-time schedule going done, a pause set by a skip of cap or ended).
- **Implementer decisions, 2026-10-26, awaiting owner confirmation** (small wording choices made while building #624; each can be reverted in `schedhist.js`):
  1. The `held` words. Old: "held: the door is closed (Do not disturb)" (spec 044 FR-110, only the door's case). New: "held: not sent yet (closed door, update or break)". Why: `held` is also written for an agent app that is updating (spec 081) and for a loop that waits for a person or a break (spec 072), where "the door is closed" would be untrue; the row and the history share this one table.
  2. The empty-history text. Old (FR-040): "Runs are kept from <the day of this update> on". New: "Runs are kept from the update that added this list on; the last one before that: <words>, <time>." Why: no date of the update is stored, and inventing one would be untrue.
  3. "Not sent: the session has ended" (the row's existing word) is the one wording in FR-040 and `schedhist.js`; FR-040 said "had ended".
  4. An item's accessible text is its visible parts in DOM order (time, words, fold count, where it went); no separate sentence label is built.
- #560's pieces exist as planned: `DurbarSchedTop` (`schedtop.js`), `openSchedulesView`, `check-sched-top`, `shots-044-everywhere`.

### Main

1. `src/main/schedules.ts`:
   - Types: `RunReason = 'no-agent' | 'send-error' | LoopEndReason`; `ScheduleRun { at; outcome: Outcome; session?; reason?; manual?: true; n?; until? }`; `SchedulesDoc` gains `runs?: Record<string, ScheduleRun[]>`; `MAX_RUNS = 50`.
   - `cleanRuns(v, ids)` (pure, exported for the test): FR-038's rules; called by `parseSchedules` (`:274`) after the schedules are read, with their ids.
   - `private record(s, outcome, now, extra?)`: sets `s.last` and appends to `doc.runs[s.id]`, folding per FR-037, cutting to `MAX_RUNS`. Replace every `s.last = …` (`:361`, `:364`, `:448`, `:540`, `:544`, `:548`, `:574`, `:668`, `:703`) with it. The loop's end of pass (`:523`) and the failed send (`:580`) call `record` with "update the newest entry when it is this pass's `sent`", so a pass stays one entry. `save` (`:779`) keeps copying `last` and does not record.
   - The send result: `tick` and `runNow` keep `.catch(() => false)` but tell the two cases apart for `reason`: `send` returning `false` → `no-agent`; a throw → `send-error`. No error text is kept.
   - `session`: `typeof r === 'string' ? r : s.target?.session`.
   - `remove(id)` and `removeFolder(folder)` delete `doc.runs[id]` for every schedule they drop (same commit).
   - `runsOf(id): ScheduleRun[]` returns a copy, newest first.
   - `publicDoc(doc)`: `{ pausedAll, schedules }` without `runs`, for the window. `saveSchedules` (`:854`) writes the whole doc (with `runs`) as today.
   - Write schedule (FR-037): `record` reports whether it only folded. `commit()` takes a `foldOnly` flag: then it calls `deps.changed` and sets `dirty` instead of `deps.save`, and arms one flush timer (`deps.setTimer`, at most 60 min, and never sooner than 60 s after the last write). Any other `commit()` saves at once and clears `dirty` and the timer. New `flush()` saves when dirty; `main.ts` calls it in its one `before-quit` handler (`main.ts:949-957`; no second handler, see its comment). Tests use the fake clock and a counting `save`.
2. `src/main/main.ts:517`: `changed: (doc) => toRenderer('schedules:changed', publicDoc(doc))`.
3. `src/main/ipc/schedules.ts`: `schedules:list` returns `publicDoc(...)`; new `ipcHandle('schedules:runs', (e, id) => !fromApp(e) || typeof id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(id) ? { ok: false } : { ok: true, runs: scheduler()?.runsOf(id) ?? [] })`. The pattern is `cleanSchedule`'s (`schedules.ts:198`, 8 to 64 characters) widened to 1 to 64, so the simulator's short `sched-N` ids pass too.
4. `src/preload/preload.ts`: `scheduleRuns: (id) => ipcRenderer.invoke('schedules:runs', id)`. `src/shared/api.ts`: `ScheduleRunInfo`; `ScheduleInfo.last.outcome` gains `held` and `ended` (they already reach the window); `scheduleRuns?(id: string): Promise<{ ok: true; runs: ScheduleRunInfo[] } | { ok: false }>`.
5. Why one new channel and not `runs` inside the pushed document: up to 2,500 entries would go to the window on every tick of any schedule, and Settings, the dialog, the room chips and the top-bar button repaint on every push (`schedChanged`, `app.js:5226`). The log is wanted only while a History list is open. Why not a separate file: one write keeps the log and `last` consistent, and deleting a schedule deletes its log atomically.

Size: an entry is about 90 bytes as `saveSchedules` writes it (indent 2); 2,500 entries are about 225 KB. Pass/fail in `test:schedules` (FR-037): `JSON.stringify` + `writeFileSync` of a full 50×50 document to a temp file under 25 ms of CPU (`process.cpuUsage` delta, user + system; median of 5 runs after one warm-up), and an every-5-minutes schedule under *Pause all* over 1 h of fake clock gives at most 2 `save` calls. If the CPU limit fails, write `runs` without indentation and measure again; record the measured value in the spec.

### Renderer

1. Pure `src/renderer/schedhist.js` (`DurbarSchedHist`, UMD like `schedtop.js`; one window global per script, `docs/agent-notes.md`): `OUTCOMES` (words, icon kind) including `held` and `ended`, `reasonWords(code)`, `runText(run, clockOf, nameOf)` (the visible line and the item's parts (time, words, fold, where)), `emptyText(last, clockOf, since)`, `hereLabel(n)`. No folder predicate: the *Schedules here (N)* count reuses `schedulesOf(r)`/`folderKeyOf(r)` (`app.js:5035-5036`), one implementation; the workspace case is checked by the driver (`simws=1`, step 6). Script tag right after `schedtop.js` in `index.html`. The row's `OUTCOME_WORD` (`app.js:5040`) moves into it so the row and the history use one table (add `held`, `ended`).
2. `app.js`:
   - `schedBtns` (`:5055`): **History** (`data-sc|ss="hist"`, `aria-expanded`, `aria-controls="sh-<id>"`) after Delete; `schedRow` (`:5067`) renders an empty `<ol class="sc-hist" id="sh-<id>" hidden>` that the toggle fills from `bridge.scheduleRuns(id)`. Open state in a `Set` like `SCHED_OPEN` (`:5059`), so a repaint keeps it open; `schedChanged` re-asks the open ones only.
   - Items: `<li>` with an SVG icon (`currentColor`, `aria-hidden`), the time, the words, and **Open chat** (`data-open-chat="<id>"`) when `liveById(session)`, else "chat closed". The click closes `closeSchedDlg()` or Settings (#560's Settings close path; check it returns focus as today) then `openPanel(id)`.
   - First 10, then **Show all (N)**.
   - Folder entry (Q1 = A): `openFolderMenu` (`:4340`) and `renderFolders` (`:5298`) take their labels from `hereLabel(n)` and keep calling `openSchedules(r)`; the room chip (`:2209`) and the chat's More > Schedules (`:1860`) are unchanged. No filter state, no new Settings controls.
   - Renderer comments say "PR 560", never the hash form (the theme-tokens ratchet counts it as a colour, `docs/agent-notes.md`).
3. `styles.css`: `.sc-hist` (list, `font-size` at least 12px, `overflow-wrap:anywhere`, no horizontal overflow), the icon size, the muted "chat closed". Theme tokens only (`check:ui-text`). Check that four row buttons stay inside the M dialog at both sizes; if not, the row's buttons wrap under the text as a group (the `minmax(0,1fr)` column of FR-025 *Resolved* stays).

### Simulator

`src/renderer/sim.ts`: `simSched.runs` with the same `record` rules (a small copy; `test:schedules` runs one sequence through both and compares the logs), `scheduleRuns`, deletion with the schedule; the `simsched=1` seed history (FR-044); `simws=1` adds one workspace room and its schedule, read from `qs` in `app.js:2802` like the other `sim*` options.

### Driver

`scripts/check-sched-history.js` (`npm run check:sched-history`, in `ui-suite.js`; `driver-helpers.js`: `until` asserted with `assert.ok`, values through `jsLiteral`, no fixed sleeps, desks picked by selector), `DURBAR_SIM=15 DURBAR_SIM_FREEZE=1`, `simsched=1&simws=1`, at 1440x900 and 1280x800:
1. Settings > Schedules (through the top-bar button): every Durbar row has History; Edit…, Pause, Delete and History are inside the panel and the dialog; History toggles `aria-expanded` and the list.
2. The seeded schedule's list: newest first (times descending), every item has words (no item is an icon alone), the folded busy skip says "N times", the failed run shows its reason's words, *Show all* appears past 10.
3. Open chat on a run to a live agent opens that chat (the panel is open with that agent selected; Settings closed); the run to a gone id shows "chat closed" and no button.
4. A schedule with no runs shows the empty text.
5. A run while the list is open (the page clock moved, as `check-sched-edit` does) appears at the top without reopening.
6. Folder menu (right-click a room header, the ⋯, and the List view's Folder cell): *Schedules here (2)*; it opens that folder's *Schedules for <folder>* dialog listing exactly that folder's schedules (`data-id`s equal to the seed's for that key), each with History. A folder with none: *Schedules here* (per Q4) and the dialog's empty text above the add form. The Folders panel button: the same label and dialog. The workspace room (`simws=1`): its menu counts its schedule and its dialog lists it; a member folder's room (if shown) does not.
7. Settings > Schedules has no folder filter (unchanged apart from History on rows), and opening the folder's dialog leaves the top-bar badge as it was (FR-029).
8. All text at least 10.5px; no sideways scroll in the dialog or Settings; Tab order History → Open chat; screenshots `docs/screenshots/044-history-{1440x900,1280x800}.png`, `044-folder-here-{1440x900,1280x800}.png` (the menu item and its dialog).
Mutation checks: render the outcome icon without its words (step 2 fails); drop `remove`'s log deletion (`test:schedules` fails); push `runs` in `schedules:changed` (`test:schedules` fails).

Existing checks to run again: `check:sched-edit` (four buttons per row), `check:sched-top` (History on Settings rows does not move the section or the badge), `shots-044-everywhere` and `shots-006-remove` (the menu label changes from *Schedules* to *Schedules here*), `check:sched-sendto`, `shots-001-lobby` (the Postbox reads `last`), `check:ui-text`, `test:ipcchannels`.

### Constitution check

- I Spec Kit: this delta, plan and tasks first; the build waits for #560. Pass.
- II Adapters: no adapter change; the log records normalized outcomes and an agent id, no vendor data. Pass.
- III Safe, no secrets: no prompt text copied, no error text or paths stored (reason codes only), strict parsing with caps, the new channel is read-only and checks its frame and argument, the file stays 0600, nothing logged. Pass.
- IV No credits: fake clock, simulator, unit tests. Pass.
- V Calm UI: history on request, words with icons, 10.5px minimum, both sizes checked, the list never scrolls sideways. Pass.
- VI Parity: no platform code; JSON and timers as today. Pass.
- VIII Honest limits: FR-045. Pass.

### Owner answers (Paco, 2026-10-23)

All eight answered on 2026-10-23: Q1 after screenshots of both options, Q2..Q8 by accepting the recommended option. Kept here with the options and the reasons.

1. **What does *Schedules here (N)* open?** (A) the folder's existing *Schedules for <folder>* dialog; (B) Settings > Schedules filtered to that folder. **Answered (Paco, 2026-10-23, after screenshots of both): A.** The entry point is relabelled only, History is added to the dialog's rows (and to Settings rows), no Settings filter, no `openSchedulesView({ folder })`, no *New schedule here* (the dialog has the add form).
2. **How many runs per schedule?** (A) 20, (B) 50, (C) 100. **Answered: B (50) (owner, 2026-10-23).** Why: two weeks of a daily schedule, about 4 hours of a 5-minute interval, and a file of about 225 KB at the limit of 50 schedules; 100 doubles that.
3. **Are skipped runs logged?** (A) every run, each its own entry; (B) every run, with repeated busy/paused/held skips folded into one entry with a count and an end time; (C) only sent, missed and failed. **Answered: B (owner, 2026-10-23).** Why: nothing is hidden, and a night under *Pause all* does not push the real runs out.
4. **The folder item when the folder has no schedules:** (A) shown as *Schedules here* without a number, opening the folder's dialog with its empty text and the add form; (B) shown but disabled; (C) hidden. **Answered: A (owner, 2026-10-23).** Why: finding the feature is the point (same reasoning as #560's button shown at zero).
5. **History of deleted schedules:** (A) deleted with the schedule; (B) kept for 7 days under "Deleted schedules" in Settings. **Answered: A (owner, 2026-10-23).** Why: simpler, no prompt kept after the user deleted it; B needs the prompt text kept after delete.
6. **The reason of a failed run:** (A) a code from a closed list shown as fixed words ("no agent in this folder", "the agent app refused it"); (B) the error's own text, masked with `redact` and cut to 120 characters. **Answered: A (owner, 2026-10-23).** Why: nothing untrusted is stored; B can carry paths or account names that masking does not catch.
7. **Where History shows:** (A) inline under the row, opened by a History button (like the prompt toggle); (B) its own dialog. **Answered: A (owner, 2026-10-23).** Why: works the same in the folder's dialog and in Settings, no dialog over a dialog.
8. **Open chat when the chat is gone:** (A) "chat closed", no button; (B) a link to Previous sessions at that session. **Answered: A (owner, 2026-10-23).** Why: B needs a way to open Previous sessions at one id and depends on spec 006 T021 (unverified whether ids survive a restart).

## 2026-10-28: prompt limit 10,000 and never cut silently (issue #843)

- One constant in main (`MAX_PROMPT`), one copy in the window (`DurbarSchedTemplates.PROMPT_MAX`, compared in `test:schedules`, like the calendar rules), one pure helper `promptCheck(text)` for the counter and error words, used by the form (and by the simulator's rows). No new dialog: the Edit form in the schedule dialog is the only form (Settings' Edit… opens it).
- Main: `cleanSchedule` stops slicing; `save` refuses a changed over-limit prompt; a stored over-limit prompt is kept and skipped with the new outcome `skipped-review`, in the same `record` path as the other `skipped-*` outcomes (not paused, not done, not folded). `schedhist.js` words it; the row's state line shows "Needs review" from the prompt itself.
- Renderer: textarea without `maxlength`; a `<p>` live region (`role="status"`) under it with the counter or the error, linked by `aria-describedby`; `aria-invalid`; the Save button `disabled` while over. Text is at least 10.5 px.
- Check: unit tests (parser, `save`, runs, `promptCheck`, templates), `check:sched-edit` extended (12,000-character paste, 10,000-character row and form at both sizes, needs-review row), screenshots retaken with `shots:docs`.


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
6. **CSS** (`styles.css`): `.sched-top` shares `.inbox-btn`'s height, radius and padding; `.sched-top:not([hidden])` takes `margin-left:auto` and the rule at `styles.css:1215` gives Needs you `margin-left:0` after it; `.st-word` hidden below 1600px except in Simple (`body.simple`, set by `setDetail`, `app.js:96`); `.sched-top.paused` dimmed with the pause glyph; `.st-mark` a 7px dot with a "!" glyph in `--tone-warn-*` tokens (theme tokens, `check:ui-text` literal-colour rules). Below 1440px, only if the measure in step 7 needs it: lower the Defaults chip's cap, then the folder filter, then the gaps. Darwin rules (`styles.css:1455-1475`): the button is `no-drag` (it matches `button` already).
7. **Measure first, then fix the numbers:** run the measuring loop (the spec's table) again with the button built, in DejaVu Sans and Noto Sans (as FR-164 did), Expert and Simple, all six themes, floors and mixed agent apps, also with `data-platform="darwin"` forced. Write the measured values into the spec (FR-034) and into `docs/design-rules.md`.

Driver `scripts/check-sched-top.js` (`npm run check:sched-top`, in `ui-suite.js`), built on `driver-helpers.js` (`helpers(ctx)`, condition waits, values through `jsLiteral`), at 1440x900 and 1280x800, Expert and Simple, `DURBAR_SIM=15 DURBAR_SIM_FREEZE=1`:
1. `simsched=1`: the button is shown, left of Needs you, one row (at most 52px), no overlap with any top-bar control, inside the window, text at least 10.5px; the count equals the active schedules; the word shows in Simple and is hidden in Expert below 1600px (and its accessible name still says "Schedules").
2. The missed seed shows the mark; the accessible name says "1 run missed or failed"; the title is at most 120 characters.
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
- #511's `openSchedSettings()` uses `scrollIntoView`, which spec 052 FR-055 forbids (it scrolls the whole page and hides the top bar). Whichever PR lands second points the Postbox at `openSettings('schedules')`. Say so on #511 (the coordinator posts; not done here).
- #511's `postMissed` counts only schedules that are not done, so a missed one-time schedule (done at start) never flags the Postbox. The top-bar badge counts it (FR-029). Raise it on #511 as a finding; not changed here.
- `simsched=1` is #511's option; reuse it if #511 lands first, otherwise add the same option and data (FR-035) and let #511 drop its copy when it rebases.

Constitution: I (no adapter change; renderer only), II/III (no new IPC; the stamp is a time only, no prompt text, nothing logged), IV (simulator and unit tests only, no credits), V (one top-bar control, made room for by the documented width rules, one row at both sizes checked; 10.5px; state shown by a glyph and words, not colour alone; reduced motion), VI (keys through `keys.js` per platform; no platform paths; Mac menu untouched). Pass.

Docs in the build PR: README feature list (`README.md:68`, the Scheduled prompts line: the top-bar button, the badge and Ctrl+Shift+S) and *Development* (`npm run check:sched-top`, `npm run test:schedtop`, next to `check:sched-sendto` at `README.md:254`); CHANGELOG under *Unreleased* (or a `changelog.d/` fragment if #534 has merged by then; follow `origin/main`); `docs/design-rules.md:61` (the top bar's order gains Schedules before Needs you, and the measured widths); the Settings *More* text of Schedules (`screens.js:135`) names the top-bar button; spec 052 gets a one-line cross-reference under FR-105/FR-164 and FR-043 (the sheet) pointing here; the specs index row of 044 (or its header comment if #534 has merged); tick T049-T057 and mark FR-027..FR-035 `[IMPLEMENTED]`; screenshots; replace any README or site screenshot that shows the old top bar (`docs/site/gallery.json` only if a key picture changes).

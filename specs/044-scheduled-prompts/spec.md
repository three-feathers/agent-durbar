# Feature Specification: Scheduled prompts (while the app is open)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 042
title: Scheduled prompts while the app is open (issue #125)
status: Phase 1 built: per-folder schedules, once or every N minutes, busy and missed runs skipped, pause all (unit tests, simulator, real check 2026-10-19). Phase 2 built 2026-10-20 (#291): calendar rules without DST drift, per-session schedules (pause when the session ends), a per-schedule limit, Copilot's own schedules read-only (unit tests, simulator; no real check; not available from Claude Code or Codex) Delta 2026-10-20 (#371): the Send to and Limit labels stay on one line and the "This session" option is capped at 40 characters (simulator check `check:sched-sendto`; not seen on a Mac). Delta 2026-10-22 (#522): **Edit…** on every schedule row (dialog and Settings), Save/Cancel, the Settings button reads *Schedules for this folder…*, the whole prompt can be read; a long prompt no longer pushes Pause and Delete out of the dialog (unit tests; simulator check `check:sched-edit`; not seen on a Mac).. Delta 2026-10-22 (#523): Schedules button in the top bar (unit tests, simulator; not on a real Mac or Windows)
-->

**Feature Branch**: `044-scheduled-prompts`
**Created**: 2026-10-19
**Status**: Phase 1 built (unit tests with a fake clock, simulator, one real check 2026-10-19); Phase 2 built 2026-10-20 (unit tests and the simulator; no real check yet), see *Changes*; delta 2026-10-22 (#523): Schedules button in the top bar (unit tests, simulator; not on a real Mac or Windows)
**Input**: Issue #125 (owner's idea, 2026-10-17, with research notes on SDK 1.0.22 / runtime 1.0.98): schedule a prompt on a session, once or at an interval, only while the app is open; no OS scheduler, nothing changed on the user's system.

## Decisions taken from the issue (Phase 1)

- A schedule belongs to a **folder** and sends to that folder's first main agent (the one on its room's first desk). This works whether or not session ids survive a restart (spec 006 T021, open question to the owner), and it is what "every morning, summarize open PRs" means for a folder.
- **Once** (a date and time) or **every N minutes** (5 to 1440). No calendar rules in Phase 1.
- Copilot's own per-session scheduler (`every`/`after`) is not used (research: one session only, needs a live session, no skip-when-missed, no pause-all, no per-run cap).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Schedule a prompt on a folder (Priority: P1)

In **Folders**, each folder has **Schedules**. The dialog lists the folder's schedules (prompt, when, next run, last run and how it went) and adds one: the prompt (up to 2,000 characters) and either *once at* a date and time or *every* N minutes. Each schedule can be paused, resumed or deleted.

**Acceptance Scenarios**:
1. **Given** a schedule every 30 minutes, **When** it is due and the agent is idle, **Then** the prompt is sent to the folder's agent as if the user had sent it, and the chat shows a calm note "Scheduled prompt (every 30 min)". *(test:, sim:)*
2. **Given** a once-schedule, **When** it has run, **Then** it is marked done and does not run again. *(test:)*

### User Story 2 - Never pile up, never surprise (Priority: P1)

**Acceptance Scenarios**:
1. **Given** the agent is working or waiting for an approval or an answer when a run is due, **Then** that run is skipped (not queued) and recorded as "skipped: the agent was busy". *(test:)*
2. **Given** the app was closed or the computer asleep at the due time, **When** the app runs again, **Then** a missed once-schedule is marked "missed" and is not sent; an interval schedule continues from now (the missed runs are not caught up). *(test:)*
3. **Given** **Pause all schedules** (in the Folders panel), **Then** nothing is sent until it is switched off; the choice is kept across restarts. *(test:, sim:)*
4. Runs use the session's own permission mode and credit cap: a schedule never allows more than the agent already may. *(read: the send path is the user's)*

### Edge Cases

- The folder is removed: its schedules are removed with it.
- The folder is hidden or its floor is off: schedules still run (the agents keep running there, spec 033); the Floors and Folders panels show that a folder has active schedules.
- The prompt text is kept in the app's user-data folder (needed to send it) and never written to logs.

## Requirements *(mandatory)*

- **FR-001** Store: `durbar-schedules.json` in the user-data folder: `pausedAll` and up to 50 schedules (`id`, `folder`, `prompt` ≤ 2,000 characters, `every` minutes 5-1440 or `at` epoch ms, `paused`, `done`, `last` {`at`, `outcome`: `sent` | `skipped-busy` | `missed` | `failed`}). Tolerant parsing: a bad entry is dropped.
- **FR-002** Scheduler (main process, pure core with an injected clock and sender, unit-tested): computes the next due time; at most one timer; on a due run it checks the folder's agent state (busy = working, thinking, needs-permission, or a question or limit waiting) and either sends or records the skip; missed once-runs at start are marked `missed`; intervals continue from now.
- **FR-003** IPC `schedules:list`, `schedules:save` (validated), `schedules:remove`, `schedules:setPausedAll`; the renderer shows the result.
- **FR-004** UI: **Schedules** per folder in the Folders panel (dialog with list and form), **Pause all schedules** in the panel header, a small clock and the next run in the folder row, and a note in the chat when a scheduled prompt is sent.
- **FR-005** Simulator: the same dialog and runs against simulated agents, no credits.

## Success Criteria *(mandatory)*

- **SC-001**: A user can add an every-30-minutes schedule in under a minute, and can stop all schedules with one switch.
- **SC-002**: No schedule ever sends while the agent is busy, and no run is sent twice.

## Assumptions and dependencies

- Phase 2 (issue #291, built 2026-10-20, see *Changes*): a schedule per session, calendar rules, a per-schedule credit or cost cap, the agent's own schedules (shown read-only).

## Changes

### 2026-10-22: Schedules in the top bar (issue #523)

*Owner idea (Paco, 2026-10-22):* scheduled prompts are hard to find. Today they are reached from Settings > Schedules (FR-011), a room's ⋯ menu and its clock chip (FR-009, FR-010; the chip shows only once the room has a schedule), and the Schedules item in a main agent's More menu (`#schedHdrBtn`). None of these is visible from the top bar, from the list view or from an empty office. The issue proposes a top-bar **Schedules** button (a clock and the count of active schedules) that opens the all-folders view, an optional badge for a missed or failed run, a keyboard shortcut and a Ctrl+K entry.

*Status:* built 2026-10-22 (simulator and unit tests; `[KNOWN GAP]` not tried on a real Mac or Windows).

*Related:* open PR #511 (spec 001 FR-038, Vikram) adds a **Postbox** tile in the lobby: the next 3 runs, the runs still due today, a flag when a schedule's last run was missed or failed, and a click that opens Settings > Schedules. The two complement each other: the Postbox shows *what is next* inside the office view; the button is a one-click way in from any view (office, list, a chat through the shortcut or Ctrl+K), also when the lobby is not on screen. Both open Schedules through the same entry (FR-030), so there is one way in, not two.

*What exists (read on `origin/main` 045e4e94):* the top bar markup `src/renderer/index.html:15-70` (brand; `.controls` with `#liveBar`, `.folder-ctl`, `#topBtns` Tools/Settings, Office/List, `.top-more` ⋯; then `#inboxBtn` and `#stats` on the right); the inbox button's pattern of an icon, a word and a rolling count (`renderInboxBtn`, `app.js:1654-1661`; word hidden below 1600px, `styles.css:489-491`); the fit rules `styles.css:476-503` and `fitTopbar` (`app.js:972-983`, class `tb-tight` moves the brand name to screen readers when the row would wrap); the schedule state `SCHED`, `clock`, `nextRunOf` and `schedChanged()` (`app.js:3955-3960`, `:4147`); Settings > Schedules `#schedSet` (`screens.js:133-136`), shown when `bridge.listSchedules` exists and the demo is off (`app.js:4625`, `sched.on`); `DurbarScreens.openSettings(section)`, which scrolls to and focuses a heading only for `mcp` and `harnesses` (`screens.js:960`, `:191-192`, with `scrollInBody`, spec 052 FR-055); the palette's actions (`palActions`, `app.js:1770-1792`); the global keys (`app.js:1517-1562`) and the shortcut sheet (`openKbdHelp`, `app.js:1869-1880`); the polite live region `announce()` (`app.js:1680`).

*Measured (simulator, `DURBAR_SIM=15 DURBAR_SIM_FREEZE=1`, Electron under xvfb, this machine's default fonts, not forced to DejaVu Sans; 2026-10-22 on 045e4e94, a throwaway measuring script, not committed):* free width left in the one-row top bar (between the last control and Needs you):

| Window | Level | Case | Free | Brand name |
|---|---|---|---|---|
| 1440x900 | Expert | plain | 129px | shown |
| 1440x900 | Expert | floors + mixed agent apps | 64px | shown |
| 1440x900 | Expert | floors + mixed, Durbar · Indian | 57px | shown |
| 1440x900 | Expert | floors + mixed, Mac room forced | 6px | shown |
| 1280x800 | Expert | plain | 31px | shown |
| 1280x800 | Expert | floors + mixed | 27px | already hidden (`tb-tight`) |
| 1280x800 | Expert | floors + mixed, Mac room forced | wraps already (79px tall) | hidden |
| 1280x800 | Simple | floors + mixed, Durbar · Indian | 145px | shown |

A trial 54px button (inserted by script, not built) kept one row everywhere at 1440 (with floors it switched on `tb-tight`), and wrapped the bar at 1280x800 Expert with floors and mixed agent apps. So the button **needs room made for it** at 1280 in Expert, as `docs/design-rules.md` asks of any new top-bar control ("make room with the width rules in `styles.css` ... and re-measure").

- **FR-027** `[IMPLEMENTED]` **A Schedules button in the top bar.**
  - **Where:** on the right, directly left of **Needs you** (`#inboxBtn`), with the other glanceable counts; it takes the `margin-left:auto` that Needs you (or the counters) has today, so the left cluster does not move. Tab order: after ⋯ and before Needs you. Id `schedTopBtn`.
  - **Look:** a calm ghost button like Needs you when nobody needs you: the bar's control height (32px), a clock icon (`currentColor`, 14px, the same clock as the room chip), the word **Schedules** and the count (FR-028), 12.5px text, never under 10.5px.
  - **Two forms, the rule of Needs you:** the word shows from 1920px wide (2040px on a Mac, like the counters' words; amended 2026-10-22 after widths 1441-1919 were measured), and in Simple at any width (Simple has room: 145px or more free at 1280x800); below that in Expert it is the clock and the count only (about 40px), the word moving to its accessible name and title.
  - **When shown:** when schedules are available (`bridge.listSchedules` and not the demo, the same test as Settings > Schedules) and there is at least one folder or one schedule. Shown with zero schedules: finding the feature is the point of the button. Hidden otherwise (empty office, demo), like Needs you with no agents.
  - In the Office and List views alike. With a chat open the top bar is hidden (`body.panel-open`); the shortcut (FR-031) and Ctrl+K (FR-032) still work there.
  - Themes only recolour it (Constitution V; `check:geometry`).
- **FR-028** `[IMPLEMENTED]` **The count means active schedules.**
  - The number is Durbar's schedules that are not done and not paused (`!done && !paused`), over every folder, including hidden folders and floors that are off (they still run, spec 033). The agent app's own schedules (FR-016) are not counted: they are read-only and known only to the open window.
  - No number when there are none (the clock and, where shown, the word only). At most two digits: the store keeps at most 50 (FR-001).
  - **Pause all** on: the button is dimmed like the room chip (FR-010), the clock gets a small pause mark (not colour alone), and the number stays (what would run).
  - The count rolls like Needs you's (`rollCount`, spec 052 FR-068; not under reduced motion).
  - The title says it in words, at most 120 characters (spec 052 FR-168): "Schedules: 3 active, next 08:30 (Ctrl+Shift+S)"; "Schedules: all paused (3 set) (Ctrl+Shift+S)"; "Schedules: none yet. Add one to a folder (Ctrl+Shift+S)". The next run uses the room chip's clock text (`clock`, `nextRunOf`).
- **FR-029** `[IMPLEMENTED]` **A badge for a run that did not happen, until you look.**
  - A small mark on the clock (a dot with a "!" glyph, warning tone, never colour alone) when at least one schedule's **last run** is `missed` or `failed` and that run is **newer than the last time Schedules was opened** through FR-030. Done one-time schedules count too: a missed one-time schedule is marked done at start (FR-002), and it is exactly the one the user would not see otherwise.
  - Busy skips (`skipped-busy`), *Pause all* skips (`skipped-paused`), a reached limit (`skipped-cap`: the schedule pauses and its row says so) and an ended session (`skipped-ended`) do not mark it: they are expected, or already shown on the row.
  - The mark clears when Schedules is opened through FR-030 (the button, the shortcut, Ctrl+K, and the Postbox once #511 uses it). It also clears by itself when that schedule's next run is sent (its `last` changes).
  - "Last opened" is one time stamp in the window's `localStorage` (`durbar.schedSeen`, epoch ms; no prompt text, nothing sent to main, per computer). With no stamp yet (first start after the update) only runs of the last 24 hours count, so an old miss does not greet the user.
  - The number is the number of **schedules** whose last run was missed or failed (each schedule keeps only its last run, so a schedule that failed three times counts once), and the words say so in the accessible name and the title: "1 schedule missed or failed a run", "2 schedules missed or failed a run".
  - **When it clears (decision 2026-10-22, Paco's agent):** `openSchedulesView()` (the button, the shortcut, Ctrl+K) clears it at once. Opening Settings by its own button or ⌘, does **not** clear it merely because Settings opened: it clears when the Schedules heading is actually inside Settings' scroller (the user scrolls or tabs to it, or the window is tall enough to show it). **A miss or failure that happens while the Schedules heading is on screen is marked seen at once**: no badge, no announcement. Otherwise it raises the badge and announces once. "On screen" needs the window to be visible and focused (`document.visibilityState === 'visible'` and `document.hasFocus()`; `DurbarSchedTop.windowSees`): a failure while the window is hidden or in the background raises the badge and announces as usual, and when the window comes back (focus or visibilitychange) with the heading in view the badge clears then (decision 2026-10-22, Paco's agent, on Vikram's review of #560).
  - **One rule with the lobby Postbox:** `DurbarSchedTop.missedOrFailed(s)` (missed or failed, a done one-time schedule included, a done recurring one not, `skipped-*` never) is the single predicate; the Postbox of #511 should call it instead of its own `postMissed` test.
- **FR-030** `[IMPLEMENTED]` **It opens Settings > Schedules, at the Schedules section.**
  - No new view. The button opens Settings with the Schedules section (FR-011) at the top of Settings' own scroller and its heading focused, through a new section name `DurbarScreens.openSettings('schedules')`, done like `mcp` and `harnesses` (`scrollInBody`, never `scrollIntoView`, spec 052 FR-055). If Settings is already open it scrolls there again. The heading `#schH` gets `tabindex="-1"`.
  - This is the one entry for "go to Schedules": the button, the shortcut, the Ctrl+K item, and the Postbox of #511 (whichever of the two PRs lands second points its click at it). Opening it sets the FR-029 stamp.
  - Closing Settings (Esc, its Close button) works as today; the Settings button shows pressed while it is open, as today. Where focus goes after closing is not specified for Settings today and is not changed here.
  - *Why not a dedicated view:* Settings > Schedules already lists every folder's schedules with Edit…, Pause/Resume, Delete, Pause all and *Add a schedule to* (FR-011, FR-022). A second view would duplicate it and would have to follow every change.
- **FR-031** `[IMPLEMENTED]` **Keyboard shortcut: Ctrl+Shift+S (⇧⌘S on a Mac).**
  - It opens Schedules (FR-030) from anywhere, also from a text field and from an open chat (like Ctrl+Shift+A, spec 052 FR-035), but not under a modal dialog (like Ctrl+O, spec 052 FR-164). The page handles it on every platform; it is not a Mac menu item.
  - Why this key: free in the app on 2026-10-22 and in the open PRs then except that #552 (074-keyboard-navigator, Go to = Ctrl+J) keeps a list of taken combos (`TAKEN` in `navigator.js`) that did not yet have `mod+shift+KeyS`; whichever of #560 and #552 lands second must add it (see the plan) (the app uses Ctrl+K, Ctrl+O, Ctrl+Shift+O, Ctrl+Shift+A, Ctrl+Shift+N, Ctrl+`, ⌘, and the single letters I, N and ? outside fields; open PR #497 and the PRs stacked on it add Ctrl+Shift+H). The Mac menu's roles (Edit, View, Window) do not use ⇧⌘S (`read:` `src/main/appmenu.ts`; not checked on a real Mac). Not a single letter: S already means *Allow for this session* inside the inbox and, with Alt (⌥⌘ on a Mac), in a chat.
  - The button has `aria-keyshortcuts="Control+Shift+S"` (rewritten for a Mac by the existing code) and its title names the key. The shortcut sheet (`openKbdHelp`) gets a row **Schedules** after the Needs you rows.
- **FR-032** `[IMPLEMENTED]` **Ctrl+K.** The palette's actions get **Schedules** (hint "Every folder's scheduled prompts", the keys of FR-031, keywords "schedule scheduled prompts timer every daily morning cron") that runs FR-030. It is listed whenever the top-bar button would be shown (FR-027), also from a chat.
- **FR-033** `[IMPLEMENTED]` **Screen readers.**
  - The accessible name says what the eye sees, in words: "Schedules: 3 active, next at 08:30. 1 schedule missed or failed a run." / "Schedules: all paused." / "Schedules: none yet."
  - When the FR-029 number grows while the app runs, one polite message through `announce()`: "A scheduled prompt did not run. See Schedules (Ctrl+Shift+S)." Not at start (the *Since you were away* strip, spec 052, already tells about runs missed while the app was closed), and not twice for the same run.
- **FR-034** `[IMPLEMENTED]` **The top bar still fits** (amends spec 052 FR-105 and FR-164 for this button).
  - The bar stays **one row** (at most 52px) with no overlap and nothing outside the window, at 1440x900 and 1280x800, Expert and Simple, all six built-in themes, with floors and mixed agent apps, in DejaVu Sans (CI's font; Noto Sans was not measured): every case `shots-052-addleft` and `check:office` measure today.
  - At 1440x900 the brand name stays visible wherever it is visible on `origin/main` today (Linux). At 1280x800 the existing `tb-tight` step may move it to screen readers (the mark and the Live/Demo pill stay), as it already does there with floors.
  - Room is made with the width rules `docs/design-rules.md` names, in this order, only below 1440px and only as much as measured: the Defaults chip's cap (130px below 1600 today), then the folder filter (104px), then the top bar's gaps (`styles.css:476-503`). + Folder and + Workspace keep their words (FR-164). A value that is cut keeps its full text in its title and accessible name, as today.
  - `[KNOWN GAP]` carried from FR-164: with the Mac traffic-light room forced at 1280x800 in Expert the bar already wraps today. This change must not make it wrap at 1440x900 with the Mac room forced (6px free there today: `tb-tight` or the same room-making rules take it).
- **FR-035** `[IMPLEMENTED]` **Simulator and checks.**
  - The simulator seeds schedules on request: `simsched=1` (four schedules over two folders: one whose last run was missed and one whose last run failed; #511 seeds the first three), the option #511 adds for the Postbox. If this change lands first it adds the same option with the same data, plus one schedule whose last run `failed`. All seeded runs are in the future, so nothing runs during a driver.
  - `test:` a pure module `src/renderer/schedtop.js` (`activeCount(doc)`, `troubleSince(doc, seenAt, now)`, `topText(doc, seenAt, now, keys)` for the accessible name and the title), unit-tested by `npm run test:schedtop`.
  - `sim:` a new driver `scripts/check-sched-top.js` (`npm run check:sched-top`, in `ui-suite.js`); `shots-052-addleft` and `check-office-overlap` also hold with the button shown (see the plan).
- Tests to add: `test:schedtop`: the count ignores done and paused schedules; Pause all keeps the count and says "all paused"; the mark counts `missed` and `failed` last runs newer than the stamp, a done one-time missed one included, and ignores every `skipped-*`; no stamp means the last 24 hours; a later `sent` clears it; the texts stay at most 120 characters with 50 schedules; the keys text for Windows/Linux and for a Mac.

- *Measured after the build (2026-10-22, `sim:`, Electron under xvfb in DejaVu Sans, CI's font, with floors and mixed agent apps, six themes; free width = the bar's inner width minus its children and gaps, the Mac room subtracted; a throwaway script, not committed):* the button is 48px (icon form, 1440px), 46px (below 1440px) or 126px / 122px with the word (Simple). Room was made in the documented order, up to and including 1440px for the first two steps, because the 1440x900 window and Durbar European (whose brand name needs 102px) need it: the Defaults chip's cap did not bind in the simulator (the chip is 106px), so it stays; the folder filter is **not** narrowed by a fixed width any more (a `<select>` has no ellipsis, so 88px and 80px cut "All folders" to "All folde", found in review on PR 560): `fitTopbar()` narrows it only when the row would otherwise wrap, in this order: less padding ("All folders" still whole), then the short value "All", then `tb-tight` (the brand name). The plain 1440x900 case keeps the full 104px; with floors and mixed agent apps `check-sched-top` measures the shown text with canvas `measureText` in the select's font at 1280x800, 1440x900 and 1441-1728px, Expert and Simple, and requires it to fit; the gaps of `.controls` and `#liveBar` from 6px to 4px, the bar's column gap from 14px to 8px (the Mac traffic-light room keeps its 78px through `::before`'s margin). 1440x900 Expert: plain 120px free, floors and mixed 16px (Durbar European) to 59px (Clean Office), the brand name shown in every theme, Mac room forced 1px and one row. 1280x800 Expert: plain 10px, floors and mixed 10px in all six themes (`tb-tight`, as before). Simple: 1440x900 129px at least, 1280x800 11px at least (Durbar European). Amendment to the rule above: the first two room-making steps also apply at exactly 1440px. `[KNOWN GAP]` carried from FR-164: 1280x800 Expert with the Mac room forced wrapped before (-31px) and wraps now (-48px). `check:mac-titlebar` passes 42/42.

- *Badge contrast (FR-033, review on PR 560):* the disc of the mark is the button's own text colour (`currentColor`) with an amber ring (`--c-waiting`) and the drawn "!"; `check-sched-top` computes its colour against what is behind it in all six built-in themes and requires at least 3:1 (WCAG 1.4.11; the first version used `--tone-warn-ink` and read 1.8:1 on Corporate, then `--ink` read 1.36:1 there because Corporate's bar is dark but `--ink` is not).

- *Widths measured for FR-034 (2026-10-22, `sim:`, DejaVu Sans, floors and mixed agent apps, `check-sched-top.js`):* 1440x900 and 1280x800 in all six built-in themes (`shots-052-addleft`, Expert and Simple); and one row (at most 52px, nothing overlapping or outside the window) at **1441, 1512, 1600 and 1728px wide** (900px tall) in Expert and Simple, each also with `data-platform="darwin"` forced. Not measured: any other width, Noto Sans, the six themes between 1441 and 1919px, a real Mac or Windows. The word of the button shows from 1920px (2040px on a Mac) in Expert, so no width between 1441 and 1919px carries it.

- *Decisions (2026-10-22, Paco's agent with the owner's delegation to decide small UI points):* the badge counts runs missed or failed **since Schedules was last opened** (not "last run missed", which can stay up for days); with **Pause all** on, the button keeps its number, dimmed with a pause glyph; the shortcut is **Ctrl+Shift+S / ⇧⌘S** plus the Ctrl+K item.

### 2026-10-22: edit a schedule (issue #522)

*Found (owner, v0.1.0-alpha.11, macOS):* in **Settings > Schedules** he pressed **Open…** on the folder row to change a schedule ("every day at 10:00") and got the folder's *Schedules for <folder>* dialog, which only adds one. A schedule could only be paused, resumed or deleted; to change its prompt or time he had to delete it and type it again, losing its last run. The prompt is cut with "…" in both places, and its tooltip is the whole prompt (up to 2,000 characters, over spec 052 FR-168).

*Status:* built 2026-10-22 (unit tests and simulator; not seen on a real Mac or with a real session).

- **FR-022** [IMPLEMENTED] **Edit… on every schedule row.**
  - Each Durbar schedule row, in the folder's dialog and in Settings > Schedules, has **Edit…** next to Pause/Resume and Delete. A done one-time schedule has Edit too (owner, Q2): saving it with a new time in the future makes it run again. The agent app's own schedules (FR-016) stay read-only: no Edit.
  - Edit… opens the folder's dialog (from Settings too) with the form filled from the schedule: the prompt; the when (*Every N minutes*, *On a calendar* with its kind, time and days, or *Once at* its date and time); **Send to** (the folder's agent, or the schedule's session, shown with its name even when the dialog was not opened from that chat); and the **Limit** in its unit.
  - While editing, the form says **Edit schedule**, the primary button reads **Save** and a **Cancel** button puts the form back to adding a new one. Cancel, Close and Escape change nothing. The template picker is hidden while editing (owner, Q3).
  - Save keeps the schedule's id, folder, last run, pause state and its reason, and what it has spent when the limit's unit is the same (FR-015). The next run is computed again from the new when, also for a paused schedule: an interval without an anchor gets `now + every`, even when only the prompt was edited. An edit that removes the limit (`cap: null`) or raises it above what was spent clears the reason "reached its limit" and keeps it paused, so the row offers Resume. Moving a schedule that was paused because its session ended to another target (the folder's agent or a live session) clears the reason and keeps it paused, so the row offers Resume. An anchored interval (FR-007) keeps its first time when its minutes are unchanged, also when the form sends no time. A limit is dropped only by an explicit `cap: null`: an edit with no `cap` key keeps the limit and its spend, and the form sends none when the Limit field is hidden (the agent app reports no unit), saying so in a note. A limit carried over unchanged (no `cap` key, or the same amount and unit) **with the same target** needs no cost unit at save time, so an edit is never refused because the agent is gone or reports no cost. A new or changed limit, or an unchanged one whose target (session and agent) changes, is checked like a new limit: no unit refuses it, and a different unit refuses it with "This agent app counts in X, not Y: set the limit again." (a limit is never enforced in a unit it does not use). In the form, when the Limit field is hidden (the agent app reports no unit) the note says the limit is kept only while Send to is unchanged; after moving Send to to such an app it says "This agent app does not report what a run costs, so the limit will be removed." and Save sends `cap: null`. Changing **Send to** to an agent with another unit clears the Limit field instead of carrying the number across units.
  - The toast says "Schedule saved: <when>." The row shows the new prompt and when in place; the list order does not change.
  - If the schedule was deleted or changed by the app meanwhile (a run, a pause at its limit, an ended session), main's copy wins for everything the form does not edit; a deleted one is refused with "That schedule is gone." and the form goes back to adding.
- **FR-023** [IMPLEMENTED] **Same checks as a new schedule.** An edit goes through `schedules:save` (no new IPC channel) with `edit: true` and the schedule's `id`, and is validated in main exactly like a new one (FR-017): prompt, interval, rule, target and limit.
  - With `edit: true`, main takes only the prompt, the when, the target and the limit from the renderer. The id must exist; the folder, `paused`, `pausedReason`, `done`, `last`, `spent` and `spentUnknown` come from main's own copy.
  - A one-time time that the edit changes must be in the future, paused or not ("That time has already passed."). An unchanged time of a paused one-time schedule stays as it is; an interval or calendar schedule edited to one-time cannot keep a past anchor as its time.
  - An edit never counts toward the limit of 50.
  - An edit of a done one-time schedule (Q2) must set a new time in the future ("Pick a time in the future to run it again."); saving clears `done`, so it runs again, and keeps its `last`. The edit may also change it to an interval or calendar schedule; `done` is cleared either way.
  - A save with an existing `id` that is not an edit (Pause, Resume, *Use the folder's agent*) changes only `paused` and `target`: the folder and `done` stay main's.
  - Any save that carries an `id` main does not have is refused ("That schedule is gone."), with or without `edit`. Today such a save adds a new schedule with that id, so Pause on a row that another window just deleted brings it back. New schedules never send an id.
- **FR-024** [IMPLEMENTED] **The folder button says what it does.** In Settings > Schedules the folder row's **Open…** becomes **Schedules for this folder…** (owner, Q1), with the title "See this folder's schedules and add one". It stays one line at 1440x900 and 1280x800; the folder path beside it shrinks with an ellipsis first (spec 052 FR-167).
- **FR-025** [IMPLEMENTED] **The whole prompt can be read.**
  - The row keeps the prompt on one line, cut to 90 characters with "…" (`cutText`). Its tooltip is at most 300 characters (spec 052 FR-168, data tooltip), cut with "…".
  - The cut prompt is a button (keyboard focusable, `aria-expanded`): pressing it shows the whole prompt wrapped under the row, and pressing it again folds it. A 2,000-character prompt then takes about 25 lines in the M dialog; the dialog body scrolls vertically, never sideways (FR-167). Edit… also shows it in full in the form.
  - The same applies to the agent app's own schedules in the dialog (FR-016).
- **FR-026** [IMPLEMENTED] **Simulator.** The simulator's `saveSchedule` behaves like main for edits: the same fields kept, the next run computed again, an unknown id refused.
- Tests to add: `test:schedules`: an edit keeps the id, `last`, `paused` and `pausedReason`, and the spend in the same unit; the next run moves to the new when (interval, rule, once), also when paused; a past one-time time is refused as for a new one, and the schedule is unchanged; an edit with 50 schedules passes; an unknown id is refused with and without `edit`; the renderer cannot set `paused`, `done`, `last` or `spent` through an edit. `sim:` a new driver `check:sched-edit` at 1440x900 and 1280x800 (see the plan).
- *Owner answers (Paco, 2026-10-22):* **Q1** the folder button reads **Schedules for this folder…**; **Q2** a done one-time schedule can be edited, and a new time in the future makes it run again; **Q3** the template picker is hidden while editing.
- `test:` `scripts/test-schedules.ts`: edits keep id, last, pause state and reason and the spend in the same unit; next run recomputed; past times refused; unknown ids refused; no `cap` key keeps the limit and its spend, `cap: null` removes it; an anchored interval keeps its `at` when `every` is unchanged.
- `sim:` `scripts/check-sched-edit.js` (`npm run check:sched-edit`, in `ui-suite.js`), 1440x900 and 1280x800: every row shows Edit…, Pause and Delete inside the dialog; Edit fills the form (Edit schedule, Save, Cancel, no template picker); Save changes the row in place with the same data-id and order; Cancel and Escape change nothing; a paused schedule stays paused; a done one-time schedule edited to the past is refused and to the future runs again (the page clock is moved, no sleeps); the 2,000-character prompt toggle (aria-expanded, tooltip at most 300 characters) with no sideways scroll; Settings button *Schedules for this folder…* on one line, nothing overlapping, Edit… opens the dialog in edit mode; all text at least 10.5px. Screenshots `docs/screenshots/044-edit-form-*.png`, `044-edit-settings-*.png`.
- *Resolved (the owner's report that the dialog row had no Pause or Delete):* **reproduced in the simulator with a long prompt** and fixed. The list was a grid whose single column grew to the widest row, so with a long cut prompt the buttons sat outside the dialog (at x=1140 in a dialog that ended at x=1000, 1440x900) and looked missing. The list column is now `minmax(0,1fr)`. Without the fix, `check:sched-edit` failed with all 12 buttons outside the dialog; with it they are inside at both sizes.
- `sim:` the driver also edits a schedule sent to one session from Settings and checks that Send to shows the session's name. `test:` the main-side rules above (limit carried with an unknown unit, past anchor, non-edit saves, retargeting a session-ended schedule) are unit-tested.
- `sim:` the driver also types a Limit, then changes Send to in `simkinds=mixed` (Lena's own app, the simulated Codex, reports no unit; her room's agent counts in dollars) and checks the field is cleared. Only the no-unit case is shown: no simulated room offers two agents with different units both reporting one. `test:` target change with no unit or another unit is refused; a raised or removed limit clears `pausedReason`.
- `sim:` in `simkinds=mixed` the driver also moves a capped schedule's Send to to Lena's own app (reports no unit): the note says the limit will be removed, Save succeeds and the row shows no limit.
- `[KNOWN GAP]` Not seen on a real Mac or Windows, and not with a real agent session. The "limit is kept" wording (Limit hidden, Send to unchanged) is covered by the main-side rule only; no simulated schedule reaches that state.

### 2026-10-20: Schedules dialog, Send to row and session names (issue #371)

*Found (owner, real Mac, main):* in **Schedules for <folder>** the label "Send to" wrapped inside its own cell ("Sen" / "to") and was half covered by the select; the **Limit … AI credits** row was misaligned too. The **This session (…)** option showed the session's whole first prompt, a long sentence with private content.

- **FR-020** [IMPLEMENTED] **Rows keep their labels.** In the dialog's options row, **Send to** and **Limit** keep their label on one line (never cut mid-word, never covered by the control beside them) at the narrowest dialog width, at 1440x900 and 1280x800, in Simple and Expert. The label takes its own width; the select (or the number field) takes the rest of the line and may shrink, its text ellipsized. A row that does not fit wraps as a whole, under the other.
- **FR-021** [IMPLEMENTED] **The session name beside the select, not in it.** The **Send to** options are short: **This folder's agent** and **This session**. A native select cuts an option's text hard (no ellipsis, in Chromium and in the macOS popup) and the option's tooltip is not shown, so the session's name never goes in an option. Under the select, one line shows the **selected session's display name** (spec 059: the name the user gave it, else its title; the stored schedule target name and the list use the same shared cutter, `SN().shortName` = `cuttext.js`) (full name in its `title`, cut by CSS with an ellipsis if the dialog is narrow, at least 10.5 px, `aria-describedby` from the select). It is hidden while **This folder's agent** is chosen and follows the select on change. The option's value (the session id) is unchanged. Names elsewhere (agent strip, inbox) are not touched. While the select has focus the hint wraps to show the full name (CSS `:focus-within`), so reaching the full name does not rely on the `title` tooltip; the select's `aria-describedby` gives it to screen readers. `real:` Paco's Mac (macOS 26, simulator, main 1e994d67, 2026-10-20): the closed select shows "This folder's agent" (116px) and "This session" (77px) in a 286px select, nothing clipped, labels one line; `#scToHint` hidden for the folder option, shown for "This session" (12px, one line, ellipsizes a forced long text), `title` = the full name, `aria-describedby=scToHint`; the native macOS popup is readable (by hand). `[KNOWN GAP]` (closed by the focus wrap above, not yet re-run on a Mac): hovering the hint showed no `title` tooltip on macOS (the sim name was not truncated; Electron/macOS may delay or suppress title tooltips).
  - `real:` 2026-10-20, Paco's Mac on `b30a351`: the labels were fine, but the first design (option text "This session (" + a name cut to 40 characters + ")", about 337 px against about 302 px inside the select) was still cut by the select. Hence this design.
  - Shared text cutter: `src/renderer/cuttext.js` (`cutText(text, max, { wordBoundary, trimPunct })`, unit-tested by `npm run test:cuttext`) replaces the separate slice-and-"…" copies in `app.js` (`clipName`, `SHORT`, the grant and schedule-row texts) and in `attention.js` (`clip`). It counts code points (an emoji is never split, a combining mark stays with its letter), collapses whitespace, and returns at most `max` characters with the "…". The word-boundary and punctuation options are for names; the others keep a plain cut. `places.js` has one more copy of its own (60 characters), left alone for now.
- `sim:` `scripts/check-sched-sendto.js` (`npm run check:sched-sendto`) at 1440x900, 1280x800 and 900x700, Simple and Expert, at the dialog's usual width and at 340 px, with a session named with a long sentence: the Send to and Limit labels are one line high and do not overlap their controls; every option's text, measured with the select's own font, fits the select's inner width; the hint is hidden for the folder's agent, shows the full name in its title for the session, stays inside the dialog and is at least 10.5 px. Mutation: the long option text again fails it. Screenshots are in the PR.
- `[KNOWN GAP]` Not checked on the owner's Mac (macOS fonts are wider than the simulator's on Linux); the fix does not depend on a font width.

### 2026-10-19: Phase 1 built

- `test:` `npm run test:schedules` (fake clock and sender): due times, interval runs, a busy agent skips (never queued or caught up), pause all and resume without a burst, once-schedules run once, a past time is refused, missed runs at start, removal, the limit of 50.
- `sim:` the Folders panel (Schedules per folder, Pause all schedules), the dialog (list, add every N minutes or once at a time, pause, delete), a once-run sent to an idle agent with the chat note "Scheduled prompt (once).", a run skipped while the folder's agent was busy; 1440x900 and 1280x800 (`docs/screenshots/044-*.png`). The Folders panel is 660 px wide now (was 560) so a row keeps its path and next run beside the five buttons.
- `real:` 2026-10-19, Free plan, the real app: a once-schedule 20 s ahead sent "Reply with the single word: scheduled" to a real Copilot session in a throwaway folder; the chat showed the prompt and the note, and the agent replied "scheduled" (0.162 AIU).
- `[KNOWN GAP]` Sleep and wake on macOS and Windows; long-running intervals over hours (timers are recomputed from the wall clock on each change, not on wake).

### 2026-10-19: starter kit, "every day at", and a decision at the end (issue #128, owner)

*Owner decision:* the morning briefing of issue #128 ("Start my day", "summarize my day") is **a starter template of Scheduled prompts**, not a separate feature: "it should be part of schedules as one of starter kit templates … link those issues and develop together". And: "or may be an extended of scheduled ones which asks users something to take decisions or planned work … see how can we support better and intuitive such workflows". The draft spec 050 was dropped for this.

- **FR-006** **Starter kit.** The Schedules dialog has **Start from a template**. Choosing one fills the prompt and the time; nothing is saved until *Add schedule*, and everything stays editable. A note under the picker says what the template needs (MCP servers, or a mode that may run commands) and whether it ends with a question. Templates (`src/renderer/schedtemplates.js`, pure data):
  - *Start my day (morning briefing)*, every day at 08:30: mail and calendar through the user's own MCP servers, the folder, issues and PRs, in five sections;
  - *Summarize my day*, every day at 18:00;
  - *Plan my day (planned work)*, every day at 09:00: at most five pieces of work, each with why and a size;
  - *Open pull requests and CI*, every 4 h;
  - *Dependency and security check*, every day at 09:00.

  Every template says to treat mail, documents and web pages as data, never instructions, and says what it must not do (send, merge, install).
- **FR-007** **Every day at HH:MM.** A third choice next to *Every N minutes* and *Once at*. Stored as an interval with a first run (`every: 1440, at`).
  - An interval with `at` is **anchored**: after a run, a busy skip, a missed run or *Pause all*, the next run is the next `at + k × every`, so the time of day stays.
  - Plain intervals keep counting from now, as before.
  - The list shows "every day at 08:30".
  - ~~`[KNOWN GAP]` A daily interval is 24 h of clock time, so across a daylight-saving change it shifts by an hour until it is edited.~~ Fixed 2026-10-20: *every day at* is a calendar rule now (FR-012, FR-013).
- **FR-008** **Decision at the end.** The briefing and planning templates end by asking the user **with the agent's own question tool**: Copilot `ask_user`, Claude `AskUserQuestion`, or Codex `request_user_input` where it is on.
  - The question offers the suggested next steps as choices (several allowed, plus "none"). The agent then does only what was chosen, one step at a time, still within its permission mode, which asks before anything that writes or sends.
  - In Durbar this is the existing question card, and the agent shows as **Waiting for you** in the office, so a decision prepared at 08:30 is waiting when the user arrives.
  - Without a question tool, the agent ends with numbered suggestions and waits for a reply.
- `test:` `test:schedules`:
  - anchored intervals: the first run at the chosen time, the next day at the same time, a busy skip keeping the time, a 2.5-day gap resuming at the next 08:30, *Pause all* keeping the time;
  - plain intervals unchanged; `alignedNext`, `nextDaily`;
  - every template valid, under 2,000 characters, with the untrusted-data and "do not" rules and a valid time; the decision step in the three templates that have it.
- `sim:` `scripts/shots-044-templates.js` at 1440x900 and 1280x800: the picker fills *Start my day* and "Every day at 08:30", the note mentions the question, the dialog fits, and the added schedule reads "every day at 08:30". Screenshots: `docs/screenshots/044-templates-*.png`.
- `real:` 2026-10-19, Claude Code 2.1.303 (`haiku`), Read-only, a throwaway folder with a `TODO.md` of three items. The *Plan my day* prompt read the file and asked through a question card: "Which should I work on? Pick any, or none." The options were the three items with sizes plus "none", with several allowed. It was skipped from the adapter. Cost: $0.005.
- `[KNOWN GAP]` Not checked: *Start my day* against real mail and calendar MCP servers (it needs the owner's servers), and the question step on Copilot and Codex.

### 2026-10-19: Schedules are easy to find, in the folder and in Settings (owner)

*Found (owner, on alpha.7):* "is scheduling feature already in this build, where can i find it?" Schedules could only be opened from the Folders panel. *Owner:* "make it intuitive and also show it inside folder for that folder and in settings for all folders".

- **FR-009** **In the folder.**
  - The room's **⋯** menu (and right-click on its header) has **Schedules…**, with a line saying how many there are and the next run, or what schedules do.
  - A main agent's chat header has **Schedules**, with the count, e.g. "Schedules (1)".
  - Both open the folder's Schedules dialog with its starter kit.
- **FR-010** **The room shows it.**
  - A room with active schedules has a small **clock chip** in its header, next to MCP: the count and the next run, e.g. "1 · 08:30"; outside the next day, "Tue 08:30". It is dimmed when all are paused.
  - The tooltip says the same in words, and a click opens the dialog.
  - Without schedules there is no chip; the ⋯ menu still offers it.
- **FR-011** **Settings > Schedules** lists every folder's schedules in one place:
  - each folder with **Open…**;
  - each schedule with when, next and last run, **Pause/Resume** and **Delete**;
  - **Pause all schedules**;
  - **Add a schedule to** a folder that has none.

  All views (Folders panel, dialog, room chips, chat button, Settings) refresh together when anything changes.
- `sim:` `scripts/shots-044-everywhere.js` at 1440x900 and 1280x800:
  - no chip before there is a schedule;
  - the menu item opens the dialog;
  - adding *Start my day* shows the chip "1 · 08:30" inside the room header, and the chip opens the dialog;
  - the chat header says "Schedules (1)" and opens it;
  - Settings lists it; Pause and Delete work there, and the chip goes away with the last schedule.
- Screenshots: `docs/screenshots/044-room-chip-*.png`, `044-settings-*.png`.
- `scripts/shots-006-remove.js` now expects *Schedules…* in the folder menu.


### 2026-10-20: Phase 2: calendar rules, per-session schedules, a per-schedule cap, the agent's own schedules (issue #291)

*Decisions:* a schedule whose session has ended **pauses** and says so; it is never sent to another session without the user choosing it (the safe choice, Principle II). A per-schedule cap counts what that schedule's own runs spent; it is checked before a run, never during one (the session's own cap still applies during a turn).

- **FR-012** **Calendar rules.** Next to *Every N minutes* and *Once at*, **On a calendar**: *every day*, *weekdays (Mon-Fri)* or *weekly on* one or more days, **at HH:MM** local time. Stored as `rule` {`kind`: `daily` | `weekdays` | `weekly`, `time` "HH:MM", `days` 0-6 (0 = Sunday), weekly only, at least one}.
  - The next run comes from a pure function, `nextRuleRun(rule, after)` in `src/shared/schedrules.ts`. It builds the next `Date` from the local calendar day and the wall-clock time (Y/M/D h:m), never by adding 24 h, so a run keeps its time of day across a daylight-saving change. This fixes the FR-007 `[KNOWN GAP]` for *every day at*.
  - Daylight saving: in spring a time inside the skipped hour (for example 02:30 in Europe/Zurich) runs once that day at the shifted time (03:30). In autumn a time inside the repeated hour runs once, at its first occurrence.
  - Busy, missed and *Pause all* behave as for intervals: the run is skipped and the next run is the rule's next time. Missed runs are not caught up.
  - The list says "every day at 08:30", "weekdays at 09:00" or "weekly on Mon, Thu at 17:00".
- **FR-013** **Migration.** Existing saved schedules keep working.
  - An old *every day at* (`every: 1440` with `at`) is read as a `daily` rule at the local time of `at`. Its daylight-saving drift goes away without an edit.
  - Other anchored intervals and plain intervals are unchanged.
  - New fields are optional. A missing field means: the folder's agent, no cap, nothing spent. A bad value in a new field is dropped; a bad rule drops that schedule, as for a bad interval.
- **FR-014** **A schedule for one session.** A schedule can target one session (`target` {`session` id, `agent` app id, `name` shown}) instead of the folder's agent.
  - It runs only in that session, and the busy check looks at that session only.
  - When the session is gone (removed, replaced, or not restored after a restart), the schedule **pauses** with `pausedReason: session-ended`. This is checked when the app starts, when a session is removed and when a run is due; a run found due then is recorded as `skipped-ended`.
  - The list shows "Paused: the session has ended", with **Use the folder's agent** (it drops the target and resumes). *Resume* alone is refused while the session is gone.
  - The Schedules dialog opened from a chat (its header button) has **Send to**: *This folder's agent* or *This session (<name>)*. Opened from elsewhere it sends to the folder's agent, as before. The list shows "→ <name>" for a targeted schedule.
- **FR-015** **A limit per schedule.** **Limit** is optional, in the unit of the agent app's cap: AI credits (Copilot) or dollars (Claude's estimate, spec 012 FR-150). The unit is taken from the target's agent app when the schedule is saved. Stored as `cap` {`amount`, `unit`: `aiu` | `usd`}, with `spent` and `spentUnknown`.
  - *Attribution:* from a scheduled send until that session's turn ends (its next `idle`, `error` or `stopped` status), every `usage` event of the session counts toward the schedule. That includes its helpers, which report through their agent. The amount is `nanoAiu / 1e9` for AIU, or `costUsd` for dollars.
  - When a run is due and `spent` ≥ the cap, nothing is sent. The run is recorded as `skipped-cap` and the schedule pauses with `pausedReason: cap`: "Paused: reached its limit". **Resume** starts counting again from zero.
  - The list shows "spent 1.20 of 5 AIU", or "$0.04 of $1.00".
  - *Limits, said honestly:*
    - a message the user sends during a scheduled turn counts too (it over-counts, the safe side);
    - a run that starts under the cap can end over it (the cap stops the next run, not the current one);
    - a usage event without a figure in the cap's unit (a runtime that reports no credits) sets `spentUnknown`, and the list says "the spend was not fully reported";
    - the spend is kept with the schedule, so it survives restarts; a turn in progress when the app quits is no longer attributed after the restart.
- **FR-016** **The agent's own schedules, read-only.**
  - The Copilot SDK reports prompts scheduled inside a session (`session.schedule_created`, `session.schedule_cancelled`, `session.schedule_rearmed`; made with `/every` or `/after`, or by the agent through its `manage_schedule` tool). The Copilot adapter maps them to a normalized `agentSchedule` event: phase, id, prompt, interval, cron expression and time zone, one-off time, next run, and who made it.
  - The Schedules dialog lists a folder's live sessions' own schedules under **Scheduled in the agent app (read-only)**, with a note that Durbar cannot change them.
  - Only schedules reported while Durbar runs are shown. They are not read from a session's history, and they are kept in the window only.
  - `[KNOWN GAP]` Not available from Claude Code or Codex: neither adapter reports such schedules. Not seen on a real Copilot session: the runtime exposes `manage_schedule` only to some accounts ("typically gated to staff users"), and `/every` was not tried through Durbar.
- **FR-017** **Validation.** Everything from the renderer is untrusted and is validated in main: the rule (kind, time, days), the target (the session must exist when saved, ids are limited to `[A-Za-z0-9._:-]` and at most 128 characters, the name is one line of at most 80 characters), and the cap (AIU 0.01 to 1,000,000, dollars 0.01 to 10,000, in the target's unit). `spent`, `spentUnknown` and `pausedReason` are never taken from the renderer; main keeps its own.
- **FR-018** **Simulator.** The simulator has the same rules, targets, caps and pause states. Its simulated usage counts toward a schedule's cap, so the dialog can be checked without credits.
- `[IMPLEMENTED]` FR-012..FR-018.
- `test:` `npm run test:schedrules` runs under `TZ=Europe/Zurich`. It covers *every day at* across both 2026 changes (23 h and 25 h days, still 08:30), 02:30 in the skipped hour (runs at 03:30 once) and in the repeated hour (runs once), times already passed today, exactly now, and the year end. It also covers *weekdays* over the weekend, *weekly* on Monday and Thursday and on one day, `parseRule`, and the renderer's copy agreeing with main's on more than 500 cases. Finally, the scheduler over the fall-back weekend: a daily rule and a weekdays rule, a busy skip, and a missed start.
- `test:` `npm run test:schedules` (Phase 2 part):
  - migration of an old *every day at*, and Phase 1 files loading;
  - validation of rules, targets (ids, a one-line name) and caps (ranges, units, the agent app's unit wins), with `spent` and `pausedReason` never taken from the renderer;
  - per-session busy; pause when the session ends (at once, at a due run, at start); Resume refused, and *Use the folder's agent*;
  - the limit: usage counted only between a scheduled send and the turn's end and only for that session, in AIU and in dollars; the skip and pause at the limit; an edit keeping the spend; Resume counting from zero; `spentUnknown`; the spend saved and read back.
- `test:` `npm run test:events`: the Copilot `session.schedule_*` events map to `agentSchedule` (a helper's schedule and one without an id are dropped, text cleaned, bad values dropped), and pass the event guard.
- `sim:` the simulator has rules, targets, limits (its simulated usage counts) and both pause states. `scripts/shots-044-templates.js` and `scripts/shots-044-everywhere.js` now also check the calendar choice (weekly shows the days) and the *Send to* choice in a dialog opened from a chat. `[KNOWN GAP]` These drivers were updated but not run in this change, and no new screenshots were taken. The read-only list of the agent's own schedules has no simulator source.
- `[KNOWN GAP]` No real check of Phase 2: no real session ran a rule, a per-session schedule or a limit. The Copilot schedule events are mapped from the SDK's types, never seen live.

### 2026-10-20: do MCP tools run in Read-only? (real check, Copilot)

The mode help says "read-only MCP tools still run" (spec 052 FR-019), and the *Start my day* template says it "works in Read-only" while it reads mail through MCP. Checked on a real session:

- `real:` 2026-10-20, Copilot runtime 1.0.98, free plan, `auto`, the real `CopilotAdapter` in **Read-only** with a tiny local stdio MCP server that has one tool `echo` (`scripts/mcp-readonly-copilot-real.ts`). **2 prompts, 0.18 + 0.09 = 0.27 AI credits.**
  - **Tool marked `readOnlyHint: true`:** it **ran**. The runtime sent **no permission request** to Durbar (the broker saw nothing); the server received the call and the agent answered with its result.
  - **The same tool without `readOnlyHint`:** the runtime sent a permission request of kind **`mcp`**; Durbar's broker **denied** it ("Agent Durbar is in read-only mode: this action was denied"); the server received nothing.
- **Result:** on Copilot the help text is right, and *Start my day* works in Read-only **only if the mail and calendar servers mark their read tools `readOnlyHint`**; a server that does not is denied. The runtime decides from the server's own hint, so a server that wrongly marks a writing tool read-only also runs in Read-only (`[KNOWN GAP]`, for spec 003).
- `[KNOWN GAP]` Not checked on Claude Code or Codex, and not with real mail or calendar servers.
- **Wording fixed (2026-10-20, FR-019a):** *Start my day* now says "In Read-only, a mail or calendar tool runs only if its server marks it read-only; otherwise choose Ask first." The Read-only mode help (spec 052 FR-019) now says "An MCP tool runs only if its server marks it read-only." That is an upper bound for all three apps: Claude Code and Codex send every MCP call to the broker as kind `mcp`, and Read-only denies it (read: `claudeModes.ts`, `codexModes.ts`, broker). It promises nothing that was not seen. test: `test:schedules` (templates still load) sim: `shots-044-templates`.

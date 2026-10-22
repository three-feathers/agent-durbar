# Feature Specification: Scheduled prompts (while the app is open)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 042
title: Scheduled prompts while the app is open (issue #125)
status: Phase 1 built: per-folder schedules, once or every N minutes, busy and missed runs skipped, pause all (unit tests, simulator, real check 2026-10-19). Phase 2 built 2026-10-20 (#291): calendar rules without DST drift, per-session schedules (pause when the session ends), a per-schedule limit, Copilot's own schedules read-only (unit tests, simulator; no real check; not available from Claude Code or Codex) Delta 2026-10-20 (#371): the Send to and Limit labels stay on one line and the "This session" option is capped at 40 characters (simulator check `check:sched-sendto`; not seen on a Mac).
-->

**Feature Branch**: `044-scheduled-prompts`
**Created**: 2026-10-19
**Status**: Phase 1 built (unit tests with a fake clock, simulator, one real check 2026-10-19); Phase 2 built 2026-10-20 (unit tests and the simulator; no real check yet), see *Changes*
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

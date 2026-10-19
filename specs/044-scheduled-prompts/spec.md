# Feature Specification: Scheduled prompts (while the app is open)

**Feature Branch**: `044-scheduled-prompts`
**Created**: 2026-10-19
**Status**: Phase 1 built (unit tests with a fake clock, simulator, one real check 2026-10-19)
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

- Phase 2 (not here): a schedule per session, calendar rules, a per-schedule credit cap, the AI's own schedules (shown read-only).

## Changes

### 2026-10-19: Phase 1 built

- `test:` `npm run test:schedules` (fake clock and sender): due times, interval runs, a busy agent skips (never queued or caught up), pause all and resume without a burst, once-schedules run once, a past time is refused, missed runs at start, removal, the limit of 50.
- `sim:` the Folders panel (Schedules per folder, Pause all schedules), the dialog (list, add every N minutes or once at a time, pause, delete), a once-run sent to an idle agent with the chat note "Scheduled prompt (once).", a run skipped while the folder's agent was busy; 1440x900 and 1280x800 (`docs/screenshots/044-*.png`). The Folders panel is 660 px wide now (was 560) so a row keeps its path and next run beside the five buttons.
- `real:` 2026-10-19, Free plan, the real app: a once-schedule 20 s ahead sent "Reply with the single word: scheduled" to a real Copilot session in a throwaway folder; the chat showed the prompt and the note, and the agent replied "scheduled" (0.162 AIU).
- `[KNOWN GAP]` Sleep and wake on macOS and Windows; long-running intervals over hours (timers are recomputed from the wall clock on each change, not on wake).


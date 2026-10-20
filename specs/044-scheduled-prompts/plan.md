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

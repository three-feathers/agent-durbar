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

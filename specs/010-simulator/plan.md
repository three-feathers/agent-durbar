# Implementation Plan (as built): Simulator and developer/test hooks

**Spec**: [spec.md](spec.md) | **Date**: 2026-10-16 | **Kind**: reverse-engineered

## Summary

`src/renderer/sim.ts` is a plain script (no imports) compiled to `dist/renderer/sim.js`. When `?sim=N` is present, `app.js` uses `window.__durbarSim.create(...)` as its `bridge` instead of the Electron preload bridge. The Electron main process only translates environment variables into the query string and offers a few extra dev hooks.

## Technical Context

- **Language**: TypeScript (compiled by `tsc`, `renderer.ts` and `sim.ts`), JS driver scripts.
- **Dependencies**: none.
- **Testing**: the simulator is a *test tool*; it has no tests of its own. Fixtures under `scripts/fixtures/` feed unit tests.
- **Constraints**: never starts a runtime or spends credits.

## Constitution Check

| Principle | Result |
| --- | --- |
| IV No credits in tests | The simulator is the mechanism for this principle. OK |
| II Adapter plug-in | The bridge/event contract is the only coupling. OK |
| III Safe by default | Hooks are env-driven and also present in release builds (FR-009). **Partial** |
| VII Gates | Not automated (FR-007). **Partial** |

## As-built architecture

```text
DURBAR_SIM=N (main.ts) -> loadFile(index.html?sim=N[&simfreeze=1][&simrooms=solo])
app.js: SIM -> bridge = window.__durbarSim.create({n, freeze, solo, seed}) -> LIVE agents, onLiveEvent(simulated AgentEvent)
sim.ts: ROSTER (names, rooms, states, intents, helpers, files), tick every 2600 ms unless frozen, canned turns, permission flows, grants,
        stageAttachment fake, listModels/listPrevious/resumeSession/listVsChats stubs, newSession/hide/remove

Developer hooks in main.ts: DURBAR_USER_DATA, DURBAR_OPEN/PERM, DURBAR_PICK, DURBAR_LOG (+ adapter.debug), DURBAR_SHOT*, DURBAR_DRIVER (ctx above), DURBAR_VSCODE_USER_DIR
scripts/e2e-driver.js phases: dry | fake | ask | ro | att | m5 | real      scripts/smoke.ts: headless adapter run (credits)
```

## Project Structure (documentation)

```text
specs/010-simulator/
├── spec.md
├── plan.md
└── tasks.md
```

## Verification status

| Claim | How | Result |
| --- | --- | --- |
| `DURBAR_SIM=15`/`12` with freeze/unfrozen, driver hook, xvfb | ran headless on 2026-10-16 (see feature 001) | pass |
| Permission/attachment/resume flows on the simulator | README + screenshots | `sim:` recorded, not re-run |
| Driver phases `real`, `ask`, `ro`, `att` | README (credits) | `real:` recorded, not re-run |
| macOS/Windows | none | untested |

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

## 2026-10-22 delta: the simulator never reaches a real agent app (FR-022..FR-027)

**Where the check lives.** Two places, both in main, both default-deny:

```text
src/main/simguard.ts   pure: simulatorOn(dev) | SIM_OPEN_CHANNELS {channel: reason} | SIM_REFUSAL(channel)
                       simGuardDescriptors(descs, on) -> create() returns blockedAdapter(d) (no real create call)
src/main/ipcguard.ts   simulator ??= simulatorOn(devEnv(process.env, app.isPackaged))   (decided once, at the first call)
                       ipcHandle: sender check -> if SIM && !simChannelOpen(channel) throw SIM_REFUSAL -> handler
                       ipcOn:     sender check -> if SIM && !open: drop (one console.warn per channel)
src/main/main.ts       createRegistry(simGuardDescriptors([...PRODUCTION, ...offered], simulatorOn(dev)))
                       whenReady: scheduler.start() and DURBAR_OPEN only when !simulatorOn(dev)
                       driver ctx: createdAdapters() = router.created().map({id, simBlocked})
```

**Why default deny, not a list of spending channels.** Handlers reach agent apps through helpers (`stopTurnOp`, `prevSessions.delete`, `explain`, `remoteOps`), so a text scan for "spending" handlers misses some (a first scan found 40 of the about 45). The simulator's window never calls main except `harness:plans` (`sim.ts`), so denying everything else costs nothing and covers channels added later, such as PR #505's `profiles:generate`.

**Why also the registry.** IPC is not the only way in: restored folders, the scheduler, `DURBAR_OPEN` and a driver's `addMany` call adapters directly. The stand-in adapter makes any such path fail loudly with the same message instead of starting a CLI. The stand-in is a `Proxy` over `{ id, displayName, capabilities, isLive, onEvent, dispose }`; any other member is a function that throws, `then` is undefined (it is not a thenable), and `debug` / `writeGuard` can be set (the router sets them).

**Tests.** `test:simguard` runs the real `ipcguard.js` under a stand-in `electron` module (`Module._load` hook), so the decision that ships is the one tested; `check:sim-guard` proves the wiring through the real preload and contextBridge in Electron.

**Constitution.** IV (no credits in tests): enforced by main instead of trusted to the renderer. III (safe by default): a packaged build never has `DURBAR_SIM` (FR-018), so users are unaffected. VI (parity): no platform code; the driver runs on all three OSes in `ui-platforms.yml`.

### Review on #514 (Paco's agent, 2026-10-22 23:45 UTC): FR-032

- `simguard.ts` `SIM_OPEN_CHANNELS` gains `app:version` (reads `app.getVersion()` only). `renderer.ts`: `bridge?.version().then(...).catch(() => {})`, so a refusal is never unhandled.
- `ipcguard.ts`: the `warned` set becomes the record of refused channels, `simRefusedChannels()`; `main.ts` driver context `simRefused()`.
- `check-sim-guard.js`: listen to the page's `console-message`, reload, wait for the 15 desks, then assert `simRefused()` is empty and no "Uncaught (in promise)" line was logged; mutation: take `app:version` off the open list and drop the `.catch`.

# Plan: 024 places in the office (2026-10-17, issue #18)

## Constitution check
- I: this spec, plan and tasks before code. II: renderer uses normalized `toolCall`/`status` events only; classification is agent-neutral (tool and MCP server names). III/VII: settings hold server names and place ids only; validated in main. IV: simulator and unit tests only, 0 AIU. V: calm rules (600 ms debounce, 2 s dwell, max 3 animations, reduced motion), FR-009. VI: no platform code. VIII: limits listed in the spec.

## Pure modules (UMD, tested in Node, like `roomsummary.js`)
- `src/renderer/places.js` (`window.DurbarPlaces`): `PLACES` (ids, names), `classify(toolCall, placeMap) -> placeId | 'desk'`, `createVisits({now, debounceMs:600, dwellMs:2000})` with `onTool(agentId, e)`, `onStatus(agentId, status)`, `tick()`, `at(agentId)`, `occupants(placeId)`; `layoutSpots(n, capacity) -> {shown, more}`. Timers are not owned: the app calls `tick()` from its render loop / a timer, so tests drive time with a fake clock.
- `src/shared/places.ts`: `PLACE_IDS`, `parsePlaceMap(unknown)`, `setPlaceEntry(map, server, place|null)` (validation, caps) used by main and tests.

## Main process
- `src/main/settings.ts`: keep `placeMap` next to `defaultMaxAiCredits` (tolerant parse, atomic write as today); `setPlace(server, place|null)`.
- `src/main/main.ts`, `src/preload/preload.ts`, `src/shared/api.ts`: `settings:get` returns `placeMap`; new IPC `settings:setPlace`. Simulator bridge (`sim.ts`): same in memory.

## Renderer
- `app.js`:
  - Feed `onTool`/`onStatus` for main-agent events (not helper events) in `onLiveEvent`; a 250 ms interval calls `visits.tick()` and `scheduleRender()` only when a visit changed.
  - `stageHTML`: insert `lobbyHTML()` between the first and second half of the open rooms; `chooseLayout` probes the same HTML, so the lobby height is part of the fit.
  - Desk scene: `scene()` gets an "away" variant (empty chair) when the agent is at a place; card text `at <Place>: <tool>`.
  - Walk overlay: one absolutely positioned layer over the floor; one small figure per visiting agent; start/end points from `getBoundingClientRect()` of the desk scene and the place spot after each render; CSS `transform` transition ~1 s + walking keyframes; a counter caps concurrent animations at 3; `REDUCED` disables transitions.
- `screens.js`: Settings "Places" section (server list from the CLI list, folder extras and servers seen this run; select per server; "default" label).
- `styles.css`: lobby band, place tiles, figure, walking keyframes, reduced-motion overrides.
- `scripts/check-office-overlap.js`: also assert the lobby does not overlap rooms/plates and fits at both sizes.

## Simulator
- It emits `bash`, `github`, `playwright`, `my-notes` calls, but **start and complete in the same tick** (only the occasional `keepOpen` call stays open), so with the 600 ms debounce nobody would walk. Give these calls a duration (1.5 to 4 s, seeded so runs are repeatable) and, with `DURBAR_SIM_FREEZE=1`, leave a fixed set of agents mid-call so screenshots show the lobby occupied. No new event types. (Found in the analyze pass.)

## Tests and checks
- `scripts/test-places.ts`: classification table, overrides, desk tools, visit state machine (debounce, dwell, newest wins, leave on stop/idle, helper ignored), `layoutSpots` `+N`; `scripts/test-credits.ts` (or new `test-settings`): `placeMap` parse/caps/round trip. Both in `npm test`.
- `npm run check:office` with lobby checks; simulator driver: SC-001 (agents at the right place and back); screenshots at 1440x900 and 1280x800 with agents in the lobby and one mid-walk.

## Risks
- Layout: the lobby band reduces height for rooms; 15 agents must still fit (SC-002). Fallback: smaller lobby height at compact densities.
- Performance: overlay figures and transitions with 15 agents; CSS transforms only, no filters, capped animations.
- Positions drift during re-renders: recompute after each render; covered by a driver test that resizes mid-visit.
- Scope is large; if it does not fit one PR, split after T005 (lobby + walking with defaults) and do Settings mapping (T006-T007) as a second PR, both under this spec.

## Implementation notes (phase 2, 2026-10-17)
- Built as planned: `places.js` (classify, visits, spots), `shared/places.ts` + `SettingsStore.setPlace` + IPC `settings:setPlace`, lobby in `stageHTML` (counted by `chooseLayout`; the layout cache key includes whether the lobby is on), walking overlay `#walkers`, Settings section, simulator durations, `check:office` lobby checks.
- Deviations: (1) one-row 36px lobby tiles instead of 58px with a names line (names in tooltip/aria-label), because the taller lobby cost a density step at 1440x900; (2) the "away" desk is CSS only: the person's SVG parts are wrapped in `<g class="pp">` and hidden by `.desk.is-away .pp`, so the cached scenes are unchanged; (3) Settings lists CLI servers + servers seen this run (+ already mapped), per-folder extras once used.
- Found and fixed while building: `SettingsStore.setDefaultMaxAiCredits` rewrote the whole settings object (it would have erased the mapping; now keeps it, covered by a test); a resting figure glided to its new slot after a layout change (now placed instantly, `move(..., instant)`); `occupants()` ordered visitors promoted in the same tick by id instead of arrival (now by call start); the simulator left the same `bash` call open for every agent (now the open calls take turns: bash, github, playwright, my-notes) and instant calls of place kinds take 1.5-4 s unless frozen.
- Checks: `npm run typecheck && npm run build && npm test` (20 suites, incl. `test:places` and the extended `test:credits`), `npm run check:office` 105/105 (the count grew from 95 because the denser layouts expose more `+N more` expansions; it also moves a little with the lobby design). Live simulator run for 24 s: at most 3 figures walking at once, empty chairs = figures at every sample.

## Verification (phase 3, 2026-10-17)
- Merged current `main` (8 commits: alpha.3, spec 025 docs rule, spec 020 import, spec 012 docs); conflicts in `package.json`, `copy-assets.js`, `screens.css`, `sim.ts` and the specs index resolved by keeping both sides.
- Review fixes: `needs-permission` no longer sends the agent back (only `idle`/`error`/`stopped` do; test); the window-resize path now re-places the figures (`relayout` calls `syncWalkers`); no figure positioning while the office is hidden behind the full-screen chat.
- `scripts/shots-024.js` (simulator, frozen): SC-001 at both sizes (every visitor at the place of its open call, card text, figures on slots, at least 3 places in use), resize, open/close the chat, status filter, a walk out and back with a one-off `github` call (simulator-only hook `window.__durbarSimEmit`), SC-003 via Settings, Demo mode. Screenshots `docs/screenshots/024-*`.
- Mutation check: 8 deliberate breaks (shell tools at the desk, no debounce, no dwell, needs-permission leaves, user map ignored, an older call ends the newer visit, `+N` off by one, `__proto__` accepted) each make `test:places` fail.
- Docs (spec 025 rule): README status section, status line, roadmap; CHANGELOG *Unreleased*; specs index; the README office pictures regenerated with the existing drivers because they now show the lobby (`m5-sim15-1440x900-closed`, `m9-office-caps-*`, `m10-office-mcp-buttons-*`, `011-usage-totals-*`; the drivers `shots-hero.js`, `shots-m9.js`, `shots-m10.js` still pass).
- `/speckit-analyze` and `/speckit-converge` followed by hand: one new known gap (T011, per-folder extras in the Places list), otherwise converged.
- CI on PR #109: `npm test` passes on ubuntu, macOS and Windows runners; the office layout check (xvfb, with the lobby checks) passes on Linux; package smoke passes.
- Not verified: a real Copilot session (which tool names and server names really arrive; 0 AIU spent), the Windows layout (unit tests only there), the walk with real timing of real tools.

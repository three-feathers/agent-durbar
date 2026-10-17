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

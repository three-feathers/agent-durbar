# Tasks: 024 places in the office (issue #18)

- [x] T001 Spec + clarifications + plan + tasks before code; specs index entry
- [x] T002 `src/renderer/places.js`: `PLACES`, `classify()` with the default rules and user overrides; tests in `scripts/test-places.ts` [FR-001, FR-002, FR-010]
- [x] T003 Visit state machine (`createVisits`: 600 ms debounce, 2 s dwell, newest call wins, leave on stop/end/error/idle, helpers ignored, injectable clock) + `layoutSpots` `+N`; tests [FR-003, FR-010]
- [x] T004 Lobby band in `stageHTML` between the two halves of the open rooms, counted by `chooseLayout`; place tiles with occupants and accessible labels; hidden in Demo mode [FR-004, FR-006]
- [x] T005 Walking overlay: empty-chair desk scene, figure glide ~1 s with walking keyframes, max 3 concurrent animations, reduced motion, positions recomputed after each render; card text `at <Place>: <tool>` [FR-005, FR-006]
- [x] T006 `placeMap` in settings: `src/shared/places.ts` parse/validate (server names and place ids only), `SettingsStore`, IPC `settings:setPlace`, preload/api, simulator bridge; tests [FR-007, FR-010, FR-011]
- [x] T007 Settings "Places" section in `screens.js` (server list, place picker, default label) [FR-008]
- [x] T008 `check:office` lobby checks; fit at 1440x900 and 1280x800 with 15 agents [FR-009, SC-002]
- [x] T009 Simulator driver for SC-001/SC-003, screenshots (lobby with agents, one mid-walk) at both sizes, README status, specs index [FR-010, SC-001, SC-003]
- [x] T010 Simulator: `bash`/`github`/`playwright`/`my-notes` calls last 1.5-4 s (seeded); with `DURBAR_SIM_FREEZE=1` a fixed set of agents stays mid-call so the lobby is occupied in screenshots [SC-001, FR-010]
- [x] T011 List per-folder MCP extras in Settings > Places before they are used (needs an app-wide read of every folder's extras; known gap under FR-008) → specified 2026-10-18 (issue #116): names of every saved folder's extras from the main process, see `## Changes`; built in T016-T018 (tick T011 when they are done)
- [x] T012 Built-in GitHub server: the list says `github`, events say `github-mcp-server`; make a mapping on one apply to both (or show the event name in Settings) [real: known gap] → specified 2026-10-18 (issue #117): one server, see `## Changes`; built in T013-T015

## 2026-10-18 delta: one GitHub server in Settings > Places (issue #117)

- [x] T013 `canonicalServer` + alias table in `src/renderer/places.js`; `classify` reads the call's own name, then the canonical one; tests in `scripts/test-places.ts` [FR-012]
- [x] T014 Settings > Places: one row per canonical name with the "also github-mcp-server" note; save under the canonical key and clear an old alias key [FR-013]
- [x] T015 `scripts/shots-024.js` check (a place on `github` applies to a `github-mcp-server` call; one row), `check:office`, README, CHANGELOG, specs index [FR-014]

## 2026-10-18 delta: per-folder MCP extras in Settings > Places before they are used (issue #116)

- [x] T016 `McpStore.extraNames(reserved)` in `src/main/mcpstore.ts`: names of every saved folder's extras (any state), exact dedupe, reserved names left out ignoring case, legacy excluded, sorted, capped at 500, memory only; tests in `scripts/test-mcp.ts` [FR-015]
- [x] T017 IPC `mcp:extraNames` (`src/main/mcpipc.ts`), preload `mcpExtraNames()`, type in `src/shared/api.ts`, simulator bridge in `src/renderer/sim.ts`; Settings > Places adds the names before `placeRows`, falls back to today's list on a missing call or bad result; tests [FR-016]
- [x] T018 `scripts/shots-024.js` check (`docs-search` row with the default place before any call; one `playwright` row), `check:office`, README places text, CHANGELOG, specs index, `screens.js` comment, FR-008 gap resolved [FR-017]

## 2026-10-18 delta: custom places (issue #115) - DRAFT, blocked on clarify Q1-Q4

- [ ] T019 Shared model in `src/shared/places.ts`: `CustomPlace`, cap 3, icon ids, reserved names, `cleanPlaceName`, `parseCustomPlaces`, add/update/remove (remove returns the map without the entries for that id), `parsePlaceMap`/`setPlaceEntry` with custom ids; tests in `scripts/test-places.ts` (every error code, 24 code points, emoji, case folding, hand-edited input, `__proto__`) [FR-018, FR-019]
- [ ] T020 Storage and IPC: `parseSettings` reads `customPlaces` before `placeMap`; `SettingsStore.addPlace/updatePlace/removePlace` (one save, injectable id generator); IPC `settings:addPlace/updatePlace/removePlace`, `settings:get` adds `customPlaces`; preload, `api.ts`; tests in `scripts/test-credits.ts` (round trip, delete clears entries, failed write keeps memory) [FR-019, FR-020]
- [ ] T021 Renderer model in `src/renderer/places.js`: `allPlaces`, `placeName(id, custom)`, `classify`/`placeRows` with custom ids (missing id falls to the defaults), `tileSlots(aw, tiles, addButton)`; new `src/renderer/place-icons.js` (12 SVGs) and asset copy; tests (icon set matches `CUSTOM_ICON_IDS`, `tileSlots` at 1248/1408 px with 5-8 tiles) [FR-021, FR-022]
- [ ] T022 Simulator: in-memory custom places in `sim.ts` with the shared rules; `DURBAR_SIM_PLACES=N` (main passes `simplaces`) seeds up to 3 places, one with a 24-character name, and maps two fake servers to them [FR-020, FR-026]
- [ ] T023 Lobby: custom tiles after the built-ins, `placeLabel` for tile, card text and toasts, slots from `tileSlots`, Add button below the cap, `syncWalkers` over all places, leave visits on delete [FR-021, FR-022, FR-025]
- [ ] T024 Add/Edit dialog and Settings *Your places* (edit, delete with the list of servers that go back to default, cap note), server selects list custom places [FR-023, FR-024]
- [ ] T025 Checks: `check:office` counts `5 + custom` and reruns base cases with `DURBAR_SIM_PLACES=3` at 1440x900 and 1280x800; new `scripts/shots-024-custom.js` (scenarios 1-7, screenshots at both sizes); `npm run typecheck && npm run build && npm test` [FR-026, SC-002]
- [ ] T026 Docs: README places text and Settings screenshot, CHANGELOG *Unreleased*, specs index row, Assumptions line in this spec; `/speckit-analyze` and `/speckit-converge` by hand [FR-027]

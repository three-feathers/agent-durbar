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
- [ ] T011 List per-folder MCP extras in Settings > Places before they are used (needs an app-wide read of every folder's extras; known gap under FR-008) → specified 2026-10-18 (issue #116): names of every saved folder's extras from the main process, see `## Changes`; built in T016-T018 (tick T011 when they are done)
- [x] T012 Built-in GitHub server: the list says `github`, events say `github-mcp-server`; make a mapping on one apply to both (or show the event name in Settings) [real: known gap] → specified 2026-10-18 (issue #117): one server, see `## Changes`; built in T013-T015

## 2026-10-18 delta: one GitHub server in Settings > Places (issue #117)

- [x] T013 `canonicalServer` + alias table in `src/renderer/places.js`; `classify` reads the call's own name, then the canonical one; tests in `scripts/test-places.ts` [FR-012]
- [x] T014 Settings > Places: one row per canonical name with the "also github-mcp-server" note; save under the canonical key and clear an old alias key [FR-013]
- [x] T015 `scripts/shots-024.js` check (a place on `github` applies to a `github-mcp-server` call; one row), `check:office`, README, CHANGELOG, specs index [FR-014]

## 2026-10-18 delta: per-folder MCP extras in Settings > Places before they are used (issue #116)

- [ ] T016 `McpStore.extraNames(reserved)` in `src/main/mcpstore.ts`: names of every saved folder's extras (any state), exact dedupe, reserved names left out ignoring case, legacy excluded, sorted, capped at 500, memory only; tests in `scripts/test-mcp.ts` [FR-015]
- [ ] T017 IPC `mcp:extraNames` (`src/main/mcpipc.ts`), preload `mcpExtraNames()`, type in `src/shared/api.ts`, simulator bridge in `src/renderer/sim.ts`; Settings > Places adds the names before `placeRows`, falls back to today's list on a missing call or bad result; tests [FR-016]
- [ ] T018 `scripts/shots-024.js` check (`docs-search` row with the default place before any call; one `playwright` row), `check:office`, README places text, CHANGELOG, specs index, `screens.js` comment, FR-008 gap resolved [FR-017]

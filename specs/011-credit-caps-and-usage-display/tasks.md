# Tasks: 011 credit cap slice

- [x] T001 Spec delta + clarifications + plan (this folder) before code [FR-009..FR-017]
- [x] T002 `shared/credits.ts` + `main/settings.ts` + folder store cap, with tests (`scripts/test-credits.ts`, `test-folders.ts`) [FR-012, FR-017]
- [x] T003 Mapper: `limit` events + fixtures/tests [FR-010, FR-017]
- [x] T004 Copilot adapter: sessionLimits on create/resume, interest, setCap, resolveLimit, cancel on stop [FR-009, FR-011]
- [x] T005 Main + preload + api: IPC, startOptions, AgentInfo [FR-012]
- [x] T006 Simulator: caps, usage, limit events, settings bridge [FR-016]
- [x] T007 Renderer: usage vs cap on cards/header, cap chip + dialog, Limit reached state + notice, new-session field, Settings section [FR-013, FR-014]
- [x] T008 Pin the SDK exactly in package.json + package-lock, document upgrading in CONTRIBUTING.md [Packaging]
- [x] T009 Screenshots (simulator), `npm run check:office` still green
- [x] T010 Real-runtime check: session create/update with a cap, no prompt (0 AIU); exhausted flow not run (30-credit minimum), recorded under Verification [FR-015, SC-002]
- [x] T011 Converge spec/plan/tasks, README roadmap, specs index

Backlog: capability flag (spec 012). (Office and per-folder totals: done 2026-10-17, T012-T019; kept across restarts: done 2026-10-17, T020-T027; multiplier estimate: covered by spec 030.)

## Office and folder usage totals (2026-10-17, issue #8)

- [x] T012 Spec delta + clarifications + plan before code [FR-018..FR-023]
- [x] T013 `src/renderer/usagetotals.js` (pure ledger, validNano, formatters, tooltip) + `scripts/test-usagetotals.ts` + `test:usagetotals` in `npm test` [FR-018, FR-021, FR-023]
- [x] T014 Ship and load it: `scripts/copy-assets.js`, `index.html` [FR-018]
- [x] T015 `app.js`: record every `usage` event once (main and helper paths) in one run-long ledger [FR-018]
- [x] T016 Header chip after the status counters, tooltip, hidden with no usage [FR-019, FR-021]
- [x] T017 Folder total in the room header and on the closed door plate (text + aria-label) [FR-020, FR-021]
- [x] T018 Styles `.stat-aiu`, `.room-aiu`; `npm run check:office` green at 1440x900 and 1280x800 [FR-022]
- [x] T019 Screenshots (simulator, both sizes, one closed door), README status line, specs index [FR-023, SC-001]

## Usage totals kept across restarts (2026-10-17, issue #21)

- [x] T020 Spec delta (second 2026-10-17 delta) + clarifications + plan before code; User Story 3 marked covered by spec 030 [FR-024..FR-030]
- [x] T021 `src/shared/usagedoc.ts` + `scripts/test-usagedoc.ts` (in `npm test`) [FR-024, FR-030]
- [x] T022 `src/main/usagetotalsstore.ts` (debounce, atomic write, flush, reset, hash key) + tests [FR-025, FR-030]
- [x] T023 Main recording from `usage` events, IPC `usage:totals` / `usage:resetTotals`, preload, `api.ts`, flush on quit [FR-026]
- [x] T024 Renderer baseline + run in `usagetotals.js` and `app.js` (folder key match, tooltip "since the app opened"); tests [FR-027]
- [x] T025 Settings "Usage totals" part with Reset and confirmation [FR-028]
- [x] T026 Simulator bridge with seeded baseline; `simunreported=<room>` [FR-029]
- [x] T027 Screenshots (`scripts/shots-021.js`): chip after a restart, "credits not reported" room, Settings part and confirmation, both sizes; README, CHANGELOG, specs index [FR-030]

## 2026-10-20: Durbar enforces the Copilot cap (FR-070..FR-074)

- [ ] T040 Copilot adapter: used-credit tracking, hold before send, stop on crossing during a turn, local `resolveLimit`, Stop/End drop [FR-070..FR-074]
- [ ] T041 Unit tests on a fake session (`scripts/test-copilot-cap.ts`, in `npm test`) [FR-070..FR-074]
- [ ] T042 One real check on Copilot Pro (cheap model, under 3 credits), README *Costs and caps*, CHANGELOG [FR-071]

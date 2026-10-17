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

Backlog (unchanged): office total, per-folder totals, persisted usage, multiplier estimate, capability flag (spec 012).

## Office and folder usage totals (2026-10-17, issue #8)

- [x] T012 Spec delta + clarifications + plan before code [FR-018..FR-023]
- [x] T013 `src/renderer/usagetotals.js` (pure ledger, validNano, formatters, tooltip) + `scripts/test-usagetotals.ts` + `test:usagetotals` in `npm test` [FR-018, FR-021, FR-023]
- [x] T014 Ship and load it: `scripts/copy-assets.js`, `index.html` [FR-018]
- [x] T015 `app.js`: record every `usage` event once (main and helper paths) in one run-long ledger [FR-018]
- [x] T016 Header chip after the status counters, tooltip, hidden with no usage [FR-019, FR-021]
- [x] T017 Folder total in the room header and on the closed door plate (text + aria-label) [FR-020, FR-021]
- [x] T018 Styles `.stat-aiu`, `.room-aiu`; `npm run check:office` green at 1440x900 and 1280x800 [FR-022]
- [x] T019 Screenshots (simulator, both sizes, one closed door), README status line, specs index [FR-023, SC-001]

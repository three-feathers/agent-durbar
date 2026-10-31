# Tasks 100: MCP context cost and warning

## Phase 0: spec

- [x] T001 Research (Copilot SDK types, Claude Code CLI strings and docs, Codex generated schema), spec, plan, tasks; open questions Q1-Q6
- [ ] T002 Owner answers Q1-Q6; record them under *Clarifications* and adjust FRs

## Phase 1: measure and show (US1)

- [ ] T010 `src/shared/mcpcost.ts` estimator and helpers; `scripts/test-mcp-cost.ts` (`test:mcpcost`, in `test:serial`): fixtures incl. a 500-tool server, non-ASCII, missing schema, NaN/negative/huge numbers [FR-002]
- [ ] T011 `McpContextReport`, `mcpContext?` and capability in `src/adapters/types.ts` [FR-001, FR-043]
- [ ] T012 Copilot `mcpContext` via `metadata.getContextAttribution()`; fake SDK test (entries, unknown kinds, `null`, missing method) [FR-001]
- [ ] T013 Claude Code `mcpContext` via `get_context_usage` `summary`; fake CLI test (grouping, `isLoaded`, normalised names, bounds, timeout) [FR-001]
- [ ] T014 Codex `mcpContext` from `mcpServerStatus/list` schemas and the estimator; fake app-server test; schemas not retained [FR-001, FR-004]
- [ ] T015 `agents:mcpContext` IPC, push after switch/restart/model change, once-a-minute limit, masking; allow list and `test-ipcchannels` [FR-003, FR-004, FR-040]
- [ ] T016 Chip text, dialog row figures and footnote, token summary bar [FR-010, FR-011, FR-013]
- [ ] T017 Simulator fixtures per app and a driver with screenshots at 1440x900 and 1280x800 [FR-045]

## Phase 2: warn (US2-US4)

- [ ] T020 Settings levels (warn, strong, off), validation 5-90 % [FR-020]
- [ ] T021 Chip level colour with words in name and tooltip [FR-021]
- [ ] T022 Warning line with heaviest servers and actions, dismiss per session, partial and unknown rules [FR-022, FR-023, FR-024]
- [ ] T023 Compaction burst hint on the folded compaction line [FR-030]
- [ ] T024 Simulator scenarios: 10/20/35 %, 1M window, failed server, deferred tools, compaction burst; mutation-check the level rules [FR-020..FR-030]

## Phase 3: docs and checks

- [ ] T030 README (*MCP servers*, *Known limits*), changelog fragment, specs index, dated pointers in 005, 058, 069 [FR-044]
- [ ] T031 Optional real check with the owner's OK (reads only, expected 0 credits): one session per app with two servers [FR-042]

# Tasks 100: MCP context cost and warning

## Phase 0: spec

- [x] T001 Research (Copilot SDK types, Claude Code CLI strings and docs, Codex generated schema), spec, plan, tasks; open questions Q1-Q6
- [x] T002 Owner answers Q1-Q6 (2026-10-31, Telegram 11:25 UTC); recorded under *Clarifications*, FRs adjusted

## Phase 1: measure and show (US1)

- [x] T010 `src/shared/mcpcost.ts` estimator and helpers; `scripts/test-mcp-cost.ts` (`test:mcpcost`, in `test:serial`): fixtures incl. a 500-tool server, non-ASCII, missing schema, NaN/negative/huge numbers [FR-002]
- [x] T011 `McpContextReport`, `mcpContext?` and capability in `src/adapters/types.ts` [FR-001, FR-043]
- [x] T012 **Priority, first (the owner's case is Copilot)**: Copilot `mcpContext` via `metadata.getContextAttribution()`; fake SDK test (entries, unknown kinds, `null`, missing method: shows "not reported by Copilot", no estimate) [FR-001, FR-024]
- [x] T013 Claude Code `mcpContext` via `get_context_usage` `summary`; fake CLI test (grouping, `isLoaded`, normalised names, bounds, timeout) [FR-001]
- [x] T014 Codex `mcpContext` from `mcpServerStatus/list` schemas and the estimator; fake app-server test; schemas not retained [FR-001, FR-004]
- [x] T015 `agents:mcpContext` IPC, push after switch/restart/model change, once-a-minute limit, masking; allow list and `test-ipcchannels` [FR-003, FR-004, FR-040]
- [x] T016 Chip text, dialog row figures and footnote, token summary bar [FR-010, FR-011, FR-013]
- [x] T017 Simulator fixtures per app (Copilot first: 200k window, MCP over 30 %, the owner's case, and a Copilot "not reported" fixture) and a driver with screenshots at 1440x900 and 1280x800 [FR-045]

## Phase 2: warn (US2-US4)

- [x] T020 Settings levels (warn, strong, off), validation 5-90 % [FR-020, also FR-012, which had no task: the last figures per server, spec *Changes* 2026-10-31]
- [x] T021 Chip level colour with words in name and tooltip [FR-021]
- [x] T022 Warning line with heaviest servers and actions, dismiss per session, partial and unknown rules [FR-022, FR-023, FR-024]
- [x] T023 Compaction burst hint on the folded compaction line [FR-030]
- [x] T024 Simulator scenarios: 10/20/35 %, 1M window, failed server, deferred tools, compaction burst; mutation-check the level rules [FR-020..FR-030]

## Phase 3: docs and checks

- [x] T030 README (one line since FR-065 of spec 021), docs/features.md (*MCP servers*), docs/limits.md (*Known limits*), changelog fragment, specs index, dated pointers in 005, 058, 069 [FR-044]
- [ ] T031 `[KNOWN GAP]` `real:` to do. Optional real check with the owner's OK (reads only, expected 0 credits): one session per app with two servers. Also settles: whether `getContextAttribution` during a turn disturbs it, whether Copilot's `mcpServer` tokens hold their children's, Claude Code's unloaded-tool `tokens`, Copilot's `null` before initialising and the re-ask (spec *Changes* 2026-10-31) [FR-042]
- [ ] T032 Follow-up spec 069 delta (own PR, small): "Turn off for this folder" for global servers, a per-folder off list fed into `forSession`; then link it from the warning line's actions [decided Q6]

# Tasks 069: global MCP servers, controls and tools

## Part 1: add to global (PR 1)

- [ ] T001 Research and spec (this folder); owner questions Q1-Q6 with defaults; split posted on #349 and #364
- [ ] T002 `src/main/mcpglobal.ts`: file paths per app, readers (JSON, Codex TOML), entry builders with reference/plain secrets, add/remove editors with refusals [FR-001..FR-004]
- [ ] T003 `src/main/mcpglobalio.ts`: safe read, backup next to the file (keep 3), tmp + rename, hash check, preview tokens [FR-005, FR-006]
- [ ] T004 IPC `mcp:globalState`, `mcp:globalPreview`, `mcp:globalApply`, `mcp:globalRemovePreview`, `mcp:globalRemoveApply`; preload, api types, channel list [FR-005, FR-008]
- [ ] T005 Claude user list into Claude agents' start options, Settings switch; `sources` on `agents:mcp` [FR-009, FR-011]
- [ ] T006 Renderer: *Add to* choice, app ticks or single choice, secret mode, per-file confirmation; Settings global list with source chips and Remove [FR-007, FR-008, FR-010, FR-011]
- [ ] T007 Simulator bridge and fixtures [FR-040]
- [ ] T008 Unit tests `test-mcp-global` [FR-041]
- [ ] T009 Driver and screenshots (form, confirmation, Settings list) at 1440x900 and 1280x800 [FR-042]
- [ ] T010 README *MCP servers*, CHANGELOG, specs index, 019/020 dated notes, agent-notes

## Part 2: harmonize (PR 2)

- [ ] T020 `mcp:globalDiff` and copy preview reusing the part 1 pipeline [FR-020, FR-021]
- [ ] T021 Settings *Harmonize (N)* section; hidden with one app [FR-021, FR-022]
- [ ] T022 Tests, simulator, screenshots, docs

## Part 3: controls and tools (PR 3, after #473)

- [ ] T030 `listMcpTools` + `mcpTools` capability: Copilot `rpc.mcp.listTools`, Claude `mcp_status` tools, Codex `mcpServerStatus/list` tools; fake adapter; contract lines [FR-031]
- [ ] T031 `agents:mcpTools` with limits, timeout and masking [FR-032]
- [ ] T032 Agent dialog: expand row with tools; Start/Stop, Remove, *managed by* words; Sign in placeholder wired to spec 058 when `canSignIn` exists [FR-030, FR-033]
- [ ] T033 Tests (fake SDK, fake CLI, fake app-server), simulator tools, screenshots, docs

## Real check (needs the owner's go-ahead)

- [ ] T060 In a scratch home: add a server globally to the three apps, then `copilot`, `claude mcp list`, `codex mcp list` read it (no prompt, 0 credits); check Copilot `${NAME}` (Q6) [FR-050, FR-051]

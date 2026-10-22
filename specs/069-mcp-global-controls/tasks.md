# Tasks 069: global MCP servers, controls and tools

## Part 1: add to global (PR 1)

- [x] T001 Research and spec (this folder); owner questions Q1-Q6 with defaults; split posted on #349 and #364
- [x] T002 `src/main/mcpglobal.ts`: file paths per app, readers (JSON, Codex TOML), entry builders with reference/plain secrets, add/remove editors with refusals [FR-001..FR-004]
- [x] T003 `src/main/mcpglobalio.ts`: safe read, backup next to the file (keep 3), tmp + rename, hash check, preview tokens [FR-005, FR-006]
- [x] T004 IPC `mcp:globalState`, `mcp:globalPreview`, `mcp:globalApply`, `mcp:globalRemovePreview`, `mcp:globalRemoveApply`; preload, api types, channel list [FR-005, FR-008]
- [x] T005 Claude user list into Claude agents' start options, Settings switch; `sources` on `agents:mcp` [FR-009, FR-011]
- [x] T006 Renderer: *Add to* choice, app ticks or single choice, secret mode, per-file confirmation; Settings global list with source chips and Remove [FR-007, FR-008, FR-010, FR-011]
- [x] T007 Simulator bridge and fixtures [FR-040]
- [x] T008 Unit tests `test-mcp-global` [FR-041]
- [x] T009 Driver and screenshots (form, confirmation, Settings list) at 1440x900 and 1280x800 [FR-042]
- [x] T010 README *MCP servers*, CHANGELOG, specs index, 019/020 dated notes, agent-notes

- [x] T065 Review on #489 (Paco's agent, change 2026-10-22): owner-only writes (0600, stricter kept; Windows: same-folder temp + rename), hash re-check before the rename, surgical JSON edit keeping every other byte, backup bytes asserted, Copilot `${NAME}` note in the review, FR-004 aligned (`env_http_headers` for `Authorization`), Claude `--mcp-config` through a 0600 temp file, restore-is-manual in docs; mutation-checked [FR-003, FR-004, FR-006, FR-009, FR-051]

## Part 2: harmonize (PR 2)

- [x] T020 `mcp:globalDiff` and copy preview reusing the part 1 pipeline [FR-020, FR-021]
- [x] T021 Settings *Harmonize (N)* section; hidden with one app [FR-021, FR-022]
- [x] T022 Tests, simulator, screenshots, docs

## Part 3: controls and tools (PR 3, after #473)

- [x] T030 `listMcpTools` + `mcpTools` capability: Copilot `rpc.mcp.listTools`, Claude `mcp_status` tools, Codex `mcpServerStatus/list` tools; fake adapter; contract lines [FR-031]
- [x] T031 `agents:mcpTools` with limits, timeout and masking [FR-032]
- [x] T032 Agent dialog: expand row with tools; the switch named for this session, Remove, *managed by* words; Sign in placeholder wired to spec 058 when `canSignIn` exists [FR-030, FR-033]
- [x] T033 Tests (fake SDK, fake CLI, fake app-server), simulator tools, screenshots, docs
- [x] T034 Merge with spec 058's MCP words (#538): one row and one repaint path (058's), 058's state words, hints and Details/Copy, the switch named "Switch off/on ... in this session", sim tools follow the row's state; driver and screenshots updated [FR-030, FR-033; delta 2026-10-22]
- [x] T067 Review on #499 (Paco's agent, change 2026-10-22): Remove offers every source (app lists + folder extra) in one picker; switch label by session state with FR-066's words and a true footer; Codex `listMcpTools` pages through `mcpServerStatus/list` [FR-030, FR-031]
- [x] T068 Re-review on #499 (Paco's agent, change 2026-10-22): test the repeated-cursor stop of Codex `listMcpTools`; the folder copy in the combined Remove picker is deleted only after the review is confirmed, and its row says its stored secret values are deleted; mutation-checked (dropping `next === cursor` fails `test:codexadapter`; removing the folder copy before the review fails `shots-069-mcp-tools`) [FR-030, FR-031]

## Real check (needs the owner's go-ahead)

- [x] T060 In a scratch home: add a server globally to the three apps, then `copilot`, `claude mcp list`, `codex mcp list` read it (no prompt, 0 credits); check Copilot `${NAME}` (Q6) [FR-050, FR-051]. `real:` 2026-10-22, Copilot CLI 1.0.101, Claude Code 2.1.304, codex-cli 0.163.0: all three list the written stdio and http entries and no longer list them after Remove; backups (last 3), rename write, refusal of a changed file, unknown keys and Codex bytes kept; Claude Code and Codex pass the referenced variable's value; Copilot `${NAME}` expansion not observable without a signed-in session (FR-051 stays a gap for Copilot). Found T061.
- [x] T061 Codex `config.toml` that does not parse is refused with its line number (change 2026-10-22; found by T060) [FR-003]; tests in `test:mcpglobal`, verdicts matched against codex-cli 0.163.0
- [x] T062 Review on #489 (change 2026-10-22): write through a symlinked file; one-pass TOML unescape shared with spec 061 (`codextoml.ts`); `copilotDir` reused; FR-009 wiring tested through `registerMcpIpc` [FR-002, FR-006, FR-009, FR-041]
- [x] T063 Review on #492 (change 2026-10-22): mask command, arguments and URL in the copy review; keep or refuse `enabled = false`, `disabled_tools`, tool lists and JSON `cwd` in copies; diff names tools and on/off [FR-012, FR-020, FR-023, SC-002]
- [x] T066 Second review on #492 (Paco's agent, change 2026-10-22): copies refuse unknown fields and non-string values (named), Codex `env` numbers and multi-line strings not copyable, copy into a 0644 file leaves it 0600 (via T065), copy review wording; mutation-checked [FR-006, FR-023]

# Plan: 019 MCP servers, tool usage, context window

## Backend
- `src/shared/mcp.ts` (pure, no Electron/SDK): types (`McpServerDef`, `McpServerView`, `McpImportCandidate`, ...), `validateServer`, `trustHash`, name rules.
- `src/shared/mcpimport.ts` (pure): `parseCopilotMcp(text)`, `parseVsCodeMcp(text)` -> candidates + warnings. No file access.
- `src/main/mcpstore.ts`: `McpStore(file, codec)`; `codec = { available(): boolean; encrypt(s): string; decrypt(s): string }` (Electron `safeStorage` in `main.ts`, a fake in tests, so the module imports no Electron). JSON file `durbar-mcp.json` in userData: servers (non-secret fields, `enc` blobs for secrets), `disabledAmbient[]`. Views mask secrets. `forSession(overrides)` -> `{ mcpServers, disabledMcpServers }`. Memory-only secrets when no codec.
- `src/adapters/types.ts`: `McpServerSpec`, `StartOptions.mcpServers/disabledMcpServers`, `ToolCallEvent.mcpServer/mcpTool`, `ContextEvent`, `McpStatusEvent`; `AgentAdapter.setMcpEnabled?`.
- `src/adapters/map.ts`: MCP fields on tool events, `session.usage_info` -> `context`, `session.mcp_servers_loaded` / `session.mcp_server_status_changed` -> `mcp`.
- `src/adapters/copilot.ts`: pass `mcpServers` / `disabledMcpServers` on create/resume (never logged), `setMcpEnabled` via `session.rpc.mcp.enable/disable`, `ModelOption.contextWindow`.
- `src/main/mcpfiles.ts` (read-only access to `~/.copilot/mcp-config.json`, VS Code `mcp.json`, built-in server names; `DURBAR_COPILOT_DIR` override for tests) and `src/main/mcpipc.ts` (IPC handlers, safeStorage codec, per-agent override map, live status map, `optionsFor(agentId)`).
- `src/main/main.ts` + `preload.ts` + `shared/api.ts`: IPC `mcp:*` (list, upsert, remove, setEnabled(trustAck), import preview/apply, ambient list/toggle), `agents:mcpOverride`; `startOptionsFor` adds MCP options.
## Renderer
- `src/renderer/toolstats.js` (pure UMD, like roomsummary.js): `createStats()`, `record(agentId, event)`, `byTool(scope)`, `byAgent()`, `ctxPercent`.
- `src/renderer/screens.js` (+ `screens.css`): one module for the Settings screen (MCP list, form, trust and import dialogs), the Tools view (tabs Tool usage / Models & context), the per-agent MCP dialog and the context chip. Built as a second plain-JS module next to `app.js` (`window.DurbarScreens`), initialised with a small context object from `app.js`.
- `app.js`: small hooks only (top-bar buttons, live events feed stats, chat header buttons). `styles.css`: new sections. `sim.ts`: scenarios + in-memory MCP bridge.
## Permissions
`src/adapters/permissions.ts`: the summary and the session-grant key of an `mcp` permission now include the server name (summary `mcp server › tool`, grant key `mcp:server/tool`), so a grant for one server's tool never covers another server's tool of the same name.
## Tests
`scripts/test-mcp.ts` (store, import, validate), `scripts/test-toolstats.ts`, extra cases in `test-events.ts` with fixtures `scripts/fixtures/events/mcp-tool-usage.json` (sanitised real events from the research probe), `scripts/fixtures/mcp/*.json`.
## Docs
README milestone 8, specs index. Screenshots: `scripts/shots-m8.js` (simulator, xvfb).

## Superseded in part by 020
`mcpstore.ts` is now per folder, `mcpfiles.ts` reads the CLI list live (`cliServers`), the import IPC and screens are removed, and `shots-m8.js` became `shots-m10.js`; see [020 plan](../020-tools-all-time-and-mcp-cli-primary/plan.md).

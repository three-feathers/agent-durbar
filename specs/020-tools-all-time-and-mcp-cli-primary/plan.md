# Plan: 020 Tools all-time and MCP CLI list first

## Shared (pure)
- `src/shared/toolusage.ts`: `UsageDoc` type, `emptyDoc()`, `sanitizeDoc(unknown)`, `recordEvent(doc, agentLabel, ev)` (start/failed rules, caps, only names), `viewRows(doc, scopeLabel)` (rows + groups like `toolstats.js`), `resetDoc`. No Node/Electron imports so the simulator can use it too.
## Main
- `src/main/usagestore.ts`: `UsageStore(file)`: `load()`, `record(label, ev)` (marks dirty, debounced `save()` 2 s with an injectable timer), `flush()`, `reset()`, `view()`. Atomic write (tmp + rename). Wired in `main.ts`: adapter events -> `record` for `toolCall` (label from `AgentInfo`), `before-quit` -> `flush`. IPC `usage:allTime`, `usage:reset`.
- `src/main/mcpstore.ts`: records keyed by folder: `folders: Record<key, Rec[]>`, `legacy: Rec[]`; `list(key)`, `upsert(key, input, orig, reservedNames)`, `remove(key,name)`, `setEnabled(key,...)`, `legacyList()`, `moveLegacy(name,key)`, `removeLegacy(name)`, `forSession(key, agentDisabled)`; disabled CLI names stay global. File version 2; version 1 `servers` -> `legacy`.
- `src/main/mcpfiles.ts`: `cliServers(dir, disabled)` (was `ambientServers`) also returns `{found, error, skipped}`; the VS Code import helpers go away.
- `src/main/mcpipc.ts`: `mcp:state` (CLI list), `mcp:folderState(key)`, folder-keyed `upsert/remove/setEnabled`, `moveLegacy`, `removeLegacy`; `agents:mcp` merges CLI + extras of the agent's key + runtime; `optionsFor(agentId)` uses the agent's key (`workspaceFile || cwd`). `mcp:importPreview/Apply` removed.
- `src/shared/api.ts` + `preload.ts`: new/changed bridge methods; `McpState`, `McpFolderState`, `UsageView`.
## Renderer
- `screens.js`: Tools gets the period switch and all-time rendering and the "Configured MCP servers" section; Settings shows the CLI list first, no add/import; new folder extras dialog (reuses the server form) opened by `DurbarScreens.folderMcp(room)`; agent MCP dialog labels + "Folder extras...".
- `app.js`: room header MCP button (`data-mcp-room`), passes the folder key. `styles.css`/`screens.css` small additions.
- `sim.ts`: in-memory all-time store (seeded), per-folder extras fake, CLI list fake, legacy fake.
## Tests / docs
`scripts/test-toolusage.ts`, `scripts/test-mcp.ts` (rewritten for folders), `scripts/test-usagestore.ts`; screenshots driver `scripts/shots-m10.js`; README milestone 10; spec 019 gets a pointer + `## Changes`; specs index.

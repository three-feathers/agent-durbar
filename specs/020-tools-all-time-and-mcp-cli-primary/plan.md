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

## Delta 2026-10-17: per-folder VS Code import (issue #7)
Constitution Check: I (this delta, plan and tasks come before `src/`), III (reads a file in the user's own folder, size-capped, never executed; secrets only into the existing secret store, masked everywhere else; path derived in main, never from the renderer), IV (no credits: unit tests and simulator), V (preview dialog scrolls inside itself, text >= 10.5px, no overlap), VI (`path` only; folder paths of the agents), VII (tests in `scripts/`, screenshots at both sizes), VIII (limits in the spec). No new dependency.
- `src/shared/mcpimport.ts` (pure): add `stripJsonc(text)` (comments, trailing commas, BOM, strings respected), `parseVSCodeMcp(text, {workspaceFolder})` returning candidates with `notes`, `ignored`, `blocked` (reason) and `inputs` ids; reuse `NAME_RE`/`validateInput` rules (export the env/header key regexes from `mcp.ts`). `parseMcpConfig(text)` (no `kind` any more) keeps strict JSON for the CLI list only; the VS Code file goes through `parseVSCodeMcp`. `candidateInput(c)` builds the add-form input so the store validates and stores an import exactly like a typed server.
- `src/main/mcpimport.ts` (no Electron; testable): `previewFolderImport(dirs, existing, reserved)` builds the renderer-safe preview (keys + masked flags, digest, per-folder source) and `applyFolderImport(store, key, dirs, ids, digest, reserved)` re-reads, checks the digest, and calls `McpStore.upsert` (so enabled=false, no trust). Reads use `readSmallFile` (1 MiB cap).
- `src/main/mcpipc.ts`: `mcp:importPreview(key)` and `mcp:importApply(key, ids, digest)`; folders from `AgentInfo.folders` (max 8, deduped) of agents with that key; key checked with `knownKey`.
- `src/shared/api.ts` + `preload.ts`: `McpImportPreview`, `McpImportItem`, `McpImportResult`; bridge `mcpImportPreview`, `mcpImportApply`.
- `screens.js`: button *Import from VS Code...* in the folder extras screen, preview dialog (checkboxes, select all, masked keys, notes, disabled reasons), result toast, repaint. `screens.css`: small additions.
- `sim.ts`: fake preview with a realistic file (stdio, http with masked header, one blocked `${input:...}` entry, ignored fields, one already added) and fake apply into the in-memory extras.
- Tests `scripts/test-mcp.ts` §9, fixtures `scripts/fixtures/mcp/vscode-mcp.jsonc`; driver `scripts/shots-i7.js`.

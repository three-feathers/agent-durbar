# Research 100: how much of the context window MCP tool definitions take, per agent app

**Date**: 2026-10-31. **No credits spent**: no session was started. Sources are the repo, the SDK types in `node_modules`, the local
CLI binaries (`strings`, `codex app-server generate-json-schema`, which needs no network and no turn) and official docs. Every finding
here is `read:`; none was run on a real account.

## 1. What Durbar does with MCP today

- Durbar does **not** run MCP clients for the agent's servers. The agent app (Copilot SDK runtime, Claude Code CLI, Codex app-server)
  starts them; Durbar passes which ones to use (spec 019 FR-007, spec 020, spec 058 *Summary*, spec 069). `src/main/mcp/` is Durbar's
  *own* MCP server (spec 041), not a client.
- Server lists: the Copilot CLI list, the Claude Code and Codex user lists (spec 069), folder extras (`src/main/mcpstore.ts`, per
  folder, with trust), ambient servers switched off **globally** (`disabledAmbient`), per-agent switches in memory (spec 019 FR-009,
  `agents:setMcp`). Single tools off per folder (`toolsOff`, spec 069 FR-061). There is **no per-folder off** for a server that is
  not a folder extra.
- A server's tools: `AgentAdapter.listMcpTools?` behind `agents:mcpTools` (spec 069 FR-031/FR-032), only while the session runs:
  - Copilot `session.rpc.mcp.listTools({serverName})` returns `{name, description?, ui?}`: **no input schema**.
  - Claude Code `mcp_status` reply: tool names (the documented `McpServerStatus.tools`).
  - Codex `mcpServerStatus/list {detail: "toolsAndAuthOnly"}` returns `Tool = {name, title?, description?, inputSchema, ...}`: the
    **full schema** (`v2/ListMcpServerStatusResponse.json`, codex-cli 0.163.0).
- The context ring (spec 005 FR-051, `src/renderer/ctxbreakdown.js`, `toolstats.js` `setContext`/`ctxLevel`) shows tokens of the
  window, green below 70 %, amber 70-90 %, red above 90 %, and bars for the parts the adapter reports (`system`, `toolDefinitions`,
  `conversation` from `ContextEvent`). Nothing is estimated there: "Breakdown not reported by <app>.".
- Compactions: `CompactionEvent` (spec 030, spec 015) from all three adapters; the renderer folds a run of them into one line
  ("Context compacted 4 times · last 10:21", spec 052 FR-163) and counts `a.compactions` per agent (`app.js` `onCompaction`).
- The chat header MCP chip: `mcpChipHTML` (`app.js`), "MCP" plus `on/total`, a failure dot.

## 2. Copilot SDK 1.0.22 (bundled runtime 1.0.98)

- **Exact, per server**: `session.rpc.metadata.getContextAttribution()` (`@experimental`, `rpc.d.ts` ~34670): "per-source attribution
  breakdown of the session's current context window as a flat list of entries (skills, subagents, MCP servers, built-in tools ...)
  plus the successful compaction count". Entries `{kind, id, label, tokens, parentId?, attributes?}`, `kind` includes `mcpServer`
  ("not a closed set"); `categories.mcpTools` = "MCP tool-definition tokens"; `limit` = "the denominator for context-usage
  displays"; `compactionThreshold`; `compactions.count`. Returns `null` until the session has initialised.
- `session.rpc.metadata.contextInfo(...)` returns `SessionContextInfo` with `mcpToolsTokens` ("subset of toolDefinitionsTokens,
  excludes deferred tools") and `toolDefinitionsTokens`.
- The `session.usage_info` event (mapped today in `src/adapters/map.ts`) carries `toolDefinitionsTokens` but **not** the MCP part.
- **Deferred tools**: server config `deferTools: "auto" | "never"` ("loaded on demand via tool search (auto) or always included");
  the token counts exclude deferred tools, so the attribution measures what is really in the window.
- Compaction: `session.compaction_start` / `session.compaction_complete` (`trigger`, `preCompactionTokens`, `postCompactionTokens`,
  `tokenLimit`), already mapped.

## 3. Claude Code 2.1.309 (local binary) and docs

- **Exact or app-estimated, per tool and server**: control request `get_context_usage` (CLI strings: "Requests a breakdown of current
  context window usage by category"; `detail: "summary" | "full"`). Reply fields include `categories[]`, `totalTokens`, `maxTokens`,
  `rawMaxTokens`, `model`, `mcpTools: [{name, serverName, tokens, isLoaded?}]`, `mcpInstructions?: [{serverName, tokens}]` (each
  server's share "estimated from the length of its text"), `autoCompactThreshold?`, `isAutoCompactEnabled`. Agent SDK docs
  (`getContextUsage()`): "`mcpTools` and `agents` attribute tokens to individual MCP tools", "`maxTokens` is the window that usage is
  measured against. That window is the model's context window, or the lower auto-compaction window when one applies."
- `detail`: "'full' counts each category with the token-count API; 'summary' answers from the last response's usage and local
  estimates without the per-category token-count calls. Defaults to 'full'." Token counting is "free to use but subject to requests
  per minute rate limits" and "an estimate" (platform.claude.com token-counting docs). It spends no credits but makes network requests.
- **Tool search** (code.claude.com/docs/en/mcp, *Scale with MCP tool search*): "Tool search is enabled by default: MCP tools are
  deferred and discovered on demand." Off when `ENABLE_TOOL_SEARCH=false`, under `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`, for HIPAA
  sessions, on earlier models, on Azure Foundry, or when `ToolSearch` is denied or left out of `--tools`; a server with
  `alwaysLoad: true` loads upfront. `auto` mode: tools load upfront while under 10 % of the window. So on Claude Code the MCP cost is
  usually small, **unless** tool search is off; `mcpTools[].isLoaded` says which case applies. Durbar's Claude adapter does not deny
  `ToolSearch` (`claudeModes.ts`, `claude.ts` allows it in plan turns).
- The window per model: `result.modelUsage[model].contextWindow` (mapped in `claudeMap.ts` `windows`), e.g. 200k or 1M.
- Compaction: `system/compact_boundary` with `compact_metadata {trigger: "manual"|"auto", pre_tokens, post_tokens?}`, mapped.
- The stream-json `system/init` lists `tools` and `mcp_servers` (names and status), not token sizes.

## 4. Codex app-server (codex-cli 0.163.0, generated schema)

- No per-category context report. `thread/tokenUsage/updated` gives `last.inputTokens` and `modelContextWindow` (mapped to
  `ContextEvent` in `codexMap.ts`).
- MCP tools with full `inputSchema` via `mcpServerStatus/list` (already used by spec 069). So Durbar can **estimate** each server's
  cost from the definitions, and cannot measure it.
- `ToolExposureSurface` has `direct` and `deferred` ("Tools discovered later through tool search"); it appears in the config of
  connectors (`omit_tools_from`), not in the MCP server status. Whether Codex defers MCP server tools is **unknown** (`[KNOWN GAP]`).
- Compaction: the `contextCompaction` item (mapped, trigger unknown); `thread/compacted` is deprecated.

## 5. Estimating locally

- No tokenizer is a dependency (`package.json`), and this spec adds none. Estimate = `ceil(chars / 4)` of the tool name, description
  and `JSON.stringify(inputSchema)`, plus a fixed per-tool overhead. This is a rough figure: tokenizers differ per model (the
  Anthropic docs warn that counts measured on a model before Claude Opus 4.7 should not be reused), and schemas tokenize differently
  from prose. It is always labelled "estimated" and "≈".
- With Copilot's `listTools` (no schema) a local estimate would undercount badly; it is used only when the attribution call fails,
  and labelled "at least".

## 6. Compaction rate

All three adapters emit `compaction` `complete` events with a time, so Durbar can count compactions per session in a sliding window
(renderer, in memory). Copilot also returns `compactions.count` for the whole session. The owner's case (around 200 compactions in a
session with a 200k window, most of it MCP tool definitions) shows as many completes in a short time while the MCP share is high.

## Unverified

- None of the calls above was made on a real account; field names are from types, schemas and CLI strings.
- Whether `getContextAttribution` is enabled on every Copilot plan (it is `@experimental`).
- Whether `get_context_usage` with `detail: "summary"` gives per-tool `mcpTools` figures before the first response.
- Which agent app the owner used for the 200k Opus session (Copilot's Claude Opus or Claude Code), and whether tool search was on.

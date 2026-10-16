# Research: 019 MCP servers, tool usage, context window

Checked 2026-10-16 against `@github/copilot-sdk` 1.0.22 (types in `node_modules/@github/copilot-sdk/dist`), Copilot CLI runtime 1.0.98,
the GitHub docs for the CLI (`docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers`, CLI config-dir and
command references) and a throw-away probe against the real runtime on the logged-in account (box, outside the repo).
**Probe cost: 1 real prompt (2 model calls), 0.167 AIU** (`auto`, efficiency tier). Everything else was session creation and RPC reads, which use no credits.

Legend: **confirmed** = observed on the real runtime; **types** = only in the SDK type declarations or docs, not exercised; **unclear** = could not be established.

## MCP servers per session

| Question | Answer | Status |
| --- | --- | --- |
| Can a session get MCP servers from the host? | `createSession` / `resumeSession` accept `mcpServers: Record<name, MCPServerConfig>`. A stdio server (`{type:'stdio', command, args, env, workingDirectory, tools, timeout}`) connected and its tool was callable. | confirmed |
| Remote servers | `{type:'http'\|'sse', url, headers, tools, timeout}` | types (no remote server available to test) |
| Does the runtime also read `~/.copilot/mcp-config.json`? | **Yes, always.** A session created with no `mcpServers` and without `enableConfigDiscovery` still started the servers of that file (`configSource: "user"`). | confirmed |
| Built-in servers | `github-mcp-server` (`source: "builtin"`) is connected in every session (seen in `session.mcp_servers_loaded`). | confirmed |
| Same name in `mcpServers` and the user file | The inline entry wins (a broken inline command made the server `failed` although the file entry was fine). | confirmed |
| Disable a server for one new session | `disabledMcpServers: ['name']` on create/resume: status becomes `disabled`, nothing is started. Works for user-file and (by name) built-in servers. | confirmed (user file); built-in: types |
| Change a running session | `session.rpc.mcp.disable({serverName})` / `.enable(...)` took effect live (`disabled` / `connected`) and did **not** write anything to `~/.copilot`. `mcp.list()` and `mcp.listTools({serverName})` list status and tools. | confirmed |
| Tool allow/deny | `availableTools` / `excludedTools` (also `ToolSet`), patterns `mcp:*`, `mcp:<server>-<tool>`, bare names; deny wins. Per-server `tools: ['*' \| names]` in the server config. The runtime tool name is `<server>-<tool>`. | types + README; enforcement not exercised |
| Permission kind | Request `kind: "mcp"` with `serverName`, `toolName`, `args`, `readOnly`. In our one run a tool annotated `readOnlyHint: true` ran **without** calling `onPermissionRequest`; a non-read-only MCP tool was not tested. | types; read-only case confirmed, other **unclear** |
| OAuth / auth | Status `needs-auth` and `onMcpAuthRequest` exist. Not handled in this feature; such servers show "needs auth". | types |
| Secrets | The CLI itself keeps MCP env/headers as plain JSON in `mcp-config.json` (plus `mcp-secrets/` for placeholders). The SDK takes plain strings in `env` / `headers`. | docs |

## Tool events (for usage counts)

`tool.execution_start` carries `toolName` (`echo-echo` for an MCP tool, `bash`, `view`, `task`, ... for built-ins) and, for MCP tools,
`mcpServerName`, `mcpConfigServerName`, `mcpToolName`, `mcpTransport`, `mcpConfigSource` (**confirmed**). `assistant.message.toolRequests[]` carries
`mcpServerName` / `mcpToolName` too (types). Sub-agent events carry `agentId`.

## Context window

| Question | Answer | Status |
| --- | --- | --- |
| Does `listModels` give a context window? | `capabilities.limits.max_context_window_tokens` (plus optional `max_prompt_tokens`, `max_output_tokens`) exists in the type. On this account the only model is `auto` and it reports **`0`** (unknown). | confirmed (0 for `auto`); other models **unclear** (not on this account) |
| Is usage reported while a session runs? | Yes: ephemeral `session.usage_info` `{tokenLimit, currentTokens, messagesLength, systemTokens, conversationTokens, toolDefinitionsTokens, isInitial}`, emitted before each model call. Real values: `tokenLimit 272000`, `currentTokens 13557` then `13602` (resolved model `gpt-6-luna` under `auto`). Sub-agent events carry `agentId`. | confirmed |
| Also | `assistant.usage.maxPromptTokens` (272000) and `model` / `modelDisplayName` per call; `session.compaction_start/complete` carry `tokenLimit` and token counts (types); `session.rpc.metadata.contextInfo({promptTokenLimit:0, outputTokenLimit:0})` returns `{modelName, systemTokens, conversationTokens, toolDefinitionsTokens, mcpToolsTokens, totalTokens, promptTokenLimit, limit, compactionThreshold}` **after** the first turn (`null` before: confirmed). | confirmed |
| Before the first message | Nothing: `usage_info` starts with the first model call, `listModels` says 0 for `auto`. So "unknown" until the first turn. | confirmed |
| Under `auto` | The model that answers is only known from `assistant.usage.model` / `session.auto_mode_resolved`; the window is the resolved model's. | confirmed |
| Long-context tier | `contextTier: 'long_context'` session option exists. Not used. | types |

## Decisions that follow

1. The runtime already loads `~/.copilot/mcp-config.json` and the built-in GitHub server in every session, so Durbar's global config is **additive**: its own servers go in `mcpServers`; ambient ones are shown read-only and can be switched off with `disabledMcpServers`.
2. Per-agent overrides use `disabledMcpServers` at (re)start and `session.rpc.mcp.enable/disable` on a live session. Overrides are per agent id and per run (agent ids of restored folders change on each start).
3. Tool counts come from `toolCall` `start` events; MCP attribution from the new `mcpServer` / `mcpTool` fields.
4. Context comes from `session.usage_info`; a model's static window from `listModels` only when it is greater than 0; otherwise "unknown".
5. Secrets (env values, header values) are held only by the main process; the renderer sees key names and "set". Persisted only through Electron `safeStorage`; when it is unavailable they are kept in memory for the run and the UI says so.

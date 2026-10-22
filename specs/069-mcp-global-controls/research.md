# Research: 069 global MCP servers, controls and tools

Evidence tags: `read:` source, docs or program strings; `real:` run and seen. Nothing here started a model turn.

## 1. What exists (2026-10-21, `main` at a6adee97)

| Capability | Where | Notes |
| --- | --- | --- |
| Copilot CLI list (read-only, every Copilot agent) | `src/main/mcpfiles.ts` `cliServers`, `copilotDir` | Re-read on each screen open; the Settings switch only adds the name to `disabledMcpServers` for new sessions. |
| Folder extras (Durbar's own, per folder, trust prompt, secrets in one vault) | `src/main/mcpstore.ts`, `src/main/mcpipc.ts`, `src/renderer/screens.js` `paintFolder` / `editServer` | Spec 020; the add form is `editServer`. |
| Old app-level list (`legacy`) | `McpStore.legacyRecs` | Milestone 8's global list, kept only to move or remove; never passed to a session. Not reused: the owner chose the apps' own files. |
| Folder's own `.mcp.json` / `.codex/config.toml` (read) | `src/main/foldersetup.ts` (`readCodexMcpToml`) | Spec 061; read-only line-based TOML reader to extend. |
| Per-agent dialog | `screens.js` `agentMcp`, `agents:mcp`, `agents:setMcp` | PR #473 adds Restart, Restart session, `agentMcpReply` in `src/main/mcpsession.ts`. |
| Installed apps | `adapters:list` (`AdapterInfo.state`) | Used for FR-007. |

## 2. How each app's session gets its servers in Durbar

- **Copilot**: the runtime loads `~/.copilot/mcp-config.json` itself; Durbar adds folder extras inline (`read:` spec 019 research).
- **Claude Code**: Durbar always passes `--strict-mcp-config` and `--setting-sources ""` (`src/adapters/claudeModes.ts:104-114`), so the
  user list in `~/.claude.json` is **not** loaded by Durbar's Claude sessions; only `--mcp-config` (folder extras) is. Hence Q1 / FR-009.
- **Codex**: no `CODEX_HOME` override in `src/adapters/codex.ts`, so the app-server reads the user's `~/.codex/config.toml`
  `[mcp_servers.*]`; Durbar adds extras with `config.mcp_servers` per thread.

## 3. File formats

- **Copilot** `~/.copilot/mcp-config.json`: `{"mcpServers": {"<name>": {"type": "local"|"stdio"|"http"|"sse", "command", "args",
  "env", "url", "headers", "tools": ["*"]}}}` (`read:` `src/shared/mcpimport.ts` parser and spec 019 research).
- **Claude Code** user scope: top-level `mcpServers` of `~/.claude.json` (`read:` Claude Code docs *MCP* "user scope"; the CLI 2.1.304
  lists `.claude.json` and `.claude.json.backup` among its own files, `read:` program strings). `CLAUDE_CONFIG_DIR` relocation of that file:
  `read:` the same docs; not checked. `claude mcp add-json <name> <json>` with `-s user` exists (`read:` CLI 2.1.304 help strings) but takes
  the JSON, secret values included, as a process argument (Q4).
- **Codex** `~/.codex/config.toml`: keys of an `[mcp_servers.<name>]` table, `read:` codex-cli 0.163.0 program strings (the `codex mcp get`
  printout): `enabled`, `enabled_tools`, `disabled_tools`, `command`, `args`, `cwd`, `env`, `url`, `bearer_token_env_var`, `http_headers`,
  `env_http_headers`, `http_headers_helper`, `startup_timeout_sec`, `tool_timeout_sec`, `default_tools_approval_mode`; `env_vars` is also
  present in the binary. `CODEX_HOME` defaults to `~/.codex` (`read:` developer docs, agent-notes).

## 4. Tools of a server

- **Copilot SDK 1.0.22**: `session.rpc.mcp.listTools({serverName}) -> {tools: {name, description?, ui?}[]}`, "performs a live
  `tools/list`", "throws when the server is not connected"; also `startServer`, `stopServer`, `restartServer`, `listConfigured`
  (`read:` `node_modules/@github/copilot-sdk/dist/generated/rpc.d.ts` 15682-15730, 33660-33760; all `@experimental`).
- **Claude Code**: `mcpServerStatus()` = control request `mcp_status`, reply `.response.mcpServers` (`read:` CLI 2.1.304 strings); the
  documented `McpServerStatus` has `tools?` (`read:` Agent SDK docs, see spec 058 research section 3).
- **Codex**: `mcpServerStatus/list {threadId?, serverName?, detail?: "full"|"toolsAndAuthOnly"}`; each server has `tools: {[name]: Tool}`,
  `Tool = {name, title?, description?, inputSchema, ...}`, and `toolsError` (`read:` `codex app-server generate-json-schema`,
  `v2/ListMcpServerStatusResponse.json`, `v2/ListMcpServerStatusParams.json`, codex-cli 0.163.0; the schema was generated locally, no
  network, no turn).

## 5. Decisions

- One write pipeline for all three files (preview token, hash check, backup next to the file, tmp + rename), pure editors unit-tested.
- Minimal TOML edit instead of a TOML library: no new dependency, every other byte kept, refusals for shapes the editor does not handle.
- No secret value in a process argument (Q4).

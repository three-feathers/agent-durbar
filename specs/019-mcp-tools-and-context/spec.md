# Feature Specification: Global MCP servers, tool usage view, context window per agent

**Feature Branch**: `019-mcp-tools-and-context` (milestone 8)
**Created**: 2026-10-16
**Status**: Implemented (milestone 8); see research.md for what the SDK does and does not provide
**Input**: Vikram: (1) global-level MCP tools configuration for all agents; (2) show which agents used which tools and how many times; (3) show the model(s) and context window (size and usage) per agent.

## User scenarios

1. **Configure MCP once.** From the top bar, *Settings* opens a global screen (not per agent). It lists MCP servers (stdio command + args + env, or http/sse URL + headers), each with an on/off switch. Add, edit, remove. New sessions start with the enabled servers.
2. **Trust.** Servers run local commands. The first time a server is enabled (and again when its command, args or URL change) a dialog shows the exact command (or URL) and asks for confirmation. Without it the server is not passed to any session.
3. **Import.** "Import" reads `~/.copilot/mcp-config.json` and the VS Code user `mcp.json` (read-only, never written), lists what it found (names, command or URL, env/header *keys* only) and imports the chosen ones after confirmation. Imported servers start **off and untrusted**.
4. **Per agent override.** In an agent's chat header, *MCP* shows the servers that session has (status, source) with a switch each: "use the global default" or off for this agent. On a live session the switch applies at once; otherwise at its next start.
5. **Tools view.** Top bar *Tools* (and *Tools* in an agent's chat header, scoped to that agent) shows a table with small bars: which tools were used how often, built-in tools and MCP tools grouped by server, and which agents used them. A second tab shows, per agent, the model(s) used and the context window (size, used, percent bar) or "unknown".

## Requirements

### Settings and MCP configuration
- **FR-001** A global *Settings* screen (top bar button; `Esc` closes) with an "MCP servers" section. Not per agent.
- **FR-002** Server definition: `name` (letters, digits, `_ . -`, 1-48, unique), `transport` `stdio` | `http` | `sse`; stdio: `command`, `args[]`, `env{}`, optional working directory; http/sse: `url` (`http(s)`), `headers{}`; `enabled`; optional tool filter (`tools`, default all).
- **FR-003** Add, edit, remove, enable/disable. Validation errors are shown in the form; nothing invalid is stored or passed on.
- **FR-004** **Secrets**: env values and header values are secrets. The renderer never receives them: it gets key names and a "set" flag, shown masked (`••••••`). Editing a secret needs a new value; leaving it blank keeps the stored one. They are persisted only encrypted with Electron `safeStorage` (OS keychain / DPAPI / libsecret). If `safeStorage` is unavailable they are **not written to disk**; they live in memory for the run and the UI shows a warning ("not stored: re-enter after restart"). They are never logged, never in `AgentInfo`, never in fixtures or commits. Hint in the form: do not put secrets in args or URL query strings (those are shown and stored in clear).
- **FR-005** **Trust**: enabling a server that is not trusted opens a confirmation showing the command and args (or URL), and the text "MCP servers run local commands with your user rights." Trust is remembered for that exact definition (hash of transport + command + args + URL + working directory); any change of those resets it.
- **FR-006** **Import** (read-only): `~/.copilot/mcp-config.json` (`mcpServers`, or a bare map; `type` `local|stdio|http|sse`) and VS Code user `mcp.json` (`servers`; `${input:...}` / `envFile` are kept as literal text and flagged). A preview with confirmation precedes any import; env/header values are imported into the secret store, never shown; name clashes get a suffix; malformed entries are skipped and counted. Files are never modified.
- **FR-007** **Applied to sessions**: `StartOptions.mcpServers` (enabled + trusted Durbar servers) and `StartOptions.disabledMcpServers` (global list of ambient servers switched off, plus per-agent overrides). Ambient servers (the runtime also loads `~/.copilot/mcp-config.json` and the built-in `github-mcp-server`, see research) are listed read-only in Settings with a switch that adds them to the disabled list.
- **FR-008** Changes apply to **new** sessions and to agents that start (or resume) afterwards; Settings says so. Running sessions are only changed by the per-agent switch (FR-009).
- **FR-009** Per-agent override: tri-state per server (default / off), in memory per agent id; on a live session the adapter calls the runtime enable/disable, otherwise it is part of the next start.
- **FR-010** Permissions are unchanged: MCP calls go through the permission modes (spec 003). Settings states that one tested read-only MCP tool ran without a permission prompt (research), so only enable servers you trust.

### Tool usage
- **FR-011** `ToolCallEvent` gains `mcpServer?` and `mcpTool?` (filled by the mapper from the runtime's MCP fields). A tool is counted on its `start`; `failed` is counted separately.
- **FR-012** Counts per agent (sub-agent calls count for the owning agent) and globally, kept in memory for the run by a pure module (`toolstats.js`, unit-tested). They start at zero for a resumed session (history is not counted).
- **FR-013** *Tools* view: scope = All agents or one agent; rows = tools grouped "Built-in" and "MCP: <server>"; columns tool, calls, bar, failed, used by (top agents with counts). Sort by calls. Empty state explains.
- **FR-014** Reachable from the top bar and from the chat header of every agent (scoped to it). Keyboard accessible, `Esc` closes.

### Models and context window
- **FR-015** New normalized `ContextEvent` (`type: 'context'`: `tokens`, `limit`, optional `system`, `conversation`, `toolDefinitions`, `model`) mapped from `session.usage_info` of the main agent (sub-agent ones are tagged and not used for the agent bar).
- **FR-016** Per agent the *Agents* tab of the Tools view and the chat header show: model name(s) seen (from usage events, with call counts; the chosen model name until the first call), context window size, used tokens, percent bar (calm green < 70%, amber 70-90%, red > 90%) or **"unknown"** when no event and no static limit exist. Static limit: `listModels` `max_context_window_tokens` only when > 0.
- **FR-017** Honest limits are visible in the UI ("Context appears after the first message") and in the README.

### Simulator and tests
- **FR-018** The simulator produces MCP and built-in tool calls (two fake servers), `context` events, MCP status, and a Settings backend in memory with fake secrets handling, so the whole feature is demonstrable without credits.
- **FR-019** Unit tests (no credits): MCP store (validate, secrets masked and never in views, persistence with a fake codec, no-codec fallback, trust reset, resolve for session), import parsers (Copilot and VS Code fixtures), mapper (recorded sanitised events: MCP tool, `usage_info`, MCP status), tool stats aggregation, context percent/colour.
- **FR-020** Screenshots `/workspace/command-center/m8-*.png` at 1440x900 and 1280x800; the office overlap check (spec 001) still passes.

## Out of scope / known gaps
- `[KNOWN GAP]` No MCP OAuth flow (servers that need auth show "needs auth").
- `[KNOWN GAP]` `excludedTools`/`availableTools` per MCP tool is not exposed (per-server on/off only); the runtime supports it (research: types only).
- `[KNOWN GAP]` HTTP/SSE servers: configuration and passing are implemented from the SDK types but not tested against a real remote server.
- `[KNOWN GAP]` Counts are not persisted across app restarts and do not include history of resumed sessions.
- `[KNOWN GAP]` Context for models other than `auto` was not observed (this account only offers `auto`).

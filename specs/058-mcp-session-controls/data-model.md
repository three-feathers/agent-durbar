# Data model: 058 MCP servers in a session

Nothing new is persisted. Everything below lives in memory for the run, like spec 019's per-agent switches. No path and no secret
value crosses the IPC boundary.

## Capability fields (`src/adapters/capabilities.ts`, plain data)

| Field | Type | Copilot | Claude | Codex | Missing means |
| --- | --- | --- | --- | --- | --- |
| `mcpStart` | `'session' \| 'next-message'` | `session` | `next-message` | `session` | no "how it starts" line |
| `mcpToggleApplies` | `'live' \| 'next-message'` | `live` | `live` | `next-message` | `live` (today's wording) |
| `mcpRestart` | `boolean` | `true` | `true` | `false` | `false` |
| `mcpLogs` | `'session' \| 'per-server'` | `session` | `per-server` | `session` | no log folder |

`mcpRestart` and `mcpLogs` follow FR-027 of spec 012: the matching optional member exists exactly when the flag says so (contract C2).
Claude's per-server folder is shown labelled undocumented (Q6); Codex's folder only when it exists (Q7).

## Normalized status additions (`src/adapters/types.ts`, `McpServerStatus`)

| Field | Type | Set by |
| --- | --- | --- |
| `errorClass?` | `'auth' \| 'not-found' \| 'timeout' \| 'exited' \| 'config'` | the adapter, only from a vendor field (Copilot `errorClassification` values once observed; Codex `failureReason`, `authStatus`) |
| `needsRestart?` | `boolean` | Copilot `session.mcp_server_needs_reconnect`; cleared by the next status change |

Existing fields (`name`, `status`, `source`, `transport`, `error`) are unchanged. `error` stays cut to 300 characters by the adapters;
it is masked in main, not in the adapter (the adapter does not know the folder's secret values).

## New adapter members (`src/adapters/types.ts`, `AgentAdapter`)

```ts
restartMcpServer?(sessionId: string, name: string): Promise<void>;          // present iff capabilities.mcpRestart
mcpLogFolder?(sessionId: string, name?: string): { root: string; folder: string } | undefined; // present iff capabilities.mcpLogs; main checks folder is under root (FR-026)
```

## IPC shapes (`src/shared/api.ts`)

`AgentMcpEntry` (one server as one agent sees it) gains:

| Field | Type | Notes |
| --- | --- | --- |
| `error?` | `string` | now **masked** in main (FR-005), at most 300 characters |
| `errorClass?` | as above | |
| `needsRestart?` | `boolean` | |
| `canRestart` | `boolean` | adapter has `restartMcpServer`, session live, switch on |
| `logFolder` | `boolean` | per-server folder exists (Claude, Q6) |

The `agents:mcp` reply `{ ok, servers, live }` gains:

| Field | Type | Notes |
| --- | --- | --- |
| `app` | `string` | the agent app's display name (for the "how it starts" line) |
| `start?` | `'session' \| 'next-message'` | from the capability |
| `toggleApplies` | `'live' \| 'next-message'` | from the capability (default `live`) |
| `canRestartSession` | `boolean` | FR-022 |
| `logFolder` | `boolean` | session-level folder exists (Copilot, Codex) |

New calls (all validated in main; results carry no path):

| Channel | Arguments | Result |
| --- | --- | --- |
| `agents:mcpRestart` | `id: string`, `name: string` | `{ ok: boolean; error?: string }` |
| `agents:mcpRestartSession` | `id: string`, `confirmed: boolean` | `{ ok: boolean; needsConfirm?: boolean; errorKind?: 'auth'; error?: string }` (FR-027) |
| `agents:mcpRevealLogs` | `id: string`, `name?: string` | `{ ok: boolean; error?: string }` |

## Main-process state

- `restarting: Map<agentId, Set<serverName>>`: one restart per server at a time (FR-021). Cleared when the call returns.
- No other new state: the switch choices (`off` map in `mcpipc.ts`) and the last `mcp` event per session (`live` map) already exist.

## Pure tables

- **Words** (renderer, `src/renderer/mcpwords.js`, UMD like `toolstats.js`): status -> `{ word, icon }`; start mode and toggle timing ->
  sentence; error class or text -> hint. Used by the dialog in the real app and the simulator alike.
- **Log folders** (`src/adapters/mcplogdirs.ts`, no Electron): `(app, { env, platform, home, cwd, server }) -> string | undefined`, with
  `path.win32` / `path.posix` chosen from `platform` so every OS is testable from Linux CI.

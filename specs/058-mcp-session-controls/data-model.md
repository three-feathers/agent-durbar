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

## Delta: MCP OAuth sign-in (issue #364, 2026-10-20)

Nothing new is persisted. **No token, authorization code, callback URL or client secret exists anywhere in Durbar.** The authorization
address lives in main memory only and never crosses the IPC boundary.

### Capability fields (`src/adapters/capabilities.ts`)

| Field | Type | Copilot | Claude | Codex | Missing means |
| --- | --- | --- | --- | --- | --- |
| `mcpSignIn` | `boolean` | `true` | `true` | `true` | no Sign in button; steps only |
| `mcpSignInSteps` | `string` (plain, `{name}` placeholder) | "In a terminal, run `copilot`, type `/mcp auth {name}` ..." | "In a terminal, run `claude mcp login {name}` ..." | "In a terminal, run `codex mcp login {name}` ..." | a generic "Sign in from the agent app" line |

### Adapter member (`src/adapters/types.ts`, `AgentAdapter`)

```ts
// present iff capabilities.mcpSignIn; rejects with an McpSignInManual error when the runtime has no such call or refuses it
startMcpSignIn?(sessionId: string, name: string): Promise<{ kind: 'browser'; url: string } | { kind: 'connected' }>;
cancelMcpSignIn?(sessionId: string, name: string): Promise<void>; // optional; Codex account/login/cancel
```

### Normalized events

| Event | Field | Notes |
| --- | --- | --- |
| `toolCall` (`phase: 'failed'`, `mcpServer` set) | `mcpAuth?: true` | FR-063; set by the adapter from `isMcpAuthChallenge`; the event guard drops it elsewhere |
| `mcp` | server `status: 'needs-auth'`, `errorClass: 'auth'` | FR-060; `errorClass` is the T010 field |

### IPC shapes (`src/shared/api.ts`)

`AgentMcpEntry` gains `canSignIn: boolean` (adapter has `startMcpSignIn`, session live, state needs-auth or `errorClass: 'auth'`) and
`signIn?: { host: string }` (a sign-in is open). The `agents:mcp` reply gains `signInSteps?: string` (the capability text, name filled by
the renderer per row).

| Channel | Arguments | Result |
| --- | --- | --- |
| `agents:mcpSignIn` | `id: string`, `name: string` | `{ ok: true; host: string } \| { ok: true; connected: true } \| { ok: false; manual?: true; error?: string }` |
| `agents:mcpOpenSignIn` | `id: string`, `name: string` | `{ ok: boolean; error?: string }` |
| `agents:mcpCancelSignIn` | `id: string`, `name: string` | `{ ok: boolean }` |

### Main-process state

- `signIns: Map<agentId, Map<serverName, { url: string; host: string; until: number }>>` (`src/main/mcpsignin.ts`): at most one per
  server, 10 minutes, cleared on `connected`, Cancel, time limit, End, Restart session, quit. Never logged, never serialized.
- Copilot only (Q12 B, owner 2026-10-20): the session config adds `mcpOAuthTokenStorage: 'persistent'` (a runtime setting, not Durbar storage).

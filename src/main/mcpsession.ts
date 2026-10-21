/**
 * Spec 058: the per-agent MCP dialog in main, as plain functions (no Electron, no file system), so they are unit tested:
 *  - `agentMcpReply`: the `agents:mcp` reply (FR-020), errors masked before they leave main (FR-005, T021);
 *  - `mcpRestartOp`: `agents:mcpRestart`, one server of a running session (FR-021);
 *  - `mcpRestartSessionOp`: `agents:mcpRestartSession`, end and resume the same session with the current servers (FR-022, FR-027).
 * Nothing here knows a vendor: it only calls `AgentAdapter` members and reads `capabilities` (constitution II).
 */
import { isAuthError } from '../adapters/autherrors';
import type { AdapterRouter } from '../adapters/router';
import type { AgentAdapter, McpServerStatus } from '../adapters/types';
import type { AgentInfo, AgentMcpEntry, AgentMcpReply, McpRestartResult, McpRestartSessionResult } from '../shared/api';
import { maskMcpError } from './mcpmask';

const NOT_RUNNING = 'This session is not running. Send a message to start it.';
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
/** A server name as main accepts it from the window: 1-64 characters (spec 058 FR-021). */
export const validServerName = (name: unknown): name is string => typeof name === 'string' && name.length > 0 && name.length <= 64;

export interface McpReplyInput {
  a: AgentInfo;
  ad: AgentAdapter | undefined;
  /** The latest server list the runtime reported for this session (empty before the first `mcp` event). */
  live: readonly McpServerStatus[];
  /** Servers this agent switched off for this run. */
  off: ReadonlySet<string>;
  /** The secret values handed to this session (its folder's extras), masked out of every error (FR-005). */
  secrets: readonly string[];
  /** The Copilot CLI list (global), with its own on/off. */
  cli: ReadonlyArray<{ name: string; enabled: boolean }>;
  /** This agent's folder extras. */
  extras: ReadonlyArray<{ name: string; enabled: boolean; trusted: boolean; needsSecrets?: boolean }>;
  /** Names switched off in Settings. */
  ambientDisabled: ReadonlySet<string>;
}

/** `agents:mcp` (spec 019 FR-009, spec 058 FR-020). No path and no secret value: names, states and masked errors only. */
export function agentMcpReply(i: McpReplyInput): AgentMcpReply {
  const { a, ad, off, secrets } = i;
  const isLive = ad?.isLive(a.id) ?? false;
  const status = new Map(i.live.map((x) => [x.name, x]));
  const canRestartAny = isLive && typeof ad?.restartMcpServer === 'function';
  const entries: AgentMcpEntry[] = [];
  const seen = new Set<string>();
  const add = (name: string, origin: AgentMcpEntry['origin'], defaultOn: boolean): void => {
    if (seen.has(name)) return;
    seen.add(name);
    const st = status.get(name);
    const on = defaultOn && !off.has(name);
    // FR-030: Restart only for a server the running session knows (the runtime reported it) and that is switched on
    const canRestart = canRestartAny && on && !!st && st.status !== 'disabled';
    entries.push({ name, origin, status: st?.status, error: maskMcpError(st?.error, secrets), defaultOn, off: off.has(name), ...(canRestart ? { canRestart: true } : {}) });
  };
  for (const am of i.cli) add(am.name, 'cli', am.enabled);
  const names = new Set(i.cli.map((x) => x.name.toLowerCase()));
  for (const v of i.extras) if (!names.has(v.name.toLowerCase())) add(v.name, 'folder', v.enabled && v.trusted && !v.needsSecrets);
  for (const x of i.live) add(x.name, 'runtime', !i.ambientDisabled.has(x.name));
  const caps = ad?.capabilities;
  return {
    ok: true,
    servers: entries,
    live: isLive,
    ...(caps?.mcpStart ? { start: caps.mcpStart } : {}),
    ...(caps?.mcpToggleApplies ? { toggleApplies: caps.mcpToggleApplies } : {}),
    // FR-022: an adapter that can resume, and a running session to restart
    canRestartSession: !!caps?.resume && isLive,
  };
}

export interface RestartDeps {
  agents: Map<string, AgentInfo>;
  router: Pick<AdapterRouter, 'forAgent'>;
  /** The runtime's latest list for a session. */
  live(agentId: string): readonly McpServerStatus[];
  off(agentId: string): ReadonlySet<string>;
  secrets(agentId: string): readonly string[];
  /** Spec 052 activity log: one row per restart, no error text. */
  log?(a: AgentInfo, action: string): void;
}

/** `agents:mcpRestart(id, name)` (FR-021). `running` holds `<agent id>\0<server>` while a restart runs: a second press is refused. */
export async function mcpRestartOp(d: RestartDeps, running: Set<string>, id: unknown, name: unknown): Promise<McpRestartResult> {
  const a = typeof id === 'string' ? d.agents.get(id) : undefined;
  if (!a || !validServerName(name)) return { ok: false, error: 'Unknown agent or server.' };
  const ad = d.router.forAgent(a.id);
  if (!ad) return { ok: false, error: 'Unknown agent or server.' };
  if (typeof ad.restartMcpServer !== 'function') return { ok: false, error: `${ad.displayName} cannot restart one MCP server. Use Restart session with these servers.` };
  if (!ad.isLive(a.id)) return { ok: false, error: NOT_RUNNING };
  if (!d.live(a.id).some((x) => x.name === name)) return { ok: false, error: `${name} is not running in this session.` };
  if (d.off(a.id).has(name)) return { ok: false, error: 'Switch it on first.' };
  const key = `${a.id}\0${name}`;
  if (running.has(key)) return { ok: false, error: `${name} is already restarting.` };
  running.add(key);
  try {
    await ad.restartMcpServer(a.id, name);
    d.log?.(a, `MCP server ${name} restarted`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: maskMcpError(errText(err), d.secrets(a.id)) ?? 'Could not restart it.' };
  } finally {
    running.delete(key);
  }
}

export interface RestartSessionDeps {
  agents: Map<string, AgentInfo>;
  router: Pick<AdapterRouter, 'forAgent'>;
  /** Main's own state of the agent (spec 041 tracker): working, thinking and waiting need a confirmation. */
  busy(agentId: string): boolean;
  /** What *End session* does: remote control off first (spec 054 FR-003), then `adapter.stop`. */
  endSession(agentId: string): Promise<void>;
  /** The existing resume path (`ensureLive`) with the current start options; `quiet: false` so the window sees the session ready again. */
  resume(a: AgentInfo): Promise<void>;
  secrets(agentId: string): readonly string[];
  log?(a: AgentInfo, action: string): void;
}

/**
 * `agents:mcpRestartSession(id, confirmed)` (FR-022): the same session id, ended and resumed, so Settings, the folder's extras and this
 * agent's switches all apply. No prompt is sent (a resume spends no AI credits). A busy agent needs `confirmed === true`. A resume that
 * fails leaves the agent ended, as *End session* does; a sign-in failure says so with `errorKind: 'auth'` (FR-027).
 */
export async function mcpRestartSessionOp(d: RestartSessionDeps, running: Set<string>, id: unknown, confirmed: unknown): Promise<McpRestartSessionResult> {
  const a = typeof id === 'string' ? d.agents.get(id) : undefined;
  const ad = a ? d.router.forAgent(a.id) : undefined;
  if (!a || !ad) return { ok: false, error: 'Unknown agent.' };
  if (!ad.capabilities.resume) return { ok: false, error: `${ad.displayName} cannot resume a session, so it cannot be restarted with the current servers.` };
  if (!ad.isLive(a.id)) return { ok: false, error: NOT_RUNNING };
  if (d.busy(a.id) && confirmed !== true) return { ok: false, needsConfirm: true };
  if (running.has(a.id)) return { ok: false, error: 'This session is already restarting.' };
  running.add(a.id);
  try {
    try {
      await d.endSession(a.id);
    } catch (err) {
      return { ok: false, error: maskMcpError(errText(err), d.secrets(a.id)) ?? 'Could not end the session.' };
    }
    try {
      await d.resume(a);
    } catch (err) {
      const auth = isAuthError(err); // the window shows spec 012 FR-157's sign-in card and marks the app signed out
      return { ok: false, ended: true, error: maskMcpError(errText(err), d.secrets(a.id)) ?? 'Could not resume the session.', ...(auth ? { errorKind: 'auth' as const } : {}) };
    }
    d.log?.(a, 'Session restarted with the current MCP servers');
    return { ok: true };
  } finally {
    running.delete(a.id);
  }
}

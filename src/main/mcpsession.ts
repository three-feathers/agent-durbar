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
import type { AgentInfo, AgentMcpEntry, AgentMcpReply, GlobalApp, McpRestartResult, McpRestartSessionResult } from '../shared/api';
import { maskMcpError } from './mcpmask';
import { sourcesFor } from './mcpglobal';
import type { McpHealthMark } from '../shared/mcphealth';

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
  /** Spec 058 FR-078: names Agent Durbar passed as disabled when this session started. */
  launchedOff?: ReadonlySet<string>;
  /** Spec 058 FR-078: names the user switched here since the session started. */
  switchedHere?: ReadonlySet<string>;
  /** Spec 069 FR-009: the agent app (`copilot`, `claude`, `codex`); Claude and Codex agents do not list the Copilot CLI list. */
  app?: string;
  /** Spec 069 FR-009: Claude Code's user list with its Settings switch (listed for Claude agents). */
  claudeList?: ReadonlyArray<{ name: string; enabled: boolean }>;
  /** Spec 069 FR-011: the names of each app's user list, and the built-in servers, for the source chips. */
  global?: Partial<Record<GlobalApp, readonly string[]>>;
  builtin?: ReadonlySet<string>;
  /** Spec 069 FR-061: tools turned off in this agent's folder, by server. */
  toolsOff?: Readonly<Record<string, readonly string[]>>;
  /** Spec 058 FR-092: when each server's state started and whether a failure came after Running (`mcpHealthUpdate`). */
  health?: ReadonlyMap<string, McpHealthMark>;
  /** Spec 058 FR-065: the open sign-in of one server (host only), from `McpSignInStore.view`. */
  signIn?(name: string): { host: string; opened: boolean; expiresInMs: number; otherSite?: string } | undefined;
}

/** Spec 058 FR-065: the one rule for "this row needs a sign-in" (the window uses the same): the runtime's `needs-auth`, or a failed server whose failure is an auth one. */
export const needsSignIn = (s: { status?: string; errorClass?: string } | undefined): boolean => !!s && (s.status === 'needs-auth' || (s.status === 'failed' && s.errorClass === 'auth'));

/** A server name that is safe to put in a command the user may copy: no spaces, quotes, newlines or shell characters (a folder extra's name comes from a file). */
const PLAIN_NAME = /^[A-Za-z0-9_.@:+-]{1,64}$/;
/** Spec 058 FR-068: the adapter's terminal steps with the name filled in; a name with other characters is shown as `<server name>`, never as part of a command. */
export function signInStepsFor(template: string | undefined, name: string, origin: AgentMcpEntry['origin']): string | undefined {
  if (origin === 'folder') return 'This server is only known to Agent Durbar; use Sign in here.';
  if (!template) return undefined;
  return template.split('{name}').join(PLAIN_NAME.test(name) ? name : '<server name>');
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
    // FR-092: the mark only dates the state it was made for (a stale mark never dates a new state)
    const hm = st ? i.health?.get(name) : undefined;
    const mark = hm && hm.status === (st?.status ?? '') ? hm : undefined;
    // FR-065/FR-068: a row that reads Needs sign-in, on, in a running session; the steps are the agent app's own text (missing = none)
    const needs = isLive && on && needsSignIn(st);
    const canSignIn = needs && typeof ad?.startMcpSignIn === 'function';
    const steps = needs && ad?.capabilities.mcpSignIn ? signInStepsFor(ad.capabilities.mcpSignInSteps, name, origin) : undefined;
    const open = canSignIn ? i.signIn?.(name) : undefined;
    entries.push({ name, origin, status: st?.status, error: maskMcpError(st?.error, secrets), ...(st?.errorClass ? { errorClass: st.errorClass } : {}), ...(mark ? { since: mark.since } : {}), ...(mark?.afterRunning ? { afterRunning: true } : {}), ...(st?.transport ? { transport: st.transport } : {}), defaultOn, off: off.has(name), ...(canRestart ? { canRestart: true } : {}), ...(canSignIn ? { canSignIn: true } : {}), ...(open ? { signIn: open } : {}), ...(steps ? { signInSteps: steps } : {}), ...(i.launchedOff?.has(name) ? { launchedOff: true } : {}), ...(i.switchedHere?.has(name) ? { switchedHere: true } : {}) });
  };
  const cli = i.app === 'claude' || i.app === 'codex' ? [] : i.cli;
  const own = i.app === 'claude' ? (i.claudeList ?? []) : [];
  for (const am of cli) add(am.name, 'cli', am.enabled);
  for (const g of own) add(g.name, 'cli', g.enabled);
  const names = new Set([...cli, ...own].map((x) => x.name.toLowerCase()));
  for (const v of i.extras) if (!names.has(v.name.toLowerCase())) add(v.name, 'folder', v.enabled && v.trusted && !v.needsSecrets);
  for (const x of i.live) add(x.name, 'runtime', !i.ambientDisabled.has(x.name));
  for (const e of entries) {
    const t = i.toolsOff?.[e.name];
    if (t?.length) e.toolsOff = [...t];
  }
  if (i.global) {
    const folder = new Set(i.extras.map((v) => v.name));
    for (const e of entries) e.sources = sourcesFor(e.name, i.global, folder, i.builtin ?? new Set());
  }
  const caps = ad?.capabilities;
  return {
    ok: true,
    servers: entries,
    live: isLive,
    // FR-020: the agent app's own name, for the hints ("Copilot keeps the sign-in")
    ...(ad?.displayName ? { app: ad.displayName } : {}),
    ...(caps?.mcpStart ? { start: caps.mcpStart } : {}),
    ...(caps?.mcpToggleApplies ? { toggleApplies: caps.mcpToggleApplies } : {}),
    // FR-022: an adapter that can resume, and a running session to restart
    canRestartSession: !!caps?.resume && isLive,
    ...(typeof ad?.listMcpTools === 'function' ? { canListTools: true } : {}),
    ...(caps?.mcpToolFilter ? { toolFilter: true } : {}),
  };
}

export interface RestartDeps {
  agents: Map<string, AgentInfo>;
  router: Pick<AdapterRouter, 'forAgent'>;
  /** The runtime's latest list for a session. */
  live(agentId: string): readonly McpServerStatus[];
  /** Names that are off for this agent: switched off here or in Settings. */
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
  const st = d.live(a.id).find((x) => x.name === name);
  if (!st) return { ok: false, error: `${name} is not running in this session.` };
  // a server that is off (for this agent, in Settings, or as the runtime reports it) is never started by a Restart
  if (d.off(a.id).has(name) || st.status === 'disabled') return { ok: false, error: 'Switch it on first.' };
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

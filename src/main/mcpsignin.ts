/**
 * Spec 058 FR-064..FR-066, FR-068 (T101): the MCP Sign in in main, as plain functions and a small store (no Electron, no file system,
 * no timers), so they are unit tested with an injected clock and opener.
 *  - `McpSignInStore`: the sign-in address the agent app's runtime handed back, held in memory per agent and server for at most
 *    10 minutes. The window only ever gets the host. Nothing here writes the address anywhere (no log, no disk, no debug line).
 *  - `mcpSignInOp`, `mcpOpenSignInOp`, `mcpCancelSignInOp`: `agents:mcpSignIn`, `agents:mcpOpenSignIn`, `agents:mcpCancelSignIn`.
 * Durbar never sees a token: the runtime runs the whole OAuth flow and keeps the result (constitution I). It only learns the page to open.
 * Nothing here knows a vendor: it calls `AgentAdapter` members and reads `capabilities` (constitution II).
 */
import { elicitHttpsUrl } from '../shared/elicit';
import type { AdapterRouter } from '../adapters/router';
import type { McpServerStatus } from '../adapters/types';
import type { AgentInfo, McpOpenSignInResult, McpSignInStartResult } from '../shared/api';
import { maskMcpError } from './mcpmask';
import { validServerName } from './mcpsession';

/** FR-065: how long main keeps an address; the runtime's own listener ends on its own (`[KNOWN GAP]`, how long). */
export const SIGN_IN_TTL_MS = 10 * 60 * 1000;

interface Entry {
  url: string;
  host: string;
  at: number;
  opened: boolean;
}

/** What the window may know about an open sign-in: the host, whether the page was opened, and how long it stays open. Never the address. */
export interface SignInView {
  host: string;
  opened: boolean;
  expiresInMs: number;
}

export class McpSignInStore {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Set<string>();
  constructor(
    private readonly now: () => number,
    private readonly openUrl: (url: string) => Promise<void>,
    private readonly ttlMs: number = SIGN_IN_TTL_MS,
  ) {}
  private static key(agentId: string, name: string): string {
    return `${agentId}\0${name}`;
  }
  /** The entry, or undefined once it is older than the limit (it is dropped then). */
  private live(agentId: string, name: string): Entry | undefined {
    const k = McpSignInStore.key(agentId, name);
    const e = this.entries.get(k);
    if (e && this.now() - e.at >= this.ttlMs) {
      this.entries.delete(k);
      return undefined;
    }
    return e;
  }
  has(agentId: string, name: string): boolean {
    return !!this.live(agentId, name);
  }
  /** One sign-in per server: also while the call to the runtime is under way (the address has not arrived yet). False when one is open or starting. */
  reserve(agentId: string, name: string): boolean {
    const k = McpSignInStore.key(agentId, name);
    if (this.pending.has(k) || this.live(agentId, name)) return false;
    this.pending.add(k);
    return true;
  }
  release(agentId: string, name: string): void {
    this.pending.delete(McpSignInStore.key(agentId, name));
  }
  /** Hold an address that already passed `elicitHttpsUrl`. False when one is open for this server (one at a time). */
  begin(agentId: string, name: string, url: string, host: string): boolean {
    if (this.live(agentId, name)) return false;
    this.entries.set(McpSignInStore.key(agentId, name), { url, host, at: this.now(), opened: false });
    return true;
  }
  view(agentId: string, name: string): SignInView | undefined {
    const e = this.live(agentId, name);
    return e ? { host: e.host, opened: e.opened, expiresInMs: Math.max(0, this.ttlMs - (this.now() - e.at)) } : undefined;
  }
  /** Open the held address in the system browser: re-checked here, only after the user's click (FR-065). */
  async open(agentId: string, name: string): Promise<'opened' | 'gone' | 'refused' | 'failed'> {
    const e = this.live(agentId, name);
    if (!e) return 'gone';
    const u = elicitHttpsUrl(e.url);
    if (!u) {
      this.drop(agentId, name);
      return 'refused';
    }
    try {
      await this.openUrl(u.url);
    } catch {
      return 'failed'; // the entry stays: the user may press Open again
    }
    e.opened = true;
    return 'opened';
  }
  drop(agentId: string, name: string): boolean {
    return this.entries.delete(McpSignInStore.key(agentId, name));
  }
  /** End session, Restart session and an agent that is gone: every sign-in of that agent. */
  dropAgent(agentId: string): void {
    for (const k of [...this.entries.keys()]) if (k.startsWith(`${agentId}\0`)) this.entries.delete(k);
  }
  /** App exit. */
  clear(): void {
    this.entries.clear();
  }
  /** `mcp` event: a server the runtime now reports connected has finished its sign-in. */
  onServers(agentId: string, servers: readonly McpServerStatus[]): void {
    for (const s of servers) if (s.status === 'connected') this.drop(agentId, s.name);
  }
}

export interface SignInDeps {
  agents: Map<string, AgentInfo>;
  router: Pick<AdapterRouter, 'forAgent'>;
  /** The runtime's latest list for a session. */
  live(agentId: string): readonly McpServerStatus[];
  secrets(agentId: string): readonly string[];
}

const NOT_RUNNING = 'This session is not running. Send a message to start it, then sign in.';
const UNKNOWN = 'Unknown agent or server.';
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
/** An error text for the window: every address is hidden (the runtime may quote the authorization address), then the usual MCP masks. */
export function signInErrorText(err: unknown, secrets: readonly string[], fallback: string): string {
  const s = errText(err).replace(/\b[a-z][a-z0-9+.-]{1,15}:\/\/\S+/gi, '[address hidden]');
  return maskMcpError(s, secrets)?.trim() || fallback;
}

/** FR-065: a server whose row reads "Needs sign-in": the runtime's own status, or an auth failure. */
const needsSignIn = (s: McpServerStatus | undefined): boolean => !!s && (s.status === 'needs-auth' || s.errorClass === 'auth');

/**
 * `agents:mcpSignIn(id, name)` (FR-065). Checks the agent, the server (known, needs a sign-in), the adapter's `startMcpSignIn`, a live
 * session and one sign-in at a time; asks the runtime; checks the address; keeps it. The reply carries the host only. `manual: true`
 * tells the dialog to show the terminal steps (FR-068).
 */
export async function mcpSignInOp(d: SignInDeps, store: McpSignInStore, id: unknown, name: unknown): Promise<McpSignInStartResult> {
  const a = typeof id === 'string' ? d.agents.get(id) : undefined;
  const ad = a ? d.router.forAgent(a.id) : undefined;
  if (!a || !ad || !validServerName(name)) return { ok: false, error: UNKNOWN };
  if (typeof ad.startMcpSignIn !== 'function') return { ok: false, manual: true, error: `${ad.displayName} cannot start a sign-in from Agent Durbar.` };
  if (!ad.isLive(a.id)) return { ok: false, manual: true, error: NOT_RUNNING };
  const st = d.live(a.id).find((x) => x.name === name);
  if (!st) return { ok: false, error: `${name} is not running in this session.` };
  if (!needsSignIn(st)) return { ok: false, error: `${name} does not need a sign-in.` };
  if (!store.reserve(a.id, name)) return { ok: false, error: `A sign-in for ${name} is already open.` };
  try {
    let r;
    try {
      r = await ad.startMcpSignIn(a.id, name);
    } catch (err) {
      return { ok: false, manual: true, error: signInErrorText(err, d.secrets(a.id), 'Could not start the sign-in.') };
    }
    if (r.kind === 'connected') return { ok: true, kind: 'connected' };
    const u = elicitHttpsUrl(r.url);
    if (!u) {
      // Q16: not https, user:password, too long: never opened. The runtime's own listener is told to stop where it can.
      try {
        await ad.cancelMcpSignIn?.(a.id, name);
      } catch {
        /* best effort */
      }
      return { ok: false, manual: true, error: 'Agent Durbar opens only https sign-in pages, and this one is not.' };
    }
    store.begin(a.id, name, u.url, u.host);
    return { ok: true, kind: 'browser', host: u.host };
  } finally {
    store.release(a.id, name);
  }
}

/** `agents:mcpOpenSignIn(id, name)`: opens the held address, only on the user's click (FR-065, Q13). The window never sends an address. */
export async function mcpOpenSignInOp(store: McpSignInStore, agents: Map<string, AgentInfo>, id: unknown, name: unknown): Promise<McpOpenSignInResult> {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a || !validServerName(name)) return { ok: false, error: UNKNOWN };
  switch (await store.open(a.id, name)) {
    case 'opened':
      return { ok: true };
    case 'failed':
      return { ok: false, error: 'Could not open your browser. Press Open sign-in page again.' };
    case 'refused':
      return { ok: false, manual: true, error: 'Agent Durbar opens only https sign-in pages, and this one is not.' };
    default:
      return { ok: false, gone: true, error: 'That sign-in is no longer open. Press Sign in again.' };
  }
}

/** `agents:mcpCancelSignIn(id, name)`: forget the address; the adapter's cancel where it has one (Copilot has none: its listener ends on its own). */
export async function mcpCancelSignInOp(d: Pick<SignInDeps, 'agents' | 'router'>, store: McpSignInStore, id: unknown, name: unknown): Promise<{ ok: boolean; error?: string }> {
  const a = typeof id === 'string' ? d.agents.get(id) : undefined;
  if (!a || !validServerName(name)) return { ok: false, error: UNKNOWN };
  const had = store.drop(a.id, name);
  const ad = d.router.forAgent(a.id);
  if (had && ad?.isLive(a.id) && typeof ad.cancelMcpSignIn === 'function') {
    try {
      await ad.cancelMcpSignIn(a.id, name);
    } catch {
      /* the sign-in is forgotten either way */
    }
  }
  return { ok: true };
}

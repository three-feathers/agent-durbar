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
import { validSignInEnd } from '../adapters/eventguard';
import { maskMcpError } from './mcpmask';
import { needsSignIn, validServerName } from './mcpsession';

/** FR-065: how long main keeps an address at most; the runtime's own listener ends on its own. FR-180: an entry with a `ttlMs` keeps its own, shorter limit. */
export const SIGN_IN_TTL_MS = 10 * 60 * 1000;
/** FR-176: for this long after a sign-in started, a dialog open or a window focus reads the server list once (a finish after Cancel shows). */
export const RECENT_SIGN_IN_MS = 5 * 60 * 1000;
/** FR-180: the shortest limit; also what an adapter's invalid `ttlMs` gets. */
export const SIGN_IN_MIN_TTL_MS = 30_000;
/** At most this many open sign-ins in all (a window cannot fill memory with them). */
export const MAX_SIGN_INS = 64;

interface Entry {
  url: string;
  host: string;
  at: number;
  /** FR-180: this entry's own limit (`min(ttlMs, 10 minutes)`). */
  ttl: number;
  opened: boolean;
  /** FR-075: the server's own host, set only when the sign-in page is on a different site than the server. */
  otherSite?: string;
}

/** Two-part public suffixes the registrable-domain rule knows (FR-075: the last two labels, or three for these). */
const TWO_PART_SUFFIX = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'co.kr', 'co.in', 'co.za', 'com.br', 'com.mx', 'com.cn', 'com.tr', 'com.sg', 'com.hk']);
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
/** The registrable domain of a host: the last two labels, three after a known two-part suffix; an IP or a single label is itself. */
export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (IPV4.test(h) || h.includes(':') || !h.includes('.')) return h;
  const l = h.split('.');
  return l.slice(TWO_PART_SUFFIX.has(l.slice(-2).join('.')) ? -3 : -2).join('.');
}
/**
 * FR-075 (T110): the server's host when the sign-in page is on a different site than the server (registrable domains differ), else
 * undefined. A stdio or runtime-only server (no http(s) address) has none: the confirm then shows its source tag and no line.
 */
export function signInSiteNote(serverUrl: string | undefined, pageHost: string): string | undefined {
  if (typeof serverUrl !== 'string') return undefined;
  try {
    const u = new URL(serverUrl);
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !u.hostname) return undefined;
    return registrableDomain(u.hostname) === registrableDomain(pageHost) ? undefined : u.hostname;
  } catch {
    return undefined;
  }
}

/** FR-185: where each agent app's servers come from, read lazily (only the lists the agent's app uses are read). */
export interface ServerUrlSources {
  /** This folder's extras in Agent Durbar. */
  extras(): ReadonlyArray<{ name: string; url?: string }>;
  /** The Copilot CLI list (`~/.copilot/mcp-config.json`). */
  copilot(): ReadonlyArray<{ name: string; url?: string }>;
  /** Claude Code's user list as Durbar passes it to a Claude session (spec 069 FR-009, `globalFor`). */
  claude(): Readonly<Record<string, { url?: string }>>;
  /** Codex's own `config.toml` entries as spec 069's `GlobalLists` reads them. */
  codex(): Readonly<Record<string, { url?: string }>>;
}
/** FR-185: an app's list as the values-free Settings view has it (`GlobalLists.state`), as `{name: {url}}` (no env or header value is read). */
export function appServerUrls(apps: ReadonlyArray<{ app: string; servers: ReadonlyArray<{ name: string; url?: string }> }>, app: string): Record<string, { url?: string }> {
  const out: Record<string, { url?: string }> = Object.create(null);
  for (const a of apps) if (a.app === app) for (const v of a.servers) if (typeof v.name === 'string' && !(v.name in out)) out[v.name] = typeof v.url === 'string' ? { url: v.url } : {};
  return out;
}

/**
 * Spec 058 FR-185 (T157; a bug in #598): the server's own address for the "different site" line, from the lists **this agent's app**
 * uses: Copilot: folder extras, then the Copilot CLI list; Claude Code: folder extras, then its user list; Codex: folder extras, then its
 * `config.toml`. Another app's list is never consulted, and no match means no line (never a line against the wrong server).
 */
export function serverUrlFor(app: string | undefined, name: string, src: ServerUrlSources): string | undefined {
  const extra = src.extras().find((v) => v.name === name)?.url;
  if (extra !== undefined) return extra;
  const own = (m: Readonly<Record<string, { url?: string }>>): string | undefined => (Object.prototype.hasOwnProperty.call(m, name) ? m[name]?.url : undefined);
  if (app === 'copilot') return src.copilot().find((v) => v.name === name)?.url;
  if (app === 'claude') return own(src.claude());
  if (app === 'codex') return own(src.codex());
  return undefined;
}

/**
 * The only way an address becomes openable: `elicitHttpsUrl` (https, no user:password, 2048 characters; its host is the punycode form, so
 * an IDN lookalike never reads like the real domain), and no whitespace or control character anywhere in the text (the URL parser would
 * silently drop a tab or newline and trim spaces, so the text and the opened address would differ).
 */
// eslint-disable-next-line no-control-regex
const BLANKS = /[\s\u0000-\u001f\u007f-\u009f]/;
export function strictHttpsUrl(u: unknown): { url: string; host: string } | undefined {
  if (typeof u !== 'string' || BLANKS.test(u)) return undefined;
  const r = elicitHttpsUrl(u);
  return r && !blockedAuthHost(r.host) ? r : undefined;
}
/**
 * Q16 tightened (review on #598): an authorization page on this machine or on a private network is never opened from a runtime's answer:
 * `localhost`, `*.localhost`, any IP literal (v4 in any spelling the URL parser normalised, v6 in brackets: loopback, 10/8, 172.16/12,
 * 192.168/16, link-local) and a single-label host. Those take the manual route. The runtime's own loopback callback is not affected (it
 * is the redirect, not the page Durbar opens).
 */
export function blockedAuthHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return !h || h.startsWith('[') || h.includes(':') || IPV4.test(h) || !h.includes('.') || h === 'localhost' || h.endsWith('.localhost');
}

/** What the window may know about an open sign-in: the host, whether the page was opened, and how long it stays open. Never the address. */
export interface SignInView {
  host: string;
  opened: boolean;
  expiresInMs: number;
  /** FR-075: the server's host when the page is on a different site. */
  otherSite?: string;
}

/** What the poller needs to know about an entry's life: the page was opened (start polling), the entry is gone (stop, whatever the reason). */
export interface SignInHooks {
  opened?(agentId: string, name: string): void;
  dropped?(agentId: string, name: string): void;
}
const splitKey = (k: string): [string, string] => {
  const i = k.indexOf('\0');
  return [k.slice(0, i), k.slice(i + 1)];
};

export class McpSignInStore {
  /** Set after construction (the poller needs the store too). */
  hooks: SignInHooks = {};
  private readonly entries = new Map<string, Entry>();
  /** Every removal goes through here, so the poller is told whatever the reason (Cancel, connected, expiry, End session, a refused address). */
  private del(k: string): boolean {
    const had = this.entries.delete(k);
    if (had) this.hooks.dropped?.(...splitKey(k));
    return had;
  }
  private readonly pending = new Set<string>();
  /** FR-176: when a sign-in of each server last started (a browser page was held), kept for 5 minutes; nothing else. */
  private readonly attempts = new Map<string, number>();
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
    if (e && this.now() - e.at >= e.ttl) {
      this.del(k);
      return undefined;
    }
    return e;
  }
  /** Drop every entry past the limit (called when one is added, so the map cannot grow without bound). */
  private sweep(): void {
    for (const [k, e] of [...this.entries]) if (this.now() - e.at >= e.ttl) this.del(k);
    for (const [k, at] of [...this.attempts]) if (this.now() - at >= RECENT_SIGN_IN_MS) this.attempts.delete(k);
  }
  has(agentId: string, name: string): boolean {
    return !!this.live(agentId, name);
  }
  /** One sign-in per server: also while the call to the runtime is under way (the address has not arrived yet). False when one is open or starting. */
  reserve(agentId: string, name: string): boolean {
    const k = McpSignInStore.key(agentId, name);
    this.sweep();
    if (this.pending.has(k) || this.live(agentId, name) || this.entries.size + this.pending.size >= MAX_SIGN_INS) return false;
    this.pending.add(k);
    return true;
  }
  release(agentId: string, name: string): void {
    this.pending.delete(McpSignInStore.key(agentId, name));
  }
  /**
   * Hold an address that already passed `elicitHttpsUrl`. False when one is open for this server (one at a time). FR-180: `ttlMs` (the
   * agent app's own listener time, from the adapter) shortens the limit: missing = 10 minutes; present but not a positive finite number
   * (0, negative, NaN, Infinity, a string) = the 30-second minimum (review on #635: a broken value never gets the longest limit).
   */
  begin(agentId: string, name: string, url: string, host: string, otherSite?: string, ttlMs?: number): boolean {
    this.sweep();
    if (this.live(agentId, name) || this.entries.size >= MAX_SIGN_INS) return false;
    const ttl = ttlMs === undefined ? this.ttlMs : typeof ttlMs === 'number' && Number.isFinite(ttlMs) && ttlMs > 0 ? Math.min(ttlMs, this.ttlMs) : Math.min(SIGN_IN_MIN_TTL_MS, this.ttlMs);
    const k = McpSignInStore.key(agentId, name);
    this.entries.set(k, { url, host, at: this.now(), ttl, opened: false, ...(otherSite ? { otherSite } : {}) });
    this.attempts.delete(k); // newest last: the cap below drops the oldest
    this.attempts.set(k, this.now());
    if (this.attempts.size > MAX_SIGN_INS) this.attempts.delete(this.attempts.keys().next().value as string);
    return true;
  }
  /** FR-176: servers of this agent whose sign-in started within the last 5 minutes and is no longer held (Cancel, the time limit). */
  recent(agentId: string): string[] {
    this.sweep();
    const out: string[] = [];
    for (const k of this.attempts.keys()) {
      const [a, n] = splitKey(k);
      if (a === agentId && !this.entries.has(k)) out.push(n);
    }
    return out;
  }
  view(agentId: string, name: string): SignInView | undefined {
    const e = this.live(agentId, name);
    return e ? { host: e.host, opened: e.opened, expiresInMs: Math.max(0, e.ttl - (this.now() - e.at)), ...(e.otherSite ? { otherSite: e.otherSite } : {}) } : undefined;
  }
  /** Open the held address in the system browser: re-checked here, only after the user's click (FR-065). */
  async open(agentId: string, name: string, shownHost: unknown): Promise<'opened' | 'gone' | 'refused' | 'failed'> {
    const e = this.live(agentId, name);
    if (!e) return 'gone';
    // bound to what the user saw: a host the window did not show is never opened (the window repaints with the current one)
    if (typeof shownHost !== 'string' || shownHost !== e.host) return 'gone';
    const u = strictHttpsUrl(e.url);
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
    this.hooks.opened?.(agentId, name);
    return 'opened';
  }
  drop(agentId: string, name: string): boolean {
    return this.del(McpSignInStore.key(agentId, name));
  }
  /** End session, Restart session and an agent that is gone: every sign-in of that agent. */
  dropAgent(agentId: string): void {
    for (const k of [...this.entries.keys()]) if (k.startsWith(`${agentId}\0`)) this.del(k);
    for (const k of [...this.attempts.keys()]) if (k.startsWith(`${agentId}\0`)) this.attempts.delete(k);
  }
  /** App exit. */
  clear(): void {
    for (const k of [...this.entries.keys()]) this.del(k);
    this.attempts.clear();
  }
  /** `mcp` event: a server the runtime now reports connected has finished its sign-in; FR-180: so has one the adapter marks with a `signInEnd`. */
  onServers(agentId: string, servers: readonly McpServerStatus[]): void {
    for (const s of servers) {
      if (s.status === 'connected' || validSignInEnd(s.signInEnd)) {
        this.drop(agentId, s.name);
        this.attempts.delete(McpSignInStore.key(agentId, s.name));
      }
    }
  }
}

export interface SignInDeps {
  agents: Map<string, AgentInfo>;
  router: Pick<AdapterRouter, 'forAgent'>;
  /** The runtime's latest list for a session. */
  live(agentId: string): readonly McpServerStatus[];
  secrets(agentId: string): readonly string[];
  /** FR-075: the server's own address (http or https) when it has one; stdio and runtime-only servers have none. */
  serverUrl?(agentId: string, name: string): string | undefined;
}

const NOT_RUNNING = 'This session is not running. Send a message to start it, then sign in.';
const UNKNOWN = 'Unknown agent or server.';
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
/** An error text for the window: every address is hidden (the runtime may quote the authorization address), then the usual MCP masks. */
export function signInErrorText(err: unknown, secrets: readonly string[], fallback: string): string {
  const s = errText(err).replace(/\b[a-z][a-z0-9+.-]{1,15}:\/\/\S+/gi, '[address hidden]');
  return maskMcpError(s, secrets)?.trim() || fallback;
}


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
  if (!store.reserve(a.id, name)) return { ok: false, error: store.has(a.id, name) ? `A sign-in for ${name} is already open.` : 'A sign-in for this server is already starting, or too many are open.' };
  try {
    let r;
    try {
      r = await ad.startMcpSignIn(a.id, name);
    } catch (err) {
      return { ok: false, manual: true, error: signInErrorText(err, d.secrets(a.id), 'Could not start the sign-in.') };
    }
    if (r.kind === 'connected') return { ok: true, kind: 'connected' };
    // the session may have ended while the runtime was working: nothing is held for a session that is gone
    if (!d.agents.has(a.id) || !ad.isLive(a.id)) {
      try {
        await ad.cancelMcpSignIn?.(a.id, name);
      } catch {
        /* best effort */
      }
      return { ok: false, manual: true, error: NOT_RUNNING };
    }
    const u = strictHttpsUrl(r.url);
    if (!u) {
      // Q16: not https, user:password, too long: never opened. The runtime's own listener is told to stop where it can.
      try {
        await ad.cancelMcpSignIn?.(a.id, name);
      } catch {
        /* best effort */
      }
      return { ok: false, manual: true, error: 'Agent Durbar opens only https sign-in pages, and this one is not.' };
    }
    const otherSite = signInSiteNote(d.serverUrl?.(a.id, name), u.host);
    // FR-180: the app's listener time, when the adapter knows it (the store caps it at 10 minutes and ignores a bad value)
    if (!store.begin(a.id, name, u.url, u.host, otherSite, r.ttlMs)) return { ok: false, error: 'Too many sign-ins are open. Cancel one first.' };
    return { ok: true, kind: 'browser', host: u.host, ...(otherSite ? { otherSite } : {}) };
  } finally {
    store.release(a.id, name);
  }
}

/** `agents:mcpOpenSignIn(id, name)`: opens the held address, only on the user's click (FR-065, Q13). The window never sends an address. */
export async function mcpOpenSignInOp(store: McpSignInStore, agents: Map<string, AgentInfo>, id: unknown, name: unknown, shownHost: unknown): Promise<McpOpenSignInResult> {
  const a = typeof id === 'string' ? agents.get(id) : undefined;
  if (!a || !validServerName(name)) return { ok: false, error: UNKNOWN };
  switch (await store.open(a.id, name, shownHost)) {
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

/** Timers the poller uses (the global ones in main; a recorder in tests). `set` repeats until `clear`. */
export interface PollTimers {
  set(fn: () => unknown, ms: number): unknown;
  clear(handle: unknown): void;
}
export const POLL_MS = 5000;

/**
 * Real 2026-10-23 (owner's Mac, Copilot): after the browser sign-in the runtime sent no status for a long while, so the row stayed on
 * "Open sign-in page / Cancel". While a sign-in page has been opened, the agent app's server list is read again every 5 seconds, and
 * when the window regains focus (`kick`). One timer per entry, cleared in every case the entry ends (connected, Cancel, the 10-minute
 * limit, End session, Restart session, a refused address); one read at a time per entry (a slow read is not stacked on).
 */
export class SignInPoller {
  private readonly timers = new Map<string, unknown>();
  private readonly busy = new Set<string>();
  constructor(
    private readonly store: McpSignInStore,
    private readonly refresh: (agentId: string, name: string) => Promise<void> | void,
    private readonly t: PollTimers,
    private readonly ms: number = POLL_MS,
  ) {}
  /** How many timers run (tests). */
  get active(): number {
    return this.timers.size;
  }
  start(agentId: string, name: string): void {
    const k = `${agentId}\0${name}`;
    if (this.timers.has(k)) return;
    this.timers.set(k, this.t.set(() => this.poll(agentId, name), this.ms));
  }
  stop(agentId: string, name: string): void {
    const k = `${agentId}\0${name}`;
    this.busy.delete(k); // a read that never settles must not block the next sign-in of this server
    if (!this.timers.has(k)) return;
    this.t.clear(this.timers.get(k));
    this.timers.delete(k);
  }
  /** One read now (the interval, or the window regaining focus). Skipped while the previous read is still running; stops itself when the entry is gone. */
  async poll(agentId: string, name: string): Promise<void> {
    const k = `${agentId}\0${name}`;
    if (!this.store.has(agentId, name)) return this.stop(agentId, name); // expired (has() drops it) or ended
    if (this.busy.has(k)) return;
    this.busy.add(k);
    try {
      await this.refresh(agentId, name);
    } catch {
      /* the next tick tries again */
    } finally {
      this.busy.delete(k);
    }
  }
  /** The window regained focus: read now for every opened sign-in of this agent. */
  kick(agentId?: string): void {
    for (const k of [...this.timers.keys()]) {
      const [a, n] = splitKey(k);
      if (agentId === undefined || a === agentId) void this.poll(a, n);
    }
  }
}

/**
 * Spec 058 FR-205..FR-210, FR-214 (2026-11-03, "keep MCP sign-ins fresh"): before a chat's first message and before its first message
 * after a quiet hour, main asks the agent app to reconnect the chat's remote MCP servers that need it, so the app renews their sign-in with
 * its own stored refresh token. Durbar never reads, stores, logs or passes a token (constitution III): it only calls the existing
 * `restartMcpServer` (through `mcpRestartOp`) and reads the state the app reports afterwards.
 *
 *  - `planMcpSignInRefresh`: the pure decision (moment, gap, servers, attempts, blocks, flights, busy, switch, `allowReadOnly`, platform,
 *    policy -> the names to reconnect, the names to wait for, and why). `src/renderer/sim.ts` keeps a marked copy
 *    (`mcpsigninrefresh:begin`) that `scripts/test-mcp-signinrefresh.ts` compares case by case.
 *  - `McpSignInRefresher`: main's state around it (last response per chat on a monotonic clock, the `powerMonitor` resume mark, the
 *    per-chat `reconnecting` promise every send path awaits, the per-server `refreshFlight` across chats, the attempt and block records),
 *    the 5 s send wait with Stop, and the window's status lines. Nothing here knows a vendor (constitution II).
 */

import type { McpSignInRefreshNote } from '../shared/api';

/** FR-205: the quiet time after a chat's last response that makes its next message a "first message after a gap" (fixed, G1). */
export const MCP_SIGNIN_GAP_MS = 60 * 60_000;
/** FR-208: how long a send waits, in total, for the reconnects it started or joined. */
export const MCP_SIGNIN_WAIT_MS = 5000;
/** FR-212: the status recheck of running, idle chats. */
export const MCP_RECHECK_MS = 30 * 60_000;
/** FR-218: a server tried this recently (by any automatic reconnect) is not renewed again after a failure: one reconnect per failure episode, the row says Needs sign-in. */
export const MCP_RENEW_FAIL_COOLDOWN_MS = 5 * 60_000;
/** FR-224: a server with a successful call or check this recently is not checked before a message. */
export const MCP_CHECK_FRESH_MS = 5 * 60_000;
/** FR-225: a check that does not answer in this time counts as unknown (nothing else happens). */
export const MCP_CHECK_TIMEOUT_MS = 30_000;
/** FR-213 (G5 settled A, both owners): the Settings switch is on unless the person turns it off. */
export const MCP_SIGNIN_REFRESH_DEFAULT = true;
/** FR-213 (G5 settled A): an automatic reconnect also runs in Read-only (it changes no file and calls no tool). */
export const MCP_SIGNIN_ALLOW_READ_ONLY = true;

/** One server of a chat's last `mcp` report, as the planner needs it (main fills it from its own maps; no value, no URL text). */
export interface SignInServerView {
  name: string;
  status: string;
  transport?: string;
  /** The `refreshFlight` and record key: adapter id, server name and server address (FR-210). */
  key: string;
  /** Off for this chat, in Settings or in the app (FR-078's off words). */
  off?: boolean;
  /** A sign-in page of this server is open (`McpSignInStore`). */
  signInOpen?: boolean;
  /** The person's own Restart of this server runs. */
  restarting?: boolean;
  /** FR-218: built into the agent app (never renewed). */
  builtin?: boolean;
  /** FR-218: Durbar's own static header (a bearer in a folder extra) is the server's login, not an OAuth sign-in. */
  staticAuth?: boolean;
  /** FR-218: when a reconnect of this server was last tried FROM THIS CHAT (monotonic): the cooldown is per chat and server (a session restart acts on one session). */
  triedAt?: number;
  /** FR-218: another tool call to this server runs in this session now (a renewal waits for it). */
  callsInFlight?: boolean;
  /** FR-218: a renewal and its note already went out for this server in this chat and no call to it has succeeded since: a second failure gives up. */
  repeat?: boolean;
  /** FR-218: this server failed with a sign-in error (a failed `auth` call, or a report that turned `needs-auth`) and waits for the chat's idle moment. */
  failed?: boolean;
  /** Refused by policy in this run (a `policy` call class, FR-193) or by an organization verdict (spec 076). */
  policy?: boolean;
}

/** What main remembers per server key, app-wide (FR-210): the last automatic attempt and a block. */
export interface SignInRecordView {
  /** Monotonic time of the last automatic attempt. */
  at?: number;
  /** `sign-in`: still needed a sign-in after its attempt (cleared by Sign in, Restart, a URL or switch change); `policy`: for the run. */
  blocked?: 'sign-in' | 'policy';
}

export interface SignInPlanInput {
  /** `send`: a message is about to go (FR-205); `recheck`: the 30-minute status read found a server (FR-212). */
  moment: 'send' | 'recheck';
  /** Monotonic now (main's injected `now()`, `performance.now()` in the app; never `Date.now()`). */
  now: number;
  /** Monotonic time this chat's last response ended in this session; missing = no response yet (moment 1). */
  lastResponseAt?: number;
  /** Monotonic time of the last `powerMonitor` `resume`: a wake after the last response puts the chat past the gap. */
  resumedAt?: number;
  /** The Settings switch, already read (a malformed stored value reads off, FR-213). */
  on: boolean;
  allowReadOnly: boolean;
  readOnly: boolean;
  /** `process.platform` (G3: on macOS only `needs-auth` servers). */
  platform: string;
  /** The adapter has `restartMcpServer` and `capabilities.mcpSignInReconnect` (FR-207). */
  takesPart: boolean;
  /**
   * False when a reconnect cannot renew a sign-in in this chat now: the agent app's OS sandbox covers its MCP servers and is not off
   * (`real:` 2026-11-03, Copilot on Linux, Read-only and Ask first: under its sandbox the reconnect ran but no refresh was made). Then only
   * the sign-in line, as with `allowReadOnly` false. Missing = true.
   */
  renews?: boolean;
  live: boolean;
  /** A turn runs, starts, or waits for the person (spec 041 busy states). */
  busy: boolean;
  servers: readonly SignInServerView[];
  records: Readonly<Record<string, SignInRecordView>>;
  /** Server keys with an automatic reconnect running now, in any chat. */
  inFlight: readonly string[];
}

export interface SignInPlan {
  why: 'off' | 'no-part' | 'not-live' | 'busy' | 'no-moment' | 'first' | 'gap' | 'recheck';
  /** Start one reconnect for each (no other chat runs one for that server). */
  reconnect: { name: string; key: string; kind?: 'renew' }[];
  /** Another chat's reconnect of the same server runs: wait for its result and take it as this chat's own. */
  join: { name: string; key: string }[];
  /** `allowReadOnly` false in Read-only, or `renews` false: no reconnect, only the sign-in line for these names. */
  signInOnly: string[];
}

/* mcpsigninrefresh:begin */
const planMcpSignInRefresh = (i: SignInPlanInput): SignInPlan => {
  const GAP = 60 * 60_000;
  const none = (why: SignInPlan['why']): SignInPlan => ({ why, reconnect: [], join: [], signInOnly: [] });
  if (i.on !== true) return none('off');
  if (!i.takesPart) return none('no-part');
  if (!i.live) return none('not-live');
  if (i.busy) return none('busy');
  let why: SignInPlan['why'];
  if (i.moment === 'recheck') why = 'recheck';
  else if (i.lastResponseAt === undefined) why = 'first';
  else {
    const quiet = i.now - i.lastResponseAt;
    const woke = i.resumedAt !== undefined && i.resumedAt > i.lastResponseAt;
    if (!(quiet >= GAP) && !woke) return none('no-moment');
    why = 'gap';
  }
  const flying = new Set(i.inFlight);
  const out: SignInPlan = { why, reconnect: [], join: [], signInOnly: [] };
  const seen = new Set<string>();
  for (const s of i.servers) {
    if (!s || typeof s.name !== 'string' || seen.has(s.name)) continue;
    seen.add(s.name);
    if (s.off === true || s.status === 'disabled') continue;
    if (!/^(?:http|sse|streamable-?http)$/i.test(typeof s.transport === 'string' ? s.transport : '')) continue; // remote only: never a local (stdio) server
    if (s.signInOpen === true || s.restarting === true || s.policy === true) continue;
    const wants = s.status === 'needs-auth' || (why === 'gap' && s.status === 'connected' && i.platform !== 'darwin');
    if (!wants) continue;
    const rec = Object.prototype.hasOwnProperty.call(i.records, s.key) ? i.records[s.key] : undefined;
    if (rec && rec.blocked) continue;
    if (flying.has(s.key)) {
      out.join.push({ name: s.name, key: s.key });
      continue;
    }
    if (rec && typeof rec.at === 'number' && i.now - rec.at >= 0 && i.now - rec.at < GAP) continue; // one attempt per server per gap, app-wide
    if ((i.readOnly && !i.allowReadOnly) || i.renews === false) {
      if (s.status === 'needs-auth') out.signInOnly.push(s.name);
      continue;
    }
    out.reconnect.push({ name: s.name, key: s.key });
  }
  return out;
};
/* mcpsigninrefresh:end */
export { planMcpSignInRefresh };

export interface RenewPlanInput {
  now: number;
  /** The Settings switch (FR-213), already read. */
  on: boolean;
  /** The adapter has `restartMcpServer`, `mcpSignInReconnect` and `mcpBackgroundRenew` (FR-218). */
  renewable: boolean;
  live: boolean;
  /** See `SignInPlanInput.renews`. */
  renews?: boolean;
  readOnly: boolean;
  allowReadOnly: boolean;
  cooldownMs: number;
  servers: readonly SignInServerView[];
  records: Readonly<Record<string, SignInRecordView>>;
}

export interface RenewPlan {
  why: 'off' | 'no-part' | 'not-live' | 'renew';
  reconnect: { name: string; key: string; kind: 'renew' }[];
  join: { name: string; key: string }[];
  /** No reconnect where `renews` is false: only the sign-in line, for a failed call. */
  signInOnly: string[];
  /** FR-218: marked servers that wait for another call to the same server in this session to end. */
  deferred: string[];
  /** FR-218: a second failure in one episode (the renewal did not help): no more reconnects, the Sign in again state instead. */
  giveUp: { name: string; key: string }[];
}

/**
 * Spec 058 FR-218, FR-219 (2026-11-05; owner 18:03 UTC: renew at once, mid-turn): which servers of one chat to renew now. Only a server
 * that failed with a sign-in error (a failed `auth` call or a report that turned `needs-auth`) is renewed, never on a timer, at once and
 * also during a turn, except that it waits for another call to the same server in this session to end (`callsInFlight`); never a
 * local, built-in, static-header, switched-off, policy or blocked server, never one the person acts on (a sign-in open or starting, a
 * Restart running), one per failure episode and chat (the cooldown), and nothing where a reconnect cannot renew (`renews` false: only the
 * sign-in line). One reconnect at a time per server key across chats is the refresher's queue, not this plan's (a restart acts on one
 * session, so each chat's own is queued, never skipped).
 */
export const planMcpRenew = (i: RenewPlanInput): RenewPlan => {
  const none = (why: RenewPlan['why']): RenewPlan => ({ why, reconnect: [], join: [], signInOnly: [], deferred: [], giveUp: [] });
  if (i.on !== true) return none('off');
  if (!i.renewable) return none('no-part');
  if (!i.live) return none('not-live');
  const out: RenewPlan = none('renew');
  const seen = new Set<string>();
  for (const s of i.servers) {
    if (!s || typeof s.name !== 'string' || seen.has(s.name)) continue;
    seen.add(s.name);
    if (s.off === true || s.status === 'disabled' || s.builtin === true || s.staticAuth === true) continue;
    if (!/^(?:http|sse|streamable-?http)$/i.test(typeof s.transport === 'string' ? s.transport : '')) continue; // remote only
    if (s.signInOpen === true || s.restarting === true || s.policy === true) continue;
    const rec = Object.prototype.hasOwnProperty.call(i.records, s.key) ? i.records[s.key] : undefined;
    if (rec && rec.blocked) continue;
    if (s.failed !== true) continue;
    if (typeof s.triedAt === 'number' && i.now - s.triedAt >= 0 && i.now - s.triedAt < i.cooldownMs) continue; // one reconnect per failure episode, per chat and server
    if (s.repeat === true) {
      out.giveUp.push({ name: s.name, key: s.key }); // the renewal and its note did not help: stop, show Sign in again
      continue;
    }
    if ((i.readOnly && !i.allowReadOnly) || i.renews === false) {
      if (s.status === 'needs-auth') out.signInOnly.push(s.name);
      continue;
    }
    if (s.callsInFlight === true) {
      out.deferred.push(s.name);
      continue;
    }
    out.reconnect.push({ name: s.name, key: s.key, kind: 'renew' });
  }
  return out;
};

export interface CheckPlanInput {
  now: number;
  /** The Settings switch (FR-213), already read. */
  on: boolean;
  /** The adapter has `restartMcpServer`, `mcpSignInReconnect`, `mcpBackgroundRenew` and `listMcpTools`. */
  canCheck: boolean;
  live: boolean;
  /** See `SignInPlanInput.renews`. */
  renews?: boolean;
  servers: readonly SignInServerView[];
  records: Readonly<Record<string, SignInRecordView>>;
  /** Server name -> monotonic time of its last successful call or check in this chat. */
  healthyAt: Readonly<Record<string, number>>;
  /** Names with a renewal queued or running, or a check running, in this chat. */
  busy: readonly string[];
  freshMs: number;
}

/**
 * Spec 058 FR-223, FR-224 (2026-11-05, issue #1205): the servers of one chat to check before a message. Only a remote, connected server
 * that Durbar may act on and that had no successful call or check in the last `freshMs`.
 */
export function planMcpCheck(i: CheckPlanInput): string[] {
  if (i.on !== true || !i.canCheck || !i.live || i.renews === false) return [];
  const busy = new Set(i.busy);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of i.servers) {
    if (!s || typeof s.name !== 'string' || seen.has(s.name)) continue;
    seen.add(s.name);
    if (s.status !== 'connected') continue; // never a server that is not connected: a check must not make the runtime reconnect it
    if (s.off === true || s.builtin === true || s.staticAuth === true) continue;
    if (!/^(?:http|sse|streamable-?http)$/i.test(typeof s.transport === 'string' ? s.transport : '')) continue; // remote only
    if (s.signInOpen === true || s.restarting === true || s.policy === true) continue;
    const rec = Object.prototype.hasOwnProperty.call(i.records, s.key) ? i.records[s.key] : undefined;
    if (rec && rec.blocked) continue;
    if (busy.has(s.name)) continue;
    const ok = Object.prototype.hasOwnProperty.call(i.healthyAt, s.name) ? i.healthyAt[s.name] : undefined;
    if (typeof ok === 'number' && i.now - ok >= 0 && i.now - ok < i.freshMs) continue;
    out.push(s.name);
  }
  return out;
}

/** What a check came to (FR-225): `unauthorized` = the `auth` class; `error` = any other failure (nothing happens). */
export type McpCheckOutcome = 'ok' | 'unauthorized' | 'error';

/** FR-207: what one automatic reconnect came to, from the state the app reports afterwards; no vendor text. */
export type SignInResult = 'reconnected' | 'needs-sign-in' | 'failed' | 'policy';

/**
 * FR-207, FR-210, FR-215: the result of one reconnect. `policy` when main's `policy` matcher classifies the masked error or the server's
 * last call class (FR-193); `needs-sign-in` when the app reads it `needs-auth` (or failed with an auth class) or an elicitation came during
 * the reconnect and was declined; `reconnected` only when it reads `connected` (after a failed call, only in a report that came after
 * the call: `fresh`); anything else `failed`. A Copilot reconnect that rejected
 * while the runtime refreshed reads `connected` on the re-read and counts as reconnected (`real:` T177).
 */
export function signInResult(x: { status?: string; errorClass?: string; policy?: boolean; declined?: boolean; ok?: boolean; fresh?: boolean }): SignInResult {
  if (x.policy === true) return 'policy';
  if (x.declined === true) return 'needs-sign-in';
  // a reconnect that failed with no new report from the app: the old `connected` proves nothing (a Claude CLI that is not running)
  if (x.ok === false && x.fresh === false && x.status === 'connected') return 'failed';
  if (x.status === 'needs-auth' || (x.status === 'failed' && x.errorClass === 'auth')) return 'needs-sign-in';
  return x.status === 'connected' ? 'reconnected' : 'failed';
}

/** What the window gets (names and fixed kinds only, FR-214): one status line per chat, and a sign-in line per server. */
export type SignInRefreshPush = McpSignInRefreshNote;

/** One chat as main sees it now (filled from its own maps). */
export interface SignInChatView {
  adapterId: string;
  takesPart: boolean;
  live: boolean;
  busy: boolean;
  readOnly: boolean;
  /** See `SignInPlanInput.renews`. */
  renews?: boolean;
  /** FR-218: the adapter has `restartMcpServer`, `mcpSignInReconnect` and `mcpBackgroundRenew`. */
  renewable?: boolean;
  /** FR-223: the adapter can answer a server's tool list (`listMcpTools`). */
  canCheck?: boolean;
  /** FR-218: Durbar's own spending limit, or the agent app's usage limit, holds this chat (a coffee break): no automatic message. */
  limited?: boolean;
  /** The chat's last report, built only when the cheap checks (switch, app, running, busy, moment) let a plan go on. */
  servers(): SignInServerView[];
}

export interface SignInTimers {
  set(fn: () => void, ms: number): unknown;
  clear(h: unknown): void;
}

export interface RefresherDeps {
  /** Monotonic clock (`performance.now()` in the app); never the wall clock. */
  now(): number;
  /** The Settings switch (FR-213). */
  on(): boolean;
  platform: string;
  allowReadOnly?: boolean;
  waitMs?: number;
  timers?: SignInTimers;
  /** FR-221: the wall clock, only to show "Renewed 12:40"; never used for a decision. Missing = no time is shown. */
  wall?(): number;
  /** FR-223 (injected in tests): the check's two times (5 minutes fresh, 30 s unknown). */
  checkFreshMs?: number;
  checkTimeoutMs?: number;
  /** FR-223: one real round-trip to the server (`listMcpTools`): never throws a text, only a fixed outcome. Missing = no check. */
  check?(agentId: string, name: string): Promise<McpCheckOutcome>;
  /** FR-227: Settings > Diagnostics. Missing or false = no activity row for a renewal that worked. */
  diagnostics?(): boolean;
  /** FR-218 (injected in tests): the cooldown after a reconnect. */
  failCooldownMs?: number;
  /**
   * FR-218 (owner, 2026-11-05 18:03 UTC): send the agent one short automatic message in this chat (main shows it in the chat and sends it
   * through the adapter's own send, which queues behind a running turn). Missing = no nudge.
   */
  nudge?(agentId: string, name: string): Promise<void>;
  /** The chat now, or undefined for an unknown one. */
  view(agentId: string): SignInChatView | undefined;
  /** The existing per-server restart (`mcpRestartOp`, promise map) in its automatic form; resolves with whether it worked and a masked error. */
  reconnect(agentId: string, name: string): Promise<{ ok: boolean; error?: string; fresh?: boolean }>;
  /** The state the app reports after the reconnect, and whether main's `policy` matcher calls it a policy refusal. */
  after(agentId: string, name: string, error: string | undefined): { status?: string; errorClass?: string; policy?: boolean };
  push(p: SignInRefreshPush): void;
  /** One activity row (spec 052) replacing `mcpRestartOp`'s "MCP server <name> restarted": names and fixed words only. */
  log(agentId: string, line: string): void;
}

const LOG_LINE: Record<SignInResult, (n: string) => string> = {
  reconnected: (n) => `MCP server ${n} reconnected before your message (automatic)`,
  'needs-sign-in': (n) => `MCP server ${n} needs a new sign-in (automatic)`,
  failed: (n) => `MCP server ${n} could not reconnect (automatic)`,
  policy: (n) => `MCP server ${n} was refused by your organization's sign-in rules (automatic)`,
};

/** FR-221: the activity row of a renewal that worked (names and fixed words only). */
const RENEW_LOG = (n: string): string => `MCP server ${n} renewed (automatic)`;

const keyPrefix = (adapterId: string, name: string): string => `${adapterId}\0${name}\0`;
/** FR-210: one flight and one record per adapter, server name and server address (a URL change is a new key: no block carried over). */
export const signInKey = (adapterId: string, name: string, url: string | undefined): string => keyPrefix(adapterId, name) + (url ?? '');

/**
 * Main's side of FR-205..FR-210. Memory only: Durbar restarting forgets every mark and block.
 */
export class McpSignInRefresher {
  /** FR-205: when each chat's last response ended (monotonic), this session only. */
  private readonly lastResponse = new Map<string, number>();
  private resumedAt: number | undefined;
  /** FR-209: per chat, the reconnects one send or recheck started or joined; every send path awaits it. */
  private readonly reconnecting = new Map<string, Promise<void>>();
  /** FR-210: per server key, the one automatic reconnect that runs, across chats. */
  private readonly flights = new Map<string, Promise<SignInResult>>();
  private readonly records = new Map<string, SignInRecordView>();
  /** Chats whose send waits now: Stop ends the wait. */
  private readonly waits = new Map<string, () => void>();
  /** `<agent id>\0<server>` under an automatic reconnect now (FR-215: an elicitation from it is declined). */
  private readonly auto = new Set<string>();
  private readonly declined = new Set<string>();
  /** FR-218: per chat, the servers marked by a failure that wait for another call to the same server to end (a set: both triggers of one episode are one). */
  private readonly pending = new Map<string, Set<string>>();
  /** The status each server had in a chat's last report: a server that turns `needs-auth` after `connected` is a failure (FR-218). */
  private readonly lastStatus = new Map<string, Map<string, string>>();
  /** FR-218: `<agent id>\0<server>` -> the ids of the tool calls to that server that run now in that session. */
  private readonly calls = new Map<string, Set<string>>();
  /** FR-218: how often the person stopped each chat, and the count when each server's failure came (a Stop after it: no nudge). */
  private readonly stops = new Map<string, number>();
  private readonly failStops = new Map<string, number>();
  /** FR-218: `<agent id>\0<server>` of a note sent after which no call to that server has succeeded in that chat (no further note, a second failure gives up). */
  private readonly nudged = new Set<string>();
  /** FR-218: the renewals of a chat that are queued or running, by `<agent id>\0<server>` (the person's own action cancels a queued one and waits for a running one). */
  private readonly renewing = new Map<string, { started: boolean; cancelled: boolean; done: Promise<unknown> }>();
  /** FR-218: per chat, the send gate that runs now (a nudge waits behind it). */
  private readonly gating = new Map<string, Promise<void>>();
  /** FR-221: `<agent id>\0<server>` -> wall time of the last renewal that read connected (display only). */
  private readonly renewedWall = new Map<string, number>();
  /** FR-218: `<agent id>\0<server key>` -> monotonic time of the last automatic renewal tried from that chat (the cooldown). */
  private readonly renewAt = new Map<string, number>();
  /** FR-224: `<agent id>\0<server>` -> monotonic time of the last successful call or check. */
  private readonly healthyAt = new Map<string, number>();
  /** FR-223: checks that run now. */
  private readonly checking = new Set<string>();
  /** FR-225: servers whose last check got no answer in time (the dialog row says so) until a call or check succeeds. */
  private readonly unknown = new Set<string>();
  /** FR-225: reconnects started by a check: no note to the agent (it never failed), and the "Reconnecting" line. */
  private readonly checkOnly = new Set<string>();
  /** FR-223: chats whose start check ran. */
  private readonly startChecked = new Set<string>();
  /** FR-210, FR-218: per server key, the tail of the queue of reconnects: one at a time across chats (rotating refresh tokens), each chat's own restart still runs. */
  private readonly keyLock = new Map<string, Promise<void>>();

  constructor(private readonly d: RefresherDeps) {}

  /** FR-205: a turn ended (`idle`, `error`, `stopped` from the adapter). */
  turnEnded(agentId: string): void {
    this.lastResponse.set(agentId, this.d.now());
    this.clearCalls(agentId); // a call that never reported its end (an abort) must not hold a renewal for ever
  }

  private clearCalls(agentId: string): void {
    const p = `${agentId}\0`;
    for (const k of [...this.calls.keys()]) if (k.startsWith(p)) this.calls.delete(k);
    if (this.pending.has(agentId)) this.renewChat(agentId); // a mark that waited for such a call goes on
  }

  private timers(): SignInTimers {
    return this.d.timers ?? {
      set: (fn: () => void, ms: number) => {
        const h = setTimeout(fn, ms);
        (h as { unref?: () => void }).unref?.(); // a pending check never keeps the program alive
        return h;
      },
      clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
    };
  }

  /**
   * FR-218: a tool call to an MCP server of a chat started or ended (ids and names only). A renewal of a server waits until no other call
   * to it runs in that session; when the last one ends, a waiting mark goes on.
   */
  noteCall(agentId: string, name: string, callId: string, phase: 'start' | 'end' | 'ok'): void {
    const k = `${agentId}\0${name}`;
    if (phase === 'ok') {
      this.nudged.delete(k); // a call to this server succeeded: the next failure is a new episode
      this.markHealthy(k);
    }
    if (phase === 'start') {
      let set = this.calls.get(k);
      if (!set) this.calls.set(k, (set = new Set()));
      if (set.size < 500) set.add(callId);
      return;
    }
    const set = this.calls.get(k);
    if (set?.delete(callId) && !set.size) {
      this.calls.delete(k);
      if (this.pending.get(agentId)?.has(name)) this.renewChat(agentId); // the last other call ended: the waiting renewal goes
    }
  }

  /** FR-218: the person pressed Stop (or the session ended): a failure from before it is never followed by a nudge. */
  noteStop(agentId: string): void {
    this.stops.set(agentId, (this.stops.get(agentId) ?? 0) + 1);
    this.clearCalls(agentId); // after a Stop no tool call of the aborted turn is going to end
  }

  /**
   * FR-218, second trigger (`real:` probe 2026-11-05: the runtime's `needs-auth` status event came right after the first 401 while its
   * list still said `connected`): an `mcp` report in which a server that read `connected` in the last one now needs a sign-in. A
   * server that was never connected in this chat (a first sign-in) is not a failure. Names and statuses only.
   */
  noteServers(agentId: string, servers: ReadonlyArray<{ name: string; status?: string; errorClass?: string }>): void {
    const prev = this.lastStatus.get(agentId);
    const next = new Map<string, string>();
    for (const x of servers) {
      if (!x || typeof x.name !== 'string') continue;
      const st = typeof x.status === 'string' ? x.status : '';
      next.set(x.name, st);
      if (st === 'connected') this.dropMark(agentId, x.name); // a later report that says connected: the failure is over
      if (prev?.get(x.name) === 'connected' && (st === 'needs-auth' || (st === 'failed' && x.errorClass === 'auth'))) this.noteFailure(agentId, x.name);
    }
    this.lastStatus.set(agentId, next);
    if (!this.startChecked.has(agentId) && servers.some((x) => x && x.status === 'connected')) {
      this.startChecked.add(agentId); // FR-223: a new chat's first report with a connected server
      this.checkChat(agentId);
    }
  }

  private markHealthy(tag: string): void {
    this.unknown.delete(tag);
    try {
      if (this.healthyAt.size < 5000) this.healthyAt.set(tag, this.d.now());
    } catch {
      /* no clock: nothing is skipped */
    }
  }

  /** FR-225: the last check of this server got no answer in time (the row says *Did not answer a check*). */
  checkUnknown(agentId: string, name: string): boolean {
    return this.unknown.has(`${agentId}\0${name}`);
  }

  /**
   * FR-223, FR-224: check the chat's remote sign-in servers now, **in parallel** (this returns at once; the message is never held). Every
   * failure inside is swallowed: a check never throws into a send.
   */
  checkChat(agentId: string): void {
    try {
      const d = this.d.check;
      if (!d) return;
      let v: SignInChatView | undefined;
      let on = false;
      try {
        v = this.d.view(agentId);
        on = this.d.on() === true;
      } catch {
        return;
      }
      if (!v || !on) return;
      const input: CheckPlanInput = {
        now: this.d.now(),
        on,
        canCheck: v.takesPart && v.renewable === true && v.canCheck === true,
        live: v.live,
        ...(v.renews === false ? { renews: false } : {}),
        servers: [],
        records: {},
        healthyAt: {},
        busy: [],
        freshMs: this.d.checkFreshMs ?? MCP_CHECK_FRESH_MS,
      };
      if (planMcpCheck({ ...input, servers: [{ name: '-', status: 'connected', transport: 'http', key: '-' }] }).length === 0) return; // the cheap checks first
      let servers: SignInServerView[] = [];
      try {
        servers = v.servers();
      } catch {
        return;
      }
      const records: Record<string, SignInRecordView> = {};
      const healthy: Record<string, number> = {};
      const busy: string[] = [];
      for (const x of servers) {
        const r = this.records.get(x.key);
        if (r) records[x.key] = r;
        const tag = `${agentId}\0${x.name}`;
        const h = this.healthyAt.get(tag);
        if (h !== undefined) healthy[x.name] = h;
        if (this.checking.has(tag) || this.renewing.has(tag) || this.pending.get(agentId)?.has(x.name)) busy.push(x.name);
      }
      for (const name of planMcpCheck({ ...input, servers, records, healthyAt: healthy, busy })) void this.checkOne(agentId, name, d);
    } catch {
      /* a check never reaches the send */
    }
  }

  private async checkOne(agentId: string, name: string, check: (agentId: string, name: string) => Promise<McpCheckOutcome>): Promise<void> {
    const tag = `${agentId}\0${name}`;
    if (this.checking.size >= 500) return;
    this.checking.add(tag);
    const t = this.timers();
    let timer: unknown;
    let out: McpCheckOutcome | 'unknown';
    try {
      out = await new Promise<McpCheckOutcome | 'unknown'>((resolve) => {
        timer = t.set(() => resolve('unknown'), this.d.checkTimeoutMs ?? MCP_CHECK_TIMEOUT_MS);
        let p: Promise<McpCheckOutcome>;
        try {
          p = check(agentId, name);
        } catch {
          resolve('error');
          return;
        }
        p.then((r) => resolve(r === 'ok' || r === 'unauthorized' ? r : 'error'), () => resolve('error'));
      });
    } finally {
      t.clear(timer);
      this.checking.delete(tag);
    }
    let alive = false;
    let on = false;
    try {
      alive = !!this.d.view(agentId);
      on = this.d.on() === true;
    } catch {
      return;
    }
    if (!alive || !on) return; // the chat ended or the switch went off while it ran
    if (out === 'ok') {
      this.markHealthy(tag);
      this.nudged.delete(tag); // as a successful call: the next failure is a new episode
    } else if (out === 'unknown') {
      if (this.unknown.size < 500) this.unknown.add(tag);
    } else if (out === 'unauthorized') {
      this.unknown.delete(tag);
      this.healthyAt.delete(tag);
      this.checkOnly.add(tag);
      this.noteFailure(agentId, name, true);
      if (!this.renewing.has(tag) && !this.pending.get(agentId)?.has(name)) this.checkOnly.delete(tag); // nothing started (cooldown, blocked): no mark stays
    }
  }

  /**
   * FR-218, first trigger: a call of this server failed with the `auth` class. Either trigger marks the server for one reconnect, which
   * starts at once, during a turn too (owner, 2026-11-05 18:03 UTC); both for one episode are one mark (a set), and the cooldown keeps a
   * later one from a second reconnect.
   */
  noteFailure(agentId: string, name: string, fromCheck = false): void {
    if (!fromCheck) this.checkOnly.delete(`${agentId}\0${name}`); // FR-225: the agent's own call failed: FR-218's note applies after the reconnect
    let set = this.pending.get(agentId);
    if (!set) this.pending.set(agentId, (set = new Set()));
    if (set.size < 200) set.add(name);
    this.failStops.set(`${agentId}\0${name}`, this.stops.get(agentId) ?? 0);
    this.renewChat(agentId);
  }

  private dropMark(agentId: string, name: string): void {
    const set = this.pending.get(agentId);
    if (set?.delete(name) && !set.size) this.pending.delete(agentId);
  }

  /** FR-221: the person pressed Restart or Sign in, or switched the server: a waiting failure mark is no longer wanted. */
  clearPending(agentId: string | undefined, name: string): void {
    const cancel = (id: string): void => {
      const r = this.renewing.get(`${id}\0${name}`);
      if (r && !r.started) r.cancelled = true; // queued, not yet running: it never starts
    };
    if (agentId !== undefined) {
      cancel(agentId);
      return this.dropMark(agentId, name);
    }
    for (const id of [...new Set([...this.pending.keys(), ...[...this.renewing.keys()].map((k) => k.split('\0')[0])])]) {
      cancel(id);
      this.dropMark(id, name); // a global switch: every chat
    }
  }

  /** FR-218: resolves when no renewal of this server is running in this chat (Sign in again waits for it, so the two never overlap). */
  quiesce(agentId: string, name: string): Promise<void> {
    const r = this.renewing.get(`${agentId}\0${name}`);
    return r ? r.done.then(() => undefined, () => undefined) : Promise.resolve();
  }

  /** FR-221: End session, Restart session, a stopped or removed chat: its waiting failures and "Renewed" times go. */
  dropChat(agentId: string): void {
    this.lastStatus.delete(agentId);
    this.pending.delete(agentId);
    this.stops.delete(agentId);
    this.startChecked.delete(agentId);
    const p = `${agentId}\0`;
    for (const k of [...this.unknown, ...this.checkOnly, ...this.checking]) if (k.startsWith(p)) { this.unknown.delete(k); this.checkOnly.delete(k); this.checking.delete(k); }
    for (const m of [this.renewedWall, this.renewAt, this.calls, this.failStops, this.healthyAt] as Map<string, unknown>[]) for (const k of [...m.keys()]) if (k.startsWith(p)) m.delete(k);
    for (const k of [...this.nudged]) if (k.startsWith(p)) this.nudged.delete(k);
  }

  /** FR-220: when Durbar last renewed this server in this chat (wall clock, display only), or undefined. */
  renewedAt(agentId: string, name: string): number | undefined {
    return this.renewedWall.get(`${agentId}\0${name}`);
  }

  /** The renewal plan of one chat now (the servers are built only when the cheap checks let it go on). */
  planRenew(agentId: string): { plan: RenewPlan; view?: SignInChatView } {
    const empty: RenewPlan = { why: 'not-live', reconnect: [], join: [], signInOnly: [], deferred: [], giveUp: [] };
    let v: SignInChatView | undefined;
    try {
      v = this.d.view(agentId);
    } catch {
      v = undefined;
    }
    if (!v) {
      this.dropChat(agentId); // a chat main no longer knows (removed)
      return { plan: empty };
    }
    let on = false;
    try {
      on = this.d.on() === true;
    } catch {
      on = false; // fail closed
    }
    const input: RenewPlanInput = {
      now: this.d.now(),
      on,
      renewable: v.takesPart && v.renewable === true,
      live: v.live,
      ...(v.renews === false ? { renews: false } : {}),
      readOnly: v.readOnly,
      allowReadOnly: this.d.allowReadOnly ?? MCP_SIGNIN_ALLOW_READ_ONLY,
      cooldownMs: this.d.failCooldownMs ?? MCP_RENEW_FAIL_COOLDOWN_MS,
      servers: [],
      records: {},
    };
    const pre = planMcpRenew(input);
    if (pre.why !== 'renew') return { plan: pre, view: v };
    let servers: SignInServerView[] = [];
    try {
      servers = v.servers();
    } catch {
      servers = [];
    }
    const waiting = this.pending.get(agentId);
    const records: Record<string, SignInRecordView> = {};
    const out: SignInServerView[] = servers.map((x) => {
      const r = this.records.get(x.key);
      if (r) records[x.key] = r;
      const tried = this.renewAt.get(`${agentId}\0${x.key}`);
      return { ...x, ...(tried !== undefined ? { triedAt: tried } : {}), ...(this.calls.has(`${agentId}\0${x.name}`) ? { callsInFlight: true } : {}), ...(this.nudged.has(`${agentId}\0${x.name}`) ? { repeat: true } : {}), ...(waiting?.has(x.name) ? { failed: true } : {}) };
    });
    return { plan: planMcpRenew({ ...input, servers: out, records }), view: v };
  }

  /**
   * FR-218: renew what failed in one chat, at once. A mark stays only for a server that waits for another call to it to end; the end of
   * that call (`noteCall`) looks again.
   */
  renewChat(agentId: string): void {
    const { plan } = this.planRenew(agentId);
    if (plan.why === 'renew') {
      if (plan.deferred.length) this.pending.set(agentId, new Set(plan.deferred));
      else this.pending.delete(agentId);
      for (const g of plan.giveUp) {
        // the renewal and its note did not help (the restart read connected, the calls still fail: a revoked refresh token): stop here
        this.records.set(g.key, { at: this.d.now(), blocked: 'sign-in' });
        this.d.log(agentId, `MCP server ${g.name} needs a new sign-in (automatic)`);
        this.d.push({ id: agentId, kind: 'needs-sign-in', name: g.name });
      }
      this.run(agentId, plan);
    } else this.pending.delete(agentId);
  }

  /**
   * FR-218: after a renewal that read `connected`, the agent gets one short note to retry the step that failed, once (one renewal per
   * failure episode: the cooldown), only when the switch is on, the chat is running and not at a spending limit, and the person did not
   * press Stop since the failure; behind a send of the person's that is at the gate. A failed renewal sends nothing.
   */
  private nudge(agentId: string, name: string): void {
    const d = this.d.nudge;
    if (!d) return;
    const tag = `${agentId}\0${name}`;
    const at = this.failStops.get(tag);
    const stopped = (): boolean => at !== undefined && at !== (this.stops.get(agentId) ?? 0);
    void (async (): Promise<void> => {
      if (stopped()) return;
      const g = this.gating.get(agentId);
      if (g) await g;
      let v: SignInChatView | undefined;
      let on = false;
      try {
        v = this.d.view(agentId);
        on = this.d.on() === true;
      } catch {
        return;
      }
      if (!on || !v || !v.live || v.limited === true || stopped()) return;
      this.nudged.add(tag);
      this.d.push({ id: agentId, kind: 'nudged', name }); // said before the send
      try {
        await d(agentId, name);
      } catch {
        this.d.push({ id: agentId, kind: 'nudge-failed', name }); // the message was not sent: marked so
      }
    })();
  }

  /** FR-205: `powerMonitor` `resume`: every chat is past the gap (a monotonic clock may not count sleep). */
  resumed(): void {
    this.resumedAt = this.d.now();
  }

  /** T179: End session, Restart session or a removed chat: the next message is a first message again. */
  forget(agentId: string): void {
    this.lastResponse.delete(agentId);
    this.dropChat(agentId);
  }

  /** FR-210: the person signed in, pressed Restart, or switched the server: automatic reconnects may try it again. Policy blocks stay. */
  clearBlock(adapterId: string | undefined, name: string): void {
    for (const [k, r] of this.records) {
      if (r.blocked !== 'sign-in') continue;
      const [ad, n] = k.split('\0');
      if (n === name && (adapterId === undefined || ad === adapterId)) this.records.delete(k);
    }
  }

  /** FR-215: the server of an elicitation now under an automatic reconnect of this chat, while no turn runs. */
  underAuto(agentId: string, name: string): boolean {
    return this.auto.has(`${agentId}\0${name}`);
  }

  /** FR-215: an elicitation from a server under an automatic reconnect was declined: that reconnect reads `needs-sign-in`. */
  noteDeclined(agentId: string, name: string): void {
    this.declined.add(`${agentId}\0${name}`);
  }

  /** FR-208: Stop during the wait ends it; true when a wait was running. */
  stopWait(agentId: string): boolean {
    const f = this.waits.get(agentId);
    if (!f) return false;
    f();
    return true;
  }

  /** Test and debug view: the record of one key (a copy). */
  recordOf(key: string): SignInRecordView | undefined {
    const r = this.records.get(key);
    return r ? { ...r } : undefined;
  }

  /** Server keys with a reconnect running now. */
  inFlight(): string[] {
    return [...this.flights.keys()];
  }

  /** The plan for one chat now (the same input every caller builds). */
  plan(agentId: string, moment: 'send' | 'recheck'): { plan: SignInPlan; view?: SignInChatView } {
    const empty: SignInPlan = { why: 'not-live', reconnect: [], join: [], signInOnly: [] };
    this.prune();
    let v: SignInChatView | undefined;
    try {
      v = this.d.view(agentId);
    } catch {
      v = undefined;
    }
    if (!v) {
      this.lastResponse.delete(agentId); // a chat main no longer knows (removed): its mark goes
      return { plan: empty };
    }
    let on = false;
    try {
      on = this.d.on() === true;
    } catch {
      on = false; // fail closed
    }
    const input: SignInPlanInput = {
      moment,
      now: this.d.now(),
      lastResponseAt: this.lastResponse.get(agentId),
      resumedAt: this.resumedAt,
      on,
      allowReadOnly: this.d.allowReadOnly ?? MCP_SIGNIN_ALLOW_READ_ONLY,
      readOnly: v.readOnly,
      platform: this.d.platform,
      takesPart: v.takesPart,
      ...(v.renews === false ? { renews: false } : {}),
      live: v.live,
      busy: v.busy,
      servers: [],
      records: {},
      inFlight: [...this.flights.keys()],
    };
    // review of PR #1080 (item 7): the same planner first with no servers; only a plan that would go on builds the chat's server list
    const pre = planMcpSignInRefresh(input);
    if (pre.why === 'off' || pre.why === 'no-part' || pre.why === 'not-live' || pre.why === 'busy' || pre.why === 'no-moment') return { plan: pre, view: v };
    let servers: SignInServerView[] = [];
    try {
      servers = v.servers();
    } catch {
      servers = [];
    }
    const records: Record<string, SignInRecordView> = {};
    for (const s of servers) {
      const r = this.records.get(s.key);
      if (r) records[s.key] = r;
    }
    return { plan: planMcpSignInRefresh({ ...input, servers, records }), view: v };
  }

  /** Review of PR #1080 (item 7): records that can no longer change a plan go (an attempt older than the gap, not blocked). */
  private prune(): void {
    const now = this.d.now();
    for (const [k, r] of this.records) if (!r.blocked && typeof r.at === 'number' && !(now - r.at >= 0 && now - r.at < MCP_SIGNIN_GAP_MS)) this.records.delete(k);
  }

  /** Test view: how many server records main keeps. */
  recordCount(): number {
    return this.records.size;
  }

  /** Start (or join) the reconnects of a plan; resolves when all of them settled. Sign-in lines go to the window as results come. */
  run(agentId: string, plan: Pick<SignInPlan, 'reconnect' | 'join' | 'signInOnly'>): { items: { name: string; f: Promise<SignInResult | 'skipped'> }[]; done: Promise<void> } | undefined {
    const work: Promise<void>[] = [];
    const items: { name: string; f: Promise<SignInResult | 'skipped'> }[] = [];
    const take = (name: string, f: Promise<SignInResult | 'skipped'>): void => {
      items.push({ name, f });
      work.push(f.then((r) => {
        if (r === 'skipped') return; // it did not run (the person acted, or a call is running): the mark stays as it was put
        if (r === 'needs-sign-in') this.d.push({ id: agentId, kind: 'needs-sign-in', name });
      }, () => this.dropMark(agentId, name)));
    };
    for (const r of plan.reconnect) take(r.name, this.fly(agentId, r.name, r.key, r.kind));
    for (const j of plan.join) {
      const f = this.flights.get(j.key);
      if (f) take(j.name, f);
    }
    for (const n of plan.signInOnly) this.d.push({ id: agentId, kind: 'needs-sign-in', name: n });
    if (!work.length) return undefined;
    const done = Promise.all(work).then(() => undefined);
    const prior = this.reconnecting.get(agentId);
    const mine = prior ? Promise.all([prior, done]).then(() => undefined) : done;
    this.reconnecting.set(agentId, mine);
    const clear = (): void => {
      if (this.reconnecting.get(agentId) === mine) this.reconnecting.delete(agentId);
    };
    mine.then(clear, clear);
    return { items, done };
  }

  /**
   * FR-208, FR-209: what every send path awaits first. Plans this send, starts or joins its reconnects, and waits for them and for any
   * reconnect of this chat already running (a recheck's), at most `waitMs` in total. `stopped` = Stop during the wait: nothing is sent.
   */
  async beforeSend(agentId: string): Promise<'go' | 'stopped'> {
    this.checkChat(agentId); // FR-223: beside the send, never awaited
    const open = this.gate(agentId);
    const mine = open.then(() => undefined, () => undefined);
    this.gating.set(agentId, mine); // FR-218: a nudge waits behind this send
    void mine.then(() => {
      if (this.gating.get(agentId) === mine) this.gating.delete(agentId);
    });
    try {
      return await open;
    } catch {
      return 'go'; // review of PR #1080 (item 4): a gate that fails never holds a message: it goes as if there were nothing to wait for
    }
  }

  private async gate(agentId: string): Promise<'go' | 'stopped'> {
    const prior = this.reconnecting.get(agentId);
    const { plan } = this.plan(agentId, 'send');
    // review of PR #1080 (item 2): a message while a turn runs (a steer, a queued message) goes at once: no wait, not even for an earlier
    // reconnect, so Stop never ends a wait while that turn runs on
    if (plan.why === 'busy') return 'go';
    const started = this.run(agentId, plan);
    const waitFor = this.reconnecting.get(agentId) ?? prior;
    if (!waitFor) return 'go'; // nothing to wait for: no line
    const pending = new Set((started?.items ?? []).map((x) => x.name));
    for (const x of started?.items ?? []) x.f.then(() => pending.delete(x.name), () => pending.delete(x.name));
    this.d.push({ id: agentId, kind: 'waiting', count: Math.max(1, pending.size) });
    const t = this.d.timers ?? { set: (fn: () => void, ms: number) => setTimeout(fn, ms), clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) };
    let timer: unknown;
    let stop: (() => void) | undefined;
    const outcome = await new Promise<'done' | 'late' | 'stopped'>((resolve) => {
      stop = () => resolve('stopped');
      this.waits.set(agentId, stop);
      timer = t.set(() => resolve('late'), this.d.waitMs ?? MCP_SIGNIN_WAIT_MS);
      waitFor.then(() => resolve('done'), () => resolve('done'));
    });
    t.clear(timer);
    if (this.waits.get(agentId) === stop) this.waits.delete(agentId);
    if (outcome === 'stopped') {
      this.d.push({ id: agentId, kind: 'not-sent' });
      return 'stopped';
    }
    if (outcome === 'late') {
      const left = [...pending];
      this.d.push({ id: agentId, kind: 'late', names: left });
      return 'go';
    }
    this.d.push({ id: agentId, kind: 'done' });
    return 'go';
  }

  /** FR-210, FR-218: one at a time per server key across chats; a queued reconnect starts when the one before it settled. */
  private serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.keyLock.get(key) ?? Promise.resolve();
    const run = prev.then(fn);
    const tail = run.then(() => undefined, () => undefined);
    this.keyLock.set(key, tail);
    void tail.then(() => {
      if (this.keyLock.get(key) === tail) this.keyLock.delete(key);
    });
    return run;
  }

  /**
   * FR-210: one reconnect at a time per server key across chats. A reconnect for the send (FR-205) is shared by the chats that need the
   * same server (a running one is joined). A renewal (FR-218) is never shared: `restartServer` acts on one session, so each chat's own
   * restart is queued behind the one that runs. Its result updates the records and the activity log.
   */
  private fly(agentId: string, name: string, key: string, kind?: 'renew'): Promise<SignInResult | 'skipped'> {
    if (kind !== 'renew') {
      const running = this.flights.get(key);
      if (running) return running;
    }
    const tag = `${agentId}\0${name}`;
    const ctl = { started: false, cancelled: false, done: Promise.resolve() as Promise<unknown> };
    if (kind === 'renew') {
      this.renewAt.set(`${agentId}\0${key}`, this.d.now()); // at once: a trigger of the same episode that comes next is inside the cooldown
      this.renewing.set(tag, ctl);
    }
    const f = this.serial(key, async (): Promise<SignInResult | 'skipped'> => {
      if (kind === 'renew') {
        // the person acted on this server while this renewal waited in the queue: it never starts
        if (ctl.cancelled) return 'skipped';
        // FR-218: a new call to this server started in this chat while this one waited: put the mark back, the call's end goes on
        if (this.calls.has(tag)) {
          this.renewAt.delete(`${agentId}\0${key}`);
          let set = this.pending.get(agentId);
          if (!set) this.pending.set(agentId, (set = new Set()));
          set.add(name);
          return 'skipped';
        }
        ctl.started = true;
        if (this.checkOnly.has(tag)) this.d.push({ id: agentId, kind: 'reconnecting', name }); // FR-226: only while a reconnect from a check runs
      }
      this.auto.add(tag);
      this.declined.delete(tag);
      const at = this.d.now();
      let r: { ok: boolean; error?: string; fresh?: boolean } = { ok: false };
      try {
        r = await this.d.reconnect(agentId, name);
      } catch {
        r = { ok: false };
      }
      let st: { status?: string; errorClass?: string; policy?: boolean } = {};
      try {
        st = this.d.after(agentId, name, r.ok ? undefined : r.error);
      } catch {
        st = {};
      }
      const res = signInResult({ ...st, ok: r.ok, fresh: r.fresh, declined: this.declined.has(tag) });
      const fromCheck = kind === 'renew' && this.checkOnly.has(tag);
      if (fromCheck) this.d.push({ id: agentId, kind: 'reconnect-end', name }); // FR-226: the line goes whatever the result
      this.records.set(key, res === 'needs-sign-in' ? { at, blocked: 'sign-in' } : res === 'policy' ? { at, blocked: 'policy' } : { at });
      if (res === 'reconnected') {
        // FR-220: a renewal that reads connected is shown on the row (wall time, display only), for a chat that still exists
        try {
          const w = this.d.wall?.();
          if (typeof w === 'number' && Number.isFinite(w) && this.d.view(agentId)) this.renewedWall.set(tag, w);
        } catch {
          /* no time shown */
        }
      }
      const renewed = kind === 'renew' && res === 'reconnected';
      let diag = false;
      try {
        diag = this.d.diagnostics?.() === true;
      } catch {
        diag = false;
      }
      if (!renewed || diag) this.d.log(agentId, renewed ? RENEW_LOG(name) : LOG_LINE[res](name)); // FR-227: the row of a renewal that worked only with Diagnostics
      if (renewed) {
        if (fromCheck && this.checkOnly.has(tag)) this.nudged.add(tag); // no note (the agent never failed); a repeat of the failure still stops here (FR-218)
        else this.nudge(agentId, name);
      }
      return res;
    });
    ctl.done = f;
    if (kind !== 'renew') this.flights.set(key, f as Promise<SignInResult>);
    const end = (): void => {
      if (this.flights.get(key) === f) this.flights.delete(key);
      if (this.renewing.get(tag) === ctl) {
        this.renewing.delete(tag);
        if (!this.pending.get(agentId)?.has(name)) this.checkOnly.delete(tag); // a renewal put back to wait for a call stays a check's
      }
      this.auto.delete(tag);
      this.declined.delete(tag);
    };
    f.then(end, end);
    return f;
  }
}

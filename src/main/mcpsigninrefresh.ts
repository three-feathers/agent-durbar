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
  reconnect: { name: string; key: string }[];
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

  constructor(private readonly d: RefresherDeps) {}

  /** FR-205: a turn ended (`idle`, `error`, `stopped` from the adapter). */
  turnEnded(agentId: string): void {
    this.lastResponse.set(agentId, this.d.now());
  }

  /** FR-205: `powerMonitor` `resume`: every chat is past the gap (a monotonic clock may not count sleep). */
  resumed(): void {
    this.resumedAt = this.d.now();
  }

  /** T179: End session, Restart session or a removed chat: the next message is a first message again. */
  forget(agentId: string): void {
    this.lastResponse.delete(agentId);
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
  run(agentId: string, plan: SignInPlan): { items: { name: string; f: Promise<SignInResult> }[]; done: Promise<void> } | undefined {
    const work: Promise<void>[] = [];
    const items: { name: string; f: Promise<SignInResult> }[] = [];
    const take = (name: string, f: Promise<SignInResult>): void => {
      items.push({ name, f });
      work.push(f.then((r) => {
        if (r === 'needs-sign-in') this.d.push({ id: agentId, kind: 'needs-sign-in', name });
      }, () => undefined));
    };
    for (const r of plan.reconnect) take(r.name, this.fly(agentId, r.name, r.key));
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
    try {
      return await this.gate(agentId);
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

  /** FR-210: one reconnect per server key across chats; its result updates the records and the activity log. */
  private fly(agentId: string, name: string, key: string): Promise<SignInResult> {
    const running = this.flights.get(key);
    if (running) return running;
    const tag = `${agentId}\0${name}`;
    this.auto.add(tag);
    this.declined.delete(tag);
    const at = this.d.now();
    const f = (async (): Promise<SignInResult> => {
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
      this.records.set(key, res === 'needs-sign-in' ? { at, blocked: 'sign-in' } : res === 'policy' ? { at, blocked: 'policy' } : { at });
      this.d.log(agentId, LOG_LINE[res](name));
      return res;
    })();
    this.flights.set(key, f);
    const end = (): void => {
      if (this.flights.get(key) === f) this.flights.delete(key);
      this.auto.delete(tag);
      this.declined.delete(tag);
    };
    f.then(end, end);
    return f;
  }
}

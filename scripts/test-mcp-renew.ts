/**
 * Spec 058 FR-218..FR-222 (T191, T194; 2026-11-05): renewing a remote MCP sign-in after a failure, in the background, by behaviour.
 * An injected monotonic clock, injected timers and a fake adapter side (`reconnect`, `after`): no runtime, no network, no credits.
 *  - triggers: a failed `auth` call; a report that turns `needs-auth` after `connected`; both for one episode = one reconnect; a first
 *    sign-in (never connected) is no failure;
 *  - idle: nothing during a turn or a send, then one reconnect at the first idle moment (turn end, the short look after it);
 *  - one reconnect per server across chats; the cooldown (one per episode); a failed reconnect is blocked, no retry loop;
 *  - skipped: local, built-in, static-header, switched-off, disabled, policy, sign-in-open and restarting servers, a sandboxed chat (only
 *    the sign-in line), an adapter without `mcpBackgroundRenew`, the Settings switch off; no timer and no renewal by the clock alone;
 *  - seamless: no chat line for a success, the activity row, "Renewed" time (wall clock) per chat, dropped with the chat;
 *  - the refresher never sends a message: its dependencies hold no send.
 * `npm run test:mcpsigninrefresh`.
 */
process.exitCode = 1;
import * as assert from 'assert';
import { McpSignInRefresher, planMcpRenew, signInKey } from '../src/main/mcpsigninrefresh';
import type { RefresherDeps, RenewPlanInput, SignInChatView, SignInRefreshPush, SignInServerView } from '../src/main/mcpsigninrefresh';

const H = 60 * 60_000;
const tick = async (n = 8): Promise<void> => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const srv = (name: string, status: string, more: Partial<SignInServerView> = {}): SignInServerView => ({ name, status, transport: 'http', key: signInKey('copilot', name, `https://${name}.example/mcp`), ...more });
type Timer = { fn: () => void; ms: number; done: boolean };

const make = (o: { hang?: boolean } = {}) => {
  const t = { now: 50 * H };
  const pushes: SignInRefreshPush[] = [];
  const logs: string[] = [];
  const calls: string[] = [];
  const timers: Timer[] = [];
  const chats = new Map<string, SignInChatView>();
  const finish = new Map<string, (status: string) => void>();
  const status = new Map<string, string>();
  const touched = new Set<string>();
  const real: RefresherDeps = {
    now: () => t.now,
    on: () => on.v,
    platform: 'linux',
    wall: () => 1_700_000_000_000,
    timers: { set: (fn, ms) => { const h = { fn, ms, done: false }; timers.push(h); return h; }, clear: (h) => { (h as Timer).done = true; } },
    view: (id) => chats.get(id),
    reconnect: (id, name) => {
      calls.push(`${id}:${name}`);
      if (o.hang) return new Promise((r) => finish.set(`${id}:${name}`, (st) => { status.set(name, st); r({ ok: st === 'connected' }); }));
      return Promise.resolve().then(() => ((status.get(name) ?? 'connected') === 'connected' ? { ok: true } : { ok: false, error: 'requires authentication' }));
    },
    after: (_id, name) => ({ status: status.get(name) ?? 'connected' }),
    push: (p) => pushes.push(p),
    log: (_id, line) => logs.push(line),
  };
  const on = { v: true };
  // "no auto-retry of the message": the dependencies hold no send; any property the refresher reads must be one of these
  const allowed = new Set(['now', 'on', 'platform', 'wall', 'timers', 'view', 'reconnect', 'after', 'push', 'log', 'allowReadOnly', 'waitMs', 'sendQuietMs', 'failCooldownMs']);
  const d = new Proxy(real, { get: (target, p) => { touched.add(String(p)); assert.ok(allowed.has(String(p)), `the refresher reads only its known dependencies, not ${String(p)}`); return (target as unknown as Record<string, unknown>)[p as string]; } });
  /** Run the short looks the refresher scheduled (after a failure or a turn end). */
  const fire = async (): Promise<void> => { for (const h of timers.splice(0)) if (!h.done) h.fn(); await tick(); };
  return { d, t, pushes, logs, calls, timers, chats, finish, status, on, fire, touched };
};
const chat = (servers: SignInServerView[], more: Partial<SignInChatView> = {}): SignInChatView => ({ adapterId: 'copilot', takesPart: true, renewable: true, live: true, busy: false, readOnly: false, servers: () => servers, ...more });
const base = (more: Partial<RenewPlanInput> = {}): RenewPlanInput => ({ now: 10 * H, on: true, renewable: true, live: true, busy: false, quiet: false, readOnly: false, allowReadOnly: true, cooldownMs: 5 * 60_000, servers: [], records: {}, inFlight: [], ...more });
const names = (p: { reconnect: { name: string }[] }): string[] => p.reconnect.map((x) => x.name);

async function main(): Promise<void> {
  // ---- the planner ----
  {
    const f = (x: Partial<SignInServerView> = {}): SignInServerView => srv('docs', 'needs-auth', { failed: true, ...x });
    assert.deepStrictEqual(names(planMcpRenew(base({ servers: [f()] }))), ['docs'], 'a failed remote server is renewed');
    assert.deepStrictEqual(names(planMcpRenew(base({ servers: [srv('docs', 'connected')] }))), [], 'no failure = no renewal: nothing renews by age or by a clock');
    for (const [label, x] of [['local', { transport: 'stdio' }], ['unknown transport', { transport: undefined }], ['off', { off: true }], ['disabled', { status: 'disabled' }], ['built-in', { builtin: true }], ['static header', { staticAuth: true }], ['sign-in open', { signInOpen: true }], ['restarting', { restarting: true }], ['policy', { policy: true }]] as [string, Partial<SignInServerView>][]) {
      assert.deepStrictEqual(names(planMcpRenew(base({ servers: [f(x)] }))), [], `${label}: skipped`);
    }
    const key = f().key;
    assert.deepStrictEqual(names(planMcpRenew(base({ servers: [f()], records: { [key]: { at: 10 * H, blocked: 'sign-in' } } }))), [], 'blocked: skipped');
    assert.deepStrictEqual(names(planMcpRenew(base({ servers: [f()], records: { [key]: { at: 10 * H - 4 * 60_000 } } }))), [], 'tried 4 minutes ago: one reconnect per episode');
    assert.deepStrictEqual(names(planMcpRenew(base({ servers: [f()], records: { [key]: { at: 10 * H - 5 * 60_000 } } }))), ['docs'], 'tried 5 minutes ago: a new episode');
    const joined = planMcpRenew(base({ servers: [f()], inFlight: [key] }));
    assert.deepStrictEqual([names(joined), joined.join.map((x) => x.name)], [[], ['docs']], 'one in flight in another chat: joined, not repeated');
    for (const [label, x] of [['off', { on: false }], ['busy', { busy: true }], ['quiet (a send)', { quiet: true }], ['not live', { live: false }], ['no part', { renewable: false }]] as [string, Partial<RenewPlanInput>][]) {
      assert.deepStrictEqual(names(planMcpRenew(base({ servers: [f()], ...x }))), [], `${label}: nothing`);
    }
    const sb = planMcpRenew(base({ servers: [f(), f({ name: 'x', key: 'x', status: 'connected' })], renews: false }));
    assert.deepStrictEqual([names(sb), sb.signInOnly], [[], ['docs']], 'a sandbox that does not renew: only the sign-in line, for a needs-auth server');
    assert.deepStrictEqual(names(planMcpRenew(base({ servers: [f()], readOnly: true, allowReadOnly: false }))), [], 'Read-only with allowReadOnly false: none');
  }

  // ---- trigger 1: a failed auth call, renewed after the turn ----
  {
    const m = make();
    const r = new McpSignInRefresher(m.d);
    m.chats.set('a', chat([srv('docs', 'needs-auth')], { busy: true }));
    r.noteFailure('a', 'docs'); // the call failed mid-turn
    await m.fire();
    assert.deepStrictEqual(m.calls, [], 'never during a turn');
    m.chats.set('a', chat([srv('docs', 'needs-auth')], { busy: false }));
    r.turnEnded('a');
    await m.fire();
    assert.deepStrictEqual(m.calls, ['a:docs'], 'one reconnect after the turn');
    assert.deepStrictEqual(m.pushes, [], 'no chat line for a renewal that works');
    assert.deepStrictEqual(m.logs, ['MCP server docs renewed (automatic)'], 'one activity row, names and fixed words only');
    assert.strictEqual(r.renewedAt('a', 'docs'), 1_700_000_000_000, 'the row shows when (wall clock, display only)');
    assert.strictEqual(r.renewedAt('b', 'docs'), undefined, 'per chat');
    await m.fire();
    assert.deepStrictEqual(m.calls, ['a:docs'], 'the pending mark was used up: no second reconnect');
    // no timer, no renewal by the clock alone
    m.t.now += 5 * H;
    r.turnEnded('a');
    await m.fire();
    assert.deepStrictEqual(m.calls, ['a:docs'], 'hours later with no failure: nothing');
    // the chat ends: its Renewed time goes
    r.dropChat('a');
    assert.strictEqual(r.renewedAt('a', 'docs'), undefined, 'dropped with the chat');
  }

  // ---- trigger 2: the needs-auth report; a first sign-in is no failure; both triggers = one reconnect ----
  {
    const m = make();
    const r = new McpSignInRefresher(m.d);
    m.chats.set('a', chat([srv('docs', 'needs-auth')]));
    r.noteServers('a', [{ name: 'docs', status: 'needs-auth' }]);
    await m.fire();
    assert.deepStrictEqual(m.calls, [], 'a server that was never connected (a first sign-in) is not a failure');
    r.noteServers('a', [{ name: 'docs', status: 'connected' }]);
    r.noteServers('a', [{ name: 'docs', status: 'needs-auth', errorClass: 'auth' }]);
    await m.fire();
    assert.deepStrictEqual(m.calls, ['a:docs'], 'connected, then needs-auth: one reconnect');
    // both triggers of one episode
    const m2 = make({ hang: true });
    const r2 = new McpSignInRefresher(m2.d);
    m2.chats.set('a', chat([srv('docs', 'needs-auth')], { busy: true }));
    r2.noteServers('a', [{ name: 'docs', status: 'connected' }]);
    r2.noteFailure('a', 'docs');
    r2.noteServers('a', [{ name: 'docs', status: 'needs-auth' }]);
    m2.chats.set('a', chat([srv('docs', 'needs-auth')]));
    r2.turnEnded('a');
    await m2.fire();
    assert.deepStrictEqual(m2.calls, ['a:docs'], 'a failed call and the needs-auth report together: one reconnect');
    r2.noteServers('a', [{ name: 'docs', status: 'needs-auth' }]); // the runtime's own transient report during the reconnect
    r2.noteFailure('a', 'docs');
    await m2.fire();
    assert.deepStrictEqual(m2.calls, ['a:docs'], 'while the reconnect runs, a late trigger of the same episode starts nothing');
    m2.finish.get('a:docs')!('connected');
    await tick();
    r2.noteFailure('a', 'docs');
    await m2.fire();
    assert.deepStrictEqual(m2.calls, ['a:docs'], 'right after it, inside the cooldown: no second reconnect');
    m2.t.now += 5 * 60_000;
    r2.noteFailure('a', 'docs');
    await m2.fire();
    assert.deepStrictEqual(m2.calls, ['a:docs', 'a:docs'], 'a new episode after the cooldown: one more');
  }

  // ---- a failed renewal: today's state, no retry loop ----
  {
    const m = make();
    const r = new McpSignInRefresher(m.d);
    m.status.set('docs', 'needs-auth');
    m.chats.set('a', chat([srv('docs', 'needs-auth')]));
    r.noteFailure('a', 'docs');
    await m.fire();
    assert.deepStrictEqual(m.calls, ['a:docs']);
    assert.deepStrictEqual(m.pushes, [{ id: 'a', kind: 'needs-sign-in', name: 'docs' }], 'a renewal that fails shows the sign-in line, as today');
    assert.strictEqual(r.recordOf(signInKey('copilot', 'docs', 'https://docs.example/mcp'))?.blocked, 'sign-in', 'blocked until the person signs in');
    m.t.now += 10 * H;
    r.noteFailure('a', 'docs');
    r.turnEnded('a');
    await m.fire();
    assert.deepStrictEqual(m.calls, ['a:docs'], 'no retry loop');
    assert.strictEqual(r.renewedAt('a', 'docs'), undefined, 'no Renewed note for a failure');
    r.clearBlock('copilot', 'docs'); // Sign in or Restart
    m.status.set('docs', 'connected');
    r.noteFailure('a', 'docs');
    await m.fire();
    assert.deepStrictEqual(m.calls, ['a:docs', 'a:docs'], 'after the person signed in again, the next failure renews');
  }

  // ---- one reconnect per server across chats ----
  {
    const m = make({ hang: true });
    const r = new McpSignInRefresher(m.d);
    for (const id of ['a', 'b', 'c']) {
      m.chats.set(id, chat([srv('docs', 'needs-auth')]));
      r.noteFailure(id, 'docs');
    }
    await m.fire();
    assert.deepStrictEqual(m.calls, ['a:docs'], 'three chats, one server: one reconnect, the others join its result');
    m.finish.get('a:docs')!('connected');
    await tick();
    assert.deepStrictEqual(m.calls, ['a:docs']);
    assert.deepStrictEqual(m.pushes, [], 'the joiners are quiet too');
  }

  // ---- the flight lock itself: two chats handed the same server by two plans make one reconnect ----
  {
    const m = make({ hang: true });
    const r = new McpSignInRefresher(m.d);
    const key = signInKey('copilot', 'docs', 'https://docs.example/mcp');
    r.run('a', { reconnect: [{ name: 'docs', key }], join: [], signInOnly: [] });
    r.run('b', { reconnect: [{ name: 'docs', key }], join: [], signInOnly: [] });
    assert.deepStrictEqual(m.calls, ['a:docs'], 'one reconnect per server key across chats, even when two plans both ask');
    m.finish.get('a:docs')!('connected');
    await tick();
  }

  // ---- idle: a send, a waiting gate, a running reconnect of the chat ----
  {
    const m = make();
    const r = new McpSignInRefresher(m.d);
    m.chats.set('a', chat([srv('docs', 'connected')]));
    await r.beforeSend('a'); // a send starts (a connected server: nothing to reconnect for it)
    r.noteFailure('a', 'docs');
    await m.fire();
    assert.deepStrictEqual(m.calls, [], 'a send is on its way: no renewal now');
    m.t.now += 11_000; // the 10 s quiet time passed
    r.turnEnded('a');
    await m.fire();
    assert.deepStrictEqual(m.calls, ['a:docs'], 'then at the next idle moment');
  }

  // ---- one reconnect of a chat at a time: a second server waits for the first, then goes at the next idle moment ----
  {
    const m = make({ hang: true });
    const r = new McpSignInRefresher(m.d);
    m.chats.set('a', chat([srv('docs', 'needs-auth'), srv('wiki', 'needs-auth')]));
    r.noteFailure('a', 'docs');
    await m.fire();
    r.noteFailure('a', 'wiki');
    await m.fire();
    assert.deepStrictEqual(m.calls, ['a:docs'], 'a chat whose reconnect runs starts no second one');
    m.finish.get('a:docs')!('connected');
    await tick();
    r.turnEnded('a');
    await m.fire();
    assert.deepStrictEqual(m.calls, ['a:docs', 'a:wiki'], 'the waiting one goes at the next idle moment');
    m.finish.get('a:wiki')!('connected');
    await tick();
  }

  // ---- skipped chats ----
  {
    const m = make();
    const r = new McpSignInRefresher(m.d);
    m.chats.set('sb', chat([srv('docs', 'needs-auth')], { renews: false }));
    m.chats.set('cl', chat([srv('docs', 'needs-auth')], { renewable: false, adapterId: 'claude' }));
    m.chats.set('co', chat([srv('docs', 'needs-auth')], { takesPart: false, adapterId: 'codex' }));
    for (const id of ['sb', 'cl', 'co']) r.noteFailure(id, 'docs');
    await m.fire();
    assert.deepStrictEqual(m.calls, [], 'a sandboxed Copilot chat, Claude Code and Codex are never renewed');
    assert.deepStrictEqual(m.pushes, [{ id: 'sb', kind: 'needs-sign-in', name: 'docs' }], 'the sandboxed chat shows the sign-in line once');
    m.on.v = false;
    m.chats.set('x', chat([srv('docs', 'needs-auth')]));
    r.noteFailure('x', 'docs');
    await m.fire();
    assert.deepStrictEqual(m.calls, [], 'the Settings switch off: nothing');
    m.on.v = true;
    for (const [label, s] of [['local', srv('l', 'needs-auth', { transport: 'stdio' })], ['built-in', srv('b', 'needs-auth', { builtin: true })], ['off', srv('o', 'needs-auth', { off: true })]] as [string, SignInServerView][]) {
      m.chats.set(label, chat([s]));
      r.noteFailure(label, s.name);
    }
    await m.fire();
    assert.deepStrictEqual(m.calls, [], 'local, built-in and switched-off servers are skipped');
  }

  // ---- no timer at all ----
  {
    const m = make();
    const r = new McpSignInRefresher(m.d);
    m.chats.set('a', chat([srv('docs', 'connected')]));
    r.noteServers('a', [{ name: 'docs', status: 'connected' }]);
    r.turnEnded('a');
    await m.fire();
    m.t.now += 3 * H;
    await m.fire();
    assert.deepStrictEqual([m.calls, m.timers.length], [[], 0], 'a connected server, hours of clock, no failure: no reconnect and no timer');
  }

  process.exitCode = 0;
  console.log('[058] mcp renew after a failed call: PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

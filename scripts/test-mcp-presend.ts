/**
 * Spec 058 FR-223..FR-228 (T200..T204; 2026-11-05, issue #1205): the background check of the remote sign-in servers before every message,
 * by behaviour. An injected monotonic clock, fake timers and a fake adapter side (`check`, `reconnect`, `after`, `nudge`): no runtime, no
 * network, no credits.
 *  - the check runs per send, beside it: the send settles while the check still waits; a throwing dependency never reaches the send;
 *  - skipped: a server with a successful call or check in the last 5 minutes (and checked again after), local, built-in, static-header,
 *    switched-off, blocked, policy, not-connected servers, one already being checked, a sandboxed chat, Claude Code and Codex, the switch off;
 *  - unauthorized: one reconnect through the queue and the planner, no note to the agent, the line only while it runs; healthy and other
 *    failures: nothing; 30 s without an answer: unknown, nothing else; a repeat after the check's own renewal stops (no second reconnect);
 *  - the agent's own failed call takes the reconnect over (the note goes); the new chat's first report checks once;
 *  - FR-227: the activity row of a renewal that worked only with Diagnostics, also on the failed-call path.
 * `npm run test:mcpsigninrefresh`.
 */
process.exitCode = 1;
import * as assert from 'assert';
import { McpSignInRefresher, MCP_CHECK_FRESH_MS, MCP_CHECK_TIMEOUT_MS, planMcpCheck, signInKey } from '../src/main/mcpsigninrefresh';
import type { CheckPlanInput, McpCheckOutcome, RefresherDeps, SignInChatView, SignInRefreshPush, SignInServerView } from '../src/main/mcpsigninrefresh';

const H = 60 * 60_000;
const tick = async (n = 10): Promise<void> => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const srv = (name: string, status: string, more: Partial<SignInServerView> = {}): SignInServerView => ({ name, status, transport: 'http', key: signInKey('copilot', name, `https://${name}.example/mcp`), ...more });
const chat = (servers: SignInServerView[], more: Partial<SignInChatView> = {}): SignInChatView => ({ adapterId: 'copilot', takesPart: true, renewable: true, canCheck: true, live: true, busy: false, readOnly: false, servers: () => servers, ...more });

const make = () => {
  const t = { now: 50 * H };
  const pushes: SignInRefreshPush[] = [];
  const logs: string[] = [];
  const checks: string[] = [];
  const reconnects: string[] = [];
  const nudges: string[] = [];
  const timers: { fn: () => void; ms: number; done: boolean }[] = [];
  const chats = new Map<string, SignInChatView>();
  const answers = new Map<string, McpCheckOutcome>(); // default ok
  const hang = new Set<string>();
  const hung: Array<(o: McpCheckOutcome) => void> = [];
  const on = { v: true };
  const diag = { v: false };
  const reconnectHold: { v: Promise<void> | undefined } = { v: undefined };
  const d: RefresherDeps = {
    now: () => t.now,
    on: () => on.v,
    platform: 'linux',
    view: (id) => chats.get(id),
    timers: { set: (fn, ms) => { const h = { fn, ms, done: false }; timers.push(h); return h; }, clear: (h) => { (h as { done: boolean }).done = true; } },
    check: (id, name) => {
      checks.push(`${id}:${name}`);
      if (hang.has(name)) return new Promise<McpCheckOutcome>((r) => hung.push(r));
      return Promise.resolve(answers.get(name) ?? 'ok');
    },
    reconnect: async (id, name) => { reconnects.push(`${id}:${name}`); await reconnectHold.v; return { ok: true }; },
    after: () => ({ status: 'connected' }),
    push: (p) => pushes.push(p),
    log: (_id, line) => logs.push(line),
    nudge: async (id, name) => { nudges.push(`${id}:${name}`); },
    diagnostics: () => diag.v,
  };
  return { d, t, pushes, logs, checks, reconnects, nudges, timers, chats, answers, hang, hung, on, diag, reconnectHold };
};
const base = (more: Partial<CheckPlanInput> = {}): CheckPlanInput => ({ now: 10 * H, on: true, canCheck: true, live: true, servers: [srv('docs', 'connected')], records: {}, healthyAt: {}, busy: [], freshMs: MCP_CHECK_FRESH_MS, ...more });

async function main(): Promise<void> {
  assert.strictEqual(MCP_CHECK_FRESH_MS, 5 * 60_000, 'owner: 5 minutes');
  assert.strictEqual(MCP_CHECK_TIMEOUT_MS, 30_000, 'owner: 30 s');

  // ---- the planner ----
  {
    assert.deepStrictEqual(planMcpCheck(base()), ['docs'], 'a connected remote server is checked');
    for (const [label, x] of [['local', { transport: 'stdio' }], ['unknown transport', { transport: undefined }], ['off', { off: true }], ['built-in', { builtin: true }], ['static header', { staticAuth: true }], ['sign-in open', { signInOpen: true }], ['restarting', { restarting: true }], ['policy', { policy: true }], ['needs-auth', { status: 'needs-auth' }], ['pending', { status: 'pending' }], ['failed', { status: 'failed' }], ['disabled', { status: 'disabled' }]] as [string, Partial<SignInServerView>][]) {
      assert.deepStrictEqual(planMcpCheck(base({ servers: [srv('docs', 'connected', x)] })), [], `${label}: not checked`);
    }
    const key = srv('docs', 'connected').key;
    assert.deepStrictEqual(planMcpCheck(base({ records: { [key]: { at: 1, blocked: 'sign-in' } } })), [], 'blocked: not checked');
    assert.deepStrictEqual(planMcpCheck(base({ busy: ['docs'] })), [], 'a renewal or check runs: not checked');
    assert.deepStrictEqual(planMcpCheck(base({ healthyAt: { docs: 10 * H - 4 * 60_000 } })), [], 'healthy 4 minutes ago: skipped');
    assert.deepStrictEqual(planMcpCheck(base({ healthyAt: { docs: 10 * H - 5 * 60_000 } })), ['docs'], 'healthy 5 minutes ago: checked again');
    assert.deepStrictEqual(planMcpCheck(base({ healthyAt: { docs: 10 * H + 5000 } })), ['docs'], 'a clock that went back proves nothing');
    for (const [label, x] of [['switch off', { on: false }], ['not live', { live: false }], ['adapter cannot', { canCheck: false }], ['sandbox', { renews: false }]] as [string, Partial<CheckPlanInput>][]) {
      assert.deepStrictEqual(planMcpCheck(base(x)), [], `${label}: nothing`);
    }
  }

  // ---- per send, beside it; the send is never held ----
  {
    const m = make();
    const r = new McpSignInRefresher(m.d);
    m.chats.set('a', chat([srv('docs', 'connected'), srv('wiki', 'connected')]));
    m.hang.add('docs');
    m.hang.add('wiki');
    r.turnEnded('a');
    const gate = await r.beforeSend('a'); // the checks wait for ever: the send still settles
    assert.strictEqual(gate, 'go', 'the send goes');
    assert.deepStrictEqual(m.checks.sort(), ['a:docs', 'a:wiki'], 'both servers are checked, in parallel');
    assert.deepStrictEqual(m.pushes, [], 'no line for a check that is still waiting');
    await r.beforeSend('a');
    assert.strictEqual(m.checks.length, 2, 'a server already being checked is not checked twice');
  }

  // ---- healthy: nothing; freshness; every message ----
  {
    const m = make();
    const r = new McpSignInRefresher(m.d);
    m.chats.set('a', chat([srv('docs', 'connected')]));
    await r.beforeSend('a');
    await tick();
    assert.deepStrictEqual([m.checks, m.reconnects, m.pushes, m.logs, m.nudges], [['a:docs'], [], [], [], []], 'healthy: no restart, no line, no row, no note');
    m.t.now += 4 * 60_000;
    await r.beforeSend('a');
    await tick();
    assert.strictEqual(m.checks.length, 1, 'a successful check 4 minutes ago: skipped');
    m.t.now += 61_000;
    await r.beforeSend('a');
    await tick();
    assert.strictEqual(m.checks.length, 2, 'after 5 minutes: checked again, before every message');
    // a call that succeeded counts like a check
    r.noteCall('a', 'docs', 'c1', 'start');
    r.noteCall('a', 'docs', 'c1', 'ok');
    m.t.now += 4 * 60_000;
    await r.beforeSend('a');
    await tick();
    assert.strictEqual(m.checks.length, 2, 'a successful tool call 4 minutes ago: skipped');
    m.t.now += 61_000;
    await r.beforeSend('a');
    await tick();
    assert.strictEqual(m.checks.length, 3, 'five minutes after that call: checked');
    // a failed check or an unanswered one is no proof of health
    m.answers.set('docs', 'error');
    m.t.now += 6 * 60_000;
    await r.beforeSend('a');
    await tick();
    await r.beforeSend('a');
    await tick();
    assert.strictEqual(m.checks.length, 5, 'a failed (not unauthorized) check does not count as healthy: checked again at the next message');
    assert.deepStrictEqual([m.reconnects, m.pushes, m.logs], [[], [], []], 'any other failure: nothing happens');
  }

  // ---- unauthorized: one reconnect, no note, a line only while it runs, no row without Diagnostics ----
  {
    const m = make();
    const r = new McpSignInRefresher(m.d);
    m.chats.set('a', chat([srv('docs', 'connected'), srv('wiki', 'connected')]));
    m.answers.set('docs', 'unauthorized');
    let release!: () => void;
    m.reconnectHold.v = new Promise<void>((res) => { release = res; });
    const sent = await r.beforeSend('a');
    await tick();
    assert.strictEqual(sent, 'go', 'the send was not held by the check or the reconnect');
    assert.deepStrictEqual(m.reconnects, ['a:docs'], 'the unauthorized server is reconnected at once, the healthy one is not');
    assert.deepStrictEqual(m.pushes, [{ id: 'a', kind: 'reconnecting', name: 'docs' }], 'the line while it runs, and for nothing else');
    release();
    await tick();
    assert.deepStrictEqual(m.pushes, [{ id: 'a', kind: 'reconnecting', name: 'docs' }, { id: 'a', kind: 'reconnect-end', name: 'docs' }], 'the line ends with the reconnect');
    assert.deepStrictEqual(m.nudges, [], 'no note to the agent from a check (it never failed)');
    assert.deepStrictEqual(m.logs, [], 'no activity row for a renewal without Diagnostics');
    await r.beforeSend('a');
    await tick();
    assert.strictEqual(m.reconnects.length, 1, 'the next message checks again (not fresh) but the cooldown allows no second reconnect');
  }

  // ---- Diagnostics: the row of a renewal that worked, both paths ----
  {
    const m = make();
    m.diag.v = true;
    const r = new McpSignInRefresher(m.d);
    m.chats.set('a', chat([srv('docs', 'connected')]));
    m.answers.set('docs', 'unauthorized');
    await r.beforeSend('a');
    await tick();
    assert.deepStrictEqual(m.logs, ['MCP server docs renewed (automatic)'], 'with Diagnostics the row is written');
    const n = make();
    const q = new McpSignInRefresher(n.d);
    n.chats.set('a', chat([srv('docs', 'needs-auth')]));
    q.noteFailure('a', 'docs');
    await tick();
    assert.deepStrictEqual([n.reconnects, n.nudges, n.logs], [['a:docs'], ['a:docs'], []], 'FR-218 path: renewed and noted, but no row without Diagnostics');
    const o = make();
    o.diag.v = true;
    const z = new McpSignInRefresher(o.d);
    o.chats.set('a', chat([srv('docs', 'needs-auth')]));
    z.noteFailure('a', 'docs');
    await tick();
    assert.deepStrictEqual(o.logs, ['MCP server docs renewed (automatic)'], 'FR-218 path with Diagnostics: the row');
    // a failed reconnect is a row either way
    const f = make();
    f.d.after = () => ({ status: 'needs-auth' });
    const w = new McpSignInRefresher(f.d);
    f.chats.set('a', chat([srv('docs', 'connected')]));
    f.answers.set('docs', 'unauthorized');
    await w.beforeSend('a');
    await tick();
    assert.deepStrictEqual(f.logs, ['MCP server docs needs a new sign-in (automatic)'], 'a failure row stays, without Diagnostics');
    assert.ok(f.pushes.some((p) => p.kind === 'reconnect-end'), 'the line ends on a failed reconnect too');
    assert.ok(f.pushes.some((p) => p.kind === 'needs-sign-in'), 'and the Sign in line shows as before');
  }

  // ---- 30 s: unknown, nothing else ----
  {
    const m = make();
    const r = new McpSignInRefresher(m.d);
    m.chats.set('a', chat([srv('docs', 'connected')]));
    m.hang.add('docs');
    await r.beforeSend('a');
    await tick();
    const tm = m.timers.find((x) => x.ms === 30_000 && !x.done);
    assert.ok(tm, 'a 30 s timer runs for the check');
    assert.strictEqual(r.checkUnknown('a', 'docs'), false, 'not unknown before 30 s');
    tm!.fn();
    await tick();
    assert.strictEqual(r.checkUnknown('a', 'docs'), true, 'no answer in 30 s: unknown (the row says so)');
    assert.deepStrictEqual([m.reconnects, m.pushes, m.logs, m.nudges], [[], [], [], []], 'nothing else happens');
    m.hung.forEach((f) => f('unauthorized')); // a late answer after the verdict changes nothing
    await tick();
    assert.deepStrictEqual(m.reconnects, [], 'a late answer is ignored');
    m.hang.clear();
    await r.beforeSend('a');
    await tick();
    assert.strictEqual(r.checkUnknown('a', 'docs'), false, 'a later successful check clears it');
    const m2 = make();
    const r2 = new McpSignInRefresher(m2.d);
    m2.chats.set('a', chat([srv('docs', 'connected')]));
    m2.hang.add('docs');
    await r2.beforeSend('a');
    m2.timers.find((x) => x.ms === 30_000)!.fn();
    await tick();
    r2.noteCall('a', 'docs', 'c', 'start');
    r2.noteCall('a', 'docs', 'c', 'ok');
    assert.strictEqual(r2.checkUnknown('a', 'docs'), false, 'a successful call clears it too');
    r2.dropChat('a');
    assert.strictEqual(r2.checkUnknown('a', 'docs'), false);
  }

  // ---- the new chat's first report ----
  {
    const m = make();
    const r = new McpSignInRefresher(m.d);
    m.chats.set('a', chat([srv('docs', 'connected')]));
    r.noteServers('a', [{ name: 'docs', status: 'pending' }]);
    await tick();
    assert.deepStrictEqual(m.checks, [], 'nothing connected yet: no check');
    r.noteServers('a', [{ name: 'docs', status: 'connected' }]);
    await tick();
    assert.deepStrictEqual(m.checks, ['a:docs'], 'the first report with a connected server checks it once');
    r.noteServers('a', [{ name: 'docs', status: 'connected' }]);
    await tick();
    m.t.now += 6 * 60_000; // past the 5 minutes: only a message checks again, never a report
    r.noteServers('a', [{ name: 'docs', status: 'connected' }]);
    await tick();
    assert.strictEqual(m.checks.length, 1, 'later reports do not start a check');
    r.dropChat('a');
    r.noteServers('a', [{ name: 'docs', status: 'connected' }]);
    await tick();
    assert.strictEqual(m.checks.length, 2, 'a restarted chat is a new chat');
  }

  // ---- skipped servers and chats, the switch ----
  {
    const m = make();
    const r = new McpSignInRefresher(m.d);
    m.chats.set('a', chat([srv('l', 'connected', { transport: 'stdio' }), srv('b', 'connected', { builtin: true }), srv('s', 'connected', { staticAuth: true }), srv('o', 'connected', { off: true }), srv('p', 'connected', { policy: true })]));
    await r.beforeSend('a');
    await tick();
    assert.deepStrictEqual(m.checks, [], 'local, built-in, static-header, off and policy servers: no check');
    m.chats.set('cl', chat([srv('docs', 'connected')], { renewable: false }));
    m.chats.set('nc', chat([srv('docs', 'connected')], { canCheck: false }));
    m.chats.set('sb', chat([srv('docs', 'connected')], { renews: false }));
    for (const id of ['cl', 'nc', 'sb']) await r.beforeSend(id);
    await tick();
    assert.deepStrictEqual(m.checks, [], 'Claude Code and Codex (no mcpBackgroundRenew), an adapter that cannot list tools, a sandboxed chat: never');
    m.chats.set('x', chat([srv('docs', 'connected')]));
    m.on.v = false;
    await r.beforeSend('x');
    await tick();
    assert.deepStrictEqual(m.checks, [], 'the switch off: nothing');
    // switched off while the check runs: no reconnect
    m.on.v = true;
    m.answers.set('docs', 'unauthorized');
    let resolveCheck!: (o: McpCheckOutcome) => void;
    m.d.check = (id, name) => { m.checks.push(`${id}:${name}`); return new Promise<McpCheckOutcome>((res) => { resolveCheck = res; }); };
    await r.beforeSend('x');
    m.on.v = false;
    resolveCheck('unauthorized');
    await tick();
    assert.deepStrictEqual([m.reconnects, m.pushes], [[], []], 'switched off while it runs: no reconnect');
    // the chat ended while it ran
    m.on.v = true;
    m.chats.set('y', chat([srv('docs', 'connected')]));
    await r.beforeSend('y');
    m.chats.delete('y');
    resolveCheck('unauthorized');
    await tick();
    assert.deepStrictEqual(m.reconnects, [], 'a chat that ended while it ran: nothing');
  }

  // ---- a dependency that throws never reaches the send ----
  {
    const m = make();
    m.d.check = () => { throw new Error('boom'); };
    const r = new McpSignInRefresher(m.d);
    m.chats.set('a', chat([srv('docs', 'connected')]));
    assert.strictEqual(await r.beforeSend('a'), 'go', 'a check that throws: the send goes');
    const m2 = make();
    m2.d.check = () => Promise.reject(new Error('boom'));
    const r2 = new McpSignInRefresher(m2.d);
    m2.chats.set('a', chat([srv('docs', 'connected')]));
    assert.strictEqual(await r2.beforeSend('a'), 'go');
    await tick();
    assert.deepStrictEqual(m2.reconnects, [], 'a rejected check is a plain failure: nothing');
    const m3 = make();
    m3.d.view = () => { throw new Error('boom'); };
    const r3 = new McpSignInRefresher(m3.d);
    assert.strictEqual(await r3.beforeSend('a'), 'go', 'a view that throws: the send goes');
    const m4 = make();
    const r4 = new McpSignInRefresher({ ...m4.d, check: undefined });
    m4.chats.set('a', chat([srv('docs', 'connected')]));
    assert.strictEqual(await r4.beforeSend('a'), 'go', 'no check dependency: nothing checked');
  }

  // ---- the agent's own failure takes the reconnect over; a repeat stops ----
  {
    const m = make();
    const r = new McpSignInRefresher(m.d);
    m.chats.set('a', chat([srv('docs', 'connected')]));
    m.answers.set('docs', 'unauthorized');
    let release!: () => void;
    m.reconnectHold.v = new Promise<void>((res) => { release = res; });
    await r.beforeSend('a');
    await tick();
    r.noteFailure('a', 'docs'); // the agent's own call failed while the check's reconnect runs
    release();
    await tick();
    assert.deepStrictEqual([m.reconnects, m.nudges], [['a:docs'], ['a:docs']], 'one reconnect, and the agent that failed gets the note');

    const q = make();
    const z = new McpSignInRefresher(q.d);
    q.chats.set('a', chat([srv('docs', 'connected')]));
    q.answers.set('docs', 'unauthorized');
    await z.beforeSend('a');
    await tick();
    assert.strictEqual(q.reconnects.length, 1);
    q.t.now += 6 * 60_000; // cooldown over, no call or check succeeded since: the renewal did not help
    await z.beforeSend('a');
    await tick();
    assert.strictEqual(q.reconnects.length, 1, 'still unauthorized after the check\'s own renewal: no second reconnect');
    assert.deepStrictEqual(q.pushes.filter((p) => p.kind === 'needs-sign-in'), [{ id: 'a', kind: 'needs-sign-in', name: 'docs' }], 'Sign in again instead');
    assert.deepStrictEqual(q.nudges, [], 'and no note');

    // a call that worked since makes the next failure a new episode
    const w = make();
    const y = new McpSignInRefresher(w.d);
    w.chats.set('a', chat([srv('docs', 'connected')]));
    w.answers.set('docs', 'unauthorized');
    await y.beforeSend('a');
    await tick();
    y.noteCall('a', 'docs', 'c', 'start');
    y.noteCall('a', 'docs', 'c', 'ok');
    w.t.now += 6 * 60_000;
    await y.beforeSend('a');
    await tick();
    assert.strictEqual(w.reconnects.length, 2, 'after a successful call, a new failure is a new episode: one more reconnect');
  }

  // ---- the check waits for another call to the same server, like a failed call ----
  {
    const m = make();
    const r = new McpSignInRefresher(m.d);
    m.chats.set('a', chat([srv('docs', 'connected')]));
    m.answers.set('docs', 'unauthorized');
    r.noteCall('a', 'docs', 'run', 'start'); // the agent's own call to the same server runs
    await r.beforeSend('a');
    await tick();
    assert.deepStrictEqual(m.reconnects, [], 'another call to the same server runs: the reconnect waits for it');
    r.noteCall('a', 'docs', 'run', 'end');
    await tick();
    assert.deepStrictEqual(m.reconnects, ['a:docs'], 'and goes when it ended');
    assert.deepStrictEqual(m.nudges, [], 'still no note');
  }

  process.exitCode = 0;
  console.log('[058] mcp check before every message: PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

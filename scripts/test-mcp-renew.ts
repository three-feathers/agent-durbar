/**
 * Spec 058 FR-218..FR-222 (T191, T194; 2026-11-05, owner decision 18:03 UTC "3 for mcp"): renewing a remote MCP sign-in at once after a
 * failure, and the one automatic note to the agent, by behaviour. An injected monotonic clock and a fake adapter side (`reconnect`,
 * `after`, `nudge`): no runtime, no network, no credits.
 *  - triggers: a failed `auth` call; a report that turns `needs-auth` after `connected`; both for one episode = one reconnect and one
 *    note; a first sign-in (never connected) is no failure;
 *  - at once, also mid-turn; waits for another call to the same server in that session to end;
 *  - one reconnect at a time per server across chats, each chat's own session restarted (queued, not shared); the cooldown per chat;
 *    a failed reconnect is blocked, no retry loop, no note;
 *  - the note: once on success, never on failure, never with the switch off, at a spending limit, after the person's Stop, in a chat that
 *    ended, nor ahead of a send at the gate; the refresher sends no message of the person's again;
 *  - skipped: local, built-in, static-header, switched-off, disabled, policy, sign-in-open and restarting servers, a sandboxed chat (only
 *    the sign-in line), an adapter without `mcpBackgroundRenew`, the Settings switch off; no timer, nothing by the clock alone;
 *  - seamless: no chat line for a success, the activity row, "Renewed" time per chat, dropped with the chat.
 * `npm run test:mcpsigninrefresh`.
 */
process.exitCode = 1;
import * as assert from 'assert';
import { McpSignInRefresher, planMcpRenew, signInKey } from '../src/main/mcpsigninrefresh';
import type { RefresherDeps, RenewPlanInput, SignInChatView, SignInRefreshPush, SignInServerView } from '../src/main/mcpsigninrefresh';

const H = 60 * 60_000;
const tick = async (n = 10): Promise<void> => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const srv = (name: string, status: string, more: Partial<SignInServerView> = {}): SignInServerView => ({ name, status, transport: 'http', key: signInKey('copilot', name, `https://${name}.example/mcp`), ...more });

const make = (o: { hang?: boolean; nudgeHang?: boolean } = {}) => {
  const t = { now: 50 * H };
  const pushes: SignInRefreshPush[] = [];
  const logs: string[] = [];
  const calls: string[] = [];
  const nudges: string[] = [];
  const chats = new Map<string, SignInChatView>();
  const finish = new Map<string, (status: string) => void>();
  const status = new Map<string, string>();
  const on = { v: true };
  const real: RefresherDeps = {
    now: () => t.now,
    on: () => on.v,
    platform: 'linux',
    wall: () => 1_700_000_000_000,
    view: (id) => chats.get(id),
    reconnect: (id, name) => {
      calls.push(`${id}:${name}`);
      if (o.hang) return new Promise((r) => finish.set(`${id}:${name}`, (st) => { status.set(name, st); r({ ok: st === 'connected' }); }));
      return Promise.resolve().then(() => ((status.get(name) ?? 'connected') === 'connected' ? { ok: true } : { ok: false, error: 'requires authentication' }));
    },
    after: (_id, name) => ({ status: status.get(name) ?? 'connected' }),
    push: (p) => pushes.push(p),
    log: (_id, line) => logs.push(line),
    nudge: async (id, name) => { nudges.push(`${id}:${name}`); },
  };
  // the refresher never sends a message of the person's: its dependencies hold no `send`; any property it reads must be a known one
  const allowed = new Set(['now', 'on', 'platform', 'wall', 'timers', 'view', 'reconnect', 'after', 'push', 'log', 'allowReadOnly', 'waitMs', 'failCooldownMs', 'nudge']);
  const d = new Proxy(real, { get: (target, p) => { assert.ok(allowed.has(String(p)), `the refresher reads only its known dependencies, not ${String(p)}`); return (target as unknown as Record<string, unknown>)[p as string]; } });
  return { d, t, pushes, logs, calls, nudges, chats, finish, status, on };
};
const chat = (servers: SignInServerView[], more: Partial<SignInChatView> = {}): SignInChatView => ({ adapterId: 'copilot', takesPart: true, renewable: true, live: true, busy: false, readOnly: false, servers: () => servers, ...more });
const base = (more: Partial<RenewPlanInput> = {}): RenewPlanInput => ({ now: 10 * H, on: true, renewable: true, live: true, readOnly: false, allowReadOnly: true, cooldownMs: 5 * 60_000, servers: [], records: {}, ...more });
const names = (p: { reconnect: { name: string }[] }): string[] => p.reconnect.map((x) => x.name);

async function main(): Promise<void> {
  // ---- the planner ----
  {
    const f = (x: Partial<SignInServerView> = {}): SignInServerView => srv('docs', 'needs-auth', { failed: true, ...x });
    assert.deepStrictEqual(names(planMcpRenew(base({ servers: [f()] }))), ['docs'], 'a failed remote server is renewed');
    assert.deepStrictEqual(names(planMcpRenew(base({ servers: [srv('docs', 'connected')] }))), [], 'no failure = no renewal: nothing renews by age or by a clock');
    for (const [label, x] of [['local', { transport: 'stdio' }], ['unknown transport', { transport: undefined }], ['off', { off: true }], ['disabled', { status: 'disabled' }], ['built-in', { builtin: true }], ['static header', { staticAuth: true }], ['sign-in open or starting', { signInOpen: true }], ['restarting', { restarting: true }], ['policy', { policy: true }]] as [string, Partial<SignInServerView>][]) {
      assert.deepStrictEqual(names(planMcpRenew(base({ servers: [f(x)] }))), [], `${label}: skipped`);
    }
    const key = f().key;
    assert.deepStrictEqual(names(planMcpRenew(base({ servers: [f()], records: { [key]: { at: 10 * H, blocked: 'sign-in' } } }))), [], 'blocked: skipped');
    assert.deepStrictEqual(names(planMcpRenew(base({ servers: [f({ triedAt: 10 * H - 4 * 60_000 })] }))), [], 'tried from this chat 4 minutes ago: one reconnect per episode');
    assert.deepStrictEqual(names(planMcpRenew(base({ servers: [f({ triedAt: 10 * H - 5 * 60_000 })] }))), ['docs'], 'tried 5 minutes ago: a new episode');
    assert.deepStrictEqual(names(planMcpRenew(base({ servers: [f()], records: { [key]: { at: 10 * H - 60_000 } } }))), ['docs'], 'another chat tried the same server a minute ago: this chat (its own session) still needs its restart');
    const wait = planMcpRenew(base({ servers: [f({ callsInFlight: true }), f({ name: 'wiki', key: 'w' })] }));
    assert.deepStrictEqual([names(wait), wait.deferred], [['wiki'], ['docs']], 'another call to the same server runs: it waits, the other server goes');
    for (const [label, x] of [['off', { on: false }], ['not live', { live: false }], ['no part', { renewable: false }]] as [string, Partial<RenewPlanInput>][]) {
      assert.deepStrictEqual(names(planMcpRenew(base({ servers: [f()], ...x }))), [], `${label}: nothing`);
    }
    const sb = planMcpRenew(base({ servers: [f(), f({ name: 'x', key: 'x', status: 'connected' })], renews: false }));
    assert.deepStrictEqual([names(sb), sb.signInOnly], [[], ['docs']], 'a sandbox that does not renew: only the sign-in line, for a needs-auth server');
    assert.deepStrictEqual(names(planMcpRenew(base({ servers: [f()], readOnly: true, allowReadOnly: false }))), [], 'Read-only with allowReadOnly false: none');
  }

  // ---- renew at once, mid-turn, one note on success ----
  {
    const m = make();
    const r = new McpSignInRefresher(m.d);
    m.chats.set('a', chat([srv('docs', 'needs-auth')], { busy: true })); // a turn runs
    r.noteFailure('a', 'docs');
    await tick();
    assert.deepStrictEqual(m.calls, ['a:docs'], 'at once, in the middle of the turn');
    assert.deepStrictEqual(m.nudges, ['a:docs'], 'exactly one note after the success');
    assert.deepStrictEqual(m.pushes, [{ id: 'a', kind: 'nudged', name: 'docs' }], 'the chat is told the note was sent automatically; no other line for a renewal that works');
    assert.deepStrictEqual(m.logs, ['MCP server docs renewed (automatic)'], 'one activity row, names and fixed words only');
    assert.strictEqual(r.renewedAt('a', 'docs'), 1_700_000_000_000, 'the row shows when (wall clock, display only)');
    assert.strictEqual(r.renewedAt('b', 'docs'), undefined, 'per chat');
    r.turnEnded('a');
    await tick();
    assert.deepStrictEqual([m.calls, m.nudges], [['a:docs'], ['a:docs']], 'the turn end changes nothing');
    m.t.now += 5 * H;
    await tick();
    assert.deepStrictEqual([m.calls.length, m.nudges.length], [1, 1], 'hours later with no failure: nothing (no timer)');
    r.dropChat('a');
    assert.strictEqual(r.renewedAt('a', 'docs'), undefined, 'dropped with the chat');
  }

  // ---- two servers fail together: each gets its own note, naming it as the person configured it, and no other ----
  {
    const m = make();
    const r = new McpSignInRefresher(m.d);
    m.chats.set('a', chat([srv('Teams (work)', 'needs-auth'), srv('mail-365', 'needs-auth'), srv('files', 'connected')]));
    r.noteFailure('a', 'Teams (work)');
    r.noteFailure('a', 'mail-365');
    await tick();
    assert.deepStrictEqual([...m.nudges].sort(), ['a:Teams (work)', 'a:mail-365'], 'one note per renewed server, each with its own configured name; the server that did not fail is not named');
  }

  // ---- both triggers of one episode: one reconnect, one note; a first sign-in is no failure ----
  {
    const m = make();
    const r = new McpSignInRefresher(m.d);
    m.chats.set('a', chat([srv('docs', 'needs-auth')]));
    r.noteServers('a', [{ name: 'docs', status: 'needs-auth' }]);
    await tick();
    assert.deepStrictEqual(m.calls, [], 'a server that was never connected (a first sign-in) is not a failure');
    r.noteServers('a', [{ name: 'docs', status: 'connected' }]);
    r.noteServers('a', [{ name: 'docs', status: 'needs-auth', errorClass: 'auth' }]);
    await tick();
    assert.deepStrictEqual(m.calls, ['a:docs'], 'connected, then needs-auth: one reconnect');
    assert.deepStrictEqual(m.nudges, ['a:docs'], 'and one note');
    // both triggers together, the second while the first reconnect runs
    const m2 = make({ hang: true });
    const r2 = new McpSignInRefresher(m2.d);
    m2.chats.set('a', chat([srv('docs', 'needs-auth')]));
    r2.noteServers('a', [{ name: 'docs', status: 'connected' }]);
    r2.noteFailure('a', 'docs'); // the failed call
    r2.noteServers('a', [{ name: 'docs', status: 'needs-auth' }]); // the report of the same episode, during the reconnect
    await tick();
    assert.deepStrictEqual(m2.calls, ['a:docs'], 'both triggers: one reconnect');
    m2.finish.get('a:docs')!('connected');
    await tick();
    assert.deepStrictEqual(m2.nudges, ['a:docs'], 'both triggers: exactly one note');
    r2.noteFailure('a', 'docs'); // right after, inside the cooldown
    await tick();
    assert.deepStrictEqual([m2.calls.length, m2.nudges.length], [1, 1], 'inside the cooldown: no second reconnect and no second note');
    m2.t.now += 5 * 60_000;
    r2.noteCall('a', 'docs', 'ok1', 'start');
    r2.noteCall('a', 'docs', 'ok1', 'ok'); // a call to the server worked: the next failure is a new episode
    r2.noteFailure('a', 'docs');
    await tick();
    assert.deepStrictEqual(m2.calls, ['a:docs', 'a:docs'], 'a new episode after the cooldown and a working call: one more');
  }

  // ---- waits for another call to the same server in that session ----
  {
    const m = make();
    const r = new McpSignInRefresher(m.d);
    m.chats.set('a', chat([srv('docs', 'needs-auth')], { busy: true }));
    r.noteCall('a', 'docs', 'c1', 'start'); // a call that failed
    r.noteCall('a', 'docs', 'c2', 'start'); // another call to the same server, still running
    r.noteCall('a', 'docs', 'c1', 'end');
    r.noteFailure('a', 'docs');
    await tick();
    assert.deepStrictEqual(m.calls, [], 'another call to the same server runs: not yet');
    r.noteCall('a', 'docs', 'c2', 'end'); // the last one ended
    await tick();
    assert.deepStrictEqual(m.calls, ['a:docs'], 'the reconnect starts when no call to that server runs');
    assert.deepStrictEqual(m.nudges, ['a:docs']);
    // a call to another server does not hold it
    const m2 = make();
    const r2 = new McpSignInRefresher(m2.d);
    m2.chats.set('a', chat([srv('docs', 'needs-auth')]));
    r2.noteCall('a', 'wiki', 'x', 'start');
    r2.noteFailure('a', 'docs');
    await tick();
    assert.deepStrictEqual(m2.calls, ['a:docs'], 'a call to another server holds nothing');
  }

  // ---- a failed renewal: today's state, no retry loop, no note ----
  {
    const m = make();
    const r = new McpSignInRefresher(m.d);
    m.status.set('docs', 'needs-auth');
    m.chats.set('a', chat([srv('docs', 'needs-auth')]));
    r.noteFailure('a', 'docs');
    await tick();
    assert.deepStrictEqual(m.calls, ['a:docs']);
    assert.deepStrictEqual(m.nudges, [], 'a failed renewal sends no note');
    assert.deepStrictEqual(m.pushes, [{ id: 'a', kind: 'needs-sign-in', name: 'docs' }], 'a renewal that fails shows the sign-in line, as today');
    assert.strictEqual(r.recordOf(signInKey('copilot', 'docs', 'https://docs.example/mcp'))?.blocked, 'sign-in', 'blocked until the person signs in');
    m.t.now += 10 * H;
    r.noteFailure('a', 'docs');
    await tick();
    assert.deepStrictEqual(m.calls, ['a:docs'], 'no retry loop');
    assert.strictEqual(r.renewedAt('a', 'docs'), undefined, 'no Renewed note for a failure');
    r.clearBlock('copilot', 'docs'); // Sign in or Restart
    m.status.set('docs', 'connected');
    r.noteFailure('a', 'docs');
    await tick();
    assert.deepStrictEqual([m.calls, m.nudges], [['a:docs', 'a:docs'], ['a:docs']], 'after the person signed in again, the next failure renews, and then the note');
  }

  // ---- the note's limits ----
  {
    // the Settings switch off: nothing, not even a reconnect
    const m = make();
    const r = new McpSignInRefresher(m.d);
    m.on.v = false;
    m.chats.set('a', chat([srv('docs', 'needs-auth')]));
    r.noteFailure('a', 'docs');
    await tick();
    assert.deepStrictEqual([m.calls, m.nudges], [[], []], 'switch off: no reconnect and no note');
    // the switch turned off while the reconnect runs: the reconnect finishes, no note
    const m2 = make({ hang: true });
    const r2 = new McpSignInRefresher(m2.d);
    m2.chats.set('a', chat([srv('docs', 'needs-auth')]));
    r2.noteFailure('a', 'docs');
    await tick();
    m2.on.v = false;
    m2.finish.get('a:docs')!('connected');
    await tick();
    assert.deepStrictEqual(m2.nudges, [], 'switched off meanwhile: no note');
    // a spending limit (Durbar's cap or the app's usage limit) holds the chat: renewed, but no note
    const m3 = make();
    const r3 = new McpSignInRefresher(m3.d);
    m3.chats.set('a', chat([srv('docs', 'needs-auth')], { limited: true }));
    r3.noteFailure('a', 'docs');
    await tick();
    assert.deepStrictEqual([m3.calls, m3.nudges], [['a:docs'], []], 'a limit is reached: the server is renewed, no message is sent');
    // the person pressed Stop while it renewed: no note; a later failure's note is fine
    const m4 = make({ hang: true });
    const r4 = new McpSignInRefresher(m4.d);
    m4.chats.set('a', chat([srv('docs', 'needs-auth')], { busy: true }));
    r4.noteFailure('a', 'docs');
    await tick();
    r4.noteStop('a');
    m4.finish.get('a:docs')!('connected');
    await tick();
    assert.deepStrictEqual(m4.nudges, [], 'Stop after the failure: no note');
    m4.t.now += 6 * 60_000;
    r4.noteFailure('a', 'docs');
    await tick();
    m4.finish.get('a:docs')!('connected');
    await tick();
    assert.deepStrictEqual(m4.nudges, ['a:docs'], 'a failure after the Stop is a new episode');
    // the chat ended while it renewed
    const m5 = make({ hang: true });
    const r5 = new McpSignInRefresher(m5.d);
    m5.chats.set('a', chat([srv('docs', 'needs-auth')]));
    r5.noteFailure('a', 'docs');
    await tick();
    m5.chats.delete('a');
    m5.finish.get('a:docs')!('connected');
    await tick();
    assert.deepStrictEqual([m5.nudges, r5.renewedAt('a', 'docs')], [[], undefined], 'the chat ended: no note, no Renewed time left behind');
    // the session stopped running (the chat is still listed): no note either
    const m5b = make({ hang: true });
    const r5b = new McpSignInRefresher(m5b.d);
    m5b.chats.set('a', chat([srv('docs', 'needs-auth')]));
    r5b.noteFailure('a', 'docs');
    await tick();
    m5b.chats.set('a', chat([srv('docs', 'needs-auth')], { live: false }));
    m5b.finish.get('a:docs')!('connected');
    await tick();
    assert.deepStrictEqual(m5b.nudges, [], 'the session is not running any more: no note');
    // behind a send of the person's that is at the gate
    const m6 = make({ hang: true });
    const r6 = new McpSignInRefresher(m6.d);
    m6.chats.set('a', chat([srv('wiki', 'needs-auth')])); // the send's own reconnect keeps its gate open (5 s wait)
    const sending = r6.beforeSend('a');
    await tick();
    m6.chats.set('a', chat([srv('wiki', 'connected'), srv('docs', 'needs-auth')]));
    r6.noteFailure('a', 'docs');
    await tick();
    m6.finish.get('a:docs')?.('connected');
    await tick();
    assert.deepStrictEqual(m6.nudges, [], 'the person\'s send is at the gate: the note waits behind it');
    m6.finish.get('a:wiki')!('connected');
    assert.strictEqual(await sending, 'go');
    await tick();
    assert.deepStrictEqual(m6.nudges, ['a:docs'], 'then it goes');
  }

  // ---- one reconnect at a time per server across chats; each chat's own session; the flight lock ----
  {
    const m = make({ hang: true });
    const r = new McpSignInRefresher(m.d);
    for (const id of ['a', 'b', 'c']) {
      m.chats.set(id, chat([srv('docs', 'needs-auth')]));
      r.noteFailure(id, 'docs');
    }
    await tick();
    assert.deepStrictEqual(m.calls, ['a:docs'], 'three chats, one server: one reconnect at a time');
    m.finish.get('a:docs')!('connected');
    await tick();
    assert.deepStrictEqual(m.calls, ['a:docs', 'b:docs'], 'the next chat gets its own restart (a restart acts on one session), not the first one\'s result');
    m.finish.get('b:docs')!('connected');
    await tick();
    m.finish.get('c:docs')!('connected');
    await tick();
    assert.deepStrictEqual([m.calls, m.nudges], [['a:docs', 'b:docs', 'c:docs'], ['a:docs', 'b:docs', 'c:docs']], 'each chat: its restart and its one note');
    const m15 = make({ hang: true });
    const r15 = new McpSignInRefresher(m15.d);
    for (let i = 0; i < 15; i++) {
      m15.chats.set(`c${i}`, chat([srv('docs', 'needs-auth')]));
      r15.noteFailure(`c${i}`, 'docs');
    }
    await tick();
    for (let i = 0; i < 15; i++) {
      assert.strictEqual(m15.calls.length, i + 1, `restart number ${i + 1} starts only when the one before ended`);
      m15.finish.get(`c${i}:docs`)!('connected');
      await tick();
    }
    assert.deepStrictEqual(m15.calls, Array.from({ length: 15 }, (_, i) => `c${i}:docs`), '15 chats, 15 restarts, in order, never two at once');
    assert.notStrictEqual(signInKey('copilot', 'docs', 'folder:/a'), signInKey('copilot', 'docs', 'folder:/b'), 'the folder tells same-name servers apart when no address is known');
    // the flight lock itself, and a send's reconnect in another chat
    const m2 = make({ hang: true });
    const r2 = new McpSignInRefresher(m2.d);
    const key = signInKey('copilot', 'docs', 'https://docs.example/mcp');
    r2.run('a', { reconnect: [{ name: 'docs', key, kind: 'renew' }], join: [], signInOnly: [] });
    r2.run('b', { reconnect: [{ name: 'docs', key, kind: 'renew' }], join: [], signInOnly: [] });
    await tick();
    assert.deepStrictEqual(m2.calls, ['a:docs'], 'one at a time per server key, even when two plans both ask');
    m2.finish.get('a:docs')!('connected');
    await tick();
    assert.deepStrictEqual(m2.calls, ['a:docs', 'b:docs'], 'the second is queued, not dropped');
    m2.finish.get('b:docs')!('connected');
    await tick();
    const m3 = make({ hang: true });
    const r3 = new McpSignInRefresher(m3.d);
    m3.chats.set('a', chat([srv('docs', 'needs-auth')]));
    m3.chats.set('b', chat([srv('docs', 'needs-auth')]));
    const sending = r3.beforeSend('a'); // chat a's first message reconnects docs (the send's own, shared kind)
    await tick();
    r3.noteFailure('b', 'docs');
    await tick();
    assert.deepStrictEqual(m3.calls, ['a:docs'], 'chat b waits for the send reconnect of chat a');
    m3.finish.get('a:docs')!('connected');
    await tick();
    assert.deepStrictEqual(m3.calls, ['a:docs', 'b:docs'], 'then chat b gets its own restart, not a share of the first result');
    m3.finish.get('b:docs')!('connected');
    await sending;
    // the cooldown is per chat
    const m4 = make();
    const r4 = new McpSignInRefresher(m4.d);
    m4.chats.set('a', chat([srv('docs', 'needs-auth')]));
    m4.chats.set('b', chat([srv('docs', 'needs-auth')]));
    r4.noteFailure('a', 'docs');
    await tick();
    m4.t.now += 60_000;
    r4.noteFailure('b', 'docs');
    await tick();
    assert.deepStrictEqual(m4.calls, ['a:docs', 'b:docs'], 'another chat renewed this server a minute ago: this chat is still renewed');
    m4.t.now += 60_000;
    r4.noteFailure('a', 'docs');
    await tick();
    assert.deepStrictEqual(m4.calls, ['a:docs', 'b:docs'], 'but chat a itself is inside its own cooldown');
  }

  // ---- review round 2: a queued restart re-checks the chat's calls; a call that never ends; no note storm; a refused note ----
  {
    const m = make({ hang: true });
    const r = new McpSignInRefresher(m.d);
    m.chats.set('a', chat([srv('docs', 'needs-auth')]));
    m.chats.set('b', chat([srv('docs', 'needs-auth')]));
    r.noteFailure('a', 'docs');
    r.noteFailure('b', 'docs'); // queued behind chat a's restart
    await tick();
    r.noteCall('b', 'docs', 'new', 'start'); // chat b starts a new call to docs while it waits in the queue
    m.finish.get('a:docs')!('connected');
    await tick();
    assert.deepStrictEqual(m.calls, ['a:docs'], 'the queued restart does not run while its own chat has a call to that server running');
    r.noteCall('b', 'docs', 'new', 'end');
    await tick();
    assert.deepStrictEqual(m.calls, ['a:docs', 'b:docs'], 'it goes when that call ended');
    m.finish.get('b:docs')!('connected');
    await tick();
    // the person acts on chat b's server while its restart waits in the queue: it never starts
    const mq = make({ hang: true });
    const rq = new McpSignInRefresher(mq.d);
    mq.chats.set('a', chat([srv('docs', 'needs-auth')]));
    mq.chats.set('b', chat([srv('docs', 'needs-auth')]));
    rq.noteFailure('a', 'docs');
    rq.noteFailure('b', 'docs');
    await tick();
    rq.clearPending('b', 'docs'); // Restart, Sign in or a switch in chat b
    mq.finish.get('a:docs')!('connected');
    await tick();
    assert.deepStrictEqual(mq.calls, ['a:docs'], 'a queued renewal the person cancelled never starts');
    // a call that never reports its end (an abort): a Stop or the turn's end clears it
    const m2 = make();
    const r2 = new McpSignInRefresher(m2.d);
    m2.chats.set('a', chat([srv('docs', 'needs-auth')], { busy: true }));
    r2.noteCall('a', 'docs', 'lost', 'start');
    r2.noteFailure('a', 'docs');
    await tick();
    assert.deepStrictEqual(m2.calls, [], 'a call is still counted as running');
    r2.turnEnded('a'); // the turn ended without that call's end
    await tick();
    assert.deepStrictEqual(m2.calls, ['a:docs'], 'the turn end clears it: the waiting renewal goes');
    const m3 = make();
    const r3 = new McpSignInRefresher(m3.d);
    m3.chats.set('a', chat([srv('docs', 'needs-auth')]));
    r3.noteCall('a', 'docs', 'lost', 'start');
    r3.noteFailure('a', 'docs');
    await tick();
    r3.noteStop('a');
    await tick();
    assert.deepStrictEqual([m3.calls, m3.nudges], [['a:docs'], []], 'Stop clears it too: renewed, but no note after a Stop');
    // restart reads connected but calls keep failing (a revoked refresh token): one note, then the Sign in again state, no loop
    const m4 = make();
    const r4 = new McpSignInRefresher(m4.d);
    m4.chats.set('a', chat([srv('docs', 'needs-auth')]));
    r4.noteFailure('a', 'docs');
    await tick();
    for (let i = 0; i < 6; i++) {
      m4.t.now += 6 * 60_000; // each failure comes after the cooldown
      r4.noteFailure('a', 'docs');
      await tick();
    }
    assert.deepStrictEqual([m4.calls.length, m4.nudges.length], [1, 1], 'six more failures over 36 minutes: no further reconnect and no further note');
    assert.deepStrictEqual(m4.pushes.filter((p) => p.kind === 'needs-sign-in').length >= 1, true, 'the Sign in again state is shown');
    assert.strictEqual(r4.recordOf(signInKey('copilot', 'docs', 'https://docs.example/mcp'))?.blocked, 'sign-in', 'blocked until the person signs in');
    // a call that succeeded re-arms the note (a new episode)
    const m5 = make();
    const r5 = new McpSignInRefresher(m5.d);
    m5.chats.set('a', chat([srv('docs', 'needs-auth')]));
    r5.noteFailure('a', 'docs');
    await tick();
    r5.noteCall('a', 'docs', 'w', 'start');
    r5.noteCall('a', 'docs', 'w', 'ok');
    m5.t.now += 6 * 60_000;
    r5.noteFailure('a', 'docs');
    await tick();
    assert.deepStrictEqual([m5.calls.length, m5.nudges.length], [2, 2], 'after a call worked, a new failure is a new episode: renewed and a note again');
    // the adapter refuses the note: the window is told it was not sent
    const m6 = make();
    m6.d.nudge = async () => { throw new Error('refused'); };
    const r6 = new McpSignInRefresher(m6.d);
    m6.chats.set('a', chat([srv('docs', 'needs-auth')]));
    r6.noteFailure('a', 'docs');
    await tick();
    assert.deepStrictEqual(m6.pushes.map((p) => p.kind), ['nudged', 'nudge-failed'], 'said before the send, marked not sent when it failed');
  }

  // ---- Stop while the note waits at a send's gate ----
  {
    const m = make({ hang: true });
    const r = new McpSignInRefresher(m.d);
    m.chats.set('a', chat([srv('wiki', 'needs-auth')]));
    const sending = r.beforeSend('a');
    await tick();
    m.chats.set('a', chat([srv('wiki', 'connected'), srv('docs', 'needs-auth')]));
    r.noteFailure('a', 'docs');
    await tick();
    m.finish.get('a:docs')!('connected');
    await tick();
    r.noteStop('a'); // the person presses Stop while the note waits behind the send
    m.finish.get('a:wiki')!('connected');
    await sending;
    await tick();
    assert.deepStrictEqual(m.nudges, [], 'Stop while the note waited behind the send: no note');
  }

  // ---- stale marks and the person's own actions ----
  {
    const m = make({ hang: true });
    const r = new McpSignInRefresher(m.d);
    m.chats.set('a', chat([srv('docs', 'needs-auth')]));
    r.noteFailure('a', 'docs');
    await tick();
    r.noteFailure('a', 'docs'); // a trigger during the chat's own reconnect
    m.finish.get('a:docs')!('connected');
    await tick();
    m.t.now += 6 * 60_000; // the cooldown has passed
    r.noteCall('a', 'docs', 'c9', 'start');
    r.noteCall('a', 'docs', 'c9', 'end');
    await tick();
    assert.deepStrictEqual(m.calls, ['a:docs'], 'the mark that arrived during the reconnect died with it: a working server is not reconnected after the cooldown');
    // a later report that says connected drops a mark that waits for a call
    const m2 = make();
    const r2 = new McpSignInRefresher(m2.d);
    m2.chats.set('a', chat([srv('docs', 'connected')]));
    r2.noteCall('a', 'docs', 'c1', 'start');
    r2.noteFailure('a', 'docs');
    r2.noteServers('a', [{ name: 'docs', status: 'connected' }]);
    r2.noteCall('a', 'docs', 'c1', 'end');
    await tick();
    assert.deepStrictEqual(m2.calls, [], 'connected again while it waited: nothing to renew');
    // Restart, Sign in or a switch drops a waiting mark
    const m3 = make();
    const r3 = new McpSignInRefresher(m3.d);
    m3.chats.set('a', chat([srv('docs', 'needs-auth'), srv('wiki', 'needs-auth')]));
    m3.chats.set('b', chat([srv('docs', 'needs-auth')]));
    for (const id of ['a', 'b']) r3.noteCall(id, 'docs', 'k', 'start');
    r3.noteCall('a', 'wiki', 'k', 'start');
    r3.noteFailure('a', 'docs');
    r3.noteFailure('a', 'wiki');
    r3.noteFailure('b', 'docs');
    r3.clearPending('a', 'docs');
    r3.clearPending(undefined, 'wiki');
    for (const [id, n] of [['a', 'docs'], ['a', 'wiki'], ['b', 'docs']]) r3.noteCall(id, n, 'k', 'end');
    await tick();
    assert.deepStrictEqual(m3.calls, ['b:docs'], 'only the mark nobody cleared renews (chat b)');
  }

  // ---- skipped chats ----
  {
    const m = make();
    const r = new McpSignInRefresher(m.d);
    m.chats.set('sb', chat([srv('docs', 'needs-auth')], { renews: false }));
    m.chats.set('cl', chat([srv('docs', 'needs-auth')], { renewable: false, adapterId: 'claude' }));
    m.chats.set('co', chat([srv('docs', 'needs-auth')], { takesPart: false, adapterId: 'codex' }));
    for (const id of ['sb', 'cl', 'co']) r.noteFailure(id, 'docs');
    await tick();
    assert.deepStrictEqual([m.calls, m.nudges], [[], []], 'a sandboxed Copilot chat, Claude Code and Codex are never renewed, no note');
    assert.deepStrictEqual(m.pushes, [{ id: 'sb', kind: 'needs-sign-in', name: 'docs' }], 'the sandboxed chat shows the sign-in line once');
    for (const [label, s] of [['local', srv('l', 'needs-auth', { transport: 'stdio' })], ['built-in', srv('b', 'needs-auth', { builtin: true })], ['off', srv('o', 'needs-auth', { off: true })]] as [string, SignInServerView][]) {
      m.chats.set(label, chat([s]));
      r.noteFailure(label, s.name);
    }
    await tick();
    assert.deepStrictEqual([m.calls, m.nudges], [[], []], 'local, built-in and switched-off servers are skipped, no note');
  }

  // ---- no timer at all ----
  {
    const m = make();
    const r = new McpSignInRefresher(m.d);
    m.chats.set('a', chat([srv('docs', 'connected')]));
    r.noteServers('a', [{ name: 'docs', status: 'connected' }]);
    r.turnEnded('a');
    m.t.now += 3 * H;
    await tick();
    assert.deepStrictEqual([m.calls, m.nudges], [[], []], 'a connected server, hours of clock, no failure: no reconnect and no note');
  }

  process.exitCode = 0;
  console.log('[058] mcp renew after a failed call: PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Spec 058 FR-205..FR-216 (T178, T180, T181, T184): the automatic MCP sign-in refresh, by behaviour.
 *  - `planMcpSignInRefresh`: the gap (59:59 vs 60:00), resume from sleep, the first message, which servers, one attempt per gap, the
 *    block and what clears it, busy chats, the switch, `allowReadOnly`, the macOS rule; the simulator's marked copy is the same code.
 *  - `McpSignInRefresher`: the injected monotonic clock (never `Date.now`), one reconnect per server across 15 chats after a resume with
 *    14 waiters taking its result, the 5 s wait with a reconnect that never ends (fake timers), Stop during the wait, nothing to do = no
 *    wait, the per-chat promise a second send awaits, blocks, log lines with names and fixed words only (no vendor or token text).
 *  - The Copilot adapter's automatic form (fake SDK): `restartServer` only, MethodNotFound rejects with no disable/enable, the list read
 *    1.5 s later decides, never `oauth.login`; the capability flags of every adapter.
 *  - The Settings value: a stored non-boolean reads off, a missing one takes the default.
 * Fakes only: no agent app, no network, no credits. `npm run test:mcpsigninrefresh`.
 */
process.exitCode = 1;
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MCP_RECHECK_MS, MCP_SIGNIN_ALLOW_READ_ONLY, MCP_SIGNIN_GAP_MS, MCP_SIGNIN_REFRESH_DEFAULT, MCP_SIGNIN_WAIT_MS, McpSignInRefresher, planMcpSignInRefresh, signInKey, signInResult } from '../src/main/mcpsigninrefresh';
import type { RefresherDeps, SignInChatView, SignInPlanInput, SignInRefreshPush, SignInServerView } from '../src/main/mcpsigninrefresh';
import { parseSettings } from '../src/shared/credits';
import { SettingsStore } from '../src/main/settings';
import { CopilotAdapter } from '../src/adapters/copilot';
import { CLAUDE_CAPABILITIES, CLAUDE_SDK_CAPABILITIES } from '../src/adapters/claude';
import { CODEX_CAPABILITIES } from '../src/adapters/codex';
import { FakeClient, FakeCopilot } from './fakes/copilot-sdk';

const H = 60 * 60_000;
const tick = async (n = 8): Promise<void> => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const srv = (name: string, status: string, more: Partial<SignInServerView> = {}): SignInServerView => ({ name, status, transport: 'http', key: signInKey('copilot', name, `https://${name}.example/mcp`), ...more });
const base = (more: Partial<SignInPlanInput> = {}): SignInPlanInput => ({ moment: 'send', now: 10 * H, lastResponseAt: 9 * H, on: true, allowReadOnly: true, readOnly: false, platform: 'linux', takesPart: true, live: true, busy: false, servers: [], records: {}, inFlight: [], ...more });
const names = (p: { reconnect: { name: string }[] }): string[] => p.reconnect.map((x) => x.name);

const cases: Array<[string, SignInPlanInput]> = [];
const plan = (label: string, i: SignInPlanInput): ReturnType<typeof planMcpSignInRefresh> => {
  cases.push([label, i]);
  return planMcpSignInRefresh(i);
};

async function main(): Promise<void> {
  assert.deepStrictEqual([MCP_SIGNIN_GAP_MS, MCP_SIGNIN_WAIT_MS, MCP_RECHECK_MS, MCP_SIGNIN_REFRESH_DEFAULT, MCP_SIGNIN_ALLOW_READ_ONLY], [H, 5000, 30 * 60_000, true, true], 'the constants (G1 fixed gap, G5 settled A)');

  // ---- the gap and the moments (FR-205) ----
  {
    const s = [srv('docs', 'connected'), srv('crm', 'needs-auth')];
    assert.strictEqual(plan('59:59', base({ now: 9 * H + H - 1000, servers: s })).why, 'no-moment', '59:59 after the last response: no gap');
    const at60 = plan('60:00', base({ now: 9 * H + H, servers: s }));
    assert.strictEqual(at60.why, 'gap', 'exactly 60:00 is the gap');
    assert.deepStrictEqual(names(at60), ['docs', 'crm'], 'at the gap: connected (a token can expire quietly) and needs-auth');
    const first = plan('first', base({ lastResponseAt: undefined, servers: s }));
    assert.strictEqual(first.why, 'first', 'no response yet in this session: the first message');
    assert.deepStrictEqual(names(first), ['crm'], 'first message: only needs-auth (the apps refresh at start, FR-205 1)');
    const woke = plan('resume after response', base({ now: 9 * H + 5 * 60_000, resumedAt: 9 * H + 60_000, servers: s }));
    assert.strictEqual(woke.why, 'gap', 'a resume after the last response is past the gap, whatever the clock says');
    assert.strictEqual(plan('resume before response', base({ now: 9 * H + 5 * 60_000, resumedAt: 9 * H - 60_000, servers: s })).why, 'no-moment', 'a resume before the last response does not count');
    assert.strictEqual(plan('resume = response', base({ now: 9 * H + 5 * 60_000, resumedAt: 9 * H, servers: s })).why, 'no-moment', 'a resume at the same moment as the response does not count');
    assert.strictEqual(plan('clock back', base({ now: 8 * H, servers: s })).why, 'no-moment', 'a negative quiet time is no gap');
    assert.strictEqual(plan('recheck', base({ moment: 'recheck', now: 9 * H + 1, servers: s })).why, 'recheck');
    assert.deepStrictEqual(names(plan('recheck servers', base({ moment: 'recheck', now: 9 * H + 1, servers: s }))), ['crm'], 'the recheck reconnects only needs-auth');
  }

  // ---- which servers (FR-206) ----
  {
    const all = [
      srv('ok', 'connected'),
      srv('off', 'connected', { off: true }),
      srv('dis', 'disabled'),
      srv('local', 'connected', { transport: 'stdio' }),
      srv('notransport', 'needs-auth', { transport: undefined }),
      srv('signing', 'needs-auth', { signInOpen: true }),
      srv('restarting', 'needs-auth', { restarting: true }),
      srv('policy', 'needs-auth', { policy: true }),
      srv('failed', 'failed'),
      srv('pending', 'pending'),
      srv('sse', 'needs-auth', { transport: 'sse' }),
      srv('ok', 'needs-auth'), // a duplicate name: the first entry counts
    ];
    const p = plan('filter', base({ now: 11 * H, servers: all }));
    assert.deepStrictEqual(names(p), ['ok', 'sse'], 'only on, remote, not signing in, not restarting, not policy, connected or needs-auth');
    assert.deepStrictEqual(names(plan('darwin', base({ now: 11 * H, platform: 'darwin', servers: [srv('c', 'connected'), srv('n', 'needs-auth')] }))), ['n'], 'macOS (G3): only needs-auth, never a connected server');
    assert.deepStrictEqual(names(plan('local needs-auth', base({ now: 11 * H, servers: [srv('l', 'needs-auth', { transport: 'stdio' })] }))), [], 'a local server is never reconnected, whatever it reads');
  }

  // ---- gates: switch, adapter, live, busy, read-only ----
  {
    const s = [srv('n', 'needs-auth')];
    assert.strictEqual(plan('off', base({ on: false, servers: s })).why, 'off');
    assert.strictEqual(plan('off malformed', base({ on: 'yes' as unknown as boolean, servers: s })).why, 'off', 'only a real true is on');
    assert.strictEqual(plan('no part', base({ takesPart: false, servers: s })).why, 'no-part', 'Codex, the Claude SDK transport: nothing');
    assert.strictEqual(plan('not live', base({ live: false, servers: s })).why, 'not-live');
    assert.strictEqual(plan('busy', base({ busy: true, now: 11 * H, servers: s })).why, 'busy', 'a busy chat: nothing (a steer or a queued message triggers nothing)');
    const ro = plan('read-only allowed', base({ readOnly: true, now: 11 * H, servers: s }));
    assert.deepStrictEqual(names(ro), ['n'], 'G5 = A: Read-only reconnects too');
    const roNo = plan('read-only not allowed', base({ readOnly: true, allowReadOnly: false, now: 11 * H, servers: [...s, srv('c', 'connected')] }));
    assert.deepStrictEqual([names(roNo), roNo.signInOnly], [[], ['n']], 'allowReadOnly false: no reconnect, only the sign-in line for needs-auth');
    assert.deepStrictEqual(names(plan('ask mode', base({ readOnly: false, allowReadOnly: false, now: 11 * H, servers: s }))), ['n'], 'allowReadOnly only limits Read-only');
    // real 2026-11-03 (Copilot, Linux): under an OS sandbox that covers MCP the reconnect renewed nothing: only the sign-in line
    const boxed = plan('sandbox covers mcp', base({ renews: false, now: 11 * H, servers: [...s, srv('c', 'connected')] }));
    assert.deepStrictEqual([names(boxed), boxed.join, boxed.signInOnly], [[], [], ['n']], 'renews false: no reconnect, the sign-in line for needs-auth only');
    const boxedAsk = plan('sandbox in ask', base({ renews: false, readOnly: false, now: 11 * H, servers: s }));
    assert.deepStrictEqual([names(boxedAsk), boxedAsk.signInOnly], [[], ['n']], 'also outside Read-only (Ask first has the sandbox too)');
    assert.deepStrictEqual(names(plan('renews true', base({ renews: true, now: 11 * H, servers: s }))), ['n'], 'renews true: as before');
  }

  // ---- records: one attempt per gap, blocks, flights (FR-210) ----
  {
    const n = srv('n', 'needs-auth');
    const c = srv('c', 'connected');
    const now = 11 * H;
    assert.deepStrictEqual(names(plan('recent attempt', base({ now, servers: [n, c], records: { [n.key]: { at: now - H + 1 }, [c.key]: { at: now - H } } }))), ['c'], 'one attempt per server per gap: 59:59 after it no, 60:00 yes');
    assert.deepStrictEqual(names(plan('blocked', base({ now, servers: [n, c], records: { [n.key]: { at: now - 3 * H, blocked: 'sign-in' }, [c.key]: { blocked: 'policy' } } }))), [], 'a blocked server waits for the person, whatever the time');
    const fl = plan('in flight', base({ now, servers: [n, c], inFlight: [n.key], records: { [n.key]: { at: now - 1 } } }));
    assert.deepStrictEqual([names(fl), fl.join.map((x) => x.name)], [['c'], ['n']], 'a server another chat reconnects now: wait for that result, start nothing');
    const blockedFlying = plan('blocked flight', base({ now, servers: [n], inFlight: [n.key], records: { [n.key]: { blocked: 'sign-in' } } }));
    assert.deepStrictEqual(blockedFlying.join, [], 'a blocked server is not joined either');
    assert.deepStrictEqual(names(plan('proto key', base({ now, servers: [srv('__proto__', 'needs-auth', { key: '__proto__' }), srv('toString', 'needs-auth', { key: 'toString' })] }))), ['__proto__', 'toString'], 'keys from the app are looked up as own properties only');
  }

  // ---- results ----
  assert.strictEqual(signInResult({ status: 'connected' }), 'reconnected');
  assert.strictEqual(signInResult({ status: 'needs-auth' }), 'needs-sign-in');
  assert.strictEqual(signInResult({ status: 'failed', errorClass: 'auth' }), 'needs-sign-in');
  assert.strictEqual(signInResult({ status: 'failed' }), 'failed');
  assert.strictEqual(signInResult({}), 'failed', 'no report: failed, never reconnected');
  assert.strictEqual(signInResult({ status: 'connected', policy: true }), 'policy');
  assert.strictEqual(signInResult({ status: 'connected', declined: true }), 'needs-sign-in', 'an elicitation declined during the reconnect');
  assert.strictEqual(signInResult({ status: 'connected', ok: false, fresh: false }), 'failed', 'a failed call with no new report: the old connected proves nothing');
  assert.strictEqual(signInResult({ status: 'connected', ok: false, fresh: true }), 'reconnected', 'a failed call, then a new report that reads connected (Copilot, T177)');
  assert.strictEqual(signInResult({ status: 'needs-auth', ok: false, fresh: false }), 'needs-sign-in', 'no new report, still needs-auth');

  // ---- the simulator's copy is the same code and gives the same answers (FR-216) ----
  {
    const ts = require('typescript') as typeof import('typescript');
    const cut = (file: string): string => {
      const src = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8').replace(/\r/g, '');
      const a = src.indexOf('/* mcpsigninrefresh:begin */');
      const b = src.indexOf('/* mcpsigninrefresh:end */');
      assert.ok(a > 0 && b > a, `${file} marks its block`);
      return src.slice(a, b);
    };
    const mainBlock = cut('src/main/mcpsigninrefresh.ts');
    const simBlock = cut('src/renderer/sim.ts');
    const norm = (t: string): string => t.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
    assert.strictEqual(norm(simBlock), norm(mainBlock), 'the simulator block is a copy of the planner');
    const js = ts.transpileModule(simBlock, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const sim = new Function(js + '\nreturn planMcpSignInRefresh;')() as typeof planMcpSignInRefresh;
    assert.ok(cases.length >= 25, `cases: ${cases.length}`);
    for (const [label, i] of cases) assert.deepStrictEqual(sim(i), planMcpSignInRefresh(i), label);
  }

  // ---- the refresher (FR-208..FR-210, FR-214) ----
  type Fake = { d: RefresherDeps; t: { now: number }; pushes: SignInRefreshPush[]; logs: string[]; calls: string[]; timers: { fn: () => void; ms: number; done: boolean }[]; chats: Map<string, SignInChatView>; finish: Map<string, (status: string) => void>; status: Map<string, string>; on: { v: unknown } };
  const fake = (o: { hang?: boolean } = {}): Fake => {
    const t = { now: 50 * H };
    const pushes: SignInRefreshPush[] = [];
    const logs: string[] = [];
    const calls: string[] = [];
    const timers: { fn: () => void; ms: number; done: boolean }[] = [];
    const chats = new Map<string, SignInChatView>();
    const finish = new Map<string, (status: string) => void>();
    const status = new Map<string, string>();
    const on = { v: true as unknown };
    const d: RefresherDeps = {
      now: () => t.now,
      on: () => on.v as boolean,
      platform: 'linux',
      timers: { set: (fn, ms) => { const h = { fn, ms, done: false }; timers.push(h); return h; }, clear: (h) => { (h as { done: boolean }).done = true; } },
      view: (id) => chats.get(id),
      reconnect: (id, name) => {
        calls.push(`${id}:${name}`);
        if (!o.hang) {
          return Promise.resolve().then(() => {
            const st = status.get(name) ?? 'connected';
            return st === 'connected' ? { ok: true } : { ok: false, error: `Request failed: requires authentication ghp_${'A'.repeat(36)} at https://idp.example/token?code=abc` };
          });
        }
        return new Promise((r) => finish.set(`${id}:${name}`, (st) => { status.set(name, st); r({ ok: st === 'connected' }); }));
      },
      after: (_id, name) => ({ status: status.get(name) ?? 'connected' }),
      push: (p) => pushes.push(p),
      log: (_id, line) => logs.push(line),
    };
    return { d, t, pushes, logs, calls, timers, chats, finish, status, on };
  };
  let built = 0; // how often a chat's server list was built (review of PR #1080, item 7: only when a plan can go on)
  const chat = (servers: SignInServerView[], more: Partial<SignInChatView> = {}): SignInChatView => ({ adapterId: 'copilot', takesPart: true, live: true, busy: false, readOnly: false, servers: () => { built++; return servers; }, ...more });

  // nothing to do: no wait, no line; the clock is the injected one, never Date.now
  {
    const f = fake();
    const r = new McpSignInRefresher(f.d);
    f.chats.set('a', chat([srv('docs', 'connected')]));
    const realNow = Date.now;
    Date.now = () => { throw new Error('Date.now read'); };
    try {
      r.turnEnded('a');
      f.t.now += H - 1;
      assert.strictEqual(await r.beforeSend('a'), 'go');
      assert.deepStrictEqual([f.calls, f.pushes, f.timers.length], [[], [], 0], 'no gap: no reconnect, no line, no timer');
      f.t.now += 1;
      assert.strictEqual(await r.beforeSend('a'), 'go');
      assert.deepStrictEqual(f.calls, ['a:docs'], 'at the gap on the injected clock: one reconnect');
    } finally {
      Date.now = realNow;
    }
    assert.deepStrictEqual(f.pushes, [{ id: 'a', kind: 'waiting', count: 1 }, { id: 'a', kind: 'done' }], 'the waiting line, then done (a success leaves no trace)');
    assert.deepStrictEqual(f.logs, ['MCP server docs reconnected before your message (automatic)'], 'one activity row');
    f.calls.length = 0;
    r.turnEnded('a');
    f.t.now += 2 * H;
    f.chats.set('a', chat([srv('docs', 'connected')]));
    f.chats.set('b', chat([srv('docs', 'connected')]));
    await r.beforeSend('a');
    assert.deepStrictEqual(f.calls, ['a:docs'], 'a new gap, a new attempt');
    r.turnEnded('b');
    f.t.now += H;
    f.t.now -= 1;
    await r.beforeSend('b');
    assert.deepStrictEqual(f.calls, ['a:docs'], 'chat b at its own gap, 59:59 after the app-wide attempt: not again');
  }

  // FR-210: 15 chats on one server after resume = one reconnect, 14 waiters with its result
  {
    const f = fake({ hang: true });
    const r = new McpSignInRefresher(f.d);
    const ids = Array.from({ length: 15 }, (_, i) => `c${i}`);
    for (const id of ids) {
      f.chats.set(id, chat([srv('docs', 'connected'), srv(`own${id}`, 'connected', { transport: 'stdio' })]));
      r.turnEnded(id);
    }
    f.t.now += 60_000;
    assert.strictEqual(await r.beforeSend('c0'), 'go', 'no gap yet');
    r.resumed();
    f.t.now += 1;
    const sends = ids.map((id) => r.beforeSend(id));
    await tick();
    assert.deepStrictEqual(f.calls, ['c0:docs'], 'after resume every chat is past the gap: one reconnect for the shared server, local ones never');
    assert.deepStrictEqual(r.inFlight(), [signInKey('copilot', 'docs', 'https://docs.example/mcp')]);
    f.finish.get('c0:docs')!('needs-auth');
    const res = await Promise.all(sends);
    assert.deepStrictEqual(res, ids.map(() => 'go'));
    const lines = f.pushes.filter((p) => p.kind === 'needs-sign-in');
    assert.deepStrictEqual(lines.map((p) => p.id).sort(), [...ids].sort(), 'each of the 15 chats takes the one result as its own: its sign-in line');
    assert.strictEqual(f.logs.length, 1, 'one activity row for one reconnect');
    assert.match(f.logs[0], /^MCP server docs needs a new sign-in \(automatic\)$/);
    // the block: not cleared by a turn end, cleared by Sign in / Restart (clearBlock), not across another name
    const key = signInKey('copilot', 'docs', 'https://docs.example/mcp');
    assert.deepStrictEqual(r.recordOf(key)?.blocked, 'sign-in');
    f.calls.length = 0;
    for (const id of ids) r.turnEnded(id);
    f.t.now += 3 * H;
    await Promise.all(ids.map((id) => r.beforeSend(id)));
    assert.deepStrictEqual(f.calls, [], 'blocked: a turn end and three quiet hours do not unblock it');
    r.clearBlock('copilot', 'other');
    r.clearBlock('claude', 'docs');
    await r.beforeSend('c1');
    assert.deepStrictEqual(f.calls, [], 'another name or another app does not clear it');
    // a URL change is a new key: no block carried over
    f.chats.set('c2', chat([srv('docs', 'connected', { key: signInKey('copilot', 'docs', 'https://new.example/mcp') })]));
    const moved = r.beforeSend('c2');
    await tick();
    assert.deepStrictEqual(f.calls, ['c2:docs'], 'the server moved to a new address: tried once');
    f.finish.get('c2:docs')!('connected');
    await moved;
    f.calls.length = 0;
    r.clearBlock('copilot', 'docs');
    assert.strictEqual(r.recordOf(key), undefined, 'Sign in or Restart clears the block');
    const again = r.beforeSend('c3');
    await tick();
    assert.deepStrictEqual(f.calls, ['c3:docs'], 'after the person signed in: tried again');
    f.finish.get('c3:docs')!('connected');
    await again;
  }

  // FR-208: the 5 s bound with a reconnect that never ends (fake timers), then Stop during a wait
  {
    const f = fake({ hang: true });
    const r = new McpSignInRefresher(f.d);
    f.chats.set('a', chat([srv('slow', 'needs-auth'), srv('quick', 'needs-auth')]));
    let settled = false;
    const p = r.beforeSend('a').then((v) => { settled = true; return v; });
    await tick();
    assert.deepStrictEqual(f.pushes, [{ id: 'a', kind: 'waiting', count: 2 }], '"Reconnecting MCP sign-ins (2 servers)…"');
    assert.deepStrictEqual(f.timers.map((x) => x.ms), [MCP_SIGNIN_WAIT_MS], 'one 5 s bound');
    f.finish.get('a:quick')!('connected');
    await tick();
    assert.strictEqual(settled, false, 'one of two done: still waiting');
    f.timers[0].fn();
    assert.strictEqual(await p, 'go', 'at the bound the message goes anyway');
    assert.deepStrictEqual(f.pushes[f.pushes.length - 1], { id: 'a', kind: 'late', names: ['slow'] }, 'the late line names the server still reconnecting');
    // a second send while that reconnect still runs awaits the chat's promise (FR-209), within its own bound; no second reconnect
    const second = r.beforeSend('a');
    await tick();
    assert.deepStrictEqual(f.calls, ['a:slow', 'a:quick'], 'no second reconnect of the running server');
    assert.deepStrictEqual(f.pushes[f.pushes.length - 1], { id: 'a', kind: 'waiting', count: 1 }, 'the second send waits for the running one');
    // Stop during that wait
    assert.strictEqual(r.stopWait('a'), true, 'Stop finds the wait');
    assert.strictEqual(await second, 'stopped', 'Stop ends the wait: nothing is sent');
    assert.deepStrictEqual(f.pushes[f.pushes.length - 1], { id: 'a', kind: 'not-sent' });
    assert.strictEqual(r.stopWait('a'), false, 'no wait left: Stop interrupts a turn as before');
    assert.ok(f.timers.slice(1).every((x) => x.done), 'the bound timer is cleared');
    // the reconnect still running is not cancelled; its late needs-sign-in still reaches the chat
    f.finish.get('a:slow')!('needs-auth');
    await tick();
    assert.deepStrictEqual(f.pushes[f.pushes.length - 1], { id: 'a', kind: 'needs-sign-in', name: 'slow' });
  }

  // busy chat, switch off (and a switch that throws or is malformed), no part, read-only with allowReadOnly false
  {
    const f = fake();
    const r = new McpSignInRefresher(f.d);
    f.chats.set('busy', chat([srv('n', 'needs-auth')], { busy: true }));
    f.chats.set('codex', chat([srv('n', 'needs-auth')], { takesPart: false, adapterId: 'codex' }));
    f.chats.set('plain', chat([srv('m', 'needs-auth')]));
    await r.beforeSend('busy');
    await r.beforeSend('codex');
    assert.deepStrictEqual(f.calls, [], 'busy or not taking part: nothing');
    f.on.v = 'true';
    await r.beforeSend('plain');
    f.on.v = undefined;
    await r.beforeSend('plain');
    f.d.on = () => { throw new Error('store gone'); };
    await r.beforeSend('plain');
    assert.deepStrictEqual(f.calls, [], 'a malformed or unreadable switch reads off');
    assert.strictEqual(await r.beforeSend('unknown'), 'go', 'an unknown chat: nothing, no line');
    const g = fake();
    const r2 = new McpSignInRefresher({ ...g.d, allowReadOnly: false });
    g.chats.set('ro', chat([srv('n', 'needs-auth')], { readOnly: true }));
    assert.strictEqual(await r2.beforeSend('ro'), 'go');
    assert.deepStrictEqual([g.calls, g.pushes], [[], [{ id: 'ro', kind: 'needs-sign-in', name: 'n' }]], 'allowReadOnly false: no reconnect in Read-only, only the sign-in line');
  }

  // forget (End session): the next message is a first message again; a policy result blocks for the run
  {
    const f = fake();
    const r = new McpSignInRefresher(f.d);
    f.chats.set('a', chat([srv('docs', 'connected')]));
    r.turnEnded('a');
    f.t.now += 2 * H;
    r.forget('a');
    await r.beforeSend('a');
    assert.deepStrictEqual(f.calls, [], 'after End session: a first message (connected servers are left to the app)');
    const g = fake();
    const r2 = new McpSignInRefresher({ ...g.d, after: () => ({ status: 'failed', policy: true }) });
    g.chats.set('a', chat([srv('p', 'needs-auth')]));
    await r2.beforeSend('a');
    const k = signInKey('copilot', 'p', 'https://p.example/mcp');
    assert.deepStrictEqual(r2.recordOf(k)?.blocked, 'policy');
    r2.clearBlock('copilot', 'p');
    assert.deepStrictEqual(r2.recordOf(k)?.blocked, 'policy', 'a policy block stays for the run, Sign in and Restart do not clear it');
    assert.deepStrictEqual(g.logs, ["MCP server p was refused by your organization's sign-in rules (automatic)"]);
  }

  // FR-214: no vendor or token text in a log line or a window line, whatever the app's error says
  {
    const f = fake();
    const r = new McpSignInRefresher(f.d);
    f.status.set('n', 'needs-auth');
    f.chats.set('a', chat([srv('n', 'needs-auth')]));
    await r.beforeSend('a');
    const out = JSON.stringify([f.logs, f.pushes]);
    assert.ok(!/ghp_|requires authentication|idp\.example|code=/.test(out), `names and fixed words only: ${out}`);
    assert.deepStrictEqual(f.logs, ['MCP server n needs a new sign-in (automatic)']);
  }

  // FR-215: the elicitation marks
  {
    const f = fake({ hang: true });
    const r = new McpSignInRefresher(f.d);
    f.chats.set('a', chat([srv('n', 'needs-auth')]));
    const p = r.beforeSend('a');
    await tick();
    assert.ok(r.underAuto('a', 'n') && !r.underAuto('a', 'x') && !r.underAuto('b', 'n'));
    r.noteDeclined('a', 'n');
    f.finish.get('a:n')!('connected');
    await p;
    assert.deepStrictEqual(f.pushes.filter((x) => x.kind === 'needs-sign-in'), [{ id: 'a', kind: 'needs-sign-in', name: 'n' }], 'a declined elicitation makes it a needs-sign-in, even when the app then reads connected');
    assert.ok(!r.underAuto('a', 'n'), 'the mark ends with the reconnect');
  }

  // ---- review of PR #1080: a busy chat goes at once (item 2), a failing gate sends (item 4), lazy lists and pruning (item 7) ----
  {
    const f = fake({ hang: true });
    const r = new McpSignInRefresher(f.d);
    f.chats.set('a', chat([srv('n', 'needs-auth')]));
    const first = r.beforeSend('a');
    await tick();
    assert.deepStrictEqual(f.calls, ['a:n'], 'a reconnect runs');
    f.chats.set('a', chat([srv('n', 'needs-auth')], { busy: true }));
    assert.strictEqual(await r.beforeSend('a'), 'go', 'a steer while the turn runs: sent at once, not held by the earlier reconnect');
    assert.strictEqual(f.timers.length, 1, 'no second wait was started');
    f.finish.get('a:n')!('connected');
    await first;
    // a view that throws, and a clock that throws: the message goes
    const g = fake();
    const r2 = new McpSignInRefresher({ ...g.d, view: () => { throw new Error('boom'); } });
    assert.strictEqual(await r2.beforeSend('x'), 'go', 'a view that throws: go');
    const r3 = new McpSignInRefresher({ ...g.d, now: () => { throw new Error('clock'); } });
    g.chats.set('a', chat([srv('n', 'needs-auth')]));
    assert.strictEqual(await r3.beforeSend('a'), 'go', 'a gate that throws inside: go');
    // the server list is built only when a plan can go on
    const h = fake();
    const r4 = new McpSignInRefresher(h.d);
    h.chats.set('a', chat([srv('c', 'connected')]));
    r4.turnEnded('a');
    built = 0;
    await r4.beforeSend('a');
    assert.strictEqual(built, 0, 'no gap: the list is not built');
    h.on.v = false;
    h.t.now += 2 * H;
    await r4.beforeSend('a');
    assert.strictEqual(built, 0, 'switch off: not built');
    h.on.v = true;
    await r4.beforeSend('a');
    assert.strictEqual(built, 1, 'at the gap: built once');
    // pruning: an attempt older than the gap goes, a block stays
    h.chats.set('b', chat([srv('p', 'needs-auth')]));
    h.status.set('p', 'needs-auth');
    await r4.beforeSend('b');
    assert.strictEqual(r4.recordCount(), 2, 'two records');
    h.t.now += H;
    await r4.beforeSend('zzz');
    assert.strictEqual(r4.recordCount(), 1, 'the old attempt is pruned, the block is kept');
    r4.forget('zzz');
  }

  // ---- the Copilot adapter's automatic form (FR-207, FR-214) ----
  {
    const client = new FakeClient();
    const ad = new FakeCopilot(client);
    (ad as unknown as { autoReadDelayMs: number }).autoReadDelayMs = 5;
    assert.strictEqual(ad.capabilities.mcpSignInReconnect, true);
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-058-auto-'));
    const sid = await ad.start({ workspace: ws, quiet: true });
    const s = client.last;
    const mcpCalls = (): string[] => s.calls.filter((c) => c.name.startsWith('mcp.')).map((c) => c.name);
    const mcpRpc = s.rpc.mcp as Record<string, unknown>;
    s.listAnswer = [{ name: 'docs', status: 'connected', transport: 'http' }];
    await ad.restartMcpServer(sid, 'docs', { auto: true });
    assert.deepStrictEqual(mcpCalls(), ['mcp.restartServer', 'mcp.list'], 'restartServer, then one list');
    // real T177: it rejects "requires authentication" although the runtime refreshed: the list still runs and decides
    mcpRpc.restartServer = async (x: unknown) => { s.calls.push({ name: 'mcp.restartServer', args: [x] }); throw Object.assign(new Error('Request session.mcp.restartServer failed with message: MCP server "docs" requires authentication'), { code: -32603 }); };
    s.calls.length = 0;
    await assert.rejects(ad.restartMcpServer(sid, 'docs', { auto: true }), /requires authentication/);
    assert.deepStrictEqual(mcpCalls(), ['mcp.restartServer', 'mcp.list'], 'a rejection: the list is still read once');
    // MethodNotFound: rejects, never disable/enable (review item 2)
    mcpRpc.restartServer = async (x: unknown) => { s.calls.push({ name: 'mcp.restartServer', args: [x] }); throw Object.assign(new Error('Unhandled method session.mcp.restartServer'), { code: -32601 }); };
    s.calls.length = 0;
    await assert.rejects(ad.restartMcpServer(sid, 'docs', { auto: true }), /cannot reconnect/);
    assert.deepStrictEqual(mcpCalls(), ['mcp.restartServer'], 'MethodNotFound: failed, nothing switched off and on');
    delete mcpRpc.restartServer;
    s.calls.length = 0;
    await assert.rejects(ad.restartMcpServer(sid, 'docs', { auto: true }), /cannot reconnect/);
    assert.deepStrictEqual(mcpCalls(), [], 'no restartServer at all: nothing is called');
    assert.ok(!s.calls.some((c) => /oauth|disable|enable|reload|stopServer/.test(c.name)), 'never oauth.login (G6), disable, enable, reload or stopServer');
    await ad.stop(sid);
    fs.rmSync(ws, { recursive: true, force: true });
  }
  assert.ok(CopilotAdapter && CLAUDE_CAPABILITIES.mcpSignInReconnect === true, 'the Claude CLI takes part');
  assert.ok(!('mcpSignInReconnect' in CLAUDE_SDK_CAPABILITIES), 'the Claude SDK transport does not (no mcp_reconnect)');
  assert.ok(CODEX_CAPABILITIES.mcpSignInReconnect === undefined && CODEX_CAPABILITIES.mcpRestart === false, 'Codex: no automatic reconnect (FR-207, G7)');

  // ---- the Settings value (FR-213) ----
  {
    assert.deepStrictEqual(parseSettings('{}').mcpSignInRefresh, undefined, 'missing: the default applies');
    assert.strictEqual(parseSettings('{"mcpSignInRefresh":true}').mcpSignInRefresh, true);
    assert.strictEqual(parseSettings('{"mcpSignInRefresh":false}').mcpSignInRefresh, false);
    for (const bad of ['"yes"', '1', 'null', '{}', '[]', '"true"']) assert.strictEqual(parseSettings(`{"mcpSignInRefresh":${bad}}`).mcpSignInRefresh, false, `present non-boolean ${bad} reads off`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-058-set-'));
    const file = path.join(dir, 'settings.json');
    const st = new SettingsStore(file);
    st.load();
    assert.strictEqual(st.mcpSignInRefresh, true, 'no file: on (the default)');
    assert.strictEqual(st.setMcpSignInRefresh('no').value, true, 'a non-boolean changes nothing');
    assert.strictEqual(st.setMcpSignInRefresh(false).value, false);
    const st2 = new SettingsStore(file);
    st2.load();
    assert.strictEqual(st2.mcpSignInRefresh, false, 'off survives a restart');
    fs.writeFileSync(file, JSON.stringify({ mcpSignInRefresh: 'on' }));
    const st3 = new SettingsStore(file);
    st3.load();
    assert.strictEqual(st3.mcpSignInRefresh, false, 'a malformed stored value reads off (fail closed)');
    fs.rmSync(dir, { recursive: true, force: true });
  }

  process.exitCode = 0;
  console.log('[058] mcp sign-in refresh: PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

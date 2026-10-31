/**
 * Spec 100 FR-003, FR-004, FR-040: when main asks for MCP figures, what reaches the window, what is kept. `npm run test:mcpcontextop`.
 * No Electron, no network, no credits.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AgentEvent, McpServerStatus } from '../src/adapters/types';
import type { McpContextView } from '../src/shared/api';
import type { McpContextReport } from '../src/shared/mcpcost';
import { cleanName, cleanReport, McpContextTracker } from '../src/main/mcpcontextop';
import { MAX_COST_NAME, McpCostStore } from '../src/main/mcpcosts';

process.exitCode = 1;
const ID = 'a1';
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await tick(); };
const base = { sessionId: ID, timestamp: 1 };
const mcpEv = (servers: McpServerStatus[]): AgentEvent => ({ ...base, type: 'mcp', servers }) as AgentEvent;
const ctxEv = (): AgentEvent => ({ ...base, type: 'context', tokens: 10, limit: 100 }) as AgentEvent;
const statusEv = (status: string): AgentEvent => ({ ...base, type: 'status', status }) as AgentEvent;
const modelEv = (): AgentEvent => ({ ...base, type: 'model', model: 'm', cause: 'user' }) as AgentEvent;
const FIG: McpContextReport = { servers: [{ name: 'github', tokens: 41_000, source: 'reported' }], window: 200_000 };
const conn = (...names: string[]): McpServerStatus[] => names.map((name) => ({ name, status: 'connected' }));

function harness(answer: () => McpContextReport | Promise<McpContextReport> = () => FIG) {
  const h = { asks: 0, now: 1000, live: conn('github') as McpServerStatus[], off: new Set<string>(), pushed: [] as McpContextView[], kept: [] as unknown[], answer, isLive: true, timers: new Set<{ fn: () => void; ms: number }>() };
  const t = new McpContextTracker({
    agents: new Map([[ID, { id: ID } as never]]),
    router: { forAgent: (id: string) => (id === ID ? { isLive: () => h.isLive, mcpContext: async () => { h.asks++; return h.answer(); } } : undefined) } as never,
    secrets: () => ['s3cretvalue'],
    live: () => h.live,
    off: () => h.off,
    push: (_id, v) => h.pushed.push(v),
    persist: (_id, s, at) => h.kept.push({ s, at }),
    now: () => h.now,
    // the injected clock: a timer runs only when a test fires it, and a test can see what is pending
    setTimer: (fn, ms) => { const t = { fn, ms }; h.timers.add(t); return t; },
    clearTimer: (t) => { h.timers.delete(t as never); },
  });
  return { h, t };
}

async function main(): Promise<void> {
  // FR-003: asked once when the servers are first reported running, not before; the same list again asks nothing
  {
    const { h, t } = harness();
    t.onEvent(mcpEv([{ name: 'github', status: 'pending' }]));
    t.onEvent(mcpEv([]));
    await settle();
    assert.strictEqual(h.asks, 0, 'nothing running yet: no ask');
    t.onEvent(mcpEv(conn('github')));
    await settle();
    assert.strictEqual(h.asks, 1, 'first running: one ask');
    assert.strictEqual(h.pushed.length, 1);
    assert.strictEqual(h.pushed[0].report?.servers[0].tokens, 41_000);
    t.onEvent(mcpEv(conn('github')));
    await settle();
    assert.strictEqual(h.asks, 1, 'the same list: no ask');
    // a switch or a restart changes the running set
    t.onEvent(mcpEv([{ name: 'github', status: 'disabled' }]));
    await settle();
    assert.strictEqual(h.asks, 2, 'a server switched off: asked again');
    t.onEvent(mcpEv([{ name: 'github', status: 'pending' }]));
    await settle();
    assert.strictEqual(h.asks, 2, 'starting: waits');
    t.onEvent(mcpEv(conn('github')));
    await settle();
    assert.strictEqual(h.asks, 3, 'running again: asked again');
    t.onEvent(modelEv());
    await settle();
    assert.strictEqual(h.asks, 4, 'a model or tier change: asked again');
    t.onEvent({ ...ctxEv() });
    await settle();
    assert.strictEqual(h.asks, 4, 'a context event with figures in hand: no ask (never on the stream)');
    t.onEvent({ ...modelEv(), agentId: 'sub' } as AgentEvent);
    await settle();
    assert.strictEqual(h.asks, 4, "a sub-agent's event: only the main agent counts");
  }

  // the coordinator's FR-003 choice: no figure at first (Copilot's null): once more on the next context event, then never
  {
    let reply: McpContextReport = { servers: [] };
    const { h, t } = harness(() => reply);
    t.onEvent(ctxEv());
    await settle();
    assert.strictEqual(h.asks, 0, 'a context event before the servers run: no ask');
    t.onEvent(mcpEv(conn('github')));
    await settle();
    assert.strictEqual(h.asks, 1);
    t.onEvent(ctxEv());
    await settle();
    assert.strictEqual(h.asks, 2, 'no figure: re-asked once');
    t.onEvent(ctxEv());
    t.onEvent(ctxEv());
    await settle();
    assert.strictEqual(h.asks, 2, 'once, however many context events come');
    reply = FIG;
    t.onEvent(mcpEv(conn('github', 'jira')));
    await settle();
    assert.strictEqual(h.asks, 3, 'the other triggers still work');
    assert.ok(h.pushed.at(-1)?.report?.servers.some((s) => s.name === 'github'));
  }

  // FR-003: never on a timer: only the read's own limit is ever pending, and it is cleared; the real timers are never used
  {
    const realT = global.setTimeout, realI = global.setInterval;
    let started = 0;
    (global as unknown as { setTimeout: unknown }).setTimeout = (...a: Parameters<typeof setTimeout>) => { started++; return realT(...a); };
    (global as unknown as { setInterval: unknown }).setInterval = (...a: Parameters<typeof setInterval>) => { started++; return realI(...a); };
    try {
      const { h, t } = harness();
      t.onEvent(mcpEv(conn('github')));
      assert.strictEqual(h.timers.size, 1, 'one limit while the read runs');
      assert.strictEqual([...h.timers][0].ms, 10_000, 'FR-003: 10 s');
      await tick(); await tick(); await tick(); await tick();
      assert.strictEqual(h.asks, 1);
      assert.strictEqual(h.timers.size, 0, 'the limit is cleared with the answer: nothing is left to fire');
      h.now += 3_600_000;
      assert.strictEqual(h.asks, 1, 'an hour later nothing has asked');
      assert.strictEqual(started, 0, 'no real timer or interval');
    } finally {
      global.setTimeout = realT;
      global.setInterval = realI;
    }
  }

  // FR-003: a restart goes connected, pending, connected: asked again (not through `disabled`)
  {
    const { h, t } = harness();
    t.onEvent(mcpEv(conn('github')));
    await settle();
    assert.strictEqual(h.asks, 1);
    t.onEvent(mcpEv([{ name: 'github', status: 'pending' }]));
    await settle();
    t.onEvent(mcpEv(conn('github')));
    await settle();
    assert.ok(h.asks >= 2, `a restart asks again: ${h.asks}`);
    const n = h.asks;
    t.onEvent(mcpEv(conn('github')));
    await settle();
    assert.strictEqual(h.asks, n, 'the same list again: no ask');
  }

  // FR-003, FR-024: one server stuck `pending` does not hold the first ask back; it reads unknown and the figure "at least"
  {
    const { h, t } = harness();
    h.live = [{ name: 'github', status: 'connected' }, { name: 'stuck', status: 'pending' }];
    t.onEvent(mcpEv(h.live));
    await settle();
    assert.strictEqual(h.asks, 1, 'asked with the others up');
    const r = h.pushed.at(-1)?.report;
    assert.deepStrictEqual(r?.servers.find((x) => x.name === 'stuck'), { name: 'stuck', source: 'unknown' });
    assert.strictEqual(r?.partial, true, 'the figure is "at least"');
    for (let i = 0; i < 5; i++) t.onEvent(ctxEv());
    await settle();
    assert.strictEqual(h.asks, 1, 'figures in hand: the context events ask nothing');
  }
  // every server still `pending`: the first context event asks, once
  {
    const { h, t } = harness();
    h.live = [{ name: 'stuck', status: 'pending' }];
    t.onEvent(mcpEv(h.live));
    await settle();
    assert.strictEqual(h.asks, 0, 'nothing up, no turn yet');
    for (let i = 0; i < 5; i++) t.onEvent(ctxEv());
    await settle();
    assert.ok(h.asks >= 1 && h.asks <= 2, `the session runs: asked, not per event: ${h.asks}`);
    assert.ok(h.pushed.length >= 1, 'and reported');
  }

  // finding 9: an adapter answering null or junk: no unhandled rejection, a report with no figures
  {
    const seen: unknown[] = [];
    const onRej = (e: unknown): void => { seen.push(e); };
    process.on('unhandledRejection', onRej);
    for (const junk of [null, undefined, 7, 'x', {}, { servers: 'no' }]) {
      const { h, t } = harness(() => junk as never);
      t.onEvent(mcpEv(conn('github')));
      await settle();
      assert.strictEqual(h.asks, 1);
      assert.deepStrictEqual(h.pushed.at(-1)?.report?.servers, [{ name: 'github', source: 'unknown' }], `junk ${String(junk)}: the running server, no figure`);
    }
    // the window's end of it throwing (a closed window) rejects nothing either
    const { h: h2, t: t2 } = harness();
    const realPush = h2.pushed.push.bind(h2.pushed);
    h2.pushed.push = (() => { throw new Error('window gone'); }) as never;
    t2.onEvent(mcpEv(conn('github')));
    await settle();
    h2.pushed.push = realPush;
    await new Promise((r) => setImmediate(r));
    process.removeListener('unhandledRejection', onRej);
    assert.deepStrictEqual(seen, [], 'no unhandled rejection');
  }

  // FR-003: the dialog's once-a-minute limit
  {
    const { h, t } = harness();
    assert.strictEqual((await t.get(ID, true)).report?.servers[0].tokens, 41_000, 'the first open asks');
    assert.strictEqual(h.asks, 1);
    await t.get(ID, true);
    assert.strictEqual(h.asks, 1, 'an open within the minute reads the last report');
    h.now += 59_999;
    await t.get(ID, true);
    assert.strictEqual(h.asks, 1);
    h.now += 1;
    await t.get(ID, true);
    assert.strictEqual(h.asks, 2, 'after a minute: asked again');
    await t.get(ID);
    assert.strictEqual(h.asks, 2, 'a plain read asks nothing');
    h.now -= 1_000_000;
    await t.get(ID, true);
    assert.strictEqual(h.asks, 3, 'a clock that went back does not block it');
    assert.deepStrictEqual(await t.get('other'), { ok: false, supported: false }, 'an unknown agent');
    assert.deepStrictEqual(await t.get(7), { ok: false, supported: false }, 'not a string');
    h.isLive = false;
    h.now += 120_000;
    await t.get(ID, true);
    assert.strictEqual(h.asks, 3, 'no running session: nothing is started for it');
  }

  // FR-003: a busy control channel waits for the turn's end
  {
    let reply: McpContextReport = { servers: [], busy: true };
    const { h, t } = harness(() => reply);
    t.onEvent(mcpEv(conn('github')));
    await settle();
    assert.strictEqual(h.asks, 1);
    assert.strictEqual(h.pushed.length, 0, 'busy is not a report');
    t.onEvent(ctxEv());
    t.onEvent(statusEv('working'));
    await settle();
    assert.strictEqual(h.asks, 1, 'not again during the turn');
    reply = FIG;
    t.onEvent(statusEv('idle'));
    await settle();
    assert.strictEqual(h.asks, 2, "asked at the turn's end");
    assert.strictEqual(h.pushed.length, 1);
    t.onEvent(statusEv('idle'));
    await settle();
    assert.strictEqual(h.asks, 2, 'once');
  }

  // one ask at a time; one during it runs once after it
  {
    let release!: () => void;
    const { h, t } = harness(() => new Promise<McpContextReport>((r) => { release = () => r(FIG); }));
    t.onEvent(mcpEv(conn('github')));
    await settle();
    t.onEvent(mcpEv(conn('github', 'b')));
    t.onEvent(mcpEv(conn('github', 'b', 'c')));
    await settle();
    assert.strictEqual(h.asks, 1, 'one at a time');
    release();
    await settle();
    assert.strictEqual(h.asks, 2, 'the waiting ask runs once');
    release();
    await settle();
    assert.strictEqual(h.asks, 2);
  }

  // FR-003: the time limit: a read that never answers is given up when it fires, keeps the last figures, and does not block the next ask
  {
    let mode: 'ok' | 'hang' | 'throw' = 'ok';
    const { h, t } = harness(() => { if (mode === 'hang') return new Promise<McpContextReport>(() => undefined); if (mode === 'throw') throw new Error('secret text'); return FIG; });
    t.onEvent(mcpEv(conn('github')));
    await settle();
    const pushed = h.pushed.length;
    mode = 'hang';
    t.onEvent(modelEv());
    await settle();
    assert.strictEqual(h.asks, 2);
    assert.strictEqual(h.timers.size, 1, 'the limit is running');
    t.onEvent(modelEv());
    await settle();
    assert.strictEqual(h.asks, 2, 'one at a time while it hangs');
    mode = 'ok';
    [...h.timers][0].fn(); // the limit
    await settle();
    assert.strictEqual(h.timers.size, 0);
    assert.strictEqual(h.asks, 3, 'after the limit the waiting ask runs: nothing stays blocked');
    assert.strictEqual(t.view(ID).report?.servers[0].tokens, 41_000, 'the last figures stay');
    assert.strictEqual(h.pushed.length, pushed + 1, 'the given-up read pushed nothing, the next one did');
    mode = 'throw';
    t.onEvent(modelEv());
    await settle();
    assert.strictEqual(t.view(ID).report?.servers[0].tokens, 41_000);
    t.onEvent(statusEv('stopped'));
    assert.deepStrictEqual(h.pushed.at(-1), { ok: true, supported: true }, 'the window forgets them');
    assert.deepStrictEqual(t.view(ID), { ok: true, supported: true });
    mode = 'ok';
    t.onEvent(mcpEv(conn('github')));
    await settle();
    assert.ok(t.view(ID).report, 'a new start asks again');
    assert.strictEqual(h.asks, 5);
  }

  // finding 2, 3: names: mask before cut, control and bidi characters gone, within the store's limit, two long names stay two
  {
    const TOKEN = 'ghp_' + 'A'.repeat(36);
    const across = 'x'.repeat(95) + '-' + TOKEN; // a bare token across the cut at 100
    const out = cleanName(across, []);
    assert.ok(!out.includes('ghp_') && !/AAAA/.test(out), `no head of the token: ${out}`);
    assert.ok(out.length <= MAX_COST_NAME, `within the limit: ${out.length}`);
    const secret = 'x'.repeat(95) + 'sEcReTvAlUe9';
    assert.ok(!cleanName(secret, ['sEcReTvAlUe9']).includes('sEcReT'), 'a session secret across the cut');
    assert.ok(!cleanName('a-\u0000ghp_' + 'B'.repeat(36), []).includes('BBBB'), 'a control character does not hide a token from the mask');
    assert.strictEqual(cleanName('line\nbreak\u202eover\u0007bel\u0000nul', []), 'linebreakoverbelnul');
    const a = cleanName('L'.repeat(300) + '1', []), b = cleanName('L'.repeat(300) + '2', []);
    assert.notStrictEqual(a, b, 'two long names stay two');
    assert.ok(a.length <= MAX_COST_NAME && b.length <= MAX_COST_NAME, 'and the store accepts both');
    const t1 = cleanName('ghp_' + 'C'.repeat(36), []), t2 = cleanName('ghp_' + 'D'.repeat(36), []);
    assert.notStrictEqual(t1, t2, 'two token-like names stay two');
    assert.ok(/^unnamed #[0-9a-f]{8}$/.test(cleanName('\u0000\u202e', [])), 'nothing left: a neutral name');
    assert.strictEqual(cleanName('github-mcp-server', []), 'github-mcp-server', 'a plain name is untouched');
    // end to end: the report and the kept file
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-mcpname-'));
    try {
      const store = new McpCostStore(path.join(dir, 'c.json'));
      const rep2 = cleanReport({ servers: [{ name: across, tokens: 5, source: 'reported' }, { name: 'L'.repeat(300) + '1', tokens: 6, source: 'reported' }, { name: 'L'.repeat(300) + '2', tokens: 7, source: 'reported' }, { name: 'n\u202ew', tokens: 8, source: 'reported' }] }, [], new Set(), []);
      store.set('codex', rep2.servers, 1);
      const raw = fs.readFileSync(path.join(dir, 'c.json'), 'utf8');
      assert.strictEqual(Object.keys(store.all().codex).length, 4, `every name is kept: ${raw}`);
      assert.ok(!raw.includes('ghp_') && !raw.includes('\u202e') && !raw.includes('\\u202e'), 'no token head or override on disk');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // FR-040: only names and numbers; masking; failed and off servers are out; a running server with no figure is "unknown"
  {
    const raw = { servers: [
      { name: 'github', tokens: 41_000, deferredTokens: 300, tools: 5, source: 'reported', schema: { secret: 1 }, description: 'a tool text' },
      { name: 'bad', tokens: NaN, source: 'weird' },
      { name: 'down', tokens: 9, source: 'reported' },
      { name: 'switched', tokens: 8, source: 'reported' },
      { name: 'list-failed', source: 'unknown', error: 'tools/list failed: token=abc' },
      { name: 'x-s3cretvalue-y', tokens: 1, source: 'reported' },
      { name: 'n'.repeat(400), tokens: 1, source: 'reported' },
      { name: '', tokens: 1, source: 'reported' },
      null,
    ], window: NaN, total: 77, partial: true, env: { TOKEN: 'abc' }, busy: true } as unknown as McpContextReport;
    const out = cleanReport(raw, [{ name: 'down', status: 'failed', error: 'x' }, { name: 'quiet', status: 'connected' }, { name: 'github', status: 'connected' }], new Set(['switched']), ['s3cretvalue']);
    const by = new Map(out.servers.map((s) => [s.name, s]));
    assert.deepStrictEqual(by.get('github'), { name: 'github', source: 'reported', tokens: 41_000, deferredTokens: 300, tools: 5 }, 'known fields only');
    assert.deepStrictEqual(by.get('bad'), { name: 'bad', source: 'unknown' }, 'a bad number and an odd source');
    assert.ok(!by.has('down') && !by.has('switched'), 'failed and off: not in the report or the total');
    assert.deepStrictEqual(by.get('list-failed'), { name: 'list-failed', source: 'unknown', error: 'list failed' }, 'the fixed word, never the text');
    assert.deepStrictEqual(by.get('quiet'), { name: 'quiet', source: 'unknown' }, 'running with no figure');
    assert.ok(out.servers.every((s) => !s.name.includes('s3cretvalue')), 'a secret value in a name is masked');
    assert.ok(out.servers.every((s) => s.name.length <= 128));
    const text = JSON.stringify(out);
    for (const bad of ['abc', 'a tool text', 'schema', 'env', 'busy']) assert.ok(!text.includes(bad), `not in the report: ${bad}`);
    assert.strictEqual(out.window, undefined, 'a bad window is left out');
    assert.strictEqual(out.total, undefined, 'with rows, the rows are the figure');
    assert.strictEqual(out.partial, true);
    assert.strictEqual(cleanReport({ servers: [], total: 77 }, [], new Set(), []).total, 77);
    assert.deepStrictEqual(cleanReport(null as never, [], new Set(), []), { servers: [] });
    // finding 7: a running server with no figure means "at least", even when the app did not say partial
    assert.strictEqual(cleanReport({ servers: [{ name: 'a', tokens: 1, source: 'reported' }] }, conn('a', 'quiet'), new Set(), []).partial, true);
    assert.strictEqual(cleanReport({ servers: [{ name: 'a', tokens: 1, source: 'reported' }] }, conn('a'), new Set(), []).partial, undefined, 'all figures: not partial');
    assert.strictEqual(cleanReport({ servers: [{ name: 'a', tokens: 0, deferredTokens: 9, source: 'reported' }] }, conn('a'), new Set(), []).partial, undefined, 'all deferred is a figure');
    // the floor stays unless a row was left out
    assert.strictEqual(cleanReport({ servers: [{ name: 'a', tokens: 1, source: 'reported' }], total: 77 }, conn('a'), new Set(), []).total, 77);
  }

  // FR-004 (decided Q3): only reports with figures are kept, without any text; the file keeps names, numbers and the time only
  {
    const { h, t } = harness(() => ({ servers: [] }));
    t.onEvent(mcpEv(conn('github')));
    await settle();
    assert.strictEqual(h.kept.length, 0, 'no figures: nothing kept');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-mcpcost-'));
    try {
      const file = path.join(dir, 'mcp.json');
      const s = new McpCostStore(file);
      s.load();
      s.set('copilot', [{ name: 'github', tokens: 41_000, source: 'reported', tools: 5, description: 'tool text', env: { T: 'x' } } as never, { name: 'off', source: 'unknown' }, { name: 'def', tokens: 1, deferredTokens: 400, source: 'estimated' }, { name: 'big', tokens: 9, source: 'estimated', capped: true }], 5000);
      assert.deepStrictEqual(s.all(), { copilot: { github: { tokens: 41_000, source: 'reported', at: 5000 }, def: { tokens: 1, deferredTokens: 400, source: 'estimated', at: 5000 }, big: { tokens: 9, source: 'estimated', capped: true, at: 5000 } } }, 'a server with no figure is not kept; capped is');
      const raw = fs.readFileSync(file, 'utf8');
      for (const bad of ['tool text', 'env', '"T"']) assert.ok(!raw.includes(bad), `not on disk: ${bad}`);
      const again = new McpCostStore(file);
      again.load();
      assert.deepStrictEqual(again.all(), s.all(), 'kept across a restart, capped too');
      // a hand-edited file: the text is written by hand, so __proto__ is a real own key of the parsed object
      fs.writeFileSync(file, `{"copilot":{"good":{"tokens":5,"source":"reported","at":1},"__proto__":{"tokens":6,"source":"reported","at":1},"bad":{"tokens":"x","source":"reported","at":1},"huge":{"tokens":1e12,"source":"reported","at":1},"odd":{"tokens":1,"source":"nope","at":1},"ctl\\u202ename":{"tokens":1,"source":"reported","at":1}},"nope":{"x":{"tokens":1,"source":"reported","at":1}},"__proto__":{"y":{"tokens":1,"source":"reported","at":1}}}`);
      const odd = new McpCostStore(file);
      odd.load();
      assert.deepStrictEqual(Object.keys(odd.all()), ['copilot'], 'unknown apps are dropped');
      assert.deepStrictEqual(Object.keys(odd.all().copilot), ['good'], `odd entries, a control character and __proto__ are dropped: ${JSON.stringify(Object.keys(odd.all().copilot))}`);
      assert.strictEqual(({} as Record<string, unknown>).tokens, undefined, 'nothing reached a prototype');
      // __proto__ through set: never kept
      const sp = new McpCostStore(path.join(dir, 'p.json'));
      sp.set('copilot', [{ name: '__proto__', tokens: 5, source: 'reported' }, { name: 'ok', tokens: 5, source: 'reported' }], 1);
      assert.deepStrictEqual(Object.keys(sp.all().copilot), ['ok'], '__proto__ through set');
      assert.ok(!fs.readFileSync(path.join(dir, 'p.json'), 'utf8').includes('__proto__'));
      // a corrupt or oversize costs file counts as empty and is replaced: only figures are lost
      for (const bad of ['{"copilot":', 'x'.repeat(300 * 1024)]) {
        fs.writeFileSync(file, bad);
        const c = new McpCostStore(file);
        c.load();
        assert.deepStrictEqual(c.all(), {});
      }
      // a cap: the oldest figures go
      const capped = new McpCostStore(path.join(dir, 'cap.json'));
      capped.load();
      for (let i = 0; i < 205; i++) capped.set('codex', [{ name: `s${i}`, tokens: i, source: 'estimated' }], i + 1);
      const keys = Object.keys(capped.all().codex ?? {});
      assert.strictEqual(keys.length, 200);
      assert.ok(!keys.includes('s0') && keys.includes('s204'), 'the oldest go first');
      capped.set('nope', [{ name: 'x', tokens: 1, source: 'reported' }], 1);
      assert.ok(!('nope' in capped.all()), 'an unknown app is refused');
      // a removed server goes; an app whose list is empty or unread keeps its figures
      const pr = new McpCostStore(path.join(dir, 'prune.json'));
      pr.set('copilot', [{ name: 'gone', tokens: 1, source: 'reported' }, { name: 'here', tokens: 2, source: 'reported' }], 1);
      pr.set('codex', [{ name: 'c', tokens: 3, source: 'estimated' }], 1);
      pr.prune({ copilot: ['here'], codex: [] });
      assert.deepStrictEqual(Object.keys(pr.all().copilot), ['here'], 'the removed server is gone');
      assert.deepStrictEqual(Object.keys(pr.all().codex), ['c'], 'an empty list is not a removal');
      const pr2 = new McpCostStore(path.join(dir, 'prune.json'));
      pr2.load();
      assert.deepStrictEqual(Object.keys(pr2.all().copilot), ['here'], 'and it is gone from the file');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log('test:mcpcontextop OK');
  process.exitCode = 0;
}
void main();

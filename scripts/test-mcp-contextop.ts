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
import { cleanReport, McpContextTracker } from '../src/main/mcpcontextop';
import { McpStore } from '../src/main/mcpstore';

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
  const h = { asks: 0, now: 1000, live: conn('github') as McpServerStatus[], off: new Set<string>(), pushed: [] as McpContextView[], kept: [] as unknown[], answer, isLive: true };
  const t = new McpContextTracker({
    agents: new Map([[ID, { id: ID } as never]]),
    router: { forAgent: (id: string) => (id === ID ? { isLive: () => h.isLive, mcpContext: async () => { h.asks++; return h.answer(); } } : undefined) } as never,
    secrets: () => ['s3cretvalue'],
    live: () => h.live,
    off: () => h.off,
    push: (_id, v) => h.pushed.push(v),
    persist: (_id, s, at) => h.kept.push({ s, at }),
    now: () => h.now,
    timeoutMs: 30,
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

  // FR-003: never on a timer: a long quiet time asks nothing
  {
    const { h, t } = harness();
    t.onEvent(mcpEv(conn('github')));
    await settle();
    h.now += 3_600_000;
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(h.asks, 1, 'nothing asks by itself');
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

  // the time limit and a failure keep the last figures; End session drops them; a report in flight when the session stops is dropped
  {
    let mode: 'ok' | 'hang' | 'throw' = 'ok';
    const { h, t } = harness(() => { if (mode === 'hang') return new Promise<McpContextReport>(() => undefined); if (mode === 'throw') throw new Error('secret text'); return FIG; });
    t.onEvent(mcpEv(conn('github')));
    await settle();
    const pushed = h.pushed.length;
    mode = 'hang';
    t.onEvent(modelEv());
    await new Promise((r) => setTimeout(r, 60));
    assert.strictEqual(h.pushed.length, pushed, 'a read over the limit pushes nothing');
    assert.strictEqual(t.view(ID).report?.servers[0].tokens, 41_000, 'the last figures stay');
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
  }

  // FR-004 (decided Q3): only reports with figures are kept, without any text; the store keeps names, numbers and the time only
  {
    const { h, t } = harness(() => ({ servers: [] }));
    t.onEvent(mcpEv(conn('github')));
    await settle();
    assert.strictEqual(h.kept.length, 0, 'no figures: nothing kept');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-mcpcost-'));
    try {
      const file = path.join(dir, 'mcp.json');
      const s = new McpStore(file);
      s.load();
      s.setMcpCosts('copilot', [{ name: 'github', tokens: 41_000, source: 'reported', tools: 5, description: 'tool text', env: { T: 'x' } } as never, { name: 'off', source: 'unknown' }, { name: 'def', tokens: 1, deferredTokens: 400, source: 'estimated' }], 5000);
      assert.deepStrictEqual(s.mcpCosts(), { copilot: { github: { tokens: 41_000, source: 'reported', at: 5000 }, def: { tokens: 1, deferredTokens: 400, source: 'estimated', at: 5000 } } }, 'a server with no figure is not kept');
      const raw = fs.readFileSync(file, 'utf8');
      for (const bad of ['tool text', 'env', '"T"']) assert.ok(!raw.includes(bad), `not on disk: ${bad}`);
      const again = new McpStore(file);
      again.load();
      assert.deepStrictEqual(again.mcpCosts(), s.mcpCosts(), 'kept across a restart');
      // a hand-edited file
      const doc = JSON.parse(raw);
      doc.mcpCosts = { copilot: { good: { tokens: 5, source: 'reported', at: 1 }, bad: { tokens: 'x', source: 'reported', at: 1 }, huge: { tokens: 1e12, source: 'reported', at: 1 }, odd: { tokens: 1, source: 'nope', at: 1 }, ['__proto__x']: 1 }, nope: { x: { tokens: 1, source: 'reported', at: 1 } } };
      fs.writeFileSync(file, JSON.stringify(doc));
      const odd = new McpStore(file);
      odd.load();
      assert.deepStrictEqual(odd.mcpCosts(), { copilot: { good: { tokens: 5, source: 'reported', at: 1 } } }, 'odd entries and unknown apps are dropped');
      // a cap: the oldest figures go
      const capped = new McpStore(path.join(dir, 'cap.json'));
      capped.load();
      for (let i = 0; i < 205; i++) capped.setMcpCosts('codex', [{ name: `s${i}`, tokens: i, source: 'estimated' }], i + 1);
      const keys = Object.keys(capped.mcpCosts().codex ?? {});
      assert.strictEqual(keys.length, 200);
      assert.ok(!keys.includes('s0') && keys.includes('s204'), 'the oldest go first');
      capped.setMcpCosts('nope', [{ name: 'x', tokens: 1, source: 'reported' }], 1);
      assert.ok(!('nope' in capped.mcpCosts()), 'an unknown app is refused');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log('test:mcpcontextop OK');
  process.exitCode = 0;
}
void main();

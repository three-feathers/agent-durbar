/** Spec 012 T025 (FR-015, FR-016, FR-029): usage and context from the Claude and Codex mappers, end to end into the usage totals. SYNTHETIC input, no SDK, no Codex, no credits: part of `npm run test:runtime`. */
import * as assert from 'assert';
import * as path from 'path';
import { ClaudeMapper } from '../src/adapters/claudeMap';
import type { ClaudeMessage } from '../src/adapters/claudeMap';
import { CodexMapper } from '../src/adapters/codexMap';
import type { EventBody } from '../src/adapters/map';
import { emptyUsageDoc, officeTotals, recordUsage } from '../src/shared/usagedoc';

type Total = { calls: number; inTokens: number; outTokens: number; nano: number; unreported: number };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const U = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'usagetotals.js')) as {
  createLedger: () => { record: (room: string, e: unknown) => void; room: (id: string) => Total; office: () => Total };
  fmtTotal: (t: Total) => string;
};
const AIU = 1e9;

const claude = (ms: ClaudeMessage[]): EventBody[] => {
  const out: EventBody[] = [];
  const m = new ClaudeMapper((b) => out.push(b));
  ms.forEach((x) => m.map(x));
  return out;
};
const codex = (ns: Array<{ method: string; params: unknown }>): EventBody[] => {
  const out: EventBody[] = [];
  const m = new CodexMapper((b) => out.push(b));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ns.forEach((n) => m.map(n as any));
  return out;
};
const res = (c: number): ClaudeMessage => ({ type: 'result', subtype: 'success', total_cost_usd: c });
const costs = (ms: ClaudeMessage[]): number[] => claude(ms).flatMap((e) => (e.type === 'usage' && e.costUsd !== undefined ? [Math.round(e.costUsd * 1e6) / 1e6] : []));
const START = { method: 'thread/started', params: { thread: { id: 't', cwd: '/w' } } };
const tokenUpdate = (window?: unknown): { method: string; params: unknown } => ({
  method: 'thread/tokenUsage/updated',
  params: { threadId: 't', turnId: 'u', tokenUsage: { last: { inputTokens: 600, outputTokens: 100 }, ...(window === undefined ? {} : { modelContextWindow: window }) } },
});

// 1. Claude cost is the delta of the running total_cost_usd, never the total itself (a, FR-029).
assert.deepStrictEqual(costs([res(0.5), res(0.75), res(2)]), [0.5, 0.25, 1.25], 'each amount is new spend, not the running total');
assert.notDeepStrictEqual(costs([res(0.5), res(0.75)]), [0.5, 0.75], 'the running total is never reported as an amount');
// a total that drops (resumed query restarting it): nothing negative, nothing invented; spend after the drop counts from the new total.
assert.deepStrictEqual(costs([res(1), res(0.25), res(0.5)]), [1, 0.25], 'decrease: no event for the drop, the next growth is a delta from the lower total');
assert.ok(costs([res(1), res(0.25)]).every((c) => c > 0), 'never a negative or zero cost');
assert.deepStrictEqual(costs([{ type: 'result', subtype: 'success' }, { type: 'result', subtype: 'success', total_cost_usd: 'x' }]), [], 'no or malformed total_cost_usd: no cost');
for (const e of claude([res(0.5)]).filter((e) => e.type === 'usage')) assert.ok(e.type === 'usage' && e.costBasis === 'estimate' && e.nanoAiu === undefined, 'USD is an estimate, never AIU');

// 2. Codex: a null, absent or invalid modelContextWindow is "unknown" (limit 0), never a guessed number (c, FR-016).
for (const w of [null, undefined, 'big', -5, 0, NaN]) {
  const ctx = codex([START, tokenUpdate(w)]).filter((e) => e.type === 'context');
  assert.deepStrictEqual(ctx.map((e) => e.type === 'context' && [e.tokens, e.limit]), [[600, 0]], `window ${String(w)} gives limit 0`);
}
assert.deepStrictEqual(codex([START, tokenUpdate(272000)]).filter((e) => e.type === 'context').map((e) => e.type === 'context' && e.limit), [272000], 'a real window is passed through');

// 3. Codex reports tokens only: no money, no credits (d, FR-015).
const codexUsage = codex([START, tokenUpdate(null), tokenUpdate(272000)]).filter((e) => e.type === 'usage');
assert.strictEqual(codexUsage.length, 2);
for (const e of codexUsage) assert.ok(!('costUsd' in e) && !('costBasis' in e) && !('nanoAiu' in e) && !('creditsStatus' in e), 'no cost, no credits on a Codex usage event');

// 4. End to end into the renderer ledger: Codex shows "cost not reported", never 0 AIU or a dollar figure (d).
{
  const l = U.createLedger();
  for (const e of codexUsage) l.record('cx', e);
  const t = l.room('cx');
  assert.strictEqual(t.calls, 2);
  assert.strictEqual(t.unreported, 2);
  assert.strictEqual(t.nano, 0);
  assert.strictEqual(U.fmtTotal(t), 'cost not reported');
  assert.ok(!/AIU|\$|USD/.test(U.fmtTotal(t)), 'no AIU or dollar figure');
}

// 5. A mixed office keeps units apart: Copilot AIU + Claude USD estimate + Codex nothing (e, FR-029).
{
  const claudeEv = claude([{ type: 'assistant', message: { id: 'm1', model: 'c', content: [], usage: { input_tokens: 100, output_tokens: 10 } } }, res(3.5)]).filter((e) => e.type === 'usage');
  assert.ok(claudeEv.some((e) => e.type === 'usage' && e.costUsd === 3.5), 'Claude supplies a USD estimate');
  const copilotEv = { type: 'usage', inputTokens: 1000, outputTokens: 100, nanoAiu: 0.5 * AIU };

  const l = U.createLedger();
  l.record('copilot', copilotEv);
  claudeEv.forEach((e) => l.record('claude', e));
  codexUsage.forEach((e) => l.record('codex', e));
  assert.strictEqual(l.office().nano, 0.5 * AIU, 'only Copilot AIU is summed: USD never enters AIU');
  assert.strictEqual(l.room('claude').nano, 0, 'a Claude folder has no AIU');
  assert.strictEqual(l.room('claude').unreported, l.room('claude').calls, 'every Claude call is "cost not reported"');
  assert.strictEqual(U.fmtTotal(l.room('claude')), 'cost not reported');
  assert.strictEqual(l.office().unreported, l.room('claude').calls + 2, 'office counts Claude and Codex calls as unreported');
  assert.ok(/AIU/.test(U.fmtTotal(l.office())) && !/3\.5|\$/.test(U.fmtTotal(l.office())), 'office shows AIU only, no dollars');

  // the persisted totals (src/shared/usagedoc) behave the same
  const doc = emptyUsageDoc();
  const key = 'c'.repeat(32);
  recordUsage(doc, key, 'app', copilotEv);
  claudeEv.forEach((e) => recordUsage(doc, key, 'app', e));
  codexUsage.forEach((e) => recordUsage(doc, key, 'app', e));
  const o = officeTotals(doc);
  assert.strictEqual(o.nano, 0.5 * AIU, 'persisted office total: AIU only');
  assert.strictEqual(o.calls, 1 + claudeEv.length + 2);
  assert.strictEqual(o.unreported, claudeEv.length + 2);
}

// 6. Claude usage is counted per message.id, never twice (growth only), per mapper (FR-082).
{
  const asst = (id: unknown, extra: Record<string, unknown> = {}, block: unknown = { type: 'text', text: 'x' }, usage: unknown = { input_tokens: 100, output_tokens: 10 }): ClaudeMessage =>
    ({ type: 'assistant', ...extra, message: { ...(id === undefined ? {} : { id }), model: 'c', content: [block], usage } });
  const n = (ms: ClaudeMessage[]): number => claude(ms).filter((e) => e.type === 'usage').length;
  assert.strictEqual(n([asst('msg_1'), asst('msg_1', {}, { type: 'tool_use', id: 't', name: 'Read', input: {} }), asst('msg_2')]), 2, 'two distinct ids over three messages: two usage events');
  assert.strictEqual(n([asst(undefined), asst(undefined), asst(7), asst(7)]), 4, 'no id or a non-string id: always counted');
  // sub-agent streams follow the same rule
  const sub = { parent_tool_use_id: 'toolA' };
  assert.strictEqual(n([asst('s1', sub), asst('s1', sub), asst('s2', sub), asst('m1'), asst('m1')]), 3, 'sub-agent messages deduped by id too');
  // a later message with the same id adds only the growth per field; identical repeats and smaller figures add nothing
  {
    const g = (o: number, i = 100, c?: number): ClaudeMessage => asst('g', {}, undefined, { input_tokens: i, output_tokens: o, ...(c === undefined ? {} : { cache_read_input_tokens: c }) });
    const ev = claude([g(1), g(10)]).filter((e) => e.type === 'usage');
    assert.strictEqual(ev.length, 2, 'partial figure, then the final one under the same id: two events');
    assert.ok(ev[1].type === 'usage' && ev[1].outputTokens === 9 && ev[1].inputTokens === undefined, 'second event: output growth only, no input growth');
    const sum = (k: 'inputTokens' | 'outputTokens'): number => ev.reduce((a, e) => a + (e.type === 'usage' ? e[k] ?? 0 : 0), 0);
    assert.deepStrictEqual([sum('inputTokens'), sum('outputTokens')], [100, 10], 'the totals over both events equal the final figures');
    assert.strictEqual(n([g(10), g(10), g(10)]), 1, 'identical repeats count once');
    assert.strictEqual(n([g(10), g(3)]), 1, 'a smaller later figure: no event');
    assert.strictEqual(n([g(10), g(3), g(10)]), 1, 'a smaller figure does not lower what was counted');
    const mixed = claude([g(10, 100, 4), g(10, 150, 4), g(12, 150, 9)]).filter((e) => e.type === 'usage');
    assert.deepStrictEqual(mixed.map((e) => e.type === 'usage' && [e.inputTokens, e.outputTokens, e.cacheReadTokens]), [[104, 10, 4], [50, undefined, undefined], [5, 2, 5]], 'growth per field (input includes the cache reads, FR-124)');
    // FR-124: input = input_tokens + cache writes + cache reads; cacheReadTokens is the read part
    const w = claude([asst('w', {}, undefined, { input_tokens: 3, cache_creation_input_tokens: 15000, cache_read_input_tokens: 2000, output_tokens: 20 })]).filter((e) => e.type === 'usage');
    assert.deepStrictEqual(w.map((e) => e.type === 'usage' && [e.inputTokens, e.outputTokens, e.cacheReadTokens]), [[17003, 20, 2000]]);
    const only = claude([asst('o', {}, undefined, { cache_creation_input_tokens: 500 })]).filter((e) => e.type === 'usage');
    assert.ok(only.length === 1 && only[0].type === 'usage' && only[0].inputTokens === 500, 'a cache write alone is usage');
  }
  // one id is counted once across the main stream and a sub-agent stream
  assert.strictEqual(n([asst('x'), asst('x', sub)]), 1, 'same id in main and sub-agent streams: counted once');
  // reset() forgets the ids (a new session on the same mapper)
  {
    const out: EventBody[] = [];
    const m = new ClaudeMapper((b) => out.push(b));
    m.map(asst('r1'));
    m.reset();
    m.map(asst('r1'));
    assert.strictEqual(out.filter((e) => e.type === 'usage').length, 2, 'id, reset, same id: counted twice');
  }
  // usage with no numeric token field is not usage and does not use up the id; numeric zeros are usage and do
  {
    const u = claude([asst('e', {}, undefined, {}), asst('e', {}, undefined, { input_tokens: 5, output_tokens: 2 })]).filter((e) => e.type === 'usage');
    assert.strictEqual(u.length, 1, 'empty usage then real usage with the same id: one event');
    assert.ok(u[0].type === 'usage' && u[0].inputTokens === 5 && u[0].outputTokens === 2, 'the event carries the real tokens');
    const z = claude([asst('z', {}, undefined, { input_tokens: 0, output_tokens: 0 }), asst('z', {}, undefined, { input_tokens: 5, output_tokens: 2 })]).filter((e) => e.type === 'usage');
    assert.strictEqual(z.length, 2, 'all-zero numeric usage counts and uses up the id; the real figures follow as growth');
    assert.ok(z[0].type === 'usage' && z[0].inputTokens === 0 && z[0].outputTokens === 0, 'the first event is the zero one');
    assert.ok(z[1].type === 'usage' && z[1].inputTokens === 5 && z[1].outputTokens === 2, 'the second event is the growth');
    assert.strictEqual(n([asst('w', {}, undefined, {}), asst('w', {}, undefined, 'x')]), 0, 'no numeric field, or a non-object usage: no event');
  }
  // the bound: 512 ids are remembered; the 513th distinct id pushes the first out, so it counts again (documented gap)
  const many = Array.from({ length: 513 }, (_, i) => asst(`id${i}`));
  assert.strictEqual(n([...many, asst('id1')]), 513, 'a remembered id is not counted again');
  assert.strictEqual(n([...many, asst('id0')]), 514, 'after 513 distinct ids the first counts again');
}

console.log('test-usage-012: ok');

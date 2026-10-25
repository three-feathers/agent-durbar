/**
 * Spec 015 FR-006..FR-013 (issue #601): compaction for every agent app, the "Compacting" rule and the gauge maths. `npm run test:compaction`. No credits.
 * The Claude and Codex shapes are synthetic, written from the sources named in the spec (`read:` only, no real compaction seen); Copilot's
 * `session.truncation` follows the SDK's generated types.
 */
import * as assert from 'assert';
import * as path from 'path';
import { ClaudeMapper } from '../src/adapters/claudeMap';
import { CodexMapper } from '../src/adapters/codexMap';
import { EventMapper } from '../src/adapters/map';
import type { EventBody } from '../src/adapters/map';
import { eventProblems } from '../src/adapters/eventguard';

/* eslint-disable @typescript-eslint/no-var-requires */
const root = path.join(__dirname, '..', '..', 'src', 'renderer');
const DM = require(path.join(root, 'modelswitch.js')) as {
  compactingNow(a: unknown): boolean;
  COMPACTING_LINE: string;
  compactionText(e: unknown): string;
  compactionFoldText(e: unknown, n: number, at?: string): string;
};
const ST = require(path.join(root, 'toolstats.js')) as { ctxLevel(u: unknown, l: unknown): { pct: number | null; level: string }; fmtTokens(n: unknown): string };
const CB = require(path.join(root, 'ctxbreakdown.js')) as { summary(ctx: unknown, o: unknown): { known: boolean; pct: number | null; name: string; tip: string } };
/* eslint-enable @typescript-eslint/no-var-requires */

const valid = (bodies: EventBody[]): void => {
  for (const b of bodies) assert.deepStrictEqual(eventProblems({ ...b, sessionId: 's', timestamp: 1 }), [], JSON.stringify(b));
};
const comp = (o: EventBody[]): string[] => o.filter((e) => e.type === 'compaction').map((e) => (e.type === 'compaction' ? `${e.phase}:${e.trigger}${e.tokensBefore !== undefined ? ':b' + e.tokensBefore : ''}` : ''));

// 1. Claude Code: status compacting -> start; compact_boundary -> complete (trigger from the metadata, size before only)
{
  const run = (msgs: Record<string, unknown>[]): EventBody[] => { const o: EventBody[] = []; const m = new ClaudeMapper((b) => o.push(b)); for (const x of msgs) m.map(x as never); return o; };
  const status = (s: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ type: 'system', subtype: 'status', status: s, ...extra });
  const boundary = (meta: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ type: 'system', subtype: 'compact_boundary', compact_metadata: meta, ...extra });
  let o = run([status('compacting'), boundary({ trigger: 'auto', pre_tokens: 167000 }), status(null)]);
  assert.deepStrictEqual(comp(o), ['start:unknown', 'complete:auto:b167000']);
  valid(o);
  assert.deepStrictEqual(comp(run([status('compacting'), boundary({ trigger: 'manual', pre_tokens: 90 })])), ['start:unknown', 'complete:manual:b90']);
  // post_tokens (optional in the SDK): the real size after; hostile values are dropped like pre_tokens
  o = run([boundary({ trigger: 'auto', pre_tokens: 167000, post_tokens: 31000 })]);
  assert.deepStrictEqual(o.map((e) => (e.type === 'compaction' ? [e.tokensBefore, e.tokensAfter, e.tokensRemoved] : null)), [[167000, 31000, 136000]]);
  valid(o);
  for (const bad of [NaN, Infinity, -1, 1e12, '5', null, {}, 999999999.6]) {
    o = run([boundary({ trigger: 'auto', pre_tokens: 100, post_tokens: bad })]);
    assert.ok(o[0] && o[0].type === 'compaction' && o[0].tokensAfter === undefined && o[0].tokensRemoved === undefined, 'post_tokens ' + String(bad));
    valid(o);
  }
  assert.strictEqual((run([boundary({ trigger: 'auto', pre_tokens: 999999999.6 })])[0] as { tokensBefore?: number }).tokensBefore, undefined, 'a size that rounds to 1e9 is dropped');
  assert.deepStrictEqual(comp(run([boundary({ trigger: 'auto', pre_tokens: 5 })])), ['complete:auto:b5'], 'a boundary with no start still ends');
  assert.deepStrictEqual(comp(run([status('compacting'), status('compacting')])), ['start:unknown'], 'a second compacting adds nothing');
  // hostile numbers and triggers: dropped or unknown, never copied
  for (const bad of [NaN, Infinity, -Infinity, -1, 1e12, '5', null, {}, [1]]) {
    o = run([boundary({ trigger: 'auto', pre_tokens: bad })]);
    assert.deepStrictEqual(comp(o), ['complete:auto'], 'pre_tokens ' + String(bad));
    valid(o);
  }
  for (const bad of ['__proto__', 'AUTO', 5, null, { x: 1 }, 'manual '])
    assert.deepStrictEqual(comp(run([boundary({ trigger: bad, pre_tokens: 1 })])), ['complete:unknown:b1'], 'trigger ' + JSON.stringify(bad));
  for (const bad of [undefined, null, 'x', 5, [1]]) assert.deepStrictEqual(comp(run([boundary(bad)])), ['complete:unknown'], 'metadata ' + JSON.stringify(bad));
  assert.deepStrictEqual(comp(run([status('compacting', { parent_tool_use_id: 'toolu_1' }), boundary({ trigger: 'auto' }, { parent_tool_use_id: 'toolu_1' })])), [], "a helper's compaction is not shown");
  assert.deepStrictEqual(comp(run([status('compacting', { agent_id: 'a1' })])), [], "a helper's (agent_id) compaction is not shown");
  assert.deepStrictEqual(comp(run([status('requesting'), status(null), status(5)])), [], 'other statuses are ignored');
  // failure: the explicit result, then nothing left open; and the turn's result closes an open one
  o = run([status('compacting'), status(null, { compact_result: 'failed', compact_error: 'sk-' + 'x'.repeat(40) })]);
  assert.deepStrictEqual(comp(o), ['start:unknown', 'failed:unknown']);
  assert.ok(!JSON.stringify(o).includes('sk-'), 'no vendor text in a failure');
  valid(o);
  assert.deepStrictEqual(comp(run([status(null, { compact_result: 'failed' })])), [], 'a failure with nothing open says nothing');
  o = run([status('compacting'), { type: 'result', subtype: 'success', is_error: false, result: 'ok' }]);
  assert.deepStrictEqual(comp(o), ['start:unknown', 'failed:unknown'], 'an open compaction at the turn end failed');
  o = run([status('compacting'), boundary({ trigger: 'auto' }), { type: 'result', subtype: 'success', is_error: false, result: 'ok' }]);
  assert.deepStrictEqual(comp(o), ['start:unknown', 'complete:auto'], 'a finished one is not failed again');
  // reset forgets an open compaction
  const out: EventBody[] = [];
  const m = new ClaudeMapper((b) => out.push(b));
  m.map(status('compacting') as never);
  m.reset();
  m.map({ type: 'result', subtype: 'success', is_error: false, result: 'ok' } as never);
  assert.deepStrictEqual(comp(out), ['start:unknown'], 'after reset nothing is open');
  m.map(status('compacting') as never);
  assert.deepStrictEqual(comp(out), ['start:unknown', 'start:unknown'], 'and a new compaction starts again');
}

// 2. Codex: contextCompaction item started -> start, completed -> complete; helper threads ignored; failed at the turn's end
{
  const start = { method: 'thread/started', params: { thread: { id: 'th', cwd: '/w' } } };
  const item = (method: string, type = 'contextCompaction', id = 'c1', threadId = 'th'): Record<string, unknown> => ({ method, params: { threadId, turnId: 't1', item: { type, id } } });
  const turnDone = { method: 'turn/completed', params: { threadId: 'th', turn: { id: 't1', status: 'completed' } } };
  const run = (msgs: Record<string, unknown>[]): EventBody[] => { const o: EventBody[] = []; const m = new CodexMapper((b) => o.push(b)); for (const x of [start, ...msgs]) m.map(x as never); return o.slice(1); };
  let o = run([item('item/started'), item('item/completed')]);
  assert.deepStrictEqual(comp(o), ['start:unknown', 'complete:unknown']);
  valid(o);
  assert.deepStrictEqual(comp(run([item('item/completed')])), ['complete:unknown'], 'a completed item with no start still ends');
  assert.deepStrictEqual(comp(run([item('item/started'), item('item/started', 'contextCompaction', 'c2')])), ['start:unknown'], 'a second start adds nothing');
  assert.deepStrictEqual(comp(run([item('item/started'), turnDone])), ['start:unknown', 'failed:unknown'], 'open at the end of the turn: failed');
  assert.deepStrictEqual(comp(run([item('item/started'), item('item/completed'), turnDone])), ['start:unknown', 'complete:unknown'], 'finished: not failed again');
  assert.deepStrictEqual(comp(run([turnDone])), [], 'nothing open: nothing said');
  assert.deepStrictEqual(comp(run([item('item/started', 'userMessage'), item('item/started', 'contextCompactionX'), item('item/started', '__proto__')])), [], 'other item types are not compactions');
  assert.deepStrictEqual(comp(run([{ method: 'item/started', params: { threadId: 'th', item: { type: 'contextCompaction' } } }])), [], 'an item with no id is dropped, as every item');
  // a child thread (a helper) is not the main agent's compaction
  const child = [
    { method: 'item/started', params: { threadId: 'th', turnId: 't1', item: { type: 'collabAgentToolCall', id: 'spawn1', tool: 'spawn_agent', receiverThreadIds: ['kid'], prompt: 'p' } } },
    { method: 'item/started', params: { threadId: 'kid', turnId: 't', item: { type: 'contextCompaction', id: 'k1' } } },
    { method: 'item/completed', params: { threadId: 'kid', turnId: 't', item: { type: 'contextCompaction', id: 'k1' } } },
  ];
  assert.deepStrictEqual(comp(run(child)), [], "a helper thread's compaction is not shown");
  // reset
  const out: EventBody[] = [];
  const m = new CodexMapper((b) => out.push(b));
  for (const x of [start, item('item/started')]) m.map(x as never);
  m.reset();
  for (const x of [start, turnDone]) m.map(x as never);
  assert.deepStrictEqual(comp(out), ['start:unknown'], 'after reset nothing is open');
}

// 3. Copilot: session.truncation -> a complete with the removed count only; compaction_start/complete unchanged
{
  const run = (evs: { type: string; agentId?: string; data: Record<string, unknown> }[]): EventBody[] => { const o: EventBody[] = []; const m = new EventMapper((b) => o.push(b)); for (const x of evs) m.map(x as never); return o; };
  const trunc = (d: Record<string, unknown>, agentId?: string): { type: string; agentId?: string; data: Record<string, unknown> } => ({ type: 'session.truncation', ...(agentId ? { agentId } : {}), data: { performedBy: 'BasicTruncator', messagesRemovedDuringTruncation: 4, preTruncationMessagesLength: 20, postTruncationMessagesLength: 16, preTruncationTokensInMessages: 90000, postTruncationTokensInMessages: 60000, tokensRemovedDuringTruncation: 30000, tokenLimit: 128000, ...d } });
  let o = run([trunc({})]);
  assert.deepStrictEqual(o.map((e) => (e.type === 'compaction' ? { p: e.phase, t: e.trigger, r: e.tokensRemoved, l: e.limit, b: e.tokensBefore, a: e.tokensAfter } : null)), [{ p: 'complete', t: 'truncation', r: 30000, l: 128000, b: undefined, a: undefined }], 'removed and limit only; message counts are not window sizes');
  valid(o);
  for (const bad of [NaN, Infinity, -5, 1e12, '5', null, {}]) {
    o = run([trunc({ tokensRemovedDuringTruncation: bad, tokenLimit: bad })]);
    const e = o[0];
    assert.ok(e && e.type === 'compaction' && e.tokensRemoved === undefined && e.limit === undefined, 'hostile ' + String(bad));
    valid(o);
  }
  assert.deepStrictEqual(run([trunc({}, 'sub-1')]), [], "a helper's truncation is not shown");
  // FR-009b: the turn's idle does NOT end an open compaction (Copilot compacts in the background): no failed event, and the original trigger reaches the complete
  const cstart = { type: 'session.compaction_start', data: { trigger: 'manual', currentTokens: 100, tokenLimit: 1000 } };
  const cdone = { type: 'session.compaction_complete', data: { success: true, preCompactionTokens: 100, postCompactionTokens: 20, tokenLimit: 1000 } };
  const idle = { type: 'session.idle', data: {} };
  assert.deepStrictEqual(comp(run([cstart, idle, cdone])), ['start:manual:b100', 'complete:manual:b100'], 'start, idle, complete: no failure line, trigger kept');
  assert.deepStrictEqual(comp(run([cstart, idle])), ['start:manual:b100'], 'an idle alone ends nothing in the stream');
  assert.ok(!JSON.stringify(run([cstart, idle, { type: 'session.error', data: { errorType: 'x', message: 'm' } }])).includes('"failed"'), 'a session error after an idle does not invent a failed compaction');
  assert.deepStrictEqual(comp(run([cstart, cdone, idle])), ['start:manual:b100', 'complete:manual:b100']);
  assert.deepStrictEqual(comp(run([idle])), [], 'nothing open: nothing said');
  {
    const out: EventBody[] = [];
    const m = new EventMapper((b) => out.push(b));
    for (const x of [cstart, idle]) m.map(x as never);
    m.reset();
    m.map(cdone as never);
    assert.deepStrictEqual(comp(out), ['start:manual:b100', 'complete:auto:b100'], 'after a reset (session end) the open compaction is forgotten, never reported as failed');
  }
  o = run([{ type: 'session.compaction_start', data: { trigger: 'manual', currentTokens: 100, tokenLimit: 1000 } }, { type: 'session.compaction_complete', data: { success: true, preCompactionTokens: 100, postCompactionTokens: 20, tokenLimit: 1000 } }]);
  assert.deepStrictEqual(comp(o), ['start:manual:b100', 'complete:manual:b100']);
}

// 4. The event guard: the whole trigger set, counts, error
{
  const ev = (o: Record<string, unknown>): string[] => eventProblems({ type: 'compaction', sessionId: 's', timestamp: 1, phase: 'complete', trigger: 'auto', ...o });
  assert.deepStrictEqual(ev({}), []);
  for (const t of ['auto', 'manual', 'model-switch', 'overflow', 'truncation', 'unknown']) assert.deepStrictEqual(ev({ trigger: t }), [], t);
  for (const t of ['AUTO', '', 'compact', undefined, 5, null, {}]) assert.ok(ev({ trigger: t }).length > 0, 'trigger ' + JSON.stringify(t));
  for (const k of ['tokensBefore', 'tokensAfter', 'tokensRemoved', 'limit']) for (const v of [NaN, Infinity, -1, '5', {}]) assert.ok(ev({ [k]: v }).some((p) => p.includes(k)), `${k}=${String(v)}`);
  assert.ok(ev({ error: 5 }).length > 0, 'error must be a string');
  assert.ok(ev({ phase: 'later' }).length > 0);
}

// 5. The renderer rule: who shows Compacting
{
  const base = { live: true, compacting: true, state: 'working' };
  assert.strictEqual(DM.compactingNow(base), true);
  assert.strictEqual(DM.compactingNow({ ...base, state: 'idle' }), true, 'a manual compaction runs while idle');
  assert.strictEqual(DM.compactingNow({ ...base, state: 'thinking' }), true);
  for (const s of ['waiting', 'error', 'done']) assert.strictEqual(DM.compactingNow({ ...base, state: s }), false, s + ' keeps its own word');
  assert.strictEqual(DM.compactingNow({ ...base, parent: 'p' }), false, 'a helper never');
  assert.strictEqual(DM.compactingNow({ ...base, paused: true }), false, 'a paused agent says Paused');
  assert.strictEqual(DM.compactingNow({ ...base, live: false }), false, 'a demo or history entry');
  assert.strictEqual(DM.compactingNow({ ...base, compacting: false }), false);
  for (const v of [undefined, 1, 'true', {}, []]) assert.strictEqual(DM.compactingNow({ ...base, compacting: v }), false, 'compacting=' + JSON.stringify(v));
  for (const a of [null, undefined, 0, 'x', []]) assert.strictEqual(DM.compactingNow(a), false);
  assert.strictEqual(DM.COMPACTING_LINE, 'Compacting the conversation…');
}

// 6. The chat lines
{
  assert.strictEqual(DM.compactionText({ phase: 'start', trigger: 'unknown' }), 'Compacting the context…');
  assert.strictEqual(DM.compactionText({ phase: 'start', trigger: 'auto' }), 'Compacting the context (automatic)…');
  assert.strictEqual(DM.compactionText({ phase: 'complete', trigger: 'unknown' }), 'Context compacted.');
  assert.strictEqual(DM.compactionText({ phase: 'complete', trigger: 'auto', tokensBefore: 167000 }), 'Context compacted (automatic): it held 167k tokens.');
  assert.strictEqual(DM.compactionText({ phase: 'complete', trigger: 'auto', tokensBefore: 167000, tokensAfter: 31000 }), 'Context compacted (automatic): 167k → 31k tokens.');
  assert.strictEqual(DM.compactionText({ phase: 'complete', trigger: 'truncation', tokensRemoved: 30000 }), 'Older messages dropped to fit the window: 30k tokens removed.');
  assert.ok(!/compacted/i.test(DM.compactionText({ phase: 'complete', trigger: 'truncation' })), 'a truncation is never "compacted"');
  assert.strictEqual(DM.compactionFoldText({ phase: 'complete', trigger: 'truncation', tokensRemoved: 1000 }, 3, '10:21'), DM.compactionText({ phase: 'complete', trigger: 'truncation', tokensRemoved: 1000 }), 'a truncation never folds into "compacted N times"');
  assert.ok(/failed\. The conversation is unchanged\.$/.test(DM.compactionText({ phase: 'failed', trigger: 'unknown' })));
  assert.ok(!DM.compactionText({ phase: 'complete', trigger: 'auto', tokensBefore: NaN, tokensAfter: -3 }).includes('NaN'));
  assert.strictEqual(DM.compactionText({ phase: 'start', trigger: '__proto__' }), 'Compacting the context (automatic)…', 'a word that is not in the table reads like auto, as before');
}

// 7. The gauge maths with hostile values: null (unknown) or a whole number 0..100, never anything else
{
  const hostile: unknown[] = [NaN, Infinity, -Infinity, -1, -0, 0, 1e300, Number.MAX_VALUE, '50', null, undefined, {}, [], true, 0.4, 1e-9];
  for (const used of hostile) for (const limit of hostile) {
    const r = ST.ctxLevel(used, limit);
    assert.ok(r.pct === null || (Number.isInteger(r.pct) && r.pct >= 0 && r.pct <= 100), `ctxLevel(${String(used)}, ${String(limit)}) -> ${JSON.stringify(r)}`);
    assert.ok(['unknown', 'ok', 'warn', 'high'].includes(r.level));
    assert.ok((r.pct === null) === (r.level === 'unknown'));
  }
  assert.deepStrictEqual(ST.ctxLevel(50, 100), { pct: 50, level: 'ok' });
  assert.deepStrictEqual(ST.ctxLevel(70, 100), { pct: 70, level: 'warn' }, 'amber from 70');
  assert.deepStrictEqual(ST.ctxLevel(69, 100), { pct: 69, level: 'ok' });
  assert.deepStrictEqual(ST.ctxLevel(90, 100), { pct: 90, level: 'warn' });
  assert.deepStrictEqual(ST.ctxLevel(91, 100), { pct: 91, level: 'high' }, 'red above 90');
  assert.deepStrictEqual(ST.ctxLevel(250, 100), { pct: 100, level: 'high' }, 'more than the window shows 100, not 250');
  assert.deepStrictEqual(ST.ctxLevel('50', 100), { pct: null, level: 'unknown' }, 'a string is not a size');
  assert.deepStrictEqual(ST.ctxLevel(50, '100'), { pct: null, level: 'unknown' });
  assert.deepStrictEqual(ST.ctxLevel(Infinity, 100), { pct: null, level: 'unknown' }, 'an infinite use is not a size');
  assert.deepStrictEqual(ST.ctxLevel(5, Infinity), { pct: null, level: 'unknown' }, 'an infinite window is unknown');
  assert.deepStrictEqual(ST.ctxLevel(Infinity, Infinity), { pct: null, level: 'unknown' });
  assert.deepStrictEqual(ST.ctxLevel(1, 0), { pct: null, level: 'unknown' });
  assert.deepStrictEqual(ST.ctxLevel(-5, 100), { pct: null, level: 'unknown' });
  assert.deepStrictEqual(ST.ctxLevel(NaN, 100), { pct: null, level: 'unknown' });
  for (const n of hostile) assert.ok(/^(\?|\d+(\.\d)?[kM]?)$/.test(ST.fmtTokens(n)), `fmtTokens(${String(n)}) -> ${ST.fmtTokens(n)}`);
  assert.strictEqual(ST.fmtTokens(NaN), '?');
  assert.strictEqual(ST.fmtTokens(-1), '?');
  // after a compaction without a reported size the summary is "waiting", not the old figure
  const s = CB.summary({ tokens: 190000, limit: 200000 }, { waiting: 'compaction' });
  assert.strictEqual(s.known, false);
  assert.strictEqual(s.pct, null);
  assert.ok(/compaction/.test(s.tip) && /compaction/.test(s.name) && !/model change/.test(s.tip + s.name), 'it says why');
  const tr = CB.summary({ tokens: 190000, limit: 200000 }, { waiting: 'truncation' });
  assert.ok(/dropped/.test(tr.tip + tr.name) && !/compact/i.test(tr.tip + tr.name), 'after a truncation the ring says dropped, never compacted');
  assert.ok(/model change/.test(CB.summary({ tokens: 1, limit: 2 }, { waiting: true }).tip), 'a model change still says so');
  assert.strictEqual(CB.summary({ tokens: 190000, limit: 200000 }, {}).pct, 95, 'without waiting the figure shows');
}
console.log('compaction: ok');

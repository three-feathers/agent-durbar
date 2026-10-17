/** Switching model and context tier (spec 030): the pure UI logic and the IPC validation. `npm run test:modelswitch`. No credits spent. */
import * as assert from 'assert';
import * as path from 'path';
import { modelControlFor, parseFocus, parseSwitchRequest, parseTier, MAX_FOCUS, NO_MODEL_CONTROL } from '../src/shared/modelswitch';

type M = { id: string; name?: string; multiplier?: number; contextWindow?: number; longWindow?: number; contextTiers?: string[]; priceClass?: string; efforts?: string[]; pricing?: { inputPerMTok?: number; outputPerMTok?: number; cachedPerMTok?: number; long?: { inputPerMTok?: number; outputPerMTok?: number } } };
type Conf = { needed: boolean; direction: string; reasons: { code: string; text: string }[]; estimate?: number; headroom?: number; compaction: boolean; overCap: boolean };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const D = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'modelswitch.js')) as {
  pricingFromBatch: (p: unknown, b: unknown) => number | undefined;
  priceOf: (m: M | null, t?: string) => { input?: number; output?: number } | null;
  windowOf: (m: M | null, t?: string) => number;
  relativePrice: (a: M, b: M, ta?: string, tb?: string) => { direction: string; input?: number; output?: number; basis: string };
  estimateInputCredits: (t: number, m: M, tier?: string) => number | undefined;
  confirmFor: (a: M, b: M, c?: { tokens?: number; cap?: number; used?: number; tierFrom?: string; tierTo?: string }) => Conf;
  suggestFresh: (s: Record<string, unknown>) => boolean;
  compactionText: (e: Record<string, unknown>) => string;
  modelChangeText: (e: Record<string, unknown>, nameOf?: (x: string) => string) => string;
  fmtCredits: (n: number) => string;
  fmtRatio: (n: number) => string;
  fmtTokens: (n: number) => string;
  priceLine: (m: M, t?: string) => string;
};

const fast: M = { id: 'fast', name: 'Fast', pricing: { inputPerMTok: 20, outputPerMTok: 100 }, contextWindow: 128000 };
const mid: M = { id: 'mid', name: 'Mid', pricing: { inputPerMTok: 80, outputPerMTok: 400 }, contextWindow: 272000 };
const deep: M = { id: 'deep', name: 'Deep', pricing: { inputPerMTok: 250, outputPerMTok: 1250, long: { inputPerMTok: 500, outputPerMTok: 1875 } }, contextWindow: 200000, longWindow: 400000, contextTiers: ['default', 'long'] };
const mystery: M = { id: 'mystery', name: 'Preview', contextWindow: 128000 };
const auto: M = { id: 'auto', name: 'Auto' };

// pricing from the runtime's batch prices; unusable input is "not reported"
assert.strictEqual(D.pricingFromBatch(2500, 1e7), 250);
assert.strictEqual(D.pricingFromBatch(1, 1000), 1000);
for (const bad of [0, -1, NaN, Infinity, '5', null, undefined]) assert.strictEqual(D.pricingFromBatch(bad, 1000), undefined);
assert.strictEqual(D.pricingFromBatch(5, 0), undefined);
assert.strictEqual(D.priceOf(auto), null);
assert.strictEqual(D.priceOf(deep, 'long')?.input, 500);
assert.strictEqual(D.priceOf(fast, 'long'), null, 'a long tier with no long prices is not reported');
assert.strictEqual(D.priceOf({ id: 'x', pricing: { inputPerMTok: 0 } }), null, 'zero is not a price');

// windows
assert.strictEqual(D.windowOf(deep), 200000);
assert.strictEqual(D.windowOf(deep, 'long'), 400000);
assert.strictEqual(D.windowOf(fast, 'long'), 128000, 'no long window reported: the standard one');
assert.strictEqual(D.windowOf(auto), 0);

// relative price
assert.strictEqual(D.relativePrice(fast, deep).direction, 'pricier');
assert.strictEqual(D.relativePrice(fast, deep).input, 12.5);
assert.strictEqual(D.relativePrice(deep, fast).direction, 'cheaper');
assert.strictEqual(D.relativePrice(fast, { ...fast, id: 'f2' }).direction, 'equal');
assert.strictEqual(D.relativePrice(deep, deep, 'default', 'long').direction, 'pricier');
assert.strictEqual(D.relativePrice(fast, { ...mid, pricing: { inputPerMTok: 10, outputPerMTok: 500 } }).direction, 'pricier', 'cheaper input but pricier output is pricier');
assert.strictEqual(D.relativePrice(fast, auto).direction, 'unknown');
assert.strictEqual(D.relativePrice({ id: 'a', priceClass: 'low' }, { id: 'b', priceClass: 'high' }).direction, 'pricier');
assert.strictEqual(D.relativePrice({ id: 'a', priceClass: 'high' }, { id: 'b', priceClass: 'low' }).basis, 'class');
assert.strictEqual(D.relativePrice({ id: 'a', multiplier: 3 }, { id: 'b', multiplier: 0.33 }).direction, 'cheaper');
assert.strictEqual(D.relativePrice({ id: 'a', multiplier: 1 }, { id: 'b', multiplier: 1 }).direction, 'equal');

// estimate
assert.strictEqual(D.estimateInputCredits(200000, deep), 50);
assert.strictEqual(D.estimateInputCredits(200000, deep, 'long'), 100);
assert.strictEqual(D.estimateInputCredits(200000, mystery), undefined);
assert.strictEqual(D.estimateInputCredits(-1, deep), undefined);

// confirmation rules (FR-004/005): cheaper and equal apply directly, the rest asks
{
  const c = D.confirmFor(deep, fast, { tokens: 50000 });
  assert.deepStrictEqual([c.needed, c.direction, c.reasons.length], [false, 'cheaper', 0]);
  assert.strictEqual(D.confirmFor(fast, { ...fast, id: 'f2' }).needed, false, 'equal');
  assert.strictEqual(D.confirmFor(deep, deep, { tierFrom: 'default', tierTo: 'default' }).needed, false, 'effort-only change: nothing to confirm');
  const p = D.confirmFor(fast, deep, { tokens: 10000 });
  assert.deepStrictEqual([p.needed, p.reasons.map((r) => r.code)], [true, ['pricier']]);
  assert.match(p.reasons[0].text, /input 13×, output 13×/);
  const u = D.confirmFor(fast, mystery);
  assert.deepStrictEqual(u.reasons.map((r) => r.code), ['unpriced']);
  assert.match(u.reasons[0].text, /not reported/);
  assert.deepStrictEqual(D.confirmFor(auto, fast).reasons.map((r) => r.code), ['no-baseline'], 'from Auto nothing can be compared');
  const l = D.confirmFor(deep, deep, { tierFrom: 'default', tierTo: 'long', tokens: 1000 });
  assert.deepStrictEqual(l.reasons.map((r) => r.code), ['pricier', 'long-tier']);
  assert.match(l.reasons[1].text, /2× the standard price/);
  assert.strictEqual(D.confirmFor(deep, deep, { tierFrom: 'long', tierTo: 'default' }).needed, false, 'back from long is cheaper');
  // long tier on a model that reports no long prices
  assert.ok(D.confirmFor(fast, fast, { tierTo: 'long' }).reasons.some((r) => r.code === 'unpriced'));
}
// cap headroom: the estimate is compared with what is left; never changes the cap
{
  const c = D.confirmFor(mid, deep, { tokens: 200000, cap: 100, used: 70 });
  assert.strictEqual(c.estimate, 50);
  assert.strictEqual(c.headroom, 30);
  assert.ok(c.overCap && c.reasons.some((r) => r.code === 'over-headroom'));
  assert.match(c.reasons.find((r) => r.code === 'over-headroom')?.text ?? '', /estimate/);
  const ok = D.confirmFor(mid, deep, { tokens: 200000, cap: 100, used: 10 });
  assert.ok(!ok.overCap && ok.headroom === 90);
  assert.strictEqual(D.confirmFor(deep, fast, { tokens: 100000, cap: 30, used: 20 }).needed, false, 'cheaper and within headroom: no dialog');
  assert.strictEqual(D.confirmFor(deep, mid, { tokens: 270000, cap: 30, used: 29.5 }).overCap, true, 'cheaper but the read itself does not fit');
  assert.strictEqual(D.confirmFor(mid, deep, { tokens: 1000, used: 5 }).headroom, undefined, 'no cap: no headroom');
  assert.strictEqual(D.confirmFor(mid, deep, { tokens: 1000, cap: 30, used: 99 }).headroom, 0, 'over the cap already: zero left');
}
// smaller window than the context in use: compaction first
{
  const c = D.confirmFor(deep, fast, { tokens: 150000 });
  assert.ok(c.needed && c.compaction);
  assert.deepStrictEqual(c.reasons.map((r) => r.code), ['smaller-window']);
  assert.ok(!D.confirmFor(deep, fast, { tokens: 100000 }).compaction);
}

// start-fresh hint
const fresh = (o: Record<string, unknown>) => D.suggestFresh({ percent: 95, compactions: 1, idle: true, ...o });
assert.ok(fresh({}));
assert.ok(fresh({ percent: 90 }));
assert.ok(!fresh({ percent: 89 }));
assert.ok(!fresh({ compactions: 0 }), 'not before a compaction had its chance');
assert.ok(fresh({ compactions: 0, lastCompactionFailed: true }));
assert.ok(fresh({ compactions: 0, canCompact: false }), 'an agent that cannot compact is told at once');
assert.ok(!fresh({ idle: false }), 'never in the middle of a turn');
assert.ok(!fresh({ dismissed: true }), 'once dismissed, never again for the session');
assert.ok(!D.suggestFresh({}));

// lines
assert.strictEqual(D.compactionText({ phase: 'start', trigger: 'manual' }), 'Compacting the context (manual)…');
assert.strictEqual(D.compactionText({ phase: 'complete', trigger: 'auto', tokensBefore: 188000, tokensAfter: 52000 }), 'Context compacted (automatic): 188k → 52k tokens.');
assert.strictEqual(D.compactionText({ phase: 'complete', trigger: 'model-switch', tokensRemoved: 9000 }), 'Context compacted (before the model switch): 9k tokens removed.');
assert.match(D.compactionText({ phase: 'failed', trigger: 'manual', error: 'x'.repeat(500) }), /^Compaction failed: x{200}\. The conversation is unchanged\.$/);
assert.strictEqual(D.modelChangeText({ cause: 'user', model: 'deep', tier: 'long' }, (x) => x.toUpperCase()), 'Model set to DEEP (long context). The next message uses it.');
assert.strictEqual(D.modelChangeText({ cause: 'rate-limit', model: 'fast', previousModel: 'deep' }), 'The runtime changed the model from deep to fast because of a rate limit. The next message uses it.');
assert.match(D.modelChangeText({ cause: 'runtime', model: 'x' }), /by the runtime/);

// formatting
assert.deepStrictEqual([D.fmtCredits(0.04), D.fmtCredits(0.5), D.fmtCredits(12.34), D.fmtCredits(250.4), D.fmtCredits(NaN)], ['<0.1', '0.5', '12.3', '250', '?']);
assert.deepStrictEqual([D.fmtRatio(2), D.fmtRatio(2.5), D.fmtRatio(12.5), D.fmtRatio(0)], ['2×', '2.5×', '13×', '?']);
assert.strictEqual(D.fmtTokens(188000), '188k');
assert.strictEqual(D.priceLine(deep), 'in 250 · out 1250 credits per M tokens');
assert.strictEqual(D.priceLine(mystery), 'price not reported');
assert.strictEqual(D.priceLine({ id: 'x', priceClass: 'very-high' }), 'very high price class');
assert.strictEqual(D.priceLine({ id: 'x', multiplier: 3 }), '×3 cost multiplier');

// IPC validation (main process)
const known = [{ id: 'auto' }, { id: 'fast', efforts: [] }, { id: 'deep', efforts: ['low', 'high'], contextTiers: ['default', 'long'] as ('default' | 'long')[] }];
{
  const ok = parseSwitchRequest({ model: 'deep', effort: 'high', contextTier: 'long', confirm: { compaction: 'accept' } }, known);
  assert.deepStrictEqual(ok, { ok: true, request: { model: 'deep', effort: 'high', contextTier: 'long', confirm: { compaction: 'accept' } } });
  assert.deepStrictEqual(parseSwitchRequest({ model: 'fast' }, known), { ok: true, request: { model: 'fast' } });
  assert.deepStrictEqual(parseSwitchRequest({ model: 'deep', effort: null }, known), { ok: true, request: { model: 'deep', effort: null } });
  assert.deepStrictEqual(parseSwitchRequest({ model: 'deep', contextTier: 'default' }, known), { ok: true, request: { model: 'deep', contextTier: 'default' } });
  // extra fields (Copilot's persistence options, anything else) never pass through
  const sneaky = parseSwitchRequest({ model: 'fast', repoScope: 'global', modelChangeScope: 'x', pickerPersistence: true, extra: 1 }, known);
  assert.deepStrictEqual(sneaky, { ok: true, request: { model: 'fast' } });
  const bad: unknown[] = [null, 5, 'deep', {}, { model: 5 }, { model: '' }, { model: 'x'.repeat(101) }, { model: 'nope' }, { model: 'deep', effort: 'turbo' }, { model: 'deep', effort: 5 },
    { model: 'fast', effort: 'high' }, { model: 'fast', contextTier: 'long' }, { model: 'deep', contextTier: 'huge' }, { model: 'deep', confirm: { compaction: 'yes' } }, { model: '__proto__' }];
  for (const b of bad) assert.strictEqual((parseSwitchRequest(b, known) as { ok: boolean }).ok, false, JSON.stringify(b));
  assert.deepStrictEqual(parseSwitchRequest({ model: 'deep', confirm: {} }, known), { ok: true, request: { model: 'deep' } });
}
assert.deepStrictEqual([parseTier('long'), parseTier('default'), parseTier('long_context'), parseTier(1)], ['long', 'default', undefined, undefined]);
assert.strictEqual(parseFocus('  keep the API notes \u0000 please '), 'keep the API notes   please');
assert.strictEqual(parseFocus('x'.repeat(2000))?.length, MAX_FOCUS);
assert.deepStrictEqual([parseFocus(5), parseFocus('   '), parseFocus(undefined)], [undefined, undefined, undefined]);

// capabilities come from the adapter's optional members (no setModel = a new session is the only way)
assert.deepStrictEqual(modelControlFor({}), NO_MODEL_CONTROL);
assert.deepStrictEqual(modelControlFor({ setModel() {}, compact() {} }), { switch: 'next-message', effort: true, contextTier: true, compact: true, windowKnown: true });
assert.deepStrictEqual(modelControlFor({ setModel() {} }, { switch: 'live', contextTier: false }), { switch: 'live', effort: true, contextTier: false, compact: false, windowKnown: true });
assert.strictEqual(modelControlFor({ compact() {} }).switch, 'none');

console.log('modelswitch tests passed');

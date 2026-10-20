/** Switching model and context tier (spec 030): the pure UI logic and the IPC validation. `npm run test:modelswitch`. No credits spent. */
import * as assert from 'assert';
import * as path from 'path';
import { modelControlFor, parseFocus, parseSwitchRequest, parseTier, MAX_FOCUS, NO_MODEL_CONTROL } from '../src/shared/modelswitch';

type M = { id: string; name?: string; multiplier?: number; contextWindow?: number; longWindow?: number; contextTiers?: string[]; priceClass?: string; efforts?: string[]; pricing?: { inputPerMTok?: number; outputPerMTok?: number; cachedPerMTok?: number; unverified?: boolean; long?: { inputPerMTok?: number; outputPerMTok?: number } } };
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
  capsOf: (info: unknown, adapters: unknown) => Record<string, unknown>;
  modesFor: (caps: unknown) => string[];
  fallbackMode: (caps: unknown, cur: string) => string;
  kindChoices: (adapters: unknown) => Array<{ id: string; name: string; shortName: string; state: string; stateText: string; disabled: boolean; label: string; version: string; hint: string }>;
  showsKindPicker: (adapters: unknown) => boolean;
  shows: (caps: unknown, feature: string, mode?: string) => boolean;
  cardMenuActions: (a: unknown, caps: unknown) => { stop: { disabled: boolean; reason: string } | null; end: { confirm: boolean } | null };
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
// spec 030 T044 (real 2026-10-20): on the long tier, a context that still fits the default window is billed at the default price
assert.strictEqual(D.estimateInputCredits(200000, deep, 'long'), 50);
assert.strictEqual(D.estimateInputCredits(300000, deep, 'long'), 150);
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

// prices whose unit was never checked (the real adapter, until spec 030 Phase 3): shown as such, never compared with the cap, ratios still work
{
  const u = (x: M): M => ({ ...x, pricing: { ...x.pricing, unverified: true } });
  const uf = u(fast), um = u(mid);
  assert.match(D.priceLine(uf), /credits per M tokens \(unit not verified\)/);
  assert.doesNotMatch(D.priceLine(fast), /not verified/);
  assert.strictEqual(D.estimateInputCredits(100000, uf), undefined, 'no credit figure from unverified prices');
  assert.strictEqual(D.relativePrice(uf, um).direction, 'pricier', 'a ratio is valid in any common unit');
  const capped = D.confirmFor(um, uf, { tokens: 100000, cap: 50, used: 10 });
  assert.strictEqual(capped.needed, false, 'cheaper with an unverified price needs no confirmation');
  const dearer = D.confirmFor(uf, um, { tokens: 100000, cap: 50, used: 10 });
  assert.ok(dearer.reasons.some((r) => r.code === 'cap-unverified'), 'a costlier switch under a cap says the cap cannot be checked');
  assert.ok(!dearer.reasons.some((r) => r.code === 'over-headroom'));
  assert.ok(!D.confirmFor(uf, um, { tokens: 100000 }).reasons.some((r) => r.code === 'cap-unverified'), 'no cap, nothing to check');
}

// agent kinds and capability gating (spec 012 T017, FR-059..FR-061)
{
  const ALL = ['stop', 'modes', 'cap', 'mcp', 'mcpToggle', 'history', 'models', 'effort'];
  const base = { interrupt: true, resume: true, images: true, models: true, effort: true, permissionModes: ['read-only', 'ask', 'allow'], permModeSwitch: 'live', usage: { tokens: true, costUsd: true, nanoAiu: true }, context: true, caps: true, helpers: true, history: true, mcpStatus: true, mcpToggle: true };
  const none = { ...base, interrupt: false, models: false, effort: false, permissionModes: [], permModeSwitch: 'none', caps: false, history: false, mcpStatus: false, mcpToggle: false };
  const cop = { id: 'copilot', displayName: 'Copilot', state: 'ready', capabilities: base };
  const lim = { id: 'lim', displayName: 'Limited', state: 'ready', capabilities: none };

  // (a) capsOf
  for (const noList of [undefined, null, [], 'x']) {
    const c = D.capsOf({ adapterId: 'copilot' }, noList);
    for (const f of ALL) assert.strictEqual(D.shows(c, f), true, `a: no list, ${f} counts as on`);
    assert.strictEqual(D.shows(c, 'modeList', 'allow'), true, 'a: no list, every mode is listed');
  }
  assert.strictEqual(D.capsOf({ adapterId: 'lim' }, [cop, lim]), none, 'a: a known id gives its capabilities');
  assert.strictEqual(D.capsOf({ adapterId: 'lim' }, [cop, lim]).interrupt, false);
  for (const f of ALL) assert.strictEqual(D.shows(D.capsOf({ adapterId: 'ghost' }, [cop, lim]), f), true, `a: an unknown id is all on (${f})`);
  assert.strictEqual(D.shows(D.capsOf({}, [cop, lim]), 'stop'), true, 'a: an info without an id is all on');
  assert.strictEqual(D.shows(D.capsOf(undefined, [cop, lim]), 'stop'), true, 'a: no info is all on');

  // (b) kindChoices: each of the five states
  const mk = (state: string, extra: Record<string, unknown> = {}) => ({ id: 'k-' + state, displayName: 'Kind', state, capabilities: base, ...extra });
  const want: Record<string, [boolean, string, string]> = { ready: [false, '', 'Kind'], 'not-installed': [true, 'not installed', 'Kind: not installed'], 'too-old': [true, 'too old', 'Kind: too old'], 'not-signed-in': [true, 'not signed in', 'Kind: not signed in'], unknown: [true, 'unknown', 'Kind: unknown'] };
  for (const st of Object.keys(want)) {
    const [k] = D.kindChoices([mk(st)]);
    assert.strictEqual(k.disabled, want[st][0], `b: ${st} disabled`);
    assert.strictEqual(k.stateText, want[st][1], `b: ${st} state text`);
    assert.strictEqual(k.label, want[st][2], `b: ${st} label`);
    assert.strictEqual(k.state, st);
  }
  assert.strictEqual(D.kindChoices([mk('bogus')])[0].disabled, true, 'b: an unrecognised state is disabled and reads unknown');
  assert.strictEqual(D.kindChoices([mk('bogus')])[0].stateText, 'unknown');
  const withHint = D.kindChoices([mk('not-installed', { hint: 'Install it. ' + 'x'.repeat(500), version: '1.2.3' })])[0];
  assert.ok(withHint.hint.startsWith('Install it. ') && withHint.hint.length === 200, 'b: the hint is passed through and capped');
  assert.strictEqual(withHint.version, '1.2.3');
  assert.deepStrictEqual(D.kindChoices(undefined), [], 'b: no list, no choices');
  assert.deepStrictEqual(D.kindChoices([null, { state: 'ready' }, cop]).map((k) => k.id), ['copilot'], 'b: entries without an id are skipped');

  // (c) showsKindPicker
  assert.strictEqual(D.showsKindPicker(undefined), false);
  assert.strictEqual(D.showsKindPicker([]), false);
  assert.strictEqual(D.showsKindPicker([cop]), false, 'c: one adapter, no picker');
  assert.strictEqual(D.showsKindPicker([cop, lim]), true, 'c: two adapters');
  assert.strictEqual(D.showsKindPicker([cop, mk('not-installed')]), false, 'c: FR-136, a harness that is not ready is no choice');
  assert.strictEqual(D.showsKindPicker([mk('not-installed'), mk('ready', { id: 'claude' })]), false, 'c: one ready harness, no picker');

  // (d) shows: each feature on and off
  const pairs: Array<[string, string]> = [['stop', 'interrupt'], ['modes', 'permModeSwitch'], ['cap', 'caps'], ['mcp', 'mcpStatus'], ['history', 'history'], ['models', 'models'], ['effort', 'effort']];
  for (const [f, flag] of pairs) {
    assert.strictEqual(D.shows(base, f), true, `d: ${f} on`);
    assert.strictEqual(D.shows(none, f), false, `d: ${f} off`);
    const only = { ...none, [flag]: flag === 'permModeSwitch' ? 'next-message' : true };
    assert.strictEqual(D.shows(only, f), true, `d: ${f} follows ${flag} alone`);
  }
  assert.strictEqual(D.shows({ ...base, permModeSwitch: 'next-message' }, 'modes'), true, 'd: next-message still switches');
  assert.strictEqual(D.shows({ ...base, permissionModes: ['read-only', 'ask'] }, 'modeList', 'allow'), false, 'd: a mode the adapter cannot enforce is not listed');
  assert.strictEqual(D.shows({ ...base, permissionModes: ['read-only', 'ask'] }, 'modeList', 'ask'), true);
  assert.strictEqual(D.shows({ ...base, permissionModes: [] }, 'modeList', 'read-only'), false);
  assert.strictEqual(D.shows(base, 'mcpToggle'), true);
  assert.strictEqual(D.shows({ ...base, mcpToggle: false }, 'mcpToggle'), false, 'd: toggle needs the flag');
  assert.strictEqual(D.shows({ ...base, mcpStatus: false }, 'mcpToggle'), false, 'd: toggle needs mcpStatus');
  assert.strictEqual(D.shows(undefined, 'cap'), true, 'd: no caps, as today');

  // (e) spec 012 T018: the narrowest kind ("basic") and the mode helpers
  const basic = { ...none, permissionModes: ['read-only'], permModeSwitch: 'none' };
  assert.strictEqual(D.shows(basic, 'mcp'), false, 'e: basic has no MCP button');
  assert.strictEqual(D.shows(basic, 'mcpToggle'), false, 'e: basic has no MCP switches');
  assert.strictEqual(D.shows(basic, 'modeList', 'read-only'), true, 'e: basic lists Read-only');
  assert.strictEqual(D.shows(basic, 'modeList', 'ask'), false, 'e: basic does not list Ask first');
  assert.strictEqual(D.shows(basic, 'modeList', 'allow'), false, 'e: basic does not list Allow all');
  assert.strictEqual(D.shows({ ...basic, mcpToggle: true }, 'mcpToggle'), false, 'e: a toggle flag without mcpStatus shows nothing');
  assert.deepStrictEqual(D.modesFor(base), ['read-only', 'ask', 'allow'], 'e: full list, in order');
  assert.deepStrictEqual(D.modesFor({ ...base, permissionModes: ['allow', 'read-only'] }), ['read-only', 'allow'], 'e: listed in the UI order, not the adapter order');
  assert.deepStrictEqual(D.modesFor(basic), ['read-only']);
  assert.deepStrictEqual(D.modesFor({ ...base, permissionModes: [] }), ['read-only'], 'e: empty list means read-only only');
  assert.deepStrictEqual(D.modesFor({ ...base, permissionModes: undefined }), ['read-only'], 'e: missing list means read-only only');
  assert.deepStrictEqual(D.modesFor({ ...base, permissionModes: ['bogus'] }), ['read-only'], 'e: unknown modes are ignored');
  assert.deepStrictEqual(D.modesFor(undefined), ['read-only'], 'e: no caps object means read-only only (safe by default)');
  assert.strictEqual(D.fallbackMode(base, 'allow'), 'allow', 'e: an allowed mode is kept');
  assert.strictEqual(D.fallbackMode(basic, 'allow'), 'read-only', 'e: allow falls back to read-only, never stays wide');
  assert.strictEqual(D.fallbackMode(basic, 'ask'), 'read-only');
  assert.strictEqual(D.fallbackMode({ ...base, permissionModes: ['read-only', 'ask'] }, 'allow'), 'read-only', 'e: not to the next mode up or down, always read-only');
  assert.strictEqual(D.fallbackMode(basic, 'nonsense'), 'read-only');
  assert.strictEqual(D.fallbackMode(basic, undefined as unknown as string), 'read-only');
  assert.strictEqual(D.kindChoices([mk('ready', { displayName: 'Claude Code (simulated)' })])[0].shortName, 'Claude Code', 'e: the select shows the short name');
  assert.strictEqual(D.kindChoices([mk('ready', { displayName: 'Claude Code (simulated)' })])[0].name, 'Claude Code (simulated)', 'e: the About dialog keeps (simulated)');
  assert.strictEqual(D.kindChoices([cop])[0].shortName, 'Copilot');
}

/* spec 005 FR-017: Stop and End session in the card menu */
{
  const can = { interrupt: true }, cannot = { interrupt: false };
  const ag = (o: Record<string, unknown>) => ({ live: true, state: 'working', label: 'Working', info: {}, ...o });
  const ca = D.cardMenuActions;
  assert.deepStrictEqual(ca(ag({}), can), { stop: { disabled: false, reason: '' }, end: { confirm: true } }, 'f: working main agent gets both, End asks');
  assert.strictEqual(ca(ag({ state: 'thinking' }), can).stop?.disabled, false, 'f: thinking can stop');
  const idle = ca(ag({ state: 'idle', label: 'Ready' }), can);
  assert.strictEqual(idle.stop, null, 'f: an idle agent has no Stop');
  assert.deepStrictEqual(idle.end, { confirm: false }, 'f: idle End does not ask');
  assert.deepStrictEqual(ca(ag({ state: 'waiting' }), can).end, { confirm: true }, 'f: waiting End asks');
  assert.strictEqual(ca(ag({ state: 'waiting' }), can).stop, null, 'f: waiting has no Stop');
  const nc = ca(ag({}), cannot).stop;
  assert.ok(nc && nc.disabled && nc.reason.length > 0, 'f: a kind that cannot interrupt shows Stop disabled with a reason');
  assert.strictEqual(ca(ag({ state: 'idle', label: 'Not started', info: { lazy: true } }), can).end, null, 'f: not started has no End');
  assert.strictEqual(ca(ag({ state: 'idle', label: 'Ended' }), can).end, null, 'f: ended has no End');
  assert.deepStrictEqual(ca(ag({ parent: 'x' }), can), { stop: null, end: null }, 'f: a helper gets nothing');
  assert.deepStrictEqual(ca(ag({ live: false }), can), { stop: null, end: null }, 'f: a non-live agent gets nothing');
  assert.deepStrictEqual(ca(null, can), { stop: null, end: null }, 'f: no agent');
  const calm = ag({ state: 'idle', label: 'Ready' });
  assert.deepStrictEqual(ca(calm, can).end, { confirm: false }, 'f: idle when the menu opened');
  assert.deepStrictEqual(ca({ ...calm, state: 'working' }, can).end, { confirm: true }, 'f: recomputed at click time, it became busy so End asks');
}

console.log('modelswitch tests passed');

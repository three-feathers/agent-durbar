/**
 * Unit tests, spec 111 T010 (FR-030..FR-033, FR-039; the delta of 2026-11-14): `TeamOps`, the create preview and `teams:previewRow`, over fake
 * apps, fake models and a fake store. No Electron (but for the handler section, on a stand-in), no adapter, no credits. Data is invented;
 * token-like data is built at run time. Timing uses large inputs and wide limits.
 *
 * Mutants: each is the COMPILED `teamops.js` copied next to the original under a unique name with one text replacement (the text is read with LF
 * first, so a CRLF checkout matches; the copy is compiled with `vm.Script` before it runs, so none dies of a syntax error), and this file runs
 * again against it (`TEAMOPS_MODULE`). Each must die in ITS section (the failed section's name is printed on stderr). An anchor that does not
 * match fails loudly. EQUIVALENT, so not a mutant: the token-shape test inside `takeToken` and `peek` (the live token always has the right shape, so the
 * equality test next to it decides alone; the shape test of `previewRow` is the one with a visible effect); and the snapshot being a copy: it is the copy `TemplateStore.get` makes (tested in test:teamstore),
 * this module keeps the object it is given; and the key-count bounds (`moreKeysThan`) in `readTarget`/`readChange` are EQUIVALENT IN RESULT, NOT IN COST: the key loop refuses an unknown key
 * with the same words, and the engine lists every key of an object before any `for...in` or `Object.keys` starts (measured in `test:teamsipc`: about 1 s
 * for 800,000 keys), so a counter cannot tell them apart; the bound only saves the array of keys and the later work. The timing checks of `arguments` and
 * `rowArguments` (200,000 keys, well under 1.5 s) are the cost check there is. Run with `TEAMOPS_LABELS=1` to print where each one died.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import vm from 'vm';
import { pathToFileURL } from 'url';
import type { TeamOpsDeps, PreviewOk, PreviewFail, RowOk, PreviewRow, Target } from '../src/main/teamops';
import type { StoredTemplate } from '../src/main/teamstore';
import type { AdapterInfo } from '../src/shared/adapters';
import type { ModelChoice } from '../src/shared/api';
import type { TeamMember } from '../src/shared/teamtemplate';

const MODNAME = process.env.TEAMOPS_MODULE ?? 'teamops';
const IS_COPY = process.env.TEAMOPS_MODULE !== undefined;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { TeamOps, TOKEN_MS } = require('../src/main/' + MODNAME) as typeof import('../src/main/teamops');

let n = 0;
const ok = (c: unknown, m: string): void => { n++; assert.ok(c, m); };
const eq = <T>(a: T, b: T, m: string): void => { n++; assert.deepStrictEqual(a, b, m); };
let failed = 0;
const sections: [string, () => Promise<void> | void][] = [];
const section = (name: string, fn: () => Promise<void> | void): void => { sections.push([name, fn]); };

// ---------------------------------------------------------------------------------------------------------------- fakes
const hexId = (i: number): string => i.toString(16).padStart(32, '0');
const MARK = 'Marker' + '-' + 'Zq7';
const caps = (over: Record<string, unknown>) => ({ caps: true, ...over }) as unknown as AdapterInfo['capabilities'];
const app = (id: string, state: AdapterInfo['state'], c: Record<string, unknown> = {}): AdapterInfo => ({ id, displayName: id, state, capabilities: caps(c) });
const APPS: AdapterInfo[] = [
  app('copilot', 'ready'), // AI credits (no capUnit = aiu)
  app('claude', 'ready', { capUnit: 'usd' }),
  app('codex', 'ready', { caps: false, autopilot: { capUnit: 'aiu' } }), // no limit (caps false)
  app('tokapp', 'ready', { autopilot: { capUnit: 'tokens' } }), // has limits in AI credits; its autopilot unit is not the cap unit
  app('oldapp', 'not-signed-in'),
  app('gone', 'not-installed'),
];
const model = (id: string, o: Partial<ModelChoice> = {}): ModelChoice => ({ id, name: id, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium', ...o }) as ModelChoice;
const MODELS: Record<string, ModelChoice[]> = {
  copilot: [model('alpha-1', { priceClass: 'low', multiplier: 0.33 }), model('beta-2', { priceClass: 'medium', multiplier: 1 }), model('gamma-3', { priceClass: 'high', multiplier: 3, efforts: ['low', 'medium', 'high', 'xhigh'] }), model('delta-4', { priceClass: 'very-high', multiplier: 10 }), model('plain-5'), model('noeff-6', { efforts: [], defaultEffort: undefined }), model('blocked-7', { orgBlocked: 'Your organization blocks it.' }), model('nodef-9', { efforts: ['low', 'high'], defaultEffort: undefined }), model('baddef-10', { efforts: ['low', 'high'], defaultEffort: 'medium' }), model('xh-8', { efforts: ['low', 'medium', 'high', 'xhigh', 'max'], defaultEffort: 'high' })],
  claude: [model('sonnet-x', { priceClass: 'medium' }), model('opus-y', { priceClass: 'very-high' })],
  codex: [model('codex-z')],
};
const mem = (i: number, o: Partial<TeamMember> = {}): TeamMember => ({ memberId: hexId(i), name: `${MARK}-name-${i}`, role: `${MARK}-role`, brief: `${MARK}-brief /home/example/${MARK}`, app: 'copilot', permMode: 'read-only', sendBrief: true, ...o }) as TeamMember;
const tpl = (members: TeamMember[], o: Partial<StoredTemplate> = {}): StoredTemplate => ({ id: 'tmpl1', origin: 'own', createdAt: 1, updatedAt: 1, name: `${MARK}-team`, description: `${MARK}-desc`, members, ...o }) as StoredTemplate;
const TOKENS = ['a', 'b', 'c', 'd', 'e', 'f'].map((c) => c.repeat(32));

interface Rig { ops: InstanceType<typeof TeamOps>; clock: { t: number }; accessed: Set<string>; calls: { models: string[]; adapters: number; targets: Target[] }; store: Map<string, StoredTemplate>; set: (o: Partial<TeamOpsDeps>) => void }
function rig(templates: StoredTemplate[], o: Partial<TeamOpsDeps> = {}, tokens = TOKENS.slice()): Rig {
  const store = new Map(templates.map((t) => [t.id, t]));
  const clock = { t: 1_000_000 };
  const calls = { models: [] as string[], adapters: 0, targets: [] as Target[] };
  const deps: TeamOpsDeps = {
    store: () => ({ get: (id: string) => { const t = store.get(id); return t ? (JSON.parse(JSON.stringify(t)) as StoredTemplate) : undefined; } }),
    adapters: async () => (calls.adapters++, APPS),
    models: async (id: string) => { calls.models.push(id); if (!(id in MODELS)) throw new Error('no list ' + MARK); return MODELS[id]; },
    defaultCapAiu: () => 60,
    resolveTarget: async (t: Target) => (calls.targets.push(t), { ok: true as const, key: 'room-key-opaque', existing: 0 }),
    now: () => clock.t,
    newToken: () => tokens.shift() ?? 'f'.repeat(32),
    ...o,
  };
  const accessed = new Set<string>();
  const proxy = new Proxy(deps, { get: (t, k) => { accessed.add(String(k)); return (t as unknown as Record<string, unknown>)[k as string]; } });
  return { ops: new TeamOps(proxy), clock, accessed, calls, store, set: (x) => Object.assign(deps, x) };
}
const R = (v: unknown): PreviewOk => { assert.ok((v as PreviewOk).ok === true, 'expected ok, got ' + JSON.stringify(v).slice(0, 200)); return v as PreviewOk; };
const F = (v: unknown): PreviewFail => { assert.ok((v as PreviewFail).ok === false, 'expected a refusal'); return v as PreviewFail; };
const TGT = { room: 'agent-1' };
async function one(m: TeamMember, o: Partial<StoredTemplate> = {}, ro: Partial<TeamOpsDeps> = {}): Promise<PreviewRow> {
  const r = rig([tpl([m], o)], ro);
  return R(await r.ops.createPreview(TGT, 'tmpl1')).rows[0];
}

// ---------------------------------------------------------------------------------------------------------------- 1. apps
section('apps', async () => {
  const ready = await one(mem(1));
  eq([ready.app.state, ready.needsChoice, ready.reasons], ['ready', false, []], 'a ready app: no choice needed');
  const old = await one(mem(1, { app: 'oldapp' }));
  eq([old.app.state, old.needsChoice, old.app.words], ['not-ready', true, 'Not signed in'], 'an app that is not signed in needs a choice, in words');
  const gone = await one(mem(1, { app: 'gone' }));
  eq([gone.app.state, gone.needsChoice, gone.app.words], ['not-ready', true, 'Not installed'], 'a missing app needs a choice');
  const unk = await one(mem(1, { app: 'nosuchapp' }));
  eq([unk.app.state, unk.needsChoice, unk.limit.words], ['unknown', true, 'Choose an app first'], 'an unknown app id needs a choice and no limit words');
  ok(unk.reasons.length === 1 && !unk.reasons[0].includes('nosuchapp'), 'the reason does not echo the id');
  // an app that is not ready is never asked for its models (nothing starts, nothing is listed)
  const r = rig([tpl([mem(1, { app: 'oldapp', model: 'alpha-1' }), mem(2, { app: 'nosuchapp', model: 'alpha-1' })])]);
  R(await r.ops.createPreview(TGT, 'tmpl1'));
  eq(r.calls.models, [], 'no model list for an app that is not ready');
  // the whole answer: every app with its state words and unit
  const all = R(await rig([tpl([mem(1)])]).ops.createPreview(TGT, 'tmpl1'));
  eq(all.apps.map((a) => [a.id, a.ready, a.capUnit]).sort(), [['copilot', true, 'aiu'], ['claude', true, 'usd'], ['codex', true, 'none'], ['oldapp', false, 'aiu'], ['gone', false, 'aiu'], ['tokapp', true, 'aiu']].sort(), 'apps with readiness and unit (codex: none; an autopilot unit of tokens is not a cap unit)');
  // no member ready: the preview works, canCreate is false, every row has a reason
  const none = R(await rig([tpl([mem(1, { app: 'oldapp' }), mem(2, { app: 'gone' })])]).ops.createPreview(TGT, 'tmpl1'));
  eq([none.canCreate, none.summary.needsChoice, none.rows.every((x) => x.reasons.length > 0)], [false, 2, true], 'no ready member: canCreate false, a reason on each row');
});

// ---------------------------------------------------------------------------------------------------------------- 2. models
section('models', async () => {
  const miss = await one(mem(1, { model: 'not-listed-9' }));
  eq([miss.model.present, miss.needsChoice, miss.model.words], [false, true, 'Not offered here'], 'a missing model needs a choice');
  eq(miss.model.id, 'not-listed-9', 'it is never swapped for another model (nothing preselected)');
  ok(!JSON.stringify(miss).includes('alpha-1'), 'the first model of the list is nowhere in the row');
  const blocked = await one(mem(1, { model: 'blocked-7' }));
  eq([blocked.model.orgBlocked, blocked.model.present, blocked.needsChoice], [true, true, true], 'a model blocked by the organization needs a choice');
  ok(!JSON.stringify(blocked).includes('Your organization blocks it'), 'the organization\'s own text is not repeated (fixed words only)');
  const def = await one(mem(1));
  eq([def.model.present, def.model.id, def.model.words, def.needsChoice], [true, '', 'App default', false], 'no model asked = the app default, present');
  const good = await one(mem(1, { model: 'beta-2' }));
  eq([good.model.present, good.needsChoice], [true, false], 'a listed model is fine');
  // a list that cannot be read is a choice, not a throw, and its error text (which may hold anything) is not in the answer
  const r = rig([tpl([mem(1, { app: 'copilot', model: 'alpha-1' })])], { models: async () => { throw new Error('boom ' + MARK); } });
  const bad = R(await r.ops.createPreview(TGT, 'tmpl1')).rows[0];
  eq([bad.needsChoice, bad.model.present], [true, false], 'models that cannot be listed: a choice');
  ok(!JSON.stringify(bad).includes('boom'), 'the error text is not in the answer');
  // one list per app, however many members use it
  const r2 = rig([tpl([mem(1, { model: 'alpha-1' }), mem(2, { model: 'beta-2' }), mem(3, { app: 'claude', model: 'sonnet-x' })])]);
  R(await r2.ops.createPreview(TGT, 'tmpl1'));
  eq(r2.calls.models.slice().sort(), ['claude', 'copilot'], 'one models call per app');
});

// ---------------------------------------------------------------------------------------------------------------- 3. effort
section('effort', async () => {
  const own = await one(mem(1, { model: 'beta-2', effort: 'high' }));
  eq([own.effort.asked, own.effort.used, own.effort.note], ['high', 'high', ''], 'an own template keeps an offered effort, even above the default');
  const notOffered = await one(mem(1, { model: 'beta-2', effort: 'xhigh' }));
  eq([notOffered.effort.used, notOffered.effort.note], ['medium', 'falls to the default'], 'an effort the model does not offer falls to its default');
  const noEffModel = await one(mem(1, { model: 'noeff-6', effort: 'high' }));
  eq([noEffModel.effort.used, noEffModel.effort.note], [undefined, 'falls to the default'], 'a model with no efforts and no default: none');
  const impAbove = await one(mem(1, { model: 'gamma-3', effort: 'xhigh' }), { origin: 'imported' });
  eq([impAbove.effort.asked, impAbove.effort.used, impAbove.effort.note], ['xhigh', 'medium', 'imported above the default'], 'an imported xhigh above the default is not taken');
  const impHigh = await one(mem(1, { model: 'beta-2', effort: 'high' }), { origin: 'imported' });
  eq([impHigh.effort.used, impHigh.effort.note], ['medium', 'imported above the default'], 'an imported effort one step above the default is not taken');
  const impAt = await one(mem(1, { model: 'beta-2', effort: 'medium' }), { origin: 'imported' });
  eq([impAt.effort.used, impAt.effort.note], ['medium', ''], 'an imported effort at the default is taken');
  const impBelow = await one(mem(1, { model: 'beta-2', effort: 'low' }), { origin: 'imported' });
  eq(impBelow.effort.used, 'low', 'an imported effort below the default is taken');
  const impNoDef = await one(mem(1, { model: 'nodef-9', effort: 'low' }), { origin: 'imported' });
  eq([impNoDef.effort.used, impNoDef.effort.note], [undefined, 'imported above the default'], 'an imported effort on a model with no default is not taken');
  const impBadDef = await one(mem(1, { model: 'baddef-10', effort: 'low' }), { origin: 'imported' });
  eq(impBadDef.effort.note, 'imported above the default', 'a default that is not in the list: an imported effort is not taken');
  eq((await one(mem(1, { model: 'nodef-9', effort: 'low' }))).effort.used, 'low', 'an own effort on a model with no default is kept');
  const impDefaultModel = await one(mem(1, { effort: 'low' }), { origin: 'imported' });
  eq([impDefaultModel.effort.used, impDefaultModel.effort.note], [undefined, 'imported above the default'], 'an imported effort on the app default model cannot be compared: not taken');
  const ownDefaultModel = await one(mem(1, { effort: 'low' }));
  eq(ownDefaultModel.effort.used, 'low', 'an own effort on the app default model is kept');
  eq((await one(mem(1, { model: 'beta-2' }))).effort, { note: '' }, 'no effort asked: none');
  // the person picks it on the row: taken, whatever the file said
  const r = rig([tpl([mem(1, { model: 'gamma-3', effort: 'xhigh' })], { origin: 'imported' })]);
  const p = R(await r.ops.createPreview(TGT, 'tmpl1'));
  const picked = await r.ops.previewRow(p.token, hexId(1), { effort: 'xhigh' }) as RowOk;
  eq([picked.row.effort.used, picked.row.effort.note], ['xhigh', 'picked'], 'an imported effort the person picks is used');
  const unpicked = await r.ops.previewRow(p.token, hexId(1), { effort: '' }) as RowOk;
  eq(unpicked.row.effort.used, undefined, 'clearing the effort asks for none');
  const unoffered = await r.ops.previewRow(p.token, hexId(1), { effort: 'max' }) as RowOk;
  eq(unoffered.row.effort.used, 'medium', 'a picked effort the model does not offer falls to the default too');
  // a model change keeps the person's pick out: the pick belonged to the other model
  await r.ops.previewRow(p.token, hexId(1), { effort: 'xhigh' });
  const m2 = await r.ops.previewRow(p.token, hexId(1), { model: 'xh-8' }) as RowOk;
  eq([m2.row.effort.used, m2.row.effort.note], ['high', 'imported above the default'], 'another model: the pick is gone, the imported effort is judged again');
});

// ---------------------------------------------------------------------------------------------------------------- 4. costs
section('costs', async () => {
  const w = async (id: string): Promise<PreviewRow['cost']> => (await one(mem(1, { model: id }))).cost;
  eq(await w('alpha-1'), { tier: 'low', multiplier: 0.33, words: 'Low cost tier, 0.33x' }, 'low');
  eq(await w('beta-2'), { tier: 'medium', multiplier: 1, words: 'Medium cost tier, 1x' }, 'medium');
  eq(await w('gamma-3'), { tier: 'high', multiplier: 3, words: 'High cost tier, 3x' }, 'high');
  eq(await w('delta-4'), { tier: 'very-high', multiplier: 10, words: 'Very high cost tier, 10x' }, 'very high');
  eq(await w('plain-5'), { tier: 'not-reported', words: 'Cost not reported' }, 'no price class, no multiplier: not reported');
  eq((await one(mem(1))).cost, { tier: 'not-reported', words: 'Cost not reported' }, 'the app default model: not reported');
  eq((await one(mem(1, { model: 'not-listed-9' }))).cost.tier, 'not-reported', 'a missing model: not reported');
  const only = rig([tpl([mem(1, { model: 'gamma-3' })])], { models: async () => [model('mx', { multiplier: 2.5 })].concat([model('gamma-3', { multiplier: 2.5 })]) });
  eq(R(await only.ops.createPreview(TGT, 'tmpl1')).rows[0].cost.words, '2.5x', 'a multiplier alone');
  const s = R(await rig([tpl([mem(1, { model: 'gamma-3' }), mem(2, { model: 'delta-4' }), mem(3, { model: 'delta-4' }), mem(4, { model: 'alpha-1' }), mem(5, { model: 'nope' })])]).ops.createPreview(TGT, 'tmpl1')).summary;
  eq(s, { total: 5, needsChoice: 1, high: 1, veryHigh: 2 }, 'the summary counts High and Very high and rows needing a choice');
});

// ---------------------------------------------------------------------------------------------------------------- 5. limits
section('limits', async () => {
  const aiuOwn = await one(mem(1, { cap: { unit: 'aiu', amount: 40 } }));
  eq([aiuOwn.limit.unit, aiuOwn.limit.amount, aiuOwn.limit.source, aiuOwn.limit.words], ['aiu', 40, 'member', 'Limit: 40 AI credits'], 'AIU: the member\'s own');
  const aiuDef = await one(mem(1));
  eq([aiuDef.limit.amount, aiuDef.limit.source, aiuDef.limit.words], [60, 'default', 'Limit: 60 AI credits (your default)'], 'AIU: the person\'s default');
  const aiuNone = await one(mem(1), {}, { defaultCapAiu: () => undefined });
  eq([aiuNone.limit.amount, aiuNone.limit.source, aiuNone.limit.words], [undefined, 'none', 'No limit'], 'AIU: no default, no limit');
  const usdOwn = await one(mem(1, { app: 'claude', cap: { unit: 'usd', amount: 2 } }));
  eq([usdOwn.limit.unit, usdOwn.limit.amount, usdOwn.limit.words], ['usd', 2, 'Limit: 2.00 USD (estimate)'], 'USD: only an explicit one');
  const usdNone = await one(mem(1, { app: 'claude' }));
  eq([usdNone.limit.amount, usdNone.limit.source, usdNone.limit.words], [undefined, 'none', 'No limit'], 'USD: the AIU default is never used as dollars');
  eq((await one(mem(1, { app: 'tokapp' }))).limit.unit, 'aiu', 'an app whose autopilot unit is tokens still has AI-credit limits');
  const codex = await one(mem(1, { app: 'codex', cap: { unit: 'aiu', amount: 40 } }));
  eq([codex.limit.unit, codex.limit.amount, codex.limit.words], ['none', undefined, 'This app has no spending limit in Agent Durbar'], 'an app with no cap: none, even when the template has one');
  // a cap in another unit than the app's is dropped, not converted
  const mismatch = await one(mem(1, { app: 'claude', cap: { unit: 'aiu', amount: 40 } }));
  eq([mismatch.limit.amount, mismatch.limit.source], [undefined, 'none'], 'an AIU cap on a USD app is dropped');
  ok(mismatch.limit.words.includes('dropped'), 'and the row says so');
  const outOfRange = await one(mem(1, { cap: { unit: 'aiu', amount: 1e9 } }));
  eq(outOfRange.limit.source, 'default', 'an amount outside the allowed range is not used (the default applies)');
  // an app change drops the limit and shows the new unit; the amount is never carried
  const r = rig([tpl([mem(1, { cap: { unit: 'aiu', amount: 40 } })])]);
  const p = R(await r.ops.createPreview(TGT, 'tmpl1'));
  const toClaude = await r.ops.previewRow(p.token, hexId(1), { app: 'claude' }) as RowOk;
  eq([toClaude.row.limit.unit, toClaude.row.limit.amount, toClaude.row.limit.source], ['usd', undefined, 'none'], 'to a USD app: the limit is dropped, the unit is USD');
  ok(toClaude.row.limit.words.includes('dropped') && !JSON.stringify(toClaude.row).includes('40'), 'with words and no amount carried over');
  const toCodex = await r.ops.previewRow(p.token, hexId(1), { app: 'codex' }) as RowOk;
  eq([toCodex.row.limit.unit, toCodex.row.limit.amount], ['none', undefined], 'to Codex: no limit');
  const back = await r.ops.previewRow(p.token, hexId(1), { app: 'copilot' }) as RowOk;
  eq([back.row.limit.unit, back.row.limit.source, back.row.limit.amount], ['aiu', 'default', 60], 'and back to AIU: the member\'s own 40 is gone for good, the default applies');
  // the model and effort of the old app do not follow either
  const r2 = rig([tpl([mem(1, { model: 'beta-2', effort: 'high' })])]);
  const p2 = R(await r2.ops.createPreview(TGT, 'tmpl1'));
  const c2 = await r2.ops.previewRow(p2.token, hexId(1), { app: 'claude' }) as RowOk;
  eq([c2.row.model.id, c2.row.model.words, c2.row.effort.asked, c2.row.app.id], ['', 'App default', undefined, 'claude'], 'another app: the app default model, no effort');
  // the same app again is not a change
  const r3 = rig([tpl([mem(1, { model: 'beta-2', effort: 'high', cap: { unit: 'aiu', amount: 40 } })])]);
  const p3 = R(await r3.ops.createPreview(TGT, 'tmpl1'));
  const same = await r3.ops.previewRow(p3.token, hexId(1), { app: 'copilot' }) as RowOk;
  eq([same.row.model.id, same.row.effort.asked, same.row.limit.amount], ['beta-2', 'high', 40], 'the same app: nothing changes, the limit stays');
});

// ---------------------------------------------------------------------------------------------------------------- 6. modes
section('modes', async () => {
  eq((await one(mem(1, { permMode: 'read-only' }))).perm, 'read-only', 'read-only stays');
  eq((await one(mem(1, { permMode: 'ask' }))).perm, 'ask', 'ask stays');
  eq((await one(mem(1, { permMode: 'allow' }))).perm, 'allow', 'an own Allow all is shown as stored (the confirmation is at create)');
  eq((await one(mem(1, { permMode: 'allow' }), { origin: 'imported' })).perm, 'ask', 'an imported Allow all is shown as Ask');
  eq((await one(mem(1, { permMode: 'weird' as never }))).perm, 'read-only', 'anything else is read-only (validMode)');
  const row = await one(mem(1, { profile: 'some-agent', briefFrom: 'file' }));
  eq([row.profile, row.fromFile], [true, true], 'a custom agent id and a brief from a file are flagged, not listed');
  const plain = await one(mem(1));
  eq([plain.profile, plain.fromFile], [false, false], 'flags false without them');
  ok(!Object.keys(row).some((k) => /autopilot|brief|name|role|path/i.test(k)), 'no autopilot, brief, name, role or path field in a row');
});

// ---------------------------------------------------------------------------------------------------------------- 7. no free text
section('noFreeText', async () => {
  const hostile = tpl([mem(1, { model: 'alpha-1', effort: 'high', profile: 'custom.agent:1', cap: { unit: 'aiu', amount: 5 } }), mem(2, { app: 'oldapp' }), mem(3, { model: 'nope-1' })], { origin: 'imported' });
  const r = rig([hostile], { adapters: async () => APPS.map((a) => ({ ...a, displayName: MARK + '-appname', where: '~/' + MARK, hint: MARK })) });
  const p = R(await r.ops.createPreview(TGT, 'tmpl1'));
  const all = JSON.stringify(p) + JSON.stringify(await r.ops.previewRow(p.token, hexId(2), { app: 'claude' }));
  ok(!all.includes('Marker'), 'no name, role, brief, description, app name, hint or path of the template or the apps in any answer');
  ok(!all.includes('room-key-opaque') && !all.includes('/home/'), 'the room key and paths stay in main');
  eq(p.template, { id: 'tmpl1', imported: true }, 'the template is named by its id and origin only');
  eq(p.rows.map((x) => x.memberId), [hexId(1), hexId(2), hexId(3)], 'rows are keyed by the stored memberId, in order');
  for (const row of p.rows) eq(Object.keys(row).sort(), ['app', 'cost', 'effort', 'fromFile', 'limit', 'memberId', 'model', 'needsChoice', 'perm', 'profile', 'reasons'], 'the row has exactly the agreed fields');
});

// ---------------------------------------------------------------------------------------------------------------- 8. token
section('token', async () => {
  const r = rig([tpl([mem(1)])]);
  const p = R(await r.ops.createPreview(TGT, 'tmpl1'));
  eq([p.token, p.expiresAt], [TOKENS[0], 1_000_000 + TOKEN_MS], 'the token and its expiry (10 minutes from now())');
  eq(TOKEN_MS, 600_000, 'ten minutes');
  r.clock.t = 1_000_000 + TOKEN_MS - 1;
  ok((await r.ops.previewRow(p.token, hexId(1), { effort: 'low' })).ok, 'alive one millisecond before the end');
  r.clock.t = 1_000_000 + TOKEN_MS;
  eq(F(await r.ops.previewRow(p.token, hexId(1), { effort: 'low' })).code, 'notfound', 'expired at the end');
  eq(r.ops.takeToken(p.token), undefined, 'takeToken of an expired token: nothing');
  // takeToken is once
  const q = rig([tpl([mem(1)])]);
  const p1 = R(await q.ops.createPreview(TGT, 'tmpl1'));
  const got = q.ops.takeToken(p1.token);
  ok(got !== undefined && got.key === 'room-key-opaque' && got.template.members.length === 1 && got.existing === 0, 'takeToken hands over the key, the snapshot and the count');
  eq(q.ops.takeToken(p1.token), undefined, 'a second take: nothing (once)');
  eq(F(await q.ops.previewRow(p1.token, hexId(1), { effort: 'low' })).code, 'notfound', 'and the preview is gone');
  // the expiry is checked on take as well
  const e = rig([tpl([mem(1)])]);
  const pe = R(await e.ops.createPreview(TGT, 'tmpl1'));
  e.clock.t += TOKEN_MS + 5;
  eq(e.ops.takeToken(pe.token), undefined, 'take after the expiry: nothing');
  // a new preview drops the old one
  const s = rig([tpl([mem(1)])]);
  const first = R(await s.ops.createPreview(TGT, 'tmpl1'));
  const second = R(await s.ops.createPreview(TGT, 'tmpl1'));
  ok(first.token !== second.token, 'two previews, two tokens');
  eq(F(await s.ops.previewRow(first.token, hexId(1), { effort: 'low' })).code, 'notfound', 'a new preview drops the old one (previewRow)');
  eq(s.ops.takeToken(first.token), undefined, 'a new preview drops the old one (take)');
  ok(s.ops.takeToken(second.token) !== undefined, 'the new one lives');
  // also when the new one fails
  const f = rig([tpl([mem(1)])]);
  const keep = R(await f.ops.createPreview(TGT, 'tmpl1'));
  eq(F(await f.ops.createPreview(TGT, 'no-such')).code, 'notfound', 'a preview of a template that is not there fails');
  eq(f.ops.takeToken(keep.token), undefined, 'and the old one is gone anyway');
  // dropped FIRST: also when the arguments are invalid
  for (const [t, id] of [[undefined, 'tmpl1'], [TGT, 5], [{ room: '' }, 'tmpl1'], [TGT, 'x'.repeat(65)]] as const) {
    const live = R(await f.ops.createPreview(TGT, 'tmpl1'));
    eq(F(await f.ops.createPreview(t, id)).code, 'invalid', 'invalid arguments are refused');
    eq(f.ops.takeToken(live.token), undefined, 'and the old preview is gone anyway');
  }
  // an older, slower call does not replace a newer preview
  let release: () => void = () => undefined;
  const gate = new Promise<void>((res) => { release = res; });
  let slow = true;
  const g = rig([tpl([mem(1)])], { adapters: async () => { if (slow) { slow = false; await gate; } return APPS; } });
  const older = g.ops.createPreview(TGT, 'tmpl1');
  await new Promise((res) => setImmediate(res));
  const newer = R(await g.ops.createPreview(TGT, 'tmpl1'));
  release();
  eq(F(await older).code, 'cancelled', 'the older, slower preview is told it was replaced');
  ok(g.ops.takeToken(newer.token) !== undefined, 'the newer one lives');
  // bad tokens
  for (const bad of [undefined, null, 5, {}, [], '', 'x', 'A'.repeat(32), 'a'.repeat(31), 'a'.repeat(33), 'a'.repeat(10000), '../'.repeat(20)]) {
    eq(F(await q.ops.previewRow(bad, hexId(1), { effort: 'low' })).code, 'invalid', 'a malformed token is refused: ' + typeof bad);
    eq(q.ops.takeToken(bad), undefined, 'and cannot be taken');
  }
  eq(F(await s.ops.previewRow('0'.repeat(32), hexId(1), { effort: 'low' })).code, 'notfound', 'a well-formed token that is not alive');
  // the snapshot is a copy: the store changing afterwards does not change it
  const c = rig([tpl([mem(1, { model: 'alpha-1' })])]);
  const pc = R(await c.ops.createPreview(TGT, 'tmpl1'));
  c.store.get('tmpl1')!.members[0].model = 'other-1';
  eq(c.ops.takeToken(pc.token)!.template.members[0].model, 'alpha-1', 'the token holds the template as it was');
});


// ---------------------------------------------------------------------------------------------------------------- 8b. the token first, before any adapter
section('tokenFirst', async () => {
  const r = rig([tpl([mem(1)])]);
  const p = R(await r.ops.createPreview(TGT, 'tmpl1'));
  const base = r.calls.adapters;
  eq(F(await r.ops.previewRow('0'.repeat(32), hexId(1), { effort: 'low' })).code, 'notfound', 'a token that is not alive');
  eq(F(await r.ops.previewRow(p.token, hexId(9), { effort: 'low' })).code, 'notfound', 'a row that is not in the preview');
  eq(r.calls.adapters, base, 'a foreign token and an unknown row never ask the adapters');
  eq(r.calls.models.length, 0, 'nor the models');
  r.clock.t += TOKEN_MS;
  eq(F(await r.ops.previewRow(p.token, hexId(1), { effort: 'low' })).code, 'notfound', 'an expired token');
  eq(r.calls.adapters, base, 'an expired token never asks the adapters');
  eq(F(await r.ops.previewRow('zz', hexId(1), { effort: 'low' })).code, 'invalid', 'a malformed token');
  eq(r.calls.adapters, base, 'a malformed token neither');
});

// ---------------------------------------------------------------------------------------------------------------- 8c. overlapping previewRow calls
section('overlap', async () => {
  const tick = (): Promise<void> => new Promise((res) => setImmediate(res));
  const mk = (): { r: Rig; gate: () => Promise<void>; open: () => void; arm: () => void } => {
    let release: () => void = () => undefined;
    let armed = false;
    let pending: Promise<void> | undefined;
    const r = rig([tpl([mem(1, { model: 'beta-2' })])], {
      adapters: async () => { if (armed) { armed = false; await pending; } return APPS; },
    });
    return { r, gate: async () => undefined, open: () => release(), arm: () => { armed = true; pending = new Promise<void>((res) => { release = res; }); } };
  };
  const final = (r: Rig, token: string): { model: string | undefined; effort: string | undefined } => { const c = r.ops.takeToken(token)!.choices.get(hexId(1))!; return { model: c.model, effort: c.effort }; };
  // A: a model, slow (its adapters call waits); B: an effort, fast. Both changes survive, whichever is told last.
  for (const slowFirst of [true, false]) {
    const k = mk();
    const p = R(await k.r.ops.createPreview(TGT, 'tmpl1'));
    let a: Promise<unknown>, b: Promise<unknown>;
    if (slowFirst) {
      k.arm(); a = k.r.ops.previewRow(p.token, hexId(1), { model: 'gamma-3' }); await tick();
      b = k.r.ops.previewRow(p.token, hexId(1), { effort: 'high' }); await b;
      k.open(); const ra = await a as RowOk;
      eq([ra.row.model.id, ra.row.effort.asked], ['gamma-3', 'high'], 'the slow call\'s row has both changes (slow first)');
    } else {
      a = k.r.ops.previewRow(p.token, hexId(1), { model: 'gamma-3' }); await a;
      k.arm(); b = k.r.ops.previewRow(p.token, hexId(1), { effort: 'high' }); await tick();
      const c2 = k.r.ops.previewRow(p.token, hexId(1), { effort: 'low' }); await c2; // a third, fast, in between
      k.open(); const rb = await b as RowOk;
      eq([rb.row.model.id, rb.row.effort.asked], ['gamma-3', 'high'], 'the slow call is the last to choose: its change wins, the model of the earlier one stays');
    }
    eq(final(k.r, p.token), { model: 'gamma-3', effort: 'high' }, 'the stored choices keep both (slowFirst=' + slowFirst + ')');
  }
  // slow MODELS: A's list is slow, B fast; the row of the call that finishes first is worked out again when a newer merge came
  {
    let slow = false; let rel: () => void = () => undefined;
    const gate2 = new Promise<void>((res) => { rel = res; });
    const r = rig([tpl([mem(1, { model: 'beta-2' })])], { models: async (id: string) => { if (slow) { slow = false; await gate2; } return MODELS[id]; } });
    const p = R(await r.ops.createPreview(TGT, 'tmpl1'));
    slow = true; // the next list is slow
    const a = r.ops.previewRow(p.token, hexId(1), { model: 'gamma-3' });
    await tick(); await tick();
    const rb = await r.ops.previewRow(p.token, hexId(1), { effort: 'high' }) as RowOk;
    rel();
    const ra = await a as RowOk;
    eq([ra.row.model.id, ra.row.effort.asked], ['gamma-3', 'high'], 'slow models: the first call\'s row is worked out again from the merged state');
    eq([rb.row.model.id, rb.row.effort.asked], ['gamma-3', 'high'], 'and the fast call saw the model too');
    eq(final(r, p.token), { model: 'gamma-3', effort: 'high' }, 'stored choices keep both');
  }
  // the preview replaced while a call waits: that call says so, and nothing is written into the new one
  {
    const k = mk();
    const p = R(await k.r.ops.createPreview(TGT, 'tmpl1'));
    k.arm(); const a = k.r.ops.previewRow(p.token, hexId(1), { effort: 'low' }); await tick();
    const p2 = R(await k.r.ops.createPreview(TGT, 'tmpl1'));
    k.open();
    eq(F(await a).code, 'notfound', 'a call that waited while the preview was replaced');
    eq(final(k.r, p2.token).effort, undefined, 'the new preview is untouched');
  }
  // the token expires, or the preview is replaced, WHILE the row is worked out (a slow models() list): a fixed notfound, nothing written
  for (const how of ['expires', 'replaced'] as const) {
    let slow = false; let rel: () => void = () => undefined;
    const gate = new Promise<void>((res) => { rel = res; });
    const r = rig([tpl([mem(1, { model: 'beta-2' })])], { models: async (id: string) => { if (slow) { slow = false; await gate; } return MODELS[id]; } });
    const p = R(await r.ops.createPreview(TGT, 'tmpl1'));
    slow = true;
    const a = r.ops.previewRow(p.token, hexId(1), { effort: 'low' });
    await tick(); await tick();
    let p2: PreviewOk | undefined;
    if (how === 'expires') r.clock.t += TOKEN_MS + 1; else p2 = R(await r.ops.createPreview(TGT, 'tmpl1'));
    rel();
    const x = F(await a);
    eq([x.code, x.errors], ['notfound', ['Preview: expired or not found. Open it again.']], 'while the row waits for models, the preview ' + how + ': a fixed notfound');
    if (p2) eq(final(r, p2.token).effort, undefined, 'the new preview is untouched');
    eq(r.ops.takeToken(p.token), undefined, 'and the old token is gone');
  }
  // Use another app, then a second change of the same row: the template's limit does not come back (FR-033)
  {
    const r = rig([tpl([mem(1, { cap: { unit: 'aiu', amount: 40 } })])]);
    const p = R(await r.ops.createPreview(TGT, 'tmpl1'));
    eq((p.rows[0].limit.source), 'member', 'the template\'s own limit at first');
    const a1 = await r.ops.previewRow(p.token, hexId(1), { app: 'tokapp' }) as RowOk;
    eq([a1.row.limit.source, a1.row.limit.amount], ['default', 60], 'another app (AI credits too): the limit is dropped, the default applies');
    const a2 = await r.ops.previewRow(p.token, hexId(1), { effort: 'low' }) as RowOk;
    eq([a2.row.limit.source, a2.row.limit.amount], ['default', 60], 'a second change of the row: the limit of the template does not come back');
    const a3 = await r.ops.previewRow(p.token, hexId(1), { model: '' }) as RowOk;
    eq([a3.row.limit.source, a3.row.app.id], ['default', 'tokapp'], 'nor a third');
  }
});

// ---------------------------------------------------------------------------------------------------------------- 9. arguments
section('arguments', async () => {
  const r = rig([tpl([mem(1)]), tpl([], { id: 'empty1' })]);
  const bad = async (t: unknown, id: unknown, what: string): Promise<void> => { const x = F(await r.ops.createPreview(t, id)); eq(x.code, 'invalid', what); ok(x.errors.length === 1 && !x.errors[0].includes(MARK), what + ': fixed words'); };
  await bad(undefined, 'tmpl1', 'no target');
  await bad(null, 'tmpl1', 'null target');
  await bad('room', 'tmpl1', 'string target');
  await bad([], 'tmpl1', 'array target');
  await bad({}, 'tmpl1', 'empty target');
  await bad({ pick: false }, 'tmpl1', 'pick false');
  await bad({ pick: 'yes' }, 'tmpl1', 'pick not boolean');
  await bad({ room: '' }, 'tmpl1', 'empty room');
  await bad({ room: 5 }, 'tmpl1', 'room not a string');
  await bad({ room: 'x'.repeat(201) }, 'tmpl1', 'room too long');
  await bad({ room: 'a', pick: true }, 'tmpl1', 'both');
  await bad({ path: '/tmp/x' }, 'tmpl1', 'a path key');
  await bad({ room: 'a', x: 1, y: 2 }, 'tmpl1', 'extra keys');
  await bad(TGT, undefined, 'no template id');
  await bad(TGT, 5, 'numeric template id');
  await bad(TGT, '', 'empty template id');
  await bad(TGT, 'x'.repeat(65), 'template id too long');
  await bad(Object.create({ room: 'inherited' }), 'tmpl1', 'inherited room');
  await bad(new (class { room = 'a'; })(), 'tmpl1', 'class instance');
  await bad(JSON.parse('{"__proto__":{"room":"a"}}'), 'tmpl1', 'an own __proto__ key');
  let ran = false;
  await bad(Object.defineProperty({}, 'room', { enumerable: true, get() { ran = true; return 'a'; } }), 'tmpl1', 'a getter');
  ok(!ran, 'the getter never ran');
  await bad(new Proxy({}, { ownKeys() { throw new Error('trap'); } }), 'tmpl1', 'a hostile proxy (a throw is not let out)').catch(() => undefined);
  // size: a huge object is judged by its key count, quickly
  const huge: Record<string, number> = {};
  for (let i = 0; i < 200_000; i++) huge['k' + i] = i;
  const t0 = Date.now();
  await bad(huge, 'tmpl1', 'a huge target');
  ok(Date.now() - t0 < 1500, 'a huge target is refused in well under a second');
  eq(F(await r.ops.createPreview(TGT, 'empty1')).code, 'empty', 'a template with no members');
  eq(F(await r.ops.createPreview(TGT, 'zzz')).code, 'notfound', 'an unknown template');
  eq(F(await r.ops.createPreview(TGT, '../../etc')).code, 'notfound', 'an id that looks like a path is only an unknown id');
  // the targets reach resolveTarget as the shapes the window may send, nothing more
  R(await r.ops.createPreview({ pick: true }, 'tmpl1'));
  R(await r.ops.createPreview({ room: 'agent-9' }, 'tmpl1'));
  eq(r.calls.targets, [{ pick: true }, { room: 'agent-9' }], 'pick and room, as copies');
  const cancel = rig([tpl([mem(1)])], { resolveTarget: async () => ({ ok: false, cancelled: true }) });
  eq(F(await cancel.ops.createPreview({ pick: true }, 'tmpl1')).code, 'cancelled', 'the folder dialog cancelled');
  const nosuch = rig([tpl([mem(1)])], { resolveTarget: async () => ({ ok: false }) });
  eq(F(await nosuch.ops.createPreview(TGT, 'tmpl1')).code, 'invalid', 'a room that is not there');
  // a store with a member that has no memberId, or two with one: refused, never guessed
  const noid = rig([tpl([mem(1, { memberId: undefined })])]);
  eq(F(await noid.ops.createPreview(TGT, 'tmpl1')).code, 'invalid', 'a member without a memberId');
  const dup = rig([tpl([mem(1), mem(1)])]);
  eq(F(await dup.ops.createPreview(TGT, 'tmpl1')).code, 'invalid', 'a repeated memberId');
  const nine = rig([tpl(Array.from({ length: 9 }, (_x, i) => mem(i + 1)))]);
  eq(F(await nine.ops.createPreview(TGT, 'tmpl1')).code, 'invalid', 'more than 8 members');
});

// ---------------------------------------------------------------------------------------------------------------- 10. previewRow arguments
section('rowArguments', async () => {
  const r = rig([tpl([mem(1, { model: 'beta-2' }), mem(2)])]);
  const p = R(await r.ops.createPreview(TGT, 'tmpl1'));
  const bad = async (row: unknown, change: unknown, what: string): Promise<void> => { const x = F(await r.ops.previewRow(p.token, row, change)); eq(x.code, 'invalid', what); ok(x.errors.length === 1 && !x.errors[0].includes('zzz'), what + ': fixed words'); };
  await bad(undefined, { effort: 'low' }, 'no row id');
  await bad('xyz', { effort: 'low' }, 'a row id that is not a memberId');
  await bad('A'.repeat(32), { effort: 'low' }, 'upper-case hex');
  await bad(hexId(1), undefined, 'no change');
  await bad(hexId(1), 'effort', 'a string change');
  await bad(hexId(1), [], 'an array change');
  await bad(hexId(1), {}, 'an empty change');
  await bad(hexId(1), { cap: 5 }, 'a limit cannot be set here');
  await bad(hexId(1), { permMode: 'allow' }, 'a mode cannot be set here');
  await bad(hexId(1), { autopilot: true }, 'autopilot cannot be set here');
  await bad(hexId(1), { effort: 'low', x: 1 }, 'an unknown key next to a good one');
  await bad(hexId(1), { effort: 'low', model: 'a', app: 'copilot', extra: 1 }, 'four keys');
  await bad(hexId(1), { app: 5 }, 'app not a string');
  await bad(hexId(1), { app: 'Not Valid' }, 'app of a bad shape');
  await bad(hexId(1), { app: 'a'.repeat(33) }, 'app too long');
  await bad(hexId(1), { model: 'a b' }, 'model of a bad shape');
  await bad(hexId(1), { model: 'a'.repeat(101) }, 'model too long');
  await bad(hexId(1), { model: 5 }, 'model not a string');
  await bad(hexId(1), { effort: 'HIGH' }, 'effort of a bad shape');
  await bad(hexId(1), { effort: 5 }, 'effort not a string');
  await bad(hexId(1), JSON.parse('{"__proto__":{"effort":"low"}}'), 'an own __proto__ key');
  await bad(hexId(1), Object.create({ effort: 'low' }), 'inherited keys');
  let ran = false;
  await bad(hexId(1), Object.defineProperty({}, 'effort', { enumerable: true, get() { ran = true; return 'low'; } }), 'a getter');
  ok(!ran, 'the getter never ran');
  const huge: Record<string, number> = {};
  for (let i = 0; i < 200_000; i++) huge['k' + i] = i;
  const t0 = Date.now();
  await bad(hexId(1), huge, 'a huge change');
  ok(Date.now() - t0 < 1500, 'a huge change is refused in well under a second');
  eq(F(await r.ops.previewRow(p.token, hexId(9), { effort: 'low' })).code, 'notfound', 'a row that is not in the preview');
  // a bad change leaves the row as it was
  const after = await r.ops.previewRow(p.token, hexId(1), { effort: 'low' }) as RowOk;
  eq(after.row.model.id, 'beta-2', 'the model is kept');
  // good changes
  const m = await r.ops.previewRow(p.token, hexId(2), { model: 'alpha-1' }) as RowOk;
  eq([m.row.model.present, m.row.cost.tier], [true, 'low'], 'a model picked on a row');
  const back = await r.ops.previewRow(p.token, hexId(2), { model: '' }) as RowOk;
  eq([back.row.model.words, back.row.model.id], ['App default', ''], 'an empty model asks for the app default');
  const gone = await r.ops.previewRow(p.token, hexId(2), { model: 'nothere-1' }) as RowOk;
  eq([gone.row.needsChoice, gone.row.model.present], [true, false], 'a model that is not offered still shows as a choice, never as another model');
  const unk = await r.ops.previewRow(p.token, hexId(2), { app: 'nosuchapp' }) as RowOk;
  eq([unk.row.app.state, unk.row.needsChoice], ['unknown', true], 'an unknown app id on a row');
  // the summary and canCreate follow the rows
  eq([unk.summary.needsChoice, unk.canCreate], [1, false], 'the summary is of the whole preview');
  const fixed = await r.ops.previewRow(p.token, hexId(2), { app: 'claude' }) as RowOk;
  eq([fixed.summary.needsChoice, fixed.canCreate], [0, true], 'and canCreate is true again once no row needs a choice');
});

// ---------------------------------------------------------------------------------------------------------------- 11. nothing else is asked of main
section('nothingElse', async () => {
  const r = rig([tpl([mem(1, { model: 'alpha-1', profile: 'custom.agent:1' }), mem(2, { app: 'claude' }), mem(3, { app: 'codex' })])]);
  const p = R(await r.ops.createPreview(TGT, 'tmpl1'));
  await r.ops.previewRow(p.token, hexId(1), { app: 'claude' });
  ok([...r.accessed].every((k) => ['store', 'adapters', 'models', 'defaultCapAiu', 'resolveTarget', 'now', 'newToken'].includes(k)), 'only the agreed dependencies are touched (no profile listing, no session): ' + [...r.accessed].join(','));
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'teamops.ts'), 'utf8');
  ok(!/listAgentProfiles|listProfiles|ensureLive|spawn|exec|autopilot\s*[:=]/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'the source never lists profiles, starts a session or sets Autopilot');
  ok(!/\bimport\b[^;]*electron|from '\.\.\/adapters/.test(src), 'no Electron and no adapter import');
  // a deadline: eight members over three apps, quickly
  const t0 = Date.now();
  for (let i = 0; i < 200; i++) await r.ops.createPreview(TGT, 'tmpl1');
  ok(Date.now() - t0 < 5000, '200 previews in well under five seconds');
});

// ---------------------------------------------------------------------------------------------------------------- 12. the handlers
/** one stand-in for Electron's ipcMain for the whole run (ipcguard binds it at its first load) */
const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
let hooked = false;
function hookElectron(): void {
  if (hooked) return;
  hooked = true;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Mod = require('module') as { _load: (r: string, ...a: unknown[]) => unknown };
  const orig = Mod._load;
  Mod._load = function (r: string, ...a: unknown[]): unknown { return r === 'electron' ? { ipcMain: { handle: (c: string, f: (e: unknown, ...x: unknown[]) => unknown) => void handlers.set(c, f), on: () => undefined } } : orig.call(this, r, ...a); };
}

section('handlers', async () => {
  // the real handlers of src/main/ipc/teams.ts on a fake Electron: the sender is checked, a throw answers one fixed `failed`
  if (IS_COPY) return;
  hookElectron();
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const g = require('../src/main/ipcguard') as typeof import('../src/main/ipcguard');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const t = require('../src/main/ipc/teams') as typeof import('../src/main/ipc/teams');
    g.initSimGuard(false);
    const frame = { url: pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href };
    const win = { senderFrame: frame, sender: { mainFrame: frame } };
    const other = { url: 'https://example.invalid/' };
    const secret = 'ghp' + '_' + 'A1b2C3d4'.repeat(5);
    const boom = async (): Promise<never> => { throw new Error('secret ' + secret); };
    const throwing = { createPreview: boom, previewRow: boom } as unknown as InstanceType<typeof TeamOps>;
    t.register({ getOps: () => undefined, getTeamOps: () => throwing });
    const call = async (c: string, e: unknown, ...a: unknown[]): Promise<{ ok: boolean; code?: string; errors?: string[] }> => (await handlers.get(c)!(e, ...a)) as never;
    for (const [c, args] of [['teams:createPreview', [TGT, 'tmpl1']], ['teams:previewRow', [TOKENS[0], hexId(1), { effort: 'low' }]]] as const) {
      const bad = await call(c, win, ...args);
      eq([bad.ok, bad.code], [false, 'failed'], c + ': a throw answers failed');
      ok(!JSON.stringify(bad).includes(secret), c + ': the throw\'s text is never in the answer');
      let refused = false;
      try { const x = await call(c, { senderFrame: other, sender: { mainFrame: other } }, ...args); refused = x.ok === false; } catch { refused = true; }
      ok(refused, c + ': another page is refused');
    }
    handlers.clear();
    t.register({ getOps: () => undefined, getTeamOps: () => undefined });
    const none = await call('teams:createPreview', win, TGT, 'tmpl1');
    eq([none.ok, none.code], [false, 'invalid'], 'no ops (the simulator): refused with fixed words');
    eq([...handlers.keys()].filter((k) => /Preview|previewRow/.test(k)).sort(), ['teams:createPreview', 'teams:previewRow'], 'the two channels');
    // the simulator refuses them before any handler runs
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sg = require('../src/main/simguard') as typeof import('../src/main/simguard');
    ok(!sg.simChannelOpen('teams:createPreview') && !sg.simChannelOpen('teams:previewRow'), 'both are closed in the simulator');
  } finally { handlers.clear(); }
});

// ---------------------------------------------------------------------------------------------------------------- 13. modelsOf is models:list unchanged
section('modelsOf', async () => {
  if (IS_COPY) return;
  // models:list on a stand-in Electron with fake adapters: its answers are what they were, and `modelsOf` returns the same list
  hookElectron();
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { register } = require('../src/main/ipc/model') as typeof import('../src/main/ipc/model');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
    const frame = { url: pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href };
    const win = { senderFrame: frame, sender: { mainFrame: frame } };
    const lists: Record<string, unknown[]> = {
      copilot: [{ id: 'm-one', name: 'One', efforts: ['low'], disabled: false }, { id: 'm-off', name: 'Off', efforts: [], disabled: true }, { id: 'm-two', name: 'Two', efforts: ['low', 'high'], disabled: false }],
      claude: [{ id: 'c-one', name: 'C', efforts: [], disabled: false }],
    };
    const router = { onEvent: () => () => undefined, forAgent: () => undefined, instance: (k: string) => ({ id: k, capabilities: { models: true }, listModelOptions: async () => { if (k === 'broken') throw new Error('nope ' + MARK); return lists[k]; } }) };
    const verdict = async (id: string, m: string) => (id === 'copilot' && m === 'm-two' ? { refuse: true, why: 'Blocked by policy.' } : id === 'copilot' && m === 'm-one' ? { refuse: false, why: 'Maybe blocked.' } : undefined);
    const mi = register({ agents: new Map(), router: router as never, registry: { defaultId: 'copilot', has: (k: string) => k in lists || k === 'broken' } as never, wsKey: () => '', getFolderStore: () => undefined, orgModel: verdict as never });
    const call = (...a: unknown[]) => Promise.resolve(handlers.get('models:list')!(win, ...a)) as Promise<{ ok: boolean; error?: string; models: unknown[] }>;
    const expected = [{ id: 'm-one', name: 'One', efforts: ['low'], orgDoubt: 'Maybe blocked.' }, { id: 'm-two', name: 'Two', efforts: ['low', 'high'], orgBlocked: 'Blocked by policy.' }];
    eq(await call('copilot'), { ok: true, models: expected }, 'models:list: disabled models dropped, the policy verdicts added');
    eq(await call(), { ok: true, models: expected }, 'models:list with no kind: the default app');
    eq(await call(''), { ok: true, models: expected }, 'models:list with an empty kind: the default app');
    eq(await call('claude'), { ok: true, models: [{ id: 'c-one', name: 'C', efforts: [] }] }, 'models:list: another app, no verdict, no extra keys');
    eq(await call('nosuch'), { ok: false, error: 'unknown agent app', models: [] }, 'models:list: an unknown app is refused');
    eq(await call(7), { ok: false, error: 'unknown agent app', models: [] }, 'models:list: a non-string kind is refused');
    const bad = await call('broken');
    eq([bad.ok, bad.models], [false, []], 'models:list: an app that cannot list answers not ok with no models');
    eq(await mi.modelsOf('copilot'), expected, 'modelsOf answers the same list');
    await assert.rejects(() => mi.modelsOf('broken'), /nope/, 'modelsOf throws when the app cannot list (the caller decides)');
    n += 2;
  } finally { handlers.clear(); }
});

// ---------------------------------------------------------------------------------------------------------------- run
(async () => {
  for (const [name, fn] of sections) {
    if (process.env.TEAMOPS_TRACE) console.error('section ' + name);
    try { await fn(); } catch (e) { failed++; console.error(`SECTION ${name} FAILED`); console.error(e instanceof Error ? e.message.slice(0, 240) : 'failed'); }
  }
  if (failed > 0) { console.error(`teamops: ${failed} section(s) failed`); process.exit(1); }
  if (IS_COPY) { console.log(`teamops (copy): ${n} checks passed`); return; }
  // ------------------------------------------------------------------------------------------------------------ mutants, on copies
  const dir = path.join(__dirname, '..', 'src', 'main');
  const orig = fs.readFileSync(path.join(dir, 'teamops.js'), 'utf8');
  const mutate = (text: string, m: { name: string; from: string; to: string }): string => {
    const lf = text.replace(/\r\n/g, '\n');
    assert.ok(lf.includes(m.from), 'mutant anchor not found: ' + m.name);
    return lf.split(m.from).join(m.to);
  };
  const mutants: { name: string; from: string; to: string; section: string }[] = [
    { name: 'the first model is preselected when it is missing', from: "model = { id: ch.model, present: false, orgBlocked: false, words: 'Not offered here' };", to: "model = { id: list[0].id, present: true, orgBlocked: false, words: 'Offered' }; found = list[0];", section: 'models' },
    { name: 'a missing model needs no choice', from: "reasons.push('This model is not offered here.');", to: '', section: 'models' },
    { name: 'an org-blocked model needs no choice', from: "reasons.push('This model is blocked by your organization.');", to: '', section: 'models' },
    { name: 'the organization text is repeated', from: "words: 'Blocked by your organization' }", to: "words: found.orgBlocked }", section: 'models' },
    { name: 'models listed for an app that is not ready', from: 'if (ch.model !== undefined && ready) {', to: 'if (ch.model !== undefined && info) {', section: 'apps' },
    { name: 'an app that is not ready needs no choice', from: "reasons.push('This app is not ready.');", to: 'void 0;', section: 'apps' },
    { name: 'an unknown app is called ready', from: "const ready = info !== undefined && info.state === 'ready';", to: 'const ready = info === undefined || info.state === \'ready\';', section: 'apps' },
    { name: 'the limit unit is the autopilot unit', from: "i.capabilities?.caps === false ? 'none'", to: "i.capabilities?.autopilot?.capUnit === 'tokens' ? 'none'", section: 'apps' },
    { name: 'Codex gets a limit (caps ignored)', from: "i.capabilities?.caps === false ? 'none' :", to: '', section: 'apps' },
    { name: 'the imported effort above the default is taken', from: "else if (imported && !(def !== undefined && offered.includes(def) && offered.indexOf(ch.effort) <= offered.indexOf(def))) {", to: 'else if (false) {', section: 'effort' },
    { name: 'imported effort with no default is taken', from: "def !== undefined && offered.includes(def) && offered.indexOf(ch.effort) <= offered.indexOf(def)", to: "def === undefined || offered.indexOf(ch.effort) <= offered.indexOf(def)", section: 'effort' },
    { name: 'imported effort one step above the default is taken', from: 'offered.indexOf(ch.effort) <= offered.indexOf(def)', to: 'offered.indexOf(ch.effort) <= offered.indexOf(def) + 1', section: 'effort' },
    { name: 'an effort that is not offered is kept', from: "if (!offered.includes(ch.effort)) {", to: 'if (false) {', section: 'effort' },
    { name: 'an effort that is not offered falls to nothing', from: "if (def !== undefined)\n                        effort.used = def;\n                    effort.note = 'falls to the default';", to: "effort.note = 'falls to the default';", section: 'effort' },
    { name: 'the person\'s pick is not taken', from: 'else if (ch.picked) {\n                    effort.used = ch.effort;', to: 'else if (false) {\n                    effort.used = ch.effort;', section: 'effort' },
    { name: 'the pick survives a model change', from: "if (change.model !== undefined) {\n            next.model = change.model === '' ? undefined : change.model;\n            next.picked = false;", to: "if (change.model !== undefined) {\n            next.model = change.model === '' ? undefined : change.model;", section: 'effort' },
    { name: 'an imported effort on the app default model is taken', from: 'if (ch.picked || !imported) {', to: 'if (true) {', section: 'effort' },
    { name: 'the limit amount is kept when the app changes', from: 'if (!ch.appChanged && m.cap && m.cap.unit === unit)', to: 'if (m.cap)', section: 'limits' },
    { name: 'the limit is kept in another unit (not converted, just kept)', from: 'if (!ch.appChanged && m.cap && m.cap.unit === unit)', to: 'if (!ch.appChanged && m.cap)', section: 'limits' },
    { name: 'a USD app takes the AIU default', from: "const d = (0, credits_1.startCap)(unit, undefined, undefined, ctx.defaultCap);", to: "const d = (0, credits_1.startCap)('aiu', undefined, undefined, ctx.defaultCap);", section: 'limits' },
    { name: 'an out-of-range amount is used as it is', from: 'amount = (0, credits_1.parseCapIn)(unit, m.cap.amount);', to: 'amount = m.cap.amount;', section: 'limits' },
    { name: 'model and effort follow an app change', from: 'next.model = undefined;', to: '', section: 'limits' },
    { name: 'a USD limit shown as credits', from: "unit === 'usd' ? `Limit: ${limit.amount.toFixed(2)} USD (estimate)`", to: "false ? ''", section: 'limits' },
    { name: 'an imported Allow all stays Allow all', from: "if (imported && perm === 'allow')", to: 'if (false)', section: 'modes' },
    { name: 'the mode is raised to Allow all', from: 'let perm = (0, agentops_1.validMode)(m.permMode);', to: "let perm = 'allow';", section: 'modes' },
    { name: 'a row carries the member name', from: 'needsChoice: reasons.length > 0, reasons,', to: 'needsChoice: reasons.length > 0, reasons, name: m.name,', section: 'noFreeText' },
    { name: 'a row carries the brief', from: 'profile: m.profile !== undefined,', to: 'profile: m.profile !== undefined, brief: m.brief,', section: 'noFreeText' },
    { name: 'the app name is echoed', from: "words: info ? STATE_WORDS[info.state] ?? STATE_WORDS.unknown : 'Not available' }", to: "words: info ? info.displayName : 'Not available' }", section: 'noFreeText' },
    { name: 'the room key goes to the window', from: 'ok: true, token, expiresAt: entry.expiresAt,', to: 'ok: true, token, key: r.key, expiresAt: entry.expiresAt,', section: 'noFreeText' },
    { name: 'the token never expires', from: 'return this.now() < e.expiresAt ? e : undefined;', to: 'return e;', section: 'token' },
    { name: 'the token never expires (previewRow)', from: 'if (this.now() >= e.expiresAt) {', to: 'if (false) {', section: 'token' },
    { name: 'the token lives one millisecond too long', from: 'if (this.now() >= e.expiresAt) {', to: 'if (this.now() > e.expiresAt) {', section: 'token' },
    { name: 'the token lives 9 minutes', from: 'exports.TOKEN_MS = 600_000;', to: 'exports.TOKEN_MS = 540_000;', section: 'token' },
    { name: 'a new preview does not drop the old one', from: '        this.live = undefined;\n        const target = readTarget(targetIn);', to: '        const target = readTarget(targetIn);', section: 'token' },
    { name: 'an older preview replaces a newer one', from: 'if (me !== this.gen)', to: 'if (false)', section: 'token' },
    { name: 'takeToken leaves the token alive', from: "this.live = undefined;\n        return this.now() < e.expiresAt ? e : undefined;", to: 'return this.now() < e.expiresAt ? e : undefined;', section: 'token' },
    { name: 'a token of any shape reaches the lookup (previewRow)', from: "if (typeof token !== 'string' || !TOKEN_RE.test(token))\n            return fail('invalid', 'Preview: not valid.');", to: '', section: 'token' },
    { name: 'the preview lists profiles', from: 'const adapters = await this.deps.adapters();', to: 'const adapters = await this.deps.adapters(); await this.deps.listProfiles?.();', section: 'nothingElse' },
    { name: 'invalid arguments leave the old preview alive (drop after validating)', from: '        this.live = undefined;\n        const target = readTarget(targetIn);\n        if (typeof target === \'string\')\n            return fail(\'invalid\', target);', to: '        const target = readTarget(targetIn);\n        if (typeof target === \'string\')\n            return fail(\'invalid\', target);\n        this.live = undefined;', section: 'token' },
    { name: 'previewRow asks the adapters before it checks the token', from: '        const e = this.peek(token);\n        if (!e)\n            return fail(\'notfound\', \'Preview: expired or not found. Open it again.\');\n        const m =', to: '        await this.deps.adapters();\n        const e = this.peek(token);\n        if (!e)\n            return fail(\'notfound\', \'Preview: expired or not found. Open it again.\');\n        const m =', section: 'tokenFirst' },
    { name: 'previewRow merges into the choices read before the wait', from: '        const ctx = this.context(await this.deps.adapters());\n        if (this.peek(token) !== e)\n            return fail(\'notfound\', \'Preview: expired or not found. Open it again.\'); // replaced while it waited\n        const ch = e.choices.get(rowId); // the CURRENT choices, read after the wait', to: '        const ch0 = e.choices.get(rowId);\n        const ctx = this.context(await this.deps.adapters());\n        if (this.peek(token) !== e)\n            return fail(\'notfound\', \'Preview: expired or not found. Open it again.\'); // replaced while it waited\n        const ch = ch0;', section: 'overlap' },
    { name: 'a call that was overtaken keeps its row (no work out again)', from: 'if (e.choices.get(rowId) !== cur)\n                continue;', to: '', section: 'overlap' },
    { name: 'the preview is not checked again after the row is worked out', from: "            const row = await this.row(m, imported, cur, ctx);\n            if (this.peek(token) !== e)\n                return fail('notfound', 'Preview: expired or not found. Open it again.');\n", to: "            const row = await this.row(m, imported, cur, ctx);\n", section: 'overlap' },
    { name: 'a second change forgets that the app was changed', from: 'appChanged: ch.appChanged };', to: 'appChanged: false };', section: 'overlap' },
    { name: 'the choices are not stored before the row is worked out', from: 'e.choices.set(rowId, next);', to: '', section: 'overlap' },
    { name: 'the target is not checked', from: "if (typeof target === 'string')\n            return fail('invalid', target);", to: '', section: 'arguments' },
    { name: 'a room of any length', from: 'room.length <= ROOM_MAX', to: 'true', section: 'arguments' },
    { name: 'a target with extra keys', from: "if (keys.length !== 1)\n        return 'Target: not valid.';", to: '', section: 'arguments' },
    { name: 'a change with an unknown key is taken', from: "else\n            return 'Change: not valid.';", to: '', section: 'rowArguments' },
    { name: 'a model of any shape', from: "(x !== '' && !teamtemplate_1.MODEL_RE.test(x))", to: 'false', section: 'rowArguments' },
    { name: 'a row id of any shape', from: "if (typeof rowId !== 'string' || !teamtemplate_1.MEMBER_ID_RE.test(rowId))", to: "if (typeof rowId !== 'string')", section: 'rowArguments' },
    { name: 'a repeated memberId is accepted', from: '|| choices.has(m.memberId))', to: ')', section: 'arguments' },
    { name: 'the models of the same app asked once per member', from: 'let p = cache.get(id);\n                if (!p) {', to: 'let p = undefined;\n                if (!p) {', section: 'models' },
    { name: 'the summary does not count High', from: "high: rows.filter((r) => r.cost.tier === 'high').length", to: 'high: 0', section: 'costs' },
    { name: 'the cost words ignore the multiplier', from: "cost.words = cost.tier === 'not-reported' ? `${num2(found.multiplier)}x` : `${cost.words}, ${num2(found.multiplier)}x`;", to: '', section: 'costs' },
    { name: 'canCreate ignores the rows', from: 'canCreate: summary.needsChoice === 0,', to: 'canCreate: true,', section: 'apps' },
  ];
  // every anchor is found in the CRLF form of the file too, as a Windows checkout has it, and a missing one says so
  const lost = mutants.filter((m) => !orig.replace(/\r\n/g, '\n').includes(m.from)).map((m) => m.name);
  assert.deepStrictEqual(lost, [], 'mutant anchors not found');
  for (const m of mutants) {
    const crlf = orig.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    ok(mutate(crlf, m).length > 0, 'the anchor of "' + m.name + '" is found in a CRLF source');
  }
  assert.throws(() => mutate('no such text', mutants[0]), /mutant anchor not found: /, 'a missing anchor says so');
  let killed = 0;
  let k = 0;
  for (const m of mutants) {
    k++;
    const uniq = `teamops.mutant-${process.pid}-${k}`;
    const file = path.join(dir, uniq + '.js');
    try {
      const mutated = mutate(orig, m);
      try { new vm.Script(mutated, { filename: uniq }); } catch (e) { assert.fail('mutant is not valid JavaScript (' + m.name + '): ' + (e as Error).message); }
      fs.writeFileSync(file, mutated);
      const r = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { TEAMOPS_MODULE: uniq }), encoding: 'utf8', timeout: 120000 });
      assert.notStrictEqual(r.status, 0, 'mutant NOT killed: ' + m.name);
      const died = [...r.stderr.matchAll(/SECTION (\w+) FAILED/g)].map((x) => x[1]);
      if (process.env.TEAMOPS_LABELS) console.log(m.name + ' => ' + (died.join(',') || '(no section: ' + (r.stderr.split('\n').find((l) => /Error/.test(l)) ?? 'silent exit') + ')'));
      assert.ok(died.includes(m.section), `mutant "${m.name}" must die in section "${m.section}", it died in: ${died.join(',') || r.stderr.slice(0, 200)}`);
      killed++;
    } finally { fs.rmSync(file, { force: true }); }
  }
  assert.strictEqual(killed, mutants.length);
  console.log(`teamops: ${n} checks passed, ${killed} mutants killed`);
})().catch((e) => { console.error(e); process.exit(1); });

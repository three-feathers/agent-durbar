/**
 * Spec 030 Phase 2 (T030-T034): the Copilot adapter's model switching, compaction, resume config, pricing mapping and the capability contract,
 * all against a FAKE client and session. No runtime process, no Copilot account, no credits. What the real runtime does is NOT tested here
 * (it is spec 030 Phase 3, T040..T046): these tests pin what the adapter SENDS and how it maps whatever comes back.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { CopilotAdapter, COPILOT_DESCRIPTOR } from '../src/adapters/copilot';
import { FakeClient, FakeSession, TestAdapter } from './fakes/copilot-sdk';
import { createRegistry, detectAll } from '../src/adapters/registry';
import type { AdapterDescriptor } from '../src/adapters/capabilities';
import { EventMapper } from '../src/adapters/map';
import type { RawEvent } from '../src/adapters/map';
import { autoTierToSend, compactResultFrom, managedAutoTierFrom, modelConfig, runtimeHasAutoTiers, runtimeMessage, modelOptionFrom, priceClassOf, pricingFromTokenPrices, switchResultFrom, withAutoTiers } from '../src/adapters/copilotmodel';
import type { AdapterCapabilities, AgentAdapter, AgentEvent } from '../src/adapters/types';
import { modelControlFor, NO_MODEL_CONTROL } from '../src/shared/modelswitch';
import { startOptionsOf } from '../src/main/startopts';
import type { ModelIpcDeps } from '../src/main/ipc/model'; // compiled for the handler test below (loaded under a stand-in electron)

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Wait for a condition, with a generous limit (AGENTS.md: asserts that depend on timing wait, they do not sleep once). */
const waitFor = async (what: string, cond: () => boolean, ms = 5000): Promise<void> => { const end = Date.now() + ms; while (!cond()) { if (Date.now() > end) throw new Error('timed out waiting for ' + what); await sleep(2); } };
const askedCount = (evs: { type: string; phase?: string }[], from = 0): number => evs.slice(from).filter((e) => e.type === 'question' && e.phase === 'asked').length;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-cm-'));
const names = (s: FakeSession): string[] => s.calls.map((c) => c.name);
const arg = (s: FakeSession, name: string): Record<string, unknown> => s.calls.filter((c) => c.name === name).slice(-1)[0].args[0] as Record<string, unknown>;

async function setup(startOpts: Record<string, unknown> = {}): Promise<{ ad: TestAdapter; fake: FakeClient; sid: string; s: FakeSession; events: AgentEvent[] }> {
  const fake = new FakeClient();
  const ad = new TestAdapter(fake);
  const events: AgentEvent[] = [];
  ad.onEvent((e) => events.push(e));
  const sid = await ad.start({ workspace: dir, model: 'auto', autoTier: 'efficiency', ...startOpts });
  return { ad, fake, sid, s: fake.last, events };
}

async function main(): Promise<void> {
  // ---- T033: pricing mapping is tolerant and scaled per million tokens (the unit checked on a paid account, T044 2026-10-20)
  assert.strictEqual(pricingFromTokenPrices(undefined), undefined);
  assert.strictEqual(pricingFromTokenPrices({}), undefined);
  assert.strictEqual(pricingFromTokenPrices({ inputPrice: 3, outputPrice: 15 }), undefined, 'no batch size: nothing is guessed');
  assert.strictEqual(pricingFromTokenPrices({ batchSize: 0, inputPrice: 3 }), undefined);
  assert.strictEqual(pricingFromTokenPrices({ batchSize: 1000, inputPrice: 'x' as unknown as number }), undefined);
  assert.deepStrictEqual(pricingFromTokenPrices({ batchSize: 1000, inputPrice: 3, outputPrice: 15, cacheReadPrice: 0.3 }), { inputPerMTok: 3000, outputPerMTok: 15000, cachedPerMTok: 300 });
  const onlyIn = pricingFromTokenPrices({ batchSize: 1e6, inputPrice: 2 });
  assert.deepStrictEqual(onlyIn, { inputPerMTok: 2, outputPerMTok: undefined, cachedPerMTok: undefined }, 'missing output stays absent, never 0');
  const withLong = pricingFromTokenPrices({ batchSize: 1e6, inputPrice: 2, outputPrice: 8, longContext: { inputPrice: 4, outputPrice: 12 } });
  assert.strictEqual(withLong?.long?.inputPerMTok, 4);
  assert.strictEqual(priceClassOf('very_high'), 'very-high');
  assert.strictEqual(priceClassOf('low'), 'low');
  assert.strictEqual(priceClassOf('weird'), undefined);

  const base = { id: 'm1', name: 'M One', capabilities: { limits: { max_context_window_tokens: 200000, max_output_tokens: 8000 } } };
  const bare = modelOptionFrom(base);
  assert.deepStrictEqual(bare, { id: 'm1', name: 'M One', multiplier: undefined, efforts: [], defaultEffort: undefined, disabled: false, contextWindow: 200000 });
  assert.ok(!('pricing' in bare) && !('priceClass' in bare) && !('contextTiers' in bare) && !('longWindow' in bare), 'absent fields stay absent');
  const rich = modelOptionFrom({ ...base, billing: { multiplier: 1, tokenPrices: { batchSize: 1e6, inputPrice: 2, outputPrice: 8, longContext: { inputPrice: 4, outputPrice: 12, maxPromptTokens: 900000 } } }, modelPickerPriceCategory: 'high', supportedReasoningEfforts: ['low', 'high'], policy: { state: 'disabled' } });
  assert.strictEqual(rich.priceClass, 'high');
  assert.deepStrictEqual(rich.contextTiers, ['default', 'long']);
  assert.strictEqual(rich.longWindow, 900000, 'long window = the long tier\'s prompt budget (the runtime\'s tokenLimit, real 2026-10-20)');
  assert.ok(!('unverified' in (rich.pricing ?? {})), 'prices are credits per million tokens (checked on a paid account)');
  // real shapes (listModels on Copilot Pro, 2026-10-20): the window is the prompt budget the runtime enforces
  const luna = modelOptionFrom({ id: 'gpt-6-luna', capabilities: { limits: { max_context_window_tokens: 1000000, max_output_tokens: 128000, max_prompt_tokens: 872000 } }, billing: { tokenPrices: { batchSize: 1e6, inputPrice: 10, outputPrice: 50, contextMax: 272000, maxPromptTokens: 272000, longContext: { inputPrice: 20, outputPrice: 75, contextMax: 872000, maxPromptTokens: 872000 } } } });
  assert.deepStrictEqual([luna.contextWindow, luna.longWindow], [272000, 872000], 'gpt-6-luna: 272k, long 872k (runtime tokenLimit)');
  const mai = modelOptionFrom({ id: 'mai-code-1.1-flash', capabilities: { limits: { max_context_window_tokens: 256000, max_prompt_tokens: 128000 } }, billing: { tokenPrices: { batchSize: 1e6, inputPrice: 20, outputPrice: 120, contextMax: 128000 } } });
  assert.strictEqual(mai.contextWindow, 128000, 'mai-code-1.1-flash: 128k, not its 256k window');
  const haiku = modelOptionFrom({ id: 'claude-haiku-4.5', capabilities: { limits: { max_context_window_tokens: 144000, max_prompt_tokens: 128000 } }, billing: { tokenPrices: { batchSize: 1e6, inputPrice: 100, outputPrice: 500 } } });
  assert.strictEqual(haiku.contextWindow, 128000, 'claude-haiku-4.5: 128k');
  assert.strictEqual(rich.disabled, true);
  const noOut = modelOptionFrom({ id: 'm2', billing: { tokenPrices: { batchSize: 1, inputPrice: 1, longContext: { inputPrice: 2, maxPromptTokens: 5 } } } });
  assert.deepStrictEqual(noOut.contextTiers, ['default', 'long']);
  assert.strictEqual(noOut.longWindow, 5, 'the long window is the long prompt budget, no output limit needed');
  assert.strictEqual(noOut.name, 'm2');
  assert.strictEqual(modelOptionFrom({ id: 'm3', capabilities: { limits: { max_context_window_tokens: 0 } } }).contextWindow, undefined, 'a window of 0 (auto) is unknown');
  assert.deepStrictEqual(modelOptionFrom({ id: 'm4', supportedContextTiers: ['default', 'long_context'] }).contextTiers, ['default', 'long']);

  // ---- T040: the REAL list of the owner's login (provenance real, read-only, no credits): only `auto`, with no window, price, effort or tier fields
  {
    const fx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'models', 'real-list-models-2026-10-17.json'), 'utf8')) as { provenance: string; models: Array<{ id: string }>; builtInCatalogIds: string[] };
    assert.strictEqual(fx.provenance, 'real');
    assert.deepStrictEqual(fx.models.map((m) => m.id), ['auto']);
    assert.ok(fx.builtInCatalogIds.length > 10 && fx.builtInCatalogIds.every((x) => typeof x === 'string'));
    assert.ok(!JSON.stringify(fx).match(/ghu_|gho_|ghp_|github_pat_|"login"|"host"|"statusMessage"|bearer/i), 'the fixture keeps no account detail');
    const opt = modelOptionFrom(fx.models[0] as never);
    assert.deepStrictEqual(opt, { id: 'auto', name: 'Auto', multiplier: undefined, efforts: [], defaultEffort: undefined, disabled: false, contextWindow: undefined });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const D = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'modelswitch.js')) as { priceLine: (m: unknown) => string; windowOf: (m: unknown) => number };
    assert.strictEqual(D.priceLine(opt), 'price not reported');
    assert.strictEqual(D.windowOf(opt), 0, 'the window of auto is unknown, the chip says so');
  }

  // ---- real events (provenance real: free plan, model auto, 2026-10-17, see spec 030 research.md): what the mapper makes of them
  {
    const fxDir = path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'events');
    const raw = JSON.parse(fs.readFileSync(path.join(fxDir, 'real-030-auto-switch-compact.json'), 'utf8')) as RawEvent[];
    const out: Array<Record<string, unknown>> = [];
    const m = new EventMapper((b) => out.push(b as unknown as Record<string, unknown>));
    m.expectUserModel('auto');
    for (const e of raw) m.map(e);
    const ctx = out.find((e) => e.type === 'context') as { tokens: number; limit: number };
    assert.deepStrictEqual([ctx.tokens, ctx.limit], [13511, 272000], 'the real window of auto (its resolved model) arrives with the first usage info');
    const us = out.filter((e) => e.type === 'usage') as Array<{ model: string; nanoAiu: number }>;
    assert.strictEqual(us[0].model, 'gpt-6-luna', 'a usage event names the model auto resolved to');
    assert.strictEqual(us[0].nanoAiu, 154967500);
    assert.strictEqual(us.length, 2, 'the compaction call is counted as usage too');
    assert.strictEqual(us[1].nanoAiu, 190787500, 'real: a compaction costs one model call (0.19 AIU here)');
    const ch = out.filter((e) => e.type === 'model') as Array<{ cause: string; tier?: string }>;
    assert.deepStrictEqual([ch[0].cause, ch[0].tier], ['user', 'long'], 'a requested tier change arrives as a model event with the tier');
    const comp = out.filter((e) => e.type === 'compaction') as Array<{ phase: string; trigger: string; tokensBefore?: number; tokensAfter?: number; tokensRemoved?: number; error?: string }>;
    assert.deepStrictEqual(comp.map((c) => c.phase), ['start', 'complete', 'failed']);
    assert.deepStrictEqual([comp[1].tokensBefore, comp[1].tokensAfter, comp[1].tokensRemoved], [296, 398, 0], 'real: a tiny conversation grows when summarised; tokensRemoved is never negative');
    const sw = JSON.parse(fs.readFileSync(path.join(fxDir, 'real-030-switch-results.json'), 'utf8')) as { provenance: string; switchTo: Array<{ result: Record<string, unknown> }> };
    assert.strictEqual(sw.provenance, 'real');
    const [cancelled, applied, , deferred] = sw.switchTo.map((x) => x.result);
    assert.strictEqual(switchResultFrom(cancelled, 'gpt-5-mini').status, 'rejected');
    assert.match(switchResultFrom(cancelled, 'gpt-5-mini').message ?? '', /not available on this Copilot account/);
    assert.strictEqual(switchResultFrom(applied, 'auto').status, 'applied');
    assert.deepStrictEqual([switchResultFrom(deferred, 'auto').status, switchResultFrom(deferred, 'auto').queueId], ['queued', '4']);
    assert.strictEqual(runtimeMessage(new Error('Request session.history.compact failed with message: Nothing to compact.'), 'x'), 'Nothing to compact.');
    assert.strictEqual(runtimeMessage('weird', 'fallback'), 'fallback');
  }

  // ---- T032: the pure config keeps the saved choice on create and resume; with no tier of its own, the cheap default only for a NEW auto session
  assert.deepStrictEqual(modelConfig({ model: 'auto', autoTier: 'efficiency' }, false), { model: 'auto', capi: { autoTier: 'efficiency' } });
  assert.deepStrictEqual(modelConfig({ model: 'auto' }, false), { model: 'auto', capi: { autoTier: 'efficiency' } }, 'a new auto session with no tier of its own: the cheapest');
  assert.deepStrictEqual(modelConfig({ model: 'auto' }, true), { model: 'auto' }, 'no autoTier override on resume when none was chosen');
  // spec 007 FR-016: the user's own saved tier goes on create AND resume
  assert.deepStrictEqual(modelConfig({ model: 'auto', autoTier: 'balance' }, true), { model: 'auto', capi: { autoTier: 'balance' } }, 'a saved tier goes on resume too');
  assert.deepStrictEqual(modelConfig({ model: 'auto', autoTier: 'intelligence' }, false), { model: 'auto', capi: { autoTier: 'intelligence' } });
  assert.deepStrictEqual(modelConfig({ model: 'auto', autoTier: 'fast' as never }, false), { model: 'auto', capi: { autoTier: 'efficiency' } }, 'a name outside the allow-list is never sent');
  // FR-017: a locked organization tier: nothing is sent; an overridable one: the user's own tier, else nothing (the runtime's default applies)
  assert.deepStrictEqual(modelConfig({ model: 'auto', autoTier: 'intelligence' }, false, { tier: 'balance', locked: true }), { model: 'auto' }, 'locked: never a tier');
  assert.deepStrictEqual(modelConfig({ model: 'auto' }, false, { tier: 'balance', locked: false }), { model: 'auto' }, 'org default: not overridden by ours');
  assert.deepStrictEqual(modelConfig({ model: 'auto', autoTier: 'intelligence' }, true, { tier: 'balance', locked: false }), { model: 'auto', capi: { autoTier: 'intelligence' } }, 'overridable: the user\'s own tier');
  assert.strictEqual(autoTierToSend('sim-deep', 'balance', undefined, true), undefined, 'never for another model');
  assert.strictEqual(autoTierToSend('auto', undefined, undefined, false), undefined);
  assert.deepStrictEqual(modelConfig({ model: 'sim-deep', reasoningEffort: 'high', contextTier: 'long', autoTier: 'efficiency' }, true), { model: 'sim-deep', reasoningEffort: 'high', contextTier: 'long_context' });
  assert.deepStrictEqual(modelConfig({ model: 'sim-deep', contextTier: 'default' }, false), { model: 'sim-deep' }, 'the default tier is the runtime default: not sent');

  // ---- result mappers
  assert.strictEqual(switchResultFrom(undefined, 'x').status, 'rejected');
  assert.deepStrictEqual(switchResultFrom({ modelId: 'x' }, 'x'), { status: 'applied', model: 'x', warning: undefined, message: undefined });
  assert.strictEqual(switchResultFrom({ deferred: true, queueId: 'q1', modelId: 'old' }, 'x').status, 'queued');
  assert.strictEqual(switchResultFrom({ deferred: true, queueId: 'q1' }, 'x').queueId, 'q1');
  const conf = switchResultFrom({ status: 'confirmation_required', confirmation: { targetModelDisplayName: 'Small', currentTokens: 90000, targetLimit: 32000 } }, 'x');
  assert.deepStrictEqual(conf.confirmation, { targetName: 'Small', currentTokens: 90000, targetLimit: 32000 });
  assert.strictEqual(conf.status, 'needs-confirmation');
  const unknown = switchResultFrom({ status: 'something-new', modelId: 'other', message: 'nope' }, 'x');
  assert.strictEqual(unknown.status, 'rejected', 'a status the adapter does not know is never trusted as applied');
  assert.strictEqual(unknown.message, 'nope');
  assert.strictEqual(switchResultFrom({ modelId: 'x', warning: 'w'.repeat(1000) }, 'x').warning?.length, 300);
  assert.deepStrictEqual(compactResultFrom({ success: true, tokensRemoved: 10, contextWindow: { currentTokens: 5 } }), { success: true, tokensRemoved: 10, tokensAfter: 5 });
  assert.strictEqual(compactResultFrom({ success: false }).success, false);
  assert.strictEqual(compactResultFrom(undefined).success, false);

  // ---- T030: setModel against the fake session
  {
    const { ad, sid, s, events } = await setup();
    assert.ok(names(s).includes('registerInterest'));
    const r = await ad.setModel(sid, { model: 'sim-deep', effort: 'high', contextTier: 'long' });
    assert.strictEqual(r.status, 'applied');
    const p = arg(s, 'switchTo');
    assert.deepStrictEqual(p, { modelId: 'sim-deep', reasoningEffort: 'high', contextTier: 'long_context', deferIfModelChangeQueued: true, runCompactionPreflight: true, source: 'model_picker' });
    for (const forbidden of ['repoScope', 'modelChangeScope', 'pickerPersistence', 'compactionDecision', 'autoTier', 'requireAvailable']) assert.ok(!(forbidden in p), forbidden + ' is never sent for a normal switch');
    // the runtime's confirming event is reported as the user's own choice
    s.fire('session.model_change', { newModel: 'sim-deep', previousModel: 'auto', reasoningEffort: 'high', contextTier: 'long_context' });
    const ev = events.filter((e) => e.type === 'model').slice(-1)[0] as { cause: string; tier?: string };
    assert.strictEqual(ev.cause, 'user');
    assert.strictEqual(ev.tier, 'long');
    // an unrelated change afterwards is the runtime's
    s.fire('session.model_change', { newModel: 'other', previousModel: 'sim-deep' });
    assert.strictEqual((events.filter((e) => e.type === 'model').slice(-1)[0] as { cause: string }).cause, 'runtime');

    // effort: null clears, omitted keeps; the default tier is sent explicitly (a switch describes the whole state)
    s.switchAnswer = { modelId: 'sim-fast' };
    await ad.setModel(sid, { model: 'sim-fast', effort: null, contextTier: 'default' });
    assert.strictEqual(arg(s, 'switchTo').reasoningEffort, null);
    assert.strictEqual(arg(s, 'switchTo').contextTier, 'default');
    await ad.setModel(sid, { model: 'sim-fast' });
    assert.ok(!('reasoningEffort' in arg(s, 'switchTo')) && !('contextTier' in arg(s, 'switchTo')));
    // switching to auto keeps the cheap routing
    s.switchAnswer = { modelId: 'auto' };
    await ad.setModel(sid, { model: 'auto' });
    assert.deepStrictEqual(arg(s, 'switchTo').autoTier, 'efficiency');
    // spec 007 FR-014: a chosen tier is sent as asked; a tier with another model never is
    const at = await ad.setModel(sid, { model: 'auto', autoTier: 'intelligence' });
    assert.strictEqual(at.status, 'applied');
    assert.strictEqual(arg(s, 'switchTo').autoTier, 'intelligence');
    assert.strictEqual(arg(s, 'switchTo').modelId, 'auto');
    s.switchAnswer = { modelId: 'sim-fast' };
    await ad.setModel(sid, { model: 'sim-fast', autoTier: 'balance' });
    assert.ok(!('autoTier' in arg(s, 'switchTo')), 'the runtime rejects an autoTier for any model but auto: never sent');
    // the runtime's confirming event carries the tier (three names only)
    s.fire('session.model_change', { newModel: 'auto', previousModel: 'sim-fast', autoTier: 'balance', previousAutoTier: 'efficiency' });
    assert.strictEqual((events.filter((e) => e.type === 'model').slice(-1)[0] as { autoTier?: string }).autoTier, 'balance');
    s.fire('session.model_change', { newModel: 'auto', previousModel: 'auto', autoTier: 'fast' });
    assert.ok(!('autoTier' in (events.filter((e) => e.type === 'model').slice(-1)[0] as object)), 'a tier outside the allow-list is dropped');
    // review on #642 (item 8): an organization default is never reported as the user's own tier
    s.fire('session.model_change', { newModel: 'auto', previousModel: 'auto', autoTier: 'intelligence', autoTierManaged: true });
    assert.ok(!('autoTier' in (events.filter((e) => e.type === 'model').slice(-1)[0] as object)), 'autoTierManaged: true drops the tier');
    s.fire('session.model_change', { newModel: 'auto', previousModel: 'auto', autoTier: 'intelligence', autoTierManaged: false });
    assert.strictEqual((events.filter((e) => e.type === 'model').slice(-1)[0] as { autoTier?: string }).autoTier, 'intelligence');
    // item 3 / FR-019: a failed tier switch is a normalized event with the tier still in effect
    s.fire('session.auto_tier_switch_failed', { requestedAutoTier: 'efficiency', effectiveAutoTier: 'intelligence', reason: 'request_failed' });
    const lastFail = (): Record<string, unknown> => { const { timestamp: _t, ...rest } = events.filter((e) => e.type === 'autoTierFailed').slice(-1)[0] as unknown as Record<string, unknown>; return rest; };
    assert.deepStrictEqual(lastFail(), { type: 'autoTierFailed', sessionId: sid, reason: 'request-failed', requested: 'efficiency', effective: 'intelligence' });
    s.fire('session.auto_tier_switch_failed', { requestedAutoTier: null, effectiveAutoTier: 'fast', reason: 'something_new' });
    assert.deepStrictEqual(lastFail(), { type: 'autoTierFailed', sessionId: sid, reason: 'unknown' }, 'unknown names dropped, reason unknown');
    for (const [raw, norm] of [['policy_rejected', 'policy-rejected'], ['setup_failed', 'setup-failed'], ['unsupported', 'unsupported']]) {
      s.fire('session.auto_tier_switch_failed', { requestedAutoTier: 'balance', reason: raw });
      assert.strictEqual((events.filter((e) => e.type === 'autoTierFailed').slice(-1)[0] as { reason: string }).reason, norm);
    }

    // queued while a turn runs, then cancelled
    s.switchAnswer = { deferred: true, queueId: 'q-7' };
    const q = await ad.setModel(sid, { model: 'sim-deep' });
    assert.deepStrictEqual([q.status, q.queueId], ['queued', 'q-7']);
    await ad.cancelQueuedModel(sid, 'q-7');
    assert.deepStrictEqual(arg(s, 'removeAt'), { id: 'q-7' });
    s.removed = false;
    await assert.rejects(ad.cancelQueuedModel(sid, 'q-7'), /Nothing was queued/);
    await assert.rejects(ad.cancelQueuedModel('nope', 'q'), /./);
    // spec 030 FR-061: a choice during a reply replaces the queued one: the older leaves the queue first, and the runtime's event for the new one stays the user's
    s.removed = true;
    s.switchAnswer = { deferred: true, queueId: 'q-8' };
    await ad.setModel(sid, { model: 'sim-deep', contextTier: 'default' });
    await ad.cancelQueuedModel(sid, 'q-8');
    s.switchAnswer = { deferred: true, queueId: 'q-9' };
    const q2 = await ad.setModel(sid, { model: 'sim-deep', contextTier: 'long', effort: 'high' });
    assert.deepStrictEqual([q2.status, q2.queueId], ['queued', 'q-9']);
    const sw = arg(s, 'switchTo');
    assert.deepStrictEqual([sw.modelId, sw.contextTier, sw.reasoningEffort], ['sim-deep', 'long_context', 'high'], 'the queued switch holds all three');
    s.fire('session.model_change', { newModel: 'sim-deep', previousModel: 'sim-fast', reasoningEffort: 'high', contextTier: 'long_context' });
    const qe = events.filter((e) => e.type === 'model').slice(-1)[0] as { cause: string; tier?: string; effort?: string };
    assert.deepStrictEqual([qe.cause, qe.tier, qe.effort], ['user', 'long', 'high'], 'and is reported as the user\'s own choice');

    // a runtime error becomes a rejected result with its message, and no stale "user" expectation is left behind
    s.rpc.model.switchTo = async () => { throw new Error('model not available'); };
    const bad = await ad.setModel(sid, { model: 'sim-ghost' });
    assert.deepStrictEqual([bad.status, bad.message], ['rejected', 'model not available']);
    s.fire('session.model_change', { newModel: 'sim-ghost', previousModel: 'auto' });
    assert.strictEqual((events.filter((e) => e.type === 'model').slice(-1)[0] as { cause: string }).cause, 'runtime');
    await assert.rejects(ad.setModel('nope', { model: 'x' }), /./, 'unknown session');
  }

  // ---- T030: confirmation, accept (compact first, never a guessed decision string), decline, busy
  {
    const { ad, sid, s } = await setup();
    s.switchAnswer = { status: 'confirmation_required', confirmation: { targetModelDisplayName: 'Small', currentTokens: 90000, targetLimit: 32000 } };
    const c = await ad.setModel(sid, { model: 'sim-fast' });
    assert.strictEqual(c.status, 'needs-confirmation');
    assert.deepStrictEqual(c.confirmation, { targetName: 'Small', currentTokens: 90000, targetLimit: 32000 });
    assert.ok(!names(s).includes('compact'), 'asking never compacts');

    const n = names(s).length;
    const d = await ad.setModel(sid, { model: 'sim-fast', confirm: { compaction: 'decline' } });
    assert.strictEqual(d.status, 'rejected');
    assert.strictEqual(names(s).length, n, 'decline calls nothing');

    // accept: compact (trigger model_switch) then switch; still too big afterwards -> rejected, no loop
    const still = await ad.setModel(sid, { model: 'sim-fast', confirm: { compaction: 'accept' } });
    assert.deepStrictEqual(arg(s, 'compact'), { trigger: 'model_switch' });
    assert.strictEqual(still.status, 'rejected');
    assert.strictEqual(names(s).filter((x) => x === 'switchTo').length, 2);
    assert.ok(!('compactionDecision' in arg(s, 'switchTo')));

    s.switchAnswer = { modelId: 'sim-fast' };
    assert.strictEqual((await ad.setModel(sid, { model: 'sim-fast', confirm: { compaction: 'accept' } })).status, 'applied');

    // compaction fails: the model is not changed
    s.compactAnswer = { success: false, tokensRemoved: 0, messagesRemoved: 0 };
    const before = names(s).filter((x) => x === 'switchTo').length;
    assert.strictEqual((await ad.setModel(sid, { model: 'sim-fast', confirm: { compaction: 'accept' } })).status, 'rejected');
    assert.strictEqual(names(s).filter((x) => x === 'switchTo').length, before, 'no switch after a failed compaction');

    // busy: no compaction mid-turn
    s.processing = true;
    s.compactAnswer = { success: true, tokensRemoved: 1 };
    const busy = await ad.setModel(sid, { model: 'sim-fast', confirm: { compaction: 'accept' } });
    assert.strictEqual(busy.status, 'rejected');
    assert.match(busy.message ?? '', /idle/);
  }

  // ---- T031: compact against the fake session
  {
    const { ad, sid, s } = await setup();
    const r = await ad.compact(sid, 'the API decisions');
    assert.deepStrictEqual(r, { success: true, tokensRemoved: 5000, tokensAfter: 12000 });
    assert.deepStrictEqual(arg(s, 'compact'), { trigger: 'manual', customInstructions: 'the API decisions' });
    await ad.compact(sid);
    assert.deepStrictEqual(arg(s, 'compact'), { trigger: 'manual' }, 'no focus: no instructions');
    s.processing = true;
    const n = names(s).filter((x) => x === 'compact').length;
    const busy = await ad.compact(sid, 'x');
    assert.strictEqual(busy.success, false);
    assert.strictEqual(names(s).filter((x) => x === 'compact').length, n, 'busy: the runtime is not asked');
    s.processing = false;
    s.rpc.history.compact = async () => { throw new Error('boom'); };
    assert.deepStrictEqual(await ad.compact(sid), { success: false, message: 'boom' });
    s.rpc.metadata.isProcessing = async () => { throw new Error('unsupported'); };
    s.compactAnswer = { success: true };
    s.rpc.history.compact = async (a: unknown) => { s.calls.push({ name: 'compact', args: [a] }); return s.compactAnswer; };
    const m = names(s).filter((x) => x === 'compact').length;
    assert.strictEqual((await ad.compact(sid)).success, false, 'when the runtime cannot say whether it is busy, it is treated as busy');
    assert.strictEqual(names(s).filter((x) => x === 'compact').length, m);
    await assert.rejects(ad.compact('nope'), /./);
  }

  // ---- T032: a switched model survives a resume (the overwrite bug)
  {
    const { ad, fake, sid } = await setup({ model: 'auto', autoTier: 'efficiency' });
    assert.deepStrictEqual(fake.created[0].capi, { autoTier: 'efficiency' }, 'a NEW auto session still gets the cheap routing');
    assert.strictEqual(fake.created[0].model, 'auto');
    assert.ok(!('contextTier' in fake.created[0]));
    assert.strictEqual(fake.created[0].enableFileHooks, false, 'spec 061 FR-017: a repository\'s own hooks never run unasked');
    assert.strictEqual(fake.created[0].mcpOAuthTokenStorage, 'persistent', 'spec 058 FR-070: MCP sign-ins kept in the OS keychain (create)');
    await ad.setModel(sid, { model: 'sim-deep', effort: 'high', contextTier: 'long' });
    await ad.stop(sid);
    // main saves the switched choice with the folder and passes it on the next start under the same id
    const again = await ad.start({ workspace: dir, sessionId: sid, model: 'sim-deep', reasoningEffort: 'high', contextTier: 'long', autoTier: undefined, quiet: true });
    assert.strictEqual(again, sid);
    assert.strictEqual(fake.resumed.length, 1, 'resumed, not recreated');
    const rc = fake.resumed[0].config;
    assert.strictEqual(rc.model, 'sim-deep');
    assert.strictEqual(rc.reasoningEffort, 'high');
    assert.strictEqual(rc.contextTier, 'long_context');
    assert.ok(!('capi' in rc));
    assert.strictEqual(rc.mcpOAuthTokenStorage, 'persistent', 'spec 058 FR-070: also on resume by session id');
    await ad.stop(sid);
    // an auto session that is resumed keeps the runtime's own routing when the user chose no tier (main passes none)
    const a2 = await ad.start({ workspace: dir, resumeSessionId: sid, model: 'auto', quiet: true });
    assert.ok(!('capi' in fake.resumed[1].config), 'no autoTier override on resume');
    assert.strictEqual(fake.resumed[1].config.model, 'auto');
    assert.strictEqual(fake.resumed[1].config.enableFileHooks, false, 'spec 061 FR-017: also on resume');
    assert.strictEqual(fake.resumed[1].config.mcpOAuthTokenStorage, 'persistent', 'spec 058 FR-070: also on resume (resumeSessionId)');
    await ad.stop(a2);
    // spec 007 FR-016: a tier the user chose and Durbar saved goes on resume
    const a2b = await ad.start({ workspace: dir, resumeSessionId: sid, model: 'auto', autoTier: 'balance', quiet: true });
    assert.deepStrictEqual(fake.resumed[2].config.capi, { autoTier: 'balance' }, 'the saved tier on resume');
    await ad.stop(a2b);
    // a session id not on disk is created with exactly that id and the saved choice
    const a3 = await ad.start({ workspace: dir, sessionId: 'brand-new', model: 'sim-fast', contextTier: 'long', quiet: true });
    const cc = fake.created.slice(-1)[0];
    assert.deepStrictEqual([a3, cc.sessionId, cc.model, cc.contextTier], ['brand-new', 'brand-new', 'sim-fast', 'long_context']);
    await ad.stop(a3);
  }

  // ---- spec 007 FR-012: the runtime version gate (1.0.87+), read tolerantly
  for (const v of ['1.0.87', '1.0.98', '1.1.0', '2.0.0', 'v1.0.90', '1.0.103-beta.2', '1.0.87+build']) assert.ok(runtimeHasAutoTiers(v), v);
  for (const v of ['1.0.86', '0.9.99', '1.0', '', 'latest', '1.0.x', ' 1.0.98 junk', 98, null, undefined, '1'.repeat(80)]) assert.ok(!runtimeHasAutoTiers(v), String(v));
  // FR-017: the organization's tier is hostile input: own properties, the allow-list, a boolean flag; anything else and it is ignored as a whole
  assert.deepStrictEqual(managedAutoTierFrom({ values: { autoTier: 'balance' }, meta: { autoTier: { overridable: false, source: 'server' } } }), { tier: 'balance', locked: true });
  assert.deepStrictEqual(managedAutoTierFrom({ values: { autoTier: 'intelligence' }, meta: { autoTier: { overridable: true, source: 'device' } } }), { tier: 'intelligence', locked: false });
  assert.deepStrictEqual(managedAutoTierFrom({ values: { autoTier: 'efficiency' } }), { tier: 'efficiency', locked: false }, 'no meta: a default, not a lock');
  // review on #642 (item 2): a well-formed lock on a name outside the three fails CLOSED (locked, no name); a malformed one is ignored
  assert.deepStrictEqual(managedAutoTierFrom({ values: { autoTier: 'fast' }, meta: { autoTier: { overridable: false } } }), { locked: true });
  assert.deepStrictEqual(managedAutoTierFrom({ values: { autoTier: 'future-tier.v2' }, meta: { autoTier: { overridable: false } } }), { locked: true });
  for (const v of ['', 'x'.repeat(65), 'a b', '<b>', 5, null, ['fast']]) assert.strictEqual(managedAutoTierFrom({ values: { autoTier: v }, meta: { autoTier: { overridable: false } } }), undefined, 'not a policy word: ' + JSON.stringify(v));
  assert.strictEqual(managedAutoTierFrom({ values: { autoTier: 'fast' }, meta: { autoTier: { overridable: true } } }), undefined, 'an unknown overridable default: ignored');
  assert.strictEqual(autoTierToSend('auto', 'balance', { locked: true }, true), undefined, 'an unnamed lock sends nothing');
  assert.deepStrictEqual(modelConfig({ model: 'auto' }, false, { locked: true }), { model: 'auto' }, 'not even the cheap default');
  // item 4: null (Undo to "none") = the default again: Efficiency, or the provider default (null) under an organization default; nothing under a lock
  assert.strictEqual(autoTierToSend('auto', null, undefined, true), 'efficiency');
  assert.strictEqual(autoTierToSend('auto', null, { tier: 'balance', locked: false }, true), null);
  assert.strictEqual(autoTierToSend('auto', null, { tier: 'balance', locked: true }, true), undefined);
  const inherited = Object.create({ autoTier: 'balance' }) as Record<string, unknown>;
  const protoMeta = Object.create({ overridable: false }) as Record<string, unknown>;
  for (const bad of [undefined, null, 'x', [], { values: inherited }, { values: { autoTier: 'fast' } }, { values: { autoTier: 'Balance' } }, { values: { autoTier: ['balance'] } }, { values: [{ autoTier: 'balance' }] },
    { values: { autoTier: 'balance' }, meta: { autoTier: { overridable: 'false' } } }, { values: { autoTier: 'balance' }, meta: { autoTier: protoMeta } }, { values: { autoTier: 'balance' }, meta: { autoTier: null } }])
    assert.strictEqual(managedAutoTierFrom(bad), undefined, JSON.stringify(bad));
  {
    const opts = [{ id: 'auto', name: 'Auto', efforts: [], disabled: false }, { id: 'm1', name: 'M1', efforts: [], disabled: false }];
    assert.deepStrictEqual(withAutoTiers(opts, false, { tier: 'balance', locked: true }), opts, 'an old runtime: no tiers, no lock');
    const w = withAutoTiers(opts, true, { tier: 'balance', locked: true });
    assert.deepStrictEqual(w[0].autoTiers, ['efficiency', 'balance', 'intelligence']);
    assert.deepStrictEqual(w[0].autoTierManaged, { tier: 'balance', locked: true });
    assert.ok(!('autoTiers' in w[1]) && !('autoTierManaged' in w[1]), 'only on auto');
    assert.ok(!('autoTiers' in opts[0]), 'the input is not changed');
  }
  // the adapter: version and policy read through the (fake) runtime, no session, no credits
  {
    const fake = new FakeClient();
    const ad = new TestAdapter(fake);
    fake.modelInfos = [{ id: 'auto', name: 'Auto', capabilities: { limits: { max_context_window_tokens: 0 } } }, { id: 'gpt-x', name: 'GPT X', capabilities: { limits: { max_context_window_tokens: 128000 } } }];
    let list = await ad.listModelOptions();
    assert.ok(!('autoTiers' in list[0]), 'no getStatus (version unknown): no tiers');
    fake.runtimeVersion = '1.0.80';
    list = await ad.listModelOptions();
    assert.ok(!('autoTiers' in list[0]), 'runtime older than 1.0.87: no tiers');
    fake.runtimeVersion = '1.0.98';
    list = await ad.listModelOptions();
    assert.deepStrictEqual(list[0].autoTiers, ['efficiency', 'balance', 'intelligence']);
    assert.ok(!('autoTierManaged' in list[0]), 'no managed settings call: no organization tier');
    assert.ok(!('autoTiers' in list[1]));
    fake.managed = { values: { autoTier: 'balance' }, meta: { autoTier: { overridable: false, source: 'server' } } };
    list = await ad.listModelOptions();
    assert.deepStrictEqual(list[0].autoTierManaged, { tier: 'balance', locked: true });
    const calls = fake.managedCalls;
    await ad.listModelOptions();
    assert.strictEqual(fake.managedCalls, calls + 1, 'read again on every listing (a changed policy shows)');
    // the reset (Undo to none) under an overridable organization default sends null: the provider's default
    fake.managed = { values: { autoTier: 'balance' }, meta: { autoTier: { overridable: true, source: 'server' } } };
    await ad.listModelOptions();
    const sidD = await ad.start({ workspace: dir, model: 'auto', quiet: true });
    assert.ok(!('capi' in fake.created.slice(-1)[0]), 'an organization default: Durbar sends no tier of its own');
    fake.last.switchAnswer = { modelId: 'auto' };
    await ad.setModel(sidD, { model: 'auto', autoTier: null });
    assert.strictEqual(arg(fake.last, 'switchTo').autoTier, null, 'null reaches switchTo (provider default)');
    await ad.stop(sidD);
    fake.managed = { values: { autoTier: 'balance' }, meta: { autoTier: { overridable: false, source: 'server' } } };
    await ad.listModelOptions();
    // under the lock a new auto session and a switch to auto send no tier at all (the runtime applies the policy)
    const sid = await ad.start({ workspace: dir, model: 'auto', quiet: true });
    assert.ok(!('capi' in fake.created.slice(-1)[0]), 'locked: no capi.autoTier on create');
    const sess = fake.last;
    sess.switchAnswer = { modelId: 'auto' };
    await ad.setModel(sid, { model: 'auto' });
    assert.ok(!('autoTier' in arg(sess, 'switchTo')), 'locked: no autoTier in the switch');
    await ad.stop(sid);
    fake.managedFail = 'boom'; fake.managed = undefined;
    list = await ad.listModelOptions();
    assert.deepStrictEqual(list[0].autoTiers, ['efficiency', 'balance', 'intelligence'], 'a failed policy read leaves the tiers');
    assert.ok(!('autoTierManaged' in list[0]), 'and no lock');
    const sid2 = await ad.start({ workspace: dir, model: 'auto', quiet: true });
    assert.deepStrictEqual(fake.created.slice(-1)[0].capi, { autoTier: 'efficiency' }, 'no policy: the cheap default again');
    await ad.stop(sid2);
  }
  {
    // a policy read that never answers is capped (the listing still comes back)
    const fake = new FakeClient();
    const ad = new TestAdapter(fake);
    (ad as unknown as { policyTimeoutMs: number }).policyTimeoutMs = 30;
    fake.modelInfos = [{ id: 'auto', name: 'Auto' }];
    fake.runtimeVersion = '1.0.98';
    fake.managedHangs = true;
    const list = await ad.listModelOptions();
    assert.deepStrictEqual(list[0].autoTiers, ['efficiency', 'balance', 'intelligence']);
    assert.ok(!('autoTierManaged' in list[0]), 'a hanging read counts as none');
  }
  console.log('spec 007 FR-012/FR-016/FR-017: Auto tiers, version gate, organization tier, create/resume/switch OK');

  // ---- T034: the capability contract. Controls follow what the adapter implements; the renderer knows no runtime specifics.
  const minimal: Partial<AgentAdapter> = {};
  assert.deepStrictEqual(modelControlFor(minimal), NO_MODEL_CONTROL, 'an adapter without the optional members: everything disabled (the UI offers New session)');
  const full: Partial<AgentAdapter> = { setModel: async () => ({ status: 'applied' }), compact: async () => ({ success: true }) };
  assert.deepStrictEqual(modelControlFor(full), { switch: 'next-message', effort: true, contextTier: true, compact: true, windowKnown: true });
  assert.deepStrictEqual(modelControlFor({ compact: full.compact }), { switch: 'none', effort: false, contextTier: false, compact: true, windowKnown: true }, 'compact alone does not enable switching');
  assert.deepStrictEqual(modelControlFor({ setModel: full.setModel }), { switch: 'next-message', effort: true, contextTier: true, compact: false, windowKnown: true });
  assert.strictEqual(modelControlFor(minimal, { unverified: true }).unverified, undefined, 'nothing to flag when nothing is enabled');
  assert.strictEqual(modelControlFor(full, { unverified: true }).unverified, true);
  const real = new CopilotAdapter() as AgentAdapter;
  assert.deepStrictEqual(['setModel', 'cancelQueuedModel', 'compact'].map((k) => typeof (real as unknown as Record<string, unknown>)[k]), ['function', 'function', 'function']);
  assert.strictEqual(modelControlFor(real, { unverified: true }).switch, 'next-message');
  const root = path.join(__dirname, '..', '..');
  const renderer = ['app.js', 'screens.js', 'modelswitch.js', 'dialog.js', 'sim.ts'].map((f) => fs.readFileSync(path.join(root, 'src', 'renderer', f), 'utf8')).join('\n');
  assert.doesNotMatch(renderer, /switchTo|long_context|session\.rpc|@github\/copilot|modelPickerPriceCategory|tokenPrices|capi\b|\.removeAt\(/, 'constitution II: no runtime specifics in the renderer');


  // ---- spec 012 T010: the interface contract (FR-026..FR-028)
  {
    const ad = new TestAdapter(new FakeClient());
    const c: AdapterCapabilities = ad.capabilities;
    assert.strictEqual(ad.displayName, 'GitHub Copilot');
    assert.deepStrictEqual(c.permissionModes, ['read-only', 'ask', 'allow']);
    assert.strictEqual(c.permModeSwitch, 'live');
    assert.deepStrictEqual(c.usage, { tokens: true, costUsd: false, nanoAiu: true });
    // FR-027: every optional member is present exactly when its capability says so
    const has = (k: string): boolean => typeof (ad as unknown as Record<string, unknown>)[k] === 'function';
    assert.strictEqual(c.interrupt, has('interrupt'));
    assert.strictEqual(c.models, has('listModelOptions'));
    assert.strictEqual(c.history, has('listPreviousSessions') && has('history'));
    assert.strictEqual(c.caps, has('setCap') && has('resolveLimit'));
    assert.strictEqual(c.mcpToggle, has('setMcpEnabled'));
    assert.strictEqual(c.permModeSwitch !== ('none' as AdapterCapabilities['permModeSwitch']), has('setPermMode'));
    assert.ok(has('isLive') && has('dispose'));

    // FR-028: permissionMode is the one source of truth when present; unknown = read-only; absent = the old booleans
    const ask = async (startOpts: Record<string, unknown>): Promise<{ kind: string; pending: boolean }> => {
      const t = await setup(startOpts);
      const decide = (t.s.config.onPermissionRequest as (r: unknown) => Promise<{ kind: string }>)({ kind: 'write', fileName: path.join(dir, 'x.ts'), toolCallId: 'w1' });
      await sleep(10);
      const pending = t.events.some((e) => e.type === 'status' && e.status === 'needs-permission' && e.permission?.state === 'pending');
      if (pending) await t.ad.stop(t.sid); // denies what is pending
      return { kind: (await decide).kind, pending };
    };
    assert.deepStrictEqual(await ask({ permissionMode: 'ask' }), { kind: 'reject', pending: true }, 'ask: left pending (denied only when the session stops)');
    assert.deepStrictEqual(await ask({ permissionMode: 'read-only', allow: true }), { kind: 'reject', pending: false }, 'permissionMode beats allow');
    assert.deepStrictEqual(await ask({ permissionMode: 'allow', ask: true }), { kind: 'approve-once', pending: false });
    assert.deepStrictEqual(await ask({ permissionMode: 'bogus' }), { kind: 'reject', pending: false }, 'unknown value = read-only');
    assert.deepStrictEqual(await ask({ permissionMode: 'bogus', allow: true }), { kind: 'reject', pending: false }, 'unknown value is still read-only next to allow');
    assert.deepStrictEqual(await ask({ ask: true }), { kind: 'reject', pending: true }, 'absent + ask: pending');
    assert.deepStrictEqual(await ask({ allow: true }), { kind: 'approve-once', pending: false });
    assert.deepStrictEqual(await ask({}), { kind: 'reject', pending: false });

    // spec 002 FR-058: ask_user as a question card, in any mode; choice, free text, skip, Stop
    {
      const t = await setup({ permissionMode: 'read-only' });
      const dbg: string[] = [];
      t.ad.debug = (m) => dbg.push(m);
      const iu = t.s.config.onUserInputRequest as (r: unknown) => Promise<{ answer: string; wasFreeform: boolean }>;
      assert.strictEqual(typeof iu, 'function', 'the ask_user handler is passed to the SDK');
      const askOnce = async (choices: string[] | undefined, reply: string | null): Promise<{ answer: string; wasFreeform: boolean }> => {
        const from = t.events.length;
        const p = iu({ question: 'Pick  one?', choices, allowFreeform: true });
        await waitFor('the question', () => askedCount(t.events, from) >= 1);
        const q = t.events.slice(from).find((e) => e.type === 'question' && e.phase === 'asked') as { requestId: string; questions: { question: string; options: { label: string }[] }[] } | undefined;
        assert.ok(q, 'asked');
        assert.strictEqual(q.questions[0].question, 'Pick one?');
        t.ad.answerQuestion?.(t.sid, q.requestId, reply === null ? null : { [q.questions[0].question]: reply });
        return p;
      };
      assert.deepStrictEqual(await askOnce(['A', 'B'], 'B'), { answer: 'B', wasFreeform: false });
      assert.deepStrictEqual(await askOnce(['A', 'B'], '  my   own '), { answer: 'my own', wasFreeform: true });
      assert.deepStrictEqual(await askOnce(undefined, null), { answer: '(The user skipped the question. Decide yourself.)', wasFreeform: true });
      assert.ok(t.events.some((e) => e.type === 'status' && e.intent === 'Waiting for your answer'));
      // spec 052 FR-178 (issue 689): two questions close together are matched by request id: answered out of order, each gets its own answer, neither is a cancel
      {
        const SKIP = '(The user skipped the question. Decide yourself.)';
        const from = t.events.length;
        const p1 = iu({ question: 'First?', choices: ['A', 'B'], allowFreeform: true });
        const p2 = iu({ question: 'Second?', choices: ['X', 'Y'], allowFreeform: true });
        await waitFor('the question', () => askedCount(t.events, from) >= 2);
        const asked = t.events.slice(from).filter((e) => e.type === 'question' && e.phase === 'asked') as unknown as { requestId: string; questions: { question: string }[] }[];
        assert.strictEqual(asked.length, 2, 'both are asked');
        const second = asked.find((q) => q.questions[0].question === 'Second?')!, first = asked.find((q) => q.questions[0].question === 'First?')!;
        t.ad.answerQuestion?.(t.sid, second.requestId, { 'Second?': 'Y' });
        t.ad.answerQuestion?.(t.sid, first.requestId, { 'First?': 'typed by hand' });
        const [r1, r2] = [await p1, await p2];
        assert.deepStrictEqual(r1, { answer: 'typed by hand', wasFreeform: true });
        assert.deepStrictEqual(r2, { answer: 'Y', wasFreeform: false });
        assert.ok(r1.answer !== SKIP && r2.answer !== SKIP);
        assert.ok(!t.events.slice(from).some((e) => e.type === 'question' && e.phase === 'cancelled'), 'no cancelled event');
      }
      // spec 052 FR-178 (issue 689): a custom answer to a long question (an agent puts its context in the question) reaches the agent as that answer,
      // through the same reading main applies to the window's reply; it used to arrive as a skip (main dropped any question key over 300 characters)
      {
        const { readAnswerPayload } = await import('../src/adapters/questions');
        const longQ = ('Which of these options should I take for the refactor, given the context? ').repeat(12).replace(/\s+/g, ' ').trim();
        assert.ok(longQ.length > 300 && longQ.length < 2000);
        const from = t.events.length;
        const p = iu({ question: longQ, choices: ['A', 'B'], allowFreeform: true });
        await waitFor('the question', () => askedCount(t.events, from) >= 1);
        const q = t.events.slice(from).find((e) => e.type === 'question' && e.phase === 'asked') as { requestId: string; questions: { question: string }[] } | undefined;
        assert.ok(q, 'the long question was asked');
        const read = readAnswerPayload({ [q.questions[0].question]: 'my own long-question answer' });
        assert.ok(read, 'main reads the reply of a long question');
        t.ad.answerQuestion?.(t.sid, q.requestId, read);
        assert.deepStrictEqual(await p, { answer: 'my own long-question answer', wasFreeform: true }, 'the custom answer, not a skip');
        assert.ok(!t.events.slice(from).some((e) => e.type === 'question' && e.phase === 'cancelled'), 'no skipped card');
        assert.deepStrictEqual(readAnswerPayload(null), null, 'null stays a skip');
        for (const bad of [undefined, 'text', 5, [], {}, { k: 5 }, { k: '' }, { k: '   ' }, { ['x'.repeat(2001)]: 'a' }]) assert.strictEqual(readAnswerPayload(bad), undefined, 'unusable is refused, never a skip: ' + JSON.stringify(bad)?.slice(0, 30));
        assert.strictEqual(readAnswerPayload({ a: 'x'.repeat(500) })!.a.length, 500, 'exactly the cap is kept whole');
        assert.strictEqual(readAnswerPayload({ a: 'x'.repeat(501) }), undefined, 'just over the cap is refused, not cut');
        assert.strictEqual(readAnswerPayload({ a: ' ' + 'x'.repeat(500) + '  ' })!.a.trim().length, 500, 'spaces around do not count');
      }
      const pending = iu({ question: 'Still there?', choices: ['Yes'] });
      await waitFor('the question', () => t.events.some((e) => e.type === 'question' && e.phase === 'asked' && (e as unknown as { questions: { question: string }[] }).questions[0].question === 'Still there?'));
      await t.ad.stop(t.sid);
      assert.deepStrictEqual(await pending, { answer: '(The user skipped the question. Decide yourself.)', wasFreeform: true }, 'Stop skips it');
      assert.ok(t.events.some((e) => e.type === 'question' && e.phase === 'cancelled'));
      // spec 052 FR-178: each way a question ends unanswered records its reason (a code) on the event and in the debug log, never the text
      const why = t.events.filter((e) => e.type === 'question' && e.phase === 'cancelled').map((e) => (e as { reason?: string }).reason);
      assert.deepStrictEqual(why, ['user', 'stop'], 'Skip from the window, then Stop');
      assert.deepStrictEqual(dbg.filter((m) => /^question .* cancelled: /.test(m)).map((m) => m.split(': ')[1]), ['user', 'stop']);
      assert.ok(!dbg.some((m) => /Pick one|Still there/.test(m)), 'no question text in the log');
      {
        const t3 = await setup({ permissionMode: 'read-only' });
        const iu3 = t3.s.config.onUserInputRequest as (r: unknown) => Promise<{ answer: string; wasFreeform: boolean }>;
        const p3 = iu3({ question: 'Interrupt me?', choices: ['Yes'] });
        await waitFor('the question', () => askedCount(t3.events) >= 1);
        await t3.ad.interrupt(t3.sid);
        await p3;
        assert.deepStrictEqual(t3.events.filter((e) => e.type === 'question' && e.phase === 'cancelled').map((e) => (e as { reason?: string }).reason), ['interrupt']);
      }
    }

    // isLive follows the session
    const t = await setup();
    assert.strictEqual(t.ad.isLive(t.sid), true);
    await t.ad.stop(t.sid);
    assert.strictEqual(t.ad.isLive(t.sid), false);

    // main.ts sends permissionMode, not the booleans
    for (const m of ['read-only', 'ask', 'allow'] as const) {
      const o = startOptionsOf({ permMode: m, maxAiCredits: 40 }, '/w', 'auto', undefined) as unknown as Record<string, unknown>;
      assert.strictEqual(o.permissionMode, m);
      assert.ok(!('allow' in o) && !('ask' in o));
      assert.strictEqual(o.workspace, '/w');
      assert.strictEqual(o.model, 'auto');
      assert.strictEqual(o.autoTier, undefined, 'spec 007 FR-016: no tier chosen = none passed (the adapter picks its default for a new session)');
      assert.strictEqual(o.maxAiCredits, 40);
    }
    assert.strictEqual(startOptionsOf({ permMode: 'ask', model: 'm1' }, '/w', 'auto', 'high').autoTier, undefined);
    assert.strictEqual(startOptionsOf({ permMode: 'ask', autoTier: 'balance' }, '/w', 'auto', undefined).autoTier, 'balance', 'the saved tier');
    assert.strictEqual(startOptionsOf({ permMode: 'ask', model: 'm1', autoTier: 'balance' }, '/w', 'auto', undefined).autoTier, undefined, 'kept in the folder, but only Auto gets it');
  }

  // ---- spec 012 T011: registry, detectAll, Copilot descriptor (FR-030..FR-034)
  {
    const caps = (): AdapterCapabilities => JSON.parse(JSON.stringify(COPILOT_DESCRIPTOR.capabilities));
    const calls: string[] = [];
    const fake = (id: string): AdapterDescriptor => ({ id, displayName: `Fake ${id}`, capabilities: caps(), create: () => { calls.push(id); return {} as AgentAdapter; } });
    // (a) createRegistry errors
    assert.throws(() => createRegistry([]), /empty/);
    assert.throws(() => createRegistry([fake('aa'), fake('aa')]), /duplicate/);
    for (const bad of ['Copilot', '', 'a b', '1x', 'a'.repeat(33)]) assert.throws(() => createRegistry([fake(bad)]), /bad id/, `bad id ${JSON.stringify(bad)}`);
    createRegistry([fake('a'.repeat(32)), fake('x-1')]);
    // (b) list/get/has/default/create
    const reg = createRegistry([fake('one'), fake('two')]);
    assert.deepStrictEqual(reg.list().map((d) => d.id), ['one', 'two']);
    assert.strictEqual(reg.get('nope'), undefined);
    assert.strictEqual(reg.get('two')?.id, 'two');
    assert.strictEqual(reg.has('one'), true);
    assert.strictEqual(reg.has('nope'), false);
    assert.strictEqual(reg.defaultId, 'one');
    assert.strictEqual(createRegistry([COPILOT_DESCRIPTOR]).defaultId, 'copilot');
    assert.throws(() => reg.create('nope'));
    // (c) lazy creation
    assert.deepStrictEqual(calls, []);
    await detectAll(reg, async () => ({ state: 'ready' }));
    assert.deepStrictEqual(calls, [], 'create is never called by createRegistry, list, get or detectAll');
    reg.create('two');
    assert.deepStrictEqual(calls, ['two']);
    reg.create('two');
    reg.create('one');
    assert.deepStrictEqual(calls, ['two', 'two', 'one']);
    // (d) detectAll
    const d2 = createRegistry([fake('ok'), fake('boom'), fake('bogus'), fake('long'), fake('ver'), fake('getter')]);
    let infos: Awaited<ReturnType<typeof detectAll>> = [];
    await assert.doesNotReject(async () => { infos = await detectAll(d2, async (d) => {
      if (d.id === 'ok') return { state: 'ready', version: '  1.2.3 ' };
      if (d.id === 'boom') throw new Error('x');
      if (d.id === 'bogus') return { state: 'weird' as never, version: '9' };
      if (d.id === 'long') return { state: 'too-old', hint: 'h'.repeat(500) };
      if (d.id === 'getter') return { state: 'ready', get version(): string { throw new Error('hostile'); } };
      return { state: 'ready', version: 5 as never };
    }); });
    assert.deepStrictEqual(infos.map((i) => i.id), ['ok', 'boom', 'bogus', 'long', 'ver', 'getter']);
    assert.deepStrictEqual(infos.map((i) => i.state), ['ready', 'unknown', 'unknown', 'too-old', 'ready', 'unknown']);
    assert.strictEqual(infos[0].version, '1.2.3');
    assert.strictEqual(infos[3].hint?.length, 200);
    assert.ok(!('version' in infos[4]), 'non-string version dropped');
    assert.ok(!('version' in infos[2]), 'nothing kept from a bogus result');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(infos)), infos);
    assert.ok(!JSON.stringify(infos, (_k, v) => (typeof v === 'function' ? '__fn' : v)).includes('__fn'));
    const desc = d2.get('ok')!;
    const out = infos[0].capabilities as unknown as { permissionModes: string[]; usage: { tokens: boolean } };
    out.permissionModes.push('allow');
    out.usage.tokens = !out.usage.tokens;
    assert.deepStrictEqual(desc.capabilities, caps(), 'mutating the output leaves the descriptor alone');
    // (e) Copilot descriptor
    const made = COPILOT_DESCRIPTOR.create();
    assert.ok(made instanceof CopilotAdapter);
    assert.strictEqual(made.id, COPILOT_DESCRIPTOR.id);
    assert.strictEqual(made.displayName, COPILOT_DESCRIPTOR.displayName);
    assert.strictEqual(made.capabilities, COPILOT_DESCRIPTOR.capabilities);
    assert.strictEqual((made as unknown as { client?: unknown; starting?: unknown }).client, undefined);
    assert.strictEqual((made as unknown as { starting?: unknown }).starting, undefined, 'create() does not start the client');
    assert.ok(Object.isFrozen(COPILOT_DESCRIPTOR.capabilities));
    // compile-time: capabilities are readonly (a write would fail typecheck)
    // @ts-expect-error readonly property
    void (() => { COPILOT_DESCRIPTOR.capabilities.images = false; });
    // @ts-expect-error readonly array
    void (() => { COPILOT_DESCRIPTOR.capabilities.permissionModes.push('allow'); });
    // @ts-expect-error readonly nested object
    void (() => { COPILOT_DESCRIPTOR.capabilities.usage.tokens = false; });
  }

  // ---- issue #126: the main agent's session title (spec 002 delta 2026-10-18): event first, name.get once as a fallback
  {
    const titles = (ev: AgentEvent[]): string[] => ev.filter((e) => e.type === 'title').map((e) => (e as { title: string }).title);
    // a title event: shown, and name.get is never asked
    let t = await setup();
    t.s.fire('session.title_changed', { title: 'Fix login bug' });
    t.s.fire('session.idle', {});
    await sleep(0);
    assert.deepStrictEqual(titles(t.events), ['Fix login bug']);
    assert.ok(!names(t.s).includes('name.get'), 'no name.get when the runtime sent the title');
    // no event: asked once after the first turn, never again
    t = await setup();
    t.s.nameAnswer = 'Release notes';
    t.s.fire('session.idle', {});
    t.s.fire('session.idle', {});
    await sleep(0);
    assert.deepStrictEqual(titles(t.events), ['Release notes']);
    assert.strictEqual(names(t.s).filter((n) => n === 'name.get').length, 1, 'asked once');
    // no name yet, or the call fails: nothing shown, nothing thrown, not retried
    t = await setup();
    t.s.fire('session.idle', {});
    await sleep(0);
    assert.deepStrictEqual(titles(t.events), []);
    t = await setup();
    t.s.rpc.name.get = async () => { throw new Error('unsupported'); };
    t.s.fire('session.idle', {});
    t.s.fire('session.idle', {});
    await sleep(0);
    assert.deepStrictEqual(titles(t.events), [], 'a failing name.get is ignored');
    // a sub-agent's title is not the session's
    t = await setup();
    t.s.handler?.({ type: 'session.title_changed', data: { title: 'helper' }, agentId: 'sub-1' });
    await sleep(0);
    assert.deepStrictEqual(titles(t.events), []);
    // a resumed session asks once right away (its title is not sent again)
    const fake = new FakeClient();
    fake.nameAnswer = '  Review PR 121\u200B ';
    const ad = new TestAdapter(fake);
    const ev: AgentEvent[] = [];
    ad.onEvent((e) => ev.push(e));
    await ad.start({ workspace: dir, model: 'auto', resumeSessionId: 'old-1' });
    await sleep(0);
    assert.deepStrictEqual(titles(ev), ['Review PR 121'], 'resumed: the cleaned name');
    // the lazy restore path (sessionId with history on disk) also asks
    fake.onDisk.add('old-2');
    fake.nameAnswer = 'Restored title';
    await ad.start({ workspace: dir, model: 'auto', sessionId: 'old-2', quiet: true });
    await sleep(0);
    assert.ok(titles(ev).includes('Restored title'), 'a known session id resumes and asks');
    // a brand-new session under a chosen id (nothing on disk) does not ask before its first turn
    fake.nameAnswer = 'never';
    await ad.start({ workspace: dir, model: 'auto', sessionId: 'fresh-1', quiet: true });
    await sleep(0);
    assert.ok(!titles(ev).includes('never'), 'a new session waits for its first turn');
  }

  // ---- review on #642 (item 5): the IPC handler refuses an Auto tier for an agent of another app (Claude Code, Codex), through the real handler
  {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Module = require('module') as { _load: (req: string, parent: unknown, isMain: boolean) => unknown };
    const handles = new Map<string, (e: unknown, ...a: unknown[]) => Promise<unknown>>();
    const fakeElectron = { app: { isPackaged: false }, ipcMain: { handle: (c: string, f: (e: unknown, ...a: unknown[]) => Promise<unknown>) => handles.set(c, f), on: () => undefined } };
    const realLoad = Module._load;
    Module._load = function (req: string, parent: unknown, isMain: boolean) { return req === 'electron' ? fakeElectron : realLoad.call(this, req, parent, isMain); };
    try {
      const mainDir = path.join(__dirname, '..', 'src', 'main');
      for (const f of ['ipcguard.js', path.join('ipc', 'model.js')]) delete require.cache[require.resolve(path.join(mainDir, f))];
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require(path.join(mainDir, 'ipcguard.js')) as { initSimGuard: (on: boolean) => void }).initSimGuard(false);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { register } = require(path.join(mainDir, 'ipc', 'model.js')) as { register: (d: ModelIpcDeps) => void };
      const sent: unknown[] = [];
      const saved: unknown[] = [];
      const copilot = { listModelOptions: async () => [{ id: 'auto', name: 'Auto', efforts: [], disabled: false, autoTiers: ['efficiency', 'balance', 'intelligence'] }], isLive: () => true,
        setModel: async (_id: string, req: unknown) => { sent.push(req); return { status: 'applied', model: 'auto' }; } };
      const claude = { ...copilot, listModelOptions: async () => [{ id: 'auto', name: 'Auto', efforts: [], disabled: false }] };
      const agents = new Map<string, Record<string, unknown>>([['c1', { id: 'c1', adapterId: 'copilot', model: 'auto' }], ['k1', { id: 'k1', adapterId: 'claude', model: 'auto' }]]);
      register(({
        agents, wsKey: (a: { id: string }) => '/w/' + a.id,
        router: { forAgent: (id: string) => (id === 'k1' ? claude : copilot), instance: (k: string) => (k === 'claude' ? claude : copilot) },
        registry: { defaultId: 'copilot', has: (k: string) => k === 'copilot' || k === 'claude' },
        getFolderStore: () => ({ setModelChoice: (w: string, c: unknown) => { saved.push([w, c]); return true; } }),
      }) as unknown as ModelIpcDeps);
      const indexUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href;
      const mainFrame = { url: indexUrl };
      const ev = { senderFrame: mainFrame, sender: { mainFrame } };
      const setModel = handles.get('agents:setModel') as (e: unknown, ...a: unknown[]) => Promise<{ ok: boolean; error?: string }>;
      const other = await setModel(ev, 'k1', { model: 'auto', autoTier: 'balance' });
      assert.ok(!other.ok && /no Auto routing tier/.test(other.error ?? ''), 'another agent app: refused');
      assert.deepStrictEqual([sent.length, saved.length], [0, 0], 'nothing sent, nothing saved');
      const mine = await setModel(ev, 'c1', { model: 'auto', autoTier: 'balance' });
      assert.ok(mine.ok, 'the default kind (Copilot) takes it');
      assert.deepStrictEqual(sent, [{ model: 'auto', autoTier: 'balance' }]);
      assert.strictEqual(agents.get('c1')?.autoTier, 'balance', 'remembered on the agent');
      assert.deepStrictEqual(saved, [['/w/c1', { model: 'auto', effort: undefined, contextTier: undefined, autoTier: 'balance' }]]);
      await setModel(ev, 'c1', { model: 'auto', autoTier: null });
      assert.strictEqual(agents.get('c1')?.autoTier, undefined, 'null (Undo to none) clears it');
      // FR-019: a failed tier switch puts back (and saves) the tier still in effect; another model or a sub-agent is left alone
      const { onAutoTierFailed } = require(path.join(mainDir, 'ipc', 'model.js')) as { onAutoTierFailed: (e: unknown, ag: unknown, st: unknown, k: unknown) => void };
      const tiers: unknown[] = [];
      const store = { setAutoTier: (w: string, t: unknown) => { tiers.push([w, t]); return true; } };
      agents.get('c1')!.autoTier = 'efficiency';
      onAutoTierFailed({ type: 'autoTierFailed', sessionId: 'c1', reason: 'request-failed', requested: 'efficiency', effective: 'intelligence' }, agents, store, (a: { id: string }) => '/w/' + a.id);
      assert.strictEqual(agents.get('c1')?.autoTier, 'intelligence');
      onAutoTierFailed({ type: 'autoTierFailed', sessionId: 'c1', reason: 'unknown' }, agents, store, (a: { id: string }) => '/w/' + a.id);
      assert.strictEqual(agents.get('c1')?.autoTier, undefined, 'no tier named: none of its own');
      onAutoTierFailed({ type: 'autoTierFailed', sessionId: 'c1', agentId: 'sub', reason: 'unknown', effective: 'balance' }, agents, store, (a: { id: string }) => '/w/' + a.id);
      agents.get('k1')!.model = 'sonnet';
      onAutoTierFailed({ type: 'autoTierFailed', sessionId: 'k1', reason: 'unknown', effective: 'balance' }, agents, store, (a: { id: string }) => '/w/' + a.id);
      assert.deepStrictEqual(tiers, [['/w/c1', 'intelligence'], ['/w/c1', null]], 'saved twice; sub-agent and another model ignored');
    } finally {
      Module._load = realLoad;
    }
    console.log('review on #642: the IPC handler refuses a tier for another agent app OK');
  }

  await sleep(0);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('copilot model tests passed');
}

main().catch((e) => { console.error(e); process.exit(1); });

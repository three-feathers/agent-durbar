/**
 * Spec 030 Phase 2 (T030-T034): the Copilot adapter's model switching, compaction, resume config, pricing mapping and the capability contract,
 * all against a FAKE client and session. No runtime process, no Copilot account, no credits. What the real runtime does is NOT tested here
 * (it is spec 030 Phase 3, T040..T046): these tests pin what the adapter SENDS and how it maps whatever comes back.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CopilotAdapter, COPILOT_DESCRIPTOR } from '../src/adapters/copilot';
import { createRegistry, detectAll } from '../src/adapters/registry';
import type { AdapterDescriptor } from '../src/adapters/capabilities';
import { EventMapper } from '../src/adapters/map';
import type { RawEvent } from '../src/adapters/map';
import { compactResultFrom, modelConfig, runtimeMessage, modelOptionFrom, priceClassOf, pricingFromTokenPrices, switchResultFrom } from '../src/adapters/copilotmodel';
import type { AdapterCapabilities, AgentAdapter, AgentEvent } from '../src/adapters/types';
import { modelControlFor, NO_MODEL_CONTROL } from '../src/shared/modelswitch';
import { startOptionsOf } from '../src/main/startopts';

type Call = { name: string; args: unknown[] };

/** A session that records every call and answers from a script. */
class FakeSession {
  calls: Call[] = [];
  handler: ((ev: unknown) => void) | undefined;
  processing = false;
  switchAnswer: unknown = { modelId: 'sim-deep' };
  compactAnswer: unknown = { success: true, tokensRemoved: 5000, messagesRemoved: 4, contextWindow: { tokenLimit: 100000, currentTokens: 12000, messagesLength: 3 } };
  removed = true;
  constructor(public sessionId: string, public config: Record<string, unknown>) {}
  private rec<T>(name: string, v: T, ...args: unknown[]): T { this.calls.push({ name, args }); return v; }
  on(h: (ev: unknown) => void): () => void { this.handler = h; return () => { this.handler = undefined; }; }
  fire(type: string, data: Record<string, unknown>): void { this.handler?.({ type, data }); }
  abort = async (): Promise<void> => this.rec('abort', undefined);
  disconnect = async (): Promise<void> => this.rec('disconnect', undefined);
  rpc = {
    eventLog: { registerInterest: async (a: unknown) => this.rec('registerInterest', undefined, a) },
    options: { update: async (a: unknown) => this.rec('options.update', undefined, a) },
    model: { switchTo: async (a: unknown) => this.rec('switchTo', this.switchAnswer, a) },
    queue: { removeAt: async (a: unknown) => this.rec('removeAt', { removed: this.removed }, a) },
    history: { compact: async (a: unknown) => this.rec('compact', this.compactAnswer, a) },
    metadata: { isProcessing: async () => this.rec('isProcessing', { processing: this.processing }) },
  };
}

class FakeClient {
  created: Array<Record<string, unknown>> = [];
  resumed: Array<{ id: string; config: Record<string, unknown> }> = [];
  onDisk = new Set<string>();
  last!: FakeSession;
  n = 0;
  async createSession(config: Record<string, unknown>): Promise<FakeSession> {
    this.created.push(config);
    this.last = new FakeSession((config.sessionId as string) ?? 'fake-' + ++this.n, config);
    this.onDisk.add(this.last.sessionId);
    return this.last;
  }
  async resumeSession(id: string, config: Record<string, unknown>): Promise<FakeSession> {
    this.resumed.push({ id, config });
    this.last = new FakeSession(id, config);
    return this.last;
  }
  async getSessionMetadata(id: string): Promise<unknown> { return this.onDisk.has(id) ? { sessionId: id } : undefined; }
  async listModels(): Promise<unknown[]> { return []; }
}

class TestAdapter extends CopilotAdapter {
  constructor(public fake: FakeClient) { super(); }
  protected async getClient(): Promise<never> { return this.fake as never; }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
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
  // ---- T033: pricing mapping is tolerant, scaled per million tokens and always marked unverified
  assert.strictEqual(pricingFromTokenPrices(undefined), undefined);
  assert.strictEqual(pricingFromTokenPrices({}), undefined);
  assert.strictEqual(pricingFromTokenPrices({ inputPrice: 3, outputPrice: 15 }), undefined, 'no batch size: nothing is guessed');
  assert.strictEqual(pricingFromTokenPrices({ batchSize: 0, inputPrice: 3 }), undefined);
  assert.strictEqual(pricingFromTokenPrices({ batchSize: 1000, inputPrice: 'x' as unknown as number }), undefined);
  assert.deepStrictEqual(pricingFromTokenPrices({ batchSize: 1000, inputPrice: 3, outputPrice: 15, cacheReadPrice: 0.3 }), { inputPerMTok: 3000, outputPerMTok: 15000, cachedPerMTok: 300, unverified: true });
  const onlyIn = pricingFromTokenPrices({ batchSize: 1e6, inputPrice: 2 });
  assert.deepStrictEqual(onlyIn, { inputPerMTok: 2, outputPerMTok: undefined, cachedPerMTok: undefined, unverified: true }, 'missing output stays absent, never 0');
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
  assert.strictEqual(rich.longWindow, 908000, 'long window = long prompt budget + max output (semantics unverified)');
  assert.strictEqual(rich.pricing?.unverified, true);
  assert.strictEqual(rich.disabled, true);
  const noOut = modelOptionFrom({ id: 'm2', billing: { tokenPrices: { batchSize: 1, inputPrice: 1, longContext: { inputPrice: 2, maxPromptTokens: 5 } } } });
  assert.deepStrictEqual(noOut.contextTiers, ['default', 'long']);
  assert.strictEqual(noOut.longWindow, undefined, 'no output limit: the long window is not guessed');
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

  // ---- T032: the pure config keeps the saved choice on create and resume; autoTier only for a NEW auto session
  assert.deepStrictEqual(modelConfig({ model: 'auto', autoTier: 'efficiency' }, false), { model: 'auto', capi: { autoTier: 'efficiency' } });
  assert.deepStrictEqual(modelConfig({ model: 'auto', autoTier: 'efficiency' }, true), { model: 'auto' }, 'no autoTier on resume');
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
    assert.deepStrictEqual(p, { modelId: 'sim-deep', reasoningEffort: 'high', contextTier: 'long_context', requireAvailable: true, deferIfModelChangeQueued: true, runCompactionPreflight: true, source: 'model_picker' });
    for (const forbidden of ['repoScope', 'modelChangeScope', 'pickerPersistence', 'compactionDecision', 'autoTier']) assert.ok(!(forbidden in p), forbidden + ' is never sent for a normal switch');
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

    // queued while a turn runs, then cancelled
    s.switchAnswer = { deferred: true, queueId: 'q-7' };
    const q = await ad.setModel(sid, { model: 'sim-deep' });
    assert.deepStrictEqual([q.status, q.queueId], ['queued', 'q-7']);
    await ad.cancelQueuedModel(sid, 'q-7');
    assert.deepStrictEqual(arg(s, 'removeAt'), { id: 'q-7' });
    s.removed = false;
    await assert.rejects(ad.cancelQueuedModel(sid, 'q-7'), /Nothing was queued/);
    await assert.rejects(ad.cancelQueuedModel('nope', 'q'), /./);

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
    await ad.stop(sid);
    // an auto session that is resumed keeps the runtime's own routing
    const a2 = await ad.start({ workspace: dir, resumeSessionId: sid, model: 'auto', autoTier: 'efficiency', quiet: true });
    assert.ok(!('capi' in fake.resumed[1].config), 'no autoTier override on resume');
    assert.strictEqual(fake.resumed[1].config.model, 'auto');
    await ad.stop(a2);
    // a session id not on disk is created with exactly that id and the saved choice
    const a3 = await ad.start({ workspace: dir, sessionId: 'brand-new', model: 'sim-fast', contextTier: 'long', quiet: true });
    const cc = fake.created.slice(-1)[0];
    assert.deepStrictEqual([a3, cc.sessionId, cc.model, cc.contextTier], ['brand-new', 'brand-new', 'sim-fast', 'long_context']);
    await ad.stop(a3);
  }

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
      assert.strictEqual(o.autoTier, 'efficiency');
      assert.strictEqual(o.maxAiCredits, 40);
    }
    assert.strictEqual(startOptionsOf({ permMode: 'ask', model: 'm1' }, '/w', 'auto', 'high').autoTier, undefined);
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

  await sleep(0);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('copilot model tests passed');
}

main().catch((e) => { console.error(e); process.exit(1); });

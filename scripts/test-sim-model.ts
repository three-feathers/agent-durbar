/** Simulator support for switching model and context (spec 030): `npm run test:simmodel`. Runs the real src/renderer/sim.ts with no window, no session and no credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import type { AgentEvent } from '../src/adapters/types';
import type { AgentInfo, DurbarApi, ModelChoice } from '../src/shared/api';

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'sim.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
const timers: unknown[] = [];
const win: Record<string, unknown> = {
  setTimeout: (f: () => void, ms: number) => setTimeout(f, Math.min(ms, 4)), // the sim waits 0.4 to 1.4 s: the same order, much faster
  setInterval: (f: () => void) => { const t = setInterval(f, 1); timers.push(t); return 1; },
};
new Function('window', js)(win);
const sim = (win.__durbarSim as { create(o: { n: number; freeze?: boolean }): DurbarApi }).create({ n: 15, freeze: true });

const events: AgentEvent[] = [];
sim.onEvent((e) => events.push(e));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const of = (id: string, type: string) => events.filter((e) => e.sessionId === id && e.type === type) as unknown as Record<string, unknown>[];

const info7 = (l: AgentInfo[]): AgentInfo => l.find((i) => i.id === 'sim-7') as AgentInfo;

async function main(): Promise<void> {
  const infos: AgentInfo[] = await sim.listAgents();
  await sleep(50); // the agents' scripts play
  const info = (id: string) => infos.find((i) => i.id === id) as AgentInfo;
  assert.ok(infos.filter((i) => i.id !== 'sim-7').every((i) => i.modelControl?.switch === 'next-message' && i.modelControl.compact));
  // Priya (sim-7) behaves like today's real adapter: no in-place switch, no compact, and the calls say so
  assert.deepStrictEqual(info7(infos).modelControl, { switch: 'none', effort: false, contextTier: false, compact: false, windowKnown: true });

  // priced models, a long tier, one model with no price on purpose
  const models = (await (sim.listModels as NonNullable<DurbarApi['listModels']>)()).models as ModelChoice[];
  const by = (id: string) => models.find((m) => m.id === id) as ModelChoice;
  assert.deepStrictEqual(models.map((m) => m.id), ['auto', 'sim-fast', 'sim-mid', 'sim-deep', 'sim-preview']);
  assert.ok(by('sim-deep').pricing?.long?.inputPerMTok && by('sim-deep').longWindow === 400000 && by('sim-deep').contextTiers?.includes('long'));
  assert.ok(!by('auto').pricing && !by('sim-preview').pricing && !by('sim-preview').priceClass, 'unpriced models stay unpriced');
  assert.ok(models.every((m) => !m.contextTiers || m.contextTiers.includes('default')));

  const setModel = sim.setModel as NonNullable<DurbarApi['setModel']>;
  const cancel = sim.cancelQueuedModel as NonNullable<DurbarApi['cancelQueuedModel']>;
  const compact = sim.compact as NonNullable<DurbarApi['compact']>;

  // validation (the same rules as main's parseSwitchRequest)
  assert.strictEqual((await setModel('nope', { model: 'sim-fast' })).ok, false);
  assert.strictEqual((await setModel('sim-4', { model: 'x' })).ok, false);
  assert.strictEqual((await setModel('sim-4', { model: 'sim-fast', effort: 'high' })).ok, false, 'Sim Fast has no efforts');
  assert.strictEqual((await setModel('sim-4', { model: 'sim-mid', contextTier: 'long' })).ok, false, 'Sim Mid has no long tier');

  assert.strictEqual((await setModel('sim-7', { model: 'sim-fast' })).ok, false);
  assert.match(((await setModel('sim-7', { model: 'sim-fast' })).error) ?? '', /cannot change its model in place/);
  assert.strictEqual((await (sim.compact as NonNullable<DurbarApi['compact']>)('sim-7')).ok, false);

  // idle agent (Noor, sim-4): applied at once, the new window is reported with the next call
  assert.strictEqual(info('sim-4').model, 'sim-fast');
  let r = await setModel('sim-4', { model: 'sim-mid', effort: 'high' });
  assert.deepStrictEqual([r.ok, r.result?.status, r.result?.model], [true, 'applied', 'sim-mid']);
  assert.deepStrictEqual([info('sim-4').model, info('sim-4').effort, info('sim-4').tier], ['sim-mid', 'high', undefined]);
  let m = of('sim-4', 'model').pop() as Record<string, unknown>;
  assert.deepStrictEqual([m.model, m.previousModel, m.effort, m.cause, m.tier], ['sim-mid', 'sim-fast', 'high', 'user', 'default']);
  // long tier on Sim Deep
  r = await setModel('sim-4', { model: 'sim-deep', effort: 'low', contextTier: 'long' });
  assert.strictEqual(r.result?.status, 'applied');
  m = of('sim-4', 'model').pop() as Record<string, unknown>;
  assert.deepStrictEqual([m.model, m.tier, info('sim-4').tier], ['sim-deep', 'long', 'long']);
  // back to a default tier and a model with no efforts: the effort is dropped
  await setModel('sim-4', { model: 'sim-fast' });
  assert.strictEqual(info('sim-4').effort, undefined);
  assert.strictEqual(info('sim-4').tier, undefined);

  // spec 007 FR-018: Auto lists the three tiers; a tier only with Auto; the change carries it; kept on another model
  assert.deepStrictEqual(by('auto').autoTiers, ['efficiency', 'balance', 'intelligence']);
  assert.ok(models.filter((x) => x.id !== 'auto').every((x) => !x.autoTiers), 'only Auto');
  assert.ok(!by('auto').autoTierManaged, 'no organization tier without ?simtierlock');
  assert.match((await setModel('sim-4', { model: 'sim-mid', autoTier: 'balance' })).error ?? '', /no Auto routing tier/);
  assert.match((await setModel('sim-4', { model: 'auto', autoTier: 'fast' as never })).error ?? '', /no Auto routing tier/);
  r = await setModel('sim-4', { model: 'auto', autoTier: 'intelligence' });
  assert.deepStrictEqual([r.ok, r.result?.status, info('sim-4').model, info('sim-4').autoTier], [true, 'applied', 'auto', 'intelligence']);
  m = of('sim-4', 'model').pop() as Record<string, unknown>;
  assert.deepStrictEqual([m.model, m.autoTier, m.cause], ['auto', 'intelligence', 'user']);
  await setModel('sim-4', { model: 'sim-fast' });
  assert.deepStrictEqual([info('sim-4').model, info('sim-4').autoTier], ['sim-fast', 'intelligence'], 'kept while on another model');
  assert.ok(!('autoTier' in (of('sim-4', 'model').pop() as object)), 'no tier on a change to another model');

  // a smaller window than the context in use: the runtime asks first (Ada, sim-1: about 200k tokens)
  const before = (of('sim-1', 'context').pop() as { tokens: number }).tokens;
  assert.ok(before > 128000, 'Ada has more context than Sim Fast can hold');
  r = await setModel('sim-1', { model: 'sim-fast' });
  assert.strictEqual(r.result?.status, 'needs-confirmation');
  assert.deepStrictEqual([r.result?.confirmation?.targetName, r.result?.confirmation?.targetLimit, r.result?.confirmation?.currentTokens], ['Sim Fast', 128000, before]);
  assert.strictEqual(info('sim-1').model, 'auto', 'nothing changed yet');
  r = await setModel('sim-1', { model: 'sim-fast', confirm: { compaction: 'decline' } });
  assert.strictEqual(r.result?.status, 'rejected');
  assert.strictEqual(info('sim-1').model, 'auto');

  // while the agent works the switch is queued; it can be cancelled; it applies when the turn ends
  r = await setModel('sim-1', { model: 'sim-mid' });
  assert.strictEqual(r.result?.status, 'queued');
  const q1 = r.result?.queueId as string;
  assert.ok(q1);
  assert.strictEqual(info('sim-1').model, 'auto', 'queued: still the old model');
  assert.strictEqual((await cancel('sim-1', q1)).ok, true);
  assert.strictEqual((await cancel('sim-1', q1)).ok, false, 'nothing left to cancel');
  assert.strictEqual((await cancel('sim-1', 'bogus')).ok, false);
  const nModels = of('sim-1', 'model').length;
  await sim.stop('sim-1');
  await sleep(20);
  assert.strictEqual(of('sim-1', 'model').length, nModels, 'a cancelled switch never applies');
  r = await setModel('sim-1', { model: 'sim-mid' }); // Ada is idle after Stop
  assert.strictEqual(r.result?.status, 'applied');

  // accepted compaction before a smaller window, on a busy agent: queued, then compaction (model-switch) and then the switch
  r = await setModel('sim-5', { model: 'sim-preview' }); // Elif: working, 110k of 128k: fits, so no confirmation
  assert.strictEqual(r.result?.status, 'queued');
  await sim.stop('sim-5');
  await sleep(30);
  assert.notStrictEqual(info('sim-5').model, 'sim-preview', 'real: (T042) Stop drops a queued switch: the model is unchanged');
  assert.ok(!of('sim-5', 'model').some((e) => (e as { model?: string }).model === 'sim-preview'), 'and no model event follows');

  // accepted compaction before a smaller window (Ada is idle now, about 200k tokens, on Sim Mid): compaction first, then the switch
  const nComp = of('sim-1', 'compaction').length;
  r = await setModel('sim-1', { model: 'sim-fast', confirm: { compaction: 'accept' } });
  assert.strictEqual(r.result?.status, 'applied');
  const cm = of('sim-1', 'compaction').slice(nComp);
  assert.deepStrictEqual(cm.map((e) => [e.phase, e.trigger]), [['start', 'model-switch'], ['complete', 'model-switch']]);
  assert.ok(events.indexOf(events.filter((e) => e.sessionId === 'sim-1' && e.type === 'compaction').pop() as AgentEvent) < events.indexOf(events.filter((e) => e.sessionId === 'sim-1' && e.type === 'model').pop() as AgentEvent), 'the compaction comes before the model change');
  assert.strictEqual(info('sim-1').model, 'sim-fast');
  const nextCtx = await sim.send('sim-1', 'quick question', []);
  assert.ok(nextCtx.ok);
  await sleep(60);
  assert.strictEqual((of('sim-1', 'context').pop() as { limit: number }).limit, 128000, 'the window of the new model is reported with the next call');

  // manual compaction
  const ctxBefore = (of('sim-4', 'context').pop() as { tokens: number }).tokens;
  const c = await compact('sim-4');
  assert.strictEqual(c.result?.success, true);
  assert.ok((c.result?.tokensAfter ?? 1e9) < ctxBefore * 0.4);
  const comp = of('sim-4', 'compaction').slice(-2);
  assert.deepStrictEqual(comp.map((e) => [e.phase, e.trigger]), [['start', 'manual'], ['complete', 'manual']]);
  assert.strictEqual(comp[1].tokensBefore, ctxBefore);
  assert.strictEqual((of('sim-4', 'context').pop() as { tokens: number }).tokens, comp[1].tokensAfter, 'the context chip gets the new size');
  // a failure leaves the conversation as it was and says so
  const fail = await compact('sim-4', 'please fail');
  assert.strictEqual(fail.result?.success, false);
  assert.strictEqual((of('sim-4', 'compaction').pop() as { phase: string }).phase, 'failed');
  // a busy agent cannot compact
  const busy = await compact('sim-2');
  assert.strictEqual(busy.result?.success, false);
  assert.match(busy.result?.message ?? '', /idle/);

  // the runtime changes the model by itself (a message with "fallback" is the demo trigger)
  await sim.send('sim-4', 'trigger a fallback please', []);
  await sleep(60);
  const fb = of('sim-4', 'model').pop() as Record<string, unknown>;
  assert.deepStrictEqual([fb.cause, fb.model, fb.previousModel], ['fallback', 'sim-mid', 'sim-fast']);
  assert.strictEqual(info('sim-4').model, 'sim-mid');

  // automatic compaction (the runtime's background threshold): with the background ticks running, a busy agent that reaches 80% compacts itself
  const live = (win.__durbarSim as { create(o: { n: number; freeze?: boolean; seed?: number }): DurbarApi }).create({ n: 15, seed: 3 });
  const liveEvents: AgentEvent[] = [];
  live.onEvent((e) => liveEvents.push(e));
  await live.listAgents();
  const t0 = Date.now();
  const started = () => liveEvents.find((e) => e.type === 'compaction' && e.phase === 'start' && e.trigger === 'auto');
  while ((!started() || !liveEvents.some((e) => e.type === 'compaction' && e.phase === 'complete' && e.sessionId === started()?.sessionId && e.timestamp >= (started()?.timestamp ?? 0) && e !== liveEvents.find((x) => x.type === 'compaction' && x.sessionId === e.sessionId))) && Date.now() - t0 < 25000) await sleep(20);
  const st = started() as unknown as Record<string, unknown> | undefined;
  assert.ok(st, 'an automatic compaction started');
  const mine = liveEvents.filter((e) => e.type === 'compaction' && e.sessionId === st.sessionId) as unknown as Record<string, unknown>[];
  const i0 = mine.findIndex((e) => e.phase === 'start');
  assert.deepStrictEqual(mine.slice(i0, i0 + 2).map((e) => [e.phase, e.trigger]), [['start', 'auto'], ['complete', 'auto']]);
  assert.ok((mine[i0].tokensBefore as number) / (mine[i0].limit as number) >= 0.8, 'started at 80% or more');
  assert.ok(!liveEvents.some((e) => (e.sessionId === 'sim-4' || e.sessionId === 'sim-5') && e.type === 'compaction' && e.phase === 'start'), 'the two agents kept near the limit never compact on their own');
  assert.ok(liveEvents.some((e) => e.sessionId === 'sim-4' && e.type === 'compaction' && e.phase === 'complete'), 'Noor starts with the line of an earlier compaction');

  console.log('simulator model tests passed');
}

main().then(() => { timers.forEach((t) => clearInterval(t as NodeJS.Timeout)); process.exit(0); }, (e) => { console.error(e); process.exit(1); });

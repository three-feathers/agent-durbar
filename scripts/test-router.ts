/** Adapter router (spec 012 T014, FR-046..FR-050): fake adapters only. No session, no process, no credits. */
import * as assert from 'assert';
import { CopilotAdapter, COPILOT_DESCRIPTOR } from '../src/adapters/copilot';
import { PRODUCTION_DESCRIPTORS } from '../src/adapters/descriptors';
import { detectorFor } from '../src/adapters/detect';
import { createRegistry, detectAll } from '../src/adapters/registry';
import { adapterForAdd, createRouter, historyOf, interruptOf, refusesLive, modelOptionsOf, previousSessionsOf, setCapOf, setMcpEnabledOf, setPermModeOf } from '../src/adapters/router';
import type { AdapterCapabilities, AdapterDescriptor } from '../src/adapters/capabilities';
import type { AgentAdapter, AgentEvent, ModelOption } from '../src/adapters/types';

const CAPS: AdapterCapabilities = {
  interrupt: false, resume: false, images: false, models: false, effort: false, permissionModes: ['read-only'], permModeSwitch: 'none',
  usage: { tokens: false, costUsd: false, nanoAiu: false }, context: false, caps: false, helpers: false, history: false, mcpStatus: false, mcpToggle: false,
};

/** Only the required members of AgentAdapter. */
class BareAdapter implements AgentAdapter {
  readonly capabilities = CAPS;
  debug?: (m: string) => void;
  listeners = new Set<(e: AgentEvent) => void>();
  disposed = 0;
  live = false;
  failDispose = false;
  constructor(readonly id: string) {}
  get displayName(): string { return this.id; }
  async start(): Promise<string> { return 'x'; }
  async send(): Promise<void> {}
  async stop(): Promise<void> {}
  isLive(): boolean { return this.live; }
  async dispose(): Promise<void> {
    this.disposed++;
    if (this.failDispose) throw new Error('boom');
  }
  onEvent(l: (e: AgentEvent) => void): () => void {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }
  emit(e: AgentEvent): void { for (const l of [...this.listeners]) l(e); }
}

const MODEL = { id: 'm', name: 'M', efforts: [], disabled: false } as unknown as ModelOption;

/** Every optional member, recording its arguments. */
class FullAdapter extends BareAdapter {
  calls: Array<[string, unknown[]]> = [];
  async listPreviousSessions(...a: unknown[]): Promise<never[]> { this.calls.push(['prev', a]); return []; }
  async history(...a: unknown[]): Promise<{ items: never[]; total: number; truncated: boolean }> { this.calls.push(['history', a]); return { items: [], total: 7, truncated: true }; }
  async listModelOptions(): Promise<ModelOption[]> { this.calls.push(['models', []]); return [MODEL]; }
  setPermMode(...a: unknown[]): { pending: number } { this.calls.push(['perm', a]); return { pending: 3 }; }
  async setMcpEnabled(...a: unknown[]): Promise<void> { this.calls.push(['mcp', a]); }
  async setCap(...a: unknown[]): Promise<void> { this.calls.push(['cap', a]); }
  async interrupt(...a: unknown[]): Promise<void> { this.calls.push(['interrupt', a]); }
}

function fakes() {
  const made: Record<string, BareAdapter[]> = { a: [], b: [] };
  const mk = (id: string): AdapterDescriptor => ({ id, displayName: id.toUpperCase(), capabilities: CAPS, create: () => { const x = new BareAdapter(id); made[id].push(x); return x; } });
  const reg = createRegistry([mk('a'), mk('b')]);
  return { made, reg, router: createRouter(reg) };
}
const ev = (n: number): AgentEvent => ({ type: 'status', sessionId: 's' + n, status: 'idle' } as unknown as AgentEvent);

async function main(): Promise<void> {
  // (prod) the production registry lists real adapters only, never a test double
  {
    const ids = createRegistry(PRODUCTION_DESCRIPTORS).list().map((d) => d.id);
    assert.deepStrictEqual(ids, ['copilot'], 'prod: only real adapters are registered (no fake)');
    assert.ok(!ids.some((id) => /fake/i.test(id)), 'prod: no fake adapter id in the production registry');
  }
  // (a) lazy, one per id, unknown id throws
  {
    const { made, router } = fakes();
    assert.strictEqual(made.a.length, 0, 'a: nothing is created up front');
    const x = router.instance('a');
    assert.strictEqual(router.instance('a'), x, 'a: same instance on every call');
    assert.strictEqual(made.a.length, 1, 'a: one instance per id');
    assert.strictEqual(made.b.length, 0, 'a: other ids stay uncreated');
    assert.throws(() => router.instance('nope'), 'a: unknown id throws');
    assert.strictEqual(router.created().length, 1, 'a: created() lists made instances only');
  }
  // (b) binding
  {
    const { router } = fakes();
    assert.strictEqual(router.forAgent('s1'), undefined, 'b: unbound agent has no adapter');
    assert.strictEqual(router.adapterIdOf('s1'), undefined, 'b: unbound agent has no adapter id');
    router.bind('s1', 'a');
    assert.strictEqual(router.forAgent('s1'), router.instance('a'), 'b: bound agent gets its adapter');
    assert.strictEqual(router.adapterIdOf('s1'), 'a', 'b: adapterIdOf');
    router.bind('s1', 'a');
    assert.strictEqual(router.adapterIdOf('s1'), 'a', 'b: binding to the same adapter is a no-op');
    assert.throws(() => router.bind('s1', 'b'), 'b: rebinding to another adapter throws');
    assert.strictEqual(router.adapterIdOf('s1'), 'a', 'b: failed rebind keeps the old binding');
    assert.throws(() => router.bind('s2', 'nope'), 'b: binding to an unknown adapter throws');
    router.unbind('s1');
    assert.strictEqual(router.forAgent('s1'), undefined, 'b: unbind removes the binding');
    router.bind('s1', 'b');
    assert.strictEqual(router.adapterIdOf('s1'), 'b', 'b: after unbind a different adapter can be bound');
  }
  // (c) onEvent: existing and later instances, once each, unsubscribe detaches all
  {
    const { made, router } = fakes();
    router.instance('a');
    const seen: string[] = [];
    const off = router.onEvent((e) => seen.push((e as { sessionId: string }).sessionId));
    router.instance('b');
    made.a[0].emit(ev(1));
    made.b[0].emit(ev(2));
    assert.deepStrictEqual(seen, ['s1', 's2'], 'c: events from an existing and a later instance arrive exactly once');
    router.instance('a');
    router.instance('b');
    made.a[0].emit(ev(3));
    assert.deepStrictEqual(seen, ['s1', 's2', 's3'], 'c: asking for an instance again does not double the subscription');
    off();
    made.a[0].emit(ev(4));
    made.b[0].emit(ev(5));
    assert.strictEqual(seen.length, 3, 'c: unsubscribe stops both');
    assert.strictEqual(made.a[0].listeners.size + made.b[0].listeners.size, 0, 'c: unsubscribe detaches from every adapter');
  }
  // (d) setDebug
  {
    const { made, router } = fakes();
    router.instance('a');
    const f = (_m: string): void => {};
    router.setDebug(f);
    assert.strictEqual(made.a[0].debug, f, 'd: reaches an existing instance');
    router.instance('b');
    assert.strictEqual(made.b[0].debug, f, 'd: reaches a later instance');
    router.setDebug(undefined);
    assert.strictEqual(made.a[0].debug, undefined, 'd: can be cleared');
  }
  // (e) disposeAll
  {
    const { made, router } = fakes();
    await router.disposeAll();
    assert.strictEqual(made.a.length + made.b.length, 0, 'e: disposeAll creates nothing');
    router.instance('a');
    router.instance('b');
    made.a[0].failDispose = true;
    await assert.doesNotReject(router.disposeAll(), 'e: disposeAll resolves even when an adapter rejects');
    assert.strictEqual(made.a[0].disposed, 1, 'e: a rejecting adapter was disposed');
    assert.strictEqual(made.b[0].disposed, 1, 'e: one rejection does not stop the others');
    assert.strictEqual(made.a.length + made.b.length, 2, 'e: still only the created ones');
  }
  // (f) FR-050 helpers
  {
    const bare = new BareAdapter('bare');
    assert.deepStrictEqual(await previousSessionsOf(bare, '/x', new Set()), [], 'f: no previous sessions');
    assert.deepStrictEqual(await historyOf(bare, 's'), { items: [], total: 0, truncated: false }, 'f: empty history');
    assert.deepStrictEqual(await modelOptionsOf(bare), [], 'f: no model options');
    assert.deepStrictEqual(setPermModeOf(bare, 's', 'ask'), { applied: false, pending: 0 }, 'f: bare adapter reports not applied');
    assert.strictEqual(await setMcpEnabledOf(bare, 's', 'n', true), false, 'f: bare setMcpEnabledOf reports not applied');
    assert.strictEqual(await setCapOf(bare, 's', 40), false, 'f: bare setCapOf reports not applied');
    assert.strictEqual(await interruptOf(bare, 's'), false, 'f: bare interruptOf reports not applied');
    const full = new FullAdapter('full');
    const ex = new Set(['q']);
    await previousSessionsOf(full, '/x', ex);
    assert.deepStrictEqual(full.calls[0], ['prev', ['/x', ex]], 'f: previousSessionsOf forwards its args');
    assert.deepStrictEqual(await historyOf(full, 's9'), { items: [], total: 7, truncated: true }, 'f: historyOf returns the adapter result');
    assert.deepStrictEqual(full.calls[1], ['history', ['s9']], 'f: historyOf forwards the id');
    assert.deepStrictEqual(await modelOptionsOf(full), [MODEL], 'f: modelOptionsOf returns the adapter list');
    const opts = { clearGrants: true, approvePending: false };
    assert.deepStrictEqual(setPermModeOf(full, 's1', 'allow', opts), { applied: true, pending: 3 }, 'f: setPermModeOf returns the adapter result');
    assert.deepStrictEqual(full.calls[3], ['perm', ['s1', 'allow', opts]], 'f: setPermModeOf forwards its args');
    await setMcpEnabledOf(full, 's1', 'srv', false);
    assert.deepStrictEqual(full.calls[4], ['mcp', ['s1', 'srv', false]], 'f: setMcpEnabledOf forwards its args');
    assert.strictEqual(await setMcpEnabledOf(full, 's1', 'srv', false), true, 'f: full setMcpEnabledOf reports applied');
    assert.strictEqual(await setCapOf(full, 's1', null), true, 'f: full setCapOf reports applied');
    assert.deepStrictEqual(full.calls[6], ['cap', ['s1', null]], 'f: setCapOf forwards its args');
    assert.strictEqual(await interruptOf(full, 's1'), true, 'f: full interruptOf reports applied');
    assert.deepStrictEqual(full.calls[7], ['interrupt', ['s1']], 'f: interruptOf forwards its args');
  }
  // (f2) a live session whose adapter lacks the member is refused; a session that is not live is saved (constitution III)
  {
    const bare = new BareAdapter('bare');
    const full = new FullAdapter('full');
    const cases: Array<[string, (ad: AgentAdapter) => Promise<boolean>]> = [
      ['setPermMode', async (ad) => setPermModeOf(ad, 's', 'read-only').applied],
      ['setCap', (ad) => setCapOf(ad, 's', 50)],
      ['setMcpEnabled', (ad) => setMcpEnabledOf(ad, 's', 'n', false)],
      ['interrupt', (ad) => interruptOf(ad, 's')],
    ];
    for (const [name, call] of cases) {
      bare.live = true;
      assert.strictEqual(refusesLive(bare, 's', await call(bare)), true, `f2: ${name}: live bare session is refused`);
      bare.live = false;
      assert.strictEqual(refusesLive(bare, 's', await call(bare)), false, `f2: ${name}: bare session not started is saved`);
      full.live = true;
      assert.strictEqual(refusesLive(full, 's', await call(full)), false, `f2: ${name}: adapter with the member is never refused`);
    }
  }
  // (g) the real Copilot registry starts nothing
  {
    const reg = createRegistry([COPILOT_DESCRIPTOR]);
    const router = createRouter(reg);
    const ad = router.instance('copilot');
    assert.ok(ad instanceof CopilotAdapter, 'g: instance is a CopilotAdapter');
    for (const m of ['setPermMode', 'setCap', 'setMcpEnabled', 'interrupt'] as const) assert.strictEqual(typeof ad[m], 'function', `g: Copilot has ${m}, so it is never refused`);
    assert.strictEqual(ad.isLive('nothing'), false, 'g: no session is live');
    await router.disposeAll();
  }
  // (h) detectAll with detectorFor
  {
    const reg = createRegistry([COPILOT_DESCRIPTOR]);
    const infos = await detectAll(reg, (d) => detectorFor(d.id)?.(d) ?? Promise.resolve({ state: 'unknown' as const }));
    assert.strictEqual(infos.length, 1, 'h: one adapter listed');
    assert.strictEqual(infos[0].id, 'copilot', 'h: copilot listed');
    assert.strictEqual(infos[0].state, 'ready', 'h: copilot is ready (nothing to install)');
    const { reg: reg2 } = fakes();
    const two = await detectAll(reg2, (d) => detectorFor(d.id)?.(d) ?? Promise.resolve({ state: 'unknown' as const }));
    assert.deepStrictEqual(two.map((i) => i.state), ['unknown', 'unknown'], 'h: no detector gives unknown');
  }
  // (i) adapterForAdd
  {
    const has = (id: string): boolean => id === 'copilot' || id === 'other';
    assert.deepStrictEqual(adapterForAdd('other', 'copilot', has, 'copilot'), { id: 'other' }, 'i: explicit wins');
    assert.deepStrictEqual(adapterForAdd(undefined, 'other', has, 'copilot'), { id: 'other' }, 'i: saved known is used');
    assert.ok('error' in adapterForAdd(undefined, 'future', has, 'copilot'), 'i: saved unknown is refused');
    assert.deepStrictEqual(adapterForAdd(undefined, undefined, has, 'copilot'), { id: 'copilot' }, 'i: none gives the default');
    assert.ok('error' in adapterForAdd('future', 'copilot', has, 'copilot'), 'i: explicit unknown is refused');
    // T017 (FR-058): a kind the user picked must be ready; no fallback to another kind
    const ready = (id: string): boolean => id === 'copilot';
    assert.deepStrictEqual(adapterForAdd('copilot', undefined, has, 'copilot', ready), { id: 'copilot' }, 'i: explicit ready is used');
    const notReady = adapterForAdd('other', 'copilot', has, 'copilot', ready);
    assert.ok('error' in notReady && /not ready/.test(notReady.error), 'i: explicit known but not ready is refused');
    assert.deepStrictEqual(adapterForAdd('other', undefined, has, 'copilot'), { id: 'other' }, 'i: without a ready check (resume, restore) nothing changes');
    assert.deepStrictEqual(adapterForAdd(undefined, 'other', has, 'copilot', ready), { id: 'other' }, 'i: a saved kind is not re-checked');
    assert.ok('error' in adapterForAdd('future', undefined, has, 'copilot', ready), 'i: unknown still refused with a ready check');
  }
  console.log('router tests passed');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

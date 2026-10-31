/**
 * Spec 030 FR-060..FR-065 (owner report 2026-10-31): model, reasoning effort and context chosen one after another stay together, in any order.
 * The pure merge (src/renderer/modelswitch.js), and the `agents:setModel` channel on a stand-in electron with a fake adapter per agent app: each app's
 * own list checks the request, the adapter receives every value, a session that has not started saves them all. Fakes only, no credits. `npm run test:modelchoice`.
 * The window's side (the menu, the queue, a stale menu, a rapid double choice) is `scripts/check-model-choice.js`.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { FakeAdapter } from '../src/adapters/fake';
import type { AgentInfo } from '../src/shared/api';
import type { ModelSwitchRequest } from '../src/shared/modelswitch';

type Choice = { model: string; effort?: string | null; tier?: string };
type Req = { model: string; contextTier?: string; effort?: string | null };
type Merged = { req: Req; dropped: { effort?: string; tier?: string } };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const D = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'modelswitch.js')) as {
  mergeChoice: (b: Choice, c: Partial<Choice>, modelOf: (id: string) => unknown) => Merged;
  sameChoice: (b: Choice, r: Req) => boolean;
  choiceWords: (r?: Req) => string;
  droppedText: (d: Merged['dropped'], name: string) => string;
};

const LIST: Record<string, { id: string; efforts: string[]; contextTiers?: string[] }> = {
  deep: { id: 'deep', efforts: ['low', 'high'], contextTiers: ['default', 'long'] },
  wide: { id: 'wide', efforts: ['low', 'high'], contextTiers: ['default', 'long'] },
  flat: { id: 'flat', efforts: [] },
};
const modelOf = (id: string): unknown => LIST[id];
const fold = (base: Choice, changes: Partial<Choice>[]): Choice => changes.reduce<Choice>((b, c) => { const { req } = D.mergeChoice(b, c, modelOf); return { model: req.model, effort: req.effort !== undefined ? req.effort : b.effort, tier: req.contextTier }; }, base);
const PERMS: number[][] = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

async function main(): Promise<void> {
  // ---- the merge: every order ends on the same whole choice
  const changes: Partial<Choice>[] = [{ model: 'wide' }, { effort: 'high' }, { tier: 'long' }];
  for (const p of PERMS) assert.deepStrictEqual(fold({ model: 'deep', tier: 'default' }, p.map((i) => changes[i])), { model: 'wide', effort: 'high', tier: 'long' }, `order ${p}`);
  // a request names the whole state: a change of one field repeats the others
  assert.deepStrictEqual(D.mergeChoice({ model: 'deep', effort: 'high', tier: 'long' }, { model: 'wide' }, modelOf), { req: { model: 'wide', contextTier: 'long', effort: 'high' }, dropped: {} });
  assert.deepStrictEqual(D.mergeChoice({ model: 'deep', effort: 'high', tier: 'long' }, { tier: 'default' }, modelOf).req, { model: 'deep', contextTier: 'default', effort: 'high' });
  // no effort chosen: none is sent (the runtime keeps its own); the Default button clears
  assert.ok(!('effort' in D.mergeChoice({ model: 'deep', tier: 'default' }, { tier: 'long' }, modelOf).req));
  assert.strictEqual(D.mergeChoice({ model: 'deep', effort: 'high', tier: 'default' }, { effort: null }, modelOf).req.effort, null);
  // a Default kept in a queued switch stays a Default
  assert.strictEqual(D.mergeChoice({ model: 'deep', effort: null, tier: 'default' }, { tier: 'long' }, modelOf).req.effort, null);
  // what the target cannot do is dropped and named, never sent
  const flat = D.mergeChoice({ model: 'deep', effort: 'high', tier: 'long' }, { model: 'flat' }, modelOf);
  assert.deepStrictEqual(flat, { req: { model: 'flat', contextTier: 'default', effort: null }, dropped: { effort: 'high', tier: 'long' } });
  assert.strictEqual(D.droppedText(flat.dropped, 'Flat'), 'Flat does not offer high effort or long context, so they are not kept.');
  assert.strictEqual(D.droppedText({ tier: 'long' }, 'Flat'), 'Flat does not offer long context, so it is not kept.');
  assert.strictEqual(D.droppedText({}, 'Flat'), '');
  // a stale menu: an effort the current model no longer has
  assert.deepStrictEqual(D.mergeChoice({ model: 'flat', tier: 'default' }, { effort: 'high' }, modelOf).dropped, { effort: 'high' });
  // nothing new: no call
  assert.ok(D.sameChoice({ model: 'deep', effort: 'high', tier: 'long' }, { model: 'deep', effort: 'high', contextTier: 'long' }));
  assert.ok(D.sameChoice({ model: 'deep', tier: 'default' }, { model: 'deep', contextTier: 'default', effort: null }), 'a cleared effort on none is no change');
  for (const r of [{ model: 'wide', effort: 'high', contextTier: 'long' }, { model: 'deep', effort: 'low', contextTier: 'long' }, { model: 'deep', effort: 'high', contextTier: 'default' }]) assert.ok(!D.sameChoice({ model: 'deep', effort: 'high', tier: 'long' }, r), JSON.stringify(r));
  assert.strictEqual(D.choiceWords({ model: 'x', effort: 'high', contextTier: 'long' }), 'high effort, long context');
  assert.strictEqual(D.choiceWords({ model: 'x', contextTier: 'default' }), '');

  // ---- the channel, on a stand-in electron (as test-orgwiring does), with one fake adapter per agent app
  const electronPath = require.resolve('electron');
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const fake = { ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => undefined } };
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-030-choice-'));
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { register } = require('../src/main/ipc/model') as typeof import('../src/main/ipc/model');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
    const frame = { url: pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href };
    const win = { senderFrame: frame, sender: { mainFrame: frame } };
    const call = (ch: string, ...a: unknown[]) => Promise.resolve(handlers.get(ch)!(win, ...a)) as Promise<{ ok: boolean; error?: string; result?: { status: string } }>;

    const lists: Record<string, unknown[]> = {
      copilot: [{ id: 'auto', name: 'Auto', efforts: [], disabled: false }, { id: 'gpt-wide', name: 'Wide', efforts: ['low', 'high'], contextTiers: ['default', 'long'], disabled: false }, { id: 'gpt-deep', name: 'Deep', efforts: ['low', 'high'], contextTiers: ['default', 'long'], disabled: false }],
      claude: [{ id: 'default', name: 'Default', efforts: ['low', 'high', 'max'], disabled: false }, { id: 'sonnet', name: 'Sonnet', efforts: ['low', 'high'], disabled: false }, { id: 'sonnet[1m]', name: 'Sonnet 1M', efforts: ['low', 'high'], disabled: false }],
      codex: [{ id: 'gpt-sol', name: 'Sol', efforts: ['low', 'high'], disabled: false }, { id: 'gpt-luna', name: 'Luna', efforts: ['low'], disabled: false }],
    };
    const got: Record<string, ModelSwitchRequest[]> = { copilot: [], claude: [], codex: [] };
    const ads: Record<string, FakeAdapter> = {};
    const agents = new Map<string, AgentInfo>();
    const ids: Record<string, string> = {};
    for (const k of Object.keys(lists)) {
      const ad = new FakeAdapter({ id: k, displayName: k });
      (ad as unknown as { setModel: unknown }).setModel = async (_s: string, r: ModelSwitchRequest) => (got[k].push(r), { status: 'applied', model: r.model });
      (ad as unknown as { listModelOptions: unknown }).listModelOptions = async () => lists[k];
      ads[k] = ad;
      const sid = `live-${k}`; // one session per app: this test needs only its liveness
      (ad as unknown as { isLive: unknown }).isLive = (id: string) => id === sid;
      ids[k] = sid;
      agents.set(sid, { id: sid, name: k, cwd: ws, folders: [ws], permMode: 'ask', adapterId: k, model: 'auto' } as unknown as AgentInfo);
    }
    const saved: { key: string; c: Record<string, unknown> }[] = [];
    const router = { onEvent: () => () => undefined, forAgent: (id: string) => Object.values(ads).find((x) => x.isLive(id)) ?? ads.claude, instance: (k: string) => ads[k] };
    register({ agents, router: router as never, registry: { defaultId: 'copilot', has: (k: string) => k in lists } as never, wsKey: (a) => a.adapterId ?? '', getFolderStore: () => ({ setModelChoice: (key: string, c: Record<string, unknown>) => void saved.push({ key, c }) }) as never });

    // Claude Code's and Codex's own models and efforts are accepted (they were checked against Copilot's list and refused), Copilot's own too
    const setOk = async (k: string, req: unknown, what: string): Promise<void> => {
      const r = await call('agents:setModel', ids[k], req);
      assert.ok(r.ok && r.result?.status === 'applied', `${what}: ${JSON.stringify(r)}`);
    };
    await setOk('claude', { model: 'sonnet[1m]', effort: 'high', contextTier: 'default' }, 'Claude: its own [1m] alias and effort');
    assert.deepStrictEqual(got.claude.pop(), { model: 'sonnet[1m]', effort: 'high', contextTier: 'default' }, 'the fake adapter receives both values');
    await setOk('claude', { model: 'default', effort: 'max' }, "Claude's own default with its effort");
    await setOk('claude', { model: 'auto', effort: 'max' }, 'auto on Claude has the efforts of its default entry');
    await setOk('codex', { model: 'gpt-sol', effort: 'high', contextTier: 'default' }, 'Codex: its own model and effort');
    assert.deepStrictEqual(got.codex.pop(), { model: 'gpt-sol', effort: 'high', contextTier: 'default' }, 'the fake adapter receives both values');
    await setOk('codex', { model: 'auto', effort: null }, 'Codex: back to its own default (an Undo)');
    await setOk('copilot', { model: 'gpt-wide', effort: 'high', contextTier: 'long' }, 'Copilot: the three values');
    assert.deepStrictEqual(got.copilot.pop(), { model: 'gpt-wide', effort: 'high', contextTier: 'long' }, 'the fake adapter receives all three');

    // each app's list holds only for its own sessions
    for (const [k, req, re] of [['claude', { model: 'gpt-wide' }, /not in the list/], ['codex', { model: 'sonnet' }, /not in the list/], ['copilot', { model: 'sonnet' }, /not in the list/], ['claude', { model: 'sonnet', effort: 'max' }, /does not offer/], ['claude', { model: 'sonnet', contextTier: 'long' }, /no long-context tier/]] as const) {
      const r = await call('agents:setModel', ids[k], req);
      assert.ok(!r.ok && re.test(r.error ?? ''), `${k} ${JSON.stringify(req)}: ${JSON.stringify(r)}`);
    }
    // the tiers stay Copilot's (spec 007 FR-015)
    assert.ok(!(await call('agents:setModel', ids.claude, { model: 'auto', autoTier: 'balance' })).ok, 'no Auto routing tier on Claude');
    // models:list keeps each app's list (a fresh list replaces the old one for that app only)
    lists.codex = [{ id: 'gpt-next', name: 'Next', efforts: [], disabled: false }];
    (await call('models:list', 'codex'));
    await setOk('codex', { model: 'gpt-next' }, 'the newest list counts');
    assert.ok(!(await call('agents:setModel', ids.codex, { model: 'gpt-sol' })).ok, 'and the older one no longer');
    await setOk('copilot', { model: 'gpt-deep' }, "and Copilot's list is untouched");

    // ---- one choice after another, whole requests: what main holds and saves at each step, in the three orders that end with each field last
    const k = 'copilot', a = agents.get(ids[k])!;
    await setOk(k, { model: 'gpt-wide', contextTier: 'default', effort: null }, 'reset');
    const whole = [{ model: 'gpt-deep', contextTier: 'default' }, { model: 'gpt-deep', contextTier: 'default', effort: 'high' }, { model: 'gpt-deep', contextTier: 'long', effort: 'high' }];
    for (const r of whole) await setOk(k, r, 'step');
    assert.deepStrictEqual([a.model, a.effort, a.tier], ['gpt-deep', 'high', 'long'], 'main holds all three');
    assert.deepStrictEqual(saved[saved.length - 1], { key: 'copilot', c: { model: 'gpt-deep', effort: 'high', contextTier: 'long', autoTier: undefined } }, 'and saves all three');

    // ---- a session that has not started (FR-013): nothing is live, main answers applied and saves the whole choice for its first start, step by step
    const notStarted: AgentInfo = { id: 'ns', name: 'ns', cwd: ws, folders: [ws], permMode: 'ask', adapterId: 'claude', model: 'auto' } as unknown as AgentInfo;
    agents.set('ns', notStarted);
    const before = got.claude.length;
    for (const r of [{ model: 'sonnet', contextTier: 'default' }, { model: 'sonnet', contextTier: 'default', effort: 'high' }]) {
      const res = await call('agents:setModel', 'ns', r);
      assert.strictEqual(res.result?.status, 'applied', JSON.stringify(res));
    }
    assert.deepStrictEqual([notStarted.model, notStarted.effort, notStarted.tier], ['sonnet', 'high', undefined], 'both are kept for the first start');
    assert.strictEqual(got.claude.length, before, 'no live adapter call');
    assert.deepStrictEqual(saved[saved.length - 1].c, { model: 'sonnet', effort: 'high', contextTier: undefined, autoTier: undefined });
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
    delete require.cache[electronPath];
  }

  // ---- the window's own code keeps to this: pinned by text only where a driver cannot run (the driver covers the behaviour)
  const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
  for (const t of ["chooseModel(a,{model:b.dataset.pick},anchor)", "chooseModel(a,{effort:b.dataset.effort||null},anchor)"]) assert.ok(app.includes(t), `a menu row names only what it changes: ${t}`);
  console.log('test-model-choice: all checks passed');
}

main().catch((e) => { console.error(e); process.exit(1); });

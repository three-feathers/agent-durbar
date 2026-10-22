/**
 * Spec 010 FR-022..FR-026 (incident on PR #505, 2026-10-22): under `DURBAR_SIM` main never reaches a real agent app.
 * `npm run test:simguard`. No Electron (a stand-in `electron` module), no network, no credits.
 *
 *  1. the real ipcguard.ts, loaded with DURBAR_SIM=15, refuses every channel the preload calls except SIM_OPEN_CHANNELS, before the
 *     handler runs; without DURBAR_SIM (or with 0 / text) the same calls reach their handlers;
 *  2. every channel that starts or talks to an agent app (the list in the spec) is registered and not open; an open channel's handler
 *     names no adapter, router, addWorkspace, generateText, spawn or install run;
 *  3. main.ts builds the registry through simGuardDescriptors and gates the scheduler and DURBAR_OPEN on simulatorOn;
 *  4. the stand-in adapter: the real create is never called, every member but the inert ones throws the refusal.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { SIM_OPEN_CHANNELS, SIM_OPTIONAL_MEMBERS, blockedAdapter, isSimBlocked, simChannelOpen, simGuardDescriptors, simRefusal, simulatorOn } from '../src/main/simguard';
import { interfaceOptionalMembers } from './test-adapter-contract';
import type { AdapterDescriptor } from '../src/adapters/capabilities';
import type { AgentAdapter } from '../src/adapters/types';

const ROOT = path.join(__dirname, '..', '..');
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
const read = (f: string): string => stripComments(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n'));

// ---- FR-022: one rule, the window's ----
for (const [v, on] of [['15', true], ['1', true], [' 12 ', true], ['40', true], ['0', false], ['', false], [undefined, false], ['abc', false], ['15abc', false], ['-3', false], ['1.5', false], ['true', false]] as const) {
  assert.strictEqual(simulatorOn({ DURBAR_SIM: v }), on, `DURBAR_SIM=${JSON.stringify(v)} -> ${on}`);
}
assert.strictEqual(simulatorOn({}), false, 'no hooks (a packaged build) -> off');

// ---- 1. the shipped ipcguard decision, under a stand-in electron ----
const preload = read('src/preload/preload.ts');
const invoked = [...new Set([...preload.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map((m) => m[1]))].sort();
const sent = [...new Set([...preload.matchAll(/ipcRenderer\.send\(\s*'([^']+)'/g)].map((m) => m[1]))].sort();
assert.ok(invoked.length > 100, `the preload invokes many channels (${invoked.length})`);
assert.ok(sent.length >= 1, 'the preload sends at least one message (agents:setPaused)');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require('module') as { _load: (req: string, parent: unknown, isMain: boolean) => unknown };
const handles = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
const ons = new Map<string, (e: unknown, ...a: unknown[]) => void>();
const fakeElectron = { app: { isPackaged: false }, ipcMain: { handle: (c: string, f: (e: unknown, ...a: unknown[]) => unknown) => handles.set(c, f), on: (c: string, f: (e: unknown, ...a: unknown[]) => void) => ons.set(c, f) } };
const realLoad = Module._load;
Module._load = function (req: string, parent: unknown, isMain: boolean) {
  return req === 'electron' ? fakeElectron : realLoad.call(this, req, parent, isMain);
};
const guardFile = path.join(__dirname, '..', 'src', 'main', 'ipcguard.js');
const indexUrl = pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href;
const mainFrame = { url: indexUrl };
const event = { senderFrame: mainFrame, sender: { mainFrame } };

interface Guard { ipcHandle: (c: string, f: (...a: unknown[]) => unknown) => void; ipcOn: (c: string, f: (...a: unknown[]) => void) => void }
function loadGuard(sim: string | undefined): Guard {
  delete require.cache[require.resolve(guardFile)];
  if (sim === undefined) delete process.env.DURBAR_SIM;
  else process.env.DURBAR_SIM = sim;
  handles.clear();
  ons.clear();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(guardFile) as Guard;
}

async function run(sim: string | undefined): Promise<{ ran: Set<string>; refused: Map<string, string> }> {
  const g = loadGuard(sim);
  const ran = new Set<string>();
  const refused = new Map<string, string>();
  for (const c of invoked) g.ipcHandle(c, () => { ran.add(c); return 'ok'; });
  for (const c of sent) g.ipcOn(c, () => { ran.add(c); });
  const warn = console.warn;
  console.warn = () => undefined; // the guard logs each refused channel once; keep the test output short
  try {
    for (const c of invoked) {
      try {
        assert.strictEqual(await handles.get(c)!(event, 'x', 1), 'ok');
      } catch (err) {
        refused.set(c, (err as Error).message);
      }
    }
    for (const c of sent) ons.get(c)!(event, 'x', true);
  } finally {
    console.warn = warn;
  }
  return { ran, refused };
}

(async () => {
  const sim = await run('15');
  for (const c of invoked) {
    if (simChannelOpen(c)) {
      assert.ok(sim.ran.has(c) && !sim.refused.has(c), `DURBAR_SIM: the open channel "${c}" still reaches its handler`);
    } else {
      assert.ok(!sim.ran.has(c), `DURBAR_SIM: "${c}" must not reach its handler`);
      assert.strictEqual(sim.refused.get(c), simRefusal(c), `DURBAR_SIM: "${c}" is refused with the simulator message`);
    }
  }
  for (const c of sent) assert.ok(simChannelOpen(c) || !sim.ran.has(c), `DURBAR_SIM: the message "${c}" is dropped`);
  // the sender check still comes first: a foreign frame gets the old refusal, not the simulator's
  {
    const foreign = { senderFrame: { url: 'https://example.com/' }, sender: { mainFrame: {} } };
    await assert.rejects(async () => handles.get('theme:generate')!(foreign), /did not come from its own window/);
  }
  for (const v of [undefined, '0', 'abc']) {
    const real = await run(v);
    assert.strictEqual(real.refused.size, 0, `DURBAR_SIM=${String(v)}: nothing is refused (${[...real.refused.keys()].join(', ')})`);
    for (const c of [...invoked, ...sent]) assert.ok(real.ran.has(c), `DURBAR_SIM=${String(v)}: "${c}" reaches its handler`);
  }
  delete process.env.DURBAR_SIM;
  Module._load = realLoad;
  console.log(`simguard: under DURBAR_SIM ${invoked.length + sent.length - Object.keys(SIM_OPEN_CHANNELS).length} channels refused, ${Object.keys(SIM_OPEN_CHANNELS).length} open; all answered without it`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

// ---- 2. the channels that reach an agent app (spec 010 FR-023, one by one) and the open list's hygiene ----
const REACHES_AGENT_APP = [
  'theme:generate', 'folderSetup:explain',
  'agents:addFolder', 'agents:addWorkspaceFile', 'agents:newSession', 'agents:send', 'agents:wake', 'sessions:resume',
  'agents:stop', 'agents:end', 'agents:compact', 'agents:handoff', 'agents:setModel', 'agents:cancelQueuedModel', 'agents:setMode', 'agents:setCap',
  'agents:resolvePermission', 'agents:resolvePlan', 'agents:resolveLimit', 'agents:revokeGrant', 'agents:answerQuestion', 'agents:answerElicitation',
  'agents:listProfiles', 'agents:selectProfile', 'agents:mcp', 'agents:setMcp', 'agents:setRemote', 'agents:openRemote',
  'sessions:listPrevious', 'sessions:rename', 'sessions:delete',
  'adapters:list', 'models:list',
  'harness:run', 'harness:paste', 'harness:cancel', 'harness:copilotAuth', 'harness:openSignIn',
  'schedules:runNow',
];
// a channel added later that also reaches an agent app (PR #505's profiles:generate) is refused by the default deny; list it here when it lands
for (const extra of ['profiles:generate']) if (invoked.includes(extra)) REACHES_AGENT_APP.push(extra);
for (const c of REACHES_AGENT_APP) {
  assert.ok(invoked.includes(c), `"${c}" is a channel the preload calls (rename it here if it moved)`);
  assert.ok(!simChannelOpen(c), `"${c}" reaches an agent app: it must not be open under the simulator`);
}
// handler blocks, as test-ipcchannels splits them
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));
const blocks = new Map<string, string>();
for (const f of walk(path.join(ROOT, 'src', 'main'))) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  const starts = [...src.matchAll(/\bipc(?:Handle|On)\(\s*'([^']+)'/g)];
  starts.forEach((m, i) => blocks.set(m[1], src.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : src.length)));
}
const SPENDS = /\brouter\b|\bregistry\b|\baddWorkspace\b|\baddMany\b|generateText|\bspawn\b|harnessSetup\.(?!plans\b)\w+|adaptersList|forAgent|\.instance\(|Op\(|prevSessions|remoteOps|scheduler/;
const open = Object.keys(SIM_OPEN_CHANNELS);
assert.ok(open.length <= 3, `the open list stays short (${open.length}): the simulator's window has its own canned answers`);
for (const c of open) {
  assert.ok(blocks.has(c), `open channel "${c}" is registered`);
  assert.ok(SIM_OPEN_CHANNELS[c].length > 20, `open channel "${c}" says why`);
  const hit = SPENDS.exec(blocks.get(c) as string);
  assert.ok(!hit, `open channel "${c}" must not reach an agent app (its handler names ${hit?.[0]})`);
}
// the heuristic still recognises the obvious ones, so it is not vacuous
for (const c of ['theme:generate', 'agents:addFolder', 'sessions:resume', 'harness:run', 'adapters:list']) assert.ok(SPENDS.test(blocks.get(c) ?? ''), `the scan sees "${c}" reach an agent app`);

// ---- 3. main.ts and ipcguard.ts wiring ----
const mainSrc = read('src/main/main.ts');
assert.ok(/createRegistry\(simGuardDescriptors\(\[\.\.\.PRODUCTION_DESCRIPTORS, \.\.\.offeredDescriptors\(dev\)\], SIMULATOR\)\)/.test(mainSrc), 'main.ts builds the registry through simGuardDescriptors (FR-024)');
assert.strictEqual((mainSrc.match(/\bcreateRegistry\(/g) ?? []).length, 1, 'main.ts creates one registry');
assert.ok(/const SIMULATOR = simulatorOn\(dev\);/.test(mainSrc), 'main.ts decides simulator mode with simulatorOn (FR-022)');
assert.ok(/if \(SIMULATOR\)[^\n]*\n\s*else scheduler\.start\(\);/.test(mainSrc), 'the scheduler is not started under the simulator (FR-025)');
assert.strictEqual((mainSrc.match(/scheduler\.start\(\)/g) ?? []).length, 1, 'one place starts the scheduler');
assert.ok(/if \(open\.length && SIMULATOR\)[^\n]*\n\s*else if \(open\.length\) void addMany\(/.test(mainSrc), 'DURBAR_OPEN is ignored under the simulator (FR-025)');
assert.ok(/if \(SIMULATOR\) \{\s*\n\s*query\.sim = /.test(mainSrc), 'the window simulates exactly when main guards (FR-022)');
assert.ok(!/dev\.DURBAR_SIM\b(?!_)/.test(mainSrc), 'main.ts reads DURBAR_SIM only through simulatorOn');
assert.ok(/createdAdapters: \(\) => router\.created\(\)/.test(mainSrc), 'the driver context reports the created adapters (FR-026)');
const guardSrc = read('src/main/ipcguard.ts');
assert.ok(/simulator \?\?= simulatorOn\(devEnv\(process\.env, app\.isPackaged\)\);/.test(guardSrc), 'ipcguard decides with devEnv (packaged builds have no hooks)');
assert.ok(/fromAppFrame\(e\)\) throw [^\n]*\n\s*if \(!simAllows\(channel\)\) throw new Error\(simRefusal\(channel\)\);\n\s*return fn\(/.test(guardSrc), 'ipcHandle refuses before the handler');
assert.ok(/if \(fromAppFrame\(e\) && simAllows\(channel\)\) fn\(/.test(guardSrc), 'ipcOn drops before the handler');

// ---- 4. the stand-in adapter (FR-024) ----
{
  let created = 0;
  const caps = { capUnit: 'credits' } as unknown as AdapterDescriptor['capabilities'];
  const d: AdapterDescriptor = { id: 'spy', displayName: 'Spy', capabilities: caps, create: () => { created++; return {} as AgentAdapter; } };
  const off = simGuardDescriptors([d], false);
  assert.strictEqual(off[0].create, d.create, 'off: the descriptors are unchanged');
  const on = simGuardDescriptors([d], true);
  assert.notStrictEqual(on[0].create, d.create);
  const ad = on[0].create();
  assert.strictEqual(created, 0, 'the real create is never called under the simulator');
  assert.ok(isSimBlocked(ad) && !isSimBlocked({}) && !isSimBlocked(null));
  assert.strictEqual(ad.id, 'spy'); assert.strictEqual(ad.displayName, 'Spy'); assert.strictEqual(ad.capabilities, caps);
  assert.strictEqual(ad.isLive('x'), false);
  assert.strictEqual(typeof ad.onEvent(() => undefined), 'function');
  void ad.dispose();
  ad.debug = () => undefined; ad.writeGuard = undefined;
  assert.strictEqual(typeof ad.debug, 'function', 'debug can be set (the router sets it)');
  assert.strictEqual((ad as unknown as { then?: unknown }).then, undefined, 'not a thenable');
  assert.throws(() => { (ad as unknown as Record<string, unknown>).id = 'other'; }, TypeError, 'other members cannot be set');
  const r = ad as unknown as Record<string, (...a: unknown[]) => unknown>;
  // required members (and names added later) exist and throw the refusal; optional members follow the capabilities (FR-028, below)
  for (const m of ['start', 'send', 'stop', 'generateProfile', 'somethingAddedLater']) {
    assert.throws(() => r[m]('a', 'b'), (e: Error) => e.message === simRefusal(`spy.${m}`), `${m} throws the refusal`);
  }
  assert.strictEqual(blockedAdapter(d).id, 'spy');
}

// ---- 4b. the stand-in's optional members agree with its capabilities, as contract C2 asks of a real adapter (FR-028, review on #514) ----
{
  const inIface = interfaceOptionalMembers().sort();
  assert.deepStrictEqual(Object.keys(SIM_OPTIONAL_MEMBERS).sort(), inIface, 'SIM_OPTIONAL_MEMBERS lists exactly the optional members of interface AgentAdapter');
  const full = {
    capUnit: 'credits', interrupt: true, models: true, history: true, caps: true, mcpToggle: true, mcpRestart: true, mcpTools: true, handoff: true,
    oneShot: true, remote: true, renameSession: 'any', deleteSession: true, mcpSignIn: true, permModeSwitch: 'live',
  };
  const none = { capUnit: 'credits', permModeSwitch: 'none' };
  for (const [tag, caps] of [['all on', full], ['all off', none], ['some', { ...none, history: true, mcpSignIn: true, permModeSwitch: 'live' }]] as const) {
    const d: AdapterDescriptor = { id: 'c2', displayName: 'C2', capabilities: caps as unknown as AdapterDescriptor['capabilities'], create: () => ({}) as AgentAdapter };
    const ad = simGuardDescriptors([d], true)[0].create() as unknown as Record<string, unknown>;
    for (const m of inIface) {
      const gate = SIM_OPTIONAL_MEMBERS[m];
      const want = !!gate && gate(d.capabilities);
      assert.strictEqual(typeof ad[m] === 'function', want, `${tag}: typeof ${m} follows the capabilities`);
      assert.strictEqual(m in ad, want, `${tag}: "${m}" in the stand-in agrees with typeof`);
      if (want) assert.throws(() => (ad[m] as (...a: unknown[]) => unknown)('a'), (e: Error) => e.message === simRefusal(`c2.${m}`), `${tag}: ${m} throws the refusal`);
    }
    assert.ok('start' in ad && typeof ad.start === 'function', `${tag}: a required member exists (and refuses)`);
  }
  // the gates are the contract's: with every capability on, every gated member exists; with none, none does
  const gated = inIface.filter((m) => SIM_OPTIONAL_MEMBERS[m]);
  assert.ok(gated.length >= 17, 'the C2 members are gated');
}

console.log('simguard: simulatorOn, the spending list, the open list, main.ts wiring and the stand-in adapter pass');

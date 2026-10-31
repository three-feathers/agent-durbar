/**
 * Spec 010 FR-022..FR-026 (incident on PR #505, 2026-10-22): under `DURBAR_SIM` main never reaches a real agent app.
 * `npm run test:simguard`. No Electron (a stand-in `electron` module), no network, no credits.
 *
 *  1. the real ipcguard.ts, loaded with DURBAR_SIM=15, refuses every channel the preload calls except SIM_OPEN_CHANNELS, before the
 *     handler runs; without DURBAR_SIM (or with 0 / text) the same calls reach their handlers;
 *  2. every channel that starts or talks to an agent app (the list in the spec) is registered and not open; an open channel's handler
 *     names no adapter, router, addWorkspace, generateText, spawn or install run;
 *  3. main.ts builds the registry through simGuardDescriptors and gates the scheduler and DURBAR_OPEN on simulatorOn;
 *  4. the stand-in adapter: the real create is never called, every member but the inert ones throws the refusal;
 *  5. FR-030: under the simulator detection and the sign-in check start no child process (child_process replaced by counting spies),
 *     and sealChildProcess refuses every starter; FR-031: ipcguard takes main's decision (initSimGuard) and refuses to register before it.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { CHILD_PROCESS_STARTERS, SIM_DETECT_HINT, SIM_OPEN_CHANNELS, SIM_OPTIONAL_MEMBERS, blockedAdapter, isSimBlocked, sealChildProcess, simChannelOpen, simDetectorFor, simGuardDescriptors, simRefusal, simulatorOn } from '../src/main/simguard';
import { preloadChannels, stripComments } from './ipc-channel-list';
import { interfaceOptionalMembers } from './test-adapter-contract';
import type { AdapterDescriptor, DetectResult } from '../src/adapters/capabilities';
import type { AgentAdapter } from '../src/adapters/types';

const ROOT = path.join(__dirname, '..', '..');
const read = (f: string): string => stripComments(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n'));

// ---- FR-022: one rule, the window's ----
for (const [v, on] of [['15', true], ['1', true], [' 12 ', true], ['40', true], ['0', false], ['', false], [undefined, false], ['abc', false], ['15abc', false], ['-3', false], ['1.5', false], ['true', false]] as const) {
  assert.strictEqual(simulatorOn({ DURBAR_SIM: v }), on, `DURBAR_SIM=${JSON.stringify(v)} -> ${on}`);
}
assert.strictEqual(simulatorOn({}), false, 'no hooks (a packaged build) -> off');

// ---- 1. the shipped ipcguard decision, under a stand-in electron ----
const { invoked, sent } = preloadChannels(); // the same list test:ipcchannels checks (FR-029)
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

interface Guard { initSimGuard: (on: boolean) => void; ipcHandle: (c: string, f: (...a: unknown[]) => unknown) => void; ipcOn: (c: string, f: (...a: unknown[]) => void) => void; simRefusedChannels: () => string[] }
/** A fresh ipcguard module with main's decision handed in, as main.ts does (FR-031): `simulatorOn` of the given DURBAR_SIM. */
function loadGuard(sim: string | undefined): Guard {
  delete require.cache[require.resolve(guardFile)];
  handles.clear();
  ons.clear();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const g = require(guardFile) as Guard;
  // FR-031: registering before main's decision throws (it would otherwise guess); so does changing the decision later
  assert.throws(() => g.ipcHandle('x:y', () => 'ok'), /initSimGuard\(SIMULATOR\) must run before "x:y"/);
  assert.throws(() => g.ipcOn('x:z', () => undefined), /initSimGuard/);
  assert.strictEqual(handles.size + ons.size, 0, 'nothing is registered before initSimGuard');
  const on = simulatorOn({ DURBAR_SIM: sim });
  g.initSimGuard(on);
  g.initSimGuard(on); // the same value again is fine
  assert.throws(() => g.initSimGuard(!on), /already decided/);
  return g;
}

async function run(sim: string | undefined): Promise<{ ran: Set<string>; refused: Map<string, string>; recorded: string[] }> {
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
  return { ran, refused, recorded: g.simRefusedChannels() };
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
  // FR-032 (review on #514): the guard records every refused channel once (the driver's simRefused()); the open ones never
  assert.deepStrictEqual([...sim.recorded].sort(), [...invoked, ...sent].filter((c) => !simChannelOpen(c)).sort(), 'DURBAR_SIM: simRefusedChannels() lists exactly the refused channels');
  assert.ok(simChannelOpen('app:version'), 'FR-032: app:version (renderer.ts, every page load) is open under the simulator');
  // the sender check still comes first: a foreign frame gets the old refusal, not the simulator's
  {
    const foreign = { senderFrame: { url: 'https://example.com/' }, sender: { mainFrame: {} } };
    await assert.rejects(async () => handles.get('theme:generate')!(foreign), /did not come from its own window/);
  }
  for (const v of [undefined, '0', 'abc']) {
    const real = await run(v);
    assert.deepStrictEqual(real.recorded, [], `DURBAR_SIM=${String(v)}: nothing is recorded as refused`);
    assert.strictEqual(real.refused.size, 0, `DURBAR_SIM=${String(v)}: nothing is refused (${[...real.refused.keys()].join(', ')})`);
    for (const c of [...invoked, ...sent]) assert.ok(real.ran.has(c), `DURBAR_SIM=${String(v)}: "${c}" reaches its handler`);
  }
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
  'agents:listProfiles', 'agents:selectProfile', 'agents:mcp', 'agents:setMcp', 'agents:mcpSignIn', 'agents:mcpOpenSignIn', 'agents:mcpCancelSignIn', 'agents:setRemote', 'agents:openRemote',
  'sessions:listPrevious', 'sessions:rename', 'sessions:delete',
  'adapters:list', 'models:list',
  'harness:run', 'harness:paste', 'harness:cancel', 'harness:copilotAuth', 'harness:accounts', 'harness:openSignIn', 'harness:updates',
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
assert.ok(open.filter((c) => !c.startsWith('browser:')).length <= 3 && open.length <= 24, `the open list stays short (${open.length}): the simulator's window has its own canned answers; only the session browser's channels (spec 080 T014, T023 page tabs) are added`);
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
// FR-031: one decision. main.ts hands SIMULATOR to the guard right after deciding it, before the first register* call; the guard reads no environment
assert.ok(!/process\.env|devEnv|simulatorOn\(/.test(guardSrc), 'ipcguard reads no environment: the mode is main.ts\'s (FR-031)');
assert.ok(/const SIMULATOR = simulatorOn\(dev\);\n\s*initSimGuard\(SIMULATOR\);/.test(mainSrc), 'main.ts calls initSimGuard(SIMULATOR) right after deciding (FR-031)');
{
  const init = mainSrc.indexOf('initSimGuard(SIMULATOR)');
  const firstReg = mainSrc.search(/\bregister\w*\(\{/);
  assert.ok(init > 0 && firstReg > init, 'initSimGuard runs before the first register*() call (FR-031)');
  // FR-030: the seal comes right after, detection goes through simDetectorFor, the sign-in check asks nothing, the driver can count
  assert.ok(/initSimGuard\(SIMULATOR\);[^\n]*\n[^\n]*\n\s*const childSeal = SIMULATOR \? sealChildProcess\(childProcess as unknown as Record<string, unknown>\) : undefined;/.test(mainSrc), 'main.ts seals child_process under the simulator before anything is registered (FR-030)');
  assert.ok(/^import childProcess = require\('child_process'\);$/m.test(mainSrc), 'the seal gets the real child_process module object (an import-equals, not an importStar copy)');
  assert.ok(/detectAll\(registry, simDetectorFor\(SIMULATOR, detectorFor\)\)/.test(mainSrc), 'adaptersList detects through simDetectorFor(SIMULATOR, ...) (FR-030)');
  assert.strictEqual((mainSrc.match(/\bdetectAll\(/g) ?? []).length, 1, 'one detection call in main.ts');
  assert.strictEqual((mainSrc.match(/\bdetectorFor\b/g) ?? []).length, 2, 'detectorFor is only imported and handed to simDetectorFor');
  assert.ok(/const signInCheck = [^\n]*\n\s*if \(SIMULATOR\) return undefined;/.test(mainSrc), 'the sign-in check asks nothing under the simulator (FR-030)');
  assert.ok(/childProcessAttempts: \(\) => childSeal\?\.tried\(\)/.test(mainSrc), 'the driver context reports child process attempts (FR-030)');
}
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
    oneShot: true, remote: true, autopilot: { capUnit: 'aiu', attachments: true, planApproval: true, verified: false }, renameSession: 'any', deleteSession: true, mcpSignIn: true, permModeSwitch: 'live',
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

// ---- 5. FR-030 (review on #514): detection and sign-in under the simulator start no process; the seal refuses every starter ----
{
  // the canned detector never calls the real one; off, it does
  let realCalls = 0;
  const spyReal = (): ((d: AdapterDescriptor) => Promise<DetectResult>) => { realCalls++; return () => Promise.resolve({ state: 'ready' }); };
  const desc = { id: 'claude', displayName: 'Claude Code', capabilities: {} } as unknown as AdapterDescriptor;
  // the seal: every starter throws the refusal and is counted; the original is never called
  let origCalls = 0;
  const fake: Record<string, unknown> = Object.fromEntries(CHILD_PROCESS_STARTERS.map((n) => [n, () => { origCalls++; }]));
  const seal = sealChildProcess(fake);
  for (const n of CHILD_PROCESS_STARTERS) assert.throws(() => (fake[n] as (...a: unknown[]) => unknown)('/usr/bin/claude', ['--version']), (e: Error) => e.message === simRefusal(`child_process.${n}`), `sealed ${n} refuses`);
  assert.strictEqual(origCalls, 0, 'the sealed starters never call the original');
  assert.strictEqual(seal.attempts(), CHILD_PROCESS_STARTERS.length, 'each attempt is counted');
  assert.ok(seal.tried().every((t) => t.endsWith(' claude')), 'an attempt names only the program, never a path');
  assert.ok(CHILD_PROCESS_STARTERS.length === 7 && CHILD_PROCESS_STARTERS.includes('fork' as never), 'all seven starters are sealed');

  // the real child_process, replaced by counting spies that never start anything
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cp = require('child_process') as Record<string, unknown>;
  const saved = Object.fromEntries(CHILD_PROCESS_STARTERS.map((n) => [n, cp[n]]));
  const calls: string[] = [];
  for (const n of CHILD_PROCESS_STARTERS) {
    cp[n] = (file: string, ...rest: unknown[]) => {
      calls.push(`${n} ${file}`);
      const cb = rest.find((r) => typeof r === 'function') as ((e: Error | null, so: string, se: string) => void) | undefined;
      const err = Object.assign(new Error('spy: not started'), { code: 'ENOENT' });
      if (cb) setImmediate(() => cb(err, '', ''));
      else if (n.endsWith('Sync')) throw err;
      return { on: () => undefined, kill: () => undefined, stdout: null, stderr: null, pid: undefined };
    };
  }
  const restore = (): void => { for (const n of CHILD_PROCESS_STARTERS) cp[n] = saved[n]; };
  (async () => {
    try {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { detectorFor, nodeExec } = require('../src/adapters/detect') as typeof import('../src/adapters/detect');
      const { createRegistry, detectAll } = require('../src/adapters/registry') as typeof import('../src/adapters/registry');
      const { PRODUCTION_DESCRIPTORS } = require('../src/adapters/descriptors') as typeof import('../src/adapters/descriptors');
      const { offeredDescriptors } = require('../src/adapters/experimental') as typeof import('../src/adapters/experimental');
      const { withSignIn } = require('../src/main/authcheck') as typeof import('../src/main/authcheck');
      /* eslint-enable @typescript-eslint/no-require-imports */
      // the spy sees the real exec path (so zero below means nothing ran, not a blind spy)
      await nodeExec('claude', ['--version'], { timeoutMs: 100 });
      assert.deepStrictEqual(calls, ['execFile claude'], 'the spy sees nodeExec (positive control)');
      calls.length = 0;
      // what adaptersList does under the simulator: stand-in registry, canned detection, sign-in check through the stand-ins
      const registry = createRegistry(simGuardDescriptors([...PRODUCTION_DESCRIPTORS, ...offeredDescriptors({})], true)); // as main.ts builds it
      const infos = await detectAll(registry, simDetectorFor(true, detectorFor));
      assert.deepStrictEqual(infos.map((i) => i.id), ['copilot', 'claude', 'codex'], 'Copilot, Claude Code and Codex are detected');
      assert.ok(infos.every((i) => i.state === 'ready' && i.hint === SIM_DETECT_HINT), 'every adapter is canned ready under the simulator');
      const signedIn = await withSignIn(infos, () => undefined); // main.ts's signInCheck returns undefined under the simulator
      assert.deepStrictEqual(signedIn.map((i) => i.state), infos.map((i) => i.state));
      assert.deepStrictEqual(calls, [], `no child process under the simulator during detection (got ${calls.join(', ')})`);
      // the canned detector never asks the real one; off, the real one is asked
      await simDetectorFor(true, spyReal)(desc);
      assert.strictEqual(realCalls, 0, 'simDetectorFor(true) never calls the real detector');
      await simDetectorFor(false, spyReal)(desc);
      assert.strictEqual(realCalls, 1, 'simDetectorFor(false) uses the real detector');
      assert.deepStrictEqual(await simDetectorFor(false, () => undefined)(desc), { state: 'unknown' }, 'off, an adapter without a detector is unknown (as before)');
      console.log('simguard: detection under the simulator started 0 child processes; the seal refuses all 7 starters');
    } finally {
      restore();
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

console.log('simguard: simulatorOn, the spending list, the open list, main.ts wiring and the stand-in adapter pass');

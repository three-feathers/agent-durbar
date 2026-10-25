/**
 * CodexAdapter on the scripted in-memory app-server (spec 012 T043a, FR-089..FR-099). `npm run test:runtime`.
 * No process, no Codex, no account, no credits: every child is `scripts/fakes/codex-app-server.ts`.
 * The contract suite (test-adapter-contract.ts) covers the shared behaviour; this file covers what it does not:
 * wire params, the FR-087 refusals, crash, stop, fixtures, and the approval/interrupt wiring.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { offeredDescriptors } from '../src/adapters/experimental';
import { CODEX_CAPABILITIES, CODEX_DESCRIPTOR, CodexAdapter, codexChildEnv, linuxSandboxHint, macSandboxHint } from '../src/adapters/codex';
import { CodexMapper } from '../src/adapters/codexMap';
import { CODEX_INITIALIZE_CAPABILITIES, codexProfileArgs, codexSpawnPath, codexWorkspaceRoots } from '../src/adapters/codexModes';
import { PRODUCTION_DESCRIPTORS } from '../src/adapters/descriptors';
import type { AgentEvent, PermissionMode } from '../src/adapters/types';
import { eventProblems } from '../src/adapters/eventguard';
import { FakeCodexServer } from './fakes/codex-app-server';
import type { FakeCodexOptions } from './fakes/codex-app-server';

const BIN = path.join(os.tmpdir(), 'fake-codex-bin');
/** FR-087: a refusal never offers the widest mode as the way out. */
const noFallback = (e: Error): boolean => !/Allow all/i.test(e.message);
const tmp: string[] = [];
const dir = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-codex-'));
  tmp.push(d);
  return d;
};

interface Setup {
  server?: FakeCodexOptions;
  version?: string | undefined;
  binary?: string;
  platform?: string;
  env?: NodeJS.ProcessEnv;
}
function make(s: Setup = {}) {
  const server = new FakeCodexServer(s.server);
  const ad = new CodexAdapter({
    spawn: server.spawn,
    locate: async () => ({ path: s.binary ?? BIN, version: 'version' in s ? s.version : '0.163.0' }),
    platform: s.platform ?? 'linux',
    env: s.env ?? {},
    appVersion: '9.9.9',
    closeGraceMs: 20,
    killGraceMs: 20,
  });
  const events: AgentEvent[] = [];
  ad.onEvent((e) => events.push(e));
  const debug: string[] = [];
  ad.debug = (m) => debug.push(m);
  return { server, ad, events, debug };
}
const strip = (e: unknown): Record<string, unknown> => {
  const { sessionId: _s, timestamp: _t, ...rest } = e as Record<string, unknown>;
  return JSON.parse(JSON.stringify(rest)) as Record<string, unknown>; // undefined fields are not on the wire either
};
const settle = (ms = 5): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, f: () => T | undefined, ms = 1000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v !== undefined && (v as unknown) !== false) return v; // `false` means "not yet", like undefined (a boolean condition used to pass at once)
    if (Date.now() > end) throw new assert.AssertionError({ message: `timed out waiting for ${what}` });
    await settle(2);
  }
}
const pendingOf = (events: AgentEvent[]) => events.find((e): e is Extract<AgentEvent, { type: 'status' }> => e.type === 'status' && e.status === 'needs-permission' && e.permission?.state === 'pending')?.permission;
/** A promise that must settle soon: a hang is a named failure, never a silent exit. */
async function settles<T>(what: string, p: Promise<T>, ms = 1000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new assert.AssertionError({ message: `${what}: still waiting after ${ms}ms` })), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
const req = (server: FakeCodexServer, method: string, params: unknown, child?: ReturnType<FakeCodexServer['childOfThread']>) => settles(`server request ${method}`, server.serverRequest(method, params, child));
let finished = false;
process.on('beforeExit', () => {
  if (!finished) {
    console.error('codex adapter: did not finish (a promise never settled)');
    process.exitCode = 1;
  }
});
const decisions = (server: FakeCodexServer): unknown[] => server.replies.map((r) => (r.result as { decision?: unknown } | undefined)?.decision);

async function main(): Promise<void> {
  // ---- FR-089: capabilities and optional members
  {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(CODEX_CAPABILITIES)), {
      interrupt: true, resume: true, images: true, models: true, planMode: true, effort: true, modelSwitch: { verified: true, contextTier: false },
      permissionModes: ['read-only', 'ask', 'allow'], permModeSwitch: 'next-message',
      usage: { tokens: true, costUsd: false, nanoAiu: false }, context: true, caps: false, helpers: true, history: true, mcpStatus: true, mcpToggle: true, mcpStart: 'session', mcpToggleApplies: 'next-message', mcpTools: true, mcpToolFilter: true, mcpRestart: false, handoff: true, oneShot: true, deleteSession: true, renameSession: 'any', osSandbox: true,
    });
    assert.ok(Object.isFrozen(CODEX_CAPABILITIES) && Object.isFrozen(CODEX_CAPABILITIES.permissionModes) && Object.isFrozen(CODEX_CAPABILITIES.usage), 'capabilities are deeply frozen');
    const { ad } = make();
    for (const m of ['interrupt', 'resolvePermission', 'revokeGrant']) assert.strictEqual(typeof (ad as unknown as Record<string, unknown>)[m], 'function', `${m} is present`);
    for (const m of ['setCap', 'resolveLimit', 'cancelQueuedModel', 'compact']) assert.strictEqual((ad as unknown as Record<string, unknown>)[m], undefined, `${m} is absent`);
    for (const m of ['listModelOptions', 'listPreviousSessions', 'history', 'setPermMode', 'resumeIdOf', 'setModel']) assert.strictEqual(typeof (ad as unknown as Record<string, unknown>)[m], 'function', `${m} is there (FR-141..FR-144)`);
    assert.strictEqual(ad.capabilities, CODEX_CAPABILITIES);
    // D1 option B: described, but not in the production list.
    assert.strictEqual(CODEX_DESCRIPTOR.capabilities, CODEX_CAPABILITIES);
    assert.ok(CODEX_DESCRIPTOR.create() instanceof CodexAdapter);
    assert.ok(!PRODUCTION_DESCRIPTORS.some((d) => d.id === 'codex'), 'codex is not a production descriptor');
    assert.ok(offeredDescriptors({}).includes(CODEX_DESCRIPTOR), 'codex is offered next to Copilot (FR-135/FR-145)');
  }

  // ---- FR-090 / criterion 2: argv, no shell, handshake order
  {
    const env = { SOME_VAR: 'visible-to-child' };
    const { server, ad } = make({ env });
    const ws = dir();
    const sid = await ad.start({ workspace: ws, permissionMode: 'ask', quiet: true });
    assert.strictEqual(server.spawns.length, 1, 'one child for one session');
    const sp = server.spawns[0];
    assert.strictEqual(sp.file, BIN);
    assert.deepStrictEqual(sp.args, ['app-server', ...codexProfileArgs()], 'argv is exactly app-server plus the profile args');
    assert.strictEqual(sp.options.shell, false, 'no shell');
    assert.strictEqual(sp.options.cwd, ws);
    assert.deepStrictEqual(sp.options.env, env, 'the child gets the injected environment');
    const methods = server.wire.map((w) => w.method);
    assert.deepStrictEqual(methods, ['initialize', 'initialized', 'thread/start'], 'initialize, initialized, then thread/start (a quiet start reads the MCP list with its first message, FR-147)');
    const init = server.requests('initialize')[0].params as Record<string, unknown>;
    assert.deepStrictEqual(init.capabilities, CODEX_INITIALIZE_CAPABILITIES);
    assert.deepStrictEqual(init.clientInfo, { name: 'agent_durbar', title: 'Agent Durbar', version: '9.9.9' });
    assert.strictEqual(server.requests('initialized')[0].id, undefined, 'initialized is a notification');
    // one child per session (D2)
    const sid2 = await ad.start({ workspace: ws, permissionMode: 'ask', quiet: true });
    assert.strictEqual(server.spawns.length, 2);
    assert.notStrictEqual(sid, sid2);
    await ad.dispose();
    await server.flush();
    assert.deepStrictEqual(server.live, [], 'dispose leaves no child');
  }

  // ---- FR-091 / criterion 3: thread/start and turn/start fields per mode, with two session folders
  {
    const a = dir();
    const b = dir();
    const wsFile = path.join(dir(), 'x.code-workspace');
    fs.writeFileSync(wsFile, JSON.stringify({ folders: [{ path: a }, { path: b }] }));
    const roots = codexWorkspaceRoots([a, a, b], fs.realpathSync.native);
    assert.strictEqual(roots.length, 2);
    for (const mode of ['read-only', 'ask', 'allow'] as PermissionMode[]) {
      const { server, ad } = make();
      const sid = await ad.start({ workspace: wsFile, permissionMode: mode, quiet: true });
      const ts = server.requests('thread/start')[0].params as Record<string, unknown>;
      if (mode === 'allow') {
        assert.deepStrictEqual(ts, { cwd: a, approvalPolicy: 'never', sandbox: 'danger-full-access' });
      } else {
        assert.deepStrictEqual(ts, { cwd: fs.realpathSync.native(a), approvalPolicy: mode === 'ask' ? 'on-request' : 'never', permissions: 'durbar_ro', runtimeWorkspaceRoots: roots });
        assert.ok(!('sandbox' in ts), `${mode}: no sandbox key on thread/start`);
      }
      await ad.send(sid, { text: 'hello', attachments: [{ path: path.join(a, 'p.png'), kind: 'image' }, { path: path.join(a, 'n.txt'), kind: 'file' }] });
      await server.flush();
      const tp = server.requests('turn/start')[0].params as Record<string, unknown>;
      assert.strictEqual(tp.threadId, sid);
      assert.deepStrictEqual(tp.input, [
        { type: 'text', text: 'hello' },
        { type: 'text', text: `Attached file: ${path.join(a, 'n.txt')}` },
        { type: 'localImage', path: path.join(a, 'p.png') },
      ]);
      if (mode === 'allow') {
        assert.deepStrictEqual(tp.sandboxPolicy, { type: 'dangerFullAccess' });
        assert.ok(!('permissions' in tp) && !('sandbox' in tp) && !('runtimeWorkspaceRoots' in tp), 'allow: no permissions, no sandbox string, no roots on turn/start');
        assert.strictEqual(tp.approvalPolicy, 'never');
      } else {
        assert.strictEqual(tp.permissions, 'durbar_ro');
        assert.deepStrictEqual(tp.runtimeWorkspaceRoots, roots);
        assert.ok(!('sandbox' in tp) && !('sandboxPolicy' in tp), `${mode}: no sandbox key and no sandboxPolicy on turn/start`);
        assert.strictEqual(tp.approvalPolicy, mode === 'ask' ? 'on-request' : 'never');
      }
      await ad.dispose();
    }
    // an unknown mode is Read-only (constitution III)
    const { server, ad } = make();
    await ad.start({ workspace: a, permissionMode: 'bogus' as unknown as PermissionMode, quiet: true });
    const ts = server.requests('thread/start')[0].params as Record<string, unknown>;
    assert.strictEqual(ts.permissions, 'durbar_ro');
    assert.ok(!('sandbox' in ts));
    await ad.dispose();
  }

  // ---- FR-091 / criterion 3 (FR-087, D4): refusals. Read-only and Ask first are refused; Allow all still starts.
  {
    const ws = dir();
    const rootDir = path.parse(os.tmpdir()).root;
    const cases: Array<{ name: string; setup: Setup; workspace?: string; reason: RegExp; allowSpawns?: number }> = [
      { name: 'an old version', setup: { version: '0.162.0' }, reason: /too old.*Upgrade Codex/ },
      { name: 'a pre-release of the minimum', setup: { version: '0.163.0-alpha.1' }, reason: /too old/ },
      { name: 'an unreadable version', setup: { version: undefined }, reason: /version could not be read/ },
      { name: 'no experimentalApi', setup: { server: { initialize: 'refuse-experimental' } }, reason: /experimental API/, allowSpawns: 2 },
      { name: 'win32 unelevated', setup: { platform: 'win32' }, reason: /Windows/ },
      { name: 'an empty roots list', setup: {}, workspace: rootDir, reason: /no folder/ },
    ];
    for (const c of cases) {
      for (const mode of ['read-only', 'ask'] as PermissionMode[]) {
        const { server, ad, events } = make(c.setup);
        await assert.rejects(() => ad.start({ workspace: c.workspace ?? ws, permissionMode: mode, quiet: false }), (e: Error) => c.reason.test(e.message) && noFallback(e), `${c.name} / ${mode}: refused with its reason and no Allow all fallback`);
        await server.flush();
        await settle();
        assert.strictEqual(server.requests('thread/start').length, 0, `${c.name} / ${mode}: no thread/start was sent`);
        if (c.name === 'no experimentalApi') assert.strictEqual(server.spawns.length, 1, `${mode}: no second child for a limited mode`);
        assert.deepStrictEqual(server.live, [], `${c.name} / ${mode}: no child is left running`);
        assert.deepStrictEqual(events, [], `${c.name} / ${mode}: a refused start emits no event`);
        assert.strictEqual(ad.isLive('thr_1'), false);
      }
      const { server, ad } = make(c.setup);
      const sid = await ad.start({ workspace: c.workspace ?? ws, permissionMode: 'allow', quiet: true });
      assert.ok(ad.isLive(sid), `${c.name}: Allow all still starts`);
      const ts = server.requests('thread/start')[0].params as Record<string, unknown>;
      assert.strictEqual(ts.sandbox, 'danger-full-access');
      assert.ok(!('permissions' in ts));
      assert.strictEqual(server.spawns.length, c.allowSpawns ?? 1, `${c.name}: Allow all spawn count`);
      if (c.name === 'no experimentalApi') {
        assert.ok(server.spawns[0].child.exited, 'the first child (refused handshake) was closed');
        assert.deepStrictEqual(server.requests('initialize').map((w) => (w.params as Record<string, unknown>).capabilities !== undefined), [true, false], 'the retry carries no experimental capability');
      }
      await ad.dispose();
    }
    // D4: a .cmd/.bat shim is refused in every mode, Allow all included, with the advice; nothing is spawned
    for (const binary of ['C:\\Users\\x\\AppData\\Roaming\\npm\\codex.CMD', '/opt/codex.bat']) {
      for (const mode of ['read-only', 'ask', 'allow'] as PermissionMode[]) {
        const { server, ad, events } = make({ binary });
        await assert.rejects(() => ad.start({ workspace: ws, permissionMode: mode }), (e: Error) => /\.cmd launcher/.test(e.message) && e.message.includes('native codex.exe'), `${binary} / ${mode}: refused with the advice`);
        assert.strictEqual(server.spawns.length, 0, `${binary} / ${mode}: nothing spawned`);
        assert.deepStrictEqual(events, []);
      }
    }
    // FR-162 (#660, openai/codex#41493): the RESOLVED codex is spawned (macOS current_exe() is the unresolved link, unreadable
    // under the read-limited seatbelt profile), for sessions and probes alike; the install root stays the resolved folder
    {
      const LINK = '/opt/homebrew/bin/codex';
      const REAL = '/opt/homebrew/Caskroom/codex/0.163.0/bin/codex';
      const NPM_LINK = '/usr/local/bin/codex';
      const NPM_REAL = '/usr/local/lib/node_modules/@openai/codex/bin/codex.js';
      const links: Record<string, string> = { [LINK]: REAL, [NPM_LINK]: NPM_REAL, 'C:\\tools\\codex.exe': 'D:\\pkg\\codex\\codex.exe', 'C:\\tools\\codex': 'C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js', '/usr/bin/codex': '/opt/x/codex.cmd' };
      const fakeReal = (p: string): string => {
        if (p in links) return links[p];
        if (Object.values(links).includes(p) || p.startsWith(ws) || p.startsWith(os.tmpdir())) return fs.existsSync(p) ? fs.realpathSync.native(p) : p;
        throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
      };
      const mk = (binary: string, platform = 'darwin') => {
        const server = new FakeCodexServer();
        const ad = new CodexAdapter({ spawn: server.spawn, locate: async () => ({ path: binary, version: '0.163.0' }), platform, env: {}, realpath: fakeReal, closeGraceMs: 20, killGraceMs: 20 });
        return { server, ad };
      };
      const profileOf = (args: readonly string[]): string => args.find((a) => a.startsWith('permissions.durbar_ro.filesystem=')) ?? '';
      for (const mode of ['read-only', 'ask', 'allow'] as PermissionMode[]) {
        const { server, ad } = mk(LINK);
        await ad.start({ workspace: ws, permissionMode: mode });
        assert.strictEqual(server.spawns[0].file, REAL, `${mode}: the resolved Homebrew binary is spawned, not the link`);
        assert.notStrictEqual(server.spawns[0].file, LINK);
        const prof = profileOf(server.spawns[0].args as string[]);
        assert.ok(prof.includes('"/opt/homebrew/Caskroom/codex/0.163.0"="read"'), `${mode}: the install root is the resolved folder: ${prof}`);
        assert.ok(!prof.includes('/opt/homebrew/bin'), `${mode}: the profile is not widened to the link's folder`);
        await ad.dispose();
      }
      {
        // a probe (previous sessions) spawns the resolved path too
        const { server, ad } = mk(LINK);
        await ad.listPreviousSessions(ws).catch(() => undefined);
        assert.ok(server.spawns.length >= 1 && server.spawns.every((x) => x.file === REAL), 'probes spawn the resolved binary');
        await ad.dispose();
      }
      {
        // npm: the link resolves to bin/codex.js, spawned as it is on macOS and Linux (shebang); install root = the package
        for (const platform of ['darwin', 'linux']) {
          const { server, ad } = mk(NPM_LINK, platform);
          await ad.start({ workspace: ws, permissionMode: 'read-only' });
          assert.strictEqual(server.spawns[0].file, NPM_REAL, `${platform}: npm codex.js spawned`);
          assert.ok(profileOf(server.spawns[0].args as string[]).includes('"/usr/local/lib/node_modules/@openai/codex"="read"'));
          await ad.dispose();
        }
      }
      {
        // a link that resolves to a .cmd/.bat is refused like the shim itself (D4), nothing spawned
        const { server, ad } = mk('/usr/bin/codex', 'linux');
        await assert.rejects(() => ad.start({ workspace: ws, permissionMode: 'allow' }), /\.cmd launcher/);
        await assert.rejects(() => ad.listPreviousSessions(ws), /not found/);
        assert.strictEqual(server.spawns.length, 0, 'a resolved shim is never spawned');
      }
      // the pure helper: Windows takes only a resolved .exe; an unresolvable path stays as located
      assert.strictEqual(codexSpawnPath(LINK, fakeReal, 'darwin'), REAL);
      assert.strictEqual(codexSpawnPath('C:\\tools\\codex.exe', fakeReal, 'win32'), 'D:\\pkg\\codex\\codex.exe', 'win32: a resolved .exe is used');
      assert.strictEqual(codexSpawnPath('C:\\tools\\codex', fakeReal, 'win32'), 'C:\\tools\\codex', 'win32: a resolved codex.js is not spawned (no launcher), the located path stays');
      assert.strictEqual(codexSpawnPath('/nowhere/codex', fakeReal, 'darwin'), '/nowhere/codex', 'unresolvable: located path');
      assert.strictEqual(codexSpawnPath(LINK, () => 'a\0b', 'darwin'), LINK, 'a NUL in the resolved path is not used');
    }
    // session folders are resolved through the injected realpath: a symlink to the filesystem root is dropped
    {
      const root = path.parse(os.tmpdir()).root;
      const seen: string[] = [];
      const mk = () => {
        const server = new FakeCodexServer();
        const ad = new CodexAdapter({ spawn: server.spawn, locate: async () => ({ path: BIN, version: '0.163.0' }), platform: 'linux', env: {}, realpath: (p) => (seen.push(p), root) });
        return { server, ad };
      };
      for (const mode of ['read-only', 'ask'] as PermissionMode[]) {
        const { server, ad } = mk();
        await assert.rejects(() => ad.start({ workspace: ws, permissionMode: mode }), (e: Error) => /no folder/.test(e.message) && /Add the project folder itself/.test(e.message) && noFallback(e), `${mode}: a folder that is a link to the root leaves no roots`);
        assert.strictEqual(server.spawns.length, 0);
      }
      assert.ok(seen.length > 0, 'the resolver was called');
      const { server, ad } = mk();
      const sid = await ad.start({ workspace: ws, permissionMode: 'allow', quiet: true });
      assert.ok(ad.isLive(sid), 'Allow all does not need roots');
      assert.ok(!('runtimeWorkspaceRoots' in (server.requests('thread/start')[0].params as object)));
      await ad.dispose();
    }
    // a failing handshake (any reason) never starts, in any mode
    for (const mode of ['read-only', 'ask', 'allow'] as PermissionMode[]) {
      const { server, ad } = make({ server: { initialize: 'error' } });
      await assert.rejects(() => ad.start({ workspace: ws, permissionMode: mode }), /./, `a failing initialize rejects in ${mode}`);
      await server.flush();
      await settle();
      assert.deepStrictEqual(server.live, [], 'no child is left after a failed handshake');
      assert.strictEqual(server.requests('thread/start').length, 0);
      if (mode !== 'allow') assert.strictEqual(server.spawns.length, 1, `${mode}: a failing initialize is never retried (no Allow all retry)`);
    }
    // thread/start answers with an error on `permissions` (Windows without the elevated sandbox): refuse, never retry weaker
    for (const mode of ['read-only', 'ask'] as PermissionMode[]) {
      const { server, ad } = make({ server: { refusePermissions: true } });
      await assert.rejects(() => ad.start({ workspace: ws, permissionMode: mode }), (e: Error) => /refused the session settings/.test(e.message) && noFallback(e));
      await server.flush();
      await settle();
      assert.strictEqual(server.requests('thread/start').length, 1, `${mode}: thread/start is sent once, never retried`);
      assert.ok(server.requests('thread/start').every((w) => !('sandbox' in (w.params as object))), `${mode}: never retried with a sandbox`);
      assert.deepStrictEqual(server.live, []);
    }
    // Codex not found
    {
      const server = new FakeCodexServer();
      const ad = new CodexAdapter({ spawn: server.spawn, locate: async () => undefined, platform: 'linux', env: {} });
      await assert.rejects(() => ad.start({ workspace: ws, permissionMode: 'allow' }), /not found/);
      assert.strictEqual(server.spawns.length, 0);
    }
    // FR-093 resume (T043b): read the stored thread first (real Codex 0.163 rewrites the folder on resume), then resume on a fresh child
    {
      const { server, ad, events } = make();
      await assert.rejects(() => ad.start({ workspace: ws, resumeSessionId: 'thr_x' }), /could not be found/, 'an unknown thread is an error, not a new thread');
      assert.strictEqual(server.requests('thread/start').length, 0, 'never a new thread instead');
      await assert.rejects(() => ad.start({ workspace: ws, resumeSessionId: '../x' }), /not a Codex session id/);
      const sid = await ad.start({ workspace: ws, permissionMode: 'read-only', quiet: true });
      await ad.stop(sid);
      const spawnsBefore = server.spawns.length;
      const again = await ad.start({ workspace: ws, permissionMode: 'read-only', resumeSessionId: sid, quiet: true });
      assert.strictEqual(again, sid, 'the resumed session keeps the thread id');
      assert.strictEqual(server.spawns.length, spawnsBefore + 1, 'a fresh child');
      const order = server.wire.filter((w) => w.method === 'thread/read' || w.method === 'thread/resume').map((w) => w.method);
      assert.deepStrictEqual(order.slice(-2), ['thread/read', 'thread/resume'], 'read, then resume');
      const rp = server.requests('thread/resume').pop()!.params as Record<string, unknown>;
      assert.strictEqual(rp.threadId, sid); assert.strictEqual(rp.excludeTurns, true);
      assert.ok(Array.isArray(rp.runtimeWorkspaceRoots), 'the same limited roots as a new thread');
      events.length = 0;
      await ad.send(again, { text: 'hi' });
      await server.flush();
      assert.ok(events.some((e) => e.type === 'status' && e.status === 'idle'), 'the resumed thread runs turns');
      await ad.stop(again);
      // another folder: refused before resume, and the thread keeps its folder
      const other = dir();
      const resumes = server.requests('thread/resume').length;
      await assert.rejects(() => ad.start({ workspace: other, permissionMode: 'read-only', resumeSessionId: sid, quiet: true }), /another folder/);
      assert.strictEqual(server.requests('thread/resume').length, resumes, 'no thread/resume was sent');
      assert.strictEqual(server.threads.get(sid), fs.realpathSync.native(ws), 'the stored folder is unchanged (native realpath, as the adapter uses: long names on Windows)');
      await ad.dispose();
    }
    // Spec 006 FR-028: thread/delete on a probe; a live thread (by Durbar id or thread id) and a bad id are refused before any request
    {
      const { server, ad } = make();
      assert.strictEqual(ad.capabilities.deleteSession, true);
      const sid = await ad.start({ workspace: ws, permissionMode: 'read-only', sessionId: 'durbar-x', quiet: true }); // a Durbar id that is not the thread id
      const thread = ad.resumeIdOf!(sid) as string;
      assert.notStrictEqual(thread, sid, 'the Durbar id differs from the thread id');
      await assert.rejects(() => ad.deleteSession!(sid), /open/);
      await assert.rejects(() => ad.deleteSession!(thread), /open/, 'the thread id of a live session is refused too');
      for (const bad of ['../x', '..\\x', 'C:\\x', '/abs', '', 'a'.repeat(101), 'a\u0000b']) await assert.rejects(() => ad.deleteSession!(bad), /not a session id/, JSON.stringify(bad));
      assert.strictEqual(server.requests('thread/delete').length, 0, 'nothing was sent for a live or malformed id');
      await ad.stop(sid);
      await ad.deleteSession!(thread);
      assert.deepStrictEqual(server.requests('thread/delete').map((r) => r.params), [{ threadId: thread }], 'one thread/delete with the thread id');
      assert.ok(!(await ad.listPreviousSessions!(ws)).some((p) => p.id === thread), 'gone from the list');
      await assert.rejects(() => ad.deleteSession!(thread), /no rollout/, 'an error from Codex is passed on');
      await ad.dispose();
    }
    // FR-141 / FR-142: previous sessions, history and models through a short-lived probe child; model and effort on each turn
    {
      const { server, ad, events } = make();
      const models = await ad.listModelOptions!();
      assert.deepStrictEqual(models.map((m) => m.id), ['gpt-6.1-sol', 'gpt-6-luna'], "Codex's default first");
      const sid = await ad.start({ workspace: ws, permissionMode: 'read-only', model: 'gpt-6-luna', reasoningEffort: 'low', quiet: true });
      assert.deepStrictEqual((await ad.listPreviousSessions!(ws)).map((p) => p.id).includes(sid), false, 'an open session is not a previous one');
      await ad.send(sid, { text: 'hi' });
      await server.flush();
      const tp = server.requests('turn/start').pop()!.params as Record<string, unknown>;
      assert.deepStrictEqual([tp.model, tp.effort], ['gpt-6-luna', 'low'], 'model and effort go with the turn');
      // spec 030 FR-039/FR-040: a switch applies from the next turn on the same thread, with a `model` event
      const ev0 = events.length;
      assert.deepStrictEqual((await ad.setModel!(sid, { model: 'gpt-6.1-sol', effort: 'high' })).status, 'applied');
      const me = events.slice(ev0).find((e) => e.type === 'model') as { model: string; previousModel?: string; effort?: string; cause: string } | undefined;
      assert.deepStrictEqual(me && [me.model, me.previousModel, me.effort, me.cause], ['gpt-6.1-sol', 'gpt-6-luna', 'high', 'user']);
      assert.strictEqual((await ad.setModel!(sid, { model: 'claude-opus-5-5' })).status, 'rejected', 'not a Codex model');
      assert.strictEqual((await ad.setModel!(sid, { model: 'gpt-6.1-sol', effort: 'Very High!' })).status, 'rejected', 'bad effort shape');
      await ad.send(sid, { text: 'again' });
      await server.flush();
      const tp2 = server.requests('turn/start').pop()!.params as Record<string, unknown>;
      assert.deepStrictEqual([tp2.model, tp2.effort, tp2.threadId], ['gpt-6.1-sol', 'high', tp.threadId], 'the next turn uses the new model on the same thread');
      assert.strictEqual((await ad.setModel!(sid, { model: 'auto', effort: null })).status, 'applied');
      await ad.send(sid, { text: 'third' });
      await server.flush();
      const tp3 = server.requests('turn/start').pop()!.params as Record<string, unknown>;
      assert.ok(!('model' in tp3) && !('effort' in tp3), 'auto with no effort: Codex chooses');
      await ad.stop(sid);
      const prev = await ad.listPreviousSessions!(ws);
      assert.ok(prev.some((p) => p.id === sid), 'listed after stop');
      assert.ok(!(await ad.listPreviousSessions!(dir())).some((p) => p.id === sid), 'not in another folder');
      assert.deepStrictEqual((await ad.history!(sid)).items, [], 'history of a thread with no turns');
      const live = server.spawns.filter((s) => (s.args as string[]).includes('app-server')).length;
      assert.ok(live >= 4, 'probes are their own children');
      const s2 = await ad.start({ workspace: ws, permissionMode: 'read-only', model: 'haiku', quiet: true });
      await ad.send(s2, { text: 'x' }); await server.flush();
      assert.strictEqual((server.requests('turn/start').pop()!.params as Record<string, unknown>).model, undefined, 'a non-Codex model id is not sent');
      await ad.dispose();
    }
    // FR-093 profile check: in Read-only a resumed thread that reports a wider sandbox is refused
    {
      const { ad } = make({ server: { resumeSandbox: { type: 'dangerFullAccess' } } });
      const sid = await ad.start({ workspace: ws, permissionMode: 'read-only', quiet: true });
      await ad.stop(sid);
      await assert.rejects(() => ad.start({ workspace: ws, permissionMode: 'read-only', resumeSessionId: sid, quiet: true }), /wider sandbox/);
      assert.strictEqual(await ad.start({ workspace: ws, permissionMode: 'allow', resumeSessionId: sid, quiet: true }), sid, 'Allow all accepts it');
      await ad.dispose();
    }
  }

  // ---- FR-092 / FR-094: session ids, send, turn order
  {
    const ws = dir();
    const { server, ad, events } = make();
    const sid = await ad.start({ workspace: ws, permissionMode: 'read-only' });
    assert.strictEqual(sid, 'thr_1', 'the Durbar session id is the thread id');
    assert.deepStrictEqual(events.filter((e) => e.type !== 'mcp' && e.type !== 'sandbox').map((e) => [e.type, (e as { intent?: string }).intent]), [['status', `Ready in ${ws}`]], 'a loud start says Ready once (the thread/started idle is not doubled)');
    await server.flush();
    assert.strictEqual(events.filter((e) => e.type !== 'mcp' && e.type !== 'sandbox').length, 1);
    const named = await ad.start({ workspace: ws, sessionId: 'agent-7', permissionMode: 'read-only', quiet: true });
    assert.strictEqual(named, 'agent-7', 'a caller-named id is kept');
    await ad.send(named, { text: 'x' });
    await server.flush();
    assert.strictEqual((server.requests('turn/start')[0].params as { threadId: string }).threadId, 'thr_2', 'the wire uses the thread id');
    await assert.rejects(() => ad.start({ workspace: ws, sessionId: 'agent-7' }), /already running/);
    // send to unknown / stopped rejects and emits nothing
    const before = events.length;
    await assert.rejects(() => ad.send('nope', { text: 'x' }));
    assert.strictEqual(events.length, before);
    // the turn begins with working, then the mapper's events
    events.length = 0;
    await ad.send(sid, { text: 'go' });
    assert.ok(events[0].type === 'status' && events[0].status === 'working', 'working comes first');
    await server.flush();
    const last = events[events.length - 1];
    assert.ok(last.type === 'status' && last.status === 'idle', 'the turn ends idle');
    // a rejected turn/start shows an error, then rejects
    const bad = make();
    const s2 = await bad.ad.start({ workspace: ws, quiet: true });
    bad.server.threads.delete(s2);
    bad.events.length = 0;
    await assert.rejects(() => bad.ad.send(s2, { text: 'x' }), /thread not found/);
    assert.ok(bad.events.some((e) => e.type === 'status' && e.status === 'error'), 'a refused turn/start reports an error status');
    await ad.dispose();
    await bad.ad.dispose();
  }

  // ---- FR-093 groundwork: the mapper can adopt a thread that never announced itself
  {
    const out: unknown[] = [];
    const m = new CodexMapper((b) => out.push(b));
    m.map({ method: 'turn/started', params: { threadId: 'thr_z', turn: { id: 't' } } });
    assert.deepStrictEqual(out, [], 'before adoption a notification naming a thread is dropped');
    m.adopt('thr_z', '/w');
    assert.strictEqual(m.threadId, 'thr_z');
    assert.deepStrictEqual(out, [], 'adopt emits nothing');
    m.map({ method: 'turn/started', params: { threadId: 'thr_z', turn: { id: 't' } } });
    assert.strictEqual(out.length, 1, 'after adoption the thread is mapped');
    m.adopt('thr_other');
    assert.strictEqual(m.threadId, 'thr_z', 'a mapper that follows a thread is never re-pointed');
  }

  // ---- FR-096 / criterion 7 (stop part): pending is denied via stopped, wire cancel, unsubscribe, stdin closed, stopped last
  {
    const ws = dir();
    const { server, ad, events } = make({ server: { holdTurn: true } });
    const sid = await ad.start({ workspace: ws, permissionMode: 'ask', quiet: true });
    await ad.send(sid, { text: 'go' });
    await server.flush();
    const child = server.childOfThread(sid)!;
    const rep = req(server, 'item/fileChange/requestApproval', { threadId: sid, itemId: 'fc_1', changes: [{ path: path.join(ws, 'a.txt') }] }, child);
    await until('the pending state', () => pendingOf(events));
    events.length = 0;
    await ad.stop(sid);
    const r = await settles('the reply to the request pending at stop', rep);
    assert.strictEqual((r.result as { decision: string }).decision, 'cancel', 'a request pending at stop is answered cancel on the wire');
    const perm = events.find((e) => e.type === 'permission');
    assert.ok(perm && perm.type === 'permission' && perm.permission.state === 'denied' && perm.permission.via === 'stopped', "denied via 'stopped'");
    const order = server.wire.map((w) => w.method);
    assert.ok(order.indexOf('turn/interrupt') > -1 && order.indexOf('turn/interrupt') < order.indexOf('thread/unsubscribe'), 'the running turn is interrupted, then the thread unsubscribed');
    assert.deepStrictEqual((server.requests('turn/interrupt')[0].params as { turnId: string }).turnId, 'turn_1');
    assert.ok(child.stdinEnded && child.exited, 'stdin was closed and the child left');
    const end = events[events.length - 1];
    assert.ok(end.type === 'status' && end.status === 'stopped', 'stopped comes last');
    assert.strictEqual(events.filter((e) => e.type === 'status' && e.status === 'stopped').length, 1);
    assert.strictEqual(ad.isLive(sid), false);
    const n = events.length;
    await ad.stop(sid);
    assert.strictEqual(events.length, n, 'a second stop emits nothing');
    await server.flush();
    assert.strictEqual(events.length, n, 'nothing arrives after stopped (the interrupted turn/completed is muted)');
    await assert.rejects(() => ad.send(sid, { text: 'x' }));
  }

  // ---- FR-097 / criterion 8: a crash becomes error; that session only; stderr never shown
  {
    const ws = dir();
    const SECRET_ENV = 'sk-planted-env-secret-value-0123456789';
    const SECRET_KEY = 'ghp_' + 'A1b2C3d4E5'.repeat(4);
    const { server, ad, events, debug } = make({ server: { holdTurn: true }, env: { OPENAI_API_KEY: SECRET_ENV } });
    const sid = await ad.start({ workspace: ws, permissionMode: 'ask', quiet: true });
    const other = await ad.start({ workspace: ws, permissionMode: 'ask', quiet: true });
    await ad.send(sid, { text: 'go' });
    await server.flush();
    const child = server.childOfThread(sid)!;
    const rep = server.serverRequest('item/commandExecution/requestApproval', { threadId: sid, itemId: 'c1', command: 'npm test' }, child);
    void rep;
    await until('the pending state', () => pendingOf(events));
    // spec 087 FR-021 (review on PR 733): the card's sandbox line reaches the pending permission, on its own field
    const pendingPerm = events.find((e) => e.type === 'status' && e.status === 'needs-permission' && e.permission) as { permission?: { sandboxNote?: string; summary?: string } } | undefined;
    assert.strictEqual(pendingPerm?.permission?.sandboxNote, 'If you approve, Codex may run this outside its sandbox.', 'the pending card carries the sandbox line');
    assert.ok(!/sandbox/.test(pendingPerm?.permission?.summary ?? ''), 'and the summary does not');
    events.length = 0;
    child.stderrText(`fatal: token ${SECRET_KEY} and ${SECRET_ENV}\n`);
    child.exit(139, null);
    await settle();
    const errs = events.filter((e) => e.type === 'status' && e.status === 'error');
    assert.strictEqual(errs.length, 1, 'one error event');
    assert.ok(errs[0].sessionId === sid && (errs[0] as { intent?: string }).intent === 'Codex stopped unexpectedly (exit 139)', 'the error names the exit code');
    assert.strictEqual(ad.isLive(sid), false, 'the crashed session is no longer live');
    assert.ok(ad.isLive(other), 'a session on another child is untouched');
    const perm = events.find((e) => e.type === 'permission');
    assert.ok(perm && perm.type === 'permission' && perm.permission.state === 'denied' && perm.permission.via === 'stopped', "a pending request is denied via 'stopped'");
    assert.ok(events.every((e) => e.sessionId === sid), 'only the crashed session emitted');
    await assert.rejects(() => ad.send(sid, { text: 'x' }), /Unknown or stopped/);
    // the other session still works
    events.length = 0;
    await ad.send(other, { text: 'go' });
    await server.flush();
    assert.ok(events.some((e) => e.sessionId === other && e.type === 'status' && e.status === 'working'));
    // stderr text is never an event; a log line, if any, is redacted
    const all = JSON.stringify(events) + debug.join('\n');
    assert.ok(!all.includes(SECRET_KEY) && !all.includes(SECRET_ENV), 'a planted secret in stderr reaches neither an event nor a debug line');
    assert.ok(debug.some((l) => l.startsWith('codex stderr') && l.includes('[redacted')), 'the stderr tail is logged, redacted');
    assert.ok(!JSON.stringify(events).includes('fatal'), 'stderr text is never an event');
    await ad.dispose();
    // a secret that exists only in process.env (e.g. a deny-listed variable the child never got) is still redacted by value
    {
      const NAME = 'DURBAR_TEST_ONLY_PARENT_SECRET';
      const VALUE = 'parent-only-secret-value-9f8e7d6c5b4a';
      const saved = process.env[NAME];
      process.env[NAME] = VALUE;
      try {
        const p = make({ env: {} });
        const pid = await p.ad.start({ workspace: ws, quiet: true });
        const pc = p.server.childOfThread(pid)!;
        pc.stderrText(`boom ${VALUE}\n`);
        pc.exit(1, null);
        await settle();
        const dump = p.debug.join('\n') + JSON.stringify(p.events);
        assert.ok(p.debug.some((l) => l.startsWith('codex stderr')), 'the stderr tail is logged');
        assert.ok(!dump.includes(VALUE), 'a secret present only in process.env does not reach the debug output');
      } finally {
        if (saved === undefined) delete process.env[NAME];
        else process.env[NAME] = saved;
      }
    }
    // signal exit
    const s2 = make();
    const id2 = await s2.ad.start({ workspace: ws, quiet: true });
    s2.events.length = 0;
    s2.server.childOfThread(id2)!.exit(null, 'SIGKILL');
    await settle();
    assert.strictEqual((s2.events[0] as { intent?: string }).intent, 'Codex stopped unexpectedly (exit SIGKILL)');
    // a crash during start rejects and leaves nothing
    const s3 = make({ server: { exitOn: { method: 'thread/start', code: 3 } } });
    await assert.rejects(() => s3.ad.start({ workspace: ws, permissionMode: 'allow' }));
    await settle();
    assert.deepStrictEqual(s3.events, []);
    assert.deepStrictEqual(s3.server.live, []);
    // malformed and oversize lines are ignored, not fatal
    const s4 = make();
    const id4 = await s4.ad.start({ workspace: ws, quiet: true });
    const c4 = s4.server.childOfThread(id4)!;
    c4.raw('this is not json\n');
    c4.raw('{"method":\n');
    c4.raw('x'.repeat(8 * 1024 * 1024 + 10) + '\n');
    await s4.ad.send(id4, { text: 'go' });
    await s4.server.flush();
    assert.ok(s4.ad.isLive(id4) && !s4.events.some((e) => e.type === 'status' && e.status === 'error'), 'garbage on stdout is not fatal');
    await s4.ad.dispose();
  }

  // ---- FR-095 wiring (approvals through the broker) and FR-096 interrupt: never acceptForSession
  {
    const ws = dir();
    const file = path.join(ws, 'a.txt');
    const fileReq = (id: string) => ({ threadId: 'x', itemId: id, changes: [{ path: file }] });
    // Read-only: declined, no pending state
    {
      const { server, ad, events } = make();
      const sid = await ad.start({ workspace: ws, permissionMode: 'read-only', quiet: true });
      const r = await req(server, 'item/fileChange/requestApproval', fileReq('f1'), server.childOfThread(sid)!);
      assert.strictEqual((r.result as { decision: string }).decision, 'decline');
      assert.strictEqual(pendingOf(events), undefined);
      const c = await req(server, 'item/commandExecution/requestApproval', { itemId: 'c1', command: 'ls' }, server.childOfThread(sid)!);
      assert.strictEqual((c.result as { decision: string }).decision, 'decline');
      const u = await req(server, 'some/unknownRequest', { itemId: 'u1' }, server.childOfThread(sid)!);
      assert.strictEqual((u.result as { decision: string }).decision, 'decline', 'an unknown server request is declined, not approved');
      await ad.dispose();
    }
    // Ask first: pending until resolved; remember keeps a Durbar grant and sends plain accept
    {
      const { server, ad, events } = make();
      const sid = await ad.start({ workspace: ws, permissionMode: 'ask', quiet: true });
      const child = server.childOfThread(sid)!;
      const p1 = req(server, 'item/fileChange/requestApproval', fileReq('f1'), child);
      const pend = await until('pending', () => pendingOf(events));
      assert.strictEqual(server.replies.length, 0, 'nothing is answered while it is pending');
      ad.resolvePermission(sid, pend.requestId, true, true);
      assert.strictEqual(((await settles('p1', p1)).result as { decision: string }).decision, 'accept');
      const granted = [...events].reverse().find((e): e is Extract<AgentEvent, { type: 'grants' }> => e.type === 'grants');
      assert.ok(granted && granted.grants.length === 1, 'remember emits a grants event with one Durbar grant');
      events.length = 0;
      const p2 = await req(server, 'item/fileChange/requestApproval', fileReq('f2'), child);
      assert.strictEqual((p2.result as { decision: string }).decision, 'accept', 'the grant approves the next one');
      assert.strictEqual(pendingOf(events), undefined);
      const p3 = req(server, 'item/commandExecution/requestApproval', { itemId: 'c9', command: 'rm x' }, child);
      const pend3 = await until('pending 3', () => pendingOf(events));
      ad.resolvePermission(sid, pend3.requestId, false);
      assert.strictEqual(((await settles('p3', p3)).result as { decision: string }).decision, 'decline');
      assert.ok(!decisions(server).includes('acceptForSession'), 'acceptForSession is never sent');
      await ad.dispose();
    }
    // Allow all: accept
    {
      const { server, ad } = make();
      const sid = await ad.start({ workspace: ws, permissionMode: 'allow', quiet: true });
      const r = await req(server, 'item/commandExecution/requestApproval', { itemId: 'c1', command: 'ls' }, server.childOfThread(sid)!);
      assert.strictEqual((r.result as { decision: string }).decision, 'accept');
      assert.ok(!decisions(server).includes('acceptForSession'));
      await ad.dispose();
    }
    // spec 052 FR-172: the real approval names only itemId; the card gets the files, kind and diff from the fileChange item, secrets masked
    {
      const SECRET = 'planted-openai-key-value-0123456789';
      const { server, ad, events } = make({ env: { OPENAI_API_KEY: SECRET } });
      const sid = await ad.start({ workspace: ws, permissionMode: 'ask', quiet: true });
      const child = server.childOfThread(sid)!;
      const fx = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'codex', 'file-change-approval.json'), 'utf8'));
      const ghp = 'ghp_' + 'Z9'.repeat(18);
      const notes = JSON.parse(JSON.stringify(fx.notifications).replace('Retries are 3 now.', `key ${SECRET} and ${ghp}`)) as { method: string; params: unknown }[];
      for (const n of notes) server.notifyAll(n.method, n.params);
      await server.flush();
      const p1 = req(server, fx.approval.method, fx.approval.params, child);
      const pend = await until('pending with the files', () => pendingOf(events));
      assert.strictEqual(pend.summary, 'write /work/app/src/config.ts (+1 more)', 'the files from the item: ' + pend.summary);
      assert.ok(pend.diff && pend.diff.includes('--- a//work/app/src/config.ts') && pend.diff.includes('+  retries: 3,') && pend.diff.includes('+# Notes'), 'the diff of both changes (patchUpdated is the latest)');
      assert.ok(!pend.diff!.includes(SECRET) && !pend.diff!.includes(ghp) && pend.diff!.includes('[redacted'), 'secrets in the diff are masked');
      assert.strictEqual(pend.scopeLabel, 'write in app/src/, work/app/', 'the grant scope names the folder of every file (review on #470: not only the first)');
      ad.resolvePermission(sid, pend.requestId, false);
      assert.strictEqual(((await settles('p1', p1)).result as { decision: string }).decision, 'decline');
      // the item completes: it is forgotten, and a request for an unknown item says so instead of a bare "write"
      server.notifyAll(fx.completed.method, fx.completed.params);
      await server.flush();
      events.length = 0;
      const p2 = req(server, fx.approval.method, fx.approval.params, child);
      const pend2 = await until('pending without a file', () => pendingOf(events));
      assert.strictEqual(pend2.summary, 'write (Codex did not say which file)');
      assert.strictEqual(pend2.diff, undefined, 'no diff without an item');
      ad.resolvePermission(sid, pend2.requestId, false);
      await settles('p2', p2);
      // at most 32 items are kept
      for (let i = 0; i < 40; i++) server.notifyAll('item/started', { threadId: sid, item: { type: 'fileChange', id: `many_${i}`, status: 'inProgress', changes: [{ path: `/w/f${i}.txt`, kind: { type: 'add' }, diff: 'x\n' }] } });
      await server.flush();
      events.length = 0;
      const p3 = req(server, 'item/fileChange/requestApproval', { threadId: sid, itemId: 'many_0' }, child);
      assert.strictEqual((await until('oldest forgotten', () => pendingOf(events))).summary, 'write (Codex did not say which file)', 'the oldest item was dropped');
      ad.resolvePermission(sid, pendingOf(events)!.requestId, false);
      await settles('p3', p3);
      events.length = 0;
      const p4 = req(server, 'item/fileChange/requestApproval', { threadId: sid, itemId: 'many_39' }, child);
      assert.strictEqual((await until('newest kept', () => pendingOf(events))).summary, 'write /w/f39.txt (new file)', 'the newest item is kept');
      ad.resolvePermission(sid, pendingOf(events)!.requestId, false);
      await settles('p4', p4);
      await ad.dispose();
    }
    // FR-140: the Linux sandbox error (real text, Ubuntu with unprivileged user namespaces blocked) gets a plain hint; other errors none
    // FR-140 delta: the macOS sandbox error (real text, GitHub macOS runner) gets its own plain hint; the Linux one does not apply
    // FR-162: the two macOS causes get their own text. execvp EPERM (real, owner's Mac 2026-10-23): a symlinked codex, not a restricted Durbar
    for (const execvp of ["error creating thread: failed to load AGENTS.md instructions for environment `local`: fs sandbox helper failed with status exit status: 71: sandbox-exec: execvp() of '/Users/x/.local/bin/codex' failed: Operation not permitted", "fs sandbox helper failed with status exit status: 71: sandbox-exec: execvp() of '/opt/homebrew/bin/codex' failed: Operation not permitted"]) {
      const h = macSandboxHint(execvp);
      assert.ok(h.includes('could not start its macOS sandbox') && h.includes('run its own program again') && h.includes('starts the real file') && /report/.test(h), h);
      assert.ok(!/runs restricted|start Durbar normally/.test(h), 'the execvp case does not blame a restricted Durbar: ' + h);
    }
    const nested = macSandboxHint('sandbox-exec: sandbox_apply: Operation not permitted');
    assert.ok(nested.includes('could not start its macOS sandbox') && nested.includes('runs restricted') && nested.includes('Start Durbar normally'), nested);
    assert.ok(!/real file|own program/.test(nested), 'the nested case keeps its own text: ' + nested);
    const other = macSandboxHint('sandbox-exec: something else');
    assert.ok(other.includes('could not start its macOS sandbox') && !/runs restricted|real file/.test(other), other);
    assert.strictEqual(macSandboxHint('bwrap: loopback: Failed RTM_NEWADDR'), '');
    // FR-087 (owner 2026-10-20): no refusal text suggests Allow all; the window offers "Change mode…" instead
    for (const h of [linuxSandboxHint('bwrap: loopback: Failed RTM_NEWADDR'), macSandboxHint('sandbox-exec: execvp() failed'), macSandboxHint("sandbox-exec: execvp() of '/a/codex' failed: Operation not permitted"), macSandboxHint('sandbox_apply: Operation not permitted')]) assert.ok(h && !/allow all/i.test(h) && /Read-only and Ask first need/.test(h), 'no Allow all hint, and the renderer\'s MODE_REFUSAL (Change mode…) still matches: ' + h);
    assert.ok(linuxSandboxHint('error creating thread: failed to load AGENTS.md instructions for environment `local`: fs sandbox helper failed with status exit status: 1: bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted').includes('blocks unprivileged user namespaces'));
    assert.strictEqual(linuxSandboxHint('permissions profile not supported'), '');
    // FR-147: Durbar's MCP servers go to Codex as config.mcp_servers; the list and startup states become `mcp` events; a switch applies next message
    {
      const { server, ad, events } = make();
      const sid = await ad.start({ workspace: ws, permissionMode: 'read-only', mcpServers: { echo: { type: 'stdio', command: 'node', args: ['s.js'], env: { TOKEN: 'x' } }, web: { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer y' }, tools: ['search'] } }, disabledMcpServers: ['github'], disabledMcpTools: { echo: ['ping'], usersrv: ['send'] } });
      const cfg = (server.requests('thread/start').pop()!.params as { config?: { mcp_servers?: Record<string, Record<string, unknown>> } }).config;
      assert.deepStrictEqual(cfg?.mcp_servers, {
        echo: { command: 'node', args: ['s.js'], env: { TOKEN: 'x' }, disabled_tools: ['ping'] }, // spec 069 FR-062
        web: { url: 'https://example.com/mcp', http_headers: { Authorization: 'Bearer y' }, enabled_tools: ['search'] },
        github: { enabled: false },
        usersrv: { disabled_tools: ['send'] }, // spec 069 FR-062: an override of the user's own server
      });
      await until('mcp list', () => events.some((e) => e.type === 'mcp'));
      assert.deepStrictEqual((events.filter((e) => e.type === 'mcp').pop() as { servers: unknown[] }).servers, [{ name: 'echo', status: 'connected' }]);
      server.notifyAll('mcpServer/startupStatus/updated', { name: 'web', status: 'failed', error: 'refused', threadId: sid });
      await until('web failed', () => events.some((e) => e.type === 'mcp' && (e as { servers: Array<{ name: string; status: string }> }).servers.some((s) => s.name === 'web' && s.status === 'failed')));
      // spec 069 FR-031: one server's tools from mcpServerStatus/list on the thread's connection (the tools map of the generated schema)
      assert.deepStrictEqual(await ad.listMcpTools!(sid, 'echo'), [{ name: 'echo', description: 'Echo the text back\nSecond line' }, { name: 'ping' }]);
      const lr = server.requests('mcpServerStatus/list').pop()!.params as Record<string, unknown>;
      assert.deepStrictEqual([lr.threadId, lr.serverName, lr.detail], [sid, 'echo', 'toolsAndAuthOnly'], 'asked for that server on this thread');
      await assert.rejects(ad.listMcpTools!(sid, 'broken'), /spawn broken-mcp ENOENT/, 'toolsError is the failure');
      await assert.rejects(ad.listMcpTools!(sid, 'nope'), /not running in this session/);
      await assert.rejects(ad.listMcpTools!('no-such', 'echo'), /not running/);
      // review on #499: a Codex that ignores serverName and pages 10 at a time: the 23rd server is found on page 3
      server.mcpList = Array.from({ length: 25 }, (_v, i) => ({ name: `srv-${i}`, authStatus: 'unsupported', runtimeStatus: 'connected', tools: { [`t${i}`]: { name: `t${i}`, inputSchema: {} } }, resources: [], resourceTemplates: [] }));
      server.mcpPageSize = 10;
      server.mcpIgnoreServerName = true;
      const before = server.requests('mcpServerStatus/list').length;
      assert.deepStrictEqual(await ad.listMcpTools!(sid, 'srv-22'), [{ name: 't22' }]);
      assert.strictEqual(server.requests('mcpServerStatus/list').length - before, 3, 'three pages asked');
      assert.strictEqual((server.requests('mcpServerStatus/list').pop()!.params as Record<string, unknown>).cursor, '20');
      await assert.rejects(ad.listMcpTools!(sid, 'srv-99'), /not running in this session/, 'not on any page');
      // re-review on #499: a pager that always answers the same nextCursor: the second request repeats it, so the search stops there
      server.mcpStuckCursor = 'same';
      const stuck = server.requests('mcpServerStatus/list').length;
      await assert.rejects(ad.listMcpTools!(sid, 'srv-99'), /not running in this session/, 'a repeated cursor ends the search');
      assert.strictEqual(server.requests('mcpServerStatus/list').length - stuck, 2, 'two requests, then stop on the repeated cursor');
      server.mcpStuckCursor = undefined;
      server.mcpList = undefined;
      server.mcpPageSize = undefined;
      server.mcpIgnoreServerName = false;
      await ad.setMcpEnabled!(sid, 'echo', false);
      const last = events.filter((e) => e.type === 'mcp').pop() as { servers: Array<{ name: string; status: string }> };
      assert.strictEqual(last.servers.find((s) => s.name === 'echo')?.status, 'disabled', 'shown as off at once');
      const starts = server.spawns.length;
      await ad.send(sid, { text: 'next' });
      await server.flush();
      assert.strictEqual(server.spawns.length, starts + 1, 'applies with the next message on a fresh child');
      const rc = (server.requests('thread/resume').pop()!.params as { config?: { mcp_servers?: Record<string, Record<string, unknown>> } }).config;
      assert.strictEqual(rc?.mcp_servers?.echo?.enabled, false, 'the resumed thread gets the server switched off');
      await ad.dispose();
    }
    // Spec 058 T095 / FR-060: sign-in signals become needs-auth + errorClass 'auth'; a failed MCP call with the challenge text says mcpAuth and re-reads the list
    {
      const { server, ad, events } = make();
      type Srv = { name: string; status: string; errorClass?: string };
      const lastMcp = (): Srv[] => (events.filter((e) => e.type === 'mcp').pop() as { servers: Srv[] }).servers;
      server.mcpList = [
        { name: 'a', authStatus: 'notLoggedIn', runtimeStatus: 'connected' },
        { name: 'b', authStatus: 'oAuth', runtimeStatus: 'authenticationRequired' },
        { name: 'c', authStatus: 'oAuth', runtimeStatus: 'failed' },
        { name: 'd', authStatus: 'oAuth', runtimeStatus: 'connected' },
      ];
      const sid = await ad.start({ workspace: ws, permissionMode: 'read-only' });
      await until('mcp list', () => (events.some((e) => e.type === 'mcp')) || undefined);
      assert.deepStrictEqual(lastMcp(), [
        { name: 'a', status: 'needs-auth', errorClass: 'auth' },
        { name: 'b', status: 'needs-auth', errorClass: 'auth' },
        { name: 'c', status: 'failed' },
        { name: 'd', status: 'connected' },
      ]);
      // the startup notification: reason -> needs-auth; the next plain status clears the class
      server.notifyAll('mcpServer/startupStatus/updated', { name: 'd', status: 'failed', failureReason: 'reauthenticationRequired', threadId: sid });
      await until('d needs auth', () => (lastMcp().some((s) => s.name === 'd' && s.status === 'needs-auth')) || undefined);
      assert.strictEqual(lastMcp().find((s) => s.name === 'd')?.errorClass, 'auth');
      server.notifyAll('mcpServer/startupStatus/updated', { name: 'c', status: 'failed', failureReason: 'startupFailed', error: 'boom', threadId: sid });
      await until('c boom', () => (lastMcp().some((s) => s.name === 'c' && s.status === 'failed' && (s as { error?: string }).error === 'boom')) || undefined);
      assert.strictEqual(lastMcp().find((s) => s.name === 'c')?.errorClass, undefined, 'another failure reason is not an auth error');
      server.notifyAll('mcpServer/startupStatus/updated', { name: 'd', status: 'ready', threadId: sid });
      await until('d ready', () => (lastMcp().some((s) => s.name === 'd' && s.status === 'connected')) || undefined);
      assert.strictEqual(lastMcp().find((s) => s.name === 'd')?.errorClass, undefined, 'a later status replaces the derived class');
      // a failed MCP call with the challenge: mcpAuth, and the list is read again; plain failures and non-MCP tools do none of it
      const reads = (): number => server.requests('mcpServerStatus/list').length;
      const item = (id: string, over: Record<string, unknown>): unknown => ({ id, type: 'mcpToolCall', server: 'a', tool: 't', status: 'failed', arguments: {}, ...over });
      const before = reads();
      server.notifyAll('item/completed', { threadId: sid, item: item('m1', { error: { message: 'MCP OAuth challenge required (HTTP 401)' } }) });
      await until('refresh', () => (reads() > before) || undefined);
      const authCall = events.find((e) => e.type === 'toolCall' && e.callId === 'm1') as { mcpAuth?: boolean };
      assert.strictEqual(authCall?.mcpAuth, true);
      const after = reads();
      server.notifyAll('item/completed', { threadId: sid, item: item('m2', { error: { message: 'HTTP 401 Unauthorized' } }) });
      server.notifyAll('item/completed', { threadId: sid, item: item('m3', { status: 'completed', result: { content: [{ type: 'text', text: 'MCP OAuth challenge required' }] } }) });
      server.notifyAll('item/completed', { threadId: sid, item: { id: 'm4', type: 'commandExecution', status: 'failed', command: 'x', aggregatedOutput: 'MCP OAuth challenge required' } });
      server.notifyAll('item/completed', { threadId: sid, item: item('m5', { server: undefined, error: { message: 'MCP OAuth challenge required' } }) });
      await until('m5', () => (events.some((e) => e.type === 'toolCall' && e.callId === 'm5')) || undefined);
      for (const id of ['m2', 'm3', 'm4', 'm5']) assert.strictEqual((events.find((e) => e.type === 'toolCall' && e.callId === id) as { mcpAuth?: boolean } | undefined)?.mcpAuth, undefined, `${id}: no mcpAuth`);
      assert.strictEqual(reads(), after, 'no list refresh for them');
      // the challenge marks the server needs-auth although the runtime list still says connected, and the mark survives the re-read
      const n0 = reads();
      server.holdMcpList = true; // the re-read is pending, so only the adapter's own mark can show
      server.notifyAll('item/completed', { threadId: sid, item: item('m6', { server: 'd', error: { message: 'MCP OAuth challenge required (HTTP 401)' } }) });
      await until('d marked', () => (lastMcp().some((s) => s.name === 'd' && s.status === 'needs-auth')) || undefined);
      assert.strictEqual(lastMcp().find((s) => s.name === 'd')?.errorClass, 'auth');
      await until('re-read', () => (reads() > n0) || undefined);
      server.releaseMcpList();
      await new Promise((r) => setTimeout(r, 50));
      assert.strictEqual(lastMcp().find((s) => s.name === 'd')?.status, 'needs-auth', 'a list that still says connected does not clear it');
      // the runtime's next status for the server replaces the mark
      server.notifyAll('mcpServer/startupStatus/updated', { name: 'd', status: 'ready', threadId: sid });
      await until('d connected again', () => (lastMcp().some((s) => s.name === 'd' && s.status === 'connected')) || undefined);
      const n2 = reads();
      server.notifyAll('item/completed', { threadId: sid, item: item('m6b', { server: 'c', error: { message: 'MCP OAuth challenge required (HTTP 401)' } }) });
      await until('re-read for c', () => (reads() > n2) || undefined);
      await new Promise((r) => setTimeout(r, 50));
      assert.strictEqual(lastMcp().find((s) => s.name === 'd')?.status, 'connected', 'a re-read does not bring back a mark the runtime replaced');
      // a burst of challenges while one re-read is pending sends one request
      server.holdMcpList = true;
      const n1 = reads();
      for (const id of ['m7', 'm8', 'm9']) server.notifyAll('item/completed', { threadId: sid, item: item(id, { server: 'd', error: { message: 'MCP OAuth challenge required (HTTP 401)' } }) });
      await until('m9', () => (events.some((e) => e.type === 'toolCall' && e.callId === 'm9')) || undefined);
      await new Promise((r) => setTimeout(r, 50));
      assert.strictEqual(reads() - n1, 1, 'three challenges, one list request while it is pending');
      server.releaseMcpList();
      await new Promise((r) => setTimeout(r, 50));
      server.notifyAll('item/completed', { threadId: sid, item: item('m10', { server: 'd', error: { message: 'MCP OAuth challenge required (HTTP 401)' } }) });
      await until('read again after it settled', () => (reads() - n1 >= 2) || undefined);
      // switching the server off and on drops the challenge mark: a later re-read that lists it connected shows it connected
      assert.strictEqual(lastMcp().find((s) => s.name === 'd')?.status, 'needs-auth', 'marked before the switch');
      await ad.setMcpEnabled!(sid, 'd', false);
      await ad.setMcpEnabled!(sid, 'd', true);
      const n3 = reads();
      server.notifyAll('item/completed', { threadId: sid, item: item('m11', { server: 'c', error: { message: 'MCP OAuth challenge required (HTTP 401)' } }) });
      await until('re-read after the switch', () => (reads() > n3) || undefined);
      await new Promise((r) => setTimeout(r, 50));
      assert.strictEqual(lastMcp().find((s) => s.name === 'd')?.status, 'connected', 'a switch off and on drops the challenge mark');
      assert.strictEqual(lastMcp().find((s) => s.name === 'd')?.errorClass, undefined);
      await ad.dispose();
    }
    // FR-146: Codex's request_user_input goes to the question card; the answer goes back by question id; secret questions never shown
    {
      const { server, ad, events } = make({ server: { holdTurn: true } });
      const sid = await ad.start({ workspace: ws, permissionMode: 'read-only', quiet: true });
      await ad.send(sid, { text: 'go' });
      await server.flush();
      const child = server.childOfThread(sid)!;
      const qs = { threadId: sid, turnId: 'turn_1', itemId: 'ui1', isBlocking: true, questions: [
        { id: 'colour', header: 'Colour', question: 'Which colour?', options: [{ label: 'Sage', description: 'calm green' }, { label: 'Blue', description: '' }] },
        { id: 'pw', header: 'Token', question: 'Paste your token', isSecret: true, options: null },
      ] };
      const p = req(server, 'item/tool/requestUserInput', qs, child);
      await until('asked', () => events.some((e) => e.type === 'question' && e.phase === 'asked'));
      const asked = events.find((e) => e.type === 'question' && e.phase === 'asked') as { requestId: string; questions: Array<{ question: string; options: unknown[] }> };
      assert.deepStrictEqual(asked.questions.map((q) => q.question), ['Which colour?'], 'the secret question is not shown');
      assert.ok(events.some((e) => e.type === 'status' && e.status === 'needs-permission'), 'the agent waits for the user');
      ad.answerQuestion!(sid, asked.requestId, { 'Which colour?': 'Sage' });
      const r = await settles('the answer', p);
      assert.deepStrictEqual(r.result, { answers: { colour: { answers: ['Sage'] } } });
      assert.ok(events.some((e) => e.type === 'question' && e.phase === 'answered'));
      // Skip answers nothing; Stop answers an open question with nothing too
      const p2 = req(server, 'item/tool/requestUserInput', { ...qs, itemId: 'ui2' }, child);
      await until('asked again', () => events.filter((e) => e.type === 'question' && e.phase === 'asked').length === 2);
      const asked2 = events.filter((e) => e.type === 'question' && e.phase === 'asked')[1] as { requestId: string };
      ad.answerQuestion!(sid, asked2.requestId, null);
      assert.deepStrictEqual((await settles('skip', p2)).result, { answers: {} });
      assert.ok(events.some((e) => e.type === 'question' && e.phase === 'cancelled'));
      const p3 = req(server, 'item/tool/requestUserInput', { ...qs, itemId: 'ui3' }, child);
      await until('asked a third time', () => events.filter((e) => e.type === 'question' && e.phase === 'asked').length === 3);
      await ad.stop(sid);
      assert.deepStrictEqual((await settles('stop', p3)).result, { answers: {} });
      await ad.dispose();
    }
    // FR-151: an MCP elicitation with form fields goes to the question card; the answer is {action, content}; Stop cancels
    {
      const { server, ad, events } = make({ server: { holdTurn: true } });
      const sid = await ad.start({ workspace: ws, permissionMode: 'read-only', quiet: true });
      await ad.send(sid, { text: 'go' });
      await server.flush();
      const child = server.childOfThread(sid)!;
      const form = { threadId: sid, serverName: 'deploy', mode: 'form', message: 'Where?', requestedSchema: { type: 'object', properties: { env: { type: 'string', enum: ['staging', 'production'] }, ticket: { type: 'integer' } }, required: ['env'] } };
      const p = req(server, 'mcpServer/elicitation/request', form, child);
      await until('form asked', () => events.some((e) => e.type === 'question' && e.phase === 'asked'));
      const asked = events.find((e) => e.type === 'question' && e.phase === 'asked') as { requestId: string; elicitation?: { source?: string; fields?: Array<{ name: string }> } };
      assert.deepStrictEqual(asked.elicitation?.fields?.map((f) => f.name), ['env', 'ticket']);
      assert.strictEqual(asked.elicitation?.source, 'deploy');
      ad.answerElicitation!(sid, asked.requestId, { action: 'accept', content: { env: 'staging', ticket: 4 } });
      assert.deepStrictEqual((await settles('the form answer', p)).result, { action: 'accept', content: { env: 'staging', ticket: 4 } });
      // a required field Durbar cannot show: declined at once
      const p2 = req(server, 'mcpServer/elicitation/request', { ...form, requestedSchema: { properties: { tags: { type: 'array' } }, required: ['tags'] } }, child);
      assert.deepStrictEqual((await settles('declined', p2)).result, { action: 'decline' });
      // a URL flow, then Stop: cancel
      const p3 = req(server, 'mcpServer/elicitation/request', { threadId: sid, serverName: 'deploy', mode: 'url', message: 'Sign in', url: 'https://auth.example.com/x' }, child);
      await until('url asked', () => events.filter((e) => e.type === 'question' && e.phase === 'asked').length === 2);
      await ad.stop(sid);
      assert.deepStrictEqual((await settles('stop', p3)).result, { action: 'cancel' });
      await ad.dispose();
    }
    // FR-139: a shell command that already started keeps running after turn/interrupt (real, Codex 0.163); Aborted says so
    {
      const started = { method: 'item/started', params: { threadId: 'thr_main', item: { id: 'cmd_9', type: 'commandExecution', command: 'sleep 20', cwd: ws, status: 'inProgress' } } };
      const { server, ad, events } = make({ server: { turnScript: [started], holdTurn: true } });
      const sid = await ad.start({ workspace: ws, permissionMode: 'allow', quiet: true });
      await ad.send(sid, { text: 'go' });
      await server.flush();
      assert.ok(events.some((e) => e.type === 'toolCall' && e.phase === 'start'), 'the command started');
      await ad.interrupt(sid);
      await server.flush();
      const ab = events.filter((e) => e.type === 'status' && e.status === 'idle' && String((e as { intent?: string }).intent).startsWith('Aborted'));
      assert.strictEqual(ab.length, 1);
      assert.strictEqual((ab[0] as { intent?: string }).intent, 'Aborted (a command that already started may still finish; End session stops it)');
      await ad.dispose();
    }
    // Interrupt: pending cancelled, turn/interrupt with the turn id, one Aborted, session stays live, next turn runs
    {
      const { server, ad, events } = make({ server: { holdTurn: true } });
      const sid = await ad.start({ workspace: ws, permissionMode: 'ask', quiet: true });
      const noTurn = server.wire.length;
      await ad.interrupt(sid);
      assert.strictEqual(server.wire.length, noTurn, 'interrupt with no turn running sends nothing');
      await ad.send(sid, { text: 'go' });
      await server.flush();
      const child = server.childOfThread(sid)!;
      const p = req(server, 'item/fileChange/requestApproval', fileReq('f1'), child);
      await until('pending', () => pendingOf(events));
      events.length = 0;
      await ad.interrupt(sid);
      await server.flush();
      assert.strictEqual(((await settles('the cancel reply', p)).result as { decision: string }).decision, 'cancel');
      const ti = server.requests('turn/interrupt');
      assert.strictEqual(ti.length, 1, 'one turn/interrupt (the cancel reply does not send a second)');
      assert.deepStrictEqual(ti[0].params, { threadId: sid, turnId: 'turn_1' });
      const aborted = events.filter((e) => e.type === 'status' && e.status === 'idle' && (e as { intent?: string }).intent === 'Aborted');
      assert.strictEqual(aborted.length, 1, 'Aborted once, not doubled by the mapper');
      assert.ok(ad.isLive(sid));
      server.opts.holdTurn = false;
      events.length = 0;
      await ad.send(sid, { text: 'again' });
      await server.flush();
      const end = events[events.length - 1];
      assert.ok(end.type === 'status' && end.status === 'idle', 'a new turn runs after interrupt');
      await ad.dispose();
    }
  }

  // ---- interrupt with a pending approval and no known turn id: still cancelled, nothing sent to turn/interrupt
  {
    const ws = dir();
    const { server, ad, events } = make();
    const sid = await ad.start({ workspace: ws, permissionMode: 'ask', quiet: true });
    const p = req(server, 'item/commandExecution/requestApproval', { itemId: 'c1', command: 'ls' }, server.childOfThread(sid));
    await until('pending', () => pendingOf(events));
    await ad.interrupt(sid);
    assert.strictEqual(((await p).result as { decision: string }).decision, 'cancel', 'a pending approval is cancelled by interrupt');
    assert.strictEqual(server.requests('turn/interrupt').length, 0, 'no turn, so no turn/interrupt');
    assert.ok(ad.isLive(sid));
    assert.ok(events.some((e) => e.type === 'permission' && e.permission.state === 'denied'), 'the permission was resolved as denied');
    await ad.dispose();
  }

  // ---- FR-087 follow-ups: the cwd sent in Read-only/Ask first is the resolved one
  {
    const a = dir();
    const b = dir();
    const wsFile = path.join(dir(), 'y.code-workspace');
    fs.writeFileSync(wsFile, JSON.stringify({ folders: [{ path: a }, { path: b }] }));
    const mk = (realpath: (p: string) => string) => {
      const server = new FakeCodexServer();
      const ad = new CodexAdapter({ spawn: server.spawn, locate: async () => ({ path: BIN, version: '0.163.0' }), platform: 'linux', env: {}, realpath });
      return { server, ad };
    };
    const resolved = (p: string): string => (p === a ? a + '-real' : p);
    for (const mode of ['read-only', 'ask'] as PermissionMode[]) {
      const { server, ad } = mk(resolved);
      await ad.start({ workspace: wsFile, permissionMode: mode, quiet: true });
      const ts = server.requests('thread/start')[0].params as { cwd: string; runtimeWorkspaceRoots: string[] };
      assert.strictEqual(ts.cwd, a + '-real', `${mode}: thread/start gets the resolved cwd`);
      assert.ok(ts.runtimeWorkspaceRoots.includes(a + '-real'), `${mode}: consistent with the roots`);
      await ad.dispose();
    }
    const { server, ad } = mk(resolved);
    await ad.start({ workspace: wsFile, permissionMode: 'allow', quiet: true });
    assert.strictEqual((server.requests('thread/start')[0].params as { cwd: string }).cwd, a, 'Allow all uses the cwd as given');
    await ad.dispose();
    // the cwd cannot be resolved while another folder can: Read-only and Ask first are refused (reason plus advice, no fallback), Allow all starts
    const unresolved = (p: string): string => {
      if (p === a) throw new Error('ENOENT');
      return p;
    };
    for (const mode of ['read-only', 'ask'] as PermissionMode[]) {
      const m = mk(unresolved);
      await assert.rejects(() => m.ad.start({ workspace: wsFile, permissionMode: mode }), (e: Error) => /cannot resolve the session folder/.test(e.message) && /Check that the folder exists/.test(e.message) && noFallback(e), `${mode}: an unresolved cwd is refused`);
      assert.strictEqual(m.server.spawns.length, 0);
    }
    const m = mk(unresolved);
    await m.ad.start({ workspace: wsFile, permissionMode: 'allow', quiet: true });
    assert.strictEqual((m.server.requests('thread/start')[0].params as { cwd: string }).cwd, a);
    await m.ad.dispose();
  }

  // ---- turn id race: turn/completed before the turn/start response must not make the finished turn current
  {
    const ws = dir();
    const { server, ad } = make({ server: { completeBeforeResponse: true } });
    const sid = await ad.start({ workspace: ws, permissionMode: 'read-only', quiet: true });
    await ad.send(sid, { text: 'go' });
    await server.flush();
    const before = server.requests('turn/interrupt').length;
    await ad.interrupt(sid);
    assert.strictEqual(server.requests('turn/interrupt').length, before, 'a finished turn is never interrupted');
    await ad.stop(sid);
    assert.strictEqual(server.requests('turn/interrupt').length, before, 'nor by stop');
  }

  // ---- D5: the child's environment (default) is the process environment without other tools' credentials
  {
    const env = { PATH: '/bin', HOME: '/h', GH_TOKEN: 'a', GITHUB_TOKEN: 'b', GITHUB_PAT: 'x', COPILOT_GITHUB_TOKEN: 'c', ANTHROPIC_API_KEY: 'd', CLAUDE_CODE_OAUTH_TOKEN: 'e', DURBAR_LOG: 'f', DURBAR_SIM: '15', MY_SERVICE_PASSWORD: 'g', AWS_SECRET_ACCESS_KEY: 'h', OPENAI_API_KEY: 'k', CODEX_HOME: '/c', HTTPS_PROXY: 'http://p', NO_PROXY: 'x', SSL_CERT_FILE: '/ca', NODE_EXTRA_CA_CERTS: '/ca2', USERPROFILE: 'u', APPDATA: 'a', TMPDIR: '/t' };
    const out = codexChildEnv(env);
    for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'GITHUB_PAT', 'COPILOT_GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'DURBAR_LOG', 'DURBAR_SIM', 'MY_SERVICE_PASSWORD', 'AWS_SECRET_ACCESS_KEY']) assert.ok(!(k in out), `${k} is dropped`);
    for (const k of ['PATH', 'HOME', 'OPENAI_API_KEY', 'CODEX_HOME', 'HTTPS_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'NODE_EXTRA_CA_CERTS', 'USERPROFILE', 'APPDATA', 'TMPDIR']) assert.strictEqual(out[k], (env as Record<string, string>)[k], `${k} is kept`);
    // the default of the adapter: what reaches spawn
    const names = ['GH_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'HTTPS_PROXY'];
    const saved = names.map((n) => process.env[n]);
    process.env.GH_TOKEN = 'planted-gh';
    process.env.ANTHROPIC_API_KEY = 'planted-anthropic';
    process.env.OPENAI_API_KEY = 'planted-openai';
    process.env.HTTPS_PROXY = 'http://proxy.test:3128';
    try {
      const server = new FakeCodexServer();
      const ad = new CodexAdapter({ spawn: server.spawn, locate: async () => ({ path: BIN, version: '0.163.0' }), platform: 'linux' });
      await ad.start({ workspace: dir(), quiet: true });
      const e = server.spawns[0].options.env!;
      assert.ok(!('GH_TOKEN' in e) && !('ANTHROPIC_API_KEY' in e), 'GH_TOKEN and ANTHROPIC_API_KEY are not passed to the child');
      assert.strictEqual(e.OPENAI_API_KEY, 'planted-openai');
      assert.strictEqual(e.HTTPS_PROXY, 'http://proxy.test:3128');
      await ad.dispose();
    } finally {
      names.forEach((n, i) => (saved[i] === undefined ? delete process.env[n] : (process.env[n] = saved[i])));
    }
  }

  // ---- FR-143: a known session that is not live restarts by resuming its own thread (End session, a crash), never a new thread
  {
    const ws = dir();
    const { server, ad, events } = make();
    const tid = await ad.start({ workspace: ws, quiet: true });
    await ad.stop(tid);
    await ad.start({ workspace: ws, sessionId: 'agent-9', quiet: true });
    const thread9 = ad.resumeIdOf!('agent-9');
    assert.ok(thread9 && thread9 !== 'agent-9', 'a named session runs on its own Codex thread');
    await ad.stop('agent-9');
    assert.strictEqual(ad.resumeIdOf!('agent-9'), thread9, 'the thread id is kept after stop (what main remembers for a restart)');
    const starts = server.requests('thread/start').length;
    assert.strictEqual(await ad.start({ workspace: ws, sessionId: 'agent-9', quiet: true }), 'agent-9');
    assert.strictEqual(server.requests('thread/start').length, starts, 'no new thread');
    assert.strictEqual((server.requests('thread/resume').pop()!.params as { threadId: string }).threadId, thread9, 'the same thread is resumed');
    events.length = 0;
    await ad.send('agent-9', { text: 'again' });
    await server.flush();
    assert.ok(events.some((e) => e.type === 'status' && e.status === 'idle'), 'it runs turns');
    await ad.dispose();
  }

  // ---- FR-144: mode switch. Durbar's approvals at once; Codex from the next message, on a fresh child resuming the thread
  {
    const ws = dir();
    const { server, ad, events } = make();
    const sid = await ad.start({ workspace: ws, permissionMode: 'read-only', quiet: true });
    assert.deepStrictEqual(ad.setPermMode!(sid, 'allow'), { pending: 0 });
    const spawns = server.spawns.length;
    await ad.send(sid, { text: 'write it' });
    await server.flush();
    assert.strictEqual(server.spawns.length, spawns + 1, 'a fresh child');
    assert.strictEqual((server.requests('thread/resume').pop()!.params as { threadId: string }).threadId, sid, 'the same thread');
    const tp = server.requests('turn/start').pop()!.params as Record<string, unknown>;
    assert.deepStrictEqual(tp.sandboxPolicy, { type: 'dangerFullAccess' }, 'the next turn runs in the new mode');
    assert.ok(!events.some((e) => e.type === 'status' && e.status === 'stopped'), 'the relaunch is silent');
    await ad.dispose();
  }
  {
    // a stricter mode during a running turn interrupts it
    const ws = dir();
    const { server, ad } = make({ server: { holdTurn: true } });
    const sid = await ad.start({ workspace: ws, permissionMode: 'allow', quiet: true });
    await ad.send(sid, { text: 'go' });
    await server.flush();
    ad.setPermMode!(sid, 'read-only');
    await server.flush();
    assert.strictEqual(server.requests('turn/interrupt').length, 1, 'the running Allow all turn is interrupted');
    await ad.dispose();
  }

  // ---- start races: a second concurrent start of the same id is refused; stop during start cancels it
  {
    const ws = dir();
    const a = make();
    const p1 = a.ad.start({ workspace: ws, sessionId: 'X', quiet: true });
    const p2 = a.ad.start({ workspace: ws, sessionId: 'X', quiet: true });
    await assert.rejects(() => p2, /already running/, 'a concurrent start of the same id is refused');
    assert.strictEqual(await settles('the first start', p1), 'X');
    assert.strictEqual(a.server.spawns.length, 1, 'only one child');
    await a.ad.dispose();

    const b = make({ server: { holdInitialize: true } });
    const p = b.ad.start({ workspace: ws, sessionId: 'X', quiet: true });
    const failed = p.then(() => 'started', (e: Error) => e.message);
    await until('the child spawned', () => (b.server.spawns.length ? true : undefined));
    const stopped = b.ad.stop('X');
    b.server.releaseInitialize();
    assert.match(await settles('the cancelled start', failed), /stopped while starting/);
    await settles('stop during start', stopped);
    await b.server.flush();
    await settle();
    assert.strictEqual(b.ad.isLive('X'), false, 'a cancelled start never registers');
    assert.deepStrictEqual(b.server.live, [], 'its child is closed');
    assert.strictEqual(b.server.requests('thread/start').length, 0, 'no thread was started');
    assert.deepStrictEqual(b.events, [], 'no event');
  }

  // ---- interrupt before the turn id is known: sent as soon as it is, Aborted once
  {
    const ws = dir();
    const { server, ad, events } = make({ server: { holdTurnStart: true, holdTurn: true } });
    const sid = await ad.start({ workspace: ws, permissionMode: 'read-only', quiet: true });
    const sent = ad.send(sid, { text: 'go' });
    await until('turn/start on the wire', () => (server.requests('turn/start').length ? true : undefined));
    events.length = 0;
    await settles('interrupt', ad.interrupt(sid));
    assert.strictEqual(server.requests('turn/interrupt').length, 0, 'the turn id is unknown: nothing sent yet');
    server.releaseTurnStart();
    await settles('send', sent);
    await until('turn/interrupt', () => (server.requests('turn/interrupt').length ? true : undefined));
    await server.flush();
    assert.deepStrictEqual(server.requests('turn/interrupt')[0].params, { threadId: sid, turnId: 'turn_1' });
    assert.strictEqual(server.requests('turn/interrupt').length, 1);
    await settle();
    assert.strictEqual(events.filter((e) => e.type === 'status' && e.status === 'idle' && (e as { intent?: string }).intent === 'Aborted').length, 1, 'Aborted once');
    assert.ok(ad.isLive(sid));
    await ad.dispose();
  }

  // ---- cwd versus roots (Read-only and Ask first), and a real symlink
  {
    const a = dir();
    const b = dir();
    const wsFile = path.join(dir(), 'z.code-workspace');
    fs.writeFileSync(wsFile, JSON.stringify({ folders: [{ path: a }, { path: b }] }));
    const root = path.parse(os.tmpdir()).root;
    const mk = (realpath: (p: string) => string) => {
      const server = new FakeCodexServer();
      const ad = new CodexAdapter({ spawn: server.spawn, locate: async () => ({ path: BIN, version: '0.163.0' }), platform: 'linux', env: {}, realpath });
      return { server, ad };
    };
    // the first folder (the cwd) resolves to the filesystem root, the second is fine: the roots are not empty, but the cwd is not among them
    const toRoot = (p: string): string => (p === a ? root : p);
    for (const mode of ['read-only', 'ask'] as PermissionMode[]) {
      const m = mk(toRoot);
      await assert.rejects(() => m.ad.start({ workspace: wsFile, permissionMode: mode }), (e: Error) => /not among the folders/.test(e.message) && /Add the project folder itself/.test(e.message) && noFallback(e), `${mode}: a cwd outside the roots is refused`);
      assert.strictEqual(m.server.spawns.length, 0);
    }
    const m = mk(toRoot);
    await m.ad.start({ workspace: wsFile, permissionMode: 'allow', quiet: true });
    await m.ad.dispose();

    // real symlinks (POSIX; skipped where the OS does not allow creating one)
    const target = dir();
    const link = path.join(dir(), 'link');
    const rootLink = path.join(dir(), 'rootlink');
    let linked = true;
    try {
      fs.symlinkSync(target, link, 'dir');
      fs.symlinkSync(root, rootLink, 'dir');
    } catch {
      linked = false;
      console.log('codex adapter: symlink cases skipped (cannot create a symlink here)');
    }
    if (linked) {
      const real = fs.realpathSync.native(target);
      const s1 = make();
      await s1.ad.start({ workspace: link, permissionMode: 'read-only', quiet: true });
      const ts = s1.server.requests('thread/start')[0].params as { cwd: string; runtimeWorkspaceRoots: string[] };
      assert.strictEqual(ts.cwd, real, 'the symlink is resolved in cwd');
      assert.deepStrictEqual(ts.runtimeWorkspaceRoots, [real], 'and in the roots');
      await s1.ad.dispose();
      for (const mode of ['read-only', 'ask'] as PermissionMode[]) {
        const s2 = make();
        await assert.rejects(() => s2.ad.start({ workspace: rootLink, permissionMode: mode }), (e: Error) => /no folder/.test(e.message) && noFallback(e), `${mode}: a folder that is a real symlink to the filesystem root is refused`);
        assert.strictEqual(s2.server.spawns.length, 0);
      }
    }
  }

  // ---- start errors are short and clean; dispose during start leaks no child; the second Read-only lock
  {
    const ws = dir();
    // a huge, control-laden server error
    const evil = 'bad\u0000\u001b[31m\n' + 'x'.repeat(5000);
    {
      const s = make({ server: { refusePermissions: true, threadStartError: evil } });
      await assert.rejects(() => s.ad.start({ workspace: ws, permissionMode: 'read-only' }), (e: Error) => /refused the session settings/.test(e.message) && e.message.length < 360 && !/[\u0000-\u001f\u007f-\u009f]/.test(e.message), 'a refusal is capped and has no control characters');
    }
    const hs = make({ server: { initializeErrorText: evil, initialize: 'error' } });
    await assert.rejects(() => hs.ad.start({ workspace: ws, permissionMode: 'allow' }), (e: Error) => /could not be started/.test(e.message) && e.message.length < 360 && !/[\u0000-\u001f\u007f-\u009f]/.test(e.message));

    // dispose racing a slow start
    const d = make({ server: { holdInitialize: true } });
    const p = d.ad.start({ workspace: ws, permissionMode: 'allow', quiet: true });
    const outcome = p.then(() => 'started', (e: Error) => e.message);
    await until('the child spawned', () => (d.server.spawns.length ? true : undefined));
    const disposed = d.ad.dispose();
    d.server.releaseInitialize();
    assert.match(await settles('the start', outcome), /shut down/, 'a start racing dispose is rejected');
    await settles('dispose', disposed);
    await d.server.flush();
    await settle();
    assert.deepStrictEqual(d.server.live, [], 'no child is leaked');
    assert.strictEqual(d.server.requests('thread/start').length, 0);

    // Read-only is double-locked: even if the broker approved, codexReply declines
    const r = make();
    const sid = await r.ad.start({ workspace: ws, permissionMode: 'read-only', quiet: true });
    const live = (r.ad as unknown as { sessions: Map<string, { broker: { request: () => Promise<unknown> } }> }).sessions.get(sid)!;
    live.broker.request = async () => ({ kind: 'approve-once' });
    const rep = await req(r.server, 'item/fileChange/requestApproval', { itemId: 'f1', changes: [{ path: path.join(ws, 'a.txt') }] }, r.server.childOfThread(sid));
    assert.strictEqual((rep.result as { decision: string }).decision, 'decline', 'a bypassed broker still gets decline in Read-only');
    await r.ad.dispose();
  }

  // ---- FR-098 / criterion 9: every Codex fixture replayed through the adapter equals its `expected`
  {
    const fxDir = path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'codex');
    const names = fs.readdirSync(fxDir).filter((f) => f.endsWith('.json'));
    assert.ok(names.length >= 9, 'the synthetic fixtures are present');
    for (const f of names) {
      const fx = JSON.parse(fs.readFileSync(path.join(fxDir, f), 'utf8')) as { provenance: string; notifications: Array<{ method: string; params?: unknown }>; expected: unknown[] };
      assert.strictEqual(fx.provenance, 'synthetic', `${f}: still marked synthetic`);
      const ws = dir();
      const { server, ad, events } = make({ server: { turnScript: fx.notifications } });
      const sid = await ad.start({ workspace: ws, permissionMode: 'read-only', quiet: true });
      events.length = 0;
      await ad.send(sid, { text: 'go' });
      await server.flush();
      const got = events.map(strip);
      assert.deepStrictEqual(got[0], { type: 'status', status: 'working', intent: 'Thinking' }, `${f}: the adapter's own leading working`);
      const want = fx.expected.map((e) => e as Record<string, unknown>);
      // The fixture's own first thread/started ("Ready in /work/app") belongs to thread/start here, and a fixture with no turn/completed gets one from the fake.
      if (fx.notifications[0]?.method === 'thread/started') {
        const first = want[0];
        assert.ok(first && first.type === 'status' && first.status === 'idle' && String(first.intent).startsWith('Ready in'), `${f}: the first expected event is the Ready idle of thread/started`);
        want.shift();
      }
      if (!fx.notifications.some((n) => n.method === 'turn/completed')) want.push({ type: 'status', status: 'idle' });
      // FR-147: the adapter itself turns mcpServer/startupStatus/updated into `mcp` events; the mapper fixtures do not cover them
      assert.deepStrictEqual(got.slice(1).filter((e) => (e as { type: string }).type !== 'mcp'), want, `${f}: adapter events equal the fixture's expected list`);
      await ad.dispose();
    }
  }

  // ---- spec 030 FR-034: the hand-off summary comes from an ephemeral, read-only fork; its events never reach the chat
  {
    const { server, ad, events } = make();
    const sid = await ad.start({ workspace: dir(), permissionMode: 'read-only', quiet: true });
    await ad.send(sid, { text: 'hello' });
    await until('turn done', () => events.some((e) => e.type === 'status' && (e as { status: string }).status === 'idle'));
    await settle(50);
    const before = events.length;
    const r = await settles('summary', ad.handoffSummary!(sid));
    assert.strictEqual(r.summary, '## Goal\nFake fork summary.');
    const fork = server.wire.find((w) => w.method === 'thread/fork')!.params as Record<string, unknown>;
    assert.strictEqual(fork.ephemeral, true, 'the fork is not saved');
    assert.strictEqual(fork.approvalPolicy, 'never');
    assert.strictEqual(fork.sandbox, 'read-only', 'the fork cannot write');
    const turn = server.wire.filter((w) => w.method === 'turn/start').pop()!.params as { threadId: string; input: Array<{ text: string }> };
    assert.notStrictEqual(turn.threadId, fork.threadId, 'the prompt goes to the fork, not the session thread');
    assert.match(turn.input[0].text, /hand-off summary/);
    await until('fork unsubscribed', () => server.wire.some((w) => w.method === 'thread/unsubscribe' && (w.params as { threadId: string }).threadId === turn.threadId));
    const leaked = events.slice(before).filter((e) => e.type === 'output' || e.type === 'toolCall' || e.type === 'status');
    assert.deepStrictEqual(leaked.map(strip), [], 'nothing from the fork reaches the chat');
    await ad.stop(sid);
  }

  // ---- spec 040 FR-015: generateText on an ephemeral read-only thread in a child of its own; nothing reaches any session
  {
    const { server, ad, events } = make({ server: { turnScript: [
      { method: 'turn/started', params: { threadId: 'thr_main', turn: { id: 'turn_x', status: 'inProgress' } } },
      { method: 'item/completed', params: { threadId: 'thr_main', item: { type: 'agentMessage', id: 'm1', text: '{"name":"Sea"}' } } },
    ] } });
    const r = await settles('one-shot', ad.generateText!('make a theme'));
    assert.deepStrictEqual(r, { text: '{"name":"Sea"}' });
    const start = server.wire.find((w) => w.method === 'thread/start')!.params as Record<string, unknown>;
    assert.strictEqual(start.ephemeral, true);
    assert.strictEqual(start.sandbox, 'read-only');
    assert.strictEqual(start.approvalPolicy, 'never');
    assert.ok(typeof start.cwd === 'string' && !fs.existsSync(start.cwd as string), 'the temp folder is removed after');
    assert.strictEqual(events.length, 0, 'no session events');
  }

  // ---- spec 012 FR-156: verifySignIn asks OpenAI through account/rateLimits/read on a short-lived child; never the token
  {
    const cases: Array<[FakeCodexOptions, string]> = [
      [{}, 'signed-in'],
      [{ rateLimits: 'unauthorized' }, 'signed-out'],
      [{ rateLimits: 'unauthorized', authMethod: 'apikey' }, 'signed-in'], // real 2026-10-20: rate limits refuse an API-key sign-in that works
      [{ rateLimits: 'network' }, 'unknown'],
      [{ rateLimits: 'missing' }, 'unknown'], // falls back to getAuthStatus: signed in on this computer, not confirmed
      [{ rateLimits: 'missing', authMethod: null }, 'signed-out'],
    ];
    for (const [opts, want] of cases) {
      const { server, ad, events } = make({ server: opts });
      const r = await ad.verifySignIn!();
      assert.strictEqual(r.status, want, `verifySignIn with ${JSON.stringify(opts)}`);
      assert.ok(!r.detail || !/token|@/i.test(r.detail), 'the detail names no token or account');
      const methods = server.wire.map((w) => w.method);
      assert.deepStrictEqual(methods.slice(0, 3), ['initialize', 'initialized', 'account/rateLimits/read']);
      assert.ok(!methods.some((m) => m.startsWith('thread/') || m.startsWith('turn/')), 'no thread, no turn, no prompt');
      const auth = server.requests('getAuthStatus');
      assert.strictEqual(auth.length, opts.rateLimits === 'missing' || opts.rateLimits === 'unauthorized' ? 1 : 0, 'getAuthStatus only as the fallback');
      for (const a of auth) assert.deepStrictEqual(a.params, { includeToken: false, refreshToken: false }, 'the token is never asked for');
      await server.flush();
      assert.deepStrictEqual(server.live, [], 'the probe child is closed');
      assert.strictEqual(events.length, 0);
      await ad.dispose();
    }
    // Codex not found: unknown, nothing spawned
    const server = new FakeCodexServer();
    const ad = new CodexAdapter({ spawn: server.spawn, locate: async () => undefined, platform: 'linux', env: {} });
    assert.strictEqual((await ad.verifySignIn!()).status, 'unknown');
    assert.strictEqual(server.spawns.length, 0);
  }

  // ---- spec 012 FR-157: a turn that fails because of the sign-in is marked errorKind 'auth'; a usage limit is a coffee break, not
  {
    for (const [err, kind] of [[{ message: 'unexpected status 401 Unauthorized: token expired', codexErrorInfo: 'unauthorized' }, 'auth'], [{ message: 'You hit your usage limit', codexErrorInfo: 'usageLimitExceeded' }, undefined]] as const) {
      const { ad, events } = make({ server: { turnScript: [{ method: 'turn/completed', params: { threadId: 'thr_main', turn: { id: 'turn_1', status: 'failed', error: err } } }] } });
      const sid = await ad.start({ workspace: dir(), permissionMode: 'read-only', quiet: true });
      await ad.send(sid, { text: 'hi' });
      if (kind === undefined) { // a usage limit is a coffee break (spec 068, #646: the protocol's spelling), never an error and never a sign-in problem
        await until('usage limit', () => events.find((x) => x.type === 'usageLimit'));
        assert.ok(!events.some((x) => x.type === 'status' && x.status === 'error'), 'a usage limit is not an error');
        await ad.dispose();
        continue;
      }
      const e = await until('error status', () => events.find((x) => x.type === 'status' && x.status === 'error'));
      assert.strictEqual((e as { errorKind?: string }).errorKind, kind, `errorKind for ${err.message}`);
      assert.deepStrictEqual(eventProblems(e), []);
      await ad.dispose();
    }
  }

  for (const d of tmp) fs.rmSync(d, { recursive: true, force: true });
  finished = true;
  console.log('codex adapter: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

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
import { CODEX_CAPABILITIES, CODEX_DESCRIPTOR, CodexAdapter } from '../src/adapters/codex';
import { CodexMapper } from '../src/adapters/codexMap';
import { CODEX_INITIALIZE_CAPABILITIES, codexProfileArgs, codexWorkspaceRoots } from '../src/adapters/codexModes';
import { PRODUCTION_DESCRIPTORS, EXPERIMENTAL_DESCRIPTORS } from '../src/adapters/descriptors';
import type { AgentEvent, PermissionMode } from '../src/adapters/types';
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
    if (v !== undefined) return v;
    if (Date.now() > end) throw new assert.AssertionError({ message: `timed out waiting for ${what}` });
    await settle(2);
  }
}
const pendingOf = (events: AgentEvent[]) => events.find((e): e is Extract<AgentEvent, { type: 'status' }> => e.type === 'status' && e.status === 'needs-permission' && e.permission?.state === 'pending')?.permission;
const decisions = (server: FakeCodexServer): unknown[] => server.replies.map((r) => (r.result as { decision?: unknown } | undefined)?.decision);

async function main(): Promise<void> {
  // ---- FR-089: capabilities and optional members
  {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(CODEX_CAPABILITIES)), {
      interrupt: true, resume: true, images: true, models: false, effort: false,
      permissionModes: ['read-only', 'ask', 'allow'], permModeSwitch: 'none',
      usage: { tokens: true, costUsd: false, nanoAiu: false }, context: true, caps: false, helpers: false, history: false, mcpStatus: false, mcpToggle: false,
    });
    assert.ok(Object.isFrozen(CODEX_CAPABILITIES) && Object.isFrozen(CODEX_CAPABILITIES.permissionModes) && Object.isFrozen(CODEX_CAPABILITIES.usage), 'capabilities are deeply frozen');
    const { ad } = make();
    for (const m of ['interrupt', 'resolvePermission', 'revokeGrant']) assert.strictEqual(typeof (ad as unknown as Record<string, unknown>)[m], 'function', `${m} is present`);
    for (const m of ['setCap', 'resolveLimit', 'setMcpEnabled', 'setModel', 'cancelQueuedModel', 'compact', 'listModelOptions', 'setPermMode', 'listPreviousSessions', 'history']) assert.strictEqual((ad as unknown as Record<string, unknown>)[m], undefined, `${m} is absent`);
    assert.strictEqual(ad.capabilities, CODEX_CAPABILITIES);
    // D1 option B: described, but not in the production list.
    assert.strictEqual(CODEX_DESCRIPTOR.capabilities, CODEX_CAPABILITIES);
    assert.ok(CODEX_DESCRIPTOR.create() instanceof CodexAdapter);
    assert.ok(!PRODUCTION_DESCRIPTORS.some((d) => d.id === 'codex'), 'codex is not a production descriptor');
    assert.deepStrictEqual(EXPERIMENTAL_DESCRIPTORS.map((d) => d.id), ['codex']);
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
    assert.deepStrictEqual(methods, ['initialize', 'initialized', 'thread/start'], 'initialize, initialized, then thread/start');
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
        assert.deepStrictEqual(ts, { cwd: a, approvalPolicy: mode === 'ask' ? 'on-request' : 'never', permissions: 'durbar_ro', runtimeWorkspaceRoots: roots });
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
    // resume is T043b: refused loudly, nothing spawned
    {
      const { server, ad } = make();
      await assert.rejects(() => ad.start({ workspace: ws, resumeSessionId: 'thr_x' }), /not available yet/);
      assert.strictEqual(server.spawns.length, 0);
    }
  }

  // ---- FR-092 / FR-094: session ids, send, turn order
  {
    const ws = dir();
    const { server, ad, events } = make();
    const sid = await ad.start({ workspace: ws, permissionMode: 'read-only' });
    assert.strictEqual(sid, 'thr_1', 'the Durbar session id is the thread id');
    assert.deepStrictEqual(events.map((e) => [e.type, (e as { intent?: string }).intent]), [['status', `Ready in ${ws}`]], 'a loud start says Ready once (the thread/started idle is not doubled)');
    await server.flush();
    assert.strictEqual(events.length, 1);
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
    const rep = server.serverRequest('item/fileChange/requestApproval', { threadId: sid, itemId: 'fc_1', changes: [{ path: path.join(ws, 'a.txt') }] }, child);
    await until('the pending state', () => pendingOf(events));
    events.length = 0;
    await ad.stop(sid);
    const r = await rep;
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
      const r = await server.serverRequest('item/fileChange/requestApproval', fileReq('f1'), server.childOfThread(sid)!);
      assert.strictEqual((r.result as { decision: string }).decision, 'decline');
      assert.strictEqual(pendingOf(events), undefined);
      const c = await server.serverRequest('item/commandExecution/requestApproval', { itemId: 'c1', command: 'ls' }, server.childOfThread(sid)!);
      assert.strictEqual((c.result as { decision: string }).decision, 'decline');
      const u = await server.serverRequest('some/unknownRequest', { itemId: 'u1' }, server.childOfThread(sid)!);
      assert.strictEqual((u.result as { decision: string }).decision, 'decline', 'an unknown server request is declined, not approved');
      await ad.dispose();
    }
    // Ask first: pending until resolved; remember keeps a Durbar grant and sends plain accept
    {
      const { server, ad, events } = make();
      const sid = await ad.start({ workspace: ws, permissionMode: 'ask', quiet: true });
      const child = server.childOfThread(sid)!;
      const p1 = server.serverRequest('item/fileChange/requestApproval', fileReq('f1'), child);
      const pend = await until('pending', () => pendingOf(events));
      assert.strictEqual(server.replies.length, 0, 'nothing is answered while it is pending');
      ad.resolvePermission(sid, pend.requestId, true, true);
      assert.strictEqual(((await p1).result as { decision: string }).decision, 'accept');
      events.length = 0;
      const p2 = await server.serverRequest('item/fileChange/requestApproval', fileReq('f2'), child);
      assert.strictEqual((p2.result as { decision: string }).decision, 'accept', 'the grant approves the next one');
      assert.strictEqual(pendingOf(events), undefined);
      const g = [...events].reverse().find((e) => e.type === 'grants');
      void g;
      const p3 = server.serverRequest('item/commandExecution/requestApproval', { itemId: 'c9', command: 'rm x' }, child);
      const pend3 = await until('pending 3', () => pendingOf(events));
      ad.resolvePermission(sid, pend3.requestId, false);
      assert.strictEqual(((await p3).result as { decision: string }).decision, 'decline');
      assert.ok(!decisions(server).includes('acceptForSession'), 'acceptForSession is never sent');
      await ad.dispose();
    }
    // Allow all: accept
    {
      const { server, ad } = make();
      const sid = await ad.start({ workspace: ws, permissionMode: 'allow', quiet: true });
      const r = await server.serverRequest('item/commandExecution/requestApproval', { itemId: 'c1', command: 'ls' }, server.childOfThread(sid)!);
      assert.strictEqual((r.result as { decision: string }).decision, 'accept');
      assert.ok(!decisions(server).includes('acceptForSession'));
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
      const p = server.serverRequest('item/fileChange/requestApproval', fileReq('f1'), child);
      await until('pending', () => pendingOf(events));
      events.length = 0;
      await ad.interrupt(sid);
      await server.flush();
      assert.strictEqual(((await p).result as { decision: string }).decision, 'cancel');
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
      if (fx.notifications[0]?.method === 'thread/started') want.shift();
      if (!fx.notifications.some((n) => n.method === 'turn/completed')) want.push({ type: 'status', status: 'idle' });
      assert.deepStrictEqual(got.slice(1), want, `${f}: adapter events equal the fixture's expected list`);
      await ad.dispose();
    }
  }

  for (const d of tmp) fs.rmSync(d, { recursive: true, force: true });
  console.log('codex adapter: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

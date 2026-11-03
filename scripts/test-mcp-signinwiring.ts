/**
 * Spec 058 FR-205..FR-215 (T179, T181): the wiring of the automatic MCP sign-in refresh, by behaviour. The real `registerMcpIpc` and
 * `ipc/agents` handlers are registered on a stand-in for the electron module (as test-orgwiring.ts does), with the real McpStore in a
 * scratch folder and a FakeAdapter whose sign-in members fail the test if they are called. It proves:
 *  - the window's `agents:send` awaits the per-chat gate before `sendOp` (a reconnect that never ends holds it until the 5 s bound;
 *    Stop through `agents:stop` ends the wait, nothing is sent and no turn is interrupted);
 *  - the scheduler's send (`scheduledSendOp`, what main's scheduler calls) awaits the same gate before the session starts or the prompt goes;
 *  - the turn-end status sets the last-response mark (the next message within the hour reconnects nothing; after it, it does);
 *  - only `restartMcpServer(..., { auto: true })` reaches the adapter: never a sign-in call, never the browser; a local server never;
 *  - the person's own Restart awaits the automatic reconnect of the same server (one call), and clears a block;
 *  - an elicitation from the server under an automatic reconnect is declined and hidden from the window;
 *  - End session forgets the mark.
 * main.ts starts Electron and cannot run here: its hand-over lines are pinned by their text. Fakes only. `npm run test:mcpsigninrefresh`.
 */
process.exitCode = 1;
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { AgentEvent, McpServerStatus } from '../src/adapters/types';
import { FakeAdapter } from '../src/adapters/fake';
import type { McpSignInRefreshNote } from '../src/shared/api';

const H = 60 * 60_000;
const tick = async (n = 10): Promise<void> => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

async function main(): Promise<void> {
  const electronPath = require.resolve('electron');
  const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
  const fake = {
    ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => undefined },
    app: { getVersion: () => '0.0.0', getPath: () => os.tmpdir() },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    shell: { openExternal: async () => assert.fail('the automatic path never opens a browser') },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  };
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-058-wiring-')));
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
    const { registerMcpIpc } = require('../src/main/mcpipc') as typeof import('../src/main/mcpipc');
    const { McpStore } = require('../src/main/mcpstore') as typeof import('../src/main/mcpstore');
    const agentsIpc = require('../src/main/ipc/agents') as typeof import('../src/main/ipc/agents');
    const { AgentStateTracker } = require('../src/main/mcp/agentstate') as typeof import('../src/main/mcp/agentstate');
    const { scheduledSendOp } = require('../src/main/agentops') as typeof import('../src/main/agentops');
    /* eslint-enable @typescript-eslint/no-require-imports */

    const frame = { url: pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href };
    const win = { senderFrame: frame, sender: { mainFrame: frame } };
    const call = (ch: string, ...a: unknown[]): Promise<unknown> => Promise.resolve(handlers.get(ch)!(win, ...a));

    const ad = new FakeAdapter({ displayName: 'Copilot', capabilities: { mcpRestart: true, mcpSignIn: true, mcpSignInReconnect: true } as never });
    // FR-214: fakes that fail on every call the automatic path must never make
    const forbidden: string[] = [];
    ad.startMcpSignIn = async () => { forbidden.push('startMcpSignIn'); throw new Error('never'); };
    ad.cancelMcpSignIn = async () => { forbidden.push('cancelMcpSignIn'); };
    ad.refreshMcpStatus = async () => { forbidden.push('refreshMcpStatus'); };
    const answered: unknown[] = [];
    (ad as unknown as { answerElicitation: (a: string, b: string, c: unknown) => void }).answerElicitation = (a, b, c) => { answered.push([a, b, c]); };
    const ws = path.join(root, 'ws');
    fs.mkdirSync(ws);
    // the Copilot CLI list Durbar reads (and the runtime loads): `wiki` is known by its https address
    fs.mkdirSync(path.join(root, 'copilot'));
    fs.writeFileSync(path.join(root, 'copilot', 'mcp-config.json'), JSON.stringify({ mcpServers: { wiki: { type: 'http', url: 'https://wiki.example/mcp' }, tool: { type: 'stdio', command: 'tool-mcp' } } }));
    const sid = await ad.start({ workspace: ws, quiet: true });
    const sid2 = await ad.start({ workspace: ws, quiet: true });
    const agents = new Map([[sid, { id: sid, cwd: '', name: 'Mia', permMode: 'read-only' } as never], [sid2, { id: sid2, cwd: '', name: 'Ola', permMode: 'ask' } as never]]);
    const listeners: ((e: AgentEvent) => void)[] = [];
    const router = {
      onEvent: (fn: (e: AgentEvent) => void) => { listeners.push(fn); return () => undefined; },
      forAgent: (id: string) => (agents.has(id) ? ad : undefined),
      adapterIdOf: () => 'fake',
    };
    ad.onEvent((e) => listeners.forEach((l) => l(e)));
    const emit = (id: string, e: Record<string, unknown>): void => listeners.forEach((l) => l({ sessionId: id, timestamp: 1, ...e } as unknown as AgentEvent));
    const clock = { now: 100 * H };
    const pushes: McpSignInRefreshNote[] = [];
    const timers: { fn: () => void; done: boolean }[] = [];
    const logs: string[] = [];
    let busy = false;
    const store = new McpStore(path.join(root, 'durbar-mcp.json'));
    store.load();
    const mcp = registerMcpIpc({
      store: () => store,
      agents,
      router: router as never,
      dev: { DURBAR_COPILOT_DIR: path.join(root, 'copilot') } as never,
      appOf: () => 'copilot',
      log: (_a, line) => logs.push(line),
      openUrl: async () => assert.fail('never the browser'),
      signInRefresh: { now: () => clock.now, on: () => true, platform: 'linux', busy: () => busy, push: (p) => pushes.push(p), timers: { set: (fn) => { const h = { fn, done: false }; timers.push(h); return h; }, clear: (h) => { (h as { done: boolean }).done = true; } } },
    });

    // the adapter: a restart that the test finishes, reporting the whole list again (as the real adapters do)
    const list = (docs: string): McpServerStatus[] => [{ name: 'docs', status: docs, transport: 'http' }, { name: 'files', status: 'connected', transport: 'stdio' }];
    const pending: Array<(st: string) => void> = [];
    ad.restartMcpServer = async (s, n, o) => {
      ad.restartCalls.push({ sessionId: s, name: n, ...(o?.auto ? { auto: true } : {}) });
      const st = await new Promise<string>((r) => pending.push(r));
      emit(s, { type: 'mcp', servers: list(st) });
      if (st !== 'connected') throw new Error('Server status: needs-auth');
    };
    const sent: string[] = [];
    const order: string[] = [];
    const interrupts: string[] = [];
    const agentState = new AgentStateTracker();
    agentsIpc.register({
      agents, router: router as never, agentState, opsDeps: { agents, router: { forAgent: () => ({ isLive: () => true, interrupt: async (id: string) => { interrupts.push(id); }, capabilities: { interrupt: true } }) } } as never,
      remoteOps: { release: async () => undefined, has: () => false } as never, getScheduler: () => undefined, getCheckpointStore: () => undefined, vsChatRefs: new Map(), continued: new Map(), wsKey: () => ws, asEffort: () => undefined,
      addMany: async () => ({ ok: true, agents: [] }) as never, addWorkspace: (async () => undefined) as never, ensureLive: async () => undefined, readyAdapterIds: async () => new Set<string>(), forgetOpenSession: () => undefined,
      maskHistory: (_id, h) => h, mcpSecrets: () => [], logMcp: () => undefined,
      sendOp: async (id: string) => { sent.push(id); return { ok: true }; },
      mcpGate: (id) => mcp.signInRefresh.beforeSend(id),
      mcpStopWait: (id) => mcp.signInRefresh.stopWait(id),
      mcpForget: (id) => { order.push(`forget ${id}`); mcp.signInRefresh.forget(id); },
    });
    listeners.push((e) => { if (e.type === 'status' && e.status === 'stopped') order.push(`stopped ${e.sessionId}`); });

    // ---- first message: a needs-auth remote server is reconnected before sendOp; the local one never ----
    emit(sid, { type: 'mcp', servers: list('needs-auth') });
    const s1 = call('agents:send', sid, 'hello', []);
    await tick();
    assert.deepStrictEqual(sent, [], 'the window send waits for the gate: sendOp not called yet');
    assert.deepStrictEqual(ad.restartCalls, [{ sessionId: sid, name: 'docs', auto: true }], 'one automatic reconnect of the remote needs-auth server only');
    assert.deepStrictEqual(pushes, [{ id: sid, kind: 'waiting', count: 1 }]);
    pending.shift()!('connected');
    assert.deepStrictEqual(await s1, { ok: true });
    assert.deepStrictEqual(sent, [sid], 'sent after the reconnect');
    assert.deepStrictEqual(pushes[pushes.length - 1], { id: sid, kind: 'done' });
    assert.deepStrictEqual(logs, ['MCP server docs reconnected before your message (automatic)'], 'the automatic row replaces "restarted"');
    assert.ok(timers.every((t) => t.done), 'the bound timer is cleared');

    // ---- the turn-end mark: within the hour nothing, after it the connected remote server ----
    emit(sid, { type: 'status', status: 'idle' });
    clock.now += H - 1;
    assert.deepStrictEqual(await call('agents:send', sid, 'again', []), { ok: true });
    assert.strictEqual(ad.restartCalls.length, 1, '59:59 after the response: no reconnect');
    emit(sid, { type: 'status', status: 'idle' });
    clock.now += H;
    const s2 = call('agents:send', sid, 'after an hour', []);
    await tick();
    assert.deepStrictEqual(ad.restartCalls[1], { sessionId: sid, name: 'docs', auto: true }, 'a quiet hour later: the connected remote server is reconnected (Read-only included, G5 = A)');
    // the person's Restart of the same server meanwhile awaits the same reconnect (FR-209 promise map): one adapter call
    const manual = call('agents:mcpRestart', sid, 'docs');
    await tick();
    assert.strictEqual(ad.restartCalls.length, 2, 'the Restart shares the running reconnect');
    // ---- the 5 s bound: the reconnect does not end; the timer fires; the message goes; then the needs-auth result ----
    timers[timers.length - 1].fn();
    assert.deepStrictEqual(await s2, { ok: true }, 'sent at the bound');
    assert.deepStrictEqual(pushes[pushes.length - 1], { id: sid, kind: 'late', names: ['docs'] });
    pending.shift()!('needs-auth');
    const mr = (await manual) as { ok: boolean };
    assert.strictEqual(mr.ok, false, 'the shared result');
    await tick();
    assert.deepStrictEqual(pushes[pushes.length - 1], { id: sid, kind: 'needs-sign-in', name: 'docs' }, 'the sign-in line comes when the reconnect ends');
    // blocked now: another quiet hour, no reconnect; the person's Restart clears it
    emit(sid, { type: 'status', status: 'idle' });
    clock.now += 2 * H;
    await call('agents:send', sid, 'later', []);
    assert.strictEqual(ad.restartCalls.length, 2, 'blocked after a needs-sign-in result');
    const r3 = call('agents:mcpRestart', sid, 'docs');
    await tick();
    pending.shift()!('connected');
    assert.deepStrictEqual(await r3, { ok: true });
    emit(sid, { type: 'mcp', servers: list('needs-auth') });
    clock.now += 1;
    const s4 = call('agents:send', sid, 'now', []);
    await tick();
    assert.strictEqual(ad.restartCalls.length, 4, 'after the Restart: tried again');

    // ---- Stop during the wait: nothing sent, no turn interrupted ----
    const sentBefore = sent.length;
    assert.strictEqual(await call('agents:stop', sid), undefined);
    assert.deepStrictEqual(await s4, { ok: false, notSent: true, error: 'Not sent: you stopped it while MCP sign-ins were reconnecting.' });
    assert.strictEqual(sent.length, sentBefore, 'nothing was sent');
    assert.deepStrictEqual(interrupts, [sid], 'Stop also interrupts the turn (review of PR #1080, item 2: a turn that runs is never missed)');
    interrupts.length = 0;
    assert.strictEqual(agentState.get(sid)?.state, 'idle', 'the agent is ready again, not an error');
    assert.deepStrictEqual(pushes[pushes.length - 1], { id: sid, kind: 'not-sent' });
    await call('agents:stop', sid);
    assert.deepStrictEqual(interrupts, [sid], 'with no wait, Stop interrupts the turn as before');

    // ---- review of PR #1080, item 4: a gate that throws never holds a message or loses a scheduled run ----
    {
      const sentB = sent.length;
      const realGate = mcp.signInRefresh.beforeSend.bind(mcp.signInRefresh);
      (mcp.signInRefresh as unknown as { beforeSend: unknown }).beforeSend = () => { throw new Error('gate broke'); };
      assert.deepStrictEqual(await call('agents:send', sid, 'gate broke', []), { ok: true }, 'the window send goes');
      assert.strictEqual(sent.length, sentB + 1, 'sendOp was called');
      const out: string[] = [];
      const r = await scheduledSendOp({ agent: agents.get(sid), adapter: { send: async (x: string) => { out.push(x); } } as never, agentState, gate: () => Promise.reject(new Error('gate broke')), ensureLive: async () => undefined, toWindow: () => undefined, noteLastSession: () => undefined, now: () => 0 }, 'nightly', { id: 's9' });
      assert.deepStrictEqual([r, out], [sid, [sid]], 'the scheduled run goes, it is not lost');
      (mcp.signInRefresh as unknown as { beforeSend: unknown }).beforeSend = realGate;
    }

    // ---- an elicitation from the server under the automatic reconnect is declined and hidden (FR-215) ----
    emit(sid, { type: 'question', phase: 'asked', requestId: 'el-1', elicitation: { message: 'Pick a tenant', source: 'docs' } });
    assert.deepStrictEqual(answered, [[sid, 'el-1', { action: 'decline' }]], 'declined');
    assert.strictEqual(mcp.hidesEvent({ type: 'question', requestId: 'el-1' }), true, 'not shown to the window');
    emit(sid, { type: 'question', phase: 'asked', requestId: 'el-2', elicitation: { message: 'other', source: 'files' } });
    assert.strictEqual(answered.length, 1, 'another server: the normal card');
    assert.strictEqual(mcp.hidesEvent({ type: 'question', requestId: 'el-2' }), false);
    pending.shift()!('connected');
    await tick();
    assert.deepStrictEqual(pushes[pushes.length - 1], { id: sid, kind: 'needs-sign-in', name: 'docs' }, 'a declined elicitation: needs a sign-in, even though it reads connected');

    // ---- a reconnect that fails with no new report: the old `connected` is not taken as a success (FR-207) ----
    {
      const real = ad.restartMcpServer;
      ad.restartMcpServer = async (s2, n, o) => { ad.restartCalls.push({ sessionId: s2, name: n, ...(o?.auto ? { auto: true } : {}) }); throw new Error('Claude Code starts its MCP servers with your next message; there is nothing to restart yet.'); };
      mcp.signInRefresh.clearBlock(undefined, 'docs');
      emit(sid, { type: 'mcp', servers: list('connected') });
      emit(sid, { type: 'status', status: 'idle' });
      clock.now += 2 * H;
      const rowsBefore = logs.length;
      await call('agents:send', sid, 'no report', []);
      assert.deepStrictEqual(logs.slice(rowsBefore), ['MCP server docs could not reconnect (automatic)'], 'failed, not "reconnected"');
      ad.restartMcpServer = real;
      clock.now += 2 * H; // past that attempt's gap (one attempt per server per gap, app-wide)
    }

    // ---- the scheduler's send awaits the same gate (scheduledSendOp, as main's scheduler calls it) ----
    assert.strictEqual(mcp.signInRefresh.inFlight().length, 0);
    mcp.signInRefresh.clearBlock(undefined, 'docs'); // the block above is app-wide (same adapter, name and address): as if the person signed in
    emit(sid2, { type: 'mcp', servers: list('needs-auth') });
    const shown: string[] = [];
    const sentSched: string[] = [];
    const schedAd = { send: async (id: string) => { sentSched.push(id); } } as never;
    const sch = scheduledSendOp({ agent: agents.get(sid2), adapter: schedAd, agentState, gate: (id) => mcp.signInRefresh.beforeSend(id), ensureLive: async () => { shown.push('live'); }, toWindow: (ch) => shown.push(ch), noteLastSession: () => undefined, now: () => 0 }, 'nightly', { id: 's1' });
    await tick();
    assert.deepStrictEqual([shown, sentSched], [[], []], 'the scheduled prompt waits: no session start, nothing shown or sent');
    assert.strictEqual(ad.restartCalls[ad.restartCalls.length - 1].name, 'docs');
    pending.shift()!('connected');
    assert.strictEqual(await sch, sid2);
    assert.deepStrictEqual([shown, sentSched], [['live', 'agent:event', 'schedule:ran'], [sid2]], 'then it goes');
    // Stop during a scheduled wait: the run is a send error, nothing goes
    emit(sid2, { type: 'mcp', servers: list('needs-auth') });
    mcp.signInRefresh.clearBlock(undefined, 'docs');
    clock.now += 2 * H;
    emit(sid2, { type: 'status', status: 'idle' });
    clock.now += 2 * H;
    const sch2 = scheduledSendOp({ agent: agents.get(sid2), adapter: schedAd, agentState, gate: (id) => mcp.signInRefresh.beforeSend(id), ensureLive: async () => undefined, toWindow: () => undefined, noteLastSession: () => undefined, now: () => 0 }, 'nightly', { id: 's1' });
    await tick();
    assert.strictEqual(mcp.signInRefresh.stopWait(sid2), true);
    await assert.rejects(sch2, /Not sent/);
    assert.strictEqual(sentSched.length, 1, 'nothing sent after Stop');
    pending.shift()!('connected');
    await tick();

    // ---- End session forgets the mark (T179), after the session's own `stopped` (which is a turn end too) ----
    emit(sid2, { type: 'mcp', servers: list('connected') });
    emit(sid2, { type: 'status', status: 'idle' });
    clock.now += 2 * H;
    order.length = 0;
    await call('agents:end', sid2);
    assert.deepStrictEqual(order, [`stopped ${sid2}`, `forget ${sid2}`], 'the mark is forgotten after the stopped event set it');
    // as if the same chat came back (resume) with a report: the next message is a first message, so a connected server is left to the app
    const sid3 = await ad.start({ workspace: ws, quiet: true });
    agents.set(sid3, { id: sid3, cwd: '', name: 'Back', permMode: 'ask' } as never);
    emit(sid3, { type: 'mcp', servers: list('connected') });
    clock.now += 2 * H;
    const before = ad.restartCalls.length;
    await mcp.signInRefresh.beforeSend(sid3);
    assert.strictEqual(ad.restartCalls.length, before, 'a session with no response yet: a connected server is left to the app');

    // ---- a report without a transport (Copilot's `list`, real 2026-11-03): remote when Durbar knows an http(s) address, else not ----
    {
      const real = ad.restartMcpServer;
      const asked: string[] = [];
      ad.restartMcpServer = async (s2, n) => { asked.push(n); emit(s2, { type: 'mcp', servers: [{ name: 'wiki', status: 'connected' }, { name: 'tool', status: 'connected' }, { name: 'plugin', status: 'connected' }] }); };
      emit(sid3, { type: 'mcp', servers: [{ name: 'wiki', status: 'connected' }, { name: 'tool', status: 'connected' }, { name: 'plugin', status: 'connected' }] });
      emit(sid3, { type: 'status', status: 'idle' });
      clock.now += 2 * H;
      await mcp.signInRefresh.beforeSend(sid3);
      assert.deepStrictEqual(asked, ['wiki'], 'the https server of the Copilot CLI list only; not its stdio one, not one Durbar has no address for');
      ad.restartMcpServer = real;
    }

    // ---- the app's OS sandbox covers its MCP servers (Copilot in Read-only and Ask first): no reconnect, only the sign-in line ----
    {
      const info = agents.get(sid3) as unknown as { sandbox?: unknown };
      for (const st of ['on', 'unknown']) {
        info.sandbox = { state: st, covers: ['shell', 'mcp'], verified: false };
        emit(sid3, { type: 'mcp', servers: list('needs-auth') });
        mcp.signInRefresh.clearBlock(undefined, 'docs');
        emit(sid3, { type: 'status', status: 'idle' });
        clock.now += 2 * H;
        const n0: number = ad.restartCalls.length;
        const p0: number = pushes.length;
        assert.strictEqual(await mcp.signInRefresh.beforeSend(sid3), 'go');
        assert.strictEqual(ad.restartCalls.length, n0, `sandbox ${st} covering mcp: no reconnect`);
        assert.deepStrictEqual(pushes.slice(p0), [{ id: sid3, kind: 'needs-sign-in', name: 'docs' }], 'only the sign-in line, no wait');
      }
      info.sandbox = { state: 'on', covers: ['shell'], verified: false }; // Claude Code's sandbox: shell only
      emit(sid3, { type: 'status', status: 'idle' });
      clock.now += 2 * H;
      const n1 = ad.restartCalls.length;
      const p1 = mcp.signInRefresh.beforeSend(sid3);
      await tick();
      assert.strictEqual(ad.restartCalls.length, n1 + 1, 'a sandbox that does not cover MCP: reconnected');
      pending.shift()!('connected');
      await p1;
      delete info.sandbox;
      clock.now += 2 * H;
    }

    // ---- an adapter without `mcpSignInReconnect` (Codex, the Claude SDK transport) gets nothing, even with restartMcpServer ----
    emit(sid3, { type: 'mcp', servers: list('needs-auth') });
    mcp.signInRefresh.clearBlock(undefined, 'docs');
    clock.now += 2 * H;
    const base2 = ad.restartCalls.length;
    const caps = ad.capabilities;
    (ad as unknown as { capabilities: unknown }).capabilities = { ...caps, mcpSignInReconnect: undefined };
    assert.strictEqual(await mcp.signInRefresh.beforeSend(sid3), 'go');
    assert.strictEqual(ad.restartCalls.length, base2, 'no capability: no automatic reconnect');
    (ad as unknown as { capabilities: unknown }).capabilities = caps;
    const p3 = mcp.signInRefresh.beforeSend(sid3);
    await tick();
    assert.strictEqual(ad.restartCalls.length, base2 + 1, 'with it (the same chat, needs-auth): one reconnect');
    pending.shift()!('connected');
    await p3;

    assert.deepStrictEqual(forbidden, [], 'never a sign-in call or a status read from the automatic path');
    assert.ok(!JSON.stringify([pushes, logs]).includes('Server status'), 'no app text in a line or a row');
  } finally {
    delete require.cache[electronPath];
    fs.rmSync(root, { recursive: true, force: true });
  }

  // ---- main.ts hands the gate, the clock, the resume and the window filter over (pinned by text) ----
  const mainSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.ts'), 'utf8').replace(/\r/g, '');
  const pins: Array<[RegExp, string]> = [
    [/mcpGate: \(id\) => mcp\.signInRefresh\.beforeSend\(id\), mcpStopWait: \(id\) => mcp\.signInRefresh\.stopWait\(id\), mcpForget: \(id\) => mcp\.signInRefresh\.forget\(id\)/, 'the window send path gets the gate, Stop and forget'],
    [/return scheduledSendOp\(\{ agent: a, adapter: a \? router\.forAgent\(a\.id\) : undefined, agentState, gate: \(id\) => mcp\.signInRefresh\.beforeSend\(id\),/, 'the scheduler send goes through scheduledSendOp with the gate'],
    [/powerMonitor\.on\('resume', \(\) => mcp\.signInRefresh\.resumed\(\)\)/, 'a wake from sleep marks every chat'],
    [/now: \(\) => performance\.now\(\),\n\s+on: \(\) => !SIMULATOR && \(settingsStore\?\.mcpSignInRefresh \?\? MCP_SIGNIN_REFRESH_DEFAULT\),/, 'the monotonic clock and the switch (never under the simulator)'],
    [/push: \(p\) => toRenderer\('agents:mcpSignInRefresh', p\),/, 'the lines go to the window'],
    [/router\.onEvent\(\(e\) => \{ if \(!mcp\.hidesEvent\(e\)\) toRenderer\('agent:event'/, 'a declined elicitation is not shown'],
  ];
  for (const [re, what] of pins) assert.ok(re.test(mainSrc), `main.ts: ${what}`);
  const block = mainSrc.slice(mainSrc.indexOf('  signInRefresh: {'), mainSrc.indexOf('  signInRefresh: {') + 700);
  assert.ok(block.includes('performance.now()') && !block.includes('Date.now'), 'main.ts: the refresh never reads the wall clock');
  process.exitCode = 0;
  console.log('[058] mcp sign-in refresh wiring: PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

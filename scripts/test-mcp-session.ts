/**
 * Spec 058 (issue #349): per-server Restart and Restart session with these servers, and the `agents:mcp` reply.
 * `npm run test:mcpsession`. Fake adapters and the fake Copilot SDK only: no runtime, no account, no credits.
 *
 *  - `agentMcpReply` (FR-020, FR-005 / T021): errors masked before they leave main; `canRestart` only where it can work;
 *  - `mcpRestartOp` (FR-021): validation, one restart per server at a time, masked error, activity row;
 *  - `mcpRestartSessionOp` (FR-022, FR-027): end then resume the same id, no prompt; refused while busy without confirmation;
 *    a failed resume leaves the agent ended; a sign-in failure says `errorKind: 'auth'`;
 *  - `endSessionOp` (FR-022, FR-023): remote control off first, then the session stops;
 *  - the Copilot adapter (FR-012, SC-003): `rpc.mcp.restartServer` for that name only; off then on only when the runtime does not know
 *    the method (MethodNotFound) or the SDK lacks it; never stopServer or reload.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FakeAdapter } from '../src/adapters/fake';
import type { AgentAdapter, McpServerStatus } from '../src/adapters/types';
import type { AgentInfo } from '../src/shared/api';
import { endSessionOp } from '../src/main/agentops';
import { agentMcpReply, mcpRestartOp, mcpRestartSessionOp, validServerName } from '../src/main/mcpsession';
import type { McpReplyInput, RestartDeps, RestartSessionDeps } from '../src/main/mcpsession';
import { isMethodNotFound } from '../src/adapters/copilot';
import { FakeClient, FakeCopilot } from './fakes/copilot-sdk';

const info = (id: string): AgentInfo => ({ id, name: 'Ana', cwd: '/w', permMode: 'ask', model: 'auto' }) as AgentInfo;
const routerOf = (ad: AgentAdapter | undefined) => ({ forAgent: () => ad });

// A promise that never settles lets Node exit with code 0 before the end: fail instead (review on #473).
let done = false;
process.on('exit', (code) => {
  if (code === 0 && !done) {
    console.error('[058] mcp session: FAIL (exited before the last check; a pending promise never settled)');
    process.exitCode = 1;
  }
});

async function main(): Promise<void> {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-mcp-session-'));
  try {
    // ---- agentMcpReply (FR-020, FR-005; T021's missing reply test) ----
    {
      const ad = new FakeAdapter({ capabilities: { mcpStart: 'session', mcpToggleApplies: 'live' } });
      const sid = await ad.start({ workspace: ws, quiet: true });
      const a = info(sid);
      const secret = 'hdr-value-1234567890';
      const live: McpServerStatus[] = [
        { name: 'notes', status: 'failed', error: `401 from https://user:pw@api.example.com/mcp with Authorization: Bearer ${secret} and ghp_abcdefghijklmnopqrstuvwxyz0123456789` },
        { name: 'web', status: 'connected' },
        { name: 'off-one', status: 'disabled' },
        { name: 'rt-only', status: 'connected' },
      ];
      const base: McpReplyInput = {
        a, ad, live, off: new Set(['off-one']), secrets: [secret],
        cli: [{ name: 'notes', enabled: true }, { name: 'web', enabled: true }, { name: 'off-one', enabled: true }, { name: 'later', enabled: true }],
        extras: [{ name: 'local', enabled: true, trusted: false }],
        ambientDisabled: new Set(),
      };
      const r = agentMcpReply(base);
      const by = (n: string) => r.servers.find((x) => x.name === n)!;
      const json = JSON.stringify(r);
      assert.ok(!json.includes(secret), 'an extra\'s header value never reaches the window (FR-005)');
      assert.ok(!json.includes('ghp_abcdefghijklmnopqrstuvwxyz0123456789'), 'a ghp_ token is masked');
      assert.ok(!json.includes('user:pw'), 'URL credentials are masked');
      assert.ok(by('notes').error && by('notes').error!.includes('[redacted]'), 'the error stays readable with [redacted]');
      assert.strictEqual(by('notes').canRestart, true, 'a failed server that is on can be restarted');
      assert.strictEqual(by('web').canRestart, true);
      assert.strictEqual(by('off-one').canRestart, undefined, 'a server switched off for this agent: no Restart (switch it on)');
      assert.strictEqual(by('later').canRestart, undefined, 'a server the running session never reported: no Restart');
      assert.strictEqual(by('local').canRestart, undefined, 'an untrusted extra (off): no Restart');
      assert.strictEqual(by('rt-only').origin, 'runtime');
      assert.deepStrictEqual([r.live, r.start, r.toggleApplies, r.canRestartSession], [true, 'session', 'live', true]);

      const noMember = agentMcpReply({ ...base, ad: new FakeAdapter({ omit: ['restartMcpServer'] }) });
      assert.ok(noMember.servers.every((x) => !x.canRestart), 'an agent app without restartMcpServer never offers Restart (Codex, FR-032)');
      await ad.stop(sid);
      const ended = agentMcpReply(base);
      assert.ok(!ended.live && ended.servers.every((x) => !x.canRestart) && ended.canRestartSession === false, 'no running session: no Restart, no Restart session');
      const noResume = new FakeAdapter({ capabilities: { resume: false } });
      const sid2 = await noResume.start({ workspace: ws, quiet: true });
      assert.strictEqual(agentMcpReply({ ...base, a: info(sid2), ad: noResume }).canRestartSession, false, 'an app that cannot resume has no Restart session');
      assert.strictEqual(agentMcpReply({ ...base, ad: undefined }).canRestartSession, false);
    }

    // ---- mcpRestartOp (FR-021) ----
    {
      assert.ok(validServerName('a') && validServerName('x'.repeat(64)));
      assert.ok(!validServerName('') && !validServerName('x'.repeat(65)) && !validServerName(3) && !validServerName(undefined));
      const ad = new FakeAdapter();
      const sid = await ad.start({ workspace: ws, quiet: true });
      const agents = new Map([[sid, info(sid)]]);
      const logged: string[] = [];
      const off = new Set<string>(['quiet']);
      const live: McpServerStatus[] = [{ name: 'notes', status: 'failed' }, { name: 'quiet', status: 'disabled' }, { name: 'rt-off', status: 'disabled' }];
      const d: RestartDeps = { agents, router: routerOf(ad), live: () => live, off: () => off, secrets: () => ['sekret-value-42'], log: (_a, t) => logged.push(t) };
      const running = new Set<string>();

      assert.deepStrictEqual(await mcpRestartOp(d, running, 'nope', 'notes'), { ok: false, error: 'Unknown agent or server.' });
      assert.strictEqual((await mcpRestartOp(d, running, sid, 'x'.repeat(65))).ok, false, 'a name over 64 characters is refused');
      assert.strictEqual((await mcpRestartOp(d, running, sid, { toString: () => 'notes' })).ok, false, 'a non-string name is refused');
      assert.match((await mcpRestartOp(d, running, sid, 'other')).error!, /not running in this session/, 'a name the session does not know is refused');
      assert.match((await mcpRestartOp(d, running, sid, 'quiet')).error!, /Switch it on first/);
      assert.match((await mcpRestartOp(d, running, sid, 'rt-off')).error!, /Switch it on first/, 'a server the runtime reports disabled is not started by a Restart');
      assert.strictEqual(ad.restartCalls.length, 0, 'nothing reached the adapter so far');

      assert.deepStrictEqual(await mcpRestartOp(d, running, sid, 'notes'), { ok: true });
      assert.deepStrictEqual(ad.restartCalls, [{ sessionId: sid, name: 'notes' }], 'exactly one per-server restart for the named server (SC-003)');
      assert.deepStrictEqual(logged, ['MCP server notes restarted'], 'one activity row, no error text');

      // one at a time per server: a second press while the first runs is refused
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const slow = new FakeAdapter();
      const sid3 = await slow.start({ workspace: ws, quiet: true });
      slow.restartMcpServer = async (s, n) => { slow.restartCalls.push({ sessionId: s, name: n }); await gate; };
      const d3: RestartDeps = { ...d, agents: new Map([[sid3, info(sid3)]]), router: routerOf(slow) };
      // the second call is not awaited before release(): without the lock it would wait on the gate too, so it must not hang the test
      const first = mcpRestartOp(d3, running, sid3, 'notes');
      const second = mcpRestartOp(d3, running, sid3, 'notes');
      assert.strictEqual(slow.restartCalls.length, 1, 'the second press never reached the adapter while the first runs');
      release();
      const [r1, r2] = await Promise.all([first, second]);
      assert.deepStrictEqual(r1, { ok: true });
      assert.strictEqual(r2.ok, false, 'a second restart of the same server is refused');
      assert.match(r2.error!, /already restarting/);
      assert.strictEqual(slow.restartCalls.length, 1, 'exactly one restart ran');
      assert.strictEqual(running.size, 0, 'the lock is released');
      assert.deepStrictEqual(await mcpRestartOp(d3, running, sid3, 'notes'), { ok: true }, 'after it, the server can be restarted again');

      // the adapter's error is masked and short
      const rows = logged.length;
      ad.failRestart = 'spawn failed: env TOKEN=sekret-value-42 not accepted';
      const bad = await mcpRestartOp(d, running, sid, 'notes');
      assert.strictEqual(bad.ok, false);
      assert.ok(!bad.error!.includes('sekret-value-42') && bad.error!.includes('[redacted]'), `masked: ${bad.error}`);
      assert.strictEqual(logged.length, rows, 'a failed restart writes no activity row');

      // an app without restartMcpServer (Codex) and a session that is not running
      const codexLike = new FakeAdapter({ displayName: 'Codex', capabilities: { mcpRestart: false } });
      const sid4 = await codexLike.start({ workspace: ws, quiet: true });
      const r4 = await mcpRestartOp({ ...d, agents: new Map([[sid4, info(sid4)]]), router: routerOf(codexLike) }, running, sid4, 'notes');
      assert.match(r4.error!, /^Codex cannot restart one MCP server\. Use Restart session with these servers\.$/);
      await ad.stop(sid);
      assert.match((await mcpRestartOp(d, running, sid, 'notes')).error!, /not running/, 'an ended session: refused, nothing started');
      assert.ok(!ad.isLive(sid), 'no session was started');
    }

    // ---- mcpRestartSessionOp (FR-022, FR-027, SC-004) ----
    {
      const ad = new FakeAdapter();
      const sid = await ad.start({ workspace: ws, quiet: true });
      const a = info(sid);
      const agents = new Map([[sid, a]]);
      const calls: string[] = [];
      let busy = false;
      let resumeError: Error | undefined;
      const logged: string[] = [];
      const d: RestartSessionDeps = {
        agents,
        router: routerOf(ad),
        busy: () => busy,
        endSession: async (id) => { calls.push(`end ${id}`); await ad.stop(id); },
        resume: async (x) => {
          calls.push(`resume ${x.id}`);
          if (resumeError) throw resumeError;
          await ad.start({ workspace: ws, sessionId: x.id, mcpServers: { fresh: { type: 'stdio', command: 'node', args: [] } as never } });
        },
        secrets: () => ['sekret-value-42'],
        log: (_a, t) => logged.push(t),
      };
      const running = new Set<string>();
      const sends = () => calls.filter((c) => c.startsWith('send')).length;
      const realSend = ad.send.bind(ad);
      ad.send = async (id, m) => { calls.push('send'); return realSend(id, m); };

      busy = true;
      assert.deepStrictEqual(await mcpRestartSessionOp(d, running, sid, false), { ok: false, needsConfirm: true }, 'busy without confirmation: ask first');
      assert.deepStrictEqual(calls, [], 'and nothing changed');
      assert.deepStrictEqual(await mcpRestartSessionOp(d, running, sid, 'yes'), { ok: false, needsConfirm: true }, 'only `true` confirms');
      assert.deepStrictEqual(await mcpRestartSessionOp(d, running, sid, true), { ok: true });
      assert.deepStrictEqual(calls, [`end ${sid}`, `resume ${sid}`], 'End session first, then the same id through the resume path');
      assert.ok(ad.isLive(sid), 'the same session id is live again');
      assert.strictEqual(sends(), 0, 'no prompt was sent (a resume spends no AI credits)');
      assert.deepStrictEqual(logged, ['Session restarted with the current MCP servers']);

      busy = false;
      calls.length = 0;
      assert.deepStrictEqual(await mcpRestartSessionOp(d, running, sid, false), { ok: true }, 'idle: no question');
      assert.deepStrictEqual(calls, [`end ${sid}`, `resume ${sid}`]);

      // a failed resume leaves the agent ended; the error is masked; a sign-in failure is marked
      calls.length = 0;
      resumeError = new Error('Failed to authenticate. API Error: 401 OAuth access token is invalid.');
      const auth = await mcpRestartSessionOp(d, running, sid, false);
      assert.deepStrictEqual([auth.ok, auth.ended, auth.errorKind], [false, true, 'auth'], `sign-in failure (FR-027): ${JSON.stringify(auth)}`);
      assert.ok(!ad.isLive(sid), 'the agent stays ended, as after End session');
      assert.match((await mcpRestartSessionOp(d, running, sid, false)).error!, /not running/, 'an ended session is not restarted (a message resumes it)');
      await ad.start({ workspace: ws, sessionId: sid, quiet: true });
      resumeError = new Error('spawn failed with TOKEN=sekret-value-42');
      const other = await mcpRestartSessionOp(d, running, sid, false);
      assert.deepStrictEqual([other.ok, other.ended, other.errorKind], [false, true, undefined], 'another error is not a sign-in error');
      assert.ok(other.error!.includes('[redacted]') && !other.error!.includes('sekret-value-42'), 'masked');
      resumeError = undefined;

      // refusals
      assert.deepStrictEqual(await mcpRestartSessionOp(d, running, 'nope', true), { ok: false, error: 'Unknown agent.' });
      const noResume = new FakeAdapter({ displayName: 'Basic', capabilities: { resume: false } });
      const sid2 = await noResume.start({ workspace: ws, quiet: true });
      const nr = await mcpRestartSessionOp({ ...d, agents: new Map([[sid2, info(sid2)]]), router: routerOf(noResume) }, running, sid2, true);
      assert.match(nr.error!, /^Basic cannot resume a session/);
      assert.ok(noResume.isLive(sid2), 'refused: nothing ended');

      // one at a time
      await ad.start({ workspace: ws, sessionId: sid, quiet: true });
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let ends = 0;
      const slow: RestartSessionDeps = { ...d, endSession: async (id) => { ends++; await gate; await ad.stop(id); } };
      calls.length = 0;
      // not awaited before release(): without the lock the second call would end the session again and wait on the gate
      const first = mcpRestartSessionOp(slow, running, sid, false);
      const second = mcpRestartSessionOp(slow, running, sid, false);
      assert.strictEqual(ends, 1, 'the second press never started a second End session');
      release();
      const [s1, s2] = await Promise.all([first, second]);
      assert.deepStrictEqual(s1, { ok: true });
      assert.strictEqual(s2.ok, false, 'a second Restart session while one runs is refused');
      assert.match(s2.error!, /already restarting/);
      assert.strictEqual(ends, 1, 'exactly one End session ran');
      assert.deepStrictEqual(calls, [`resume ${sid}`], 'and exactly one resume');
      assert.strictEqual(running.size, 0, 'the lock is released');
    }

    // ---- endSessionOp: End session and Restart session's first step (FR-022, FR-023 "Remote control turns off") ----
    {
      const ad = new FakeAdapter();
      const sid = await ad.start({ workspace: ws, quiet: true });
      const order: string[] = [];
      const realStop = ad.stop.bind(ad);
      ad.stop = async (id) => { order.push(`stop ${id}`); return realStop(id); };
      await endSessionOp({ release: async (id) => { order.push(`release ${id}`); }, router: routerOf(ad) }, sid);
      assert.deepStrictEqual(order, [`release ${sid}`, `stop ${sid}`], 'remote control off first, then the session ends');
      assert.ok(!ad.isLive(sid), 'the session ended');
      order.length = 0;
      await endSessionOp({ release: async () => { order.push('release'); }, router: routerOf(undefined) }, 'gone');
      assert.deepStrictEqual(order, ['release'], 'no adapter: remote control still released, nothing else');
    }

    // ---- Copilot adapter on the fake SDK (FR-012, SC-003) ----
    {
      const client = new FakeClient();
      const ad = new FakeCopilot(client);
      assert.deepStrictEqual([ad.capabilities.mcpRestart, ad.capabilities.mcpStart, ad.capabilities.mcpToggleApplies], [true, 'session', 'live']);
      const sid = await ad.start({ workspace: ws, quiet: true });
      const s = client.last;
      const mcpCalls = () => s.calls.filter((c) => c.name.startsWith('mcp.')).map((c) => [c.name, ...c.args]);
      await ad.restartMcpServer(sid, 'notes');
      assert.deepStrictEqual(mcpCalls(), [['mcp.restartServer', { serverName: 'notes' }]], 'one restartServer for that name only, no config (it keeps its own)');
      // an older runtime: SDK 1.0.22 always has the generated method, the runtime answers JSON-RPC MethodNotFound; then that one
      // server off, then on (Q3)
      const mcpRpc = s.rpc.mcp as Record<string, unknown>;
      const realRestart = mcpRpc.restartServer;
      const rejectWith = (e: Error) => { mcpRpc.restartServer = async (x: unknown) => { s.calls.push({ name: 'mcp.restartServer', args: [x] }); throw e; }; };
      rejectWith(Object.assign(new Error('Unhandled method session.mcp.restartServer'), { code: -32601 }));
      s.calls.length = 0;
      await ad.restartMcpServer(sid, 'notes');
      assert.deepStrictEqual(mcpCalls(), [['mcp.restartServer', { serverName: 'notes' }], ['mcp.disable', { serverName: 'notes' }], ['mcp.enable', { serverName: 'notes' }]], 'MethodNotFound: disable then enable, that server only');
      rejectWith(new Error('Unhandled method session.mcp.restartServer')); // the text alone, as the SDK's own connect check reads it
      s.calls.length = 0;
      await ad.restartMcpServer(sid, 'notes');
      assert.deepStrictEqual(mcpCalls().map((c) => c[0]), ['mcp.restartServer', 'mcp.disable', 'mcp.enable'], '"Unhandled method" text: fallback');
      // any other failure is the restart's own: it is reported, the server is not switched off and on behind the user's back
      rejectWith(new Error('MCP server notes failed to start: spawn ENOENT'));
      s.calls.length = 0;
      await assert.rejects(ad.restartMcpServer(sid, 'notes'), /spawn ENOENT/);
      assert.deepStrictEqual(mcpCalls().map((c) => c[0]), ['mcp.restartServer'], 'another error: no fallback');
      assert.ok(!isMethodNotFound(new Error('timeout')) && !isMethodNotFound(undefined) && isMethodNotFound({ code: -32601 }));
      // a runtime object without the method at all (an SDK older than 1.0.22's generated client)
      delete mcpRpc.restartServer;
      s.calls.length = 0;
      await ad.restartMcpServer(sid, 'notes');
      assert.deepStrictEqual(mcpCalls(), [['mcp.disable', { serverName: 'notes' }], ['mcp.enable', { serverName: 'notes' }]], 'no method: disable then enable, that server only');
      mcpRpc.restartServer = realRestart;
      assert.ok(!s.calls.some((c) => c.name === 'mcp.stopServer' || c.name === 'mcp.reload'), 'never stopServer (Q2) or reload (all servers)');
      await assert.rejects(ad.restartMcpServer('no-such-session', 'notes'), /not running/, 'not live: rejects, nothing started');
      assert.strictEqual(client.created.length, 1, 'no session was started by a restart');
      await ad.stop(sid);
    }
    done = true;
    console.log('[058] mcp session: PASS');
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

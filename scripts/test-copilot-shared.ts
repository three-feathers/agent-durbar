/**
 * Spec 058 FR-161 (issue #623): ONE Copilot runtime per app run, shared by every session, check and one-shot. On a Mac each runtime
 * process reads Copilot's keychain items again, so a runtime per session would ask again per session. Fake SDK only (`createClient()`
 * returns a new `FakeClient` per runtime start): no runtime process, no account, no credits.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RestartingFakeCopilot } from './fakes/copilot-sdk';
import type { AgentEvent } from '../src/adapters/types';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
type Decide = (r: unknown) => Promise<{ kind: string }>;

/** A Copilot adapter whose first `failFirst` runtime starts fail (the runtime could not start), then start normally. */
class FlakyStartCopilot extends RestartingFakeCopilot {
  attempts = 0;
  constructor(private failFirst: number) { super(); }
  protected async createClient(): Promise<never> {
    this.attempts++;
    if (this.attempts <= this.failFirst) throw new Error('runtime did not start');
    return super.createClient();
  }
}

/** A Copilot adapter whose runtime start waits until the test opens the gate (a quit during the first start). */
class GatedStartCopilot extends RestartingFakeCopilot {
  open!: () => void;
  private gate = new Promise<void>((r) => (this.open = r));
  protected async createClient(): Promise<never> {
    await this.gate;
    return super.createClient();
  }
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-shared-'));
  const dirs = ['a', 'b', 'c', 'd'].map((n) => { const d = path.join(root, n); fs.mkdirSync(d); return d; });
  try {
    // ---- N sessions, one runtime: four sessions in four folders with three permission modes, plus a sign-in check
    {
      const ad = new RestartingFakeCopilot();
      const events: AgentEvent[] = [];
      ad.onEvent((e) => events.push(e));
      const modes = ['read-only', 'ask', 'allow', 'read-only'] as const;
      const ids: string[] = [];
      for (let i = 0; i < dirs.length; i++) ids.push(await ad.start({ workspace: dirs[i], permissionMode: modes[i], quiet: true }));
      await ad.authStatus();
      assert.strictEqual(ad.clients.length, 1, 'one runtime start for 4 sessions and a sign-in check');
      const c = ad.clients[0];
      assert.strictEqual(c.created.length, 4, 'every session is created on the shared runtime');
      assert.deepStrictEqual(new Set(ids).size, 4, 'four separate sessions');

      // per session: its own folder, and the same keychain storage choice (FR-070) for each
      assert.deepStrictEqual(c.created.map((cfg) => cfg.workingDirectory), dirs, 'each session keeps its own folder');
      for (const cfg of c.created) assert.strictEqual(cfg.mcpOAuthTokenStorage, 'persistent', 'FR-070 unchanged');

      // per session: its own permission mode (a write in each folder is decided by that session's broker)
      const decide = (i: number): Promise<{ kind: string }> =>
        (c.sessions.get(ids[i])!.config.onPermissionRequest as Decide)({ kind: 'write', fileName: path.join(dirs[i], 'x.ts'), toolCallId: `w${i}` });
      assert.strictEqual((await decide(0)).kind, 'reject', 'read-only session refuses');
      assert.strictEqual((await decide(2)).kind, 'approve-once', 'allow-all session approves');
      const pendingAsk = decide(1);
      await sleep(10);
      const pending = events.some((e) => e.sessionId === ids[1] && e.type === 'status' && e.status === 'needs-permission');
      assert.ok(pending, 'ask-first session waits for the user');
      assert.ok(!events.some((e) => e.sessionId !== ids[1] && e.type === 'status' && e.status === 'needs-permission' && /Waiting/.test(e.intent ?? '')), 'only the ask session waits');

      // switching one session's mode leaves the others alone
      await ad.setPermMode(ids[3], 'allow');
      assert.strictEqual((await decide(3)).kind, 'approve-once', 'mode switched in session d');
      assert.strictEqual((await decide(0)).kind, 'reject', 'session a still read-only');

      // ---- a session end does not stop the runtime or another session
      await ad.stop(ids[1]); // also denies its pending request
      assert.strictEqual((await pendingAsk).kind, 'reject', 'the stopped session denied what was pending');
      assert.strictEqual(c.stopped, 0, 'the shared runtime is not stopped by a session end');
      assert.ok(!ad.isLive(ids[1]));
      for (const i of [0, 2, 3]) assert.ok(ad.isLive(ids[i]), `session ${i} stays live`);
      await ad.send(ids[0], { text: 'still here' });
      assert.ok(c.sessions.get(ids[0])!.calls.some((x) => x.name === 'send'), 'another session still sends on the same runtime');
      // a new session after an end reuses the same runtime
      await ad.start({ workspace: dirs[1], permissionMode: 'ask', quiet: true });
      assert.strictEqual(ad.clients.length, 1, 'no new runtime for a new session');
      // ending every session keeps the runtime for the rest of the run (the next session needs no new start)
      for (const id of [...ids, c.last.sessionId]) await ad.stop(id);
      assert.strictEqual(c.stopped, 0, 'no stop after the last session ends');
      await ad.start({ workspace: dirs[0], quiet: true });
      assert.strictEqual(ad.clients.length, 1, 'still one runtime start');
      // only app exit stops it
      await ad.dispose();
      assert.strictEqual(c.stopped, 1, 'dispose stops the shared runtime once');
    }

    // ---- concurrent first use: sessions started at the same moment share one runtime start
    {
      const ad = new RestartingFakeCopilot();
      await Promise.all(dirs.map((d) => ad.start({ workspace: d, quiet: true })));
      assert.strictEqual(ad.clients.length, 1, 'parallel starts share one runtime start');
    }

    // ---- a failed runtime start is not kept for the whole run: the next use starts again, then everything shares it
    {
      const ad = new FlakyStartCopilot(1);
      await assert.rejects(() => ad.start({ workspace: dirs[0], quiet: true }), /runtime did not start/);
      assert.strictEqual(ad.attempts, 1);
      const a = await ad.start({ workspace: dirs[0], quiet: true });
      const b = await ad.start({ workspace: dirs[1], quiet: true });
      assert.strictEqual(ad.attempts, 2, 'one retry after the failure, then shared');
      assert.strictEqual(ad.clients.length, 1);
      assert.ok(ad.isLive(a) && ad.isLive(b));
      // two callers waiting on the same failed start both see the failure; the one after them starts again
      const twice = new FlakyStartCopilot(1);
      const r = await Promise.allSettled([twice.start({ workspace: dirs[0], quiet: true }), twice.start({ workspace: dirs[1], quiet: true })]);
      assert.deepStrictEqual(r.map((x) => x.status), ['rejected', 'rejected'], 'one failed start, two callers');
      assert.strictEqual(twice.attempts, 1, 'the failing start was shared, not repeated per caller');
      await twice.start({ workspace: dirs[2], quiet: true });
      assert.strictEqual(twice.attempts, 2);
    }

    // ---- a sign-in change (spec 012 FR-158) is the one planned second start in a run
    {
      const ad = new RestartingFakeCopilot();
      const a = await ad.start({ workspace: dirs[0], quiet: true });
      await ad.refreshAuth();
      assert.strictEqual(ad.clients.length, 2, 'refreshAuth starts exactly one new runtime');
      await ad.start({ workspace: dirs[1], quiet: true });
      assert.strictEqual(ad.clients.length, 2, 'later sessions share the new runtime');
      assert.ok(ad.isLive(a));
    }

    // ---- review on #625: dispose during an in-flight first start stops the runtime that start brings up, and keeps nothing
    {
      const ad = new GatedStartCopilot();
      const first = ad.start({ workspace: dirs[0], quiet: true }).catch((e: unknown) => e);
      await sleep(5);
      const disposing = ad.dispose();
      await sleep(5);
      ad.open();
      await disposing;
      assert.strictEqual(ad.clients.length, 1, 'the start went through');
      assert.strictEqual(ad.clients[0].stopped, 1, 'dispose stopped the runtime that was still starting');
      await first;
      // a later use after dispose starts a new runtime instead of reusing the stopped one
      await ad.start({ workspace: dirs[1], quiet: true });
      assert.strictEqual(ad.clients.length, 2, 'the stopped client is not kept');
      // dispose with nothing started: nothing to stop
      await new GatedStartCopilot().dispose();
    }

    // ---- review on #625: a re-read or an `unknown` source never turns a built-in or stdio server into a remote one
    {
      const ad = new RestartingFakeCopilot();
      const seen: Array<Array<{ name: string; source?: string; transport?: string; status: string }>> = [];
      ad.onEvent((e) => { if (e.type === 'mcp') seen.push(e.servers as never); });
      const sid = await ad.start({ workspace: dirs[0], quiet: true });
      const s = ad.clients[0].sessions.get(sid)!;
      s.handler!({ type: 'session.mcp_servers_loaded', data: { servers: [{ name: 'gh', status: 'connected', source: 'builtin', transport: 'http' }, { name: 'loc', status: 'connected', source: 'user', transport: 'stdio' }, { name: 'web', status: 'connected', source: 'user', transport: 'http' }] } });
      const last = (n: string) => seen[seen.length - 1].find((x) => x.name === n)!;
      s.handler!({ type: 'session.mcp_server_status_changed', data: { serverName: 'gh', status: 'connected', configSource: 'unknown' } });
      assert.strictEqual(last('gh').source, 'builtin', 'an `unknown` source keeps the one the runtime named');
      // the poll's re-read: `rpc.mcp.list` items without transport or source
      s.running = true;
      s.listAnswer = [{ name: 'gh', status: 'connected' }, { name: 'loc', status: 'connected' }, { name: 'web', status: 'connected', source: 'workspace' }];
      await ad.refreshMcpStatus(sid, 'web');
      assert.deepStrictEqual([last('gh').source, last('gh').transport], ['builtin', 'http'], 'a re-read keeps source and transport');
      assert.deepStrictEqual([last('loc').source, last('loc').transport], ['user', 'stdio'], 'a stdio server stays stdio after a re-read');
      assert.strictEqual(last('web').source, 'workspace', 'a source the re-read names wins');
    }

    // ---- spec 100 T012: the owner's case. Copilot's own attribution; `null`, a failure or a missing method say "not reported", never an estimate
    {
      const ad = new RestartingFakeCopilot();
      const sid = await ad.start({ workspace: dirs[0], quiet: true });
      const s = ad.clients[0].sessions.get(sid)!;
      const meta = s.rpc.metadata as { getContextAttribution?: () => Promise<unknown> };
      assert.deepStrictEqual(await ad.mcpContext(sid), { servers: [] }, 'an older runtime without the method: no figures');
      let answer: unknown = { contextAttribution: null };
      let listed = 0;
      meta.getContextAttribution = async () => { listed++; if (answer instanceof Error) throw answer; return answer; };
      const tools = (): number => s.calls.filter((c) => c.name === 'mcp.listTools').length;
      assert.deepStrictEqual(await ad.mcpContext(sid), { servers: [] }, 'null until the session has initialised: no figures');
      answer = new Error('method not enabled on this plan');
      assert.deepStrictEqual(await ad.mcpContext(sid), { servers: [] }, 'a failure: no figures, and its text goes nowhere');
      answer = { contextAttribution: { limit: 200_000, categories: { mcpTools: 62_000 }, entries: [
        { kind: 'mcpServer', id: 'mcpServer:github', label: 'GitHub (shown)', tokens: 41_000 },
        { kind: 'mcpServer', id: 'mcpServer:jira', label: 'jira', tokens: 21_000 },
        { kind: 'skill', id: 'skill:tmux', label: 'tmux', tokens: 900 },
        { kind: 'brand-new-kind', id: 'x:y', label: 'y', tokens: 9 },
      ] } };
      assert.deepStrictEqual(await ad.mcpContext(sid), { servers: [{ name: 'github', tokens: 41_000, source: 'reported' }, { name: 'jira', tokens: 21_000, source: 'reported' }], window: 200_000, total: 62_000 });
      assert.strictEqual(tools(), 0, 'never a listTools-based estimate (decided Q4)');
      assert.strictEqual(listed, 3);
      assert.deepStrictEqual(await ad.mcpContext('no-such'), { servers: [] }, 'no session: no figures');
      assert.strictEqual(ad.capabilities.mcpContext, 'reported');
    }

    // ---- FR-163: nothing Durbar does asks the runtime to connect a server that is not connected (each attempt can read the keychain)
    {
      const ad = new RestartingFakeCopilot();
      const sid = await ad.start({ workspace: dirs[0], quiet: true });
      const s = ad.clients[0].sessions.get(sid)!;
      const connects = (): number => s.calls.filter((c) => ['mcp.listTools', 'mcp.list', 'mcp.restartServer', 'mcp.enable', 'mcp.disable'].includes(c.name)).length;
      s.handler!({ type: 'session.mcp_servers_loaded', data: { servers: [{ name: 'ok', status: 'connected' }, { name: 'broken', status: 'failed', error: 'HTTP 500' }, { name: 'later', status: 'needs-auth' }, { name: 'slow', status: 'pending' }] } });
      // tools of a connected server: one live list
      assert.ok((await ad.listMcpTools(sid, 'ok')).length > 0);
      assert.strictEqual(connects(), 1);
      // failed, needs-sign-in and pending servers: refused in Durbar, nothing reaches the runtime, however often the row is opened
      for (let i = 0; i < 5; i++) for (const n of ['broken', 'later']) await assert.rejects(ad.listMcpTools(sid, n), /not connected/);
      for (let i = 0; i < 5; i++) await assert.rejects(ad.listMcpTools(sid, 'slow'), /still starting/, 'a pending server has its own wording (review on #625)');
      assert.strictEqual(connects(), 1, 'no tools/list for a server that is not connected (0 runtime calls for 15 opens)');
      // the poll while a sign-in page is open: one cheap check that starts nothing, no list, for a server without a client
      s.running = false;
      s.calls.length = 0;
      for (let i = 0; i < 3; i++) await ad.refreshMcpStatus(sid, 'later');
      assert.deepStrictEqual(s.calls.map((c) => c.name), ['mcp.isServerRunning', 'mcp.isServerRunning', 'mcp.isServerRunning'], 'refresh on a failed server: no list, no connect');
      // spec 058 FR-190 (review on #800): the dialog's open-time read (`startNothing`) reads the whole list only when every server of the last
      // report that is not off is running; the button (no opts) always reads. No report yet: nothing is read.
      {
        s.listAnswer = [{ name: 'ok', status: 'connected' }];
        const listed = (): number => s.calls.filter((c) => c.name === 'mcp.list').length;
        s.running = false;
        s.calls.length = 0;
        await ad.refreshMcpStatus(sid, undefined, { startNothing: true });
        assert.strictEqual(listed(), 0, 'open-time read, a server not running: no list (it could start it)');
        assert.strictEqual(s.calls.filter((c) => c.name === 'mcp.isServerRunning').length, 1, 'one cheap check, then it stops');
        s.running = true;
        s.calls.length = 0;
        await ad.refreshMcpStatus(sid, undefined, { startNothing: true });
        assert.strictEqual(listed(), 1, 'open-time read, every server running: one list');
        assert.ok(s.calls.filter((c) => c.name === 'mcp.isServerRunning').length >= 2, 'each server of the report was checked');
        s.running = false;
        s.calls.length = 0;
        await ad.refreshMcpStatus(sid);
        assert.strictEqual(listed(), 1, 'Refresh (no opts) reads whatever is running');
        const fresh = await ad.start({ workspace: dirs[0], quiet: true });
        const s2 = ad.clients[0].sessions.get(fresh)!;
        s2.calls.length = 0;
        await ad.refreshMcpStatus(fresh, undefined, { startNothing: true });
        assert.strictEqual(s2.calls.length, 0, 'no report yet: the open-time read asks nothing');
        s.running = false;
      }
      // tool failures that mark a "connected" server needs-auth also stop the tools list
      s.handler!({ type: 'tool.execution_start', data: { toolCallId: 't1', toolName: 'ok-x', mcpServerName: 'ok', mcpToolName: 'x', arguments: {} } });
      s.handler!({ type: 'tool.execution_complete', data: { toolCallId: 't1', success: false, error: { message: 'MCP tool catalog changed before tool "x" could be invoked: Failed to verify cached MCP tools: MCP OAuth challenge required (HTTP 401)' } } });
      s.calls.length = 0;
      await assert.rejects(ad.listMcpTools(sid, 'ok'), /not connected/);
      assert.strictEqual(connects(), 0);
      // the user's Restart is still passed on (once per press), and after the runtime says connected the list works again
      await ad.restartMcpServer(sid, 'broken');
      assert.strictEqual(connects(), 1, 'one restart per press, nothing added by Durbar');
      s.handler!({ type: 'session.mcp_server_status_changed', data: { serverName: 'broken', status: 'connected' } });
      await ad.listMcpTools(sid, 'broken');
      assert.strictEqual(connects(), 2);
      // a server the runtime has not reported yet: asked as before (the runtime's own answer decides)
      await ad.listMcpTools(sid, 'unknown-yet');
      assert.strictEqual(connects(), 3);
      // FR-164: Sign in uses the runtime's login as before; Sign in again adds forceReauth and nothing else
      s.loginAnswer = { authorizationUrl: 'https://auth.example.com/a' };
      s.calls.length = 0;
      await ad.startMcpSignIn(sid, 'later');
      await ad.startMcpSignIn(sid, 'ok', { again: true });
      const logins = s.calls.filter((c) => c.name === 'mcp.oauth.login').map((c) => c.args[0] as Record<string, unknown>);
      assert.strictEqual(logins.length, 2);
      assert.strictEqual('forceReauth' in logins[0], false, 'a first sign-in never forces');
      assert.strictEqual(logins[1].forceReauth, true, 'Sign in again forces a new authorization in the runtime');
      assert.deepStrictEqual(Object.keys(logins[1]).sort(), ['callbackSuccessMessage', 'clientName', 'forceReauth', 'serverName']);
      assert.ok(!s.calls.some((c) => /oauth\.(handlePendingRequest|complete|prepareLogin|cancelLogin)/.test(c.name)), 'no other OAuth call');
      assert.strictEqual(ad.capabilities.mcpSignInAgain, true);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('copilot shared runtime (spec 058 FR-161): all checks passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Spec 059 FR-007: `renameSession` of the three real adapters against FAKES only (fake Copilot client and session, fake `codex
 * app-server`, fake `claude` child). No runtime, no account, no credits. `npm run test:renameadapters`. What a real agent app does is NOT tested.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { COPILOT_CAPABILITIES, copilotNameError, renameResumeConfig } from '../src/adapters/copilot';
import { CODEX_CAPABILITIES, CodexAdapter } from '../src/adapters/codex';
import { CLAUDE_CAPABILITIES, ClaudeAdapter, claudeArgs, claudeNameOk } from '../src/adapters/claude';
import { createCliTransport } from '../src/adapters/claudeTransport';
import type { AgentEvent } from '../src/adapters/types';
import { offeredDescriptors } from '../src/adapters/experimental';
import { FakeClient, TestAdapter } from './fakes/copilot-sdk';
import { FakeCodexServer } from './fakes/codex-app-server';
import { FakeClaudeChild, fakeSpawn } from './fakes/claude-cli';

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-rename-'));
const names = (calls: Array<{ name: string }>): string[] => calls.map((c) => c.name);
const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until<T>(what: string, f: () => T | undefined, ms = 1500): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v !== undefined && v !== false) return v;
    if (Date.now() > end) throw new assert.AssertionError({ message: `timed out waiting for ${what}` });
    await tick(2);
  }
}

async function copilot(): Promise<void> {
  assert.strictEqual(COPILOT_CAPABILITIES.renameSession, 'any');
  // Copilot's own rule
  assert.strictEqual(copilotNameError('Billing'), undefined);
  assert.ok(copilotNameError('say "hi"'));
  assert.ok(copilotNameError('x'.repeat(101)));
  assert.strictEqual(copilotNameError('x'.repeat(100)), undefined);
  assert.ok(copilotNameError(' padded'));
  assert.ok(copilotNameError('a\u0007b'));
  assert.ok(copilotNameError(''));
  // the prompt-free resume config: nothing can run, remote stays off
  const cfg = renameResumeConfig('/work/proj');
  assert.strictEqual(cfg.workingDirectory, '/work/proj', 'the session\'s own folder');
  assert.strictEqual(cfg.suppressResumeEvent, true);
  assert.strictEqual(cfg.allowTranscriptRecovery, false);
  assert.deepStrictEqual([cfg.availableTools, cfg.mcpServers, cfg.enableSkills, cfg.enableFileHooks, cfg.remoteSession], [[], {}, false, false, 'off']);
  assert.strictEqual(((await (cfg.onPermissionRequest as () => Promise<{ kind: string }>)()).kind), 'reject');

  // a live session: one name.set on it, no resume, not disconnected
  {
    const fake = new FakeClient();
    const ad = new TestAdapter(fake);
    const sid = await ad.start({ workspace: ws, quiet: true });
    await ad.renameSession(sid, 'Billing refactor');
    assert.deepStrictEqual(fake.last.calls.filter((c) => c.name === 'name.set').map((c) => c.args), [[{ name: 'Billing refactor' }]]);
    assert.strictEqual(fake.resumed.length, 0, 'a live session is not resumed');
    assert.ok(!names(fake.last.calls).includes('disconnect'));
  }
  // a stored session: resumed without a prompt, renamed, released
  {
    const fake = new FakeClient();
    fake.storedDirs.set('stored-1', '/work/older');
    const ad = new TestAdapter(fake);
    await ad.renameSession('stored-1', 'Older work');
    assert.strictEqual(fake.resumed[0].config.workingDirectory, '/work/older', 'resumed in the folder Copilot stored for it');
    assert.strictEqual(fake.resumed[0].config.suppressResumeEvent, true);
    assert.strictEqual(fake.resumed[0].config.allowTranscriptRecovery, false);
    assert.deepStrictEqual(fake.resumed.map((r) => r.id), ['stored-1']);
    const calls = fake.last.calls;
    assert.deepStrictEqual(names(calls).filter((n) => n !== 'registerInterest'), ['name.set', 'disconnect'], 'rename then release');
    assert.ok(!names(calls).includes('send'), 'no prompt was sent');
    assert.deepStrictEqual(calls[0].args, [{ name: 'Older work' }]);
    assert.strictEqual(fake.resumed[0].config.remoteSession, 'off');
    assert.strictEqual(ad.isLive('stored-1'), false, 'not left open');
    assert.strictEqual(fake.created.length, 0);
  }
  // failures: the name.set error and an unknown session are thrown, and the session is still released
  {
    const fake = new FakeClient();
    fake.storedDirs.set('stored-2', '/w');
    fake.nameSetFail = 'not allowed';
    const ad = new TestAdapter(fake);
    await assert.rejects(() => ad.renameSession('stored-2', 'Name'), /not allowed/);
    assert.ok(names(fake.last.calls).includes('disconnect'), 'released after an error');
    const fake2 = new FakeClient();
    fake2.storedDirs.set('gone', '/w');
    fake2.resumeFail.add('gone');
    await assert.rejects(() => new TestAdapter(fake2).renameSession('gone', 'Name'), /cannot resume/);
    // a name Copilot refuses never reaches it
    const fake3 = new FakeClient();
    const ad3 = new TestAdapter(fake3);
    fake3.storedDirs.set('stored-3', '/w');
    await assert.rejects(() => ad3.renameSession('stored-3', 'say "hi"'), /double quotes/);
    assert.strictEqual(fake3.resumed.length, 0);
    // a session Copilot has no folder for is not resumed at all
    await assert.rejects(() => ad3.renameSession('unknown-1', 'Name'), /no folder stored/);
    assert.strictEqual(fake3.resumed.length, 0);
    // the strict id rule (spec 006 FR-026) before anything reaches the runtime
    for (const bad of ['../x', '..\\x', 'C:\\x', '/abs', '', 'a.b', 'a'.repeat(101), 'a\u0000b']) await assert.rejects(() => ad3.renameSession(bad, 'Name'), /not a session id/, JSON.stringify(bad));
    assert.strictEqual(fake3.resumed.length, 0);
  }
}

async function copilotRaces(): Promise<void> {
  // a start of the same session while its rename-resume is running waits, and is not disconnected by the rename's release
  {
    const fake = new FakeClient();
    fake.storedDirs.set('race-1', ws);
    let open: () => void = () => undefined;
    fake.resumeGate = new Promise<void>((r) => (open = r));
    const ad = new TestAdapter(fake);
    const renaming = ad.renameSession('race-1', 'Name');
    await tick(10);
    const starting = ad.start({ workspace: ws, resumeSessionId: 'race-1', quiet: true });
    await tick(20);
    assert.strictEqual(fake.resumed.length, 0, 'neither resumed yet: the first is held, the start waits');
    open();
    await renaming;
    await starting;
    assert.deepStrictEqual(fake.resumed.map((r) => r.id), ['race-1', 'race-1'], 'the start resumes after the rename');
    assert.ok(ad.isLive('race-1'), 'the started session is live');
    assert.ok(!names(fake.last.calls).includes('disconnect'), 'and was not disconnected by the rename');
  }
  // an auto title right after a rename does not reach Durbar; the next one after an idle does
  {
    const fake = new FakeClient();
    const ad = new TestAdapter(fake);
    const events: AgentEvent[] = [];
    ad.onEvent((e) => events.push(e));
    const sid = await ad.start({ workspace: ws, quiet: true });
    await ad.renameSession(sid, 'Mine');
    fake.last.fire('session.title_changed', { title: 'Auto made title' });
    assert.strictEqual(events.filter((e) => e.type === 'title').length, 0, 'ignored right after a rename');
    fake.last.fire('session.idle', {});
    fake.last.fire('session.title_changed', { title: 'Renamed in the CLI' });
    assert.deepStrictEqual(events.filter((e) => e.type === 'title').map((e) => (e as { title: string }).title), ['Renamed in the CLI'], 'later titles pass again');
  }
}

async function codex(): Promise<void> {
  assert.strictEqual(CODEX_CAPABILITIES.renameSession, 'any');
  const make = (server: FakeCodexServer) => {
    const ad = new CodexAdapter({ spawn: server.spawn, locate: async () => ({ path: '/usr/local/bin/codex', version: '0.163.0' }), platform: 'linux', env: {}, appVersion: '9.9.9', closeGraceMs: 20, killGraceMs: 20 });
    const events: AgentEvent[] = [];
    ad.onEvent((e) => events.push(e));
    return { ad, events };
  };
  // a stored thread (not open): thread/name/set on a short-lived app-server, no thread started, no turn
  {
    const server = new FakeCodexServer();
    const { ad } = make(server);
    server.threads.set('thr_old', ws);
    await ad.renameSession('thr_old', '  Older thread ');
    assert.deepStrictEqual(server.requests('thread/name/set').map((r) => r.params), [{ threadId: 'thr_old', name: 'Older thread' }]);
    assert.strictEqual(server.requests('turn/start').length, 0);
    assert.strictEqual(server.requests('thread/start').length, 0);
    assert.strictEqual(server.names.get('thr_old'), 'Older thread');
    assert.deepStrictEqual(server.live, [], 'the helper app-server is closed');
    // Codex refuses an unknown thread and an empty name: thrown
    await assert.rejects(() => ad.renameSession('nope', 'x'), /no rollout/);
    await assert.rejects(() => ad.renameSession('thr_old', '   '), /needs a name/);
    const sent = server.requests('thread/name/set').length;
    for (const bad of ['../x', 'C:\\x', '/abs', '', 'a.b', 'a'.repeat(101)]) await assert.rejects(() => ad.renameSession(bad, 'x'), /not a session id/, JSON.stringify(bad));
    assert.strictEqual(server.requests('thread/name/set').length, sent, 'a bad id never reaches the app-server');
    await ad.dispose();
  }
  // an open thread: on its own child, and thread/name/updated becomes the title event
  {
    const server = new FakeCodexServer();
    const { ad, events } = make(server);
    const sid = await ad.start({ workspace: ws, permissionMode: 'read-only', quiet: true });
    const thread = ad.resumeIdOf(sid) as string;
    const before = server.spawns.length;
    await ad.renameSession(thread, 'Billing');
    assert.strictEqual(server.spawns.length, before, 'no extra app-server for an open thread');
    assert.strictEqual(server.requests('thread/name/set')[0].childIndex, 0, 'on the live child');
    await until('title', () => events.find((e) => e.type === 'title' && e.sessionId === sid));
    assert.strictEqual((events.find((e) => e.type === 'title') as { title: string }).title, 'Billing');
    await ad.dispose();
  }
  // an app-server error is thrown
  {
    const server = new FakeCodexServer({ refuseRename: 'thread is archived' });
    const { ad } = make(server);
    server.threads.set('thr_a', ws);
    await assert.rejects(() => ad.renameSession('thr_a', 'x'), /archived/);
    await ad.dispose();
  }
}

async function claude(): Promise<void> {
  assert.strictEqual(CLAUDE_CAPABILITIES.renameSession, 'next-turn');
  // argv: --name is one item, before --resume / --session-id; absent or unsafe names add nothing
  const base = { mode: 'read-only' as const, sessionId: 'abc-123', resume: true };
  const a = claudeArgs({ ...base, name: 'Billing refactor' });
  assert.deepStrictEqual(a.slice(-4), ['--name', 'Billing refactor', '--resume', 'abc-123']);
  assert.ok(!claudeArgs(base).includes('--name'));
  for (const bad of ['', '-n evil', ' x', 'x\n', 'x'.repeat(201), 5 as unknown as string]) {
    assert.ok(!claudeNameOk(bad), JSON.stringify(bad));
    assert.ok(!claudeArgs({ ...base, name: bad }).includes('--name'));
  }
  assert.ok(claudeNameOk('<img src=x onerror=1>'), 'markup is just text for argv');

  const okTurn = (c: FakeClaudeChild): void => {
    c.send({ type: 'system', subtype: 'init', session_id: 'x', cwd: ws, model: 'm', permissionMode: 'default', tools: [], mcp_servers: [] });
    c.send({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0, usage: { input_tokens: 1, output_tokens: 1 } });
  };
  const make = () => {
    const sp = fakeSpawn();
    sp.next = (c) => {
      c.onWrite = (o) => {
        if (o.type === 'control_request') setTimeout(() => c.send({ type: 'control_response', response: { subtype: 'success', request_id: o.request_id, response: {} } }), 0);
        else if (o.type === 'user') setTimeout(() => okTurn(c), 0);
      };
    };
    const ad = new ClaudeAdapter({
      claudePath: async () => '/usr/local/bin/claude',
      makeTransport: (x) => createCliTransport({ file: x.file, args: claudeArgs(x.launch), cwd: x.cwd, env: x.env, handlers: x.handlers, spawn: sp.spawn, closeGraceMs: 10, killGraceMs: 10 }),
      sessionExists: () => true,
      claudeMd: () => undefined,
      env: () => ({ PATH: '/usr/bin' }),
    });
    const events: AgentEvent[] = [];
    ad.onEvent((e) => events.push(e));
    return { ad, sp, events };
  };
  const SID = '11111111-2222-3333-4444-555555555555';
  // a session that is not open: the name waits for its first start, then --name rides on --resume, and the title is reported after the first turn
  {
    const { ad, sp, events } = make();
    await ad.renameSession(SID, 'Billing');
    assert.strictEqual(sp.calls.length, 0, 'renaming starts no process and sends no prompt');
    await ad.start({ workspace: ws, permissionMode: 'read-only', resumeSessionId: SID, quiet: true });
    assert.strictEqual(sp.calls.length, 0, 'start alone does not launch the CLI either');
    await ad.send(SID, { text: 'hello' });
    await until('launch', () => (sp.calls.length === 1 ? true : undefined));
    const args = sp.calls[0].args;
    assert.deepStrictEqual(args.slice(-4), ['--name', 'Billing', '--resume', SID]);
    assert.strictEqual(sp.calls[0].shell, false, 'no shell');
    const title = await until('title', () => events.find((e) => e.type === 'title'));
    assert.strictEqual((title as { title: string }).title, 'Billing');
    // applied once: the next turn adds no second title and a relaunch no longer carries the name
    await ad.send(SID, { text: 'again' });
    await tick(30);
    assert.strictEqual(events.filter((e) => e.type === 'title').length, 1);
    await ad.stop(SID);
  }
  // an open session: relaunched before its next message (a resume), with the new name; a second rename wins
  {
    const { ad, sp, events } = make();
    await ad.start({ workspace: ws, permissionMode: 'read-only', resumeSessionId: SID, quiet: true });
    await ad.send(SID, { text: 'one' });
    await until('first launch', () => (sp.calls.length === 1 ? true : undefined));
    assert.ok(!sp.calls[0].args.includes('--name'));
    await until('turn done', () => events.find((e) => e.type === 'usage' || (e.type === 'status' && e.status === 'idle')));
    await tick(30);
    await ad.renameSession(SID, 'First');
    await ad.renameSession(SID, 'Second');
    assert.strictEqual(sp.calls.length, 1, 'nothing happens until the next message');
    await ad.send(SID, { text: 'two' });
    await until('relaunch', () => (sp.calls.length === 2 ? true : undefined));
    assert.deepStrictEqual(sp.calls[1].args.slice(-4), ['--name', 'Second', '--resume', SID]);
    await until('title', () => events.find((e) => e.type === 'title'));
    assert.strictEqual((events.filter((e) => e.type === 'title').pop() as { title: string }).title, 'Second');
    await ad.stop(SID);
  }
  // the SDK transport (dev opt-in) does not apply --name: no capability, no member, and the descriptor says the same
  {
    const sdk = new ClaudeAdapter({ claudePath: async () => '/c', sdkTransport: true });
    assert.strictEqual(sdk.capabilities.renameSession, undefined);
    assert.ok(typeof sdk.renameSession !== 'function', 'no member on the SDK transport');
    const sdkDesc = offeredDescriptors({ DURBAR_CLAUDE_TRANSPORT: 'sdk' }).find((d) => d.id === 'claude')!;
    const cliDesc = offeredDescriptors({}).find((d) => d.id === 'claude')!;
    assert.strictEqual(sdkDesc.capabilities.renameSession, undefined);
    assert.strictEqual(cliDesc.capabilities.renameSession, 'next-turn');
    assert.strictEqual(typeof (cliDesc.create() as ClaudeAdapter).renameSession, 'function');
    assert.ok(typeof (sdkDesc.create() as ClaudeAdapter).renameSession !== 'function');
  }
  // bad input
  {
    const { ad } = make();
    await assert.rejects(() => ad.renameSession(SID, '-x'), /cannot use that name/);
    await assert.rejects(() => ad.renameSession('not an id', 'ok'), /Unknown Claude session/);
  }
}

(async () => {
  await copilot();
  await copilotRaces();
  await codex();
  await claude();
  fs.rmSync(ws, { recursive: true, force: true });
  console.log('rename adapters: ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

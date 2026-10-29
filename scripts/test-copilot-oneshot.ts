/**
 * Spec 040 FR-015 / T026 (issue #301): Copilot `generateText` on a throw-away SDK session, against the FAKE client and session.
 * No runtime process, no Copilot account, no credits. Pins what the adapter SENDS (no tools, no MCP, nothing kept), that every
 * permission request is denied, how the reply and the AI credits are read from the events, and that the session is disconnected and
 * deleted and its temp folder removed on success, on an error and on a timeout. What a real runtime does is NOT tested here.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import { COPILOT_CAPABILITIES, ONE_SHOT_TIMEOUT_MS, oneShotConfig } from '../src/adapters/copilot';
import { FakeClient, FakeSession, TestAdapter } from './fakes/copilot-sdk';
import type { ScriptEvent } from './fakes/copilot-sdk';

const names = (s: FakeSession): string[] => s.calls.map((c) => c.name);
const reply = (content: string, extra: Partial<ScriptEvent> = {}): ScriptEvent => ({ type: 'assistant.message', data: { messageId: 'm', content }, ...extra });
const usage = (nano: number, agentId?: string): ScriptEvent => ({ type: 'assistant.usage', data: { model: 'gpt-x', inputTokens: 10, outputTokens: 20, copilotUsage: { totalNanoAiu: nano } }, ...(agentId ? { agentId } : {}) });
const idle: ScriptEvent = { type: 'session.idle', data: {} };

function cleanedUp(fake: FakeClient, s: FakeSession, label: string): void {
  assert.ok(names(s).includes('disconnect'), `${label}: disconnected`);
  assert.deepStrictEqual(fake.deleted, [s.sessionId], `${label}: deleted from disk`);
  assert.ok(!fake.onDisk.has(s.sessionId), `${label}: nothing kept`);
  assert.ok(!fs.existsSync(String(s.config.workingDirectory)), `${label}: temp folder removed`);
  assert.strictEqual(s.handler, undefined, `${label}: unsubscribed`);
}

async function main(): Promise<void> {
  // ---- the capability and the config
  assert.strictEqual(COPILOT_CAPABILITIES.oneShot, true, 'Copilot reports oneShot');
  assert.strictEqual(ONE_SHOT_TIMEOUT_MS, 180_000, 'the same 3 minutes as Claude and Codex');
  const c = oneShotConfig('/tmp/x', ['github-mcp-server', 'my-notes']);
  assert.deepStrictEqual(c.availableTools, [], 'no tool is available');
  assert.deepStrictEqual(c.excludedTools, ['builtin:*', 'mcp:*', 'custom:*'], 'and every tool source is excluded as well');
  assert.deepStrictEqual(c.mcpServers, {}, 'no MCP server of its own');
  assert.deepStrictEqual(c.disabledMcpServers, ['github-mcp-server', 'my-notes'], 'the runtime\'s own servers switched off by name');
  assert.strictEqual(c.enableConfigDiscovery, false);
  assert.strictEqual(c.enableSkills, false);
  assert.deepStrictEqual(c.customAgents, []);
  assert.strictEqual(c.skipCustomInstructions, true);
  assert.strictEqual(c.enableOnDemandInstructionDiscovery, false);
  assert.strictEqual(c.enableFileHooks, false);
  assert.ok(!('mcpOAuthTokenStorage' in c), 'spec 058 FR-070: the one-shot (no MCP) keeps the SDK default');
  assert.strictEqual(c.enableHostGitOperations, false);
  assert.strictEqual(c.enableSessionStore, false);
  assert.deepStrictEqual(c.memory, { enabled: false });
  assert.deepStrictEqual(c.infiniteSessions, { enabled: false }, 'no persistent workspace');
  assert.strictEqual(c.embeddingCacheStorage, 'in-memory');
  assert.strictEqual(c.remoteSession, 'off', 'kept for SDK 1.0.22; SDK 1.0.26 ignores it (not a control: test-remote pins remote.enable)');
  assert.strictEqual(c.model, 'auto');
  assert.deepStrictEqual(c.capi, { autoTier: 'efficiency' }, 'the cheapest auto routing, as a new auto session');
  assert.ok(!('name' in c) && !('sessionId' in c) && !('agentDirectories' in c) && !('skillDirectories' in c), 'no name (it would persist the session) and no agent or skill folders');
  assert.ok(!('disabledMcpServers' in oneShotConfig('/tmp/x')), 'no list when there is nothing to switch off');

  // ---- success: the reply, the credits, the session gone
  {
    const fake = new FakeClient();
    fake.turnScript = [
      reply('helper text', { agentId: 'sub-1' }),
      reply('inside a tool', {}),
      usage(3_000_000),
      usage(1_000_000, 'sub-1'),
      reply('{"name":"Bridge"}'),
      reply('   '),
      idle,
    ];
    (fake.turnScript[1].data as Record<string, unknown>).parentToolCallId = 'call-1';
    const ad = new TestAdapter(fake);
    const r = await ad.generateText('make a theme', { disabledMcpServers: ['github-mcp-server'] });
    assert.deepStrictEqual(r, { text: '{"name":"Bridge"}', nanoAiu: 4_000_000 }, 'the last top-level reply; every usage counts');
    assert.strictEqual(fake.created.length, 1, 'one throw-away session, created (never resumed)');
    assert.strictEqual(fake.resumed.length, 0);
    const s = fake.last;
    assert.deepStrictEqual(s.config.availableTools, []);
    assert.deepStrictEqual(s.config.disabledMcpServers, ['github-mcp-server']);
    assert.ok(String(s.config.workingDirectory).includes('durbar-gen-'), 'an empty temp folder');
    assert.deepStrictEqual(s.calls.find((x) => x.name === 'send')?.args[0], { prompt: 'make a theme' }, 'the prompt, no attachments');
    assert.ok(!names(s).includes('abort'), 'nothing to abort');
    // permission requests are denied, whatever they ask
    const perm = s.config.onPermissionRequest as (req: unknown) => Promise<{ kind: string }>;
    for (const req of [{ kind: 'read', path: '/etc/passwd' }, { kind: 'shell', fullCommandText: 'rm -rf /' }, { kind: 'mcp', serverName: 'x' }, {}]) assert.strictEqual((await perm(req)).kind, 'reject');
    assert.ok(!('onUserInputRequest' in s.config), 'no question handler');
    cleanedUp(fake, s, 'success');
    assert.ok(!ad.isLive(s.sessionId), 'not a tracked agent session');
  }

  // ---- no usage reported: no credits field
  {
    const fake = new FakeClient();
    fake.turnScript = [reply('{"name":"x"}'), usage(0), idle];
    assert.deepStrictEqual(await new TestAdapter(fake).generateText('p'), { text: '{"name":"x"}' });
  }

  // ---- an empty answer is an error, and still cleans up
  {
    const fake = new FakeClient();
    fake.turnScript = [usage(2_000_000), idle];
    await assert.rejects(new TestAdapter(fake).generateText('p'), /no answer/);
    cleanedUp(fake, fake.last, 'empty');
  }

  // ---- a session error ends the wait with a message (no raw error text from the runtime beyond its type)
  {
    const fake = new FakeClient();
    fake.turnScript = [{ type: 'session.error', data: { errorType: 'quota', message: 'secret details' } }];
    await assert.rejects(new TestAdapter(fake).generateText('p'), (e: Error) => /could not answer \(quota\)/.test(e.message) && !/secret/.test(e.message));
    cleanedUp(fake, fake.last, 'session error');
  }

  // ---- send throws: cleaned up, the error passes through
  {
    const fake = new FakeClient();
    fake.sendFail = 'boom';
    await assert.rejects(new TestAdapter(fake).generateText('p'), /boom/);
    cleanedUp(fake, fake.last, 'send error');
  }

  // ---- timeout: the turn is aborted, then disconnected and deleted
  {
    const fake = new FakeClient();
    fake.sendHangs = true;
    const t0 = Date.now();
    await assert.rejects(new TestAdapter(fake, 50).generateText('p'), /in time/);
    assert.ok(Date.now() - t0 < 5000, 'the time limit applies');
    const s = fake.last;
    assert.ok(names(s).indexOf('abort') >= 0 && names(s).indexOf('abort') < names(s).indexOf('disconnect'), 'aborted before disconnect');
    cleanedUp(fake, s, 'timeout');
  }

  // ---- a session that was never written to disk: deleteSession throws, which is ignored
  {
    const fake = new FakeClient();
    fake.turnScript = [reply('ok'), idle];
    const orig = fake.createSession.bind(fake);
    fake.createSession = async (config: Record<string, unknown>) => {
      const s = await orig(config);
      fake.onDisk.delete(s.sessionId);
      return s;
    };
    assert.deepStrictEqual(await new TestAdapter(fake).generateText('p'), { text: 'ok' });
    assert.deepStrictEqual(fake.deleted, [fake.last.sessionId], 'deletion was still asked');
  }

  // ---- createSession fails: nothing to dispose, the temp folder is still removed
  {
    const fake = new FakeClient();
    let dir = '';
    fake.createSession = async (config: Record<string, unknown>) => {
      dir = String(config.workingDirectory);
      throw new Error('not signed in');
    };
    await assert.rejects(new TestAdapter(fake).generateText('p'), /not signed in/);
    assert.ok(dir && !fs.existsSync(dir), 'temp folder removed');
    assert.deepStrictEqual(fake.deleted, []);
  }

  console.log('test:copilotoneshot ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

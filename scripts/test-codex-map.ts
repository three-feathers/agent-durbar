/** Codex notification mapping with SYNTHETIC fixtures (written from the docs, not recorded), no Codex binary, no credits: `npm run test:runtime`. Spec 012 T024. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { CODEX_CHILD_LIMIT, CODEX_INTENT_CAP, CODEX_TEXT_CAP, CodexMapper } from '../src/adapters/codexMap';
import type { CodexNotification } from '../src/adapters/codexMap';
import type { EventBody } from '../src/adapters/map';

const dir = path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'codex');
interface Fixture {
  provenance: string;
  notifications: CodexNotification[];
  expected: EventBody[];
}
const fx = (name: string): Fixture => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
/** Events as plain JSON (undefined fields dropped), so they compare with the fixture's `expected`. */
const run = (notes: unknown[]): any[] => {
  const out: EventBody[] = [];
  const m = new CodexMapper((b) => out.push(b));
  notes.forEach((n) => m.map(n as CodexNotification));
  return JSON.parse(JSON.stringify(out));
};

// 1. Every fixture gives its expected event list, and says it is synthetic.
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
assert.deepStrictEqual(files, ['command.json', 'deltas.json', 'failure.json', 'file-change-approval.json', 'file-change.json', 'mcp-tool.json', 'subagent.json', 'thread-turn.json', 'unknown.json', 'usage.json']);
for (const f of files) {
  const j = fx(f);
  assert.strictEqual(j.provenance, 'synthetic', `${f} is marked synthetic`);
  assert.deepStrictEqual(run(j.notifications), j.expected, `fixture ${f}`);
}

// 2. Item lifecycle: started, then completed, deltas in order; the final message holds the streamed text.
{
  const out = run(fx('command.json').notifications);
  const phases = out.filter((e) => e.callId === 'cmd_1').map((e) => `${e.phase}:${e.output ?? ''}`);
  assert.deepStrictEqual(phases, ['start:', 'update:PASS a\n', 'update:PASS b\n', 'complete:PASS a\nPASS b\n'], 'command lifecycle in order');
  const msgs = run(fx('thread-turn.json').notifications).filter((e) => e.type === 'output');
  assert.deepStrictEqual(msgs.map((e) => e.delta), ['Hello', ', world.', ''], 'agent message deltas in order, then the final');
  assert.strictEqual(msgs[2].final, true);
  assert.strictEqual(msgs[2].text, 'Hello, world.');
  // A completed agentMessage without text uses what streamed.
  const d = run(fx('deltas.json').notifications).filter((e) => e.type === 'output');
  assert.strictEqual(d[d.length - 1].text, 'Done.', 'final text rebuilt from deltas');
  // Reasoning: streamed block is not repeated by its completed item; a never-streamed one is shown whole.
  const th = run(fx('deltas.json').notifications).filter((e) => e.type === 'thinking');
  assert.deepStrictEqual(th.map((e) => `${e.reasoningId}=${e.delta}`), ['rs_1:0=Checking ', 'rs_1:0=the tests', 'rs_1:1=Then fixing', 'rs_2:0=Never streamed']);
}

// 3. An MCP tool call carries its server and tool; other tool kinds do not claim an MCP origin.
{
  const calls = run(fx('mcp-tool.json').notifications).filter((e) => e.type === 'toolCall');
  const gh = calls.filter((e) => e.callId === 'mcp_1');
  assert.ok(gh.length === 2 && gh.every((e) => e.mcpServer === 'github' && e.mcpTool === 'get_issue' && e.tool === 'github.get_issue'), 'server and tool on start and complete');
  assert.strictEqual(calls.find((e) => e.callId === 'mcp_2' && e.phase === 'failed').output, 'server unreachable');
  assert.ok(calls.filter((e) => e.callId === 'web_1').every((e) => e.mcpServer === undefined && e.tool === 'webSearch'));
  const shell = run(fx('command.json').notifications).find((e) => e.type === 'toolCall');
  assert.ok(shell.mcpServer === undefined && shell.mcpTool === undefined);
}

// 4. Sub-agent items: the item id is the subagentId; events of the child thread carry it as agentId; strangers are ignored.
{
  const out = run(fx('subagent.json').notifications);
  const subs = out.filter((e) => e.type === 'subagent');
  assert.deepStrictEqual(subs.map((e) => `${e.subagentId}:${e.phase}`), ['collab_1:started', 'collab_1:completed', 'thr_child2:started', 'thr_child2:failed']);
  assert.strictEqual(subs[0].task, 'Find the failing test');
  assert.ok(subs.every((e) => e.agentId === undefined), 'the sub-agent events themselves belong to the main agent');
  assert.deepStrictEqual(out.filter((e) => e.agentId === 'collab_1').map((e) => e.type), ['status', 'output', 'toolCall', 'toolCall']);
  assert.deepStrictEqual(out.filter((e) => e.agentId === 'thr_child2').map((e) => e.delta), ['hi']);
  assert.ok(!out.some((e) => e.delta === 'ignored'), 'a thread nobody announced is ignored');
}

// 5. Failure maps to an error status; usage-limit has its own wording; interrupted is not an error.
{
  const st = run(fx('failure.json').notifications).filter((e) => e.type === 'status');
  assert.deepStrictEqual(st.map((e) => `${e.status}|${e.intent}`).slice(2), [
    'error|SandboxError: Sandbox denied the write',
    'error|Codex usage limit reached',
    'error|HttpConnectionFailed: connection reset',
    'error|Turn failed',
    'idle|Aborted',
  ]);
}

// 6. Usage: tokens only. No credits and no money; a null window is limit 0 (unknown; T025 tests the rest).
{
  const out = run(fx('usage.json').notifications);
  const us = out.filter((e) => e.type === 'usage');
  assert.strictEqual(us.length, 2);
  assert.deepStrictEqual(us[0], { type: 'usage', inputTokens: 1000, outputTokens: 500, cacheReadTokens: 400 });
  for (const e of us) assert.ok(!('nanoAiu' in e) && !('costUsd' in e) && !('costBasis' in e) && !('creditsStatus' in e), 'Codex reports no credits and no money');
  assert.deepStrictEqual(out.filter((e) => e.type === 'context').map((e) => [e.tokens, e.limit]), [[1000, 272000], [600, 0]]);
}

// 7. Unknown and malformed input produces nothing and never throws; inherited keys are not read.
{
  assert.deepStrictEqual(run(fx('unknown.json').notifications), []);
  assert.deepStrictEqual(run([{ method: 'constructor', params: {} }, { method: '__proto__', params: {} }, { method: 'toString', params: {} }, { method: 'hasOwnProperty', params: {} }]), []);
  const proto = (o: object) => Object.create(o);
  // Inherited method, params, delta, item, thread: none of them count.
  assert.deepStrictEqual(run([proto({ method: 'turn/started', params: {} })]), []);
  assert.deepStrictEqual(run([{ method: 'turn/started', ...proto({ params: {} }) }]), []);
  assert.deepStrictEqual(run([{ method: 'item/agentMessage/delta', params: proto({ delta: 'x' }) }]), []);
  assert.deepStrictEqual(run([{ method: 'item/started', params: { item: proto({ id: 'a', type: 'commandExecution' }) } }]), []);
  assert.deepStrictEqual(run([{ method: 'thread/started', params: { thread: proto({ id: 't' }) } }]), []);
  // A real "__proto__" key from JSON.parse is an own key; its content is still not read as the fields it holds.
  assert.deepStrictEqual(run([JSON.parse('{"method":"item/agentMessage/delta","params":{"__proto__":{"delta":"x"}}}')]), []);
  assert.deepStrictEqual(run([JSON.parse('{"method":"item/started","params":{"item":{"__proto__":{"id":"a","type":"commandExecution"}}}}')]), []);
  // Prototype pollution through the mapper's own tables.
  const m = new CodexMapper(() => undefined);
  m.map({ method: 'item/started', params: { item: { id: '__proto__', type: 'commandExecution' } } });
  assert.strictEqual(({} as any).tool, undefined);
}

// 8. Wrong-typed fields: no throw, nothing wrong emitted.
{
  const bad: unknown[] = [
    { method: 'thread/started', params: { thread: { id: 5 } } },
    { method: 'item/completed', params: { item: { id: 'a', type: 'mcpToolCall', server: 1, tool: ['x'], result: 'r', arguments: null } } },
    { method: 'item/completed', params: { item: { id: 'b', type: 'fileChange', changes: 'nope' } } },
    { method: 'item/completed', params: { item: { id: 'c', type: 'collabAgentToolCall', receiverThreadIds: 'x' } } },
    { method: 'turn/plan/updated', params: { plan: 'nope' } },
    { method: 'thread/tokenUsage/updated', params: { tokenUsage: { last: { inputTokens: 'a' }, modelContextWindow: 'big' } } },
  ];
  assert.doesNotThrow(() => run(bad));
  // Pinned: items with a valid id and type but wrong-typed optional fields degrade to bare events; everything else gives nothing.
  assert.deepStrictEqual(run(bad), [
    { type: 'toolCall', callId: 'a', tool: 'mcp', phase: 'complete' },
    { type: 'toolCall', callId: 'b', tool: 'apply_patch', phase: 'complete' },
    // (a collabAgentToolCall without a spawn tool is a coordination call, not a helper: FR-149)
  ], 'malformed input degrades to bare events only where id and type are valid');
  const T = { method: 'thread/started', params: { thread: { id: 't', cwd: '/w' } } };
  const READY = { type: 'status', status: 'idle', intent: 'Ready in /w' };
  for (const last of [{}, { inputTokens: 'a' }, { inputTokens: NaN }, { inputTokens: -1 }, { totalTokens: 5 }, null]) {
    assert.deepStrictEqual(run([T, { method: 'thread/tokenUsage/updated', params: { tokenUsage: { last, modelContextWindow: 100 } } }]), [READY], `malformed usage ${JSON.stringify(last)}`);
  }
  assert.deepStrictEqual(run([T, { method: 'thread/tokenUsage/updated', params: { tokenUsage: { last: { outputTokens: 7 } } } }]), [READY, { type: 'usage', outputTokens: 7 }], 'one valid count is enough; no context without input');
}

// 10. Tables are bounded: pruned when the main turn completes, text capped, children FIFO-limited.
{
  const m = new CodexMapper(() => undefined);
  const priv = m as unknown as { tools: Map<string, unknown>; messages: Map<string, string>; reasoningSeen: Set<string>; children: Map<string, string> };
  m.map({ method: 'thread/started', params: { thread: { id: 't' } } });
  m.map({ method: 'item/started', params: { threadId: 't', item: { id: 'c1', type: 'commandExecution', command: 'x' } } });
  m.map({ method: 'item/agentMessage/delta', params: { threadId: 't', itemId: 'm1', delta: 'x' } });
  m.map({ method: 'item/reasoning/summaryTextDelta', params: { threadId: 't', itemId: 'r1', delta: 'x' } });
  assert.deepStrictEqual([priv.tools.size, priv.messages.size, priv.reasoningSeen.size], [1, 1, 1]);
  m.map({ method: 'turn/completed', params: { threadId: 't', turn: { status: 'completed' } } });
  assert.deepStrictEqual([priv.tools.size, priv.messages.size, priv.reasoningSeen.size], [0, 0, 0], 'pruned after the main turn');
  // Text cap: accumulated and final.
  const out: any[] = [];
  const m2 = new CodexMapper((b) => out.push(b));
  m2.map({ method: 'thread/started', params: { thread: { id: 't' } } });
  const big = 'a'.repeat(CODEX_TEXT_CAP);
  m2.map({ method: 'item/agentMessage/delta', params: { threadId: 't', itemId: 'm', delta: big } });
  m2.map({ method: 'item/agentMessage/delta', params: { threadId: 't', itemId: 'm', delta: big } });
  m2.map({ method: 'item/completed', params: { threadId: 't', item: { id: 'm', type: 'agentMessage' } } });
  assert.strictEqual(out.find((e) => e.final).text.length, CODEX_TEXT_CAP, 'rebuilt text capped');
  m2.map({ method: 'item/completed', params: { threadId: 't', item: { id: 'n', type: 'agentMessage', text: big + big } } });
  assert.strictEqual(out.filter((e) => e.final)[1].text.length, CODEX_TEXT_CAP, 'item text capped');
  // Children FIFO.
  for (let i = 0; i < CODEX_CHILD_LIMIT + 10; i++) m.map({ method: 'item/started', params: { threadId: 't', item: { id: `s${i}`, type: 'subAgentActivity', kind: 'started', agentThreadId: `c${i}` } } });
  assert.strictEqual(priv.children.size, CODEX_CHILD_LIMIT);
  assert.ok(!priv.children.has('c0') && priv.children.has(`c${CODEX_CHILD_LIMIT + 9}`), 'oldest forgotten first');
}

// 11. Every intent is capped.
{
  const long = 'z'.repeat(1000);
  const st = run([
    { method: 'thread/started', params: { thread: { id: 't', cwd: '/' + long } } },
    { method: 'turn/plan/updated', params: { threadId: 't', plan: [{ step: long, status: 'inProgress' }] } },
    { method: 'turn/completed', params: { threadId: 't', turn: { status: 'failed', error: { message: long, codexErrorInfo: 'X' } } } },
  ]);
  assert.strictEqual(st.length, 3);
  for (const e of st) assert.strictEqual(e.intent.length, CODEX_INTENT_CAP, `intent capped (${e.status})`);
}

// 12. threadId: present but not a non-empty string is ignored; nothing is adopted before thread/started.
{
  const T = { method: 'thread/started', params: { thread: { id: 't', cwd: '/w' } } };
  const delta = (threadId: unknown) => ({ method: 'item/agentMessage/delta', params: { threadId, itemId: 'm', delta: 'x' } });
  for (const bad of [5, '', null, {}, ['t'], true]) assert.deepStrictEqual(run([T, delta(bad)]).length, 1, `bad threadId ${JSON.stringify(bad)} ignored`);
  assert.strictEqual(run([T, delta('t')]).length, 2, 'main thread accepted');
  assert.strictEqual(run([T, { method: 'item/agentMessage/delta', params: { itemId: 'm', delta: 'x' } }]).length, 2, 'absent threadId is the main agent');
  assert.deepStrictEqual(run([delta('other')]), [], 'a thread is not adopted before thread/started');
  const out = run([delta('other'), T, delta('other'), delta('t')]);
  assert.deepStrictEqual(out.map((e) => e.type), ['status', 'output'], 'arbitrary thread never becomes the main one');
}

// 13. Exit code and declined: hand-written expectations.
{
  const done = (item: object) => run([{ method: 'item/completed', params: { item: { id: 'x', type: 'commandExecution', ...item } } }])[0];
  assert.strictEqual(done({ status: 'completed', exitCode: 2, aggregatedOutput: 'bad' }).phase, 'failed', 'non-zero exit is failed');
  assert.strictEqual(done({ status: 'completed', exitCode: 0 }).phase, 'complete');
  assert.strictEqual(done({ status: 'completed' }).phase, 'complete', 'no exit code: status decides');
  const cmd = run(fx('command.json').notifications).filter((e) => e.callId === 'cmd_2');
  assert.deepStrictEqual(cmd.map((e) => [e.phase, e.output]), [['start', undefined], ['failed', 'declined']]);
  const fc = run(fx('file-change.json').notifications).filter((e) => e.callId === 'fc_2');
  assert.deepStrictEqual(fc.map((e) => [e.phase, e.output]), [['start', undefined], ['failed', 'declined']]);
  const sub = run([{ method: 'item/completed', params: { item: { id: 's', type: 'subAgentActivity', status: 'failed', error: { message: 'child crashed' } } } }]);
  assert.deepStrictEqual(sub, [{ type: 'subagent', subagentId: 's', phase: 'failed', error: 'child crashed' }]);
}

// 9. Output is capped; threadId is exposed after thread/started; reset clears state.
{
  const out = run([{ method: 'item/completed', params: { item: { id: 'x', type: 'commandExecution', status: 'completed', aggregatedOutput: 'a'.repeat(5000) } } }]);
  assert.strictEqual(out[0].output.length, 2000);
  const m = new CodexMapper(() => undefined);
  assert.strictEqual(m.threadId, undefined);
  m.map({ method: 'thread/started', params: { thread: { id: 'thr_1' } } });
  assert.strictEqual(m.threadId, 'thr_1');
  m.reset();
  assert.strictEqual(m.threadId, undefined);
}

// FR-149: the real Codex 0.163 shape. Each subAgentActivity is its own item, opened and closed at once, keyed by agentThreadId;
// `wait` is a coordination call, not a helper
{
  const out: EventBody[] = [];
  const m = new CodexMapper((b) => out.push(b));
  m.adopt('main', '/w');
  const act = (id: string, kind: string, model: string | null) => ({ type: 'subAgentActivity', id, kind, agentThreadId: 'thr_h', agentPath: '/root/pelican', model, reasoningEffort: null });
  const n = (method: string, item: unknown) => m.map({ method, params: { threadId: 'main', item } } as CodexNotification);
  n('item/started', act('call_a', 'started', 'gpt-6.1-sol'));
  n('item/completed', act('call_a', 'started', 'gpt-6.1-sol'));
  n('item/started', { type: 'collabAgentToolCall', id: 'call_w', tool: 'wait', status: 'inProgress', receiverThreadIds: [] });
  m.map({ method: 'item/agentMessage/delta', params: { threadId: 'thr_h', itemId: 'x', delta: 'pelican' } } as CodexNotification);
  n('item/started', act('subagent-completed-1', 'completed', null));
  n('item/completed', act('subagent-completed-1', 'completed', null));
  n('item/completed', { type: 'collabAgentToolCall', id: 'call_w', tool: 'wait', status: 'completed', receiverThreadIds: [] });
  const subs = out.filter((e) => e.type === 'subagent') as Array<{ subagentId: string; phase: string; agentName?: string }>;
  assert.deepStrictEqual(subs.map((e) => `${e.subagentId}:${e.phase}:${e.agentName}`), ['thr_h:started:pelican', 'thr_h:completed:pelican'], 'one helper, started and completed once; wait is not a helper');
  assert.deepStrictEqual(out.filter((e) => (e as { agentId?: string }).agentId === 'thr_h').map((e) => (e as { delta?: string }).delta), ['pelican'], "the helper thread's output is attributed to it");
}

console.log('codex map: ok');

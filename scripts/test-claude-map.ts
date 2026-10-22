/** Claude message mapping tests with SYNTHETIC fixtures (scripts/fixtures/claude), no credits, no SDK: part of `npm run test:runtime`. Spec 012 T023. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { ClaudeMapper, parseMcpToolName } from '../src/adapters/claudeMap';
import type { ClaudeMessage } from '../src/adapters/claudeMap';
import type { EventBody } from '../src/adapters/map';

interface Fixture {
  provenance: string;
  messages: ClaudeMessage[];
  expected: unknown[];
}
const dir = path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'claude');
const load = (name: string): Fixture => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
/** Strip keys that are undefined (the JSON fixtures cannot hold them). */
const strip = (events: EventBody[]): unknown[] => JSON.parse(JSON.stringify(events));
let dropped: string[] = [];
const run = (messages: ClaudeMessage[], quiet = false): EventBody[] => {
  const out: EventBody[] = [];
  dropped = [];
  const m = new ClaudeMapper((b) => out.push(b), { quiet, onDropped: (r) => dropped.push(r) });
  messages.forEach((x) => m.map(x));
  return out;
};

// 1. Every fixture is synthetic or a redacted real recording (spec 012 T067) and maps to exactly its expected event list.
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
assert.ok(files.length >= 9, 'fixtures present');
for (const f of files) {
  const fx = load(f);
  assert.ok(fx.provenance === 'synthetic' || fx.provenance === 'real-redacted', `${f} is marked synthetic or real-redacted`);
  if (fx.provenance === 'real-redacted') assert.ok(!/\/tmp\/|\/home\/(?!user\b)|\/Users\/|[A-Za-z]:\\\\|sk-ant|@[a-z0-9-]+\.[a-z]/i.test(JSON.stringify(fx.messages)), `${f}: no real paths, keys or e-mail addresses`);
  assert.deepStrictEqual(strip(run(fx.messages)), fx.expected, `fixture ${f} maps to the expected events`);
  assert.deepStrictEqual(dropped, [], `fixture ${f}: nothing dropped silently`);
}

// 2. Thinking: deltas carry message id + block index; a complete block is shown only when it did not stream.
{
  const th = run(load('stream-text-thinking.json').messages).filter((e) => e.type === 'thinking');
  assert.strictEqual(th.length, 2, 'thinking deltas mapped, complete block not repeated');
  assert.ok(th.every((e) => e.type === 'thinking' && e.reasoningId === 'msg_1:0'));
  assert.strictEqual(run(load('thinking-complete-only.json').messages).filter((e) => e.type === 'thinking').length, 1, 'whole thinking block shown once');
}

// 3. MCP name parsing against the init server list (FR-014).
{
  const servers = ['github', 'my-server', 'a', 'a_b', 'my.srv'];
  assert.deepStrictEqual(parseMcpToolName('mcp__github__create_issue', servers), { mcpServer: 'github', mcpTool: 'create_issue' }, 'known server');
  assert.deepStrictEqual(parseMcpToolName('mcp__my_srv__x', servers), { mcpServer: 'my.srv', mcpTool: 'x' }, 'server name normalised like the CLI does');
  assert.deepStrictEqual(parseMcpToolName('mcp__a_b__t', servers), { mcpServer: 'a_b', mcpTool: 't' }, 'longest matching server wins');
  assert.deepStrictEqual(parseMcpToolName('mcp__a__b__t', servers), { mcpServer: 'a', mcpTool: 'b__t' }, 'tool name may hold __');
  assert.deepStrictEqual(parseMcpToolName('mcp__a__b__t', ['a', 'a__b']), { mcpServer: 'a__b', mcpTool: 't' }, 'longest of two matching servers wins');
  assert.deepStrictEqual(parseMcpToolName('mcp__a__b__t', ['a__b', 'a']), { mcpServer: 'a__b', mcpTool: 't' }, 'longest wins whatever the list order');
  assert.strictEqual(parseMcpToolName('mcp__unknown__t', servers), undefined, 'unknown server: generic tool');
  assert.strictEqual(parseMcpToolName('mcp__github', servers), undefined, 'malformed: no tool part');
  assert.strictEqual(parseMcpToolName('mcp__github__', servers), undefined, 'malformed: empty tool');
  assert.strictEqual(parseMcpToolName('Read', servers), undefined, 'not an MCP name');
  assert.strictEqual(parseMcpToolName('mcp__github__x', []), undefined, 'no init yet: never guess');
  const calls = run(load('mcp-tool.json').messages).filter((e) => e.type === 'toolCall' && e.phase === 'start');
  assert.deepStrictEqual(calls.map((e) => (e.type === 'toolCall' ? [e.mcpServer, e.mcpTool] : [])), [['github', 'create_issue'], ['my-server', 'do__thing'], [undefined, undefined], [undefined, undefined], [undefined, undefined], ['a__b', 't']], 'mcp origin on tool calls');
}

// 3b. Spec 058 T096: a failed MCP tool result with an OAuth challenge -> mcpAuth (judged before the 4000-char cut); statuses carry errorClass.
{
  const init = { type: 'system', subtype: 'init', session_id: 's', mcp_servers: [{ name: 'notes', status: 'needs-auth' }, { name: 'web', status: 'connected' }, { name: 'bad', status: 'failed', error: 'boom' }] } as ClaudeMessage;
  const call = (id: string, name: string): ClaudeMessage => ({ type: 'assistant', message: { id: `m${id}`, content: [{ type: 'tool_use', id, name, input: {} }] } }) as ClaudeMessage;
  const res = (id: string, content: unknown, isError: boolean): ClaudeMessage => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } }) as ClaudeMessage;
  const challenge = 'MCP OAuth challenge required (HTTP 401)';
  const outcome = (name: string, content: unknown, isError: boolean) => {
    const e = run([init, call('t1', name), res('t1', content, isError)]).filter((x) => x.type === 'toolCall' && x.phase !== 'start');
    assert.strictEqual(e.length, 1);
    return e[0] as { mcpAuth?: true; output?: string };
  };
  assert.strictEqual(outcome('mcp__notes__q', challenge, true).mcpAuth, true, 'failed MCP call with a challenge');
  assert.strictEqual(outcome('mcp__notes__q', 'MCP server "notes" needs authentication', true).mcpAuth, true, "Claude Code's own wording (read: 2.1.304)");
  assert.strictEqual('mcpAuth' in outcome('mcp__notes__q', 'The app needs authentication', true), false, 'not the MCP wording');
  assert.strictEqual(outcome('mcp__notes__q', [{ type: 'text', text: challenge }], true).mcpAuth, true, 'text blocks too');
  assert.strictEqual(outcome('mcp__notes__q', 'x'.repeat(4500) + challenge, true).mcpAuth, undefined, 'only the first 4000 characters are judged (classifier bound)');
  assert.strictEqual(outcome('mcp__notes__q', `MCP OAuth challenge required ${'y'.repeat(5000)}`, true).mcpAuth, true, 'detected although the stored output is cut');
  assert.strictEqual(outcome('mcp__notes__q', `MCP OAuth challenge required ${'y'.repeat(5000)}`, true).output?.length, 4000, 'output still capped');
  assert.strictEqual('mcpAuth' in outcome('mcp__notes__q', challenge, false), false, 'a successful result never');
  assert.strictEqual('mcpAuth' in outcome('mcp__notes__q', 'HTTP 500 server error', true), false, 'another failure');
  assert.strictEqual('mcpAuth' in outcome('Bash', challenge, true), false, 'not an MCP tool');
  assert.strictEqual('mcpAuth' in outcome('mcp__ghost__q', challenge, true), false, 'unknown server: never guessed');
  const mcp = run([init]).find((e) => e.type === 'mcp') as { servers: { name: string; status: string; errorClass?: string }[] };
  assert.deepStrictEqual(mcp.servers.map((x) => [x.name, x.status, x.errorClass]), [['notes', 'needs-auth', 'auth'], ['web', 'connected', undefined], ['bad', 'failed', undefined]], 'needs-auth carries errorClass auth; failed is not guessed');
}

// 4. Sub-agents: events carry their parent (the spawning tool_use id), by parent_tool_use_id and by agent_id via task_started.
{
  const out = run(load('subagent-task.json').messages);
  const started = out.find((e) => e.type === 'subagent' && e.phase === 'started');
  assert.ok(started && started.type === 'subagent' && started.subagentId === 'toolu_a1' && started.agentName === 'explore' && started.agentId === undefined);
  const child = out.filter((e) => e.agentId === 'toolu_a1');
  assert.strictEqual(child.length, 3, 'streamed text, tool start (parent_tool_use_id) and tool result (agent_id) carry the parent');
  assert.ok(out.filter((e) => e.agentId === undefined).length === 4, 'the rest belongs to the main agent');
}

// 4b. Exactly one closing event per sub-agent: by the tool_result alone, or by task_notification first (no double close).
{
  const closes = (f: string): string[] => run(load(f).messages).filter((e) => e.type === 'subagent' && e.phase !== 'started').map((e) => (e.type === 'subagent' ? `${e.subagentId}:${e.phase}` : ''));
  assert.deepStrictEqual(closes('subagent-result-closes.json'), ['toolu_r1:completed', 'toolu_r2:failed'], 'tool_result closes the helper when no task_notification came');
  assert.deepStrictEqual(closes('subagent-task.json'), ['toolu_a1:completed'], 'task_notification before tool_result: closed once');
}

// 4c. Close order: tool_result BEFORE task_notification gives exactly one close; a notification for an id never opened gives nothing.
{
  const start = { type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 'tA', name: 'Agent', input: { prompt: 'p' } }] } };
  const result = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tA', content: 'ok' }] } };
  const note = { type: 'system', subtype: 'task_notification', task_id: 'k1', tool_use_id: 'tA', status: 'completed' };
  const closes = (ms: ClaudeMessage[]): number => run(ms).filter((e) => e.type === 'subagent' && e.phase !== 'started').length;
  assert.strictEqual(closes([start, result, note]), 1, 'result then notification: one close');
  assert.strictEqual(closes([start, note, result, note]), 1, 'notification, result, repeated notification: one close');
  assert.strictEqual(closes([{ type: 'system', subtype: 'task_notification', task_id: 'k9', tool_use_id: 'never', status: 'completed' }]), 0, 'notification for an id never opened: no event');
  const dup = run([start, start]).filter((e) => e.type === 'subagent' && e.phase === 'started');
  assert.strictEqual(dup.length, 1, 'a repeated tool_use id starts one helper');
  const long = run([start, { type: 'system', subtype: 'task_notification', tool_use_id: 'tA', status: 'failed', summary: 'y'.repeat(9000) }]).find((e) => e.type === 'subagent' && e.phase === 'failed');
  assert.ok(long && long.type === 'subagent' && long.error && long.error.length === 4000, 'failure summary capped');
}

// 4d. Cost: the running total_cost_usd becomes per-result deltas (0.01 then 0.03 -> 0.01, 0.02); a total that does not grow gives nothing.
{
  const res = (c: number): ClaudeMessage => ({ type: 'result', subtype: 'success', total_cost_usd: c });
  const costs = (ms: ClaudeMessage[]): number[] => run(ms).flatMap((e) => (e.type === 'usage' && e.costUsd !== undefined ? [Math.round(e.costUsd * 1e6) / 1e6] : []));
  assert.deepStrictEqual(costs([res(0.01), res(0.03)]), [0.01, 0.02], 'deltas of the running total');
  assert.deepStrictEqual(costs([res(0.01), res(0.01), res(0.02)]), [0.01, 0.01], 'unchanged total: no event');
}

// 4e. Tables stay bounded: per-turn stream state is cleared on result, a closed sub-agent leaves no task entry.
{
  const out: EventBody[] = [];
  const m = new ClaudeMapper((b) => out.push(b));
  const feed = (x: ClaudeMessage): void => m.map(x);
  for (let i = 0; i < 5; i++) {
    feed({ type: 'stream_event', event: { type: 'message_start', message: { id: `m${i}` } } });
    feed({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 't' } } });
    feed({ type: 'assistant', message: { id: `m${i}`, content: [{ type: 'tool_use', id: `a${i}`, name: 'Agent', input: {} }] } });
    feed({ type: 'system', subtype: 'task_started', task_id: `k${i}`, tool_use_id: `a${i}` });
  }
  assert.ok(m.stats().thinkingStreamed === 5 && m.stats().streamMessage === 1 && m.stats().tasks === 5 && m.stats().openSubagents === 5, 'state grows during a turn');
  for (let i = 0; i < 5; i++) feed({ type: 'system', subtype: 'task_notification', task_id: `k${i}`, tool_use_id: `a${i}`, status: 'completed' });
  feed({ type: 'result', subtype: 'success' });
  for (let i = 0; i < 5; i++) feed({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `a${i}`, content: 'x' }] } });
  assert.deepStrictEqual(m.stats(), { tools: 0, tasks: 0, openSubagents: 0, streamMessage: 0, thinkingStreamed: 0 }, 'all tables empty after the turn');
}

// 5. Errors: an error result maps to an error status; success to idle; the usage limit to a coffee break (spec 068).
{
  const st = run(load('error.json').messages).filter((e) => e.type === 'status');
  assert.deepStrictEqual(st.map((e) => (e.type === 'status' ? e.status : '')), ['error', 'error', 'idle']); // spec 068: credits_required is a coffee break (usageLimit), not an error status
  const ok = run(load('result-success.json').messages);
  assert.strictEqual(ok[ok.length - 1].type === 'status' && (ok[ok.length - 1] as { status: string }).status, 'idle');
}

// 6. Usage: cost in USD as an estimate, never AIU.
{
  const u = run(load('result-success.json').messages).find((e) => e.type === 'usage');
  assert.ok(u && u.type === 'usage');
  assert.strictEqual(u.costUsd, 0.0123, 'costUsd mapped');
  assert.strictEqual(u.costBasis, 'estimate');
  assert.strictEqual(u.nanoAiu, undefined, 'no nanoAiu from Claude');
  const tokens = run(load('stream-text-thinking.json').messages).find((e) => e.type === 'usage');
  assert.ok(tokens && tokens.type === 'usage' && tokens.nanoAiu === undefined && tokens.inputTokens === 200 && tokens.cacheReadTokens === 80);
}

// 7. Init: quiet start skips the Ready status; the session info is remembered.
{
  const fx = load('init.json');
  const quiet = run(fx.messages, true);
  assert.deepStrictEqual(quiet.map((e) => e.type), ['mcp']);
  const m = new ClaudeMapper(() => undefined);
  m.map(fx.messages[0]);
  assert.strictEqual(m.info.model, 'claude-synthetic-1');
  assert.strictEqual(m.info.cliVersion, '0.0.0-synthetic');
  assert.strictEqual(m.info.cwd, '/work/demo');
}

// 8. Tool output is capped.
{
  const long = 'x'.repeat(10000);
  const out = run([
    { type: 'assistant', message: { id: 'm', content: [{ type: 'tool_use', id: 't', name: 'Read', input: {} }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: long }] } },
  ]);
  const done = out[out.length - 1];
  assert.ok(done.type === 'toolCall' && done.output !== undefined && done.output.length === 4000, 'tool output capped at 4000 characters');
}

// 9. Unknown and malformed messages are ignored, never thrown (FR-020); a bad block is skipped on its own and the rest of the message survives.
{
  const junk: unknown[] = [null, undefined, 5, 'x', {}, { type: 'brand_new' }, { type: 'system' }, { type: 'system', subtype: 'future' }, { type: 'stream_event' }, { type: 'stream_event', event: { type: 'content_block_delta' } },
    { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 5 } } }, { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: { a: 1 } } } },
    { type: 'assistant' }, { type: 'assistant', message: { content: 'not an array', usage: 3 } }, { type: 'assistant', message: { content: [null, 7, { type: 'tool_use' }, { type: 'mystery' }] } },
    { type: 'user', message: { content: [null, { type: 'tool_result' }, { type: 'tool_result', tool_use_id: 7 }] } }, { type: 'result', total_cost_usd: 'a', permission_denials: 'x' }];
  const out: EventBody[] = [];
  const reasons: string[] = [];
  const m = new ClaudeMapper((b) => out.push(b), { onDropped: (r) => reasons.push(r) });
  assert.doesNotThrow(() => junk.forEach((j) => m.map(j as ClaudeMessage)));
  assert.deepStrictEqual(strip(out), [{ type: 'status', status: 'idle' }], 'junk produces nothing but the (valid) success result status');
  assert.ok(reasons.length >= 3, 'malformed blocks are reported through onDropped');
  // A message with a bad block and good blocks: the good ones survive.
  const mixed = run([{ type: 'assistant', message: { id: 'mx', content: [{ type: 'text', text: 7 }, null, { type: 'tool_use', id: 5, name: 'Read' }, { type: 'text', text: 'kept' }, { type: 'thinking', thinking: 9 }, { type: 'tool_use', id: 'ok', name: 'Read', input: {} }] } }]);
  assert.deepStrictEqual(strip(mixed), [{ type: 'output', delta: '', final: true, text: 'kept' }, { type: 'toolCall', callId: 'ok', tool: 'Read', phase: 'start', args: {} }], 'good blocks survive a bad one');
  assert.strictEqual(dropped.length, 2, 'null block and tool_use without string id are reported');
  assert.deepStrictEqual(run([{ type: 'brand_new' }, { type: 'system', subtype: 'future' }, { type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }]), []);
  assert.deepStrictEqual(dropped, [], 'unknown types are ignored without being counted as dropped');
}

// 4e. FR-134: context = the main agent's last whole input plus output; the window from the result's modelUsage; helpers never count.
{
  const asst = (id: string, model: string, u: Record<string, number>, parent?: string): ClaudeMessage => ({ type: 'assistant', ...(parent ? { parent_tool_use_id: parent } : {}), message: { id, model, content: [{ type: 'text', text: 'x' }], usage: u } } as ClaudeMessage);
  const ctx = (ms: ClaudeMessage[]) => run(ms).filter((e) => e.type === 'context');
  const first = asst('m1', 'claude-haiku-5-5', { input_tokens: 2, cache_creation_input_tokens: 8302, cache_read_input_tokens: 8858, output_tokens: 7 });
  const res: ClaudeMessage = { type: 'result', subtype: 'success', modelUsage: { 'claude-haiku-5-5': { contextWindow: 1000000, maxOutputTokens: 128000 } } } as ClaudeMessage;
  assert.deepStrictEqual(ctx([first]), [], 'no window known yet: no event');
  assert.deepStrictEqual(strip(ctx([first, res])), [{ type: 'context', tokens: 17169, limit: 1000000, model: 'claude-haiku-5-5' }], 'the window arrives with the result');
  const second = asst('m2', 'claude-haiku-5-5', { input_tokens: 5, cache_read_input_tokens: 17169, output_tokens: 40 });
  assert.deepStrictEqual(ctx([first, res, second]).map((e) => (e as { tokens: number }).tokens), [17169, 17214], 'the next message updates it at once');
  assert.deepStrictEqual(ctx([first, res, second, res]).length, 2, 'an unchanged figure is not sent again');
  const helper = asst('h1', 'claude-haiku-5-5', { input_tokens: 900000, output_tokens: 1 }, 'toolu_1');
  assert.deepStrictEqual(ctx([first, res, helper]).length, 1, 'a helper message does not count');
  const other: ClaudeMessage = { type: 'result', subtype: 'success', modelUsage: { 'claude-x': { contextWindow: 200000 }, 'claude-y': { contextWindow: 'big' } } } as ClaudeMessage;
  assert.strictEqual((ctx([first, other])[0] as { limit: number }).limit, 200000, 'a model missing from modelUsage takes the largest window listed');
  assert.deepStrictEqual(ctx([first, { type: 'result', subtype: 'success', modelUsage: { a: { contextWindow: -1 } } } as ClaudeMessage]), [], 'a bad window is ignored');
}

console.log('claude map tests passed');

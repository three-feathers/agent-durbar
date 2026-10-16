/** Event mapping tests with recorded (sanitised) real SDK events, no credits: `npm run test:events`. See specs/015. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { EventMapper } from '../src/adapters/map';
import type { EventBody, RawEvent } from '../src/adapters/map';

const fx = (name: string): RawEvent[] => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'events', name), 'utf8'));
const run = (events: RawEvent[]): EventBody[] => {
  const out: EventBody[] = [];
  const m = new EventMapper((b) => out.push(b));
  events.forEach((e) => m.map(e));
  return out;
};

// 1. Reasoning prompt: deltas stream, the closing complete block is not repeated; message and usage follow.
{
  const out = run(fx('auto-reasoning.json'));
  const th = out.filter((e) => e.type === 'thinking');
  assert.ok(th.length > 50, 'reasoning deltas are mapped');
  assert.strictEqual(new Set(th.map((e) => (e as { reasoningId?: string }).reasoningId)).size, 1, 'one reasoning block');
  const text = th.map((e) => (e as { delta: string }).delta).join('');
  assert.match(text, /^\*\*Calculating prime status\*\*/);
  assert.ok(text.length < 1500);
  assert.ok(out.every((e) => e.agentId === undefined), 'no sub-agent attribution');
  const fin = out.filter((e) => e.type === 'output' && e.final);
  assert.strictEqual(fin.length, 1);
  assert.match((fin[0] as { text: string }).text, /391 is not prime/);
  const u = out.find((e) => e.type === 'usage') as { nanoAiu?: number } | undefined;
  assert.ok(u && u.nanoAiu && u.nanoAiu > 0);
  assert.strictEqual(out[out.length - 1].type, 'status');
}

// 2. Complete reasoning block without deltas is shown whole (streaming off), but only once.
{
  const out = run([
    { type: 'assistant.reasoning', data: { reasoningId: 'r1', content: 'Whole block' } },
    { type: 'assistant.reasoning', data: { reasoningId: 'r1', content: 'Whole block' } },
  ]);
  assert.strictEqual(out.filter((e) => e.type === 'thinking').length, 2, 'no deltas seen: each complete block is shown (ids are unique in practice)');
  const out2 = run([
    { type: 'assistant.reasoning_delta', data: { reasoningId: 'r2', deltaContent: 'a' } },
    { type: 'assistant.reasoning', data: { reasoningId: 'r2', content: 'a' } },
  ]);
  assert.strictEqual(out2.filter((e) => e.type === 'thinking').length, 1);
}

// 3. Sub-agent run: no reasoning at all (as `auto` does for delegating turns); sub-agent events are attributed to the task call.
{
  const raw = fx('auto-subagent.json');
  assert.ok(!raw.some((e) => e.type.startsWith('assistant.reasoning')), 'fixture really has no reasoning');
  const out = run(raw);
  assert.ok(!out.some((e) => e.type === 'thinking'));
  const taskStart = out.find((e) => e.type === 'toolCall' && e.phase === 'start' && e.tool === 'task') as { callId: string; args: { prompt: string } } | undefined;
  assert.ok(taskStart && taskStart.args.prompt, 'the task call carries the sub-agent prompt');
  const call = taskStart.callId;
  const started = out.find((e) => e.type === 'subagent' && e.phase === 'started') as { subagentId: string; name: string; agentName: string; model: string; agentId?: string };
  assert.strictEqual(started.subagentId, call, 'helper id = spawning task call id');
  assert.strictEqual(started.name, 'readme-index-summary');
  assert.strictEqual(started.agentName, 'explore');
  assert.strictEqual(started.agentId, undefined);
  const subs = out.filter((e) => e.agentId === call);
  const tools = subs.filter((e) => e.type === 'toolCall' && e.phase === 'start').map((e) => (e as { tool: string }).tool);
  assert.deepStrictEqual(tools, ['view', 'view'], "the sub-agent's own tool calls");
  assert.ok(subs.some((e) => e.type === 'user' && /two sentences/.test((e as { text: string }).text)), "sub-agent prompt as a 'user' event");
  assert.ok(subs.some((e) => e.type === 'output' && e.final), 'sub-agent final answer');
  assert.strictEqual(subs.filter((e) => e.type === 'usage').length, 2, 'sub-agent usage is attributed to it');
  const parentTools = out.filter((e) => e.type === 'toolCall' && !e.agentId).map((e) => `${(e as { tool: string }).tool}:${(e as { phase: string }).phase}`);
  assert.deepStrictEqual(parentTools, ['task:start', 'task:complete'], "no sub-agent tool calls in the parent's list");
  const done = out.find((e) => e.type === 'subagent' && e.phase === 'completed') as { durationMs: number; totalToolCalls: number; totalTokens: number };
  assert.strictEqual(done.totalToolCalls, 2);
  assert.ok(done.durationMs > 0 && done.totalTokens > 0);
  const result = out.find((e) => e.type === 'toolCall' && e.phase === 'complete' && !e.agentId) as { output: string };
  assert.match(result.output, /hello-app/, 'task result = the sub-agent answer');
  assert.ok(out.filter((e) => e.type === 'output' && e.final && !e.agentId).length === 1, 'parent final answer');
}

// 4. Sub-agent failure and events that only carry the parent tool call id.
{
  const out = run([
    { type: 'subagent.started', agentId: 'inst-1', data: { toolCallId: 'call-9', agentName: 'general-purpose', agentDisplayName: 'Fixer', agentDescription: 'Fix it', model: 'm' } },
    { type: 'assistant.intent', agentId: 'inst-1', data: { intent: 'Fixing' } },
    { type: 'assistant.reasoning_delta', agentId: 'inst-1', data: { reasoningId: 'x', deltaContent: 'hmm' } },
    { type: 'tool.execution_start', agentId: 'unknown-inst', data: { toolCallId: 't', toolName: 'bash', arguments: {}, parentToolCallId: 'call-9' } },
    { type: 'subagent.failed', agentId: 'inst-1', data: { toolCallId: 'call-9', agentName: 'general-purpose', agentDisplayName: 'Fixer', error: 'boom', durationMs: 5 } },
  ]);
  assert.strictEqual((out[1] as { agentId?: string }).agentId, 'call-9');
  assert.strictEqual((out[2] as { agentId?: string }).agentId, 'call-9');
  assert.strictEqual((out[3] as { agentId?: string }).agentId, 'call-9', 'falls back to parentToolCallId');
  assert.deepStrictEqual({ p: (out[4] as { phase: string }).phase, e: (out[4] as { error?: string }).error }, { p: 'failed', e: 'boom' });
}

// 5. Unknown event types and tool failures are tolerated.
{
  const out = run([
    { type: 'model.call_start', data: {} },
    { type: 'tool.execution_start', data: { toolCallId: 'a', toolName: 'bash', arguments: { command: 'x' } } },
    { type: 'tool.execution_complete', data: { toolCallId: 'a', success: false, error: { message: 'nope' } } },
  ]);
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual({ t: (out[1] as { tool: string }).tool, o: (out[1] as { output?: string }).output, p: (out[1] as { phase: string }).phase }, { t: 'bash', o: 'nope', p: 'failed' });
}
console.log('event mapping tests passed');

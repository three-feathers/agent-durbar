/** Event mapping tests with recorded (sanitised) real SDK events, no credits: `npm run test:events`. See specs/015. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { EventMapper } from '../src/adapters/map';
import { eventProblems } from '../src/adapters/eventguard';
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
// 6. MCP (spec 019, recorded from the real runtime): MCP tool attribution, context window, MCP server status.
{
  const raw = fx('mcp-tool-usage.json');
  const out = run(raw);
  const calls = out.filter((e) => e.type === 'toolCall') as { phase: string; tool: string; mcpServer?: string; mcpTool?: string; output?: string }[];
  assert.deepStrictEqual(calls.map((c) => [c.phase, c.tool, c.mcpServer, c.mcpTool]), [['start', 'echo-echo', 'echo', 'echo'], ['complete', 'echo-echo', 'echo', 'echo']]);
  assert.strictEqual(calls[1].output, 'echo: hi');
  const ctx = out.filter((e) => e.type === 'context') as { tokens: number; limit: number; system?: number; toolDefinitions?: number; messages?: number }[];
  assert.deepStrictEqual(ctx.map((c) => [c.tokens, c.limit]), [[13557, 272000], [13602, 272000]]);
  assert.strictEqual(ctx[0].system, 5840);
  assert.strictEqual(ctx[0].toolDefinitions, 7668);
  assert.strictEqual(ctx[0].messages, 3);
  const mcp = out.filter((e) => e.type === 'mcp') as { servers: { name: string; status: string; source?: string }[] }[];
  assert.ok(mcp.length >= 5, 'every status change emits the full list');
  const last = mcp[mcp.length - 1].servers;
  assert.deepStrictEqual(last.map((s) => [s.name, s.status]).sort(), [['echo', 'connected'], ['github-mcp-server', 'connected']]);
  assert.strictEqual(last.find((s) => s.name === 'github-mcp-server')?.source, 'builtin');
  assert.strictEqual(mcp[0].servers.length, 1, 'first change lists only that server');
  const u = out.filter((e) => e.type === 'usage') as { model?: string; nanoAiu?: number }[];
  assert.strictEqual(u.length, 2);
  assert.strictEqual(u[0].model, 'gpt-6-luna');
  assert.ok((u[0].nanoAiu ?? 0) > 0);
  // Sub-agent context events are not shown; a failed server keeps its error and loses it when it connects; removal drops it.
  const out2 = run([
    { type: 'session.usage_info', agentId: 'inst-9', data: { currentTokens: 5, tokenLimit: 100, messagesLength: 1 } },
    { type: 'session.usage_info', data: { currentTokens: 5, tokenLimit: 0, messagesLength: 1 } },
    { type: 'session.mcp_server_status_changed', data: { serverName: 's', status: 'failed', error: 'spawn ENOENT', configSource: 'user' } },
    { type: 'session.mcp_server_status_changed', data: { serverName: 's', status: 'connected' } },
    { type: 'session.mcp_server_removed', data: { serverName: 's' } },
    { type: 'tool.execution_start', data: { toolCallId: 'x', toolName: 'view', arguments: {} } },
  ]);
  const c2 = out2.filter((e) => e.type === 'context') as { tokens: number; limit: number }[];
  assert.deepStrictEqual(c2.map((c) => [c.tokens, c.limit]), [[5, 0]], 'sub-agent skipped; unknown limit is 0');
  const m2 = out2.filter((e) => e.type === 'mcp') as { servers: { name: string; status: string; error?: string; source?: string }[] }[];
  assert.deepStrictEqual(m2[0].servers, [{ name: 's', status: 'failed', source: 'user', transport: undefined, error: 'spawn ENOENT' }]);
  assert.strictEqual(m2[1].servers[0].error, undefined);
  assert.strictEqual(m2[1].servers[0].source, 'user');
  assert.deepStrictEqual(m2[2].servers, []);
  const t2 = out2.find((e) => e.type === 'toolCall') as { mcpServer?: string };
  assert.strictEqual(t2.mcpServer, undefined, 'built-in tools carry no MCP fields');
}
// Spec 058 T094: a failed MCP tool with the server's OAuth challenge -> mcpAuth and needs-auth; the next status replaces it.
{
  const text = 'MCP tool catalog changed before tool "x" could be invoked: Failed to verify cached MCP tools: MCP OAuth challenge required (HTTP 401)';
  const out = run([
    { type: 'session.mcp_servers_loaded', data: { servers: [{ name: 'srv', status: 'connected', source: 'user' }] } },
    { type: 'tool.execution_start', data: { toolCallId: 'a', toolName: 'srv-x', mcpServerName: 'srv', mcpToolName: 'x', arguments: {} } },
    { type: 'tool.execution_complete', data: { toolCallId: 'a', success: false, error: { message: text } } },
    { type: 'session.mcp_server_status_changed', data: { serverName: 'srv', status: 'connected', remediation: 'x' } },
    { type: 'tool.execution_start', data: { toolCallId: 'b', toolName: 'view', arguments: {} } },
    { type: 'tool.execution_complete', data: { toolCallId: 'b', success: false, error: { message: text } } },
    { type: 'tool.execution_start', data: { toolCallId: 'c', toolName: 'srv-x', mcpServerName: 'srv', mcpToolName: 'x', arguments: {} } },
    { type: 'tool.execution_complete', data: { toolCallId: 'c', success: false, error: { message: 'HTTP 500 boom' } } },
    { type: 'tool.execution_start', data: { toolCallId: 'd', toolName: 'srv-x', mcpServerName: 'srv', mcpToolName: 'x', arguments: {} } },
    { type: 'tool.execution_complete', data: { toolCallId: 'd', success: true, result: { content: text } } },
  ]);
  const failed = out.filter((e) => e.type === 'toolCall' && (e as { phase: string }).phase !== 'start') as { callId: string; mcpAuth?: boolean }[];
  assert.deepStrictEqual(failed.map((f) => [f.callId, f.mcpAuth]), [['a', true], ['b', undefined], ['c', undefined], ['d', undefined]]);
  const ms = out.filter((e) => e.type === 'mcp') as { servers: { name: string; status: string; errorClass?: string; source?: string }[] }[];
  assert.strictEqual(ms.length, 3, 'loaded, needs-auth, next status; non-matching failures and a successful call quoting the text emit no list');
  assert.deepStrictEqual([ms[1].servers[0].status, ms[1].servers[0].errorClass, ms[1].servers[0].source], ['needs-auth', 'auth', 'user']);
  assert.deepStrictEqual([ms[2].servers[0].status, ms[2].servers[0].errorClass], ['connected', undefined], 'next runtime status replaces it');
}
// Credit cap events (spec 011). Shapes are taken from the SDK 1.0.22 type definitions (session-events.d.ts), NOT recorded from a real session.
{
  const out = run([
    { type: 'session.session_limits_changed', data: { sessionLimits: { maxAiCredits: 0.5 } } },
    { type: 'session_limits_exhausted.requested', agentId: 'inst-1', data: { requestId: 'q1', maxAiCredits: 0.5, usedAiCredits: 0.52 } },
    { type: 'session_limits_exhausted.completed', data: { requestId: 'q1', response: { action: 'add', additionalAiCredits: 1 } } },
    { type: 'session.session_limits_changed', data: { sessionLimits: null } },
    { type: 'session_limits_exhausted.requested', data: { maxAiCredits: 1 } }, // no request id: cannot be answered, ignored
  ]);
  assert.deepStrictEqual(out, [
    { type: 'limit', phase: 'changed', maxAiCredits: 0.5 },
    { type: 'limit', phase: 'exhausted', requestId: 'q1', maxAiCredits: 0.5, usedAiCredits: 0.52 },
    { type: 'limit', phase: 'resolved', requestId: 'q1', action: 'add' },
    { type: 'limit', phase: 'changed', maxAiCredits: null },
  ]);
  assert.ok(out.every((e) => e.agentId === undefined), 'a limit is the session\'s, never a sub-agent\'s');
}

// Model and compaction events (spec 030). SYNTHETIC: shapes follow the SDK 1.0.22 type definitions (session-events.d.ts), NOT recorded from a real session (provenance: synthetic).
{
  const out: EventBody[] = [];
  const m = new EventMapper((b) => out.push(b));
  m.map({ type: 'session.usage_info', data: { currentTokens: 100, tokenLimit: 1000 } }); // before any model event: no model/tier on the context event
  m.expectUserModel('sim-deep');
  m.map({ type: 'session.model_change', data: { newModel: 'sim-deep', previousModel: 'auto', reasoningEffort: 'high', previousReasoningEffort: 'medium', contextTier: 'long_context' } });
  m.map({ type: 'session.model_change', data: { newModel: 'sim-fast', previousModel: 'sim-deep', cause: 'rate_limit_auto_switch', contextTier: 'default' } });
  m.map({ type: 'session.model_change', data: { newModel: 'sim-mid', previousModel: 'sim-fast', cause: 'refusal_fallback' } });
  m.map({ type: 'session.model_change', data: { newModel: 'gpt-x', previousModel: 'sim-mid' } }); // nobody asked: the runtime did it
  m.map({ type: 'session.model_change', agentId: 'inst-1', data: { newModel: 'helper-model' } }); // a sub-agent's model is not the session's
  m.map({ type: 'session.model_change', data: { previousModel: 'x' } }); // no new model: ignored
  m.map({ type: 'session.usage_info', data: { currentTokens: 200, tokenLimit: 2000 } });
  assert.deepStrictEqual(out[0], { type: 'context', tokens: 100, limit: 1000, system: undefined, conversation: undefined, toolDefinitions: undefined, messages: undefined });
  assert.deepStrictEqual(out[1], { type: 'model', model: 'sim-deep', previousModel: 'auto', effort: 'high', previousEffort: 'medium', tier: 'long', cause: 'user' });
  assert.strictEqual((out[2] as { cause: string }).cause, 'rate-limit');
  assert.strictEqual((out[2] as { tier?: string }).tier, 'default');
  assert.strictEqual((out[3] as { cause: string }).cause, 'fallback');
  assert.strictEqual((out[4] as { cause: string }).cause, 'runtime');
  assert.strictEqual(out.filter((e) => e.type === 'model').length, 4, 'sub-agent and incomplete changes are skipped');
  const ctx = out[5] as { model?: string; tier?: string };
  assert.strictEqual(ctx.model, 'gpt-x', 'context events carry the model last reported');
  assert.strictEqual(ctx.tier, undefined);
}
{
  const out = run([
    { type: 'session.compaction_start', data: { trigger: 'threshold', currentTokens: 900, tokenLimit: 1000 } },
    { type: 'session.compaction_complete', data: { success: true, preCompactionTokens: 900, postCompactionTokens: 250, tokenLimit: 1000, summaryContent: 'SECRET SUMMARY', customInstructions: 'focus text' } },
    { type: 'session.compaction_start', data: { trigger: 'manual', currentTokens: 500 } },
    { type: 'session.compaction_complete', data: { success: false, error: 'model refused' } },
    { type: 'session.compaction_start', agentId: 'inst-1', data: { trigger: 'threshold' } }, // sub-agent: skipped
    { type: 'session.compaction_start', data: { trigger: 'model_switch' } },
    { type: 'session.compaction_complete', data: { success: true, preCompactionTokens: 10, postCompactionTokens: 20 } },
    { type: 'session.compaction_start', data: { trigger: 'context_limit_retry' } },
  ]);
  assert.deepStrictEqual(out, [
    { type: 'compaction', phase: 'start', trigger: 'auto', tokensBefore: 900, limit: 1000 },
    { type: 'compaction', phase: 'complete', trigger: 'auto', tokensBefore: 900, tokensAfter: 250, tokensRemoved: 650, limit: 1000 },
    { type: 'compaction', phase: 'start', trigger: 'manual', tokensBefore: 500, limit: undefined },
    { type: 'compaction', phase: 'failed', trigger: 'manual', tokensBefore: undefined, limit: undefined, error: 'model refused' },
    { type: 'compaction', phase: 'start', trigger: 'model-switch', tokensBefore: undefined, limit: undefined },
    { type: 'compaction', phase: 'complete', trigger: 'model-switch', tokensBefore: 10, tokensAfter: 20, tokensRemoved: 0, limit: undefined },
    { type: 'compaction', phase: 'start', trigger: 'overflow', tokensBefore: undefined, limit: undefined },
  ]);
  assert.ok(!JSON.stringify(out).includes('SECRET'), 'the summary and the focus text never leave the mapper');
}

// Issue #126: the main agent's session title (spec 002 delta 2026-10-18)
{
  const out = run([
    { type: 'session.title_changed', data: { title: '  Fix the\nlogin   bug\u200B  ' } },
    { type: 'session.title_changed', data: { title: 'Helper title' }, agentId: 'sub-1' },
    { type: 'session.title_changed', data: { title: '   ' } },
    { type: 'session.title_changed', data: {} },
    { type: 'session.title_changed', data: { title: 'x'.repeat(200) } },
  ] as RawEvent[]);
  const titles = out.filter((e) => e.type === 'title') as Array<{ title: string; agentId?: string }>;
  assert.strictEqual(titles.length, 2, 'a sub-agent title and empty titles are dropped');
  assert.strictEqual(titles[0].title, 'Fix the login bug', 'one line, collapsed, hidden characters removed');
  assert.strictEqual(titles[0].agentId, undefined, 'top level');
  assert.ok(titles[1].title.length === 80 && titles[1].title.endsWith('…'), 'at most 80 characters with an ellipsis');
}

// spec 002 FR-016 (T024): an idle (here after Stop) drops the turn's tool names and reasoning ids
{
  const out: EventBody[] = [];
  const m = new EventMapper((b) => out.push(b));
  const ev = (type: string, data: Record<string, unknown>): void => m.map({ type, data } as unknown as RawEvent);
  ev('tool.execution_start', { toolCallId: 't1', toolName: 'bash', arguments: { command: 'sleep 9' } });
  ev('assistant.reasoning_delta', { reasoningId: 'r1', deltaContent: 'thinking…' });
  ev('session.idle', { aborted: true });
  const internals = m as unknown as { toolNames: Map<string, unknown>; reasoningSeen: Set<string> };
  assert.strictEqual(internals.toolNames.size, 0, 'tool names of the stopped turn are gone');
  assert.strictEqual(internals.reasoningSeen.size, 0, 'reasoning ids of the stopped turn are gone');
  assert.ok(out.some((e) => e.type === 'status' && e.status === 'idle' && e.intent === 'Aborted'));
}
// spec 044 FR-016: the session's own scheduled prompts (Copilot /every, /after, manage_schedule) become read-only agentSchedule events
{
  const out: EventBody[] = [];
  const m = new EventMapper((b) => out.push(b));
  const ev = (type: string, data: Record<string, unknown>, agentId?: string): void => m.map({ type, data, agentId } as unknown as RawEvent);
  ev('session.schedule_created', { id: 1, prompt: 'check CI\nnow', intervalMs: 600000, recurring: true, origin: 'user' });
  ev('session.schedule_created', { id: 2, prompt: 'x'.repeat(500), displayPrompt: '/standup', cron: '0 9 * * 1-5', tz: 'Europe/Zurich', origin: 'model' });
  ev('session.schedule_created', { id: 3, prompt: 'p', selfPaced: true, intervalMs: -5, origin: 'robot' });
  ev('session.schedule_created', { id: 4, prompt: 'helper' }, 'sub-1');
  ev('session.schedule_created', { prompt: 'no id' });
  ev('session.schedule_rearmed', { id: 3, nextRunAt: 1_800_000_000_000 });
  ev('session.schedule_cancelled', { id: 1 });
  const s = out.filter((e): e is Extract<EventBody, { type: 'agentSchedule' }> => e.type === 'agentSchedule');
  assert.strictEqual(s.length, 5, 'a helper\'s schedule and one without an id are dropped');
  assert.deepStrictEqual(s[0], { type: 'agentSchedule', phase: 'created', scheduleId: '1', prompt: 'check CI now', everyMs: 600000, recurring: true, origin: 'user' });
  assert.deepStrictEqual([s[1].prompt, s[1].cron, s[1].tz, s[1].origin], ['/standup', '0 9 * * 1-5', 'Europe/Zurich', 'model'], 'the app\'s short label is preferred');
  assert.deepStrictEqual([s[2].selfPaced, s[2].everyMs, s[2].origin], [true, undefined, undefined], 'bad values are dropped');
  assert.deepStrictEqual(s[3], { type: 'agentSchedule', phase: 'rearmed', scheduleId: '3', nextAt: 1_800_000_000_000 });
  assert.deepStrictEqual(s[4], { type: 'agentSchedule', phase: 'cancelled', scheduleId: '1' });
  for (const e of s) assert.deepStrictEqual(eventProblems({ ...e, sessionId: 's', timestamp: 1 }), [], 'passes the event guard');
  assert.ok(eventProblems({ type: 'agentSchedule', sessionId: 's', timestamp: 1, phase: 'made', scheduleId: '' }).length >= 2);
}
console.log('event mapping tests passed');

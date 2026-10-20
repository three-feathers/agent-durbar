/**
 * A runtime check of normalized events (spec 010 FR-010, T023): what every producer (the real adapters, the simulator) must send
 * so the renderer can rely on it. Pure; returns the problems found (none = valid). Shared by the simulator contract test and the
 * adapter tests, so the simulator cannot drift from the event shapes without a failing test.
 */
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): boolean => typeof v === 'string';
const optStr = (v: unknown): boolean => v === undefined || typeof v === 'string';
const optNum = (v: unknown): boolean => v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
const oneOf = (v: unknown, xs: readonly string[]): boolean => typeof v === 'string' && xs.includes(v);

export const EVENT_TYPES = ['user', 'question', 'agentProfile', 'status', 'permission', 'grants', 'thinking', 'output', 'toolCall', 'subagent', 'usage', 'context', 'model', 'compaction', 'mcp', 'limit', 'title'] as const;
const STATUSES = ['idle', 'working', 'needs-permission', 'error', 'stopped'] as const;

function permissionProblems(p: unknown, where: string): string[] {
  if (!isObj(p)) return [`${where}: not an object`];
  const out: string[] = [];
  if (!str(p.requestId) || !p.requestId) out.push(`${where}.requestId missing`);
  if (!str(p.kind)) out.push(`${where}.kind missing`);
  if (!str(p.summary)) out.push(`${where}.summary missing`);
  if (!oneOf(p.state, ['pending', 'approved', 'denied'])) out.push(`${where}.state is ${String(p.state)}`);
  return out;
}

export function eventProblems(e: unknown): string[] {
  if (!isObj(e)) return ['not an object'];
  const t = e.type;
  if (!oneOf(t, EVENT_TYPES)) return [`unknown type ${String(t)}`];
  const out: string[] = [];
  if (!str(e.sessionId) || !e.sessionId) out.push('sessionId missing');
  if (typeof e.timestamp !== 'number' || !Number.isFinite(e.timestamp)) out.push('timestamp missing');
  if (!optStr(e.agentId)) out.push('agentId is not a string');
  switch (t) {
    case 'status':
      if (!oneOf(e.status, STATUSES)) out.push(`status ${String(e.status)}`);
      if (!optStr(e.intent)) out.push('intent is not a string');
      if (e.permission !== undefined) out.push(...permissionProblems(e.permission, 'permission'));
      break;
    case 'permission':
      out.push(...permissionProblems(e.permission, 'permission'));
      break;
    case 'grants':
      if (!Array.isArray(e.grants) || e.grants.some((g) => !isObj(g) || !str(g.key) || !str(g.label))) out.push('grants malformed');
      break;
    case 'thinking':
      if (!str(e.delta)) out.push('thinking.delta missing');
      break;
    case 'output':
      if (!str(e.delta) && !str(e.text)) out.push('output has neither delta nor text');
      break;
    case 'toolCall':
      if (!str(e.callId) || !e.callId) out.push('toolCall.callId missing');
      if (!str(e.tool)) out.push('toolCall.tool missing');
      if (!oneOf(e.phase, ['start', 'update', 'complete', 'failed'])) out.push(`toolCall.phase ${String(e.phase)}`);
      if (!optStr(e.output)) out.push('toolCall.output is not a string');
      break;
    case 'subagent':
      if (!str(e.subagentId) || !e.subagentId) out.push('subagent.subagentId missing');
      if (!oneOf(e.phase, ['started', 'completed', 'failed'])) out.push(`subagent.phase ${String(e.phase)}`);
      break;
    case 'usage':
      for (const k of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'nanoAiu', 'costUsd']) if (!optNum(e[k])) out.push(`usage.${k} is not a non-negative number`);
      if (e.costUsd !== undefined && e.costBasis !== 'estimate') out.push('usage.costUsd without costBasis estimate');
      break;
    case 'context':
      if (!optNum(e.tokens) || e.tokens === undefined) out.push('context.tokens missing');
      if (!optNum(e.limit) || e.limit === undefined) out.push('context.limit missing');
      break;
    case 'model':
      if (!str(e.model)) out.push('model.model missing');
      break;
    case 'compaction':
      if (!oneOf(e.phase, ['start', 'complete', 'failed'])) out.push(`compaction.phase ${String(e.phase)}`);
      break;
    case 'mcp':
      if (!Array.isArray(e.servers) || e.servers.some((s) => !isObj(s) || !str(s.name) || !str(s.status))) out.push('mcp.servers malformed');
      break;
    case 'limit':
      if (!oneOf(e.phase, ['exhausted', 'changed', 'resolved'])) out.push(`limit.phase ${String(e.phase)}`);
      break;
    case 'title':
      if (!str(e.title) || !e.title) out.push('title.title missing');
      break;
    case 'user':
      if (!str(e.text)) out.push('user.text missing');
      break;
    case 'question':
      if (!oneOf(e.phase, ['asked', 'answered', 'cancelled'])) out.push(`question.phase ${String(e.phase)}`);
      if (!str(e.requestId) || !e.requestId) out.push('question.requestId missing');
      if (e.phase === 'asked' && (!Array.isArray(e.questions) || !e.questions.length || e.questions.some((q) => !isObj(q) || !str(q.question) || !Array.isArray(q.options)))) out.push('question.questions malformed');
      if (e.elicitation !== undefined && (!isObj(e.elicitation) || !str(e.elicitation.message) || !(Array.isArray(e.elicitation.fields) || str(e.elicitation.url)))) out.push('question.elicitation malformed');
      if (e.elicitAction !== undefined && !oneOf(e.elicitAction, ['accept', 'decline', 'cancel'])) out.push(`question.elicitAction ${String(e.elicitAction)}`);
      break;
    case 'agentProfile':
      if (e.profile !== null && (!isObj(e.profile) || !str(e.profile.id) || !str(e.profile.name) || !oneOf(e.profile.source, ['repo', 'user', 'other']))) out.push('agentProfile.profile malformed');
      break;
  }
  return out;
}

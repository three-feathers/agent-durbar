import { ALLOWED_BY_KEYS_MAX } from './types';
import { isObj } from '../shared/guards';
import { cleanSandboxState } from '../shared/sandbox';
/**
 * A runtime check of normalized events (spec 010 FR-010, T023): what every producer (the real adapters, the simulator) must send
 * so the renderer can rely on it. Pure; returns the problems found (none = valid). Shared by the simulator contract test and the
 * adapter tests, so the simulator cannot drift from the event shapes without a failing test.
 */
const str = (v: unknown): boolean => typeof v === 'string';
const optStr = (v: unknown): boolean => v === undefined || typeof v === 'string';
const optNum = (v: unknown): boolean => v === undefined || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
const oneOf = (v: unknown, xs: readonly string[]): boolean => typeof v === 'string' && xs.includes(v);

export const EVENT_TYPES = ['user', 'question', 'agentProfile', 'status', 'permission', 'grants', 'thinking', 'output', 'toolCall', 'subagent', 'usage', 'context', 'model', 'compaction', 'mcp', 'limit', 'usageLimit', 'retry', 'title', 'agentSchedule', 'remote', 'plan', 'sandbox'] as const;
const RETRY_REASONS = ['rate-limit', 'overloaded', 'server', 'network', 'timeout', 'auth', 'other'] as const;
const STATUSES = ['idle', 'working', 'needs-permission', 'error', 'stopped'] as const;
/** Spec 058 FR-180: the values of `McpServerStatus.signInEnd`. */
export const SIGN_IN_ENDS = ['next-message', 'failed'] as const;
/** Spec 058 FR-180: a `signInEnd` main accepts (anything else is ignored, as if missing). */
export const validSignInEnd = (v: unknown): v is (typeof SIGN_IN_ENDS)[number] => oneOf(v, SIGN_IN_ENDS);

/** Spec 003 FR-110: longest permission `requestId` (a tool call id); the window keeps it as a map key. */
export const REQUEST_ID_MAX = 256;

/** Spec 003 FR-102: the optional `allowedBy` of a permission (display only): a known kind and string fields, else the event is refused. */
function allowedByProblems(a: unknown, where: string): string[] {
  if (!isObj(a)) return [`${where}: not an object`];
  if (a.kind === 'session-grant') {
    if (!(str(a.key) && a.key && str(a.label))) return [`${where}: session-grant needs a key and a label`];
    if (a.keys !== undefined && (!Array.isArray(a.keys) || a.keys.length < 1 || a.keys.length > ALLOWED_BY_KEYS_MAX || a.keys.some((k) => !str(k) || !k))) return [`${where}: session-grant keys malformed`];
    if (a.more !== undefined && !(typeof a.more === 'number' && Number.isInteger(a.more) && a.more >= 1 && a.more <= 100000)) return [`${where}: session-grant more malformed`];
    if (a.noUndo !== undefined && a.noUndo !== true) return [`${where}: session-grant noUndo malformed`];
    return [];
  }
  if (a.kind === 'allow-all' || a.kind === 'in-folder' || a.kind === 'attachment') return [];
  if (a.kind === 'app') return oneOf(a.source, ['config', 'hook', 'classifier']) ? [] : [`${where}: app source ${String(a.source)}`];
  return [`${where}.kind is ${String(a.kind)}`];
}

function permissionProblems(p: unknown, where: string): string[] {
  if (!isObj(p)) return [`${where}: not an object`];
  const out: string[] = [];
  if (!str(p.requestId) || !p.requestId) out.push(`${where}.requestId missing`);
  else if ((p.requestId as string).length > REQUEST_ID_MAX) out.push(`${where}.requestId too long`);
  if (!str(p.kind)) out.push(`${where}.kind missing`);
  if (!str(p.summary)) out.push(`${where}.summary missing`);
  if (!oneOf(p.state, ['pending', 'approved', 'denied'])) out.push(`${where}.state is ${String(p.state)}`);
  if (p.allowedBy !== undefined) out.push(...allowedByProblems(p.allowedBy, `${where}.allowedBy`));
  return out;
}

/** Spec 005 FR-018: the optional `edit` of a toolCall. */
function editProblems(x: unknown): string[] {
  if (!isObj(x) || !Array.isArray(x.files) || !x.files.length) return ['toolCall.edit has no files'];
  const out: string[] = [];
  x.files.forEach((f, i) => {
    if (!isObj(f) || !str(f.path) || !f.path) out.push(`toolCall.edit.files[${i}].path missing`);
    else {
      if (!oneOf(f.kind, ['edit', 'create', 'write', 'delete', 'move'])) out.push(`toolCall.edit.files[${i}].kind ${String(f.kind)}`);
      if (!optStr(f.diff) || !optNum(f.added) || !optNum(f.removed) || !optStr(f.movedTo)) out.push(`toolCall.edit.files[${i}] malformed`);
    }
  });
  if (x.partial !== undefined && typeof x.partial !== 'boolean') out.push('toolCall.edit.partial is not a boolean');
  if (!optNum(x.more)) out.push('toolCall.edit.more is not a number');
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
      if (e.errorKind !== undefined && (e.errorKind !== 'auth' || e.status !== 'error')) out.push(`errorKind ${String(e.errorKind)} on status ${String(e.status)}`);
      if (e.reason !== undefined && (e.reason !== 'usage-limit' || e.status !== 'idle')) out.push(`reason ${String(e.reason)} on status ${String(e.status)}`);
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
      if (e.edit !== undefined) out.push(...editProblems(e.edit));
      if (e.mcpAuth !== undefined && (e.mcpAuth !== true || e.phase !== 'failed' || !str(e.mcpServer) || !e.mcpServer)) out.push(`toolCall.mcpAuth on phase ${String(e.phase)} without a failed MCP call`);
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
      // spec 015 FR-006 (issue #601): the trigger is one of the normalized words and every number is a count
      if (!oneOf(e.trigger, ['auto', 'manual', 'model-switch', 'overflow', 'truncation', 'unknown'])) out.push(`compaction.trigger ${String(e.trigger)}`);
      for (const k of ['tokensBefore', 'tokensAfter', 'tokensRemoved', 'limit']) if (!optNum(e[k])) out.push(`compaction.${k} is not a non-negative number`);
      if (!optStr(e.error)) out.push('compaction.error is not a string');
      break;
    case 'mcp':
      if (!Array.isArray(e.servers) || e.servers.some((s) => !isObj(s) || !str(s.name) || !str(s.status))) out.push('mcp.servers malformed');
      // spec 058 FR-180: only the two normalized ends of a sign-in the adapter started
      else if (e.servers.some((s) => isObj(s) && s.signInEnd !== undefined && !oneOf(s.signInEnd, SIGN_IN_ENDS))) out.push('mcp.servers[].signInEnd is not next-message or failed');
      break;
    case 'limit':
      if (!oneOf(e.phase, ['exhausted', 'changed', 'resolved'])) out.push(`limit.phase ${String(e.phase)}`);
      break;
    case 'usageLimit':
      if (!oneOf(e.scope, ['plan', 'quota', 'rate'])) out.push(`usageLimit.scope ${String(e.scope)}`);
      if (e.resetsAt !== undefined && !(typeof e.resetsAt === 'number' && Number.isFinite(e.resetsAt) && e.resetsAt > 0)) out.push('usageLimit.resetsAt is not a positive time');
      if (!str(e.source) || !e.source || String(e.source).length > 60) out.push('usageLimit.source missing or too long');
      if (e.estimated !== undefined && typeof e.estimated !== 'boolean') out.push('usageLimit.estimated is not a boolean');
      if (e.paid !== undefined && typeof e.paid !== 'boolean') out.push('usageLimit.paid is not a boolean');
      if (e.update !== undefined && typeof e.update !== 'boolean') out.push('usageLimit.update is not a boolean');
      break;
    case 'retry': // spec 034 FR-016
      if (!oneOf(e.phase, ['retrying', 'gave-up'])) out.push(`retry.phase ${String(e.phase)}`);
      if (!(Number.isInteger(e.attempt) && (e.attempt as number) >= 1)) out.push('retry.attempt is not a positive whole number');
      if (e.maxAttempts !== undefined && !(Number.isInteger(e.maxAttempts) && (e.maxAttempts as number) >= 1)) out.push('retry.maxAttempts is not a positive whole number');
      if (!oneOf(e.reason, RETRY_REASONS)) out.push(`retry.reason ${String(e.reason)}`);
      if (e.httpStatus !== undefined && !(Number.isInteger(e.httpStatus) && (e.httpStatus as number) >= 100 && (e.httpStatus as number) <= 599)) out.push('retry.httpStatus is not an HTTP status');
      if (!optNum(e.delayMs)) out.push('retry.delayMs is not a non-negative number');
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
    case 'plan':
      if (!oneOf(e.phase, ['proposed', 'resolved'])) out.push(`plan.phase ${String(e.phase)}`);
      if (!str(e.requestId) || !e.requestId) out.push('plan.requestId missing');
      if (!optStr(e.text)) out.push('plan.text is not a string');
      if (e.action !== undefined && !oneOf(e.action, ['approve', 'reject', 'revise'])) out.push(`plan.action ${String(e.action)}`);
      break;
    case 'remote':
      if (typeof e.on !== 'boolean') out.push('remote.on is not a boolean');
      if (!optStr(e.reason)) out.push('remote.reason is not a string');
      if (!optStr(e.url)) out.push('remote.url is not a string');
      break;
    case 'sandbox': // spec 087 FR-011
      if (e.sandbox !== null && !cleanSandboxState(e.sandbox)) out.push('sandbox.sandbox malformed');
      if (e.notice !== undefined && (!isObj(e.notice) || !str(e.notice.text) || !e.notice.text || !Array.isArray(e.notice.actions) || e.notice.actions.some((a) => a !== 'continue' && a !== 'always') || (e.notice.refused !== undefined && typeof e.notice.refused !== 'boolean'))) out.push('sandbox.notice malformed');
      if (isObj(e.notice) && e.notice.refused === true && Array.isArray(e.notice.actions) && e.notice.actions.length) out.push('sandbox.notice refused with actions');
      if (e.notLowered !== undefined && e.notLowered !== true) out.push('sandbox.notLowered is not true');
      break;
    case 'agentSchedule':
      if (!oneOf(e.phase, ['created', 'cancelled', 'rearmed'])) out.push(`agentSchedule.phase ${String(e.phase)}`);
      if (!str(e.scheduleId) || !e.scheduleId) out.push('agentSchedule.scheduleId missing');
      for (const k of ['everyMs', 'at', 'nextAt']) if (!optNum(e[k])) out.push(`agentSchedule.${k} is not a non-negative number`);
      if (!optStr(e.prompt) || !optStr(e.cron) || !optStr(e.tz)) out.push('agentSchedule text is not a string');
      break;
    case 'agentProfile':
      if (e.profile !== null && (!isObj(e.profile) || !str(e.profile.id) || !str(e.profile.name) || !oneOf(e.profile.source, ['repo', 'user', 'other']))) out.push('agentProfile.profile malformed');
      break;
  }
  return out;
}

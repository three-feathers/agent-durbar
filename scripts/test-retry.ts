/**
 * Spec 034 FR-016..FR-021 (issue #600): "Retrying" while the agent app retries the model API. `npm run test:retry`. No credits.
 * The vendor shapes are synthetic, written from the sources named in `src/adapters/retry.ts` (`read:` only, no real retry seen).
 */
import * as assert from 'assert';
import * as path from 'path';
import { ClaudeMapper } from '../src/adapters/claudeMap';
import { CodexMapper } from '../src/adapters/codexMap';
import { EventMapper } from '../src/adapters/map';
import type { EventBody } from '../src/adapters/map';
import { RetryTracker, claudeRetry, codexRetry, copilotRetry, reasonOfStatus } from '../src/adapters/retry';
import { eventProblems } from '../src/adapters/eventguard';

type St = { attempt?: number; max?: number; reason?: string; status?: number } | null;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const R = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'retry.js')) as {
  REASONS: Record<string, string>;
  LINE_RE: RegExp;
  retryLine(s: unknown): string;
  gaveUpLine(s: unknown): string;
  wentThroughLine(s: unknown): string;
  endedLine(s: unknown, why?: string): string;
  noteLine(s: unknown): string;
  next(prev: St, e: unknown): { state: St; action: string | null; info?: St };
};

const valid = (bodies: EventBody[]): void => {
  for (const b of bodies) assert.deepStrictEqual(eventProblems({ ...b, sessionId: 's', timestamp: 1 }), [], JSON.stringify(b));
};
const kinds = (o: EventBody[]): string[] => o.map((e) => (e.type === 'retry' ? `retry:${e.phase}:${e.attempt}:${e.reason}${e.httpStatus ? ':' + e.httpStatus : ''}` : e.type === 'status' ? `status:${e.status}` : e.type));

// 1. Claude Code `api_retry`: each `error` category, the numbers, and anything else is not a retry
{
  const m = (o: Record<string, unknown>): Record<string, unknown> => ({ type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 10, retry_delay_ms: 4000, error_status: 529, error: 'overloaded', ...o });
  assert.deepStrictEqual(claudeRetry(m({})), { reason: 'overloaded', attempt: 2, max: 10, status: 529, delayMs: 4000 });
  assert.strictEqual(claudeRetry(m({ error: 'rate_limit', error_status: 429 }))?.reason, 'rate-limit');
  assert.strictEqual(claudeRetry(m({ error: 'server_error', error_status: 500 }))?.reason, 'server');
  assert.strictEqual(claudeRetry(m({ error: 'server_error', error_status: 504 }))?.reason, 'timeout', 'a gateway timeout is a timeout');
  assert.strictEqual(claudeRetry(m({ error: 'authentication_failed', error_status: 401 }))?.reason, 'auth');
  assert.strictEqual(claudeRetry(m({ error: 'cloud_credential_error', error_status: null }))?.reason, 'auth');
  assert.strictEqual(claudeRetry(m({ error: 'unknown', error_status: null, no_response: { waited_ms: 1 } }))?.reason, 'timeout', 'no answer at all');
  assert.strictEqual(claudeRetry(m({ error: 'unknown', error_status: null }))?.reason, 'other');
  assert.strictEqual(claudeRetry(m({ error: 'something new', error_status: 503 }))?.reason, 'overloaded', 'a new category falls back on the status');
  // bad numbers are left out, never guessed
  const bad = claudeRetry(m({ attempt: 0, max_retries: -1, error_status: 42, retry_delay_ms: -5 }));
  assert.deepStrictEqual(bad, { reason: 'overloaded', attempt: undefined, max: undefined, status: undefined, delayMs: undefined });
  assert.strictEqual(claudeRetry(m({ attempt: 2.5 }))?.attempt, undefined);
  assert.strictEqual(claudeRetry(m({ error_status: '529' }))?.status, undefined, 'a status that is text is not a number');
  for (const x of [null, 1, 'api_retry', { type: 'system', subtype: 'init' }, { type: 'assistant', subtype: 'api_retry' }]) assert.strictEqual(claudeRetry(x), null);
  // inherited keys are not read
  assert.strictEqual(claudeRetry(Object.create({ type: 'system', subtype: 'api_retry' })), null);
}

// 2. Codex `error` with `willRetry`: the kinds (schema camelCase and the fixtures' PascalCase), the status, only when it will retry
{
  const p = (info: unknown, willRetry: unknown = true): Record<string, unknown> => ({ threadId: 'th', turnId: 't', willRetry, error: { message: 'Reconnecting... 2/5', codexErrorInfo: info, additionalDetails: null } });
  assert.deepStrictEqual(codexRetry(p('rateLimitExceeded')), { reason: 'rate-limit', status: undefined });
  assert.strictEqual(codexRetry(p('RateLimitExceeded'))?.reason, 'rate-limit');
  assert.strictEqual(codexRetry(p('serverOverloaded'))?.reason, 'overloaded');
  assert.strictEqual(codexRetry(p('internalServerError'))?.reason, 'server');
  assert.deepStrictEqual(codexRetry(p({ responseStreamDisconnected: { httpStatusCode: null } })), { reason: 'network', status: undefined });
  assert.deepStrictEqual(codexRetry(p({ httpConnectionFailed: { httpStatusCode: 503 } })), { reason: 'overloaded', status: 503 });
  assert.deepStrictEqual(codexRetry(p({ ResponseStreamConnectionFailed: { httpStatusCode: 429 } })), { reason: 'rate-limit', status: 429 });
  assert.strictEqual(codexRetry(p('unauthorized'))?.reason, 'auth');
  assert.strictEqual(codexRetry(p('other'))?.reason, 'other');
  assert.strictEqual(codexRetry(p(null))?.reason, 'other');
  assert.strictEqual(codexRetry(p('rateLimitExceeded', false)), null, 'willRetry false: the turn fails, no retry');
  assert.strictEqual(codexRetry(p('rateLimitExceeded', 'true')), null, 'only the boolean true');
  assert.strictEqual(codexRetry(null), null);
}

// 3. Copilot `model.call_failure`: the top-level agent's retried calls only
{
  const d = (o: Record<string, unknown>): Record<string, unknown> => ({ source: 'top_level', failureKind: 'api', statusCode: 429, retryAttempt: 0, errorMessage: 'ghp_' + 'a'.repeat(36), ...o });
  assert.deepStrictEqual(copilotRetry(d({})), { reason: 'rate-limit', attempt: 1, status: 429 }, 'retryAttempt is zero-based: the first failed call is retry 1');
  assert.strictEqual(copilotRetry(d({ retryAttempt: 2 }))?.attempt, 3);
  assert.strictEqual(copilotRetry(d({ retryAttempt: -1 }))?.attempt, undefined);
  assert.strictEqual(copilotRetry(d({ statusCode: 503 }))?.reason, 'overloaded');
  assert.strictEqual(copilotRetry(d({ statusCode: 500 }))?.reason, 'server');
  assert.strictEqual(copilotRetry(d({ statusCode: 408 }))?.reason, 'timeout');
  assert.deepStrictEqual(copilotRetry(d({ failureKind: 'transport', statusCode: undefined })), { reason: 'network', attempt: 1, status: undefined });
  assert.strictEqual(copilotRetry(d({ statusCode: undefined }))?.reason, 'other');
  for (const s of [400, 401, 403, 404, 413, 422]) assert.strictEqual(copilotRetry(d({ statusCode: s })), null, `${s} is not retried`);
  assert.strictEqual(copilotRetry(d({ source: 'subagent' })), null, 'a helper');
  assert.strictEqual(copilotRetry(d({ source: 'mcp_sampling' })), null);
  assert.ok(!JSON.stringify(copilotRetry(d({}))).includes('ghp_'), 'the provider message never leaves');
}
assert.strictEqual(reasonOfStatus(undefined), 'other');
assert.strictEqual(reasonOfStatus(429), 'rate-limit');
assert.strictEqual(reasonOfStatus(529), 'overloaded');
assert.strictEqual(reasonOfStatus(502), 'server');
assert.strictEqual(reasonOfStatus(418), 'other');

// 4. The tracker: numbering, progress, one gave-up
{
  const t = new RetryTracker();
  assert.strictEqual(t.gaveUp(), undefined, 'no retry, no gave-up');
  assert.strictEqual(t.retry({ reason: 'network' }).attempt, 1);
  assert.strictEqual(t.retry({ reason: 'network' }).attempt, 2, 'counted when the app does not number');
  assert.ok(t.active);
  t.progress();
  assert.ok(!t.active);
  assert.strictEqual(t.retry({ reason: 'network' }).attempt, 1, 'a new run starts at 1');
  const r = t.retry({ reason: 'overloaded', attempt: 5, max: 10, status: 529, delayMs: 100 });
  assert.deepStrictEqual(r, { type: 'retry', phase: 'retrying', attempt: 5, reason: 'overloaded', maxAttempts: 10, httpStatus: 529, delayMs: 100 });
  assert.deepStrictEqual(t.gaveUp(), { type: 'retry', phase: 'gave-up', attempt: 5, reason: 'overloaded', httpStatus: 529 });
  assert.strictEqual(t.gaveUp(), undefined, 'never twice');
  assert.strictEqual(t.retry({ reason: 'other', attempt: 4, max: 3 }).maxAttempts, undefined, 'a max below the attempt is dropped');
  t.reset();
  assert.strictEqual(t.gaveUp(), undefined);
  // the cap: 1001 un-numbered retries stop counting at 1000 (the guard's and the renderer's limit)
  const big = new RetryTracker();
  let last = 0;
  for (let k = 0; k < 1001; k++) last = big.retry({ reason: 'network' }).attempt;
  assert.strictEqual(last, 1000);
  assert.strictEqual(big.gaveUp()?.attempt, 1000);
}

/** The keys a retry event may have: nothing else (no provider text can ride along). */
const RETRY_KEYS = new Set(['type', 'phase', 'attempt', 'maxAttempts', 'reason', 'httpStatus', 'delayMs']);
const TOKEN = 'ghp_' + 'Z'.repeat(36);
const clean = (o: EventBody[], what: string): void => {
  for (const e of o) {
    assert.ok(!JSON.stringify(e).includes('ghp_'), `${what}: no provider text in ${JSON.stringify(e)}`);
    if (e.type === 'retry') for (const k of Object.keys(e)) assert.ok(RETRY_KEYS.has(k), `${what}: unexpected key ${k}`);
  }
};
/** What the renderer makes of a run of normalized events (DurbarRetry.next folded over them). */
const fold = (o: EventBody[]): string[] => {
  let st: St = null;
  const acts: string[] = [];
  for (const e of o) { const r = R.next(st, e); st = r.state; if (r.action) acts.push(r.action + ((r as { why?: string }).why ? ':' + (r as { why?: string }).why : '')); }
  return acts;
};

// 5. ClaudeMapper: api_retry -> retrying; the error that ends the turn gave up first; progress, a usage limit, an abort and a helper do not
{
  const run = (msgs: Record<string, unknown>[]): EventBody[] => { const o: EventBody[] = []; const m = new ClaudeMapper((b) => o.push(b)); for (const x of msgs) m.map(x as never); return o; };
  const retry = (n: number): Record<string, unknown> => ({ type: 'system', subtype: 'api_retry', attempt: n, max_retries: 10, retry_delay_ms: 1000 * n, error_status: 429, error: 'rate_limit' });
  const fail = { type: 'result', subtype: 'success', is_error: true, result: 'API Error: 429' };
  let o = run([retry(1), retry(2), fail]);
  assert.deepStrictEqual(kinds(o), ['retry:retrying:1:rate-limit:429', 'retry:retrying:2:rate-limit:429', 'retry:gave-up:2:rate-limit:429', 'status:error']);
  valid(o);
  o = run([retry(1), { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'hi' }] } }, fail]);
  assert.deepStrictEqual(kinds(o), ['retry:retrying:1:rate-limit:429', 'output', 'status:error'], 'an answer came: the error is not a gave-up');
  o = run([retry(1), { type: 'stream_event', event: { type: 'message_start', message: { id: 'm2' } } }, fail]);
  assert.ok(!kinds(o).some((k) => k.startsWith('retry:gave-up')), 'a streamed answer counts too');
  o = run([retry(1), { type: 'result', subtype: 'success', is_error: false }]);
  assert.deepStrictEqual(kinds(o), ['retry:retrying:1:rate-limit:429', 'status:idle']);
  o = run([retry(1), { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour' } }, fail]);
  assert.ok(!kinds(o).some((k) => k.startsWith('retry:gave-up')), 'a usage limit is a coffee break, not a gave-up');
  o = run([retry(1), { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'Invalid API key · Please run /login' }]);
  assert.ok(!kinds(o).some((k) => k.startsWith('retry:gave-up')), 'a sign-in failure is not a gave-up');
  o = run([{ ...retry(1), parent_tool_use_id: 'toolu_1' }, fail]);
  assert.deepStrictEqual(kinds(o), ['status:error'], 'a helper retry is not shown');
  // the next turn starts clean
  o = run([retry(3), { type: 'result', subtype: 'success', is_error: false }, fail]);
  assert.deepStrictEqual(kinds(o).slice(-1), ['status:error']);
  assert.ok(!kinds(o).some((k) => k.startsWith('retry:gave-up')));
  o = run([retry(1), { type: 'result', subtype: 'error_max_turns', is_error: true }]);
  assert.deepStrictEqual(kinds(o), ['retry:retrying:1:rate-limit:429', 'retry:gave-up:1:rate-limit:429', 'status:error']);
  // review on PR 645 (2): a failed turn that still cost money reports usage before it gives up; the renderer shows one outcome, never "went through" too
  o = run([retry(1), retry(2), { type: 'result', subtype: 'error_during_execution', is_error: true, total_cost_usd: 0.05 }]);
  assert.deepStrictEqual(kinds(o), ['retry:retrying:1:rate-limit:429', 'retry:retrying:2:rate-limit:429', 'usage', 'retry:gave-up:2:rate-limit:429', 'status:error']);
  assert.deepStrictEqual(fold(o), ['start', 'update', 'gave-up']);
  // review on PR 645 (6): provider text in the message never reaches an event
  o = run([{ ...retry(1), error: TOKEN, message: TOKEN, error_status: 503 }, fail]);
  clean(o, 'claude');
  assert.deepStrictEqual(kinds(o).slice(0, 2), ['retry:retrying:1:overloaded:503', 'retry:gave-up:1:overloaded:503']);
  // review on PR 645 (5): reset() (each respawn) forgets the old turn's retries
  {
    const out: EventBody[] = [];
    const m = new ClaudeMapper((b) => out.push(b));
    m.map(retry(1) as never);
    m.reset();
    m.map({ type: 'result', subtype: 'error_max_turns', is_error: true } as never);
    assert.deepStrictEqual(kinds(out), ['retry:retrying:1:rate-limit:429', 'status:error'], 'no gave-up for a turn that never retried');
  }
}

// 6. CodexMapper: error(willRetry) -> retrying, counted; turn/completed failed gave up first; progress, usage limit, a child thread
{
  const start = { method: 'thread/started', params: { thread: { id: 'th', cwd: '/w' } } };
  const err = (info: unknown, willRetry = true, threadId = 'th'): Record<string, unknown> => ({ method: 'error', params: { threadId, turnId: 't1', willRetry, error: { message: 'Reconnecting... (stream disconnected) sk-' + 'x'.repeat(40), codexErrorInfo: info } } });
  const failed = (info: unknown = 'responseTooManyFailedAttempts'): Record<string, unknown> => ({ method: 'turn/completed', params: { threadId: 'th', turn: { id: 't1', status: 'failed', error: { message: 'stream disconnected', codexErrorInfo: info } } } });
  const run = (msgs: Record<string, unknown>[]): EventBody[] => { const o: EventBody[] = []; const m = new CodexMapper((b) => o.push(b)); for (const x of [start, ...msgs]) m.map(x as never); return o.slice(1); };
  let o = run([err({ responseStreamDisconnected: { httpStatusCode: null } }), err('serverOverloaded'), err('serverOverloaded', false), failed()]);
  assert.deepStrictEqual(kinds(o), ['retry:retrying:1:network', 'retry:retrying:2:overloaded', 'retry:gave-up:2:overloaded', 'status:error']);
  valid(o);
  assert.ok(!JSON.stringify(o.filter((e) => e.type === 'retry')).includes('sk-'), 'no provider text in a retry event');
  o = run([err('serverOverloaded'), { method: 'item/agentMessage/delta', params: { threadId: 'th', itemId: 'i', delta: 'ok' } }, failed()]);
  assert.deepStrictEqual(kinds(o), ['retry:retrying:1:overloaded', 'output', 'status:error']);
  o = run([err('serverOverloaded'), failed('usageLimitExceeded')]);
  assert.ok(!kinds(o).some((k) => k.startsWith('retry:gave-up')), 'a usage limit (camelCase, as the schema) is not a gave-up');
  o = run([err('serverOverloaded'), failed('UsageLimitExceeded')]);
  assert.ok(!kinds(o).some((k) => k.startsWith('retry:gave-up')), 'nor in PascalCase');
  o = run([err('serverOverloaded'), { method: 'turn/completed', params: { threadId: 'th', turn: { id: 't1', status: 'completed' } } }, failed()]);
  assert.ok(!kinds(o).some((k) => k.startsWith('retry:gave-up')), 'a finished turn clears the run');
  // usage is not progress: a failed turn may report tokens
  o = run([err('serverOverloaded'), { method: 'thread/tokenUsage/updated', params: { threadId: 'th', tokenUsage: { last: { inputTokens: 5, outputTokens: 0 } } } }, failed()]);
  assert.ok(kinds(o).includes('retry:gave-up:1:overloaded'), kinds(o).join());
  // review on PR 645 (3): a sign-in failure after retries is not a gave-up (the sign-in card says why)
  o = run([err('serverOverloaded'), failed('unauthorized')]);
  assert.deepStrictEqual(kinds(o), ['retry:retrying:1:overloaded', 'status:error']);
  o = run([err('serverOverloaded'), { method: 'turn/completed', params: { threadId: 'th', turn: { id: 't1', status: 'failed', error: { message: 'HTTP 401: token expired', codexErrorInfo: 'other' } } } }]);
  assert.deepStrictEqual(kinds(o), ['retry:retrying:1:overloaded', 'status:error'], 'an auth message too');
  o = run([err('serverOverloaded', true, 'other-thread'), failed()]);
  assert.deepStrictEqual(kinds(o), ['status:error'], 'an unknown thread is ignored');
}

// 7. EventMapper (Copilot): model.call_failure -> retrying; session.error gave up first; progress, a usage limit, a helper, idle
{
  const fail = (o: Record<string, unknown> = {}, agentId?: string): Record<string, unknown> => ({ type: 'model.call_failure', ...(agentId ? { agentId } : {}), data: { source: 'top_level', failureKind: 'api', statusCode: 503, retryAttempt: 0, errorMessage: 'upstream connect error', ...o } });
  const sessErr = { type: 'session.error', data: { errorType: 'model_call', message: 'Request failed' } };
  const run = (msgs: Record<string, unknown>[]): EventBody[] => { const o: EventBody[] = []; const m = new EventMapper((b) => o.push(b)); for (const x of msgs) m.map(x as never); return o; };
  let o = run([fail(), fail({ retryAttempt: 1 }), sessErr]);
  assert.deepStrictEqual(kinds(o), ['retry:retrying:1:overloaded:503', 'retry:retrying:2:overloaded:503', 'retry:gave-up:2:overloaded:503', 'status:error']);
  valid(o);
  o = run([fail(), { type: 'assistant.message_delta', data: { deltaContent: 'hi' } }, sessErr]);
  assert.deepStrictEqual(kinds(o), ['retry:retrying:1:overloaded:503', 'output', 'status:error']);
  o = run([fail(), { type: 'session.error', data: { errorType: 'rate_limit', errorCode: 'rate_limited', message: 'x' } }]);
  assert.ok(!kinds(o).some((k) => k.startsWith('retry:gave-up')), 'a usage limit is a coffee break');
  o = run([fail(), { type: 'session.idle', data: {} }, sessErr]);
  assert.ok(!kinds(o).some((k) => k.startsWith('retry:gave-up')), 'the end of the turn clears the run');
  o = run([fail({}, 'sub-instance-1'), sessErr]);
  assert.deepStrictEqual(kinds(o), ['status:error'], "a helper's failed call is not shown");
  o = run([fail({ statusCode: 400 }), sessErr]);
  assert.deepStrictEqual(kinds(o), ['status:error'], 'a 400 is not retried');
  // review on PR 645 (3): a sign-in failure after retries is not a gave-up
  o = run([fail(), { type: 'session.error', data: { errorType: 'authentication', message: 'Not authorized' } }]);
  assert.deepStrictEqual(kinds(o), ['retry:retrying:1:overloaded:503', 'status:error']);
  o = run([fail(), { type: 'session.error', data: { errorType: 'query', message: 'Session was not created with authentication info or custom provider' } }]);
  assert.deepStrictEqual(kinds(o), ['retry:retrying:1:overloaded:503', 'status:error'], 'the message-only sign-in failure too');
  // usage is not progress: a failed turn may report it
  o = run([fail(), { type: 'assistant.usage', data: { model: 'm', inputTokens: 1 } }, sessErr]);
  assert.ok(kinds(o).includes('retry:gave-up:1:overloaded:503'));
  // review on PR 645 (6): the provider message never reaches an event
  o = run([fail({ errorMessage: TOKEN, errorCode: TOKEN, errorType: TOKEN }), fail({ retryAttempt: 1, errorMessage: TOKEN }), sessErr]);
  clean(o, 'copilot');
}

// 8. The event guard
{
  const g = (o: Record<string, unknown>): string[] => eventProblems({ type: 'retry', sessionId: 's', timestamp: 1, phase: 'retrying', attempt: 1, reason: 'rate-limit', ...o });
  assert.deepStrictEqual(g({}), []);
  assert.deepStrictEqual(g({ phase: 'gave-up', httpStatus: 429, maxAttempts: 3, delayMs: 0 }), []);
  assert.ok(g({ phase: 'done' }).length, 'phase');
  for (const a of [0, -1, 1.5, '1', undefined]) assert.ok(g({ attempt: a }).length, `attempt ${String(a)}`);
  assert.ok(g({ maxAttempts: 0 }).length, 'maxAttempts');
  assert.ok(g({ reason: 'Rate limit exceeded: ghp_x' }).length, 'only a fixed reason');
  for (const s of [99, 600, 429.5, '429']) assert.ok(g({ httpStatus: s }).length, `httpStatus ${String(s)}`);
  assert.ok(g({ delayMs: -1 }).length, 'delayMs');
}

// 9. The renderer's words and rule (retry.js)
{
  assert.strictEqual(R.retryLine({ attempt: 3, max: 10, reason: 'overloaded', status: 529 }), 'Retrying (attempt 3 of 10) – servers busy (HTTP 529)');
  assert.strictEqual(R.retryLine({ attempt: 1, reason: 'rate-limit' }), 'Retrying (attempt 1) – rate limit');
  assert.strictEqual(R.retryLine({ reason: 'network' }), 'Retrying – connection problem');
  assert.strictEqual(R.retryLine({ attempt: 0, max: 'x', reason: 'nope', status: 42 }), 'Retrying – API error', 'bad values are left out, an unknown reason is "API error"');
  assert.strictEqual(R.retryLine({ attempt: 5, max: 3, reason: 'server' }), 'Retrying (attempt 5) – server error');
  assert.strictEqual(R.retryLine({ reason: '__proto__' }), 'Retrying – API error');
  assert.strictEqual(R.gaveUpLine({ attempt: 4, reason: 'rate-limit', status: 429 }), 'Gave up after 4 retries – rate limit (HTTP 429)');
  assert.strictEqual(R.gaveUpLine({ attempt: 1, reason: 'timeout' }), 'Gave up after 1 retry – timed out');
  assert.strictEqual(R.gaveUpLine(null), 'Gave up – API error');
  assert.strictEqual(R.wentThroughLine({ attempt: 3 }), 'The request went through after 3 retries.');
  assert.strictEqual(R.wentThroughLine({ attempt: 1 }), 'The request went through after 1 retry.');
  assert.strictEqual(R.wentThroughLine({}), 'The request went through.');
  assert.strictEqual(R.noteLine({ attempt: 2, reason: 'auth' }), 'Retrying (attempt 2) – sign-in problem. The agent app tries again by itself.');
  for (const reason of Object.keys(R.REASONS)) for (const s of [undefined, 503]) for (const n of [undefined, 1, 12]) {
    assert.ok(R.LINE_RE.test(R.retryLine({ attempt: n, max: n && 20, reason, status: s })), 'a retry line is Durbar\'s own words');
    assert.ok(R.LINE_RE.test(R.gaveUpLine({ attempt: n, reason, status: s })), 'a gave-up line too');
  }
  for (const t of ['Retrying – rate limit; ghp_' + 'a'.repeat(36), 'Retrying – something else', 'xRetrying – rate limit', 'Gave up after 2 retries – rate limit (HTTP 4290)']) assert.ok(!R.LINE_RE.test(t), t);

  const ev = (o: Record<string, unknown>): Record<string, unknown> => ({ type: 'retry', phase: 'retrying', attempt: 1, reason: 'rate-limit', ...o });
  let r = R.next(null, ev({ maxAttempts: 10, httpStatus: 429 }));
  assert.strictEqual(r.action, 'start');
  assert.deepStrictEqual(r.state, { attempt: 1, max: 10, reason: 'rate-limit', status: 429 });
  const s1 = r.state;
  r = R.next(s1, ev({ attempt: 2 }));
  assert.strictEqual(r.action, 'update');
  assert.strictEqual(r.state?.attempt, 2);
  for (const t of ['output', 'thinking', 'toolCall']) {
    r = R.next(s1, { type: t });
    assert.strictEqual(r.action, 'went-through', t);
    assert.strictEqual(r.state, null);
  }
  assert.strictEqual(R.next(s1, { type: 'status', status: 'needs-permission' }).action, 'went-through');
  r = R.next(s1, { type: 'status', status: 'error' });
  assert.strictEqual(r.action, 'gave-up', 'an error after a retry gave up (an adapter that sent none)');
  assert.deepStrictEqual(r.info, s1);
  const why = (e: unknown): string => { const x = R.next(s1, e) as { action: string | null; why?: string }; return `${x.action}:${x.why}`; };
  assert.strictEqual(why({ type: 'status', status: 'stopped' }), 'ended:stopped');
  assert.strictEqual(why({ type: 'status', status: 'idle', intent: 'Aborted' }), 'ended:stopped');
  assert.strictEqual(why({ type: 'status', status: 'idle', intent: 'Usage limit reached', reason: 'usage-limit' }), 'ended:limit');
  assert.strictEqual(why({ type: 'usageLimit' }), 'ended:limit');
  assert.strictEqual(why({ type: 'status', status: 'idle' }), 'ended:done');
  assert.strictEqual(why({ type: 'status', status: 'error', errorKind: 'auth' }), 'ended:auth', 'a sign-in failure never gives up');
  assert.strictEqual(R.next(s1, { type: 'usage' }).action, null, 'usage is not progress');
  assert.strictEqual(R.endedLine({ attempt: 3 }, 'stopped'), 'Stopped while retrying (after 3 retries).');
  assert.strictEqual(R.endedLine({ attempt: 1 }, 'limit'), 'Retrying ended at a usage limit (after 1 retry).');
  assert.strictEqual(R.endedLine({ attempt: 2 }, 'auth'), 'Retrying ended: the agent app needs you to sign in (after 2 retries).');
  assert.strictEqual(R.endedLine({ attempt: 2 }, 'done'), 'The turn ended after 2 retries.');
  assert.strictEqual(R.endedLine({}, 'stopped'), 'Stopped while retrying.');
  assert.strictEqual(R.endedLine({}, 'done'), 'The turn ended.');
  for (const e of [{ type: 'status', status: 'working', intent: 'x' }, { type: 'context' }, { type: 'mcp' }, { type: 'model' }, { type: 'title' }]) {
    r = R.next(s1, e);
    assert.strictEqual(r.action, null, JSON.stringify(e));
    assert.strictEqual(r.state, s1);
  }
  for (const e of [{ type: 'output' }, { type: 'status', status: 'error' }]) assert.deepStrictEqual(R.next(null, e), { state: null, action: null }, 'nothing without a retry');
  r = R.next(s1, { type: 'retry', phase: 'gave-up', reason: 'rate-limit' });
  assert.strictEqual(r.action, 'gave-up');
  assert.strictEqual(r.info?.attempt, 1, 'a gave-up without a number keeps the last attempt');
  r = R.next(null, ev({ phase: 'gave-up', attempt: 3, httpStatus: 529, reason: 'overloaded' }));
  assert.strictEqual(R.gaveUpLine(r.info), 'Gave up after 3 retries – servers busy (HTTP 529)');
  assert.strictEqual(R.next(s1, ev({ phase: 'nope' })).action, null);
  assert.strictEqual(R.next(null, null).action, null);
}

console.log('test-retry: all passed');

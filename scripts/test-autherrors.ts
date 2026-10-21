/**
 * Sign-in failures (spec 012 FR-156, FR-157): the pure classifier, the session-error marking of each adapter's mapper and the chat's
 * sign-in card helpers. `npm run test:autherrors`. No process, no account, no credits.
 */
import * as assert from 'assert';
import * as path from 'path';
import { isAuthError, markAuthError, signInFromError } from '../src/adapters/autherrors';
import { ClaudeMapper, claudeAuthFailure } from '../src/adapters/claudeMap';
import type { ClaudeMessage } from '../src/adapters/claudeMap';
import { EventMapper, copilotErrorKind } from '../src/adapters/map';
import type { EventBody } from '../src/adapters/map';
import { eventProblems } from '../src/adapters/eventguard';

const REAL_CLAUDE = 'Failed to authenticate. API Error: 401 OAuth access token is invalid.'; // the owner's real chat error (2026-10-20)

// spec 058 FR-062 / SC-010: an MCP server's OAuth challenge is not the agent app's sign-in (issue #364)
{
  const ISSUE = 'MCP tool catalog changed before tool "srv-search" could be invoked: Failed to verify cached MCP tools: MCP OAuth challenge required (HTTP 401)';
  assert.strictEqual(isAuthError(ISSUE), false, 'the issue text is not an app sign-in error');
  assert.strictEqual(signInFromError(new Error(ISSUE)), 'unknown');
  assert.strictEqual((markAuthError({ type: 'status', status: 'error', intent: ISSUE }) as { errorKind?: string }).errorKind, undefined, 'an error status with the issue text gets no errorKind auth');
  assert.strictEqual(isAuthError('Failed to authenticate. API Error: 401'), true, 'a real app 401 still is');
  // a mixed text (multi-line stderr): the app's own sign-in error next to an MCP challenge stays an auth error
  assert.strictEqual(isAuthError('Failed to authenticate. API Error: 401 OAuth access token is invalid. Please run /login. (while loading MCP server "x": MCP OAuth challenge required (HTTP 401))'), true, 'mixed text is still an app sign-in error');
  assert.strictEqual(isAuthError('MCP server "x" requires authentication. Run `/mcp auth x` to authenticate.'), false, 'pure runtime phrase');
  assert.strictEqual(isAuthError('Re-authentication required for MCP server "x". Run /mcp auth x'), false, 'pure re-auth phrase');
  assert.strictEqual(isAuthError('Re-authentication required for MCP server access. Please run copilot login'), true, 'app text that merely starts alike is not swallowed');
}

// ---- the classifier
const auth = [
  REAL_CLAUDE,
  'Invalid API key · Please run /login',
  'OAuth token has expired. Please obtain a new token or refresh your existing token.',
  'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
  'Not logged in · Please run /login',
  'HTTP 403 Forbidden',
  'Request failed with status 401 Unauthorized',
  'Bad credentials',
  'not authenticated',
  'The GitHub token is expired',
  'invalid token',
  'access token is invalid',
  'Please log in again',
  'login required',
  'unauthorized: unexpected status 401',
  // real texts, spec 012 T124 (2026-10-20): Copilot runtime 1.0.98 with a refused token, and Codex 0.163 with a broken access token
  'Request account.getQuota failed with message: Not authenticated. Please authenticate first.',
  'query: Execution failed: model resolution leaf failed: get_model_list: GenericFailure, Session was not created with authentication info or custom provider',
  'failed to fetch codex rate limits: GET https://chatgpt.com/backend-api/wham/usage failed: 401 Unauthorized; content-type=text/plain; body={ "error": { "message": "Could not parse your authentication token. Please try signing in again.", "code": "unauthorized_unknown" } }',
];
const notAuth = [
  '',
  'Credit balance is too low',
  'You hit your usage limit. Upgrade to Pro.',
  'rate_limit: You have exceeded your rate limit (429)',
  'Too many requests',
  'getaddrinfo ENOTFOUND api.github.com',
  'Request timed out',
  'context_limit: the prompt is too long (max tokens 200000)',
  'Codex usage limit reached',
  'error_during_execution',
  'quota exceeded: 401 credits', // a limit wins over the number
];
for (const t of auth) assert.ok(isAuthError(t), `auth: ${t}`);
for (const t of notAuth) assert.ok(!isAuthError(t), `not auth: ${t}`);
assert.ok(isAuthError(new Error('Bad credentials')), 'an Error is read by its message');
assert.ok(!isAuthError(undefined) && !isAuthError(42) && !isAuthError({ message: '401' }));
assert.strictEqual(signInFromError(new Error('401 Unauthorized')), 'signed-out');
assert.strictEqual(signInFromError(new Error('ECONNRESET')), 'unknown');

// ---- markAuthError: only a top-level error status, only once, and never when the producer already decided
{
  const e = markAuthError({ type: 'status', status: 'error', intent: REAL_CLAUDE } as EventBody);
  assert.strictEqual((e as { errorKind?: string }).errorKind, 'auth');
  assert.deepStrictEqual(eventProblems({ ...e, sessionId: 's', timestamp: 1 }), []);
  const other = { type: 'status', status: 'error', intent: 'Request timed out' } as EventBody;
  assert.strictEqual(markAuthError(other), other);
  const idle = { type: 'status', status: 'idle', intent: 'unauthorized' } as EventBody;
  assert.strictEqual(markAuthError(idle), idle, 'not an error status');
  const sub = { type: 'status', status: 'error', intent: '401', agentId: 't1' } as EventBody;
  assert.strictEqual(markAuthError(sub), sub, 'a sub-agent error does not sign the app out');
  const decided = { type: 'status', status: 'error', intent: 'authorization: 403 policy', errorKind: undefined } as EventBody;
  assert.strictEqual(markAuthError(decided), decided, 'the producer decided: not a sign-in problem');
  const out = { type: 'output', delta: '401 Unauthorized' } as EventBody;
  assert.strictEqual(markAuthError(out), out, 'assistant text is never read');
  // the guard refuses errorKind on anything but an error status
  assert.ok(eventProblems({ type: 'status', status: 'idle', errorKind: 'auth', sessionId: 's', timestamp: 1 }).length > 0);
}

// ---- Copilot: the runtime's own category decides
{
  assert.deepStrictEqual(copilotErrorKind('authentication'), { errorKind: 'auth' });
  for (const t of ['authorization', 'policy', 'quota', 'rate_limit', 'context_limit', 'query']) assert.ok('errorKind' in copilotErrorKind(t) && copilotErrorKind(t).errorKind === undefined, t);
  assert.deepStrictEqual(copilotErrorKind('weird'), {});
  // T124 real text: a `query` error that says the session has no sign-in is a sign-in failure; other `query` errors are not
  assert.deepStrictEqual(copilotErrorKind('query', 'Execution failed: model resolution leaf failed: get_model_list: GenericFailure, Session was not created with authentication info or custom provider'), { errorKind: 'auth' });
  assert.ok('errorKind' in copilotErrorKind('query', 'HTTP 403 Forbidden') && copilotErrorKind('query', 'HTTP 403 Forbidden').errorKind === undefined);
  const out: EventBody[] = [];
  const m = new EventMapper((b) => out.push(markAuthError(b)));
  m.map({ type: 'session.error', data: { errorType: 'authentication', message: 'Not authorized' } } as never);
  m.map({ type: 'session.error', data: { errorType: 'authorization', message: '403: model not enabled by your policy' } } as never);
  m.map({ type: 'session.error', data: { errorType: 'unknown', message: 'Bad credentials' } } as never);
  assert.deepStrictEqual(out.map((b) => (b as { errorKind?: string }).errorKind), ['auth', undefined, 'auth']);
}

// ---- Claude Code: the result, Claude's error marker on the assistant message, and a synthetic message
{
  const run = (msgs: ClaudeMessage[]): EventBody[] => {
    const out: EventBody[] = [];
    const m = new ClaudeMapper((b) => out.push(b));
    for (const x of msgs) m.map(x);
    return out.filter((b) => b.type === 'status');
  };
  // the owner's exact text as a failed result
  let s = run([{ type: 'result', subtype: 'success', is_error: true, result: REAL_CLAUDE } as ClaudeMessage]);
  assert.deepStrictEqual(s.map((b) => [(b as { status: string }).status, (b as { errorKind?: string }).errorKind, (b as { intent?: string }).intent]), [['error', 'auth', REAL_CLAUDE]]);
  // an assistant text block carrying Claude's error marker, then a result whose text says nothing useful
  s = run([
    { type: 'assistant', error: 'authentication_failed', message: { id: 'a', role: 'assistant', content: [{ type: 'text', text: REAL_CLAUDE }] } } as ClaudeMessage,
    { type: 'result', subtype: 'success', is_error: false } as ClaudeMessage,
  ]);
  assert.deepStrictEqual(s.map((b) => (b as { errorKind?: string }).errorKind), ['auth'], 'the marker makes even an is_error:false result an auth error');
  // a synthetic assistant message with the text (no model call happened)
  assert.ok(claudeAuthFailure({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: REAL_CLAUDE }] } } as ClaudeMessage));
  assert.ok(!claudeAuthFailure({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'A 401 means unauthorized.' }] } } as ClaudeMessage), 'the model talking about a 401 is not a failure');
  // a successful turn that talks about a 401 stays a success
  s = run([{ type: 'result', subtype: 'success', is_error: false, result: 'Fixed the 401 Unauthorized handler.' } as ClaudeMessage]);
  assert.deepStrictEqual(s.map((b) => (b as { status: string }).status), ['idle']);
  // a low credit balance is an error, not a sign-in problem
  s = run([{ type: 'result', subtype: 'success', is_error: true, result: 'Credit balance is too low' } as ClaudeMessage]);
  assert.deepStrictEqual(s.map((b) => [(b as { status: string }).status, (b as { errorKind?: string }).errorKind]), [['error', undefined]]);
  // the marker is forgotten after the turn
  s = run([
    { type: 'assistant', error: 'authentication_failed', message: { id: 'a', role: 'assistant', content: [] } } as ClaudeMessage,
    { type: 'result', subtype: 'success', is_error: true, result: REAL_CLAUDE } as ClaudeMessage,
    { type: 'result', subtype: 'success', is_error: false } as ClaudeMessage,
  ]);
  assert.deepStrictEqual(s.map((b) => (b as { status: string }).status), ['error', 'idle']);
}

// ---- the chat's sign-in card helpers (src/renderer/signin.js)
{
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const S = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'signin.js')) as {
    MAX_TEXT: number;
    needsSignIn(kinds: unknown, id?: string): boolean;
    cardText(name: string, phase: string, o?: Record<string, unknown>): { title: string; note: string; button: string };
    restartBeforeResend(id: string): boolean;
    createPromptMemory(max?: number): { set(id: string, t: string, a?: unknown[]): void; get(id: string): { text: string; atts: unknown[] } | undefined; clear(id: string): void; size(): number };
  };
  const kinds = [{ id: 'copilot', state: 'ready' }, { id: 'claude', state: 'not-signed-in' }];
  assert.strictEqual(S.needsSignIn(kinds, 'claude'), true);
  assert.strictEqual(S.needsSignIn(kinds, 'copilot'), false);
  assert.strictEqual(S.needsSignIn(kinds, undefined), false, 'no id = copilot');
  assert.strictEqual(S.needsSignIn(null, 'claude'), false, 'no list: never blocks');
  assert.strictEqual(S.cardText('Claude Code', 'needed').title, 'Claude Code needs you to sign in again.');
  assert.strictEqual(S.cardText('Claude Code', 'needed').button, 'Sign in');
  assert.ok(/still in the box/.test(S.cardText('Codex', 'needed', { before: true }).note));
  assert.strictEqual(S.cardText('Codex', 'done', { hasPrompt: true, restart: true }).title, 'Signed in ✓');
  assert.strictEqual(S.cardText('Codex', 'done', { hasPrompt: true, restart: true }).button, 'Send again');
  assert.ok(/restarts the session/.test(S.cardText('Codex', 'done', { hasPrompt: true, restart: true }).note));
  assert.strictEqual(S.cardText('Codex', 'done', { hasPrompt: true, before: true }).button, 'Send');
  assert.strictEqual(S.cardText('Codex', 'done', {}).button, '', 'nothing to send: no button');
  assert.strictEqual(S.cardText('Codex', 'failed').button, 'Sign in');
  assert.strictEqual(S.restartBeforeResend('claude'), true);
  const mem = S.createPromptMemory(2);
  mem.set('a', 'one');
  mem.set('b', 'two', [{ path: '/x' }]);
  mem.set('c', 'three');
  assert.deepStrictEqual([mem.size(), mem.get('a'), mem.get('b')!.atts.length, mem.get('c')!.text], [2, undefined, 1, 'three'], 'bounded, oldest dropped');
  mem.set('d', 'x'.repeat(S.MAX_TEXT + 10));
  assert.strictEqual(mem.get('d')!.text.length, S.MAX_TEXT);
  mem.clear('d');
  assert.strictEqual(mem.get('d'), undefined);
}

console.log('autherrors: all checks passed');

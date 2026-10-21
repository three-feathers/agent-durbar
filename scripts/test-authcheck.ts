/**
 * Sign-in check after detection and after a refused session (spec 012 FR-156, FR-157): `npm run test:authcheck`.
 * The Copilot adapter runs on the fake SDK; no process runs, no account is used, nothing is billed.
 */
import * as assert from 'assert';
import {
  CLAUDE_SIGN_IN_HINT as MAIN_CLAUDE_HINT,
  CODEX_SIGN_IN_HINT as MAIN_CODEX_HINT,
  COPILOT_SIGN_IN_HINT,
  UNCONFIRMED_HINT,
  VERIFIED_HINT,
  markSignedOut,
  signInHint,
  withSignIn,
} from '../src/main/authcheck';
import type { SignInAnswer } from '../src/main/authcheck';
import { CLAUDE_SIGN_IN_HINT, CODEX_SIGN_IN_HINT } from '../src/adapters/detect';
import { ClaudeAdapter, CLAUDE_LOCAL_SIGN_IN } from '../src/adapters/claude';
import type { AdapterInfo } from '../src/shared/adapters';
import { FakeClient, FakeCopilot, RestartingFakeCopilot } from './fakes/copilot-sdk';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarnessSetup } from '../src/main/harnesssetup';
import type { AgentEvent } from '../src/adapters/types';

const info = (id: string, state: AdapterInfo['state'], hint?: string): AdapterInfo => ({ id, displayName: id, state, capabilities: {}, ...(hint ? { hint } : {}) } as unknown as AdapterInfo);
const answer = (a: SignInAnswer) => async () => a;

void (async () => {
  // the hints main uses are the ones detection uses
  assert.strictEqual(MAIN_CLAUDE_HINT, CLAUDE_SIGN_IN_HINT);
  assert.strictEqual(MAIN_CODEX_HINT, CODEX_SIGN_IN_HINT);
  assert.deepStrictEqual(['copilot', 'claude', 'codex'].map(signInHint), [COPILOT_SIGN_IN_HINT, CLAUDE_SIGN_IN_HINT, CODEX_SIGN_IN_HINT]);

  // ---- withSignIn with the old authStatus answer (kept for adapters without verifySignIn)
  {
    const [c] = await withSignIn([info('copilot', 'ready')], () => answer({ signedIn: false }));
    assert.deepStrictEqual([c.state, c.hint], ['not-signed-in', COPILOT_SIGN_IN_HINT]);
    const [d] = await withSignIn([info('copilot', 'ready', 'detected')], () => answer({ signedIn: true }));
    assert.deepStrictEqual([d.state, d.hint], ['ready', 'detected'], 'a local yes keeps the detected hint');
  }

  // ---- withSignIn with verifySignIn: signed-out, signed-in, unknown, with and without a detail
  {
    const r = await withSignIn(
      [info('claude', 'ready'), info('codex', 'ready'), info('copilot', 'ready'), info('x', 'ready'), info('y', 'ready')],
      (id) =>
        id === 'claude' ? answer({ status: 'signed-out' })
        : id === 'codex' ? answer({ status: 'signed-in' })
        : id === 'copilot' ? answer({ status: 'signed-in', detail: '  Signed in (checked with GitHub).\n' })
        : id === 'x' ? answer({ status: 'unknown' })
        : answer({ status: 'unknown', detail: CLAUDE_LOCAL_SIGN_IN }),
    );
    assert.deepStrictEqual(r.map((x) => [x.state, x.hint]), [
      ['not-signed-in', CLAUDE_SIGN_IN_HINT],
      ['ready', VERIFIED_HINT],
      ['ready', 'Signed in (checked with GitHub).'],
      ['ready', UNCONFIRMED_HINT],
      ['ready', CLAUDE_LOCAL_SIGN_IN],
    ]);
  }

  // ---- an error, no check, or slower than the timeout keep the detected state (an error or timeout says "could not confirm")
  {
    const r = await withSignIn(
      [info('a', 'ready', 'h'), info('b', 'ready', 'h'), info('c', 'ready', 'h')],
      (id) => (id === 'a' ? undefined : id === 'b' ? async () => { throw new Error('runtime down'); } : () => new Promise<SignInAnswer>(() => undefined)),
      30,
    );
    assert.deepStrictEqual(r.map((x) => [x.state, x.hint]), [['ready', 'h'], ['ready', UNCONFIRMED_HINT], ['ready', UNCONFIRMED_HINT]]);
  }

  // ---- only ready apps are asked
  {
    let asked = 0;
    const r = await withSignIn([info('x', 'not-installed'), info('y', 'too-old'), info('z', 'not-signed-in')], () => async () => { asked++; return { status: 'signed-out' as const }; });
    assert.deepStrictEqual([r.map((x) => x.state), asked], [['not-installed', 'too-old', 'not-signed-in'], 0]);
  }

  // ---- FR-157: markSignedOut flips a ready app only, with the app's hint
  {
    const list = [info('copilot', 'ready'), info('claude', 'not-installed')];
    const out = markSignedOut(list, 'copilot');
    assert.strictEqual(out[0].state, 'not-signed-in');
    assert.ok(out[0].hint!.endsWith(COPILOT_SIGN_IN_HINT));
    assert.strictEqual(list[0].state, 'ready', 'the input is not changed');
    assert.strictEqual(markSignedOut(list, 'claude'), list, 'not installed stays');
    assert.strictEqual(markSignedOut(list, 'nope'), list);
    assert.strictEqual(markSignedOut(out, 'copilot'), out, 'already signed out: same list');
  }

  // ---- Copilot verifySignIn on the fake SDK: local status first, then a free server call
  {
    const run = async (set: (c: FakeClient) => void) => {
      const c = new FakeClient();
      set(c);
      const r = await new FakeCopilot(c).verifySignIn();
      return { status: r.status, detail: r.detail, calls: c.authCalls };
    };
    let r = await run(() => undefined);
    assert.deepStrictEqual([r.status, r.calls], ['signed-in', ['getAuthStatus', 'account.getQuota', 'models.list']], 'quota, then the free model list');
    // FR-156 delta (real 2026-10-20): signed in to GitHub but Copilot not enabled: the quota call passes, every model call is 403
    r = await run((c) => { c.modelsFail = 'Request models.list failed with message: GenericFailure, {"kind":"http","status":403,"body":"unauthorized: not authorized to use this Copilot feature"}'; });
    assert.strictEqual(r.status, 'unknown', 'no Copilot access is neither signed in nor signed out');
    assert.match(String(r.detail), /^Signed in to GitHub, but this account has no Copilot access yet/);
    assert.ok(!/someone/.test(r.detail ?? ''), 'the login name never leaves the adapter');
    r = await run((c) => { c.authenticated = false; });
    assert.deepStrictEqual([r.status, r.calls], ['signed-out', ['getAuthStatus']], 'no server call when there is no local sign-in');
    r = await run((c) => { c.quotaFail = 'Request failed: 401 Unauthorized'; });
    assert.deepStrictEqual([r.status, r.calls], ['signed-out', ['getAuthStatus', 'account.getQuota']]);
    r = await run((c) => { c.quotaFail = 'Bad credentials'; });
    assert.strictEqual(r.status, 'signed-out');
    r = await run((c) => { c.quotaFail = 'getaddrinfo ENOTFOUND api.github.com'; c.modelsFail = 'getaddrinfo ENOTFOUND api.github.com'; });
    assert.deepStrictEqual([r.status, r.calls], ['unknown', ['getAuthStatus', 'account.getQuota', 'models.list']], 'a network error is unknown');
    r = await run((c) => { c.noQuota = true; });
    assert.deepStrictEqual([r.status, r.calls], ['signed-in', ['getAuthStatus', 'models.list']], 'no quota call: models.list through the RPC (not the cached listModels)');
    r = await run((c) => { c.quotaFail = 'Unhandled method account.getQuota'; c.modelsFail = 'GitHub token expired'; });
    assert.strictEqual(r.status, 'signed-out');
    r = await run((c) => { c.noQuota = true; c.noRpcModels = true; c.listModelsFail = 'not authenticated'; });
    assert.deepStrictEqual([r.status, r.calls], ['signed-out', ['getAuthStatus', 'listModels']], 'an SDK without the RPC methods uses listModels');
    r = await run((c) => { c.authStatusFail = 'connection closed'; });
    assert.strictEqual(r.status, 'unknown');
    r = await run((c) => { c.quotaFail = 'You have exceeded your rate limit (429)'; c.modelsFail = 'timeout'; });
    assert.strictEqual(r.status, 'unknown', 'a rate limit is not a sign-in problem');
  }

  // ---- Claude Code verifySignIn: local only (no free server call): signed-out when `auth status` says so, else unknown
  {
    const mk = (v: boolean | undefined | 'throw') => new ClaudeAdapter({ claudePath: async () => '/x/claude', loggedIn: async () => { if (v === 'throw') throw new Error('x'); return v; } });
    assert.strictEqual((await mk(false).verifySignIn()).status, 'signed-out');
    assert.deepStrictEqual(await mk(true).verifySignIn(), { status: 'unknown', detail: CLAUDE_LOCAL_SIGN_IN });
    assert.strictEqual((await mk(undefined).verifySignIn()).status, 'unknown');
    assert.strictEqual((await mk('throw').verifySignIn()).status, 'unknown');
    // default probe without a found claude: unknown, nothing runs
    assert.strictEqual((await new ClaudeAdapter({ claudePath: async () => undefined }).verifySignIn()).status, 'unknown');
  }
  // ---- FR-158: refreshAuth restarts Copilot's shared client and resumes the live sessions on the new one
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-refresh-'));
    // nothing started yet: nothing to stop, no client is created
    const idle = new RestartingFakeCopilot();
    await idle.refreshAuth();
    assert.strictEqual(idle.clients.length, 0, 'no client is started by a refresh');

    const ad = new RestartingFakeCopilot();
    const events: AgentEvent[] = [];
    ad.onEvent((e) => events.push(e));
    const c1 = await ad.currentClient();
    assert.strictEqual(await ad.currentClient(), c1, 'the client is shared');
    const a = await ad.start({ workspace: dir, model: 'sim-fast', maxAiCredits: 5, quiet: true });
    const b = await ad.start({ workspace: dir, model: 'sim-deep', quiet: true });
    c1.sessions.get(a)!.processing = true; // a turn is running in a
    await ad.setCap(b, 7);
    await ad.setMcpEnabled(b, 'github', false);
    await ad.refreshAuth();
    assert.strictEqual(c1.stopped, 1, 'the old client is stopped gracefully');
    const c2 = await ad.currentClient();
    assert.notStrictEqual(c2, c1, 'getClient returns a new client');
    assert.strictEqual(ad.clients.length, 2);
    assert.deepStrictEqual(c2.resumed.map((r) => r.id), [a, b], 'both live sessions are resumed on the new client');
    assert.ok(ad.isLive(a) && ad.isLive(b));
    const ra = c2.resumed[0].config, rb = c2.resumed[1].config;
    assert.strictEqual(typeof ra.onPermissionRequest, 'function', 'same handlers');
    assert.strictEqual(ra.model, undefined, 'no model: the runtime keeps the model the session has now');
    assert.deepStrictEqual(ra.sessionLimits, { maxAiCredits: 5 }, 'the start cap stays');
    assert.deepStrictEqual(rb.sessionLimits, { maxAiCredits: 7 }, 'a cap changed while running is put back');
    // spec 061 FR-017: the reconnect re-resume keeps the folder's file hooks off, like create and resume
    assert.strictEqual(ra.enableFileHooks, false, 'refreshAuth re-resume: repository file hooks stay off (FR-017)');
    assert.strictEqual(rb.enableFileHooks, false, 'refreshAuth re-resume: repository file hooks stay off (FR-017)');
    // spec 058 FR-070: the re-resume keeps MCP sign-ins in the OS keychain too
    assert.strictEqual(ra.mcpOAuthTokenStorage, 'persistent', 'refreshAuth re-resume: persistent MCP token storage (058 FR-070)');
    assert.ok(c2.sessions.get(b)!.calls.some((x) => x.name === 'mcp.disable'), 'an MCP server switched off stays off');
    const intents = (sid: string) => events.filter((e) => e.sessionId === sid && e.type === 'status').map((e) => (e as { intent?: string }).intent);
    assert.ok(intents(a).includes('Reconnecting Copilot…'));
    assert.ok(intents(a).some((t) => t && /running turn was stopped/.test(t)), 'a cut turn is said');
    assert.ok(intents(b).includes('Reconnected with the new sign-in.'));
    // events of the new session reach the app; the old one is unsubscribed
    assert.strictEqual(c1.sessions.get(a)!.handler, undefined);
    assert.ok(c2.sessions.get(a)!.handler);
    // sending uses the new session
    await ad.send(a, { text: 'hi' });
    assert.ok(c2.sessions.get(a)!.calls.some((x) => x.name === 'send'));
    assert.ok(!c1.sessions.get(a)!.calls.some((x) => x.name === 'send'));

    // a session that cannot be resumed is ended (history stays); a stop failure on the old client does not block
    const bad = new RestartingFakeCopilot((c, n) => { if (n === 0) c.stopFail = 'boom'; if (n === 1) c.resumeFail.add('keep-me'); });
    const bev: AgentEvent[] = [];
    bad.onEvent((e) => bev.push(e));
    await bad.start({ workspace: dir, sessionId: 'keep-me', quiet: true });
    await bad.refreshAuth();
    assert.strictEqual(bad.isLive('keep-me'), false);
    assert.ok(bev.some((e) => e.type === 'status' && (e as { status?: string }).status === 'stopped'));
    assert.strictEqual(bad.clients.length, 2);
    // two refreshes at once share one restart
    const twice = new RestartingFakeCopilot();
    await twice.currentClient();
    await Promise.all([twice.refreshAuth(), twice.refreshAuth()]);
    assert.strictEqual(twice.clients[0].stopped, 1);
    // the token-free fake adapter (getClient overridden): a refresh is a no-op
    await new FakeCopilot(new FakeClient()).refreshAuth();
  }

  // ---- FR-158: a sign-in that ended well calls afterSignIn before detection and harness:done; a failed one does not
  {
    const order: string[] = [];
    const mk = () => {
      const setup = new HarnessSetup({
        detectEnv: { platform: 'linux', env: {}, exists: () => false, which: async () => '/usr/bin/copilot' } as never,
        spawn: (() => { throw new Error('unused'); }) as never,
        killTree: () => undefined,
        send: ((ch: string) => order.push(ch)) as never,
        redetect: async () => { order.push('redetect'); },
        afterSignIn: async (k) => { order.push('after:' + k); },
      });
      return setup as unknown as { finish(r: unknown, code: number | null): Promise<void> };
    };
    await mk().finish({ kind: 'copilot', op: 'signin', out: '', started: 0 }, 0);
    assert.deepStrictEqual(order, ['after:copilot', 'redetect', 'harness:done']);
    order.length = 0;
    await mk().finish({ kind: 'copilot', op: 'signin', out: '', started: 0 }, 1);
    assert.deepStrictEqual(order, ['redetect', 'harness:done'], 'a failed sign-in refreshes nothing');
    order.length = 0;
    await mk().finish({ kind: 'copilot', op: 'install', out: '', started: 0 }, 0);
    assert.deepStrictEqual(order, ['redetect', 'harness:done'], 'only a sign-in');
  }
  console.log('authcheck: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });

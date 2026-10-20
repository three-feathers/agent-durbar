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
import { FakeClient, FakeCopilot } from './fakes/copilot-sdk';

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
    assert.deepStrictEqual([r.status, r.calls], ['signed-in', ['getAuthStatus', 'account.getQuota']]);
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
  console.log('authcheck: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });

/**
 * Spec 051 FR-011..FR-015 (issue #617): the signed-in account per agent app. `npm run test:account`.
 * Fake SDK, CLI and app-server answers only: no process runs, no account is used, nothing is billed.
 *
 *  1. `accountLine`, `cleanName`, `planWord`, `accountView` (shared, pure);
 *  2. the per-app mappers on every answer form, missing fields, wrong types and hostile names;
 *  3. each adapter's `accountInfo` (Copilot on the fake SDK, Claude Code with a fake `auth status`, Codex on the fake app-server);
 *  4. main's per-run cache (once, refresh, forget after a sign-in, installed apps only, timeout, errors);
 *  5. personal data stays out of the debug log, `adapters:list` (withSignIn) and the log and export paths (FR-015).
 */
import * as assert from 'assert';
import { SANDBOX_HOST_OK } from './fakes/claude-cli';
import * as fs from 'fs';
import * as path from 'path';
import { accountLine, accountView, cleanName, maskName, planWord, NAME_MAX } from '../src/shared/account';
import type { AccountIdentity, AccountInfoOptions } from '../src/shared/account';
import { claudeAccount, codexAccount, copilotAccount, copilotPlanLabel } from '../src/adapters/accounts';
import { ClaudeAdapter } from '../src/adapters/claude';
import { CodexAdapter } from '../src/adapters/codex';
import { claudeAuthStatus, claudeLoggedIn, nodeExec } from '../src/adapters/detect';
import type { DetectEnv, Exec } from '../src/adapters/detect';
import { accountCheck, createAccountCache } from '../src/main/accounts';
import { copilotServerNames } from '../src/main/mcpfiles';
import { sweepStaleTempDirs } from '../src/shared/attachments';
import * as os from 'os';
import { withSignIn } from '../src/main/authcheck';
import type { AdapterInfo } from '../src/shared/adapters';
import { FakeClient, FakeCopilot } from './fakes/copilot-sdk';
import { FakeCodexServer } from './fakes/codex-app-server';
import type { FakeCodexOptions } from './fakes/codex-app-server';

/** Waits on a real condition (polls every 5 ms) and fails with `what` on a generous timeout; never a fixed sleep. */
async function until(cond: () => boolean | Promise<boolean>, what: string, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await cond())) {
    if (Date.now() > end) assert.fail(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}
/** One turn of the event loop, so every already-queued promise reaction has run (no time involved). */
const turn = (): Promise<void> => new Promise((r) => setImmediate(r));

const ROOT = path.join(__dirname, '..', '..');
const MARK = 'marker.person@example.invalid';
const info = (id: string, state: AdapterInfo['state']): AdapterInfo => ({ id, displayName: id, state, capabilities: {} } as unknown as AdapterInfo);

class AuthFakeClient extends FakeClient {
  answer: unknown = { isAuthenticated: true, authType: 'gh-cli', host: 'https://github.com', login: 'octocat', statusMessage: `Logged in as ${MARK}` };
  async getAuthStatus(): Promise<unknown> {
    this.authCalls.push('getAuthStatus');
    if (this.authStatusFail) throw new Error(this.authStatusFail);
    return this.answer;
  }
}

/** A source file with its line endings normalised: Windows checks out CRLF (agent notes, "Static source checks and CRLF"). */
const readSrc = (f: string): string => fs.readFileSync(path.join(path.join(__dirname, '..', '..'), f), 'utf8').replace(/\r\n/g, '\n');
/** The method body that starts at `head`, up to its closing two-space `}` line; '' when not found. CRLF is normalised first. */
const bodyOf = (text: string, head: string): string => {
  const t = text.replace(/\r\n/g, '\n');
  const i = t.indexOf(head);
  const j = i < 0 ? -1 : t.indexOf('\n  }\n', i);
  return i < 0 || j < 0 ? '' : t.slice(i, j);
};
// a promise that never settles empties the event loop and Node exits 0 without the last line: count that as a failure
let finished = false;
process.on('exit', (code) => {
  if (!finished && code === 0) {
    console.error('test:account did not finish (a call never settled)');
    process.exitCode = 1;
  }
});

void (async () => {
  // ---- 1. the line (FR-012)
  {
    assert.strictEqual(accountLine({ status: 'signed-in', name: 'octocat', service: 'GitHub', method: 'gh-cli' }), 'Signed in as octocat (GitHub, through the GitHub CLI)');
    assert.strictEqual(accountLine({ status: 'signed-in', name: 'octocat', service: 'GitHub', method: 'account' }), 'Signed in as octocat (GitHub)');
    assert.strictEqual(accountLine({ status: 'signed-in', name: 'you@example.com', service: 'Claude', plan: 'Claude Pro', method: 'account' }), 'Signed in as you@example.com · Claude Pro');
    assert.strictEqual(accountLine({ status: 'signed-in', service: 'OpenAI', method: 'api-key' }), 'Signed in with an OpenAI API key');
    assert.strictEqual(accountLine({ status: 'signed-in', service: 'Anthropic', method: 'api-key' }), 'Signed in with an Anthropic API key');
    assert.strictEqual(accountLine({ status: 'signed-in', service: 'GitHub', method: 'api-key' }), 'Signed in with a GitHub API key');
    assert.strictEqual(accountLine({ status: 'signed-in', method: 'api-key' }), 'Signed in with an API key');
    assert.strictEqual(accountLine({ status: 'signed-in', service: 'Claude', method: 'token' }), 'Signed in with a token (Claude)');
    assert.strictEqual(accountLine({ status: 'signed-in', service: 'Amazon Bedrock', method: 'provider' }), 'Signed in through Amazon Bedrock');
    assert.strictEqual(accountLine({ status: 'signed-in', plan: 'Claude Max' }), 'Signed in · Claude Max');
    assert.strictEqual(accountLine({ status: 'signed-in' }), 'Signed in; the app does not say which account');
    assert.strictEqual(accountLine({ status: 'signed-out', name: 'ignored' }), 'Not signed in');
    assert.strictEqual(accountLine({ status: 'unknown', name: 'ignored' }), 'Account unknown');
    assert.strictEqual(accountLine(undefined), 'Account unknown');
    assert.strictEqual(accountLine(null), 'Account unknown');
    assert.strictEqual(accountLine({ status: 'weird' } as unknown as AccountIdentity), 'Account unknown');
    assert.strictEqual(accountLine({ status: 'signed-in', name: 'x', method: 'nope' } as unknown as AccountIdentity), 'Signed in as x');
    // FR-016: the view's line is masked; the clear name travels only for the Settings reveal
    assert.deepStrictEqual(accountView({ status: 'signed-in', name: 'a' }), { status: 'signed-in', text: 'Signed in as •••', masked: '•••', name: 'a' });
    assert.deepStrictEqual(accountView({ status: 'signed-in', name: 'vikram@example.com', plan: 'Claude Pro' }), { status: 'signed-in', text: 'Signed in as v•••@example.com · Claude Pro', masked: 'v•••@example.com', name: 'vikram@example.com', plan: 'Claude Pro' });
    // FR-018: the plan on its own, and the Settings line without it
    assert.deepStrictEqual(accountView({ status: 'signed-in', name: 'sim@example.com', service: 'Claude', plan: 'Claude Max', method: 'account' }), { status: 'signed-in', text: 'Signed in as s•••@example.com · Claude Max', masked: 's•••@example.com', name: 'sim@example.com', plan: 'Claude Max' });
    assert.deepStrictEqual(accountView({ status: 'signed-in', plan: 'ChatGPT Plus' }), { status: 'signed-in', text: 'Signed in · ChatGPT Plus', plan: 'ChatGPT Plus' });
    assert.deepStrictEqual(accountView({ status: 'signed-out', plan: 'Claude Pro' }), { status: 'signed-out', text: 'Not signed in' }, 'no plan without a sign-in');
    assert.deepStrictEqual(accountView({ status: 'unknown', plan: 'Claude Pro' }), { status: 'unknown', text: 'Account unknown' });
    assert.strictEqual(accountView({ status: 'signed-in', name: 'o', plan: 'x\ny' }).plan, 'x y', 'the plan is one clean line');
    // FR-021: the facts the card lists; only for a sign-in, cleaned like the rest
    assert.deepStrictEqual(accountView({ status: 'signed-in', name: 'o', provider: 'GitHub', via: 'GitHub CLI' }), { status: 'signed-in', text: 'Signed in as •••', masked: '•••', name: 'o', provider: 'GitHub', via: 'GitHub CLI' });
    assert.deepStrictEqual(accountView({ status: 'signed-out', provider: 'GitHub', via: 'GitHub CLI' }), { status: 'signed-out', text: 'Not signed in' }, 'no facts without a sign-in');
    assert.deepStrictEqual(accountView({ status: 'unknown', provider: 'GitHub' }), { status: 'unknown', text: 'Account unknown' });
    assert.strictEqual(accountView({ status: 'signed-in', provider: 'Git\nHub', via: 7 as unknown as string }).provider, 'Git Hub');
    assert.strictEqual(accountView({ status: 'signed-in', via: 7 as unknown as string }).via, undefined, 'a wrong type gives no line');
    assert.strictEqual(copilotAccount({ isAuthenticated: true, authType: 'something-new', login: 'x' }).via, undefined, 'an unknown route gives no "Signed in via" line');
    assert.strictEqual(claudeAccount({ loggedIn: true, authMethod: 'third_party', apiProvider: 'bedrock' }).via, undefined, 'a cloud provider: no guessed route');
    assert.strictEqual(codexAccount({ account: { type: 'amazonBedrock' } }).via, undefined);
    assert.strictEqual(copilotPlanLabel('individual'), 'Copilot Individual');
    assert.strictEqual(copilotPlanLabel('business'), 'Copilot Business');
    assert.strictEqual(copilotPlanLabel('free_limited_copilot'), 'Copilot Free limited');
    assert.strictEqual(copilotPlanLabel('copilot'), undefined, 'nothing left: no plan');
    assert.strictEqual(copilotPlanLabel('unknown'), undefined);
    assert.strictEqual(copilotPlanLabel(''), undefined);
    assert.strictEqual(copilotPlanLabel(3), undefined);
    assert.strictEqual(copilotPlanLabel(null), undefined);
    assert.deepStrictEqual(accountView({ status: 'signed-in', name: 'octocat', service: 'GitHub', method: 'gh-cli' }), { status: 'signed-in', text: 'Signed in as o••• (GitHub, through the GitHub CLI)', masked: 'o•••', name: 'octocat' });
    assert.deepStrictEqual(accountView({ status: 'signed-in', service: 'OpenAI', method: 'api-key' }), { status: 'signed-in', text: 'Signed in with an OpenAI API key' }, 'no name: nothing to mask or reveal');
    assert.deepStrictEqual(accountView({ status: 'signed-out', name: 'stale@example.com' }), { status: 'signed-out', text: 'Not signed in' }, 'a signed-out answer carries no name');
    assert.deepStrictEqual(accountView({ status: 'unknown', name: 'x@example.com' }), { status: 'unknown', text: 'Account unknown' });
    for (const n of ['vikram@example.com', 'octocat', 'a.b+c@sub.example.org', 'é@example.com']) {
      const v = accountView({ status: 'signed-in', name: n, plan: 'P' });
      assert.ok(!v.text.includes(n) && v.text.includes(v.masked as string), `the line never holds the clear name: ${v.text}`);
    }
    assert.strictEqual(maskName('vikram@example.com'), 'v•••@example.com');
    assert.strictEqual(maskName('octocat'), 'o•••');
    assert.strictEqual(maskName('o'), '•••');
    assert.strictEqual(maskName('@example.com'), '@•••', 'no local part: treated as a login');
    assert.strictEqual(maskName('a@b@example.com'), 'a•••@example.com', 'the last @ starts the domain');
    assert.strictEqual(maskName('😀x@example.com'), '😀•••@example.com', 'a character, not half a surrogate pair');
    assert.strictEqual(maskName('x@example.com'), '•••@example.com', 'a one-character local part shows nothing of it');
    assert.deepStrictEqual(accountView({ status: 'bogus' } as unknown as AccountIdentity), { status: 'unknown', text: 'Account unknown' });
    assert.deepStrictEqual(accountView(undefined), { status: 'unknown', text: 'Account unknown' });
    // cleanName: one line, no control or bidi characters, at most NAME_MAX
    assert.strictEqual(cleanName('  a\nb\tc  '), 'a b c');
    assert.strictEqual(cleanName('evil‮gnp.exe'), 'evil gnp.exe');
    assert.strictEqual(cleanName('\u0000\u001b[31m'), '[31m');
    assert.strictEqual(cleanName(''), undefined);
    assert.strictEqual(cleanName('   '), undefined);
    assert.strictEqual(cleanName(42), undefined);
    assert.strictEqual(cleanName(null), undefined);
    const long = cleanName('x'.repeat(500)) as string;
    assert.strictEqual(long.length, NAME_MAX);
    assert.ok(long.endsWith('…'));
    assert.strictEqual(planWord('max'), 'Max');
    assert.strictEqual(planWord('self_serve_business_prolite'), 'Self serve business prolite');
    assert.strictEqual(planWord('unknown'), undefined);
    assert.strictEqual(planWord(7), undefined);
    assert.strictEqual(planWord(''), undefined);
  }

  // ---- 2. the mappers (FR-011)
  {
    // Copilot getAuthStatus
    assert.deepStrictEqual(copilotAccount({ isAuthenticated: true, authType: 'gh-cli', host: 'https://github.com', login: 'octocat' }), { status: 'signed-in', name: 'octocat', service: 'GitHub', method: 'gh-cli', provider: 'GitHub', via: 'GitHub CLI' });
    assert.deepStrictEqual(copilotAccount({ isAuthenticated: true, authType: 'user', login: 'octocat' }), { status: 'signed-in', name: 'octocat', service: 'GitHub', method: 'account', provider: 'GitHub', via: 'Copilot CLI login' });
    assert.deepStrictEqual(copilotAccount({ isAuthenticated: true, authType: 'env' }), { status: 'signed-in', service: 'GitHub', method: 'token', provider: 'GitHub', via: 'Token from the environment' });
    assert.deepStrictEqual(copilotAccount({ isAuthenticated: true, authType: 'token', login: 'bot' }), { status: 'signed-in', name: 'bot', service: 'GitHub', method: 'token', provider: 'GitHub', via: 'Token' });
    assert.deepStrictEqual(copilotAccount({ isAuthenticated: true, authType: 'hmac' }), { status: 'signed-in', service: 'GitHub', method: 'api-key', provider: 'GitHub', via: 'HMAC key' });
    assert.deepStrictEqual(copilotAccount({ isAuthenticated: true, host: 'https://ghe.example.com/', login: 'me' }), { status: 'signed-in', name: 'me', service: 'ghe.example.com', provider: 'ghe.example.com' });
    assert.deepStrictEqual(copilotAccount({ isAuthenticated: true, host: 'ghe.example.com', login: 'me' }).service, 'ghe.example.com');
    assert.deepStrictEqual(copilotAccount({ isAuthenticated: true, host: 'http://[bad', login: 'me' }).service, 'GitHub');
    assert.deepStrictEqual(copilotAccount({ isAuthenticated: true, login: 42, authType: 7 }), { status: 'signed-in', service: 'GitHub', provider: 'GitHub' });
    assert.ok(!JSON.stringify(copilotAccount({ isAuthenticated: true, login: 'o', statusMessage: MARK })).includes(MARK), 'statusMessage is never read');
    assert.deepStrictEqual(copilotAccount({ isAuthenticated: false, login: 'stale' }), { status: 'signed-out' });
    assert.deepStrictEqual(copilotAccount({ login: 'x' }), { status: 'unknown' });
    assert.deepStrictEqual(copilotAccount(null), { status: 'unknown' });
    assert.deepStrictEqual(copilotAccount('yes'), { status: 'unknown' });
    // Claude auth status --json (field names as in the 2.1.304 bundle)
    assert.deepStrictEqual(claudeAccount({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'you@example.com', orgId: 'o', orgName: 'Org', subscriptionType: 'pro' }), { status: 'signed-in', name: 'you@example.com', service: 'Claude', plan: 'Claude Pro', method: 'account', provider: 'Claude', via: 'Claude login' });
    assert.deepStrictEqual(claudeAccount({ loggedIn: true, authMethod: 'claude.ai', email: null, subscriptionType: null }), { status: 'signed-in', service: 'Claude', method: 'account', provider: 'Claude', via: 'Claude login' });
    assert.deepStrictEqual(claudeAccount({ loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty', apiKeySource: 'ANTHROPIC_API_KEY' }), { status: 'signed-in', service: 'Anthropic', method: 'api-key', provider: 'Anthropic', via: 'API key' });
    assert.deepStrictEqual(claudeAccount({ loggedIn: true, authMethod: 'api_key', email: 'k@example.com' }), { status: 'signed-in', name: 'k@example.com', service: 'Anthropic', method: 'api-key', provider: 'Anthropic', via: 'API key' });
    assert.deepStrictEqual(claudeAccount({ loggedIn: true, authMethod: 'oauth_token' }), { status: 'signed-in', service: 'Claude', method: 'token', provider: 'Claude', via: 'Long-lived token' });
    assert.deepStrictEqual(claudeAccount({ loggedIn: true, authMethod: 'third_party', apiProvider: 'bedrock' }), { status: 'signed-in', service: 'Amazon Bedrock', method: 'provider', provider: 'Amazon Bedrock' });
    assert.deepStrictEqual(claudeAccount({ loggedIn: true, authMethod: 'api_key', apiProvider: 'vertex' }), { status: 'signed-in', service: 'Google Vertex AI', method: 'provider', provider: 'Google Vertex AI' });
    assert.deepStrictEqual(claudeAccount({ loggedIn: true, authMethod: 'third_party' }), { status: 'signed-in', method: 'provider' });
    assert.deepStrictEqual(claudeAccount({ loggedIn: true, authMethod: 'something-new' }), { status: 'signed-in' });
    assert.ok(!JSON.stringify(claudeAccount({ loggedIn: true, authMethod: 'claude.ai', orgName: MARK, orgId: MARK })).includes(MARK), 'the organisation is not read');
    assert.deepStrictEqual(claudeAccount({ loggedIn: false, authMethod: 'none', email: 'stale@example.com' }), { status: 'signed-out' });
    assert.deepStrictEqual(claudeAccount({ loggedIn: true, authMethod: 'none' }), { status: 'signed-out' });
    assert.deepStrictEqual(claudeAccount({ loggedIn: 'yes' }), { status: 'unknown' });
    assert.deepStrictEqual(claudeAccount(undefined), { status: 'unknown' });
    assert.deepStrictEqual(claudeAccount([1]), { status: 'unknown' });
    // Codex account/read (GetAccountResponse of codex-cli 0.163.0)
    assert.deepStrictEqual(codexAccount({ account: { type: 'chatgpt', email: 'you@example.com', planType: 'plus' }, requiresOpenaiAuth: true }), { status: 'signed-in', name: 'you@example.com', service: 'ChatGPT', plan: 'ChatGPT Plus', method: 'account', provider: 'OpenAI (ChatGPT)', via: 'ChatGPT login' });
    assert.deepStrictEqual(codexAccount({ account: { type: 'chatgpt', email: null, planType: 'unknown' }, requiresOpenaiAuth: true }), { status: 'signed-in', service: 'ChatGPT', method: 'account', provider: 'OpenAI (ChatGPT)', via: 'ChatGPT login' });
    assert.deepStrictEqual(codexAccount({ account: { type: 'apiKey' }, requiresOpenaiAuth: true }), { status: 'signed-in', service: 'OpenAI', method: 'api-key', provider: 'OpenAI', via: 'API key' });
    assert.deepStrictEqual(codexAccount({ account: { type: 'amazonBedrock', usesCodexManagedCredentials: false }, requiresOpenaiAuth: false }), { status: 'signed-in', service: 'Amazon Bedrock', method: 'provider', provider: 'Amazon Bedrock' });
    assert.deepStrictEqual(codexAccount({ account: { type: 'future' }, requiresOpenaiAuth: true }), { status: 'signed-in' });
    assert.deepStrictEqual(codexAccount({ account: null, requiresOpenaiAuth: true }), { status: 'signed-out' });
    assert.deepStrictEqual(codexAccount({ account: null, requiresOpenaiAuth: false }), { status: 'unknown' }, 'a custom provider needs no OpenAI sign-in: not "signed out"');
    assert.deepStrictEqual(codexAccount({ account: 'x', requiresOpenaiAuth: true }), { status: 'unknown' });
    assert.deepStrictEqual(codexAccount(undefined), { status: 'unknown' });
    // a hostile name is one short line in the result and in the line
    const evil = codexAccount({ account: { type: 'chatgpt', email: 'a\n‮b<script>' + 'y'.repeat(300), planType: 'pro\nmax' } });
    assert.ok(evil.name && !/[\n‮]/.test(evil.name) && evil.name.length <= NAME_MAX);
    assert.ok(!/\n/.test(accountLine(evil)));
    assert.strictEqual(evil.plan, 'ChatGPT Pro max');
  }

  // ---- 3a. Copilot adapter on the fake SDK
  {
    const c = new AuthFakeClient();
    const ad = new FakeCopilot(c);
    (ad as unknown as { planTimeoutMs: number }).planTimeoutMs = 30;
    const debug: string[] = [];
    ad.debug = (m) => debug.push(m);
    assert.deepStrictEqual(await ad.accountInfo(), { status: 'signed-in', name: 'octocat', service: 'GitHub', method: 'gh-cli', provider: 'GitHub', via: 'GitHub CLI', plan: 'Copilot Individual' });
    assert.deepStrictEqual(c.authCalls, ['getAuthStatus'], 'only the local status: no quota, no model call');
    // FR-018: the plan comes from a throw-away session: no tools, no MCP, a temp folder, no message, then disconnected, deleted and removed
    {
      const sess = c.last as unknown as { calls: Array<{ name: string }>; config: Record<string, unknown>; sessionId: string };
      assert.deepStrictEqual(sess.calls.map((x) => x.name), ['gitHubAuth.getStatus', 'disconnect'], 'only the status call: nothing is sent');
      assert.deepStrictEqual(sess.config.availableTools, []);
      assert.deepStrictEqual(sess.config.mcpServers, {});
      assert.ok(Array.isArray(sess.config.excludedTools) && (sess.config.excludedTools as string[]).includes('mcp:*'));
      assert.ok(typeof sess.config.workingDirectory === 'string' && /durbar-acct-/.test(sess.config.workingDirectory as string) && !fs.existsSync(sess.config.workingDirectory as string), 'its temp folder is removed');
      assert.ok((c as unknown as { deleted: string[] }).deleted.includes(sess.sessionId), 'the session is deleted');
    }
    // the plan is optional: an error, no method, no plan, a hang (time limit) give the account without a plan
    for (const [label, prep] of [
      ['error', (x: Record<string, unknown>) => { x.statusFail = 'boom ' + MARK; }],
      ['no plan', (x: Record<string, unknown>) => { x.statusAnswer = { isAuthenticated: true, login: MARK }; }],
      ['plan unknown', (x: Record<string, unknown>) => { x.statusAnswer = { copilotPlan: 'unknown' }; }],
      ['no method', (x: Record<string, unknown>) => { (x.rpc as Record<string, unknown>).gitHubAuth = undefined; }],
      ['hangs', (x: Record<string, unknown>) => { x.statusHangs = true; }],
    ] as Array<[string, (x: Record<string, unknown>) => void]>) {
      const c2 = new AuthFakeClient();
      const orig = c2.createSession.bind(c2);
      c2.createSession = async (cfg: Record<string, unknown>) => { const sx = await orig(cfg); prep(sx as unknown as Record<string, unknown>); return sx; };
      const ad2 = new FakeCopilot(c2);
      (ad2 as unknown as { planTimeoutMs: number }).planTimeoutMs = 30;
      assert.deepStrictEqual(await ad2.accountInfo(), { status: 'signed-in', name: 'octocat', service: 'GitHub', method: 'gh-cli', provider: 'GitHub', via: 'GitHub CLI' }, `no plan when ${label}`);
      // the answer comes at the overall cap; the cleanup finishes right after it
      await until(() => (c2 as unknown as { deleted: string[] }).deleted.length >= 1, `the session is deleted when ${label}`);
      assert.ok((c2 as unknown as { deleted: string[] }).deleted.length === 1, `the session is deleted when ${label}`);
    }
    {
      const c3 = new AuthFakeClient();
      c3.createSession = async () => { throw new Error('no sessions'); };
      assert.deepStrictEqual(await new FakeCopilot(c3).accountInfo(), { status: 'signed-in', name: 'octocat', service: 'GitHub', method: 'gh-cli', provider: 'GitHub', via: 'GitHub CLI' }, 'no session possible: no plan');
      const c4 = new AuthFakeClient();
      c4.answer = { isAuthenticated: false };
      await new FakeCopilot(c4).accountInfo();
      assert.strictEqual((c4 as unknown as { created: unknown[] }).created.length, 0, 'signed out: no session is made');
    }
    c.answer = { isAuthenticated: false };
    assert.deepStrictEqual(await ad.accountInfo(), { status: 'signed-out' });
    c.answer = {};
    assert.deepStrictEqual(await ad.accountInfo(), { status: 'unknown' });
    c.authStatusFail = `runtime crashed for ${MARK}`;
    assert.deepStrictEqual(await ad.accountInfo(), { status: 'unknown' });
    assert.ok(!debug.join('\n').includes(MARK) && !debug.join('\n').includes('octocat'), 'nothing of the account reaches debug');
  }

  // ---- 3b. Claude Code adapter with a fake `auth status`
  {
    const debug: string[] = [];
    const mk = (j: unknown) => {
      const a = new ClaudeAdapter({ sandboxFacts: SANDBOX_HOST_OK, claudePath: async () => '/x/claude', authJson: async () => { if (j === 'throw') throw new Error(MARK); return j as Record<string, unknown> | undefined; } });
      a.debug = (m) => debug.push(m);
      return a;
    };
    assert.deepStrictEqual(await mk({ loggedIn: true, authMethod: 'claude.ai', email: MARK, subscriptionType: 'max' }).accountInfo(), { status: 'signed-in', name: MARK, service: 'Claude', plan: 'Claude Max', method: 'account', provider: 'Claude', via: 'Claude login' });
    assert.deepStrictEqual(await mk({ loggedIn: false }).accountInfo(), { status: 'signed-out' });
    assert.deepStrictEqual(await mk(undefined).accountInfo(), { status: 'unknown' });
    assert.deepStrictEqual(await mk('throw').accountInfo(), { status: 'unknown' });
    assert.deepStrictEqual(await new ClaudeAdapter({ sandboxFacts: SANDBOX_HOST_OK, claudePath: async () => undefined }).accountInfo(), { status: 'unknown' }, 'no claude found: unknown, nothing runs');
    assert.ok(!debug.join('\n').includes(MARK), 'nothing of the account reaches debug');
    // claudeAuthStatus / claudeLoggedIn through a fake exec: the same single call detection makes
    const env = { platform: 'linux', env: {}, homedir: '/h', isFile: () => true, listDir: () => [] } as unknown as DetectEnv;
    const calls: string[][] = [];
    const exec = (out: Partial<{ code: number; stdout: string; timedOut: boolean; errorCode: string }>): Exec => async (file, args) => {
      calls.push([file, ...args]);
      return { code: 0, stdout: '', stderr: '', ...out };
    };
    assert.deepStrictEqual(await claudeAuthStatus('/x/claude', env, exec({ stdout: JSON.stringify({ loggedIn: true, email: 'e@example.com' }) })), { loggedIn: true, email: 'e@example.com' });
    assert.deepStrictEqual(calls[0], ['/x/claude', 'auth', 'status', '--json']);
    assert.strictEqual(await claudeAuthStatus('/x/claude', env, exec({ stdout: 'not json' })), undefined);
    assert.strictEqual(await claudeAuthStatus('/x/claude', env, exec({ stdout: '[1,2]' })), undefined);
    assert.strictEqual(await claudeAuthStatus('/x/claude', env, exec({ stdout: 'null' })), undefined);
    assert.strictEqual(await claudeAuthStatus('/x/claude', env, exec({ stdout: '{}', timedOut: true })), undefined);
    assert.strictEqual(await claudeAuthStatus('/x/claude', env, exec({ stdout: '{}', errorCode: 'ENOENT' })), undefined);
    assert.strictEqual(await claudeLoggedIn('/x/claude', env, exec({ stdout: '{"loggedIn":false}' })), false);
    assert.strictEqual(await claudeLoggedIn('/x/claude', env, exec({ stdout: '{"loggedIn":"yes"}' })), undefined);
    assert.strictEqual(await claudeLoggedIn('/x/claude', env, exec({ stdout: 'oops' })), undefined);
  }

  // ---- 3c. Codex adapter on the fake app-server: account/read with refreshToken false, on a short-lived child
  {
    const make = (account?: FakeCodexOptions['account']) => {
      const server = new FakeCodexServer(account === undefined ? {} : { account });
      const ad = new CodexAdapter({ spawn: server.spawn, locate: async () => ({ path: '/opt/codex/codex', version: '0.163.0' }), platform: 'linux', env: {}, appVersion: '9.9.9', closeGraceMs: 20, killGraceMs: 20 });
      const debug: string[] = [];
      ad.debug = (m) => debug.push(m);
      return { server, ad, debug };
    };
    const cases: Array<[FakeCodexOptions['account'], AccountIdentity]> = [
      [undefined, { status: 'signed-in', name: 'fake@example.invalid', service: 'ChatGPT', plan: 'ChatGPT Plus', method: 'account', provider: 'OpenAI (ChatGPT)', via: 'ChatGPT login' }],
      [{ account: { type: 'chatgpt', email: MARK, planType: 'pro' }, requiresOpenaiAuth: true }, { status: 'signed-in', name: MARK, service: 'ChatGPT', plan: 'ChatGPT Pro', method: 'account', provider: 'OpenAI (ChatGPT)', via: 'ChatGPT login' }],
      [{ account: { type: 'apiKey' }, requiresOpenaiAuth: true }, { status: 'signed-in', service: 'OpenAI', method: 'api-key', provider: 'OpenAI', via: 'API key' }],
      [{ account: null, requiresOpenaiAuth: true }, { status: 'signed-out' }],
      ['missing', { status: 'unknown' }],
      ['error', { status: 'unknown' }],
    ];
    for (const [acc, want] of cases) {
      const { server, ad, debug } = make(acc);
      assert.deepStrictEqual(await ad.accountInfo(), want, `accountInfo with ${JSON.stringify(acc)}`);
      const methods = server.wire.map((w) => w.method);
      assert.deepStrictEqual(methods.slice(0, 3), ['initialize', 'initialized', 'account/read']);
      assert.ok(!methods.some((m) => m.startsWith('thread/') || m.startsWith('turn/') || m === 'getAuthStatus'), 'no thread, no turn, no prompt, no token call');
      for (const r of server.requests('account/read')) assert.deepStrictEqual(r.params, { refreshToken: false }, 'no token refresh');
      await server.flush();
      assert.deepStrictEqual(server.live, [], 'the probe child is closed');
      assert.ok(!debug.join('\n').includes(MARK) && !debug.join('\n').includes('fake@example.invalid'), 'nothing of the account reaches debug');
      await ad.dispose();
    }
    const server = new FakeCodexServer();
    const ad = new CodexAdapter({ spawn: server.spawn, locate: async () => undefined, platform: 'linux', env: {} });
    assert.deepStrictEqual(await ad.accountInfo(), { status: 'unknown' }, 'Codex not found: unknown');
    assert.strictEqual(server.spawns.length, 0, 'nothing spawned');
  }

  // ---- 4. main's per-run cache (FR-014)
  {
    let list: AdapterInfo[] = [info('copilot', 'ready'), info('claude', 'not-signed-in'), info('codex', 'not-installed'), info('basic', 'ready')];
    const asked: string[] = [];
    let answer: AccountIdentity = { status: 'signed-in', name: 'octocat', service: 'GitHub' };
    const cache = createAccountCache({
      list: async () => list,
      check: (id) => (id === 'basic' ? undefined : async () => { asked.push(id); return answer; }),
    });
    assert.deepStrictEqual(await cache.get(), { copilot: { status: 'signed-in', text: 'Signed in as o••• (GitHub)', masked: 'o•••', name: 'octocat' }, claude: { status: 'signed-out', text: 'Not signed in' } });
    assert.deepStrictEqual(asked, ['copilot'], 'only a ready app with accountInfo is asked; a signed-out one is not; not-installed and no-method are left out');
    await cache.get();
    assert.deepStrictEqual(asked, ['copilot'], 'asked once per run');
    answer = { status: 'signed-in', name: 'other' };
    assert.strictEqual((await cache.get()).copilot.name, 'octocat', 'cached');
    assert.strictEqual((await cache.get(true)).copilot.name, 'other', 'refresh asks again');
    assert.deepStrictEqual(asked, ['copilot', 'copilot']);
    answer = { status: 'signed-in', name: 'after-sign-in' };
    cache.forget('copilot');
    assert.strictEqual((await cache.get()).copilot.name, 'after-sign-in', 'a finished sign-in clears that app');
    // an app that is no longer installed drops its answer
    list = [info('copilot', 'not-installed')];
    assert.deepStrictEqual(await cache.get(), {});
    list = [info('copilot', 'ready')];
    await cache.get();
    assert.strictEqual(asked.length, 4, 'asked again after it came back');
    // errors, wrong shapes and timeouts are "Account unknown"; a failing list is empty
    const slow = createAccountCache({ list: async () => [info('copilot', 'ready'), info('claude', 'ready'), info('codex', 'ready')], timeoutMs: 30,
      check: (id) => async () => {
        if (id === 'copilot') throw new Error(MARK);
        if (id === 'claude') return { nope: true } as unknown as AccountIdentity;
        return new Promise<AccountIdentity>(() => undefined);
      } });
    const t0 = Date.now();
    assert.deepStrictEqual(await slow.get(), { copilot: { status: 'unknown', text: 'Account unknown' }, claude: { status: 'unknown', text: 'Account unknown' }, codex: { status: 'unknown', text: 'Account unknown' } });
    assert.ok(Date.now() - t0 < 2000, 'the time limit holds');
    const syncThrow = createAccountCache({ list: async () => [info('copilot', 'ready')], check: () => () => { throw new Error('sync'); } });
    assert.deepStrictEqual(await syncThrow.get(), { copilot: { status: 'unknown', text: 'Account unknown' } });
    // review on #620 (item 2): concurrent refreshes join the running ask; a refresh after it settled asks again
    {
      let calls = 0;
      let release: (a: AccountIdentity) => void = () => undefined;
      const c = createAccountCache({ list: async () => [info('codex', 'ready')], check: () => () => { calls++; return new Promise<AccountIdentity>((r) => { release = r; }); } });
      const ps = Array.from({ length: 10 }, () => c.get(true));
      await until(() => calls >= 1, 'the first ask starts');
      await turn(); await turn(); // any extra ask would start in these turns
      assert.strictEqual(calls, 1, 'ten concurrent refreshes make one ask');
      release({ status: 'signed-in', name: 'one' });
      const all = await Promise.all(ps);
      assert.ok(all.every((x) => x.codex.name === 'one'), 'all ten get the same answer');
      await c.get(true);
      assert.strictEqual(calls, 2, 'a refresh after the ask settled asks again');
      release({ status: 'signed-in', name: 'two' });
    }
    // an ask still running after the time limit is not started again by a refresh (it is not stopped, so no second child piles up)
    {
      let calls = 0;
      let release: (a: AccountIdentity) => void = () => undefined;
      const c = createAccountCache({ list: async () => [info('codex', 'ready')], timeoutMs: 20, check: () => () => { calls++; return new Promise<AccountIdentity>((r) => { release = r; }); } });
      assert.strictEqual((await c.get(true)).codex.status, 'unknown', 'over the limit: unknown');
      assert.strictEqual((await c.get(true)).codex.status, 'unknown');
      assert.strictEqual(calls, 1, 'the slow call is joined, not repeated');
      release({ status: 'signed-in', name: 'late' });
      await turn(); // the settled call frees the slot in a promise reaction
      const again = c.get(true);
      await until(() => calls >= 2, 'a refresh after it settled asks again');
      assert.strictEqual(calls, 2, 'once it settled, a refresh asks again');
      release({ status: 'signed-in', name: 'second' });
      assert.strictEqual((await again).codex.name, 'second');
    }
    // a failed call also frees the slot
    {
      let calls = 0;
      const c = createAccountCache({ list: async () => [info('codex', 'ready')], check: () => async () => { calls++; throw new Error('x'); } });
      await c.get(true);
      await turn();
      await c.get(true);
      assert.strictEqual(calls, 2, 'a refresh after a failed ask asks again');
    }
    const broken = createAccountCache({ list: async () => { throw new Error('x'); }, check: () => undefined });
    assert.deepStrictEqual(await broken.get(), {});
  }

  // ---- 5. personal data stays on the window path (FR-015)
  {
    // adapters:list goes through withSignIn: the Claude adapter's sign-in check never carries the account, even when auth status has it
    const claude = new ClaudeAdapter({ sandboxFacts: SANDBOX_HOST_OK, claudePath: async () => '/x/claude', loggedIn: async () => true, authJson: async () => ({ loggedIn: true, authMethod: 'claude.ai', email: MARK }) });
    const listed = await withSignIn([info('claude', 'ready')], () => () => claude.verifySignIn());
    assert.ok(!JSON.stringify(listed).includes(MARK), 'adapters:list carries no account');
    // Copilot's sign-in check (verifySignIn) answers no login either
    const c = new AuthFakeClient();
    c.answer = { isAuthenticated: true, authType: 'user', login: MARK };
    const v = await new FakeCopilot(c).verifySignIn();
    assert.ok(!JSON.stringify(v).includes(MARK), 'verifySignIn carries no login');
    // source check: only these files touch the account path, and none of them writes a log, the activity log or an export
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|js)$/.test(e.name) ? [path.join(dir, e.name)] : []));
    const files = walk(path.join(ROOT, 'src')).map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
    const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    const touches = files.filter((f) => /\baccountInfo\b|harness:accounts|harnessAccounts|\bAccountView\b|\bcreateAccountCache\b|from '\.\/accounts'|from '\.\.\/accounts'/.test(strip(readSrc(f))));
    const ALLOWED = [
      'src/adapters/accounts.ts', 'src/adapters/claude.ts', 'src/adapters/codex.ts', 'src/adapters/copilot.ts', 'src/adapters/types.ts', 'src/main/accounts.ts',
      'src/main/ipc/harness.ts', 'src/main/simguard.ts', 'src/preload/preload.ts', 'src/shared/account.ts', 'src/shared/api.ts',
      'src/renderer/app.js', 'src/renderer/harnesses.js', 'src/renderer/screens.js', 'src/renderer/sim.ts',
    ];
    assert.deepStrictEqual(touches.filter((f) => !ALLOWED.includes(f)), [], 'the account path is in the listed files only');
    // main's cache and the mappers never log: no debug, console, stdout/stderr, file write or stream, activity entry or message
    const NO_LOG = /\b(debug|console\.|logActivity|appendActivity|toRenderer|writeFile|appendFile|writeSync|createWriteStream|process\.(stdout|stderr)|\.write\(|webContents|send\()/;
    for (const bad of ['process.stderr.write(x)', 'process.stdout.write(x)', 'fs.appendFile(p, x)', 'fs.createWriteStream(p)', 'fs.writeFileSync(p, x)', 'fs.appendFileSync(p, x)', 'this.debug?.(x)', 'console.error(x)', 'win.webContents.send(c, x)', 'stream.write(x)', 'fs.writeSync(fd, x)']) {
      assert.ok(NO_LOG.test(bad), `the no-log check catches ${bad}`);
    }
    for (const f of ['src/main/accounts.ts', 'src/adapters/accounts.ts', 'src/shared/account.ts']) {
      const s = strip(readSrc(f));
      assert.ok(!NO_LOG.test(s), `${f} writes no log`);
    }
    // the IPC handler only returns the answer: no log, no event broadcast, no activity entry in its block
    const ipc = strip(readSrc('src/main/ipc/harness.ts'));
    const block = ipc.slice(ipc.indexOf("ipcHandle('harness:accounts'"), ipc.indexOf("ipcHandle('harness:copilotAuth'"));
    assert.ok(block.length > 20 && !NO_LOG.test(block) && !/\blog\b/.test(block), 'harness:accounts only answers the window');
    assert.ok(/afterSignIn: async \(kind: string\) => \{\s*accounts\.forget\(kind\)/.test(ipc), 'a finished sign-in clears that app (FR-014)');
    const cacheBlock = ipc.slice(ipc.indexOf('const accounts = createAccountCache'), ipc.indexOf('const harnessSetup = new HarnessSetup'));
    assert.ok(cacheBlock.length > 20 && !NO_LOG.test(cacheBlock), 'the cache wiring logs nothing');
    // the adapters' accountInfo bodies never call debug
    for (const f of ['src/adapters/claude.ts', 'src/adapters/codex.ts', 'src/adapters/copilot.ts']) {
      const s = strip(readSrc(f));
      const body = bodyOf(s, 'async accountInfo(');
      assert.ok(body.length > 20, `${f} has accountInfo`);
      // Windows checks out CRLF: the same body must come out of a CRLF copy (CI windows-latest, 4a777a26)
      assert.strictEqual(bodyOf(s.replace(/\n/g, '\r\n'), 'async accountInfo('), body, `${f}: the body is found with CRLF endings too`);
      assert.ok(!NO_LOG.test(body), `${f} accountInfo does not log`);
      if (f.endsWith('copilot.ts')) {
        for (const head of ['private async planOf(', 'private startPlanRead(']) {
          const plan = bodyOf(s, head);
          assert.ok(plan.length > 20 && !NO_LOG.test(plan) && !/\.send\(\{|\bsend\(/.test(plan), `${head}: the plan read logs nothing and sends no message`);
        }
      }
    }
    // the window's account code sends nothing on: no bridge call but harnessAccounts in its lines
    const hs = readSrc('src/renderer/harnesses.js');
    const acc = hs.slice(hs.indexOf('let ACC = null'), hs.indexOf('/* a small modal'));
    assert.ok(acc.includes('B.harnessAccounts') && !/B\.(?!harnessAccounts)\w+\(/.test(acc), 'the window only reads the answer');
    // the simulator's fake identities are what accountView makes of fake answers (so the screenshots match the real wording, masked)
    const sim = readSrc('src/renderer/sim.ts');
    // the simulator's identities come from the real mappers, so its facts are worded as a real answer's would be
    const simCopilot = copilotAccount({ isAuthenticated: true, authType: 'gh-cli', host: 'https://github.com', login: 'octo-sim' });
    for (const a of [
      { ...simCopilot, plan: 'Copilot Individual' },
      simCopilot,
      claudeAccount({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'sim@example.com', subscriptionType: 'pro' }),
      claudeAccount({ loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty' }),
      codexAccount({ account: { type: 'chatgpt', email: 'sim@example.com', planType: 'plus' }, requiresOpenaiAuth: true }),
      { status: 'unknown' },
      { status: 'signed-out' },
    ] as AccountIdentity[]) {
      const v = accountView(a);
      const lit = '{ ' + Object.entries(v).map(([k, x]) => `${k}: '${x}'`).join(', ') + ' }';
      assert.ok(sim.includes(lit), `the simulator has ${lit}`);
    }
    // FR-016: the picker tooltips and About agent apps read the masked line only, never the clear name
    const appJs = readSrc('src/renderer/app.js');
    assert.ok(/ACCTS\[id\]\.text/.test(appJs) && !/ACCTS\[[^\]]+\]\.name|\.name\b[^;\n]*ACCTS|ACCTS[^;\n]*\.name\b/.test(appJs.replace(/k\.name/g, '')), 'app.js uses the masked text only');
    // the reveal is not saved: no storage or settings call in the window's account code
    assert.ok(!/localStorage|sessionStorage|setSettings|saveSettings|indexedDB/.test(acc), 'the reveal is never saved');
  }

  // ---- 7. FR-022 (Paco's re-review on #620): the Copilot plan session
  {
    const tune = (ad: FakeCopilot, o: Partial<Record<'planTimeoutMs' | 'planCleanupMs' | 'planStaleMs', number>> = {}): FakeCopilot => {
      Object.assign(ad as unknown as Record<string, number>, { planTimeoutMs: 40, planCleanupMs: 20, planStaleMs: 30_000, ...o });
      return ad;
    };
    const created = (c: FakeClient): Array<Record<string, unknown>> => (c as unknown as { created: Array<Record<string, unknown>> }).created;
    const deleted = (c: FakeClient): string[] => (c as unknown as { deleted: string[] }).deleted;
    const base = { status: 'signed-in', name: 'octocat', service: 'GitHub', method: 'gh-cli', provider: 'GitHub', via: 'GitHub CLI' };

    // item 1: every MCP server the runtime would start by itself is switched off by name, and none is passed in
    {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'acct-test-'));
      fs.writeFileSync(path.join(home, 'mcp-config.json'), JSON.stringify({ mcpServers: { notes: { command: 'node', args: ['x.js'] }, web: { type: 'http', url: 'https://example.invalid/mcp' } } }));
      const names = copilotServerNames(home);
      assert.ok(names.includes('notes') && names.includes('web') && names.length >= 3, `the config's servers and the built-in ones: ${names.join(',')}`);
      const c = new AuthFakeClient();
      const ad = tune(new FakeCopilot(c));
      const calls: AccountInfoOptions[] = [];
      const orig = ad.accountInfo.bind(ad);
      ad.accountInfo = (o?: AccountInfoOptions) => { calls.push(o ?? {}); return orig(o); };
      const check = accountCheck({ simulator: false, has: () => true, instance: () => ad, copilotServers: () => copilotServerNames(home) });
      assert.deepStrictEqual(await check('copilot')!({ recheck: false }), { ...base, plan: 'Copilot Individual' });
      assert.deepStrictEqual([...calls], [{ disabledMcpServers: names, recheck: false }], 'main passes the names and the recheck flag');
      const cfg = created(c)[0];
      assert.deepStrictEqual(cfg.disabledMcpServers, names, 'the plan session switches every one of them off');
      assert.deepStrictEqual(cfg.mcpServers, {}, 'and adds none');
      assert.ok((cfg.excludedTools as string[]).includes('mcp:*') && Array.isArray(cfg.availableTools) && (cfg.availableTools as unknown[]).length === 0);
      // another app gets no server list; the simulator and an app without the method get no check
      const other = { accountInfo: async (o?: AccountInfoOptions) => { calls.push(o ?? {}); return { status: 'unknown' } as AccountIdentity; } };
      await accountCheck({ simulator: false, has: () => true, instance: () => other, copilotServers: () => names })('claude')!({ recheck: true });
      assert.deepStrictEqual(calls[1], { disabledMcpServers: [], recheck: true });
      assert.strictEqual(accountCheck({ simulator: true, has: () => true, instance: () => other, copilotServers: () => names })('claude'), undefined, 'none under the simulator');
      assert.strictEqual(accountCheck({ simulator: false, has: () => true, instance: () => ({}), copilotServers: () => names })('codex'), undefined);
      assert.strictEqual(accountCheck({ simulator: false, has: () => false, instance: () => other, copilotServers: () => names })('codex'), undefined);
      // a broken server list still switches off what it can (here: nothing) rather than failing the line
      const bad = accountCheck({ simulator: false, has: () => true, instance: () => other, copilotServers: () => { throw new Error('x'); } });
      await bad('copilot')!({ recheck: false });
      assert.deepStrictEqual(calls[2], { disabledMcpServers: [], recheck: false });
      fs.rmSync(home, { recursive: true, force: true });
    }

    // item 4: at most one throw-away session per run; a recheck or a new sign-in asks again; a live session answers first
    {
      const c = new AuthFakeClient();
      const ad = tune(new FakeCopilot(c));
      await ad.accountInfo();
      await ad.accountInfo();
      await ad.accountInfo({ recheck: false });
      assert.strictEqual(created(c).length, 1, 'three asks, one throw-away session');
      assert.strictEqual((await ad.accountInfo({ recheck: true })).plan, 'Copilot Individual');
      assert.strictEqual(created(c).length, 2, 'Check again asks anew');
      await ad.refreshAuth();
      await ad.accountInfo();
      assert.strictEqual(created(c).length, 3, 'after a sign-in, asked anew');
      // concurrent asks share one session
      const c2 = new AuthFakeClient();
      const ad2 = tune(new FakeCopilot(c2));
      await Promise.all([ad2.accountInfo(), ad2.accountInfo(), ad2.accountInfo({ recheck: true })]);
      assert.ok(created(c2).length <= 2, `concurrent asks: ${created(c2).length} sessions`);
      // a running session answers: no throw-away at all
      const c3 = new AuthFakeClient();
      const ad3 = tune(new FakeCopilot(c3));
      const live = await c3.createSession({ sessionId: 'live-1' });
      (live as unknown as { statusAnswer: unknown }).statusAnswer = { copilotPlan: 'business' };
      (ad3 as unknown as { sessions: Map<string, unknown> }).sessions.set('live-1', { session: live });
      const n0 = created(c3).length;
      assert.strictEqual((await ad3.accountInfo()).plan, 'Copilot Business', 'the live session tells the plan');
      assert.strictEqual(created(c3).length, n0, 'no throw-away session while one is live');
      assert.strictEqual(deleted(c3).length, 0, 'the live session is left alone');
    }

    // item 2: one cap around the whole read; a hung or slow createSession never costs the line or blocks Check again
    {
      // createSession never answers
      const c = new AuthFakeClient();
      let makes = 0;
      c.createSession = () => { makes++; return new Promise<never>(() => undefined); };
      const ad = tune(new FakeCopilot(c));
      const t0 = Date.now();
      assert.deepStrictEqual(await ad.accountInfo(), base, 'a hung createSession: the account without a plan');
      assert.ok(Date.now() - t0 < 1000, 'within the cap');
      assert.deepStrictEqual(await ad.accountInfo({ recheck: true }), base, 'Check again answers too');
      assert.strictEqual(makes, 1, 'while it is still in flight, no second session is started beside it');
      tune(ad, { planStaleMs: 0 });
      await ad.accountInfo({ recheck: true });
      assert.strictEqual(makes, 2, 'a hung one past its ceiling no longer blocks Check again');
      // createSession answers late: the session is still disconnected and deleted, and its folder removed
      const c2 = new AuthFakeClient();
      const orig2 = c2.createSession.bind(c2);
      let lateId = '';
      c2.createSession = async (cfg: Record<string, unknown>) => { await new Promise((r) => setTimeout(r, 120)); const sx = await orig2(cfg); lateId = sx.sessionId; return sx; };
      const ad2 = tune(new FakeCopilot(c2));
      assert.deepStrictEqual(await ad2.accountInfo(), base, 'a slow createSession: the account without a plan');
      await until(() => !!lateId && deleted(c2).includes(lateId), 'the late session is deleted');
      assert.ok(lateId && deleted(c2).includes(lateId), 'the late session is deleted');
      assert.ok(!fs.existsSync(created(c2)[0].workingDirectory as string), 'and its folder removed');
      // cleanup calls that hang are capped too
      const c3 = new AuthFakeClient();
      const orig3 = c3.createSession.bind(c3);
      c3.createSession = async (cfg: Record<string, unknown>) => { const sx = await orig3(cfg); (sx as unknown as { disconnect: () => Promise<void> }).disconnect = () => new Promise<void>(() => undefined); return sx; };
      c3.deleteSession = () => new Promise<void>(() => undefined);
      const ad3 = tune(new FakeCopilot(c3), { planTimeoutMs: 500 });
      const t3 = Date.now();
      assert.deepStrictEqual(await ad3.accountInfo(), { ...base, plan: 'Copilot Individual' });
      assert.ok(Date.now() - t3 < 1000, 'hung cleanup calls do not hold the answer');
      await until(() => !fs.existsSync(created(c3)[0].workingDirectory as string), 'the folder is still removed');
      assert.ok(!fs.existsSync(created(c3)[0].workingDirectory as string), 'the folder is still removed');
    }

    // the cache: the recheck flag reaches the adapter; a sign-in makes the next ask a recheck; a hung ask has a ceiling
    {
      const seen: boolean[] = [];
      const cache = createAccountCache({ list: async () => [info('copilot', 'ready')], check: () => async (o) => { seen.push(o.recheck); return { status: 'signed-in', name: 'x' }; } });
      await cache.get();
      await cache.get(true);
      await cache.get(true, true);
      cache.forget('copilot');
      await cache.get();
      await cache.get(true);
      assert.deepStrictEqual(seen, [false, false, true, true, false], 'open = keep, Check again = recheck, after a sign-in = recheck once');
      let asks = 0;
      const hung = createAccountCache({ list: async () => [info('copilot', 'ready')], timeoutMs: 10, maxRunMs: 1500, check: () => () => { asks++; return new Promise<AccountIdentity>(() => undefined); } });
      await hung.get(true);
      await hung.get(true);
      assert.strictEqual(asks, 1, 'joined while young'); // the ceiling is far above the two 10 ms waits, so a slow runner cannot age the ask
      await until(async () => { await hung.get(true); return asks >= 2; }, 'past the ceiling a refresh asks again');
      assert.strictEqual(asks, 2, 'past the ceiling a refresh asks again');
    }

    // item 5: the sweep removes only our own old folders, directly in the temp folder, and never follows a link
    {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acct-sweep-'));
      const mk = (n: string, old: boolean): string => { const p = path.join(tmp, n); fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'f'), 'x'); if (old) { const t = new Date(Date.now() - 2 * 3600_000); fs.utimesSync(p, t, t); } return p; };
      mk('durbar-acct-old', true);
      mk('durbar-gen-old', true);
      const fresh = mk('durbar-acct-new', false);
      const other = mk('somebody-else-old', true);
      const target = mk('target', true);
      let linked = false;
      const oldT = new Date(Date.now() - 2 * 3600_000);
      try { fs.symlinkSync(target, path.join(tmp, 'durbar-acct-link'), 'dir'); fs.lutimesSync(path.join(tmp, 'durbar-acct-link'), oldT, oldT); linked = true; } catch { /* no symlinks here (Windows without the right): skipped */ }
      fs.writeFileSync(path.join(tmp, 'durbar-acct-file'), 'x');
      fs.utimesSync(path.join(tmp, 'durbar-acct-file'), oldT, oldT); // old too: only the type check keeps a file and a link
      const n = sweepStaleTempDirs(tmp, ['durbar-acct-', 'durbar-gen-'], Date.now(), 3600_000);
      assert.strictEqual(n, 2, 'the two old folders of ours');
      assert.ok(!fs.existsSync(path.join(tmp, 'durbar-acct-old')) && !fs.existsSync(path.join(tmp, 'durbar-gen-old')));
      assert.ok(fs.existsSync(fresh) && fs.existsSync(other) && fs.existsSync(path.join(tmp, 'durbar-acct-file')), 'a fresh one, someone else\'s and a file stay');
      if (linked) assert.ok(fs.existsSync(path.join(target, 'f')) && fs.lstatSync(path.join(tmp, 'durbar-acct-link')).isSymbolicLink(), 'an old link is neither followed nor removed');
      assert.strictEqual(sweepStaleTempDirs(tmp, ['', '../', 'x'], Date.now(), 0), 0, 'an empty or odd prefix sweeps nothing');
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  // ---- 6. review on #620 (item 4): `auth status` output over 64 KiB is refused (the exec's cap), not parsed
  {
    const env = { platform: process.platform, env: process.env, homedir: '/h', isFile: () => true, listDir: () => [] } as unknown as DetectEnv;
    // the child builds its output itself: a 70 KiB argument is over Windows' 32K command line (ENAMETOOLONG, CI windows-latest at b7bdc488)
    const script = (kib: number): string => `process.stdout.write(JSON.stringify({loggedIn:true,email:'x'.repeat(${kib}*1024)+'@example.com'}))`;
    assert.ok(script(70).length < 200, 'a short command line on every OS');
    const run: Exec = (file, args, o) => nodeExec(process.execPath, ['-e', script(70)], o);
    const r = await nodeExec(process.execPath, ['-e', script(70)], { timeoutMs: 10000 });
    assert.ok(r.errorCode && /MAXBUFFER/i.test(r.errorCode), `a child that prints more than 64 KiB is cut off: ${r.errorCode}`);
    assert.strictEqual(await claudeAuthStatus('/x/claude', env, run), undefined, 'too much output is unclear, not an identity');
    const ok = await nodeExec(process.execPath, ['-e', script(60)], { timeoutMs: 10000 });
    const small = JSON.stringify({ loggedIn: true, email: 'x'.repeat(60 * 1024) + '@example.com' });
    assert.ok(!ok.errorCode && ok.stdout.length === small.length, 'under the cap the output is whole');
  }

  finished = true;
  console.log('test:account ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

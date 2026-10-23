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
import * as fs from 'fs';
import * as path from 'path';
import { accountLine, accountView, cleanName, planWord, NAME_MAX } from '../src/shared/account';
import type { AccountIdentity } from '../src/shared/account';
import { claudeAccount, codexAccount, copilotAccount } from '../src/adapters/accounts';
import { ClaudeAdapter } from '../src/adapters/claude';
import { CodexAdapter } from '../src/adapters/codex';
import { claudeAuthStatus, claudeLoggedIn } from '../src/adapters/detect';
import type { DetectEnv, Exec } from '../src/adapters/detect';
import { createAccountCache } from '../src/main/accounts';
import { withSignIn } from '../src/main/authcheck';
import type { AdapterInfo } from '../src/shared/adapters';
import { FakeClient, FakeCopilot } from './fakes/copilot-sdk';
import { FakeCodexServer } from './fakes/codex-app-server';
import type { FakeCodexOptions } from './fakes/codex-app-server';

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
    assert.deepStrictEqual(accountView({ status: 'signed-in', name: 'a' }), { status: 'signed-in', text: 'Signed in as a' });
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
    assert.deepStrictEqual(copilotAccount({ isAuthenticated: true, authType: 'gh-cli', host: 'https://github.com', login: 'octocat' }), { status: 'signed-in', name: 'octocat', service: 'GitHub', method: 'gh-cli' });
    assert.deepStrictEqual(copilotAccount({ isAuthenticated: true, authType: 'user', login: 'octocat' }), { status: 'signed-in', name: 'octocat', service: 'GitHub', method: 'account' });
    assert.deepStrictEqual(copilotAccount({ isAuthenticated: true, authType: 'env' }), { status: 'signed-in', service: 'GitHub', method: 'token' });
    assert.deepStrictEqual(copilotAccount({ isAuthenticated: true, authType: 'token', login: 'bot' }), { status: 'signed-in', name: 'bot', service: 'GitHub', method: 'token' });
    assert.deepStrictEqual(copilotAccount({ isAuthenticated: true, authType: 'hmac' }), { status: 'signed-in', service: 'GitHub', method: 'api-key' });
    assert.deepStrictEqual(copilotAccount({ isAuthenticated: true, host: 'https://ghe.example.com/', login: 'me' }), { status: 'signed-in', name: 'me', service: 'ghe.example.com' });
    assert.deepStrictEqual(copilotAccount({ isAuthenticated: true, host: 'ghe.example.com', login: 'me' }).service, 'ghe.example.com');
    assert.deepStrictEqual(copilotAccount({ isAuthenticated: true, host: 'http://[bad', login: 'me' }).service, 'GitHub');
    assert.deepStrictEqual(copilotAccount({ isAuthenticated: true, login: 42, authType: 7 }), { status: 'signed-in', service: 'GitHub' });
    assert.ok(!JSON.stringify(copilotAccount({ isAuthenticated: true, login: 'o', statusMessage: MARK })).includes(MARK), 'statusMessage is never read');
    assert.deepStrictEqual(copilotAccount({ isAuthenticated: false, login: 'stale' }), { status: 'signed-out' });
    assert.deepStrictEqual(copilotAccount({ login: 'x' }), { status: 'unknown' });
    assert.deepStrictEqual(copilotAccount(null), { status: 'unknown' });
    assert.deepStrictEqual(copilotAccount('yes'), { status: 'unknown' });
    // Claude auth status --json (field names as in the 2.1.304 bundle)
    assert.deepStrictEqual(claudeAccount({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'you@example.com', orgId: 'o', orgName: 'Org', subscriptionType: 'pro' }), { status: 'signed-in', name: 'you@example.com', service: 'Claude', plan: 'Claude Pro', method: 'account' });
    assert.deepStrictEqual(claudeAccount({ loggedIn: true, authMethod: 'claude.ai', email: null, subscriptionType: null }), { status: 'signed-in', service: 'Claude', method: 'account' });
    assert.deepStrictEqual(claudeAccount({ loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty', apiKeySource: 'ANTHROPIC_API_KEY' }), { status: 'signed-in', service: 'Anthropic', method: 'api-key' });
    assert.deepStrictEqual(claudeAccount({ loggedIn: true, authMethod: 'api_key', email: 'k@example.com' }), { status: 'signed-in', name: 'k@example.com', service: 'Anthropic', method: 'api-key' });
    assert.deepStrictEqual(claudeAccount({ loggedIn: true, authMethod: 'oauth_token' }), { status: 'signed-in', service: 'Claude', method: 'token' });
    assert.deepStrictEqual(claudeAccount({ loggedIn: true, authMethod: 'third_party', apiProvider: 'bedrock' }), { status: 'signed-in', service: 'Amazon Bedrock', method: 'provider' });
    assert.deepStrictEqual(claudeAccount({ loggedIn: true, authMethod: 'api_key', apiProvider: 'vertex' }), { status: 'signed-in', service: 'Google Vertex AI', method: 'provider' });
    assert.deepStrictEqual(claudeAccount({ loggedIn: true, authMethod: 'third_party' }), { status: 'signed-in', method: 'provider' });
    assert.deepStrictEqual(claudeAccount({ loggedIn: true, authMethod: 'something-new' }), { status: 'signed-in' });
    assert.ok(!JSON.stringify(claudeAccount({ loggedIn: true, authMethod: 'claude.ai', orgName: MARK, orgId: MARK })).includes(MARK), 'the organisation is not read');
    assert.deepStrictEqual(claudeAccount({ loggedIn: false, authMethod: 'none', email: 'stale@example.com' }), { status: 'signed-out' });
    assert.deepStrictEqual(claudeAccount({ loggedIn: true, authMethod: 'none' }), { status: 'signed-out' });
    assert.deepStrictEqual(claudeAccount({ loggedIn: 'yes' }), { status: 'unknown' });
    assert.deepStrictEqual(claudeAccount(undefined), { status: 'unknown' });
    assert.deepStrictEqual(claudeAccount([1]), { status: 'unknown' });
    // Codex account/read (GetAccountResponse of codex-cli 0.163.0)
    assert.deepStrictEqual(codexAccount({ account: { type: 'chatgpt', email: 'you@example.com', planType: 'plus' }, requiresOpenaiAuth: true }), { status: 'signed-in', name: 'you@example.com', service: 'ChatGPT', plan: 'ChatGPT Plus', method: 'account' });
    assert.deepStrictEqual(codexAccount({ account: { type: 'chatgpt', email: null, planType: 'unknown' }, requiresOpenaiAuth: true }), { status: 'signed-in', service: 'ChatGPT', method: 'account' });
    assert.deepStrictEqual(codexAccount({ account: { type: 'apiKey' }, requiresOpenaiAuth: true }), { status: 'signed-in', service: 'OpenAI', method: 'api-key' });
    assert.deepStrictEqual(codexAccount({ account: { type: 'amazonBedrock', usesCodexManagedCredentials: false }, requiresOpenaiAuth: false }), { status: 'signed-in', service: 'Amazon Bedrock', method: 'provider' });
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
    const debug: string[] = [];
    ad.debug = (m) => debug.push(m);
    assert.deepStrictEqual(await ad.accountInfo(), { status: 'signed-in', name: 'octocat', service: 'GitHub', method: 'gh-cli' });
    assert.deepStrictEqual(c.authCalls, ['getAuthStatus'], 'only the local status: no quota, no model call');
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
      const a = new ClaudeAdapter({ claudePath: async () => '/x/claude', authJson: async () => { if (j === 'throw') throw new Error(MARK); return j as Record<string, unknown> | undefined; } });
      a.debug = (m) => debug.push(m);
      return a;
    };
    assert.deepStrictEqual(await mk({ loggedIn: true, authMethod: 'claude.ai', email: MARK, subscriptionType: 'max' }).accountInfo(), { status: 'signed-in', name: MARK, service: 'Claude', plan: 'Claude Max', method: 'account' });
    assert.deepStrictEqual(await mk({ loggedIn: false }).accountInfo(), { status: 'signed-out' });
    assert.deepStrictEqual(await mk(undefined).accountInfo(), { status: 'unknown' });
    assert.deepStrictEqual(await mk('throw').accountInfo(), { status: 'unknown' });
    assert.deepStrictEqual(await new ClaudeAdapter({ claudePath: async () => undefined }).accountInfo(), { status: 'unknown' }, 'no claude found: unknown, nothing runs');
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
      [undefined, { status: 'signed-in', name: 'fake@example.invalid', service: 'ChatGPT', plan: 'ChatGPT Plus', method: 'account' }],
      [{ account: { type: 'chatgpt', email: MARK, planType: 'pro' }, requiresOpenaiAuth: true }, { status: 'signed-in', name: MARK, service: 'ChatGPT', plan: 'ChatGPT Pro', method: 'account' }],
      [{ account: { type: 'apiKey' }, requiresOpenaiAuth: true }, { status: 'signed-in', service: 'OpenAI', method: 'api-key' }],
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
    assert.deepStrictEqual(await cache.get(), { copilot: { status: 'signed-in', text: 'Signed in as octocat (GitHub)' }, claude: { status: 'signed-out', text: 'Not signed in' } });
    assert.deepStrictEqual(asked, ['copilot'], 'only a ready app with accountInfo is asked; a signed-out one is not; not-installed and no-method are left out');
    await cache.get();
    assert.deepStrictEqual(asked, ['copilot'], 'asked once per run');
    answer = { status: 'signed-in', name: 'other' };
    assert.strictEqual((await cache.get()).copilot.text, 'Signed in as octocat (GitHub)', 'cached');
    assert.strictEqual((await cache.get(true)).copilot.text, 'Signed in as other', 'refresh asks again');
    assert.deepStrictEqual(asked, ['copilot', 'copilot']);
    answer = { status: 'signed-in', name: 'after-sign-in' };
    cache.forget('copilot');
    assert.strictEqual((await cache.get()).copilot.text, 'Signed in as after-sign-in', 'a finished sign-in clears that app');
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
    const broken = createAccountCache({ list: async () => { throw new Error('x'); }, check: () => undefined });
    assert.deepStrictEqual(await broken.get(), {});
  }

  // ---- 5. personal data stays on the window path (FR-015)
  {
    // adapters:list goes through withSignIn: the Claude adapter's sign-in check never carries the account, even when auth status has it
    const claude = new ClaudeAdapter({ claudePath: async () => '/x/claude', loggedIn: async () => true, authJson: async () => ({ loggedIn: true, authMethod: 'claude.ai', email: MARK }) });
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
    const touches = files.filter((f) => /\baccountInfo\b|harness:accounts|harnessAccounts|\bAccountView\b|\bcreateAccountCache\b|from '\.\/accounts'|from '\.\.\/accounts'/.test(strip(fs.readFileSync(path.join(ROOT, f), 'utf8'))));
    const ALLOWED = [
      'src/adapters/accounts.ts', 'src/adapters/claude.ts', 'src/adapters/codex.ts', 'src/adapters/copilot.ts', 'src/adapters/types.ts', 'src/main/accounts.ts',
      'src/main/ipc/harness.ts', 'src/main/simguard.ts', 'src/preload/preload.ts', 'src/shared/account.ts', 'src/shared/api.ts',
      'src/renderer/app.js', 'src/renderer/harnesses.js', 'src/renderer/screens.js', 'src/renderer/sim.ts',
    ];
    assert.deepStrictEqual(touches.filter((f) => !ALLOWED.includes(f)), [], 'the account path is in the listed files only');
    // main's cache and the mappers never log
    for (const f of ['src/main/accounts.ts', 'src/adapters/accounts.ts', 'src/shared/account.ts']) {
      const s = strip(fs.readFileSync(path.join(ROOT, f), 'utf8'));
      assert.ok(!/\b(debug|console\.|logActivity|appendActivity|toRenderer|writeFile)/.test(s), `${f} writes no log`);
    }
    // the IPC handler only returns the answer: no log, no event broadcast, no activity entry in its block
    const ipc = strip(fs.readFileSync(path.join(ROOT, 'src/main/ipc/harness.ts'), 'utf8'));
    const block = ipc.slice(ipc.indexOf("ipcHandle('harness:accounts'"), ipc.indexOf("ipcHandle('harness:copilotAuth'"));
    assert.ok(block.length > 20 && !/\b(debug|console\.|log|toRenderer|send)\b/.test(block), 'harness:accounts only answers the window');
    assert.ok(/afterSignIn: async \(kind: string\) => \{\s*accounts\.forget\(kind\)/.test(ipc), 'a finished sign-in clears that app (FR-014)');
    const cacheBlock = ipc.slice(ipc.indexOf('const accounts = createAccountCache'), ipc.indexOf('const harnessSetup = new HarnessSetup'));
    assert.ok(cacheBlock.length > 20 && !/\b(debug|console\.|toRenderer)\b/.test(cacheBlock), 'the cache wiring logs nothing');
    // the adapters' accountInfo bodies never call debug
    for (const f of ['src/adapters/claude.ts', 'src/adapters/codex.ts', 'src/adapters/copilot.ts']) {
      const s = strip(fs.readFileSync(path.join(ROOT, f), 'utf8'));
      const i = s.indexOf('async accountInfo(');
      assert.ok(i > 0, `${f} has accountInfo`);
      const body = s.slice(i, s.indexOf('\n  }\n', i));
      assert.ok(!/debug|console\./.test(body), `${f} accountInfo does not log`);
    }
    // the window's account code sends nothing on: no bridge call but harnessAccounts in its lines
    const hs = fs.readFileSync(path.join(ROOT, 'src/renderer/harnesses.js'), 'utf8');
    const acc = hs.slice(hs.indexOf('let ACC = null'), hs.indexOf('/* a small modal'));
    assert.ok(acc.includes('B.harnessAccounts') && !/B\.(?!harnessAccounts)\w+\(/.test(acc), 'the window only reads the answer');
    // the simulator's fake identities are what accountLine makes of fake answers (so the screenshots match the real wording)
    const sim = fs.readFileSync(path.join(ROOT, 'src/renderer/sim.ts'), 'utf8');
    for (const [a, t] of [
      [{ status: 'signed-in', name: 'octo-sim', service: 'GitHub', method: 'gh-cli' }, 'Signed in as octo-sim (GitHub, through the GitHub CLI)'],
      [{ status: 'signed-in', name: 'sim@example.com', plan: 'Claude Pro' }, 'Signed in as sim@example.com · Claude Pro'],
      [{ status: 'signed-in', service: 'Anthropic', method: 'api-key' }, 'Signed in with an Anthropic API key'],
      [{ status: 'signed-in', name: 'sim@example.com', plan: 'ChatGPT Plus' }, 'Signed in as sim@example.com · ChatGPT Plus'],
      [{ status: 'unknown' }, 'Account unknown'],
      [{ status: 'signed-out' }, 'Not signed in'],
    ] as Array<[AccountIdentity, string]>) {
      assert.strictEqual(accountLine(a), t);
      assert.ok(sim.includes(`'${t}'`), `the simulator shows "${t}"`);
    }
  }

  console.log('test:account ok');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

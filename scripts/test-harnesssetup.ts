/** Harness setup inside the app (spec 051): plans per OS, sign-in output parsing, link allowlist, paste rules. `npm run test:harnesssetup`. No process runs, nothing is installed. */
import * as assert from 'assert';
import { OFFICIAL_PAGES, SIGN_IN, allowedSignInUrl, installPlans, lastLines, managersFor, parseSignIn, stripAnsi, updatePlans, validPaste } from '../src/shared/harnesssetup';
import type { PackageManager } from '../src/shared/harnesssetup';

const all = new Set<PackageManager>(['winget', 'brew', 'npm']);
const only = (...m: PackageManager[]) => new Set<PackageManager>(m);

// FR-002: routes per OS, in order, only the managers found
{
  assert.deepStrictEqual(installPlans('claude', 'win32', all).map((p) => p.display), [
    'winget install --id Anthropic.ClaudeCode -e --accept-source-agreements --accept-package-agreements',
    'npm install -g @anthropic-ai/claude-code',
  ]);
  assert.deepStrictEqual(installPlans('claude', 'darwin', all).map((p) => p.display), ['brew install --cask claude-code', 'npm install -g @anthropic-ai/claude-code']);
  assert.match(installPlans('claude', 'darwin', all)[1].note ?? '', /Deprecated/);
  assert.deepStrictEqual(installPlans('copilot', 'darwin', all).map((p) => p.display), ['brew install --cask copilot-cli', 'npm install -g @github/copilot']);
  assert.deepStrictEqual(installPlans('copilot', 'win32', all)[0].args, ['install', '--id', 'GitHub.Copilot', '-e', '--accept-source-agreements', '--accept-package-agreements']);
  assert.deepStrictEqual(installPlans('codex', 'linux', all).map((p) => p.display), ['npm install -g @openai/codex']);
  assert.deepStrictEqual(installPlans('codex', 'darwin', all).map((p) => p.display), ['brew install --cask codex', 'npm install -g @openai/codex']);
  assert.match(installPlans('codex', 'win32', all)[0].note ?? '', /experimental/);
  // only what was found on PATH
  assert.deepStrictEqual(installPlans('claude', 'darwin', only('npm')).map((p) => p.manager), ['npm']);
  assert.deepStrictEqual(installPlans('claude', 'linux', only()), [], 'nothing found: no plan (FR-003 opens the page)');
  assert.deepStrictEqual(installPlans('claude', 'freebsd', all), [], 'an unknown OS has no plan');
  // updates use the same manager
  assert.deepStrictEqual(updatePlans('claude', 'darwin', all).map((p) => p.display), ['brew upgrade --cask claude-code', 'npm install -g @anthropic-ai/claude-code@latest']);
  assert.deepStrictEqual(updatePlans('copilot', 'win32', only('winget'))[0].args.slice(0, 3), ['upgrade', '--id', 'GitHub.Copilot']);
  // plans are copies: changing one never changes the next
  const p = installPlans('codex', 'linux', all)[0];
  p.args.push('--evil');
  assert.deepStrictEqual(installPlans('codex', 'linux', all)[0].args, ['install', '-g', '@openai/codex']);
  // every arg is a plain word: no shell syntax anywhere
  for (const k of ['claude', 'codex', 'copilot'] as const) for (const os of ['win32', 'darwin', 'linux']) for (const pl of [...installPlans(k, os, all), ...updatePlans(k, os, all)]) for (const a of pl.args) assert.match(a, /^[A-Za-z0-9@/._-]+$/, `${k} ${os}: ${a}`);
  assert.deepStrictEqual(managersFor('win32'), ['winget', 'npm']);
  assert.deepStrictEqual(managersFor('darwin'), ['brew', 'npm']);
  for (const u of Object.values(OFFICIAL_PAGES)) assert.match(u, /^https:\/\//);
}

// FR-005: sign-in output, as captured 2026-10-19 without a terminal (codes replaced by fakes)
{
  const codex = '\u001b[0mWelcome to Codex [v\u001b[90m0.163.0\u001b[0m]\n\nFollow these steps to sign in with ChatGPT using device code authorization:\n\n1. Open this link in your browser and sign in to your account\n   \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m\n\n2. Enter this one-time code \u001b[90m(expires in 15 minutes)\u001b[0m\n   \u001b[94mAB12-CD34E\u001b[0m\n';
  assert.deepStrictEqual(parseSignIn('codex', codex), { url: 'https://auth.openai.com/codex/device', code: 'AB12-CD34E', needsPaste: false });
  const copilot = 'To authenticate, visit https://github.com/login/device and enter code 1A2B-3C4D\nWaiting for authorization...\n';
  assert.deepStrictEqual(parseSignIn('copilot', copilot), { url: 'https://github.com/login/device', code: '1A2B-3C4D', needsPaste: false });
  const claude = "Opening browser to sign in…\nIf the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=x&state=abc\nPaste code here if prompted > ";
  const c = parseSignIn('claude', claude);
  assert.strictEqual(c.url, 'https://claude.com/cai/oauth/authorize?code=true&client_id=x&state=abc');
  assert.strictEqual(c.code, undefined, 'Claude shows no device code');
  assert.strictEqual(c.needsPaste, true);
  assert.strictEqual(parseSignIn('claude', 'Opening browser to sign in…\n').needsPaste, false, 'not asked yet');
  // partial output: the link first, the code later
  assert.deepStrictEqual(parseSignIn('copilot', 'To authenticate, visit https://github.com/login/device'), { url: 'https://github.com/login/device', needsPaste: false });
  // a link on another host is never taken, even when it comes first
  assert.strictEqual(parseSignIn('copilot', 'see https://evil.example/login/device then https://github.com/login/device code 1A2B-3C4D').url, 'https://github.com/login/device');
  assert.strictEqual(parseSignIn('codex', 'visit https://auth.openai.com.evil.example/device AB12-CD34E').url, undefined);
  // a code-like piece inside the link is not the code
  assert.strictEqual(parseSignIn('copilot', 'visit https://github.com/login/device?x=ABCD-1234').code, undefined);
}

// link allowlist
{
  assert.ok(allowedSignInUrl('codex', 'https://auth.openai.com/codex/device'));
  assert.ok(allowedSignInUrl('claude', 'https://platform.claude.com/oauth/code/callback'));
  assert.ok(allowedSignInUrl('claude', 'https://console.anthropic.com/x'));
  assert.ok(!allowedSignInUrl('codex', 'http://auth.openai.com/codex/device'), 'https only');
  assert.ok(!allowedSignInUrl('copilot', 'https://github.com.evil.example/login'), 'not a suffix trick');
  assert.ok(!allowedSignInUrl('copilot', 'https://evilgithub.com/login'), 'not a prefix trick');
  assert.ok(!allowedSignInUrl('copilot', 'https://user:pw@github.com/login'), 'no user info');
  assert.ok(!allowedSignInUrl('copilot', 'https://github.com:8443/login'), 'no odd port');
  assert.ok(!allowedSignInUrl('claude', 'https://auth.openai.com/x'), 'each harness its own hosts');
  assert.ok(!allowedSignInUrl('codex', 'javascript:alert(1)'));
  assert.ok(!allowedSignInUrl('codex', 'not a url'));
}

// FR-005: paste rules
{
  assert.strictEqual(validPaste('  abc123#xyz  '), 'abc123#xyz');
  assert.strictEqual(validPaste(''), undefined);
  assert.strictEqual(validPaste('a\nb'), undefined, 'no line breaks: one line only reaches the process');
  assert.strictEqual(validPaste('a\u0003b'), undefined, 'no control characters');
  assert.strictEqual(validPaste('x'.repeat(513)), undefined);
  assert.strictEqual(validPaste('x'.repeat(512)), 'x'.repeat(512));
  assert.strictEqual(validPaste(42), undefined);
}

// output helpers
{
  assert.strictEqual(stripAnsi('\u001b[94mhi\u001b[0m\u001b]0;title\u0007 there'), 'hi there');
  assert.strictEqual(stripAnsi('50%\r60%\r\n'), '50%\n60%\r\n');
  assert.deepStrictEqual(lastLines('a\n\nb\n\u001b[31mc\u001b[0m\nd\ne\nf\ng\n'), ['b', 'c', 'd', 'e', 'f', 'g']);
  assert.strictEqual(lastLines('x'.repeat(300))[0].length, 200);
  assert.deepStrictEqual(Object.keys(SIGN_IN).sort(), ['claude', 'codex', 'copilot']);
}

console.log('harnesssetup: all checks passed');

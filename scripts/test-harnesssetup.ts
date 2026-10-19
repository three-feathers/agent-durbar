/** Harness setup inside the app (spec 051): plans per OS, sign-in output parsing, link allowlist, paste rules. `npm run test:harnesssetup`. No process runs, nothing is installed. */
import * as assert from 'assert';
import { OFFICIAL_PAGES, SIGN_IN, allowedSignInUrl, installPlans, lastLines, managersFor, parseSignIn, stripAnsi, updatePlans, validPaste } from '../src/shared/harnesssetup';
import type { PackageManager } from '../src/shared/harnesssetup';
import { EventEmitter } from 'events';
import { HarnessSetup } from '../src/main/harnesssetup';
import type { ChildLike, SetupDone, SetupProgress } from '../src/main/harnesssetup';

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

// FR-004/FR-005: the runner, with a fake process (nothing runs)
void (async () => {
  type Call = { file: string; args: readonly string[]; opts: { stdio: unknown[]; windowsVerbatimArguments?: boolean; detached?: boolean } };
  const mk = (platform: NodeJS.Platform, files: string[], extra: Partial<{ limits: { install: number; signin: number } }> = {}) => {
    const calls: Call[] = [], prog: SetupProgress[] = [], done: SetupDone[] = [], killed: ChildLike[] = [], written: string[] = [];
    let redetects = 0, child!: ChildLike & EventEmitter & { out: EventEmitter; err: EventEmitter };
    const setup = new HarnessSetup({
      detectEnv: { platform, env: platform === 'win32' ? { PATH: 'C:\\Program Files\\nodejs', SystemRoot: 'C:\\Windows' } : { PATH: '/usr/bin' }, homedir: platform === 'win32' ? 'C:\\Users\\u' : '/home/u', isFile: (f) => files.includes(f) },
      spawn: (file, args, opts) => {
        calls.push({ file, args, opts });
        const out = new EventEmitter(), err = new EventEmitter();
        child = Object.assign(new EventEmitter(), { pid: 42, out, err, stdout: out, stderr: err, stdin: { write: (x: string) => written.push(x), end: () => undefined } }) as unknown as typeof child;
        return child;
      },
      killTree: (c) => { killed.push(c); setImmediate(() => (c as unknown as EventEmitter).emit('close', null)); },
      send: ((ch: string, p: SetupProgress | SetupDone) => (ch === 'harness:done' ? done.push(p as SetupDone) : prog.push(p as SetupProgress))) as never,
      redetect: async () => { redetects++; },
      ...extra,
    });
    return { setup, calls, prog, done, killed, written, child: () => child, redetects: () => redetects };
  };
  const tick = () => new Promise((r) => setImmediate(r));

  // Codex sign-in: argv, no stdin, link and code streamed, re-check on exit
  {
    const t = mk('linux', ['/usr/bin/codex']);
    assert.deepStrictEqual(t.setup.run('codex', 'signin'), { ok: true });
    assert.strictEqual(t.calls[0].file, '/usr/bin/codex');
    assert.deepStrictEqual(t.calls[0].args, ['login', '--device-auth']);
    assert.strictEqual(t.calls[0].opts.stdio[0], 'ignore', 'device flow: no input');
    assert.strictEqual(t.calls[0].opts.detached, true, 'own process group (tree kill)');
    assert.deepStrictEqual(t.setup.run('codex', 'signin'), { ok: false, error: 'Another setup step is still running.' }, 'one at a time');
    t.child().out.emit('data', '1. Open https://auth.openai.com/codex/device\n2. Enter this one-time code\n   AB12-CD34E\n');
    const last = t.prog[t.prog.length - 1];
    assert.strictEqual(last.url, 'https://auth.openai.com/codex/device');
    assert.strictEqual(last.code, 'AB12-CD34E');
    t.child().emit('close', 0); await tick(); await tick();
    assert.strictEqual(t.redetects(), 1);
    assert.strictEqual(t.done[0].ok, true);
    assert.ok(!t.setup.busy);
  }
  // Claude: the pasted code goes to its input only; bad pastes are refused; device flows take no paste
  {
    const t = mk('linux', ['/usr/bin/claude']);
    assert.ok(t.setup.run('claude', 'signin').ok);
    assert.strictEqual(t.calls[0].opts.stdio[0], 'pipe');
    t.child().out.emit('data', 'visit: https://claude.com/cai/oauth/authorize?x=1\nPaste code here if prompted > ');
    assert.strictEqual(t.prog[t.prog.length - 1].needsPaste, true);
    assert.deepStrictEqual(t.setup.paste('a\nb'), { ok: false, error: 'Paste the code from the sign-in page (one line).' });
    assert.deepStrictEqual(t.setup.paste('  code#123  '), { ok: true });
    assert.deepStrictEqual(t.written, ['code#123\n']);
    t.child().emit('close', 0); await tick(); await tick();
    const d = mk('linux', ['/usr/bin/codex']); d.setup.run('codex', 'signin');
    assert.strictEqual(d.setup.paste('x').ok, false, 'Codex takes no pasted text');
  }
  // Copilot sign-in needs the Copilot CLI (FR-006)
  {
    const t = mk('linux', []);
    const r = t.setup.run('copilot', 'signin');
    assert.ok(!r.ok && /Copilot CLI is not installed/.test((r as { error: string }).error));
    assert.strictEqual(t.calls.length, 0);
  }
  // cancel and timeout stop the tree and report it
  {
    const t = mk('linux', ['/usr/bin/codex']);
    t.setup.run('codex', 'signin');
    assert.ok(t.setup.cancel());
    await tick(); await tick(); await tick();
    assert.strictEqual(t.killed.length, 1);
    assert.deepStrictEqual([t.done[0].ok, t.done[0].reason], [false, 'cancelled']);
    const o = mk('linux', ['/usr/bin/npm'], { limits: { install: 20, signin: 20 } });
    assert.ok(o.setup.run('codex', 'install').ok);
    assert.deepStrictEqual(o.calls[0].args, ['install', '-g', '@openai/codex']);
    await new Promise((r) => setTimeout(r, 60)); await tick(); await tick();
    assert.deepStrictEqual([o.done[0].ok, o.done[0].reason], [false, 'timeout']);
  }
  // install: the plan the user picked, only managers that exist; nothing found = no plan
  {
    const t = mk('linux', []);
    assert.deepStrictEqual(t.setup.plans('codex', 'install').plans, []);
    assert.match(t.setup.plans('codex', 'install').page, /^https:\/\//);
    const r = t.setup.run('codex', 'install');
    assert.ok(!r.ok && /official page/.test((r as { error: string }).error));
    const b = mk('linux', ['/home/linuxbrew/.linuxbrew/bin/brew', '/usr/bin/npm']);
    assert.deepStrictEqual(b.setup.plans('claude', 'install').plans.map((p) => p.manager), ['brew', 'npm'], 'Linuxbrew is found');
    b.setup.run('claude', 'install', 1);
    assert.deepStrictEqual(b.calls[0].args, ['install', '-g', '@anthropic-ai/claude-code']);
  }
  // Windows: npm.cmd through cmd /d /s /c with its own quotes; an unsafe path is refused
  {
    const t = mk('win32', ['C:\\Program Files\\nodejs\\npm.cmd']);
    assert.ok(t.setup.run('codex', 'install').ok);
    assert.strictEqual(t.calls[0].file, 'C:\\Windows\\System32\\cmd.exe');
    assert.deepStrictEqual(t.calls[0].args, ['/d', '/s', '/c', '"C:\\Program Files\\nodejs\\npm.cmd" install -g @openai/codex']);
    assert.strictEqual(t.calls[0].opts.windowsVerbatimArguments, true);
    assert.strictEqual(t.calls[0].opts.detached, false);
    const u = mk('win32', ['C:\\a&b\\npm.cmd']);
    (u.setup['deps'].detectEnv.env as Record<string, string>).PATH = 'C:\\a&b';
    assert.ok(!u.setup.run('codex', 'install').ok, 'a path with & is refused');
  }
  // output lines are redacted before they reach the window
  {
    const t = mk('linux', ['/usr/bin/npm']);
    t.setup.run('codex', 'install');
    t.child().err.emit('data', 'npm ERR! token ghp_0123456789abcdefghijABCDEFGHIJ0123456789 rejected\n');
    assert.ok(!t.prog[t.prog.length - 1].lines.join(' ').includes('ghp_0123456789'), 'redacted');
    t.child().emit('close', 1); await tick(); await tick();
    assert.deepStrictEqual([t.done[0].ok, t.done[0].exitCode], [false, 1]);
  }
  console.log('harnesssetup: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });

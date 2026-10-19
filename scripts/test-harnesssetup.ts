/** Harness setup inside the app (spec 051): plans per OS, sign-in output parsing, link allowlist, paste rules. `npm run test:harnesssetup`. No process runs, nothing is installed. */
import * as assert from 'assert';
import { OFFICIAL_PAGES, SIGN_IN, allowedSignInUrl, installPlans, lastLines, managersFor, parseSignIn, stripAnsi, updatePlans, validPaste } from '../src/shared/harnesssetup';
import type { PackageManager } from '../src/shared/harnesssetup';
import { EventEmitter } from 'events';
import { HarnessSetup, confirmText, maskOAuth, posixTrusted } from '../src/main/harnesssetup';
import { senderAllowed } from '../src/main/hardening';
import type { ChildLike, SetupDone, SetupProgress } from '../src/main/harnesssetup';

const all = new Set<PackageManager>(['winget', 'brew', 'npm']);
const only = (...m: PackageManager[]) => new Set<PackageManager>(m);

// FR-002: routes per OS, in order, only the managers found
{
  assert.deepStrictEqual(installPlans('claude', 'win32', all).map((p) => p.display), [
    'winget install --id Anthropic.ClaudeCode -e --source winget --accept-source-agreements --accept-package-agreements',
    'npm install -g @anthropic-ai/claude-code',
  ]);
  assert.deepStrictEqual(installPlans('claude', 'darwin', all).map((p) => p.display), ['brew install --cask claude-code', 'npm install -g @anthropic-ai/claude-code']);
  assert.match(installPlans('claude', 'darwin', all)[1].note ?? '', /Deprecated/);
  assert.deepStrictEqual(installPlans('copilot', 'darwin', all).map((p) => p.display), ['brew install --cask copilot-cli', 'npm install -g @github/copilot']);
  assert.deepStrictEqual(installPlans('copilot', 'win32', all)[0].args, ['install', '--id', 'GitHub.Copilot', '-e', '--source', 'winget', '--accept-source-agreements', '--accept-package-agreements']);
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
  const mk = (platform: NodeJS.Platform, files: string[], extra: Partial<{ limits: { install: number; signin: number }; progressMs: number; now: () => number; realpath: (p: string) => string; trustedPath: (p: string) => boolean }> = {}) => {
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
      progressMs: 0,
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
  // FR-004b: prepare resolves without running; the real path is what is confirmed and spawned; untrusted folders are refused
  {
    const t = mk('linux', ['/usr/bin/npm'], { realpath: (p) => (p === '/usr/bin/npm' ? '/usr/lib/node_modules/npm/bin/npm-cli.js' : p) });
    const p = t.setup.prepare('codex', 'install');
    assert.ok(p.ok);
    assert.strictEqual(t.calls.length, 0, 'prepare runs nothing');
    const job = (p as { job: Parameters<typeof confirmText>[0] }).job;
    assert.strictEqual(job.file, '/usr/lib/node_modules/npm/bin/npm-cli.js');
    const c = confirmText(job);
    assert.strictEqual(c.message, 'Install the Codex CLI?');
    assert.ok(c.detail.includes('/usr/lib/node_modules/npm/bin/npm-cli.js install -g @openai/codex'), 'the exact program and arguments');
    assert.ok(t.setup.start(job).ok);
    assert.strictEqual(t.calls[0].file, '/usr/lib/node_modules/npm/bin/npm-cli.js');
    const u = mk('linux', ['/tmp/x/npm'], { trustedPath: (f) => !f.startsWith('/tmp/') });
    (u.setup['deps'].detectEnv.env as Record<string, string>).PATH = '/tmp/x';
    const r = u.setup.run('codex', 'install');
    assert.ok(!r.ok && /anyone on this computer can change/.test((r as { error: string }).error));
    assert.strictEqual(u.calls.length, 0);
    const gone = mk('linux', ['/usr/bin/npm'], { realpath: () => { throw new Error('ENOENT'); } });
    assert.ok(!gone.setup.run('codex', 'install').ok, 'a vanished binary is not run');
    const modes: Record<string, number> = { '/usr/bin/npm': 0o100755, '/usr/bin': 0o40755, '/tmp/npm': 0o100755, '/tmp': 0o41777, '/opt/w/npm': 0o100777, '/opt/w': 0o40755 };
    const modeOf = (q: string) => { if (!(q in modes)) throw new Error('ENOENT'); return modes[q]; };
    assert.strictEqual(posixTrusted('/usr/bin/npm', modeOf), true);
    assert.strictEqual(posixTrusted('/tmp/npm', modeOf), false, 'world-writable folder (even sticky)');
    assert.strictEqual(posixTrusted('/opt/w/npm', modeOf), false, 'world-writable file');
    assert.strictEqual(posixTrusted('/nope/npm', modeOf), false, 'unreadable: not trusted');
  }
  // FR-004b: only the app's own page in the main frame may call harness setup
  {
    const idx = '/app/renderer/index.html';
    assert.strictEqual(senderAllowed({ url: 'file:///app/renderer/index.html?sim=1', isMain: true }, idx, 'linux'), true);
    assert.strictEqual(senderAllowed({ url: 'file:///app/renderer/index.html', isMain: false }, idx, 'linux'), false, 'a sub-frame');
    assert.strictEqual(senderAllowed({ url: 'https://example.com/', isMain: true }, idx, 'linux'), false, 'another page');
    assert.strictEqual(senderAllowed(null, idx, 'linux'), false, 'no frame');
  }
  // winget installs and upgrades name their source
  {
    for (const k of ['claude', 'copilot'] as const) for (const f of [installPlans, updatePlans]) assert.ok(f(k, 'win32', only('winget'))[0].display.includes('--source winget'), `${k} names the winget source`);
  }
  // FR-005: the sign-in link, the code and OAuth values never sit in the plain lines
  {
    assert.strictEqual(maskOAuth('go to https://x.test/cb?code=abc123&state=s3cr3t#access_token=t0k'), 'go to https://x.test/cb?code=[hidden]&state=[hidden]#access_token=[hidden]');
    assert.strictEqual(maskOAuth('no query here, code=keep'), 'no query here, code=keep', 'only URL parameters');
    const t = mk('linux', ['/usr/bin/codex']);
    t.setup.run('codex', 'signin');
    t.child().out.emit('data', '1. Open https://auth.openai.com/codex/device\n2. Enter this one-time code\n   AB12-CD34E\n');
    const last = t.prog[t.prog.length - 1];
    assert.strictEqual(last.code, 'AB12-CD34E', 'shown on its own');
    assert.ok(!last.lines.join('\n').includes('AB12-CD34E'), 'the code is not in the lines');
    assert.ok(last.lines.some((l) => l.includes('Open [sign-in link]')) && !last.lines.some((l) => /https:/.test(l)), 'the link is replaced in the lines');
    t.child().emit('close', 0); await tick(); await tick();
    assert.ok(!t.done[0].lines.join('\n').includes('AB12-CD34E'), 'nor in the final lines');
  }
  // FR-004c: progress at most once per interval (the last state still arrives); a split UTF-8 character is kept whole
  {
    let clock = 1000;
    const t = mk('linux', ['/usr/bin/npm'], { progressMs: 250, now: () => clock });
    t.setup.run('codex', 'install');
    const n0 = t.prog.length;
    for (let i = 0; i < 20; i++) t.child().out.emit('data', Buffer.from(`line ${i}\n`));
    assert.strictEqual(t.prog.length, n0, 'nothing more inside the interval');
    clock += 300;
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(t.prog.length, n0 + 1, 'one trailing event');
    assert.strictEqual(t.prog[t.prog.length - 1].lines.at(-1), 'line 19');
    const euro = Buffer.from('€ done\n');
    clock += 300;
    t.child().out.emit('data', euro.subarray(0, 1)); clock += 300; t.child().out.emit('data', euro.subarray(1));
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(t.prog[t.prog.length - 1].lines.at(-1), '€ done');
    t.child().emit('close', 0); await tick(); await tick();
  }
  // a child that fails to start ('error' without 'close') still ends, once, and frees the runner
  {
    const t = mk('linux', ['/usr/bin/npm']);
    t.setup.run('codex', 'install');
    t.child().emit('error', new Error('EACCES'));
    await tick(); await tick();
    assert.deepStrictEqual([t.done.length, t.done[0].ok, t.done[0].reason], [1, false, 'error']);
    assert.ok(!t.setup.busy);
    t.child().emit('close', 1); await tick(); await tick();
    assert.strictEqual(t.done.length, 1, 'ends once');
  }
  console.log('harnesssetup: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });

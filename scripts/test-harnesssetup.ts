/** Harness setup inside the app (spec 051): plans per OS, sign-in output parsing, link allowlist, paste rules. `npm run test:harnesssetup`. No process runs, nothing is installed. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OFFICIAL_PAGES, SIGN_IN, allowedSignInUrl, installPlans, lastLines, managersFor, manualCommands, parseSignIn, simFoundFor, simManagers, stripAnsi, runRequest, updatePlans, validPaste, validPlanIndex } from '../src/shared/harnesssetup';
import type { PackageManager } from '../src/shared/harnesssetup';
import { CODEX_UPDATE_COMMAND } from '../src/shared/updatecheck';
import { EventEmitter } from 'events';
import { HarnessSetup, confirmText, maskOAuth, posixTrusted } from '../src/main/harnesssetup';
import { senderAllowed } from '../src/main/hardening';
import type { ChildLike, SetupDone, SetupProgress } from '../src/main/harnesssetup';

const fx081 = (name: string): string => fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'fixtures', 'updatecheck', name + '.fixture'), 'utf8').split('\n').filter((l) => !l.startsWith('# ')).join('\n').trim();
const all = new Set<PackageManager>(['winget', 'brew', 'npm']);
const only = (...m: PackageManager[]) => new Set<PackageManager>(m);

// FR-002: routes per OS, in order, only the managers found
{
  assert.deepStrictEqual(installPlans('claude', 'win32', all).map((p) => p.display), [
    'winget install --id Anthropic.ClaudeCode -e --source winget --accept-source-agreements --accept-package-agreements',
    'npm install -g @anthropic-ai/claude-code',
  ]);
  assert.deepStrictEqual(installPlans('claude', 'darwin', all).map((p) => p.display), ['brew install --cask claude-code', 'npm install -g @anthropic-ai/claude-code']);
  assert.strictEqual(installPlans('claude', 'darwin', all)[1].note, 'Needs Node.js 22 or later. Anthropic recommends its native installer.', 'not called deprecated: Anthropic no longer does (read 2026-10-21)');
  assert.ok(!['win32', 'darwin', 'linux'].some((os) => installPlans('claude', os, new Set<PackageManager>(['winget', 'brew', 'npm', 'bash', 'powershell'])).some((p) => /deprecat/i.test(p.note ?? ''))), 'no Claude route says deprecated');
  // spec 060 Q1: least privilege first: npm (a home-folder install) before Homebrew, and before winget on Windows
  assert.deepStrictEqual(installPlans('copilot', 'darwin', all).map((p) => p.display), ['npm install -g @github/copilot', 'brew install --cask copilot-cli']);
  assert.deepStrictEqual(installPlans('copilot', 'win32', all)[1].args, ['install', '--id', 'GitHub.Copilot', '-e', '--source', 'winget', '--accept-source-agreements', '--accept-package-agreements']);
  assert.deepStrictEqual(installPlans('codex', 'linux', all).map((p) => p.display), ['npm install -g @openai/codex']);
  assert.deepStrictEqual(installPlans('codex', 'darwin', all).map((p) => p.display), ['npm install -g @openai/codex', 'brew install --cask codex']);
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
  assert.deepStrictEqual(managersFor('win32'), ['powershell', 'winget', 'npm']);
  assert.deepStrictEqual(managersFor('darwin'), ['bash', 'brew', 'npm']);
  // spec 060 FR-001: with the interpreter found, the vendor's official installer comes first (least privilege), then the rest
  const full = new Set<PackageManager>(['winget', 'brew', 'npm', 'bash', 'powershell']);
  const order = (k: 'claude' | 'copilot' | 'codex', os: string) => installPlans(k, os, full).map((p) => p.manager);
  assert.deepStrictEqual(order('claude', 'win32'), ['official', 'winget', 'npm']);
  assert.deepStrictEqual(order('claude', 'darwin'), ['official', 'brew', 'npm']);
  assert.deepStrictEqual(order('claude', 'linux'), ['official', 'brew', 'npm']);
  assert.deepStrictEqual(order('copilot', 'win32'), ['npm', 'winget'], 'no official script for Copilot on Windows');
  assert.deepStrictEqual(order('copilot', 'darwin'), ['official', 'npm', 'brew']);
  assert.deepStrictEqual(order('codex', 'win32'), ['official', 'npm']);
  assert.deepStrictEqual(order('codex', 'linux'), ['official', 'npm']);
  const cw = installPlans('claude', 'win32', full)[0];
  assert.deepStrictEqual([cw.bin, cw.args, cw.script?.url], ['powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'], 'https://claude.ai/install.ps1']);
  const cl = installPlans('codex', 'linux', full)[0];
  assert.deepStrictEqual([cl.bin, cl.args, cl.script?.url], ['bash', [], 'https://chatgpt.com/codex/install.sh']);
  assert.match(cl.display, /^https:\/\/chatgpt\.com\/codex\/install\.sh \(downloaded, then run with bash\)$/);
  assert.match(cl.note ?? '', /no administrator rights/);
  for (const k of ['claude', 'codex', 'copilot'] as const) for (const os of ['win32', 'darwin', 'linux']) for (const pl of installPlans(k, os, full)) {
    if (pl.manager === 'winget' || pl.manager === 'brew') assert.match(pl.note ?? '', /administrator rights/, `${k} ${os} ${pl.manager}: says it may ask for admin`);
    if (pl.script) for (const h of pl.script.hosts) assert.ok(/^[a-z0-9.-]+\.(ai|io|com)$/.test(h.host), 'fixed vendor hosts only');
  }
  assert.deepStrictEqual(updatePlans('claude', 'darwin', full)[0].script?.url, 'https://claude.ai/install.sh', 'the official script also updates');
  // without the interpreter there is no official route (a fresh machine always has one: bash, or Windows PowerShell 5.1)
  assert.ok(!installPlans('claude', 'linux', only('npm')).some((p) => p.manager === 'official'));
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
  type Call = { file: string; args: readonly string[]; opts: { stdio: unknown[]; windowsVerbatimArguments?: boolean; detached?: boolean; env?: Record<string, string | undefined> } };
  const mk = (platform: NodeJS.Platform, files: string[], extra: Partial<{ limits: { install: number; signin: number }; progressMs: number; now: () => number; realpath: (p: string) => string; trustedPath: (p: string) => boolean }> = {}) => {
    const calls: Call[] = [], prog: SetupProgress[] = [], done: SetupDone[] = [], killed: ChildLike[] = [], written: string[] = [];
    let redetects = 0, child!: ChildLike & EventEmitter & { out: EventEmitter; err: EventEmitter };
    const setup = new HarnessSetup({
      detectEnv: { platform, env: platform === 'win32' ? { PATH: 'C:\\Program Files\\nodejs', SystemRoot: 'C:\\Windows' } : { PATH: '/usr/bin' }, homedir: platform === 'win32' ? 'C:\\Users\\u' : '/home/u', isFile: (f) => files.includes(f) },
      spawn: (file, args, opts) => {
        assert.ok(!('shell' in opts) || (opts as { shell?: unknown }).shell === false, 'FR-018: never through a shell');
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

  // spec 052 FR-073: PowerShell 7 hint on Windows only; found on PATH or in Program Files means no hint
  {
    assert.strictEqual(mk('linux', []).setup.pwshMissing(), false, 'never on Linux');
    assert.strictEqual(mk('darwin', []).setup.pwshMissing(), false, 'never on macOS');
    assert.strictEqual(mk('win32', []).setup.pwshMissing(), true, 'Windows without pwsh.exe');
    assert.strictEqual(mk('win32', ['C:\\Program Files\\nodejs\\pwsh.exe']).setup.pwshMissing(), false, 'pwsh.exe on PATH');
    const w = mk('win32', ['C:\\Program Files\\PowerShell\\7\\pwsh.exe']);
    (w.setup['deps'].detectEnv.env as Record<string, string>).ProgramFiles = 'C:\\Program Files';
    assert.strictEqual(w.setup.pwshMissing(), false, 'pwsh.exe in Program Files\\PowerShell\\7');
  }

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
  // spec 081 FR-042: the spawned child's PATH has the folder of the npm-installed program first (its `env node` finds the node beside it)
  {
    const savedPath = process.env.PATH; process.env.PATH = '/zzz:/usr/bin'; // a GUI app's PATH, without the folder of the script
    const cop = mk('linux', ['/usr/local/nvmish/bin/copilot']);
    (cop.setup['deps'].detectEnv.env as Record<string, string>).PATH = '/usr/local/nvmish/bin:/usr/bin';
    assert.ok(cop.setup.run('copilot', 'signin').ok);
    const pathOf = (c: Call): string[] => String(c.opts.env?.PATH).split(':');
    assert.strictEqual(pathOf(cop.calls[0])[0], '/usr/local/nvmish/bin', 'copilot login: the folder of the copilot script first');
    const up = mk('linux', ['/usr/bin/npm']);
    const job = { kind: 'codex', op: 'update', file: '/x/npm-cli.js', args: ['i'], spawnFile: '/x/npm-cli.js', spawnArgs: ['i'], verbatim: false, paste: false, toolFile: '/home/u/.nvm/versions/node/v22.3.0/bin/npm' } as never;
    assert.ok(up.setup.start(job).ok);
    assert.strictEqual(pathOf(up.calls[0])[0], '/home/u/.nvm/versions/node/v22.3.0/bin', 'npm update: the spawn merge puts the npm folder first');
    const other = mk('linux', ['/usr/bin/codex']);
    other.setup.run('codex', 'signin');
    assert.ok(pathOf(other.calls[0]).includes('/usr/bin'));
    process.env.PATH = savedPath;
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
  // spec 060 FR-002: the simulator shows the real routes for a typical new machine of each OS, never Homebrew on Windows or Linux
  {
    assert.deepStrictEqual(simFoundFor('win32'), ['powershell', 'winget']);
    assert.deepStrictEqual(simFoundFor('darwin'), ['bash'], 'a new Mac has bash but no Homebrew and no Node');
    assert.deepStrictEqual(simFoundFor('linux'), ['bash']);
    const simPlans = (k: 'claude' | 'copilot' | 'codex', os: string) => installPlans(k, os, new Set(simFoundFor(os))).map((p) => p.manager);
    assert.deepStrictEqual(simPlans('claude', 'win32'), ['official', 'winget']);
    assert.deepStrictEqual(simPlans('copilot', 'win32'), ['winget']);
    for (const os of ['win32', 'linux']) for (const k of ['claude', 'copilot', 'codex'] as const) assert.ok(!simPlans(k, os).includes('brew'), `no Homebrew offered on ${os} for ${k}`);
    assert.deepStrictEqual(simPlans('claude', 'darwin'), ['official'], 'a new Mac: the official installer (FR-001), no Homebrew, no npm');
    assert.deepStrictEqual(simPlans('codex', 'linux'), ['official']);
    assert.deepStrictEqual(simManagers('darwin'), ['bash'], 'no override: a new machine');
    assert.deepStrictEqual(simManagers('linux', 'winget, brew,npm,apt,brew'), ['winget', 'brew', 'npm'], 'override: known names, once each');
    const looked: string[] = [];
    const hs = new HarnessSetup({
      detectEnv: { platform: 'linux', env: { PATH: '/usr/bin' }, homedir: '/home/u', isFile: (f: string) => { looked.push(f); return true; } },
      spawn: () => { throw new Error('nothing runs'); }, killTree: () => undefined, send: () => undefined, redetect: async () => undefined,
    } as never);
    assert.deepStrictEqual(hs.plans('copilot', 'install', []).plans, [], 'nothing assumed: no route');
    assert.deepStrictEqual(looked, [], 'an assumed set does not look at this machine');
    assert.deepStrictEqual(hs.plans('copilot', 'install').plans.map((p) => p.manager), ['official', 'npm', 'brew'], 'without it, what is found here is used (least privilege first)');
  }
  // spec 060 FR-009: the vendors' commands to run yourself, per OS, word for word from their install pages (read 2026-10-21)
  {
    const cmds = (k: 'claude' | 'copilot' | 'codex', os: string) => manualCommands(k, os).map((c) => `${c.label}: ${c.command}`);
    assert.deepStrictEqual(cmds('copilot', 'win32'), ['PowerShell (winget): winget install GitHub.Copilot', 'npm: npm install -g @github/copilot']);
    assert.deepStrictEqual(cmds('claude', 'win32'), ['PowerShell: irm https://claude.ai/install.ps1 | iex', 'PowerShell (winget): winget install Anthropic.ClaudeCode', 'npm: npm install -g @anthropic-ai/claude-code']);
    assert.deepStrictEqual(cmds('codex', 'win32'), ['PowerShell: powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"', 'npm: npm install -g @openai/codex']);
    assert.ok(!cmds('codex', 'win32').some((c) => /winget/.test(c)), 'OpenAI documents no winget package: none is offered');
    assert.deepStrictEqual(cmds('copilot', 'darwin'), ['Terminal: curl -fsSL https://gh.io/copilot-install | bash', 'Homebrew: brew install --cask copilot-cli', 'npm: npm install -g @github/copilot']);
    assert.deepStrictEqual(cmds('codex', 'linux'), ['Terminal: curl -fsSL https://chatgpt.com/codex/install.sh | sh', 'npm: npm install -g @openai/codex']);
    for (const k of ['claude', 'copilot', 'codex'] as const) {
      assert.ok(manualCommands(k, 'win32').every((c) => c.label === 'npm' || /^PowerShell( \(winget\))?$/.test(c.label)), `Windows labels name PowerShell (${k})`);
      for (const os of ['darwin', 'linux']) assert.ok(!manualCommands(k, os).some((c) => /winget|PowerShell|irm /.test(c.label + c.command)), `no Windows command on ${os} (${k})`);
      assert.ok(!manualCommands(k, 'win32').some((c) => /curl |brew /.test(c.command)), `no macOS/Linux command on Windows (${k})`);
    }
    assert.deepStrictEqual(manualCommands('claude', 'freebsd'), [], 'unknown OS: none');
    const a = manualCommands('copilot', 'win32'); a[0].command = 'x';
    assert.strictEqual(manualCommands('copilot', 'win32')[0].command, 'winget install GitHub.Copilot', 'callers get copies');
    // HarnessSetup.plans carries them, for the simulated OS too (FR-011)
    const hs = new HarnessSetup({ detectEnv: { platform: 'linux', env: { PATH: '/usr/bin' }, homedir: '/home/u', isFile: () => false }, spawn: () => { throw new Error('no'); }, killTree: () => undefined, send: () => undefined, redetect: async () => undefined } as never);
    assert.deepStrictEqual(hs.plans('copilot', 'install').manual.map((c) => c.label), ['Terminal', 'Homebrew', 'npm']);
    const w = hs.plans('copilot', 'install', simFoundFor('win32'), 'win32');
    assert.deepStrictEqual([w.plans.map((p) => p.manager), w.manual.map((c) => c.label)], [['winget'], ['PowerShell (winget)', 'npm']], 'simulated Windows: winget route and PowerShell commands');
    assert.deepStrictEqual(hs.plans('copilot', 'install', undefined, 'win32').manual.map((c) => c.label), ['Terminal', 'Homebrew', 'npm'], 'simPlatform only with an assumed set');
  }
  // spec 060 FR-010: winget.exe is an App Execution Alias in %LOCALAPPDATA%\Microsoft\WindowsApps: found there, and run by that path
  {
    const alias = 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe';
    const calls: string[] = [];
    let resolved = 0;
    const hs = new HarnessSetup({
      detectEnv: { platform: 'win32', env: { Path: 'C:\\Windows\\System32', SystemRoot: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, homedir: 'C:\\Users\\u', isFile: (f: string) => f === alias },
      spawn: (file: string) => { calls.push(file); const e = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: null }); return e as never; },
      killTree: () => undefined, send: () => undefined, redetect: async () => undefined,
      realpath: (p: string) => { resolved++; throw new Error('EACCES ' + p); },
    } as never);
    assert.strictEqual(hs.find('winget'), alias, 'found in WindowsApps although PATH lacks the folder');
    const plans = hs.plans('copilot', 'install').plans;
    assert.deepStrictEqual(plans.map((p) => p.manager), ['winget'], 'Copilot on a Windows PC without Node.js: the winget route');
    const p = hs.prepare('copilot', 'install', 0);
    assert.ok(p.ok, 'prepared: ' + JSON.stringify(p));
    if (p.ok) {
      assert.strictEqual(p.job.spawnFile, alias, 'the alias itself runs (never resolved into WindowsApps\' package folder)');
      assert.deepStrictEqual(p.job.spawnArgs, ['install', '--id', 'GitHub.Copilot', '-e', '--source', 'winget', '--accept-source-agreements', '--accept-package-agreements'], 'fixed argv, no shell');
      assert.strictEqual(p.job.verbatim, false);
    }
    assert.strictEqual(resolved, 0, 'realpath is not asked for an alias');
  }
  // spec 060 FR-012: Run beside a command picks the matching route; the window sends only an index, main runs its own fixed argv
  {
    for (const os of ['win32', 'darwin', 'linux']) for (const k of ['claude', 'copilot', 'codex'] as const) {
      assert.ok(manualCommands(k, os).every((c) => ['official', 'winget', 'brew', 'npm'].includes(c.route)), `every command names its route (${k}, ${os})`);
    }
    assert.deepStrictEqual(manualCommands('claude', 'win32').map((c) => c.route), ['official', 'winget', 'npm']);
    assert.deepStrictEqual(manualCommands('codex', 'win32').map((c) => c.route), ['official', 'npm']);
    assert.deepStrictEqual(manualCommands('copilot', 'win32').map((c) => c.route), ['winget', 'npm']);
    // each Windows route a manual command stands for exists in the fixed table, so Run always has something to start when found
    for (const k of ['claude', 'copilot', 'codex'] as const) {
      const all = installPlans(k, 'win32', new Set(['powershell', 'winget', 'npm'] as const)).map((p) => p.manager);
      assert.ok(manualCommands(k, 'win32').every((c) => all.includes(c.route)), `every Windows command has a runnable route (${k}): ${all}`);
    }
    // the vendors' PowerShell one-liners run as the same script, downloaded from fixed hosts and run as a file (never -Command / iex)
    for (const k of ['claude', 'codex'] as const) {
      const off = installPlans(k, 'win32', new Set(['powershell'] as const))[0];
      assert.strictEqual(off.manager, 'official');
      assert.strictEqual(off.bin, 'powershell');
      assert.deepStrictEqual(off.args, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'], `fixed argv, the downloaded file appended by main (${k})`);
      assert.ok(!off.args.some((a) => /^-(c|Command|EncodedCommand)$/i.test(a) || /iex|irm|\|/.test(a)), 'no -Command, no pipe into iex');
      assert.ok(/^https:\/\/(claude\.ai|chatgpt\.com)\//.test(off.script?.url ?? ''), 'the vendor\'s own script URL');
    }
    // Copilot on a PC without Node.js: winget is the route, and its note says it needs no Node.js
    const cw = installPlans('copilot', 'win32', new Set(['powershell', 'winget'] as const));
    assert.deepStrictEqual(cw.map((p) => p.manager), ['winget']);
    assert.ok(/No Node\.js needed/.test(cw[0].note ?? ''), 'the dialog says winget needs no Node.js');
    // the index whitelist: integers 0-7 only; anything else is refused (it used to fall back to the first plan)
    for (const ok of [0, 1, 7]) assert.strictEqual(validPlanIndex(ok), ok);
    for (const bad of [-1, 8, 1.5, NaN, Infinity, '0', '1', null, undefined, {}, [0], 'official', 'irm https://evil.example | iex', { valueOf: () => 0 }]) assert.strictEqual(validPlanIndex(bad), undefined, 'refused: ' + String(bad));
    // review on #469: harness:run checks the window's arguments with runRequest, and the handler runs exactly what it returns
    assert.deepStrictEqual(runRequest('copilot', 'install', 2), { kind: 'copilot', op: 'install', idx: 2 });
    assert.deepStrictEqual(runRequest('claude', 'update', 0), { kind: 'claude', op: 'update', idx: 0 });
    assert.deepStrictEqual(runRequest('codex', 'signin', 'anything'), { kind: 'codex', op: 'signin', idx: 0 }, 'sign-in has one fixed command');
    for (const bad of [-1, 8, 1.5, '1', null, undefined, [0], 'irm https://evil.example | iex']) {
      assert.strictEqual(runRequest('copilot', 'install', bad), undefined, 'install refuses index ' + String(bad));
      assert.strictEqual(runRequest('copilot', 'update', bad), undefined, 'update refuses index ' + String(bad));
    }
    assert.strictEqual(runRequest('gemini', 'install', 0), undefined, 'unknown kind');
    assert.strictEqual(runRequest('copilot', 'uninstall', 0), undefined, 'unknown op');
    {
      const ipc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'ipc', 'harness.ts'), 'utf8');
      const body = ipc.slice(ipc.indexOf("ipcHandle('harness:run'"), ipc.indexOf("ipcHandle('harness:paste'"));
      assert.ok(body.length > 0 && /const req = fromApp\(e\) \? runRequest\(kind, op, planIndex\) : undefined;\s*if \(!req\) return/.test(body), 'harness:run checks sender and arguments with runRequest first');
      assert.deepStrictEqual(body.match(/\bprepare\([^)]*\)/g), ['prepare(req.kind, req.op, req.idx)'], 'harness:run prepares only what runRequest returned');
    }
    // an index past the found routes is refused by prepare too (nothing spawns)
    let spawned = 0;
    const hs = new HarnessSetup({
      detectEnv: { platform: 'win32', env: { Path: 'C:\\Windows\\System32', SystemRoot: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, homedir: 'C:\\Users\\u', isFile: (f: string) => /WindowsPowerShell\\v1\.0\\powershell\.exe$/i.test(f) },
      spawn: () => { spawned++; throw new Error('no'); }, killTree: () => undefined, send: () => undefined, redetect: async () => undefined, realpath: (p: string) => p,
    } as never);
    const pc = hs.prepare('claude', 'install', 0);
    assert.ok(pc.ok && pc.job.spawnFile === 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' && pc.job.script?.url === 'https://claude.ai/install.ps1', 'Claude on Windows: System32 PowerShell runs the downloaded install.ps1: ' + JSON.stringify(pc));
    assert.ok(!hs.prepare('claude', 'install', 1).ok, 'no second route found here: refused');
    assert.strictEqual(spawned, 0, 'prepare never spawns');
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // spec 081 T020-T023: updating from the source that owns the copy (nothing runs; every tool is a fake)
  {
    type U = { setup: HarnessSetup; calls: Array<{ file: string; args: readonly string[]; env: NodeJS.ProcessEnv; cwd?: string; cwdExisted?: boolean }>; done: SetupDone[]; child: () => ChildLike & EventEmitter & { out: EventEmitter; err: EventEmitter } };
    const mkU = (platform: NodeJS.Platform, files: string[], real: Record<string, string>, extra: Record<string, unknown> = {}, pathDirs = platform === 'win32' ? 'C:\\Windows\\System32' : '/usr/bin'): U => {
      const calls: U['calls'] = [], done: SetupDone[] = [];
      let child!: ReturnType<U['child']>;
      const home = platform === 'win32' ? 'C:\\Users\\u' : '/home/u';
      const setup = new HarnessSetup({
        detectEnv: { platform, env: platform === 'win32' ? { Path: pathDirs, SystemRoot: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', APPDATA: 'C:\\Users\\u\\AppData\\Roaming' } : { PATH: pathDirs }, homedir: home, isFile: (f: string) => files.includes(f) },
        spawn: (file: string, args: readonly string[], opts: { env: NodeJS.ProcessEnv; cwd?: string; shell?: unknown }) => {
          assert.ok(!('shell' in opts) || opts.shell === false, 'FR-018: an update never runs through a shell');
          calls.push({ file, args, env: opts.env, ...(opts.cwd ? { cwd: opts.cwd, cwdExisted: fs.existsSync(opts.cwd) } : {}) });
          const out = new EventEmitter(), err = new EventEmitter();
          child = Object.assign(new EventEmitter(), { pid: 42, out, err, stdout: out, stderr: err, stdin: null }) as never;
          return child;
        },
        killTree: () => undefined,
        send: ((ch: string, p: SetupDone) => { if (ch === 'harness:done') done.push(p); }) as never,
        redetect: async () => undefined,
        realpath: (p: string) => real[p] ?? p,
        progressMs: 0,
        ...extra,
      } as never);
      return { setup, calls, done, child: () => child };
    };
    const NVM = '/home/u/.nvm/versions/node/v22.3.0';
    const argvOf = (u: U, kind: 'claude' | 'codex' | 'copilot', i = 0) => { const p = u.setup.prepare(kind, 'update', i); assert.ok(p.ok, JSON.stringify(p)); return (p as { job: { file: string; args: string[] } }).job; };

    // npm: pinned to the checked version, with the npm of the same Node folder (not the first on PATH); unpinned without a check
    {
      const files = [`${NVM}/bin/codex`, `${NVM}/bin/npm`, '/usr/bin/npm', '/usr/bin/bash'];
      const real = { [`${NVM}/bin/codex`]: `${NVM}/lib/node_modules/@openai/codex/bin/codex.js` };
      const pinned = mkU('linux', files, real, { checked: () => '0.164.0' }, `${NVM}/bin:/usr/bin`);
      const pl = pinned.setup.plans('codex', 'update').plans;
      assert.deepStrictEqual([pl[0].manager, pl[0].owner, pl[0].pinned, pl[0].display], ['npm', true, '0.164.0', 'npm install -g @openai/codex@0.164.0 --no-update-notifier']);
      const j = argvOf(pinned, 'codex');
      assert.strictEqual(j.file, `${NVM}/bin/npm`, 'the npm that owns the copy, not /usr/bin/npm');
      assert.deepStrictEqual(j.args, ['install', '-g', '@openai/codex@0.164.0', '--no-update-notifier']);
      const unpinned = mkU('linux', files, real, {}, `${NVM}/bin:/usr/bin`);
      assert.deepStrictEqual(unpinned.setup.plans('codex', 'update').plans[0].args, ['install', '-g', '@openai/codex@latest'], 'no check: spec 051\'s argv');
      // a hostile "checked" value is never put into argv
      const bad = mkU('linux', files, real, { checked: () => '1.0.0; rm -rf /' }, `${NVM}/bin:/usr/bin`);
      assert.deepStrictEqual(bad.setup.plans('codex', 'update').plans[0].args, ['install', '-g', '@openai/codex@latest']);
      // no npm of that Node folder, and the first npm does not hold the copy: refused, never a guess
      const none = mkU('linux', [`${NVM}/bin/codex`, '/usr/bin/npm', '/usr/bin/bash'], real, {}, `${NVM}/bin:/usr/bin`);
      const r = none.setup.prepare('codex', 'update', 0);
      assert.ok(!r.ok && /npm that installed this copy was not found/.test(r.error));
    }
    // Homebrew: the owning route first, npm behind "other ways"; casks and --greedy; the brew of that prefix
    {
      const files = ['/opt/homebrew/bin/codex', '/opt/homebrew/bin/brew', '/usr/bin/npm'];
      const real = { '/opt/homebrew/bin/codex': '/opt/homebrew/Caskroom/codex/0.163.0/codex-aarch64-apple-darwin' };
      const u = mkU('darwin', files, real, {}, '/opt/homebrew/bin:/usr/bin');
      const pl = u.setup.plans('codex', 'update').plans;
      assert.deepStrictEqual(pl.map((p) => p.manager), ['brew', 'npm'], 'an update leaves no second copy: the owner is first');
      assert.strictEqual(pl[0].owner, true);
      assert.strictEqual(pl[1].owner, undefined);
      assert.strictEqual(argvOf(u, 'codex').file, '/opt/homebrew/bin/brew');
      const cl = mkU('darwin', ['/opt/homebrew/bin/claude', '/opt/homebrew/bin/brew'], { '/opt/homebrew/bin/claude': '/opt/homebrew/Caskroom/claude-code@latest/2.1.309/claude' }, {}, '/opt/homebrew/bin:/usr/bin');
      assert.deepStrictEqual(cl.setup.plans('claude', 'update').plans[0].args, ['upgrade', '--cask', 'claude-code@latest'], 'the cask of the path');
      const cs = mkU('darwin', ['/opt/homebrew/bin/claude', '/opt/homebrew/bin/brew'], { '/opt/homebrew/bin/claude': '/opt/homebrew/Caskroom/claude-code/2.1.308/claude' }, {}, '/opt/homebrew/bin:/usr/bin');
      assert.deepStrictEqual(cs.setup.plans('claude', 'update').plans[0].args, ['upgrade', '--cask', 'claude-code']);
      const cp = mkU('darwin', ['/opt/homebrew/bin/copilot', '/opt/homebrew/bin/brew'], { '/opt/homebrew/bin/copilot': '/opt/homebrew/Caskroom/copilot-cli/1.0.100/copilot' }, {}, '/opt/homebrew/bin:/usr/bin');
      assert.deepStrictEqual(cp.setup.plans('copilot', 'update').plans[0].args, ['upgrade', '--cask', 'copilot-cli', '--greedy'], 'a self-updating cask needs --greedy');
      assert.deepStrictEqual(updatePlans('codex', 'darwin', only('brew'))[0].args, ['upgrade', '--cask', 'codex'], 'no --greedy for the others');
    }
    // winget: pinned with --version
    {
      const link = 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe';
      const real = { [link]: 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Anthropic.ClaudeCode_x\\claude.exe' };
      const u = mkU('win32', [link, 'C:\\w\\winget.exe'], real, { checked: () => '2.1.308' });
      (u.setup['deps'].detectEnv.env as Record<string, string>).Path = 'C:\\w';
      const pl = u.setup.plans('claude', 'update').plans;
      assert.strictEqual(pl[0].manager, 'winget');
      assert.deepStrictEqual(pl[0].args.slice(-2), ['--version', '2.1.308']);
      assert.ok(pl[0].args.includes('--source') && pl[0].args.includes('winget'));
    }
    // the app's own updater for a vendor-installer copy; the vendor script stays behind it as "other way"
    {
      const files = ['/home/u/.local/bin/claude', '/usr/bin/bash'];
      const real = { '/home/u/.local/bin/claude': '/home/u/.local/share/claude/versions/2.1.300' };
      const u = mkU('linux', files, real, {});
      const pl = u.setup.plans('claude', 'update').plans;
      assert.deepStrictEqual(pl.map((p) => [p.manager, p.own, p.owner]), [['official', 'claude', true], ['official', undefined, undefined]]);
      assert.deepStrictEqual(pl[0].display, 'claude update');
      const j = argvOf(u, 'claude');
      assert.deepStrictEqual([j.file, j.args], ['/home/u/.local/share/claude/versions/2.1.300', ['update']], 'the app itself, by its real path');
      const cop = mkU('linux', ['/home/u/.local/bin/copilot', '/usr/bin/bash'], { '/home/u/.local/bin/copilot': '/home/u/.copilot/pkg/universal/1.0.100/copilot' }, {});
      assert.strictEqual(cop.setup.plans('copilot', 'update').plans[0].display, 'copilot update');
      // an install never gets an own updater
      assert.ok(!u.setup.plans('claude', 'install').plans.some((p) => p.own));
    }
    // Codex: `codex update` only for the official standalone CLI with the codex-cli label (T020); everything else goes to its own route or the 060 route
    {
      const root = '/home/u/.codex/packages/standalone/releases/0.163.0-x86_64';
      const files = ['/home/u/.local/bin/codex', '/usr/bin/bash'];
      const label = (stdout: string) => ({ exec: async () => ({ code: 0, stdout, stderr: '' }) });
      const real = { '/home/u/.local/bin/codex': `${root}/codex` };
      const off = mkU('linux', files, real, label('codex-cli 0.163.0\n'));
      assert.deepStrictEqual(off.setup.plans('codex', 'update').plans.map((p) => p.codexUpdate), [undefined], 'the label has not been read yet: not official');
      await off.setup.warm('codex');
      const pl = off.setup.plans('codex', 'update').plans;
      assert.deepStrictEqual(pl.map((p) => [p.codexUpdate, p.script ? 'script' : '', p.owner]), [[true, '', true], [undefined, 'script', undefined]]);
      assert.strictEqual(pl[0].display, 'codex update');
      const j = argvOf(off, 'codex');
      assert.deepStrictEqual([j.file, j.args], [`${root}/codex`, ['update']]);
      for (const [name, out] of [['a missing label', ''], ['another label', 'codex 0.163.0'], ['a fork', 'my-codex 0.163.0']] as const) {
        const u = mkU('linux', files, real, label(out));
        await u.setup.warm('codex');
        assert.ok(!u.setup.plans('codex', 'update').plans.some((p) => p.codexUpdate), name + ': no codex update');
      }
      const exit1 = mkU('linux', files, real, { exec: async () => ({ code: 1, stdout: 'codex-cli 0.163.0', stderr: '' }) });
      await exit1.setup.warm('codex');
      assert.ok(!exit1.setup.plans('codex', 'update').plans.some((p) => p.codexUpdate), 'a failing --version: not official');
      const untrusted = mkU('linux', files, real, { ...label('codex-cli 0.163.0'), trustedPath: () => false });
      await untrusted.setup.warm('codex');
      assert.ok(!untrusted.setup.plans('codex', 'update').plans.some((p) => p.codexUpdate), 'a world-writable folder');
      const notFile = mkU('linux', files, real, { ...label('codex-cli 0.163.0'), regular: () => false });
      await notFile.setup.warm('codex');
      assert.ok(!notFile.setup.plans('codex', 'update').plans.some((p) => p.codexUpdate), 'not a regular file');
      // npm and Homebrew copies update through their own route, never codex update; the Windows install.ps1 folder goes to the 060 route
      const npmC = mkU('linux', [`${NVM}/bin/codex`, `${NVM}/bin/npm`, '/usr/bin/bash'], { [`${NVM}/bin/codex`]: `${NVM}/lib/node_modules/@openai/codex/bin/codex.js` }, label('codex-cli 0.163.0'), `${NVM}/bin:/usr/bin`);
      await npmC.setup.warm('codex');
      assert.deepStrictEqual(npmC.setup.plans('codex', 'update').plans.map((p) => p.manager), ['npm', 'official']);
      // spec 081 FR-042: the npm update carries its folder (before the real path is resolved) so `env node` finds the node beside it
      const npmJob = npmC.setup.prepare('codex', 'update', 0);
      assert.ok(npmJob.ok && (npmJob as { job: { toolFile?: string } }).job.toolFile === `${NVM}/bin/npm`, JSON.stringify(npmJob));
      const winC = mkU('win32', ['C:\\Users\\u\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'], {}, label('codex-cli 0.163.0'));
      await winC.setup.warm('codex');
      const wp = winC.setup.plans('codex', 'update').plans;
      assert.deepStrictEqual([wp[0].manager, wp[0].own, wp[0].codexUpdate, !!wp[0].script], ['official', undefined, undefined, true], 'the 060 installer route, never codex update');
      // a look-alike standalone folder
      const alike = mkU('linux', files, { '/home/u/.local/bin/codex': '/home/u/.codex/packages/standalonex/releases/1/codex' }, label('codex-cli 0.163.0'));
      await alike.setup.warm('codex');
      assert.ok(!alike.setup.plans('codex', 'update').plans.some((p) => p.codexUpdate));
    }
    // outside Durbar's routes: no owner is marked (the window shows a hint and no Update)
    {
      const u = mkU('linux', ['/usr/bin/claude', '/usr/bin/npm', '/usr/bin/bash'], {});
      assert.ok(u.setup.plans('claude', 'update').plans.every((p) => !p.owner));
    }

    // T021: root is refused for every vendor updater (FR-025), not only plan.script
    {
      const files = ['/home/u/.local/bin/claude', '/home/u/.local/bin/codex', '/home/u/.local/bin/copilot', '/usr/bin/bash'];
      const root = '/home/u/.codex/packages/standalone/releases/1/codex';
      const real = { '/home/u/.local/bin/claude': '/home/u/.local/share/claude/versions/2.1.300', '/home/u/.local/bin/codex': root, '/home/u/.local/bin/copilot': '/home/u/.copilot/pkg/universal/1.0.100/copilot' };
      const u = mkU('linux', files, real, { exec: async () => ({ code: 0, stdout: 'codex-cli 1.0.0', stderr: '' }), isRoot: () => true });
      await u.setup.warm('codex');
      for (const k of ['claude', 'copilot', 'codex'] as const) {
        const r = u.setup.prepare(k, 'update', 0);
        assert.ok(!r.ok && /not as root/.test(r.error), `${k} update is refused as root`);
      }
      const r1 = u.setup.prepare('codex', 'update', 1);
      assert.ok(!r1.ok && /not as root/.test(r1.error), 'the official installer too');
      assert.ok(mkU('linux', files, real, { isRoot: () => false }).setup.prepare('claude', 'update', 0).ok);
    }
    // the confirmation says what runs: target version, what the route checks, Copilot's sign-in, and codex update's exact command per OS
    {
      const files = ['/home/u/.local/bin/copilot', '/home/u/.local/bin/codex', '/usr/bin/bash'];
      const real = { '/home/u/.local/bin/copilot': '/home/u/.copilot/pkg/universal/1.0.100/copilot', '/home/u/.local/bin/codex': '/home/u/.codex/packages/standalone/releases/1/codex' };
      const u = mkU('linux', files, real, { checked: (k: string) => (k === 'copilot' ? '1.0.103' : '0.164.0'), exec: async () => ({ code: 0, stdout: 'codex-cli 1.0.0', stderr: '' }) });
      const cop = confirmText(argvJob(u.setup.prepare('copilot', 'update', 0)));
      assert.match(cop.detail, /copilot update/);
      assert.match(cop.detail, /GitHub sign-in/);
      assert.match(cop.detail, /newest version the source offers \(checked: 1\.0\.103\)/);
      assert.match(cop.detail, /unconfirmed/);
      await u.setup.warm('codex');
      const cj = argvJob(u.setup.prepare('codex', 'update', 0));
      const posix = confirmText(cj, 'linux');
      assert.ok(posix.detail.includes(CODEX_UPDATE_COMMAND.posix), 'the exact POSIX command');
      assert.match(posix.detail, /Durbar cannot see or check that script/);
      assert.match(posix.detail, /decides what actually runs/);
      assert.ok(confirmText(cj, 'win32').detail.includes(CODEX_UPDATE_COMMAND.win32), 'the exact Windows command');
      assert.ok(!confirmText(cj, 'linux').detail.includes('irm https'), 'only the command of this OS');
      assert.strictEqual(posix.button, 'Update');
      // pinned routes name the exact version
      const np = mkU('linux', [`${NVM}/bin/codex`, `${NVM}/bin/npm`], { [`${NVM}/bin/codex`]: `${NVM}/lib/node_modules/@openai/codex/bin/codex.js` }, { checked: () => '0.164.0' }, `${NVM}/bin:/usr/bin`);
      assert.match(confirmText(argvJob(np.setup.prepare('codex', 'update', 0))).detail, /exactly 0\.164\.0/);
      assert.match(confirmText(argvJob(np.setup.prepare('codex', 'update', 0))).detail, /integrity hash/);
    }
    function argvJob(p: ReturnType<HarnessSetup['prepare']>): Parameters<typeof confirmText>[0] { assert.ok(p.ok, JSON.stringify(p)); return (p as { job: Parameters<typeof confirmText>[0] }).job; }

    // the codex update child: no CODEX_MANAGED_BY_*, a fixed PATH even with a fake sh on the user's, a private working folder removed afterwards
    {
      const files = ['/home/u/.local/bin/codex', '/usr/bin/bash'];
      const real = { '/home/u/.local/bin/codex': '/home/u/.codex/packages/standalone/releases/1/codex' };
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-081-t-'));
      const saved = { PATH: process.env.PATH, A: process.env.CODEX_MANAGED_BY_NPM, B: process.env.CODEX_MANAGED_BY_BUN, C: process.env.CODEX_MANAGED_BY_PNPM, D: process.env.CODEX_MANAGED_BY_VITE_PLUS, N: process.env.CODEX_NON_INTERACTIVE };
      process.env.CODEX_MANAGED_BY_NPM = '1'; process.env.CODEX_MANAGED_BY_BUN = '1'; process.env.CODEX_MANAGED_BY_PNPM = '1'; process.env.CODEX_MANAGED_BY_VITE_PLUS = '1';
      process.env.PATH = '/tmp/fake-sh-dir:' + (saved.PATH ?? '');
      try {
        const u = mkU('linux', files, real, { exec: async () => ({ code: 0, stdout: 'codex-cli 1.0.0', stderr: '' }), tmpdir: tmp });
        await u.setup.warm('codex');
        const p = u.setup.prepare('codex', 'update', 0);
        assert.ok(p.ok);
        assert.ok(u.setup.start((p as unknown as { job: never }).job).ok);
        const c = u.calls[0];
        for (const k of Object.keys(c.env)) assert.ok(!k.startsWith('CODEX_MANAGED_BY_'), `${k} is removed from the child`);
        assert.strictEqual(c.env.PATH, '/usr/bin:/bin:/usr/sbin:/sbin', 'a fixed system PATH, not the user\'s with a fake sh');
        assert.strictEqual(c.env.CODEX_NON_INTERACTIVE, undefined, 'codex update sets it itself; Durbar adds nothing');
        assert.ok(c.cwd && c.cwd.startsWith(tmp) && c.cwdExisted, 'a private working folder from the OS temp folder');
        if (process.platform !== 'win32') assert.strictEqual(fs.statSync(c.cwd as string).mode & 0o777, 0o700, 'private (POSIX modes; Windows has no such bits)');
        assert.strictEqual(process.env.CODEX_MANAGED_BY_NPM, '1', 'Durbar\'s own environment is untouched');
        // the failure: an unknown subcommand offers the checked 060 installer, never a retry by itself
        u.child().err.emit('data', fx081('codex-unknown-subcommand'));
        u.child().emit('close', 2); await tick(); await tick();
        assert.deepStrictEqual([u.done[0].ok, u.done[0].fallback, u.done[0].failure, u.calls.length], [false, 'official', 'other', 1]);
        assert.ok(!fs.existsSync(c.cwd as string), 'the working folder is removed');
      } finally {
        for (const [k, v] of [['PATH', saved.PATH], ['CODEX_MANAGED_BY_NPM', saved.A], ['CODEX_MANAGED_BY_BUN', saved.B], ['CODEX_MANAGED_BY_PNPM', saved.C], ['CODEX_MANAGED_BY_VITE_PLUS', saved.D], ['CODEX_NON_INTERACTIVE', saved.N]] as Array<[string, string | undefined]>) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    }
    // each fallback trigger; in-use, managed, a cancel and a success give none
    {
      const files = ['/home/u/.local/bin/codex', '/usr/bin/bash'];
      const real = { '/home/u/.local/bin/codex': '/home/u/.codex/packages/standalone/releases/1/codex' };
      const trial = async (out: string, code: number | null, how?: 'cancel') => {
        const u = mkU('linux', files, real, { exec: async () => ({ code: 0, stdout: 'codex-cli 1.0.0', stderr: '' }) });
        await u.setup.warm('codex');
        const p = u.setup.prepare('codex', 'update', 0);
        assert.ok(p.ok && u.setup.start((p as unknown as { job: never }).job).ok);
        u.child().out.emit('data', out);
        if (how === 'cancel') u.setup.cancel();
        u.child().emit('close', code); await tick(); await tick();
        return u.done[0];
      };
      assert.strictEqual((await trial(fx081('codex-unknown-subcommand'), 2)).fallback, 'official');
      assert.strictEqual((await trial(fx081('codex-no-method'), 1)).fallback, 'official');
      assert.strictEqual((await trial('something broke', 7)).fallback, 'official', 'another failing exit');
      assert.strictEqual((await trial('error: file is being used by another process', 1)).fallback, undefined, 'in use: closing the app is the advice');
      assert.strictEqual((await trial(fx081('claude-update-disabled'), 1)).fallback, undefined, 'managed: no retry');
      assert.strictEqual((await trial('', 0)).fallback, undefined, 'success');
      const c = await trial('', null, 'cancel');
      assert.deepStrictEqual([c.fallback, c.reason], [undefined, 'cancelled']);
      assert.strictEqual((await trial(fx081('npm-eacces'), 1)).failure, 'admin');
    }
    // the Codex official-installer fallback sets CODEX_NON_INTERACTIVE=1 in that child only
    {
      const script = Buffer.from('#!/bin/sh\necho hi\n');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-081-s-'));
      const u = mkU('linux', ['/usr/bin/bash'], {}, { httpGet: async () => ({ status: 200, body: script }), tmpdir: tmp });
      const p = u.setup.prepare('codex', 'install', 0);
      assert.ok(p.ok);
      const ready = await u.setup.withScript((p as unknown as { job: never }).job);
      assert.ok(ready.ok && u.setup.start(ready.job).ok);
      assert.strictEqual(u.calls[0].env.CODEX_NON_INTERACTIVE, '1');
      assert.strictEqual(process.env.CODEX_NON_INTERACTIVE, undefined, 'only that child');
      u.child().emit('close', 0); await tick(); await tick();
      const w = mkU('linux', ['/usr/bin/bash'], {}, { httpGet: async () => ({ status: 200, body: script }), tmpdir: tmp });
      const wp = w.setup.prepare('claude', 'install', 0);
      const wr = await w.setup.withScript((wp as unknown as { job: never }).job);
      assert.ok(wr.ok && w.setup.start(wr.job).ok);
      assert.strictEqual(w.calls[0].env.CODEX_NON_INTERACTIVE, undefined, 'not for Claude');
      w.child().emit('close', 0); await tick(); await tick();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    // a vendor updater that says "up to date" is no failure and no "updated" claim
    {
      const u = mkU('linux', ['/home/u/.local/bin/claude'], { '/home/u/.local/bin/claude': '/home/u/.local/share/claude/versions/2.1.309' });
      const p = u.setup.prepare('claude', 'update', 0);
      assert.ok(p.ok && u.setup.start((p as unknown as { job: never }).job).ok);
      u.child().out.emit('data', fx081('claude-update-uptodate'));
      u.child().emit('close', 0); await tick(); await tick();
      assert.deepStrictEqual([u.done[0].ok, u.done[0].failure, u.done[0].fallback], [true, 'vendor-up-to-date', undefined]);
    }
    // FR-011: after an update the done event says when Durbar still finds the old version, or another copy first
    {
      let version = '0.163.0', where = '/usr/local/bin/codex';
      const snapshot = async () => ({ codex: { version, where } });
      const u = mkU('darwin', ['/opt/homebrew/bin/codex', '/opt/homebrew/bin/brew'], { '/opt/homebrew/bin/codex': '/opt/homebrew/Caskroom/codex/0.163.0/codex' }, { snapshot, checked: () => '0.164.0' }, '/opt/homebrew/bin:/usr/bin');
      const p = u.setup.prepare('codex', 'update', 0);
      assert.ok(p.ok && u.setup.start((p as unknown as { job: never }).job).ok);
      u.child().emit('close', 0); await tick(); await tick(); await tick();
      assert.match(u.done[0].note ?? '', /Updated, but Durbar still finds 0\.163\.0 at \/usr\/local\/bin\/codex/);
      const v = mkU('darwin', ['/opt/homebrew/bin/codex', '/opt/homebrew/bin/brew'], { '/opt/homebrew/bin/codex': '/opt/homebrew/Caskroom/codex/0.163.0/codex' }, { snapshot: async () => ({ codex: { version, where } }), checked: () => '0.164.0' }, '/opt/homebrew/bin:/usr/bin');
      const p2 = v.setup.prepare('codex', 'update', 0);
      assert.ok(p2.ok && v.setup.start((p2 as unknown as { job: never }).job).ok);
      version = '0.164.0';
      v.child().emit('close', 0); await tick(); await tick(); await tick();
      assert.strictEqual(v.done[0].note, undefined, 'the new version is simply the new version');
    }
    // FR-023 with an organization max: only a pinned route, within the range; a route that cannot pin gives the explanation
    {
      const files = [`${NVM}/bin/codex`, `${NVM}/bin/npm`, '/usr/bin/bash'];
      const real = { [`${NVM}/bin/codex`]: `${NVM}/lib/node_modules/@openai/codex/bin/codex.js` };
      const pol = (max: string) => ({ checked: () => '0.164.0', policy: () => ({ state: 'ok', max: { codex: max } }) });
      const ok = mkU('linux', files, real, pol('0.170.0'), `${NVM}/bin:/usr/bin`).setup.plans('codex', 'update');
      assert.deepStrictEqual(ok.plans.map((p) => [p.manager, p.pinned]), [['npm', '0.164.0']], 'the unpinned official script is not offered under a max');
      const over = mkU('linux', files, real, pol('0.160.0'), `${NVM}/bin:/usr/bin`).setup.plans('codex', 'update');
      assert.deepStrictEqual([over.plans.length, /above the version your organization allows/.test(over.blocked ?? '')], [0, true]);
      const brew = mkU('darwin', ['/opt/homebrew/bin/codex', '/opt/homebrew/bin/brew'], { '/opt/homebrew/bin/codex': '/opt/homebrew/Caskroom/codex/0.163.0/codex' }, pol('0.170.0'), '/opt/homebrew/bin:/usr/bin').setup.plans('codex', 'update');
      assert.deepStrictEqual([brew.plans.length, /cannot install a chosen version/.test(brew.blocked ?? '')], [0, true]);
    }
    // SC-003: every path to start passes the native confirmation (main's handler; the waiting update goes through the same step)
    {
      const ipc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'ipc', 'harness.ts'), 'utf8');
      const upd = ipc.slice(ipc.indexOf('const runUpdate'), ipc.indexOf("ipcHandle('harness:run'"));
      assert.ok(upd.indexOf('await confirm(p.job)') > 0 && upd.indexOf('await confirm(p.job)') < upd.indexOf('harnessSetup.start('), 'an update is confirmed before it starts');
      assert.ok(upd.indexOf('await confirm(p.job)') < upd.indexOf('recount()') && upd.indexOf('recount()') < upd.indexOf('harnessSetup.start('), 'then the sessions are counted again, then it starts');
      const run = ipc.slice(ipc.indexOf("ipcHandle('harness:run'"), ipc.indexOf("ipcHandle('harness:updates'"));
      assert.deepStrictEqual(run.match(/harnessSetup\.start\(/g)?.length, 1, 'harness:run starts only the install and sign-in path itself');
      assert.ok(/gate\.request\(req\.kind, g, \(recount\) => runUpdate\(req\.kind, req\.idx, recount\)\)/.test(run), 'an update goes only through the gate and runUpdate');
      assert.strictEqual((ipc.match(/harnessSetup\.start\(/g) ?? []).length, 2, 'two starts in the file: runUpdate and the install path');
    }
  }
  console.log('harnesssetup: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });

/** Binary detection for Claude and Codex (spec 012 T012, FR-035..FR-041): fake isFile and fake exec only. No process, no credits. */
import * as assert from 'assert';
import { CLAUDE_BINARY, CLAUDE_SIGN_IN_HINT, CODEX_BINARY, CODEX_SIGN_IN_HINT, detectCodex, candidates, compareVersions, detectBinary, detectClaude, detectCopilot, detectorFor, parseVersion } from '../src/adapters/detect';
import { MAX_VERSION_LENGTH, parseVersionField } from '../src/shared/versionfield';
import type { DetectEnv, Exec, ExecResult } from '../src/adapters/detect';
import { newestFirst, isAppAlias, statIsFile, windowsAppsDir } from '../src/adapters/detect';
import { loginShellCommand, mergeLoginPath, parseLoginPath, readLoginShellPath, MAX_LOGIN_DIRS } from '../src/main/loginpath';
import { EventEmitter } from 'events';
import { createRegistry, detectAll } from '../src/adapters/registry';
import type { AdapterDescriptor } from '../src/adapters/capabilities';

function mkEnv(platform: NodeJS.Platform, env: Record<string, string>, files: string[], homedir: string): DetectEnv {
  const set = new Set(files);
  return { platform, env, homedir, isFile: (p) => set.has(p) };
}
type Call = { file: string; args: readonly string[]; timeoutMs: number; verbatim?: boolean };
function mkExec(res: ExecResult | (() => Promise<ExecResult>)): { exec: Exec; calls: Call[] } {
  const calls: Call[] = [];
  const exec: Exec = async (file, args, opts) => {
    calls.push({ file, args, timeoutMs: opts.timeoutMs, verbatim: opts.verbatim });
    return typeof res === 'function' ? res() : res;
  };
  return { exec, calls };
}
const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: '' });

async function main(): Promise<void> {
  // (a) POSIX order, relative entries, ~/.local/bin fallback
  {
    const e = mkEnv('linux', { PATH: '.:bin::/opt/a:/opt/b' }, ['/opt/b/codex', '/usr/bin/codex', '/opt/a/codex'], '/home/u');
    const c = candidates(CODEX_BINARY, e);
    assert.strictEqual(c[0], '/opt/a/codex', 'a: PATH order first');
    assert.ok(!c.some((x) => x.startsWith('bin') || x.startsWith('.')), 'a: relative PATH entries are skipped');
    assert.ok(c.indexOf('/opt/b/codex') < c.indexOf('/usr/bin/codex'), 'a: PATH beats known folders');
    const x = mkExec(ok('codex-cli 0.200.0'));
    const r = await detectBinary(CODEX_BINARY, e, x.exec);
    assert.strictEqual(r.path, '/opt/a/codex', 'a: first isFile wins');
    const e2 = mkEnv('linux', {}, ['/home/u/.local/bin/codex'], '/home/u');
    const r2 = await detectBinary(CODEX_BINARY, e2, mkExec(ok('0.200.0')).exec);
    assert.strictEqual(r2.path, '/home/u/.local/bin/codex', 'a: ~/.local/bin found with empty PATH');
    const mac = candidates(CLAUDE_BINARY, mkEnv('darwin', {}, [], '/Users/u'));
    assert.ok(mac.includes('/opt/homebrew/bin/claude') && mac.includes('/Users/u/.npm-global/bin/claude'), 'a: macOS folders');
  }

  // (b) Windows drive paths
  {
    const e = mkEnv('win32', { Path: '"C:\\Program Files\\x";rel\\dir;;C:\\bin' }, ['C:\\Program Files\\x\\codex.cmd', 'C:\\Program Files\\x\\codex.exe'], 'C:\\Users\\u');
    const c = candidates(CODEX_BINARY, e);
    assert.deepStrictEqual(c.slice(0, 2), ['C:\\Program Files\\x\\codex.exe', 'C:\\Program Files\\x\\codex.cmd'], 'b: .exe before .cmd, quoted entry works, Path used');
    // spec 060 FR-094: a repeated PATH folder (also in another case on Windows) gives its candidates once
    const dp = candidates(CODEX_BINARY, mkEnv('linux', { PATH: '/opt/a:/opt/b:/opt/a' }, [], '/home/u'));
    assert.deepStrictEqual(dp.slice(0, 2), ['/opt/a/codex', '/opt/b/codex'], 'duplicate PATH entry: first wins, order kept');
    const dw = candidates(CODEX_BINARY, mkEnv('win32', { PATH: 'C:\\bin;"c:\\BIN";C:\\other' }, [], 'C:\\Users\\u'));
    assert.deepStrictEqual(dw.slice(0, 4), ['C:\\bin\\codex.exe', 'C:\\bin\\codex.cmd', 'C:\\other\\codex.exe', 'C:\\other\\codex.cmd'], 'Windows duplicate, other case and quoted: once');
    assert.ok(!c.some((x) => x.startsWith('rel')), 'b: relative entry skipped');
    const x = mkExec(ok('0.200.0'));
    const r = await detectBinary(CODEX_BINARY, e, x.exec);
    assert.strictEqual(r.path, 'C:\\Program Files\\x\\codex.exe', 'b: exe wins');
    assert.strictEqual(x.calls[0].file, 'C:\\Program Files\\x\\codex.exe', 'b: exe runs directly');
    assert.ok(!x.calls[0].verbatim, 'd: .exe is not verbatim');
    const k = candidates(CODEX_BINARY, mkEnv('win32', { APPDATA: 'C:\\A', LOCALAPPDATA: 'C:\\L' }, [], 'C:\\Users\\u'));
    assert.ok(k.includes('C:\\Users\\u\\.local\\bin\\codex.exe') && k.includes('C:\\A\\npm\\codex.cmd') && k.includes('C:\\L\\Programs\\codex\\codex.exe') && k.includes('C:\\L\\Programs\\OpenAI\\Codex\\bin\\codex.exe'), 'b: Windows known folders (and the official install.ps1 folder)');
    // spec 052 FR-072: winget's command shims folder, built from LOCALAPPDATA with Windows path rules
    assert.ok(k.includes('C:\\L\\Microsoft\\WinGet\\Links\\codex.exe'), 'b: winget Links folder is searched');
    const w = mkEnv('win32', { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, ['C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links\\codex.exe'], 'C:\\Users\\u');
    assert.strictEqual((await detectBinary(CODEX_BINARY, w, mkExec(ok('0.200.0')).exec)).state, 'ready', 'b: a winget-installed CLI is found without PATH');
    assert.ok(!candidates(CODEX_BINARY, mkEnv('win32', { LOCALAPPDATA: 'rel\\x' }, [], 'C:\\Users\\u')).some((c) => c.includes('WinGet')), 'b: a relative LOCALAPPDATA is ignored');
  }

  // (c) UNC
  {
    const unc = '\\\\srv\\share\\bin\\codex.exe';
    const e = mkEnv('win32', { PATH: '\\\\srv\\share\\bin' }, [unc], 'C:\\Users\\u');
    const x = mkExec(ok('0.200.0'));
    const r = await detectBinary(CODEX_BINARY, e, x.exec);
    assert.strictEqual(r.path, unc, 'c: UNC found');
    assert.strictEqual(x.calls[0].file, unc, 'c: exec gets exactly the UNC path');
  }

  // (d) .cmd through ComSpec, unsafe paths refused
  {
    const cmd = 'C:\\npm\\codex.cmd';
    const e = mkEnv('win32', { PATH: 'C:\\npm', ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, [cmd], 'C:\\Users\\u');
    const x = mkExec(ok('0.200.0'));
    const r = await detectBinary(CODEX_BINARY, e, x.exec);
    assert.strictEqual(r.state, 'ready');
    assert.strictEqual(x.calls[0].file, 'C:\\Windows\\System32\\cmd.exe', 'd: ComSpec');
    assert.deepStrictEqual(x.calls[0].args, ['/d', '/s', '/c', `"${cmd}" --version`], 'd: four fixed args');
    assert.strictEqual(x.calls[0].verbatim, true, 'd: .cmd runs with verbatim arguments');
    const x2 = mkExec(ok('0.200.0'));
    await detectBinary(CODEX_BINARY, mkEnv('win32', { PATH: 'C:\\npm' }, [cmd], 'C:\\u'), x2.exec);
    assert.strictEqual(x2.calls[0].file, 'cmd.exe', 'd: default cmd.exe');
    for (const bad of ['C:\\a&b', 'C:\\100%', 'C:\\a^b']) {
      const f = `${bad}\\codex.cmd`;
      const xb = mkExec(ok('0.200.0'));
      const rb = await detectBinary(CODEX_BINARY, mkEnv('win32', { PATH: bad }, [f], 'C:\\u'), xb.exec);
      assert.strictEqual(rb.state, 'unknown', `d: unsafe ${bad}`);
      assert.ok(rb.hint && rb.hint.includes('cannot run it safely'), 'd: hint');
      assert.strictEqual(xb.calls.length, 0, 'd: exec never called for an unsafe .cmd');
    }
  }

  // (e) configured path
  {
    const e = mkEnv('linux', { PATH: '/opt/a' }, ['/opt/a/codex', '/custom/codex'], '/home/u');
    const x = mkExec(ok('0.200.0'));
    const r = await detectBinary(CODEX_BINARY, e, x.exec, '/custom/codex');
    assert.strictEqual(r.path, '/custom/codex', 'e: configured before PATH');
    const c = candidates(CODEX_BINARY, e, 'rel/codex');
    assert.ok(!c.includes('rel/codex'), 'e: relative configured path ignored');
    const w = candidates(CODEX_BINARY, mkEnv('win32', {}, [], 'C:\\u'), 'rel\\codex.exe');
    assert.ok(!w.includes('rel\\codex.exe'), 'e: relative configured path ignored on win32');
  }

  // (f) parseVersion
  assert.strictEqual(parseVersion('codex-cli 0.163.0'), '0.163.0');
  assert.strictEqual(parseVersion('2.1.3 (Claude Code)'), '2.1.3');
  assert.strictEqual(parseVersion('v1.2.3-beta.1'), '1.2.3-beta.1');
  assert.strictEqual(parseVersion('garbage'), undefined);
  assert.strictEqual(parseVersion('1.2'), undefined);
  // The limit is the literal 64 (spec 081 FR-005), not only "relative to the constant": 64 accepted, 65 rejected (a 65 mutant must fail here).
  assert.strictEqual(MAX_VERSION_LENGTH, 64);
  const t64 = '999999999.123456789.123456789-' + 'r'.repeat(34);
  assert.strictEqual(t64.length, 64);
  assert.strictEqual(parseVersion(t64), t64);
  assert.strictEqual(parseVersion('v' + t64), t64);
  assert.strictEqual(parseVersion(t64 + 'r'), undefined);
  assert.strictEqual(parseVersion('rust-v' + t64 + 'r'), undefined);
  assert.strictEqual(parseVersionField(t64), t64);
  assert.strictEqual(parseVersionField(t64 + 'r'), undefined);
  // ASCII digits only (versions are ASCII); leading zeros are accepted, as in parseVersionField (compareVersions reads them as numbers).
  for (const bad of ['\uFF11.\uFF12.\uFF13', '\u0661.\u0662.\u0663', '1.2.\u0663', 'v\uFF11.2.3']) {
    assert.strictEqual(parseVersion(bad), undefined, 'unicode digits: ' + JSON.stringify(bad));
    assert.strictEqual(parseVersionField(bad), undefined, 'unicode digits (field): ' + JSON.stringify(bad));
  }
  for (const zero of ['01.002.0003', '1.2.3-01']) {
    assert.strictEqual(parseVersion(zero), zero, 'leading zeros: ' + zero);
    assert.strictEqual(parseVersionField(zero), zero, 'leading zeros (field): ' + zero);
  }
  // FR-039 / issue 664: first-line parsing never searches error prose or recovers a partial token.
  for (const [input, version] of [
    ['codex 0.200.0', '0.200.0'], ['claude 2.1.3', '2.1.3'], ['Claude Code v2.1.3', '2.1.3'],
    [' \t(1.2.3)', '1.2.3'], ['codex-cli (rust-v0.163.0+build.5)', '0.163.0'],
    ['1.2.3\nnot a version', '1.2.3'], ['1.2.3\r\nnot a version', '1.2.3'],
    // exactly the 64-character cap (spec 081 FR-005), build metadata not counted
    ['999999999.123456789.123456789-' + 'r'.repeat(MAX_VERSION_LENGTH - 30) + '+' + 'b'.repeat(40), '999999999.123456789.123456789-' + 'r'.repeat(MAX_VERSION_LENGTH - 30)],
    [' '.repeat(195) + '1.2.3', '1.2.3'],
    [' '.repeat(195) + '1.2.3 trailing text', '1.2.3'],
    ['1.2.3 <img src=x>', '1.2.3'],
  ]) assert.strictEqual(parseVersion(input), version, 'f: accepted ' + JSON.stringify(input));
  for (const input of [
    'npm ERR! … node v22.11.0', 'error: 1.2.3', 'other-tool 1.2.3',
    'hello\n1.2.3', 'hello\r1.2.3', '\n1.2.3', '\r\n1.2.3',
    'x1.2.3', '1.2.3x', '1.2.3.4', '1234567890.2.3', '1.1234567890.3', '1.2.1234567890',
    // one over the cap is rejected, never cut to a shorter version
    '999999999.123456789.123456789-' + 'r'.repeat(MAX_VERSION_LENGTH - 29), 'v999999999.123456789.123456789-' + 'r'.repeat(MAX_VERSION_LENGTH - 29), '999999999.123456789.123456789-' + 'r'.repeat(40),
    // markup in the pre-release (spec 081 FR-005 class [0-9A-Za-z.-])
    '1.2.3-<img/src=x/onerror=alert(1)>', '1.2.3-a<b', '1.2.3-"x', '1.2.3-a;b', '1.2.3-a/b', '1.2.3-a&b', '1.2.3-a`b',
    '1.2.3-<b>', '<b>1.2.3</b>', '1.2.3<script>',
    '1.2.3-' + 'r'.repeat(41), '1.2.3+' + 'b'.repeat(41), '1.2.3-', '1.2.3+',
    ' '.repeat(200) + '1.2.3', ' '.repeat(196) + '1.2.3',
    ' '.repeat(195) + '1.2.30', ' '.repeat(195) + '1.2.3x',
    ' '.repeat(195) + '1.2.3-pre', ' '.repeat(195) + '1.2.3+build',
    ' '.repeat(190) + '1.2.3-rrrrrr', ' '.repeat(190) + '1.2.3+bbbbbb',
  ]) assert.strictEqual(parseVersion(input), undefined, 'f: rejected ' + JSON.stringify(input));
  assert.strictEqual(parseVersion(null as never), undefined, 'f: invalid runtime input');
  {
    const hostile = '9'.repeat(64 * 1024);
    const start = process.cpuUsage();
    assert.strictEqual(parseVersion(hostile), undefined, 'f: long digit run');
    const elapsed = process.cpuUsage(start);
    const cpuMs = (elapsed.user + elapsed.system) / 1000;
    assert.ok(cpuMs < 250, `f: 64 KiB digit run used ${cpuMs.toFixed(1)} ms CPU (catastrophic backstop: 250 ms)`);
  }


  // (g) compareVersions
  assert.ok(compareVersions('0.163.0', '0.99.9') > 0, 'g: numeric');
  assert.ok(compareVersions('1.0.0-rc.1', '1.0.0') < 0, 'g: pre-release older');
  assert.ok(compareVersions('1.0.0', '1.0.0-rc.1') > 0);
  assert.strictEqual(compareVersions('1.2.3', '1.2.3'), 0);
  assert.ok(compareVersions('1.0.0-rc.2', '1.0.0-rc.10') < 0, 'g: numeric pre-release ids');

  // (h) states
  {
    const e = mkEnv('linux', { PATH: '/b' }, ['/b/codex', '/b/claude'], '/h');
    const none = await detectBinary(CODEX_BINARY, mkEnv('linux', { PATH: '/b' }, [], '/h'), mkExec(ok('x')).exec);
    assert.deepStrictEqual(none, { state: 'not-installed', hint: CODEX_BINARY.installHint }, 'h: not-installed');
    const bads: [string, ExecResult | (() => Promise<ExecResult>)][] = [
      ['timeout', { code: null, stdout: '', stderr: '', timedOut: true }],
      ['enoent', { code: null, stdout: '', stderr: '', errorCode: 'ENOENT' }],
      ['non-zero', { code: 1, stdout: 'codex-cli 0.200.0', stderr: '' }],
      ['unparsable', ok('hello')],
      ['error prose', ok('npm ERR! … node v22.11.0')],
      ['later-line version', ok('warning\ncodex-cli 0.200.0')],
      ['overlong version', ok('codex-cli 1234567890.2.3')],
      ['throws', () => Promise.reject(new Error('boom'))],
    ];
    for (const [name, res] of bads) {
      const r = await detectBinary(CODEX_BINARY, e, mkExec(res).exec);
      assert.strictEqual(r.state, 'unknown', `h: ${name}`);
      assert.strictEqual(r.version, undefined);
    }
    const old = await detectBinary(CODEX_BINARY, e, mkExec(ok('codex-cli 0.162.9')).exec);
    assert.strictEqual(old.state, 'too-old');
    assert.strictEqual(old.hint, 'Found 0.162.9, needs 0.163.0 or later');
    const good = await detectBinary(CODEX_BINARY, e, mkExec(ok('codex-cli 0.163.0')).exec);
    assert.strictEqual(good.state, 'ready');
    assert.strictEqual(good.version, '0.163.0');
    assert.strictEqual(good.hint, 'Sign-in is checked when the agent starts.');
    const cl = await detectBinary(CLAUDE_BINARY, e, mkExec(ok('0.0.1 (Claude Code)')).exec);
    assert.strictEqual(cl.state, 'ready', 'h: Claude has no minimum');
    assert.strictEqual(CLAUDE_BINARY.minVersion, undefined);
  }

  // (i) no secrets
  {
    const e = mkEnv('linux', { PATH: '/b', API_TOKEN: 'sk-secret-123' }, ['/b/codex'], '/h');
    const outs = [
      await detectBinary(CODEX_BINARY, e, mkExec({ code: 1, stdout: '', stderr: 'TOKEN=abc sk-secret-123' }).exec),
      await detectBinary(CODEX_BINARY, e, mkExec({ code: 0, stdout: 'codex 0.1.0', stderr: 'TOKEN=abc' }).exec),
      await detectBinary(CODEX_BINARY, e, mkExec({ code: 0, stdout: 'codex 0.200.0', stderr: 'TOKEN=abc' }).exec),
    ];
    for (const o of outs) {
      const j = JSON.stringify(o);
      assert.ok(!j.includes('TOKEN=abc') && !j.includes('sk-secret-123') && !j.includes('abc'), 'i: no secret in result');
    }
  }

  // (j) copilot and detectorFor
  {
    const r = await detectCopilot();
    assert.strictEqual(r.state, 'ready');
    assert.ok(r.hint && r.hint.length > 0);
    const det = detectorFor('copilot');
    assert.ok(det, 'j: copilot detector');
    assert.strictEqual(typeof detectorFor('claude'), 'function', 'claude: a --version probe (spec 012 T093)');
    assert.strictEqual(typeof detectorFor('codex'), 'function', 'codex: --version then login status (spec 012 FR-137)');
    const d = { id: 'copilot', displayName: 'Copilot', capabilities: {}, create: () => { throw new Error('no'); } } as unknown as AdapterDescriptor;
    const infos = await detectAll(createRegistry([d]), det!);
    assert.strictEqual(infos[0].state, 'ready');
  }

  // (l) hints never show the full path (user name); Claude "local" installer folder
  {
    const bad = ok('hello');
    const hintOf = async (e: DetectEnv, spec = CLAUDE_BINARY): Promise<string | undefined> => (await detectBinary(spec, e, mkExec(bad).exec)).hint;
    const posix = await hintOf(mkEnv('linux', { PATH: '/home/alice/.local/bin' }, ['/home/alice/.local/bin/claude'], '/home/alice'));
    assert.strictEqual(posix, 'Found ~/.local/bin/claude but could not read its version.', 'l: under home on POSIX');
    const win = await hintOf(mkEnv('win32', { PATH: 'C:\\Users\\alice\\bin' }, ['C:\\Users\\alice\\bin\\claude.exe'], 'C:\\Users\\alice'));
    assert.strictEqual(win, 'Found ~\\bin\\claude.exe but could not read its version.', 'l: under home on Windows');
    const out = await hintOf(mkEnv('linux', { PATH: '/opt/x' }, ['/opt/x/claude'], '/home/alice'));
    assert.strictEqual(out, 'Found claude but could not read its version.', 'l: outside home shows the file name only');
    const sibling = await hintOf(mkEnv('linux', { PATH: '/home/alice2/bin' }, ['/home/alice2/bin/claude'], '/home/alice'));
    assert.strictEqual(sibling, 'Found claude but could not read its version.', 'l: a sibling folder of home is outside home');
    const unc = await hintOf(mkEnv('win32', { PATH: '\\\\srv\\share\\alice' }, ['\\\\srv\\share\\alice\\claude.exe'], 'C:\\Users\\alice'));
    assert.strictEqual(unc, 'Found claude.exe but could not read its version.', 'l: UNC shows the file name only');
    const unsafe = await hintOf(mkEnv('win32', { PATH: 'C:\\Users\\alice\\a&b' }, ['C:\\Users\\alice\\a&b\\claude.cmd'], 'C:\\Users\\alice'));
    assert.strictEqual(unsafe, 'Found ~\\a&b\\claude.cmd but cannot run it safely; install the native binary.', 'l: unsafe hint is shortened too');
    for (const h of [posix, win, out, unc, unsafe]) assert.ok(h && !h.includes('alice'), 'l: no user name in a hint');
    // the old Claude "local" installer, after ~/.local/bin, on macOS and Linux
    for (const [pl, home] of [['darwin', '/Users/u'], ['linux', '/home/u']] as const) {
      const c = candidates(CLAUDE_BINARY, mkEnv(pl, {}, [], home));
      const i = c.indexOf(`${home}/.local/bin/claude`);
      assert.ok(i >= 0 && c[i + 1] === `${home}/.claude/local/claude`, `l: ${pl} ~/.claude/local/claude right after ~/.local/bin`);
      const r = await detectBinary(CLAUDE_BINARY, mkEnv(pl, {}, [`${home}/.claude/local/claude`], home), mkExec(ok('2.1.3 (Claude Code)')).exec);
      assert.strictEqual(r.path, `${home}/.claude/local/claude`, `l: ${pl} found`);
    }
  }

  // (k) exec always gets an args array and 5000 ms
  {
    const e = mkEnv('linux', { PATH: '/b' }, ['/b/codex'], '/h');
    const x = mkExec(ok('0.200.0'));
    await detectBinary(CODEX_BINARY, e, x.exec);
    assert.ok(Array.isArray(x.calls[0].args) && x.calls[0].timeoutMs === 5000, 'k: args array, 5000 ms');
    assert.deepStrictEqual(x.calls[0].args, ['--version']);
    assert.ok(!x.calls[0].verbatim, 'd: POSIX is not verbatim');
  }

  // spec 012 FR-132: Claude's sign-in state from `auth status --json` after the version (no prompt); only loggedIn is read
  {
    const e = mkEnv('linux', { PATH: '/usr/bin' }, ['/usr/bin/claude'], '/home/u');
    const seq = (outs: ExecResult[]): { exec: Exec; calls: Call[] } => { let i = 0; return mkExec(async () => outs[Math.min(i++, outs.length - 1)]); };
    const out = (o: unknown): ExecResult => ok(JSON.stringify(o));
    const s1 = seq([ok('2.1.302 (Claude Code)'), out({ loggedIn: true, email: 'secret@example.com', orgName: 'Org' })]);
    const r1 = await detectClaude(e, s1.exec);
    assert.strictEqual(r1.state, 'ready');
    assert.strictEqual(r1.hint, 'Signed in to Claude Code on this computer.');
    assert.deepStrictEqual(s1.calls.map((c) => c.args.join(' ')), ['--version', 'auth status --json'], 'version, then auth status; no prompt');
    assert.ok(!JSON.stringify(r1).includes('secret') && !JSON.stringify(r1).includes('Org'), 'nothing from the account is kept');
    const r2 = await detectClaude(e, seq([ok('2.1.302'), out({ loggedIn: false })]).exec);
    assert.deepStrictEqual([r2.state, r2.hint, r2.version], ['not-signed-in', CLAUDE_SIGN_IN_HINT, '2.1.302']);
    for (const bad of [ok('not json'), { code: 1, stdout: '', stderr: 'unknown command' }, { code: null, stdout: '', stderr: '', timedOut: true }, out({}), out(null)] as ExecResult[]) {
      assert.strictEqual((await detectClaude(e, seq([ok('2.1.302'), bad]).exec)).state, 'ready', 'unclear sign-in keeps ready: ' + JSON.stringify(bad));
    }
    const s3 = seq([ok('garbage')]);
    assert.strictEqual((await detectClaude(e, s3.exec)).state, 'unknown');
    assert.strictEqual(s3.calls.length, 1, 'no auth call when the version is unreadable');
    // Windows .cmd shim: both calls go through cmd /d /s /c with the shim quoted
    const w = mkEnv('win32', { PATH: 'C:\\npm', ComSpec: 'C:\\Windows\\cmd.exe' }, ['C:\\npm\\claude.cmd'], 'C:\\Users\\u');
    const s4 = seq([ok('2.1.302'), out({ loggedIn: false })]);
    assert.strictEqual((await detectClaude(w, s4.exec)).state, 'not-signed-in');
    assert.deepStrictEqual(s4.calls.map((c) => [c.file, c.args[c.args.length - 1], c.verbatim]), [['C:\\Windows\\cmd.exe', '"C:\\npm\\claude.cmd" --version', true], ['C:\\Windows\\cmd.exe', '"C:\\npm\\claude.cmd" auth status --json', true]]);
  }
  // spec 012 FR-137: Codex's sign-in state from `codex login status` after the version (no prompt); only the phrase and exit code are read
  {
    const e = mkEnv('linux', { PATH: '/usr/bin' }, ['/usr/bin/codex'], '/home/u');
    const seq = (outs: ExecResult[]): { exec: Exec; calls: Call[] } => { let i = 0; return mkExec(async () => outs[Math.min(i++, outs.length - 1)]); };
    const s1 = seq([ok('codex-cli 0.163.0'), ok('Logged in using ChatGPT')]);
    const r1 = await detectCodex(e, s1.exec);
    assert.deepStrictEqual([r1.state, r1.hint, r1.version], ['ready', 'Signed in to Codex on this computer.', '0.163.0']);
    assert.deepStrictEqual(s1.calls.map((c) => c.args.join(' ')), ['--version', 'login status'], 'version, then login status; no prompt');
    const r2 = await detectCodex(e, seq([ok('codex-cli 0.163.0'), { code: 1, stdout: 'Not logged in\n', stderr: '' }]).exec);
    assert.deepStrictEqual([r2.state, r2.hint], ['not-signed-in', CODEX_SIGN_IN_HINT]);
    for (const bad of [{ code: 1, stdout: '', stderr: "error: unrecognized subcommand 'login'" }, { code: null, stdout: '', stderr: '', timedOut: true }, ok('something else')] as ExecResult[]) {
      assert.strictEqual((await detectCodex(e, seq([ok('codex-cli 0.163.0'), bad]).exec)).state, 'ready', 'unclear sign-in keeps ready: ' + JSON.stringify(bad));
    }
  }
  // spec 060 FR-003: version-manager and Linuxbrew folders, after PATH, the login shell's PATH and the fixed folders
  {
    const dirs: Record<string, string[]> = {
      '/home/u/.nvm/versions/node': ['v20.11.1', 'v22.3.0', 'v18.20.0', '.cache', 'notes'],
      '/home/u/.local/share/fnm/node-versions': ['v21.0.0'],
    };
    const mk = (platform: NodeJS.Platform, env: Record<string, string>, home: string, extra: Partial<DetectEnv> = {}): DetectEnv => ({ platform, env, homedir: home, isFile: () => false, listDir: (d) => dirs[d] ?? [], ...extra });
    const c = candidates(CLAUDE_BINARY, mk('linux', { PATH: '/usr/bin' }, '/home/u'));
    const nvm = ['v22.3.0', 'v20.11.1', 'v18.20.0'].map((v) => `/home/u/.nvm/versions/node/${v}/bin/claude`);
    assert.deepStrictEqual(c.filter((x) => x.includes('/.nvm/')), [...nvm, '/home/u/.nvm/versions/node/notes/bin/claude'], 'nvm: newest first, hidden names skipped, other names last');
    for (const want of ['/home/u/.fnm/aliases/default/bin/claude', '/home/u/.local/share/fnm/aliases/default/bin/claude', '/home/u/.local/share/fnm/node-versions/v21.0.0/installation/bin/claude', '/home/u/.volta/bin/claude', '/home/u/.asdf/shims/claude', '/home/u/.local/share/mise/shims/claude', '/home/linuxbrew/.linuxbrew/bin/claude', '/home/u/.linuxbrew/bin/claude'])
      assert.ok(c.includes(want), 'linux folder: ' + want);
    assert.ok(c.indexOf('/home/u/.npm-global/bin/claude') < c.indexOf(nvm[0]), 'new folders come after the fixed ones');
    assert.strictEqual(c.filter((x) => x === '/usr/bin/claude').length, 1, 'deduplicated (PATH and the fixed /usr/bin)');
    const mac = candidates(CLAUDE_BINARY, mk('darwin', { NVM_DIR: '/opt/nvm', FNM_DIR: '/opt/fnm' }, '/Users/u'));
    assert.ok(mac.includes('/opt/fnm/aliases/default/bin/claude') && mac.includes('/Users/u/Library/Application Support/fnm/aliases/default/bin/claude') && mac.includes('/Users/u/.volta/bin/claude'), 'macOS: FNM_DIR, fnm in Application Support, Volta');
    assert.ok(!mac.some((x) => x.includes('linuxbrew')), 'no Linuxbrew on macOS');
    assert.ok(!candidates(CLAUDE_BINARY, mk('linux', { NVM_DIR: 'rel/nvm' }, '/home/u')).some((x) => x.startsWith('rel')), 'a relative NVM_DIR is ignored');
    // the login shell's PATH: after PATH, before the fixed folders; relative entries skipped
    const lp = candidates(CLAUDE_BINARY, mk('linux', { PATH: '/usr/bin' }, '/home/u', { loginPath: ['/home/u/.nvm/versions/node/v22.3.0/bin', 'rel'] }));
    assert.ok(lp.indexOf('/usr/bin/claude') < lp.indexOf(nvm[0]) && lp.indexOf(nvm[0]) < lp.indexOf('/home/u/.local/bin/claude'), 'login PATH between PATH and the fixed folders');
    assert.strictEqual(lp.filter((x) => x === nvm[0]).length, 1, 'login PATH entry not repeated by the nvm scan');
    // a listDir that throws costs nothing
    assert.ok(candidates(CLAUDE_BINARY, mk('linux', {}, '/home/u', { listDir: () => { throw new Error('EACCES'); } })).includes('/home/u/.volta/bin/claude'));
    // Windows: Volta, nvm-windows link and version folders; case-insensitive dedupe
    const w = candidates(CODEX_BINARY, { platform: 'win32', env: { LOCALAPPDATA: 'C:\\L', APPDATA: 'C:\\A', NVM_SYMLINK: 'C:\\Program Files\\nodejs', Path: 'C:\\program files\\NODEJS' }, homedir: 'C:\\Users\\u', isFile: () => false, listDir: (d) => (d === 'C:\\A\\nvm' ? ['v20.0.0', 'v22.1.0'] : []) });
    assert.ok(w.includes('C:\\L\\Volta\\bin\\codex.exe'), 'Windows Volta');
    assert.ok(w.indexOf('C:\\A\\nvm\\v22.1.0\\codex.cmd') < w.indexOf('C:\\A\\nvm\\v20.0.0\\codex.cmd'), 'nvm-windows newest first');
    assert.ok(!w.includes('C:\\Program Files\\nodejs\\codex.exe'), 'NVM_SYMLINK already on Path (other case): not repeated');
    assert.ok(!candidates(CODEX_BINARY, { platform: 'win32', env: { LOCALAPPDATA: 'C:\\L' }, homedir: 'C:\\Users\\u', isFile: () => false }).some((x) => x.includes('.nvm') || x.includes('.volta')), 'no POSIX folders on Windows');
    assert.deepStrictEqual(newestFirst(['1.2.3', 'v1.10.0', 'a/b', 'z', 'b']), ['v1.10.0', '1.2.3', 'b', 'z']);
    // the registry passes `where` on (trimmed, a string only) and drops anything else
    const reg = createRegistry([{ id: 'codex', displayName: 'Codex', capabilities: {}, create: () => { throw new Error('no'); } } as unknown as AdapterDescriptor]);
    assert.strictEqual((await detectAll(reg, async () => ({ state: 'ready', where: ' ~/.volta/bin/codex ' })))[0].where, '~/.volta/bin/codex');
    assert.ok(!('where' in (await detectAll(reg, async () => ({ state: 'ready', where: 42 as never })))[0]), 'a non-string where is dropped');
  }
  // spec 060 FR-003: the login shell, its command and parser; a fake spawn (no real shell in unit tests)
  {
    const isFile = (p: string) => ['/bin/zsh', '/usr/local/bin/fish', '/opt/evil/notashell'].includes(p);
    assert.deepStrictEqual(loginShellCommand('/bin/zsh', isFile), { file: '/bin/zsh', args: ['-l', '-c', 'printf "__DURBAR_PATH__%s__END__" "$PATH"'] });
    assert.deepStrictEqual(loginShellCommand('/usr/local/bin/fish', isFile).args[2], 'printf "__DURBAR_PATH__%s__END__" (string join : $PATH)');
    for (const bad of [undefined, 'zsh', '/opt/evil/notashell', '/bin/bash' /* not a file here */, '/bin/zsh\n'])
      assert.strictEqual(loginShellCommand(bad, isFile).file, '/bin/sh', 'fallback for ' + String(bad));
  // the login PATH is added after the process's own, without duplicates: an nvm `claude` then finds its `node` when it runs
  assert.strictEqual(mergeLoginPath('/usr/bin:/bin', ['/home/u/.nvm/versions/node/v22.3.0/bin', '/usr/bin']), '/usr/bin:/bin:/home/u/.nvm/versions/node/v22.3.0/bin');
  assert.strictEqual(mergeLoginPath(undefined, ['/opt/x']), '/opt/x');
  assert.strictEqual(mergeLoginPath('/a::/b', []), '/a:/b');
    assert.deepStrictEqual(parseLoginPath('motd junk\n__DURBAR_PATH__/a/bin:rel:/b/bin::/a/bin__END__trailing'), ['/a/bin', '/b/bin'], 'markers, junk, relative and duplicate entries');
    assert.deepStrictEqual(parseLoginPath('no markers /a/bin'), []);
    assert.deepStrictEqual(parseLoginPath('__DURBAR_PATH__/a/bin'), [], 'no end marker');
    assert.deepStrictEqual(parseLoginPath('__DURBAR_PATH__/' + 'x'.repeat(9000) + '__END__'), [], 'too long');
    assert.strictEqual(parseLoginPath('__DURBAR_PATH__' + Array.from({ length: 100 }, (_, i) => '/d' + i).join(':') + '__END__').length, MAX_LOGIN_DIRS, 'capped');
    type Fake = EventEmitter & { pid: number; stdout: EventEmitter; kill: () => boolean };
    const spawned: Array<{ file: string; args: readonly string[]; opts: { shell?: boolean; stdio?: unknown; detached?: boolean } }> = [];
    let child!: Fake;
    const fakeSpawn = ((file: string, args: readonly string[], opts: never) => {
      spawned.push({ file, args, opts });
      child = Object.assign(new EventEmitter(), { pid: 0, stdout: new EventEmitter(), kill: () => true });
      return child;
    }) as never;
    const p1 = readLoginShellPath({ platform: 'darwin', shellEnv: '/bin/zsh', isFile, spawn: fakeSpawn });
    child.stdout.emit('data', Buffer.from('hello\n__DURBAR_PATH__/opt/homebrew/bin:/Users/u/.nvm/versions/node/v22.3.0/bin__END__'));
    child.emit('close', 0);
    assert.deepStrictEqual(await p1, ['/opt/homebrew/bin', '/Users/u/.nvm/versions/node/v22.3.0/bin']);
    assert.deepStrictEqual([spawned[0].file, spawned[0].opts.shell, spawned[0].opts.detached, (spawned[0].opts.stdio as string[])[0]], ['/bin/zsh', false, true, 'ignore'], 'argv only, own group, stdin closed');
    // a profile that hangs: the time limit gives an empty list
    const p2 = readLoginShellPath({ platform: 'linux', shellEnv: '/bin/zsh', isFile, spawn: fakeSpawn, timeoutMs: 20 });
    assert.deepStrictEqual(await p2, [], 'timeout: empty, falls back to the fixed folders');
    const p3 = readLoginShellPath({ platform: 'linux', shellEnv: '/bin/zsh', isFile, spawn: fakeSpawn });
    child.emit('error', new Error('ENOENT'));
    assert.deepStrictEqual(await p3, []);
    const before = spawned.length;
    assert.deepStrictEqual(await readLoginShellPath({ platform: 'win32', shellEnv: undefined, isFile, spawn: fakeSpawn }), [], 'not on Windows');
    assert.strictEqual(spawned.length, before, 'no spawn on Windows');
  }
  // spec 060 FR-010: App Execution Aliases (winget.exe) in %LOCALAPPDATA%\Microsoft\WindowsApps
  {
    const env = { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' };
    const dir = 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps';
    assert.strictEqual(windowsAppsDir({ platform: 'win32', env }), dir);
    assert.strictEqual(windowsAppsDir({ platform: 'linux', env }), undefined);
    assert.strictEqual(windowsAppsDir({ platform: 'win32', env: { LOCALAPPDATA: 'relative' } }), undefined, 'only an absolute LOCALAPPDATA');
    const spec = (name: string) => ({ name, versionArgs: [], installHint: '' });
    const w = candidates(spec('winget'), { platform: 'win32', env, homedir: 'C:\\Users\\u', isFile: () => false });
    assert.ok(w.includes(dir + '\\winget.exe'), 'winget is looked for in WindowsApps');
    assert.ok(candidates(spec('pwsh'), { platform: 'win32', env, homedir: 'C:\\Users\\u', isFile: () => false }).includes(dir + '\\pwsh.exe'), 'a Store PowerShell 7 too');
    for (const n of ['claude', 'codex', 'copilot', 'npm']) assert.ok(!candidates(spec(n), { platform: 'win32', env, homedir: 'C:\\Users\\u', isFile: () => false }).some((c) => c.startsWith(dir)), `no WindowsApps look-up for ${n}`);
    assert.ok(isAppAlias(dir.toLowerCase() + '\\winget.exe', { platform: 'win32', env }), 'case-insensitive');
    assert.ok(!isAppAlias(dir + '\\sub\\winget.exe', { platform: 'win32', env }), 'directly in the folder only');
    assert.ok(!isAppAlias('/home/u/winget', { platform: 'linux', env }));
    // Node's stat throws EACCES on an alias; lstat answers. Only in WindowsApps is lstat asked.
    const eacces = () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); };
    let lstats = 0;
    const fsx = (lstatOk: boolean, isDir = false) => ({ statSync: eacces, lstatSync: () => { lstats++; if (!lstatOk) eacces(); return { isDirectory: () => isDir }; } });
    assert.strictEqual(statIsFile(dir + '\\winget.exe', 'win32', env, fsx(true)), true, 'an alias counts as a file');
    assert.strictEqual(statIsFile(dir + '\\winget.exe', 'win32', env, fsx(false)), false, 'missing: no');
    assert.strictEqual(statIsFile(dir + '\\winget.exe', 'win32', env, fsx(true, true)), false, 'a folder: no');
    assert.strictEqual(statIsFile(dir + '\\PWSH.EXE', 'win32', env, fsx(true)), true, 'a Store pwsh too, any case');
    // review on #469: only the aliases FR-010 names; claude, codex, copilot or anything else in WindowsApps stays "no"
    for (const n of ['claude.exe', 'codex.exe', 'copilot.exe', 'python.exe', 'winget.cmd', 'winget']) assert.strictEqual(statIsFile(dir + '\\' + n, 'win32', env, fsx(true)), false, `no alias fallback for ${n}`);
    lstats = 0;
    assert.strictEqual(statIsFile('C:\\Program Files\\nodejs\\npm.cmd', 'win32', env, fsx(true)), false, 'elsewhere a failing stat stays no');
    assert.strictEqual(statIsFile('/usr/bin/x', 'linux', env, fsx(true)), false);
    assert.strictEqual(lstats, 0, 'lstat is asked only in WindowsApps');
    assert.strictEqual(statIsFile('/usr/bin/x', 'linux', env, { statSync: () => ({ isFile: () => true }), lstatSync: eacces as never }), true, 'stat first');
  }
  console.log('detect tests passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

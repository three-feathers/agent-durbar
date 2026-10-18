/** Binary detection for Claude and Codex (spec 012 T012, FR-035..FR-041): fake isFile and fake exec only. No process, no credits. */
import * as assert from 'assert';
import { CLAUDE_BINARY, CODEX_BINARY, candidates, compareVersions, detectBinary, detectCopilot, detectorFor, parseVersion } from '../src/adapters/detect';
import type { DetectEnv, Exec, ExecResult } from '../src/adapters/detect';
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
    assert.ok(!c.some((x) => x.startsWith('rel')), 'b: relative entry skipped');
    const x = mkExec(ok('0.200.0'));
    const r = await detectBinary(CODEX_BINARY, e, x.exec);
    assert.strictEqual(r.path, 'C:\\Program Files\\x\\codex.exe', 'b: exe wins');
    assert.strictEqual(x.calls[0].file, 'C:\\Program Files\\x\\codex.exe', 'b: exe runs directly');
    assert.ok(!x.calls[0].verbatim, 'd: .exe is not verbatim');
    const k = candidates(CODEX_BINARY, mkEnv('win32', { APPDATA: 'C:\\A', LOCALAPPDATA: 'C:\\L' }, [], 'C:\\Users\\u'));
    assert.ok(k.includes('C:\\Users\\u\\.local\\bin\\codex.exe') && k.includes('C:\\A\\npm\\codex.cmd') && k.includes('C:\\L\\Programs\\codex\\codex.exe'), 'b: Windows known folders');
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
    assert.strictEqual(detectorFor('claude'), undefined);
    const d = { id: 'copilot', displayName: 'Copilot', capabilities: {}, create: () => { throw new Error('no'); } } as unknown as AdapterDescriptor;
    const infos = await detectAll(createRegistry([d]), det!);
    assert.strictEqual(infos[0].state, 'ready');
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

  console.log('detect tests passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

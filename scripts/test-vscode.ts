/** Unit test for how VS Code is located and launched (no Electron, no VS Code needed): `npm run test:vscode`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { EDITIONS, isWindowsTarget, openInVSCode, planVSCodeLaunch, spawnPlan } from '../src/main/vscode';
import type { LaunchEnv } from '../src/main/vscode';

const env = (platform: NodeJS.Platform, files: string[], vars: NodeJS.ProcessEnv, homedir: string): LaunchEnv => ({
  platform,
  env: vars,
  homedir,
  isFile: (p) => files.includes(p),
});

// macOS launched from Finder: PATH has no `code`, fall back to the app bundle
let p = planVSCodeLaunch('/Users/a/proj', env('darwin', ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'], { PATH: '/usr/bin:/bin' }, '/Users/a'));
assert.deepStrictEqual(p?.args, ['/Users/a/proj']);
assert.strictEqual(p?.command, '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code');
// macOS: PATH wins when present; relative PATH entries are ignored
p = planVSCodeLaunch('/x', env('darwin', ['/opt/x/code', '/usr/bin/code'], { PATH: 'rel/bin:/opt/x' }, '/Users/a'));
assert.strictEqual(p?.command, '/opt/x/code');
// not installed
assert.strictEqual(planVSCodeLaunch('/x', env('darwin', [], { PATH: '/usr/bin' }, '/Users/a')), undefined);
assert.strictEqual(planVSCodeLaunch('/x', env('linux', [], { PATH: '' }, '/home/a')), undefined);
p = planVSCodeLaunch('/x', env('linux', ['/snap/bin/code'], { PATH: '/usr/bin' }, '/home/a'));
assert.strictEqual(p?.command, '/snap/bin/code');

// Windows: per-user install, Code.exe directly, no cmd.exe, no shell
const local = 'C:\\Users\\a\\AppData\\Local';
const exe = `${local}\\Programs\\Microsoft VS Code\\Code.exe`;
p = planVSCodeLaunch('C:\\proj & calc', env('win32', [exe], { LOCALAPPDATA: local }, 'C:\\Users\\a'));
assert.strictEqual(p?.command, exe);
assert.deepStrictEqual(p?.args, ['C:\\proj & calc'], 'path with metacharacters is passed as a single argv entry');
// Windows: only code.cmd on PATH and Code.exe beside it
const bin = 'D:\\Tools\\VSCode\\bin';
p = planVSCodeLaunch('D:\\p', env('win32', [`${bin}\\code.cmd`, 'D:\\Tools\\VSCode\\Code.exe'], { PATH: `C:\\Windows;${bin}` }, 'C:\\Users\\a'));
assert.strictEqual(p?.command, 'D:\\Tools\\VSCode\\Code.exe');
// Windows: only code.cmd exists -> cmd.exe route, but refused for paths cmd.exe could interpret
const cmd = `${local}\\Programs\\Microsoft VS Code\\bin\\code.cmd`;
p = planVSCodeLaunch('C:\\ok\\proj', env('win32', [cmd], { LOCALAPPDATA: local, ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, 'C:\\Users\\a'));
assert.strictEqual(p?.command, 'C:\\Windows\\System32\\cmd.exe');
assert.deepStrictEqual(p?.args.slice(0, 3), ['/d', '/s', '/c']);
for (const bad of ['C:\\a & calc', 'C:\\a"b', 'C:\\%PATH%', 'C:\\a|b', 'C:\\a^b']) {
  assert.strictEqual(planVSCodeLaunch(bad, env('win32', [cmd], { LOCALAPPDATA: local }, 'C:\\Users\\a')), undefined, bad);
}
assert.strictEqual(planVSCodeLaunch('C:\\p', env('win32', [], { LOCALAPPDATA: local }, 'C:\\Users\\a')), undefined);
// spec 009 FR-015: VS Code, then Insiders, then VSCodium, each found the same way; the plan names the edition
assert.deepStrictEqual(EDITIONS.map((e) => e.name), ['VS Code', 'VS Code Insiders', 'VSCodium']);
p = planVSCodeLaunch('/x', env('linux', ['/usr/bin/code'], { PATH: '/usr/bin' }, '/home/a'));
assert.strictEqual(p?.edition, 'VS Code', 'stable is named');
p = planVSCodeLaunch('/x', env('linux', ['/snap/bin/code-insiders'], { PATH: '' }, '/home/a'));
assert.deepStrictEqual([p?.command, p?.edition], ['/snap/bin/code-insiders', 'VS Code Insiders']);
p = planVSCodeLaunch('/x', env('linux', ['/opt/vsc/codium'], { PATH: '/opt/vsc' }, '/home/a'));
assert.deepStrictEqual([p?.command, p?.edition, p?.args], ['/opt/vsc/codium', 'VSCodium', ['/x']]);
p = planVSCodeLaunch('/x', env('linux', ['/usr/bin/codium', '/usr/bin/code-insiders', '/usr/bin/code'], { PATH: '/usr/bin' }, '/home/a'));
assert.strictEqual(p?.edition, 'VS Code', 'all three installed: stable first');
p = planVSCodeLaunch('/x', env('linux', ['/usr/bin/codium', '/usr/bin/code-insiders'], { PATH: '/usr/bin' }, '/home/a'));
assert.strictEqual(p?.edition, 'VS Code Insiders', 'Insiders before VSCodium');
p = planVSCodeLaunch('/Users/a/p', env('darwin', ['/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code'], { PATH: '/usr/bin' }, '/Users/a'));
assert.strictEqual(p?.edition, 'VS Code Insiders', 'macOS Insiders app bundle');
p = planVSCodeLaunch('/Users/a/p', env('darwin', ['/Users/a/Applications/VSCodium.app/Contents/Resources/app/bin/codium'], { PATH: '' }, '/Users/a'));
assert.deepStrictEqual([p?.edition, p?.command], ['VSCodium', '/Users/a/Applications/VSCodium.app/Contents/Resources/app/bin/codium']);
{
  const local = 'C:\\Users\\a\\AppData\\Local';
  const ins = `${local}\\Programs\\Microsoft VS Code Insiders\\Code - Insiders.exe`;
  p = planVSCodeLaunch('C:\\proj', env('win32', [ins], { LOCALAPPDATA: local }, 'C:\\Users\\a'));
  assert.deepStrictEqual([p?.command, p?.args, p?.edition], [ins, ['C:\\proj'], 'VS Code Insiders']);
  const cod = 'C:\\Program Files\\VSCodium\\VSCodium.exe';
  p = planVSCodeLaunch('C:\\proj', env('win32', [cod], { ProgramFiles: 'C:\\Program Files' }, 'C:\\Users\\a'));
  assert.deepStrictEqual([p?.command, p?.edition], [cod, 'VSCodium']);
  // a codium.cmd on PATH with no VSCodium.exe next to it goes through the guarded cmd.exe path
  p = planVSCodeLaunch('C:\\proj', env('win32', ['C:\\tools\\bin\\codium.cmd'], { PATH: 'C:\\tools\\bin', SystemRoot: 'C:\\Windows' }, 'C:\\Users\\a'));
  assert.deepStrictEqual([p?.command, p?.edition], ['C:\\Windows\\System32\\cmd.exe', 'VSCodium']);
  // spec 060 FR-094: a quoted PATH entry (as Windows allows) is found, the same as detection does
  p = planVSCodeLaunch('C:\\proj', env('win32', ['C:\\Program Files\\VSCode\\bin\\code.cmd', 'C:\\Program Files\\VSCode\\Code.exe'], { PATH: '"C:\\Program Files\\VSCode\\bin";C:\\Windows' }, 'C:\\Users\\a'));
  assert.deepStrictEqual([p?.command, p?.edition], ['C:\\Program Files\\VSCode\\Code.exe', 'VS Code'], 'quoted PATH entry found');
}

// spec 009 FR-028 (issue #1255): on Windows only a drive or UNC path is a target; the verbatim flag is explicit on the plan.
for (const ok of ['C:\\proj', 'c:/proj', 'D:\\', '\\\\srv\\share', '\\\\srv\\share\\p', '\\\\?\\C:\\p', '\\\\?\\c:\\', '\\\\?\\UNC\\srv\\share', '\\\\?\\unc\\srv\\share\\p', '\\\\srv/share']) assert.strictEqual(isWindowsTarget(ok), true, ok);
for (const bad of ['/some-switch', '\\proj', '/proj', '//srv/share', '\\\\srv', '\\\\srv\\', 'C:proj', 'C:', '-x', '--x', 'proj', '1:\\p', '',
  // device and other \\?\ forms are no folder (pre-review of #1523)
  '\\\\.\\C:\\p', '\\\\.\\pipe\\x', '\\\\.\\PhysicalDrive0', '\\\\?\\GLOBALROOT\\Device\\x', '\\\\?\\x', '\\\\?\\C:', '\\\\?\\C:/p', '\\\\?\\UNC\\srv', '\\\\?\\UNC\\.\\x', '\\\\?/C:\\p', '\\\\..\\x', '\\\\a?b\\c',
  // pipe and mailslot shares, a redirector prefix and DOS device names in any component (review of #1523)
  '\\\\localhost\\pipe\\x', '\\\\127.0.0.1\\pipe\\x', '\\\\?\\UNC\\localhost\\pipe\\x', '\\\\srv\\MAILSLOT\\x', '\\\\*\\mailslot\\x', '\\\\a*b\\c',
  '\\\\;LanmanRedirector\\srv\\share', '\\\\?\\UNC\\;x\\share', 'C:\\NUL', 'C:\\x\\COM1', 'c:\\nul.txt', 'C:\\AUX .x', 'C:\\CON.', 'C:\\x\\LPT\u00b9', 'C:\\conout$', '\\\\?\\C:\\PRN', '\\\\srv\\share\\com9.log',
  // re-review of #1523: a device name ends at `.` or `:`; a device in any component, not only the last; pipe shares with trailing dots,
  // spaces or a stream; `.` and `..` components
  'C:\\NUL:', 'C:\\COM1:', 'C:\\x\\NUL:stream', 'C:\\x\\CON:foo.txt', 'C:\\NUL\\x', '\\\\srv\\share\\COM1\\x', '\\\\?\\C:\\AUX\\p',
  '\\\\srv\\pipe.', '\\\\srv\\pipe ', '\\\\srv\\pipe.\\x', '\\\\srv\\pipe:x\\y', '\\\\srv\\MailSlot. \\x', '\\\\srv\\.\\pipe\\x', 'C:\\x\\..\\y', 'C:\\.\\x', 'C:\\x\\..',
]) assert.strictEqual(isWindowsTarget(bad), false, bad);
// names that only start like a device or a pipe share are folders
for (const ok of ['C:\\console', 'C:\\CON1', 'C:\\COM10', 'C:\\x\\nullable.txt', 'C:\\CON foo', '\\\\srv\\pipes', '\\\\pipe\\share', '\\\\srv\\share\\pipe',
  // normal folders stay open after the `.`, `..` and `:` rules
  'C:\\NULL', 'C:\\x\\COM\u2074', 'C:\\x\\.git', 'C:\\x\\..config', 'C:\\x\\a.b.c', '\\\\10.0.0.1\\c$\\x', 'C:\\Program Files (x86)\\App', 'D:\\work\\app.v2',
  'C:\\Users\\a\\My Projects\\site', 'C:\\x\\con-app', 'C:\\x\\aux_tools', 'C:\\x\\pipe', '\\\\srv\\pipeline\\x', '\\\\srv\\share\\.vscode', 'C:\\Users\\a\\OneDrive - Org\\repo']) assert.strictEqual(isWindowsTarget(ok), true, ok);
process.exitCode = 1; // a promise that never settles must not pass (checklist); 0 only after the OK line
{
  const local = 'C:\\Users\\a\\AppData\\Local';
  const exe = `${local}\\Programs\\Microsoft VS Code\\Code.exe`;
  const cmd = `${local}\\Programs\\Microsoft VS Code\\bin\\code.cmd`;
  assert.strictEqual(planVSCodeLaunch('C:\\p', env('win32', [exe], { LOCALAPPDATA: local }, 'C:\\Users\\a'))?.verbatim, undefined, 'Code.exe plan is not verbatim');
  assert.strictEqual(planVSCodeLaunch('C:\\p', env('win32', [cmd], { LOCALAPPDATA: local }, 'C:\\Users\\a'))?.verbatim, true, 'the cmd.exe plan says verbatim');
  assert.strictEqual(planVSCodeLaunch('/x', env('linux', ['/usr/bin/code'], { PATH: '/usr/bin' }, '/home/a'))?.verbatim, undefined);
  // the cmd.exe route quotes the target: a trailing backslash (a drive root) is doubled so it does not escape the closing quote
  for (const [t, q] of [['C:\\', 'C:\\\\'], ['\\\\srv\\share\\p\\', '\\\\srv\\share\\p\\\\'], ['C:\\p', 'C:\\p'],
    ['C:\\p\\\\', 'C:\\p\\\\\\\\'], ['C:\\p\\\\\\', 'C:\\p\\\\\\\\\\\\']]) {
    assert.strictEqual(planVSCodeLaunch(t, env('win32', [cmd], { LOCALAPPDATA: local }, 'C:\\Users\\a'))?.args[3], `"${cmd}" "${q}"`, 'drive root on the cmd.exe route: ' + t);
  }

  type Seen = { cmd: string; args: readonly string[]; opts: Record<string, unknown> };
  let seen: Seen[] = [];
  const fake = ((cmd: string, args: readonly string[], opts: Record<string, unknown>) => {
    seen.push({ cmd, args, opts });
    const h: Record<string, (x?: unknown) => void> = {};
    setImmediate(() => h.spawn?.());
    return { once: (e: string, f: (x?: unknown) => void) => { h[e] = f; }, unref: () => undefined };
  }) as never;
  (async () => {
    let r0: { ok: boolean };
    const win = env('win32', [exe], { LOCALAPPDATA: local }, 'C:\\Users\\a');
    // a root-relative path is absolute to path.win32 but Code.exe would read `/some-switch` as a switch: refused, nothing spawned
    for (const bad of ['/some-switch', '\\proj', '//srv/share', 'C:proj']) {
      seen = [];
      const r = await openInVSCode(bad, win, fake);
      assert.deepStrictEqual([r.ok, r.error, seen.length], [false, 'path must start with a drive letter or be a UNC path', 0], bad);
    }
    // control characters (no Windows name has one) are refused before anything is planned
    for (const bad of ['C:\\a\nb', 'C:\\a\rb', 'C:\\a\tb', 'C:\\a\x1fb']) {
      seen = [];
      const r = await openInVSCode(bad, win, fake);
      assert.deepStrictEqual([r.ok, r.error, seen.length], [false, 'invalid path', 0], 'control character: ' + JSON.stringify(bad));
    }
    r0 = await openInVSCode('/home/a/x\ty', env('linux', ['/usr/bin/code'], { PATH: '/usr/bin' }, '/home/a'), fake);
    assert.strictEqual(r0.ok, true, 'a tab is a legal POSIX name: not refused on Linux');
    for (const good of ['C:\\proj', '\\\\srv\\share\\proj']) {
      seen = [];
      const r = await openInVSCode(good, win, fake);
      assert.deepStrictEqual([r.ok, seen.length, seen[0].cmd, seen[0].args], [true, 1, exe, [good]], good);
      assert.deepStrictEqual([seen[0].opts.shell, seen[0].opts.windowsVerbatimArguments], [false, false], 'Code.exe gets normal quoting');
    }
    // only code.cmd: the guarded cmd.exe route, and only there is the command line passed verbatim
    seen = [];
    let r = await openInVSCode('C:\\ok\\proj', env('win32', [cmd], { LOCALAPPDATA: local, ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, 'C:\\Users\\a'), fake);
    assert.deepStrictEqual([r.ok, seen[0].cmd, seen[0].args.slice(0, 3), seen[0].opts.windowsVerbatimArguments], [true, 'C:\\Windows\\System32\\cmd.exe', ['/d', '/s', '/c'], true]);
    // the flag decides, not the first argument: a plan starting with /d but not marked verbatim gets normal quoting; verbatim is Windows only
    seen = [];
    await spawnPlan({ command: 'C:\\x.exe', args: ['/d', 'C:\\p'], via: 'x' }, fake, 'win32');
    await spawnPlan({ command: 'C:\\x.exe', args: ['C:\\p'], via: 'x', verbatim: true }, fake, 'win32');
    await spawnPlan({ command: '/usr/bin/x', args: ['/d'], via: 'x', verbatim: true }, fake, 'linux');
    assert.deepStrictEqual(seen.map((s) => s.opts.windowsVerbatimArguments), [false, true, false]);
    // macOS and Linux: absolute as before
    seen = [];
    r = await openInVSCode('rel/proj', env('linux', ['/usr/bin/code'], { PATH: '/usr/bin' }, '/home/a'), fake);
    assert.deepStrictEqual([r.ok, r.error, seen.length], [false, 'path must be absolute', 0]);
    r = await openInVSCode('/home/a/proj', env('linux', ['/usr/bin/code'], { PATH: '/usr/bin' }, '/home/a'), fake);
    assert.deepStrictEqual([r.ok, seen[0].args], [true, ['/home/a/proj']]);
    // static: the verbatim switch is read from the plan's flag only
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'vscode.ts'), 'utf8');
    assert.ok(!/args\[0\]\s*===\s*'\/d'/.test(src), 'no guess from args[0]');
    assert.strictEqual((src.match(/windowsVerbatimArguments:/g) ?? []).length, 1);
    assert.ok(/windowsVerbatimArguments: platform === 'win32' && plan\.verbatim === true/.test(src));
    console.log('vscode launcher: all checks passed');
    process.exitCode = 0;
  })().catch((e) => { console.error(e); process.exit(1); });
}

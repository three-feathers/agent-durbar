/** Unit test for how VS Code is located and launched (no Electron, no VS Code needed): `npm run test:vscode`. */
import * as assert from 'assert';
import { planVSCodeLaunch } from '../src/main/vscode';
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
console.log('vscode launcher: all checks passed');

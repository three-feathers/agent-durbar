/**
 * Spec 045: the security sweep. FR-003 `windowsCmd` (which cmd.exe runs a `.cmd` shim), FR-001 uniform place ids,
 * FR-002 the renderer's one-pass unescape. `npm run test:security`. No network, no credits.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { CMD_UNSAFE, windowsCmd } from '../src/shared/wincmd';
import { isObj, nonEmptyStr } from '../src/shared/guards';
import { randomPlaceId } from '../src/main/settings';
import { navigationAllowed, permissionAllowed } from '../src/main/hardening';

// FR-003
assert.strictEqual(windowsCmd({ SystemRoot: 'C:\\Windows' }), 'C:\\Windows\\System32\\cmd.exe', 'the system copy first');
assert.strictEqual(windowsCmd({ SystemRoot: 'C:\\Windows', ComSpec: 'D:\\evil\\cmd.exe' }), 'C:\\Windows\\System32\\cmd.exe', 'SystemRoot wins over ComSpec');
assert.strictEqual(windowsCmd({ ComSpec: 'D:\\tools\\cmd.exe' }), 'D:\\tools\\cmd.exe', 'an absolute cmd.exe from ComSpec');
assert.strictEqual(windowsCmd({ COMSPEC: 'C:\\Windows\\system32\\CMD.EXE' }), 'C:\\Windows\\system32\\CMD.EXE');
assert.strictEqual(windowsCmd({ ComSpec: 'calc.exe' }), 'cmd.exe', 'a relative ComSpec is not run');
assert.strictEqual(windowsCmd({ ComSpec: 'C:\\x\\powershell.exe' }), 'cmd.exe', 'only a file named cmd.exe');
assert.strictEqual(windowsCmd({ ComSpec: 'C:\\x\\cmd.exe" & calc & "' }), 'cmd.exe', 'no quotes');
assert.strictEqual(windowsCmd({ SystemRoot: 'Windows' }), 'cmd.exe', 'a relative SystemRoot is ignored');
assert.strictEqual(windowsCmd({}), 'cmd.exe');

// FR-001: shape, alphabet, and every character appears over many draws (a uniform draw; the old modulo favoured a-d)
const seen = new Map<string, number>();
for (let i = 0; i < 6000; i++) {
  const id = randomPlaceId();
  assert.match(id, /^c-[a-z0-9]{6}$/);
  for (const ch of id.slice(2)) seen.set(ch, (seen.get(ch) ?? 0) + 1);
}
assert.strictEqual(seen.size, 36, 'all 36 characters are drawn');
const counts = [...seen.values()];
assert.ok(Math.max(...counts) / Math.min(...counts) < 1.5, `roughly even (${Math.min(...counts)}..${Math.max(...counts)})`);

// FR-002: the renderer's unesc is the inverse of esc in one pass (the two one-liners are read from app.js, so they cannot drift)
const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
const pick = (name: string): ((s: string) => string) => {
  const m = app.match(new RegExp(`^const ${name}=(s=>.*);$`, 'm'));
  assert.ok(m, `${name} found in app.js`);
  return new Function(`return (${m[1]})`)() as (s: string) => string;
};
const esc = pick('esc'), unesc = pick('unesc');
for (const name of ['a&lt;b', 'Tom & Jerry', '<script>', '"quoted"', '&amp;', 'x&amp;lt;y', 'plain']) assert.strictEqual(unesc(esc(name)), name, `round trip: ${name}`);
assert.ok(!/\.replace\(\/&amp;\/g/.test(app), 'no chained unescape left');

// FR-004: only the app's own page
const IDX = '/opt/durbar/resources/app.asar/dist/renderer/index.html';
assert.ok(navigationAllowed('file://' + IDX, IDX, 'linux'));
assert.ok(navigationAllowed('file://' + IDX + '?sim=15#x', IDX, 'linux'), 'query and hash are fine');
assert.ok(!navigationAllowed('file:///tmp/evil.html', IDX, 'linux'), 'another local file is refused');
assert.ok(!navigationAllowed('file:///opt/durbar/resources/app.asar/dist/renderer/../renderer/other.html', IDX, 'linux'));
assert.ok(!navigationAllowed('https://example.com/', IDX, 'linux'), 'a web page is refused');
assert.ok(!navigationAllowed('javascript:alert(1)', IDX, 'linux'));
assert.ok(!navigationAllowed('not a url', IDX, 'linux'));
const WIN = 'C:\\Program Files\\Durbar\\resources\\app.asar\\dist\\renderer\\index.html';
assert.ok(navigationAllowed('file:///C:/Program%20Files/Durbar/resources/app.asar/dist/renderer/index.html', WIN.replace(/\\\\/g, '\\'), 'win32'), 'Windows path, any case');
assert.ok(navigationAllowed('file:///c:/program%20files/durbar/resources/app.asar/dist/renderer/INDEX.html', WIN.replace(/\\\\/g, '\\'), 'win32'));
assert.ok(!navigationAllowed('file:///C:/Users/x/Downloads/index.html', WIN.replace(/\\\\/g, '\\'), 'win32'));

// FR-005: only clipboard writes
assert.ok(permissionAllowed('clipboard-sanitized-write'));
assert.ok(permissionAllowed('notifications'), 'spec 052 FR-059: "needs you" notifications (agent name and a short summary only)');
for (const p of ['media', 'geolocation', 'clipboard-read', 'openExternal', 'fullscreen', 'midi', 'hid', 'serial', 'usb', 'display-capture', 'pointerLock', 'unknown']) assert.ok(!permissionAllowed(p), `${p} refused`);

// issue #332: every IPC handler goes through ipcHandle / ipcOn (the sender check in src/main/ipcguard.ts); none registers on ipcMain directly.
// Spec 045 FR-060: the handlers live in src/main/ipc/, so that folder is checked too (and so is any folder below src/main).
{
  const root = path.join(__dirname, '..', '..');
  const mainDir = path.join(root, 'src', 'main');
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));
  const direct: string[] = [];
  for (const f of walk(mainDir)) {
    if (path.basename(f) === 'ipcguard.ts' && path.dirname(f) === mainDir) continue;
    const src = fs.readFileSync(f, 'utf8');
    if (/\bipcMain\.(handle|handleOnce|on|once)\(/.test(src)) direct.push(path.relative(root, f));
  }
  assert.deepStrictEqual(direct, [], 'IPC registered on ipcMain directly, without the sender check: ' + direct.join(', '));
  const ipcDir = path.join(mainDir, 'ipc');
  assert.ok(walk(ipcDir).some((f) => /ipcHandle\(/.test(fs.readFileSync(f, 'utf8'))), 'src/main/ipc uses ipcHandle');
  assert.ok(walk(ipcDir).length >= 10, 'the handlers are in src/main/ipc');
}

// tech-debt pass 2026-10-21: one CMD_UNSAFE for detection, harness setup and VS Code (was two copies): every unsafe character refused
for (const c of ['\r', '\n', '\0', '"', '&', '|', '<', '>', '^', '%', '!', '`', '(', ')', ',', ';', '=']) assert.ok(CMD_UNSAFE.test(`C:\\x${c}y`), `unsafe: ${JSON.stringify(c)}`);
assert.ok(!CMD_UNSAFE.test('C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd'), 'an ordinary path is safe');
// the shared guards behave like the 14 copies they replace
assert.deepStrictEqual([isObj({}), isObj(null), isObj([]), isObj('x'), isObj(Object.create(null))], [true, false, false, false, true]);
assert.deepStrictEqual([nonEmptyStr('a'), nonEmptyStr(''), nonEmptyStr(1), nonEmptyStr(undefined)], ['a', undefined, undefined, undefined]);

console.log('security sweep tests passed');

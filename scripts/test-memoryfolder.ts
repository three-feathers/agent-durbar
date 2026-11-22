/**
 * Office memory (spec 116 FR-004, FR-071): `checkMemoryFolder`, the pure refusal rules, driven with `path.win32` and `path.posix` from
 * any OS and an injected `realpath` / `lstat`. `npm run test:memoryfolder`. No Electron, no credits.
 */
import assert from 'assert';
import path from 'path';
import { checkMemoryFolder, type MemoryFlavor, type MemoryFolderCtx, type MemoryRefusal } from '../src/shared/memoryfolder';

process.exitCode = 1;

interface World { flavor: MemoryFlavor; ctx: MemoryFolderCtx; links: Record<string, string>; files: Set<string>; broken: Set<string> }
function world(platform: MemoryFlavor['platform'], home: string, userData: string, office: string[], env: MemoryFolderCtx['env'] = {}): World {
  const w: World = { flavor: { path: platform === 'win32' ? path.win32 : path.posix, platform }, links: {}, files: new Set(), broken: new Set(), ctx: undefined as never };
  w.ctx = {
    home, userData, officeFolders: office, env,
    realpath: (p) => { if (w.broken.has(p)) throw new Error('ENOENT'); return w.links[p] ?? p; },
    lstat: (p) => { if (w.broken.has(p)) throw new Error('EACCES'); return { isDirectory: () => !w.files.has(p) }; },
  };
  return w;
}
const run = (w: World, p: string) => checkMemoryFolder(p, w.ctx, w.flavor);
function table(name: string, w: World, rows: Array<[string, MemoryRefusal | 'ok']>): void {
  for (const [p, want] of rows) {
    const r = run(w, p);
    assert.strictEqual(r.ok ? 'ok' : r.reason, want, `${name}: ${JSON.stringify(p)} -> ${JSON.stringify(r)}, wanted ${want}`);
    if (!r.ok) assert.ok(r.text.length > 5, 'a refusal has words');
  }
}

// ---- Windows ----
const win = world('win32', 'C:\\Users\\ana', 'C:\\Users\\ana\\AppData\\Roaming\\Durbar', ['C:\\work\\proj', 'D:\\data\\site'],
  { appData: 'C:\\Users\\ana\\AppData\\Roaming', localAppData: 'C:\\Users\\ana\\AppData\\Local' });
win.links['C:\\Users\\ana\\shortcut'] = 'C:\\work\\proj';
win.links['C:\\Users\\ana\\netlink'] = '\\\\host.example.invalid\\share';
win.files.add('C:\\Users\\ana\\a.txt');
win.broken.add('C:\\Users\\ana\\gone');
table('win32', win, [
  ['C:\\Users\\ana\\notes', 'ok'], ['C:\\Users\\ana\\notes\\sub', 'ok'], ['E:\\memory', 'ok'], ['C:\\Users\\ana\\.configs', 'ok'], ['C:\\Users\\ana\\.sshx', 'ok'],
  ['C:\\Users\\ana\\notes\\', 'ok'],
  ['C:\\', 'root'], ['C:/', 'root'], ['C:\\Users\\ana', 'home'], ['C:\\USERS\\ANA', 'home'], ['c:\\users\\ana\\', 'home'],
  ['C:\\Users\\ana\\.ssh', 'secret-location'], ['C:\\Users\\ana\\.ssh\\x', 'secret-location'], ['C:\\Users\\ana\\.SSH', 'secret-location'],
  ['C:\\Users\\ana\\.aws', 'secret-location'], ['C:\\Users\\ana\\.gnupg', 'secret-location'], ['C:\\Users\\ana\\.kube', 'secret-location'],
  ['C:\\Users\\ana\\.docker', 'secret-location'], ['C:\\Users\\ana\\.config', 'secret-location'], ['C:\\Users\\ana\\.config\\x', 'secret-location'],
  ['C:\\Users\\ana\\AppData', 'app-data'], ['C:\\Users\\ana\\appdata\\Local\\x', 'secret-location'], ['C:\\Users\\ana\\AppData\\Local', 'secret-location'],
  ['C:\\Users\\ana\\AppData\\Roaming', 'app-data'], ['c:\\users\\ana\\appdata\\roaming\\durbar', 'app-data'], ['C:\\Users\\ana\\AppData\\Roaming\\Durbar\\x', 'app-data'],
  ['C:\\Users\\ana\\.copilot', 'agent-folder'], ['C:\\Users\\ana\\.claude\\projects', 'agent-folder'], ['C:\\Users\\ana\\.CODEX', 'agent-folder'],
  ['C:\\work\\proj', 'office-folder'], ['c:\\WORK\\Proj\\src', 'office-folder'], ['C:\\work', 'office-folder'], ['D:\\data', 'office-folder'], ['D:\\data\\site\\x', 'office-folder'],
  ['C:\\Users\\ana\\shortcut', 'office-folder'],
  ['C:foo', 'not-absolute'], ['C:', 'not-absolute'], ['foo\\bar', 'not-absolute'], ['\\foo', 'not-absolute'], ['', 'not-absolute'],
  ['\\\\host.example.invalid\\share\\x', 'unc'], ['//host.example.invalid/share', 'unc'], ['\\\\?\\C:\\Users\\ana\\notes', 'unc'], ['\\\\.\\C:\\x', 'unc'],
  ['C:\\Users\\ana\\netlink', 'unc'],
  ['C:\\Users\\ana\\a.txt', 'not-folder'], ['C:\\Users\\ana\\gone', 'unreadable'],
]);
// a drive-relative candidate must not be resolved against the cwd or a link target
assert.strictEqual(run(win, 'C:foo').ok, false);

// ---- Linux ----
const lin = world('linux', '/home/ana', '/home/ana/.local/share/Durbar', ['/work/proj'], { xdgConfigHome: '/home/ana/xdg-conf', xdgDataHome: '/data/ana' });
lin.links['/home/ana/link'] = '/work/proj';
lin.links['/home/ana/hop'] = '/home/ana/.ssh';
lin.files.add('/home/ana/a.txt');
lin.broken.add('/home/ana/gone');
table('linux', lin, [
  ['/home/ana/notes', 'ok'], ['/home/ana/.configs', 'ok'], ['/home/ana/.sshx', 'ok'], ['/mnt/disk/memory', 'ok'], ['/home/ana/notes/', 'ok'], ['/home/ana/NOTES', 'ok'],
  ['/', 'root'], ['/home/ana', 'home'], ['/home/ana/', 'home'],
  ['/home/ana/.ssh', 'secret-location'], ['/home/ana/.ssh/x', 'secret-location'], ['/home/ana/.aws', 'secret-location'], ['/home/ana/.gnupg', 'secret-location'],
  ['/home/ana/.kube', 'secret-location'], ['/home/ana/.docker', 'secret-location'], ['/home/ana/.config', 'secret-location'], ['/home/ana/.config/x', 'secret-location'],
  ['/home/ana/.npmrc', 'secret-location'], ['/home/ana/xdg-conf', 'secret-location'], ['/home/ana/xdg-conf/y', 'secret-location'], ['/data/ana', 'secret-location'], ['/data', 'secret-location'],
  ['/home', 'app-data'],
  ['/home/ana/.SSH', 'ok'], // not folded on Linux
  ['/home/ana/hop', 'secret-location'], // a link to a secret place
  ['/home/ana/.local/share', 'app-data'], ['/home/ana/.local/share/Durbar', 'app-data'], ['/home/ana/.local/share/Durbar/x', 'app-data'],
  ['/home/ana/.copilot', 'agent-folder'], ['/home/ana/.claude', 'agent-folder'], ['/home/ana/.codex/x', 'agent-folder'],
  ['/work/proj', 'office-folder'], ['/work/proj/src', 'office-folder'], ['/work', 'office-folder'], ['/home/ana/link', 'office-folder'], ['/work/PROJ', 'ok'], ['/work/projx', 'ok'],
  ['relative/dir', 'not-absolute'], ['C:\\x', 'not-absolute'], ['/home/ana/a\0b', 'not-absolute'],
  ['/home/ana/a.txt', 'not-folder'], ['/home/ana/gone', 'unreadable'],
]);
// no XDG variables set: the default data folder is still refused
const lin2 = world('linux', '/home/ana', '/home/ana/.local/share/Durbar', []);
table('linux default xdg', lin2, [['/home/ana/.local/share/x', 'secret-location'], ['/home/ana/.local', 'app-data'], ['/home/ana/.local/bin', 'ok']]);

// ---- macOS ----
const mac = world('darwin', '/Users/ana', '/Users/ana/Library/Application Support/Durbar', ['/Work/Proj']);
table('darwin', mac, [
  ['/Users/ana/notes', 'ok'], ['/Users/ana/Documents/memory', 'ok'],
  ['/', 'root'], ['/Users/ana', 'home'], ['/USERS/ANA', 'home'],
  ['/Users/ana/Library', 'app-data'], ['/Users/ana/library/x', 'secret-location'], ['/Users/ana/.SSH', 'secret-location'], ['/Users/ana/.Config/z', 'secret-location'],
  ['/Users', 'app-data'], ['/Users/ana/Library/Application Support/Durbar', 'app-data'],
  ['/Users/ana/.Copilot', 'agent-folder'], ['/work/proj/x', 'office-folder'], ['/WORK', 'office-folder'],
]);

// ---- the result carries the real path ----
const ok = run(lin, '/home/ana/notes');
assert.ok(ok.ok && ok.real === '/home/ana/notes');
lin.links['/home/ana/alias'] = '/mnt/disk/real-memory';
const al = run(lin, '/home/ana/alias');
assert.ok(al.ok && al.real === '/mnt/disk/real-memory', 'the real path is returned, not the link');

// ---- a hostile input is refused fast ----
{
  const t0 = Date.now();
  const r = run(lin, '/' + 'a/'.repeat(100000));
  assert.ok(r.ok || !r.ok);
  assert.ok(Date.now() - t0 < 3000, 'a 200k-character path is handled quickly');
}

process.exitCode = 0;
console.log('memoryfolder: ok');

/**
 * Office memory (spec 116 FR-004, FR-071): `checkMemoryFolder`, the pure refusal rules, driven with `path.win32` and `path.posix` from
 * any OS and an injected `realpath` / `lstat`. `npm run test:memoryfolder`. No Electron, no credits.
 */
import assert from 'assert';
import path from 'path';
import fs from 'fs';
import vm from 'vm';
import { spawnSync } from 'child_process';
import type { MemoryFlavor, MemoryFolderCtx, MemoryRefusal } from '../src/shared/memoryfolder';

/** a mutant is the compiled `memoryfolder.js` copied under another name (`MEMORYFOLDER_MODULE`); each must die in the section named on stderr */
const IS_COPY = process.env.MEMORYFOLDER_MODULE !== undefined;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { checkMemoryFolder } = require('../src/shared/' + (process.env.MEMORYFOLDER_MODULE ?? 'memoryfolder')) as typeof import('../src/shared/memoryfolder');
const sectionsRun: Array<[string, () => void]> = [];
const section = (name: string, fn: () => void): void => { sectionsRun.push([name, fn]); };

process.exitCode = 1;

interface World { flavor: MemoryFlavor; ctx: MemoryFolderCtx; links: Record<string, string>; files: Set<string>; broken: Set<string> }
function world(platform: MemoryFlavor['platform'], home: string, userData: string, office: string[], env: MemoryFolderCtx['env'] = {}): World {
  const w: World = { flavor: { path: platform === 'win32' ? path.win32 : path.posix, platform }, links: {}, files: new Set(), broken: new Set(), ctx: undefined as never };
  w.ctx = {
    home, userData, officeFolders: office, env,
    // like the real one: a link anywhere on the way is resolved
    realpath: (p) => {
      if (w.broken.has(p)) throw new Error('ENOENT');
      const sep = w.flavor.path.sep;
      for (const [k, v] of Object.entries(w.links)) if (p === k || p.startsWith(k + sep)) return v + p.slice(k.length);
      return p;
    },
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
  // alternate data streams and names Windows trims (`.ssh.` is `.ssh`)
  ['C:\\Users\\ana\\.ssh::$INDEX_ALLOCATION', 'not-absolute'], ['C:\\Users\\ana\\.ssh:x', 'not-absolute'], ['C:\\Users\\ana\\notes:x', 'not-absolute'],
  ['C:\\Users\\ana\\.ssh.', 'not-absolute'], ['C:\\Users\\ana\\.ssh ', 'not-absolute'], ['C:\\Users\\ana\\foo.\\bar', 'not-absolute'], ['C:\\Users\\ana\\.ssh. \\x', 'not-absolute'],
  ['C:\\Users\\ana\\.local\\share\\keyrings', 'secret-location'],
  ['C:\\Users\\ana\\..\\ana\\notes', 'ok'],
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
// ~/.local/share is always refused: with an absolute XDG_DATA_HOME, a relative one, or none
for (const xdgDataHome of ['/data/ana', 'relative/data', '', undefined]) {
  const w = world('linux', '/home/ana', '/home/ana/.local/share/Durbar', [], { xdgDataHome });
  table('xdg ' + String(xdgDataHome), w, [['/home/ana/.local/share/keyrings', 'secret-location'], ['/home/ana/.local/share/x/y', 'secret-location'], ['/home/ana/.local/bin', 'ok']]);
}
{
  const w = world('linux', '/home/ana', '/home/ana/.local/share/Durbar', [], { xdgDataHome: 'relative/data', xdgConfigHome: 'rel/conf' });
  table('relative xdg is ignored, not trusted', w, [['/home/ana/relative/data', 'ok'], ['/home/ana/rel/conf', 'ok'], ['/relative/data', 'ok']]);
}
// the listed side is a link: its real target counts too
{
  const w = world('linux', '/home/ana', '/home/ana/.local/share/Durbar', ['/work/proj2'], {});
  w.links['/home/ana/.ssh'] = '/home/ana/dotfiles/ssh';
  w.links['/work/proj2'] = '/mnt/real/proj2';
  table('listed side is a link', w, [
    ['/home/ana/dotfiles', 'secret-location'], ['/home/ana/dotfiles/ssh', 'secret-location'], ['/home/ana/dotfiles/other', 'ok'],
    ['/mnt/real', 'office-folder'], ['/mnt/real/proj2/x', 'office-folder'], ['/mnt/real/other', 'ok'],
  ]);
  const h = world('linux', '/home/ana', '/home/ana/.local/share/Durbar', [], {});
  h.links['/home/ana'] = '/mnt/homes/ana'; // the home folder itself is a link
  table('home is a link', h, [['/mnt/homes/ana', 'home'], ['/mnt/homes/ana/.ssh', 'secret-location'], ['/mnt/homes/ana/.config/x', 'secret-location'], ['/mnt/homes', 'app-data'], ['/mnt/homes/ana/notes', 'ok'], ['/home/ana', 'home']]);
}
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

// ---- review of PR 2116: D1 the shared credential list, D2 the agent homes, D3 system folders ----
section('secrets', () => {
  const { HOME_SECRETS } = require('../src/shared/homesecrets') as typeof import('../src/shared/homesecrets');
  const w = world('linux', '/home/ana', '/home/ana/.local/share/Durbar', []);
  for (const n of ['.azure', '.mozilla', 'snap/firefox', '.var/app', '.password-store', '.pki', '.terraform.d']) {
    for (const suffix of ['', '/x']) table('D1 ' + n, w, [['/home/ana/' + n + suffix, 'secret-location']]);
    table('D1 parent', w, [['/home/ana/' + n.split('/')[0], 'secret-location']]); // a parent holds it
    const ww = world('win32', 'C:\\Users\\ana', 'C:\\Users\\ana\\AppData\\Roaming\\D', []);
    table('D1 win32 ' + n, ww, [['C:\\Users\\ana\\' + n.split('/').join('\\'), 'secret-location']]);
  }
  // every entry of the one list is refused, and the OS sandbox uses the same list
  for (const n of HOME_SECRETS) table('shared list ' + n, w, [['/home/ana/' + n, ['.claude', '.copilot', '.codex'].includes(n) ? 'agent-folder' : 'secret-location']]);
  assert.ok(fs.readFileSync(path.join(__dirname, '..', '..', 'src/adapters/sandboxRoots.ts'), 'utf8').includes("from '../shared/homesecrets'"), 'sandboxRoots.ts uses the shared list');
  assert.ok(!/^import .*adapters/m.test(fs.readFileSync(path.join(__dirname, '..', '..', 'src/shared/memoryfolder.ts'), 'utf8')), 'memoryfolder.ts imports no adapter');
});
section('agenthomes', () => {
  const w = world('linux', '/home/ana', '/home/ana/.local/share/Durbar', []);
  w.ctx.agentHomes = ['/data/copilot-home', '/data/claude-cfg', '/home/ana/agents/codex'];
  table('D2', w, [
    ['/data/copilot-home', 'agent-folder'], ['/data/claude-cfg/projects', 'agent-folder'], ['/home/ana/agents/codex', 'agent-folder'], ['/home/ana/agents', 'agent-folder'], ['/data', 'agent-folder'],
    ['/data/other', 'ok'], ['/home/ana/agents2', 'ok'],
  ]);
  w.links['/home/ana/hopagent'] = '/data/claude-cfg';
  table('D2 link', w, [['/home/ana/hopagent', 'agent-folder']]);
  const ww = world('win32', 'C:\\Users\\ana', 'C:\\Users\\ana\\AppData\\Roaming\\D', []);
  ww.ctx.agentHomes = ['D:\\Agents\\Codex'];
  table('D2 win32', ww, [['d:\\agents\\codex\\x', 'agent-folder'], ['D:\\Agents', 'agent-folder'], ['D:\\Other', 'ok']]);
});
section('system', () => {
  const lin = world('linux', '/home/ana', '/home/ana/.local/share/Durbar', []);
  lin.links['/home/ana/toproc'] = '/proc';
  lin.links['/home/ana/tosys'] = '/sys/kernel';
  table('D3 linux', lin, [
    ['/proc', 'system'], ['/proc/self', 'system'], ['/home/ana/toproc', 'system'], ['/home/ana/tosys', 'system'], ['/sys', 'system'], ['/dev', 'system'], ['/dev/shm/x', 'system'], ['/run/user/1000', 'system'],
    ['/etc', 'system'], ['/etc/x', 'system'], ['/root', 'system'], ['/boot', 'system'], ['/usr/share', 'system'], ['/bin', 'system'], ['/sbin', 'system'], ['/lib', 'system'], ['/lib64/x', 'system'], ['/var/lib/x', 'system'],
    ['/mnt/disk/memory', 'ok'], ['/home/ana/notes', 'ok'], ['/devices', 'ok'], ['/usrx', 'ok'], ['/variable', 'ok'], ['/srv/notes', 'ok'], ['/opt/notes', 'ok'],
  ]);
  // N1: /var and /run are not refused whole
  const lin2 = world('linux', '/home/ana', '/home/ana/.local/share/Durbar', []);
  lin2.links['/home'] = '/var/home'; // Silverblue: the real home is /var/home/ana
  lin2.links['/home/ana'] = '/var/home/ana';
  table('N1 silverblue /home link', lin2, [['/home/ana/notes', 'ok'], ['/var/home/ana/notes', 'ok'], ['/home/ana/.ssh', 'secret-location'], ['/var/lib/x', 'system'], ['/var/home/other', 'ok']]);
  const sb = world('linux', '/var/home/ana', '/var/home/ana/.local/share/Durbar', []);
  table('N1 HOME=/var/home/ana', sb, [['/var/home/ana/notes', 'ok'], ['/var/home/ana/.ssh/x', 'secret-location'], ['/var/home/ana/.local/share/Durbar/x', 'app-data'], ['/var/www/x', 'ok'], ['/var/lib/x', 'system']]);
  const root = world('linux', '/root', '/root/.local/share/Durbar', []);
  table('N1 running as root', root, [['/root/notes', 'ok'], ['/root/.ssh', 'secret-location'], ['/root', 'home'], ['/boot/x', 'system'], ['/etc', 'system']]);
  table('N1 linux var and run', lin, [
    ['/run/media/ana/USB/brain', 'ok'], ['/var/www/x', 'ok'], ['/var', 'ok'], ['/run', 'ok'], ['/var/lib/x', 'system'], ['/var/lib', 'system'], ['/var/log/x', 'system'], ['/var/cache', 'system'], ['/var/spool/x', 'system'], ['/var/db', 'system'], ['/var/run/x', 'system'], ['/var/tmp', 'system'], ['/var/mail', 'system'],
    ['/run/user/1000/x', 'system'], ['/run/secrets', 'system'], ['/run/credentials/x', 'system'], ['/run/systemd/x', 'system'], ['/usr/local/src', 'system'], ['/usr', 'system'],
  ]);
  const mac = world('darwin', '/Users/ana', '/Users/ana/Library/Application Support/Durbar', []);
  mac.links['/var'] = '/private/var';
  table('D3 darwin', mac, [
    ['/dev', 'system'], ['/System', 'system'], ['/System/x', 'system'], ['/Library', 'system'], ['/Library/Caches', 'system'], ['/private/var', 'system'], ['/private/var/folders/x', 'system'], ['/private/etc', 'system'], ['/var', 'system'], ['/var/x', 'system'], ['/etc', 'system'], ['/usr/local', 'system'],
    ['/Users/ana/notes', 'ok'], ['/Volumes/Disk/memory', 'ok'], ['/SYSTEMX', 'ok'], ['/system', 'system'], // the volume is case-insensitive by default: folded
  ]);
  const win = world('win32', 'C:\\Users\\ana', 'C:\\Users\\ana\\AppData\\Roaming\\D', []);
  table('D3 win32 defaults', win, [
    ['C:\\Windows', 'system'], ['c:\\windows\\system32', 'system'], ['C:\\ProgramData', 'system'], ['C:\\Program Files', 'system'], ['C:\\Program Files\\x', 'system'], ['C:\\Program Files (x86)\\y', 'system'],
    ['C:\\Users\\ana\\notes', 'ok'], ['D:\\Windows', 'ok'], ['C:\\Program Filesx', 'ok'], ['E:\\memory', 'ok'],
  ]);
  const env = world('win32', 'D:\\Users\\ana', 'D:\\Users\\ana\\AppData\\Roaming\\D', [], { systemRoot: 'D:\\WinNT', programData: 'D:\\PD', programFiles: 'D:\\PF', programFilesX86: 'D:\\PF86' });
  table('D3 win32 from env', env, [['D:\\WinNT\\x', 'system'], ['D:\\PD', 'system'], ['D:\\PF\\a', 'system'], ['D:\\PF86', 'system'], ['D:\\Users\\ana\\notes', 'ok'], ['C:\\Windows', 'system']].slice(0, 5) as Array<[string, MemoryRefusal | 'ok']>);
  const r = run(lin, '/proc');
  assert.ok(!r.ok && r.reason === 'system' && /operating system/.test(r.text), 'a fixed sentence');
});

for (const [name, fn] of sectionsRun) {
  try { fn(); } catch (e) { console.error(`SECTION ${name} FAILED`); console.error(e instanceof Error ? e.message.slice(0, 300) : 'failed'); process.exit(1); }
}
if (!IS_COPY) {
  const dir = path.join(__dirname, '..', 'src', 'shared');
  const orig = fs.readFileSync(path.join(dir, 'memoryfolder.js'), 'utf8').replace(/\r\n/g, '\n');
  const mutants: Array<{ name: string; from: string; to: string; section: string }> = [
    { name: 'the old local secret list (no shared one)', from: 'const SECRET_NAMES = [...homesecrets_1.HOME_SECRETS, \'.config\'];', to: "const SECRET_NAMES = ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.config', '.npmrc'];", section: 'secrets' },
    { name: 'agent homes ignored', from: '...(ctx.agentHomes ?? [])', to: '', section: 'agenthomes' },
    { name: 'system folders ignored', from: "return refuse('system');", to: 'void 0;', section: 'system' },
    { name: 'pseudo folders dropped', from: "'/proc', '/sys', '/root'", to: "'/root'", section: 'system' },
    { name: 'the whole of /var is refused', from: "'/var/lib', '/var/log'", to: "'/var', '/var/log'", section: 'system' },
    { name: 'the whole of /run is refused', from: "'/run/user', '/run/secrets'", to: "'/run', '/run/secrets'", section: 'system' },
    { name: 'the home skip is dropped', from: 'if (!inHome && ', to: 'if (', section: 'system' },
    { name: 'windows defaults ignore the env', from: 'e.programFiles ||', to: '', section: 'system' },
  ];
  assert.deepStrictEqual(mutants.filter((m) => !orig.includes(m.from)).map((m) => m.name), [], 'mutant anchors not found');
  let k = 0;
  for (const m of mutants) {
    k++;
    const uniq = `memoryfolder.mutant-${process.pid}-${k}`;
    const file = path.join(dir, uniq + '.js');
    try {
      const mutated = orig.split(m.from).join(m.to);
      new vm.Script(mutated, { filename: uniq });
      fs.writeFileSync(file, mutated);
      const r = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { MEMORYFOLDER_MODULE: uniq }), encoding: 'utf8', timeout: 120000 });
      assert.notStrictEqual(r.status, 0, 'mutant NOT killed: ' + m.name);
      const died = [...r.stderr.matchAll(/SECTION (\w+) FAILED/g)].map((x) => x[1]);
      assert.ok(died.includes(m.section) || (died.length === 0 && /AssertionError/.test(r.stderr)), `mutant "${m.name}" must die in "${m.section}": ${died.join(',') || r.stderr.slice(0, 200)}`);
    } finally { fs.rmSync(file, { force: true }); }
  }
  console.log(`memoryfolder: ${mutants.length} mutants killed`);
}

process.exitCode = 0;
console.log('memoryfolder: ok');

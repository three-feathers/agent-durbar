/**
 * Spec 009 FR-019..FR-025 (issue #685): the "Open with" menu's main side. `npm run test:openwith`.
 * No Electron, no editor is ever started (a recording spawner stands in; shell.openPath is a fake), no network, no credits.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { checkFolder, fileManagerHint, listTargets, openInFirstEditor, openWith, ownedAgent, realDeps, LINK_NOTE } from '../src/main/openwith';
import type { Deps, OwnedAgent } from '../src/main/openwith';
import type { LaunchEnv, LaunchPlan } from '../src/main/vscode';
import { EDITIONS, EDITOR_NOT_FOUND, planEdition, spawnPlan } from '../src/main/vscode';

const launchEnv = (platform: NodeJS.Platform, files: string[], vars: NodeJS.ProcessEnv = {}, homedir = '/home/a'): LaunchEnv => ({ platform, env: vars, homedir, isFile: (p) => files.includes(p) });
const LINUX_ALL = ['/usr/bin/code', '/usr/bin/code-insiders', '/usr/bin/codium'];
/* the tests on real paths run on this machine's own rules: on Windows a real path is not absolute by POSIX rules */
const WIN_ALL = ['C:\\L\\Programs\\Microsoft VS Code\\Code.exe', 'C:\\L\\Programs\\Microsoft VS Code Insiders\\Code - Insiders.exe', 'C:\\L\\Programs\\VSCodium\\VSCodium.exe'];
const ON_WIN = process.platform === 'win32';
const HOST = (): LaunchEnv => (ON_WIN ? launchEnv('win32', WIN_ALL, { LOCALAPPDATA: 'C:\\L' }, 'C:\\Users\\a') : launchEnv('linux', LINUX_ALL));
const NONE = (): LaunchEnv => (ON_WIN ? launchEnv('win32', [], {}, 'C:\\Users\\a') : launchEnv('linux', []));
interface Rec { started: LaunchPlan[]; opened: string[]; revealed: string[] }
const mk = (le: LaunchEnv, rec: Rec, over: Partial<Deps> = {}): Deps => ({
  platform: le.platform, // the platform under test, so the Windows branches of abs() and planCmd really run
  launchEnv: le,
  lstat: (p) => (p.startsWith(root) ? fs.lstatSync(p) : fakeLstat(p)),
  realpath: (p) => (p.startsWith(root) ? fs.realpathSync(p) : p), // other platforms' made-up paths have no links
  openPath: async (p) => (rec.opened.push(p), ''),
  reveal: (p) => { rec.revealed.push(p); },
  start: async (plan) => (rec.started.push(plan), { ok: true, edition: plan.edition }),
  ...over,
});
/** Other platforms' paths do not exist on this disk: every absolute path but ones ending in gone/ is a folder. */
const fakeLstat = (p: string) => {
  if (/gone$/.test(p)) throw new Error('ENOENT');
  return { isDirectory: () => true, isFile: () => /\.code-workspace$/.test(p), isSymbolicLink: () => false };
};
const rec = (): Rec => ({ started: [], opened: [], revealed: [] });

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-openwith-'))); // real: on macOS the temp folder itself is behind a link
const dir = path.join(root, 'proj');
fs.mkdirSync(dir);
const dashDir = path.join(root, '-rf');
fs.mkdirSync(dashDir);
const file = path.join(root, 'run.sh');
fs.writeFileSync(file, '#!/bin/sh\n');
const appDir = path.join(root, ON_WIN ? 'Thing.{21EC2020-3AEA-1069-A2DD-08002B30309D}' : 'Thing.app'); // a package on the OS that has this kind (FR-026)
fs.mkdirSync(appDir);
const spaced = path.join(root, 'a b & c');
fs.mkdirSync(spaced);
let linkOk = true;
const link = path.join(root, 'link');
try { fs.symlinkSync(dir, link, 'dir'); } catch { linkOk = false; }
const wsFile = path.join(root, 'x.code-workspace');
fs.writeFileSync(wsFile, '{}');

process.exitCode = 1; // a promise that never settles must not pass (checklist); 0 only after the PASS line
(async () => {
  // ---- the path comes from main, by agent id (FR-020) ----
  const agents = new Map<string, OwnedAgent>([['a1', { cwd: dir }], ['a2', { cwd: dir, workspaceFile: wsFile }]]);
  assert.deepStrictEqual(ownedAgent(agents, 'a1'), { cwd: dir, workspaceFile: undefined });
  assert.strictEqual(ownedAgent(agents, dir), undefined, 'a path in place of an id finds nothing');
  assert.strictEqual(ownedAgent(agents, '/etc'), undefined);
  assert.strictEqual(ownedAgent(agents, { cwd: '/etc' }), undefined, 'an object finds nothing');
  assert.strictEqual(ownedAgent(agents, 'nope'), undefined);
  const r0 = rec();
  assert.strictEqual((await openWith(ownedAgent(agents, '/etc'), 'folder', mk(HOST(), r0))).ok, false);
  assert.deepStrictEqual(r0.opened, [], 'nothing opened for an unknown agent');
  // a renderer-supplied path as the target id is no target
  for (const t of ['/etc', dir, '../x', 'code', 'Folder', '__proto__', 'constructor', 'toString', undefined, 5, {}]) {
    const r = rec();
    assert.strictEqual((await openWith(agents.get('a1'), t, mk(HOST(), r))).ok, false, `target ${String(t)} refused`);
    assert.deepStrictEqual([r.started, r.opened], [[], []]);
  }
  // the IPC file passes only the id (and the fixed target id), never a path, and checks fromApp
  const ipc = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'ipc', 'agents.ts'), 'utf8').replace(/\r\n/g, '\n');
  const blk = ipc.slice(ipc.indexOf("ipcHandle('agents:openWithTargets'"));
  assert.match(blk, /ipcHandle\('agents:openWithTargets', \(e, id: unknown\) => \(fromApp\(e\) \? listTargets\(ownedOf\(id\)/);
  assert.match(blk, /ipcHandle\('agents:openWith', \(e, id: unknown, target: unknown\) =>\s*fromApp\(e\) \? openWith\(ownedOf\(id\), target,/);
  assert.match(ipc, /const ownedOf = \(id: unknown\) => ownedAgent\(agents, id\);/);
  assert.ok(!/openWith[^\n]*\bcwd\b/.test(blk.replace(/\{ cwd[^}]*\}/g, '')), 'no handler argument named cwd');

  // ---- folder checks (FR-021) ----
  const d0 = mk(HOST(), rec());
  assert.strictEqual(checkFolder(dir, d0).ok, true);
  assert.strictEqual(checkFolder(dashDir, d0).ok, true, 'an absolute folder named -rf is fine: it never starts with a dash');
  assert.strictEqual(checkFolder(spaced, d0).ok, true);
  for (const bad of ['-rf', '--help', '-x/y', 'rel/dir', '', '\0', dir + '\0x', undefined, 7]) assert.strictEqual(checkFolder(bad, d0).ok, false, `refused: ${JSON.stringify(bad)}`);
  for (const rel of ['-rf', '--help', '-x/y', 'rel/dir']) assert.match((checkFolder(rel, d0) as { error: string }).error, /not absolute/, `${rel}: refused for not being absolute, before any look at the disk`);
  assert.match((checkFolder(path.join(root, 'gone'), d0) as { error: string }).error, /no longer exists/);
  assert.match((checkFolder(file, d0) as { error: string }).error, /not a folder/);
  if (linkOk) {
    assert.deepStrictEqual(checkFolder(link, d0), { ok: true, path: fs.realpathSync(dir), linked: true }, 'a link is followed to its real path (owner decision)');
    const toFile = path.join(root, 'link-to-file'); fs.symlinkSync(file, toFile);
    assert.match((checkFolder(toFile, d0) as { error: string }).error, /not a folder/, 'a link to a file');
    const nowhere = path.join(root, 'link-nowhere'); fs.symlinkSync(path.join(root, 'gone'), nowhere);
    assert.match((checkFolder(nowhere, d0) as { error: string }).error, /no longer exists/, 'a link that leads nowhere');
  }

  // ---- editors: discovery is spec 009's, argv is exactly the folder, no shell (FR-022) ----
  for (const [plat, files, vars] of [
    ['linux', LINUX_ALL, {}],
    ['darwin', ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code', '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code', '/Applications/VSCodium.app/Contents/Resources/app/bin/codium'], {}],
    ['win32', ['C:\\L\\Programs\\Microsoft VS Code\\Code.exe', 'C:\\L\\Programs\\Microsoft VS Code Insiders\\Code - Insiders.exe', 'C:\\L\\Programs\\VSCodium\\VSCodium.exe'], { LOCALAPPDATA: 'C:\\L' }],
  ] as const) {
    const le = launchEnv(plat, [...files], vars, plat === 'win32' ? 'C:\\Users\\a' : '/Users/a');
    const t = listTargets({ cwd: dir }, mk(le, rec()));
    assert.deepStrictEqual(t.map((x) => x.id), ['vscode', 'vscode-insiders', 'vscodium', 'folder'], `${plat}: all installed editions then the folder`);
    for (const id of ['vscode', 'vscode-insiders', 'vscodium']) {
      /* this machine's real folders for its own platform's row; made-up ones (fakeLstat) for the other kind: D:\\x is not absolute by
         POSIX rules, and a POSIX temp folder is no drive or UNC path for the Windows row (spec 009 FR-028) */
      const madeUp = plat === 'win32' ? ['C:\\w\\proj', 'C:\\w\\-rf', 'C:\\w\\a b & c'] : ['/w/proj', '/w/-rf', '/w/with space'];
      for (const folder of (plat === 'win32') === ON_WIN ? [dir, dashDir, spaced] : madeUp) {
        const r = rec();
        const res = await openWith({ cwd: folder }, id, mk(le, r));
        assert.strictEqual(res.ok, true, `${plat} ${id}`);
        assert.strictEqual(r.started.length, 1);
        assert.deepStrictEqual(r.started[0].args, [folder], `${plat} ${id}: argv is exactly the folder, no flag, no extra`);
        assert.ok(!/(^|[\\/])(sh|bash|zsh|cmd(\.exe)?|powershell(\.exe)?)$/i.test(r.started[0].command), `${plat} ${id}: no shell as the command (${r.started[0].command})`);
        assert.strictEqual(res.edition, listTargets({ cwd: dir }, mk(le, rec())).find((x) => x.id === id)?.label);
      }
    }
  }
  // spec 009 FR-028: on Windows an editor gets only a drive or UNC path, also after realpath; Show in folder is not an argv and is unchanged
  {
    const le = launchEnv('win32', [WIN_ALL[0]], { LOCALAPPDATA: 'C:\\L' }, 'C:\\Users\\a');
    for (const real of ['\\x', '/x', '\\\\.\\C:\\x', '\\\\.\\pipe\\x', '\\\\?\\GLOBALROOT\\Device\\x']) {
      const r = rec();
      const res = await openWith({ cwd: 'C:\\x' }, 'vscode', mk(le, r, { realpath: () => real }));
      assert.deepStrictEqual([res.ok, res.error, r.started.length], [false, 'This folder is not on a drive or a network share, so it was not opened.', 0], real);
      const res2 = await openInFirstEditor({ cwd: 'C:\\x' }, mk(le, r, { realpath: () => real }));
      assert.deepStrictEqual([res2.ok, r.started.length], [false, 0], 'Open in editor too: ' + real);
    }
    { const r = rec(); const res = await openWith({ cwd: 'C:\\x', workspaceFile: 'C:\\x\\p.code-workspace' }, 'vscode', mk(le, r, { realpath: () => '\\x\\p.code-workspace' }));
      assert.deepStrictEqual([res.ok, res.error, r.started.length], [false, 'This workspace file is not on a drive or a network share, so it was not opened.', 0], 'a workspace file too'); }
    for (const real of ['C:\\x', '\\\\srv\\share\\x']) { const r = rec(); const res = await openWith({ cwd: 'C:\\x' }, 'vscode', mk(le, r, { realpath: () => real })); assert.deepStrictEqual([res.ok, r.started[0]?.args], [true, [real]], real); }
    { const r = rec(); const res = await openWith({ cwd: 'C:\\x' }, 'folder', mk(le, r, { realpath: () => '\\x' })); assert.deepStrictEqual([res.ok, r.opened], [true, ['\\x']], 'Show in folder unchanged'); }
    { const r = rec(); const res = await openWith({ cwd: '/x/proj' }, 'vscode', mk(launchEnv('linux', LINUX_ALL), r)); assert.deepStrictEqual([res.ok, r.started[0]?.args], [true, ['/x/proj']], 'not on Linux'); }
  }
  // Windows with only code.cmd: a folder cmd.exe could misread is refused honestly; the editor stays listed
  { const cmd = 'C:\\L\\Programs\\Microsoft VS Code\\bin\\code.cmd';
    const le = launchEnv('win32', [cmd], { LOCALAPPDATA: 'C:\\L', ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, 'C:\\Users\\a');
    assert.deepStrictEqual(listTargets({ cwd: 'C:\\proj & calc' }, mk(le, rec())).map((x) => x.id), ['vscode', 'folder'], 'still listed');
    for (const bad of ['C:\\a & b', 'C:\\a%x%', 'C:\\a(1)', 'C:\\a,b', 'C:\\a;b', 'C:\\a=b', 'C:\\a!b']) {
      const r = rec(); const res = await openWith({ cwd: bad }, 'vscode', mk(le, r));
      assert.strictEqual(res.ok, false, bad); assert.match(res.error!, /installed, but it cannot open this folder safely \(its path has /, bad); assert.deepStrictEqual(r.started, []);
    }
    const r = rec(); const ok = await openWith({ cwd: 'C:\\ok\\proj' }, 'vscode', mk(le, r)); assert.strictEqual(ok.ok, true); assert.strictEqual(r.started[0].args[0], '/d');
    // Windows absolute check: a drive path is absolute, a dash name is not
    assert.strictEqual(checkFolder('-rf', mk(le, rec())).ok, false); assert.strictEqual(checkFolder('C:\\x', mk(le, rec())).ok, true); assert.strictEqual(checkFolder('proj\\sub', mk(le, rec())).ok, false, 'a relative Windows path'); }
  // only installed editors are listed; none installed: still the folder item
  assert.deepStrictEqual(listTargets({ cwd: dir }, mk(launchEnv('linux', ['/usr/bin/codium']), rec())).map((x) => x.id), ['vscodium', 'folder']);
  assert.deepStrictEqual(listTargets({ cwd: dir }, mk(NONE(), rec())).map((x) => x.id), ['folder']);
  assert.deepStrictEqual(listTargets(undefined, mk(HOST(), rec())), []);
  // an editor that is not installed is refused, nothing started
  { const r = rec(); const res = await openWith({ cwd: dir }, 'vscode', mk(NONE(), r)); assert.strictEqual(res.ok, false); assert.match(res.error!, /not found/); assert.deepStrictEqual(r.started, []); }
  // a repository cannot supply an editor: a code binary inside the folder (or PATH entry relative to it) is never used
  { const r = rec(); const res = await openWith({ cwd: dir }, 'vscode', mk(launchEnv('linux', [path.join(dir, 'code'), path.join(dir, 'bin', 'code'), 'bin/code', './bin/code', 'node_modules/.bin/code'], { PATH: './bin:node_modules/.bin:bin' }), r)); assert.strictEqual(res.ok, false); assert.deepStrictEqual(r.started, []); }
  if (linkOk) {
    // a link: the real path is the one argument, with the note; never the link's own path
    const real = fs.realpathSync(dir);
    const r1 = rec();
    const ed = await openWith({ cwd: link }, 'vscode', mk(HOST(), r1));
    assert.strictEqual(ed.ok, true);
    assert.strictEqual(ed.note, LINK_NOTE);
    assert.strictEqual(r1.started.length, 1);
    assert.deepStrictEqual(r1.started[0].args.slice(-1), [real], 'the editor gets the real path');
    assert.ok(!LINK_NOTE.includes('/') && !LINK_NOTE.includes('\\'), 'the note holds no path');
    const r2 = rec();
    const fm = await openWith({ cwd: link }, 'folder', mk(HOST(), r2));
    assert.strictEqual(fm.note, LINK_NOTE);
    assert.deepStrictEqual(r2.opened, [real], 'the file manager gets the real path');
    const r3 = rec();
    assert.strictEqual((await openWith({ cwd: dir }, 'folder', mk(HOST(), r3))).note, undefined, 'no note for a plain folder');
    const r5 = rec();
    assert.strictEqual((await openWith({ cwd: dir }, 'vscode', mk(HOST(), r5))).note, undefined, 'nor from an editor');
    const toApp = path.join(root, 'plain-name'); fs.symlinkSync(appDir, toApp, 'dir');
    const r4 = rec();
    { const res = await openWith({ cwd: toApp }, 'folder', mk(ON_WIN ? HOST() : launchEnv('darwin', []), r4)); assert.strictEqual(res.ok, true, 'a link to a package, behind a plain name: shown'); assert.strictEqual(r4.revealed.length, 1, 'revealed'); assert.match(res.note!, /is a link.*selected, not opened/); }
    assert.deepStrictEqual(r4.opened, []);
  }
  // a missing / file folder: nothing is started or opened
  for (const bad of [path.join(root, 'gone'), file, '-rf']) {
    for (const t of ['vscode', 'folder']) {
      const r = rec();
      const res = await openWith({ cwd: bad }, t, mk(HOST(), r));
      assert.strictEqual(res.ok, false, `${t} ${bad}`);
      assert.ok(res.error && res.error.length > 10);
      assert.deepStrictEqual([r.started, r.opened], [[], []], `${t} ${bad}: nothing launched`);
    }
  }
  // a workspace file goes to an editor only, as the one argument; never to the file manager; a folder in its place, or a link to anything but a workspace file, is refused
  { const r = rec(); assert.strictEqual((await openWith(agents.get('a2'), 'vscode', mk(HOST(), r))).ok, true); assert.deepStrictEqual(r.started[0].args, [wsFile]);
    const r2 = rec(); assert.strictEqual((await openWith(agents.get('a2'), 'folder', mk(HOST(), r2))).ok, true); assert.deepStrictEqual(r2.opened, [dir], 'the file manager gets the folder, not the workspace file'); }
  if (linkOk) { const r = rec(), link = path.join(root, 'link.code-workspace'); fs.symlinkSync(wsFile, link); const res = await openWith({ cwd: dir, workspaceFile: link }, 'vscode', mk(HOST(), r)); assert.strictEqual(res.ok, true, 'a linked workspace file opens'); assert.match(res.note!, /workspace file is a link/); assert.deepStrictEqual(r.started[0].args, [fs.realpathSync(wsFile)], 'its real file is the one argument'); }
  if (linkOk) { const r = rec(), link = path.join(root, 'tofile.code-workspace'); fs.symlinkSync(file, link); const res = await openWith({ cwd: dir, workspaceFile: link }, 'vscode', mk(HOST(), r)); assert.strictEqual(res.ok, false, 'a link to something that is no workspace file is refused'); assert.deepStrictEqual(r.started, []); }
  { const r = rec(); const res = await openWith({ cwd: dir, workspaceFile: file }, 'vscode', mk(HOST(), r)); assert.strictEqual(res.ok, false, 'not a .code-workspace'); assert.deepStrictEqual(r.started, []); }
  { const r = rec(); const res = await openWith({ cwd: dir, workspaceFile: path.join(root, 'gone.code-workspace') }, 'vscode', mk(HOST(), r)); assert.strictEqual(res.ok, false); assert.deepStrictEqual(r.started, []); }
  // a failed launch says so
  { const res = await openWith({ cwd: dir }, 'vscode', mk(HOST(), rec(), { start: async () => ({ ok: false, error: 'Could not start VS Code (/usr/bin/code)' }) })); assert.deepStrictEqual([res.ok, res.error], [false, 'Could not start VS Code (/usr/bin/code)']); }

  // ---- the file manager: shell.openPath on a real directory only (FR-023) ----
  { const r = rec(); const res = await openWith({ cwd: dir }, 'folder', mk(NONE(), r)); assert.strictEqual(res.ok, true); assert.deepStrictEqual(r.opened, [dir]); }
  { const r = rec(); const res = await openWith({ cwd: dir }, 'folder', mk(NONE(), r)); assert.deepStrictEqual(r.revealed, [], 'a plain folder is opened'); assert.deepStrictEqual(r.opened, [dir]); assert.strictEqual(res.note, undefined); }
  // FR-026: what the file manager would run is revealed, by what it is, not by a list of names
  {
    const le = (p: NodeJS.Platform): LaunchEnv => launchEnv(p, [], {}, p === 'win32' ? 'C:\\Users\\a' : '/home/a');
    const noContents = (p: string) => { if (/[\\/]Contents$/.test(p)) throw new Error('ENOENT'); return fakeLstat(p); };
    const show = async (platform: NodeJS.Platform, cwd: string, lstat: Deps['lstat'] = noContents): Promise<{ note?: string; r: Rec }> => { const r = rec(); const res = await openWith({ cwd }, 'folder', mk(le(platform), r, { lstat })); assert.strictEqual(res.ok, true, cwd); return { note: res.note, r }; };
    for (const n of ['/w/x.app', '/w/x.APP', '/w/x.pkg', '/w/x.mpkg', '/w/x.scptd', '/w/x.appex', '/w/my.project']) {
      const { note, r } = await show('darwin', n);
      assert.deepStrictEqual([r.opened, r.revealed], [[], [n]], n + ': revealed on macOS, never opened'); assert.match(note!, /selected, not opened/);
    }
    { const { r } = await show('darwin', '/w/plain', fakeLstat); assert.deepStrictEqual([r.opened, r.revealed], [[], ['/w/plain']], 'a bundle with no extension: it has Contents'); }
    { const { r, note } = await show('darwin', '/w/plain'); assert.deepStrictEqual([r.opened, r.revealed, note], [['/w/plain'], [], undefined], 'a plain folder is opened on macOS'); }
    { const { r } = await show('darwin', '/w/.hidden'); assert.deepStrictEqual(r.opened, ['/w/.hidden'], 'a leading dot is no extension'); }
    for (const n of ['C:\\w\\x.{21EC2020-3AEA-1069-A2DD-08002B30309D}', 'C:\\w\\x.{21ec2020-3aea-1069-a2dd-08002b30309d}. ']) { const { r } = await show('win32', n); assert.deepStrictEqual([r.opened, r.revealed], [[], [n]], n + ': revealed on Windows'); }
    { const { r } = await show('win32', 'C:\\w\\x.app'); assert.deepStrictEqual(r.opened, ['C:\\w\\x.app'], 'Windows runs no .app folder'); }
    { const { r } = await show('linux', '/w/x.app'); assert.deepStrictEqual(r.opened, ['/w/x.app'], 'Linux has no packages'); }
  }
  // FR-022's guard on the route the PATH finds: a .cmd alone on PATH, no .exe beside it
  {
    const cmd = 'C:\\tools\\bin\\codium.cmd', ed = EDITIONS.find((e) => e.name === 'VSCodium')!;
    const onPath = (dir: string, file: string): LaunchEnv => launchEnv('win32', [file], { PATH: dir }, 'C:\\Users\\a');
    const le = onPath('C:\\tools\\bin', cmd);
    assert.deepStrictEqual(planEdition(ed, 'C:\\work\\proj', le)?.args.slice(-1), [`"${cmd}" "C:\\work\\proj"`], 'a safe folder goes through the .cmd');
    for (const t of ['C:\\a & calc', 'C:\\%PATH%', 'C:\\a"b', 'C:\\a^b']) {
      assert.strictEqual(planEdition(ed, t, le), undefined, t + ' plans nothing');
      const r = rec(); const res = await openWith({ cwd: t }, 'vscodium', mk(le, r));
      assert.strictEqual(res.ok, false, t); assert.deepStrictEqual(r.started, [], t + ' starts nothing'); assert.match(res.error!, /cannot open this folder safely/);
    }
    assert.strictEqual(planEdition(ed, 'C:\\work\\proj', onPath('C:\\a&b\\bin', 'C:\\a&b\\bin\\codium.cmd')), undefined, 'a PATH folder with & plans nothing');
  }
  // FR-027: the old route is the menu's route: the first edition that can open the folder, through the same checks
  {
    { const r = rec(); const res = await openInFirstEditor({ cwd: dir }, mk(HOST(), r)); assert.strictEqual(res.edition, 'VS Code'); assert.deepStrictEqual(r.started[0].args, [dir]); }
    { const r = rec(); const le = ON_WIN ? launchEnv('win32', [WIN_ALL[2]], { LOCALAPPDATA: 'C:\\L' }, 'C:\\Users\\a') : launchEnv('linux', ['/usr/bin/codium']); assert.strictEqual((await openInFirstEditor({ cwd: dir }, mk(le, r))).edition, 'VSCodium', 'the next edition when the first is missing'); }
    { const r = rec(); assert.deepStrictEqual(await openInFirstEditor({ cwd: file }, mk(HOST(), r)), { ok: false, error: 'This is not a folder, so it was not opened.' }); assert.deepStrictEqual(r.started, [], 'a file is refused'); }
    { const r = rec(); assert.deepStrictEqual(await openInFirstEditor({ cwd: dir }, mk(NONE(), r)), { ok: false, error: EDITOR_NOT_FOUND }); }
    { assert.deepStrictEqual(await openInFirstEditor(undefined, mk(HOST(), rec())), { ok: false, error: 'unknown agent' }); }
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'ipc', 'agents.ts'), 'utf8');
    assert.match(src, /'agents:openInVSCode', \(e, id: unknown\) => \(fromApp\(e\) \? openInFirstEditor\(ownedOf\(id\), owDeps\(\)\)/, 'the channel takes the guarded path');
  }
  { const res = await openWith({ cwd: dir }, 'folder', mk(NONE(), rec(), { openPath: async () => 'Failed to open path' })); assert.deepStrictEqual([res.ok, res.error], [false, 'Failed to open path']); }
  { const res = await openWith({ cwd: dir }, 'folder', mk(NONE(), rec(), { openPath: async () => { throw new Error('boom'); } })); assert.deepStrictEqual([res.ok, res.error], [false, 'boom']); }

  // ---- review of #976 (2026-11-03): guards each with a test that fails when the guard goes ----
  // the NUL guard answers itself (without it the real lstat throws and the answer is "no longer exists"; a made-up path would pass)
  assert.strictEqual((checkFolder(dir + '\0x', d0) as { error: string }).error, 'This agent has no usable folder.', 'NUL: refused by its own guard');
  assert.strictEqual((checkFolder('/w/a\0b', mk(launchEnv('linux', LINUX_ALL), rec())) as { error: string }).error, 'This agent has no usable folder.', 'NUL in a made-up path');
  // the path handed on is realpath's answer, also when the folder itself is no link (a link higher up), and without the link note
  {
    const viaParent = (le: LaunchEnv) => mk(le, rec(), { realpath: (p) => (p === '/w/via-parent' ? '/w/real-proj' : p) });
    const r1 = rec(); const d1 = { ...viaParent(launchEnv('linux', LINUX_ALL)), openPath: async (p: string) => (r1.opened.push(p), '') };
    const fm = await openWith({ cwd: '/w/via-parent' }, 'folder', d1);
    assert.deepStrictEqual([fm.ok, fm.note, r1.opened], [true, undefined, ['/w/real-proj']], 'the file manager gets the resolved path');
    const r2 = rec(); const d2 = { ...viaParent(launchEnv('linux', LINUX_ALL)), start: async (plan: LaunchPlan) => (r2.started.push(plan), { ok: true }) };
    await openWith({ cwd: '/w/via-parent' }, 'vscode', d2);
    assert.deepStrictEqual(r2.started[0].args, ['/w/real-proj'], 'the editor gets the resolved path');
    // something put at the real path after realpath is checked as it is: a link there is no directory and is refused
    const swapped = mk(launchEnv('linux', LINUX_ALL), rec(), { lstat: (p) => (p === '/w/swapped' ? { isDirectory: () => false, isFile: () => false, isSymbolicLink: () => true } : fakeLstat(p)), realpath: (p) => (p === '/w/x' ? '/w/swapped' : p) });
    assert.strictEqual((checkFolder('/w/x', swapped) as { error: string }).error, 'This is not a folder, so it was not opened.');
  }
  // the workspace file's own guards: NUL, not absolute, flag-like, not a .code-workspace, a folder of that name
  {
    const le = launchEnv('linux', LINUX_ALL);
    for (const w of ['/w/a\0b.code-workspace', 'rel.code-workspace', '--foo.code-workspace', '-x/y.code-workspace', '', '/w/x.json', 7]) {
      const r = rec(); const res = await openWith({ cwd: '/w/proj', workspaceFile: w as string }, 'vscode', mk(le, r));
      assert.deepStrictEqual([res.ok, res.error, r.started], [false, 'This workspace file is not usable.', []], `workspace ${JSON.stringify(w)}: refused by its guard, nothing started`);
      const r2 = rec(); assert.strictEqual((await openInFirstEditor({ cwd: '/w/proj', workspaceFile: w as string }, mk(le, r2))).ok, false); assert.deepStrictEqual(r2.started, []);
    }
    const wsDir = path.join(root, 'dir.code-workspace'); fs.mkdirSync(wsDir);
    const r = rec(); const res = await openWith({ cwd: dir, workspaceFile: wsDir }, 'vscode', mk(HOST(), r));
    assert.deepStrictEqual([res.error, r.started], ['This workspace file is not a regular file, so it was not opened.', []], 'a folder named like a workspace file');
    // the hint says what an editor opens
    assert.deepStrictEqual(listTargets({ cwd: dir, workspaceFile: wsFile }, mk(HOST(), rec())).map((x) => x.hint).slice(0, 1), ['Opens this workspace in VS Code']);
    assert.deepStrictEqual(listTargets({ cwd: dir }, mk(HOST(), rec())).map((x) => x.hint).slice(0, 1), ['Opens this folder in VS Code']);
  }
  // FR-019: Show in folder names the OS's file manager
  assert.deepStrictEqual(['darwin', 'win32', 'linux', 'freebsd'].map((p) => fileManagerHint(p as NodeJS.Platform)), ['Finder', 'File Explorer', 'File manager', 'File manager']);
  for (const [p, want] of [['darwin', 'Opens it in Finder'], ['win32', 'Opens it in File Explorer'], ['linux', 'Opens it in File manager']] as const) {
    assert.strictEqual(listTargets({ cwd: p === 'win32' ? 'C:\\w' : '/w' }, mk(launchEnv(p, []), rec())).find((x) => x.id === 'folder')?.hint, want, p);
  }
  // FR-022: the .cmd refusal names the characters in the path, every one CMD_UNSAFE refuses, and the right thing
  {
    const cmd = 'C:\\L\\Programs\\Microsoft VS Code\\bin\\code.cmd';
    const le = launchEnv('win32', [cmd], { LOCALAPPDATA: 'C:\\L', ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, 'C:\\Users\\a');
    const err = async (a: OwnedAgent) => (await openWith(a, 'vscode', mk(le, rec()))).error!;
    assert.strictEqual(await err({ cwd: 'C:\\a & b' }), 'VS Code is installed, but it cannot open this folder safely (its path has &, which cmd.exe could misread). Rename the folder, or open it from VS Code itself.');
    for (const c of ['"', '&', '|', '<', '>', '^', '%', '!', '`', '(', ')', ',', ';', '=']) assert.match(await err({ cwd: 'C:\\a' + c + 'b' }), new RegExp('its path has \\' + c + ', which'), `the text names ${c}`);
    assert.match(await err({ cwd: 'C:\\a\nb\rc' }), /its path has a line break, which/);
    assert.match(await err({ cwd: 'C:\\a(1)%' }), /its path has \( \) %, which/, 'each character once, in order');
    assert.match(await err({ cwd: 'C:\\ok', workspaceFile: 'C:\\w & x\\p.code-workspace' }), /cannot open this workspace file safely \(its path has &.*Rename the workspace file or its folder/, 'a workspace file is named as one');
    // FR-027: Open in editor falls through to the next edition that can open it, as planVSCodeLaunch did
    const le2 = launchEnv('win32', [cmd, WIN_ALL[2]], { LOCALAPPDATA: 'C:\\L', ComSpec: 'C:\\Windows\\System32\\cmd.exe' }, 'C:\\Users\\a');
    { const r = rec(); const res = await openInFirstEditor({ cwd: 'C:\\a & b' }, mk(le2, r)); assert.deepStrictEqual([res.ok, res.edition, r.started.map((p) => p.args)], [true, 'VSCodium', [['C:\\a & b']]], 'VS Code as a .cmd only cannot: VSCodium.exe opens it'); }
    { const r = rec(); const res = await openInFirstEditor({ cwd: 'C:\\ok' }, mk(le2, r)); assert.deepStrictEqual([res.edition, r.started[0].args[0]], ['VS Code', '/d'], 'a safe folder still goes to the first edition'); }
    { const r = rec(); const res = await openInFirstEditor({ cwd: 'C:\\a & b' }, mk(le, r)); assert.deepStrictEqual([res.ok, r.started], [false, []]); assert.match(res.error!, /^VS Code is installed, but it cannot open this folder safely \(its path has &/, 'none can: the refusal, not "not found"'); }
  }
  // the real Deps: Electron's two calls in their places, an lstat that does not follow links, and the IPC channels wired to them
  {
    const op: string[] = [], rv: string[] = [];
    const rd = realDeps(async (p) => (op.push(p), ''), (p) => { rv.push(p); });
    await rd.openPath('x'); rd.reveal('y');
    assert.deepStrictEqual([op, rv, rd.platform], [['x'], ['y'], process.platform], 'realDeps keeps openPath and reveal apart');
    if (linkOk) { assert.strictEqual(rd.lstat(link).isSymbolicLink(), true, 'realDeps.lstat does not follow a link'); assert.strictEqual(rd.realpath(link), fs.realpathSync(dir)); }
    const electronPath = require.resolve('electron');
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
    const shellCalls: string[] = [];
    const fake = {
      ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => undefined },
      app: { getVersion: () => '0.0.0', getPath: () => os.tmpdir() },
      dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      shell: { openPath: async (p: string) => (shellCalls.push('open ' + p), ''), showItemInFolder: (p: string) => { shellCalls.push('show ' + p); }, openExternal: async () => assert.fail('no browser') },
      safeStorage: { isEncryptionAvailable: () => false },
    };
    const saved = require.cache[electronPath];
    require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
    const plat = Object.getOwnPropertyDescriptor(process, 'platform')!;
    try {
      /* eslint-disable @typescript-eslint/no-require-imports */
      (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
      const agentsIpc = require('../src/main/ipc/agents') as typeof import('../src/main/ipc/agents');
      /* eslint-enable @typescript-eslint/no-require-imports */
      const agents = new Map([['p', { id: 'p', cwd: dir, name: 'p', permMode: 'ask' }], ['app', { id: 'app', cwd: appDir, name: 'a', permMode: 'ask' }], ['l', { id: 'l', cwd: linkOk ? link : dir, name: 'l', permMode: 'ask' }]]) as never;
      agentsIpc.register({
        agents, router: { onEvent: () => () => undefined, forAgent: () => undefined, instance: () => undefined } as never, agentState: {} as never, opsDeps: {} as never,
        remoteOps: { release: async () => undefined, has: () => false } as never, autopilot: { setAutopilot: async () => ({ ok: false }), forget: () => undefined, stopSeen: () => undefined } as never, getScheduler: () => undefined, getCheckpointStore: () => undefined, vsChatRefs: new Map(), continued: new Map(), wsKey: () => dir, asEffort: () => undefined,
        addMany: async () => ({ ok: true, agents: [] }) as never, addWorkspace: (async () => undefined) as never, ensureLive: async () => undefined, readyAdapterIds: async () => new Set<string>(), forgetOpenSession: () => undefined,
        maskHistory: (_id, h) => h, mcpSecrets: () => [], logMcp: () => undefined, sendOp: async () => ({ ok: true }) as never,
      });
      const frame = { url: pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href }; // ipcguard's APP_INDEX, as test-mcp-signinwiring builds it
      const win = { senderFrame: frame, sender: { mainFrame: frame } };
      const other = { senderFrame: { url: 'https://example.com/' }, sender: { mainFrame: {} } };
      const call = async (e: unknown, ch: string, ...a: unknown[]) => (await handlers.get(ch)!(e, ...a)) as { ok: boolean; note?: string; error?: string };
      assert.deepStrictEqual(await call(win, 'agents:openWith', 'p', 'folder'), { ok: true }); assert.deepStrictEqual(shellCalls, ['open ' + dir], 'a plain folder: shell.openPath');
      if (linkOk) { shellCalls.length = 0; assert.strictEqual((await call(win, 'agents:openWith', 'l', 'folder')).note, LINK_NOTE, 'the IPC route sees the link (lstat, not stat)'); assert.deepStrictEqual(shellCalls, ['open ' + fs.realpathSync(dir)]); }
      // a package is shown, never opened: on this OS's own kind (Windows), or as macOS sees Thing.app
      if (!ON_WIN && process.platform !== 'darwin') Object.defineProperty(process, 'platform', { ...plat, value: 'darwin' });
      shellCalls.length = 0;
      const pk = await call(win, 'agents:openWith', 'app', 'folder');
      Object.defineProperty(process, 'platform', plat);
      assert.deepStrictEqual([pk.ok, shellCalls], [true, ['show ' + appDir]], 'a package through the IPC route: shell.showItemInFolder, not openPath');
      shellCalls.length = 0;
      await assert.rejects(call(other, 'agents:openWith', 'p', 'folder'), /did not come from its own window/); assert.deepStrictEqual(shellCalls, [], 'another frame opens nothing');
      assert.deepStrictEqual(((await call(win, 'agents:openWithTargets', 'p')) as unknown as { id: string }[]).slice(-1).map((x) => x.id), ['folder']);
      assert.deepStrictEqual(await call(win, 'agents:openWith', '/etc', 'folder'), { ok: false, error: 'unknown agent' });
    } finally {
      Object.defineProperty(process, 'platform', plat);
      if (saved) require.cache[electronPath] = saved; else delete require.cache[electronPath];
    }
  }

  // ---- spawnPlan: no shell, detached; the spawner here is a fake (FR-022) ----
  { let seen: { cmd: string; args: readonly string[]; opts: Record<string, unknown> } | undefined;
    const fake = ((cmd: string, args: readonly string[], opts: Record<string, unknown>) => {
      seen = { cmd, args, opts };
      const h: Record<string, (x?: unknown) => void> = {};
      setImmediate(() => h.spawn?.());
      return { once: (e: string, f: (x?: unknown) => void) => { h[e] = f; }, unref: () => undefined };
    }) as never;
    const res = await spawnPlan({ command: '/usr/bin/code', args: [dir], via: 'x', edition: 'VS Code' }, fake, 'linux');
    assert.strictEqual(res.ok, true); assert.strictEqual(seen!.opts.shell, false); assert.strictEqual(seen!.opts.detached, true); assert.deepStrictEqual(seen!.args, [dir]);
    const bad = ((): never => { const h: Record<string, (x?: unknown) => void> = {}; setImmediate(() => h.error?.(Object.assign(new Error('x'), { code: 'ENOENT' }))); return { once: (e: string, f: (x?: unknown) => void) => { h[e] = f; }, unref: () => undefined } as never; }) as never;
    const res2 = await spawnPlan({ command: '/nope', args: [dir], via: '/nope', edition: 'VSCodium' }, bad, 'linux');
    assert.deepStrictEqual([res2.ok, res2.error], [false, 'Could not start VSCodium (/nope)']); }

  fs.rmSync(root, { recursive: true, force: true });
  console.log('test:openwith PASS');
  process.exitCode = 0;
})().catch((e) => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ } console.error(e); process.exit(1); });

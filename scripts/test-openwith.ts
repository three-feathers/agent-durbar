/**
 * Spec 009 FR-019..FR-025 (issue #685): the "Open with" menu's main side. `npm run test:openwith`.
 * No Electron, no editor is ever started (a recording spawner stands in; shell.openPath is a fake), no network, no credits.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkFolder, listTargets, openWith, ownedAgent } from '../src/main/openwith';
import type { Deps, OwnedAgent } from '../src/main/openwith';
import type { LaunchEnv, LaunchPlan } from '../src/main/vscode';
import { spawnPlan } from '../src/main/vscode';

const launchEnv = (platform: NodeJS.Platform, files: string[], vars: NodeJS.ProcessEnv = {}, homedir = '/home/a'): LaunchEnv => ({ platform, env: vars, homedir, isFile: (p) => files.includes(p) });
const LINUX_ALL = ['/usr/bin/code', '/usr/bin/code-insiders', '/usr/bin/codium'];
interface Rec { started: LaunchPlan[]; opened: string[] }
const mk = (le: LaunchEnv, rec: Rec, over: Partial<Deps> = {}): Deps => ({
  platform: process.platform,
  launchEnv: le,
  lstat: (p) => fs.lstatSync(p),
  openPath: async (p) => (rec.opened.push(p), ''),
  start: async (plan) => (rec.started.push(plan), { ok: true, edition: plan.edition }),
  ...over,
});
const rec = (): Rec => ({ started: [], opened: [] });

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-openwith-'));
const dir = path.join(root, 'proj');
fs.mkdirSync(dir);
const dashDir = path.join(root, '-rf');
fs.mkdirSync(dashDir);
const file = path.join(root, 'run.sh');
fs.writeFileSync(file, '#!/bin/sh\n');
const appDir = path.join(root, 'Thing.app');
fs.mkdirSync(appDir);
const spaced = path.join(root, 'a b & c');
fs.mkdirSync(spaced);
let linkOk = true;
const link = path.join(root, 'link');
try { fs.symlinkSync(dir, link, 'dir'); } catch { linkOk = false; }
const wsFile = path.join(root, 'x.code-workspace');
fs.writeFileSync(wsFile, '{}');

(async () => {
  // ---- the path comes from main, by agent id (FR-020) ----
  const agents = new Map<string, OwnedAgent>([['a1', { cwd: dir }], ['a2', { cwd: dir, workspaceFile: wsFile }]]);
  assert.deepStrictEqual(ownedAgent(agents, 'a1'), { cwd: dir, workspaceFile: undefined });
  assert.strictEqual(ownedAgent(agents, dir), undefined, 'a path in place of an id finds nothing');
  assert.strictEqual(ownedAgent(agents, '/etc'), undefined);
  assert.strictEqual(ownedAgent(agents, { cwd: '/etc' }), undefined, 'an object finds nothing');
  assert.strictEqual(ownedAgent(agents, 'nope'), undefined);
  const r0 = rec();
  assert.strictEqual((await openWith(ownedAgent(agents, '/etc'), 'folder', mk(launchEnv('linux', LINUX_ALL), r0))).ok, false);
  assert.deepStrictEqual(r0.opened, [], 'nothing opened for an unknown agent');
  // a renderer-supplied path as the target id is no target
  for (const t of ['/etc', dir, '../x', 'code', 'Folder', '__proto__', 'constructor', 'toString', undefined, 5, {}]) {
    const r = rec();
    assert.strictEqual((await openWith(agents.get('a1'), t, mk(launchEnv('linux', LINUX_ALL), r))).ok, false, `target ${String(t)} refused`);
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
  const d0 = mk(launchEnv('linux', LINUX_ALL), rec());
  assert.strictEqual(checkFolder(dir, d0).ok, true);
  assert.strictEqual(checkFolder(dashDir, d0).ok, true, 'an absolute folder named -rf is fine: it never starts with a dash');
  assert.strictEqual(checkFolder(spaced, d0).ok, true);
  for (const bad of ['-rf', '--help', '-x/y', 'rel/dir', '', '\0', dir + '\0x', undefined, 7]) assert.strictEqual(checkFolder(bad, d0).ok, false, `refused: ${JSON.stringify(bad)}`);
  for (const rel of ['-rf', '--help', '-x/y', 'rel/dir']) assert.match((checkFolder(rel, d0) as { error: string }).error, /not absolute/, `${rel}: refused for not being absolute, before any look at the disk`);
  assert.match((checkFolder(path.join(root, 'gone'), d0) as { error: string }).error, /no longer exists/);
  assert.match((checkFolder(file, d0) as { error: string }).error, /not a folder/);
  if (linkOk) assert.match((checkFolder(link, d0) as { error: string }).error, /link/);

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
      for (const folder of [dir, dashDir, spaced]) {
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
  // only installed editors are listed; none installed: still the folder item
  assert.deepStrictEqual(listTargets({ cwd: dir }, mk(launchEnv('linux', ['/usr/bin/codium']), rec())).map((x) => x.id), ['vscodium', 'folder']);
  assert.deepStrictEqual(listTargets({ cwd: dir }, mk(launchEnv('linux', []), rec())).map((x) => x.id), ['folder']);
  assert.deepStrictEqual(listTargets(undefined, mk(launchEnv('linux', LINUX_ALL), rec())), []);
  // an editor that is not installed is refused, nothing started
  { const r = rec(); const res = await openWith({ cwd: dir }, 'vscode', mk(launchEnv('linux', []), r)); assert.strictEqual(res.ok, false); assert.match(res.error!, /not found/); assert.deepStrictEqual(r.started, []); }
  // a repository cannot supply an editor: a code binary inside the folder (or PATH entry relative to it) is never used
  { const r = rec(); const res = await openWith({ cwd: dir }, 'vscode', mk(launchEnv('linux', [path.join(dir, 'code'), path.join(dir, 'bin', 'code'), 'bin/code', './bin/code', 'node_modules/.bin/code'], { PATH: './bin:node_modules/.bin:bin' }), r)); assert.strictEqual(res.ok, false); assert.deepStrictEqual(r.started, []); }
  // a missing / link / file folder: nothing is started or opened
  for (const bad of [path.join(root, 'gone'), file, ...(linkOk ? [link] : []), '-rf']) {
    for (const t of ['vscode', 'folder']) {
      const r = rec();
      const res = await openWith({ cwd: bad }, t, mk(launchEnv('linux', LINUX_ALL), r));
      assert.strictEqual(res.ok, false, `${t} ${bad}`);
      assert.ok(res.error && res.error.length > 10);
      assert.deepStrictEqual([r.started, r.opened], [[], []], `${t} ${bad}: nothing launched`);
    }
  }
  // a workspace file goes to an editor only, as the one argument; never to the file manager; a link or folder in its place is refused
  { const r = rec(); assert.strictEqual((await openWith(agents.get('a2'), 'vscode', mk(launchEnv('linux', LINUX_ALL), r))).ok, true); assert.deepStrictEqual(r.started[0].args, [wsFile]);
    const r2 = rec(); assert.strictEqual((await openWith(agents.get('a2'), 'folder', mk(launchEnv('linux', LINUX_ALL), r2))).ok, true); assert.deepStrictEqual(r2.opened, [dir], 'the file manager gets the folder, not the workspace file'); }
  { const r = rec(); const res = await openWith({ cwd: dir, workspaceFile: file }, 'vscode', mk(launchEnv('linux', LINUX_ALL), r)); assert.strictEqual(res.ok, false, 'not a .code-workspace'); assert.deepStrictEqual(r.started, []); }
  { const r = rec(); const res = await openWith({ cwd: dir, workspaceFile: path.join(root, 'gone.code-workspace') }, 'vscode', mk(launchEnv('linux', LINUX_ALL), r)); assert.strictEqual(res.ok, false); assert.deepStrictEqual(r.started, []); }
  // a failed launch says so
  { const res = await openWith({ cwd: dir }, 'vscode', mk(launchEnv('linux', LINUX_ALL), rec(), { start: async () => ({ ok: false, error: 'Could not start VS Code (/usr/bin/code)' }) })); assert.deepStrictEqual([res.ok, res.error], [false, 'Could not start VS Code (/usr/bin/code)']); }

  // ---- the file manager: shell.openPath on a real directory only (FR-023) ----
  { const r = rec(); const res = await openWith({ cwd: dir }, 'folder', mk(launchEnv('linux', []), r)); assert.strictEqual(res.ok, true); assert.deepStrictEqual(r.opened, [dir]); }
  { const r = rec(); const res = await openWith({ cwd: appDir }, 'folder', mk(launchEnv('linux', []), r)); assert.strictEqual(res.ok, false, 'an .app folder could run'); assert.match(res.error!, /application or package/); assert.deepStrictEqual(r.opened, []); }
  for (const n of ['x.APP', 'x.bundle', 'x.workflow', 'x.command', 'x.kext']) {
    const p = path.join(root, n); fs.mkdirSync(p);
    const r = rec(); assert.strictEqual((await openWith({ cwd: p }, 'folder', mk(launchEnv('linux', []), r))).ok, false, n); assert.deepStrictEqual(r.opened, []);
  }
  { const res = await openWith({ cwd: dir }, 'folder', mk(launchEnv('linux', []), rec(), { openPath: async () => 'Failed to open path' })); assert.deepStrictEqual([res.ok, res.error], [false, 'Failed to open path']); }
  { const res = await openWith({ cwd: dir }, 'folder', mk(launchEnv('linux', []), rec(), { openPath: async () => { throw new Error('boom'); } })); assert.deepStrictEqual([res.ok, res.error], [false, 'boom']); }

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
})().catch((e) => { try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ } console.error(e); process.exit(1); });

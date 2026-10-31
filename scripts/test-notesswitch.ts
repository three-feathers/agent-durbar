/**
 * Spec 083 T042 (FR-050, FR-051, FR-055, issue 699): the project-file switch in main: the `notesFile` flag in folders.json, `NotesFile`'s
 * `remove` / `inRepo` / `folderThere`, `NotesOps.fileCount` / `setFile` and the two IPC channels on a stand-in `electron`.
 * `npm run test:notesswitch`. Real temp folders under the real OS temp path and a counting fake `fs`; one ticking clock (never the wall
 * clock); no git process, no Electron, no credits.
 */
import * as assert from 'assert';
import * as nodeFs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { pathToFileURL } from 'url';
import type { AgentInfo } from '../src/shared/api';
import { COUNT_UNREADABLE, NOTES_GONE, NOTES_REPLACED, NotesFile, REMOVE_CHANGED, REMOVE_NONE, syncNotesFile, type NotesFileFs } from '../src/main/notesfile';
import { NotesStore } from '../src/main/notesstore';
import { EXCLUDE_KEPT, NATIVE_CANCELLED, NotesOps, SWITCH_ALREADY_OFF, SWITCH_MISSING, SWITCH_WORKSPACE, VALUES_PENDING, VALUES_PENDING_ON } from '../src/main/notesops';
import { spawn } from 'child_process';
import { FolderStore, parseSavedFolders } from '../src/main/folders';
import { SIM_OPEN_CHANNELS } from '../src/main/simguard';

process.exitCode = 1; // set to 0 only after the last line: a promise that never settles fails the suite
const posix = process.platform !== 'win32';
const realOf = (p: string): string => (nodeFs.realpathSync.native ?? nodeFs.realpathSync)(p);
const root = realOf(nodeFs.mkdtempSync(path.join(os.tmpdir(), 'durbar-notesswitch-')));
let seq = 0;
const fresh = (name = 'proj'): string => { const d = path.join(root, `c${++seq}`, name); nodeFs.mkdirSync(d, { recursive: true }); return d; };
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const md = (folder: string): string => path.join(folder, '.durbar', 'notes.md');
const ROOT = ((): string => { let d = __dirname; while (!nodeFs.existsSync(path.join(d, 'package.json'))) d = path.dirname(d); return d; })();
let tick = Date.parse('2026-10-31T12:00:00.000Z');
const tickClock = (): Date => new Date(tick += 1000);
const canLink = ((): boolean => { try { const t = path.join(root, 'probe'); nodeFs.symlinkSync(root, t, 'dir'); nodeFs.unlinkSync(t); return true; } catch { return false; } })();
const canHardLink = ((): boolean => { try { const a = path.join(root, 'h1'), b = path.join(root, 'h2'); nodeFs.writeFileSync(a, 'x'); nodeFs.linkSync(a, b); nodeFs.unlinkSync(b); nodeFs.unlinkSync(a); return true; } catch { return false; } })();
/** A `.git` above the temp root would make every folder "in a repository": the negative cases then say so and are skipped. */
const repoAbove = ((): boolean => { for (let d = root; ; d = path.dirname(d)) { if (nodeFs.existsSync(path.join(d, '.git'))) return true; if (path.dirname(d) === d) return false; } })();
const skip = (why: string): void => console.log(`  (skipped: ${why})`);

const METHODS = ['realpathSync', 'lstatSync', 'statSync', 'openSync', 'fstatSync', 'readSync', 'writeSync', 'fsyncSync', 'closeSync', 'renameSync', 'unlinkSync', 'mkdirSync', 'rmdirSync', 'linkSync'] as const;
type Method = typeof METHODS[number];
function countingFs(): { fs: NotesFileFs; calls: { m: Method; p: string }[]; hook: Partial<Record<Method, (real: (...a: unknown[]) => unknown, ...a: unknown[]) => unknown>> } {
  const calls: { m: Method; p: string }[] = [];
  const hook: Partial<Record<Method, (real: (...a: unknown[]) => unknown, ...a: unknown[]) => unknown>> = {};
  const fake: Record<string, unknown> = {};
  for (const m of METHODS) {
    const real = (...a: unknown[]): unknown => (nodeFs[m] as unknown as (...x: unknown[]) => unknown)(...a);
    fake[m] = (...a: unknown[]): unknown => { calls.push({ m, p: typeof a[0] === 'string' ? a[0] : '#' + String(a[0]) }); const h = hook[m]; return h ? h(real, ...a) : real(...a); };
  }
  return { fs: fake as unknown as NotesFileFs, calls, hook };
}

let failures = 0;
async function test(name: string, fn: () => unknown): Promise<void> {
  try { await fn(); console.log(`ok - ${name}`); } catch (e) { failures++; console.log(`not ok - ${name}\n  ${(e as Error).message.split('\n').slice(0, 12).join('\n  ')}\n  ${(e as Error).stack?.split('\n').find((l) => l.includes('test-notesswitch.js:')) ?? ''}`); }
}

/** A folder with a written notes.md (one cycle of the real mirror) and the mirror Durbar persisted for it. */
async function written(file = new NotesFile({ now: tickClock })): Promise<{ folder: string; store: NotesStore; file: NotesFile }> {
  const folder = fresh();
  const store = new NotesStore(path.join(folder, '..', 'userdata', 'notes'), { now: tickClock });
  await store.add(folder, 'proj', { text: 'A plan to keep', from: 'typed', values: [] });
  const text = (await import('../src/shared/notesmd')).writeNotesMd((await store.list(folder) as { notes: import('../src/shared/notes').Note[] }).notes);
  const w = await file.syncOut(folder, text, null);
  assert.ok(w.ok, JSON.stringify(w));
  await store.setMirror(folder, 'proj', w.mirror);
  return { folder, store, file };
}

/** NotesOps on real stores: a folder list file, the notes store, the mirror. */
type RigOpts = { repo?: 'dir' | 'noinfo'; confirm?: (kind: 'on' | 'delete') => boolean; pending?: () => boolean; session?: Record<string, string[]>; folderValues?: string[] };
const asked: string[] = [];
function rig(opts: RigOpts = {}): { ops: NotesOps; folders: FolderStore; foldersFile: string; store: NotesStore; folder: string; ws: string; gone: string; timers: (() => void)[]; file: NotesFile } {
  const base = fresh('base');
  const folder = path.join(base, 'proj');
  nodeFs.mkdirSync(folder);
  if (opts.repo) { for (const d of ['.git', '.git/objects', ...(opts.repo === 'dir' ? ['.git/info'] : [])]) nodeFs.mkdirSync(path.join(base, d)); nodeFs.writeFileSync(path.join(base, '.git', 'HEAD'), 'ref: refs/heads/main\n'); }
  const ws = path.join(base, 'team.code-workspace');
  nodeFs.writeFileSync(ws, '{"folders":[{"path":"proj"}]}');
  const gone = path.join(base, 'gone');
  const foldersFile = path.join(base, 'userdata', 'durbar-folders.json');
  const folders = new FolderStore(foldersFile);
  folders.load();
  for (const w of [folder, ws, gone]) folders.upsert({ workspace: w, permMode: 'read-only' });
  const store = new NotesStore(path.join(base, 'userdata', 'notes'), { now: tickClock });
  const file = new NotesFile({ now: tickClock });
  const a = (id: string, cwd: string, workspaceFile?: string): AgentInfo => ({ id, name: 'x', cwd, folders: [cwd], permMode: 'read-only', status: 'ready', ...(workspaceFile ? { workspaceFile } : {}) } as unknown as AgentInfo);
  const agents = new Map<string, AgentInfo>([['a1', a('a1', folder)], ['a2', a('a2', folder)], ['w1', a('w1', folder, ws)], ['g1', a('g1', gone)]]);
  const timers: (() => void)[] = [];
  const ops = new NotesOps({
    agents, store: () => store, resumeIdFor: () => '', adapterIdOf: () => 'copilot', folderValues: () => opts.folderValues ?? [], sessionValues: (id) => opts.session?.[id] ?? [], now: tickClock,
    file: () => file, fileOn: (k) => folders.get(k)?.notesFile === true, setFileOn: (k, on) => folders.setNotesFile(k, on), setTimer: (fn) => { timers.push(fn); },
    valuesPending: () => opts.pending?.() === true,
    confirmNative: async (kind) => { asked.push(kind); return opts.confirm ? opts.confirm(kind) : true; },
  });
  return { ops, folders, foldersFile, store, folder, ws, gone, timers, file };
}
const okOf = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { assert.ok(r.ok, JSON.stringify(r)); return r as Extract<T, { ok: true }>; };
const refusedWith = (r: { ok: boolean; error?: string }, re: RegExp | string, what: string): void => {
  assert.ok(!r.ok && typeof r.error === 'string', `${what}: refused (${JSON.stringify(r)})`);
  if (typeof re === 'string') assert.strictEqual(r.error, re, what); else assert.ok(re.test(r.error!), `${what}: ${r.error}`);
  assert.ok(!r.error!.includes(root), `${what}: the refusal names no path`);
};
const FOUR = '# Notes\n\n<!-- durbar-note -->\n## one\n\na\n\n<!-- durbar-note -->\n## two\n\nb\n\n<!-- durbar-note id=n-abcdefabcdef created=2026-01-01T00:00:00.000Z updated=2026-01-01T00:00:00.000Z -->\n## three\n\nc\n\n<!-- durbar-note -->\n## four\n\nd\n';

async function main(): Promise<void> {
  // ---- the flag in folders.json (AC1) ----
  await test('notesFile: off by default, saved as true, read back after a restart, removed when off', () => {
    const dir = fresh('flags');
    const file = path.join(dir, 'durbar-folders.json');
    const s = new FolderStore(file);
    s.load();
    s.upsert({ workspace: path.join(dir, 'p'), permMode: 'read-only' });
    assert.strictEqual(s.get(path.join(dir, 'p'))!.notesFile, undefined, 'off by default');
    assert.ok(!nodeFs.readFileSync(file, 'utf8').includes('notesFile'), 'not written while off');
    assert.strictEqual(s.setNotesFile(path.join(dir, 'p'), true), true);
    assert.strictEqual(JSON.parse(nodeFs.readFileSync(file, 'utf8')).folders[0].notesFile, true, 'saved as true');
    const again = new FolderStore(file);
    assert.strictEqual(again.load()[0].notesFile, true, 'read back after a restart');
    s.upsert({ workspace: path.join(dir, 'p'), permMode: 'ask' });
    assert.strictEqual(new FolderStore(file).load()[0].notesFile, true, 'a later upsert (mode change) keeps it');
    assert.strictEqual(s.setNotesFile(path.join(dir, 'p'), false), true);
    assert.ok(!('notesFile' in JSON.parse(nodeFs.readFileSync(file, 'utf8')).folders[0]), 'removed when off');
    assert.strictEqual(s.setNotesFile(path.join(dir, 'not-saved'), true), false, 'a folder that is not saved: false');
    for (const v of ['"yes"', '1', '"true"', 'false', 'null', '{}']) {
      assert.strictEqual(parseSavedFolders(`{"folders":[{"workspace":${JSON.stringify(path.join(dir, 'p'))},"notesFile":${v}}]}`)[0].notesFile, undefined, `notesFile ${v} reads as off`);
    }
    // a list that cannot be saved keeps the old position and says so
    const ro = new FolderStore(path.join(dir, 'durbar-folders.json', 'nope', 'f.json'));
    (ro as unknown as { folders: unknown[] }).folders = [{ workspace: path.join(dir, 'p'), permMode: 'read-only', hidden: false }];
    assert.strictEqual(ro.setNotesFile(path.join(dir, 'p'), true), false, 'not saved: false');
    assert.strictEqual(ro.get(path.join(dir, 'p'))!.notesFile, undefined, 'not saved: still off');
  });

  // ---- NotesFile.remove (AC4, FR-055) ----
  await test('remove: deletes the file Durbar wrote and the then-empty .durbar (rmdir, never recursive)', async () => {
    const c = countingFs();
    const { folder, store } = await written(new NotesFile({ fs: c.fs, now: tickClock }));
    c.calls.length = 0;
    const r = new NotesFile({ fs: c.fs, now: tickClock }).remove(folder, await store.getMirror(folder));
    assert.deepStrictEqual(r, { removed: true, dirRemoved: true });
    assert.ok(!nodeFs.existsSync(path.join(folder, '.durbar')), '.durbar is gone');
    const un = c.calls.filter((x) => x.m === 'unlinkSync').map((x) => x.p);
    assert.ok(un.length === 1 && path.dirname(un[0]) === path.join(folder, '.durbar') && /^\.notes\.md\.\d+\.[a-z0-9]+\.del$/.test(path.basename(un[0])), `only the renamed notes.md is unlinked: ${un.join()}`);
    assert.ok(c.calls.some((x) => x.m === 'renameSync' && x.p === md(folder)), 'notes.md is renamed first');
    assert.deepStrictEqual(c.calls.filter((x) => x.m === 'rmdirSync').map((x) => x.p), [path.join(folder, '.durbar')], 'rmdir of .durbar only');
  });
  await test('remove: a .durbar with other files keeps them and stays', async () => {
    const { folder, store, file } = await written();
    nodeFs.writeFileSync(path.join(folder, '.durbar', 'mine.txt'), 'keep me');
    assert.deepStrictEqual(file.remove(folder, await store.getMirror(folder)), { removed: true, dirRemoved: false });
    assert.strictEqual(nodeFs.readFileSync(path.join(folder, '.durbar', 'mine.txt'), 'utf8'), 'keep me');
    assert.ok(!nodeFs.existsSync(md(folder)));
  });
  await test('remove: a file changed since Durbar wrote it (or with no mirror) stays, with the reason', async () => {
    const { folder, store, file } = await written();
    nodeFs.appendFileSync(md(folder), '\nmy own line\n');
    const before = nodeFs.readFileSync(md(folder));
    assert.deepStrictEqual(file.remove(folder, await store.getMirror(folder)), { removed: false, dirRemoved: false, why: REMOVE_CHANGED });
    assert.deepStrictEqual(nodeFs.readFileSync(md(folder)), before, 'untouched');
    assert.strictEqual(file.remove(folder, undefined).why, REMOVE_CHANGED, 'no mirror: Durbar never wrote it');
    assert.ok(nodeFs.existsSync(md(folder)));
    const none = fresh();
    assert.deepStrictEqual(file.remove(none, undefined), { removed: false, dirRemoved: false, why: REMOVE_NONE });
    nodeFs.mkdirSync(path.join(none, '.durbar'));
    assert.strictEqual(file.remove(none, undefined).why, REMOVE_NONE);
    assert.ok(nodeFs.existsSync(path.join(none, '.durbar')), 'an empty .durbar with no file is left alone');
  });
  await test('remove: the file changed between the check and the unlink stays (re-checked right before)', async () => {
    const c = countingFs();
    const { folder, store } = await written();
    const mirror = await store.getMirror(folder);
    let opens = 0;
    c.hook.openSync = (real, ...a) => { if (a[0] === md(folder) && ++opens === 2) nodeFs.appendFileSync(md(folder), 'late edit\n'); return real(...a); };
    const r = new NotesFile({ fs: c.fs, now: tickClock }).remove(folder, mirror);
    assert.deepStrictEqual(r, { removed: false, dirRemoved: false, why: REMOVE_CHANGED });
    assert.ok(nodeFs.readFileSync(md(folder), 'utf8').endsWith('late edit\n'), 'the late edit is kept');
    assert.strictEqual(c.calls.filter((x) => x.m === 'unlinkSync').length, 0, 'no unlink');
  });
  await test('remove: never a symlinked notes.md, a linked .durbar or a hard link; the targets are untouched', async () => {
    if (!canLink) { skip('cannot make links here'); return; }
    const { folder, store, file } = await written();
    const mirror = await store.getMirror(folder);
    const outside = fresh('outside');
    const target = path.join(outside, 'notes.md');
    nodeFs.renameSync(md(folder), target);
    nodeFs.symlinkSync(target, md(folder), 'file');
    const r1 = file.remove(folder, mirror);
    assert.ok(!r1.removed && /is a link/.test(r1.why!), JSON.stringify(r1));
    assert.ok(nodeFs.lstatSync(md(folder)).isSymbolicLink() && sha(nodeFs.readFileSync(target)) === mirror!.sha256, 'the link and its target stay');
    // a .durbar that is a link to a folder elsewhere holding the very file Durbar wrote
    const f2 = fresh();
    nodeFs.symlinkSync(outside, path.join(f2, '.durbar'), 'dir');
    const r2 = file.remove(f2, mirror);
    assert.ok(!r2.removed && /\.durbar is a link/.test(r2.why!), JSON.stringify(r2));
    assert.ok(nodeFs.existsSync(target), 'the outside file stays');
  });
  await test('remove: a hard link to notes.md is refused', async () => {
    if (!canHardLink) { skip('cannot make hard links here'); return; }
    const { folder, store, file } = await written();
    const other = path.join(fresh('elsewhere'), 'copy.md');
    nodeFs.linkSync(md(folder), other);
    const r = file.remove(folder, await store.getMirror(folder));
    assert.ok(!r.removed && /hard link/.test(r.why!), JSON.stringify(r));
    assert.ok(nodeFs.existsSync(md(folder)) && nodeFs.existsSync(other));
  });
  await test('remove: an unlink the OS refuses (a Windows editor holding the file) leaves it and says why; a missing folder never throws', async () => {
    const c = countingFs();
    const { folder, store } = await written();
    c.hook.unlinkSync = () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); };
    const r = new NotesFile({ fs: c.fs, now: tickClock, platform: 'win32' }).remove(folder, await store.getMirror(folder));
    assert.ok(!r.removed && /could not be deleted \(EBUSY\)/.test(r.why!), JSON.stringify(r));
    assert.ok(nodeFs.existsSync(md(folder)));
    const g = new NotesFile().remove(path.join(root, 'no-such-folder'), undefined);
    assert.ok(!g.removed && /folder is not there/.test(g.why!));
    assert.ok(!new NotesFile().remove('relative/path', undefined).removed, 'a relative path is refused');
  });
  await test('remove: the source has no recursive delete', () => {
    const src = nodeFs.readFileSync(path.join(ROOT, 'src', 'main', 'notesfile.ts'), 'utf8');
    const body = src.slice(src.indexOf('  remove(folderPath'), src.indexOf('  /**\n   * FR-051: append'));
    assert.ok(body.length > 500, 'found remove()');
    assert.ok(!/rmSync|recursive|rimraf|readdirSync/.test(body), 'remove() never deletes recursively');
  });

  await test('remove: .durbar swapped for a link after the unlink is never rmdir-ed through the link', async () => {
    if (!canLink) { skip('cannot make links here'); return; }
    const c = countingFs();
    const { folder, store } = await written();
    const outside = fresh('outside-empty');
    c.hook.unlinkSync = (real, ...a) => { const r = real(...a); if (path.dirname(String(a[0])) === path.join(folder, '.durbar')) { nodeFs.rmdirSync(path.join(folder, '.durbar')); nodeFs.symlinkSync(outside, path.join(folder, '.durbar'), 'dir'); } return r; };
    const r = new NotesFile({ fs: c.fs, now: tickClock }).remove(folder, await store.getMirror(folder));
    assert.deepStrictEqual(r, { removed: true, dirRemoved: false });
    assert.strictEqual(c.calls.filter((x) => x.m === 'rmdirSync').length, 0, 'no rmdir at all once .durbar is a link');
    assert.ok(nodeFs.statSync(outside).isDirectory() && nodeFs.lstatSync(path.join(folder, '.durbar')).isSymbolicLink(), 'the outside folder and the link stay');
  });

  // ---- inRepo, folderThere ----
  await test('inRepo: a .git folder or file walking up; folderThere: a real folder only', () => {
    const base = fresh('repo');
    const sub = path.join(base, 'a', 'b');
    nodeFs.mkdirSync(sub, { recursive: true });
    const f = new NotesFile();
    if (!repoAbove) assert.strictEqual(f.inRepo(sub), false, 'no .git: not a repository');
    else skip('a .git above the temp folder');
    nodeFs.mkdirSync(path.join(base, '.git'));
    assert.strictEqual(f.inRepo(sub), true, '.git folder above');
    const wt = fresh('worktree');
    nodeFs.writeFileSync(path.join(wt, '.git'), 'gitdir: /elsewhere\n');
    assert.strictEqual(f.inRepo(wt), true, '.git file (worktree)');
    if (canLink && !repoAbove) {
      const lk = fresh('linkedgit');
      nodeFs.symlinkSync(path.join(base, '.git'), path.join(lk, '.git'), 'dir');
      assert.strictEqual(f.inRepo(lk), true, 'a .git that is a link counts (review 2 of PR 931): the box shows, and addExclude refuses it');
    }
    assert.strictEqual(f.folderThere(sub), true);
    assert.strictEqual(f.folderThere(path.join(base, 'missing')), false);
    assert.strictEqual(f.folderThere(path.join(wt, '.git')), false, 'a file is not a folder');
    assert.strictEqual(f.folderThere('relative'), false);
    const c = countingFs();
    new NotesFile({ fs: c.fs }).folderThere(sub);
    new NotesFile({ fs: c.fs }).inRepo(sub);
    assert.ok(!c.calls.some((x) => /\.durbar/.test(x.p)), 'neither stats .durbar or notes.md');
  });

  // ---- NotesOps: list, fileCount, setFile (AC1, AC2, AC4, AC6, AC7) ----
  await test('list: the switch is offered off by default, absent for a .code-workspace, greyed when the folder is missing; nothing written while off', async () => {
    const r = rig();
    assert.deepStrictEqual(okOf(await r.ops.list('a1')).fileSwitch, { on: false });
    okOf(await r.ops.add('a1', { text: 'an idea' }));
    r.timers.splice(0).forEach((f) => f());
    assert.strictEqual(okOf(await r.ops.list('w1')).fileSwitch, undefined, 'not offered for a .code-workspace');
    assert.deepStrictEqual(okOf(await r.ops.list('g1')).fileSwitch, { on: false, disabled: SWITCH_MISSING });
    assert.ok(!nodeFs.existsSync(path.join(r.folder, '.durbar')), 'nothing in the project while off');
    r.folders.setNotesFile(r.gone, true);
    assert.deepStrictEqual(okOf(await r.ops.list('g1')).fileSwitch, { on: true, disabled: SWITCH_MISSING }, 'greyed in both positions');
  });
  await test('fileCount: the notes an existing file adds, repo or not; refusals for a conflict, a workspace, a missing folder', async () => {
    const r = rig({ repo: 'dir' });
    assert.deepStrictEqual(await r.ops.fileCount('a1'), { ok: true, count: 0, exists: false, strayText: 0, repo: true });
    nodeFs.mkdirSync(path.join(r.folder, '.durbar'));
    nodeFs.writeFileSync(md(r.folder), FOUR);
    assert.deepStrictEqual(await r.ops.fileCount('a1'), { ok: true, count: 4, exists: true, strayText: 0, repo: true });
    nodeFs.writeFileSync(md(r.folder), FOUR + '<<<<<<< ours\nx\n=======\ny\n>>>>>>> theirs\n');
    refusedWith(await r.ops.fileCount('a1'), COUNT_UNREADABLE, 'conflict');
    refusedWith(await r.ops.fileCount('w1'), SWITCH_WORKSPACE, 'workspace');
    refusedWith(await r.ops.fileCount('g1'), SWITCH_MISSING, 'missing');
    refusedWith(await r.ops.fileCount(r.folder), /chat is not open/, 'a path in place of the agent id');
    if (!repoAbove) assert.strictEqual(okOf(await rig().ops.fileCount('a1')).repo, false, 'outside a repository');
  });
  await test('setFile on: an unreadable file keeps the switch off and the file as it is', async () => {
    const r = rig({ repo: 'dir' });
    nodeFs.mkdirSync(path.join(r.folder, '.durbar'));
    const bad = FOUR + '<<<<<<< ours\nx\n=======\ny\n>>>>>>> theirs\n';
    nodeFs.writeFileSync(md(r.folder), bad);
    refusedWith(await r.ops.setFile('a1', true, { exclude: true }), COUNT_UNREADABLE, 'unreadable');
    assert.strictEqual(new FolderStore(r.foldersFile).load().find((f) => f.workspace === r.folder)!.notesFile, undefined, 'still off on disk');
    assert.strictEqual(nodeFs.readFileSync(md(r.folder), 'utf8'), bad);
    assert.ok(!nodeFs.existsSync(path.join(path.dirname(r.folder), '.git', 'info', 'exclude')), 'no exclude line either');
  });
  await test('setFile on in a repository: the flag, the exclude line before the first write, notes.md written, existing notes imported', async () => {
    const r = rig({ repo: 'dir' });
    okOf(await r.ops.add('a1', { text: 'Mine from Durbar' }));
    nodeFs.mkdirSync(path.join(r.folder, '.durbar'));
    nodeFs.writeFileSync(md(r.folder), FOUR);
    const order: string[] = [];
    const c = countingFs();
    c.hook.openSync = (real, ...a) => { const p = String(a[0]); if (p.endsWith('exclude')) order.push('exclude'); else if (p.includes('.durbar') && !p.endsWith('notes.md')) order.push('temp'); return real(...a); };
    const ops = new NotesOps({ ...(r.ops as unknown as { d: ConstructorParameters<typeof NotesOps>[0] }).d, file: () => new NotesFile({ fs: c.fs, now: tickClock }) });
    const res = okOf(await ops.setFile('a1', true, { exclude: true }));
    assert.strictEqual(res.on, true);
    assert.strictEqual(res.message, 'Added .durbar/ to .git/info/exclude (local only).');
    assert.strictEqual(res.file?.error, undefined, JSON.stringify(res.file));
    assert.deepStrictEqual([order[0], order.includes('temp')], ['exclude', true], `the exclude line comes before the first write: ${order.join()}`);
    assert.strictEqual(new FolderStore(r.foldersFile).load().find((f) => f.workspace === r.folder)!.notesFile, true, 'saved and read back');
    assert.strictEqual(nodeFs.readFileSync(path.join(path.dirname(r.folder), '.git', 'info', 'exclude'), 'utf8'), '/proj/.durbar/\n');
    const notes = okOf(await ops.list('a1')).notes;
    assert.strictEqual(notes.filter((n) => n.from === 'file').length, 4, 'the 4 notes of the file, From the project file');
    const text = nodeFs.readFileSync(md(r.folder), 'utf8');
    assert.ok(text.includes('Mine from Durbar') && text.includes('## four'), 'the file now mirrors every note');
    assert.deepStrictEqual(okOf(await ops.list('a1')).fileSwitch, { on: true });
    const again = okOf(await ops.setFile('a1', true, { exclude: true }));
    assert.strictEqual(again.message, '.durbar/ is already in .git/info/exclude.', 'turning on twice adds no second line');
  });
  await test('setFile on: the box off adds no line; outside a repository no exclude is tried', async () => {
    const r = rig({ repo: 'dir' });
    const res = okOf(await r.ops.setFile('a1', true, { exclude: false }));
    assert.strictEqual(res.message, undefined);
    assert.ok(!nodeFs.existsSync(path.join(path.dirname(r.folder), '.git', 'info', 'exclude')), 'no exclude file');
    assert.ok(nodeFs.existsSync(md(r.folder)), 'the file is written');
    if (repoAbove) { skip('a .git above the temp folder'); return; }
    const p = rig();
    const c = countingFs();
    const ops = new NotesOps({ ...(p.ops as unknown as { d: ConstructorParameters<typeof NotesOps>[0] }).d, file: () => new NotesFile({ fs: c.fs, now: tickClock }) });
    const res2 = okOf(await ops.setFile('a1', true, { exclude: true }));
    assert.strictEqual(res2.message, undefined, 'outside a repository: nothing said about exclude');
    assert.ok(!c.calls.some((x) => /exclude/.test(x.p)), 'no info/exclude touched');
  });
  await test('setFile: only an agent id, a boolean and two yes/no options; a path from the window is never used', async () => {
    const r = rig();
    const elsewhere = fresh('elsewhere');
    for (const [on, opts, what] of [
      ['true', undefined, 'on as text'], [1, undefined, 'on as a number'], [true, { path: elsewhere }, 'a path option'], [true, { folder: elsewhere, exclude: true }, 'a folder option'],
      [true, { exclude: 'yes' }, 'exclude as text'], [false, { deleteFile: 1 }, 'deleteFile as a number'], [true, { deleteFile: true }, 'delete while turning on'],
      [false, { exclude: true }, 'exclude while turning off'], [true, JSON.parse('{"__proto__":{"exclude":true}}'), '__proto__'], [true, [true], 'an array'], [true, 'exclude', 'a string'],
    ] as [unknown, unknown, string][]) refusedWith(await r.ops.setFile('a1', on, opts), /./, what);
    refusedWith(await r.ops.setFile(elsewhere, true), /chat is not open/, 'a path as the agent id');
    refusedWith(await r.ops.setFile('w1', true), SWITCH_WORKSPACE, 'a .code-workspace');
    refusedWith(await r.ops.setFile('g1', true), SWITCH_MISSING, 'a missing folder');
    assert.ok(!nodeFs.existsSync(path.join(elsewhere, '.durbar')) && !nodeFs.existsSync(path.join(r.folder, '.durbar')), 'nothing written anywhere');
    assert.ok(r.folders.list().every((f) => !f.notesFile), 'no flag set');
  });
  await test('setFile off: Leave keeps the file and the exclude line and says so; later changes write nothing', async () => {
    const r = rig({ repo: 'dir' });
    okOf(await r.ops.setFile('a1', true, { exclude: true }));
    const before = nodeFs.readFileSync(md(r.folder), 'utf8');
    const off = okOf(await r.ops.setFile('a1', false, { deleteFile: false }));
    assert.strictEqual(off.on, false);
    assert.ok(off.message!.includes('left in the project') && off.message!.includes(EXCLUDE_KEPT), off.message);
    assert.strictEqual(nodeFs.readFileSync(path.join(path.dirname(r.folder), '.git', 'info', 'exclude'), 'utf8'), '/proj/.durbar/\n', 'the exclude line stays');
    assert.strictEqual(new FolderStore(r.foldersFile).load().find((f) => f.workspace === r.folder)!.notesFile, undefined, 'off on disk');
    okOf(await r.ops.add('a1', { text: 'after off' }));
    r.timers.splice(0).forEach((f) => f());
    await r.ops.syncFile('a1');
    assert.strictEqual(nodeFs.readFileSync(md(r.folder), 'utf8'), before, 'not written after off');
    assert.deepStrictEqual(okOf(await r.ops.list('a1')).fileSwitch, { on: false });
    if (!repoAbove) {
      const p = rig();
      okOf(await p.ops.setFile('a1', true));
      assert.ok(!okOf(await p.ops.setFile('a1', false)).message!.includes('exclude'), 'outside a repository: nothing said about exclude');
    }
  });
  await test('setFile off: Delete removes the file Durbar wrote, keeps an edited one, and waits for a cycle in flight', async () => {
    const r = rig({ repo: 'dir' });
    okOf(await r.ops.setFile('a1', true, { exclude: false }));
    const del = okOf(await r.ops.setFile('a1', false, { deleteFile: true }));
    assert.ok(del.message!.startsWith('Deleted .durbar/notes.md and the empty .durbar folder.'), del.message);
    assert.ok(!nodeFs.existsSync(path.join(r.folder, '.durbar')));
    okOf(await r.ops.setFile('a1', true));
    nodeFs.appendFileSync(md(r.folder), 'my hand edit\n');
    const kept = okOf(await r.ops.setFile('a1', false, { deleteFile: true }));
    assert.ok(kept.message!.startsWith(REMOVE_CHANGED), kept.message);
    assert.ok(nodeFs.readFileSync(md(r.folder), 'utf8').endsWith('my hand edit\n'), 'the edited file stays');
    // a cycle in flight finishes before the delete looks at the file
    nodeFs.rmSync(path.join(r.folder, '.durbar'), { recursive: true }); // the test's own folder
    okOf(await r.ops.setFile('a1', true));
    okOf(await r.ops.add('a1', { text: 'one more' }));
    const inflight = r.ops.syncFile('a1');
    const off = r.ops.setFile('a1', false, { deleteFile: true });
    await inflight;
    assert.ok(okOf(await off).message!.startsWith('Deleted'), 'deleted after the cycle wrote');
    assert.ok(!nodeFs.existsSync(md(r.folder)), 'no file left behind by the cycle');
    // a cycle that starts while turning off (a timer firing) finds the switch off and writes nothing, before or after the delete
    okOf(await r.ops.setFile('a1', true));
    okOf(await r.ops.add('a1', { text: 'and another' }));
    const busy = r.ops.syncFile('a1');
    const off2 = r.ops.setFile('a1', false, { deleteFile: true });
    const late = r.ops.syncFile('a1');
    const late2 = Promise.resolve().then(() => r.ops.syncFile('a1'));
    await Promise.all([busy, off2, late, late2]);
    assert.ok(okOf(await off2).message!.startsWith('Deleted'), 'deleted');
    assert.strictEqual(await late, undefined, 'a cycle asked for while turning off does nothing');
    assert.ok(!nodeFs.existsSync(md(r.folder)) && !nodeFs.existsSync(path.join(r.folder, '.durbar')), 'nothing written after the switch went off');
  });
  await test('setFile off: a cycle already writing finishes before the delete; a cycle queued before it writes nothing', async () => {
    const r = rig();
    const c = countingFs();
    let armed = false;
    let offP: ReturnType<NotesOps['setFile']> | undefined;
    let offAt = -1;
    const ops = new NotesOps({ ...(r.ops as unknown as { d: ConstructorParameters<typeof NotesOps>[0] }).d, file: () => new NotesFile({ fs: c.fs, now: tickClock }) });
    okOf(await ops.setFile('a1', true));
    okOf(await ops.add('a1', { text: 'written while turning off' }));
    // the cycle is past its switch check when it looks at the folder: turning off starts right there, from inside the cycle
    c.hook.realpathSync = (real, ...a) => { if (armed) { armed = false; offAt = c.calls.length; offP = ops.setFile('a1', false, { deleteFile: true }); } return real(...a); };
    armed = true;
    const busy = ops.syncFile('a1');
    const queued = ops.syncFile('a1'); // asked for before the switch goes off, runs after
    await busy;
    assert.ok(offP, 'turning off started inside the cycle');
    const off = okOf(await offP!);
    assert.strictEqual(await queued, undefined, 'the queued cycle found the switch off and did nothing');
    assert.ok(off.message!.startsWith('Deleted'), `the file the running cycle wrote is deleted after it: ${off.message}`);
    assert.ok(!nodeFs.existsSync(md(r.folder)), 'no file left');
    const renames = c.calls.slice(offAt).filter((x) => x.m === 'renameSync' && x.p.endsWith('.tmp')).length;
    assert.strictEqual(renames, 1, 'only the running cycle wrote after turning off began; the queued one wrote nothing');
  });

  await test('setFile: on and off in one tick end off (and off then on ends on); calls run one at a time', async () => {
    const r = rig();
    const [a, b] = await Promise.all([r.ops.setFile('a1', true), r.ops.setFile('a1', false)]);
    assert.ok(okOf(a).on === true && okOf(b).on === false, JSON.stringify([a, b]));
    assert.strictEqual(new FolderStore(r.foldersFile).load().find((f) => f.workspace === r.folder)!.notesFile, undefined, 'the last answer (off) is what is saved');
    assert.deepStrictEqual(okOf(await r.ops.list('a1')).fileSwitch, { on: false });
    const [c2, d2] = await Promise.all([r.ops.setFile('a1', false), r.ops.setFile('a1', true)]);
    assert.ok(okOf(c2).on === false && okOf(d2).on === true);
    assert.strictEqual(new FolderStore(r.foldersFile).load().find((f) => f.workspace === r.folder)!.notesFile, true, 'off then on: on');
  });
  await test('setFile off with Delete while the switch is already off: refused, notes.md not even looked at', async () => {
    const r = rig();
    okOf(await r.ops.setFile('a1', true));
    okOf(await r.ops.setFile('a1', false, { deleteFile: false })); // Leave: the file stays
    const before = nodeFs.readFileSync(md(r.folder));
    const c = countingFs();
    const ops = new NotesOps({ ...(r.ops as unknown as { d: ConstructorParameters<typeof NotesOps>[0] }).d, file: () => new NotesFile({ fs: c.fs, now: tickClock }) });
    refusedWith(await ops.setFile('a1', false, { deleteFile: true }), SWITCH_ALREADY_OFF, 'delete while off');
    assert.deepStrictEqual(nodeFs.readFileSync(md(r.folder)), before, 'the left file stays');
    assert.ok(!c.calls.some((x) => /\.durbar/.test(x.p)), `nothing under .durbar touched: ${c.calls.filter((x) => /\.durbar/.test(x.p)).map((x) => x.m).join()}`);
  });

  // ---- review of PR 931 ----
  const GH = 'gh' + 'p_' + 'Q1w2E3r4T5y6U7i8O9p0A1s2D3f4G5';
  const KNOWN = 'folder-' + 'value-' + 'abc';
  const SESS = 'session-' + 'value-' + 'xyz';
  await test('PR 931 1a: the token shapes are masked for the file also when no value is known', () => {
    const f = new NotesFile({ now: tickClock });
    const n = { id: 'n-aaaaaaaaaaaa', title: `t ${GH}`, text: `raw ${GH} here`, createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T00:00:00.000Z', rev: 1, done: false, from: 'typed', fileEdited: false, hidden: false } as import('../src/shared/notes').Note;
    const out = f.forFile([n], []);
    assert.ok(!JSON.stringify(out).includes(GH.slice(4, 20)), JSON.stringify(out));
  });
  await test('PR 931 1b: a note masked for the file is masked in the store too, so the file never un-masks; a locked vault skips the cycle', async () => {
    const folder = fresh();
    const store = new NotesStore(path.join(folder, '..', 'userdata', 'notes'), { now: tickClock });
    okOf(await store.add(folder, 'proj', { text: `deploy with ${KNOWN}`, from: 'typed', values: [] })); // saved before the value was known
    const file = new NotesFile({ now: tickClock });
    await syncNotesFile({ file, store, folderKey: folder, folderName: 'proj', folderPath: folder, values: [KNOWN], now: tickClock, create: true });
    assert.ok(!nodeFs.readFileSync(md(folder), 'utf8').includes(KNOWN), 'the file is masked');
    const v = okOf(await store.list(folder));
    assert.ok(!JSON.stringify(v.notes).includes(KNOWN) && v.notes[0].hidden, 'the store is masked too');
    await store.add(folder, 'proj', { text: 'another note', from: 'typed', values: [] });
    await syncNotesFile({ file, store, folderKey: folder, folderName: 'proj', folderPath: folder, values: [], now: tickClock }); // the value is not known any more
    assert.ok(!nodeFs.readFileSync(md(folder), 'utf8').includes(KNOWN) && nodeFs.readFileSync(md(folder), 'utf8').includes('another note'), 'not un-masked');
    let locked = true;
    const r = rig({ pending: () => locked });
    refusedWith(await r.ops.setFile('a1', true), VALUES_PENDING_ON, 'turning on while locked (review 2 of PR 931)');
    assert.ok(!nodeFs.existsSync(path.join(r.folder, '.durbar')) && !r.folders.get(r.folder)!.notesFile, 'off, nothing written');
    locked = false;
    okOf(await r.ops.setFile('a1', true));
    assert.ok(nodeFs.existsSync(md(r.folder)), 'written by the turn-on call');
    locked = true;
    okOf(await r.ops.add('a1', { text: 'while locked again' }));
    assert.deepStrictEqual(okOf(await r.ops.list('a1')).file, { error: VALUES_PENDING });
    assert.ok(!nodeFs.readFileSync(md(r.folder), 'utf8').includes('while locked again'), 'no cycle while locked');
  });
  await test('PR 931 1c: the file is masked with the session values of every open chat of the folder', async () => {
    const r = rig({ session: { a2: [SESS] }, folderValues: [KNOWN] });
    okOf(await r.ops.add('a1', { text: `typed ${SESS} and ${KNOWN}` }));
    okOf(await r.ops.setFile('a1', true));
    const t = nodeFs.readFileSync(md(r.folder), 'utf8');
    assert.ok(!t.includes(SESS) && !t.includes(KNOWN), t);
  });
  await test('PR 931 2: delete renames, checks that name, unlinks only it; a .durbar swapped before the rename or the unlink deletes nothing outside', async () => {
    if (!canLink) { skip('cannot make links here'); return; }
    for (const when of ['rename', 'unlink'] as const) {
      const c = countingFs();
      const { folder, store } = await written();
      const outside = fresh('outside');
      nodeFs.writeFileSync(path.join(outside, 'notes.md'), 'someone else\'s different bytes\n');
      const ino = nodeFs.statSync(path.join(outside, 'notes.md')).ino;
      const aside = path.join(path.dirname(folder), 'aside');
      let done = false;
      const swap = (): void => { if (done) return; done = true; nodeFs.renameSync(path.join(folder, '.durbar'), aside); nodeFs.symlinkSync(outside, path.join(folder, '.durbar'), 'dir'); };
      if (when === 'rename') c.hook.renameSync = (real, ...a) => { if (String(a[0]) === md(folder)) swap(); return real(...a); };
      else c.hook.unlinkSync = (real, ...a) => { swap(); return real(...a); };
      const r = new NotesFile({ fs: c.fs, now: tickClock }).remove(folder, await store.getMirror(folder));
      assert.strictEqual(r.removed, false, `${when}: ${JSON.stringify(r)}`);
      const left = nodeFs.readdirSync(outside).map((n) => nodeFs.statSync(path.join(outside, n)).ino);
      assert.ok(left.includes(ino), `${when}: the outside file still exists (${nodeFs.readdirSync(outside).join()})`);
      if (when === 'rename') assert.ok(nodeFs.existsSync(path.join(outside, 'notes.md')), 'renamed back');
      assert.ok(nodeFs.readdirSync(aside).length === 1, `${when}: Durbar's own file is kept (maybe under the random name)`);
    }
    // the sequence the real swapper found: the rename lands outside, .durbar looks real for its check, the read goes outside again
    // (identical bytes), the unlink too. Only the real-path check of the random name stops it.
    {
      const c = countingFs();
      const { folder, store } = await written();
      const outside = fresh('outside3');
      nodeFs.copyFileSync(md(folder), path.join(outside, 'notes.md'));
      const ino = nodeFs.statSync(path.join(outside, 'notes.md')).ino;
      const d = path.join(folder, '.durbar'), aside = path.join(path.dirname(folder), 'aside3');
      let state: 'real' | 'link' = 'real', phase = 0;
      const toLink = (): void => { if (state === 'link') return; nodeFs.renameSync(d, aside); nodeFs.symlinkSync(outside, d, 'dir'); state = 'link'; };
      const toReal = (): void => { if (state === 'real') return; nodeFs.unlinkSync(d); nodeFs.renameSync(aside, d); state = 'real'; };
      c.hook.renameSync = (real, ...a) => { if (String(a[0]) === md(folder) && phase === 0) { toLink(); phase = 1; } return real(...a); };
      c.hook.lstatSync = (real, ...a) => { if (phase === 1 && String(a[0]) === d) toReal(); return real(...a); };
      c.hook.openSync = (real, ...a) => { if (phase === 1 && String(a[0]).endsWith('.del')) { toLink(); phase = 2; } return real(...a); };
      const r = new NotesFile({ fs: c.fs, now: tickClock }).remove(folder, await store.getMirror(folder));
      assert.ok(phase === 2 && !r.removed, `the sequence ran and nothing was deleted: ${JSON.stringify(r)}`);
      assert.ok(nodeFs.readdirSync(outside).map((n) => nodeFs.statSync(path.join(outside, n)).ino).includes(ino), 'the outside file still exists');
    }
    // a real swapper in another process, bounded: no outside file is ever deleted
    if (!posix) { skip('the swapper process uses POSIX renames over links'); return; }
    const { folder, store } = await written();
    const mirror = await store.getMirror(folder);
    const bytes = nodeFs.readFileSync(md(folder));
    const outside = fresh('outside2');
    nodeFs.writeFileSync(path.join(outside, 'notes.md'), bytes); // identical bytes: the hard case
    const ino = nodeFs.statSync(path.join(outside, 'notes.md')).ino;
    const real = path.join(path.dirname(folder), 'real-durbar');
    const stop = path.join(path.dirname(folder), 'stop');
    const code = `const fs=require('fs');const [d,real,out,stop]=process.argv.slice(1);const end=Date.now()+120000;let n=0;process.stdout.write('R');
      while(!fs.existsSync(stop)&&Date.now()<end){try{fs.renameSync(d,real);fs.symlinkSync(out,d,'dir');for(let k=0;k<(n%7)*4;k++)fs.statSync(out);fs.unlinkSync(d);fs.renameSync(real,d);n++;}catch(e){try{if(!fs.existsSync(d)&&fs.existsSync(real))fs.renameSync(real,d);}catch(_){}}}
      try{if(fs.lstatSync(d).isSymbolicLink())fs.unlinkSync(d);}catch(_){}try{if(fs.existsSync(real))fs.renameSync(real,d);}catch(_){}process.stdout.write(String(n));`;
    nodeFs.writeFileSync(path.join(folder, '.durbar', 'keep.txt'), 'keeps .durbar from being removed when empty');
    const child = spawn(process.execPath, ['-e', code, path.join(folder, '.durbar'), real, outside, stop], { stdio: ['ignore', 'pipe', 'ignore'] });
    let swaps = '';
    child.stdout.on('data', (b) => { swaps += String(b); });
    const exited = new Promise<void>((res) => child.on('exit', () => res()));
    await new Promise<void>((res) => { const t = (): void => { if (swaps.includes('R')) res(); else setImmediate(t); }; t(); }); // the swapper runs
    const f = (): NotesFile => fw;
    let deleted = 0, exposed = 0, restored = 0;
    const MAX_ATTEMPTS = 200000, WANT = 5; // until 5 exposures are seen, bounded
    let attempts = 0;
    // count the exposures: a rename of notes.md that landed in the other folder through the swapped link (the dangerous rounds)
    const watched = { ...nodeFs, renameSync: (a: nodeFs.PathLike, b: nodeFs.PathLike): void => { nodeFs.renameSync(a, b); if (String(a) === md(folder) && nodeFs.existsSync(path.join(outside, path.basename(String(b))))) exposed++; } } as unknown as NotesFileFs;
    const fw = new NotesFile({ fs: watched, now: tickClock });
    for (let i = 0; i < MAX_ATTEMPTS && exposed < WANT; i++) {
      attempts++;
      try { if (nodeFs.lstatSync(path.join(folder, '.durbar')).isDirectory()) nodeFs.writeFileSync(md(folder), bytes, { flag: 'wx' }); } catch { /* there already, or swapped: next round */ }
      if (f().remove(folder, mirror).removed) deleted++;
      // a rename that landed in the outside folder (exposure): put the outside file back under its name, so every round can reach it
      if (!nodeFs.existsSync(path.join(outside, 'notes.md'))) {
        const moved = nodeFs.readdirSync(outside).find((n) => n.endsWith('.del') && nodeFs.statSync(path.join(outside, n)).ino === ino);
        if (moved) { restored++; nodeFs.renameSync(path.join(outside, moved), path.join(outside, 'notes.md')); }
      }
      if (i % 50 === 0) await new Promise((res) => setImmediate(res));
    }
    nodeFs.writeFileSync(stop, '');
    await exited;
    console.log(`  (swapper: ${swaps.replace('R', '')} swaps; ${attempts} delete attempts, ${deleted} deletes of Durbar's own file, ${exposed} renames that landed in the other folder (exposures), ${restored} of them left under the random name and put back by the test)`);
    assert.ok(Number(swaps.replace('R', '')) > 0 && deleted > 0 && exposed > 0, `the race really ran: swaps, deletes and exposures all happened (${exposed} exposures)`);
    const left = nodeFs.readdirSync(outside).map((n) => nodeFs.statSync(path.join(outside, n)).ino);
    assert.ok(left.includes(ino), `the outside file survived ${swaps} swaps and ${deleted} deletes (${nodeFs.readdirSync(outside).join()})`);
  });
  await test('PR 931 review 2, points 5 and 6: the rename back never replaces a newer notes.md, and the message names the exact file', async () => {
    const c = countingFs();
    const { folder, store } = await written();
    let doomed = '';
    c.hook.unlinkSync = (real, ...a) => { if (String(a[0]).endsWith('.del')) { doomed = String(a[0]); nodeFs.writeFileSync(md(folder), 'a newer file\n'); throw Object.assign(new Error('perm'), { code: 'EPERM' }); } return real(...a); };
    const r = new NotesFile({ fs: c.fs, now: tickClock }).remove(folder, await store.getMirror(folder));
    assert.ok(!r.removed && doomed, JSON.stringify(r));
    assert.strictEqual(nodeFs.readFileSync(md(folder), 'utf8'), 'a newer file\n', 'the newer notes.md is kept');
    assert.ok(nodeFs.existsSync(doomed), 'the old one stays under its random name');
    assert.strictEqual(r.why, `Durbar did not delete .durbar/notes.md: it could not be deleted (EPERM); a newer notes.md is there, so the old one may be left as ${path.basename(doomed)}, in .durbar or in another folder: renaming it back to notes.md restores it.`);
    // no hard links on this file system: renamed back only when nothing is at notes.md
    const c2 = countingFs();
    const w2 = await written();
    c2.hook.unlinkSync = (real, ...a) => { if (String(a[0]).endsWith('.del')) throw Object.assign(new Error('perm'), { code: 'EPERM' }); return real(...a); };
    c2.hook.linkSync = () => { throw Object.assign(new Error('nolinks'), { code: 'EPERM' }); };
    const r2 = new NotesFile({ fs: c2.fs, now: tickClock }).remove(w2.folder, await w2.store.getMirror(w2.folder));
    assert.strictEqual(r2.why, 'Durbar did not delete .durbar/notes.md: it could not be deleted (EPERM).');
    assert.ok(nodeFs.existsSync(md(w2.folder)) && nodeFs.readdirSync(path.join(w2.folder, '.durbar')).length === 1, 'renamed back, nothing left behind');
  });
  await test('PR 931 review 2, point 1: a repository whose .git is a link: the box shows and the switch stays off; point 8: the text has one period', async () => {
    if (!canLink) { skip('cannot make links here'); return; }
    const r = rig({ repo: 'dir' });
    const base = path.dirname(r.folder);
    nodeFs.renameSync(path.join(base, '.git'), path.join(base, 'gitdir-real'));
    nodeFs.symlinkSync(path.join(base, 'gitdir-real'), path.join(base, '.git'), 'dir');
    assert.strictEqual(okOf(await r.ops.fileCount('a1')).repo, true, 'the dialog offers the box');
    const res = await r.ops.setFile('a1', true, { exclude: true }) as { ok: boolean; error?: string; excludeFailed?: boolean };
    assert.deepStrictEqual([res.ok, res.excludeFailed, res.error], [false, true, 'Could not add .durbar/ to .git/info/exclude: .git is a link. The switch stays off.']);
    assert.ok(!nodeFs.existsSync(path.join(r.folder, '.durbar')) && !r.folders.get(r.folder)!.notesFile, 'off, nothing written');
    if (!posix) { skip('a folder name with a tab cannot be made on Windows'); return; }
    const q = rig({ repo: 'dir' });
    const tabbed = path.join(path.dirname(q.folder), 'a\tb');
    nodeFs.mkdirSync(tabbed);
    const ag = q.ops as unknown as { d: { agents: Map<string, AgentInfo> } };
    ag.d.agents.set('t1', { ...ag.d.agents.get('a1')!, id: 't1', cwd: tabbed, folders: [tabbed] } as AgentInfo);
    q.folders.upsert({ workspace: tabbed, permMode: 'read-only' });
    const t = await q.ops.setFile('t1', true, { exclude: true }) as { ok: boolean; error?: string };
    assert.strictEqual(t.error, "This folder's name cannot be written to .git/info/exclude safely. The switch stays off.");
  });
  await test('PR 931 review 2, points 2 and 3: only turning on creates the file; another folder at the same path is not written into', async () => {
    const r = rig();
    okOf(await r.ops.setFile('a1', true));
    nodeFs.rmSync(path.join(r.folder, '.durbar'), { recursive: true }); // the test's own folder
    await r.store.setMirror(r.folder, 'proj', undefined); // as after a turn-on whose first write did not happen
    assert.deepStrictEqual(okOf(await r.ops.list('a1')).file, { error: NOTES_GONE });
    assert.ok(!nodeFs.existsSync(path.join(r.folder, '.durbar')), 'no mirror and no file: still not created');
    okOf(await r.ops.setFile('a1', false));
    okOf(await r.ops.setFile('a1', true));
    assert.ok(nodeFs.existsSync(md(r.folder)));
    // the folder is replaced by another one at the same path that ships its own notes.md
    nodeFs.renameSync(r.folder, r.folder + '-old');
    nodeFs.mkdirSync(path.join(r.folder, '.durbar'), { recursive: true });
    const theirs = '# Notes\n\n<!-- durbar-note -->\n## their note\n\nfrom another repository\n';
    nodeFs.writeFileSync(md(r.folder), theirs);
    okOf(await r.ops.add('a1', { text: 'my private idea' }));
    assert.deepStrictEqual(okOf(await r.ops.list('a1')).file, { error: NOTES_REPLACED });
    assert.strictEqual(nodeFs.readFileSync(md(r.folder), 'utf8'), theirs, 'nothing written into the other folder');
    assert.ok(!okOf(await r.ops.list('a1')).notes.some((n) => n.title === 'their note'), 'and nothing imported from it');
  });
  await test('PR 931 3 and 7: the exclude line goes in before the flag; when it cannot, the switch stays off; no options: no line', async () => {
    const r = rig({ repo: 'noinfo' });
    const res = await r.ops.setFile('a1', true, { exclude: true }) as { ok: boolean; error?: string; excludeFailed?: boolean };
    assert.ok(!res.ok && res.excludeFailed === true && /no info folder\. The switch stays off\./.test(res.error!), JSON.stringify(res));
    assert.ok(!nodeFs.existsSync(path.join(r.folder, '.durbar')) && !r.folders.get(r.folder)!.notesFile, 'off and nothing written');
    okOf(await r.ops.setFile('a1', true, { exclude: false }));
    assert.ok(nodeFs.existsSync(md(r.folder)), 'turned on without the line after an explicit choice');
    const q = rig({ repo: 'dir' });
    okOf(await q.ops.setFile('a1', true));
    assert.ok(!nodeFs.existsSync(path.join(path.dirname(q.folder), '.git', 'info', 'exclude')), 'no options: no exclude line');
  });
  await test('PR 931 4: a file Durbar wrote that is gone is not recreated until the switch is turned on again', async () => {
    const r = rig();
    okOf(await r.ops.setFile('a1', true));
    nodeFs.rmSync(path.join(r.folder, '.durbar'), { recursive: true }); // the test's own folder: another clone at the same path
    assert.deepStrictEqual(okOf(await r.ops.list('a1')).file, { error: NOTES_GONE });
    okOf(await r.ops.add('a1', { text: 'after the folder was replaced' }));
    r.timers.splice(0).forEach((f) => f());
    await r.ops.syncFile('a1');
    assert.ok(!nodeFs.existsSync(path.join(r.folder, '.durbar')), 'not recreated');
    assert.deepStrictEqual(okOf(await r.ops.list('a1')).fileSwitch, { on: true }, 'the flag stays on');
    okOf(await r.ops.setFile('a1', false));
    okOf(await r.ops.setFile('a1', true));
    assert.ok(nodeFs.readFileSync(md(r.folder), 'utf8').includes('after the folder was replaced'), 'written after turning on again');
  });
  await test('PR 931 5: fileCount says how many lines of text outside notes an existing file would lose', async () => {
    const r = rig();
    nodeFs.mkdirSync(path.join(r.folder, '.durbar'));
    nodeFs.writeFileSync(md(r.folder), 'my own plan\nline two\nline three\n');
    const c = okOf(await r.ops.fileCount('a1'));
    assert.deepStrictEqual([c.count, c.exists, c.strayText], [0, true, 3]);
  });
  await test('PR 931 Q2: a native box the page cannot answer, before turning on and before Delete', async () => {
    let say = false;
    const r = rig({ repo: 'dir', confirm: () => say });
    asked.length = 0;
    refusedWith(await r.ops.setFile('a1', true, { exclude: true }), NATIVE_CANCELLED, 'Cancel in the native box');
    assert.deepStrictEqual(asked, ['on']);
    assert.ok(!nodeFs.existsSync(path.join(r.folder, '.durbar')) && !r.folders.get(r.folder)!.notesFile && !nodeFs.existsSync(path.join(path.dirname(r.folder), '.git', 'info', 'exclude')), 'nothing written, no flag, no line');
    say = true;
    okOf(await r.ops.setFile('a1', true));
    say = false;
    refusedWith(await r.ops.setFile('a1', false, { deleteFile: true }), NATIVE_CANCELLED, 'Delete cancelled');
    assert.ok(nodeFs.existsSync(md(r.folder)) && r.folders.get(r.folder)!.notesFile === true, 'the file and the switch stay');
    okOf(await r.ops.setFile('a1', false)); // Leave needs no box
    const none = new NotesOps({ ...(r.ops as unknown as { d: ConstructorParameters<typeof NotesOps>[0] }).d, confirmNative: undefined });
    refusedWith(await none.setFile('a1', true), NATIVE_CANCELLED, 'no native box wired: refused');
  });

  // ---- main wiring and the channels (AC1, IPC) ----
  await test('main.ts reads and saves the flag through the folder list; the two channels are not open to the simulator', () => {
    const mainSrc = nodeFs.readFileSync(path.join(ROOT, 'src', 'main', 'main.ts'), 'utf8');
    assert.ok(/fileOn: \(key\) => folderStore\?\.get\(key\)\?\.notesFile === true/.test(mainSrc), 'fileOn reads notesFile');
    assert.ok(/setFileOn: \(key, on\) => folderStore\?\.setNotesFile\(key, on\) === true/.test(mainSrc), 'setFileOn saves it');
    assert.ok(!/fileOn: \(\) => false/.test(mainSrc), 'no longer off for every folder');
    assert.ok(/confirmNative: \(kind, name\) => nativeConfirm\(win, /.test(mainSrc), 'main asks with the native box (not the page)');
    assert.ok(/valuesPending: \(\) => !!mcpStore && !mcpStore\.noPrompt\(\)/.test(mainSrc), 'a locked vault holds the file back');
    const nc = nodeFs.readFileSync(path.join(ROOT, 'src', 'main', 'nativeconfirm.ts'), 'utf8');
    assert.ok(/defaultId: 0, cancelId: 0/.test(nc) && /response === 1/.test(nc), 'Cancel is the default and the Escape answer');
    assert.ok(/nativeConfirm\(deps\.getWin\(\)/.test(nodeFs.readFileSync(path.join(ROOT, 'src', 'main', 'ipc', 'remote.ts'), 'utf8')), 'remote control uses the same helper');
    for (const c of ['notes:setFile', 'notes:fileCount']) assert.ok(!Object.prototype.hasOwnProperty.call(SIM_OPEN_CHANNELS, c), `${c} is refused under DURBAR_SIM`);
    const code = nodeFs.readFileSync(path.join(ROOT, 'src', 'main', 'notesops.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/child_process|console\./.test(code), 'notesops starts no process and logs nothing');
  });
  await test('IPC: notes:fileCount and notes:setFile on a stand-in electron, from the app only', async () => {
    const electronPath = require.resolve('electron');
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
    const fake = { ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => undefined }, app: { getVersion: () => '0.0.0-test' } };
    const saved = require.cache[electronPath];
    require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { register } = require('../src/main/ipc/notes') as typeof import('../src/main/ipc/notes');
      const r = rig({ repo: 'dir' });
      register({ getOps: () => r.ops });
      const frame = { url: pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href };
      const app = { senderFrame: frame, sender: { mainFrame: frame } };
      const other = { senderFrame: { url: 'https://example.invalid/' }, sender: { mainFrame: { url: 'https://example.invalid/' } } };
      const call = async (e: unknown, ch: string, ...a: unknown[]): Promise<Record<string, unknown>> => (await handlers.get(ch)!(e, ...a)) as Record<string, unknown>;
      assert.deepStrictEqual(await call(app, 'notes:fileCount', 'a1'), { ok: true, count: 0, exists: false, strayText: 0, repo: true });
      const on = await call(app, 'notes:setFile', 'a1', true, { exclude: false });
      assert.strictEqual(on.ok, true, JSON.stringify(on));
      assert.ok(nodeFs.existsSync(md(r.folder)), 'written through the channel');
      await assert.rejects(Promise.resolve().then(() => handlers.get('notes:setFile')!(other, 'a1', false, { deleteFile: true })), /did not come from its own window/);
      assert.ok(nodeFs.existsSync(md(r.folder)), 'a call from elsewhere deletes nothing');
      const off = await call(app, 'notes:setFile', 'a1', false, { deleteFile: true });
      assert.strictEqual(off.ok, true);
      assert.ok(!nodeFs.existsSync(md(r.folder)));
    } finally {
      if (saved) require.cache[electronPath] = saved; else delete require.cache[electronPath];
    }
  });

  nodeFs.rmSync(root, { recursive: true, force: true }); // the suite's own temp folder, by its exact path
  if (failures) { console.log(`notes switch: ${failures} failed`); process.exitCode = 1; return; }
  if (!posix) console.log('  (Windows: link cases depend on the runner allowing symlinks)');
  console.log('notes switch: flag saved and read back, delete only what Durbar wrote (hash, links, rmdir), exclude before the first write, options and paths refused, channels app-only');
  process.exitCode = 0;
}
void main();

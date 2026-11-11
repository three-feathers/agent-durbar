/**
 * Spec 083 T042 (FR-050, FR-051, FR-055, issue 699): the project-file switch in main: the `notesProject` flag in folders.json, `NotesFile`'s
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
import { parseNotesDoc } from '../src/shared/notes';
import { NATIVE_CANCELLED, NOT_OURS, NotesOps, SWITCH_ALREADY_OFF, SWITCH_MISSING, SWITCH_WORKSPACE, VALUES_PENDING, VALUES_PENDING_ON } from '../src/main/notesops';
import { spawn } from 'child_process';
import { FolderStore, parseSavedFolders } from '../src/main/folders';
import { SIM_OPEN_CHANNELS } from '../src/main/simguard';

process.exitCode = 1; // set to 0 only after the last line: a promise that never settles fails the suite
const posix = process.platform !== 'win32';
const realOf = (p: string): string => (nodeFs.realpathSync.native ?? nodeFs.realpathSync)(p);
const root = realOf(nodeFs.mkdtempSync(path.join(os.tmpdir(), 'durbar-notesswitch-')));
let seq = 0;
const freshOut = (name: string): string => { const d = fresh(name); nodeFs.mkdirSync(path.join(d, 'notes')); return d; };
const fresh = (name = 'proj'): string => { const d = path.join(root, `c${++seq}`, name); nodeFs.mkdirSync(d, { recursive: true }); return d; };
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const md = (folder: string): string => path.join(folder, '.durbar', 'notes', 'notes.md');
/** The inode at `p` itself (no link followed), `undefined` when nothing is there. */
const inoOf = (p: string): bigint | undefined => { try { return nodeFs.lstatSync(p, { bigint: true }).ino; } catch { return undefined; } };
/** Whether a mirror id `<dev>:<ino>` ends in `ino`. Always a bigint: an NTFS file ID above 2^53 loses its low bit as a number (issue 1491 for the production side). */
const idHolds = (id: string | undefined, ino: bigint | undefined): boolean => id !== undefined && ino !== undefined && id.endsWith(`:${ino}`);
const ROOT = ((): string => { let d = __dirname; while (!nodeFs.existsSync(path.join(d, 'package.json'))) d = path.dirname(d); return d; })();
let tick = Date.parse('2026-10-31T12:00:00.000Z');
const tickClock = (): Date => new Date(tick += 1000);
const canLink = ((): boolean => { try { const t = path.join(root, 'probe'); nodeFs.symlinkSync(root, t, 'dir'); nodeFs.unlinkSync(t); return true; } catch { return false; } })();
const canHardLink = ((): boolean => { try { const a = path.join(root, 'h1'), b = path.join(root, 'h2'); nodeFs.writeFileSync(a, 'x'); nodeFs.linkSync(a, b); nodeFs.unlinkSync(b); nodeFs.unlinkSync(a); return true; } catch { return false; } })();
/** A `.git` above the temp root would make every folder "in a repository": the negative cases then say so and are skipped. */
const repoAbove = ((): boolean => { for (let d = root; ; d = path.dirname(d)) { if (nodeFs.existsSync(path.join(d, '.git'))) return true; if (path.dirname(d) === d) return false; } })();
const skip = (why: string): void => console.log(`  (skipped: ${why})`);

const METHODS = ['readdirSync', 'realpathSync', 'lstatSync', 'statSync', 'openSync', 'fstatSync', 'readSync', 'writeSync', 'fsyncSync', 'closeSync', 'renameSync', 'unlinkSync', 'mkdirSync', 'rmdirSync', 'linkSync'] as const;
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
type RigOpts = { repo?: boolean; confirm?: (kind: string) => boolean; pending?: () => boolean; session?: Record<string, string[]>; folderValues?: string[] };
const asked: string[] = [];
function rig(opts: RigOpts = {}): { ops: NotesOps; folders: FolderStore; foldersFile: string; store: NotesStore; folder: string; ws: string; gone: string; timers: (() => void)[]; file: NotesFile } {
  const base = fresh('base');
  const folder = path.join(base, 'proj');
  nodeFs.mkdirSync(folder);
  if (opts.repo) nodeFs.mkdirSync(path.join(base, '.git'));
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
    file: () => file, fileOn: (k) => !!folders.get(k)?.notesProject, fileGit: (k) => folders.get(k)?.notesProject === 'git', setFileOn: (k, on, git) => folders.setNotesFile(k, on, git), ignoreOwn: (k) => folders.get(k)?.notesIgnoreOwn, setIgnoreOwn: (k, id) => folders.setNotesIgnoreOwn(k, id), setTimer: (fn) => { timers.push(fn); },
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
  await test('notesProject: off by default, saved as true or \'git\', read back after a restart, removed when off, the old notesFile key is dropped', () => {
    const dir = fresh('flags');
    const file = path.join(dir, 'durbar-folders.json');
    const s = new FolderStore(file);
    s.load();
    s.upsert({ workspace: path.join(dir, 'p'), permMode: 'read-only' });
    assert.strictEqual(s.get(path.join(dir, 'p'))!.notesProject, undefined, 'off by default');
    assert.ok(!nodeFs.readFileSync(file, 'utf8').includes('notesProject'), 'not written while off');
    assert.strictEqual(s.setNotesFile(path.join(dir, 'p'), true), true);
    assert.strictEqual(JSON.parse(nodeFs.readFileSync(file, 'utf8')).folders[0].notesProject, true, 'saved as true');
    const again = new FolderStore(file);
    assert.strictEqual(again.load()[0].notesProject, true, 'read back after a restart');
    s.upsert({ workspace: path.join(dir, 'p'), permMode: 'ask' });
    assert.strictEqual(new FolderStore(file).load()[0].notesProject, true, 'a later upsert (mode change) keeps it');
    assert.strictEqual(s.setNotesFile(path.join(dir, 'p'), false), true);
    assert.ok(!('notesProject' in JSON.parse(nodeFs.readFileSync(file, 'utf8')).folders[0]), 'removed when off');
    assert.strictEqual(s.setNotesFile(path.join(dir, 'p'), true, true), true);
    assert.strictEqual(new FolderStore(file).load()[0].notesProject, 'git', 'the choice for git is saved');
    s.setNotesFile(path.join(dir, 'p'), false);
    assert.strictEqual(parseSavedFolders(`{"folders":[{"workspace":${JSON.stringify(path.join(dir, 'p'))},"notesFile":true}]}`)[0].notesProject, undefined, 'a notesFile from an older version is dropped: the switch is off');
    assert.strictEqual(s.setNotesFile(path.join(dir, 'not-saved'), true), false, 'a folder that is not saved: false');
    for (const v of ['"yes"', '1', '"true"', 'false', 'null', '{}', '"ignored"']) {
      assert.strictEqual(parseSavedFolders(`{"folders":[{"workspace":${JSON.stringify(path.join(dir, 'p'))},"notesProject":${v}}]}`)[0].notesProject, undefined, `notesProject ${v} reads as off`);
    }
    // a list that cannot be saved keeps the old position and says so
    const ro = new FolderStore(path.join(dir, 'durbar-folders.json', 'nope', 'f.json'));
    (ro as unknown as { folders: unknown[] }).folders = [{ workspace: path.join(dir, 'p'), permMode: 'read-only', hidden: false }];
    assert.strictEqual(ro.setNotesFile(path.join(dir, 'p'), true), false, 'not saved: false');
    assert.strictEqual(ro.get(path.join(dir, 'p'))!.notesProject, undefined, 'not saved: still off');
  });

  // ---- NotesFile.remove (AC4, FR-055) ----
  await test('remove: deletes the file Durbar wrote and the then-empty .durbar (rmdir, never recursive)', async () => {
    const c = countingFs();
    const { folder, store } = await written(new NotesFile({ fs: c.fs, now: tickClock }));
    c.calls.length = 0;
    const r = new NotesFile({ fs: c.fs, now: tickClock }).remove(folder, await store.getMirror(folder), new NotesFile().ignoreId(folder));
    assert.deepStrictEqual(r, { removed: true, dirRemoved: true, ignoreDropped: true });
    assert.ok(!nodeFs.existsSync(path.join(folder, '.durbar')), '.durbar is gone');
    const un = c.calls.filter((x) => x.m === 'unlinkSync').map((x) => x.p);
    const nd = path.join(folder, '.durbar', 'notes');
    assert.ok(un.length === 2 && un.every((u) => path.dirname(u) === nd) && /^\.notes\.md\.\d+\.[a-z0-9]+\.del$/.test(path.basename(un[0])) && path.basename(un[1]) === '.gitignore', `only the renamed notes.md and Durbar's own .gitignore are unlinked: ${un.join()}`);
    assert.ok(c.calls.some((x) => x.m === 'renameSync' && x.p === md(folder)), 'notes.md is renamed first');
    assert.deepStrictEqual(c.calls.filter((x) => x.m === 'rmdirSync').map((x) => x.p), [nd, path.join(folder, '.durbar')], 'rmdir of .durbar/notes, then .durbar, nothing recursive');
  });
  await test('remove: a .durbar with other files keeps them and stays', async () => {
    const { folder, store, file } = await written();
    nodeFs.writeFileSync(path.join(folder, '.durbar', 'notes', 'mine.txt'), 'keep me');
    assert.deepStrictEqual(file.remove(folder, await store.getMirror(folder), new NotesFile().ignoreId(folder)), { removed: true, dirRemoved: false });
    assert.strictEqual(nodeFs.readFileSync(path.join(folder, '.durbar', 'notes', 'mine.txt'), 'utf8'), 'keep me');
    assert.ok(!nodeFs.existsSync(md(folder)));
  });
  await test('remove: a file changed since Durbar wrote it (or with no mirror) stays, with the reason', async () => {
    const { folder, store, file } = await written();
    nodeFs.appendFileSync(md(folder), '\nmy own line\n');
    const before = nodeFs.readFileSync(md(folder));
    assert.deepStrictEqual(file.remove(folder, await store.getMirror(folder), new NotesFile().ignoreId(folder)), { removed: false, dirRemoved: false, why: REMOVE_CHANGED });
    assert.deepStrictEqual(nodeFs.readFileSync(md(folder)), before, 'untouched');
    assert.strictEqual(file.remove(folder, undefined).why, REMOVE_CHANGED, 'no mirror: Durbar never wrote it');
    assert.ok(nodeFs.existsSync(md(folder)));
    const none = fresh();
    assert.deepStrictEqual(file.remove(none, undefined), { removed: false, dirRemoved: false, why: REMOVE_NONE });
    nodeFs.mkdirSync(path.join(none, '.durbar', 'notes'), { recursive: true });
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
    const outside = freshOut('outside');
    const target = path.join(outside, 'notes', 'notes.md');
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
    const r = file.remove(folder, await store.getMirror(folder), new NotesFile().ignoreId(folder));
    assert.ok(!r.removed && /hard link/.test(r.why!), JSON.stringify(r));
    assert.ok(nodeFs.existsSync(md(folder)) && nodeFs.existsSync(other));
  });
  await test('remove: an unlink the OS refuses (a Windows editor holding the file) leaves it and says why; a missing folder never throws', async () => {
    const c = countingFs();
    const { folder, store } = await written();
    c.hook.unlinkSync = () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); };
    const r = new NotesFile({ fs: c.fs, now: tickClock, platform: 'win32' }).remove(folder, await store.getMirror(folder), new NotesFile().ignoreId(folder));
    assert.ok(!r.removed && /could not be deleted \(EBUSY\)/.test(r.why!), JSON.stringify(r));
    assert.ok(nodeFs.existsSync(md(folder)));
    const g = new NotesFile().remove(path.join(root, 'no-such-folder'), undefined);
    assert.ok(!g.removed && /folder is not there/.test(g.why!));
    assert.ok(!new NotesFile().remove('relative/path', undefined).removed, 'a relative path is refused');
  });
  await test('remove: the source has no recursive delete', () => {
    const src = nodeFs.readFileSync(path.join(ROOT, 'src', 'main', 'notesfile.ts'), 'utf8');
    const body = src.slice(src.indexOf('  remove(folderPath'), src.indexOf('/**\n * One mirror cycle'));
    assert.ok(body.length > 500, 'found remove()');
    assert.ok(!/rmSync|recursive|rimraf/.test(body), 'remove() never deletes recursively');
  });

  await test('remove: .durbar swapped for a link after the unlink is never rmdir-ed through the link', async () => {
    if (!canLink) { skip('cannot make links here'); return; }
    const c = countingFs();
    const { folder, store } = await written();
    const outside = freshOut('outside-empty');
    c.hook.unlinkSync = (real, ...a) => { const r = real(...a); if (path.dirname(String(a[0])) === path.join(folder, '.durbar', 'notes')) { nodeFs.rmSync(path.join(folder, '.durbar'), { recursive: true }); nodeFs.symlinkSync(outside, path.join(folder, '.durbar'), 'dir'); } return r; };
    const r = new NotesFile({ fs: c.fs, now: tickClock }).remove(folder, await store.getMirror(folder), new NotesFile().ignoreId(folder));
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
      assert.strictEqual(f.inRepo(lk), true, 'a .git that is a link counts (review 2 of PR 931): the box shows');
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
    const r = rig({ repo: true });
    assert.deepStrictEqual(await r.ops.fileCount('a1'), { ok: true, count: 0, exists: false, strayText: 0, repo: true });
    nodeFs.mkdirSync(path.join(r.folder, '.durbar', 'notes'), { recursive: true });
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
    const r = rig({ repo: true });
    nodeFs.mkdirSync(path.join(r.folder, '.durbar', 'notes'), { recursive: true });
    const bad = FOUR + '<<<<<<< ours\nx\n=======\ny\n>>>>>>> theirs\n';
    nodeFs.writeFileSync(md(r.folder), bad);
    refusedWith(await r.ops.setFile('a1', true), COUNT_UNREADABLE, 'unreadable');
    assert.strictEqual(new FolderStore(r.foldersFile).load().find((f) => f.workspace === r.folder)!.notesProject, undefined, 'still off on disk');
    assert.strictEqual(nodeFs.readFileSync(md(r.folder), 'utf8'), bad);
    assert.ok(!nodeFs.existsSync(path.join(r.folder, '.durbar', 'notes', '.gitignore')), 'no .gitignore written either');
  });
  await test('setFile on in a repository: the flag, .gitignore "*" before the first write, notes.md written, existing notes imported; turning on twice changes nothing', async () => {
    const r = rig({ repo: true });
    okOf(await r.ops.add('a1', { text: 'Mine from Durbar' }));
    nodeFs.mkdirSync(path.join(r.folder, '.durbar', 'notes'), { recursive: true });
    nodeFs.writeFileSync(md(r.folder), FOUR);
    const order: string[] = [];
    const c = countingFs();
    c.hook.openSync = (real, ...a) => { const p = String(a[0]); if (p.endsWith('.gitignore')) order.push('ignore'); else if (p.endsWith('.tmp')) order.push('temp'); return real(...a); };
    const ops = new NotesOps({ ...(r.ops as unknown as { d: ConstructorParameters<typeof NotesOps>[0] }).d, file: () => new NotesFile({ fs: c.fs, now: tickClock }) });
    asked.length = 0;
    const res = okOf(await ops.setFile('a1', true));
    assert.deepStrictEqual([res.on, res.message, asked], [true, undefined, ['on']]);
    assert.strictEqual(res.file?.error, undefined, JSON.stringify(res.file));
    assert.ok(order.indexOf('ignore') >= 0 && order.indexOf('ignore') < order.indexOf('temp'), `the .gitignore comes before the first write: ${order.join()}`);
    assert.strictEqual(nodeFs.readFileSync(path.join(r.folder, '.durbar', 'notes', '.gitignore'), 'utf8'), '*\n');
    assert.strictEqual(new FolderStore(r.foldersFile).load().find((f) => f.workspace === r.folder)!.notesProject, true, 'saved and read back');
    assert.deepStrictEqual(nodeFs.readdirSync(path.dirname(r.folder)).filter((n) => n !== 'proj' && n !== '.git' && n !== 'userdata' && n !== 'team.code-workspace'), [], 'nothing written outside the folder');
    const notes = okOf(await ops.list('a1')).notes;
    assert.strictEqual(notes.filter((n) => n.from === 'file').length, 4, 'the 4 notes of the file, From the project file');
    const text = nodeFs.readFileSync(md(r.folder), 'utf8');
    assert.ok(text.includes('Mine from Durbar') && text.includes('## four'), 'the file now mirrors every note');
    assert.deepStrictEqual(okOf(await ops.list('a1')).fileSwitch, { on: true });
    assert.strictEqual(okOf(await ops.setFile('a1', true)).message, undefined, 'turning on twice says nothing and asks nothing more');
    assert.deepStrictEqual(asked, ['on']);
  });
  await test('the choice for git: its own native box, no .gitignore, only Durbar\'s own is removed; Cancel changes nothing', async () => {
    let say = false;
    const r = rig({ repo: true, confirm: () => say });
    asked.length = 0;
    refusedWith(await r.ops.setFile('a1', true, { git: true }), NATIVE_CANCELLED, 'Cancel');
    assert.deepStrictEqual(asked, ['git']);
    assert.ok(!nodeFs.existsSync(path.join(r.folder, '.durbar')) && !r.folders.get(r.folder)!.notesProject, 'nothing written, no flag');
    say = true;
    okOf(await r.ops.setFile('a1', true)); // first the ignoring way
    assert.ok(nodeFs.existsSync(path.join(r.folder, '.durbar', 'notes', '.gitignore')));
    okOf(await r.ops.setFile('a1', false, { deleteFile: false }));
    const git = okOf(await r.ops.setFile('a1', true, { git: true }));
    assert.strictEqual(git.message, 'Removed Durbar\'s .gitignore: git no longer ignores .durbar/notes.', JSON.stringify(git));
    assert.deepStrictEqual(nodeFs.readdirSync(path.join(r.folder, '.durbar', 'notes')), ['notes.md'], 'no .gitignore, no recreation by the cycle');
    assert.strictEqual(r.folders.get(r.folder)!.notesProject, 'git');
    okOf(await r.ops.add('a1', { text: 'later' }));
    await r.ops.syncFile('a1');
    assert.ok(!nodeFs.existsSync(path.join(r.folder, '.durbar', 'notes', '.gitignore')) && nodeFs.readFileSync(md(r.folder), 'utf8').includes('later'), 'later cycles keep writing without one');
    // a .gitignore the person made is not Durbar's: it stays, and its owner decides
    const q = rig({ repo: true });
    nodeFs.mkdirSync(path.join(q.folder, '.durbar', 'notes'), { recursive: true });
    nodeFs.writeFileSync(path.join(q.folder, '.durbar', 'notes', '.gitignore'), 'mine\n');
    const own = okOf(await q.ops.setFile('a1', true, { git: true }));
    assert.strictEqual(own.message, NOT_OURS);
    assert.strictEqual(nodeFs.readFileSync(path.join(q.folder, '.durbar', 'notes', '.gitignore'), 'utf8'), 'mine\n');
  });
  await test('turning on starts from nothing: the hash of an earlier import and the mirror of an earlier file are forgotten', async () => {
    const r = rig();
    okOf(await r.ops.setFile('a1', true));
    nodeFs.appendFileSync(md(r.folder), '\n<!-- durbar-note -->\n## by hand\n\nan idea\n');
    await r.ops.syncFile('a1');
    assert.ok(await r.store.getFileImport(r.folder), 'the import is remembered while on');
    okOf(await r.ops.setFile('a1', false, { deleteFile: false }));
    nodeFs.rmSync(path.join(r.folder, '.durbar'), { recursive: true }); // the test's own folder
    okOf(await r.ops.setFile('a1', true));
    assert.strictEqual(await r.store.getFileImport(r.folder), undefined, 'the old import hash is gone');
    assert.notStrictEqual((await r.store.getMirror(r.folder))?.sha256, undefined);
  });
  await test('only a .gitignore Durbar made is recorded as its own and deleted: turn-on records it, a shipped "*" is not recorded, Keep in git and Delete the file leave a shipped one', async () => {
    const r = rig({ repo: true });
    okOf(await r.ops.setFile('a1', true));
    assert.strictEqual(r.folders.get(r.folder)!.notesIgnoreOwn, r.file.ignoreId(r.folder), 'made by Durbar: its identity is recorded');
    okOf(await r.ops.setFile('a1', false, { deleteFile: true }));
    assert.ok(!nodeFs.existsSync(path.join(r.folder, '.durbar')) && r.folders.get(r.folder)!.notesIgnoreOwn === undefined, 'deleted with the folder, record cleared');
    const q = rig({ repo: true });
    nodeFs.mkdirSync(path.join(q.folder, '.durbar', 'notes'), { recursive: true });
    nodeFs.writeFileSync(path.join(q.folder, '.durbar', 'notes', '.gitignore'), '*\n'); // shipped by the repository
    okOf(await q.ops.setFile('a1', true));
    assert.strictEqual(q.folders.get(q.folder)!.notesIgnoreOwn, undefined, 'a shipped file is not recorded as Durbar\'s');
    const off = okOf(await q.ops.setFile('a1', false, { deleteFile: true }));
    assert.ok(nodeFs.existsSync(path.join(q.folder, '.durbar', 'notes', '.gitignore')) && off.message!.startsWith('Deleted .durbar/notes/notes.md.'), `kept: ${off.message}`);
    const g = rig({ repo: true });
    nodeFs.mkdirSync(path.join(g.folder, '.durbar', 'notes'), { recursive: true });
    nodeFs.writeFileSync(path.join(g.folder, '.durbar', 'notes', '.gitignore'), '*\n');
    assert.strictEqual(okOf(await g.ops.setFile('a1', true, { git: true })).message, NOT_OURS);
    assert.ok(nodeFs.existsSync(path.join(g.folder, '.durbar', 'notes', '.gitignore')), 'Keep in git does not delete a shipped file');
  });
  await test('the flag for a .gitignore Durbar made is tied to that file: a re-clone or branch with its own tracked "*" is never deleted; the record is cleared after Keep in git and survives a restart', async () => {
    const r = rig({ repo: true });
    okOf(await r.ops.setFile('a1', true));
    const mine = r.folders.get(r.folder)!.notesIgnoreOwn!;
    assert.ok(/^\d+:\d+/.test(mine));
    assert.strictEqual(new FolderStore(r.foldersFile).load().find((f) => f.workspace === r.folder)!.notesIgnoreOwn, mine, 'kept across a restart');
    okOf(await r.ops.setFile('a1', false, { deleteFile: false })); // Leave the file: the record stays
    // the repository's own tracked .gitignore replaces it (a checkout writes a new file)
    const ig = path.join(r.folder, '.durbar', 'notes', '.gitignore');
    nodeFs.unlinkSync(ig);
    nodeFs.writeFileSync(ig, '*\n');
    nodeFs.writeFileSync(path.join(r.folder, '.durbar', 'notes', 'spacer'), 'x');
    if (r.file.ignoreId(r.folder) === mine) { skip('this file system gave the new file the old identity within the same tick (spec 083 known gap)'); return; }
    assert.strictEqual(okOf(await r.ops.setFile('a1', true, { git: true })).message, NOT_OURS);
    assert.ok(nodeFs.existsSync(ig), 'the repository\'s file stays');
    // the real sequence: Durbar's own file is deleted by Keep in git and the record is cleared
    const q = rig({ repo: true });
    okOf(await q.ops.setFile('a1', true));
    okOf(await q.ops.setFile('a1', false, { deleteFile: false }));
    assert.strictEqual(okOf(await q.ops.setFile('a1', true, { git: true })).message, 'Removed Durbar\'s .gitignore: git no longer ignores .durbar/notes.');
    assert.strictEqual(q.folders.get(q.folder)!.notesIgnoreOwn, undefined, 'record cleared after the delete');
    assert.strictEqual(new FolderStore(q.foldersFile).load().find((f) => f.workspace === q.folder)!.notesIgnoreOwn, undefined);
    for (const bad of ['true', '1', '"a:b"', '"1:2:3:4"', 'null']) assert.strictEqual(parseSavedFolders(`{"folders":[{"workspace":${JSON.stringify(path.join(r.folder, 'p'))},"notesIgnoreOwn":${bad}}]}`)[0].notesIgnoreOwn, undefined, bad);
  });
  await test('setFile: only an agent id, a boolean and two yes/no options; a path from the window is never used', async () => {
    const r = rig();
    const elsewhere = fresh('elsewhere');
    for (const [on, opts, what] of [
      ['true', undefined, 'on as text'], [1, undefined, 'on as a number'], [true, { path: elsewhere }, 'a path option'], [true, { folder: elsewhere, git: true }, 'a folder option'],
      [true, { git: 'yes' }, 'git as text'], [true, { exclude: true }, 'the old exclude option'], [false, { deleteFile: 1 }, 'deleteFile as a number'], [true, { deleteFile: true }, 'delete while turning on'],
      [false, { git: true }, 'git while turning off'], [true, JSON.parse('{"__proto__":{"git":true}}'), '__proto__'], [true, [true], 'an array'], [true, 'git', 'a string'],
    ] as [unknown, unknown, string][]) refusedWith(await r.ops.setFile('a1', on, opts), /./, what);
    refusedWith(await r.ops.setFile(elsewhere, true), /chat is not open/, 'a path as the agent id');
    refusedWith(await r.ops.setFile('w1', true), SWITCH_WORKSPACE, 'a .code-workspace');
    refusedWith(await r.ops.setFile('g1', true), SWITCH_MISSING, 'a missing folder');
    assert.ok(!nodeFs.existsSync(path.join(elsewhere, '.durbar')) && !nodeFs.existsSync(path.join(r.folder, '.durbar')), 'nothing written anywhere');
    assert.ok(r.folders.list().every((f) => !f.notesProject), 'no flag set');
  });
  await test('setFile off: Leave keeps the file and says so; later changes write nothing', async () => {
    const r = rig({ repo: true });
    okOf(await r.ops.setFile('a1', true));
    const before = nodeFs.readFileSync(md(r.folder), 'utf8');
    const off = okOf(await r.ops.setFile('a1', false, { deleteFile: false }));
    assert.strictEqual(off.on, false);
    assert.ok(off.message!.includes('left in the project'), off.message);
    assert.strictEqual(new FolderStore(r.foldersFile).load().find((f) => f.workspace === r.folder)!.notesProject, undefined, 'off on disk');
    okOf(await r.ops.add('a1', { text: 'after off' }));
    r.timers.splice(0).forEach((f) => f());
    await r.ops.syncFile('a1');
    assert.strictEqual(nodeFs.readFileSync(md(r.folder), 'utf8'), before, 'not written after off');
    assert.deepStrictEqual(okOf(await r.ops.list('a1')).fileSwitch, { on: false });
  });
  await test('setFile off: Delete removes the file Durbar wrote, keeps an edited one, and waits for a cycle in flight', async () => {
    const r = rig({ repo: true });
    okOf(await r.ops.setFile('a1', true));
    const del = okOf(await r.ops.setFile('a1', false, { deleteFile: true }));
    assert.ok(del.message!.startsWith('Deleted .durbar/notes/notes.md and the empty .durbar/notes folder.'), del.message);
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
    assert.strictEqual(new FolderStore(r.foldersFile).load().find((f) => f.workspace === r.folder)!.notesProject, undefined, 'the last answer (off) is what is saved');
    assert.deepStrictEqual(okOf(await r.ops.list('a1')).fileSwitch, { on: false });
    const [c2, d2] = await Promise.all([r.ops.setFile('a1', false), r.ops.setFile('a1', true)]);
    assert.ok(okOf(c2).on === false && okOf(d2).on === true);
    assert.strictEqual(new FolderStore(r.foldersFile).load().find((f) => f.workspace === r.folder)!.notesProject, true, 'off then on: on');
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
    assert.ok(!nodeFs.existsSync(path.join(r.folder, '.durbar')) && !r.folders.get(r.folder)!.notesProject, 'off, nothing written');
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
      const outside = freshOut('outside');
      nodeFs.writeFileSync(path.join(outside, 'notes', 'notes.md'), 'someone else\'s different bytes\n');
      const ino = nodeFs.statSync(path.join(outside, 'notes', 'notes.md'), { bigint: true }).ino;
      const aside = path.join(path.dirname(folder), 'aside');
      let done = false;
      const swap = (): void => { if (done) return; done = true; nodeFs.renameSync(path.join(folder, '.durbar'), aside); nodeFs.symlinkSync(outside, path.join(folder, '.durbar'), 'dir'); };
      if (when === 'rename') c.hook.renameSync = (real, ...a) => { if (String(a[0]) === md(folder)) swap(); return real(...a); };
      else c.hook.unlinkSync = (real, ...a) => { swap(); return real(...a); };
      const r = new NotesFile({ fs: c.fs, now: tickClock }).remove(folder, await store.getMirror(folder), new NotesFile().ignoreId(folder));
      assert.strictEqual(r.removed, false, `${when}: ${JSON.stringify(r)}`);
      const left = nodeFs.readdirSync(path.join(outside, 'notes')).map((n) => nodeFs.statSync(path.join(outside, 'notes', n), { bigint: true }).ino);
      assert.ok(left.includes(ino), `${when}: the outside file still exists (${nodeFs.readdirSync(path.join(outside, 'notes')).join()})`);
      if (when === 'rename') assert.ok(nodeFs.existsSync(path.join(outside, 'notes', 'notes.md')), 'renamed back');
      assert.ok(nodeFs.readdirSync(aside).length === 1, `${when}: Durbar's own file is kept (maybe under the random name)`);
    }
    // the sequence the real swapper found: the rename lands outside, .durbar looks real for its check, the read goes outside again
    // (identical bytes), the unlink too. Only the real-path check of the random name stops it.
    {
      const c = countingFs();
      const { folder, store } = await written();
      const outside = freshOut('outside3');
      nodeFs.copyFileSync(md(folder), path.join(outside, 'notes', 'notes.md'));
      const ino = nodeFs.statSync(path.join(outside, 'notes', 'notes.md'), { bigint: true }).ino;
      const d = path.join(folder, '.durbar'), aside = path.join(path.dirname(folder), 'aside3');
      let state: 'real' | 'link' = 'real', phase = 0;
      const toLink = (): void => { if (state === 'link') return; nodeFs.renameSync(d, aside); nodeFs.symlinkSync(outside, d, 'dir'); state = 'link'; };
      const toReal = (): void => { if (state === 'real') return; nodeFs.unlinkSync(d); nodeFs.renameSync(aside, d); state = 'real'; };
      c.hook.renameSync = (real, ...a) => { if (String(a[0]) === md(folder) && phase === 0) { toLink(); phase = 1; } return real(...a); };
      c.hook.lstatSync = (real, ...a) => { if (phase === 1 && String(a[0]) === d) toReal(); return real(...a); };
      c.hook.openSync = (real, ...a) => { if (phase === 1 && String(a[0]).endsWith('.del')) { toLink(); phase = 2; } return real(...a); };
      const r = new NotesFile({ fs: c.fs, now: tickClock }).remove(folder, await store.getMirror(folder), new NotesFile().ignoreId(folder));
      assert.ok(phase === 2 && !r.removed, `the sequence ran and nothing was deleted: ${JSON.stringify(r)}`);
      assert.ok(nodeFs.readdirSync(path.join(outside, 'notes')).map((n) => nodeFs.statSync(path.join(outside, 'notes', n), { bigint: true }).ino).includes(ino), 'the outside file still exists');
    }
    // a real swapper in another process, bounded. Issue #1463: the outside file has OTHER bytes than Durbar's here, so a delete may
    // move it (C, counted) but must never delete or overwrite it (A needs Durbar's own bytes and is pinned by the deterministic test
    // below; B is closed). The test's own bookkeeping never goes through `.durbar` by name: only the project's `.durbar` is ever at
    // `real` (the swapper's side name), so a call through `real` that succeeds is in the project; it retries while the swapper has it
    // back at `.durbar`. (Before, the loop did an lstat of `.durbar` and then a write by name, which raced the swapper and wrote into
    // the other folder: that mis-reported its own write as a lost outside file.)
    if (!posix) { skip('the swapper process uses POSIX renames over links'); return; }
    const { folder, store } = await written();
    const mirror = await store.getMirror(folder);
    const bytes = nodeFs.readFileSync(md(folder));
    const outside = freshOut('outside2');
    const outNotes = path.join(outside, 'notes'), outMd = path.join(outNotes, 'notes.md');
    const outBytes = Buffer.from('someone else\'s notes.md: not the bytes Durbar wrote\n');
    nodeFs.writeFileSync(outMd, outBytes);
    let ino = nodeFs.statSync(outMd, { bigint: true }).ino;
    const real = path.join(path.dirname(folder), 'real-durbar');
    const stop = path.join(path.dirname(folder), 'stop');
    const ended = path.join(path.dirname(folder), 'swapper-ended'); // the swapper writes it after putting .durbar back for good
    const code = `const fs=require('fs');const [d,real,out,stop]=process.argv.slice(1);const end=Date.now()+60000;let n=0;process.stdout.write('R');
      while(!fs.existsSync(stop)&&Date.now()<end){try{fs.renameSync(d,real);fs.symlinkSync(out,d,'dir');for(let k=0;k<(n%7)*4;k++)fs.statSync(out);fs.unlinkSync(d);fs.renameSync(real,d);for(let k=0;k<(n%5)*40;k++)fs.statSync(d);n++;}catch(e){try{if(!fs.existsSync(d)&&fs.existsSync(real))fs.renameSync(real,d);}catch(_){}}}
      try{if(fs.lstatSync(d).isSymbolicLink())fs.unlinkSync(d);}catch(_){}try{if(fs.existsSync(real))fs.renameSync(real,d);}catch(_){}fs.writeFileSync(process.argv[5],'');process.stdout.write(String(n));`;
    nodeFs.writeFileSync(path.join(folder, '.durbar', 'notes', 'keep.txt'), 'keeps .durbar from being removed when empty');
    const child = spawn(process.execPath, ['-e', code, path.join(folder, '.durbar'), real, outside, stop, ended], { stdio: ['ignore', 'pipe', 'ignore'] });
    let swaps = '';
    child.stdout.on('data', (b) => { swaps += String(b); });
    let gone = false;
    const exited = new Promise<void>((res) => child.on('exit', () => { gone = true; res(); }));
    await new Promise<void>((res) => { const t = (): void => { if (swaps.includes('R')) res(); else setImmediate(t); }; t(); }); // the swapper runs
    const code0 = (e: unknown): unknown => (e as { code?: unknown }).code;
    /** `fn` on the project's notes folder through `real`, retried while the swapper has it at `.durbar` (ENOENT of the folder); once the
     * swapper has ended, `real` never comes back, so that ends the wait (review of PR 1465, M2: a stopped swapper made this spin). */
    const viaReal = <T>(fn: (dir: string) => T): T => {
      for (let i = 0; ; i++) {
        try { return fn(path.join(real, 'notes')); } catch (e) {
          if (code0(e) !== 'ENOENT' || i > 10_000_000) throw e;
          if (i % 64 === 0 && nodeFs.existsSync(ended)) throw new Error('the swapper process ended before the run did');
        }
      }
    };
    // how many attempts reached the delete's first rename (the race window); reported, not asserted (review of PR 1465, M2)
    let reached = 0;
    const sf = countingFs();
    sf.hook.renameSync = (realRename, ...a) => { if (path.basename(String(a[0])) === 'notes.md' && String(a[1]).endsWith('.del')) reached++; return realRename(...a); };
    const f = new NotesFile({ fs: sf.fs, now: tickClock });
    // review 3 of PR 931: a fixed, bounded number of attempts; the splits are REPORTED, not asserted (they are chance, FR-048b).
    // The proof is the deterministic hook tests; this run shows that a real racing process never deletes or overwrites an outside file.
    const MAX_ATTEMPTS = 20000;
    let attempts = 0, deleted = 0, wholly = 0, intoProject = 0, outOfProject = 0, lost = 0;
    for (let i = 0; i < MAX_ATTEMPTS && !gone; i++) {
      attempts++;
      try { viaReal((d) => nodeFs.writeFileSync(path.join(d, 'notes.md'), bytes, { flag: 'wx' })); } catch (e) { if (code0(e) !== 'EEXIST') throw e; }
      // the test writes Durbar's bytes itself, in a new inode: the mirror names that inode, as after Durbar's own write
      const ownId = viaReal((d) => { const st = nodeFs.lstatSync(path.join(d, 'notes.md'), { bigint: true }); return `${st.dev}:${st.ino}`; });
      if (f.remove(folder, { ...mirror!, id: ownId }).removed) deleted++;
      sf.calls.length = 0;
      // where the outside file is now. Only remove() moves files, and it has returned, so the listings below are stable.
      let outName: string | undefined;
      for (const n of nodeFs.readdirSync(outNotes)) {
        const at = path.join(outNotes, n);
        if (nodeFs.lstatSync(at, { bigint: true }).ino !== ino) { outOfProject++; nodeFs.unlinkSync(at); continue; } // Durbar's file landed here (old name looked up in the project, new one outside): the test's own bytes, dropped
        if (outName === undefined || n === 'notes.md') { if (outName !== undefined) nodeFs.unlinkSync(path.join(outNotes, outName)); outName = n; } else nodeFs.unlinkSync(at); // a second name of the outside file
      }
      if (outName === 'notes.md') { /* untouched */ } else if (outName !== undefined) {
        wholly++; nodeFs.renameSync(path.join(outNotes, outName), outMd); // renamed inside the other folder (both names looked up through the link): put back
      } else {
        // every lstat throws (never `inoOf`, which turns an error into `undefined`): the swapper can move `real` back to `.durbar` between
        // the listing and an lstat, and a swallowed ENOENT read as "not here" counted a C as lost, and the cleanup below then deleted it
        const here = viaReal((d) => nodeFs.readdirSync(d).find((n) => nodeFs.lstatSync(path.join(d, n), { bigint: true }).ino === ino));
        if (here !== undefined) { intoProject++; viaReal((d) => nodeFs.renameSync(path.join(d, here), outMd)); } // C: moved into the project: put back
        else { lost++; nodeFs.writeFileSync(outMd, outBytes); ino = nodeFs.statSync(outMd, { bigint: true }).ino; } // deleted or overwritten: must never happen
      }
      // Durbar's own file left under a random name in the project (a refused delete): dropped, so the next attempt starts clean
      // only a `.del` file that a strict lstat shows is not the outside file (a throw is retried by viaReal); the outside file is never deleted here
      viaReal((d) => { for (const n of nodeFs.readdirSync(d)) if (n.endsWith('.del') && nodeFs.lstatSync(path.join(d, n), { bigint: true }).ino !== ino) nodeFs.unlinkSync(path.join(d, n)); });
      if (i % 50 === 0) await new Promise((res) => setImmediate(res));
    }
    nodeFs.writeFileSync(stop, '');
    await exited;
    console.log(`  (swapper: ${swaps.replace('R', '')} swaps; ${attempts} delete attempts (${reached} reached the first rename), ${deleted} deletes of Durbar's own file; the outside file: ${wholly} renamed inside its own folder, ${intoProject} moved into the project (C, [KNOWN GAP]); Durbar's file moved into the other folder ${outOfProject} times; each put back by the test)`);
    assert.ok(swaps.startsWith('R'), 'the swapper process ran');
    assert.strictEqual(lost, 0, `the outside file was never deleted or overwritten (lost ${lost} times in ${attempts} deletes and ${swaps} swaps)`);
    assert.deepStrictEqual([nodeFs.readFileSync(outMd), inoOf(outMd)], [outBytes, ino], 'the outside file is there with its own bytes');
  });
  await test('issue 1463: a rename split across folders by a swapped .durbar (A, B, C), against the real NotesFile', async () => {
    // rename(2) and link(2) look up the old and the new name separately; the hooks below do what a .durbar swapped between the two
    // lookups does, deterministically. Spec 083 Changes 2026-11-10.
    const setup = async (outBytes: 'same' | Buffer) => {
      const c = countingFs();
      const { folder, store } = await written();
      const outside = freshOut('outsideS');
      const outMd = path.join(outside, 'notes', 'notes.md');
      if (outBytes === 'same') nodeFs.copyFileSync(md(folder), outMd); else nodeFs.writeFileSync(outMd, outBytes);
      return { c, folder, store, outside, outMd, outIno: nodeFs.statSync(outMd, { bigint: true }).ino, ownIno: nodeFs.statSync(md(folder), { bigint: true }).ino, mirror: await store.getMirror(folder) };
    };
    const projDir = (folder: string): string => path.join(folder, '.durbar', 'notes');
    // C: the delete's rename looks up notes.md through the link (the other folder) and its random name in the project
    {
      const t = await setup(Buffer.from('another folder\'s notes\n'));
      let name = '';
      t.c.hook.renameSync = (real, ...a) => { if (String(a[0]) === md(t.folder)) { name = path.basename(String(a[1])); return real(t.outMd, a[1]); } return real(...a); };
      const r = new NotesFile({ fs: t.c.fs, now: tickClock }).remove(t.folder, t.mirror);
      assert.ok(name && !r.removed, `C: not deleted: ${JSON.stringify(r)}`);
      assert.strictEqual(inoOf(path.join(projDir(t.folder), name)), t.outIno, 'C [KNOWN GAP]: the other folder\'s file is now in the project under the random name');
      assert.ok(!nodeFs.existsSync(t.outMd), 'C: it is gone from its own folder');
      assert.strictEqual(inoOf(md(t.folder)), t.ownIno, 'C: Durbar\'s own notes.md stays');
      assert.ok(r.why?.includes(name), `C: the answer names ${name}: ${r.why}`);
    }
    // A: the same split, and the other folder's file holds exactly Durbar's bytes. Closed where the mirror has the inode Durbar wrote
    // (mirror.id, spec 083 Changes 2026-11-10): the file under the random name is not that inode, so it is kept, not deleted
    {
      const t = await setup('same');
      assert.ok(idHolds(t.mirror?.id, t.ownIno), `the mirror holds the inode Durbar wrote: ${JSON.stringify(t.mirror)}`);
      let name = '';
      t.c.hook.renameSync = (real, ...a) => { if (String(a[0]) === md(t.folder)) { name = path.basename(String(a[1])); return real(t.outMd, a[1]); } return real(...a); };
      const r = new NotesFile({ fs: t.c.fs, now: tickClock }).remove(t.folder, t.mirror);
      assert.ok(!r.removed && inoOf(path.join(projDir(t.folder), name)) === t.outIno, `A: refused, kept under the random name: ${JSON.stringify(r)}`);
      assert.strictEqual(r.why, `Durbar did not delete .durbar/notes/notes.md: the file under its random name is not the one Durbar wrote (.durbar changed while it was being deleted); the file is kept as ${name} in .durbar/notes; another notes.md is there.`);
      assert.strictEqual(inoOf(md(t.folder)), t.ownIno, 'A: Durbar\'s own notes.md is still in the project');
      assert.ok(!nodeFs.existsSync(t.outMd), 'A, now C [KNOWN GAP]: the other folder\'s file is moved into the project (not deleted)');
    }
    // A with a mirror without the inode (an older version wrote it, or a drive without inode numbers): the hash only, the gap stays
    {
      const t = await setup('same');
      const { id: _id, ...old } = t.mirror!;
      void _id;
      t.c.hook.renameSync = (real, ...a) => (String(a[0]) === md(t.folder) ? real(t.outMd, a[1]) : real(...a));
      const r = new NotesFile({ fs: t.c.fs, now: tickClock }).remove(t.folder, old);
      assert.strictEqual(r.removed, true, `A without mirror.id [KNOWN GAP]: the delete reports done: ${JSON.stringify(r)}`);
      assert.deepStrictEqual(nodeFs.readdirSync(path.join(t.outside, 'notes')), [], 'A without mirror.id [KNOWN GAP]: the other folder\'s file (Durbar\'s bytes) is deleted');
      assert.strictEqual(inoOf(md(t.folder)), t.ownIno, 'A without mirror.id: Durbar\'s own notes.md is still in the project');
    }
    // the same bytes in another inode (a git checkout or a restore rewrote it): left as changed, nothing renamed
    {
      const t = await setup(Buffer.from('unused\n'));
      const tmp = path.join(projDir(t.folder), 'restored');
      nodeFs.copyFileSync(md(t.folder), tmp);
      nodeFs.renameSync(tmp, md(t.folder));
      const r = new NotesFile({ fs: t.c.fs, now: tickClock }).remove(t.folder, t.mirror);
      assert.deepStrictEqual(r, { removed: false, dirRemoved: false, why: REMOVE_CHANGED }, 'same bytes, another inode: refused as changed');
      assert.ok(nodeFs.existsSync(md(t.folder)) && !t.c.calls.some((x) => x.m === 'renameSync'), 'nothing renamed');
    }
    // M1 (review of PR 1465): the way back's hard link splits: it makes notes.md in the other folder (which had none) and the project
    // ends with none. The random name is kept (it is the only name of the file in the project) and the answer says so.
    {
      const t = await setup(Buffer.from('x\n'));
      nodeFs.unlinkSync(t.outMd);
      let doomed = '';
      t.c.hook.unlinkSync = (real, ...a) => { if (String(a[0]).endsWith('.del') && !doomed) { doomed = String(a[0]); throw Object.assign(new Error('perm'), { code: 'EPERM' }); } return real(...a); };
      t.c.hook.linkSync = (real, ...a) => real(a[0], t.outMd);
      const r = new NotesFile({ fs: t.c.fs, now: tickClock }).remove(t.folder, t.mirror);
      const n = path.basename(doomed);
      assert.ok(doomed && !r.removed && !nodeFs.existsSync(md(t.folder)), JSON.stringify(r));
      assert.strictEqual(inoOf(doomed), t.ownIno, 'M1: the random name is kept: the project still has the file');
      assert.strictEqual(r.why, `Durbar did not delete .durbar/notes/notes.md: it could not be deleted (EPERM); the file is kept as ${n} in .durbar/notes, and Durbar could not confirm that notes.md is the same file: if there is no notes.md, renaming ${n} back to notes.md restores it; if there is, compare them before deleting ${n}.`);
    }
    // B: the way back after a failed unlink. The link looks up the random name through the link (ENOENT there); a rename back would
    // look up notes.md through the link too and replace the other folder's notes.md. There is no rename back any more.
    {
      const t = await setup(Buffer.from('another folder\'s notes, any content\n'));
      let doomed = '', renamedBack = false;
      t.c.hook.unlinkSync = (real, ...a) => { if (String(a[0]).endsWith('.del')) { doomed = String(a[0]); throw Object.assign(new Error('perm'), { code: 'EPERM' }); } return real(...a); };
      t.c.hook.linkSync = () => { throw Object.assign(new Error('no such file'), { code: 'ENOENT' }); };
      t.c.hook.renameSync = (real, ...a) => { if (String(a[0]).endsWith('.del')) { renamedBack = true; return real(a[0], t.outMd); } return real(...a); };
      const r = new NotesFile({ fs: t.c.fs, now: tickClock }).remove(t.folder, t.mirror);
      assert.ok(doomed && !r.removed, JSON.stringify(r));
      assert.deepStrictEqual([inoOf(t.outMd), nodeFs.readFileSync(t.outMd, 'utf8')], [t.outIno, 'another folder\'s notes, any content\n'], 'B: the outside notes.md is not overwritten');
      assert.ok(!renamedBack, 'B: no rename back to notes.md');
      assert.strictEqual(inoOf(doomed), t.ownIno, 'B: Durbar\'s file is kept under its random name in .durbar/notes');
      assert.strictEqual(r.why, `Durbar did not delete .durbar/notes/notes.md: it could not be deleted (EPERM); the file is kept as ${path.basename(doomed)} in .durbar/notes: renaming it back to notes.md restores it.`);
    }
  });
  await test('mirror.id check on an inode above 2^53 (spec 083 Changes 2026-11-11): read as a bigint, the low bit counts', async () => {
    // an NTFS file ID such as 12947848929002475 is odd; as a number it reads ...476 and an endsWith check fails (Windows CI run 42932253989)
    const big = 12947848929002475n;
    assert.notStrictEqual(String(Number(big)), String(big), 'the premise: a number cannot hold it');
    const c = countingFs();
    c.hook.fstatSync = (real, ...a) => { const st = real(...a) as { ino: bigint }; return new Proxy(st, { get: (t, k) => (k === 'ino' ? big : (t as never)[k]) }); };
    const { folder, store } = await written(new NotesFile({ fs: c.fs, now: tickClock }));
    const id = (await store.getMirror(folder))?.id;
    assert.ok(id?.endsWith(`:${big}`), `the product keeps every digit: ${id}`);
    assert.ok(idHolds(id, big), 'the bigint compare holds');
    assert.ok(!idHolds(id, big + 1n) && !idHolds(id, big - 1n), 'a neighbour that differs only in the low bit does not');
  });
  await test('mirror.id (spec 083 Changes 2026-11-10): stored and read back; a document without it still reads; a malformed one is dropped', async () => {
    const { folder, store } = await written();
    const m = await store.getMirror(folder);
    assert.ok(m?.id && /^\d+:\d+$/.test(m.id) && idHolds(m.id, inoOf(md(folder))), JSON.stringify(m));
    const base = { version: 1, folderName: 'p', notes: [], tombstones: [] };
    const mir = { sha256: 'a'.repeat(64), bytes: 3, at: '2026-11-10T00:00:00.000Z' };
    const parsed = (mirror: unknown) => { const r = parseNotesDoc(JSON.stringify({ ...base, mirror })); assert.ok(r.ok, JSON.stringify(r)); return (r as { doc: { mirror?: unknown } }).doc.mirror; };
    assert.deepStrictEqual(parsed({ ...mir, id: '64769:1234' }), { ...mir, id: '64769:1234' }, 'kept');
    assert.deepStrictEqual(parsed(mir), mir, 'an older version\'s mirror reads, without id');
    for (const bad of ['1:2:3', 'x:1', '', 5, '1:'.padEnd(40, '9')]) assert.deepStrictEqual(parsed({ ...mir, id: bad }), mir, `a malformed id ${JSON.stringify(bad)} is dropped, the mirror kept`);
  });
  await test('Paco review of PR 1465 (T066): a hard link to the random name made after the read and before the unlink is refused, kept under the random name', async () => {
    if (!canHardLink) { skip('cannot make hard links here'); return; }
    // the read (readCapped) refuses a second link on its handle; this one is made right after it, at the realpath of the random name
    // (the next check), so only the one-link check right before the unlink can see it
    for (const at of ['notes.md', 'other'] as const) {
      for (const withId of [true, false]) {
        const c = countingFs();
        const { folder, store } = await written();
        const mirror = await store.getMirror(folder);
        const m = withId ? mirror : (({ id: _drop, ...rest }) => rest)(mirror as NonNullable<typeof mirror> & { id?: string });
        const before = nodeFs.readFileSync(md(folder));
        const other = at === 'notes.md' ? md(folder) : path.join(folder, 'other-name.md');
        let doomed = '';
        c.hook.realpathSync = (real, ...a) => { if (String(a[0]).endsWith('.del') && !doomed) { doomed = String(a[0]); nodeFs.linkSync(doomed, other); } return real(...a); };
        const r = new NotesFile({ fs: c.fs, now: tickClock }).remove(folder, m as typeof mirror, new NotesFile().ignoreId(folder));
        const tag = `(link at ${at}, mirror ${withId ? 'with' : 'without'} id)`;
        assert.ok(doomed, `the link was made after the read ${tag}`);
        assert.ok(!r.removed, `a doomed file with a second link is refused, not deleted ${tag}: ${JSON.stringify(r)}`);
        assert.ok(nodeFs.readFileSync(other).equals(before), `the other link's file is still there with its bytes ${tag}`);
        if (at === 'notes.md') {
          assert.ok(nodeFs.existsSync(doomed) && nodeFs.readFileSync(doomed).equals(before), `kept under the random name ${tag}`);
          assert.strictEqual(r.why, `Durbar did not delete .durbar/notes/notes.md: it changed while it was being deleted (it has another link); the file is kept as ${path.basename(doomed)} in .durbar/notes; another notes.md is there.`, `the answer names the random name ${tag}`);
        } else {
          // the way back links the random name to notes.md (none there now), confirms the inode and drops the random name
          assert.ok(nodeFs.readFileSync(md(folder)).equals(before) && !nodeFs.existsSync(doomed), `notes.md put back, the random name dropped ${tag}`);
          assert.strictEqual(r.why, 'Durbar did not delete .durbar/notes/notes.md: it changed while it was being deleted (it has another link).', tag);
        }
      }
    }
    // a drive that gives no usable link count: only that comparison is skipped (the gap the spec states), the rest still holds
    const c = countingFs();
    const { folder, store } = await written();
    c.hook.lstatSync = (real, ...a) => { const st = real(...a) as object; return String(a[0]).endsWith('.del') ? Object.assign(Object.create(Object.getPrototypeOf(st) as object) as object, st, { nlink: undefined }) : st; };
    const r = new NotesFile({ fs: c.fs, now: tickClock }).remove(folder, await store.getMirror(folder), new NotesFile().ignoreId(folder));
    assert.ok(r.removed && !nodeFs.existsSync(md(folder)), `no link count and no second link: deleted as before: ${JSON.stringify(r)}`);
  });
  await test('PR 931 review 2, points 5 and 6: the rename back never replaces a newer notes.md, and the message names the exact file', async () => {
    const c = countingFs();
    const { folder, store } = await written();
    let doomed = '';
    c.hook.unlinkSync = (real, ...a) => { if (String(a[0]).endsWith('.del')) { doomed = String(a[0]); nodeFs.writeFileSync(md(folder), 'a newer file\n'); throw Object.assign(new Error('perm'), { code: 'EPERM' }); } return real(...a); };
    const r = new NotesFile({ fs: c.fs, now: tickClock }).remove(folder, await store.getMirror(folder), new NotesFile().ignoreId(folder));
    assert.ok(!r.removed && doomed, JSON.stringify(r));
    assert.strictEqual(nodeFs.readFileSync(md(folder), 'utf8'), 'a newer file\n', 'the newer notes.md is kept');
    assert.ok(nodeFs.existsSync(doomed), 'the old one stays under its random name');
    assert.strictEqual(r.why, `Durbar did not delete .durbar/notes/notes.md: it could not be deleted (EPERM); the file is kept as ${path.basename(doomed)} in .durbar/notes; another notes.md is there.`);
    // no hard links on this file system (issue #1463, M3 of the review of PR 1465): never renamed back (a rename can replace another
    // folder's notes.md through a swapped .durbar); the bytes are copied into a NEW notes.md (O_CREAT | O_EXCL) and the random name goes
    for (const code of ['EPERM', 'ENOTSUP', 'EXDEV', 'ENOSYS']) {
      const c2 = countingFs();
      const w2 = await written();
      let doomed2 = '';
      c2.hook.unlinkSync = (real, ...a) => { if (String(a[0]).endsWith('.del') && !doomed2) { doomed2 = String(a[0]); throw Object.assign(new Error('perm'), { code: 'EPERM' }); } return real(...a); };
      c2.hook.linkSync = () => { throw Object.assign(new Error('nolinks'), { code }); };
      const before2 = nodeFs.readFileSync(md(w2.folder));
      const r2 = new NotesFile({ fs: c2.fs, now: tickClock }).remove(w2.folder, await w2.store.getMirror(w2.folder));
      assert.strictEqual(r2.why, 'Durbar did not delete .durbar/notes/notes.md: it could not be deleted (EPERM).', `no hard links (${code}): copied back`);
      assert.ok(nodeFs.readFileSync(md(w2.folder)).equals(before2) && !nodeFs.existsSync(doomed2), `no hard links (${code}): notes.md copied back with its bytes, the random name gone`);
      assert.ok(!c2.calls.some((x) => x.m === 'renameSync' && x.p.endsWith('.del')), 'no rename back');
    }
    // the copy never replaces a notes.md that appeared meanwhile (O_EXCL): the random name stays and the answer says so
    {
      const c3 = countingFs();
      const w3 = await written();
      let doomed3 = '';
      c3.hook.unlinkSync = (real, ...a) => { if (String(a[0]).endsWith('.del') && !doomed3) { doomed3 = String(a[0]); throw Object.assign(new Error('perm'), { code: 'EPERM' }); } return real(...a); };
      c3.hook.linkSync = () => { nodeFs.writeFileSync(md(w3.folder), 'a newer file\n'); throw Object.assign(new Error('nolinks'), { code: 'ENOTSUP' }); };
      const r3 = new NotesFile({ fs: c3.fs, now: tickClock }).remove(w3.folder, await w3.store.getMirror(w3.folder));
      assert.strictEqual(nodeFs.readFileSync(md(w3.folder), 'utf8'), 'a newer file\n', 'the copy does not replace a newer notes.md');
      assert.ok(nodeFs.existsSync(doomed3), 'the random name stays');
      assert.strictEqual(r3.why, `Durbar did not delete .durbar/notes/notes.md: it could not be deleted (EPERM); the file is kept as ${path.basename(doomed3)} in .durbar/notes; another notes.md is there.`);
    }
  });
  await test('a repository whose .git is a link still shows the choice for git (the box is only a question)', async () => {
    if (!canLink) { skip('cannot make links here'); return; }
    const r = rig({ repo: true });
    const base = path.dirname(r.folder);
    nodeFs.renameSync(path.join(base, '.git'), path.join(base, 'gitdir-real'));
    nodeFs.symlinkSync(path.join(base, 'gitdir-real'), path.join(base, '.git'), 'dir');
    assert.strictEqual(okOf(await r.ops.fileCount('a1')).repo, true, 'the dialog offers the box');
  });
  /** A folder on a real disk (os.tmpdir() may be tmpfs): /var/tmp on POSIX when it is there, else the OS temp folder. */
  /** Whether this file system records a birth time, asked of the OS directly (not of the code under test). */
  const hasBirth = (p: string): boolean => nodeFs.statSync(p, { bigint: true }).birthtimeNs > 86_400_000_000_000n;
  const diskRoot = ((): string => { const c = posix && nodeFs.existsSync('/var/tmp') ? '/var/tmp' : os.tmpdir(); return realOf(nodeFs.mkdtempSync(path.join(c, 'durbar-notesswitch-disk-'))); })();
  await test('PR 931 review 3, point 1: the identity tells a folder deleted and made again at the same path apart (birth time); a file added inside keeps it', async () => {
    // issue #1027: the rule is checked with chosen stat values, so no wait and no dependence on the disk's clock or birth-time support
    const dir = path.join(diskRoot, 'proj');
    nodeFs.mkdirSync(dir);
    const real = realOf(dir);
    let fake: { dev: bigint; ino: bigint; birthtimeNs: bigint } = { dev: 7n, ino: 42n, birthtimeNs: 1_700_000_000_000_000_000n };
    const fsx = { ...nodeFs, lstatSync: ((p: string, o?: unknown) => (p === real ? { ...fake, isDirectory: () => true } : (nodeFs.lstatSync as (a: string, b?: unknown) => unknown)(p, o))) } as never;
    const f = new NotesFile({ fs: fsx });
    const id1 = f.folderId(dir)!;
    fake = { ...fake, birthtimeNs: fake.birthtimeNs + 1_000_000n }; // deleted and made again 1 ms later, the inode number reused
    assert.ok(!NotesFile.sameFolder(id1, f.folderId(dir)!), 'the same inode with another birth time: not the same folder');
    fake = { ...fake, ino: 43n };
    assert.ok(!NotesFile.sameFolder(id1, f.folderId(dir)!), 'another inode: not the same folder');
    fake = { dev: 7n, ino: 42n, birthtimeNs: 1_700_000_000_000_000_000n }; // made again within the same tick (spec 083 point 6, known gap)
    assert.ok(NotesFile.sameFolder(id1, f.folderId(dir)!), 'the same inode and birth time: the same folder (the known same-tick gap)');
    assert.strictEqual(id1, '7:42:1700000000000000000', 'dev, inode and birth time');
    fake = { dev: 7n, ino: 42n, birthtimeNs: 0n }; // a file system with no birth time
    assert.strictEqual(f.folderId(dir), '7:42', 'no birth time: only device and inode');
    assert.ok(NotesFile.sameFolder('1:2', '1:2:3') && !NotesFile.sameFolder('1:2:3', '1:2:4') && !NotesFile.sameFolder('1:2', '9:2'), 'birth time compared only when both have it');
    // what needs no timing, on the real disk: a file added inside keeps the identity
    const g = new NotesFile();
    nodeFs.writeFileSync(path.join(dir, 'a.txt'), 'x');
    const r1 = g.folderId(dir)!;
    nodeFs.writeFileSync(path.join(dir, 'b.txt'), 'y');
    assert.ok(NotesFile.sameFolder(r1, g.folderId(dir)!), 'a file added inside: the same folder');
  });
  await test('PR 931 review 3, point 2: the identity is recorded at turn-on, so a folder replaced before the first write is not written into', async () => {
    let locked = false;
    const r = rig({ pending: () => locked });
    okOf(await r.ops.setFile('a1', true));
    const ff = await r.store.getFileFolder(r.folder);
    assert.ok(ff && NotesFile.sameFolder(ff, r.file.folderId(r.folder)!), 'recorded at turn-on');
    if (!hasBirth(r.folder)) { skip('no birth time here: a delete and re-create is not detected (spec 083 known gap)'); return; }
    // no write has happened since (as when the vault locked right after the box): no mirror, no file
    nodeFs.rmSync(path.join(r.folder, '.durbar'), { recursive: true });
    await r.store.setMirror(r.folder, 'proj', undefined);
    // another repository with its own notes.md is cloned to the same path: deleted and made again, not renamed aside
    nodeFs.rmSync(r.folder, { recursive: true }); // the test's own folder
    nodeFs.mkdirSync(path.join(r.folder, '.durbar', 'notes'), { recursive: true });
    const theirs = '# Notes\n\n<!-- durbar-note -->\n## their note\n\nfrom another repository\n';
    nodeFs.writeFileSync(md(r.folder), theirs);
    okOf(await r.ops.add('a1', { text: 'my private idea' }));
    const st = okOf(await r.ops.list('a1')).file;
    assert.deepStrictEqual(st, { error: 'This folder looks replaced, or its drive was remounted. Turn the switch off and on again to write .durbar/notes/notes.md here.' });
    assert.strictEqual(nodeFs.readFileSync(md(r.folder), 'utf8'), theirs, 'nothing written into the other folder');
    void locked;
  });
  await test('PR 931 review 3, points 4 and 5: the rename back never unlinks through a swapped link; when the second unlink fails both names are reported, notes.md is never unlinked by name', async () => {
    if (!canLink) { skip('cannot make links here'); return; }
    // 4: the rename lands outside; .durbar real for its check; a decoy with OTHER bytes under the random name here; the hash check
    // fails and the hard link back succeeds; then .durbar is a link again: nothing outside may be deleted
    {
      const c = countingFs();
      const { folder, store } = await written();
      const outside = freshOut('outside4');
      nodeFs.copyFileSync(md(folder), path.join(outside, 'notes', 'notes.md'));
      const ino = nodeFs.statSync(path.join(outside, 'notes', 'notes.md'), { bigint: true }).ino;
      const d = path.join(folder, '.durbar'), aside = path.join(path.dirname(folder), 'aside4');
      let state: 'real' | 'link' = 'real', phase = 0, doomed = '';
      const toLink = (): void => { if (state === 'link') return; nodeFs.renameSync(d, aside); nodeFs.symlinkSync(outside, d, 'dir'); state = 'link'; };
      const toReal = (): void => { if (state === 'real') return; nodeFs.unlinkSync(d); nodeFs.renameSync(aside, d); state = 'real'; };
      c.hook.renameSync = (real, ...a) => { if (String(a[0]) === md(folder) && phase === 0) { doomed = String(a[1]); toLink(); phase = 1; } return real(...a); };
      c.hook.lstatSync = (real, ...a) => { if (phase === 1 && String(a[0]) === d) { toReal(); nodeFs.renameSync(md(folder), doomed); nodeFs.writeFileSync(doomed, 'a decoy with other bytes\n'); phase = 2; } return real(...a); };
      c.hook.realpathSync = (real, ...a) => { if (phase === 3 && String(a[0]) === doomed) toLink(); return real(...a); };
      c.hook.linkSync = (real, ...a) => { const r = real(...a); phase = 3; return r; };
      const r = new NotesFile({ fs: c.fs, now: tickClock }).remove(folder, await store.getMirror(folder), new NotesFile().ignoreId(folder));
      assert.ok(phase === 3 && !r.removed, `the sequence ran: ${JSON.stringify(r)}`);
      assert.ok(nodeFs.readdirSync(path.join(outside, 'notes')).map((n) => nodeFs.statSync(path.join(outside, 'notes', n), { bigint: true }).ino).includes(ino), `the outside file still exists (${nodeFs.readdirSync(path.join(outside, 'notes')).join()})`);
      assert.ok(/Durbar could not confirm that notes\.md is the same file: if there is no notes\.md, renaming \.notes\.md\.\d+\.[a-z0-9]+\.del back to notes\.md restores it; if there is, compare them before deleting \.notes\.md\.\d+\.[a-z0-9]+\.del\.$/.test(r.why!), r.why);
    }
    // 5: every unlink of the random name fails (a Windows editor holds it): nothing unlinks notes.md; the answer names both names
    {
      const c = countingFs();
      const { folder, store } = await written();
      let doomed = '';
      c.hook.unlinkSync = (real, ...a) => { if (String(a[0]).endsWith('.del')) { doomed = String(a[0]); throw Object.assign(new Error('perm'), { code: 'EPERM' }); } return real(...a); };
      const r = new NotesFile({ fs: c.fs, now: tickClock }).remove(folder, await store.getMirror(folder), new NotesFile().ignoreId(folder));
      assert.ok(nodeFs.existsSync(md(folder)) && nodeFs.statSync(doomed).nlink === 2, 'two names of one file: notes.md and the random one');
      assert.ok(!c.calls.some((x) => x.m === 'unlinkSync' && x.p === md(folder)), 'notes.md is never unlinked by name');
      const n = path.basename(doomed);
      assert.strictEqual(r.why, `Durbar did not delete .durbar/notes/notes.md: it could not be deleted (EPERM); notes.md and ${n} are now two names of the same file: delete ${n} in .durbar/notes once nothing holds it.`);
    }
    // re-check of review 3: the rename lands outside through a link; .durbar swapped back (a decoy under the random name here, the other
    // folder's file put back under its name); the unlink of the random name fails; .durbar swapped to the link: the outside notes.md survives
    {
      const c = countingFs();
      const { folder, store } = await written();
      const outside = freshOut('outside5');
      nodeFs.writeFileSync(path.join(outside, 'notes', 'notes.md'), 'the other folder\'s own file\n');
      const ino = nodeFs.statSync(path.join(outside, 'notes', 'notes.md'), { bigint: true }).ino;
      const d = path.join(folder, '.durbar'), aside = path.join(path.dirname(folder), 'aside5');
      let state: 'real' | 'link' = 'real', phase = 0, doomed = '';
      const toLink = (): void => { if (state === 'link') return; nodeFs.renameSync(d, aside); nodeFs.symlinkSync(outside, d, 'dir'); state = 'link'; };
      const toReal = (): void => { if (state === 'real') return; nodeFs.unlinkSync(d); nodeFs.renameSync(aside, d); state = 'real'; };
      c.hook.renameSync = (real, ...a) => { if (String(a[0]) === md(folder) && phase === 0) { doomed = String(a[1]); toLink(); phase = 1; } return real(...a); };
      c.hook.lstatSync = (real, ...a) => {
        if (phase === 1 && String(a[0]) === d) {
          toReal();
          nodeFs.renameSync(path.join(outside, 'notes', path.basename(doomed)), path.join(outside, 'notes', 'notes.md')); // the other file back under its name
          nodeFs.renameSync(md(folder), doomed); // a decoy under the random name here, so the hard link back succeeds
          nodeFs.writeFileSync(doomed, 'a decoy\n');
          phase = 2;
        }
        return real(...a);
      };
      c.hook.unlinkSync = (real, ...a) => {
        if (String(a[0]).endsWith('.del')) { phase = 3; throw Object.assign(new Error('perm'), { code: 'EPERM' }); }
        if (phase === 3 && String(a[0]) === md(folder)) toLink(); // swapped right after any check, before an unlink by the name notes.md
        return real(...a);
      };
      const r = new NotesFile({ fs: c.fs, now: tickClock }).remove(folder, await store.getMirror(folder), new NotesFile().ignoreId(folder));
      assert.ok(phase === 3 && !r.removed, `the sequence ran: ${JSON.stringify(r)}`);
      assert.ok(nodeFs.existsSync(path.join(outside, 'notes', 'notes.md')) && nodeFs.statSync(path.join(outside, 'notes', 'notes.md'), { bigint: true }).ino === ino, 'the other folder\'s notes.md survives');
    }
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
    nodeFs.mkdirSync(path.join(r.folder, '.durbar', 'notes'), { recursive: true });
    const theirs = '# Notes\n\n<!-- durbar-note -->\n## their note\n\nfrom another repository\n';
    nodeFs.writeFileSync(md(r.folder), theirs);
    okOf(await r.ops.add('a1', { text: 'my private idea' }));
    assert.deepStrictEqual(okOf(await r.ops.list('a1')).file, { error: NOTES_REPLACED });
    assert.strictEqual(nodeFs.readFileSync(md(r.folder), 'utf8'), theirs, 'nothing written into the other folder');
    assert.ok(!okOf(await r.ops.list('a1')).notes.some((n) => n.title === 'their note'), 'and nothing imported from it');
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
    nodeFs.mkdirSync(path.join(r.folder, '.durbar', 'notes'), { recursive: true });
    nodeFs.writeFileSync(md(r.folder), 'my own plan\nline two\nline three\n');
    const c = okOf(await r.ops.fileCount('a1'));
    assert.deepStrictEqual([c.count, c.exists, c.strayText], [0, true, 3]);
  });
  await test('PR 931 Q2: a native box the page cannot answer, before turning on and before Delete', async () => {
    let say = false;
    const r = rig({ repo: true, confirm: () => say });
    asked.length = 0;
    refusedWith(await r.ops.setFile('a1', true), NATIVE_CANCELLED, 'Cancel in the native box');
    assert.deepStrictEqual(asked, ['on']);
    assert.ok(!nodeFs.existsSync(path.join(r.folder, '.durbar')) && !r.folders.get(r.folder)!.notesProject , 'nothing written, no flag');
    say = true;
    okOf(await r.ops.setFile('a1', true));
    say = false;
    refusedWith(await r.ops.setFile('a1', false, { deleteFile: true }), NATIVE_CANCELLED, 'Delete cancelled');
    assert.ok(nodeFs.existsSync(md(r.folder)) && r.folders.get(r.folder)!.notesProject === true, 'the file and the switch stay');
    okOf(await r.ops.setFile('a1', false)); // Leave needs no box
    const none = new NotesOps({ ...(r.ops as unknown as { d: ConstructorParameters<typeof NotesOps>[0] }).d, confirmNative: undefined });
    refusedWith(await none.setFile('a1', true), NATIVE_CANCELLED, 'no native box wired: refused');
  });

  // ---- main wiring and the channels (AC1, IPC) ----
  await test('main.ts reads and saves the flag through the folder list; the two channels are not open to the simulator', () => {
    const mainSrc = nodeFs.readFileSync(path.join(ROOT, 'src', 'main', 'main.ts'), 'utf8');
    assert.ok(/fileOn: \(key\) => !!folderStore\?\.get\(key\)\?\.notesProject/.test(mainSrc), 'fileOn reads notesProject');
    assert.ok(/setFileOn: \(key, on, git\) => folderStore\?\.setNotesFile\(key, on, git\) === true/.test(mainSrc), 'setFileOn saves it');
    assert.ok(!/fileOn: \(\) => false/.test(mainSrc), 'no longer off for every folder');
    assert.ok(/confirmNative: \(kind, name, count\) => nativeConfirm\(win, /.test(mainSrc), 'main asks with the native box (not the page)');
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
      const r = rig({ repo: true });
      register({ getOps: () => r.ops });
      const frame = { url: pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href };
      const app = { senderFrame: frame, sender: { mainFrame: frame } };
      const other = { senderFrame: { url: 'https://example.invalid/' }, sender: { mainFrame: { url: 'https://example.invalid/' } } };
      const call = async (e: unknown, ch: string, ...a: unknown[]): Promise<Record<string, unknown>> => (await handlers.get(ch)!(e, ...a)) as Record<string, unknown>;
      assert.deepStrictEqual(await call(app, 'notes:fileCount', 'a1'), { ok: true, count: 0, exists: false, strayText: 0, repo: true });
      const on = await call(app, 'notes:setFile', 'a1', true);
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
  nodeFs.rmSync(diskRoot, { recursive: true, force: true }); // the same for the disk-backed one
  if (failures) { console.log(`notes switch: ${failures} failed`); process.exitCode = 1; return; }
  if (!posix) console.log('  (Windows: link cases depend on the runner allowing symlinks)');
  console.log('notes switch: flag saved and read back, delete only what Durbar wrote (hash, links, rmdir), .gitignore before the first write, the choice for git, options and paths refused, channels app-only');
  process.exitCode = 0;
}
void main();

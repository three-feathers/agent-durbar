/**
 * Spec 083 T041 (FR-050..FR-054, issue 699): the `.durbar/notes.md` mirror in main (`src/main/notesfile.ts`), its import into the
 * store and the switch gate in `NotesOps`. `npm run test:notesfile`. Real temp folders under the OS temp folder and a counting fake
 * `fs` that can swap files between two checks; the FIFO cases run in a child process with a time limit, so a blocking open fails
 * this suite instead of hanging it. No Electron, no git process, no credits. Fake secrets are built at run time (push protection).
 */
import * as assert from 'assert';
import * as nodeFs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import type { AgentInfo } from '../src/shared/api';
import { CUT_LINE, NOTES_LIMITS, type Note } from '../src/shared/notes';
import { NOTES_MD_STRAY, NOTES_MD_UNREADABLE, parseNotesMd, writeNotesMd } from '../src/shared/notesmd';
import { COUNT_UNREADABLE, EXCLUDE_UNSAFE_NAME, NotesFile, escapeGitSegment, excludeLine, readCapped, syncNotesFile, type NotesFileFs } from '../src/main/notesfile';
import { NotesStore } from '../src/main/notesstore';
import { NotesOps } from '../src/main/notesops';

const GH = 'gh' + 'p_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5';
const KNOWN = 'plain-' + 'folder-value-42';
const posix = process.platform !== 'win32';
const root = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'durbar-notesfile-'));
let seq = 0;
const fresh = (name = 'proj'): string => { const d = path.join(root, `c${++seq}`, name); nodeFs.mkdirSync(d, { recursive: true }); return d; };
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const md = (folder: string): string => path.join(folder, '.durbar', 'notes.md');
const must = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { assert.ok(r.ok, JSON.stringify(r)); return r as Extract<T, { ok: true }>; };
const ROOT = path.join(__dirname, '..', '..');
const FS_METHODS = ['realpathSync', 'lstatSync', 'statSync', 'openSync', 'fstatSync', 'readSync', 'writeSync', 'fsyncSync', 'closeSync', 'renameSync', 'unlinkSync', 'mkdirSync'] as const;
type Method = typeof FS_METHODS[number];

/** A fake fs that counts every call and lets a test change a call (to swap a file between two checks). */
function countingFs(): { fs: NotesFileFs; calls: { m: Method; p: string; a: unknown[] }[]; hook: Partial<Record<Method, (real: (...a: unknown[]) => unknown, ...a: unknown[]) => unknown>> } {
  const calls: { m: Method; p: string; a: unknown[] }[] = [];
  const hook: Partial<Record<Method, (real: (...a: unknown[]) => unknown, ...a: unknown[]) => unknown>> = {};
  const fake: Record<string, unknown> = {};
  for (const m of FS_METHODS) {
    const real = (...a: unknown[]): unknown => (nodeFs[m] as unknown as (...x: unknown[]) => unknown)(...a);
    fake[m] = (...a: unknown[]): unknown => { calls.push({ m, p: typeof a[0] === 'string' ? a[0] : '#' + String(a[0]), a }); const h = hook[m]; return h ? h(real, ...a) : real(...a); };
  }
  return { fs: fake as unknown as NotesFileFs, calls, hook };
}
const canLink = ((): boolean => { try { const t = path.join(root, 'probe'); nodeFs.symlinkSync(root, t, 'dir'); nodeFs.unlinkSync(t); return true; } catch { return false; } })();
const skip = (why: string): void => console.log(`  (skipped: ${why})`);

let failures = 0;
async function test(name: string, fn: () => unknown): Promise<void> {
  try { await fn(); console.log(`ok - ${name}`); } catch (e) { failures++; console.log(`not ok - ${name}\n  ${(e as Error).stack?.split('\n').slice(0, 4).join('\n  ')}`); }
}

/** A store, a file and the folder they belong to. */
function rig(opts: { file?: ConstructorParameters<typeof NotesFile>[0]; now?: () => Date } = {}): { store: NotesStore; file: NotesFile; folder: string; key: string; c: ReturnType<typeof countingFs> } {
  const folder = fresh();
  const c = countingFs();
  const store = new NotesStore(path.join(folder, '..', 'userdata', 'notes'), { now: opts.now });
  const file = new NotesFile({ fs: c.fs, ...opts.file });
  return { store, file, folder, key: folder, c };
}
const cycle = (r: { store: NotesStore; file: NotesFile; folder: string; key: string }, values: string[] = []): ReturnType<typeof syncNotesFile> =>
  syncNotesFile({ file: r.file, store: r.store, folderKey: r.key, folderName: 'proj', folderPath: r.folder, values });
const notesOf = async (s: NotesStore, key: string): Promise<Note[]> => { const v = await s.list(key); assert.ok(v.ok); return (v as Extract<typeof v, { ok: true }>).notes; };

/** A tiny gitignore matcher for one anchored pattern: `\x` is a literal x, `*` and `?` stay in a segment, `[...]` is a class. */
function gitMatches(pattern: string, rel: string): boolean {
  assert.ok(pattern.startsWith('/') && pattern.endsWith('/'), 'anchored, folder only');
  const body = pattern.slice(1, -1);
  let re = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\') { re += body[i + 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); i++; }
    else if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else if (ch === '[') { const j = body.indexOf(']', i + 2); if (j < 0) re += '\\['; else { re += '[' + body.slice(i + 1, j).replace(/\\/g, '\\\\') + ']'; i = j; } }
    else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$').test(rel);
}

/** A git directory with `HEAD`, `objects/` and `info/` (or without the parts named). */
function gitDir(dir: string, omit: { head?: boolean; objects?: boolean; info?: boolean } = {}): string {
  nodeFs.mkdirSync(dir, { recursive: true });
  if (!omit.head) nodeFs.writeFileSync(path.join(dir, 'HEAD'), 'ref: refs/heads/main\n');
  if (!omit.objects) nodeFs.mkdirSync(path.join(dir, 'objects'));
  if (!omit.info) nodeFs.mkdirSync(path.join(dir, 'info'));
  return dir;
}

async function main(): Promise<void> {
  await test('AC5: no process, no shell, no .gitignore write, no logging in the module', () => {
    const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const src = strip(nodeFs.readFileSync(path.join(ROOT, 'src', 'main', 'notesfile.ts'), 'utf8'));
    for (const bad of ['child_process', 'spawn', 'execFile', 'exec(', 'fork(', '.gitignore', 'console.', 'shell']) assert.ok(!src.includes(bad), `notesfile.ts has no ${bad}`);
    for (const f of ['notesops.ts', 'notesstore.ts']) assert.ok(!strip(nodeFs.readFileSync(path.join(ROOT, 'src', 'main', f), 'utf8')).includes('child_process'), `${f} has no child_process`);
  });

  await test('AC1: while the switch is off nothing stats, reads or writes notes.md (counting fs), and a workspace never gets one', async () => {
    const folder = fresh();
    const c = countingFs();
    const file = new NotesFile({ fs: c.fs });
    const store = new NotesStore(path.join(folder, '..', 'ud'));
    const a = { id: 'a1', name: 'proj', cwd: folder, folders: [folder], permMode: 'read-only', status: 'ready' } as unknown as AgentInfo;
    const w = { ...a, id: 'w1', workspaceFile: path.join(folder, 'x.code-workspace') } as unknown as AgentInfo;
    let on = false;
    const timers: (() => void)[] = [];
    const ops = new NotesOps({ agents: new Map([['a1', a], ['w1', w]]), store: () => store, resumeIdFor: () => '', adapterIdOf: () => 'copilot', folderValues: () => [], sessionValues: () => [], file: () => file, fileOn: () => on, setTimer: (fn) => { timers.push(fn); } });
    const n = must(await ops.add('a1', { text: 'first idea' }) as { ok: true; note?: Note });
    await ops.list('a1');
    await ops.update('a1', n.note!.id, n.note!.rev, { done: true });
    assert.strictEqual(await ops.syncFile('a1'), undefined);
    assert.deepStrictEqual([c.calls.length, timers.length], [0, 0], 'no fs call and no cycle scheduled while off');
    assert.ok(!nodeFs.existsSync(path.join(folder, '.durbar')));
    on = true;
    await ops.add('w1', { text: 'in a workspace' });
    assert.strictEqual(await ops.syncFile('w1'), undefined, 'a .code-workspace has no project file');
    assert.deepStrictEqual([c.calls.length, timers.length], [0, 0]);
    // on: opening writes the file; a change schedules one cycle (two changes share it)
    const v = must(await ops.list('a1') as { ok: true; file?: unknown; notes: Note[] });
    assert.deepStrictEqual(v.file, {});
    assert.strictEqual(nodeFs.readFileSync(md(folder), 'utf8'), writeNotesMd(v.notes));
    await ops.add('a1', { text: 'second' });
    await ops.add('a1', { text: 'third' });
    assert.strictEqual(timers.length, 1, 'one cycle for changes within 500 ms');
    timers.shift()!();
    await ops.syncFile('a1');
    assert.strictEqual(nodeFs.readFileSync(md(folder), 'utf8'), writeNotesMd(await notesOf(store, folder)));
    // the file changes right before the rename: the cycle the change scheduled asks for one more
    await ops.add('a1', { text: 'fourth' });
    assert.strictEqual(timers.length, 1);
    c.calls.length = 0;
    let armed = true;
    c.hook.closeSync = (real, fd) => { const out = real(fd); if (armed && c.calls.some((x) => x.m === 'openSync' && x.p.endsWith('.tmp'))) { armed = false; nodeFs.appendFileSync(md(folder), '\n<!-- durbar-note -->\n## from an agent\n\nhi\n'); } return out; };
    timers.shift()!();
    await ops.syncFile('a1', 0); // runs after the fired cycle (one at a time per folder)
    assert.ok(!armed, 'the swap happened');
    assert.strictEqual(timers.length, 1, 'a retry is scheduled');
    timers.shift()!();
    const after = must(await ops.list('a1') as { ok: true; file?: unknown; notes: Note[] });
    assert.deepStrictEqual(after.file, {});
    assert.ok(after.notes.some((x) => x.title === 'from an agent' && x.from === 'file'), 'the outside edit is imported');
    assert.strictEqual(nodeFs.readFileSync(md(folder), 'utf8'), writeNotesMd(after.notes));
    // a file that changes before every rename: one retry, then the cycles stop until the next change or open
    let lastTmp = false;
    c.hook.openSync = (real, p, ...rest) => { lastTmp = typeof p === 'string' && p.endsWith('.tmp'); return real(p, ...rest); };
    c.hook.closeSync = (real, fd) => { const out = real(fd); if (lastTmp) { lastTmp = false; nodeFs.appendFileSync(md(folder), '\nagain\n'); } return out; };
    timers.length = 0;
    must(await store.add(folder, 'proj', { text: 'fifth' })); // straight to the store: something to write, no cycle scheduled
    await ops.syncFile('a1');
    assert.strictEqual(timers.length, 1, 'one retry');
    timers.shift()!();
    await ops.syncFile('a1', 0);
    assert.strictEqual(timers.length, 0, 'no second retry');
    delete c.hook.closeSync;
    delete c.hook.openSync;
  });

  await test('AC1: the temp file is O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW 0600, the file and .durbar are owner-only, the mirror is returned and persisted', async () => {
    const r = rig();
    must(await r.store.add(r.key, 'proj', { text: 'hello' }));
    const st = await cycle(r);
    assert.deepStrictEqual(st.state, {});
    const open = r.c.calls.find((x) => x.m === 'openSync' && x.p.endsWith('.tmp'))!;
    const k = nodeFs.constants;
    const flags = open.a[1] as number;
    for (const [n, f] of [['O_CREAT', k.O_CREAT], ['O_EXCL', k.O_EXCL], ['O_WRONLY', k.O_WRONLY]] as const) assert.ok((flags & f) === f, `temp opened with ${n}`);
    if (k.O_NOFOLLOW !== undefined) assert.ok((flags & k.O_NOFOLLOW) === k.O_NOFOLLOW, 'temp opened with O_NOFOLLOW');
    assert.strictEqual(open.a[2], 0o600);
    if (posix) {
      assert.strictEqual(nodeFs.statSync(md(r.folder)).mode & 0o777, 0o600);
      assert.strictEqual(nodeFs.statSync(path.join(r.folder, '.durbar')).mode & 0o077, 0, '.durbar is owner-only');
    }
    const buf = nodeFs.readFileSync(md(r.folder));
    const m = await r.store.getMirror(r.key);
    assert.deepStrictEqual([m?.sha256, m?.bytes], [sha(buf), buf.length], 'the mirror the store persisted is the file written');
    assert.deepStrictEqual(nodeFs.readdirSync(path.join(r.folder, '.durbar')), ['notes.md'], 'no temp file left');
    // restart: a fresh store and file see their own notes.md as unchanged (no import, no write)
    const store2 = new NotesStore(path.join(r.folder, '..', 'userdata', 'notes'));
    const c2 = countingFs();
    const st2 = await syncNotesFile({ file: new NotesFile({ fs: c2.fs }), store: store2, folderKey: r.key, folderName: 'proj', folderPath: r.folder, values: [] });
    assert.deepStrictEqual(st2.state, {});
    assert.ok(!c2.calls.some((x) => x.m === 'renameSync' || x.m === 'writeSync'), 'nothing written after a restart');
    assert.strictEqual((await notesOf(store2, r.key)).length, 1);
  });

  await test('AC1/FR-050: count says how many notes an existing file adds; an unreadable one says so', async () => {
    const r = rig();
    nodeFs.mkdirSync(path.join(r.folder, '.durbar'));
    nodeFs.writeFileSync(md(r.folder), '# Notes\n\n<!-- durbar-note -->\n## one\n\na\n\n<!-- durbar-note -->\nb\n\n<!-- durbar-note id=n-aaaaaaaaaaaa -->\n## three\n\n<!-- durbar-note -->\n## four\n');
    assert.deepStrictEqual(r.file.count(r.folder), { ok: true, count: 4, exists: true });
    assert.deepStrictEqual(r.file.count(r.folder, new Set(['n-aaaaaaaaaaaa'])), { ok: true, count: 3, exists: true });
    nodeFs.appendFileSync(md(r.folder), '<<<<<<< HEAD\n');
    assert.deepStrictEqual(r.file.count(r.folder), { ok: false, error: COUNT_UNREADABLE });
    const empty = fresh();
    assert.deepStrictEqual(new NotesFile().count(empty), { ok: true, count: 0, exists: false });
    assert.ok(!nodeFs.existsSync(path.join(empty, '.durbar')), 'count never creates .durbar');
  });

  await test('AC2: a .durbar or notes.md that is a link, a .durbar whose real path is outside, a notes.md that is a folder: refused, nothing read or written', async () => {
    if (!canLink) return skip('this account cannot make symbolic links (Windows without the right); the real-path check below still runs');
    const outside = fresh('outside');
    nodeFs.writeFileSync(path.join(outside, 'notes.md'), `<!-- durbar-note -->\n## leak\n\n${GH}\n`);
    const before = nodeFs.readFileSync(path.join(outside, 'notes.md'));
    // .durbar -> outside
    {
      const r = rig();
      must(await r.store.add(r.key, 'proj', { text: 'mine' }));
      nodeFs.symlinkSync(outside, path.join(r.folder, '.durbar'), 'dir');
      const st = await cycle(r);
      assert.match(st.state.error ?? '', /\.durbar is a link/);
      assert.deepStrictEqual(nodeFs.readdirSync(outside), ['notes.md']);
      assert.ok(before.equals(nodeFs.readFileSync(path.join(outside, 'notes.md'))));
      assert.strictEqual((await notesOf(r.store, r.key)).length, 1, 'nothing imported through the link');
    }
    // notes.md -> a file outside
    {
      const r = rig();
      must(await r.store.add(r.key, 'proj', { text: 'mine' }));
      nodeFs.mkdirSync(path.join(r.folder, '.durbar'));
      nodeFs.symlinkSync(path.join(outside, 'notes.md'), md(r.folder), 'file');
      const st = await cycle(r);
      assert.match(st.state.error ?? '', /it is a link/);
      assert.ok(!r.c.calls.some((x) => x.m === 'openSync' && x.p === md(r.folder)), 'the link is never opened');
      assert.ok(before.equals(nodeFs.readFileSync(path.join(outside, 'notes.md'))));
      assert.ok(nodeFs.lstatSync(md(r.folder)).isSymbolicLink(), 'the link is not replaced');
    }
  });

  await test('AC2: .durbar whose real path leads outside (a bind mount, a junction) and notes.md as a folder are refused', async () => {
    const outside = fresh('outside');
    const r = rig();
    must(await r.store.add(r.key, 'proj', { text: 'mine' }));
    nodeFs.mkdirSync(path.join(r.folder, '.durbar'));
    r.c.hook.realpathSync = (real, p) => (p === path.join(r.folder, '.durbar') ? outside : real(p));
    const st = await cycle(r);
    assert.match(st.state.error ?? '', /leads outside the folder/);
    assert.deepStrictEqual(nodeFs.readdirSync(outside), []);
    assert.deepStrictEqual(nodeFs.readdirSync(path.join(r.folder, '.durbar')), []);
    delete r.c.hook.realpathSync;
    nodeFs.mkdirSync(md(r.folder));
    const st2 = await cycle(r);
    assert.match(st2.state.error ?? '', /not a regular file/);
  });

  await test('AC2: a Windows junction as .durbar is refused', async () => {
    if (process.platform !== 'win32') return skip('junctions exist only on Windows; the symbolic-link and real-path cases cover this platform');
    const outside = fresh('outside');
    const r = rig();
    must(await r.store.add(r.key, 'proj', { text: 'mine' }));
    try { nodeFs.symlinkSync(outside, path.join(r.folder, '.durbar'), 'junction'); } catch (e) { return skip(`could not make a junction here (${(e as { code?: string }).code})`); }
    const st = await cycle(r);
    assert.ok(st.state.error, 'refused');
    assert.deepStrictEqual(nodeFs.readdirSync(outside), []);
  });

  await test('AC2: a FIFO as notes.md is refused at once; readCapped opens non-blocking (child process with a time limit)', async () => {
    if (!posix) return skip('no mkfifo on Windows; the regular-file check still applies');
    const r = rig();
    nodeFs.mkdirSync(path.join(r.folder, '.durbar'));
    execFileSync('mkfifo', [md(r.folder)]);
    const st = await cycle(r);
    assert.match(st.state.error ?? '', /not a regular file/);
    // a FIFO swapped in between the lstat and the open: the open itself must not block
    const mod = path.join(__dirname, '..', 'src', 'main', 'notesfile.js');
    const code = `
      const fs = require('fs'); const F = require(${JSON.stringify(mod)});
      const a = F.readCapped(fs, fs.constants, ${JSON.stringify(md(r.folder))}, 1000);
      const real = fs.lstatSync;
      const lying = Object.assign({}, fs, { lstatSync: (p, o) => p === ${JSON.stringify(md(r.folder))} ? Object.assign(real(process.execPath), { isFile: () => true, isSymbolicLink: () => false, size: 10 }) : real(p, o) });
      const b = new F.NotesFile({ fs: lying }).readBack(${JSON.stringify(r.folder)}, undefined);
      process.stdout.write(JSON.stringify([a.ok, a.code, b.ok]));`;
    const out = execFileSync(process.execPath, ['-e', code], { timeout: 8000, encoding: 'utf8' });
    assert.deepStrictEqual(JSON.parse(out), [false, 'not-file', false], `both refused without blocking (${out})`);
  });

  await test('AC3/AC11/AC16: edits of known ids are imported masked and set fileEdited; done counts; a trailing blank line is no edit; nothing is deleted', async () => {
    const r = rig();
    const a = must(await r.store.add(r.key, 'proj', { text: 'alpha\n\n\n' })).note!;
    const b = must(await r.store.add(r.key, 'proj', { text: 'beta' })).note!;
    const c = must(await r.store.add(r.key, 'proj', { text: 'gamma' })).note!;
    await cycle(r);
    let text = nodeFs.readFileSync(md(r.folder), 'utf8');
    assert.ok(text.includes('\nalpha\n\n<!--'), 'trailing blank lines are not written');
    // a hand edit: beta's text gets a token and a known folder value; gamma marked done; alpha's section removed entirely
    text = text.replace('\nbeta\n', `\nbeta with ${GH} and ${KNOWN}\n`).replace(`id=${c.id} created=${c.createdAt} updated=${c.updatedAt}`, `id=${c.id} created=${c.createdAt} updated=${c.updatedAt} done`);
    const alphaStart = text.indexOf(`<!-- durbar-note id=${a.id}`);
    text = text.slice(0, alphaStart) + text.slice(text.indexOf('<!-- durbar-note', alphaStart + 5));
    nodeFs.writeFileSync(md(r.folder), text);
    const st = await cycle(r, [KNOWN]);
    assert.deepStrictEqual(st.state, {});
    const ns = await notesOf(r.store, r.key);
    const by = (id: string): Note => ns.find((n) => n.id === id)!;
    assert.strictEqual(ns.length, 3, 'a section that is gone deletes nothing');
    assert.deepStrictEqual([by(a.id).rev, by(a.id).fileEdited, by(a.id).text], [1, false, 'alpha\n\n\n']);
    assert.ok(!by(b.id).text.includes(GH) && !by(b.id).text.includes(KNOWN) && by(b.id).text.includes('[redacted]'), 'the edit is masked with the folder values');
    assert.deepStrictEqual([by(b.id).fileEdited, by(b.id).hidden, by(b.id).from], [true, true, 'typed']);
    assert.deepStrictEqual([by(c.id).done, by(c.id).fileEdited], [true, true], 'a done change in the file is an edit (AC16)');
    const disk = nodeFs.readFileSync(md(r.folder), 'utf8');
    assert.ok(!disk.includes(GH) && !disk.includes(KNOWN), 'the file written back is masked');
    assert.ok(disk.includes(`id=${a.id}`), 'the removed section comes back');
    // only trailing blank lines added to a note: no edit
    nodeFs.writeFileSync(md(r.folder), disk.replace('\nalpha\n', '\nalpha\n\n\n   \n'));
    await cycle(r);
    assert.deepStrictEqual([by(a.id).rev, (await notesOf(r.store, r.key)).find((n) => n.id === a.id)!.rev], [1, 1], 'a trailing blank line is never a file edit');
  });

  await test('AC3: new sections are from: file (never typed), a tombstoned id is not imported, a new valid id is kept; conflicts block import and write', async () => {
    const r = rig();
    const gone = must(await r.store.add(r.key, 'proj', { text: 'to delete' })).note!;
    must(await r.store.remove(r.key, 'proj', gone.id, gone.rev));
    await cycle(r);
    const extra = `\n<!-- durbar-note -->\n## From a teammate\n\nplease check ${GH}\n\n<!-- durbar-note id=n-keepmyid0001 created=2001-01-01T00:00:00Z updated=2001-01-01T00:00:00Z -->\n## kept id\n\nbody\n\n<!-- durbar-note id=${gone.id} -->\n## zombie\n\ncome back\n`;
    nodeFs.writeFileSync(md(r.folder), nodeFs.readFileSync(md(r.folder), 'utf8').replace('# Notes\n', '# Notes\n\n## Heading note\n\nunder a heading\n') + extra);
    await cycle(r);
    const ns = await notesOf(r.store, r.key);
    assert.deepStrictEqual(ns.map((n) => [n.title, n.from]).sort(), [['From a teammate', 'file'], ['Heading note', 'file'], ['kept id', 'file']]);
    assert.ok(!JSON.stringify(ns).includes(GH));
    const kept = ns.find((n) => n.title === 'kept id')!;
    assert.strictEqual(kept.id, 'n-keepmyid0001', 'a valid id never seen is kept (no second import after a restart)');
    assert.notStrictEqual(kept.createdAt.slice(0, 4), '2001', 'created= of a new note is ignored');
    assert.ok(!nodeFs.readFileSync(md(r.folder), 'utf8').includes('zombie'), 'the deleted note leaves the file');
    // the same file again (a write that failed): not imported twice
    const again = await cycle(r);
    assert.deepStrictEqual(again.state, {});
    assert.strictEqual((await notesOf(r.store, r.key)).length, 3);
    // an import whose write-back failed: the next cycle does not add the same new notes again
    {
      const w = rig({ file: { platform: 'win32', sleep: async () => undefined } });
      nodeFs.mkdirSync(path.join(w.folder, '.durbar'));
      nodeFs.writeFileSync(md(w.folder), '<!-- durbar-note -->\n## bare one\n\nx\n\n## not a note\n');
      w.c.hook.renameSync = () => { throw Object.assign(new Error('busy'), { code: 'EPERM' }); };
      assert.match((await cycle(w)).state.error ?? '', /EPERM/);
      assert.match((await cycle(w)).state.error ?? '', /EPERM/);
      assert.deepStrictEqual((await notesOf(w.store, w.key)).map((n) => n.title), ['bare one'], 'imported once');
    }
    // a conflict: no import, no write, the state says why
    const withConflict = nodeFs.readFileSync(md(r.folder), 'utf8') + '\n<<<<<<< HEAD\n<!-- durbar-note -->\n## new\n\nx\n';
    nodeFs.writeFileSync(md(r.folder), withConflict);
    must(await r.store.add(r.key, 'proj', { text: 'local change' }));
    const st = await cycle(r);
    assert.strictEqual(st.state.error, NOTES_MD_UNREADABLE);
    assert.strictEqual(nodeFs.readFileSync(md(r.folder), 'utf8'), withConflict, 'not overwritten');
    assert.strictEqual((await notesOf(r.store, r.key)).length, 4, 'nothing imported');
  });

  await test('AC12: created= is ignored and updated= clamped for known ids; an older copy is not an edit', async () => {
    let clock = Date.parse('2026-10-31T10:00:00.000Z');
    const r = rig({ now: () => new Date(clock) });
    const a = must(await r.store.add(r.key, 'proj', { text: 'first' })).note!;
    clock += 60_000;
    const b = must(await r.store.add(r.key, 'proj', { text: 'second' })).note!;
    await cycle(r);
    clock += 60_000;
    const t = nodeFs.readFileSync(md(r.folder), 'utf8').replace(`id=${b.id} created=${b.createdAt} updated=${b.updatedAt}`, `id=${b.id} created=1999-01-01T00:00:00Z updated=9999-12-31T23:59:59Z`).replace('\nsecond\n', '\nsecond, edited\n');
    nodeFs.writeFileSync(md(r.folder), t);
    await cycle(r);
    let ns = await notesOf(r.store, r.key);
    const nb = ns.find((n) => n.id === b.id)!;
    assert.strictEqual(nb.createdAt, b.createdAt, 'created= ignored');
    assert.ok(Date.parse(nb.updatedAt) <= clock && !nb.updatedAt.startsWith('9999'), `updated= clamped (${nb.updatedAt})`);
    assert.deepStrictEqual(ns.map((n) => n.id), [a.id, b.id], 'the order does not change');
    // an older copy (a branch switch): updated= before the stored note's: skipped, and the file is put back
    clock += 60_000;
    must(await r.store.update(r.key, 'proj', a.id, 1, { text: 'first, newer in Durbar' }));
    await cycle(r);
    const old = nodeFs.readFileSync(md(r.folder), 'utf8').replace('first, newer in Durbar', 'first').replace(/(id=[a-z0-9-]+ created=\S+ updated=)\S+/, `$1${a.updatedAt}`);
    nodeFs.writeFileSync(md(r.folder), old);
    const olderSt = await cycle(r);
    assert.match(olderSt.state.info ?? '', /^1 note in notes\.md was an older copy; Durbar's version was kept\.$/, 'the kept version is said, not silent');
    ns = await notesOf(r.store, r.key);
    assert.strictEqual(ns.find((n) => n.id === a.id)!.text, 'first, newer in Durbar', 'an older copy does not roll the note back');
    assert.ok(nodeFs.readFileSync(md(r.folder), 'utf8').includes('first, newer in Durbar'));
  });

  await test('review: a note added in the file without an id is imported once (a retry, a failing write with a second edit, restarts)', async () => {
    const titles = async (st: NotesStore, key: string): Promise<string> => (await notesOf(st, key)).map((n) => n.text).sort().join('|');
    // (a) the file changes right before the rename: the next cycle sees the same id-less section again
    {
      const r = rig();
      must(await r.store.add(r.key, 'proj', { text: 'base' }));
      await cycle(r);
      nodeFs.appendFileSync(md(r.folder), '\n<!-- durbar-note -->\n## idea\n\nnew idea text\n');
      r.c.calls.length = 0;
      let armed = true;
      r.c.hook.closeSync = (real, fd) => { const out = real(fd); if (armed && r.c.calls.some((x) => x.m === 'openSync' && x.p.endsWith('.tmp'))) { armed = false; nodeFs.writeFileSync(md(r.folder), nodeFs.readFileSync(md(r.folder), 'utf8').replace('\nbase\n', '\nbase edited\n')); } return out; };
      assert.strictEqual((await cycle(r)).retry, true);
      await cycle(r);
      assert.strictEqual(await titles(r.store, r.key), 'base edited|new idea text');
    }
    // (b) the write keeps failing (EIO) and the person edits the file again in the same process
    {
      const r = rig();
      must(await r.store.add(r.key, 'proj', { text: 'base' }));
      await cycle(r);
      r.c.hook.renameSync = () => { throw Object.assign(new Error('io'), { code: 'EIO' }); };
      nodeFs.appendFileSync(md(r.folder), '\n<!-- durbar-note -->\nidless\n');
      assert.match((await cycle(r)).state.error ?? '', /EIO/);
      nodeFs.appendFileSync(md(r.folder), '\n<!-- durbar-note -->\nsecond\n');
      assert.match((await cycle(r)).state.error ?? '', /EIO/);
      assert.strictEqual(await titles(r.store, r.key), 'base|idless|second');
    }
    // (c) restarts while the write fails: the imported hash is kept in the store, so the same file is not imported again
    {
      const r = rig();
      must(await r.store.add(r.key, 'proj', { text: 'base' }));
      await cycle(r);
      nodeFs.appendFileSync(md(r.folder), '\n<!-- durbar-note -->\nidless\n');
      const dir = path.join(r.folder, '..', 'userdata', 'notes');
      for (let i = 0; i < 4; i++) {
        const st = new NotesStore(dir);
        const c = countingFs();
        c.hook.renameSync = () => { throw Object.assign(new Error('io'), { code: 'EIO' }); };
        let imports = 0;
        const orig = st.importFile.bind(st);
        st.importFile = (...a: Parameters<NotesStore['importFile']>) => { imports++; return orig(...a); };
        await syncNotesFile({ file: new NotesFile({ fs: c.fs }), store: st, folderKey: r.key, folderName: 'proj', folderPath: r.folder, values: [] });
        assert.strictEqual(imports, i === 0 ? 1 : 0, `restart ${i}: the same file is imported once`);
        assert.strictEqual(await st.getFileImport(r.key), sha(nodeFs.readFileSync(md(r.folder))));
      }
      assert.strictEqual(await titles(new NotesStore(dir), r.key), 'base|idless');
    }
  });

  await test('review 2: a section without an id edited again before it reached the file is the same note (pairing in order), never a silent merge', async () => {
    const texts = async (st: NotesStore, key: string): Promise<string> => (await notesOf(st, key)).map((n) => n.text).sort().join('|');
    const failing = (r: ReturnType<typeof rig>): void => { r.c.hook.renameSync = () => { throw Object.assign(new Error('io'), { code: 'EIO' }); }; };
    const edit = (r: ReturnType<typeof rig>, from: string, to: string): void => { const t = nodeFs.readFileSync(md(r.folder), 'utf8'); assert.ok(t.includes(from)); nodeFs.writeFileSync(md(r.folder), t.replace(from, to)); };
    const base = async (r: ReturnType<typeof rig>): Promise<void> => { must(await r.store.add(r.key, 'proj', { text: 'base' })); await cycle(r); };
    // the designed retry: the section is edited again right before the rename
    {
      const r = rig();
      await base(r);
      nodeFs.appendFileSync(md(r.folder), '\n<!-- durbar-note -->\nnew idea text\n');
      r.c.calls.length = 0;
      let armed = true;
      r.c.hook.closeSync = (real, fd) => { const out = real(fd); if (armed && r.c.calls.some((x) => x.m === 'openSync' && x.p.endsWith('.tmp'))) { armed = false; edit(r, 'new idea text\n', 'new idea text/more\n'); } return out; };
      assert.strictEqual((await cycle(r)).retry, true);
      assert.deepStrictEqual((await cycle(r)).state, {});
      assert.strictEqual(await texts(r.store, r.key), 'base|new idea text/more');
    }
    // the write fails, then the same section is edited
    {
      const r = rig();
      await base(r);
      failing(r);
      nodeFs.appendFileSync(md(r.folder), '\n<!-- durbar-note -->\nidless\n');
      await cycle(r);
      edit(r, '\nidless\n', '\nidless v2\n');
      await cycle(r);
      const ns = await notesOf(r.store, r.key);
      assert.strictEqual(await texts(r.store, r.key), 'base|idless v2');
      assert.ok(ns.find((n) => n.text === 'idless v2')!.fileEdited);
    }
    // two pending notes pair in file order; a changed title is an edit too
    {
      const r = rig();
      await base(r);
      failing(r);
      nodeFs.appendFileSync(md(r.folder), '\n<!-- durbar-note -->\n## Title A\n\none\n\n<!-- durbar-note -->\ntwo\n');
      await cycle(r);
      const before = new Map((await notesOf(r.store, r.key)).map((n) => [n.text, n.id]));
      edit(r, '## Title A\n\none\n', '## Title B\n\none v2\n');
      edit(r, '\ntwo\n', '\ntwo v2\n');
      await cycle(r);
      const after = await notesOf(r.store, r.key);
      assert.strictEqual(after.length, 3);
      assert.deepStrictEqual([after.find((n) => n.id === before.get('one'))?.text, after.find((n) => n.id === before.get('one'))?.title, after.find((n) => n.id === before.get('two'))?.text], ['one v2', 'Title B', 'two v2'], 'each section stays its own note, in order');
      // only the title changed: still the same note
      edit(r, '## Title B\n', '## Title C\n');
      await cycle(r);
      assert.deepStrictEqual((await notesOf(r.store, r.key)).filter((n) => n.text === 'one v2').map((n) => n.title), ['Title C']);
    }
    // the pending note was changed in Durbar meanwhile: Durbar's version is kept, and the state says so
    {
      let clock = Date.parse('2026-10-31T10:00:00.000Z');
      const r = rig({ now: () => new Date(clock) });
      await base(r);
      failing(r);
      nodeFs.appendFileSync(md(r.folder), '\n<!-- durbar-note -->\nidless\n');
      await cycle(r);
      clock += 60_000;
      const n = (await notesOf(r.store, r.key)).find((x) => x.text === 'idless')!;
      must(await r.store.update(r.key, 'proj', n.id, n.rev, { text: 'changed in Durbar' }));
      clock += 60_000;
      edit(r, '\nidless\n', '\nidless v2\n');
      const st = await cycle(r);
      assert.strictEqual(await texts(r.store, r.key), 'base|changed in Durbar');
      assert.match(st.state.info ?? '', /1 note added in notes\.md was changed in Durbar before reaching the file; Durbar's version was kept/);
    }
    // two equal sections in one file are two notes; equal text with different titles too
    {
      const r = rig();
      nodeFs.mkdirSync(path.join(r.folder, '.durbar'));
      nodeFs.writeFileSync(md(r.folder), '<!-- durbar-note -->\nsame\n\n<!-- durbar-note -->\nsame\n\n<!-- durbar-note -->\n## T1\n\nbody\n\n<!-- durbar-note -->\n## T2\n\nbody\n');
      await cycle(r);
      assert.strictEqual(await texts(r.store, r.key), 'body|body|same|same');
    }
    // a deliberate copy (without the id) of a note already in the file is a new note
    {
      const r = rig();
      nodeFs.mkdirSync(path.join(r.folder, '.durbar'));
      nodeFs.writeFileSync(md(r.folder), '<!-- durbar-note -->\n## idea\n\nidea\n');
      await cycle(r); // imported from the file and written back with its id
      assert.ok(/id=n-/.test(nodeFs.readFileSync(md(r.folder), 'utf8')));
      nodeFs.appendFileSync(md(r.folder), '\n<!-- durbar-note -->\n## idea\n\nidea\n');
      await cycle(r);
      assert.strictEqual(await texts(r.store, r.key), 'idea|idea');
    }
    // a typed note that never reached the file is not matched by a file section with the same text
    {
      const r = rig();
      failing(r);
      nodeFs.mkdirSync(path.join(r.folder, '.durbar'));
      const typed = must(await r.store.add(r.key, 'proj', { text: 'typed thing' })).note!;
      nodeFs.writeFileSync(md(r.folder), '<!-- durbar-note -->\ntyped thing\n\n<!-- durbar-note -->\nother text\n');
      await cycle(r);
      const ns = await notesOf(r.store, r.key);
      assert.deepStrictEqual(ns.map((n) => n.text).sort(), ['other text', 'typed thing', 'typed thing']);
      assert.deepStrictEqual([ns.find((n) => n.id === typed.id)!.text, ns.find((n) => n.id === typed.id)!.from], ['typed thing', 'typed'], 'the typed note is not touched');
    }
  });

  await test('review 2: merging two documents keeps the newer fileImport', () => {
    const { mergeDocs, emptyNotesDoc } = require('../src/shared/notes') as typeof import('../src/shared/notes');
    const older = { ...emptyNotesDoc('p'), fileImport: { sha256: 'a'.repeat(64), at: '2026-10-31T10:00:00.000Z' } };
    const newer = { ...emptyNotesDoc('p'), fileImport: { sha256: 'b'.repeat(64), at: '2026-10-31T11:00:00.000Z' } };
    assert.strictEqual(mergeDocs(older, newer).fileImport?.sha256, 'b'.repeat(64));
    assert.strictEqual(mergeDocs(newer, older).fileImport?.sha256, 'b'.repeat(64));
  });

  await test('AC13/AC14: titles from the file are masked and lose bidi and zero-width characters; texts are masked, then cut', async () => {
    const r = rig();
    nodeFs.mkdirSync(path.join(r.folder, '.durbar'));
    const RLO = String.fromCharCode(0x202e), ZW = String.fromCharCode(0x200b), BOMC = String.fromCharCode(0xfeff);
    const long = 'w '.repeat(7_990) + GH + '\n' + 'tail\n'.repeat(2_000);
    nodeFs.writeFileSync(md(r.folder), `<!-- durbar-note -->\n## ${RLO}evil${ZW}title ${GH}${BOMC}\n\nshort\n\n<!-- durbar-note -->\n## long one\n\n${long}`);
    await cycle(r);
    const ns = await notesOf(r.store, r.key);
    const t = ns.find((n) => n.text === 'short')!;
    assert.strictEqual(t.title, 'eviltitle [redacted]');
    assert.ok(t.hidden, 'masking a title sets hidden');
    const l = ns.find((n) => n.title === 'long one')!;
    assert.ok(l.text.length <= NOTES_LIMITS.textChars && l.text.endsWith(CUT_LINE), 'cut to the cap with the visible line');
    assert.ok(!l.text.includes(GH.slice(0, 8)), 'a token across the cut leaves no piece (mask, then cut)');
  });

  await test('AC13: a section over inputChars is not imported; past notesPerFolder the rest is counted, not imported', async () => {
    const r = rig();
    nodeFs.mkdirSync(path.join(r.folder, '.durbar'));
    nodeFs.writeFileSync(md(r.folder), `<!-- durbar-note -->\n## huge\n\n${'y'.repeat(NOTES_LIMITS.inputChars + 1)}\n<!-- durbar-note -->\n## small\n\nok\n`);
    const st = await cycle(r);
    assert.deepStrictEqual((await notesOf(r.store, r.key)).map((n) => n.title), ['small']);
    assert.match(st.state.info ?? '', /^1 note in notes\.md could not be added/);
    const f = rig();
    must(await f.store.add(f.key, 'proj', { text: 'local one' }));
    nodeFs.mkdirSync(path.join(f.folder, '.durbar'));
    let t = '';
    for (let i = 0; i < NOTES_LIMITS.notesPerFolder + 2; i++) t += `<!-- durbar-note -->\n## n${i}\n\nx${i}\n`;
    nodeFs.writeFileSync(md(f.folder), t);
    const fs2 = await cycle(f);
    assert.strictEqual((await notesOf(f.store, f.key)).length, NOTES_LIMITS.notesPerFolder);
    assert.match(fs2.state.info ?? '', /^3 notes in notes\.md could not be added/, 'one over the store cap, two past the parser cap');
  });

  await test('AC15/AC7: the byte cap applies before decoding: a file over mdBytes is never read; a file that grows while read is refused', async () => {
    const r = rig();
    nodeFs.mkdirSync(path.join(r.folder, '.durbar'));
    const fd = nodeFs.openSync(md(r.folder), 'w');
    nodeFs.ftruncateSync(fd, NOTES_LIMITS.mdBytes + 1); // sparse: no 14 MB written
    nodeFs.closeSync(fd);
    const st = await cycle(r);
    assert.strictEqual(st.state.error, NOTES_MD_UNREADABLE);
    assert.ok(!r.c.calls.some((x) => x.m === 'readSync'), 'not one byte read');
    assert.ok(!r.c.calls.some((x) => x.m === 'renameSync'), 'not overwritten');
    // lstat said small (the file grew after it): fstat still caps it before one byte is read or decoded
    const b = rig();
    nodeFs.mkdirSync(path.join(b.folder, '.durbar'));
    const bfd = nodeFs.openSync(md(b.folder), 'w');
    nodeFs.ftruncateSync(bfd, NOTES_LIMITS.mdBytes + 1);
    nodeFs.closeSync(bfd);
    b.c.hook.lstatSync = (real, p, o) => (p === md(b.folder) ? Object.assign(real(p, o) as nodeFs.Stats, { size: 10 }) : real(p, o));
    assert.strictEqual((await cycle(b)).state.error, NOTES_MD_UNREADABLE);
    assert.ok(!b.c.calls.some((x) => x.m === 'readSync'), 'fstat over the cap: not one byte read');
    // fstat says small, the file has more: at most size + 1 bytes are read
    const g = rig();
    nodeFs.mkdirSync(path.join(g.folder, '.durbar'));
    nodeFs.writeFileSync(md(g.folder), 'z'.repeat(5_000));
    g.c.hook.fstatSync = (real, f) => Object.assign(real(f) as nodeFs.Stats, { size: 10 });
    const res = readCapped(g.c.fs, nodeFs.constants, md(g.folder), NOTES_LIMITS.mdBytes);
    assert.deepStrictEqual([res.ok, (res as { code?: string }).code], [false, 'changing']);
    const reads = g.c.calls.filter((x) => x.m === 'readSync').map((x) => x.a[3] as number);
    assert.ok(reads.every((n) => n <= 11), `reads stay within size + 1 (${reads})`);
    // a hard link to a file elsewhere is refused
    const h = rig();
    nodeFs.mkdirSync(path.join(h.folder, '.durbar'));
    const elsewhere = path.join(h.folder, '..', 'private.txt');
    nodeFs.writeFileSync(elsewhere, `<!-- durbar-note -->\n## private\n\n${GH}\n`);
    try { nodeFs.linkSync(elsewhere, md(h.folder)); } catch (e) { return skip(`no hard links here (${(e as { code?: string }).code})`); }
    const hs = await cycle(h);
    assert.match(hs.state.error ?? '', /hard link/);
    assert.strictEqual((await notesOf(h.store, h.key)).length, 0);
  });

  await test('AC15: sections past notesPerFolder are counted without being built; a hostile file at the cap stays within a generous CPU budget', () => {
    let head = '';
    for (let i = 0; i < NOTES_LIMITS.notesPerFolder; i++) head += `<!-- durbar-note -->\n## t${i}\n\nx\n`;
    const over = head + '<!-- durbar-note id=n-aaaaaaaaaaaa -->\n## over\n\n' + 'a\n'.repeat(100_000) + '## heading-like\n'.repeat(1_000);
    // count array pushes during the parse (deterministic, unlike a timing): the 100,000 lines past the cap must never be collected
    const push = Array.prototype.push;
    let pushes = 0;
    Array.prototype.push = function (this: unknown[], ...items: unknown[]): number { pushes++; return push.apply(this, items); };
    let p: ReturnType<typeof parseNotesMd>;
    try { p = parseNotesMd(over); } finally { Array.prototype.push = push; }
    assert.ok(p.ok && p.sections.length === NOTES_LIMITS.notesPerFolder && p.overflow === 1, JSON.stringify(p.ok && [p.sections.length, p.overflow]));
    assert.ok(pushes < 10_000, `${pushes} pushes: the section past the cap was built`);
    const line = '<!-- durbar-note id=n-aaaaaaaaaaaa created=2026-10-31T10:00:00Z updated=2026-10-31T10:00:00Z done -->\n';
    const s = line.repeat(Math.floor(NOTES_LIMITS.mdBytes / line.length));
    const t0 = process.cpuUsage();
    const q = parseNotesMd(s);
    const used = process.cpuUsage(t0);
    const ms = (used.user + used.system) / 1000;
    assert.ok(q.ok && q.sections.length === NOTES_LIMITS.notesPerFolder && q.overflow > 100_000);
    assert.ok(ms < 5_000, `parse took ${ms.toFixed(0)} ms of CPU`);
  });

  await test('AC15: a file that does not parse is not parsed again while its bytes stay the same', async () => {
    const r = rig();
    nodeFs.mkdirSync(path.join(r.folder, '.durbar'));
    nodeFs.writeFileSync(md(r.folder), '<!-- durbar-note -->\n## a\n\n=======\n');
    assert.strictEqual((await cycle(r)).state.error, NOTES_MD_UNREADABLE);
    const split = String.prototype.split;
    let splits = 0;
    String.prototype.split = function (this: string, ...a: Parameters<typeof split>): string[] { splits++; return split.apply(this, a); } as typeof split;
    let again: Awaited<ReturnType<typeof cycle>>;
    try { again = await cycle(r); } finally { String.prototype.split = split; }
    assert.strictEqual(again.state.error, NOTES_MD_UNREADABLE);
    assert.strictEqual(splits, 0, 'the same conflicting bytes are not parsed again');
    nodeFs.writeFileSync(md(r.folder), '<!-- durbar-note -->\n## a\n\nfixed\n');
    assert.deepStrictEqual((await cycle(r)).state, {}, 'a fixed file is read again');
  });

  await test('AC4: Windows rename retry: EPERM once succeeds after 200 ms, twice gives the FR-053 message, the store is untouched', async () => {
    for (const times of [1, 2]) {
      const sleeps: number[] = [];
      const r = rig({ file: { platform: 'win32', sleep: async (ms) => { sleeps.push(ms); } } });
      must(await r.store.add(r.key, 'proj', { text: 'hello' }));
      const storeFile = nodeFs.readdirSync(path.join(r.folder, '..', 'userdata', 'notes')).find((f) => f.endsWith('.json'))!;
      const storeBefore = nodeFs.readFileSync(path.join(r.folder, '..', 'userdata', 'notes', storeFile));
      let left = times;
      r.c.hook.renameSync = (real, a, b) => { if (left-- > 0) throw Object.assign(new Error('busy'), { code: 'EPERM' }); return real(a, b); };
      const st = await cycle(r);
      assert.deepStrictEqual(sleeps, [200]);
      if (times === 1) {
        assert.deepStrictEqual(st.state, {});
        assert.ok(nodeFs.existsSync(md(r.folder)));
      } else {
        assert.strictEqual(st.state.error, 'Could not write .durbar/notes.md: EPERM');
        assert.deepStrictEqual(nodeFs.readdirSync(path.join(r.folder, '.durbar')), [], 'temp file removed');
        assert.ok(storeBefore.equals(nodeFs.readFileSync(path.join(r.folder, '..', 'userdata', 'notes', storeFile))), 'the local store is untouched');
      }
    }
    // a change during the 200 ms wait is caught before the second rename
    {
      const r = rig({ file: { platform: 'win32', sleep: async () => { nodeFs.appendFileSync(md(r.folder), '\n<!-- durbar-note -->\n## while waiting\n\nx\n'); } } });
      must(await r.store.add(r.key, 'proj', { text: 'hello' }));
      await cycle(r);
      must(await r.store.add(r.key, 'proj', { text: 'again' }));
      let left = 1;
      r.c.hook.renameSync = (real, a, b) => { if (left-- > 0) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); return real(a, b); };
      const st = await cycle(r);
      assert.strictEqual(st.retry, true, 'checked again after the wait');
      assert.ok(nodeFs.readFileSync(md(r.folder), 'utf8').includes('while waiting'), 'the outside edit is not overwritten');
    }
    // not Windows: no retry
    const r = rig({ file: { platform: 'linux', sleep: async () => { throw new Error('no sleep expected'); } } });
    must(await r.store.add(r.key, 'proj', { text: 'hello' }));
    r.c.hook.renameSync = () => { throw Object.assign(new Error('x'), { code: 'EPERM' }); };
    const st = await cycle(r);
    assert.strictEqual(st.state.error, 'Could not write .durbar/notes.md: EPERM');
    assert.strictEqual(r.c.calls.filter((x) => x.m === 'renameSync').length, 1);
  });

  await test('AC6: between the temp write and the rename, a swapped .durbar, a notes.md turned into a link, or a changed hash is caught', async () => {
    const outside = fresh('outside');
    const swaps: [string, (r: ReturnType<typeof rig>) => void, RegExp][] = [
      ['.durbar real path moved outside', (r) => { const d = path.join(r.folder, '.durbar'); r.c.hook.realpathSync = (real, p) => (p === d ? outside : real(p)); }, /leads outside/],
      ['notes.md changed', (r) => { nodeFs.writeFileSync(md(r.folder), nodeFs.readFileSync(md(r.folder), 'utf8') + '\n<!-- durbar-note -->\n## agent added\n\nhi\n'); }, /changed while Durbar was writing/],
    ];
    if (canLink) {
      swaps.push(['.durbar swapped for a link', (r) => { const d = path.join(r.folder, '.durbar'); nodeFs.renameSync(d, d + '-old'); nodeFs.symlinkSync(outside, d, 'dir'); }, /\.durbar is a link/]);
      swaps.push(['notes.md turned into a link', (r) => { nodeFs.unlinkSync(md(r.folder)); nodeFs.writeFileSync(path.join(outside, 'target.md'), 'x'); nodeFs.symlinkSync(path.join(outside, 'target.md'), md(r.folder), 'file'); }, /notes\.md is a link/]);
    } else skip('no symbolic links here: the link swaps are not run');
    for (const [name, swap, why] of swaps) {
      const r = rig();
      must(await r.store.add(r.key, 'proj', { text: 'one' }));
      await cycle(r);
      must(await r.store.add(r.key, 'proj', { text: 'two' }));
      r.c.calls.length = 0;
      let armed = true;
      r.c.hook.closeSync = (real, fd) => { const out = real(fd); if (armed && r.c.calls.some((x) => x.m === 'openSync' && x.p.endsWith('.tmp'))) { armed = false; swap(r); } return out; };
      const st = await cycle(r);
      assert.match(st.state.error ?? '', why, name);
      assert.ok(!r.c.calls.some((x) => x.m === 'renameSync'), `${name}: no rename`);
      delete r.c.hook.realpathSync;
      for (const f of nodeFs.readdirSync(outside)) assert.ok(!f.endsWith('.tmp') && f !== 'notes.md', `${name}: nothing landed outside (${f})`);
      if (name === 'notes.md changed') {
        assert.strictEqual(st.retry, true, 'the write runs again next cycle');
        assert.ok(!nodeFs.readdirSync(path.join(r.folder, '.durbar')).some((f) => f.endsWith('.tmp')), 'temp file deleted');
        const st2 = await cycle(r);
        assert.deepStrictEqual(st2.state, {});
        const ns = await notesOf(r.store, r.key);
        assert.ok(ns.some((n) => n.title === 'agent added' && n.from === 'file'), 'the outside edit was imported, not overwritten');
        assert.ok(nodeFs.readFileSync(md(r.folder), 'utf8').includes('two'));
      }
      for (const f of nodeFs.readdirSync(outside)) nodeFs.rmSync(path.join(outside, f), { force: true });
    }
  });

  await test('AC7: Durbar never writes a notes.md over mdBytes', async () => {
    const r = rig();
    const big = await r.file.syncOut(r.folder, 'x'.repeat(NOTES_LIMITS.mdBytes + 1), null);
    assert.deepStrictEqual([big.ok, (big as { code?: string }).code], [false, 'cap']);
    assert.ok(!nodeFs.existsSync(path.join(r.folder, '.durbar')), 'nothing created');
  });

  await test('AC8: addExclude finds info/exclude from a .git folder, a worktree .git file and a subfolder; appends once; refuses a linked or oversized exclude', () => {
    const repo = fresh('repo');
    gitDir(path.join(repo, '.git'));
    const sub = path.join(repo, 'pkg', 'app');
    nodeFs.mkdirSync(sub, { recursive: true });
    const c = countingFs();
    const f = new NotesFile({ fs: c.fs });
    const excl = path.join(repo, '.git', 'info', 'exclude');
    assert.deepStrictEqual(f.addExclude(repo), { ok: true, added: true, line: '/.durbar/' });
    assert.deepStrictEqual(f.addExclude(sub), { ok: true, added: true, line: '/pkg/app/.durbar/' });
    assert.deepStrictEqual(f.addExclude(sub), { ok: true, added: false, line: '/pkg/app/.durbar/' }, 'idempotent');
    assert.strictEqual(nodeFs.readFileSync(excl, 'utf8'), '/.durbar/\n/pkg/app/.durbar/\n');
    if (posix) assert.strictEqual(nodeFs.statSync(excl).mode & 0o777, 0o600);
    assert.ok(!c.calls.some((x) => x.m === 'mkdirSync'));
    // an exclude with no trailing newline gets one before the line
    const r2 = fresh('repo2');
    gitDir(path.join(r2, '.git'));
    nodeFs.writeFileSync(path.join(r2, '.git', 'info', 'exclude'), '# git ls-files --others --exclude-from=.git/info/exclude');
    must(f.addExclude(r2));
    assert.ok(nodeFs.readFileSync(path.join(r2, '.git', 'info', 'exclude'), 'utf8').endsWith('exclude\n/.durbar/\n'));
    // a worktree: .git file -> <main>/.git/worktrees/wt, commondir ../..
    const main = fresh('mainrepo');
    gitDir(path.join(main, '.git'));
    const wtGit = path.join(main, '.git', 'worktrees', 'wt');
    gitDir(wtGit, { objects: true, info: true });
    nodeFs.writeFileSync(path.join(wtGit, 'commondir'), '../..\n');
    const wt = fresh('wt');
    nodeFs.writeFileSync(path.join(wt, '.git'), `gitdir: ${wtGit}\n`);
    assert.deepStrictEqual(f.addExclude(wt), { ok: true, added: true, line: '/.durbar/' });
    assert.strictEqual(nodeFs.readFileSync(path.join(main, '.git', 'info', 'exclude'), 'utf8'), '/.durbar/\n');
    // oversized exclude, linked exclude
    const r3 = fresh('repo3');
    gitDir(path.join(r3, '.git'));
    const e3 = path.join(r3, '.git', 'info', 'exclude');
    nodeFs.writeFileSync(e3, '#'.repeat(NOTES_LIMITS.excludeBytes + 1));
    const big = f.addExclude(r3);
    assert.ok(!big.ok && /too large/.test(big.error), JSON.stringify(big));
    if (canLink) {
      nodeFs.unlinkSync(e3);
      const target = path.join(r3, '..', 'elsewhere');
      nodeFs.writeFileSync(target, '');
      nodeFs.symlinkSync(target, e3, 'file');
      const linked = f.addExclude(r3);
      assert.ok(!linked.ok && /link/.test(linked.error), JSON.stringify(linked));
      assert.strictEqual(nodeFs.readFileSync(target, 'utf8'), '', 'nothing written through the link');
    }
    if (posix && canLink) {
      // swapped between the lstat and the open: a link (O_NOFOLLOW), and a hard link appearing where exclude was missing (nlink)
      const target = path.join(fresh('outside'), 'victim');
      nodeFs.writeFileSync(target, 'keep\n');
      for (const kind of ['symlink', 'hardlink'] as const) {
        const r4 = fresh('repo4');
        gitDir(path.join(r4, '.git'));
        const e4 = path.join(r4, '.git', 'info', 'exclude');
        if (kind === 'symlink') nodeFs.writeFileSync(e4, '# exclude\n');
        const c4 = countingFs();
        c4.hook.openSync = (real, p, ...rest) => {
          if (p === e4 && ((rest[0] as number) & nodeFs.constants.O_APPEND)) { try { nodeFs.unlinkSync(e4); } catch { /* missing */ } if (kind === 'symlink') nodeFs.symlinkSync(target, e4, 'file'); else nodeFs.linkSync(target, e4); }
          return real(p, ...rest);
        };
        const res = new NotesFile({ fs: c4.fs }).addExclude(r4);
        assert.ok(!res.ok, `${kind} swapped in before the open: refused (${JSON.stringify(res)})`);
        assert.strictEqual(nodeFs.readFileSync(target, 'utf8'), 'keep\n', `${kind}: nothing written to the other file`);
      }
    }
    const plain = fresh('plain');
    const no = f.addExclude(plain);
    assert.ok(!no.ok && /^Could not add \.durbar\/ to \.git\/info\/exclude: /.test(no.error));
  });

  await test('AC9: addExclude refuses what is not a real git directory and never creates info/', () => {
    const c = countingFs();
    const f = new NotesFile({ fs: c.fs });
    const wtTo = (target: string, extra?: (d: string) => void): string => { const wt = fresh('wt'); nodeFs.writeFileSync(path.join(wt, '.git'), `gitdir: ${target}\n`); extra?.(wt); return wt; };
    const cases: [string, () => string, RegExp][] = [
      ['gitdir is a plain folder', () => wtTo(fresh('plain')), /not a git repository/],
      ['commondir leads to a plain folder', () => { const g = gitDir(path.join(fresh('g'), 'gd'), { objects: true, info: true }); const plain = fresh('plain2'); nodeFs.writeFileSync(path.join(g, 'commondir'), plain + '\n'); return wtTo(g); }, /not a git repository/],
      ['no info folder', () => { const r = fresh('r'); gitDir(path.join(r, '.git'), { info: true }); return r; }, /no info folder/],
    ];
    if (canLink) {
      cases.push(['HEAD is a link', () => { const r = fresh('r'); gitDir(path.join(r, '.git'), { head: true }); const h = path.join(r, 'HEADfile'); nodeFs.writeFileSync(h, 'ref: x\n'); nodeFs.symlinkSync(h, path.join(r, '.git', 'HEAD'), 'file'); return r; }, /not a git repository/]);
      cases.push(['objects is a link', () => { const r = fresh('r'); gitDir(path.join(r, '.git'), { objects: true }); const o = path.join(r, 'objs'); nodeFs.mkdirSync(o); nodeFs.symlinkSync(o, path.join(r, '.git', 'objects'), 'dir'); return r; }, /not a git repository/]);
    }
    for (const [name, make, why] of cases) {
      const folder = make();
      const res = f.addExclude(folder);
      assert.ok(!res.ok && why.test(res.error), `${name}: ${JSON.stringify(res)}`);
    }
    assert.ok(!c.calls.some((x) => x.m === 'mkdirSync'), 'never a mkdir');
    assert.ok(!c.calls.some((x) => x.m === 'openSync' && /exclude$/.test(x.p)), 'never an exclude opened');
    if (posix) {
      const r = fresh('r');
      gitDir(path.join(r, '.git'));
      const other = new NotesFile({ uid: () => (process.getuid?.() ?? 0) + 1 }).addExclude(r);
      assert.ok(!other.ok && /owned by another user/.test(other.error), JSON.stringify(other));
      assert.ok(!nodeFs.existsSync(path.join(r, '.git', 'info', 'exclude')));
    } else skip('the owner check is POSIX only');
  });

  await test('AC10: the line escapes gitignore specials per segment and matches exactly the folder; control characters are refused', () => {
    const names = ['a*b', 'x?', '[draft]', '!keep', '#notes', path.join('outer', '[draft]', 'in*ner')];
    if (posix) names.push('back\\slash', 'trail ', 'two  ');
    const near: Record<string, string> = { 'a*b': 'aXXb', 'x?': 'xy', '[draft]': 'd', 'back\\slash': 'back/slash', 'trail ': 'trail', 'two  ': 'two' };
    for (const name of names) {
      const repo = fresh('repo');
      gitDir(path.join(repo, '.git'));
      const folder = path.join(repo, name);
      nodeFs.mkdirSync(folder, { recursive: true });
      const res = must(new NotesFile().addExclude(folder));
      const rel = name.split(path.sep).join('/');
      assert.ok(gitMatches(res.line, `${rel}/.durbar`), `${JSON.stringify(name)}: ${res.line} matches its folder`);
      if (near[name]) assert.ok(!gitMatches(res.line, `${near[name]}/.durbar`), `${JSON.stringify(name)}: ${res.line} does not match ${near[name]}`);
      assert.ok(!gitMatches(res.line, `${rel}/.durbarx`) && !gitMatches(res.line, `x/${rel}/.durbar`));
      assert.strictEqual(nodeFs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8').split('\n').filter(Boolean).length, 1, 'one line');
    }
    assert.strictEqual(escapeGitSegment('!a#b'), '\\!a#b');
    assert.strictEqual(escapeGitSegment('#x '), '\\#x\\ ');
    assert.strictEqual(escapeGitSegment('a\\ '), 'a\\\\\\ ', 'a backslash before a trailing space: both escaped');
    assert.strictEqual(excludeLine([]), '/.durbar/');
    if (!posix) return skip('Windows folder names cannot hold control characters');
    for (const bad of ['bad\nname', 'cr\rname', 'tab\tname', 'ctl' + String.fromCharCode(1), 'del' + String.fromCharCode(0x7f)]) {
      const repo = fresh('repo');
      gitDir(path.join(repo, '.git'));
      nodeFs.mkdirSync(path.join(repo, bad));
      assert.deepStrictEqual(new NotesFile().addExclude(path.join(repo, bad)), { ok: false, error: EXCLUDE_UNSAFE_NAME }, JSON.stringify(bad));
      assert.ok(!nodeFs.existsSync(path.join(repo, '.git', 'info', 'exclude')), 'nothing appended');
    }
  });

  await test('FR-054: stray text before the first note is reported once as info', async () => {
    const r = rig();
    nodeFs.mkdirSync(path.join(r.folder, '.durbar'));
    nodeFs.writeFileSync(md(r.folder), 'random words\n\n<!-- durbar-note -->\n## a\n\nb\n');
    const st = await cycle(r);
    assert.strictEqual(st.state.info, NOTES_MD_STRAY + '.');
    assert.strictEqual((await cycle(r)).state.info, undefined, 'the file written back has no stray text');
  });
}

main().then(() => {
  nodeFs.rmSync(root, { recursive: true, force: true });
  if (failures) { console.log(`test-notesfile: ${failures} failed`); process.exit(1); }
  console.log('test-notesfile: all passed');
}, (e) => { console.error(e); process.exit(1); });

/**
 * Spec 083 T034b (FR-048, FR-062, issue 699): *Export…*, *Delete all…* and *Also delete its notes* in main: `writeNotesExport` on real
 * temp folders, `NotesOps.export` with a fake save dialog, `NotesOps.removeAll` / `confirmForget` / `forget`, `NotesStore.forget`, the
 * native confirmation texts, and the `notes:export` and `folders:remove` handlers on a stand-in `electron`. `npm run test:notesexport`.
 * Real temp folders under the real OS temp path, one ticking clock (never the wall clock), no Electron, no git, no credits.
 */
import * as assert from 'assert';
import * as nodeFs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { pathToFileURL } from 'url';
import type { AgentInfo } from '../src/shared/api';
import type { Note } from '../src/shared/notes';
import { NOTES_LIMITS } from '../src/shared/notes';
import { writeNotesMd } from '../src/shared/notesmd';
import { exportDialogOptions, exportFileName, writeNotesExport, type ExportDialogOptions, type NotesExportFs } from '../src/main/notesexport';
import { NotesFile } from '../src/main/notesfile';
import { NotesStore } from '../src/main/notesstore';
import { DELETE_ALL_NONE, EXPORT_NONE, EXPORT_PENDING, NATIVE_CANCELLED, NotesOps, notesConfirmText, type NativeKind } from '../src/main/notesops';
import { FolderStore } from '../src/main/folders';
import { SIM_OPEN_CHANNELS } from '../src/main/simguard';

process.exitCode = 1; // set to 0 only after the last line: a promise that never settles fails the suite
const posix = process.platform !== 'win32';
const realOf = (p: string): string => (nodeFs.realpathSync.native ?? nodeFs.realpathSync)(p);
const root = realOf(nodeFs.mkdtempSync(path.join(os.tmpdir(), 'durbar-notesexport-')));
let seq = 0;
const fresh = (name = 'out'): string => { const d = path.join(root, `c${++seq}`, name); nodeFs.mkdirSync(d, { recursive: true }); return d; };
const ROOT = ((): string => { let d = __dirname; while (!nodeFs.existsSync(path.join(d, 'package.json'))) d = path.dirname(d); return d; })();
let tick = Date.parse('2026-10-31T12:00:00.000Z');
const tickClock = (): Date => new Date(tick += 1000);
const canLink = ((): boolean => { try { const t = path.join(root, 'probe'); nodeFs.symlinkSync(root, t, 'dir'); nodeFs.unlinkSync(t); return true; } catch { return false; } })();
const canHardLink = ((): boolean => { try { const a = path.join(root, 'h1'), b = path.join(root, 'h2'); nodeFs.writeFileSync(a, 'x'); nodeFs.linkSync(a, b); nodeFs.unlinkSync(b); nodeFs.unlinkSync(a); return true; } catch { return false; } })();
const skip = (why: string): void => console.log(`  (skipped: ${why})`);
// secret-shaped values are built at run time (push protection)
const FOLDER_VALUE = 'fold' + 'er-value-' + 'Q7w8E9r0';
const SESSION_VALUE = 'sess' + 'ion-value-' + 'Z1x2C3v4';
const GH = 'gh' + 'p_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';
const SESSION_ID = 'sess-' + 'abcdef0123456789';

let failures = 0;
async function test(name: string, fn: () => unknown): Promise<void> {
  try { await fn(); console.log(`ok - ${name}`); } catch (e) { failures++; console.log(`not ok - ${name}\n  ${(e as Error).message.split('\n').slice(0, 12).join('\n  ')}\n  ${(e as Error).stack?.split('\n').find((l) => l.includes('test-notesexport.js:')) ?? ''}`); }
}
const okOf = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { assert.ok(r.ok, JSON.stringify(r)); return r as Extract<T, { ok: true }>; };
const refusedWith = (r: { ok: boolean; error?: string }, re: RegExp | string, what: string): void => {
  assert.ok(!r.ok && typeof r.error === 'string', `${what}: refused (${JSON.stringify(r)})`);
  if (typeof re === 'string') assert.strictEqual(r.error, re, what); else assert.ok(re.test(r.error!), `${what}: ${r.error}`);
  assert.ok(!r.error!.includes(root), `${what}: the refusal names no path`);
};
const modeOf = (f: string): number => nodeFs.statSync(f).mode & 0o777;
const leftovers = (dir: string): string[] => nodeFs.readdirSync(dir).filter((n) => n.endsWith('.tmp'));

/** NotesOps on real stores with a fake save dialog. */
type RigOpts = { choose?: (o: ExportDialogOptions) => string | undefined; confirm?: (kind: NativeKind, count?: number) => boolean; pending?: () => boolean; noDialog?: boolean };
interface Rig { ops: NotesOps; store: NotesStore; folders: FolderStore; notesDir: string; folder: string; other: string; agents: Map<string, AgentInfo>; dialogs: ExportDialogOptions[]; asked: { kind: NativeKind; name: string; count?: number }[]; timers: (() => void)[] }
function rig(o: RigOpts = {}): Rig {
  const base = fresh('base');
  const folder = path.join(base, 'proj'), other = path.join(base, 'other');
  nodeFs.mkdirSync(folder); nodeFs.mkdirSync(other);
  const notesDir = path.join(base, 'userdata', 'notes');
  const store = new NotesStore(notesDir, { now: tickClock });
  const folders = new FolderStore(path.join(base, 'userdata', 'durbar-folders.json'));
  folders.load();
  for (const w of [folder, other]) folders.upsert({ workspace: w, permMode: 'read-only' });
  const a = (id: string, cwd: string): AgentInfo => ({ id, name: 'x', cwd, folders: [cwd], permMode: 'read-only', status: 'ready' } as unknown as AgentInfo);
  const agents = new Map<string, AgentInfo>([['a1', a('a1', folder)], ['a2', a('a2', folder)], ['b1', a('b1', other)]]);
  const dialogs: ExportDialogOptions[] = [];
  const asked: { kind: NativeKind; name: string; count?: number }[] = [];
  const timers: (() => void)[] = [];
  const file = new NotesFile({ now: tickClock });
  const ops = new NotesOps({
    agents, store: () => store, resumeIdFor: () => SESSION_ID, adapterIdOf: () => 'copilot', now: tickClock,
    folderValues: () => [], sessionValues: () => [],
    file: () => file, fileOn: (k) => folders.get(k)?.notesFile === true, setFileOn: (k, on) => folders.setNotesFile(k, on), setTimer: (fn) => { timers.push(fn); },
    valuesPending: () => o.pending?.() === true,
    confirmNative: async (kind, name, count) => { asked.push({ kind, name, count }); return o.confirm ? o.confirm(kind, count) : true; },
    ...(o.noDialog ? {} : { saveDialog: async (opts: ExportDialogOptions) => { dialogs.push(opts); return o.choose ? o.choose(opts) : undefined; } }),
  });
  return { ops, store, folders, notesDir, folder, other, agents, dialogs, asked, timers };
}
const notesOf = async (store: NotesStore, key: string): Promise<Note[]> => { const v = await store.list(key); assert.ok(v.ok); return (v as { notes: Note[] }).notes; };

async function main(): Promise<void> {
  // ---- the file name and the dialog's options ----
  await test('exportFileName: characters no system can hold become -, reserved names and dots handled, Unicode kept', () => {
    assert.strictEqual(exportFileName('proj'), 'proj-notes.md');
    assert.strictEqual(exportFileName('a<b>c:d"e/f\\g|h?i*j'), 'a-b-c-d-e-f-g-h-i-j-notes.md');
    assert.strictEqual(exportFileName('..hidden.'), 'hidden-notes.md');
    assert.strictEqual(exportFileName('CON'), 'CON--notes.md');
    assert.strictEqual(exportFileName(''), 'folder-notes.md');
    assert.strictEqual(exportFileName('tab\there\u0001'), 'tab-here--notes.md');
    assert.strictEqual(exportFileName('Café 東京'), 'Café 東京-notes.md');
    assert.ok(exportFileName('x'.repeat(500)).length <= 60 + '-notes.md'.length);
    for (const n of ['a/b', 'a\\b', 'x:y', '..']) assert.ok(!/[\\/:]/.test(exportFileName(n)) && !exportFileName(n).startsWith('.'), n);
  });
  await test('exportDialogOptions: a Markdown filter, the default name only (no folder), and the overwrite question on Linux', () => {
    const o = exportDialogOptions('proj');
    assert.strictEqual(o.defaultPath, 'proj-notes.md');
    assert.ok(!path.isAbsolute(o.defaultPath) && !/[\\/]/.test(o.defaultPath), 'no folder in the default path');
    assert.ok(o.properties.includes('showOverwriteConfirmation'), 'the Linux dialog asks before replacing a file');
    assert.deepStrictEqual(o.filters, [{ name: 'Markdown', extensions: ['md'] }]);
  });

  // ---- writeNotesExport on real temp folders ----
  await test('writes a new file atomically, mode 0600, exact bytes, no temp file left', async () => {
    const dir = fresh();
    const f = path.join(dir, 'notes-out.md');
    const prev = process.umask(0); // the mode must not depend on the umask
    try {
      const w = okOf(await writeNotesExport(f, '# Notes\n\nhello\n'));
      assert.deepStrictEqual([w.name, w.bytes], ['notes-out.md', 15]);
    } finally { process.umask(prev); }
    assert.strictEqual(nodeFs.readFileSync(f, 'utf8'), '# Notes\n\nhello\n');
    if (posix) assert.strictEqual(modeOf(f), 0o600, 'mode 0600');
    assert.deepStrictEqual(leftovers(dir), []);
  });
  await test('replaces an existing regular file (the dialog asked) and leaves it 0600', async () => {
    const dir = fresh();
    const f = path.join(dir, 'old.md');
    nodeFs.writeFileSync(f, 'old text', { mode: 0o644 });
    okOf(await writeNotesExport(f, 'new text\n'));
    assert.strictEqual(nodeFs.readFileSync(f, 'utf8'), 'new text\n');
    if (posix) assert.strictEqual(modeOf(f), 0o600);
  });
  await test('refuses a link at the chosen name and never writes through it', async () => {
    if (!canLink) return skip('symlinks are not allowed here');
    const dir = fresh();
    const target = path.join(fresh('elsewhere'), 'victim.md');
    nodeFs.writeFileSync(target, 'keep me');
    const f = path.join(dir, 'link.md');
    nodeFs.symlinkSync(target, f, 'file');
    refusedWith(await writeNotesExport(f, 'x\n'), /the chosen file is a link/, 'link');
    assert.strictEqual(nodeFs.readFileSync(target, 'utf8'), 'keep me', 'the link\'s target is untouched');
    assert.ok(nodeFs.lstatSync(f).isSymbolicLink(), 'the link itself is left');
    assert.deepStrictEqual(leftovers(dir), []);
  });
  await test('refuses a folder, a hard link, a FIFO and a device at the chosen name', async () => {
    const dir = fresh();
    nodeFs.mkdirSync(path.join(dir, 'sub.md'));
    refusedWith(await writeNotesExport(path.join(dir, 'sub.md'), 'x\n'), /is a folder/, 'folder');
    if (canHardLink) {
      const a = path.join(dir, 'a.md'), b = path.join(dir, 'b.md');
      nodeFs.writeFileSync(a, 'shared');
      nodeFs.linkSync(a, b);
      refusedWith(await writeNotesExport(b, 'x\n'), /hard link/, 'hard link');
      assert.strictEqual(nodeFs.readFileSync(a, 'utf8'), 'shared');
    } else skip('hard links are not allowed here');
    if (posix) {
      const fifo = path.join(dir, 'pipe.md');
      const mk = spawnSync('mkfifo', [fifo], { stdio: 'ignore' });
      if (mk.status === 0) refusedWith(await writeNotesExport(fifo, 'x\n'), /not a regular file/, 'FIFO');
      else skip('mkfifo is not available');
      if (nodeFs.existsSync('/dev/null')) refusedWith(await writeNotesExport('/dev/null', 'x\n'), /not a regular file/, 'device');
    } else skip('FIFOs and /dev are POSIX only');
    assert.deepStrictEqual(leftovers(dir), []);
  });
  await test('refuses a relative path, a NUL, a missing folder, a non-string and a text over the cap', async () => {
    refusedWith(await writeNotesExport('relative.md', 'x'), /not a file path/, 'relative');
    refusedWith(await writeNotesExport(path.join(root, 'a\u0000b.md'), 'x'), /not a file path/, 'NUL');
    refusedWith(await writeNotesExport(42, 'x'), /not a file path/, 'not a string');
    refusedWith(await writeNotesExport(path.join(root, 'no-such-dir', 'x.md'), 'x'), /chosen folder is not there/, 'missing folder');
    const dir = fresh();
    refusedWith(await writeNotesExport(path.join(dir, 'big.md'), 'x'.repeat(NOTES_LIMITS.mdBytes + 1)), /too large/, 'over the cap');
    assert.deepStrictEqual(nodeFs.readdirSync(dir), [], 'nothing written');
  });
  await test('the temp file is opened O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW 0600 in the chosen real folder', async () => {
    const dir = fresh();
    const opened: { p: string; flags: number; mode: number }[] = [];
    const fs = { ...nodeFs, openSync: (p: string, flags: number, mode: number) => { opened.push({ p, flags, mode }); return nodeFs.openSync(p, flags, mode); } } as unknown as NotesExportFs;
    okOf(await writeNotesExport(path.join(dir, 'x.md'), 'x\n', { fs }));
    assert.strictEqual(opened.length, 1);
    const k = nodeFs.constants;
    const want = k.O_CREAT | k.O_EXCL | k.O_WRONLY | ((k as { O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0);
    assert.strictEqual(opened[0].flags, want, 'exclusive, no follow');
    assert.strictEqual(opened[0].mode, 0o600);
    assert.strictEqual(path.dirname(opened[0].p), dir, 'the temp file is in the chosen folder');
  });
  await test('a race: the name becomes a link, or a file appears, between the write and the rename: refused, temp removed', async () => {
    for (const kind of ['link', 'appear', 'replaced'] as const) {
      if (kind === 'link' && !canLink) { skip('symlinks are not allowed here'); continue; }
      const dir = fresh();
      const f = path.join(dir, 'race.md');
      const victim = path.join(fresh('victim'), 'v.md');
      nodeFs.writeFileSync(victim, 'keep me');
      if (kind === 'replaced') nodeFs.writeFileSync(f, 'first');
      let armed = true;
      const fs = { ...nodeFs, closeSync: (fd: number) => {
        nodeFs.closeSync(fd);
        if (!armed) return;
        armed = false;
        if (kind === 'link') nodeFs.symlinkSync(victim, f, 'file');
        else if (kind === 'appear') nodeFs.writeFileSync(f, 'someone else');
        else { nodeFs.unlinkSync(f); nodeFs.writeFileSync(f, 'another file'); }
      } } as unknown as NotesExportFs;
      const w = await writeNotesExport(f, 'mine\n', { fs });
      refusedWith(w, kind === 'link' ? /is a link/ : /changed while Durbar was writing/, kind);
      assert.strictEqual(nodeFs.readFileSync(victim, 'utf8'), 'keep me', `${kind}: nothing written elsewhere`);
      assert.deepStrictEqual(leftovers(dir), [], `${kind}: the temp file is removed`);
    }
  });

  // ---- NotesOps.export with a fake save dialog ----
  await test('export: main shows the dialog, writes FR-052\'s format of every note (done ones too), 0600, no session id', async () => {
    const out = fresh('exports');
    const chosen = path.join(out, 'mine.md');
    const r = rig({ choose: () => chosen });
    const s1 = okOf(await r.ops.save('a1', { role: 'agent', ord: 3, text: 'A plan from the agent', from: 'agent' }));
    assert.strictEqual(s1.note!.source!.session, SESSION_ID, 'the note carries a session id in the store');
    const t = okOf(await r.ops.add('a1', { text: 'Typed idea' }));
    okOf(await r.ops.update('a1', t.note!.id, t.note!.rev, { done: true }));
    const e = okOf(await r.ops.export('a1') as { ok: boolean });
    assert.deepStrictEqual(e, { ok: true, count: 2, name: 'mine.md' }, 'the answer carries the base name only');
    assert.strictEqual(r.dialogs.length, 1);
    assert.strictEqual(r.dialogs[0].defaultPath, 'proj-notes.md');
    assert.ok(r.dialogs[0].properties.includes('showOverwriteConfirmation'));
    const text = nodeFs.readFileSync(chosen, 'utf8');
    assert.strictEqual(text, writeNotesMd(await notesOf(r.store, r.folder)), 'exactly FR-052\'s writer');
    assert.ok(/ done -->/.test(text), 'the done note is in it');
    assert.ok(!text.includes(SESSION_ID) && !/session|digest|role=|from=/.test(text), 'no session id, digest, role or from');
    if (posix) assert.strictEqual(modeOf(chosen), 0o600);
  });
  await test('export: masked with the CURRENT values (a folder value registered later, another open chat\'s session value), whichever chat asks', async () => {
    const out = fresh('exports');
    let n = 0;
    const r = rig({ choose: () => path.join(out, `e${++n}.md`) });
    // stored before the values were known: the store holds them (a shape is masked on save; these two are not shapes)
    okOf(await r.ops.add('a1', { text: `deploy with ${FOLDER_VALUE} and ${SESSION_VALUE} and ${GH}` }));
    const raw = (await notesOf(r.store, r.folder))[0].text;
    assert.ok(raw.includes(FOLDER_VALUE) && raw.includes(SESSION_VALUE) && !raw.includes(GH), 'precondition: the store holds the two values, not the token');
    const d = (r.ops as unknown as { d: ConstructorParameters<typeof NotesOps>[0] }).d;
    d.folderValues = () => [FOLDER_VALUE];
    d.sessionValues = (id) => (id === 'a2' ? [SESSION_VALUE] : []);
    okOf(await r.ops.export('a1') as { ok: boolean });
    okOf(await r.ops.export('a2') as { ok: boolean });
    const one = nodeFs.readFileSync(path.join(out, 'e1.md'), 'utf8'), two = nodeFs.readFileSync(path.join(out, 'e2.md'), 'utf8');
    for (const t of [one, two]) assert.ok(!t.includes(FOLDER_VALUE) && !t.includes(SESSION_VALUE) && !t.includes(GH), 'nothing raw in the export');
    assert.strictEqual(one, two, 'the same bytes whichever chat asked');
    assert.ok((await notesOf(r.store, r.folder))[0].text.includes(FOLDER_VALUE), 'the export does not change the store');
  });
  await test('export: Cancel writes nothing; no notes, a locked value, an unknown chat or no dialog are refused before any dialog', async () => {
    const out = fresh('exports');
    const r = rig({ choose: () => undefined });
    refusedWith(await r.ops.export('a1') as { ok: boolean; error?: string }, EXPORT_NONE, 'no notes');
    assert.strictEqual(r.dialogs.length, 0, 'no dialog for an empty folder');
    okOf(await r.ops.add('a1', { text: 'x' }));
    assert.deepStrictEqual(await r.ops.export('a1'), { ok: false, cancelled: true });
    assert.strictEqual(r.dialogs.length, 1);
    assert.deepStrictEqual(nodeFs.readdirSync(out), []);
    let locked = true;
    const p = rig({ choose: () => path.join(out, 'locked.md'), pending: () => locked });
    okOf(await p.ops.add('a1', { text: 'x' }));
    refusedWith(await p.ops.export('a1') as { ok: boolean; error?: string }, EXPORT_PENDING, 'locked value');
    assert.strictEqual(p.dialogs.length, 0);
    locked = false;
    okOf(await p.ops.export('a1') as { ok: boolean });
    for (const bad of ['nobody', 42, {}, 'x'.repeat(500)]) refusedWith(await r.ops.export(bad) as { ok: boolean; error?: string }, /not open/, `agent id ${JSON.stringify(bad).slice(0, 20)}`);
    const nd = rig({ noDialog: true });
    okOf(await nd.ops.add('a1', { text: 'x' }));
    refusedWith(await nd.ops.export('a1') as { ok: boolean; error?: string }, /not available/, 'no dialog wired');
  });
  await test('export: a chosen path that is a link is refused through NotesOps too, with a short reason', async () => {
    if (!canLink) return skip('symlinks are not allowed here');
    const out = fresh('exports');
    const victim = path.join(fresh('victim'), 'v.md');
    nodeFs.writeFileSync(victim, 'keep me');
    nodeFs.symlinkSync(victim, path.join(out, 'l.md'), 'file');
    const r = rig({ choose: () => path.join(out, 'l.md') });
    okOf(await r.ops.add('a1', { text: 'x' }));
    refusedWith(await r.ops.export('a1') as { ok: boolean; error?: string }, /is a link/, 'link');
    assert.strictEqual(nodeFs.readFileSync(victim, 'utf8'), 'keep me');
  });

  // ---- Delete all ----
  await test('Delete all: main counts and asks natively (the count in the text); Cancel deletes nothing; OK keeps a tombstone per note', async () => {
    let yes = false;
    const r = rig({ confirm: (k) => (k === 'deleteAll' ? yes : true) });
    const ids: string[] = [];
    for (const t of ['one', 'two', 'three']) ids.push(okOf(await r.ops.add('a1', { text: t })).note!.id);
    okOf(await r.ops.add('b1', { text: 'other folder' }));
    refusedWith(await r.ops.removeAll('a1'), NATIVE_CANCELLED, 'Cancel');
    assert.deepStrictEqual(r.asked.map((x) => [x.kind, x.name, x.count]), [['deleteAll', 'proj', 3]]);
    assert.strictEqual((await notesOf(r.store, r.folder)).length, 3, 'Cancel keeps them');
    yes = true;
    const d = okOf(await r.ops.removeAll('a1'));
    assert.strictEqual(d.count, 3);
    assert.strictEqual((await notesOf(r.store, r.folder)).length, 0);
    const doc = JSON.parse(nodeFs.readFileSync(path.join(r.notesDir, `${r.store.fingerprintOf(r.folder)}.json`), 'utf8')) as { tombstones: { id: string }[] };
    assert.deepStrictEqual(doc.tombstones.map((x) => x.id).sort(), [...ids].sort(), 'a tombstone per note');
    // an import of a project file that still lists them brings none back
    const imp = await r.store.importFile(r.folder, 'proj', ids.map((id, i) => ({ id, title: 'back', text: 'back', done: false, origin: 'marker' as const, line: i + 1 })), []);
    assert.ok(imp.ok);
    assert.strictEqual((await notesOf(r.store, r.folder)).length, 0, 'tombstoned ids are not imported again');
    assert.strictEqual((await notesOf(r.store, r.other)).length, 1, 'the other folder is untouched');
    refusedWith(await r.ops.removeAll('a1'), DELETE_ALL_NONE, 'nothing left');
    assert.strictEqual(r.asked.length, 2, 'no native box when there is nothing to delete');
  });
  await test('Delete all without a native confirmation wired is refused', async () => {
    const r = rig();
    okOf(await r.ops.add('a1', { text: 'x' }));
    const none = new NotesOps({ ...(r.ops as unknown as { d: ConstructorParameters<typeof NotesOps>[0] }).d, confirmNative: undefined });
    refusedWith(await none.removeAll('a1'), NATIVE_CANCELLED, 'no native box');
    assert.strictEqual((await notesOf(r.store, r.folder)).length, 1);
  });
  await test('the native texts: counts, singular, the folder name only, Cancel stays the helper\'s default', () => {
    assert.deepStrictEqual(notesConfirmText('deleteAll', 'proj', 3), { ok: 'Delete all', message: 'Delete all 3 notes of proj?', detail: 'They are deleted from this computer. This cannot be undone.' });
    assert.strictEqual(notesConfirmText('deleteAll', 'proj', 1).message, 'Delete all 1 note of proj?');
    assert.strictEqual(notesConfirmText('forget', 'proj', 2).message, 'Remove proj and delete its 2 notes?');
    assert.ok(/\.durbar\/notes\.md in the project is not touched/.test(notesConfirmText('forget', 'proj', 2).detail));
    assert.strictEqual(notesConfirmText('forget', 'proj', 0).message, 'Remove proj and delete its notes?');
    assert.strictEqual(notesConfirmText('on', 'proj').ok, 'Turn on');
    assert.strictEqual(notesConfirmText('delete', 'proj').ok, 'Delete the file');
    const nc = nodeFs.readFileSync(path.join(ROOT, 'src', 'main', 'nativeconfirm.ts'), 'utf8');
    assert.ok(/buttons: \['Cancel', o\.ok\], defaultId: 0, cancelId: 0/.test(nc), 'Cancel is the default and the Escape answer');
    const mainSrc = nodeFs.readFileSync(path.join(ROOT, 'src', 'main', 'main.ts'), 'utf8');
    assert.ok(/confirmNative: \(kind, name, count\) => nativeConfirm\(win, notesConfirmText\(kind, name, count\)\)/.test(mainSrc), 'main asks with these texts');
    assert.ok(/saveDialog: async \(opts\) => \{\s*const r = win && !win\.isDestroyed\(\) \? await dialog\.showSaveDialog\(win, opts\) : await dialog\.showSaveDialog\(opts\);/.test(mainSrc), 'main shows the system save dialog with these options');
  });

  // ---- Also delete its notes ----
  await test('forget: only <fingerprint>.json of that folder is deleted; the other folder and the project\'s notes.md stay', async () => {
    const r = rig();
    okOf(await r.ops.add('a1', { text: 'mine' }));
    okOf(await r.ops.add('b1', { text: 'theirs' }));
    okOf(await r.ops.setFile('a1', true));
    const md = path.join(r.folder, '.durbar', 'notes.md');
    assert.ok(nodeFs.existsSync(md), 'precondition: the project file is written');
    const mine = path.join(r.notesDir, `${r.store.fingerprintOf(r.folder)}.json`), theirs = path.join(r.notesDir, `${r.store.fingerprintOf(r.other)}.json`);
    assert.ok(nodeFs.existsSync(mine) && nodeFs.existsSync(theirs) && mine !== theirs, 'precondition: two store files');
    const c = okOf(await r.ops.confirmForget('a1'));
    assert.deepStrictEqual([c.key, c.count], [r.folder, 1]);
    assert.deepStrictEqual(r.asked.map((x) => [x.kind, x.count]), [['on', undefined], ['forget', 1]]);
    r.folders.remove(r.folder); // the folder goes with its notesFile flag
    assert.strictEqual(r.folders.get(r.folder), undefined);
    const before = nodeFs.readFileSync(md);
    okOf(await r.ops.forget(r.folder));
    assert.ok(!nodeFs.existsSync(mine), 'the folder\'s store file is gone');
    assert.ok(nodeFs.existsSync(theirs), 'the other folder\'s store file stays');
    assert.ok(nodeFs.readFileSync(md).equals(before), 'notes.md in the project is untouched');
    assert.strictEqual((await notesOf(r.store, r.folder)).length, 0, 'no notes left, no tombstones');
    for (const fn of r.timers.splice(0)) fn(); // a scheduled cycle fires after the removal: the switch is off with the folder gone
    await new Promise((res) => setImmediate(res));
    assert.ok(!nodeFs.existsSync(mine), 'no cycle recreates the store file');
    assert.ok(nodeFs.readFileSync(md).equals(before), 'nor touches notes.md');
  });
  await test('forget waits for a mirror cycle already running, so the store file is not written again after it', async () => {
    const r = rig();
    okOf(await r.ops.add('a1', { text: 'mine' }));
    okOf(await r.ops.setFile('a1', true));
    okOf(await r.ops.add('a1', { text: 'second' })); // the next cycle has something to write
    const running = r.ops.syncFile('a1');
    const f = r.ops.forget(r.folder);
    await running;
    okOf(await f);
    assert.ok(!nodeFs.existsSync(path.join(r.notesDir, `${r.store.fingerprintOf(r.folder)}.json`)), 'gone after the cycle');
  });
  await test('confirmForget: Cancel is a refusal; a folder without notes is not asked; NotesStore.forget leaves a .bad- file and refuses a folder', async () => {
    const r = rig({ confirm: (k) => k !== 'forget' });
    okOf(await r.ops.confirmForget('b1'));
    assert.strictEqual(r.asked.length, 0, 'no notes: nothing to ask');
    okOf(await r.ops.add('a1', { text: 'x' }));
    refusedWith(await r.ops.confirmForget('a1'), NATIVE_CANCELLED, 'Cancel');
    refusedWith(await r.ops.confirmForget('nobody'), /not open/, 'unknown chat');
    const fp = r.store.fingerprintOf(r.folder);
    const bad = path.join(r.notesDir, `${fp}.json.bad-20261031T120000Z`);
    nodeFs.writeFileSync(bad, '{}');
    okOf(await r.store.forget(r.folder));
    assert.ok(nodeFs.existsSync(bad), 'a file moved aside by Start over is left');
    nodeFs.mkdirSync(path.join(r.notesDir, `${fp}.json`));
    assert.ok(!(await r.store.forget(r.folder)).ok, 'a folder at the name is refused');
    assert.ok(nodeFs.existsSync(path.join(r.notesDir, `${fp}.json`)));
  });
  // ---- the handlers on a stand-in electron ----
  await test('IPC: notes:export and folders:remove {deleteNotes} on a stand-in electron, from the app only', async () => {
    const electronPath = require.resolve('electron');
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
    const fake = { ipcMain: { handle: (ch: string, fn: (e: unknown, ...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => undefined }, app: { getVersion: () => '0.0.0-test' } };
    const saved = require.cache[electronPath];
    require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fake } as unknown as NodeJS.Module;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('../src/main/ipcguard') as typeof import('../src/main/ipcguard')).initSimGuard(false);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const notesIpc = require('../src/main/ipc/notes') as typeof import('../src/main/ipc/notes');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const foldersIpc = require('../src/main/ipc/folders') as typeof import('../src/main/ipc/folders');
      const out = fresh('exports');
      const chosen = path.join(out, 'via-ipc.md');
      let forgetYes = false;
      const r = rig({ choose: () => chosen, confirm: (k) => (k === 'forget' ? forgetYes : true) });
      notesIpc.register({ getOps: () => r.ops });
      const stopped: string[] = [];
      const router = { forAgent: () => ({ stop: async (id: string) => { stopped.push(id); } }), unbind: () => undefined };
      foldersIpc.register({ agents: r.agents, router: router as never, agentState: { remove: () => undefined } as never, getFolderStore: () => r.folders, getScheduler: () => undefined, vsChatRefs: new Map(), wsKey: (a) => a.workspaceFile ?? a.cwd, getNotesOps: () => r.ops });
      const frame = { url: pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'index.html')).href };
      const app = { senderFrame: frame, sender: { mainFrame: frame } };
      const other = { senderFrame: { url: 'https://example.invalid/' }, sender: { mainFrame: { url: 'https://example.invalid/' } } };
      const call = async (e: unknown, ch: string, ...a: unknown[]): Promise<Record<string, unknown>> => (await handlers.get(ch)!(e, ...a)) as Record<string, unknown>;
      okOf(await r.ops.add('a1', { text: 'kept or not' }));
      okOf(await r.ops.add('b1', { text: 'the other folder' }));
      // export: the window's extra argument is never a path
      const evil = path.join(out, 'from-window.md');
      const ex = await call(app, 'notes:export', 'a1', evil);
      assert.deepStrictEqual(ex, { ok: true, count: 1, name: 'via-ipc.md' });
      assert.ok(nodeFs.existsSync(chosen) && !nodeFs.existsSync(evil), 'only the dialog\'s path is written');
      await assert.rejects(Promise.resolve().then(() => handlers.get('notes:export')!(other, 'a1')), /did not come from its own window/);
      assert.ok(!Object.prototype.hasOwnProperty.call(SIM_OPEN_CHANNELS, 'notes:export'), 'refused under DURBAR_SIM');
      // folders:remove: bad options remove nothing
      const mine = path.join(r.notesDir, `${r.store.fingerprintOf(r.folder)}.json`), theirs = path.join(r.notesDir, `${r.store.fingerprintOf(r.other)}.json`);
      for (const bad of [{ deleteNotes: 'yes' }, { deleteNotes: true, path: r.other }, 'x', [true]]) {
        const res = await call(app, 'folders:remove', 'a1', bad);
        assert.strictEqual(res.ok, false, JSON.stringify(bad));
      }
      assert.ok(r.agents.has('a1') && r.folders.get(r.folder) && nodeFs.existsSync(mine), 'bad options: nothing removed');
      await assert.rejects(Promise.resolve().then(() => handlers.get('folders:remove')!(other, 'a1', { deleteNotes: true })), /did not come from its own window/);
      // ticked, then Cancel in the native box: nothing removed
      const c = await call(app, 'folders:remove', 'a1', { deleteNotes: true });
      assert.deepStrictEqual([c.ok, c.cancelled, (c.removedIds as string[]).length], [false, true, 0]);
      assert.ok(r.agents.has('a1') && r.agents.has('a2') && nodeFs.existsSync(mine) && stopped.length === 0, 'Cancel: the folder, its chats and its notes stay');
      // ticked and confirmed: the folder and only its notes file go
      forgetYes = true;
      const d = await call(app, 'folders:remove', 'a1', { deleteNotes: true });
      assert.deepStrictEqual([d.ok, d.notesDeleted, [...(d.removedIds as string[])].sort()], [true, true, ['a1', 'a2']]);
      assert.ok(!nodeFs.existsSync(mine) && nodeFs.existsSync(theirs), 'only the removed folder\'s notes file is deleted');
      assert.strictEqual(r.folders.get(r.folder), undefined);
      // unticked: the folder goes, its notes stay and come back when it is added again
      const u = await call(app, 'folders:remove', 'b1');
      assert.deepStrictEqual([u.ok, u.notesDeleted], [true, undefined]);
      assert.ok(nodeFs.existsSync(theirs), 'unticked: the notes file stays');
      r.agents.set('b9', { id: 'b9', name: 'x', cwd: r.other, folders: [r.other], permMode: 'read-only', status: 'ready' } as unknown as AgentInfo);
      const back = await r.ops.list('b9');
      assert.ok(back.ok && (back as { notes: Note[] }).notes.length === 1, 're-adding the folder shows its notes again');
      assert.strictEqual(r.asked.filter((x) => x.kind === 'forget').length, 2, 'asked natively each time it was ticked, not when unticked');
    } finally {
      if (saved) require.cache[electronPath] = saved; else delete require.cache[electronPath];
    }
  });
  await test('removeOpts: absent or {deleteNotes: boolean} only', () => {
    // loaded here, after the IPC test's stand-in electron is gone again: the module only needs it to register
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { removeOpts } = require('../src/main/ipc/folders') as typeof import('../src/main/ipc/folders');
    assert.deepStrictEqual(removeOpts(undefined), { deleteNotes: false });
    assert.deepStrictEqual(removeOpts({}), { deleteNotes: false });
    assert.deepStrictEqual(removeOpts({ deleteNotes: true }), { deleteNotes: true });
    assert.deepStrictEqual(removeOpts({ deleteNotes: false }), { deleteNotes: false });
    for (const bad of [null, 1, 'x', [], { deleteNotes: 'yes' }, { deleteNotes: 1 }, { deleteNotes: true, path: '/x' }, { key: 'k' }]) assert.strictEqual(removeOpts(bad), undefined, JSON.stringify(bad));
  });

  await test('source: no logging, no process, no Electron in the testable parts', () => {
    for (const f of ['src/main/notesexport.ts', 'src/main/notesops.ts']) {
      const code = nodeFs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      assert.ok(!/console\.|child_process|from 'electron'/.test(code), `${f}: no log, process or Electron`);
    }
  });

  nodeFs.rmSync(root, { recursive: true, force: true }); // the suite's own temp folder, by its exact path
  if (failures) { console.log(`notes export: ${failures} failed`); process.exitCode = 1; return; }
  if (!posix) console.log('  (Windows: link, FIFO and device cases depend on the runner)');
  console.log('notes export: save dialog in main, FR-052 format masked with current values, 0600, links and races refused; Delete all asks natively and keeps tombstones; Also delete its notes deletes only that folder\'s file');
  process.exitCode = 0;
}
void main();

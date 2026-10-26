/** Spec 083 T012 (FR-002, FR-005..FR-008, issue 699): the notes store on disk. `npm run test:notes`. Real temp folders and a fake fs; no Electron, no credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { CUT_LINE, NOTES_LIMITS, emptyNotesDoc, serializeNotesDoc } from '../src/shared/notes';
import type { Note, NotesDoc } from '../src/shared/notes';
import { NotesStore } from '../src/main/notesstore';
import type { NotesFs } from '../src/main/notesstore';
import { folderFingerprint } from '../src/main/usagetotalsstore';

// fake secrets, built at run time (push protection)
const GH = 'gh' + 'p_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5';
const KNOWN = 'hunter2-' + 'plain-value';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-notes-'));
let n = 0;
const fresh = (): string => path.join(root, 'u' + ++n, 'notes');
const FOLDER = '/home/someone/projects/demo';
const read = (dir: string, key = FOLDER): string => fs.readFileSync(path.join(dir, folderFingerprint(key) + '.json'), 'utf8');
const fileOf = (dir: string, key = FOLDER): string => path.join(dir, folderFingerprint(key) + '.json');
const posix = process.platform !== 'win32';
const must = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { assert.ok(r.ok, JSON.stringify(r)); return r as Extract<T, { ok: true }>; };
const SRC = (id: string, digest: string) => ({ app: 'copilot', session: id, role: 'agent' as const, ord: 0, digest, at: new Date().toISOString() });

async function main(): Promise<void> {
  // AC1: one file per folder, modes, no folder path inside
  {
    const dir = fresh();
    const s = new NotesStore(dir);
    const w = must(await s.add(FOLDER, 'demo', { text: '# Hello\n\nbody' }));
    assert.strictEqual(w.fingerprint, folderFingerprint(FOLDER));
    assert.deepStrictEqual(fs.readdirSync(dir), [folderFingerprint(FOLDER) + '.json'], 'one file, no temp file left');
    assert.ok(!read(dir).includes(FOLDER) && !read(dir).includes('someone'), 'no folder path in the file');
    assert.ok(read(dir).includes('"folderName":"demo"'), 'the display name is');
    if (posix) {
      assert.strictEqual(fs.statSync(dir).mode & 0o777, 0o700, 'the notes folder is owner-only');
      assert.strictEqual(fs.statSync(fileOf(dir)).mode & 0o777, 0o600, 'the file is 0600');
    }
    const other = must(await s.add('/home/someone/other', 'other', { text: 'second folder' }));
    assert.notStrictEqual(other.fingerprint, w.fingerprint, 'a folder of its own');
    const l = await s.list(FOLDER);
    assert.ok(l.ok && l.notes.length === 1 && l.notes[0].title === 'Hello' && l.max === 300);
    // a folder created group-readable is tightened
    if (posix) {
      const d2 = fresh();
      fs.mkdirSync(d2, { recursive: true, mode: 0o755 });
      fs.chmodSync(d2, 0o755);
      must(await new NotesStore(d2).add(FOLDER, 'demo', { text: 'x' }));
      assert.strictEqual(fs.statSync(d2).mode & 0o777, 0o700, 'an existing group-readable folder is made owner-only');
    }
    // the platform decides the key: Windows folds case
    assert.strictEqual(new NotesStore(dir, { platform: 'win32' }).fingerprintOf('C:\\Work\\App'), new NotesStore(dir, { platform: 'win32' }).fingerprintOf('c:/work/app/'));
  }

  // AC2: a crash between the temp file and the rename leaves the old file intact and no temp file
  {
    const dir = fresh();
    const good = new NotesStore(dir);
    must(await good.add(FOLDER, 'demo', { text: 'first' }));
    const before = read(dir);
    const failing = { ...fs, renameSync: () => { throw Object.assign(new Error('disk gone ' + dir), { code: 'EIO' }); } } as unknown as NotesFs;
    const bad = new NotesStore(dir, { fs: failing });
    const r = await bad.add(FOLDER, 'demo', { text: 'second' });
    assert.ok(!r.ok && r.code === 'write' && /EIO/.test(r.error) && !r.error.includes(dir), 'refused with the error code, no path');
    assert.strictEqual(read(dir), before, 'the old file is intact');
    assert.deepStrictEqual(fs.readdirSync(dir), [folderFingerprint(FOLDER) + '.json'], 'the temp file is removed');
    // the temp file is opened exclusively with 0600
    const opened: Array<[string, unknown, unknown]> = [];
    const spy = { ...fs, openSync: (p: string, f: string, m: number) => { opened.push([p, f, m]); return fs.openSync(p, f, m); } } as unknown as NotesFs;
    must(await new NotesStore(dir, { fs: spy }).add(FOLDER, 'demo', { text: 'third' }));
    const tmps = opened.filter((o) => o[0].endsWith('.tmp'));
    assert.ok(tmps.length === 1 && tmps[0][1] === 'wx' && tmps[0][2] === 0o600 && opened.every((o) => o[1] === 'wx' && o[2] === 0o600), 'a unique wx temp file with mode 0600 (and the lock file too)');
    // Windows: a rename another program blocks is tried once more after 200 ms
    let calls = 0;
    const slept: number[] = [];
    const flaky = { ...fs, renameSync: (a: string, b: string) => { if (b.endsWith('.json') && ++calls === 1) throw Object.assign(new Error('busy'), { code: 'EBUSY' }); fs.renameSync(a, b); } } as unknown as NotesFs;
    must(await new NotesStore(dir, { fs: flaky, platform: 'win32', sleep: async (ms) => { slept.push(ms); } }).add(FOLDER, 'demo', { text: 'fourth' }));
    assert.deepStrictEqual([calls, slept], [2, [200]], 'one retry after 200 ms');
    const stuck = { ...fs, renameSync: () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); } } as unknown as NotesFs;
    const r2 = await new NotesStore(dir, { fs: stuck, platform: 'win32', sleep: async () => undefined }).add(FOLDER, 'demo', { text: 'fifth' });
    assert.ok(!r2.ok && r2.code === 'write', 'a second refusal is reported');
    const r3 = await new NotesStore(dir, { fs: stuck, platform: 'linux', sleep: async () => { throw new Error('no retry off Windows'); } }).add(FOLDER, 'demo', { text: 'sixth' });
    assert.ok(!r3.ok, 'no retry on POSIX');
    assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), [], 'no temp file after any failure');
  }

  // AC3 + AC8: every stored title and text is masked; the raw file has no secret; hidden says so
  {
    const dir = fresh();
    const s = new NotesStore(dir);
    const values = [KNOWN];
    const a = must(await s.save(FOLDER, 'demo', { text: `The token is ${GH}\nand ${KNOWN} too`, from: 'agent', source: SRC('sess-1', '1'.repeat(16)), values }));
    const b = must(await s.add(FOLDER, 'demo', { text: `typed ${GH}`, title: `Title with ${KNOWN}`, values }));
    const c = must(await s.add(FOLDER, 'demo', { text: 'clean note', values }));
    const u = must(await s.update(FOLDER, 'demo', c.note!.id, 1, { text: `edit ${GH}`, title: `Renamed ${KNOWN}`, values }));
    const sel = must(await s.save(FOLDER, 'demo', { text: `**${GH.slice(0, 2)}**${GH.slice(2)}`, from: 'selection', source: SRC('sess-1', '2'.repeat(16)), values }));
    const raw = read(dir);
    for (const secret of [GH, GH.slice(6, 18), KNOWN, 'plain-value', GH.slice(-12)]) assert.ok(!raw.includes(secret), `the raw file has no ${secret.slice(0, 6)}...`);
    assert.ok(a.note!.hidden && b.note!.hidden && u.note!.hidden && sel.note!.hidden, 'masked notes are hidden');
    assert.ok(!c.note!.hidden, 'a clean note is not hidden (AC8)');
    assert.ok(a.note!.text.includes('[redacted]') && a.note!.title.length > 0 && !a.note!.title.includes(GH.slice(6, 18)));
    assert.ok(!JSON.stringify(a).includes(GH), 'the answer to the window has no secret either');
    // the mask works with no values given too (the shapes), and masks the title the window typed
    const t = must(await s.add(FOLDER, 'demo', { text: 'x', title: `t ${GH}` }));
    assert.ok(!t.note!.title.includes(GH.slice(6, 18)));
  }

  // mask, then cut: a token across the 16,000 cut leaves no head
  {
    const dir = fresh();
    const s = new NotesStore(dir);
    const room = NOTES_LIMITS.textChars - CUT_LINE.length - 2;
    const filler = 'word '.repeat(Math.floor((room - 10) / 5)) + 'w'.repeat((room - 10) % 5);
    const w = must(await s.add(FOLDER, 'demo', { text: filler + GH + ' tail'.repeat(60) }));
    assert.ok(w.note!.text.endsWith(CUT_LINE) && w.note!.text.length <= NOTES_LIMITS.textChars);
    assert.ok(!read(dir).includes('ghp_'), 'no head of the token across the cut');
    const tooBig = await s.add(FOLDER, 'demo', { text: 'y'.repeat(NOTES_LIMITS.inputChars + 1) });
    assert.ok(!tooBig.ok && tooBig.code === 'invalid', 'a text over the input cap is refused');
  }

  // dedupe (FR-011), stale (FR-008), delete and tombstones
  {
    const dir = fresh();
    const s = new NotesStore(dir);
    const a = must(await s.save(FOLDER, 'demo', { text: 'plan', from: 'agent', source: SRC('s1', 'a'.repeat(16)) }));
    const again = must(await s.save(FOLDER, 'demo', { text: 'plan', from: 'agent', source: SRC('s1', 'a'.repeat(16)) }));
    assert.ok(again.existing && again.note!.id === a.note!.id, 'the same message twice: no second note');
    assert.strictEqual(((await s.list(FOLDER)) as { notes: Note[] }).notes.length, 1);
    const u = must(await s.update(FOLDER, 'demo', a.note!.id, 1, { done: true }));
    const stale = await s.update(FOLDER, 'demo', a.note!.id, 1, { title: 'mine' });
    assert.ok(!stale.ok && stale.code === 'stale' && stale.current!.rev === u.note!.rev && stale.current!.done, 'stale: refused, with the saved note');
    const staleDel = await s.remove(FOLDER, 'demo', a.note!.id, 1);
    assert.ok(!staleDel.ok && staleDel.code === 'stale');
    must(await s.remove(FOLDER, 'demo', a.note!.id, 2));
    assert.ok(JSON.parse(read(dir)).tombstones.length === 1, 'a tombstone stays');
    const gone = await s.remove(FOLDER, 'demo', a.note!.id, 2);
    assert.ok(!gone.ok && gone.code === 'missing');
    must(await s.add(FOLDER, 'demo', { text: 'one' }));
    must(await s.add(FOLDER, 'demo', { text: 'two' }));
    must(await s.removeAll(FOLDER, 'demo'));
    const l = await s.list(FOLDER);
    assert.ok(l.ok && l.notes.length === 0 && JSON.parse(read(dir)).tombstones.length === 3);
    // onChanged fires once per change that reached the disk
    const seen: string[] = [];
    const s2 = new NotesStore(dir, { onChanged: (fp) => seen.push(fp) });
    must(await s2.add(FOLDER, 'demo', { text: 'x' }));
    await s2.list(FOLDER);
    const bad = await s2.update(FOLDER, 'demo', 'n-' + 'z'.repeat(12), 1, { done: true });
    assert.ok(!bad.ok);
    assert.deepStrictEqual(seen, [folderFingerprint(FOLDER)], 'one event, for the change, not for a read or a refusal');
  }

  // AC4: a file Durbar cannot read is never written over
  {
    const cases: Array<[string, (file: string) => void]> = [
      ['invalid JSON', (f) => fs.writeFileSync(f, '{"version":1,"notes":[', { mode: 0o600 })],
      ['unknown version', (f) => fs.writeFileSync(f, JSON.stringify({ version: 9, notes: [{ id: 'later' }] }), { mode: 0o600 })],
      ['over the cap', (f) => fs.writeFileSync(f, ' '.repeat(NOTES_LIMITS.storeBytes + 1), { mode: 0o600 })],
      ['a directory', (f) => fs.mkdirSync(f)],
    ];
    // a link to a VALID notes document is still not a regular file: it is left alone (a link could point anywhere)
    if (posix) cases.push(['a link', (f) => { fs.writeFileSync(f + '.target', serializeNotesDoc(emptyNotesDoc('linked')), { mode: 0o600 }); fs.symlinkSync(f + '.target', f); }]);
    for (const [name, plant] of cases) {
      const dir = fresh();
      fs.mkdirSync(dir, { recursive: true });
      plant(fileOf(dir));
      const s = new NotesStore(dir);
      const l = await s.list(FOLDER);
      assert.ok(!l.ok && l.code === 'unreadable' && /could not read the notes file/.test(l.error), `${name}: listed as unreadable with the reason`);
      for (const w of [await s.add(FOLDER, 'demo', { text: 'x' }), await s.save(FOLDER, 'demo', { text: 'x', from: 'user' }), await s.update(FOLDER, 'demo', 'n-' + 'a'.repeat(12), 1, { done: true }), await s.removeAll(FOLDER, 'demo')]) {
        assert.ok(!w.ok && w.code === 'unreadable', `${name}: a change is refused`);
      }
      const names = fs.readdirSync(dir).sort();
      assert.deepStrictEqual(names.filter((x) => !x.endsWith('.target')), [folderFingerprint(FOLDER) + '.json'], `${name}: nothing else was written`);
      if (name === 'invalid JSON') assert.strictEqual(read(dir), '{"version":1,"notes":[', 'the corrupt file is byte for byte as it was');
      if (name === 'unknown version') assert.ok(read(dir).includes('later'));
    }
    // a file with a note it cannot parse: the good ones show, nothing is written
    const dir = fresh();
    fs.mkdirSync(dir, { recursive: true });
    const good = must(await new NotesStore(fresh()).add(FOLDER, 'demo', { text: 'fine' })).note!;
    fs.writeFileSync(fileOf(dir), JSON.stringify({ version: 1, notes: [good, { id: 'n-broken' }] }), { mode: 0o600 });
    const before = read(dir);
    const s = new NotesStore(dir);
    const l = await s.list(FOLDER);
    assert.ok(l.ok && l.notes.length === 1 && /could not be read/.test(l.readOnly ?? ''), 'good notes listed, read-only with the reason');
    const w = await s.add(FOLDER, 'demo', { text: 'x' });
    assert.ok(!w.ok && w.code === 'unreadable');
    assert.strictEqual(read(dir), before, 'the file with an unreadable note is left as it is');
    // Start over: the file is renamed aside (0600), the folder starts empty
    const seen: string[] = [];
    const so = new NotesStore(dir, { now: () => new Date('2026-10-24T10:11:12.000Z'), onChanged: (fp) => seen.push(fp) });
    must(await so.startOver(FOLDER));
    const aside = fs.readdirSync(dir);
    assert.deepStrictEqual(aside, [folderFingerprint(FOLDER) + '.json.bad-20261024T101112Z']);
    assert.strictEqual(fs.readFileSync(path.join(dir, aside[0]), 'utf8'), before, 'the old file is kept whole');
    if (posix) assert.strictEqual(fs.statSync(path.join(dir, aside[0])).mode & 0o777, 0o600);
    assert.ok(((await so.list(FOLDER)) as { notes: Note[] }).notes.length === 0, 'and the folder starts empty');
    must(await so.add(FOLDER, 'demo', { text: 'new start' }));
    assert.ok(seen.length === 2);
  }

  // AC5 + AC6: two stores (two processes) on one file: merge by id, stale refused, nothing lost; writes queue
  {
    const dir = fresh();
    const A = new NotesStore(dir);
    const B = new NotesStore(dir);
    await A.list(FOLDER);
    await B.list(FOLDER);
    const a1 = must(await A.add(FOLDER, 'demo', { text: 'from A' })).note!;
    const b1 = must(await B.add(FOLDER, 'demo', { text: 'from B' })).note!; // B had read the empty file: it must re-read and merge, not overwrite
    let l = (await B.list(FOLDER)) as { notes: Note[] };
    assert.deepStrictEqual(l.notes.map((x) => x.text).sort(), ['from A', 'from B'], 'a concurrent edit is not lost');
    // B edits a note A changed: stale
    must(await A.update(FOLDER, 'demo', a1.id, 1, { text: 'A edit' }));
    const st = await B.update(FOLDER, 'demo', a1.id, 1, { text: 'B edit' });
    assert.ok(!st.ok && st.code === 'stale' && st.current!.text === 'A edit');
    // A deletes b1; B (stale copy) cannot bring it back
    must(await A.remove(FOLDER, 'demo', b1.id, 1));
    l = (await B.list(FOLDER)) as { notes: Note[] };
    assert.deepStrictEqual(l.notes.map((x) => x.text), ['A edit']);
    // 200 interleaved operations
    let rs = 99;
    const rnd = (k: number): number => { rs = (Math.imul(rs, 1103515245) + 12345) >>> 0; return Math.floor((rs / 4294967296) * k); };
    const expected = new Map<string, string>([[a1.id, 'A edit']]);
    for (let i = 0; i < 200; i++) {
      const st2 = rnd(2) ? A : B;
      const cur = (await st2.list(FOLDER)) as { notes: Note[] };
      const r = rnd(10);
      if (r < 5 || !cur.notes.length) { const w = await st2.add(FOLDER, 'demo', { text: 'op ' + i }); if (w.ok) expected.set(w.note!.id, 'op ' + i); }
      else if (r < 8) { const t = cur.notes[rnd(cur.notes.length)]; const w = await st2.update(FOLDER, 'demo', t.id, t.rev, { text: 'ed ' + i }); if (w.ok) expected.set(t.id, 'ed ' + i); }
      else { const t = cur.notes[rnd(cur.notes.length)]; const w = await st2.remove(FOLDER, 'demo', t.id, t.rev); if (w.ok) expected.delete(t.id); }
      if (rnd(3) === 0) await (rnd(2) ? A : B).list(FOLDER); // the other one reads in between
    }
    const finalL = (await new NotesStore(dir).list(FOLDER)) as { notes: Note[] };
    assert.deepStrictEqual(finalL.notes.map((x) => [x.id, x.text]).sort(), [...expected].sort(), '200 interleaved operations on two stores: no note lost, none brought back');
    // AC6: two saves started together both land
    const dir2 = fresh();
    const Q = new NotesStore(dir2);
    let finished = false;
    process.on('exit', () => { if (!finished) { console.error('test-notesstore: the queue test never finished'); process.exitCode = 1; } });
    const [r1, r2] = await Promise.all([Q.add(FOLDER, 'demo', { text: 'q1' }), Q.add(FOLDER, 'demo', { text: 'q2' }), Q.add(FOLDER, 'demo', { text: 'q3' })]);
    finished = true;
    assert.ok(r1.ok && r2.ok);
    assert.deepStrictEqual(((await Q.list(FOLDER)) as { notes: Note[] }).notes.map((x) => x.text).sort(), ['q1', 'q2', 'q3'], 'three saves started together all land');
  }

  // AC9: the mirror is persisted with the document, and a fresh store sees it
  {
    const dir = fresh();
    const s = new NotesStore(dir);
    must(await s.add(FOLDER, 'demo', { text: 'x' }));
    const m = { sha256: 'ab'.repeat(32), bytes: 123, at: '2026-10-24T10:00:00.000Z' };
    must(await s.setMirror(FOLDER, 'demo', m));
    assert.deepStrictEqual(JSON.parse(read(dir)).mirror, m, 'written with the document');
    const restarted = new NotesStore(dir);
    assert.deepStrictEqual(await restarted.getMirror(FOLDER), m, 'after a restart the store knows its own file');
    must(await restarted.add(FOLDER, 'demo', { text: 'y' }));
    assert.deepStrictEqual(await restarted.getMirror(FOLDER), m, 'a later write keeps it');
    must(await restarted.setMirror(FOLDER, 'demo', undefined));
    assert.strictEqual(await new NotesStore(dir).getMirror(FOLDER), undefined);
    if (posix) assert.strictEqual(fs.statSync(fileOf(dir)).mode & 0o777, 0o600);
  }

  // at the caps: 300 notes of 16,000 three-byte characters with quotes and backslashes writes and reads back; the 301st is refused
  {
    const dir = fresh();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const piece = '\u20ac"\\\t<!-- durbar-note id=x -->\n';
    let text = '';
    while (text.length < NOTES_LIMITS.textChars) text += piece;
    text = text.slice(0, NOTES_LIMITS.textChars);
    const doc: NotesDoc = emptyNotesDoc('d'.repeat(NOTES_LIMITS.folderNameChars));
    for (let i = 0; i < NOTES_LIMITS.notesPerFolder; i++) {
      doc.notes.push({ id: 'n-' + String(i).padStart(12, '0'), title: '"'.repeat(NOTES_LIMITS.titleChars), text, createdAt: '2026-10-24T10:00:00.000Z', updatedAt: '2026-10-24T10:00:00.000Z', rev: 999999999, done: true, from: 'agent', fileEdited: true, hidden: true, source: { app: 'copilot', session: 'a'.repeat(100), role: 'agent', ord: NOTES_LIMITS.ordMax, digest: 'f'.repeat(16), at: '2026-10-24T10:00:00.000Z' } });
      doc.tombstones.push({ id: 'n-' + String(i + 1000).padStart(12, '0'), deletedAt: '2026-10-24T10:00:00.000Z' });
    }
    doc.mirror = { sha256: 'f'.repeat(64), bytes: NOTES_LIMITS.mdBytes, at: '2026-10-24T10:00:00.000Z' };
    fs.writeFileSync(fileOf(dir), serializeNotesDoc(doc), { mode: 0o600 });
    const size = fs.statSync(fileOf(dir)).size;
    assert.ok(size <= NOTES_LIMITS.storeBytes, `the full file (${size}) is within the cap (${NOTES_LIMITS.storeBytes})`);
    const s = new NotesStore(dir);
    const l = await s.list(FOLDER);
    assert.ok(l.ok && l.notes.length === 300 && !l.readOnly, 'a folder at every cap is read');
    const over = await s.add(FOLDER, 'demo', { text: 'the 301st' });
    assert.ok(!over.ok && over.code === 'cap' && /300 notes/.test(over.error), 'the 301st note is refused with the reason');
    assert.strictEqual(fs.statSync(fileOf(dir)).size, size, 'and the file is as it was');
    // a change at the cap writes and reads back (one more tombstone is dropped oldest first; the tombstone count stays at the cap)
    const first = l.notes[0];
    must(await s.update(FOLDER, 'demo', first.id, first.rev, { done: false }));
    const back = (await new NotesStore(dir).list(FOLDER)) as { ok: true; notes: Note[] };
    assert.ok(back.ok && back.notes.length === 300 && back.notes.find((x) => x.id === first.id)!.done === false);
    // a document over the byte cap is not written at all (the store's own count check stops at 300 notes, so the bytes are the last line)
    const huge: NotesDoc = { ...doc, notes: [...doc.notes, ...doc.notes.concat(doc.notes).map((x, i) => ({ ...x, id: 'n-' + String(5000 + i).padStart(12, '0') }))] };
    assert.ok(Buffer.byteLength(serializeNotesDoc(huge)) > NOTES_LIMITS.storeBytes, 'the test document is over the cap');
    const w = await (s as unknown as { commit(fp: string, d: NotesDoc): Promise<{ ok: boolean; code?: string }> }).commit(folderFingerprint(FOLDER), huge);
    assert.ok(!w.ok && w.code === 'cap', 'over the byte cap: refused before any write');
    assert.ok(fs.statSync(fileOf(dir)).size <= NOTES_LIMITS.storeBytes, 'the file on disk is still readable');
    assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
  }


  // controls are removed BEFORE the mask: a token and a known value split by a control character never reach the disk (FR-005, FR-006)
  {
    const dir = fresh();
    const s = new NotesStore(dir);
    const seps = ['\u0001', '\u001b', '\u0085', '\u007f', '\u000b'];
    const base = must(await s.add(FOLDER, 'demo', { text: 'to be edited' })).note!;
    let rev = base.rev;
    for (const sep of seps) {
      const splitTok = GH.slice(0, 12) + sep + GH.slice(12);
      const splitVal = KNOWN.slice(0, 9) + sep + KNOWN.slice(9);
      const saved = must(await s.save(FOLDER, 'demo', { text: `${splitTok} and ${splitVal}`, from: 'user', source: SRC('sess-1', (seps.indexOf(sep) + 1).toString(16).repeat(16)), values: [KNOWN] }));
      assert.ok(saved.note!.hidden && !/ghp_|a1B2c3|plain-value|hunter2/.test(saved.note!.title + saved.note!.text), `save: split by U+${sep.charCodeAt(0).toString(16)} masked, title included: ${saved.note!.title}`);
      const up = must(await s.update(FOLDER, 'demo', base.id, rev, { text: `${splitTok} ${splitVal}`, values: [KNOWN] }));
      rev = up.note!.rev;
      assert.ok(!/ghp_|a1B2c3|plain-value|hunter2/.test(up.note!.text), 'update: masked');
      const typed = must(await s.add(FOLDER, 'demo', { text: `# ${splitTok}\n\nbody`, values: [KNOWN] }));
      assert.ok(!/ghp_|a1B2c3/.test(typed.note!.title), 'the guessed title has no secret');
    }
    const raw = read(dir);
    for (const secret of [GH, GH.slice(0, 12), GH.slice(12), 'a1B2c3', KNOWN, 'plain-value', 'hunter2']) assert.ok(!raw.includes(secret), `the raw file has no ${secret.slice(0, 5)}...`);
    for (const t of [await s.add(FOLDER, 'demo', { text: 'x', title: 'a\u0001b' }), await s.update(FOLDER, 'demo', base.id, rev, { title: 'a\nb' })]) assert.ok(!t.ok && t.code === 'invalid' && /control characters/.test(t.error), 'a typed title with a control character is refused');
  }

  // Start over only for a file Durbar cannot read
  {
    const dir = fresh();
    const s = new NotesStore(dir);
    must(await s.add(FOLDER, 'demo', { text: 'fine' }));
    const before = read(dir);
    const r = await s.startOver(FOLDER);
    assert.ok(!r.ok && r.code === 'invalid', 'a readable file: nothing to start over');
    assert.strictEqual(read(dir), before);
    const none = await new NotesStore(fresh()).startOver(FOLDER);
    assert.ok(!none.ok, 'no file: nothing to start over');
    assert.deepStrictEqual(fs.readdirSync(dir), [folderFingerprint(FOLDER) + '.json'], 'nothing was moved');
  }

  // a file that disappeared after this process saw it is an empty document, not the cache
  {
    const dir = fresh();
    const s = new NotesStore(dir);
    must(await s.add(FOLDER, 'demo', { text: 'one' }));
    must(await s.add(FOLDER, 'demo', { text: 'two' }));
    fs.unlinkSync(fileOf(dir));
    const l = await s.list(FOLDER);
    assert.ok(l.ok && l.notes.length === 0, 'gone from disk: empty');
    must(await s.add(FOLDER, 'demo', { text: 'three' }));
    assert.deepStrictEqual(((await new NotesStore(dir).list(FOLDER)) as { notes: Note[] }).notes.map((x) => x.text), ['three'], 'the deleted notes do not come back');
  }

  // cross-process writes: a lock file around read, write and rename; two real processes, no lost note
  {
    const dir = fresh();
    const worker = path.join(__dirname, 'notes-worker.js');
    const run = (tag: string): Promise<{ code: number | null; err: string }> => new Promise((resolve) => {
      const c = spawn(process.execPath, [worker, dir, FOLDER, tag, '25'], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      c.stderr.on('data', (d) => { err += String(d); });
      c.on('close', (code) => resolve({ code, err }));
    });
    const results = await Promise.all([run('P'), run('Q')]);
    assert.deepStrictEqual(results.map((r) => r.code), [0, 0], `both processes finished: ${results.map((r) => r.err).join('')}`);
    const l = (await new NotesStore(dir).list(FOLDER)) as { notes: Note[] };
    assert.deepStrictEqual(l.notes.map((x) => x.text).sort(), [...Array.from({ length: 25 }, (_x, i) => `P note ${i}`), ...Array.from({ length: 25 }, (_x, i) => `Q note ${i}`)].sort(), 'two processes writing at once: 50 notes, none lost');
    assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.lock') || f.endsWith('.tmp')), [], 'no lock or temp file is left');
    // a crashed process's lock (older than 5 s) is taken over; a fresh one makes the change wait, then refuses
    const lock = path.join(dir, folderFingerprint(FOLDER) + '.lock');
    fs.writeFileSync(lock, '');
    const old = new Date(Date.now() - 10_000);
    fs.utimesSync(lock, old, old);
    must(await new NotesStore(dir).add(FOLDER, 'demo', { text: 'after a stale lock' }));
    assert.ok(!fs.existsSync(lock), 'the stale lock was taken over and released');
    fs.writeFileSync(lock, '');
    const t0 = Date.now();
    const busy = await new NotesStore(dir).add(FOLDER, 'demo', { text: 'blocked' });
    assert.ok(!busy.ok && busy.code === 'write' && /busy/.test(busy.error) && Date.now() - t0 >= 1800 && Date.now() - t0 < 6000, 'a fresh lock: retried for about 2 s, then refused');
    assert.ok(fs.existsSync(lock), "someone else's lock is not removed");
    fs.unlinkSync(lock);
  }


  // a stale lock that cannot be removed or moved (EPERM): the writer waits and refuses after about 2 s, it never spins
  {
    const dir = fresh();
    must(await new NotesStore(dir).add(FOLDER, 'demo', { text: 'seed' }));
    const lock = path.join(dir, folderFingerprint(FOLDER) + '.lock');
    const plantOld = (): void => { fs.writeFileSync(lock, ''); const old = new Date(Date.now() - 60_000); fs.utimesSync(lock, old, old); };
    plantOld();
    let attempts = 0;
    const eperm = (): never => { throw Object.assign(new Error('not permitted'), { code: 'EPERM' }); };
    const spin = (): void => { if (attempts > 1000) { console.error('test-notesstore: the lock loop spins instead of waiting'); process.exit(1); } }; // a sync loop cannot be timed out, so the fake ends the run
    const stuck = { ...fs, unlinkSync: (f: string) => { if (f.includes('.lock')) { attempts++; spin(); eperm(); } fs.unlinkSync(f); }, renameSync: (a: string, b: string) => { if (a.includes('.lock')) { attempts++; spin(); eperm(); } fs.renameSync(a, b); } } as unknown as NotesFs;
    const t0 = Date.now();
    const r = await new NotesStore(dir, { fs: stuck }).add(FOLDER, 'demo', { text: 'cannot lock' });
    const took = Date.now() - t0;
    assert.ok(!r.ok && r.code === 'write' && /busy/.test(r.error), `refused as busy: ${JSON.stringify(r)}`);
    assert.ok(took >= 1800 && took < 6000, `after about 2 s (${took} ms)`);
    assert.ok(attempts <= 110, `no more than about 100 attempts to remove it (${attempts})`);
    // the lock cannot even be looked at (EACCES): the same wait, then busy
    attempts = 0;
    const blind = { ...fs, lstatSync: (f: string) => { if (f.includes('.lock')) { attempts++; spin(); throw Object.assign(new Error('denied'), { code: 'EACCES' }); } return fs.lstatSync(f); } } as unknown as NotesFs;
    const t1 = Date.now();
    const rb = await new NotesStore(dir, { fs: blind }).add(FOLDER, 'demo', { text: 'cannot look' });
    assert.ok(!rb.ok && /busy/.test(rb.error) && Date.now() - t1 >= 1800 && attempts <= 110, `lstat denied: busy after about 2 s, ${attempts} looks`);
    // create always says EEXIST while lstat and the move always say ENOENT (a lock that is "there" and "gone" at once): busy at about 2 s, no spinning
    for (const [what, gone] of [['lstat ENOENT', 'lstat'], ['move ENOENT', 'rename']] as const) {
      fs.rmSync(lock, { force: true });
      plantOld(); // old enough to be judged stale, so the move path is reached
      attempts = 0;
      const enoent = (): never => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); };
      const flip = { ...fs,
        openSync: (f: string, fl: string, m: number) => { if (f.endsWith('.lock')) { attempts++; spin(); throw Object.assign(new Error('exists'), { code: 'EEXIST' }); } return fs.openSync(f, fl, m); },
        lstatSync: (f: string) => (gone === 'lstat' && f.endsWith('.lock') ? enoent() : fs.lstatSync(f)),
        renameSync: (a: string, b: string) => { if (a.endsWith('.lock') && b.includes('.stale-')) enoent(); fs.renameSync(a, b); },
      } as unknown as NotesFs;
      const t3 = Date.now();
      const rf = await new NotesStore(dir, { fs: flip }).add(FOLDER, 'demo', { text: 'flip flop' });
      const took3 = Date.now() - t3;
      assert.ok(!rf.ok && /busy/.test(rf.error) && took3 >= 1800 && took3 < 6000 && attempts <= 400, `${what}: busy after about 2 s (${took3} ms, ${attempts} tries)`);
    }
    fs.rmSync(lock, { force: true });
    // the lock cannot be created (EPERM, EACCES, EBUSY: on Windows a delete-pending lock): wait like for a busy lock, never refuse at once, never spin
    for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
      fs.rmSync(lock, { force: true });
      attempts = 0;
      const denied = { ...fs, openSync: (f: string, fl: string, m: number) => { if (f.endsWith('.lock')) { attempts++; spin(); throw Object.assign(new Error('denied'), { code }); } return fs.openSync(f, fl, m); } } as unknown as NotesFs;
      const t2 = Date.now();
      const rd = await new NotesStore(dir, { fs: denied }).add(FOLDER, 'demo', { text: 'cannot create' });
      assert.ok(!rd.ok && /busy/.test(rd.error) && Date.now() - t2 >= 1800 && attempts <= 110, `${code} on create: busy after about 2 s, ${attempts} tries`);
      let first = true;
      const once = { ...fs, openSync: (f: string, fl: string, m: number) => { if (f.endsWith('.lock') && first) { first = false; throw Object.assign(new Error('delete pending'), { code }); } return fs.openSync(f, fl, m); } } as unknown as NotesFs;
      must(await new NotesStore(dir, { fs: once }).add(FOLDER, 'demo', { text: 'after ' + code }));
    }
    const other = { ...fs, openSync: (f: string, fl: string, m: number) => { if (f.endsWith('.lock')) throw Object.assign(new Error('no space'), { code: 'ENOSPC' }); return fs.openSync(f, fl, m); } } as unknown as NotesFs;
    const ro = await new NotesStore(dir, { fs: other }).add(FOLDER, 'demo', { text: 'disk full' });
    assert.ok(!ro.ok && /ENOSPC/.test(ro.error), 'any other error refuses at once with its code');
    fs.rmSync(lock, { force: true });
    // the put-back never overwrites a newcomer's lock
    plantOld();
    let hooked = false;
    const newcomer = { ...fs, renameSync: (a: string, b: string) => { fs.renameSync(a, b); if (a.endsWith('.lock') && b.includes('.stale-') && !hooked) { hooked = true; fs.writeFileSync(lock, 'NEWCOMER'); const fresh = new Date(); fs.utimesSync(b, fresh, fresh); } } } as unknown as NotesFs;
    const nc = await new NotesStore(dir, { fs: newcomer }).add(FOLDER, 'demo', { text: 'third process in between' });
    assert.ok(!nc.ok && /busy/.test(nc.error), 'the identity check fails and a newcomer holds the lock: busy');
    assert.strictEqual(fs.readFileSync(lock, 'utf8'), 'NEWCOMER', "the newcomer's lock was not overwritten or deleted");
    fs.rmSync(lock, { force: true });
    // only the unlink fails (the move works): the stale lock is taken over, the leftover aside file is harmless
    const noUnlink = { ...fs, unlinkSync: (f: string) => { if (f.includes('.lock')) eperm(); fs.unlinkSync(f); } } as unknown as NotesFs;
    must(await new NotesStore(dir, { fs: noUnlink }).add(FOLDER, 'demo', { text: 'taken over' }));
    // someone else took the stale lock over first: the move says ENOENT, we try again at once
    fs.rmSync(lock, { force: true });
    for (const f of fs.readdirSync(dir)) if (f.includes('.stale-')) fs.unlinkSync(path.join(dir, f));
    plantOld();
    let moved = 0;
    const raced = { ...fs, renameSync: (a: string, b: string) => { if (a.endsWith('.lock') && moved++ === 0) { fs.unlinkSync(a); throw Object.assign(new Error('gone'), { code: 'ENOENT' }); } fs.renameSync(a, b); } } as unknown as NotesFs;
    must(await new NotesStore(dir, { fs: raced }).add(FOLDER, 'demo', { text: 'after a race' }));
    // the lock judged stale is replaced by a fresh one before the move: the fresh one is put back, not deleted
    fs.rmSync(lock, { force: true });
    plantOld();
    const swapped = { ...fs, renameSync: (a: string, b: string) => { if (a.endsWith('.lock') && b.includes('.stale-')) { fs.unlinkSync(a); fs.writeFileSync(a, ''); } fs.renameSync(a, b); } } as unknown as NotesFs;
    const sw = await new NotesStore(dir, { fs: swapped }).add(FOLDER, 'demo', { text: 'fresh lock held by someone' });
    assert.ok(!sw.ok && /busy/.test(sw.error) && fs.existsSync(lock), 'a fresh lock taken in between is put back and respected');
    fs.rmSync(lock, { force: true });
    // issue #723: B judged the lock stale, but before its move another process took it over and now holds a FRESH lock. B must not touch
    // that lock at all (moving it away opens a gap where a third process creates its own: two writers, a lost note)
    {
      plantOld();
      const touched: string[] = [];
      let swappedIn = false;
      const rival = { ...fs,
        lstatSync: (f: string, o?: unknown) => { const r = (fs.lstatSync as (f: string, o?: unknown) => unknown)(f, o); if (f === lock && !swappedIn) { swappedIn = true; fs.unlinkSync(lock); fs.writeFileSync(lock, 'A-LIVE'); } return r; },
        renameSync: (a: string, b: string) => { if (a === lock) touched.push('rename'); fs.renameSync(a, b); },
        unlinkSync: (f: string) => { if (f === lock) touched.push('unlink'); fs.unlinkSync(f); },
        linkSync: (a: string, b: string) => { if (b === lock) touched.push('link'); fs.linkSync(a, b); } } as unknown as NotesFs;
      const r7 = await new NotesStore(dir, { fs: rival }).add(FOLDER, 'demo', { text: 'must wait for A' });
      assert.ok(!r7.ok && /busy/.test(r7.error), 'a fresh lock taken over in between: busy');
      assert.deepStrictEqual(touched, [], "the other process's fresh lock was never moved, put back or deleted");
      assert.strictEqual(fs.readFileSync(lock, 'utf8'), 'A-LIVE', "A's lock is intact");
      fs.rmSync(lock, { force: true });
    }
    // issue #723: somebody else is breaking the stale lock right now (a fresh takeover guard): wait, do not break it too
    {
      plantOld();
      const guard = path.join(dir, folderFingerprint(FOLDER) + '.takeover');
      fs.writeFileSync(guard, '');
      const g = await new NotesStore(dir).add(FOLDER, 'demo', { text: 'guard held' });
      assert.ok(!g.ok && /busy/.test(g.error) && fs.existsSync(lock) && fs.existsSync(guard), "another process's takeover guard is respected: busy, lock and guard untouched");
      // a crashed taker's guard (older than 5 s) is removed and the takeover goes on
      const oldG = new Date(Date.now() - 10_000);
      fs.utimesSync(guard, oldG, oldG);
      plantOld();
      const ops: string[] = [];
      const watch = { ...fs,
        openSync: (f: string, fl: string, m: number) => { if (f === guard) ops.push('open:' + fl); return fs.openSync(f, fl, m); },
        renameSync: (a: string, b: string) => { if (a === guard) ops.push('rename:' + (b.includes('.takeover.stale-') ? 'aside' : b.includes('.takeover.rel-') ? 'release' : 'other')); fs.renameSync(a, b); } } as unknown as NotesFs;
      must(await new NotesStore(dir, { fs: watch }).add(FOLDER, 'demo', { text: 'after a stale guard' }));
      assert.deepStrictEqual(ops, ['open:wx', 'rename:aside', 'open:wx', 'rename:release'], 'a stale guard is moved aside (identity checked) and a new one is created with wx, never taken over in place; our own is released by a move');
      assert.ok(!fs.existsSync(guard) && !fs.existsSync(lock), 'a stale guard does not block for good');
    }
    // issue #723: the stale guard is replaced by another process's FRESH guard between our look and our move: ours must not end up deleting it
    {
      fs.rmSync(path.join(dir, folderFingerprint(FOLDER) + '.takeover'), { force: true });
      const guard = path.join(dir, folderFingerprint(FOLDER) + '.takeover');
      plantOld();
      fs.writeFileSync(guard, '');
      const oldG = new Date(Date.now() - 60_000);
      fs.utimesSync(guard, oldG, oldG);
      let staged = false;
      const created: string[] = [];
      const y = { ...fs,
        lstatSync: (f: string, o?: unknown) => { const r = (fs.lstatSync as (f: string, o?: unknown) => unknown)(f, o); if (f === guard && !staged) { staged = true; fs.unlinkSync(guard); fs.writeFileSync(guard, 'Z-HOLDS'); } return r; },
        openSync: (f: string, fl: string, m: number) => { const fd = fs.openSync(f, fl, m); if (f === guard) created.push('guard'); return fd; } } as unknown as NotesFs;
      const r8 = await new NotesStore(dir, { fs: y }).add(FOLDER, 'demo', { text: 'y' });
      assert.ok(!r8.ok && /busy/.test(r8.error), "Z's fresh guard is respected: busy");
      assert.deepStrictEqual(created, [], 'no second guard was created while Z holds one');
      assert.strictEqual(fs.readFileSync(guard, 'utf8'), 'Z-HOLDS', "Z's guard is intact");
      fs.rmSync(guard, { force: true });
      fs.rmSync(lock, { force: true });
    }
    // a guard is released only while it still holds our token
    {
      const guard = path.join(dir, folderFingerprint(FOLDER) + '.takeover');
      plantOld();
      let swapped = false;
      const g2 = { ...fs, renameSync: (a: string, b: string) => { fs.renameSync(a, b); if (a === lock && !swapped) { swapped = true; fs.rmSync(guard, { force: true }); fs.writeFileSync(guard, 'OTHER-GUARD'); } } } as unknown as NotesFs;
      must(await new NotesStore(dir, { fs: g2 }).add(FOLDER, 'demo', { text: 'guard lost while breaking' }));
      assert.strictEqual(fs.readFileSync(guard, 'utf8'), 'OTHER-GUARD', "another process's guard is not released by us");
      fs.rmSync(guard, { force: true });
    }
    // releasing: a takeover between "is it still mine?" and the delete must not cost the new owner its lock
    {
      fs.rmSync(lock, { force: true });
      let committed = false;
      let swappedLock = false;
      const swap = (): void => { if (committed && !swappedLock) { swappedLock = true; fs.rmSync(lock, { force: true }); fs.writeFileSync(lock, 'T-TOKEN'); } };
      const rel = { ...fs,
        renameSync: (a: string, b: string) => { if (b.endsWith('.json')) committed = true; if (a === lock) swap(); fs.renameSync(a, b); },
        readFileSync: (f: string, e?: unknown) => { const r = (fs.readFileSync as (f: string, e?: unknown) => unknown)(f, e); if (f === lock) swap(); return r; } } as unknown as NotesFs;
      must(await new NotesStore(dir, { fs: rel }).add(FOLDER, 'demo', { text: 'saved, then lost the lock at release' }));
      assert.ok(swappedLock, 'the takeover was staged');
      assert.strictEqual(fs.readFileSync(lock, 'utf8'), 'T-TOKEN', "the new owner's lock survived our release");
      fs.rmSync(lock, { force: true });
    }
    // breaking: the identity check compares the time as well as the inode (same inode, newer time = a different lock: put back, busy)
    {
      plantOld();
      const same = { ...fs, lstatSync: (f: string, o?: unknown) => { const r = (fs.lstatSync as (f: string, o?: unknown) => { mtimeNs?: bigint })(f, o); return f.includes('.lock.stale-') ? { ...r, mtimeNs: (r.mtimeNs ?? 0n) + 1n } : r; } } as unknown as NotesFs;
      const rr = await new NotesStore(dir, { fs: same }).add(FOLDER, 'demo', { text: 'same inode, newer time' });
      assert.ok(!rr.ok && /busy/.test(rr.error) && fs.existsSync(lock), 'same inode but another time: not the lock we judged, it is put back and respected');
      fs.rmSync(lock, { force: true });
    }
    // leftovers of a crash (.stale-* / .rel-*) older than 60 s are swept for this folder only
    {
      plantOld();
      const fpn = folderFingerprint(FOLDER);
      const mk = (name: string, ageMs: number): string => { const f = path.join(dir, name); fs.writeFileSync(f, 'x'); const t = new Date(Date.now() - ageMs); fs.utimesSync(f, t, t); return f; };
      const oldStale = mk(`${fpn}.lock.stale-12-abc`, 120_000), oldRel = mk(`${fpn}.takeover.rel-12-abc`, 120_000);
      const youngStale = mk(`${fpn}.lock.stale-13-abc`, 10_000), otherFolder = mk('ffffffffffffffffffffffffffffffff.lock.stale-12-abc', 120_000);
      const unrelated = mk(`${fpn}.lock.stale-notes`, 120_000);
      must(await new NotesStore(dir).add(FOLDER, 'demo', { text: 'sweeps leftovers' }));
      assert.ok(!fs.existsSync(oldStale) && !fs.existsSync(oldRel), 'old leftovers of this folder are gone');
      assert.ok(fs.existsSync(youngStale) && fs.existsSync(otherFolder) && fs.existsSync(unrelated), "a young leftover, another folder's file and a file of another shape stay");
      for (const f of [youngStale, otherFolder, unrelated]) fs.rmSync(f, { force: true });
    }
    // the move-aside of a release is refused (EPERM, EBUSY on Windows): our own lock is still removed, a foreign one that arrived meanwhile stays
    for (const code of ['EPERM', 'EBUSY']) {
      for (const foreign of [false, true]) {
        fs.rmSync(lock, { force: true });
        const refuse = { ...fs, renameSync: (a: string, b: string) => {
          if (a === lock && b.includes('.rel-')) {
            if (foreign) { fs.rmSync(lock, { force: true }); fs.writeFileSync(lock, 'T-TOKEN'); }
            throw Object.assign(new Error('refused'), { code });
          }
          fs.renameSync(a, b);
        } } as unknown as NotesFs;
        must(await new NotesStore(dir, { fs: refuse }).add(FOLDER, 'demo', { text: `release refused ${code} ${foreign}` }));
        if (foreign) assert.strictEqual(fs.readFileSync(lock, 'utf8'), 'T-TOKEN', `${code} on the move: a foreign lock stays`);
        else assert.ok(!fs.existsSync(lock), `${code} on the move: our own lock is removed`);
      }
    }
    fs.rmSync(lock, { force: true });
    // issue #723: a holder paused over 5 s lost its lock to a takeover; it must not write, and must not delete the new owner's lock
    {
      fs.rmSync(path.join(dir, folderFingerprint(FOLDER) + '.json'), { force: true });
      let taken = false;
      const onLock: string[] = [];
      // the lock is replaced while the holder reads the document (as if it had been paused for over 5 s)
      const slowHolder = { ...fs,
        renameSync: (a: string, b: string) => { if (a === lock) onLock.push('rename'); fs.renameSync(a, b); },
        linkSync: (a: string, b: string) => { if (b === lock) onLock.push('link'); fs.linkSync(a, b); },
        unlinkSync: (f: string) => { if (f === lock) onLock.push('unlink'); fs.unlinkSync(f); },
        lstatSync: (f: string, o?: unknown) => { if (!taken && f.endsWith('.json')) { taken = true; fs.rmSync(lock, { force: true }); fs.writeFileSync(lock, 'T-TOKEN'); } return (fs.lstatSync as (f: string, o?: unknown) => unknown)(f, o); } } as unknown as NotesFs;
      const lost = await new NotesStore(dir, { fs: slowHolder }).add(FOLDER, 'demo', { text: 'written by a holder that lost its lock' });
      assert.ok(!lost.ok && /busy/.test(lost.error), 'a holder that lost its lock does not write');
      assert.strictEqual(fs.readFileSync(lock, 'utf8'), 'T-TOKEN', "and does not delete the new owner's lock");
      assert.deepStrictEqual(onLock, [], "and does not even move, put back or delete anything on the new owner's lock path");
      assert.ok(!fs.existsSync(path.join(dir, folderFingerprint(FOLDER) + '.json')), 'nothing was written under the lost lock');
      fs.rmSync(lock, { force: true });
    }
    assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.takeover') || f.includes('.stale-')), [], 'no takeover guard or aside file is left');
    // four real processes with a stale lock in front: nobody is lost
    const dir4 = fresh();
    fs.mkdirSync(dir4, { recursive: true });
    const lock4 = path.join(dir4, folderFingerprint(FOLDER) + '.lock');
    fs.writeFileSync(lock4, '');
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lock4, old, old);
    const worker = path.join(__dirname, 'notes-worker.js');
    const runW = (tag: string): Promise<number | null> => new Promise((resolve) => { const c = spawn(process.execPath, [worker, dir4, FOLDER, tag, '10'], { stdio: 'ignore' }); c.on('close', resolve); });
    assert.deepStrictEqual(await Promise.all(['A', 'B', 'C', 'D'].map(runW)), [0, 0, 0, 0]);
    assert.strictEqual(((await new NotesStore(dir4).list(FOLDER)) as { notes: Note[] }).notes.length, 40, 'a stale lock taken over by four processes: 40 notes, none lost');
  }

  // Start over checks again under the lock: a healthy file put there in between is not moved aside
  {
    const dir = fresh();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fileOf(dir), 'not json', { mode: 0o600 });
    const healthy = serializeNotesDoc({ ...emptyNotesDoc('healthy'), notes: [] });
    let done = false;
    const hook = { ...fs, openSync: (f: string, fl: string, m: number) => { if (f.endsWith('.lock') && !done) { done = true; fs.writeFileSync(fileOf(dir), healthy); } return fs.openSync(f, fl, m); } } as unknown as NotesFs;
    const r = await new NotesStore(dir, { fs: hook }).startOver(FOLDER);
    assert.ok(!r.ok && r.code === 'invalid', `refused: ${JSON.stringify(r)}`);
    assert.strictEqual(read(dir), healthy, 'the healthy file is where it was');
    assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.includes('.bad-')), []);
  }

  // Start over: a lock lost to another process while the file is read again is not written under (no .bad- file, the other lock stays)
  {
    const dir = fresh();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fileOf(dir), 'not json', { mode: 0o600 });
    const lk = path.join(dir, folderFingerprint(FOLDER) + '.lock');
    let looks = 0;
    const hook = { ...fs, lstatSync: (f: string, o?: unknown) => { const r = (fs.lstatSync as (f: string, o?: unknown) => unknown)(f, o); if (f === fileOf(dir) && ++looks === 2) { fs.rmSync(lk, { force: true }); fs.writeFileSync(lk, 'OTHER'); } return r; } } as unknown as NotesFs;
    const r = await new NotesStore(dir, { fs: hook }).startOver(FOLDER);
    assert.ok(!r.ok && /busy/.test(r.error), `refused as busy: ${JSON.stringify(r)}`);
    assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.includes('.bad-')), [], 'the corrupt file was not moved aside');
    assert.strictEqual(fs.readFileSync(lk, 'utf8'), 'OTHER', "the other process's lock is untouched");
  }

  // a transient read error on our own lock (Windows: antivirus, EBUSY) does not refuse the write or leave the lock behind; a missing lock does
  {
    const dir = fresh();
    const lk = path.join(dir, folderFingerprint(FOLDER) + '.lock');
    let fails = 3;
    const flaky = { ...fs, readFileSync: (f: string, e?: unknown) => { if (String(f).endsWith('.lock') && fails > 0) { fails--; throw Object.assign(new Error('busy'), { code: 'EBUSY' }); } return (fs.readFileSync as (f: string, e?: unknown) => unknown)(f, e); } } as unknown as NotesFs;
    must(await new NotesStore(dir, { fs: flaky }).add(FOLDER, 'demo', { text: 'despite a flaky read' }));
    assert.ok(fails === 0 && !fs.existsSync(lk), 'the lock was read again, the note written and the lock released');
    const vanished = { ...fs, lstatSync: (f: string, o?: unknown) => { if (String(f).endsWith('.json')) fs.rmSync(lk, { force: true }); return (fs.lstatSync as (f: string, o?: unknown) => unknown)(f, o); } } as unknown as NotesFs;
    const r = await new NotesStore(dir, { fs: vanished }).add(FOLDER, 'demo', { text: 'lock vanished' });
    assert.ok(!r.ok && /busy/.test(r.error), 'a lock that is gone (ENOENT) is not ours: busy');
  }

  console.log('notes store: modes 0700/0600, atomic writes, masked on disk, corrupt files never overwritten, two stores merge, mirror persisted, caps');
}

main().then(() => fs.rmSync(root, { recursive: true, force: true }), (e) => { console.error(e); fs.rmSync(root, { recursive: true, force: true }); process.exit(1); });

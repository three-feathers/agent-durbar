/** Spec 083 T010 (FR-003, FR-004, FR-006, FR-008, SC-003, issue 699): the pure notes model. `npm run test:notes`. No credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  CAP_MESSAGE, CUT_LINE, NOTES_LIMITS, applyChange, cleanTitle, emptyNotesDoc, fitText, fitsCap, guessTitle, mergeDocs, newNoteId, orderForFolder, parseNotesDoc,
  rawDigestInput, serializeNotesDoc, stripControls, utf8Len,
} from '../src/shared/notes';
import type { Note, NotesDoc } from '../src/shared/notes';
import { redact } from '../src/shared/redact';

const T0 = new Date('2026-10-24T10:00:00.000Z');
const at = (s: number): Date => new Date(T0.getTime() + s * 1000);
let seq = 0;
const newId = (): string => 'n-' + String(++seq).padStart(12, '0');
const must = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => { assert.ok(r.ok, JSON.stringify(r)); return r as Extract<T, { ok: true }>; };

// AC1: parseNotesDoc keeps valid notes, drops a bad one, errors on a document it cannot read
const good = must(applyChange(emptyNotesDoc('Demo'), { op: 'add', text: 'Plan\n\nBody', from: 'agent', hidden: false }, T0, newId));
const raw = JSON.parse(serializeNotesDoc(good.doc));
raw.notes.push({ id: 'bad', title: 'x' }, { ...raw.notes[0], id: 'n-' + 'b'.repeat(12), title: '' }, { ...raw.notes[0], id: 'n-' + 'c'.repeat(12), from: 'robot' });
const p = parseNotesDoc(JSON.stringify(raw));
assert.ok(p.ok && p.doc.notes.length === 1 && p.dropped === 3, 'one good note kept, three bad ones dropped and counted');
assert.strictEqual(parseNotesDoc('not json').ok, false);
assert.strictEqual(parseNotesDoc('[]').ok, false);
assert.strictEqual(parseNotesDoc(JSON.stringify({ version: 2, notes: [] })).ok, false, 'unknown version');
assert.strictEqual(parseNotesDoc('x'.repeat(NOTES_LIMITS.storeBytes + 1)).ok, false, 'over the cap is not read');
const withBadSource = parseNotesDoc(JSON.stringify({ version: 1, notes: [{ ...raw.notes[0], source: { app: 'copilot', session: '../x', role: 'user', ord: 0, digest: '0'.repeat(16), at: raw.notes[0].createdAt } }] }));
assert.ok(withBadSource.ok && withBadSource.doc.notes.length === 1 && withBadSource.doc.notes[0].source === undefined, 'a note with a bad source is kept without the source');
// ids and sessions are checked, tombstones dropped when the note lives
const dupe = parseNotesDoc(JSON.stringify({ version: 1, notes: [raw.notes[0], raw.notes[0]], tombstones: [{ id: raw.notes[0].id, deletedAt: raw.notes[0].createdAt }, { id: 'zzz', deletedAt: 'x' }] }));
assert.ok(dupe.ok && dupe.doc.notes.length === 1 && dupe.doc.tombstones.length === 0, 'a duplicate id and bad tombstones are dropped');

// AC2: titles
const D = new Date(2026, 9, 24, 10, 12);
assert.strictEqual(guessTitle('# Plan for the **migration**\n\nbody', D), 'Plan for the migration');
assert.strictEqual(guessTitle('\n\n  - [ ] Ship `v2` now\nmore', D), 'Ship v2 now');
assert.strictEqual(guessTitle('1. [Docs](https://example.org/x) first', D), 'Docs first');
assert.strictEqual(guessTitle('> _quoted_ words', D), 'quoted words');
assert.strictEqual(guessTitle('release_notes and snake_case', D), 'release_notes and snake_case', 'underscores inside words stay');
assert.strictEqual(guessTitle('', D), 'Note of 24 Oct 10:12');
assert.strictEqual(guessTitle('   \n```\n', D), 'Note of 24 Oct 10:12', 'a bare fence is not a title');
const longTitle = guessTitle('word '.repeat(60), D);
assert.ok(longTitle.length <= 80 && !longTitle.endsWith(' ') && /word$/.test(longTitle), `cut at a word: ${longTitle.length}`);
assert.ok(guessTitle('x'.repeat(500), D).length <= 80, 'one long word is cut hard');
assert.strictEqual(guessTitle('a'.repeat(79) + '😀' + 'zzzz', D).length <= 80, true);
assert.ok(!/[\ud800-\udbff]$/.test(guessTitle('a'.repeat(79) + '😀' + 'zzzz', D)), 'never half a surrogate pair');
assert.strictEqual(cleanTitle('  Hello   world '), 'Hello world');
assert.strictEqual(cleanTitle(''), undefined);
assert.strictEqual(cleanTitle('   '), undefined);
assert.strictEqual(cleanTitle('a\nb'), undefined, 'a control character (a line end) is refused');
assert.strictEqual(cleanTitle('a\u0007b'), undefined);
assert.strictEqual(cleanTitle('a\tb'), undefined, 'a tab is a control character too');
assert.strictEqual(cleanTitle(42), undefined);
assert.strictEqual(cleanTitle('t'.repeat(300))!.length, NOTES_LIMITS.titleChars, 'longer than 80: cut');
assert.strictEqual(cleanTitle('t'.repeat(NOTES_LIMITS.titleInputChars + 1)), undefined, 'absurdly long: refused');

// AC8: control characters other than tab and line feed are removed; lone surrogates cannot cost 6 JSON bytes
assert.strictEqual(stripControls('a\u0000b\u0007c\td\r\ne\rf\u007fg\u0085h'), 'abc\td\ne\nfgh');
assert.strictEqual(stripControls('x\ud83dy'), 'x�y');
assert.strictEqual(stripControls('ok 😀'), 'ok 😀', 'a real pair stays');
const stored = must(applyChange(emptyNotesDoc(), { op: 'add', text: 'a\u0000b\u001bc', from: 'typed', hidden: false }, T0, newId));
assert.strictEqual(stored.note!.text, 'abc');

// AC3: applyChange
const d0 = emptyNotesDoc('F');
const a1 = must(applyChange(d0, { op: 'add', text: '# One\n\nfirst', from: 'user', hidden: true }, at(1), newId));
assert.strictEqual(a1.note!.title, 'One');
assert.strictEqual(a1.note!.rev, 1);
assert.strictEqual(a1.note!.hidden, true);
assert.strictEqual(d0.notes.length, 0, 'the input document is not changed');
const u1 = must(applyChange(a1.doc, { op: 'update', id: a1.note!.id, rev: 1, text: 'changed' }, at(2), newId));
assert.deepStrictEqual([u1.note!.rev, u1.note!.updatedAt, u1.note!.createdAt], [2, at(2).toISOString(), at(1).toISOString()], 'rev +1, updatedAt moves, createdAt stays');
const stale = applyChange(u1.doc, { op: 'update', id: a1.note!.id, rev: 1, text: 'mine' }, at(3), newId);
assert.ok(!stale.ok && stale.code === 'stale' && stale.current?.text === 'changed', 'a stale rev is refused and carries the saved note');
const same = must(applyChange(u1.doc, { op: 'update', id: a1.note!.id, rev: 2, text: 'changed' }, at(4), newId));
assert.strictEqual(same.note!.rev, 2, 'no change, no new rev');
assert.ok(!applyChange(u1.doc, { op: 'update', id: 'n-nothere00000', rev: 1, done: true }, at(4), newId).ok);
assert.ok(!applyChange(u1.doc, { op: 'update', id: a1.note!.id, rev: 2, text: '   ' }, at(4), newId).ok, 'an empty text is refused');
assert.ok(!applyChange(u1.doc, { op: 'update', id: a1.note!.id, rev: 2, title: 'a\nb' }, at(4), newId).ok);
const dn = must(applyChange(u1.doc, { op: 'update', id: a1.note!.id, rev: 2, done: true }, at(4), newId));
assert.strictEqual(dn.note!.done, true);
const del = must(applyChange(dn.doc, { op: 'delete', id: a1.note!.id, rev: 3 }, at(5), newId));
assert.deepStrictEqual([del.doc.notes.length, del.doc.tombstones.length], [0, 1], 'a delete leaves a tombstone');
assert.ok(!applyChange(dn.doc, { op: 'delete', id: a1.note!.id, rev: 2 }, at(5), newId).ok, 'a delete with a stale rev is refused');
// the cap: the 301st note
let full = emptyNotesDoc();
for (let i = 0; i < NOTES_LIMITS.notesPerFolder; i++) full = must(applyChange(full, { op: 'add', text: 'n' + i, from: 'typed', hidden: false }, at(i), newId)).doc;
assert.strictEqual(full.notes.length, 300);
const over = applyChange(full, { op: 'add', text: 'one more', from: 'typed', hidden: false }, at(999), newId);
assert.ok(!over.ok && over.code === 'cap' && over.error === CAP_MESSAGE && /300 notes/.test(over.error), 'the 301st note is refused with the reason');
const all = must(applyChange(full, { op: 'deleteAll' }, at(1000), newId));
assert.deepStrictEqual([all.doc.notes.length, all.doc.tombstones.length], [0, 300]);
assert.ok(all.doc.tombstones.length <= NOTES_LIMITS.tombstones);

// the text cap: mask first, then cut at a line end with the visible line
const longText = Array.from({ length: 4000 }, (_x, i) => 'line ' + i).join('\n');
const cutLong = fitText(longText);
assert.ok(cutLong.cut && cutLong.text.length <= NOTES_LIMITS.textChars && cutLong.text.endsWith(CUT_LINE), 'cut with the visible last line, never over the cap');
assert.ok(/\nline \d+\n\n\[Cut:/.test(cutLong.text), 'cut at a line end');
assert.ok(!fitText('x'.repeat(NOTES_LIMITS.textChars)).cut, 'exactly the cap: not cut');
assert.ok(fitText('x'.repeat(NOTES_LIMITS.textChars + 1)).cut, 'one more: cut');
assert.strictEqual(CUT_LINE, '[Cut: the message was longer than 16,000 characters.]');

// AC5: ids
const seqRand = (): ((n: number) => number) => { let i = 0; return (n) => { assert.strictEqual(n, 36, 'a uniform draw over 36 symbols, no modulo'); return (i++ * 7) % n; }; };
const id1 = newNoteId(seqRand());
assert.ok(/^n-[a-z0-9]{12}$/.test(id1), id1);
assert.strictEqual(newNoteId(() => 0), 'n-aaaaaaaaaaaa');
assert.strictEqual(newNoteId(() => 35), 'n-' + '9'.repeat(12));

// AC7: NOTES_LIMITS is the only place with caps; byte caps are derived; a full folder serialises under both caps
const L = NOTES_LIMITS;
assert.strictEqual(L.noteJsonBytes, 3 * (L.textChars + L.titleChars) + L.noteExtraBytes);
assert.strictEqual(L.storeBytes, L.notesPerFolder * L.noteJsonBytes + L.tombstones * L.tombstoneBytes + L.docExtraBytes);
assert.strictEqual(L.mdBytes, L.notesPerFolder * L.noteMdBytes + 1024);
assert.ok(L.storeBytes < 16 * 1024 * 1024, `the store cap (${L.storeBytes}) is below 16 MB`);
const SRC = path.join(__dirname, '..', '..', 'src');
for (const f of ['shared/notes.ts', 'main/notesstore.ts', 'main/notesops.ts', 'main/ipc/notes.ts']) {
  const src = fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const body = f === 'shared/notes.ts' ? src.replace(/export const NOTES_LIMITS = \(\(\) => \{[\s\S]*?\n\}\)\(\);/, '') : src;
  assert.ok(!/\b(?:16_?000|65_?536|300|80|400)\b/.test(body.replace(/'[^'\n]*'|`[^`\n]*`/g, "''")), `${f}: no cap number outside NOTES_LIMITS`);
}
// a folder at every cap (300 notes of 16,000 three-byte characters full of quotes, backslashes and marker-like lines) writes and reads back
const worst = (ch: string): string => {
  const marker = '<!-- durbar-note id=x -->\n';
  let t = '';
  while (t.length < L.textChars) t += marker + ch.repeat(10) + '"\\\n\t';
  return t.slice(0, L.textChars);
};
for (const ch of ['€', '"', '\\', '\n', '😀']) {
  let doc = emptyNotesDoc('é'.repeat(L.folderNameChars));
  const text = worst(ch);
  for (let i = 0; i < L.notesPerFolder; i++) {
    const n: Note = { id: 'n-' + String(i).padStart(12, '0'), title: (ch === '\n' ? '"' : ch).repeat(L.titleChars).slice(0, L.titleChars), text, createdAt: T0.toISOString(), updatedAt: T0.toISOString(), rev: 999999999, done: true, from: 'agent', fileEdited: true, hidden: true, source: { app: 'copilot', session: 'a'.repeat(100), role: 'agent', ord: L.ordMax, digest: 'f'.repeat(16), at: T0.toISOString() } };
    doc.notes.push(n);
    doc.tombstones.push({ id: 'n-' + String(i + 1000).padStart(12, '0'), deletedAt: T0.toISOString() });
  }
  doc.mirror = { sha256: 'f'.repeat(64), bytes: L.mdBytes, at: T0.toISOString() };
  const json = serializeNotesDoc(doc);
  assert.ok(fitsCap(utf8Len(json), L.storeBytes), `at every cap (${JSON.stringify(ch)}): ${utf8Len(json)} bytes fit ${L.storeBytes}`);
  const back = parseNotesDoc(json);
  assert.ok(back.ok && back.dropped === 0 && back.doc.notes.length === 300, 'and reads back whole');
  doc = back.ok ? back.doc : doc;
}
assert.ok(!fitsCap(L.storeBytes + 1, L.storeBytes), 'one byte more is over');
assert.strictEqual(utf8Len('aé€😀'), 1 + 2 + 3 + 4);

// rawDigestInput: the normalisation both sides use
assert.strictEqual(rawDigestInput('  a\r\nb \r\n'), 'a\nb');

// AC4: mergeDocs
const base = (id: string, text: string, up: number, rev = 1): Note => ({ id, title: text, text, createdAt: at(0).toISOString(), updatedAt: at(up).toISOString(), rev, done: false, from: 'typed', fileEdited: false, hidden: false });
const docOf = (notes: Note[], tombs: Array<[string, number]> = []): NotesDoc => ({ version: 1, folderName: 'F', notes, tombstones: tombs.map(([id, s]) => ({ id, deletedAt: at(s).toISOString() })) });
const ID1 = 'n-' + '1'.repeat(12);
const ID2 = 'n-' + '2'.repeat(12);
let m = mergeDocs(docOf([base(ID1, 'old', 1)]), docOf([base(ID1, 'new', 5, 2)]));
assert.strictEqual(m.notes[0].text, 'new', 'the higher updatedAt wins');
m = mergeDocs(docOf([base(ID1, 'new', 5, 2)]), docOf([base(ID1, 'old', 1)]));
assert.strictEqual(m.notes[0].text, 'new', 'in either order');
m = mergeDocs(docOf([base(ID1, 'edit', 3)]), docOf([], [[ID1, 7]]));
assert.strictEqual(m.notes.length, 0, 'a tombstone wins over an older edit');
assert.strictEqual(m.tombstones.length, 1);
m = mergeDocs(docOf([base(ID1, 'edit after', 9)]), docOf([], [[ID1, 7]]));
assert.strictEqual(m.notes.length, 1, 'an edit newer than the tombstone lives');
assert.strictEqual(m.tombstones.length, 0, 'and the tombstone goes');
m = mergeDocs(docOf([base(ID1, 'a', 4, 3)]), docOf([base(ID1, 'b', 4, 3)]));
assert.ok(m.notes[0].rev > 3, 'two different versions of one rev: the result is above both');
m = mergeDocs(docOf([base(ID1, 'a', 1), base(ID2, 'b', 1)]), docOf([base(ID2, 'b', 1)]));
assert.strictEqual(m.notes.length, 2, 'union');
const tombs: Array<[string, number]> = Array.from({ length: 450 }, (_x, i) => ['n-' + String(i).padStart(12, '0'), i]);
m = mergeDocs(docOf([], tombs.slice(0, 250)), docOf([], tombs.slice(200)));
assert.strictEqual(m.tombstones.length, NOTES_LIMITS.tombstones, 'tombstones capped');
assert.ok(m.tombstones.every((t) => t.deletedAt >= at(150).toISOString()), 'oldest dropped first');

// AC6: 1,000 random operations on two copies, merged in turns: no lost and no resurrected note (SC-003)
let rs = 12345;
const rnd = (n: number): number => { rs = (Math.imul(rs, 1103515245) + 12345) >>> 0; return Math.floor((rs / 4294967296) * n); };
const replicas: NotesDoc[] = [emptyNotesDoc('F'), emptyNotesDoc('F')];
const expected = new Map<string, string>(); // id -> text, the truth: what a person did last
let clock = 100;
let idn = 0;
for (let step = 0; step < 1000; step++) {
  clock += 1;
  const who = rnd(2);
  const doc = replicas[who];
  const r = rnd(10);
  if (r < 4 || doc.notes.length === 0) {
    const res = applyChange(doc, { op: 'add', text: 't' + step, from: 'typed', hidden: false }, at(clock), () => 'n-' + String(++idn).padStart(12, '0'));
    if (res.ok) { replicas[who] = res.doc; expected.set(res.note!.id, 't' + step); }
  } else if (r < 7) {
    const n = doc.notes[rnd(doc.notes.length)];
    const res = applyChange(doc, { op: 'update', id: n.id, rev: n.rev, text: 'e' + step }, at(clock), newId);
    if (res.ok) { replicas[who] = res.doc; expected.set(n.id, 'e' + step); }
  } else if (r < 9) {
    const n = doc.notes[rnd(doc.notes.length)];
    const res = applyChange(doc, { op: 'delete', id: n.id, rev: n.rev }, at(clock), newId);
    if (res.ok) { replicas[who] = res.doc; expected.delete(n.id); }
  } else {
    clock += 1;
    replicas[0] = mergeDocs(replicas[0], replicas[1]);
    replicas[1] = mergeDocs(replicas[1], replicas[0]);
  }
}
replicas[0] = mergeDocs(replicas[0], replicas[1]);
replicas[1] = mergeDocs(replicas[1], replicas[0]);
const got = new Map(replicas[0].notes.map((n) => [n.id, n.text]));
assert.deepStrictEqual([...got].sort(), [...expected].sort(), 'after merging, the notes are exactly what the people left: none lost, none brought back');
assert.deepStrictEqual(replicas[1].notes.map((n) => [n.id, n.text]).sort(), [...got].sort(), 'both copies agree');
assert.ok(replicas[0].notes.length <= NOTES_LIMITS.notesPerFolder);

// order: this session first, then newest first
const o = orderForFolder([{ ...base(ID1, 'a', 1), createdAt: at(1).toISOString() }, { ...base(ID2, 'b', 1), createdAt: at(9).toISOString(), source: { app: 'copilot', session: 'S1', role: 'agent', ord: 0, digest: '0'.repeat(16), at: at(9).toISOString() } }, { ...base('n-' + '3'.repeat(12), 'c', 1), createdAt: at(5).toISOString() }], 'S1');
assert.deepStrictEqual(o.map((n) => n.text), ['b', 'c', 'a']);


// ---- the window helpers (spec 083 T021: src/renderer/notes.js, window.DurbarNotes), pure ----
{
  const R = path.join(__dirname, '..', '..', 'src', 'renderer');
  type Safe = { mask(t: unknown): string; excerpt(t: unknown, n?: number, fb?: string): string };
  const DN = require(path.join(R, 'notes.js')) as {
    groups(n: unknown, s?: string): { session: Note[]; folder: Note[] }; flat(n: unknown, s?: string): Note[]; when(i: string): string; fromLabel(n: unknown, a?: string): string;
    rowView(n: Note, safe: unknown, a?: string): Record<string, unknown>; insertInto(v: string, c: number | null, t: string): { value: string; caret: number };
    replaceWord(v: string, s: number, e: number, t: string): { value: string; caret: number }; digestInput(r: string): string; digestOf(r: string, s: unknown): Promise<string>;
    findSaved(n: unknown, s: string, r: string, d: string): Note | null; slashEntries(n: unknown, s?: string): Array<Record<string, unknown>>; noticeText(n: unknown): string;
    showChatTab(bp: unknown): Promise<boolean>; SLASH_NOTES_MAX: number;
  };
  const ST = require(path.join(R, 'safetext.js')) as { create(o: { redact: (s: string) => string; cut: (s: string, n: number) => string }): Safe };
  const { cutText } = require(path.join(R, 'cuttext.js')) as { cutText: (t: unknown, n: number) => string };
  const SAFE = ST.create({ redact: (t) => redact(t, {}), cut: cutText });
  const mk = (id: string, over: Partial<Note>): Note => ({ id: 'n-' + id.padStart(12, '0'), title: 'T' + id, text: 'text ' + id, createdAt: at(Number(id)).toISOString(), updatedAt: at(Number(id)).toISOString(), rev: 1, done: false, from: 'agent', fileEdited: false, hidden: false, ...over });
  const src = (session: string) => ({ app: 'copilot', session, role: 'agent' as const, ord: 0, digest: '0'.repeat(16), at: T0.toISOString() });

  // AC1: grouping and order (this session first, newest first, done left out)
  const list = [mk('1', { source: src('S1') }), mk('2', {}), mk('3', { source: src('S1') }), mk('4', { done: true, source: src('S1') }), mk('5', { source: src('S2') })];
  const g = DN.groups(list, 'S1');
  assert.deepStrictEqual(g.session.map((n) => n.title), ['T3', 'T1'], 'this session first, newest first');
  assert.deepStrictEqual(g.folder.map((n) => n.title), ['T5', 'T2'], 'then the folder, newest first');
  assert.ok(![...g.session, ...g.folder].some((n) => n.done), 'a done note is in neither group');
  assert.deepStrictEqual(DN.groups(list, '').session, [], 'no session: everything is the folder\'s');
  assert.deepStrictEqual(DN.flat(list, 'S1').map((n) => n.title), ['T3', 'T1', 'T5', 'T2']);
  assert.deepStrictEqual(DN.groups(undefined as unknown as Note[], 'S1'), { session: [], folder: [] });

  // AC2: the row view masks title and excerpt, failing closed
  const tok = 'gh' + 'p_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5';
  const secretNote = mk('9', { title: `Deploy ${tok}`, text: `use **${tok.slice(0, 3)}**${tok.slice(3)} here\nsecond line`, from: 'file', hidden: true });
  const rv = DN.rowView(secretNote, SAFE, 'Ada') as { title: string; excerpt: string; from: string; hidden: boolean; fromFile: boolean; when: string };
  assert.ok(!rv.title.includes('a1B2c3') && !rv.excerpt.includes('a1B2c3') && /\[redacted\]/.test(rv.title + rv.excerpt), `masked: ${rv.title} | ${rv.excerpt}`);
  assert.deepStrictEqual([rv.from, rv.hidden, rv.fromFile], ['From the project file', true, true]);
  assert.match(rv.when, /^\d{1,2} [A-Z][a-z]{2} \d{2}:\d{2}$/);
  for (const bad of [undefined, {}, { mask: () => 1, excerpt: () => 2 }, { mask: () => { throw new Error('x'); }, excerpt: () => { throw new Error('y'); } }]) {
    const r = DN.rowView(secretNote, bad, 'Ada') as { title: string; excerpt: string };
    assert.deepStrictEqual([r.title, r.excerpt], ['', ''], 'no usable mask: empty fields, never the raw text');
  }
  assert.strictEqual(DN.fromLabel(mk('1', { from: 'user' }), 'Ada'), 'You');
  assert.strictEqual(DN.fromLabel(mk('1', { from: 'agent' }), 'Ada'), 'Ada');
  assert.strictEqual(DN.fromLabel(mk('1', { from: 'selection' })), 'Selection');
  assert.strictEqual(DN.fromLabel(mk('1', { from: 'typed' })), 'Typed');
  assert.strictEqual(DN.fromLabel(mk('1', { from: 'typed', fileEdited: true })), 'Changed in the project file');

  // AC3: insertInto: a blank line only when the box has text and the caret is not at a line start; the caret after the text
  assert.deepStrictEqual(DN.insertInto('', 0, 'note'), { value: 'note', caret: 4 }, 'empty box: no blank line');
  assert.strictEqual(DN.insertInto('   ', 3, 'note').value, '   note', 'a box with only blanks counts as empty');
  assert.deepStrictEqual(DN.insertInto('hello', 5, 'note'), { value: 'hello\n\nnote', caret: 11 }, 'after text on the line: a blank line');
  assert.deepStrictEqual(DN.insertInto('hello  ', 7, 'note'), { value: 'hello\n\nnote', caret: 11 }, 'trailing blanks before the caret are dropped');
  assert.deepStrictEqual(DN.insertInto('hello\n', 6, 'note'), { value: 'hello\nnote', caret: 10 }, 'at a line start: none');
  assert.deepStrictEqual(DN.insertInto('hello', 0, 'note'), { value: 'notehello', caret: 4 }, 'caret at 0: a line start');
  assert.deepStrictEqual(DN.insertInto('ab cd', 2, 'N'), { value: 'ab\n\nN cd', caret: 5 }, 'mid-line: blank line, the rest follows');
  assert.deepStrictEqual(DN.insertInto('abc', null, 'N'), { value: 'abc\n\nN', caret: 6 }, 'no caret: the end');
  assert.deepStrictEqual(DN.insertInto('abc', 99, 'N'), { value: 'abc\n\nN', caret: 6 }, 'a caret past the end is the end');
  assert.deepStrictEqual(DN.replaceWord('/pla', 0, 4, 'NOTE'), { value: 'NOTE', caret: 4 }, 'the /word is replaced');
  assert.deepStrictEqual(DN.replaceWord('hi /pla', 3, 7, 'NOTE'), { value: 'hi\n\nNOTE', caret: 8 }, 'after text: a blank line, the space is dropped');
  assert.deepStrictEqual(DN.replaceWord('line\n/pla', 5, 9, 'NOTE'), { value: 'line\nNOTE', caret: 9 }, 'on its own line: none');

  // AC4: digestInput equals main's rawDigestInput on the shared vector, and the digest is main's (T013 AC3)
  for (const v of ['  a\r\nb \r\n', 'plain', '', '\n\nx\n', 'a\r\n\r\nb']) assert.strictEqual(DN.digestInput(v), rawDigestInput(v), `digestInput(${JSON.stringify(v)})`);
  const { webcrypto } = require('crypto') as { webcrypto: { subtle: unknown } };
  Promise.all([DN.digestOf('a\r\nb ', webcrypto.subtle), DN.digestOf('\n a\nb\r\n', webcrypto.subtle), DN.digestOf('', webcrypto.subtle)]).then(([a, b, c]) => {
    assert.deepStrictEqual([a, b, c], ['7e18f737311b2dc3', '7e18f737311b2dc3', 'e3b0c44298fc1c14'], 'the window digest equals main\'s (the vector of test-notesipc)');
  }).catch((e) => { console.error(e); process.exit(1); });

  // saved-message matching, by session, role and digest
  const saved = mk('7', { source: { ...src('S1'), digest: 'abcdef0123456789' } });
  assert.strictEqual(DN.findSaved([saved], 'S1', 'agent', 'abcdef0123456789'), saved);
  for (const [s2, r, d] of [['S2', 'agent', 'abcdef0123456789'], ['S1', 'user', 'abcdef0123456789'], ['S1', 'agent', '0000000000000000'], ['', 'agent', 'abcdef0123456789'], ['S1', 'agent', '']] as const) assert.strictEqual(DN.findSaved([saved], s2, r, d), null);

  // the "/" entries: done left out, this session first, the title and 200 characters, the scope; type 'note' with insertText
  const ents = DN.slashEntries([...list, mk('8', { from: 'file', source: undefined, text: 'x'.repeat(500) })], 'S1');
  assert.deepStrictEqual(ents.map((e) => e.scope), ['session', 'session', 'file', 'folder', 'folder'], 'this session, then the folder, a project file note says so');
  assert.ok(ents.every((e) => e.source === 'note' && e.kind === 'note' && typeof e.insertText === 'string'), 'text entries (spec 073 FR-066)');
  assert.strictEqual((ents.find((e) => e.name === 'T8')!.description as string).length, 200, 'the description is the first 200 characters');
  assert.strictEqual((ents.find((e) => e.name === 'T8')!.insertText as string).length, 500, 'the whole text is what is inserted');
  assert.ok(!ents.some((e) => e.name === 'T4'), 'a done note is not offered');

  // FR-040: the header count and its tooltip
  const cl = [mk('1', { source: src('S1') }), mk('2', {}), mk('3', { done: true, source: src('S1') }), mk('4', { source: src('S2') })];
  const DN2 = DN as unknown as { countOf(n: unknown, s?: string): { total: number; session: number }; countTip(c: { total: number; session: number }): string; markerFor(n: unknown, s: string, r: string, d: string, o: number, c: number): Note | null; search(g: unknown, q: string, rank: unknown, mask: unknown): { session: Note[]; folder: Note[] }; noMatch(q: string, mask: unknown): string };
  assert.deepStrictEqual(DN2.countOf(cl, 'S1'), { total: 3, session: 1 }, 'not-done notes only');
  assert.strictEqual(DN2.countTip(DN2.countOf(cl, 'S1')), '1 from this session, 3 in this folder');
  assert.deepStrictEqual(DN2.countOf([], 'S1'), { total: 0, session: 0 });
  assert.deepStrictEqual(DN2.countOf([mk('5', { done: true })], 'S1'), { total: 0, session: 0 }, 'only done notes: nothing to count');

  // FR-041: matching by session, role and digest; ord tells equal texts apart; a unique digest matches whatever the place; done notes still mark
  const dg = 'abcdef0123456789';
  const mrk = [mk('1', { source: { ...src('S1'), digest: dg, ord: 2 } }), mk('2', { done: true, source: { ...src('S1'), role: 'user', digest: '1111111111111111', ord: 0 } })];
  assert.strictEqual(DN2.markerFor(mrk, 'S1', 'agent', dg, 2, 2)!.title, 'T1', 'two equal texts: the one at the note\'s own place');
  assert.strictEqual(DN2.markerFor(mrk, 'S1', 'agent', dg, 5, 2), null, '...the other equal text has no marker');
  assert.strictEqual(DN2.markerFor(mrk, 'S1', 'agent', dg, 7, 1)!.title, 'T1', 'a unique digest matches whatever its place (replayed history numbers differently)');
  assert.strictEqual(DN2.markerFor(mrk, 'S1', 'user', dg, 2, 1), null, 'another role');
  assert.strictEqual(DN2.markerFor(mrk, 'S2', 'agent', dg, 2, 1), null, 'another session');
  assert.strictEqual(DN2.markerFor(mrk, 'S1', 'agent', '0000000000000000', 2, 1), null, 'another text');
  assert.strictEqual(DN2.markerFor(mrk, 'S1', 'user', '1111111111111111', 0, 1)!.done, true, 'a done note still marks its message');
  assert.strictEqual(DN2.markerFor(mrk, '', 'agent', dg, 2, 1), null, 'no session, no marker');
  assert.strictEqual(DN2.markerFor([], 'S1', 'agent', dg, 2, 1), null, 'no notes');

  // FR-043: search: titles by rank, then notes whose masked text has every word; case-insensitive; fails closed; both groups
  {
    const { rank } = require(path.join(R, 'navigator.js')) as { rank: unknown };
    const ns = [
      mk('1', { title: 'Release checklist', text: 'we migrate tables first', source: src('S1') }),
      mk('2', { title: 'Migrate users', text: 'plain', source: src('S1') }),
      mk('3', { title: 'Lunch', text: 'Migrate the Cache and the TABLES', source: src('S2') }),
      mk('4', { title: 'Cache', text: 'nothing', source: src('S2') }),
      mk('5', { title: 'Old', text: 'migrate', done: true }),
    ];
    const g = DN.groups(ns, 'S1');
    const r = DN2.search(g, 'MIGRATE', rank, SAFE.mask);
    assert.deepStrictEqual(r.session.map((n) => n.title), ['Migrate users', 'Release checklist'], 'this session: title match first, then the text match');
    assert.deepStrictEqual(r.folder.map((n) => n.title), ['Lunch'], 'the folder group: a text match (case-insensitive)');
    assert.deepStrictEqual(DN2.search(g, 'migrate tables', rank, SAFE.mask).folder.map((n) => n.title), ['Lunch'], 'every word must be in the text');
    assert.deepStrictEqual(DN2.search(g, 'migrate cache', rank, SAFE.mask).session.map((n) => n.title), [], 'a word missing: no match');
    assert.strictEqual(DN2.search(g, '  ', rank, SAFE.mask), g, 'an empty query keeps everything');
    assert.ok(!([...r.session, ...r.folder].some((n) => n.title === 'Old')), 'a done note is never found');
    // masked text: a token the note holds is not searchable, a word around it is; no mask function: nothing matches by text
    const tk = mk('6', { title: 'Deploy', text: `use ${tok} now`, source: src('S1') });
    assert.strictEqual(DN2.search({ session: [tk], folder: [] }, 'a1B2c3D4', rank, SAFE.mask).session.length, 0, 'the raw token is not found: the search reads the masked text');
    assert.strictEqual(DN2.search({ session: [tk], folder: [] }, 'now', rank, SAFE.mask).session.length, 1, 'a word beside it is');
    assert.strictEqual(DN2.search({ session: [tk], folder: [] }, 'now', rank, undefined).session.length, 0, 'no mask function: no text match (fail closed)');
    assert.strictEqual(DN2.search({ session: [tk], folder: [] }, 'now', rank, () => { throw new Error('x'); }).session.length, 0, 'a throwing mask: no match');
    // the no-match line names the words, masked and cut
    assert.strictEqual(DN2.noMatch('migrate me', SAFE.mask), 'No notes match "migrate me"');
    assert.ok(!DN2.noMatch(tok, SAFE.mask).includes('a1B2c3') && /\[redacted\]/.test(DN2.noMatch(tok, SAFE.mask)), 'a pasted token is masked in the no-match line');
    assert.strictEqual(DN2.noMatch(tok, undefined), 'No notes match', 'no mask function: no words shown');
    assert.ok(DN2.noMatch('w'.repeat(200), SAFE.mask).length <= 80, 'long words are cut');
  }

  // the notice above the box (FR-024)
  assert.strictEqual(DN.noticeText({ hidden: true, from: 'agent' }), 'Parts of this note were hidden when it was saved');
  assert.strictEqual(DN.noticeText({ hidden: false, from: 'file' }), 'From the project file');
  assert.strictEqual(DN.noticeText({ hidden: true, from: 'file' }), 'Parts of this note were hidden when it was saved. From the project file');
  assert.strictEqual(DN.noticeText({ hidden: false, from: 'agent' }), '');

  // FR-025 / T022 AC7: opening Notes from the Browser tab selects Chat first (the switch function; a fake pane)
  (async () => {
    const calls: string[] = [];
    const pane = (tab: string) => ({ current: () => ({ tab }), select: async (t: string) => { calls.push(t); } });
    assert.strictEqual(await DN.showChatTab(pane('browser')), true);
    assert.deepStrictEqual(calls, ['chat'], 'from Browser: Chat is selected first');
    assert.strictEqual(await DN.showChatTab(pane('chat')), false);
    assert.strictEqual(await DN.showChatTab(null), false);
    assert.deepStrictEqual(calls, ['chat'], 'from Chat (or no tabs): nothing is switched');
  })().catch((e) => { console.error(e); process.exit(1); });

  // the "/" list helpers (slashsuggest.js, spec 073 FR-066/FR-067): notes after the commands, at most 5 with nothing typed, All notes… last, hostile fields escaped
  const SL = require(path.join(R, 'slashsuggest.js')) as {
    withNotes(c: unknown[], n: unknown[], q: string, max: number, all: unknown): { commands: Array<{ name: string }>; notes: Array<{ name: string }>; items: Array<{ name: string; source: string }> };
    optionHtml(x: unknown, i: number, a: boolean, t: string): string; view(x: unknown, m: unknown): Record<string, string>; tip(x: unknown, m: unknown, c: unknown): string;
  };
  const cmds = [{ name: 'review', description: 'Review', source: 'folder', kind: 'command' }, { name: 'plan-it', description: '', source: 'app', kind: 'builtin' }];
  const many = Array.from({ length: 8 }, (_x, i) => ({ name: 'Note ' + i, description: 'd', source: 'note', kind: 'note', scope: 'folder', insertText: 't' + i }));
  const ALL = { name: 'All notes…', source: 'note', kind: 'more', scope: 'folder' };
  let wn = SL.withNotes(cmds, many, '', DN.SLASH_NOTES_MAX, ALL);
  assert.deepStrictEqual([wn.commands.length, wn.notes.length, wn.items.length, wn.items[wn.items.length - 1].name], [2, 5, 8, 'All notes…'], 'nothing typed: 5 notes and All notes…');
  assert.deepStrictEqual(wn.items.slice(0, 2).map((x) => x.source), ['folder', 'app'], 'the commands first');
  wn = SL.withNotes(cmds, many, 'note 3', 5, ALL);
  assert.deepStrictEqual([wn.notes.map((x) => x.name), wn.items.some((x) => x.name === 'All notes…')], [['Note 3'], false], 'a query filters the notes, no All notes…');
  wn = SL.withNotes([], [], '', 5, ALL);
  assert.strictEqual(wn.items.length, 0, 'no commands and no notes: no list');
  wn = SL.withNotes([], many.slice(0, 1), 'zzz', 5, ALL);
  assert.strictEqual(wn.items.length, 0, 'no match');
  // FR-030: with a query this session's notes still come first, each group ranked on its own (a folder note named "Migrate" must not outrank a session note that only mentions it)
  const mine = { name: 'Release checklist', description: 'we migrate tables', source: 'note', kind: 'note', scope: 'session', insertText: 'a' };
  const theirs = { name: 'Migrate', description: '', source: 'note', kind: 'note', scope: 'folder', insertText: 'b' };
  assert.deepStrictEqual(SL.withNotes([], [theirs, mine], 'migrate', 5, ALL).notes.map((x) => x.name), ['Release checklist', 'Migrate'], 'a query: this session first');
  assert.deepStrictEqual(SL.withNotes([], [mine, theirs], 'migrate', 5, ALL).notes.map((x) => x.name), ['Release checklist', 'Migrate'], 'in either input order');
  const hostile = { name: '<img src=x onerror=alert(1)>', description: '"><script>x</script>', source: 'note', kind: 'note', scope: 'session' as string };
  const hv = SL.view(hostile, SAFE.mask);
  const html = SL.optionHtml(hv, 0, true, SL.tip(hostile, SAFE.mask, cutText));
  assert.ok(!/<img|<script|onerror=alert\(1\)>/i.test(html.replace(/&lt;/gi, '')) && /&lt;img/.test(html), `a hostile note title is escaped: ${html}`);
  const sec = { name: tok, description: `x ${tok}`, source: 'note', kind: 'note', scope: 'folder' };
  const sv = SL.view(sec, SAFE.mask), sh = SL.optionHtml(sv, 1, false, SL.tip(sec, SAFE.mask, cutText));
  assert.ok(!sh.includes('a1B2c3') && /\[redacted\]/.test(sh), `a token in a note is masked in the row and its tooltip: ${sh}`);
  assert.deepStrictEqual([SL.view(sec, undefined).name, SL.view(sec, undefined).description], ['', ''], 'no mask function: the row shows nothing');
  assert.ok(/note · this session/.test(SL.optionHtml(SL.view(hostile, SAFE.mask), 0, false, '')) && /note · project file/.test(SL.optionHtml({ ...hv, scope: 'file' }, 0, false, '')), 'the row says where the note is from');
}

console.log('notes model: parse, titles, changes, caps (a folder at every cap round-trips), merge (1,000 random operations, nothing lost or brought back)');

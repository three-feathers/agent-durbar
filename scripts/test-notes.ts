/** Spec 083 T010 (FR-003, FR-004, FR-006, FR-008, SC-003, issue 699): the pure notes model. `npm run test:notes`. No credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  CAP_MESSAGE, CUT_LINE, NOTES_LIMITS, applyChange, cleanTitle, emptyNotesDoc, fitText, fitsCap, guessTitle, mergeDocs, newNoteId, orderForFolder, parseNotesDoc,
  rawDigestInput, serializeNotesDoc, stripControls, utf8Len,
} from '../src/shared/notes';
import type { Note, NotesDoc } from '../src/shared/notes';

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

console.log('notes model: parse, titles, changes, caps (a folder at every cap round-trips), merge (1,000 random operations, nothing lost or brought back)');

/**
 * Spec 083 T040 (FR-052, FR-054, SC-004, issue 699): the `.durbar/notes.md` writer and parser. `npm run test:notesmd`. Pure: no fs,
 * no clock, no credits. The fuzz uses a seeded PRNG, so a failure names its seed and repeats.
 */
import * as assert from 'assert';
import { NOTES_LIMITS, cleanTitle, newNoteId, utf8Len, type Note } from '../src/shared/notes';
import { NOTE_MARKER_PREFIX, NOTES_MD_HEADER, notesMdText, parseNotesMd, writeNotesMd, type NotesMdParse, type NotesMdSection } from '../src/shared/notesmd';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const T0 = Date.UTC(2026, 9, 24, 10, 12, 0);
const iso = (ms: number, millis = true): string => { const s = new Date(ms).toISOString(); return millis ? s : s.replace(/\.\d{3}Z$/, 'Z'); };
const note = (id: string, title: string, text: string, created: string, extra: Partial<Note> = {}): Note => ({
  id, title, text, createdAt: created, updatedAt: created, rev: 1, done: false, from: 'typed', fileEdited: false, hidden: false, ...extra,
});
const ok = (r: NotesMdParse): Extract<NotesMdParse, { ok: true }> => { assert.ok(r.ok, `parse ok (got ${JSON.stringify(r)})`); return r as Extract<NotesMdParse, { ok: true }>; };
const order = (a: Note, b: Note): number => Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1);
const view = (s: NotesMdSection): unknown => ({ id: s.id, title: s.title, text: s.text, done: s.done, createdAt: s.createdAt, updatedAt: s.updatedAt });
const viewNote = (n: Note): unknown => ({ id: n.id, title: n.title, text: n.text, done: n.done, createdAt: n.createdAt, updatedAt: n.updatedAt });
const timed = (label: string, maxMs: number, fn: () => void): void => {
  // CPU time, not wall time: `npm test` runs suites in parallel on a loaded machine
  const t = process.cpuUsage();
  fn();
  const u = process.cpuUsage(t);
  const ms = (u.user + u.system) / 1000;
  assert.ok(ms < maxMs, `${label}: ${ms.toFixed(0)} ms of CPU (limit ${maxMs} ms)`);
};

// ---- the fuzz corpus: lines that try to break the format
const LINES = [
  '', '   ', '\t', 'plain text', '## A heading in the text', '##no space', '# Notes', '### deeper',
  NOTE_MARKER_PREFIX, `${NOTE_MARKER_PREFIX} -->`, `${NOTE_MARKER_PREFIX} id=n-abcdefabcdef created=2026-01-01T00:00:00Z -->`, `${NOTE_MARKER_PREFIX}s are cool`,
  `\\${NOTE_MARKER_PREFIX} escaped`, `\\\\${NOTE_MARKER_PREFIX}`, '\\', '\\\\', ' <!-- durbar-note indented',
  '<<<<<<< HEAD', '=======', '>>>>>>> other-branch', '\\=======', '\\\\<<<<<<<', '========', '<<<<<<<<<', ' =======',
  '```', '```js', '~~~', '````', '   ```', '``` `not a fence`', '~~~~~', '    ```',
  '<!-- Kept by Agent Durbar (spec 083). -->', '<!-- an html comment -->', '-->',
  'héllo wörld', '漢字かなカナ', 'emoji 😀🎉 and ZWJ 👩\u200d💻', 'RTL שלום مرحبا', '\u00a0nbsp\u00a0', 'combining e\u0301', '\u2028line sep',
  '- [ ] a task', '> quote', '| a | b |', '**bold** _em_ `code`', 'trailing spaces  ',
];
const TITLES = ['Idea', '## not a heading', 'Fix the <<<<<<< thing', '======= title', `${NOTE_MARKER_PREFIX} in a title`, 'Ünïcödé 漢字 😀', 'x'.repeat(80), 'a  b   c', '\\ backslash', '```'];

function genNotes(rand: () => number, count: number): Note[] {
  const ids = new Set<string>();
  const out: Note[] = [];
  for (let i = 0; i < count; i++) {
    let id = newNoteId((n) => Math.floor(rand() * n));
    while (ids.has(id)) id = newNoteId((n) => Math.floor(rand() * n));
    ids.add(id);
    const lines: string[] = [];
    const nLines = rand() < 0.15 ? 0 : Math.floor(rand() * 14);
    for (let j = 0; j < nLines; j++) lines.push(LINES[Math.floor(rand() * LINES.length)]);
    const title = cleanTitle(TITLES[Math.floor(rand() * TITLES.length)])!;
    const created = T0 + Math.floor(rand() * 5) * 1000 + (rand() < 0.5 ? Math.floor(rand() * 999) : 0); // ties on purpose
    const createdAt = iso(created, rand() < 0.8);
    out.push(note(id, title, notesMdText(lines.join('\n')), createdAt, { updatedAt: iso(created + Math.floor(rand() * 1e6)), done: rand() < 0.3 }));
  }
  return out;
}

// ---- AC1 / SC-004: parse(write(x)) = x for 1,000 generated documents, LF and CRLF
let docs = 0;
for (let seed = 1; seed <= 1000; seed++) {
  const rand = mulberry32(seed);
  const notes = genNotes(rand, Math.floor(rand() * 9));
  const md = writeNotesMd(notes);
  const want = [...notes].sort(order).map(viewNote);
  for (const [name, input] of [['LF', md], ['CRLF', md.replace(/\n/g, '\r\n')], ['BOM', '\ufeff' + md], ['lone CR', md.replace(/\n/g, '\r')]] as const) {
    const r = ok(parseNotesMd(input));
    assert.deepStrictEqual(r.sections.map(view), want, `seed ${seed} ${name}: round trip`);
    assert.ok(r.sections.every((s) => s.origin === 'marker'), `seed ${seed}: every section is a marker one`);
    assert.strictEqual(r.strayText, 0, `seed ${seed} ${name}: no stray text`);
    assert.strictEqual(r.duplicates, 0, `seed ${seed}: no duplicates`);
  }
  assert.ok(!md.includes('\r') && !md.startsWith('\ufeff') && md.endsWith('\n') && !md.endsWith('\n\n'), `seed ${seed}: LF, no BOM, one trailing newline`);
  assert.ok(md.startsWith(NOTES_MD_HEADER), `seed ${seed}: the header first`);
  // deterministic: the input order does not matter
  assert.strictEqual(writeNotesMd([...notes].reverse()), md, `seed ${seed}: same file whatever the input order`);
  // AC2: a newer note only appends lines
  const newer = note('n-zzzzzzzzzzzz', 'Newest', notesMdText(LINES.slice(0, 1 + (seed % 20)).join('\n')), iso(T0 + 10_000));
  const md2 = writeNotesMd([newer, ...notes]);
  assert.ok(md2.startsWith(md), `seed ${seed}: adding a note only appends`);
  const a = md.split('\n'), b = md2.split('\n');
  assert.deepStrictEqual(b.slice(0, a.length - 1), a.slice(0, -1), `seed ${seed}: the old lines are unchanged, in place`);
  docs++;
}
assert.strictEqual(docs, 1000, 'AC1: 1,000 documents');

// a text not in the file's form comes back in it (trailing blank lines, CR, controls), and the form is stable
{
  const raw = 'one\r\ntwo\rthree\u0000\u0007\n\n  \t\n';
  assert.strictEqual(notesMdText(raw), 'one\ntwo\nthree');
  assert.strictEqual(notesMdText(notesMdText(raw)), notesMdText(raw), 'notesMdText is idempotent');
  const r = ok(parseNotesMd(writeNotesMd([note('n-aaaaaaaaaaaa', 'T', raw, iso(T0))])));
  assert.strictEqual(r.sections[0].text, 'one\ntwo\nthree');
  const md = writeNotesMd([note('n-aaaaaaaaaaaa', 'T', raw, iso(T0))]);
  assert.ok(md.endsWith('three\n') && !md.endsWith('\n\n'), 'a text with trailing blank lines still ends the file with one newline (FR-052)');
  assert.strictEqual(notesMdText('   '), '', 'whitespace only is empty');
  assert.strictEqual(notesMdText('\n\nlead'), '\n\nlead', 'leading blank lines are kept');
}

// ---- FR-052: the exact file, no session ids
{
  const n = note('n-abcdefghijk1', 'First idea', 'Line one\n## a heading\n<!-- durbar-note id=n-zzzzzzzzzzzz -->\n=======', '2026-10-24T10:12:00.000Z', {
    updatedAt: '2026-10-25T08:00:00.000Z', done: true, from: 'agent',
    source: { app: 'copilot', session: 'sess' + 'ion-0123-abcd', role: 'agent', ord: 3, digest: '0123456789abcdef', at: '2026-10-24T10:11:00.000Z' },
  });
  const empty = note('n-abcdefghijk2', 'Empty', '', '2026-10-24T10:13:00.000Z');
  const md = writeNotesMd([empty, n]);
  assert.strictEqual(md, NOTES_MD_HEADER
    + '\n<!-- durbar-note id=n-abcdefghijk1 created=2026-10-24T10:12:00.000Z updated=2026-10-25T08:00:00.000Z done -->\n## First idea\n\n'
    + 'Line one\n## a heading\n\\<!-- durbar-note id=n-zzzzzzzzzzzz -->\n\\=======\n'
    + '\n<!-- durbar-note id=n-abcdefghijk2 created=2026-10-24T10:13:00.000Z updated=2026-10-24T10:13:00.000Z -->\n## Empty\n', 'the exact format');
  assert.strictEqual(writeNotesMd([]), NOTES_MD_HEADER, 'no notes: the header only');
  assert.strictEqual(NOTES_MD_HEADER, '# Notes\n\n<!-- Kept by Agent Durbar (spec 083). One section per note; keep the durbar-note lines. Secrets are masked. To add a note, start it with a line <!-- durbar-note -->. Notes deleted here come back; delete them in Durbar. -->\n', 'the header of plan.md');
  for (const leak of ['session-0123', '0123456789abcdef', 'copilot', 'agent', 'ord', 'rev', 'from']) assert.ok(!md.includes(leak), `no ${leak} in the file (D8)`);
  // a fence that closes keeps its conflict-like lines as written; one left open escapes them
  const fenced = writeNotesMd([note('n-aaaaaaaaaaaa', 'F', '```\n=======\n<<<<<<< x\n```\n=======', iso(T0)), note('n-bbbbbbbbbbbb', 'G', '~~~\n>>>>>>> y', iso(T0 + 1))]);
  assert.ok(fenced.includes('```\n=======\n<<<<<<< x\n```\n\\=======\n'), 'in a closed fence: as written; after it: escaped');
  assert.ok(fenced.includes('~~~\n\\>>>>>>> y\n'), 'in a fence never closed: escaped');
  assert.deepStrictEqual(ok(parseNotesMd(fenced)).sections.map((s) => s.text), ['```\n=======\n<<<<<<< x\n```\n=======', '~~~\n>>>>>>> y']);
  // the writer leaves out what is not valid instead of writing it
  const bad = writeNotesMd([note('n-x done id=n-abcdefabcdef', 'T\nU', 'x', 'not a time', { updatedAt: '2026-10-24T10:12:00Z' })]);
  assert.ok(bad.includes('\n<!-- durbar-note updated=2026-10-24T10:12:00Z -->\n## T U\n'), `an invalid id or time is left out (${JSON.stringify(bad.slice(NOTES_MD_HEADER.length))})`);
}

// ---- AC3: conflict markers
{
  const base = writeNotesMd([note('n-aaaaaaaaaaaa', 'A', 'text', iso(T0))]);
  for (const m of ['<<<<<<< HEAD', '=======', '>>>>>>> branch', '<<<<<<<', '>>>>>>>']) {
    for (const where of ['end', 'header', 'crlf']) {
      const input = where === 'header' ? m + '\n' + base : where === 'crlf' ? (base + m + '\n').replace(/\n/g, '\r\n') : base + m + '\n';
      const r = parseNotesMd(input);
      assert.ok(!r.ok && r.reason === 'conflict', `${JSON.stringify(m)} at a line start (${where}) is a conflict`);
    }
    for (const fence of ['```', '~~~', '````', '   ```']) {
      const close = fence.trim();
      const r = parseNotesMd(base + fence + '\n' + m + '\n' + close + '\n');
      assert.ok(r.ok, `${JSON.stringify(m)} inside a ${fence} fence is text`);
      assert.ok(r.sections[0].text.includes(m), 'and kept as text');
    }
    assert.ok(parseNotesMd(base + ' ' + m + '\n').ok, 'not at a line start: text');
    assert.ok(parseNotesMd(base + '\\' + m + '\n').ok, 'escaped: text');
    const open = parseNotesMd(base + '```\n' + m + '\n');
    assert.ok(!open.ok && open.reason === 'conflict', `${JSON.stringify(m)} inside a fence never closed is a conflict`);
    const openNext = parseNotesMd(base + '```\n' + m + `\n${NOTE_MARKER_PREFIX} -->\nnext\n`);
    assert.ok(!openNext.ok && openNext.reason === 'conflict', 'a fence still open at the next marker hides nothing');
    const leaked = parseNotesMd(base + '```\n' + `${NOTE_MARKER_PREFIX} -->\n` + m + '\n');
    assert.ok(!leaked.ok && leaked.reason === 'conflict', "an earlier section's open fence does not hide a conflict in the next");
  }
  assert.ok(parseNotesMd(base + '```\ncode\n```\n=======x\n').ok === false, 'after a closed fence it counts again');
  assert.ok(parseNotesMd(base + '``` `x`\n=======\n```\n').ok === false, 'a backtick info string is no fence');
  assert.ok(parseNotesMd(base + '    ```\n=======\n').ok === false, 'four spaces is no fence');
  assert.ok(parseNotesMd(base + '    ```\n=======\n    ```\n').ok === false, 'four spaces is no fence, even when a like line follows');
  assert.ok(parseNotesMd(base + '   ```\n=======\n   ```\n').ok, 'three spaces is a fence');
  assert.ok(parseNotesMd(base + '````\n=======\n```\n').ok === false, 'a shorter line does not close a longer fence');
  assert.ok(parseNotesMd(base + '````\n=======\n`````\n').ok, 'a longer line closes it');
  assert.ok(parseNotesMd(base + '```\n=======\n~~~\n').ok === false, 'a ~~~ does not close a ``` fence');
  const r = parseNotesMd(base + '=======\n');
  assert.ok(!r.ok && r.error.includes('merge conflicts'), 'the message of FR-054');
}

// ---- AC4: notes the person adds by hand, stray text
{
  const md = '# Notes\n\n<!-- Kept by Agent Durbar (spec 083). old header -->\n'
    + 'Some stray line\nanother one\n\n'
    + '## A heading note\n\nIts text\n## Second heading\nsecond text\n\n'
    + '```\n## not a heading in a fence\n```\n'
    + '<!-- durbar-note -->\nBuy milk\n\n'
    + '<!-- durbar-note -->\n## Titled bare\n\nbody\n'
    + '<!-- durbar-note id=n-unknownid123 done -->\n## Known shape\ntext\n## a heading inside\n'
    + '<!-- durbar-notes are cool -->\nx\n';
  const r = ok(parseNotesMd(md));
  assert.strictEqual(r.strayText, 2, 'two stray lines before the first heading are reported');
  assert.deepStrictEqual(r.sections.map((s) => [s.origin, s.id, s.title, s.text, s.done]), [
    ['heading', undefined, 'A heading note', 'Its text', false],
    ['heading', undefined, 'Second heading', 'second text\n\n```\n## not a heading in a fence\n```', false],
    ['marker', undefined, undefined, 'Buy milk', false],
    ['marker', undefined, 'Titled bare', 'body', false],
    ['marker', 'n-unknownid123', 'Known shape', 'text\n## a heading inside', true],
    ['marker', undefined, undefined, 'x', false],
  ]);
  assert.deepStrictEqual(r.sections.map((s) => s.line), [7, 10, 16, 19, 23, 27], 'each section knows its first line');
  assert.strictEqual(ok(parseNotesMd(writeNotesMd([]))).strayText, 0, 'the header is not stray text');
  assert.strictEqual(ok(parseNotesMd('```\nstray in a fence\n```\n')).strayText, 3, 'fenced stray text is stray');
  assert.deepStrictEqual(ok(parseNotesMd('')).sections, [], 'an empty file');
  assert.deepStrictEqual(ok(parseNotesMd('## ')).sections.map((s) => [s.title, s.text]), [[undefined, '']], 'an empty heading: no title, the caller guesses (FR-004)');
}

// ---- hostile input (a file in a repository is untrusted)
{
  const base = writeNotesMd([note('n-aaaaaaaaaaaa', 'A', 'text', iso(T0))]);
  // markers: attributes, tabs, bad values
  const m = ok(parseNotesMd(`${NOTE_MARKER_PREFIX}\tid=n-bbbbbbbbbbbb\tcreated=2026-10-24T10:12:00Z  updated=yesterday done-->\nx\n`));
  assert.deepStrictEqual(view(m.sections[0]), { id: 'n-bbbbbbbbbbbb', title: undefined, text: 'x', done: true, createdAt: '2026-10-24T10:12:00Z', updatedAt: undefined }, 'tabs, a bad time left out, `done-->` is done');
  for (const bad of ['__proto__', 'constructor', 'prototype', 'toString', 'n-' + 'a'.repeat(5000), 'n-ABCDEFGHIJKL', 'n-abcdefabcdef"x', '']) {
    const r = ok(parseNotesMd(`${NOTE_MARKER_PREFIX} id=${bad} -->\nx\n`));
    assert.strictEqual(r.sections[0].id, undefined, `id ${JSON.stringify(bad.slice(0, 20))} is refused: a new note`);
    assert.ok(!Object.prototype.hasOwnProperty.call(r.sections[0], '__proto__') && ({} as Record<string, unknown>).x === undefined, 'nothing polluted');
  }
  assert.strictEqual(ok(parseNotesMd(`${NOTE_MARKER_PREFIX}s id=n-aaaaaaaaaaaa -->\nx\n`)).sections[0].id, undefined, '`<!-- durbar-notes id=…`: no attributes');
  const twice = ok(parseNotesMd(`${NOTE_MARKER_PREFIX} id=n-aaaaaaaaaaaa id=n-bbbbbbbbbbbb created=2026-01-01T00:00:00Z created=2027-01-01T00:00:00Z updated=2026-02-01T00:00:00Z updated=2027-02-01T00:00:00Z -->\nx\n`)).sections[0];
  assert.deepStrictEqual([twice.id, twice.createdAt, twice.updatedAt], ['n-aaaaaaaaaaaa', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'], 'the first id=, created= and updated= win');
  const longMarker = ok(parseNotesMd(`${NOTE_MARKER_PREFIX} id=n-aaaaaaaaaaaa ${'x'.repeat(200_000)} -->\nt\n`));
  assert.strictEqual(longMarker.sections[0].id, undefined, 'a huge marker line: attributes ignored');
  const trailing = ok(parseNotesMd(`${NOTE_MARKER_PREFIX} id=n-aaaaaaaaaaaa -->${' '.repeat(5000)}\nt\n`));
  assert.strictEqual(trailing.sections[0].id, 'n-aaaaaaaaaaaa', 'trailing spaces on a marker are fine');
  // duplicate ids: the second is a new note, its text kept
  const dup = ok(parseNotesMd(base + base.slice(NOTES_MD_HEADER.length).replace('text', 'copy')));
  assert.deepStrictEqual(dup.sections.map((s) => [s.id, s.text]), [['n-aaaaaaaaaaaa', 'text'], [undefined, 'copy']]);
  assert.strictEqual(dup.duplicates, 1);
  // NUL, other controls, lone surrogate, BOM
  const ctl = ok(parseNotesMd('\ufeff' + base.replace('text', 'te\u0000x\u0001t\ud800 end')));
  assert.strictEqual(ctl.sections[0].text, 'text\ufffd end', 'controls removed, a lone surrogate replaced');
  assert.strictEqual(ok(parseNotesMd('\ufeff## Title\n')).sections[0].title, 'Title', 'a BOM before a heading');
  assert.strictEqual(ok(parseNotesMd('## \tTab\ttitle\t\n')).sections[0].title, 'Tab title', 'tabs in a title are spaces');
  assert.strictEqual(ok(parseNotesMd('## ' + 'y'.repeat(100_000) + '\n')).sections[0].title, 'y'.repeat(80), 'a huge title is cut');
  // caps: notes count, size
  const many = ok(parseNotesMd(`${NOTE_MARKER_PREFIX} -->\n`.repeat(50_000)));
  assert.strictEqual(many.sections.length, NOTES_LIMITS.notesPerFolder);
  assert.strictEqual(many.overflow, 50_000 - NOTES_LIMITS.notesPerFolder, 'sections past notesPerFolder are counted, not returned');
  const big = parseNotesMd('a'.repeat(NOTES_LIMITS.mdBytes + 1));
  assert.ok(!big.ok && big.reason === 'too-big', 'over mdBytes: not read');
  assert.ok(parseNotesMd('a'.repeat(NOTES_LIMITS.mdBytes)).ok, 'exactly mdBytes: read');
  assert.ok(!parseNotesMd('é'.repeat(Math.floor(NOTES_LIMITS.mdBytes / 2) + 1)).ok, 'mdBytes counts UTF-8 bytes, not characters');
  // linear time on long lines and many lines (generous limits: CPU time on a loaded runner)
  for (const ch of ['`', '~', '<', '=', '\\', ' ', '#', '-', '\t']) {
    timed(`200k ${JSON.stringify(ch)}`, 1000, () => { parseNotesMd(base + ch.repeat(200_000) + 'x\n'); parseNotesMd(ch.repeat(200_000) + '\n'); });
  }
  timed('200k backslashes then a marker', 1000, () => assert.ok(parseNotesMd(base + '\\'.repeat(200_000) + NOTE_MARKER_PREFIX + '\n').ok));
  timed('200k characters of short lines', 1000, () => parseNotesMd(base + 'x\n## y\n```\n'.repeat(18_000)));
  timed('write 200k-character text', 1000, () => writeNotesMd([note('n-aaaaaaaaaaaa', 'A', ('```\n=======\n' + `${NOTE_MARKER_PREFIX}\n`).repeat(7_000), iso(T0))]));
  timed('unterminated fence and 25k conflict-like lines in it', 1000, () => assert.ok(!parseNotesMd(base + '```\n' + '=======\n'.repeat(25_000)).ok));
}

// ---- FR-006: a folder filled to every cap writes within mdBytes and reads back
{
  const notes: Note[] = [];
  const shapes = ['=======\n', `${NOTE_MARKER_PREFIX}\n`, '\u20ac'.repeat(63) + '\n', '<<<<<<<\n'];
  for (let i = 0; i < NOTES_LIMITS.notesPerFolder; i++) {
    const unit = shapes[i % shapes.length];
    const text = notesMdText(unit.repeat(Math.ceil(NOTES_LIMITS.textChars / unit.length)).slice(0, NOTES_LIMITS.textChars - 1) + 'z');
    assert.ok(text.length <= NOTES_LIMITS.textChars);
    notes.push(note('n-' + String(i).padStart(12, '0'), '\u20ac'.repeat(NOTES_LIMITS.titleChars), text, iso(T0 + i * 1000), { done: i % 2 === 0 }));
  }
  let md = '';
  timed('write a full folder', 30_000, () => { md = writeNotesMd(notes); });
  const bytes = utf8Len(md);
  assert.ok(bytes <= NOTES_LIMITS.mdBytes, `a full folder is ${bytes} bytes, cap ${NOTES_LIMITS.mdBytes}`);
  for (const n of notes) {
    const one = writeNotesMd([n]);
    assert.ok(utf8Len(one) - utf8Len(NOTES_MD_HEADER) <= NOTES_LIMITS.noteMdBytes, 'one full note fits noteMdBytes');
  }
  timed('parse a full folder', 30_000, () => {
    const r = ok(parseNotesMd(md));
    assert.deepStrictEqual(r.sections.map(view), notes.map(viewNote), 'a full folder reads back');
  });
}

console.log('notesmd: format, round trip (1,000 documents), conflicts, hand-added notes, hostile input and caps OK');

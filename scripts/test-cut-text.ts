/** The shared text cutter (spec 044 FR-021): code points, whitespace, word boundary, and that the three callers use it. `npm run test:cuttext`. No credits spent. */
import assert from 'assert';
import fs from 'fs';
import path from 'path';

const R = path.join(__dirname, '..', '..', 'src', 'renderer');
const { cutText, fitCut, nameTail, fitBatch, growKey } = require(path.join(R, 'cuttext.js')) as { growKey: (it: object, base: string, len: number) => string; fitBatch: (items: unknown[], clear: (i: never) => void, isCut: (i: never) => boolean, mark: (i: never) => void, key?: (i: never) => unknown) => unknown[]; nameTail: (n: unknown) => string; fitCut: (t: string, fits: (x: string) => boolean) => string; cutText: (t: unknown, max: number, o?: { wordBoundary?: boolean; trimPunct?: boolean }) => string };
const len = (s: string) => Array.from(s).length;

// fits: unchanged (whitespace collapsed); exactly max is not cut
assert.strictEqual(cutText('hello', 10), 'hello');
assert.strictEqual(cutText('x'.repeat(40), 40), 'x'.repeat(40));
assert.strictEqual(cutText('x'.repeat(41), 40), 'x'.repeat(39) + '…');
assert.strictEqual(len(cutText('x'.repeat(500), 40)), 40);
// empty, null, bad max
assert.strictEqual(cutText('', 10), '');
assert.strictEqual(cutText(null, 10), '');
assert.strictEqual(cutText(undefined, 10), '');
assert.strictEqual(cutText('abc', 0), '');
assert.strictEqual(cutText('abc', NaN), '');
assert.strictEqual(cutText('abcdef', 1), '…');
// whitespace runs, tabs, newlines
assert.strictEqual(cutText('  a \t b\n\nc  ', 20), 'a b c');
assert.strictEqual(cutText('Edit  src/a.ts\n(rename)', 80), 'Edit src/a.ts (rename)');
// a trailing space before the ellipsis is dropped
assert.strictEqual(cutText('abcd efgh', 6), 'abcd…');
// word boundary: cuts at the last space of the second half; none there: a hard cut
const sentence = 'Rename public tool find_company and update every call site';
const w = cutText(sentence, 40, { wordBoundary: true });
assert.strictEqual(w, 'Rename public tool find_company and…');
assert.ok(len(w) <= 40);
assert.strictEqual(cutText('x'.repeat(30) + ' ' + 'y'.repeat(30), 40, { wordBoundary: true }), 'x'.repeat(30) + '…');
assert.strictEqual(cutText('aa ' + 'y'.repeat(60), 40, { wordBoundary: true }), 'aa ' + 'y'.repeat(36) + '…', 'a space in the first half is not used');
assert.strictEqual(cutText('y'.repeat(60), 40, { wordBoundary: true }), 'y'.repeat(39) + '…', 'no boundary: hard cut');
assert.strictEqual(cutText('one two, three four five six seven eight nine ten', 20, { wordBoundary: true, trimPunct: true }), 'one two, three four…');
assert.strictEqual(cutText('aaaaaaaaaa bbbbb, cccccccccccc', 18, { wordBoundary: true, trimPunct: true }), 'aaaaaaaaaa bbbbb…');
// emoji (surrogate pairs) are counted as one and never split
const e = cutText('😀'.repeat(50), 10);
assert.strictEqual(e, '😀'.repeat(9) + '…');
assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(cutText('a' + '😀'.repeat(50), 4)), 'no lone surrogate');
assert.strictEqual(cutText('😀'.repeat(10), 10), '😀'.repeat(10), 'exactly max emoji');
// combining marks stay with their letter; a ZWJ sequence is not cut after the joiner
const eacute = 'é'; // e + combining acute
const c = cutText(eacute.repeat(20), 6);
assert.ok(c.endsWith('…') && !/^́/.test(c.slice(0, 1)));
assert.ok(Array.from(c.slice(0, -1)).every((_, i, a) => i === 0 || a[i] !== '́' || a[i - 1] === 'e'));
assert.ok(len(c) <= 6);
const fam = '👨‍👩‍👧'; // man ZWJ woman ZWJ girl
const f = cutText('ab' + fam + 'cdefgh', 5);
assert.ok(!/‍…$/.test(f) && len(f) <= 5, 'no dangling joiner: ' + JSON.stringify(f));

// flags (pairs of regional indicators) are never split
assert.strictEqual(cutText('Message 🇨🇭🇨🇭🇨🇭', 10), 'Message…');
assert.strictEqual(cutText('🇨🇭'.repeat(10), 5), '🇨🇭'.repeat(2) + '…', 'a flag run cuts between pairs');
assert.strictEqual(cutText('🇨🇭'.repeat(10), 4), '🇨🇭' + '…');
assert.strictEqual(cutText('ab🇨🇭🇨🇭', 4), 'ab…');
const oddRun = (t: string) => { const a = Array.from(t.replace(/…$/, '')); let n = 0; while (n < a.length && /[\u{1F1E6}-\u{1F1FF}]/u.test(a[a.length - 1 - n])) n++; return n % 2 === 1; };
for (let m = 3; m < 12; m++) assert.ok(!oddRun(cutText('Hi 🇨🇭🇨🇭🇨🇭🇨🇭', m)), 'no odd run before the ellipsis at ' + m);
// fitCut (FR-174): the longest cut that fits; the band where the text fits but not with the ellipsis
const full = 'Message abcdefghij'; // 18 characters
const at = (w: number) => (x: string) => x.length <= w;
assert.strictEqual(fitCut(full, at(19)), full + '…');
assert.strictEqual(fitCut(full, at(18)), 'Message abcdefgh…', 'fits without the ellipsis: still cut, and ends in an ellipsis');
assert.strictEqual(fitCut(full, at(17)), 'Message abcdefgh…');
assert.strictEqual(fitCut(full, at(9)), 'Message…');
assert.ok(fitCut(full, at(18)).endsWith('…') && fitCut(full, at(18)) !== full);
assert.strictEqual(fitCut(full, at(0)), '…', 'nothing fits: the ellipsis alone');
assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(fitCut('😀'.repeat(30), at(9))), 'fitCut never splits an emoji');

// nameTail (spec 001 FR-271, issue #1905): the end of a long folder name that stays when the name is cut in the middle
for (const [name, tail] of [
  ['iot-platform-form-2', 'form-2'], ['iot-platform-form-3', 'form-3'], ['itdse-ism-reports', 'reports'], ['itdse-ism-portal', 'portal'],
  ['customer-reconciliation-batch-jobs', 'batch-jobs'], ['operations-weekly', 'weekly'], ['2026-07-budget', 'budget'],
  ['abcdefghijklmnopqrst', 'mnopqrst'], ['x-averyverylongsegment', 'gsegment'], ['abcdefghijkl', ''], ['short', ''], ['', ''],
] as const) assert.strictEqual(nameTail(name), tail, 'nameTail ' + JSON.stringify(name));
assert.strictEqual(nameTail(null), '', 'nameTail of null');
assert.strictEqual(nameTail('😀'.repeat(14)), '😀'.repeat(8), 'nameTail counts code points, never splits a pair');
for (const n of ['iot-platform-form-2', 'customer-reconciliation-batch-jobs', 'a-b-c-d-e-f-g-h-i-j-k', 'x'.repeat(40)]) {
  const t = nameTail(n);
  assert.ok(n.endsWith(t) && len(t) >= 6 && len(t) <= 10 && len(n) > 12, 'tail of ' + n + ' is a 6..10 character suffix: ' + t);
}
assert.notStrictEqual(nameTail('iot-platform-form-2'), nameTail('iot-platform-form-3'), 'names that start alike end differently');

// the three callers use it (static check), and none keeps its own slice-and-ellipsis
const app = fs.readFileSync(path.join(R, 'app.js'), 'utf8'), att = fs.readFileSync(path.join(R, 'attention.js'), 'utf8');
assert.match(app, /const clipName=s=>DurbarCutText\.cutText\(/);
assert.match(att, /CUT\.cutText\(/);
for (const [n, src] of [['app.js', app], ['attention.js', att]] as const) assert.ok(!/\.slice\([^)]*\)\s*\+\s*'…'/.test(src), n + ' has its own slice-and-ellipsis');
assert.match(fs.readFileSync(path.join(R, 'index.html'), 'utf8'), /<script src="cuttext\.js"><\/script>[\s\S]*<script src="app\.js">/);
assert.match(fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'copy-assets.js'), 'utf8'), /'cuttext\.js'/);

// fitBatch (#2017, Paco's review): N signs cost ONE layout, not one reflow per sign. A fake DOM counts "read after write": a write (class change) dirties the layout, a read
// while dirty is a forced reflow. Mutant: the interleaved loop (clear and measure per item) must read 15 reflows, so this assert would fail on it.
{
  type Sign = { cls: boolean; wide: boolean };
  const mk = (n: number): Sign[] => Array.from({ length: n }, (_, i) => ({ cls: true, wide: i % 3 === 0 }));
  const run = (fit: (signs: Sign[], clear: (s: Sign) => void, isCut: (s: Sign) => boolean, mark: (s: Sign) => void) => void) => {
    let dirty = false, reflows = 0; const signs = mk(15);
    fit(signs, (s) => { s.cls = false; dirty = true; }, (s) => { if (dirty) { reflows++; dirty = false; } return s.wide; }, (s) => { s.cls = true; dirty = true; });
    return { reflows, marked: signs.filter((s) => s.cls).length };
  };
  const batched = run((signs, c, k, m) => { fitBatch(signs, c as never, k as never, m as never); });
  assert.strictEqual(batched.reflows, 1, 'fitBatch: 15 signs, one layout read after the writes, got ' + batched.reflows + ' (a reflow per sign?)');
  assert.strictEqual(batched.marked, 5, 'fitBatch marks exactly the cut signs');
  const interleaved = run((signs, c, k, m) => { for (const s of signs) { c(s); if (k(s)) m(s); } });
  assert.strictEqual(interleaved.reflows, 15, 'the guard sees the interleaved loop (the mutant): 15 reflows');
  assert.strictEqual(fitBatch([], () => {}, () => true, () => {}).length, 0);
  // the cache (a status event reads nothing): a key unchanged = 0 reads and the mark stays; a changed key = exactly that item's read
  {
    type It = Sign & { id: number; w: number; txt: string; sc: string };
    const items: It[] = Array.from({ length: 15 }, (_, i) => ({ id: i, cls: false, wide: i % 3 === 0, w: 800, txt: 'n' + i, sc: '9' }));
    let reads = 0;
    const go = (W: number) => fitBatch(items, ((s: It) => { s.cls = false; }) as never, ((s: It) => { reads++; return s.wide; }) as never, ((s: It) => { s.cls = true; }) as never, ((s: It) => growKey(s, s.txt + '|' + W, s.sc.length)) as never);
    go(800); assert.strictEqual(reads, 15, 'first render measures every sign once');
    reads = 0; for (let k = 0; k < 10; k++) go(800);
    assert.strictEqual(reads, 0, 'ten status events with the same text and width: 0 reads, got ' + reads + ' (a measure on every event?)');
    assert.strictEqual(items.filter((s) => s.cls).length, 5, 'the kept marks stay');
    items[4].txt = 'renamed'; reads = 0; go(800);
    assert.strictEqual(reads, 1, 'one changed text: exactly one read, got ' + reads);
    items[7].sc = '10'; reads = 0; go(800);
    assert.strictEqual(reads, 1, 'a count 9 to 10 on one sign: exactly that sign is read again, got ' + reads);
    items[7].sc = '10'; reads = 0; go(800);
    assert.strictEqual(reads, 0, 'the same count again: 0 reads');
    items[7].sc = '9'; reads = 0; go(800); items[7].sc = '10'; go(800);
    assert.strictEqual(reads, 0, 'a count that shrinks, or returns to a length already measured, cannot cut the name any more: 0 reads, got ' + reads);
    items[7].sc = '100'; reads = 0; go(800);
    assert.strictEqual(reads, 1, 'a count growing past every length measured: that sign only, got ' + reads);
    reads = 0; go(700);
    assert.strictEqual(reads, 15, 'a width change measures every sign once, got ' + reads);
    assert.strictEqual(items.filter((s) => s.cls).length, 5, 'marks after the width change');
  }
  const ro = fs.readFileSync(path.join(R, 'realoffice.js'), 'utf8');
  assert.match(ro, /DurbarCutText\.fitBatch\(signs,[\s\S]*sg\._sig \+ '\|' \+ W/, 'fitSigns goes through fitBatch, keyed on the sign text and the layout width');
  assert.match(ro, /growKey\(sg, sg\._sig \+ '\|' \+ W \+ '\|' \+ sg\.classList\.contains\('short'\), sg\._sc\.textContent\.length\)/, 'the fit key holds the length of the counts and cost text (a count 9 to 10 can cut the name)');
  const roCss = fs.readFileSync(path.join(R, 'realoffice.css'), 'utf8');
  assert.match(roCss, /\.ro-sc\{[^}]*font-variant-numeric:\s*tabular-nums/, '.ro-sc (the counts and the cost the fit key holds by length) has tabular figures: 11 and 88 are as wide');
  assert.match(ro, /classList\.toggle\('nopath', !!sg\._nop\)/, 'the kept result is put back after el() rewrites the class');
  assert.ok(!/for \(const sg of chrome\.querySelectorAll\('\.ro-sign'\)\) \{\s*if \(!sg\._b/.test(ro), 'fitSigns has no per-sign loop');
}

console.log('[cuttext] all checks passed');

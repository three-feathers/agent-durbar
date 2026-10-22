/** The shared text cutter (spec 044 FR-021): code points, whitespace, word boundary, and that the three callers use it. `npm run test:cuttext`. No credits spent. */
import assert from 'assert';
import fs from 'fs';
import path from 'path';

const R = path.join(__dirname, '..', '..', 'src', 'renderer');
const { cutText, fitCut } = require(path.join(R, 'cuttext.js')) as { fitCut: (t: string, fits: (x: string) => boolean) => string; cutText: (t: unknown, max: number, o?: { wordBoundary?: boolean; trimPunct?: boolean }) => string };
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

// the three callers use it (static check), and none keeps its own slice-and-ellipsis
const app = fs.readFileSync(path.join(R, 'app.js'), 'utf8'), att = fs.readFileSync(path.join(R, 'attention.js'), 'utf8');
assert.match(app, /const clipName=s=>DurbarCutText\.cutText\(/);
assert.match(att, /CUT\.cutText\(/);
for (const [n, src] of [['app.js', app], ['attention.js', att]] as const) assert.ok(!/\.slice\([^)]*\)\s*\+\s*'…'/.test(src), n + ' has its own slice-and-ellipsis');
assert.match(fs.readFileSync(path.join(R, 'index.html'), 'utf8'), /<script src="cuttext\.js"><\/script>[\s\S]*<script src="app\.js">/);
assert.match(fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'copy-assets.js'), 'utf8'), /'cuttext\.js'/);

console.log('[cuttext] all checks passed');

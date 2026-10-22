/** Status that tells the truth, readable tool calls, a sortable list (spec 052 FR-062..FR-064): `npm run test:truth`. No credits spent. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { simpleDiff, clipDiff, CONTEXT } from '../src/shared/diff';
import { PermissionBroker } from '../src/adapters/permissions';
import type { BrokerEvent } from '../src/adapters/permissions';

const ROOT = path.join(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const A = require(path.join(ROOT, 'src', 'renderer', 'activity.js')) as {
  agoLong: (ms: unknown) => string;
  agoShort: (ms: unknown) => string;
  sortBy: <T>(items: T[], valueOf: (x: T) => unknown, dir?: string) => T[];
  nextSort: (cur: { key: string; dir: string } | null, key: string) => { key: string; dir: string };
  diffLines: (diff: unknown, max?: number) => { lines: { t: string; s: string }[]; more: number };
};

// last activity labels (FR-062): long for tooltips and the chat header, short for the list column
assert.strictEqual(A.agoLong(0), 'just now');
assert.strictEqual(A.agoLong(59_999), 'just now');
assert.strictEqual(A.agoLong(2 * 60000 + 5000), '2 min ago');
assert.strictEqual(A.agoLong(3 * 3600000 + 1), '3 h ago');
assert.strictEqual(A.agoLong(2 * 86400000), '2 d ago');
assert.strictEqual(A.agoShort(1000), 'just now');
assert.strictEqual(A.agoShort(2 * 60000), '2m');
assert.strictEqual(A.agoShort(90 * 60000), '1h');
assert.strictEqual(A.agoShort(50 * 3600000), '2d');
for (const bad of [-1, NaN, undefined, null, 'x', Infinity]) {
  assert.strictEqual(A.agoLong(bad), '', 'unknown: ' + String(bad));
  assert.strictEqual(A.agoShort(bad), '', 'unknown: ' + String(bad));
}

// the list's sort (FR-064): stable, case-insensitive text, numbers by size, missing values last both ways
const rows = [{ n: 'bea', c: 2 }, { n: 'Ada', c: null }, { n: 'cem', c: 0.5 }, { n: 'ada', c: 2 }, { n: '', c: 10 }];
assert.deepStrictEqual(A.sortBy(rows, (r) => r.n, 'asc').map((r) => r.n), ['Ada', 'ada', 'bea', 'cem', '']);
assert.deepStrictEqual(A.sortBy(rows, (r) => r.n, 'desc').map((r) => r.n), ['cem', 'bea', 'Ada', 'ada', '']);
assert.deepStrictEqual(A.sortBy(rows, (r) => r.c, 'asc').map((r) => r.n), ['cem', 'bea', 'ada', '', 'Ada']);
assert.deepStrictEqual(A.sortBy(rows, (r) => r.c, 'desc').map((r) => r.n), ['', 'bea', 'ada', 'cem', 'Ada']);
assert.deepStrictEqual(A.sortBy([{ n: 'agent 10' }, { n: 'agent 9' }], (r) => r.n, 'asc').map((r) => r.n), ['agent 9', 'agent 10'], 'numeric aware');
assert.deepStrictEqual(rows.map((r) => r.n), ['bea', 'Ada', 'cem', 'ada', ''], 'the input is not changed');
assert.deepStrictEqual(A.sortBy(null as unknown as never[], (r) => r), []);
assert.deepStrictEqual(A.nextSort(null, 'cost'), { key: 'cost', dir: 'asc' });
assert.deepStrictEqual(A.nextSort({ key: 'cost', dir: 'asc' }, 'cost'), { key: 'cost', dir: 'desc' });
assert.deepStrictEqual(A.nextSort({ key: 'cost', dir: 'desc' }, 'cost'), { key: 'cost', dir: 'asc' });
assert.deepStrictEqual(A.nextSort({ key: 'cost', dir: 'desc' }, 'name'), { key: 'name', dir: 'asc' });

// diff lines for display (FR-063)
const dl = A.diffLines('--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n keep\n-old\n+new\n');
assert.deepStrictEqual(dl.lines.map((l) => l.t), ['file', 'file', 'hunk', 'ctx', 'del', 'add']);
assert.strictEqual(dl.more, 0);
const many = A.diffLines(Array.from({ length: 10 }, (_, i) => '+' + i).join('\n'), 4);
assert.strictEqual(many.lines.length, 4); assert.strictEqual(many.more, 6);
assert.deepStrictEqual(A.diffLines(''), { lines: [], more: 0 });
assert.deepStrictEqual(A.diffLines(null), { lines: [], more: 0 });
assert.strictEqual(A.diffLines('-- not a header\n--- a/f').lines[0].t, 'del', 'a removed line that starts with "--" stays a removed line');
assert.deepStrictEqual(A.diffLines('--- a/f\n+++ b/f\n@@ -1 +1 @@\n--- SQL comment\n+++ x').lines.map((l) => l.t), ['file', 'file', 'hunk', 'del', 'add'], 'inside a hunk "---" is a removed line');

// spec 052 FR-172: a multi-file diff (Codex file changes, Claude MultiEdit): a hunk ends when its line counts are used up, so the next
// file's "---"/"+++" are headers again and the card's counts are right
const two = A.diffLines('--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n--- a/y\n+++ b/y\n@@ -0,0 +1,2 @@\n+1\n+2\n--- a/z\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone');
assert.deepStrictEqual(two.lines.map((l) => l.t), ['file', 'file', 'hunk', 'ctx', 'del', 'add', 'ctx', 'file', 'file', 'hunk', 'add', 'add', 'file', 'file', 'hunk', 'del']);
assert.deepStrictEqual(A.diffLines('--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n--- SQL\n+++ x\n keep').lines.map((l) => l.t), ['file', 'file', 'hunk', 'del', 'add', 'ctx'], 'counted: "---" inside the hunk is still a removed line');
assert.deepStrictEqual(A.diffLines('@@ hunk @@\n--- x\n+++ y').lines.map((l) => l.t), ['hunk', 'del', 'add'], 'a header without counts keeps the hunk open');
assert.deepStrictEqual(A.diffLines('--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b').lines.map((l) => l.t), ['file', 'file', 'hunk', 'del', 'ctx', 'add'], 'a "No newline" marker uses no count');
assert.deepStrictEqual(A.diffLines('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+++ y').lines.map((l) => l.t), ['hunk', 'del', 'ctx', 'add'], 'the marker uses no count: "+++ y" is still the hunk\'s added line (review on #470: a counted marker ends the hunk early and makes it a header)');

// the diff builder (shared, used by the Claude Code mapper)
assert.strictEqual(simpleDiff('a.ts', 'x', 'x'), '', 'no change');
assert.strictEqual(simpleDiff('a.ts', 'one\ntwo\nthree', 'one\nTWO\nthree'), '--- a/a.ts\n+++ b/a.ts\n@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three');
const ctx = Array.from({ length: 10 }, (_, i) => 'l' + i);
const d = simpleDiff('f', ctx.join('\n'), [...ctx.slice(0, 5), 'NEW', ...ctx.slice(5)].join('\n'));
assert.strictEqual(d.split('\n').filter((l) => l.startsWith(' ')).length, 2 * CONTEXT, 'at most CONTEXT lines of context on each side');
assert.ok(d.includes('@@ -3,6 +3,7 @@'), d);
assert.strictEqual(simpleDiff('new.txt', '', 'a\nb'), '--- a/new.txt\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+a\n+b');
assert.strictEqual(simpleDiff('f\nx', 'a', 'b').split('\n')[0], '--- a/f x', 'a file name cannot add lines');
const big = simpleDiff('f', '', Array.from({ length: 5000 }, (_, i) => 'line ' + i).join('\n'), 2000);
assert.ok(big.length <= 2000 + 40 && /… \d+ more lines not shown$/.test(big), 'cut at a line, says how much is left');
assert.strictEqual(clipDiff('short'), 'short');

// the broker passes the diff on the pending request only
(async () => {
  const ev: BrokerEvent[] = [];
  const b = new PermissionBroker({ mode: 'ask', emit: (e) => ev.push(e) });
  void b.request({ kind: 'write', fileName: 'a.ts', path: 'a.ts', toolCallId: 't1', diff: '--- a/a.ts\n+++ b/a.ts' });
  await new Promise((r) => setTimeout(r, 0));
  const p = ev.find((e) => e.type === 'pending');
  assert.ok(p && p.type === 'pending' && p.permission.diff === '--- a/a.ts\n+++ b/a.ts', 'pending carries the diff');
  void b.request({ kind: 'shell', fullCommandText: 'ls', toolCallId: 't2' });
  await new Promise((r) => setTimeout(r, 0));
  const s = ev.filter((e) => e.type === 'pending')[1];
  assert.ok(s && s.type === 'pending' && !('diff' in s.permission), 'no diff, no field');

  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  assert.ok(html.indexOf('src="activity.js"') > 0 && html.indexOf('src="activity.js"') < html.indexOf('src="app.js"'), 'index.html loads activity.js before app.js');
  assert.ok(/'activity\.js'/.test(fs.readFileSync(path.join(ROOT, 'scripts', 'copy-assets.js'), 'utf8')), 'copy-assets.js copies activity.js');
  console.log('activity tests passed');
})().catch((e) => { console.error(e); process.exit(1); });

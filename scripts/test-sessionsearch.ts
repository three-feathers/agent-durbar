/** Title search of Previous sessions (spec 006 FR-023, issue #252): `npm run test:sessionsearch`. Pure matcher, no credits. */
import * as assert from 'assert';
import * as path from 'path';
type S = { id: string; title: string };
const { filterSessions, terms, arrangeSessions } = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'sessionsearch.js')) as {
  filterSessions: (l: S[], q: string) => S[]; terms: (q: string) => string[];
  arrangeSessions: (l: unknown[], o: { pinned?: string[]; hidden?: string[]; showHidden?: boolean; query?: string; timeKey?: string }) => { rows: Array<{ item: { id?: string; key?: string }; pinned: boolean; hidden: boolean }>; hiddenCount: number; total: number };
};
const L: S[] = [
  { id: 'a', title: 'Rename the filings handler and update its tests' },
  { id: 'b', title: 'Explicación del diseño del registro' },
  { id: 'c', title: 'Why does the canton lookup return duplicates?' },
  { id: 'd', title: 'ÁRBOL de decisión' },
];
const ids = (q: string) => filterSessions(L, q).map((x) => x.id).join('');

assert.strictEqual(ids('FILINGS'), 'a', 'ignores case');
assert.strictEqual(ids('filings'), 'a');
assert.strictEqual(ids('explicacion'), 'b', 'ignores accents in the title');
assert.strictEqual(ids('EXPLICACIÓN'), 'b', 'ignores accents in the query');
assert.strictEqual(ids('arbol decision'), 'd', 'accents and capitals together');
assert.strictEqual(ids(''), 'abcd', 'an empty query keeps everything, in order');
assert.strictEqual(ids('   '), 'abcd', 'a blank query keeps everything');
assert.strictEqual(ids('  the   handler '), 'a', 'spaces: every word must match, any order, extra spaces ignored');
assert.strictEqual(ids('tests rename'), 'a', 'word order does not matter');
assert.strictEqual(ids('the'), 'ac', 'newest-first order is kept');
assert.strictEqual(ids('zzz'), '', 'no match gives an empty list');
assert.strictEqual(ids('rename zzz'), '', 'one missing word means no match');
assert.deepStrictEqual(terms('  A  é '), ['a', 'e']);
assert.deepStrictEqual(filterSessions(null as unknown as S[], 'x'), [], 'not a list');
assert.notStrictEqual(filterSessions(L, ''), L, 'a copy, not the input');
assert.strictEqual(filterSessions([{ id: 'x', title: undefined as unknown as string }], 'a').length, 0, 'a missing title never throws');
console.log('sessionsearch: all checks passed');

// Spec 006 FR-024/FR-025: pin and hide arrangement
{
  const A = [
    { id: 'n1', title: 'Newest', modifiedTime: 500 },
    { id: 'n2', title: 'Second filings', modifiedTime: 400 },
    { id: 'n3', title: 'Third', modifiedTime: 300 },
    { id: 'n4', title: 'Fourth filings', modifiedTime: 200 },
    { id: 'n5', title: 'Oldest', modifiedTime: 100 },
  ];
  const shape = (r: ReturnType<typeof arrangeSessions>) => r.rows.map((x) => x.item.id + (x.pinned ? '*' : '') + (x.hidden ? '~' : '')).join(' ');
  assert.strictEqual(shape(arrangeSessions(A, {})), 'n1 n2 n3 n4 n5', 'no marks: as today');
  assert.strictEqual(shape(arrangeSessions(A, { pinned: ['n5', 'n3'] })), 'n3* n5* n1 n2 n4', 'pinned first, newest first among them, others as before');
  const h = arrangeSessions(A, { hidden: ['n2', 'n4'] });
  assert.strictEqual(shape(h), 'n1 n3 n5', 'hidden rows are out');
  assert.deepStrictEqual([h.hiddenCount, h.total], [2, 3], 'hiddenCount counts them, total only what is shown');
  const hs = arrangeSessions(A, { hidden: ['n2', 'n4'], showHidden: true });
  assert.strictEqual(shape(hs), 'n1 n2~ n3 n4~ n5', 'Show hidden brings them back in place, flagged');
  assert.deepStrictEqual([hs.hiddenCount, hs.total], [2, 5]);
  assert.strictEqual(shape(arrangeSessions(A, { pinned: ['n2'], hidden: ['n2'] })), 'n1 n3 n4 n5', 'hidden wins: a row is never both');
  assert.strictEqual(shape(arrangeSessions(A, { pinned: ['n2'], hidden: ['n2'], showHidden: true })), 'n1 n2~ n3 n4 n5');
  const q = arrangeSessions(A, { pinned: ['n4'], hidden: ['n2'], query: 'filings' });
  assert.strictEqual(shape(q), 'n4*', 'search over what is shown: the hidden match is not found');
  assert.strictEqual(q.total, 4, 'M counts the shown rows, not the matches');
  assert.strictEqual(shape(arrangeSessions(A, { pinned: ['n4'], hidden: ['n2'], query: 'filings', showHidden: true })), 'n4* n2~', 'with Show hidden, hidden rows are searched too');
  assert.strictEqual(shape(arrangeSessions(A, { pinned: ['gone'], hidden: ['also-gone'] })), 'n1 n2 n3 n4 n5', 'ids not in the list are inert');
  assert.strictEqual(arrangeSessions(A, { hidden: ['gone'] }).hiddenCount, 0, 'and not counted');
  // VS Code chats: key + updated
  const V = [{ key: 'h/a', updated: 10 }, { key: 'h/b', updated: 30 }, { key: 'h/c', updated: 20 }];
  assert.deepStrictEqual(arrangeSessions(V, { pinned: ['h/a', 'h/c'], timeKey: 'updated' }).rows.map((r) => r.item.key), ['h/c', 'h/a', 'h/b']);
  assert.deepStrictEqual(arrangeSessions(null as unknown as unknown[], {}), { rows: [], hiddenCount: 0, total: 0 }, 'not a list');
}
console.log('sessionsearch pin/hide tests passed');

/** Title search of Previous sessions (spec 006 FR-022, issue #252): `npm run test:sessionsearch`. Pure matcher, no credits. */
import * as assert from 'assert';
import * as path from 'path';
type S = { id: string; title: string };
const { filterSessions, terms } = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'sessionsearch.js')) as {
  filterSessions: (l: S[], q: string) => S[]; terms: (q: string) => string[];
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

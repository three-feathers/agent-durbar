/** Title search of Previous sessions (spec 006 FR-023, issue #252): `npm run test:sessionsearch`. Pure matcher, no credits. */
import * as assert from 'assert';
import * as path from 'path';
type S = { id: string; title: string };
const { fold, locate, anchorKey, filterSessions, terms, arrangeSessions, applyMark, visibleCount, deleteDialogText, refusalDialogText, noDeleteReason } = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'sessionsearch.js')) as {
  filterSessions: (l: S[], q: string) => S[]; terms: (q: string) => string[]; fold: (s: unknown) => string;
  locate: (text: unknown, query: string, max?: number) => Array<{ start: number; end: number; term: number }>; anchorKey: (t: unknown) => string;
  applyMark: (m: { pinned?: string[]; hidden?: string[] }, k: string, mark: string) => { pinned: string[]; hidden: string[] };
  visibleCount: (l: unknown[], hidden: string[]) => number;
  deleteDialogText: (o: { title?: string; app?: string; cli?: string; codex?: boolean }) => { title: string; body: string; lines: string[] };
  refusalDialogText: (canRemove: boolean) => { title: string; body: string; lines: string[] };
  noDeleteReason: (app?: string) => string;
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

// the same exclusive rule as the folder store, applied in the window
assert.deepStrictEqual(applyMark({ pinned: ['a'], hidden: ['b'] }, 'b', 'pin'), { pinned: ['a', 'b'], hidden: [] }, 'pin clears hide');
assert.deepStrictEqual(applyMark({ pinned: ['a'], hidden: ['b'] }, 'a', 'hide'), { pinned: [], hidden: ['b', 'a'] }, 'hide clears pin');
assert.deepStrictEqual(applyMark({ pinned: ['a'], hidden: [] }, 'a', 'unpin'), { pinned: [], hidden: [] });
assert.deepStrictEqual(applyMark({ pinned: [], hidden: ['b'] }, 'b', 'unhide'), { pinned: [], hidden: [] });
assert.deepStrictEqual(applyMark({}, 'x', 'pin'), { pinned: ['x'], hidden: [] });
assert.strictEqual(visibleCount([{ id: 'a' }, { id: 'b' }, { key: 'k' }], ['b', 'k']), 1, 'hidden rows are not counted');
assert.strictEqual(visibleCount(null as unknown as unknown[], []), 0);
// the words of FR-030
{
  const d = deleteDialogText({ title: 'Fix the parser', app: 'GitHub Copilot', cli: 'Copilot CLI' });
  assert.strictEqual(d.title, 'Delete this session?');
  assert.strictEqual(d.body, '\u201cFix the parser\u201d will be deleted from GitHub Copilot on this computer.');
  assert.deepStrictEqual(d.lines, ['It will also be gone from VS Code and the Copilot CLI, and it cannot be resumed again.', 'This cannot be undone. To only take it out of this list, use Hide.']);
  assert.deepStrictEqual(deleteDialogText({ title: 't', app: 'Codex', cli: 'Codex CLI', codex: true }).lines, ['It will also be gone from VS Code and the Codex CLI, and it cannot be resumed again.', 'Its helper threads are deleted too.', 'This cannot be undone. To only take it out of this list, use Hide.'], 'Codex only: helper threads, third in order');
  assert.deepStrictEqual(refusalDialogText(true), { title: 'This session is still in the office', body: 'End it and remove it from the office first, then delete it here.', lines: [] });
  assert.deepStrictEqual(refusalDialogText(false).lines, ['It is the only session in this folder: start a new session there first.']);
  assert.strictEqual(noDeleteReason('Claude Code'), 'Claude Code cannot delete one session. Hide it instead.');
}
console.log('sessionsearch pin/hide tests passed');

// Spec 095 FR-040, T011: `locate` (folded matches mapped back to the original text) and `anchorKey`
{
  type R = { start: number; end: number; term: number };
  const show = (text: string, q: string) => locate(text, q).map((r: R) => `${r.term}:${text.slice(r.start, r.end)}`);
  // the facts of the fold, computed with node from the real function (plan T011): no unification of ß with ss; İ folds to i; ı stays
  assert.strictEqual(fold('ß'), 'ß');
  assert.strictEqual(fold('Straße').includes('ss'), false, '"ß" does not match "ss"');
  assert.deepStrictEqual(show('Straße', 'strasse'), []);
  assert.strictEqual(fold('İ'), 'i');
  assert.deepStrictEqual(show('İstanbul trip', 'istanbul'), ['0:İstanbul'], '"İstanbul" matches "istanbul"');
  assert.strictEqual(fold('ı'), 'ı');
  assert.deepStrictEqual(show('Diyarbakır', 'diyarbakir'), [], 'the dotless ı stays ı');
  // accents, case, any order, every occurrence, offsets in the original text
  assert.deepStrictEqual(show('Explicación del diseño. EXPLICACION otra vez', 'diseno explicacion'), ['1:Explicación', '0:diseño', '1:EXPLICACION']);
  assert.deepStrictEqual(locate('Fix the CSV export', 'csv'), [{ start: 8, end: 11, term: 0 }], 'ASCII: identity offsets');
  // a combining mark joins the character before it: the range never leaves an accent behind
  assert.deepStrictEqual(show('café au lait', 'cafe'), ['0:café']);
  // emoji (surrogate pairs) before and inside: offsets stay on code point boundaries
  const emo = '\u{1F600} résumé \u{1F680}x\u{1F680} done';
  assert.deepStrictEqual(show(emo, 'resume'), ['0:résumé']);
  assert.deepStrictEqual(show(emo, '\u{1F680}x'), ['0:\u{1F680}x']);
  // Greek final sigma: per code point folding differs, so the word maps whole; the match is still found where fold finds it
  assert.strictEqual(fold('ΟΔΟΣ'), 'οδος');
  assert.deepStrictEqual(show('ο ΟΔΟΣ μας', 'οδος'), ['0:ΟΔΟΣ']);
  // Hangul folds to jamo (NFD): a match maps to whole syllables
  assert.deepStrictEqual(show('한국어 공부', '한국'), ['0:한국']);
  // empty, blank and missing input
  assert.deepStrictEqual(locate('', 'x'), []);
  assert.deepStrictEqual(locate('text', '   '), []);
  assert.deepStrictEqual(locate(undefined, 'x'), []);
  assert.deepStrictEqual(show('a+b (c)', '(c)'), ['0:(c)'], 'the query is a plain substring, never a regex');
  assert.deepStrictEqual(show('word word word', 'word word'), ['0:word', '0:word', '0:word'], 'a repeated query word counts once');
  assert.strictEqual(locate('aaaa '.repeat(1000), 'aaaa', 5).length, 5, 'at most `max` per word');
  // long: 20 000 characters with accents; the last match is mapped right
  const long = 'é'.repeat(19_990) + ' Señal';
  assert.strictEqual(long.length, 19_996);
  assert.deepStrictEqual(show(long, 'senal'), ['0:Señal']);
  // property: on a mixed corpus, every range starts and ends on a code point boundary and holds its word when folded
  const parts = ['a', 'É', 'ß', 'İ', 'ı', 'Σ', 'ς', 'é', '\u{1F600}', '한', ' ', '\n', 'x', 'ΟΔΟΣ', 'ǅ', 'ﬁ'];
  let seed = 7;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const lone = (s: string, i: number) => i > 0 && i < s.length && /[\uDC00-\uDFFF]/.test(s[i]) && /[\uD800-\uDBFF]/.test(s[i - 1]);
  let checked = 0;
  for (let n = 0; n < 300; n++) {
    let t = '';
    for (let k = 0; k < 40; k++) t += parts[rnd(parts.length)];
    for (const q of ['a', 'e', 'i', 'σ', 'ς', 'ss', 'ß', '\u{1F600}', 'x a', 'οδος']) {
      const words = [...new Set(terms(q))];
      for (const r of locate(t, q)) {
        assert.ok(!lone(t, r.start) && !lone(t, r.end), `code point boundary: ${JSON.stringify(t)} ${r.start}..${r.end}`);
        assert.ok(fold(t.slice(r.start, r.end)).includes(words[r.term]), `the range holds its word: ${JSON.stringify(t.slice(r.start, r.end))} / ${words[r.term]}`);
        checked++;
      }
      // the same rule as filterSessions: every word found by locate exactly when the folded text holds it
      for (let w = 0; w < words.length; w++) assert.strictEqual(locate(t, q).some((r) => r.term === w), fold(t).includes(words[w]), `found iff present: ${JSON.stringify(t)} ${words[w]}`);
    }
  }
  assert.ok(checked > 500, `the property saw enough ranges (${checked})`);

  // anchorKey: Markdown stripped, then fold; the code inside a fence stays (the chat shows it)
  assert.strictEqual(anchorKey('# Plan\n\n**Bold** _it_ and [the link](https://example.test/x) `code`'), 'plan bold it and the link code');
  assert.strictEqual(anchorKey('```ts\nconst a = 1;\n```\nDone'), 'const a = 1; done');
  assert.strictEqual(anchorKey('> quoted\n- item one\n1. first\n* star'), 'quoted item one first star');
  assert.strictEqual(anchorKey('![shot](a.png) Explicación'), 'shot explicacion');
  assert.strictEqual(anchorKey('  many\n\n  spaces\t here '), 'many spaces here');
  assert.strictEqual(anchorKey('[redacted] token ~ path'), '[redacted] token path', 'a mask stays readable; a lone ~ is a strike mark and goes');
  assert.strictEqual(anchorKey(''), '');
  assert.strictEqual(anchorKey(null), '');
  assert.strictEqual(anchorKey('**a**'), anchorKey('a'), 'the rendered text and the source give the same key');
  assert.strictEqual(anchorKey('x'.repeat(20_000)).length, 20_000);
}
console.log('sessionsearch locate/anchorKey tests passed');


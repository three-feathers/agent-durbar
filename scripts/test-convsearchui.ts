/**
 * Spec 095 T030, T034, T042, T043: the pure part of the conversation search window (`src/renderer/convsearch.js`): groups and order,
 * excerpt HTML with marks from offsets and esc(), the state and end-state lines (every note, with the exact locked-values text),
 * accessible names, the announce pace and the pick of the message to jump to. `npm run test:convsearchui`. No DOM, no Electron.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

process.exitCode = 1;
const ROOT = ((): string => {
  for (let d = __dirname; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, 'package.json')) && fs.existsSync(path.join(d, 'src', 'renderer'))) return d;
    if (path.dirname(d) === d) throw new Error('repo root not found');
  }
})();
type Hit = { adapter: string; sessionId: string; agentId?: string; group: 'office' | 'earlier'; app: string; folderName: string; title: string; titleMarks: Array<[number, number]>; time: number; excerpts: Array<{ text: string; marks: Array<[number, number]>; speaker: string; anchor: { n: number; head: string } }>; more: number };
type St = { hits: Map<string, Hit>; order: { office: string[]; earlier: string[] }; progress: { done: number; total: number }; done: boolean; notes: Record<string, unknown> | null; stopped: boolean; failed: boolean; userStop: boolean; queryCut: boolean };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const C = require(path.join(ROOT, 'src', 'renderer', 'convsearch.js')) as {
  keyOf(h: Hit): string; longEnough(q: string): boolean; create(): St; addBatch(st: St, b: unknown): St; finish(st: St, d: unknown, timeOf?: (h: Hit) => number): St;
  sorted(st: St, sort: { key: string; dir: string } | null, timeOf?: (h: Hit) => number): { office: Hit[]; earlier: Hit[] }; count(st: St): number;
  markedHTML(t: string, m: unknown, esc: (s: string) => string): string; excerptHTML(x: unknown, esc: (s: string) => string): string; accName(h: Hit): string;
  stateText(st: St): string; notesText(st: St): string; LOCKED: string; announceDue(last: number | undefined, now: number): boolean; pickAnchor(keys: string[], a: unknown): number;
};
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hit = (over: Partial<Hit>): Hit => ({ adapter: 'copilot', sessionId: 's', group: 'office', app: 'GitHub Copilot', folderName: 'demo', title: 'Untitled session', titleMarks: [], time: 0, excerpts: [], more: 0, ...over });

// ---- a row key is safe in an HTML attribute (no NUL: the parser would turn it into U+FFFD and the key would no longer match)
assert.strictEqual(C.keyOf(hit({ group: 'earlier', adapter: 'vscode', sessionId: 'h/abc:1' })), 'earlier:vscode:h%2Fabc%3A1');
assert.ok(!/[\u0000-\u001f]/.test(C.keyOf(hit({ sessionId: 'a\u0000b' }))));

// ---- FR-033 (Q3): the minimum, as main counts it
assert.ok(C.longEnough('a bc') && !C.longEnough('x y') && !C.longEnough('  ab ') && C.longEnough('\u{1F600}\u{1F600}\u{1F600}'));

// ---- FR-015, FR-010: arrival order kept while scanning; newest first per group at the end; the office group by the window's own time
{
  const st = C.create();
  C.addBatch(st, { hits: [hit({ sessionId: 'a', time: 0 }), hit({ sessionId: 'p1', group: 'earlier', time: 10 })], progress: { done: 2, total: 5 } });
  C.addBatch(st, { hits: [hit({ sessionId: 'b', time: 0 }), hit({ sessionId: 'p2', group: 'earlier', time: 30 }), hit({ sessionId: 'a', title: 'renamed' })], progress: { done: 5, total: 5 } });
  C.addBatch(st, { hits: [{ group: 'nope' }, null] });
  assert.deepStrictEqual(st.order, { office: ['office:copilot:a', 'office:copilot:b'], earlier: ['earlier:copilot:p1', 'earlier:copilot:p2'] }, 'rows appear in arrival order; one seen again keeps its place');
  assert.strictEqual(st.hits.get('office:copilot:a')!.title, 'renamed', 'and takes the new data');
  assert.strictEqual(C.stateText(st), 'Searching, 5 of 5 sessions');
  const lastActive: Record<string, number> = { a: 100, b: 200 };
  C.finish(st, { notes: { searched: 5, folders: 2 }, progress: { done: 5, total: 5 } }, (h) => (h.group === 'office' ? lastActive[h.sessionId] : h.time));
  assert.deepStrictEqual(st.order.office.map((k) => st.hits.get(k)!.sessionId), ['b', 'a'], 'office: newest first by the window\'s last activity (open sessions carry time 0)');
  assert.deepStrictEqual(st.order.earlier.map((k) => st.hits.get(k)!.sessionId), ['p2', 'p1'], 'earlier: newest first (pins not moved up, Q8)');
  assert.strictEqual(C.count(st), 4);
  assert.strictEqual(C.stateText(st), '4 results in 4 sessions');
  // sort headers (FR-004): by name, app, folder or when, inside each group
  const byName = C.sorted(st, { key: 'name', dir: 'asc' });
  assert.deepStrictEqual(byName.office.map((h) => h.title), ['renamed', 'Untitled session']);
  assert.deepStrictEqual(C.sorted(st, { key: 'ago', dir: 'asc' }, (h) => (h.group === 'office' ? lastActive[h.sessionId] : h.time)).earlier.map((h) => h.sessionId), ['p2', 'p1'], 'when: newest first ascending');
  assert.deepStrictEqual(C.sorted(st, null).office.map((h) => h.sessionId), ['b', 'a'], 'no sort: the search\'s order');
  assert.deepStrictEqual(C.sorted(st, { key: 'bogus', dir: 'asc' }).office.map((h) => h.sessionId), ['b', 'a']);
  const empty = C.create();
  C.finish(empty, { notes: { searched: 3, folders: 1 } });
  assert.strictEqual(C.stateText(empty), 'No conversation matches');
  const multi = C.create();
  C.addBatch(multi, { hits: [hit({ sessionId: 'x', excerpts: [{ text: 'a', marks: [], speaker: 'you', anchor: { n: 0, head: 'a' } }, { text: 'b', marks: [], speaker: 'agent', anchor: { n: 1, head: 'b' } }], more: 2 }), hit({ sessionId: 'y' })] });
  C.finish(multi, {});
  assert.strictEqual(C.stateText(multi), '5 results in 2 sessions', 'each excerpt and "+N more" is a result; a title hit is one');
}

// ---- FR-011: marks from offsets, every piece escaped; bad ranges dropped, overlapping merged
{
  assert.strictEqual(C.markedHTML('fix the <invoice> export', [[9, 16], [18, 24]], esc), 'fix the &lt;<mark>invoice</mark>&gt; <mark>export</mark>');
  assert.strictEqual(C.markedHTML('abcdef', [[4, 2], [-5, 1], [1, 3], [2, 4], [10, 20]], esc), '<mark>abcd</mark>ef', 'merged, clamped');
  assert.strictEqual(C.markedHTML('<img src=x onerror=1>', [[0, 4]], esc), '<mark>&lt;img</mark> src=x onerror=1&gt;', 'never raw HTML');
  assert.strictEqual(C.markedHTML(null as unknown as string, null, esc), '');
  // review of PR 1240 (Q1): bidi controls are dropped for display and the marks move with the text
  assert.strictEqual(C.markedHTML('a\u202Eb\u2066cd\u2069 invoice', [[8, 15]], esc), 'abcd <mark>invoice</mark>');
  assert.strictEqual(C.markedHTML('\u202Dinvoice\u202C x', [[1, 8]], esc), '<mark>invoice</mark> x');
  assert.ok(!/[\u202A-\u202E\u2066-\u2069]/.test(C.excerptHTML({ text: 'x\u2067y\u202Bz', marks: [], speaker: 'agent' }, esc)), 'none in an excerpt');
  assert.strictEqual(C.excerptHTML({ text: 'the invoice', marks: [[4, 11]], speaker: 'you' }, esc), '<span class="cs-who">You:</span> the <mark>invoice</mark>');
  assert.strictEqual(C.excerptHTML({ text: 'x', marks: [], speaker: 'agent' }, esc), '<span class="cs-who">Agent:</span> x');
  assert.strictEqual(C.excerptHTML({ text: 'x', marks: [], speaker: '<b>' }, esc), 'x', 'an unknown speaker shows no prefix');
}

// ---- US3.4: accessible names
assert.strictEqual(C.accName(hit({ title: 'Invoice work', excerpts: [{ text: 'fix the invoice', marks: [[8, 15]], speaker: 'you', anchor: { n: 0, head: 'fix' } }], more: 2 })), 'Invoice work, GitHub Copilot, demo, open, match: You: fix the invoice, 2 more matches');
assert.strictEqual(C.accName(hit({ group: 'earlier', title: 'invoice plan', titleMarks: [[0, 7]] })), 'invoice plan, GitHub Copilot, demo, previous, match: match in the title');

// ---- FR-014: every end-state note (owner answers C, D; review N-R2; stopped by main; the window's Stop)
{
  const st = C.create();
  C.finish(st, { notes: { searched: 12, folders: 3, notInstalled: ['Codex'], titleOnly: { count: 4, apps: ['GitHub Copilot', 'Codex'] }, tooLarge: 2, unreadable: 1, hidden: 3, floorsOff: 2, floorOffFolders: 1, lateLists: 2, lateApps: ['Codex', 'VS Code'], bounded: 1, maskFailed: 1, cut: 2, capped: { sessions: false, perFolder: false, results: true }, timedOut: true, queryCut: true, mcpValuesLocked: true } });
  const t = C.notesText(st);
  for (const part of ['Searched 12 sessions in 3 folders.', 'Codex (not installed or signed out)', 'earlier GitHub Copilot and Codex sessions, by title only (4)', '2 sessions too large to search', '1 unreadable session', '3 hidden earlier sessions', '2 sessions on floors that are off',
    'earlier Codex sessions of 1 folder on floors that are off', 'earlier sessions of 2 folders (no answer in time: Codex and VS Code)', '1 message too dense to search', '1 message that could not be masked', '2 long messages searched in their first 20 000 characters only.',
    '200 shown; narrow your search.', 'Stopped after 60 s; narrow your search.', 'Your search was cut to 8 words and 200 characters.', 'Some saved MCP values are locked; excerpts may show them.']) assert.ok(t.includes(part), `the end state says "${part}": ${t}`);
  assert.strictEqual(C.LOCKED, 'Some saved MCP values are locked; excerpts may show them.', 'the exact text of owner answer D');
  const quiet = C.create();
  C.finish(quiet, { notes: { searched: 2, folders: 1, notInstalled: [], titleOnly: { count: 0, apps: [] }, capped: {} } });
  assert.strictEqual(C.notesText(quiet), 'Searched 2 sessions in 1 folder.', 'only what applies');
  const stopped = C.create();
  C.finish(stopped, { stopped: true, notes: { searched: 0, folders: 0 } });
  assert.ok(C.notesText(stopped).startsWith('The search stopped when the window was closed or hidden.'), 'main\'s stop is said');
  const mine = C.create();
  mine.userStop = true;
  assert.strictEqual(C.notesText(mine), 'Stopped.');
  const failed = C.create();
  C.finish(failed, { failed: true, notes: null });
  assert.deepStrictEqual([C.stateText(failed), C.notesText(failed)], ['The search could not finish.', ''], 'a start that fails says it once (review of PR 1240, R5)');
  const failedAfter = C.create();
  C.addBatch(failedAfter, { hits: [hit({ sessionId: 'z' })] });
  C.finish(failedAfter, { failed: true, notes: { searched: 1, folders: 1 } });
  assert.ok(C.notesText(failedAfter).startsWith('The search could not finish. Searched 1 session'), 'with results shown, the end line says it did not finish');
  // review of PR 1240 (R6): a window-side Stop has no notes from main, and the cut query is still said
  const cutStop = C.create();
  cutStop.queryCut = true;
  cutStop.userStop = true;
  assert.strictEqual(C.notesText(cutStop), 'Stopped. Your search was cut to 8 words and 200 characters.');
  const cutDone = C.create();
  cutDone.queryCut = true;
  C.finish(cutDone, { notes: { searched: 1, folders: 1 } });
  assert.strictEqual(C.notesText(cutDone), 'Searched 1 session in 1 folder. Your search was cut to 8 words and 200 characters.', 'said once, from the window or from main');
  const capped = C.create();
  C.finish(capped, { notes: { searched: 400, folders: 9, capped: { sessions: true } } });
  assert.ok(C.notesText(capped).includes('Only the newest sessions were searched'));
}

// ---- US3.4: the live region at most every 2 s
assert.ok(C.announceDue(undefined, 0) && !C.announceDue(1000, 2500) && C.announceDue(1000, 3000));

// ---- FR-013 (T042): the message to jump to
{
  const keys = ['hello there', 'fix the invoice export to csv', 'done: the invoice export writes', 'fix the invoice export to csv'];
  assert.strictEqual(C.pickAnchor(keys, { n: 1, head: 'fix the invoice' }), 1, 'the nth message when it begins with the head');
  assert.strictEqual(C.pickAnchor(keys, { n: 2, head: 'fix the invoice' }), 1, 'else the nearest one that does (another replay cap)');
  assert.strictEqual(C.pickAnchor(keys, { n: 9, head: 'fix the invoice' }), 3);
  assert.strictEqual(C.pickAnchor(keys, { n: 0, head: 'not in this chat' }), -1, 'older than the chat shows');
  assert.strictEqual(C.pickAnchor(keys, { n: 0, head: '' }), -1, 'no head, no jump');
  assert.strictEqual(C.pickAnchor([], { n: 0, head: 'x' }), -1);
}

process.exitCode = 0;
console.log('convsearchui: groups and order, marks and escaping, state and every end-state note, accessible names, announce pace, anchor pick OK');

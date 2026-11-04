/**
 * The agent rail's List view (spec 005 FR-194, FR-216): the pure rules of `src/renderer/railorder.js`. Folders with someone needing you
 * first (oldest wait first), then the office's room order; inside a folder whoever needs you first (oldest first), then `prio`, then
 * creation order; time never reorders anything. The collapsed folders: a tolerant load (corrupt, oversized, wrong-typed: nothing collapsed)
 * and the stored value (known folders only, removed when empty).
 * `npm run test:railorder`. Pure module; runs on any OS; no Electron, no credits.
 */
import assert from 'assert';
import path from 'path';
import fs from 'fs';

process.exitCode = 1;
const ROOT = path.join(__dirname, '..', '..');
type Item = { id: string; room: string; rank?: number; needs?: boolean; since?: number; prio?: number; i?: number };
type Group = { room: string; ids: string[]; needN: number };
const R = require(path.join(ROOT, 'src', 'renderer', 'railorder.js')) as {
  FOLD_KEY: string; MAX_FOLDS: number; MAX_PATH: number;
  group(items: Item[]): Group[];
  loadFolds(raw: unknown): Set<string>;
  foldsJSON(closed: Set<string>, known: Iterable<string>, listed?: boolean): string | null;
};

// ---- order ----
const it = (id: string, room: string, rank: number, i: number, o: Partial<Item> = {}): Item => ({ id, room, rank, needs: false, prio: 2, i, ...o });
// three folders in the office's room order A, B, C; nobody needs you: the office's order, creation order inside
{
  const g = R.group([it('c1', 'C', 2, 0), it('a1', 'A', 0, 1), it('b1', 'B', 1, 2), it('a2', 'A', 0, 3)]);
  assert.deepStrictEqual(g.map((x) => x.room), ['A', 'B', 'C'], 'no one needs you: folders in the office order');
  assert.deepStrictEqual(g[0].ids, ['a1', 'a2'], 'creation order inside a folder');
  assert.deepStrictEqual(g.map((x) => x.needN), [0, 0, 0]);
}
// a folder with someone needing you leads; two such folders by their oldest wait, not their rank
{
  const g = R.group([
    it('a1', 'A', 0, 0), it('b1', 'B', 1, 1, { needs: true, since: 2000, prio: 0 }),
    it('c1', 'C', 2, 2, { needs: true, since: 1000, prio: 1 }), it('c2', 'C', 2, 3, { needs: true, since: 3000, prio: 0 }),
  ]);
  assert.deepStrictEqual(g.map((x) => x.room), ['C', 'B', 'A'], 'folders needing you first, oldest wait first (C waited since 1000)');
  assert.deepStrictEqual(g[0].ids, ['c1', 'c2'], 'inside: oldest wait first, before prio');
  assert.deepStrictEqual(g.map((x) => x.needN), [2, 1, 0], 'the count of who needs you per folder');
}
// inside a folder: needs first, then prio, then creation order
{
  const g = R.group([
    it('x1', 'A', 0, 0, { prio: 2 }), it('x2', 'A', 0, 1, { prio: 1 }), it('x3', 'A', 0, 2, { needs: true, since: 50, prio: 0 }),
    it('x4', 'A', 0, 3, { prio: 2 }), it('x5', 'A', 0, 4, { needs: true, since: 10, prio: 1 }),
  ]);
  assert.deepStrictEqual(g[0].ids, ['x5', 'x3', 'x2', 'x1', 'x4'], 'needs (oldest first), then prio, then creation order');
}
// the result never depends on the input order (a comparator that only works one way round is caught): every rotation of the input
{
  const rot = <T>(l: T[], k: number): T[] => l.slice(k).concat(l.slice(0, k));
  // a folder that needs you leads even when the office puts it last and the quiet folders are many
  const fs0 = [it('q1', 'A', 0, 0), it('q2', 'B', 1, 1), it('q3', 'C', 2, 2), it('q4', 'E', 4, 3), it('n1', 'D', 3, 4, { needs: true, since: 9, prio: 2 })];
  for (let k = 0; k < fs0.length; k++) assert.deepStrictEqual(R.group(rot(fs0, k)).map((x) => x.room), ['D', 'A', 'B', 'C', 'E'], `folders, rotation ${k}`);
  // inside a folder whoever needs you leads even with the same prio and a later creation (a spending limit needs you at prio 2)
  const rs0 = [it('r1', 'A', 0, 0), it('r2', 'A', 0, 1), it('r3', 'A', 0, 2, { needs: true, since: 7, prio: 2 }), it('r4', 'A', 0, 3)];
  for (let k = 0; k < rs0.length; k++) assert.deepStrictEqual(R.group(rot(rs0, k))[0].ids, ['r3', 'r1', 'r2', 'r4'], `rows, rotation ${k}`);
}
// a tie on the wait keeps prio, then creation order; an unknown wait sorts after a known one
{
  const g = R.group([it('p', 'A', 0, 0, { needs: true, since: 5, prio: 1 }), it('q', 'A', 0, 1, { needs: true, since: 5, prio: 0 }), it('r', 'A', 0, 2, { needs: true })]);
  assert.deepStrictEqual(g[0].ids, ['q', 'p', 'r']);
}
// same rank (two folders the office does not order): first seen first; an unranked folder goes last
{
  const g = R.group([it('z', 'Z', NaN, 0), it('y', 'Y', 0, 1), it('w', 'W', 0, 2)]);
  assert.deepStrictEqual(g.map((x) => x.room), ['Y', 'W', 'Z']);
}
// time never reorders: the rules read no clock, and the same input gives the same output
{
  const was = Date.now;
  (Date as unknown as { now: () => number }).now = () => { throw new Error('the order read the clock'); };
  try {
    const input = [it('a', 'A', 0, 0, { needs: true, since: 100 }), it('b', 'B', 1, 1, { needs: true, since: 50 })];
    assert.deepStrictEqual(R.group(input), R.group(input.map((x) => ({ ...x }))));
  } finally { (Date as unknown as { now: () => number }).now = was; }
}
// hostile input: not an array, missing ids, __proto__ as a folder key
assert.deepStrictEqual(R.group(null as unknown as Item[]), []);
assert.deepStrictEqual(R.group([null as unknown as Item, { room: 'A' } as Item, it('k', '__proto__', 0, 0)]).map((x) => x.room), ['__proto__']);

// ---- collapsed folders ----
assert.strictEqual(R.FOLD_KEY, 'durbar.railFolds');
const ok = JSON.stringify({ v: 1, closed: ['/home/me/a', 'C:\\work\\b'] });
assert.deepStrictEqual([...R.loadFolds(ok)], ['/home/me/a', 'C:\\work\\b'], 'a saved value loads');
assert.deepStrictEqual([...R.loadFolds(JSON.parse(ok))], ['/home/me/a', 'C:\\work\\b'], 'an object loads too');
for (const bad of [null, undefined, '', '{', 'null', '[]', '{"v":2,"closed":["/a"]}', '{"v":1}', '{"v":1,"closed":"/a"}', '{"v":1,"closed":[1]}',
  '{"v":1,"closed":[""]}', JSON.stringify({ v: 1, closed: ['/a', 'x'.repeat(R.MAX_PATH + 1)] }), JSON.stringify({ v: 1, closed: Array.from({ length: R.MAX_FOLDS + 1 }, (_, i) => '/f' + i) }), 42, [] as unknown]) {
  assert.strictEqual(R.loadFolds(bad).size, 0, `nothing collapsed for ${String(bad).slice(0, 40)}`);
}
assert.strictEqual(R.loadFolds(JSON.stringify({ v: 1, closed: Array.from({ length: R.MAX_FOLDS }, (_, i) => '/f' + i) })).size, R.MAX_FOLDS, 'exactly the cap loads');
// the stored value: known folders only, in order; null (remove the key) when nothing is collapsed
assert.strictEqual(R.foldsJSON(new Set(['/a', '/gone', '/b']), ['/a', '/b', '/c']), JSON.stringify({ v: 1, closed: ['/a', '/b'] }));
assert.strictEqual(R.foldsJSON(new Set(), ['/a']), null);
// FR-216 item 4: a toggle before the session list has loaded keeps a saved path whose folder has not appeared yet; once listed it is pruned
assert.strictEqual(R.foldsJSON(new Set(['/later', '/a']), ['/a'], false), JSON.stringify({ v: 1, closed: ['/later', '/a'] }), 'before the list has loaded, an unseen saved folder is kept');
assert.strictEqual(R.foldsJSON(new Set(['/later', '/a']), ['/a'], true), JSON.stringify({ v: 1, closed: ['/a'] }), 'once listed, an unseen folder is pruned');
assert.strictEqual(R.foldsJSON(new Set(['x'.repeat(R.MAX_PATH + 1)]), [], false), null, 'before the list has loaded, an over-long path is still never stored');
assert.strictEqual(R.foldsJSON(new Set(['/gone']), ['/a']), null, 'only gone folders: the key is removed');
assert.strictEqual(R.foldsJSON(new Set(['x'.repeat(R.MAX_PATH + 1)]), ['x'.repeat(R.MAX_PATH + 1)]), null, 'an over-long path is never stored');
{
  const many = Array.from({ length: R.MAX_FOLDS + 5 }, (_, i) => '/f' + i);
  const v = R.foldsJSON(new Set(many), many);
  assert.strictEqual(JSON.parse(v as string).closed.length, R.MAX_FOLDS, 'at most the cap is stored');
  assert.strictEqual(R.loadFolds(v).size, R.MAX_FOLDS, 'and it loads back');
}
// round trip
assert.deepStrictEqual([...R.loadFolds(R.foldsJSON(new Set(['/a']), ['/a']))], ['/a']);

// source pin (FR-216 item 4): the page prunes saved folds only once the session list has loaded, as pruneNumbers does
{
  const src = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'app.js'), 'utf8');
  const fn = (src.match(/function saveFolds\(\)\{[\s\S]*?\n\}/) || [''])[0];
  assert.ok(fn, 'app.js has saveFolds()');
  assert.ok(/RAIL\.foldsJSON\(railFolds\(\),\s*ROOMS\.map\(r=>r\.path\),\s*agentsListed\|\|demoOn\)/.test(fn), 'saveFolds() passes agentsListed||demoOn to foldsJSON, so nothing is pruned before the session list has loaded');
}

process.exitCode = 0;
console.log('railorder tests passed');

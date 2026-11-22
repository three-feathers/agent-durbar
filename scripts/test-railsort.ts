/**
 * The agent rail's sort choice (spec 005 FR-341, issue #1961): the pure rules of `src/renderer/railorder.js` `group(items, sort)`.
 * Five choices; the rows are sorted inside each folder, folders by their first row; the default is FR-194's order; a missing creation
 * time is last under Oldest and first under Newest; the stored choice loads tolerantly. The suite then runs against mutated copies of
 * the module and each mutant must fail it (the test catches every choice and the tie rule).
 * `npm run test:railsort`. Pure module; runs on any OS; no Electron, no credits.
 */
import assert from 'assert';
import path from 'path';
import fs from 'fs';

process.exitCode = 1;
const ROOT = path.join(__dirname, '..', '..');
// a Windows checkout may have CRLF line endings: the mutants' anchor texts span lines, so read the source with LF
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'railorder.js'), 'utf8').replace(/\r\n/g, '\n');
type Item = { id: string; room: string; rank?: number; needs?: boolean; working?: boolean; since?: number; created?: number; prio?: number; i?: number };
type Group = { room: string; ids: string[]; needN: number };
type Mod = {
  BORN_KEY: string; MAX_BORN: number; loadBorn(raw: unknown): Record<string, number>; stampBorn(m: unknown, ids: unknown, now: number): Record<string, number>; bornJSON(m: Record<string, number>, ids: string[], listed?: boolean): string | null;
  SORTS: string[][]; DEFAULT_SORT: string; SORT_KEY: string;
  group(items: Item[], sort?: unknown): Group[];
  loadSort(raw: unknown): string; sortLabel(k: string): string;
};
const load = (code: string): Mod => { const m = { exports: {} as unknown }; new Function('module', 'self', code)(m, undefined); return m.exports as Mod; };

const it = (id: string, room: string, rank: number, i: number, o: Partial<Item> = {}): Item => ({ id, room, rank, needs: false, prio: 2, i, ...o });
const rooms = (g: Group[]) => g.map((x) => x.room);
// two folders A (rank 0) and B (rank 1), mixed states and creation times
const mixed = (): Item[] => [
  it('a1', 'A', 0, 0, { created: 300 }),
  it('a2', 'A', 0, 1, { working: true, created: 100 }),
  it('a3', 'A', 0, 2, { needs: true, since: 5000, created: 200 }),
  it('b1', 'B', 1, 3, { needs: true, since: 1000, created: 500 }),
  it('b2', 'B', 1, 4, { working: true, created: 50 }),
  it('b3', 'B', 1, 5, { created: 400 }),
];

function suite(R: Mod): void {
  // the choices and their names
  assert.deepStrictEqual(R.SORTS.map((s) => s[0]), ['needs', 'working', 'waiting', 'oldest', 'newest']);
  assert.deepStrictEqual(R.SORTS.map((s) => s[1]), ['Needs you first', 'Working first', 'Waiting first', 'Oldest first', 'Newest first']);
  assert.strictEqual(R.DEFAULT_SORT, 'needs');
  assert.strictEqual(R.sortLabel('newest'), 'Newest first');
  assert.strictEqual(R.sortLabel('nonsense'), 'Needs you first', 'an unknown key reads as the default');

  // default: FR-194's order; no argument, 'needs' and a junk value are all the same bytes
  {
    const d = JSON.stringify(R.group(mixed()));
    assert.strictEqual(JSON.stringify(R.group(mixed(), 'needs')), d, "'needs' is the default order");
    assert.strictEqual(JSON.stringify(R.group(mixed(), 'junk')), d, 'a junk choice is the default');
    const g = R.group(mixed());
    assert.deepStrictEqual(rooms(g), ['B', 'A'], 'B waited since 1000: its folder leads');
    assert.deepStrictEqual(g[0].ids, ['b1', 'b2', 'b3']);
    assert.deepStrictEqual(g[1].ids, ['a3', 'a1', 'a2'], 'whoever needs you first, then creation order (the rows have no working key in FR-194)');
  }
  // Working first: working, then waiting, then the rest; folder of the first row; ties by FR-194's order
  {
    const g = R.group(mixed(), 'working');
    assert.deepStrictEqual(g.map((x) => x.ids), [['b2', 'b1', 'b3'], ['a2', 'a3', 'a1']], 'working, then needs, then the rest');
    assert.deepStrictEqual(rooms(g), ['B', 'A'], 'both folders open on a working row: the default folder order (B waited longer)');
  }
  // Waiting first: needs you, then working, then the rest
  {
    const g = R.group(mixed(), 'waiting');
    assert.deepStrictEqual(g.map((x) => x.ids), [['b1', 'b2', 'b3'], ['a3', 'a2', 'a1']]);
  }
  // a folder whose first row ranks better under the choice goes first (A has a working row, B has none)
  {
    const items = [it('b1', 'B', 0, 0, { needs: true, since: 1 }), it('a1', 'A', 1, 1, { working: true })];
    assert.deepStrictEqual(rooms(R.group(items, 'working')), ['A', 'B'], 'folder of the working row first, though B has the older wait and the better rank');
    assert.deepStrictEqual(rooms(R.group(items, 'waiting')), ['B', 'A']);
    assert.deepStrictEqual(rooms(R.group(items, 'needs')), ['B', 'A']);
  }
  // the default already puts the longest wait first (FR-194, no separate choice); rows move only with a status, never with the clock
  {
    const items = [it('x', 'A', 0, 0, { needs: true, since: 3000 }), it('y', 'A', 0, 1, { needs: true, since: 1000 }), it('z', 'A', 0, 2), it('w', 'A', 0, 3, { needs: true })];
    assert.deepStrictEqual(R.group(items, 'needs')[0].ids, ['y', 'x', 'w', 'z'], 'oldest wait first; no known time after the known ones; then the rest');
    assert.ok(!R.SORTS.some((s) => s[0] === 'longest'), 'no separate Longest waiting choice');
    const before = Date.now; (Date as unknown as { now: () => number }).now = () => before() + 7 * 24 * 3600 * 1000;
    try { for (const k of ['needs', 'working', 'waiting', 'oldest', 'newest']) assert.deepStrictEqual(R.group(items, k).map((g) => g.ids), (() => { Date.now = before; const r = R.group(items, k).map((g) => g.ids); (Date as unknown as { now: () => number }).now = () => before() + 7 * 24 * 3600 * 1000; return r; })(), 'a week later: the same order'); } finally { Date.now = before; }
  }
  // Oldest / Newest by creation time, folders by their first row
  {
    const g = R.group(mixed(), 'oldest');
    assert.deepStrictEqual(g.map((x) => x.ids), [['b2', 'b3', 'b1'], ['a2', 'a3', 'a1']]);
    assert.deepStrictEqual(rooms(g), ['B', 'A'], 'B holds the oldest session (50)');
    const n = R.group(mixed(), 'newest');
    assert.deepStrictEqual(n.map((x) => x.ids), [['b1', 'b3', 'b2'], ['a1', 'a3', 'a2']]);
    assert.deepStrictEqual(rooms(n), ['B', 'A'], 'B holds the newest session (500)');
    const flip = R.group([it('a', 'A', 0, 0, { created: 10 }), it('b', 'B', 1, 1, { created: 20 })], 'newest');
    assert.deepStrictEqual(rooms(flip), ['B', 'A'], 'folders follow the first row, not the room rank');
    assert.deepStrictEqual(rooms(R.group([it('a', 'A', 0, 0, { created: 10 }), it('b', 'B', 1, 1, { created: 20 })], 'oldest')), ['A', 'B']);
  }
  // a missing creation time: last under Oldest, first under Newest
  {
    const items = [it('k1', 'A', 0, 0, { created: 10 }), it('u', 'A', 0, 1), it('k2', 'A', 0, 2, { created: 20 })];
    assert.deepStrictEqual(R.group(items, 'oldest')[0].ids, ['k1', 'k2', 'u']);
    assert.deepStrictEqual(R.group(items, 'newest')[0].ids, ['u', 'k2', 'k1']);
  }
  // ties (equal creation time) keep FR-194's order: whoever needs you, then prio, then creation order
  {
    const items = [it('p', 'A', 0, 0, { created: 5, prio: 2 }), it('q', 'A', 0, 1, { created: 5, prio: 1 }), it('r', 'A', 0, 2, { created: 5, needs: true, since: 9, prio: 3 }), it('s', 'A', 0, 3, { created: 5, prio: 1 })];
    assert.deepStrictEqual(R.group(items, 'oldest')[0].ids, ['r', 'q', 's', 'p']);
    assert.deepStrictEqual(R.group(items, 'newest')[0].ids, ['r', 'q', 's', 'p']);
  }
  // folder ties: equal first rows fall back to FR-194's folder order (needs, oldest wait, room rank, first seen)
  {
    const items = [it('b', 'B', 1, 0, { created: 7 }), it('a', 'A', 0, 1, { created: 7 })];
    assert.deepStrictEqual(rooms(R.group(items, 'oldest')), ['A', 'B']);
  }
  // nothing is lost or invented; bad input is skipped
  {
    const g = R.group([null, { id: 3 }, it('a', 'A', 0, 0)] as unknown as Item[], 'oldest');
    assert.deepStrictEqual(g.map((x) => x.ids), [['a']]);
    assert.deepStrictEqual(R.group(null as unknown as Item[], 'working'), []);
    const ids = R.group(mixed(), 'newest').flatMap((x) => x.ids).sort();
    assert.deepStrictEqual(ids, ['a1', 'a2', 'a3', 'b1', 'b2', 'b3']);
  }
  // first-seen times (durbar.railBorn): stamp once, survive a reload (store -> load), pruned to the listed ids, tolerant load
  {
    assert.strictEqual(R.BORN_KEY, 'durbar.railBorn');
    const m1 = R.stampBorn({}, ['a', 'b'], 1000);
    assert.deepStrictEqual(m1, { a: 1000, b: 1000 }, 'a new id gets the time it was first seen');
    const m2 = R.stampBorn(m1, ['a', 'b', 'c'], 2000);
    assert.deepStrictEqual(m2, { a: 1000, b: 1000, c: 2000 }, 'a known id keeps its time');
    const json = R.bornJSON(m2, ['a', 'b', 'c'], true) as string;
    assert.deepStrictEqual(R.loadBorn(json), m2, 'the stored map loads back as it was (a reload)');
    assert.deepStrictEqual(R.loadBorn(R.bornJSON(m2, ['a', 'c'], true)), { a: 1000, c: 2000 }, 'an id that is gone is pruned');
    assert.strictEqual(R.bornJSON(m2, [], true), null, 'nothing listed: the key is removed');
    assert.deepStrictEqual(R.loadBorn(R.bornJSON(m2, [], false)), m2, 'before the list has loaded nothing is pruned');
    for (const bad of [null, undefined, 'x{', '[]', '7', 5, [1]]) assert.deepStrictEqual(R.loadBorn(bad), {}, 'a bad stored value is an empty map');
    assert.deepStrictEqual(R.loadBorn({ a: 5, b: -1, c: 'x', d: NaN, [`${'i'.repeat(201)}`]: 3 }), { a: 5 }, 'bad times and long ids are dropped');
    const many: Record<string, number> = {}; for (let i = 0; i < R.MAX_BORN + 50; i++) many['s' + i] = i + 1;
    assert.strictEqual(Object.keys(R.loadBorn(many)).length, R.MAX_BORN, 'at most MAX_BORN entries');
    assert.deepStrictEqual(R.stampBorn({}, [null, '', 3, 'ok'], 9), { ok: 9 }, 'bad ids are not stamped');
  }
  // the stored choice
  assert.strictEqual(R.loadSort('oldest'), 'oldest');
  for (const bad of [null, undefined, '', 'Oldest', 'oldest ', 7, {}, ['oldest'], 'x'.repeat(5000)]) assert.strictEqual(R.loadSort(bad), 'needs', 'a bad stored value is the default');
  // 15 agents, 200000 pushes of the same order: linear, generous limit
  {
    const big: Item[] = []; for (let i = 0; i < 20000; i++) big.push(it('n' + i, 'R' + (i % 50), i % 50, i, { created: (i * 7919) % 10007, needs: i % 9 === 0, since: i % 13, working: i % 5 === 0 }));
    const t = Date.now(); for (const k of ['needs', 'working', 'waiting', 'oldest', 'newest']) R.group(big, k);
    assert.ok(Date.now() - t < 5000, 'five sorts of 20000 rows in under 5 s');
  }
}

suite(load(SRC));

// mutants: each change to the rules must fail the suite
const MUTANTS: Array<[string, string, string]> = [
  ['working: working and waiting swapped', "if(sort==='working')return x.working?0:x.needs?1:2;", "if(sort==='working')return x.needs?0:x.working?1:2;"],
  ['waiting: working and waiting swapped', "if(sort==='waiting')return x.needs?0:x.working?1:2;", "if(sort==='waiting')return x.working?0:x.needs?1:2;"],
  ['oldest: newest first', "if(sort==='oldest')return num(x.created)?x.created:Infinity;", "if(sort==='oldest')return num(x.created)?-x.created:-Infinity;"],
  ['newest: oldest first', "if(sort==='newest')return num(x.created)?-x.created:-Infinity;", "if(sort==='newest')return num(x.created)?x.created:Infinity;"],
  ['oldest: no time sorts first', "if(sort==='oldest')return num(x.created)?x.created:Infinity;", "if(sort==='oldest')return num(x.created)?x.created:-Infinity;"],
  ['newest: no time sorts last', "if(sort==='newest')return num(x.created)?-x.created:-Infinity;", "if(sort==='newest')return num(x.created)?-x.created:Infinity;"],
  ['tie rule: rows tie by creation order only', 'return a===b?inGroup(p,q):a<b?-1:1;};', 'return a===b?(p.i||0)-(q.i||0):a<b?-1:1;};'],
  ['tie rule: ties not broken at all', 'return a===b?inGroup(p,q):a<b?-1:1;};', 'return a===b?0:a<b?-1:1;};'],
  ['folders: ordered by room rank only', 'return x===y?dflt(a,b):x<y?-1:1;', 'return a.rank-b.rank||a.first-b.first;'],
  ['folders: tie falls to first seen only', 'return x===y?dflt(a,b):x<y?-1:1;', 'return x===y?a.first-b.first:x<y?-1:1;'],
  ['folders: first row key reversed', 'return x===y?dflt(a,b):x<y?-1:1;', 'return x===y?dflt(a,b):x<y?1:-1;'],
  ['default: the choice changes the default order', 'const how=isSort(sort)?sort:DEFAULT_SORT;', "const how=isSort(sort)?sort:'working';"],
  ['born: a known id is stamped again', 'if(typeof id===\'string\'&&id&&!Object.prototype.hasOwnProperty.call(out,id))out[id]=now;', 'if(typeof id===\'string\'&&id)out[id]=now;'],
  ['born: nothing pruned', 'if(listed===false||keep.has(id)){out[id]=t;n++;}', '{out[id]=t;n++;}'],
  ['born: everything pruned before the list loads', 'if(listed===false||keep.has(id))', 'if(keep.has(id))'],
  ['born: load accepts any time', 'num(t)&&t>0', 'true'],
  ['default: needs-first rule dropped', 'if(!!p.needs!==!!q.needs)return p.needs?-1:1;\n      if(p.needs)', 'if(p.needs)'],
  ['stored choice: any string accepted', "const isSort=v=>typeof v==='string'&&SORTS.some(s=>s[0]===v);", "const isSort=v=>typeof v==='string';"],
  ['stored choice: a bad value is kept', 'return isSort(raw)?raw:DEFAULT_SORT;', 'return raw;'],
];
let caught = 0;
for (const [name, from, to] of MUTANTS) {
  assert.ok(SRC.includes(from), `mutant "${name}": the text to change is in railorder.js`);
  let failed = false;
  try { suite(load(SRC.replace(from, to))); } catch { failed = true; }
  assert.ok(failed, `mutant "${name}" must fail the suite`);
  caught++;
}

process.exitCode = 0;
console.log(`railsort tests passed (${caught} mutants caught)`);

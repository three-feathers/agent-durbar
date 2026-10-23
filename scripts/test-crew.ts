/** Cheeky crew (spec 077): the pure pick and storage rules of src/renderer/crew.js. `npm run test:crew`. No DOM, no credits. */
import * as assert from 'assert';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const C = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'crew.js')) as {
  IDS: string[]; MAX_ENTRIES: number; MAX_ID: number;
  seeded: (s: string) => () => number;
  seededRand: (s: string) => number;
  pickCharacter: (id: string, ids: string[], inUse: string[], rand?: (id: string) => number) => string;
  assignCrew: (m: Record<string, string>, ids: string[], chars: string[], rand?: (id: string) => number) => Record<string, string>;
  pruneCrew: (m: Record<string, string>, ids: string[]) => Record<string, string>;
  loadCrew: (j: unknown, ids?: string[]) => Record<string, string>;
};

const ids = ['a', 'b', 'c', 'd'];
assert.ok(C.IDS.length >= 4 && new Set(C.IDS).size === C.IDS.length, 'the character ids are distinct');

// ---- seeded: repeatable, in [0,1), and different ids differ ----
const s1 = C.seeded('session-1'), s2 = C.seeded('session-1');
for (let i = 0; i < 20; i++) { const v = s1(); assert.strictEqual(v, s2()); assert.ok(v >= 0 && v < 1); }
assert.strictEqual(C.seededRand('x'), C.seededRand('x'), 'same id, same number');
assert.notStrictEqual(C.seededRand('x'), C.seededRand('y'), 'another id, another number');

// ---- pick: least used, with the random source injected ----
assert.strictEqual(C.pickCharacter('n', ids, [], () => 0), 'a', 'nothing used: any, here the first for r=0');
assert.strictEqual(C.pickCharacter('n', ids, [], () => 0.99), 'd', 'and the last for r near 1');
assert.strictEqual(C.pickCharacter('n', ids, ['a', 'b', 'c'], () => 0), 'd', 'the only unused one');
assert.strictEqual(C.pickCharacter('n', ids, ['a', 'a', 'b', 'c', 'd'], () => 0.5), ['b', 'c', 'd'][1], 'the least used: a is taken twice, the rest once');
assert.strictEqual(C.pickCharacter('n', ids, ['a', 'b', 'c', 'd'], () => 0), 'a', 'all taken once: twins only now');
assert.strictEqual(C.pickCharacter('n', ids, ['zzz', 'a'], () => 0), 'b', 'unknown ids in use are ignored');
assert.ok(ids.includes(C.pickCharacter('n', ids, [], () => NaN)), 'a bad random value still picks a character');
assert.ok(ids.includes(C.pickCharacter('n', ids, [], () => 7)) && ids.includes(C.pickCharacter('n', ids, [], () => -3)), 'out-of-range random values are clamped');
assert.ok(C.IDS.includes(C.pickCharacter('n', [], [], () => 0)), 'no list given: the built-in characters');
// no random source given: Math.random, still a valid id
for (let i = 0; i < 20; i++) assert.ok(ids.includes(C.pickCharacter('n', ids, [])));

// ---- assign: no twin until every character is taken ----
{
  const sessions = Array.from({ length: 4 }, (_, i) => 's' + i);
  for (let seed = 0; seed < 50; seed++) {
    const m = C.assignCrew({}, sessions, ids, (id) => C.seededRand(id + seed));
    assert.strictEqual(new Set(Object.values(m)).size, 4, 'four sessions, four characters (seed ' + seed + ')');
  }
  const eight = Array.from({ length: 8 }, (_, i) => 's' + i);
  const m8 = C.assignCrew({}, eight, ids, (id) => C.seededRand(id));
  const counts = ids.map((c) => Object.values(m8).filter((x) => x === c).length);
  assert.deepStrictEqual(counts, [2, 2, 2, 2], 'eight sessions, each character exactly twice');
  const same = C.assignCrew({}, eight, ids, (id) => C.seededRand(id));
  assert.deepStrictEqual(same, m8, 'the seeded pick is repeatable');
  // a given character never changes, and a gone session frees its character
  const kept = C.assignCrew({ s0: 'c' }, ['s0', 's1'], ids, () => 0);
  assert.strictEqual(kept.s0, 'c', 'an assigned session keeps its character');
  assert.strictEqual(kept.s1, 'a', 'the new one is picked among the unused');
  const gone = C.assignCrew({ old: 'a', s0: 'b' }, ['s0', 'n'], ids, () => 0);
  assert.strictEqual(gone.n, 'a', 'a session that is not in the office does not hold its character');
  const input = { s0: 'a' }; C.assignCrew(input, ['s0', 's1'], ids, () => 0);
  assert.deepStrictEqual(input, { s0: 'a' }, 'the input map is not changed');
}

// ---- prune ----
assert.deepStrictEqual(C.pruneCrew({ a: 'x', b: 'y', c: 'z' }, ['a', 'c']), { a: 'x', c: 'z' });
assert.deepStrictEqual(C.pruneCrew(null as never, ['a']), {});
assert.deepStrictEqual(C.pruneCrew({ a: 'x' }, []), {}, 'nobody left: empty');

// ---- load: caps and unknown ids ----
assert.deepStrictEqual(C.loadCrew('{"s1":"a","s2":"nope","s3":7,"":"a"}', ids), { s1: 'a' }, 'unknown characters, bad values and empty ids are dropped');
assert.deepStrictEqual(C.loadCrew('not json', ids), {}, 'corrupt JSON');
assert.deepStrictEqual(C.loadCrew('[1,2]', ids), {}, 'an array');
assert.deepStrictEqual(C.loadCrew(null, ids), {}, 'null');
assert.deepStrictEqual(C.loadCrew({ s1: 'a' }, ids), { s1: 'a' }, 'an object is accepted too');
assert.deepStrictEqual(C.loadCrew({ ['x'.repeat(201)]: 'a', ['y'.repeat(200)]: 'b' }, ids), { ['y'.repeat(200)]: 'b' }, 'ids up to 200 characters');
{
  const big: Record<string, string> = {};
  for (let i = 0; i < 700; i++) big['s' + i] = 'a';
  assert.strictEqual(Object.keys(C.loadCrew(big, ids)).length, 500, 'at most 500 entries');
}
assert.deepStrictEqual(C.loadCrew('{"s1":"punk"}'), { s1: 'punk' }, 'without a list: the built-in characters');
// a round trip of what the page saves
{
  const m = C.assignCrew({}, ['s1', 's2', 's3'], C.IDS, (id) => C.seededRand(id));
  assert.deepStrictEqual(C.loadCrew(JSON.stringify(m), C.IDS), m, 'save and load give the same map');
  assert.deepStrictEqual(C.pruneCrew(m, ['s2']), { s2: m.s2 }, 'prune keeps the id of a live session');
}
console.log('crew tests passed');

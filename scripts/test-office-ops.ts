/**
 * Unit test (spec 097 FR-186, T142): the judge of `check-office-ops.js` fails where it must and passes where it must. A check that cannot fail asserts nothing
 * (the first version compared `value > LIMITS[key] || LIMITS[row]` and never failed a row whose limit was 0). No Electron is started.
 */
import * as assert from 'assert';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const R = require(path.join(ROOT, 'scripts', 'office-ops-rules.js')) as {
  LIMITS: Record<string, number>; MINIMUMS: Record<string, number>; KNOWN_FAILURES: Record<string, { task: string; max: number }>;
  judge: (rows: Record<string, number>, limits?: Record<string, number>, known?: Record<string, { task: string; max: number }>, minimums?: Record<string, number>) => { failed: string[]; notes: string[] };
};
const L = { a: 50, z: 0, 'a@40': 100, w: 3 }, M = { m: 2 }, K = { 'w@15': { task: 'T9', max: 13 } };
const j = (rows: Record<string, number>) => R.judge(rows, L, K, M);

// passes
assert.deepStrictEqual(j({ 'a@15': 16, 'z@15': 0, 'a@40': 99 }).failed, [], 'values within their limits pass (also a per-agents override)');
// fails: over a limit, also a limit of 0, and an override tighter or looser than the row
assert.strictEqual(j({ 'a@15': 51 }).failed.length, 1, 'over the limit fails');
assert.strictEqual(j({ 'z@15': 1 }).failed.length, 1, 'a limit of 0 fails at 1 (the first version never did)');
assert.strictEqual(j({ 'a@40': 101 }).failed.length, 1, 'the override applies at 40');
assert.strictEqual(j({ 'a@40': 60 }).failed.length, 0, 'the row limit of 50 does not apply where an override of 100 does');
// a row that asserts nothing, and a value that is not a count
assert.strictEqual(j({ 'q@15': 1 }).failed.length, 1, 'a row with no limit and no minimum fails');
assert.strictEqual(j({ 'a@15': NaN }).failed.length, 1, 'NaN fails');
// minimums
assert.strictEqual(j({ 'm@15': 1 }).failed.length, 1, 'under a minimum fails');
assert.strictEqual(j({ 'm@15': 2 }).failed.length, 0, 'at the minimum passes');
// known failures: tolerated up to their max, failing over it, and flagged when no longer needed
assert.deepStrictEqual(j({ 'w@15': 13 }).failed, [], 'a known failure within its max passes, with a note');
assert.strictEqual(j({ 'w@15': 13 }).notes.length, 1, 'and says so');
assert.strictEqual(j({ 'w@15': 14 }).failed.length, 1, 'a known failure over its max fails');
assert.strictEqual(j({ 'w@15': 3 }).failed.length, 1, 'a known failure within its limit must lose its entry');

// the real tables: every limit row is sane and a mutant (the halo's 13 animations) fails today's table unless it is the named known failure
for (const [k, v] of Object.entries(R.LIMITS)) assert.ok(Number.isInteger(v) && v >= 0, `limit ${k} is a count`);
assert.ok(R.judge({ 'animatedOtherProperties@15': 14 }).failed.length === 1, 'one more animation of another property than the known 13 fails');
assert.ok(R.judge({ 'animatedOtherProperties@15': 13 }).failed.length === 0, 'the 13 halos are the known failure');
assert.ok(R.judge({ 'searchesPerStatus@15': 1 }).failed.length === 1, 'a layout search per status change fails');
assert.ok(R.judge({ 'elementsRecalculated@15': 1401 }).failed.length === 1, 'the :has() rule (1401 elements) fails');
assert.ok(R.judge({ 'handPositions@15': 1 }).failed.length === 1, 'a hand that never moves fails');
console.log('test-office-ops: ok');

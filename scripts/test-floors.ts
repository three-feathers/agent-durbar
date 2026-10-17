/** Unit tests for floors (spec 033): `npm run test:floors`. */
import * as assert from 'assert';
import {
  GROUND,
  GROUND_NAME,
  MAX_FLOORS,
  createFloor,
  defaultFloors,
  deleteFloor,
  floorOf,
  nameError,
  newFloorId,
  onlyFloor,
  parseFloors,
  renameFloor,
  reorderFloors,
  setFloorOn,
} from '../src/shared/floors';
import type { FloorsDoc } from '../src/shared/floors';

const seq = (vals: number[]): (() => number) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};
const ok = (r: { ok: boolean; doc: FloorsDoc }): FloorsDoc => {
  assert.ok(r.ok, JSON.stringify(r));
  return r.doc;
};

// ---- parse: damaged input always gives a usable doc with the ground floor first and on ----
for (const bad of [undefined, null, 5, 'x', {}, [null, 'x', 5]]) {
  assert.deepStrictEqual(parseFloors(bad), defaultFloors(), `parse ${JSON.stringify(bad)}`);
}
const parsed = parseFloors(
  [
    { id: 'f-aaaaaaaa', name: ' Client A ', on: false },
    { id: 'f-aaaaaaaa', name: 'dup id' },
    { id: '__proto__', name: 'proto' },
    { id: 'f-BAD', name: 'bad id' },
    { id: 'f-bbbbbbbb', name: 'client a' }, // same name, other case
    { id: 'f-cccccccc', name: '' },
    { id: 'f-dddddddd', name: 'x'.repeat(41) },
    { id: 'f-eeeeeeee', name: 'Bad\u0007name' },
    { id: GROUND, name: 'Lobby level', on: false },
    { id: 'f-ffffffff', name: 'Personal' },
  ],
  'f-ffffffff',
);
assert.deepStrictEqual(parsed, {
  floors: [
    { id: 'f-aaaaaaaa', name: 'Client A', on: false },
    { id: GROUND, name: 'Lobby level', on: false },
    { id: 'f-ffffffff', name: 'Personal', on: true },
  ],
  lastFloor: 'f-ffffffff',
}, 'the ground floor keeps its saved position');
assert.strictEqual(parseFloors([], 'f-zzzzzzzz').lastFloor, GROUND, 'unknown lastFloor -> ground');
assert.strictEqual(parseFloors([{ id: GROUND, name: '' }]).floors[0].name, GROUND_NAME, 'ground keeps a name');
// ground missing and its default name taken by another floor
const noGround = parseFloors([{ id: 'f-aaaaaaaa', name: GROUND_NAME }]);
assert.strictEqual(noGround.floors[0].id, GROUND);
assert.strictEqual(noGround.floors[0].name, `${GROUND_NAME} 2`);
// cap
const many = Array.from({ length: 60 }, (_, i) => ({ id: 'f-' + String(i).padStart(8, '0'), name: 'F' + i }));
assert.strictEqual(parseFloors(many).floors.length, MAX_FLOORS);

// ---- names ----
const base = parseFloors([{ id: GROUND, name: 'Lobby level', on: false }, { id: 'f-aaaaaaaa', name: 'Client A', on: false }, { id: 'f-ffffffff', name: 'Personal' }], 'f-ffffffff');
assert.strictEqual(nameError('', base), 'Name is empty.');
assert.strictEqual(nameError('   ', base), 'Name is empty.');
assert.strictEqual(nameError(5, base), 'Name is empty.');
assert.ok(nameError('x'.repeat(41), base).startsWith('Use 1 to 40'));
assert.ok(nameError('a\u0000b', base).startsWith('Use 1 to 40'));
assert.strictEqual(nameError('client A', base), 'A floor with that name exists.');
assert.strictEqual(nameError('Client A', base, 'f-aaaaaaaa'), '', 'a floor may keep its own name');
assert.strictEqual(nameError('x'.repeat(40), base), '');

// ---- create ----
const c = createFloor(base, '  Side project ', seq([0.5]));
assert.ok(c.ok && c.id && /^f-[a-z0-9]{8}$/.test(c.id));
assert.deepStrictEqual(c.doc.floors[3], { id: c.id, name: 'Side project', on: true });
assert.strictEqual(base.floors.length, 3, 'input not changed');
assert.ok(!createFloor(base, 'personal').ok);
const full = parseFloors(many);
const r41 = createFloor(full, 'One more');
assert.ok(!r41.ok && r41.error === 'At most 40 floors.');
// id generator skips ids in use
assert.notStrictEqual(newFloorId({ floors: [{ id: 'f-aaaaaaaa', name: 'a', on: true }], lastFloor: GROUND }, seq([0, 0, 0, 0, 0, 0, 0, 0, 0.99])), 'f-aaaaaaaa');

// ---- rename ----
const rn = ok(renameFloor(base, 'f-aaaaaaaa', 'Client B'));
assert.strictEqual(rn.floors[1].name, 'Client B');
assert.ok(ok(renameFloor(base, GROUND, 'Main')).floors[0].name === 'Main', 'ground can be renamed');
assert.ok(!renameFloor(base, 'f-aaaaaaaa', 'PERSONAL').ok);
assert.ok(!renameFloor(base, 'nope', 'X').ok);

// ---- reorder ----
const ro = ok(reorderFloors(base, ['f-ffffffff', GROUND, 'f-aaaaaaaa']));
assert.deepStrictEqual(ro.floors.map((f) => f.id), ['f-ffffffff', GROUND, 'f-aaaaaaaa']);
assert.ok(!reorderFloors(base, [GROUND, 'f-aaaaaaaa']).ok, 'missing one');
assert.ok(!reorderFloors(base, [GROUND, GROUND, 'f-aaaaaaaa']).ok, 'duplicate');
assert.ok(!reorderFloors(base, [GROUND, 'f-aaaaaaaa', 'f-zzzzzzzz']).ok, 'unknown');
assert.ok(!reorderFloors(base, 'x').ok);

// ---- delete ----
assert.ok(!deleteFloor(base, GROUND).ok, 'ground cannot be deleted');
assert.ok(!deleteFloor(base, 'nope').ok);
const del = ok(deleteFloor(base, 'f-ffffffff'));
assert.deepStrictEqual(del.floors.map((f) => f.id), [GROUND, 'f-aaaaaaaa']);
assert.strictEqual(del.lastFloor, GROUND, 'lastFloor pointed at the deleted floor');

// ---- on/off and Only ----
const off = ok(setFloorOn(base, 'f-ffffffff', false));
assert.strictEqual(off.floors[2].on, false);
assert.strictEqual(ok(setFloorOn(off, 'f-ffffffff', true)).floors[2].on, true);
assert.ok(!setFloorOn(base, 'nope', true).ok);
const only = ok(onlyFloor(base, 'f-aaaaaaaa'));
assert.deepStrictEqual(only.floors.map((f) => f.on), [false, true, false]);
assert.strictEqual(only.floors.filter((f) => f.on).length, 1);
assert.ok(!onlyFloor(base, 'nope').ok);

// ---- floorOf ----
assert.strictEqual(floorOf('f-aaaaaaaa', base), 'f-aaaaaaaa');
assert.strictEqual(floorOf('f-zzzzzzzz', base), GROUND);
assert.strictEqual(floorOf(undefined, base), GROUND);
assert.strictEqual(floorOf('__proto__', base), GROUND);

console.log('floors tests passed');

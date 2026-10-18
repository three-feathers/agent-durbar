/** Unit tests for floors (spec 033): `npm run test:floors`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
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
import type { DurbarApi } from '../src/shared/api';

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
// FR-003 (2026-10-18, follow-up issue #167): C1 controls and hidden or layout-spoofing characters are refused; ZWNJ, ZWJ, LRM and RLM are real text.
// Everything is written with escapes: this file must not contain the characters themselves (checked below).
const REFUSED = [0x85, 0x9f, 0xad, 0x34f, 0x115f, 0x180e, 0x200b, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x2066, 0x2067, 0x2068, 0x2069, 0x3164, 0xfeff, 0xfff9, 0xfffa, 0xfffb].map((n) => String.fromCharCode(n));
const ALLOWED = ['क\u0943\u200dष्ण', 'می\u200cخواهم', '\u{1F469}\u200d\u{1F4BB} Dev', 'abc\u200e', 'abc\u200f', 'a\u200eb', 'a\u200fb', 'a\u200cb', 'a\u200db', 'Ünïcødé'];
for (const c of REFUSED) assert.ok(nameError('We' + c + 'b', base).startsWith('Use 1 to 40'), `refuses U+${c.charCodeAt(0).toString(16)}`); // in the middle: trim() already drops a BOM at the ends
for (const ok of ALLOWED) assert.strictEqual(nameError(ok, base), '', `keeps ${JSON.stringify(ok)}`);
assert.strictEqual(nameError('Web\u202e', base), nameError('Web\u202e', base), 'no lastIndex state between calls');
// a saved name loses its hidden characters and C1 controls; the floor (and so its folders) is kept
const hid = parseFloors([{ id: GROUND, name: 'Ground floor' }, { id: 'f-hidden01', name: '\u202eClient\u200b B' }]);
assert.deepStrictEqual(hid.floors.map((f) => f.name), ['Ground floor', 'Client B']);
for (const c of REFUSED) assert.deepStrictEqual(parseFloors([{ id: GROUND, name: 'Ground floor' }, { id: 'f-hidden03', name: 'a' + c + 'b' }]).floors.map((f) => f.name), ['Ground floor', 'ab'], `loads U+${c.charCodeAt(0).toString(16)} cleaned`);
assert.deepStrictEqual(parseFloors([{ id: GROUND, name: 'Ground floor' }, { id: 'f-hidden04', name: 'a\u0085b' }]).floors.map((f) => f.name), ['Ground floor', 'ab'], 'a saved C1 name keeps its floor');
assert.deepStrictEqual(parseFloors([{ id: GROUND, name: 'Ground floor' }, { id: 'f-hidden05', name: 'a\u0001b' }]).floors.map((f) => f.id), [GROUND], 'a C0 control in a saved name still drops the floor');
assert.deepStrictEqual(parseFloors([{ id: GROUND, name: 'Ground floor' }, { id: 'f-hidden02', name: '\u200b\u2060' }]).floors.map((f) => f.id), [GROUND], 'nothing left: dropped as before');
// no literal hidden or control character in the three files that carry the rule
const LITERAL = new RegExp('[\u0080-\u009f\u00ad\u034f\u115f\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2069\u3164\ufeff\ufff9-\ufffb]');
for (const f of ['src/shared/floors.ts', 'src/renderer/sim.ts', 'scripts/test-floors.ts']) {
  const lines = fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8').split('\n');
  lines.forEach((l, i) => assert.ok(!LITERAL.test(l), `${f}:${i + 1} contains a literal hidden character: write it as an escape`));
}

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

// The simulator bridge repeats the name rule (its bundle cannot import it): same samples through both, same verdict and message.
async function simChecks(): Promise<void> {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'sim.ts'), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
  const makeSim = (): DurbarApi => {
    const win: Record<string, unknown> = { setTimeout: () => 0, setInterval: () => 0, location: { search: '' } };
    new Function('window', js)(win);
    return (win.__durbarSim as { create(o: Record<string, unknown>): DurbarApi }).create({ n: 1, freeze: true });
  };
  const samples: unknown[] = [
    ...REFUSED.map((c) => 'We' + c + 'b'), ...ALLOWED, 'x'.repeat(40), 'x'.repeat(41), 'a\u0000b', 'a\nb', 'a\u007fb', 'a\u0085b', '   ', '', 5, null, 'Plain', '  Padded  ', '\u2028x', 'x\u2029',
  ];
  for (const sample of samples) {
    const shared = nameError(sample, defaultFloors());
    const r = await makeSim().createFloor!(sample as string);
    assert.strictEqual(r.ok ? '' : r.error, shared, `simulator and shared rule agree on ${JSON.stringify(sample)}`);
  }
}
simChecks().then(
  () => console.log('floors tests passed'),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);

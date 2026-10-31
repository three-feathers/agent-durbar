/** Cheeky crew (spec 077): the pure pick and storage rules of src/renderer/crew.js. `npm run test:crew`. No DOM, no credits. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const C = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'crew.js')) as {
  IDS: string[]; PREHISTORIC_IDS: string[]; ALL_IDS: string[]; CREWS: Record<string, string[]>; idsFor: (c: unknown) => string[]; storeKey: (c: unknown) => string; MAX_ENTRIES: number; MAX_ID: number;
  seeded: (s: string) => () => number;
  seededRand: (s: string) => number;
  pickCharacter: (id: string, ids: string[], inUse: string[], rand?: (id: string) => number) => string;
  assignCrew: (m: Record<string, string>, ids: string[], chars: string[], rand?: (id: string) => number) => Record<string, string>;
  pruneCrew: (m: Record<string, string>, ids: string[]) => Record<string, string>;
  loadCrew: (j: unknown, ids?: string[]) => Record<string, string>;
  POSES: string[]; BOX: { x: number; y: number; w: number; h: number }; PX_PER_UNIT: number; FACE: Record<string, Record<string, number[]>>; FACE_W: number; FACE_H: number; faceBox: (id: string, pose: string) => number[] | null; viewBox: (id: string, pose: string, use?: string) => string | null;
  registerOwn: (l: unknown) => string[]; ownName: (id: string) => string; ownRev: (id: string) => string; folderKey: (p: string, platform: string) => string; pinKey: (i: unknown, platform: string) => string | null; pinCrew: (m: Record<string, string>, s: { id: string; key: string }[], pins: Record<string, string>, ids: string[], bad?: Set<string>) => Record<string, string>; viewBoxAt: (f: number[], use?: string) => string;
  poseFor: (st: string) => string; file: (id: string, pose: string) => string; files: (ids?: string[]) => string[]; usable: (id: unknown, bad?: Set<string>) => boolean;
};

const ids = ['a', 'b', 'c', 'd'];
assert.deepStrictEqual(C.IDS, ['punk', 'gamer', 'hacker', 'rocker', 'buzzcut', 'bookworm', 'scientist', 'metalhead', 'bob-glasses', 'skater', 'surfer', 'disco', 'sporty'], 'the 13 characters (FR-059)');
assert.ok(C.IDS.every((i) => /^[a-z]+(-[a-z]+)?$/.test(i)), 'ids are file-name safe');
// FR-072 (issue #815): the Prehistoric crew is another list; Cheeky's ids, order and key do not change
assert.deepStrictEqual(C.PREHISTORIC_IDS, ['youngbeard', 'braids', 'bigbeard', 'ponytail', 'inventor', 'shaman'], 'the 6 Prehistoric characters');
assert.deepStrictEqual(C.ALL_IDS, [...C.IDS, ...C.PREHISTORIC_IDS]);
assert.strictEqual(new Set(C.ALL_IDS).size, C.ALL_IDS.length, 'an id is in one crew only, so one saved map can never confuse two crews');
assert.ok(C.PREHISTORIC_IDS.every((i) => /^[a-z]+$/.test(i)), 'Prehistoric ids are file-name safe');
assert.deepStrictEqual(C.idsFor('cheeky'), C.IDS);
assert.deepStrictEqual(C.idsFor('prehistoric'), C.PREHISTORIC_IDS);
for (const v of ['theme', 'minimalist', 'nope', undefined, null, '__proto__', 'constructor', 'toString']) assert.deepStrictEqual(C.idsFor(v), C.IDS, 'any other value: the Cheeky crew, as before (' + String(v) + ')');
assert.strictEqual(C.storeKey('cheeky'), 'durbar.crew', "Cheeky's saved choices keep their key");
assert.strictEqual(C.storeKey('theme'), 'durbar.crew');
assert.strictEqual(C.storeKey('prehistoric'), 'durbar.crew.prehistoric', 'each crew has its own saved map');
assert.deepStrictEqual(C.loadCrew({ s1: 'braids', s2: 'punk' }, C.PREHISTORIC_IDS), { s1: 'braids' }, "a Prehistoric load drops Cheeky's ids");
assert.deepStrictEqual(C.loadCrew({ s1: 'braids', s2: 'punk' }), { s2: 'punk' }, "a Cheeky load (the default list) drops Prehistoric's ids");
{
  const six = Array.from({ length: 6 }, (_, i) => 's' + i);
  assert.strictEqual(new Set(Object.values(C.assignCrew({}, six, C.PREHISTORIC_IDS, (id) => C.seededRand(id)))).size, 6, 'six sessions wear the six Prehistoric characters, no twin');
}

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
// PR 621 review (FR-020, FR-023): app.js hands pickCharacter the main sessions' characters AND the live helpers' ones; with a main on a and its helper on b, a new main must not take b while c and d are unused
assert.strictEqual(C.pickCharacter('n', ids, ['a'].concat(['b']), () => 0), 'c', 'a helper counts as in use: the next main takes an unused character, not the helper\'s');
assert.strictEqual(C.pickCharacter('n', ids, ['a'], () => 0), 'b', 'without the helper in the list b would be a candidate (the mutant this guards: only the main map counted)');
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
// ---- portraits: the pose for a status, the file names, and when a character can be drawn (FR-055) ----
assert.deepStrictEqual(C.POSES, ['working', 'waiting', 'resting']);
const POSE: Record<string, string> = { working: 'working', thinking: 'working', avatar: 'working', waiting: 'waiting', error: 'waiting', done: 'resting', idle: 'resting' };
for (const [st, pose] of Object.entries(POSE)) assert.strictEqual(C.poseFor(st), pose, st + ' shows the ' + pose + ' pose');
assert.strictEqual(C.poseFor('whatever'), 'resting', 'an unknown status rests');
assert.strictEqual(C.file('punk', 'working'), 'crew/art/punk-working.webp');
assert.strictEqual(C.file('bob-glasses', 'resting'), 'crew/art/bob-glasses-resting.webp');
assert.strictEqual(C.files().length, C.IDS.length * 3, 'three pictures per character');
assert.strictEqual(C.file('braids', 'working'), 'crew/art/prehistoric-braids-working.webp', 'a Prehistoric picture has its own prefix: no clash with a Cheeky name');
assert.strictEqual(C.files(C.PREHISTORIC_IDS).length, 18, '6 characters x 3 poses');
assert.ok(C.files(C.PREHISTORIC_IDS).every((f) => /^crew\/art\/prehistoric-[a-z]+-(working|waiting|resting)\.webp$/.test(f)));
assert.ok(C.files(C.PREHISTORIC_IDS).every((f) => !C.files().includes(f)), 'no file name is in both crews');
assert.ok(C.usable('shaman') && C.usable('punk'), 'a character of either crew can be drawn');
assert.ok(C.files(['punk']).every((f) => f.startsWith('crew/art/punk-')));
assert.ok(C.usable('punk') && C.usable('punk', new Set(['gamer'])), 'a known character with no failed picture');
assert.ok(!C.usable('punk', new Set(['punk'])), 'a character with a failed picture is not usable');
assert.ok(!C.usable('nope') && !C.usable('') && !C.usable(undefined) && !C.usable('__proto__') && !C.usable('constructor'), 'unknown ids are not usable');
// FR-014 / FR-060: the portrait box is 88x88 at x 24, y 22 (twice the first build's); it ends where the monitor's frame starts (x 112), so the screen's colour is never under it
assert.deepStrictEqual(C.BOX, { x: 24, y: 22, w: 88, h: 88 }, 'the desk portrait box');
assert.strictEqual(C.BOX.w, C.BOX.h, 'the box is square, like the 352x352 art (FR-059)');
assert.ok(C.BOX.x + C.BOX.w <= 112, 'the box ends before the monitor');
assert.strictEqual(C.BOX.w * C.PX_PER_UNIT, 352, 'the art is 4 pixels per stage unit');
// FR-060: every picture has a face point, and its face box is inside the picture, clear of the monitor and the badge corner and above the desk top (y 86)
for (const id of C.ALL_IDS) for (const pose of C.POSES) {
  const b = C.faceBox(id, pose);
  assert.ok(b, id + '-' + pose + ' has a face box');
  const [x, y, w, h] = b as number[];
  assert.ok(x >= C.BOX.x && x + w <= C.BOX.x + C.BOX.w && y >= C.BOX.y && y + h <= C.BOX.y + C.BOX.h, id + '-' + pose + ': the face is inside its picture');
  assert.ok(x + w <= 112, id + '-' + pose + ': the face is left of the monitor');
  assert.ok(y >= 34, id + '-' + pose + ': the face is under the thought bubble and badge corner');
  assert.ok(y + h <= 86, id + '-' + pose + ': the chin is above the desk top, which hides the lower bust');
  const vb = (C.viewBox(id, pose, 'face') as string).split(' ').map(Number);
  assert.ok(vb[0] >= C.BOX.x && vb[1] >= C.BOX.y && vb[0] + vb[2] <= C.BOX.x + C.BOX.w && vb[1] + vb[3] <= C.BOX.y + C.BOX.h, id + '-' + pose + ': the avatar crop is inside the picture');
  assert.ok(vb[0] + vb[2] / 2 > x && vb[0] + vb[2] / 2 < x + w, id + '-' + pose + ': the avatar crop is centred on the face');
}
for (const id of C.ALL_IDS) for (const pose of C.POSES) {
  const sv = (C.viewBox(id, pose, 'seat') as string).split(' ').map(Number), [fx, fy, fw, fh] = C.faceBox(id, pose) as number[];
  assert.ok(sv[1] === C.BOX.y && sv[0] + sv[2] <= C.BOX.x + C.BOX.w, id + '-' + pose + ': a seat shows the picture from its top edge, not past its right edge');
  assert.ok(fx >= sv[0] && fx + fw <= sv[0] + sv[2] && fy + fh <= sv[1] + sv[3], id + '-' + pose + ': the whole face box is in the seat crop');
}
assert.strictEqual(C.viewBox('nope', 'working', 'face'), null, 'an unknown character has no crop');
assert.deepStrictEqual(Object.keys(C.FACE).sort(), [...C.ALL_IDS].sort(), 'a face table row per character, of every crew');
// a stored id that no longer exists (an old placeholder-only id) is dropped, and the session gets a new character
{
  const stored = C.loadCrew({ s1: 'nerd', s2: 'surfer', s3: 'metal' });
  assert.deepStrictEqual(stored, { s2: 'surfer' }, 'unknown stored ids are dropped, known ones kept');
  const again = C.assignCrew(stored, ['s1', 's2', 's3'], C.IDS, () => 0);
  assert.strictEqual(again.s2, 'surfer');
  assert.ok(C.IDS.includes(again.s1) && C.IDS.includes(again.s3) && again.s1 !== 'surfer' && again.s3 !== 'surfer', 'the dropped sessions get known, unused characters');
}
// thirteen sessions: every character once, no twin
{
  const ss = Array.from({ length: 13 }, (_, i) => 's' + i);
  const m = C.assignCrew({}, ss, C.IDS, (id) => C.seededRand(id));
  assert.strictEqual(new Set(Object.values(m)).size, 13, 'thirteen sessions wear thirteen different characters');
}

// ---- spec 077 FR-073 (issue #879): the simulator gives each demo name a fitting character; real sessions are untouched ----
{
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const S = require(path.join(__dirname, '..', '..', 'src', 'renderer', 'simcrew.js')) as {
    NAMES: Record<string, string[]>; CREW_KEYS: string[]; keyFor: (c: unknown) => string;
    characterFor: (c: unknown, name: unknown, ids?: string[]) => string; seed: (c: unknown, agents: unknown[], ids?: string[]) => Record<string, string>;
  };
  const root = path.join(__dirname, '..', '..');
  const simTs = fs.readFileSync(path.join(root, 'src', 'renderer', 'sim.ts'), 'utf8');
  const roster = simTs.slice(simTs.indexOf('const ROSTER: Row[] = ['), simTs.indexOf('// Spec 052 FR-046: each waiting agent'));
  const demoNames = [...roster.matchAll(/^\s*\['([A-Z][a-z]+)', '/gm)].map((m) => m[1]);
  assert.ok(demoNames.length >= 15 && demoNames.includes('Ada') && demoNames.includes('Hugo'), 'found the simulator roster: ' + demoNames.join(','));
  assert.deepStrictEqual(S.CREW_KEYS, Object.keys(C.CREWS), 'one column per crew, in the crews\' order');
  for (const choice of Object.keys(C.CREWS)) {
    const ids = C.idsFor(choice), used = new Set<string>();
    for (const n of demoNames) {
      const c = S.characterFor(choice, n, ids);
      assert.ok(ids.includes(c), n + ' has a character of the ' + choice + ' crew, got "' + c + '"');
      used.add(c);
    }
    assert.strictEqual(used.size, ids.length, 'every ' + choice + ' character is worn by some demo name');
  }
  assert.deepStrictEqual([S.NAMES.Ada, S.NAMES.Hugo], [['gamer', 'braids'], ['bookworm', 'inventor']], 'the anchors the driver checks: Ada a woman\'s character, Hugo a man\'s');
  assert.deepStrictEqual(Object.keys(S.NAMES).sort(), [...demoNames].sort(), 'the table has a row for every demo name and no other');
  // the table never uses a character from another crew, and the theme\'s own / an unknown value draw the Cheeky crew like crew.js
  assert.strictEqual(S.keyFor('theme'), 'cheeky'); assert.strictEqual(S.keyFor('prehistoric'), 'prehistoric');
  assert.strictEqual(S.characterFor('cheeky', 'Ada', C.PREHISTORIC_IDS), '', 'an id that is not in the crew is refused');
  assert.strictEqual(S.characterFor('cheeky', 'Task: fix the build'), '', 'a name without a row (a real session) gets nothing');
  assert.strictEqual(S.characterFor('cheeky', '__proto__'), '', 'only own rows count');
  // seed: main agents only, by the agent\'s own name
  const agents = [{ id: 'sim-1', baseName: 'Ada', name: 'a very long alias' }, { id: 'sim-2', name: 'Hugo' }, { id: 'h1', parent: 'sim-1', name: 'Ada' }, { id: 'r1', name: 'Fix the build' }];
  assert.deepStrictEqual(S.seed('cheeky', agents, C.IDS), { 'sim-1': S.NAMES.Ada[0], 'sim-2': S.NAMES.Hugo[0] }, 'helpers and unknown names are not seeded');
  assert.deepStrictEqual(S.seed('prehistoric', agents, C.PREHISTORIC_IDS), { 'sim-1': S.NAMES.Ada[1], 'sim-2': S.NAMES.Hugo[1] });
  assert.deepStrictEqual(S.seed('cheeky', [], C.IDS), {});
  // and the seeded map goes through the same assignCrew as before: the unseeded sessions get a random character, the seeded keep theirs
  const m = C.assignCrew(S.seed('cheeky', agents, C.IDS), ['sim-1', 'sim-2', 'r1'], C.IDS, (id) => C.seededRand(id));
  assert.strictEqual(m['sim-1'], S.NAMES.Ada[0]); assert.ok(C.IDS.includes(m.r1));
  // the real-session path is untouched: the table is read only in app.js's syncCrew, only under SIM, and crew.js does not know it
  const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
  const uses = app.split('\n').filter((l) => l.includes('DurbarSimCrew'));
  assert.strictEqual(uses.length, 1, 'app.js reads the table in one place');
  assert.ok(/SIM&&window\.DurbarSimCrew\?window\.DurbarSimCrew\.seed\(/.test(uses[0]), 'and only when SIM is on');
  assert.ok(!/simcrew|DurbarSimCrew/i.test(fs.readFileSync(path.join(root, 'src', 'renderer', 'crew.js'), 'utf8')), 'crew.js does not know the table');
}

// ---- spec 096 FR-043, FR-044: My characters registered with the crew, and pins in the pick ----
{
  const A = 'my-aaaaaaaaaaaa', B = 'my-bbbbbbbbbbbb', D = 'my-dddddddddddd';
  const face = { working: [176, 150], waiting: [170, 150], resting: [176, 140] };
  const urls = (id: string): Record<string, string> => ({ working: `blob:file:///${id}-w`, waiting: `blob:file:///${id}-t`, resting: `blob:file:///${id}-r`, blink: `blob:file:///${id}-b` });
  const own = (id: string, name = id): Record<string, unknown> => ({ id, name, face, urls: urls(id) });
  assert.deepStrictEqual(C.idsFor('mine'), [], 'nothing registered: no characters, never the Cheeky crew under another name');
  assert.strictEqual(C.storeKey('mine'), 'durbar.crew.mine', 'its own saved map');
  assert.strictEqual(C.usable(A), false);
  assert.deepStrictEqual(C.registerOwn([own(A, 'Greta'), own(B)]), [A, B], 'the list, in its order (newest first)');
  assert.deepStrictEqual(C.idsFor('mine'), [A, B]);
  assert.deepStrictEqual(C.idsFor('cheeky'), C.IDS, 'the crews do not change');
  assert.ok(C.usable(A) && !C.usable(A, new Set([A])), 'usable, and a bad picture still marks it (FR-055)');
  assert.strictEqual(C.file(A, 'waiting'), urls(A).waiting, 'its picture is the URL');
  assert.strictEqual(C.ownName(A), 'Greta');
  assert.strictEqual(C.ownName('punk'), '', 'a built-in character has no name here');
  assert.ok(C.faceBox(A, 'waiting'), 'a face box from its own points');
  const vb = C.viewBox(A, 'waiting');
  assert.ok(vb && vb === C.viewBoxAt([170, 150]) && vb !== C.viewBox(A, 'working'), 'the crop follows the pose\'s face point');
  // what reaches scene markup is checked: nothing here may hold a quote or markup
  const BAD: unknown[] = [
    null, 'x', { id: A }, { ...own(D), id: '../my-dddddddddddd' }, { ...own(D), id: 'my-DDDDDDDDDDDD' }, { ...own(D), id: 'punk' }, { ...own(D), id: '__proto__' },
    { ...own(D), urls: { ...urls(D), working: 'x" onload="alert(1)' } }, { ...own(D), urls: { ...urls(D), waiting: 'https://example.com/a.webp' } }, { ...own(D), urls: { ...urls(D), resting: 'data:image/svg+xml,<svg/>' } },
    { ...own(D), urls: { ...urls(D), working: 'blob:x" onload="alert(1)' } }, { ...own(D), urls: { ...urls(D), waiting: "blob:x' onload='alert(1)" } }, { ...own(D), urls: { ...urls(D), resting: 'blob:x><script>' } }, { ...own(D), urls: { ...urls(D), working: 'blob:x y' } }, { ...own(D), urls: { ...urls(D), working: 'blob:' } }, { ...own(D), urls: { ...urls(D), working: 'blob:x&amp;y' } }, { ...own(D), urls: { ...urls(D), working: 'xblob:file:///a' } },
    { ...own(D), urls: { working: urls(D).working } }, { ...own(D), face: { ...face, working: [176, NaN] } }, { ...own(D), face: { ...face, waiting: [176, 'x'] } }, { ...own(D), face: { ...face, resting: [176, 9999] } },
  ];
  for (const b of BAD) assert.deepStrictEqual(C.registerOwn([b]), [], `refused: ${JSON.stringify(b)}`);
  assert.deepStrictEqual(C.registerOwn('nope'), [], 'not a list');
  C.registerOwn([{ ...own(D), name: '<img src=x>', urls: { ...urls(D), blink: 'javascript:alert(1)' } }]);
  assert.strictEqual(C.file(D, 'blink' as string), undefined, 'a bad blink URL is left out, the character stays');
  // a new URL is a new signature; a second registration with the same URLs is not
  C.registerOwn([own(A)]);
  const rev = C.ownRev(A);
  assert.ok(/^@\d+$/.test(rev));
  C.registerOwn([own(A, 'renamed')]);
  assert.strictEqual(C.ownRev(A), rev, 'a rename keeps the pictures, so the scene stays');
  assert.strictEqual(C.ownName(A), 'renamed');
  C.registerOwn([{ ...own(A), urls: { ...urls(A), working: 'blob:file:///new' } }]);
  assert.notStrictEqual(C.ownRev(A), rev, 'new URLs: the scene is drawn again');
  assert.strictEqual(C.ownRev('punk'), '', 'no change for the built-in crews');
  // US2 scenario 2: a stored map naming a deleted character: the entry goes, the session gets a new pick
  C.registerOwn([own(A), own(B)]);
  assert.deepStrictEqual(C.loadCrew({ s1: A, s2: D, s3: 'punk' }, C.idsFor('mine')), { s1: A }, 'unknown ids dropped by loadCrew');
  // least used with registered ids
  assert.strictEqual(C.pickCharacter('n', C.idsFor('mine'), [A, A, B], () => 0), B, 'least used among the registered');
  assert.strictEqual(new Set(Object.values(C.assignCrew({}, ['s1', 's2'], C.idsFor('mine'), (id) => C.seededRand(id)))).size, 2, 'no twin while one is free');
  // folder keys are the same as main's
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { normaliseFolderKey } = require(path.join(__dirname, '..', 'src', 'shared', 'usagedoc.js')) as { normaliseFolderKey: (p: string, platform: string) => string };
  for (const plat of ['win32', 'darwin', 'linux']) for (const p of ['/a/b', '/a/b/', '/a/b//', '/', '', ' /a/x ', 'C:\\Work\\App\\', 'c:/work/app', 'C:\\', '\\\\srv\\share\\', '~/x/', '/A/B\\']) assert.strictEqual(C.folderKey(p, plat), normaliseFolderKey(p, plat), `${plat} ${p}`);
  // a session with no folder has no key: a pin on `/` must not dress it
  for (const info of [undefined, null, {}, { cwd: '' }, { cwd: '   ' }, { cwd: 3 }]) assert.strictEqual(C.pinKey(info, 'darwin'), null, `no folder: ${JSON.stringify(info)}`);
  assert.strictEqual(C.pinKey({ cwd: '/a/b/' }, 'darwin'), '/a/b');
  assert.strictEqual(C.pinKey({ cwd: '/' }, 'darwin'), '/', 'a session really in `/` has that key');
  assert.strictEqual(C.pinKey({ cwd: '/a', workspaceFile: '/w/x.code-workspace' }, 'darwin'), '/w/x.code-workspace', 'the workspace file first, as folderKeyOf');
  assert.deepStrictEqual(C.pinCrew({}, [{ id: 's', key: null as unknown as string }], { '/': C.idsFor('mine')[0] }, C.idsFor('mine')), {}, 'and it is not dressed');
  // FR-044: pinned first, counted as in use by the others
  const ids = C.idsFor('mine');
  const sess = [{ id: 's1', key: '/a' }, { id: 's2', key: '/a' }, { id: 's3', key: '/b' }];
  const pinned = C.pinCrew({}, sess, { '/a': B }, ids);
  assert.deepStrictEqual(pinned, { s1: B, s2: B }, 'both sessions of the folder, the other left to the pick');
  const picked = C.assignCrew(pinned, ['s1', 's2', 's3'], ids, () => 0);
  assert.deepStrictEqual(picked, { s1: B, s2: B, s3: A }, 'the pinned one counts as in use, so the other session gets the free one (with the pick first, s3 would get A too only by chance: rand 0 is the first of the pool)');
  const order = C.assignCrew(C.pinCrew({}, sess, { '/a': A }, ids), ['s1', 's2', 's3'], ids, () => 0);
  assert.deepStrictEqual(order, { s1: A, s2: A, s3: B }, 'pin order: a pin on the first character leaves the second to the others; assigning before pinning would give s3 the pinned one');
  assert.deepStrictEqual(C.pinCrew({ s1: A }, sess, { '/a': B }, ids), { s1: B, s2: B }, 'a pin beats the random pick already kept');
  assert.deepStrictEqual(C.pinCrew({ s3: A }, sess, {}, ids), { s3: A }, 'no pin: the kept pick stays');
  assert.deepStrictEqual(C.pinCrew({ s1: 'punk' }, sess, { '/a': B }, C.IDS), { s1: B, s2: B }, 'a pin to a generated character also applies under a crew');
  assert.deepStrictEqual(C.pinCrew({ s1: B }, sess, {}, C.IDS), {}, 'a pin taken away under a crew: its id is not in that list, so the session gets a new pick');
  assert.deepStrictEqual(C.pinCrew({ s1: D }, sess, { '/a': D }, ids), {}, 'a pin to a character that is gone is not worn, and a kept deleted id goes (US4 scenario 2)');
  assert.deepStrictEqual(C.pinCrew({}, sess, { '/a': B }, ids, new Set([B])), {}, 'a pinned character whose pictures failed is not worn (FR-055)');
  assert.deepStrictEqual(C.pinCrew({}, [{ id: 's', key: '/a' }], Object.create({ '/a': B }) as Record<string, string>, ids), {}, 'a key is looked up as own data only');
  assert.deepStrictEqual(C.pinCrew({}, [{ id: 's', key: 'toString' }], {}, ids), {}, 'and an inherited name is no pin');
  C.registerOwn([]);
  assert.deepStrictEqual(C.idsFor('mine'), [], 'an empty list clears them');
  assert.strictEqual(C.file(A, 'working'), 'crew/art/' + A + '-working.webp', 'and their URLs are gone (no reader: usable is false)');
  assert.strictEqual(C.usable(A), false);
}
console.log('crew tests passed');

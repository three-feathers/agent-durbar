/**
 * Rearranging rooms, desks and places (spec 033 delta 2026-11-01, issue #677): the pure rules of `src/renderer/reorder.js` (sort, move, step,
 * merge, the drag preview), the tolerant parse in `src/shared/roomorder.ts` (kept equal to the renderer's), the saved file (round trip, a
 * corrupt order, an older file) and the source checks that keep the drag to `transform` and `opacity` with one layout read.
 * `npm run test:roomorder`. No credits spent.
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FolderStore } from '../src/main/folders';
import { parseOrder, MAX_ORDER_ROOMS, MAX_ORDER_DESKS, MAX_ORDER_PLACES, MAX_ORDER_DESK_ROOMS } from '../src/shared/roomorder';

const ROOT = path.join(__dirname, '..', '..');
const R = require(path.join(ROOT, 'src', 'renderer', 'reorder.js')) as {
  sanitize(x: unknown): { rooms: string[]; desks: Record<string, string[]>; places: string[] };
  empty(): unknown;
  isEmpty(x: unknown): boolean;
  sortBy<T>(items: T[], key: (t: T) => string, order: unknown): T[];
  moveTo(l: string[], key: string, target: string, after?: boolean): string[];
  step(l: string[], key: string, d: number): { list: string[]; from: number; to: number } | null;
  merge(saved: unknown, group: string[], max?: number): string[];
  nearest(slots: { left: number; top: number; width: number; height: number }[], x: number, y: number): number;
  shiftFor(i: number, from: number, to: number, slots: { left: number; top: number }[]): { dx: number; dy: number } | null;
  announce(name: string, pos: number, n: number, where?: string): string;
};

// sortBy: listed first in the saved order, the rest after in their own order; unknown saved keys ignored; input untouched
const items = ['a', 'b', 'c', 'd', 'e'];
assert.deepStrictEqual(R.sortBy(items, (x) => x, ['d', 'zz', 'b']), ['d', 'b', 'a', 'c', 'e']);
assert.deepStrictEqual(R.sortBy(items, (x) => x, []), items);
assert.deepStrictEqual(R.sortBy(items, (x) => x, 'junk'), items);
assert.deepStrictEqual(items, ['a', 'b', 'c', 'd', 'e']);

// moveTo: before or after the target; no-ops for unknown keys
assert.deepStrictEqual(R.moveTo(items, 'a', 'c', false), ['b', 'a', 'c', 'd', 'e']);
assert.deepStrictEqual(R.moveTo(items, 'a', 'c', true), ['b', 'c', 'a', 'd', 'e']);
assert.deepStrictEqual(R.moveTo(items, 'e', 'b', false), ['a', 'e', 'b', 'c', 'd']);
assert.deepStrictEqual(R.moveTo(items, 'a', 'a', true), items);
assert.deepStrictEqual(R.moveTo(items, 'x', 'a', true), items);
assert.deepStrictEqual(R.moveTo(items, 'a', 'x', true), items);

// step: a swap with the neighbour; null at the ends
assert.deepStrictEqual(R.step(items, 'c', -1), { list: ['a', 'c', 'b', 'd', 'e'], from: 2, to: 1 });
assert.deepStrictEqual(R.step(items, 'c', 1)?.list, ['a', 'b', 'd', 'c', 'e']);
assert.strictEqual(R.step(items, 'a', -1), null);
assert.strictEqual(R.step(items, 'e', 1), null);
assert.strictEqual(R.step(items, 'q', 1), null);
assert.strictEqual(R.step(items, 'a', 2), null);

// merge: the group first, then saved keys outside it (other floors keep their relative order); capped
assert.deepStrictEqual(R.merge(['x', 'a', 'y', 'b'], ['b', 'a']), ['b', 'a', 'x', 'y']);
assert.deepStrictEqual(R.merge(undefined, ['b', 'a']), ['b', 'a']);
assert.strictEqual(R.merge(Array.from({ length: 300 }, (_, i) => 'k' + i), ['a'], 200).length, 200);

// drag preview: the slot nearest the pointer, and the shift of the items between
const slots = [0, 1, 2, 3].map((i) => ({ left: i * 100, top: 0, width: 90, height: 50 }));
assert.strictEqual(R.nearest(slots, 5, 5), 0);
assert.strictEqual(R.nearest(slots, 260, 20), 2);
assert.strictEqual(R.nearest(slots, 9999, 9999), 3);
assert.strictEqual(R.nearest([], 1, 1), -1);
assert.strictEqual(R.shiftFor(0, 0, 2, slots), null, 'the dragged item is moved by the pointer, not shifted');
assert.deepStrictEqual(R.shiftFor(1, 0, 2, slots), { dx: -100, dy: 0 });
assert.deepStrictEqual(R.shiftFor(2, 0, 2, slots), { dx: -100, dy: 0 });
assert.strictEqual(R.shiftFor(3, 0, 2, slots), null);
assert.deepStrictEqual(R.shiftFor(0, 2, 0, slots), { dx: 100, dy: 0 });
assert.deepStrictEqual(R.shiftFor(1, 2, 0, slots), { dx: 100, dy: 0 });
assert.strictEqual(R.shiftFor(3, 2, 0, slots), null);
assert.strictEqual(R.shiftFor(1, 1, 1, slots), null);
assert.strictEqual(R.announce('Ada', 2, 4, 'its room'), 'Ada moved to position 2 of 4 in its room.');

// sanitize (renderer) and parseOrder (main) agree on a corpus of good and bad documents, and neither throws
const huge = (n: number, p: string): string[] => Array.from({ length: n }, (_, i) => p + i);
const corpus: unknown[] = [
  undefined, null, 5, 'x', [], {}, { rooms: 'a' }, { rooms: [1, null, '', 'a', 'a', 'b', 'x'.repeat(2000)] },
  { desks: [] }, { desks: { r1: ['a', 'a', 7, 'b'], '': ['x'], r2: 'no', r3: [] } },
  { desks: JSON.parse('{"__proto__":["p"],"constructor":["c"],"ok":["a"]}') },
  { places: ['p1', 'p1', 3, 'p2'] },
  { rooms: huge(500, 'r'), places: huge(90, 'p'), desks: Object.fromEntries(huge(300, 'd').map((k) => [k, huge(150, 'a')])) },
  { rooms: ['/home/x'], desks: { '/home/x': ['s1', 's2'] }, places: ['mail'], extra: { more: 1 } },
];
for (const c of corpus) {
  const a = R.sanitize(c);
  const b = parseOrder(c);
  assert.deepStrictEqual(a, b, 'renderer and main clean alike: ' + JSON.stringify(c)?.slice(0, 80));
  assert.deepStrictEqual(R.sanitize(a), a, 'cleaning twice changes nothing');
  assert.strictEqual(Object.getPrototypeOf(a.desks), Object.prototype, 'desks stay plain data');
}
const big = parseOrder(corpus[12]);
assert.ok(big.rooms.length === MAX_ORDER_ROOMS && big.places.length === MAX_ORDER_PLACES && Object.keys(big.desks).length === MAX_ORDER_DESK_ROOMS);
assert.ok(Object.values(big.desks).every((l) => l.length === MAX_ORDER_DESKS));
assert.deepStrictEqual(parseOrder({ rooms: [1, 'a', 'a'] }).rooms, ['a']);
assert.ok(Object.keys(parseOrder(corpus[10]).desks).includes('__proto__'), '"__proto__" is only a key');
assert.ok(R.isEmpty(R.sanitize(null)) && !R.isEmpty(R.sanitize({ rooms: ['a'] })));

// the saved file: round trip with the floors, an older file without an order, a corrupt order, a file that is not JSON
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'durbar-roomorder-'));
try {
  const file = path.join(dir, 'folders.json');
  const abs = (p: string): string => path.resolve('/', p);
  const st = new FolderStore(file);
  st.load();
  st.upsert({ workspace: abs('a'), permMode: 'ask', model: 'auto' });
  st.upsert({ workspace: abs('b'), permMode: 'ask', model: 'auto' });
  assert.ok(!('order' in JSON.parse(fs.readFileSync(file, 'utf8'))), 'with no order saved the file has no order key');
  assert.deepStrictEqual(st.order(), { rooms: [], desks: {}, places: [] });
  const kept = st.setOrder({ rooms: [abs('b'), abs('a'), 7], desks: { [abs('a')]: ['s2', 's1'] }, places: ['mail'], bogus: 1 });
  assert.deepStrictEqual(kept, { rooms: [abs('b'), abs('a')], desks: { [abs('a')]: ['s2', 's1'] }, places: ['mail'] });
  const again = new FolderStore(file);
  again.load();
  assert.deepStrictEqual(again.order(), kept, 'the order survives a restart');
  assert.deepStrictEqual(again.list().map((f) => f.workspace), [abs('a'), abs('b')], 'the saved folder list itself is untouched');
  assert.strictEqual(again.floors().floors.length, 1, 'the floors are untouched');
  again.upsert({ workspace: abs('c'), permMode: 'ask', model: 'auto' });
  const third = new FolderStore(file);
  third.load();
  assert.deepStrictEqual(third.order(), kept, 'other saves keep the order');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  doc.order = 'corrupt';
  fs.writeFileSync(file, JSON.stringify(doc));
  const bad = new FolderStore(file);
  assert.strictEqual(bad.load().length, 3, 'a corrupt order does not cost the folders');
  assert.deepStrictEqual(bad.order(), { rooms: [], desks: {}, places: [] });
  delete doc.order;
  fs.writeFileSync(file, JSON.stringify(doc));
  const old = new FolderStore(file);
  old.load();
  assert.deepStrictEqual(old.order(), { rooms: [], desks: {}, places: [] }, 'a file from before this feature loads');
  fs.writeFileSync(file, '{not json');
  const junk = new FolderStore(file);
  assert.deepStrictEqual(junk.load(), []);
  assert.deepStrictEqual(junk.order(), { rooms: [], desks: {}, places: [] });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

// source checks: the page is wired to the rules, and a drag only moves transform and opacity
const read = (...p: string[]): string => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const reo = read('src', 'renderer', 'reorder.js');
const app = read('src', 'renderer', 'app.js');
const css = read('src', 'renderer', 'styles.css');
assert.strictEqual((reo.match(/getBoundingClientRect/g) || []).length, 1, 'layout is read once, when a drag starts');
assert.ok(/function begin[\s\S]*getBoundingClientRect[\s\S]*function move/.test(reo), 'that read is in begin(), not in move()');
const moveBody = reo.slice(reo.indexOf('function move('), reo.indexOf('function end('));
assert.ok(!/getBoundingClientRect|offset(Top|Left|Width|Height)|clientWidth|clientHeight|getComputedStyle/.test(moveBody), 'move() reads no layout');
assert.deepStrictEqual([...reo.matchAll(/\.style\.(\w+)\s*=/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i), ['transform'], 'a drag sets only style.transform');
const lift = /\.reo-lift\{([^}]*)\}/.exec(css)?.[1] ?? '';
assert.ok(!/(^|;)\s*(top|left|right|bottom|width|height|margin|padding)\s*:/.test(lift), '.reo-lift moves nothing in the layout');
assert.ok(/\.reo-slot\{[^}]*transition:transform/.test(css) && /prefers-reduced-motion:reduce\)\{\.reo-slot\{transition:none/.test(css), 'the preview slides, and not under reduced motion');
assert.ok(/function renderAll\(\)\{\s*if\(RO\.busy\(\)\)/.test(app), 'no repaint under a drag in progress');
assert.ok(/ORDER\.rooms\.indexOf|rk=new Map\(ORDER\.rooms/.test(app) && /RO\.sortBy\(shown,a=>a\.id,ORDER\.desks/.test(app) && /RO\.sortBy\(D\.allPlaces\(CUSTOM\),p=>p\.id,ORDER\.places\)/.test(app), 'rooms, desks and places read the saved order');
assert.ok(/e\.altKey[\s\S]{0,80}e\.ctrlKey\|\|e\.metaKey/.test(app) && /Move earlier/.test(app) && /Reset the office order/.test(app), 'keyboard, menu and reset exist');
assert.ok(!/door|cabin/i.test(reo), 'the drag does not build on doors or cabins (issue #954)');
console.log('roomorder: ok');

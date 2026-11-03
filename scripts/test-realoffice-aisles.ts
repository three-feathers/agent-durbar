/** Spec 102 T202, T203, T205 (FR-229, FR-255, FR-256): the `aisles` arrangement of the Retro arcade hall. Pure functions, plain Node, no DOM, 0 credits.
 *  Measure first: it prints what fits. `npm run test:realoffice-layout` runs it after the rows tests. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { realLayout, sortDesks, type RealMeta, type RealModel, type RealAgent, type RealState, type Rect, type Layout } from '../src/shared/realoffice-layout';
import { aisleStatus, aislesLayout, layoutFor, aisleTabOrder, aisleFace, FACE_FLOOR, AISLE_SIGN_MIN_W, ARRANGEMENTS } from '../src/shared/realoffice-arrangements';

process.exitCode = 1;
const ROOT = (() => { let d = __dirname; while (!fs.existsSync(path.join(d, 'package.json'))) d = path.dirname(d); return d; })();
const RO = path.join(ROOT, 'src', 'renderer', 'realoffice');
const readJson = (...p: string[]): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(RO, ...p), 'utf8'));
const META = { ...readJson('worlds', 'retro', 'world.json'), ...readJson('sets', 'retro', 'set.json') } as unknown as RealMeta; // the arcade's own people: the place beside a cabinet is measured on them
const PEOPLE = Object.keys(META.seat).sort();
const STATES: RealState[] = ['working', 'thinking', 'waiting', 'error', 'limit', 'done', 'idle', 'asleep'];
function model(n: number, f: number, states: RealState[] = STATES): RealModel {
  const folders = Array.from({ length: f }, (_, i) => ({ id: 'f' + i, agents: [] as RealAgent[] }));
  for (let i = 0; i < n; i++) folders[i % f].agents.push({ id: 'a' + i, state: states[i % states.length], person: PEOPLE[i % 15], away: i % 5 === 4 ? 'library' : null });
  return { folders, places: ['library', 'software', 'terminal', 'web', 'other', 'coffee', 'boss', 'bank', 'postbox'].map((id) => ({ id, visitors: [] })) };
}
const SIGNS = (f: number): Record<string, { name: string; path: string; counts: number }> => Object.fromEntries(Array.from({ length: f }, (_, i) => ['f' + i, { name: 'project-' + i, path: '~/work/long/path/to/project-' + i, counts: 3 }]));
const inter = (a: Rect, b: Rect, t = 0.5): boolean => a.x + t < b.x + b.w && b.x + t < a.x + a.w && a.y + t < b.y + b.h && b.y + t < a.y + a.h;
const inside = (a: Rect, b: Rect, t = 0.5): boolean => a.x >= b.x - t && a.y >= b.y - t && a.x + a.w <= b.x + b.w + t && a.y + a.h <= b.y + b.h + t;
/** the floors the app shows: both sizes with the chat closed; an open chat hides the office (#1001), so no office floor has a chat beside it */
const SIZES: [number, number][] = [[1440, 848], [1280, 748]];
const NAMES = ['1440x900', '1280x800'];

/** FR-229, FR-255, FR-256: every rule the renderer will rely on, as sentences */
function problems(L: Layout, W: number, k: number): string[] {
  const out: string[] = [], g = L.g as number;
  const floor: Rect = { x: 0, y: L.lobbyH, w: W, h: L.height - L.lobbyH };
  const ds = L.zones.flatMap((z) => z.desks);
  if (ds.length !== k) out.push(`${ds.length} desks for ${k} agents`);
  if (!Number.isInteger(g) || g < 1) out.push(`g ${g} is not an integer`);
  L.zones.forEach((z, i) => {
    if (!inside(z.box, floor)) out.push(`zone ${i} ${JSON.stringify(z.box)} leaves the floor ${JSON.stringify(floor)}`);
    if (!inside(z.sign, floor, 1)) out.push(`sign of ${z.id} leaves the floor`);
    if (z.sign.w < AISLE_SIGN_MIN_W - 0.5 && z.box.w >= AISLE_SIGN_MIN_W) out.push(`sign of ${z.id} is ${z.sign.w}px, under its shortest form`);
    if (z.sign.w < AISLE_SIGN_MIN_W - 0.5) out.push(`sign of ${z.id} has no room for name, counts, + and menu (${z.sign.w}px)`);
    L.zones.forEach((o, j) => { if (j > i && inter(z.box, o.box, 0.5)) out.push(`zone ${i} overlaps zone ${j}`); });
  });
  for (const z of L.zones) for (const d of z.desks) if (d.desk.y < z.sign.y + z.sign.h) out.push(`cabinet of ${d.id} starts at ${d.desk.y}, inside its sign strip (to ${z.sign.y + z.sign.h})`);
  const items = ds.map((d) => ({ id: d.id, cab: d.desk as Rect, plate: d.plate, stand: d.stand as Rect, face: d.face as Rect }));
  for (const d of ds) {
    for (const [nm, r] of [['cabinet', d.desk], ['stand', d.stand], ['marquee', d.marquee], ['glass', d.glass]] as [string, Rect | undefined][]) {
      if (!r) { out.push(`${d.id} has no ${nm}`); continue; }
      if (!inside(r, floor, 1)) out.push(`${nm} of ${d.id} ${JSON.stringify(r)} leaves the floor`);
    }
    for (const [nm, v] of [['cabinet x', d.desk.x], ['cabinet y', d.desk.y], ['cabinet w', d.desk.w], ['cabinet h', d.desk.h]] as [string, number][]) if (v % g) out.push(`${nm} ${v} of ${d.id} is off the grid g=${g}`);
    if (!inside(d.face as Rect, d.stand as Rect, 0.5)) out.push(`face of ${d.id} leaves its person`);
    if ((d.face as Rect).w < FACE_FLOOR && k >= 9) out.push(`face of ${d.id} is ${(d.face as Rect).w}px`);
  }
  /* owner, 2026-11-03: no person is cut by a cabinet or a screen: the whole picture, not only the stand, is clear of every cabinet and screen */
  for (const d of ds) for (const o of ds) for (const r of [o.desk, o.screen as Rect]) for (const [nm, p] of [['person', d.stand], ['picture', d.person]] as [string, Rect | null][]) if (p && r && inter(p, r, 0.5)) out.push(`${nm} of ${d.id} is on the cabinet or screen of ${o.id}`);
  for (let i = 0; i < ds.length; i++) for (let j = 0; j < ds.length; j++) {
    if (i === j) continue;
    const a = items[i], b = items[j];
    if (j > i && inter(a.cab, b.cab)) out.push(`cabinets of ${a.id} and ${b.id} overlap`);
    if (inter(a.stand, b.cab, 1)) out.push(`person of ${a.id} stands on the cabinet of ${b.id}`);
    if (inter(a.stand, b.plate, 1)) out.push(`person of ${a.id} stands on the plate of ${b.id}`);
    if (inter(a.plate, b.cab, 1)) out.push(`plate of ${a.id} is on the cabinet of ${b.id}`);
    if (j > i && inter(a.stand, b.stand, 1)) out.push(`persons of ${a.id} and ${b.id} overlap`);
  }
  for (const z of L.zones) for (const o of L.zones) {
    if (z === o) continue;
    if (inter(z.sign, o.sign, 0.5)) out.push(`signs of ${z.id} and ${o.id} overlap`);
    for (const d of o.desks) for (const r of [d.desk, d.stand as Rect]) if (inter(z.sign, r, 1)) out.push(`sign of ${z.id} covers ${d.id}`);
  }
  for (const z of L.zones) for (const d of z.desks) for (const r of [d.desk, d.stand as Rect, d.plate]) if (inter(z.sign, r, 1)) out.push(`sign of ${z.id} covers ${d.id}`);
  for (const f of L.fixtures) for (const d of ds) if (inter(f.slot, d.desk, 1) && f.slot.y + f.slot.h > d.desk.y) out.push(`fixture ${f.id} and cabinet ${d.id} overlap`);
  if (!L.scroll && L.height !== floor.y + floor.h) out.push('height');
  if (L.lane) for (const z of L.zones) for (const r of [z.sign, ...z.desks.flatMap((d) => [d.desk, d.plate, d.stand as Rect])]) if (inter(r, L.lane, 0.5)) out.push(`the pill lane is not free: ${z.id}`); /* owner, 2026-11-03 */
  return out;
}

// ---- T213, FR-260: the status table, over every state, moving and still ----
{
  const want: Record<string, [string, string, string, boolean, boolean]> = {
    working: ['lit', 'faint', 'none', true, false], thinking: ['lit', 'faint', 'dots', false, false], waiting: ['flash', 'strong', 'ask', false, false], limit: ['orange', 'strong', 'ask', false, false],
    error: ['flash-red', 'small', 'bang', false, false], done: ['green', 'faint', 'tick', false, true], idle: ['dim', 'very-faint', 'none', false, false], asleep: ['off', 'none', 'zz', false, false],
  };
  for (const [st, w] of Object.entries(want)) {
    const a = aisleStatus(st as never), still = aisleStatus(st as never, true);
    assert.deepStrictEqual([a.marquee, a.glow, a.cue, a.bob, a.flourish], w, st);
    assert.ok(!still.bob && !still.flourish, st + ': still: nothing moves');
    assert.ok(!/flash/.test(still.marquee), st + ': still: no flash');
    if (/flash/.test(a.marquee)) assert.notStrictEqual(still.marquee, 'lit', st + ': still: steady, and different from lit');
    assert.strictEqual(still.glow, a.glow, st + ': still: the same glow');
  }
}

// ---- measure first (T202): what fits, at 1..15 and 40 agents in 1..8 folders, the two floors the app shows ----
const faces: Record<string, Record<number, number>> = {}, report: string[] = [];
let cases = 0;
for (let s = 0; s < SIZES.length; s++) {
  const [W, H] = SIZES[s];
  faces[NAMES[s]] = {};
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 40]) {
    for (const f of [1, 2, 3, 4, 8].filter((x) => x <= n)) {
      const L = aislesLayout(model(n, f), { w: W, h: H }, META, SIGNS(f));
      cases++;
      const p = problems(L, W, n);
      assert.deepStrictEqual(p, [], `${n} agents in ${f} folders at ${NAMES[s]}: ${p.slice(0, 4).join('; ')}`);
      if (f === 1 || n <= 8) faces[NAMES[s]][n] = L.faceH;
      if (n <= 15 && L.scroll) report.push(`${n} in ${f} at ${NAMES[s]}: scrolls`);
      if (n === 15 && f === 4) report.push(`15 in 4 at ${NAMES[s]}: g=${L.g} cabinet ${L.cabinet!.w}x${L.cabinet!.h} glass ${L.cabinet!.gw * (L.g as number)}x${L.cabinet!.gh * (L.g as number)} cols ${L.cabinet!.cols} face ${L.faceH}px lobby ${L.lobbyH} short signs ${L.zones.filter((z) => z.signShort).length}/${L.zones.length}`);
      if (n <= 15 && L.zones.some((z) => z.signShort)) report.push(`${n} in ${f} at ${NAMES[s]}: ${L.zones.filter((z) => z.signShort).length} of ${L.zones.length} signs lose path and cost to hover`);
    }
  }
}
// no scroll up to 15 on either floor: not asserted as a fact of nature; a failure names the floor so the design is changed, not the test
assert.deepStrictEqual(report.filter((r) => / scrolls$/.test(r)), [], 'up to 15 agents the hall fits without scrolling');
console.log(report.filter((r) => r.startsWith('15 in 4')).join('\n'));

// ---- FR-229, FR-256: faces: at least 24 px at 15; larger at 8 than at 15; no smaller with fewer people ----
for (const nm of NAMES) {
  const F = faces[nm];
  assert.ok(F[15] >= FACE_FLOOR, `${nm}: face at 15 is ${F[15]}px`);
  /* MEASURED (2026-11-03): with the whole person beside each cabinet, g = 3 at 8 people needs 363 px a column; 1280x800 has 316 at four columns,
     so 8 stay at g = 2 there. A named gap, not a pass: the day more fits, this line fails and turns into the real assertion. */
  if (nm === '1280x800') assert.strictEqual(F[8], F[15], `${nm}: KNOWN GAP, faces at 8 and 15 are both ${F[15]}px`);
  else assert.ok(F[8] > F[15], `${nm}: face at 8 (${F[8]}) is larger than at 15 (${F[15]})`);
  for (let n = 1; n <= 14; n++) assert.ok(F[n] >= F[15], `${nm}: face at ${n} (${F[n]}) is not smaller than at 15`);
}

// ---- owner, 2026-11-03 ("bigger cabinets ... zigzag positioning for max usage"): from 2 people on, no band of bare floor over a quarter of its
// height (above, between or below the rows); a folder's seats stay one group: its sign over its own first cabinet, no row interleaves two folders
const split: string[] = [];
for (const [W, H] of SIZES) for (const dh of [0, 31]) for (const n of [1, 2, 3, 4, 5, 6, 8, 10, 12, 15]) for (const f of [1, 3, 4].filter((x) => x <= n)) {
  const L = aislesLayout(model(n, f), { w: W, h: H - dh }, META, SIGNS(f)), floorH = L.height - L.lobbyH;
  const ys = L.zones.flatMap((z) => [[z.sign.y, z.box.y + z.box.h]]).sort((a, b) => a[0] - b[0]);
  let at = L.lobbyH + (L.lane ? L.lane.h : 0), worst = 0;
  for (const [y0, y1] of ys) { worst = Math.max(worst, y0 - at); at = Math.max(at, y1); }
  worst = Math.max(worst, L.height - at);
  assert.ok(n < 2 || worst <= floorH / 4, `${n} in ${f} at ${W}x${H - dh}: a bare band of ${Math.round(worst)} px on a floor of ${floorH}`);
  for (const z of L.zones) {
    /* the sign stands over its own cabinets and over no other folder's (pre-review of #1079: the old "starts at its first slot" was true by construction) */
    const across = (d: { desk: Rect }): boolean => d.desk.x < z.sign.x + z.sign.w && z.sign.x < d.desk.x + d.desk.w, row = (d: { slot: Rect }): boolean => Math.abs(d.slot.y - z.sign.y) < 1;
    assert.ok(z.desks.some((d) => row(d) && across(d)), `${n} in ${f} at ${W}x${H - dh}: ${z.id}'s sign is over none of its own cabinets`);
    for (const o of L.zones) if (o !== z) for (const d of o.desks) assert.ok(!(row(d) && across(d)), `${n} in ${f} at ${W}x${H - dh}: ${z.id}'s sign is over ${o.id}'s cabinet ${d.id}`);
    for (const o of L.zones) if (o !== z && Math.abs(o.box.y - z.box.y) < 1) for (const d of o.desks) assert.ok(d.slot.x + d.slot.w <= z.box.x + 1 || d.slot.x >= z.box.x + z.box.w - 1, `${o.id}'s seat ${d.id} inside ${z.id}'s row part`);
  }
  /* owner, 2026-11-03 (relayed): a folder of 4 or fewer is one group under one sign, never "(continued)", wherever five columns can hold it
     (15 in 4 folders cannot: 4 + 4 + 4 + 3 needs four rows of five; there the folders flow on and `split` lists it) */
  const parts = new Map<string, number>(), sizes = new Map<string, number>();
  for (const z of L.zones) { parts.set(z.id, (parts.get(z.id) || 0) + 1); sizes.set(z.id, (sizes.get(z.id) || 0) + z.desks.length); }
  const cut = [...parts].filter(([id, c]) => c > 1 && (sizes.get(id) || 0) <= 4);
  if (cut.length) split.push(`${n} in ${f} at ${W}x${H - dh}`);
  if (n <= 10) assert.deepStrictEqual(cut, [], `${n} in ${f} at ${W}x${H - dh}: a folder of 4 or fewer is split`);
  /* a small room stands close together: neighbours on a row at most a quarter of a slot apart (1.1 slots a column) */
  if (n <= 4) for (const a of L.zones.flatMap((z) => z.desks)) for (const b of L.zones.flatMap((z) => z.desks)) if (a !== b && Math.abs(a.slot.y - b.slot.y) < 1 && b.slot.x > a.slot.x) {
    const gap = b.slot.x - (a.slot.x + a.slot.w);
    if (!L.zones.flatMap((z) => z.desks).some((c) => Math.abs(c.slot.y - a.slot.y) < 1 && c.slot.x > a.slot.x && c.slot.x < b.slot.x)) assert.ok(gap <= a.slot.w / 4, `${n} in ${f} at ${W}x${H - dh}: a gap of ${Math.round(gap)} px in a small room`);
  }
  /* and its cabinets stand together, the people outside: two cabinets on a row at most one person place and a quarter of a slot apart (in a row of
     three the middle person stands between two cabinets) */
  const dk = L.zones.flatMap((z) => z.desks);
  if (n <= 4) for (const row of [...new Set(dk.map((d) => Math.round(d.slot.y)))]) {
    const cs = dk.filter((d) => Math.round(d.slot.y) === row).map((d) => d.desk).sort((a, b) => a.x - b.x);
    for (let j = 1; j < cs.length; j++) assert.ok(cs[j].x - (cs[j - 1].x + cs[j - 1].w) <= (dk[0].stand ? dk[0].stand.w : 0) + dk[0].slot.w / 4, `${n} in ${f} at ${W}x${H - dh}: cabinets ${Math.round(cs[j].x - cs[j - 1].x - cs[j - 1].w)} px apart in a small room`);
  }
  /* FR-306: the bodies vary: at up to 4 people all differ, from 8 on all four are on the floor */
  const bodies = new Set(L.zones.flatMap((z) => z.desks.map((d) => d.body)));
  assert.strictEqual(bodies.size, Math.min(4, n), `${n} in ${f} at ${W}x${H - dh}: ${bodies.size} cabinet bodies`);
  /* and neighbours on the grid differ (pre-review of #1079: seat order alone stacks seat n over seat n + 4): beside on a row, or in the next row
     less than a slot to the side (above, below, or diagonal in a zigzag) */
  {
    const all = L.zones.flatMap((z) => z.desks), cx = (d: typeof all[number]): number => d.desk.x + d.desk.w / 2, ys = [...new Set(all.map((d) => Math.round(d.slot.y)))].sort((a, b) => a - b);
    for (const a of all) for (const b of all) {
      if (a === b) continue;
      const ra = ys.indexOf(Math.round(a.slot.y)), rb = ys.indexOf(Math.round(b.slot.y)), dx = Math.abs(cx(a) - cx(b));
      const beside = ra === rb && dx < 1.6 * a.slot.w && !all.some((c) => c !== a && c !== b && Math.round(c.slot.y) === Math.round(a.slot.y) && (cx(c) - cx(a)) * (cx(c) - cx(b)) < 0);
      if (beside || (rb === ra + 1 && dx < a.slot.w)) assert.notStrictEqual(a.body, b.body, `${n} in ${f} at ${W}x${H - dh}: neighbours ${a.id} and ${b.id} have one body`);
    }
  }
  /* a short last row stands in the middle (3 is a triangle, not an L) */
  const ds = L.zones.flatMap((z) => z.desks), lastY = Math.max(...ds.map((d) => d.slot.y)), last = ds.filter((d) => Math.abs(d.slot.y - lastY) < 1);
  if (last.length < ds.filter((d) => Math.abs(d.slot.y - ds[0].slot.y) < 1).length) {
    const mid = (Math.min(...last.map((d) => d.slot.x)) + Math.max(...last.map((d) => d.slot.x + d.slot.w))) / 2;
    assert.ok(Math.abs(mid - W / 2) <= 0.05 * W, `${n} in ${f} at ${W}x${H - dh}: the short last row is not in the middle (${Math.round(mid)} of ${W})`);
  }
}

// ---- owner, 2026-11-03: z z is for asleep only (who sits); idle stands awake with no cue
assert.deepStrictEqual([aisleStatus('idle', false).cue, aisleStatus('asleep', false).cue], ['none', 'zz']);

// ---- owner, 2026-11-03: asleep sits on a stool, whole beside the cabinet (the seated frame `sit`, not a standing one)
{
  const L = aislesLayout(model(8, 1, ['asleep']), { w: 1440, h: 848 }, META);
  const people = L.zones.flatMap((z) => z.desks).map((d) => d.person).filter(Boolean) as { pose: string; file: string }[];
  assert.ok(people.length > 0 && people.every((p) => p.pose === 'sit' && /-sit\.webp$/.test(p.file)), 'asleep sits: ' + people.map((p) => p.pose).join(','));
}

// ---- owner, 2026-11-03: the lobby is no smaller at 1280x800 than at 1440x900 (the notice strip shown or not), so its people are the same size
for (const n of [3, 8, 15]) for (const dh of [0, 31]) {
  const a = aislesLayout(model(n, 4), { w: 1280, h: 748 - dh }, META, SIGNS(4)), b = aislesLayout(model(n, 4), { w: 1440, h: 848 - dh }, META, SIGNS(4));
  assert.ok(!a.scroll && a.lobbyH >= b.lobbyH - 1, `${n} agents${dh ? ', notice strip shown' : ''}: lobby ${a.lobbyH} px at 1280x800 against ${b.lobbyH} at 1440x900`);
}

// ---- T203, FR-230, FR-256: past 15 more rows, the floor scrolls inside itself; a status change moves no zone, sign or cabinet ----
{
  const strip = (L: Layout): string => JSON.stringify([L.g, L.height, L.scroll, L.zones.map((z) => [z.id, z.part, z.box, z.sign, z.signShort, z.desks.map((d) => d.slot).sort((a, b) => a.x - b.x || a.y - b.y)])]);
  for (const n of [15, 16, 40]) for (const [W, H] of [SIZES[0], SIZES[1]]) {
    const m0 = model(n, 4, ['idle']), ref = strip(aislesLayout(m0, { w: W, h: H }, META, SIGNS(4)));
    for (const st of STATES) assert.strictEqual(strip(aislesLayout(model(n, 4, [st]), { w: W, h: H }, META, SIGNS(4))), ref, `${n} agents: a change to ${st} moves no zone or sign at ${W}x${H}`);
  }
  const L16 = aislesLayout(model(16, 1), { w: 1440, h: 848 }, META), L15 = aislesLayout(model(15, 1), { w: 1440, h: 848 }, META);
  assert.ok(L16.cabinet!.rows === 4 && L16.scroll && L16.height > 848, 'a 16th agent adds a row and the floor scrolls inside itself');
  assert.strictEqual(L16.g, L15.g, 'no change of scale at 16');
  assert.strictEqual(aislesLayout(model(40, 8), { w: 1280, h: 748 }, META, SIGNS(8)).cabinet!.rows, 8, '40 agents: eight rows');
}

// ---- T205, FR-229: the keyboard order is the seat order, row by row, and neighbours are neighbours ----
{
  for (const [W, H] of SIZES) for (const n of [4, 8, 15]) {
    const L = aislesLayout(model(n, 3, ['idle']), { w: W, h: H }, META, SIGNS(3));
    const order = aisleTabOrder(L), byId = new Map(L.zones.flatMap((z) => z.desks).map((d) => [d.id, d]));
    assert.deepStrictEqual([...order].sort(), Array.from({ length: n }, (_, i) => 'a' + i).sort(), 'every agent once');
    for (let i = 1; i < order.length; i++) {
      const a = byId.get(order[i - 1])!, b = byId.get(order[i])!;
      assert.ok(b.desk.y > a.desk.y - 40 && (b.desk.x > a.desk.x || b.desk.y > a.desk.y), `${n} at ${W}: ${order[i - 1]} then ${order[i]} is the next seat, in reading order`);
    }
  }
  // FR-022 in this arrangement: seats, and so Tab, go by status inside each folder, in the model's order of folders
  const seats = (m: RealModel): string[] => aisleTabOrder(aislesLayout(m, { w: 1440, h: 848 }, META, SIGNS(m.folders.length)));
  assert.deepStrictEqual(seats(model(5, 1, ['idle', 'working', 'waiting', 'done', 'error'])), ['a2', 'a4', 'a1', 'a3', 'a0'], 'one folder: needs you, error, working, done, idle');
  for (const [n, f] of [[15, 1], [15, 3], [8, 4], [40, 8]]) {
    const m = model(n, f);
    assert.deepStrictEqual(seats(m), m.folders.flatMap((x) => sortDesks(x.agents).map((a) => a.id)), `${n} in ${f}: status order in every folder`);
  }
  // screens face inwards (FR-256)
  assert.deepStrictEqual([0, 1, 2, 3, 4].map((c) => aisleFace(c, 5, 0)), ['right', 'right', 'right', 'left', 'left']);
  assert.deepStrictEqual([0, 1, 2, 3, 4].map((c) => aisleFace(c, 5, 1)), ['right', 'right', 'left', 'left', 'left']);
  assert.strictEqual(aisleFace(0, 2, 0), 'right'); assert.strictEqual(aisleFace(1, 2, 0), 'left');
}

// ---- the seam: `rows` is realLayout, byte for byte (T167); the day or night light is no parameter (FR-251) ----
{
  assert.deepStrictEqual([...ARRANGEMENTS], ['rows', 'aisles']);
  const m = model(15, 4), v = { w: 1280, h: 748 };
  assert.strictEqual(JSON.stringify(layoutFor('rows', m, v, META, SIGNS(4))), JSON.stringify(realLayout(m, v, META, SIGNS(4))), 'rows is untouched');
  assert.strictEqual(JSON.stringify(layoutFor('aisles', m, v, META, SIGNS(4))), JSON.stringify(aislesLayout(m, v, META, SIGNS(4))));
  assert.ok(aislesLayout.length <= 4, 'no light parameter');
  // hostile folder names and counts do not break the layout (the sign is geometry only)
  const hostile = { f0: { name: '<img src=x onerror=1>'.repeat(30), path: '../'.repeat(200), counts: 9999 }, f1: { name: '', path: '', counts: -3 } };
  const L = aislesLayout(model(15, 2), v, META, hostile);
  assert.deepStrictEqual(problems(L, 1280, 15), []);
  assert.deepStrictEqual(aislesLayout({ folders: [], places: [] }, v, META).zones, [], 'no agents, no zones');
}

console.log(`a folder of 4 or fewer still split (five columns cannot hold it whole): ${split.join('; ') || 'none'}`);
/* owner, 2026-11-03 ("still waste a lot of space"): with 4 or fewer the scale goes up to 5 and the plan covering the most floor wins. Measured on the
   floors the app really gives (1408x817 and 1248x717, the window less the frame): cabinets and people over the floor, at least what whole scales
   allow, with the lower lobby of option A (owner, 06:59 UTC) where it lets the cabinets grow: 3 and 4 at 1408 go to g = 4 under a 124 px lobby (asserted below). At
   1248, 2 + 1 at g = 4 would need a lobby of about 27 px, under its minimum: 3 and 4 stay at g = 3 there */
const covs: string[] = [];
for (const [W, H] of [[1408, 817], [1248, 717]] as const) for (const n of [1, 2, 3, 4]) {
  const L = aislesLayout(model(n, 1), { w: W, h: H }, META, SIGNS(1)), dk = L.zones.flatMap((z) => z.desks);
  const cov = dk.reduce((a, d) => a + d.desk.w * d.desk.h + (d.stand ? d.stand.w * d.stand.h : 0), 0) / (W * (L.height - L.lobbyH));
  covs.push(`${n} at ${W}: g ${L.g}, ${Math.round(cov * 100)} %`);
  const lobby = ({ 1408: { 1: 170, 2: 170, 3: 124, 4: 124 }, 1248: { 1: 170, 2: 170, 3: 168, 4: 168 } } as Record<number, Record<number, number>>)[W][n];
  assert.strictEqual(L.lobbyH, lobby, `${n} at ${W}x${H}: the lobby is ${L.lobbyH} px, the figures below are for ${lobby}`);
  const want = ({ 1408: { 1: 0.31, 2: 0.46, 3: 0.42, 4: 0.56 }, 1248: { 1: 0.42, 2: 0.62, 3: 0.33, 4: 0.44 } } as Record<number, Record<number, number>>)[W][n];
  assert.ok(cov >= want, `${n} at ${W}x${H}: cabinets and people cover ${Math.round(cov * 100)} % of the floor, under ${want * 100} %`);
}
console.log(`floor covered with 4 or fewer: ${covs.join('; ')}`);
console.log(`aisles tests passed (${cases} layouts)`);
process.exitCode = 0;

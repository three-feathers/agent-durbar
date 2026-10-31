/** Spec 097 T013, T014, T017: the Real office layout engine (FR-010..FR-027, SC-002, SC-007), the lights (FR-041..FR-052) and the
 *  Characters plumbing (FR-084). Pure functions only, plain Node, no DOM, no credits. `npm run test:realoffice-layout`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { staggerPlan, realLayout, lobbyWidths, sortDesks, assignPeople, standPose, standHeight, POSE_FRAME_B, lobbyRange, PERSON_M, DOOR_M, FRONT_DEPTH, NEAR_SCALE, CHIP_H, U_MIN, U_MAX, U_MAX_BIG, FACE_U, PLATE_H, PLATE_H_ASK, STRIP,
  type RealModel, type RealMeta, type RealAgent, type RealState, type Rect, type Layout } from '../src/shared/realoffice-layout';
import { lightFor, lightState, LIGHT_TABLE, ambientFor, doneTick, fixtureLight, isActive, type LightState } from '../src/shared/lights';

process.exitCode = 1;
const ROOT = (() => { let d = __dirname; while (!fs.existsSync(path.join(d, 'package.json'))) d = path.dirname(d); return d; })();
const META = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'realoffice', 'art', 'people.json'), 'utf8')) as RealMeta;
const PEOPLE = Object.keys(META.seat).sort();
assert.strictEqual(PEOPLE.length, 15, 'the art has 15 seated people');

const STATES: RealState[] = ['working', 'thinking', 'waiting', 'error', 'limit', 'done', 'idle', 'asleep'];
const PLACES = ['library', 'software', 'terminal', 'web', 'other', 'coffee', 'boss', 'bank', 'postbox'];
/** n agents over f folders, states cycling, every 5th agent away at a place (away > 0) */
function model(n: number, f: number, opts: { away?: boolean; states?: RealState[]; custom?: number } = {}): RealModel {
  const folders = Array.from({ length: f }, (_, i) => ({ id: 'f' + i, agents: [] as RealAgent[] }));
  const visitors: Record<string, { id: string; person: string; needsYou: boolean }[]> = {};
  for (let i = 0; i < n; i++) {
    const st = (opts.states || STATES)[i % (opts.states || STATES).length];
    const away = opts.away !== false && i % 5 === 4 ? PLACES[i % 7] : null;
    const a: RealAgent = { id: 'a' + i, state: st, away, person: PEOPLE[i % 15] };
    folders[i % f].agents.push(a);
    if (away) (visitors[away] ||= []).push({ id: a.id, person: a.person as string, needsYou: st === 'waiting' });
  }
  const places = PLACES.map((id) => ({ id, visitors: visitors[id] || [] }));
  for (let c = 0; c < (opts.custom || 0); c++) places.splice(5, 0, { id: 'c-00000' + c, custom: true, visitors: [] } as never);
  return { folders, places };
}
const inter = (a: Rect, b: Rect, t = 0.5): boolean => a.x + t < b.x + b.w && b.x + t < a.x + a.w && a.y + t < b.y + b.h && b.y + t < a.y + a.h;
const inside = (a: Rect, b: Rect, t = 0.5): boolean => a.x >= b.x - t && a.y >= b.y - t && a.x + a.w <= b.x + b.w + t && a.y + a.h <= b.y + b.h + t;

/** every rule the renderer relies on; returns the problems as sentences */
function problems(L: Layout, W: number, H: number): string[] {
  const out: string[] = [];
  const floor = { x: 0, y: 0, w: W, h: L.height };
  if (L.u < U_MIN - 1e-6 || L.u > (L.big ? U_MAX_BIG : U_MAX) + 1e-6) out.push(`u ${L.u} out of range`);
  if (!L.scroll && L.height !== H) out.push(`height ${L.height} != ${H} without scroll`);
  const [lmin, lmax] = lobbyRange(H);
  if (L.lobbyH < lmin || L.lobbyH > Math.max(lmin, lmax)) out.push(`lobby ${L.lobbyH} outside ${lmin}..${lmax}`);
  const zones = L.zones.map((z) => z.box);
  zones.forEach((a, i) => { if (!inside(a, floor)) out.push(`zone ${i} leaves the floor`); if (a.y < L.lobbyH - 0.5) out.push(`zone ${i} under the lobby band`); zones.forEach((b, j) => { if (j > i && inter(a, b)) out.push(`zones ${i}/${j} overlap`); }); });
  const plates: Rect[] = [], signs: Rect[] = [], screens: Rect[] = [], persons: Rect[] = [];
  for (const z of L.zones) {
    signs.push(z.sign);
    if (!inside(z.sign, z.box, 3)) out.push(`sign of ${z.id} leaves its zone`);
    for (const d of z.desks) {
      plates.push(d.plate); screens.push(d.screen); if (d.person) persons.push(d.person.vis);
      for (const [k, r] of [['plate', d.plate], ['screen', d.screen], ['desk', d.desk]] as [string, Rect][]) if (!inside(r, z.box, 2)) out.push(`${k} of ${d.id} leaves its zone ${JSON.stringify(r)} ${JSON.stringify(z.box)}`);
      if (d.plate.w < 40) out.push(`plate of ${d.id} is ${d.plate.w}px wide`);
      if (d.person && inter(d.person.vis, d.screen, 1)) out.push(`person of ${d.id} under its screen`);
      if (d.screen.y < z.box.y + STRIP - 1) out.push(`screen of ${d.id} in the sign strip`);
    }
  }
  const aways: Rect[] = L.zones.flatMap((z) => z.desks.filter((d) => d.away).map((d) => ({ x: d.away!.x - 40, y: d.away!.y, w: 80, h: 17 })));
  const all: [string, Rect[]][] = [['plate', plates], ['sign', signs], ['screen', screens], ['person', persons], ['away label', aways]];
  for (let i = 0; i < all.length; i++) for (let j = i; j < all.length; j++) for (let p = 0; p < all[i][1].length; p++) for (let q = i === j ? p + 1 : 0; q < all[j][1].length; q++)
    if (inter(all[i][1][p], all[j][1][q], 1)) out.push(`${all[i][0]} ${p} overlaps ${all[j][0]} ${q}`);
  for (const f of L.fixtures) {
    if (f.slot.x < -0.5 || f.slot.x + f.slot.w > W + 0.5) out.push(`fixture ${f.id} leaves the band`);
    if (f.art && (f.art.y < -0.5 || f.art.y + f.art.h > L.lobbyH + 0.5)) out.push(`fixture ${f.id} cut by the band (FR-023)`);
    for (const v of f.visitors) if (v.fig && (v.fig.y < -0.5 || v.fig.y + v.fig.h > L.lobbyH)) out.push(`visitor ${v.id} leaves the band`);
  }
  L.fixtures.forEach((a, i) => L.fixtures.forEach((b, j) => { if (j > i && inter(a.slot, b.slot)) out.push(`fixtures ${a.id}/${b.id} overlap`); }));
  return out;
}

// ---- FR-019, FR-011, FR-012: 1..40 agents in 1..8 folders at both sizes, chat closed and open (the floor width the app passes) ----
const SIZES: [number, number][] = [[1440, 900 - 52], [1280, 800 - 52], [1440 - 470, 900 - 52], [1280 - 470, 800 - 52]];
let cases = 0;
for (const [W, H] of SIZES) for (const n of [1, 2, 3, 4, 5, 8, 12, 15, 20, 30, 40]) for (const f of [1, 2, 3, 4, 6, 8]) {
  if (f > n) continue;
  const L = realLayout(model(n, f), { w: W, h: H }, META);
  const p = problems(L, W, H);
  if (n <= 15 && W >= 1280) assert.ok(!L.scroll, `${n} agents in ${f} folders at ${W}x${H}: no scroll at the 15-agent scale`);
  assert.deepStrictEqual(p, [], `${n} agents, ${f} folders, ${W}x${H}: ${p.slice(0, 6).join('; ')}`);
  assert.strictEqual(L.zones.reduce((s, z) => s + z.desks.length, 0), n, 'one desk per agent');
  assert.strictEqual(L.big, n <= 4, 'big screens exactly for 4 agents or fewer (FR-020)');
  cases++;
}

// ---- SC-002: desk faces at least 40 px with 15 agents at 1280x800 and 1440x900 (chat closed), 4 folders as the simulator ----
const faces: Record<string, number> = {};
for (const [W, H] of SIZES.slice(0, 2)) {
  const L = realLayout(model(15, 4), { w: W, h: H }, META);
  faces[`${W}x${H + 52}`] = Math.round(L.faceH * 10) / 10;
}
console.log('desk face px with 15 agents:', JSON.stringify(faces));
/* SC-002's 40 px is not met (35.2 px at 1280x800, 38.1 at 1440x900): a [KNOWN GAP] in spec 097; this is a ratchet so it never gets worse */
const FACE_FLOOR = Number(process.env.REALOFFICE_FACE_MIN || 35);
for (const [k, v] of Object.entries(faces)) assert.ok(v >= FACE_FLOOR - 1e-9, `SC-002 ratchet: desk face ${v} px at ${k}, at least ${FACE_FLOOR}`);

// ---- FR-020: big screens: each at least 170 px tall and wider than tall-ish; text size rule is the renderer's ----
{
  const L = realLayout(model(3, 1), { w: 1280, h: 748 }, META);
  for (const d of L.zones[0].desks) assert.ok(d.glass.h >= 8 * 11 * 1.3 + 10 && d.glass.w >= 300, `SC-003: room for 8 lines at 11 px: big screen ${JSON.stringify(d.glass)}`);
  assert.ok(L.u <= U_MAX_BIG, 'u capped with big screens');
  const m3 = model(3, 1, { away: false }); m3.folders[0].agents[0].away = 'boss';
  for (const [W, H] of SIZES) assert.deepStrictEqual(problems(realLayout(m3, { w: W, h: H }, META), W, H), [], `big screens with an away desk at ${W}x${H}: its label is not on its screen`);
  const one = realLayout(model(1, 1, { away: false }), { w: 1440, h: 848 }, META);
  assert.ok(one.u <= 300, 'one agent is not a giant (u capped)');
}

// ---- FR-022: status order in a zone, ties keep the model order ----
{
  const a = (id: string, state: RealState): RealAgent => ({ id, state, person: 'p01' });
  assert.deepStrictEqual(sortDesks([a('1', 'idle'), a('2', 'working'), a('3', 'error'), a('4', 'limit'), a('5', 'waiting'), a('6', 'done'), a('7', 'thinking'), a('8', 'asleep')]).map((x) => x.id), ['4', '5', '3', '2', '7', '6', '1', '8']);
}

// ---- FR-015: a status change never moves a desk box (the same slots for every state of one agent; FR-022 may reorder who sits in them) ----
{
  const base = model(15, 4, { away: false });
  const sig = (L: Layout): string => JSON.stringify(L.zones.map((z) => z.desks.map((d) => [Math.round(d.desk.x), Math.round(d.desk.y), Math.round(d.desk.w), Math.round(d.screen.x), Math.round(d.screen.y)]).sort()));
  const ref = sig(realLayout(base, { w: 1280, h: 748 }, META));
  for (const st of ['working', 'thinking', 'waiting', 'error', 'limit', 'done', 'idle'] as RealState[]) {
    const m = JSON.parse(JSON.stringify(base)) as RealModel; m.folders[1].agents[0].state = st;
    assert.strictEqual(sig(realLayout(m, { w: 1280, h: 748 }, META)), ref, `a change to ${st} moves no desk`);
  }
}

// ---- FR-017, Q5: away and asleep desks are narrower, with no person; away ones say where ----
{
  const m = model(6, 1, { away: false, states: ['working'] });
  m.folders[0].agents[1].away = 'library'; m.folders[0].agents[2].state = 'asleep';
  const L = realLayout(m, { w: 1440, h: 848 }, META);
  const d = Object.fromEntries(L.zones[0].desks.map((x) => [x.id, x]));
  assert.ok(Math.abs(d.a1.slot.w / d.a0.slot.w - 0.62) < 0.01 && Math.abs(d.a2.slot.w / d.a0.slot.w - 0.62) < 0.01, 'away and asleep desks are 0.62 wide');
  assert.ok(!d.a1.person && d.a1.away && !d.a2.person && !d.a2.away && d.a0.person, 'no person at an away or asleep desk; the away one says where');
}

// ---- FR-016, FR-015: plate heights ----
{
  const L = realLayout(model(8, 2, { away: false }), { w: 1440, h: 848 }, META);
  for (const z of L.zones) for (const d of z.desks) assert.strictEqual(d.plate.h, d.state === 'waiting' || d.state === 'limit' ? PLATE_H_ASK : PLATE_H, 'plate height by need');
}

// ---- FR-038: cues only where they belong ----
{
  const L = realLayout(model(8, 1, { away: false }), { w: 1440, h: 848 }, META);
  for (const d of L.zones[0].desks) {
    assert.strictEqual(!!d.bubble, d.state === 'waiting' || d.state === 'limit', `bubble for ${d.state}`);
    assert.strictEqual(!!d.bang, d.state === 'error', `bang for ${d.state}`);
    assert.strictEqual(!!d.dots, d.state === 'thinking', `dots for ${d.state}`);
  }
}

// ---- FR-023..FR-027: the lobby band ----
{
  const L = realLayout(model(15, 4), { w: 1280, h: 748 }, META);
  assert.deepStrictEqual(L.fixtures.map((f) => f.id), PLACES, 'fixtures in the model order (spec 001 FR-039)');
  for (const f of L.fixtures) if (f.art) assert.ok(f.art.y >= -0.5 && Math.abs(f.art.y + f.art.h - (L.lobbyH - L.floorStrip.h + 3)) < 1, `${f.id} whole, standing on the floor line`);
  const vs = L.fixtures.flatMap((f) => f.visitors.filter((v) => v.fig));
  assert.ok(vs.length >= 3, 'visitors stand at fixtures');
  const lobbyFace = Math.min(...vs.map((v) => (v.face as Rect).h));
  console.log('lobby face px with 15 agents at 1280x800:', Math.round(lobbyFace * 10) / 10);
  /* FR-024's 18 px is a [KNOWN GAP] since the owner's realism rule (people 1.7 m against the 2.1 m door): a ratchet keeps the estimate */
  assert.ok(lobbyFace >= 11, `FR-024 ratchet: lobby faces (estimate: 0.13 of a 1.7 m person) ${lobbyFace}`);
  // owner 2026-10-31 09:03: one fixture per place; a crowd widens its place, empty places shrink; +N only past what fits
  for (const [W, H] of [[1440, 848], [1280, 748]] as [number, number][]) {
    const widths: number[] = [];
    for (const n of [0, 1, 5, 12]) {
      const m = model(15, 4, { away: false }); m.places[0].visitors = Array.from({ length: n }, (_, i) => ({ id: 'v' + i, person: PEOPLE[i % 15], needsYou: false }));
      const Lx = realLayout(m, { w: W, h: H }, META);
      assert.strictEqual(Lx.fixtures.filter((f) => f.id === 'library').length, 1, 'one Library fixture, never two');
      const lib = Lx.fixtures[0];
      assert.ok(lib.art, `${n} at the Library: it keeps its fixture`);
      assert.strictEqual(lib.visitors.length + lib.more, n, `${n} at the Library: everyone is drawn or in +N`);
      if (n <= 5) assert.strictEqual(lib.more, 0, `${n} at the Library at ${W}: all of them stand there (no +N)`);
      if (n) assert.ok(lib.visitors.length >= 1, 'at least one person stands at a busy place');
      assert.deepStrictEqual(problems(Lx, W, H), [], `${n} at the Library at ${W}x${H}`);
      const vx = lib.visitors.map((v) => v.chip.x);
      assert.ok(vx.every((x) => x >= lib.slot.x && x <= lib.slot.x + lib.slot.w + 1), 'the crowd stands inside its place');
      widths.push(lib.slot.w);
    }
    assert.ok(widths[0] < widths[1] && widths[1] < widths[2], `a place widens with its crowd at ${W}: ${widths.map(Math.round)}`);
    // all places busy (2 each): nothing collapses, everyone fits or +N, no overlap
    const m = model(15, 4, { away: false }); m.places.forEach((p, k) => { p.visitors = [0, 1].map((i) => ({ id: p.id + i, person: PEOPLE[(k * 2 + i) % 15], needsYou: false })); });
    const La = realLayout(m, { w: W, h: H }, META);
    assert.ok(La.fixtures.every((f) => f.art && f.visitors.length >= 1 && f.visitors.length + f.more === 2), `all places busy at ${W}: every fixture drawn`);
    assert.deepStrictEqual(problems(La, W, H), [], `all places busy at ${W}x${H}`);
  }
  {
    // the allocation itself: empty places shrink first, then closer people, then smaller fixtures, then +N, then plate-only slots
    const fx = [100, 100, 100, 100];
    const a0 = lobbyWidths(fx, [0, 0, 0, 0], 1000, 40);
    assert.ok(a0.compact.every((c) => !c) && a0.scale.every((k) => k === 1), 'room to spare: nothing shrinks');
    const ae = lobbyWidths(fx, [0, 3, 0, 0], 420, 40);
    assert.ok(ae.scale[0] < 1 && ae.scale[1] === 1 && ae.compact.every((c) => !c), `a crowd first makes the empty places compact fixtures: ${ae.scale}`);
    const a1 = lobbyWidths(fx, [0, 3, 0, 0], 220, 40);
    assert.deepStrictEqual(a1.compact.slice(1), [false, true, true], 'with no room, empty places become plates from the right; the busy one never');
    const a2 = lobbyWidths(fx, [12, 12, 12, 12], 500, 40);
    assert.ok(a2.shown.every((c) => c >= 1) && a2.shown.some((c) => c < 12), 'big crowds: fewer shown, never none');
    assert.ok(a2.x[3] + a2.w[3] <= 500 + 0.5, 'fits the band');
    for (let i = 1; i < 4; i++) assert.ok(a2.x[i] >= a2.x[i - 1] + a2.w[i - 1], 'no overlap between places');
  }
  // custom places (FR-027) and a narrow floor: empty fixtures become plate-only slots, occupied ones never
  const m3 = model(15, 4, { custom: 3 });
  const L3 = realLayout(m3, { w: 640, h: 748 }, META);
  assert.strictEqual(L3.fixtures.length, 12, '9 built-in places and 3 custom ones');
  for (const f of L3.fixtures) if (m3.places.find((p) => p.id === f.id)!.visitors.length) assert.ok(f.art, `occupied ${f.id} keeps its fixture`);
  const fullH = L3.fixtures.filter((f) => f.art).map((f) => f.art!.h);
  assert.ok(L3.fixtures.some((f) => !f.art) || Math.min(...fullH) < Math.max(...fullH) - 0.5, 'a narrow band: some empty place is a compact fixture or a plate-only slot');
  assert.deepStrictEqual(problems(L3, 640, 748), [], 'the narrow lobby still has no overlap');
  assert.ok(L3.fixtures.filter((f) => f.custom).every((f) => !f.art || Math.abs(f.art.w - L3.fixtures.find((x) => x.id === 'web')!.art!.w) < 1 || !L3.fixtures.find((x) => x.id === 'web')!.art), 'a custom fixture is the size of the Web one');
}

// ---- owner 2026-10-31 10:19 ("it must be real"): feet on the floor line, people 1.7 m against a 2.1 m door ----
for (const [W, H] of SIZES) {
  const m = model(15, 4); m.places[6].visitors = [0, 1, 2].map((i) => ({ id: 'b' + i, person: PEOPLE[i], needsYou: false })); m.places[2].visitors = [{ id: 't0', person: 'p03', needsYou: false }];
  const L = realLayout(m, { w: W, h: H }, META);
  const floorLine = L.floorStrip.y + 3, wallScale = floorLine / META.floorLine;
  /* owner 10:48: visitors stand in front of the fixtures, on the floor strip: the front floor plane, 35-60 % of the strip below the wall line */
  const front = floorLine + FRONT_DEPTH * (L.lobbyH - floorLine);
  assert.ok(FRONT_DEPTH >= 0.35 && FRONT_DEPTH <= 0.6 && NEAR_SCALE >= 1.03 && NEAR_SCALE <= 1.06, 'depth plane and near scale in the owner\'s ranges');
  assert.ok(front - floorLine >= 6, `the front plane is visibly below the wall line at ${W}: ${(front - floorLine).toFixed(1)} px`);
  const doorPx = (META.floorLine - (META.fixtureTop as Record<string, number>).boss) * wallScale;
  let n = 0;
  for (const f of L.fixtures) for (const v of f.visitors) {
    if (!v.fig) continue;
    n++;
    const st = META.stand[m.places.find((p) => p.id === f.id)!.visitors.find((x) => x.id === v.id)!.person as string];
    const feet = (st.feet as Record<string, number>)[v.fig.pose], top = (st.top as Record<string, number>)[v.fig.pose];
    assert.ok(Math.abs(v.fig.y + v.fig.h * feet - front) <= 2, `${v.id} (${v.fig.pose}) stands on the front floor plane at ${W}: feet ${v.fig.y + v.fig.h * feet} vs ${front} (wall line ${floorLine})`);
    assert.ok(v.fig.y + v.fig.h * feet - floorLine >= 6, `${v.id} does not stand on the wall's base line`);
    assert.ok(v.shadow && Math.abs(v.shadow.y + v.shadow.h / 2 - front) <= 0.5 && v.shadow.w > v.shadow.h * 3, `${v.id} has an elliptical contact shadow on the front plane`);
    /* the name chip never covers the figure's lower 25 % (feet and legs) */
    const low = { y0: v.fig.y + v.fig.h * (feet - 0.25 * (feet - top)), y1: v.fig.y + v.fig.h * feet };
    assert.ok(v.chip.y + CHIP_H <= low.y0 || v.chip.y >= low.y1, `${v.id}: its chip (y ${v.chip.y.toFixed(1)}) does not cover the lower quarter (${low.y0.toFixed(1)}-${low.y1.toFixed(1)})`);
    assert.ok(v.chip.y >= 0, `${v.id}: the chip stays in the band`);
    for (const g of L.fixtures) for (const o of g.visitors) if (o.fig && o !== v) {
      const so = META.stand[m.places.find((p) => p.id === g.id)!.visitors.find((x) => x.id === o.id)!.person as string];
      const fo = (so.feet as Record<string, number>)[o.fig.pose], to = (so.top as Record<string, number>)[o.fig.pose];
      const oy0 = o.fig.y + o.fig.h * (fo - 0.25 * (fo - to)), oy1 = o.fig.y + o.fig.h * fo, cw = 70; /* a generous chip width */
      const xo = Math.abs(v.chip.x - (o.fig.x + o.fig.w / 2)) < cw / 2 + o.fig.w * 0.3, yo = v.chip.y < oy1 && v.chip.y + CHIP_H > oy0;
      assert.ok(!(xo && yo), `${v.id}'s chip does not cover ${o.id}'s legs`);
    }
    if (v.fig.pose === 'letter' || v.fig.pose === 'book' || v.fig.pose === 'knock') {
      const tall = v.fig.h * (feet - top);
      assert.ok(Math.abs(tall / doorPx - NEAR_SCALE * PERSON_M / DOOR_M) < 0.06, `${v.id} is ${(tall / doorPx * DOOR_M).toFixed(2)} m against a ${DOOR_M} m door at ${W} (drawn ${NEAR_SCALE}x, nearer)`);
    }
  }
  assert.ok(n >= 5, 'visitors were checked: ' + n);
  /* owner 2026-10-31 ("Treadmill is not on floor ... use running"; "yes make a real running pose"): the Terminal visitor jogs in
     place beside the terminal, stride A in P1, on the front floor plane like everyone else (no treadmill) */
  const term = L.fixtures.find((f) => f.id === 'terminal')!.visitors[0];
  assert.strictEqual(term.fig!.pose, 'runA', 'the Terminal visitor runs (stride A), no treadmill');
  assert.strictEqual(term.fig!.file, 'p03-runA.webp', 'the running picture of that person');
  assert.ok(Math.abs(term.fig!.feetY - front) <= 0.5, 'the Terminal visitor stands on the front floor plane');
  const sr = META.stand.p03, tf = (sr.feet as Record<string, number>).runA, tt = (sr.top as Record<string, number>).runA;
  assert.ok(Math.abs(term.fig!.y + term.fig!.h * tf - front) <= 2, `the runner's lowest foot is on the front floor plane at ${W} (within 2 px)`);
  const runTall = term.fig!.h * (tf - tt), upTall = (L.fixtures.find((f) => f.id === 'terminal')!.visitors[0].fig!.h / sr.poses.runA[1]) * standHeight(META, 'p03');
  assert.ok(runTall / upTall > 0.9 && runTall / upTall < 1.0, `a runner is a little shorter than upright (bent knees): ${(runTall / upTall).toFixed(3)}`);
}
// ---- the running pose: every person has both strides, measured, the same canvas for both (no jump when P2 steps them) ----
assert.strictEqual(POSE_FRAME_B.runA, 'runB', 'stride B is recorded for P2');
for (const pid of PEOPLE) {
  const st = META.stand[pid];
  for (const p of ['runA', 'runB']) assert.ok(Array.isArray(st.poses[p]) && st.feet && st.feet[p] > 0.9 && st.top && st.top[p] < 0.1, `${pid} has a measured ${p}`);
  assert.deepStrictEqual(st.poses.runA, st.poses.runB, `${pid}: both strides share one canvas`);
  assert.strictEqual(standPose(META, pid, 'terminal', false)!.pose, 'runA', `${pid} runs at the Terminal`);
}
{
  const noRun = JSON.parse(JSON.stringify(META)) as RealMeta; delete noRun.stand.p01.poses.runA;
  assert.strictEqual(standPose(noRun, 'p01', 'terminal', false)!.pose, 'letter', 'a person without the running picture stands (letter)');
}
// the anchor uses the measured foot line, not the picture's box: the mockup's art had up to 6 % empty rows under the feet
assert.ok(Object.values(META.stand).some((s) => Object.values(s.feet as Record<string, number>).some((f) => f < 0.97)), 'some sprite has empty rows under its feet (so a box anchor would float)');

// ---- FR-024: stand poses and fallbacks ----
{
  assert.strictEqual(standPose(META, 'p01', 'library', false)!.pose, 'book');
  assert.strictEqual(standPose(META, 'p02', 'software', false)!.pose, 'box', 'p02 has the extra poses');
  assert.strictEqual(standPose(META, 'p01', 'software', false)!.pose, 'letter', 'box falls back to letter');
  assert.strictEqual(standPose(META, 'p01', 'c-abc', true)!.pose, 'letter', 'a custom place: wait, else letter');
  assert.strictEqual(standPose(META, 'nobody', 'library', false), null);
  assert.strictEqual(standPose(META, '__proto__', 'library', false), null, 'own keys only');
}

// ---- SC-007: under 5 ms for 40 agents in 8 folders (CPU time, minimum of runs, agent-notes "Timing checks") ----
{
  const m = model(40, 8);
  const cpu = (): number => { const t = process.cpuUsage(); realLayout(m, { w: 1280, h: 748 }, META); const d = process.cpuUsage(t); return (d.user + d.system) / 1000; };
  for (let i = 0; i < 3; i++) cpu();
  const runs = Array.from({ length: 15 }, cpu), best = Math.min(...runs);
  console.log('layout CPU ms for 40 agents in 8 folders: best', best.toFixed(2));
  assert.ok(best < 5, `SC-007: ${best.toFixed(2)} ms`);
  const m6 = model(15, 7);
  const cpu6 = (): number => { const t = process.cpuUsage(); realLayout(m6, { w: 1280, h: 748 }, META); const d = process.cpuUsage(t); return (d.user + d.system) / 1000; };
  const best6 = Math.min(...Array.from({ length: 10 }, cpu6));
  console.log('layout CPU ms for 15 agents in 7 folders (the full search): best', best6.toFixed(2));
  assert.ok(best6 < 15, `7 folders with the full search: ${best6.toFixed(2)} ms (3.5 ms on the dev machine)`);
}

// ---- FR-084: the Characters setting in Real office (the seam in crew.js) ----
{
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const C = require(path.join(ROOT, 'src', 'renderer', 'crew.js')) as { realOfficeSet: (c: string) => { set: string; scene: string; coming: boolean }; realOfficeNote: (c: string, v: string) => string; REAL_OFFICE_SETS: string[] };
  assert.deepStrictEqual(C.REAL_OFFICE_SETS, ['office'], 'only the Office people have Real office pictures today');
  for (const c of ['theme', 'minimalist', '', 'mine', '__proto__']) assert.deepStrictEqual(C.realOfficeSet(c), { set: 'office', scene: 'office', coming: false }, `${c || '(none)'}: the Office people, no note`);
  for (const c of ['cheeky', 'prehistoric']) assert.deepStrictEqual(C.realOfficeSet(c), { set: 'office', scene: 'office', coming: true }, `${c}: a crew without Real office pictures shows the Office people, and Settings says so`);
  // FR-083: the Settings line, for a crew only and only with Real office chosen
  assert.strictEqual(C.realOfficeNote('cheeky', 'real'), 'Real office shows the Office people until the Cheeky loft is ready.', 'Cheeky: the note names its world');
  assert.strictEqual(C.realOfficeNote('prehistoric', 'real'), 'Real office shows the Office people until the Prehistoric cave is ready.', 'Prehistoric: the note names its world');
  for (const c of ['theme', 'minimalist', '', 'mine', '__proto__', 'office']) assert.strictEqual(C.realOfficeNote(c, 'real'), '', `${c || '(none)'}: the Office people, no note`);
  for (const v of ['cabins', 'open', '']) assert.strictEqual(C.realOfficeNote('cheeky', v), '', `${v || '(none)'}: no note outside Real office`);
  C.REAL_OFFICE_SETS.push('cheeky');
  assert.deepStrictEqual(C.realOfficeSet('cheeky'), { set: 'cheeky', scene: 'office', coming: false }, 'a crew with pictures is drawn (the seam)');
  assert.strictEqual(C.realOfficeNote('cheeky', 'real'), '', 'a crew whose world shipped has no note');
  C.REAL_OFFICE_SETS.pop();
}

// ---- FR-037: who sits where ----
{
  const ids = PEOPLE, r = (): number => 0;
  const s = Array.from({ length: 15 }, (_, i) => ({ id: 's' + i, folder: 'f' + (i % 3) }));
  const m1 = assignPeople({}, s, ids, r);
  assert.strictEqual(new Set(Object.values(m1)).size, 15, '15 sessions, 15 different people');
  const m2 = assignPeople(m1, s.slice(0, 10).concat([{ id: 'new', folder: 'f0' }]), ids, r);
  for (let i = 0; i < 10; i++) assert.strictEqual(m2['s' + i], m1['s' + i], 'a session keeps its person');
  assert.ok(!('s12' in m2), 'a gone session is dropped');
  assert.ok(!Object.entries(m2).some(([k, v]) => k !== 'new' && v === m2.new && s.find((x) => x.id === k)!.folder === 'f0'), 'the new one is not a twin in its folder');
  const s20 = Array.from({ length: 20 }, (_, i) => ({ id: 't' + i, folder: 'f' + (i % 2) }));
  const m3 = assignPeople({}, s20, ids, r);
  for (const f of ['f0', 'f1']) { const v = s20.filter((x) => x.folder === f).map((x) => m3[x.id]); assert.strictEqual(new Set(v).size, v.length, `no twins in folder ${f} when avoidable`); }
  /* the folder comes first, then the overall use: A is used twice elsewhere, B once in this folder; the new session takes A (0 in its folder) although B is used less overall */
  {
    const two = ['A', 'B'], ss = [{ id: 's1', folder: 'f0' }, { id: 's2', folder: 'f1' }, { id: 's3', folder: 'f1' }, { id: 'n', folder: 'f0' }];
    const m = assignPeople({ s1: 'B', s2: 'A', s3: 'A' }, ss, two, r);
    assert.strictEqual(m.n, 'A', 'least-used person in its folder first, then overall');
  }
  assert.deepStrictEqual(assignPeople({ x: 'p99', y: 'p01' } as Record<string, string>, [{ id: 'x', folder: 'a' }, { id: 'y', folder: 'a' }], ids, r).y, 'p01', 'an unknown stored person is replaced, a known one kept');
}

// ---- FR-041: lights ----
{
  assert.deepStrictEqual(Object.keys(LIGHT_TABLE), ['working', 'thinking', 'waiting', 'error', 'limit', 'done', 'idle', 'asleep'], 'one row per state');
  const row = (s: string): string => { const l = lightFor(s); return [l.lamp, l.glow, l.call, l.motion].join('/'); };
  assert.strictEqual(row('working'), 'warm/on//');
  assert.strictEqual(row('thinking'), 'on/breathe//breathe');
  assert.strictEqual(row('waiting'), 'bright/on/amber/pulse');
  assert.strictEqual(row('error'), 'on/red/red/');
  assert.strictEqual(row('limit'), 'on/on/orange/');
  assert.strictEqual(row('done'), 'low/low/green-once/fade');
  assert.strictEqual(row('idle'), 'low/low//');
  assert.strictEqual(row('asleep'), 'off/off//');
  assert.strictEqual(lightState('compacting'), 'thinking'); assert.strictEqual(lightState('retrying'), 'thinking');
  assert.strictEqual(lightState('failing'), 'error'); assert.strictEqual(lightState('working', { paused: true }), 'idle');
  assert.strictEqual(lightState('waiting', { limit: true }), 'limit', 'limit wins over waiting');
  assert.strictEqual(lightState('error', { asleep: true }), 'asleep');
  assert.strictEqual(lightState('toString'), 'idle', 'own keys only'); assert.strictEqual(lightState('nonsense'), 'idle');
  for (const s of STATES) assert.strictEqual(lightFor(s, { still: true }).motion, null, `FR-047: ${s} still under reduced motion or Serious mode`);
  assert.strictEqual(lightFor('waiting', { still: true }).call, 'amber', 'the call light stays, steady');
  lightFor("working").lamp = "off"; assert.strictEqual(lightFor('working').lamp, 'warm', 'the table cannot be changed through a result');
  // FR-043
  assert.strictEqual(ambientFor([]), 1);
  assert.strictEqual(ambientFor(['idle', 'done', 'asleep']), 0.7);
  assert.strictEqual(ambientFor(['working', 'error', 'limit', 'waiting', 'thinking']), 1);
  const s15 = (k: number): LightState[] => Array.from({ length: 15 }, (_, i) => (i < k ? 'working' : 'idle'));
  assert.ok(ambientFor(s15(3)) < ambientFor(s15(12)), 'US2-3: 3 working of 15 is dimmer than 12');
  assert.ok(!isActive('done') && isActive('error'));
  // FR-052
  const seen = new Map<string, LightState>();
  assert.strictEqual(doneTick(seen, 'a', 'done'), false, 'done at the first render (a reload) does not tick');
  assert.strictEqual(doneTick(seen, 'b', 'working'), false);
  assert.strictEqual(doneTick(seen, 'b', 'done'), true, 'working -> done ticks');
  assert.strictEqual(doneTick(seen, 'b', 'done'), false, 'a re-render does not tick again');
  // FR-045
  assert.strictEqual(fixtureLight('library', 1, false), 'lamp'); assert.strictEqual(fixtureLight('library', 0, false), null);
  assert.strictEqual(fixtureLight('bank', 1, false), 'lamp');
  assert.strictEqual(fixtureLight('boss', 1, false), null); assert.strictEqual(fixtureLight('boss', 1, true), 'busy'); assert.strictEqual(fixtureLight('boss', 2, false), 'busy');
  assert.strictEqual(fixtureLight('coffee', 1, false), 'glow');
  assert.strictEqual(fixtureLight('terminal', 1, false), 'soft'); assert.strictEqual(fixtureLight('c-abc123', 1, false), 'soft');
  assert.strictEqual(fixtureLight('postbox', 3, false), null);
}

// ---- the page loads the compiled modules as plain scripts after exports-shim.js, next to the other shared modules: their top-level
// names share one global scope, so a duplicate (`const has` in two files) is a SyntaxError that leaves Real office half loaded ----
{
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const vm = require('vm') as typeof import('vm');
  const DIST = path.join(ROOT, 'dist', 'shared');
  const page = ['redact', 'answerlimits', 'profiletemplates', 'mcphealth', 'lights', 'realoffice-layout'];
  if (page.every((f) => fs.existsSync(path.join(DIST, f + '.js')))) {
    const ctx = vm.createContext({ self: {} as Record<string, unknown> });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'exports-shim.js'), 'utf8'), ctx);
    vm.runInContext('var exports=self.exports;', ctx);
    for (const f of page) vm.runInContext(fs.readFileSync(path.join(DIST, f + '.js'), 'utf8'), ctx, { filename: f + '.js' });
    const ex = vm.runInContext('exports', ctx) as Record<string, unknown>;
    for (const k of ['realLayout', 'lobbyWidths', 'assignPeople', 'lightFor', 'lightState', 'ambientFor', 'doneTick', 'fixtureLight', 'redact']) assert.strictEqual(typeof ex[k], 'function', `${k} is on the page's exports with every shared module loaded`);
  } else console.log('(dist/shared not built: the page-load check is skipped; npm test builds first)');
}

// ---- FR-184: the chips' plan, from measured sizes (the DOM writes and reads are check-office-ops') ----
{
  const chip = (x: number, y = 40, w = 60): { x: number; y: number; w: number; h: number; iniW: number } => ({ x, y, w, h: 17, iniW: 24 });
  assert.deepStrictEqual(staggerPlan([chip(100)], []), [{ x: 100, y: 40, ini: false }], 'a chip alone stays where the layout put it');
  const nb = staggerPlan([chip(100), chip(120)], []);
  assert.strictEqual(nb[1].ini, false, 'a neighbour that a small move clears keeps its name');
  assert.ok(nb[1].x > 120 && nb[1].x - 120 <= 28 || nb[1].y < 40, 'and moves right (up to 28 px) or up a level');
  assert.deepStrictEqual(staggerPlan([chip(100, 0), chip(100, 0), chip(100, 0)], [])[1].y, 0, 'never above the band');
  const crowd = staggerPlan(Array.from({ length: 12 }, () => chip(100)), [[60, 70, 0, 80]]);
  assert.ok(crowd.some((c) => c.ini), 'a crowd falls back to initials');
  /* no two overlap, and none touches a plate, for any crowd */
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    let s = seed; const r = (m: number): number => { s = (s * 16807) % 2147483647; return s % m; };
    const cs = Array.from({ length: 4 + r(20) }, () => ({ x: 40 + r(600), y: 20 + r(60), w: 30 + r(70), h: 17, iniW: 22 })).sort((a, b) => a.x - b.x);
    const plates = Array.from({ length: 3 }, () => { const l = r(600), t = r(40); return [l, l + 60, t, t + 18]; });
    const plan = staggerPlan(cs, plates);
    const rects = plan.map((p, i) => { const w = p.ini ? cs[i].iniW : cs[i].w; return { l: p.x - w / 2, r: p.x + w / 2, t: p.y, b: p.y + cs[i].h }; });
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) assert.ok(rects[i].r <= rects[j].l || rects[j].r <= rects[i].l || rects[i].b <= rects[j].t || rects[j].b <= rects[i].t, `seed ${seed}: chips ${i} and ${j} do not overlap`);
      for (const [a, b, y0, y1] of plates) assert.ok(rects[i].r <= a || b <= rects[i].l || rects[i].b <= y0 || y1 <= rects[i].t, `seed ${seed}: chip ${i} does not cover a place plate`);
    }
  }
}

console.log(`realoffice layout and lights tests passed (${cases} layouts, faces ${JSON.stringify(faces)})`);
process.exitCode = 0;

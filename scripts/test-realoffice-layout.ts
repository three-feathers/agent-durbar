/** Spec 097 T013, T014, T017: the Real office layout engine (FR-010..FR-027, SC-002, SC-007), the lights (FR-041..FR-052) and the
 *  Characters plumbing (FR-084). Pure functions only, plain Node, no DOM, no credits. `npm run test:realoffice-layout`. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { placeBox, portraitCrop, PORTRAIT_SIDE, slipAvoid, NOTE_PAPER, NOTE_PAPER_DEFAULT, NOTE_INK, notePaper, screenFit, screenFor, personMotion, zoomRect, realLayout, lobbyWidths, sortDesks, assignPeople, standPose, standHeight, POSE_FRAME_B, lobbyRange, PERSON_M, DOOR_M, FRONT_DEPTH, NEAR_SCALE, CHIP_H, U_MIN, U_MAX, U_MAX_BIG, FACE_U, PLATE_H, PLATE_H_ASK, STRIP,
  type RealModel, type RealMeta, type RealAgent, type RealState, type Rect, type Layout } from '../src/shared/realoffice-layout';
import { lobbyBand, lobbyScale, visitorScale } from '../src/shared/realoffice-layout';
import { createHash } from 'crypto';
import { lampWords, lightFor, lightState, LIGHT_TABLE, ambientFor, doneTick, fixtureLight, isActive, type LightState } from '../src/shared/lights';

process.exitCode = 1;
const ROOT = (() => { let d = __dirname; while (!fs.existsSync(path.join(d, 'package.json'))) d = path.dirname(d); return d; })();
const RO = path.join(ROOT, 'src', 'renderer', 'realoffice');
const readJson = (...p: string[]): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(RO, ...p), 'utf8'));
/** what realoffice.js hands the engine: a world's furniture numbers with a set's people numbers */
const META = { ...readJson('worlds', 'photo', 'world.json'), ...readJson('sets', 'office', 'set.json') } as unknown as RealMeta;
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
  const aways: Rect[] = L.zones.flatMap((z) => z.desks.filter((d) => d.away).map((d) => ({ x: d.away!.x - d.away!.s / 2, y: d.away!.y, w: d.away!.s, h: d.away!.s })));
  const all: [string, Rect[]][] = [['plate', plates], ['sign', signs], ['screen', screens], ['person', persons], ['away label', aways]];
  for (let i = 0; i < all.length; i++) for (let j = i; j < all.length; j++) for (let p = 0; p < all[i][1].length; p++) for (let q = i === j ? p + 1 : 0; q < all[j][1].length; q++)
    if (!(all[j][0] === 'away label' && (all[i][0] === 'screen' || all[i][0] === 'sign')) && inter(all[i][1][p], all[j][1][q], 1)) out.push(`${all[i][0]} ${p} overlaps ${all[j][0]} ${q}`); /* a note may lie on a screen's edge or under a sign, as a note does (spec Changes 2026-11-01) */
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
  if (W < 1000 && n > 15) continue; /* the chat is full-window (the office steps aside), so a narrow office beside it holds at most the 15-agent scale; away desks no longer narrow (owner 2026-11-01), so 20 or more asleep and away desks at 810 px have no room for a 40 px plate */
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
/* SC-002's 40 px is not met: a [KNOWN GAP] in spec 097; this is a ratchet so it never gets worse. Lowered 2026-11-01 from 35: an empty desk keeps its slot, so this is what everyone at a desk gets, owner decision for a room that stays still */
const FACE_FLOOR = Number(process.env.REALOFFICE_FACE_MIN || 31);
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

// ---- spec Changes 2026-11-01: an away or asleep desk keeps its slot and its screen; an away one has no person and says where; an asleep one rests at its desk in the dark (FR-120, FR-129) ----
{
  const m = model(6, 1, { away: false, states: ['working'] });
  m.folders[0].agents[1].away = 'library'; m.folders[0].agents[2].state = 'asleep';
  const L = realLayout(m, { w: 1440, h: 848 }, META);
  const d = Object.fromEntries(L.zones[0].desks.map((x) => [x.id, x]));
  const mu = JSON.parse(JSON.stringify(m)) as RealModel; mu.folders[0].agents[2].state = 'done'; /* the same agent while its message is unread: a Done desk (shutters.js never lets an unread reply sleep) */
  const Lu = realLayout(mu, { w: 1440, h: 848 }, META), du = Object.fromEntries(Lu.zones[0].desks.map((x) => [x.id, x]));
  assert.ok(d.a1.slot.w === d.a0.slot.w && du.a2.slot.w === du.a0.slot.w, 'an away desk and a Done desk (the unread message) keep their width');
  const m0 = model(6, 1, { away: false, states: ['working'] }); m0.folders[0].agents[2].state = 'done'; const L0 = realLayout(m0, { w: 1440, h: 848 }, META), d0 = L0.zones[0].desks.find((x) => x.id === 'a1')!;
  assert.deepStrictEqual([du.a1.slot, du.a1.screen, du.a1.plate, du.a1.desk], [d0.slot, d0.screen, d0.plate, d0.desk], 'someone leaving moves nothing: slot, screen, plate and desk as when they sat');
  /* spec 097 FR-246 (owner 2026-11-06, issue #1220): the asleep desk's 0.62 width is gone (an asleep agent sits in the lounge row, tested below); an asleep agent the app leaves at a desk keeps a full one */
  assert.ok(Math.abs(d.a2.slot.w / d.a0.slot.w - 1) < 0.001 && d.a2.person && !d.a2.away, 'an asleep agent at a desk keeps a full desk, its person resting at it');
  assert.ok(Math.abs(du.a2.slot.w / du.a0.slot.w - 1) < 0.001, 'unread (Done): full width');
  const keep = (l: ReturnType<typeof realLayout>): string => JSON.stringify(l.zones.flatMap((z) => z.desks.map((x) => [x.id, x.slot.w])).sort());
  const lu2 = JSON.parse(JSON.stringify(mu)) as RealModel; lu2.folders[0].agents[1].away = null; 
  assert.strictEqual(keep(realLayout(lu2, { w: 1440, h: 848 }, META)), keep(Lu), 'a person coming back or a state change moves no width: only the read does');
  assert.ok(!d.a1.person && d.a1.away && d.a2.person && !d.a2.away && d.a0.person, 'no person at an away desk, which says where; an asleep desk keeps its person (FR-129)');
  assert.strictEqual(d.a2.person!.pose, 'rest', 'an asleep person rests (FR-120, FR-129)');
  assert.strictEqual(d.a2.state, 'asleep');
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
  assert.ok(lobbyFace >= 10.5 /* from 11, 2026-11-01: full-width desks leave the lobby a little less */, `FR-024 ratchet: lobby faces (estimate: 0.13 of a 1.7 m person) ${lobbyFace}`);
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
  { const f = term.fig!, b = f.b!, st = META.stand.p03; const footA = f.x + st.foot!.runA * f.w, footB = b.x + st.foot!.runB * b.w, feetA = f.y + st.feet!.runA * f.h, feetB = b.y + st.feet!.runB * b.h;
    assert.ok(Math.abs(footA - footB) < 0.01 && Math.abs(feetA - feetB) < 0.01, `changing picture moves no foot: ${footA} ${footB}, ${feetA} ${feetB}`); }
  assert.ok(Math.abs(term.fig!.feetY - front) <= 0.5, 'the Terminal visitor stands on the front floor plane');
  const sr = META.stand.p03, tf = (sr.feet as Record<string, number>).runA, tt = (sr.top as Record<string, number>).runA;
  assert.ok(Math.abs(term.fig!.y + term.fig!.h * tf - front) <= 2, `the runner's lowest foot is on the front floor plane at ${W} (within 2 px)`);
  const runTall = term.fig!.h * (tf - tt), upTall = (L.fixtures.find((f) => f.id === 'terminal')!.visitors[0].fig!.h / sr.poses.runA[1]) * standHeight(META, 'p03');
  assert.ok(runTall / upTall > 0.9 && runTall / upTall < 1.0, `a runner is a little shorter than upright (bent knees): ${(runTall / upTall).toFixed(3)}`);
}
// ---- the running pose: every person has both strides, measured, at one scale, each picture in its own box with the feet in one place ----
assert.strictEqual(POSE_FRAME_B.runA, 'runB', 'stride B of the running pose');
for (const pid of PEOPLE) {
  const st = META.stand[pid];
  for (const p of ['runA', 'runB']) assert.ok(Array.isArray(st.poses[p]) && st.feet && st.feet[p] > 0.9 && st.top && st.top[p] < 0.1, `${pid} has a measured ${p}`);
  const a = st.poses.runA, b = st.poses.runB, fa = st.feet!.runA, fb = st.feet!.runB;
  assert.ok(Math.abs(a[1] * fa - b[1] * fb) / (a[1] * fa) < 0.03, `${pid}: both strides stand as tall (${a[1] * fa} and ${b[1] * fb}), so P2's swap does not jump`);
  assert.strictEqual(standPose(META, pid, 'terminal', false)!.pose, 'runA', `${pid} runs at the Terminal`);
}
{
  const noRun = JSON.parse(JSON.stringify(META)) as RealMeta; delete noRun.stand.p01.poses.runA;
  assert.strictEqual(standPose(noRun, 'p01', 'terminal', false)!.pose, 'letter', 'a person without the running picture stands (letter)');
}
// the anchor uses the measured foot line and foot centre, not the picture's box: a three-quarter view has its feet well off the box's middle
assert.ok(Object.values(META.stand).some((s) => Object.values(s.foot as Record<string, number>).some((f) => Math.abs(f - 0.5) > 0.2)), 'some picture has its feet far off the middle (so a box-centred anchor would be wrong)');

// ---- FR-024, FR-191: stand poses and fallbacks ----
{
  for (const [place, pose] of Object.entries({ library: 'book', software: 'book', terminal: 'runA', web: 'type', boss: 'knock', coffee: 'counter', bank: 'counter', postbox: 'letter', other: 'type' })) assert.strictEqual(standPose(META, 'p01', place, false)!.pose, pose, `${place}: ${pose}`);
  assert.strictEqual(standPose(META, 'p01', 'c-abc', true)!.pose, 'letter', 'a custom place: wait, else letter');
  const noBook = JSON.parse(JSON.stringify(META)) as RealMeta; delete noBook.stand.p01.poses.book;
  assert.strictEqual(standPose(noBook, 'p01', 'library', false), null, 'a pose with no fallback and no picture: no figure (the initials disc stays)');
  assert.strictEqual(standPose(META, 'nobody', 'library', false), null);
  assert.strictEqual(standPose(META, '__proto__', 'library', false), null, 'own keys only');
}

// ---- FR-191: visitors face their fixture; the pictures face left, so every visitor stands to the right of its fixture ----
{
  assert.strictEqual(META.facing, 'left', 'the pictures are baked facing left');
  for (const pid of PEOPLE) for (const [p, f] of Object.entries(META.stand[pid].foot || {})) assert.ok(f > 0.2 && f < 0.9, `${pid} ${p}: the foot centre is inside the picture (${f})`);
  for (const pid of PEOPLE) for (const p of Object.keys(META.stand[pid].poses)) assert.ok(META.stand[pid].foot && p in (META.stand[pid].foot as object), `${pid} ${p} has a measured foot centre`);
  for (const [W, H] of [[1440, 900], [1280, 800]]) {
    const m = model(15, 4);
    m.places = ['library', 'software', 'terminal', 'web', 'boss', 'coffee', 'bank', 'postbox', 'other'].map((id, i) => ({ id, visitors: [{ id: 'v' + i, person: PEOPLE[i] }, { id: 'w' + i, person: PEOPLE[(i + 5) % 15] }] }));
    const L = realLayout(m, { w: W, h: H }, META);
    let n = 0;
    for (const f of L.fixtures) for (const v of f.visitors) if (v.fig && f.art) {
      n++;
      assert.strictEqual(v.fig.faces, 'left', `${v.id} at ${f.id} faces left`);
      assert.ok(Math.abs(v.fig.x + (META.stand[String(m.places.flatMap((p) => p.visitors).find((x) => x.id === v.id)!.person)].foot as Record<string, number>)[v.fig.pose] * v.fig.w - v.chip.x) < 0.5, `${v.id}: the planted feet are where its chip and shadow are, not the middle of the picture`);
      const feetX = v.fig.x + (META.stand[String(m.places.flatMap((p) => p.visitors).find((x) => x.id === v.id)!.person)].foot as Record<string, number>)[v.fig.pose] * v.fig.w;
      assert.ok(feetX > f.art.x + f.art.w / 2, `${v.id} at ${f.id} stands to the right of the fixture's middle (${feetX.toFixed(0)} vs ${(f.art.x + f.art.w / 2).toFixed(0)}), so facing left faces the fixture`);
    }
    assert.ok(n >= 12, `visitors checked at ${W}: ${n}`);
  }
  /* a picture set that faced right would be wrong for every visitor: the check reads the meta, not the code path */
  const flipped = JSON.parse(JSON.stringify(META)) as RealMeta; flipped.facing = 'right';
  const bare = JSON.parse(JSON.stringify(META)) as RealMeta; delete bare.facing;
  assert.strictEqual(realLayout(model(15, 4), { w: 1440, h: 900 }, bare).fixtures.flatMap((f) => f.visitors).find((v) => v.fig)!.fig!.faces, 'left', 'no `facing` in people.json: the shipped pictures face left');
  assert.strictEqual(realLayout(model(15, 4), { w: 1440, h: 900 }, flipped).fixtures.flatMap((f) => f.visitors).find((v) => v.fig)!.fig!.faces, 'right', 'red: the side follows the meta');
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

// ---- spec 102 FR-200..FR-202: the world and set seam in crew.js (two flat lists of data, any set in any world) ----
{
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const C = require(path.join(ROOT, 'src', 'renderer', 'crew.js')) as unknown as { WORLD_FLAGS: Record<string, boolean>;  WORLDS: { id: string; name: string; defaultSet: string; flag?: string }[]; REAL_SETS: { id: string; name: string; choice: string; flag?: string }[]; offeredWorlds: (f?: Record<string, boolean>) => { id: string }[]; parseWorld: (v: unknown, f?: Record<string, boolean>) => string; peopleFor: (w: unknown, c: unknown, f?: Record<string, boolean>) => { world: string; set: string; setName: string; note: string }; levelFor: (c: unknown, f?: Record<string, boolean>) => string; CREWS: Record<string, unknown> };
  assert.deepStrictEqual(C.WORLD_FLAGS, { cave: false, retro: false }, 'the cave is behind an off-by-default flag until the owner opens it (spec 097 phase 4 gate)');
  assert.deepStrictEqual(C.offeredWorlds().map((w) => w.id), ['photo'], 'flag off: only Photo office is offered');
  assert.deepStrictEqual(C.offeredWorlds({ cave: true }).map((w) => w.id), ['photo', 'cave'], 'flag on: Photo office first, then the cave');
  assert.deepStrictEqual(C.REAL_SETS.map((s) => s.id), ['office', 'prehistoric', 'retro'], 'the sets with Real office poses');
  assert.deepStrictEqual(C.peopleFor('cave', 'theme', { cave: true }), { world: 'cave', set: 'prehistoric', setName: 'Prehistoric', note: '' }, "the cave's default set is Prehistoric");
  assert.deepStrictEqual(C.peopleFor('cave', 'theme', { cave: false }), { world: 'photo', set: 'office', setName: 'Office people', note: '' }, 'flag off: the cave is not drawn');
  assert.strictEqual(C.peopleFor('photo', 'prehistoric', { cave: true }).set, 'prehistoric', 'any set in any world: Prehistoric in the Photo office');
  assert.strictEqual(C.peopleFor('photo', 'prehistoric', { cave: false }).set, 'prehistoric', 'Q12 (owner 2026-11-08): the full Prehistoric set is drawn in the Photo office with the cave closed');
  assert.ok(!C.REAL_SETS.find((x) => x.id === 'prehistoric')!.flag, 'Q12: the Prehistoric row has no flag (re-coupling it to the cave fails here)');
  assert.deepStrictEqual(C.offeredWorlds({ cave: false }).map((w) => w.id), ['photo'], 'Q12: the cave world stays closed with its flag');
  // the lists are data: a flagged world with its own default set is added by rows alone (a Pirate world later changes no code)
  C.WORLDS.push({ id: 'pirate', name: 'Pirate ship', defaultSet: 'pirates', flag: 'pirate' });
  C.REAL_SETS.push({ id: 'pirates', name: 'Pirates', choice: 'pirates', flag: 'pirate' });
  (C.WORLD_FLAGS as Record<string, boolean>).pirate = false;
  const ON: Record<string, boolean> = { pirate: true }, OFF: Record<string, boolean> = { pirate: false };
  try {
    assert.deepStrictEqual(C.offeredWorlds(OFF).map((w) => w.id), ['photo'], 'flag off: only Photo office is offered');
    assert.deepStrictEqual(C.offeredWorlds(ON).map((w) => w.id), ['photo', 'pirate'], 'flag on: both, Photo office first');
    for (const w of C.WORLDS) assert.ok(C.REAL_SETS.some((s) => s.id === w.defaultSet), `${w.id}: its default set is in the list of sets`);
    for (const r of [...C.WORLDS, ...C.REAL_SETS]) if (r.flag) assert.ok(r.flag in C.WORLD_FLAGS, `${r.id}: its flag exists`);
    for (const v of ['pirate', 'loft', '', null, undefined, 3, '__proto__', 'match']) assert.strictEqual(C.parseWorld(v, OFF), 'photo', `${String(v)}: Photo office while the flag is off`);
    assert.strictEqual(C.parseWorld('pirate', ON), 'pirate');
    /* spec 102: a stored `retro` is the Photo office and its people while the flag is closed */
    assert.strictEqual(C.parseWorld('retro'), 'photo', 'retro falls back while its flag is closed');
    assert.ok(!C.offeredWorlds().some((w) => w.id === 'retro'), 'retro is not offered while its flag is closed');
    assert.strictEqual(C.peopleFor('retro', 'match').world, 'photo', 'and its people follow the Photo office');
    assert.strictEqual(C.parseWorld('retro', { retro: true }), 'retro', 'open flag: retro');
    assert.ok(C.offeredWorlds({ retro: true }).some((w) => w.id === 'retro'), 'open flag: offered');
    assert.strictEqual(C.peopleFor('retro', 'match', { retro: true }).world, 'retro', 'open flag: its own people');
    for (const v of ['', null, '__proto__', 'constructor', 'toString']) assert.strictEqual(C.parseWorld(v, ON), 'photo');
    for (const f of [OFF, ON]) for (const w of ['photo', 'pirate', 'bogus', '']) for (const c of ['theme', 'minimalist', 'cheeky', 'pirates', 'prehistoric', 'mine', '', '__proto__', 'office']) {
      const r = C.peopleFor(w, c, f), world = C.parseWorld(w, f), row = C.WORLDS.find((x) => x.id === world)!;
      assert.strictEqual(r.world, world, 'the world is the parsed one');
      assert.ok(C.REAL_SETS.some((s) => s.id === r.set && (!s.flag || f[s.flag])), `${w}/${c}: only an installed set is drawn`);
      const explicit = C.REAL_SETS.find((s) => s.choice === c && c && (!s.flag || f[s.flag]));
      const defRow = C.REAL_SETS.find((s) => s.id === row.defaultSet)!, def = !defRow.flag || f[defRow.flag] ? defRow.id : 'office';
      assert.strictEqual(r.set, explicit ? explicit.id : def, `${w}/${c}: an explicit full set wins in any world, else the world's default, else Office people`);
    }
    assert.deepStrictEqual(C.peopleFor('photo', 'theme', OFF), { world: 'photo', set: 'office', setName: 'Office people', note: '' });
    assert.deepStrictEqual(C.peopleFor('pirate', 'theme', ON), { world: 'pirate', set: 'pirates', setName: 'Pirates', note: '' }, "a world's default set");
    assert.strictEqual(C.peopleFor('photo', 'pirates', ON).set, 'pirates', 'any set in any world');
    assert.strictEqual(C.peopleFor('photo', 'pirates', OFF).set, 'office', 'flag off: the set is not drawn');
  } finally { C.WORLDS.pop(); C.REAL_SETS.pop(); delete (C.WORLD_FLAGS as Record<string, boolean>).pirate; }
  // FR-083 / FR-202: the note (peopleFor's), for a crew choice with no Real office poses; the names come from CREWS, so every crew without a REAL_SETS row has one
  const note = (c: string): string => C.peopleFor('photo', c).note;
  for (const c of ['minimalist', ...Object.keys(C.CREWS)]) if (!C.REAL_SETS.some((s) => s.choice === c)) assert.strictEqual(note(c), `Real office shows Office people until ${c[0].toUpperCase() + c.slice(1)} has Real office poses.`, `${c}: has its note`);
  for (const c of ['theme', 'mine', '', '__proto__', 'constructor', 'office']) assert.strictEqual(note(c), '', `${c || '(none)'}: no note`);
  assert.strictEqual(note('prehistoric'), 'Real office draws the Prehistoric people.', 'Q12: Prehistoric draws its own people, and Settings says so');
  { // FR-336 `closed` stays for any set row whose flag is off (here a crew's, temporarily)
    C.REAL_SETS.push({ id: 'royals', name: 'Royals', choice: 'royal', flag: 'cave' });
    try {
      assert.strictEqual(C.levelFor('royal', { cave: false }), 'closed'); assert.strictEqual(C.levelFor('royal', { cave: true }), 'full');
      assert.strictEqual(note('royal'), 'Real office shows Office people until Royal is open in Real office.', 'FR-336: a set with poses behind a closed flag says it is not open');
    } finally { C.REAL_SETS.pop(); }
  }
  // spec 097 FR-335, FR-336: every Characters value resolves to one set, with a level and a true note (issue #1154)
  {
    const CLOSED = { cave: false, retro: false }, OPEN = { cave: true, retro: false };
    const want: Record<string, [string, string, string, string]> = { // choice: [level closed, level open, set closed, set open]
      theme: ['default', 'default', 'office', 'office'], '': ['default', 'default', 'office', 'office'], mine: ['default', 'default', 'office', 'office'],
      minimalist: ['heads', 'heads', 'office', 'office'], cheeky: ['heads', 'heads', 'office', 'office'], pirate: ['heads', 'heads', 'office', 'office'],
      monster: ['heads', 'heads', 'office', 'office'], royal: ['heads', 'heads', 'office', 'office'], rebels: ['heads', 'heads', 'office', 'office'],
      prehistoric: ['full', 'full', 'prehistoric', 'prehistoric'],
    };
    for (const [c, [lc, lo, sc, so]] of Object.entries(want)) {
      assert.strictEqual(C.levelFor(c, CLOSED), lc, `${c || '(none)'}: level, gate closed`); assert.strictEqual(C.levelFor(c, OPEN), lo, `${c || '(none)'}: level, gate open`);
      assert.strictEqual(C.peopleFor('photo', c, CLOSED).set, sc, `${c || '(none)'}: set, gate closed`); assert.strictEqual(C.peopleFor('photo', c, OPEN).set, so, `${c || '(none)'}: set, gate open`);
      assert.strictEqual(C.peopleFor('photo', c, OPEN).note === '', lo === 'default', `${c || '(none)'}: no note only for the default; a crew always gets a line`);
    }
    for (const c of Object.keys(C.CREWS)) assert.ok(c in want, `${c}: every crew is in this table, so a new crew must be decided here`);
    for (const c of ['__proto__', 'constructor', 'toString', 'office', 'nonsense']) assert.strictEqual(C.levelFor(c, OPEN), 'default', `${c}: not a crew, no level to report`);
    assert.strictEqual(C.peopleFor('photo', 'retro', { cave: false, retro: true }).set, 'retro', 'a full set outside the crews has its level full');
    assert.strictEqual(C.levelFor('retro', { cave: false, retro: true }), 'full'); assert.strictEqual(C.levelFor('retro', { cave: false, retro: false }), 'closed');
    for (const c of Object.keys(C.CREWS)) assert.ok(!/crew\/art|portrait/i.test(JSON.stringify(C.peopleFor('photo', c, OPEN))), `${c}: Real office names no crew picture`);
  }
  C.CREWS.futurecrew = []; // a future crew (mutant check: a hand list of names would miss it)
  try { assert.strictEqual(note('futurecrew'), 'Real office shows Office people until Futurecrew has Real office poses.', 'a new crew gets its note by construction'); } finally { delete C.CREWS.futurecrew; }
  assert.strictEqual(note('pirate'), 'Real office shows Office people until Pirate has Real office poses.', 'spec 077 FR-074: the Pirate crew has its Real office note');
  assert.strictEqual(note('monster'), 'Real office shows Office people until Monster has Real office poses.', 'spec 077 FR-075: the Monster crew has its Real office note');
  assert.strictEqual(note('royal'), 'Real office shows Office people until Royal has Real office poses.', 'spec 077 FR-076: the Royal crew has its Real office note');
  assert.strictEqual(note('rebels'), 'Real office shows Office people until Rebels has Real office poses.', 'spec 077 FR-077: the Animal Rebels crew has its Real office note (crewName capitalises the id)');
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
  const row = (s: string): string => { const l = lightFor(s); return [l.lamp, l.glow, l.motion, l.tint].join('/'); };
  assert.strictEqual(row('working'), 'warm/on//none');
  assert.strictEqual(row('thinking'), 'on/breathe/breathe/none');
  assert.strictEqual(row('waiting'), 'bright/on//amber');
  assert.strictEqual(row('error'), 'on/on//red', 'FR-236: no red halo, the screen is red');
  assert.strictEqual(row('limit'), 'on/on//orange');
  assert.strictEqual(row('done'), 'low/low//none');
  assert.strictEqual(row('idle'), 'low/low//none');
  assert.strictEqual(row('asleep'), 'off/off//none');
  assert.ok(!('call' in lightFor('waiting')), 'FR-236: no call light');
  // FR-236: the tint precedence (the light state first), green only for a done desk with an unread reply
  for (const k of Object.keys(LIGHT_TABLE) as LightState[]) {
    const want = k === 'done' ? 'green' : LIGHT_TABLE[k].tint;
    assert.strictEqual(lightFor(k, { unread: true }).tint, want, `FR-236: ${k} with an unread reply: ${want}`);
    assert.strictEqual(lightFor(k, { unread: true, still: true }).tint, want, `FR-236: ${k}, unread and still: ${want}`);
  }
  assert.strictEqual(lightFor('waiting', { unread: true }).tint, 'amber', 'FR-236: a new reply never hides a need');
  assert.strictEqual(lightFor('failing', { unread: true }).tint, 'red', 'FR-236: failing is an error');
  assert.strictEqual(lightFor(lightState('waiting', { limit: true }), { unread: true }).tint, 'orange', 'FR-236: limit wins');
  assert.strictEqual(lightFor('done', { unread: false }).tint, 'none', 'FR-236: read: the normal screen');
  // FR-236: every screen-text colour on every tint at least 4.5:1, read from realoffice.css (a changed colour cannot slip by)
  {
    const css = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'realoffice.css'), 'utf8');
    const lin = (v: number): number => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = (h: string): number => { const n = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return 0.2126 * lin(n[0]) + 0.7152 * lin(n[1]) + 0.0722 * lin(n[2]); };
    const ratio = (a: string, b: string): number => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const inks = [...css.matchAll(/--ro-scr-([a-z]+):(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]);
    const tints = [...css.matchAll(/\.ro-screen\.tint-([a-z]+) \.ro-glass\{background:(#[0-9a-f]{6})\}/g)].map((m) => [m[1], m[2]]);
    assert.deepStrictEqual(tints.map((t) => t[0]).sort(), ['amber', 'green', 'orange', 'red'], 'FR-236: four tints in realoffice.css');
    assert.ok(inks.length >= 7, 'the screen-text colours are read');
    const low = tints.flatMap(([t, bg]) => inks.filter(([, c]) => ratio(c, bg) < 4.5).map(([k, c]) => `${k} ${c} on ${t} ${bg}: ${ratio(c, bg).toFixed(2)}`));
    assert.deepStrictEqual(low, [], 'FR-236: every screen-text colour on every tint at 4.5:1 or more');
    /* FR-236: the four tints are told apart: every pair at least 12 apart in CIEDE2000 (orange once sat 7.5 from red and read the same maroon) */
    const toLab = (h: string): number[] => {
      const [r, g, b] = [1, 3, 5].map((i) => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
      const X = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047), Y = f(0.2126 * r + 0.7152 * g + 0.0722 * b), Z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
      return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
    };
    const de00 = (p: string, q: string): number => {
      const [L1, a1, b1] = toLab(p), [L2, a2, b2] = toLab(q), rad = Math.PI / 180;
      const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2, G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
      const A1 = (1 + G) * a1, A2 = (1 + G) * a2, C1 = Math.hypot(A1, b1), C2 = Math.hypot(A2, b2);
      const hue = (x: number, y: number): number => { const v = Math.atan2(y, x) / rad; return v < 0 ? v + 360 : v; };
      const h1 = hue(A1, b1), h2 = hue(A2, b2);
      let dh = h2 - h1; if (C1 * C2 === 0) dh = 0; else if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
      const dL = L2 - L1, dC = C2 - C1, dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh / 2) * rad), Lb = (L1 + L2) / 2, Cp = (C1 + C2) / 2;
      const hb = C1 * C2 === 0 ? h1 + h2 : Math.abs(h1 - h2) > 180 ? (h1 + h2 + 360) / 2 : (h1 + h2) / 2;
      const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
      const RT = -Math.sin(2 * 30 * Math.exp(-(((hb - 275) / 25) ** 2)) * rad) * 2 * Math.sqrt(Cp ** 7 / (Cp ** 7 + 25 ** 7));
      const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2), SC = 1 + 0.045 * Cp, SH = 1 + 0.015 * Cp * T;
      return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
    };
    assert.ok(Math.abs(de00('#000000', '#ffffff') - 100) < 0.01, 'CIEDE2000: black to white is 100');
    const near = tints.flatMap(([t, a], i) => tints.slice(i + 1).filter(([, b]) => de00(a, b) < 12).map(([u, b]) => `${t} ${a} to ${u} ${b}: ${de00(a, b).toFixed(1)}`));
    assert.deepStrictEqual(near, [], 'FR-236: every pair of tints at least 12 apart (CIEDE2000), so orange never reads as red or amber');
    const arcade = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'realoffice', 'worlds', 'retro', 'world.css'), 'utf8');
    const arcTints = [...arcade.matchAll(/\.ro-screen\.tint-([a-z]+) \.ro-glass\{background-color:(#[0-9a-f]{6})\}/g)].map((m) => [m[1], m[2]]);
    assert.deepStrictEqual(Object.fromEntries(arcTints), Object.fromEntries(tints), 'FR-236: the arcade tints its screens with the same colours (the same contrast)');
  }
  assert.strictEqual(lightState('compacting'), 'thinking'); assert.strictEqual(lightState('retrying'), 'thinking');
  assert.strictEqual(lightState('failing'), 'error'); assert.strictEqual(lightState('working', { paused: true }), 'idle');
  assert.strictEqual(lightState('waiting', { limit: true }), 'limit', 'limit wins over waiting');
  assert.strictEqual(lightState('error', { asleep: true }), 'asleep');
  assert.strictEqual(lightState('toString'), 'idle', 'own keys only'); assert.strictEqual(lightState('nonsense'), 'idle');
  for (const s of STATES) assert.strictEqual(lightFor(s, { still: true }).motion, null, `FR-047: ${s} still under reduced motion or Motion off`);
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
    for (const k of ['screenFor', 'screenFit', 'personMotion', 'zoomRect', 'realLayout', 'lobbyWidths', 'assignPeople', 'lightFor', 'lightState', 'ambientFor', 'doneTick', 'fixtureLight', 'redact']) assert.strictEqual(typeof ex[k], 'function', `${k} is on the page's exports with every shared module loaded`);
  } else console.log('(dist/shared not built: the page-load check is skipped; npm test builds first)');
}

// ---- a still room: the head room of the one raised hand: a waiting agent leaving for a place changes no desk of its row ----
{
  const m = model(6, 1, { away: false, states: ['working'] });
  /* the head room comes from the tallest sitter's headTop/bodyH: the agent that leaves is the tallest of its row, everyone else the lowest */
  const rise = (p: string): number => META.seat[p].headTop / META.seat[p].bodyH;
  const byRise = PEOPLE.slice().sort((p, q) => rise(q) - rise(p));
  m.folders[0].agents.forEach((x, i) => { x.person = i === 0 ? byRise[0] : byRise[byRise.length - 1]; });
  assert.ok(rise(byRise[0]) > rise(byRise[byRise.length - 1]) + 0.01, 'the art has sitters of different height');
  const strip = (l: ReturnType<typeof realLayout>): string => JSON.stringify([l.height, l.zones.map((z) => [z.box, z.desks.map((d) => [d.id, d.slot, d.desk, d.plate])])]);
  const before = strip(realLayout(m, { w: 1440, h: 848 }, META));
  const gone = JSON.parse(JSON.stringify(m)) as RealModel; gone.folders[0].agents[0].away = 'boss';
  assert.strictEqual(strip(realLayout(gone, { w: 1440, h: 848 }, META)), before, 'the raised hand of an agent that left still has its head room: no row moves');
}

// ---- spec 097 FR-121, review of #994: a slip never covers the post-it on an empty seat (the note's real box, 66 to 112 px square, not a one-line label) ----
{
  for (const [W, H] of SIZES.slice(0, 2)) for (const n of [3, 15]) {
    const m = model(n, 3, { away: false });
    const flat = m.folders.flatMap((f) => f.agents); flat[0].away = 'library'; flat[1].away = 'terminal';
    const L = realLayout(m, { w: W, h: H }, META), av = slipAvoid(L);
    const notes = L.zones.flatMap((z) => z.desks).filter((d) => d.away);
    assert.strictEqual(notes.length, 2);
    for (const d of notes) {
      const s = d.away!.s, box = { x: d.away!.x - s / 2, y: d.away!.y, w: s, h: s };
      assert.ok(av.some((r) => r.x <= box.x + 0.5 && r.y <= box.y + 0.5 && r.x + r.w >= box.x + box.w - 0.5 && r.y + r.h >= box.y + box.h - 0.5), `the post-it of ${d.id} (${s}px) is wholly on the avoid list at ${W}x${H} with ${n} agents`);
    }
    for (const z of L.zones) for (const d of z.desks) assert.ok(av.some((r) => r === d.plate) && (!d.face || av.includes(d.face)), 'plates and faces stay on the avoid list');
  }
}

// ---- spec 097 FR-246, FR-247 (owner 2026-11-06, issue #1220): finished, read agents sit in the lounge row ----
/** n agents over f folders, none away; `nl` of them sit in the lounge (never a folder's first agent: the room rule keeps one at a desk), done and asleep by turns */
function loungeModel(n: number, f: number, nl: number): RealModel {
  const m = model(n, f, { away: false, states: ['working', 'waiting', 'thinking', 'error', 'done', 'idle'] });
  let left = nl;
  for (let k = 1; left > 0 && k < n; k++) for (const fo of m.folders) if (left > 0 && fo.agents[k]) { fo.agents[k].lounge = true; fo.agents[k].state = left % 2 ? 'done' : 'asleep'; left--; }
  return m;
}
/** what a lounge seat must never do, as sentences: leave the floor or its seat, sit over the desk rows, cover a sign, plate, screen or face, or be too small to read */
function loungeProblems(L: Layout, W: number): string[] {
  const out: string[] = [], seats = L.lounge ? L.lounge.desks : [];
  const floor = { x: 0, y: 0, w: W, h: L.height }, rowsEnd = Math.max(L.lobbyH, ...L.zones.map((z) => z.box.y + z.box.h));
  const desk = L.zones.flatMap((z) => [z.sign, ...z.desks.flatMap((d) => [d.plate, d.screen, d.desk, ...(d.face ? [d.face] : [])])]);
  seats.forEach((s, i) => {
    if (!s.lounge || !s.table) out.push(`seat ${s.id} is not a lounge seat`);
    for (const [nm, r] of [['plate', s.plate], ['screen', s.screen], ['table', s.table], ['face', s.face], ['slot', s.slot]] as [string, Rect | null | undefined][]) if (r && !inside(r, floor)) out.push(`${nm} of seat ${s.id} leaves the floor`);
    if (s.slot.y < rowsEnd - 0.5) out.push(`seat ${s.id} at y ${Math.round(s.slot.y)} is over the desk rows (to ${Math.round(rowsEnd)})`);
    for (const r of desk) for (const [nm, q] of [['plate', s.plate], ['screen', s.screen], ['face', s.face], ['person', s.person && s.person.vis]] as [string, Rect | null][]) if (q && inter(q, r, 0.5)) out.push(`${nm} of seat ${s.id} overlaps a desk row`);
    if (!s.face) out.push(`seat ${s.id} has no face box`);
    else {
      if (inter(s.face, s.screen, 0.5)) out.push(`face of seat ${s.id} under its monitor`);
      if (inter(s.face, s.table as Rect, 0.5)) out.push(`face of seat ${s.id} behind its small desk`);
      if (inter(s.face, s.plate, 0.5)) out.push(`plate of seat ${s.id} covers its face`);
      if (s.face.h < 24 - 1e-9) out.push(`face of seat ${s.id} is ${s.face.h}px, under 24`);
    }
    if (!inside(s.screen, s.slot) || !inside(s.table as Rect, s.slot) || !inside(s.plate, s.slot)) out.push(`a part of seat ${s.id} leaves its seat`);
    if (s.plate.w < 84) out.push(`plate of seat ${s.id} is ${s.plate.w}px: a name of nine characters needs 84`);
    if (s.plate.h < PLATE_H_ASK) out.push(`plate of seat ${s.id} has no room for its two lines`);
    seats.forEach((o, j) => { if (j > i && inter(s.slot, o.slot, 0.5)) out.push(`seats ${s.id} and ${o.id} overlap`); for (const q of [o.plate, o.screen, o.face as Rect]) if (j !== i && inter(s.plate, q, 0.5)) out.push(`plate of seat ${s.id} on seat ${o.id}`); });
  });
  return out;
}
{
  /* who: the app marks the agent (shutPlan); the engine seats exactly those, never one away at a place; a done agent with an unread reply is not marked and keeps its desk */
  const m = model(6, 2, { away: false, states: ['working'] }); /* f0: a0 a2 a4, f1: a1 a3 a5 */
  const ag = (id: string): RealAgent => m.folders.flatMap((f) => f.agents).find((a) => a.id === id)!;
  Object.assign(ag('a2'), { state: 'done', lounge: true }); Object.assign(ag('a4'), { state: 'done' }); Object.assign(ag('a3'), { state: 'asleep', lounge: true }); Object.assign(ag('a5'), { lounge: true, away: 'boss' });
  for (const [W, H] of SIZES.slice(0, 2)) {
    const L = realLayout(m, { w: W, h: H }, META), desks = L.zones.flatMap((z) => z.desks), seats = L.lounge ? L.lounge.desks : [];
    assert.deepStrictEqual(seats.map((d) => d.id), ['a2', 'a3'], `FR-246: the done and read agent, then the asleep one, sit in the lounge (status order) at ${W}x${H}`);
    assert.deepStrictEqual(desks.map((d) => d.id).sort(), ['a0', 'a1', 'a4', 'a5'], `FR-246: working, done-unread and away agents keep their desks at ${W}x${H}`);
    assert.ok(desks.every((d) => Math.abs(d.slot.w - desks[0].slot.w) < 0.001), 'every desk keeps the full width (no 0.62 desk)');
    assert.deepStrictEqual(seats.map((d) => [d.state, d.person && d.person.pose, d.lounge]), [['done', 'rest', true], ['asleep', 'rest', true]], 'FR-247: each sits in its own seated rest picture (on its chair)');
    assert.deepStrictEqual(loungeProblems(L, W), [], `FR-247 at ${W}x${H}`);
    assert.ok(seats.every((d) => d.slot.w === seats[0].slot.w), 'one seat width');
    assert.ok(L.lounge && L.lounge.box.y + L.lounge.box.h <= L.height + 0.5 && !L.scroll, 'the row is inside the floor, nothing scrolls');
    assert.ok(slipAvoid(L).some((r) => r === seats[0].plate) && slipAvoid(L).some((r) => r === seats[0].face), 'FR-110: a slip avoids a seat\'s plate and face');
  }
  const none = realLayout(model(6, 2, { away: false }), { w: 1440, h: 848 }, META);
  assert.strictEqual(none.lounge, undefined, 'no lounge agent: no row, the layout is as before');
}
let lcases = 0;
for (const [W, H] of SIZES) for (const n of [2, 3, 4, 5, 8, 12, 15, 20, 30, 40]) for (const f of [1, 2, 3, 4, 6, 8]) {
  if (f >= n || (W < 1000 && n > 15)) continue;
  for (const nl of [...new Set([1, Math.floor(n / 3), n - f])].filter((x) => x >= 1)) {
    const m = loungeModel(n, f, nl), L = realLayout(m, { w: W, h: H }, META), tag = `${n} agents, ${f} folders, ${nl} in the lounge, ${W}x${H}`;
    assert.deepStrictEqual(problems(L, W, H), [], `${tag}: ${problems(L, W, H).slice(0, 4).join('; ')}`);
    assert.deepStrictEqual(loungeProblems(L, W), [], `${tag}: ${loungeProblems(L, W).slice(0, 4).join('; ')}`);
    assert.strictEqual(L.zones.reduce((s, z) => s + z.desks.length, 0), n - nl, `${tag}: one desk per agent not in the lounge`);
    const want = sortDesks(m.folders.flatMap((fo) => fo.agents.filter((a) => a.lounge))).map((a) => a.id);
    assert.deepStrictEqual(L.lounge!.desks.map((d) => d.id), want, `${tag}: seats in status order, then folder order (FR-022)`);
    if (n <= 15 && W >= 1280) assert.ok(!L.scroll, `${tag}: no scroll at the 15-agent scale`);
    lcases++;
  }
}
{
  /* the room they leave goes to the desks: with the same agents the desk unit u (people, desks and faces) is at least as large as when everyone sat at a desk;
     with 4 desks or fewer left they get big screens (FR-020), which are then at least as large as the screens those desks had */
  const gains: string[] = [];
  for (const [W, H] of SIZES.slice(0, 2)) for (const nl of [1, 2, 3, 4, 6, 8, 11]) {
    const m = loungeModel(15, 4, nl), all = JSON.parse(JSON.stringify(m)) as RealModel;
    all.folders.forEach((fo) => fo.agents.forEach((a) => { a.lounge = false; }));
    const stay = new Set(m.folders.flatMap((fo) => fo.agents.filter((a) => !a.lounge).map((a) => a.id)));
    const area = (L: Layout): number => { const ds = L.zones.flatMap((z) => z.desks).filter((d) => stay.has(d.id)); return ds.reduce((s, d) => s + d.glass.w * d.glass.h, 0) / ds.length; };
    const L1 = realLayout(m, { w: W, h: H }, META), L0 = realLayout(all, { w: W, h: H }, META);
    gains.push(`${W}:${nl}:u ${(L1.u / L0.u).toFixed(2)}${L1.big ? ' big screens ' + (area(L1) / area(L0)).toFixed(1) : ''}`);
    if (L1.big) assert.ok(area(L1) >= area(L0), `FR-247 at ${W}x${H} with ${nl} in the lounge: the big screens are smaller than the desks' own were`);
    else assert.ok(L1.u >= L0.u - 1e-6, `FR-247 at ${W}x${H} with ${nl} in the lounge: the desks shrank (u ${L0.u.toFixed(1)} -> ${L1.u.toFixed(1)})`);
  }
  console.log('lounge: the staying desks against everyone at a desk (width:in lounge:ratio):', gains.join(' '));
}

// ---- owner 2026-11-02: one post-it paper colour per place, dark ink at 4.5:1 or better on each, one default for a custom place ----
{
  const lum = (hex: string): number => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a: string, b: string): number => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const places = ['boss', 'bank', 'coffee', 'library', 'software', 'terminal', 'web', 'other'];
  assert.deepStrictEqual(Object.keys(NOTE_PAPER).sort(), places.slice().sort(), 'a colour for each place an agent goes to');
  const all = [...places.map((p) => notePaper(p)), NOTE_PAPER_DEFAULT];
  assert.strictEqual(new Set(all).size, all.length, 'every reason has its own colour, the default included');
  for (const c of all) assert.ok(ratio(NOTE_INK, c) >= 4.5, `ink ${NOTE_INK} on ${c} is ${ratio(NOTE_INK, c).toFixed(2)}:1`);
  assert.strictEqual(notePaper('c-000001'), NOTE_PAPER_DEFAULT, 'a custom place gets the default paper');
  assert.strictEqual(notePaper('__proto__'), NOTE_PAPER_DEFAULT, 'a hostile id gets the default paper');
  assert.strictEqual(notePaper(null), NOTE_PAPER_DEFAULT);
  /* the Boss is not an alarm colour: its hue is blue, not red or orange (an ordinary visit) */
  const rgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const bs = rgb(notePaper('boss')); assert.ok(bs[2] > bs[0] && bs[2] >= bs[1], 'the Boss paper is blue-leaning');
}

// ---- spec 097 FR-110, FR-121: placeBox puts a slip on the free spot nearest its door, never on anything in the avoid list ----
{
  const bounds = { x: 0, y: 200, w: 600, h: 300 };
  const free = placeBox({ w: 200, h: 100 }, [], bounds, { x: 300, y: 200 });
  assert.ok(free && Math.abs(free.x + 100 - 300) <= 10 && free.y === 200, 'no obstacle: centred under the door, at the top');
  const wall: Rect[] = [{ x: 150, y: 200, w: 300, h: 60 }];
  const moved = placeBox({ w: 200, h: 100 }, wall, bounds, { x: 300, y: 200 })!;
  assert.ok(!inter(moved, wall[0], 0) && inside(moved, bounds, 0), 'an obstacle at the door: the slip goes beside or below it, inside the bounds');
  assert.strictEqual(placeBox({ w: 200, h: 100 }, [{ x: 0, y: 200, w: 600, h: 300 }], bounds, { x: 300, y: 200 }), null, 'no free spot: null, never an overlap');
  assert.strictEqual(placeBox({ w: 700, h: 10 }, [], bounds, { x: 0, y: 0 }), null, 'wider than the bounds: null');
  for (const [W, H] of SIZES.slice(0, 2)) {
    const L = realLayout(model(15, 4, { away: false }), { w: W, h: H }, META);
    const avoid: Rect[] = L.zones.flatMap((z) => [z.sign, ...z.desks.map((d) => d.plate)]) as Rect[];
    const pill = placeBox({ w: 190, h: 24 }, avoid, { x: 0, y: L.lobbyH, w: W, h: L.height - L.lobbyH }, { x: W / 2, y: L.lobbyH });
    assert.ok(pill && !avoid.some((r) => inter(pill, r, 0)), `15 agents at ${W}x${H}: the one-line pill finds a free spot`);
  }
}

{
  // sweep 2026-11-01: choosing an Office layout repaints Settings; the pressed button keeps the keyboard focus
  const scr = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'screens.js'), 'utf8');
  assert.ok(/const hadFocus=document\.activeElement===olb;\s*await paint\(\);[^\n]*\n\s*if\(hadFocus\)\{const nb=document\.querySelector\('\[data-officelayout="'\+k\+'"\]'\);if\(nb\)focusIn\(nb\);\}/.test(scr), 'the Office layout pick restores focus after the repaint');
}
// ---- FR-107: the lamp in words, one phrase per FR-041 row, the same for every world ----
{
  const W = Object.fromEntries((Object.keys(LIGHT_TABLE) as LightState[]).map((k) => [k, lampWords(lightFor(k))]));
  assert.deepStrictEqual(W, { working: 'Lamp warm, steady', thinking: 'Lamp on, breathing', waiting: 'Lamp bright, amber screen', error: 'Lamp on, red screen', limit: 'Lamp on, orange screen', done: 'Lamp low', idle: 'Lamp low', asleep: 'Lamp off' }, 'a phrase per light row');
  assert.strictEqual(lampWords(lightFor('waiting', { still: true })), W.waiting, 'reduced motion does not change the words');
}

// ---- FR-106 (owner 2026-11-01): the chat's round portrait is cropped tight on the face, for every person of every set ----
{
  let n = 0;
  for (const set of ['office', 'prehistoric']) {
    const seat = (readJson('sets', set, 'set.json') as { seat: Record<string, { w: number; h: number; headTop: number; bodyH: number }> }).seat;
    for (const [id, m] of Object.entries(seat)) {
      const c = portraitCrop(m);
      assert.ok(c.x >= 0 && c.y >= 0 && c.x + c.s <= m.w + 1e-6 && c.y + c.s <= m.h + 1e-6, `${set}/${id}: the crop is inside the picture`);
      const head = (m.headTop - c.y) / c.s, face = (FACE_U * m.bodyH) / c.s;
      assert.ok(head >= 0 && head <= 0.15, `${set}/${id}: headroom ${head.toFixed(3)} of the circle is at most 15 %`);
      assert.ok(face >= 0.30, `${set}/${id}: the face is at least 30 % of the circle (${face.toFixed(3)})`);
      assert.ok(Math.abs(c.s - Math.min(PORTRAIT_SIDE * m.bodyH, m.w, m.h)) < 1e-6);
      n++;
    }
  }
  assert.ok(n >= 21, 'every person of both sets was checked');
}

// spec 097 FR-226: the chat's rules use tokens only, with no fallback; the world's tint is a token
{
  const R = path.join(__dirname, '..', '..', 'src', 'renderer');
  const css = fs.readFileSync(path.join(R, 'realoffice.css'), 'utf8');
  const from = css.indexOf('/* spec 097 FR-106, FR-224..FR-226:');
  assert.ok(from >= 0, 'the chat rules are marked');
  const end = css.indexOf('.ro-portrait>.rp-ini', from);
  const block = css.slice(from, css.indexOf('\n', end)).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(|box-shadow|var\(--[\w-]+,/i.test(block), 'no colour literal, shadow or fallback in the chat rules: ' + block.slice(0, 200));
  for (const w of ['photo', 'cave']) {
    const rule = fs.readFileSync(path.join(R, 'realoffice', 'worlds', w, 'world.css'), 'utf8').split('\n').find((l) => l.includes('#panel'));
    assert.ok(rule && rule.includes('var(--world-tint)') && !/#[0-9a-f]{3,8}\b/i.test(rule), w + ': the tint is a token');
  }
}

// spec 097 phase P2. FR-032: how a glass shows text
{
  const small = screenFit({ w: 90, h: 58 });
  assert.ok(small.small && small.rows === 1 && small.font >= 10.5, 'a small screen: bars and the newest line, at least 10.5 px');
  assert.ok(small.bars >= 2, 'bars fill it');
  assert.ok(screenFit({ w: 149, h: 200 }).small && screenFit({ w: 300, h: 59 }).small, 'under 150x60 is small on either side');
  assert.deepStrictEqual([screenFit({ w: 150, h: 60 }).small, screenFit({ w: 150, h: 60 }).font], [false, 11], 'real lines at 11 px');
  assert.strictEqual(screenFit({ w: 300, h: 200 }).font, 11, '200 px tall is not over 200');
  assert.strictEqual(screenFit({ w: 300, h: 201 }).font, 13, 'over 200 px: 13 px');
  assert.ok(screenFit({ w: 300, h: 170 }).rows >= 8 && screenFit({ w: 300, h: 150 }).rows >= 8, 'SC-003: a big screen holds at least 8 lines');
  assert.strictEqual(screenFit({ w: 4, h: 4 }).bars, 0, 'no room: no bars, no negative');
  /* spec 102 (owner, 2026-11-03: a small room drawn bigger): in the arcade above g = 3 the screen text grows with the art, never under 10.5 px;
     at g = 3 or none, the size rule above holds unchanged (pre-review of #1079: untested) */
  assert.deepStrictEqual([screenFit({ w: 300, h: 200 }, 4).font, screenFit({ w: 375, h: 250 }, 5).font], [14.5, 18.5], 'g 4: 14.5 px, g 5: 18.5 px');
  assert.deepStrictEqual([screenFit({ w: 300, h: 201 }, 3).font, screenFit({ w: 300, h: 201 }, 0).font], [13, 13], 'g 3 and no g: the size rule');
  for (const g of [4, 5]) { const f = screenFit({ w: 75 * g, h: 50 * g }, g); assert.ok(f.font >= 10.5 && f.lh > f.font && f.rows >= 1, `g ${g}: readable, one row at least`); }
  // FR-030, FR-035: what a state shows
  const log = [{ n: 3, k: 'cmd', t: 'Running x' }, { n: 4, k: 'ok', t: 'Reading y' }];
  const q = [{ k: 'plain', t: 'Allow this?' }], rep = [{ k: 'reply', t: 'All done.' }];
  assert.deepStrictEqual(screenFor('asleep', log, q, rep, 'Asleep'), { off: true, caret: false, quiet: false, lines: [] }, 'asleep: off, no text');
  assert.strictEqual(screenFor('working', log, q, rep, 'Working').caret, true, 'a caret only on working screens');
  for (const st of ['thinking', 'waiting', 'error', 'limit', 'done', 'idle'] as RealState[]) assert.strictEqual(screenFor(st, log, q, rep, 'W').caret, false, 'no caret: ' + st);
  assert.deepStrictEqual(screenFor('working', log, q, rep, 'W').lines, log, 'the agent\'s own lines win');
  const ask = screenFor('waiting', log, q, rep, 'W').lines;
  assert.deepStrictEqual(ask[ask.length - 1], { n: 5, k: 'ask', t: 'Allow this?' }, 'needs-you: the question is the newest line, next number');
  assert.strictEqual(screenFor('limit', log, q, rep, 'W').lines[2].k, 'ask', 'limit: the same');
  assert.strictEqual(screenFor('error', log, q, rep, 'W').lines[2].k, 'err', 'error: its error is the newest line');
  assert.strictEqual(screenFor('done', log, [], rep, 'W').lines[1].k, 'done', 'done: the newest line marked green');
  assert.strictEqual(log[1].k, 'ok', 'the log itself is not changed');
  assert.strictEqual(screenFor('done', [], [], rep, 'W').lines[0].t, 'All done.', 'no lines: the last reply');
  assert.strictEqual(screenFor('working', [], q, [], 'W').lines[0].t, 'Allow this?', 'no reply: the task');
  assert.strictEqual(screenFor('idle', [], [], [], 'Ready').lines[0].t, 'Ready', 'nothing at all: the status word, never an empty screen');
  assert.deepStrictEqual(screenFor('working', [], [], [], 'Working', true), { off: false, caret: true, quiet: true, lines: [{ n: 0, k: 'plain', t: 'Working' }] }, 'Live activity off: the word, nothing else');
  assert.strictEqual(screenFor('working', Array.from({ length: 30 }, (_, i) => ({ n: i, k: 'cmd', t: 'l' + i })), [], [], 'W').lines.length, 24, 'at most 24');
  // FR-070, FR-071, FR-181: the frames, their pace, per agent
  assert.deepStrictEqual([POSE_FRAME_B.typeA, POSE_FRAME_B.waveA, POSE_FRAME_B.runA], ['typeB', 'waveB', 'runB'], 'the two-frame poses');
  const periods = new Set<number>();
  for (let i = 0; i < 200; i++) {
    const id = 'sess-' + i;
    for (const pose of ['typeA', 'waveA', 'runA']) { const m = personMotion(id, pose, pose === 'runA' ? null : 'working'); assert.strictEqual(m.kind, 'frames'); assert.ok(m.period >= 0.72 && m.period <= 3.2, 'a natural rate: ' + m.period); assert.ok(m.sway >= 5 && m.sway <= 8, 'its own sway: ' + m.sway); assert.strictEqual(m.style, ({ typeA: 'type', waveA: 'wave', runA: 'run' } as Record<string, string>)[pose]); assert.ok(m.offset >= 0 && m.offset < m.period * 1000); }
    const t = personMotion(id, 'typeA', 'working'); assert.ok(t.period >= 2.6 && t.period <= 3.2, 'typing 2.6-3.2 s a pair: ' + t.period); periods.add(t.period); const r = personMotion(id, 'runA', null); assert.ok(r.period >= 0.72 && r.period <= 0.82, 'running: ' + r.period);
    for (const st of ['thinking', 'done', 'idle'] as RealState[]) { const b = personMotion(id, st === 'thinking' ? 'think' : 'rest', st); assert.strictEqual(b.kind, 'breathe'); assert.ok(b.period >= 4 && b.period <= 5.5, 'breath: ' + b.period); assert.ok(4 / b.period <= 2); }
  }
  assert.ok(periods.size > 15, 'the room does not move in step: ' + periods.size);
  assert.strictEqual(personMotion('a', 'think', 'error').kind, null, 'FR-036: error is still');
  assert.strictEqual(personMotion('a', 'counter', null).kind, 'breathe', 'at a counter: a breath');
  assert.strictEqual(personMotion('a', 'knock', null).kind, 'knock');
  assert.strictEqual(personMotion('a', 'book', null).kind, 'breathe');
  // the layout names the second frame; every file it names exists in the pack and shares the first frame's canvas
  const L3 = realLayout(model(15, 4, { states: ['working', 'waiting', 'thinking', 'error', 'done'] }), { w: 1280, h: 740 }, META);
  for (const d of L3.zones.flatMap((z) => z.desks)) if (d.person) {
    assert.strictEqual(d.person.fileB, POSE_FRAME_B[d.person.pose] ? d.person.file.replace(d.person.pose, POSE_FRAME_B[d.person.pose]) : null, 'frame B of ' + d.person.file);
    if (d.person.fileB) assert.ok(fs.existsSync(path.join(ROOT, 'src', 'renderer', 'realoffice', 'sets', 'office', d.person.fileB)), 'frame B exists: ' + d.person.fileB);
  }
  // FR-034: zoomRect
  const view = { x: 0, y: 0, w: 1280, h: 740 }, size = { w: 420, h: 248, minH: 124 };
  const inside = (r: Rect) => r.x >= view.x && r.y >= view.y && r.x + r.w <= view.x + view.w && r.y + r.h <= view.y + view.h;
  const clear = (r: Rect, av: Rect[]) => av.every((a) => r.x >= a.x + a.w || a.x >= r.x + r.w || r.y >= a.y + a.h || a.y >= r.y + r.h);
  const T = { x: 500, y: 400, w: 90, h: 58 }, own = { x: 480, y: 500, w: 160, h: 36 };
  let z = zoomRect(T, [T, own], view, size);
  assert.strictEqual(z.side, 'above', 'first above');
  assert.ok(z.y + z.h <= T.y, 'really above');
  z = zoomRect({ ...T, y: 60 }, [{ ...T, y: 60 }, { ...own, x: 1000, y: 130 }], view, size);
  assert.strictEqual(z.side, 'below', 'then below');
  z = zoomRect({ ...T, y: 250 }, [{ ...T, y: 250 }, { x: 0, y: 0, w: 1280, h: 200 }, { x: 0, y: 350, w: 1280, h: 390 }], view, { w: 420, h: 124, minH: 124 });
  assert.ok(z.side === 'right' || z.side === 'left', 'then beside: ' + z.side);
  // every desk of a full office with every plate needing the user, both sizes, the corners included
  let zoomCases = 0;
  for (const [w, h] of [[1440, 830], [1280, 730]]) for (const states of [['waiting'], ['working', 'waiting', 'idle'], ['idle']] as RealState[][]) for (const f of [1, 4, 7]) {
    const lay = realLayout(model(15, f, { states, away: false }), { w, h }, META), desks = lay.zones.flatMap((zz) => zz.desks), V = { x: 0, y: 0, w: lay.width, h: lay.height };
    const needs = desks.filter((d) => d.state === 'waiting').map((d) => d.plate);
    for (const d of desks) {
      const av = [d.screen, d.plate, ...needs], r = zoomRect(d.screen, av, V, { w: 420, h: 248, minH: 124 });
      zoomCases++;
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= V.w + 1e-6 && r.y + r.h <= V.h + 1e-6, 'stays in the view');
      assert.ok(!r.covers && clear(r, av), `covers nothing it must not: ${w}x${h} ${states} ${f} ${JSON.stringify(r)}`);
      assert.ok(r.w >= 380 && r.w <= 480, 'FR-034 width');
    }
  }
  // a window too small: stays in the view, says it covers, covers the least
  z = zoomRect({ x: 10, y: 10, w: 80, h: 40 }, [{ x: 0, y: 0, w: 300, h: 300 }], { x: 0, y: 0, w: 300, h: 300 }, size);
  assert.ok(z.covers && z.x === 0 && z.y === 0 && z.w === 300 && z.h <= 300, 'no room: inside, flagged');
  z = zoomRect(T, [], { x: 40, y: 900, w: 1000, h: 300 }, size);
  assert.ok(z.y >= 900 && z.y + z.h <= 1200, 'a scrolled view: its own coordinates');
  assert.ok(inside({ ...zoomRect(T, [T], view, size) }), 'inside');
  console.log(`zoom: ${zoomCases} placements`);
}

// spec 102 FR-255 (#1104): the arcade lobby on whole scales (the rule, then the band itself)
{
  // 1. rounds up and fits (the free floor and the band)
  assert.strictEqual(lobbyScale(1.9, 44, 100, 48, 200), 2, 'FR-255 lobby: 1.9 rounds up to 2 when it fits');
  // 2. rounds up but does not fit: the scale below
  assert.strictEqual(lobbyScale(1.9, 44, 80, 48, 200), 1, 'FR-255 lobby: no room on the floor: the scale below');
  assert.strictEqual(lobbyScale(1.9, 44, 100, 48, 90), 1, 'FR-255 lobby: it would leave the band: the scale below');
  assert.strictEqual(lobbyScale(2.3, 44, 60, 48, 200), 2, 'FR-255 lobby: nearest below needs no room check');
  // 3. a scale under 1 is drawn at 1
  assert.strictEqual(lobbyScale(0.6, 44, 20, 48, 200), 1, 'FR-255 lobby: under 1 is 1');
  assert.strictEqual(lobbyScale(0.3, 44, 20, 48, 200), 1, 'FR-255 lobby: well under 1 is 1');
  // 4. a visitor takes the scale below its own
  assert.deepStrictEqual([2.64, 2.13, 1.99, 0.7, 3, 2.9999999].map(visitorScale), [2, 2, 1, 1, 3, 3], 'FR-255 lobby: a visitor takes the whole scale below its own');
  // 5. the band of the pixel world: whole scales and whole-px edges, quiet and crowded, at several widths and heights
  const retro = { ...readJson('worlds', 'retro', 'world.json'), ...readJson('sets', 'retro', 'set.json') } as unknown as RealMeta;
  const crowd = Object.keys(retro.stand);
  let checked = 0;
  for (const [W, Lb] of [[1408, 150], [1248, 128], [1408, 196], [1000, 140]]) {
    for (const busy of [0, 1, 3]) {
      const places = PLACES.map((id, i) => ({ id, visitors: i % 3 === 0 ? Array.from({ length: busy }, (_, j) => ({ id: id + j, person: crowd[(i + j) % crowd.length], needsYou: false })) : [] }));
      const lb = lobbyBand(retro, places as never, W, Lb);
      for (const f of lb.fixtures) {
        if (f.art) {
          const aw = retro.fixtures[f.id][0];
          assert.ok([f.art.x, f.art.y, f.art.w, f.art.h].every(Number.isInteger), `FR-255 lobby ${W}x${Lb}: fixture ${f.id} on whole px ${JSON.stringify(f.art)}`);
          assert.ok(Number.isInteger(f.art.w / aw) && f.art.w / aw >= 1, `FR-255 lobby ${W}x${Lb}: fixture ${f.id} at a whole scale (${f.art.w / aw})`);
          assert.ok(f.art.y >= 0, `FR-255 lobby ${W}x${Lb}: fixture ${f.id} inside the band`);
          checked++;
        }
        for (const v of f.visitors) if (v.fig) {
          assert.ok(Number.isInteger(v.fig.x) && Number.isInteger(v.fig.y), `FR-255 lobby ${W}x${Lb}: visitor ${v.id} on whole px`);
          const k = v.fig.w / retro.stand[String(crowd.find((p) => v.fig!.file.startsWith(p + '-')))].poses[v.fig.pose][0];
          assert.ok(Math.abs(k - Math.round(k)) < 1e-9 && k >= 1, `FR-255 lobby ${W}x${Lb}: visitor ${v.id} at a whole scale (${k})`);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 50, `FR-255 lobby: enough pictures checked (${checked})`);
  // 6. a world without pixelArt is unchanged: the photo world's band is byte-identical to main's (sha computed with main's code, 2026-11-04)
  const P = ['library', 'software', 'terminal', 'web', 'other', 'coffee', 'boss', 'bank', 'postbox'].map((id, i) => ({ id, visitors: i % 3 === 0 ? [{ id: 'v' + i, person: PEOPLE[i], needsYou: false }] : [] }));
  assert.strictEqual(createHash('sha256').update(JSON.stringify(lobbyBand(META, P, 1408, 150))).digest('hex').slice(0, 16), 'fad790c1536fb4f8', 'FR-255 lobby: the photo world is unchanged');
}
console.log(`realoffice layout and lights tests passed (${cases} layouts, ${lcases} with a lounge, faces ${JSON.stringify(faces)})`);
process.exitCode = 0;

/** Spec 102 T202, T203, T205 (FR-229, FR-255, FR-256): the `aisles` arrangement of the Retro arcade hall. Pure functions, plain Node, no DOM, 0 credits.
 *  Measure first: it prints what fits. `npm run test:realoffice-layout` runs it after the rows tests. */
import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { realLayout, sortDesks, storeyRuns, storeyTagW, STOREY_GAP, STOREY_U_LOSS, type RealFloor, type RealMeta, type RealModel, type RealAgent, type RealState, type Rect, type Layout, type DeskBox } from '../src/shared/realoffice-layout';
import { screenFit } from '../src/shared/realoffice-layout';
import { aisleStatus, aislesLayout, layoutFor, aisleTabOrder, aisleFace, FACE_FLOOR, AISLE_SIGN_MIN_W, AISLE_PLATE_H, ARRANGEMENTS } from '../src/shared/realoffice-arrangements';

process.exitCode = 1;
const ROOT = (() => { let d = __dirname; while (!fs.existsSync(path.join(d, 'package.json'))) d = path.dirname(d); return d; })();
const RO = path.join(ROOT, 'src', 'renderer', 'realoffice');
const readJson = (...p: string[]): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(RO, ...p), 'utf8'));
const META = { ...readJson('worlds', 'retro', 'world.json'), ...readJson('sets', 'retro', 'set.json') } as unknown as RealMeta; // the arcade's own people: the place beside a cabinet is measured on them
const PEOPLE = Object.keys(META.seat).sort();
const STATES: RealState[] = ['working', 'thinking', 'waiting', 'error', 'limit', 'done', 'idle', 'asleep'];
function model(n: number, f: number, states: RealState[] = STATES, lounge = 0): RealModel {
  const folders = Array.from({ length: f }, (_, i) => ({ id: 'f' + i, agents: [] as RealAgent[] }));
  for (let i = 0; i < n; i++) folders[i % f].agents.push({ id: 'a' + i, state: states[i % states.length], person: PEOPLE[i % 15], away: i % 5 === 4 ? 'library' : null, ...(i < lounge ? { lounge: true } : {}) });
  return { folders, places: ['library', 'software', 'terminal', 'web', 'other', 'coffee', 'boss', 'bank', 'postbox'].map((id) => ({ id, visitors: [] })) };
}
const SIGNS = (f: number): Record<string, { name: string; path: string; counts: number }> => Object.fromEntries(Array.from({ length: f }, (_, i) => ['f' + i, { name: 'project-' + i, path: '~/work/long/path/to/project-' + i, counts: 3 }]));
const inter = (a: Rect, b: Rect, t = 0.5): boolean => a.x + t < b.x + b.w && b.x + t < a.x + a.w && a.y + t < b.y + b.h && b.y + t < a.y + a.h;
const inside = (a: Rect, b: Rect, t = 0.5): boolean => a.x >= b.x - t && a.y >= b.y - t && a.x + a.w <= b.x + b.w + t && a.y + a.h <= b.y + b.h + t;
/** the floors the app shows: both sizes with the chat closed; an open chat hides the office (#1001), so no office floor has a chat beside it */
/** the measured rooms (spec 102 T309, issue #1590): the floor less its 12 px padding top and bottom, at 1440x900 and 1280x800 */
const ROOM = { h900: 797, h800: 697 } as const;
const SIZES: [number, number][] = [[1440, ROOM.h900], [1280, ROOM.h800]];
const NAMES = ['1440x900', '1280x800'];

// ---- spec 102 delta 2026-11-11 (issue #1566, T308): the measured rooms of the app (the floor less its 12 px padding top and bottom): 1280x800 is 697 px, 666 with a 31 px strip; 1440x900 is 797, 766 with it.
// The hall for 15 agents needs 682 px: it fits with no strip, scrolls under a strip until the floor's padding is lent (666 + 24 = 690), and the threshold is pinned here, not in a driver
{
  const m15 = model(15, 4), at = (w: number, h: number): Layout => aislesLayout(m15, { w, h }, META, SIGNS(4));
  assert.ok(!at(1248, ROOM.h800).scroll && !at(1408, ROOM.h900).scroll && !at(1408, ROOM.h900 - 31).scroll, '15 agents fit the measured rooms (1280x800 without a strip, 1440x900 with and without)');
  assert.ok(at(1248, 666).scroll, '15 agents at 1280x800 with the strip shown (666 px) scroll until the padding is lent');
  assert.ok(!at(1248, 690).scroll && !at(1248, 682).scroll, '15 agents fit 690 px (666 + the 24 px lent) and the boundary 682');
  assert.ok(at(1248, 681).scroll, '15 agents scroll at 681 px: the hall needs 682');
  assert.ok(at(1248, 666).height > 666 && at(1248, 666).height <= 700, 'the scroll fallback is taller than the room it was given');
  const m16 = model(16, 4);
  assert.ok(aislesLayout(m16, { w: 1248, h: 666 }, META, SIGNS(4)).scroll && aislesLayout(m16, { w: 1248, h: 690 }, META, SIGNS(4)).scroll, '16 agents scroll at 666 px and still at 690 (666 + the 24 px lent): the lend must be refused for them (shots-058-mcp-launch retro 16 drives that)');
}


// ---- spec 102 delta 2026-11-12 (issue #1588, T310): the filter note's lent padding. The floor at 1280x800 is 721 px of content (800 less the chrome) and the hall for 11 to 15 agents needs 682.
// With the note the floor pads its top 40 px (the note stands in it: top 8 px, a 20 px line, so it ends at 28); `#floor.ro-tight.has-fnote` keeps `--fnote-keep` of it and lends the rest, with the bottom 12 px.
{
  const css = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'styles.css'), 'utf8').replace(/\r\n/g, '\n');
  const num = (re: RegExp, what: string): number => { const m = re.exec(css); assert.ok(m, `styles.css: ${what} is missing`); return Number(m![1]); };
  const keep = num(/#floor\{[^}]*--fnote-keep:([\d.]+)px/, 'the floor\'s --fnote-keep'), padNote = num(/#floor\.has-fnote\{padding-top:([\d.]+)px\}/, 'the floor\'s padding-top with a note');
  const noteTop = num(/#filterNote\{position:absolute;top:([\d.]+)px/, 'the note\'s top'), line = num(/\.filter-note\{[^}]*line-height:([\d.]+)px/, 'the note\'s line height');
  assert.ok(/#floor\.ro-tight\.has-fnote\{padding-top:var\(--fnote-keep\)\}/.test(css), 'styles.css: #floor.ro-tight.has-fnote must keep --fnote-keep as its top padding');
  const FLOOR = 721, bottom = 12; /* measured by check-102-arcade-filter-note: clientHeight of #floor at 1280x800, its paddings included */
  const room = (padTop: number, padBottom = 0): number => FLOOR - padTop - padBottom; /* what the hall gets: the floor less the paddings that stay */
  assert.ok(keep >= noteTop + line, `the note ends at ${noteTop + line} px and the kept padding is ${keep}: the hall would start under the note`);
  for (const [n, f] of [[15, 4], [14, 4], [11, 3]] as [number, number][]) {
    const at = (h: number): Layout => aislesLayout(model(n, f), { w: 1248, h }, META, SIGNS(f));
    assert.ok(!at(room(keep)).scroll, `${n} agents at 1280x800 with the filter note: ${room(keep)} px (the floor less the ${keep} px kept) still scrolls (the hall needs 682)`);
  }
  const m15 = model(15, 4), at15 = (h: number): Layout => aislesLayout(m15, { w: 1248, h }, META, SIGNS(4));
  assert.ok(at15(room(padNote, bottom)).scroll && at15(room(padNote)).scroll, `15 agents with the note: ${room(padNote, bottom)} px as the page gives it and ${room(padNote)} px with only the bottom lent (the #1566 fix) scroll: the reason for lending the top too`);
  assert.ok(!at15(682).scroll && at15(681).scroll, 'the boundary: 682 fits and 681 scrolls');
  const maxKeep = FLOOR - 682; /* the most that may stay on top: one px more and the hall is 681 */
  assert.ok(keep <= maxKeep && !at15(room(maxKeep)).scroll && at15(room(maxKeep + 1)).scroll, `the kept padding ${keep} is at most ${maxKeep}: at ${maxKeep} the hall fits (682) and at ${maxKeep + 1} it scrolls (681)`);
  console.log(`filter note: keeps ${keep} px of its ${padNote} px top padding (the note ends at ${noteTop + line}), the hall gets ${room(keep)} px of ${FLOOR}; the most that may stay is ${maxKeep}`);
}

/* spec 102 T276 (issue #1303): a one-line arcade plate fits its line. The plate box is AISLE_PLATE_H tall; what its CSS asks for (border, padding, one line) must fit in it, at the dense levels too
 * (12 and 15 agents, both sizes), where every cabinet and lounge plate has that height; text never under 10.5 px. check-office-overlap.js (OFFICE_WORLD=retro) measures the drawn plate; this holds the numbers. */
{
  const css = fs.readFileSync(path.join(RO, 'worlds', 'retro', 'world.css'), 'utf8'), base = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'realoffice.css'), 'utf8');
  const rule = /\.ro\[data-world="retro"\] \.ro-plate\{--arc-plate-pad:([\d.]+)px;--arc-plate-line:([\d.]+)px;padding-block:var\(--arc-plate-pad\);line-height:var\(--arc-plate-line\);justify-content:flex-start\}/.exec(css);
  assert.ok(rule, 'world.css: the arcade plate rule (padding and a line height in px) is missing');
  const border = /\.ro-plate\{[^}]*?border:([\d.]+)px solid/.exec(base), wborder = /\.ro-plate:is\(\.st-waiting,\.st-limit\)\{[^}]*?border:([\d.]+)px solid/.exec(base);
  assert.ok(border && wborder, 'realoffice.css: the plate border (plain, waiting and limit) is not found');
  const wpad = /\.ro-plate:is\(\.st-waiting,\.st-limit\)\{--arc-plate-padw:([\d.]+)px;padding-block:var\(--arc-plate-padw\)\}/.exec(css);
  assert.ok(wpad, 'world.css: the waiting and limit plate padding rule is missing');
  const need = 2 * Number(border[1]) + 2 * Number(rule[1]) + Number(rule[2]);
  const needWait = 2 * Number(wborder[1]) + 2 * Number(wpad[1]) + Number(rule[2]);
  for (const [nm, n] of [['plain', need], ['waiting or limit (the thicker border)', needWait]] as [string, number][]) assert.ok(n <= AISLE_PLATE_H, `an arcade ${nm} plate needs ${n} px (border, padding, one line) and has ${AISLE_PLATE_H}: its line is cut`);
  const l1 = /\.ro-plate\.lounge \.ro-l1\{[^}]*?font-size:var\(--t4-size\)/.exec(css), t4 = /--t4-size:\s*([\d.]+)px/.exec(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'styles.css'), 'utf8'));
  assert.ok(l1 && t4 && Number(t4[1]) >= 10.5 && Number(t4[1]) <= Number(rule[2]), 'the lounge plate name is at least 10.5 px and fits the line');
  let np = 0, nl = 0;
  for (const [W, H] of SIZES) for (const k of [12, 15]) {
    const L = aislesLayout(model(k, 3, STATES, 3), { w: W, h: H }, META, SIGNS(3));
    assert.ok(L.lounge && L.lounge.desks.length > 0, `${W}x${H}, ${k} agents: no lounge seat to measure`);
    for (const d of L.zones.flatMap((z) => z.desks)) { assert.ok(d.plate.h >= needWait, `${W}x${H}, ${k} agents: plate ${d.plate.h} px is shorter than its line needs (${needWait})`); np++; }
    for (const d of L.lounge.desks) { assert.ok(d.plate.h >= needWait, `${W}x${H}, ${k} agents: lounge plate ${d.plate.h} px is shorter than its line needs (${needWait})`); nl++; }
  }
  console.log(`arcade plates: ${np} cabinet and ${nl} lounge plates, box ${AISLE_PLATE_H} px, line needs ${need} px (${needWait} waiting or limit)`);
}

/** owner, 2026-11-03: no person is cut by a cabinet or a screen: the whole picture, not only the stand, is clear of every cabinet and screen (spec 097 T247: also run for every crew) */
function cuts(ds: DeskBox[]): string[] {
  const out: string[] = [];
  for (const d of ds) for (const o of ds) for (const r of [o.desk, o.screen as Rect]) for (const [nm, p] of [['person', d.stand], ['picture', d.person]] as [string, Rect | null][]) if (p && r && inter(p, r, 0.5)) out.push(`${nm} of ${d.id} (${d.person ? `${d.person.pid}/${d.person.pose}` : 'initials'}) is on the cabinet or screen of ${o.id}`);
  return out;
}

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
  out.push(...cuts(ds));
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
  /* spec 102 T309 (issue #1590): three rows of the narrowest cabinet need 558 px under the lowest lobby (96 + 20 lane) and 8 px of padding: 682 px. 10 agents in 3 or 4 folders at 1280x800 are whole from 682 (the lobby then
     under its 128 px, owner decision, spec 102 2026-11-12) and no longer split at the measured 697. The one gap left is the 31 px strip at 1280x800 (666 px, no layout-only fix: the lend runs only for a plan that scrolls, a split plan does not). */
  const gap = n === 10 && f >= 3 && W === 1280 && dh === 31;
  if (n <= 10 && !gap) assert.deepStrictEqual(cut, [], `${n} in ${f} at ${W}x${H - dh}: a folder of 4 or fewer is split`);
  if (n <= 10 && gap) assert.ok(cut.length > 0 && !L.scroll, `${n} in ${f} at ${W}x${H - dh}: the named gap (a split folder, no scroll) moved: cut ${cut.length}, scroll ${L.scroll}`);
  if (n <= 10 && gap) { /* issue #1598 (T342): the renderer's lend (the floor's 24 px) is what keeps them whole: the layout at that height has no cut folder and no scroll */
    const Ll = aislesLayout(model(n, f), { w: W, h: H - dh + 24 }, META, SIGNS(f)), pl = new Map<string, number>(); for (const z of Ll.zones) pl.set(z.id, (pl.get(z.id) || 0) + 1);
    assert.ok(![...pl.values()].some((v) => v > 1) && !Ll.scroll, `${n} in ${f} at ${W}x${H - dh} + 24 lent: the folders are whole and the hall does not scroll`);
  }
  if (n <= 10 && gap) {
    /* the strip stays where dropping it would not keep the folders whole (the lowest-lobby hall needs 682 px, this room has 666): a helper each keeps the strip row */
    const mg = model(n, f); for (const fo of mg.folders) for (const a of fo.agents) a.helpers = 1;
    const G1 = aislesLayout(mg, { w: W, h: H - dh }, META, SIGNS(f));
    assert.ok(G1.helpRows === 1 && !G1.scroll, `${n} in ${f} at ${W}x${H - dh} with a helper each: the strip stays where dropping it would not keep the folders whole (strip rows ${G1.helpRows}, scroll ${G1.scroll})`);
  }
  if (n === 10 && f >= 3 && W === 1280 && dh === 0) {
    const whole = (h: number): boolean => { const M = aislesLayout(model(n, f), { w: W, h }, META, SIGNS(f)), c = new Map<string, number>(); for (const z of M.zones) c.set(z.id, (c.get(z.id) || 0) + 1); return ![...c.values()].some((v) => v > 1) && !M.scroll; };
    assert.ok(!whole(681) && whole(682), `${n} in ${f} at ${W}: the folders are whole from 682 px and not at 681 (the threshold moved)`);
    /* the app's agents have helpers: the strip under every plate (FR-306) is what split the folder in the picture; it is dropped when that keeps the folders whole */
    const mh = model(n, f); for (const fo of mh.folders) for (const a of fo.agents) a.helpers = 1;
    const H1 = aislesLayout(mh, { w: W, h: H }, META, SIGNS(f)), c1 = new Map<string, number>(); for (const z of H1.zones) c1.set(z.id, (c1.get(z.id) || 0) + 1);
    assert.ok(![...c1.values()].some((v) => v > 1) && !H1.scroll && H1.helpRows === 0, `${n} in ${f} at ${W}x${H} with a helper each: the folders are whole, no scroll, and the strip is dropped (split ${[...c1.values()].some((v) => v > 1)}, scroll ${H1.scroll}, strip rows ${H1.helpRows})`);
    assert.ok(L.lobbyH < 128 && L.lobbyH >= 96, `${n} in ${f} at ${W}x${H}: the lobby is ${L.lobbyH} px (between its lowest, 96, and the set 128)`);
  }
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
     less than a slot to the side (above, below, or diagonal where rows stagger) */
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
/* review of #1079 (rubenlupi): the mutants that survived, each with a check that fails without its rule */
{
  const sizesModel = (sizes: number[]): RealModel => {
    let i = 0; const m = model(0, 1); m.folders = sizes.map((k, f) => ({ id: 'f' + f, agents: Array.from({ length: k }, () => ({ id: 'a' + i, state: STATES[i % 7], person: PEOPLE[i++ % 15], away: null }) as RealAgent) }));
    return m;
  };
  for (const [W, H] of [[1408, 817], [1248, 717], ...SIZES] as const) {
    /* nobody cut by a cabinet (owner, 04:34 UTC): two grid px of floor between a person's place and the cabinet, both inside the slot */
    for (const n of [1, 3, 4, 8, 15]) {
      const L = aislesLayout(model(n, Math.min(3, n)), { w: W, h: H }, META, SIGNS(Math.min(3, n))), g = L.g as number;
      for (const d of L.zones.flatMap((z) => z.desks)) {
        const st = d.stand!, gap = st.x >= d.desk.x + d.desk.w ? st.x - (d.desk.x + d.desk.w) : d.desk.x - (st.x + st.w);
        assert.ok(gap >= 2 * g - 0.5, `${n} at ${W}x${H}: ${d.id}'s place is ${gap} px from its cabinet, under 2 grid px (${2 * g})`);
        assert.ok(inside(st, d.slot) && inside(d.desk, d.slot), `${n} at ${W}x${H}: ${d.id}'s place or cabinet leaves its slot`);
      }
      /* the grid stands in the middle of the floor (a staggered full row over a centred short one leaned before) */
      const ds = L.zones.flatMap((z) => z.desks), mid = (Math.min(...ds.map((d) => d.slot.x)) + Math.max(...ds.map((d) => d.slot.x + d.slot.w))) / 2;
      assert.ok(Math.abs(mid - W / 2) <= 2 * g + 1, `${n} at ${W}x${H}: the grid's middle is ${Math.round(mid)}, the floor's ${W / 2}`);
    }
    /* 4 or fewer: every cabinet its own body, whatever the folders (3 + 1 put two equal bodies on the floor with the grid rule alone) */
    for (const sz of [[3, 1], [1, 3], [2, 2], [2, 1, 1], [1, 2, 1], [1, 1, 2], [1, 1, 1, 1], [4]]) {
      const L = aislesLayout(sizesModel(sz), { w: W, h: H }, META, SIGNS(sz.length)), b = L.zones.flatMap((z) => z.desks.map((d) => d.body));
      assert.strictEqual(new Set(b).size, b.length, `${sz.join(' + ')} at ${W}x${H}: bodies ${JSON.stringify(b)}`);
    }
  }
  /* every width, not only the two the app shows: a slot never leaves the floor and two slots of a row never overlap, also where the floor's
     width, not the column cap, sets the column */
  const swept = [0, 0];
  for (let W = 900; W <= 1500; W += 7) for (const n of [5, 6, 8, 10, 12, 15]) {
    const L = aislesLayout(model(n, 3), { w: W, h: 817 }, META, SIGNS(3)), ds = L.zones.flatMap((z) => z.desks);
    if (L.scroll) { swept[1]++; continue; } /* a floor too small for its people scrolls (T203); its width is not this check's */
    swept[0]++;
    for (const d of ds) assert.ok(d.slot.x >= -0.5 && d.slot.x + d.slot.w <= W + 0.5, `${n} at ${W}x817: ${d.id}'s slot ${Math.round(d.slot.x)}..${Math.round(d.slot.x + d.slot.w)} leaves the floor`);
    for (const a2 of ds) for (const b of ds) if (a2 !== b && Math.abs(a2.slot.y - b.slot.y) < 1) assert.ok(!inter(a2.slot, b.slot), `${n} at ${W}x817: slots ${a2.id} and ${b.id} overlap`);
  }
  console.log(`floor-width sweep: ${swept[0]} layouts that fit checked, ${swept[1]} that scroll left out`);
  /* a pixel world's lobby: visitors at one place stand twice as far apart as in a flat world (1.6 against 0.8 of a body width), so none is
     half behind another (owner, 2026-11-03) */
  const lobby = (pixelArt: boolean): number => {
    const m = model(2, 1); m.places = m.places.map((p) => (p.id === 'boss' ? { ...p, visitors: [PEOPLE[0], PEOPLE[1], PEOPLE[2]].map((person, i) => ({ id: 'v' + i, person }) as never) } : p));
    const L = aislesLayout(m, { w: 1408, h: 817 }, { ...META, pixelArt } as RealMeta, SIGNS(1)), f = (L.fixtures as Array<{ id: string; visitors: Array<{ face: Rect | null }> }>).find((x) => x.id === 'boss')!;
    const xs = f.visitors.map((v) => v.face!.x);
    assert.ok(xs.length >= 2, 'two visitors shown at the Boss');
    return xs[1] - xs[0];
  };
  const px = lobby(true), flat = lobby(false);
  assert.ok(px >= 1.9 * flat, `the lobby: a pixel world's visitors ${px.toFixed(1)} px apart, a flat world's ${flat.toFixed(1)}`);
}

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
// ---- spec 097 FR-248 (owner 2026-11-06, issue #1220): the arcade's lounge seats, in cells after the cabinets ----
{
  let lc = 0;
  for (const [W, H] of SIZES) for (const n of [2, 3, 5, 8, 12, 15, 20, 40]) for (const f of [1, 2, 3, 4, 6]) {
    if (f >= n) continue;
    for (const nl of [...new Set([1, 2, 4, Math.floor(n / 3), n - f])].filter((x) => x >= 1 && x <= n - f)) {
      const m = model(n, f, ['working', 'waiting', 'thinking', 'error', 'done', 'idle']);
      m.folders.forEach((fo) => fo.agents.forEach((a) => { a.away = null; }));
      let left = nl;
      for (let j = 1; left > 0 && j < n; j++) for (const fo of m.folders) if (left > 0 && fo.agents[j]) { fo.agents[j].lounge = true; fo.agents[j].state = left % 2 ? 'done' : 'asleep'; left--; }
      const L = aislesLayout(m, { w: W, h: H }, META, SIGNS(f)), tag = `${n} agents, ${f} folders, ${nl} in the lounge, ${W}x${H}`, g = L.g as number;
      assert.deepStrictEqual(problems(L, W, n - nl), [], `${tag}: ${problems(L, W, n - nl).slice(0, 4).join('; ')}`);
      const seats = L.lounge ? L.lounge.desks : [], ds = L.zones.flatMap((z) => z.desks), floor: Rect = { x: 0, y: L.lobbyH + (L.lane ? L.lane.h : 0), w: W, h: L.height - L.lobbyH - (L.lane ? L.lane.h : 0) };
      assert.deepStrictEqual(seats.map((d) => d.id), sortDesks(m.folders.flatMap((fo) => fo.agents.filter((a) => a.lounge))).map((a) => a.id), `${tag}: every lounge agent has a seat, in status order`);
      const out: string[] = [];
      seats.forEach((s, i) => {
        if (!s.lounge || !s.table || !s.person || s.person.pose !== 'sit') out.push(`seat ${s.id}: not a stool seat (${s.person && s.person.pose})`);
        for (const r of [s.plate, s.screen, s.table as Rect, s.person as Rect, s.face as Rect]) if (!inside(r, floor, 1)) out.push(`seat ${s.id} leaves the floor ${JSON.stringify(r)}`);
        for (const d of ds) for (const [nm, q] of [['cabinet', d.desk], ['player', d.stand as Rect], ['plate', d.plate], ['glass', d.glass], ['face', d.face as Rect]] as [string, Rect][]) for (const r of [s.plate, s.screen, s.table as Rect, s.person as Rect]) if (inter(r, q, 0.5)) out.push(`seat ${s.id} is on the ${nm} of ${d.id}`);
        for (const z of L.zones) for (const r of [s.slot, s.plate, s.screen, s.table as Rect, s.person as Rect]) if (inter(r, z.sign, 0.5)) out.push(`seat ${s.id} is under the sign of ${z.id}`);
        if (L.lane) for (const r of [s.plate, s.screen, s.table as Rect, s.person as Rect]) if (inter(r, L.lane, 0.5)) out.push(`seat ${s.id} is in the pill lane`);
        if (inter(s.face as Rect, s.screen, 0.5) || inter(s.face as Rect, s.table as Rect, 0.5) || inter(s.person as Rect, s.screen, 0.5)) out.push(`seat ${s.id}: the monitor covers the person`);
        if ((s.face as Rect).h < 24) out.push(`seat ${s.id}: face ${(s.face as Rect).h}px`);
        if (s.slot.y !== s.person!.y || s.slot.y + s.slot.h !== s.plate.y + s.plate.h) out.push(`seat ${s.id}: its box is not its person and plate (it would reach into the next row's sign strip)`);
        if (s.plate.w < 84) out.push(`seat ${s.id}: plate ${s.plate.w}px`);
        for (const v of [s.person!.x, s.person!.y, s.table!.x, s.table!.y, s.screen.x, s.screen.y]) if (!Number.isInteger(v)) { out.push(`seat ${s.id}: ${v} is not on a whole pixel (FR-255)`); break; }
        seats.forEach((o, j) => { if (j > i) for (const a of [s.plate, s.screen, s.table as Rect, s.person as Rect]) for (const b of [o.plate, o.screen, o.table as Rect, o.person as Rect]) if (inter(a, b, 0.5)) { out.push(`seats ${s.id} and ${o.id} overlap`); return; } });
      });
      assert.deepStrictEqual(out, [], `${tag}: ${out.slice(0, 4).join('; ')}`);
      if (n <= 15) assert.ok(!L.scroll, `${tag}: no scroll at the 15-agent scale`);
      /* never worse than with those agents at cabinets: the hall's scale is at least as large */
      const all = JSON.parse(JSON.stringify(m)) as RealModel; all.folders.forEach((fo) => fo.agents.forEach((a) => { a.lounge = false; }));
      const L0 = aislesLayout(all, { w: W, h: H }, META, SIGNS(f));
      assert.ok(g >= (L0.g as number) && (L.scroll ? 1 : 0) <= (L0.scroll ? 1 : 0), `${tag}: the hall is smaller than with everyone at a cabinet (g ${L0.g} -> ${g})`);
      lc++;
    }
  }
  console.log(`arcade lounge: ${lc} layouts`);
}
{
  // spec 097 FR-345 (T260, issue #1152): a folder with a saved desk order keeps it in the cabinet rows; one without is sorted by status
  const mk = (keep: boolean): RealModel => ({ folders: [
    { id: 'k', keep, agents: [{ id: 'k0', state: 'idle', person: PEOPLE[0], away: null }, { id: 'k1', state: 'waiting', person: PEOPLE[1], away: null }, { id: 'k2', state: 'working', person: PEOPLE[2], away: null }, { id: 'k3', state: 'error', person: PEOPLE[3], away: null }] },
    { id: 'o', agents: [{ id: 'o0', state: 'idle', person: PEOPLE[4], away: null }, { id: 'o1', state: 'waiting', person: PEOPLE[5], away: null }] } ],
    places: ['library', 'software', 'terminal', 'web', 'other', 'coffee', 'boss', 'bank', 'postbox'].map((id) => ({ id, visitors: [] })) });
  for (const [W, H] of SIZES) {
    const ids = (L: Layout, z: string): string[] => (L.zones.find((q) => q.id === z) as { desks: { id: string }[] }).desks.map((d) => d.id);
    assert.deepStrictEqual(ids(aislesLayout(mk(true), { w: W, h: H }, META), 'k'), ['k0', 'k1', 'k2', 'k3'], `FR-345 ${W}: a kept folder keeps the model's order in the arcade`);
    assert.deepStrictEqual(ids(aislesLayout(mk(false), { w: W, h: H }, META), 'k'), ['k1', 'k3', 'k2', 'k0'], `FR-345 ${W}: a folder without a saved order is sorted by status in the arcade`);
    assert.deepStrictEqual(ids(aislesLayout(mk(true), { w: W, h: H }, META), 'o'), ['o1', 'o0'], `FR-345 ${W}: another folder is still sorted by status`);
  }
}

// ---- spec 097 FR-306, FR-308 (issue #1139): one row of helper heads under each cabinet's plate, by measurement ----
{
  const withH = (n: number, f: number, h: number): RealModel => { const m = model(n, f); m.folders.forEach((fo) => fo.agents.forEach((a) => { a.helpers = h; })); return m; };
  let strips = 0, fell = 0;
  for (const [i, [W, H]] of SIZES.entries()) for (const [n, f] of [[3, 1], [8, 2], [15, 4], [20, 4]] as [number, number][]) for (const h of [0, 2, 10]) {
    const m = withH(n, f, h), L = aislesLayout(m, { w: W, h: H }, META, SIGNS(f)), base = aislesLayout(withH(n, f, 0), { w: W, h: H }, META, SIGNS(f)), label = `${n} agents, ${h} helpers, ${NAMES[i]}`;
    const ds = L.zones.flatMap((z) => z.desks);
    if (h === 0) { assert.strictEqual(JSON.stringify(L), JSON.stringify(base), `${label}: no helpers, no change`); continue; }
    if (!L.helpRows) { fell++; assert.ok(ds.every((d) => !d.strip), `${label}: the fallback draws no strip`); continue; }
    assert.ok(!L.scroll === !base.scroll || n > 15, `${label}: strips do not start a scroll`);
    for (const d of ds) {
      const t = d.strip!;
      assert.ok(t, `${label}: ${d.id} has a strip`); strips++;
      assert.ok(inside(t, d.slot, 0.5), `${label}: strip of ${d.id} inside its slot`);
      assert.ok(t.y >= d.plate.y + d.plate.h - 0.5 && !inter(t, d.plate) && !inter(t, d.screen) && !(d.person && inter(t, d.person.vis)), `${label}: strip of ${d.id} touches nothing of its own cabinet`);
      assert.ok(t.cols * 30 + (t.cols - 1) * 4 <= t.w + 0.01 && t.shown <= t.cols && t.shown === (h <= t.cols ? h : Math.max(0, t.cols - 1)), `${label}: shown ${t.shown} of ${h} in ${t.cols} across`);
      for (const o of ds) if (o !== d) { assert.ok(!inter(t, o.strip!), `${label}: two strips overlap`); assert.ok(!inter(t, o.plate) && !inter(t, o.screen), `${label}: a strip over another cabinet`); }
    }
  }
  assert.ok(strips > 50 && fell >= 1, `arcade strips ran (${strips} strips, ${fell} layouts fell back to +N)`);
  const at15 = aislesLayout(withH(15, 4, 10), { w: 1440, h: 848 }, META, SIGNS(4));
  assert.ok(at15.helpRows === 1 && !at15.scroll && at15.faceH >= FACE_FLOOR, 'arcade, 15 agents at 1440x848: one row of heads, no scroll, face over the ratchet');
  assert.strictEqual(at15.g, aislesLayout(withH(15, 4, 0), { w: 1440, h: 848 }, META, SIGNS(4)).g, 'arcade, 15 agents at 1440x848: the strips keep the hall\'s scale (g)');
  const at15s = aislesLayout(withH(15, 4, 10), { w: 1280, h: 748 }, META, SIGNS(4));
  assert.strictEqual(at15s.helpRows, 0, 'arcade, 15 agents at 1280x748: no room, the plates keep +N (a recorded limit)');
  console.log(`arcade helper heads: ${strips} strips, ${fell} fallbacks`);
}

/* spec 097 T247: the default arcade is unchanged by the crews' scaling: the Retro pixel people (pixelPeople unset, k 1) give the layout they gave before it. The hash is of every
   layout below (4, 12, 15 agents, both sizes), taken from the code before the change; a change here moves a pixel-art arcade, which is not what the crews' wiring may do.
   Re-taken on purpose by spec 102 FR-308 (2026-11-09): `big` is now "4 or fewer" (it was the cabinet's kind: true for 12 and 15 agents, false for some groups of 4) (the plans did not move). Its two floors stay 848 and 748 px high on purpose (spec 102 T309): the hash pins the layout code, not the app's rooms. */
{
  const h = crypto.createHash('sha256');
  for (const [W, H] of [[1440, 848], [1280, 748]]) for (const n of [4, 12, 15]) h.update(JSON.stringify(aislesLayout(model(n, 4, STATES, n > 4 ? 3 : 0), { w: W, h: H }, META, SIGNS(4))));
  const got = h.digest('hex');
  console.log(`arcade, Retro pixel people layout hash ${got}`);
  assert.strictEqual(got, '7c469f199d1ea68917bf09721a2bf96362a5b18a6a40c91d6cada1e5c3cf2349', 'the Retro pixel set lays out differently than before the crews were wired');
}

/* spec 097 FR-335, T247: the width cap, checked directly (the cut check above has about 6 grid px of slack). For a set that is not pixel art, the widest frame a person can show at a cabinet,
   times the scale the layout used, is at most AISLE_PW_MAX (48 grid px). The widest frame is found here, not by the layout: every standing person, every pose a cabinet shows (the state's frame,
   else the next that exists), the seat frame excluded. A synthetic set whose widest frame belongs to a LATER person guards a width taken from the first person only. */
{
  const CAP = 48; /* AISLE_PW_MAX */
  const POSE: Record<string, string> = { working: 'type', thinking: 'book', error: 'knock', waiting: 'face-knock', limit: 'face-knock', done: 'face-coffee', idle: 'face-book', asleep: 'sit' };
  const NEXT: Record<string, string[]> = { 'face-knock': ['knock'], 'face-coffee': ['counter', 'coffee'], 'face-book': ['book'], sit: ['face-book', 'book'], type: ['book'] };
  const shownFrame = (st: { poses: Record<string, number[]> }, state: RealState): string | null => { const pose = POSE[state]; return [pose, ...(NEXT[pose] || [])].find((p) => Object.prototype.hasOwnProperty.call(st.poses, p)) ?? null; };
  const capCheck = (label: string, set: RealMeta): number => {
    const M = { ...readJson('worlds', 'retro', 'world.json'), ...set, pixelPeople: false } as unknown as RealMeta;
    const ids = Object.keys(set.stand), pairs: [string, RealState][] = ids.flatMap((id) => STATES.map((s) => [id, s] as [string, RealState]));
    let widest = 0, widestWho = '', worst = 0, worstWho = '', seen = 0;
    for (const id of ids) for (const state of STATES) { const f = shownFrame(set.stand[id], state); if (f && set.stand[id].poses[f][0] > widest) { widest = set.stand[id].poses[f][0]; widestWho = `${id}/${f}`; } }
    assert.ok(widest > 0, `${label}: the set shows no frame at a cabinet`);
    for (let at = 0; at < pairs.length; at += 15) {
      const chunk = pairs.slice(at, at + 15), m = model(chunk.length, 4, STATES);
      let i = 0; m.folders.forEach((f) => f.agents.forEach((a) => { const [id, state] = chunk[i++]; a.person = id; a.state = state; a.away = null; }));
      const L = aislesLayout(m, { w: 1440, h: 848 }, M, SIGNS(4)), g = L.g as number;
      for (const z of L.zones) for (const d of z.desks) {
        const pr = d.person!; seen++;
        if (pr.w / g > worst) { worst = pr.w / g; worstWho = `${pr.pid}/${pr.pose}`; }
      }
    }
    assert.ok(seen >= pairs.length - 15, `${label}: ${seen} of ${pairs.length} person and state pairs drawn`);
    assert.ok(worst <= CAP, `${label}: the width cap is broken: its widest frame (${widestWho}, ${widest} px) is drawn ${worst} grid px wide (${worstWho}), the cap is ${CAP}`);
    return widest;
  };
  for (const crew of ['pirate', 'royal', 'rebels', 'monster', 'cheeky', 'prehistoric']) capCheck(`width cap, ${crew}`, readJson('sets', crew, 'set.json') as unknown as RealMeta);
  /* a fixture: the first person is narrow, the second's knock is wide (300 px for 350 tall: 72/350 alone would make it 61.7 grid px) */
  const base = readJson('sets', 'pirate', 'set.json') as unknown as RealMeta, ids = Object.keys(base.stand).sort();
  const clone = JSON.parse(JSON.stringify(base)) as RealMeta;
  clone.stand = {}; clone.seat = {};
  ids.slice(0, 2).forEach((id, n) => {
    const st = JSON.parse(JSON.stringify(base.stand[id])); st.figH = 350;
    for (const p of Object.keys(st.poses)) st.poses[p] = [n === 0 ? 120 : 200, 350];
    if (n === 1) st.poses.knock = [300, 350];
    clone.stand[id] = st; clone.seat[id] = base.seat[id];
  });
  assert.strictEqual(capCheck('width cap, synthetic set (narrow first person, wide later one)', clone), 300);
}
/* spec 097 FR-335, T247: another set's people in the arcade. A crew's hi-res frames (350 px tall) are scaled to the arcade's people (72 grid px) and its standing poses
   (book, coffee, knock, letter, runA, runB: no `type`, `sit` or `counter`) fall back, so every player at a cabinet is drawn, at the arcade's size, on the grid. */
{
  let drawn = 0;
  for (const crew of ['pirate', 'royal', 'rebels', 'monster', 'cheeky', 'prehistoric']) {
    const set = readJson('sets', crew, 'set.json') as unknown as RealMeta, ids = Object.keys(set.seat).sort();
    const M = { ...readJson('worlds', 'retro', 'world.json'), ...set, pixelPeople: false } as unknown as RealMeta;
    for (const [W, H] of SIZES) for (const n of [4, 15]) {
      const m = model(n, 4, STATES), shown = new Set<string>();
      m.folders.forEach((f) => f.agents.forEach((a, i) => { a.person = ids[(i + a.id.length) % ids.length]; a.away = null; }));
      const L = aislesLayout(m, { w: W, h: H }, M, SIGNS(4));
      assert.ok(!L.scroll, `${crew}: ${n} agents at ${W}x${H}: the hall fits`);
      const g = L.g as number;
      for (const z of L.zones) for (const d of z.desks) {
        assert.ok(d.person, `${crew}: ${d.state} at a cabinet draws the person (a pose falls back, never the initials)`);
        const pr = d.person!; shown.add(pr.pose); drawn++;
        assert.ok(pr.h <= 72 * g + 1 && pr.h >= 40 * g, `${crew}: a person is the arcade's height (${pr.h} px at g ${g}), not its ${set.stand[pr.pid].poses[pr.pose][1]} picture pixels`);
        assert.ok(pr.w % g === 0 && pr.h % g === 0, `${crew}: the person sits on the grid`);
      }
      const cut = cuts(L.zones.flatMap((z) => z.desks));
      assert.deepStrictEqual(cut, [], `${crew}: ${n} agents at ${W}x${H}: a person is cut by a cabinet or screen (${cut.length}): ${cut.slice(0, 3).join('; ')}`);
      if (n === 15) assert.ok(shown.size >= 3, `${crew}: the states show different frames (${[...shown].join(', ')})`);
    }
  }
  assert.ok(drawn > 200, `crews in the arcade: ${drawn} players checked`);
  console.log(`arcade, other sets' people: ${drawn} players checked`);
}
/* spec 102 FR-308 (issue #1428, SC-003): the arcade's `big` is "4 or fewer" (FR-020), as in every world, and its screens show 8 lines of 11 px or more. The floors the app really draws are
   1408 and 1248 px wide (the window less its margins; the driver reads them from `realLayout`). 1 to 4 agents at 1408 and 1 to 2 at 1248, with or without helpers, hold 8 lines.
   [KNOWN GAP] 3 and 4 agents at 1248 (the 1280x800 window): no hall holds a 128 px glass (a big cabinet at g 3 needs 1260 px of 1232 across; at g 4 even the small one needs 1452 or 670 px
   of height), so the screens are 96 px tall and show 5 lines of 11 px (the driver counts 6 drawn). This fails the day it holds 8, so FR-308's number is changed with it. */
{
  const FLOORS: [number, number][] = [[1408, 848], [1248, 748]];
  const rowsOf = (n: number, f: number, W: number, H: number, hp: number): { rows: number; font: number; big: boolean } => {
    const m = model(n, f); m.folders.forEach((fo) => fo.agents.forEach((a) => { a.helpers = hp; }));
    const L = aislesLayout(m, { w: W, h: H }, META, SIGNS(f)), d = L.zones[0].desks[0], fit = screenFit(d.glass, L.g);
    return { rows: fit.rows, font: fit.font, big: L.big };
  };
  for (const [W, H] of FLOORS) for (const hp of [0, 3]) for (const n of [1, 2, 3, 4]) for (const f of [1, n]) {
    const r = rowsOf(n, f, W, H, hp);
    assert.ok(r.big, `FR-308: ${n} agents at ${W}x${H}: big`);
    if (W === 1248 && n >= 3) { assert.ok(r.rows < 8 && r.rows >= 5, `KNOWN GAP changed: ${n} agents at ${W}x${H} show ${r.rows} lines; make FR-308 say so`); continue; }
    assert.ok(r.rows >= 8 && r.font >= 11, `FR-308: ${n} agents (${f} folders, ${hp} helpers) at ${W}x${H}: ${r.rows} lines of ${r.font} px, 8 of 11 px or more owed`);
  }
  for (const [W, H] of FLOORS) for (const n of [5, 8, 12, 15]) assert.ok(!rowsOf(n, 4, W, H, 0).big, `FR-308: ${n} agents at ${W}x${H}: not big`);
  console.log('arcade big screens: 8 lines at 1 to 4 agents (1408 wide) and 1 to 2 (1248 wide); 3 and 4 at 1248 is the recorded gap');
}

// ---- spec 102 delta 2026-11-14 (spec 097 FR-104, FR-116, issue #1268 T223): the All floors view as storeys. A floor starts on a new row when that costs no row, no smaller cabinet and no scroll;
// otherwise the floors share rows and each storey is marked by its tag and a rule where it starts. 15 agents fit both sizes over 1, 2 and 3 floors; a tag never covers a sign or another tag.
{
  const FLS: RealFloor[] = [{ id: 'g', name: 'Ground floor', n: 1 }, { id: 'c', name: 'Client A', n: 2 }, { id: 'p', name: 'Personal', n: 3 }, { id: 't', name: 'Top floor', n: 4 }, { id: 's', name: 'Sky', n: 5 }, { id: 'u', name: 'Sixth', n: 6 }].map((f) => ({ ...f, w: 6.5 * (2 + f.name.length) })); // each with a measured text width, as the renderer passes it (the sign's 12 px bold, about 6.5 px a letter)
  const fm = (sizes: number[], floorOf: number[]): RealModel => { let i = 0; return { folders: sizes.map((n, fi) => ({ id: 'f' + fi, floor: FLS[floorOf[fi]], agents: Array.from({ length: n }, () => { const k = i++; return { id: 'a' + k, state: 'working' as RealState, person: PEOPLE[k % 15], away: null }; }) })), places: ['library', 'boss'].map((id) => ({ id, visitors: [] })) }; };
  const sg = (n: number): Record<string, { name: string; path: string; counts: number }> => Object.fromEntries(Array.from({ length: n }, (_, i) => ['f' + i, { name: 'project-' + i, path: '~/work/p' + i, counts: 3 }]));
  const flat = (m: RealModel): RealModel => ({ ...m, folders: m.folders.map((f) => ({ ...f, floor: undefined })) });
  // [name, agents per folder, floor index per folder (top floor first), forced rows expected]
  const CASES: Array<[string, number[], number[], boolean]> = [
    ['15: 5/5/5', [5, 5, 5], [2, 1, 0], true], ['15: 4+1 on each floor', [4, 1, 4, 1, 4, 1], [2, 2, 1, 1, 0, 0], true], ['12: 4/4/4', [4, 4, 4], [2, 1, 0], true], ['9: 3/3/3', [3, 3, 3], [2, 1, 0], true],
    ['15: 6/5/4', [6, 5, 4], [2, 1, 0], false], ['15: 7/4/4', [7, 4, 4], [2, 1, 0], false], ['15: 3,3,3,3,3 on 3 floors', [3, 3, 3, 3, 3], [2, 2, 1, 0, 0], false], ['15: 8/7 on 2 floors', [8, 7], [1, 0], false],
    ['15: 1/1/13', [1, 1, 13], [2, 1, 0], false], ['12: 6/3/3', [6, 3, 3], [2, 1, 0], false], ['13: 5/5/3', [5, 5, 3], [2, 1, 0], true], ['14: 5/5/4', [5, 5, 4], [2, 1, 0], true],
  ];
  const rowOf = (L: Layout, y: number): number => [...new Set(L.zones.map((z) => z.sign.y))].sort((a, b) => a - b).indexOf(y);
  for (const [W, H] of [[1408, ROOM.h900], [1248, ROOM.h800]] as Array<[number, number]>) for (const [name, sz, fl, forcedRows] of CASES) {
    const tag = `${name} at ${W}x${H}`, m = fm(sz, fl), L = aislesLayout(m, { w: W, h: H }, META, sg(sz.length)), F = aislesLayout(flat(m), { w: W, h: H }, META, sg(sz.length));
    const floors = new Set(fl).size;
    assert.ok(!L.scroll, `${tag}: the hall does not scroll`);
    assert.ok(L.g === F.g && L.cabinet!.gw === F.cabinet!.gw && L.cabinet!.rows === F.cabinet!.rows, `${tag}: the same scale, cabinet and rows as the hall without floors`);
    const S = L.storeys!; assert.ok(S && S.length === floors, `${tag}: ${floors} storeys are marked`);
    assert.deepStrictEqual(S.map((b) => b.n), [...new Set(fl)].map((i) => FLS[i].n), `${tag}: the storeys are in the building's order, top floor first`); // reading order
    assert.deepStrictEqual(S.map((b) => b.name), [...new Set(fl)].map((i) => FLS[i].name), `${tag}: each storey carries its floor's name`);
    S.forEach((b, i) => { if (i) { const a = S[i - 1]; assert.ok(a.tag.y < b.tag.y || (a.tag.y === b.tag.y && a.tag.x < b.tag.x), `${tag}: the tag of ${b.name} comes after the tag of ${a.name} in reading order`); } });
    const signs = L.zones.map((z) => z.sign);
    for (const [i, b] of S.entries()) {
      assert.ok(b.tag.x >= 0 && b.tag.x + b.tag.w <= W && b.tag.h === 18 && b.tag.w >= storeyTagW(FLS.find((f) => f.n === b.n)!), `${tag}: the tag of ${b.name} is whole inside the hall`);
      assert.ok(inside(b.tag, { x: 0, y: 0, w: W, h: L.height }), `${tag}: the tag of ${b.name} is in the hall`);
      assert.ok(!signs.some((sn) => inter(sn, b.tag)), `${tag}: the tag of ${b.name} covers no sign`);
      assert.ok(!S.some((o, j) => j !== i && inter(o.tag, b.tag)), `${tag}: the tag of ${b.name} covers no other tag`);
      assert.ok(!L.zones.some((z) => z.desks.some((d) => inter(b.tag, d.desk))), `${tag}: the tag of ${b.name} covers no cabinet`);
      assert.ok(L.zones.some((z) => z.sign.y === b.tag.y && z.sign.y === b.box.y && Math.abs(z.sign.x + z.sign.w + 4 - b.tag.x) <= 1), `${tag}: the tag stands in the sign strip of the storey's first zone, just after its sign`);
      if (i) assert.ok(b.slab && (forcedRows ? b.slab.w === W - 2 * 8 && b.slab.y + b.slab.h <= b.box.y : b.slab.w === 2 && b.slab.h === 18 && b.slab.y === b.box.y), `${tag}: the rule at the start of ${b.name} is ${forcedRows ? 'horizontal, above its first row' : 'upright, in the strip before its first zone'}`);
      else assert.strictEqual(b.slab, null, `${tag}: the top storey has no rule`);
    }
    if (forcedRows) {
      for (let i = 1; i < S.length; i++) assert.ok(S[i].box.y >= S[i - 1].box.y + S[i - 1].box.h + STOREY_GAP, `${tag}: the band of ${S[i].name} starts ${STOREY_GAP} px under the band above: no two bands overlap`);
      assert.ok(S.every((b) => new Set(L.zones.filter((z) => z.sign.y === b.box.y).map((z) => z.id)).size >= 1) && new Set(S.map((b) => b.box.y)).size === S.length, `${tag}: every storey starts on a row of its own`);
    }
    assert.ok(Math.max(...L.zones.map((z) => z.box.y + z.box.h)) <= L.height - 7, `${tag}: the last row, with the rules between storeys counted, ends inside the hall`);
    const rowsUsed = new Set(L.zones.map((z) => rowOf(L, z.sign.y)));
    assert.ok(rowsUsed.size <= L.cabinet!.rows, `${tag}: no more rows than the hall has`);
    cases++;
  }
  // forced only when free: 15 agents 6/5/4 share rows (a forced break would make 4 rows and scroll), 5/5/5 do not
  const share = aislesLayout(fm([6, 5, 4], [2, 1, 0]), { w: 1248, h: ROOM.h800 }, META, sg(3)), own = aislesLayout(fm([5, 5, 5], [2, 1, 0]), { w: 1248, h: ROOM.h800 }, META, sg(3));
  assert.strictEqual(share.cabinet!.rows, 3, 'a floor that would cost a row shares the row of the floor above (6/5/4): three rows, not four');
  assert.strictEqual(new Set(own.storeys!.map((b) => b.box.y)).size, 3, 'floors of five agents each stand on rows of their own (5/5/5)');
  assert.ok(share.storeys!.some((b) => b.slab && b.slab.w === 2) && own.storeys!.filter((b) => b.slab).every((b) => b.slab!.w > 100), 'the rules: upright where a floor starts mid-row, across where it starts a row');
  // one floor with folders, or a world that does not draw storeys, draws none
  assert.strictEqual(aislesLayout(fm([5, 5], [0, 0]), { w: 1248, h: ROOM.h800 }, META, sg(2)).storeys, undefined, 'two folders on one floor: no storeys');
  assert.strictEqual(aislesLayout(fm([5, 5, 5], [2, 1, 0]), { w: 1248, h: ROOM.h800 }, { ...META, storeys: false }, sg(3)).storeys, undefined, 'a world without `storeys` draws none');
  assert.strictEqual(JSON.stringify(aislesLayout(fm([5, 5, 5], [2, 1, 0]), { w: 1248, h: ROOM.h800 }, { ...META, storeys: false }, sg(3))), JSON.stringify(aislesLayout(flat(fm([5, 5, 5], [2, 1, 0])), { w: 1248, h: ROOM.h800 }, META, sg(3))), 'a world without `storeys` lays out exactly as before');
  // the shared rule (`storeyRuns`) is the one every arrangement uses; the `rows` arrangement (`realLayout`, Photo and cave) uses it too (spec 097 T113, the block below)
  const runs = storeyRuns(fm([5, 5, 5], [2, 1, 0]).folders);
  assert.deepStrictEqual(runs && runs.map((r) => [r.floor.id, r.from, r.to]), [['p', 0, 1], ['c', 1, 2], ['g', 2, 3]], 'storeyRuns: one run per floor, in the given order');
  assert.strictEqual(storeyRuns(fm([5, 5], [0, 0]).folders), null, 'storeyRuns: one floor is no storeys');
  assert.strictEqual(storeyRuns(fm([2, 2, 2], [0, 1, 0]).folders), null, 'storeyRuns: a floor split in two runs is not storeys (the app sorts by floor first)');
  // ---- review of #1741 (spec 102 delta 2026-11-14): the four fixes
  const fmx = (sizes: number[], floorOf: number[], o: { rest?: number[]; helpers?: boolean; w?: number; swap?: boolean } = {}): RealModel => { const m = fm(sizes, floorOf); let i = 0; return { ...m, folders: m.folders.map((f) => ({ ...f, floor: f.floor && o.w !== undefined ? { ...f.floor, w: o.w } : f.floor, agents: f.agents.map((a) => { const k = i++; return { ...a, ...(o.helpers ? { helpers: 1 } : {}), ...(o.rest && o.rest.includes(k) ? { lounge: true, state: ((o.rest.indexOf(k) % 2 === 0) !== !!o.swap ? 'error' : 'idle') as RealState } : {}) }; }) })) }; }; /* swap: the resting agents' status order the other way round, so the lounge's order is not the building's */
  const SZ2: Array<[string, number, number]> = [['1440x900', 1408, ROOM.h900], ['1280x800', 1248, ROOM.h800]];
  // (1) resting agents (spec 097 FR-248): a resting agent's seat stands at the end of its own floor's folders, never in another floor's band or row run: reading order puts the seat after a folder of its own floor
  const floorOfAgent = (m: RealModel, id: string): string => m.folders.find((f) => f.agents.some((a) => a.id === id))!.floor!.id;
  const seatPrev = (L: Layout, d: DeskBox, m: RealModel): string => { /* the folder just before the seat in reading order (row, then x); its floor is the seat's floor */
    const ys = [...new Set(L.zones.map((z) => z.sign.y))].sort((x, y) => x - y), beyond = d.plate.y > ys[ys.length - 1] + L.cabinet!.h + 18 + 21 + 40, row = ys.filter((y) => y <= d.plate.y).length - 1;
    const before = L.zones.filter((z) => beyond || z.sign.y < ys[row] || (z.sign.y === ys[row] && z.box.x < d.slot.x)).sort((p1, p2) => p1.sign.y - p2.sign.y || p1.box.x - p2.box.x);
    return m.folders.find((f) => f.id === before[before.length - 1].id.split('\u0000')[0])!.floor!.id;
  };
  for (const swap of [false, true]) for (const [nm, W, H] of SZ2) for (const [name, sz, fl, rest] of [['5/5/3, two resting on two floors', [5, 5, 3], [2, 1, 0], [7, 12]], ['4/4/4, one resting on each floor', [4, 4, 4], [2, 1, 0], [1, 5, 9]], ['3/3/3, one resting on each floor', [3, 3, 3], [2, 1, 0], [1, 4, 7]], ['5/5 on 2 floors, two resting', [5, 5], [1, 0], [2, 8]], ['2/2/2 sharing rows, three resting', [2, 2, 2], [2, 1, 0], [0, 3, 5]], ['6/5/4 sharing rows, two resting', [6, 5, 4], [2, 1, 0], [0, 7]], ['4/4/4/3, two resting', [4, 4, 4, 3], [2, 2, 1, 0], [0, 9]]] as Array<[string, number[], number[], number[]]>) {
    const tag = `${name} at ${nm}${swap ? ' (status order swapped)' : ''}`, m = fmx(sz, fl, { rest, swap }), L = aislesLayout(m, { w: W, h: H }, META, sg(sz.length)), F0 = aislesLayout(flat(m), { w: W, h: H }, META, sg(sz.length));
    assert.ok(!L.scroll && L.lounge && L.lounge.desks.length === rest.length && L.storeys && L.storeys.length === new Set(fl).size, `${tag}: storeys drawn, the resting agents seated, no scroll`);
    assert.ok(L.g === F0.g && L.cabinet!.gw === F0.cabinet!.gw, `${tag}: the resting seats cost no scale and no cabinet`);
    for (const d of L.lounge!.desks) {
      assert.strictEqual(seatPrev(L, d, m), floorOfAgent(m, d.id), `${tag}: the seat of ${d.id} comes after a folder of its own floor, not another floor's`);
      const mine = L.storeys!.filter((b) => b.box.y <= d.slot.y + 1 && d.slot.y + d.slot.h <= b.box.y + b.box.h + 1 && b.box.x <= d.slot.x + 1 && d.slot.x + d.slot.w <= b.box.x + b.box.w + 1);
      assert.ok(mine.length >= 1, `${tag}: the seat of ${d.id} is inside a storey band`);
      for (const b of L.storeys!) assert.ok(!inter(b.tag, d.slot) && !inter(b.tag, d.plate) && !inter(b.tag, d.desk), `${tag}: the tag of ${b.name} covers no resting seat`);
      assert.ok(inside(d.slot, { x: 0, y: 0, w: W, h: L.height }, 1), `${tag}: the seat of ${d.id} is inside the hall`);
    }
    if (L.storeys!.every((b) => !b.slab || b.slab.w > 100)) for (const d of L.lounge!.desks) { /* floors on rows of their own: the seat is in no band but its own floor's */
      const own = L.storeys!.findIndex((b) => b.name === FLS.find((f) => f.id === floorOfAgent(m, d.id))!.name);
      L.storeys!.forEach((b, i) => { if (i !== own) assert.ok(!inter(d.slot, b.box) && !inter(d.plate, b.box), `${tag}: the seat of ${d.id} lies in the band of ${b.name}, a floor it is not on`); });
    }
    cases++;
  }
  // when a seat beside its floor would cost the hall (the cabinet, a scroll, a folder kept whole), or its floor has no folder here, the seats stay in the free cells at the rows' ends as FR-248 has them, under their own tag
  // "Resting" and an upright rule: no floor's band holds them, the hall is the one without floors, and the floors' tags are as before
  for (const [nm, W, H, sz, fl, rest] of [['a floor whose agents all rest', 1248, ROOM.h800, [5, 3, 3], [2, 1, 0], [5, 6, 7]], ['the top floor all rests', 1248, ROOM.h800, [3, 3, 3], [2, 1, 0], [0, 1, 2]], ['2/5 with one resting (the seat beside its floor would cost the cabinet)', 1408, ROOM.h900, [2, 5], [1, 0], [2]], ['the arcade demo: 3/4/2/4/2 on three floors, two resting', 1248, ROOM.h800, [3, 4, 2, 4, 2], [2, 1, 1, 0, 0], [8, 10]], ['the same at 1440x900', 1408, ROOM.h900, [3, 4, 2, 4, 2], [2, 1, 1, 0, 0], [8, 10]]] as Array<[string, number, number, number[], number[], number[]]>) {
    const m = fmx(sz, fl, { rest }), L = aislesLayout(m, { w: W, h: H }, META, sg(sz.length)), F0 = aislesLayout(flat(m), { w: W, h: H }, META, sg(sz.length));
    const rb = L.storeys && L.storeys.find((b) => b.n === 0);
    assert.ok(L.storeys && rb && L.storeys[L.storeys.length - 1] === rb && L.storeys.filter((b) => b.n > 0).length >= 2, `${nm}: the floors' storeys and a Resting band after them`);
    assert.strictEqual(L.lounge && L.lounge.desks.length, rest.length, `${nm}: every resting agent is seated`);
    assert.ok(!L.scroll && L.g === F0.g && L.cabinet!.gw === F0.cabinet!.gw, `${nm}: the hall is as without floors (scale, cabinet, no scroll)`);
    for (const d of L.lounge!.desks) assert.ok(inside(d.slot, rb!.box, 1), `${nm}: the seat of ${d.id} is in the Resting band`);
    for (const b of L.storeys!) {
      for (const d of L.lounge!.desks) assert.ok(!inter(b.tag, d.slot) && !inter(b.tag, d.plate) && !inter(b.tag, d.desk), `${nm}: the tag of ${b.name} covers no resting seat`);
      assert.ok(!L.zones.some((z) => inter(z.sign, b.tag) || z.desks.some((d) => inter(b.tag, d.desk))) && !L.storeys!.some((o) => o !== b && inter(o.tag, b.tag)), `${nm}: the tag of ${b.name} covers no sign, cabinet or other tag`);
    }
    assert.ok(rb!.tag.y <= Math.min(...L.lounge!.desks.map((d) => d.slot.y)) && rb!.tag.x >= 0 && rb!.tag.x + rb!.tag.w <= W && rb!.slab!.w === 2, `${nm}: the Resting tag stands over the seats, inside the hall, with an upright rule`);
    cases++;
  }
  // round 2 of the review of #1741: the Resting tag and rule are clear of every floor's tag and rule, folder sign, cabinet and seat. The reviewer's case (2/1/3/2 on 4 floors, one resting from the third folder), then a fuzz
  const clearOf = (L: Layout, tag: string): void => {
    const rb = L.storeys!.find((b) => b.n === 0), marks = L.storeys!.filter((b) => b !== rb).flatMap((b) => [{ n: `the tag of ${b.name}`, r: b.tag }, ...(b.slab ? [{ n: `the rule of ${b.name}`, r: b.slab }] : [])]);
    if (!rb) return;
    for (const m of marks) assert.ok(!inter(rb.tag, m.r) && !inter(rb.slab!, m.r), `${tag}: the Resting tag and rule are clear of ${m.n}`);
    assert.ok(!L.zones.some((z) => inter(z.sign, rb.tag) || inter(z.sign, rb.slab!) || z.desks.some((d) => inter(rb.tag, d.desk))) && !L.lounge!.desks.some((d) => inter(rb.tag, d.slot) || inter(rb.tag, d.plate)), `${tag}: the Resting tag covers no sign, cabinet or seat`);
    assert.ok(rb.tag.x >= 0 && rb.tag.x + rb.tag.w <= L.width, `${tag}: the Resting tag is inside the hall`);
  };
  for (const [nm, W, H] of SZ2) {
    const m = fmx([2, 1, 3, 2], [3, 2, 1, 0], { rest: [3] }), L = aislesLayout(m, { w: W, h: H }, META, sg(4));
    assert.ok(L.lounge && L.lounge.desks.length === 1, `reviewer's case at ${nm}: the resting agent is seated`);
    const rb0 = L.storeys && L.storeys.find((b) => b.n === 0), fl0 = L.storeys && L.storeys.find((b) => b.name === 'Personal');
    assert.ok(rb0 && fl0 && rb0.tag.y === fl0.tag.y && rb0.tag.x >= fl0.tag.x + fl0.tag.w + 6, `reviewer's case at ${nm}: the Resting tag starts after the tag of Personal in the same strip, 6 px clear (it is not dropped, and not over it)`);
    if (L.storeys) { assert.ok(L.storeys.length >= 2, `reviewer's case at ${nm}: storeys or none`); clearOf(L, `reviewer's case (2/1/3/2 on 4 floors, one resting) at ${nm}`); }
  }
  { let seed = 4242; const rnd = (n: number): number => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor((seed / 4294967296) * n); }; let drawn = 0, dropped = 0;
    for (let t = 0; t < 400; t++) {
      const nf = 2 + rnd(5), fls = 2 + rnd(Math.min(4, nf - 1)), sz = Array.from({ length: nf }, () => 1 + rnd(5)); if (sz.reduce((x, y) => x + y, 0) > 15) continue;
      const cuts = [0, ...Array.from({ length: fls - 1 }, () => 1 + rnd(nf - 1))].sort((x, y) => x - y), fl = sz.map((_, i) => fls - 1 - cuts.filter((c) => c <= i && c > 0).length), tot = sz.reduce((x, y) => x + y, 0), rest = Array.from({ length: tot }, (_, i) => i).filter(() => rnd(4) === 0);
      if (!rest.length) continue;
      const [nm, W, H] = SZ2[t % 2], m = fmx(sz, fl.map((f) => Math.min(5, f)), { rest, helpers: rnd(2) === 0, swap: rnd(2) === 0 }), L = aislesLayout(m, { w: W, h: H }, META, sg(nf)), tag = `fuzz ${t} ${JSON.stringify(sz)} floors ${fl.join('')} rest ${rest.join(',')} at ${nm}`;
      const seated = L.lounge ? L.lounge.desks.length : 0, F1 = aislesLayout(flat(m), { w: W, h: H }, META, sg(nf)); assert.ok(seated >= (F1.lounge ? F1.lounge.desks.length : 0), `${tag}: no fewer resting agents seated than in the hall without floors (${seated} of ${rest.length}; the legacy lounge seats fewer than ${rest.length} in some halls, also without floors)`);
      if (!L.storeys) { dropped++; continue; }
      drawn++;
      for (const [i, b] of L.storeys.entries()) { assert.ok(!L.zones.some((z) => inter(z.sign, b.tag)) && !L.storeys.some((o, j) => j !== i && inter(o.tag, b.tag)) && !L.storeys.some((o, j) => j !== i && o.slab && inter(o.slab, b.tag)) && !(b.slab && L.storeys.some((o, j) => j !== i && inter(o.tag, b.slab!))), `${tag}: the tag of ${b.name} is over no sign, tag or rule`); assert.ok(b.tag.x >= 0 && b.tag.x + b.tag.w <= W, `${tag}: the tag of ${b.name} is inside the hall`); }
      clearOf(L, tag);
    }
    assert.ok(drawn > 20, `the fuzz drew storeys with resting agents in ${drawn} splits (and none in ${dropped})`);
    // no run has room: the layout is the one without floors (a floor's tag that cannot be cleared); the case is found by the fuzz's own dropped count below
  }
  // (2) the tag is sized from the measured text: a wider font gives a wider tag, a narrow measure a narrow one, a very long name is capped; with no measure 8 px a letter
  assert.strictEqual(storeyTagW({ id: 'p', name: 'Personal', n: 3, w: 100 }), 116, 'the tag is the measured text plus 16 px of padding and border');
  assert.strictEqual(storeyTagW({ id: 'p', name: 'Personal', n: 3 }), 16 + 8 * 10, 'no measure: 8 px a letter, digits and space included');
  assert.ok(storeyTagW({ id: 'p', name: 'Personal', n: 3, w: 5000 }) <= 16 + 8 * 27, 'a long name is capped');
  { const wide = aislesLayout(fmx([5, 5, 3], [2, 1, 0], { w: 140 }), { w: 1248, h: ROOM.h800 }, META, sg(3)), thin = aislesLayout(fmx([5, 5, 3], [2, 1, 0], { w: 50 }), { w: 1248, h: ROOM.h800 }, META, sg(3));
    assert.ok(wide.storeys!.every((b) => b.tag.w >= 156) && thin.storeys!.every((b) => b.tag.w < 156 && b.tag.w >= 66), 'a wider measured font gives a wider tag in the layout, a narrow one a narrower one'); }
  // (3) a forced break never drops the helper strip: 6 and 4 agents with helpers on two floors at 1280x800 keep the strip the hall without floors had
  for (const [nm, W, H] of SZ2) for (const sz of [[6, 4], [4, 6], [5, 4, 3], [7, 3, 4]]) {
    const fl = sz.length === 2 ? [1, 0] : [2, 1, 0], m = fmx(sz, fl, { helpers: true }), L = aislesLayout(m, { w: W, h: H }, META, sg(sz.length)), F0 = aislesLayout(flat(m), { w: W, h: H }, META, sg(sz.length));
    assert.ok(L.helpRows! >= F0.helpRows! && !L.scroll, `${sz.join('/')} with helpers at ${nm}: the helper strip is kept (${F0.helpRows} without floors, ${L.helpRows} with)`);
  }
  assert.strictEqual(aislesLayout(fmx([6, 4], [1, 0], { helpers: true }), { w: 1248, h: ROOM.h800 }, META, sg(2)).helpRows, 1, '6/4 with helpers at 1280x800: the strip is shown');
  // (4) a folder of 4 or fewer stays whole: 2/4/2/3 (the last on another floor) at 1280x800 would take a forced break that cuts the folder of 4 across two rows; the floors share rows instead
  { const m = fmx([2, 4, 2, 3], [2, 2, 2, 1]), L = aislesLayout(m, { w: 1248, h: ROOM.h800 }, META, sg(4)), parts = new Map<string, number>();
    for (const z of L.zones) parts.set(z.id, (parts.get(z.id) || 0) + 1);
    assert.ok([...parts.values()].every((n) => n === 1), 'keeps a folder of 4 or fewer whole: no forced break that cuts one across rows (2/4/2/3)');
    assert.ok(L.storeys!.length === 2 && L.storeys![1].slab!.w === 2, 'the floors share rows there (an upright rule)'); }
  console.log('storeys: 12 agent splits over 1 to 3 floors at both sizes: no scroll, scale and cabinet as without floors, tags clear of signs, cabinets and each other');
}

// ---- spec 097 delta 2026-11-14 (FR-104, FR-116, T113): the `rows` arrangement (Photo, cave) draws the All floors view as storeys with the same shared rule. A floor starts on a new row only when that is free:
// no row more, no scroll, no helper strip lost, the unit u at most STOREY_U_LOSS smaller; otherwise the floors share rows and an upright rule and the tag mark each storey. Measured on 15 agents at both sizes.
for (const world of ['photo', 'cave']) {
  const WM = { ...readJson('worlds', world, 'world.json'), ...readJson('sets', world === 'cave' ? 'retro' : 'office', 'set.json') } as unknown as RealMeta;
  const WP = Object.keys(WM.seat).sort();
  const FLS: RealFloor[] = [{ id: 'g', name: 'Ground floor', n: 1 }, { id: 'c', name: 'Client A', n: 2 }, { id: 'p', name: 'Personal', n: 3 }, { id: 'd', name: 'Fourth', n: 4 }];
  /* states: working only, or a mix with people waiting at their desks (raised hand) and thinking (dots); helpers: every agent has one */
  const MIX: RealState[] = ['working', 'waiting', 'thinking', 'working', 'limit', 'working', 'thinking', 'waiting'];
  const fm = (sizes: number[], floorOf: number[], o: { mix?: boolean; helpers?: boolean } = {}): RealModel => { let i = 0; return { folders: sizes.map((n, fi) => ({ id: 'f' + fi, floor: FLS[floorOf[fi]], agents: Array.from({ length: n }, () => { const k = i++; return { id: 'a' + k, state: o.mix ? MIX[k % MIX.length] : 'working' as RealState, person: WP[k % WP.length], away: null, ...(o.helpers ? { helpers: 1 } : {}) }; }) })), places: ['library', 'coffee', 'boss'].map((id) => ({ id, visitors: [] })) }; };
  const sg = (n: number): Record<string, { name: string; path: string; counts: number }> => Object.fromEntries(Array.from({ length: n }, (_, i) => ['f' + i, { name: 'project-' + i, path: '~/work/p' + i, counts: 3 }]));
  const flat = (m: RealModel): RealModel => ({ ...m, folders: m.folders.map((f) => ({ ...f, floor: undefined })) });
  const ON = { ...WM, storeys: true }, OFF = { ...WM, storeys: false };
  const ROWS = (L: Layout): number => new Set(L.zones.map((z) => Math.round(z.sign.y))).size;
  const needsYou = (d: DeskBox): boolean => d.state === 'waiting' || d.state === 'limit';
  /** the floor numbers in reading order (row by row, a row left to right): FR-116 wants them falling, floor 1 last */
  const reading = (L: Layout, m: RealModel): number[] => { const n = new Map(m.folders.map((f) => [f.id, f.floor!.n])); return L.zones.slice().sort((p1, p2) => Math.round(p1.sign.y) - Math.round(p2.sign.y) || p1.box.x - p2.box.x).map((z) => n.get(z.id)!); };
  /** every check of one layout of `m`; returns how the floors stand: 'own' rows, 'share' rows, or 'none' (the hall is drawn without floors) */
  const check = (tag: string, m: RealModel, W: number, H: number): 'own' | 'share' | 'none' => {
    const L = realLayout(m, { w: W, h: H }, ON, sg(m.folders.length)), F = realLayout(flat(m), { w: W, h: H }, ON, sg(m.folders.length)), S = L.storeys;
    assert.ok(!L.scroll || F.scroll, `${tag}: the floors add no scroll`);
    if (!S) { assert.strictEqual(JSON.stringify(L), JSON.stringify(F), `${tag}: a hall that cannot show the floors for free is the hall without floors`); return 'none'; }
    assert.ok(ROWS(L) <= ROWS(F), `${tag}: no row is added by the floors (${ROWS(F)} -> ${ROWS(L)} rows)`);
    assert.ok(L.u >= F.u * (1 - STOREY_U_LOSS) - 1e-6, `${tag}: the people are at most ${STOREY_U_LOSS * 100} % smaller (u ${F.u.toFixed(1)} -> ${L.u.toFixed(1)})`);
    const rd = reading(L, m);
    assert.ok(rd.every((v, i) => !i || v <= rd[i - 1]), `${tag}: the floors read top floor first, floor 1 last (reading order ${rd.join(' ')})`);
    assert.deepStrictEqual(S.map((b) => b.n), [...new Set(m.folders.map((f) => f.floor!.n))], `${tag}: top floor first`);
    const signs = L.zones.map((z) => z.sign), hall = { x: 0, y: 0, w: W, h: L.height };
    for (const [i, b] of S.entries()) {
      assert.ok(b.tag.h === 20 && b.tag.w >= 40 && inside(b.tag, hall), `${tag}: the tag of ${b.name} is whole inside the hall (x ${b.tag.x} w ${b.tag.w} in ${W})`);
      assert.ok(!signs.some((sn) => inter(sn, b.tag)), `${tag}: the tag of ${b.name} covers no sign`);
      assert.ok(!S.some((o, j) => j !== i && inter(o.tag, b.tag)), `${tag}: the tag of ${b.name} covers no other tag`);
      assert.ok(!L.zones.some((z) => z.desks.some((d) => inter(b.tag, d.plate) || inter(b.tag, d.desk))), `${tag}: the tag of ${b.name} covers no plate or desk`);
      assert.ok(!L.zones.some((z) => z.desks.some((d) => needsYou(d) && d.person && d.person.y < z.sign.y + 20 && inter(b.tag, { x: d.person.x, y: d.person.y, w: d.person.w * 0.6, h: d.person.h }))), `${tag}: the tag of ${b.name} covers no raised hand`);
      assert.ok(!L.zones.some((z) => z.desks.some((d) => d.dots && inter(b.tag, { x: d.dots.x, y: d.dots.y, w: 30, h: 10 }))), `${tag}: the tag of ${b.name} covers no thinking dots`);
      assert.ok(L.zones.some((z) => z.sign.y === b.tag.y && b.tag.x >= z.box.x - 1 && b.tag.x + b.tag.w <= z.box.x + z.box.w + 8), `${tag}: the tag stands in the sign strip of a zone, not past it`);
      if (i) assert.ok(b.slab && b.slab.w * b.slab.h > 0, `${tag}: ${b.name} has a rule where it starts`); else assert.strictEqual(b.slab, null, `${tag}: the top storey has no rule`);
      assert.ok(!S.some((o) => o.slab && inter(o.slab, b.tag)), `${tag}: no rule runs over the tag of ${b.name}`);
      if (i) assert.ok(!L.zones.some((z) => inter(b.slab!, z.sign) || z.desks.some((d) => inter(b.slab!, d.plate))), `${tag}: the rule of ${b.name} covers no sign or plate`);
    }
    /* issue #1759 and review round 2: no sign covers a thinking person's dots (the sign moved for a tag stood over them) */
    const gapFor = (z: Layout['zones'][number]): boolean => { /* is there a place of the sign's minimum width (120 px) in the zone's strip clear of every hand and dots? (then the sign must stand there) */
      const ob = z.desks.flatMap((d) => [...(d.dots ? [[d.dots.x - 2, d.dots.x + 32]] : []), ...(d.person && needsYou(d) && d.person.y < z.sign.y + 20 ? [[d.person.x, d.person.x + d.person.w * 0.6]] : [])]), lo = z.box.x + 4, hi = z.box.x + z.box.w - 4;
      return [lo, ...ob.map((o) => o[1] + 6)].some((px) => { const w = Math.min(hi - px, ...ob.filter((o) => o[0] > px).map((o) => o[0] - 2 - px)); return w >= 120 && !ob.some((o) => o[1] > px && o[0] < px + 120); });
    };
    for (const z of L.zones) for (const d of z.desks) if (d.dots && gapFor(z)) assert.ok(!inter(z.sign, { x: d.dots.x, y: d.dots.y, w: 30, h: 10 }), `${tag}: the sign of ${z.id} covers the thinking dots of ${d.id}`);
    /* review round 2: a floor's rule and tag stand at the floor's first folder in reading order: the upright rule before its first zone, no tag above it, no rule below the tag */
    S.forEach((b, i) => {
      const fz = L.zones.filter((z) => z.part === 1 && m.folders.find((f) => f.id === z.id)!.floor!.n === b.n).sort((p1, p2) => Math.round(p1.sign.y) - Math.round(p2.sign.y) || p1.box.x - p2.box.x)[0];
      if (!fz) return;
      assert.ok(b.tag.y >= fz.sign.y - 1, `${tag}: the tag of ${b.name} is not above the floor's first folder`);
      if (i && b.slab) {
        if (b.slab.w === 2) assert.ok(Math.abs(b.slab.x - Math.max(0, fz.box.x - 3)) < 1.5 && Math.abs(b.slab.y - fz.sign.y) < 1.5, `${tag}: the rule of ${b.name} stands before the floor's first folder in reading order (rule y ${b.slab.y}, first folder y ${fz.sign.y})`);
        assert.ok(b.slab.y <= b.tag.y + 1, `${tag}: the rule of ${b.name} is not below its tag (rule y ${b.slab.y}, tag y ${b.tag.y})`);
      }
    });
    const own = S.length > 1 && S.every((b, i) => !i || b.slab!.w > 100);
    if (own) { /* floors on rows of their own: no row holds two floors, the rule lies across between the rows */
      const rowFloors = new Map<number, Set<string>>(); L.zones.forEach((z) => { const k = Math.round(z.sign.y), f = m.folders.find((x) => x.id === z.id)!.floor!.id; (rowFloors.get(k) || rowFloors.set(k, new Set()).get(k)!).add(f); });
      assert.ok([...rowFloors.values()].every((st) => st.size === 1), `${tag}: no row holds two floors`);
      for (let i = 1; i < S.length; i++) assert.ok(S[i].slab!.y >= S[i - 1].box.y + S[i - 1].box.h - 1 && S[i].slab!.y + 2 <= S[i].box.y, `${tag}: the rule of ${S[i].name} lies in the gap above its row`);
    } else assert.ok(S.every((b, i) => !i || b.slab!.w === 2), `${tag}: floors sharing rows are marked by an upright rule`);
    cases++;
    return own ? 'own' : 'share';
  };
  // the hall-fallback splits (owner decision 2026-11-14 11:01 UTC, hall over names: PR 1746 comment 6876289137): no storeys, no tag, no rule: exactly the hall without floors
  for (const [W, H, nm, sz, fl] of [[1248, ROOM.h800, '4+1 on each floor', [4, 1, 4, 1, 4, 1], [2, 2, 1, 1, 0, 0]], [1248, ROOM.h800, '6/5/4', [6, 5, 4], [2, 1, 0]], [1408, ROOM.h900, '1/8/4', [1, 8, 4], [2, 1, 0]], [1248, ROOM.h800, '1/8/4', [1, 8, 4], [2, 1, 0]]] as Array<[number, number, string, number[], number[]]>) {
    if (world === 'cave' && nm !== '1/8/4') continue; /* the cave draws floors for 4+1 and 6/5/4 at 1280x800 (they share rows at no cost) */
    for (const mix of [false, true]) {
      const m = fm(sz, fl, { mix }), L = realLayout(m, { w: W, h: H }, ON, sg(sz.length));
      assert.strictEqual(L.storeys, undefined, `${world}: ${nm} at ${W}: the hall without floors carries no storeys, tags or rules (no partial tag)`);
      assert.strictEqual(JSON.stringify(L), JSON.stringify(realLayout(flat(m), { w: W, h: H }, ON, sg(sz.length))), `${world}: ${nm} at ${W}: the hall without floors is the flat hall`);
      cases++;
    }
  }
  const CASES: Array<[string, number[], number[]]> = [
    ['15: 5/5/5', [5, 5, 5], [2, 1, 0]], ['15: 4+1 on each floor', [4, 1, 4, 1, 4, 1], [2, 2, 1, 1, 0, 0]], ['15: 8/7 on 2 floors', [8, 7], [1, 0]], ['15: 6/5/4', [6, 5, 4], [2, 1, 0]], ['15: 7/4/4', [7, 4, 4], [2, 1, 0]],
    ['15: 3,3,3,3,3 on 3 floors', [3, 3, 3, 3, 3], [2, 2, 1, 0, 0]], ['12: 4/4/4', [4, 4, 4], [2, 1, 0]], ['9: 3/3/3', [3, 3, 3], [2, 1, 0]], ['15: 1/1/13', [1, 1, 13], [2, 1, 0]], ['13: 1/8/4', [1, 8, 4], [2, 1, 0]],
    ['15: 10/5 on 2 floors', [10, 5], [1, 0]], ['15: 3,3,3,3,3 on 4 floors (floor 1 holds the last two)', [3, 3, 3, 3, 3], [3, 2, 1, 0, 0]], ['11: 5/1/5', [5, 1, 5], [2, 1, 0]],
  ];
  const sizes: Array<[number, number]> = [[1408, ROOM.h900], [1248, ROOM.h800]];
  const table: string[] = [], outcome = new Map<string, string>();
  for (const [W, H] of sizes) for (const [name, sz, fl] of CASES) for (const mix of [false, true]) {
    const m = fm(sz, fl, { mix }), o = check(`${world} ${name}${mix ? ' (waiting, thinking and limit at desks)' : ''} at ${W}x${H}`, m, W, H);
    if (!mix) {
      const L = realLayout(m, { w: W, h: H }, ON, sg(sz.length)), F = realLayout(flat(m), { w: W, h: H }, ON, sg(sz.length));
      outcome.set(`${W} ${name}`, o);
      table.push(`${W}x${H} ${name}: u ${F.u.toFixed(1)}${L.storeys ? ' -> ' + L.u.toFixed(1) : ''}, ${ROWS(L)} rows, ${o === 'own' ? 'floors on rows of their own' : o === 'share' ? 'floors share rows' : 'no floors drawn'}`);
    }
  }
  /* the u-loss tolerance, pinned from both sides: 5/5/5 at 1440x900 costs between 1 and 2 % of u for rows of their own, so it needs the 2 % (a 1 % tolerance shares rows: the lower pin);
     3,3,3,3,3 on 3 floors costs more than 2 % and must share rows (a 5 % tolerance would break it: the upper pin) */
  { const m = fm([5, 5, 5], [2, 1, 0]), cost = 1 - realLayout(m, { w: 1408, h: ROOM.h900 }, ON, sg(3)).u / realLayout(flat(m), { w: 1408, h: ROOM.h900 }, ON, sg(3)).u;
    assert.strictEqual(outcome.get('1408 15: 5/5/5'), 'own', `${world}: 5/5/5 at 1440x900: every floor on a row of its own (the tolerance ${STOREY_U_LOSS * 100} % must cover its cost, lower pin)`);
    assert.ok(cost > 0.01 && cost <= STOREY_U_LOSS, `${world}: 5/5/5 at 1440x900 costs ${(cost * 100).toFixed(2)} % of u: more than 1 %, at most the tolerance (the pin means something)`); }
  assert.strictEqual(outcome.get(world === 'photo' ? '1408 15: 3,3,3,3,3 on 3 floors' : '1248 15: 5/5/5'), 'share', `${world}: a case that would cost more than the tolerance for rows of their own shares rows (upper pin)`);
  assert.strictEqual(outcome.get('1248 15: 5/5/5'), 'share', `${world}: 5/5/5 at 1280x800: the floors share rows (own rows would scroll or cost the scale)`);
  assert.strictEqual(outcome.get('1408 13: 1/8/4'), 'none', `${world}: 1/8/4 at 1440x900: floors on rows of their own would add a row, in reading order they cost one: no floors are drawn`);
  assert.strictEqual(outcome.get('1248 15: 8/7 on 2 floors'), 'own', `${world}: 8/7 on 2 floors at 1280x800 stand on rows of their own at no cost`);
  // a raised hand under the sign's end (the waiting person stands there): the tag stays inside the hall and clear of the next folder's sign (review of PR 1746, finding 1)
  { const m = fm([10, 5], [1, 0], { mix: true }), L = realLayout(m, { w: 1408, h: ROOM.h900 }, ON, sg(2));
    assert.ok(L.storeys && L.storeys.every((b) => b.tag.x + b.tag.w <= 1408), `${world}: 10/5 with waiting people at 1440x900: no tag runs past the hall`); }
  // the helper strip: 4/4/4 with helpers at 1440x900 keeps its strip with the floors drawn, and no row is added (a forced break that costs the strip is refused)
  { const m = fm([4, 4, 4], [2, 1, 0], { helpers: true }), L = realLayout(m, { w: 1408, h: ROOM.h900 }, ON, sg(3)), F = realLayout(flat(m), { w: 1408, h: ROOM.h900 }, ON, sg(3));
    assert.strictEqual(F.helpRows, 1, `${world}: 4/4/4 with helpers at 1440x900 shows the strip without floors`);
    assert.strictEqual(L.helpRows, F.helpRows, `${world}: 4/4/4 with helpers at 1440x900 keeps the helper strip with floors (the strip is not given up for a floor's own row)`);
    assert.strictEqual(ROWS(L), ROWS(F), `${world}: 4/4/4 with helpers: rows unchanged`);
    cases++; }
  // 600 random Photo or cave halls (2 to 4 floors, 2 to 9 folders, 6 to 15 agents, every state, helpers now and then) at both sizes: whatever the layout does, a tag is inside the hall, over no sign, plate, desk, hand, dots or tag,
  // the floors read top floor first, no row is added, the people lose at most the tolerance, no scroll is added
  { let seed = world === 'photo' ? 7 : 11; const rnd = (): number => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const ST: RealState[] = ['working', 'thinking', 'waiting', 'limit', 'error', 'done', 'idle'];
    const FL4: RealFloor[] = [...FLS, { id: 'd', name: 'Fourth', n: 4 }];
    let drawn = 0;
    for (let t = 0; t < 600; t++) {
      const nf = 2 + Math.floor(rnd() * 3), nfold = nf + Math.floor(rnd() * 5), total = Math.min(15, Math.max(nfold, 6 + Math.floor(rnd() * 10)));
      const fl = Array.from({ length: nfold }, (_, i) => (i < nf ? i : Math.floor(rnd() * nf))).sort((x, y) => y - x), sz = fl.map(() => 1);
      for (let r = total - nfold; r > 0; r--) sz[Math.floor(rnd() * nfold)]++;
      const hel = rnd() < 0.3; let k = 0;
      const m: RealModel = { folders: sz.map((n, fi) => ({ id: 'f' + fi, floor: FL4[fl[fi]], agents: Array.from({ length: n }, () => { const i = k++; return { id: 'a' + i, state: ST[Math.floor(rnd() * ST.length)], person: WP[i % WP.length], away: null, ...(hel ? { helpers: 1 + Math.floor(rnd() * 2) } : {}) }; }) })), places: [] };
      const [W, H] = sizes[t % 2];
      if (check(`${world} random hall ${t} (${sz.join('/')} on floors ${fl.join(',')}) at ${W}`, m, W, H) !== 'none') drawn++;
    }
    assert.ok(drawn > 300, `${world}: the fuzz draws floors in most halls (${drawn} of 600)`);
    console.log(`rows storeys (${world}): 600 random halls: ${drawn} draw floors, the others the hall without floors; no tag off the hall or over a sign, plate, desk, hand, dots or tag; reading order; no row added`); }
  // 1 to 9 floors (the app allows more): realLayout never throws and the layout is valid (every folder drawn, finite boxes, tags inside the hall); more than four floors cannot stand on rows of their own, the hall is the flat one
  { let seed = world === 'photo' ? 31 : 37; const rnd = (): number => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const FL9: RealFloor[] = Array.from({ length: 9 }, (_, i) => ({ id: 'x' + i, name: 'Floor ' + (i + 1), n: i + 1 }));
    for (let t = 0; t < 400; t++) {
      const nf = 1 + Math.floor(rnd() * 9), nfold = nf + Math.floor(rnd() * 4), total = Math.min(15, Math.max(nfold, 6 + Math.floor(rnd() * 10)));
      const fl = Array.from({ length: nfold }, (_, i) => (i < nf ? i : Math.floor(rnd() * nf))).sort((x, y) => y - x), sz = fl.map(() => 1);
      for (let r = total - nfold; r > 0; r--) sz[Math.floor(rnd() * nfold)]++;
      let k = 0;
      const m: RealModel = { folders: sz.map((n, fi) => ({ id: 'f' + fi, floor: FL9[fl[fi]], agents: Array.from({ length: n }, () => { const i = k++; return { id: 'a' + i, state: MIX[i % MIX.length], person: WP[i % WP.length], away: null }; }) })), places: [] };
      const [W, H] = sizes[t % 2], tag = `${world} ${nf} floors (${sz.join('/')} on ${fl.join(',')}) at ${W}`;
      let L: Layout | null = null;
      try { L = realLayout(m, { w: W, h: H }, ON, sg(sz.length)); } catch (e) { assert.fail(`${tag}: realLayout throws: ${(e as Error).message}`); }
      assert.ok(L!.zones.length >= nfold && L!.zones.every((z) => Number.isFinite(z.box.x) && Number.isFinite(z.box.y) && z.box.w > 0) && Number.isFinite(L!.u) && L!.u > 0, `${tag}: a valid layout`);
      if (L!.storeys) assert.ok(L!.storeys.every((b) => inside(b.tag, { x: 0, y: 0, w: W, h: L!.height })), `${tag}: every tag inside the hall`);
      cases++;
    }
  }
  // forced only when free: 15 agents 5/5/5 at 1440x900 stand each on its own row, at 1280x800 the floors share rows (checked above)
  const small = realLayout(fm([5, 5, 5], [2, 1, 0]), { w: 1248, h: ROOM.h800 }, ON, sg(3));
  assert.ok(!small.scroll, `${world}: 15 agents over 3 floors fit 1280x800 with no scroll`);
  // off: no storeys, and the layout is exactly the old one
  assert.strictEqual(realLayout(fm([5, 5, 5], [2, 1, 0]), { w: 1408, h: ROOM.h900 }, OFF, sg(3)).storeys, undefined, `${world}: with storeys off it leaves them unset`);
  assert.strictEqual(JSON.stringify(realLayout(fm([5, 5, 5], [2, 1, 0]), { w: 1408, h: ROOM.h900 }, OFF, sg(3))), JSON.stringify(realLayout(flat(fm([5, 5, 5], [2, 1, 0])), { w: 1408, h: ROOM.h900 }, OFF, sg(3))), `${world}: with storeys off the floors change nothing`);
  assert.strictEqual(realLayout(fm([5, 5], [0, 0]), { w: 1408, h: ROOM.h900 }, ON, sg(2)).storeys, undefined, `${world}: one floor with folders: no storeys`);
  assert.strictEqual(JSON.stringify(realLayout(flat(fm([5, 5, 5], [2, 1, 0])), { w: 1408, h: ROOM.h900 }, ON, sg(3))), JSON.stringify(realLayout(flat(fm([5, 5, 5], [2, 1, 0])), { w: 1408, h: ROOM.h900 }, OFF, sg(3))), `${world}: no floors given (one floor shown): the flag changes nothing`);
  console.log(`rows storeys (${world}): ${table.length} splits at both sizes: no scroll, no row added, u at most 2 % smaller, tags clear of signs, plates and each other\n  ` + table.join('\n  '));
}

console.log(`aisles tests passed (${cases} layouts)`);
process.exitCode = 0;

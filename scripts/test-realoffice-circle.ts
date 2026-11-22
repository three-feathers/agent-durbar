/** Spec 102 T165 (FR-227, FR-229, FR-230): the `circle` arrangement. Pure functions, plain Node, no DOM, 0 credits. Measure first: it prints the smallest face at 15 agents per window.
 *  Each check is a function of a Layout, and each has a mutant (a damaged copy) that must fail it by its own label. `npm run test:realoffice-layout` runs it. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { realLayout, signMin, signShortMin, sortDesks, splitLounge, type RealMeta, type RealModel, type RealAgent, type RealState, type Rect, type Layout } from '../src/shared/realoffice-layout';
import { CHIP_KINDS } from '../src/shared/realoffice-layout';
import { ARRANGEMENTS, FACE_FLOOR, arrangementFits, circleLayout, circleWith, layoutFor, layoutWithFallback, holdAfter, isArrangement, monitorProblem, CIRCLE_FOCUS_MIN, type Arrangement } from '../src/shared/realoffice-arrangements';

process.exitCode = 1;
const ROOT = (() => { let d = __dirname; while (!fs.existsSync(path.join(d, 'package.json'))) d = path.dirname(d); return d; })();
const RO = path.join(ROOT, 'src', 'renderer', 'realoffice');
const readJson = (...p: string[]): Record<string, unknown> => JSON.parse(fs.readFileSync(path.join(RO, ...p), 'utf8'));
const META = { ...readJson('worlds', 'photo', 'world.json'), ...readJson('sets', 'office', 'set.json') } as unknown as RealMeta;
const PEOPLE = Object.keys(META.seat).sort();
const STATES: RealState[] = ['working', 'thinking', 'waiting', 'error', 'limit', 'done', 'idle', 'asleep'];
const RESTING: RealState[] = ['idle', 'asleep', 'done'];
/** `lounge` of the agents sit in the lounge: resting, at home (a lounge seat is for a resting agent that is not away) */
function model(n: number, f: number, lounge = 0): RealModel {
  const folders = Array.from({ length: f }, (_, i) => ({ id: 'f' + i, agents: [] as RealAgent[] }));
  for (let i = 0; i < n; i++) folders[i % f].agents.push(i < lounge ? { id: 'a' + i, state: RESTING[i % 3], person: PEOPLE[i % 15], away: null, lounge: true } : { id: 'a' + i, state: STATES[i % STATES.length], person: PEOPLE[i % 15], away: i % 5 === 4 ? 'library' : null });
  return { folders, places: ['library', 'software', 'terminal', 'web', 'other', 'coffee', 'boss', 'bank', 'postbox'].map((id) => ({ id, visitors: [] })) };
}
const SIGNS = (f: number): Record<string, { name: string; path: string; counts: number }> => Object.fromEntries(Array.from({ length: f }, (_, i) => ['f' + i, { name: 'project-' + i, path: '~/work/long/path/to/project-' + i, counts: 3 }]));
const inter = (a: Rect, b: Rect, t = 0.5): boolean => a.x + t < b.x + b.w && b.x + t < a.x + a.w && a.y + t < b.y + b.h && b.y + t < a.y + a.h;
const inside = (a: Rect, b: Rect, t = 0.5): boolean => a.x >= b.x - t && a.y >= b.y - t && a.x + a.w <= b.x + b.w + t && a.y + a.h <= b.y + b.h + t;
/** the windows: both sizes with the chat closed (the rooms the app measures, 797 and 697 px, spec 102 T309) and open (470 px of chat beside it), as the rows tests */
const SIZES: [number, number][] = [[1440, 797], [1280, 697], [970, 797], [810, 697]];
const NAMES = ['1440x900', '1280x800', '1440x900 chat open', '1280x800 chat open'];
const mk = (n: number, f: number, W: number, H: number): Layout => circleLayout(model(n, f), { w: W, h: H }, META, SIGNS(f));

// ---- measure first (T165): the smallest desk face at 15 agents, over 1..15 folders, per window ----
const ROOMS = [0, 1]; /* the two rooms the app measures: SIZES[0] and SIZES[1] */
const measured: string[] = [];
SIZES.forEach(([W, H], s) => {
  let min = Infinity, at = 0, scrolls = 0;
  for (let f = 1; f <= 15; f++) { const L = mk(15, f, W, H); if (L.faceH < min) { min = L.faceH; at = f; } if (L.scroll) scrolls++; }
  measured.push(`${NAMES[s]}: smallest face ${min.toFixed(1)} px (${at} folders), ${scrolls} of 15 folder counts scroll`);
});
console.log('circle at 15 agents: ' + measured.join('; '));

// ---- the checks: each is a function of a layout, and returns a label per failure; the mutants below must fail their own label ----
const centre = (r: Rect): { x: number; y: number } => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const seq = (m: RealModel): string[] => splitLounge(m).desks.flatMap((f) => sortDesks(f.agents).map((a) => a.id));
function problems(L: Layout, W: number, m: RealModel): string[] {
  const out = new Set<string>(), ds = L.zones.flatMap((z) => z.desks), n = ds.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (inter(ds[i].slot, ds[j].slot)) out.add('overlap');
  const floor: Rect = { x: 0, y: 0, w: W, h: L.height };
  for (const z of L.zones) { if (!inside(z.box, floor) || !inside(z.sign, floor)) out.add('bounds'); for (const d of z.desks) if (!inside(d.slot, floor)) out.add('bounds'); }
  for (const z of L.zones) for (const d of z.desks) { const c = centre(d.slot); if (c.x < z.box.x || c.x > z.box.x + z.box.w || c.y < z.box.y || c.y > z.box.y + z.box.h) out.add('zone'); }
  if (n && !L.focus && !L.lounge) out.add('focus'); /* no box only on a lounge-heavy floor, which drops it to fit */
  if (L.focus && (L.focus.h < CIRCLE_FOCUS_MIN.h - 0.5 || L.focus.w < CIRCLE_FOCUS_MIN.w - 0.5)) out.add('focussize'); /* never a negative or a tiny box */
  if (L.focus) { if (!inside(L.focus, floor)) out.add('focus'); for (const z of L.zones) if (inter(L.focus, z.box) || inter(L.focus, z.sign)) out.add('focus'); }
  if (n >= 3 && L.focus) { const f = L.focus, xs = ds.map((d) => centre(d.slot)); if (!(xs.some((c) => c.x < f.x) && xs.some((c) => c.x > f.x + f.w) && xs.some((c) => c.y < f.y))) out.add('ring'); }
  if (n === 15) for (const d of ds) if (d.face && d.face.h < FACE_FLOOR - 0.01) out.add('face'); /* an agent away at a place has no face at its desk */
  if (JSON.stringify(ds.map((d) => d.id)) !== JSON.stringify(seq(m))) out.add('order');
  for (let i = 1; i < n; i++) { const a = centre(ds[i - 1].slot), b = centre(ds[i].slot); if (Math.hypot(a.x - b.x, a.y - b.y) > 2.2 * ds[i].slot.h) out.add('near'); }
  return [...out];
}
const clone = (L: Layout): Layout => JSON.parse(JSON.stringify(L));

// ---- every count, folder count and window: no overlap, in the floor, in the model's sequence, up the left side, along the top, down the right ----
let cases = 0;
for (const [W, H] of SIZES) for (const n of [1, 2, 3, 4, 5, 8, 12, 15, 20, 30, 40]) for (const f of [1, 2, 3, 4, 6, 8, 9, 12, 15]) {
  const m = model(n, f), before = JSON.stringify(m), L = circleLayout(m, { w: W, h: H }, META, SIGNS(f));
  assert.deepStrictEqual(problems(L, W, m), [], `${n} agents in ${f} folders at ${W}x${H}`);
  assert.strictEqual(JSON.stringify(m), before, 'the model is not changed (pure)');
  assert.ok(L.faceH >= FACE_FLOOR - 0.01, `${n} in ${f} at ${W}x${H}: face ${L.faceH}`);
  cases++;
}
// ---- every window, with the lounge: 15 agents, 4 folders, 0 to 15 of them resting in the lounge (the focus box is dropped, never negative; FR-227) ----
for (const [W, H] of SIZES) for (const f of [1, 4, 15]) for (const lounge of [0, 5, 8, 10, 11, 12, 13, 14, 15]) {
  const m = model(15, f, lounge), L = circleLayout(m, { w: W, h: H }, META, SIGNS(f));
  assert.deepStrictEqual(problems(L, W, m), [], `15 agents, ${lounge} in the lounge, ${f} folders at ${W}x${H}`);
  if (lounge === 15) assert.ok(!L.focus && !L.zones.length, `all in the lounge at ${W}x${H}: no desks and no focus box (it had a height of -2.8 px)`);
  if (ROOMS.some((s) => SIZES[s][0] === W) && f <= 8) assert.ok(!L.scroll, `15 agents, ${lounge} in the lounge, ${f} folders at ${W}x${H}: no scroll (rows has none)`);
  cases++;
}
// ---- 15 agents fit both rooms with no scroll, at 24 px or more, in 1..13 folders; 14 and 15 folders [KNOWN GAP] (FR-229): pinned, so a change shows ----
const GAP = [[15], [14, 15]]; /* the folder counts that scroll at 24.0 px: 1440x900, 1280x800 (spec 102 Changes 2026-11-14) */
ROOMS.forEach((s) => { for (let f = 1; f <= 15; f++) assert.strictEqual(mk(15, f, SIZES[s][0], SIZES[s][1]).scroll, GAP[s].includes(f), `15 agents in ${f} folders at ${NAMES[s]}: scroll must be ${GAP[s].includes(f)} (the known gap lists ${GAP[s]})`); });
for (const s of ROOMS) for (let f = 1; f <= 13; f++) {
  const [W, H] = SIZES[s], L = mk(15, f, W, H);
  assert.ok(!L.scroll, `15 agents fit ${NAMES[s]} (${f} folders): no scroll`);
  assert.ok(L.faceH >= FACE_FLOOR, `15 agents at ${NAMES[s]}: face ${L.faceH} px, floor ${FACE_FLOOR}`);
  assert.ok(L.zones.every((z) => z.desks.every((d) => !d.face || d.face.h >= FACE_FLOOR - 0.01)), `${NAMES[s]}: every desk face`); /* an away desk has none */
}
// fewer people, bigger faces (FR-229)
for (const s of ROOMS) assert.ok(mk(4, 2, SIZES[s][0], SIZES[s][1]).faceH > mk(15, 2, SIZES[s][0], SIZES[s][1]).faceH + 10, `4 agents have bigger faces than 15 at ${NAMES[s]}`);

// ---- the mutants: a damaged layout must fail the check of its own label ----
{
  const [W, H] = SIZES[1], m = model(15, 4), L = circleLayout(m, { w: W, h: H }, META, SIGNS(4));
  assert.deepStrictEqual(problems(L, W, m), [], 'the layout the mutants damage is clean');
  const killed = (label: string, mut: (x: Layout) => void): void => { const x = clone(L); mut(x); assert.ok(problems(x, W, m).includes(label), `mutant not killed at label "${label}"`); };
  killed('overlap', (x) => { x.zones[0].desks[1].slot = { ...x.zones[0].desks[0].slot }; });
  killed('bounds', (x) => { x.zones[x.zones.length - 1].desks[0].slot.x += W; });
  killed('zone', (x) => { x.zones[0].box.y += 2 * x.zones[0].box.h; });
  killed('focus', (x) => { x.focus = { ...x.zones[1].box }; });
  killed('ring', (x) => { x.focus = { ...x.focus!, x: -(x.focus!.w) - 1 + 0, y: x.focus!.y }; });
  killed('focussize', (x) => { x.focus = { ...x.focus!, h: -2.8 }; });
  killed('face', (x) => { const d = x.zones.flatMap((z) => z.desks).find((e) => e.face)!; d.face = { ...d.face!, h: 20 }; });
  killed('order', (x) => { x.zones.reverse(); });
  killed('near', (x) => { const d = x.zones[1].desks, t0 = d[0].slot; d[0].slot = { ...d[d.length - 1].slot }; d[d.length - 1].slot = t0; });
  // the mutant of the wide sides: one desk wide does not hold 15 at 1280x800 (the measure of Changes 2026-11-13)
  const wide1 = circleWith(m, { w: W, h: H }, META, SIGNS(4), { side: 1 });
  assert.ok(wide1.scroll, 'mutant (sides one desk wide): 15 agents scroll at 1280x800, which the "15 agents fit" check above catches');
}
// ---- arrangementFits (FR-230): rows always; circle by the layout; leftAt holds it off until two agents fewer ----
{
  const m15 = model(15, 4), v = { w: 1280, h: 697 };
  assert.strictEqual(arrangementFits('rows', m15, { w: 200, h: 200 }, META), true, 'rows always fits');
  assert.strictEqual(arrangementFits('circle', m15, v, META), true, 'circle fits 15 at 1280x800');
  assert.strictEqual(arrangementFits('circle', model(15, 4), { w: 810, h: 697 }, META), false, 'circle does not fit 15 at 810x697 (chat open)');
  assert.strictEqual(arrangementFits('circle', model(15, 4), v, META, 17), true, 'left at 17, back at 15: two fewer');
  assert.strictEqual(arrangementFits('circle', model(15, 4), v, META, 16), false, 'left at 16, still at 15: one fewer is not enough');
  assert.strictEqual(arrangementFits('circle', model(14, 4), v, META, 16), true, 'left at 16, back at 14');
}
// ---- the seam: `rows` is realLayout byte for byte (T167); circle is in the closed list ----
{
  assert.deepStrictEqual([...ARRANGEMENTS], ['rows', 'circle', 'aisles']);
  assert.ok(isArrangement('circle') && !isArrangement('__proto__') && !isArrangement('constructor') && !isArrangement('circles'));
  const m = model(15, 4), v = { w: 1280, h: 748 };
  assert.strictEqual(JSON.stringify(layoutFor('rows', m, v, META, SIGNS(4))), JSON.stringify(realLayout(m, v, META, SIGNS(4))), 'rows is untouched');
  assert.strictEqual(JSON.stringify(layoutFor('circle', m, v, META, SIGNS(4))), JSON.stringify(circleLayout(m, v, META, SIGNS(4))));
  assert.ok(CIRCLE_FOCUS_MIN.w > 0);
  const lounge = circleLayout(model(15, 4, 3), { w: 1440, h: 797 }, META, SIGNS(4));
  assert.ok(lounge.lounge && lounge.lounge.desks.length === 3, 'the lounge row is kept, as in rows');
  assert.deepStrictEqual(circleLayout({ folders: [], places: [] }, { w: 1280, h: 697 }, META).zones, [], 'no agents, no zones');
}
// ---- the manifests (FR-230, T174): the Cave may name circle; the scan stays for every OTHER world (the parsed `arrangement`, so spacing, line breaks and \u escapes cannot hide it) ----
/** the parsed manifest's `arrangement` (a manifest that does not parse fails by its path, never passes); a world.json and a card.json are flat objects, so the key is at the top */
const arrangementOf = (text: string, file: string): unknown => { try { return (JSON.parse(text) as { arrangement?: unknown }).arrangement; } catch (e) { throw new Error(`${file} is not valid JSON: ${(e as Error).message}`); } };
/** a world.json says `circle`; a card says it plus its fall-back clause (T368: "circle when it fits, rows otherwise") */
const names = (text: string, file = 'manifest'): boolean => { const a = arrangementOf(text, file); return typeof a === 'string' && (a === 'circle' || a.startsWith('circle ')); };
/** the manifests that name arrangement circle and are not the Cave's own (a world folder called `cave`, in worlds/ or the app's worlds) */
function circleOffenders(manifests: Array<{ file: string; text: string }>): string[] {
  return manifests.filter((m) => names(m.text, m.file) && path.basename(path.dirname(m.file)) !== 'cave').map((m) => m.file);
}
{
  const manifests: Array<{ file: string; text: string }> = [];
  const walk = (d: string, depth: number): void => { if (depth > 4 || !fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules') continue; const f = path.join(d, e.name); if (e.isDirectory()) walk(f, depth + 1); else if (e.name === 'world.json' || e.name === 'card.json') manifests.push({ file: path.relative(ROOT, f), text: fs.readFileSync(f, 'utf8') }); } };
  walk(path.join(ROOT, 'worlds'), 0); walk(path.join(RO, 'worlds'), 0);
  assert.ok(manifests.length >= 3, 'the scan found the shipped world manifests');
  assert.deepStrictEqual(circleOffenders(manifests), [], 'no world but the Cave names arrangement circle (FR-230, T174)');
  for (const f of ['worlds/cave/card.json', 'src/renderer/realoffice/worlds/cave/world.json']) assert.ok(names(manifests.find((m) => m.file.replace(/\\/g, '/') === f)!.text, f), `the Cave's ${f} names circle (T174)`);
  const naming = { text: '{ "arrangement": "circle" }' };
  assert.deepStrictEqual(circleOffenders([{ file: 'worlds/photo/card.json', ...naming }, { file: 'src/renderer/realoffice/worlds/retro/world.json', ...naming }, { file: 'worlds/cave/card.json', ...naming }]), ['worlds/photo/card.json', 'src/renderer/realoffice/worlds/retro/world.json'], 'mutant: another world naming circle is caught, the Cave is not');
  for (const t of ['{"arrangement":"circle"}', '{ "arrangement" : "circle" }', '{\n  "arrangement":\n    "circle"\n}', '{"arrangement":"\\u0063ircle"}']) assert.ok(names(t), `mutant: ${JSON.stringify(t)} names circle and the parsed scan catches it`);
  assert.ok(names('{"arrangement":"circle when it fits, rows otherwise"}'), 'a card text that starts with circle names circle (T368)');
  assert.ok(!names('{"arrangement":"rows"}') && !names('{}'), 'rows and no key are not circle');
  assert.throws(() => names('{"arrangement": circle}', 'worlds/x/world.json'), /worlds\/x\/world\.json is not valid JSON/, 'a manifest that does not parse fails by its path');
}
// ---- FR-231 (reviewer's finding on #1764): a sign in the circle is never narrower than its short form for the most chips its folder can show, and it lies inside its room. Labels: signw, signin, signshort. ----
/** the chips a folder can ever show: one per agent, at most CHIP_KINDS; `counts` is what the sign shows now (chips and cost), never more than that */
const needOf = (m: RealModel, id: string, counts: number): number => signShortMin(Math.min(counts, (m.folders.find((f) => f.id === id) || { agents: [] }).agents.length, CHIP_KINDS));
const signProblems = (L: Layout, m: RealModel, counts: number): string[] => {
  const out = new Set<string>();
  for (const z of L.zones) {
    if (z.sign.w < needOf(m, z.id, counts) - 0.01) out.add('signw'); /* narrower than the least that keeps + and the menu inside it */
    if (z.box.w - 8 < signShortMin(Math.min(CHIP_KINDS, (m.folders.find((f) => f.id === z.id) || { agents: [] }).agents.length)) - 0.01) out.add('signroom'); /* the room is smaller than the worst case the folder can have */
    if (!inside(z.sign, { x: z.box.x, y: z.box.y - 2, w: z.box.w, h: z.box.h + 2 })) out.add('signin'); /* the sign sticks out of its room: a neighbour or the focus box could cover it */
    if ((z.box.w - 8 >= signMin(counts)) === !!z.signShort) out.add('signshort'); /* the whole sign where its room holds signMin, the short form only where it does not */
  }
  return [...out];
};
const META_CAVE = { ...readJson('worlds', 'cave', 'world.json'), ...readJson('sets', 'prehistoric', 'set.json') } as unknown as RealMeta;
const signsOf = (f: number, counts: number, chips?: number): Record<string, { name: string; path: string; counts: number; chips?: number }> => Object.fromEntries(Array.from({ length: f }, (_, i) => ['f' + i, { name: 'project-' + i, path: '~/work/long/path/to/project-' + i, counts, ...(chips === undefined ? {} : { chips }) }]));
{
  let n = 0;
  for (const [wn, meta] of [['Photo', META], ['Cave', META_CAVE]] as Array<[string, RealMeta]>) for (const [W, H] of SIZES.slice(0, 2)) for (const agents of [4, 8, 15]) for (const f of [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15]) for (const counts of [1, 2, 3, 6]) {
    if (f > agents) continue;
    const m = model(agents, f), r = layoutWithFallback('circle', m, { w: W, h: H }, meta, signsOf(f, counts));
    if (r.ran === 'circle') { assert.deepStrictEqual(signProblems(r.lay, m, counts), [], `${wn} ${agents} agents in ${f} folders, ${counts} counts at ${W}x${H}: every sign holds its short form and lies in a room made for it`); n++; }
    const cl = circleLayout(m, { w: W, h: H }, meta, signsOf(f, counts));
    assert.strictEqual(r.ran === 'circle', !cl.scroll && cl.faceH >= Math.max(FACE_FLOOR, meta.minFace || 0) - 1e-6, `${wn} ${agents} in ${f}, ${counts} counts at ${W}x${H}: the ladder keeps the circle exactly where it does not scroll and the face holds the larger of 24 px and minFace`);
  }
  assert.ok(n > 50, `the sign check ran on ${n} circle layouts`);
  const m = model(15, 9), L = circleLayout(m, { w: 1440, h: 797 }, META_CAVE, signsOf(9, 3));
  assert.deepStrictEqual(signProblems(L, m, 3), [], 'the layout the sign mutants damage is clean');
  const kill = (label: string, mut: (x: Layout) => void): void => { const x = clone(L); mut(x); assert.ok(signProblems(x, m, 3).includes(label), `sign mutant not killed at label "${label}"`); };
  kill('signw', (x) => { x.zones[1].sign.w = 118; }); /* the 118 px sign of the review: its + and menu fall outside it */
  kill('signroom', (x) => { x.zones[1].box.w = 100; x.zones[1].sign.w = 92; }); /* a room as wide as one desk, the cause */
  kill('signin', (x) => { x.zones[1].sign.x = x.zones[1].box.x + x.zones[1].box.w - 20; });
  kill('signshort', (x) => { x.zones[1].signShort = !x.zones[1].signShort; });
  console.log(`circle signs checked on ${n} circle layouts`);
}
// ---- 097 FR-015, 102 FR-230: a status change moves no seat. The same agents in any state (so any chips and cost on the signs) give the same slots, rooms, `u` and arrangement. Labels: moved. ----
const layoutKey = (L: Layout, ran: string): string => JSON.stringify({ ran, u: L.u, scroll: L.scroll, z: L.zones.map((z) => [z.id, z.part, z.box, z.desks.map((d) => d.slot)]), focus: L.focus || null });
const STATE_SETS: RealState[][] = [['working'], ['thinking', 'waiting'], ['error', 'limit', 'done', 'idle', 'asleep'], STATES];
const movedBy = (meta: RealMeta, W: number, H: number, agents: number, f: number, opt?: { liveChips: boolean }): string[] => {
  const keys = new Set<string>();
  STATE_SETS.forEach((set, k) => {
    const m = model(agents, f);
    m.folders.forEach((fo) => fo.agents.forEach((a, i) => { if (!a.lounge) a.state = set[(i + k) % set.length]; }));
    const chips = Math.min(set.length, 5), counts = chips + (k % 2); /* what the signs would show for this set: the chips, and a cost on every other set */
    const sg = signsOf(f, counts, chips), v = { w: W, h: H };
    const L = opt ? circleWith(m, v, meta, sg, opt) : circleLayout(m, v, meta, sg), ran = opt ? (L.scroll ? 'rows' : 'circle') : layoutWithFallback('circle', m, v, meta, sg).ran;
    keys.add(layoutKey(L, ran));
  });
  return keys.size > 1 ? ['moved'] : [];
};
{
  let n = 0, mutantMoved = 0;
  for (const [, meta] of [['Photo', META], ['Cave', META_CAVE]] as Array<[string, RealMeta]>) for (const [W, H] of SIZES.slice(0, 2)) for (const agents of [4, 8, 15, 20]) for (const f of [1, 2, 3, 4, 5, 8, 12, 15]) {
    if (f > agents) continue;
    assert.deepStrictEqual(movedBy(meta, W, H, agents, f), [], `${agents} agents in ${f} folders at ${W}x${H}: a status change moves no seat, room, u or arrangement`);
    n++;
    if (movedBy(meta, W, H, agents, f, { liveChips: true }).length) mutantMoved++;
  }
  assert.ok(mutantMoved > 0, `mutant (rooms from the live chips) is caught by the moved label in ${mutantMoved} of ${n} cases`);
  console.log(`status changes: no seat moves in ${n} cases; the live-chips mutant moves seats in ${mutantMoved}`);
}
// ---- the simulator's 15-agent frame (4, 4, 3, 2 and 2 agents in five folders, two of them in the lounge row): the Cave draws ROWS at both sizes (the circle's 27.5 px face is under the Cave's minFace 30.5 at 1440x900, label minface; the rooms leave the ring no room at 1280x800), with every sign at one chip too: the folders' rooms (4, 4, 3, 2 and 2 chips at most) leave the ring no room at the 24 px face floor there (reviewer, #1764) ----
{
  const sim = (): RealModel => { let i = 0; const fo = [[4, [0]], [4, []], [3, []], [2, []], [2, [1]]].map(([c, lg], k) => ({ id: 'f' + k, agents: Array.from({ length: c as number }, (_, j) => { const lounge = (lg as number[]).includes(j), a: RealAgent = { id: 'a' + i, state: lounge ? 'idle' : STATES[i % STATES.length], person: PEOPLE[i % 15], away: null, ...(lounge ? { lounge: true } : {}) }; i++; return a; }) })); return { folders: fo, places: model(15, 5).places }; };
  for (const [W, H, want] of [[1440, 797, 'rows'], [1280, 697, 'rows']] as Array<[number, number, string]>) for (const counts of [1, 2, 5]) assert.strictEqual(layoutWithFallback('circle', sim(), { w: W, h: H }, META_CAVE, signsOf(5, counts)).ran, want, `the simulator's 15-agent frame in the Cave at ${W}x${H}, ${counts} counts: ${want}`);
}
// ---- the All floors view stays rows (FR-230, 097 FR-104; main's storeys on the Cave): a model of two floors draws rows with its storeys, never the circle; one floor, or a world with no storeys, keeps the circle ----
{
  const fl = (id: string, n: number) => ({ id, name: id, n });
  const m = model(8, 4), two = { ...m, folders: m.folders.map((f, i) => ({ ...f, floor: i < 2 ? fl('f2', 2) : fl('f1', 1) })) } as RealModel, one = { ...m, folders: m.folders.map((f) => ({ ...f, floor: fl('f1', 1) })) } as RealModel;
  for (const [W, H] of [[1440, 797], [1280, 697]]) {
    const v = { w: W, h: H }, r = layoutWithFallback('circle', two, v, META_CAVE, SIGNS(4));
    assert.strictEqual(r.ran, 'rows', `the building view of two floors draws rows at ${W}x${H} (all-floors-rows)`);
    assert.ok((r.lay.storeys || []).length === 2, `rows with the Cave's two storeys at ${W}x${H} (all-floors-rows: storeys drawn)`);
    assert.strictEqual(layoutWithFallback('circle', one, v, META_CAVE, SIGNS(4)).ran, arrangementFits('circle', one, v, META_CAVE) ? 'circle' : 'rows', 'a single floor follows the fit rule');
    assert.strictEqual(layoutWithFallback('circle', two, v, { ...META_CAVE, storeys: false }, SIGNS(4)).ran, arrangementFits('circle', two, v, { ...META_CAVE, storeys: false }) ? 'circle' : 'rows', 'a world with no storeys keeps the circle (all-floors-rows: only storeys worlds)');
  }
}
// ---- the circle's face floor is the larger of 24 px and the world's minFace (review of #1764, 097 FR-308), and the hold follows a failed fit only (labels minface, floors-no-hold) ----
{
  const sim = (): RealModel => { let i = 0; const fo = [[4, [0]], [4, []], [3, []], [2, []], [2, [1]]].map(([c, lg], k) => ({ id: 'f' + k, agents: Array.from({ length: c as number }, (_, j) => { const lounge = (lg as number[]).includes(j), a: RealAgent = { id: 'a' + i, state: lounge ? 'idle' : STATES[i % STATES.length], person: 'p' + (i % 4) } as RealAgent; i++; return lounge ? { ...a, lounge: true } : a; }) })); return { ...model(15, 5), folders: fo } as unknown as RealModel; };
  const v = { w: 1440, h: 797 }, m = sim(), c = circleLayout(m, v, META_CAVE, signsOf(5, 1));
  assert.ok(!c.scroll && c.faceH < 30.5 && c.faceH >= FACE_FLOOR, `the Cave's circle at 1440x900 with 15 agents has a face of ${c.faceH} px: under 30.5, over 24 (minface)`);
  assert.strictEqual(arrangementFits('circle', m, v, META_CAVE), false, 'the circle does not fit under the Cave\'s minFace (minface)');
  assert.strictEqual(arrangementFits('circle', m, v, { ...META_CAVE, minFace: undefined } as unknown as RealMeta), true, 'with no minFace the same circle fits at the 24 px floor (minface: the floor is the larger of the two)');
  // the mutant, floor 24 only, would fit: it is the line above; the assert text of the first line is what it dies at
  const fl = (id: string, n: number) => ({ id, name: id, n }), mm = model(8, 4), two = { ...mm, folders: mm.folders.map((f, i) => ({ ...f, floor: i < 2 ? fl('f2', 2) : fl('f1', 1) })) } as RealModel, one = { ...mm, folders: mm.folders.map((f) => ({ ...f, floor: fl('f1', 1) })) } as RealModel;
  const rf = layoutWithFallback('circle', two, v, META_CAVE, SIGNS(4)), ro = layoutWithFallback('circle', one, v, META_CAVE, SIGNS(4), undefined);
  assert.strictEqual((rf as { why?: string }).why, 'floors', 'the All floors rows say why: floors, not fit (floors-no-hold)');
  assert.strictEqual(ro.ran, 'circle', 'all floors, then one floor: the circle returns at once, nothing held (floors-no-hold)');
  assert.strictEqual((layoutWithFallback('circle', m, v, META_CAVE, signsOf(5, 1)) as { why?: string }).why, 'fit', 'a failed fit says fit (floors-no-hold)');
  // the hold as the page keeps it: All floors rows then one floor; a failed fit then the same list (behaviour, label floors-no-hold)
  const keyA = 'cave|1440x797|f0,f1,f2,f3', n8 = 8;
  let hold = holdAfter(null, keyA, n8, rf.ran, (rf as { why?: 'fit' | 'floors' }).why);
  assert.strictEqual(hold, null, 'All floors rows set no hold (floors-no-hold: behaviour)');
  hold = holdAfter(hold, keyA, n8, ro.ran, (ro as { why?: 'fit' | 'floors' }).why);
  assert.strictEqual(hold, null, 'then one floor: still no hold and the circle returns (floors-no-hold: behaviour)');
  const rfit = layoutWithFallback('circle', m, v, META_CAVE, signsOf(5, 1)) as { ran: Arrangement; why?: 'fit' | 'floors' };
  hold = holdAfter(hold, keyA, 15, rfit.ran, rfit.why);
  assert.deepStrictEqual(hold, { key: keyA, at: 15 }, 'a failed fit sets the hold at its agent count (floors-no-hold: behaviour)');
  assert.strictEqual(holdAfter(hold, keyA, 14, 'rows', 'floors'), hold, 'rows for floors leave a held fit alone (floors-no-hold: behaviour)');
  assert.strictEqual(holdAfter(hold, keyA, 13, 'circle'), null, 'the circle drawn clears it (floors-no-hold: behaviour)');
  const page = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'realoffice.js'), 'utf8');
  assert.ok(/CIRCLE_HOLD = L\.holdAfter\(CIRCLE_HOLD, key, n, ran, r\.why\)/.test(page), 'the page keeps its hold through holdAfter (floors-no-hold: sanity line only; the behaviour above is the test)');
}
// ---- the ladder circle -> rows (FR-230, owner 2026-11-14 13:10 UTC): 15 agents in 14 and in 15 one-agent folders fall back to rows, no scroll, nothing off the stage ----
{
  const META_CAVE = { ...readJson('worlds', 'cave', 'world.json'), ...readJson('sets', 'prehistoric', 'set.json') } as unknown as RealMeta;
  assert.strictEqual((META_CAVE as unknown as { arrangement: string }).arrangement, 'circle', 'the Cave names circle');
  type Ran = { lay: Layout; ran: string };
  /** labels: scroll (the floor scrolls), off (a desk or zone leaves the stage), ran (the arrangement that drew is not the one the fit rule gives) */
  const ladder = (r: Ran, W: number, fits: boolean): string[] => {
    const out = new Set<string>(), floor: Rect = { x: 0, y: 0, w: W, h: r.lay.height };
    if (r.lay.scroll) out.add('scroll');
    for (const z of r.lay.zones) { if (!inside(z.box, floor)) out.add('off'); for (const d of z.desks) if (!inside(d.slot, floor)) out.add('off'); }
    if (r.ran !== (fits ? 'circle' : 'rows')) out.add('ran');
    return [...out];
  };
  const seen: string[] = [];
  for (const [name, meta] of [['Photo meta', META], ['Cave meta', META_CAVE]] as Array<[string, RealMeta]>) SIZES.slice(0, 2).forEach(([W, H], s) => {
    for (const f of [1, 4, 8, 12, 13, 14, 15]) {
      const m = model(15, f), v = { w: W, h: H }, fits = arrangementFits('circle', m, v, meta);
      const r = layoutWithFallback('circle', m, v, meta, SIGNS(f));
      assert.deepStrictEqual(ladder(r, W, fits), [], `${name} ${NAMES[s]}, 15 agents in ${f} folders: ladder ${fits ? 'keeps circle' : 'falls back to rows'}, no scroll, nothing off the stage`);
      { const cl = circleLayout(m, v, meta, SIGNS(f)); assert.strictEqual(fits, !cl.scroll && cl.faceH >= Math.max(FACE_FLOOR, meta.minFace || 0) - 1e-6, `${name} ${NAMES[s]} ${f} folders: fits means the circle does not scroll and holds the face floor`); }
      if (f >= 14) seen.push(`${name} ${NAMES[s]} ${f}: ${r.ran}`);
      if (!fits) {
        { const cl = circleLayout(m, v, meta, SIGNS(f)); assert.ok(ladder({ lay: cl, ran: 'circle' }, W, fits).includes('scroll') || cl.faceH < Math.max(FACE_FLOOR, meta.minFace || 0) - 1e-6, `mutant (ladder removed): the circle's scroll or its face under the floor is caught at ${name} ${NAMES[s]} ${f} folders`); }
        assert.ok(ladder({ lay: realLayout(m, v, meta, SIGNS(f)), ran: 'circle' }, W, fits).includes('ran'), `mutant (circle forced): caught by its ran label at ${name} ${NAMES[s]} ${f} folders`);
      } else assert.ok(ladder({ lay: realLayout(m, v, meta, SIGNS(f)), ran: 'rows' }, W, fits).includes('ran'), `mutant (rows always): caught by its ran label at ${name} ${NAMES[s]} ${f} folders`);
    }
  });
  for (const want of ['Photo meta 1440x900 15: rows', 'Photo meta 1440x900 14: circle', 'Cave meta 1280x800 14: rows', 'Cave meta 1280x800 15: rows', 'Cave meta 1440x900 14: rows', 'Cave meta 1440x900 15: rows']) assert.ok(seen.includes(want), `the measured edge: ${want}`); /* Photo's meta scrolls at 15 folders at 1440x900, the Cave's does not (its desk is smaller); both fall back at 14 and 15 at 1280x800 */
  console.log('ladder at 14 and 15 folders: ' + seen.join('; '));
  // the hold: back only with two agents fewer than it left at
  const m15 = model(15, 14), m14 = model(14, 14), m13 = model(13, 13), v = { w: 1280, h: 697 }; /* Photo's numbers: the hold is the same for every world; the Cave's minFace floor is the minface test above */
  assert.strictEqual(layoutWithFallback('circle', m13, v, META, SIGNS(13), 15).ran, 'circle', 'left at 15, back at 13: two fewer');
  assert.strictEqual(layoutWithFallback('circle', m14, v, META, SIGNS(14), 15).ran, 'rows', 'left at 15, still rows at 14: one fewer is not enough');
  assert.strictEqual(layoutWithFallback('circle', m15, v, META, SIGNS(15), undefined).ran, 'rows', 'no hold: 15 agents in 14 folders is rows');
  assert.strictEqual(JSON.stringify(layoutWithFallback('rows', m15, v, META_CAVE, SIGNS(14)).lay), JSON.stringify(realLayout(m15, v, META_CAVE, SIGNS(14))), 'rows is untouched by the ladder');
}
// the engine's cost at 40 agents in 8 folders (FR-019: under 5 ms), the best of 20: printed, the op-count row is for the wiring PR
{
  const m = model(40, 8), s = SIGNS(8); let best = Infinity;
  for (let i = 0; i < 20; i++) { const t0 = process.hrtime.bigint(); circleLayout(m, { w: 1280, h: 697 }, META, s); best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6); }
  console.log(`circle at 40 agents in 8 folders: best of 20 ${best.toFixed(2)} ms`);
}
// ---- spec 102 T171: what the cabinet painter may take from a world's `monitor` entry (FR-220) ----
{
  const ok = { file: 'monitor.webp', cells: 16, bodies: 4 };
  assert.strictEqual(monitorProblem(ok), '', 'T171 monitor: a plain entry is fine');
  assert.strictEqual(monitorProblem({ file: 'monitor-half.webp', cells: 1 }), '', 'T171 monitor: one cell, no bodies is fine');
  const retro = readJson('worlds', 'retro', 'world.json').monitor as Record<string, { file: string; cells: number; bodies?: number }>;
  for (const k of Object.keys(retro)) assert.strictEqual(monitorProblem(retro[k]), '', `T171 monitor: the shipped arcade's ${k} entry is fine`);
  for (const [label, f] of [['path', '../x.webp'], ['slash', 'a/b.webp'], ['backslash', 'a\\b.webp'], ['quote', 'a".webp'], ['url', 'url(x).webp'], ['space', 'a b.webp'], ['upper case', 'Monitor.webp'], ['not webp', 'monitor.png'], ['double dot', 'a..webp'], ['no name', '.webp'], ['hyphen first', '-a.webp'], ['double hyphen', 'a--b.webp'], ['empty', ''], ['long', 'a'.repeat(70) + '.webp'], ['number', 1], ['array', ['monitor.webp']], ['null', null], ['scheme', 'https://x/a.webp'], ['data', 'data:image/webp;base64,AA']] as Array<[string, unknown]>) assert.notStrictEqual(monitorProblem({ file: f, cells: 16 }), '', `T171 monitor: file refused: ${label}`);
  for (const [label, c] of [['zero', 0], ['negative', -1], ['fraction', 1.5], ['NaN', NaN], ['Infinity', Infinity], ['string', '16'], ['huge', 1025], ['null', null], ['missing', undefined]] as Array<[string, unknown]>) assert.notStrictEqual(monitorProblem({ file: 'monitor.webp', cells: c }), '', `T171 monitor: cells refused: ${label}`);
  for (const [label, b] of [['zero', 0], ['not dividing', 5], ['fraction', 1.5], ['string', '4']] as Array<[string, unknown]>) assert.notStrictEqual(monitorProblem({ file: 'monitor.webp', cells: 16, bodies: b }), '', `T171 monitor: bodies refused: ${label}`);
  assert.notStrictEqual(monitorProblem(null), '', 'T171 monitor: no entry'); assert.notStrictEqual(monitorProblem(undefined), '', 'T171 monitor: undefined entry');
  const src = fs.readFileSync(path.join(RO, '..', 'realoffice.js'), 'utf8').replace(/\r\n/g, '\n');
  const at = src.indexOf('function cabinetOf');
  /* a fast tripwire only: the behaviour (fail closed, a reused cabinet cleared) is proved on the page by check-102-cabinet-guard */
  assert.ok(at > 0 && /if \(!X\(\)\.monitorProblem \|\| X\(\)\.monitorProblem\(m\)\) \{/.test(src.slice(at, src.indexOf("backgroundImage !== url", at))), 'T171 monitor: cabinetOf asks monitorProblem, failing closed, before it paints a picture');
}
console.log(`circle tests passed (${cases} layouts)`);
process.exitCode = 0;

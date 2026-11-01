/* Spec 097 FR-010..FR-027: the Real office layout engine, a port of the B2 mockup's b2.js geometry into one pure function. It reads
   a plain model (folders with their agents, lobby places with their visitors), the floor's size and the art's metadata (people.json),
   and returns rectangles in floor pixels; the renderer (src/renderer/realoffice.js) only places elements at them. No DOM, no clock,
   no imports: the page loads the compiled file after exports-shim.js and reads `exports.realLayout`; the tests import it. */

export type RealState = 'working' | 'thinking' | 'waiting' | 'error' | 'limit' | 'done' | 'idle' | 'asleep';
export interface RealAgent { id: string; state: RealState; away?: string | null; person?: string | null }
export interface RealFolder { id: string; agents: RealAgent[] }
export interface RealVisitor { id: string; person?: string | null; needsYou?: boolean }
export interface RealPlace { id: string; custom?: boolean; visitors: RealVisitor[] }
export interface RealModel { folders: RealFolder[]; places: RealPlace[] }
export interface SeatMeta { w: number; h: number; headTop: number; bodyH: number; hand: number }
/** `feet` and `top`: per pose, the lowest and highest opaque row as a share of the picture's height, measured from its alpha (owner 2026-10-31 10:19) */
export interface StandMeta { figH: number; poses: Record<string, [number, number]>; feet?: Record<string, number>; top?: Record<string, number> }
export interface RealMeta {
  seat: Record<string, SeatMeta>; stand: Record<string, StandMeta>;
  fixtures: Record<string, [number, number]>; fixtureTop?: Record<string, number>; floorLine: number;
}
export interface Rect { x: number; y: number; w: number; h: number }
export interface DeskBox {
  id: string; state: RealState; slot: Rect; desk: Rect & { full: number }; plate: Rect; screen: Rect; glass: Rect;
  person: (Rect & { file: string; pose: string; pid: string; vis: Rect }) | null;
  face: Rect | null; away: { x: number; y: number } | null; narrow: boolean; lamp: Rect;
  bubble: { x: number; y: number } | null; bang: { x: number; y: number } | null; dots: { x: number; y: number } | null;
  call: { x: number; y: number };
}
/** `id` is the folder's id; `part` is 1, or 2, 3... for the rest of a folder split over rows */
export interface ZoneBox { id: string; part: number; box: Rect; sign: Rect; desks: DeskBox[] }
export interface VisitorBox { id: string; fig: (Rect & { file: string; pose: string; feetY: number }) | null; chip: { x: number; y: number }; face: Rect | null; shadow: Rect | null }
export interface FixtureBox { id: string; custom: boolean; art: Rect | null; slot: Rect; plate: { x: number; y: number; w: number }; visitors: VisitorBox[]; more: number; light: Rect }
export interface Layout {
  u: number; big: boolean; lobbyH: number; floorH: number; width: number; height: number; scroll: boolean; faceH: number;
  zones: ZoneBox[]; fixtures: FixtureBox[]; floorStrip: Rect;
}

/* FR-010 constants (b2.js) */
export const PW = 0.80, SR = 0.66, STRIP = 22, PAD = 8, ZGAP = 8, DESK_AT = 0.76, AWAY_W = 0.62;
/** A desk face's height (crown to chin) as a share of the body height `u`: measured on 6 of the 15 people with a grid over the art
 *  (p01 0.30, p02 0.41, p04 0.27, p08 0.33, p11 0.33, p13 0.30), rounded down to 0.30; per person it varies (spec 097 delta 2026-10-31). */
export const FACE_U = 0.30;
/** FR-012: `u` between the value that gives a 28 px face and 260 px (420 px with big screens). */
export const U_MIN = Math.ceil(28 / FACE_U), U_MAX = 260, U_MAX_BIG = 420;
/** FR-015: plate heights; the row keeps the needs-you height, so a status change never moves a desk. */
export const PLATE_H = 36, PLATE_H_ASK = 50;
/** FR-011: the search is exhaustive up to this many folders; past it, rows of about equal size in the needs-you-first order (FR-019 budget). */
export const ORDER_SEARCH_MAX = 7;
/** FR-020: big screens with this many visible agents or fewer. */
export const BIG_MAX = 4;
/** FR-024: visitors' activity pose per place, and the fallback when a person has no picture for it. */
export const FX_POSE: Record<string, string> = { library: 'book', software: 'box', terminal: 'runA', web: 'touch', boss: 'knock', coffee: 'coffee', bank: 'letter', postbox: 'letter', other: 'tool' };
export const POSE_FALLBACK: Record<string, string> = { box: 'letter', touch: 'letter', tool: 'letter', wait: 'letter', runA: 'letter' };
/** Owner 2026-10-31 ("make a real running pose", replacing the treadmill): the Terminal visitor jogs in place. P1 draws stride A
 *  still; the second frame of each two-frame pose is recorded here for the stepped motion of phase P2. */
export const POSE_FRAME_B: Record<string, string> = { runA: 'runB' };
/** Owner 2026-10-31 10:19 ("it must be real"): people in the lobby are scaled against the Boss door: a door is about 2.1 m, a person 1.7 m. */
export const DOOR_M = 2.1, PERSON_M = 1.7;
/** Owner 2026-10-31 10:48 ("their feet are above the floor"): visitors stand IN FRONT of the fixtures, on the floor strip, not on the
 *  wall's base line. Their foot line is FRONT_DEPTH of the way from the wall/floor line down to the band's bottom edge, and they are
 *  drawn NEAR_SCALE larger than a person at the wall line, since they are nearer. */
export const FRONT_DEPTH = 0.45, NEAR_SCALE = 1.04;
/** a visitor's name chip: its height, and the gap above the figure's highest opaque row (raised hands included) */
export const CHIP_H = 17, CHIP_GAP = 2;
/** FR-022: the order inside a zone. */
export const STATE_ORDER: Record<RealState, number> = { waiting: 0, limit: 0, error: 1, working: 2, thinking: 2, done: 3, idle: 4, asleep: 4 };
/** FR-036: the seated pose per state (the first frame; motion is phase P2). */
export const SEAT_POSE: Record<RealState, string | null> = { working: 'typeA', thinking: 'think', waiting: 'waveA', limit: 'waveA', error: 'think', done: 'rest', idle: 'rest', asleep: null };

const roOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const roNeedsYou = (s: RealState): boolean => s === 'waiting' || s === 'limit';
/** An agent without a person at its desk: away in the lobby, or asleep (Q5: lamp and screen off, a narrower desk). */
const roNarrow = (a: RealAgent): boolean => !!a.away || a.state === 'asleep';
const roWidthOf = (a: RealAgent): number => (roNarrow(a) ? AWAY_W : 1);
const roSeatOf = (meta: RealMeta, a: RealAgent): SeatMeta | null => (a.person && roOwn(meta.seat, a.person) ? meta.seat[a.person] : null);

/** FR-022: a zone's desks in status order; ties keep the model's order. */
export function sortDesks(agents: readonly RealAgent[]): RealAgent[] {
  return agents.map((a, i) => [a, i] as const).sort((p, q) => (STATE_ORDER[p[0].state] ?? 4) - (STATE_ORDER[q[0].state] ?? 4) || p[1] - q[1]).map((x) => x[0]);
}

/** Every split of `list` into at most `most` unordered groups (restricted growth strings; 187 for 6 folders in up to 4 rows, 2,795 for 8).
 *  Geometry does not depend on the order of rows or of zones in a row, so the mockup's search over every order and contiguous split
 *  (FR-011) is the same search without its repeats. */
function roSetPartitions<T>(list: T[], most: number): T[][][] {
  const res: T[][][] = [], blocks: T[][] = [];
  const rec = (i: number): void => {
    if (i === list.length) { res.push(blocks.map((b) => b.slice())); return; }
    for (const b of blocks) { b.push(list[i]); rec(i + 1); b.pop(); }
    if (blocks.length < most) { blocks.push([list[i]]); rec(i + 1); blocks.pop(); }
  };
  if (list.length) rec(0);
  return res;
}

interface Row { zones: RealFolder[]; n: number; Sw: number; scrH: number }
interface Geom { dh: number; head: number; deskBack: number; bottom: number }

/** FR-013, FR-014, FR-015: a row's vertical geometry at unit u. The head room covers a raised hand of every seated person in the row
 *  (whatever their status), and the plate room is the needs-you height, so a status change never moves a desk. */
function roRowGeom(meta: RealMeta, r: Row, u: number): Geom {
  const dh = 0.382 * Math.min(r.Sw - 6, 2 * u);
  let rise = 0, hand = DESK_AT * 0.9, seated = false;
  for (const z of r.zones) { const st = roZoneStats(meta, z); if (st.seated) { seated = true; rise = Math.max(rise, st.rise); hand = Math.max(hand, st.hand); } }
  const head = r.scrH ? r.scrH + 0.05 * u : Math.max(0.07 * u, seated ? rise * u - STRIP + 3 : 0);
  const deskBack = STRIP + head + (hand + 0.015) * u;
  const bottom = deskBack + Math.max(0.62 * dh * 0.92, 0.22 * dh + PLATE_H_ASK + 4) + 4;
  return { dh, head, deskBack, bottom };
}
/* per zone, once: does anyone sit, the highest raised hand (headTop / bodyH) and the lowest hands (hand), in units of u */
const RO_ZONE_STATS = new WeakMap<RealFolder, { seated: boolean; rise: number; hand: number }>();
function roZoneStats(meta: RealMeta, z: RealFolder): { seated: boolean; rise: number; hand: number } {
  let st = RO_ZONE_STATS.get(z);
  if (!st) {
    st = { seated: false, rise: 0, hand: DESK_AT * 0.9 };
    for (const a of z.agents) {
      if (roNarrow(a)) continue;
      const m = roSeatOf(meta, a);
      st.seated = true; st.rise = Math.max(st.rise, m ? m.headTop / m.bodyH : 0.3); st.hand = Math.max(st.hand, m ? m.hand : DESK_AT);
    }
    RO_ZONE_STATS.set(z, st);
  }
  return st;
}
/** rows of contiguous zones with about the same number of desks each (the search for many zones, FR-011 and FR-019) */
function roBalanced<T extends RealFolder>(order: T[], rows: number): T[][] {
  const wt = (z: T): number => z.agents.reduce((q, a) => q + roWidthOf(a), 0);
  const total = order.reduce((s, z) => s + wt(z), 0), out: T[][] = [];
  let cur: T[] = [], acc = 0;
  order.forEach((z, i) => {
    const left = order.length - i, rowsLeft = rows - out.length;
    if (cur.length && (left < rowsLeft || (rowsLeft > 1 && acc + wt(z) / 2 > (total * (out.length + 1)) / rows))) { out.push(cur); cur = []; }
    cur.push(z); acc += wt(z);
  });
  if (cur.length) out.push(cur);
  return out;
}

const roSlotWidth = (W: number, zones: number, n: number): number => (W - 2 * PAD - ZGAP * (zones - 1) - zones * 8) / n;

/** FR-023: the lobby band's height range for an office of height H. */
export function lobbyRange(H: number): [number, number] {
  return [Math.round(Math.max(116, Math.min(150, H * 0.15))), Math.round(H * 0.24)];
}

/** FR-011, FR-020: the rows of folders and the unit u, by search. */
function roPack(meta: RealMeta, folders: RealFolder[], W: number, Ho: number, lobbyMin: number): { rows: Row[]; u: number; used: number; fits: boolean; wide: boolean } {
  const total = folders.reduce((p, f) => p + f.agents.length, 0);
  const avail = Ho - lobbyMin;
  if (total <= BIG_MAX) {
    const row: Row = { zones: folders, n: folders.reduce((p, f) => p + f.agents.reduce((q, a) => q + roWidthOf(a), 0), 0), Sw: 0, scrH: 0 };
    row.Sw = roSlotWidth(W, folders.length, row.n);
    let u = Math.min(row.Sw / 1.3, 300, U_MAX_BIG);
    const base = (uu: number): number => roRowGeom(meta, { ...row, scrH: 0 }, uu).bottom + 0.05 * uu;
    const want = Math.max(170, 0.42 * avail); /* FR-020: a screen of at least 170 px, about 40 % of the floor when there is room */
    while (u > U_MIN && avail - base(u) < want) u -= 2;
    u = Math.max(U_MIN, u);
    row.scrH = Math.max(60, Math.min(avail - base(u) - 10, row.Sw * 0.78));
    const used = roRowGeom(meta, row, u).bottom;
    return { rows: [row], u, used, fits: used <= avail + 0.5, wide: true };
  }
  let best: { rows: Row[]; u: number; used: number; score: number; fits: boolean; wide: boolean } | null = null;
  /* rows and the zones in them keep the model's folder order (the app's folder order), so a status change never moves a folder (FR-015) */
  const at = (z: RealFolder): number => folders.indexOf(z);
  const many = folders.length > ORDER_SEARCH_MAX;
  const maxRows = many ? folders.length : 4; /* past the 15-agent scale (scrolling) many zones may take more than 4 rows */
  const cands: RealFolder[][][] = many
    ? Array.from({ length: Math.min(maxRows, folders.length) }, (_, i) => roBalanced(folders, i + 1))
    : roSetPartitions(folders, maxRows).map((rs) => rs.map((zs) => zs.slice().sort((p, q) => at(p) - at(q))).sort((p, q) => at(p[0]) - at(q[0])));
  for (const part of cands) {
    const rows: Row[] = part.map((zs) => { const n = zs.reduce((p, z) => p + z.agents.reduce((q, a) => q + roWidthOf(a), 0), 0); return { zones: zs, n, Sw: roSlotWidth(W, zs.length, n), scrH: 0 }; });
    const uW = Math.min(...rows.map((r) => r.Sw / (PW + SR)));
    const H = (u: number): number => rows.reduce((p, r) => p + roRowGeom(meta, r, u).bottom, 0);
    let lo = U_MIN, hi = Math.min(uW, U_MAX);
    const fits = hi >= lo && H(lo) <= avail;
    if (fits) for (let k = 0; k < 16; k++) /* 16 halvings: u to within 0.005 px (b2.js used 30) */ { const m = (lo + hi) / 2; if (H(m) <= avail) lo = m; else hi = m; }
    const used = H(lo), spread = Math.max(...rows.map((r) => r.n)) - Math.min(...rows.map((r) => r.n));
    const wide = uW >= U_MIN; /* every desk at least as wide as a person and a screen at the smallest u */
    const score = (fits ? 2e6 : wide ? 1e6 - used : -used) + lo - spread * 5 - 0.08 * Math.max(0, avail - used);
    if (!best || score > best.score + 0.5) best = { rows, u: lo, used, score, fits, wide };
  }
  return best as { rows: Row[]; u: number; used: number; fits: boolean; wide: boolean };
}

/** FR-024: the standing picture for a visitor at a place (the pose, else its fallback), or null when the person has neither. */
export function standPose(meta: RealMeta, person: string | null | undefined, place: string, custom: boolean): { pose: string; size: [number, number]; figH: number; feet: number; top: number } | null {
  if (!person || !roOwn(meta.stand, person)) return null;
  const st = meta.stand[person], want = custom ? 'wait' : (roOwn(FX_POSE, place) ? FX_POSE[place] : 'wait');
  for (const p of [want, POSE_FALLBACK[want]]) if (p && roOwn(st.poses, p)) return { pose: p, size: st.poses[p], figH: st.figH, feet: st.feet && roOwn(st.feet, p) ? st.feet[p] : 1, top: st.top && roOwn(st.top, p) ? st.top[p] : 0 };
  return null;
}
/** a person's standing height (top of the head to the soles) in sheet pixels, from the upright 'letter' pose (else the sheet's figure height) */
export function standHeight(meta: RealMeta, person: string): number {
  const st = roOwn(meta.stand, person) ? meta.stand[person] : null;
  if (!st) return 1;
  const h = roOwn(st.poses, 'letter') ? st.poses.letter[1] : st.figH;
  const f = st.feet && roOwn(st.feet, 'letter') ? st.feet.letter : 1, t = st.top && roOwn(st.top, 'letter') ? st.top.letter : 0;
  return Math.max(1, (f - t) * h);
}

/** Owner 2026-10-31 09:03 (spec 097 delta): one fixture per place, never two; a place's width grows with the people standing there and
 *  an empty place shrinks to a compact fixture. `fixtures` are the fixtures' widths at full scale, `counts` the visitors per place,
 *  `vw` a standing person's width. Steps, each only while the row is wider than W: (1) empty places draw their fixture smaller, down
 *  to 0.55; (2) people stand closer (the step between them from 0.8 to 0.45 of a person); (3) busy places' fixtures get smaller, down
 *  to 0.6; (4) the biggest crowds show fewer people and a "+N"; (5) empty places become a plate-only slot, from the right; (6) every
 *  fixture gets smaller still (down to 0.2); (7) plate-only slots narrow (their label ellipsed). An occupied place always keeps its
 *  fixture and at least one person. `scale` is each fixture's own scale. */
export function lobbyWidths(fixtures: readonly number[], counts: readonly number[], W: number, vw: number): { x: number[]; w: number[]; fw: number[]; scale: number[]; step: number; shown: number[]; compact: boolean[]; gap: number } {
  const n = fixtures.length, GAP = 4;
  const compact = fixtures.map(() => false), shown = counts.map((c) => Math.max(0, c | 0));
  const busy = (i: number): boolean => counts[i] > 0;
  let step = 0.8 * vw, se = 1, sb = 1, cw = COMPACT_W;
  const scaleOf = (i: number): number => (busy(i) ? sb : Math.min(se, sb));
  const fwOf = (i: number): number => (compact[i] ? cw : fixtures[i] * scaleOf(i));
  const wOf = (i: number): number => fwOf(i) + (shown[i] && !compact[i] ? 0.7 * vw + (shown[i] - 1) * step : 0);
  const total = (): number => fixtures.reduce((s0, _, i) => s0 + wOf(i), 0) + GAP * (n + 1);
  const artOf = (pick: (i: number) => boolean): number => fixtures.reduce((s0, f, i) => s0 + (!compact[i] && pick(i) ? f : 0), 0);
  let art = artOf((i) => !busy(i));
  if (total() > W && art) se = Math.max(0.55, 1 - (total() - W) / art);
  const many = shown.reduce((s0, c) => s0 + Math.max(0, c - 1), 0);
  if (total() > W && many) step = Math.max(0.45 * vw, step - (total() - W) / many);
  art = artOf(busy);
  if (total() > W && art) sb = Math.max(0.6, 1 - (total() - W) / art);
  while (total() > W) {
    let k = -1; shown.forEach((c, i) => { if (c > 1 && (k < 0 || c > shown[k])) k = i; });
    if (k < 0) break;
    shown[k]--;
  }
  for (let i = n - 1; i >= 0 && total() > W; i--) if (!busy(i)) compact[i] = true;
  art = artOf(() => true);
  if (total() > W && art) { const all = (total() - W) / art; sb = Math.max(0.2, sb - all); se = Math.max(0.2, Math.min(se, sb)); }
  const nc = compact.filter(Boolean).length;
  if (total() > W && nc) cw = Math.max(48, cw - (total() - W) / nc);
  const t = total(), gap = GAP + Math.max(0, W - t) / (n + 1);
  const x: number[] = [], w: number[] = [];
  let at = gap;
  for (let i = 0; i < n; i++) { x.push(at); w.push(wOf(i)); at += wOf(i) + gap; }
  return { x, w, fw: fixtures.map((_, i) => fwOf(i)), scale: fixtures.map((_, i) => scaleOf(i)), step, shown, compact, gap };
}
/** a place shown as its plate only (FR-025) */
export const COMPACT_W = 96;

/** FR-023..FR-027: the lobby band: fixtures scaled whole to the band, visitors in front, widths from lobbyWidths. */
function roLobby(meta: RealMeta, places: RealPlace[], W: number, Lb: number): { fixtures: FixtureBox[]; floorStrip: Rect } {
  const FLOOR = Math.round(Math.max(18, Lb * 0.13)), floorY = Lb - FLOOR + 3;
  const wallH = floorY, fs0 = wallH / meta.floorLine;
  /* a standing person's height in px: 1.7 m against the Boss door's 2.1 m at the band's own scale (not a fixture's compact scale) */
  const doorPx = (meta.floorLine - (meta.fixtureTop && roOwn(meta.fixtureTop, 'boss') ? meta.fixtureTop.boss : meta.floorLine * 0.03)) * fs0;
  const personPx = doorPx * PERSON_M / DOOR_M, vw = personPx * 0.42, nearPx = personPx * NEAR_SCALE;
  const frontY = floorY + FRONT_DEPTH * (Lb - floorY); /* owner 10:48: the front floor plane, inside the floor strip */
  const webW = (meta.fixtures.web || [100, meta.floorLine])[0] * fs0;
  const full = places.map((p) => (!p.custom && roOwn(meta.fixtures, p.id) ? meta.fixtures[p.id][0] * fs0 : webW)); /* FR-027: a custom place is a kiosk the size of the Web fixture */
  const al = lobbyWidths(full, places.map((p) => p.visitors.length), W, vw);
  const fixtures: FixtureBox[] = places.map((p, i) => {
    const x = al.x[i], fw = al.fw[i], compact = al.compact[i];
    const fs = fs0 * al.scale[i], fh = wallH * al.scale[i];
    const objTop = floorY - fh + (meta.fixtureTop && roOwn(meta.fixtureTop, p.id) && !p.custom ? meta.fixtureTop[p.id] * fs : fh * 0.35);
    const art: Rect | null = compact ? null : { x, y: floorY - fh, w: fw, h: fh };
    const visitors: VisitorBox[] = compact ? [] : p.visitors.slice(0, al.shown[i]).map((v, j) => {
      const cx = x + fw - 0.3 * vw + vw / 2 + j * al.step;
      const sp = standPose(meta, v.person, p.id, !!p.custom);
      let fig: VisitorBox['fig'] = null, face: Rect | null = null, shadow: Rect | null = null;
      let chipY = Lb - CHIP_H;
      if (sp) {
        /* the feet (the picture's lowest opaque row) stand on the front floor plane, in front of the fixture; one scale per person,
           from its upright 'letter' pose, NEAR_SCALE larger than at the wall line. */
        const k = nearPx / standHeight(meta, String(v.person)), fw2 = sp.size[0] * k, fh2 = sp.size[1] * k;
        fig = { x: cx - fw2 / 2, y: frontY - sp.feet * fh2, w: fw2, h: fh2, file: `${v.person}-${sp.pose}.webp`, pose: sp.pose, feetY: frontY };
        const headY = fig.y + sp.top * fh2;
        face = { x: cx - 0.065 * nearPx, y: headY, w: 0.13 * nearPx, h: 0.13 * nearPx };
        /* a soft elliptical contact shadow on the floor, centred on the foot line, a little wider than the stance */
        const sw = 0.36 * nearPx, shH = Math.max(5, 0.045 * nearPx);
        shadow = { x: cx - sw / 2, y: frontY - shH / 2, w: sw, h: shH };
        /* the name chip goes above the head (the strip is too short to hold it under the feet): it never covers the feet or legs */
        chipY = Math.max(0, headY - CHIP_GAP - CHIP_H);
      }
      return { id: v.id, fig, chip: { x: cx, y: chipY }, face, shadow };
    });
    return { id: p.id, custom: !!p.custom, art, slot: { x, y: 0, w: al.w[i], h: Lb }, plate: { x: x + 2, y: compact ? Math.round(Lb * 0.4) : Math.max(3, objTop - 19), w: al.w[i] + al.gap - 6 }, /* the plate may use the gap up to the next place */ visitors, more: p.visitors.length - visitors.length,
      light: art ? { x: x - 0.1 * fw, y: Math.max(0, objTop - 0.15 * fh), w: 1.2 * fw, h: floorY - Math.max(0, objTop - 0.15 * fh) } : { x, y: 0, w: al.w[i], h: Lb } };
  });
  return { fixtures, floorStrip: { x: 0, y: Lb - FLOOR, w: W, h: FLOOR } };
}

/** FR-013, FR-016, FR-017, FR-036, FR-038: one desk (roStation) in a slot. */
function roStation(meta: RealMeta, a: RealAgent, sx: number, y: number, Sw: number, u: number, g: Geom, big: boolean, scrH: number): DeskBox {
  const narrow = roNarrow(a);
  const slotW = Sw * roWidthOf(a);
  const deskY = y + g.deskBack, dw = slotW - 6, dh = g.dh;
  const m = narrow ? null : roSeatOf(meta, a);
  const hand = m ? m.hand : DESK_AT;
  const headY = deskY - 0.015 * u - hand * u;
  const px = big || narrow ? sx + slotW / 2 : sx + 0.05 * Sw + 0.42 * u;
  let person: DeskBox['person'] = null, face: Rect | null = null;
  const pose = SEAT_POSE[a.state];
  if (m && pose) {
    const k = u / m.bodyH, w = m.w * k, h = m.h * k, top = headY - m.headTop * k;
    person = { x: px - w / 2, y: top, w, h, file: `${a.person}-${pose}.webp`, pose, pid: String(a.person),
      vis: { x: px - 0.3 * u, y: headY, w: 0.6 * u, h: Math.max(0, deskY - headY) } }; /* the head and shoulders: the monitor may cover a shoulder edge, never the face */
    face = { x: px - FACE_U * u * 0.4, y: headY, w: FACE_U * u * 0.8, h: FACE_U * u };
  }
  let sl = px + 0.36 * u, sr = sx + slotW - 0.05 * Sw, sw = sr - sl;
  let foot = deskY + 0.13 * dh, neck = Math.max(6, 0.07 * u);
  let sh = Math.min(sw * (Sw > 300 ? 0.78 : 0.64), foot - neck - (y + STRIP + 3));
  if (narrow && !big) { sl = sx + 0.1 * slotW; sr = sx + 0.9 * slotW; sw = sr - sl; sh = Math.min(sw * 0.64, foot - neck - (y + STRIP + 22)); }
  if (big) { const top = narrow ? 22 : 6; /* an away desk's "at <place>" label sits above its screen */ sl = sx + 0.04 * slotW; sr = sx + 0.96 * slotW; sw = sr - sl; sh = scrH - 4 - top; neck = 0; foot = y + STRIP + top + sh; }
  sh = Math.max(12, sh);
  const screen = { x: sl, y: foot - neck - sh, w: sw, h: sh + neck + 4 };
  const glass = { x: sl + 3, y: foot - neck - sh + 3, w: sw - 6, h: sh - 6 };
  const plateH = roNeedsYou(a.state) ? PLATE_H_ASK : PLATE_H;
  const plate = { x: sx + 8, y: deskY + 0.22 * dh + 2, w: slotW - 16, h: plateH };
  /* the desk picture is dh tall; the row shows its top (desktop, front panel, the upper legs), so the box is cut at the row's bottom */
  const desk = { x: sx + 3, y: deskY, w: dw, h: Math.min(dh, g.bottom - g.deskBack - 2), full: dh };
  return {
    id: a.id, state: a.state, narrow, slot: { x: sx, y, w: slotW, h: 0 }, desk, plate, screen, glass, person, face,
    away: narrow && a.away ? { x: sx + slotW / 2, y: y + STRIP + 2 } : null,
    lamp: { x: sx + 0.02 * slotW, y: Math.max(y + STRIP, headY - 0.35 * u), w: 0.96 * slotW, h: deskY + dh * 0.5 - Math.max(y + STRIP, headY - 0.35 * u) },
    bubble: person && roNeedsYou(a.state) ? { x: px + 0.2 * u - 6, y: headY - 0.04 * u } : null,
    bang: a.state === 'error' ? { x: sr - 10, y: screen.y - 8 } : null,
    dots: person && a.state === 'thinking' ? { x: px + (big ? 0.2 : 0.1) * u, y: headY + (big ? 0.12 : -0.13) * u } : null,
    call: { x: sx + slotW - 16, y: deskY + 0.05 * dh },
  };
}

/** FR-018: the folder sign's width for its text (an estimate; the renderer cuts the path with an ellipsis). */
export const signWidth = (name: string, path: string, counts: number, zw: number): number =>
  Math.max(60, Math.min(zw - 8, 120 + 7 * (Math.min(40, name.length) + Math.min(40, path.length)) * 0.75 + 30 * counts));

/** FR-019: the whole office: pure, no DOM. `signs` gives each folder's sign text lengths (name, path, number of count chips). */
export function realLayout(model: RealModel, viewport: { w: number; h: number }, meta: RealMeta, signs?: Record<string, { name: string; path: string; counts: number }>): Layout {
  const W = Math.max(200, viewport.w), Ho = Math.max(200, viewport.h);
  const folders = model.folders.filter((f) => f.agents.length).map((f) => ({ id: f.id, agents: sortDesks(f.agents) }));
  const [lobbyMin, lobbyMax] = lobbyRange(Ho);
  const zones: ZoneBox[] = [];
  let u = U_MIN, big = false, used = 0, fits = true, rows: Row[] = [];
  if (folders.length) {
    /* a folder too big for one row is split into parts (its sign repeats, "continued"), the fewest splits that fit; spec 097 delta 2026-10-31 */
    let p = roPack(meta, folders, W, Ho, lobbyMin);
    const rank = (x: typeof p): number => (x.fits ? 2 : x.wide ? 1 : 0);
    for (const most of [8, 6, 5, 4]) {
      if (p.fits) break;
      if (!folders.some((f) => f.agents.length > most)) continue;
      const parts = folders.flatMap((f) => { const k = Math.ceil(f.agents.length / most), per = Math.ceil(f.agents.length / k); return Array.from({ length: k }, (_, i) => ({ id: i ? f.id + '\u0000' + (i + 1) : f.id, agents: f.agents.slice(i * per, (i + 1) * per) })); });
      const q = roPack(meta, parts, W, Ho, lobbyMin);
      if (rank(q) > rank(p) || (rank(q) === rank(p) && (q.fits ? q.u > p.u : q.used < p.used))) p = q;
    }
    rows = p.rows; u = p.u; used = p.used; fits = p.fits; big = rows.length === 1 && rows[0].scrH > 0;
  }
  const Lb = Math.round(fits ? Math.max(lobbyMin, Math.min(Ho - used, lobbyMax)) : lobbyMin);
  const spare = fits ? Math.max(0, Ho - Lb - used) : 0, extra = spare / (rows.length + 1);
  let y = Lb + extra / 2;
  for (const r of rows) {
    const g = roRowGeom(meta, r, u);
    let x = PAD + (W - 2 * PAD - (r.Sw * r.n + ZGAP * (r.zones.length - 1) + r.zones.length * 8)) / 2;
    for (const z of r.zones) {
      const zw = r.Sw * z.agents.reduce((q, a) => q + roWidthOf(a), 0) + 8;
      const desks: DeskBox[] = [];
      let ax = x + 4;
      for (const a of z.agents) { const d = roStation(meta, a, ax, y, r.Sw, u, g, big, r.scrH); d.slot.h = g.bottom; desks.push(d); ax += r.Sw * roWidthOf(a); }
      /* FR-018: the sign sits at the left unless a raised hand (a waving person's picture rising into the strip) is there */
      const s0 = z.id.split('\u0000')[0], s = signs && roOwn(signs, s0) ? signs[s0] : { name: s0, path: '', counts: 1 };
      const sw = signWidth(s.name, s.path, s.counts, zw);
      const hands = desks.filter((d) => d.person && roNeedsYou(d.state) && d.person.y < y + STRIP).map((d) => [d.person!.x, d.person!.x + d.person!.w * 0.6]);
      const hits = (px: number): boolean => hands.some(([a, b]) => b > px && a < px + sw);
      let sx = x + 4;
      if (hits(sx)) { sx = x + zw - 4 - sw; if (hits(sx)) sx = Math.max(...hands.map((h) => h[1])) + 6; }
      sx = Math.max(x + 4, Math.min(sx, x + zw - 4 - sw));
      const [fid, part] = z.id.split('\u0000');
      zones.push({ id: fid, part: Number(part || 1), box: { x, y: y + 2, w: zw, h: g.bottom - 2 }, sign: { x: sx, y: y + 1, w: sw, h: 20 }, desks });
      x += zw + ZGAP;
    }
    y += g.bottom + extra;
  }
  const lb = roLobby(meta, model.places, W, Lb);
  const height = fits ? Ho : Math.ceil(Lb + used + PAD);
  return { u, big, lobbyH: Lb, floorH: height - Lb, width: W, height, scroll: !fits, faceH: FACE_U * u, zones, fixtures: lb.fixtures, floorStrip: lb.floorStrip };
}

/** FR-037: each session keeps one person; a new one gets the least-used person in its folder, then overall (ties: the seeded `rand`).
 *  `map` is session id -> person id; sessions no longer listed are dropped (which frees their person). */
export function assignPeople(map: Record<string, string>, sessions: readonly { id: string; folder: string }[], ids: readonly string[], rand: (id: string) => number): Record<string, string> {
  const live = new Map(sessions.map((s) => [s.id, s.folder]));
  const out: Record<string, string> = {};
  for (const [id, p] of Object.entries(map || {})) if (live.has(id) && ids.includes(p)) out[id] = p;
  for (const s of sessions) {
    if (roOwn(out, s.id)) continue;
    const inFolder = new Map(ids.map((p) => [p, 0])), all = new Map(ids.map((p) => [p, 0]));
    for (const [sid, p] of Object.entries(out)) { all.set(p, (all.get(p) || 0) + 1); if (live.get(sid) === s.folder) inFolder.set(p, (inFolder.get(p) || 0) + 1); }
    const key = (p: string): number => (inFolder.get(p) || 0) * 1000 + (all.get(p) || 0);
    const least = Math.min(...ids.map(key)), pool = ids.filter((p) => key(p) === least);
    const r = Number(rand(s.id));
    out[s.id] = pool[Math.floor((Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.999999) : 0) * pool.length)];
  }
  return out;
}

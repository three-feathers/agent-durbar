/* Spec 097 FR-010..FR-027: the Real office layout engine, a port of the B2 mockup's b2.js geometry into one pure function. It reads
   a plain model (folders with their agents, lobby places with their visitors), the floor's size and the art's metadata (people.json),
   and returns rectangles in floor pixels; the renderer (src/renderer/realoffice.js) only places elements at them. No DOM, no clock,
   no imports: the page loads the compiled file after exports-shim.js and reads `exports.realLayout`; the tests import it. */

export type RealState = 'working' | 'thinking' | 'waiting' | 'error' | 'limit' | 'done' | 'idle' | 'asleep';
/** `lounge`: the app's room rule (spec 001 FR-051, `shutPlan`) rolls this finished, read agent in: it sits in the lounge row, not at a desk (spec 097 FR-246) */
/** `helpers`: how many sub-agents the desk has (spec 097 FR-306: the engine reserves a strip for them under the plate) */
export interface RealAgent { id: string; state: RealState; away?: string | null; person?: string | null; lounge?: boolean; helpers?: number }
/** `keep`: the folder has a saved desk order (spec 097 FR-345): its desks stay in the model's order, no status sort */
export interface RealFolder { id: string; agents: RealAgent[]; keep?: boolean }
export interface RealVisitor { id: string; person?: string | null; needsYou?: boolean }
export interface RealPlace { id: string; custom?: boolean; visitors: RealVisitor[] }
/** `keepRooms`: the person saved a room order for this floor (spec 097 FR-353, owner Q31): the rooms stand in rows in that order, left to right, top to bottom, even if the picture is a little smaller */
export interface RealModel { folders: RealFolder[]; places: RealPlace[]; keepRooms?: boolean }
export interface SeatMeta { w: number; h: number; headTop: number; bodyH: number; hand: number }
/** `feet` and `top`: per pose, the lowest and highest opaque row as a share of the picture's height, measured from its alpha (owner 2026-10-31 10:19) */
export interface StandMeta { figH: number; poses: Record<string, [number, number]>; feet?: Record<string, number>; top?: Record<string, number>; foot?: Record<string, number> }
/* `foot`: per pose, the horizontal centre of the planted feet as a share of the picture's width (spec 097 FR-191): the figure stands on it,
   not on the middle of its box, because a three-quarter view has its feet off the box's centre. */
export interface RealMeta {
  /** spec 102 FR-255: a pixel world's art (one integer scale); its lobby keeps people apart */
  pixelArt?: boolean;
  /** spec 102 FR-255 (T204): the screen's device pixel ratio (default 1); a pixel world's lobby is put on whole device pixels at any ratio */
  dpr?: number;
  /** spec 097 FR-335 (T247): the people's own art is not pixel art (false); a hi-res crew in a pixel world is scaled to the world's people, not drawn at whole multiples of its pixels */
  pixelPeople?: boolean;
  seat: Record<string, SeatMeta>; stand: Record<string, StandMeta>;
  fixtures: Record<string, [number, number]>; fixtureTop?: Record<string, number>; floorLine: number;
  /** the world's desk picture in its own pixels (spec 097 FR-247: the lounge's small desk keeps its shape) */
  desk?: [number, number];
  /** per person: the typing rig's head and hands, as fractions of the picture, with their pivots (spec Changes 2026-11-01) */
  rig?: Record<string, Record<string, { x: number; y: number; w: number; h: number; px: number; py: number }>>;
  /** the side every standing picture faces, baked into the files (spec 097 FR-191); the lobby puts visitors to the right of their fixture, so 'left' */
  facing?: 'left' | 'right';
}
export interface Rect { x: number; y: number; w: number; h: number }
export interface DeskBox {
  id: string; state: RealState; slot: Rect; desk: Rect & { full: number }; plate: Rect; screen: Rect; glass: Rect;
  person: (Rect & { file: string; fileB: string | null; pose: string; pid: string; vis: Rect }) | null;
  face: Rect | null; away: { x: number; y: number; s: number } | null; narrow: boolean; lamp: Rect;
  bubble: { x: number; y: number } | null; bang: { x: number; y: number } | null; dots: { x: number; y: number } | null;
  call: { x: number; y: number };
  /** spec 097 FR-306, FR-308: the helper strip under the plate, inside the slot: `rows` of head figures, `shown` fit, the rest are the `+K` button; only a desk with helpers has one */
  strip?: Rect & { rows: number; shown: number; cols: number };
  /** `aisles` only (spec 102 FR-256..FR-259): the marquee, the standing person's box and the side the screen faces */
  /** spec 097 FR-247, FR-248: a seat of the lounge row (no desk or cabinet; `table` is the small desk the monitor stands on) */
  lounge?: boolean; table?: Rect;
  marquee?: Rect; stand?: Rect; facing?: 'left' | 'right'; body?: number /* spec 102 FR-306: the cabinet's body, 0..3: the seat with 4 agents or fewer, else (column + 2 x row) mod 4, so a seat differs from its neighbours on the grid */; cue?: { x: number; y: number };
}
/** `id` is the folder's id; `part` is 1, or 2, 3... for the rest of a folder split over rows */
export interface ZoneBox { id: string; part: number; box: Rect; sign: Rect; desks: DeskBox[]; /** the sign shows name, counts, + and menu only; path and cost go to its hover (FR-256 in `aisles`; FR-356 in a room too narrow for the whole sign) */ signShort?: boolean }
export interface VisitorBox { id: string; fig: (Rect & { file: string; fileB: string | null; b: Rect | null; pose: string; feetY: number; faces: 'left' | 'right' }) | null; chip: { x: number; y: number }; face: Rect | null; shadow: Rect | null }
export interface FixtureBox { id: string; custom: boolean; art: Rect | null; slot: Rect; plate: { x: number; y: number; w: number }; visitors: VisitorBox[]; more: number; light: Rect }
export interface Layout {
  u: number; big: boolean; lobbyH: number; floorH: number; width: number; height: number; scroll: boolean; faceH: number;
  zones: ZoneBox[]; fixtures: FixtureBox[]; floorStrip: Rect;
  /** `aisles` only: the free strip under the lobby where one-line pills go first */
  lane?: Rect;
  /** `aisles` only: the pixel scale (CSS px per art pixel) and the cabinet's size */
  g?: number; cabinet?: { w: number; h: number; gw: number; gh: number; cols: number; rows: number };
  /** spec 097 FR-308: FR-338: the rows of the helper strip (1), or 0: none drawn, the plate keeps its `+N` and dots (no room, or no helpers) */
  helpRows?: number;
  /** spec 097 FR-246..FR-248: the lounge row (its box and its seats), when an agent sits there */
  lounge?: { box: Rect; desks: DeskBox[] };
}

/* FR-010 constants (b2.js) */
export const PW = 0.80, SR = 0.66, STRIP = 22, PAD = 8, ZGAP = 8, DESK_AT = 0.76;
/** A desk face's height (crown to chin) as a share of the body height `u`: measured on 6 of the 15 people with a grid over the art
 *  (p01 0.30, p02 0.41, p04 0.27, p08 0.33, p11 0.33, p13 0.30), rounded down to 0.30; per person it varies (spec 097 delta 2026-10-31). */
export const FACE_U = 0.30;
/** FR-012: `u` between the value that gives a 28 px face and 260 px (420 px with big screens). */
export const U_MIN = Math.ceil(28 / FACE_U), U_MAX = 260, U_MAX_BIG = 420;
/** FR-015: plate heights; the row keeps the needs-you height, so a status change never moves a desk. */
export const PLATE_H = 36, PLATE_H_ASK = 50;
/** Spec 097 FR-306..FR-308 (delta 2026-11-08, owner "1265 1"): the helper strip is a row (or two) of small head figures under the plate. `HEAD`: a figure's side (a circle with the
 *  status dot on its corner); `HEAD_FACE`: the share of it that the face (crown to chin) fills, so a face is `HEAD * HEAD_FACE` px, never under `HELP_FACE_MIN` (the lounge's floor, FR-247);
 *  `HELP_GAP`: between figures. FR-338 (bug #1384, delta 2026-11-09): the strip is one row; the places it holds are the figures across, the last one `+K` when more helpers exist,
 *  never a second line (FR-308's two-row level, `HELP_ROWS_MAX` and `HELP_KEEP`, is removed: a second row read as a head wrapped under the row). */
export const HEAD = 30, HEAD_FACE = 0.8, HELP_FACE_MIN = 24, HELP_GAP = 4, HELP_PAD = 4;
/** FR-308: the strip's height for `rows` rows (the row's fixed extra height, FR-015) */
export const helpH = (rows: number): number => rows * HEAD + (rows - 1) * HELP_GAP + HELP_PAD;
/** FR-308: the figures across a strip of width `w` */
export const helpCols = (w: number): number => Math.max(0, Math.floor((w + HELP_GAP) / (HEAD + HELP_GAP)));
/** FR-308: how many figures a strip of width `w` and `rows` rows shows for `n` helpers: all when they fit, else the last place is the `+K` button */
export function helpShown(w: number, rows: number, n: number): number {
  const cap = helpCols(w) * rows;
  return n <= cap ? n : Math.max(0, cap - 1);
}
/** FR-307: the head crop of a seated picture for a helper's figure: a square whose side makes the face (FACE_U of the body height) fill `HEAD_FACE` of it, centred on the face
 *  (sideways on the picture's middle, as `portraitCrop`), kept inside the picture. `s` is the side in picture pixels; the figure shows it at `HEAD` px. */
export function headCrop(seat: { w: number; h: number; headTop: number; bodyH: number }): { x: number; y: number; s: number } {
  const s = Math.min(seat.bodyH * FACE_U / HEAD_FACE, seat.w, seat.h);
  const cy = seat.headTop + seat.bodyH * FACE_U / 2;
  return { x: Math.max(0, Math.min(seat.w - s, seat.w / 2 - s / 2)), y: Math.max(0, Math.min(seat.h - s, cy - s / 2)), s };
}

/** FR-307: the person a helper's head shows: one of the set's `ids` picked from the helper's id (FNV-1a), never the parent's, so a helper does not look like its parent; stable, nothing stored */
export function helperPerson(helperId: string, parentPerson: string | null | undefined, ids: readonly string[]): string | null {
  const pool = ids.filter((p) => p !== parentPerson);
  const list = pool.length ? pool : ids;
  if (!list.length) return null;
  let h = 2166136261;
  for (const ch of String(helperId)) { h ^= ch.codePointAt(0) as number; h = Math.imul(h, 16777619) >>> 0; }
  return list[h % list.length];
}

/** FR-011: the search is exhaustive up to this many folders; past it, rows of about equal size in the needs-you-first order (FR-019 budget). */
export const ORDER_SEARCH_MAX = 7;
/** FR-020: big screens with this many visible agents or fewer. */
export const BIG_MAX = 4;
/** SC-003: a big screen shows at least this many lines of 11 px or more */
export const BIG_ROWS = 8;
/** FR-024: visitors' activity pose per place, and the fallback when a person has no picture for it. */
export const FX_POSE: Record<string, string> = { library: 'book', software: 'book', terminal: 'runA', web: 'type', boss: 'knock', coffee: 'counter', bank: 'counter', postbox: 'letter', other: 'type' };
export const POSE_FALLBACK: Record<string, string> = { wait: 'letter', runA: 'letter' };
/** FR-070: the second frame of each two-frame pose. Owner 2026-10-31 ("make a real running pose", replacing the treadmill): the
 *  Terminal visitor jogs in place, runA and runB. */
export const POSE_FRAME_B: Record<string, string> = { typeA: 'typeB', waveA: 'waveB', runA: 'runB' };
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
export const SEAT_POSE: Record<RealState, string | null> = { working: 'typeA', thinking: 'think', waiting: 'waveA', limit: 'waveA', error: 'think', done: 'rest', idle: 'rest', asleep: 'rest' };

const roOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const roNeedsYou = (s: RealState): boolean => s === 'waiting' || s === 'limit';
/** An empty seat: the agent is away in the lobby (a post-it says where). An asleep agent is not away: it rests at its desk in the dark (FR-120, FR-129). */
const roNarrow = (a: RealAgent): boolean => !!a.away;
/* Spec 097 FR-246 (owner 2026-11-06, issue #1220): the asleep desk's 0.62 width of the 2026-11-02 ruling is gone: an asleep agent sits in the lounge row, so every desk is full width */
const roSeatOf = (meta: RealMeta, a: RealAgent): SeatMeta | null => (a.person && roOwn(meta.seat, a.person) ? meta.seat[a.person] : null);

/** FR-022: a zone's desks in status order; ties keep the model's order. */
export function sortDesks(agents: readonly RealAgent[]): RealAgent[] {
  return agents.map((a, i) => [a, i] as const).sort((p, q) => (STATE_ORDER[p[0].state] ?? 4) - (STATE_ORDER[q[0].state] ?? 4) || p[1] - q[1]).map((x) => x[0]);
}

/** FR-345: the order a folder's desks are laid out in: the model's order when the folder has a saved desk order (`keep`), else the status order (FR-022).
 *  The one function the layouts (`realLayout`, `aislesLayout`) and the keys' move (`deskOrder`) share, so a move starts from what is on screen. */
export function shownDesks(f: RealFolder): RealAgent[] { return f.keep ? f.agents : sortDesks(f.agents); }

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

/** Every split of `list` into at most `most` runs of neighbours (spec 097 FR-353): the rooms keep their order, left to right and top to bottom. */
function roRuns<T>(list: T[], most: number): T[][][] {
  const res: T[][][] = [];
  const rec = (i: number, cur: T[][]): void => {
    if (i === list.length) { res.push(cur.map((r) => r.slice())); return; }
    cur[cur.length - 1].push(list[i]); rec(i + 1, cur); cur[cur.length - 1].pop();
    if (cur.length < most) { cur.push([list[i]]); rec(i + 1, cur); cur.pop(); }
  };
  if (list.length) rec(1, [[list[0]]]);
  return res;
}

interface Row { zones: RealFolder[]; n: number; Sw: number; scrH: number; /** FR-306: the strip's height in this row, 0 when no desk of it has helpers */ strip: number }
interface Geom { dh: number; head: number; deskBack: number; bottom: number; stripY: number; /** the row without its strip: the desk picture is cut here */ base: number }

/** FR-013, FR-014, FR-015: a row's vertical geometry at unit u. The head room covers a raised hand of every seated person in the row
 *  (whatever their status), and the plate room is the needs-you height, so a status change never moves a desk. */
function roRowGeom(meta: RealMeta, r: Row, u: number): Geom {
  const dh = 0.382 * Math.min(r.Sw - 6, 2 * u);
  let rise = 0, hand = DESK_AT * 0.9, seated = false;
  for (const z of r.zones) { const st = roZoneStats(meta, z); if (st.seated) { seated = true; rise = Math.max(rise, st.rise); hand = Math.max(hand, st.hand); } }
  const head = r.scrH ? r.scrH + 0.05 * u : Math.max(0.07 * u, seated ? rise * u - STRIP + 3 : 0);
  const deskBack = STRIP + head + (hand + 0.015) * u;
  const base = deskBack + Math.max(0.62 * dh * 0.92, 0.22 * dh + PLATE_H_ASK + 4) + 4;
  /* FR-306: the strip stands under the needs-you plate's height (a fixed place, so a status change moves nothing, FR-015) and adds its own height to the row */
  return { dh, head, deskBack, bottom: base + r.strip, stripY: base - 2, base };
}
/* per zone, once: does anyone sit, the highest raised hand (headTop / bodyH) and the lowest hands (hand), in units of u */
const RO_ZONE_STATS = new WeakMap<RealFolder, { seated: boolean; rise: number; hand: number }>();
function roZoneStats(meta: RealMeta, z: RealFolder): { seated: boolean; rise: number; hand: number } {
  let st = RO_ZONE_STATS.get(z);
  if (!st) {
    st = { seated: false, rise: 0, hand: DESK_AT * 0.9 };
    for (const a of z.agents) {
      const m = roSeatOf(meta, a);
      st.seated = true; st.rise = Math.max(st.rise, m ? m.headTop / m.bodyH : 0.3); st.hand = Math.max(st.hand, m ? m.hand : DESK_AT);
    }
    RO_ZONE_STATS.set(z, st);
  }
  return st;
}
/** rows of contiguous zones with about the same number of desks each (the search for many zones, FR-011 and FR-019) */
function roBalanced<T extends RealFolder>(order: T[], rows: number): T[][] {
  const wt = (z: T): number => z.agents.length;
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

/** FR-306: a row holds the strip's height only when a desk of it has helpers (the lounge's seats never do, FR-306) */
const roStrip = (zs: readonly RealFolder[], hh: number): number => (hh && zs.some((z) => z.agents.some((a) => (a.helpers || 0) > 0)) ? hh : 0);
const roSlotWidth = (W: number, zones: number, n: number): number => (W - 2 * PAD - ZGAP * (zones - 1) - zones * 8) / n;

/** FR-023: the lobby band's height range for an office of height H. */
export function lobbyRange(H: number): [number, number] {
  return [Math.round(Math.max(116, Math.min(150, H * 0.15))), Math.round(H * 0.24)];
}

/** FR-011, FR-020: the rows of folders and the unit u, by search. */
function roPack(meta: RealMeta, folders: RealFolder[], W: number, Ho: number, lobbyMin: number, hh = 0, keepRooms = false): { rows: Row[]; u: number; used: number; fits: boolean; wide: boolean } {
  const total = folders.reduce((p, f) => p + f.agents.length, 0);
  const avail = Ho - lobbyMin;
  if (total <= BIG_MAX) {
    const row: Row = { zones: folders, n: folders.reduce((p, f) => p + f.agents.length, 0), Sw: 0, scrH: 0, strip: roStrip(folders, hh) };
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
    : keepRooms ? roRuns(folders, maxRows) /* FR-353: only the splits that keep the saved order */
    : roSetPartitions(folders, maxRows).map((rs) => rs.map((zs) => zs.slice().sort((p, q) => at(p) - at(q))).sort((p, q) => at(p[0]) - at(q[0])));
  for (const part of cands) {
    const rows: Row[] = part.map((zs) => { const n = zs.reduce((p, z) => p + z.agents.length, 0); return { zones: zs, n, Sw: roSlotWidth(W, zs.length, n), scrH: 0, strip: roStrip(zs, hh) }; });
    const uW = Math.min(...rows.map((r) => r.Sw / (PW + SR)));
    const H = (u: number): number => rows.reduce((p, r) => p + roRowGeom(meta, r, u).bottom, 0);
    let lo = U_MIN, hi = Math.min(uW, U_MAX);
    const fits = hi >= lo && H(lo) <= avail;
    if (fits) for (let k = 0; k < 16; k++) /* 16 halvings: u to within 0.005 px (b2.js used 30) */ { const m = (lo + hi) / 2; if (H(m) <= avail) lo = m; else hi = m; }
    const used = H(lo), spread = Math.max(...rows.map((r) => r.n)) - Math.min(...rows.map((r) => r.n));
    const wide = uW >= U_MIN; /* every desk at least as wide as a person and a screen at the smallest u */
    const score = (fits ? 2e6 : wide ? 1e6 - used : uW * 100 - used) + lo - spread * 5 - 0.08 * Math.max(0, avail - used); /* nothing wide enough: the widest desks, not the shortest page */
    if (!best || score > best.score + 0.5) best = { rows, u: lo, used, score, fits, wide };
  }
  return best as { rows: Row[]; u: number; used: number; fits: boolean; wide: boolean };
}

/** FR-024: the standing picture for a visitor at a place (the pose, else its fallback), or null when the person has neither. */
export function standPose(meta: RealMeta, person: string | null | undefined, place: string, custom: boolean): { pose: string; size: [number, number]; figH: number; feet: number; top: number; foot: number } | null {
  if (!person || !roOwn(meta.stand, person)) return null;
  const st = meta.stand[person], want = custom ? 'wait' : (roOwn(FX_POSE, place) ? FX_POSE[place] : 'wait');
  for (const p of [want, POSE_FALLBACK[want]]) if (p && roOwn(st.poses, p)) return { pose: p, size: st.poses[p], figH: st.figH, feet: st.feet && roOwn(st.feet, p) ? st.feet[p] : 1, top: st.top && roOwn(st.top, p) ? st.top[p] : 0, foot: st.foot && roOwn(st.foot, p) ? st.foot[p] : 0.5 };
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
export function lobbyWidths(fixtures: readonly number[], counts: readonly number[], W: number, vw: number, minStep = 0): { x: number[]; w: number[]; fw: number[]; scale: number[]; step: number; shown: number[]; compact: boolean[]; gap: number } {
  const n = fixtures.length, GAP = 4;
  const compact = fixtures.map(() => false), shown = counts.map((c) => Math.max(0, c | 0));
  const busy = (i: number): boolean => counts[i] > 0;
  let step = Math.max(0.8 * vw, minStep), se = 1, sb = 1, cw = COMPACT_W;
  const scaleOf = (i: number): number => (busy(i) ? sb : Math.min(se, sb));
  const fwOf = (i: number): number => (compact[i] ? cw : fixtures[i] * scaleOf(i));
  const wOf = (i: number): number => fwOf(i) + (shown[i] && !compact[i] ? 0.7 * vw + (shown[i] - 1) * step : 0);
  const total = (): number => fixtures.reduce((s0, _, i) => s0 + wOf(i), 0) + GAP * (n + 1);
  const artOf = (pick: (i: number) => boolean): number => fixtures.reduce((s0, f, i) => s0 + (!compact[i] && pick(i) ? f : 0), 0);
  let art = artOf((i) => !busy(i));
  if (total() > W && art) se = Math.max(0.55, 1 - (total() - W) / art);
  const many = shown.reduce((s0, c) => s0 + Math.max(0, c - 1), 0);
  if (total() > W && many) step = Math.max(0.45 * vw, minStep, step - (total() - W) / many);
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
/**
 * Spec 102 FR-255 (#1104): a pixel world's lobby fixture scale (CSS px per art pixel): the nearest whole scale to `raw` when it fits the free
 * floor `room` and its top stays 3 px inside the band (`floorY` is the floor line), else the whole scale below (at least 1).
 */
export function lobbyScale(raw: number, artW: number, room: number, floorLine: number, floorY: number, dpr = 1): number {
  const st = devStep(dpr), r = raw / st;
  const up = Math.round(r), down = Math.max(1, Math.floor(r + 1e-6));
  return (up > down && artW * up * st <= room && floorY - floorLine * up * st >= 3 ? up : down) * st;
}
/** Spec 102 FR-255 (T204, #1403): the smallest CSS length that is a whole number of device pixels: 1 at a whole device pixel ratio (so ratios 1, 2, 3 change nothing), 1/dpr otherwise (1.25: 0.8, 1.5: 2/3). */
export function devStep(dpr = 1): number {
  return !(dpr > 0) || Math.abs(dpr - Math.round(dpr)) < 1e-9 ? 1 : 1 / dpr;
}
/** Spec 102 FR-255 (T204): `v` (CSS px) rounded to a whole device pixel (to a whole CSS px at a whole ratio); the result times `dpr` is whole. */
export const snapDevice = (v: number, dpr = 1): number => { const st = devStep(dpr); return Math.round(v / st + 1e-9) * st; };
/** Spec 102 FR-255 (#1104): a lobby visitor's whole scale: the one below its own (a larger one could cover its name chip), at least 1 (a device pixel at a fractional ratio). */
export const visitorScale = (k: number, dpr = 1): number => { const st = devStep(dpr); return Math.max(1, Math.floor(k / st + 1e-6)) * st; };

function roLobby(meta: RealMeta, places: RealPlace[], W: number, Lb: number): { fixtures: FixtureBox[]; floorStrip: Rect } {
  const FLOOR = Math.round(Math.max(18, Lb * 0.13)), floorY = Lb - FLOOR + 3;
  const wallH = floorY, fs0 = wallH / meta.floorLine;
  /* a standing person's height in px: 1.7 m against the Boss door's 2.1 m at the band's own scale (not a fixture's compact scale) */
  const doorPx = (meta.floorLine - (meta.fixtureTop && roOwn(meta.fixtureTop, 'boss') ? meta.fixtureTop.boss : meta.floorLine * 0.03)) * fs0;
  const personPx = doorPx * PERSON_M / DOOR_M, vw = personPx * 0.42, nearPx = personPx * NEAR_SCALE;
  const frontY = floorY + FRONT_DEPTH * (Lb - floorY); /* owner 10:48: the front floor plane, inside the floor strip */
  const webW = (meta.fixtures.web || [100, meta.floorLine])[0] * fs0;
  const full = places.map((p) => (!p.custom && roOwn(meta.fixtures, p.id) ? meta.fixtures[p.id][0] * fs0 : webW)); /* FR-027: a custom place is a kiosk the size of the Web fixture */
  const al = lobbyWidths(full, places.map((p) => p.visitors.length), W, vw, meta.pixelArt ? 1.6 * vw : 0); /* spec 102, owner 2026-11-03: in a pixel world nobody stands half behind another; who does not fit is counted on the plate */
  const fixtures: FixtureBox[] = places.map((p, i) => {
    const compact = al.compact[i];
    /* spec 102 FR-255, owner 2026-11-04 (#1104): in a pixel world a fixture is drawn at a whole scale, on whole px,
       so every art pixel is an even square at device scale 1 and 2 */
    const snap = !!meta.pixelArt;
    const artW = !p.custom && roOwn(meta.fixtures, p.id) ? meta.fixtures[p.id][0] : (meta.fixtures.web || [100, meta.floorLine])[0];
    const raw = fs0 * al.scale[i];
    /* the nearest whole scale when it still fits the free floor before the next place (its visitors kept) and stays inside the band, else the one below (#1104) */
    const room = (i + 1 < places.length ? al.x[i + 1] : W) - al.x[i] - (al.w[i] - al.fw[i]) - al.gap; /* the free floor up to the next place, its visitors kept */
    const dpr = meta.dpr || 1, fs = snap ? lobbyScale(raw, artW, room, meta.floorLine, floorY, dpr) : raw;
    const x = snap ? snapDevice(al.x[i], dpr) : al.x[i], fw = snap ? artW * fs : al.fw[i], fh = snap ? meta.floorLine * fs : wallH * al.scale[i];
    const objTop = floorY - fh + (meta.fixtureTop && roOwn(meta.fixtureTop, p.id) && !p.custom ? meta.fixtureTop[p.id] * fs : fh * 0.35);
    const art: Rect | null = compact ? null : { x, y: snap ? snapDevice(floorY - fh, dpr) : floorY - fh, w: fw, h: fh };
    const visitors: VisitorBox[] = compact ? [] : p.visitors.slice(0, al.shown[i]).map((v, j) => {
      const cx = x + fw - 0.3 * vw + vw / 2 + j * al.step;
      const sp = standPose(meta, v.person, p.id, !!p.custom);
      let fig: VisitorBox['fig'] = null, face: Rect | null = null, shadow: Rect | null = null;
      let chipY = Lb - CHIP_H;
      if (sp) {
        /* the feet (the picture's lowest opaque row) stand on the front floor plane, in front of the fixture; one scale per person,
           from its upright 'letter' pose, NEAR_SCALE larger than at the wall line. */
        const k0 = nearPx / standHeight(meta, String(v.person));
        const k = snap && meta.pixelPeople !== false ? visitorScale(k0, dpr) : k0, fw2 = sp.size[0] * k, fh2 = sp.size[1] * k; /* FR-255 (#1104): whole scale in a pixel world */
        const px = (n: number): number => (snap ? snapDevice(n, dpr) : n);
        const faces = meta.facing || 'left', st = meta.stand[String(v.person)], fb = roOwn(POSE_FRAME_B, sp.pose) && roOwn(st.poses, POSE_FRAME_B[sp.pose]) ? POSE_FRAME_B[sp.pose] : null;
        /* the two running pictures have their own canvases: each in its own box, the feet on one spot, so changing picture moves no foot */
        const b = fb ? (() => { const w = st.poses[fb][0] * k, h = st.poses[fb][1] * k; return { x: px(cx - (st.foot && roOwn(st.foot, fb) ? st.foot[fb] : sp.foot) * w), y: px(frontY - (st.feet && roOwn(st.feet, fb) ? st.feet[fb] : sp.feet) * h), w, h }; })() : null;
        fig = { x: px(cx - sp.foot * fw2), y: px(frontY - sp.feet * fh2), w: fw2, h: fh2, file: `${v.person}-${sp.pose}.webp`, fileB: fb ? `${v.person}-${fb}.webp` : null, b, pose: sp.pose, feetY: frontY, faces };
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

/** spec Changes 2026-11-01: an empty seat's note, square like a real one, standing on the desk where the person would sit, clear of the screen when there is room */
function roNote(px: number, sx: number, slotW: number, sl: number, deskY: number, u: number, big: boolean): { x: number; y: number; s: number } {
  const s = Math.round(Math.max(66, Math.min(112, 0.5 * u)));
  const x = big ? px : Math.max(sx + s / 2 + 4, Math.min(px, sl - s / 2 - 4));
  return { x: Math.min(x, sx + slotW - s / 2 - 2), y: deskY - s + 4, s };
}

/** FR-013, FR-016, FR-017, FR-036, FR-038: one desk (roStation) in a slot. */
function roStation(meta: RealMeta, a: RealAgent, sx: number, y: number, Sw: number, u: number, g: Geom, big: boolean, scrH: number, hr = 0, hh = 0): DeskBox {
  const narrow = roNarrow(a);
  const slotW = Sw;
  const deskY = y + g.deskBack, dw = slotW - 6, dh = g.dh;
  const m = roSeatOf(meta, a);
  const hand = m ? m.hand : DESK_AT;
  const headY = deskY - 0.015 * u - hand * u;
  const px = big ? sx + slotW / 2 : sx + 0.05 * Sw + 0.42 * u;
  let person: DeskBox['person'] = null, face: Rect | null = null;
  const pose = SEAT_POSE[a.state];
  if (m && pose && !narrow) {
    const k = u / m.bodyH, w = m.w * k, h = m.h * k, top = headY - m.headTop * k;
    person = { x: px - w / 2, y: top, w, h, file: `${a.person}-${pose}.webp`, fileB: roOwn(POSE_FRAME_B, pose) ? `${a.person}-${POSE_FRAME_B[pose]}.webp` : null, pose, pid: String(a.person),
      vis: { x: Math.max(sx, Math.min(px - 0.3 * u, sx + slotW - 0.6 * u)), y: headY, w: Math.min(0.6 * u, slotW), h: Math.max(0, deskY - headY) } }; /* the head and shoulders: the monitor may cover a shoulder edge, never the face */
    face = { x: px - FACE_U * u * 0.4, y: headY, w: FACE_U * u * 0.8, h: FACE_U * u };
  }
  let sl = px + 0.36 * u, sr = sx + slotW - 0.05 * Sw, sw = sr - sl;
  let foot = deskY + 0.13 * dh, neck = Math.max(6, 0.07 * u);
  let sh = Math.min(sw * (Sw > 300 ? 0.78 : 0.64), foot - neck - (y + STRIP + 3));
  if (big) { const top = 6; sl = sx + 0.04 * slotW; sr = sx + 0.96 * slotW; sw = sr - sl; sh = scrH - 4 - top; neck = 0; foot = y + STRIP + top + sh; }
  sh = Math.max(12, sh);
  const screen = { x: sl, y: foot - neck - sh, w: sw, h: sh + neck + 4 };
  const glass = { x: sl + 3, y: foot - neck - sh + 3, w: sw - 6, h: sh - 6 };
  const plateH = roNeedsYou(a.state) ? PLATE_H_ASK : PLATE_H;
  const plate = { x: sx + 8, y: deskY + 0.22 * dh + 2, w: slotW - 16, h: plateH };
  /* the desk picture is dh tall; the row shows its top (desktop, front panel, the upper legs), so the box is cut at the row's bottom */
  const desk = { x: sx + 3, y: deskY, w: dw, h: Math.min(dh, g.base - g.deskBack - 2), full: dh };
  const strip = hr > 0 && hh > 0 && (a.helpers || 0) > 0 ? { x: plate.x, y: y + g.stripY, w: plate.w, h: hh - 2, rows: hr, cols: helpCols(plate.w), shown: helpShown(plate.w, hr, a.helpers as number) } : undefined;
  return {
    id: a.id, state: a.state, narrow, slot: { x: sx, y, w: slotW, h: 0 }, desk, plate, screen, glass, person, face, ...(strip ? { strip } : {}),
    away: a.away ? roNote(px, sx, slotW, sl, deskY, u, big) : null, /* the note on the desk, where the person would sit */
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

/** FR-356 (bug #1392): the narrowest whole sign: its name cut to 3 letters, no path, the counts, the cost (`counts` counts it, as `signWidth`), + and menu. Measured 183 px with two
 *  counts and a cost (the cave at 1280x800, 2026-11-09), plus 7 px for a wider font (#1079). A room narrower than this takes the short sign (FR-256's: no cost, no path). */
export const signMin = (counts: number): number => 100 + 30 * counts;

/** FR-019: the whole office: pure, no DOM. `signs` gives each folder's sign text lengths (name, path, number of count chips). */
export function realLayout(model: RealModel, viewport: { w: number; h: number }, meta: RealMeta, signs?: Record<string, { name: string; path: string; counts: number }>): Layout {
  const W = Math.max(200, viewport.w), H0 = Math.max(200, viewport.h);
  /* FR-246, FR-247: the lounge's agents leave their folders; the row's height is set aside before the desk search, so the room they leave goes to the desks. The lobby keeps its range from the whole height. */
  const { desks: atDesks, lounge } = splitLounge(model);
  const folders = atDesks.filter((f) => f.agents.length).map((f) => ({ id: f.id, agents: shownDesks(f) })); /* FR-345: a saved desk order is kept */
  const [lobbyMin, lobbyMax] = lobbyRange(H0);
  const LR = lounge.length ? loungeRows(meta, lounge, W, 0) : null, R = LR ? LR.h : 0, Ho = Math.max(200, H0 - R);
  const zones: ZoneBox[] = [];
  let u = U_MIN, big = false, used = 0, fits = true, rows: Row[] = [], helpRows = 0;
  if (folders.length) {
    /* a folder too big for one row is split into parts (its sign repeats, "continued"), the fewest splits that fit; spec 097 delta 2026-10-31 */
    const rank = (x: ReturnType<typeof roPack>): number => (x.fits ? 2 : x.wide ? 1 : 0);
    /* the search, as one function of the folders, the floor's height and the strip's height `hh` (0: none), so the helper levels (FR-308) are more steps of the same search */
    const pack = (fs: typeof folders, ho: number, hh: number): ReturnType<typeof roPack> => {
      let p = roPack(meta, fs, W, ho, lobbyMin, hh, !!model.keepRooms);
      for (const most of [8, 6, 5, 4]) {
        if (p.fits) break;
        if (!fs.some((f) => f.agents.length > most)) continue;
        const parts = fs.flatMap((f) => { const k = Math.ceil(f.agents.length / most), per = Math.ceil(f.agents.length / k); return Array.from({ length: k }, (_, i) => ({ id: i ? f.id + '\u0000' + (i + 1) : f.id, agents: f.agents.slice(i * per, (i + 1) * per) })); });
        const q = roPack(meta, parts, W, ho, lobbyMin, hh, !!model.keepRooms);
        if (rank(q) > rank(p) || (rank(q) === rank(p) && (q.fits ? q.u > p.u : q.used < p.used))) p = q;
      }
      return p;
    };
    /* FR-308, FR-338: with helpers, one row of head figures is kept while the desks still fit and a slot holds a figure; else none: the plate's +N and dots (FR-016). Never two rows (FR-338).
       `floor` (FR-246, FR-247, delta 2026-11-08, review of PR 1322): the row is taken only while its u is at least `floor`; else no strip (the plate keeps its +N and dots). */
    const choose = (fs: typeof folders, ho: number, floor: number): { p: ReturnType<typeof roPack>; hr: number } => {
      const p0 = pack(fs, ho, 0);
      if (!fs.some((f) => f.agents.some((a) => (a.helpers || 0) > 0))) return { p: p0, hr: 0 };
      const room = (q: ReturnType<typeof roPack>): boolean => q.rows.every((r) => !r.strip || r.Sw - 16 >= HEAD);
      const ok = (q: ReturnType<typeof roPack>): boolean => q.fits && room(q) && q.u >= floor - 1e-6;
      const p1 = pack(fs, ho, helpH(1));
      return ok(p1) ? { p: p1, hr: 1 } : { p: p0, hr: 0 };
    };
    /* FR-246, FR-247: the room the lounge's agents leave goes to the desks, helpers or not. The strip levels are judged against the u the same folders get with those agents
       back at their desks (no lounge row, the whole height, its own strip level): before, a strip that the desks' width paid for could start costing height once the row
       took its share, and the desks shrank when an agent fell asleep (u 103.4 -> 99.4, cave 1280x800, shots-097-moments). */
    const helpersAny = (fs: typeof folders): boolean => fs.some((f) => f.agents.some((a) => (a.helpers || 0) > 0));
    const back = lounge.length && helpersAny(folders) ? model.folders.filter((f) => f.agents.length).map((f) => ({ id: f.id, agents: sortDesks(f.agents) })) : null;
    const floor = back ? choose(back, H0, 0).p.u : 0;
    const c = choose(folders, Ho, floor);
    const p = c.p; helpRows = c.hr;
    rows = p.rows; u = p.u; used = p.used; fits = p.fits; big = rows.length === 1 && rows[0].scrH > 0;
  }
  const Lb = Math.round(fits ? Math.max(lobbyMin, Math.min(Ho - used, lobbyMax)) : lobbyMin);
  const spare = fits ? Math.max(0, Ho - Lb - used) : 0, extra = spare / (rows.length + 1);
  let y = Lb + extra / 2;
  for (const r of rows) {
    const g = roRowGeom(meta, r, u);
    let x = PAD + (W - 2 * PAD - (r.Sw * r.n + ZGAP * (r.zones.length - 1) + r.zones.length * 8)) / 2;
    for (const z of r.zones) {
      const zw = r.Sw * z.agents.length + 8;
      const desks: DeskBox[] = [];
      let ax = x + 4;
      for (const a of z.agents) { const d = roStation(meta, a, ax, y, r.Sw, u, g, big, r.scrH, r.strip ? helpRows : 0, r.strip); d.slot.h = g.bottom; desks.push(d); ax += r.Sw; }
      /* FR-018: the sign sits at the left unless a raised hand (a waving person's picture rising into the strip) is there */
      const s0 = z.id.split('\u0000')[0], s = signs && roOwn(signs, s0) ? signs[s0] : { name: s0, path: '', counts: 1 };
      const sw = signWidth(s.name, s.path, s.counts, zw);
      const hands = desks.filter((d) => d.person && roNeedsYou(d.state) && d.person.y < y + STRIP).map((d) => [d.person!.x, d.person!.x + d.person!.w * 0.6]);
      const hits = (px: number): boolean => hands.some(([a, b]) => b > px && a < px + sw);
      let sx = x + 4;
      if (hits(sx)) { sx = x + zw - 4 - sw; if (hits(sx)) sx = Math.max(...hands.map((h) => h[1])) + 6; }
      sx = Math.max(x + 4, Math.min(sx, x + zw - 4 - sw));
      const [fid, part] = z.id.split('\u0000');
      /* spec 097 FR-356 (bug #1392): the path gives way first, then the name down to 3 letters; a room too narrow even then takes FR-256's short sign (name, counts, + and menu; the cost on the name's hover) */
      const short = signMin(s.counts) > zw - 8;
      zones.push({ id: fid, part: Number(part || 1), box: { x, y: y + 2, w: zw, h: g.bottom - 2 }, sign: { x: sx, y: y + 1, w: sw, h: 20 }, desks, ...(short ? { signShort: true } : {}) });
      x += zw + ZGAP;
    }
    y += g.bottom + extra;
  }
  const lb = roLobby(meta, model.places, W, Lb);
  const fitsAll = fits && Ho + R <= H0 + 0.5;
  const height = fitsAll ? H0 : Math.ceil(Lb + used + PAD + R);
  const lay: Layout = { u, big, lobbyH: Lb, floorH: height - Lb, width: W, height, scroll: !fitsAll, faceH: FACE_U * u, zones, fixtures: lb.fixtures, floorStrip: lb.floorStrip, helpRows };
  if (LR) lay.lounge = loungeRows(meta, lounge, W, height - R).row;
  return lay;
}

/** FR-246: the agents the app put in the lounge (`lounge`, never one away at a place) leave their folders; the lounge in status order (FR-022), then folder order */
export function splitLounge(model: RealModel): { desks: RealFolder[]; lounge: RealAgent[] } {
  const inLounge = (a: RealAgent): boolean => !!a.lounge && !a.away;
  return { desks: model.folders.map((f) => ({ id: f.id, keep: f.keep, agents: f.agents.filter((a) => !inLounge(a)) })), lounge: sortDesks(model.folders.flatMap((f) => f.agents.filter(inLounge))) };
}

/** FR-247 (owner 2026-11-06, issue #1220): a lounge seat in the `rows` worlds. LOUNGE_U: the seated person's body height (a face of FACE_U x 84 = 25 px, over FR-229's 24);
 *  LOUNGE_SHOW: the share of the seated picture above the plate (the plate stands in front of the lap, as a desk does); LOUNGE_TABLE: the small desk's width in units */
export const LOUNGE_U = 84, LOUNGE_SHOW = 0.68, LOUNGE_TABLE = 0.62, LOUNGE_GAP = 6, LOUNGE_PAD = 6;
/** FR-247: the seat width and the row height, from every person of the set (not only the ones seated now), so a seat never changes size with who sits there */
export function loungeSeat(meta: RealMeta): { w: number; h: number; above: number; pw: number } {
  const seats = Object.values(meta.seat || {});
  const pw = Math.max(0.8 * LOUNGE_U, ...seats.map((m) => (m.w / m.bodyH) * LOUNGE_U)), ph = Math.max(1.2 * LOUNGE_U, ...seats.map((m) => (m.h / m.bodyH) * LOUNGE_U));
  const above = Math.ceil(ph * LOUNGE_SHOW);
  return { w: Math.ceil(0.86 * pw + LOUNGE_TABLE * LOUNGE_U + LOUNGE_GAP), h: LOUNGE_PAD + above + PLATE_H_ASK + LOUNGE_PAD, above, pw };
}
/** FR-247: the lounge row(s) of `agents` across a floor `W` wide, its top at `top`: seats of one width, centred, as many rows as it takes. `h` is the whole height. */
export function loungeRows(meta: RealMeta, agents: readonly RealAgent[], W: number, top: number): { h: number; row: { box: Rect; desks: DeskBox[] } } {
  const S = loungeSeat(meta), per = Math.max(1, Math.floor((W - 2 * PAD) / S.w)), n = agents.length, rows = Math.ceil(n / per);
  const deskAR = meta.desk ? meta.desk[1] / meta.desk[0] : 0.38, tw = LOUNGE_TABLE * LOUNGE_U, th = tw * deskAR;
  const desks = agents.map((a, i): DeskBox => {
    const r = Math.floor(i / per), inRow = Math.min(per, n - r * per), x0 = (W - inRow * S.w) / 2, sx = x0 + (i - r * per) * S.w, y = top + r * S.h;
    const plateY = y + LOUNGE_PAD + S.above, m = roSeatOf(meta, a), pose = 'rest';
    let person: DeskBox['person'] = null, face: Rect;
    const px = sx + 2 + S.pw / 2; /* the person's centre: at the seat's left, the small desk at its right */
    if (m) {
      const k = LOUNGE_U / m.bodyH, w = m.w * k, h = m.h * k, pt = plateY - LOUNGE_SHOW * h, headY = pt + m.headTop * k;
      person = { x: px - w / 2, y: pt, w, h, file: `${a.person}-${pose}.webp`, fileB: null, pose, pid: String(a.person), vis: { x: px - 0.3 * LOUNGE_U, y: headY, w: 0.6 * LOUNGE_U, h: Math.max(0, plateY - headY) } };
      face = { x: px - FACE_U * LOUNGE_U * 0.4, y: headY, w: FACE_U * LOUNGE_U * 0.8, h: FACE_U * LOUNGE_U };
    } else face = { x: px - FACE_U * LOUNGE_U * 0.4, y: plateY - 0.62 * LOUNGE_U, w: FACE_U * LOUNGE_U * 0.8, h: FACE_U * LOUNGE_U }; /* no picture: the initials go where the face would be (FR-065) */
    /* the small desk stands on the floor behind the plate's top edge; the monitor on it, its foot on the desktop */
    const table = { x: sx + S.w - LOUNGE_GAP - tw, y: plateY + 2 - th, w: tw, h: th };
    const sw = 0.92 * tw, sh = sw * 0.6, neck = 6, foot = table.y + 0.14 * th;
    const screen = { x: table.x + (tw - sw) / 2, y: foot - neck - sh, w: sw, h: sh + neck + 4 };
    const glass = { x: screen.x + 3, y: screen.y + 3, w: sw - 6, h: sh - 6 };
    return {
      id: a.id, state: a.state, lounge: true, narrow: false, slot: { x: sx, y, w: S.w, h: S.h }, desk: { ...table, full: th }, table,
      plate: { x: sx + 2, y: plateY, w: S.w - 4, h: PLATE_H_ASK }, screen, glass, person, face, away: null,
      lamp: { x: sx + 2, y: y + 2, w: S.w - 4, h: S.h - 4 }, bubble: null, bang: null, dots: null, call: { x: sx + S.w - 16, y: plateY },
    };
  });
  const w = Math.min(n, per) * S.w;
  return { h: rows * S.h, row: { box: { x: (W - w) / 2 - 4, y: top, w: w + 8, h: rows * S.h }, desks } };
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

/** the lobby band (fixtures and their visitors), for arrangements other than `rows` (spec 102 FR-256: the arcade hall keeps today's band) */
export { roLobby as lobbyBand };

/** Spec 097 FR-110, FR-121: where a slip, a bubble or a pill goes. The first free spot nearest `anchor` inside `bounds` that touches nothing in `avoid`
 *  (a plate, a sign, a chair label, a chip), or null when there is none. Pure; a 10 px grid keeps it cheap (a few hundred thousand comparisons at most). */
export function placeBox(size: { w: number; h: number }, avoid: readonly Rect[], bounds: Rect, anchor: { x: number; y: number }, step = 10): Rect | null {
  const hit = (x: number, y: number): boolean => avoid.some((r) => x < r.x + r.w && r.x < x + size.w && y < r.y + r.h && r.y < y + size.h);
  let best: { x: number; y: number; s: number } | null = null;
  for (let y = bounds.y; y + size.h <= bounds.y + bounds.h + 0.01; y += step) {
    for (let x = bounds.x; x + size.w <= bounds.x + bounds.w + 0.01; x += step) {
      const s = Math.abs(x + size.w / 2 - anchor.x) + 0.6 * Math.abs(y - anchor.y);
      if (best && s >= best.s) continue;
      if (!hit(x, y)) best = { x, y, s };
    }
  }
  return best ? { x: best.x, y: best.y, w: size.w, h: size.h } : null;
}

/** Spec 097 FR-106 (owner 2026-11-01: "too much space above head"): the square of a seated picture that the chat's round header portrait shows. The side is 0.72 of the
 *  body height (the face, FACE_U of it, fills about 40 % of the circle), its top is 12 % of the side above the top of the head, and it stays inside the picture (moved down or
 *  sideways, never smaller). Same data as the layout's face box (FACE_U, `headTop`, `bodyH`): one definition of where the face is. */
export const PORTRAIT_SIDE = 0.72, PORTRAIT_AIR = 0.12;
export function portraitCrop(seat: { w: number; h: number; headTop: number; bodyH: number }): { x: number; y: number; s: number } {
  const s = Math.min(PORTRAIT_SIDE * seat.bodyH, seat.w, seat.h);
  const y = Math.max(0, Math.min(seat.h - s, seat.headTop - PORTRAIT_AIR * s));
  const x = Math.max(0, Math.min(seat.w - s, seat.w / 2 - s / 2));
  return { x, y, s };
}

/** Owner ruling 2026-11-02: the post-it on an empty seat has one paper colour per reason (the place the agent went to), dark ink on every one (contrast 4.5:1 or more,
 *  held by test:realoffice-layout); the words "at <place>" stay, so colour never carries the meaning alone. One default for a place the table does not know (a custom place).
 *  The Boss is a calm blue, not an alarm colour: most visits to the Boss door are ordinary. No shadow or animation belongs to the colours. */
export const NOTE_INK = '#2a2205';
export const NOTE_PAPER: Record<string, string> = {
  boss: '#bfd9f2', bank: '#bfe8bd', coffee: '#ffcf9e', library: '#f6e27f', software: '#d9c6f0', terminal: '#b8e6e0', web: '#f5c1d6', other: '#dcc9a3',
};
export const NOTE_PAPER_DEFAULT = '#ece9e0';
export const notePaper = (place: string | null | undefined): string => (place && roOwn(NOTE_PAPER, place) ? NOTE_PAPER[place] : NOTE_PAPER_DEFAULT);

/** Spec 097 FR-110, FR-121: what a slip, a bubble or a pill must never cover, from the drawn layout: signs, plates, faces (who needs you is read from them),
 *  the post-it on an empty seat, a desk's `?` bubble and `!` mark. Pure, so a test holds it to the boxes the renderer really draws. */
export function slipAvoid(lay: Layout): Rect[] {
  const out: Rect[] = [];
  /* FR-247: the lounge's seats are avoided as the desks are (plate, face) */
  for (const z of [...lay.zones, ...(lay.lounge ? [{ sign: null, desks: lay.lounge.desks }] : [])]) {
    if (z.sign) out.push({ x: z.sign.x, y: z.sign.y, w: z.sign.w, h: z.sign.h });
    for (const d of z.desks) {
      out.push(d.plate);
      if (d.strip) out.push({ x: d.strip.x, y: d.strip.y, w: d.strip.w, h: d.strip.h }); /* FR-310 */
      if (d.face) out.push(d.face);
      if (d.away) out.push({ x: d.away.x - d.away.s / 2 - 4, y: d.away.y - 2, w: d.away.s + 8, h: d.away.s + 6 }); /* the note's own square, with a little for its tilt */
      if (d.bubble) out.push({ x: d.bubble.x, y: d.bubble.y - 24, w: 24, h: 24 });
      if (d.bang) out.push({ x: d.bang.x, y: d.bang.y, w: 20, h: 20 });
    }
  }
  return out;
}

/* ---- Phase P2: live screens and motion (FR-030..FR-035, FR-070..FR-074) ---- */

/** One line of a monitor: `n` stays with the line while it scrolls, `k` is its kind (FR-032's colours), `t` is masked text. */
export interface ScreenLine { n: number; k: string; t: string }
/** spec 097 FR-322, FR-323: the line round a monitor frame. `pct` is the context share (a whole number 0..100, or null when unknown), `level` the existing
 *  band of `DurbarStats.ctxLevel` (ok below 70, warn from 70, high above 90). Null: no line at all (unknown, or nothing used yet). Else the band and the
 *  stroke-dasharray for a rect with pathLength 100, which starts at the top-left corner and runs clockwise: the dash is the share. */
export function ctxFrame(pct: number | null | undefined, level: string | null | undefined): { lv: 'ok' | 'warn' | 'high'; dash: string } | null {
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct <= 0) return null;
  if (level !== 'ok' && level !== 'warn' && level !== 'high') return null;
  return { lv: level, dash: Math.min(100, pct) + ' 100' };
}
/** the context words of a plate's accessible name, the flat office's way: ", context 72 %" (empty when unknown) */
export function ctxWords(pct: number | null | undefined): string {
  return typeof pct === 'number' && Number.isFinite(pct) && pct >= 0 ? ', context ' + Math.min(100, Math.round(pct)) + ' %' : '';
}

/** FR-032: a screen under this size shows line bars and the newest line; larger ones real lines, 13 px when taller than 200 px. */
export const SCREEN_SMALL = { w: 150, h: 60 };
export const SCREEN_PAD = 4;
/** FR-032: how a glass of this size shows text: `rows` lines of text and `bars` line bars above them. */
export function screenFit(glass: { w: number; h: number }, g = 0): { small: boolean; font: number; lh: number; rows: number; bars: number; whole: number } {
  const room = Math.max(0, glass.h - 2 * SCREEN_PAD);
  if (glass.w < SCREEN_SMALL.w || glass.h < SCREEN_SMALL.h) {
    const lh = 13;
    /* the newest line wraps over the rows it needs, the bars show above it as far as room is left; `whole`: the height of whole text rows */
    return { small: true, font: 10.5, lh, rows: 1, bars: Math.max(0, Math.floor((room - lh - 2) / 6)), whole: Math.max(lh, Math.floor(room / lh) * lh) };
  }
  /* spec 102 (relayed, 2026-11-03): in the arcade above g = 3 the text grows with the art, 11 px at g = 3 */
  const font = g > 3 ? Math.round(11 * g / 3 * 2) / 2 : glass.h > 200 ? 13 : 11, lh = g > 3 ? Math.round(font * 1.36) : font === 13 ? 17 : 15;
  let rows = Math.max(1, Math.floor(room / lh));
  if (g > 3 && rows < BIG_ROWS && Math.floor(room / 15) >= BIG_ROWS) {
    /* spec 102 FR-308: the arcade's text grows with the art only while SC-003's lines stay: the largest size, down to 11 px, that still holds BIG_ROWS lines */
    let f = font; while (f > 11 && Math.floor(room / Math.round(f * 1.36)) < BIG_ROWS) f -= 0.5;
    const l = f === 11 ? 15 : Math.round(f * 1.36);
    rows = Math.floor(room / l);
    return { small: false, font: f, lh: l, rows, bars: 0, whole: rows * l };
  }
  return { small: false, font, lh, rows, bars: 0, whole: rows * lh };
}
/**
 * FR-030, FR-035: what a screen shows for a state. `log`: the agent's own lines, oldest first; `task` and `reply`: the same masked
 * steps over its task and last reply, used when it has no lines; `word`: the status word, so that a screen never stands empty. Asleep:
 * off, no text. `quiet`: Live activity is off while it works: only the word, with decorative bars. Needs-you and error: the question or the error is the newest line. Done: the newest line is marked done (green).
 */
export function screenFor(state: RealState, log: readonly ScreenLine[], task: readonly { k: string; t: string }[], reply: readonly { k: string; t: string }[], word: string, quiet = false): { off: boolean; caret: boolean; quiet: boolean; lines: ScreenLine[] } {
  if (state === 'asleep') return { off: true, caret: false, quiet: false, lines: [] };
  const lines: ScreenLine[] = log.map((l) => ({ ...l }));
  const add = (src: readonly { k: string; t: string }[], k?: string) => { for (const l of src) { const last = lines[lines.length - 1]; if (!last || last.t !== l.t) lines.push({ n: last ? last.n + 1 : 0, k: k || l.k, t: l.t }); else if (k) last.k = k; } };
  if (state === 'waiting' || state === 'limit') add(task, 'ask');
  else if (state === 'error') add(task, 'err');
  else if (!lines.length) { add(reply.length ? reply : task); }
  if (!lines.length) lines.push({ n: 0, k: state === 'error' ? 'err' : state === 'waiting' || state === 'limit' ? 'ask' : 'plain', t: word });
  if (state === 'done') lines[lines.length - 1].k = 'done';
  return { off: false, caret: state === 'working', quiet, lines: lines.slice(-24) };
}
/** A stable number from a session id: the room does not move in step (FR-070). */
function roHash(id: string): number { let h = 7; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h; }
/**
 * FR-070, FR-071, spec 097 FR-181 (at most 2 changes a second a desk): the motion of a seated or standing pose. `kind`: 'frames' (two
 * pictures in step, with `period` s per pair), 'breathe', 'sip', 'knock', or null (a still pose: error, a person on hold). The period is
 * per agent: 1.15-1.5 s for two frames, 4-5.5 s for a breath. `offset` is where its cycle starts, in ms.
 */
export function personMotion(id: string, pose: string, state: RealState | null): { kind: 'frames' | 'breathe' | 'knock' | null; period: number; offset: number; sway: number; style: 'type' | 'wave' | 'run' | null } {
  const h = roHash(String(id)), share = (h % 1000) / 1000, share2 = ((h >>> 10) % 1000) / 1000;
  const out = (kind: 'frames' | 'breathe' | 'knock' | null, period: number, style: 'type' | 'wave' | 'run' | null = null) => ({ kind, period: Math.round(period * 100) / 100, offset: Math.round(share * period * 1000), sway: Math.round((5 + 3 * share2) * 100) / 100, style });
  if (state === 'error') return out(null, 0); /* FR-036: error is still */
  if (pose === 'runA') return out('frames', 0.72 + 0.1 * share, 'run'); /* about 2.6 steps a second (spec Changes 2026-11-01) */
  if (pose === 'waveA') return out('frames', 1.7 + 0.4 * share, 'wave');
  if (roOwn(POSE_FRAME_B, pose)) return out('frames', 2.6 + 0.6 * share, 'type');
  if (pose === 'knock') return out('knock', 2.6);
  return out('breathe', 4 + 1.5 * share);
}

export interface ZoomPlace extends Rect { side: 'above' | 'below' | 'right' | 'left' | 'near' | 'covering'; covers: boolean }
const roHits = (a: Rect, b: Rect, gap = 0) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
/**
 * FR-034: where the zoom panel goes. Above the target if that is free, then below, then beside; then the nearest free place; each at
 * the wished height, then lower down to `minH`. Never leaves `view`; never covers `avoid` (the target's own plate, every needs-you
 * plate and the target itself) unless no place at all is free: then the least covered, `covers` true. Pure.
 */
export function zoomRect(target: Rect, avoid: readonly Rect[], view: Rect, size: { w: number; h: number; minH: number; gap?: number }): ZoomPlace {
  const gap = size.gap ?? 6, w = Math.min(size.w, view.w), maxH = Math.min(size.h, view.h), minH = Math.min(size.minH, maxH);
  const free = (r: Rect) => !avoid.some((a) => roHits(r, a));
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const cx = target.x + target.w / 2, cy = target.y + target.h / 2;
  const heights: number[] = [];
  for (let h = maxH; h > minH; h -= 28) heights.push(h);
  heights.push(minH);
  for (const h of heights) {
    const X = clamp(cx - w / 2, view.x, view.x + view.w - w), Y = clamp(cy - h / 2, view.y, view.y + view.h - h);
    const named: [ZoomPlace['side'], number, number][] = [
      ['above', X, target.y - gap - h], ['below', X, target.y + target.h + gap],
      ['right', target.x + target.w + gap, Y], ['left', target.x - gap - w, Y],
    ];
    for (const [side, x, y] of named) {
      if (x < view.x || x + w > view.x + view.w || y < view.y || y + h > view.y + view.h) continue;
      if (free({ x, y, w, h })) return { x, y, w, h, side, covers: false };
    }
    /* the nearest free place: its edges can only stand against an avoided box or the view */
    const xs = new Set([X, view.x, view.x + view.w - w]), ys = new Set([Y, view.y, view.y + view.h - h]);
    for (const a of avoid) { xs.add(a.x - w - gap); xs.add(a.x + a.w + gap); ys.add(a.y - h - gap); ys.add(a.y + a.h + gap); }
    let best: ZoomPlace | null = null, bestD = Infinity;
    for (const x of xs) {
      if (x < view.x || x + w > view.x + view.w) continue;
      for (const y of ys) {
        if (y < view.y || y + h > view.y + view.h) continue;
        const d = Math.hypot(x + w / 2 - cx, y + h / 2 - cy);
        if (d < bestD && free({ x, y, w, h })) { best = { x, y, w, h, side: 'near', covers: false }; bestD = d; }
      }
    }
    if (best) return best;
  }
  /* nothing is free (a window too small for it): the least covered place, still inside the view */
  const h = minH, lap = (r: Rect) => avoid.reduce((s, a) => s + Math.max(0, Math.min(r.x + r.w, a.x + a.w) - Math.max(r.x, a.x)) * Math.max(0, Math.min(r.y + r.h, a.y + a.h) - Math.max(r.y, a.y)), 0);
  let best: ZoomPlace = { x: clamp(cx - w / 2, view.x, view.x + view.w - w), y: view.y, w, h, side: 'covering', covers: true }, least = Infinity;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
    const r = { x: view.x + (view.w - w) * i / 8, y: view.y + (view.h - h) * j / 8, w, h }, l = lap(r);
    if (l < least) { least = l; best = { ...r, side: 'covering', covers: true }; }
  }
  return best;
}

/** FR-347, FR-348: a folder's desk ids exactly as the layout draws them left to right (lounge seats are not at desks), or [] for an unknown folder. */
export function deskOrder(model: RealModel, folderId: string): string[] {
  const f = splitLounge(model).desks.find((x) => x.id === folderId);
  return f ? shownDesks(f).map((a) => a.id) : [];
}

/** FR-348: the base a desk move is made in and saved from: the desks as shown first, then the keys that are not shown (the lounge, a status filter) in `full` order,
 *  so the first move in a room with no saved order saves the order on screen, with the neighbour on screen swapped. */
export function deskBase(shown: readonly string[], full: readonly string[]): string[] {
  const seen = new Set(shown);
  return [...shown, ...full.filter((k) => !seen.has(k))];
}

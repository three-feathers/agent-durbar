/** Spec 102 FR-227, FR-256 (T202, T203, T205): where the people sit. `rows` is `realLayout`, untouched; `aisles` is the Retro arcade hall:
 *  staggered aisles of cabinets in an integer pixel scale `g`. Pure, no DOM, nothing draws it yet (RA3). The numbers marked "provisional"
 *  come from the mockup and the art by eye and are replaced by measured ones (T201's `faceBox`, T207's frame sizes). */
import { lobbyBand, lobbyRange, loungeRows, realLayout, rowGeom, deskStation, shownDesks, signWidth, signMin, splitLounge, BIG_MAX, helpH, helpCols, helpShown, FACE_U, PW, SR, PAD, ZGAP, STRIP, U_MAX, type DeskBox, type Layout, type RealAgent, type RealMeta, type RealModel, type RealState, type Rect, type ZoneBox, STOREY_GAP, STOREY_TAG_MIN, storeyRuns, storeyTagW, type StoreyBand } from './realoffice-layout';

export const ARRANGEMENTS = ['rows', 'circle', 'aisles'] as const;
export type Arrangement = (typeof ARRANGEMENTS)[number];
export const isArrangement = (v: unknown): v is Arrangement => typeof v === 'string' && (ARRANGEMENTS as readonly string[]).includes(v);

/** FR-256: a person at their cabinet is 72 grid pixels tall and 34 wide (provisional: the art's reduced size), the face 19 from crown to chin (the smallest of the 15 people, measured by `build-arcade-pack.py` into `faceBox`; RA1 had 24 by eye) */
export const AISLE_PERSON = { w: 34, h: 72 } as const;
/** the floor between a cabinet and the person beside it, in grid px: no person is ever cut by a cabinet or a screen (owner, 2026-11-03) */
export const AISLE_GAP = 2;
/** px of floor under the lobby kept for one-line pills (the queue, a limit): always free, so a pill never covers a cabinet or a person; taken from the lobby's height (owner, 2026-11-03) */
export const AISLE_LANE = 20;
/** the lobby's height in the arcade, the same at every window size it fits, so its people are never smaller or tighter at 1280x800 than at 1440x900 (owner, 2026-11-03) */
export const AISLE_LOBBY = 128;
/** with four people or fewer the lobby is taller, the same at both sizes, so the room is not a bare floor (owner, 2026-11-03) */
export const AISLE_LOBBY_FEW = 168;
export const FACE_GRID = 19;
/** FR-229: the face floor, crown to chin, only on a floor of 15 */
export const FACE_FLOOR = 24;
export const AISLE_PLATE_H = 21, AISLE_SIGN_H = 18, AISLE_PAD = 8, AISLE_COLS = 5, AISLE_STAGGER = 0.08, AISLE_CLOSE = 1.1, AISLE_G_FEW = [5, 4, 3, 2], AISLE_LOW_LOBBY = true, AISLE_LOBBY_LOW = 116; /* the lowest lobby: lobbyRange's own floor, where every visitor stands whole and every name chip reads in full (shots-102-arcade) */
/** the sign's shortest form: a name cut to about 30 px, counts, **+** and the room menu (FR-256); path and cost go to its hover and focus */
export const AISLE_SIGN_MIN_W = 120;
/** the three cabinet drawings the pack ships (`monitor.webp` big, `monitor-half.webp` small, `monitor-narrow.webp`): CRT size in grid pixels. The plan picks among these only (spec 102 FR-257). */
export const CABINETS = { big: { gw: 75, gh: 50 }, small: { gw: 56, gh: 32 }, narrow: { gw: 44, gh: 32 } } as const;
/** the face of a cabinet in grid pixels: the CRT `gw` x `gh`, a 5 px bezel, a 7 px side panel, 38 px of marquee, deck and base, a 3 px crown */
export const cabGrid = (gw: number, gh: number): { w: number; h: number } => ({ w: gw + 17, h: Math.max(gh + 41, AISLE_PERSON.h + 1) });

/** which way a cabinet's screen faces: the left columns face right, the right columns face left, the middle column of an odd count alternates by row (FR-256) */
export function aisleFace(col: number, cols: number, row: number): 'left' | 'right' {
  const mid = (cols - 1) / 2;
  return col < mid ? 'right' : col > mid ? 'left' : row % 2 ? 'left' : 'right';
}

/** owner, 2026-11-03 (relayed review of the fourth pictures): a folder of 4 or fewer is never split into "(continued)". Seats run in folder
 *  order; such a folder starts a new row when it does not fit in what is left of one, and one wider than a row (3 in rows of 2) takes whole
 *  rows of its own, under one sign. A bigger folder flows on as before. Where that cannot fit (15 people in folders of 4, 4, 4, 3 need four
 *  rows of five), `keep` is off and every folder flows on: the floor never scrolls for it. */
/** Spec 097 FR-248: `extra` single cells (the lounge's) go after the seats into the free cells at the rows' ends, the last row first, then on new rows */
/** spec 102 delta 2026-11-14 (spec 097 FR-104): `starts` holds the indexes of the folders that begin a new storey (not the first): such a folder always starts a new row, so no row holds two floors */
/** spec 102 delta 2026-11-14 (review of #1741): `ends` maps a folder index to the number of lounge cells that follow that folder in the flow, so a floor's resting seats stand at the end of that floor's own folders (never in another floor's band); `extra` is then not used */
export function packSeats(sizes: number[], cols: number, keep = true, extra = 0, starts?: ReadonlySet<number>, ends?: ReadonlyMap<number, number>): { at: Array<[number, number]>; rows: number; inRow: number[] } {
  const at: Array<[number, number]> = [], cells: Array<[number, number]> = []; let r = 0, c = 0;
  for (const [fi, m] of sizes.entries()) {
    if (starts && starts.has(fi) && c > 0) { r++; c = 0; }
    const small = keep && m <= 4;
    if (small && c > 0 && c + m > cols) { r++; c = 0; }
    for (let j = 0; j < m; j++) { if (c >= cols) { r++; c = 0; } at.push([r, c++]); }
    if (small && m > cols && c > 0) { r++; c = 0; }            /* the rows of a folder wider than a row are its own */
    for (let e = 0; ends && e < (ends.get(fi) || 0); e++) { if (c >= cols) { r++; c = 0; } cells.push([r, c++]); }
  }
  let rows = Math.max(1, c > 0 ? r + 1 : r);
  if (ends) { at.push(...cells); const inRowE = Array.from({ length: rows }, (_, i) => at.filter((p) => p[0] === i).length); return { at, rows, inRow: inRowE }; }
  const inRow = Array.from({ length: rows }, (_, i) => at.filter((p) => p[0] === i).length);
  for (let e = 0; e < extra; e++) {
    let row = -1;
    for (let q = rows - 1; q >= 0 && row < 0; q--) if (inRow[q] < cols) row = q;
    if (row < 0) { row = rows++; inRow.push(0); }
    at.push([row, inRow[row]++]);
  }
  return { at, rows, inRow };
}

interface Plan { keep: boolean; g: number; gw: number; gh: number; cols: number; rows: number; big: boolean; sl: number; rowH: number; slotW: number; fits: boolean }

/** FR-256 (owner, 2026-11-03: "bigger cabinets ... zigzag positioning for max usage"): every plan that fits (scale, cabinet, columns), and the
 *  one that uses the floor best. A brick zigzag (odd rows half a column over) was tried and removed (review of #1079): it needs more width than the
 *  straight plan of the same scale, cabinet and rows and covers the same floor, so it never won; the rows stagger instead. The order: no bare band over a quarter of
 *  the floor if any plan manages that, then the biggest scale, then the biggest cabinet, then the least bare floor. Past what fits, rows are added
 *  at the smallest choice and the floor scrolls inside itself (T203). */
function planFor(sizes: number[], W: number, F: number, PW: number = AISLE_PERSON.w, extra = 0, sh = 0, starts?: ReadonlySet<number>, ends?: ReadonlyMap<number, number>): Plan {
  const gaps = starts ? starts.size * STOREY_GAP : 0; /* the rule between two storeys */
  const k = sizes.reduce((a, b) => a + b, 0) + extra; /* extra: the lounge's cells (spec 097 FR-248) */
  const rowCost = (gh: number, g: number): number => AISLE_SIGN_H + cabGrid(0, gh).h * g + AISLE_PLATE_H + g - 1 + sh; /* g - 1: the cabinet snaps down to the grid; sh: the helper strip's fixed height under every plate (spec 097 FR-306, 0 without helpers) */
  const plans: Plan[] = [];
  for (const keep of [true, false]) for (const g of k <= 4 ? AISLE_G_FEW : [3, 2]) for (const [name, c] of Object.entries(CABINETS)) for (let cols = 1; cols <= AISLE_COLS; cols++) {
    const rows = packSeats(sizes, cols, keep, extra, starts, ends).rows, cab = cabGrid(c.gw, c.gh), slotW = (cab.w + PW + AISLE_GAP) * g;
    const cw = (W - 2 * AISLE_PAD) / cols, spareY = F - rows * rowCost(c.gh, g) - gaps;
    if (slotW > cw || slotW < AISLE_SIGN_MIN_W || spareY < 0 || cols > k) continue;
    plans.push({ keep, g, gw: c.gw, gh: c.gh, cols, rows, big: name === 'big', sl: Math.min(13, Math.floor(spareY / (2 * rows + 2))), /* the bend flattens before anything scrolls */ rowH: rowCost(c.gh, g), slotW, fits: true });
  }
  const bare = (p: Plan): number => F - p.rows * (p.rowH + 2 * p.sl);
  /* 4 or fewer (owner, 2026-11-03: "still waste a lot of space"): the plan whose cabinets and people cover the most floor */
  const cover = (p: Plan): number => k <= 4 ? k * p.g * p.g * (cabGrid(p.gw, p.gh).w * cabGrid(p.gw, p.gh).h + PW * AISLE_PERSON.h) : 0;
  plans.sort((a, b) => Number(b.keep) - Number(a.keep) || cover(b) - cover(a) || Number(bare(a) > F / 4) - Number(bare(b) > F / 4) || b.g - a.g || b.gw * b.gh - a.gw * a.gh || bare(a) - bare(b) || a.rows - b.rows);
  if (plans.length) return plans[0];
  /* it does not fit: five columns of the smallest cabinet, as many rows as it takes, and the floor scrolls */
  const g = 2, gw = CABINETS.narrow.gw, gh = CABINETS.narrow.gh, cols = k <= 4 ? 2 : AISLE_COLS, cab = cabGrid(gw, gh), rows = packSeats(sizes, cols, false, extra, starts, ends).rows;
  return { keep: false, g, gw, gh, cols, rows, big: false, sl: 3, rowH: rowCost(gh, g), slotW: (cab.w + PW + AISLE_GAP) * g, fits: false };
}

/** FR-256, T202, T203: the hall. `view` is the floor the app passes (its width and height). Day and night give the same object (FR-251). */
/** FR-260: how this arrangement draws a status: `lightFor` stays the source of what a state means; this is only its look. `still`: reduced motion or Serious mode: a flash is steady and differs from `lit`, nothing moves. */
export type AisleMarquee = 'lit' | 'flash' | 'alert' | 'flash-red' | 'alert-red' | 'orange' | 'green' | 'dim' | 'off';
export interface AisleStatus { marquee: AisleMarquee; glow: 'faint' | 'strong' | 'small' | 'very-faint' | 'none'; cue: 'none' | 'dots' | 'ask' | 'bang' | 'tick' | 'zz'; bob: boolean; flourish: boolean }
export function aisleStatus(state: RealState, still = false): AisleStatus {
  const t: Record<RealState, AisleStatus> = {
    working: { marquee: 'lit', glow: 'faint', cue: 'none', bob: true, flourish: false },
    thinking: { marquee: 'lit', glow: 'faint', cue: 'dots', bob: false, flourish: false },
    waiting: { marquee: 'flash', glow: 'strong', cue: 'ask', bob: false, flourish: false },
    limit: { marquee: 'orange', glow: 'strong', cue: 'ask', bob: false, flourish: false },
    error: { marquee: 'flash-red', glow: 'small', cue: 'bang', bob: false, flourish: false },
    done: { marquee: 'green', glow: 'faint', cue: 'tick', bob: false, flourish: true },
    idle: { marquee: 'dim', glow: 'very-faint', cue: 'none', bob: false, flourish: false }, /* awake and standing: z z is for asleep only, who sits (owner, 2026-11-03) */
    asleep: { marquee: 'off', glow: 'none', cue: 'zz', bob: false, flourish: false },
  };
  const r = t[state] ?? t.idle;
  if (!still) return r;
  return { ...r, bob: false, flourish: false, marquee: r.marquee === 'flash' ? 'alert' : r.marquee === 'flash-red' ? 'alert-red' : r.marquee };
}

/** FR-259: what someone at a cabinet shows, per state. `face-*` are front frames, an optional group: each falls back to its view-a pose, so any full set works. Asleep: the seated frame. */
export const AISLE_POSE: Record<RealState, string> = { working: 'type', thinking: 'book', error: 'knock', waiting: 'face-knock', limit: 'face-knock', done: 'face-coffee', idle: 'face-book', asleep: 'sit' }; /* asleep sits on a stool, whole, beside the cabinet (owner, 2026-11-03); its marquee is off and it shows z z */
/* a frame a set has not: the next to try (any full set works, FR-259). The crews' standing poses are book, coffee, knock, letter, runA, runB: a player who types shows the book, and who is done the coffee */
const AISLE_FALLBACK: Record<string, string[]> = { 'face-knock': ['knock'], 'face-coffee': ['counter', 'coffee'], 'face-book': ['book'], sit: ['face-book', 'book'], type: ['book'] };
const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
/** spec 097 FR-335 (T247): grid px per picture px for a person. A pixel-art set is drawn 1:1 (the arcade's own grid); any other set is scaled so its standing figure is as tall
 *  as the arcade's people (AISLE_PERSON.h), and every size is whole grid px, so the art still sits on the grid (FR-255). */
/** the widest a place beside a cabinet may be, in grid px: a picture wider than this would reach the next cabinet or screen (owner, 2026-11-03: no person is cut) */
export const AISLE_PW_MAX = 48;
/** the widest picture, in the set's own pixels, that a person can show at a cabinet (every state's frame and its fallbacks); the seat frame ('rest') is not one */
const usedWidth = (meta: RealMeta): number => {
  let w = 0;
  for (const st of Object.values(meta.stand || {})) for (const pose of Object.values(AISLE_POSE)) for (const p of [pose, ...(AISLE_FALLBACK[pose] || [])]) if (own(st.poses, p)) { w = Math.max(w, st.poses[p][0]); break; }
  return w;
};
const aisleK = (meta: RealMeta, st: { figH: number }): number => {
  if (meta.pixelPeople !== false || !(st.figH > 0)) return 1;
  const w = usedWidth(meta); /* as tall as the arcade's people, but never wider than the place beside a cabinet (a wide figure such as Prehistoric bigbeard's knock is 284 px for 355 tall) */
  return Math.min(AISLE_PERSON.h / st.figH, w > 0 ? AISLE_PW_MAX / w : Infinity);
};
const gridPx = (v: number, k: number): number => k === 1 ? v : Math.max(1, Math.round(v * k));
/** the frame a person shows at a cabinet and its size in grid pixels, or null when the set has neither (then the initials, FR-065) */
function aislePose(meta: RealMeta, pid: string, state: RealState): { pose: string; w: number; h: number } | null {
  const pose = AISLE_POSE[state];
  if (pose === 'rest') { const m = own(meta.seat, pid) ? meta.seat[pid] : null; return m ? { pose, w: m.w, h: m.h } : null; }
  const st = own(meta.stand, pid) ? meta.stand[pid] : null;
  if (!st) return null;
  const k = aisleK(meta, st);
  for (const p of [pose, ...(AISLE_FALLBACK[pose] || [])]) if (p && own(st.poses, p)) return { pose: p, w: gridPx(st.poses[p][0], k), h: gridPx(st.poses[p][1], k) };
  return null;
}

/** an empty place's note stands where the person would, beside the glass and never over its text: `x` is the note's centre */
function aisleNote(gl: Rect, face: 'left' | 'right', g: number): { x: number; y: number; s: number } {
  const s = g <= 3 ? 66 : 22 * g; /* 66 px up to g = 3 (relayed review: outsized tickets); above, it grows with the art (relayed, 2026-11-03) */
  return { x: face === 'right' ? gl.x + gl.w + s / 2 + 3 * g : gl.x - s / 2 - 3 * g, y: gl.y + 6 * g, s }; /* 3 grid px: its tilt stays off the text */
}

/** Spec 097 FR-248 (owner 2026-11-06, issue #1220): a lounge seat in the arcade, in grid px at scale `gl`: the person's stool frame, the world's console desk with a small
 *  CRT on it (glass AISLE_LCRT, a 3 px frame) and the plate under them. AISLE_LSEAT is the seat's width: the widest stool frame of a set is 36 (34 today), the console 40, gaps */
export const AISLE_LCRT = { gw: 24, gh: 16, frame: 3 } as const, AISLE_LSEAT = 36 + 2 + 40 + 4, AISLE_LG = 2;
function aisleSeat(meta: RealMeta, a: RealAgent, sx: number, plateY: number, gl: number): DeskBox {
  const fr = a.person != null ? aislePose(meta, String(a.person), 'asleep') : null; /* the stool frame ('sit'), the pose an asleep player had at a cabinet */
  const desk = meta.desk || [40, 22], tw = desk[0] * gl, th = desk[1] * gl;
  const pw = fr ? fr.w * gl : 34 * gl, ph = fr ? fr.h * gl : 60 * gl, px = sx + 2 * gl, py = plateY - ph;
  const table = { x: px + 36 * gl + 2 * gl, y: plateY - th, w: tw, h: th };
  const cw = (AISLE_LCRT.gw + 2 * AISLE_LCRT.frame) * gl, ch = (AISLE_LCRT.gh + 2 * AISLE_LCRT.frame) * gl;
  const screen = { x: table.x + Math.round((tw - cw) / 2 / gl) * gl, y: table.y - ch + gl, w: cw, h: ch };
  const faceS = FACE_GRID * gl, face = { x: px + Math.floor((pw - faceS) / 2), y: py + gl, w: faceS, h: faceS };
  return {
    id: a.id, state: a.state as RealState, lounge: true, narrow: false, slot: { x: sx, y: py, w: AISLE_LSEAT * gl, h: ph + AISLE_PLATE_H }, desk: { ...table, full: th }, table,
    plate: { x: sx + gl, y: plateY, w: AISLE_LSEAT * gl - 2 * gl, h: AISLE_PLATE_H }, screen, glass: { x: screen.x + AISLE_LCRT.frame * gl, y: screen.y + AISLE_LCRT.frame * gl, w: AISLE_LCRT.gw * gl, h: AISLE_LCRT.gh * gl },
    person: fr ? { x: px + Math.floor((36 * gl - pw) / 2 / gl) * gl, y: py, w: pw, h: ph, file: `${a.person}-${fr.pose}.webp`, fileB: null, pose: fr.pose, pid: String(a.person), vis: face } : null,
    face, away: null, lamp: { x: sx, y: py, w: AISLE_LSEAT * gl, h: ph + AISLE_PLATE_H }, bubble: null, bang: null, dots: null, call: { x: sx + AISLE_LSEAT * gl - 16, y: plateY + 4 },
  };
}

/** spec 102 delta 2026-11-14 (round 2 of the review of #1741): where the "Resting" tag and its rule go: the first run of free cells (`runs`: row top, left and right edge) where they are clear of every floor mark (`marks`: floor tags and rules) and of the folder signs
 *  (`signRects`: no sign is ever cut for the tag); after a floor mark or a sign in the way (6 px clear) or in the next run; null when no run has room (the caller then draws no storeys). Pure, exported for its test. */
export function placeResting(runs: ReadonlyArray<{ top: number; x0: number; x1: number }>, marks: ReadonlyArray<Rect>, signRects: ReadonlyArray<Rect>, tw0: number): { r: { top: number; x0: number; x1: number }; tx: number; tw: number } | null {
  const hit = (a: Rect, c: Rect): boolean => a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h;
  for (const r of [...runs].sort((p1, p2) => p1.top - p2.top || p1.x0 - p2.x0)) {
    let tx = Math.round(r.x0 + 3);
    for (let n = 0; n < 8; n++) {
      const tw = Math.min(tw0, r.x1 - tx - 2), box = { x: tx - 4, y: r.top, w: tw + 5, h: AISLE_SIGN_H }, hits = [...marks.filter((c) => hit(box, c)), ...signRects.filter((z) => hit(box, z) && Math.abs(z.y - r.top) < 1)];
      if (!hits.length && tw >= STOREY_TAG_MIN * 0.6) return { r, tx, tw };
      if (hits.length) tx = Math.round(Math.max(...hits.map((c) => c.x + c.w)) + 6); else break;
    }
  }
  return null;
}

/** a test hook: the deepest chain of internal re-layouts seen (the grow of the lounge's cells, the hall without floors, the forced-break retry); `aislesLayout` ends: see the depth cap at the grow */
export const AISLES_DEPTH = { max: 0 };

/** `minCells` (internal, spec 097 delta 2026-11-14, issue #1760): the lounge's cell count when the first count's runs could not seat every resting agent; `minPer` (internal, the same in
 *  the building view): each storey's cell count when its seats beside its floor did not all fit */
export function aislesLayout(model: RealModel, view: { w: number; h: number }, meta: RealMeta, signs?: Record<string, { name: string; path: string; counts: number }>, place: typeof placeResting = placeResting, minCells = 0, minPer: ReadonlyArray<number> = [], noForce = false, depth = 0): Layout {
  AISLES_DEPTH.max = Math.max(AISLES_DEPTH.max, depth);
  const again = (m: RealMeta, mc: number, mp: ReadonlyArray<number>, nf: boolean): Layout => aislesLayout(model, view, m, signs, place, mc, mp, nf, depth + 1), flatAgain = (mc: number): Layout => again({ ...meta, storeys: false }, mc, [], false);
  const W = Math.max(200, view.w), Ho = Math.max(200, view.h);
  /* FR-248: the lounge's agents leave their cabinets; their seats take cells after the cabinets (below) */
  const sp = splitLounge(model); let lounge = sp.lounge;
  const floorOf = new Map(model.folders.map((f) => [f.id, f.floor] as const));
  const folders = sp.desks.filter((f) => f.agents.length).map((f) => ({ id: f.id, agents: shownDesks(f), floor: floorOf.get(f.id) })); /* FR-345: a saved desk order is kept in the cabinet rows too */
  /* spec 102 delta 2026-11-14 (spec 097 FR-104): a world that draws storeys (`meta.storeys`) puts each floor on rows of its own; `starts` are the folders that begin a storey after the first */
  let runs = meta.storeys ? storeyRuns(folders) : null, starts: ReadonlySet<number> | undefined = runs && !noForce ? new Set(runs.slice(1).map((r) => r.from)) : undefined; /* noForce: the hall again without the forced row break (round 5 of #1741: the break narrowed a sign) */
  /* review of #1741: a resting agent's seat stands at the end of its own floor's folders when that costs the hall nothing (the lounge is put in the building's order, stable: the status order within a floor).
     Otherwise (or when an agent's floor has no folder here) the seats stay in the free cells at the rows' ends, as FR-248 has them, under their own tag "Resting" and a rule: no floor's band holds them */
  const floorOfAgent = new Map(model.folders.flatMap((f) => f.agents.map((a) => [a.id, f.floor] as const)));
  const loungeSt = (a: RealAgent): number => (runs ? runs.findIndex((r) => r.floor.id === (floorOfAgent.get(a.id) || { id: '' }).id) : -1);
  const seats = folders.flatMap((f) => f.agents.map((a) => ({ a, f: f.id })));
  const k = seats.length;
  const [lobbyMin0, lobbyMax] = lobbyRange(Ho), lobbyMin = lobbyMin0 - AISLE_LANE;
  /* the place beside a cabinet is as wide as the widest standing picture of the set, so a picture centred in it never reaches a cabinet */
  const PW = Math.min(AISLE_PW_MAX, Math.max(AISLE_PERSON.w, ...Object.values(meta.stand || {}).flatMap((s) => Object.values(s.poses || {}).map((p) => gridPx(p[0], aisleK(meta, s)))))); /* grid px; a set not drawn at the arcade's scale is scaled to it (aisleK) */
  /* the lobby first: the rows bend only with what is left once it has its height */
  /* FR-248: the lounge's seats take cells after the cabinets, in the hall's own grid (so the plan is never worse than with those agents at cabinets): as many
     cells as the seats need at the narrowest cell a plan can have (a seat is narrower than a cabinet with its player, so 5 seats take 4 cells) */
  const minCell = cabGrid(CABINETS.narrow.gw, CABINETS.narrow.gh).w + PW + AISLE_GAP, nCells0 = lounge.length ? Math.max(minCells, Math.ceil((lounge.length * AISLE_LSEAT) / minCell - 1e-9)) : 0;
  /* the cells a storey's resting seats need, after that storey's last folder; their sum is the lounge's cells in the building view */
  const aOk = !!runs && lounge.length > 0 && lounge.every((a) => loungeSt(a) >= 0), loungeS = aOk ? [...lounge].sort((a, b) => loungeSt(a) - loungeSt(b)) : lounge, cellsPer = aOk ? runs!.map((_, si) => { const n = loungeS.filter((a) => loungeSt(a) === si).length; return n ? Math.max(minPer[si] || 0, Math.ceil((n * AISLE_LSEAT) / minCell - 1e-9)) : 0; }) : [];
  const ends: ReadonlyMap<number, number> | undefined = aOk ? new Map(runs!.map((r, si) => [r.to - 1, cellsPer[si]] as const).filter(([, n]) => n > 0)) : undefined, nCellsS = cellsPer.reduce((a, b) => a + b, 0);
  const sizes = folders.map((f) => f.agents.length), kc = k + nCells0, lobbyT = Math.min(kc <= 4 ? AISLE_LOBBY_FEW : AISLE_LOBBY, lobbyMax);
  /* owner, 2026-11-03 06:59 UTC (option A): with 4 or fewer the lobby may be lower, down to its minimum, when that lets the cabinets grow; the
     lobby height and the plan are chosen together, by the floor the cabinets and people cover (the same height on a tie keeps the higher lobby);
     what the larger plan leaves goes back to the lobby */
  const covered = (p: Plan): number => p.fits ? p.g * p.g * (cabGrid(p.gw, p.gh).w * cabGrid(p.gw, p.gh).h + PW * AISLE_PERSON.h) : -1;
  /* spec 097 FR-306, FR-308 (issue #1139): with helpers, one row of head figures under every plate (a fixed height in every row); if the hall then no longer fits, no strip: the plate keeps +N and dots */
  const hasHelpers = folders.some((f) => f.agents.some((a) => (a.helpers || 0) > 0));
  const planAt = (sh: number, st?: ReadonlySet<number>, en?: ReadonlyMap<number, number>): Plan => {
    const nCells = en ? nCellsS : nCells0;
    let first = planFor(sizes, W, Ho - lobbyT - AISLE_LANE - AISLE_PAD, PW, nCells, sh, st, en);
    if (kc <= 4 && AISLE_LOW_LOBBY) for (let L = lobbyT - 4; L >= Math.min(lobbyMin + AISLE_LANE, AISLE_LOBBY_LOW); L -= 2) { const p = planFor(sizes, W, Ho - L - AISLE_LANE - AISLE_PAD, PW, nCells, sh, st, en); if (covered(p) > covered(first)) first = p; }
    /* spec 102 delta 2026-11-12 (issue 1590): the lowest lobby is also tried when the plan at the set lobby fits only by cutting a folder of 4 or fewer across rows (keep: false) and the lowest lobby keeps them whole */
    const low = planFor(sizes, W, Ho - lobbyMin - AISLE_LANE - AISLE_PAD, PW, nCells, sh, st, en);
    return first.fits && (first.keep || !low.keep) ? first : low;
  };
  const solve = (st?: ReadonlySet<number>, en?: ReadonlyMap<number, number>): { sh: number; plan: Plan } => {
    let sh = hasHelpers ? helpH(1) : 0, plan = planAt(sh, st, en);
    if (sh && (!plan.fits || !plan.keep)) { const p0 = planAt(0, st, en); if (!plan.fits || p0.keep) { sh = 0; plan = p0; } } /* spec 102 delta 2026-11-12 (issue 1590): also no strip when it is what splits a folder of 4 or fewer that the hall keeps whole without it */
    return { sh, plan };
  };
  /* spec 102 delta 2026-11-14 (spec 097 FR-104, owner decision: the 15-agent rule wins): a floor starts on a new row only when that costs nothing: the same scale, the same cabinet, no scroll, a folder kept whole as before.
     Otherwise the floors share rows and the storeys are marked by their tags and rules where each starts */
  const size = (p: Plan): number => p.gw * p.gh;
  /* a forced break is taken only when it is free: it fits, the same scale and cabinet, a folder of 4 or fewer kept whole, and the helper strip kept (review of #1741: `sh` was not compared) */
  const pick = (e?: ReadonlyMap<number, number>): { sol: { sh: number; plan: Plan }; forced?: ReadonlySet<number> } => {
    const s0 = solve(undefined, e);
    if (!starts) return { sol: s0 };
    const F = solve(starts, e);
    return F.plan.fits ? (!s0.plan.fits || (F.plan.g === s0.plan.g && size(F.plan) >= size(s0.plan) && (F.plan.keep || !s0.plan.keep) && F.sh >= s0.sh) ? { sol: F, forced: starts } : { sol: s0 }) : { sol: s0 };
  };
  let en = ends, nCells = nCells0, restBand = !!runs && lounge.length > 0 && !ends, ch = pick(en);
  if (ends) {
    /* the seats beside their floors cost nothing the hall without storeys did not have (scale, cabinet, no scroll, a folder of 4 or fewer kept, the helper strip); if they do, they stay in the free cells under "Resting" */
    const base = solve();
    if (ch.sol.plan.fits ? !base.plan.fits || (ch.sol.plan.g === base.plan.g && size(ch.sol.plan) >= size(base.plan) && (ch.sol.plan.keep || !base.plan.keep) && ch.sol.sh >= base.sh) : !base.plan.fits) nCells = nCellsS;
    else { en = undefined; restBand = true; ch = pick(undefined); }
  }
  lounge = en ? loungeS : sp.lounge;
  const sol = ch.sol, forced = ch.forced;
  const { sh, plan } = sol;
  const { g, cols, rows, sl } = plan, pk = packSeats(sizes, cols, plan.keep, nCells, forced, en), cab = cabGrid(plan.gw, plan.gh), cabW = cab.w * g, cabH = cab.h * g, pw = PW * g, ph = AISLE_PERSON.h * g;
  const bend = 2 * sl, nGap = forced && runs ? runs.length - 1 : 0, used = rows * (plan.rowH + bend) + nGap * STOREY_GAP;
  /* the storey of each row (lounge-only rows below the last folder take the last one): the rule between storeys is added above its first row */
  const stOfFolder = folders.map((_, fi) => (forced && runs ? Math.max(0, runs.findIndex((r) => fi >= r.from && fi < r.to)) : 0)), rowSt: number[] = Array.from({ length: rows }, () => -1);
  { let i0 = 0; folders.forEach((f, fi) => { f.agents.forEach((_, j) => { rowSt[pk.at[i0 + j][0]] = stOfFolder[fi]; }); i0 += f.agents.length; }); for (let r = 0; r < rows; r++) if (rowSt[r] < 0) rowSt[r] = r ? rowSt[r - 1] : 0; }
  const Lb0 = Math.round(plan.fits ? Math.max(lobbyMin, Math.min(Ho - used - AISLE_PAD - AISLE_LANE, lobbyT)) : lobbyMin);
  const Lb = Math.ceil(Lb0 / g) * g;
  const spare = plan.fits ? Math.max(0, Ho - Lb - AISLE_LANE - used - AISLE_PAD) : 0, extra = spare / (rows + 1);
  /* rows stagger by 8 % of a column, less where the floor is narrow */
  /* columns no wider than 1.1 slots, the grid in the middle: a small group stands close together */
  const cw = Math.min((W - 2 * AISLE_PAD) / cols, plan.slotW * AISLE_CLOSE), x0g = (W - cols * cw) / 2, snap = (v: number): number => Math.round(v / g) * g;
  const shift = rows < 2 ? 0 : Math.max(0, /* one row has nothing to stagger against: it stands in the middle */ Math.min(cw * AISLE_STAGGER, (cw - plan.slotW - g) / 2));
  const inRow = pk.inRow;
  const cxOf = (i: number): number => {
    const [r, c] = pk.at[i], n = inRow[r]; /* a short row stands in the middle, so 3 is a triangle, not an L */
    return n < cols ? x0g + (c + 0.5 + (cols - n) / 2) * cw : x0g + (c + 0.5) * cw + (r % 2 ? 1 : -1) * shift;
  };
  /* the whole group in the middle of the floor: a staggered full row over a centred short one leans otherwise (review of #1079) */
  const cxs = pk.at.map((_, i) => cxOf(i)), lean = cxs.length ? W / 2 - (Math.min(...cxs) + Math.max(...cxs)) / 2 : 0;
  const slotBox = (i: number): { slot: Rect; cab: Rect; top: number; face: 'left' | 'right' } => {
    const [r, c] = pk.at[i], f0 = aisleFace(c, cols, r), face = k <= 4 ? (f0 === 'right' ? 'left' : 'right') : f0; /* a small room: the cabinets together in the middle, the people outside */
    const cx = cxs[i] + lean;
    const top = Lb + AISLE_LANE + extra * (r + 1) + r * (plan.rowH + bend) + rowSt[r] * STOREY_GAP;                      /* the row's top: its sign strip */
    const cabY = top + AISLE_SIGN_H + (Math.floor(cols / 2) - Math.abs(c - (cols - 1) / 2) > 0 ? Math.round((Math.floor(cols / 2) - Math.abs(c - (cols - 1) / 2)) * sl) : 0);
    /* the art sits on the grid: the cabinet's corner is a multiple of g (FR-255) and the slot follows it */
    const gp = AISLE_GAP * g, s0 = cx - plan.slotW / 2, cx0 = snap(face === 'right' ? s0 : s0 + pw + gp), sx = face === 'right' ? cx0 : cx0 - pw - gp; /* the person beside the cabinet, never over it */
    return { slot: { x: sx, y: top, w: plan.slotW, h: plan.rowH + bend }, cab: { x: cx0, y: Math.ceil(cabY / g) * g, w: cabW, h: cabH }, top, face };
  };
  const zones: ZoneBox[] = [];
  let i = 0;
  for (const f of folders) {
    const parts = new Map<number, number[]>();
    f.agents.forEach((_, j) => { const r = plan.keep && f.agents.length <= 4 ? -1 : pk.at[i + j][0]; (parts.get(r) || parts.set(r, []).get(r)!).push(i + j); }); /* 4 or fewer: one part */
    let part = 0;
    for (const idx of parts.values()) {
      const desks: DeskBox[] = idx.map((n) => {
        const a = seats[n].a, b = slotBox(n), plateY = b.cab.y + cabH;
        const px = b.face === 'right' ? b.cab.x + cabW + AISLE_GAP * g : b.cab.x - pw - AISLE_GAP * g, py = plateY - ph;
        const mirrored = b.face === 'right'; /* the art's side panel is on its right, so it faces left; the other way is the picture mirrored, and its glass and marquee with it */
        const faceS = FACE_GRID * g, gl = { x: b.cab.x + (mirrored ? cab.w - 5 - plan.gw : 5) * g, y: b.cab.y + 18 * g, w: plan.gw * g, h: plan.gh * g };
        const fr = a.person != null && !a.away ? aislePose(meta, String(a.person), a.state as RealState) : null;
        const d: DeskBox = {
          id: a.id, state: a.state as RealState, narrow: false, slot: b.slot, desk: { ...b.cab, full: cabH },
          plate: { x: b.cab.x, y: plateY, w: cabW, h: AISLE_PLATE_H }, screen: { x: gl.x - 4 * g, y: gl.y - 4 * g, w: gl.w + 8 * g, h: gl.h + 8 * g }, glass: gl,
          person: fr ? { x: px + Math.floor((pw - fr.w * g) / 2), y: plateY - fr.h * g, w: fr.w * g, h: fr.h * g, file: `${a.person}-${fr.pose}.webp`, fileB: null, pose: fr.pose, pid: String(a.person), vis: { x: px + Math.floor((pw - faceS) / 2), y: py, w: faceS, h: faceS } } : null,
          face: { x: px + Math.floor((pw - faceS) / 2), y: py + 4 * g, w: faceS, h: faceS },
          away: a.away ? aisleNote(gl, b.face, g) : null,
          lamp: { x: b.cab.x - 4 * g, y: b.cab.y - 4 * g, w: cabW + 8 * g, h: cabH + 8 * g },
          cue: a.away || a.state === 'error' ? { x: gl.x + gl.w - 4 * g, y: gl.y - 4 * g } : { x: px + pw / 2, y: Math.max(py + 2 * g, b.cab.y + 12 * g) }, bubble: null, bang: null, /* inside the cabinet's height: a sign may lie above it */
          dots: null, call: { x: b.cab.x + cabW - 16, y: plateY + 4 },
          ...(sh && (a.helpers || 0) > 0 ? { strip: { x: b.cab.x, y: plateY + AISLE_PLATE_H + 2, w: cabW, h: sh - 2, rows: 1, cols: helpCols(cabW), shown: helpShown(cabW, 1, a.helpers as number) } } : {}),
          marquee: { x: b.cab.x + (mirrored ? cab.w - 3 - (cab.w - 17 + 10 - 6) : 3) * g, y: b.cab.y + 2 * g, w: (cab.w - 17 + 10 - 6) * g, h: 9 * g }, stand: { x: px, y: py, w: pw, h: ph }, facing: b.face, body: k <= 4 ? n : (pk.at[n][1] + 2 * pk.at[n][0]) % 4, /* 4 or fewer: all different; more: column + 2 x row, so a seat differs from the ones beside, above, below and diagonal in the staggered rows (the zigzag was tried and removed, spec 102) */
        };
        return d;
      });
      const bs = idx.map(slotBox), first = bs[0], bottom = Math.max(...bs.map((b) => b.slot.y + b.slot.h));
      const x0 = Math.min(...bs.map((b) => b.slot.x)), x1 = Math.max(...bs.map((b) => b.slot.x + b.slot.w));
      const s0 = f.id, s = signs && Object.prototype.hasOwnProperty.call(signs, s0) ? signs[s0] : { name: s0, path: '', counts: 1 };
      const room = x1 - x0, need = signWidth(s.name, s.path, s.counts, 4000), sw = Math.min(room, Math.max(AISLE_SIGN_MIN_W, need));
      zones.push({ id: f.id, part: ++part, box: { x: x0, y: first.top, w: x1 - x0, h: bottom - first.top }, sign: { x: x0, y: first.top, w: sw, h: AISLE_SIGN_H }, desks, signShort: need > room } as ZoneBox);
    }
    i += f.agents.length;
  }
  /* review of the arcade, 2026-11-03: a sign may run on over the free floor after its zone, up to the next zone on its row or the floor's
     edge, so the last folder on a row is not cut to one letter; it never covers another zone */
  for (const z of zones) {
    const next = zones.filter((o) => o !== z && o.sign.y === z.sign.y && o.box.x >= z.box.x + z.box.w - 1).reduce((m, o) => Math.min(m, o.box.x), W - AISLE_PAD);
    const s0 = signs && Object.prototype.hasOwnProperty.call(signs, z.id) ? signs[z.id] : { name: z.id, path: '', counts: 1 };
    const need = signWidth(s0.name, s0.path, s0.counts, 4000), room = Math.max(z.box.w, next - 4 - z.sign.x);
    z.sign.w = Math.min(room, Math.max(AISLE_SIGN_MIN_W, need)); z.signShort = need > room;
  }
  /* spec 102 delta 2026-11-14 (spec 097 FR-104): each storey has its band (the box of its zones), its tag and its rule. The tag stands in the sign strip of the storey's first zone, just after that
     zone's sign (which gives up the width, to no less than its shortest form), so a tag never covers a sign, a cabinet or another tag; a name too long for the room is cut (its title has all of it).
     A rule between two storeys that start on rows of their own is horizontal (in the gap `forced` made); a storey that starts in the middle of a row has an upright rule in the strip before its first zone. */
  const bands: StoreyBand[] = [];
  /* round 4 of the review of #1741, owner decision 2026-11-14 (the strict rule): a folder sign is exactly as wide as in the hall without floors, never narrower. The tag goes to the first zone of its storey, in reading order, that keeps its sign so and takes
     the whole tag; if no zone of a storey can, the hall is drawn without floors */
  /* the strict rule (owner 2026-11-14, round 5 of #1741): every sign is exactly its width in the hall without floors (this layout's own, drawn again without storeys), never narrower and never wider than its room. A forced row break that moved a sign
     to a narrower place is given up (the floors share rows); if the sign is still narrower, the hall is drawn without floors */
  const flatL = runs ? flatAgain(minCells) : null, zkey = (zs: ZoneBox[], i: number): string => zs[i].id + '#' + zs.slice(0, i).filter((o) => o.id === zs[i].id).length;
  const flatByKey = new Map(flatL ? flatL.zones.map((z, i) => [zkey(flatL.zones, i), z.sign.w] as const) : []), flatSign = new Map(zones.map((z, i) => [z, flatByKey.get(zkey(zones, i)) ?? z.sign.w] as const));
  if (runs && zones.some((z) => z.sign.w < flatSign.get(z)! - 0.01)) return forced ? again(meta, minCells, minPer, true) : flatAgain(minCells);
  if (runs) for (const z of zones) z.sign.w = flatSign.get(z)!;
  let noRoom = false;
  if (runs) runs.forEach((run, si) => {
    const ids = new Set(folders.slice(run.from, run.to).map((f) => f.id)), zs = zones.filter((z) => ids.has(z.id)).sort((p1, p2) => p1.sign.y - p2.sign.y || p1.box.x - p2.box.x), z0 = zs[0];
    const room = (z: ZoneBox): { avail: number; smn: number } => {
      const next = zones.filter((o) => o !== z && o.sign.y === z.sign.y && o.sign.x > z.sign.x).reduce((m, o) => Math.min(m, Math.min(o.box.x, o.sign.x)), W - AISLE_PAD), avail = next - 4 - z.sign.x; /* the tag ends before the next zone starts (its upright rule stands there) */
      return { avail, smn: flatSign.get(z)! };
    };
    const left = (z: ZoneBox): number => { const r = room(z); return r.avail - r.smn - 4; }, want = Math.max(STOREY_TAG_MIN, storeyTagW(run.floor));
    const zt = zs.find((z) => left(z) >= want); /* the first zone, in reading order, that keeps its sign exactly as wide as without floors and takes the whole tag */
    if (!zt) { noRoom = true; return; }
    const tw = want; /* the sign is not touched */
    const bx0 = Math.min(...zs.map((z) => z.box.x)), bx1 = Math.max(...zs.map((z) => z.box.x + z.box.w)), by0 = z0.sign.y, by1 = Math.max(...zs.map((z) => z.box.y + z.box.h));
    const slab: Rect | null = !si ? null : forced ? { x: AISLE_PAD, y: by0 - STOREY_GAP + 1, w: W - 2 * AISLE_PAD, h: 2 } : { x: Math.max(0, z0.sign.x - 3), y: by0, w: 2, h: AISLE_SIGN_H };
    bands.push({ id: run.floor.id, name: run.floor.name, n: run.floor.n, box: { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 }, tag: { x: Math.round(zt.sign.x + zt.sign.w + 4), y: zt.sign.y, w: tw, h: AISLE_SIGN_H }, slab });
  });
  if (noRoom) return flatAgain(minCells);
  const lb = lobbyBand(meta, model.places, W, Lb);
  const height = plan.fits ? Ho : Math.ceil(Lb + AISLE_LANE + used + AISLE_PAD);
  const lay: Layout = { lane: { x: AISLE_PAD, y: Lb, w: W - 2 * AISLE_PAD, h: AISLE_LANE }, u: AISLE_PERSON.h * g, g, big: k + nCells <= BIG_MAX, lobbyH: Lb, floorH: height - Lb, width: W, height, scroll: !plan.fits, faceH: FACE_GRID * g, zones, fixtures: lb.fixtures, floorStrip: lb.floorStrip, cabinet: { w: cabW, h: cabH, gw: plan.gw, gh: plan.gh, cols, rows }, helpRows: sh ? 1 : 0, ...(bands.length ? { storeys: bands } : {}) };
  if (nCells) {
    /* the lounge cells in runs per row (in the building view: per row and floor, so a run holds one floor's seats); each run seats as many as its width holds, left to right, on one line: the lowest plate line of its cells (the row's bend), still inside the row */
    const gl = Math.min(g, AISLE_LG), sw = AISLE_LSEAT * gl, desks: DeskBox[] = [], snapL = (v: number): number => Math.round(v / gl) * gl;
    const cellSt = (i: number): number => { let a = i - k; for (let si = 0; si < cellsPer.length; si++) { if (a < cellsPer[si]) return si; a -= cellsPer[si]; } return -1; };
    const cr = new Map<string, number[]>(), left = new Map<number, number>();
    for (let i = k; i < k + nCells; i++) { const st = en ? cellSt(i) : 0, key = pk.at[i][0] + ':' + st; (cr.get(key) || cr.set(key, []).get(key)!).push(i); }
    if (en) lounge.forEach((a) => left.set(loungeSt(a), (left.get(loungeSt(a)) || 0) + 1));
    const runInfo: Array<{ top: number; x0: number; x1: number }> = [], stOf = (key: string): number => Number(key.split(':')[1]);
    let next = 0; const lastRun = new Map<number, string>(), runsOf = new Map<number, number>(); for (const key of cr.keys()) { lastRun.set(stOf(key), key); runsOf.set(stOf(key), (runsOf.get(stOf(key)) || 0) + 1); }
    /* spec 097 delta 2026-11-14 (issue #1760): a run keeps g clear at each end; when the runs then hold fewer seats than rest (two runs of two cells at 1248 px:
       492.8 px, three seats 496 with the ends), the seats may reach the run's ends (its cells' edges, still clear of the next cabinet's slot) before a cell is added.
       In the building view with seats beside their floors this is decided per floor, over that floor's runs and its resting agents */
    const span = (cells: number[]): number => cw + Math.max(...cells.map((i) => cxs[i])) - Math.min(...cells.map((i) => cxs[i]));
    const endOf = new Map<number, number>();
    for (const [st, nr] of runsOf) { const need = en ? left.get(st)! : lounge.length, holds = [...cr.entries()].filter(([key]) => stOf(key) === st).reduce((s, [, c]) => s + Math.max(1, Math.floor((span(c) - 2 * g) / sw)), 0); endOf.set(st, nr > 1 && holds < need ? 0 : g); }
    for (const [key, cells] of cr.entries()) {
      const bs = cells.map((i) => ({ x: cxs[i] + lean - cw / 2, b: slotBox(i) })), x0 = Math.min(...bs.map((c) => c.x)), x1 = Math.max(...bs.map((c) => c.x + cw)), st = stOf(key), end = endOf.get(st)!;
      const fit = Math.max(1, Math.floor((x1 - x0 - 2 * end) / sw)), rem = en ? left.get(st)! : lounge.length - next, take = fit >= rem || runsOf.get(st) === 1 ? rem : fit, start = x0 + Math.max(end, (x1 - x0 - take * sw) / 2);
      const plateY = Math.max(...bs.map((c) => c.b.cab.y)) + cabH;
      runInfo.push({ top: Math.min(...bs.map((c) => c.b.top)), x0, x1 });
      for (let j = 0; j < take && next < lounge.length; j++, next++) desks.push(aisleSeat(meta, lounge[next], snapL(start + j * sw), plateY, gl));
      if (en) { left.set(st, left.get(st)! - take); if (lastRun.get(st) === key) next += left.get(st)!; } /* a floor's seats that did not fit: the next floor's seats still start at its own agents (the hall is laid out again below) */
    }
    /* spec 097 delta 2026-11-14 (issue #1760): a seat never spans two runs, so runs of the counted cells can hold fewer seats than rest (5 resting in two runs of
       two cells at 1248 px seat 2 + 2): lay the hall out again with one cell more. At most one cell per resting agent, and each cell holds a seat, so it ends.
       In the building view with seats beside their floors (spec 102 delta 2026-11-14), the floor whose seats did not fit gets the cell (`minPer`, at most one per its resting agent); a floor that is short always has a cell to gain, so there is no other way out */
    if (desks.length < lounge.length && depth <= 4 * lounge.length + 8) {
      if (en) {
        const grow = cellsPer.map((c, si) => ((left.get(si) || 0) > 0 && c < lounge.filter((a) => loungeSt(a) === si).length ? c + 1 : c));
        /* a cell can be narrower than a seat in a small window, so a floor's cells may not seat its agents and cannot always grow: when no floor can, the hall without floors (round 6 of #1741). Ends: each grow adds a cell to a floor that has fewer than its agents (the sum is bounded by the resting agents), the hall without floors ends through the cap below,
           and the depth cap (4 per resting agent + 8) stops any chain that does not */
        return grow.some((c, si) => c !== cellsPer[si]) ? again(meta, minCells, grow, noForce) : flatAgain(minCells);
      }
      if (nCells < lounge.length) return again(meta, nCells + 1, minPer, noForce);
    }
    if (desks.length < lounge.length && runs) return flatAgain(minCells); /* floors are drawn only when every resting agent is seated; the hall without floors seats what it can */
    const x0 = Math.min(...desks.map((d) => d.slot.x)), x1 = Math.max(...desks.map((d) => d.slot.x + d.slot.w)), y0 = Math.min(...desks.map((d) => d.slot.y)), y1 = Math.max(...desks.map((d) => d.slot.y + d.slot.h));
    lay.lounge = { box: { x: x0 - 4, y: y0, w: x1 - x0 + 8, h: y1 - y0 }, desks };
    if (restBand && runInfo.length) { /* the seats in the free cells are no floor's: they stand under their own tag "Resting", with an upright rule before it, in the first run of free cells where it is clear of every floor's tag and rule (a floor's tag may stand past its zone, over free cells: the Resting tag then starts after it, or takes the next run); a sign that reached over that place gives up the width.
      Where no run has room, no storeys are drawn at all (the hall without floors, FR-248's lounge): the same fallback as above (review of #1741, round 2) */
      const floorMarks = bands.flatMap((b) => [b.tag, ...(b.slab ? [b.slab] : [])]), tw0 = Math.max(STOREY_TAG_MIN * 0.6, storeyTagW({ id: '*rest', name: 'Resting', n: 0, w: model.restW }));
      const at = place(runInfo, floorMarks, zones.map((z) => z.sign), tw0);
      if (!at) return flatAgain(minCells);
      const { r: r0, tx, tw } = at;
      const bx0 = Math.min(...desks.map((d) => d.slot.x), tx), by0 = r0.top, bx1 = Math.max(...desks.map((d) => d.slot.x + d.slot.w), tx + tw), by1 = Math.max(...desks.map((d) => d.slot.y + d.slot.h));
      bands.push({ id: '*rest', name: 'Resting', n: 0, box: { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 }, tag: { x: tx, y: r0.top, w: tw, h: AISLE_SIGN_H }, slab: { x: Math.max(0, tx - 3), y: r0.top, w: 2, h: AISLE_SIGN_H } });
    }
    if (en) bands.forEach((b, si) => { const mine = desks.filter((d) => loungeSt(lounge[desks.indexOf(d)]) === si); if (!mine.length) return; const x0b = Math.min(b.box.x, ...mine.map((d) => d.slot.x)), y0b = Math.min(b.box.y, ...mine.map((d) => d.slot.y)), x1b = Math.max(b.box.x + b.box.w, ...mine.map((d) => d.slot.x + d.slot.w)), y1b = Math.max(b.box.y + b.box.h, ...mine.map((d) => d.slot.y + d.slot.h)); b.box = { x: x0b, y: y0b, w: x1b - x0b, h: y1b - y0b }; }); /* a band holds its floor's resting seats */
  }
  /* round 7 of the review of #1741: an upright floor rule is decoration of the tag; where it would be drawn through a folder sign (a hall that scrolls lets signs overflow), a tag, another rule or a resting seat, it is skipped, not moved:
     the zone's own left edge is under the same sign. A horizontal rule (floors on rows of their own) is in the gap and never meets one. */
  const hitR = (a: Rect, c: Rect): boolean => a.x < c.x + c.w && c.x < a.x + a.w && a.y < c.y + c.h && c.y < a.y + a.h;
  for (const b of bands) if (b.slab && b.slab.w <= 2 && (zones.some((z) => hitR(b.slab!, z.sign)) || bands.some((o) => hitR(b.slab!, o.tag) || (o !== b && o.slab && hitR(b.slab!, o.slab))) || (lay.lounge ? lay.lounge.desks.some((d) => hitR(b.slab!, d.slot) || hitR(b.slab!, d.plate)) : false))) b.slab = null;
  return lay;
}

/** Spec 102 FR-227, FR-229, T165: `circle`. The folders' desks, in the model's sequence, go round a `focus` picture: up the left side (the first seat at its foot), along the top row, down the right
 *  side, open towards the viewer. A side is one desk wide, or two where the people do not fit otherwise (`CircleOpts.side`); in a two-wide side the seats snake from row to row and a folder starts a new
 *  row, so a zone is still a rectangle. A desk is `rows`' own (`deskStation`), so the face is `FACE_U * u`; `u` is the largest the ring allows, found by bisection like FR-011, and never under
 *  `CIRCLE_U_MIN` (a face of 24 px, FR-229), so a ring that cannot hold the people at it scrolls, as `rows` does. First build: no fixtures in the centre, no helper strip, no big screens at 4 agents or
 *  fewer (FR-230), and the lobby band is `rows`'. Pure, no DOM, nothing draws it yet. */
/** the least `u` of `circle`: a desk face of `FACE_FLOOR` (24 px, FR-229) at `FACE_U` of the unit */
export const CIRCLE_U_MIN = Math.ceil(FACE_FLOOR / FACE_U);
export const CIRCLE_FOCUS_MIN = { w: 160, h: 120 } as const;
/** `side`: the widest side, 1 or 2 desks (default 2: one desk wide does not hold 15 at 1280x800, measured in the Changes of 2026-11-13) */
export interface CircleOpts { side?: 1 | 2 }
interface CirclePlan { nl: number; nt: number; nr: number; wl: number; wr: number; colH: number }
export function circleWith(model: RealModel, view: { w: number; h: number }, meta: RealMeta, signs: Record<string, { name: string; path: string; counts: number }> | undefined, opt: CircleOpts = {}): Layout {
  const W = Math.max(200, view.w), H0 = Math.max(200, view.h);
  const { desks: atDesks, lounge } = splitLounge(model);
  const folders = atDesks.filter((f) => f.agents.length).map((f) => ({ id: f.id, agents: shownDesks(f) }));
  const [lobbyMin, lobbyMax] = lobbyRange(H0), maxSide = opt.side ?? 2;
  const LR = lounge.length ? loungeRows(meta, lounge, W, 0) : null, R = LR ? LR.h : 0, Ho = Math.max(200, H0 - R);
  const seats = folders.flatMap((f, fx) => f.agents.map((a) => ({ a, fx })));
  const k = seats.length, avail = Ho - lobbyMin;
  /** the runs of one folder in seats [i, j) */
  const runs = (i: number, j: number): Array<[number, number]> => { const r: Array<[number, number]> = []; for (let n = i; n < j; n++) if (!r.length || seats[n].fx !== seats[n - 1].fx) r.push([n, n + 1]); else r[r.length - 1][1] = n + 1; return r; };
  /** rows of a side `w` wide holding seats [i, j): each folder starts a new row; and its height at desk height `b` */
  const rowsOf = (i: number, j: number, w: number): number => runs(i, j).reduce((s, [p, q]) => s + Math.ceil((q - p) / w), 0);
  const sideH = (i: number, j: number, w: number, b: number): number => (j > i ? rowsOf(i, j, w) * b + (runs(i, j).length - 1) * ZGAP : 0);
  const zonesIn = (i: number, j: number): number => (j > i ? seats[j - 1].fx - seats[i].fx + 1 : 0);
  const rowOf = (u: number) => ({ zones: folders, n: k, Sw: (PW + SR) * u, scrH: 0, strip: 0 });
  const needOf = (withFocus: boolean): number => (withFocus ? CIRCLE_FOCUS_MIN.h + PAD : 0);
  /* the seats at unit u: the split into a left side, a top row and a right side (k >= 3: a ring, each of them used) that fits, the most even and narrowest first; null when none does */
  const plan = (u: number, withFocus: boolean): CirclePlan | null => {
    if (!k) return null;
    const Sw = (PW + SR) * u, b = rowGeom(meta, rowOf(u), u).bottom, ring = k >= 3 && withFocus;
    let best: CirclePlan | null = null, bestScore = -Infinity;
    for (let wl = 1; wl <= maxSide; wl++) for (let wr = 1; wr <= maxSide; wr++) {
      for (let nl = ring ? 1 : 0; nl <= k - (ring ? 2 : 0); nl++) {
        const hl = sideH(0, nl, wl, b);
        if (hl > avail) break;
        for (let nr = ring ? 1 : 0; nl + nr <= k - 1 || (k === 1 && nl + nr === 0); nr++) {
          const nt = k - nl - nr, zt = zonesIn(nl, nl + nt);
          if (Math.max(nt * Sw + zt * 8 + ZGAP * (zt - 1), ring ? (wl + wr) * Sw + 16 + 2 * ZGAP + CIRCLE_FOCUS_MIN.w : 0) > W - 2 * PAD) continue; /* the row, and the two sides with the focus between them, fit the width */
          const colH = Math.max(hl, sideH(nl + nt, k, wr, b)), used = b + ZGAP + Math.max(colH, needOf(withFocus));
          if (used > avail) continue;
          const score = -Math.abs(nl - nr) * 1e4 - colH - (wl + wr - 2) * 5e3;
          if (score > bestScore) { bestScore = score; best = { nl, nt, nr, wl, wr, colH }; }
        }
      }
    }
    return best;
  };
  let u = CIRCLE_U_MIN, fits = true, cfg: CirclePlan | null = null, withFocus = true;
  if (k) {
    cfg = plan(CIRCLE_U_MIN, true);
    if (!cfg) { cfg = plan(CIRCLE_U_MIN, false); if (cfg) withFocus = false; } /* only the ring and its focus box make it scroll (a lounge-heavy floor): one row of desks, no box, the faces stay at the floor */
    fits = !!cfg;
    if (cfg) { let lo = CIRCLE_U_MIN, hi = U_MAX; for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2; if (plan(m, withFocus)) lo = m; else hi = m; } u = lo; cfg = plan(lo, withFocus); }
    else { /* nothing fits at CIRCLE_U_MIN: as many in the top row as its width holds, the rest in two sides of the widest kind, and the floor scrolls */
      const Sw = (PW + SR) * u, b = rowGeom(meta, rowOf(u), u).bottom, ring = k >= 3;
      let nt = ring ? k - 2 : k;
      const topW = (n: number): number => { const l = Math.ceil((k - n) / 2); return n * Sw + zonesIn(l, l + n) * 8 + ZGAP * (zonesIn(l, l + n) - 1); };
      while (nt > 1 && topW(nt) > W - 2 * PAD) nt--;
      const nl = ring ? Math.ceil((k - nt) / 2) : 0, nr = k - nt - nl;
      cfg = { nl, nt, nr, wl: 1, wr: 1, colH: Math.max(sideH(0, nl, 1, b), sideH(nl + nt, k, 1, b)) };
    }
  }
  const Sw = (PW + SR) * u, g = rowGeom(meta, rowOf(u), u), b = g.bottom;
  const need = needOf(withFocus), used = k ? b + ZGAP + Math.max(cfg!.colH, need) : 0;
  const Lb = Math.round(fits ? Math.max(lobbyMin, Math.min(Ho - used, lobbyMax)) : lobbyMin);
  const spare = fits ? Math.max(0, Ho - Lb - used) : 0, y0 = Lb + spare / 3;
  const zones: ZoneBox[] = [], part: Record<number, number> = {};
  /** one zone of consecutive seats [i, j): `at` gives each seat's slot corner; the box is their union and the sign sits on its top edge */
  const zoneOf = (i: number, j: number, at: (n: number) => { x: number; y: number }): void => {
    const f = folders[seats[i].fx], desks: DeskBox[] = [];
    for (let n = i; n < j; n++) { const p = at(n), d = deskStation(meta, seats[n].a, p.x, p.y, Sw, u, g, false, 0, 0, 0); d.slot.h = b; desks.push(d); }
    const x = Math.min(...desks.map((d) => d.slot.x)) - 4, top = Math.min(...desks.map((d) => d.slot.y)), bot = Math.max(...desks.map((d) => d.slot.y + d.slot.h));
    const zw = Math.max(...desks.map((d) => d.slot.x + d.slot.w)) + 4 - x;
    const s = signs && Object.prototype.hasOwnProperty.call(signs, f.id) ? signs[f.id] : { name: f.id, path: '', counts: 1 };
    const sw = signWidth(s.name, s.path, s.counts, zw);
    const hands = desks.filter((d) => d.person && (d.state === 'waiting' || d.state === 'limit') && d.person.y < top + STRIP).map((d) => [d.person!.x, d.person!.x + d.person!.w * 0.6]);
    const hits = (px: number): boolean => hands.some(([p, q]) => q > px && p < px + sw);
    let sx = x + 4;
    if (hits(sx)) { sx = x + zw - 4 - sw; if (hits(sx)) sx = Math.max(...hands.map((h) => h[1])) + 6; }
    sx = Math.max(x + 4, Math.min(sx, x + zw - 4 - sw));
    zones.push({ id: f.id, part: (part[seats[i].fx] = (part[seats[i].fx] || 0) + 1), box: { x, y: top + 2, w: zw, h: bot - top - 2 }, sign: { x: sx, y: top + 1, w: sw, h: 20 }, desks, ...(signMin(s.counts) > zw - 8 ? { signShort: true } : {}) });
  };
  const bw = (w: number): number => w * Sw + 8, ringed = k >= 3 && withFocus;
  const rowW = k ? cfg!.nt * Sw + zonesIn(cfg!.nl, cfg!.nl + cfg!.nt) * 8 + ZGAP * (zonesIn(cfg!.nl, cfg!.nl + cfg!.nt) - 1) : 0;
  /* the ring spans the row, or the two sides with the focus between them when that is wider (a ring of a few people); the sides stand at its two ends, the row in the middle */
  const span = ringed ? Math.max(rowW, (cfg!.wl + cfg!.wr) * Sw + 16 + 2 * ZGAP + CIRCLE_FOCUS_MIN.w) : rowW, rx0 = PAD + (W - 2 * PAD - span) / 2, rx1 = rx0 + span;
  if (k) {
    const { nl, nt, nr, wl, wr } = cfg!, yc = y0 + b + ZGAP;
    /* the left side: the first seat at its foot, upwards; a seat's column snakes with its row (outer, then inner, then outer again) */
    let yb = yc + sideH(0, nl, wl, b), row = 0;
    for (const [i, j] of runs(0, nl)) {
      const rows = Math.ceil((j - i) / wl), r0 = row; row += rows;
      zoneOf(i, j, (n) => { const r = Math.floor((n - i) / wl), c0 = (n - i) % wl, c = (r0 + r) % 2 ? wl - 1 - c0 : c0; return { x: rx0 + 4 + c * Sw, y: yb - (r + 1) * b }; });
      yb -= rows * b + ZGAP;
    }
    let x = rx0 + (span - rowW) / 2;
    for (const [i, j] of runs(nl, nl + nt)) { const x0 = x; zoneOf(i, j, (n) => ({ x: x0 + 4 + (n - i) * Sw, y: y0 })); x += (j - i) * Sw + 8 + ZGAP; }
    let yr = yc; row = 0;
    for (const [i, j] of runs(nl + nt, k)) {
      const rows = Math.ceil((j - i) / wr), r0 = row, y1 = yr; row += rows;
      zoneOf(i, j, (n) => { const r = Math.floor((n - i) / wr), c0 = (n - i) % wr, c = (r0 + r) % 2 ? wr - 1 - c0 : c0; return { x: rx1 - bw(wr) + 4 + c * Sw, y: y1 + r * b }; });
      yr += rows * b + ZGAP;
    }
  }
  const lb = lobbyBand(meta, model.places, W, Lb);
  const height = fits ? H0 : Math.ceil(Lb + used + PAD + R);
  const fx0 = ringed ? rx0 + bw(cfg!.wl) + ZGAP : PAD, fx1 = ringed ? rx1 - bw(cfg!.wr) - ZGAP : W - PAD, fy = y0 + b + ZGAP;
  const lay: Layout = { u, big: false, lobbyH: Lb, floorH: height - Lb, width: W, height, scroll: !fits || Ho + R > H0 + 0.5, faceH: FACE_U * u, zones, fixtures: lb.fixtures, floorStrip: lb.floorStrip, helpRows: 0 };
  /* the focus box, when it holds `CIRCLE_FOCUS_MIN`: with every agent in the lounge, or the ring dropped it to fit, there is none (never a negative height) */
  const focus: Rect = { x: fx0, y: fy, w: fx1 - fx0, h: fits ? Ho - PAD - fy : Math.max(need - PAD, (cfg ? cfg.colH : 0)) };
  if (withFocus && focus.w >= CIRCLE_FOCUS_MIN.w - 0.5 && focus.h >= CIRCLE_FOCUS_MIN.h - 0.5) lay.focus = focus;
  if (LR) lay.lounge = loungeRows(meta, lounge, W, height - R).row;
  return lay;
}
export const circleLayout = (model: RealModel, view: { w: number; h: number }, meta: RealMeta, signs?: Record<string, { name: string; path: string; counts: number }>): Layout => circleWith(model, view, meta, signs);

/** FR-230: whether `id` fits this floor, on the count of agents only; `leftAt` (the count it last fell back at) makes it return only with two agents fewer, so a seat count at the edge does not flip the room. `rows` always fits. Pure. */
export function arrangementFits(id: Arrangement, model: RealModel, view: { w: number; h: number }, meta: RealMeta, leftAt?: number): boolean {
  if (id === 'rows') return true;
  const n = model.folders.reduce((s, f) => s + f.agents.length, 0);
  if (leftAt !== undefined && n > leftAt - 2) return false;
  return !layoutFor(id, model, view, meta).scroll;
}

/** FR-228's one seam: the arrangement a world names picks the function. `rows` is `realLayout` and nothing else (T167: byte-identical). */
export function layoutFor(arrangement: Arrangement, model: RealModel, view: { w: number; h: number }, meta: RealMeta, signs?: Record<string, { name: string; path: string; counts: number }>): Layout {
  return arrangement === 'aisles' ? aislesLayout(model, view, meta, signs) : arrangement === 'circle' ? circleLayout(model, view, meta, signs) : realLayout(model, view, meta, signs);
}

/** T205: keyboard order is the seat order, row by row (FR-229), then the lounge's seats (spec 097 FR-249); `FACE_U` is kept in scope for the tests that compare the two arrangements */
export const aisleTabOrder = (L: Layout): string[] => L.zones.flatMap((z) => z.desks.map((d) => d.id)).concat(L.lounge ? L.lounge.desks.map((d) => d.id) : []);
export const ROWS_FACE_U = FACE_U;

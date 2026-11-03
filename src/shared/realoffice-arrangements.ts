/** Spec 102 FR-227, FR-256 (T202, T203, T205): where the people sit. `rows` is `realLayout`, untouched; `aisles` is the Retro arcade hall:
 *  staggered aisles of cabinets in an integer pixel scale `g`. Pure, no DOM, nothing draws it yet (RA3). The numbers marked "provisional"
 *  come from the mockup and the art by eye and are replaced by measured ones (T201's `faceBox`, T207's frame sizes). */
import { lobbyBand, lobbyRange, realLayout, sortDesks, signWidth, FACE_U, type DeskBox, type Layout, type RealMeta, type RealModel, type RealState, type Rect, type ZoneBox } from './realoffice-layout';

export const ARRANGEMENTS = ['rows', 'aisles'] as const;
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
export function packSeats(sizes: number[], cols: number, keep = true): { at: Array<[number, number]>; rows: number; inRow: number[] } {
  const at: Array<[number, number]> = []; let r = 0, c = 0;
  for (const m of sizes) {
    const small = keep && m <= 4;
    if (small && c > 0 && c + m > cols) { r++; c = 0; }
    for (let j = 0; j < m; j++) { if (c >= cols) { r++; c = 0; } at.push([r, c++]); }
    if (small && m > cols && c > 0) { r++; c = 0; }            /* the rows of a folder wider than a row are its own */
  }
  const rows = Math.max(1, c > 0 ? r + 1 : r), inRow = Array.from({ length: rows }, (_, i) => at.filter((p) => p[0] === i).length);
  return { at, rows, inRow };
}

interface Plan { keep: boolean; g: number; gw: number; gh: number; cols: number; rows: number; big: boolean; sl: number; rowH: number; slotW: number; fits: boolean }

/** FR-256 (owner, 2026-11-03: "bigger cabinets ... zigzag positioning for max usage"): every plan that fits (scale, cabinet, columns), and the
 *  one that uses the floor best. A brick zigzag (odd rows half a column over) was tried and removed (review of #1079): it needs more width than the
 *  straight plan of the same scale, cabinet and rows and covers the same floor, so it never won; the rows stagger instead. The order: no bare band over a quarter of
 *  the floor if any plan manages that, then the biggest scale, then the biggest cabinet, then the least bare floor. Past what fits, rows are added
 *  at the smallest choice and the floor scrolls inside itself (T203). */
function planFor(sizes: number[], W: number, F: number, PW: number = AISLE_PERSON.w): Plan {
  const k = sizes.reduce((a, b) => a + b, 0);
  const rowCost = (gh: number, g: number): number => AISLE_SIGN_H + cabGrid(0, gh).h * g + AISLE_PLATE_H + g - 1; /* g - 1: the cabinet snaps down to the grid */
  const plans: Plan[] = [];
  for (const keep of [true, false]) for (const g of k <= 4 ? AISLE_G_FEW : [3, 2]) for (const [name, c] of Object.entries(CABINETS)) for (let cols = 1; cols <= AISLE_COLS; cols++) {
    const rows = packSeats(sizes, cols, keep).rows, cab = cabGrid(c.gw, c.gh), slotW = (cab.w + PW + AISLE_GAP) * g;
    const cw = (W - 2 * AISLE_PAD) / cols, spareY = F - rows * rowCost(c.gh, g);
    if (slotW > cw || slotW < AISLE_SIGN_MIN_W || spareY < 0 || cols > k) continue;
    plans.push({ keep, g, gw: c.gw, gh: c.gh, cols, rows, big: name === 'big', sl: Math.min(13, Math.floor(spareY / (2 * rows + 2))), /* the bend flattens before anything scrolls */ rowH: rowCost(c.gh, g), slotW, fits: true });
  }
  const bare = (p: Plan): number => F - p.rows * (p.rowH + 2 * p.sl);
  /* 4 or fewer (owner, 2026-11-03: "still waste a lot of space"): the plan whose cabinets and people cover the most floor */
  const cover = (p: Plan): number => k <= 4 ? k * p.g * p.g * (cabGrid(p.gw, p.gh).w * cabGrid(p.gw, p.gh).h + PW * AISLE_PERSON.h) : 0;
  plans.sort((a, b) => Number(b.keep) - Number(a.keep) || cover(b) - cover(a) || Number(bare(a) > F / 4) - Number(bare(b) > F / 4) || b.g - a.g || b.gw * b.gh - a.gw * a.gh || bare(a) - bare(b) || a.rows - b.rows);
  if (plans.length) return plans[0];
  /* it does not fit: five columns of the smallest cabinet, as many rows as it takes, and the floor scrolls */
  const g = 2, gw = CABINETS.narrow.gw, gh = CABINETS.narrow.gh, cols = k <= 4 ? 2 : AISLE_COLS, cab = cabGrid(gw, gh), rows = packSeats(sizes, cols, false).rows;
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
const AISLE_FALLBACK: Record<string, string> = { 'face-knock': 'knock', 'face-coffee': 'counter', 'face-book': 'book', sit: 'face-book' };
const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
/** the frame a person shows at a cabinet and its size in grid pixels, or null when the set has neither (then the initials, FR-065) */
function aislePose(meta: RealMeta, pid: string, state: RealState): { pose: string; w: number; h: number } | null {
  const pose = AISLE_POSE[state];
  if (pose === 'rest') { const m = own(meta.seat, pid) ? meta.seat[pid] : null; return m ? { pose, w: m.w, h: m.h } : null; }
  const st = own(meta.stand, pid) ? meta.stand[pid] : null;
  if (!st) return null;
  for (const p of [pose, AISLE_FALLBACK[pose]]) if (p && own(st.poses, p)) return { pose: p, w: st.poses[p][0], h: st.poses[p][1] };
  return null;
}

/** an empty place's note stands where the person would, beside the glass and never over its text: `x` is the note's centre */
function aisleNote(gl: Rect, face: 'left' | 'right', g: number): { x: number; y: number; s: number } {
  const s = g <= 3 ? 66 : 22 * g; /* 66 px up to g = 3 (relayed review: outsized tickets); above, it grows with the art (relayed, 2026-11-03) */
  return { x: face === 'right' ? gl.x + gl.w + s / 2 + 3 * g : gl.x - s / 2 - 3 * g, y: gl.y + 6 * g, s }; /* 3 grid px: its tilt stays off the text */
}

export function aislesLayout(model: RealModel, view: { w: number; h: number }, meta: RealMeta, signs?: Record<string, { name: string; path: string; counts: number }>): Layout {
  const W = Math.max(200, view.w), Ho = Math.max(200, view.h);
  const folders = model.folders.filter((f) => f.agents.length).map((f) => ({ id: f.id, agents: sortDesks(f.agents) }));
  const seats = folders.flatMap((f) => f.agents.map((a) => ({ a, f: f.id })));
  const k = seats.length;
  const [lobbyMin0, lobbyMax] = lobbyRange(Ho), lobbyMin = lobbyMin0 - AISLE_LANE;
  /* the place beside a cabinet is as wide as the widest standing picture of the set, so a picture centred in it never reaches a cabinet */
  const PW = Math.min(48, Math.max(AISLE_PERSON.w, ...Object.values(meta.stand || {}).flatMap((s) => Object.values(s.poses || {}).map((p) => p[0])))); /* grid px; a set drawn at another scale is not an arcade set */
  /* the lobby first: the rows bend only with what is left once it has its height */
  const sizes = folders.map((f) => f.agents.length), lobbyT = Math.min(k <= 4 ? AISLE_LOBBY_FEW : AISLE_LOBBY, lobbyMax);
  /* owner, 2026-11-03 06:59 UTC (option A): with 4 or fewer the lobby may be lower, down to its minimum, when that lets the cabinets grow; the
     lobby height and the plan are chosen together, by the floor the cabinets and people cover (the same height on a tie keeps the higher lobby);
     what the larger plan leaves goes back to the lobby */
  const covered = (p: Plan): number => p.fits ? p.g * p.g * (cabGrid(p.gw, p.gh).w * cabGrid(p.gw, p.gh).h + PW * AISLE_PERSON.h) : -1;
  let first = planFor(sizes, W, Ho - lobbyT - AISLE_LANE - AISLE_PAD, PW);
  if (k <= 4 && AISLE_LOW_LOBBY) for (let L = lobbyT - 4; L >= Math.min(lobbyMin + AISLE_LANE, AISLE_LOBBY_LOW); L -= 2) { const p = planFor(sizes, W, Ho - L - AISLE_LANE - AISLE_PAD, PW); if (covered(p) > covered(first)) first = p; }
  const plan = first.fits ? first : planFor(sizes, W, Ho - lobbyMin - AISLE_LANE - AISLE_PAD, PW);
  const { g, cols, rows, sl } = plan, pk = packSeats(folders.map((f) => f.agents.length), cols, plan.keep), cab = cabGrid(plan.gw, plan.gh), cabW = cab.w * g, cabH = cab.h * g, pw = PW * g, ph = AISLE_PERSON.h * g;
  const bend = 2 * sl, used = rows * (plan.rowH + bend);
  const Lb0 = Math.round(plan.fits ? Math.max(lobbyMin, Math.min(Ho - used - AISLE_PAD - AISLE_LANE, lobbyT)) : lobbyMin);
  const Lb = Math.ceil(Lb0 / g) * g;
  const spare = plan.fits ? Math.max(0, Ho - Lb - AISLE_LANE - used - AISLE_PAD) : 0, extra = spare / (rows + 1);
  /* rows stagger by 8 % of a column, less where the floor is narrow */
  /* columns no wider than 1.1 slots, the grid in the middle: a small group stands close together */
  const cw = Math.min((W - 2 * AISLE_PAD) / cols, plan.slotW * AISLE_CLOSE), x0g = (W - cols * cw) / 2, snap = (v: number): number => Math.round(v / g) * g;
  const shift = rows < 2 ? 0 : Math.max(0, /* one row has nothing to stagger against: it stands in the middle */ Math.min(cw * AISLE_STAGGER, (cw - plan.slotW - g) / 2));
  const cxOf = (i: number): number => {
    const [r, c] = pk.at[i], n = pk.inRow[r]; /* a short row stands in the middle, so 3 is a triangle, not an L */
    return n < cols ? x0g + (c + 0.5 + (cols - n) / 2) * cw : x0g + (c + 0.5) * cw + (r % 2 ? 1 : -1) * shift;
  };
  /* the whole group in the middle of the floor: a staggered full row over a centred short one leans otherwise (review of #1079) */
  const cxs = pk.at.map((_, i) => cxOf(i)), lean = cxs.length ? W / 2 - (Math.min(...cxs) + Math.max(...cxs)) / 2 : 0;
  const slotBox = (i: number): { slot: Rect; cab: Rect; top: number; face: 'left' | 'right' } => {
    const [r, c] = pk.at[i], f0 = aisleFace(c, cols, r), face = k <= 4 ? (f0 === 'right' ? 'left' : 'right') : f0; /* a small room: the cabinets together in the middle, the people outside */
    const cx = cxs[i] + lean;
    const top = Lb + AISLE_LANE + extra * (r + 1) + r * (plan.rowH + bend);                      /* the row's top: its sign strip */
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
  const lb = lobbyBand(meta, model.places, W, Lb);
  const height = plan.fits ? Ho : Math.ceil(Lb + AISLE_LANE + used + AISLE_PAD);
  return { lane: { x: AISLE_PAD, y: Lb, w: W - 2 * AISLE_PAD, h: AISLE_LANE }, u: AISLE_PERSON.h * g, g, big: plan.big, lobbyH: Lb, floorH: height - Lb, width: W, height, scroll: !plan.fits, faceH: FACE_GRID * g, zones, fixtures: lb.fixtures, floorStrip: lb.floorStrip, cabinet: { w: cabW, h: cabH, gw: plan.gw, gh: plan.gh, cols, rows } };
}

/** FR-228's one seam: the arrangement a world names picks the function. `rows` is `realLayout` and nothing else (T167: byte-identical). */
export function layoutFor(arrangement: Arrangement, model: RealModel, view: { w: number; h: number }, meta: RealMeta, signs?: Record<string, { name: string; path: string; counts: number }>): Layout {
  return arrangement === 'aisles' ? aislesLayout(model, view, meta, signs) : realLayout(model, view, meta, signs);
}

/** T205: keyboard order is the seat order, row by row (FR-229); `FACE_U` is kept in scope for the tests that compare the two arrangements */
export const aisleTabOrder = (L: Layout): string[] => L.zones.flatMap((z) => z.desks.map((d) => d.id));
export const ROWS_FACE_U = FACE_U;

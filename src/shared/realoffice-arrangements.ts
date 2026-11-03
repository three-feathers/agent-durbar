/** Spec 102 FR-227, FR-256 (T202, T203, T205): where the people sit. `rows` is `realLayout`, untouched; `aisles` is the Retro arcade hall:
 *  staggered aisles of cabinets in an integer pixel scale `g`. Pure, no DOM, nothing draws it yet (RA3). The numbers marked "provisional"
 *  come from the mockup and the art by eye and are replaced by measured ones (T201's `faceBox`, T207's frame sizes). */
import { lobbyBand, lobbyRange, realLayout, sortDesks, signWidth, FACE_U, type DeskBox, type Layout, type RealMeta, type RealModel, type RealState, type Rect, type ZoneBox } from './realoffice-layout';

export const ARRANGEMENTS = ['rows', 'aisles'] as const;
export type Arrangement = (typeof ARRANGEMENTS)[number];
export const isArrangement = (v: unknown): v is Arrangement => typeof v === 'string' && (ARRANGEMENTS as readonly string[]).includes(v);

/** FR-256: a person at their cabinet is 72 grid pixels tall and 34 wide (provisional: the art's reduced size), the face 19 from crown to chin (the smallest of the 15 people, measured by `build-arcade-pack.py` into `faceBox`; RA1 had 24 by eye) */
export const AISLE_PERSON = { w: 34, h: 72 } as const;
export const FACE_GRID = 19;
/** FR-229: the face floor, crown to chin, only on a floor of 15 */
export const FACE_FLOOR = 24;
export const AISLE_PLATE_H = 24, AISLE_SIGN_H = 20, AISLE_PAD = 8, AISLE_COLS = 5, AISLE_STAGGER = 0.08;
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

interface Plan { g: number; gw: number; gh: number; cols: number; rows: number; big: boolean; sl: number; rowH: number; slotW: number; fits: boolean }

/** FR-256: the choices in order of preference (biggest picture first) and the first one that fits the floor. Past what fits, rows are added at the
 *  smallest choice and the floor scrolls inside itself (T203). */
function planFor(k: number, W: number, F: number): Plan {
  const rowCost = (gh: number, g: number): number => AISLE_SIGN_H + cabGrid(0, gh).h * g + AISLE_PLATE_H;
  const tryPlan = (g: number, gw: number, gh: number, cols: number, big: boolean): Plan | null => {
    const rows = Math.max(1, Math.ceil(k / cols)), cab = cabGrid(gw, gh), slotW = cab.w * g + Math.ceil((AISLE_PERSON.w * g) / 2);
    const cw = (W - 2 * AISLE_PAD) / cols, spareY = F - rows * rowCost(gh, g);
    if (slotW + g > cw || slotW < AISLE_SIGN_MIN_W || spareY < 0) return null;
    return { g, gw, gh, cols, rows, big, sl: Math.min(13, Math.floor(spareY / (2 * rows + 2))), /* the bend flattens before anything scrolls: a banner over the floor takes the last px */ rowH: rowCost(gh, g), slotW, fits: true };
  };
  if (k <= 4) {
    /* one or two columns of the big cabinet: g = 3 where the floor is tall enough, else 2 (the mockup's own choice at both sizes) */
    for (const g of [3, 2]) { const p = tryPlan(g, CABINETS.big.gw, CABINETS.big.gh, 2, true); if (p) return p; }
  } else {
    /* 5 to 8: g = 3 wherever it fits; 9 to 15: five columns, three rows, g = 2; the narrow drawing where the chat leaves little width */
    for (const g of [3, 2]) for (const c of [CABINETS.small, CABINETS.narrow]) for (const cols of [5, 4, 3, 2]) { const p = tryPlan(g, c.gw, c.gh, cols, false); if (p) return p; }
  }
  /* it does not fit: five columns of the smallest cabinet, as many rows as it takes, and the floor scrolls */
  const g = 2, gw = CABINETS.narrow.gw, gh = CABINETS.narrow.gh, cols = k <= 4 ? 2 : AISLE_COLS, cab = cabGrid(gw, gh), rows = Math.max(1, Math.ceil(k / cols));
  return { g, gw, gh, cols, rows, big: false, sl: 3, rowH: rowCost(gh, g), slotW: cab.w * g + Math.ceil((AISLE_PERSON.w * g) / 2), fits: false };
}

/** FR-256, T202, T203: the hall. `view` is the floor the app passes (its width and height). Day and night give the same object (FR-251). */
/** FR-259: what someone at a cabinet shows, per state. `face-*` are front frames, an optional group: each falls back to its view-a pose, so any full set works. Asleep: the seated frame. */
export const AISLE_POSE: Record<RealState, string> = { working: 'type', thinking: 'book', error: 'knock', waiting: 'face-knock', limit: 'face-knock', done: 'face-coffee', idle: 'face-book', asleep: 'rest' };
const AISLE_FALLBACK: Record<string, string> = { 'face-knock': 'knock', 'face-coffee': 'counter', 'face-book': 'book' };
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
  const s = 33 * g;
  return { x: face === 'right' ? gl.x + gl.w + s / 2 + 3 * g : gl.x - s / 2 - 3 * g, y: gl.y + 6 * g, s }; /* 3 grid px: its tilt stays off the text */
}

export function aislesLayout(model: RealModel, view: { w: number; h: number }, meta: RealMeta, signs?: Record<string, { name: string; path: string; counts: number }>): Layout {
  const W = Math.max(200, view.w), Ho = Math.max(200, view.h);
  const folders = model.folders.filter((f) => f.agents.length).map((f) => ({ id: f.id, agents: sortDesks(f.agents) }));
  const seats = folders.flatMap((f) => f.agents.map((a) => ({ a, f: f.id })));
  const k = seats.length;
  const [lobbyMin, lobbyMax] = lobbyRange(Ho);
  const plan = planFor(k, W, Ho - lobbyMin - AISLE_PAD);
  const { g, cols, rows, sl } = plan, cab = cabGrid(plan.gw, plan.gh), cabW = cab.w * g, cabH = cab.h * g, pw = AISLE_PERSON.w * g, ph = AISLE_PERSON.h * g;
  const bend = 2 * sl, used = rows * (plan.rowH + bend);
  const Lb0 = Math.round(plan.fits ? Math.max(lobbyMin, Math.min(Ho - used - AISLE_PAD, lobbyMax)) : lobbyMin);
  const Lb = Math.ceil(Lb0 / g) * g;
  const spare = plan.fits ? Math.max(0, Ho - Lb - used - AISLE_PAD) : 0, extra = spare / (rows + 1);
  const cw = (W - 2 * AISLE_PAD) / cols, snap = (v: number): number => Math.round(v / g) * g;
  /* the stagger is 8 % of a column, less where the floor is narrow: the row must stay inside it */
  const shift = Math.max(0, Math.min(cw * AISLE_STAGGER, (cw - plan.slotW - g) / 2));
  const slotBox = (i: number): { slot: Rect; cab: Rect; top: number; face: 'left' | 'right' } => {
    const r = Math.floor(i / cols), c = i % cols, face = aisleFace(c, cols, r);
    const cx = AISLE_PAD + (c + 0.5) * cw + (r % 2 ? 1 : -1) * shift;
    const top = Lb + extra * (r + 1) + r * (plan.rowH + bend);                      /* the row's top: its sign strip */
    const cabY = top + AISLE_SIGN_H + (Math.floor(cols / 2) - Math.abs(c - (cols - 1) / 2) > 0 ? Math.round((Math.floor(cols / 2) - Math.abs(c - (cols - 1) / 2)) * sl) : 0);
    /* the art sits on the grid: the cabinet's corner is a multiple of g (FR-255) and the slot follows it */
    const cx0 = snap(cx - plan.slotW / 2 + (face === 'right' ? 0 : pw / 2)), sx = face === 'right' ? cx0 : cx0 - Math.ceil(pw / 2);
    return { slot: { x: sx, y: top, w: plan.slotW, h: plan.rowH + bend }, cab: { x: cx0, y: Math.ceil(cabY / g) * g, w: cabW, h: cabH }, top, face };
  };
  const zones: ZoneBox[] = [];
  let i = 0;
  for (const f of folders) {
    const parts = new Map<number, number[]>();
    f.agents.forEach((_, j) => { const r = Math.floor((i + j) / cols); (parts.get(r) || parts.set(r, []).get(r)!).push(i + j); });
    let part = 0;
    for (const idx of parts.values()) {
      const desks: DeskBox[] = idx.map((n) => {
        const a = seats[n].a, b = slotBox(n), plateY = b.cab.y + cabH;
        const px = b.face === 'right' ? b.cab.x + cabW - Math.floor(pw / 2) : b.cab.x - Math.ceil(pw / 2), py = plateY - ph;
        const mirrored = b.face === 'right'; /* the art's side panel is on its right, so it faces left; the other way is the picture mirrored, and its glass and marquee with it */
        const faceS = FACE_GRID * g, gl = { x: b.cab.x + (mirrored ? cab.w - 5 - plan.gw : 5) * g, y: b.cab.y + 18 * g, w: plan.gw * g, h: plan.gh * g };
        const fr = a.person != null && !a.away ? aislePose(meta, String(a.person), a.state as RealState) : null;
        const needs = a.state === 'waiting' || a.state === 'limit';
        const d: DeskBox = {
          id: a.id, state: a.state as RealState, narrow: false, slot: b.slot, desk: { ...b.cab, full: cabH },
          plate: { x: b.cab.x, y: plateY, w: cabW, h: AISLE_PLATE_H }, screen: { x: gl.x - 4 * g, y: gl.y - 4 * g, w: gl.w + 8 * g, h: gl.h + 8 * g }, glass: gl,
          person: fr ? { x: px + Math.floor((pw - fr.w * g) / 2), y: plateY - fr.h * g, w: fr.w * g, h: fr.h * g, file: `${a.person}-${fr.pose}.webp`, fileB: null, pose: fr.pose, pid: String(a.person), vis: { x: px + Math.floor((pw - faceS) / 2), y: py, w: faceS, h: faceS } } : null,
          face: { x: px + Math.floor((pw - faceS) / 2), y: py + 4 * g, w: faceS, h: faceS },
          away: a.away ? aisleNote(gl, b.face, g) : null,
          lamp: { x: b.cab.x - 4 * g, y: b.cab.y - 4 * g, w: cabW + 8 * g, h: cabH + 8 * g },
          bubble: needs ? (a.away ? { x: gl.x + gl.w - 8 * g, y: gl.y - 4 * g } : { x: px + pw / 2, y: py + 2 * g }) : null, bang: a.state === 'error' ? { x: gl.x + gl.w - 4 * g, y: gl.y - 4 * g } : null, /* inside the cabinet's height: a sign may lie above it */
          dots: a.state === 'thinking' ? { x: px + pw / 2, y: py } : null, call: { x: b.cab.x + cabW - 16, y: plateY + 4 },
          marquee: { x: b.cab.x + (mirrored ? cab.w - 3 - (cab.w - 17 + 10 - 6) : 3) * g, y: b.cab.y + 2 * g, w: (cab.w - 17 + 10 - 6) * g, h: 9 * g }, stand: { x: px, y: py, w: pw, h: ph }, facing: b.face,
        };
        return d;
      });
      const first = slotBox(idx[0]), last = slotBox(idx[idx.length - 1]);
      const x0 = Math.min(first.slot.x, last.slot.x), x1 = Math.max(first.slot.x + first.slot.w, last.slot.x + last.slot.w);
      const s0 = f.id, s = signs && Object.prototype.hasOwnProperty.call(signs, s0) ? signs[s0] : { name: s0, path: '', counts: 1 };
      const room = x1 - x0, need = signWidth(s.name, s.path, s.counts, 4000), sw = Math.min(room, Math.max(AISLE_SIGN_MIN_W, need));
      zones.push({ id: f.id, part: ++part, box: { x: x0, y: first.top, w: x1 - x0, h: plan.rowH + bend }, sign: { x: x0, y: first.top, w: sw, h: AISLE_SIGN_H }, desks, signShort: need > room } as ZoneBox);
    }
    i += f.agents.length;
  }
  const lb = lobbyBand(meta, model.places, W, Lb);
  const height = plan.fits ? Ho : Math.ceil(Lb + used + AISLE_PAD);
  return { u: AISLE_PERSON.h * g, g, big: plan.big, lobbyH: Lb, floorH: height - Lb, width: W, height, scroll: !plan.fits, faceH: FACE_GRID * g, zones, fixtures: lb.fixtures, floorStrip: lb.floorStrip, cabinet: { w: cabW, h: cabH, gw: plan.gw, gh: plan.gh, cols, rows } };
}

/** FR-228's one seam: the arrangement a world names picks the function. `rows` is `realLayout` and nothing else (T167: byte-identical). */
export function layoutFor(arrangement: Arrangement, model: RealModel, view: { w: number; h: number }, meta: RealMeta, signs?: Record<string, { name: string; path: string; counts: number }>): Layout {
  return arrangement === 'aisles' ? aislesLayout(model, view, meta, signs) : realLayout(model, view, meta, signs);
}

/** T205: keyboard order is the seat order, row by row (FR-229); `FACE_U` is kept in scope for the tests that compare the two arrangements */
export const aisleTabOrder = (L: Layout): string[] => L.zones.flatMap((z) => z.desks.map((d) => d.id));
export const ROWS_FACE_U = FACE_U;

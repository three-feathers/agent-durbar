/**
 * The saved manual order of the office (spec 033, delta 2026-11-01, issue #677): rooms (by folder path), desks inside a room (by agent id)
 * and places (by place id). Pure: no Electron, no fs. It is sequencing only; the layout stays automatic. The renderer's
 * `src/renderer/reorder.js` `sanitize` follows the same rules (a test keeps the two equal). A saved key that is gone is ignored by the
 * office, so nothing here needs to know which folders exist.
 */

export interface OrderDoc {
  rooms: string[];
  desks: Record<string, string[]>;
  places: string[];
}

export const MAX_ORDER_ROOMS = 200;
export const MAX_ORDER_DESK_ROOMS = 200;
export const MAX_ORDER_DESKS = 100;
export const MAX_ORDER_PLACES = 50;
const MAX_KEY = 1024;
const MAX_ID = 200;

const ok = (v: unknown, n: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= n;

function cleanList(v: unknown, max: number, len = MAX_KEY): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of Array.isArray(v) ? v : []) {
    if (!ok(k, len) || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
    if (out.length >= max) break;
  }
  return out;
}

export const emptyOrder = (): OrderDoc => ({ rooms: [], desks: {}, places: [] });

/** Tolerant parse of a saved or received order document. Never throws; anything unusable is dropped. */
export function parseOrder(raw: unknown): OrderDoc {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const desks: [string, string[]][] = [];
  const src = o.desks && typeof o.desks === 'object' && !Array.isArray(o.desks) ? Object.entries(o.desks as Record<string, unknown>) : [];
  for (const [k, v] of src) {
    if (desks.length >= MAX_ORDER_DESK_ROOMS) break;
    if (!ok(k, MAX_KEY)) continue;
    const l = cleanList(v, MAX_ORDER_DESKS, MAX_ID);
    if (l.length) desks.push([k, l]);
  }
  // fromEntries defines own properties, so a key such as "__proto__" stays plain data
  return { rooms: cleanList(o.rooms, MAX_ORDER_ROOMS), desks: Object.fromEntries(desks), places: cleanList(o.places, MAX_ORDER_PLACES, MAX_ID) };
}

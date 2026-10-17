/**
 * Places in the office (spec 024 FR-007, FR-011): which place an MCP server's tool calls walk to. Pure and agent-neutral:
 * the settings file and the IPC hold only server names and place ids, never content. `src/renderer/places.js` has the same
 * ids (a test compares them) and the default rules for servers that are not mapped.
 */

/** Fixed set and order of the built-in places. */
export const PLACE_IDS = ['library', 'software', 'terminal', 'web', 'other'] as const;
export type PlaceId = (typeof PLACE_IDS)[number];
/** A mapping target: a place, or `desk` (the agent stays at its desk). */
export type PlaceChoice = PlaceId | 'desk';
/** MCP server name -> place. Global per user. */
export type PlaceMap = Record<string, PlaceChoice>;

export const MAX_PLACE_ENTRIES = 500;
export const MAX_SERVER_NAME = 200;

const isChoice = (v: unknown): v is PlaceChoice => v === 'desk' || (typeof v === 'string' && (PLACE_IDS as readonly string[]).includes(v));

/** A usable server name: a string of 1..200 characters after trimming, no control characters, not `__proto__`. */
export function cleanServerName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const n = v.trim();
  // eslint-disable-next-line no-control-regex
  if (n.length < 1 || n.length > MAX_SERVER_NAME || /[\u0000-\u001f\u007f]/.test(n) || n === '__proto__') return undefined;
  return n;
}

/** Tolerant parse of a saved or received map: keeps the valid entries (up to 500), drops everything else. Never throws. */
export function parsePlaceMap(v: unknown): PlaceMap {
  const out: PlaceMap = Object.create(null) as PlaceMap;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  let n = 0;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const name = cleanServerName(k);
    if (name === undefined || !isChoice(val) || name in out) continue;
    if (n >= MAX_PLACE_ENTRIES) break;
    out[name] = val;
    n++;
  }
  return out;
}

/**
 * Set (or clear, with `null`/`undefined`/`'default'`) one entry. Returns a new map; `ok` is false, and the map unchanged,
 * for an invalid server name, an unknown place, or a new entry beyond the cap.
 */
export function setPlaceEntry(map: PlaceMap, server: unknown, choice: unknown): { ok: boolean; map: PlaceMap } {
  const name = cleanServerName(server);
  const next = parsePlaceMap(map);
  if (name === undefined) return { ok: false, map: next };
  if (choice === null || choice === undefined || choice === 'default') {
    delete next[name];
    return { ok: true, map: next };
  }
  if (!isChoice(choice)) return { ok: false, map: next };
  if (!(name in next) && Object.keys(next).length >= MAX_PLACE_ENTRIES) return { ok: false, map: next };
  next[name] = choice;
  return { ok: true, map: next };
}

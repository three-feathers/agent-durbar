/**
 * Places in the office (spec 024 FR-007, FR-011): which place an MCP server's tool calls walk to. Pure and agent-neutral:
 * the settings file and the IPC hold only server names and place ids, never content. `src/renderer/places.js` has the same
 * ids (a test compares them) and the default rules for servers that are not mapped. Custom places (spec 024 FR-018, FR-019):
 * up to three of the user's own, each a name and an icon id from a fixed set; the simulator bridge (`src/renderer/sim.ts`) repeats
 * the small rules because the renderer bundle cannot import this file, and a test keeps both equal.
 */

/** Fixed set and order of the built-in places. */
export const PLACE_IDS = ['library', 'software', 'terminal', 'web', 'other'] as const;
export type PlaceId = (typeof PLACE_IDS)[number];
/** Id of a custom place: `c-` and six lowercase letters or digits, assigned by the main process. */
export type CustomPlaceId = `c-${string}`;
/** A mapping target: a built-in place, a custom place, or `desk` (the agent stays at its desk). */
export type PlaceChoice = PlaceId | CustomPlaceId | 'desk';
/** MCP server name -> place. Global per user. */
export type PlaceMap = Record<string, PlaceChoice>;

export const MAX_PLACE_ENTRIES = 500;
export const MAX_SERVER_NAME = 200;

const isChoice = (v: unknown, customIds: readonly string[] = []): v is PlaceChoice =>
  v === 'desk' || (typeof v === 'string' && ((PLACE_IDS as readonly string[]).includes(v) || customIds.includes(v)));

/** Custom places (spec 024 FR-018). */
export const MAX_CUSTOM_PLACES = 3;
export const MAX_PLACE_NAME = 24;
/** The fixed icon set, in picker order. `pin` is also what an unknown icon id in a hand-edited file becomes. */
export const CUSTOM_ICON_IDS = ['star', 'flask', 'database', 'cloud', 'chart', 'chat', 'mail', 'calendar', 'shield', 'box', 'bolt', 'pin'] as const;
export type CustomIconId = (typeof CUSTOM_ICON_IDS)[number];
/** Names a custom place cannot take (compared ignoring case): the built-in places, *Stay at desk* and *Default*. */
export const RESERVED_PLACE_NAMES = ['Library', 'Software library', 'Terminal', 'Web', 'Other tools', 'Stay at desk', 'Default', 'Coffee corner'] as const;
export const CUSTOM_ID_PATTERN = /^c-[a-z0-9]{6}$/;
export interface CustomPlace {
  id: CustomPlaceId;
  name: string;
  icon: CustomIconId;
}
export type PlaceError = 'name-empty' | 'name-long' | 'name-taken' | 'name-invalid' | 'icon' | 'limit' | 'unknown';

const isIcon = (v: unknown): v is CustomIconId => typeof v === 'string' && (CUSTOM_ICON_IDS as readonly string[]).includes(v);
const fold = (n: string): string => n.toLowerCase();

/**
 * A usable place name: a string, trimmed, 1 to 24 characters counted as code points (an emoji is one), no control, bidi or zero-width characters.
 * Says nothing about duplicates; see `placeNameError`.
 */
export function cleanPlaceName(v: unknown): { ok: true; name: string } | { ok: false; error: 'name-empty' | 'name-long' | 'name-invalid' } {
  if (typeof v !== 'string') return { ok: false, error: 'name-invalid' };
  const n = v.trim();
  if (n.length < 1) return { ok: false, error: 'name-empty' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f-\u009f\u200b-\u200c\u200e-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/.test(n)) return { ok: false, error: 'name-invalid' };
  if ([...n].length > MAX_PLACE_NAME) return { ok: false, error: 'name-long' };
  return { ok: true, name: n };
}

/** Is `name` (already cleaned) a reserved word or the name of another place in `list` (ignoring case)? `exceptId` is the place being renamed. */
function nameTaken(name: string, list: readonly CustomPlace[], exceptId?: string): boolean {
  const f = fold(name);
  return RESERVED_PLACE_NAMES.some((r) => fold(r) === f) || list.some((p) => p.id !== exceptId && fold(p.name) === f);
}

/** Tolerant read of a saved list (spec 024 FR-018): keeps the first 3 valid entries; drops invalid ids and names, repeated ids and names; an unknown icon becomes `pin`. Never throws. */
export function parseCustomPlaces(v: unknown): CustomPlace[] {
  const out: CustomPlace[] = [];
  if (!Array.isArray(v)) return out;
  for (const e of v) {
    if (out.length >= MAX_CUSTOM_PLACES) break;
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    const { id, name, icon } = e as { id?: unknown; name?: unknown; icon?: unknown };
    if (typeof id !== 'string' || !CUSTOM_ID_PATTERN.test(id) || out.some((p) => p.id === id)) continue;
    const nm = cleanPlaceName(name);
    if (!nm.ok || nameTaken(nm.name, out)) continue;
    out.push({ id: id as CustomPlaceId, name: nm.name, icon: isIcon(icon) ? icon : 'pin' });
  }
  return out;
}

export interface PlaceListResult {
  ok: boolean;
  error?: PlaceError;
  list: CustomPlace[];
}

/** Add a place. `newId` makes candidate ids; one that already exists (or does not fit the pattern) is asked for again. The input list is not modified. */
export function addCustomPlace(list: readonly CustomPlace[], name: unknown, icon: unknown, newId: () => string): PlaceListResult & { place?: CustomPlace } {
  const cur = parseCustomPlaces(list);
  if (cur.length >= MAX_CUSTOM_PLACES) return { ok: false, error: 'limit', list: cur };
  const nm = cleanPlaceName(name);
  if (!nm.ok) return { ok: false, error: nm.error, list: cur };
  if (nameTaken(nm.name, cur)) return { ok: false, error: 'name-taken', list: cur };
  if (!isIcon(icon)) return { ok: false, error: 'icon', list: cur };
  let id = '';
  for (let i = 0; i < 50; i++) {
    const c = newId();
    if (typeof c === 'string' && CUSTOM_ID_PATTERN.test(c) && !cur.some((p) => p.id === c)) { id = c; break; }
  }
  if (!id) return { ok: false, error: 'unknown', list: cur };
  const place: CustomPlace = { id: id as CustomPlaceId, name: nm.name, icon };
  return { ok: true, list: [...cur, place], place };
}

/** Rename and/or change the icon; the id stays, so mappings stay. A field that is absent (or `undefined`) is left alone. */
export function updateCustomPlace(list: readonly CustomPlace[], id: unknown, patch: unknown): PlaceListResult {
  const cur = parseCustomPlaces(list);
  const at = cur.findIndex((p) => p.id === id);
  if (at < 0) return { ok: false, error: 'unknown', list: cur };
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, error: 'unknown', list: cur };
  const { name, icon } = patch as { name?: unknown; icon?: unknown };
  const next = { ...cur[at] };
  if (name !== undefined) {
    const nm = cleanPlaceName(name);
    if (!nm.ok) return { ok: false, error: nm.error, list: cur };
    if (nameTaken(nm.name, cur, next.id)) return { ok: false, error: 'name-taken', list: cur };
    next.name = nm.name;
  }
  if (icon !== undefined) {
    if (!isIcon(icon)) return { ok: false, error: 'icon', list: cur };
    next.icon = icon;
  }
  const out = cur.slice();
  out[at] = next;
  return { ok: true, list: out };
}

/** Remove a place and every `map` entry that pointed to it (those servers go back to the default rules). */
export function removeCustomPlace(list: readonly CustomPlace[], map: PlaceMap, id: unknown): PlaceListResult & { placeMap: PlaceMap } {
  const cur = parseCustomPlaces(list);
  const ids = cur.map((p) => p.id as string);
  const keep = parsePlaceMap(map, ids);
  if (!cur.some((p) => p.id === id)) return { ok: false, error: 'unknown', list: cur, placeMap: keep };
  const rest = cur.filter((p) => p.id !== id);
  const placeMap: PlaceMap = Object.create(null) as PlaceMap;
  for (const [k, v] of Object.entries(keep)) if (v !== id) placeMap[k] = v;
  return { ok: true, list: rest, placeMap };
}

/** A usable server name: a string of 1..200 characters after trimming, no control characters, not `__proto__`. */
export function cleanServerName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const n = v.trim();
  // eslint-disable-next-line no-control-regex
  if (n.length < 1 || n.length > MAX_SERVER_NAME || /[\u0000-\u001f\u007f]/.test(n) || n === '__proto__') return undefined;
  return n;
}

/**
 * Tolerant parse of a saved or received map: keeps the valid entries (up to 500), drops everything else. Never throws.
 * `customIds` are the ids of the custom places that exist; an entry for any other custom id is dropped (spec 024 FR-019).
 */
export function parsePlaceMap(v: unknown, customIds: readonly string[] = []): PlaceMap {
  const out: PlaceMap = Object.create(null) as PlaceMap;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  let n = 0;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const name = cleanServerName(k);
    if (name === undefined || !isChoice(val, customIds) || name in out) continue;
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
export function setPlaceEntry(map: PlaceMap, server: unknown, choice: unknown, customIds: readonly string[] = []): { ok: boolean; map: PlaceMap } {
  const name = cleanServerName(server);
  const next = parsePlaceMap(map, customIds);
  if (name === undefined) return { ok: false, map: next };
  if (choice === null || choice === undefined || choice === 'default') {
    delete next[name];
    return { ok: true, map: next };
  }
  if (!isChoice(choice, customIds)) return { ok: false, map: next };
  if (!(name in next) && Object.keys(next).length >= MAX_PLACE_ENTRIES) return { ok: false, map: next };
  next[name] = choice;
  return { ok: true, map: next };
}

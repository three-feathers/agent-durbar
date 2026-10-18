/**
 * Floors (spec 033): named, ordered groups of folders that can be switched on and off. Pure and agent-neutral: no Electron,
 * no fs. The folder store keeps the document next to the saved folder list; the renderer only ever gets a copy. Every
 * operation returns a new document and never changes its input.
 */

export const GROUND = 'ground';
export const GROUND_NAME = 'Ground floor';
export const MAX_FLOORS = 40;
export const MAX_FLOOR_NAME = 40;

export interface Floor {
  id: string;
  name: string;
  on: boolean;
}

export interface FloorsDoc {
  floors: Floor[];
  /** Floor of the last added folder (default for the next one). */
  lastFloor: string;
}

export type FloorOp = { ok: true; doc: FloorsDoc } | { ok: false; error: string; doc: FloorsDoc };

const ID_RE = /^f-[a-z0-9]{8}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
/** Invisible characters that can make one name look like another or spoof the layout: bidi embeddings, overrides and isolates, zero-width space, word joiner, invisible operators, line and paragraph separators, soft hyphen, combining grapheme joiner, Mongolian vowel separator, Hangul fillers, interlinear annotation marks, BOM. ZWNJ/ZWJ and LRM/RLM stay allowed: real scripts and emoji need them. Escaped on purpose: never write these characters literally in source. */
const HIDDEN_RE = /[\u00ad\u034f\u115f\u180e\u200b\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\u3164\ufeff\ufff9-\ufffb]/;
const HIDDEN_ALL_RE = /[\u00ad\u034f\u115f\u180e\u200b\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\u3164\ufeff\ufff9-\ufffb]/g; // for replace only: a global regex keeps lastIndex, never use it with test
const C1_ALL_RE = /[\u0080-\u009f]/g;

const copy = (d: FloorsDoc): FloorsDoc => ({ floors: d.floors.map((f) => ({ ...f })), lastFloor: d.lastFloor });
const fail = (doc: FloorsDoc, error: string): FloorOp => ({ ok: false, error, doc: copy(doc) });
const done = (doc: FloorsDoc): FloorOp => ({ ok: true, doc });

export const defaultFloors = (): FloorsDoc => ({ floors: [{ id: GROUND, name: GROUND_NAME, on: true }], lastFloor: GROUND });

/** Tolerant parse of the saved `floors` + `lastFloor`. Never throws; the ground floor keeps its saved position and is put first when missing. */
export function parseFloors(floors: unknown, lastFloor?: unknown): FloorsDoc {
  const all: Floor[] = [];
  const names = new Set<string>();
  let others = 0;
  for (const e of Array.isArray(floors) ? floors : []) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id : '';
    if ((id !== GROUND && !ID_RE.test(id)) || all.some((f) => f.id === id)) continue;
    if (id !== GROUND && others >= MAX_FLOORS - 1) continue;
    // A saved name loses its hidden characters instead of the whole floor (FR-003, 2026-10-18).
    const name = cleanName(typeof o.name === 'string' ? o.name.replace(HIDDEN_ALL_RE, '').replace(C1_ALL_RE, '') : o.name) ?? (id === GROUND ? GROUND_NAME : undefined);
    if (!name || names.has(name.toLowerCase())) continue;
    all.push({ id, name, on: o.on !== false });
    names.add(name.toLowerCase());
    if (id !== GROUND) others++;
  }
  if (!all.some((f) => f.id === GROUND)) {
    // A damaged file may have lost the ground floor or given its name to another one: never let that block the app.
    let name = GROUND_NAME;
    for (let i = 2; names.has(name.toLowerCase()); i++) name = `${GROUND_NAME} ${i}`;
    all.unshift({ id: GROUND, name, on: true });
  }
  const last = typeof lastFloor === 'string' && all.some((f) => f.id === lastFloor) ? lastFloor : GROUND;
  return { floors: all, lastFloor: last };
}

/** A usable floor name: 1..40 characters after trimming, no control characters and no hidden direction or zero-width characters. */
export function cleanName(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const n = v.trim();
  if (n.length < 1 || n.length > MAX_FLOOR_NAME || CONTROL_RE.test(n) || HIDDEN_RE.test(n)) return undefined;
  return n;
}

/** Why a name cannot be used (empty string = fine). `exceptId` lets a floor keep its own name on rename. */
export function nameError(v: unknown, doc: FloorsDoc, exceptId?: string): string {
  if (typeof v !== 'string' || !v.trim()) return 'Name is empty.';
  const n = cleanName(v);
  if (!n) return `Use 1 to ${MAX_FLOOR_NAME} characters, without control or hidden characters.`;
  if (doc.floors.some((f) => f.id !== exceptId && f.name.toLowerCase() === n.toLowerCase())) return 'A floor with that name exists.';
  return '';
}

/** A fresh id not used in `doc`. `rand` is injectable for tests. */
export function newFloorId(doc: FloorsDoc, rand: () => number = Math.random): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (;;) {
    let s = 'f-';
    for (let i = 0; i < 8; i++) s += chars[Math.floor(rand() * chars.length) % chars.length];
    if (!doc.floors.some((f) => f.id === s)) return s;
  }
}

export function createFloor(doc: FloorsDoc, name: unknown, rand?: () => number): FloorOp & { id?: string } {
  if (doc.floors.length >= MAX_FLOORS) return fail(doc, `At most ${MAX_FLOORS} floors.`);
  const err = nameError(name, doc);
  if (err) return fail(doc, err);
  const next = copy(doc);
  const id = newFloorId(doc, rand);
  next.floors.push({ id, name: cleanName(name) as string, on: true });
  return { ok: true, doc: next, id };
}

export function renameFloor(doc: FloorsDoc, id: unknown, name: unknown): FloorOp {
  const i = doc.floors.findIndex((f) => f.id === id);
  if (i < 0) return fail(doc, 'Unknown floor.');
  const err = nameError(name, doc, doc.floors[i].id);
  if (err) return fail(doc, err);
  const next = copy(doc);
  next.floors[i].name = cleanName(name) as string;
  return done(next);
}

/** `ids` must list every current floor exactly once. */
export function reorderFloors(doc: FloorsDoc, ids: unknown): FloorOp {
  if (!Array.isArray(ids) || ids.length !== doc.floors.length || new Set(ids).size !== ids.length) return fail(doc, 'The new order must list every floor once.');
  const next = copy(doc);
  const byId = new Map(next.floors.map((f) => [f.id, f]));
  const out: Floor[] = [];
  for (const id of ids) {
    const f = typeof id === 'string' ? byId.get(id) : undefined;
    if (!f) return fail(doc, 'The new order must list every floor once.');
    out.push(f);
  }
  next.floors = out;
  return done(next);
}

/** Folders on the deleted floor go back to the ground floor (the caller clears their `floor`). The ground floor stays. */
export function deleteFloor(doc: FloorsDoc, id: unknown): FloorOp {
  if (id === GROUND) return fail(doc, 'The ground floor cannot be deleted.');
  if (!doc.floors.some((f) => f.id === id)) return fail(doc, 'Unknown floor.');
  const next = copy(doc);
  next.floors = next.floors.filter((f) => f.id !== id);
  if (next.lastFloor === id) next.lastFloor = GROUND;
  return done(next);
}

export function setFloorOn(doc: FloorsDoc, id: unknown, on: unknown): FloorOp {
  const i = doc.floors.findIndex((f) => f.id === id);
  if (i < 0) return fail(doc, 'Unknown floor.');
  const next = copy(doc);
  next.floors[i].on = on === true;
  return done(next);
}

/** That floor on, every other floor off. */
export function onlyFloor(doc: FloorsDoc, id: unknown): FloorOp {
  if (!doc.floors.some((f) => f.id === id)) return fail(doc, 'Unknown floor.');
  const next = copy(doc);
  for (const f of next.floors) f.on = f.id === id;
  return done(next);
}

/** The floor a folder is on (or goes to): the given id when that floor exists, else the ground floor. */
export function floorOf(folderFloor: unknown, doc: FloorsDoc): string {
  return typeof folderFloor === 'string' && doc.floors.some((f) => f.id === folderFloor) ? folderFloor : GROUND;
}

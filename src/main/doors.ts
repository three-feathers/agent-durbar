/**
 * Spec 017 FR-015..FR-017 (owner 2026-10-23): a cabin door the user closed (Do not disturb) and the prompts held behind it
 * (spec 044 FR-110, FR-111). Pure and file-based so it can be unit-tested without Electron (`npm run test:doors`).
 *
 * A door is keyed by the session's stable key (its resume id), so it survives a restart. While a door is closed, a scheduled run for
 * that agent is queued here in order, never sent and never dropped; opening the door offers Send all (one by one, in order) or Discard.
 */
import * as fs from 'fs';
import { MAX_PROMPT } from './schedules';

export { MAX_PROMPT };

/** One prompt held at a closed door. */
export interface HeldRun {
  id: string;
  /** When it was due (ms). */
  at: number;
  prompt: string;
  /** The schedule it came from (spec 044), when it came from one. */
  scheduleId?: string;
}
export interface DoorEntry {
  closed: boolean;
  held: HeldRun[];
  /** Send all is in progress: the next held run goes out when the agent is free again. */
  releasing?: boolean;
}
export interface DoorsDoc {
  doors: Record<string, DoorEntry>;
}

/** Limits that keep a damaged or hostile file from growing without end. */
export const MAX_DOORS = 500;
export const MAX_HELD = 200;
/** Review on #631: all doors together, and the file (read only below this size; a larger file is not parsed, it is kept aside). */
export const MAX_TOTAL_HELD = 1000;
export const MAX_FILE = 4 * 1024 * 1024;
/** The longest door key `okKey` accepts. */
export const MAX_KEY = 300;
/**
 * Spec 044 FR-126: held runs are refused ('full') when the file would pass this, so `loadDoors` never meets a file over MAX_FILE (a held prompt may be 10,000 characters).
 * The rest of MAX_FILE is room for door keys, which `setClosed` adds without measuring: at most MAX_DOORS of them, each a key of MAX_KEY characters that JSON
 * writes as 6 bytes apiece (`\u00XX`), plus what an empty entry costs in the 2-space format of `doorsText`:
 * `    "<key>": {` (key + 10 with the newline), `      "closed": false,` (23), `      "held": []` (17), `    },` (7) = 57, rounded up to 64.
 */
const DOOR_ENTRY_OVERHEAD = 64;
export const HELD_FILE_CAP = MAX_FILE - MAX_DOORS * (MAX_KEY * 6 + DOOR_ENTRY_OVERHEAD);

const okKey = (k: unknown): k is string => typeof k === 'string' && k.length > 0 && k.length <= MAX_KEY && k !== '__proto__' && k !== 'constructor' && k !== 'prototype';

function cleanRun(v: unknown): HeldRun | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id || o.id.length > 100) return undefined;
  if (typeof o.prompt !== 'string' || !o.prompt || o.prompt.length > MAX_PROMPT) return undefined;
  if (typeof o.at !== 'number' || !Number.isFinite(o.at)) return undefined;
  const out: HeldRun = { id: o.id, at: o.at, prompt: o.prompt };
  if (typeof o.scheduleId === 'string' && o.scheduleId && o.scheduleId.length <= 100) out.scheduleId = o.scheduleId;
  return out;
}

/** Tolerant parse: anything that is not a well-formed door is dropped; a door that is open with nothing held is not kept. */
export function parseDoors(text: string): DoorsDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { doors: Object.create(null) };
  }
  const src = raw && typeof raw === 'object' ? (raw as { doors?: unknown }).doors : undefined;
  const doors: Record<string, DoorEntry> = Object.create(null);
  if (!src || typeof src !== 'object') return { doors };
  let n = 0;
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
    if (n >= MAX_DOORS) break;
    if (!okKey(k) || !v || typeof v !== 'object') continue;
    const o = v as { closed?: unknown; held?: unknown };
    const held = Array.isArray(o.held) ? o.held.map(cleanRun).filter((x): x is HeldRun => !!x).slice(0, MAX_HELD) : [];
    const closed = o.closed === true;
    if (!closed && !held.length) continue;
    doors[k] = { closed, held }; // `releasing` is runtime state: after a restart the user decides again
    n++;
  }
  return { doors };
}

/**
 * Review on #631: a file that is too large or not JSON is never parsed blindly, and it is kept aside (`<file>.bad`) before anything
 * is written over it, so held runs in a damaged file are not lost silently. A missing file is an empty store.
 */
export function loadDoors(file: string): DoorsDoc {
  let text: string;
  try {
    if (fs.statSync(file).size > MAX_FILE) throw new Error('too large');
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') keepAside(file);
    return { doors: Object.create(null) };
  }
  try {
    JSON.parse(text);
  } catch {
    keepAside(file);
  }
  return parseDoors(text);
}
function keepAside(file: string): void {
  try {
    fs.renameSync(file, `${file}.bad`);
  } catch {
    /* nothing to keep */
  }
}

/** Atomic (a temp file, then a rename), so a crash mid-write never leaves a broken file; mode 0600 (POSIX) is set when it is created. */
/** The text `saveDoors` writes (also used to measure it, FR-126). */
export function doorsText(doc: DoorsDoc): string {
  const out: Record<string, { closed: boolean; held: HeldRun[] }> = {};
  for (const [k, d] of Object.entries(doc.doors)) if (d.closed || d.held.length) out[k] = { closed: d.closed, held: d.held };
  return JSON.stringify({ doors: out }, null, 2);
}
export function saveDoors(file: string, doc: DoorsDoc): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, doorsText(doc), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export interface DoorView {
  closed: boolean;
  held: number;
}

export class Doors {
  private n = 0;
  constructor(private doc: DoorsDoc, private persist: (doc: DoorsDoc) => void, private newId: () => string = () => `h${Date.now().toString(36)}${(this.n++).toString(36)}`) {
    const own: Record<string, DoorEntry> = Object.create(null);
    for (const [k, v] of Object.entries(doc.doors || {})) if (okKey(k)) own[k] = v;
    this.doc = { doors: own };
  }

  private entry(key: string): DoorEntry | undefined {
    return okKey(key) && Object.prototype.hasOwnProperty.call(this.doc.doors, key) ? this.doc.doors[key] : undefined;
  }
  isClosed(key: string): boolean {
    return !!this.entry(key)?.closed;
  }
  view(key: string): DoorView {
    const d = this.entry(key);
    return { closed: !!d?.closed, held: d ? d.held.length : 0 };
  }
  /** Closes or opens the door. Opening keeps what is held (the user then sends or discards it); closing stops a Send all in progress. */
  setClosed(key: string, closed: boolean): DoorView | undefined {
    if (!okKey(key)) return undefined;
    let d = this.entry(key);
    if (!d) {
      if (!closed) return { closed: false, held: 0 };
      if (Object.keys(this.doc.doors).length >= MAX_DOORS) return undefined;
      d = this.doc.doors[key] = { closed: false, held: [] };
    }
    d.closed = closed;
    if (closed) delete d.releasing;
    this.tidy(key);
    this.persist(this.doc);
    return this.view(key);
  }
  /**
   * FR-016: queues a run at a closed door, in order: 'held'. 'full' when the door's queue (MAX_HELD), all doors together
   * (MAX_TOTAL_HELD) or the file's size (HELD_FILE_CAP, FR-126) are full, or the prompt is not one a schedule can have: nothing is queued and the caller must say so.
   * False when the door is open.
   */
  hold(key: string, run: { at: number; prompt: string; scheduleId?: string }): 'held' | 'full' | false {
    const d = this.entry(key);
    if (!d || !d.closed) return false;
    const total = Object.values(this.doc.doors).reduce((n, x) => n + x.held.length, 0);
    if (d.held.length >= MAX_HELD || total >= MAX_TOTAL_HELD) return 'full';
    const r = cleanRun({ ...run, id: this.newId() });
    if (!r) return 'full';
    d.held.push(r);
    if (Buffer.byteLength(doorsText(this.doc), 'utf8') > HELD_FILE_CAP) { // FR-126: bytes as written (multi-byte text and escapes count), never past what a load accepts
      d.held.pop();
      return 'full';
    }
    this.persist(this.doc);
    return 'held';
  }
  /** The first held run of a door (not taken out). */
  peek(key: string): HeldRun | undefined {
    const r = this.entry(key)?.held[0];
    return r ? { ...r } : undefined;
  }
  /** Takes one run out of the queue by id (after it went out, or when its schedule is gone). */
  drop(key: string, id: string): boolean {
    const d = this.entry(key);
    if (!d) return false;
    const i = d.held.findIndex((r) => r.id === id);
    if (i < 0) return false;
    d.held.splice(i, 1);
    if (!d.held.length) delete d.releasing;
    this.tidy(key);
    this.persist(this.doc);
    return true;
  }
  /** Stops a Send all (the runs stay held). */
  stopRelease(key: string): void {
    const d = this.entry(key);
    if (d && d.releasing) {
      delete d.releasing;
      this.persist(this.doc);
    }
  }
  held(key: string): HeldRun[] {
    return (this.entry(key)?.held ?? []).map((r) => ({ ...r }));
  }
  /** FR-017 Discard: drops every held run of an open door; returns how many. */
  discard(key: string): number {
    const d = this.entry(key);
    if (!d || d.closed) return 0;
    const n = d.held.length;
    d.held = [];
    delete d.releasing;
    this.tidy(key);
    this.persist(this.doc);
    return n;
  }
  /** FR-017 Send all: marks an open door with held runs as releasing (nothing is taken yet). False when closed or empty. */
  arm(key: string): boolean {
    const d = this.entry(key);
    if (!d || d.closed || !d.held.length) return false;
    d.releasing = true;
    return true;
  }
  /** Send all: arm, then the first run; `next` hands out the following ones. Never while closed. */
  startRelease(key: string): HeldRun | undefined {
    return this.arm(key) ? this.next(key) : undefined;
  }
  releasing(key: string): boolean {
    return !!this.entry(key)?.releasing;
  }
  /** The next held run of a releasing, open door (taken out of the queue), or undefined when there is none. */
  next(key: string): HeldRun | undefined {
    const d = this.entry(key);
    if (!d || d.closed || !d.releasing) return undefined;
    const r = d.held.shift();
    if (!d.held.length) delete d.releasing;
    this.tidy(key);
    this.persist(this.doc);
    return r;
  }
  /** A run that could not be sent goes back to the front of the queue (it is never lost) and the release stops. */
  putBack(key: string, run: HeldRun): void {
    if (!okKey(key)) return;
    const d = this.entry(key) ?? (this.doc.doors[key] = { closed: false, held: [] });
    d.held.unshift(run);
    delete d.releasing;
    this.persist(this.doc);
  }
  keys(): string[] {
    return Object.keys(this.doc.doors);
  }
  private tidy(key: string): void {
    const d = this.entry(key);
    if (d && !d.closed && !d.held.length) delete this.doc.doors[key];
  }
}

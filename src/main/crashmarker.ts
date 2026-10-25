/**
 * Spec 006 FR-038..FR-040 (issue #606): the running marker. A small file in the profile folder that exists only while Durbar runs
 * and lists, as ids, the main sessions that were working. Found at the next start, it means the last run did not end normally and
 * says which sessions were in the middle of a turn. Principle III: ids only, no prompt, reply, title, path or token; mode 0600.
 */
import * as fs from 'fs';
import * as path from 'path';
import { sessionIdOk } from '../shared/sessionid';

export interface BusySession {
  id: string;
  adapterId: string;
}
export interface RunMarker {
  version: 1;
  startedAt: number;
  busy: BusySession[];
}

/** At most this many busy sessions are kept (the office holds 15 agents and a folder restores at most 6 sessions). */
export const MAX_BUSY = 24;
const ADAPTER_ID = /^[a-z][a-z0-9-]{0,31}$/;

/** The busy sessions of a list, validated: strict ids, strict adapter ids, no duplicates, at most MAX_BUSY. Anything else is dropped. */
export function cleanBusy(v: unknown): BusySession[] {
  if (!Array.isArray(v)) return [];
  const out: BusySession[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    if (out.length >= MAX_BUSY) break;
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const adapterId = o.adapterId;
    if (typeof adapterId !== 'string' || !ADAPTER_ID.test(adapterId) || !sessionIdOk(adapterId, o.id) || seen.has(o.id)) continue;
    seen.add(o.id);
    out.push({ id: o.id, adapterId });
  }
  return out;
}

/** Parses a marker file. Null when it is not a marker at all; a marker with bad entries keeps the good ones (the run was still unclean). */
export function parseMarker(text: string): RunMarker | null {
  if (text.length > 64 * 1024) return null;
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  const startedAt = typeof o.startedAt === 'number' && Number.isFinite(o.startedAt) ? Math.round(o.startedAt) : 0;
  return { version: 1, startedAt, busy: cleanBusy(o.busy) };
}

export function serializeMarker(m: RunMarker): string {
  return JSON.stringify({ version: 1, startedAt: m.startedAt, busy: cleanBusy(m.busy) });
}

export interface RestoredSession {
  id: string;
  adapterId: string;
  /** Restored lazily as the folder's remembered session (spec 006 FR-021): it resumes when asked. */
  resumeLast: boolean;
  /** The name the office shows for its folder. */
  folderName: string;
}
export interface Interrupted {
  id: string;
  adapterId: string;
  folderName: string;
}

/** FR-040: the busy sessions of the previous run that this start brought back as resumable lazy agents (same agent app), in the marker's order. */
export function interruptedFrom(prev: RunMarker | null, restored: Iterable<RestoredSession>): { items: Interrupted[]; missing: number } {
  if (!prev) return { items: [], missing: 0 };
  const byId = new Map<string, RestoredSession>();
  for (const r of restored) byId.set(r.id, r);
  const items: Interrupted[] = [];
  for (const b of prev.busy) {
    const r = byId.get(b.id);
    if (r && r.resumeLast && r.adapterId === b.adapterId) items.push({ id: r.id, adapterId: r.adapterId, folderName: r.folderName });
  }
  return { items, missing: prev.busy.length - items.length };
}

type Timer = ReturnType<typeof setTimeout>;
export interface MarkerDeps {
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => Timer;
  clearTimer?: (t: Timer) => void;
}

export class CrashMarker {
  private busy: BusySession[] = [];
  private written = '';
  private timer: Timer | undefined;
  private active = false;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => Timer;
  private readonly clearTimer: (t: Timer) => void;
  private startedAt = 0;

  constructor(private readonly file: string, deps: MarkerDeps = {}) {
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((t) => clearTimeout(t));
  }

  /** Reads the marker the last run left (null: it ended normally, or this is the first run) and writes this run's own. */
  begin(): { unclean: boolean; marker: RunMarker | null } {
    let text: string | undefined;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch {
      text = undefined;
    }
    const marker = text === undefined ? null : parseMarker(text);
    this.active = true;
    this.startedAt = this.now();
    this.busy = [];
    this.written = '';
    this.write();
    return { unclean: text !== undefined, marker };
  }

  /** The busy set changed: written within 250 ms, and not at all when it is the same as the file already holds. */
  setBusy(list: BusySession[]): void {
    if (!this.active) return;
    this.busy = cleanBusy(list);
    if (this.timer !== undefined) return;
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      if (this.active) this.write();
    }, 250);
  }

  /** A normal exit: no timer, no file. Synchronous, so it can run in a `process` exit hook. */
  clear(): void {
    this.active = false;
    if (this.timer !== undefined) {
      this.clearTimer(this.timer);
      this.timer = undefined;
    }
    try {
      fs.rmSync(this.file, { force: true });
    } catch {
      /* read-only profile: nothing to do */
    }
  }

  /** Test hook: write what is pending now. */
  flush(): void {
    if (this.timer !== undefined) {
      this.clearTimer(this.timer);
      this.timer = undefined;
    }
    if (this.active) this.write();
  }

  private write(): void {
    const text = serializeMarker({ version: 1, startedAt: this.startedAt, busy: this.busy });
    if (text === this.written) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, text, { mode: 0o600 });
      fs.renameSync(tmp, this.file);
      this.written = text;
    } catch {
      /* read-only profile, disk full: keep working without it */
    }
  }
}

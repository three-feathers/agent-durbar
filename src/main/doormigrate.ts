/**
 * Spec 017 FR-031..FR-034 (owner decision 2026-10-31: no doors). The one place that still knows the old `durbar-doors.json`: the scheduled
 * prompts that were held behind a closed door when the person updated. They are never sent and never lost without the person's choice:
 * they stay queued and paused, a notice asks once (Send, Discard or Decide later), and what stays undecided is a row in Settings > Schedules.
 * Pure and file-based (no Electron), so `npm run test:doormigrate` can test it. The `closed` flags of the old file are ignored.
 *
 * Send goes one run at a time through `release` (Scheduler.releaseDoorRun), so Pause all, a schedule's pause, limits, a busy agent and an
 * update lock still apply. Nothing in here sends by itself: a Send in progress lives in memory only and is gone after a restart.
 */
import * as fs from 'fs';
import { MAX_PROMPT } from './schedules';

/** One prompt held behind a door before the update. */
export interface HeldRun {
  id: string;
  /** When it was due (ms). */
  at: number;
  prompt: string;
  scheduleId?: string;
}

/** Why a release did not send (the scheduler's answer). */
export type ReleaseResult = 'sent' | 'busy' | 'paused-all' | 'paused' | 'cap' | 'ended' | 'updating' | 'gone' | 'failed';

/** What the old file could hold; limits that keep a damaged or hostile file from growing without end (the old caps). */
export const MAX_KEYS = 500;
export const MAX_HELD = 200;
export const MAX_FILE = 4 * 1024 * 1024;
export const MAX_KEY = 300;

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

/** One limit end to end (checklist): the most run ids one IPC call may carry is every run the file may hold. */
export const MAX_IDS = MAX_KEYS * MAX_HELD;

export interface HeldDoc {
  /** Session key (its resume id) -> its held runs, in order. */
  held: Record<string, HeldRun[]>;
  /** The one-time notice was shown. */
  noticed: boolean;
}

/** Tolerant parse of the old file: `closed` and `releasing` are ignored; a key with nothing held is dropped. */
export function parseHeld(text: string): HeldDoc {
  return parseHeldCounting(text).doc;
}

/** The same, and how many held runs (or keys) were not usable: malformed, over the caps, or a key that is refused. A usable file has 0. */
export function parseHeldCounting(text: string): { doc: HeldDoc; dropped: number } {
  const held: Record<string, HeldRun[]> = Object.create(null);
  let dropped = 0;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { doc: { held, noticed: false }, dropped: 0 };
  }
  const o = raw && typeof raw === 'object' ? (raw as { doors?: unknown; noticed?: unknown }) : {};
  const src = o.doors && typeof o.doors === 'object' ? (o.doors as Record<string, unknown>) : {};
  let n = 0;
  for (const [k, v] of Object.entries(src)) {
    const h = v && typeof v === 'object' ? (v as { held?: unknown }).held : undefined;
    const count = Array.isArray(h) ? h.length : 0;
    if (n >= MAX_KEYS) {
      dropped += count;
      continue;
    }
    if (!okKey(k) || !v || typeof v !== 'object') {
      dropped += count;
      continue;
    }
    const all = Array.isArray(h) ? h.map(cleanRun).filter((x): x is HeldRun => !!x) : [];
    const runs = all.slice(0, MAX_HELD);
    dropped += count - runs.length;
    if (!runs.length) continue;
    held[k] = runs;
    n++;
  }
  return { doc: { held, noticed: o.noticed === true }, dropped };
}

/** What the file is written as: the old `doors` shape without `closed`, so an older build still reads it. */
export function heldText(doc: HeldDoc): string {
  const doors: Record<string, { closed: false; held: HeldRun[] }> = {};
  for (const [k, runs] of Object.entries(doc.held)) if (runs.length) doors[k] = { closed: false, held: runs };
  return JSON.stringify({ doors, ...(doc.noticed ? { noticed: true } : {}) }, null, 2);
}

export interface LoadedHeld {
  doc: HeldDoc;
  /** The file was too large or not JSON, or some of its runs were unusable: it was kept aside as `<file>.bad` (part of it may still be read). */
  damaged: boolean;
}

function keepAside(file: string): boolean {
  try {
    fs.renameSync(file, `${file}.bad`);
    return true;
  } catch {
    return false;
  }
}

/**
 * A missing file is an empty store. A file that is too large or not JSON is never parsed blindly: it is kept aside (`<file>.bad`)
 * before anything is written, and `damaged` says so. A file with nothing held (only `closed` flags) is removed.
 */
export function loadHeld(file: string): LoadedHeld {
  const empty = (): HeldDoc => ({ held: Object.create(null), noticed: false });
  let text: string;
  try {
    if (fs.statSync(file).size > MAX_FILE) throw new Error('too large');
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return { doc: empty(), damaged: false };
    return { doc: empty(), damaged: keepAside(file) };
  }
  try {
    JSON.parse(text);
  } catch {
    return { doc: empty(), damaged: keepAside(file) };
  }
  const { doc, dropped } = parseHeldCounting(text);
  if (dropped > 0) {
    // runs that could not be read are never deleted silently: the whole file is kept aside, the notice says so
    try {
      fs.copyFileSync(file, `${file}.bad`);
    } catch {
      /* the notice still says it */
    }
    if (!Object.keys(doc.held).length) removeFile(file);
    return { doc, damaged: true };
  }
  if (!Object.keys(doc.held).length) removeFile(file);
  return { doc, damaged: false };
}

function removeFile(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    /* already gone */
  }
}

/** Atomic (a temp file, then a rename), mode 0600 on POSIX. An empty queue removes the file. */
export function saveHeld(file: string, doc: HeldDoc): void {
  if (!Object.keys(doc.held).some((k) => doc.held[k].length)) return removeFile(file);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, heldText(doc), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** One run as the window sees it. */
export interface HeldView {
  id: string;
  /** The agent id of the session in this office now, or undefined when the session has gone. */
  session?: string;
  prompt: string;
  at: number;
  /** Send is possible to try: the session and the schedule still exist. Otherwise only Discard, and `why` says so. */
  canSend: boolean;
  why?: string;
}
export interface HeldList {
  items: HeldView[];
  /** The one-time notice has not been shown yet (and something is held, or a file was damaged). */
  notice: boolean;
  /** A damaged file was kept aside at this start (the notice says so). */
  damaged: boolean;
}

export interface MigrateDeps {
  /** The agent id of the session with this key (its resume id), or undefined when it has gone. */
  sessionOf(key: string): string | undefined;
  scheduleExists(id: string | undefined): boolean;
  /** Scheduler.releaseDoorRun: the run goes through the scheduler's own checks. */
  release(run: HeldRun): Promise<ReleaseResult>;
  persist(doc: HeldDoc): void;
  /** Delete the kept-aside `.bad` file (only when the person chooses); true when it is gone. */
  discardBad?(): boolean;
  /** The list changed (the window redraws). */
  changed(): void;
  /** A Send stopped with a run still held (the window says why). */
  stopped(agentId: string | undefined, why: ReleaseResult): void;
  /** Runs `fn` after main has noted a status (defaults to setTimeout 0). */
  later?(fn: () => void): void;
}

export const GONE_SESSION = 'its session has gone';
export const GONE_SCHEDULE = 'its schedule has gone';

export class HeldBeforeUpdate {
  /** Keys whose Send is in progress -> the run ids the person chose. Memory only: after a restart nothing goes out by itself. */
  private releasing = new Map<string, Set<string>>();
  private busyKeys = new Set<string>();
  private doc: HeldDoc;
  private damaged: boolean;
  constructor(loaded: LoadedHeld, private deps: MigrateDeps) {
    this.doc = loaded.doc;
    this.damaged = loaded.damaged;
  }

  list(): HeldList {
    const items: HeldView[] = [];
    for (const [key, runs] of Object.entries(this.doc.held)) {
      const session = this.deps.sessionOf(key);
      for (const r of runs) {
        const why = !session ? GONE_SESSION : !this.deps.scheduleExists(r.scheduleId) ? GONE_SCHEDULE : undefined;
        items.push({ id: r.id, ...(session ? { session } : {}), prompt: r.prompt, at: r.at, canSend: !why, ...(why ? { why } : {}) });
      }
    }
    return { items, notice: !this.doc.noticed && (items.length > 0 || this.damaged), damaged: this.damaged };
  }

  /** The notice was shown: never again (whatever the person chose, Escape included). */
  noticed(): void {
    if (this.doc.noticed && !this.damaged) return;
    this.doc.noticed = true;
    this.damaged = false;
    this.deps.persist(this.doc);
  }

  count(): number {
    return Object.values(this.doc.held).reduce((n, r) => n + r.length, 0);
  }

  /** Discard the runs with these ids (all when `ids` is undefined). Returns how many. A Send in progress for them stops. */
  discard(ids?: string[]): number {
    const want = ids ? new Set(ids) : undefined;
    let n = 0;
    for (const key of Object.keys(this.doc.held)) {
      const keep = this.doc.held[key].filter((r) => !(want ? want.has(r.id) : true));
      n += this.doc.held[key].length - keep.length;
      if (keep.length) this.doc.held[key] = keep;
      else delete this.doc.held[key];
      const set = this.releasing.get(key);
      if (set) {
        for (const id of [...set]) if (!keep.some((r) => r.id === id)) set.delete(id);
        if (!set.size) this.releasing.delete(key);
      }
    }
    if (n) this.deps.persist(this.doc);
    this.deps.changed();
    return n;
  }

  /** Send the runs with these ids (all when `ids` is undefined), one by one. Runs that cannot be sent (session or schedule gone) are skipped and stay held. */
  async send(ids?: string[]): Promise<{ started: number; skipped: number }> {
    const want = ids ? new Set(ids) : undefined;
    let started = 0, skipped = 0;
    const keys: string[] = [];
    for (const [key, runs] of Object.entries(this.doc.held)) {
      const session = this.deps.sessionOf(key);
      const ok = runs.filter((r) => (!want || want.has(r.id)) && session && this.deps.scheduleExists(r.scheduleId));
      skipped += runs.filter((r) => !want || want.has(r.id)).length - ok.length;
      if (!ok.length) continue;
      this.releasing.set(key, new Set(ok.map((r) => r.id)));
      started += ok.length;
      keys.push(key);
    }
    this.deps.changed();
    for (const key of keys) await this.pump(key);
    return { started, skipped };
  }

  /** The next chosen run of a key goes when the scheduler lets it; stops (the run stays held) when it may not. */
  async pump(key: string): Promise<void> {
    if (this.busyKeys.has(key)) return;
    for (;;) {
      const chosen = this.releasing.get(key);
      const run = chosen && this.doc.held[key]?.find((r) => chosen.has(r.id));
      if (!chosen || !run) {
        this.releasing.delete(key);
        return;
      }
      this.busyKeys.add(key);
      let r: ReleaseResult;
      try {
        r = await this.deps.release(run).catch((): ReleaseResult => 'failed');
      } finally {
        this.busyKeys.delete(key);
      }
      if (r === 'busy') return; // waits for the next idle of that session
      if (r !== 'sent') {
        this.releasing.delete(key); // never lost, never retried by itself
        this.deps.changed();
        this.deps.stopped(this.deps.sessionOf(key), r);
        return;
      }
      this.drop(key, run.id);
      chosen.delete(run.id);
      this.deps.changed();
      return; // the next one goes when this turn has ended
    }
  }

  private drop(key: string, id: string): void {
    const left = (this.doc.held[key] ?? []).filter((r) => r.id !== id);
    if (left.length) this.doc.held[key] = left;
    else delete this.doc.held[key];
    this.deps.persist(this.doc);
  }

  /**
   * A status event: when any main session's turn ends (idle), every chosen run is tried again. The scheduler's `busy` can come from a
   * sibling session of the folder (a schedule without a target) or a coffee break, so the run's own session may never idle again.
   */
  onStatus(e: { type: string; agentId?: string; sessionId: string; status?: string }): void {
    if (e.type !== 'status' || e.agentId || e.status !== 'idle') return;
    this.retry();
  }

  /** Try every chosen run again now (also called on a timer by main, so a break that ends is noticed). `release` checks everything again. */
  retry(): void {
    if (!this.releasing.size) return;
    (this.deps.later ?? ((fn) => void setTimeout(fn, 0)))(() => {
      for (const key of [...this.releasing.keys()]) void this.pump(key);
    });
  }

  /** Delete the kept-aside file after the notice named it (only on the person's choice). */
  discardBad(): boolean {
    return this.deps.discardBad ? this.deps.discardBad() : false;
  }

  /** For tests: is a Send in progress for this key. */
  isReleasing(key: string): boolean {
    return this.releasing.has(key);
  }
}

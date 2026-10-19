/**
 * Scheduled prompts (spec 044): per-folder schedules that send a prompt to the folder's agent once or every N minutes, only
 * while the app runs. The core is pure (an injected clock, timer, busy check and sender) and unit-tested with a fake clock.
 * Stored as `durbar-schedules.json` in the user-data folder; the prompt text is kept there (it must be sent) and never logged.
 */
import { randomUUID } from 'crypto';
import * as fs from 'fs';

export type Outcome = 'sent' | 'skipped-busy' | 'skipped-paused' | 'missed' | 'failed';
export interface Schedule {
  id: string;
  folder: string;
  prompt: string;
  /** Every N minutes (5..1440), or */
  every?: number;
  /** once at this time (epoch ms). With `every`: the first run, and the runs keep that time of day (spec 044 FR-007, e.g. every day at 08:30). */
  at?: number;
  /** Next run of an interval schedule (epoch ms). */
  next?: number;
  paused?: boolean;
  done?: boolean;
  last?: { at: number; outcome: Outcome };
}
export interface SchedulesDoc {
  pausedAll: boolean;
  schedules: Schedule[];
}

export const MAX_SCHEDULES = 50;
export const MAX_PROMPT = 2000;
export const MIN_EVERY = 5;
export const MAX_EVERY = 1440;
const MIN = 60_000;
const OUTCOMES: Outcome[] = ['sent', 'skipped-busy', 'skipped-paused', 'missed', 'failed'];

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** FR-007: the next run of an anchored interval after `now`: anchor + k * every, the smallest one that is later than now. */
export function alignedNext(anchor: number, everyMin: number, now: number): number {
  const step = everyMin * MIN;
  if (anchor > now) return anchor;
  return anchor + (Math.floor((now - anchor) / step) + 1) * step;
}

/** When an interval runs again after `now`: anchored ones keep their time of day, others count from now. */
const nextAfter = (s: Schedule, now: number): number => (s.at !== undefined && s.every !== undefined ? alignedNext(s.at, s.every, now) : now + (s.every as number) * MIN);

/** One schedule from untrusted input (the file or the renderer); undefined when it is not valid. */
export function cleanSchedule(o: unknown, now: number, keepId = true): Schedule | undefined {
  if (!o || typeof o !== 'object') return undefined;
  const r = o as Record<string, unknown>;
  const folder = typeof r.folder === 'string' && r.folder && r.folder.length <= 4096 ? r.folder : undefined;
  const prompt = typeof r.prompt === 'string' ? r.prompt.trim().slice(0, MAX_PROMPT) : '';
  if (!folder || !prompt) return undefined;
  const every = num(r.every);
  const at = num(r.at);
  const s: Schedule = { id: keepId && typeof r.id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(r.id) ? r.id : randomUUID(), folder, prompt };
  if (every !== undefined) {
    if (!Number.isInteger(every) || every < MIN_EVERY || every > MAX_EVERY) return undefined;
    s.every = every;
    if (at !== undefined && at > 0) s.at = at; // anchored (FR-007)
    const next = num(r.next);
    s.next = next !== undefined && next > 0 ? next : s.at !== undefined ? alignedNext(s.at, every, now - 1) : now + every * MIN;
  } else if (at !== undefined && at > 0) s.at = at;
  else return undefined;
  if (r.paused === true) s.paused = true;
  if (r.done === true) s.done = true;
  const last = r.last as Record<string, unknown> | undefined;
  if (last && typeof last === 'object' && num(last.at) !== undefined && OUTCOMES.includes(last.outcome as Outcome)) s.last = { at: last.at as number, outcome: last.outcome as Outcome };
  return s;
}

export function parseSchedules(text: string, now: number): SchedulesDoc {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { pausedAll: false, schedules: [] };
  }
  const d = (doc && typeof doc === 'object' ? doc : {}) as Record<string, unknown>;
  const list = Array.isArray(d.schedules) ? d.schedules : [];
  const schedules: Schedule[] = [];
  for (const e of list) {
    const s = cleanSchedule(e, now);
    if (s && !schedules.some((x) => x.id === s.id)) schedules.push(s);
    if (schedules.length >= MAX_SCHEDULES) break;
  }
  return { pausedAll: d.pausedAll === true, schedules };
}

/** When a schedule runs next, or undefined when it never will (done, or paused). */
export function dueAt(s: Schedule): number | undefined {
  if (s.done || s.paused) return undefined;
  return s.every !== undefined ? s.next : s.at;
}

export interface SchedulerDeps {
  now(): number;
  /** The folder's agent is working or waiting for the user. */
  isBusy(folder: string): boolean;
  /** Sends the prompt to the folder's agent; false when it could not. */
  send(folder: string, prompt: string, s: Schedule): Promise<boolean>;
  setTimer(ms: number, fn: () => void): unknown;
  clearTimer(t: unknown): void;
  save(doc: SchedulesDoc): void;
  /** After any change (for the renderer). */
  changed?(doc: SchedulesDoc): void;
}

export class Scheduler {
  private timer: unknown;
  private running = false;
  constructor(public doc: SchedulesDoc, private readonly deps: SchedulerDeps) {}

  /** At start: once-schedules that are past are `missed`; intervals continue from now, anchored ones at their next time of day (missed runs are not caught up). */
  start(): void {
    const now = this.deps.now();
    for (const s of this.doc.schedules) {
      if (s.done || s.paused) continue;
      if (s.at !== undefined && s.every === undefined && s.at < now - 30_000) {
        s.done = true;
        s.last = { at: now, outcome: 'missed' };
      } else if (s.every !== undefined && (s.next ?? 0) < now - 30_000) {
        s.next = nextAfter(s, now);
        s.last = { at: now, outcome: 'missed' };
      }
    }
    this.commit();
  }

  private commit(): void {
    this.deps.save(this.doc);
    this.deps.changed?.(this.doc);
    this.arm();
  }

  private arm(): void {
    if (this.timer !== undefined) this.deps.clearTimer(this.timer);
    this.timer = undefined;
    const due = this.doc.schedules.map(dueAt).filter((t): t is number => t !== undefined);
    if (!due.length) return;
    const wait = Math.max(0, Math.min(...due) - this.deps.now());
    this.timer = this.deps.setTimer(Math.min(wait, 2 ** 31 - 1), () => void this.tick());
  }

  /** Runs what is due now; one run per schedule; a busy agent or pause-all skips the run (never queued). */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = this.deps.now();
      for (const s of this.doc.schedules) {
        const t = dueAt(s);
        if (t === undefined || t > now) continue;
        let outcome: Outcome;
        if (this.doc.pausedAll) outcome = 'skipped-paused';
        else if (this.deps.isBusy(s.folder)) outcome = 'skipped-busy';
        else outcome = (await this.deps.send(s.folder, s.prompt, s).catch(() => false)) ? 'sent' : 'failed';
        s.last = { at: now, outcome };
        if (s.every !== undefined) s.next = nextAfter(s, now);
        else s.done = true;
      }
    } finally {
      this.running = false;
      this.commit();
    }
  }

  /** Adds or replaces a schedule (validated); returns it, or an error. */
  save(input: unknown, folderExists: (f: string) => boolean): { ok: true; schedule: Schedule } | { ok: false; error: string } {
    const now = this.deps.now();
    const s = cleanSchedule({ ...(input as object), next: undefined }, now);
    if (!s) return { ok: false, error: 'A schedule needs a prompt and either a time or an interval of 5 to 1440 minutes.' };
    if (!folderExists(s.folder)) return { ok: false, error: 'Unknown folder.' };
    if (s.at !== undefined && s.every === undefined && s.at < now) return { ok: false, error: 'That time has already passed.' };
    const i = this.doc.schedules.findIndex((x) => x.id === s.id);
    if (i < 0 && this.doc.schedules.length >= MAX_SCHEDULES) return { ok: false, error: `At most ${MAX_SCHEDULES} schedules.` };
    if (i >= 0) {
      const old = this.doc.schedules[i];
      if (old.last) s.last = old.last;
      this.doc.schedules[i] = s;
    } else this.doc.schedules.push(s);
    this.commit();
    return { ok: true, schedule: s };
  }

  remove(id: string): boolean {
    const n = this.doc.schedules.length;
    this.doc.schedules = this.doc.schedules.filter((s) => s.id !== id);
    if (this.doc.schedules.length === n) return false;
    this.commit();
    return true;
  }

  removeFolder(folder: string): void {
    const n = this.doc.schedules.length;
    this.doc.schedules = this.doc.schedules.filter((s) => s.folder !== folder);
    if (this.doc.schedules.length !== n) this.commit();
  }

  setPausedAll(on: boolean): void {
    this.doc.pausedAll = on;
    if (!on) {
      // resuming: intervals continue from now, so nothing fires in a burst
      const now = this.deps.now();
      for (const s of this.doc.schedules) if (s.every !== undefined && !s.done && !s.paused && (s.next ?? 0) < now) s.next = nextAfter(s, now);
    }
    this.commit();
  }

  stop(): void {
    if (this.timer !== undefined) this.deps.clearTimer(this.timer);
    this.timer = undefined;
  }
}

export function loadSchedules(file: string, now: number): SchedulesDoc {
  try {
    return parseSchedules(fs.readFileSync(file, 'utf8'), now);
  } catch {
    return { pausedAll: false, schedules: [] };
  }
}

export function saveSchedules(file: string, doc: SchedulesDoc): void {
  try {
    fs.writeFileSync(file, JSON.stringify(doc, null, 2), { mode: 0o600 });
  } catch {
    /* not saved; the next change tries again */
  }
}

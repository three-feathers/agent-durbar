/**
 * Scheduled prompts (spec 044): per-folder schedules that send a prompt to the folder's agent (or one session, Phase 2 FR-014)
 * once, every N minutes or on a calendar rule (FR-012), only while the app runs. The core is pure (an injected clock, timer, busy check and sender) and unit-tested with a fake clock.
 * Stored as `durbar-schedules.json` in the user-data folder; the prompt text is kept there (it must be sent) and never logged.
 */
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { localTime, nextRuleRun, parseRule } from '../shared/schedrules';
import type { CalendarRule } from '../shared/schedrules';

export type Outcome = 'sent' | 'skipped-busy' | 'skipped-paused' | 'skipped-cap' | 'skipped-ended' | 'missed' | 'failed';
export type CapUnit = 'aiu' | 'usd';
/** FR-014: one session instead of the folder's agent. `name` is display only. */
export interface ScheduleTarget {
  session: string;
  agent: string;
  name?: string;
}
/** FR-015: the schedule's own spending limit, in the unit of the target's agent app. */
export interface ScheduleCap {
  amount: number;
  unit: CapUnit;
}
export interface Schedule {
  id: string;
  folder: string;
  prompt: string;
  /** Every N minutes (5..1440), or */
  every?: number;
  /** once at this time (epoch ms). With `every`: the first run, and the runs keep that time of day (spec 044 FR-007, e.g. every day at 08:30). */
  at?: number;
  /** FR-012: a calendar rule (every day, weekdays, weekly on days) at a local time; the next run comes from `nextRuleRun`. */
  rule?: CalendarRule;
  /** Next run of an interval or rule schedule (epoch ms). */
  next?: number;
  paused?: boolean;
  /** Why main paused it (FR-014, FR-015); only with `paused`. Never taken from the renderer. */
  pausedReason?: 'cap' | 'session-ended';
  done?: boolean;
  last?: { at: number; outcome: Outcome };
  target?: ScheduleTarget;
  cap?: ScheduleCap;
  /** What this schedule's runs spent, in `cap.unit`, since it was created or resumed after reaching its limit. Kept by main. */
  spent?: number;
  /** A usage event of one of its runs had no figure in the cap's unit: `spent` is a lower bound. */
  spentUnknown?: boolean;
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
const OUTCOMES: Outcome[] = ['sent', 'skipped-busy', 'skipped-paused', 'skipped-cap', 'skipped-ended', 'missed', 'failed'];
const ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const AGENT_RE = /^[A-Za-z0-9._-]{1,32}$/;
/** FR-017: cap ranges per unit (AI credits, dollars). */
export const CAP_RANGE: Record<CapUnit, [number, number]> = { aiu: [0.01, 1_000_000], usd: [0.01, 10_000] };

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** FR-007: the next run of an anchored interval after `now`: anchor + k * every, the smallest one that is later than now. */
export function alignedNext(anchor: number, everyMin: number, now: number): number {
  const step = everyMin * MIN;
  if (anchor > now) return anchor;
  return anchor + (Math.floor((now - anchor) / step) + 1) * step;
}

/** A schedule that runs more than once: an interval or a calendar rule. */
export const recurring = (s: Schedule): boolean => s.every !== undefined || s.rule !== undefined;

/** When a recurring schedule runs again after `now`: rules at their next local time (FR-012), anchored intervals keep their time of day, others count from now. */
const nextAfter = (s: Schedule, now: number): number =>
  s.rule ? nextRuleRun(s.rule, now) ?? now + 1440 * MIN : s.at !== undefined && s.every !== undefined ? alignedNext(s.at, s.every, now) : now + (s.every as number) * MIN;

/** A cap amount in a unit's range, rounded to cents; undefined otherwise. */
export function parseCapAmount(unit: CapUnit, v: unknown): number | undefined {
  const n = num(v);
  const [lo, hi] = CAP_RANGE[unit];
  if (n === undefined || n < lo || n > hi) return undefined;
  return Math.round(n * 100) / 100;
}

/** FR-014: a target from untrusted input; undefined when it is not valid. */
function cleanTarget(v: unknown): ScheduleTarget | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  if (typeof r.session !== 'string' || !ID_RE.test(r.session) || typeof r.agent !== 'string' || !AGENT_RE.test(r.agent)) return undefined;
  const t: ScheduleTarget = { session: r.session, agent: r.agent };
  // eslint-disable-next-line no-control-regex
  const name = typeof r.name === 'string' ? r.name.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim().slice(0, 80) : '';
  if (name) t.name = name;
  return t;
}

/** FR-015: a cap from untrusted input; undefined when it is not valid. */
function cleanCap(v: unknown): ScheduleCap | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  if (r.unit !== 'aiu' && r.unit !== 'usd') return undefined;
  const amount = parseCapAmount(r.unit, r.amount);
  return amount === undefined ? undefined : { amount, unit: r.unit };
}

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
  let rule = r.rule === undefined ? undefined : parseRule(r.rule);
  if (r.rule !== undefined && !rule) return undefined; // a bad rule drops the schedule, like a bad interval
  if (!rule && every === 1440 && at !== undefined && at > 0) rule = { kind: 'daily', time: localTime(at) }; // FR-013: an old "every day at" becomes a rule (no DST drift)
  if (rule) {
    s.rule = rule;
    const next = num(r.next);
    s.next = next !== undefined && next > 0 ? next : nextRuleRun(rule, now);
    if (s.next === undefined) return undefined;
  } else if (every !== undefined) {
    if (!Number.isInteger(every) || every < MIN_EVERY || every > MAX_EVERY) return undefined;
    s.every = every;
    if (at !== undefined && at > 0) s.at = at; // anchored (FR-007)
    const next = num(r.next);
    s.next = next !== undefined && next > 0 ? next : s.at !== undefined ? alignedNext(s.at, every, now - 1) : now + every * MIN;
  } else if (at !== undefined && at > 0) s.at = at;
  else return undefined;
  if (r.paused === true) s.paused = true;
  if (s.paused && (r.pausedReason === 'cap' || r.pausedReason === 'session-ended')) s.pausedReason = r.pausedReason;
  if (r.done === true) s.done = true;
  const last = r.last as Record<string, unknown> | undefined;
  if (last && typeof last === 'object' && num(last.at) !== undefined && OUTCOMES.includes(last.outcome as Outcome)) s.last = { at: last.at as number, outcome: last.outcome as Outcome };
  // Phase 2 fields: optional; present but not valid drops the schedule (never silently sent elsewhere or without its limit)
  if (r.target !== undefined && r.target !== null) {
    const t = cleanTarget(r.target);
    if (!t) return undefined;
    s.target = t;
  }
  if (r.cap !== undefined && r.cap !== null) {
    const c = cleanCap(r.cap);
    if (!c) return undefined;
    s.cap = c;
    const spent = num(r.spent);
    if (spent !== undefined && spent > 0) s.spent = spent;
    if (r.spentUnknown === true) s.spentUnknown = true;
  }
  return s;
}

/** FR-023: the candidate of an edit: main's copy for what the form does not edit, the input for the rest. `done` is cleared. */
function editCandidate(input: Record<string, unknown>, prev: Schedule): Record<string, unknown> {
  return {
    id: prev.id,
    folder: prev.folder,
    paused: prev.paused,
    pausedReason: prev.pausedReason,
    prompt: input.prompt,
    every: input.every,
    // an interval edit that keeps `every` and sends no time keeps its anchor (FR-007)
    at: input.at === undefined && input.rule === undefined && prev.every !== undefined && num(input.every) === prev.every ? prev.at : input.at,
    rule: input.rule,
    target: input.target,
    // a limit is dropped only by an explicit `cap: null`; no key keeps it (and its spend, below)
    cap: input.cap === undefined ? prev.cap : input.cap,
  };
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
  return recurring(s) ? s.next : s.at;
}

/**
 * Spec 044 busy rule with spec 068 FR-008: the schedule's session (or, without one, any session in its folder) is busy when its last
 * status is working or waiting for permission (`busy`) or it is on a coffee break (`breaks.onBreak`: a usage limit or Durbar's cap).
 * A busy run is skipped and recorded as busy, never queued. Main's `scheduleDeps().isBusy` is this function.
 */
export function scheduleBusy(
  folder: string,
  session: string | undefined,
  d: { sessions(): Iterable<{ id: string; folder: string }>; busy(id: string): boolean; breaks: { onBreak(id: string): boolean } },
): boolean {
  const b = (id: string): boolean => d.busy(id) || d.breaks.onBreak(id);
  if (session) return b(session);
  for (const x of d.sessions()) if (x.folder === folder && b(x.id)) return true;
  return false;
}

export interface SchedulerDeps {
  now(): number;
  /** The folder's agent (or, with `session`, that session) is working or waiting for the user. */
  isBusy(folder: string, session?: string): boolean;
  /** Sends the prompt to the folder's agent or the schedule's target; false when it could not, else true or the session id it went to (for FR-015 attribution). */
  send(folder: string, prompt: string, s: Schedule): Promise<boolean | string>;
  /** FR-014: the session still exists. */
  hasSession(session: string): boolean;
  /** FR-015: the cap unit of the agent app that would run the schedule, or undefined when it reports no spending in a unit. */
  capUnitOf(s: Schedule): CapUnit | undefined;
  setTimer(ms: number, fn: () => void): unknown;
  clearTimer(t: unknown): void;
  save(doc: SchedulesDoc): void;
  /** After any change (for the renderer). */
  changed?(doc: SchedulesDoc): void;
}

export class Scheduler {
  private timer: unknown;
  private running = false;
  /** FR-015: session id -> the schedule whose run is in progress there (until the turn ends). Not saved. */
  private attrib = new Map<string, string>();
  constructor(public doc: SchedulesDoc, private readonly deps: SchedulerDeps) {}

  /** At start: once-schedules that are past are `missed`; intervals continue from now, anchored ones at their next time of day (missed runs are not caught up). */
  start(): void {
    const now = this.deps.now();
    for (const s of this.doc.schedules) {
      if (s.done || s.paused) continue;
      if (s.at !== undefined && s.every === undefined && s.at < now - 30_000) {
        s.done = true;
        s.last = { at: now, outcome: 'missed' };
      } else if (recurring(s) && (s.next ?? 0) < now - 30_000) {
        s.next = nextAfter(s, now);
        s.last = { at: now, outcome: 'missed' };
      }
    }
    this.pauseEnded();
    this.commit();
  }

  /** FR-014: a schedule whose session is gone pauses (never sent elsewhere); true when one changed. */
  private pauseEnded(): boolean {
    let changed = false;
    for (const s of this.doc.schedules) {
      if (s.done || s.paused || !s.target || this.deps.hasSession(s.target.session)) continue;
      s.paused = true;
      s.pausedReason = 'session-ended';
      changed = true;
    }
    return changed;
  }

  /** After a session was removed or replaced (main): pause the schedules that targeted it. */
  sessionsChanged(): void {
    if (this.pauseEnded()) this.commit();
  }

  /** FR-015: a `usage` event of a session; counted toward the schedule whose run is in progress there. */
  noteUsage(session: string, e: { nanoAiu?: number; costUsd?: number }): void {
    const id = this.attrib.get(session);
    const s = id ? this.doc.schedules.find((x) => x.id === id) : undefined;
    if (!s?.cap) return;
    const raw = s.cap.unit === 'usd' ? e.costUsd : e.nanoAiu !== undefined ? e.nanoAiu / 1e9 : undefined;
    const amount = num(raw);
    if (amount === undefined || amount < 0) s.spentUnknown = true;
    else s.spent = (s.spent ?? 0) + amount;
    this.commit();
  }

  /** FR-015: the session's turn ended (idle, error or stopped): later usage there is no longer the schedule's. */
  turnEnded(session: string): void {
    this.attrib.delete(session);
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
        else if (s.target && !this.deps.hasSession(s.target.session)) outcome = 'skipped-ended';
        else if (s.cap && (s.spent ?? 0) >= s.cap.amount) outcome = 'skipped-cap';
        else if (this.deps.isBusy(s.folder, s.target?.session)) outcome = 'skipped-busy';
        else {
          const r = await this.deps.send(s.folder, s.prompt, s).catch(() => false);
          outcome = r ? 'sent' : 'failed';
          if (typeof r === 'string' && r) this.attrib.set(r, s.id);
        }
        s.last = { at: now, outcome };
        if (outcome === 'skipped-ended' || outcome === 'skipped-cap') {
          // FR-014 / FR-015: paused with a clear reason; the run is not sent, and a once-schedule stays to be resumed or deleted
          s.paused = true;
          s.pausedReason = outcome === 'skipped-cap' ? 'cap' : 'session-ended';
        } else if (recurring(s)) s.next = nextAfter(s, now);
        else s.done = true;
      }
    } finally {
      this.running = false;
      this.commit();
    }
  }

  /**
   * Spec 052 FR-089: **Run missed now**: the user asks for one run of this schedule, now. It goes through the same `send`
   * as a scheduled run and records its outcome; the next planned run (or a one-time schedule's done flag) is unchanged.
   * Refused, with a reason and nothing sent, when Pause all is on, the schedule is paused, its session ended, its limit is
   * reached, the agent is busy or another run is in progress.
   */
  async runNow(id: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
    const s = typeof id === 'string' ? this.doc.schedules.find((x) => x.id === id) : undefined;
    if (!s) return { ok: false, error: 'That schedule is gone.' };
    if (this.running) return { ok: false, error: 'A scheduled run is going out. Try again in a moment.' };
    if (this.doc.pausedAll) return { ok: false, error: 'Schedules are paused (Pause all). Resume them first.' };
    if (s.paused) return { ok: false, error: 'This schedule is paused. Resume it first.' };
    if (s.target && !this.deps.hasSession(s.target.session)) return { ok: false, error: 'That session has ended.' };
    if (s.cap && (s.spent ?? 0) >= s.cap.amount) return { ok: false, error: 'This schedule has reached its limit.' };
    if (this.deps.isBusy(s.folder, s.target?.session)) return { ok: false, error: 'The agent is busy. Try again when it is free.' };
    this.running = true;
    let r: boolean | string = false;
    try {
      r = await this.deps.send(s.folder, s.prompt, s).catch(() => false);
      if (typeof r === 'string' && r) this.attrib.set(r, s.id);
      s.last = { at: this.deps.now(), outcome: r ? 'sent' : 'failed' };
    } finally {
      this.running = false;
      this.commit();
    }
    return r ? { ok: true } : { ok: false, error: 'Could not send it.' };
  }

  /** Adds or replaces a schedule (validated); returns it, or an error. */
  save(input: unknown, folderExists: (f: string) => boolean): { ok: true; schedule: Schedule } | { ok: false; error: string } {
    const now = this.deps.now();
    if (!input || typeof input !== 'object') return { ok: false, error: 'A schedule needs a prompt and either a time, an interval of 5 to 1440 minutes or a calendar rule.' };
    // FR-023: a save that carries an id main does not have is refused (it never brings a deleted schedule back)
    const rawId = (input as { id?: unknown }).id;
    const edit = (input as { edit?: unknown }).edit === true;
    const prev = rawId === undefined || rawId === null ? undefined : this.doc.schedules.find((x) => x.id === rawId);
    if ((rawId !== undefined && rawId !== null && !prev) || (edit && !prev)) return { ok: false, error: 'That schedule is gone.' };
    // FR-017: what main keeps itself is never taken from the renderer
    const s = cleanSchedule(edit && prev ? editCandidate(input as Record<string, unknown>, prev) : { ...(input as object), next: undefined, spent: undefined, spentUnknown: undefined, pausedReason: undefined }, now);
    if (!s) return { ok: false, error: 'A schedule needs a prompt and either a time, an interval of 5 to 1440 minutes or a calendar rule. A limit must be a positive amount.' };
    // a save of an existing schedule that is not an edit (Pause, Resume, "Use the folder's agent") never moves it to another folder or revives a done one
    if (!edit && prev) {
      s.folder = prev.folder;
      if (prev.done) s.done = true;
      else delete s.done;
    }
    if (!folderExists(s.folder)) return { ok: false, error: 'Unknown folder.' };
    if (edit && prev) {
      // FR-023: an edit may change the time of a paused schedule only to the future, and a done one only to run again
      if (s.at !== undefined && !recurring(s) && s.at < now && (prev.done || recurring(prev) || s.at !== prev.at)) return { ok: false, error: prev.done ? 'Pick a time in the future to run it again.' : 'That time has already passed.' };
    } else if (s.at !== undefined && !recurring(s) && s.at < now && !s.paused) return { ok: false, error: 'That time has already passed.' };
    const i = this.doc.schedules.findIndex((x) => x.id === s.id);
    const old = i >= 0 ? this.doc.schedules[i] : undefined;
    if (!old && this.doc.schedules.length >= MAX_SCHEDULES) return { ok: false, error: `At most ${MAX_SCHEDULES} schedules.` };
    if (s.target && !s.paused && !this.deps.hasSession(s.target.session)) return { ok: false, error: "That session has ended. Send it to the folder's agent instead." };
    // an edit that carries its limit over unchanged needs no unit now (the agent may be gone or report no cost); a new or changed one does
    // ... but only while the target is unchanged: a limit moved to another agent is checked like a new one
    const tkey = (t?: ScheduleTarget): string => (t?.session ?? '') + '|' + (t?.agent ?? '');
    const targetChanged = edit && !!prev && tkey(prev.target) !== tkey(s.target);
    const capSame = edit && !!prev?.cap && !!s.cap && s.cap.amount === prev.cap.amount && s.cap.unit === prev.cap.unit;
    if (s.cap && !(capSame && !targetChanged)) {
      const unit = this.deps.capUnitOf(s);
      if (!unit) return { ok: false, error: 'This agent app does not report what a run costs, so a limit cannot be kept.' };
      if (unit !== s.cap.unit && capSame) return { ok: false, error: `This agent app counts in ${unit === 'usd' ? 'dollars' : 'AI credits'}, not ${s.cap.unit === 'usd' ? 'dollars' : 'AI credits'}: set the limit again.` };
      if (unit !== s.cap.unit) {
        const amount = parseCapAmount(unit, s.cap.amount);
        if (amount === undefined) return { ok: false, error: 'That limit is out of range.' };
        s.cap = { amount, unit };
      }
    }
    if (old) {
      if (old.last) s.last = old.last;
      if (s.cap && old.cap && old.cap.unit === s.cap.unit) {
        if (old.spent) s.spent = old.spent;
        if (old.spentUnknown) s.spentUnknown = true;
      }
      // an edit that moves a schedule whose session ended to another target clears the reason; it stays paused, so the row offers Resume
      const retargeted = edit && old.pausedReason === 'session-ended' && targetChanged;
      // an edit that removes the limit, or raises it above what was spent, clears the reason "reached its limit"; it stays paused, so the row offers Resume
      const capFreed = edit && old.pausedReason === 'cap' && (!s.cap || s.cap.amount > (old.cap && old.cap.unit === s.cap.unit ? old.spent ?? 0 : 0));
      if (s.paused && old.paused && old.pausedReason && !retargeted && !capFreed) s.pausedReason = old.pausedReason;
      else if (retargeted || capFreed) delete s.pausedReason;
      if (!s.paused && old.pausedReason === 'cap') {
        delete s.spent; // FR-015: Resume after the limit starts counting again from zero
        delete s.spentUnknown;
      }
      if (!edit && s.paused && old.paused && old.next !== undefined && recurring(s) && recurring(old)) s.next = old.next;
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
      for (const s of this.doc.schedules) if (recurring(s) && !s.done && !s.paused && (s.next ?? 0) < now) s.next = nextAfter(s, now);
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

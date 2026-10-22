/**
 * Scheduled prompts (spec 044): per-folder schedules that send a prompt to the folder's agent (or one session, Phase 2 FR-014)
 * once, every N minutes or on a calendar rule (FR-012), only while the app runs. The core is pure (an injected clock, timer, busy check and sender) and unit-tested with a fake clock.
 * Stored as `durbar-schedules.json` in the user-data folder; the prompt text is kept there (it must be sent) and never logged.
 */
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { localTime, nextRuleRun, parseRule } from '../shared/schedrules';
import type { CalendarRule } from '../shared/schedrules';
import { LOOP_MAX_DELAY, LOOP_MAX_HOURS, LOOP_MAX_PASSES, LOOP_MIN_DELAY, clampPace, cleanReason, oneLine, parsePace } from '../shared/looppace';

export type Outcome = 'sent' | 'skipped-busy' | 'skipped-paused' | 'skipped-cap' | 'skipped-ended' | 'missed' | 'failed' | 'held' | 'ended';
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
/** Spec 072 FR-002: why a loop ended. The text is what the row shows (it holds the agent's cleaned reason for `agent`). */
export type LoopEndReason = 'user' | 'agent' | 'session' | 'limit' | 'passes' | 'time' | 'no-pace' | 'errors' | 'app-closed';
export interface LoopEnd {
  at: number;
  reason: LoopEndReason;
  text: string;
}
/** Why a running loop waits: Pause all, a person (permission, question, credit-limit request), a coffee break (spec 068). Not saved. */
export type LoopHold = 'pause-all' | 'person' | 'break';
/** What `waitOf` reports for a session; `cap` is Durbar's own spending cap (spec 011), which pauses the loop until Resume (Q5). */
export type LoopWait = 'person' | 'break' | 'cap';
/** Spec 072 FR-002: a loop is a schedule with this field. The limits come from the user; the rest is kept by main and never taken from the renderer. */
export interface LoopSpec {
  minDelay: number;
  maxDelay: number;
  defaultDelay: number;
  maxPasses: number;
  /** Epoch ms; at most 24 h after `startedAt`. */
  endAt: number;
  startedAt?: number;
  passes?: number;
  /** A pass was sent and its turn has not ended. Not saved. */
  inPass?: boolean;
  lastAsk?: { minutes: number; reason: string; source: 'agent' | 'default' | 'clamped'; asked?: number };
  /** Passes in a row with no pace request (Q3), and failed passes in a row (FR-013). */
  noPaceStreak?: number;
  errorStreak?: number;
  hold?: LoopHold;
  ended?: LoopEnd;
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
  /** Spec 072: a self-paced loop on `target`'s session. No `every`, `at` or `rule`; `next` is set by main at the end of each pass. */
  loop?: LoopSpec;
}
export interface SchedulesDoc {
  pausedAll: boolean;
  schedules: Schedule[];
}

/**
 * Spec 072: `save` refuses a `loop` until main wires it (T006: the loop footer in `send`, `turnEnded` with the pass result, `waitOf`).
 * T006 sets `enabled` to true; without that wiring a loop would run with no pace line and no holds.
 */
export const loopSupport = { enabled: false };
export const MAX_SCHEDULES = 50;
export const MAX_PROMPT = 2000;
export const MIN_EVERY = 5;
export const MAX_EVERY = 1440;
const MIN = 60_000;
const OUTCOMES: Outcome[] = ['sent', 'skipped-busy', 'skipped-paused', 'skipped-cap', 'skipped-ended', 'missed', 'failed', 'held', 'ended'];
const END_REASONS: LoopEndReason[] = ['user', 'agent', 'session', 'limit', 'passes', 'time', 'no-pace', 'errors', 'app-closed'];
const LASTASK_SOURCES = ['agent', 'default', 'clamped'];
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

const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) ? v : undefined);
const count = (v: unknown): number | undefined => (int(v) !== undefined && (v as number) >= 0 && (v as number) <= 1_000_000 ? (v as number) : undefined);

/** Spec 072 FR-003: the limits of a loop (FR-003 ranges; `endAt` is checked against the clock in `save`). */
function cleanLoopLimits(r: Record<string, unknown>): LoopSpec | undefined {
  const minDelay = int(r.minDelay);
  const maxDelay = int(r.maxDelay);
  const defaultDelay = int(r.defaultDelay);
  const maxPasses = int(r.maxPasses);
  const endAt = num(r.endAt);
  if (minDelay === undefined || maxDelay === undefined || defaultDelay === undefined || maxPasses === undefined || endAt === undefined) return undefined;
  if (minDelay < LOOP_MIN_DELAY || maxDelay > LOOP_MAX_DELAY || defaultDelay < minDelay || defaultDelay > maxDelay) return undefined;
  if (maxPasses < 1 || maxPasses > LOOP_MAX_PASSES || endAt <= 0) return undefined;
  return { minDelay, maxDelay, defaultDelay, maxPasses, endAt };
}

/** A loop from the file: the limits plus main's own state (never `inPass` or `hold`). Undefined when not valid. */
function cleanLoop(v: unknown): LoopSpec | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const l = cleanLoopLimits(r);
  if (!l) return undefined;
  const startedAt = num(r.startedAt);
  if (startedAt !== undefined && startedAt > 0) l.startedAt = startedAt;
  l.passes = Math.min(count(r.passes) ?? 0, l.maxPasses);
  const a = r.lastAsk as Record<string, unknown> | undefined;
  if (a && typeof a === 'object' && num(a.minutes) !== undefined && LASTASK_SOURCES.includes(a.source as string)) {
    l.lastAsk = { minutes: Math.min(l.maxDelay, Math.max(l.minDelay, Math.round(a.minutes as number))), reason: cleanReason(a.reason) ?? '', source: a.source as 'agent' | 'default' | 'clamped' };
    if (num(a.asked) !== undefined) l.lastAsk.asked = a.asked as number;
  }
  if (count(r.noPaceStreak)) l.noPaceStreak = r.noPaceStreak as number;
  if (count(r.errorStreak)) l.errorStreak = r.errorStreak as number;
  const e = r.ended as Record<string, unknown> | undefined;
  if (e && typeof e === 'object' && num(e.at) !== undefined && END_REASONS.includes(e.reason as LoopEndReason)) {
    const text = typeof e.text === 'string' ? oneLine(e.text).slice(0, 200) : '';
    l.ended = { at: e.at as number, reason: e.reason as LoopEndReason, text };
  }
  return l;
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
  if (r.loop !== undefined && r.loop !== null) {
    // spec 072 FR-001/FR-004: a loop needs a session target, has no interval, time or rule, and its limits must be valid
    if (every !== undefined || at !== undefined || r.rule !== undefined || r.target === undefined || r.target === null) return undefined;
    const l = cleanLoop(r.loop);
    if (!l) return undefined;
    s.loop = l;
    const next = num(r.next);
    if (next !== undefined && next > 0 && !l.ended) s.next = next;
  }
  if (!rule && every === 1440 && at !== undefined && at > 0) rule = { kind: 'daily', time: localTime(at) }; // FR-013: an old "every day at" becomes a rule (no DST drift)
  if (s.loop) {
    // limits and state are set above
  } else if (rule) {
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

/** Spec 072 FR-002: of a loop from the renderer only the user's limits are kept; passes, streaks, asks, hold and end are main's. */
function limitsOf(v: unknown): unknown {
  if (!v || typeof v !== 'object') return v;
  const r = v as Record<string, unknown>;
  return { minDelay: r.minDelay, maxDelay: r.maxDelay, defaultDelay: r.defaultDelay, maxPasses: r.maxPasses, endAt: r.endAt };
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
    loop: limitsOf(input.loop),
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
  if (s.loop) return s.loop.ended || s.loop.inPass || s.loop.hold ? undefined : s.next; // spec 072 FR-004
  return recurring(s) ? s.next : s.at;
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
  /** A monotonic clock in ms (default `performance.now`); a loop never sends two passes closer than its minimum on it, whatever the wall clock does. */
  mono?(): number;
  setTimer(ms: number, fn: () => void): unknown;
  clearTimer(t: unknown): void;
  save(doc: SchedulesDoc): void;
  /** Spec 072 FR-015..FR-017: why the session cannot take a loop pass now: a person is needed, a coffee break, or Durbar's spending cap; undefined when nothing waits. */
  waitOf?(session: string): LoopWait | undefined;
  /** After any change (for the renderer). */
  changed?(doc: SchedulesDoc): void;
}

export class Scheduler {
  private timer: unknown;
  private running = false;
  /** FR-015: session id -> the schedule whose run is in progress there (until the turn ends). Not saved. */
  private attrib = new Map<string, string>();
  /** Spec 072: loop id -> monotonic stamp of its last pass sent. Memory only (loops end when the app restarts). */
  private lastSent = new Map<string, number>();
  constructor(public doc: SchedulesDoc, private readonly deps: SchedulerDeps) {}

  /** At start: once-schedules that are past are `missed`; intervals continue from now, anchored ones at their next time of day (missed runs are not caught up). */
  start(): void {
    const now = this.deps.now();
    for (const s of this.doc.schedules) {
      // spec 072 FR-008: a loop is never resumed by itself after a restart; nothing is sent
      if (s.loop) {
        if (!s.loop.ended) this.endLoop(s, 'app-closed', now);
        continue;
      }
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
      if (s.loop) {
        // spec 072: a loop whose session is gone ends (it is never moved to another session)
        if (!s.loop.ended && !this.deps.hasSession(s.target?.session ?? '')) {
          this.endLoop(s, 'session', this.deps.now());
          changed = true;
        }
        continue;
      }
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

  /**
   * FR-015: the session's turn ended (idle, error or stopped): later usage there is no longer the schedule's.
   * Spec 072: for a loop whose pass is in progress this is the end of the pass. `end` carries what main collected: the last final
   * assistant message of the pass (`finalText`, read for the `LOOP:` line), or `error` / `stopped` for how the turn ended.
   */
  turnEnded(session: string, end?: { finalText?: string; error?: boolean; stopped?: boolean }): void {
    this.attrib.delete(session);
    const s = this.doc.schedules.find((x) => x.loop?.inPass && !x.loop.ended && x.target?.session === session);
    if (!s?.loop) return;
    this.passEnded(s, end ?? {}, this.deps.now());
    this.commit();
  }

  private mono(): number {
    return this.deps.mono ? this.deps.mono() : performance.now();
  }

  private lastDelay(l: LoopSpec): number {
    return Math.min(l.maxDelay, Math.max(l.minDelay, l.lastAsk?.minutes ?? l.defaultDelay)); // the limits may have been edited since the ask
  }

  private endLoop(s: Schedule, reason: LoopEndReason, now: number, detail?: string): void {
    const l = s.loop as LoopSpec;
    const text: Record<LoopEndReason, string> = {
      user: 'Stopped by you',
      agent: 'Stopped by the agent' + (detail ? `: ${detail}` : ''),
      session: 'Stopped: the session has ended',
      limit: 'Stopped: reached its limit',
      passes: 'Stopped: reached its last pass',
      time: 'Stopped: reached its end time',
      'no-pace': 'Stopped: the agent did not pace the loop',
      errors: 'Stopped after two failed passes',
      'app-closed': 'Ended when Durbar closed',
    };
    l.ended = { at: now, reason, text: text[reason] };
    l.inPass = false;
    delete l.hold;
    delete s.next;
    s.last = { at: now, outcome: 'ended' };
    if (s.target && this.attrib.get(s.target.session) === s.id) this.attrib.delete(s.target.session);
  }

  /** FR-012/FR-013/FR-018: the loop's own limits, checked at a wake and at the end of a pass; the loop ends when one is reached. */
  private limitReached(s: Schedule, now: number): boolean {
    const l = s.loop as LoopSpec;
    if (s.cap && (s.spent ?? 0) >= s.cap.amount) this.endLoop(s, 'limit', now);
    else if ((l.passes ?? 0) >= l.maxPasses) this.endLoop(s, 'passes', now);
    else if (now >= l.endAt) this.endLoop(s, 'time', now);
    else return false;
    return true;
  }

  /**
   * FR-015..FR-019: puts a waiting loop on hold (Pause all, a person, a coffee break), pauses it at Durbar's cap (Q5: needs Resume),
   * or releases a hold: the next wake is then now + the last asked delay, never at once. True when something changed.
   */
  private settle(s: Schedule, now: number): boolean {
    const l = s.loop;
    if (!l || l.ended || l.inPass || s.paused || !s.target) return false;
    const want: LoopHold | 'cap' | undefined = this.doc.pausedAll ? 'pause-all' : this.deps.waitOf?.(s.target.session);
    if (want === 'cap') {
      s.paused = true;
      s.pausedReason = 'cap';
      delete l.hold;
      return true;
    }
    if (want) {
      if (l.hold === want) return false;
      l.hold = want;
      return true;
    }
    if (!l.hold) return false;
    delete l.hold;
    s.next = now + this.lastDelay(l) * MIN;
    return true;
  }

  /** Main calls this when a session's waits start or clear (a permission, a question, a limit request, a coffee break, Durbar's cap). */
  holdsChanged(session: string): void {
    const now = this.deps.now();
    let changed = false;
    for (const s of this.doc.schedules) if (s.loop && s.target?.session === session && this.settle(s, now)) changed = true;
    if (changed) this.commit();
  }

  /** The end of a loop pass (FR-010..FR-013, FR-018): reads the pace request and sets the next wake or ends the loop. */
  private passEnded(s: Schedule, end: { finalText?: string; error?: boolean; stopped?: boolean }, now: number): void {
    const l = s.loop as LoopSpec;
    l.inPass = false;
    if (end.stopped) return this.endLoop(s, 'user', now);
    let delay = l.defaultDelay;
    if (end.error) {
      l.errorStreak = (l.errorStreak ?? 0) + 1; // an error pass neither adds to nor resets the no-line streak (FR-012)
      l.lastAsk = { minutes: delay, reason: 'the pass failed', source: 'default' };
      if (l.errorStreak >= 2) return this.endLoop(s, 'errors', now);
    } else {
      l.errorStreak = 0;
      const p = parsePace(end.finalText);
      if (p?.kind === 'stop') return this.endLoop(s, 'agent', now, p.reason);
      if (p?.kind === 'next') {
        l.noPaceStreak = 0;
        const c = clampPace(p.minutes, l);
        delay = c.minutes;
        l.lastAsk = { minutes: delay, reason: p.reason ?? '', source: c.source };
        if (c.source === 'clamped') l.lastAsk.asked = p.minutes;
      } else {
        l.noPaceStreak = (l.noPaceStreak ?? 0) + 1;
        l.lastAsk = { minutes: delay, reason: 'the agent did not say', source: 'default' };
        if (l.noPaceStreak >= 2) return this.endLoop(s, 'no-pace', now);
      }
    }
    s.next = now + delay * MIN;
    s.last = { at: now, outcome: end.error ? 'failed' : 'sent' };
    // a wake after the end time would never be sent: end now. Passes and the loop's cap are checked with the same clock.
    if (this.limitReached(s, now) || s.next >= l.endAt) {
      if (!l.ended) this.endLoop(s, 'time', now);
      return;
    }
    this.settle(s, now);
  }

  /** One loop that is due (spec 072 FR-014..FR-019). The order: Pause all, session ended, the loop's limits, a wait (hold), busy (skip, never queued), send. */
  private async tickLoop(s: Schedule, now: number): Promise<void> {
    const l = s.loop as LoopSpec;
    const session = (s.target as ScheduleTarget).session;
    if (this.doc.pausedAll) {
      l.hold = 'pause-all';
      s.last = { at: now, outcome: 'skipped-paused' };
      return;
    }
    if (!this.deps.hasSession(session)) return this.endLoop(s, 'session', now);
    if (this.limitReached(s, now)) return;
    if (this.settle(s, now)) {
      s.last = { at: now, outcome: 'held' };
      return;
    }
    if (this.deps.isBusy(s.folder, session)) {
      s.last = { at: now, outcome: 'skipped-busy' };
      s.next = now + this.lastDelay(l) * MIN; // FR-014: not a pass, not queued
      return;
    }
    // the wall clock can jump forward; the monotonic clock cannot, and it holds the minimum between two passes
    const mono = this.mono();
    const since = this.lastSent.get(s.id);
    if (since !== undefined && mono - since < l.minDelay * MIN) {
      s.next = now + (l.minDelay * MIN - (mono - since));
      return;
    }
    this.lastSent.set(s.id, mono);
    l.inPass = true;
    l.passes = (l.passes ?? 0) + 1;
    delete s.next;
    this.attrib.set(session, s.id);
    const r = await this.deps.send(s.folder, s.prompt, s).catch(() => false);
    const after = this.deps.now();
    if (r) {
      if (!l.ended) s.last = { at: now, outcome: 'sent' };
      return;
    }
    // the pass could not be sent: it counts as a failed pass (FR-013), unless its turn already ended while send was awaited
    if (!l.inPass) return;
    this.attrib.delete(session);
    this.passEnded(s, { error: true }, after);
    s.last = { at: now, outcome: l.ended ? 'ended' : 'failed' };
  }

  /** FR-007: ends a running loop at once. False when there is none with that id. */
  stopLoop(id: unknown, reason: 'user' | 'session' = 'user'): boolean {
    const s = typeof id === 'string' ? this.doc.schedules.find((x) => x.id === id) : undefined;
    if (!s?.loop || s.loop.ended) return false;
    this.endLoop(s, reason, this.deps.now());
    this.commit();
    return true;
  }

  /** FR-007: End session, Stop during a pass: ends the running loop of that session. */
  stopLoopFor(session: string, reason: 'user' | 'session' = 'user'): boolean {
    let any = false;
    for (const s of this.doc.schedules) if (s.loop && !s.loop.ended && s.target?.session === session) (this.endLoop(s, reason, this.deps.now()), (any = true));
    if (any) this.commit();
    return any;
  }

  /** FR-008: **Start again**: a new run with the old limits; passes and spend from zero. The end time moves by the same span. */
  restartLoop(id: unknown): { ok: true } | { ok: false; error: string } {
    const s = typeof id === 'string' ? this.doc.schedules.find((x) => x.id === id) : undefined;
    const l = s?.loop;
    if (!s || !l) return { ok: false, error: 'That loop is gone.' };
    if (!l.ended) return { ok: false, error: 'That loop is still running.' };
    const session = s.target?.session ?? '';
    if (!this.deps.hasSession(session)) return { ok: false, error: 'That session has ended.' };
    if (this.doc.schedules.some((x) => x.id !== s.id && x.loop && !x.loop.ended && x.target?.session === session)) return { ok: false, error: 'That session already has a loop.' };
    const now = this.deps.now();
    const span = Math.min(Math.max(l.endAt - (l.startedAt ?? l.endAt - 8 * 3_600_000), 60_000), LOOP_MAX_HOURS * 3_600_000);
    l.startedAt = now;
    l.endAt = now + span;
    l.passes = 0;
    l.noPaceStreak = 0;
    l.errorStreak = 0;
    delete l.lastAsk;
    delete l.ended;
    delete l.hold;
    l.inPass = false;
    this.lastSent.delete(s.id);
    delete s.spent;
    delete s.spentUnknown;
    delete s.paused;
    delete s.pausedReason;
    s.next = now;
    this.commit();
    return { ok: true };
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
        if (s.loop) {
          await this.tickLoop(s, now);
          continue;
        }
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
    if (s.loop) return { ok: false, error: 'A loop sends its own passes.' };
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
    if ((input as { loop?: unknown }).loop !== undefined && (input as { loop?: unknown }).loop !== null && !loopSupport.enabled) return { ok: false, error: 'Loops are not available yet.' };
    const prev = rawId === undefined || rawId === null ? undefined : this.doc.schedules.find((x) => x.id === rawId);
    if ((rawId !== undefined && rawId !== null && !prev) || (edit && !prev)) return { ok: false, error: 'That schedule is gone.' };
    // FR-017: what main keeps itself is never taken from the renderer
    const s = cleanSchedule(edit && prev ? editCandidate(input as Record<string, unknown>, prev) : { ...(input as object), next: undefined, spent: undefined, spentUnknown: undefined, pausedReason: undefined, loop: limitsOf((input as { loop?: unknown }).loop) }, now);
    if (!s) return { ok: false, error: 'A schedule needs a prompt and either a time, an interval of 5 to 1440 minutes or a calendar rule. A limit must be a positive amount.' };
    // a save of an existing schedule that is not an edit (Pause, Resume, "Use the folder's agent") never moves it to another folder or revives a done one
    if (!edit && prev) {
      s.folder = prev.folder;
      if (prev.done) s.done = true;
      else delete s.done;
    }
    if (!folderExists(s.folder)) return { ok: false, error: 'Unknown folder.' };
    // spec 072 FR-001..FR-004: a loop keeps its session, there is one per session, and its end time is within 24 h of its start
    if (prev && !!prev.loop !== !!s.loop) return { ok: false, error: prev.loop ? 'A loop stays a loop.' : 'A schedule cannot become a loop. Make a new one.' };
    // a Pause or Resume save (not an edit) never changes a loop's limits: they are main's copy
    if (!edit && prev?.loop && s.loop) s.loop = { minDelay: prev.loop.minDelay, maxDelay: prev.loop.maxDelay, defaultDelay: prev.loop.defaultDelay, maxPasses: prev.loop.maxPasses, endAt: prev.loop.endAt };
    if (s.loop && s.target) {
      const session = s.target.session;
      if (prev && prev.target?.session !== session) return { ok: false, error: 'A loop stays on its session.' };
      if (this.doc.schedules.some((x) => x.id !== s.id && x.loop && !x.loop.ended && x.target?.session === session)) return { ok: false, error: 'That session already has a loop.' };
      if ((!prev || edit) && !prev?.loop?.ended) {
        const started = prev?.loop?.startedAt ?? now;
        if (s.loop.endAt <= now) return { ok: false, error: 'The loop must end in the future.' };
        if (s.loop.endAt > started + LOOP_MAX_HOURS * 3_600_000) return { ok: false, error: `A loop may run at most ${LOOP_MAX_HOURS} hours.` };
      }
    }
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
    if (s.loop) {
      // Q2: a loop has a limit; Q4: an app that reports no spend in a unit gets a loop bounded by passes and time only
      const unit = this.deps.capUnitOf(s);
      if (!unit) delete s.cap;
      else if (!s.cap) return { ok: false, error: 'A loop needs a limit (AI credits or dollars).' };
    }
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
    if (s.loop && !old?.loop) {
      s.loop.startedAt = now;
      if (!s.paused) s.next = now; // the first pass goes out at once (US1)
    }
    if (old) {
      if (old.last) s.last = old.last;
      if (s.loop && old.loop) {
        // main's own loop state is carried over from main's copy
        const o = old.loop;
        Object.assign(s.loop, { startedAt: o.startedAt, passes: o.passes ?? 0, noPaceStreak: o.noPaceStreak, errorStreak: o.errorStreak, lastAsk: o.lastAsk, inPass: o.inPass, hold: o.hold, ended: o.ended });
        for (const k of Object.keys(s.loop) as (keyof LoopSpec)[]) if (s.loop[k] === undefined) delete s.loop[k];
        if (old.next !== undefined) s.next = old.next;
        // Resume: the next wake counts from now, never at once
        if (old.paused && !s.paused && !o.ended) {
          delete s.loop.hold;
          s.next = now + this.lastDelay(s.loop) * MIN;
        }
      }
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
      if (!s.paused && old.pausedReason === 'cap' && !s.loop) {
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
    // spec 072 FR-019: loops wait while Pause all is on; when it ends each continues at now + its last asked delay (no burst)
    const now = this.deps.now();
    for (const s of this.doc.schedules) if (s.loop) this.settle(s, now);
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
    // a loop's `hold` and `inPass` are runtime state and are not kept (spec 072 FR-002, FR-008)
    fs.writeFileSync(file, JSON.stringify(doc, (k, v: unknown) => (k === 'hold' || k === 'inPass' ? undefined : v), 2), { mode: 0o600 });
  } catch {
    /* not saved; the next change tries again */
  }
}

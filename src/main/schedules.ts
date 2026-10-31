/**
 * Scheduled prompts (spec 044): per-folder schedules that send a prompt to the folder's agent (or one session, Phase 2 FR-014)
 * once, every N minutes or on a calendar rule (FR-012), only while the app runs. The core is pure (an injected clock, timer, busy check and sender) and unit-tested with a fake clock.
 * Stored as `durbar-schedules.json` in the user-data folder; the prompt text is kept there (it must be sent) and never logged.
 */
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pidAlive } from './crashmarker';
import { localTime, nextRuleRun, parseRule } from '../shared/schedrules';
import type { CalendarRule } from '../shared/schedrules';
import { LOOP_MAX_DELAY, LOOP_MAX_HOURS, LOOP_MAX_PASSES, LOOP_MIN_DELAY, clampPace, cleanReason, oneLine, parsePace } from '../shared/looppace';

export type Outcome = 'sent' | 'skipped-busy' | 'skipped-paused' | 'skipped-cap' | 'skipped-ended' | 'missed' | 'failed' | 'held' | 'ended' | 'skipped-door-full' | 'skipped-review' | 'skipped-autopilot';
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
  /** Spec 099 FR-084: `autopilot` is out of the first build: kept when read, so a run is refused and the log says why, never sent in the session's mode. */
  mode?: 'autopilot';
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
  pausedReason?: 'cap' | 'session-ended' | 'review';
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
/** Spec 044 FR-036: why a run did not go (a closed list, never free text) or why a loop ended. */
export type RunReason = 'no-agent' | 'send-error' | LoopEndReason;
/** Spec 044 FR-036: one entry of a schedule's run log. No prompt text, error text, path or token is ever stored here. */
export interface ScheduleRun {
  at: number;
  outcome: Outcome;
  /** The session (agent) id the prompt went to, or would have gone to. */
  session?: string;
  reason?: RunReason;
  /** Run missed now (spec 052 FR-089). */
  manual?: true;
  /** Repeats of the same skip folded into this entry (FR-037), counted from 2, and the time of the last one. */
  n?: number;
  until?: number;
}
export interface SchedulesDoc {
  pausedAll: boolean;
  schedules: Schedule[];
  /** Spec 044 FR-036: schedule id -> its last runs, oldest first. Not sent to the window (`publicDoc`); `runsOf` serves it. */
  runs?: Record<string, ScheduleRun[]>;
}

/**
 * Spec 072: `save` refuses a `loop` until main wires it (T006: the loop footer in `send`, `turnEnded` with the pass result, `waitOf`).
 * T006 sets `enabled` to true; without that wiring a loop would run with no pace line and no holds.
 */
export const loopSupport = { enabled: false };
export const MAX_SCHEDULES = 50;
/** Spec 044 FR-037: runs kept per schedule. */
export const MAX_RUNS = 50;
/** The largest fold count (`n`); `cleanRuns` drops a larger one, so `record` never writes it. */
export const MAX_FOLD = 100_000;
/** Spec 044 FR-037: a fold-only change is written at the latest after this long (unless a real change or quit writes it first). */
export const FOLD_FLUSH_MS = 60 * 60_000;
/** Spec 044 FR-120 (issue #843): the longest prompt, in characters (`String.length` of the trimmed text). A longer one is refused by `save` and never cut. */
export const MAX_PROMPT = 10_000;
/** FR-124: a stored prompt over the limit (a hand-edited file) is kept whole and not sent: the schedule needs review. */
/** Spec 099 T032: thrown by main's send when the session went on Autopilot after this run looked: outcome `skipped-autopilot`. */
export const AUTOPILOT_HELD = Symbol('autopilot');
export const needsReview = (s: Pick<Schedule, 'prompt'>): boolean => s.prompt.length > MAX_PROMPT;
export const MIN_EVERY = 5;
export const MAX_EVERY = 1440;
const MIN = 60_000;
const OUTCOMES: Outcome[] = ['sent', 'skipped-busy', 'skipped-paused', 'skipped-cap', 'skipped-ended', 'missed', 'failed', 'held', 'ended', 'skipped-door-full', 'skipped-review', 'skipped-autopilot'];
const END_REASONS: LoopEndReason[] = ['user', 'agent', 'session', 'limit', 'passes', 'time', 'no-pace', 'errors', 'app-closed'];
const RUN_REASONS: RunReason[] = ['no-agent', 'send-error', ...END_REASONS];
/** Spec 044 FR-037: a skip that repeats with the same outcome and session is one entry with a count. */
const FOLDS: Outcome[] = ['skipped-busy', 'skipped-paused', 'held', 'skipped-door-full', 'skipped-review', 'skipped-autopilot'];
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
  const prompt = typeof r.prompt === 'string' ? r.prompt.trim() : ''; // FR-120/FR-124: never cut here; `save` refuses a longer new prompt, a stored one needs review
  if (!folder || !prompt) return undefined;
  const every = num(r.every);
  const at = num(r.at);
  const s: Schedule = { id: keepId && typeof r.id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(r.id) ? r.id : randomUUID(), folder, prompt };
  if (r.mode === 'autopilot') s.mode = 'autopilot'; // spec 099 FR-084: never run; `save` refuses a new one
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
  if (s.paused && (r.pausedReason === 'cap' || r.pausedReason === 'session-ended' || r.pausedReason === 'review')) s.pausedReason = r.pausedReason;
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

/**
 * Spec 044 FR-038: the run logs from untrusted input (the file). A key that is not a loaded schedule's id, a value that is not an array,
 * an entry with a bad required field and unknown fields are dropped; a bad optional field is dropped alone; entries are sorted by `at`
 * and cut to the newest MAX_RUNS. Never throws.
 */
export function cleanRuns(v: unknown, ids: Iterable<string>): Record<string, ScheduleRun[]> {
  const out: Record<string, ScheduleRun[]> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  const raw = v as Record<string, unknown>;
  for (const id of new Set(ids)) {
    if (!Object.prototype.hasOwnProperty.call(raw, id)) continue;
    const list = raw[id];
    if (!Array.isArray(list)) continue;
    const runs: ScheduleRun[] = [];
    for (const e of list.slice(0, 10_000)) {
      if (!e || typeof e !== 'object') continue;
      const r = e as Record<string, unknown>;
      const at = num(r.at);
      if (at === undefined || at <= 0 || !OUTCOMES.includes(r.outcome as Outcome)) continue;
      const run: ScheduleRun = { at, outcome: r.outcome as Outcome };
      if (typeof r.session === 'string' && ID_RE.test(r.session)) run.session = r.session;
      if (RUN_REASONS.includes(r.reason as RunReason)) run.reason = r.reason as RunReason;
      if (r.manual === true) run.manual = true;
      const n = num(r.n);
      if (n !== undefined && Number.isInteger(n) && n >= 2 && n <= MAX_FOLD) run.n = n;
      const until = num(r.until);
      if (until !== undefined && until >= at) run.until = until;
      runs.push(run);
    }
    if (!runs.length) continue;
    runs.sort((a, b) => a.at - b.at);
    out[id] = runs.slice(-MAX_RUNS);
  }
  return out;
}

/**
 * Spec 044 FR-043: the answer to `schedules:runs` once the frame is checked: a string id of 1..64 letters, digits and hyphens (a
 * schedule's id pattern, widened to the simulator's short ids), else `{ ok: false }`; an unknown id gives an empty list. Read-only.
 */
export function runsReply(sch: Pick<Scheduler, 'runsOf'> | undefined, id: unknown): { ok: true; runs: ScheduleRun[] } | { ok: false } {
  if (typeof id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(id)) return { ok: false };
  return { ok: true, runs: sch?.runsOf(id) ?? [] };
}

/** The document as the window sees it: no run logs (FR-043; they are asked for one schedule at a time). */
export function publicDoc(doc: SchedulesDoc): SchedulesDoc {
  return { pausedAll: doc.pausedAll, schedules: doc.schedules };
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
  const runs = cleanRuns(d.runs, schedules.map((s) => s.id));
  return Object.keys(runs).length ? { pausedAll: d.pausedAll === true, schedules, runs } : { pausedAll: d.pausedAll === true, schedules };
}

/** When a schedule runs next, or undefined when it never will (done, or paused). */
export function dueAt(s: Schedule): number | undefined {
  if (s.done || s.paused) return undefined;
  if (s.loop) {
    // spec 072 FR-004: nothing while a pass runs or after the end. A loop also wakes at its end time (held or not) so it ends then, not at its next wake.
    if (s.loop.ended || s.loop.inPass) return undefined;
    return s.loop.hold ? s.loop.endAt : s.next === undefined ? undefined : Math.min(s.next, s.loop.endAt);
  }
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
  /** Spec 099 T032, FR-083: the session this run would go to is on Autopilot, or being turned on: not sent while T096 is held, and the run log says why. */
  onAutopilot?(s: Schedule): boolean;
  /** FR-014: the session still exists. */
  hasSession(session: string): boolean;
  /** FR-015: the cap unit of the agent app that would run the schedule, or undefined when it reports no spending in a unit. */
  capUnitOf(s: Schedule): CapUnit | undefined;
  /** A monotonic clock in ms (default `performance.now`); a loop never sends two passes closer than its minimum on it, whatever the wall clock does. */
  mono?(): number;
  setTimer(ms: number, fn: () => void): unknown;
  clearTimer(t: unknown): void;
  /** Writes the document; false when it could not (the scheduler keeps it dirty and tries again). */
  save(doc: SchedulesDoc): boolean | void;
  /** Spec 072 FR-015..FR-017: why the session cannot take a loop pass now: a person is needed, a coffee break, or Durbar's spending cap; undefined when nothing waits. */
  waitOf?(session: string): LoopWait | undefined;
  /** After any change (for the renderer). */
  changed?(doc: SchedulesDoc): void;
  /**
   * Spec 044 FR-110 (owner 2026-10-23): the run's agent has its door closed by the user (Do not disturb). Main queues the run there and
   * answers true: the run is then held (not sent, not dropped). 'full' (review on #631): the door is closed but its queue is full, so
   * the run is not kept and its outcome says so (never sent either). False when the door is open (or there is no such agent).
   */
  hold?(s: Schedule, now: number): boolean | 'full';
  /** Spec 081 FR-013: a reason the run cannot go now (its agent app is updating and the run would start or resume a session); the run is held and tried again. */
  heldBy?(s: Schedule): string | undefined;
}

/** Spec 081: how long a held run waits before it is looked at again (a release also brings it forward at once). */
export const HOLD_RETRY_MS = 5000;

export class Scheduler {
  private timer: unknown;
  private running = false;
  /** FR-015: session id -> the schedule whose run is in progress there (until the turn ends). Not saved. */
  private attrib = new Map<string, string>();
  /** Spec 072: loop id -> monotonic stamp of its last pass sent. Memory only (loops end when the app restarts). */
  private lastSent = new Map<string, number>();
  /** Spec 044 FR-037: what the current tick did to the run logs: a fold happened / something that must be written at once happened. */
  private folded = false;
  private real = false;
  /** A fold-only change is waiting to be written; its timer; the last time the file was written. */
  private dirty = false;
  private flushTimer: unknown;
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
      const why: Outcome = needsReview(s) ? 'skipped-review' : 'missed'; // FR-124: a prompt over the limit says so, whatever else is true
      if (s.at !== undefined && s.every === undefined && s.at < now - 30_000) {
        if (why === 'skipped-review') {
          s.paused = true;
          s.pausedReason = 'review';
        } else s.done = true;
        this.record(s, why, now);
      } else if (recurring(s) && (s.next ?? 0) < now - 30_000) {
        s.next = nextAfter(s, now);
        this.record(s, why, now);
      }
    }
    this.pauseEnded();
    this.commit();
  }

  /**
   * Spec 044 FR-036/FR-037: the one place that sets `last` and appends to the run log, so the two never disagree.
   * A skip equal to the newest entry (same outcome and session, see FOLDS) raises its count instead of adding an entry; `update` (a
   * loop pass that went out and now ended) rewrites the newest `sent` or same-outcome entry, so a pass stays one entry. Returns true
   * when only a fold happened (the caller may then write late, FR-037).
   */
  private record(s: Schedule, outcome: Outcome, now: number, x: { session?: string; reason?: RunReason; manual?: true; update?: boolean } = {}): boolean {
    s.last = { at: now, outcome };
    if (!this.doc.schedules.some((q) => q.id === s.id)) return false; // deleted while its send was awaited: no log is made for it
    const runs = (this.doc.runs ??= {});
    // own properties only: an id such as `constructor` or `toString` is a valid schedule id and must not pick an inherited function
    if (!Object.prototype.hasOwnProperty.call(runs, s.id)) runs[s.id] = [];
    const log = runs[s.id];
    const top = log[log.length - 1];
    const session = x.session !== undefined && ID_RE.test(x.session) ? x.session : undefined;
    if (top && FOLDS.includes(outcome) && top.outcome === outcome && top.session === session && !top.manual) {
      top.n = Math.min(MAX_FOLD, (top.n ?? 1) + 1); // the same bound cleanRuns reads back
      top.until = now;
      this.folded = true;
      return true;
    }
    const run: ScheduleRun = { at: now, outcome };
    if (session) run.session = session;
    if (x.reason) run.reason = x.reason;
    if (x.manual) run.manual = true;
    if (x.update && top && !top.manual && top.n === undefined && (top.outcome === 'sent' || top.outcome === outcome)) log[log.length - 1] = run;
    else log.push(run);
    if (log.length > MAX_RUNS) log.splice(0, log.length - MAX_RUNS);
    this.real = true;
    return false;
  }

  /** What a send gave: its result, and whether it threw (`send-error`) or said it could not (`no-agent`, FR-036). */
  private async sendRun(s: Schedule, prompt: string): Promise<{ r: boolean | string; reason?: RunReason; autopilot?: true }> {
    try {
      const r = await this.deps.send(s.folder, prompt, s);
      return r ? { r } : { r, reason: 'no-agent' };
    } catch (err) {
      if (err === AUTOPILOT_HELD) return { r: false, autopilot: true }; // spec 099 T032: turned on while this send waited for its session
      return { r: false, reason: 'send-error' };
    }
  }

  /** The run logs of one schedule, newest first (a copy); empty for an unknown id. */
  runsOf(id: string): ScheduleRun[] {
    const log = this.doc.runs && Object.prototype.hasOwnProperty.call(this.doc.runs, id) ? this.doc.runs[id] : undefined;
    return Array.isArray(log) ? log.map((r) => ({ ...r })).reverse() : [];
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
    // spec 072: a running loop keeps the session's spend until its next pass starts (a `usage` event may come after `idle`); a plain schedule does not
    const owner = this.doc.schedules.find((x) => x.id === this.attrib.get(session));
    if (!(owner?.loop && !owner.loop.ended)) this.attrib.delete(session);
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
    this.record(s, 'ended', now, { session: s.target?.session, reason });
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
      this.real = true;
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
  private passEnded(s: Schedule, end: { finalText?: string; error?: boolean; stopped?: boolean; unsent?: boolean }, now: number): void {
    const l = s.loop as LoopSpec;
    l.inPass = false;
    this.lastSent.set(s.id, this.mono()); // FR-011: the minimum between two passes runs from the END of this one
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
    if (!end.unsent) this.record(s, end.error ? 'failed' : 'sent', now, { session: s.target?.session, update: true }); // `unsent`: the caller recorded the failed send itself
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
    if (!this.deps.hasSession(session)) return this.endLoop(s, 'session', now);
    if (this.limitReached(s, now)) return; // also while held or paused by Pause all: a loop past its end time ends, it does not stay "running"
    if (needsReview(s)) {
      // FR-124: a prompt over the limit is never sent; the loop waits a pass length and the row says why.
      // After the limits: a past end time must end the loop, or dueAt (min of next and endAt) stays in the past and the timer re-arms at 0 ms forever.
      this.record(s, 'skipped-review', now, { session });
      s.next = now + this.lastDelay(l) * MIN;
      return;
    }
    if (this.doc.pausedAll) {
      l.hold = 'pause-all';
      this.record(s, 'skipped-paused', now, { session });
      return;
    }
    if (s.mode === 'autopilot' || this.deps.onAutopilot?.(s)) {
      this.record(s, 'skipped-autopilot', now, { session }); // spec 099 T032: not a pass, not queued
      s.next = now + this.lastDelay(l) * MIN;
      return;
    }
    if (this.settle(s, now)) {
      this.record(s, 'held', now, { session });
      return;
    }
    if (this.deps.isBusy(s.folder, session)) {
      this.record(s, 'skipped-busy', now, { session });
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
    const pass = l.passes;
    const started = l.startedAt; // restartLoop edits this object in place, so keep the value from before the await
    const { r, reason } = await this.sendRun(s, s.prompt);
    const after = this.deps.now();
    // `save` (Pause, Resume, an edit) may have replaced the object while send was awaited: act on the current one, and only if it is
    // still this loop in this pass (not stopped, removed, or its turn already ended)
    const cur = this.doc.schedules.find((x) => x.id === s.id);
    const cl = cur?.loop;
    if (!cur || !cl || cl.ended || !cl.inPass || cl.passes !== pass || cl.startedAt !== started) return;
    if (r) {
      this.record(cur, 'sent', now, { session: typeof r === 'string' ? r : session });
      return;
    }
    // the pass could not be sent: it counts as a failed pass (FR-013)
    if (this.attrib.get(session) === cur.id) this.attrib.delete(session);
    // no `sent` entry of this pass exists: the failed send is a new entry of its own (never an update of an earlier pass's), then the pass ends (possibly the loop too)
    this.record(cur, 'failed', now, { session, reason });
    this.passEnded(cur, { error: true, unsent: true }, after);
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

  /**
   * Saves and tells the window. `foldOnly` (spec 044 FR-037): the change was only a fold of a repeated skip (and the next time of a
   * recurring schedule), so the file is marked dirty and written with the next real change, at quit (`flush`), or within FOLD_FLUSH_MS:
   * a 5-minute interval under Pause all must not rewrite the file every 5 minutes.
   */
  private commit(foldOnly = false): void {
    if (foldOnly) {
      this.dirty = true;
      if (this.flushTimer === undefined) this.flushTimer = this.deps.setTimer(FOLD_FLUSH_MS, () => this.flush());
    } else {
      this.writeNow();
    }
    this.deps.changed?.(this.doc);
    this.arm();
  }

  private writeNow(): void {
    this.dirty = false;
    this.folded = false;
    this.real = false;
    if (this.flushTimer !== undefined) this.deps.clearTimer(this.flushTimer);
    this.flushTimer = undefined;
    if (this.deps.save(this.doc) === false) {
      // a failed write is not forgotten: the next real change, the quit flush or the timer writes it again
      this.dirty = true;
      this.flushTimer = this.deps.setTimer(FOLD_FLUSH_MS, () => this.flush());
    }
  }

  /** Writes a pending fold-only change (main calls this when the app quits, FR-037). */
  flush(): void {
    if (this.dirty) this.writeNow();
  }

  /** Spec 081: schedules held by an update lock, and when each may be tried again. Memory only. */
  private heldUntil = new Map<string, number>();

  /** Spec 081 FR-013: the number of held runs that `pick` selects (the update gate's "held prompts" count). */
  heldFor(pick: (s: Schedule) => boolean): number {
    return this.doc.schedules.filter((s) => this.heldUntil.has(s.id) && pick(s)).length;
  }

  /** Spec 081 FR-013: an update lock was released: held runs are looked at again now. */
  releaseHeld(): void {
    if (!this.heldUntil.size) return;
    this.heldUntil.clear();
    this.arm();
  }

  private dueNow(s: Schedule): number | undefined {
    const t = dueAt(s);
    const h = this.heldUntil.get(s.id);
    return t === undefined || h === undefined ? t : Math.max(t, h);
  }

  private arm(): void {
    if (this.timer !== undefined) this.deps.clearTimer(this.timer);
    this.timer = undefined;
    const due = this.doc.schedules.map((s) => this.dueNow(s)).filter((t): t is number => t !== undefined);
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
        const t = this.dueNow(s);
        if (t === undefined || t > now) continue;
        if (s.loop) {
          await this.tickLoop(s, now);
          continue;
        }
        let outcome: Outcome;
        let held: boolean | 'full' = false;
        let r: boolean | string = false;
        let reason: RunReason | undefined;
        if (needsReview(s)) outcome = 'skipped-review'; // FR-124: first, so the row always says this reason
        else if (this.doc.pausedAll) outcome = 'skipped-paused';
        else if (s.target && !this.deps.hasSession(s.target.session)) outcome = 'skipped-ended';
        else if (s.cap && (s.spent ?? 0) >= s.cap.amount) outcome = 'skipped-cap';
        else if (s.mode === 'autopilot' || this.deps.onAutopilot?.(s)) outcome = 'skipped-autopilot'; // spec 099 T032
        else if ((held = this.deps.hold?.(s, now) ?? false)) outcome = held === 'full' ? 'skipped-door-full' : 'held'; // FR-110: queued at a door closed by the user, before busy
        else if (this.deps.isBusy(s.folder, s.target?.session)) outcome = 'skipped-busy';
        else if (this.deps.heldBy?.(s)) {
          // spec 081 FR-013: its app is updating and this run would start or resume a session: held, looked at again soon (or at the release)
          this.heldUntil.set(s.id, now + HOLD_RETRY_MS);
          this.record(s, 'held', now, { session: s.target?.session });
          continue;
        } else {
          this.heldUntil.delete(s.id);
          const sr = await this.sendRun(s, s.prompt);
          r = sr.r;
          reason = sr.reason;
          outcome = sr.autopilot ? 'skipped-autopilot' : r ? 'sent' : 'failed';
          if (typeof r === 'string' && r) this.attrib.set(r, s.id);
        }
        this.record(s, outcome, now, { session: typeof r === 'string' && r ? r : s.target?.session, reason });
        if (outcome === 'skipped-ended' || outcome === 'skipped-cap' || (outcome === 'skipped-review' && !recurring(s))) {
          // FR-014 / FR-015 / FR-124: paused with a clear reason; the run is not sent, and a once-schedule stays to be resumed, fixed or deleted
          s.paused = true;
          s.pausedReason = outcome === 'skipped-cap' ? 'cap' : outcome === 'skipped-review' ? 'review' : 'session-ended';
          this.real = true;
        } else if (recurring(s)) s.next = nextAfter(s, now);
        else {
          s.done = true;
          this.real = true;
        }
      }
    } finally {
      this.running = false;
      const foldOnly = this.folded && !this.real;
      this.folded = false;
      this.real = false;
      this.commit(foldOnly);
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
    if (needsReview(s)) return { ok: false, error: `This prompt is over ${MAX_PROMPT.toLocaleString('en-US')} characters. Shorten it with Edit… first.` };
    if (s.target && !this.deps.hasSession(s.target.session)) return { ok: false, error: 'That session has ended.' };
    if (s.cap && (s.spent ?? 0) >= s.cap.amount) return { ok: false, error: 'This schedule has reached its limit.' };
    if (s.mode === 'autopilot') return { ok: false, error: 'Autopilot on a schedule is not available.' };
    if (this.deps.onAutopilot?.(s)) return { ok: false, error: 'That session is on Autopilot. A schedule does not run under it. Stop Autopilot first.' };
    if (this.deps.isBusy(s.folder, s.target?.session)) return { ok: false, error: 'The agent is busy. Try again when it is free.' };
    this.running = true;
    let r: boolean | string = false;
    try {
      const sr = await this.sendRun(s, s.prompt);
      r = sr.r;
      if (typeof r === 'string' && r) this.attrib.set(r, s.id);
      this.record(s, sr.autopilot ? 'skipped-autopilot' : r ? 'sent' : 'failed', this.deps.now(), { session: typeof r === 'string' && r ? r : s.target?.session, reason: sr.reason, manual: true });
    } finally {
      this.running = false;
      this.commit();
    }
    return r ? { ok: true } : { ok: false, error: 'Could not send it.' };
  }

  /**
   * Spec 044 FR-111 (review on #631): Send all at an opened door releases each held run through the scheduler, never around it: Pause
   * all, the schedule's pause, its session, its own limit and a busy agent (coffee breaks count, scheduleBusy) are checked as for a
   * scheduled run; it goes out through the same `send` (credited to the schedule, `schedule:ran`), and `last` records it.
   * 'gone': the schedule was deleted, so the run is dropped by the caller (the user deleted the schedule).
   */
  async releaseDoorRun(scheduleId: string | undefined, prompt: string): Promise<'sent' | 'busy' | 'paused-all' | 'paused' | 'cap' | 'ended' | 'updating' | 'gone' | 'failed'> {
    const s = typeof scheduleId === 'string' ? this.doc.schedules.find((x) => x.id === scheduleId) : undefined;
    if (!s) return 'gone';
    if (this.doc.pausedAll) return 'paused-all';
    if (s.paused) return 'paused';
    if (s.target && !this.deps.hasSession(s.target.session)) return 'ended';
    if (s.cap && (s.spent ?? 0) >= s.cap.amount) return 'cap';
    if (this.deps.heldBy?.(s)) return 'updating'; // spec 081 FR-013: its agent app is updating
    if (s.mode === 'autopilot' || this.deps.onAutopilot?.(s)) return 'busy'; // spec 099 T032: stays at the door
    if (this.running || this.deps.isBusy(s.folder, s.target?.session)) return 'busy';
    this.running = true;
    let r: boolean | string = false;
    try {
      const sr = await this.sendRun(s, prompt);
      r = sr.r;
      if (typeof r === 'string' && r) this.attrib.set(r, s.id);
      if (sr.autopilot) return 'busy';
      this.record(s, r ? 'sent' : 'failed', this.deps.now(), { session: typeof r === 'string' && r ? r : s.target?.session, reason: sr.reason });
    } finally {
      this.running = false;
      this.commit();
    }
    return r ? 'sent' : 'failed';
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
    // FR-123: a prompt over the limit is refused, never cut; one that did not change (Pause, Resume, Delete-side saves of an old entry) stays
    if (s.mode === 'autopilot' && prev?.mode !== 'autopilot') return { ok: false, error: 'Autopilot on a schedule is not available.' }; // spec 099 FR-084
    if (needsReview(s) && s.prompt !== prev?.prompt) return { ok: false, error: `The prompt is ${s.prompt.length.toLocaleString('en-US')} of ${MAX_PROMPT.toLocaleString('en-US')} characters: shorten it to save.` };
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
      const again = prev.done || prev.pausedReason === 'review'; // FR-124: a once schedule paused for review has passed its time, like a done one
      if (s.at !== undefined && !recurring(s) && s.at < now && (again || recurring(prev) || s.at !== prev.at)) return { ok: false, error: again ? 'Pick a time in the future to run it again.' : 'That time has already passed.' };
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
      // FR-124: an edit that makes the prompt fit runs a schedule that was paused for review again
      const reviewed = old.pausedReason === 'review' && !needsReview(s) && edit;
      if (reviewed) {
        delete s.paused;
        delete s.pausedReason;
      } else if (s.paused && old.paused && old.pausedReason && !retargeted && !capFreed) s.pausedReason = old.pausedReason;
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
    this.dropRuns([id]); // FR-039: the history goes with the schedule, in the same write
    this.commit();
    return true;
  }

  removeFolder(folder: string): void {
    const n = this.doc.schedules.length;
    const gone = this.doc.schedules.filter((s) => s.folder === folder).map((s) => s.id);
    this.doc.schedules = this.doc.schedules.filter((s) => s.folder !== folder);
    this.dropRuns(gone);
    if (this.doc.schedules.length !== n) this.commit();
  }

  private dropRuns(ids: string[]): void {
    if (!this.doc.runs) return;
    for (const id of ids) delete this.doc.runs[id];
    if (!Object.keys(this.doc.runs).length) delete this.doc.runs;
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
    if (this.flushTimer !== undefined) this.deps.clearTimer(this.flushTimer);
    this.flushTimer = undefined;
  }
}

/** What `loadSchedules` needs from the system; tests inject failures. */
export interface LoadIo {
  fs: Pick<typeof fs, 'readFileSync' | 'renameSync' | 'existsSync' | 'readdirSync' | 'rmSync'>;
  pause(ms: number): void;
  alive(pid: number): boolean;
  pid: number;
}
const pauseSync = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const realLoadIo: LoadIo = { fs, pause: pauseSync, alive: pidAlive, pid: process.pid };
/** Files whose move to `.bad-<time>` failed: `saveSchedules` retries the move first and never writes over them (FR-038). */
const pendingAside = new Set<string>();

export function loadSchedules(file: string, now: number, io: LoadIo = realLoadIo): SchedulesDoc {
  removeStaleTemps(file, io);
  let text: string | undefined;
  for (let attempt = 0; attempt < 2 && text === undefined; attempt++) {
    try {
      text = io.fs.readFileSync(file, 'utf8');
    } catch (e) {
      if ((e as { code?: string }).code === 'ENOENT') return { pausedAll: false, schedules: [] };
      // a read can fail for a moment on a good file (an antivirus holding it, Windows): once more after a short pause; only a second failure sets it aside
      if (attempt === 0) io.pause(200);
    }
  }
  if (text === undefined) {
    setAside(file, now, io);
    return { pausedAll: false, schedules: [] };
  }
  let ok = false;
  try {
    const v: unknown = JSON.parse(text);
    ok = !!v && typeof v === 'object' && !Array.isArray(v);
  } catch { /* corrupt */ }
  if (!ok) {
    setAside(file, now, io);
    return { pausedAll: false, schedules: [] };
  }
  return parseSchedules(text, now);
}

/**
 * A schedules file that cannot be read is renamed to `<file>.bad-<UTC time>` (as the notes store does), so a save cannot destroy it; the
 * schedules start empty. True when it is out of the way (or gone); false when the move failed: the file is then remembered, and
 * `saveSchedules` retries the move and refuses to write until it works.
 */
function setAside(file: string, now: number, io: { fs: Pick<typeof fs, 'existsSync' | 'renameSync'> }): boolean {
  try {
    if (!io.fs.existsSync(file)) { pendingAside.delete(file); return true; }
    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-');
    let dest = `${file}.bad-${stamp}`;
    for (let i = 1; io.fs.existsSync(dest) && i < 100; i++) dest = `${file}.bad-${stamp}-${i}`;
    io.fs.renameSync(file, dest);
    pendingAside.delete(file);
    return true;
  } catch {
    pendingAside.add(file);
    return false;
  }
}

/** Temp files of a process that died mid-save may hold prompt text: removed at load. Exact name `<file>.<pid>.tmp`, never our own pid, never a running process. */
function removeStaleTemps(file: string, io: LoadIo): void {
  try {
    const dir = path.dirname(file), base = path.basename(file);
    for (const name of io.fs.readdirSync(dir)) {
      const m = name.startsWith(base + '.') && name.endsWith('.tmp') ? /^(\d{1,10})$/.exec(name.slice(base.length + 1, -4)) : null;
      const pid = m ? Number(m[1]) : 0;
      if (!m || pid <= 0 || pid === io.pid || io.alive(pid)) continue;
      try { io.fs.rmSync(path.join(dir, name), { force: true }); } catch { /* next start */ }
    }
  } catch { /* no folder yet */ }
}

/** What `saveSchedules` needs from the system; tests inject failures and the platform. */
export interface SaveIo {
  fs: Pick<typeof fs, 'openSync' | 'writeSync' | 'fsyncSync' | 'closeSync' | 'renameSync' | 'rmSync' | 'existsSync'>;
  platform: NodeJS.Platform;
  /** A short blocking pause (win32 retry). */
  pause(ms: number): void;
}
const realIo: SaveIo = { fs, platform: process.platform, pause: (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } };

/** Writes the file; true when it is on disk. A failure is reported, not thrown (the caller keeps the change and retries, FR-037). */
export function saveSchedules(file: string, doc: SchedulesDoc, io: SaveIo = realIo): boolean {
  // a loop's `hold` and `inPass` are runtime state and are not kept (spec 072 FR-002, FR-008)
  // written beside the file, then renamed over it: a crash or a full disk mid-write leaves the old file whole (a torn file would load as "no schedules")
  // the process id is in the name: two instances never share a temp file (there is no single-instance lock)
  // a file that could not be set aside is still there: try the move again first, and never write over it
  if (pendingAside.has(file) && !setAside(file, Date.now(), { fs: { existsSync: io.fs.existsSync, renameSync: io.fs.renameSync } })) return false;
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    const buf = Buffer.from(JSON.stringify(doc, (k, v: unknown) => (k === 'hold' || k === 'inPass' ? undefined : v), 2), 'utf8');
    const fd = io.fs.openSync(tmp, 'w', 0o600);
    try {
      let off = 0;
      while (off < buf.length) off += io.fs.writeSync(fd, buf, off, buf.length - off);
      try { io.fs.fsyncSync(fd); } catch { /* best effort */ }
    } finally {
      io.fs.closeSync(fd);
    }
    try {
      io.fs.renameSync(tmp, file);
    } catch (e) {
      // Windows: an antivirus or indexer may hold the file for a moment (as notesstore.ts)
      const code = (e as { code?: string }).code ?? '';
      if (io.platform === 'win32' && ['EPERM', 'EBUSY', 'EACCES'].includes(code)) {
        io.pause(200);
        io.fs.renameSync(tmp, file);
      } else throw e;
    }
    return true;
  } catch {
    try { io.fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    return false; // not saved
  }
}

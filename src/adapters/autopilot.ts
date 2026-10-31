/**
 * Spec 099 (Autopilot), the shared core: pure, no SDK, no I/O, no timers. All three adapters use it, so the rules are written once.
 * Phase 1 only: nothing in the adapters or in main calls this yet, and no descriptor reports `capabilities.autopilot`.
 */

import { isObj } from '../shared/guards';
import type { AutopilotEnd, AutopilotEvent } from './types';

/** FR-040: the end reasons, in the order the spec lists them. */
export const AUTOPILOT_ENDS: readonly AutopilotEnd[] = ['done', 'cap', 'limit', 'no-progress', 'blocked', 'stopped', 'error'];
export const SPEND_UNITS = ['aiu', 'usd', 'tokens'] as const;

/** FR-021 (D13): default 5, a warning above 20, and only a technical bound: an integer from 1 to 1000. It can never be off. */
export const DEFAULT_LIMIT = 5;
export const LIMIT_WARN_ABOVE = 20;
export const MIN_LIMIT = 1;
export const MAX_LIMIT = 1000;
/** FR-021 backstop time (D13): 2 hours by default, raisable within 1 to 168, never off. */
export const DEFAULT_HOURS = 2;
export const HOURS_WARN_ABOVE = 2;
export const MIN_HOURS = 1;
export const MAX_HOURS = 168;
/** FR-021 backstop turns: more than `BACKSTOP_TURNS_PER * (limit + 1)` main-session model turns ends the run with `error`. A safety bound against a changed app, not a money limit. */
export const BACKSTOP_TURNS_PER = 100;
/** FR-023: two continuations in a row with an unchanged folder fingerprint. */
export const NO_PROGRESS_AFTER = 2;
/** FR-011 (D13): a goal over this many characters on Claude Code is warned about, never refused. */
export const GOAL_WARN_LENGTH = 4000;
export const RUN_ID_MAX = 128;

/** FR-030: the one sentence every question gets. An exact constant: nothing the agent writes is ever put into it. */
export const AUTOPILOT_ANSWER = 'The user is away and will not answer. Decide by yourself, say what you chose, and keep going.' as const;

export const validLimit = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= MIN_LIMIT && v <= MAX_LIMIT;
export const validHours = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= MIN_HOURS && v <= MAX_HOURS;
export const validRunId = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= RUN_ID_MAX;
export const isAutopilotEnd = (v: unknown): v is AutopilotEnd => typeof v === 'string' && (AUTOPILOT_ENDS as readonly string[]).includes(v);
export const isSpendUnit = (v: unknown): v is (typeof SPEND_UNITS)[number] => typeof v === 'string' && (SPEND_UNITS as readonly string[]).includes(v);

/** The limit a run uses: nothing chosen (`undefined`) is the default of 5; anything else must be valid. `null` (off), 0, 1001, 1.5, NaN and text throw. */
export function limitOrDefault(v: unknown): number {
  if (v === undefined) return DEFAULT_LIMIT;
  if (!validLimit(v)) throw new RangeError(`Autopilot limit must be a whole number from ${MIN_LIMIT} to ${MAX_LIMIT}; it cannot be turned off`);
  return v;
}

/** The backstop hours a run uses: `undefined` is the default of 2; anything else must be valid. */
export function hoursOrDefault(v: unknown): number {
  if (v === undefined) return DEFAULT_HOURS;
  if (!validHours(v)) throw new RangeError(`Autopilot hours must be from ${MIN_HOURS} to ${MAX_HOURS}; they cannot be turned off`);
  return v;
}

/** What `AutopilotRun` tells its owner: an `AutopilotEvent` without the fields the adapter adds. */
export type AutopilotRunEvent = Pick<AutopilotEvent, 'phase' | 'runId' | 'n' | 'limit' | 'reason' | 'spend'>;

export interface AutopilotRunOptions {
  /** Required, already chosen: use `limitOrDefault(settings.limit)`. Throws unless valid. */
  limit: number;
  /** Unique per run; 1 to 128 characters. */
  runId: string;
  /** Backstop time in hours; undefined = 2. */
  hours?: number;
  /**
   * The adapter's own FR-050 order (stop, clear), called with the end reason; it differs per app. Called once when the run ends, for every reason
   * (a `done` end still clears the goal, FR-041, and the adapter decides what that means), and again for each continuation that arrives
   * while the guard is armed. It must resolve only when the app confirmed the stop (FR-054); a rejection arms the guard.
   */
  halt: (reason: AutopilotEnd) => void | Promise<void>;
  /** Gets each event once, in order. Never throws into the run. */
  emit: (e: AutopilotRunEvent) => void;
  /** The clock, in ms. Injected so tests need no timers. */
  now?: () => number;
}

/** What `continuation()` did with the call. */
export type ContinuationResult = 'counted' | 'ended' | 'ignored' | 'interrupted';

/**
 * One Autopilot run: the counter, the limit, the end-once guard, the no-progress counter and the backstop (FR-020, FR-021, FR-023, FR-054).
 * Pure state: the adapter owns every vendor call and feeds this with what its app reports.
 *
 * - `continuation()` counts one continuation; the one that would be `limit + 1` ends the run with `limit` (n stays at `limit`).
 * - A run ends once. A second `end()` changes nothing and emits nothing.
 * - A `halt` that rejects still ends the run; the guard stays armed, so a later continuation calls `halt` again and is not counted (FR-054).
 *   `clearFailed()` arms it for a clear the adapter ran itself; `confirmCleared()` disarms it once the app acknowledged.
 */
export class AutopilotRun {
  readonly runId: string;
  readonly limit: number;
  readonly hours: number;
  private readonly o: AutopilotRunOptions;
  private readonly now: () => number;
  private readonly startedAtMs: number;
  private n = 0;
  private turns = 0;
  private unchanged = 0;
  private begun = false;
  private over = false;
  private why: AutopilotEnd | undefined;
  private armed = false;
  private failedClear = false;
  private interrupts = 0;
  private stopped: Promise<void> = Promise.resolve();

  constructor(o: AutopilotRunOptions) {
    if (!validLimit(o.limit)) throw new RangeError(`Autopilot limit must be a whole number from ${MIN_LIMIT} to ${MAX_LIMIT}; it cannot be turned off`);
    if (!validRunId(o.runId)) throw new RangeError(`Autopilot runId must be 1 to ${RUN_ID_MAX} characters`);
    if (typeof o.halt !== 'function' || typeof o.emit !== 'function') throw new TypeError('Autopilot run needs halt and emit callbacks');
    this.o = o;
    this.runId = o.runId;
    this.limit = o.limit;
    this.hours = hoursOrDefault(o.hours);
    this.now = o.now ?? Date.now;
    this.startedAtMs = this.now();
  }

  /** Continuations that ran so far; never above `limit`. */
  get count(): number { return this.n; }
  get ended(): boolean { return this.over; }
  get reason(): AutopilotEnd | undefined { return this.why; }
  /** True after a stop or clear that failed (or was not confirmed): any later continuation is interrupted again (FR-054). */
  get guardArmed(): boolean { return this.armed; }
  /** How many later continuations the armed guard interrupted. */
  get guardInterrupts(): number { return this.interrupts; }
  /** The most main-session model turns the backstop allows before it ends the run: `100 * (limit + 1)`. */
  get backstopTurns(): number { return BACKSTOP_TURNS_PER * (this.limit + 1); }
  /** The time the backstop ends the run, in the injected clock's ms, so the adapter can arm one timer. */
  get deadlineMs(): number { return this.startedAtMs + this.hours * 3_600_000; }
  /** Resolves (never rejects) when the first `halt` has settled. */
  whenStopped(): Promise<void> { return this.stopped; }

  /** Emits `started` once. The plan answer starts a run with no send (FR-060); a first continuation starts it by itself. */
  start(): void {
    if (this.begun || this.over) return;
    this.begun = true;
    this.send({ phase: 'started', runId: this.runId, n: 0, limit: this.limit });
  }

  /** The app started a turn on its own (FR-020). Counted up to `limit`; `limit + 1` stops the run. */
  continuation(): ContinuationResult {
    if (this.over) return this.guard();
    this.start();
    if (this.timeUp()) return 'ended';
    if (this.n + 1 > this.limit) {
      this.end('limit');
      return 'ended';
    }
    this.n += 1;
    this.send({ phase: 'continued', runId: this.runId, n: this.n, limit: this.limit });
    return 'counted';
  }

  /** The backstop's turn counter (FR-021), fed by each adapter with its own signal; independent of `continuation()`. */
  backstopTurn(): void {
    if (this.over) return;
    this.turns += 1;
    if (this.turns > this.backstopTurns) this.end('error');
    else this.timeUp();
  }

  /** The backstop's clock check (FR-021): the adapter calls it from its timer. Reaching the time ends the run with `error`. */
  checkElapsed(): boolean {
    return !this.over && this.timeUp();
  }

  /** FR-023: the folder fingerprint at a continuation start was `changed` or not. Two unchanged in a row end the run with `no-progress`. */
  noteProgress(changed: boolean): void {
    if (this.over) return;
    this.unchanged = changed ? 0 : this.unchanged + 1;
    if (this.unchanged >= NO_PROGRESS_AFTER) this.end('no-progress');
  }

  /** Ends the run once. An unknown reason ends it as `error`. Returns true only for the call that ended it. */
  end(reason: AutopilotEnd, spend?: AutopilotEvent['spend']): boolean {
    if (this.over) return false;
    const r = isAutopilotEnd(reason) ? reason : 'error';
    this.over = true;
    this.begun = true;
    this.why = r;
    this.stopped = this.runHalt(r);
    const ev: AutopilotRunEvent = { phase: 'ended', runId: this.runId, n: this.n, limit: this.limit, reason: r };
    if (spend && isSpendUnit(spend.unit) && typeof spend.value === 'number' && Number.isFinite(spend.value) && spend.value >= 0) ev.spend = { unit: spend.unit, value: spend.value };
    this.send(ev);
    return true;
  }

  /** The adapter's own stop or clear failed or was not confirmed in time (FR-054): the guard stays armed. */
  clearFailed(): void {
    this.failedClear = true;
    this.armed = true;
  }

  /** The app acknowledged the clear (Claude "Goal cleared", Codex `cleared: true`, Copilot `mode_changed` to `interactive`): the guard disarms. */
  confirmCleared(): void {
    this.failedClear = false;
    this.armed = false;
  }

  private timeUp(): boolean {
    if (this.now() - this.startedAtMs < this.hours * 3_600_000) return false;
    this.end('error');
    return true;
  }

  private guard(): ContinuationResult {
    if (!this.armed || this.why === undefined) return 'ignored';
    this.interrupts += 1;
    void this.runHalt(this.why);
    return 'interrupted';
  }

  /** Calls `halt` and settles without rejecting: a resolve disarms the guard (unless a clear failed on its own), a reject or throw arms it. */
  private runHalt(reason: AutopilotEnd): Promise<void> {
    let p: Promise<void>;
    try {
      p = Promise.resolve(this.o.halt(reason));
    } catch (e) {
      p = Promise.reject(e);
    }
    return p.then(
      () => { if (!this.failedClear) this.armed = false; },
      () => { this.armed = true; },
    );
  }

  private send(e: AutopilotRunEvent): void {
    try { this.o.emit(e); } catch { /* the run's state is the truth; a broken listener never changes it */ }
  }
}

export type GoalTextResult = { ok: true; text: string; warn?: 'long' } | { ok: false; reason: 'empty' | 'reserved' };

/**
 * FR-011, S2: the goal sent for a message. Each run of C0 (but newline), DEL and C1 characters becomes one space, so CRLF becomes a space and a
 * newline. Empty text and the word `clear` (it would run `/goal clear`) are refused with a reason; over 4000 characters on Claude Code is a
 * warning, not a refusal (D13). With no `app` the strictest rules (Claude Code's) apply. Linear in the input length; takes the user's text only.
 */
export function goalText(text: unknown, app?: 'claude' | 'codex' | 'copilot'): GoalTextResult {
  if (typeof text !== 'string') return { ok: false, reason: 'empty' };
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]+/g, ' ');
  const t = clean.trim();
  if (!t) return { ok: false, reason: 'empty' };
  if (t.toLowerCase() === 'clear') return { ok: false, reason: 'reserved' };
  const claude = app === undefined || app === 'claude';
  return claude && clean.length > GOAL_WARN_LENGTH ? { ok: true, text: clean, warn: 'long' } : { ok: true, text: clean };
}

/**
 * FR-020: a Claude Code continuation is a synthetic user message of the main stream whose text starts with `Stop hook feedback:`. A message the
 * user typed with the same words has no `isSynthetic: true`, and a helper's message (FR-008) carries an agent or parent id.
 */
export function isClaudeContinuation(msg: unknown): boolean {
  if (!isObj(msg) || msg.type !== 'user' || msg.isSynthetic !== true) return false;
  if (msg.agentId !== undefined || (msg.parent_tool_use_id !== undefined && msg.parent_tool_use_id !== null)) return false;
  const m = msg.message;
  if (!isObj(m)) return false;
  let text: unknown = m.content;
  if (Array.isArray(text)) {
    const first = text[0];
    text = isObj(first) && first.type === 'text' ? first.text : undefined;
  }
  return typeof text === 'string' && text.startsWith('Stop hook feedback:');
}

/** FR-040: a Codex goal status as an end reason; `active` and anything unknown is no end. */
export function codexGoalEnd(status: unknown): AutopilotEnd | null {
  switch (status) {
    case 'complete': return 'done';
    case 'budgetLimited':
    case 'usageLimited': return 'cap';
    case 'blocked':
    case 'paused': return 'blocked';
    default: return null;
  }
}

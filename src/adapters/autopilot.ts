/**
 * Spec 099 (Autopilot), the shared core: pure, no SDK, no I/O, no timers. All three adapters use it, so the rules are written once.
 * The adapters use it through `autopilotHost.ts`; nothing in main calls it before T030.
 */

import { isObj } from '../shared/guards';
import { HIDDEN_ALL_RE } from '../shared/names';
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
/** How often an adapter must call `checkElapsed()` (and the most a clock set back between two samples can delay the backstop is bounded by what it hid in one). */
export const CLOCK_SAMPLE_MS = 60_000;
/** FR-011: Claude Code's own limit: a goal over this many trimmed characters gets a plain-text refusal from the CLI, so Durbar refuses it first, with a reason (spec Changes, awaiting owner review). */
export const GOAL_MAX_CLAUDE = 4000;
/** FR-011: the words that make Claude Code's `/goal` clear the goal instead of setting one (CLI 2.1.316, `read:`), trimmed and case-insensitive. */
export const CLAUDE_GOAL_RESERVED: readonly string[] = ['clear', 'stop', 'off', 'reset', 'none', 'cancel'];
export const RUN_ID_MAX = 128;

/** FR-030: the one sentence every question gets. An exact constant: nothing the agent writes is ever put into it. */
export const AUTOPILOT_ANSWER = 'The user is away and will not answer. Decide by yourself, say what you chose, and keep going.' as const;

export const validLimit = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= MIN_LIMIT && v <= MAX_LIMIT;
export const validHours = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= MIN_HOURS && v <= MAX_HOURS;
/** A run id is 1 to 128 of letters, digits and `._:-`: nothing that can hide, break a line or end a string. */
export const validRunId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(v);
/** FR-021 (D13): the form and the native dialog warn above these; they never refuse. */
export const limitWarns = (limit: number): boolean => limit > LIMIT_WARN_ABOVE;
export const hoursWarn = (hours: number): boolean => hours > HOURS_WARN_ABOVE;
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
  /** Unique per run; 1 to 128 of letters, digits and `._:-`. */
  runId: string;
  /** Backstop time in hours; undefined = 2. */
  hours?: number;
  /**
   * The adapter's own FR-050 order (stop, clear), called with the end reason; it differs per app. Called once when the run ends, for every reason
   * (a `done` end still clears the goal, FR-041, and the adapter decides what that means), and again for each continuation that arrives
   * after the end. So `halt('done')` must really stop the app when a continuation comes: on Copilot, whose done keeps its mode (D8), the
   * adapter's `halt` must do a real stop (`mode.set interactive` and `abort`) for a repeat. It must resolve only when the app confirmed the
   * stop (FR-054); a rejection or throw keeps the guard armed.
   */
  halt: (reason: AutopilotEnd) => void | Promise<void>;
  /** Gets each event once, in order. Never throws into the run. */
  emit: (e: AutopilotRunEvent) => void;
  /**
   * The clock, in ms. Injected so tests need no timers. Only forward steps between two samples count, and a reading that is not a finite number ends
   * the run as `error` (fail closed). The core owns no timer: the adapter must call `checkElapsed()` at least every `CLOCK_SAMPLE_MS`, so a
   * step back can hide at most what happened inside one sample. `[KNOWN GAP]`: a step back between two samples still delays the end by its size.
   */
  now?: () => number;
  /** Backstop model turns per `limit + 1`: 100 (default; Copilot, Claude Code), 1 for Codex, which counts `turn/completed` (FR-021). A positive whole number. */
  backstopPer?: number;
}

/** What `continuation()` did with the call. */
export type ContinuationResult = 'counted' | 'ended' | 'interrupted';

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
  private readonly per: number;
  private lastNow: number;
  private elapsedMs = 0;
  private clockBad: boolean;
  private seq = 0;
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
    const per = o.backstopPer === undefined ? BACKSTOP_TURNS_PER : o.backstopPer;
    if (!(typeof per === 'number' && Number.isInteger(per) && per >= 1 && per <= BACKSTOP_TURNS_PER)) throw new RangeError('Autopilot backstopPer must be a whole number from 1 to 100');
    this.per = per;
    const t0 = this.now();
    this.clockBad = !(typeof t0 === 'number' && Number.isFinite(t0));
    this.lastNow = this.clockBad ? 0 : t0;
  }

  /** Continuations that ran so far; never above `limit`. */
  get count(): number { return this.n; }
  get ended(): boolean { return this.over; }
  get reason(): AutopilotEnd | undefined { return this.why; }
  /** True from the end until the newest `halt` is confirmed, and after `clearFailed()` (FR-054). Any continuation after the end repeats the stop. */
  get guardArmed(): boolean { return this.armed; }
  /** How many continuations after the end were interrupted. */
  get guardInterrupts(): number { return this.interrupts; }
  /** The most turns the backstop allows before it ends the run: `backstopPer * (limit + 1)` (100 by default, 1 for Codex). */
  get backstopTurns(): number { return this.per * (this.limit + 1); }
  /** About when the backstop ends the run, on the injected clock, for the adapter's one timer; it moves later if the clock was set back. `checkElapsed()` decides. */
  get deadlineMs(): number { return this.lastNow + Math.max(0, this.hours * 3_600_000 - this.elapsedMs); }
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
    if (this.over) return 'ended'; // an owner that ended the run from the `started` event
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
    this.armed = true; // armed from the moment of the end until a halt is confirmed (FR-054)
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
    const t = this.now();
    if (this.clockBad || !(typeof t === 'number' && Number.isFinite(t))) {
      this.clockBad = true;
      this.end('error'); // a clock that gives no time cannot bound the run: fail closed
      return true;
    }
    if (t > this.lastNow) this.elapsedMs += t - this.lastNow;
    this.lastNow = t;
    if (this.elapsedMs < this.hours * 3_600_000) return false;
    this.end('error');
    return true;
  }

  /** A continuation after the end: the app is still going, so the stop is repeated, whether or not the first one was confirmed. Not counted. */
  private guard(): ContinuationResult {
    this.interrupts += 1;
    this.armed = true;
    void this.runHalt(this.why ?? 'error');
    return 'interrupted';
  }

  /**
   * Calls `halt` and settles without rejecting. Only the newest call decides: its resolve disarms the guard (unless a clear failed on its
   * own), its reject or throw keeps it armed; an older call that settles late changes nothing.
   */
  private runHalt(reason: AutopilotEnd): Promise<void> {
    const id = ++this.seq;
    let p: Promise<void>;
    try {
      p = Promise.resolve(this.o.halt(reason));
    } catch (e) {
      p = Promise.reject(e);
    }
    return p.then(
      () => { if (id === this.seq && !this.failedClear) this.armed = false; },
      () => { if (id === this.seq) this.armed = true; },
    );
  }

  private send(e: AutopilotRunEvent): void {
    try { this.o.emit(e); } catch { /* the run's state is the truth; a broken listener never changes it */ }
  }
}

export type GoalTextResult = { ok: true; text: string } | { ok: false; reason: 'empty' | 'reserved' | 'too-long' | 'command' };

/** Hidden characters removed from a goal: `HIDDEN_ALL_RE` plus the bidi marks it leaves (LRM, RLM, ALM, the deprecated U+206A-F) and the tag characters. ZWNJ and ZWJ stay: real scripts need them. */
const GOAL_HIDDEN_RE = /[\u200e\u200f\u061c\u206a-\u206f]|[\u{e0000}-\u{e007f}]/gu;
/** A slash command: the line starts with `/word`, and that first word holds no further `/` (so `/usr/bin/env` and `/ foo` are not one). */
const SLASH_COMMAND_RE = /^\/[^\s/]+(?:\s|$)/;

/**
 * FR-011, S2: the goal sent for a message. U+2028/9 become a newline (two words never join); the other hidden characters (bidi, zero-width space,
 * tag characters, the rest of `HIDDEN_ALL_RE`; ZWNJ and ZWJ stay) are removed; each run of C0 (but newline), DEL and C1 characters becomes
 * one space, so CRLF becomes a space and a newline. Text with no visible character (spaces and joiners only) is `empty`, for every app.
 * On Claude Code (and with no `app`, the strictest rules) it also refuses: a whole text that is one of `CLAUDE_GOAL_RESERVED` (the CLI would
 * clear the goal), a trimmed text over 4000 characters (the CLI refuses it in plain text), and a line shaped like a slash command (`/word`, no
 * further `/` in that word; a safe default, awaiting owner review). Linear in the input length; takes the user's text only.
 */
export function goalText(text: unknown, app?: 'claude' | 'codex' | 'copilot'): GoalTextResult {
  if (typeof text !== 'string') return { ok: false, reason: 'empty' };
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u2028\u2029]/g, '\n').replace(HIDDEN_ALL_RE, '').replace(GOAL_HIDDEN_RE, '').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]+/g, ' ');
  const t = clean.trim();
  if (!t || !/[^\s\u200c\u200d]/.test(t)) return { ok: false, reason: 'empty' };
  if (app === undefined || app === 'claude') {
    if (t.length > GOAL_MAX_CLAUDE) return { ok: false, reason: 'too-long' };
    if (CLAUDE_GOAL_RESERVED.includes(t.toLowerCase())) return { ok: false, reason: 'reserved' };
    if (clean.split('\n').some((line) => SLASH_COMMAND_RE.test(line.replace(/^[\s\u200c\u200d]+/, '')))) return { ok: false, reason: 'command' };
  }
  return { ok: true, text: clean };
}

/**
 * FR-020: a Claude Code continuation is a synthetic user message of the main stream (`agentId` and `parent_tool_use_id` missing or null) with a text block that starts with `Stop hook feedback:`. A message the
 * user typed with the same words has no `isSynthetic: true`, and a helper's message (FR-008) carries an agent or parent id or `isSidechain: true`.
 */
export function isClaudeContinuation(msg: unknown): boolean {
  if (!isObj(msg) || msg.type !== 'user' || msg.isSynthetic !== true || msg.isSidechain === true) return false;
  if ((msg.agentId !== undefined && msg.agentId !== null) || (msg.agent_id !== undefined && msg.agent_id !== null) || (msg.parent_tool_use_id !== undefined && msg.parent_tool_use_id !== null)) return false; // `agent_id`: the name the CLI's stream uses (`claudeMap.ts` `who()`)
  const m = msg.message;
  if (!isObj(m)) return false;
  const content = m.content;
  const marked = (t: unknown): boolean => typeof t === 'string' && t.startsWith('Stop hook feedback:');
  if (typeof content === 'string') return marked(content);
  return Array.isArray(content) && content.some((b) => isObj(b) && b.type === 'text' && marked(b.text));
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

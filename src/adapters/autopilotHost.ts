/**
 * Spec 099 Phase 2: what every adapter does around one `AutopilotRun`, written once: the settings a session is on, the run, the wait for the app's
 * answer (FR-054), the time backstop's clock sample (FR-021), S3 and the fixed chat lines. The rules themselves stay in the core (`autopilot.ts`).
 * No SDK and no vendor word: each adapter passes its own FR-050 order as `halt`.
 */
import { randomUUID } from 'crypto';
import { AUTOPILOT_ANSWER, AutopilotRun, CLOCK_SAMPLE_MS, hoursOrDefault, limitOrDefault } from './autopilot';
import type { GoalTextResult } from './autopilot';
import type { AskedQuestion, AutopilotEnd, AutopilotEvent, AutopilotSettings } from './types';
import type { EventBody } from './map';

/**
 * False until T030 gives `setAutopilot` a caller in main. Until then nothing can set a goal, so a resume in a real session sends no clear
 * (FR-053's no-goal case is not probed: T091, T092, T094). An adapter on which `setAutopilot` was called clears on every later resume whatever this says.
 * `scripts/test-autopilot-reach.ts` fails if main calls `setAutopilot` while this is false.
 */
export const AUTOPILOT_WIRED = false as boolean;

/** FR-054 (proposed): how long Durbar waits for the app to confirm a stop or a clear. */
export const CLEAR_WAIT_MS = 10_000;

export const AUTOPILOT_NOT_ALLOW = 'Autopilot runs only in Allow all.';
export const AUTOPILOT_ONE_RUN = 'An Autopilot run is already going. Stop it first.';
export const AUTOPILOT_WAIT_TURN = 'The agent is still working on an earlier message. Wait for it to end, then send this to start the Autopilot run.';
export const AUTOPILOT_NO_PLAN = 'Plan first is not available on Autopilot yet.';
export const AUTOPILOT_TEXT_ONLY = 'On Autopilot this app takes text only: its goal is set from your message. Remove the attachment and send again.';
/** FR-005. */
export const LINE_CLOSED = 'Autopilot ended when this session closed. It is in Allow all.';
/** FR-054. */
export const LINE_UNCONFIRMED = "Durbar could not confirm that Autopilot stopped, so it ended this session's process.";
export const lineNotCleared = (why: string): string => `Durbar could not clear this session's goal, so nothing was sent: ${why}`.slice(0, 300);
/** FR-021. */
export const LINE_BACKSTOP = "Durbar could not confirm this run's turns, so it stopped it.";
/** FR-006. */
export const LINE_SELF_STARTED = 'The agent app started its own goal loop without Durbar, so Durbar turned it off. A goal runs only on Autopilot, which counts its turns.';
/** FR-022. */
export const LINE_CAP_NOT_RESTORED = "Durbar could not put this session's own spending limit back after Autopilot, so the tighter one stays in force.";

/** Test seams; production passes nothing. */
export interface AutopilotTuning {
  now?: () => number;
  waitMs?: number;
  /** Replaces the backstop's repeating clock sample. Returns its cancel. */
  setTimer?: (fn: () => void, ms: number) => () => void;
  /** Replaces `AUTOPILOT_WIRED` (FR-053 tests). */
  clearFirst?: boolean;
}

export interface AutopilotPorts {
  /** The app's own FR-050 order for this reason. Resolves only when the app confirmed it. */
  halt: (reason: AutopilotEnd) => Promise<void>;
  /** A later continuation arrived while `halt` waits for the app: interrupt the turn again; the goal clear already sent stands. */
  interruptAgain: () => void;
  /** FR-054: `halt` failed or got no answer in time. Ends the session and kills its child where it has one. */
  failClosed: () => Promise<void>;
  /** `halt` was confirmed: restore the cap (FR-022). */
  settled: (reason: AutopilotEnd) => void | Promise<void>;
  emit: (body: EventBody) => void;
  spend?: () => AutopilotEvent['spend'];
  /** FR-021: what the adapter feeds `backstopTurn()` per `limit + 1`, when it is not the core's default. */
  backstopPer?: number;
}

/** Resolves or rejects with `p`, or rejects after `ms`. */
export function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([p, new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`${what} did not answer in time`)), ms); })]).finally(() => clearTimeout(timer));
}

/** The lower of the session's own cap and the Autopilot cap (FR-022). */
export function capInForce(own: number | null | undefined, auto: number | undefined): number | null {
  const a = own ?? null;
  if (auto === undefined) return a;
  return a === null ? auto : Math.min(a, auto);
}

/** Why a goal text was refused, in words for the chat (FR-011). */
export function goalRefusal(r: Exclude<GoalTextResult, { ok: true }>): string {
  switch (r.reason) {
    case 'empty': return 'Write what the finished result should be.';
    case 'too-long': return 'Claude Code takes a goal of at most 4000 characters. Shorten it and send again.';
    case 'command': return 'A goal cannot hold a line that starts with a slash: Claude Code could run it as a command. Reword it and send again.';
    default: return 'On Claude Code that word would clear the goal instead of setting one. Describe the finished result in other words.';
  }
}

/** FR-030: a question shown as decided, answered with the one fixed sentence. Nothing the agent wrote goes into the answer. */
export function emitAutoAnswered(emit: (b: EventBody) => void, requestId: string, questions: AskedQuestion[]): void {
  emit({ type: 'question', phase: 'asked', requestId, questions, autoAnswered: true });
  emit({ type: 'question', phase: 'answered', requestId, answers: Object.fromEntries(questions.map((q) => [q.question, AUTOPILOT_ANSWER])), autoAnswered: true });
}

/** One session's Autopilot state. Held by the main session only (FR-008); never saved (FR-005). */
export class AutopilotState {
  settings?: AutopilotSettings;
  run?: AutopilotRun;
  private halting?: Promise<void>;
  private quiet = false;
  private ownEnd = false;
  private backstopped = false;
  private closing = false;
  private cancelTimer?: () => void;

  constructor(private readonly ports: AutopilotPorts, private readonly tuning: AutopilotTuning = {}) {}

  get on(): boolean { return this.settings !== undefined; }
  get running(): boolean { return !!this.run && !this.run.ended; }

  /** Throws on a bad limit or hours (the core's bounds). The cap was checked by the adapter, in its own unit. */
  turnOn(s: AutopilotSettings): void {
    this.settings = { limit: limitOrDefault(s.limit), hours: hoursOrDefault(s.hours), ...(s.cap !== undefined ? { cap: s.cap } : {}) };
  }

  /** A new run for the message being sent (FR-020). */
  begin(): AutopilotRun {
    const s = this.settings;
    if (!s) throw new Error('This session is not on Autopilot.');
    const run = new AutopilotRun({ limit: s.limit, hours: s.hours, runId: randomUUID(), halt: (r) => this.halt(r), emit: (e) => this.onRun(e), ...(this.ports.backstopPer ? { backstopPer: this.ports.backstopPer } : {}), ...(this.tuning.now ? { now: this.tuning.now } : {}) });
    this.run = run;
    run.start();
    this.armTimer(run);
    return run;
  }

  /** An end the adapter read from its app (not a bound): `error` here is not the backstop. */
  finish(reason: AutopilotEnd): void {
    this.ownEnd = true;
    this.run?.end(reason);
    this.ownEnd = false;
  }

  /** FR-052: End session, quit, sign-in refresh: no card and no app call. The next resume clears first. */
  endQuietly(): void {
    this.quiet = true;
    this.run?.end('stopped');
    this.quiet = false;
    this.settings = undefined;
    this.run = undefined;
    this.cancelTimer?.();
  }

  private armTimer(run: AutopilotRun): void {
    const fire = (): void => { run.checkElapsed(); };
    if (this.tuning.setTimer) { this.cancelTimer = this.tuning.setTimer(fire, CLOCK_SAMPLE_MS); return; }
    const t = setInterval(fire, CLOCK_SAMPLE_MS); // the core owns no timer and samples the clock only here (FR-021)
    t.unref?.();
    this.cancelTimer = () => clearInterval(t);
  }

  private onRun(e: Parameters<NonNullable<ConstructorParameters<typeof AutopilotRun>[0]['emit']>>[0]): void {
    if (this.quiet) return;
    if (e.phase !== 'ended') { this.ports.emit({ type: 'autopilot', ...e }); return; }
    this.cancelTimer?.();
    if (e.reason === 'error' && !this.ownEnd) this.backstopped = true;
    if (e.reason !== 'done') this.settings = undefined; // S3, D8
    const spend = e.spend ?? this.ports.spend?.();
    this.ports.emit({ type: 'autopilot', ...e, ...(spend ? { spend } : {}) });
  }

  private halt(reason: AutopilotEnd): Promise<void> {
    if (this.quiet) return Promise.resolve();
    if (this.halting) {
      this.ports.interruptAgain();
      return this.halting;
    }
    const p = within(this.ports.halt(reason), this.tuning.waitMs ?? CLEAR_WAIT_MS, 'The agent app').then(
      async () => {
        if (this.backstopped) this.ports.emit({ type: 'status', status: 'idle', intent: LINE_BACKSTOP });
        this.backstopped = false;
        await this.ports.settled(reason);
      },
      async (e: unknown) => {
        await this.close();
        throw e;
      },
    ).finally(() => { this.halting = undefined; });
    this.halting = p;
    return p;
  }

  /** FR-054: once only. The run keeps the reason it was ending with. */
  async close(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    await this.ports.failClosed().catch(() => undefined);
    this.ports.emit({ type: 'status', status: 'stopped', intent: LINE_UNCONFIRMED });
  }
}

/**
 * Self-paced loops (spec 072 T006-T008): main's wiring, as pure functions that `main.ts` calls and `test:loops` drives with a real
 * `Scheduler`. No Electron. The loop core is `schedules.ts`; this file only routes events, reads holds, adds the footer and words the
 * activity rows and the window's push. Nothing here logs, and no row or push carries the prompt or the reply.
 */
import type { AgentEvent } from '../adapters/types';
import type { ActivityDecision } from '../shared/activity';
import { loopFooter } from '../shared/looppace';
import type { LoopNote, LoopWait, Schedule, Scheduler } from './schedules';

export type LoopSink = Pick<Scheduler, 'noteUsage' | 'noteFinalText' | 'turnEnded' | 'holdsChanged'>;

/**
 * The scheduler's share of `router.onEvent` (spec 044 FR-015, spec 072 FR-010, FR-015). Call it after `agentState` and the last status
 * have taken the event, so a hold reads the new state.
 * - every `usage` event of the session, a helper's too and one after `idle`, goes to `noteUsage` (the run or loop in progress there);
 * - only the main agent's (no `agentId`) final `output` is a pass's text; a sub-agent's never is;
 * - the main agent's `idle`, `error` or `stopped` ends the turn; `stopped` and an `Aborted` idle (Stop) say the pass was stopped;
 * - a status, question, limit or usage-limit event may start or clear a hold.
 */
export function routeLoopEvent(e: AgentEvent, sch: LoopSink | undefined): void {
  if (!sch) return;
  if (e.type === 'usage') return sch.noteUsage(e.sessionId, e);
  if (e.type === 'limit') return sch.holdsChanged(e.sessionId); // a limit is the session's, whoever reported it
  if (e.agentId) return;
  if (e.type === 'output') {
    if (e.final) sch.noteFinalText(e.sessionId, e.text);
    return;
  }
  if (e.type === 'status' && (e.status === 'idle' || e.status === 'error' || e.status === 'stopped')) {
    sch.turnEnded(e.sessionId, { error: e.status === 'error', stopped: e.status === 'stopped' || e.intent === 'Aborted' });
  }
  if (e.type === 'status' || e.type === 'question' || e.type === 'usageLimit') sch.holdsChanged(e.sessionId);
}

/**
 * Spec 072 FR-015/FR-017, the scheduler's `waitOf`: Durbar's spending cap (a `limit` request, spec 011) pauses the loop until Resume
 * (owner Q5); a pending permission or an open question holds it until answered. A coffee break is T020; until then it is a busy skip
 * (`scheduleBusy` counts `onBreak`), so no pass goes into it.
 */
export function loopWaitOf(id: string, d: { status(id: string): string | undefined; waits(id: string): { question: boolean; limit: boolean } | undefined }): LoopWait | undefined {
  const w = d.waits(id);
  if (w?.limit) return 'cap';
  if (w?.question || d.status(id) === 'needs-permission') return 'person';
  return undefined;
}

/** Spec 072 FR-009: the text a run sends: a loop pass gets Durbar's fixed footer (its pass number and limits); any other schedule is sent as typed. */
export function loopPrompt(prompt: string, s: Pick<Schedule, 'loop'>): string {
  return s.loop ? prompt + loopFooter(s.loop, s.loop.passes ?? 1) : prompt;
}

const capText = (c: NonNullable<Schedule['cap']>): string => (c.unit === 'usd' ? `$${c.amount.toFixed(2)}` : `${c.amount} AI credits`);
const HOLD_WORDS: Record<Extract<LoopNote, { kind: 'hold' }>['why'], string> = {
  person: 'Loop waits for you',
  'pause-all': 'Loop waits: schedules are paused (Pause all)',
  break: 'Loop waits: coffee break',
  cap: 'Loop paused at the spending limit; it needs Resume',
};

/**
 * Spec 072 FR-024, SC-005: the activity row of a loop note (spec 052): one per start, pass, skip, hold and end; a pass that only went
 * out has none (its row comes when it ends). Numbers, fixed words and the agent's cleaned reason; never the prompt or the reply.
 */
export function loopActivity(n: LoopNote, s: Pick<Schedule, 'loop' | 'cap'>): { decision: ActivityDecision; action: string } | undefined {
  const l = s.loop;
  if (!l) return undefined;
  switch (n.kind) {
    case 'start':
      return { decision: 'loop-start', action: `Loop started: at most ${l.maxPasses} passes, ${l.minDelay} to ${l.maxDelay} min apart, ${s.cap ? `limit ${capText(s.cap)}` : 'bounded by passes and time only'}` };
    case 'sent':
      return undefined;
    case 'pass': {
      const head = `Loop pass ${n.pass} of ${l.maxPasses}${n.failed ? ' failed' : ''}`;
      if (n.ended || n.minutes === undefined) return { decision: 'loop-pass', action: head };
      const why = n.source === 'clamped' && n.asked !== undefined ? `asked ${n.asked} min (${n.minutes < n.asked ? 'maximum' : 'minimum'})` : n.reason;
      return { decision: 'loop-pass', action: `${head} · next in ${n.minutes} min${why ? `: ${why}` : ''}` };
    }
    case 'skip':
      return { decision: 'loop-skip', action: n.why === 'busy' ? 'Loop pass skipped: the agent was busy' : 'Loop pass skipped: the prompt is too long' };
    case 'hold':
      return { decision: 'loop-hold', action: HOLD_WORDS[n.why] };
    case 'end':
      return { decision: 'loop-end', action: `Loop: ${n.text}` };
  }
}

/** Spec 072 FR-023: the window's `loop:pass` push, for the chat note of a pass (T012 shows it). Ids, numbers and the cleaned reason or end text only. */
export interface LoopPassPush {
  agentId: string;
  scheduleId: string;
  /** `sent`: pass N went out; `next`: it ended and the next wake is `next`; `end`: the loop ended (`ended` is the row's text). */
  phase: 'sent' | 'next' | 'end';
  pass?: number;
  maxPasses: number;
  next?: number;
  reason?: string;
  ended?: string;
}

export function loopPush(n: LoopNote, s: Pick<Schedule, 'id' | 'loop' | 'target'>): LoopPassPush | undefined {
  const agentId = s.target?.session;
  if (!agentId || !s.loop) return undefined;
  const base = { agentId, scheduleId: s.id, maxPasses: s.loop.maxPasses };
  if (n.kind === 'sent') return { ...base, phase: 'sent', pass: n.pass };
  if (n.kind === 'pass' && !n.ended && n.next !== undefined) return { ...base, phase: 'next', pass: n.pass, next: n.next, ...(n.reason ? { reason: n.reason } : {}) };
  if (n.kind === 'end') return { ...base, phase: 'end', ended: n.text };
  return undefined;
}

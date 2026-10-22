/**
 * Self-paced loops (spec 072): how a looping agent asks for its next turn. Pure, no Node or Electron, shared with the simulator.
 * Phase 1 reads one fixed line at the end of the reply: `LOOP: next 25 min - waiting for CI` or `LOOP: stop - all merged` (FR-010).
 * Every pattern is anchored with no nested or overlapping quantifier, so matching is linear in the (at most 200 character) line.
 */
import { redact } from './redact';

/** Owner Q1/Q2 defaults (2026-10-22) and the FR-003 bounds. */
export const LOOP_DEFAULTS = { defaultDelay: 30, minDelay: 5, maxDelay: 60, maxPasses: 12, endHours: 8, capAiu: 50, capUsd: 0.5 } as const;
export const LOOP_MIN_DELAY = 5;
export const LOOP_MAX_DELAY = 1440;
export const LOOP_MAX_PASSES = 100;
export const LOOP_MAX_HOURS = 24;
export const PACE_LINE_MAX = 200;
export const REASON_MAX = 120;

export type PaceRequest = { kind: 'next'; minutes: number; reason?: string } | { kind: 'stop'; reason?: string };
export interface DelayLimits {
  minDelay: number;
  maxDelay: number;
}

// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\u061c\ufeff\u2028\u2029]/g;
const SEP = '[-\\u2013\\u2014]';
const NEXT_RE = new RegExp(`^loop:[ \\t]*next[ \\t]+(\\d{1,6})[ \\t]*(min(?:utes?)?|h(?:ours?)?)(?:[ \\t]+${SEP}(?:[ \\t]+(.*))?)?$`, 'i');
const STOP_RE = new RegExp(`^loop:[ \\t]*stop(?:[ \\t]+${SEP}(?:[ \\t]+(.*))?)?$`, 'i');

/** FR-010: a reason as one line of at most 120 characters: control, bidi and zero-width characters removed, `redact()`ed. Undefined when nothing is left. */
export function cleanReason(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  // clean first (a zero-width character cannot split a secret), redact, then cut
  const one = v.slice(0, 1000).replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim();
  const r = redact(one).replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim().slice(0, REASON_MAX).trim();
  return r || undefined;
}

/** FR-010: the pace request in the last non-empty line of a final message; undefined ("no line") for anything else. */
export function parsePace(text: unknown): PaceRequest | undefined {
  if (typeof text !== 'string') return undefined;
  const lines = text.slice(-4000).split('\n');
  let line = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    line = lines[i].trim();
    if (line) break;
  }
  if (!line || line.length > PACE_LINE_MAX) return undefined;
  const n = NEXT_RE.exec(line);
  if (n) {
    const reason = cleanReason(n[3]);
    const minutes = Number(n[1]) * (n[2].toLowerCase().startsWith('h') ? 60 : 1);
    return reason ? { kind: 'next', minutes, reason } : { kind: 'next', minutes };
  }
  const s = STOP_RE.exec(line);
  if (s) {
    const reason = cleanReason(s[1]);
    return reason ? { kind: 'stop', reason } : { kind: 'stop' };
  }
  return undefined;
}

/** FR-011: the asked delay inside the loop's limits. `clamped` says the ask was moved; a non-number is not an ask. */
export function clampPace(minutes: unknown, loop: DelayLimits): { minutes: number; source: 'agent' | 'clamped' } {
  const m = typeof minutes === 'number' && Number.isFinite(minutes) ? Math.round(minutes) : loop.minDelay;
  const c = Math.min(loop.maxDelay, Math.max(loop.minDelay, m));
  return { minutes: c, source: c === m && m === minutes ? 'agent' : 'clamped' };
}

/** FR-009: the fixed instruction added to a pass. Only numbers from the loop's own limits; no path, secret or outside text; at most 400 characters. */
export function loopFooter(loop: DelayLimits & { maxPasses: number }, pass: number, mode: 'line' | 'tool' = 'line'): string {
  const n = Math.max(1, Math.floor(pass) || 1);
  const head = `[Durbar loop: pass ${n} of ${loop.maxPasses}. Wait ${loop.minDelay} to ${loop.maxDelay} min between passes.]`;
  const ask =
    mode === 'tool'
      ? 'When this pass is done, call schedule_next(minutes, reason) to pick the next wake, or stop_loop(reason) when the work is finished.'
      : `When this pass is done, end your reply with one last line: "LOOP: next <N> min - <reason>" or, when the work is finished, "LOOP: stop - <reason>".`;
  return `\n\n${head} ${ask} Without it the default wait applies, and two passes without it end the loop.`;
}

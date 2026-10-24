/**
 * Spec 068 (coffee break): small, pure helpers the adapters share to turn an agent app's usage-limit signal into the normalized
 * `usageLimit` event. Agent-neutral; no vendor type leaves the adapter (constitution II).
 */

const DAY = 86_400_000;

/** Spec 068 FR-002: the words of the closing status; display text only (the break keys on `reason`). */
export const USAGE_LIMIT_INTENT = 'Usage limit reached';

/**
 * The `idle` status every adapter emits after its `usageLimit` to close the turn quietly (a coffee break, not an error). One builder,
 * so the marker `reason: 'usage-limit'` and the words are the same in every adapter (test-coffeebreak checks each mapper's output).
 */
export function usageLimitClosing(): { type: 'status'; status: 'idle'; intent: string; reason: 'usage-limit' } {
  return { type: 'status', status: 'idle', intent: USAGE_LIMIT_INTENT, reason: 'usage-limit' };
}

/**
 * A reset time as epoch ms: a number in seconds (below 1e12) or ms, a digit string, or an ISO date. Anything else, a time that
 * is not in the future or more than 31 days ahead (spec 068 edge cases: "in the past or absurd" means unknown) gives undefined:
 * a past reset for a limit that just hit is stale, and taken as known it would resume at once (2026-10-22).
 */
export function resetMs(v: unknown, now = Date.now()): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{9,13}$/.test(v) ? Number(v) : typeof v === 'string' ? Date.parse(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const ms = n < 1e12 ? n * 1000 : n;
  return ms > now && ms < now + 31 * DAY ? Math.round(ms) : undefined;
}

/**
 * Copilot `account.getQuota` answer (`{ quotaSnapshots: { premium_interactions: { resetDate, resetDateEpochMs?, resetDateEstimated? } } }`,
 * `read:` @github/copilot-sdk typings, @experimental): when the premium-request quota resets. Prefers the premium snapshot, then any
 * snapshot with no requests left. Undefined when nothing usable is there.
 */
export function copilotQuotaReset(result: unknown, now = Date.now()): { resetsAt: number; estimated: boolean } | undefined {
  const snaps = result && typeof result === 'object' ? (result as { quotaSnapshots?: unknown }).quotaSnapshots : undefined;
  if (!snaps || typeof snaps !== 'object') return undefined;
  const list = Object.entries(snaps as Record<string, unknown>).filter(([, v]) => v && typeof v === 'object') as [string, Record<string, unknown>][];
  const pick = list.find(([k]) => k === 'premium_interactions') ?? list.find(([, v]) => v.remainingPercentage === 0);
  if (!pick) return undefined;
  const v = pick[1];
  const resetsAt = resetMs(v.resetDateEpochMs, now) ?? resetMs(v.resetDate, now);
  return resetsAt ? { resetsAt, estimated: v.resetDateEstimated === true } : undefined;
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Spec 068 FR-025: the next time the wall clock of `tz` (an IANA name; the local zone when absent or unknown) reads `hour:minute`, on
 * `weekday` (0 = Sunday) when given; epoch ms, or undefined when none within 8 days. Scans a quarter-hour apart (about 770 steps); it is only run when a limit hits.
 */
export function nextClockTime(hour: number, minute: number, tz: string | undefined, weekday: number | undefined, now = Date.now()): number | undefined {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-US', { ...(tz ? { timeZone: tz } : {}), hourCycle: 'h23', hour: '2-digit', minute: '2-digit', weekday: 'short' });
  } catch {
    return nextClockTime(hour, minute, undefined, weekday, now); // an unknown zone name: the local clock, still a plausible time
  }
  // every zone's offset is a multiple of 15 minutes, so the minute of the hour repeats every 15: scan a quarter-hour apart
  const first = Math.floor(now / 60_000) + 1;
  const start = (first + ((((minute - first) % 15) + 15) % 15)) * 60_000;
  for (let t = start; t <= now + 8 * DAY; t += 15 * 60_000) {
    const p = Object.fromEntries(fmt.formatToParts(t).map((x) => [x.type, x.value]));
    if (Number(p.hour) !== hour || Number(p.minute) !== minute) continue;
    if (weekday !== undefined && WEEKDAYS.indexOf(String(p.weekday).slice(0, 3).toLowerCase()) !== weekday) continue;
    return t;
  }
  return undefined;
}

/**
 * Spec 068 FR-025: Claude Code's own limit sentence, "You've hit your weekly limit · resets 2am (Europe/Zurich)" (older: "5-hour limit
 * reached ∙ resets 3pm"). It is what the CLI answers, as a synthetic assistant message and the closing error result, when the limit is
 * still active and no `rate_limit_event` came first (a Retry after the break). Returns the window label (fixed words, never the text)
 * and the reset it names, when it reads one. Null when the text is not a limit sentence.
 */
export function claudeLimitText(text: unknown, now = Date.now()): { window: 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | undefined; resetsAt?: number } | null {
  if (typeof text !== 'string' || text.length > 2000) return null;
  const m = /\bhit your ([a-z0-9 -]{0,30}?)\s*limit\b/i.exec(text) ?? /\b([a-z0-9 -]{1,30}?)\s+limit reached\b/i.exec(text);
  if (!m) return null;
  const w = m[1].toLowerCase();
  const window = /week|7-day|seven|opus|sonnet/.test(w) ? (/opus/.test(w) ? 'seven_day_opus' : /sonnet/.test(w) ? 'seven_day_sonnet' : 'seven_day') : /5-hour|five|session/.test(w) ? 'five_hour' : undefined;
  // only a clear plan limit: a recognised window, or a reset named ("hit your context limit" and the like stay errors)
  const namesReset = /\bresets?\b/i.test(text);
  if (!window && !namesReset) return null;
  const r = /\bresets?\s+(?:(sun|mon|tue|wed|thu|fri|sat)[a-z]*,?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b(?:\s*\(([A-Za-z0-9_+\-/]{1,40})\))?/i.exec(text);
  let resetsAt: number | undefined;
  if (r) {
    const h12 = Number(r[2]);
    if (h12 >= 1 && h12 <= 12 && Number(r[3] ?? 0) < 60) {
      const hour = (h12 % 12) + (r[4].toLowerCase() === 'pm' ? 12 : 0);
      resetsAt = resetMs(nextClockTime(hour, Number(r[3] ?? 0), r[5], r[1] ? WEEKDAYS.indexOf(r[1].toLowerCase()) : undefined, now), now);
    }
  }
  return { window, ...(resetsAt ? { resetsAt } : {}) };
}

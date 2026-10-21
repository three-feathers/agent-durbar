/**
 * Spec 068 (coffee break): small, pure helpers the adapters share to turn an agent app's usage-limit signal into the normalized
 * `usageLimit` event. Agent-neutral; no vendor type leaves the adapter (constitution II).
 */

const DAY = 86_400_000;

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

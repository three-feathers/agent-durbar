/**
 * Spec 011 FR-081 (issue #690): vendor quota answers to the neutral `QuotaRead`, and vendor errors to a fixed kind, so neither a vendor
 * shape nor its text leaves the adapter. Shapes are `read:` only (research matrix in the spec); main sanitises the result again.
 */
import { createHash, randomBytes } from 'crypto';
import { isAuthError } from './autherrors';
import { quotaTimeMs, quotaZoneOf } from '../shared/quota';
import type { QuotaFailureKind, QuotaRead } from '../shared/quota';

export const COPILOT_QUOTA_SOURCE = 'GitHub Copilot, account.getQuota (experimental; can lag a few minutes)';
export const CODEX_QUOTA_SOURCE = 'Codex, account/rateLimits/read';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (o: unknown, k: string): unknown => (isObj(o) && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const TEXT = (e: unknown): string => (e instanceof Error ? e.message : String(e ?? ''));

/** A fixed kind for a thrown error. Its text is only read here, and never kept. */
export function quotaFailureOf(e: unknown): QuotaFailureKind {
  const t = TEXT(e).slice(0, 2000);
  if (isAuthError(t)) return 'signed-out';
  // not the bare words "rate limits": Codex's method name is in all its errors ("failed to fetch codex rate limits: ...")
  if (/\b429\b|rate[ _-]?limit(ed|ing|\s+(exceeded|reached|hit))|too many requests/i.test(t)) return 'rate-limited';
  if (/timed? ?out/i.test(t)) return 'timeout';
  return 'unavailable';
}

/* FR-095: differs per run, so a fingerprint means nothing outside this process */
const KEY_SALT = randomBytes(16);

/** A one-way fingerprint of an account id, for comparing two reads in memory; undefined without one. Stored nowhere, never sent to the window. */
export function quotaAccountKey(...parts: unknown[]): string | undefined {
  if (!parts.some((p) => typeof p === 'string' && p)) return undefined;
  const h = createHash('sha256').update(KEY_SALT);
  for (const p of parts) h.update(typeof p === 'string' ? p : '').update('\0');
  return h.digest('hex').slice(0, 32);
}

/** The read with the fingerprint, where the kind can carry one. */
export function quotaWithKey(r: QuotaRead, accountKey: string | undefined): QuotaRead {
  return accountKey && r.kind !== 'not-reported' ? { ...r, accountKey } : r;
}

const COPILOT_LABEL: Readonly<Record<string, string>> = { premium_interactions: 'Premium requests', chat: 'Chat requests', completions: 'Code completions' };
const COPILOT_ORDER = ['premium_interactions', 'chat', 'completions'];

/** `account.getQuota`: `{ quotaSnapshots: { [type]: { entitlementRequests, usedRequests, remainingPercentage, isUnlimitedEntitlement, ... } } }`. */
export function copilotQuota(result: unknown): QuotaRead {
  const snaps = own(result, 'quotaSnapshots');
  if (!isObj(snaps)) return { kind: 'failed', failure: 'malformed' };
  const rank = (k: string): number => (COPILOT_ORDER.includes(k) ? COPILOT_ORDER.indexOf(k) : COPILOT_ORDER.length);
  const keys = Object.keys(snaps).sort((a, b) => rank(a) - rank(b));
  if (!keys.length) return { kind: 'not-reported', reason: 'none' };
  const buckets = keys.map((k) => {
    const v = snaps[k];
    const unlimited = own(v, 'isUnlimitedEntitlement') === true;
    const iso = own(v, 'resetDate');
    const at = quotaTimeMs(iso);
    // read: "Percentage of entitlement remaining" can go below zero past the limit: nothing is left, which is reported, not absent
    const raw = own(v, 'remainingPercentage');
    const left = typeof raw === 'number' && Number.isFinite(raw) && raw < 0 ? 0 : raw;
    const zone = quotaZoneOf(iso);
    return {
      id: k,
      label: Object.prototype.hasOwnProperty.call(COPILOT_LABEL, k) ? COPILOT_LABEL[k] : k.replace(/_+/g, ' '),
      unit: 'requests' as const,
      used: own(v, 'usedRequests'),
      ...(unlimited ? { unlimited } : { limit: own(v, 'entitlementRequests'), remainingPercent: left }),
      ...(at !== undefined ? { resetsAt: at } : {}),
      ...(zone ? { resetZone: zone } : {}),
      ...(own(v, 'overageAllowedWithExhaustedQuota') === true ? { overageAllowed: true } : {}),
    };
  });
  return { kind: 'ok', source: COPILOT_QUOTA_SOURCE, buckets: buckets as never };
}

function windowLabel(mins: unknown, which: string): string {
  if (mins === 300) return '5-hour window';
  if (mins === 10080) return 'Weekly window';
  return which === 'primary' ? 'Primary window' : 'Secondary window';
}

/** `account/rateLimits/read`: `{ rateLimits: { primary, secondary } }`, each `{ usedPercent, windowDurationMins, resetsAt }` or null. */
export function codexQuota(result: unknown): QuotaRead {
  const rl = own(result, 'rateLimits');
  if (!isObj(rl)) return { kind: 'failed', failure: 'malformed' };
  const buckets: unknown[] = [];
  for (const k of ['primary', 'secondary']) {
    const w = own(rl, k);
    if (w === null || w === undefined) continue;
    const mins = own(w, 'windowDurationMins');
    const at = quotaTimeMs(own(w, 'resetsAt'));
    buckets.push({ id: k, label: windowLabel(mins, k), unit: 'percent', usedPercent: own(w, 'usedPercent'), windowMins: mins, ...(at !== undefined ? { resetsAt: at } : {}) });
  }
  if (!buckets.length) return { kind: 'not-reported', reason: 'none' };
  return quotaWithKey({ kind: 'ok', source: CODEX_QUOTA_SOURCE, buckets: buckets as never }, quotaAccountKey(own(result, 'accountId')));
}

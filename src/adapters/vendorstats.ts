/**
 * Spec 085 FR-010/FR-013: what an agent app reports about a whole session, as counts only. No name, path or text ever: an agent app's
 * answer is bounded here (the adapter), again in main (`cleanVendorStats`) and again in the window. Pure: no SDK, no I/O.
 */

/** Totals a vendor reports for the session so far. Every member is a count; a missing member means "not reported". */
export interface VendorStats {
  /** Files the agent app says it changed (a count; the list of names is never kept). */
  files?: number;
  added?: number;
  removed?: number;
  /** Cost in nano-AI units (1e-9 AIU) as the vendor reported it. */
  nanoAiu?: number;
  /** User-initiated requests. */
  requests?: number;
}

const MAX = 1e12;
/** A finite, non-negative number, floored and bounded; anything else (strings, NaN, Infinity, negatives, objects) is undefined. */
export const boundedCount = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), MAX) : undefined);

const KEYS = ['files', 'added', 'removed', 'nanoAiu', 'requests'] as const;

/** Only the five known members, each a bounded count; `undefined` when none survives (so "nothing reported" is not a row of zeros). Own properties only. */
export function cleanVendorStats(v: unknown): VendorStats | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: VendorStats = {};
  for (const k of KEYS) {
    if (!Object.prototype.hasOwnProperty.call(v, k)) continue;
    const n = boundedCount((v as Record<string, unknown>)[k]);
    if (n !== undefined) out[k] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Copilot SDK `session.rpc.usage.getMetrics()` (`@experimental`, `read:` SDK 1.0.24): `codeChanges.filesModifiedCount` (else the length of
 * `filesModified`, whose names are dropped here), `linesAdded`, `linesRemoved`, `totalNanoAiu`, `totalUserRequests`.
 */
export function copilotVendorStats(r: unknown): VendorStats | undefined {
  if (!r || typeof r !== 'object') return undefined;
  const o = r as { codeChanges?: unknown; totalNanoAiu?: unknown; totalUserRequests?: unknown };
  const c = o.codeChanges && typeof o.codeChanges === 'object' ? (o.codeChanges as { filesModifiedCount?: unknown; filesModified?: unknown; linesAdded?: unknown; linesRemoved?: unknown }) : {};
  return cleanVendorStats({
    files: boundedCount(c.filesModifiedCount) ?? (Array.isArray(c.filesModified) ? c.filesModified.length : undefined),
    added: c.linesAdded,
    removed: c.linesRemoved,
    nanoAiu: o.totalNanoAiu,
    requests: o.totalUserRequests,
  });
}

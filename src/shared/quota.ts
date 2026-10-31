/**
 * Spec 011 FR-080..FR-090 (issue #690): what a provider itself reports about an account's limits, adapter-neutral. Pure, no imports,
 * so it also loads in the page as `../shared/quota.js` and the simulator runs the same steps as main (read through `window.exports`).
 * Never a bill, never a guess: an absent qFigure stays absent ("not reported", never zero), units are never mixed across apps (nothing
 * here takes two apps' figures together), and a failure is never shaped like a success.
 */

export type QuotaUnit = 'requests' | 'percent';
export type QuotaFailureKind = 'unavailable' | 'timeout' | 'malformed' | 'rate-limited' | 'signed-out';
export type QuotaReasonKind = 'no-read' | 'api-key' | 'unsupported' | 'none';
export type QuotaMode = 'cached' | 'open' | 'check';

/** One limit as the provider reports it. Every figure is optional; `requests` figures are in that unit, the `*Percent` ones in percent. */
export interface QuotaBucket {
  id: string;
  label: string;
  unit: QuotaUnit;
  used?: number;
  limit?: number;
  remaining?: number;
  usedPercent?: number;
  remainingPercent?: number;
  unlimited?: boolean;
  /** Epoch ms. */
  resetsAt?: number;
  /** The zone the provider gave with the time ("UTC", "+02:00"), when it gave one. */
  resetZone?: string;
  resetEstimated?: boolean;
  windowMins?: number;
  overageAllowed?: boolean;
}

/** What an adapter answers. No vendor type and no vendor text: a failure is a fixed kind. */
export type QuotaRead =
  | { kind: 'ok'; source: string; buckets: QuotaBucket[]; accountKey?: string }
  | { kind: 'not-reported'; reason: QuotaReasonKind }
  | { kind: 'failed'; failure: QuotaFailureKind; accountKey?: string };

/** Per app, in memory: no session id, nothing saved (FR-091). */
export interface QuotaEntry {
  /** `accountKey`: FR-095, a one-way fingerprint of the account, in main's memory only; `quotaView` never passes it on. */
  good?: { source: string; buckets: QuotaBucket[]; checkedAt: number; accountKey?: string };
  failure?: { kind: QuotaFailureKind; at: number; keyed?: boolean };
  reason?: { kind: QuotaReasonKind; at: number };
  askedAt?: number;
  backoffUntil?: number;
}

/** What the window gets per app (`harness:quota`). The state is worked out when painting (`quotaDisplay`), so it cannot go stale in transit. */
export interface QuotaView {
  app: string;
  source?: string;
  checkedAt?: number;
  buckets: QuotaBucket[];
  failure?: QuotaFailureKind;
  failedAt?: number;
  reason?: QuotaReasonKind;
  backoffUntil?: number;
  /** FR-095: nothing tells whose figures these are, so a sign-in change could not be noticed. Only this yes; never the fingerprint. */
  unkeyed?: boolean;
}

export type QuotaState = 'current' | 'stale' | 'failed-kept' | 'failed' | 'not-reported' | 'not-checked';

/** FR-094 (awaiting owner review): near a limit at or under this percent left, as a note only. */
export const NEAR_PERCENT = 10;
export const QUOTA_STALE_MS = 15 * 60_000;
export const QUOTA_OPEN_MS = 2 * 60_000;
export const QUOTA_CHECK_MS = 30_000;
export const QUOTA_BACKOFF_MS = 5 * 60_000;
export const QUOTA_TIMEOUT_MS = 8000;

const Q_MAX_NUMBER = 1e12;
const Q_MAX_BUCKETS = 8;
const Q_TEXT_MAX = 40;
const Q_SOURCE_MAX = 120;
const Q_FAR_MS = 400 * 86_400_000;

const Q_FAILURES: readonly string[] = ['unavailable', 'timeout', 'malformed', 'rate-limited', 'signed-out'];
const Q_REASONS: readonly string[] = ['no-read', 'api-key', 'unsupported', 'none'];

export const QUOTA_FAILURE_TEXT: Readonly<Record<QuotaFailureKind, string>> = {
  unavailable: 'the app did not give an answer.',
  timeout: 'no answer within the time limit.',
  malformed: 'the answer could not be understood.',
  'rate-limited': 'the provider asked for fewer requests, so Durbar waits 5 minutes before asking again.',
  'signed-out': 'the app says it is not signed in.',
};

export const QUOTA_REASON_TEXT: Readonly<Record<QuotaReasonKind, string>> = {
  'no-read': 'This app has no free, read-only call for its limits, so Durbar does not ask.',
  'api-key': 'This sign-in uses an API key, which has no plan limits to report.',
  unsupported: 'This version of the app has no call for its limits.',
  none: 'The provider answered without any figures.',
};

const qOwn = (o: unknown, k: string): unknown => (o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) ? (o as Record<string, unknown>)[k] : undefined);

/** One line of at most `max` characters with control and bidi characters removed; undefined when nothing is left or it is not a string. */
export function quotaText(v: unknown, max = Q_TEXT_MAX): string | undefined {
  if (typeof v !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const s = v.slice(0, max * 8).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function qFigure(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= Q_MAX_NUMBER ? v : undefined;
}
function qPercent(v: unknown): number | undefined {
  const n = qFigure(v);
  return n === undefined ? undefined : Math.min(n, 100);
}

/** A time as epoch ms: a number in seconds (below 1e12) or ms, a digit string, or a date string; undefined otherwise. Shared with `resetMs` (spec 068). */
export function quotaTimeMs(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{9,13}$/.test(v) ? Number(v) : typeof v === 'string' ? Date.parse(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n < 1e12 ? n * 1000 : n;
}

/** The zone written in an ISO 8601 time: "UTC" or the offset; undefined when it names none. */
export function quotaZoneOf(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  if (/\d[zZ]$/.test(v)) return 'UTC';
  const m = /T.*([+-]\d{2}:?\d{2})$/.exec(v);
  return m ? m[1] : undefined;
}

function qSanitiseBucket(raw: unknown, now: number): QuotaBucket | undefined {
  const unit = qOwn(raw, 'unit');
  if (unit !== 'requests' && unit !== 'percent') return undefined;
  const label = quotaText(qOwn(raw, 'label'));
  const b: QuotaBucket = { id: quotaText(qOwn(raw, 'id')) ?? label ?? 'limit', label: label ?? 'Limit', unit };
  const put = <K extends 'used' | 'limit' | 'remaining' | 'usedPercent' | 'remainingPercent' | 'windowMins'>(k: K, n: number | undefined): void => {
    if (n !== undefined) b[k] = n;
  };
  put('used', qFigure(qOwn(raw, 'used')));
  put('limit', qFigure(qOwn(raw, 'limit')));
  put('remaining', qFigure(qOwn(raw, 'remaining')));
  put('usedPercent', qPercent(qOwn(raw, 'usedPercent')));
  put('remainingPercent', qPercent(qOwn(raw, 'remainingPercent')));
  put('windowMins', qFigure(qOwn(raw, 'windowMins')));
  if (qOwn(raw, 'unlimited') === true) b.unlimited = true;
  const at = quotaTimeMs(qOwn(raw, 'resetsAt'));
  if (at !== undefined && Math.abs(at - now) < Q_FAR_MS) {
    b.resetsAt = Math.round(at);
    const zone = quotaText(qOwn(raw, 'resetZone'));
    if (zone) b.resetZone = zone;
    if (qOwn(raw, 'resetEstimated') === true) b.resetEstimated = true;
  }
  if (qOwn(raw, 'overageAllowed') === true) b.overageAllowed = true;
  return b;
}

/** Whether a bucket has anything usable. One without stays as a row reading "not reported" (FR-082), unless no bucket has anything. */
function qTold(b: QuotaBucket): boolean {
  return b.used !== undefined || b.limit !== undefined || b.remaining !== undefined || b.usedPercent !== undefined || b.remainingPercent !== undefined || !!b.unlimited || b.resetsAt !== undefined;
}

/** FR-095: only the shape of a fingerprint passes; a raw id or login never does. */
function qKey(raw: unknown): { accountKey: string } | Record<string, never> {
  const k = qOwn(raw, 'accountKey');
  return typeof k === 'string' && /^[0-9a-f]{32}$/.test(k) ? { accountKey: k } : {};
}

/** FR-082: anything an adapter (or a fixture) hands over, made safe; a shape that is not understood is a `malformed` failure. */
export function sanitiseQuotaRead(raw: unknown, now = Date.now()): QuotaRead {
  const kind = qOwn(raw, 'kind');
  if (kind === 'not-reported') {
    const r = qOwn(raw, 'reason');
    return { kind, reason: typeof r === 'string' && Q_REASONS.includes(r) ? (r as QuotaReasonKind) : 'none' };
  }
  if (kind === 'failed') {
    const f = qOwn(raw, 'failure');
    return { kind, failure: typeof f === 'string' && Q_FAILURES.includes(f) ? (f as QuotaFailureKind) : 'unavailable', ...qKey(raw) };
  }
  const list = qOwn(raw, 'buckets');
  if (kind !== 'ok' || !Array.isArray(list)) return { kind: 'failed', failure: 'malformed' };
  if (!list.length) return { kind: 'not-reported', reason: 'none' };
  const buckets: QuotaBucket[] = [];
  for (const b of list.slice(0, Q_MAX_BUCKETS)) {
    const s = qSanitiseBucket(b, now);
    if (s) buckets.push(s);
  }
  if (!buckets.some(qTold)) return { kind: 'failed', failure: 'malformed' };
  return { kind: 'ok', source: quotaText(qOwn(raw, 'source'), Q_SOURCE_MAX) ?? 'The agent app', buckets, ...qKey(raw) };
}

/** FR-083: whether this mode may ask the app now. No polling: only `open` and `check`, each with its floor; a rate-limit answer waits. */
export function quotaShouldAsk(entry: QuotaEntry | undefined, mode: QuotaMode, now: number): boolean {
  if (mode === 'cached') return false;
  if (entry?.backoffUntil !== undefined && now < entry.backoffUntil) return false;
  if (entry?.askedAt === undefined) return true;
  return now - entry.askedAt >= (mode === 'check' ? QUOTA_CHECK_MS : QUOTA_OPEN_MS);
}

/** FR-084: the next entry after a read. A failure keeps the good figures, except `signed-out`; an answer without figures replaces them. */
export function applyQuotaRead(prev: QuotaEntry | undefined, read: QuotaRead, now: number): QuotaEntry {
  const askedAt = prev?.askedAt ?? now;
  if (read.kind === 'ok') return { askedAt, good: { source: read.source, buckets: read.buckets, checkedAt: now, ...(read.accountKey ? { accountKey: read.accountKey } : {}) } };
  if (read.kind === 'not-reported') return { askedAt, reason: { kind: read.reason, at: now } };
  // FR-095: another account answered, so the kept figures are not this account's
  const switched = !!read.accountKey && !!prev?.good?.accountKey && read.accountKey !== prev.good.accountKey;
  const good = read.failure === 'signed-out' || switched ? undefined : prev?.good;
  return {
    askedAt,
    ...(good ? { good } : {}),
    failure: { kind: read.failure, at: now, ...(read.accountKey ? { keyed: true } : {}) },
    ...(read.failure === 'rate-limited' ? { backoffUntil: now + QUOTA_BACKOFF_MS } : {}),
  };
}

export function quotaView(app: string, entry: QuotaEntry | undefined): QuotaView {
  const v: QuotaView = { app, buckets: entry?.good?.buckets ?? [] };
  if (entry?.good) {
    v.source = entry.good.source;
    v.checkedAt = entry.good.checkedAt;
  }
  if (entry?.failure) {
    v.failure = entry.failure.kind;
    v.failedAt = entry.failure.at;
  }
  if (entry?.reason) v.reason = entry.reason.kind;
  if (entry?.good && (!entry.good.accountKey || (entry.failure && !entry.failure.keyed))) v.unkeyed = true;
  if (entry?.backoffUntil !== undefined) v.backoffUntil = entry.backoffUntil;
  return v;
}

/** The percent left, from reported values only: left percent, else 100 minus used percent, else remaining or used over the limit. */
function qLeftPercent(b: QuotaBucket): number | undefined {
  if (b.remainingPercent !== undefined) return b.remainingPercent;
  if (b.usedPercent !== undefined) return 100 - b.usedPercent;
  if (b.limit !== undefined && b.limit > 0) {
    if (b.remaining !== undefined) return (100 * b.remaining) / b.limit;
    if (b.used !== undefined) return Math.max(0, (100 * (b.limit - b.used)) / b.limit);
  }
  return undefined;
}

const qPassed = (b: QuotaBucket, now: number): boolean => b.resetsAt !== undefined && b.resetsAt <= now;

/** FR-087: `exhausted`, `near` or '' for one bucket. Never for unlimited, a limit of 0 or a reset that has passed. */
export function quotaLevel(b: QuotaBucket, now: number): 'exhausted' | 'near' | '' {
  if (b.unlimited || b.limit === 0 || qPassed(b, now)) return '';
  const left = qLeftPercent(b);
  if (left === undefined) return '';
  return left <= 0 ? 'exhausted' : left <= NEAR_PERCENT ? 'near' : '';
}

export function quotaState(v: QuotaView, now: number): QuotaState {
  const has = v.buckets.length > 0;
  if (v.failure) return has ? 'failed-kept' : 'failed';
  if (v.reason) return 'not-reported';
  if (!has || v.checkedAt === undefined) return 'not-checked';
  if (now - v.checkedAt >= QUOTA_STALE_MS || v.buckets.some((b) => qPassed(b, now))) return 'stale';
  return 'current';
}

const qNum = (n: number): string => (Number.isInteger(n) ? n : Math.round(n * 10) / 10).toLocaleString('en-US');
/** A percent that never rounds into a state it is not in: 99.96 used is not "100%", 0.04 left is not "0%". */
function qPct(n: number): string {
  if (n > 0 && n < 0.1) return 'under 0.1%';
  if (n > 99.9 && n < 100) return 'over 99.9%';
  return `${Math.round(n * 10) / 10}%`;
}

/** A time with its zone name, in the viewer's zone (or `tz`, for tests). */
export function quotaWhen(ms: number, tz?: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { ...(tz ? { timeZone: tz } : {}), month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }).format(ms);
  } catch {
    return new Date(ms).toISOString();
  }
}

export const QUOTA_NOT_REPORTED = 'not reported';
export const QUOTA_UNKEYED_TEXT = 'These figures may be from before a sign-in change.';

function qWindowWords(mins: number): string {
  if (mins >= 2880 && mins % 1440 === 0) return `${mins / 1440} days`;
  if (mins >= 60 && mins % 60 === 0) return `${mins / 60} hour${mins === 60 ? '' : 's'}`;
  return `${qNum(mins)} minutes`;
}

function qResetWords(b: QuotaBucket, now: number, tz?: string): string {
  if (b.resetsAt === undefined) return QUOTA_NOT_REPORTED;
  const when = quotaWhen(b.resetsAt, tz);
  if (qPassed(b, now)) return `passed at ${when}; these figures are from before it`;
  const extra = [b.resetEstimated ? 'estimated' : '', b.resetZone ? `reported in ${b.resetZone}` : ''].filter(Boolean).join(', ');
  return extra ? `${when} (${extra})` : when;
}

export interface QuotaFact { label: string; value: string }
export interface QuotaRow { id: string; label: string; unit: QuotaUnit; level: 'exhausted' | 'near' | ''; passed: boolean; facts: QuotaFact[] }
export interface QuotaDisplay {
  state: QuotaState;
  word: string;
  tone: 'ok' | 'warn' | 'off';
  /** Plain sentences, for example why it could not be read. */
  notes: string[];
  rows: QuotaRow[];
  source?: string;
  checked?: string;
  near: boolean;
  exhausted: boolean;
  /** When this display next changes by itself (a reading goes stale, a reset passes), for the window's one timer. */
  nextChangeAt?: number;
}

const Q_WORD: Readonly<Record<QuotaState, [string, QuotaDisplay['tone']]>> = {
  current: ['Current', 'ok'],
  stale: ['Last reading, not current', 'warn'],
  'failed-kept': ['Last reading, not current', 'warn'],
  failed: ['Could not read', 'warn'],
  'not-reported': ['Not reported', 'off'],
  'not-checked': ['Not checked yet', 'off'],
};

function qBucketFacts(b: QuotaBucket, now: number, tz?: string): QuotaFact[] {
  const facts: QuotaFact[] = [];
  const nr = QUOTA_NOT_REPORTED;
  if (b.unit === 'requests') {
    facts.push({ label: 'Used', value: b.used !== undefined ? `${qNum(b.used)} requests` : nr });
    facts.push({ label: 'Limit', value: b.unlimited ? 'Unlimited' : b.limit !== undefined ? `${qNum(b.limit)} requests` : nr });
    if (!b.unlimited) facts.push({ label: 'Left', value: b.remaining !== undefined ? `${qNum(b.remaining)} requests` : b.remainingPercent !== undefined ? qPct(b.remainingPercent) : nr });
  } else {
    facts.push({ label: 'Used', value: b.usedPercent !== undefined ? qPct(b.usedPercent) : nr });
    if (b.remainingPercent !== undefined) facts.push({ label: 'Left', value: qPct(b.remainingPercent) });
    facts.push({ label: 'Limit', value: b.unlimited ? 'Unlimited' : nr });
  }
  if (b.windowMins !== undefined && b.windowMins > 0) facts.push({ label: 'Window', value: qWindowWords(b.windowMins) });
  if (!b.unlimited || b.resetsAt !== undefined) facts.push({ label: 'Resets', value: qResetWords(b, now, tz) });
  if (b.overageAllowed) facts.push({ label: 'Past the limit', value: 'the provider says use can continue; it may cost money' });
  return facts;
}

/** FR-086: what the window shows for one app, worked out at `now`. No HTML: the window escapes every string. */
export function quotaDisplay(v: QuotaView, now: number, opts: { tz?: string } = {}): QuotaDisplay {
  const state = quotaState(v, now);
  const [word, tone] = Q_WORD[state];
  const rows = v.buckets.map((b) => ({ id: b.id, label: b.label, unit: b.unit, level: quotaLevel(b, now), passed: qPassed(b, now), facts: qBucketFacts(b, now, opts.tz) }));
  const notes: string[] = [];
  if (v.failure) notes.push(`Could not read${v.failedAt !== undefined ? ` at ${quotaWhen(v.failedAt, opts.tz)}` : ''}: ${QUOTA_FAILURE_TEXT[v.failure]}`);
  if (v.reason) notes.push(QUOTA_REASON_TEXT[v.reason]);
  if (v.unkeyed && rows.length) notes.push(QUOTA_UNKEYED_TEXT);
  if (state === 'stale' && v.checkedAt !== undefined && now - v.checkedAt >= QUOTA_STALE_MS) notes.push('This reading is old. Choose Check again to ask now.');
  const times = [v.backoffUntil, v.checkedAt !== undefined && !v.failure ? v.checkedAt + QUOTA_STALE_MS : undefined, ...v.buckets.map((b) => b.resetsAt)].filter((t): t is number => t !== undefined && t > now);
  return {
    state,
    word,
    tone,
    notes,
    rows,
    ...(v.source ? { source: v.source } : {}),
    ...(v.checkedAt !== undefined ? { checked: quotaWhen(v.checkedAt, opts.tz) } : {}),
    near: rows.some((r) => r.level === 'near'),
    exhausted: rows.some((r) => r.level === 'exhausted'),
    ...(times.length ? { nextChangeAt: Math.min(...times) } : {}),
  };
}

function qShortFigures(b: QuotaBucket): string {
  if (b.unlimited) return 'unlimited';
  if (b.unit === 'percent') return b.usedPercent !== undefined ? `${qPct(b.usedPercent)} used` : 'figures not reported';
  if (b.used !== undefined && b.limit !== undefined) return `${qNum(b.used)} of ${qNum(b.limit)} requests used`;
  if (b.used !== undefined) return `${qNum(b.used)} requests used`;
  if (b.remainingPercent !== undefined) return `${qPct(b.remainingPercent)} left`;
  return 'figures not reported';
}

/** FR-089, FR-090: one honest line for another screen (the New session dialog, spec 096's plan line). One app's figures only. */
export function quotaLine(v: QuotaView, now: number, opts: { tz?: string } = {}): string {
  const state = quotaState(v, now);
  if (state === 'not-checked') return 'Account limits: not checked yet.';
  if (state === 'not-reported') return `Account limits: ${QUOTA_NOT_REPORTED}.`;
  if (state === 'failed') return 'Account limits: could not be read.';
  const rank = (b: QuotaBucket): number => ({ exhausted: 0, near: 1, '': 2 })[quotaLevel(b, now)];
  const top = [...v.buckets].sort((a, b) => rank(a) - rank(b))[0];
  const lvl = quotaLevel(top, now);
  const lead = lvl === 'exhausted' ? 'At a reported limit: ' : lvl === 'near' ? 'Near a reported limit: ' : 'Account limits: ';
  const reset = top.resetsAt === undefined ? '' : qPassed(top, now) ? ', reset time passed' : `, resets ${quotaWhen(top.resetsAt, opts.tz)}`;
  const tail = state === 'current' ? `Checked ${quotaWhen(v.checkedAt as number, opts.tz)}.` : `Last reading, not current${v.checkedAt !== undefined ? ` (${quotaWhen(v.checkedAt, opts.tz)})` : ''}.`;
  return `${lead}${top.label}, ${qShortFigures(top)}${reset}. ${tail}`;
}

export interface QuotaOtherApp { id: string; name: string; ready: boolean; signedIn: boolean; view?: QuotaView }

/**
 * FR-088: the other apps worth naming: ready, known to be signed in, and not near their qOwn reported limit. A suggestion for a person,
 * nothing more; `known` says whether that app reported current figures, so a window never implies room it was not told about.
 */
export function quotaAlternatives(app: string, others: readonly QuotaOtherApp[], now: number): Array<{ id: string; name: string; known: boolean }> {
  const out: Array<{ id: string; name: string; known: boolean }> = [];
  for (const o of others) {
    if (o.id === app || !o.ready || !o.signedIn) continue;
    const d = o.view ? quotaDisplay(o.view, now) : undefined;
    if (d && (d.near || d.exhausted)) continue;
    out.push({ id: o.id, name: o.name, known: d?.state === 'current' });
  }
  return out;
}

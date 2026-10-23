/**
 * Spec 034 FR-017 (issue #600): the agent app retries a failed model API call by itself. Pure: a per-turn tracker and one reader per
 * agent app that turns the vendor's fields into a fixed reason and a few checked numbers. No vendor text ever leaves this module.
 *
 * Sources (`read:` only, no retry was seen on a real session):
 * - Claude Code 2.1.309 stream-json: `{ type: 'system', subtype: 'api_retry', attempt, max_retries, retry_delay_ms, error_status, error, no_response? }`,
 *   `error` one of `rate_limit`, `overloaded`, `server_error`, `authentication_failed`, `cloud_credential_error`, `unknown`.
 * - Codex app-server (codex-cli 0.163.0, `generate-ts`): notification `error` `{ error: { codexErrorInfo, ... }, willRetry, threadId, turnId }`.
 * - Copilot SDK 1.0.22: session event `model.call_failure` `{ source, failureKind, statusCode, retryAttempt, ... }`.
 */
import type { EventBody } from './map';
import type { RetryReason } from './types';
import { isObj } from '../shared/guards';

/** What a reader found: a reason and the numbers the agent app gave (each already checked). */
export interface RetryInfo {
  reason: RetryReason;
  attempt?: number;
  max?: number;
  status?: number;
  delayMs?: number;
}

type RetryBody = EventBody & { type: 'retry' };

const own = (o: unknown, k: string): unknown => (isObj(o) && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
/** A whole number from `min` to `max`, else undefined (a bad value is left out, never guessed). */
const whole = (v: unknown, min: number, max: number): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined);
const httpStatus = (v: unknown): number | undefined => whole(v, 100, 599);
/** At most a day: a longer wait is not a retry delay we show. */
const delay = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 86_400_000 ? Math.round(v) : undefined);
const MAX_ATTEMPT = 1000;

/** The reason a status alone suggests (used when the agent app gives no category). */
export function reasonOfStatus(status: number | undefined): RetryReason {
  if (status === undefined) return 'other';
  if (status === 429) return 'rate-limit';
  if (status === 529 || status === 503) return 'overloaded';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 401 || status === 403) return 'auth';
  if (status >= 500) return 'server';
  return 'other';
}

/** Claude Code `api_retry` -> info, or null when the message is not one. */
export function claudeRetry(m: unknown): RetryInfo | null {
  if (own(m, 'type') !== 'system' || own(m, 'subtype') !== 'api_retry') return null;
  const status = httpStatus(own(m, 'error_status'));
  const err = own(m, 'error');
  const noResponse = own(m, 'no_response') !== undefined && own(m, 'no_response') !== null;
  const reason: RetryReason =
    err === 'rate_limit' ? 'rate-limit'
    : err === 'overloaded' ? 'overloaded'
    : err === 'server_error' ? (status === 408 || status === 504 ? 'timeout' : 'server')
    : err === 'authentication_failed' || err === 'cloud_credential_error' ? 'auth'
    : noResponse ? 'timeout'
    : status !== undefined ? reasonOfStatus(status)
    : 'other';
  return { reason, attempt: whole(own(m, 'attempt'), 1, MAX_ATTEMPT), max: whole(own(m, 'max_retries'), 1, MAX_ATTEMPT), status, delayMs: delay(own(m, 'retry_delay_ms')) };
}

/** Codex `codexErrorInfo` (a string, or a one-key object with `httpStatusCode`), compared without case (fixtures use PascalCase, the schema camelCase). */
function codexInfo(info: unknown): { kind: string; status?: number } {
  if (typeof info === 'string') return { kind: info.toLowerCase() };
  if (isObj(info)) {
    const k = Object.keys(info)[0];
    if (k) return { kind: k.toLowerCase(), status: httpStatus(own(own(info, k), 'httpStatusCode')) };
  }
  return { kind: '' };
}

/** Codex `error` notification params -> info when the app will retry (`willRetry: true`), else null. The attempt is counted by the tracker. */
export function codexRetry(params: unknown): RetryInfo | null {
  if (own(params, 'willRetry') !== true) return null;
  const { kind, status } = codexInfo(own(own(params, 'error'), 'codexErrorInfo'));
  const reason: RetryReason =
    kind === 'ratelimitexceeded' ? 'rate-limit'
    : kind === 'serveroverloaded' ? 'overloaded'
    : kind === 'internalservererror' ? 'server'
    : kind === 'httpconnectionfailed' || kind === 'responsestreamconnectionfailed' || kind === 'responsestreamdisconnected' ? (status !== undefined && status >= 400 ? reasonOfStatus(status) : 'network')
    : kind === 'unauthorized' ? 'auth'
    : status !== undefined ? reasonOfStatus(status)
    : 'other';
  return { reason, status };
}

/** A status a client retries: none (no answer), 408, 409, 425, 429 or 5xx. */
const retryable = (s: number | undefined): boolean => s === undefined || s === 408 || s === 409 || s === 425 || s === 429 || s >= 500;

/** Copilot `model.call_failure` data -> info for a failed call of the top-level agent that is retried, else null. */
export function copilotRetry(d: unknown): RetryInfo | null {
  if (own(d, 'source') !== 'top_level') return null;
  const status = httpStatus(own(d, 'statusCode'));
  const transport = own(d, 'failureKind') === 'transport';
  if (!transport && !retryable(status)) return null;
  const idx = whole(own(d, 'retryAttempt'), 0, MAX_ATTEMPT - 1);
  const reason: RetryReason = status !== undefined ? reasonOfStatus(status) : transport ? 'network' : 'other';
  return { reason, attempt: idx === undefined ? undefined : idx + 1, status };
}

/**
 * One turn's retries (main agent only). `retry` numbers the attempt when the agent app does not (one more than the last), `progress`
 * forgets the run (the call went through), `gaveUp` returns the `gave-up` event once when the turn fails after a retry.
 */
export class RetryTracker {
  private last: RetryBody | undefined;

  retry(info: RetryInfo): RetryBody {
    const attempt = info.attempt ?? (this.last ? this.last.attempt + 1 : 1);
    const ev: RetryBody = {
      type: 'retry',
      phase: 'retrying',
      attempt: Math.min(attempt, MAX_ATTEMPT),
      reason: info.reason,
      ...(info.max !== undefined && info.max >= attempt ? { maxAttempts: info.max } : {}),
      ...(info.status !== undefined ? { httpStatus: info.status } : {}),
      ...(info.delayMs !== undefined ? { delayMs: info.delayMs } : {}),
    };
    this.last = ev;
    return ev;
  }

  /** True while a retry of this turn has not been followed by progress. */
  get active(): boolean {
    return this.last !== undefined;
  }

  progress(): void {
    this.last = undefined;
  }

  gaveUp(): RetryBody | undefined {
    const l = this.last;
    this.last = undefined;
    if (!l) return undefined;
    return { type: 'retry', phase: 'gave-up', attempt: l.attempt, reason: l.reason, ...(l.httpStatus !== undefined ? { httpStatus: l.httpStatus } : {}) };
  }

  reset(): void {
    this.last = undefined;
  }
}

/**
 * Spec 087 FR-011: the normalized OS sandbox state, checked and cleaned. Pure, vendor-free: used by the adapters (to build it), the
 * event check (spec 010), main (before it keeps the state on `AgentInfo`) and the simulator. No vendor name or vendor setting key here.
 */
import type { SandboxState } from './api';
import { redact } from './redact';

/** The longest reason shown (FR-011). */
export const SANDBOX_REASON_MAX = 200;
/** Spec 087 (review round 6 on PR 733): at most this many left-out folders are named; the rest are counted. */
export const LEFT_OUT_MAX = 10;
const STATES = ['on', 'off', 'unknown'] as const;
const MECHANISMS = ['seatbelt', 'bubblewrap', 'processcontainer', 'vendor'] as const;
const COVERS = ['shell', 'mcp', 'files'] as const;

/**
 * A vendor's or Durbar's reason as one plain line: masked first (spec 041: mask, then cut), control characters and runs of blanks made
 * one space, then cut to at most `SANDBOX_REASON_MAX` characters, never inside a token. Fails closed: undefined for anything empty.
 */
export function sandboxReason(text: unknown): string | undefined {
  if (typeof text !== 'string' || !text.trim()) return undefined;
  const masked = redact(text); // mask first; redact cuts only after masking
  if (masked === '[redaction failed]') return undefined;
  // eslint-disable-next-line no-control-regex
  const plain = masked.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (plain.length <= SANDBOX_REASON_MAX) return plain || undefined;
  let end = SANDBOX_REASON_MAX - 1;
  while (end > 0 && /[A-Za-z0-9_\-.~+/=:@%[\]]/.test(plain[end - 1])) end--; // never end inside a token or a [redacted] mark
  return (end > 0 ? plain.slice(0, end).trimEnd() : plain.slice(0, SANDBOX_REASON_MAX - 1)) + '…';
}

/**
 * Review round 7 on PR 733: the `sandbox` event as it leaves main for the window: the state cleaned (masked, own known fields; anything
 * malformed becomes null, nothing shown) and the note's text masked and made plain (at most 600 characters). Other events pass unchanged.
 */
export function outwardSandboxEvent<E extends { type: string }>(e: E): E {
  if (e.type !== 'sandbox') return e;
  const x = e as unknown as { sandbox?: unknown; notice?: { text?: unknown; actions?: unknown; refused?: unknown } };
  const st = x.sandbox === null || x.sandbox === undefined ? null : cleanSandboxState(x.sandbox) ?? null;
  let notice: { text: string; actions: Array<'continue' | 'always'>; refused?: boolean } | undefined;
  if (x.notice && typeof x.notice === 'object') {
    const masked = typeof x.notice.text === 'string' ? redact(x.notice.text) : '';
    // eslint-disable-next-line no-control-regex
    const text = masked === '[redaction failed]' ? '' : masked.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 600);
    const actions = Array.isArray(x.notice.actions) ? x.notice.actions.filter((a): a is 'continue' | 'always' => a === 'continue' || a === 'always') : [];
    notice = { text: text || 'The OS sandbox could not start. Nothing was sent.', actions: x.notice.refused === true ? [] : actions, ...(x.notice.refused === true ? { refused: true } : {}) };
  }
  return { ...e, sandbox: st, ...(notice ? { notice } : {}) } as E;
}

/** The state as main keeps it and the window shows it: own known fields only, anything malformed dropped (all-or-nothing). */
export function cleanSandboxState(x: unknown): SandboxState | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return undefined;
  const o = x as Record<string, unknown>;
  const own = (k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
  const state = own('state');
  if (typeof state !== 'string' || !(STATES as readonly string[]).includes(state)) return undefined;
  const covers = own('covers');
  if (!Array.isArray(covers) || covers.length > 3 || covers.some((c) => typeof c !== 'string' || !(COVERS as readonly string[]).includes(c))) return undefined;
  const mech = own('mechanism');
  if (mech !== undefined && (typeof mech !== 'string' || !(MECHANISMS as readonly string[]).includes(mech))) return undefined;
  const writes = own('writes');
  if (writes !== undefined && writes !== 'none' && writes !== 'folders') return undefined;
  for (const k of ['managed', 'untilNewSession', 'approvedMayLeave']) if (own(k) !== undefined && typeof own(k) !== 'boolean') return undefined;
  if (typeof own('verified') !== 'boolean') return undefined;
  const reason = own('reason');
  if (reason !== undefined && typeof reason !== 'string') return undefined;
  const r = reason === undefined ? undefined : sandboxReason(reason);
  const lo = own('leftOut');
  if (lo !== undefined && (!Array.isArray(lo) || lo.length > LEFT_OUT_MAX || lo.some((x) => typeof x !== 'string'))) return undefined;
  const more = own('leftOutMore');
  if (more !== undefined && (typeof more !== 'number' || !Number.isInteger(more) || more < 0 || more > 1e6)) return undefined;
  const loClean = Array.isArray(lo) ? (lo as string[]).map((x) => sandboxReason(x)).filter((x): x is string => !!x) : [];
  return {
    state: state as SandboxState['state'],
    ...(mech ? { mechanism: mech as SandboxState['mechanism'] } : {}),
    ...(own('managed') === true ? { managed: true } : {}),
    ...(own('untilNewSession') === true ? { untilNewSession: true } : {}),
    covers: [...new Set(covers as SandboxState['covers'])],
    ...(own('approvedMayLeave') === true ? { approvedMayLeave: true } : {}),
    ...(writes ? { writes: writes as SandboxState['writes'] } : {}),
    verified: own('verified') === true,
    ...(r ? { reason: r } : {}),
    ...(loClean.length ? { leftOut: loClean } : {}),
    ...(typeof more === 'number' && more > 0 ? { leftOutMore: more } : {}),
  };
}

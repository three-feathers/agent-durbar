/**
 * Spec 005 FR-411 (issue #2060 item 4): Copy on a tool chip copies the real argument text, written to the clipboard by main; the window never
 * receives the real value (FR-342 stays). Main keeps, per session and call, the raw text of the one argument the chip shows, and tells the
 * window only whether its masking changed it (`argsMasked`). Pure: no Electron (the clipboard is handed in), so it is unit tested.
 * Memory only; never written, never logged.
 */
import type { AgentEvent } from '../adapters/types';
import { SESSION_ID_RE } from './schedules';
import { MASK_INPUT_MAX } from '../shared/redact';

/** The keys the chip reads first, in order (`toolArg` in `src/renderer/app.js`; `test:toolargcopy` pins the two together). */
const ARG_KEYS = ['path', 'pattern', 'command', 'url', 'query', 'file_path'] as const;

/**
 * The key of the argument a chip shows, as the window's `toolArg` picks it: the first of `ARG_KEYS` with a truthy value, else the first own
 * key whose value is text; `undefined` when the arguments are not an object or hold no such value.
 */
export function toolArgKey(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const o = args as Record<string, unknown>;
  for (const k of ARG_KEYS) if (o[k]) return k;
  for (const k of Object.keys(o)) if (typeof o[k] === 'string') return k;
  return undefined;
}

/** A value longer than this is kept only as "too long" (main's masks send any argument over 12,288 characters empty, so a chip never shows one). */
export const TOOL_COPY_MAX_CHARS = 100_000;
/** At most this many calls are kept, and this many characters in all; the oldest go first. */
export const TOOL_COPY_CALLS_MAX = 2000;
export const TOOL_COPY_TOTAL_MAX = 4_000_000;
/**
 * The ids main accepts, when storing and when copying (review of PR 2099): a session id has the shape of a Durbar session id
 * (`SESSION_ID_RE` of schedules.ts: a UUID, an agent app's own session id, the simulator's `sim-N`); a call id comes from the agent app
 * (`toolu_…`, `call_…`, `fake-call-N`: letters, digits and `_`, `-`). Anything else (a NUL, a newline, an over-long id, a non-string) is
 * never kept and answers `unknown` before any lookup.
 */
export const CALL_ID_RE = /^[A-Za-z0-9._:-]{1,256}$/;
const validSession = (v: unknown): v is string => typeof v === 'string' && SESSION_ID_RE.test(v);
const validCall = (v: unknown): v is string => typeof v === 'string' && CALL_ID_RE.test(v);

export type ToolCopyResult = { ok: true } | { ok: false; reason: 'unknown' | 'too-long' | 'ask' | 'failed' };
export type Kept = { sid: string; callId: string; text: string | null; masked: boolean };

export interface ToolArgCopies {
  /** The window's copy of an event (`out`, already masked by `outward`) with `argsMasked` added when the raw event (`raw`) carries arguments; else `out` unchanged. */
  see(raw: AgentEvent, out: AgentEvent): AgentEvent;
  /**
   * Writes the kept text of that session's call to the clipboard. The answer never holds the text. A value main's masking changed is written
   * only with `confirmed === true` (the person pressed Copy anyway); else the answer is `ask` and nothing is written (the window's hint on the
   * event can be out of date, so main enforces the question itself).
   */
  copy(sessionId: unknown, callId: unknown, confirmed?: unknown): ToolCopyResult;
  /** Drops every kept value of that session (it left Durbar: Remove session, Remove folder). */
  forget(sessionId: string): void;
  /** Test only: how many calls and characters are kept. */
  size(): { calls: number; chars: number };
  /** Test only: shifts the character count, to show that eviction stops on an empty map even when the count is wrong. */
  testSkew(n: number): void;
}

/** Test only: smaller bounds for the model fuzz. */
export interface ToolCopyLimits { calls: number; total: number; maxChars: number }

/** One key per pair of ids, unambiguous whatever the ids hold (an encoded pair, never two ids joined by a separator). */
export const toolCopyKey = (sessionId: string, callId: string): string => JSON.stringify([sessionId, callId]);
const keyOf = toolCopyKey;
/** The kept value of exactly this session and call: the stored ids are compared again, so no key can reach another session's value. */
export const keptFor = (kept: ReadonlyMap<string, Kept>, sessionId: string, callId: string): Kept | undefined => {
  const v = kept.get(keyOf(sessionId, callId));
  return v && v.sid === sessionId && v.callId === callId ? v : undefined;
};

export function createToolArgCopies(deps: { write(text: string): void; limits?: ToolCopyLimits }): ToolArgCopies {
  const CALLS = deps.limits?.calls ?? TOOL_COPY_CALLS_MAX, TOTAL = deps.limits?.total ?? TOOL_COPY_TOTAL_MAX, MAX = deps.limits?.maxChars ?? TOOL_COPY_MAX_CHARS;
  const kept = new Map<string, Kept>();
  let chars = 0;
  const drop = (k: string): void => {
    const v = kept.get(k);
    if (!v) return;
    chars -= v.text?.length ?? 0;
    kept.delete(k);
  };
  const keep = (k: string, v: Kept): void => {
    drop(k);
    kept.set(k, v);
    chars += v.text?.length ?? 0;
    while (kept.size > 0 && (kept.size > CALLS || chars > TOTAL)) drop(kept.keys().next().value as string); // stops on an empty map, whatever the count says
  };
  return {
    see(raw, out0) {
      if (raw.type !== 'toolCall' || out0.type !== 'toolCall') return out0;
      let out = out0;
      if (out.argsLong !== undefined) { out = { ...out }; delete out.argsLong; } // spec 005 FR-438: main's word only, as `argsMasked`
      if (raw.args === undefined || !validSession(raw.sessionId) || !validCall(raw.callId)) {
        if (out.argsMasked === undefined) return out;
        const rest = { ...out }; // main's word only: an adapter's own `argsMasked` never reaches the window
        delete rest.argsMasked;
        return rest;
      }
      const k = keyOf(raw.sessionId, raw.callId);
      const key = toolArgKey(out.args);
      const rawArgs = raw.args;
      const rv = key !== undefined && rawArgs && typeof rawArgs === 'object' ? (rawArgs as Record<string, unknown>)[key] : undefined;
      const plain = typeof rv === 'string' || typeof rv === 'number' || typeof rv === 'boolean'; // the window shows `String(value)`
      if (!plain || !Object.prototype.hasOwnProperty.call(rawArgs, key as string)) {
        drop(k); // nothing the chip can copy for these arguments; the flag says "ask first" (fail safe), the copy answers `unknown`
        return { ...out, argsMasked: true };
      }
      const text = String(rv);
      const mv = (out.args as Record<string, unknown>)[key as string];
      const masked = mv !== rv;
      keep(k, { sid: raw.sessionId, callId: raw.callId, text: text.length > MAX ? null : text, masked });
      /* spec 005 FR-438: main sent this argument empty because the masks do not take its length (FR-342 main half): the window gets the length, a number only */
      const long = typeof rv === 'string' && mv === '' && rv.length > MASK_INPUT_MAX ? rv.length : 0;
      return long ? { ...out, argsMasked: masked, argsLong: long } : { ...out, argsMasked: masked };
    },
    copy(sessionId, callId, confirmed) {
      if (!validSession(sessionId) || !validCall(callId)) return { ok: false, reason: 'unknown' };
      const v = keptFor(kept, sessionId, callId);
      if (!v) return { ok: false, reason: 'unknown' };
      if (v.text === null) return { ok: false, reason: 'too-long' };
      if (v.masked && confirmed !== true) return { ok: false, reason: 'ask' };
      try {
        deps.write(v.text);
      } catch {
        return { ok: false, reason: 'failed' }; // the error is not logged: nothing about the copy is
      }
      return { ok: true };
    },
    forget(sessionId) {
      if (!validSession(sessionId)) return;
      for (const [k, v] of [...kept]) if (v.sid === sessionId) drop(k);
    },
    size: () => ({ calls: kept.size, chars }),
    testSkew: (n) => { chars += n; },
  };
}

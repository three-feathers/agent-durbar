/**
 * The shared name rule (spec 059 FR-002; floor names, spec 033 FR-003, use its character lists). Pure: no Electron, no fs.
 * Hidden characters are written as escapes on purpose: never put them literally in source.
 */
import { redact } from './redact';

// eslint-disable-next-line no-control-regex
export const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;
/** Invisible characters that can make one name look like another or spoof the layout: bidi embeddings, overrides and isolates, zero-width space, word joiner, invisible operators, line and paragraph separators, soft hyphen, combining grapheme joiner, Mongolian vowel separator, Hangul fillers, interlinear annotation marks, BOM. ZWNJ/ZWJ and LRM/RLM stay allowed: real scripts and emoji need them. */
export const HIDDEN_RE = /[\u00ad\u034f\u115f\u180e\u200b\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\u3164\ufeff\ufff9-\ufffb]/;
/** For `replace` only: a global regex keeps lastIndex, never use it with test. */
export const HIDDEN_ALL_RE = /[\u00ad\u034f\u115f\u180e\u200b\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\u3164\ufeff\ufff9-\ufffb]/g;
export const C1_ALL_RE = /[\u0080-\u009f]/g;

export const MAX_SESSION_NAME = 60;

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

/**
 * Checks a user-given display name: whitespace runs become one space, the ends are trimmed, then 1..`max` code points, no control or
 * hidden characters, and nothing `redact()` would change (a token or key). An empty name is `{ ok: true, name: '' }` (callers treat it
 * as "reset"). Never throws.
 */
export function checkDisplayName(v: unknown, max: number = MAX_SESSION_NAME): NameCheck {
  if (typeof v !== 'string') return { ok: false, error: `Use 1 to ${max} characters.` };
  if (HIDDEN_RE.test(v)) return { ok: false, error: 'Remove control or hidden characters.' };
  const name = v.replace(/\s+/g, ' ').trim();
  if (CONTROL_RE.test(name)) return { ok: false, error: 'Remove control or hidden characters.' };
  if ([...name].length > max) return { ok: false, error: `Use 1 to ${max} characters.` };
  if (name && redact(name) !== name) return { ok: false, error: 'That looks like a secret. Use another name.' };
  return { ok: true, name };
}

/** The cleaned name, or `undefined` when empty or refused. */
export function cleanDisplayName(v: unknown, max: number = MAX_SESSION_NAME): string | undefined {
  const r = checkDisplayName(v, max);
  return r.ok && r.name ? r.name : undefined;
}

/** The one-line reason a name is refused ('' = fine, including empty). */
export function nameError(v: unknown, max: number = MAX_SESSION_NAME): string {
  const r = checkDisplayName(v, max);
  return r.ok ? '' : r.error;
}

/**
 * Spec 081 FR-005: a version taken from ONE structured field (a JSON string, a tag segment, a trimmed channel text), never from free
 * text. Rejected (never cut) when longer than 64 characters; otherwise matched by one anchored, bounded pattern, so it is linear.
 * Kept in its own small module so settings can use it without pulling in the detection code.
 */

/** Longest version accepted: longer is rejected and never cut. The one constant; `src/adapters/detect.ts` (spec 012 FR-039) imports it. */
export const MAX_VERSION_LENGTH = 64;
/**
 * The one version-token pattern (source text, so each caller anchors it its own way): three ASCII numbers of 1-9 digits and an optional
 * pre-release of 1-40 ASCII letters, digits, dots or hyphens. `\d` has no `u` flag, so it is ASCII-only; leading zeros are accepted.
 */
export const VERSION_TOKEN_SOURCE = '\\d{1,9}\\.\\d{1,9}\\.\\d{1,9}(?:-[0-9A-Za-z.-]{1,40})?';
const FIELD_RE = new RegExp('^v?(' + VERSION_TOKEN_SOURCE + ')$');

/** A version from one structured field, without a leading `v`, or undefined. */
export function parseVersionField(field: unknown): string | undefined {
  if (typeof field !== 'string' || field.length > MAX_VERSION_LENGTH) return undefined;
  const m = FIELD_RE.exec(field);
  return m ? m[1] : undefined;
}

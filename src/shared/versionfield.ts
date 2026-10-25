/**
 * Spec 081 FR-005: a version taken from ONE structured field (a JSON string, a tag segment, a trimmed channel text), never from free
 * text. Rejected (never cut) when longer than 64 characters; otherwise matched by one anchored, bounded pattern, so it is linear.
 * Kept in its own small module so settings can use it without pulling in the detection code.
 */

/**
 * Longest version accepted: longer is rejected and never cut. PR #698 (spec 012 T133) exports the same constant from
 * `src/adapters/detect.ts`; once it is merged this becomes `import { MAX_VERSION_LENGTH } from '../adapters/detect'` (tasks.md T008).
 */
export const MAX_VERSION_LENGTH = 64;
/** The one field pattern: anchored, every part bounded. */
const FIELD_RE = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:-[0-9A-Za-z.-]{1,40})?$/;

/** A version from one structured field, without a leading `v`, or undefined. */
export function parseVersionField(field: unknown): string | undefined {
  if (typeof field !== 'string' || field.length > MAX_VERSION_LENGTH) return undefined;
  return FIELD_RE.test(field) ? field.replace(/^v/, '') : undefined;
}

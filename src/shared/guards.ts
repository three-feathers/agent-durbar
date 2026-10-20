/**
 * Small type guards shared by the adapters, main and the shared modules (tech-debt pass 2026-10-21: the same `isObj` was
 * defined in 14 files). Pure, no dependencies. Only exact equivalents live here; a guard with different rules (for example
 * a number check that allows negatives) stays where it is used, under its own name.
 */

/** A plain object (not null, not an array). */
export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A non-empty string, or undefined. */
export const nonEmptyStr = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** Adapters that exist but are not offered to users. Kept out of `descriptors.ts` so `main.ts` does not bundle them (T043c adds the dev-hook registration). */
import type { AdapterDescriptor } from './capabilities';
import { CODEX_DESCRIPTOR } from './codex';

/**
 * Adapters that exist but are not offered to users (spec 012 FR-100, D1 option B): registered only behind a dev hook, and only by T043c.
 * Nothing in the app reads this list yet. The contract tests count it (FR-085), so a run exists for each entry.
 */
export const EXPERIMENTAL_DESCRIPTORS: readonly AdapterDescriptor[] = [CODEX_DESCRIPTOR];

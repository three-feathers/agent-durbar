/** The adapters the app registers (spec 012). Real adapters only: a test double such as FakeAdapter must never be listed here. */
import type { AdapterDescriptor } from './capabilities';
import { COPILOT_DESCRIPTOR } from './copilot';
import { CODEX_DESCRIPTOR } from './codex';

export const PRODUCTION_DESCRIPTORS: readonly AdapterDescriptor[] = [COPILOT_DESCRIPTOR];

/**
 * Adapters that exist but are not offered to users (spec 012 FR-100, D1 option B): registered only behind a dev hook, and only by T043c.
 * Nothing in the app reads this list yet. The contract tests count it (FR-085), so a run exists for each entry.
 */
export const EXPERIMENTAL_DESCRIPTORS: readonly AdapterDescriptor[] = [CODEX_DESCRIPTOR];

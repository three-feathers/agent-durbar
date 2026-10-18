/**
 * The Codex descriptor, kept apart from `experimental.ts` so `main.ts` does not pull `codex.ts` into the app (T043c adds
 * `codex: 'DURBAR_CODEX'` to the hook table and the registration, spec 012 FR-100). Tests count it in the FR-085 check.
 */
import type { AdapterDescriptor } from './capabilities';
import { CODEX_DESCRIPTOR } from './codex';

export const CODEX_EXPERIMENTAL_DESCRIPTORS: readonly AdapterDescriptor[] = [CODEX_DESCRIPTOR];

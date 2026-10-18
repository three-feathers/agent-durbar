/** The adapters the app registers (spec 012). Real adapters only: a test double such as FakeAdapter must never be listed here. */
import type { AdapterDescriptor } from './capabilities';
import { COPILOT_DESCRIPTOR } from './copilot';

export const PRODUCTION_DESCRIPTORS: readonly AdapterDescriptor[] = [COPILOT_DESCRIPTOR];

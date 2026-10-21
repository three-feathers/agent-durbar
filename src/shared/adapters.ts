import type { AdapterCapabilities, AdapterState } from '../adapters/capabilities';

/** What the renderer learns about one adapter (spec 012 FR-033). Plain data: no functions, safe to send over IPC. */
export interface AdapterInfo {
  id: string;
  displayName: string;
  state: AdapterState;
  version?: string;
  hint?: string;
  /** Spec 060 FR-003: where the app was found, `~/…` or only the file name (never the user name). */
  where?: string;
  capabilities: AdapterCapabilities;
}

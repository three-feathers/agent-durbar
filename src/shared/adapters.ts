import type { AdapterCapabilities, AdapterState } from '../adapters/capabilities';

/** What the renderer learns about one adapter (spec 012 FR-033). Plain data: no functions, safe to send over IPC. */
export interface AdapterInfo {
  id: string;
  displayName: string;
  state: AdapterState;
  version?: string;
  hint?: string;
  capabilities: AdapterCapabilities;
}

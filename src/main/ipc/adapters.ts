/** IPC for the list of agent apps and whether each can run (spec 012 FR-033, FR-034; moved out of main.ts as it was, spec 045 FR-060). Detection itself stays in main.ts. */
import { ipcHandle } from '../ipcguard';
import type { AdapterInfo } from '../../shared/adapters';

export interface AdaptersIpcDeps {
  adaptersList(refresh: boolean): Promise<AdapterInfo[]>;
}

export function register(deps: AdaptersIpcDeps): void {
  const { adaptersList } = deps;
  ipcHandle('adapters:list', (_e, refresh: unknown): Promise<AdapterInfo[]> => adaptersList(refresh === true));
}

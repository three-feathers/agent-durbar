/**
 * Spec 087 IPC: *Continue without the OS sandbox* (FR-007a), *Always continue on this computer* and its undo (FR-007c), and the
 * Settings > Agent apps line per app (FR-012). Only Durbar's own window may call these (`fromApp`); the checks themselves are in
 * `../sandboxops.ts` (a known id with an open note main forwarded, a boolean `always`, a known app id).
 */
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { AdapterRouter } from '../../adapters/router';
import type { AgentInfo } from '../../shared/api';
import type { SettingsStore } from '../settings';
import { createSandboxOps } from '../sandboxops';
import type { SandboxOps } from '../sandboxops';

export interface SandboxIpcDeps {
  agents: Map<string, AgentInfo>;
  router: AdapterRouter;
  getSettingsStore(): SettingsStore | undefined;
  /** The ids of the agent apps that are ready on this computer. */
  readyAdapterIds(): Promise<ReadonlySet<string>>;
}

/** Registers the three channels and returns the operations, whose `onEvent` main feeds with every adapter event. */
export function register(deps: SandboxIpcDeps): SandboxOps {
  const { agents, router } = deps;
  const ops = createSandboxOps({
    adapterOf: (id) => (agents.has(id) ? router.forAgent(id) : undefined),
    instance: (app) => router.instance(app),
    readyAdapterIds: deps.readyAdapterIds,
    store: () => deps.getSettingsStore(),
  });
  ipcHandle('agents:sandboxContinue', (e, id: unknown, opts: unknown) => ops.continueWithout(fromApp(e), id, opts));
  ipcHandle('adapters:sandboxHosts', (e) => ops.hosts(fromApp(e)));
  ipcHandle('adapters:sandboxAlwaysOff', (e, app: unknown) => ops.alwaysOff(fromApp(e), app));
  return ops;
}

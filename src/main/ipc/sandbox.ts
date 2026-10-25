/**
 * Spec 087 IPC: *Continue without the OS sandbox* (FR-007a), *Always continue on this computer* and its undo (FR-007c), and the
 * Settings > Agent apps line per app (FR-012). Main checks every value from the window: a known agent id, a boolean `always`, a known
 * app id; only Durbar's own window may call these (`fromApp`). The adapter refuses what its app or the policy does not allow.
 */
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { AdapterRouter } from '../../adapters/router';
import type { AgentInfo, SandboxHostView } from '../../shared/api';
import { sandboxReason } from '../../shared/sandbox';
import { ANNOUNCE_APPS } from '../../shared/credits';
import type { SettingsStore } from '../settings';

export interface SandboxIpcDeps {
  agents: Map<string, AgentInfo>;
  router: AdapterRouter;
  getSettingsStore(): SettingsStore | undefined;
  /** The ids of the agent apps that are ready on this computer. */
  readyAdapterIds(): Promise<ReadonlySet<string>>;
}

const errText = (e: unknown): string => sandboxReason(e instanceof Error ? e.message : String(e)) ?? 'Durbar could not do that.';

export function register(deps: SandboxIpcDeps): void {
  const { agents, router } = deps;
  ipcHandle('agents:sandboxContinue', async (e, id: unknown, opts: unknown) => {
    if (!fromApp(e)) return { ok: false, error: 'invalid request' };
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    const ad = a ? router.forAgent(a.id) : undefined;
    if (!a || !ad) return { ok: false, error: 'unknown agent' };
    if (!ad.capabilities.osSandbox || typeof ad.continueWithoutSandbox !== 'function') return { ok: false, error: 'This agent app has no OS sandbox choice.' };
    const always = !!opts && typeof opts === 'object' && Object.prototype.hasOwnProperty.call(opts, 'always') && (opts as { always?: unknown }).always === true;
    try {
      await ad.continueWithoutSandbox(a.id, { always }); // the adapter refuses under the policy (FR-007d) and where Always is not offered
    } catch (err) {
      return { ok: false, error: errText(err) };
    }
    if (always) deps.getSettingsStore()?.setSandboxAlwaysContinue(ad.id, true);
    return { ok: true };
  });
  ipcHandle('adapters:sandboxHosts', async (e) => {
    if (!fromApp(e)) return {};
    const ready = await deps.readyAdapterIds();
    const out: Record<string, SandboxHostView> = {};
    for (const app of ANNOUNCE_APPS) {
      if (!ready.has(app)) continue;
      let ad;
      try {
        ad = router.instance(app);
      } catch {
        continue;
      }
      if (!ad.capabilities.osSandbox || typeof ad.sandboxHost !== 'function') continue;
      try {
        const v = await ad.sandboxHost();
        out[app] = { ...v, ...(deps.getSettingsStore()?.sandboxAlwaysContinue(app) ? { alwaysContinue: true } : {}) };
      } catch {
        out[app] = { available: false, reason: 'Durbar could not ask this app about its sandbox.' };
      }
    }
    return out;
  });
  // FR-007c: Settings only undoes the stored choice; it is stored only through *Continue* where the adapter offers it
  ipcHandle('adapters:sandboxAlwaysOff', (e, app: unknown) => {
    if (!fromApp(e) || typeof app !== 'string' || !(ANNOUNCE_APPS as readonly string[]).includes(app)) return { ok: false };
    deps.getSettingsStore()?.setSandboxAlwaysContinue(app, false);
    return { ok: true };
  });
}

import type { AdapterRegistry } from './registry';
import type { AgentAdapter, AgentEvent, ModelOption, PermissionMode, Unsubscribe } from './types';
import type { HistoryResult, PreviousSession } from './history';

/**
 * Routes each agent to the adapter that runs it (spec 012 FR-046..FR-050).
 * Pure: no Electron, no file system, no SDK. Adapters are created lazily, one per id, by the registry.
 */
export interface AdapterRouter {
  /** The one adapter for this id, created on first use. Throws on an unknown id. */
  instance(adapterId: string): AgentAdapter;
  /** Throws when the agent is already bound to a different adapter; the same adapter is a no-op. */
  bind(agentId: string, adapterId: string): void;
  unbind(agentId: string): void;
  forAgent(agentId: string): AgentAdapter | undefined;
  adapterIdOf(agentId: string): string | undefined;
  /** Events of every adapter, existing and created later. The returned function detaches all of them. */
  onEvent(listener: (e: AgentEvent) => void): Unsubscribe;
  /** Debug sink for every adapter, existing and created later. */
  setDebug(fn: ((message: string) => void) | undefined): void;
  created(): readonly AgentAdapter[];
  /** Disposes only the adapters that were created. Never throws and never creates one. */
  disposeAll(): Promise<void>;
}

export function createRouter(reg: AdapterRegistry): AdapterRouter {
  const instances = new Map<string, AgentAdapter>();
  const bound = new Map<string, string>();
  const listeners = new Set<{ fn: (e: AgentEvent) => void; offs: Map<string, Unsubscribe> }>();
  let debug: ((message: string) => void) | undefined;

  const attach = (id: string, ad: AgentAdapter): void => {
    for (const l of listeners) l.offs.set(id, ad.onEvent(l.fn));
    if (debug) ad.debug = debug;
  };

  const instance = (adapterId: string): AgentAdapter => {
    const have = instances.get(adapterId);
    if (have) return have;
    const ad = reg.create(adapterId); // throws on an unknown id
    instances.set(adapterId, ad);
    attach(adapterId, ad);
    return ad;
  };

  return {
    instance,
    bind(agentId, adapterId) {
      const cur = bound.get(agentId);
      if (cur !== undefined) {
        if (cur === adapterId) return;
        throw new Error('adapter router: agent is already bound to another adapter');
      }
      if (!reg.has(adapterId)) throw new Error(`adapter router: unknown adapter ${JSON.stringify(adapterId)}`);
      bound.set(agentId, adapterId);
    },
    unbind: (agentId) => void bound.delete(agentId),
    forAgent(agentId) {
      const id = bound.get(agentId);
      return id === undefined ? undefined : instance(id);
    },
    adapterIdOf: (agentId) => bound.get(agentId),
    onEvent(listener) {
      const l = { fn: listener, offs: new Map<string, Unsubscribe>() };
      listeners.add(l);
      for (const [id, ad] of instances) l.offs.set(id, ad.onEvent(listener));
      return () => {
        listeners.delete(l);
        for (const off of l.offs.values()) off();
        l.offs.clear();
      };
    },
    setDebug(fn) {
      debug = fn;
      for (const ad of instances.values()) ad.debug = fn;
    },
    created: () => [...instances.values()],
    async disposeAll() {
      await Promise.allSettled([...instances.values()].map((ad) => ad.dispose()));
    },
  };
}

// Optional members of AgentAdapter with the same fallbacks main.ts used before routing (FR-050).
export const previousSessionsOf = async (ad: AgentAdapter, cwd: string, exclude: ReadonlySet<string>): Promise<PreviousSession[]> => (await ad.listPreviousSessions?.(cwd, exclude)) ?? [];
export const historyOf = async (ad: AgentAdapter, sessionId: string): Promise<HistoryResult> => (ad.history ? ad.history(sessionId) : { items: [], total: 0, truncated: false });
export const modelOptionsOf = async (ad: AgentAdapter): Promise<ModelOption[]> => (await ad.listModelOptions?.()) ?? [];
/** Reports whether the adapter has the member (`applied`); a live session whose adapter lacks it keeps its old setting, so callers must refuse instead of saving. */
export const setPermModeOf = (ad: AgentAdapter, sessionId: string, mode: PermissionMode, opts?: { clearGrants?: boolean; approvePending?: boolean }): { applied: boolean; pending: number } =>
  ad.setPermMode ? { applied: true, pending: ad.setPermMode(sessionId, mode, opts).pending } : { applied: false, pending: 0 };
/** True when a live session could not take a setting because the adapter lacks the member: the caller refuses and saves nothing. A session that is not live is fine: the value goes in the start options. */
export const refusesLive = (ad: AgentAdapter, sessionId: string, applied: boolean): boolean => !applied && ad.isLive(sessionId);
export const setCapOf = async (ad: AgentAdapter, sessionId: string, credits: number | null): Promise<boolean> => {
  if (!ad.setCap) return false;
  await ad.setCap(sessionId, credits);
  return true;
};
export const setMcpEnabledOf = async (ad: AgentAdapter, sessionId: string, name: string, enabled: boolean): Promise<boolean> => {
  if (!ad.setMcpEnabled) return false;
  await ad.setMcpEnabled(sessionId, name, enabled);
  return true;
};
export const interruptOf = async (ad: AgentAdapter, sessionId: string): Promise<boolean> => {
  if (!ad.interrupt) return false;
  await ad.interrupt(sessionId);
  return true;
};

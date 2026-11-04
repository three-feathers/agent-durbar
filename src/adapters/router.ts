import type { AdapterRegistry } from './registry';
import type { AgentAdapter, AgentEvent, ModelOption, PermissionMode, Unsubscribe, WriteGuard } from './types';
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
  /** Spec 099 FR-082: main's check on every event, before any listener gets it. False drops the event. Asked once per event. */
  setEventGuard(fn: ((e: AgentEvent) => boolean) | undefined): void;
  /** Spec 065 FR-001: the write guard every adapter instance calls before a file-edit write. */
  setWriteGuard(fn: WriteGuard | undefined): void;
  created(): readonly AgentAdapter[];
  /** Disposes only the adapters that were created. Never throws and never creates one. */
  disposeAll(): Promise<void>;
}

/**
 * Which adapter a new session of a folder uses (spec 012 FR-046..FR-050): an explicit id wins, else the folder's saved id,
 * else the default. An id this build does not know (or, when `ready` is given, one that is not ready) is refused, so a saved folder is never opened as another adapter.
 */
export function adapterForAdd(explicit: string | undefined, saved: string | undefined, has: (id: string) => boolean, def: string, ready?: (id: string) => boolean): { id: string } | { error: string } {
  if (explicit !== undefined) {
    if (!has(explicit)) return { error: 'This agent app is not supported by this version.' };
    // Spec 012 FR-058 (T017): a kind the user picked must be ready; there is no fallback to another kind.
    if (ready && !ready(explicit)) return { error: 'This agent app is not ready on this computer. Set it up in Settings > Agent apps.' };
    return { id: explicit };
  }
  if (saved !== undefined) return has(saved) ? { id: saved } : { error: 'This folder was saved for an agent app this version does not support.' };
  return { id: def };
}

export function createRouter(reg: AdapterRegistry): AdapterRouter {
  const instances = new Map<string, AgentAdapter>();
  const bound = new Map<string, string>();
  const listeners = new Set<{ fn: (e: AgentEvent) => void; offs: Map<string, Unsubscribe> }>();
  let debug: ((message: string) => void) | undefined;
  let writeGuard: WriteGuard | undefined;
  let eventGuard: ((e: AgentEvent) => boolean) | undefined;
  const verdicts = new WeakMap<AgentEvent, boolean>();
  const passes = (e: AgentEvent): boolean => {
    if (!eventGuard) return true;
    const seen = verdicts.get(e);
    if (seen !== undefined) return seen;
    const ok = eventGuard(e);
    verdicts.set(e, ok);
    return ok;
  };
  const guarded = (fn: (e: AgentEvent) => void) => (e: AgentEvent): void => { if (passes(e)) fn(e); };

  const attach = (id: string, ad: AgentAdapter): void => {
    for (const l of listeners) l.offs.set(id, ad.onEvent(guarded(l.fn)));
    if (debug) ad.debug = debug;
    if (writeGuard) ad.writeGuard = writeGuard;
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
      for (const [id, ad] of instances) l.offs.set(id, ad.onEvent(guarded(listener)));
      return () => {
        listeners.delete(l);
        for (const off of l.offs.values()) off();
        l.offs.clear();
      };
    },
    setWriteGuard(fn) {
      writeGuard = fn;
      for (const ad of instances.values()) ad.writeGuard = fn;
    },
    setEventGuard(fn) {
      eventGuard = fn;
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
/** Spec 006 FR-028: the adapter's own delete; false when it has none (the caller says so, nothing is touched). */
export const deleteSessionOf = async (ad: AgentAdapter, sessionId: string): Promise<boolean> => {
  if (!ad.deleteSession) return false;
  await ad.deleteSession(sessionId);
  return true;
};
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

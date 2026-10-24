/** IPC for folders: hide, close, remove, rename, default agent (specs 006, 033, 043, 044; moved out of main.ts as it was, spec 045 FR-060). */
import { ipcHandle } from '../ipcguard';
import type { AdapterRouter } from '../../adapters/router';
import type { AgentInfo } from '../../shared/api';
import type { FolderStore } from '../folders';
import type { AgentStateTracker } from '../mcp/agentstate';
import type { Scheduler } from '../schedules';

export interface FoldersIpcDeps {
  /** Spec 080 FR-023: each removed session's browser view and partition are destroyed. */
  browserGone?(id: string): void;
  agents: Map<string, AgentInfo>;
  router: AdapterRouter;
  agentState: AgentStateTracker;
  /** Created when the app is ready: read when a handler runs. */
  getFolderStore(): FolderStore | undefined;
  getScheduler(): Scheduler | undefined;
  /** Per agent: the VS Code chat files last listed; dropped when the folder goes. */
  vsChatRefs: Map<string, unknown>;
  wsKey(a: AgentInfo): string;
}

export function register(deps: FoldersIpcDeps): void {
  const { agents, router, agentState, vsChatRefs, wsKey } = deps;
  const folderStore = deps.getFolderStore;
  const scheduler = deps.getScheduler;
  ipcHandle('folders:setHidden', (_e, id: unknown, hidden: unknown) => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    if (!a) return { ok: false };
    const key = wsKey(a);
    for (const x of agents.values()) if (wsKey(x) === key) x.hidden = hidden === true;
    folderStore()?.setHidden(key, hidden === true);
    return { ok: true };
  });
  ipcHandle('folders:setClosed', (_e, id: unknown, closed: unknown) => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    if (!a) return { ok: false };
    const key = wsKey(a);
    for (const x of agents.values()) if (wsKey(x) === key) x.closed = closed === true;
    folderStore()?.setClosed(key, closed === true);
    return { ok: true };
  });
  ipcHandle('folders:remove', async (_e, id: unknown) => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    if (!a) return { ok: false, removedIds: [] as string[] };
    const key = wsKey(a);
    scheduler()?.removeFolder(key); // spec 044: a removed folder takes its schedules with it
    const removedIds = [...agents.values()].filter((x) => wsKey(x) === key).map((x) => x.id);
    for (const rid of removedIds) {
      try {
        await router.forAgent(rid)?.stop(rid); // no-op when it is not running; the history stays in ~/.copilot
      } catch {
        /* already gone */
      }
      router.unbind(rid);
      deps.browserGone?.(rid); // spec 080 FR-023
      agents.delete(rid);
      agentState.remove(rid);
      vsChatRefs.delete(rid);
    }
    scheduler()?.sessionsChanged();
    folderStore()?.remove(key);
    return { ok: true, removedIds };
  });
  ipcHandle('folders:rename', (_e, id: unknown, label: unknown) => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    const store = folderStore();
    if (!a || !store) return { ok: false };
    const r = store.setLabel(wsKey(a), label);
    if (!r) return { ok: false };
    for (const x of agents.values()) if (wsKey(x) === wsKey(a)) x.label = r.label;
    return { ok: true, label: r.label };
  });

  ipcHandle('folders:setDefaultAgent', (_e, id: unknown, profileId: unknown) => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    const store = folderStore();
    if (!a || !store) return { ok: false };
    const r = store.setDefaultAgent(wsKey(a), profileId);
    if (!r) return { ok: false };
    for (const x of agents.values()) if (wsKey(x) === wsKey(a)) x.defaultAgent = r.defaultAgent;
    return { ok: true, defaultAgent: r.defaultAgent };
  });
}

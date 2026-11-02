/** IPC for folders: hide, close, remove, rename, default agent (specs 006, 033, 043, 044; moved out of main.ts as it was, spec 045 FR-060). */
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { AdapterRouter } from '../../adapters/router';
import type { AgentInfo } from '../../shared/api';
import type { FolderStore } from '../folders';
import { renameFolderOp } from '../folders';
import type { AgentStateTracker } from '../mcp/agentstate';
import type { Scheduler } from '../schedules';
import { NATIVE_CANCELLED, type NotesOps } from '../notesops';

export interface FoldersIpcDeps {
  /** Spec 087 FR-007a: a removed session's open sandbox note is forgotten (main's one-shot Continue). */
  forgetSandboxNote?(id: string): void;
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
  /** Spec 083 FR-048 (T034b): *Also delete its notes*. Created when the app is ready: read when a handler runs. */
  getNotesOps?(): NotesOps | undefined;
}

/** Spec 083 FR-048 (T034b): `folders:remove`'s options: absent, or an object with only `deleteNotes`, a boolean. */
export function removeOpts(v: unknown): { deleteNotes: boolean } | undefined {
  if (v === undefined) return { deleteNotes: false };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const keys = Object.keys(v);
  if (keys.some((k) => k !== 'deleteNotes')) return undefined;
  const d = (v as { deleteNotes?: unknown }).deleteNotes;
  if (d !== undefined && typeof d !== 'boolean') return undefined;
  return { deleteNotes: d === true };
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
  ipcHandle('folders:remove', async (e, id: unknown, opts: unknown) => {
    if (!fromApp(e)) return { ok: false, removedIds: [] as string[] };
    const o = removeOpts(opts);
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    if (!a || !o) return { ok: false, removedIds: [] as string[] };
    const key = wsKey(a);
    // spec 083 FR-048 (T034b): with *Also delete its notes*, main counts the folder's notes and asks natively BEFORE anything is removed
    let forget = false;
    if (o.deleteNotes) {
      const ops = deps.getNotesOps?.();
      if (!ops) return { ok: false, removedIds: [] as string[], error: 'Notes are not available.' };
      const c = await ops.confirmForget(a.id);
      if (!c.ok) return { ok: false, removedIds: [] as string[], ...(c.error === NATIVE_CANCELLED ? { cancelled: true } : {}), error: c.error };
      forget = true;
    }
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
      deps.forgetSandboxNote?.(rid); // spec 087
      agents.delete(rid);
      agentState.remove(rid);
      vsChatRefs.delete(rid);
    }
    scheduler()?.sessionsChanged();
    folderStore()?.remove(key);
    if (!forget) return { ok: true, removedIds };
    // only this folder's notes file, by main's own key (never a path from the window); the project's .durbar/notes/notes.md is not touched
    const f = await deps.getNotesOps?.()?.forget(key);
    return f && f.ok ? { ok: true, removedIds, notesDeleted: true } : { ok: true, removedIds, notesError: (f && !f.ok && f.error) || 'Notes are not available.' };
  });
  ipcHandle('folders:rename', (_e, id: unknown, label: unknown) => {
    const a = typeof id === 'string' ? agents.get(id) : undefined;
    const store = folderStore();
    if (!a || !store) return { ok: false };
    // spec 059 delta 2026-10-24: the session-name rule; an invalid non-empty name is refused with its reason, the label untouched (empty still resets)
    const r = renameFolderOp(store, wsKey(a), label);
    if (!r.ok) return r;
    for (const x of agents.values()) if (wsKey(x) === wsKey(a)) x.label = r.label;
    return r;
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

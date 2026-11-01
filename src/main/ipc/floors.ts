/** IPC for floors: office data only; no handler pauses, stops or ends a session (spec 033 FR-009, FR-010; moved out of main.ts as it was, spec 045 FR-060). */
import { ipcHandle } from '../ipcguard';
import type { AgentInfo, FloorsResult, FloorsState } from '../../shared/api';
import { GROUND } from '../../shared/floors';
import type { FloorOp } from '../../shared/floors';
import type { FolderStore } from '../folders';
import { emptyOrder } from '../../shared/roomorder';

export interface FloorsIpcDeps {
  agents: Map<string, AgentInfo>;
  /** Created when the app is ready: read when a handler runs. */
  getFolderStore(): FolderStore | undefined;
  wsKey(a: AgentInfo): string;
}

export function register(deps: FloorsIpcDeps): void {
  const { agents, wsKey } = deps;
  const folderStore = deps.getFolderStore;
  // ---- Floors (spec 033): office data only; no handler pauses, stops or ends a session (FR-009, FR-010) ----
  const floorsState = (): FloorsState => {
    const doc = folderStore()?.floors() ?? { floors: [{ id: GROUND, name: 'Ground floor', on: true }], lastFloor: GROUND };
    const byAgent: Record<string, string> = {};
    for (const a of agents.values()) byAgent[a.id] = a.floor ?? GROUND;
    return { floors: doc.floors.map((f) => ({ ...f, ground: f.id === GROUND })), lastFloor: doc.lastFloor, byAgent };
  };
  /** After a floor change, every agent takes its folder's floor from the store again (a deleted floor sends them to the ground floor). */
  const floorsResult = (r: FloorOp | undefined): FloorsResult => {
    const store = folderStore();
    if (store) for (const a of agents.values()) a.floor = store.floorOfFolder(wsKey(a));
    return r && r.ok ? { ok: true, state: floorsState() } : { ok: false, error: r && !r.ok ? r.error : 'Floors are not available.', state: floorsState() };
  };
  ipcHandle('floors:state', () => floorsState());
  // Manual order of rooms, desks and places (issue #677): sequencing only, kept in the same file as the floors.
  ipcHandle('floors:order', () => folderStore()?.order() ?? emptyOrder());
  ipcHandle('floors:setOrder', (_e, doc: unknown) => folderStore()?.setOrder(doc) ?? emptyOrder());
  ipcHandle('floors:create', (_e, name: unknown) => floorsResult(folderStore()?.createFloor(name)));
  ipcHandle('floors:rename', (_e, id: unknown, name: unknown) => floorsResult(folderStore()?.renameFloor(id, name)));
  ipcHandle('floors:reorder', (_e, ids: unknown) => floorsResult(folderStore()?.reorderFloors(ids)));
  ipcHandle('floors:delete', (_e, id: unknown) => floorsResult(folderStore()?.deleteFloor(id)));
  ipcHandle('floors:setOn', (_e, id: unknown, on: unknown) => floorsResult(folderStore()?.setFloorOn(id, on === true)));
  ipcHandle('floors:only', (_e, id: unknown) => floorsResult(folderStore()?.onlyFloor(id)));
  ipcHandle('floors:moveFolder', (_e, agentId: unknown, floorId: unknown): FloorsResult => {
    const a = typeof agentId === 'string' ? agents.get(agentId) : undefined;
    const store = folderStore();
    if (!a || !store || !store.moveFolder(wsKey(a), floorId)) return { ok: false, error: 'Unknown folder or floor.', state: floorsState() };
    return floorsResult({ ok: true, doc: store.floors() });
  });
}

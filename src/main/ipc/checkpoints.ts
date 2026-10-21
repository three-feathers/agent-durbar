/** IPC for undoing an agent's file changes per turn (spec 065; moved out of main.ts as it was, spec 045 FR-060). The store and the write guard stay in main.ts. */
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { AgentInfo } from '../../shared/api';
import type { CheckpointStore } from '../checkpoints';

export interface CheckpointsIpcDeps {
  agents: Map<string, AgentInfo>;
  /** Created on first use: read when a handler runs. */
  getCheckpointStore(): CheckpointStore | undefined;
  busyStatus(id: string): boolean;
}

export function register(deps: CheckpointsIpcDeps): void {
  const { agents, busyStatus } = deps;
  const checkpointStore = deps.getCheckpointStore;
  const checkpointArgs = (id: unknown, turn: unknown): string | undefined => (typeof id === 'string' && agents.has(id) && Number.isInteger(turn) && (turn as number) > 0 ? id : undefined);
  ipcHandle('agents:checkpointPreview', (e, id: unknown, turn: unknown) => {
    const a = fromApp(e) ? checkpointArgs(id, turn) : undefined; // FR-005: Durbar's own window only, never MCP, remote control or schedules
    return a && checkpointStore() ? checkpointStore()!.preview(a, turn) : { ok: false, error: 'invalid request' };
  });
  ipcHandle('agents:checkpointUndo', (e, id: unknown, turn: unknown) => {
    const a = fromApp(e) ? checkpointArgs(id, turn) : undefined;
    if (!a || !checkpointStore()) return { ok: false, error: 'invalid request' };
    if (busyStatus(a)) return { ok: false, error: 'The agent is working. Stop it or wait for the turn to end, then undo.' };
    return checkpointStore()!.undo(a, turn);
  });
}

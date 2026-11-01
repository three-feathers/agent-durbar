/**
 * IPC for folder notes (spec 083 FR-062, issue 699): window-only channels, each checked with `fromApp(e)`; the window sends an agent
 * id and plain values, never a path. Validation, the folder, the session and the masking are in `NotesOps` (unit tested without
 * Electron). The project-file switch and its count are `notes:setFile` / `notes:fileCount` (T042); `notes:export` shows main's save
 * dialog and writes the chosen file (T034b, FR-048).
 */
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { NotesOps } from '../notesops';

export interface NotesIpcDeps {
  /** Created when the app is ready: read when a handler runs. */
  getOps(): NotesOps | undefined;
}

const NO: { ok: false; code: 'invalid'; error: string } = { ok: false, code: 'invalid', error: 'Notes are not available.' };

export function register(deps: NotesIpcDeps): void {
  const ops = deps.getOps;
  ipcHandle('notes:list', (e, agentId: unknown) => (!fromApp(e) ? NO : ops()?.list(agentId) ?? NO));
  ipcHandle('notes:save', (e, agentId: unknown, input: unknown) => (!fromApp(e) ? NO : ops()?.save(agentId, input) ?? NO));
  ipcHandle('notes:add', (e, agentId: unknown, input: unknown) => (!fromApp(e) ? NO : ops()?.add(agentId, input) ?? NO));
  ipcHandle('notes:update', (e, agentId: unknown, id: unknown, rev: unknown, patch: unknown) => (!fromApp(e) ? NO : ops()?.update(agentId, id, rev, patch) ?? NO));
  ipcHandle('notes:delete', (e, agentId: unknown, id: unknown, rev: unknown) => (!fromApp(e) ? NO : ops()?.remove(agentId, id, rev) ?? NO));
  ipcHandle('notes:deleteAll', (e, agentId: unknown) => (!fromApp(e) ? NO : ops()?.removeAll(agentId) ?? NO));
  ipcHandle('notes:startOver', (e, agentId: unknown) => (!fromApp(e) ? NO : ops()?.startOver(agentId) ?? NO));
  ipcHandle('notes:fileCount', (e, agentId: unknown) => (!fromApp(e) ? NO : ops()?.fileCount(agentId) ?? NO));
  ipcHandle('notes:export', (e, agentId: unknown) => (!fromApp(e) ? NO : ops()?.export(agentId) ?? NO));
  ipcHandle('notes:setFile', (e, agentId: unknown, on: unknown, opts: unknown) => (!fromApp(e) ? NO : ops()?.setFile(agentId, on, opts) ?? NO));
}

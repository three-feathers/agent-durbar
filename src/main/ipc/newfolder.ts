/**
 * Spec 093 (create a folder from + Folder): `folders:createPickParent`, `folders:createCheck` and `folders:create` (FR-080). Each one
 * answers only the app's own window (`ipcHandle`, and `fromApp(e)` again here: they write to the user's disk and run git). The work
 * is in `newfolderop.ts`; this file only reads the arguments, opens main's own system picker and hands over the real dependencies.
 * Under the simulator none of these channels is open (`SIM_OPEN_CHANNELS`): the simulator's bridge fakes them in the window.
 */
import { dialog } from 'electron';
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { AddResult, PermMode, SessionOptions } from '../../shared/api';
import { sessionOptsOf } from '../agentops';
import { createNewFolderOp, nodeNewFolderDeps } from '../newfolderop';
import type { NewFolderOp } from '../newfolderop';
import type { SettingsStore } from '../settings';

export interface NewFolderIpcDeps {
  addMany(paths: string[], permMode: PermMode, opts?: SessionOptions & { persist?: boolean }): Promise<AddResult>;
  /** Read when a handler runs (created when the app is ready). */
  getSettingsStore(): SettingsStore | undefined;
  asEffort(v: unknown): string | undefined;
}

const REFUSED = 'Agent Durbar refused a call that did not come from its own window.';

export function register(deps: NewFolderIpcDeps, op: NewFolderOp = createNewFolderOp(nodeNewFolderDeps({ addMany: deps.addMany, settings: () => deps.getSettingsStore() }))): void {
  // FR-004: main's own picker, at the remembered parent when it is still a folder; the window gets a token and the text to show
  ipcHandle('folders:createPickParent', async (e) => {
    if (!fromApp(e)) return { ok: false, error: REFUSED };
    return op.pickParent(async (start) => {
      const r = await dialog.showOpenDialog({ title: 'Choose where to create the folder', buttonLabel: 'Choose', ...(start ? { defaultPath: start } : {}), properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? undefined : r.filePaths[0];
    });
  });
  ipcHandle('folders:createCheck', (e, req: unknown) => (fromApp(e) ? op.check(req) : { ok: false, error: REFUSED }));
  // FR-060, FR-061: the mode as agents:addFolder passes it (validMode in the op) and the same option parsing (sessionOptsOf)
  ipcHandle('folders:create', async (e, req: unknown, mode: unknown, opts: unknown) => (fromApp(e) ? op.create(req, mode, sessionOptsOf(opts, deps.asEffort)) : { ok: false, agents: [], error: REFUSED }));
}

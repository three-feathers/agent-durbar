/** IPC for scheduled prompts: list, save, remove, run now, pause all (spec 044, spec 052 FR-089; moved out of main.ts as it was, spec 045 FR-060). The scheduler itself and its send path stay in main.ts. */
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { FolderStore } from '../folders';
import { publicDoc, runsReply } from '../schedules';
import type { Scheduler } from '../schedules';

export interface SchedulesIpcDeps {
  /** Created when the app is ready: read when a handler runs. */
  getScheduler(): Scheduler | undefined;
  getFolderStore(): FolderStore | undefined;
}

export function register(deps: SchedulesIpcDeps): void {
  const scheduler = deps.getScheduler; // created when the app is ready: read when a handler runs
  const folderStore = deps.getFolderStore;
  ipcHandle('schedules:list', () => {
    const s = scheduler();
    return s ? publicDoc(s.doc) : { pausedAll: false, schedules: [] }; // spec 044 FR-043: no run logs here; `schedules:runs` serves one schedule's
  });
  // spec 044 FR-043: one schedule's run log, newest first. Read-only (no channel writes, clears or edits a log); the id is checked here, an unknown one gives an empty list
  ipcHandle('schedules:runs', (e, id: unknown) => (fromApp(e) ? runsReply(scheduler(), id) : { ok: false }));
  ipcHandle('schedules:save', (e, input: unknown) => (!fromApp(e) ? { ok: false, error: 'invalid request' } : scheduler() ? scheduler()!.save(input, (f) => !!folderStore()?.get(f)) : { ok: false, error: 'Schedules are not available.' }));
  ipcHandle('schedules:remove', (e, id: unknown) => ({ ok: fromApp(e) && typeof id === 'string' && !!scheduler()?.remove(id) }));
  // spec 052 FR-089: "Run missed now" from the Since you were away card: one run through the same send path as a scheduled one
  ipcHandle('schedules:runNow', async (e, id: unknown) => (!fromApp(e) || typeof id !== 'string' || id.length > 100 ? { ok: false, error: 'invalid request' } : scheduler() ? scheduler()!.runNow(id) : { ok: false, error: 'Schedules are not available.' }));
  ipcHandle('schedules:setPausedAll', (_e, on: unknown) => {
    scheduler()?.setPausedAll(on === true);
    return { ok: !!scheduler(), pausedAll: scheduler()?.doc.pausedAll ?? false };
  });
}

/** IPC for scheduled prompts: list, save, remove, run now, pause all (spec 044, spec 052 FR-089; moved out of main.ts as it was, spec 045 FR-060). The scheduler itself and its send path stay in main.ts. */
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { FolderStore } from '../folders';
import { publicDoc, publicSchedule, runsReply } from '../schedules';
import type { Schedule, Scheduler } from '../schedules';

export interface SchedulesIpcDeps {
  /** Created when the app is ready: read when a handler runs. */
  getScheduler(): Scheduler | undefined;
  getFolderStore(): FolderStore | undefined;
}

/** A schedule as the window sees it: no seal (spec 044 FR-182). */
const clean = <T extends { ok: boolean; schedule?: Schedule }>(r: T): T => (r.ok && r.schedule ? { ...r, schedule: publicSchedule(r.schedule) } : r);

export function register(deps: SchedulesIpcDeps): void {
  const scheduler = deps.getScheduler; // created when the app is ready: read when a handler runs
  const folderStore = deps.getFolderStore;
  ipcHandle('schedules:list', () => {
    const s = scheduler();
    return s ? publicDoc(s.doc) : { pausedAll: false, schedules: [] }; // spec 044 FR-043: no run logs here; `schedules:runs` serves one schedule's
  });
  // spec 044 FR-043: one schedule's run log, newest first. Read-only (no channel writes, clears or edits a log); the id is checked here, an unknown one gives an empty list
  ipcHandle('schedules:runs', (e, id: unknown) => (fromApp(e) ? runsReply(scheduler(), id) : { ok: false }));
  ipcHandle('schedules:save', async (e, input: unknown) => {
    if (!fromApp(e)) return { ok: false, error: 'invalid request' };
    const s = scheduler();
    if (!s) return { ok: false, error: 'Schedules are not available.' };
    await s.readyForMode(input); // spec 044 FR-183: the policy is read first: a save never decides on an empty cache
    return clean(s.save(input, (f) => !!folderStore()?.get(f)));
  });
  // spec 044 FR-182: the window's question before it asks a person about Allow all, and FR-181's choice of a mode. Only these and `schedules:save`
  // change a mode, all behind `fromApp`; MCP tools and remote control have no way to them (test:schedules scans for other callers).
  ipcHandle('schedules:askMode', (e, input: unknown) => (!fromApp(e) ? { ok: false, error: 'invalid request' } : scheduler() ? scheduler()!.askMode(input) : { ok: false, error: 'Schedules are not available.' }));
  ipcHandle('schedules:setMode', async (e, id: unknown, mode: unknown, proof: unknown) => {
    if (!fromApp(e)) return { ok: false, error: 'invalid request' };
    const s = scheduler();
    if (!s) return { ok: false, error: 'Schedules are not available.' };
    await s.readyForMode({ id });
    return clean(s.setMode(id, mode, proof));
  });
  ipcHandle('schedules:remove', (e, id: unknown) => ({ ok: fromApp(e) && typeof id === 'string' && !!scheduler()?.remove(id) }));
  // spec 052 FR-089: "Run missed now" from the Since you were away card: one run through the same send path as a scheduled one
  ipcHandle('schedules:runNow', async (e, id: unknown) => (!fromApp(e) || typeof id !== 'string' || id.length > 100 ? { ok: false, error: 'invalid request' } : scheduler() ? scheduler()!.runNow(id) : { ok: false, error: 'Schedules are not available.' }));
  ipcHandle('schedules:setPausedAll', (_e, on: unknown) => {
    scheduler()?.setPausedAll(on === true);
    return { ok: !!scheduler(), pausedAll: scheduler()?.doc.pausedAll ?? false };
  });
}

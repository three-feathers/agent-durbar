/** IPC for the activity log: read, export through the save dialog, clear (spec 052 FR-071; moved out of main.ts as it was, spec 045 FR-060). */
import { BrowserWindow, dialog } from 'electron';
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import { activityCsv, activityJson } from '../../shared/activity';
import { writeNotesExport } from '../notesexport';
import type { ActivityStore } from '../activitystore';

/**
 * The largest export text. Worst case per row: 416 characters of capped text fields (agent, folder, app 80 each, mode 16, action 160; control
 * characters are already removed), at most 6 bytes each in the pretty JSON (a lone surrogate is written as `\udXXX`), plus keys and indent about 0.2 KB:
 * about 2.7 KB, so 5000 rows are under 14 MB. 16 MB holds every possible log; `test-activity` writes 5000 such rows through the real store in CSV and JSON.
 */
export const ACTIVITY_EXPORT_MAX_BYTES = 16 * 1024 * 1024;

export interface ActivityIpcDeps {
  /** Created when the app is ready: read when a handler runs. */
  getActivityStore(): ActivityStore | undefined;
  getWin(): BrowserWindow | undefined;
}

export function register(deps: ActivityIpcDeps): void {
  const activityStore = deps.getActivityStore;
  // Activity log (spec 052 FR-071): read, export through the save dialog, clear (the window asks first).
  ipcHandle('activity:list', (e, opts: unknown) => {
    if (!fromApp(e)) return { ok: false, rows: [] };
    const limit = opts && typeof opts === 'object' ? (opts as { limit?: unknown }).limit : undefined;
    return { ok: true, rows: activityStore()?.list(limit) ?? [] };
  });
  ipcHandle('activity:export', async (e, format: unknown) => {
    if (!fromApp(e) || (format !== 'csv' && format !== 'json')) return { ok: false, error: 'invalid request' };
    const day = new Date().toISOString().slice(0, 10);
    const opts: Electron.SaveDialogOptions = { title: 'Export activity', defaultPath: `durbar-activity-${day}.${format}`, filters: [format === 'csv' ? { name: 'CSV', extensions: ['csv'] } : { name: 'JSON', extensions: ['json'] }], properties: ['showOverwriteConfirmation'] };
    const win = deps.getWin();
    const r = win && !win.isDestroyed() ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
    const rows = activityStore()?.all() ?? [];
    // the notes export's write (spec 083 T034b): temp file exclusive, no-follow, 0600, re-checked, renamed; refuses links, hard links, FIFOs and devices
    const w = await writeNotesExport(r.filePath, format === 'csv' ? activityCsv(rows) : activityJson(rows), { what: 'activity', maxBytes: ACTIVITY_EXPORT_MAX_BYTES });
    return w.ok ? { ok: true, count: rows.length, to: w.name } : { ok: false, error: w.error.slice(0, 160) };
  });
  ipcHandle('activity:clear', (e) => {
    if (!fromApp(e)) return { ok: false };
    activityStore()?.clear();
    return { ok: true };
  });
}

/** IPC for the activity log: read, export through the save dialog, clear (spec 052 FR-071; moved out of main.ts as it was, spec 045 FR-060). */
import { BrowserWindow, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import { activityCsv, activityJson } from '../../shared/activity';
import { errText } from '../agentops';
import type { ActivityStore } from '../activitystore';

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
    const opts: Electron.SaveDialogOptions = { title: 'Export activity', defaultPath: `durbar-activity-${day}.${format}`, filters: [format === 'csv' ? { name: 'CSV', extensions: ['csv'] } : { name: 'JSON', extensions: ['json'] }] };
    const win = deps.getWin();
    const r = win && !win.isDestroyed() ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return { ok: false, cancelled: true };
    const rows = activityStore()?.all() ?? [];
    try {
      fs.writeFileSync(r.filePath, format === 'csv' ? activityCsv(rows) : activityJson(rows), { encoding: 'utf8', mode: 0o600 });
      return { ok: true, count: rows.length, to: path.basename(r.filePath) };
    } catch (err) {
      return { ok: false, error: errText(err).slice(0, 160) };
    }
  });
  ipcHandle('activity:clear', (e) => {
    if (!fromApp(e)) return { ok: false };
    activityStore()?.clear();
    return { ok: true };
  });
}

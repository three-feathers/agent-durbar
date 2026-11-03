/**
 * A native confirmation the page cannot answer (Cancel is the default and the Escape answer): used where a choice must come from the
 * person, not from a script in the window (spec 054 FR-011 remote control; spec 083 T042, review of PR 931: the project-file switch).
 */
import { BrowserWindow, dialog } from 'electron';

export async function nativeConfirm(win: BrowserWindow | undefined, o: { message: string; detail: string; ok: string }): Promise<boolean> {
  const opts = { type: 'warning' as const, buttons: ['Cancel', o.ok], defaultId: 0, cancelId: 0, noLink: true, title: 'Agent Durbar', message: o.message, detail: o.detail };
  const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  return r.response === 1;
}

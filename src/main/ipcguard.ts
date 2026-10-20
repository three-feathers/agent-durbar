/**
 * Every IPC call is answered only for the app's own page in the window's main frame (issue #332; spec 045 FR-004, spec 051
 * FR-004b, spec 054 FR-011). Handlers are registered through `ipcHandle` / `ipcOn` instead of `ipcMain` directly, so a new
 * handler cannot forget the check. Defense in depth: the sandbox, the navigation guard, the deny-all window-open handler and
 * the CSP (`default-src 'none'`) already keep other pages and frames out.
 */
import { ipcMain } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import * as path from 'path';
import { senderAllowed } from './hardening';

const APP_INDEX = path.join(__dirname, '..', 'renderer', 'index.html');

/** True when the call comes from the app's own page (any query or hash) in the main frame. */
export function fromAppFrame(e: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const f = e.senderFrame;
  return senderAllowed(f ? { url: f.url, isMain: f === e.sender.mainFrame } : null, APP_INDEX);
}

/** `ipcMain.handle` with the sender check: a call from anywhere else is rejected and never reaches the handler. */
export function ipcHandle<A extends unknown[]>(channel: string, fn: (e: IpcMainInvokeEvent, ...args: A) => unknown): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (!fromAppFrame(e)) throw new Error('Agent Durbar refused a call that did not come from its own window.');
    return fn(e, ...(args as A));
  });
}

/** `ipcMain.on` with the sender check: a message from anywhere else is dropped. */
export function ipcOn<A extends unknown[]>(channel: string, fn: (e: IpcMainEvent, ...args: A) => void): void {
  ipcMain.on(channel, (e, ...args) => {
    if (fromAppFrame(e)) fn(e, ...(args as A));
  });
}

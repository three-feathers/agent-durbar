/**
 * Every IPC call is answered only for the app's own page in the window's main frame (issue #332; spec 045 FR-004, spec 051
 * FR-004b, spec 054 FR-011). Handlers are registered through `ipcHandle` / `ipcOn` instead of `ipcMain` directly, so a new
 * handler cannot forget the check. Defense in depth: the sandbox, the navigation guard, the deny-all window-open handler and
 * the CSP (`default-src 'none'`) already keep other pages and frames out.
 *
 * Spec 010 FR-023 (2026-10-22): in simulator mode (`DURBAR_SIM`) every channel except `SIM_OPEN_CHANNELS` is refused here too,
 * before its handler runs, so neither the window nor a driver's page script can reach a real agent app or the real profile.
 */
import { app, ipcMain } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import * as path from 'path';
import { senderAllowed } from './hardening';
import { devEnv } from './devhooks';
import { simChannelOpen, simRefusal, simulatorOn } from './simguard';

const APP_INDEX = path.join(__dirname, '..', 'renderer', 'index.html');
/** FR-022: decided once, at the first call (the environment is fixed by then); a packaged build has no hooks (FR-018). */
let simulator: boolean | undefined;
const warned = new Set<string>();
/** FR-023: true when the channel may run; a refused one is logged once per channel (stderr, no arguments). */
function simAllows(channel: string): boolean {
  simulator ??= simulatorOn(devEnv(process.env, app.isPackaged));
  if (!simulator || simChannelOpen(channel)) return true;
  if (!warned.has(channel)) {
    warned.add(channel);
    console.warn(`[simguard] refused "${channel}" under DURBAR_SIM`);
  }
  return false;
}

/** True when the call comes from the app's own page (any query or hash) in the main frame. */
export function fromAppFrame(e: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const f = e.senderFrame;
  return senderAllowed(f ? { url: f.url, isMain: f === e.sender.mainFrame } : null, APP_INDEX);
}

/** `ipcMain.handle` with the sender check: a call from anywhere else is rejected and never reaches the handler. */
export function ipcHandle<A extends unknown[]>(channel: string, fn: (e: IpcMainInvokeEvent, ...args: A) => unknown): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (!fromAppFrame(e)) throw new Error('Agent Durbar refused a call that did not come from its own window.');
    if (!simAllows(channel)) throw new Error(simRefusal(channel));
    return fn(e, ...(args as A));
  });
}

/** `ipcMain.on` with the sender check: a message from anywhere else is dropped (and, under the simulator, any channel not open). */
export function ipcOn<A extends unknown[]>(channel: string, fn: (e: IpcMainEvent, ...args: A) => void): void {
  ipcMain.on(channel, (e, ...args) => {
    if (fromAppFrame(e) && simAllows(channel)) fn(e, ...(args as A));
  });
}

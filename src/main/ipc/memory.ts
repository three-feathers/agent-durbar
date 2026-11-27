/**
 * IPC for the office memory (spec 116 T003; FR-001, FR-002, FR-004): window-only channels, each checked with `fromApp(e)`. The window sends a token or
 * a boolean, never a path. Every check is in `MemoryOps` (unit tested without Electron). Any throw answers one fixed `failed`.
 * `memory:changed` is the push to the window (sent by main after a change), not a handler.
 */
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import type { MemoryOps } from '../memoryops';

export interface MemoryIpcDeps {
  getOps(): MemoryOps | undefined;
}

const NO = { ok: false as const, error: 'failed' as const };
async function guard(fn: () => unknown): Promise<unknown> {
  try { return await fn(); } catch { return NO; }
}

export function register(deps: MemoryIpcDeps): void {
  const ops = deps.getOps;
  ipcHandle('memory:status', (e) => (!fromApp(e) ? NO : guard(() => ops()?.status() ?? { on: false, state: 'off', keepInGit: false })));
  ipcHandle('memory:pick', (e) => (!fromApp(e) ? NO : guard(async () => (await ops()?.pick()) ?? NO)));
  ipcHandle('memory:apply', (e, token: unknown) => (!fromApp(e) ? NO : guard(() => ops()?.apply(token) ?? NO)));
  ipcHandle('memory:setOn', (e, on: unknown) => (!fromApp(e) ? NO : guard(() => ops()?.setOn(on) ?? NO)));
  ipcHandle('memory:stop', (e) => (!fromApp(e) ? NO : guard(() => ops()?.stop() ?? NO)));
}

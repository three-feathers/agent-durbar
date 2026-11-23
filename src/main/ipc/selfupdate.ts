/**
 * Spec 118 FR-024 (T010): Durbar's own update check, four version-only channels through the IPC guard. Every argument goes to the
 * validating handler of `selfUpdateHandlers` (`../selfupdate.ts`), which refuses a forged one with one fixed text. The other channels
 * of FR-024 come with their tasks (T011, T014, T017, T018); the window API in the preload comes with the card (T014).
 */
import { ipcHandle } from '../ipcguard';
import { selfUpdateHandlers } from '../selfupdate';
import type { SelfUpdater } from '../selfupdate';

export interface SelfUpdateIpcDeps {
  /** Created when the settings store is ready; a call before that is refused. */
  getSelfUpdater(): SelfUpdater | undefined;
}

export function register(deps: SelfUpdateIpcDeps): void {
  const h = selfUpdateHandlers(deps.getSelfUpdater);
  ipcHandle('selfupdate:get', (_e, ...a: unknown[]) => h.get(...a));
  ipcHandle('selfupdate:check', (_e, ...a: unknown[]) => h.check(...a));
  ipcHandle('selfupdate:snooze', (_e, ...a: unknown[]) => h.snooze(...a));
  ipcHandle('selfupdate:skip', (_e, ...a: unknown[]) => h.skip(...a));
}

/**
 * Spec 118 FR-024 (T010, T011, T014): Durbar's own update check, nine channels through the IPC guard (version-only or no argument, but `setSource`,
 * T011's one free-text channel, and `setDailyCheck`, T014's one boolean channel). Every argument goes to the validating handler of
 * `selfUpdateHandlers` (`../selfupdate.ts`), which refuses a forged one with one fixed text. The download channels come with T017 and T018.
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
  ipcHandle('selfupdate:setSource', (_e, ...a: unknown[]) => h.setSource(...a));
  ipcHandle('selfupdate:useBuiltInSource', (_e, ...a: unknown[]) => h.useBuiltInSource(...a));
  ipcHandle('selfupdate:setDailyCheck', (_e, ...a: unknown[]) => h.setDailyCheck(...a));
  ipcHandle('selfupdate:notes', (_e, ...a: unknown[]) => h.notes(...a));
  ipcHandle('selfupdate:openReleasePage', (_e, ...a: unknown[]) => h.openReleasePage(...a));
}

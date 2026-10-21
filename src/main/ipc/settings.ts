/** IPC for settings: the read, serious mode, notifications, theme choice, places and the default credit cap (specs 011, 024, 040, 052; moved out of main.ts as it was, spec 045 FR-060). */
import { app } from 'electron';
import { ipcHandle } from '../ipcguard';
import { aboutView } from '../../shared/about';
import type { SettingsStore } from '../settings';

export interface SettingsIpcDeps {
  /** Created when the app is ready: read when a handler runs. */
  getSettingsStore(): SettingsStore | undefined;
  /** DURBAR_THEME (spec 040 FR-008): a theme for this run only, never saved; a pick in Settings replaces it. */
  getRunTheme(): string | undefined;
  clearRunTheme(): void;
}

export function register(deps: SettingsIpcDeps): void {
  const { getRunTheme, clearRunTheme } = deps;
  const settingsStore = deps.getSettingsStore;
  ipcHandle('settings:get', () => ({ defaultMaxAiCredits: settingsStore()?.defaultMaxAiCredits, placeMap: settingsStore()?.placeMap ?? {}, customPlaces: settingsStore()?.customPlaces ?? [], seriousMode: settingsStore()?.seriousMode ?? false, notifyNeedsMe: settingsStore()?.notifyNeedsMe ?? true, breakResume: settingsStore()?.breakResume ?? 'auto', theme: getRunTheme() ?? settingsStore()?.theme ?? 'clean-office', about: aboutView(app.getVersion()) }));
  ipcHandle('settings:setSeriousMode', (_e, on: unknown) => ({ ok: true, seriousMode: settingsStore()?.setSeriousMode(on) ?? false }));
  /* spec 052 FR-059: OS notifications when an agent needs you and the window is in the background (on unless turned off) */
  ipcHandle('settings:setNotifyNeedsMe', (_e, on: unknown) => ({ ok: true, notifyNeedsMe: settingsStore()?.setNotifyNeedsMe(on) ?? true }));
  /* spec 068 FR-006: what happens when a coffee break ends ('auto' or 'ask'; anything else keeps the setting) */
  ipcHandle('settings:setBreakResume', (_e, v: unknown) => ({ ok: true, breakResume: settingsStore()?.setBreakResume(v) ?? 'auto' }));
  /* DURBAR_THEME (spec 040 FR-008): a theme for this run only, never saved; a pick in Settings replaces it and is saved as usual. */
  ipcHandle('settings:setTheme', (_e, id: unknown) => {
    clearRunTheme();
    const store = settingsStore();
    return store ? store.setTheme(id) : { ok: false };
  });
  ipcHandle('settings:setPlace', (_e, server: unknown, place: unknown) => settingsStore()?.setPlace(server, place) ?? { ok: false });
  ipcHandle('settings:addPlace', (_e, name: unknown, icon: unknown) => settingsStore()?.addPlace(name, icon) ?? { ok: false, error: 'unknown', customPlaces: [], placeMap: {} });
  ipcHandle('settings:updatePlace', (_e, id: unknown, patch: unknown) => settingsStore()?.updatePlace(id, patch) ?? { ok: false, error: 'unknown', customPlaces: [], placeMap: {} });
  ipcHandle('settings:removePlace', (_e, id: unknown) => settingsStore()?.removePlace(id) ?? { ok: false, error: 'unknown', customPlaces: [], placeMap: {} });
  ipcHandle('settings:setDefaultCap', (_e, credits: unknown) => ({ ok: true, defaultMaxAiCredits: settingsStore()?.setDefaultMaxAiCredits(credits) }));
}

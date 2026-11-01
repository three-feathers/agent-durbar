/** IPC for settings: the read, serious mode, notifications, theme and characters choice (spec 077 FR-064), places and the default credit cap (specs 011, 024, 040, 052; moved out of main.ts as it was, spec 045 FR-060). */
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
  ipcHandle('settings:get', () => ({ defaultMaxAiCredits: settingsStore()?.defaultMaxAiCredits, placeMap: settingsStore()?.placeMap ?? {}, customPlaces: settingsStore()?.customPlaces ?? [], seriousMode: settingsStore()?.seriousMode ?? false, stillHighlights: settingsStore()?.stillHighlights ?? false, notifyNeedsMe: settingsStore()?.notifyNeedsMe ?? true, breakResume: settingsStore()?.breakResume ?? 'auto', chatLinksIn: settingsStore()?.chatLinksIn ?? 'session', theme: getRunTheme() ?? settingsStore()?.theme ?? 'clean-office', characters: settingsStore()?.characters ?? 'theme', about: aboutView(app.getVersion()) }));
  ipcHandle('settings:setSeriousMode', (_e, on: unknown) => ({ ok: true, seriousMode: settingsStore()?.setSeriousMode(on) ?? false }));
  /* spec 001 FR-192: Still highlights (no motion); only a boolean changes it */
  ipcHandle('settings:setStillHighlights', (_e, on: unknown) => {
    const st = settingsStore();
    if (!st || typeof on !== 'boolean') return { ok: false, stillHighlights: st?.stillHighlights ?? false }; /* refused: the real value in force, not a false "saved" */
    const inForce = st.setStillHighlights(on);
    return { ok: inForce === on, stillHighlights: inForce }; /* not ok: the save failed and it stayed as it was */
  });
  /* spec 052 FR-059: OS notifications when an agent needs you and the window is in the background (on unless turned off) */
  ipcHandle('settings:setNotifyNeedsMe', (_e, on: unknown) => ({ ok: true, notifyNeedsMe: settingsStore()?.setNotifyNeedsMe(on) ?? true }));
  /* spec 081 FR-022 (Q6 = A): the agent-app update check at start: on unless turned off */
  ipcHandle('settings:setCheckUpdatesAtStart', (_e, on: unknown) => ({ ok: true, checkUpdatesAtStart: settingsStore()?.setCheckUpdatesAtStart(on) ?? true }));
  /* spec 068 FR-006: what happens when a coffee break ends ('auto' or 'ask'; anything else keeps the setting) */
  ipcHandle('settings:setBreakResume', (_e, v: unknown) => ({ ok: true, breakResume: settingsStore()?.setBreakResume(v) ?? 'auto' }));
  /* spec 080 FR-031: where a plain click on a chat link opens. A preference like the others here (the window's trust boundary); the URL of a click is checked in main whichever it is. */
  ipcHandle('settings:setChatLinksIn', (_e, v: unknown) => ({ ok: true, chatLinksIn: settingsStore()?.setChatLinksIn(v) ?? 'session' }));
  /* DURBAR_THEME (spec 040 FR-008): a theme for this run only, never saved; a pick in Settings replaces it and is saved as usual. */
  ipcHandle('settings:setTheme', (_e, id: unknown) => {
    clearRunTheme();
    const store = settingsStore();
    return store ? store.setTheme(id) : { ok: false };
  });
  /* spec 077 FR-064: who sits at the desks; main accepts only a value from the list (anything else: ok false, the stored value kept) */
  ipcHandle('settings:setCharacters', (_e, v: unknown) => {
    const store = settingsStore();
    return store ? store.setCharacters(v) : { ok: false, characters: 'theme' };
  });
  ipcHandle('settings:setPlace', (_e, server: unknown, place: unknown) => settingsStore()?.setPlace(server, place) ?? { ok: false });
  ipcHandle('settings:addPlace', (_e, name: unknown, icon: unknown) => settingsStore()?.addPlace(name, icon) ?? { ok: false, error: 'unknown', customPlaces: [], placeMap: {} });
  ipcHandle('settings:updatePlace', (_e, id: unknown, patch: unknown) => settingsStore()?.updatePlace(id, patch) ?? { ok: false, error: 'unknown', customPlaces: [], placeMap: {} });
  ipcHandle('settings:removePlace', (_e, id: unknown) => settingsStore()?.removePlace(id) ?? { ok: false, error: 'unknown', customPlaces: [], placeMap: {} });
  ipcHandle('settings:setDefaultCap', (_e, credits: unknown) => ({ ok: true, defaultMaxAiCredits: settingsStore()?.setDefaultMaxAiCredits(credits) }));
}

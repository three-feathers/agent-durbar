/** IPC for settings: the read, serious mode, notifications, theme and characters choice (spec 077 FR-064), places and the default credit cap (specs 011, 024, 040, 052; moved out of main.ts as it was, spec 045 FR-060). */
import { app } from 'electron';
import { ipcHandle } from '../ipcguard';
import { parseCap } from '../../shared/credits';
import { aboutView } from '../../shared/about';
import { mcpWarnDefaults } from '../../shared/mcpcost';
import type { SettingsStore, Saved } from '../settings';
import { MCP_SIGNIN_REFRESH_DEFAULT } from '../mcpsigninrefresh';

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
  ipcHandle('settings:get', () => ({ defaultMaxAiCredits: settingsStore()?.defaultMaxAiCredits, placeMap: settingsStore()?.placeMap ?? {}, customPlaces: settingsStore()?.customPlaces ?? [], seriousMode: settingsStore()?.seriousMode ?? false, motion: settingsStore()?.motion ?? true, stillHighlights: settingsStore()?.stillHighlights ?? false, autoFollowWork: settingsStore()?.autoFollowWork ?? false, notifyNeedsMe: settingsStore()?.notifyNeedsMe ?? true, breakResume: settingsStore()?.breakResume ?? 'auto', chatLinksIn: settingsStore()?.chatLinksIn ?? 'session', mcpSignInRefresh: settingsStore()?.mcpSignInRefresh ?? MCP_SIGNIN_REFRESH_DEFAULT, mcpWarnLevels: settingsStore()?.mcpWarnLevels, theme: getRunTheme() ?? settingsStore()?.theme ?? 'clean-office', characters: settingsStore()?.characters ?? 'theme', unsaved: settingsStore()?.unsavedKeys ?? [], about: aboutView(app.getVersion()) }));
  /* issues #1023, #1094: a setter answers `{ok, value}`, `ok` only when the write reached disk, so a failed write of a value already in force is not "Saved" */
  const setting = <K extends string, T>(key: K, fallback: T, set: (st: SettingsStore, v: unknown) => Saved<T>, want: (v: unknown) => unknown = (v) => v, unsavedKey?: string) => (_e: unknown, v: unknown) => {
    const st = settingsStore();
    const r: Saved<T> = st ? set(st, v) : { ok: false, value: fallback };
    // a safer change kept for this run only (a tighter cap that could not be saved): in force, but not ok, and the window is told
    const kept = st !== undefined && unsavedKey !== undefined && r.value === want(v) && st.isUnsaved(unsavedKey); // this setting only, and only when the value asked for is the one kept (a refused looser cap is not
    return { ok: r.ok && !kept, ...(kept ? { unsaved: true } : {}), [key]: r.value } as { ok: boolean; unsaved?: true } & Record<K, T>;
  };
  ipcHandle('settings:setSeriousMode', setting('seriousMode', false, (st, v) => st.setSeriousMode(v)));
  /* spec 052 FR-069 (issue #1182): Motion, on unless turned off; only a boolean changes it */
  ipcHandle('settings:setMotion', setting('motion', true, (st, v) => st.setMotion(v)));
  /* spec 001 FR-192: Still highlights (no motion); only a boolean changes it */
  ipcHandle('settings:setStillHighlights', setting('stillHighlights', false, (st, v) => st.setStillHighlights(v)));
  /* spec 052 FR-182 (issue 686): Auto-follow work, off by default; only a boolean is accepted (a real ok) */
  ipcHandle('settings:setAutoFollowWork', setting('autoFollowWork', false, (st, v) => st.setAutoFollowWork(v)));
  /* spec 052 FR-059: OS notifications when an agent needs you and the window is in the background (on unless turned off) */
  ipcHandle('settings:setNotifyNeedsMe', setting('notifyNeedsMe', true, (st, v) => st.setNotifyNeedsMe(v)));
  /* spec 081 FR-022 (Q6 = A): the agent-app update check at start: on unless turned off */
  ipcHandle('settings:setCheckUpdatesAtStart', setting('checkUpdatesAtStart', true, (st, v) => st.setCheckUpdatesAtStart(v)));
  /* spec 058 FR-213: Refresh MCP sign-ins automatically (on unless turned off); a non-boolean keeps the setting */
  ipcHandle('settings:setMcpSignInRefresh', setting('mcpSignInRefresh', MCP_SIGNIN_REFRESH_DEFAULT, (st, v) => st.setMcpSignInRefresh(v)));
  /* spec 068 FR-006: what happens when a coffee break ends ('auto' or 'ask'; anything else keeps the setting) */
  ipcHandle('settings:setBreakResume', setting<'breakResume', 'auto' | 'ask'>('breakResume', 'auto', (st, v) => st.setBreakResume(v)));
  /* spec 080 FR-031: where a plain click on a chat link opens. A preference like the others here (the window's trust boundary); the URL of a click is checked in main whichever it is. */
  ipcHandle('settings:setChatLinksIn', setting<'chatLinksIn', 'session' | 'system'>('chatLinksIn', 'session', (st, v) => st.setChatLinksIn(v)));
  /* spec 100 FR-020: the MCP warning levels; refused values keep the setting */
  ipcHandle('settings:setMcpWarnLevels', (_e, v: unknown) => {
    return settingsStore()?.setMcpWarnLevels(v) ?? { ok: false, levels: mcpWarnDefaults() }; // a refusal or a failed write says so: never "Saved"
  });
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
  ipcHandle('settings:setDefaultCap', setting<'defaultMaxAiCredits', number | undefined>('defaultMaxAiCredits', undefined, (st, v) => st.setDefaultMaxAiCredits(v), parseCap, 'defaultMaxAiCredits'));
}

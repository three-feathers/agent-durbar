/**
 * IPC for the session browser (spec 080 T014, FR-003): open, navigate, back, forward, reload, stop, bounds, visible, overlay, mute, open in
 * the system browser, and the state. Every handler is `fromApp`-checked, takes a session id that main looks up, and answers with
 * `BrowserState` only: never the page's DOM, text, cookies or storage. The logic is `makeBrowserController` (src/main/browser/controller.ts).
 */
import { randomBytes } from 'crypto';
import { shell } from 'electron';
import type { BrowserWindow } from 'electron';
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import { closeTabView, destroySessionView, ensureTabView } from '../browser/views';
import { makeBrowserController } from '../browser/controller';
import type { BrowserController, BrowserDeps } from '../browser/controller';
import type { AgentInfo, BrowserResult, BrowserState, BrowserTabs } from '../../shared/api';
import type { SettingsStore } from '../settings';

export interface BrowserIpcDeps {
  agents: Map<string, AgentInfo>;
  getWin(): BrowserWindow | undefined;
  toRenderer(channel: string, payload: unknown): void;
  /** Main's own simulator decision (DURBAR_SIM): the simulated agents' ids are accepted and the test pages exist only then. */
  simulator: boolean;
  /** Under the simulator the one-time note counts as accepted (so every simulator driver reaches the tab) unless this is true (DURBAR_SIM_BROWSER_CONSENT=ask: the consent driver). */
  simAsksConsent: boolean;
  getSettingsStore(): SettingsStore | undefined;
}

const REFUSED: BrowserResult = { ok: false, reason: 'Refused.' };
/** The simulated agents (renderer-side only under DURBAR_SIM) are `sim-1`, `sim-2` ...; their helpers are not top-level. */
const SIM_ID = /^sim-\d{1,3}$/;

export function register(deps: BrowserIpcDeps): BrowserController {
  const { agents, simulator } = deps;
  const win: BrowserDeps['window'] = () => {
    const w = deps.getWin();
    return w && !w.isDestroyed() ? (w as unknown as NonNullable<ReturnType<BrowserDeps['window']>>) : undefined;
  };
  /** *Leave this page?* questions waiting for the window's answer, by request id. */
  const asks = new Map<string, { id: string; resolve(leave: boolean): void }>();
  const consented = (): boolean => (simulator && !deps.simAsksConsent) || deps.getSettingsStore()?.browserNoteAccepted === true;
  // FR-123: one app-wide toggle, read here and never sent by the window. The simulator keeps it in memory (no user settings are written)
  let simLinksNewTab = false;
  const linksNewTab = (): boolean => (simulator ? simLinksNewTab : deps.getSettingsStore()?.chatLinksNewTab === true);
  const ctl = makeBrowserController({
    consented,
    linksNewTab,
    emitTabs: (t: BrowserTabs) => deps.toRenderer('browser:tabs', t),
    tabKey: (k) => deps.toRenderer('browser:key', k),
    pageDialog: (d) => deps.toRenderer('browser:dialog', d),
    askLeave: (id, known, shown) =>
      new Promise<boolean>((resolve) => {
        const req = randomBytes(8).toString('hex');
        asks.set(req, { id, resolve });
        deps.toRenderer('browser:leave', { id, req, known, shown });
      }),
    dropAsks: (id) => {
      for (const [req, a] of asks) if (id === undefined || a.id === id) { asks.delete(req); a.resolve(false); }
    },
    known: (id) => agents.has(id) || (simulator && SIM_ID.test(id)), // main's agents are the top-level sessions; helpers live only in the window
    sim: simulator,
    window: win,
    views: { ensureTabView: (id, tabId, ev, sim) => ensureTabView(id, tabId, ev, sim), closeTabView, destroySessionView },
    emit: (s: BrowserState) => deps.toRenderer('browser:state', s),
    openExternal: (url) => (simulator ? Promise.resolve(false) : shell.openExternal(url)), // the simulator never opens the real desktop
  });
  ipcHandle('browser:open', (e, id: unknown, address: unknown) => (fromApp(e) ? ctl.open(id, address) : REFUSED));
  // the url of a chat link is agent text: main classifies it (web / mail / refused) whatever the window did; the window is trusted only as far as the other channels here
  // FR-124: `how` is 'default' or 'newTab' (the link menu's *Open in a new tab*); anything else is refused in the controller
  ipcHandle('browser:openLink', (e, id: unknown, url: unknown, how: unknown) => (fromApp(e) ? ctl.openLink(id, url, how) : REFUSED));
  // spec 080 FR-127: page tabs. Main mints every tab id; a tab id from the window must have the shape AND belong to that session in main's map
  ipcHandle('browser:newTab', (e, id: unknown, address: unknown) => (fromApp(e) ? ctl.newTab(id, address) : REFUSED));
  ipcHandle('browser:selectTab', (e, id: unknown, tabId: unknown) => (fromApp(e) ? ctl.selectTab(id, tabId) : REFUSED));
  ipcHandle('browser:closeTab', (e, id: unknown, tabId: unknown) => (fromApp(e) ? ctl.closeTab(id, tabId) : REFUSED));
  // FR-123: only a real boolean changes it; every window is told, so every session's menu shows it the same
  ipcHandle('browser:setLinksNewTab', (e, on: unknown) => {
    if (!fromApp(e) || typeof on !== 'boolean') return { ok: false };
    if (simulator) simLinksNewTab = on;
    else deps.getSettingsStore()?.setChatLinksNewTab(on);
    const now = linksNewTab();
    deps.toRenderer('browser:linksNewTab', now);
    return { ok: true, on: now };
  });
  // the only way a browser link reaches another app: a mailto: link after the user's click, re-checked here
  ipcHandle('browser:openMail', (e, url: unknown) => (fromApp(e) ? ctl.openMail(url) : { ok: false }));
  ipcHandle('browser:state', (e, id: unknown) => (fromApp(e) ? ctl.state(id) : REFUSED));
  ipcHandle('browser:navigate', (e, id: unknown, address: unknown) => (fromApp(e) ? ctl.navigate(id, address) : REFUSED));
  ipcHandle('browser:back', (e, id: unknown) => (fromApp(e) ? ctl.history(id, 'back') : REFUSED));
  ipcHandle('browser:forward', (e, id: unknown) => (fromApp(e) ? ctl.history(id, 'forward') : REFUSED));
  ipcHandle('browser:reload', (e, id: unknown) => (fromApp(e) ? ctl.history(id, 'reload') : REFUSED));
  ipcHandle('browser:stop', (e, id: unknown) => (fromApp(e) ? ctl.stop(id) : REFUSED));
  ipcHandle('browser:bounds', (e, id: unknown, bounds: unknown) => (fromApp(e) ? ctl.bounds(id, bounds) : { ok: false }));
  ipcHandle('browser:visible', (e, id: unknown, visible: unknown) => (fromApp(e) ? ctl.visible(id, visible) : { ok: false }));
  ipcHandle('browser:overlay', (e, id: unknown, open: unknown) => (fromApp(e) ? ctl.overlay(id, open) : { ok: false }));
  ipcHandle('browser:mute', (e, id: unknown, muted: unknown) => (fromApp(e) ? ctl.mute(id, muted) : REFUSED));
  ipcHandle('browser:openSystem', (e, id: unknown) => (fromApp(e) ? ctl.openSystem(id) : { ok: false }));
  // records the consent with no proof the dialog was shown (any code in the app window can call it): inside the window's trust boundary, like the other settings channels
  ipcHandle('browser:consentAccept', (e) => {
    if (!fromApp(e)) return { ok: false };
    deps.getSettingsStore()?.acceptBrowserNote();
    return { ok: true };
  });
  ipcHandle('browser:snapshot', (e, id: unknown) => (fromApp(e) ? ctl.snapshot(id) : { ok: false }));
  ipcHandle('browser:leaveAnswer', (e, req: unknown, leave: unknown) => {
    if (!fromApp(e) || typeof req !== 'string' || typeof leave !== 'boolean') return { ok: false };
    const a = asks.get(req);
    if (!a) return { ok: false };
    asks.delete(req);
    a.resolve(leave);
    return { ok: true };
  });
  return ctl;
}

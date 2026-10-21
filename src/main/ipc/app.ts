/** IPC for the app itself: external links, version, the "Since you were away" card, the taskbar badge and window focus (spec 045 FR-060; moved out of main.ts as it was). */
import { app, BrowserWindow, shell } from 'electron';
import { fromAppFrame as fromApp, ipcHandle } from '../ipcguard';
import { isHttpUrl } from '../../shared/url';
import { parseBadgeCount, shouldBounce, shouldFlash } from '../badge';
import type { SinceAway } from '../daily';

export interface AppIpcDeps {
  /** What happened while the app was closed; null after the card is dismissed. */
  getSinceAway(): SinceAway | null;
  clearSinceAway(): void;
  getWin(): BrowserWindow | undefined;
}

export function register(deps: AppIpcDeps): void {
  const { getSinceAway, clearSinceAway, getWin } = deps;
  const liveWin = (): BrowserWindow | undefined => {
    const win = getWin();
    return win && !win.isDestroyed() ? win : undefined;
  };
  ipcHandle('app:openExternal', async (_e, url: unknown) => {
    if (!isHttpUrl(url)) return { ok: false };
    await shell.openExternal(url);
    return { ok: true };
  });
  ipcHandle('app:version', () => app.getVersion());
  ipcHandle('app:sinceAway', (e) => (fromApp(e) ? getSinceAway() : null));
  ipcHandle('app:dismissSinceAway', (e) => {
    if (fromApp(e)) clearSinceAway();
    return { ok: true };
  });
  /* spec 052 FR-059: the "needs you" count on the app icon (macOS, Linux where the desktop supports it), a taskbar flash on Windows */
  let badgeCount = 0;
  ipcHandle('app:setBadge', (_e, count: unknown) => {
    const n = parseBadgeCount(count);
    if (n === null) return { ok: false };
    const w = liveWin();
    if (w && shouldFlash(badgeCount, n, w.isFocused())) w.flashFrame(true);
    if (w && shouldBounce(badgeCount, n, w.isFocused())) app.dock?.bounce('informational'); // spec 052 FR-085: one bounce, not until focused
    if (w && n === 0) w.flashFrame(false);
    badgeCount = n;
    if (process.platform !== 'win32') {
      try {
        app.setBadgeCount(n);
      } catch {
        /* not supported by this desktop: the window title still shows the count */
      }
    }
    return { ok: true };
  });
  /* spec 052 FR-059: a click on a notification brings the window to the front */
  ipcHandle('app:focusWindow', () => {
    const w = liveWin();
    if (!w) return { ok: false };
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
    return { ok: true };
  });
}

/** macOS: what a double-click on the app's own title area does (spec 052 FR-085, issue #591). Pure; `npm run test:macos`. */
export type TitleDoubleClick = 'zoom' | 'minimize' | 'none';

/**
 * Maps the system setting `AppleActionOnDoubleClick` (System Settings > Desktop & Dock > Double-click a window's title bar to).
 * `Maximize` and `Fill` zoom, `Minimize` minimizes, `None` does nothing; an empty or unknown value zooms, as macOS does by default.
 */
export function titleDoubleClickAction(value: unknown): TitleDoubleClick {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (v === 'minimize') return 'minimize';
  if (v === 'none') return 'none';
  return 'zoom';
}

/** The window calls the handler needs (a fake in the test). */
export interface TitleWindow { isDestroyed(): boolean; isMaximized(): boolean; maximize(): void; unmaximize(): void; minimize(): void; webContents: unknown }
export interface TitleDoubleClickDeps {
  platform: string;
  win: TitleWindow | undefined;
  sender: unknown;
  /** `systemPreferences.getUserDefault('AppleActionOnDoubleClick', 'string')`; may throw. */
  getSetting(): unknown;
  now(): number;
}

/** If macOS already zoomed on the same double-click, a `maximize` or `unmaximize` event arrived just before our message; we must not toggle back. */
export const NATIVE_ZOOM_WINDOW_MS = 300;
let lastNativeZoom = -Infinity;
/** Main calls this on the window's `maximize` and `unmaximize` events. */
export function noteWindowZoom(at: number): void {
  lastNativeZoom = at;
}
/** Test hook. */
export function resetWindowZoom(): void {
  lastNativeZoom = -Infinity;
}

/** The main-process side of `window:titleDoubleClick`: darwin only, the app's own live window only; returns what it did. */
export function handleTitleDoubleClick(d: TitleDoubleClickDeps): TitleDoubleClick | 'ignored' {
  const w = d.win;
  if (d.platform !== 'darwin' || !w || w.isDestroyed() || d.sender !== w.webContents) return 'ignored';
  let setting: unknown;
  try {
    setting = d.getSetting();
  } catch {
    setting = ''; // unreadable: the macOS default
  }
  const action = titleDoubleClickAction(setting);
  if (action === 'minimize') w.minimize();
  else if (action === 'zoom') {
    if (d.now() - lastNativeZoom < NATIVE_ZOOM_WINDOW_MS) return 'ignored'; // the system already zoomed
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  }
  return action;
}

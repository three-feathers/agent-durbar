/** Spec 008 FR-038: a packaged build must not expose a DevTools endpoint. Dev runs are unaffected (nothing is removed). */
export const DEBUG_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe'] as const;

/**
 * Switches to remove from Chromium's command line before the app is ready; `packaged` is `app.isPackaged`.
 * The caller removes them without reading argv: Chromium keeps switches by name, so `-x`, `--x`, `--X=0` and (on Windows) `/x` are all covered.
 */
export function debugSwitchesToRemove(packaged: boolean): string[] {
  return packaged ? [...DEBUG_SWITCHES] : [];
}

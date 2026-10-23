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

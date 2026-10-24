/**
 * Spec 080 T013 (FR-011): the soft cap on loaded session-browser views and which one to unload. Pure: the caller (views.ts, later) feeds
 * it facts main already has and reloads the unloaded view with *Reloaded to save memory* when it is shown again.
 */
export const MAX_LIVE_VIEWS = 4;

export interface CapView {
  id: string;
  loaded: boolean;
  /** The view on screen right now: never unloaded. */
  shown: boolean;
  /** Last time the user looked at it (ms); the smallest is the least recently shown. */
  lastShownAt: number;
  /** The current page was reached by a POST. */
  reachedByPost: boolean;
  /** Any character key input since the page loaded (from `input-event`). */
  charKeySinceLoad: boolean;
  /** A `durbar-browser` call is running for it. */
  callInFlight: boolean;
  /** A `durbar-browser` call ran in the current turn of its session (not the driver state, FR-060). */
  callInCurrentTurn: boolean;
  /** A `browser_type` call ran since the page loaded (`Input.insertText` fires no `input-event`; always false in Phase 1). */
  browserTypeSinceLoad: boolean;
}

export function safeToUnload(v: CapView): boolean {
  return v.loaded && !v.shown && !v.reachedByPost && !v.charKeySinceLoad && !v.callInFlight && !v.callInCurrentTurn && !v.browserTypeSinceLoad;
}

/**
 * A new view is about to load. Returns the views to unload (least recently shown first) so that, with the new one, at most `cap` stay
 * loaded. When no safe view is left, `overCap` is true: the new view loads anyway and the newest bar says *Many pages are open; close some to save memory*.
 */
export function pickUnload(views: readonly CapView[], cap: number = MAX_LIVE_VIEWS): { unload: string[]; overCap: boolean } {
  const live = views.filter((v) => v.loaded).length;
  const need = Math.max(0, live + 1 - Math.max(1, cap));
  const candidates = views.filter(safeToUnload).sort((a, b) => a.lastShownAt - b.lastShownAt);
  const unload = candidates.slice(0, need).map((v) => v.id);
  return { unload, overCap: unload.length < need };
}

/*
 * Where a driver may park the pointer so that it is off the plates AND on the visible screen (spec 097 FR-365, review of the Linux run of the pencil-ease driver).
 * A window taller or wider than its X screen (Xvfb 1280x1024 device px, a 2880x1800 window at devicePixelRatio 2) is cut by the screen: a point in the part of
 * the window that is off the screen gets no pointer, so a hover card never closes. Pure numbers in, candidate points out (CSS px of the page), in order of
 * preference; the caller takes the first one with no plate under it.
 *
 *   parkCandidates({ view: [innerWidth, innerHeight], top: <the stage's top, CSS px>, screen: [W, H] device px, at: [x, y] device px of the page's top-left on the screen, dpr })
 *
 * visible = the part of the page inside the screen: floor((screen - at) / dpr) per axis, at most the view. A candidate is kept only when 0 <= x < visible width and
 * 0 <= y < visible height. `parkVisible` is the same test, for a driver's own assert. Tested by scripts/test-pencil-park.js.
 */
function visibleOf({ view, screen, at, dpr }) {
  return [Math.max(0, Math.min(view[0], Math.floor((screen[0] - at[0]) / dpr))), Math.max(0, Math.min(view[1], Math.floor((screen[1] - at[1]) / dpr)))];
}
function parkVisible(p, o) { const v = visibleOf(o); return p.x >= 0 && p.y >= 0 && p.x < v[0] && p.y < v[1]; }
function parkCandidates(o) {
  const v = visibleOf(o), top = Math.max(1, Math.floor(o.top / 2)); /* half way up the bar above the stage: no desk, monitor, table or plate is there (the driver checks the element chain too) */
  const all = [[Math.round(v[0] / 2), top], [1, 1], [v[0] - 2, 1]].map(([x, y]) => ({ x, y }));
  return all.filter((p) => parkVisible(p, o));
}
/* true when the window's content is not whole inside the screen (device px, on either axis): the real pointer cannot be trusted to leave the plates there (Linux/Xvfb 1280x1024 under a 2880x1800 window at DPR 2) */
function windowOutsideScreen({ win, screen, at }) { return at[0] < 0 || at[1] < 0 || at[0] + win[0] > screen[0] || at[1] + win[1] > screen[1]; }
/* a window that fits the screen when the screen is smaller than the window: the screen in CSS px less a margin for the window's frame and place (48 across, 110 down: a title bar,
   a task bar), at most the window asked for; null when that is under 800x520 (too small for the office's 15 desks to be a layout worth testing) */
function fitWindow({ win, screen, dpr }) {
  const w = Math.min(win[0], Math.floor(screen[0] / dpr) - 48), h = Math.min(win[1], Math.floor(screen[1] / dpr) - 110);
  return w >= 800 && h >= 520 ? [w, h] : null;
}
module.exports = { fitWindow, visibleOf, parkVisible, parkCandidates, windowOutsideScreen };

# Implementation Plan: Floors as places

**Branch**: spec on `033-floors-as-places`; code on `092-pN-slug` branches, one per phase | **Date**: 2026-10-27 | **Spec**: [spec.md](spec.md)

## Summary

Make every floor that is on one whole screen of a vertical building. A lift panel (one button per floor on, attention badges) and PageUp/PageDown move between floors with a calm 300 ms slide (instant with reduced motion); opening an agent from the inbox, a notification or the navigator moves the office to its floor. Renderer-only: floors, their saved data and IPC (spec 033) are reused as they are; the current floor is a display preference in `localStorage`.

## Technical Context

**Language/Version**: TypeScript (main, shared) and plain-script JavaScript (renderer, no modules; pure helpers use the `places.js` UMD pattern so Node tests can `require` them). No new dependency.
**Storage**: `localStorage` only (current floor id `durbar.floor`; the view `durbar.floorView`, FR-037). No change to `folders.json`, `src/shared/floors.ts`, IPC or preload.
**Testing**: `scripts/test-floornav.ts` (pure rules, new), simulator driver `scripts/shots-092.js` (new, theme-neutral, waits with `until()`), `check:office` extended (`scripts/check-office-overlap.js`), existing `test-floors.ts` / `test-navigator.ts` stay green. 0 AI credits; simulator `DURBAR_SIM=15 DURBAR_SIM_FLOORS=1`.
**Target Platform**: Electron on Windows, macOS, Linux (renderer-only, no path or shell code).
**Performance Goals**: a floor change within 033 SC-003's budget plus the slide (spec SC-003); rendering only the current floor (and the target during a slide) keeps the layout cost of N floors at the cost of one.
**Constraints**: constitution V (10.5 px text, 15 agents per floor at 1440x900 and 1280x800, no overlap, no office scroll), I and III untouched, VII.3 pure logic tested, VIII honest limits.

## Constitution Check

- I (spec first): this spec, plan and tasks are committed before any `src/` change; each phase PR changes `specs/092-*`.
- II (adapters): nothing agent-specific; attention comes from the normalized status the pills and inbox already use.
- III (safe, no secrets): no new IPC, file, process or stored data beyond one floor id in `localStorage`.
- IV (no credits): simulator and unit tests only.
- V (calm UI): 300 ms slide, `transform`/`opacity` only, reduced motion honoured live, lift text at least 10.5 px; the width cost is measured before merge (FR-008).
- VI (platforms): PageUp/PageDown exist everywhere; Mac laptop keys noted in the help.
- VII (gates): pure rules in `floornav.js` with a Node test; `check:office` per floor.
- VIII (honest limits): the spec's known gaps are carried into the README.

## Code paths reused (do not add parallel versions)

| Need | Existing code (file:line, 2026-10-27 on main) |
|---|---|
| Floors state, on/off, order | `FLOORS`, `floorById`, `floorOn`, `floorsOnList`, `roomsInOrder`, `roomShown` (`src/renderer/app.js`); `applyFloors`/`afterFloorsChange` |
| One floor's agents for the office | `officeModel()` (called at filtered by `roomShown`); add a "current floor" filter there |
| Density per set of agents | `chooseLayout(sizing, aw, ah)`, `layoutKey` (includes the floor list; add the current floor id) |
| Floor name in a header | `floorTag` kept (FR-005) |
| Lobby and visitors | `lobbyOn`, `lobbyPlaces`, `placeVisitors` in `src/renderer/places.js` (filter by `roomShown`; no filter by current floor) |
| Attention sources | `needsMe()` and `needsMeOrder()` (used by `openInbox`; the order reads `#stage` desks and appends the other agents, so with one floor mounted the badge counts must come from `agents`, not from the DOM), `UNREAD_AT`, `offFloorAttention` as the model for text, status of the coffee-break state (spec 068) |
| Open an agent | `openPanel(id,focus)`; inbox buttons; notification `onclick`; navigator actions in `src/renderer/navigator.js` |
| View transition (ruled out) | `swapView(fn, instant)` (spec 052 FR-070, theme cross-fade): not used for the slide, reasons in spec FR-030 (whole-page snapshot, no retarget, all-or-nothing swap); its reduced-motion fallback idea is reused through `reducedMotion()` |
| Announce, motion | `announce()`, `reducedMotion()`, `motion(el, frames, opts)` |
| Keyboard help table | the `kbdHelp` rows near `app.js` |
| Menus/tooltips/tokens | shared tokens in `src/renderer/themes.css`; `test:theme` bans literal sizes |

Not found (so new): a notion of a current floor, a lift panel, any per-floor layout, and a floor-change keyboard handler.

## Project Structure

```text
specs/092-floors-as-places/   spec.md, plan.md, tasks.md
src/renderer/floornav.js      NEW, pure: current-floor rules, badges, key eligibility, announcement text
src/renderer/app.js           current floor state, officeModel filter, layoutKey, lift panel render, keys, goToFloor, slide
src/renderer/styles.css       .lift panel, badge, slide container (tokens only); themes.css untouched unless a token is needed
src/renderer/navigator.js     floor row activates goToFloor (FR-019)
src/renderer/index.html       script tag for floornav.js; lift host element
scripts/test-floornav.ts      NEW
scripts/shots-092.js          NEW driver
scripts/check-office-overlap.js  floor-screen cases
docs/ README.md changelog.d/  see FR-026
```

## Phases (each one PR; each leaves the app working and the single-floor user unchanged)

Order is chosen so the riskiest part (layout per floor and its width budget) lands first and every later phase is small.

1. **Phase 1, floor screens (FR-001..FR-005, FR-020..FR-023, FR-025 partly).** Pure `floornav.js` + test; current floor state with persistence; `officeModel()` and `layoutKey` use the current floor; lobby visitors of all floors with the no-walk rule; PageUp/PageDown (instant, announced) as the first way to change floor; fallbacks when the current floor goes off. `check:office` per floor. No lift panel yet, so the feature is usable by keyboard only and invisible with one floor on.
2. **Phase 2, the lift panel, badges and the All floors view (FR-006..FR-008, FR-013..FR-017, FR-028, FR-031..FR-037; owner 2026-10-28).** Panel markup and styles, roving focus, accessible names, attention badges from the existing sources, whole-building pills unchanged, width counted in the layout, `check:office` with the panel at both sizes. Instant switching still (meets FR-010; the slide stays phase 3). The *All* button and the All floors view: a view preference `durbar.floorView` next to `durbar.floor`; in the All view `curFloorId()` returns `null`, so `onScreen`, `otherFloor`, `officeModel()`, `chooseLayout()` and the floor tags take the **pre-092 path unchanged** (no second render path); `floorScreens()` keeps meaning "two or more floors on" for the lift, and a new `oneFloorView()` (= `floorScreens()` and not All) gates the per-floor behaviour (FR-001 filter, empty-floor line, PageUp/PageDown floor change, badges, FR-021 labels). `check:office` gains All-floors cases (FR-033).
3. **Phase 3, the slide (FR-009, FR-010).** Two-floor mount during the slide, `motion()` at 300 ms, retarget, end-on-resize, reduced motion read live, SC-003 timing as a ratio.
4. **Phase 4, jumps (FR-018, FR-019, FR-011 help text).** `goToFloor()` called by `openPanel`, the navigator, the folder filter and the list; Back to the office shows the right floor; navigator floor row; keyboard help rows.
5. **Phase 5, docs and screenshots (FR-026).** README, docs, `npm run shots:docs`, changelog fragment, 033 cross-reference, converge.

## Risks to check in review

- All floors view (FR-031..FR-037): every phase-1 call site of `floorScreens()` must be checked for whether it means "the lift is shown" (two or more floors on) or "one floor is shown" (`oneFloorView()`); a missed one gives a floor-only behaviour in the whole-building view (for example the "Nothing on <floor>" line, a visitor label naming a floor, a badge). `grep -n floorScreens src/renderer/app.js` and a driver case per behaviour (T047).
- The All floors density at 1280x800 with the panel (FR-033): if `check:office` fails, phase 2 does not merge; the numbers go to the owner.

- Width of the lift panel against the 15-agent rule at 1280x800 (FR-008); Q-B decided (position number only, owner 2026-10-27).
- Focus handling: PageUp/PageDown must never act inside text fields, selects, dialogs, menus, the palette or the composer.
- Stale layout cache: `layoutKey` must include the current floor (a cached layout of floor A must not be used for floor B).
- Walkers and lobby visitors across a floor change (FR-021); the walker layer uses `#floor` coordinates (`app.js`).
- `REDUCED` is read once at `app.js`; the slide must use `reducedMotion()` (live).
- Notification and inbox paths must not gain a new sound or toast (FR-015).

## Complexity Tracking

None beyond the new file `floornav.js`; no new IPC or storage.

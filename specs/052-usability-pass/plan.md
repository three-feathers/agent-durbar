# Implementation Plan: Usability pass from persona reviews

**Branch**: `052-usability-pass` | **Spec**: [spec.md](spec.md)

## Technical context

The renderer only: `src/renderer/app.js`, `screens.js`, `index.html`, `styles.css` and `theme.js` tokens. No main, adapter or IPC change. Plain JS and CSS, as everywhere.

## Constitution check

- **I:** spec, plan and tasks come before the code.
- **II:** no adapter types reach the renderer; the answer bar reuses the existing normalized approval and question events and handlers.
- **III:** the permission wording gets clearer, but the behaviour is unchanged; nothing is approved without a click.
- **IV:** simulator only.
- **V:** text of at least 10.5px; sizes unchanged in the office (`check:office` and `check:geometry`).
- **VI:** no platform code.
- **VIII:** the reviews were AI personas, said so in the spec and PR; no real user study.

## Design notes

- **Answer bar:**
  - built from the agent's pending request (the same data the in-chat card renders);
  - its buttons call the same functions;
  - it re-renders on the agent's state events.
- **More menu:** a `div[role=menu]` holding the existing buttons as `role=menuitem` (ids kept), opened by `#moreBtn` (`aria-haspopup`, `aria-expanded`), with keyboard handling in one small helper.
- **Toast:**
  - `toast()` pauses on hover and focus;
  - the restore message uses `toastAction` with no timer;
  - `#toasts` gets `pointer-events:auto` on the toast only.
- **List header:** find the source of the slant (layout, not a transform) and fix it.
- **Tokens:** `--muted` and `--focus` in `CLEAN_TOKENS` and the `:root` fallbacks. Themes that set their own value keep it; the AI theme maker's contrast checks already cover `--muted`.

## Testing

- Unit: the room-dot text alternative and the "next that needs you" order, as pure functions where possible.
- Simulator driver `scripts/shots-052-ux.js` at both sizes: the answer bar visible without scrolling, at most 3 header buttons, the More menu by keyboard, the banner closes, the list header straight, and N moves to the next waiting agent.
- `check:office` and `check:geometry`.

## Round 6 (2026-10-20): activity log

- New main-side store `src/main/activitystore.ts` (same pattern as `usagetotalsstore.ts`: injected file path, debounced atomic write) with pure row rules in `src/shared/activity.ts` (sanitise, cap, CSV/JSON, decision from a permission answer).
- Rows are recorded in `main.ts` from `router.onEvent` (`permission` events) and through an optional `log` hook in `OpsDeps` (`setModeOp`, `setCapOp`), so the window cannot write rows. The permission broker emits a new `auto` event in Allow all, forwarded by each adapter as `permission` with `via: 'policy'`; the renderer ignores those.
- Renderer: `activitytable.js` (pure HTML builder, `window.DurbarActivity`) and an Activity tab in `screens.js`; the simulator keeps its own in-memory rows.
- Testing: `scripts/test-activity.ts` (registered as `test:activity`).

## Round 8 (2026-10-20): macOS conventions

- Main: `src/main/appmenu.ts` (pure, Electron types only): `appMenuTemplate(platform, actions)` (role-based Mac menu, `null` elsewhere), `hideOnClose`, `disposeOnQuit`, `windowChrome`; `shouldBounce` in `badge.ts`. `main.ts` wires them: `Menu.setApplicationMenu` after `whenReady`, the window's `close` / full-screen events, `activate`, and one `before-quit` handler that releases remote control and then (macOS) ends the agents, each capped at 3 s.
- No new invoke handler: the menu and full-screen signals are main-to-page events (`menu:settings`, `window:fullScreen`); the preload adds `onMenuSettings`, `onFullScreen` and `platform`.
- Renderer: `keys.js` (pure, `window.DurbarKeys`) for the modifier checks and the key labels; `app.js` uses it for the key handler, the shortcut sheet, the palette, titles and `aria-keyshortcuts`. Mac-only CSS sits under `html[data-platform="darwin"]`, set only from the preload's `platform`, so Linux geometry checks are unaffected.
- Testing: `scripts/test-macos.ts` (registered as `test:macos`).

## New session in the chat header (2026-10-20, FR-139)
- `app.js` `showPanel` header: a `#newSessHdrBtn` `.btn.sm` after `#prevBtn` in `.actions`, wired to `newSession(a)` beside the `#newSessBtn` handler. `styles.css`: only a rule for the button (28px control height from `.ph`); the darwin title-bar block (#358) is not touched.
- Third visible action is an owner exception to round 10's two; the More item stays so no route is lost.

## FR-138 (2026-10-20): macOS title bar on every screen

- Renderer CSS only, all under `html[data-platform="darwin"]` (`styles.css`, next to the FR-085 block; `screens.css` is not touched). Notice strips precede `.workspace` and `#screen` in the DOM, so the "a strip is visible above" cases use the sibling combinator (`.notice-strip:not([hidden]) ~ .workspace .strip`, `~ #screen .scr-head`), not `:has()`.
- Electron builds the drag area from the `app-region` of every element and ignores z-order, so an overlay is made `no-drag` itself (a fixed `inset:0` backdrop covers the whole window).
- Testing: `test-macos` reads the CSS; `scripts/check-mac-titlebar.js` is an Electron driver (simulator, `data-platform` forced) that computes drag minus no-drag like Electron. Run one Electron at a time (`xvfb-run` on Linux).

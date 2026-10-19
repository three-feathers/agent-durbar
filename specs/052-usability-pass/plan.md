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

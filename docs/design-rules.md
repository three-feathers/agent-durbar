# Design rules

Ten house rules for the Agent Durbar window (plain HTML, CSS and JS in `src/renderer`). They came from a design-systems audit in the usability pass (spec 052, round 7, FR-076..FR-079). Follow them in new UI and when you touch old UI; a theme changes only colours, borders, art and words, never these rules.

1. Controls are `--h-ctl` (32px) or `.btn.sm` (28px). No other heights. (Compact makes `--h-ctl` 28px in the chrome only.)
2. Only radius tokens `--r-sm` / `--r-md` / `--r-lg` / `--r-xl`; pills are `999px`. No raw px.
3. No hex colours in component rules; use theme tokens (`--surface-2`, `--raised`, `--line-ctl`).
4. One primary button per view, last in the row; `.btn.danger` deletes or ends, `.primary.warn` grants power.
5. Sentence case everywhere; "and", not "&".
6. "…" (one character) only when the next step asks for input; never on confirmations.
7. One word per status (Working, Thinking, Waiting, Idle, Error, Done, Failing, Limit reached) on every screen.
8. Dialogs: a command title (only confirmations ask), body, `.dbtn` with Cancel before the primary; screens close at top right.
9. States: hover is `--surface-2`, disabled is muted and dashed, focus is the global `:focus-visible` only.
10. Expand arrows use the shared SVG chevron (rotates 90°); badges and chips never wrap.

## Notes on the rules

- **Heights.** The two exceptions that exist on purpose: the copy buttons that sit on top of content (`.cp-btn`, and `.md .copy` at the same size) are 22px; controls inside desk cards and room headers keep their sizes, because the office layout is checked to the pixel.
- **Chips.** A chip you can click, or one that shows a state (model, mode, limit, context, grants), is a pill. A chip that shows code or a path (the chat header's folder, tool calls, MCP secrets) uses `--r-sm`. Chips say what they are ("Model: Auto", "Limit: none") and are never italic.
- **Destructive and powerful.** Red (`.btn.danger`, and `.btn.primary.danger` in a confirmation): End session, Remove from office, Remove folder, Delete floor, Clear activity, Reset counts. Amber (`.btn.primary.warn`): Allow all, Turn on remote control, Trust and enable an MCP server. A red or amber confirmation starts with focus on Cancel (`src/renderer/dialog.js`).
- **Text fields in dialogs:** `height: var(--h-ctl)`, `border-radius: var(--r-md)`, `background: var(--raised)`, proportional type. Monospace only for code (commands, the summary editor). Links are `.linkbtn` (token colour), never the browser's blue.
- **Status words.** Longer phrases such as "Waiting for you" may stay in sentences (a task line, a hint), not in pills, labels, counters or the palette. Lifecycle words that are not statuses (Paused, Not started, Starting, Ended) stay as they are. The Durbar MCP server reports the same words (spec 041 FR-011 mirrors the office).
- **Spacing.** Panels and dialogs use `--r-xl`; cards inside them `--r-lg`; Settings sections are 12px apart (`--sec-gap`, round 10).
- **Reading load.** Body text in the `--measure` (560px, about 72 characters of 13px; see "Help text, widths and tooltips"), line height 1.45 to 1.5, no italics for long text (the Thinking block uses a left rule and the muted colour), one short line per menu item with the full explanation in its tooltip.

## Type, spacing and density (round 10, FR-098, FR-099)

The chrome (chat, screens, dialogs, inbox, menus) uses one type scale and one spacing scale, as custom properties in `styles.css`. Desk cards, rooms, room headers, the lobby, the top bar, the list and the Tools tables keep their own sizes.

| Token | Size / weight / line height | Use |
| --- | --- | --- |
| `--t1-*` | 16 / 650 / 1.25 | screen, dialog and chat titles |
| `--t2-*` | 14 / 650 / 1.3 | section titles, inbox headings |
| `--t3-*` | 13 / 400 / 1.5 | body, bubbles, composer, notes, buttons (the body default) |
| `--t4-*` | 12 / 500 / 1.4 | chips, segments, selects, table cells, metadata, `.btn.sm` |
| `--t5-*` | 11 / 500 / 1.35 | hints, pills, counts |

- **No other font sizes** in new chrome rules (no 11.5, 12.5, 13.5, 15 or 17). 10.5px stays the floor, for tags only.
- **Spacing:** `--s-1`..`--s-5` = 4 / 8 / 12 / 16 / 24px for paddings and gaps. No 5, 6, 7, 9, 10, 14 or 18px in new chrome rules.
- **The body is 13px (T3).** `.topbar`, `#stage-host` (the office) and `#list` set 14px, the size they always inherited, so the office measures as before. A new office element sets its own size; it never relies on the body.
- **Density tokens:** `--sec-pad` (Settings sections, 12px 16px), `--sec-gap` (12px), `--dlg-pad` (dialogs, 16px 24px), `--dlg-gap` (12px), `--row-pad` (inbox rows, 8px 12px). Use them instead of literals so Compact can change them.
- **Compact** (Settings > Detail level > Spacing) sets `html[data-density="compact"]`: the density tokens get smaller (10px 14px, 10px, 14px 16px, 8px) and `--h-ctl` / `--h-chip` / `--h-pill` become 28 / 22 / 20px, but only inside `#panel`, `#screen`, dialogs and menus. Never override them on `:root` or the top bar: the top bar, desk cards, rooms and the lobby do not change with density.
- **The chat header** uses one control height: chips and `.btn.sm` buttons are both 28px (`.ph{--h-chip:28px}`), on one row with the actions pinned right.

## Help text, widths and tooltips (spec 052 FR-165..FR-171, issue #464)

- **Wrapping.** Prose (dialog bodies, notes, "More" text, menu hints, notices, toasts, the shortcut sheet) uses `overflow-wrap: break-word` and `word-break: normal`: a word moves whole to the next line, and only a word longer than its line breaks. Never `overflow-wrap: anywhere`, `word-break: break-all` or `hyphens: auto` on prose. They stay only on machine text: `code`, `pre`, `kbd`, paths, URLs, commands and diffs. Keep a hyphenated example in quotes on one line (`white-space: nowrap`). `anywhere` also shrinks a box's minimum width to one letter in a flex or grid parent, which is how words end up cut.
- **Measure.** Help text is `max-width: var(--measure)` (560px), whatever its own font size, so a "More" paragraph ends where the line above it does.
- **Size of help text.** A paragraph of more than one line is T4 (12px) at least; T5 (11px) only for a one-line hint, a count or a tag. A `small` in the chrome always gets an explicit size: the browser's own `smaller` gives 10px, under the 10.5px floor.
- **Dialog widths.** Three tokens, each `min(W, 100vw - 32px)` with `max-height: calc(100vh - 48px)`: **S** `--dlg-w-s` 420px (a confirmation: title, at most 5 lines of body, buttons; the default), **M** `--dlg-w-m` 560px (a form, a list of choices, or a body over 5 lines at S), **L** `--dlg-w-l` 760px (two columns or a table: the shortcut sheet, Needs you, the import list, the hand-off review). Pick with `askDialog({size:'m'|'l'})`, `dialog({size})` in `screens.js`, or the class `.dlg.m` / `.dlg.l` (`.wide` and `.imp` are older names for M and L). No other dialog width.
- **Dialog inside.** Padding is `--dlg-pad`, groups of fields are `--dlg-gap` apart, a label and its control 4px. A dialog body scrolls vertically only: nothing is wider than its box; a row cuts its label with an ellipsis and a `title`. What is typed or chosen in a field is regular weight (400), also the placeholder; a bold label does not pass its weight on.
- **Popovers** share two width tokens and one padding (issue #508): **S** `--pop-w-s` 420px (Defaults, the Allowed grants list) and **M** `--pop-w-m` 660px (Folders, Floors: rows with several buttons), each `min(W, 100vw - 32px)`, and `--pop-pad` 12px 14px. No popover sets its own width or padding; a name or path in a popover that ends in an ellipsis keeps at least 120px (`popover-squeezed`); long content wraps or ends in an ellipsis with a `title`, never scrolls sideways. The Floors help sits on its own line under the title. **Menus** (the top and chat More menus, the mode, folder, session and model menus, and the composer's "/" list, spec 073) share one width token, `--menu-w` (320px), and padding (6px). A hint under a menu item is one line or two even lines (`text-wrap: balance`, never a last line of one word), and a menu has a hint on every item or on none (chat More: all; the `title` keeps the longer explanation).
- **Tooltips.** A static tooltip that explains a control is at most **120 characters**; longer help goes on screen (a hint line or the section's "More"). A data tooltip (the full text of a cut name, path or task, or a breakdown of totals) is at most **300 characters or 8 short lines**. Every ellipsis has its full text in a `title` or beside it. No help lives only in a tooltip on something that is not focusable. The check reads every visible `title`: static over 120 fails, data (cards, totals, cut names, tool chips; the list is `DATA_TIP` in `scripts/ui-text-page.js`) over 300 characters or 8 lines fails. Cut a dynamic text with `DurbarCutText.cutText(text, n)`.
- **Dark themes.** A control or surface that carries text uses theme tokens (`--raised`, `--surface`, `--tint-sage`, `--warn-bg`, `--bad-bg`, `--card-error`), never a literal light colour: with a dark user theme its text must read at 4.5:1. The tone tokens in `styles.css` `:root` (`--tone-info|warn|bad|ok|idea|neutral-*`: `-bg`, `-soft`, `-faint`, `-line`, `-hover`, `-ink`) are made of the theme's own `--pb-X` / `--pc-X` status pairs (4.5:1 in every theme) and replace the old literal chip, note and code backgrounds; use them for a tinted surface and its text. The switch knob stays white (no text); `check-ui-text` fails any other literal light `background` (hex, named, rgb/hsl, gradient, in every renderer stylesheet) and reads the contrast of the moved rules in all built-in themes and the dark fixture. There is no allow-list (neither for light backgrounds nor for text under 4.5:1 in the dark fixture). A button on `--sage-ink` or `--red-ink` uses `var(--surface)` for its text, not `#fff`.
- **The check.** `npm run check:ui -- --only check-ui-text` (`scripts/check-ui-text.js`, in `npm run check:ui`) opens the dialogs, popovers, menus, screens and chat parts in the simulator at 1440x900 and 1280x800, in Clean Office and a dark fixture theme (`scripts/fixtures/themes/dark-audit.json`), and asserts the rules above. Run it for any change to wording or to a dialog.

## How to check

- Minimum text size is **10.5px**, everywhere, in every theme.
- 15 agents must fit at 1440x900 and 1280x800 without overlap or scrolling the office. Do not change the size of desk cards, rooms, room headers or the lobby.
- The top bar is **one row of 48px** (spec 052 FR-105, round 11): brand, **+ Folder** and **+ Workspace** (spec 052 FR-164; the **+ New** menu is gone), Defaults chip, Floors, folder filter with Manage folders, Tools and Settings, Office / List, ⋯, then **Schedules** (a clock and the count of active schedules; spec 044 FR-027, issue #523), Needs you and the counters on the right. It must stay on one row at 1280px wide with floors and several agent apps, measured in DejaVu Sans (CI's font). A new control goes into an existing menu (⋯, or the File menu on a Mac) or popover (Defaults), not onto the row; if one must be added, make room with the width rules in `styles.css` (counters as dot and number, Needs you as icon and number, the chip's cap) and re-measure. Measured with Schedules (DejaVu Sans, floors, mixed agent apps, six themes; spec 044 FR-034): the folder filter is narrowed only by `fitTopbar()` when the row would wrap (less padding, then the value "All"; a select has no ellipsis, so never a fixed width that cuts the text), the gaps of the control groups 4px and the bar's column gap 8px (the Mac title-bar room keeps its 78px); the Schedules button is 48px (46px below 1440px). Free width: 1440x900 Expert 16px or more with the brand name shown, 1280x800 Expert 10px (`tb-tight`), Simple 11px or more. The Mac room at 1280x800 Expert stays a known gap. Themes only recolour it.
- Room walls, lobby places and helper connectors are 1px (FR-106).
- `npm run check:geometry` (Retro lays out like Clean Office; `CHECK_ALL_THEMES=1` checks every theme, nightly CI does) and `npm run check:office` (no overlap at both sizes) guard those sizes; run them for any change to the office or the top bar.
- `npm run typecheck && npm run build && npm test` before every pull request.
- For UI changes, take screenshots with the simulator (`DURBAR_SIM=15 npm start`) at 1440x900 and 1280x800, as `AGENTS.md` describes.
- The drivers in `scripts/shots-*.js` assert labels and status words; when you change a label, grep them and update the ones that match.

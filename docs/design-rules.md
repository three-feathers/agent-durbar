# Design rules

Ten house rules for the Agent Durbar window (plain HTML, CSS and JS in `src/renderer`). They came from a design-systems audit in the usability pass (spec 052, round 7, FR-076..FR-079). Follow them in new UI and when you touch old UI; a theme changes only colours, borders, art and words, never these rules.

1. Controls are `--h-ctl` (32px) or `.btn.sm` (28px). No other heights.
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
- **Spacing.** Panels and dialogs use `--r-xl`; cards inside them `--r-lg`; Settings sections are 16px apart.
- **Reading load.** Body text in a measure of about 70ch, line height 1.45 to 1.5, no italics for long text (the Thinking block uses a left rule and the muted colour), one short line per menu item with the full explanation in its tooltip.

## How to check

- Minimum text size is **10.5px**, everywhere, in every theme.
- 15 agents must fit at 1440x900 and 1280x800 without overlap or scrolling the office. Do not change the size of desk cards, rooms, room headers, the top bar or the lobby.
- `npm run check:geometry` (every theme lays out like Clean Office) and `npm run check:office` (no overlap at both sizes) guard those sizes; run them for any change to the office or the top bar.
- `npm run typecheck && npm run build && npm test` before every pull request.
- For UI changes, take screenshots with the simulator (`DURBAR_SIM=15 npm start`) at 1440x900 and 1280x800, as `AGENTS.md` describes.
- The drivers in `scripts/shots-*.js` assert labels and status words; when you change a label, grep them and update the ones that match.

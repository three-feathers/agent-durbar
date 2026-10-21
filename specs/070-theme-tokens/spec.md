# Feature Specification: Full theme tokens (fonts, shapes, figures and gadgets)

**Feature Branch**: `070-theme-tokens`
**Created**: 2026-10-21
**Status**: Phase 1 built (typed tokens, fonts, radii, shadows, figure palettes, gadget slots, validator, guard, AI maker); Phase 2 (moving the remaining literal colours of the CSS onto tokens) in progress, tracked by the guard's ratchet.
**Input**: Owner (Vikram, Telegram, 2026-10-21 21:19 UTC): "I want real tokenization and full support for total customization of the theme, including fonts, …". Follows spec 040 FR-023 (the characters and gadgets of a picked theme now show everywhere).

## Summary

A theme pack today can set 147 colour tokens, name one UI style and one scene kit, rename scene words and draw small SVG art. Everything else that makes a look (the fonts, the roundness of cards and buttons, the depth of shadows, the clothes and hair of the people, the cup and laptop on the desk) is fixed by the app, and about 450 colour literals in the renderer's CSS bypass the tokens. This feature makes the visual properties a theme may change **named, typed tokens** with Clean Office defaults, checks every value by type, and extends the AI theme maker to fill them. What a theme may never change stays fixed and is listed here, with the reason.

## Clarifications (decisions with defaults; the owner may change any of them)

- **D1 Fonts: system fonts only, from an allow-list (default).** A pack names font stacks for three roles: `--font` (body text), `--ui-display` (screen and dialog titles, door plates) and `--font-mono` (paths, code). Each stack is up to 8 family names from a fixed allow-list of fonts that ship with Windows, macOS or common Linux desktops, or the generic families (`system-ui`, `sans-serif`, `serif`, `monospace`, `ui-monospace`, `ui-serif`, `ui-rounded`); the app always appends the role's generic fallback. **No remote URL is ever fetched, and font files inside a pack are not loaded** in this phase (a pack may carry at most 8 files, and only `manifest.json` is read). Reason: a font file is a binary parser attack surface and a remote font is a network request from a theme; neither is needed for the looks asked for so far. Bundled font files (`.woff2` read from the pack folder, size-capped, through `FontFace` from bytes) are a possible later phase: `[KNOWN GAP]`.
- **D2 Sizes and spacing stay fixed.** Font sizes, line heights, paddings, gaps, border widths, control heights and the density are not themeable: they decide the office layout, and the rule that 15 agents fit on 1440x900 and 1280x800 with text at least 10.5px (constitution V) is proven once in Clean Office and then by `check:geometry` showing that every theme lays out the same (spec 035 FR-010). Font **weight** for titles is themeable within 500-800. A body font with other widths is checked by the geometry check's real-font pass.
- **D3 Skin tones stay the app's.** A theme may give the people new clothes (shirt palette) and hair colours; skin tones always come from the app's own varied set, so no theme can make every person one skin tone. Hair styles and glasses stay per agent.
- **D4 Contrast is enforced, per pair.** Text pairs (the WCAG AA pairs of spec 040 FR-017, 4.5:1; 3:1 for large or non-text marks) are checked when a pack is loaded, not only when the AI makes it. A pair that fails falls back **as a pair** to Clean Office's two values, and Settings says so on the theme's card.
- **D5 Unusable values fall back per token**, never the whole pack: an unknown key or a value of the wrong type is dropped (Clean Office's value is used), and the count is shown on the theme's card in Settings and in the AI dialog ("3 values were not usable and use the defaults").
- **D6 Hostile values still refuse the pack.** Markup or CSS syntax in a value (spec 040 FR-006) is a sign of a crafted pack, so such a pack is not imported at all (FR-020).

## User Scenarios & Testing

### Story 1 - A theme with its own fonts and shapes (P1)
A user imports (or the AI makes) a pack that sets a rounded display font, softer corners and deeper card shadows. After picking it, room plates, dialog titles and the brand use the display font, cards and buttons use the new radii and shadows, and the layout is exactly the same as in Clean Office.

**Acceptance**: `check:geometry` passes with the pack; the computed `font-family`, `border-radius` and `box-shadow` of a card, a button and a dialog title are the pack's.

### Story 2 - People and gadgets that fit the look (P1)
The pack gives a shirt palette (pinks), hair colours and its own cup and laptop drawings. Every desk, helper tile, walker and chip draws people in the pack's clothes, and an idle desk shows the pack's cup.

**Acceptance**: `check:theme-art` (spec 040 FR-023) with the sample pack asserts the shirt colours on desks, walkers and chips and the gadget slots on desks.

### Story 3 - Bad values do not break the look (P2)
A pack with a script in an SVG, a remote font URL, a 2px font size, a 40px radius and unreadable text colours still loads: each bad value uses the default, the failing text pair falls back as a pair, and the card says how many values fell back.

## Requirements

### Token registry
- **FR-001** `[IMPLEMENTED]` One registry lists every themeable token with its **type** and Clean Office default: `color` (the 147 existing tokens), `font` (`--font`, `--ui-display`, `--font-mono`), `weight` (`--title-weight`), `radius` (`--r-sm`, `--r-md`, `--r-lg`, `--r-xl`, `--radius`), `shadow` (`--shadow-card`, `--shadow-pop`). It is the single source for the renderer (`theme.js`), the import check in main (`src/shared/themes.ts`) and the AI maker (`src/shared/themegen.ts`).
- **FR-002** `[IMPLEMENTED]` Type grammars (anything else is dropped, D5):
  - `color`: hex (`#rgb`, `#rrggbb`, `#rrggbbaa`), `rgb()/rgba()/hsl()/hsla()` with numbers only, or `transparent`;
  - `font`: 1-4 comma-separated names from the allow-list (FR-003), quoted or not; no `url(`, no `@`, no `;`; at most 120 characters;
  - `weight`: an integer 500-800 in steps of 50;
  - `radius`: `0`-`24px`;
  - `shadow`: `none`, or 1-2 comma-separated layers `[inset] <x> <y> <blur> [<spread>] <color>` with offsets -40px..40px, blur 0..64px, spread -24px..24px and a `color` value;
  - every value at most 120 characters, no quotes other than in font names, no `<`, `>`, `{`, `}`, `;`, `\`, `url(`, `var(`, `expression(`.
- **FR-003** `[IMPLEMENTED]` The font allow-list (D1) is a fixed list in `src/shared/themetokens.ts`, for example `Segoe UI`, `Helvetica Neue`, `Arial`, `Verdana`, `Tahoma`, `Trebuchet MS`, `Georgia`, `Palatino Linotype`, `Palatino`, `Book Antiqua`, `Times New Roman`, `Garamond`, `Baskerville`, `Cambria`, `Calibri`, `Candara`, `Corbel`, `Gill Sans`, `Optima`, `Futura`, `Avenir`, `Avenir Next`, `Didot`, `American Typewriter`, `Courier New`, `Consolas`, `Menlo`, `Monaco`, `SF Mono`, `Cascadia Mono`, `Roboto`, `Noto Sans`, `Noto Serif`, `DejaVu Sans`, `DejaVu Serif`, `DejaVu Sans Mono`, `Liberation Sans`, `Liberation Serif`, `Ubuntu`, `Cantarell`, `Comic Neue`, `Hiragino Mincho ProN`, `Yu Mincho`, `Noto Serif CJK JP`, the generic families of D1. The app appends the role's fallback (`sans-serif`, `serif` or `monospace` as the default stack ends), so a missing font degrades to a system one.
- **FR-004** `[IMPLEMENTED]` The manifest cap on tokens rises from 160 to 200 (every registered token fits).
- **FR-005** `[IMPLEMENTED]` A pack that sets `--ui-display` gets it on the screen and dialog titles and the door plates in every UI style, Clean included (`html[data-display]`, set by `theme.js`); without it the UI style decides, as before.

### Figures and gadgets
- **FR-010** `[IMPLEMENTED]` A manifest may have `figures: { shirts: [color x 1..8], hairs: [color x 1..8] }`. An agent's look keeps its own index into the app's palettes; with a theme palette its shirt is `shirts[i % n]` and its hair `hairs[j % n]` (the index is found from the agent's own colour in the app palette, so the same agent keeps the same slot across themes). Skins never change (D3). The figure is drawn with these colours on desks, helper tiles, walkers and chips, in every scene kit.
- **FR-011** `[IMPLEMENTED]` New art slots `gadget-cup` (the idle cup, replaces the app's drawing; area x 96-114, y 66-87 of the 200x124 stage) and `gadget-laptop` (the laptop on the desk, replaces it; area x 55-99, y 79-88). Same sanitizer as every slot (spec 040 FR-005: rebuilt from a tag and attribute allow-list, no text, no scripts, no `foreignObject`, no `image`, no `href`, no external `url()`), at most 24,000 characters per slot (a compiled pixel map of a built-in pack reaches about 17,000). Drawn in every scene kit; the steam over an idle cup stays (it is a status cue).

### Validation, fallbacks, contrast
- **FR-020** `[IMPLEMENTED]` Two levels. A value that looks **hostile** (markup or CSS syntax: `<`, `>`, `{`, `}`, `;`, `\`, `@`, `url(`, `expression(`, `var(`, or a key that is not `--name`) still refuses the whole pack at import, as since spec 040 FR-006: a crafted pack is not installed. A value that is only **unusable** (a known token with a value of the wrong type or out of range, a font not on the allow-list, an unknown `--name`) is dropped on its own and Clean Office's value is used (D5); `checkUserManifest` returns the dropped keys (`dropped`), and the renderer drops the same ones.
- **FR-021** `[IMPLEMENTED]` After the type check, the text pairs of spec 040 FR-017 (`CONTRAST_PAIRS`) are checked on the resolved tokens of a **user** theme (imported or made with AI); a failing pair falls back as a pair (D4) when the theme is applied, and the scenes read the same resolved values. Built-in packs are designed and tested by hand and are left as they are (Retro's `--ink` is a fill under fixed light text, not text on `--bg`).
- **FR-022** `[IMPLEMENTED]` Settings shows, under the theme list, one line per user theme with fallbacks: "N values use the defaults (not usable or hard to read)". The AI dialog shows the same count with its warnings.

### AI theme maker
- **FR-030** `[IMPLEMENTED]` The prompt asks for the whole token set by type (colours as before; fonts from the allow-list; title weight; radii; shadows), `figures`, and the gadget slots, with the same examples of what each one is for. The parser keeps each valid value, drops the rest with a warning (D5), and the fix passes keep working as in spec 040 FR-020.

### Guard
- **FR-040** `[IMPLEMENTED]` A static test (`test:theme-tokens`, no Electron) scans the renderer's CSS and JS (`styles.css`, `screens.css`, `themes.css`, `app.js`, `screens.js`, `scenekits.js`, `index.html`) for colour literals (`#hex`, `rgb(`, `hsl(`) and `font-family` declarations that are not `var(--…)`/`inherit`, outside the token defaults (`theme.js` built-in packs and the `:root` block of `styles.css`). The counts per file are compared with a checked-in **ratchet** (`scripts/fixtures/theme-literals.json`): a count above the ratchet fails ("use a token"), a count below it fails until the ratchet is lowered in the same change, so the number only goes down. It also fails when a token is registered without a default, or a `font`-typed token's default is not in the allow-list.
- **FR-041** `[KNOWN GAP]` Phase 2: the remaining literals move onto tokens, file by file, lowering the ratchet each time, with `check:geometry` and `check:office` green. `[KNOWN GAP]` until the ratchet reaches 0 for every file (scene kits' fixed costume colours may stay as named kit tokens).

### What a theme may never change (by design)
- **FR-050** Sizes, spacing, borders and density (D2); status words and permission, credit and usage wording (spec 036 FR-003); the layout of the office; the status colours' meaning (working blue-ish, waiting amber, error red, done green, as checked by the AI maker); motion beyond the named presets (spec 036 FR-006; reduced motion always wins); sounds (the app has none).

## Success Criteria

- **SC-001** A pack with fonts, radii, shadows, figures and gadgets changes all of them on screen, and `check:geometry` still reports the same layout as Clean Office.
- **SC-002** A pack full of bad values loads, falls back value by value, and says how many.
- **SC-003** The literal count of the guard never goes up; it goes down with each Phase 2 change.
- **SC-004** No theme can fetch anything from the network or load a file other than its `manifest.json`.

## Evidence (2026-10-21)

- `test:` `test:theme-tokens` (new): the renderer's and main's typed-token copies give the same verdict on a 42-value corpus for every typed token (462 checks), the contrast pairs and art slots are the same lists, every default passes its grammar and equals the `:root` value, the literal ratchet per file (styles.css 213 colours, screens.css 69, themes.css 59, app.js 15, screens.js 3, scenekits.js 70, index.html 5; 0 font-family literals: the monospace stacks now read `--font-mono`), unusable values dropped one by one, hostile ones refusing the pack, user-pack contrast pairs set back, built-ins untouched, figures and gadget slots. A new colour literal in a CSS file makes it fail (mutation-checked).
- `test:` `test:themegen` (typed tokens, figures and the cup through the AI parser, with the warnings), `test:scenekits` (cup and laptop replace the kit's, steam kept), `test:theme`, `test:userthemes` (the 200 cap).
- `sim:` `check:theme-art` with *Pink Studio* now also sets fonts, the title weight, radii, shadows, clothes and hair, a cup and a laptop: at 1440x900 and 1280x800 every desk dresses its person in the pack's clothes and draws its laptop, every idle desk its cup, every walker and chip wears the clothes, the body font, `--r-md` on controls, the card shadow and the display font on the Settings title are the pack's, and back in Clean Office all computed styles equal the ones before. `check:geometry` includes the pack (`pink-studio`), so the layout with its body font is the same as Clean Office's.
- Not verified: macOS and Windows font fallback with the allow-listed names (the Linux runner has none of Avenir Next or Didot, so the generic fallback was what rendered), and the AI maker with the new prompt on a real model (no AI credits spent).

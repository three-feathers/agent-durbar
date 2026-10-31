# Feature Specification: Full theme tokens (fonts, shapes, figures and gadgets)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Full theme tokens: typed tokens for fonts (system allow-list, no downloads), title weight, radii and shadows; the people's clothes and hair; cup and laptop slots; per-value fallback with a note, pair-wise contrast fallback, hostile values refuse the pack; AI maker extended; a ratchet on the renderer's colour literals
status: building
note: phase 1 built; T020 remaining colour literals onto tokens open
-->

**Feature Branch**: `070-theme-tokens`
**Created**: 2026-10-21
**Status**: Phase 1 built (typed tokens, fonts, radii, shadows, figure palettes, gadget slots, validator, guard, AI maker); Phase 2 (moving the remaining literal colours of the CSS onto tokens) in progress, tracked by the guard's ratchet.
**Input**: Owner (Vikram, Telegram, 2026-10-21 21:19 UTC): "I want real tokenization and full support for total customization of the theme, including fonts, …". Follows spec 040 FR-023 (the characters and gadgets of a picked theme now show everywhere).

## Summary

A theme pack today can set 147 colour tokens, name one UI style and one scene kit, rename scene words and draw small SVG art. Everything else that makes a look (the fonts, the roundness of cards and buttons, the depth of shadows, the clothes and hair of the people, the cup and laptop on the desk) is fixed by the app, and about 450 colour literals in the renderer's CSS bypass the tokens. This feature makes the visual properties a theme may change **named, typed tokens** with Clean Office defaults, checks every value by type, and extends the AI theme maker to fill them. What a theme may never change stays fixed and is listed here, with the reason.

## Clarifications (decisions with defaults; the owner may change any of them)

- **D1 Fonts: system fonts only, from an allow-list (default).** A pack names font stacks for three roles: `--font` (body text), `--ui-display` (screen and dialog titles, door plates) and `--font-mono` (paths, code). Each stack is up to 8 family names from a fixed allow-list of fonts that ship with Windows, macOS or common Linux desktops, or the generic families (`system-ui`, `sans-serif`, `serif`, `monospace`, `ui-monospace`, `ui-serif`, `ui-sans-serif`, `ui-rounded`); the app always appends the role's generic fallback. **No remote URL is ever fetched, and font files inside a pack are not loaded** in this phase (a pack may carry at most 8 files, and only `manifest.json` is read). Reason: a font file is a binary parser attack surface and a remote font is a network request from a theme; neither is needed for the looks asked for so far. Bundled font files (`.woff2` read from the pack folder, size-capped, through `FontFace` from bytes) are a possible later phase: `[KNOWN GAP]`.
- **D2 Sizes and spacing stay fixed.** Font sizes, line heights, paddings, gaps, border widths, control heights and the density are not themeable: they decide the office layout, and the rule that 15 agents fit on 1440x900 and 1280x800 with text at least 10.5px (constitution V) is proven once in Clean Office and then by `check:geometry` showing that every theme lays out the same (spec 035 FR-010). Font **weight** for titles is themeable within 500-800. A body font with other widths is checked by the geometry check's real-font pass.
- **D3 Skin tones stay the app's.** A theme may give the people new clothes (shirt palette) and hair colours; skin tones always come from the app's own varied set, so no theme can make every person one skin tone. Hair styles and glasses stay per agent.
- **D4 Contrast is enforced, per pair.** Text pairs (the WCAG AA pairs of spec 040 FR-017, 4.5:1; 3:1 for large or non-text marks) are checked when a pack is loaded, not only when the AI makes it. A pair that fails is fixed **minimally on its text or accent side** (2026-10-22, see *Changes*): the theme's base surfaces are never changed, so a dark theme stays dark and a light one light, and Settings and the AI dialog say how many colours were adjusted.
- **D5 Unusable values fall back per token**, never the whole pack: an unknown key or a value of the wrong type is dropped (Clean Office's value is used), and the count is shown on the theme's card in Settings and in the AI dialog ("3 values were not usable and use the defaults").
- **D6 Hostile values still refuse the pack.** Markup or CSS syntax in a value (spec 040 FR-006) is a sign of a crafted pack, so such a pack is not imported at all (FR-020).

## User Scenarios & Testing

### Story 1 - A theme with its own fonts and shapes (P1)
A user imports (or the AI makes) a pack that sets a rounded display font, softer corners and deeper card shadows. After picking it, room plates, dialog titles and the brand use the display font, cards and buttons use the new radii, cards use `--shadow-card` and menus and popovers use `--shadow-pop` (dialogs keep the app's own shadow), and the layout is exactly the same as in Clean Office.

**Acceptance**: `check:geometry` passes with the pack; the computed `font-family` of a dialog title, the `border-radius` of a card and a button, and the `box-shadow` of a card and a menu are the pack's.

### Story 2 - People and gadgets that fit the look (P1)
The pack gives a shirt palette (pinks), hair colours and its own cup and laptop drawings. Every desk, helper tile, walker and chip draws people in the pack's clothes, and an idle desk shows the pack's cup.

**Acceptance**: `check:theme-art` (spec 040 FR-023) with the sample pack asserts the shirt colours on desks, walkers and chips and the gadget slots on desks.

### Story 3 - Bad values do not break the look (P2)
A pack with a script in an SVG, a font that is not on the allow-list, a 2px font size, a 40px radius and unreadable text colours still loads: each unusable value uses the default, the failing text pair falls back as a pair, and the card says how many values fell back. (A remote font URL is not unusable but hostile: any `url(` refuses the whole pack, FR-020 and D6.)

## Requirements

### Token registry
- **FR-001** `[IMPLEMENTED]` One registry lists every themeable token with its **type** and Clean Office default: `color` (the 147 existing tokens), `font` (`--font`, `--ui-display`, `--font-mono`), `weight` (`--t1-weight`), `radius` (`--r-sm`, `--r-md`, `--r-lg`, `--r-xl`, `--radius`), `shadow` (`--shadow-card`, `--shadow-pop`). There are two copies with the same content, because the page cannot import TypeScript: `theme.js` (the renderer) and `src/shared/themetokens.ts` (the import check in main, `src/shared/themes.ts`, and the AI maker, `src/shared/themegen.ts`); `test:theme-tokens` pins them to each other (same lists, same verdict on one corpus), and the same test pins `theme.js`'s `CONTRAST_PAIRS` to `themegen.ts`'s.
- **FR-002** `[IMPLEMENTED]` Type grammars (anything else is dropped, D5):
  - `color`: hex (`#rgb`, `#rrggbb`, `#rrggbbaa`), `rgb()/rgba()/hsl()/hsla()` with numbers only, or `transparent`;
  - `font`: 1-8 comma-separated names from the allow-list (FR-003), quoted or not, each at most 40 characters; no `url(`, no `@`, no `;` (the AI prompt asks for 1-4 names; the check accepts up to 8, as D1 says);
  - `weight`: an integer 500-800 in steps of 50;
  - `radius`: `0`-`24px`;
  - `shadow`: `none`, or 1-2 comma-separated layers `[inset] <x> <y> <blur> [<spread>] <color>` with offsets -40px..40px, blur 0..64px, spread -24px..24px and a `color` value;
  - every typed value at most 160 characters, no quotes other than in font names, no `<`, `>`, `{`, `}`, `;`, `\`, `url(`, `var(`, `expression(`.
- **FR-003** `[IMPLEMENTED]` The font allow-list (D1) is a fixed list in `src/shared/themetokens.ts`, for example `Segoe UI`, `Helvetica Neue`, `Arial`, `Verdana`, `Tahoma`, `Trebuchet MS`, `Georgia`, `Palatino Linotype`, `Palatino`, `Book Antiqua`, `Times New Roman`, `Garamond`, `Baskerville`, `Cambria`, `Calibri`, `Candara`, `Corbel`, `Gill Sans`, `Optima`, `Futura`, `Avenir`, `Avenir Next`, `Didot`, `American Typewriter`, `Courier New`, `Consolas`, `Menlo`, `Monaco`, `SF Mono`, `Cascadia Mono`, `Roboto`, `Noto Sans`, `Noto Serif`, `DejaVu Sans`, `DejaVu Serif`, `DejaVu Sans Mono`, `Liberation Sans`, `Liberation Serif`, `Ubuntu`, `Cantarell`, `Comic Neue`, `Hiragino Mincho ProN`, `Yu Mincho`, `Noto Serif CJK JP`, the generic families of D1 (`ui-sans-serif` included). The app appends the role's fallback (`sans-serif`, `serif` or `monospace` as the default stack ends), so a missing font degrades to a system one.
- **FR-004** `[IMPLEMENTED]` The manifest cap on tokens rises from 160 to 200 (every registered token fits).
- **FR-005** `[IMPLEMENTED]` A pack that sets `--ui-display` gets it on the screen and dialog titles and the door plates in every UI style, Clean included (`html[data-display]`, set by `theme.js`); without it the UI style decides, as before.

### Figures and gadgets
- **FR-010** `[IMPLEMENTED]` A manifest may have `figures: { shirts: [color x 1..8], hairs: [color x 1..8] }`. An agent's look keeps its own index into the app's palettes; with a theme palette its shirt is `shirts[i % n]` and its hair `hairs[j % n]` (the index is found from the agent's own colour in the app palette, so the same agent keeps the same slot across themes). Skins never change (D3). The figure is drawn with these colours on desks, helper tiles, walkers and chips, in every scene kit.
- **FR-011** `[IMPLEMENTED]` New art slots `gadget-cup` (the idle cup, replaces the app's drawing; area x 96-114, y 66-87 of the 200x124 stage) and `gadget-laptop` (the laptop on the desk, replaces it; area x 55-99, y 79-88). Same sanitizer as every slot (spec 040 FR-005: rebuilt from a tag and attribute allow-list, no text, no scripts, no `foreignObject`, no `image`, no `href`, no external `url()`), at most 24,000 characters per slot (a compiled pixel map of a built-in pack reaches about 17,000). Drawn in every scene kit; the steam over an idle cup stays (it is a status cue).

### Validation, fallbacks, contrast
- **FR-020** `[IMPLEMENTED]` Two levels. A value that looks **hostile** (markup or CSS syntax: `<`, `>`, `{`, `}`, `;`, `\`, `@`, `url(`, `expression(`, `var(`, or a key that is not `--name`) still refuses the whole pack at import, as since spec 040 FR-006: a crafted pack is not installed. A value that is only **unusable** (a known token with a value of the wrong type or out of range, a font not on the allow-list, an unknown `--name`) is dropped on its own and Clean Office's value is used (D5); `checkUserManifest` returns the dropped keys (`dropped`), and the renderer drops the same ones, with one difference: an unknown `--name` is kept on disk by main (it is not in `dropped`), and the renderer ignores it and counts it in the Settings note. Allow-lists (fonts, typed tokens, built-in ids) are looked up by own property only, so a name such as `constructor` or `__proto__` is a font not on the list (unusable), never a match.
- **FR-021** `[IMPLEMENTED]` After the type check, the text pairs of spec 040 FR-017 (`CONTRAST_PAIRS`) are checked on the resolved tokens of a **user** theme (imported or made with AI); a failing pair is fixed as D4 and FR-023 say when the theme is applied, and the scenes read the same resolved values. Built-in packs are designed and tested by hand and are left as they are (Retro's `--ink` is a fill under fixed light text, not text on `--bg`).
- **FR-022** `[IMPLEMENTED]` Settings shows, under the theme list, one line per user theme with fallbacks: "N values use the defaults (not usable)" and/or "M colours adjusted so text stays readable". The AI dialog's preview shows the adjusted count for the theme it made (FR-024) next to its warnings.
- **FR-023** `[IMPLEMENTED]` (spec delta 2026-10-22, review on #500) The contrast fix changes **only the failing pair, minimally, and never a base surface**. Base surfaces: `--bg`, `--surface`, `--surface-2`, `--raised`, `--card` and `--card-*`, `--soft`, `--note`, `--pb-*`, `--drop-bg`, `--brand-bg`, `--idle-stub`. Of a failing pair, the side that is not a base surface is changed (the text, or the accent of a button whose text is `--surface`); its colour is mixed toward white or black (whichever reads better on the other side) by the smallest step that reaches the pair's minimum, so its hue stays and the theme keeps its light or dark polarity. Up to 4 passes, because one text colour sits on several surfaces. A theme whose surfaces mix polarities so far that one text colour cannot read on all of them keeps the last pass's values (`[KNOWN GAP]`: the AI maker's own fix passes catch it for generated themes; an imported one shows the adjusted count).
- **FR-024** `[IMPLEMENTED]` (spec delta 2026-10-22, review on #500) The AI dialog's preview runs the same check on the theme it made (`THEME.contrastCheck(manifest)`) and says "N colours adjusted so text stays readable" when it adjusts any.
- **FR-025** `[IMPLEMENTED]` (spec delta 2026-10-22, review on #500) The AI dialog counts colours as the keys that are not typed tokens, and fonts and shapes separately ("147 colours, 11 fonts and shapes").

### AI theme maker
- **FR-030** `[IMPLEMENTED]` The prompt asks for the whole token set by type (colours as before; fonts from the allow-list; title weight; radii; shadows), `figures`, and the gadget slots, with the same examples of what each one is for. The parser keeps each valid value, drops the rest with a warning (D5), and the fix passes keep working as in spec 040 FR-020.

- **FR-031** `[IMPLEMENTED]` (spec delta 2026-10-22, from the real check below) The AI parser also takes the two other colour forms the prompt's own defaults show, `transparent` (kept as `#00000000`) and the space form `rgb(r g b)` / `rgb(r g b / a)` (kept as hex with alpha), so a model that copies a default's form does not lose that colour. Anything else that is not hex or `rgb()` still drops the colour with a warning.

### Guard
- **FR-040** `[IMPLEMENTED]` A static test (`test:theme-tokens`, no Electron) scans the renderer's CSS and JS (`styles.css`, `screens.css`, `themes.css`, `app.js`, `screens.js`, `scenekits.js`, `index.html`) for colour literals (`#hex`, `rgb(`, `hsl(`) and `font-family` declarations that are not `var(--…)`/`inherit`, outside the token defaults (`theme.js` built-in packs and the `:root` block of `styles.css`). The counts per file are compared with a checked-in **ratchet** (`scripts/fixtures/theme-literals.json`): a count above the ratchet fails ("use a token"), a count below it fails until the ratchet is lowered in the same change, so the number only goes down. It also fails when a token is registered without a default, or a `font`-typed token's default is not in the allow-list.
- **FR-041** `[KNOWN GAP]` Phase 2: the remaining literals move onto tokens, file by file, lowering the ratchet each time, with `check:geometry` and `check:office` green. `[KNOWN GAP]` until the ratchet reaches 0 for every file (scene kits' fixed costume colours may stay as named kit tokens). 2026-10-22 (T017): the last `#e5be78` borders moved onto `--tone-warn-line`.

### What a theme may never change (by design)
- **FR-050** Sizes, spacing, borders and density (D2); status words and permission, credit and usage wording (spec 036 FR-003); the layout of the office; the status colours' meaning (working blue-ish, waiting amber, error red, done green, as checked by the AI maker); motion beyond the named presets (spec 036 FR-006; reduced motion always wins); sounds (the app has none).

## Success Criteria

- **SC-001** A pack with fonts, radii, shadows, figures and gadgets changes all of them on screen, and `check:geometry` still reports the same layout as Clean Office.
- **SC-002** A pack full of unusable values loads, falls back value by value, and says how many.
- **SC-003** The literal count of the guard never goes up; it goes down with each Phase 2 change.
- **SC-004** No theme can fetch anything from the network or load a file other than its `manifest.json`.

## Changes

### 2026-10-29: index status text kept from before the fixed status words (spec 021 FR-063)

The `status:` of the specs-index block used to read (moved here unchanged; the block now has one status word and a short note):

> **Phase 1 built** (`test:theme-tokens`, `check:theme-art`, `check:geometry` with *Pink Studio*); Phase 2 (remaining literals onto tokens) open; the new AI prompt checked on a real model (Claude haiku, 2026-10-22, 1 prompt; FR-031 fix)


- **2026-10-22 (review on #500 by Paco's agent)**
  - FR-020: the allow-lists are looked up by own property (`FONT_INDEX` is a `Map` in `themetokens.ts` and a null-prototype object in `theme.js`; `typedValue`, `token()` and the built-in id checks in `theme.js` use an own-property check), so `"--font":"constructor"` (or `__proto__`, `toString`, `hasOwnProperty`) is an unusable font: an imported pack drops it and the AI maker drops it with a warning instead of refusing the whole theme. FR-020 also says that main keeps unknown `--names` on disk while the renderer counts them.
  - Story 1 says `--shadow-pop` covers menus and popovers (dialogs keep their literal shadow, the AI prompt says the same: moving `.dlg` onto the token would change the look, since its shadow is `0 18px 50px rgba(40,35,25,.25)` and Clean Office's is three layers, more than the shadow grammar's two), Story 3 no longer lists a remote font URL among the values that fall back (a `url(` is hostile and refuses the pack), and SC-002 says "unusable values".
  - Merge of main (be26cabe): the literal ratchet for `app.js` goes 17 -> 18 for main's comment `(#453)` (spec 052 FR-174), which the counter reads as a colour; not a colour in this PR.
  - Evidence: `test:` `test:theme-tokens` (prototype names as fonts and as token keys in both copies; one hostile case per part of `HOSTILE_RE`, each on its own; `theme.js`'s rule pinned equal to `themetokens.ts`'s), `test:themegen` (an AI reply with a prototype name as `--font` is kept, the font dropped with a warning). Mutation-checked: removing any one of `<`, `>`, `{`, `}`, `;`, `\`, `@`, `url(`, `expression(`, `var(` from `HOSTILE_RE`, `;` from the renderer's copy, or going back to a plain-object `FONT_INDEX` in either copy fails the suite. Not caught by a test: dropping the own-property check on `TYPED_TOKENS` in `theme.js`'s `typedValue` alone (an equivalent mutant: a prototype entry has no `type`, so the value is refused anyway, and `validateManifest` checks the key first).

- **2026-10-22 (review on #500 by Ruben's agent)**
  - `theme.js` `CONTRAST_PAIRS` takes spec 052's three button-text pairs (`--surface` on `--sage-ink`, `--red-ink`, `--amber-ink`, #515) in `themegen.ts`'s order; the equivalence test caught the drift once main merged.
  - D4 and FR-021 changed: the old fallback set both sides of a failing pair to Clean Office, so a shared surface (`--surface`, `--bg`) turned light and cascaded; a dark theme with one dim colour became a light one with dark ink on its own dark `--surface-2`. FR-023 replaces it (minimal fix on the non-surface side).
  - FR-024 (the AI preview shows the adjusted count) and FR-025 (the dialog's colour count) added; FR-001, FR-002, FR-003 and D1 now say what was built (`--t1-weight`, two pinned copies, up to 8 names and 160 characters, `ui-sans-serif`).
  - `test:theme-tokens` also proves the built-in themes are applied exactly as designed (`setTheme(id)`, then `token(k)` for every pair key).
  - Evidence: `test:` `test:theme-tokens` (a light pack's dim ink is darkened to 4.5-4.7:1 on its darkest surface and the surfaces stay; the dark fixture reads as designed; the dark fixture plus a dim `--muted` and a dim `--sage-ink` changes only those two, keeps every surface and its ink, stays dark, and every pair passes; `contrastCheck` agrees; every built-in applies its pair tokens unchanged). Mutation-checked: the old both-sides fallback fails it, and running the fix on built-ins fails it (Retro's `--ink`). Literal ratchet after main (#515): styles.css 211 -> 156 colours, screens.css 48 -> 16, themes.css 59 -> 52, the rest unchanged. `sim:` `check:theme-art` and `check:geometry` (Retro) pass on the merged tree.

## Evidence (2026-10-21)

- `test:` `test:theme-tokens` (new): the renderer's and main's typed-token copies give the same verdict on a 42-value corpus for every typed token (462 checks), the contrast pairs and art slots are the same lists, every default passes its grammar and equals the `:root` value, the literal ratchet per file (styles.css 213 colours, screens.css 69, themes.css 59, app.js 15, screens.js 3, scenekits.js 70, index.html 5; 0 font-family literals: the monospace stacks now read `--font-mono`), unusable values dropped one by one, hostile ones refusing the pack, user-pack contrast pairs set back, built-ins untouched, figures and gadget slots. A new colour literal in a CSS file makes it fail (mutation-checked).
- `test:` `test:themegen` (typed tokens, figures and the cup through the AI parser, with the warnings), `test:scenekits` (cup and laptop replace the kit's, steam kept), `test:theme`, `test:userthemes` (the 200 cap).
- `sim:` `check:theme-art` with *Pink Studio* now also sets fonts, the title weight, radii, shadows, clothes and hair, a cup and a laptop: at 1440x900 and 1280x800 every desk dresses its person in the pack's clothes and draws its laptop, every idle desk its cup, every walker and chip wears the clothes, the body font, `--r-md` on controls, the card shadow and the display font on the Settings title are the pack's, and back in Clean Office all computed styles equal the ones before. `check:geometry` includes the pack (`pink-studio`), so the layout with its body font is the same as Clean Office's.
- `real:` 2026-10-22 (owner's go-ahead, Telegram 2026-10-22), app 0.1.0-alpha.10 (this branch), Claude Code 2.1.304, **haiku** through the app's own one-shot path (`ClaudeAdapter.generateText`, the `theme:generate` pass loop), description "a calm pink design studio with stylish people and plants"; tool `scripts/themegen-real.ts`. **1 prompt** (cost not recorded: the run's summary line was cut from the output; spec 040's haiku runs cost about $0.01). Pass 1 parsed as a theme with **0 contrast issues**, so no fix pass ran. All 147 colour keys came back; all 11 typed tokens were sent and all were valid and kept: `--font` "Avenir Next, Helvetica Neue, sans-serif", `--ui-display` "Palatino Linotype, Palatino, serif", `--font-mono` "SF Mono, Menlo, monospace" (every name on the allow-list), `--t1-weight` 600, radii 8/12/16/22px and `--radius` 14px, `--shadow-card` and `--shadow-pop` one layer each. `figures`: 8 shirts and 6 hairs, all kept. Art: 16 slots sent and 16 kept, including `gadget-cup` (227 characters) and `gadget-laptop` (136); both came back unchanged from the sanitizer and are stable when sanitized again. `checkUserManifest`: ok, nothing dropped; the Settings/AI fallback count (`THEME.fallbacks`) was **0** (0 dropped, 0 contrast pairs set back). **Gap found:** the parser left out 2 colours with a warning: `--focus-halo` "transparent" and `--drop-bg` "rgb(251 236 240 / .93)", the forms of their own defaults in the prompt; fixed by FR-031 (`test:themegen`), and the same reply now parses with no warning.
- Not verified: macOS and Windows font fallback with the allow-listed names (the Linux runner has none of Avenir Next or Didot, so the generic fallback was what rendered); the extended prompt on Copilot or Codex (only Claude haiku was run); the generated theme rendered in the app (the parse, sanitizer and fallback checks ran in Node, not in a window).

### 2026-10-23: the Cheeky Crew portraits (spec 077, Q1 = raster; owners' decision, to be agreed with Vikram as owner of this spec)

- **D3 delta.** In the `crew` scene kit only, a character's skin tone comes from its portrait and its cast entry (`CAST` in `crew.js`), not from the agent's hash: skin tones stay varied across the cast (spec 077 Q1.2). Every other kit and the plain fallback figure keep D3.
- **FR-040 delta.** The ratchet counts code, not bitmaps: the portraits under `src/renderer/crew/` are fixed-colour pictures governed by spec 077 FR-050..FR-056 (`test:crew-assets`) instead. `crew.js` holds the cast's hand and sleeve colours and is outside the scanned files; `scenekits.js` gains no colour literal.

## Changes 2026-10-31: doors removed (pointer, spec 017 T024)

Spec 017 FR-029 (owner decision, no doors) removed the Office with cabins layout, the desk door button, meeting-room signs, room door plates, **Close all** / **Open all**, door-held schedules and the door refusal of remote control, and `door-art`, `--door-*` and the door words of the theme contract. Any requirement in this spec about those (door plates, plate totals or siren, door signs, collapse, Close all / Open all, the `door` field) no longer applies and is kept as a record; Hide folder, floors and the plain status word stay. See spec 017's table of what was lost and what remains.

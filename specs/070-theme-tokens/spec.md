# Feature Specification: Full theme tokens (fonts, shapes, figures and gadgets)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Full theme tokens: typed tokens for fonts (system allow-list, no downloads), title weight, radii and shadows; the people's clothes and hair; cup and laptop slots; per-value fallback with a note, pair-wise contrast fallback, hostile values refuse the pack; AI maker extended; a ratchet on the renderer's colour literals
status: building
note: phase 1 built; T020 remaining colour literals onto tokens open; phase 3 (tiers, closed world list, size lint, app font) specified
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

### 2026-11-01: Phase 3, tiers, a closed world list, a size lint and the app's font (design sweep; FR-051..FR-059)

**Status: specified, not built.** Source and owner decision: spec 005's delta of this date. **No new tool:** the owner accepted extending what exists. Compared and not chosen: Style Dictionary (v5.7.1, 13 dependencies, only helps a second platform, which this app has not; reconsider if tokens must feed something non-CSS) and a component library or framework (Tailwind, Radix Themes, Lit: a rewrite of 2513 CSS rules and 330 button sites; Radix needs React; none helps worlds, which arrive as data at run time and carry no CSS). The problem is enforcement. Sizes from `npm view` on 2026-11-01; nothing was installed, and no trial migration was run.

*What exists and stays:* `CLEAN_TOKENS`, `TYPED_TOKENS`, the two pinned copies (FR-001), `checkUserManifest`, `themeIssues`, `contrastFix`, D2, D4..D6, `--t1..5`, `--s-1..5`, `--h-*`, `WORLD_SETS`, `test:theme-tokens`, and 098 FR-040's extension of the lint. *Measured against the house rules (`docs/design-rules.md`):* 386 literal `font-size` declarations against 92 through a token; 14 font sizes on screen against 5 allowed.

- **FR-051** **Three tiers.** **Tier 1**, sizes, app-owned, no pack can touch them (D2): `--t1..5` plus `--t-tag`, `--s-0..5`, `--h-ctl`, `--h-sm`, `--h-chip`, `--h-switch`, `--chat-prose` (005 FR-206), elevation. **Tier 2**, semantic, the closed list of FR-052. **Tier 3**, component: always `var()` of tiers 1 and 2, added only when two places share a value, never set by a pack, for example `--btn-h`, `--btn-primary-bg`, `--switch-on`, `--switch-off`, `--note-info-bg`, `--pop-shadow`, `--overlay`. No colour-primitive tier: a pack's values are its primitives.
- **FR-052** **A closed list of what a world may set.** Surfaces `--bg --surface --surface-2 --raised --soft --note`; text `--ink --ink-2 --muted`; lines `--line --line-2 --line-ctl`; action `--accent` (today `--sage-ink`, aliased first), `--accent-soft` (today `--sage`), `--focus --sel-border --sel-ring`; danger and warning `--red-ink --amber-ink --warn-bg --bad-bg`; the bar `--wb-*`; shape and type `--r-sm..xl --shadow-card --shadow-pop --font --font-mono --ui-display --t1-weight`. About 45 names against 152 today; `read:` a proposal from `WORLD_SETS` and the CSS, and a real pack may add a few, each by a spec line. Status colours (`--c-*`, `--pb-*`, `--pc-*`) are not on it (`docs/world-design.md`); `--tone-*` stays derived; flat scene slots stay outside it. **FR-130 of spec 097 stands:** a world's own set changes colours and the two shadows, so fonts and radii on the list apply to a pack, not to the Photo office. Enforcement stays D5 and D6: dropped with a count, or refused if hostile. Scope: a world pack; the 152 stay for themes until spec 102 removes those.
- **FR-053** **`--wb-*` joins the registry.** `read:` they appear in `theme.js` and a test, not in `src/shared`, so a downloaded pack's `--wb-*` would be dropped as unknown and could not set its bar, although spec 102 says the bar follows the pack. The `--wb-*` pairs of `WORLD_PAIRS` join the shared contrast check. `test:` a fixture pack sets them and imports with no drops, and a failing pair is repaired. Needed before the first downloaded world; coordinated with spec 102's branches. The test confirms the gap first, since no pack was imported in the sweep.
- **FR-054** **A ratchet for sizes, weights, radii and shadows.** `tools/inventory.js` from the sweep moves to `scripts/`, with a baseline fixture, and its `--check` runs inside `test:theme-tokens`, with no second lint. Like FR-040, a count over the baseline fails and a count under it fails until lowered in the same change.

  | Check, chrome rules; office selectors counted apart | Start |
  |---|---:|
  | `font-size`, `line-height`, `font-weight` literals | 386, 114, 221 |
  | `padding`, `margin`, `gap` off the scale | 570, 291, 344 |
  | `border-radius` that is not a token, 999px or 50% | 305 |
  | `box-shadow` literal outside tokens | 127 |
  | A tier 3 name in a pack or `WORLD_SETS`; a pack token off the list | 0 from the start |
  | New `<button>` class set not in the fixture | 99 |
  | Measured in `check-ui-text`: distinct font sizes or control heights on a surface over the scale | Warn, then fail |

  The numbers are the sweep's; the first run commits what it finds on `main`. **Why this may stall:** T020 has been open since 2026-10-21 and a ratchet stops growth, not a backlog. So migrations are tied to something the owner sees: chat, toggles and dialogs first, the office last and maybe never (`check:geometry`, `check:office`). A checkbox that acts at once cannot be linted: a review line (052 FR-222).
- **FR-055** **The scale.**

  | Token | On screen today | Proposal | Values |
  |---|---:|---:|---|
  | Font size | 14 | 6 | 10.5 (tags only), 11, 12, 13, 14, 16 |
  | Font weight | 8 | 3 | 400, 500, 600 |
  | Radius | 21 | 6 | 6, 10, 14, 18, pill, circle |
  | Shadow | 34 | 4 | none, card, pop, focus ring |
  | Space | 30 | 6 | 2, 4, 8, 12, 16, 24 |
  | Button height | 7 | 4 | 32, 28, 24 icon, 22 switch |

  Snapping the chrome to it in the running app changed 108 to 398 styles per screen, with nothing under 10.5 px and nothing clipped, and the office left alone. 46% of text is bold; `read:` the sweep thinks much of the heavy look comes from that. **It changes older text when built:** design rule 1 (2 heights), `--t1` and `--t2`'s 650 to 600 (FR-098 of 052), and the 8 px radius family. FR-002's `--t1-weight` grammar (500-800) stays while themes exist. The 10.5 px floor stays. It applies to chrome; desk cards, rooms and the lobby keep their sizes.
- **FR-056** **Control helpers, no library.** One small `src/renderer/ui.js` (`Ui.btn`, `Ui.switch`, `Ui.chip`, `Ui.note`) returning escaped strings, as `sw()` in `screens.js` does. A site moves when it is touched. `@layer` is allowed once literals settle; neither `@layer` nor `@property` has been tried here.
- **FR-057** **World switch cost.** The sweep reasoned that tier 3 adds no runtime cost. `check:perf`'s world-switch row (097 FR-178) must not move when T024 lands; that is the measurement.
- **FR-058** **The app's font: keep the current stack. Nothing clearly wins.** The owner asked (2026-11-01) for a crisper font if one exists, and left the choice to the agent. **Decision: no bundled font; `--font` stays `system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif`.** It resolves to Segoe UI on Windows, the system's San Francisco on macOS, and whatever fontconfig gives on Linux (Noto Sans on the test machine, DejaVu Sans on CI). No font ships with the app today, and `--font-mono` and the fallback are unchanged. The agent's decision, reversible by the owner.

  *How it was judged.* Real chat, cards and top bar, plus a specimen at 10.5, 11, 12, 13 and 14 px in weights 400 and 600, in the simulator under xvfb at device pixel ratio 1 and 2. Candidates were loaded from their own official files into the running page: Inter 4.1 (plain and its hinted build), IBM Plex Sans 3.005, Source Sans 3.052, Geist 1.800, Noto Sans (the hinted file), against the current stack and DejaVu. Measure: of the pixels a glyph touches, the share that are mid-grey rather than solid; lower is crisper. Two fontconfig settings stand in for other systems, **as proxies only**: full hinting with subpixel order (FreeType's v40 mode, close in kind to DirectWrite) and no hinting in grey (close in kind to macOS at 1x).

  | Mid-grey share, weight 400, 11 px / 13 px | Current here (Noto) | Inter | Plex | Source Sans | Geist |
  |---|---:|---:|---:|---:|---:|
  | This Linux, slight hinting, ratio 1 | .79 / .73 | .74 / .73 | .75 / .72 | .75 / .73 | .72 / .74 |
  | Windows proxy, ratio 1 | .65 / .71 | .64 / .70 | .63 / .76 | .69 / .75 | .69 / .74 |
  | macOS proxy, ratio 1 | .81 / .72 | .79 / .67 | .82 / .74 | .79 / .73 | .79 / .64 |
  | This Linux, ratio 2 | .54 / .47 | .52 / .46 | .56 / .52 | not run | .54 / .47 |

  **What that says.** The candidates sit within about .05 of each other, and the order changes from row to row and size to size. The screen's pixel ratio moves the number about .25 and the hinting mode up to .14, each more than any font. Beside that, on the two systems most users have, the current stack is not a font we can beat here: Segoe UI and San Francisco are the systems' own, and neither can be rendered on this machine. An unhinted bundled font on a Windows screen at 100% risks being worse than Segoe UI (reasoned, not seen). The plain Inter file has no hinting tables at all (no `fpgm`, `prep`, `gasp`); Plex has small ones; Geist and Noto are autohinted; the Source Sans TTF has none.

  | Other things weighed | Current | Inter | Plex | Source Sans | Geist | Noto hinted |
  |---|---|---|---|---|---|---|
  | Size for 400, 500, 600, 700 (KB) | 0 | 455 (352 variable) | 260 | 436 | 185 | 2500 as TTF |
  | Digits | Tabular here | Proportional, needs `tnum` | Tabular | Tabular | Proportional, needs `tnum` | Tabular |
  | Greek, Cyrillic, Latin extended | System | Yes | Yes | Yes | **No Greek** | Yes |
  | Devanagari, Arabic, CJK | System | System fallback | System fallback | System fallback | System fallback | System fallback |
  | Top bar free width at 1280, px | 75 (DejaVu 0) | 63 | 93 | 139 | 77 | 80 |
  | x-height (of the em) | Noto .536 | .546 | .516 | .486, reads small at 10.5 px | .530 | .536 |
  | Licence | n/a | OFL | OFL | OFL | OFL | OFL |

  Size is no obstacle (the art pack is 5.88 MB of 10 MB, and there is no package budget). The costs are elsewhere: a bundled face needs `font-src 'self'` in a CSP that names none today, so `@font-face` is blocked, and two tests pin that CSP as unchanged (077 FR-057, 097 FR-060); `--font`'s default must then be on the allow-list (FR-040), and D1 stays for packs. Names in other languages would mix the bundled face with the system's in one line, as they mix system faces now. If the owner still wants one look everywhere, **Inter is the candidate**: its number is no worse than the current stack's in any row above, and it has the candidates' widest symbol coverage and a width near Noto's; it would not be crisper, only the same everywhere.

  **What does make text look heavy, and is measured: bold.** On a system with only Regular and Bold faces (the test machine's Noto Sans), weights 500 and below render Regular and 550 and up render **Bold**. At 13 px, weight 600 prints 57% more ink than 400 in today's stack, and 37% with a real SemiBold (Noto's own SemiBold, 13% less ink and 2% narrower than the Bold shown today). So the sweep's "46% of text is bold" costs most exactly where no semibold exists. FR-055's fewer weights are the crispness work, and T026 uses 600 only where emphasis is meant, knowing 500 may read as 400 on such a system.

  **One property to test on a real Mac.** `body` sets `-webkit-font-smoothing:antialiased`, which only macOS honours and which thins strokes. T030 compares it with `auto` on a real Mac at 2x and on a 1x screen; the Mac owner picks. `[KNOWN GAP]` nobody could run it here.
- **FR-059** **Not checked, for the font.** Source Sans at ratio 2 (no Electron slot was free; it was already behind on x-height at 10.5 px). Segoe UI and San Francisco themselves; any real Windows or macOS rendering, ClearType settings, or Windows display scaling; the proxies are FreeType, not DirectWrite or Core Text. Geist and Inter's `tnum` at every number site. Whether a font feels crisper to a person: a pixel share is a stand-in, and the pictures are for the owner's eye. Side-by-side pictures, for each of the four settings (specimen, 4x zoom, chat, cards, top bar), are in the sweep's working folder, not the repo; the owner has them on request.

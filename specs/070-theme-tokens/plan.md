# Plan: Full theme tokens (spec 070)

## Approach

1. **Registry and grammars in `theme.js`** (the renderer's module, also required by main for the AI maker): `TYPED_TOKENS` (name -> type, default) next to `CLEAN_TOKENS` (the colours); `FONT_ALLOW`; one `tokenOk(type, value)` per FR-002. Non-colour tokens are set on `<html>` only when a pack gives them (and removed otherwise), so the CSS defaults of `styles.css :root` and the UI style's display font in `themes.css` keep working.
2. **Mirror in `src/shared/themetokens.ts`** (pure, no imports) for `checkUserManifest` in main, as `themes.ts` already mirrors `isTokenValue`. A unit test runs both validators on one corpus of good and hostile values and asserts the same verdict, so the copies cannot drift.
3. **Contrast fix** in `setTheme` (D4, FR-023; changed 2026-10-22): after resolving, each failing `CONTRAST_PAIRS` pair changes only its non-surface side, mixed toward white or black by the smallest step that passes (binary search on the mix), so the base surfaces and the theme's polarity stay; `THEME.fallbacks(id)` reports the dropped and adjusted keys for the Settings card (FR-022), and `THEME.contrastCheck(manifest)` the adjusted ones for the AI preview (FR-024).
4. **Figures**: `themedLook(look)` maps an agent's shirt and hair (by their index in the app palettes `S.sh` / `S.hr`) to the pack's `figures` lists; used by `scene()`, `avatar()` and the kits through the same `k`. The scene signature already names the theme key (spec 040 FR-023), so the redraw comes for free.
5. **Gadgets**: `gadget-cup` and `gadget-laptop` slots replace the drawing in the office scene and in every kit (`artOf` in `scenekits.js`).
6. **CSS**: `--font-mono` replaces the monospace literals; `--shadow-card`, `--shadow-pop` and `--t1-weight` are read by cards, menus and popovers, and titles (dialogs keep their literal shadow) with the old literal as the default; radii already use `--r-*`/`--radius`.
7. **AI maker** (`themegen.ts`): the prompt lists the typed tokens with their grammar and allow-list, `figures` and the gadget slots; the parser validates by type through the mirror and keeps per-token drops as warnings.
8. **Guard** `scripts/test-theme-tokens.ts` (`test:theme-tokens`, in `npm test`): literal counts per file against `scripts/fixtures/theme-literals.json` (ratchet both ways), registry sanity, font defaults in the allow-list.

## Reuse

- The sanitizer (`sanitizeSlot`), the art slot pipeline and `artOf` overlays (spec 040 FR-023), `CONTRAST_PAIRS`/`contrast()` of `themegen.ts`, the Settings theme cards and the AI dialog's warnings line, `check:theme-art` and the *Pink Studio* fixture, `check:geometry` for the layout invariant. No new IPC channel.

## Constitution check

- V (calm, legible): sizes and spacing are not themeable (D2); `check:geometry` and `check:office` run with the extended fixture.
- III (safe by default): no network, no font files, no CSS text from a pack: every value passes a typed grammar before it reaches `style.setProperty`, and art the sanitizer.
- VIII (honest limits): Phase 2 (remaining literals) is a `[KNOWN GAP]` tracked by the ratchet; bundled fonts are not built.

## Risks

- A body font with wider glyphs could clip desk text: covered by `check:geometry`'s real-font pass on the fixture.
- Inline custom properties on `<html>` beat `html[data-ui=...]` rules: non-colour tokens are only set when the pack gives them.

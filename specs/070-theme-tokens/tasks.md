# Tasks: Full theme tokens (spec 070)

## Phase 1 (PR: 070-theme-tokens)

- [x] T001 Registry, grammars and font allow-list in `theme.js`; non-colour tokens set only when given; cap 200 tokens [FR-001..FR-004]
- [x] T002 `src/shared/themetokens.ts` mirror; `checkUserManifest` drops bad tokens one by one and returns them; equivalence test [FR-002, FR-020]
- [x] T003 Contrast pairs fall back as pairs when a theme is applied; `THEME.fallbacks(id)`; Settings card note; unit tests [FR-021, FR-022]
- [x] T004 `figures` (shirts, hairs) on desks, helper tiles, walkers and chips, every kit; skins unchanged; unit tests [FR-010]
- [x] T005 `gadget-cup` and `gadget-laptop` slots in the office scene and every kit; 24,000-character cap per slot (FR-011); unit tests [FR-011]
- [x] T006 CSS reads `--font-mono`, `--shadow-card`, `--shadow-pop`, `--t1-weight` (defaults unchanged) [FR-001]
- [x] T007 AI maker prompt and parser for the typed tokens, figures and gadgets; per-token warnings; `test:themegen` [FR-030]
- [x] T008 `test:theme-tokens` guard with the ratchet `scripts/fixtures/theme-literals.json` [FR-040]
- [x] T009 *Pink Studio* fixture (and `check:geometry` now runs it too, as `pink-studio`) gains fonts, radii, shadows, figures and gadgets; `check:theme-art` asserts them (shirts on desks, walkers, chips; cup; computed font, radius, shadow); `check:geometry` with it; screenshots 1440x900 and 1280x800 [SC-001]
- [x] T010 Docs: README *Your own themes*, CHANGELOG, specs index, agent notes

## Phase 2 (later PRs)

- [ ] T020 Move the remaining colour literals of `styles.css`, `screens.css` and `themes.css` onto tokens, file by file, lowering the ratchet [FR-041]
- [ ] T021 (owner decision) Bundled font files in a pack (D1)
- [x] T011 Real check of the extended AI prompt on one model (owner's go-ahead 2026-10-22; Claude haiku, 1 prompt; `scripts/themegen-real.ts`; see spec Evidence)
- [x] T012 Parser takes `transparent` and the space form `rgb(r g b / a)` the prompt's defaults show (found by T011) [FR-031]
- [x] T013 Review on #500: `theme.js` `CONTRAST_PAIRS` mirrors #515's three button-text pairs; merge main and lower the literal ratchet [FR-021]
- [x] T014 Review on #500: minimal contrast fix that never changes a base surface; unit test with the dark fixture plus a dim `--muted` and a dim `--sage-ink` (stays dark, every pair passes) [FR-023, D4]
- [x] T015 Review on #500: test that every built-in theme is applied as designed (`setTheme`, `token`) [FR-021]
- [x] T016 Review on #500: AI dialog counts colours apart from fonts and shapes, and its preview shows the adjusted count; Settings note wording [FR-022, FR-024, FR-025]
- [x] T017 Merge of main (with #530, #508 popovers) on 2026-10-22: the remaining `#e5be78` border literals in `styles.css` and `screens.css` (toast, mode-chip restored tag, warn button, mode-menu why, answer bar, notice strip, inbox button, setup dialog tags) use `var(--tone-warn-line)`, as #530 did for `#e3bdb7` (Ruben on #530); the ratchet is regenerated: styles.css 156 -> 127, screens.css 16 -> 14, themes.css 52 -> 51; app.js 15 -> 17 (main's two literals since the last count, not this PR's); `check:geometry` keeps Pink Studio in its every-theme list (nightly, `CHECK_ALL_THEMES=1`; pull requests run Retro only, spec 008 FR-111, owner decision) [FR-041]

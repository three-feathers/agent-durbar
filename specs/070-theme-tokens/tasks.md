# Tasks: Full theme tokens (spec 070)

## Phase 1 (PR: 070-theme-tokens)

- [x] T001 Registry, grammars and font allow-list in `theme.js`; non-colour tokens set only when given; cap 200 tokens [FR-001..FR-004]
- [x] T002 `src/shared/themetokens.ts` mirror; `checkUserManifest` drops bad tokens one by one and returns them; equivalence test [FR-002, FR-020]
- [x] T003 Contrast pairs fall back as pairs when a theme is applied; `THEME.fallbacks(id)`; Settings card note; unit tests [FR-021, FR-022]
- [x] T004 `figures` (shirts, hairs) on desks, helper tiles, walkers and chips, every kit; skins unchanged; unit tests [FR-010]
- [x] T005 `gadget-cup` and `gadget-laptop` slots in the office scene and every kit; 8,000-character cap per slot; unit tests [FR-011]
- [x] T006 CSS reads `--font-mono`, `--shadow-card`, `--shadow-pop`, `--t1-weight` (defaults unchanged) [FR-001]
- [x] T007 AI maker prompt and parser for the typed tokens, figures and gadgets; per-token warnings; `test:themegen` [FR-030]
- [x] T008 `test:theme-tokens` guard with the ratchet `scripts/fixtures/theme-literals.json` [FR-040]
- [x] T009 *Pink Studio* fixture (and `check:geometry` now runs it too, as `pink-studio`) gains fonts, radii, shadows, figures and gadgets; `check:theme-art` asserts them (shirts on desks, walkers, chips; cup; computed font, radius, shadow); `check:geometry` with it; screenshots 1440x900 and 1280x800 [SC-001]
- [x] T010 Docs: README *Your own themes*, CHANGELOG, specs index, agent notes

## Phase 2 (later PRs)

- [ ] T020 Move the remaining colour literals of `styles.css`, `screens.css` and `themes.css` onto tokens, file by file, lowering the ratchet [FR-041]
- [ ] T021 (owner decision) Bundled font files in a pack (D1)
- [ ] T011 Real check of the extended AI prompt on one model (needs the owner's go-ahead: 1-3 prompts)

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
- [x] T018 Review on #500 (Paco's agent): allow-lists looked up by own property in both copies (`constructor`, `__proto__`, `toString`, `hasOwnProperty` as fonts and keys); one test per part of `HOSTILE_RE` and the renderer's rule pinned to main's; spec wording (Story 1 `--shadow-pop` covers menus and popovers, Story 3, SC-002, FR-020 unknown `--names`) [FR-020]

## Phase 3 (2026-11-01, design sweep; FR-051..FR-059). PRs, gates and line-count goals: spec 005 `plan.md`

- [ ] T022 [PR A1] `tools/inventory.js` to `scripts/inventory.js`, baseline fixture, `--check` in `test:theme-tokens`; office selectors counted apart; no visual change. Measure first: commit real counts against 386, 114, 221; 570, 291, 344; 305; 127; 99. Test: a planted literal of each kind fails; a lower count fails until lowered [FR-054]
- [ ] T023 [PR A2] `--wb-*` and the closed list in the registry, both copies; `WORLD_PAIRS` in the shared contrast check. Measure first: a fixture pack proves the drop on `main`. Test: 0 dropped, repaired pair, tier 3 name in a pack refused. Coordinate with spec 102 [FR-052, FR-053]
- [ ] T024 [PR A4] Tier 3 for the switch and buttons, `--accent` aliases; `check:perf`'s world switch row unchanged. Test: `test:theme-tokens`, `.swt.on` turns with the world in `check-ui-text` [FR-051, FR-057]
- [ ] T025 [PR A7] Four pop values and the overlay become tokens, 34 shadows on screen to 4, dialog shadow per FR-001's note. Test: `check-ui-text`, `check:office` [FR-055]
- [ ] T026 [PR A8] Type scale in the chrome: 14 sizes to 6, 8 weights to 3, `--t1`/`--t2` 650 to 600; design rules and FR-098 changed in place. 600 only where emphasis is meant, knowing 500 can read as 400 where a system has only Regular and Bold. Test: `check-ui-text` measured rule, `check:geometry`, screenshots at both sizes in Flat and Photo [FR-055, FR-058]
- [ ] T027 [PR A9] Control heights: 7 to 32, 28, 24 icon, 22 switch (`.seg` 26, selects 19/26/30, inputs 28/30); design rule 1. Test: `check-ui-text`, top bar fit at 1280 [FR-055]
- [ ] T028 [PR A10] Radii onto 6, 10, 14, 18, pill, circle, in the chrome; design rule 2. Test: `check-ui-text`, ratchet [FR-055]
- [ ] T029 [PR A11] `src/renderer/ui.js` and first dialogs; `@layer` only after the literals settle, tried first. Test: drivers of the moved dialogs; ratchet on button class sets [FR-056]
- [ ] T030 [PR A12] The owner accepted keeping the font (2026-11-01); this only settles smoothing. A real Mac at 2x and at 1x: `-webkit-font-smoothing` `antialiased` against `auto`; the Mac owner picks; one line in `styles.css`. Test: `test-macos` pins the choice; `real:` the owner's look, no AI credits [FR-058]
- [x] T031 Font decision: compared in the simulator, keep the system stack, no bundled font, reasons and limits in the spec [FR-058, FR-059]

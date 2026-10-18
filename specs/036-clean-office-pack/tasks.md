# Tasks: Clean Office pack (spec 036)

- [x] T001 Census + tokens: extend `CLEAN_TOKENS`; tokenize `scene()`, `avatar()`, `hairFront()`, `badgeSVG`, `PLANT`, `DOOR_*`, `SIREN`, `linksSVG`, `ICON`, `modeIcon`
- [x] T002 Tokenize `styles.css` theme-relevant literals (tints, walls, pills, brand, focus, avatars, drop overlay)
- [x] T003 Scene words: place names, lobby and door wording via `THEME.word()`; `data-place`/`data-key` ids on away desks; `shots-024.js` reads data ids
- [x] T004 Motion presets in the manifest + reduced-motion honoured at switch time
- [x] T005 `DURBAR_THEME` dev hook seeds the theme; `check:themes` runs the office check per built-in theme
- [x] T006 `test:theme` extended (per-pack defaults, fallback, word maps, sanitization regression)
- [x] T007 Verify byte-identical Clean Office scenes; run all gates (2026-10-18: pixel comparison against `main` with animations frozen, 0 px at 1280x800, noise only at 1440x900)
- [ ] T008 Stage D verification (PR #137): Clean Office omits every new art slot; renderer strings byte-identical to 486416e (62/62 across demo agents, densities, doors) — scripts/parity not added; verified with a one-off harness

## Changes 2026-10-18

- [x] T009 `theme=` in simulator runs (main, simulator bridge), `check-office-overlap.js` passes it and fails on a theme mismatch; re-run `check:themes` for every built-in theme and record the result [FR-005] (2026-10-18, CI fonts DejaVu/Liberation: clean-office, corporate, retro, durbar-indian, durbar-european, durbar-japanese and the sample user theme each 183/183, theme confirmed on screen in every run)

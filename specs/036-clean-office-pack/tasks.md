# Tasks: Clean Office pack (spec 036)

- [ ] T001 Census + tokens: extend `CLEAN_TOKENS`; tokenize `scene()`, `avatar()`, `hairFront()`, `badgeSVG`, `PLANT`, `DOOR_*`, `SIREN`, `linksSVG`, `ICON`, `modeIcon`
- [ ] T002 Tokenize `styles.css` theme-relevant literals (tints, walls, pills, brand, focus, avatars, drop overlay)
- [ ] T003 Scene words: place names, lobby and door wording via `THEME.word()`; `data-place`/`data-key` ids on away desks; `shots-024.js` reads data ids
- [ ] T004 Motion presets in the manifest + reduced-motion honoured at switch time
- [ ] T005 `DURBAR_THEME` dev hook seeds the theme; `check:themes` runs the office check per built-in theme
- [ ] T006 `test:theme` extended (per-pack defaults, fallback, word maps, sanitization regression)
- [ ] T007 Verify byte-identical Clean Office scenes; run all gates
- [ ] T008 Stage D verification (PR #137): Clean Office omits every new art slot; renderer strings byte-identical to 486416e (62/62 across demo agents, densities, doors) — scripts/parity not added; verified with a one-off harness

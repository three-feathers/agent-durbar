# Tasks: 101 Logo family

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: required (constitution VII; SC-001..SC-005). Node tests and the simulator only; 0 AI credits. Driver waits use `until()`, never a fixed sleep.

**Format**: `- [ ] Tnnn [P?] [USn?] description (file) [requirements]`, then a `Test:` line. A phase = one PR. Numbers taken: spec 101, FR-010..FR-102 (sparse by group), T001..T043.

## Phase 0: Spec (this PR)

- [x] T001 Spec, plan, tasks and specs-index block (`specs/101-logo-family/`). Test: `npm run specs:check`, `npm run rules:check`.
- [x] T002 Pointer in spec 008 (`## Changes`). Test: `read:`.
- [ ] T003 Owner answers Q1, Q2, Q3, Q7 recorded here as dated clarifications. Test: `read:`, needed before P1 and P2.

## Phase 1: Icon 1 everywhere (PR P1) - US1

- [ ] T010 [US1] Masters of icon 1 and `build/logo/ASSETS.md` [FR-010..FR-014, FR-060..FR-062]. Test: `test:logo-assets` slots, forbidden list, provenance row; red on a fixture with an `<image>` and on one with no row.
- [ ] T011 [US1] `scripts/test-logo-assets.ts` + `test:logo-assets` in `npm test` (`package.json`, `scripts/run-tests.js` limits) [FR-071]. Test: its own fixtures, including the cave row with no `Paco`.
- [ ] T012 [US1] `scripts/build-icons.js`, `npm run icons:build`; regenerate `build/icon.{svg,png,ico,icns}`; `build/logo/icons.json` [FR-040..FR-043]. Test: `test:logo-assets` decodes every ICO and ICNS entry at its size and checks hashes; a mutated source goes red.
- [ ] T013 [US1] Delete `build/icon-16.svg` [FR-044]. Test: `test:logo-assets` asserts it is gone; `git grep icon-16` empty.
- [ ] T014 [US1] Top bar: icon 1 inline at 20 px, `--logo-*` tokens, slot fills, the flat rules, forced colours (`index.html`, `styles.css`, `themes.css`) [FR-030..FR-032, FR-034..FR-036]. Test: `test:theme-tokens` ratchet not raised; driver T015.
- [ ] T015 [US1] `scripts/check-logo-family.js`, flat part: Clean, every built-in theme, a generated theme, forced colours, 1440x900 and 1280x800; no `<img>` in the tile, tile size and `h1` position unchanged [FR-072]. Test: the driver in `ui-suite.js`; mutation: a raised tile size goes red.
- [ ] T016 [US1] Linux window icon unchanged in code, new in picture; no `setIcon` call added [FR-037]. Test: driver asserts the call site; `read:` on a real desktop by an owner of each OS (`[KNOWN GAP]` until then).
- [ ] T017 [P] [US1] README alt text; site favicon and brand, `pages.yml` filter [FR-050, FR-051]. Test: `test:site` under 8 MB.
- [ ] T018 [US1] Retake linked pictures, `npm run shots:docs`, both sizes, looked at [FR-052]. Test: `shots-docs` coverage check, `test:site`.
- [ ] T019 [P] [US1] Changelog fragment, README Settings text, docs pages [FR-053, FR-054]. Test: `npm run changelog:check`, *Docs check*.

## Phase 2: Picker (PR P2) - US2

- [ ] T020 [US2] Masters of icons 2, 3, 5 and their rows; `src/renderer/logo-marks.js` from the build script [FR-010..FR-013, FR-060]. Test: `test:logo-assets` covers all four and that the JS matches `build/logo`.
- [ ] T021 [US2] Settings > Logo, `data-logo`, `durbar.logo`, early apply [FR-020..FR-022]. Test: driver: pick, reload, bad value, blocked `localStorage`, keyboard, names.
- [ ] T022 [US2] Vector previews in the current palette [FR-023]. Test: driver reads each preview; 64 px in both window sizes, no overlap.
- [ ] T023 [US2] The Dock, window and icon files do not follow the choice [FR-037]. Test: driver: window icon call count unchanged after a pick.

## Phase 3: World palettes (PR P3, after 097 P1 and its worlds delta) - US3

- [ ] T030 [US3] Photo palette in `worlds/photo` chrome tokens, FR-033's fallback [FR-033, FR-035, FR-101]. Test: `test:logo-assets` contrast; driver: top bar in the photo world, each icon, both sizes, `<img>` count 0.
- [ ] T031 [US3] A world with no approved palette falls back to base [FR-033]. Test: driver with a world lacking the tokens.
- [ ] T032 [US3] Cave and loft palettes, **only after Paco's written approval** (Q6) [FR-062, FR-102]. Test: `test:logo-assets` requires `Paco` in `approved by`; driver: both worlds.

## Phase 4: Painted previews (PR P4)

- [ ] T040 Photo previews: mask, resize, WebP, rows [FR-024, FR-060, FR-063], after Q4. Test: `test:logo-assets` caps, alpha, no metadata, `webpInfo`.
- [ ] T041 Picker shows painted, falls back to vector [FR-023]. Test: driver with one file missing.
- [ ] T042 Cave and loft previews, **only after Paco's approval** (Q6). Test: as T040, with the approval rule.
- [ ] T043 `/speckit.converge`; status and index updated. Test: `npm run specs:check`.

# Tasks: Theme foundation (spec 035)

- [x] T001 Write spec 035: manifest schema, token map, art slots, sanitization, settings hook, scene cache (FR-001..FR-008)
- [x] T002 Implement `src/renderer/theme.js` with Clean Office default tokens, slots, and manifest loader
- [x] T003 Apply CSS custom properties from active token map; update `styles.css` to use `var(--*)` for theme-relevant colours
- [x] T004 Refactor `scene()` in `app.js` to assemble figure from art slots; keep Clean Office output identical
- [x] T005 Add `theme` to settings store; call `setTheme()` on startup and `settings:changed`
- [x] T006 Add `themeId` to `SC_CACHE` key
- [x] T007 Write `scripts/test-theme.ts` covering manifest validation, token fallback, slot sanitization, unknown theme fallback
- [x] T008 Run `npm run typecheck`, `npm test`, `npm run check:office` at 1440x900 and 1280x800 (done in PR #137: typecheck, tests and `check:office` at both sizes passed in CI)
- [x] T009 Update `specs/README.md`, `CHANGELOG.md` Unreleased
- [x] T010 Open PR, request review, merge when green (PR #137, merged 2026-10-18)

## Changes 2026-10-18 (owner review of PR #137)

- [x] T011 `ui` in the manifest (renderer and main validation), `data-ui` on `<html>`, app-owned `themes.css`; a test that `themes.css` sets no size [FR-009, FR-010, FR-011]
- [x] T012 Opaque `+N more` chip and lobby tiles above the art layers [FR-012]
- [x] T014 Scene kits: `scene` in the manifest (renderer and main validation), `scenekits.js` with five kits, the office kit unchanged; `test:scenekits` (every kit, status, mood and look is valid SVG and keeps its cues) [FR-013]
- [x] T015 Built-in packs carry no overlay slots their kits do not draw (25 entries removed, plus the never-drawn `chair-back`/`desk`/`monitor` defaults); overlay tests use a fixture user pack on the office kit; art keys limited to the slots the renderer draws (spec 040 FR-010)
- [ ] T013 Owner review of the five looks (screenshots in PR #137)
- [x] T016 Fix three asserts that could not fail: default cell size value, link-write refusal always checked, hook/sanitizer counts across renders (issue #749) [FR-014]

## Changes 2026-10-25 (issue #747)

- [x] T017 `test:theme` checks `themes.css` against a property allow-list (flex, transform, position/top/left, custom properties were not caught) and has mutation cases [FR-015]

## Changes 2026-10-28 (spec 077, issue #814)

- [x] T018 A theme's `scene` is its own characters; Settings > Characters replaces it on any theme (built and tested under spec 077 T077..T082) [FR-016]

## Changes 2026-10-31 (owner decision, spec 021 FR-067): built-in Corporate and court themes removed

All in one PR (spec 021 FR-068). Do not start before T053 of spec 021 if the spec statuses are to be set in it.

- [ ] T083 Code: FR-017's list. Test: `test:theme`, `test:scenekits`, `test:themegen`, `test:userthemes`, `test:characters`, `test:ui-suite`; `git grep` for the removed ids finds only the migration and reserved list [FR-017]
- [ ] T084 Migration and fallback. Test: `test:userthemes`, `test:theme`: each removed id clears once and writes; repeat changes nothing; a saved theme with `ui: court-indian` and `scene: corporate` draws clean and office with a note; a mutant skipping the write fails; `sim:` start with each stored id [FR-018]
- [ ] T085 Tests and drivers: `scripts/check-theme-art.js`, `check-theme-geometry.js`, `check-ui-text.js`, `check-composer-toolbar.js`, `check-sched-top.js`, `check-status-tooltip.js`, `check-characters.js`, `check-parallel.js`, `shots-017-signs.js`, `shots-052-addleft.js`, `shots-docs.js`, `scripts/fixtures/themes/check-user.json`, `.github/workflows/ci.yml`'s theme matrix. Test: the suite; no check loses coverage of Clean or Retro [FR-017]
- [ ] T086 Docs: `docs/themes.md`, `docs/features.md`, `docs/feature-history.md`'s pictures, README, `docs/site/gallery.json`, `docs/site/landing.json`, `scripts/test-site.js`'s "six themes"; screenshots `035-corporate-*`, `035-durbar-*`, `site-theme-corporate-*`, `site-theme-durbar-*` deleted; `npm run shots:docs` and a look. Test: `test-site`, `test:docsscripts` [FR-017]
- [ ] T087 Changelog fragment saying what went and where saved choices went. Test: `npm run changelog:check` [FR-017]
- [ ] T088 Spec statuses, notes and pointers in 037, 039, 036; "all 6 themes" wording in 017, 070 updated. Test: `npm run specs:check` [FR-020]
- [ ] T089 Retro Pixel leaves the Themes list, in one PR with spec 102 T115 and T122 (spec 102 T230), not before; tests, drivers, docs, screenshots, changelog fragment, spec 038 `superseded` with a note. Its tokens, `retro` UI style, art, `pixel` kit, words and motion stay as spec 102 FR-271's look; the migration is spec 102 T227 and coverage moves by spec 102 T226. Test: `test:theme`, `test:userthemes`, a stored `retro` moves once and looks the same in Flat (spec 102 T233); `test-site` [FR-019]

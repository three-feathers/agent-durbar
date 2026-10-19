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

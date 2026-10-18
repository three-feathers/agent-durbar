# Tasks: Theme foundation (spec 035)

- [ ] T001 Write spec 035: manifest schema, token map, art slots, sanitization, settings hook, scene cache (FR-001..FR-008)
- [ ] T002 Implement `src/renderer/theme.js` with Clean Office default tokens, slots, and manifest loader
- [ ] T003 Apply CSS custom properties from active token map; update `styles.css` to use `var(--*)` for theme-relevant colours
- [ ] T004 Refactor `scene()` in `app.js` to assemble figure from art slots; keep Clean Office output identical
- [ ] T005 Add `theme` to settings store; call `setTheme()` on startup and `settings:changed`
- [ ] T006 Add `themeId` to `SC_CACHE` key
- [ ] T007 Write `scripts/test-theme.ts` covering manifest validation, token fallback, slot sanitization, unknown theme fallback
- [ ] T008 Run `npm run typecheck`, `npm test`, `npm run check:office` at 1440x900 and 1280x800
- [ ] T009 Update `specs/README.md`, `CHANGELOG.md` Unreleased
- [ ] T010 Open PR, request review, merge when green

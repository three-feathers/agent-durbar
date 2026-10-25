# Tasks: Project website (050)

- [x] T001 `scripts/build-site.js` from the README, the specs index, the gallery list, the CHANGELOG and the latest release [FR-001, FR-002, FR-003]
- [x] T002 `scripts/test-site.js` in `npm test` [FR-005]
- [x] T003 `.github/workflows/pages.yml`, actions pinned by SHA, deploy only from `main` [FR-004]
- [x] T004 Pages enabled (GitHub Actions source) with the owner's approval; README and CHANGELOG link to the site
- [ ] T010 (later) One page per built spec; an automatic screenshot refresh; a custom domain (owner)

## 2026-10-20: landing page and docs page

- [x] T020 `docs/site/landing.json` (hero, status, cards, steps, themes, agent apps, safety, `featuresExclude`) and its validation in `scripts/build-site.js`, failing the build on a bad anchor, a missing screenshot or an unknown harness [FR-007]
- [x] T021 `index.html` as the curated landing page, with the designer's tokens, dark mode, divider and phone layout [FR-006, FR-008, FR-009]
- [x] T022 `docs.html`: the whole README with a table of contents, the feature grid (process specs left out), the gallery and the full release notes [FR-006]
- [x] T023 `scripts/test-site.js` extended for both pages and the validation function [FR-010]
- [x] T024 `docs/site/gallery.json` leads with the current office screenshot; spec, tasks, specs index and CHANGELOG updated
- [x] T025 Screenshots of both pages at desktop and phone width, and the phone height target (lead, before merge) [FR-009]
- [x] T026 (2026-10-26) the site size budget is 16 MB in `scripts/test-site.js`, with the reason and a `[KNOWN GAP]` for uncompressed screenshots [FR-011]

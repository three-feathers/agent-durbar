# Tasks: Office view, densities, list view and filters

**Input**: [spec.md](spec.md), [plan.md](plan.md). Completed tasks are what the code already does (checked against it on 2026-10-16); open tasks are gaps.

## Done (as built)

- [x] T001 Office floor with rooms per folder and desk per agent (`src/renderer/app.js` roomHTML/unitHTML) [FR-001]
- [x] T002 Densities `full/roomy/card/mini/micro` and probe-based `chooseLayout` with cache [FR-002, FR-003]
- [x] T003 Desk scenes per status and status words/badges (never colour alone) [FR-006]
- [x] T004 Waiting/error-first sorting in rooms and helper strips [FR-007]
- [x] T005 Status pills with counts and filter; folder filter dropdown [FR-008]
- [x] T006 Helper strip with 1/3 helpers, `+N more` expand in place, boost with leftover space [FR-009]
- [x] T007 List view [FR-010]
- [x] T008 Keyed DOM morphing so only changed agents update [FR-011]
- [x] T009 CSS-only animation in compact scenes, `prefers-reduced-motion` [FR-012]
- [x] T010 Demo data toggle [FR-013]
- [x] T011 Minimum font size 10.5px in CSS [FR-004]
- [x] T012 Screenshots for 12/15 agents at 1440x900 and 1280x800, closed and chat open (`docs/screenshots/m2..m5-*`)
- [x] T013 Re-measure densities, overflow and min font headless on 2026-10-16 (see plan "Verification status")

## Open

- [ ] T020 Automate the office checks: a `scripts/` check (Electron under xvfb or a DOM harness) asserting, for SIM=12 and 15 at 1440x900 and 1280x800, no page/floor overflow and min font >= 10.5px; run it in CI on Linux. [FR-015, constitution V]
- [ ] T021 Resolve the README/measurement drift for SIM=15 @1280x800 closed (`card` documented vs `mini` measured): re-check, then fix README or the layout search. [FR-016]
- [ ] T022 Improve `micro` helper figures and nameplate truncation when narrow. [FR-017]
- [ ] T023 Keyboard navigation between desks (arrow keys), with a spec delta first. [FR-019]
- [ ] T024 Hand-check the office on macOS and Windows and record it here. [VI]

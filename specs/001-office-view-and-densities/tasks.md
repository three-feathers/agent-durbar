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

- [x] T020 (overlap/clipping, floor overflow and the 10.5px minimum are checked; runs in CI as `office-check`) Automate the office checks: a `scripts/` check (Electron under xvfb or a DOM harness) asserting, for SIM=12 and 15 at 1440x900 and 1280x800, no page/floor overflow and min font >= 10.5px; run it in CI on Linux. [FR-015, constitution V]
- [x] T021 Resolve the README/measurement drift for SIM=15 @1280x800 closed (`card` documented vs `mini` measured): re-check, then fix README or the layout search. [FR-016]
- [ ] T022 Improve `micro` helper figures and nameplate truncation when narrow. [FR-017]
- [ ] T023 Keyboard navigation between desks (arrow keys), with a spec delta first. [FR-019]
- [ ] T024 Hand-check the office on macOS and Windows and record it here. [VI]
- [x] T025 `scripts/check-office-overlap.js` + `npm run check:office`: Electron/xvfb driver; bounding-box intersection and clipping check between desk cards, helper tiles, more chips, helper strips and plates for SIM=12/15 x 1440x900/1280x800 x 0/1/3/all rooms closed x `?closed=` variants; optional screenshots (`OFFICE_SHOTS=dir`). [FR-021]
- [x] T026 Rename the helper strip class `strip` -> `hstrip` so the chat agent bar's `.strip` no longer applies. [FR-020]
- [x] T027 Layout search: candidate `full` with 2 helpers; helper cap per candidate for `full`. [FR-022]

## Changes 2026-10-18 (issue #126)

- [x] T028 Renderer shows a main agent's title in place of the folder name (cards, chat header, list, strip, lobby, toasts), folder in the tooltip and accessible name; simulator titles; `check:office`; screenshots at 1440x900 and 1280x800

## Changes 2026-10-18 (one-agent folders)

- [x] T029 Room headers adapt to their width (container queries: name ellipsis, plant and MCP button in narrow headers, credit total to the tooltip under 280 px) [FR-023]
- [x] T030 `check:office`: `simrooms=solo` combinations and a header overlap check in every combination; screenshots at 1440x900 and 1280x800 [FR-024]

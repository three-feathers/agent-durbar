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
- [x] T023 Keyboard navigation between desks (arrow keys), with a spec delta first. [FR-019]
- [x] T024 Hand-check the office on macOS and Windows and record it here. [VI] (`real:` 2026-10-21, owner (Vikram) hand-check, closed by the owner's decision: macOS in daily use; Windows looked at with a colleague on 2026-10-21. Findings filed from that Windows session: #467 (Settings > Agent apps offered no install option; Copilot was not detected or installable without Node.js; PowerShell/winget commands in PR #469) and the MCP sign-in sharing (#471, merged; real check in PR #478). Not covered: no scripted checklist was recorded (15 agents, 1440x900/1280x800, overlap, 10.5px, fonts, window chrome were not measured item by item on these machines), and `docs/screenshots/` has no screenshots from a real Mac or Windows PC; see the spec's Changes, 2026-10-21 *owner hand-check*.)
- [x] T025 `scripts/check-office-overlap.js` + `npm run check:office`: Electron/xvfb driver; bounding-box intersection and clipping check between desk cards, helper tiles, more chips, helper strips and plates for SIM=12/15 x 1440x900/1280x800 x 0/1/3/all rooms closed x `?closed=` variants; optional screenshots (`OFFICE_SHOTS=dir`). [FR-021]
- [x] T026 Rename the helper strip class `strip` -> `hstrip` so the chat agent bar's `.strip` no longer applies. [FR-020]
- [x] T027 Layout search: candidate `full` with 2 helpers; helper cap per candidate for `full`. [FR-022]

## Changes 2026-10-18 (issue #126)

- [x] T028 Renderer shows a main agent's title in place of the folder name (cards, chat header, list, strip, lobby, toasts), folder in the tooltip and accessible name; simulator titles; `check:office`; screenshots at 1440x900 and 1280x800

## Changes 2026-10-18 (one-agent folders)

- [x] T029 Room headers adapt to their width (container queries: name ellipsis, plant and MCP button in narrow headers, credit total to the tooltip under 280 px) [FR-023]
- [x] T030 `check:office`: `simrooms=solo` combinations and a header overlap check in every combination; screenshots at 1440x900 and 1280x800 [FR-024]
- [x] T031 Name and status word share the line in `mini`/`micro` (the status shrinks first; the name has a max width); `check:office` name check [FR-025]

## Changes 2026-10-19 (first run)

- [x] T032 Welcome card for an empty office; screenshots [FR-026]
- [x] T033 (2026-10-19) Positioning: many harnesses, anyone with agents (welcome card, About agent kinds, README, package.json, repo description) [FR-027]

## Changes 2026-10-21 (live activity on the desks)

- [x] T034 `src/renderer/liveact.js`: readout rules (latest sentence of thinking or reply, tool verb phrase, Simple words), masking through `dist/shared/redact.js`, per-agent throttle (<= 4/s); `scripts/test-liveact.ts` + `npm run test:liveact` [FR-028, FR-030, FR-031]
- [x] T035 `app.js`: feed the readout from `onLiveEvent` (main agents only), clear it at turn end; show it in the `full` `.task` / card `.intent` line while busy; repaint by `textContent` at most 4/s [FR-028, FR-029, FR-030]
- [x] T036 Layout search: `full` candidates with a side panel first (fixed width, reserved per main desk), only when it fits; layout key follows the setting; `styles.css` with theme tokens [FR-029, FR-030]
- [x] T037 Settings > General: *Live activity on desks* switch (default on, `localStorage`) [FR-032]
- [x] T038 `scripts/shots-001-live-activity.js`: simulator driver and screenshots at 1440x900 and 1280x800, dense (15) and sparse (3); `check:office`, `check:geometry`; README, CHANGELOG, specs index [FR-029]

## Changes 2026-10-22 (grown desks when there are few agents, owner)

- [x] T057 `src/renderer/probe.js` (`GROW`, `largest`, `better`, `pick`) and their cases in `scripts/test-probe.ts` (`npm run test:probe`) (synthetic fit tests; box model with 1, 2, 4, 6, 10, 15 agents in 1-3 folders at 1280x800, 1440x900, 1920x1080) [FR-041, FR-042, FR-046]
- [x] T058 `chooseLayout`: grow search after the candidates (after `full` or `roomy`, at f >= 1.1; never `card`/`mini`/`micro` or a forced density); `renderOffice` sets `--gf` and `data-grow`; helper boost after [FR-041, FR-042, FR-044]
- [x] T059 Grown card text: `liveact.js` `long` readout (+ `test:liveact` cases); `deskLine` grown text (readout, last reply excerpt masked, task); `fitSide` on grown text lines after render and paint; `styles.css` grown rules (height, widths, two-line title, max 8 lines, fade) [FR-043, FR-045]
- [x] T060 `sim.ts` `simrooms=1..5`, `simhelpers=0`; `scripts/check-office-fill.js` driver + `npm run check:office-fill` + `scripts/ui-suite.js`; `shots-001-live-activity.js` forces `full` for the side-panel part [FR-046]
- [x] T061 `check:office`, `check:geometry`, `npm test`; screenshots `docs/screenshots/001-fill-{4,6,15}-{1440x900,1280x800}.png` (simulator); README office section, CHANGELOG, `specs/README.md` [FR-045, FR-046]
- [ ] T062 (review of #532) `liveact.js` `excerpt(raw, redact)`: mask the raw reply, then `plain`, then cut; `grownLine` uses it and fails closed (`Finished.`) without `redact`; `test:liveact` token cases (ghp_, github_pat_, sk-, Bearer; plain, backticks, bold, underscores, code block, link) [FR-043]
- [ ] T063 (review of #532) `src/shared/redact.ts`: key-shape patterns anchored on "no letter or digit before" instead of `\b`; `test:redact` underscore-wrapped cases [FR-043; spec 012 FR-080]
- [ ] T064 (review of #532) `liveact.js`: `long` computed lazily in `of()`; `chooseLayout` starts with `GROW=0`; `test:probe` source check [FR-042, FR-043]
- [ ] T065 (review of #532) `check:office-fill`: `ghp_` and `github_pat_` tokens in the done reply; FR-042, README and CHANGELOG say *f* may drop several steps at once [FR-042, FR-046]

## Changes 2026-10-21 (layout speed, PR #457 finding)

- [x] T039 `src/renderer/probe.js` (`svgHollow`, `styleSplit`), `probeSet` in `chooseLayout`, `@property` for `--w`/`--min`/`--cols` in `styles.css`; `scripts/test-probe.ts` (`npm run test:probe`) [FR-033]
- [x] T040 Before/after timing and a layout comparison over 54 cases on the simulator; `check:office`, `check:geometry`, `shots-033`; spec 001 and 033 Verification, `specs/README.md`, CHANGELOG, `docs/agent-notes.md` [SC-004]

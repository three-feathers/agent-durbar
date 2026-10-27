# Tasks: 092 floors as places

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: required by the constitution (VII.3) and SC-001..SC-007. All on the simulator or in Node; 0 AI credits. Waits in drivers use `until()`.

**Format**: `- [ ] Tnnn [P?] [USn?] description (file) [requirements]`. `[P]` = can run in parallel. One task = one small testable step; a phase = one PR.


## Phase 0: Spec (this PR)

- [x] T001 Spec, plan, tasks and specs-index block committed; 033 `## Changes` cross-reference (FR-011, FR-012 refined by 092) (`specs/092-floors-as-places/`)
- [x] T001a (2026-10-27: Paco chose a and a) Owner answers Q-A (top of the building) and Q-B (button labels) on issue #782 before Phase 1 and Phase 2 start (defaults: a and a)

## Phase 1: Floor screens (PR 1)

- [ ] T002 [P] Pure module `src/renderer/floornav.js`: `nextOn(floors, cur, dir)`, `nearestOn(floors, cur)`, `keyEligible(event, target)`, `announceText(floor, n, m)`; UMD like `places.js` [FR-011, FR-012, FR-023, FR-025]
- [ ] T003 [P] `scripts/test-floornav.ts` and `test:floornav` in `package.json` (and the `npm test` list): skip off floors, no wrap, nearest after off/delete, eligibility (text field, textarea, select, contenteditable, dialog, menu, palette, modifier keys), announcement text [FR-011, FR-012, FR-023, FR-025]
- [ ] T004 Current floor in `app.js`: variable, restore from and save to `localStorage`, fallback to the first floor on, always a floor that is on while two or more are on; none with fewer than two [FR-004, FR-022, FR-023]
- [ ] T005 `officeModel()` keeps only rooms of the current floor when two or more floors are on; add the current floor id to `layoutKey`; floor tags stay [FR-001, FR-002, FR-005]
- [ ] T006 Empty-floor state: a short line naming the floor and how to move a folder there, plus the lobby; reuse the existing empty-state markup (`renderOffice`, `app.js:1573-1575`) [FR-001; edge case 0 agents]
- [ ] T007 `afterFloorsChange`: when the current floor goes off, is deleted or reordered, move to the nearest on floor without animation and announce; switching on, creating, moving a folder do not move the user; Only makes the chosen floor current [FR-023, FR-012]
- [ ] T008 Lobby: visitors of all floors that are on in every floor screen; a visitor of another floor has no walk and its floor in the tile label (`places.js` `placeVisitors` call site, walker code `app.js:414-487`) [FR-020, FR-021]
- [ ] T009 PageUp/PageDown handler in the office view using `floornav.keyEligible`; instant change; one `announce()`; nothing at the ends [FR-011, FR-012]
- [ ] T010 Simulator: `DURBAR_SIM_FLOORS=1` seeds at least three floors on with the 15 agents spread, plus a variant with all 15 on one floor (`src/renderer/sim.ts`, `src/main/main.ts`) [FR-002; SC-001]
- [ ] T011 `check:office` floor-screen cases: each floor passes at 1440x900 and 1280x800; single-floor results unchanged (`scripts/check-office-overlap.js`) [SC-001, SC-006]
- [ ] T012 Driver `scripts/shots-092.js` phase-1 cases: one floor drawn, keys change floor, ends do nothing, keys ignored in the composer, current floor survives a reload, off floor fallback; screenshots at both sizes [US1, US3; SC-005]
- [ ] T013 Spec housekeeping: tick tasks, `[IMPLEMENTED]` tags, 033 `## Changes` stays, `changelog.d/092-p1.md` [FR-026]

## Phase 2: Lift panel and badges (PR 2)

- [ ] T014 [P] `floornav.js`: `badgeCounts(agents, floorOf, needs)` (each agent once, kinds waiting/error/limit/new reply) and `badgeText(counts)` ('2 waiting, 1 error'), `9+` rule; extend `test-floornav.ts` [FR-014, FR-015]
- [ ] T015 Lift host in `index.html` and render in `app.js` (`renderLift`): toolbar, one button per floor on, number label, accessible name, tooltip, `aria-current`, roving tabindex, Up/Down/Home/End/Enter/Space; shown only with two or more floors on and in the office view [FR-006, FR-007, FR-013]
- [ ] T016 Styles in `styles.css`: panel, button (at least 28 px, 10.5 px text), current-floor shape cue, badge with count; tokens only (`test:theme`, `test:uisuite`) [FR-006, FR-007, FR-015]
- [ ] T017 Reserve the panel width in the office area only while shown and count it in `renderOffice` width (`aw`) and `layoutKey` [FR-008]
- [ ] T018 Badges: compute from `needsMeOrder()`, unread and coffee-break state per floor of the agent; none on the current floor; none for off floors; repaint on state change; no sound/toast/notification [FR-014, FR-015, FR-016]
- [ ] T019 Pills, inbox count, window title and usage total checked unchanged: test that the whole-building counts do not depend on the current floor [FR-017; US2]
- [ ] T020 `check:office` with the panel at both sizes; record the density cost at 1280x800 in the spec (turns the FR-008 gap into a result, or opens the owner question with the numbers) [FR-008; SC-001]
- [ ] T021 Driver cases: badge appears and clears, accessible names, roving focus, many floors scroll inside the panel; screenshots; `changelog.d/092-p2.md`; tick tasks [US2; SC-004]

## Phase 3: The slide (PR 3)

- [ ] T022 Two-floor mount during a slide: current plus target in a clipped container, others unmounted; focus order only for the visible floor [FR-003, FR-009]
- [ ] T023 Slide with `motion()`: translateY, 300 ms, ease-in-out; retarget on a new request; end at once on resize, relayout, theme change [FR-009]
- [ ] T024 Reduced motion read live with `reducedMotion()`: instant change, no fade; also when the setting flips while open [FR-010]
- [ ] T025 Walker layer and lobby while sliding: no walk is drawn; places placed at the end of the slide [FR-021; edge case walkers]
- [ ] T026 Timing check like 033 SC-003: ratio to a same-run yardstick, 15 agents, both sizes (`scripts/shots-092.js`) [SC-003]
- [ ] T027 Driver cases: slide runs about 300 ms, retarget, reduced-motion emulation instant; `changelog.d/092-p3.md`; tick tasks [US5]

## Phase 4: Jumps (PR 4)

- [ ] T028 `goToFloor(id, {animate})` in `app.js`: one entry point used by the lift, keys and the rest; no-op when the floor is current or off [FR-018]
- [ ] T029 `openPanel()` calls `goToFloor(agentFloor, {animate:false})` before the chat shows; covers inbox Open / Answer in chat, notification click (via inbox), list view, chat strip [FR-018; US4]
- [ ] T030 Folder filter and status-pill filter: choosing a room on another floor slides to it; a filter never changes the current floor by itself [FR-018; edge case filters]
- [ ] T031 Navigator: a floor row activates `goToFloor` and still narrows the folder list; folder and chat rows go to their floor first (`src/renderer/navigator.js`, `app.js` navigator actions); extend `test-navigator.ts` [FR-019]
- [ ] T032 Keyboard help rows for PageUp/PageDown (with the Mac Fn note) next to `app.js:3550` rows; update `test` that lists them if any [FR-011]
- [ ] T033 Driver cases: open from the inbox then Back shows that floor; navigator floor row slides; agent on an off floor does nothing; `changelog.d/092-p4.md`; tick tasks [US4; SC-007]

## Phase 5: Docs, screenshots, converge (PR 5)

- [ ] T034 README floors text and *Keyboard* list; `docs/` pages that describe floors or the office; feature history note [FR-026]
- [ ] T035 `npm run shots:docs` for every linked picture that shows the office (look at each); add a lift-panel picture to `docs/site/gallery.json` and `DOC_SHOTS` in `scripts/shots-docs.js` [FR-026]
- [ ] T036 033 `## Changes`: dated line saying FR-011 and FR-012 are refined by spec 092; `npm run specs:index` status of 092 [FR-026]
- [ ] T037 `/speckit-converge`: spec, plan, tasks match what was built; known gaps updated with what was measured; `npm run specs:check`, `npm run changelog:check` [FR-026]

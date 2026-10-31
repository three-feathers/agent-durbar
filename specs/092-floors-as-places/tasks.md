# Tasks: 092 floors as places

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: required by the constitution (VII.3) and SC-001..SC-007. All on the simulator or in Node; 0 AI credits. Waits in drivers use `until()`.

**Format**: `- [ ] Tnnn [P?] [USn?] description (file) [requirements]`. `[P]` = can run in parallel. One task = one small testable step; a phase = one PR.


## Phase 0: Spec (this PR)

- [x] T001 Spec, plan, tasks and specs-index block committed; 033 `## Changes` cross-reference (FR-011, FR-012 refined by 092) (`specs/092-floors-as-places/`); the dated `## Changes` lines in specs 001, 024, 052 and 074 are in the same commit (FR-029)
- [x] T001a (2026-10-27: Paco chose a and a) Owner answers Q-A (top of the building) and Q-B (button labels) on issue #782 before Phase 1 and Phase 2 start (defaults: a and a)

## Phase 1: Floor screens (PR 1)

- [x] T002 [P] Pure module `src/renderer/floornav.js`: `nextOn(floors, cur, dir)`, `nearestOn(floors, cur)`, `keyEligible(event, target, scroll)` (scroll = {scrolls, atTop, atBottom}), `announceText(floor, n, m)`; UMD like `places.js` [FR-011, FR-012, FR-023, FR-025]
- [x] T003 [P] `scripts/test-floornav.ts` and `test:floornav` in `package.json` (and the `npm test` list): skip off floors, no wrap, nearest after off/delete, eligibility incl. a scrolling floor screen (scrolls first, floor only from an edge) (text field, textarea, select, contenteditable, dialog, menu, palette, modifier keys), announcement text [FR-011, FR-012, FR-023, FR-025]
- [x] T004 Current floor in `app.js` variable, restore from and save to `localStorage`, fallback to the first floor on, always a floor that is on while two or more are on; none with fewer than two [FR-004, FR-022, FR-023]
- [x] T005 `officeModel()` keeps only rooms of the current floor when two or more floors are on; add the current floor id to `layoutKey`; floor tags stay [FR-001, FR-002, FR-005]
- [x] T006 Empty-floor state: a short line naming the floor and how to move a folder there, plus the lobby; reuse the existing empty-state markup (`renderOffice`, `app.js`) [FR-001; edge case 0 agents]
- [x] T007 `afterFloorsChange`: when the current floor goes off, is deleted or reordered, move to the nearest on floor without animation and announce; switching on, creating, moving a folder do not move the user; Only makes the chosen floor current [FR-023, FR-012]
- [x] T008 Lobby: visitors of all floors that are on in every floor screen; a visitor of another floor has no walk and its floor in the tile label (`places.js` `placeVisitors` call site, walker code `app.js`) [FR-020, FR-021]
- [x] T009 PageUp/PageDown handler in the office view using `floornav.keyEligible`; instant change; one `announce()`; nothing at the ends [FR-011, FR-012]
- [x] T038 Driver case for FR-011's scroll rule: a floor screen that scrolls (many agents, small window) scrolls on PageDown and changes floor only from the edge; the key is ignored in the composer [FR-011; US3]
- [x] T010 Simulator: `DURBAR_SIM_FLOORS=1` seeds at least three floors on with the 15 agents spread, plus a variant with all 15 on one floor (`src/renderer/sim.ts`, `src/main/main.ts`) [FR-002; SC-001] (built: `simfloors=1` already spread three floors; added `simfloors=ground` / `DURBAR_SIM_FLOORS=ground`: every folder on the Ground floor, the other two floors on and empty)
- [x] T011 `check:office` floor-screen cases: each floor passes at 1440x900 and 1280x800; single-floor results unchanged (`scripts/check-office-overlap.js`) [SC-001, SC-006]
- [x] T012 Driver `scripts/shots-092.js` phase-1 cases: one floor drawn, keys change floor, ends do nothing, keys ignored in the composer, current floor survives a reload, off floor fallback; screenshots at both sizes [US1, US3; SC-005]
- [x] T013 Spec housekeeping: tick tasks, `[IMPLEMENTED]` tags, 033 `## Changes` stays, `changelog.d/092-p1-floor-screens.md`; check FR-024 (no adapter, permission, IPC or storage change in this PR's diff) [FR-026]

## Phase 2: Lift panel, badges and the All floors view (PR 2)

- [x] T014 [P] `floornav.js`: `badgeCounts(agents, floorOf, needs)` (each agent once, kinds waiting/error/limit/new reply) and `badgeText(counts)` ('2 waiting, 1 error'), `9+` rule; extend `test-floornav.ts` [FR-014, FR-015]
- [x] T015 Lift host in `index.html` and render in `app.js` (`renderLift`): toolbar, one button per floor on, number label, accessible name, tooltip, `aria-current`, roving tabindex, Up/Down/Home/End/Enter/Space; shown only with two or more floors on and in the office view [FR-006, FR-007, FR-013]
- [x] T016 Styles in `styles.css`: panel, button (at least 28 px, 10.5 px text), current-floor shape cue, badge with count; tokens only (`test:theme`, `test:uisuite`) [FR-006, FR-007, FR-015]
- [x] T017 Reserve the panel width in the office area only while shown and count it in `renderOffice` width (`aw`) and `layoutKey` [FR-008]
- [x] T018 Badges: compute from `needsMeOrder()`, unread and coffee-break state per floor of the agent; none on the current floor; none for off floors; repaint on state change; no sound/toast/notification [FR-014, FR-015, FR-016]
- [x] T039 [P] Lift edge summary: pinned "▲ n waiting" / "▼ n waiting" rows when badged buttons are scrolled out; activating one scrolls and focuses the nearest badged button; unit rule in `floornav.js` (`edgeSummary`) with a test, driver case with many floors [FR-028; SC-004]
- [x] T019 Pills, inbox count, window title and usage total checked unchanged: test that the whole-building counts do not depend on the current floor [FR-017; US2]
- [x] T040 (2026-10-28: `read:` only, `renderStats` leaves hidden folders out, the inbox and the badge count them; FR-014 restated; not run on the simulator) Check, on the simulator, whether the Waiting pill counts agents of hidden folders; make the badge rule (FR-014) the same as the inbox and restate the spec line with the measured fact, removing the `[unverified]` [FR-014, FR-017]
- [x] T020 `check:office` with the panel at both sizes; record the density cost at 1280x800 in the spec (turns the FR-008 gap into a result, or opens the owner question with the numbers) [FR-008; SC-001] (2026-10-28: no step lost, numbers in FR-008)
### All floors view (owner 2026-10-28, FR-031..FR-037; ships with phase 2)

- [x] T043 [P] `floornav.js`: `viewOf(stored)` (`'all'` or `'one'`, default `'one'`), `keyAction` in the All view returns `{scroll}` or nothing (never `{go}`), `announceAll(m)` text; extend `test-floornav.ts` (default, bad stored values, keys in All view at and away from the edges, held key) [FR-034, FR-036, FR-037]
- [x] T044 `app.js`: view state restored from and saved to `localStorage` `durbar.floorView` (try/catch); `curFloorId()` returns `null` in the All view so `renderOffice()` takes the pre-092 path; `oneFloorView()` gates the per-floor behaviour; every `floorScreens()` call site reviewed and switched where it means "one floor shown"; `layoutKey` carries the view; current floor still kept valid in the background by `afterFloorsChange` [FR-031, FR-035, FR-037]
- [x] T045 Lift panel *All* button (in T015's toolbar, before the floor buttons): label, accessible name, tooltip, `aria-current`, shape cue, roving focus (Home = All), click and Enter/Space switch views instantly with one announcement; no badges in the All view; tokens only (`styles.css`) [FR-032, FR-035, FR-036]
- [x] T046 (2026-10-28: all four pass, no step lost, numbers in FR-033) `check:office` All-floors cases: `simfloors=1` and `simfloors=ground`, the All view chosen, lift panel shown, 1440x900 and 1280x800; record `data-d` with and without the panel and write the numbers into FR-033 (removes its `[KNOWN GAP]`, or stops the merge and goes to the owner) [FR-033; SC-008]
- [x] T047 Driver cases in `shots-092.js`: All and back by mouse and keyboard, choice survives a reload, PageUp/PageDown in the All view (scroll only, never a floor change), Show only and switching a floor back on keep the view, the current floor switched off in the All view moves nothing and announces nothing, pill and folder filter in the All view, every visitor walks and no tile label names a floor, no "Nothing on <floor>" line, no badge; screenshots at both sizes [FR-031..FR-037; SC-009]

- [x] T021 Driver cases: badge appears and clears (New reply clears exactly when the inbox's New does), edge rows for badges scrolled out of the panel (FR-028), accessible names, roving focus, many floors scroll inside the panel; screenshots; `changelog.d/092-lift-all-floors.md`; check FR-024; tick tasks [US2; SC-004]

## Phase 3: The slide (PR 3)

- [ ] T022 Two-floor mount during a slide: current plus target in a clipped container, others unmounted; focus order only for the visible floor [FR-003, FR-009]
- [ ] T023 Slide with `motion()`: translateY, 300 ms, ease-in-out; retarget on a new request; end at once on resize, relayout, theme change [FR-009, FR-030]
- [ ] T024 Reduced motion read live with `reducedMotion()`: instant change, no fade; also when the setting flips while open [FR-010]
- [ ] T025 Walker layer and lobby while sliding: no walk is drawn; places placed at the end of the slide [FR-021; edge case walkers]
- [ ] T026 Timing check like 033 SC-003: ratio to a same-run yardstick, 15 agents, both sizes (`scripts/shots-092.js`) [SC-003]
- [ ] T027 Driver cases: slide runs about 300 ms, retarget, reduced-motion emulation instant; `changelog.d/092-p3-slide.md`; check FR-024; tick tasks [US5]

## Phase 4: Jumps (PR 4)

- [ ] T028 `goToFloor(id, {animate})` in `app.js` one entry point used by the lift, keys and the rest; no-op when the floor is current or off [FR-018]
- [ ] T029 `openPanel()` calls `goToFloor(agentFloor, {animate:false})` before the chat shows; covers inbox Open / Answer in chat, notification click (via inbox), list view, chat strip [FR-018; US4]
- [ ] T042 Announce a jump made under a chat once, on *Back to the office*, not when it happens; navigator: the office moves when the palette closes, not behind it; driver cases for both [FR-012, FR-019]
- [ ] T030 Folder filter and status-pill filter: choosing a room on another floor slides to it; a filter never changes the current floor by itself [FR-018; edge case filters]
- [ ] T041 Status-pill click: go to the floor of the first match when all matches are on other floors; the line and *Next floor with <status>* button on a floor with no match; driver case with a Waiting agent on another floor, then switching floors with the filter on [FR-027; US2]
- [ ] T048 `goToFloor()` and `openPanel()` in the All floors view: opening an agent by any route keeps the All view and *Back to the office* shows it; a navigator floor row switches to the one-floor view on that floor when the palette closes; folder and chat rows keep the All view; driver cases [FR-035, FR-018, FR-019]
- [ ] T031 Navigator: a floor row activates `goToFloor` and still narrows the folder list; folder and chat rows go to their floor first (`src/renderer/navigator.js`, `app.js` navigator actions); extend `test-navigator.ts` [FR-019]
- [ ] T032 Keyboard help rows for PageUp/PageDown (with the Mac Fn note) next to `app.js` rows; update `test` that lists them if any [FR-011]
- [ ] T033 Driver cases: open from the inbox then Back shows that floor; navigator floor row slides; agent on an off floor does nothing; `changelog.d/092-p4-jumps.md`; check FR-024; tick tasks [US4; SC-007]

## Phase 5: Docs, screenshots, converge (PR 5)

- [ ] T034 README floors text and *Keyboard* list; `docs/` pages that describe floors or the office; feature history note [FR-026]
- [ ] T035 `npm run shots:docs` for every linked picture that shows the office (look at each); add a lift-panel picture to `docs/site/gallery.json` and `DOC_SHOTS` in `scripts/shots-docs.js` [FR-026]
- [ ] T036 Update the 033, 024, 001, 052 and 074 `## Changes` lines (written in T001) to say they are built; `npm run specs:index` status of 092 [FR-026, FR-029]
- [ ] T037 `/speckit-converge`: spec, plan, tasks match what was built; known gaps updated with what was measured; `npm run specs:check`, `npm run changelog:check`; final FR-024 check over the whole series [FR-024, FR-026]
- [x] T049 `scripts/shots-092.js`: the FR-011 select step counts the key on the select and asserts the choice changed only off macOS (#888, spec delta 2026-10-29) [FR-011]
- [ ] T050 Signed off: Vikram said yes 2026-10-31 10:27 UTC; Paco answered that Vikram's call stands, relayed by his agent (replaces his D3). Flat lift and All floors natural numbering: floor 1 at the bottom, PageUp to the next number up, button order reversed; names, numbers, badges and announcements unchanged; plus the tests that pin the old order (lift order, PageUp/PageDown, announcements) updated, and the shots. Test: `test:` order and keys; `sim:` lift picture [Q-D, FR-011]

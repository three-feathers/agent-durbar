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

Numbered T088..T102 since 2026-10-23 (first written as T057..T071; PR #511 took T057..T062 on main first, and #554 uses T072..T087).

- [x] T088 `src/renderer/probe.js` (`GROW`, `largest`, `better`, `pick`) and their cases in `scripts/test-probe.ts` (`npm run test:probe`) (synthetic fit tests; box model with 1, 2, 4, 6, 10, 15 agents in 1-3 folders at 1280x800, 1440x900, 1920x1080) [FR-041, FR-042, FR-046]
- [x] T089 `chooseLayout`: grow search after the candidates (after `full` or `roomy`, at f >= 1.1; never `card`/`mini`/`micro` or a forced density); `renderOffice` sets `--gf` and `data-grow`; helper boost after [FR-041, FR-042, FR-044]
- [x] T090 Grown card text: `liveact.js` `long` readout (+ `test:liveact` cases); `deskLine` grown text (readout, last reply excerpt masked, task); `fitSide` on grown text lines after render and paint; `styles.css` grown rules (height, widths, two-line title, max 8 lines, fade) [FR-043, FR-045]
- [x] T091 `sim.ts` `simrooms=1..5`, `simhelpers=0`; `scripts/check-office-fill.js` driver + `npm run check:office-fill` + `scripts/ui-suite.js`; `shots-001-live-activity.js` forces `full` for the side-panel part [FR-046]
- [x] T092 `check:office`, `check:geometry`, `npm test`; screenshots `docs/screenshots/001-fill-{4,6,15}-{1440x900,1280x800}.png` (simulator); README office section, `changelog.d/001-office-fill-space.md`, the specs-index block of this spec [FR-045, FR-046]
- [x] T093 (review of #532) `liveact.js` `excerpt(raw, redact)`: mask the raw reply, then `plain`, then cut; `grownLine` uses it and fails closed (`Finished.`) without `redact`; `test:liveact` token cases (ghp_, github_pat_, sk-, Bearer; plain, backticks, bold, underscores, code block, link) [FR-043]
- [x] T094 (review of #532) The `src/shared/redact.ts` underscore fix (key shapes anchored on "no letter or digit before", `test:redact` cases, spec 012 FR-080 delta) moved to PR #543, which owns it; #532 carries none of it and merges after #543 (its `check:office-fill` `_${PAT}_` case depends on it) [FR-043; spec 012 FR-080]
- [x] T095 (review of #532) `liveact.js`: `long` computed lazily in `of()`; `chooseLayout` starts with `GROW=0`; `test:probe` source check [FR-042, FR-043]
- [x] T096 (review of #532) `check:office-fill`: `ghp_` and `github_pat_` tokens in the done reply; FR-042, README and CHANGELOG say *f* may drop several steps at once [FR-042, FR-046]
- [ ] T097 (review of #532) One helper for "mask the raw text, then strip the Markdown": #541's shared `safetext.js` and `DurbarLiveAct.excerpt` become a single helper. Whichever of #532 and #541 lands second points `grownLine` and the non-grown Done desk text (`taskOf`) at that helper and removes the other [FR-043]

## Changes 2026-10-22 (owner decisions on #532: grown desks first; a wide grown desk shows more in columns)

- [x] T098 Spec: owner decisions recorded (FR-029 order, decision (2) replaced), FR-047..FR-050; plan delta [FR-029, FR-047..FR-050]
- [x] T099 `src/renderer/probe.js` `GCOL`, `grownCols`; `scripts/test-probe.ts` cases [FR-047, FR-048]
- [x] T100 `liveact.js` last tool phrase (`tool` in `of()`) + `test:liveact`; `a.busySince` in `setState`, the 30 s tick [FR-047]
- [x] T101 `cardHTML` grown side column (`.gx`: reply excerpt, facts); `renderOffice` sets `data-gc`, `--gm/--gr/--gs`, `fitLines` on reply; `styles.css` grid columns, measure, collapse [FR-047..FR-049]
- [x] T102 `check:office-fill`: 1 and 2 agents at 1440x900, 1280x800, 1920x1080 (multi-column, measure <= 90 characters per line, page rules); mutation check; `npm test`, `check:office`; screenshots `001-fill-{1,4,6}-1440x900.png`, `001-fill-1-1920x1080.png`; changelog fragment, README [FR-050]

## Changes 2026-10-22 (finished agents roll in, owner)

- [x] T072 `src/renderer/shutters.js` (`finished`, `kindOf`, `roomPlan`, `split`, `RECENT_MS`, `OLD_CAP`) + `scripts/test-shutters.ts` (`npm run test:shutters`, in `test:serial`); `copy-assets.js`, `index.html` [FR-051, FR-052, FR-057]
- [x] T073 `app.js`: `officeModel` splits `mains`/`rolled`; layout key; `roomHTML` shutter row (strips, chips, `+N`), `.peek`, labels, `rolling` class; `__durbarSimUi.render` [FR-051..FR-054]
- [x] T074 (replaced by T081/T082: the strip and chip became the lounge) `styles.css`: `.shutters`, `.desk.shut` strip and chip, `.peek` roll, roll-in; theme tokens; >= 10.5 px [FR-054, FR-055]
- [x] T075 (replaced by T082: the switch is now *Finished agents rest in the lounge*) Settings > Detail level: *Roll up finished agents* switch (`screens.js`, `durbar.shutters`) [FR-056]
- [x] T076 `check:office` (unchanged; its 15 agents now include rolled ones) and `check:office-fill` (keyboard reach, labels, hover card; 2 working + 3 finished, 1 recent + 2 old, at 1440x900 and 1280x800; open desks get the space); mutation checks [FR-053, FR-057]
- [x] T077 Screenshots `docs/screenshots/001-shutters-{1440x900,1280x800}.png` (simulator); README office section, `changelog.d/001-office-shutters.md`, the specs-index block [FR-057]
- [x] T078 (owner on #554, 18:48) Spec: horizontal squeeze (FR-052..FR-055, FR-057 amended, dated note) [FR-052..FR-057]
- [x] T079 Squeeze: `shutters.js` widths and slat cap; `roomHTML` desk grid plus a side group of panels and slats (room width counts them); `styles.css` panel, slat (vertical text), side card, squeeze animation; `test:shutters` [FR-052..FR-055]
- [x] T080 `check:office-fill` (row height kept, widths freed, slat text, side card), mutation checks, `check:office`, `npm test`; screenshots retaken; README, changelog fragment [FR-057]
- [x] T081 (owner on #554, 19:55) Spec: the lounge (couch, nap beds, speech bubble, rotating dreams; FR-052..FR-057 amended, dated note) [FR-052..FR-057]
- [x] T082 Lounge: `shutters.js` (couches, bed cap, width, turn); `app.js` lounge corner with the agents' own characters (`avatar`), bubbles and their turn, setting renamed; `styles.css` couch and bed art from theme tokens; `test:shutters` [FR-052..FR-056]
- [x] T083 `check:office-fill` (corner in the row, bubbles inside and >= 10.5 px, keyboard, deterministic turn), mutation checks, `check:office`, `npm test`; screenshots retaken; README, changelog fragment [FR-057]
- [x] T084 Lounge polish (coordinator review): 64 px seats and bunk beds so the characters fill the height, bubbles on up to 3 lines in the upper part, names on the characters, corner at least 150 px; `test:shutters`, `check:office-fill` (names, character size, bubble lines), screenshots retaken [FR-052, FR-053, FR-057]
- [x] T085 (review of #554, fjcabello) Spec: the state is `data-state` and the first `is-*` class, the resting kind `rest-recent`/`rest-old`; FR-051's helper and away rules checked in the page; stale wording [FR-051, FR-054, FR-057]
- [x] T086 `app.js` desk buttons `data-state` (state class first, `rest-*` kind, `data-rest`); `styles.css`, `shots-033`, `shots-034`, `check:office-fill` selectors; `test:shutters` source checks of `shutInput` (away, busy helper); `check:office-fill` cases (a Done agent with a working helper keeps its desk and helper; an agent away at a place is not in the lounge), mutation checks; stale strip/chip wording (`app.js`, `shutters.js`, `styles.css`, `driver-helpers.js`, `test-shutters.ts`) [FR-051, FR-054, FR-057]
- [x] T087 (review of #554, fjcabello, 23:09) Cause of the blurred desk scene beside the lounge (a composited halo animation, not the layout); `styles.css` halo pulses `fill-opacity`; `check:office-fill` same scene box and sharpness with the lounge on and off, mutation checks (old halo; a rule that moves scenes beside the lounge); `check-theme-art`; spec note, `docs/agent-notes.md` [FR-057]

## Changes 2026-10-21 (layout speed, PR #457 finding)

- [x] T039 `src/renderer/probe.js` (`svgHollow`, `styleSplit`), `probeSet` in `chooseLayout`, `@property` for `--w`/`--min`/`--cols` in `styles.css`; `scripts/test-probe.ts` (`npm run test:probe`) [FR-033]
- [x] T040 Before/after timing and a layout comparison over 54 cases on the simulator; `check:office`, `check:geometry`, `shots-033`; spec 001 and 033 Verification, `specs/README.md`, CHANGELOG, `docs/agent-notes.md` [SC-004]

## Changes 2026-10-22 (who is where, who waits, what is scheduled; owner)

First build (PR #511, morning): T041..T046. The rail parts (T042, T043) were removed by the owner's decision of 2026-10-22 06:53 Zurich and replaced by T047..T052.

- [x] T041 `places.js` `tileChips` + `test:places` cases [FR-036]
- [x] T042 ~~the rail (Needs you, Scheduled, legend), strip mode, `renderRail`~~ built, then removed in T047 (owner)
- [x] T043 ~~`renderOffice`: rail then strip by the fit rule~~ built, then removed in T047 (owner)
- [x] T044 Lobby entries (name, activity, initials, count, "nobody", +N menu) and the 58 px lobby; `check:office` lobby rules [FR-036]
- [x] T045 Room header words and their fitting [FR-037]
- [x] T046 `sim.ts` `simsched=1` (kept); the rail driver and screenshots (removed in T047)
- [x] T047 Remove the rail: `#rail`, `renderRail`/`railHTML`, rail CSS, the rail/strip search and room-name fold in `renderOffice`, `check:office` rail rules, `scripts/shots-001-rail.js` and `docs/screenshots/001-rail-*` [FR-034..FR-039]
- [x] T048 `places.js`: `BOSS`, `BANK`, `POSTBOX`, `lobbyFit`, `lobbyOrder`, `postNext`, `lettersToday`; `test:places` [FR-038, FR-039]
- [x] T049 Boss: `syncDesks` pins, queue entries (badge, wait, order), click to the request, desk note, theme words (`theme.js`, `themegen.ts`) [FR-034]
- [x] T050 Bank: the cap break waits at the Bank with *Limit reached*; spec 068 and 024 cross-references; `shots-068-coffee.js` [FR-035]
- [x] T051 Postbox: next 3, today, flag, click to Settings > Schedules, the flying letter; `simsched` seeds a missed run [FR-038]
- [x] T052 `check:office` special tiles; `scripts/shots-001-lobby.js` driver and screenshots (1440x900, 1280x800; 15 and sparse; Clean Office and Retro Pixel); README, CHANGELOG, `specs/README.md`, `docs/agent-notes.md` [FR-040]

## Changes 2026-10-22 (review on #511, Ruben's agent, 08:35 UTC)

- [x] T053 Short lobby tooltips: visitor entries, "+N", place tiles, desk card title head cut to 200; `check:ui-text` passes with `simnames=long` [FR-036, spec 052 FR-168]
- [x] T054 `shots-001-lobby.js`: record the walk start with a `MutationObserver`, wait for the end state [FR-040]
- [x] T055 `parseCustomPlaces` renames a saved reserved or repeated name instead of dropping it; `sim.ts` reserves Boss, Bank, Postbox; `test:places` migration case through `parseSettings` (ids and mappings kept) [spec 024 FR-018]
- [x] T056 `test:places`: `VISITS.pin` same place, new label (M19); remove `tileSlots`/`tileChips` and their tests [FR-034, FR-039]

## Changes 2026-10-22 (review on #511, Paco's agent, 15:41 UTC)

- [x] T057 `screens.js` `openSettings('schedules')` (scrollInBody, heading focused); the Postbox click and `openSchedSettings` use it; no `scrollIntoView` [FR-038, spec 052 FR-055]
  - Check: `shots-001-lobby.js` clicks the Postbox and asserts Settings is open, `#schH` has the focus and the outer page did not scroll; mutation (the old `scrollIntoView` path) fails it.
- [x] T058 `places.js` `postMissed` counts done one-time schedules with a `missed` or `failed` last run; `test:places` case [FR-038]
  - Check: `test:places`; mutation (back to `!s.done`) fails it.

## Changes 2026-10-23 (review on #511, Paco's agent, 2026-10-22 23:45 UTC)

- [x] T059 `shots-001-lobby.js`: hostile session titles for agents at the Boss (one inside "+N"), the Bank and the coffee corner, and a schedule prompt with markup; no element created in `#stage`, `#walkers` or `#modeMenu`, nothing runs, literal text in entries, labels, the menu and the Postbox [FR-036, FR-038]
  - Check: mutation (drop `esc(a.name)` in the lobby entry) fails it.
- [x] T060 `places.js` `postMissed`: one-time = `every === undefined && !rule` (as #560's `missedOrFailed`); `test:places` `every: null` case; the #560 hand-off in spec and plan [FR-038]
- [x] T061 Desk card title masked with `DurbarRedact.redact` before the 200-character cut, accessible name masked, name only without the module; driver case with a `ghp_` token across the cut; the #567 hand-off in spec and plan [FR-036, spec 041 FR-065]
  - Check: mutation (cut, then mask) fails it.
- [x] T062 `focusRequest(card)` shared by the answer bar's `show` and `openAtRequest` [FR-034]

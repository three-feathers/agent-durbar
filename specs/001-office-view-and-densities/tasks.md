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
- [x] T048 `places.js`: `BOSS`, `BANK`, `POSTBOX`, `lobbyFit`, `lobbyOrder`, `postLines`, `lettersToday`; `test:places` [FR-038, FR-039]
- [x] T049 Boss: `syncDesks` pins, queue entries (badge, wait, order), click to the request, desk note, theme words (`theme.js`, `themegen.ts`) [FR-034]
- [x] T050 Bank: the cap break waits at the Bank with *Limit reached*; spec 068 and 024 cross-references; `shots-068-coffee.js` [FR-035]
- [x] T051 Postbox: next 3, today, flag, click to Settings > Schedules, the flying letter; `simsched` seeds a missed run [FR-038]
- [x] T052 `check:office` special tiles; `scripts/shots-001-lobby.js` driver and screenshots (1440x900, 1280x800; 15 and sparse; Clean Office and Retro Pixel); README, CHANGELOG, `specs/README.md`, `docs/agent-notes.md` [FR-040]

## Changes 2026-10-22 (review on #511, Ruben's agent, 08:35 UTC)

- [x] T053 Short lobby tooltips: visitor entries, "+N", place tiles, desk card title head cut to 200; `check:ui-text` passes with `simnames=long` [FR-036, spec 052 FR-168]
- [x] T054 `shots-001-lobby.js`: record the walk start with a `MutationObserver`, wait for the end state [FR-040]
- [x] T055 `parseCustomPlaces` renames a saved reserved or repeated name instead of dropping it; `sim.ts` reserves Boss, Bank, Postbox; `test:places` migration case through `parseSettings` (ids and mappings kept) [spec 024 FR-018]
- [x] T056 `test:places`: `VISITS.pin` same place, new label (M19); remove `tileSlots`/`tileChips` and their tests [FR-034, FR-039]

# Tasks: 097 Real office mode

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: required (constitution VII; SC-001..SC-008). Node tests and the simulator only; 0 AI credits; no network. Driver waits use `until()`, never a fixed sleep.

**Format**: `- [ ] Tnnn [P?] [USn?] description (file) [requirements]`, then a `Test:` line. `[P]` = can run in parallel. A phase = one PR. Numbers taken: spec 097, FR-001..FR-093 (sparse by group), T001..T063.

## Phase 0: Spec (this PR)

- [x] T001 Spec, plan, tasks and specs-index block (`specs/097-real-office/`). Test: `npm run specs:check`, `npm run rules:check`.
- [x] T002 Issue #692 read (trusted author) and folded in as FR-053..FR-058 with Q3. Test: read-through; the PR says `Refs #692`.
- [ ] T003 Owner answers Q1-Q5 recorded under *Clarifications* and posted on the PR. Test: the spec has no open question blocking P1 (Q1, Q2, Q4).
- [ ] T004 Paco's answer to Q6 recorded under *Clarifications* (D3 stays the default until then); if he picks (b), update D3, FR-081, FR-083, T017 and T051 before P1 or P3 touches them. Test: spec has no open Q6 before P3 starts [Q6, D3]

## Phase 1: Static scene and lights (PR P1) - US1, US2

- [ ] T010 [P] Art pack into `src/renderer/realoffice/art/`: re-encode persons (WebP 0.80, ≤ 640 px tall, ≤ 80 KB, no metadata), fixtures to WebP re-cropped to a common floor line and full height (≤ 120 KB), desk (≤ 60 KB), floor (≤ 40 KB), `people.json`, `ASSETS.md` with the mockup's provenance rows and licence. Test: `test:realoffice-assets` [FR-060, FR-062, FR-063, FR-064, FR-066]
- [ ] T011 [P] `scripts/test-realoffice-assets.ts` (reuse the chunk walker of `test-crew-assets.ts`): format, alpha, no metadata chunks, caps, total ≤ 10 MB, `people.json` complete and in range, an `ASSETS.md` row per source sheet; registered in `package.json` `test:serial`. Test: green on the pack, red on a fixture with EXIF, a 90 KB frame, an unlisted file [FR-062, FR-063, FR-066]
- [ ] T012 `scripts/copy-assets.js`: copy `realoffice/art/` (WebP, JSON only). Test: `npm run build` output holds the pack and no `.md`/PNG [FR-060]
- [ ] T013 [P] [US1] `src/shared/realoffice-layout.ts` `realLayout(model, viewport, meta)`: port of `b2.js` (unit `u`, row packing search, scoring, desk/person/screen/plate rects, away desks, folder sign side, big screens n ≤ 4, lobby band, fixtures scaled whole, visitors, crowding, plate-only slots), `u` floor and cap, order search capped past 7 folders. Test: `scripts/test-realoffice-layout.ts`: 1/2/4/5/15/40 agents, 1-8 folders, both sizes, chat open; no overlap, inside bounds, `u` limits, desk face ≥ 40 px at 15 agents 1280x800, status order, same rects across status changes, < 5 ms for 40 [FR-010..FR-022, FR-023..FR-027, SC-002, SC-007]
- [ ] T014 [P] [US2] `src/shared/lights.ts` `lightFor(status, flags)`, `ambientFor(activeShare)`, done-tick-once helper. Test: `scripts/test-lights.ts`: every FR-041 row, limit vs waiting vs error precedence, compacting/retrying as thinking, paused as idle, asleep off, ambient 70-100 %, reduced motion strips motion [FR-041..FR-043, FR-047, FR-052]
- [ ] T015 [US1] `src/renderer/realoffice.js` + `realoffice.css`: lazy-loaded module `DurbarRealOffice.render`, keyed in-place DOM, plates as named buttons, still poses (FR-036 first frames), cues, initials fallback, person pick (`durbar.realpeople`). Test: `sim:` driver opens Real office with SIM 15; no broken image with a renamed picture [FR-005, FR-006, FR-016..FR-018, FR-036..FR-038, FR-061, FR-065, FR-090]
- [ ] T016 [US2] Light layer in `realoffice.css`: lamp, glow, call, fixture lights, ambient, z-order under chrome, forced-colours and `prefers-contrast` rules, reduced motion and Serious mode steady. Test: `sim:` screenshots per status; forced-colours emulation shows no light layer [FR-040, FR-042, FR-044..FR-051]
- [ ] T017 [US1] `app.js` mode switch (`officeView()`, `durbar.officeview`, call `DurbarRealOffice.render` in `renderAll`), `screens.js` third *Office layout* button with the `setSignsOn` confirmation, the D3 note line (pending Q6). Test: `sim:` switch flat → real → open → cabins; flat DOM unchanged; storage error means flat [FR-001..FR-004, FR-083]
- [ ] T018 [US1] `scripts/check-office-overlap.js` Real office mode flag: SIM 12/15, both sizes, chat closed and open; overlap, clipping, 10.5 px, overflow, desk face size, plate contrast at 70 % and 100 % ambient; flat run asserts no `realoffice/` request. Test: `npm run check:office` (both modes) [FR-050, FR-091, SC-001, SC-002, SC-004]
- [ ] T019 [US1] `shots:docs` drivers: Real office 15 and 3 agents at both sizes, lights per status; pictures linked from this spec. Test: `npm run shots:docs`; `test:uisuite` sees a driver per picture [FR-092]
- [ ] T020 [US1] Simulator: every status and flag, visits to every place including a custom place, helpers, Real office URL option. Test: `sim:` the driver reaches each state with `until()` [FR-093]
- [ ] T021 Docs: README (Office layout, Real office, art licence and size, limits), changelog fragment, spec tags. Test: `npm run changelog:check`, `specs:check`
- [ ] T023 [P] Fictional-people rule in the pack: every person entry in `ASSETS.md` carries the prompt clause (fictional, no resemblance to a real or famous person, no real person/celebrity/brand/logo/franchise named) and a `likeness-check` field (approver and date). Test: `scripts/test-realoffice-assets.ts` is green on the pack, red on a person entry without the clause, without the field, with an empty approver or a non-date, and on a recorded removal that lacks its replacement [FR-067, FR-068]
- [ ] T024 [P] `ASSETS.md` and README limits: the C2PA/content-credential strip known limit and the removal procedure (remove, replace, record, patch release). Test: `npm run specs:check`; read: the note is in `ASSETS.md` [FR-068, FR-069]
- [ ] T022 Owner review of P1 screenshots, quoted in *Changes*. Test: `real:` owner verdict [SC-008]

## Phase 2: Screens and motion (PR P2) - US3, US4

- [ ] T030 [P] [US3] Screen lines from the live readout buffer through `DurbarSafeText` (after main's `maskMcpEvent`), ANSI strip, 24 lines × 200 chars, `textContent` only; bars for small screens; repaint ≤ every 2 s; status screens. Test: `test:realoffice-layout` (or `test-safetext`) hostile strings: token, MCP secret value, `~/` path, `<img onerror>`, Markdown link, ANSI, 1 MB → masked, inert, capped [FR-030..FR-033, FR-035, SC-005]
- [ ] T031 [P] [US3] `zoomRect(target, avoid, viewport)` pure placement + zoom panel (hover and focus, Esc, named region). Test: unit: never covers the avoid list, stays in the viewport; `sim:` hover and Tab at 15 agents [FR-034]
- [ ] T032 [US3] Big screens for n ≤ 4 with real text. Test: `sim:` 3 agents at 1280x800, ≥ 8 lines at ≥ 11 px [FR-020, SC-003]
- [ ] T033 [US4] Motion: 2-frame swaps per agent period, breathe, visitor motions, pose cross-fade, desk ↔ lobby fade, pause when hidden; off under reduced motion, Serious mode, `characterMotion` off. Test: `sim:` frame captures differ while working and are equal under reduced motion [FR-070..FR-074]
- [ ] T034 Screenshots of the hover zoom; README limits (no walking, FR-075). Test: `npm run shots:docs`

## Phase 3: My characters and manual lighting (PR P3) - US5

- [ ] T050 [US5] `real-office-front-v1` in 096 `STYLE_PRESETS` (seated and standing sheet prompts from `ASSETS.md`), encoder computes seat metadata; needs 096 phases 2-4 merged. Test: `test:chargen` preset id and prefix; fixture sheet → frames + metadata in range [FR-080, FR-082]
- [ ] T051 [US5] (pending Q6) `pickPerson` uses Characters `mine` + folder pins for characters with `real-office-front-v1` frames; others fall back to built-in people. Test: `sim:` pinned folder shows the My character; a three-quarter one is not offered [FR-081]
- [ ] T052 [P] [US5] `cleanLighting()` and level resolution (room → desk inherit/override) in `src/shared/lights.ts`. Test: `test:lights`: malformed, wrong version, > 200 entries, stale sessions; cues never removed [FR-053, FR-054, FR-056, FR-057]
- [ ] T053 [US5] Room menu *Lighting* and desk menu *Lamp* radio items; `durbar.lighting`; applies at once. Test: `sim:` Dim room + Lit desk + Reset; keyboard-only operation; error desk at Off still shows red light and word [FR-055, FR-058]
- [ ] T054 Close or update issue #692 per Q3. Test: AGENTS.md linked-issue rule checked at merge (`Closes #692` only if all of it is done)

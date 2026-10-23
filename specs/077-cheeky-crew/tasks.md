# Tasks: Cheeky crew (spec 077)

Q2-Q8 are answered; **Q1 (art format) is open again** (2026-10-23). Tasks are marked **[both]** (every Q1 option), **[SVG]** (Q1 b′ only; replaced by the raster tasks T040-T053 if raster) or **[raster]** (Q1 d or e only). No [SVG] or [raster] task starts before T002. Experimental, no priority (issue #558). Each task is one small, testable change; checks for every code task: `npm run typecheck && npm run build && npm test`.

## Phase 0: spec (PR: 077-cheeky-crew)

- [x] T000 Spec, plan and tasks; specs-index block; owner questions Q1-Q8 [spec]
- [x] T001 Owner answers Q2-Q8 recorded under `## Owner answers` in `spec.md` [Q2-Q8]
- [x] T002 Q1 decision recorded (owners: (b′), (d) or (e), with Q1.1-Q1.3 if raster, and the policy on AI-generated art); spec, plan and tasks updated; review re-requested [Q1]
- [x] T003 Review of PR #577 (Vikram): Q1 reopened; raster options and costs; FR-017, FR-050..FR-058; tasks marked by option [spec]

## Phase 1: the kit, the machinery and 4 characters (shown to the owner first)

- [x] T010 [both] Pure `src/renderer/crew.js`: `pickCharacter` (least used, injected random), `seeded`, `assignCrew`, `pruneCrew`, `loadCrew` (500 entries, 200-char ids, unknown ids dropped); `scripts/test-crew.ts` as `test:crew` in `npm test` [FR-020, FR-021]
- [-] T011 [SVG] DROPPED (Q1 = (d) raster, 2026-10-23): Compiler `scripts/crew-compile.js`: `data-part` split, `guide` dropped, reserved and `--crew-*` colour mapping, unknown colour fails, every part through `sanitizeSlot` unchanged, size caps; fixture SVGs and cases in `test:crew` [FR-011, FR-012, FR-013]
- [-] T012 [SVG] DROPPED (Q1 = (d) raster, 2026-10-23): Drawing guide `src/renderer/crew/_guide.svg` (crew furniture, FR-014 zones as outlines, reserved colour swatches) and a short `src/renderer/crew/README.md` (parts, zones, colours, provenance rule) [FR-011, FR-014]
- [x] T013 [both] `--crew-*` tokens in `CLEAN_TOKENS` and the built-in **Cheeky Crew** pack in `theme.js`; check the AI prompt's token list and any token cap first; `test:theme` applies it as designed [FR-002, FR-012]
- [x] T014 [both] Kit list: `crew` in `scenekits.js` `KITS`, `theme.js` `SCENE_KITS`, `src/shared/themes.ts`; `cheeky-crew` in `src/main/ipc/themes.ts` and the test and driver lists (plan step 5); dated one-line delta to spec 035 FR-013 [FR-001, FR-002]
- [x] T015 [both] `KIT.crew` furniture (chair, desk, monitor, keyboard, cup) from tokens only, with a placeholder character (no parts yet); `test:scenekits` every-kit loops include `crew`; other kits byte-identical [FR-003, SC-005]
- [-] T016 [SVG] DROPPED (Q1 = (d) raster, 2026-10-23): `KIT.crew` draws the character parts (`back`, `body`/`body-wide`, `hair` with `headwear`, `top`, `cup`, `desk`) from injected parts; glasses off; character id in the signature; `headwear` dropped when the theme has `char-headwear`; unit tests in `test:scenekits` [FR-011, FR-016, FR-024, FR-030]
- [-] T017 [SVG] DROPPED (Q1 = (d) raster, 2026-10-23): Build: `copy-assets.js` runs the compiler to `dist/renderer/crew-art.js` and copies `crew.js`; `index.html` loads both before `scenekits.js`; `test:theme-tokens` scans the compiled output at 0 literals [FR-013, SC-004]
- [x] T018 [both] `app.js`: `CREW_KEY='durbar.crew'`, `crewOf(a)` next to `syncChatNos` (save only with `rememberOn()`, prune only after `agentsListed`); `crew` passed to the kit in `scene()` and `avatar()` only on the `crew` kit; character id in `sceneCacheKey` and the walker key; helpers not stored [FR-021..FR-024]
- [-] T019 [SVG] DROPPED (Q1 = (d) raster, 2026-10-23): Character 1, the **punk** (mohawk, skull mug as `cup`) [FR-010, FR-014]
- [-] T020 [SVG] DROPPED (Q1 = (d) raster, 2026-10-23): Character 2, the **mad scientist** (goggles over see-through lenses, lab coat, flask) [FR-010, FR-014, Q7]
- [-] T021 [SVG] DROPPED (Q1 = (d) raster, 2026-10-23): Character 3, the **gamer** (cat-ear headphones, gamepad) [FR-010, FR-014]
- [-] T022 [SVG] DROPPED (Q1 = (d) raster, 2026-10-23): Character 4, the **hooded hacker** (hood as `back` and `hair`, rubber duck) [FR-010, FR-014]
- [~] T023 [both] Driver `scripts/check-crew.js` in `check:ui`: Cheeky Crew picked in Settings, every character x status x mood x density, `getBBox()` of every `[data-part]` (raster: the `<image>` box and the overlay positions, FR-058) against FR-014, element count per character, reload with a stored map keeps the character [FR-014, FR-040, SC-002, SC-003]
- [~] T024 [both] `check:office` with Cheeky Crew at 1440x900 and 1280x800, every density, chat closed and open; `check:geometry` every-theme list (main and nightly) [SC-001, SC-005]
- [~] T025 [both] Screenshots: office at 1440x900 and 1280x800 (15 agents) and one sheet of the 4 characters in every status and density, in `docs/screenshots/` [FR-041]
- [ ] T026 [both] Docs: README theme list and known limits, `changelog.d/077-cheeky-crew.md`, spec status and `[IMPLEMENTED]` tags, specs-index block, `docs/agent-notes.md` entry for anything learned (for example the compiler and the reserved colours) [docs]
- [ ] T027 [both] Owner review of the Phase 1 sheet; their notes become tasks in this list before Phase 2 starts [OD6]
- [x] T028 [both] Run-time fallback: the `crew` kit draws the office figure when the character module is missing, an id is unknown or a part throws; unit tests in `test:scenekits`; one driver run with the module removed [FR-017]

## Phase 2: the other 8 characters (one per task, each with its sheet row and FR-014 checked by T023's driver; [SVG]: a drawn file; [raster]: a reviewed picture with its `ASSETS.md` row, as T050)

- [x] T030 [both] Character 5, the **skater** (backwards cap, shades, mini skateboard) [FR-010, FR-014]
- [x] T031 [both] Character 6, the **surfer** (sun-bleached long hair as `back`, shell necklace, tiny surfboard) [FR-010, FR-014]
- [ ] T032 [both] Character 7, the **cool kid** (sunglasses, quiff, jacket) [FR-010, FR-014, Q7]
- [ ] T033 [both] Character 8, the **nerd** (big round glasses, bow tie, book stack) [FR-010, FR-014]
- [ ] T034 [both] Character 9, the **artist** (beret, paint-splashed smock, brush jar) [FR-010, FR-014]
- [x] T035 [both] Character 10, the **rocker** (bandana, studded jacket, small amp) [FR-010, FR-014]
- [ ] T036 [both] Character 11, the **space fan** (headband with two star boppers, toy rocket) [FR-010, FR-014]
- [ ] T037 [both] Character 12, the **cozy knitter** (pom-pom beanie, chunky scarf, yarn ball) [FR-010, FR-014]
- [ ] T038 [both] With 12 characters: the simulator's 15 agents show all 12 (seeded least-used pick); screenshots and the full sheet refreshed; docs and spec status updated; `/speckit-converge` [FR-020, FR-041, docs]

## Raster path (only if T002 picks (d) or (e); replaces T011, T012, T016, T017 and T019-T022)

- [x] T040 [raster] `src/renderer/crew/` asset folder copied by `copy-assets.js`; check electron-builder's file list ships it; CSP unchanged [FR-050, FR-057]
- [x] T041 [raster] `src/renderer/crew/ASSETS.md` provenance table (file, character, tool and version, date, prompt kept, made by, edited by and how, licence, generator terms read by an owner) [FR-054]
- [x] T042 [raster] `test:crew-assets`: every picture has a row and every row a file; per-file and total size caps; no metadata chunks; 2x size from the header [FR-050, FR-051, FR-054]
- [x] T043 [raster] `KIT.crew` draws the picture as `<image>` per pose with the shared overlays (halo, screen, bubble, error mark, sweat, horns, stars, ambulance, cup and steam; arms with one pose); `avatar()` crop; unit tests in `test:scenekits` [FR-052, FR-053]
- [x] T044 [raster] Preload and `decode()` on theme apply; a failed picture falls back to the office figure (T028's path); unit test of the decision; driver step with one picture removed [FR-055]
- [x] T045 [raster] `check-office-fill.js` leaves the `<image>` box out of its flat-colour share; `check-crew.js` checks shown size against natural size and a capture against a canvas drawing [FR-051, FR-058]
- [x] T046 [raster] Spec deltas agreed with Vikram: spec 070 D3 and FR-040 (bitmaps, cast skin tones), spec 034 FR-002 (moods by overlays in the crew kit) [FR-053, Q1.2]
- [x] T050 [raster] Character 1, the punk: picture(s) edited for FR-056, reviewed by a person (line in the PR), `ASSETS.md` row [FR-050, FR-054, FR-056]
- [x] T051 [raster] Character 2, the mad scientist: as T050 [FR-050, FR-054, FR-056]
- [x] T052 [raster] Character 3, the gamer: as T050 (no console or headphone logos) [FR-050, FR-054, FR-056]
- [x] T053 [raster] Character 4, the hooded hacker: as T050 (no symbols or lettering on the hood or laptop) [FR-050, FR-054, FR-056]

## Real art wired in (delta 2026-10-23, FR-059; Paco: do it now)

- [x] T060 [raster] `crew.js` lists the 13 characters; the box is square (44x44 at x 52, y 42), 8 pixels per unit; files load from `crew/art/`; a stored id that no longer exists is dropped; `test:crew` covers the 13 ids, the unknown-id drop and 13 sessions with no twin [FR-059]
- [x] T061 [raster] `copy-assets.js` ships only `crew/art/*.webp` (cleans a stale `dist/renderer/crew` first); `test:crew-assets` reads `crew/art/`, requires 352x352, the 40 KB cap and a row per file, and checks `dist/renderer/crew/art` holds exactly the pictures; the two over-cap surfer pictures re-encoded at q80; the placeholders and `crew-placeholders.py` removed [FR-050, FR-054, FR-059]
- [x] T062 [raster] No code arms or hands over a portrait (the art has them); `test:scenekits` for 13 characters x every status, the plain figure keeps its arms; `check:crew` for 13 characters on screen, the hyphenated id and the new fallback path [FR-053, FR-059]
- [x] T063 [raster] `check:office` in the Cheeky Crew theme at 1440x900 and 1280x800, 15 agents; screenshots `docs/screenshots/077-crew-office-*.png` [SC-001, FR-041]
- [x] T064 [raster] Round avatars crop the face from a per-picture face table in `crew.js`; a seat shows the bust from the top edge, moved clear of the chat badge; `test:crew` (face table, crops inside the pictures, chins above the desk), `test:scenekits` (the crops per use) [FR-060]
- [x] T065 [raster] The desk portrait box is doubled to 88x88 at x 24, y 22 (ends at the monitor frame; the sub-agent cards use the same box in the same slot); `PX_PER_UNIT` 4; the placement and its reason written in the FR-060 delta [FR-060]
- [x] T066 [raster] `check:crew` face-visibility assertions for desk, helper, walker and seat at both sizes; mutation: the face crop set back to the whole picture fails it [FR-060]
- [x] T067 [raster] `check:office` and `check:geometry` in the crew theme at 1440x900 and 1280x800; screenshots `docs/screenshots/077-crew-office-*.png` re-taken [SC-001]


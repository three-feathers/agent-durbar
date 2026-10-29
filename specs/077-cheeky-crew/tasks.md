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
- [~] T023 [both] PARTLY (converge 2026-10-23): built for every character at 1440x900 and 1280x800 (one portrait per desk in its fixed box, pose by status, box against the monitor, bubble, badge and cup zones, face visibility, sharpness, the 13 on screen, the missing-picture fallback); open: every mood, every density and a reload with a stored map (SC-003 is covered by `test:crew` only). Original: Driver `scripts/check-crew.js` in `check:ui`: Cheeky Crew picked in Settings, every character x status x mood x density, `getBBox()` of every `[data-part]` (raster: the `<image>` box and the overlay positions, FR-058) against FR-014, element count per character, reload with a stored map keeps the character [FR-014, FR-040, SC-002, SC-003]
- [x] T024 [both] (converge 2026-10-23: `check:office` with `OFFICE_THEME=cheeky-crew` passes at both sizes, macOS; `cheeky-crew` is in `check:geometry`'s every-theme list and `check-parallel.js`) `check:office` with Cheeky Crew at 1440x900 and 1280x800, every density, chat closed and open; `check:geometry` every-theme list (main and nightly) [SC-001, SC-005]
- [~] T025 [both] PARTLY (converge 2026-10-23): `docs/screenshots/077-crew-office-1440x900.png`, `077-crew-office-1280x800.png` and `077-crew-art-sheet.png` (13 characters x 3 poses) exist; open: a rendered sheet of every status and density. Original: Screenshots: office at 1440x900 and 1280x800 (15 agents) and one sheet of the 4 characters in every status and density, in `docs/screenshots/` [FR-041]
- [x] T026 [both] (converge 2026-10-23; the fragment is `changelog.d/077-cheeky-crew-p1.md`, the branch name) Docs: README theme list and known limits, `changelog.d/077-cheeky-crew.md`, spec status and `[IMPLEMENTED]` tags, specs-index block, `docs/agent-notes.md` entry for anything learned (for example the compiler and the reserved colours) [docs]
- [x] T027 [both] (2026-10-23: Paco reviewed the art and the office on his Mac and signed off all 39 pictures in `ASSETS.md`; his notes became FR-060 and T064-T066) Owner review of the Phase 1 sheet; their notes become tasks in this list before Phase 2 starts [OD6]
- [x] T028 [both] Run-time fallback: the `crew` kit draws the office figure when the character module is missing, an id is unknown or a part throws; unit tests in `test:scenekits`; one driver run with the module removed [FR-017]

## Phase 2: the other 8 characters (one per task, each with its sheet row and FR-014 checked by T023's driver; [SVG]: a drawn file; [raster]: a reviewed picture with its `ASSETS.md` row, as T050)

- [x] T030 [both] Character 5, the **skater** (backwards cap, shades, mini skateboard) [FR-010, FR-014]
- [x] T031 [both] Character 6, the **surfer** (sun-bleached long hair as `back`, shell necklace, tiny surfboard) [FR-010, FR-014]
- [-] T032 [both] SUPERSEDED (FR-059, 2026-10-23: the cast is the 13 characters of the real art, T060, not this list): Character 7, the **cool kid** (sunglasses, quiff, jacket) [FR-010, FR-014, Q7]
- [-] T033 [both] SUPERSEDED (FR-059, 2026-10-23: the cast is the 13 characters of the real art, T060, not this list): Character 8, the **nerd** (big round glasses, bow tie, book stack) [FR-010, FR-014]
- [-] T034 [both] SUPERSEDED (FR-059, 2026-10-23: the cast is the 13 characters of the real art, T060, not this list): Character 9, the **artist** (beret, paint-splashed smock, brush jar) [FR-010, FR-014]
- [x] T035 [both] Character 10, the **rocker** (bandana, studded jacket, small amp) [FR-010, FR-014]
- [-] T036 [both] SUPERSEDED (FR-059, 2026-10-23: the cast is the 13 characters of the real art, T060, not this list): Character 11, the **space fan** (headband with two star boppers, toy rocket) [FR-010, FR-014]
- [-] T037 [both] SUPERSEDED (FR-059, 2026-10-23: the cast is the 13 characters of the real art, T060, not this list): Character 12, the **cozy knitter** (pom-pom beanie, chunky scarf, yarn ball) [FR-010, FR-014]
- [~] T038 [both] PARTLY (converge 2026-10-23): with 13 characters, `check:crew` asserts the 15 simulated agents show all 13 at both sizes; the office screenshots and the art sheet are current; docs and spec status updated. Open: the rendered every-status-and-density sheet (T025). Original: With 12 characters: the simulator's 15 agents show all 12 (seeded least-used pick); screenshots and the full sheet refreshed; docs and spec status updated; `/speckit-converge` [FR-020, FR-041, docs]

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
- [x] T067 [raster] `check:office` and `check:geometry` in the crew theme at 1440x900 and 1280x800; screenshots `docs/screenshots/077-crew-office-*.png` re-taken [SC-001] (historical since 2026-10-28, #814: they show the retired Cheeky Crew theme; the current look is `077-characters-cheeky-retro-*.png`)
- [x] T068 [raster] Merge `main` (the spec 001 late re-layout) so `check:office` in the crew theme passes at both sizes; no crew style was at fault (see the spec's 2026-10-23 delta)
- [x] T069 [raster] An idle desk, card or helper keeps its portrait at full colour (the furniture and text stay dimmed); `check:crew` asserts the effective opacity at both sizes and that Clean Office still dims [FR-061]
- [x] T070 [raster] Replace the art of 10 characters (sporty, disco, skater, hacker, buzzcut, bookworm, metalhead, scientist, gamer, surfer; 30 files) with Paco's new pictures, same conversion; re-read `FACE`; `ASSETS.md` rows and `PROMPTS-surfer-redo.txt`; screenshots re-taken [FR-050, FR-054, FR-059, FR-060]
- [x] T071 [raster] Merge `main` (spec 001 FR-178 glow and zoom, spec 017 cabins on by default, spec 035 FR-015 allow-list): `check:crew` switches the cabins off for its scene measurements and zooms every portrait desk to the New and needs-you peaks; a crew desk zooms to 1.15 at most so the face stays clear of the chat number at 1280x800 [FR-062]
- [x] T072 [raster] `crew.js` missing is a fallback: a null module guard on every crew call in `app.js`; `check:crew` removes the module from a copy of `dist/` [FR-063, FR-017]
- [x] T073 [raster] The map follows the main-session ids (a removal, a helper, the last session); `check:crew` removes sessions through `__durbarSimUi.crew`; `test:crew` has the interleaved main/helper allocation [FR-063, FR-020, FR-023]
- [x] T074 [raster] A fallback after mount redraws the chat header and inbox avatars; `check:crew` makes a character fail after both are open [FR-063]
- [x] T075 `test:theme-tokens` asserts the authored Cheeky Crew and Clean Office tokens meet `CONTRAST_PAIRS` with no run-time repair (dark `--bg` mutant) [FR-063]

## Characters, separate from themes (delta 2026-10-28, issue #814; FR-064..FR-070)

- [x] T076 Spec delta: FR-064..FR-070, Q9, the spec 035 cross-reference (FR-016, T018) [spec]
- [x] T077 `src/shared/characters.ts`: the list, `parseCharacters`, `kitFor` and the migration rule; `characters` in `AppSettings` and `parseSettings`; `SettingsStore.load` migrates once, `setCharacters`, `setTheme` with the old id; `settings:setCharacters` and `settings:get`; preload and `api.ts` [FR-064, FR-067]
- [x] T078 `theme.js`: Cheeky Crew leaves the built-in list; `setCharacters`, `characters`, `themeKit`, `kitFor`, `sceneKit` resolves the choice; `themeIdForCache` changes with it; `cheeky-crew` kept reserved in main [FR-065, FR-066]
- [x] T079 `app.js` and `screens.js`: boot applies the saved choice and the legacy id; the Characters section with previews; apply, save, toast; the simulator bridge keeps the choice in memory and reads `characters=` [FR-067, FR-068]
- [x] T080 Tests: `test:characters` (migration, round trip through the IPC handler, kit resolution on every theme, list equality); the old theme removed from `test:theme`, `test:theme-tokens`, `test:userthemes` and the theme lists of the drivers [FR-070]
- [x] T081 `check:crew` picks Characters = Cheeky on `CREW_THEME`; run on Retro Pixel and Corporate at both sizes; `check:office` with `OFFICE_CHARACTERS=cheeky` on the same two themes at both sizes [FR-070, FR-069]
- [x] T082 Driver `check-characters` (Cheeky, Minimalist and *The theme's own* on Retro Pixel and Corporate, a theme switch with Cheeky on; screenshots of the Settings section at both sizes), in `ui-suite.js` [FR-068, FR-070]
- [x] T083 Docs: README *Themes* (Theme and Characters), changelog fragment, agent notes if something new was learned; linked screenshots that show the theme picker retaken (`npm run shots:docs -- --list`) [FR-068]

## A sleeping crew character in the bed slot (delta 2026-10-29, issue #871; FR-071)

- [x] T084 Spec delta FR-071; `app.js` (`restHTML`: the seat crop and a crew blanket for a crew sleeper; `lg-bunk solo` for a one-bed column) and `styles.css` (the crew bed slot: figure, name under it, chip top-left; a solo bunk without posts and at full height); `check:crew` lounge step at both sizes; changelog fragment; linked lounge screenshots retaken [FR-071]

## The Prehistoric Crew (delta 2026-10-29, issue #815, crew 1 of 5; FR-072)

- [x] T085 Spec delta FR-072 [spec]
- [x] T086 `crew.js` generalised (`PREHISTORIC_IDS`, `idsFor`, `storeKey`, per-crew file prefix, `FACE` points); `characters.ts`, `theme.js`, `api.ts`, `sim.ts`, `screens.js` and `app.js` (per-crew ids, preload and saved map) with the `prehistoric` value [FR-072]
- [x] T087 18 pictures `crew/art/prehistoric-*.webp` (speck-cleaned) and their `ASSETS.md` rows; the size cap raised [FR-072, FR-050, FR-054]
- [x] T088 Tests: `test:crew`, `test:characters`, `test:crew-assets` for the new value, Cheeky unchanged; `check-crew` runs both crews at both sizes (`CREW_CHARS`), `check-characters` picks Prehistoric [FR-072]
- [x] T089 Docs: README, changelog fragment, the linked Settings screenshots retaken [FR-072]
- [x] T090 Spec delta FR-073 [spec]
- [x] T091 `simcrew.js` (demo name -> character per crew), seeded in `app.js` `syncCrew` under the simulator only [FR-073]
- [x] T092 Tests: `test:crew` (every demo name has a valid id in each crew, the real path is untouched); `check-crew` asserts Ada and Hugo wear their characters in both crews at both sizes [FR-073]
- [x] T093 Docs: changelog fragment, the linked screenshots that show crew characters retaken [FR-073]

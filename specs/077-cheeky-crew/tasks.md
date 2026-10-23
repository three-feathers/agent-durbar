# Tasks: Cheeky crew (spec 077)

Nothing here starts until the owner answers Q1-Q8 in `spec.md` (or accepts the recommendations). Experimental, no priority (issue #558). Each task is one small, testable change; checks for every code task: `npm run typecheck && npm run build && npm test`.

## Phase 0: spec (PR: 077-cheeky-crew)

- [x] T000 Spec, plan and tasks; specs-index block; owner questions Q1-Q8 [spec]
- [ ] T001 Owner answers Q1-Q8 recorded under `## Clarifications` in `spec.md`; plan and tasks adjusted (*If the owner decides otherwise*) [all]

## Phase 1: the kit, the machinery and 4 characters (shown to the owner first)

- [ ] T010 Pure `src/renderer/crew.js`: `pickCharacter` (least used, injected random), `seeded`, `assignCrew`, `pruneCrew`, `loadCrew` (500 entries, 200-char ids, unknown ids dropped); `scripts/test-crew.ts` as `test:crew` in `npm test` [FR-020, FR-021]
- [ ] T011 Compiler `scripts/crew-compile.js`: `data-part` split, `guide` dropped, reserved and `--crew-*` colour mapping, unknown colour fails, every part through `sanitizeSlot` unchanged, size caps; fixture SVGs and cases in `test:crew` [FR-011, FR-012, FR-013]
- [ ] T012 Drawing guide `src/renderer/crew/_guide.svg` (crew furniture, FR-014 zones as outlines, reserved colour swatches) and a short `src/renderer/crew/README.md` (parts, zones, colours, provenance rule) [FR-011, FR-014]
- [ ] T013 `--crew-*` tokens in `CLEAN_TOKENS` and the built-in **Cheeky Crew** pack in `theme.js`; check the AI prompt's token list and any token cap first; `test:theme` applies it as designed [FR-002, FR-012]
- [ ] T014 Kit list: `crew` in `scenekits.js` `KITS`, `theme.js` `SCENE_KITS`, `src/shared/themes.ts`; `cheeky-crew` in `src/main/ipc/themes.ts` and the test and driver lists (plan step 5); dated one-line delta to spec 035 FR-013 [FR-001, FR-002]
- [ ] T015 `KIT.crew` furniture (chair, desk, monitor, keyboard, cup) from tokens only, with a placeholder character (no parts yet); `test:scenekits` every-kit loops include `crew`; other kits byte-identical [FR-003, SC-005]
- [ ] T016 `KIT.crew` draws the character parts (`back`, `body`/`body-wide`, `hair` with `headwear`, `top`, `cup`, `desk`) from injected parts; glasses off; character id in the signature; `headwear` dropped when the theme has `char-headwear`; unit tests in `test:scenekits` [FR-011, FR-016, FR-024, FR-030]
- [ ] T017 Build: `copy-assets.js` runs the compiler to `dist/renderer/crew-art.js` and copies `crew.js`; `index.html` loads both before `scenekits.js`; `test:theme-tokens` scans the compiled output at 0 literals [FR-013, SC-004]
- [ ] T018 `app.js`: `CREW_KEY='durbar.crew'`, `crewOf(a)` next to `syncChatNos` (save only with `rememberOn()`, prune only after `agentsListed`); `crew` passed to the kit in `scene()` and `avatar()` only on the `crew` kit; character id in `sceneCacheKey` and the walker key; helpers not stored [FR-021..FR-024]
- [ ] T019 Character 1, the **punk** (mohawk, skull mug as `cup`) [FR-010, FR-014]
- [ ] T020 Character 2, the **mad scientist** (goggles over see-through lenses, lab coat, flask) [FR-010, FR-014, Q7]
- [ ] T021 Character 3, the **gamer** (cat-ear headphones, gamepad) [FR-010, FR-014]
- [ ] T022 Character 4, the **hooded hacker** (hood as `back` and `hair`, rubber duck) [FR-010, FR-014]
- [ ] T023 Driver `scripts/check-crew.js` in `check:ui`: Cheeky Crew picked in Settings, every character x status x mood x density, `getBBox()` of every `[data-part]` against FR-014, element count per character, reload with a stored map keeps the character [FR-014, FR-040, SC-002, SC-003]
- [ ] T024 `check:office` with Cheeky Crew at 1440x900 and 1280x800, every density, chat closed and open; `check:geometry` every-theme list (main and nightly) [SC-001, SC-005]
- [ ] T025 Screenshots: office at 1440x900 and 1280x800 (15 agents) and one sheet of the 4 characters in every status and density, in `docs/screenshots/` [FR-041]
- [ ] T026 Docs: README theme list and known limits, `changelog.d/077-cheeky-crew.md`, spec status and `[IMPLEMENTED]` tags, specs-index block, `docs/agent-notes.md` entry for anything learned (for example the compiler and the reserved colours) [docs]
- [ ] T027 Owner review of the Phase 1 sheet; their notes become tasks in this list before Phase 2 starts [OD6]

## Phase 2: the other 8 characters (one per task, each with its sheet row and FR-014 checked by T023's driver)

- [ ] T030 Character 5, the **skater** (backwards cap, shades, mini skateboard) [FR-010, FR-014]
- [ ] T031 Character 6, the **surfer** (sun-bleached long hair as `back`, shell necklace, tiny surfboard) [FR-010, FR-014]
- [ ] T032 Character 7, the **cool kid** (sunglasses, quiff, jacket) [FR-010, FR-014, Q7]
- [ ] T033 Character 8, the **nerd** (big round glasses, bow tie, book stack) [FR-010, FR-014]
- [ ] T034 Character 9, the **artist** (beret, paint-splashed smock, brush jar) [FR-010, FR-014]
- [ ] T035 Character 10, the **rocker** (bandana, studded jacket, small amp) [FR-010, FR-014]
- [ ] T036 Character 11, the **space fan** (headband with two star boppers, toy rocket) [FR-010, FR-014]
- [ ] T037 Character 12, the **cozy knitter** (pom-pom beanie, chunky scarf, yarn ball) [FR-010, FR-014]
- [ ] T038 With 12 characters: the simulator's 15 agents show all 12 (seeded least-used pick); screenshots and the full sheet refreshed; docs and spec status updated; `/speckit-converge` [FR-020, FR-041, docs]

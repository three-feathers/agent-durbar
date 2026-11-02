# Tasks: User themes (spec 040)

- [x] T001 `src/shared/themes.ts` validation + caps with tests
- [x] T002 `src/main/themes.ts`: list/get/import/export + unit tests (`test:userthemes`)
- [x] T003 IPC + preload bridge
- [x] T004 Settings Theme section: list user themes, Import/Export, toasts; startup resolution in app.js
- [x] T005 Gates: typecheck/build/test/check:themes incl. a fixture user theme (`scripts/fixtures/themes/check-user.json`, 183/183 on 2026-10-18)
- [x] T006 Expanded user slots: room-*/char-*/desk-art/door-art/lobby-art/place-* validate and sanitize through the same path as built-ins (covered by test:theme art-expansion cases)

## Changes 2026-10-18 (review of PR #137)

- [x] T007 Sanitizer rebuilds fragments (quoted values only, escaped re-serialization, local `url(#id)` only); Paco's bypass cases in `test:theme` [FR-005]
- [x] T008 Token keys limited to Clean Office keys and values to the token grammar, in the renderer and on import in main; words limited to scene keys and 60 characters; tests [FR-006, FR-007]
- [x] T009 Review follow-ups: no folder path in `theme:listUser`, import cleans up its temporary folder on error, `DURBAR_PICK` keeps Windows paths, `DURBAR_THEME` does not persist; tests where pure [FR-008]

## 2026-10-19: AI theme maker (#182)

- [x] T020 `themegen.ts`: prompt, parse, safe subset, contrast, unique id; unit tests [FR-016, FR-017]
- [x] T021 `generateText` for Claude (CLI one-shot) and Codex (ephemeral thread), plus the simulator and the fake adapter; capability `oneShot` [FR-015]
- [x] T022 IPC `theme:generate` and `theme:saveGenerated`; the store writes a validated manifest [FR-014, FR-018]
- [x] T023 Settings dialog: describe, harness, Generate, preview, Try it / Save / Discard / Try again; screenshots; real checks on Claude and Codex [FR-014]
- [x] T024 Export the active theme: read at click time, explain built-ins, mark the new pick at once, allow a new folder [FR-019]
- [x] T025 Dark themes and generated art: all tokens, the CSS whites tokenized, contrast and top-bar checks, up to 3 fix passes, art through the sanitiser; idea chips and the try bar [FR-017, FR-020, FR-021]
- [x] T026 (#301) Copilot `generateText` on a throw-away SDK session (`oneShotConfig`: no tools, no MCP, no skills or agents, nothing kept; permissions denied; timeout; disconnect and delete in a `finally`); AI credits passed through `theme:generate` to the dialog; capability `oneShot`; simulator; `test:copilotoneshot` on the fake SDK [FR-015]
- [x] T027 (#301) Real check of T026: needs the owner's go-ahead: 1 prompt on a free plan (record as `real:` in FR-015; also confirm on disk that the session is gone and that `availableTools: []` really means no tools) Done 2026-10-20 (2 prompts, 0.50 AI credits, `scripts/themegen-copilot-real.ts`): text returned, no tool event, nothing left in `session-state`; found and fixed the bare token names (FR-022).
- [x] T028 Retake `docs/screenshots/040-aitheme-*.png` and `040-aitheme-preview-*.png`: the dialog now lists Copilot first in the simulator (`scripts/shots-040-aitheme.js` updated, not run here)

## 2026-10-21: theme art on every surface (owner report)

- [x] T029 A theme switch redraws desks, helper tiles and walkers (theme key in the scene signature, the scene cache and the walkers); the same id with other content is applied; headwear over the hair; character, desk and monitor art on every scene kit; the AI prompt updated; unit tests [FR-023]
- [x] T030 Sample AI-style pack `scripts/fixtures/themes/pink-studio.json` and `scripts/check-theme-art.js` (`npm run check:theme-art`, in `check:ui`): desks, walkers, lobby places and chips at 1440x900 and 1280x800, pixels and attributes, and back to Clean Office [FR-023]
- [x] T031 Review of PR #496: tests that catch the headwear drawing order (office and kits) and the art on another kit (`check:theme-art` court-indian pass); driver screenshots in `os.tmpdir()`; `[KNOWN GAP]` for art shaped for the office figure [FR-023]
- [x] T032 Re-review of PR #496 (2026-10-22): the doubled usage line in the `check-theme-art.js` header is gone; the positive pixel checks (pinks, chair, walker) read the capture again up to 4 times, a frame apart, before failing (a capture under load can show an unpainted frame; the bar is unchanged)
- [x] T033 One-shot reply limit of its own (`ONE_SHOT_MAX_CHARS`) for Claude `generateText`; test with a 30 KB reply [FR-024]
- [x] T034 Scenery slots (`room-back-wall`, `room-back-window`, `room-floor`, `desk-back`) in `GEN_ART`; grouped tokens with meanings in the prompt [FR-025, FR-026]
- [x] T035 Contrast pairs: room tints (text), `--brand-bg` on `--raised`/`--bg` and the primary button text (UI styles with `--brand-bg`); unit tests per pair [FR-027]
- [x] T036 Art style guide in the prompt and `artWarnings` (sparse, thin, tiny) [FR-028]
- [x] T037 Place names at most 14 characters, in the prompt and the parser [FR-029]
- [x] T038 Lobby art: the "+" button above the band, user-theme band keeps its proportions (decided by `THEME.isBuiltIn`, unit-tested in `test:theme`); `check:theme-art` and `check:office` checks [FR-030]

## Changes 2026-10-31 (owner decision, spec 021 FR-067): AI theme maker retired

- [x] T039 `theme:remove` with a confirm and a Remove button on saved themes; can land first. Test: `test:userthemes`: a link in the folder is not followed; the theme in use goes to Clean Office; `sim:` both sizes [FR-032]
- [x] T040 Freeze: no new work; one line in `docs/themes.md`, no code. Test: `read:` [FR-031]
- [x] T041 Remove FR-031's list (built ahead of spec 102 T061..T063, T120; see the order-of-work note in the spec); tests in `test:themegen` keep the helpers, the rest go; `screens.js` maker parts go unless 096 or 102 uses them; docs, README, screenshots, changelog fragment in that PR (spec 021 FR-068). Test: `test:themegen`, `test:userthemes`, `test:ui-suite`, `npm run shots:docs`; `git grep` for the removed names is empty [FR-031, FR-033]
- [x] T042 076's keys become no-ops and its FR-091, FR-158 are updated. Test: `read:` [FR-031]

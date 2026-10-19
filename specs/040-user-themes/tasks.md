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

- [ ] T020 `themegen.ts`: prompt, parse, safe subset, contrast, unique id; unit tests [FR-016, FR-017]
- [ ] T021 `generateText` for Claude (CLI one-shot) and Codex (ephemeral thread), plus the simulator and the fake adapter; capability `oneShot` [FR-015]
- [ ] T022 IPC `theme:generate` and `theme:saveGenerated`; the store writes a validated manifest [FR-014, FR-018]
- [ ] T023 Settings dialog: describe, harness, Generate, preview, Try it / Save / Discard / Try again; screenshots; real checks on Claude and Codex [FR-014]


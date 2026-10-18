# Tasks: User themes (spec 040)

- [ ] T001 `src/shared/themes.ts` validation + caps with tests
- [ ] T002 `src/main/themes.ts`: list/get/import/export + unit tests (`test:userthemes`)
- [ ] T003 IPC + preload bridge
- [ ] T004 Settings Theme section: list user themes, Import/Export, toasts; startup resolution in app.js
- [ ] T005 Gates: typecheck/build/test/check:themes incl. a fixture user theme
- [ ] T006 Expanded user slots: room-*/char-*/desk-art/door-art/lobby-art/place-* validate and sanitize through the same path as built-ins (covered by test:theme art-expansion cases)

## Changes 2026-10-18 (review of PR #137)

- [ ] T007 Sanitizer rebuilds fragments (quoted values only, escaped re-serialization, local `url(#id)` only); Paco's bypass cases in `test:theme` [FR-005]
- [ ] T008 Token keys limited to Clean Office keys and values to the token grammar, in the renderer and on import in main; words limited to scene keys and 40 characters; tests [FR-006, FR-007]
- [ ] T009 Review follow-ups: no folder path in `theme:listUser`, import cleans up its temporary folder on error, `DURBAR_PICK` keeps Windows paths, `DURBAR_THEME` does not persist; tests where pure [FR-008]

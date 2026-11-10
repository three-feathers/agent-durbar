# Tasks: 112 Search in Settings

**Input**: [spec.md](spec.md), [plan.md](plan.md). **Tests first**, 0 AI credits, simulator only. One PR per phase (P1..P5); Refs #1471 until P5 closes it. Numbers checked against `main`, remote branches and open PRs on 2026-11-10 (`npm run specs:numbers`). Q1..Q10 are decided (owner, Paco, terminal, 2026-11-10: every recommended option); the tasks follow them.

## Spec

- [ ] T001 Spec, plan, tasks and the specs-index block (`specs/112-settings-search/`). Check: `npm run specs:check`, `npm run specs:index -- --check`, `npm run rules:check`, `npm run specs:numbers`.
- [x] T002 (2026-11-10) The owner's answers to Q1..Q10 (Paco, terminal: every recommended option) are recorded under *Clarifications*; FRs, plan and tasks follow them.

## P1: pure module

- [ ] T003 [P] `scripts/test-settings-find.ts` first (fails without the module): fold (case, accents), every word in any order, a word only in `data-find`, blank query shows all, 200-character query, linear time on 100 KB (CPU time, two sizes 8x apart). `npm run test:settingsfind` in `package.json` and `scripts/test-suites.txt`.
- [ ] T004 `src/renderer/settingsfind.js` (`window.DurbarSettingsFind`, UMD): `textOf`, `match`, using `DurbarSessionSearch.fold`/`terms`; passes T003. Line in `scripts/copy-assets.js`, `<script>` tag in `index.html` after `sessionsearch.js`.
- [ ] T005 Highlight ranges come from `DurbarSessionSearch.locate` (`sessionsearch.js:36`, spec 095 FR-040), no new range code; T003's file gains cases: ranges over accented text map back to the original words.
- [ ] T006 `countText(n)` and `noMatch(query, mask)`: mask before cut, 60 characters, a throwing masker gives the plain line; its own function in `settingsfind.js` with the rule of `notes.js:140-145`, and an equality test running both on one corpus (`notes.js` unchanged). Mutants: AND to OR, fold removed, keywords ignored all fail T003.

## P2: field and filter

- [ ] T007 Field (FR-001) in a side column before `#scrNav` in `paintSettings` (`screens.js:474`), `.nt-find` style, tokens only; `test:theme-tokens` green.
- [ ] T008 `wireSettingsFind()` after `wireSettingsNav()` (`screens.js:508`): read sections, 150 ms settle, hide non-matching sections, scroll to top, restore scroll on clear (FR-004).
- [ ] T009 `paintNav` (`screens.js:778`) skips hidden sections; `test:settingsnav` case for it (FR-006); pointer delta under `## Changes` in `specs/052-usability-pass/spec.md` (FR-226).
- [ ] T010 Count announcement through `X.announce` only when the count changes (FR-009).
- [ ] T011 No-match line and **Clear search** button, focus back to the field (FR-009).
- [ ] T012 Escape in the field with text clears it and keeps Settings open (`app.js:4220` branch); empty field: Escape closes as today (FR-008).
- [ ] T013 Enter jumps to the first shown section and focuses its heading; ArrowDown moves to the first list entry (FR-008).
- [ ] T014 Lifetime: `findQ` kept across `paintSettings` repaints (value, results, focus); cleared on close and on open at a section (FR-011).
- [ ] T015 Narrow layout (container under 760 px): field full width above the row (FR-012).

## P3: marks, collapsed and live parts

- [ ] T016 Highlight with `CSS.highlights` (`durbar-find`) over `locate` ranges, token background plus underline, feature-detected (FR-007).
- [ ] T017 Open the `<details>` that hold a match; close only those the search opened and the person did not toggle; `advOpen` untouched (FR-005).
- [ ] T018 Subtree observer on `.scr-body` (childList and characterData only, debounced) re-matches late parts; a removed section leaves the results (FR-010).
- [ ] T019 `data-find` keywords on each section's own template (Q1 d, decided), at least: Theme (dark, colour, look), Spending limit (budget, cost, cap, credits), Keyboard (shortcut, hotkey), Notifications (alert), Motion (animation), Agent apps (install, update, sign in, login). The list is shown to the owner in the PR (wording only; the mechanism is decided).
- [ ] T020 Contrast of the mark against `--surface` in every world (check in T023's driver).

## P4: the find key

- [ ] T021 ⌘F / Ctrl+F in Settings focuses and selects the field; pressed in the field, the navigator as today; not under a dialog; `TAKEN` unchanged (FR-008). `DurbarScreens.isSettings()` accessor.
- [ ] T022 Pointer delta under `## Changes` in `specs/074-keyboard-navigator/spec.md` (FR-002: Settings owns the first press of ⌘F / Ctrl+F); the Keyboard section's note and the `?` shortcut sheet name it.

## P5: driver, pictures, docs

- [ ] T023 `scripts/check-settings-find.js` in `scripts/ui-suite.js`: flat, retro, real photo, cave, loft (as `check-settings-nav` sets them) at 1440x900 and 1280x800, plus 640 wide; US1..US4 scenarios; real key events; `#srAnnounce` read with a `MutationObserver` list (agent-notes: 60 ms rule).
- [ ] T024 Mutation checks for T023: filter off, list not following hidden sections, Escape closes instead of clearing, find key always navigator, find key always field; each fails the driver. Record them in the PR.
- [ ] T025 `check-settings-nav` passes unchanged with an empty search (SC-004); SC-003 timing measured and written in the spec.
- [ ] T026 Screenshots `docs/screenshots/112-settings-find-1440x900.png` and `-1280x800.png` (a search for `limit`, flat office) through a `DOC_SHOTS` entry in `scripts/shots-docs.js`; one capture per world at both sizes looked at (not committed unless linked); compressed.
- [ ] T027 Docs: `docs/feature-inventory.md` row (every world), `docs/features.md` Settings paragraph, `changelog.d/112-settings-search.md` fragment (the README lists no Settings features, `read:` 2026-11-10, so it is not changed).
- [ ] T028 `npm run typecheck && npm run build && npm test` once at the final `checks run at <sha>`.
- [ ] T029 `/speckit.converge`: tags on FR-001..FR-013 (`[IMPLEMENTED]` with `test:`/`sim:`, or `[KNOWN GAP]`), specs-index status, tasks ticked.

## Checks a person does (not CI)

- [ ] T030 `[KNOWN GAP]` until done: VoiceOver on a Mac and NVDA on Windows read the field's name, the count and the no-match line; the find key on a real Mac keyboard. No AI credits needed.

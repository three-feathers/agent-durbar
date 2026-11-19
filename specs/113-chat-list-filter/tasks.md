# Tasks: 113 Chat list filter and Search conversations with a chat open

**Input**: [spec.md](spec.md), [plan.md](plan.md). **Tests first**, 0 AI credits, simulator only. One PR per phase (P1..P5); Refs #1870 until P5 closes it. Numbers checked against `main` (`e35ebf76a`), remote branches and open PRs on 2026-11-18. Q1..Q8 are decided (owner, Paco, terminal, 2026-11-19: every recommended option); the tasks follow them.

## Spec

- [ ] T001 Spec, plan, tasks and the specs-index block (`specs/113-chat-list-filter/`). Check: `npm run specs:check`, `npm run specs:index -- --check`, `npm run rules:check`, `npm run specs:numbers`.
- [x] T002 (2026-11-19) The owner's answers to Q1..Q8 (Paco, terminal: every recommended option) are recorded under *Clarifications* and a dated *Changes* entry; FRs, plan and tasks follow them, and the branches for options not chosen are removed.

## P1: pure module

- [ ] T003 [P] `scripts/test-rail-filter.ts` first (fails without the module): the four fields joined with spaces (no cross-field word), fold (case, accents), every word any order, a word in the folder only, blank shows all, 200-character query, 2 000-character cap, linear time on 500 rows (CPU time, two sizes 8x apart). `npm run test:railfilter` in `package.json` and `scripts/test-suites.txt`.
- [ ] T004 `src/renderer/railfilter.js` (`window.DurbarRailFilter`, UMD): `rowText`, `match` on `DurbarSessionSearch.fold`/`terms`; passes T003. Line in `scripts/copy-assets.js`, `<script>` after `sessionsearch.js` in `index.html`.
- [ ] T005 `countText(n)`, `noMatch(query, mask)` (mask first, cut 60, plain line when the masker throws) and `searchRowText(query, mask)`; equality test with `notes.js` `noMatch` on one corpus (`notes.js` unchanged).
- [ ] T006 Mutants AND→OR, fold removed, folder ignored each fail T003; recorded in the PR.

## P2: field and filter

- [ ] T007 Measure first (spec 005 FR-195): with a 32 px placeholder row in `railHTML()` on a scratch build, `check-rail`'s `RAIL` lines at both sizes, notice bar on and off; write the numbers into the spec (Q3 a).
- [ ] T008 `scripts/check-rail-filter.js` skeleton in `scripts/ui-suite.js` (five worlds, both sizes) with the P2 steps failing first.
- [ ] T009 Field row in `railHTML()` (`app.js:8084`) under *Your door*, full rail width (Q3 a), `.nt-find` look, tokens only; `test:theme-tokens` green (FR-001).
- [ ] T010 Filter in `renderStrip()` (`app.js:8112`): matching rows only, empty folders not painted, "k of n" counts, collapsed folders' matches shown without writing `RAIL_FOLDS`, the open chat's row always kept, marked "open, does not match" (Q7 a) (FR-004).
- [ ] T011 Count announcement on settle (150 ms) and only on change; "All chats shown" on clear (FR-005).
- [ ] T012 No-match line with `textContent`/`esc()` (FR-006).
- [ ] T013 Keys: Escape clears first (branch beside `#prevQ`, `app.js:4642`), empty Escape closes the chat as today; ArrowDown to the first row; Enter opens the first match (Q1 a) (FR-010).
- [ ] T014 Lifetime: words kept across `openPanel`'s rebuild (`app.js:3090`) and repaints, focus/selection only if held; cleared by `closePanel` (`:4287`) (Q6 a, FR-008).
- [ ] T015 Pointer delta in `specs/005-chat-fullscreen-and-agent-strip/spec.md` `## Changes`: FR-190's rows gain the field; FR-195's limit set to T007's measure (Q3 a); `check-rail.js:97` updated with it.

## P3: Search conversations from a chat

- [ ] T016 Driver steps first in `check-rail-filter.js` for US2.
- [ ] T017 "Search messages for …" row, disabled under 3 characters, absent when `csAvailable()` is false (FR-020, Q1 a).
- [ ] T018 `railSearchMessages()`: hands the words to `csRun` via `#convSearch`, remembers the chat (`CS.panel` + a rail flag so `csRun`, `app.js:2313`, does not drop it) (FR-021, Q2 a).
- [ ] T019 Return to the chat on Escape / clear from a rail-started search (`csEnd`, box Escape `app.js:2458-2466`); office starts unchanged, `shots-095` green (FR-022, Q2 a). Pointer delta in `specs/095-search-conversations/spec.md` (FR-002, FR-003).
- [ ] T020 Shortcut with a chat open focuses the rail field (branch `app.js:4586`, `csFocusBox` `:2446`, the palette item), `TAKEN` unchanged; `?` sheet and Settings > Keyboard note (FR-011, Q5 a); no spec 074 delta (⌘F unchanged).

## P4: highlight

- [ ] T021 `durbar-find` highlight over `locate` ranges in shown names and headings, recomputed after each paint, feature-detected; shared CSS with spec 112 (FR-007, Q4 a).
- [ ] T022 Contrast pairs of spec 112 FR-007 in every world, in the driver.

## P5: driver, pictures, docs

- [ ] T023 `check-rail-filter` complete: every FR's acceptance, rail at 180 px, 640x480, darwin, `railstore=1` folds unchanged, hostile markup, token masking.
- [ ] T024 Mutants of FR-032 each fail the driver or unit test; recorded in the PR.
- [ ] T025 SC-003 timing (40 agents) measured and written in the spec; `check-rail` and `shots-095` green.
- [ ] T026 Screenshots `docs/screenshots/113-rail-filter-1440x900.png` and `-1280x800.png` (Flat, a folder query) via `scripts/shots-docs.js`; every world looked at both sizes; compressed.
- [ ] T027 Docs: `docs/feature-inventory.md` row, `docs/features.md` chat paragraph, `changelog.d/113-chat-list-filter.md`.
- [ ] T028 `npm run typecheck && npm run build && npm test` once at the final `checks run at <sha>`.
- [ ] T029 `/speckit.converge`: FR tags (`[IMPLEMENTED]` with `test:`/`sim:`, or `[KNOWN GAP]`), specs-index status, tasks ticked.

## P6: Recent order (FR-040..FR-044)

- [ ] T031 `DurbarRail.recent(items)` in `src/renderer/railorder.js` with unit tests (FR-041), mutant "order by agent time" fails.
- [ ] T032 `youAt` stamped on your sends; load/save helper for `durbar.railYouAt` (cap 500, unknown ids, bad JSON), only with `rememberOn()` and not in demo (FR-042).
- [ ] T033 The Folders | Recent control in the filter row; order kept in `durbar.railOrder` (FR-040, FR-044).
- [ ] T034 `renderStrip` paints the flat Recent list with the folder name per row, `parent/name` for same-name folders (FR-043); the filter applies; folds untouched.
- [ ] T035 Driver cases in `check-rail-filter` for FR-040..FR-044 and SC-005, both sizes, every world, `railstore=1`.
- [ ] T036 Screenshots `113-rail-recent-{1440x900,1280x800}.png`; docs rows (feature inventory, features.md, changelog fragment) extended.
- [ ] T037 `npm run typecheck && npm run build && npm test` once at the final `checks run at <sha>` of P6.

## Checks a person does (not CI)

- [ ] T030 `[KNOWN GAP]` until done: VoiceOver and NVDA read the field, the count, the no-match line and the search row; the shortcut on a real Mac keyboard. No AI credits needed.

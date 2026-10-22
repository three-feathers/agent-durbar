# Tasks: Keyboard navigator

**Input**: [spec.md](spec.md), [plan.md](plan.md), [data-model.md](data-model.md), [contracts/keys.md](contracts/keys.md), [quickstart.md](quickstart.md)
**Tests**: requested by the issue and the owner (unit tests for the level/filter logic and chat numbering, an asserting simulator driver).

## Phase 1: Setup

- [x] T001 Create the pure module skeleton `src/renderer/navigator.js` (UMD like `keys.js`: `module.exports` in Node, `window.DurbarNav` in the page); load it in `src/renderer/index.html` before `app.js` and copy it in `scripts/copy-assets.js`
- [x] T002 [P] Add `scripts/test-navigator.ts` and the `test:navigator` script to `package.json` (and to `test:serial`)

## Phase 2: Foundational (blocks every story)

- [x] T003 `rank(items, q)` in `src/renderer/navigator.js`: the palette's matching (start of label, start of a word, anywhere, then `kw`; stable order); `palFilter` in `src/renderer/app.js` uses it (no behaviour change for Ctrl+K)
- [x] T004 Chat numbers in `src/renderer/navigator.js`: `assignNumbers(map, ids)` (lowest free positive number per new id, existing numbers kept), `pruneNumbers(map, ids)`, `loadNumbers(json)` ("at most 500 entries; invalid entries dropped on load"); unit tests in `scripts/test-navigator.ts`
- [x] T005 Chat numbers in `src/renderer/app.js`: assign on every agent add, save under `durbar.chatNo` only when `rememberOn()`; prune once after the agent list has loaded; `chatNoOf(agent)` helper; no numbers for helpers

## Phase 3: User Story 1 - jump to a numbered chat (P1)

**Independent test**: shortcut, `c`, `3`, type, Enter → the message is in chat 3.

- [x] T006 [US1] `levelItems(snapshot, level)`, `parseStart(q)` (`f `, `c `, `c<digits>`, `c <digits>`; `f`/`c` + a letter is plain filter text) and `pickNumber(items, digits)` (unique → item, ambiguous → highlight only, none → null) in `src/renderer/navigator.js`, with unit tests
- [x] T007 [US1] Shortcut combo in `src/renderer/navigator.js`: `DEFAULT_COMBO` `{mod:true, code:'KeyJ'}`, `comboFromEvent`, `comboMatches` (via `modDown` semantics: ⌘ on a Mac, Ctrl elsewhere, never both), `comboParts`, `loadCombo`; unit tests for Mac and non-Mac
- [x] T008 [US1] Palette Go-to mode in `src/renderer/app.js`: `openPalette({nav:true})` with a level stack, breadcrumb line (`#palCrumb`, the dialog's `aria-describedby`), item numbers, empty-state text ("No chat 7"; nothing to go to yet), announcements of level and count; picking an agent or chat calls `openPanel(id,false)` then focuses `#msgInput` with the cursor at the end (else the chat title)
- [x] T009 [US1] Global key handler in `src/renderer/app.js`: the navigator combo opens the navigator from anywhere (text fields too) unless another `aria-modal` dialog than the palette is open; pressed with the navigator open it closes; pressed in Ctrl+K it switches to the start level
- [x] T010 [US1] Chat-number badges `C3` (aria "chat 3", ≥ 10.5px, text) on desk cards in every density, list rows, the chat header, the strip tooltips and the palette's agent hints in `src/renderer/app.js` and `src/renderer/styles.css`

## Phase 4: User Story 2 - floor → folder → agent (P1)

- [x] T011 [US2] Start level: floors that are on when two or more are on, else the folders; plus the **Folders** / **Chats** rows; the folders level filtered by floor; a folder with one session opens its chat directly (`src/renderer/navigator.js` + `src/renderer/app.js`)

## Phase 5: User Story 3 - Escape steps back (P1)

- [x] T012 [US3] Escape and Backspace-on-empty step back through the level stack, restoring that level's filter and highlight; Escape at start closes and returns focus (`src/renderer/navigator.js` stack helpers `push`/`back`, unit-tested; wiring in `src/renderer/app.js`)

## Phase 6: User Story 4 - choose my own shortcut (P2)

- [x] T013 [US4] `clashOf(combo, mac)` in `src/renderer/navigator.js`: refuses no modifier, Super/Win on Windows and Linux, the app's shortcuts, text-editing and window keys, and the known OS shortcuts listed in spec FR-014, each with a sentence naming the owner; unit tests per platform
- [x] T014 [US4] Settings > Keyboard in `src/renderer/screens.js` (section, **Change…** records the next combination, Escape cancels, refusal message, **Reset to default**) wired from `src/renderer/app.js` (`navKey:{get,set,reset,label}`), saved under `durbar.navKey`

## Phase 7: User Story 5 - discover it (P3)

- [x] T015 [US5] The `?` sheet lists the current navigator shortcut and an "In the navigator" table; Ctrl+K has "Go to… (navigator)" with the shortcut; the palette foot line in Go-to mode names ↑↓, Enter, Esc back, F, C (`src/renderer/app.js`)

## Phase 8: Polish and checks

- [x] T016 Simulator driver `scripts/shots-074-navigator.js` (asserting; listed in `scripts/ui-suite.js` with `DURBAR_SIM_FLOORS=1`): full flow (open → floor → folder → agent → type → Enter sends), `c 3`, Esc chain with focus return, shortcut change and a refused clash, badge sizes, screenshots at 1440x900 and 1280x800 in `docs/screenshots/074-navigator-*`
- [x] T017 Office layout with badges: run the 15-agent overlap check (`scripts/check-office-overlap.js`) at both sizes
- [x] T018 [P] Docs: README keyboard section, `changelog.d` fragment, spec status and index block (`npm run specs:index`), `docs/agent-notes.md` entry if something was learned
- [x] T019 `nice -n 19 npm run typecheck && npm run build && npm test`; `git merge-tree` against `origin/005-composer-toolbar` (#498) and `origin/073-slash-suggestions` (#535) before the PR

## Phase 9: Review round 1 (fjcabello, PR #552, spec Changes 2026-10-23)

- [ ] T020 FR-012: the desk-card chat number on the scene's corner in every card density (`src/renderer/styles.css`); `check:office` and `shots-074-navigator` at both sizes
- [ ] T021 FR-014: refuse ⌃+Cocoa text keys on a Mac and Ctrl+Shift+U / E elsewhere, with reasons; unit tests (`src/renderer/navigator.js`, `scripts/test-navigator.ts`)
- [ ] T022 FR-014: reserve `mod+shift+KeyS` (Schedules, #560) in `TAKEN`; a unit test that every Ctrl/⌘ shortcut of the global keydown handler is refused
- [ ] T023 FR-017: `comboFromEvent` keeps the typed letter; `clashOf` refuses a taken position or letter; `comboMatches` leaves a press whose letter is another shortcut's; unit tests with a Dvorak press
- [ ] T024 FR-016: the empty reason in the announcement, no `role` on the empty text (`src/renderer/app.js`)
- [ ] T025 Driver: a hostile agent name in Go to stays literal text (`scripts/shots-074-navigator.js`)
- [ ] T026 Mutation-check T020-T023, then `nice -n 19 npm run typecheck && npm run build && npm test`, `shots-074-navigator` and `check:office` once on the final head

## Dependencies

T001 → T003-T007 → T008-T010 (US1) → T011 (US2) → T012 (US3); T013-T014 (US4) need T007; T015 needs T008 and T014; T016-T019 last. US2 and US3 extend the same palette code as US1, so they follow it.

## Parallel opportunities

T002 alongside T001; inside Phase 2 the pure functions (T003, T004) and their tests; T013 alongside T008-T012 (pure, separate functions); T018 alongside T016-T017.

## Implementation strategy

MVP = Phases 1-3 (shortcut, `c 3`, badges). Then floors/folders, Esc stack, Settings, discovery, checks. One PR (issue #548).

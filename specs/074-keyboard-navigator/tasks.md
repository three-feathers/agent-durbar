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

- [x] T020 FR-012: the desk-card chat number on the scene's corner in every card density (`src/renderer/styles.css`); `check:office` and `shots-074-navigator` at both sizes
- [x] T021 FR-014: refuse ⌃+Cocoa text keys on a Mac and Ctrl+Shift+U / E elsewhere, with reasons; unit tests (`src/renderer/navigator.js`, `scripts/test-navigator.ts`)
- [x] T022 FR-014: reserve `mod+shift+KeyS` (Schedules, #560) in `TAKEN`; a unit test that every Ctrl/⌘ shortcut of the global keydown handler is refused
- [x] T023 FR-017: `comboFromEvent` keeps the typed letter; `clashOf` refuses a taken position or letter; `comboMatches` leaves a press whose letter is another shortcut's; unit tests with a Dvorak press
- [x] T024 FR-016: the empty reason in the announcement, no `role` on the empty text (`src/renderer/app.js`)
- [x] T025 Driver: a hostile agent name in Go to stays literal text (`scripts/shots-074-navigator.js`)
- [x] T027 Review round 2: handler scan normalises CRLF, finds `e.key` matches, planted-shortcut mutation test (`scripts/test-navigator.ts`)
- [x] T028 Review round 2: Mac Dvorak gap in FR-017, README, Settings note, research R4/R5; FR-012 wording (card densities only)
- [x] T029 Review round 3 (fjcabello): the handler scan normalises app.js to LF before it derives the CRLF/BOM variants (a Windows checkout is already CRLF, so the old CRLF case made \r\r\n and the locator failed); unit cases for CRLF and BOM input
- [x] T030 UI driver: "names keep room" no longer asks for a 20px floor (Elif is 19.3px in Windows fonts, 20px on Linux, with no badge near it); it asks that no name is wider than its box. Mutation-checked: a 15px cap on card names fails it
- [ ] T026 Mutation-check T020-T023, then `nice -n 19 npm run typecheck && npm run build && npm test`, `shots-074-navigator` and `check:office` once on the final head

## Phase 10: Follow-up, issue #587 (spec Changes 2026-10-23: Ctrl+F, cursor in the message box, Ctrl+Backspace, Ctrl+A)

Tests first: T031-T032 are written and fail before T033-T037.

- [x] T031 [P] Unit tests in `scripts/test-navigator.ts`: the default is Ctrl/⌘+F and free on every OS, Ctrl/⌘+J no longer taken, Mac Dvorak ⌘ at F (types U) matches; `textSafeKey`: Ctrl+A → inbox and Ctrl+Backspace → office (⌘ on a Mac, never Ctrl+⌘, never with Shift or Alt, not while composing), nothing in an editable field, with a selection or a dialog, Ctrl+A not in the chat log, Ctrl+Backspace with attachments → `attached`; a non-Latin layout (code KeyA, key "ф") still counts and AZERTY Ctrl+Q (code KeyA, key "q") does not; `mod+Backspace` and `mod+KeyA` named in `TAKEN`
- [x] T032 [P] Driver `scripts/shots-074-navigator.js`: Ctrl/⌘+F opens Go to and Ctrl/⌘+J does nothing; composer safety (type text, Ctrl+Backspace deletes normally and the chat stays, Ctrl+A selects all and Needs you stays closed, an empty box keeps the chat on Ctrl+Backspace); outside text Ctrl+A opens Needs you and Ctrl+Backspace goes back to the office; Ctrl+A in the chat log and with a selection does nothing of ours; the unsent text is back when the chat reopens; the cursor is in the message box after a mouse click on a desk, Enter on a desk, a list row and a Ctrl+K pick; a chat that waits for an answer gets the message box, not the answer bar, and stays waiting
- [x] T033 `src/renderer/navigator.js`: `DEFAULT_COMBO` code `KeyF`; `textSafeKey(e, mac, ctx)`; `TAKEN` adds `mod+Backspace` (Back to the office) and names Needs you on `mod+KeyA`; export `takenBy`
- [x] T034 `src/renderer/app.js`: the global handler calls `textSafeKey` (inbox, office, or a calm note when attachments wait); `focusComposer` used by `openPanel(id, true)` and every user open (desk and list clicks by mouse too, strip, palette, inbox, previous chat, the navigator; next agent keeps the title so N, N walks the queue); per-chat unsent text kept in memory (`DRAFTS`) on close and on opening another chat
- [x] T035 Discovery: the `?` sheet rows (Ctrl+A outside text, Ctrl+Backspace back to the office), the Needs you button's tooltip and `aria-keyshortcuts` (`src/renderer/index.html`), Settings > Keyboard note (`src/renderer/screens.js`), comments naming Ctrl+J
- [x] T036 Docs: README (Go to bullet, Mac shortcuts line, Needs you), `contracts/keys.md`, `quickstart.md`, `changelog.d/074-navigator-keys.md`, spec index block; screenshots `074-navigator-*` and `052-shortcuts-*` at both sizes
- [x] T037 Mutation-check T031-T032, then `nice -n 19 npm run typecheck && npm run build && npm test`, `shots-074-navigator` once on the final head

## Phase 11: Draft marker, issue #612 (spec FR-022 amended, FR-024)

- [x] T038 Driver step first in `scripts/shots-074-navigator.js`: draft in A, switch to B, the pencil on A (strip, desk, list row; tooltip and name), A's text back, send clears it, emptying B clears B's; screenshot `074-navigator-drafts-*`
- [x] T039 `src/renderer/app.js`: `DRAFTS` keeps text and attachments; `draftHTML` / `draftWords` on desks (card, full, lounge), list rows and strip items; drafts dropped when a session is removed; the `attached` case of `textSafeKey` removed (`src/renderer/navigator.js`, `scripts/test-navigator.ts`); `.draft-mark` in `src/renderer/styles.css` (tokens only)
- [x] T040 Mutation-check T038, README and changelog, `npm test`, the driver once on the final head

## Phase 12: Review on #597 (fjcabello)

- [x] T041 Dialog guard covers `aria-modal="true"` (askDialog's alertdialog) for Ctrl+A, Ctrl+Backspace and the Go-to shortcut; driver step with *End all sessions?* open; mutation-checked
- [x] T042 Ending a session drops its draft (`dropDraft` in `endLive` and `endAllSessions`); driver step; mutation-checked; Clarification updated
- [x] T043 `check-done-desk-mask` (Ctrl+F) and `check-grant-chips` (cursor in the message box, no late focus move); `until` instead of fixed pauses in `shots-074-navigator`
- [x] T044 Merge main (#592: the restored draft keeps the chosen height); `npm test`, `shots-074-navigator`, `check-done-desk-mask`, `check-grant-chips` twice

- [x] T045 Spec 052 FR-175: one `modalOpen()` helper (any `aria-modal`) for every global shortcut that waits for no dialog (Ctrl+O, Ctrl+`, Ctrl+Shift+H, the chat answer keys, I, ?, N); driver step under *End all sessions?*; mutation-checked

- [x] T046 Focus return after the office redraws (`liveBack` in `closePalette`); `focusOn` waits (8 s) for every focus check in `shots-074-navigator`, with the actual focus in the failure message

## Dependencies

T001 → T003-T007 → T008-T010 (US1) → T011 (US2) → T012 (US3); T013-T014 (US4) need T007; T015 needs T008 and T014; T016-T019 last. US2 and US3 extend the same palette code as US1, so they follow it.

## Parallel opportunities

T002 alongside T001; inside Phase 2 the pure functions (T003, T004) and their tests; T013 alongside T008-T012 (pure, separate functions); T018 alongside T016-T017.

## Implementation strategy

MVP = Phases 1-3 (shortcut, `c 3`, badges). Then floors/folders, Esc stack, Settings, discovery, checks. One PR (issue #548).

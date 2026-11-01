# Tasks: 033 floors

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/ipc-floors.md](contracts/ipc-floors.md), [quickstart.md](quickstart.md)

**Tests**: required by the constitution (VII.3: folder store logic needs a test in `scripts/`) and by SC-002, SC-004, SC-005, SC-006. All on the simulator or in Node; 0 AI credits.

**Format**: `- [ ] Tnnn [P?] [USn?] description (file) [requirements]`. `[P]` = can run in parallel (different files, no unfinished dependency).

## Phase 1: Setup

- [x] T001 Spec, two clarification sessions, plan, research, data model, contract, quickstart and these tasks committed before any `src/` change; row in `specs/README.md`

## Phase 2: Foundational (blocks every story)

- [x] T002 [P] Pure module `src/shared/floors.ts` (no Electron, no fs): types `Floor {id,name,on}`, `FloorsDoc {floors, lastFloor}`; `GROUND = 'ground'`, default name "Ground floor"; `parseFloors(unknown)` (drops bad entries, max 40 floors, always puts `ground` at position 0 if missing, ids `ground` or `f-` + 8 lowercase alnum, unknown `lastFloor` → `ground`); `validName(name, floors, exceptId?)` ("Trimmed, 1 to 40 characters, no control characters. Unique ignoring case"); `newFloorId(existing)`; `createFloor`, `renameFloor`, `reorderFloors` (must be a permutation), `deleteFloor` (refused for `ground`; returns ids of folders to reset), `setFloorOn`, `onlyFloor`, `floorOf(folderFloor, floors)` (missing/unknown → `ground`). All return `{ok, doc, error?}` and never mutate input [FR-001..FR-004, FR-014, FR-022]
- [x] T003 [P] `scripts/test-floors.ts`: every operation and refusal in the data-model table; names (empty, 41 chars, control chars, duplicate in other case, rename to own name allowed); 41st floor refused; `ground` cannot be deleted; delete resets `lastFloor`; reorder non-permutation refused; Only leaves exactly one on; parse of damaged input (not an object, `floors` not an array, duplicate ids, `__proto__` id, missing ground) → valid doc with ground on; add `test:floors` to `package.json` and to `npm test` [FR-001..FR-004, FR-014, FR-022, SC-006]
- [x] T004 FolderStore in `src/main/folders.ts`: read/write top-level `floors` and `lastFloor` and optional per-folder `floor` (not written when `ground`) through `src/shared/floors.ts`; `version` stays 1; methods `floorsState()`, `createFloor`, `renameFloor`, `reorderFloors`, `deleteFloor` (folders of the floor lose `floor` in the same atomic write), `setFloorOn`, `onlyFloor`, `moveFolder(workspace, floorId)`; `upsert` keeps an existing folder's `floor` and accepts one for a new entry (then sets `lastFloor`); no other folder field changes [FR-005, FR-014, FR-015]
- [x] T005 Extend `scripts/test-folders.ts`: round trip with floors; a file written before this feature (no `floors`) → one Ground floor on, every folder on it; moving or deleting never changes `permMode`, `hidden`, `closed`, `model`, `effort`, `contextTier`, `maxAiCredits`; unknown folder floor → ground; file mode 0600 kept [FR-005, FR-014, SC-004, SC-006]
- [x] T006 Types in `src/shared/api.ts`: `FloorView`, `FloorsState`, `FloorsResult`, `AgentInfo.floor?`, optional `DurbarApi` methods `floorsState`, `createFloor`, `renameFloor`, `reorderFloors`, `deleteFloor`, `setFloorOn`, `onlyFloor`, `moveFolderToFloor`; `SessionOptions.floor?` for add (per [contracts/ipc-floors.md](contracts/ipc-floors.md))
- [x] T007 Main IPC in `src/main/main.ts`: `floors:state|create|rename|reorder|delete|setOn|only|moveFolder` validated in main, folders resolved from an agent id with `wsKey` (like `folders:setHidden`), every agent of the folder updated; `byAgent` built from live agents; `AgentInfo.floor` set in `addWorkspace` and `restoreFolders`; add handlers accept `opts.floor` (unknown → ground) and save it; no handler touches a session [FR-005, FR-006, FR-009, FR-010]
- [x] T008 Preload bridge methods in `src/preload/preload.ts` for every channel of T007
- [x] T009 Renderer foundation in `src/renderer/app.js`: floor state loaded via `floorsState()` (demo mode or missing bridge method → single implicit floor, button hidden); `room.floor` from `AgentInfo.floor`; helper `roomShown(r) = !r.hidden && floor on`; replace the room-visibility `r.hidden` checks (office model, list view, folder-filter options, attention-sorted strip, `visibleAgents` used by the pills, lobby `placeVisitors`, Close all/Open all, empty-state test) with `roomShown`; `ledgerRemoved` stays on `r.hidden` only; layout cache key includes the ids of floors on [FR-008, FR-011, FR-020]
- [x] T010 Simulator in `src/renderer/sim.ts` and `src/main/main.ts`: in-memory floors with the same validation (shared module); `DURBAR_SIM_FLOORS=1` → `?simfloors=1` seeds Ground floor, Client A, Personal and spreads rooms over them; `DURBAR_SIM_FLOORS_OFF=<name>` → `?floorsoff=<name>` starts it off; default simulator unchanged (one floor) [FR-017]

**Checkpoint**: `npm run typecheck && npm run build && npm test` pass; app with and without `DURBAR_SIM_FLOORS` looks exactly as before (one floor, nothing new shown except the button).

## Phase 3: User Story 1 — Group folders into floors (P1) — MVP part 1

**Goal**: create floors, put folders in them, choose the floor when adding, survive restart.
**Independent test**: simulator with `DURBAR_SIM_FLOORS=1`: create a floor, move folders, see them under it; restart persistence via T005.

- [x] T011 [US1] Top-bar **Floors n/m** button and `#floorsPop` panel in `src/renderer/index.html` and `src/renderer/app.js`, same popover behaviour as `#foldersPop` (focus in, Esc closes, click outside closes): one row per floor in order with its folders listed below; "New floor" input + Create showing the error text from the bridge; floor and folder names escaped, long names shortened with an ellipsis and the full name in `title` [FR-003, FR-007, FR-018]
- [x] T012 [US1] Move folder: per-folder "Move to" select in the panel calling `moveFolderToFloor(agentId, floorId)`; state replaced by the returned `FloorsState`; office re-renders with the room under its new floor and nothing else about its agents changing [FR-005]
- [x] T013 [US1] Add into a floor: "New folders go to: <floor>" select at the top of the Floors panel, shown only when more than one floor exists, default `lastFloor`; `+ Folder` / `+ Workspace` tooltips name the target; value sent as `opts.floor` in `addVia` (moved from the top bar: no room at 1280x800, research R7) [FR-006]
- [x] T014 [P] [US1] Styles in `src/renderer/styles.css`: panel rows, folder rows, Move select, error line; text ≥10.5px [FR-018]

## Phase 4: User Story 2 — Switch a floor off (P1) — MVP part 2

**Goal**: off floors leave the office and the counts; Only.
**Independent test**: quickstart steps 2-6; `scripts/shots-033.js` asserts pills = visible agents.

- [x] T015 [US2] Per-floor switch in the panel: a `button` with `aria-pressed` and the word On/Off, calling `setFloorOn`; button label updates to "Floors n/m" [FR-007, FR-008, FR-018]
- [x] T016 [US2] **Only** action per floor calling `onlyFloor` [FR-022]
- [x] T017 [US2] Side effects after any floor change in `src/renderer/app.js`: reset the folder filter to "All folders" if its room is no longer shown; close the full-screen chat if its agent is now on an off floor (pending approvals untouched); empty state "All floors are off. Open Floors above to switch one on." when every floor is off and agents exist [FR-008, FR-010, FR-013, spec US2 #5 #7]
- [x] T018 [P] [US2] Office credit total: `tooltip()` in `src/renderer/usagetotals.js` gets `opts.offFloors` (a ledger total) and adds "<x> AIU of it from floors that are off"; `app.js` passes the sum of rooms on off floors; total value unchanged; test in `scripts/test-usagetotals.ts` [FR-016]
- [x] T019 [US2] Hidden folders in the panel: a `hidden` tag (word, not colour) on folders hidden with Folders → Hide [FR-021]

**Checkpoint (MVP)**: stories 1 and 2 work on the simulator; quickstart steps 1-6 and 8 pass.

## Phase 5: User Story 3 — Rename, reorder and delete floors (P2)

**Independent test**: quickstart step 7.

- [x] T020 [US3] Rename (inline field, same name rules and messages), Up/Down reorder (calls `reorderFloors` with the full new order), Delete with confirmation via the existing `askDialog` ("Delete floor X? Its N folders move to Ground floor. No session is ended."), Delete not offered for Ground floor, in `src/renderer/app.js` [FR-002, FR-004]

## Phase 6: User Story 4 — See which floor a room belongs to (P3)

**Independent test**: two floors on at 1440x900 and 1280x800 with 15 agents: labels in headers and plates, rooms grouped, no overlap.

- [x] T021 [US4] Order rooms by floor index (stable, existing order inside a floor) in `officeModel` and the list view; floor-name tag `<span class="floor-tag">` in `roomHTML` header and the door plate only when two or more floors are on; escaped, ellipsis with full name in `title`, ≥10.5px, text not colour [FR-012]
- [x] T022 [P] [US4] Floor tag styles in `src/renderer/styles.css` (shrinks first in narrow headers at `mini`/`micro`) [FR-012, SC-005]

## Phase 7: Polish and cross-cutting

- [x] T023 `scripts/check-office-overlap.js`: cases with `simfloors=1` (3 floors on, 2 on, 1 off) at 1440x900 and 1280x800, incl. doors closed; top bar has no overlap with the Floors button and the "into" select at 1280x800 [SC-005, FR-007]
- [x] T024 `scripts/shots-033.js` simulator driver: SC-002 (pills equal visible agents after each switch), no lobby figure of an off floor, Only, chat closes, all-off message, SC-003 timing (< 0.5 s per switch with 15 agents), screenshots `docs/screenshots/033-floors-*` at 1440x900 and 1280x800 (two floors on with labels; one floor off; the Floors panel) [SC-002, SC-003, FR-020]
- [x] T025 Docs (spec 025 rule): README feature list and status, known limits (agents on off floors keep running and spending, no alerts, the credit total is the only sign; downgrade drops floors; Tools view not filtered); CHANGELOG *Unreleased* line; `specs/README.md` row; spec 033 status and `[IMPLEMENTED]`/`[KNOWN GAP]` tags; cross-reference notes in specs 006 (Hide stays), 017 (plates show the floor tag), 024 (lobby ignores off floors), 011 (office total tooltip) [VIII]
- [x] T026 `npm run typecheck && npm run build && npm test` and `npm run check:office` pass; CI runs `npm test` on Windows, macOS and Linux [FR-019]; `/speckit-analyze` and `/speckit-converge`; PR from the template with what was not verified (no real session; Windows/macOS layout only via CI unit tests)

## Dependencies

- T002 → T003, T004; T004 → T005, T007; T006 → T007, T008, T009; T007 + T008 → T009 → T010.
- Phase 2 → every story. US1 (T011-T014) → US2 (T015-T019), because the switch lives in the panel. US3 and US4 depend only on Phase 2 + T011; they can run in parallel with each other.
- T023, T024 need US2 and US4 done; T025, T026 last.

## Parallel examples

- Phase 2: T002 and T006 (different files), then T003 next to T004.
- US2: T018 (usagetotals.js + its test) next to T015-T017 (app.js).
- US4: T022 (styles) next to T021 (app.js).

## Implementation strategy

1. MVP = Phase 2 + US1 + US2: group folders and switch floors off, with the counts and the lobby right. Ship-ready on its own (one PR if it stays small).
2. Then US3 (management) and US4 (labels and order), then Polish (layout checks, driver, screenshots, docs).
3. If the PR grows too big, split after the MVP checkpoint into a second PR under this spec, as spec 024 suggested.

## Phase 8: Convergence

- [x] T027 Record in research.md R9/R10 that the simulator keeps its own copy of the floor rules (a plain renderer script cannot import `src/shared/floors.ts`) instead of importing the shared module per plan: R9/R10 simulator decision (partial)
- [x] T028 Add a spec 010 cross-reference: the simulator's `+ Folder` now registers the new folder as a simulated agent (needed for its floor, Move and the floors state) per FR-017 (unrequested)
- [x] T029 Cover the new `askDialog` input options (`value` prefilled, `focus` starts in the field) in `scripts/test-dialog.ts` per Constitution VII.3 (unrequested)

## Phase 9: Change 2026-10-17 (floors in Settings, FR-023)

- [x] T030 Settings section *Floors* in `src/renderer/screens.js` rendered by `src/renderer/app.js` from the same markup and handlers as the Floors panel (scoped per container, no duplicate ids); a change in either place re-renders both [FR-023]
- [x] T031 Check in `scripts/shots-033.js`: switching a floor in Settings updates the office, the pills and the top-bar button, and the panel shows the same state; screenshot `033-settings-floors` at both sizes; README status line [FR-023]

## Phase 10: Change 2026-10-17 (maintainer review, issue #122)

- [x] T032 Merge `main` into `033-floors` (PR #121: usage totals kept across restarts) and resolve `src/renderer/usagetotals.js` / `app.js`; check that the office tooltip's "from floors that are off" amount uses the same since-reset totals [FR-016]
- [x] T033 Off-floor attention text on the floor's row in `floorsBodyHTML` (`src/renderer/app.js`): "Off, N waiting, N error(s), N at limit" from main agents and helpers of that floor's shown-or-hidden rooms; plain text, no colour-only cue; nothing else changes [FR-010]
- [x] T034 `scripts/check-office-overlap.js` and `scripts/shots-033.js`: a floor that is off with waiting/error agents shows the text in the panel and nowhere else (pills, button unchanged); a 40-character floor name at 1280x800 and 1440x900 (tags, plates, panel, top bar) [FR-010, edge case]
- [x] T035 Docs: README status and known limits (the off-floor text in the panel), CHANGELOG line, spec verification; reply in issue #122 point by point [VIII]

## Phase 11: Change 2026-10-17 (PR #124 review: top bar at 1280x800 on CI fonts)

- [x] T036 Floors button only when two or more floors exist; compact form (inline SVG icon + "2/3", accessible name and tooltip "Floors: 2 of 3 on"); Settings > Floors stays the entry point with one floor (`src/renderer/app.js`, `index.html`, `styles.css`) [FR-007]
- [x] T037 `scripts/check-office-overlap.js`: optional `OFFICE_FONT_FILE` (a local DejaVu Sans file) forces that font in every page so a Mac measures like CI; header note with Vikram's fontconfig recipe for Linux; floors cases assert no button with one floor [FR-007]
- [x] T038 Run `check:office` with the DejaVu font (all cases, both sizes) and with the default fonts; screenshots refreshed where the top bar changed [FR-007, SC-005]
- [x] T039 Docs and PR: README and spec wording for the button, the PR body (task range, a literal `Docs:` line, the font caveat), reply to the review [VIII]
- [x] T040 Floor names refuse C1 controls and hidden direction/zero-width characters (U+202A–U+202E, U+2066–U+2069, U+200B, U+2060, U+FEFF); a saved name has them removed on load; the simulator bridge repeats the rule; unit tests (`src/shared/floors.ts`, `src/renderer/sim.ts`, `scripts/test-floors.ts`) [FR-003]
- [x] T041 Floor-name rule follow-up (issue #167): escape every hidden character in source (`src/shared/floors.ts`, `src/renderer/sim.ts`, `scripts/test-floors.ts`); refuse U+2028/2029, U+2061–2064, U+00AD, U+034F, U+180E, U+115F, U+3164, U+FFF9–FFFB; strip C1 controls on load (floor kept); test the sim rule against the shared one; a test that fails on literal hidden characters in those files [FR-003]

## Phase 12: Change 2026-10-19 (follow-ups after PR #124, issue #133)

- [x] T042 Empty-state wording in `src/renderer/app.js` `render()` (the `stage.innerHTML='<div class="empty">'...` line): with every floor off and one floor, "Your only floor is off. Switch it on in Settings > Floors."; with two or more, "All floors are off. Open "Floors" above or Settings > Floors to switch one on."; the mixed message names the same controls. `scripts/check-office-overlap.js`: two cases at both sizes, `floorsoff=Ground%20floor` (one floor: text names Settings > Floors, not "above", `#floorsBtn` hidden) and `simfloors=1&floorsoff=Ground%20floor,Client%20A,Personal` (text names the Floors button, button visible); `scripts/shots-033.js` all-off assertion follows. CHANGELOG *Unreleased* line saying the Floors button shows only with two or more floors and the new wording [FR-013, FR-007]
- [x] T043 Retake on the simulator (1440x900 and 1280x800, `xvfb-run`) the pre-PR #124 screenshots that show the old top bar and are linked as current: README hero `m5-sim15-1440x900-closed.png`, `m6-fullchat-sim15-1280x800.png` (`scripts/shots-hero.js`); website gallery `024-lobby-1440x900.png` (`scripts/shots-024.js`), `003-allow-all-menu-1440x900.png` and `m6-fullchat-sim15-1440x900.png` (no committed driver: add one, owner decision 2026-10-19); spec 011 `011-usage-totals-*` (no committed driver: add one); spec 020 `i7-import-preview-*` (`scripts/shots-i7.js`); spec 025 current-state set `m9-office-caps-*`, `m9-settings-cap-*`, `m10-*` except `m10-agent-mcp-*`, `about-settings-1280x800.png` (`shots-m9.js`, `shots-m10.js`, `shots-about.js` (removed in #748, spec 021 FR-057: a one-off picture script)); the spec 025 FR-006 current-state set and spec 020's `i7-*` are retaken even though `docs/feature-history.md` links them; leave `m2`..`m8` milestone pictures and `m10-agent-mcp-*` as history [FR-007, VIII]
- [x] T044 Spec 033 Verification line for T042 (sim, both sizes, `check:office` case count) and the `specs/README.md` row; PR body with `Refs #133`/`Closes #133` per what is done and a literal `Docs:` line [VIII]

## Phase 13: Change 2026-10-21 (SC-003 timing measured in the app, issue #454)

- [x] T045 `src/renderer/app.js`: one User Timing entry `durbar:floor-switch` from the click on a floor's On/Off or Show only (`floorAction`) to the end of the `renderAll` that follows the new floor state (`afterFloorsChange`); `scripts/shots-033.js` reads it instead of polling from the click, subtracts on Linux the renderer main thread's run-queue wait (`/proc/<pid>/schedstat`) during the switch and logs both figures; best of up to three tries, budget 500 ms unchanged [SC-003]
- [x] T046 Spec 033 delta and Verification line (pass rates alone and under load, before and after; a negative check that extra work or a wait still fails), `specs/README.md` row, `docs/agent-notes.md` entry on timing checks under load

## Phase 14: Change 2026-10-23 (Move to floor from the folder menu, issue #590)

- [x] T047 Test first: new simulator driver `scripts/shots-033-move.js` (registered in `scripts/ui-suite.js` with `DURBAR_SIM_FLOORS=1`): at 1440x900 and 1280x800, open the folder menu on a room header from the keyboard (context-menu event on its door), check **Move to floor** is there, open it with Right arrow, the current floor is ticked and `aria-disabled`, pick another floor with Enter; the room's floor tag changes, every agent of that room is now in a room tagged with the new floor (the agents follow), the action toast says "moved to" with Undo; Undo puts the room and its agents back; Escape / Left arrow go back a level; the List view's Folder cell opens the same menu; with one floor (`DURBAR_SIM_FLOORS` unset) there is no Move to floor item. Screenshots `033-move-menu` at both sizes [FR-024]
- [x] T048 `src/renderer/app.js` `openFolderMenu`: a painted two-level menu in the shared `#modeMenu` element (top level adds **Move to floor ▸** only when `floorsLive()` and two or more floors; second level **‹ Back** plus one `menuitemradio` per floor, current ticked and `aria-disabled`, off floors say so); choosing a floor calls the existing `moveRoomToFloor` (bridge `moveFolderToFloor`, FR-005), then `toastAction(..., 'Undo', ...)` (the action toast of spec 030/052) that moves it back; error from the bridge as an error toast. List view: `contextmenu` on `#list .lrow .lfold` opens `openFolderMenu` for the row's room [FR-024]
- [x] T049 Mutation check: break the move (skip the `moveRoomToFloor` call) and the Undo (skip its call), see `shots-033-move` fail on each, restore [FR-024]
- [x] T050 Docs: spec 033 Verification line, README floors text, `changelog.d/033-move-to-floor-menu.md`; screenshots of the menu at both sizes; linked room-menu pictures (`remove-folder-menu-*`, spec 006) are taken with one floor, so the menu there is unchanged and they are not retaken [VIII]

## Phase 15: Change 2026-10-26 (SC-003 as a ratio to a same-run yardstick, issue #454)

- [x] T051 `scripts/shots-033.js`: time a fixed DOM + layout workload in the same page (best of 3, floor 2 ms) and assert switch-off own time < 16x it, plus a 2000 ms sanity cap, instead of a fixed 500 ms; logs both and the ratio. Measured unloaded and under 6 niced busy loops (5 runs each); two mutants (per-agent delay, repeated layout search) fail [SC-003]

## Phase 16: Change 2026-11-01 (rearrange rooms, desks and places, issue #677)

- [x] T052 Spec delta (FR-080..FR-087) with the owner's answers and open questions Q1..Q5 (`specs/033-floors/spec.md` *Changes*).
- [x] T053 `src/shared/roomorder.ts` (tolerant parse, caps), `FolderStore.order()/setOrder()` and the `order` key in the folder file, IPC `floors:order` / `floors:setOrder`, preload, `DurbarApi.getOrder/setOrder`, simulator handlers (FR-085).
- [x] T054 `src/renderer/reorder.js`: sort, move, step, merge, preview rules and the pointer drag (transform and opacity only, one layout read; FR-082, FR-083); styles `.reo-*`.
- [x] T055 `app.js`: `roomsInOrder`, desk sort and `lobbyPlaces` read the order; drag wiring; Alt and Alt+Shift arrows, folder menu Move earlier / later, palette Reset, keyboard help, no repaint under a drag (FR-081..FR-084, FR-087).
- [x] T056 `scripts/test-roomorder.ts` (`npm run test:roomorder`): rules, equal parse in renderer and main, file round trip, corrupt and older files, source checks (FR-081, FR-083, FR-085).
- [x] T057 `scripts/shots-033-order.js` (in `check:ui`): real mouse and keys at both sizes, Open office and cabins; screenshots; README, changelog fragment, spec Verification.

## Phase 17: Change 2026-11-01 (floor switch looks like the MCP toggle, issue #1010)

- [x] T058 Floor on/off uses the shared `.swt` switch (`role=switch`, `aria-checked`) in the panel and Settings; `.fl-sw` removed; drivers read `aria-checked`; `shots-033.js` asserts it [FR-007, FR-023]; screenshots, changelog fragment, docs
- [x] T059 Floors panel row: **Focus mode** icon button, icon buttons for Up, Down, Rename and Delete, a drag handle with reorder by drag (`reorder.js` attach for floors, depends on PR #987), `shots-033.js` drag and name checks, retaken linked pictures [FR-004, FR-022]

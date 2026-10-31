# Tasks: 017
- [x] T001 roomsummary + tests
- [x] T002 persistence (folders.ts + IPC + tests)
- [x] T003 door UI, layout with open rooms only, Close/Open all
- [x] T004 screenshots m7-doors-*.png (1440x900, 1280x800, SIM=15)

## 2026-10-23 delta: meeting-room door signs for sessions (issue #616)
- [x] T005 `doorSign()` in roomsummary.js + unit tests and mutation check (`test:rooms`) (FR-003)
- [x] T006 Simulator driver `shots-017-signs` first (mixed states: word, icon, tone, contrast in 6 themes, min font, fit at 1440x900 and 1280x800, switch off) (FR-004..FR-009)
- [x] T007 Desk signs in app.js and styles.css; lounge peek; drivers that read the desk pill updated (FR-004..FR-007, FR-009)
- [x] T008 Settings switch "Meeting-room signs on desks" (FR-008)
- [x] T009 Screenshots 017-signs-*.png at 1440x900 and 1280x800 (DURBAR_SIM=15); linked office screenshots retaken (`npm run shots:docs`); README line; changelog fragment
- [x] T010 Cabins (owner 2026-10-23): closed door with the agent's photo and the sign in place of the desk scene; open leaf and Done/Available/Alert tag when open; driver and unit tests updated; drivers that check desk scenes adapted (FR-011..FR-014)
- [x] T011 Waiting at the door (owner 2026-10-23 13:59 UTC): the agent stands in front of its closed door, waving, under the Waiting sign; unit and driver checks, mutation check, screenshots retaken (FR-011a)
- [x] T012 Doors store + scheduler hold + release (main), IPC, preload, sim; unit tests `test:doors` first (FR-015..FR-017; 044 FR-110..FR-112)
- [x] T013 Remote control off on close and refused while closed (`test:remote`) (FR-018; 054 FR-040)
- [x] T014 Door button on desks, DND sign with held count, open dialog (Send all / Discard / Keep closed) (FR-015, FR-017)
- [x] T015 Limit pose (wallet) at the door and on lobby figures; waving at the Boss; fire on an error (FR-019..FR-022)
- [x] T016 Driver checks and mutation checks for T014-T015; screenshots retaken
- [x] T017 Review on #631 (re-review): remote off told and checked, Send all through the Scheduler, full queue visible, atomic and capped doors file, open door with held runs, the dialog lists them (FR-024; 044 FR-113; 054 FR-042)
- [x] T018 Review on #631 (Ruben, at ec9085e0): merge main (spec 015 Compacting gets its own door sign, FR-026); main's door wiring (the scheduler's hold, the pump when a turn ends) moved into `doorops.ts` and unit-tested; `Scheduler.releaseDoorRun` (main took `releaseHeld`) tested for an ended session, the credit and the running guard, and it honours the update lock (spec 081)
- [x] T019 Settings > Office layout: Office with cabins / Open office (owner 2026-10-24); switching asks about doors you closed and opens them; a closed door stays visible in an open office; remote control offers Open the door (FR-027); the DND word on narrow desks and the desk's accessible name (FR-028); driver checks with a token-shaped held prompt (masked) and a name with markup (escaped); mutation-checked; screenshots of both layouts

## Changes 2026-10-31 (owner decision, spec 021 FR-067): no doors at all

All in one PR (spec 021 FR-068), after spec 021 T053.

- [ ] T020 Held prompts: `src/main/doormigrate.ts` (today's `loadDoors` caps), the notice once, the Schedules row, Send through `Scheduler.releaseDoorRun`, Discard. Test: `test-doors` becomes `test-doormigrate`: an injected scheduler counts 0 sends across the update, Escape keeps the queue, a repeat start shows no second notice, a gone session can only be discarded, a damaged file goes to `.bad` and says so; mutants "send on start" and "drop on start" fail [FR-031]
- [ ] T021 No door check in the scheduler; a schedule for a session with `closed: true` in the old file runs as normal. Test: `test-schedules`: such a run sends; `git grep` finds no door check in `schedules.ts` [FR-032]
- [ ] T022 Remote: a test that the update and a restart make no `setRemote(id, true)` call; see spec 054 T056. Test: `test-remote` [FR-033]
- [ ] T023 Remove: `doors.ts`, `doorops.ts`, `ipc/doors.ts`, `doors:*`, preload, `DOORS`, `doorOf`, `doorShown`, `signOf`, `doorSvg`, `doorSign`, `signsRow`, `SIGN_PREF`, `signsOn`, `setSignsOn`, room plates, `setRoomClosed`, `folders:setClosed`, Close all and Open all, palette actions, door CSS, simulator doors; `summarizeRoom` only if nothing else uses it. Test: `git grep` finds only the migration; `test-rooms`, `check:office`, `check-office-fill`, `check:crew`, `check-characters`, `ui-suite.js`, `simfloors` drivers, 15 agents at both sizes [FR-029, FR-030]
- [ ] T024 Other specs' tests and text: 001, 006, 011, 024, 033, 034, 036, 039, 040, 041 (`door` field, its FR-066), 052, 059, 068, 070, 092, 095 pointers; tokens, words and `door-art` ignored with a note. Test: `test:theme`, `test:userthemes`, `test-mcp` suites, `npm run specs:check` [FR-034]
- [ ] T025 Tests, drivers, docs and screenshots: `check-crew.js`, `check-characters.js`, `check-theme-art.js`, `check-office-fill.js`, `shots-017-signs.js`, `shots-034.js`, `test-rooms.ts`, `shots-docs.js`; every `017-*` picture goes; `docs/features.md`, `docs/agent-notes.md`, `docs/review-checklist.md`'s door line; README's safety text; every linked picture of the default office retaken (`npm run shots:docs`) and looked at. Test: `test:docsscripts`, `test-site` [FR-029]
- [ ] T026 Changelog fragment: what went, that nothing held was sent, what remains for hold and remote. Test: `npm run changelog:check` [FR-031, FR-034]
- [ ] T027 Status `deprecated` with its note. Test: `npm run specs:check` [FR-035]

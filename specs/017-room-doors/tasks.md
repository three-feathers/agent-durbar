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

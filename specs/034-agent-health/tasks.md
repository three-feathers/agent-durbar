# Tasks: 034 agents show how they are doing (issue #20)

- [x] T001 Spec + clarifications + plan + tasks before code; specs index entry
- [x] T002 `src/renderer/mood.js` (bodyOf, troubleOf, pickAmbulance, createMoodTracker, phrases) + `scripts/test-mood.ts` in `npm test` [FR-001, FR-007]
- [x] T003 `seriousMode` in settings (shared parse, SettingsStore, IPC, preload, api, simulator bridge) + tests [FR-004, FR-007]
- [x] T004 Scene drawings in `scene()` for every density: heavy, monster, ambulance, faint, dizzy, impatient; cache key; CSS keyframes and reduced motion; one ambulance [FR-002, FR-005]
- [x] T005 Card accessible label and tooltip phrases [FR-003]
- [x] T006 Settings "Serious mode" switch; serious mode turns the drawings off [FR-004]
- [x] T007 Simulator: context bands, a failed-call streak, `simwaitold=1` [FR-006]
- [x] T008 Checks and screenshots (`scripts/shots-034.js`, both sizes, Serious mode), `check:office`, README, CHANGELOG, specs index [FR-005, FR-007, SC-001, SC-002]
- [ ] T009 (follow-up, not in this PR) Mood on the walking figure while an agent is at a place, and mood words in the List view (known gaps found in phase 3)

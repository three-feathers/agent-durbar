# Tasks: 034 agents show how they are doing (issue #20)

- [x] T001 Spec + clarifications + plan + tasks before code; specs index entry
- [x] T002 `src/renderer/mood.js` (bodyOf, troubleOf, pickAmbulance, createMoodTracker, phrases) + `scripts/test-mood.ts` in `npm test` [FR-001, FR-007]
- [x] T003 `seriousMode` in settings (shared parse, SettingsStore, IPC, preload, api, simulator bridge) + tests [FR-004, FR-007]
- [x] T004 Scene drawings in `scene()` for every density: heavy, monster, ambulance, faint, dizzy, impatient; cache key; CSS keyframes and reduced motion; one ambulance [FR-002, FR-005]
- [x] T005 Card accessible label and tooltip phrases [FR-003]
- [x] T006 Settings "Serious mode" switch; serious mode turns the drawings off [FR-004]
- [x] T007 Simulator: context bands, a failed-call streak, `simwaitold=1` [FR-006]
- [x] T008 Checks and screenshots (`scripts/shots-034.js`, both sizes, Serious mode), `check:office`, README, CHANGELOG, specs index [FR-005, FR-007, SC-001, SC-002]
- [x] T009 (2026-10-19, FR-014 and FR-015) (follow-up, not in this PR) Mood on the walking figure while an agent is at a place, and mood words in the List view (known gaps found in phase 3); the List view half is FR-014 (T009a)
- [x] T009a (2026-10-19) Mood words in the List view [FR-014]

## 2026-10-17 delta: rooms darken, sirens (issue #135)

- [x] T010a Spec delta, clarifications (Ruben), plan, tasks
- [x] T010 `roomAlertOf(moods)` in `src/renderer/mood.js` + cases in `scripts/test-mood.ts` [FR-008, FR-013]
- [x] T011 Room tones (`data-alert`, darker `--tint`/`--wall` per colour, every density) and the siren in the room header and on door plates; Serious mode; reduced motion [FR-009, FR-011]
- [x] T012 Accessible words on the room section and door plate [FR-010]
- [x] T013 Simulator: a room whose worst agent is heavy only [FR-012]
- [x] T014 Driver `scripts/shots-034.js` extended, contrast check, screenshots at both sizes, `check:office`, README, CHANGELOG, specs index [FR-011, FR-013, SC-003, SC-004]
- [x] T015 Room header path text readable in every room: `#5c635e` instead of `--muted` (about 4.2:1 on `main`, now 5.17:1 in calm rooms); the driver checks 4.5:1 at every tone (done in this PR after review)

## 2026-10-23 delta: "Retrying" while the agent app retries (issue #600)

- [x] T016 Spec delta, plan, tasks (FR-016..FR-021 and T016..T022 taken; checked against `main` and the open PRs on 2026-10-23)
- [x] T017 `RetryEvent` in `src/adapters/types.ts`, event guard [FR-016]
- [x] T018 `src/adapters/retry.ts` (tracker, reason mappers); Claude (`claudeMap.ts`), Codex (`codexMap.ts`), Copilot (`map.ts`) [FR-017]
- [x] T019 `src/renderer/retry.js`; `app.js` pill, task line, chat note, status order; CSS reusing *Failing* [FR-018, FR-019]
- [x] T020 Simulator `simretry=1` [FR-020]
- [x] T021 `scripts/test-retry.ts` in `npm test` with a mutation check; driver `scripts/shots-034-retry.js` in the UI suite and `shots:docs`; screenshots at both sizes; `check:office` [FR-021]
- [x] T022 README, changelog fragment, specs-index block, agent notes [FR-021]

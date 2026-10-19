# Tasks: Models and reasoning effort

## Done (as built)

- [x] T001 `listModelOptions` and `models:list` (no inference, disabled filtered) [FR-001]
- [x] T002 Default `auto` + `efficiency` tier; other models by id [FR-002]
- [x] T003 Effort option passed to create/resume when chosen and valid [FR-003]
- [x] T004 Top-bar and dialog pickers, saved with the folder [FR-004]
- [x] T005 Header chip with multiplier tooltip; role line shows model [FR-005]
- [x] T006 Simulator canned models [SC-002]

## Open

- [ ] T020 Verify on an account with several models: list, multipliers, an effort-capable model, one tiny prompt (feature 013). [FR-006]
- [ ] T021 Take the effort list from the SDK model info instead of hard-coding it (or validate leniently). [FR-008]
- [ ] T022 Allow changing model/effort for an existing agent (spec delta; likely "new session with same history"). [FR-007]
- [ ] T023 Expose the `auto` tier choice; clarify default. [FR-009]
- [ ] T024 Explain the multiplier next to the picker; connect to credits (feature 011). [FR-010]
- [x] T025 Credit-free unit test of the option mapping with a fake `ModelInfo[]`. [FR-011] (done by spec 030: `modelOptionFrom` in `scripts/test-copilot-model.ts`)

# Tasks: Models and reasoning effort

## Done (as built)

- [x] T001 `listModelOptions` and `models:list` (no inference, disabled filtered) [FR-001]
- [x] T002 Default `auto` + `efficiency` tier; other models by id [FR-002]
- [x] T003 Effort option passed to create/resume when chosen and valid [FR-003]
- [x] T004 Top-bar and dialog pickers, saved with the folder [FR-004]
- [x] T005 Header chip with multiplier tooltip; role line shows model [FR-005]
- [x] T006 Simulator canned models [SC-002]

## Open

- [x] T020 Verify on an account with several models: list, multipliers, an effort-capable model, one tiny prompt (feature 013). [FR-006] Done by spec 030 T041/T044 on Copilot Pro (#399).
- [x] T021 Take the effort list from the SDK model info instead of hard-coding it (or validate leniently). [FR-008] Done 2026-10-21: `src/shared/effort.ts`.
- [x] T022 Allow changing model/effort for an existing agent (spec delta; likely "new session with same history"). [FR-007] Done by spec 030 (switch model of a live session).
- [ ] T023 Expose the `auto` tier choice; clarify default. [FR-009]
- [x] T024 Explain the multiplier next to the picker; connect to credits (feature 011). [FR-010] Done by spec 030 FR-011/FR-012 (prices per million, compared).
- [x] T025 Credit-free unit test of the option mapping with a fake `ModelInfo[]`. [FR-011] (done by spec 030: `modelOptionFrom` in `scripts/test-copilot-model.ts`)

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
- [ ] T023 Expose the `auto` tier choice; clarify default. [FR-009] (2026-10-23: built by T026..T033)
- [x] T024 Explain the multiplier next to the picker; connect to credits (feature 011). [FR-010] Done by spec 030 FR-011/FR-012 (prices per million, compared).
- [x] T025 Credit-free unit test of the option mapping with a fake `ModelInfo[]`. [FR-011] (done by spec 030: `modelOptionFrom` in `scripts/test-copilot-model.ts`)

## 2026-10-23: Auto routing tier (issue #607)

- [ ] T026 Shared types and IPC validation: `AutoTier`, `parseAutoTier`, `ModelOption.autoTiers`/`autoTierManaged`, `ModelSwitchRequest.autoTier`, `parseSwitchRequest` (allow-list, `auto` only, the lock); unit tests with a mutation check [FR-015] (`src/shared/modelswitch.ts`, `scripts/test-modelswitch.ts`)
- [ ] T027 Copilot adapter: tiers on the `auto` option behind the runtime version gate; managed tier read and parsed (pure `managedAutoTierFrom`, `autoTiersFor`); `modelConfig` and `setModel` send the saved tier, never under a lock, the managed default otherwise; tests with a fake client [FR-012, FR-016, FR-017] (`src/adapters/copilotmodel.ts`, `src/adapters/copilot.ts`, `scripts/test-copilot-model.ts`)
- [ ] T028 Normalized `model` event carries `autoTier` (`session.model_change`); main keeps `AgentInfo.autoTier`, saves it with the folder (`setModelChoice`), restores it and passes it to the next start [FR-016] (`src/adapters/map.ts`, `src/adapters/types.ts`, `src/main/main.ts`, `src/main/ipc/model.ts`, `src/main/folders.ts`, `src/main/startopts.ts`, `scripts/test-folders.ts`)
- [ ] T029 Renderer: the Auto routing group in the model menu, the confirm rule (`autoTierConfirm`, pure, tested), Undo, the chip label, the locked state [FR-013, FR-014, FR-017] (`src/renderer/app.js`, `src/renderer/modelswitch.js`)
- [ ] T030 Simulator: tiers on Auto, switch and queue, `?simtierlock=` [FR-018] (`src/renderer/sim.ts`, `scripts/test-sim-model.ts`)
- [ ] T031 Driver `scripts/shots-007-autotier.js` in `ui-suite.js`, screenshots at both sizes, mutation check of the driver [FR-018]
- [ ] T032 Docs: README (model picker), changelog fragment, spec 030 T060, agent notes [FR-012..FR-018]
- [ ] T033 (needs-owner-approval, costs credits) One real check on Copilot: switch an Auto session to Balance and back, record the answers and whether `session.model_change` arrives [KNOWN GAP]

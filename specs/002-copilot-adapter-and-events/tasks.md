# Tasks: Copilot adapter and normalized events

## Done (as built)

- [x] T001 `AgentAdapter` interface and normalized `AgentEvent` union (`src/adapters/types.ts`) [FR-007, SC-002]
- [x] T002 Copilot adapter on `@github/copilot-sdk`: lazy shared client, create/resume sessions, streaming, model/effort/auto-tier [FR-001..FR-004]
- [x] T003 Event mapping incl. reasoning de-duplication, tool name memory, sub-agent attribution [FR-007, FR-010]
- [x] T004 `send` with image blobs and file attachments [FR-005]
- [x] T005 `interrupt` (Stop), `stop` (End session), `dispose` [FR-006]
- [x] T006 Usage events with nano-AIU and renderer-side totals [FR-008]
- [x] T007 `listModelOptions`, `listPreviousSessions`, `history` [FR-009]
- [x] T008 Headless smoke script (`npm run smoke`, credits) and `DURBAR_LOG` event/payload log
- [x] T009 Electron main wiring: one adapter, one event channel, `ensureLive` [FR-001]
- [x] T010 Verified on real sessions in milestones 1 and 3 (README)

## Open

- [x] T020 Add a credit-free test of `map()`: feed recorded/synthetic SDK events (fixtures in `scripts/fixtures/`) into the adapter via a fake session and assert the normalized stream; wire into `npm test`. [FR-011]
- [ ] T021 Give helpers their own intent/tool/usage when the SDK attributes events to a sub-agent; verify on a real multi-agent run (feature 013). [FR-013]
- [ ] T022 Pin `@github/copilot-sdk` to an exact version in `package.json` (and fix the README wording). [FR-015]
- [ ] T023 Decide and implement handling for unmapped events that need the user (user-input, plan-mode, shell output). Needs `/speckit.clarify` first. [FR-014]
- [ ] T024 Clear `reasoningSeen`/`toolNames` on stop/idle. [FR-016]
- [ ] T025 Second adapter to prove the interface (feature 012). [FR-012]
- [ ] T026 Wire `maxAiCredits` (feature 011). [FR-017]

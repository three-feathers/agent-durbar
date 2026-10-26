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
- [x] T022 Pin `@github/copilot-sdk` to an exact version in `package.json` (and fix the README wording). [FR-015]
- [ ] T023 Decide and implement handling for unmapped events that need the user (user-input, plan-mode, shell output). Needs `/speckit.clarify` first. [FR-014]
- [x] T024 Clear `reasoningSeen`/`toolNames` on stop/idle. [FR-016]
- [x] T025 Second adapter to prove the interface (feature 012). [FR-012] (2026-10-19: the experimental Claude Code adapter, spec 012, runs the same contract suite)
- [x] T026 Wire `maxAiCredits` (feature 011). [FR-017] (done in spec 011: `sessionLimits.maxAiCredits` at start and `options.update` live)

## Changes 2026-10-18 (issue #126)

- [x] T030 (real-account, owner asked) One Read-only prompt: `session.title_changed` for the main session, `name.get`, resume by id; record as `real:` in spec.md (done 2026-10-18, 0.1533 AIU)
- [x] T027 Normalized `title` event in `src/adapters/types.ts`; `session.title_changed` mapped in `src/adapters/map.ts` (top level only); `name.get` fallback after a turn in `src/adapters/copilot.ts`; title cleaning shared with `cleanTitle`; fixtures and tests
- [x] T028 Previous sessions prefer `name` over `summary` (`previousSessionsFor` in `src/adapters/history.ts`); test
- [x] T029 Main keeps `AgentInfo.title` from the event (`src/main/main.ts`), sets it on resume from the previous session's title; `usageLabel` unchanged; test that a planted title never reaches a tool-usage label

## Changes 2026-10-19 (questions from Copilot)

- [x] T031 `onUserInputRequest` in `CopilotAdapter`: `question` event, `answerQuestion`, skip and Stop answers; fake-session test [FR-058]
- [x] T032 (real-account, owner allowed) One prompt that must use `ask_user`; answer from the card; record as `real:` [FR-058]
- [x] T033 Map the runtime's `custom_agent_prompt` host error to a plain message (FR-075, issue #703): `plainRuntimeError` in `src/adapters/map.ts`, applied to `subagent.failed`, a failed `tool.execution_complete` and `session.error`; test in `scripts/test-events.ts`.

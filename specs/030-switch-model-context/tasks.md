# Tasks: 030 change the model and the context window inside a session

Spec: [spec.md](spec.md) | Plan: [plan.md](plan.md) | Research: [research.md](research.md)

**Tags** (in the task line, before the text):
- `(sim)`: needs no account, no vendor, no credits. Safe for CI and for any agent.
- `(fixtures)`: uses synthetic fixtures written from the SDK types (never `real:`).
- `(needs-owner-approval)`: blocked until Vikram says yes in writing (a decision, the owner's real Copilot login, or credits). The issue gets the label `needs-owner-approval`. Do not start it.
- `(real-account)`: runs a real Copilot runtime. Always also `needs-owner-approval`. States the prompt count; usage recorded in the spec; never in CI.

One task = one issue = one pull request. Tick the task in the same pull request. Tasks name what they depend on.

## Done (planning, 2026-10-17)

- [x] T001 Research what the Copilot SDK 1.0.22 and CLI offer for model switch, context window, compaction, events and cost ([research.md](research.md)) [FR-002, FR-018]
- [x] T002 Clarify: decisions with defaults and open questions Q1-Q8 recorded in spec.md [FR-008, FR-020]
- [x] T003 Plan: interface deltas, Copilot mapping, phases, risks ([plan.md](plan.md))
- [x] T004 Tasks (this file); analyzed by hand: every FR has a task, every real-account task is tagged, no `src/` change in this pull request

## Phase 1: simulator-only (no vendor, no account, no credits)

- [x] T010 (sim) Pure `src/shared/modelswitch.ts` and `scripts/test-modelswitch.ts` (in `npm test`): `relativePrice`, `estimateInputCredits`, `confirmFor` (cheaper, equal, pricier, unpriced, long tier, cap headroom), `suggestFresh`, `pricingFromBatch`; no SDK types [FR-008, FR-009, FR-010, FR-019, FR-025] Done as two files: types and IPC validation in `src/shared/modelswitch.ts`, the UI logic in the plain script `src/renderer/modelswitch.js` (the sandboxed renderer cannot import TypeScript); both tested in `scripts/test-modelswitch.ts`.
- [x] T011 (sim) Interface types only: `ModelSwitchRequest/Result`, `CompactResult`, `ModelEvent`, `CompactionEvent`, `ContextEvent.model/tier`, optional `setModel?`, `cancelQueuedModel?`, `compact?`; `ModelChoice` pricing fields, `AgentInfo.modelControl/tier/pendingModel`, bridge methods; typecheck and tests unchanged, no behaviour change [FR-001, FR-011, FR-014, FR-017] Done; no behaviour change for the real adapter (it has no `setModel`/`compact`, so `modelControl.switch` is `none`).
- [x] T012 (fixtures) Mapper: `session.model_change`, `session.compaction_start/complete`, `usage_info` to `model`, `compaction`, `context` events; synthetic fixtures with `provenance: synthetic`; `cause` and `trigger` tables; tests in `scripts/test-events.ts` [FR-012, FR-014, FR-025] Done with synthetic fixtures built from the SDK type definitions (no real session). `ContextEvent.model/tier` are filled from the last `model_change`.
- [x] T013 (sim) Folder store: `contextTier` saved and loaded, unknown values dropped, model and effort saved on an applied switch; tests in `scripts/test-folders.ts` [FR-006, FR-025] Done; `FolderStore.setModelChoice` never touches Copilot settings.
- [x] T014 (sim) Main: `agents:setModel`, `agents:cancelQueuedModel`, `agents:compact` with validation (agent lookup, model id length and presence in the last list, effort set, tier enum and only if advertised), `agent:model` push, save to the folder entry on `applied`, `modelControl` derived from the adapter's optional members; preload and `api.ts`; tests for validation [FR-005, FR-006, FR-007, FR-017, FR-025] Done; the model change is pushed as the normalized `model` event (no separate `agent:model` channel). Validation is the tested `parseSwitchRequest`/`parseFocus`; the Electron handlers themselves are thin and not unit-tested.
- [x] T015 (sim) Simulator: three models with prices and a long-context tier, `setModel` (applied, queued while working, cancel), `model` events including one runtime fallback, `compact` and automatic `compaction` events that move the context numbers, one `needs-confirmation` case (smaller window); no credits [FR-024] Done, tested by `scripts/test-sim-model.ts`. Sim only: a queued switch also applies on Stop (what the real runtime does on interrupt is unverified, see T044/T046).
- [ ] T016 (sim) Chat header: model chip becomes a menu (models with price class, credit price and window, effort row, Long context toggle only when advertised, pending row with Cancel, disabled with reason when `modelControl.switch` is `none`); keyboard and ARIA [FR-003, FR-004, FR-007, FR-021, FR-023]
- [ ] T017 (sim) Confirmation dialog and Undo toast: reasons, price comparison, next-message estimate, cap headroom ("Switch anyway"), cheaper switches apply with Undo; focus trapped and returned; never raises the cap [FR-008, FR-009, FR-010, FR-018, FR-023]
- [ ] T018 (sim) Context chip: tier text, "waiting for the next message" after a switch, window unknown with reason, **Compact** action (idle only); `needs-confirmation` dialog for a smaller window ("Compact and switch" / "Cancel") [FR-016, FR-018]
- [ ] T019 (sim) Compact dialog and result: optional focus text (capped, not logged), estimate when known, quiet chat line for manual and automatic compaction and for failure [FR-015, FR-016]
- [ ] T020 (sim) Start-fresh note near the limit: `suggestFresh` wiring, one dismissible inline note with **New session** (existing flow, current model and mode pre-selected), says "new session" never "clear" [FR-018, FR-019]
- [ ] T021 (sim) Office card menu: **Model...** entry (right-click, Shift+F10, card button) opening the same picker; lazy agents save for first start; `check:office` stays green [FR-022, FR-023]
- [ ] T022 (sim) Runtime-initiated model change: notice in the chat, chip update, model list in the Tools "Agents" tab [FR-012]
- [ ] T023 (sim) Screenshots at 1440x900 and 1280x800 (menu, confirmation, pending, context chip, compaction line, start-fresh note, office menu), driver `scripts/shots-model.js`, `check:office` and dialog-focus checks green [FR-023, SC-001, SC-002, SC-003]
- [ ] T024 (sim) Docs for Phase 1: README (feature list, honest limits, roadmap), CHANGELOG Unreleased, spec 007 `## Changes` (FR-007 now closed on the simulator only), spec 019 pointer, `specs/README.md`, converge spec/plan/tasks [SC-005]

## Phase 2: Copilot adapter on a fake session (no account, no credits)

- [ ] T030 (sim) `CopilotAdapter.setModel` and `cancelQueuedModel` on `rpc.model.switchTo` / `rpc.queue.removeAt` with the safe option set (never the persistence fields), result mapping (`deferred`, `confirmation_required`, `warning`), tests on a fake session object that records the request [FR-002, FR-003, FR-025]
- [ ] T031 (sim) `CopilotAdapter.compact` on `rpc.history.compact`, refused while working, result mapping, tests on the fake session [FR-015, FR-025]
- [ ] T032 (sim) Resume safety: `start()` builds create and resume config from the saved model, effort and tier, `capi.autoTier` only for a new `auto` session; test asserts a switched model survives a resume config [FR-013, SC-004]
- [ ] T033 (fixtures) `listModelOptions` fills `pricing`, `priceClass`, `contextTiers` from `billing.tokenPrices` and the price category; missing fields stay absent; tests with synthetic `ModelInfo` objects (unit scale flagged unverified) [FR-011]
- [ ] T034 (sim) Capability contract: an adapter without `setModel`/`compact` (fake) shows disabled controls with the reason and **New session**; with them, the controls work; test on the fake adapter, no Copilot specifics in the renderer (constitution II) [FR-007, FR-017]
- [ ] T035 (sim) Docs for Phase 2: spec 002 `## Changes` entry for the interface deltas, README adapter limits line, converge [FR-017]

## Phase 3: real checks (the owner's Copilot login; each one blocked until approved)

- [ ] T040 (needs-owner-approval) (real-account) Record the real `listModels()` shape on Vikram's account: which of `multiplier`, `tokenPrices`, `longContext`, price category are filled, the unit scale, plan type. **0 credits, 0 prompts** (runtime start and model list only, as in 019). Output: a sanitized fixture and a `## Changes` entry; no token or account id kept [FR-011, Q1]
- [ ] T041 (needs-owner-approval) (real-account) One switch between the two cheapest models with one tiny prompt each (**2 prompts**, est. under 1 AI credit): record `model_change`, the `usage_info.tokenLimit` after the switch, whether `contextInfo` is right after the switch, the cost of the first call after it [FR-002, FR-016, SC-001]
- [ ] T042 (needs-owner-approval) (real-account) Switch requested **during** a running turn (**1 prompt**, a deliberately slow tiny one): `deferred`, `queueId`, cancel with `queue.removeAt`, what `interrupt()` does with a queued switch [FR-003]
- [ ] T043 (needs-owner-approval) (real-account) Manual compaction on a short session (**about 3 prompts** plus one compaction, est. a few credits): events, `tokensRemoved`, `compactionTokensUsed` credits, behaviour while a turn runs [FR-015, FR-016]
- [ ] T044 (needs-owner-approval) (real-account) Long-context tier on a model that advertises it (**1 prompt**): `contextTier` accepted, window after the switch, price step as reported [FR-011, Q4]
- [ ] T045 (needs-owner-approval) (real-account) `confirmation_required` and the allowed `compactionDecision` values: switch to a model with a smaller window with a filled context. May need a long context, so **estimate the credits first and ask**; skip if it would be expensive [FR-002, spec Story 3 scenario 2]
- [ ] T046 (needs-owner-approval) (real-account) Resume after a switch (**2 prompts**): the resumed session keeps the switched model; what `model` omitted does on resume [FR-013, SC-004]
- [ ] T047 (needs-owner-approval) Record Q1-Q8 answers from Vikram in the spec (decision record, like 012 T060) and turn the proposed defaults into decisions [spec Clarifications]
- [ ] T048 (needs-owner-approval) Docs for Phase 3: spec `## Changes` with `real:` evidence and prompt counts, README honest-limits update, converge [FR-026]

## Later / optional (not scheduled)

- [ ] T060 (sim) Auto routing tier choice (`auto` + efficiency/balance/intelligence) in the same menu (007 FR-009) [007 FR-009]
- [ ] T061 (needs-owner-approval) New session with a reviewed summary (`summarizeForHandoff`; cost unverified) [Story 5 scenario 3, Q6]
- [ ] T062 (needs-owner-approval) Settings for the automatic compaction thresholds (`infiniteSessions`) [FR-020, Q5]

## Analyze notes (by hand, 2026-10-17)

- FR-001..FR-007 -> T011, T014, T016, T030; FR-008..FR-013 -> T010, T017, T022, T032; FR-014 -> T011, T012; FR-015 -> T019, T031; FR-016 -> T018; FR-017 -> T014, T034; FR-018 -> T017, T018, T020; FR-019 -> T010, T020; FR-020 -> T062 (later) and no change now; FR-021..FR-023 -> T016, T021, T023; FR-024 -> T015; FR-025 -> T010, T012, T013, T014, T030..T033; FR-026 -> T040..T048.
- Every task that needs a real runtime or credits (T040..T046) is `needs-owner-approval`; T047 and T048 depend on the owner's answers; T061 and T062 need a decision first.
- 030 does not depend on 012; if 012 T010 lands first, T011 and T014 use its `AdapterCapabilities` instead of `ModelControl`.
- The pull request that adds these documents changes no `src/` file.

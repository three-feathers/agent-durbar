# Feature Specification: Change the model and the context window inside a session

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 030
title: Switch model, effort and context tier of a live session (chat header and office card menu), see window and % full, compact, start-fresh hint, per-folder default; simulator first, adapter-neutral
status: **Phases 1-4 built**; Phase 3 run on Copilot Pro 2026-10-20 (switch between real models, effort, long tier, `confirmation_required`, compact and switch; Copilot `modelSwitch.verified`); open: long-tier price above the default window, `compactionDecision` values; 2026-10-21: continue a conversation in another agent app (#409, FR-042..FR-045, real Copilot → Claude → Codex)
-->

**Feature Branch**: `030-switch-model-context` (spec, research, plan and tasks only; code comes in later `030-<slug>` branches per task)
**Created**: 2026-10-17
**Status**: Phases 1-4 built. Phase 3 (real Copilot checks) run on a free plan on 2026-10-17 and on **Copilot Pro on 2026-10-20** (T041, T044, T045: switch between real models, effort, long tier, `confirmation_required`, compact and switch; see `## Changes`). Open: the long-tier price above the default window and the `compactionDecision` values (`[KNOWN GAP]`).
**Input**: Vikram: "Let's support changing model and context window within sessions."
**Builds on**: [007](../007-models-and-effort/spec.md) (model and effort pickers; FR-007 says a running session's model cannot be changed), [011](../011-credit-caps-and-usage-display/spec.md) (credit caps and usage), [012](../012-claude-codex-adapters/spec.md) (adapters must stay neutral), [018](../018-permission-mode-switch/spec.md) (the pattern for switching something live from the chat header and the card), [019](../019-mcp-tools-and-context/spec.md) (context chip, models list).

## What exists today

- `[IMPLEMENTED]` Model and effort are chosen **per new session** (top bar default, new-session dialog) and shown as a chip in the chat header; a running session cannot change them (007 FR-004, FR-005, FR-007 `[KNOWN GAP]`). `read:`
- `[IMPLEMENTED]` A per-agent **context chip** shows window size, tokens used and a percent bar (calm green below 70 %, amber 70-90 %, red above 90 %) or "unknown" before the first message (019 FR-015, FR-016). Under `auto` the window is the resolved model's. `sim:`, `real:` for the event fields (019 probe).
- `[IMPLEMENTED]` The credit cap and the usage totals (011). `AgentAdapter` has optional members for what an adapter may lack (`setCap?`, `setMcpEnabled?`, ...). `read:`
- `[KNOWN GAP]` The adapter always passes the saved `model` (and `capi.autoTier` for `auto`) when it starts **or resumes** a session, so a model changed inside the SDK session would be undone at the next resume unless it is saved (research (a)). `read:`
- `[KNOWN GAP]` There is no way to compact the context, no display of compaction, and no hint to start fresh when the window is nearly full. `read:`

## What the SDK can and cannot do (summary; evidence in [research.md](research.md))

| Wish | Copilot SDK 1.0.22 | Status |
| --- | --- | --- |
| Change model mid-conversation, history kept | **Yes**, `rpc.model.switchTo` (`session.setModel` wraps it but discards the result); applies to the next message | types + docs |
| Change effort | **Yes**, with the switch or alone (`rpc.model.setReasoningEffort`) | types |
| Switch while a turn runs | **Queued** by the runtime until the turn ends (`deferred`, removable from the queue) | types + docs |
| Switch after resume | **Yes**, `resumeSession({model, reasoningEffort, contextTier})` | docs |
| Choose any context window size | **No.** Fixed per model; the only choice is `contextTier` `default` or `long_context` on models that have it, priced higher | types + docs |
| Compact now | **Yes**, `rpc.history.compact` (spends a model call) | types + docs |
| Automatic compaction | **Yes**, default on at 80 % (blocks at 95 %) | types + docs |
| Clear the conversation | **No** from a host app (`clearContext` only inside a tool handler). Closest honest alternative: a new session in the folder | types |
| Know the cost before switching | **Partly**: token prices per model if the account fills them; the legacy multiplier only on annual plans. Always an estimate | types + docs; population unverified |
| Be told when the runtime switches by itself | **Yes**, `session.model_change.cause` (rate-limit, refusal fallback) | types |

Nothing in the right-hand column is "confirmed on a real account" for this feature; see the unverified list at the end of [research.md](research.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Switch the model from the chat header (Priority: P1)

As someone mid-conversation with an agent I want to move it to a cheaper or stronger model without losing the conversation, from the chat header where the model chip already is.

**Why this priority**: it is the request. It is also where cost can surprise (constitution III).

**Independent Test**: on the simulator (`DURBAR_SIM=15`) open an agent's chat, open the model chip, pick *Sim Deep*, confirm the price note, send a message: the chip shows the new model and the next usage event names it; zero credits.

**Acceptance Scenarios**:

1. **Given** a live agent on `Sim Fast`, **When** I open the model chip, **Then** I see the account's models with name, price class and credit price per million tokens (or "price not reported"), the current one ticked, the effort choices of the highlighted model, and the note "Applies from your next message. The conversation is kept."
2. **Given** I pick a model that costs more than the current one (or whose price is unknown, or the long-context tier), **When** I choose it, **Then** a confirmation shows the price comparison, an estimate of the next message's input cost, my credit-cap headroom if a cap is set, and nothing changes until I confirm.
3. **Given** I pick a cheaper or equal model, **When** I choose it, **Then** it applies without a dialog and a toast offers **Undo** for a few seconds.
4. **Given** the agent is working, **When** I switch, **Then** the chip shows "Next: Sim Deep (after this reply)" with a **Cancel** action, the running reply is not touched, and the switch applies when the reply ends.
5. **Given** the adapter cannot switch a live session, **When** I open the chip, **Then** the choices are disabled with the reason ("This agent can only change model in a new session") and **New session** is offered. No dead buttons.

---

### User Story 2 - Switch from the office card menu (Priority: P2)

From the office, right-click (or Shift+F10, or the card's small button) an agent: the menu that already offers the permission mode gets **Model...**, which opens the same picker and confirmation as the chat header.

**Acceptance Scenarios**:

1. **Given** the office with 15 agents, **When** I open an agent's menu, **Then** it has the current model on the **Model...** line and choosing it opens the same picker; the office layout does not change (no overlap, `check:office` green).
2. **Given** an agent that is not live yet (restored lazily), **When** I choose a model, **Then** it is saved for the first start and the card says so; nothing is spent.

---

### User Story 3 - See the model, its window and how full it is (Priority: P1)

The context chip shows the **window size, tokens used and percent** for the model in use, says when the window is the long-context one, and updates at once after a switch (as soon as the runtime reports it).

**Acceptance Scenarios**:

1. **Given** an agent on a 128K model at 60 %, **When** I switch to a 200K model, **Then** the chip shows the new size and a lower percent as soon as the runtime reports it, and says "waiting for the next message" until then.
2. **Given** a switch to a model with a **smaller** window than the tokens in use, **When** the runtime asks for a compaction decision, **Then** the confirmation says "Your conversation (N tokens) does not fit the new model (limit M). It will be compacted first, which costs credits" and offers **Compact and switch** or **Cancel**. `[UNVERIFIED]` the runtime's decision values; see research.
3. **Given** a session whose window is unknown (before the first message, or `auto`), **When** I look at the chip, **Then** it says "unknown" with the reason, never `0 %`.

---

### User Story 4 - Compact the context (Priority: P2)

I can compact an agent's context from the context chip when the window is filling, with an optional focus text ("keep the auth work"), and see what it freed.

**Acceptance Scenarios**:

1. **Given** an idle agent at 82 %, **When** I choose **Compact**, **Then** a dialog explains that it summarises the conversation with a model call (credits, estimate shown when known), offers an optional focus text, and **Compact** / **Cancel**.
2. **Given** a compaction ran (mine or the runtime's automatic one), **When** it ends, **Then** the chat shows one quiet line "Compacted: 168K to 31K tokens (automatic at 80 %)" and the chip drops; a failure shows "Compaction failed: <reason>", the agent stays usable.
3. **Given** the agent is working, **When** I look at **Compact**, **Then** it is disabled with "Available when the agent is idle".

---

### User Story 5 - Start fresh when the window is nearly full (Priority: P3)

When a session is above 90 % and compaction did not help (or failed), a quiet inline note suggests **Start a new session in this folder**. It never starts anything by itself.

**Acceptance Scenarios**:

1. **Given** an agent at 93 % after a compaction, **When** it goes idle, **Then** the chat shows one dismissible note "This conversation is nearly full. A new session in this folder starts with an empty context." with **New session** (the existing flow, current model and permission mode pre-selected) and **Dismiss**; dismissed for this session.
2. **Given** an adapter that cannot clear a conversation, **When** the note shows, **Then** it never says "clear"; it says "new session".
3. *(Later, optional)* **Given** I choose **New session with a summary**, **Then** Durbar asks the runtime for a hand-off summary, shows it in an editable box and sends nothing until I confirm. `[UNVERIFIED]` whether the summary spends credits (research).

---

### User Story 6 - A default model per folder (Priority: P3)

The model, effort and tier I last chose for a folder are the ones its next session starts with and the ones a resumed session keeps. This is the existing per-folder entry (007 FR-004); no separate setting in v1 (open question Q7).

---

### Edge Cases

- The target model disappears from the list (policy disabled) between opening the menu and confirming: the runtime refuses; show its message, nothing changes.
- A switch is queued and the user presses Stop: the queued change is removed (or the runtime's outcome is shown); the chip never lies about the current model. `[UNVERIFIED]` what the runtime does with a queue on `abort()`.
- Two quick switches: the last one wins; the chip shows only the last pending model.
- The runtime changes the model itself (rate limit, refusal fallback): a `model` event with `cause` is shown as a notice in the chat ("The runtime switched from X to Y: rate limit"), not blocking, and the chip updates. It is never hidden.
- `auto` is chosen: the window and price are the resolved model's (unknown until the first call); the picker says so; the Auto routing tier (007 FR-009 `[KNOWN GAP]`) is listed as a later task, not changed here.
- Resume after a switch: the saved model, effort and tier are what start the session; the adapter must not overwrite them with a default (FR-013).
- Credit cap reached while a switch is pending: the cap flow (011) wins; the switch stays queued or is cancelled with the turn.
- An effort the new model does not support: the picker only offers the highlighted model's efforts; if the runtime still refuses, show its message.
- The user is on a legacy annual plan with multipliers: the multiplier is shown as "request multiplier (annual plans)" next to token prices when both exist (Q1).

## Requirements *(mandatory)*

### Functional Requirements

**Switching**
- **FR-001** A normalized command `setModel(sessionId, request)` on `AgentAdapter` (optional member): `request = { model, effort?: string | null, contextTier?: 'default' | 'long', confirm?: { compaction?: 'accept' | 'decline' } }`, result `{ status: 'applied' | 'queued' | 'needs-confirmation' | 'rejected', model?, queueId?, message?, warning?, confirmation?: { targetName, currentTokens, targetLimit } }`. No vendor field names cross the interface.
- **FR-002** The Copilot adapter implements it with `session.rpc.model.switchTo` (never `session.setModel`, which drops the result), `requireAvailable: true`, `deferIfModelChangeQueued: true`, `source: 'model_picker'`, and **never** `repoScope`, `modelChangeScope` or `pickerPersistence` (they write the user's Copilot settings; constitution III).
- **FR-003** A switch applies from the next message and keeps the conversation. If the runtime queues it (a turn is running) the UI says so, shows the pending model and a **Cancel** (adapter removes the queued item). The running reply is never interrupted by a switch.
- **FR-004** `setEffort` is part of the same request (effort alone is a request with the current model). The effort list is the target model's own list (007 FR-008 stays a gap until its task).
- **FR-005** IPC `agents:setModel` validates in the main process (agent id lookup, model id string of at most 100 characters and present in the last model list, effort in the known set or null, tier in `default|long` and only when the model advertises it) and never trusts the renderer (constitution III). `AgentInfo` gains the pending model and tier and an `agent:model` push like `agent:mode`.
- **FR-006** The chosen model, effort and tier are saved with the folder entry (spec 006/007) as soon as the switch is **applied** (not while only queued), so a resume or a restart keeps them. Unknown values are dropped on load.
- **FR-007** The switch controls exist only where the adapter has `setModel` (capability, see FR-017); otherwise they are disabled with a reason and **New session** is offered.

**Safety and cost**
- **FR-008** **Never switch silently to a pricier model.** A switch needs confirmation when the target's price is higher than the current one's, **or the price is not reported**, or the long-context tier is chosen, or the estimate exceeds the cap headroom. Cheaper or equal switches apply directly with an **Undo** toast. Rules live in one pure function with tests.
- **FR-009** The confirmation shows: current and target price (credits per million tokens for input and output, or the price class, or "not reported"), the relative step ("about 2.5x the input price"), an **estimate** of the next message's input cost (`tokens / batch * input price`, "if nothing is cached"), the credit cap and what is left, and the sentence "Estimate from the prices your account reports. The reply shows the real cost." Units: AI credits, 1 credit = USD 0.01 (011).
- **FR-010** The **credit cap (011) is respected and never raised** by a switch. If the estimate is above the remaining headroom the confirmation says so and the confirm button is labelled "Switch anyway"; the runtime's own limit flow still applies.
- **FR-011** Prices come from normalized `ModelChoice` fields filled by the adapter: `pricing {inputPerMTok, outputPerMTok, cachedPerMTok?, long?: {...}}`, `priceClass?: 'low' | 'medium' | 'high' | 'very-high'`, `contextTiers: ('default'|'long')[]`, `longWindow?`. The old `multiplier` stays and is shown only as "request multiplier (annual plans)" when present. A missing field is "not reported", never zero.
- **FR-012** A model change the **runtime** makes (a normalized `model` event with `cause` other than `user`) is shown as a notice in the chat and updates the chip; it needs no confirmation (it already happened) and is counted in the Tools "Agents" tab model list (019).
- **FR-013** The adapter must not override a saved or switched model on resume: `start()` passes the saved model, effort and tier from the folder entry (which FR-006 keeps current) and `capi.autoTier` only for a **new** `auto` session (2026-10-23, 007 FR-016: or when the agent has its own saved Auto tier, which is the user's choice like the saved model). A test builds the create/resume config from a fake session and asserts this.

**Context window and compaction**
- **FR-014** Normalized events: `model` (`model`, `previousModel?`, `effort?`, `previousEffort?`, `tier?`, `cause: 'user' | 'runtime' | 'rate-limit' | 'fallback' | 'resume'`) from `session.model_change`; `compaction` (`phase: 'start' | 'complete' | 'failed'`, `trigger: 'auto' | 'manual' | 'model-switch' | 'overflow'`, `tokensBefore?`, `tokensAfter?`, `tokensRemoved?`, `error?`); `ContextEvent` gains optional `model?` and `tier?`. The renderer reads only these.
- **FR-015** A normalized command `compact(sessionId, focus?)` (optional member): result `{ success, tokensRemoved?, tokensAfter?, message? }`. Copilot: `rpc.history.compact({ trigger: 'manual', customInstructions })`; refused while the agent is working. The focus text is capped (500 characters) and never logged.
- **FR-016** The context chip (019) additionally shows: the tier ("long context") when set, "waiting for the next message" after a switch until the new window is reported, and a **Compact** action (idle only). Colours and thresholds stay as in 019 FR-016; state is never colour alone.
- **FR-017** Capabilities are **read from the adapter, not guessed**: `AgentInfo.modelControl = { switch: 'live' | 'next-message' | 'none', effort: boolean, contextTier: boolean, compact: boolean, windowKnown: boolean }`, derived in main from the adapter's optional members now and from spec 012's `capabilities` once T010 of 012 lands (then `modelControl` is replaced by it). Claude (`setModel`, `getContextUsage`) and Codex (per-turn `model`/`effort`, next message) fit the same shape; neither is built.
- **FR-018** **What the SDK cannot do is said in the UI**: no free window size (the picker offers a long-context toggle only for models that advertise one, and says it costs more); no clear (the note says "new session"); no price (says "not reported").
- **FR-019** Start-fresh suggestion: a pure function `suggestFresh({percent, compactions, lastCompactionFailed, idle})` returns true at or above 90 % after at least one compaction or a failed one, and once per session after dismissal; it never acts. Wording in FR-021/US5.
- **FR-020** Automatic compaction keeps the runtime defaults (80 % background, 95 % block). Durbar does not change thresholds in v1 (open question Q5); it only shows what happened.

**UI**
- **FR-021** The chat header model chip becomes a menu button (like the mode chip, spec 018): models list (name, price class, credit price, window), effort choices, a **Long context** toggle when advertised, the note "Applies from your next message. The conversation is kept." Keyboard: arrows, Enter, Esc; `aria-haspopup`, names for screen readers; never colour alone.
- **FR-022** The office card menu gets **Model...** (opens the same picker). The card's role line already shows `· <model>` for non-auto models (007 FR-005) and keeps doing so.
- **FR-023** Calm UI (constitution V): text at least 10.5px, no new colours for spend, no layout jump when a switch is pending, 15 agents still fit at 1440x900 and 1280x800 (`check:office`), dialogs trap focus and return it (pattern of spec 003 FR-033), motion CSS-only.

**Simulator and tests (zero credits)**
- **FR-024** The simulator implements `setModel`, `compact`, queued switches while working, `model` events (including one runtime fallback), `compaction` events (automatic at 80 % and manual) and a long-context model with a price step, so every screen above is demonstrable and screenshot-able without credits (010, constitution IV).
- **FR-025** Unit tests (no credits): the confirm decision and estimate (pure), mapper fixtures for `session.model_change`, `compaction_start/complete`, `usage_info`; `setModel`/`compact` request building and result mapping on a fake session object; resume config (FR-013); folder store round trip of tier; IPC validation; `suggestFresh`.
- **FR-026** Real-session checks are separate tasks, each with a stated prompt count, marked `needs-owner-approval`, never in CI (011 and 013 precedent). Results go into this spec's `## Changes` as `real:` evidence.

### Key Entities

- **ModelChoice** (extends 007): `id`, `name`, `multiplier?`, `efforts[]`, `defaultEffort?`, `contextWindow?`, plus `pricing?`, `priceClass?`, `contextTiers[]`, `longWindow?`.
- **ModelSwitchRequest / ModelSwitchResult**: see FR-001.
- **ModelEvent**, **CompactionEvent**: see FR-014.
- **ModelControl**: per agent capability data (FR-017).

## Success Criteria *(mandatory)*

- **SC-001**: On the simulator, switching from the chat header and from the office menu both change the model of the next reply, ask for confirmation when the target is pricier or unpriced, and apply with an Undo when cheaper; zero credits.
- **SC-002**: A switch while the agent is working is shown as pending and applies after the reply (simulator).
- **SC-003**: The context chip, compaction line and start-fresh note follow the simulator's events at both screen sizes with no overlap (`check:office`).
- **SC-004**: A resumed agent keeps its switched model (unit test on the adapter config; real check T046).
- **SC-005**: README and spec 007 FR-007 no longer say the model cannot be changed, and say plainly what the SDK cannot do (free window size, clear) and what is unverified.

## Clarifications (2026-10-17)

No answers from the owner were available while this was written, so these are **decisions proposed with a default**: they stand unless Vikram says otherwise, and the open questions below are the ones that need his word.

- **Q: Is this about the SDK, or about a new session?** SDK: the model of a **live** session can be switched (types, docs). Decision: use the SDK switch, keep history, apply from the next message. `[UNVERIFIED]` on a real account.
- **Q: Can the context window be chosen?** Not freely. Decision: offer the model (each has its window) and, where advertised, the long-context tier; do not override `modelCapabilities`. Say so in the UI.
- **Q: Compact or clear?** Compact yes (`history.compact`). Clear no (tool-handler only). Decision: "Start fresh" = new session in the folder; summary seeding later and optional.
- **Q: Switch during a turn?** Decision: allow, queued by the runtime, shown as pending with Cancel; the running reply is untouched.
- **Q: What counts as "pricier"?** Decision: any higher input or output price than the current model, an unknown price, the long tier, or an estimate above the cap headroom. Confirm every time (no "don't ask again" in v1).
- **Q: Which cost figure?** Decision: token prices (AI credits per million tokens) and the price class first; the multiplier only as a labelled legacy note. Estimates are labelled estimates.
- **Q: Persist where?** Decision: with the folder entry, as 007 does; never in Copilot's settings (no `repoScope`/`modelChangeScope`/`pickerPersistence`).
- **Q: Adapter shape?** Decision: optional `setModel?` and `compact?`, events `model` and `compaction`, `ModelControl` data now, folded into spec 012's capabilities later. No Copilot type in the renderer or `src/shared`.
- **Q: Real credits?** Decision: none in phases 1 and 2. Phase 3 tasks are `needs-owner-approval` with prompt counts.

### Open questions for Vikram (answered 2026-10-19, see the decision record under Changes)

1. **Q1 Plan and units.** Are you on usage-based AI credits (monthly plan) or a legacy annual plan with multipliers? The UI prefers token prices; do you want the multiplier shown at all when the account reports one?
2. **Q2 Confirm threshold.** Confirm on any price increase (proposed), or only above a step you choose (for example 2x)?
3. **Q3 Switch while working.** Allow queued switches (proposed), or disable the picker until the agent is idle (simpler, less surprising)?
4. **Q4 Long-context tier.** Show the toggle on real accounts only after T044 verifies the window and price step (proposed), or show it as soon as a model advertises it?
5. **Q5 Auto compaction.** Keep the runtime defaults 80 %/95 % (proposed) or expose thresholds in Settings?
6. **Q6 Start fresh with a summary.** Offer it later (proposed, optional, shown for editing before sending), or never?
7. **Q7 Folder default.** Is "the last model I chose for this folder" enough (proposed), or do you want a separate "default for new sessions in this folder" setting?
8. **Q8 Real-account budget for phase 3.** May tasks T040-T046 run? T040 is free (list only). T041-T046 together are about 8 tiny prompts on the two cheapest models plus one manual compaction; estimate **a few AI credits** (019 measured 0.167 AIU for one tiny prompt on `auto`), more if a premium model is picked. Which two models, and what ceiling?

## Out of scope / known gaps

- `[KNOWN GAP]` Auto routing tier choice (007 FR-009), BYOK models, provider choice (`providerId`), `modelCapabilities`/`maxPromptTokens` overrides.
- `[KNOWN GAP]` Truncate and rewind of history (destroy history or files): not offered.
- `[KNOWN GAP]` Claude Code and Codex: the shape fits ([research.md](research.md)), nothing is built or verified (spec 012).
- `[KNOWN GAP]` Persisted per-model cost history and a "cost since the switch" figure (011 backlog).
- `[KNOWN GAP]` Everything marked unverified in [research.md](research.md) until phase 3 runs.

## Changes

- **Phase 1, logic, types, mapper, folder store, main IPC, simulator (sim only, no real session):**
  - `src/shared/modelswitch.ts` holds the adapter-neutral types and the IPC validation. The UI logic is `src/renderer/modelswitch.js` (a plain script, because the renderer cannot import modules). Deviation from plan.md, which named only `src/shared/modelswitch.ts`.
  - The model change reaches the renderer as the normalized `model` event; there is no separate `agent:model` channel. Main keeps `AgentInfo.model/effort/tier` in step and saves a choice to the folder entry only when the cause is `user`; a rate-limit or refusal fallback is shown but never saved as the folder's choice.
  - The real Copilot adapter is unchanged: no `setModel`, `cancelQueuedModel` or `compact`, so `AgentInfo.modelControl.switch` is `none` and the handlers answer "start a new session". Phase 2 (T030..T035) adds them.
  - Simulator: five models (Auto, Sim Fast, Sim Mid, Sim Deep with a long-context tier, Sim Preview with no price), made-up prices in credits per million tokens. `sim:` a switch asked for during a turn is queued and applies when the turn ends or is stopped; the runtime's real behaviour on interrupt is unverified (T042). A chat message containing "fallback" makes the simulated runtime switch models by itself.
  - Tests: `test:modelswitch`, `test:simmodel`, plus additions to `test:events` and `test:folders`.
- **Phase 1, UI (sim only):**
  - Chat-header model chip is a menu (`role=menu`, arrow keys, Escape and focus return); the mode menu gained a *Model and context...* row, which is also the office card entry (right-click or Shift+F10).
  - `src/renderer/dialog.js` gained optional `lines` (a short list) and `input` (one text field), both set as text; `test:dialog` covers them.
  - The context chip is a group: chip plus **Compact** (shown only when `modelControl.compact`). After a model event the chip says "Window: waiting for next message" until the next `context` event. The chip's click handler is now a document-level delegate (it was lost when the chip was re-rendered).
  - Real Copilot agents: `modelControl.switch = none`, so the menu is disabled with a reason and offers New session. They also get compaction lines and the start-fresh note, because the mapper now emits `compaction` events for real sessions (read-only information, synthetic fixtures only; no real session was run).
  - Under Auto the agent stays "Auto": a runtime model change is shown in the chat but does not rename the chip (main and renderer). The start-up `model_change` report of a real session is silent.
  - Known gaps: estimate and prices are the runtime's own numbers or none; the long-tier window semantics, what Stop does to a queued switch, and the real `compactionDecision` values are unverified (T040..T046). No card button was added.
  - Screenshots: `docs/screenshots/030-*-1440x900.png` and `-1280x800.png` (`npm run check:model`).
- **Phase 2, Copilot adapter on a fake session (no real session, 0 AIU):**
  - `src/adapters/copilot.ts` gained `setModel`, `cancelQueuedModel` and `compact`; the pure parts (model list mapping, create/resume config, result mapping) are in `src/adapters/copilotmodel.ts`. `getClient` is `protected` so a test can hand in a fake client.
  - `setModel` sends `modelId`, `reasoningEffort` (null clears, omitted keeps), `contextTier`, `requireAvailable`, `deferIfModelChangeQueued`, `runCompactionPreflight`, `source: 'model_picker'` (and `autoTier: 'efficiency'` when switching to `auto`). It never sends `repoScope`, `modelChangeScope`, `pickerPersistence` or `compactionDecision` (`test:copilotmodel` asserts it). **Deviation from the plan's mapping:** "compact and switch" does not send a `compactionDecision` (its values are unknown, `[KNOWN GAP]`); it runs `history.compact` with trigger `model_switch` first, then asks again, and a switch that still needs confirmation is `rejected` with a message instead of looping. Compaction is refused while the session is processing, or when the runtime cannot say whether it is.
  - Result mapping: confirmation request -> `needs-confirmation`; `deferred` -> `queued` with `queueId`; the model id the runtime reports equal to the one asked for -> `applied`; anything else (an unknown `status`, no answer, an exception) -> `rejected` with the runtime's message. An unknown status is never trusted as applied.
  - T032, the overwrite bug: `start()` now passes the saved model, effort and context tier on create **and** resume (`StartOptions.contextTier`), and `capi.autoTier` only for a NEW `auto` session. Main saves a switched choice with the folder and passes it on the next start; `test:copilotmodel` shows the switched model, effort and tier reaching `resumeSession`. A not started or ended agent saves the choice and uses it at its first message. Which model a resumed session really starts on when `model` is omitted is still unverified (T046).
  - T033, prices: `listModelOptions` fills `pricing` (credits per million tokens = price / `batchSize` x 1e6, no batch size = no price), `priceClass` (from `modelPickerPriceCategory` when the list carries it), `contextTiers` (`long` only when the runtime advertises it) and `longWindow` (long prompt budget + max output tokens). Missing fields stay absent. `ModelPricing.unverified` is always set: the UI shows "(unit not verified)", compares models by ratio only and does not check the credit cap with these numbers (a costlier switch under a cap says the cap cannot be checked; cheaper ones still apply with an Undo, because a ratio holds in any unit).
  - T034, the contract: `modelControlFor` follows the adapter's optional members (`test:copilotmodel` and `test:modelswitch`). `ModelControl.unverified` makes the menu, the switch confirmation and the Compact dialog say "Not verified on a real account yet". A test greps the renderer files for Copilot-specific names (constitution II). An effort the new model does not support is cleared rather than sent.
  - `[KNOWN GAP]` still unverified on a real account (Phase 3): that `switchTo` keeps the history and applies at the next message; its `status` strings; what Stop (`abort`) does to a queued switch; whether `history.compact` emits compaction events (the UI adds the result line itself when none arrives); the compaction decision values; the unit of the token prices and the long-tier window semantics; the model a resumed session starts on.
- **T040, real model list (`real:`, read-only, 0 AI credits, no session, no prompt, 2026-10-17):** on the Copilot login of the box (authenticated, type `user`; runtime 1.0.98) `listModels()` returns **only `auto`**, with `capabilities: {supports: {}, limits: {max_context_window_tokens: 0}}` and **no** `billing`, `supportedReasoningEfforts`, `defaultReasoningEffort`, `policy`, price category or tier field. So: the window of Auto is unknown (as designed), `price not reported` is what the picker shows, and `pricing`, `priceClass`, `contextTiers`, `longWindow` stay absent. The unit of `tokenPrices`, the price category and the long tier remain **unverified** (no model reported them). The runtime's static built-in catalog has 61 model ids with ids only. Fixture: `scripts/fixtures/models/real-list-models-2026-10-17.json` (provenance real, no account detail), read by `test:copilotmodel`; tool: `scripts/capture-models.ts` (`node dist-scripts/scripts/capture-models.js <out.json>`). Details and the Phase 3 plan awaiting the owner's OK: [research.md](research.md). T041, T042, T044, T045 need two or more listed models and cannot run on this login as it is.
- **Phase 3, real runs (`real:`, owner-approved, free plan, `auto` only, 8 prompts + 1 compaction, 0.56 AI credits, ceiling 20 of the owner's 100):** details and fixtures in [research.md](research.md). The free plan lists only `auto`, so every check that needs two real models is still open.
  - **Verified:** an unusable model answers `status: "cancelled"` (the adapter now says "not available on this Copilot account or plan"); `applied`, and `deferred` + `queueId` for a switch during a turn; `queue.removeAt` cancels it; **Stop drops a queued switch** (queue empty, no `model_change` later); history survives switch calls, compaction and resume; resume with or without `model` keeps `auto`; a manual compaction is one model call (0.19 AIU) and emits `compaction_start`/`compaction_complete` with `compactionTokensUsed`; a tiny conversation grows when summarised; `assistant.usage` fields and the real price unit (`costPerBatch` nano-AIU per batch; `gpt-6-luna`: 10 / 1 / 12.5 / 50 credits per million tokens for input / cache read / cache write / output); `auto` resolves to `gpt-6-luna` with a 272k window.
  - **Surprises, and what changed in the app:** (1) Stop drops a queued switch, where the simulator said it applies: the simulator now drops it and the UI shows "dropped when you stopped" instead of a stale "Next: ...". (2) The compaction's cost was not counted: the mapper now emits it as a `usage` event, so totals and the credit cap see it. (3) `history.compact` is allowed mid-turn and drains the queued switches; the adapter still refuses mid-turn (safe side). (4) A tiny conversation grows after compaction: the line says "too short to shrink"; `tokensRemoved` stays non-negative. (5) `account.getQuota` lags; credits are counted from usage events. (6) A no-op switch (auto to auto) still emits a `model_change`.
  - `[KNOWN GAP]` still unverified: a switch between two real models (history, first-call cost, new window), `confirmation_required` and the `compactionDecision` values (T045), the long tier's window and price, `billing.tokenPrices` and its unit (never returned on this plan), a queued switch to a real model under Stop. The UI keeps the "Not verified on a real account yet" note for that reason.

### 2026-10-19: owner decision record (T047, issue #106)

Vikram answered Q1-Q8 one by one in a Claude Code session on 2026-10-19. The proposed defaults become decisions except Q4 and Q6:

- **Q1 Plan and units.** Design for usage-based **AI credits**: token prices first. A multiplier is shown only as a small extra line when a legacy annual plan reports one. The account is on the free plan today (`auto` only), and a paid Copilot plan is coming "soon".
- **Q2 Confirm threshold.** Confirm on **any price increase**, an unknown price or the long-context tier. A cheaper switch applies at once with Undo. This is what is built.
- **Q3 Switch while working.** **Queue** the switch until the reply ends, and let the user cancel it. This is what is built.
- **Q4 Long-context tier.** The owner's answer: "I will get a paid account soon on copilot, we can check it there - we already have paid accounts on claude and codex, you can already check it there". Decision:
  - the toggle stays as built, flagged "not verified on a real account";
  - T044 runs on the paid Copilot plan once it exists;
  - meanwhile the long-context models of Claude (`[1m]` ids) and Codex may be checked on the owner's paid accounts.
- **Q5 Auto compaction.** Keep each runtime's **defaults**, with no Settings for the thresholds. T062 is dropped.
- **Q6 Start fresh with a summary.** **Build it now**: T061 moves from "later" to scheduled. The summary is always shown for editing and only sent on the user's Send (Story 5, scenario 3).
- **Q7 Folder default.** **The last model chosen in the folder**, with no separate setting. This is what is built.
- **Q8 Real-account budget.** Run T041, T044 and T045 as soon as the paid Copilot plan exists, on the **two cheapest models** it lists, stopping at about **100 AI credits (USD 1)**. Where they apply, the same checks may run on Claude and Codex. Every run is recorded as `real:` with its cost.

### 2026-10-19: new session with a reviewed summary (Q6, T061)

The owner chose "build it now" (Q6). A new session can start from a **hand-off summary** of the current conversation. The user reviews and edits that summary, and nothing is sent until they press Start.

- **FR-034** The adapter capability `handoff` (optional, false when missing) says that `handoffSummary(sessionId)` exists. It returns markdown text and **never changes the original conversation**:
  - **Copilot:** `session.rpc.history.summarizeForHandoff()` (`@experimental` in SDK 1.0.22). An empty result counts as "no summary".
  - **Claude Code:** a one-shot run of the user's `claude` on a **fork** of the session: `-p <fixed prompt> --resume <id> --fork-session --no-session-persistence --tools "" --strict-mcp-config --setting-sources "" --output-format json --max-budget-usd 0.50`. It has no tools, no MCP servers and no settings files, and the fork is not saved, so the original session file is not touched. Arguments go in an array, never through a shell.
  - **Codex:** `thread/fork {threadId, ephemeral: true}` with the read-only sandbox and no approvals, then one turn with the same fixed prompt. The forked thread's final agent message is the summary. The fork is ephemeral (not saved), and its events are not shown in the chat.
  - **Simulator:** a canned summary built from the agent's task and files.
- **FR-035** The fixed prompt asks for a short markdown hand-off: goal, what was done, open items, important files and decisions, and next step. At most about 300 words, no secrets, no tool use. The summary is cut at 8,000 characters.
- **FR-036** Where it shows:
  - the start-fresh note gets **New session with a summary…**;
  - the New session dialog gets a checkbox **Start with a summary of this conversation**, shown when the current agent is live and its kind has `handoff`.
  - Either way, Durbar asks for the summary ("Preparing a summary…", which can be cancelled), then shows it in an **editable box**: *Cancel* or *Start new session*. On Start, the new session starts with the dialog's options, and the edited text is its **first message**. If the summary fails or comes back empty, Durbar says so and offers a plain new session. The new session can be another harness: the summary is plain text.
- **FR-037** Cost: making the summary may use the model, so the box says "Making the summary used the model of this session (a small cost)". For Claude, the one-shot is capped at $0.50 and its estimate is added to the old agent's usage. `[UNVERIFIED]` whether Copilot's `summarizeForHandoff` spends credits (research): it is checked when the paid plan exists (Q8).
- `[IMPLEMENTED]`:
  - **Code:** `src/adapters/handoff.ts` (`HANDOFF_PROMPT`, `cleanSummary`); `handoffSummary` in `copilot.ts`, `claude.ts` (`handoffArgs`, `parseHandoffOutput`, a `spawn` with stdin closed) and `codex.ts` (fork events collected in `onNotification` and never mapped); the fake adapter and the simulator.
  - **Wiring:** IPC `agents:handoff`, preload `handoff`; renderer `canHandoff`, `reviewHandoff`, the checkbox `#sdSum`, and the button "New session with a summary…" on the start-fresh note.
- `test:`
  - `test:handoff`: the prompt and the cleanup.
  - `test:claudeadapter`: argv, parsing, no run before anything was said, the cost counted as usage, the live CLI untouched, and the error on exit 1.
  - `test:runtime`: Codex fork params (`ephemeral`, `never`, `read-only`), the prompt going to the fork, the fork unsubscribed, nothing in the chat; contract C2 `handoffSummary() <=> capabilities.handoff`.
- `sim:` `scripts/shots-030-handoff.js` at 1440x900 and 1280x800: the checkbox (off by default), the review box, the edited text sent as the new session's first message, Cancel starting nothing, and no checkbox for the basic kind. Screenshots: `docs/screenshots/handoff-dialog-*.png`, `handoff-review-*.png`.
- `real:` 2026-10-19, on throwaway sessions about a garden plan:
  - Claude Code 2.1.303 (`haiku`), one-shot with the exact `handoffArgs`: a correct five-part summary for $0.00086. No new file appeared in Claude's project folder, so the fork was not saved. Without closing stdin, the CLI waits 3 s ("no stdin data received"), hence `stdio: ignore`.
  - Codex 0.163 (ChatGPT Plus), Read-only: a correct summary in 5.4 s, with no chat events from the fork.
- `[KNOWN GAP]`:
  - Copilot's `summarizeForHandoff` was not run on a real account; whether it spends credits is unverified (Q8, with the paid plan).
  - The review box has no focus trap (Escape and the buttons work).

### 2026-10-19: long context on Claude (Q4, checked meanwhile on the owner's paid Claude account)

Q4 said the long-context tier could be checked on Claude while the paid Copilot plan is pending.

- `real:` Claude Code 2.1.303, the adapter from `dist/`, one tiny prompt each, numbers only:
  - `sonnet[1m]` was accepted and ran as `claude-sonnet-5-5`; the context event reported a window of **1,000,000** tokens; cost $0.062 with a cold cache.
  - Plain `sonnet` also ran as `claude-sonnet-5-5` with a window of **1,000,000** (Sonnet 5.5 has it natively); cost $0.015.
  - The account's model list (`listModelOptions`, no prompt) offers no `[1m]` variant.
- **Result:** on Claude the context chip shows the real window from `modelUsage.contextWindow`, whatever alias was chosen. A separate "long tier" control is not needed for Claude: it would cost more and give nothing for Sonnet 5.5.
- The Copilot long-context tier (T044, #103) still waits for the paid plan.

### 2026-10-20: Phase 3 still blocked on Copilot (T041, T044, T045)

- `real:` 2026-10-20, 0 prompts, no credits (model list and quota only, through `scripts/capture-models.ts`-style calls): The Copilot login on the test machine is still a **free plan** on 2026-10-20: `listModels()` returned **no models at all** (it listed `auto` on 2026-10-17; the runtime now signs in through `gh`, `authType: gh-cli`), and the quota shows `premium_interactions` entitlement 0. `auto` sessions still run.
- T041 (two cheapest models), T044 (long tier) and T045 (`confirmation_required`) cannot run: there is no second model, and no model that advertises a long tier. Claude Code and Codex have no `setModel` in their adapters, so Q8's "the same checks on Claude and Codex" does not apply to the switch itself (Claude's long window was checked on 2026-10-19, above).
- T045 estimate for when a paid plan exists: the context must be bigger than the smaller model's window, for example about 130k input tokens for a 128k model, so about 1.3 credits per filled prompt at `gpt-6-luna`'s price, and a few prompts in all; within Q8's budget, but it needs two listed models.
- `[KNOWN GAP]` unchanged: a switch between two real models, the long tier's window and price, `confirmation_required` and the `compactionDecision` values. The UI keeps "Not verified on a real account yet".

### 2026-10-20: switching the model in Claude Code and Codex sessions (Phase 4, Q8)

The owner allowed real credits on the paid Claude and Codex accounts (2026-10-20) and asked for the real-credit tasks to be done. The Copilot ones (T041, T044, T045) still cannot run: the Copilot login on the test machine is **Copilot Free** (`real:` 2026-10-20, `account.getQuota`: premium requests 0, chat 200; `models.list` empty). Q8 allowed "the same checks on Claude and Codex where they apply"; they did not apply only because those adapters had no `setModel`. Both runtimes take the model per launch or per turn, so a switch applies from the next message.

- **FR-038** `ClaudeAdapter.setModel(id, {model, effort})`: the model must be one the CLI accepts (`claudeModelFlag`, or `auto`/`default` for the CLI's own default); the effort one of Claude's levels (`low`..`max`), `null` clears it, omitted keeps it. It updates the session's start options and marks a relaunch, so the **next message** relaunches the CLI with `--resume <id> --model <m> [--effort <e>]` (the same session, the conversation kept). A turn in progress finishes on the old model. Returns `applied`; an unknown model or effort is `rejected` with a plain reason and changes nothing. A context tier is ignored: Claude reports its real window per model (2026-10-19 delta), so no separate tier.
- **FR-039** `CodexAdapter.setModel(id, {model, effort})`: the model must pass `codexModelFlag` (or `auto`/`default`: Codex's own default); the effort the same safe shape as at start; the values go on the next `turn/start` (`model`, `effort`), so the thread is kept. Returns `applied`, or `rejected` with a reason.
- **FR-040** Both emit `{type:'model', cause:'user', model, previousModel, effort, previousEffort}` at once, so the chip, the folder's last choice (Q7) and the activity row update as for Copilot; `modelControlFor` then gives `switch: 'next-message'` for both (it did already for any adapter with `setModel`), and the picker's existing "Applies from the next message" text is used. No compaction confirmation: neither runtime reports one (`confirm` is ignored).
- **FR-041** Real checks (Q8 budget, numbers only, scratch folders, sessions deleted after): on Claude, one message on `haiku`, a switch to `sonnet`, a second message, and the session file shows both models; on Codex, the same with two models from `model/list`. Recorded below as `real:` with cost.
- `real:` 2026-10-20, through Durbar's own adapters built from this branch (`claudeDescriptor().create()`, `CODEX_DESCRIPTOR.create()`), Read-only, scratch folders, sessions deleted after:
  - **Claude Code 2.1.304:** message 1 on `haiku` ran as `claude-haiku-5-5` ($0.0018); `setModel({model:'sonnet'})` answered `applied` and emitted one `model` event (`sonnet` from `haiku`, cause `user`); message 2 relaunched the CLI with `--resume` and ran as `claude-sonnet-5-5` ($0.13: the relaunch writes Sonnet's prompt cache from scratch). The session file holds both models under one session id.
  - **Codex 0.163.0 (ChatGPT plan):** `model/list` offered 7 models; turn 1 on `gpt-5.6-luna`, `setModel({model:'gpt-6.1-sol'})` `applied` with one `model` event, turn 2 on the same thread; the thread's rollout records two `turn_context` entries, `gpt-5.6-luna` then `gpt-6.1-sol`. Codex's usage events carry no model name.
  - No errors on either side. Cost in all: about $0.13 on Claude's estimate (subscription, nothing billed per token) and two small Codex turns.
- sim: a Claude agent (`simkinds=mixed`) has the model menu with no tier toggle and no "not verified" note; screenshots `030-claude-model-1440x900.png`, `030-claude-model-1280x800.png`. `shots-model` (Copilot) passes at both sizes; its expectation was updated for the "spending limit" wording (it had failed on `main` since round 6).
- `[KNOWN GAP]` unchanged for Copilot: T041, T044, T045 need a paid Copilot seat; the Copilot switch stays flagged "not verified" (capability `modelSwitch.verified: false`).


### 2026-10-20: Phase 3 run on Copilot Pro (T041, T044, T045)

`real:` 2026-10-20 after the owner activated Copilot Pro. The real `CopilotAdapter` ran through `scripts/paid-models-real.ts`, with read-only sessions in empty throw-away folders. Models listed: `auto`, `claude-haiku-4.5`, `gpt-6-luna`, `gpt-5.6-luna`, `mai-code-1.1-flash`. Credits are the runtime's own `assistant.usage` / `usage_checkpoint` figures.

- **T041 switch between two real models** (3 tiny prompts plus one for T044, **0.43 AIU** for all four). `gpt-6-luna` (effort low) → `mai-code-1.1-flash` (effort medium) through `setModel`:
  - `applied`, with one `session.model_change` (`previousModel`, `newModel`, both efforts, `contextTier: null`, `source: "sdk"`);
  - **history kept**: the new model answered the code word given to the old one;
  - `metadata.contextInfo` is **null right after a switch** until the next call, so the window shown must come from the model list until then;
  - after the call, `usage_info.tokenLimit` is the new model's window (272000 → 128000).
- **013 C8 effort**: `setModel` back to `gpt-6-luna` with effort high: `applied`, `getCurrent()` reports `reasoningEffort: high`.
- **T044 long tier** (1 prompt):
  - `setModel(gpt-6-luna, contextTier long)` → `applied`, "(872K context)", `getCurrent()` `contextTier: long_context`, `usage_info.tokenLimit` 872000 (272000 on the default tier);
  - **price step**: a small prompt on the long tier was billed at the **default** prices (input 10, cache read 1, cache write 12.5, output 50 credits per million tokens), not the listed long prices (20/2/25/75). The long prices apply above the default window; the UI's estimate now does the same;
  - back to the default tier: `applied`.
- **T045 `confirmation_required`** (one ~200k-token filler prompt in `gpt-6-luna`, **2.49 AIU**):
  - `setModel(mai-code-1.1-flash)` → `needs-confirmation` with `currentTokens` 199992 and `targetLimit` 128000; the model is unchanged;
  - raw `switchTo` gives `status: "confirmation_required"` and `confirmation { targetModelDisplayName, currentTokens, targetLimit }`;
  - an **invalid `compactionDecision`** is silently treated like none (same answer), so the runtime does not reveal the allowed values. Durbar still never sends one;
  - decline → `rejected`, nothing changed.
- **T045 Compact and switch** (same fill, **3.1 AIU** in all): `setModel(..., confirm accept)` compacted first and then switched (`applied`):
  - `compaction_start` / `compaction_complete` with trigger `model_switch`, 185964 → 10298 tokens, **0.23 AIU** for the compaction;
  - the new model still answered the code word from the filler.
- **Findings fixed in this change:**
  - The runtime's window is the **prompt budget**, not `max_context_window_tokens`: `gpt-6-luna` 272k (1M listed), long 872k; `mai-code-1.1-flash` 128k (256k listed); `claude-haiku-4.5` 128k (144k listed). `modelOptionFrom` now takes `tokenPrices.contextMax`, then `maxPromptTokens`, then `max_prompt_tokens`, then the context window; the long window is `longContext.contextMax`.
  - Copilot prices are AI credits per million tokens (bills matched exactly), so they are no longer marked `unverified`. The switch dialog can now show a credit estimate.
  - `CopilotAdapter` reports `modelSwitch.verified: true`: the menus stop saying "not verified on a real account".
- `[KNOWN GAP]`:
  - the long-tier prices above 272k were not billed in this run;
  - a switch queued during a turn on a paid model (T042 was run on `auto` only);
  - the allowed `compactionDecision` values.
- The **cap** finding from the same session (spec 013 C9: Copilot's session cap does not stop turns) is in spec 011.

### 2026-10-21: continue a conversation in another agent app (issue #409)

Owner's idea (#409): "provide ability to handover a conversation to a different agent app like what we do today to a different model or to create a new session with a summary … to freely move across them and validate or continue work with different models."

What already exists, reused rather than duplicated:
- the New session dialog's **Agent app** picker (spec 012 FR-059, FR-136);
- **Start with a summary of this conversation** (T061, FR-034..FR-036): the source app writes a hand-off summary on a fork (`handoffSummary`), and the user edits it before anything is sent;
- main's `agents:newSession`, which already starts any ready agent app in the same folder.

Picking another app and ticking the summary already worked, but nothing pointed to it, and the summary did not say where it came from.

- **FR-042** `[IMPLEMENTED]` **Entry point.** The chat's **More** menu and the command palette offer **Continue in another app…** for a live main session, when:
  - its app can make a hand-off summary (`capabilities.handoff`);
  - at least one *other* agent app is ready.

  Otherwise the entry is hidden (never shown disabled: one app installed means no clutter). It opens the usual New session dialog as a preset:
  - the title is "Continue in another agent app";
  - **Agent app** is preselected to the first other ready app, and the user can pick any ready app;
  - **Start with a summary** is ticked;
  - the target app's model list and effort apply (its own models, spec 012 FR-120).
- **FR-043** `[IMPLEMENTED]` **The summary says where it came from.** When the new session's app differs from the source's, the reviewed text starts with one line: "Continued from a <Source app> session (<agent name>) in this folder. Its summary:". The line is part of the editable text, so the user sees it and can change it. The hand-off prompt now asks for paths relative to the folder and no tool names, so another app can follow it.
- **FR-044** `[IMPLEMENTED]` **Defaults and safety.**
  - Nothing is sent to the new app before the user presses Start in the review step (unchanged from FR-036).
  - The new session's permission mode starts at the source session's mode, as for any new session (Read-only by default; constitution III), and Allow all still asks for confirmation.
  - The source session is untouched: it stays in the office with its history, and the user can end it.
  - The new session gets its own name like any new session; the provenance line (FR-043) says where it came from.
  - The summary's cost is the source app's, shown as before.
- **FR-045** `test:` the target choice and provenance line (`scripts/test-modelswitch.ts`). `sim:` driver `scripts/shots-030-handover.js` (mixed agent apps; More > Continue in another app…, the preset dialog, the review step with the provenance line, the new session in the other app) at 1440x900 and 1280x800. `real:` 2026-10-21 through Durbar's adapters (`handoffSummary` of the source, then a new session of the target app with `provenanceLine` + the summary as its first message, read-only, throw-away folder):
  - **Copilot → Claude Code:** the Copilot summary (3144 characters) carried the code name, and Claude Code (haiku) answered it: continued. Copilot `gpt-6-luna` 0.072 AIU for the turn and the summary; Claude ≈ $0.0021.
  - **Claude Code → Codex:** the Claude summary (664 characters, ≈ $0.0016) carried it, and Codex answered it: continued. Claude ≈ $0.0034 in all; Codex on the ChatGPT plan, about 15k input tokens.

### 2026-10-23: the Auto routing tier (007 FR-012..FR-018, issue #607)

- T060 is built in spec 007's delta: the Auto routing tier is a pressed-button group in this spec's model menu, switched with the same `switchTo` call and the same confirm/Undo/queue rules (a higher tier asks first). FR-013 gains one case: a tier the user chose and Durbar saved goes on resume too; with none saved, resume still sends no `capi.autoTier`.

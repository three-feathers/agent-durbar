# Feature Specification: Change the model and the context window inside a session

**Feature Branch**: `030-switch-model-context` (spec, research, plan and tasks only; code comes in later `030-<slug>` branches per task)
**Created**: 2026-10-17
**Status**: Planned. Researched on the SDK types and docs only: **nothing was run on a real account and no credits were spent** ([research.md](research.md)). Phase 1 (simulator only) can start; anything that needs a real session is `needs-owner-approval` and blocked.
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
- **FR-013** The adapter must not override a saved or switched model on resume: `start()` passes the saved model, effort and tier from the folder entry (which FR-006 keeps current) and `capi.autoTier` only for a **new** `auto` session. A test builds the create/resume config from a fake session and asserts this.

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

### Open questions for Vikram

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

*(none yet; real-session results and implementation deltas are recorded here)*

# Feature Specification: Models and reasoning effort

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: index
title: Model and reasoning-effort pickers
status: implemented
-->

**Feature Branch**: `007-models-and-effort` (reverse-engineered; milestone 6)
**Created**: 2026-10-16
**Status**: Implemented (reverse-engineered from `src/main/main.ts`, `src/adapters/copilot.ts`, `app.js`, README)
**Input**: "Choose the model, and the reasoning effort for models that support it, for each new session; show what I chose and what it costs relative to others."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pick a model for new sessions (Priority: P1)

The top bar has **Model: Auto** by default. When the app starts it asks the SDK what my Copilot account offers (no inference, no credits) and fills the list, showing the credit multiplier the API reports (`x0.33`, `x3`...).

**Acceptance Scenarios**:

1. **Given** a logged-in account, **When** the app starts, **Then** the model list is filled from `listModels()` minus models whose policy is `disabled`; `auto` is preselected when present. *(read:; real list printed by `npm run smoke`, m1; not re-run)*
2. **Given** the model call fails (not logged in), **When** it errors, **Then** the picker keeps only **Auto** and nothing else breaks. *(read:)*
3. **Given** the simulator, **When** open, **Then** three canned models appear (Auto, Sim Fast x0.33, Sim Deep x3 with efforts). *(sim:)*

---

### User Story 2 - Choose reasoning effort (Priority: P2)

For a model that lists supported efforts, an **Effort** picker appears (default plus the listed efforts); it is hidden otherwise.

**Acceptance Scenarios**:

1. **Given** a model with efforts `low/medium/high`, **When** selected, **Then** the Effort picker appears with "Effort: default (medium)". *(sim:)*
2. **Given** a model without efforts, **When** selected, **Then** the picker is hidden and no effort is passed. *(sim:)*

---

### User Story 3 - See what a session runs on (Priority: P2)

A chip in the chat header shows the model, the effort and, in the tooltip, the credit multiplier "as reported by your Copilot account". New sessions in a folder can pick their own model and effort in the dialog.

**Acceptance Scenarios**:

1. **Given** a session on `sim-deep` with effort `high`, **When** the chat is open, **Then** the chip reads `Sim Deep · high effort` with the multiplier in the tooltip. *(sim:)*

---

### Edge Cases

- Unknown or hand-edited saved effort values are dropped when loading the folder list (`low|medium|high|xhigh|max` only). `[IMPLEMENTED]` test:
- Model ids from the renderer are truncated to 100 characters before use. `[IMPLEMENTED]` read:
- A model the account cannot actually use makes `start` fail; the error shows as "Could not add: ..." / "Could not start a session: ...". `[IMPLEMENTED]` read:
- `auto` always starts with routing preference `efficiency`. `[IMPLEMENTED]` read:

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** `[IMPLEMENTED]` read: `models:list` returns id, name, multiplier, supported efforts and default effort for every non-disabled model, with no inference.
- **FR-002** `[IMPLEMENTED]` read: Default model is `auto` with `capi.autoTier = 'efficiency'` (the cheapest routing); any other model is passed by id with no tier.
- **FR-003** `[IMPLEMENTED]` read: Reasoning effort is passed to `createSession`/`resumeSession` only when the user chose one and it is in `low|medium|high|xhigh|max`.
- **FR-004** `[IMPLEMENTED]` sim: The top-bar model and effort apply to folders added next; the new-session dialog sets them per session; both are stored with the saved folder (feature 006).
- **FR-005** `[IMPLEMENTED]` sim: The chat header chip shows model, effort and multiplier tooltip; the desk role line includes `· <model>` for non-auto models.
- **FR-006** ~~`[KNOWN GAP]`~~ closed 2026-10-21 (see Changes): Only the `auto` model was available on the account used for development (free plan, README m1); a **multi-model list, multipliers and effort were never exercised on a real account**. The simulator uses canned data. (Feature 013.)
- **FR-007** ~~`[KNOWN GAP]`~~ closed 2026-10-21 (see Changes): The model or effort of a running session cannot be changed; the user must start a new session. `read:` (Closed **on the simulator only** by [030](../030-switch-model-context/spec.md) Phase 1: chat-header menu, confirm/Undo, queued switch; the real Copilot adapter still cannot switch in place and shows a disabled menu with New session. Phase 2 adds the real Copilot adapter's `setModel` from the SDK docs, tested on a fake session only: **not verified on a real account** until [030](../030-switch-model-context/spec.md) T041..T046.)
- **FR-008** `[KNOWN GAP]` The effort list is hard-coded in `main.ts` and `folders.ts`; an effort value the SDK adds later is silently dropped. `read:` (Task T021.)
- **FR-009** `[KNOWN GAP]` The `auto` routing tier (`efficiency|balance|intelligence`) is supported by the adapter but not selectable in the UI. `read:`
- **FR-010** ~~`[KNOWN GAP]`~~ superseded 2026-10-21 (see Changes): The multiplier is shown as returned (`x3`) without explaining units or relating it to the user's remaining credits (feature 011). `read:`
- **FR-011** `[IMPLEMENTED]` (2026-10-19, see Changes) Model listing and option mapping are covered by a credit-free test with fake model infos (`scripts/test-copilot-model.ts`). Before spec 030 this was a known gap: No automated test covers model listing or option mapping (it needs the SDK); `cheapestModel()` is used only by the smoke script. `read:`

### Key Entities

- **ModelChoice**: `id`, `name`, optional `multiplier`, `efforts[]`, optional `defaultEffort`.
- **SessionOptions**: `permMode`, `model`, `effort`.

## Success Criteria *(mandatory)*

- **SC-001**: With the account offering only `auto`, the UI shows Auto and no Effort picker (m1, `real:`).
- **SC-002**: Selecting a model with efforts reveals the Effort picker, and the chosen values reach `start()` (sim:, read:).

## Assumptions

- `ModelInfo.billing.multiplier`, `supportedReasoningEfforts`, `defaultReasoningEffort` and `policy.state` are present as in SDK 1.0.22 typings (the adapter compiles against them).

## Changes

- **2026-10-17, feature 030 Phase 1 (simulator only):** FR-007 is closed on the simulator: the model, effort and context tier of a running simulated session can be changed from the chat header or the office card menu, with a confirmation for pricier, unpriced, long-tier or over-headroom switches and an Undo for the rest. The real Copilot adapter is unchanged (no `setModel`), so real agents show the model chip as a menu that explains why it cannot switch and offers New session. `ModelChoice` gained optional `pricing`, `priceClass`, `contextTiers` and `longWindow` (the sim fills them; the real list does not yet). The saved folder entry gained `contextTier`. See [030](../030-switch-model-context/spec.md) `## Changes`.
- **2026-10-17, feature 030 Phase 2 (fake session only):** the Copilot adapter now fills `ModelChoice.pricing`, `priceClass`, `contextTiers` and `longWindow` from the runtime's billing data when it reports them (absent otherwise; `pricing.unverified` is always true because the unit of the token prices was never checked on a real account). Resume and create pass the saved model, effort and tier. Real agents can switch in place, flagged "not verified on a real account yet". See [030](../030-switch-model-context/spec.md) `## Changes`.
- **2026-10-17, feature 030 T040 (`real:`, read-only, 0 credits):** the real model list of the Copilot login on the box is only `auto`, with an empty window (0), no billing and no efforts. So today the picker offers Auto only on that login, and the price fields of `ModelChoice` have not been seen filled on a real account. [030](../030-switch-model-context/spec.md) research.md.
- **2026-10-17, feature 030 T041..T046 (`real:`, free plan, `auto` only):** a model the plan cannot use is refused (`cancelled`); `auto` resolved to `gpt-6-luna` with a 272k window (the context chip shows it after the first message); the real price unit is in each usage event (`costPerBatch` nano-AIU per batch), the model list's own price fields were never returned on this plan. [030](../030-switch-model-context/spec.md) research.md.
- **2026-10-19, tasks converge:** FR-011 is closed by spec 030: `scripts/test-copilot-model.ts` (in `npm test`) maps fake raw model infos (`modelOptionFrom`: name, multiplier, efforts, default effort, disabled, context window) without the SDK or credits. `test:`

### 2026-10-21: known gaps revalidated

- **FR-006** closed. `real:` 2026-10-20, Copilot Pro: the model list had five models (`auto`, `claude-haiku-4.5`, `gpt-6-luna`, `gpt-5.6-luna`, `mai-code-1.1-flash`) with their efforts, and effort low, medium and high were applied in one session (spec 013 C8 and spec 030 T041, recorded in #399).
- **FR-007** closed. A model or effort change inside a running session works on the real runtime: the conversation is kept (spec 030 T041/T044/T045, `real:` 2026-10-20, #399).
- **FR-010** superseded. Copilot Pro reports per-token prices (`billing.tokenPrices`) and **no multiplier** for these models; spec 030 shows prices and estimates instead.
- **FR-008** still open, made precise. The effort list (`EFFORTS` in `main.ts` and `folders.ts`) is `low|medium|high|xhigh|max`. The real model list also offers `none` (`gpt-6-luna`, `gpt-5.6-luna`), which a saved folder choice drops.
- **FR-009** still open: the `auto` routing tier is not selectable in the UI (no UI code reads `autoTier`).

### 2026-10-21: effort names come from the models; stale gaps closed

- **FR-008** `[IMPLEMENTED]`: the hard-coded effort list (`low…max`, in three places: `main.ts`, `folders.ts`, `shared/modelswitch.ts`) is replaced by one `parseEffort` (`src/shared/effort.ts`). It accepts a short lower-case word; the model's own `efforts` list (checked by `parseSwitchRequest`) and the runtime decide. `real:` 2026-10-20: `gpt-6-luna`, `gpt-5.6-luna` and the Codex models list **`none`**, which the old list dropped silently (the menu offered it, then the switch said "Invalid reasoning effort", and a saved `none` was lost on restore). Claude Code's own list stays `CLAUDE_EFFORTS`, now one copy shared by the CLI and SDK transports. `test:` `test-modelswitch.ts`, `test-folders.ts`.
- **FR-006 / FR-007** closed by spec 030: models and effort were checked on a paid account (030 T041/T044, `real:` 2026-10-20, #399), and the model of a running agent can be changed (030 Phase 1-2, 4).
- **FR-010** closed by spec 030: the model menu shows each model's price per million tokens and compares costs (030 FR-011, FR-012). Copilot's prices are now known to be AI credits per million tokens (#399).
- **FR-009** (the `auto` routing tier in the UI) stays open: spec 030 T060.

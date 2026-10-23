# Feature Specification: Models and reasoning effort

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: index
title: Model, reasoning-effort and Copilot Auto routing pickers
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
- `auto` always starts with routing preference `efficiency`. `[IMPLEMENTED]` read: (2026-10-23: unless the agent has its own saved tier or the organization's Copilot policy sets one, FR-012..FR-018.)

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
- **FR-009** ~~`[KNOWN GAP]`~~ closed 2026-10-23 (see Changes, FR-012..FR-018): The `auto` routing tier (`efficiency|balance|intelligence`) is supported by the adapter but not selectable in the UI. `read:`
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

### 2026-10-23: the Auto routing tier in the model menu (issue #607, owner go)

Input (issue #607, owner Vikram, 2026-10-23): "When the Copilot model is `auto`, newer Copilot CLI versions (1.0.87+) accept an `autoTier`: efficiency, balance or intelligence. Show the three tiers under 'auto' in the model menu (like the effort setting for Claude and Codex), remembered per agent; hidden on runtimes that don't support it. Respect a managed `autoTier` (show it locked)."

What the pinned SDK exposes (`read:` `@github/copilot-sdk` 1.0.22, bundled runtime 1.0.98, `dist/session.d.ts`, `dist/types.d.ts`, `dist/generated/rpc.d.ts`, all marked `@experimental`):
- `AutoTier` = `efficiency | balance | intelligence` (plus `fast`, "integrator-only", and any string the provider adds later);
- create and resume take `capi.autoTier` ("the runtime persists this preference across cold resume"); a live session takes `rpc.model.switchTo({modelId: 'auto', autoTier})` (the call Durbar already uses for every switch, spec 030) or `setAutoTier`;
- `session.model_change` carries `autoTier` and `previousAutoTier`;
- the runtime's managed settings: `client.rpc.managedSettings.resolve({})` returns `values.autoTier` and `meta.autoTier.overridable` (`false` = "policy locks the value"), with no session and no model call;
- the per-session model list (`session.rpc.model.list()`) has `auto.tiers[]` with `enabled` per tier; the sessionless list (`client.listModels()`) has no tier data.
- `real:` (2026-10-17, free plan, fixture `scripts/fixtures/events/real-030-switch-results.json`): `switchTo({modelId: 'auto', autoTier: 'efficiency'})` answered `applied`, and the runtime names the state "Auto (Efficiency)". `balance` and `intelligence` were never run on a real account.

Requirements:

- **FR-012** `[IMPLEMENTED]` `test:` The Copilot adapter adds `autoTiers: ['efficiency', 'balance', 'intelligence']` to its `auto` model option only when its runtime reports version 1.0.87 or newer (`client.getStatus().version`; issue #607). An older runtime, an unreadable version or any other adapter (Claude Code, Codex) lists no tiers, and the menu shows none. The `fast` preset and any tier the provider adds later are not offered (allow-list).
- **FR-013** `[IMPLEMENTED]` `sim:` In the chat's model menu (the same menu as the model list and the effort, spec 030; no new popup), an agent on Auto whose model option lists tiers shows **Auto routing** with three buttons, *Efficiency*, *Balance*, *Intelligence*, as a pressed-button group like the reasoning effort. The pressed one is the agent's own tier, else the organization's (FR-017), else Efficiency. The chip's tooltip and label add "· balance routing" (or intelligence, or efficiency) once the agent has its own tier; an agent without one reads as before.
- **FR-014** `[IMPLEMENTED]` `sim:` `test:` Choosing a tier switches the session with the same call and the same rules as a model switch (spec 030): applied from the next message with an Undo toast, or queued while a reply runs. A **higher** tier (Efficiency < Balance < Intelligence) asks first with the app's dialog (`askDialog`): Auto may route to models that cost more per token, the price of a tier is not reported, and the spending limit is not changed. A lower tier applies at once. The decision is one pure function (`autoTierConfirm` in `src/renderer/modelswitch.js`).
- **FR-015** `[IMPLEMENTED]` `test:` The main process checks a tier from the renderer (constitution III): only one of the three names, only with the model `auto`, only when the account's `auto` option lists it, and never another tier than a locked organization tier. Anything else is refused with a message and nothing is sent.
- **FR-016** `[IMPLEMENTED]` `test:` A tier is remembered per agent: saved with the folder entry (`autoTier`, Durbar's own file only; Copilot's settings are never written) once the switch is applied, dropped on load when it is not one of the three names, and kept while the agent uses another model, so going back to Auto uses it again. The next start passes the saved tier as `capi.autoTier` on create **and** on resume (the user's own choice, like the saved model, effort and context tier of spec 030 FR-013). With no saved tier nothing changes: a new Auto session gets `efficiency`, a resumed one keeps its own routing.
- **FR-017** `[IMPLEMENTED]` `test:` `sim:` The organization's tier: when the adapter lists models it also reads the runtime's managed settings (`managedSettings.resolve`, read-only, no session, no credits, at most 5 s). A value is read from own properties, together with its `overridable` flag, and anything malformed is ignored as a whole (no managed tier). A default must be one of the three names, and a lock fails closed (see the review-round delta below). A **locked** tier (`overridable: false`) shows the three buttons disabled with "Set by your organization's Copilot policy" and the locked one pressed; Durbar then never sends a tier (the runtime applies the policy). A managed tier that may be overridden is the default instead of Efficiency: Durbar sends no tier for an agent without its own, so the runtime's default applies. Durbar never reads or writes the policy files itself (issue #602 does that for the other settings).
- **FR-018** `[IMPLEMENTED]` `sim:` The simulator's Auto lists the three tiers; a tier switch applies, queues during a reply and reports the tier with the model change. The page address `?simtierlock=<tier>` simulates a locked organization tier. A driver (`scripts/shots-007-autotier.js`, in `npm run check:ui`) checks the menu, the confirmation for a higher tier, the Undo for a lower one, the chip and the locked state at 1440x900 and 1280x800 with `until()` waits only.

Review round 1 on #642 (Paco's agent, 2026-10-23), corrected wording:

- **FR-014** (delta) Going back to Auto from another model with the agent's own tier above Efficiency asks first. The dialog names the tier in its title ("Switch Hugo to Auto (Intelligence routing)?") and lists the higher-tier reasons (Auto may pick models that cost more per token; a tier's price is not reported). Before, it asked "Switch to Auto?" and then applied Intelligence without naming it. `sim:` `test:`
- **FR-016** (delta) Undo restores the agent's **own** choice, including "none of its own". It never pins the tier in effect, or the organization's default, as the user's choice. An Undo back to "none" sends `autoTier: null` over IPC, and the saved tier is cleared. To Copilot that means the default again: `efficiency`, or, under an overridable organization default, `null` (the provider's default, which `switchTo` accepts). Under a lock nothing is sent. `test:` `sim:`
- **FR-017** (delta) A lock **fails closed**. A well-formed lock (`overridable: false`) on a tier outside the three names (`fast`, or a future name: a plain word of 1 to 64 characters) still counts as a lock. Durbar sends no tier, the three buttons are disabled with none pressed, and the note says "Set by your organization's Copilot policy." without a name. An unknown tier that may be overridden is ignored. A failed or timed-out `managedSettings.resolve` counts as "no organization tier". That case **fails open**: the menu is unlocked and a new Auto session gets `efficiency`. The runtime still enforces its own policy and refuses or overrides the tier, and the refusal is shown (FR-019). The status and policy reads run at the same time, so the listing waits at most one time limit (5 s). `test:` `sim:`
- **FR-019** `[IMPLEMENTED]` `test:` `sim:` The runtime's `session.auto_tier_switch_failed` ("the previously effective preference remains active", `read:` SDK `AutoTierSwitchFailedData`) becomes the normalized event `autoTierFailed`. It carries `requested`, `effective` (the three names only, else absent) and a `reason` (`policy-rejected`, `request-failed`, `setup-failed`, `unsupported`, else `unknown`). Main shows and saves the tier still in effect (`effective`, else none of its own), so a resume does not ask for the failed tier again. The chat gets a note and a toast that name the tier still in use ("Copilot could not switch Auto to Efficiency routing (the routing request failed). It still uses Intelligence routing."). The simulator page address `?simtierfail=1` fakes the failure.
- **FR-020** `[IMPLEMENTED]` `test:` A `session.model_change` with `autoTierManaged: true` (the tier is the organization's default, `read:` SDK) never reports that tier as the user's own: the normalized `model` event leaves it out, so it is not saved.
- Accessibility (FR-013): when locked, the group and each button point at the note with `aria-describedby`, so a screen reader reads the reason, not only a tooltip. `sim:`
- FR-018: the queued tier switch is tested (`test-sim-model.ts`: a replying agent, `queued`, the reply ends, and the model change carries the tier). The simulator now counts its own reply as busy, as a real runtime does. The other-app guard has a handler-level test (`test-copilot-model.ts`, the real `agents:setModel` handler under a stand-in electron).

Known gaps (`[KNOWN GAP]`):
- A switch to `balance` or `intelligence` was never run on a real account (it costs credits; only `efficiency` was seen `applied`, 2026-10-17). Whether the runtime emits `session.model_change` for a tier-only change is unverified; the menu updates from the switch's own `applied` answer as well. `read:`
- The version gate (1.0.87) is the issue's and the vendor docs' number, not checked on an older runtime; Durbar bundles runtime 1.0.98. `read:`
- `managedSettings.resolve` returning an `autoTier` was never seen on a real organization policy (no managed account). `read:` SDK types only.
- The per-session `auto.tiers[].enabled` flags (a provider that turns a tier off) are not read: a tier the account cannot use is refused by the runtime and the refusal is shown. `read:`

Screenshots (`sim:`, driver `scripts/shots-007-autotier.js`, both sizes): [menu 1440x900](../../docs/screenshots/007-auto-tier-menu-1440x900.png), [menu 1280x800](../../docs/screenshots/007-auto-tier-menu-1280x800.png), [confirm 1440x900](../../docs/screenshots/007-auto-tier-confirm-1440x900.png), [confirm 1280x800](../../docs/screenshots/007-auto-tier-confirm-1280x800.png), [locked 1440x900](../../docs/screenshots/007-auto-tier-locked-1440x900.png), [locked 1280x800](../../docs/screenshots/007-auto-tier-locked-1280x800.png).

Tests: `test:modelswitch`, `test:copilotmodel`, `test:folders`, `test:simmodel`; each new check was mutation-checked (18 mutations of the new code, all caught, 2026-10-23).

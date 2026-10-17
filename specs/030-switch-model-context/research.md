# Research: 030 change model and context window within a session

Written 2026-10-17 (Europe/Madrid). **Docs only. No Copilot session was started, no prompt was sent, 0 AI credits were spent.**
Sources: `@github/copilot-sdk` **1.0.22** (CLI runtime 1.0.98) read in `node_modules/@github/copilot-sdk` (`dist/session.d.ts`, `dist/types.d.ts`,
`dist/generated/rpc.d.ts`, `dist/generated/session-events.d.ts`, `README.md`, the runtime's `schemas/api.schema.json`, and a string search of the
runtime binary), the SDK docs on GitHub (`docs/features/session-persistence.md`), and GitHub's docs for the Copilot CLI and Copilot billing
(`docs.github.com`, read 2026-10-17). Earlier real-runtime observations come from the [019 research](../019-mcp-tools-and-context/research.md) probe.

**Legend (how sure each statement is)**

| Tag | Meaning |
| --- | --- |
| **types** | Read in the SDK 1.0.22 declarations or the runtime's JSON schema (shape and doc comments). Never called. |
| **source** | Read in the SDK's JavaScript (`dist/session.js`). Never called. |
| **docs** | Stated in the SDK README/docs or in GitHub's published docs. Never called. |
| **confirmed (019)** | Seen on a real runtime in the 019 probe (`auto` model, logged-in account). |
| **unverified** | Inferred, or the text is silent. Needs a real run (phase 3 tasks, all `needs-owner-approval`). |

Everything below is **types / source / docs** unless it says otherwise. Nothing in this file was exercised on a real account for this feature.

## (a) Changing the model of an existing session

| Question | Answer | Status |
| --- | --- | --- |
| Is there a call to change the model of a live session? | Yes. `CopilotSession.setModel(model, options?)`: "The new model takes effect for the next message. Conversation history is preserved." Options: `reasoningEffort`, `reasoningSummary`, `contextTier`, `modelCapabilities`, `autoTier`. | types + docs |
| What does it call? | `this.rpc.model.switchTo({ modelId: model, ...options })` and **returns `void`**: the runtime's answer is thrown away. | source (`session.js`) |
| So what should Durbar call? | `session.rpc.model.switchTo(...)` directly (the adapter already does this for `rpc.options.update` and `rpc.mcp.*`), because only the raw result tells us `deferred`, `queueId`, `status`, `confirmation`, `warning`. | types (inference from source) |
| `switchTo` request | `modelId`, `providerId?`, `autoTier?` (only with `auto`), `reasoningEffort?: string \| null` (`null` clears the override, omitted keeps the current one; "validated against the selected model"), `reasoningSummary?`, `verbosity?`, `modelCapabilities?`, `contextTier?`, `source?`, `deferIfModelChangeQueued?`, `runCompactionPreflight?`, `compactionDecision?`, `requireAvailable?`, plus persistence fields `repoScope`, `modelChangeScope`, `pickerPersistence`. | types |
| `switchTo` result | `modelId`, `status`, `deferred`, `queueId`, `confirmation {targetModelDisplayName, currentTokens, targetLimit}`, `message`, `warning`, `deprecationWarnings[]`, `persistenceError`, `modelState` (`CurrentModel`). `status` is a free string; the schema names `confirmation_required`. | types |
| Change only the effort | `session.rpc.model.setReasoningEffort({reasoningEffort})`: "applies it to subsequent turns", no model change. | types |
| Read the current state | `session.rpc.model.getCurrent()` -> `modelId`, `reasoningEffort`, `contextTier`, `autoTier`, `pendingAutoTier`, `activatingAutoTier`. | types |
| Auto routing tier | `setModel('auto', {autoTier})` or `session.setAutoTier(tier)` (**@experimental**). `setAutoTier` only records the request: it commits on a later `auto` turn (`status: 'pending'`), outcome via `session.model_change` or the ephemeral `session.auto_tier_switch_failed {reason: policy_rejected \| request_failed \| setup_failed \| unsupported}`. | types + docs |
| What happens to a turn in progress? | `ModelSwitchToResult.deferred`: "True when the switch was deferred (enqueued as a cancellable `/model` command) because a turn was active or another model change was already queued ... the session's live model is unchanged until the queued change drains." The CLI doc says the same: "a change requested while the agent is running is queued as a cancellable command and applied once the current turn finishes, instead of switching the live model mid-request." A queued change shows up in `session.rpc.queue.pendingItems()` and can be removed with `queue.removeAt({id: queueId})`. | types + docs |
| Does the switch cost credits? | Nothing in the types says it runs inference, but a switch can first run a **compaction** (see below), which does. The first message after a switch sends the whole context to the new model. | **unverified** |
| Can the runtime switch the model by itself? | **Yes.** `session.model_change` carries `cause`: `"rate_limit_auto_switch"` (auto-mode-switch rate-limit recovery) or `"refusal_fallback"` (the model declined a request and the runtime moved to a fallback model). Durbar must show this, not hide it. | types |
| After resume | `resumeSession(id, {model, reasoningEffort, capi: {autoTier}, contextTier})` can change them: "Example: changing model on resume". The runtime persists the Auto tier (docs say omitting it on cold resume restores it). For `model` the docs are silent about what omitting does. | docs; model omission **unverified** |
| What Durbar does today on resume | `CopilotAdapter.start()` always passes `model` (from the saved folder entry, default `auto`) and `capi.autoTier: 'efficiency'` when the model is `auto`, on create **and** resume. So a model switched in a live session would be **overwritten by the saved one** at the next resume unless Durbar saves the switch. | read (`src/adapters/copilot.ts`) |
| Which values are valid | The target must be in the account's list and not `policy.state === 'disabled'`; `requireAvailable: true` makes the runtime refuse an unavailable target. An effort the model does not support is validated by the runtime (error shape unknown). | types; error shape **unverified** |
| Settings side effects | `repoScope`, `modelChangeScope` and `pickerPersistence` make the runtime **write the choice into Copilot's settings** (like `/model --global` or `--repo`). The CLI's `/model` defaults to "this session only" without them. Durbar must never send them (constitution III: no writes to the user's Copilot config). | types + docs |
| CLI `/model` | `/model [--session\|--global\|--repo\|--local] [MODEL \| auto TIER]`: by default changes "the model, reasoning effort, or context window for the current session only". Tab on a model with a long-context variant toggles its context column. | docs |

## (b) Context window: choose or change it?

| Question | Answer | Status |
| --- | --- | --- |
| Is the window fixed per model? | Per model and **tier**. `ModelInfo.capabilities.limits.max_context_window_tokens` (also `max_prompt_tokens`, `max_output_tokens`); `billing.tokenPrices.maxPromptTokens` is "the prompt token budget for the default tier. The total context window is this value plus the model's `max_output_tokens`". There is **no API to pick an arbitrary size**. | types |
| `auto` | `listModels` reports window `0` for `auto` (unknown); the real window is the resolved model's (`tokenLimit 272000` seen under `auto`). | confirmed (019) |
| Long-context variants | `contextTier: 'default' \| 'long_context'` is accepted by `createSession`, `resumeSession`, `setModel(..., {contextTier})`, `rpc.model.switchTo` and `rpc.options.update`. "long_context pins the session to the long-context tier when the selected model supports it." `billing.tokenPrices.longContext {inputPrice, outputPrice, cacheReadPrice, maxPromptTokens, ...}` exists for models that have one. `ModelInfo` from `client.listModels()` has **no** `supportedContextTiers` (the raw RPC `Model` does), so "this model has a long tier" is read from `tokenPrices.longContext`. | types |
| What the long tier costs | GitHub's pricing page lists, for some models, a *Long context* tier above an input-token threshold at a **higher per-token price**, usually twice (for example GPT-5.4: default up to 272K input tokens at $2.50 per million, long context above that at $5.00) and up to five times for one model (Claude Haiku 5.5: up to 100K at $0.10, above at $0.50). Whether the long tier is only a price band of the same window or a bigger window is unclear from the text. | docs; semantics **unverified** |
| Any override of the window? | `modelCapabilities` (deep partial of the capabilities, including `limits`) is accepted by `switchTo`; `maxPromptTokens` / `maxOutputTokens` exist only inside BYOK `ProviderModelConfig`. Telling the runtime a bigger window than the service accepts would only move the failure to the server. **Not offered.** | types |
| Compaction ("infinite sessions") | On by default: background compaction starts at **80 %** of the window, the session blocks at **95 %** until it finishes (`infiniteSessions {enabled, backgroundCompactionThreshold, bufferExhaustionThreshold}`; docs and the CLI's context page agree). Durbar does not set it today, so the defaults apply. | types + docs |
| Compact now | `session.rpc.history.compact({customInstructions?, trigger?: 'manual' \| 'model_switch', tokenLimit?})` -> `{success, tokensRemoved, messagesRemoved, summaryContent?, contextWindow?}`. The CLI's `/compact [focus]` is the same idea. `history.abortManualCompaction()` and `cancelBackgroundCompaction()` exist. Compaction is an **LLM call**: `session.compaction_complete.compactionTokensUsed` carries tokens and `aiCreditsStatus`/usage. | types + docs |
| Clear the conversation | CLI: `/clear`, `/new`, `/reset` start a new conversation. SDK: `session.rpc.history.clearContext({prompt})` "**Must be called from inside a tool handler** ... rejects when no tool call is in flight". A host app that is not itself a tool cannot call it. **Not possible from Durbar as a button.** Closest honest alternative: a **new session in the same folder** (exists today), optionally seeded by `history.summarizeForHandoff()` (markdown; whether it spends credits is **unverified**). | types + docs |
| Truncate / rewind | `history.truncate({eventId})`, `history.rewind(...)` (can restore files) exist; they destroy conversation or files. **Not offered** in this feature. A `session.truncation` event (`performedBy: BasicTruncator`) is emitted when the runtime truncates (relevant when infinite sessions are off). | types |
| Context on resume before the first turn | `session.rpc.metadata.contextInfo()` returns `null` before the first turn (confirmed 019). `metadata.recomputeContextTokens({modelId})` "re-tokenize[s] the session's existing messages against `modelId` ... an initial estimate of context usage on session resume". Cost unstated (looks local). | types; cost **unverified** |

## (c) Events: model change, context usage, window size

| Event or call | Fields that matter | Status |
| --- | --- | --- |
| `session.model_change` | `newModel`, `previousModel`, `reasoningEffort`, `previousReasoningEffort`, `contextTier`, `autoTier`, `previousAutoTier`, `cause`, `providerId`. Persisted (not ephemeral by declaration). | types |
| `session.usage_info` (ephemeral, before each model call) | `tokenLimit`, `currentTokens`, `messagesLength`, `systemTokens`, `conversationTokens`, `toolDefinitionsTokens`, `isInitial`. This is what the 019 context chip uses. After a switch the **new** limit appears with the next call (**unverified** that it is not sooner). | confirmed (019) for the fields; timing after a switch **unverified** |
| `session.compaction_start` / `session.compaction_complete` | `trigger`: `threshold` (background, automatic), `context_limit_retry`, `manual`, `memory_pressure`, `model_switch`; tokens before/after, `tokensRemoved`, `messagesRemoved`, `summaryContent`, `success`, `error`, `compactionTokensUsed`. | types |
| `session.context_cleared` | Only when the host clears the context (not reachable, see (b)). | types |
| `assistant.usage` | `model`, `modelDisplayName`, `maxPromptTokens`, `reasoningEffort`, `isAuto`, `cost` (multiplier cost, experimental), `copilotUsage.totalNanoAiu`, `aiCreditsStatus`. Gives the **real** per-call model and cost after the fact (the app already reads it). | types + confirmed (019) |
| `session.auto_mode_resolved` | Concrete model chosen under `auto` for the first prompt. | types |
| `session.rpc.metadata.contextInfo({promptTokenLimit: 0, outputTokenLimit: 0})` | "Pass 0 to resolve the selected model and context tier from the session": `modelName`, token breakdown, `promptTokenLimit`, `compactionThreshold`. A way to read the window after a switch without waiting for a call. | confirmed (019) after the first turn; use right after a switch **unverified** |

## (d) Cost and what the UI may show

| Question | Answer | Status |
| --- | --- | --- |
| Billing model | Since **2026-06-01** Copilot bills **GitHub AI Credits** from tokens (input, output, cached) at each model's rate; 1 credit = USD 0.01. "Model multipliers do not apply to usage-based billing"; they remain only for **annual** Pro/Pro+ plans still on request-based billing. | docs |
| What the SDK exposes per model | `billing.multiplier` (relative to the base rate; may be absent or legacy), `billing.tokenPrices {inputPrice, outputPrice, cacheReadPrice, cacheWritePrice, batchSize, maxPromptTokens, longContext{...}}` ("AI Credits cost per billing batch of ... tokens"), `billing.discountPercent` (the synthetic `auto` model), `billing.promo`, and the experimental `modelPickerPriceCategory` (`low \| medium \| high \| very_high`). Which of these an account really gets filled is **not known**: the 019 probe saw one model (`auto`) only. | types; population **unverified** |
| What the app shows today | `ModelChoice.multiplier` as `x0.33`, `x3` (spec 007 FR-010 already notes the units are unexplained). Under usage-based billing a bare multiplier can be absent or misleading. | read |
| Before-the-fact estimate | Possible only from `tokenPrices` and the current token count: `tokens / batchSize * inputPrice`. It is an **estimate**: caching, reasoning tokens and output are not known. | types; unit scale **unverified** (docs give prices per million tokens in USD) |
| Why a switch can cost more than the model price suggests | The new model gets the whole conversation as input. Provider prompt caches are per model, so a switch very likely starts with a cold cache (cached input is cheaper). | **unverified** (inference) |
| Compaction before a switch | `runCompactionPreflight: true` evaluates "context-window compaction policy before applying the switch"; if compaction is needed and no decision was given the runtime answers `status: 'confirmation_required'` with `confirmation {targetModelDisplayName, currentTokens, targetLimit}`; `compactionDecision` carries the answer. **The allowed values of `compactionDecision` are not documented** (a string); a runtime string search did not find them. `history.compact({trigger:'model_switch', tokenLimit})` says the compaction "still runs on the current model". | types; decision values **unknown** |
| Credit cap (spec 011) | `sessionLimits.maxAiCredits` is per session and survives a model switch (nothing in `switchTo` touches it). A pricier model reaches it sooner. | types |

## Other agents (spec 012, for adapter neutrality)

| Agent | Switch | Window | Compact | Status |
| --- | --- | --- | --- | --- |
| Claude Code (Agent SDK) | `Query.setModel()` in streaming-input mode; effort via options or `applyFlagSettings({effortLevel})` | `getContextUsage().maxTokens`, `modelUsage[].contextWindow` | `PreCompact` hook, `compact_boundary` message; a manual compact command is **unverified** | docs (012 research) |
| Codex (app-server) | `model` and `effort` on `turn/start` become the defaults for later turns: **from the next message** | `tokenUsage.modelContextWindow` (nullable) | `contextCompaction` item; a manual trigger is **unverified** | docs (012 research) |

So the neutral contract is: a switch may be `immediate`, `next-message` or unavailable; the window may be unknown; compaction may be automatic only. Copilot is the only adapter where all of it is declared in types.

## What this means (decisions that follow, details in [spec.md](spec.md))

1. **Switching is supported** by the SDK, applies to the next message, keeps the history, and a request made while a turn runs is queued by the runtime. The adapter uses `rpc.model.switchTo` to see the result, never the persistence fields.
2. **The window is not free to choose.** The only choice is the model and, where it has one, the long-context tier (with a price step). Everything else is shown, not set.
3. **Compact is available** (`history.compact`, costs a model call). **Clear is not** from outside a tool handler: use a new session, optionally with a reviewed summary.
4. **Cost display must follow usage-based billing:** prefer token prices and the price category over the legacy multiplier, estimate the next-message input cost, and say it is an estimate. Whether the account fills these fields is unverified.
5. **The runtime can switch models itself** (rate-limit, refusal fallback) and compact on its own (80 %/95 %): both are shown as events, never silent.
6. **Resume must not undo a switch:** the chosen model, effort and tier are saved with the folder entry (spec 007 FR-004 already stores model and effort).

## Not verified, and the task that settles it

| Unverified | Task (all `needs-owner-approval`) |
| --- | --- |
| Which pricing fields a real account returns; the unit scale of `tokenPrices` | T040 (0 credits: `listModels` only) |
| `model_change` and `usage_info.tokenLimit` after a switch; what the next call costs | T041 |
| Behaviour of a switch requested during a running turn (queue, cancel, `interrupt`) | T042 |
| Cost and events of a manual compact; allowed `compactionDecision` values | T043, T045 |
| Long-context tier: window and price step | T044 |
| Model after resume when `model` is omitted vs passed | T046 |

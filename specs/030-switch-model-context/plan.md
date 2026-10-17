# Implementation Plan: Change the model and the context window inside a session

**Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md) | **Tasks**: [tasks.md](tasks.md) | **Date**: 2026-10-17 | **Kind**: forward plan (nothing built)

## Summary

Let the user change the model, effort and (where it exists) context tier of a **live** session from the chat header and the office card menu, see the window and how full it is, compact it, and get a calm hint to start a new session when it is nearly full. Everything is built **simulator first** on a small set of normalized commands and events, so the UI never touches a vendor type and a second adapter (spec 012) can implement or decline each part. The Copilot adapter maps to `rpc.model.switchTo` and `rpc.history.compact`, tested on a fake session object. Real-session checks come last and are `needs-owner-approval`.

## Technical Context

- **Language**: TypeScript, CommonJS main (`tsconfig.json`), plain HTML/CSS/JS renderer; Electron 44; Node 20.19+/22.12+.
- **Dependencies**: none new. `@github/copilot-sdk` stays pinned at **1.0.22**; `rpc.model.*` and `rpc.history.*` are `@experimental` in its types, so each use is isolated in `copilot.ts` and covered by a fake-session test, and an SDK upgrade stays a deliberate step (CONTRIBUTING "Upgrading the Copilot SDK").
- **Testing**: `npm test` only: pure decision/estimate module, mapper fixtures (synthetic, derived from the type declarations, labelled `provenance: synthetic`), a fake `CopilotSession` object, folder store, IPC validation; simulator screenshots and `check:office`. Zero credits, no login.
- **Constraints**: no vendor type in `src/shared` or the renderer; nothing written to `~/.copilot`; 15 agents still fit at 1440x900 and 1280x800; text at least 10.5px.

## Constitution Check

| Principle | Result |
| --- | --- |
| I Spec Kit | Spec, research, plan and tasks exist and are committed before any `src/` change (this pull request is docs only). OK |
| II Adapter plug-ins | New optional `setModel?` and `compact?`, normalized events `model` and `compaction`, `ModelControl` data. The renderer reads only these. Copilot specifics (`switchTo`, `compaction_*`) stay in `copilot.ts` and `map.ts`. Claude and Codex can decline each part. OK |
| III Safe by default, no secrets | The switch never raises a cap, never switches to a pricier or unpriced model without confirmation, never sends the SDK's persistence fields (no write to the user's Copilot settings), validates every IPC argument in main, never logs the compaction focus text. OK |
| IV No credits in tests | Phases 1 and 2 need no account. Phase 3 is separate, one tiny prompt per check, `needs-owner-approval`, never in CI. OK |
| V Calm UI | A menu in the existing chip, one quiet inline line for compaction, one dismissible note near the limit, no new colours for spend, focus trapped in dialogs. Screenshots at both sizes in the UI tasks. OK |
| VI Parity | No paths or OS specifics added. OK |
| VII Quality gates | Each task keeps typecheck, build, tests green; pure logic has tests. OK |
| VIII Honest limits | The UI says what the SDK cannot do (free window, clear, unreported price); README and spec list the unverified items. OK |

**Complexity Tracking**: none (no new dependency, no new process).

## Architecture

```text
Renderer (chip menu, confirm dialog, context chip, notes)  -- reads AgentInfo.modelControl, ModelChoice, events model/compaction/context
   | window.durbar.setModel / compact           (preload, typed)
main.ts  -- agents:setModel / agents:compact (validate, look up agent, update AgentInfo, save folder entry) --> adapter.setModel? / compact?
   |
CopilotAdapter: session.rpc.model.switchTo / rpc.history.compact / rpc.queue.removeAt   --> SDK 1.0.22 (experimental RPC)
EventMapper:    session.model_change, compaction_start/complete, usage_info  --> ModelEvent, CompactionEvent, ContextEvent
SimAdapter (renderer-side, spec 010): same commands and events, scripted
```

### Interface deltas (spec 002 delta; Copilot behaviour unchanged until the Copilot tasks)

```ts
// src/adapters/types.ts (all optional, additive)
interface ModelSwitchRequest { model: string; effort?: string | null; contextTier?: 'default' | 'long'; confirm?: { compaction?: 'accept' | 'decline' } }
interface ModelSwitchResult {
  status: 'applied' | 'queued' | 'needs-confirmation' | 'rejected';
  model?: string; queueId?: string; message?: string; warning?: string;
  confirmation?: { targetName: string; currentTokens: number; targetLimit: number };
}
interface CompactResult { success: boolean; tokensRemoved?: number; tokensAfter?: number; message?: string }

interface ModelEvent extends BaseEvent {
  type: 'model'; model: string; previousModel?: string; effort?: string; previousEffort?: string; tier?: 'default' | 'long';
  cause: 'user' | 'runtime' | 'rate-limit' | 'fallback' | 'resume';
}
interface CompactionEvent extends BaseEvent {
  type: 'compaction'; phase: 'start' | 'complete' | 'failed'; trigger: 'auto' | 'manual' | 'model-switch' | 'overflow';
  tokensBefore?: number; tokensAfter?: number; tokensRemoved?: number; error?: string;
}
// ContextEvent: add optional `model?: string; tier?: 'default' | 'long'`
interface AgentAdapter {
  setModel?(sessionId: string, request: ModelSwitchRequest): Promise<ModelSwitchResult>;
  cancelQueuedModel?(sessionId: string, queueId: string): Promise<void>;
  compact?(sessionId: string, focus?: string): Promise<CompactResult>;
}
```

`src/shared/api.ts`: `ModelChoice` gains `pricing?`, `priceClass?`, `contextTiers?`, `longWindow?`; `AgentInfo` gains `modelControl?`, `tier?`, `pendingModel?`; bridge methods `setModel`, `cancelQueuedModel`, `compact`.

`ModelControl = { switch: 'live' | 'next-message' | 'none'; effort: boolean; contextTier: boolean; compact: boolean; windowKnown: boolean }`. Derived in `main.ts` from which optional members exist; when 012's `AdapterCapabilities` land (012 T010) it is replaced by fields of that type, with the same names where possible (`models`, `effort`, `context`) and two additions (`modelSwitch`, `compact`). 030 does **not** depend on 012: both orders work.

### Pure modules (dependency-free, unit-tested, reusable by a second adapter)

| File | What |
| --- | --- |
| `src/shared/modelswitch.ts` | `relativePrice(from, to)`, `estimateInputCredits(tokens, model, tier)`, `confirmFor(current, target, ctx)` returning `{needed, reasons[], estimate?, headroom?}`, `suggestFresh(...)`, `pricingFromBatch(price, batchSize)` (credits per million tokens), formatting helpers. No SDK types. |
| `scripts/test-modelswitch.ts` | cases: cheaper, equal, pricier, unpriced, long tier, cap headroom, estimate rounding, unit scale, `suggestFresh`. |

### Copilot mapping (inside `copilot.ts` / `map.ts` only)

| Durbar | Copilot SDK 1.0.22 | Note |
| --- | --- | --- |
| `setModel` | `session.rpc.model.switchTo({modelId, reasoningEffort, contextTier: 'default'\|'long_context', requireAvailable: true, deferIfModelChangeQueued: true, source: 'model_picker', runCompactionPreflight: true, compactionDecision?})` | **Never** `repoScope`, `modelChangeScope`, `pickerPersistence`. `deferred` -> `queued` with `queueId`; `status: 'confirmation_required'` -> `needs-confirmation`. The compaction decision strings are **unknown** (research): the adapter sends `compactionDecision` only after T045 records them; until then `needs-confirmation` is shown and the user can only Cancel or switch to a model that fits. |
| `cancelQueuedModel` | `session.rpc.queue.removeAt({id: queueId})` | |
| `compact` | `session.rpc.history.compact({trigger: 'manual', customInstructions})` | refuse while `rpc.metadata.isProcessing()` or the agent status is `working` |
| window after a switch | next `usage_info`; optionally `rpc.metadata.contextInfo({0, 0})` right after (T041 decides) | chip says "waiting for the next message" until known |
| `ModelChoice.pricing` | `billing.tokenPrices.inputPrice / batchSize * 1e6` (and output, cacheRead, `longContext`) | **unit scale unverified** (T040); until then the UI shows the price class and the relative step, and shows credits only when both fields exist |
| `ModelChoice.contextTiers` | `['default'] + ['long'] if billing.tokenPrices.longContext` | `ModelInfo` has no `supportedContextTiers` |
| `model` event | `session.model_change` (`newModel`, `previousModel`, efforts, `contextTier`, `cause`) | `cause` `rate_limit_auto_switch` -> `rate-limit`, `refusal_fallback` -> `fallback`, absent -> `runtime` unless Durbar just requested it (matched by model id) -> `user` |
| `compaction` event | `session.compaction_start/complete` (`trigger`: `threshold` -> `auto`, `manual`, `model_switch` -> `model-switch`, `context_limit_retry` -> `overflow`; `memory_pressure` -> `auto`) | failure from `success: false` + `error` |
| resume | `start()` passes saved `model`, `reasoningEffort`, `contextTier` (kept current by FR-006) and `capi.autoTier` only for a **new** `auto` session | fixes the overwrite described in the spec |

### Renderer (plain JS, same style as the mode chip of spec 018)

- `app.js`: model chip -> `modelChipHTML` button with `aria-haspopup="menu"`; `openModelMenu` (list, effort row, long-context toggle, pending row with Cancel); `confirmSwitch` dialog (reuses `dialog.js` focus trap); compaction line and the start-fresh note rendered as chat notes; office card menu entry **Model...**.
- `screens.js`: context chip gains tier text, "waiting" state and the **Compact** action; the Tools "Agents" tab shows model changes.
- `sim.ts`: models with prices, a long-context model, queued switch, `model` and `compaction` events, a runtime fallback.
- `styles.css`: reuse mode-menu classes; no new colour tokens.

## Phased approach (each task is one issue and one pull request; see [tasks.md](tasks.md))

| Phase | What | Credits | Account |
| --- | --- | --- | --- |
| 1. Simulator-only | Pure module, interface types, mapper fixtures, simulator behaviour, IPC, folder store, chip menu, confirmation, context chip and compact, start-fresh note, office menu, screenshots, docs | 0 | none |
| 2. Copilot adapter on a fake session | `setModel`, `compact`, queue cancel, resume config, pricing fields, capabilities | 0 | none |
| 3. Real checks | Record real `listModels` pricing, one switch, a switch during a turn, compaction, long-context tier, resume after a switch | small, estimated, **owner approves** | the owner's Copilot login |

Phase 1 is shippable on its own: the simulator shows the whole feature, and with the real adapter (no `setModel` yet) the controls are disabled with a reason and **New session** is offered, which is today's behaviour (no regression, no dead buttons).

## Risks

| Risk | Mitigation |
| --- | --- |
| `rpc.model.*` is experimental and may change | pinned SDK, one place in `copilot.ts`, fake-session tests, spec says unverified |
| Pricing fields empty or in an unexpected unit on a real account | UI falls back to price class and "price not reported" (which also triggers confirmation); T040 records the real shape for free |
| `confirmation_required` decision values unknown | adapter never guesses a string; the user can only cancel until T045 |
| A queued switch and `interrupt()` interplay unknown | UI shows the runtime's `getCurrent()` truth after Stop; T042 |
| The switch quietly costs more (cold cache, long tier) | confirmation wording is about the estimate only; the real cost shows in the usage line after the reply; no promise of exactness |
| UI clutter in the chat header | one chip (already there) becomes the menu; compaction and the near-limit note are single quiet lines |

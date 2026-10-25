# Feature Specification: Thinking that shows up, and sub-agent activity

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 015-018
title: Thinking that shows up, sub-agent activity
status: milestone 7
-->

**Feature Branch**: `015-thinking-and-subagent-activity` (milestone 7; amends 002 FR-007, FR-010, FR-013)
**Created**: 2026-10-16
**Status**: Implemented (milestone 7)
**Input**: Vikram, real use: (1) "I see no thinking in the chat"; (2) "when sub-agents are used I want to see what each did".

## What the real runtime sends (captured 2026-10-16, Copilot CLI 1.0.98, model `auto` -> `gpt-6-luna`, free plan; sanitised fixtures in `scripts/fixtures/events/`)

- Only one model is offered (`auto`), with no reasoning-effort options, so no explicit reasoning model/effort could be tested. `[LIMIT]`
- A prompt that needs real thought ("is 391 prime?") streams `assistant.reasoning_delta` (110 deltas in about 1 s, a markdown summary such as `**Calculating prime status**`, `reasoningTokens > 0`) and a closing `assistant.reasoning` with the whole text (arrives *after* `assistant.message`, same `reasoningId`).
- A prompt that only delegates or reads files (the sub-agent prompt) streams **no** reasoning at all (`reasoningTokens: 0`) and no `assistant.intent`. So many real turns have nothing to show as "thinking".
- Sub-agent run (`task` tool): parent `tool.execution_start(task, args {description, prompt, agent_type})` -> `subagent.started` (`agentId` = sub-agent instance, `data.toolCallId` = the parent's `task` call, `agentName`, `agentDisplayName` = the task label, `model`) -> `subagent.configured/selected` -> `user.message` (the sub-agent's prompt) -> the sub-agent's own `assistant.*`, `tool.*` (each has `agentId`; tool events also `data.parentToolCallId`), `permission.*`, `assistant.usage` -> `subagent.completed` (`durationMs`, `totalTokens`, `totalToolCalls`) -> parent `tool.execution_complete(task)` whose result is the sub-agent's final answer. Every event of a sub-agent carries the instance `agentId`; only some carry `parentToolCallId`.

## Root cause of the empty "Thinking" (as found in code and fixtures)

1. Most agentic turns carry no reasoning (above), and the block was then replaced by a one-line "No reasoning summary was provided". Nothing else was shown, so the chat felt empty.
2. When reasoning did arrive it was one block per message, collapsed as soon as the answer finished, rendered as raw text (`**...**` showing literally, 190 px cap), and reasoning of sub-agents was dropped.
3. Sub-agent events were attributed by the SDK instance id while helper cards were keyed by the `task` tool call id, so a helper never received its own intent/thinking/tools, and its tool calls were mixed into the parent's chip list.

## User Scenarios & Testing

### User Story 1 - See thinking, or why there is none (P1)
**Acceptance**:
1. Reasoning deltas stream into a "Thinking" block (markdown rendered), one block per reasoning id, in timeline order with tool chips and text; it stays readable after the turn (collapsed to its first line + "Show").
2. A complete `assistant.reasoning` without earlier deltas is shown whole.
3. When a turn has no reasoning the chat shows a calm line "This model does not send reasoning for this step" plus what *is* known: the intent line, interim plan/progress text and the live tool timeline. No empty block.

### User Story 2 - Sub-agent activity (P1)
**Acceptance**:
1. The parent's `task` call shows a nested, collapsible **sub-agent block**: name, task, model, status (running/done/failed), its prompt, its own thinking/intent, its tool chips, final result, duration/tokens when known. It updates live.
2. Sub-agent tool calls, text and thinking are **not** mixed into the parent's list.
3. Clicking a helper card in the office/strip opens a read-only transcript of that sub-agent inside the full-screen chat.
4. Failed sub-agents show the error.

## Requirements
- **FR-001** The adapter maps SDK events with a pure, unit-tested function (`src/adapters/map.ts`) using recorded fixtures (no credits).
- **FR-002** Every normalized event from a sub-agent carries `agentId` = the spawning `task` tool call id (learned from `subagent.started`), also for events that only have the instance id.
- **FR-003** New normalized fields: `thinking.reasoningId` and `thinking.final/text`; `subagent.agentName/model/prompt/result/durationMs/totalTokens/totalToolCalls/error`; sub-agent `user.message` becomes `{type:'user', agentId}`.
- **FR-004** Usage of sub-agents counts in the parent's total *and* in the helper's own line.
- **FR-005** The simulator emits thinking (markdown), sub-agent runs with their own events, and a no-reasoning turn, so all views are testable without credits.
- **KNOWN LIMIT** Reasoning of `auto` arrives in one ~1 s burst after a few seconds of waiting, so "streaming" is short; no explicit reasoning model could be tested on this plan; nested sub-agents are shown flat under the top-level agent.

## Changes

### 2026-10-25: "Compacting…" on the desk, compaction for every agent app, a context gauge that follows it (issue #601)

**Input**: Vikram, 2026-10-23, issue #601 (owner go): when a conversation gets long the agent app compacts (summarises) it and the agent forgets details; today that is invisible for Claude and Codex, and for Copilot it only shows as a chat line. Show **Compacting…** on the desk while it happens, a note in the chat where history was summarised, and a live context-fill gauge that turns amber near the limit.

**What already exists (reused, not rebuilt)**: the normalized `compaction` event, its chat line (folded when repeated) and the start-fresh note (spec 030 FR-014, FR-019, 052 FR-163); the context ring and the Simple "Memory N% full" chip, live on every `context` event, amber from 70 % and red above 90 % (`ctxLevel`, spec 005 FR-051, 034); `a.compacting`. Copilot already maps `session.compaction_start` / `_complete` (spec 030). `[IMPLEMENTED]`

**What was missing**: (1) the desk, list row, chat header and strip say nothing while a compaction runs; (2) Claude Code's compaction is dropped at `claudeMap.ts` (`system` messages `status` and `compact_boundary`); (3) Codex's `contextCompaction` item is dropped at `codexMap.ts`; (4) Copilot's `session.truncation` (older messages dropped without a summary) is dropped; (5) after a compaction whose new size the app does not report (Claude, Codex) the gauge keeps the old, too-high figure until the next message and can wrongly trigger the "nearly full" note.

#### What each agent app really reports (`read:` unless stated; no real session was run for this delta, [KNOWN GAP] below)

| Agent app | Start | End | Numbers | Source |
|---|---|---|---|---|
| Claude Code | `system` message `subtype: 'status'`, `status: 'compacting'` | `system` message `subtype: 'compact_boundary'`, `compact_metadata: { trigger: 'manual' \| 'auto', pre_tokens }` | size before only; none after (the next assistant message's usage gives it, and the existing FR-134 `context` event then follows) | Agent SDK reference (`SDKStatusMessage`, `SDKCompactBoundaryMessage`), spec 012 research |
| Codex | `item/started` with `item.type: 'contextCompaction'` | `item/completed` of the same item | none | app-server `ThreadItem` (spec 012 research); the manual trigger is unverified |
| Copilot | `session.compaction_start` (`trigger`, `currentTokens`, `tokenLimit`) | `session.compaction_complete` (`success`, `pre/postCompactionTokens`) | before and after | spec 030, `real:` 2026-10-20 |
| Copilot | | `session.truncation` (`preTruncationTokensInMessages`, `postTruncationTokensInMessages`, `tokensRemovedDuringTruncation`, `tokenLimit`): the older messages were **dropped, not summarised** | before and after, in messages only | `@github/copilot-sdk` generated types, `read:` |

#### User scenarios (all on the simulator first)

**US-C1 (P1)** While an agent app compacts, the agent's desk, list row, chat header and chat-strip entry say **Compacting** (one word, spec 052 FR-076), the desk line reads "Compacting the conversation…", and the context ring says so in its name and tooltip. When it ends the pill returns to the agent's real status. A failed compaction ends the mark and says so in the chat line ("The conversation is unchanged").
**US-C2 (P1)** The chat shows where history was summarised: one line (existing, folded when repeated). Claude and Codex show it too. A truncation reads "older messages were dropped" and is never called "compacted by summary".
**US-C3 (P1)** The gauge never claims what the app did not report: after a Claude or Codex compaction the gauge reads "waiting for next message" (existing `ctxWaiting` state) until the next `context` event, and the "nearly full" suggestion does not fire on the old figure.
**US-C4 (P2)** The gauge is amber from 70 % and red above 90 %, live on every `context` event, with a text cue as well (the number, and a centre dot above 90 %); it never shows below 0 % or above 100 %, whatever number arrives.

#### Requirements

- **FR-006** `CompactionEvent.trigger` gains `'truncation'` (older messages dropped, not summarised) and `'unknown'` (the app does not say who started it). The chat line leaves the "(automatic)" wording out for `unknown`. The event guard checks `trigger` (the whole set), `tokensBefore/After/Removed` and `limit` (finite, not negative) and `error` (string); a bad event is dropped like any other.
- **FR-007** Claude (`claudeMap.ts`): `system/status` with `status: 'compacting'` from the **main agent** (a message with `parent_tool_use_id` or `agent_id` is a helper's and is ignored) emits `compaction{phase:'start', trigger:'unknown'}` once (a second `compacting` while one is open adds nothing). `system/compact_boundary` emits `compaction{phase:'complete'}`; `trigger` is `manual` or `auto` from `compact_metadata.trigger`, anything else `unknown`; `tokensBefore` is `pre_tokens` only when it is a finite number >= 0 and below 1e9, else absent. A boundary with no `start` before it still emits `complete`. A `status` message whose `compact_result` is `'failed'` ends an open compaction with `phase:'failed'` (no vendor text is copied); an open compaction when the turn's `result` arrives ends the same way (so the desk can never stay on Compacting). `reset()` forgets the open compaction. After a boundary the adapter forgets its last context size so the old figure is not re-sent.
- **FR-008** Codex (`codexMap.ts`): `contextCompaction` item `started` emits `compaction{phase:'start', trigger:'unknown'}`, `completed` emits `complete` with no numbers (the item has none); helper threads are ignored; a `completed` with no open start still emits `complete`; an open compaction at `turn/completed` or a turn error ends as `failed`. `thread/compacted` (deprecated notification) is not read.
- **FR-009** Copilot (`map.ts`): `session.truncation` of the main agent emits `compaction{phase:'complete', trigger:'truncation', tokensBefore, tokensAfter, tokensRemoved, limit}` from `preTruncationTokensInMessages`, `postTruncationTokensInMessages`, `tokensRemovedDuringTruncation`, `tokenLimit`, each only when a finite number >= 0. These count messages only, not the whole window (system prompt, tools), so the chat line shows the removed count and the gauge keeps waiting for the next `context` event.
- **FR-010** Renderer (`app.js`): a pure rule in `modelswitch.js` (`DurbarModel`): `compactingNow(agent)` is true for a live, main, un-paused agent with `a.compacting` whose state is not `waiting`, `error` or `done`. `pillSt`/`stWord` return `compacting` / "Compacting" (after Retrying, before Failing), `deskLine` the "Compacting the conversation…" line, the card gets `is-compacting`, the list dot `compacting`, the strip item `st-compacting` (no attention flag: it needs nothing from the user). Colours reuse the Thinking palette (no new status colour); no motion beyond what exists. `onCompaction` repaints the office and the chat header on start and on end. The mark never changes a card's size.
- **FR-011** The ring's accessible name and tooltip start with "Compacting the conversation…" while `a.compacting`; its level colour is unchanged.
- **FR-012** `onCompaction`: a `complete` with no `tokensAfter` sets `a.ctxWaiting` (reusing spec 030's state; its tooltip now says "The model changed or the conversation was compacted") so the gauge shows no stale figure, and `maybeSuggestFresh` is skipped for that event; the next `context` event clears it. A `complete` with `tokensAfter` behaves as before.
- **FR-013** Gauge maths is the existing `ctxLevel` / `fmtTokens`; they are unit-tested with hostile values (NaN, Infinity, negative, > 100 %, huge, strings, `limit` 0) and the result is always `null` (unknown) or a whole number 0..100.
- **FR-014** Simulator: `simcompact=1` keeps one agent mid-compaction (Clara) and one that just truncated; the existing automatic (80 %) and manual compactions keep working. Driver `scripts/shots-015-compact.js` (until() waits, both sizes, Serious mode, list view, chat header, strip, the ring name, `ctxWaiting` after a `complete` without numbers, a failed compaction ends the mark) is in the UI suite.
- **FR-015** Unit tests, no credits: `scripts/test-compaction.ts` (Claude, Codex and Copilot mapping from synthetic messages shaped like the sources above, hostile values, ordering, helper isolation, `reset`, the event guard, the renderer rules, `ctxLevel`), each case mutation-checked.

**Not changed**: no new IPC channel, preload method or renderer-to-main input (events flow from the adapters to the renderer only, through the existing guard); no new setting; thresholds stay each agent app's own defaults (spec 030 Q5); `compact()` (manual) stays Copilot-only.

- `[KNOWN GAP]` `read:` Claude's `status: 'compacting'` / `compact_boundary` shape and Codex's `contextCompaction` item are from the SDK reference and spec 012's research, not from a recorded real session; the order of `status: null` and `compact_boundary` in Claude's stream, whether Codex sends `item/started` for a compaction, and the Copilot truncation payload were not verified on a real account (no AI credits spent). If a real session sends a different shape the compaction is not shown (the mapper ignores it), never a wrong value. Verify when an owner approves a real run.
- `[KNOWN GAP]` Not checked on macOS (PR CI runs a Linux stub, spec 008 FR-106); the change has no platform-specific code.

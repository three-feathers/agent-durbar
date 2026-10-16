# Feature Specification: Thinking that shows up, and sub-agent activity

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

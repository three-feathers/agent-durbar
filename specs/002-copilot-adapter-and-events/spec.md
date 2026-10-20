# Feature Specification: Copilot adapter and normalized events

**Feature Branch**: `002-copilot-adapter-and-events` (reverse-engineered; milestones 1, 3, 5, 6)
**Created**: 2026-10-16
**Status**: Implemented (reverse-engineered from `src/adapters/types.ts`, `src/adapters/copilot.ts`, `src/main/main.ts`, README)
**Input**: "Start real GitHub Copilot sessions through the official SDK, one per folder, and turn what they do into a small set of events the UI understands."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A real agent per folder, live (Priority: P1)

I add a folder; a Copilot session starts in it using my existing Copilot login; when I send a message I see its status, intent, thinking,
tool calls and answer stream into the office and chat.

**Independent Test**: `npm run smoke` (uses a few AI credits) or the simulator for the UI half. On a real session this was exercised in milestones 1 and 3 (`real:`).

**Acceptance Scenarios**:

1. **Given** a logged-in Copilot CLI/SDK user and a folder, **When** I add the folder, **Then** an agent appears in `idle` "Ready in <folder>" (or "Not started" for a restored folder, feature 006).
2. **Given** a running turn, **When** the runtime emits reasoning/message deltas and tool events, **Then** the renderer receives `thinking`, `output`, `toolCall` events and the agent shows working/thinking.
3. **Given** the turn ends, **When** `session.idle` arrives, **Then** the agent shows done with the last answer as its task line.
4. **Given** a runtime error, **When** `session.error` arrives, **Then** the agent shows `error` with `errorType: message`.

---

### User Story 2 - Sub-agents show up as helpers (Priority: P2)

When the agent spawns sub-agents (the `task` tool), helpers appear on its desk and finish as done or failed.

**Acceptance Scenarios**:

1. **Given** `subagent.started`, **When** received, **Then** a helper (`parentId:toolCallId`) appears working with the agent's description as its task.
2. **Given** `subagent.completed` / `subagent.failed`, **When** received, **Then** the helper turns done / error (with the error text).

---

### User Story 3 - Swap the runtime without touching the UI (Priority: P2)

A developer adds another agent runtime by implementing `AgentAdapter` and emitting normalized events.

**Acceptance Scenarios**:

1. **Given** the `AgentAdapter` interface, **When** an adapter implements `start/send/stop/onEvent` (and optionally `interrupt/resolvePermission/revokeGrant`), **Then** the renderer needs no change. *(Proven only by the simulator, which implements the bridge, not by a second adapter: see FR-012.)*

---

### Edge Cases

- Sending to an unknown or ended session throws `Unknown or stopped session` in the adapter; the main process starts/resumes first (`ensureLive`, feature 006). `[IMPLEMENTED]` read:
- Runtime start failure (not logged in, runtime missing): `start()` rejects; the error text is shown as a toast "Could not add: ...". `[IMPLEMENTED]` read: (not re-run without a Copilot login)
- Reasoning arrives as deltas *and* as a complete block: the complete block is dropped when deltas for that block id were seen. `[IMPLEMENTED]` read:
- Reasoning never arrives (model/effort/Auto): the chat says "No reasoning summary was provided for this step." `[IMPLEMENTED]` read:
- Tool events carry the tool name only on `start`; the adapter remembers `callId -> tool` for `update/complete`. `[IMPLEMENTED]` read:
- Unknown SDK event types are ignored (default branch). `[IMPLEMENTED]` read:

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** `[IMPLEMENTED]` real: One shared `CopilotClient` (one runtime process, started lazily on first use) serves all sessions; one SDK session per agent.
- **FR-002** `[IMPLEMENTED]` read: The adapter never receives, stores or passes a token; the runtime uses the Copilot login of the machine. In a packaged app the runtime path is resolved from `app.asar.unpacked` (feature 008).
- **FR-003** `[IMPLEMENTED]` real: Sessions are created with `workingDirectory` = the folder (first folder of a `.code-workspace`), `streaming: true`, model (default `auto`, with `capi.autoTier: 'efficiency'`), optional `reasoningEffort`, and an `onPermissionRequest` handler backed by the permission broker (feature 003).
- **FR-004** `[IMPLEMENTED]` read: `start` supports resume by id (`resumeSessionId`), "resume if it exists on disk else create with this id" (`sessionId`), or new.
- **FR-005** `[IMPLEMENTED]` real: `send` emits `status working "Thinking"`, converts attachments (images -> base64 `blob` with MIME type; other files -> `file` with display name) and calls `session.send`.
- **FR-006** `[IMPLEMENTED]` read: `interrupt` denies pending permissions, aborts the turn and emits `idle "Aborted"` (feature 003/005); `stop` ends the session (`abort` + `disconnect`), emits `stopped`; `dispose` ends all sessions and the runtime.
- **FR-007** `[IMPLEMENTED]` read: The SDK-to-normalized mapping is exactly the table in plan.md. Events with an `agentId` are sub-agent events; `toolCall` events inside a sub-agent carry `agentId ?? parentToolCallId`. **Amended by 015:** the mapping lives in the pure `EventMapper` (`src/adapters/map.ts`); sub-agent events carry `agentId` = the spawning task tool-call id.
- **FR-008** `[IMPLEMENTED]` real: `usage` events carry model, input/output/cache-read tokens, `nanoAiu` (1e-9 AI units, as reported by the API), cost multiplier and credits status; the renderer sums them per agent and shows tokens and AIU.
- **FR-009** `[IMPLEMENTED]` read: `listModelOptions()` lists models (no inference) with multiplier, supported efforts and a disabled flag (feature 007). `listPreviousSessions`/`history` support feature 006.
- **FR-010** `[IMPLEMENTED]` read: **Superseded by 015.** Events with an `agentId` are routed to that sub-agent's own event log (nested block under the parent's task call and the read-only helper transcript); they no longer appear in the parent's chip list or text.
- **FR-011** `[PARTLY CLOSED by 015: mapper unit-tested with recorded fixtures]` There is **no automated test of the event mapping** (`map()` is private and tied to SDK types). A regression in a mapping would only show with a live session. `npm run smoke` exercises it but spends credits and is not in CI. (Task T020.)
- **FR-012** ~~`[KNOWN GAP]`~~ closed 2026-10-21 (see Changes): Only one adapter exists; the interface has never been implemented twice, so its fitness for Claude/Codex is unproven (feature 012).
- **FR-013** `[IMPLEMENTED]` Closed by 015: a helper's prompt, thinking/intent, tool calls, result and stats are attributed to it (fixtures in `scripts/fixtures/events/`, `npm run test:events`).
- **FR-014** `[KNOWN GAP]` SDK events not mapped: `tool.shell_output`, user-input requests, plan-mode requests, `assistant.usage_checkpoint`/limits, session-created/updated lifecycle events. Agents that block on those would look idle/working without a prompt for the user. `read:`
- **FR-015** `[IMPLEMENTED]` (checked 2026-10-19) `package.json` declares `@github/copilot-sdk` as exactly `1.0.22` (no range), as constitution II asks. Was a known gap when it said `^1.0.22`. (Task T022.)
- **FR-016** `[IMPLEMENTED]` (2026-10-19, T024) `reasoningSeen` and `toolNames` are cleared when the session goes idle, so a stopped turn leaves nothing behind. `test:` `test:events`.
- **FR-017** ~~`[KNOWN GAP]`~~ closed 2026-10-21 (see Changes): Credits (`maxAiCredits` in `StartOptions`) exists in the interface but is not wired to anything (feature 011).

### Key Entities

- **AgentAdapter**: `id`, `start`, `send`, optional `interrupt`, `stop`, optional `resolvePermission`, `revokeGrant`, `onEvent`.
- **AgentEvent** (union): `user | status | permission | grants | thinking | output | toolCall | subagent | usage`, all with `sessionId`, optional `agentId`, `timestamp`.
- **AgentStatus**: `idle | working | needs-permission | error | stopped`.

## Success Criteria *(mandatory)*

- **SC-001**: A real read-only prompt on a free-plan account produces status, tool, output and usage events in the UI (milestones 1/3, `real:`; costs recorded in the README: 4 prompts = 0.416 AIU, 1 prompt = 0.189 AIU).
- **SC-002**: The renderer never imports an SDK type or a vendor event name (it imports only `AgentEvent`/`AgentInfo` types). `read:` (grep shows the renderer has no SDK import)

## Assumptions

- The `@github/copilot-sdk` 1.0.x API and event names stay as documented at <https://github.com/github/copilot-sdk>; protocols are evolving.
- The user has a Copilot subscription (free works) and has run `copilot login`.

## Changes

- **2026-10-17, feature 030 Phase 2 (fake session only, no credits):** `AgentAdapter` gained three optional members: `setModel(sessionId, request)`, `cancelQueuedModel(sessionId, queueId)` and `compact(sessionId, focus?)`, and the normalized events `model` and `compaction` (types in `src/shared/modelswitch.ts`). `CopilotAdapter` implements them on `rpc.model.switchTo`, `rpc.queue.removeAt` and `rpc.history.compact` (experimental SDK calls, read from the SDK 1.0.22 types and docs). Main derives the UI's `modelControl` from which members exist, so an adapter without them (a future one, or the simulator's "none" agent) shows a disabled menu with a reason and New session. `StartOptions` gained `contextTier`; `start()` passes the saved model, effort and tier on create and on resume and the `auto` routing preference only for a new session. The pure helpers are in `src/adapters/copilotmodel.ts`. `listModelOptions` returns the extra price fields. `test:copilotmodel` runs the real adapter against a fake client and session. `[KNOWN GAP]` What the real runtime does with these calls is unverified (030 T040..T046). See [030](../030-switch-model-context/spec.md).
- **2026-10-17, feature 030 Phase 3 (`real:`, free plan, `auto` only, 0.56 AIU):** `setModel`, `cancelQueuedModel`, `compact` and resume were run against a real session. Changes: `status: "cancelled"` maps to `rejected` with a plain message; runtime error text is unwrapped; `session.compaction_complete` also emits a `usage` event from `compactionTokensUsed` (the cost was invisible before); Stop drops a queued switch (no event; the renderer clears its pending note on the `Aborted` idle). Details: [030](../030-switch-model-context/spec.md).
- **2026-10-18, spec 012 T010 (issue #30, simulator and unit tests):** `AgentAdapter` gains `displayName`, `capabilities`, required `isLive`/`dispose` and optional `listModelOptions`/`listPreviousSessions`/`history`/`setPermMode`/`debug`; `StartOptions.permissionMode` wins over `allow`/`ask` (unknown = read-only); `UsageEvent` gains `costUsd`/`costBasis` (a vendor estimate, never summed into AIU). `CopilotAdapter` behaviour is unchanged; `main.ts` talks to `AgentAdapter` only. See spec 012 `## Changes` 2026-10-18.
- **2026-10-18, cross-reference to spec 012 T016 (issue #36; built 2026-10-18, unit tests):** the credit-free adapter test that T020 asks for is built there. The recorded event fixtures are replayed through `CopilotAdapter` with a fake SDK client and session, and the normalized stream is compared with `EventMapper`'s (spec 012 FR-057). The adapter contract suite also runs on Copilot (FR-056). T025 (a second adapter) stays open until spec 012 T043/T045: `FakeAdapter` (spec 012 T015) proves the contract, not a second runtime.
- **2026-10-18, spec 012 Phase 1 (T011-T016, T019) and what it means for the Copilot adapter (simulator and unit tests; 0 AIU; not checked on a real account):** `CopilotAdapter` now exports `COPILOT_DESCRIPTOR` and `COPILOT_CAPABILITIES` (one constant shared by the instance and the descriptor), and is created through the adapter registry and router, one instance per run. `startModeOf(options)` (the FR-028 mode precedence) moved unchanged to `src/adapters/permissions.ts`. The existing protected `getClient()` seam is how the adapter contract suite and the recorded-event replay run on Copilot with a fake SDK client (`scripts/fakes/copilot-sdk.ts`); no `src/` change was needed for that. Copilot's behaviour, events and IPC results are unchanged. See spec 012 FR-030..FR-034, FR-046..FR-050, FR-052, FR-055..FR-057 and the T010 line above.

- **2026-10-18, session titles for main agents (issue #126; simulator, fixtures and unit tests, 0 AIU):** *Symptom:* a main agent's card showed its folder name, while sub-agents showed their own names; Copilot does name every session (a title from the first prompt, later perhaps an auto summary or a `/rename` name), but the adapter dropped `session.title_changed`. *Missing:* a normalized event for it. *Corrected:* a new normalized event `{ type: 'title', title }` (top-level agent only; a sub-agent's title event is ignored). The Copilot mapper turns `session.title_changed` into it; when a turn ends and no title has arrived yet, the adapter asks `session.rpc.name.get()` once (no prompt, no credits) and emits the name if there is one. Titles are cleaned (one line, control and hidden characters removed, at most 80 characters with an ellipsis; empty = none). The list of previous sessions now prefers a session's saved `name` over its `summary` as its title. The main process keeps the title as `AgentInfo.title`; `AgentInfo.name` stays the folder, so tool-usage labels and usage totals never contain a title. Other adapters: optional, no title = today's look. **`real:` 2026-10-18** (Vikram's account, asked for explicitly; SDK 1.0.22; one Read-only prompt "Reply with the single word: ok." on `auto` in a throwaway folder, **0.1533 AIU**; the built `CopilotAdapter` with a probe that recorded raw event types): `session.title_changed` arrived for the top-level session (no `agentId`) 640 ms after the start, as soon as the prompt was sent and before the model turn, with the prompt's text as the title; the adapter emitted the normalized `title` at once; `name.get` after the turn returned the same name (the fallback was not needed). After ending the session and resuming it by id (the restored-folder path, no prompt) the runtime sent **no** title event again, and the adapter's `name.get` on resume restored the title, so that path is needed. The previous-sessions list showed the title after the session ended. `[KNOWN GAP]`: a later auto summary replacing the first title was not seen in this short run.

- **2026-10-19, questions from Copilot (`ask_user`; uses the question card of spec 012 FR-128..FR-130, issue #60):** *Missing:* the adapter gave the SDK no `onUserInputRequest`, so Copilot sessions were created without the `ask_user` tool and Copilot could never ask the user to choose. *Corrected:* **FR-058** `[IMPLEMENTED]` `CopilotAdapter` passes `onUserInputRequest` (the SDK's legacy `ask_user` form: one question, optional `choices`, `allowFreeform`). It emits the normalized `question` event (one question, its choices as options, at most 6) with status "Waiting for your answer", and waits for `answerQuestion`. The answer goes back as `{ answer, wasFreeform }` (`wasFreeform` when the text is not one of the choices); a skip answers "(The user skipped the question. Decide yourself.)" as free text; Stop, End and an error cancel it the same way. Allowed in every permission mode (a question is not an action). Tests on a fake session (`test:copilotmodel`: choice, free text, skip, Stop). `real:` 2026-10-19, one Read-only prompt on `auto`: Copilot called `ask_user` ("Which colour do you prefer?", choices Red and Blue), the answer "Blue" went back, and it replied "You chose Blue." (0.1774 AIU). Not checked: the `elicitation` form of `ask_user` (`askUserVariant`), which stays off.

### 2026-10-21: known gaps revalidated

- **FR-012** closed. The interface now has three production adapters (Copilot, Claude Code, Codex; spec 012), run against real accounts on Linux, macOS and Windows in the spec 062 e2e run 39496442403 (9/9).
- **FR-017** closed. `maxAiCredits` maps to `sessionLimits` (spec 011 FR-009), and Durbar itself enforces it (spec 011 FR-070..FR-074, in review in #400).
- **FR-014** narrowed. User-input requests reach the app through the SDK callback (`onUserInputRequest`, spec 002 FR-058), and `session_limits_exhausted.*` and `session_limits_changed` are mapped. Still not mapped as events: `tool.shell_output`, plan-mode requests and the session lifecycle events. `session.usage_checkpoint` is read by the adapter for the cap (#400), not mapped.

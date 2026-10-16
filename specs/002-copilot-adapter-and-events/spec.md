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
- **FR-007** `[IMPLEMENTED]` read: The SDK-to-normalized mapping is exactly the table in plan.md. Events with an `agentId` are sub-agent events; `toolCall` events inside a sub-agent carry `agentId ?? parentToolCallId`.
- **FR-008** `[IMPLEMENTED]` real: `usage` events carry model, input/output/cache-read tokens, `nanoAiu` (1e-9 AI units, as reported by the API), cost multiplier and credits status; the renderer sums them per agent and shows tokens and AIU.
- **FR-009** `[IMPLEMENTED]` read: `listModelOptions()` lists models (no inference) with multiplier, supported efforts and a disabled flag (feature 007). `listPreviousSessions`/`history` support feature 006.
- **FR-010** `[IMPLEMENTED]` read: The renderer ignores `thinking`/`output`/`status` from sub-agents (`agentId` set) so helper chatter does not corrupt the parent chat, but **shows** their `toolCall`s in the parent chat.
- **FR-011** `[KNOWN GAP]` There is **no automated test of the event mapping** (`map()` is private and tied to SDK types). A regression in a mapping would only show with a live session. `npm run smoke` exercises it but spends credits and is not in CI. (Task T020.)
- **FR-012** `[KNOWN GAP]` Only one adapter exists; the interface has never been implemented twice, so its fitness for Claude/Codex is unproven (feature 012).
- **FR-013** `[KNOWN GAP]` Helper cards only reflect `subagent.*` events (started/completed/failed and the description); a helper's own intent, tool calls and usage are not attributed to it (README: "Sub-agent event mapping is best effort").
- **FR-014** `[KNOWN GAP]` SDK events not mapped: `tool.shell_output`, user-input requests, plan-mode requests, `assistant.usage_checkpoint`/limits, session-created/updated lifecycle events. Agents that block on those would look idle/working without a prompt for the user. `read:`
- **FR-015** `[KNOWN GAP]` The SDK dependency is declared as `^1.0.22` in `package.json`; only `package-lock.json` pins 1.0.22 (README says "pinned in package.json"; constitution II asks for pinned SDK/runtime). (Task T022.)
- **FR-016** `[KNOWN GAP]` `reasoningSeen` and `toolNames` are not cleared when a session stops mid-turn (tiny leak per aborted turn). `read:`
- **FR-017** `[KNOWN GAP]` Credits (`maxAiCredits` in `StartOptions`) exists in the interface but is not wired to anything (feature 011).

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

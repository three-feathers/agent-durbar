# Implementation Plan (as built): Copilot adapter and normalized events

**Spec**: [spec.md](spec.md) | **Date**: 2026-10-16 | **Kind**: reverse-engineered

## Summary

`CopilotAdapter` (`src/adapters/copilot.ts`) wraps the official `@github/copilot-sdk` (lockfile 1.0.22, bundled runtime) and translates its `SessionEvent`s into the
adapter-neutral `AgentEvent`s of `src/adapters/types.ts`. The Electron main process owns the adapter and forwards every event to the renderer over one IPC channel.

## Technical Context

- **Language**: TypeScript (CommonJS, `tsconfig.json`), Node 20.19+/22.12+ (Electron 44).
- **Dependencies**: `@github/copilot-sdk` (runs its own runtime process over stdio).
- **Testing**: no unit test for the mapping (FR-011). `scripts/smoke.ts` (`npm run smoke`) drives real sessions and **spends credits**; never in CI.
- **Constraints**: no token handling; one runtime per app; events delivered in order per session.

## Constitution Check

| Principle | Result |
| --- | --- |
| II Adapter plug-in | Interface exists and the renderer is vendor-neutral. Only one implementation; proof pending (feature 012). **Partial** |
| III No stored tokens | No token code anywhere in `src/`. OK (`read:`) |
| IV No credits in tests | `npm test` has no adapter test; smoke is manual. OK, but a gap in coverage (FR-011) |
| VI Parity | Runtime path resolution handles win32/darwin/linux (feature 008). Only Linux exercised. **Partial** |
| VIII Honest limits | FR-013, FR-014 documented here and in the README. OK |

## As-built architecture

```text
Renderer (app.js) <-- IPC 'agent:event' -- main.ts (owns CopilotAdapter) -- CopilotAdapter -- @github/copilot-sdk -- runtime process
                  --> IPC invoke: agents:send / stop / end / resolvePermission / ... -->
```

Files: `src/adapters/types.ts` (interface + events), `copilot.ts` (adapter), `permissions.ts` (broker, feature 003), `workspace.ts`
(`.code-workspace` -> cwd), `runtime.ts` (packaged runtime path), `history.ts` (feature 006), `src/main/main.ts` (wiring), `src/shared/api.ts` (bridge types), `src/preload/preload.ts`.

### SDK event -> normalized event (as implemented in `map()`)

| SDK event | Normalized | Notes |
| --- | --- | --- |
| `assistant.turn_start` | `status working` | |
| `assistant.intent` | `status working` + `intent` | becomes the card's task line |
| `assistant.reasoning_delta` | `thinking` (delta) | remembers `reasoningId` |
| `assistant.reasoning` | `thinking` (whole) | only if no delta seen for that id |
| `assistant.message_delta` | `output` (delta) | |
| `assistant.message` | `output` `final:true` + `text` | skipped when content is empty |
| `assistant.usage` | `usage` | tokens, `copilotUsage.totalNanoAiu`, `cost`, `aiCreditsStatus` |
| `tool.execution_start` | `toolCall start` | args; stores name by `toolCallId`; `agentId ?? parentToolCallId` |
| `tool.execution_partial_result` | `toolCall update` | |
| `tool.execution_complete` | `toolCall complete/failed` | output = result content or error message |
| `subagent.started/completed/failed` | `subagent started/completed/failed` | `subagentId` = tool call id |
| `session.idle` | `status idle` | `intent: 'Aborted'` if `aborted` |
| `session.error` | `status error` | `"<errorType>: <message>"` |
| anything else | ignored | see FR-014 |

Adapter-generated (not SDK): `status idle "Ready in <cwd>"` on start (unless `quiet`), `status working "Thinking"` on send, `status idle "Aborted"` on interrupt,
`status stopped` on stop, and the permission events of feature 003.

### Lifecycle

- `getClient()`: lazy single `CopilotClient`; packaged apps pass `RuntimeConnection.forStdio({path: unpackedRuntimePath()})`.
- `start()`: resolves the cwd, builds the broker, creates/resumes the session, subscribes `session.on`, emits Ready.
- Main process helpers: `addWorkspace`, `ensureLive` (dedupes concurrent starts per agent id), `startOptionsFor`.
- Dev hooks: `adapter.debug` sink (`DURBAR_LOG`) records what is handed to the SDK; attachment payloads are summarised, not dumped.

## Project Structure (documentation)

```text
specs/002-copilot-adapter-and-events/
├── spec.md
├── plan.md
└── tasks.md
```

## Verification status

| Claim | How | Result |
| --- | --- | --- |
| Typecheck/build/tests pass | `npm run typecheck && npm run build && npm test` | pass 2026-10-16 |
| Streaming sessions, tools, usage on a real account | README milestones 1/3 (smoke + e2e driver) | `real:` recorded, not re-run (needs login + credits) |
| Mapping table above | read against `map()` | matches code |
| Sub-agent identity (`agentId`) | README: "best effort" | not verified on a real multi-agent run |
| Second adapter | n/a | does not exist |

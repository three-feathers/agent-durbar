# Feature Specification: Second and third agent adapters (Claude Code, Codex CLI)

**Feature Branch**: `012-claude-codex-adapters`
**Created**: 2026-10-16
**Status**: Draft (backlog). Not clarified, no plan, no tasks yet. Run `/speckit.clarify` first.
**Input**: README roadmap "Second adapter (Claude or Codex CLI)" (unchecked) and constitution principle II (adapters are plug-ins).

## What exists today

- `[IMPLEMENTED]` `AgentAdapter` (`src/adapters/types.ts`): `start`, `send`, optional `interrupt`, `stop`, `resolvePermission`, `revokeGrant`, and `onEvent` of normalized events (feature 002). One implementation: `CopilotAdapter` (`copilot.ts`); `main.ts` constructs it directly.
- `[KNOWN GAP]` The interface has **never been implemented twice**, so it is unproven for other agents. Likely Copilot-shaped parts: session ids, `StartOptions` (model/effort/permission modes as Copilot names them), `subagent.*` helper events, nano-AIU usage, folder/session history readers (`history.ts` reads Copilot's `events.jsonl`), the permission request kinds (feature 003), the model list (feature 007).
- `[KNOWN GAP]` `main.ts` has no adapter registry: choosing an adapter per folder/agent does not exist.
- From `docs/research.md` (copied claims, not re-checked): ACP (`copilot --acp`) is a public-preview protocol, and over ACP sub-agent text arrives without agent identity (copilot-cli issue 4106), which is why Copilot uses the SDK. Other agents may offer ACP, a headless/JSON mode or an SDK; **which ones and how stable is unresearched here**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add a folder and choose which agent works in it (Priority: P1)

When I add a folder I can pick Copilot (default) or another installed agent; its agent appears in the office, chats, asks permission and shows usage like any other.

**Independent Test**: a second adapter that does not touch the Copilot SDK (the simulator can be wrapped as one, feature 010) passes the same credit-free adapter contract tests as Copilot's fake.

**Acceptance Scenarios**:

1. **Given** Claude Code or Codex is not installed, **When** I open the picker, **Then** it is shown as unavailable with the install hint and nothing is spawned.
2. **Given** a Claude/Codex agent running, **When** it asks to edit a file, **Then** the same approval card appears and the same permission modes apply (read-only by default), or the adapter states it cannot enforce a mode and refuses to start in a mode it cannot honor (constitution III).
3. **Given** an adapter without helper/sub-agent events, **When** it works, **Then** the desk shows no helper tiles and nothing breaks.

### User Story 2 - Capabilities are declared, not guessed (Priority: P2)

Each adapter declares what it can do (interrupt, resume, attachments/images, model and effort lists, permission modes, credit usage, caps, helpers, history) and the UI hides or disables what is missing.

### User Story 3 - Contract tests for every adapter (Priority: P2)

One adapter contract suite runs against Copilot (fake SDK client), the simulator and each new adapter (fake process), without AI credits.

### Edge Cases

- The CLI is installed but not signed in, a different version, or prints unexpected output.
- Two agents of different kinds in the same folder.
- An adapter crashes: the agent becomes `error` without bringing down the others (constitution II).
- Credentials: signing in stays in the other tool; the app never reads, stores or forwards tokens (constitution III).
- Windows/macOS/Linux install locations and `.cmd` shims for the CLI (constitution VI).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** An adapter registry in the main process maps adapter id → factory; `agents:add` takes an adapter id (default `copilot`); persisted folders store it (migration keeps old files working).
- **FR-002** `AgentAdapter` gains `capabilities` (or an equivalent declared object); the renderer reads it through IPC types in `src/shared` that contain no Copilot types.
- **FR-003** Claude Code adapter and Codex adapter in `src/adapters/<id>.ts`, each behind the interface; transport chosen in `/speckit.plan` after research (SDK, ACP, or CLI headless JSON) with the stability and sub-agent-identity trade-offs recorded in the plan.
- **FR-004** Permission mapping: each adapter maps its own approval prompts to `PermissionRequest` kinds and to the three modes; anything it cannot enforce is declared and refused, never silently weakened.
- **FR-005** Normalized events are extended only when needed (a spec delta in 002); adapters that lack a field omit it.
- **FR-006** Spawning follows the repo rules: no shell with user-controlled strings, absolute paths resolved per OS.
- **FR-007** Tests: adapter contract suite plus per-adapter mapping tests using recorded, redacted fixtures; no real sessions in `npm test`.
- **FR-008** The README documents what each adapter supports and what was verified on a real session (feature 013 style).

### Key Entities

- **AdapterDescriptor**: id, display name, availability probe, capabilities, install hint.
- **Capabilities**: interrupt, resume, images, models, effort, permissionModes, usage, caps, helpers, history.

## Success Criteria *(mandatory)*

- **SC-001**: Two adapters of different kinds run side by side on the simulator-free office (fake processes) with no renderer change beyond the picker and capability gating.
- **SC-002**: The contract suite passes for all adapters on Windows, macOS and Linux CI.
- **SC-003**: Unsupported capabilities never show a dead button.

## Assumptions and open questions

- [NEEDS CLARIFICATION] Claude Code first, Codex first, or both in one milestone? Which transport each (ACP vs SDK vs CLI JSON), and is any of them stable enough to pin?
- [NEEDS CLARIFICATION] Does the user already have these CLIs signed in, and do they spend the user's own subscription/API credits? (Real checks cost money: they are `needs-approval` and belong to feature 013.)
- [NEEDS CLARIFICATION] Do we show other tools' sessions in "Previous sessions" or only live ones?
- Depends on: 002, 003, 006, 007, 011 (caps need capabilities), 013 (real recordings for fixtures).

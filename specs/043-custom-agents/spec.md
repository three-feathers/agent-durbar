# Feature Specification: Custom agent per session

**Feature Branch**: `043-custom-agents`
**Created**: 2026-10-19
**Status**: Phase 1 built (simulator, unit tests, real check 2026-10-19); Phase 2 not started
**Input**: Issue #127 (owner's idea, 2026-10-17, with research notes on SDK 1.0.22 / runtime 1.0.98): let the user pick a custom agent for a session and change it mid-session, like Copilot and other harnesses do.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pick a custom agent for a running session (Priority: P1)

In the chat header, next to the model chip, an **Agent** chip shows "Default agent" or the selected agent's name. Its menu lists the agents available to the session (name, description, where it comes from: this folder's repository or your user folder) and "Default agent". Choosing one makes it the agent for the next turns; the history is kept.

**Acceptance Scenarios**:

1. **Given** a folder with `.github/agents/reviewer.agent.md`, **When** I open the Agent menu, **Then** "reviewer" is listed with its description and "from this folder". *(sim:, real:)*
2. **Given** I choose it while the agent is idle, **Then** the chip shows its name at once and the next reply is from that agent. *(sim:, real:)*
3. **Given** I choose "Default agent", **Then** the session goes back to the standard agent. *(sim:, real:)*

### User Story 2 - A repository agent asks once before it is used (Priority: P1)

An agent file in the folder's repository was written by someone else. Before it is used the first time, a dialog shows what it brings: its tools (or "all tools"), its preferred model, its MCP servers and the file path. **Use this agent** or **Cancel**. The choice is remembered for that folder and that file's content; a changed file asks again. User-level agents (your own folder) do not ask.

**Acceptance Scenarios**:

1. **Given** a repository agent never used in this folder, **When** I choose it, **Then** the dialog lists its tools, model and MCP servers, and nothing is selected until I confirm. *(sim:)*
2. **Given** I confirmed it before and the file is unchanged, **Then** it is selected without asking. *(sim:)*

### User Story 3 - Switching during a turn waits (Priority: P2)

The runtime has no queue for an agent switch. A choice made while the agent works waits until the turn ends ("Next: reviewer" on the chip); Stop drops it.

**Acceptance Scenarios**:

1. **Given** the agent is working, **When** I choose another agent, **Then** the chip says "Next: …" and the switch happens when the turn ends. *(sim:)*
2. **Given** a waiting switch, **When** I press Stop, **Then** the waiting switch is dropped and a note says so. *(sim:)*

### Edge Cases

- No agents found: the menu says so and where to put agent files (`.github/agents/*.agent.md` in the folder, `~/.copilot/agents`).
- An agent with `userInvocable: false` is not listed (sub-agent only).
- The agent's preferred model can be ignored by the runtime (on the Free plan `auto` stays): the model chip keeps showing the model from usage events, not the agent's wish.
- The session's permission mode is never changed by an agent: Read-only / Ask first / Allow all stay, and every tool call still goes through the permission broker.
- Agents of other adapters (Claude, Codex): not in Phase 1; the interface is generic ("agent profile") so they can map to it later.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** The adapter interface gains a generic agent profile (`id`, `name`, `description`, `source`: `repo` | `user` | `other`, `path?`, `tools?` (null = all), `model?`, `mcpServers?` (names only)), the optional members `listAgentProfiles(sessionId)` and `selectAgentProfile(sessionId, id | null)`, and a normalized `agentProfile` event (the selected profile or null). No Copilot types outside the adapter (constitution I).
- **FR-002** `CopilotAdapter` passes explicit `agentDirectories` (`<folder>/.github/agents` for each session folder, and `~/.copilot/agents`) instead of turning on config discovery (which would also load the repository's skills). It lists agents with `rpc.agent.list` (user-invocable ones only), selects with `rpc.agent.select`, clears with `rpc.agent.deselect`, reads the current one with `rpc.agent.getCurrent` after start and resume, and maps `subagent.selected` / `subagent.deselected` to `agentProfile`.
- **FR-003** Main: IPC `agents:listProfiles` and `agents:selectProfile` (validated ids). A repository profile is selected only after the user confirmed it for that folder and that file's content (SHA-256 of the file, read by main); confirmations are saved in the app's settings (folder, agent id, hash; no file content). Unconfirmed: main refuses and the renderer shows the dialog first.
- **FR-004** Renderer: the Agent chip and menu in the chat header (US1), the repository-agent dialog (US2), the waiting switch on a busy agent and its drop on Stop (US3). The office card shows the selected agent's name in its subtitle. Text only, never HTML.
- **FR-005** Simulator: three fake profiles (one repository, one user, one with MCP servers) on Copilot agents, select and deselect events, no credits.
- **FR-006** Tests: the Copilot mapping of agent lists and events on a fake session; the confirmation store; IPC validation. `real:` one free-plan check in a throwaway folder with one repository agent: list, select (the next reply follows the agent's prompt), deselect.

### Key Entities

- **Agent profile**: what the user can select for a session; generic across adapters.
- **Repository agent confirmation**: folder + agent id + file hash, saved by the app.

## Success Criteria *(mandatory)*

- **SC-001**: In the simulator, a user can pick, change and clear an agent on a session in at most two clicks, and a repository agent always shows the dialog the first time.
- **SC-002**: On a real Copilot session, a selected repository agent changes the reply as its prompt says, and the permission mode still applies.

## Assumptions and dependencies

- SDK 1.0.22 `rpc.agent.*` is `@experimental`; recorded as such.
- Phase 2 (not in this spec's Phase 1): the agent in the New session dialog, a per-folder default, Claude/Codex mapping.

## Changes

### 2026-10-19: Phase 1 built and checked

- `sim:` the Agent chip and menu (Default agent, "from this folder", "your agents"), the confirmation dialog for a repository agent (tools, model, MCP servers, file), no dialog for a user agent or a confirmed one, the card subtitle, the waiting switch ("Default agent → Docs writer") and its drop on Stop, at 1440x900 and 1280x800 (`docs/screenshots/043-*.png`).
- `test:` `npm run test:agentprofiles` (profile mapping, agent folders, event mapping, confirmation store and file hash).
- `real:` 2026-10-19, Free plan, `auto`, Read-only, the real app with a throwaway folder holding `.github/agents/pirate.agent.md` (about 3 prompts, under 0.6 AIU with the adapter-level run):
  - the menu listed "pirate · from this folder"; the confirmation dialog appeared; after **Use this agent** the chip said "pirate" and the reply began "Arr, hello!";
  - **Read-only still applied**: asked to create a file with the pirate agent selected, no file was written and it answered that the workspace is read-only;
  - back to **Default agent**, the next reply was still pirate-flavoured ("Ahoy, hello…"): the conversation so far keeps shaping replies. In an adapter-level run without that history the default agent answered normally. Deselect itself works (the runtime sent `subagent.deselected`).
  - Findings fixed: agents loaded through `agentDirectories` are all reported as `source: user`, so the source is decided by the file's path (inside a session folder = repository); "all tools" is reported as `["*"]` and is shown as all tools.
- `[KNOWN GAP]` Not run: an agent with its own MCP servers or tools list on a real session, switching during a running turn on a real session (simulator only), company-level agents, macOS and Windows.

### 2026-10-19: the agent in the New session dialog (Phase 2, T010a)

- **FR-007** `[IMPLEMENTED]` The New session dialog has an **Agent** select (Default agent and this folder's custom agents, the same list as the chip) when the kind can use custom agents and the chosen kind is the folder agent's own. The chosen agent is selected right after the new session starts, through the same path as the chip, so a repository agent still asks once. `sim:` driver at both sizes.
- Research for the Claude half (T011, not built): with Durbar's flags (`--setting-sources ""`) Claude does not load the folder's `.claude/agents`, which is the safe default. A Claude version would pass explicit `--agents` JSON from the files (after the same confirmation) and `--agent <name>` at launch (a relaunch with `--resume`, like a mode change).

### 2026-10-19: custom agents for Claude Code (Phase 2, T011 Claude half)

- **FR-008** `[IMPLEMENTED]` `ClaudeAdapter.listAgentProfiles` reads Claude's agent files itself (Durbar's flags keep Claude from loading them): `<each session folder>/.claude/agents/*.md` (source `repo`, so main asks once per file content, FR-003) and `<CLAUDE_CONFIG_DIR or ~/.claude>/agents/*.md` (source `user`). At most 50 files of 64 KB each; front matter `name` (default: the file name), `description`, `tools` (a comma list or a YAML list), `model`; the rest is the agent's prompt (at most 16 KB). Names must match `[A-Za-z0-9._-]{1,64}`; other files are skipped. `selectAgentProfile` records the agent the session **starts** with: its first launch gets `--agents <JSON of that one agent>` and `--agent <name>` (argv, no shell). **Claude fixes the agent when a session is created: `--agent` is ignored with `--resume`** (real, 2026-10-19: a resumed session with `--agent pirate` answered normally; a new one answered "Arr…"). So for Claude the agent is chosen in the New session dialog or on an agent that has not sent its first message; a started session refuses with "Claude Code sets the agent when a session starts. Start a new session with this agent (+ New session)." `test:` parsing and the launch flags on the fake CLI. `real:` 2026-10-19, `claude -p --agents … --agent pirate` with `haiku` answered "Arr, hello matey…" ($0.0024); through the adapter: a new session started with the pirate agent answered as the pirate (checked in the PR).


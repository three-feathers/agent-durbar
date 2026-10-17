# Feature Specification: Places in the office (agents walk to the systems they use)

**Feature Branch**: `024-office-places` (amends 001 office view, 017 room doors; uses 019/020 MCP data)
**Created**: 2026-10-17
**Status**: Specified (clarified with Ruben 2026-10-17), not implemented. Issue #18.
**Input**: Ruben (issue #18): named places for the systems agents use (a library for docs/Confluence, a software library for GitHub, a terminal, the web); an agent visibly walks to the place it is using right now; users can map MCP servers to places.

## Clarifications (Ruben, 2026-10-17)

- **Q: How does an agent "go" to a place?** It **really walks**: a small figure leaves its desk (the desk shows an empty chair), walks to the place, stays while the tool runs, and walks back.
- **Q: Where are the places?** In **one shared lobby for the whole office**, in the middle of the office (not one corner per room).
- **Q: Walking path?** **Direct path** with a walking animation (about 1 s), drawn above the rooms; no pathfinding around desks.
- **Q: How much can be customized?** **Fixed places + mapping**: built-in places, and in Settings the user chooses which MCP server goes to which place. Creating new places (own name/icon) is a separate, later issue.
- **Q: Where is the mapping stored?** **Globally, per user** (app settings), like the Copilot CLI MCP list. Not per folder.
- Decided by default and recorded here (open to change in review):
  - **Lobby shape:** a full-width band inserted **between the first half and the second half of the open rooms** (so it is in the middle at every density and window size; with one open room it sits below it). Closed rooms (door plates, spec 017) stay where they are.
  - **Only main agents walk.** Helpers (sub-agents) stay on their mini-desks; their tool calls do not move the parent.
  - **Local file tools stay at the desk** (read, edit, search, list in the folder): no walk.
  - **Calm rules:** a walk starts only if the tool is still running after **600 ms**; once at a place the agent stays at least **2 s**; at most **3 walk animations at the same time** (more agents appear at the place without the animation); `prefers-reduced-motion` shows the agent at the place without any animation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See where each agent is working (Priority: P1)

As someone running many agents, I see at a glance which agents are in the GitHub software library, the docs library, the terminal or on the web, so I know what kind of work is happening without opening each chat.

**Independent Test**: on the simulator (`DURBAR_SIM=15`, which emits `bash`, `github` and `playwright` tool calls; T010 gives them a realistic duration), agents leave their desks, walk to the matching place in the lobby, and come back when the call completes.

**Acceptance Scenarios**:

1. **Given** an agent starts a `bash` call that runs longer than 600 ms, **When** I look at the office, **Then** its desk shows an empty chair, a small figure walks to **Terminal** in the lobby and stands there with its name; when the call completes (and at least 2 s passed) it walks back and the desk shows it again.
2. **Given** an agent calls a tool of the MCP server `github`, **Then** it goes to **Software library**.
3. **Given** a `read_file` or `edit_file` call, **Then** the agent stays at its desk.
4. **Given** a call that completes in 200 ms, **Then** nobody walks (no flicker).
5. **Given** five agents use GitHub at once, **Then** the Software library shows them side by side (the rest as `+N` when they do not fit) and the lobby does not grow or overlap rooms.
6. **Given** `prefers-reduced-motion`, **Then** the agent appears at the place and back at its desk without animation.
7. **Given** a screen reader, **Then** each agent card still says what it is doing in text (for example "at Software library: github search_issues") and each place has a label listing who is there.

### User Story 2 - Send an MCP server to the right place (Priority: P2)

In Settings I see the MCP servers I use (the Copilot CLI list, my per-folder extras and servers seen in this run) and choose the place for each: Library, Software library, Terminal, Web, Other tools, or "Stay at desk".

**Acceptance Scenarios**:

1. **Given** the server `my-notes` defaults to Other tools, **When** I set it to Library, **Then** the next call of that server walks to Library, and the choice is still there after a restart.
2. **Given** I set a server to "Stay at desk", **Then** its calls no longer move the agent.
3. **Given** a server I never mapped, **Then** the built-in rules decide (below), and Settings shows that it uses the default.

### Edge Cases

- A tool call never completes (session stopped, ended, error): the agent walks back on stop/end/error/idle, never stays in the lobby forever.
- Two calls overlap for one agent (a second tool starts while at a place): the agent goes to the place of the newest call; one figure per agent, never two.
- The layout changes while an agent is in the lobby (window resize, a room is closed or opened, an agent is added): the figure is placed again at its place, without a long re-walk.
- A room is closed (door plate) while one of its agents is in the lobby: the agent stays at the place until the call ends, then simply disappears into the plate (no walk to a plate).
- Status filter or folder filter hides an agent: its figure is hidden in the lobby too.
- Demo mode (sample data): places and walking are off (the demo has no tool events).
- Unknown or weird tool/server names (empty, very long, unicode): classified by the rules below or Other tools; names are escaped and truncated in labels.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** `[KNOWN GAP]` (planned: T002) **Built-in places**, fixed set and order: `library` (Library, docs), `software` (Software library, code hosting), `terminal` (Terminal), `web` (Web), `other` (Other tools). Each has a name and a small icon drawn in the office style.
- **FR-002** `[KNOWN GAP]` (planned: T002) **Default classification** of a normalized `toolCall` (pure function, agent-neutral): built-in shell tools (`bash`, `shell`, `powershell`, `run`, names matching shell/exec/terminal) → `terminal`; web tools (`web_fetch`, `fetch`, `url`, names matching fetch/http/browse) → `web`; local file tools (read/view/edit/write/create/patch/grep/glob/search/list without an MCP server) → **desk** (no place); MCP servers: names matching `github`, `gitlab`, `bitbucket` → `software`; `atlassian`, `confluence`, `jira`, `notion`, `docs`, `wiki`, `notes`, `drive` → `library`; `playwright`, `browser`, `puppeteer`, `fetch` → `web`; any other MCP server → `other`. A user mapping (FR-007) overrides the default for that server.
- **FR-003** `[KNOWN GAP]` (planned: T003) **Visit state per main agent** (pure, injectable clock): `toolCall` start → pending visit; after 600 ms still running → at place; `complete`/`failed` of that call → leave once at least 2 s were spent; stop/end/error/idle → leave now. Newest call wins. Helper events (with `agentId`) are ignored.
- **FR-004** `[KNOWN GAP]` (planned: T004) **Lobby**: a full-width band in the office between the first and second half of the open rooms (one open room: below it), height fixed per density so the layout search (`chooseLayout`) accounts for it; shows the five places side by side with their names, and the agents currently there (small figure + name, `+N` beyond what fits). Shown only when at least one live agent exists and not in Demo mode. Places with nobody stay visible but quiet.
- **FR-005** `[KNOWN GAP]` (planned: T005) **Walking**: when a visit starts, the agent's desk scene shows an empty chair and an overlay figure walks on a straight line from the desk to its spot at the place in about 1 s (walking animation, CSS only, no blur filters), stands there, and walks back the same way when the visit ends. At most 3 walks animate at once; others appear without animation. `prefers-reduced-motion`: no animation. Figure positions are recomputed after every render, so resizes and layout changes do not leave figures in the wrong place.
- **FR-006** `[KNOWN GAP]` (planned: T005) **Text stays**: the card's activity text and tooltip say `at <Place>: <tool>` while visiting; the overlay figures are `aria-hidden`; each place has an accessible label "Software library: Ada, Kenji".
- **FR-007** `[KNOWN GAP]` (planned: T006) **Mapping storage**: `placeMap` (`{ [serverName]: placeId | 'desk' }`) in the existing app settings file (`durbar-settings.json`, spec 011), validated in the main process (known place ids only, server names trimmed and capped at 200 characters, at most 500 entries); IPC `settings:get` returns it, `settings:setPlace(server, place|null)` sets or clears one entry. Global per user; no per-folder override.
- **FR-008** `[KNOWN GAP]` (planned: T007) **Settings screen**: a "Places" section lists MCP servers (Copilot CLI list, per-folder extras, servers seen in this run), each with a place picker (Library, Software library, Terminal, Web, Other tools, Stay at desk) and "default" shown when unmapped; changes apply to the next tool call.
- **FR-009** `[KNOWN GAP]` (planned: T008) **Calm UI** (constitution V): text at least 10.5px; with 15 simulated agents at 1440x900 and 1280x800 the lobby fits without overlapping rooms or scrolling the office (`npm run check:office` stays green, extended with lobby checks); no new strong colors.
- **FR-010** `[KNOWN GAP]` (planned: T002, T003, T006, T009) **Tests, no credits**: classification, visit state machine (debounce, dwell, newest wins, leave on stop), lobby occupancy (`+N`), settings parsing; simulator screenshots with agents in the lobby and walking.
- **FR-011** `[KNOWN GAP]` (planned: T006 validation) Privacy: nothing leaves the machine; the mapping stores server names and place ids only.

### Key Entities

- **Place**: id (`library|software|terminal|web|other`), name, icon.
- **PlaceMap**: server name → place id or `desk`, global per user.
- **Visit**: agent id, place id, tool label, started at, phase (`pending|at|leaving`).

## Success Criteria *(mandatory)*

- **SC-001**: On the simulator, every main agent with a running `bash`, `github` or `playwright` call longer than 600 ms is shown at Terminal, Software library or Web respectively, and back at its desk after the call (checked by a driver, no credits).
- **SC-002**: `npm run check:office` passes at 1440x900 and 1280x800 with the lobby present and agents in it.
- **SC-003**: A mapping set in Settings survives a restart and changes where the next call goes.

## Assumptions

- Tool events already carry `tool`, `mcpServer` and `mcpTool` (spec 002, 019); no adapter change is needed.
- "Walking" is a direct glide with a walking animation, not pathfinding (Ruben's choice).
- The lobby takes height; with 15 agents the office may pick a more compact density earlier. Acceptable as long as SC-002 holds.
- Out of scope: custom places with own name/icon, per-folder mapping, sounds, helpers walking, real-session verification.

# Feature Specification: Places in the office (agents walk to the systems they use)

**Feature Branch**: `024-office-places` (amends 001 office view, 017 room doors; uses 019/020 MCP data)
**Created**: 2026-10-17
**Status**: Built 2026-10-17 (issue #18): clarified with Ruben, implemented and verified on the simulator and with unit tests (`test:places`, `test:credits`, `check:office` 105/105, `scripts/shots-024.js`). CI (PR #109): unit tests pass on Linux, macOS and Windows, `check:office` with the lobby checks passes on Linux (xvfb). Not checked on a real Copilot session; the Windows layout was not looked at.
**Input**: Ruben (issue #18): named places for the systems agents use (a library for docs/Confluence, a software library for GitHub, a terminal, the web); an agent visibly walks to the place it is using right now; users can map MCP servers to places.

## Clarifications (Ruben, 2026-10-17)

- **Q: How does an agent "go" to a place?** It **really walks**: a small figure leaves its desk (the desk shows an empty chair), walks to the place, stays while the tool runs, and walks back.
- **Q: Where are the places?** In **one shared lobby for the whole office**, in the middle of the office (not one corner per room).
- **Q: Walking path?** **Direct path** with a walking animation (about 1 s), drawn above the rooms; no pathfinding around desks.
- **Q: How much can be customized?** **Fixed places + mapping**: built-in places, and in Settings the user chooses which MCP server goes to which place. Creating new places (own name/icon) is a separate, later issue.
- **Q: Where is the mapping stored?** **Globally, per user** (app settings), like the Copilot CLI MCP list. Not per folder.
- Decided by default and recorded here (open to change in review):
  - **Lobby shape (confirmed by Ruben 2026-10-17):** a full-width band inserted **between the first half and the second half of the open rooms** (so it is in the middle at every density and window size; with one open room it sits below it). Closed rooms (door plates, spec 017) stay where they are.
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

1. **Given** the server `acme-tools` defaults to Other tools, **When** I set it to Library, **Then** the next call of that server walks to Library, and the choice is still there after a restart. (Servers whose name matches a default rule, such as `my-notes` → Library, can be re-mapped the same way.)
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

- **FR-001** `[IMPLEMENTED]` (test: places) **Built-in places**, fixed set and order: `library` (Library, docs), `software` (Software library, code hosting), `terminal` (Terminal), `web` (Web), `other` (Other tools). Each has a name and a small icon drawn in the office style.
- **FR-002** `[IMPLEMENTED]` (test: places) **Default classification** of a normalized `toolCall` (pure function, agent-neutral): built-in shell tools (`bash`, `shell`, `powershell`, `run`, names matching shell/exec/terminal) → `terminal`; web tools (`web_fetch`, `fetch`, `url`, names matching fetch/http/browse) → `web`; local file tools (read/view/edit/write/create/patch/grep/glob/search/list without an MCP server) and **any other built-in tool** (for example `task`, `report_intent`, `ask_user`) → **desk** (no place); MCP servers: names matching `github`, `gitlab`, `bitbucket` → `software`; `atlassian`, `confluence`, `jira`, `notion`, `docs`, `wiki`, `notes`, `drive` → `library`; `playwright`, `browser`, `puppeteer`, `fetch` → `web`; any other MCP server → `other`. A user mapping (FR-007) overrides the default for that server.
- **FR-003** `[IMPLEMENTED]` (test: places) **Visit state per main agent** (pure, injectable clock): `toolCall` start → pending visit; after 600 ms still running → at place; `complete`/`failed` of that call → leave once at least 2 s were spent; status `idle`, `error` or `stopped` → leave now; any other status (`working`, `needs-permission`, ...) keeps the visit, so an agent waiting for approval of its shell command stays at the Terminal (found in review 2026-10-17, test: places). Newest call wins. Helper events (with `agentId`) are ignored.
- **FR-004** `[IMPLEMENTED]` (sim:; check:office) **Lobby**: a full-width band in the office between the first and second half of the open rooms (one open room: below it), height fixed per density so the layout search (`chooseLayout`) accounts for it; shows the five places side by side in a **single row (36px high)**: icon, name and a row of slots; the agents currently there stand on the slots as small figures (`+N` beyond what fits) and are named in the tile's tooltip and accessible label. *(Deviation found while implementing: the first design, a 58px tile with a names line, moved 15 agents from `card` to `mini` density at 1440x900; the 36px row keeps `card` there. Names are no longer printed in the tile.)* Shown only when at least one live agent exists and not in Demo mode. Places with nobody stay visible but quiet.
- **FR-005** `[IMPLEMENTED]` (sim:; check:office; walk observed 24 s live) **Walking**: when a visit starts, the agent's desk scene shows an empty chair and an overlay figure walks on a straight line from the desk to its spot at the place in about 1 s (walking animation, CSS only, no blur filters), stands there, and walks back the same way when the visit ends. At most 3 walks animate at once; others appear without animation. `prefers-reduced-motion`: no animation. Figure positions are recomputed after every render, so resizes and layout changes do not leave figures in the wrong place.
- **FR-006** `[IMPLEMENTED]` (sim:; check:office) **Text stays**: the card's activity text and tooltip say `at <Place>: <tool>` while visiting; the overlay figures are `aria-hidden`; each place has an accessible label "Software library: Ada, Kenji".
- **FR-007** `[IMPLEMENTED]` (test: credits, places) **Mapping storage**: `placeMap` (`{ [serverName]: placeId | 'desk' }`) in the existing app settings file (`durbar-settings.json`, spec 011), validated in the main process (known place ids only, server names trimmed and capped at 200 characters, at most 500 entries); IPC `settings:get` returns it, `settings:setPlace(server, place|null)` sets or clears one entry. Global per user; no per-folder override.
- **FR-008** `[IMPLEMENTED]` (sim:) **Settings screen**: a "Places in the office" section lists MCP servers (the Copilot CLI list, the names of every saved folder's extras (FR-015/FR-016, delta 2026-10-18 #116), every server seen in tool events during this run, and any already mapped), each with a place picker (Library, Software library, Terminal, Web, Other tools, Stay at desk) and "default" shown when unmapped; changes apply to the next tool call.
  - ~~`[KNOWN GAP]`~~ resolved 2026-10-18 (task T011, issue #116): per-folder MCP extras used to be listed only after an agent has used them in this run: extras are stored per folder and there is no app-wide list to read them from without opening each folder. → specified 2026-10-18 (issue #116): the main process lists the names of every saved folder's extras, see `## Changes` 2026-10-18 (second entry), FR-015..FR-017; built in T016-T018 `[IMPLEMENTED]`.
- **FR-009** `[IMPLEMENTED]` (check:office 105/105) **Calm UI** (constitution V): text at least 10.5px; with 15 simulated agents at 1440x900 and 1280x800 the lobby fits without overlapping rooms or scrolling the office (`npm run check:office` stays green, extended with lobby checks); no new strong colors.
- **FR-010** `[IMPLEMENTED]` (test: places, credits; sim: shots-024.js, screenshots) **Tests, no credits**: classification, visit state machine (debounce, dwell, newest wins, leave on stop), lobby occupancy (`+N`), settings parsing; simulator screenshots with agents in the lobby and walking.
- **FR-011** `[IMPLEMENTED]` (test: places, credits) Privacy: nothing leaves the machine; the mapping stores server names and place ids only.

### Key Entities

- **Place**: id (`library|software|terminal|web|other`), name, icon.
- **PlaceMap**: server name → place id or `desk`, global per user.
- **Visit**: agent id, place id, tool label, started at, phase (`pending|at|leaving`).

## Success Criteria *(mandatory)*

- **SC-001** (sim: `scripts/shots-024.js` at 1440x900 and 1280x800): On the simulator, every main agent with a running `bash`, `github` or `playwright` call longer than 600 ms is shown at Terminal, Software library or Web respectively, and back at its desk after the call (checked by a driver, no credits).
- **SC-002** (`check:office` 105/105): `npm run check:office` passes at 1440x900 and 1280x800 with the lobby present and agents in it.
- **SC-003** (sim: `scripts/shots-024.js` for "changes where the next call goes"; test: credits for "survives a restart", because the simulator keeps settings in memory): A mapping set in Settings survives a restart and changes where the next call goes.

## Assumptions

- Tool events already carry `tool`, `mcpServer` and `mcpTool` (spec 002, 019); no adapter change is needed.
- "Walking" is a direct glide with a walking animation, not pathfinding (Ruben's choice).
- The lobby takes height. Measured on the simulator with 15 agents (2026-10-17): without it `card` density at both sizes (82px desks, helper rows 3 / 1); with it `card` at 1440x900 (helper rows 3 → 1) and `mini` at 1280x800 (desks 82px → 64px). SC-002 holds. Accepted as the price of the lobby.
- Out of scope: custom places with own name/icon, per-folder mapping, sounds, helpers walking, real-session verification.

## Verification on a real session (2026-10-17)

Asked for by Ruben. Real Copilot runtime (Copilot CLI 1.0.95, SDK 1.0.22, model `auto`), the app in *Ask first* on an empty test folder, **3 prompts, 0.8385 AIU in total** (first run: 2 prompts, 0.4364 AIU; second run: 1 prompt, 0.4021 AIU). Recorded with `DURBAR_LOG`; the log stays local (it lists the user's own MCP servers).

- `real:` A shell request arrives as `toolCall` `tool: 'bash'` with no MCP server, so FR-002 sends it to **Terminal**.
- `real:` The runtime sends the tool **start before the permission request** (start at 37.88 s, `needs-permission` at 37.93 s). So an agent waiting for approval is at its place: this is why FR-003 keeps the visit on `needs-permission` (without that review fix it would have gone back at once).
- `real:` A denied request ends as `toolCall` `failed` (0.9 s after the start, so past the 600 ms debounce): the agent stays its 2 s at the Terminal and walks back; the card says `At Terminal: bash · Denied: run ls`. Accepted as honest ("it went and was refused"). (The checking driver denied `ls` by mistake: its text match failed, so nothing ran.)
- First run, second prompt: asked for GitHub issues, but the session's GitHub server offered only code and user search, and the agent called no tool.
- `real:` A walk to an **MCP** place (second run, Ruben's go-ahead for one more prompt): a GitHub code search arrived as `toolCall` `tool: 'github-mcp-server-search_code'`, `mcpServer: 'github-mcp-server'`, `mcpTool: 'search_code'` (not `github`, the name in the server list). The default rules sent it to **Software library**; the card said `At Software library: github-mcp-server search_code`; the read-only tool ran without a permission request; the call lasted 1.25 s, so the agent walked there, stayed its 2 s and walked back.
- Resolved 2026-10-18 (task T012, issue #117): the server list names the built-in GitHub server `github`, but its tool events carry `mcpServer: 'github-mcp-server'`, so a mapping on the `github` row did not apply to those calls. The two names now count as one server; see `## Changes` 2026-10-18, FR-012..FR-014.

## Changes

- **2026-10-17, spec 033 (floors), cross-reference.** One lobby for all floors that are on; agents of a floor that is off are not listed at a place and have no figure (the same filter as a hidden room in `placeVisitors`). Switching a floor off while one of its agents is at a place removes the figure at once, without a walk back (`check:office` floors cases, `scripts/shots-033.js`).

- **2026-10-18, one GitHub server in Settings > Places (task T012, issue #117).**
  - **Problem** (`real:` in the PR #109 check): Copilot's built-in GitHub server sends its tool events as `mcpServer: 'github-mcp-server'`. Users often also have their own server called `github` in `~/.copilot/mcp-config.json` (Ruben does). Settings showed two rows, and a place chosen on the `github` row did not apply to the calls, because the map is keyed by the event's server name.
  - **Clarification (Ruben, 2026-10-18): one server.** `github` and `github-mcp-server` count as the same server for places. A place chosen on either name applies to calls from both, and Settings shows one row, `github`, with a note that it also covers `github-mcp-server`. Someone who wants different places for the two cannot have them; both are GitHub, so this is accepted.
  - Decided by default and recorded here (open to change in review):
    - The aliases are a small fixed table (`github-mcp-server` → `github`), exact names, in the renderer's `places.js`. No user-defined aliases (that belongs to custom places, #115).
    - The map is saved under the canonical name (`github`). A place saved earlier under `github-mcp-server` keeps working, and the next change on the row moves it to `github`.
    - Lookup when a call arrives: an entry under the call's own name wins over one under its canonical name (only possible with an old saved map), then the default rules (unchanged: both go to Software library).
  - **FR-012** `[IMPLEMENTED]` test: `test:places` (T013) `canonicalServer(name)` and the alias table in `src/renderer/places.js`; `classify()` reads the user map under the call's own name, then under its canonical name; unit tests in `scripts/test-places.ts` (both names, either key, the old key winning, names that only look alike, `__proto__`).
  - **FR-013** `[IMPLEMENTED]` test: `test:places` (T014) Settings > Places lists canonical names once; the `github` row carries the note "also github-mcp-server" when that name is seen or listed. Saving writes the canonical key and clears an old alias key. Pure helpers `placeRows`/`placeSaves` in `src/renderer/places.js`, used by `screens.js`; the note is 11.5px muted (`screens.css`). If clearing the alias key fails after the canonical save, the renderer still takes the saved map.
    - Row value with an old map that holds both keys (decided in review 2026-10-18): the row shows the `github-mcp-server` value, the one `classify()` uses for the built-in server's calls (the call's own name wins); an invalid value falls back to the other key. Until the row is saved again, a call named `github` (the user's own server) still uses the `github` entry, which the row does not show. Saving the row writes one value for both (test: `test:places`).
  - **FR-014** `[IMPLEMENTED]` (sim: `scripts/shots-024.js`, `check:office` 141/141; T015) Simulator and checks: the simulator already lists both names; `scripts/shots-024.js` sets a place on the `github` row and checks that a `github-mcp-server` call goes there, and that there is one row. Docs: README places text, CHANGELOG, specs index. No layout change (`check:office` stays green). The driver now scrolls only the Settings body to the Places card before its screenshot (Settings has grown since 024), and `docs/screenshots/024-settings-places-1280x800.png` shows the single row.
  - Not in scope: other servers whose list name differs from their event name (none known); real-session verification (the event name is already `real:` evidence from PR #109).

- **2026-10-18, per-folder MCP extras in Settings > Places before they are used (task T011, issue #116).**
  - **Problem** (FR-008 known gap): the Places list is built in the renderer from the Copilot CLI list, the servers seen in tool events of this run and the names already mapped. A folder's extras (spec 020: servers added in a room's *MCP extras*, typed or imported from `.vscode/mcp.json`, switched on only after the trust prompt) appear only after an agent of that folder has called one. So a user cannot choose the place of a new extra before its first call, and after a restart the row is gone again until the next call.
  - **Finding** (`read:` `src/main/mcpstore.ts`): the extras of every folder are already in one file in userData (`folders[<key>]`), loaded by `McpStore` at start. The gap is only that nothing reads names across folders: `mcp:folderState` takes a key and accepts it only when an agent of that folder is in the office (`src/main/mcpipc.ts` `knownKey`). No folder needs to be opened and no folder file read.
  - Decided by default and recorded here (open to change in review):
    - **Names only.** The new read returns server names and nothing else: no command, args, URL, env or header keys, working directory, folder key, folder name or trust state. Names are what `placeMap` already stores (FR-007, FR-011).
    - **Every saved extra, in any state.** On or off, trusted or not yet trusted, secrets missing: all are listed. Listing a name and choosing its place does not switch the server on, trust it or pass it to a session (spec 020 FR-012 and the trust prompt of 019 FR-005 are unchanged); it only says where its calls will walk if they ever come. Spec 020's "no app-level list of extras" is about servers that are configured or applied app-wide; a names-only read for the place picker is neither.
    - **Not the old app-level servers** (spec 020 "Old app-level servers (not applied)"): they are never passed to a session. One that is moved into a folder becomes a folder extra and is listed from then on.
    - **Not `.vscode/mcp.json` itself.** Only servers saved as extras are listed; servers in a folder's VS Code file that were never imported are not (that would mean reading files in folders, and those servers do not run).
    - **A separate IPC, `mcp:extraNames`** (no arguments), not a new field of `mcp:state`: `McpState` stays "the global list" (its comment in `src/shared/api.ts` keeps saying there is no app-level list of extras), and a renderer without the call (an older simulator bridge) keeps today's list.
  - **FR-015** `[IMPLEMENTED]` (T016; test: `test:mcp` section 10) `McpStore.extraNames(reserved)` in `src/main/mcpstore.ts`: the names of the extras of every saved folder, each name once (exact match: `placeMap` and tool events are keyed by the exact name), sorted in plain code-unit order (the same on every platform; the visible rows are still sorted by `placeRows`), at most 500 (the `placeMap` cap). A name that matches a `reserved` name (the Copilot CLI list and the built-in servers) ignoring case is left out: the CLI row already covers it, and `forSession` never passes such an extra. Legacy servers are not included. Reads memory only (no file system access per call), so folder keys and path styles (`C:\...`, `/home/...`, `.code-workspace` files) play no part and Windows, macOS and Linux behave the same. Unit tests in `scripts/test-mcp.ts`.
  - **FR-016** `[IMPLEMENTED]` (T017; test: `test:places` `mergePlaceNames`; sim: `shots-024.js`) IPC `mcp:extraNames` in `src/main/mcpipc.ts` returns `{ ok: true, names }` with `reserved` = the current CLI names (`cliNames()`), preload `mcpExtraNames()`, type in `src/shared/api.ts` (agent-neutral, names only), and a simulator bridge in `src/renderer/sim.ts` built from its fake extras (so `docs-search`, a fake extra that is off, untrusted and never called, gets a row). Settings > Places (`src/renderer/screens.js`) adds these names to the list before `placeRows`, so `canonicalServer` and the one-row rule of FR-013 apply to them too. If the call is missing, fails or returns something that is not a list of strings, Settings shows today's list and no error. The list is read every time Settings opens, like the CLI list.
  - **FR-017** `[IMPLEMENTED]` (T018; sim: `shots-024.js` at 1440x900 and 1280x800, `check:office`) Checks and docs: `scripts/shots-024.js` opens Settings with no call from `docs-search` and checks that its row is there with the default place, and that `playwright` (a fake extra that is also seen in events) has one row; `check:office` stays green (no office change). Docs: README places text (drop "per-folder extras appear once an agent has used them"), CHANGELOG *Unreleased*, specs index row, the comment above the Places section in `screens.js`, and FR-008's known gap marked resolved. The Settings screenshot is retaken only if the visible rows change.
  - **Acceptance scenarios**
    1. **Given** a folder with an extra `docs-search` that is off and not trusted, and no agent has called it, **When** the user opens Settings, **Then** Places lists `docs-search` with "Default (Library)" (the built-in name rules send `docs*` servers to the Library), and choosing a place saves it like any other row (FR-007) without switching the server on or trusting it.
    2. **Given** two folders that both have an extra `notes`, **When** Settings opens, **Then** there is one `notes` row.
    3. **Given** an extra with the same name as a Copilot CLI server (any case, for example `GitHub` next to the CLI's `github`), **When** Settings opens, **Then** only the CLI row is shown.
    4. **Given** an extra `notes` that is also seen in this run's tool events and already mapped, **When** Settings opens, **Then** there is one `notes` row with the saved place.
    5. **Given** the user removes the last folder extra called `notes` and nothing else lists it, **When** Settings opens again, **Then** the row is gone unless `notes` is mapped (a mapped name stays, as today) or was seen in this run.
    6. **Given** the app restarts, **When** Settings opens before any agent has made a call, **Then** the saved extras are listed again.
  - **Edge cases**
    - No folders with extras (or no extras file yet): `names` is empty; the list is what it is today.
    - The extras file is missing, too big or not valid JSON: `McpStore.load` already starts empty, so no extras are listed and Settings still works. A single invalid entry is dropped by the store (`parseRec`), the others are listed.
    - A saved folder that no longer exists on disk (moved or deleted): its extras are still listed. The store keeps them until the user removes them and the read never touches the disk; a place for a name that never calls does nothing.
    - The same name in several folders, or with different case in two folders (`Notes`, `notes`): exact names are listed once each, so `Notes` and `notes` are two rows, because their tool events carry different names (inside one folder the store already refuses names that differ only in case).
    - `__proto__`, `constructor` and similar: an extra name must match `NAME_RE` (`src/shared/mcp.ts`, first character a letter or digit), so `__proto__` can never be stored or listed; a hand-edited file entry with it is dropped by `parseRec`. `constructor` is a valid name: it is listed as a normal row with its default place (`placeRows` uses a `Map` and own-property reads).
    - An extra named `github-mcp-server`: it matches a built-in name, so it is left out (scenario 3). Every listed name still goes through `canonicalServer` in the renderer, so a future alias applies to extras too.
    - Many extras: at most 200 folders x 100 servers are stored; the list is capped at 500 names, sorted, so the first 500 alphabetically are shown.
  - Not in scope: per-folder places (FR-007 stays global); listing servers from `.vscode/mcp.json` that were not imported; showing which folder an extra belongs to; real-session verification (nothing here touches a session).

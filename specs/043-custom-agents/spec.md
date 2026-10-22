# Feature Specification: Custom agent per session

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 042
title: Custom agent per session (issue #127)
status: Phase 1 built: Agent chip and menu, repository-agent confirmation, Copilot `rpc.agent.*` (simulator, unit tests, real check 2026-10-19); Phase 2: the agent in the New session dialog built (FR-007); Claude agents built (FR-008); per-folder default built (FR-009); profile file editor built (FR-010..FR-017, simulator and unit tests); Codex not started
-->

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


### 2026-10-19: a default agent per folder (Phase 2, T010)

- **FR-009** `[IMPLEMENTED]` A folder can have a **default agent** for its new sessions. The New session dialog's Agent row gets a checkbox **Default for new sessions here**. When the dialog opens, that agent is preselected (if it is still in the list) and the box is ticked. Starting with the box ticked saves the chosen agent as the folder's default. Starting with it unticked clears a default that equals the chosen agent. The saved value is only the agent's id (`defaultAgent` in the folder list, the same id rule as `agents:selectProfile`), never file content. A repository agent still asks once per file content (FR-003), because the default only preselects the dialog and goes through the same selection path. Removing the folder forgets it. Not in scope: applying the default to a folder's restored first agent after a restart (that agent may resume an existing session, and Claude ignores `--agent` on resume, FR-008). `test:` parse and store (`test:folders`); `sim:` `scripts/shots-043-default.js` at 1440x900 and 1280x800 (preselect, tick, untick clears).

### 2026-10-21: view and edit profile files (Phase 2, T012; owner request, Telegram 2026-10-21)

**Owner's words:** "When we have custom agents (you call them profiles), I need the ability to view and edit those markdown files: preview and edit side by side, or only edit, or only preview, like code editors give, and save it."

**Existing capability reused:** the profile list and its folders (FR-002 `agentDirsFor`, FR-008 `listClaudeAgents`), the Profile menu (FR-004, `openAgentMenu`; its placement is not changed here), the chat's sanitised Markdown renderer (spec 016, `markdown.js`; no second renderer), `askDialog` (`dialog.js`) for the unsaved-changes and conflict questions, Settings sections (`screens.js`), `app:openExternal` for links and `openInVSCode` (`vscode.ts`) for *Open in VS Code*. There is no "Reveal in folder" action in the app, so none is added.

**User Story 4 - Read and change a profile's file (Priority: P1)**

From the Profile menu (an **Edit** button on each profile) or from **Settings > Profiles (custom agents)** (an **Open** button on each file), a large editor opens with the file. A three-way switch **Edit | Split | Preview** shows only the text, the text and its preview side by side, or only the preview, like a code editor. **Save** (or Ctrl+S, Cmd+S on a Mac) writes the file. **New profile…** in Settings creates one.

Acceptance scenarios:

1. **Given** a profile in the menu, **When** I press its Edit button, **Then** the editor opens with the file's text, its front matter as text at the top, and a preview that shows the front matter as a small key/value header and the rest as formatted Markdown. *(sim:)*
2. **Given** the editor, **When** I choose Edit, Split or Preview, **Then** only the text, both halves (each about half the width), or only the preview are shown, and the choice is remembered on this computer for the next file. *(sim:)*
3. **Given** I type, **Then** the title shows *Unsaved*, and the preview follows within a fraction of a second. **When** I press Ctrl+S, **Then** the file is written, *Unsaved* goes away, and the profile lists show the new name and description. *(sim:, test:)*
4. **Given** unsaved changes, **When** I close the editor (Close, Escape), **Then** it asks *Discard changes?* with **Keep editing** (focused) and **Discard**. *(sim:)*
5. **Given** the file was changed by something else since I opened it, **When** I save, **Then** nothing is written and it asks **Reload** (drop my changes), **Overwrite** or **Cancel**. *(test:)*
6. **Given** the front matter does not parse (an unclosed quote, a line without `key:`, no closing `---`), **Then** a line under the text names the line and the problem; saving still works, and says the agent app may skip the file. *(test:, sim:)*

**Requirements**

- **FR-010** *Which files.* The files the agent apps load as profiles, in the folders Durbar already uses for them: Copilot `<folder>/.github/agents/*.md` and `~/.copilot/agents/*.md` (FR-002); Claude Code `<folder>/.claude/agents/*.md` and `<CLAUDE_CONFIG_DIR or ~/.claude>/agents/*.md` (FR-008), for every folder that has an agent in the office (at most 50 folders, 50 files per folder). Codex has no profiles in Durbar (T011 Codex half), so no Codex files. Files are listed with their agent app, place (*this folder* + folder name, or *your user folder*), file name, the front matter `name` and `description` (text only), and whether they can be written.
- **FR-011** *Main owns the files (constitution III).* Every read and write runs in main through IPC in `src/main/ipc/profiles.ts` (`ipcHandle`; the writing channels also check `fromApp(e)`). The window sends only a profile file id from the list main gave it (an opaque hash of the path) or, for a new file, the agent app, the place (a folder id from main's own folder list, a hash of the folder's path, or *user*; changed 2026-10-22, see below) and a name; **never a path**. Main lists the allowed folders again on every call and resolves the id itself. A file is used only when the real path of its folder (symbolic links resolved) is one of those agent folders, the file's real path is directly inside it, and the file is not itself a symbolic link (a link is listed read-only: "a link: edit the file it points to"). Names match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; no `..`, no separators, no Windows device name (FR-023).
- **FR-012** *Limits and writing.* At most 256 KB per file for Copilot and **64 KB for Claude Code** (the Claude adapter's own cap, FR-021; amended 2026-10-22); bigger files are listed but cannot be opened here. The cap applies to the bytes written, after the line endings and BOM are put back (FR-022). A save writes a temporary file in the same folder and renames it over the original (atomic on the same disk); the file's line endings (CRLF or LF, by majority) and a UTF-8 BOM are kept. Before writing, main compares the SHA-256 of the file on disk with the one it handed out when the file was read: a difference (or a removed file) answers `conflict` and writes nothing, unless the user chose **Overwrite**. A file or folder that is not writable opens read-only (no Save, the text cannot be changed, a note says why). File contents are never logged.
- **FR-013** *New profile.* **New profile…** asks for the agent app (Copilot or Claude Code), the place (one of the office's folders, or your user folder) and a name; main creates the agent folder if needed (`.github/agents` or `.claude/agents` inside that folder, checked again after it is made), refuses a name that exists, and writes a short template with `name` and `description` front matter (Copilot files are `<name>.agent.md`, Claude Code files `<name>.md`). The editor then opens it.
- **FR-014** *The editor.* A large dialog over the office or Settings: title (front matter name or file name), agent app and place, the three-way switch **Edit | Split | Preview** (default Split; the last choice kept per computer in the window's local storage), a monospace text area with soft line wrap, the preview (spec 016 renderer: raw HTML shown as text, no images loaded, only `http(s)` links, opened in the system browser through `app:openExternal`; updated at most every 150 ms while typing), **Save** (Ctrl+S / Cmd+S; disabled while nothing changed or read-only), an *Unsaved* mark, **Open in VS Code** (the same launcher as the chat header), **Close**. Closing with unsaved changes asks first (FR-014 scenario 4); a conflict asks Reload / Overwrite / Cancel. Text 10.5px or larger, theme tokens only, fits at 1280x800 and 1440x900.
- **FR-015** *Front matter.* The text between the first `---` line and the next `---` line is checked as the simple YAML agent files use: `key: value`, quoted strings, `[a, b]` lists, `- item` lists and indented blocks under a key. An error names the line (unclosed quote or bracket, a line without `key:`, a tab used for indentation, a key given twice, no closing `---`). The preview shows the keys and values as a small header (lists joined with commas, nested blocks as text). Saving is never blocked by it; a save with an error says the agent app may skip the file.
- **FR-016** *After a save.* The Settings list and the Profile menu read the files again (the menu already lists them each time it opens). **A running session is not changed**: Claude Code reads the agent's file when a session starts with it (FR-008), and Copilot loads agent files when its session starts (FR-002); the editor says "Changes apply to sessions started after saving." A saved repository profile has new content, so it asks once again before it is used (FR-003): the confirmation is for a file's exact content.
- **FR-017** *Simulator.* The simulator has sample profile files (the three FR-005 profiles, one Claude Code profile, one read-only file and one with a front matter error), kept in memory, so the editor, saving and New profile work with no credits.

**Evidence (2026-10-21).** `[IMPLEMENTED]` FR-010..FR-017.
- `test:` `npm run test:profilefiles` (list, id-only resolve, a path or a crafted id refused, names with `..` or separators refused, a symbolic link out of an agent folder and a linked or dangling `.github`/`.claude` refused, the size cap, an atomic save round trip in a temp folder with CRLF and BOM kept and no temp file left, the conflict on an external change, overwrite, a removed file, create, read-only); mutation-checked (dropping the folder realpath check fails it). `npm run test:profileeditor` (front matter parser and its errors, throttle, remembered mode, and in a jsdom page: `<script>`, `onerror`, `javascript:` and `data:` links, images and raw HTML in the body and in front matter values neither run nor stay as markup; links go through `openExternal`; dirty, Ctrl+S with the base hash, the conflict question's Overwrite, the unsaved-changes guard); mutation-checked (preview without the renderer fails it).
- `sim:` `scripts/shots-043-editor.js` (in `check:ui`): Settings list, the three modes (Split halves within 3% of each other), typing → Unsaved and preview, Ctrl/Cmd+S and a reopened file, Keep editing / Discard, a front matter error, a read-only file, New profile, Edit from the Profile menu, no text under 10.5px and the dialog inside the window, at 1440x900 and 1280x800 in Clean Office and a dark user theme (`docs/screenshots/043-editor-*.png`, `043-profiles-settings-*.png`).
- `[KNOWN GAP]` Not run against real agent files on Windows or macOS (atomic rename, read-only detection and links there are from Node's documentation, `read:`); not run with a real agent app after a save (the "new sessions" rule is from FR-002/FR-008, `read:`); no quit guard for unsaved changes.

**Decisions taken with defaults (owner may change):** a large dialog rather than a side panel (works over Settings and the office alike); Split is the default mode; the 256 KB limit; a repository profile asks again after an edit (safe default, FR-003); no Reveal in folder (no such action in the app); Codex is not covered until Codex profiles exist (T011).

**Edge cases.** A file removed while open: Save reports a conflict; Overwrite writes it again. Two Durbar windows are not possible (one window). Leaving the app with unsaved changes in the editor does not ask (`[KNOWN GAP]`: no quit guard exists in the app). Copilot may re-read agent files during a session; not checked (`[KNOWN GAP]`), so the editor promises only new sessions.

### 2026-10-21: Agent Success Profiles and templates (owner decisions on PR #488)

**Owner's decisions (Vikram, team chat 2026-10-21 22:05 UTC):** (1) in the editor and its preview, call profiles **"Agent Success Profiles"**; file formats stay as they are; code identifiers keep "profile". (2) **New profile** offers templates: the default **Agent Success Profile**, modelled on an HR job success profile (Title; People responsibility; Reporting to; Behaviors; Key Success Criteria; Skills; Tools and accountability; Key responsibilities), written as valid agent Markdown for the chosen app; and, not default, **Standard agent** (Claude Code's subagent shape: name, description, tools, model, then the system prompt; Copilot's equivalent without a model id).

- **FR-018** `[IMPLEMENTED]` The New profile form has a **Template** choice, *Agent Success Profile* preselected, *Standard agent* second. Both templates live in one shared module (`src/shared/profiletemplates.ts`), used by main and the simulator. Front matter: `name`, `description`, read-only tools (`Read, Grep, Glob` for Claude Code, `[view, grep, glob]` for Copilot; a template never grants more), `model: inherit` for Claude Code only. The Agent Success Profile body is an `# Agent Success Profile: <name>` heading and the eight sections as `##` headings with one line of guidance each; the preview shows them through the same sanitised renderer with the front matter header (FR-014). Templates hold no paths and no secrets.
- **FR-019** `[IMPLEMENTED]` Words: Settings section *Agent Success Profiles (custom agents)*, the form *New Agent Success Profile*, the editor's subtitle starts with *Agent Success Profile*; the Profile chip and menu wording is owned by the composer-toolbar work and is not changed here. Simple and Expert use the same words (no Simple variant exists for these screens).
- `test:` both templates for both apps pass the editor's front matter check with no error, Claude Code's own discovery (`parseClaudeAgent`) accepts both Claude templates with the given name and tools, the Success template has all eight headings in order, and no template text contains a path, `~`, a URL or a token-like word. `sim:` the driver checks the default is preselected and takes a new Agent Success Profile in Split view at both sizes.

### 2026-10-22: New profile names its folder by id (review on PR #488)

- **FR-020** `[IMPLEMENTED]` (amends FR-011, FR-013) The New profile form's **Where** sends a **folder id** (a hash of the folder's path), not an index. `profiles:listFiles` returns the folders as `{ id, path }`, exactly the absolute folders `profileDirs` uses (a relative cwd is not offered); `profiles:create` lists the office's folders again and accepts the id only when it is one of them now. Before, the index was taken when the form opened and counted again at create time in a list that could have changed (a session added or ended while the form was open) and that `profileDirs` also filtered (non-absolute paths), so the file could be written into a different repository than the one shown. A folder that left the office meanwhile is refused ("That folder is not in the office any more") and nothing is written.
- `test:` `npm run test:profilefiles`: an index, a path and an unknown id are refused; a relative folder is not offered; the id still means the shown folder after the folder before it leaves the office and after one is added in front; a folder that left is refused with nothing written anywhere.
- `[KNOWN GAP]` (reviewer question on #488) Copilot folders list every `*.md`, so a `README.md` in `.github/agents` is listed as a profile. GitHub's docs name custom agent files `*.agent.md` (`docs/research.md`, `read:`), but whether the Copilot CLI also loads a plain `.md` from `agentDirectories` was not checked (it needs a real session, `real:` not run). Behaviour kept until that is checked: listing only `*.agent.md` could hide a file Copilot does load.

### 2026-10-22: review round 2 on PR #488 (Ruben's agent)

- **FR-021** `[IMPLEMENTED]` (amends FR-012) A Claude Code profile file is capped at the Claude adapter's `MAX_AGENT_BYTES` (64 KB, `src/adapters/claudeAgents.ts`; `profilefiles.ts` imports it, no second number). Before, the editor took Claude files up to 256 KB, but `listClaudeAgents` skips a file over 64 KB, so a file edited past 64 KB vanished from the Profile menu with no word. Now a bigger Claude file is listed with the note "Larger than 64 KB: Claude Code does not load it. Open it in an editor." and does not open here, and a save that would make it bigger is refused ("Claude Code does not load a bigger agent file"). Copilot files keep 256 KB.
- **FR-022** `[IMPLEMENTED]` (amends FR-012) The size cap is checked on the bytes that would be written, after CRLF and the BOM are put back; if they are over the cap nothing is written. Before, it was checked on the LF text, so a 240 KB LF text in a CRLF file was saved as about 360 KB and could not be opened again.
- **FR-023** `[IMPLEMENTED]` (amends FR-011, constitution VI) A new profile's name is refused when it is a Windows device name: `CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`, in any case, with or without an extension (`con.backup` too). On Windows `CON.md` is a device, so a repository profile with such a name made on Linux or macOS would break Windows checkouts. Main refuses it (`isProfileName`) and so does the form (`validName` in `profileeditor.js`, a copy that `test:profilefiles` keeps equal), with "That name is reserved on Windows".
- **FR-024** `[IMPLEMENTED]` (amends FR-013) The New profile hint shows the real user folder: `profiles:listFiles` also returns `userDirs` (`{ copilot, claude }`, from `profileDirs`), so with `CLAUDE_CONFIG_DIR` set the hint says `<CLAUDE_CONFIG_DIR>/agents/...` where main writes, not `~/.claude/agents`. The `~` form stays only for a main that sends no `userDirs`.
- **FR-025** `[IMPLEMENTED]` (spec 052 FR-167) The editor is the window minus 32px wide with `--dlg-pad` and `--dlg-gap`; the New profile form uses the M width (`.dlg.m`). `check:ui-text` has three new surfaces: `profile-menu` (the Profile menu with its Edit and New profile rows), `profile-editor` and `profile-new`.
- `test:` `npm run test:profilefiles`: a `.claude` linked to an existing outside folder with no `agents` is refused and `OUTSIDE/agents` is not created (the check before `mkdir`; it fails without it); a save renames a new file over the original (the inode changes, POSIX) and a failed rename leaves the original bytes and no temporary file (both fail with an in-place write); a CRLF file with a BOM near the cap is refused with nothing written, and one that fits once encoded saves and reopens; a 65 KB Claude file is listed with the warning, does not open, and the adapter skips it too, a 65 KB Copilot file is editable, a Claude save over 64 KB is refused and exactly 64 KB saves and stays in `listClaudeAgents`; the device names are refused with the reason, `console`/`com10` are allowed, and the form's rule answers like main's for every name; `profileDirs` and `userAgentDirs` with a custom config dir, `defaultProfileEnv` reads `CLAUDE_CONFIG_DIR`. `npm run test:profileeditor`: `validName`, `newDirHint` with `userDirs`, the form's hint in a jsdom page shows the folders main sent, and `CON` is refused in the form without asking main. `sim:` `check:ui-text` with the three surfaces, `shots-043-editor`.

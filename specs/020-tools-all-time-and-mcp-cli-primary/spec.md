# Feature Specification: Tools "This session / All time" and the Copilot CLI MCP list as the primary source

**Feature Branch**: `020-tools-all-time-and-mcp-cli-primary` (milestone 10)
**Created**: 2026-10-16
**Status**: Specified, then implemented (see tasks.md). Changes spec 019 (MCP settings, FR-001, FR-003, FR-006, FR-007) and adds to its Tools view (FR-012, FR-013).
**Input**: Vikram, two steering messages. (A) Tools view: toggle "This session" / "All time"; all-time counts are cumulative, kept on disk in the app's userData folder, survive restarts, are keyed by tool, MCP server and agent, and hold no secrets or arguments. (B) `~/.copilot/mcp-config.json` (the Copilot CLI list) is the primary MCP source: auto-loaded and shown in Settings and Tools with no separate configuration or import step; per-agent toggles stay; the app's own servers become optional extras, clearly labelled, and they exist **only per folder/workspace** (stored per folder, applied only to agents in it). There is no app-level global list of extras: the only global list is `~/.copilot/mcp-config.json`. Trust prompts for exact definitions stay.

## User scenarios

1. **I open Tools and see what happened this session, or ever.** A switch at the top: **This session** (as today: counts since the app started, per agent) and **All time** (cumulative since the first run, kept across restarts). The numbers are per tool and per MCP server, with "used by" per agent. A one-line note says since when All time counts and that it stores only tool names, server names, agent names and counts.
2. **My Copilot CLI servers just work.** I never configure anything in the app: the servers in `~/.copilot/mcp-config.json` (and the built-in GitHub server) are listed in Settings under "MCP servers" with their exact command or URL, and in Tools. The runtime loads them in every session. If I edit the file, the next time I open Settings or Tools it shows the new list. If the file is missing or malformed, the screen says so.
3. **Extras for one folder.** In a room's header (and from an agent's MCP dialog) I can open "MCP extras" for that folder: add a server that only agents in this folder get. It is clearly labelled "Extra, this folder only". Switching one on shows its exact command first (trust), and asks again if the definition changes. Another folder does not see it.
4. **Per-agent switches** work as before, over both lists.
5. **Servers I added in the old global list** (milestone 8) are not applied any more. They stay on disk, listed in a folder's extras dialog as "Old app-level servers (not applied)": **Move here** puts one into this folder (off, to be trusted again), **Remove** deletes it.

## Clarifications (2026-10-16)

- **Q: Is the CLI list trust-gated?** No. These servers are in the user's own Copilot CLI config, the runtime starts them in every session anyway, and the Settings screen shows the exact command or URL (never env or header values). A prompt that cannot stop the runtime would be theatre. The trust prompt with exact-definition hashing (spec 019 FR-005) applies to **extras**, which are the only servers Agent Durbar itself passes to a session. `[OPEN]` if Vikram wants a gate for the CLI list too, the only real way is to pass unconfirmed names in `disabledMcpServers`, which would make them not work until confirmed.
- **Q: What does the on/off switch of a CLI-list server do?** What it did for "ambient" servers: it lists the name in `disabledMcpServers` for **new** sessions started by this app. It never edits the CLI file.
- **Q: Same name in the CLI list and in a folder's extras?** Refused when saving the extra ("already defined in the Copilot CLI list"): a name must mean one server. If the CLI file later gains a clashing name, the extra is skipped for sessions and Settings says so.
- **Q: What is a folder/workspace key?** The saved-folder key of spec 006: the `.code-workspace` file when the agent was added from one, else the folder path. An agent gets the extras of its own key only.
- **Q: What is the agent key of an all-time count?** `"<agent name> · <folder name>"` (folder base name only, no path). Agent names are the persona names, so the same name in two folders is two entries; a counted agent can reappear after a restart with the same key. Counts of agents you no longer have stay (they are history); **Reset** clears them.
- **Q: VS Code `mcp.json` and "Import"?** The import screens are removed: the CLI list needs none, and a global import has no scope any more. A per-folder import from VS Code's file is a `[KNOWN GAP]` (backlog).
- **Q: Persisted when?** Counters are written at most every 2 s after a change and on quit; a crash loses at most that window.

## Requirements

### A. Tools: This session / All time
- **FR-001** The Tools view has a segmented control **This session | All time** (default This session). Keyboard accessible (`role=tablist` semantics like the existing tabs), `aria-selected`. The choice is remembered for the run.
- **FR-002** **This session**: unchanged (spec 019 FR-012/FR-013), including scope by agent and the *Models & context* tab.
- **FR-003** **All time**: rows grouped "Built-in" and "MCP: <server>", columns tool, calls, bar, "used by" (agent labels with counts); a failed count per tool; a summary line "N tool calls by M agents since <date> · K through MCP"; scope selector lists agent labels seen (or All agents). *Models & context* is a live view of the running agents and stays This session only (the tab is shown for This session only).
- **FR-004** Persistence: one file `durbar-tool-usage.json` in userData (`version`, `since` ISO date, `tools`, `servers`, `agents`). Written atomically, debounced (2 s), flushed on quit; tolerant load (missing, corrupt or oversized file = empty); sanitised on load (names are strings of at most 120 chars, counts are finite integers >= 0, at most 1000 tools, 200 agents, 400 tools per agent; extra keys dropped).
- **FR-005** Privacy: only tool names, MCP server names, agent labels and counts are stored. **Never** tool arguments, output, prompts, paths, env or header values. A test asserts that a recorded event with arguments and output stores none of them.
- **FR-006** Counting rule is the same as This session: a tool counts on `start`, `failed` is counted on top. Sub-agent calls count for the owning agent. Counted in the main process from the adapter events (so it also works while the window is closed or the Tools view never opened). The simulator keeps an in-memory all-time store seeded with plausible history so the view can be shown without credits.
- **FR-007** **Reset all-time counts** button with a confirmation; it empties the file and sets `since` to now.
- **FR-008** All-time view with nothing recorded says so ("Nothing counted yet. Counting starts with the first tool call.").

### B. MCP: the Copilot CLI list first, extras per folder
- **FR-009** Settings > "MCP servers" lists, first and without any setup step, the servers of `~/.copilot/mcp-config.json` plus the built-in `github-mcp-server`, each with source label ("Copilot CLI list" / "built-in"), transport, exact command and args or URL, and a switch for new sessions started here. Env and header values are never read into the renderer (key names only). The file is read again whenever Settings, Tools or an agent's MCP dialog opens; if it is missing or malformed the screen says so (and how many entries were skipped).
- **FR-010** The Tools view lists the same servers in a "Configured MCP servers" section (with call counts of the selected period, including 0), so unused servers are visible too.
- **FR-011** The app-level "Add server", "Import from Copilot CLI", "Import from VS Code" and the global custom server list are **removed** from Settings. Settings explains where extras live ("per folder: open a room's MCP extras").
- **FR-012** **Extras are per folder/workspace.** The store keeps `folders[<key>] = [server...]`. `forSession` for an agent returns only the extras of that agent's key (enabled and trusted, secrets available) as `mcpServers`, plus the usual `disabledMcpServers` (global switches of the CLI list + the agent's own off list). Extras of another folder are never passed. Secrets handling, validation and trust hashing are those of spec 019 (FR-002..FR-005).
- **FR-013** Extras UI: a **MCP** button in the room header (next to the new-session "+") opens "MCP extras: <folder name>" with the list, add/edit/remove, switch (trust dialog with the exact command), clearly labelled "Extra, this folder only" and the note "Agents in other folders do not get these servers. Servers from the Copilot CLI list are available to every agent and are not edited here." The agent's MCP dialog shows extras with the label "this folder" and has a button "Folder extras...".
- **FR-014** Name rules: an extra's name must not equal a CLI-list or built-in name (case-insensitive); unique within the folder.
- **FR-015** **Migration**: a milestone-8 file with a top-level `servers` list keeps them as `legacy` (secrets keep their encrypted blobs). They are not passed to any session. The extras dialog lists them with **Move here** (becomes an extra of this folder, switched off and untrusted) and **Remove**. Nothing is deleted automatically.
- **FR-016** Per-agent toggles (spec 019 FR-009) apply to both lists. `AgentMcpEntry.origin` is `cli` (CLI list or built-in), `folder` (extra) or `runtime` (reported by the runtime only).
- **FR-017** Removing a folder from the office does not delete its extras (they come back if the folder is added again) `[IMPLEMENTED]` as a consequence of keying by path; documented in the dialog text.

### Tests and screens
- **FR-018** Unit tests (no credits): all-time store (record rules, failed, sub-agent by owner, sanitising, caps, no arguments/output stored, persistence round trip with a temp file, corrupt file, reset, debounce flush), MCP store (folder scoping: extras of folder A are not in `forSession` of folder B; legacy migration and move; trust per folder; name clash with CLI names; secrets masked in views), mcpfiles (CLI list auto-load, missing, malformed), renderer helper for all-time rows.
- **FR-019** Simulator: CLI-list servers, extras for one room (not others), a legacy server, all-time history; Settings and Tools work with `DURBAR_SIM=15`. Screenshots at 1440x900 and 1280x800 (`docs/screenshots/m10-*.png`). `npm run check:office` must still pass after adding the room-header button.

## Out of scope / known gaps
- `[KNOWN GAP]` Per-folder import from VS Code's `mcp.json`.
- `[KNOWN GAP]` The CLI list is not trust-gated (see Clarifications); a changed definition in the CLI file is not flagged.
- `[KNOWN GAP]` All-time counts are not split by day; no export.
- `[KNOWN GAP]` The CLI file is read, never written; to edit it use the Copilot CLI or an editor.

# Feature Specification: Global MCP servers in every agent app, controls on every server, and its tools

**Feature Branch**: `069-mcp-global-controls`
**Created**: 2026-10-21
**Status**: Part 1 **built** 2026-10-21 (add to and remove from the agent apps' own lists with a per-file review and backups, source
chips, Claude Code's user list in Durbar's Claude sessions): unit tests (`test:mcpglobal`) and a simulator driver (`shots-069-mcp-global`),
and the real check T060 (2026-10-22, scratch home, 0 credits: Copilot CLI, Claude Code and Codex list the written entries; see *Changes*). Part 2 (harmonize) **built** 2026-10-21 the same way (`test:mcpglobal`,
`shots-069-harmonize`). Part 3 (tools list and per-row controls) is specified, not built (see *Delivery*). Owner questions Q1-Q6 answered 2026-10-22: the built defaults are kept.
**Input**: Owner (Vikram, Telegram 2026-10-21 21:03 UTC): "For the MCP server addition UI, give an option to also add to the list of
global MCP servers, and those controls to start/stop/restart/auth... we should have those options for all servers. Also show the list of
tools per MCP server when you expand it." Owner decision (Vikram, Telegram 2026-10-21 21:06 UTC): "global" is written to the agent apps'
own config files; "If there is more than one agent app, propose in the UI to harmonize and merge all; else ask the user to select the
agent app."

## Summary

Today Durbar has two kinds of MCP servers (specs 019, 020): the **Copilot CLI list** (`~/.copilot/mcp-config.json`, read-only, every
agent) and **folder extras** (Durbar's own, one folder only, with a trust prompt). Claude Code and Codex keep their own user-level lists
that Durbar does not show. There is no way to add a server "for all my folders" from Durbar, and no way to keep the three agent apps'
lists in step.

This feature:

1. **Add to: This folder / All my folders (global).** The add form gets a choice. *This folder* is today's folder extra. *All my folders*
   writes the server into the **user-level config of the chosen agent apps** (Copilot CLI, Claude Code, Codex), after a confirmation that
   shows each exact file and the exact entry, with a backup of each file first.
2. **Harmonize.** With more than one agent app, Settings lists servers that exist in some apps' global lists and not in others (and
   servers whose definitions differ), and proposes copying them to the others; the user picks per server, and the same confirmation
   applies.
3. **Sources.** Every server row says where it comes from: *Copilot*, *Claude Code*, *Codex* (one or more), *Durbar folder*, *built-in*
   or *runtime*.
4. **Controls on every row** of an agent's MCP dialog: Start / Stop (this session), Restart (spec 058 FR-012, where the app has it),
   Sign in (spec 058 FR-064, Paco's; shown once his capability lands), Remove (global and folder entries only).
5. **Tools on expand.** Expanding a server row in an agent's MCP dialog lists that server's tools (name, one-line description, count),
   loaded when expanded, from the agent app.

## Clarifications

### Owner decisions

- **2026-10-21 21:03 UTC (Vikram, Telegram):** an option to add a server to the global list; start/stop/restart/auth for all servers;
  the tools of a server when its row is expanded.
- **2026-10-21 21:06 UTC (Vikram, Telegram):** "global" MUST be written to the agent apps' own config files. "If there is more than one
  agent app, propose in the UI to harmonize and merge all; else ask the user to select the agent app."

- **2026-10-22 01:00 Zurich / 2026-10-21 23:00 UTC (Vikram, Telegram):** "Yes for all and feel free to perform real checks", answering
  Q1-Q6 below: every default (A) is kept and is now a decision, and the real check T060 is approved.
  - **Q1** A: Durbar reads Claude Code's user list read-only, with a switch per server, and passes the switched-on servers to its Claude
    sessions with `--mcp-config` (still strict).
  - **Q2** A: environment-variable and header *references* by default; writing values into the files is a per-server second choice with
    a warning.
  - **Q3** A: backups next to each file (`<file>.durbar-<UTC stamp>.bak`, same folder and permissions), the last 3 per file kept.
  - **Q4** A: Durbar edits `~/.claude.json` directly (every other key kept), not `claude mcp add-json`.
  - **Q5** A: a same-name entry with a different definition is replaced only when *Replace in <app>* is ticked for that app.
  - **Q6** A: `${NAME}` references for Copilot, marked "not verified for Copilot" until T060 shows otherwise.

### Questions answered by the owner (2026-10-22; the default A of each was chosen, see above)

- **Q1 Claude Code's user list in Durbar's own Claude sessions.** Durbar starts Claude Code with `--strict-mcp-config` and no setting
  sources (spec 012 Q8), so a server written to Claude Code's user list reaches `claude` in a terminal but **not** Durbar's own Claude
  sessions. A) Durbar reads Claude Code's user list (read-only, like the Copilot CLI list), shows it in Settings with a switch per server,
  and passes the switched-on servers to its Claude sessions with `--mcp-config` (still strict; no other Claude setting is read)
  **(default)**. B) Only servers Durbar itself wrote. C) None: the global entry only helps the terminal CLI.
- **Q2 Secret values (environment variables, headers).** A) **Reference** by default: the file gets the variable's *name*, not its
  value (Codex `env_vars` / `bearer_token_env_var` / `env_http_headers`; Claude Code and Copilot `${NAME}`), and the dialog says to set
  the variable in your environment; *Write the values into the files* is a second choice per server with a plain warning that the app keeps
  them in its own config in plain text **(default)**. B) Always write values. C) Refuse servers with secret values in global.
- **Q3 Backups.** A) Next to the file, same folder and permissions (`<file>.durbar-<UTC stamp>.bak`), the last 3 per file kept
  (Durbar never holds a copy of another app's secrets in its own data folder) **(default)**. B) In Durbar's data folder.
- **Q4 Claude Code writer.** A) Durbar edits `~/.claude.json` itself (JSON, every other key kept), because `claude mcp add-json` would put
  secret values in the process argument list, which other local programs can read **(default)**. B) `claude mcp add-json -s user` through
  `execFile` with a fixed argument list, used only when the entry has no secret value.
- **Q5 A name that already exists with a different definition** (add or harmonize). A) Show both side by side; nothing is replaced unless
  the user ticks *Replace in <app>* for that app **(default)**. B) Never replace from Durbar.
- **Q6 Copilot `${NAME}` references.** Whether the Copilot CLI expands `${NAME}` in `mcp-config.json` env values is not documented
  (the SDK has an "indirect" env value mode, `read:` `rpc.d.ts` `McpSetEnvValueModeDetails`). A) Write `${NAME}` and say "not verified
  for Copilot" until the real check (T060) **(default)**. B) For Copilot, only plain values.

## User Scenarios & Testing

### Story 1 - Add a server for all my folders (P1)

In a folder's MCP extras, the user presses **+ Add server**. The form has **Add to: (•) This folder ( ) All my folders (global)**. They
pick *All my folders*. With more than one agent app installed, ticks appear for **Copilot CLI, Claude Code, Codex** (each installed app
ticked); with one installed app, a single choice of app (that app selected). They fill in name, command and arguments, and one
environment variable, and keep **Reference environment variables** (the default). **Review…** opens a confirmation listing, per app, the
file (`~/.copilot/mcp-config.json`, `~/.claude.json`, `~/.codex/config.toml`), the exact entry that will be written (values masked), and
"A backup is made next to the file first." **Write to 3 files** writes them; a toast says which files changed and the global list shows
the server with the chips *Copilot · Claude Code · Codex*.

**Acceptance**: (1) nothing is written before the confirmation; (2) a file that fails to parse is listed with its error and is not
written, the others still are, when the user confirms; (3) a backup exists for each written file that existed; (4) no secret value is in
any log, toast, the confirmation (masked), or the window; (5) a second add with the same name shows Q5's comparison.

### Story 2 - Keep the agent apps in step (P2)

Settings > MCP servers shows **Harmonize (2)** when servers differ between the apps' global lists. It lists each server present in some
apps and missing in others (or different), with the differences (command, arguments, environment variable *names*, URL, header *names*),
and per server *Copy to Claude Code, Codex*. The user ticks what to copy and confirms the same per-file confirmation as Story 1. Values
come from the source file in main and never reach the window.

### Story 3 - See where each server comes from (P1)

Every row in Settings and in an agent's MCP dialog carries source chips: *Copilot*, *Claude Code*, *Codex* (global lists), *Durbar
folder* (folder extras), *built-in*, *runtime* (reported by the running session only). A server in several lists shows each chip once.
The lists are read again each time the screen opens, so edits made outside Durbar show up.

### Story 4 - Control every server in a session (P2)

In an agent's MCP dialog each row has: **Stop** (when on) / **Start** (when off) for this session (the existing `agents:setMcp`),
**Restart** where spec 058 offers it, **Sign in** when spec 058's sign-in capability is present (until then not shown), and **Remove**
for global and folder entries (opens the same confirmation as Story 1 for global entries; folder extras as today). A row Durbar cannot
change says why ("Built into Copilot", "Reported by the running session").

### Story 5 - See a server's tools (P2)

Expanding a row (▸) loads its tools from the agent app and lists them: name, first line of the description, and "12 tools". States:
loading, empty ("This server lists no tools"), not running ("Start the session to see its tools"), failed (masked reason).

### Edge cases

- The config file is missing: Copilot and Codex files are created (with the parent folder); `~/.claude.json` is created only as
  `{"mcpServers": {...}}` when it does not exist.
- The file changed between the preview and the write (another app wrote it): the write is refused for that file ("changed since you
  reviewed it; review again"), nothing else in it is lost.
- A Codex file that defines `mcp_servers` as an inline table or dotted keys, or a name that needs quoting: refused with a message (Durbar
  only edits `[mcp_servers.<name>]` tables).
- A file larger than 8 MiB (`~/.claude.json` also holds Claude Code's project state), not UTF-8, or not an object at the top: refused.
- An app's list holds a server Durbar cannot express (WebSocket, a plugin entry): shown read-only with *managed by <app>*.
- Remove of a server that is in some of the chosen files only: only those are edited.

## Requirements

### Global lists (part 1)

- **FR-001** `[IMPLEMENTED]` **Files per agent app**, resolved in main only (the window gets a label with `~`, never the user name):
  - Copilot CLI: `<COPILOT dir>/mcp-config.json` (`copilotDir`, spec 019), top-level `mcpServers` map.
  - Claude Code: `<CLAUDE_CONFIG_DIR>/.claude.json` when that variable is set, else `<home>/.claude.json`; top-level `mcpServers` map
    (user scope).
  - Codex: `<CODEX_HOME>/config.toml` when set, else `<home>/.codex/config.toml`; `[mcp_servers.<name>]` tables.
  - `<home>` is `os.homedir()` (`%USERPROFILE%` on Windows). Paths are joined with `path`, never with `/` literals.
- **FR-002** `[IMPLEMENTED]` **Read** (pure parsers, `src/main/mcpglobal.ts`): each file gives a list of `{name, transport, command?, args?, url?,
  envKeys, headerKeys, envRefs, managed?}`; secret values are read only when a write needs them (harmonize copies) and stay in main.
  JSON: strict JSON (Copilot, Claude); Codex: the line-based reader of spec 061 (`readCodexMcpToml`), extended to `env_vars`,
  `bearer_token_env_var`, `http_headers` and `env_http_headers` key names.
- **FR-003** `[IMPLEMENTED]` **Write** (pure editors that return the new text or a refusal):
  - JSON: parse, set or delete `mcpServers[name]`, write back with 2-space indentation; every other key is kept (key order of the
    rest kept by `JSON.parse`/`stringify`). A file that is not an object, has `mcpServers` that is not an object, or fails to parse is
    refused.
  - Codex TOML: a minimal edit. Add appends a block `[mcp_servers.<name>]` (and `[mcp_servers.<name>.env]` for plain env values) at the end,
    after one blank line and a comment `# added by Agent Durbar`; remove deletes the lines from that table's header up to the next table
    header that is not one of its sub-tables. Every other line, comment and blank line stays byte for byte. Refused: `mcp_servers` as an
    inline table or dotted key, a quoted or odd name, the name already present (add), the table missing (remove), or (change 2026-10-22)
    a file that does not parse: a line that is not a table header, a `key = value`, the rest of a multi-line array, inline table or
    string, a comment or a blank line is refused with its line number (a shape check, not a full TOML parser).
  - Entry shapes: Copilot `{type: "local"|"http"|"sse", command, args, env, url, headers, tools: ["*"]}`; Claude Code `{type: "stdio"|"http"|"sse",
    command, args, env, url, headers}`; Codex `command`, `args`, `cwd`, `env` / `env_vars`, `url`, `http_headers` / `env_http_headers` /
    `bearer_token_env_var`.
- **FR-004** `[IMPLEMENTED]` **Secrets** (Q2): per server, *Reference environment variables* (default) or *Write the values into the files*. Reference:
  Codex `env_vars = ["NAME"]`, an `Authorization: Bearer` header as `bearer_token_env_var`, other headers as `env_http_headers`; Claude
  Code and Copilot `"NAME": "${NAME}"` (Q6). Plain: the values, with the warning "<App> keeps these values in its own config file in plain
  text; any program running as you can read them." Durbar never stores the values itself beyond the confirmation (in main memory, at most
  5 minutes, dropped after the write or cancel), and never logs them.
- **FR-005** `[IMPLEMENTED]` **Two steps, one token.** `mcp:globalPreview(input, apps, secretMode)` validates the input (spec 019 `validateInput`), reads
  each chosen file, builds the new text, and returns per app `{app, label, exists, entry (values masked), error?, conflict?}` and a
  token; main keeps the new texts, the file's size and modification time and a hash of its text. `mcp:globalApply(token, replace)`
  writes only apps without an error, and only when the file still has the same hash (else "changed since you reviewed it").
  `mcp:globalRemovePreview(name, apps)` / `mcp:globalRemoveApply(token)` do the same for a remove. Unknown, used or expired tokens are
  refused.
- **FR-006** `[IMPLEMENTED]` **Safe write**: backup first (Q3: `<file>.durbar-<YYYYMMDDTHHMMSSZ>.bak`, mode 0600, the oldest Durbar backups beyond 3 per
  file deleted, never another app's backup), then write `<file>.durbar-tmp` with the original file's mode (0600 for a new file) and
  `rename` over the file. A failure leaves the original in place and reports "Could not write <label>". Each result names the backup's
  label.
- **FR-007** `[IMPLEMENTED]` **Which apps** (owner 21:06): the form lists the three apps with their install state from `adapters:list`. More than one
  installed: ticks, all installed ones ticked. One installed: a single choice (radio), that app selected. None installed: a single choice
  of the three, none selected; the confirmation then asks for one. A file that exists for an app that is not installed can still be chosen.
- **FR-008** `[IMPLEMENTED]` **Global list in Settings**: "MCP servers" lists the union of the three files by name, each with its source chips (FR-011)
  and, for Durbar-editable entries, *Remove…* (FR-005 remove with the chosen apps ticked where the server is). The Copilot switch for new
  sessions (spec 019 FR-007) stays on Copilot rows. The section says which files were read and their errors. Re-read on every open.
- **FR-009** `[IMPLEMENTED]` **Claude Code's user list in Durbar's Claude sessions** (Q1 A): main reads `mcpServers` of the Claude file (values in main
  only) and adds the switched-on entries to the `mcpServers` of a Claude agent's start options (only for agents whose adapter is
  `claude`); a name that is also a folder extra keeps the folder extra. Settings has a switch per Claude entry for new Durbar sessions,
  kept with the Copilot switches (`disabledAmbient`). `${NAME}` references are passed as written (Claude Code expands them, `read:` docs).
- **FR-010** `[IMPLEMENTED]` **Trust**: the per-file confirmation (exact file, exact entry, the command or URL in full) is the trust step for a global
  server; Durbar adds no second trust prompt. Folder extras keep spec 020's trust per folder.

### Sources (part 1)

- **FR-011** `[IMPLEMENTED]` `McpSourceTag = 'copilot' | 'claude' | 'codex' | 'folder' | 'builtin' | 'runtime'`. Settings rows and the agent dialog
  (`agents:mcp`, `AgentMcpEntry.sources?: McpSourceTag[]`) carry every source that has the name; chip words: *Copilot*, *Claude Code*,
  *Codex*, *Durbar folder*, *built-in*, *runtime*. The existing single `origin` stays for compatibility.

### Harmonize (part 2)

- **FR-020** `[IMPLEMENTED]` `mcp:globalDiff()` returns per name: in which apps it is, and, where present in two or more, the differences (transport,
  command, arguments, URL, env and header *names*); values are compared in main only and reported as "values differ" without them.
- **FR-021** `[IMPLEMENTED]` Settings shows **Harmonize (N)** when N > 0 and more than one app has a readable file. Each row: *Copy to <missing apps>*
  ticks; a different definition offers *Use the <app> version in <other apps>* (Q5: never ticked by default). Applying uses FR-005's
  preview and confirmation; the copied entry keeps the source's references or values as they are (no value reaches the window).
- **FR-022** `[IMPLEMENTED]` With a single app, Harmonize is not shown.
- **FR-023** `[IMPLEMENTED]` (found while building) A copy converts between formats and keeps references: JSON `${X}` <-> Codex
  `env_vars` (same name only; another name is refused for Codex) and `env_http_headers`; JSON `Authorization: Bearer ${X}` <-> Codex
  `bearer_token_env_var`. A value with `${...}` inside other text is refused for Codex (it does not expand it). A server with a working
  directory, or of a kind Durbar does not write (WebSocket, plugin), is listed but not copyable. A missing file counts as an empty list.

### Session controls and tools (part 3; depends on spec 058 #473)

- **FR-030** Agent dialog rows (spec 058 FR-030 layout, coordinated with its owner): **Stop** / **Start** buttons for this session using
  `agents:setMcp` (same rules: a folder extra that is off in the folder cannot be started here and says why); **Restart** as spec 058
  FR-031; **Sign in** only when spec 058 FR-064 reports `canSignIn` (not built here); **Remove…** for entries from a global file or a
  folder extra; other rows say *managed by <app>* or *built-in*.
- **FR-031** `AgentAdapter.listMcpTools?(sessionId, server): Promise<{name: string; description?: string}[]>`, capability
  `mcpTools?: boolean`:
  - Copilot: `session.rpc.mcp.listTools({serverName})` (`read:` SDK `rpc.d.ts`, experimental; throws when not connected).
  - Claude Code: the `tools` of that server in the `mcp_status` reply (`read:` docs `McpServerStatus.tools`).
  - Codex: `mcpServerStatus/list {threadId, serverName, detail: "toolsAndAuthOnly"}`, the `tools` map (`read:` generated app-server schema
    `ListMcpServerStatusResponse`, codex-cli 0.163.0).
- **FR-032** `agents:mcpTools(id, name)`: known agent, valid name, running session; at most 500 tools, names cut at 128 characters,
  descriptions reduced to their first line, cut at 200 characters and masked (`maskMcpError` with the session's secret values); 10 s
  timeout; errors masked. Loaded only when a row is expanded, cached in the window until the dialog closes or the server restarts.
- **FR-033** The expanded row lists the tools (text at least 10.5px, scrolls inside the dialog at 1280x800), "N tools", and the empty,
  not-running and failed states (Story 5).

### Simulator and tests (constitution IV)

- **FR-040** (part 1 `[IMPLEMENTED]`: the fake lists live in the simulator page, `sim.ts`; the temp-folder fixtures are in `test:mcpglobal`) Simulator: the three global lists come from fixture files under a temp folder (`DURBAR_COPILOT_DIR`, `CODEX_HOME`,
  `CLAUDE_CONFIG_DIR` dev hooks), so the add, confirmation and harmonize flows run without touching the user's files; the sim adapters
  answer `listMcpTools` with fake tools.
- **FR-041** (part 1 `[IMPLEMENTED]`, `scripts/test-mcp-global.ts`, mutation-checked on the hash check and the marker removal) Unit tests (0 credits): parsers and editors per format with fixtures (comments, unknown keys, CRLF, Windows paths in args,
  a Codex file with other tables before and after, inline-table refusal, parse-fail refusal), backup made and pruned to 3, atomic
  write, changed-since refusal, token expiry, masking of the preview, no secret value in any IPC reply or log line (planted-value scan),
  Claude list merged only into Claude agents' options.
- **FR-042** (part 1 `[IMPLEMENTED]`: `docs/screenshots/069-mcp-global-{settings,add,review}-<w>x<h>.png`) Screenshots at 1440x900 and 1280x800: the add form with the global choice, the per-file confirmation, the Settings list with
  source chips (part 1); harmonize (part 2); the expanded tools list (part 3).

- **FR-012** `[IMPLEMENTED]` (found while building) Views of the apps' files mask secret-shaped arguments, flag values and URL keys with
  the shared rules (`maskSecretCommand`, `maskSecretArgs`, `maskSecretUrl`), because another app's file may hold a token in an argument.
  The add form's hint under *Environment variables* and *Headers* says what happens to a typed value for the chosen scope and mode.

### Honest limits

- **FR-050** `[IMPLEMENTED]` Checked against the real Copilot CLI, Claude Code and Codex reading the written files (T060), 0 credits, no
  prompt, in a scratch home (`HOME`, `USERPROFILE`, `XDG_*` in a temporary folder; no real user file read or written):
  `real:` 2026-10-22, GitHub Copilot CLI 1.0.101, Claude Code 2.1.304, codex-cli 0.163.0, the main-process write path
  (`GlobalLists.preview`/`apply`/`removePreview`) driven by a script on the part 4 branch.
  - Copilot CLI: `copilot mcp list` lists the stdio (`local`) and two http entries under *User servers*; `copilot mcp get <name> --json`
    shows them as written, `enabled: true`.
  - Claude Code: `claude mcp list` / `claude mcp get` (user scope) list all three; the stdio demo server is *Connected*; a missing
    referenced variable shows as a warning ("Missing environment variables: X_API_KEY"), not an error.
  - Codex: `codex mcp list` / `codex mcp list --json` / `codex mcp get` show `env_vars = ["DEMO_KEY"]`, `env_http_headers` and
    `bearer_token_env_var` as written.
  - Every other key of the JSON files (unknown top-level keys, `projects`, an unknown key inside another server) and every other byte of
    the Codex file (comments, odd spacing, other tables) are kept: add then remove of all three gave the same Codex bytes and the same
    JSON content. Backups next to each file, mode 600, pruned to the newest 3 after six writes; the write is a rename (new inode, no
    `.durbar-tmp` left), the file mode is kept (664 stayed 664), new files are created 600. A file changed after the review is refused.
    Missing files are created (`~/.claude.json` as `{"mcpServers": ...}` only) and all three CLIs list the entry.
  - Remove: each CLI no longer lists the server.
  - Found and fixed: a Codex file that does not parse (an unclosed `[table` header) was appended to instead of refused; see *Changes*.
  - Claude Code rewrites `~/.claude.json` with its own keys (`firstStartTime`, `userID`, migrations) when it runs: the review's hash
    check (FR-006) is what keeps such a concurrent write from being lost.
- **FR-051** Claude Code `${NAME}` in the user list `[IMPLEMENTED]` (`real:` 2026-10-22, Claude Code 2.1.304: the stdio demo server
  started by `claude mcp get` received the variable's value, not the literal `${DEMO_KEY}`). Codex `env_vars` `[IMPLEMENTED]` (`real:`
  the same check through `codex app-server` `mcpServerStatus/list`). Copilot `${NAME}` expansion (Q6) stays `[KNOWN GAP]`: the Copilot
  CLI stores and shows the literal `${NAME}` (`copilot mcp get --json --show-secrets`) and starts MCP servers only inside a signed-in
  session, which this check did not run; the review keeps saying "not verified for Copilot".

## Success criteria

- **SC-001** A server added for all folders appears, with the right source chips, in Settings and in a new agent of each chosen app, with
  one confirmation.
- **SC-002** No secret value reaches the window, a log, a toast or a backup in another folder (planted-value tests).
- **SC-003** Every edit of an app's file leaves every other byte of that file unchanged (Codex) or every other key unchanged (JSON),
  with a backup.

## Delivery

1. PR 1 (this branch): FR-001..FR-011, FR-040/041 parts, screenshots of the form and confirmation.
2. PR 2: FR-020..FR-022.
3. PR 3, after #473: FR-030..FR-033. Sign in stays with spec 058 (Paco, #364).

## Changes

- **2026-10-22 (T060, real check):** a Codex `config.toml` that does not parse must be refused like a JSON file that does not parse
  (acceptance 2 of story 1). The line reader skipped lines it did not understand, so a file with an unclosed table header
  (`[mcp_servers.x`), which `codex mcp list` refuses to load ("unclosed table, expected `]`"), got a new table appended. Now every
  line must be a table header, a `key = value` (dotted and quoted keys allowed), the rest of a multi-line array, inline table or
  string, a comment or a blank line; otherwise the read, add and remove are refused with "This config.toml does not parse (line N)".
  Lines longer than 16 KiB stay unread, as before. `real:` the five refused and five accepted fixtures of `test:mcpglobal` give the same
  verdict in codex-cli 0.163.0. (FR-003, T061)

## Relationship to other specs

- **019 / 020**: the Copilot CLI list stays the source of Copilot's servers; Durbar now also *writes* it (only after confirmation), which
  replaces 019/020's "never written". Folder extras unchanged. Dated note under 019's and 020's `## Changes`.
- **058**: Restart, Restart session and Sign in are 058's; this spec only places them on every row and adds Start/Stop and Remove.
- **061**: reuses `readCodexMcpToml` and the JSON readers; folder-level files are not written by this feature.
- **012** Q8: Claude sessions stay `--strict-mcp-config`; FR-009 passes the user list explicitly.

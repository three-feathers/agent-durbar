# Feature Specification: Your own Claude Code instructions and agents

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Your own Claude Code instructions and agents (issue #840; owner 2026-11-02 and 2026-11-09): one global Settings switch, off by default, for the user's ~/.claude/CLAUDE.md (contained imports) and ~/.claude/agents plus confirmed folder agents as sub-agents; allow-listed reads, private launch files, no widening
status: specified
note: spec, plan, tasks; Q1..Q6 answered 2026-11-09 (recommended defaults); nothing built
-->

**Feature Branch**: `108-claude-user-setup` (spec, plan and tasks only). The build is one small PR per task group.
**Created**: 2026-11-09
**Status**: Specified. Nothing built. Q1..Q6 were answered by the owner on 2026-11-09 (the recommended default of each); no group waits for an answer.
**Issue**: #840 (stays open for the build).
**Input**: Issue #840 (opened by Paco, owner problem statement dated 2026-10-28) and two owner decisions on it, quoted:

- **2026-11-02 (Vikram, on #840)**: "keep: the user's own agents and CLAUDE.md, already on their disk."
- **2026-11-09 (Vikram, triage, Telegram 06:59 UTC, recorded on #840)**: "one global switch in Settings for your own ~/.claude/CLAUDE.md and agents as sub-agents".

So: **one global switch in Settings, opt-in, off by default** (not per folder; the issue's "per folder or global" is settled as global).

## Summary

A Claude Code session started from Durbar does not behave like the same person's `claude` in a terminal, because Durbar launches Claude with `--setting-sources ""` (spec 012 Q8). The folder's `CLAUDE.md` is passed, but the person's own `~/.claude/CLAUDE.md` is not, and the person's agent files are offered only as the one profile a session starts with (spec 043 FR-008), never as sub-agents the session can hand work to. A "coordinator" way of working (the main session plans and delegates to named agents such as `analyst`, `implementer`, `reviewer`) cannot run in Durbar.

This feature adds **one switch in Settings, off by default**: *Use my Claude Code instructions and agents*. While it is on, each Claude session launch also gets:

1. the person's `CLAUDE.md` from their Claude folder, with its `@` imports **inside that folder only**, as instructions (beside the folder's `CLAUDE.md`, through the same reader and budget);
2. the person's agent files (`<Claude folder>/agents/*.md`) and the session folders' **confirmed** agent files (`.claude/agents/*.md`, spec 043's per-file trust) as **sub-agents**: one `--agents` definition with several entries, **without** `--agent`, so the main session can delegate to them.

Nothing else from the Claude folder is read. Settings files stay off, Durbar's mode still decides every permission, and nothing read is stored, logged or shown unmasked.

## Context: what exists today (spec 021 FR-031, reuse first)

- **Launch flags** (`src/adapters/claude.ts`, `claudeArgs`, `ClaudeLaunch`): `--setting-sources ""` and `--strict-mcp-config` in every mode (`claudeOptionsFor` in `src/adapters/claudeModes.ts`, spec 012 FR-025, Q8); `--append-system-prompt` from `appendSystemPrompt`; `--agents <json> --agent <name>` from `agent` (spec 043 FR-008), only for the profile chosen at session start.
- **CLAUDE.md reader** (`claudeMdPrompt(folder, io, flavor)` in `claude.ts`, spec 012 Q8 delta 2026-10-18): reads `<folder>/CLAUDE.md`, expands `@path` imports outside code fences, refuses URLs and `~` paths, keeps only files whose `realpath` is inside the folder's `realpath`, each file once, depth at most `CLAUDE_MD_MAX_DEPTH` (4), at most `CLAUDE_MD_MAX_CHARS` (64 KB) in total, files over that size skipped. Injected `ClaudeMdIo` and path flavour for tests. Called once per CLI launch from `ClaudeAdapter.launch` (`deps.claudeMd` for tests). **This is the one CLAUDE.md loader; this feature extends it and adds no second one.**
- **Agent reader** (`src/adapters/claudeAgents.ts`, spec 043 FR-008): `listClaudeAgents(folders, configDir)` reads `<folder>/.claude/agents/*.md` (source `repo`) then `<configDir>/agents/*.md` (source `user`), folder first on a name clash; caps `MAX_AGENT_FILES` 50, `MAX_AGENT_BYTES` 64 KB (larger files skipped), `MAX_AGENT_PROMPT` 16 KB (prompt cut); `lstat` so a symlinked file is skipped; names `[A-Za-z0-9._-]{1,64}`; front matter through `parseFrontMatter` (`src/adapters/slashcommands.ts`, spec 073); `agentsArg(def)` builds the `--agents` JSON for ONE agent with `description`, `prompt`, `tools`, `model` only. **This is the one agent loader; this feature extends it.**
- **Claude folder location**: `claudeConfigDir(env)` in `src/adapters/claudeHistory.ts` = `CLAUDE_CONFIG_DIR` or `path.join(os.homedir(), '.claude')`; `listClaudeAgents` and `claudeSessionExists` use the same rule. `ClaudeAdapterDeps.configDir` overrides it in tests. Profile files use it too (spec 043 FR-013, `userAgentDirs`).
- **Folder agent trust** (`src/main/agenttrust.ts`, `AgentTrustStore`, `durbar-agent-trust.json`; `hashAgentFile`; `src/main/ipc/profiles.ts` `agents:listProfiles` / `agents:selectProfile`, spec 043 FR-003): a `repo` agent is used only after the person confirmed that folder, agent id and the file's SHA-256. Stores the hash, never content.
- **Private launch files** (`privateMcpConfig` in `claude.ts`, `makePrivateDir` in `src/adapters/privatedirs.ts`, spec 012 FR-165): the MCP config goes to a `0600`, `wx` file in a private temp folder, never on the command line, removed when the CLI exits and swept at quit.
- **Helpers in the office** (spec 015, `ClaudeMapper` in `src/adapters/claudeMap.ts`): a `Task`/`Agent` tool call emits a `subagent` event with `agentName` from the call's `subagent_type`; the window shows the helper as *Helper · <agentName>* (`app.js`, masked by `helperMask`, spec 015 FR-021). **Named sub-agents already show their name; no new event is needed.**
- **Modes** (`claudeOptionsFor`, `toolKind`): `Task` and `Agent` are `custom-tool`, which Read-only denies (`dontAsk` with only read tools allowed); Ask first sends every call through `canUseTool` and the `PermissionBroker`; Allow all is `bypassPermissions`. The OS sandbox block (spec 087, `claudeSandbox.ts`) and `--disallowedTools` apply to the whole CLI process.
- **Settings**: `SettingsStore` in `src/main/settings.ts` (`AppSettings` in `src/shared/credits.ts`; *Diagnostics* is the pattern: off by default, only `true` written), the `setting()` helper and `settings:get` in `src/main/ipc/settings.ts`, the preload bridge, the Settings screen in `src/renderer/screens.js` (its *Agent apps* section, spec 051) and the section list `settingsnav.js` (spec 052 FR-226). The worlds restyle Settings by tokens only (097 FR-130, 102 FR-263).
- **Masking**: `src/shared/redact.ts` (`maskHomePaths`, `maskTokenShapes`, `redact`, `cut`).
- **Folder setup** (spec 061, `src/main/foldersetup.ts`): a folder's own hooks, rules and MCP, accepted per folder. Not touched here.

## User scenarios

- **US1 (P1) Turn it on knowingly.** *Given* Settings > Agent apps > Claude Code, *Then* I see the switch **Use my Claude Code instructions and agents**, off, and under it one plain sentence of what it loads and what it never loads. *When* I press **Check what loads**, *Then* I see the file names, sizes and counts it would use (no file text), and what it would skip and why. *When* I turn it on, *Then* the row says "On. Applies to Claude sessions that start or restart from now on." and nothing is read until a session launches.
  - *Given* the switch on and my `CLAUDE.md` saying "Answer in Spanish", *When* I start a Claude session in any folder and send a message, *Then* the CLI got my `CLAUDE.md` text (with its imports from my Claude folder) as appended instructions, and no other launch flag changed except the ones this spec names.
- **US2 (P1) A coordinator delegates to my named agents.** *Given* the switch on, `analyst.md` and `reviewer.md` in my agents folder, and the session in Ask first, *When* the main session hands a task to `analyst`, *Then* the office shows a helper named *Helper · analyst*, its tool calls ask through the same permission cards as the main session, and it can do nothing the mode does not allow.
- **US3 (P1) Off means today's behaviour.** *Given* the switch off (the default), *Then* no file in my Claude folder is read for instructions or sub-agents (the profile list of spec 043 keeps working as today), and the launch flags are byte-for-byte today's.
- **US4 (P2) A folder's agent waits for my confirmation.** *Given* the switch on and a folder with `.claude/agents/deploy.md` I never confirmed, *Then* `deploy` is not offered as a sub-agent; **Check what loads** and the Agent menu say "1 folder agent waits for your confirmation", and once I confirm it there (spec 043 FR-003) it is offered from the next launch. If its file changes, it waits again.
- **US5 (P2) Nothing leaks.** *Given* the switch on and a token-shaped string in an agent's name or in my `CLAUDE.md`, *Then* Settings, the helper name, the debug log, Diagnostics, saved settings and screenshots never show it unmasked; Durbar's saved files hold only the switch.
- **US6 (P3) Keyboard and screen reader.** *Given* keyboard only, *Then* Tab reaches the switch and **Check what loads**, Space toggles, and the result is read by the row's polite status region; the switch has a name and a description that says what it loads.

## Edge cases

- No Claude folder, no `CLAUDE.md`, an empty one, or no `agents` folder: nothing is added for that part; the session starts as today; **Check what loads** says "No CLAUDE.md found" / "No agents found".
- `CLAUDE_CONFIG_DIR` set: that folder is the Claude folder everywhere (FR-003), and Settings names it (home part masked).
- The Claude folder itself is a symlink (common with dotfiles): its `realpath` is the root; files inside it are fine. A file or import whose `realpath` leaves the root is skipped and listed as "points outside your Claude folder".
- An import names `.credentials.json`, `settings.json`, a session file, history, memory or any other non-allowed file (FR-005): skipped as "not an instructions file", left as plain text.
- Import cycles, the same file twice, depth over 4, `@` inside code fences or inline code, URLs and e-mail-like tokens: as `claudeMdPrompt` handles them today.
- A huge, binary, NUL-holding, invalid UTF-8, BOM or CRLF file; a front matter that never closes; 10,000 front matter lines; a name `__proto__`, `constructor` or `prototype`; a `tools:` list of 10,000 entries; a name clash between a user agent, a folder agent and the chosen profile (FR-012, FR-013).
- More than 50 agent files in total: the first 50 by the existing order (folders first, then the user's, each sorted by file name) are read; the rest are counted as "not read: over 50 files".
- The person also chose a profile for the session (spec 043): the profile stays the session's own agent (`--agent`), and the sub-agents are offered beside it (FR-011).
- The switch changes while sessions run: running CLI processes keep what they got; the next launch of each session (first message, resume, relaunch after a mode or model change) uses the new value.
- Read-only: the instructions apply; delegation is refused as today (Q3, answered (a) 2026-11-09). The row says so.
- The installed Claude Code is older than the version these flags were checked on, or its version cannot be read: see FR-016.
- The Claude folder is on a slow or network drive: reads are bounded (FR-008) and never block the window.

## Requirements

### A. The switch

- **FR-001** **One global switch, off by default.** `AppSettings.claudeUserSetup?: true`: only `true` is written, absent means off; any stored value other than `true` reads off (fail closed). Setter `SettingsStore.setClaudeUserSetup(v)` accepts only a boolean (*Diagnostics*' pattern, issue #1094's `Saved`); IPC `settings:setClaudeUserSetup` through the existing `setting()` helper; `settings:get` returns `claudeUserSetup: boolean`. No per-folder or per-session value exists (owner 2026-11-09).
- **FR-002** **Plain words.** The row sits in Settings > Agent apps under Claude Code (it reaches the section list of spec 052 FR-226 through its heading). Label: **Use my Claude Code instructions and agents**. Description, always visible: "Claude Code sessions here also get your CLAUDE.md (and the files it imports from your Claude folder) as instructions, and the agents in your Claude folder's agents folder as helpers they can hand work to. Read when a session starts. Your settings, hooks, plugins, MCP servers, memory, history and sign-in are never read. Durbar's mode still decides what every agent may do." The Claude folder is named under it, home masked (`~/.claude`, or the `CLAUDE_CONFIG_DIR` folder). When on: "Applies to Claude sessions that start or restart from now on." The switch is offered only when the Claude Code adapter is registered; it does not appear for Copilot or Codex.

### B. What is read, and when

- **FR-003** **The Claude folder.** One function decides it: `claudeConfigDir(env)` (`claudeHistory.ts`), already used by the agent reader and the session list: `CLAUDE_CONFIG_DIR` when set and non-empty, else `path.join(os.homedir(), '.claude')`. Windows: `%USERPROFILE%\.claude` through `os.homedir()`; macOS and Linux: `$HOME/.claude`. No second rule is added. The root for every containment check is `realpath(claudeConfigDir())`; if it cannot be resolved, nothing is read.
- **FR-004** **The allow-list.** While the switch is on, exactly these may be read, and nothing else in the Claude folder:
  1. `<root>/CLAUDE.md`;
  2. the files it imports (FR-005);
  3. `<root>/agents/*.md`, one level, regular files only (`lstat`; a symlinked file is skipped, as today).
  Never read for this feature: `settings.json`, `settings.local.json`, `.credentials.json`, `.claude.json`, `projects/` (sessions and auto-memory), `todos/`, `history.jsonl`, `shell-snapshots/`, `statsig/`, `plugins/`, hooks, MCP configs, `ide/`, logs, caches, and any other file not in the list above. (Other existing features that read the Claude folder, such as the session list of spec 012 FR-125 and the slash entries of spec 073, are unchanged and not widened.)
- **FR-005** **Imports stay inside, and are instructions only.** The person's `CLAUDE.md` goes through `claudeMdPrompt` with the Claude folder as its root (the same function, a root and a heading parameter added; FR-018). An import is followed only when all hold: its `realpath` is inside the root (symlinks resolved, so a link that escapes is refused; Windows drive letters and case compared by `path.win32`, as today); its file name ends in `.md` (case-insensitive); and no segment of its path relative to the root is one of `projects`, `todos`, `plugins`, `shell-snapshots`, `statsig`, `ide`, `logs`, `cache`, `session-env`, `file-history`, or starts with `.` (Q2, answered (a) 2026-11-09: this list plus every dot segment). Anything else stays as the literal `@token` text. URLs stay refused. `@~/` imports (Q1, answered (a) 2026-11-09): `~` is resolved to the home folder for the person's own file only, and the result must still pass every rule above (inside the Claude folder).
- **FR-006** **When.** Reads happen only (a) in `ClaudeAdapter.launch`, once per CLI launch of a session while the switch is on (the same moment the folder `CLAUDE.md` is read today), and (b) when the person presses **Check what loads** in Settings (FR-020). Never at app start, never on opening Settings, never in the background, never for Copilot or Codex sessions, never for the simulator's fake agents beyond the fixture folder of FR-026.
- **FR-007** **Switch off = no read.** With the switch off, `launch` calls neither the user branch of `claudeMdPrompt` nor the sub-agent builder, and `claudeArgs` output equals today's for the same session (a test compares them).
- **FR-008** **Bounded.** Every read is synchronous on the adapter's existing launch path today; this feature adds no unbounded work: at most 1 + imports (each file once, depth 4, 64 KB total, FR-009) and at most 50 agent files of 64 KB each. A read error on any file skips that file only; the session still starts.

### C. Caps

- **FR-009** **One CLAUDE.md budget.** The folder's and the person's `CLAUDE.md` share the existing `CLAUDE_MD_MAX_CHARS` (64 KB). The folder's file is read first with the whole budget, exactly as today, so turning the switch on never cuts the folder's instructions; the person's file gets what is left (Q4, answered (a) 2026-11-09: one shared budget). In the prompt the person's block comes first, headed "Your own CLAUDE.md (user instructions; Agent Durbar passes it because user settings are not loaded):", then the folder's block with today's heading. When the person's text is cut or left out for budget, the prompt says "[cut: CLAUDE.md budget]" at the cut, and **Check what loads** shows it.
- **FR-010** **Agent caps, unchanged.** `MAX_AGENT_FILES` 50 across folders and user, `MAX_AGENT_BYTES` 64 KB per file (larger: skipped, counted "too big"), `MAX_AGENT_PROMPT` 16 KB (longer: cut, counted "cut"). No new cap is added; the `--agents` data goes through a private file (FR-015), so command-line length limits (Windows' 32,767 characters, Linux's per-argument limit) do not apply to it.

### D. Sub-agents

- **FR-011** **Several agents, no `--agent`.** While the switch is on, the launch passes ONE `--agents` definition holding: every `user` agent read under FR-004, plus every `repo` agent of the session's folders whose (folder, id, SHA-256) is confirmed in `AgentTrustStore` (FR-014). Without a chosen profile, no `--agent` flag is passed, so the main session is Claude's default agent and the others are available to its `Task`/`Agent` tool. With a profile chosen (spec 043 FR-008), the profile is in the same definition and `--agent <profile>` is passed as today. With the switch off, today's single-agent behaviour is unchanged.
- **FR-012** **Names and clashes.** The existing name rule `[A-Za-z0-9._-]{1,64}` applies, and `__proto__`, `constructor` and `prototype` (any case) are refused. The definition is built on a null-prototype object (or a `Map` serialised in order), never by assigning into `{}`. On a clash the folder's agent wins over the person's (today's rule), and the chosen profile wins over both; the loser is listed as "same name as …" in **Check what loads**.
- **FR-013** **Only four keys pass.** Each entry carries `description`, `prompt`, `tools` and `model` only, as `agentsArg` does today; every other front matter key in the file (whatever it is called, for example a key that would name hooks, MCP servers, a permission mode or skills) is dropped. `parseFrontMatter`'s result maps become null-prototype so a key `__proto__` or `constructor` cannot reach a prototype or throw (today such a list key throws and the file is skipped, which stays the outcome for a file that cannot be parsed).
- **FR-014** **Folder agents keep their trust check.** A `repo` agent is offered only when `AgentTrustStore.isTrusted(folderKey, id, sha)` holds for the SHA-256 of **the same bytes the adapter parsed** (one read: hash and parse from one buffer, so a file swapped between check and use is never offered). Main passes the confirmed (id, SHA-256) pairs of the session's folders to the adapter in an adapter-neutral start option (FR-019); the adapter never reads the trust file. An unconfirmed or changed folder agent is left out, counted, and confirmed only through spec 043's existing confirmation in the Agent menu. The person's own files under their Claude folder need no confirmation (issue #840, owner decision 2026-11-02).
- **FR-015** **No widening.** Sub-agents run in the session's own CLI process: the same `--permission-mode`, `--allowedTools`, `--disallowedTools` (mode and spec 069 FR-062), `--strict-mcp-config` with Durbar's MCP list only, the same OS sandbox block (spec 087), the same `PreToolUse` hook and `canUseTool` broker, the same dollar cap (`--max-budget-usd`). An agent's `tools` list can only narrow what it may call; Durbar adds nothing from it to any allow list, and a tool name in it that the mode disallows stays disallowed. `--setting-sources ""` stays in every launch. No hook, permission rule, plugin, MCP server, environment value or `--settings` content comes from any file this feature reads. An agent's `model` is passed only when it passes the existing model rule; its cost counts against the session's cap like any helper.

### E. How it reaches Claude, and the version gate

- **FR-016** **Private files, version gated.** The person's instructions and the `--agents` definition go to Claude through private files, never as command-line text, because a process's command line is readable by other local accounts on some systems and is length-limited: `--append-system-prompt-file <file>` and `--agents <file>` (both listed by `claude --help`, `read:` Claude Code 2.1.319, 2026-11-09, which says `--agents` takes "JSON … or with --print the path to a file"), written with the `privateMcpConfig` pattern (`makePrivateDir`, mode `0600`, flag `wx`, removed at CLI exit, swept at quit). When the installed Claude Code is older than the first version known to have both (a constant like `CLAUDE_FORWARD_SUBAGENT_MIN_VERSION`; Q5, answered (a) 2026-11-09) or its version is unknown, the switch's content is **not sent at all** (no fallback to the command line); the session starts as with the switch off, and the row says "Needs Claude Code <version> or later". `[KNOWN GAP]` until the plan's research task confirms the first version and the file forms on a real install (free `--help` probes only).
- **FR-017** **The folder's CLAUDE.md, unchanged unless both go together.** When the switch's instructions are sent (FR-016), the folder's block travels in the same private file (one `--append-system-prompt-file`, FR-009's order). When they are not, the folder's `CLAUDE.md` goes exactly as today.

### F. Code shape

- **FR-018** **One loader each.** `claudeMdPrompt` gains a root kind (folder or user Claude folder) and the FR-005 import filter for the user kind, keeping one budget counter across both calls (FR-009); `claudeAgents.ts` gains `subAgentsArg(defs)` beside `agentsArg` and a read path that returns the parsed definition with the SHA-256 of the bytes read. No other module reads the Claude folder for this feature.
- **FR-019** **Adapter-neutral options.** `StartOptions` gains `userSetup?: { on: true; confirmedFolderAgents: { id: string; sha256: string }[] }` (no Claude type, no file text, no path from the window). Main fills it from `SettingsStore` and `AgentTrustStore` when a Claude session starts or relaunches; other adapters ignore it. The window never sends file paths, names or content for this feature.

### G. Check what loads (Settings preview)

- **FR-020** **On request, names and numbers only.** **Check what loads** calls `settings:claudeUserSetupPreview` (main, `fromAppFrame`, no arguments accepted). Main runs the same readers (FR-018) on the Claude folder (no session folders: folder agents are counted per folder only in the Agent menu) and returns: whether `CLAUDE.md` was found, its size, the number of imports followed and skipped by reason (outside, not instructions, too deep, budget), the agents' names (each through `maskTokenShapes` and `cut` to 64), their count, and skipped counts by reason (too big, cut, bad name, unreadable, over 50). **No file text, description, prompt or path beyond the masked Claude folder is returned or shown.** The result lives only in the open Settings screen and is dropped when it closes; nothing is cached in main.
- **FR-021** **The preview never turns anything on.** Pressing it with the switch off reads the same files (the person asked) and changes no setting.

### H. Never stored, logged or shown unmasked

- **FR-022** **No persistence.** Durbar's saved files (`durbar-settings.json`, folder lists, trust store, notes, activity, crash marker, Diagnostics copy) hold only the boolean switch; no text, name, size, path or hash from the Claude folder is written by this feature. The private launch files are the only copies, `0600`, removed when the CLI exits.
- **FR-023** **No logs or telemetry.** The `DURBAR_LOG` debug log, stderr forwarding, error messages, toasts, Diagnostics (spec 058 FR-227) and the support copy never include instruction text, agent prompts, descriptions or the launch files' content; at most "user setup: on, CLAUDE.md 1, agents 4" counts. Durbar has no telemetry; none is added. Helper names in the office keep spec 015 FR-021's `helperMask`.

### I. Worlds, keyboard, screen reader

- **FR-024** **All worlds.** The row is part of Settings, which every world restyles by tokens (Open office, Real office 097 FR-130, Retro arcade 102 FR-263); no world-specific markup. Helpers named by the switch's agents are drawn by each world's existing helper drawing (Flat tiles, Real office helper cards, Retro helpers) with the existing *Helper · <name>* label. `docs/feature-inventory.md` gets one row with all three worlds.
- **FR-025** **Keyboard and screen reader.** The switch is the existing `sw()` control (`role="switch"`, `aria-checked`), named by its label and described by its sentence (`aria-describedby`); **Check what loads** is a button; results and the "Needs Claude Code …" note go to the row's `role="status"` region (polite); the preview list is a real list. Text at least 10.5 px; the row fits 1440x900 and 1280x800 without horizontal scroll.

### J. Simulator and tests

- **FR-026** **Fixtures, zero credits.** A fixture Claude folder under the tests (`CLAUDE.md` with good, outside, symlinked, `.json`, deep and cyclic imports; agents with hostile names, oversized files, `__proto__` front matter, binary bytes, a never-closed front matter; a `.credentials.json` and `settings.json` holding fake token-shaped values that must never appear anywhere). Unit tests drive `claudeMdPrompt`, the agent reader and `claudeArgs`; the fake CLI checks the launch flags and that the private files exist only while it runs. The simulator (`DURBAR_SIM=15`) shows the Settings row and a preview from the fixture folder, never the real `~/.claude`.

### K. Known gaps (constitution VIII)

- **FR-027** `[KNOWN GAP]` Until T012 runs: that Claude Code offers several `--agents` entries without `--agent` to its delegation tool, that the session's `--disallowedTools`, permission mode, sandbox and `canUseTool` apply to sub-agent calls, that `--agents <file>` and `--append-system-prompt-file` behave as `--help` says, and whether a changed `--agents` set is honoured on `--resume` (spec 043 FR-008 found `--agent` is not). These are `read:` (`claude --help` 2.1.319) and vendor behaviour, not checked by a run.
- **FR-028** `[KNOWN GAP]` Durbar's import rule (FR-005) is narrower than the terminal's: a `CLAUDE.md` that imports a file outside the Claude folder or a non-`.md` file works in the terminal but not in Durbar. The preview names each skipped import's reason so the person can see it.
- **FR-029** `[KNOWN GAP]` Not checked on Windows or macOS until their owners run T012's check there; the Claude folder rule (FR-003) is shared code already used on all three.

## Safety (constitution III)

- **Default off; one explicit choice** that says what it loads (FR-001, FR-002). Off is byte-for-byte today (FR-007).
- **Allow-list, not deny-list, for the files** (FR-004); imports `.md` only, inside the `realpath` root, no symlink escape, no data folders (FR-005). Credentials, settings, sessions, memory, history, plugins, hooks and MCP files are never read by this feature.
- **Read at launch or on request only** (FR-006); bounded (FR-008, FR-009, FR-010); hostile files skipped, never crash the launch (FR-012, FR-013, edge cases).
- **No widening of permissions** (FR-015): `--setting-sources ""` stays; mode, allow and deny lists, sandbox, hook, broker and cap apply to sub-agents; tools lists only narrow; only four keys per agent pass.
- **Folder agents keep spec 043's per-file trust**, checked on the exact bytes used (FR-014).
- **Never stored, logged or shown unmasked** (FR-020, FR-022, FR-023); content goes to Claude only through `0600` private files, never the command line (FR-016).
- **Prompt content is the person's own.** Their `CLAUDE.md` and agent prompts are their instructions to their agent, as in the terminal; Durbar does not judge them. A folder's agent text is outside text until confirmed (FR-014).

## Windows, macOS, Linux (constitution VI)

`os.homedir()` and `CLAUDE_CONFIG_DIR` only (FR-003); `path` and `realpath` for every join and compare, `path.win32` rules on Windows (drive letters, case, UNC homes); no shell; private files through `makePrivateDir` (Windows ACL behaviour as spec 012 FR-165 documents). Tests run the containment cases with both `path.posix` and `path.win32` flavours (`claudeMdPrompt` already takes a flavour).

## Success criteria

- **SC-001** With the switch off, `claudeArgs` and the files read are identical to `main` before this feature for every fixture session (test).
- **SC-002** With the switch on, no fixture file outside FR-004's allow-list is opened (a recording `io` in the test), and the fake token in the fixture's `.credentials.json` and `settings.json` appears in no output, log line, preview, saved file or launch file.
- **SC-003** Every hostile fixture file is skipped or cut with the stated reason, and the session still launches (test).
- **SC-004** In every mode, the launch flags that decide permissions are identical with the switch on and off (test), and a sub-agent's `tools` list never adds a tool to `--allowedTools`.
- **SC-005** The Settings row works with keyboard and screen reader in all three worlds at 1440x900 and 1280x800 (simulator screenshots, audit driver).
- **SC-006** `real:` (T012, owner OK needed): one Claude session on the owner's Mac, 1-2 prompts, delegates to `analyst` and shows *Helper · analyst*.

## Clarifications

All six were answered on 2026-11-09 by the owner (Vikram, Telegram 07:24 UTC, "All ok", recorded on PR #1366): the recommended default of each was accepted. The options are kept for the record.

- **Q1 `@~/` imports in my CLAUDE.md.** Today's reader leaves `@~/…` as text. In a personal `CLAUDE.md`, `@~/.claude/rules.md` is a common form. (a) Resolve `~` to the home folder for the person's file only, then apply FR-005 (it must still land inside the Claude folder); (b) keep leaving `@~/` as text. **Recommended: (a)**, since containment still holds. **Answered 2026-11-09 (Vikram): (a)** (the recommended default).
- **Q2 Which folders inside the Claude folder are off limits for imports.** FR-005 names a list from what is known of Claude Code's folder; the vendor may add folders. (a) The list in FR-005 plus every dot-segment; (b) stricter: imports only from the Claude folder's top level and from folders the person names in Settings; (c) imports only from the top level. **Recommended: (a)** with the `.md`-only rule, which already keeps out JSON, JSONL and credential files; revisit if Claude Code adds `.md` data under a new folder. **Answered 2026-11-09 (Vikram): (a)** (the recommended default).
- **Q3 Read-only and delegation.** Read-only denies the `Task`/`Agent` tool today (it is a custom tool). (a) Keep it: in Read-only the instructions apply, delegation is refused, and the row says "In Read-only, Claude cannot hand work to agents"; (b) allow the delegation tool in Read-only, with sub-agents bound by the same read-only lists and hook. **Recommended: (a)** for this feature (no mode change); (b) would be a spec 003/012 mode change of its own. **Answered 2026-11-09 (Vikram): (a)** (the recommended default).
- **Q4 Budget split.** (a) One 64 KB budget, the folder's `CLAUDE.md` first, the person's gets the rest (FR-009); (b) each gets its own 64 KB. **Recommended: (a)**, as the issue says "within the existing CLAUDE.md budget". **Answered 2026-11-09 (Vikram): (a)** (the recommended default).
- **Q5 Older Claude Code.** (a) No file support known, no content sent, row says which version is needed (FR-016); (b) fall back to command-line text with a warning. **Recommended: (a)**: (b) would put the person's instructions where other local accounts may read them. **Answered 2026-11-09 (Vikram): (a)** (the recommended default).
- **Q6 Agents in the Agent menu.** Today the Agent menu lists the person's agents as profiles even with the switch off (spec 043). (a) Keep that unchanged; (b) with the switch on, also mark which agents are offered as helpers. **Recommended: (a)** now; (b) as a later small change if asked. **Answered 2026-11-09 (Vikram): (a)** (the recommended default).

## Assumptions

- The owner's decisions above settle global vs per folder (global) and the person's files' trust (none needed). Everything else follows issue #840's constraints.
- Spec 012 Q8 and spec 043 FR-008 are not reversed: settings files stay off; this feature passes the two kinds of content itself, as the folder `CLAUDE.md` already is.

## Changes

- **2026-11-09, owner answers.** Vikram (Telegram 07:24 UTC, "All ok") accepted the recommended default of Q1..Q6, all (a): `@~/` resolved and still contained (FR-005); the FR-005 off-limits list plus dot segments; Read-only keeps refusing delegation; one shared 64 KB budget with the folder's file first (FR-009); an older Claude Code gets nothing and the row names the version (FR-016); the Agent menu is unchanged. T002 is done; no group waits for an answer. Review findings on PR #1366 are handled separately.

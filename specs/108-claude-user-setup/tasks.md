# Tasks: 108 Your own Claude Code instructions and agents

**Input**: [spec.md](spec.md), [plan.md](plan.md). **Tests first**, 0 AI credits, simulator and fake CLI only. One PR per group (G1..G5); a task is one issue (#840 is the umbrella and stays open until T012). Numbers checked against `main`, remote branches and open PRs on 2026-11-09. Every UI group adds simulator screenshots at 1440x900 and 1280x800, a changelog fragment, its `docs/feature-inventory.md` row and the touched `docs/` pages; the README *Claude Code* row and *Safety model* change in G4.

## Spec

- [ ] T001 Spec, plan, tasks and specs-index block (`specs/108-claude-user-setup/`). Test: `npm run specs:check`, `npm run rules:check`, `npm test`.

## G0: owner answers

- [x] T002 [G0] Owner answers Q1..Q6 (all (a), Vikram, 2026-11-09 07:24 UTC) (spec Clarifications); record each with its date in spec.md and adjust FR-005, FR-009, FR-016 and the Read-only note. Test: `npm run specs:check`. Blocks: G1 for Q1, Q2, Q4; G2 for Q3, Q5; G3 for Q6.

## G1: readers (no launch change yet)

- [ ] T003 [G1] `claudeMdPrompt`: root kind (folder or user Claude folder), the user heading, FR-005's four steps (steps 1-2 for both root kinds, switch on or off; text check before any fs call: `\\`, `//`, `:`, NUL refused, inside by `path.relative`; `realpath` failure skips; real-path rules case-folded with Windows trailing dot/space and 8.3 short names refused; ticked), Q1's `@~/` rule, FR-041's one-open capped read, one budget across both calls with the folder first and the cut marker. Test first: `test:claudemd` cases in both path flavours with a recording `io` (step-1 refusals make no fs call; `rules.md -> .credentials.json` refused; `PROJEC~1` refused; `projects/x/memory/a.md` never offered; unticked import left as text; swap between `lstat` and read skipped; a folder `CLAUDE.md` importing `//server/x.md`, `C:x.md` or `../outside.md` refused with no fs call, switch off). Mutants: steps 1-2 for the person's root only; containment only after `realpath`; `.md` rule on the token; unresolved path on `realpath` failure; short-name rule dropped [FR-003, FR-004, FR-005, FR-009, FR-018, FR-028, FR-041, FR-043]
- [ ] T004 [G1] `claudeAgents.ts`: FR-041's read (no-follow open or dev/inode compare, `fstat` on the handle, at most 64 KB + 1 bytes, parse that buffer) replacing `lstat`-then-read (`:49-51`); a linked `agents` folder followed only under FR-043's six rules (link text checked before `realpath`, home, no dot folder or `Library`/`AppData`, an offered place when inside the Claude folder, the role, one `O_NOFOLLOW` open with ownership by `fstat` on the handle and the `/proc/self/fd` path check on Linux), shown with its masked target and unticked; reserved names; `subAgentsArg(defs, profile?)` with ticked user agents and the session folder's ticked, confirmed agents (hash of the bytes parsed), four keys (three for a folder agent: no `model`), null-prototype; clash order (profile, folder, user); skip and cut counts; `parseFrontMatter` null-prototype maps. Test first: `test:claudeagents` hostile fixtures, swap-in-between fixtures, FR-043's link fixtures (`~/dotfiles/agents` and `~/Documents/claude-agents` followed; `~/.ssh`, `agents/x.md -> ~/.ssh/id_rsa`, `~/.claude/projects/p/memory`, `~/Library/x`, `~/AppData/Roaming/x`, `/etc/passwd`, a UNC or other-drive link text (no `realpath` call), a chain of nine, another uid on the handle, a parent swap (Linux), a chain into `~/.aws`, a swap to a link before open, win32 short names refused); a folder agent with `model:` has none in the definition; a two-folder session gets both folders' helpers; folder agents: ticked + confirmed in, unticked / unconfirmed / changed / linked / other folder out; `test:slash` unchanged. Mutants: offer a confirmed but unticked folder agent; hash a second read; offer a folder agent to a session whose folders do not include it; pass a folder agent's `model`; skip the ownership check; check ownership with `stat` on the path; call `realpath` before the link-text check; drop the `Library`/`AppData` rule; skip FR-004 for a target inside the Claude folder; drop the `/proc/self/fd` check; skip the dot-folder rule; follow a target outside home; open the target without `O_NOFOLLOW`; `{}` assignment; extra key passes; read by path after `lstat` [FR-010, FR-012, FR-013, FR-014, FR-018, FR-041, FR-043, FR-046, FR-051]

## G2: launch

- [ ] T005 [G2] R1/R2 research (free `--help` probes and the vendor CHANGELOG, no session): the first Claude Code version with `--agents <file>` and `--append-system-prompt-file`; record as `read:` in spec.md and set the gate constant. Test: none (research), the facts written with their source [FR-016, FR-027]
- [ ] T006 [G2] `StartOptions.userSetup` (`on`, ticked names, ticked and confirmed folder-agent triples of this session's folders), filled by main from `SettingsStore`, `FolderStore` and `AgentTrustStore` for Claude sessions at start and relaunch; other adapters ignore it. Test first: start-option tests (off: absent; on: ticked names only; folder triples only for this session's folders and only when confirmed; Copilot/Codex unchanged) [FR-014, FR-019, FR-031]
- [ ] T007 [G2] `ClaudeAdapter.launch` / `claudeArgs` / `cliLaunchArgs`: read only when on; private `instructions.md` and `agents.json` beside `mcp-config.json` (`0600`, `wx`, removed at exit, swept at quit); `--append-system-prompt-file` and `--agents <file>`, `--agent` only with a profile; version gate sends nothing on an old or unknown version; `--setting-sources ""` and every permission flag unchanged. Test first: fake CLI launch tests for SC-001, SC-002, SC-004, file lifetime, the gate, Read-only note per Q3, `tools: ["*"]` / absent / `["Bash"]` in Read-only keep the permission flags equal on and off, a model `claudeModelFlag` refuses is dropped, a new unticked agent file not sent, stderr through `redact` with launch-file paths masked. Mutants: version gate dropped; file content back on argv; a permission flag differs between on and off; an agent's tools copied into `--allowedTools`; send a new unticked file [FR-006, FR-007, FR-008, FR-011, FR-015, FR-016, FR-017, FR-022, FR-023, FR-033]
- [ ] T008 [G2] Named helpers: a fake stream with `subagent_type: "analyst"`, a folder agent `deploy` (Q7 B), and a hostile, token-shaped name shows *Helper · analyst* and a masked name in Flat, Real office and Retro. Test: `test:helpercard` case and `check-015-bg-helper` step with a named agent [FR-024, spec 015 FR-021]

## G3: Settings

- [ ] T009 [G3] Setting: `AppSettings.claudeUserSetup`, `SettingsStore` getter and setter, `settings:setClaudeUserSetup` through `setting()`, `settings:get`, preload and `api.ts`. Test first: `test:settings` (off by default, junk refused, off not written, failed write not "Saved") [FR-001]
- [ ] T010 [G3] Preview channel `settings:claudeUserSetupPreview` (`fromAppFrame`, no arguments, `simguard` fixture under `DURBAR_SIM`, offered items with masked name, size, masked first line or description cut to 80, *New*/*Missing*/*Not allowed now*; skipped counts by reason with no path; nothing cached), `settings:setClaudeUserSetupItems`, `AppSettings.claudeUserSetupItems`, and the Settings row under Agent apps > Claude Code: label, sentence, masked Claude folder, the *What Claude gets* checklist (FR-030 sentences, nothing ticked on switch-on, *Pick for me*, *Select all*, *Select none*, *Check what loads*), status region, "Needs Claude Code …" and Read-only notes; sim bridge. Test first: `test:ipcchannels`; preview shape test with the leak fixture (token on line 1 masked, line 2 never, outside import path never); `test:settings` for the names (65 names, `../x.md`, `projects/a.md`, `.hidden/a.md`, `C:x.md` refused by text, no preview state in main; switch-on = empty); the FR-049 hiding rule unit test (keywords any case, `key=value`, `key: value`; a plain sentence and `# heading` shown) and the leak fixture's `password: hunter2` first line hidden; a description `<img src=x onerror=...>` shown as literal text with no element created; no read on opening Settings (recording `io`); `scripts/check-108-settings.js` at both sizes in Open office, Real office and Retro arcade (keyboard order, native checkboxes named and described, *Pick for me* / *Select all* / *Select none*, polite count, 64 rows scroll inside, no overlap, 10.5 px floor). Mutants: description returned unmasked; two lines returned; outside imports listed by path; a name outside FR-004's patterns accepted; everything ticked on switch-on; the key-value shape dropped; keywords case-sensitive; the hiding rule applied after the cut; a description rendered with `innerHTML` [FR-049, FR-050, FR-002, FR-020, FR-021, FR-024, FR-025, FR-026, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035, FR-036, FR-037]

- [ ] T013 [G2] SDK transport (`claudeSdk.ts:93`): user content only through `extraArgs` file flags under its own version gate, else nothing; never `systemPrompt.append`. Test first: SDK options test (switch on: no user text in `systemPrompt.append`; `extraArgs` holds file paths only, or neither). Mutant: user text in `systemPrompt.append` [FR-042]
- [ ] T014 [G2] Start-up sweep of stale private folders (Durbar prefix, this user's, not live) before any session launches. Test first: `test:privatedirs` (stale own folder removed; another user's, a non-prefixed and a live one kept). Mutant: sweep only at quit [FR-038, FR-044]
- [ ] T015 [G3] Session line "Your setup: ..." from the launch's counts (in memory), with the resume note. Test first: adapter launch result carries counts; driver shows the line in the chat's session details. Mutant: line from the current switch instead of the launch [FR-039, FR-027]

- [ ] T016 [G3] Folder agents as helpers (Q7 B): the Agent menu's "Helper in this folder's Claude sessions" box, the checklist's **From your folders** group (unticked, "from a folder: <name>", masked first line, *Waits for confirmation*), ticks saved per folder in `durbar-folders.json` (ids only), spec 043's confirmation opened first with the "comes from the folder", "can steer" and "session's model" sentences, its text shown as text only with secret-looking lines hidden; trust bound to the bytes shown (the dialog gets the masked text and SHA-256 of one FR-041 read; on confirm main re-reads and trusts only if the fresh hash equals the shown one); *Pick for me* and *Select all* never tick them. Test first: `test:folders` (ids only, junk refused, 50 cap); `test:agenttrust` / profiles IPC (file changed between showing and confirming not trusted; a hash the window was never shown refused); `check-108-settings` (menu and checklist agree, confirmation text, keyboard and screen reader). Mutants: *Select all* ticks folder agents; a tick saved without the confirmation; re-hash at confirm time and trust that hash without comparing it to the shown one; trust a hash the window sent [FR-014, FR-045, FR-047, FR-048, FR-049]

## G4: docs

- [ ] T011 [G4] README *Claude Code* row and *Safety model* (what the switch reads and never reads), `docs/safety.md`, `docs/features.md`, `docs/limits.md` (FR-027..FR-029, FR-044, FR-046, FR-048, FR-050, FR-051), `docs/feature-inventory.md` row (all three worlds), Settings screenshots through `npm run shots:docs`, changelog fragment; spec 012 and spec 043 get dated `## Changes` lines pointing here (Q8 not reversed, and the folder `CLAUDE.md` reader gains FR-005 steps 1-2; FR-008 extended, and the confirmation binds trust to the bytes shown, FR-047). Test: `npm test` (docs checks), `npm run shots:docs` pictures looked at [FR-024, FR-027, FR-028, FR-029, FR-048, FR-050, FR-051]

## G5: real check (needs the owner's OK; not run by an agent without it)

- [ ] T012 [G5] `real:` on the owner's Mac, 1-2 prompts on a cheap model, with the owner's written OK and after saying what it costs: switch on, a session in Ask first asks the main agent to hand a small read task to `analyst`; check the helper shows *Helper · analyst*, its tool call asks through Durbar's card, a `tools`-narrowed agent cannot call a tool outside its list, the private files are gone after exit, and the switch off gives today's flags. Record results (version, cost) in spec.md and resolve FR-027's items. Test: the run itself [FR-011, FR-015, FR-016, FR-027, FR-029, SC-006]

## Coverage (analyze, by hand)

| FR | Task |
|---|---|
| FR-001 | T009 |
| FR-002 | T010 |
| FR-003, FR-004, FR-005 | T003 |
| FR-006, FR-007, FR-008 | T007 |
| FR-009 | T003 |
| FR-010, FR-012, FR-013 | T004 |
| FR-011 | T007, T012 |
| FR-014 | T004, T006, T016 |
| FR-045 | T016 |
| FR-046 | T004, T011 |
| FR-047 | T016 |
| FR-048 | T016, T011 |
| FR-049 | T010, T016 |
| FR-050 | T010, T011 |
| FR-051 | T004, T011 |
| FR-015 | T007, T012 |
| FR-016, FR-017 | T005, T007 |
| FR-018 | T003, T004 |
| FR-019 | T006 |
| FR-020, FR-021 | T010 |
| FR-022, FR-023 | T007 (and T010's leak fixture) |
| FR-024 | T008, T010, T011 |
| FR-025, FR-026 | T010 |
| FR-027 | T005, T011, T012, T015 |
| FR-030..FR-037 | T010 |
| FR-038 | T014 |
| FR-039 | T015 |
| FR-041 | T003, T004 |
| FR-042 | T013 |
| FR-043 | T003, T004 |
| FR-044 | T014 |
| FR-028 | T003, T011 |
| FR-029 | T011, T012 |

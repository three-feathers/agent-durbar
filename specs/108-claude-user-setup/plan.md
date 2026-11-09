# Implementation Plan: Your own Claude Code instructions and agents (spec 108)

**Branch**: `108-claude-user-setup` (spec) | **Date**: 2026-11-09 | **Spec**: [spec.md](spec.md) | **Issue**: #840

## Summary

One boolean setting (off by default) makes the Claude adapter, at each CLI launch, extend the two readers it already has: `claudeMdPrompt` reads the person's `CLAUDE.md` from the Claude folder with a stricter import filter and a shared budget, and `claudeAgents.ts` builds one multi-entry `--agents` definition from the person's ticked agents and the session folder's ticked, confirmed agents (Q7 B). Only the items the person ticked in a Settings checklist are read at launch (Q2 changed 2026-11-09 07:40 UTC to an allow-list; nothing ticked by default). Both go to Claude through private `0600` files (`--append-system-prompt-file`, `--agents <file>`), never the command line, gated on a known Claude Code version. Settings gets one switch and a checklist of offered items (name, size, masked first line, one sentence each; *Pick for me*, *Select all*, *Select none*). Every read is one no-follow open checked on the handle and capped; imports are checked by text before any fs call; the SDK transport uses the same files or sends nothing; stale private folders are swept at start; each session shows what it got. No new dependency.

## Technical context

- **Language**: TypeScript (adapter, main, shared), plain JS (renderer `screens.js`).
- **Dependencies**: none new.
- **Storage**: two keys in `durbar-settings.json`: `claudeUserSetup: true` or absent, and `claudeUserSetupItems` (at most 64 names relative to the Claude folder, FR-031). No content, hash or absolute path.
- **Testing**: Node unit tests in `npm test` (`test:claudemd`, `test:claudeagents`, `test:settings`, `test:ipcchannels`, the fake CLI launch tests); simulator driver at both sizes. Zero AI credits; one `real:` check (T012) only with the owner's OK.
- **Platforms**: Windows, macOS, Linux; containment tests in both `path.posix` and `path.win32` flavours.

## Existing capability check (spec 021 FR-031)

| Need | Existing | Use |
|---|---|---|
| Read CLAUDE.md with imports, contained, budgeted | `claudeMdPrompt`, `ClaudeMdIo`, `CLAUDE_MD_MAX_CHARS`, `CLAUDE_MD_MAX_DEPTH` (`src/adapters/claude.ts`) | Extend: root kind, heading, import filter, shared budget. No second loader. |
| Read agent files, capped, named | `listClaudeAgents`, `parseClaudeAgent`, `agentsArg`, caps (`src/adapters/claudeAgents.ts`), `parseFrontMatter` (`slashcommands.ts`) | Extend: `subAgentsArg`, SHA-256 of bytes read, null-prototype maps. |
| Claude folder location | `claudeConfigDir` (`claudeHistory.ts`), `ClaudeAdapterDeps.configDir` | Reuse as is. |
| Folder agent trust | `AgentTrustStore`, `hashAgentFile` (`src/main/agenttrust.ts`), spec 043 FR-003 confirmation in `ipc/profiles.ts` | Reuse for helpers (Q7 B): main passes ticked, confirmed (folder, id, sha) triples; the confirmation dialog gains the "from the folder" sentence; the Agent menu gains the helper box (FR-045). |
| Private folder sweep | `sweepPrivateDirs` (`privatedirs.ts`, called at `will-quit`) | Extend: a start-up sweep of stale folders with Durbar's prefix owned by this user (FR-038). |
| SDK options | `sdkOptions` in `claudeSdk.ts` (`:93` `systemPrompt.append`, `extraArgs`) | Extend: file flags through `extraArgs` or nothing (FR-042). |
| Private launch files | `privateMcpConfig`, `makePrivateDir`, `sweepPrivateDirs` (`claude.ts`, `privatedirs.ts`) | Reuse the pattern for two more files in the same private folder. |
| Version gate | `claudeForwardsSubagentText`, `CLAUDE_FORWARD_SUBAGENT_MIN_VERSION`, `compareVersions`, `sandboxFactsNow().version` | Same pattern, own constant. |
| Named helpers | `ClaudeMapper` `subagent` event `agentName`; `app.js` *Helper · name*, `helperMask` (spec 015 FR-021) | Reuse; test only. |
| Setting | `SettingsStore`, `AppSettings`, `setting()` in `ipc/settings.ts`, preload, `sw()` in `screens.js`, `settingsnav.js` | Reuse (*Diagnostics* pattern). |
| Masking | `redact.ts` (`maskTokenShapes`, `maskHomePaths`, `cut`) | Reuse. |

## Module layout

| File | Change | Spec |
|---|---|---|
| `src/shared/credits.ts` | `AppSettings.claudeUserSetup?: true`; `parseSettings` keeps only `true` | FR-001 |
| `src/main/settings.ts` | `get claudeUserSetup`, `setClaudeUserSetup(v)` (boolean only, `Saved`) | FR-001 |
| `src/main/ipc/settings.ts` | `settings:setClaudeUserSetup` and `settings:setClaudeUserSetupItems(names[])` via `setting()` (names validated by text against FR-004's patterns only; main keeps no preview state, FR-020, FR-031); `settings:get` adds both | FR-001, FR-031 |
| `src/adapters/privatedirs.ts` | `sweepStalePrivateDirs(tmpRoot, prefix, uid)` called by main at start before any launch | FR-038 |
| `src/adapters/claudeSdk.ts` | user content only through `extraArgs` file flags, or nothing; never `systemPrompt.append` | FR-042 |
| `src/main/ipc/claudesetup.ts` (new, small) | `settings:claudeUserSetupPreview`: `fromAppFrame`, takes no arguments, `simguard` under `DURBAR_SIM` (fixture folder), returns FR-020's shape; registered in `test:ipcchannels`; never in `durbar-mcp` | FR-020, FR-021 |
| `src/adapters/types.ts` | `StartOptions.userSetup?: { on: true; items: string[]; folderAgents: { folderKey: string; id: string; sha256: string }[] }`; the launch result carries the counts for the session line | FR-019, FR-039 |
| `src/main/main.ts` / start-option path (`startopts.ts` caller) | fill `userSetup` from `SettingsStore` (switch, ticks), `FolderStore` (per-folder helper ticks) and `AgentTrustStore` (confirmed hashes) for Claude sessions at start and relaunch, folder agents only for the session's own folders; call the start-up sweep before any session launches | FR-019, FR-038 |
| `src/adapters/claude.ts` | `claudeMdPrompt` root kind + FR-005's four steps (steps 1-2 for both root kinds, switch on or off) (text, `realpath`, real-path rules, ticks) + shared budget + FR-041's one-open capped read; `ClaudeLaunch.appendSystemPromptFile`, `agentsFile`; `claudeArgs` passes `--append-system-prompt-file` / `--agents <file>` (no `--agent` unless a profile); `cliLaunchArgs` writes the private files beside the MCP config; version constant and gate; `launch` reads only when `o.userSetup?.on` | FR-005..FR-011, FR-015..FR-018 |
| `src/adapters/claudeAgents.ts` | FR-041's read (no-follow open, `fstat` on the handle, cap + 1 bytes) replacing `lstat` then read by path (`:49-51`); `subAgentsArg(defs, profile?)` for ticked user agents only; reserved names, null-prototype output; a folder agent's entry has no `model`; FR-043's six link rules (link text before `realpath`, home, no dot folder / `Library` / `AppData`, an offered place inside the Claude folder, the role, checks on the open handle with `/proc/self/fd` on Linux) | FR-010..FR-014, FR-041, FR-043, FR-051 |
| `src/main/ipc/profiles.ts`, `src/main/agenttrust.ts` | the folder-agent confirmation reads once by FR-041, sends the dialog the masked text and SHA-256 of that buffer (secret-looking lines hidden), and on confirm re-reads and trusts only if the fresh hash equals the shown one | FR-047, FR-049 |
| `src/adapters/slashcommands.ts` | `parseFrontMatter` maps become null-prototype (behaviour for slash entries otherwise unchanged) | FR-013 |
| `src/preload/preload.ts`, `src/shared/api.ts` | `setClaudeUserSetup`, `claudeUserSetupPreview` | FR-001, FR-020 |
| `src/renderer/screens.js` | the row under Agent apps > Claude Code, the *What Claude gets* checklist (fieldset, boxes, sentences, *Pick for me*, *Select all*, *Select none*, *Check what loads*), status region; the session line in the chat's session details; every string from the files set with `textContent` only; the hiding rule for secret-looking first lines (a shared pure helper in `src/shared`, used by main for the preview and the dialog) | FR-002, FR-020, FR-025, FR-030..FR-036, FR-039, FR-049 |
| `src/renderer/sim.ts` | fake bridge for both calls from the fixture | FR-026 |

**IPC**: three new window channels, all `fromAppFrame`: `settings:setClaudeUserSetup(boolean)` (non-boolean refused), `settings:setClaudeUserSetupItems(names[])` (relative names only, each matching FR-004's patterns and offered by the last preview; anything else refused) and `settings:claudeUserSetupPreview()` (any argument ignored). None accepts an absolute path or file text from the window.

**Data flow at launch** (switch on): main → `StartOptions.userSetup` (boolean + ticked names) → `ClaudeAdapter.launch` → readers (allow-list, caps) → private folder (`mcp-config.json`, `instructions.md`, `agents.json`, all `0600`, `wx`) → argv holds only file paths → files removed at CLI exit.

## Constitution check

- **I Spec Kit**: this spec, plan and tasks before any `src/` code. Pass.
- **II Adapters**: the option is adapter-neutral (`userSetup`), all Claude specifics stay in `claude.ts` / `claudeAgents.ts`; Copilot and Codex ignore it. Pass.
- **III Safe by default**: off by default; allow-list of files; contained imports; no persistence, logs or unmasked display; no widening; private files not argv; folder agents keep per-file trust. Pass; the owner answered Q1..Q6 on 2026-11-09 (recommended defaults).
- **IV No credits**: fixtures, fake CLI, simulator; the one `real:` check (T012) is listed and waits for the owner's OK. Pass.
- **V Calm UI**: one row, existing switch control, text at least 10.5 px, both sizes. Pass.
- **VI Platforms**: `os.homedir()`, `CLAUDE_CONFIG_DIR`, `path`/`realpath`, both path flavours in tests; Windows and macOS real runs are `[KNOWN GAP]` (FR-029). Pass with the gap stated.
- **VII Quality gates**: unit tests with mutants for the allow-list, containment, reserved names and the off path; typecheck, build, `npm test`. Pass.
- **VIII Honest limits**: FR-027..FR-029 and the `read:` source of every vendor fact. Pass.

## Research (before G2; free, no session)

- R1: `claude --help` on the installed version: `--agents <json-or-file>` ("with --print the path to a file"), `--append-system-prompt[-file]` (`read:` 2.1.319, 2026-11-09). Find the first version that has both (Claude Code CHANGELOG, as spec 015 FR-016 did) for the gate constant (Q5).
- R2: whether `--agents <file>` needs `--print` (Durbar always passes `-p`) and how it reports a malformed file (fake CLI cannot tell; vendor docs only, `read:`).

## Test plan (zero AI credits)

- **Mutants for Q7 B and Q8 B**: offer a confirmed but unticked folder agent; hash a second read; *Select all* ticks folder agents; offer a folder agent to a session whose folders do not include it; save a tick without the confirmation; skip the ownership check; follow a target outside home; *Pick for me* ticks linked items; open a link target without `O_NOFOLLOW`.
- **Mutants for Paco's round-2 A..G**: A re-hash at confirm time and trust that hash without comparing it to the shown one; trust a hash the window sent but main never showed. B apply FR-005 steps 1-2 to the person's root only. C drop the `Library`/`AppData` rule; skip FR-004 for a target inside the Claude folder; skip the dot-folder rule. D call `realpath` before the link-text check; check ownership with `stat` on the path instead of `fstat` on the handle; drop the `/proc/self/fd` check. E pass a folder agent's `model`. F accept a ticked name outside FR-004's patterns. G drop the key-value shape; keywords case-sensitive; apply the hiding rule after the cut; render a description with `innerHTML`.
- **Mutants** (review 10; each must fail a named assertion, a compile error does not count): T003 containment checked only after `realpath`; `.md` rule on the token; unresolved path used when `realpath` fails; short-name rule dropped. T004 confirmed folder agents included; `{}` assignment; extra key passes; read by path after `lstat`. T007 version gate dropped; file content put back on argv; a permission flag that differs between on and off; an agent's tools copied into `--allowedTools`; send a new unticked file. T013 SDK user text in `systemPrompt.append`. T010 the description returned unmasked or two lines returned; outside imports listed by path; accept a name outside FR-004's patterns; tick everything on switch-on; a secret-looking first line shown. T014 sweep only at quit. T015 session line from the current switch instead of the launch.
- `test:claudemd`: user root with fixtures: allowed import, `../` escape, symlink escape (posix and win32 flavour), `.json`/`.jsonl`/credentials import refused, data folders refused, dot segment refused, depth 4, cycle, budget shared with folder first, cut marker, heading order, `@~/` per Q1 (answered (a)). Mutants: containment off, `.md` rule off, budget not shared, folder cut by the user file.
- `test:claudeagents`: multi-entry JSON, no `--agent` without profile, profile kept, clash order, reserved names, `__proto__` front matter, 10,000-line front matter, binary and invalid UTF-8, never-closed front matter, oversize skip, prompt cut, over-50 count, only four keys pass, hash of the bytes parsed, unconfirmed and changed folder agents left out. Mutants: extra key passes, `{}` assignment, folder agent without trust.
- Launch tests on the fake CLI: switch off = today's argv exactly (SC-001); switch on = file paths only, files `0600`, gone after exit; permission flags equal on and off in every mode (SC-004); old or unknown version sends nothing.
- `test:settings`: off by default, junk refused, off not written. `test:ipcchannels`: both channels listed, window-only.
- Leak test (SC-002): fake token values in fixture `.credentials.json`/`settings.json` and in an agent name never appear in argv, launch files beyond the allowed content, preview result, debug sink, settings file.
- Simulator: `scripts/check-108-settings.js` at 1440x900 and 1280x800 in Open office, Real office and Retro arcade: the row, keyboard order, status announcements, preview list, no overlap; screenshots retaken with `npm run shots:docs`.

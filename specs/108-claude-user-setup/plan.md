# Implementation Plan: Your own Claude Code instructions and agents (spec 108)

**Branch**: `108-claude-user-setup` (spec) | **Date**: 2026-11-09 | **Spec**: [spec.md](spec.md) | **Issue**: #840

## Summary

One boolean setting (off by default) makes the Claude adapter, at each CLI launch, extend the two readers it already has: `claudeMdPrompt` reads the person's `CLAUDE.md` from the Claude folder with a stricter import filter and a shared budget, and `claudeAgents.ts` builds one multi-entry `--agents` definition from the person's agents and the session folders' confirmed agents. Both go to Claude through private `0600` files (`--append-system-prompt-file`, `--agents <file>`), never the command line, gated on a known Claude Code version. Settings gets one switch and an on-request preview of names, sizes and counts. No new dependency.

## Technical context

- **Language**: TypeScript (adapter, main, shared), plain JS (renderer `screens.js`).
- **Dependencies**: none new.
- **Storage**: one key in `durbar-settings.json` (`claudeUserSetup: true` or absent). Nothing else.
- **Testing**: Node unit tests in `npm test` (`test:claudemd`, `test:claudeagents`, `test:settings`, `test:ipcchannels`, the fake CLI launch tests); simulator driver at both sizes. Zero AI credits; one `real:` check (T012) only with the owner's OK.
- **Platforms**: Windows, macOS, Linux; containment tests in both `path.posix` and `path.win32` flavours.

## Existing capability check (spec 021 FR-031)

| Need | Existing | Use |
|---|---|---|
| Read CLAUDE.md with imports, contained, budgeted | `claudeMdPrompt`, `ClaudeMdIo`, `CLAUDE_MD_MAX_CHARS`, `CLAUDE_MD_MAX_DEPTH` (`src/adapters/claude.ts`) | Extend: root kind, heading, import filter, shared budget. No second loader. |
| Read agent files, capped, named | `listClaudeAgents`, `parseClaudeAgent`, `agentsArg`, caps (`src/adapters/claudeAgents.ts`), `parseFrontMatter` (`slashcommands.ts`) | Extend: `subAgentsArg`, SHA-256 of bytes read, null-prototype maps. |
| Claude folder location | `claudeConfigDir` (`claudeHistory.ts`), `ClaudeAdapterDeps.configDir` | Reuse as is. |
| Folder agent trust | `AgentTrustStore`, `hashAgentFile` (`src/main/agenttrust.ts`), spec 043 FR-003 confirmation in `ipc/profiles.ts` | Reuse: main passes confirmed (id, sha) pairs; confirmation UI unchanged. |
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
| `src/main/ipc/settings.ts` | `settings:setClaudeUserSetup` via `setting()`; `settings:get` adds `claudeUserSetup` | FR-001 |
| `src/main/ipc/claudesetup.ts` (new, small) | `settings:claudeUserSetupPreview`: `fromAppFrame`, takes no arguments, `simguard` under `DURBAR_SIM` (fixture folder), returns FR-020's shape; registered in `test:ipcchannels`; never in `durbar-mcp` | FR-020, FR-021 |
| `src/adapters/types.ts` | `StartOptions.userSetup?: { on: true; confirmedFolderAgents: { id; sha256 }[] }` | FR-019 |
| `src/main/main.ts` / start-option path (`startopts.ts` caller) | fill `userSetup` from `SettingsStore` and `AgentTrustStore` for Claude sessions at start and relaunch | FR-014, FR-019 |
| `src/adapters/claude.ts` | `claudeMdPrompt` root kind + filter + shared budget; `ClaudeLaunch.appendSystemPromptFile`, `agentsFile`; `claudeArgs` passes `--append-system-prompt-file` / `--agents <file>` (no `--agent` unless a profile); `cliLaunchArgs` writes the private files beside the MCP config; version constant and gate; `launch` reads only when `o.userSetup?.on` | FR-005..FR-011, FR-015..FR-018 |
| `src/adapters/claudeAgents.ts` | `readClaudeAgentsWithHash`, `subAgentsArg(defs, profile?)`, reserved names, null-prototype output | FR-010..FR-014 |
| `src/adapters/slashcommands.ts` | `parseFrontMatter` maps become null-prototype (behaviour for slash entries otherwise unchanged) | FR-013 |
| `src/preload/preload.ts`, `src/shared/api.ts` | `setClaudeUserSetup`, `claudeUserSetupPreview` | FR-001, FR-020 |
| `src/renderer/screens.js` | the row under Agent apps > Claude Code, preview list, status region | FR-002, FR-020, FR-025 |
| `src/renderer/sim.ts` | fake bridge for both calls from the fixture | FR-026 |

**IPC**: two new window channels, both `fromAppFrame`: `settings:setClaudeUserSetup(boolean)` (non-boolean refused) and `settings:claudeUserSetupPreview()` (any argument ignored). Neither accepts a path, name or text from the window.

**Data flow at launch** (switch on): main → `StartOptions.userSetup` (boolean + confirmed pairs) → `ClaudeAdapter.launch` → readers (allow-list, caps) → private folder (`mcp-config.json`, `instructions.md`, `agents.json`, all `0600`, `wx`) → argv holds only file paths → files removed at CLI exit.

## Constitution check

- **I Spec Kit**: this spec, plan and tasks before any `src/` code. Pass.
- **II Adapters**: the option is adapter-neutral (`userSetup`), all Claude specifics stay in `claude.ts` / `claudeAgents.ts`; Copilot and Codex ignore it. Pass.
- **III Safe by default**: off by default; allow-list of files; contained imports; no persistence, logs or unmasked display; no widening; private files not argv; folder agents keep per-file trust. Pass, pending the owner's Q1..Q5.
- **IV No credits**: fixtures, fake CLI, simulator; the one `real:` check (T012) is listed and waits for the owner's OK. Pass.
- **V Calm UI**: one row, existing switch control, text at least 10.5 px, both sizes. Pass.
- **VI Platforms**: `os.homedir()`, `CLAUDE_CONFIG_DIR`, `path`/`realpath`, both path flavours in tests; Windows and macOS real runs are `[KNOWN GAP]` (FR-029). Pass with the gap stated.
- **VII Quality gates**: unit tests with mutants for the allow-list, containment, reserved names and the off path; typecheck, build, `npm test`. Pass.
- **VIII Honest limits**: FR-027..FR-029 and the `read:` source of every vendor fact. Pass.

## Research (before G2; free, no session)

- R1: `claude --help` on the installed version: `--agents <json-or-file>` ("with --print the path to a file"), `--append-system-prompt[-file]` (`read:` 2.1.319, 2026-11-09). Find the first version that has both (Claude Code CHANGELOG, as spec 015 FR-016 did) for the gate constant (Q5).
- R2: whether `--agents <file>` needs `--print` (Durbar always passes `-p`) and how it reports a malformed file (fake CLI cannot tell; vendor docs only, `read:`).

## Test plan (zero AI credits)

- `test:claudemd`: user root with fixtures: allowed import, `../` escape, symlink escape (posix and win32 flavour), `.json`/`.jsonl`/credentials import refused, data folders refused, dot segment refused, depth 4, cycle, budget shared with folder first, cut marker, heading order, `@~/` per Q1. Mutants: containment off, `.md` rule off, budget not shared, folder cut by the user file.
- `test:claudeagents`: multi-entry JSON, no `--agent` without profile, profile kept, clash order, reserved names, `__proto__` front matter, 10,000-line front matter, binary and invalid UTF-8, never-closed front matter, oversize skip, prompt cut, over-50 count, only four keys pass, hash of the bytes parsed, unconfirmed and changed folder agents left out. Mutants: extra key passes, `{}` assignment, folder agent without trust.
- Launch tests on the fake CLI: switch off = today's argv exactly (SC-001); switch on = file paths only, files `0600`, gone after exit; permission flags equal on and off in every mode (SC-004); old or unknown version sends nothing.
- `test:settings`: off by default, junk refused, off not written. `test:ipcchannels`: both channels listed, window-only.
- Leak test (SC-002): fake token values in fixture `.credentials.json`/`settings.json` and in an agent name never appear in argv, launch files beyond the allowed content, preview result, debug sink, settings file.
- Simulator: `scripts/check-108-settings.js` at 1440x900 and 1280x800 in Open office, Real office and Retro arcade: the row, keyboard order, status announcements, preview list, no overlap; screenshots retaken with `npm run shots:docs`.

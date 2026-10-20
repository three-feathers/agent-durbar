# Spec 061: A folder's own agent setup is used, and shown

**Status:** draft. Owner decisions recorded (issue #289, 2026-10-20). Constitution **Amendment 1** (principle III, v1.1.0), asked for by the owner in the session on 2026-10-20, is made in this PR; next: research R1-R3, then plan and tasks.
**Issue:** #289 (was spec 012 T083, `[KNOWN GAP]`). **Builds on:** 012 (Claude and Codex adapters), 019 (MCP), 043 (custom agents), 041/019 (secret masking), 003 (permission modes).

## Owner decisions (issue #289, 2026-10-20)

- **Q1 → a:** "there is no need to force users to add it by hand, it is a bad experience. If the user has them in the folder, it is for a reason. Show them to the user when a folder is added, for their awareness; **enabled by default**, and the user can opt out."
- **Q2 → b:** "hooks are functionality; if they are in the folder, **let them run**, else we are blocking real functionality."
- **Q3:** "**follow the permission rules**, and show them to the user when the folder is added, for awareness."
- **Q4 → yes:** "the same for all agent apps; our goal is **transparency, not restriction**."

## Today

Durbar starts every agent app so that a folder's own agent configuration does not apply:

- **Claude Code:** `--setting-sources ""`, `--strict-mcp-config` with Durbar's `--mcp-config`. Checked on a real session on 2026-10-20 (#352): the folder's hooks did not run and its `.mcp.json` server did not start.
- **Codex** and **Copilot:** not checked for each file. Durbar passes its own MCP servers and permission mode; whether each runtime reads the folder's own files under Durbar is part of this spec's research (R1-R3).

What Durbar already uses from a folder: `CLAUDE.md` and `AGENTS.md` (instructions), and `.claude/agents/*.md` in the agent picker after a per-file confirmation (spec 043).

## What each agent app reads from a folder

`read:` strings in the installed runtimes and their docs, 2026-10-20; to confirm in R1-R3.

| Agent app | MCP servers | Hooks | Permission rules and settings | Other |
|---|---|---|---|---|
| Claude Code 2.1.304 | `.mcp.json` | `.claude/settings.json` → `hooks` | `.claude/settings.json`, `.claude/settings.local.json` → `permissions.allow/deny/ask`, `env` | `.claude/agents/`, `.claude/skills/`, `CLAUDE.md` |
| Codex 0.163 | `.mcp.json` (mentioned in the binary) and `.codex/config.toml` → `mcp_servers` | `.codex/hooks.json` | `.codex/config.toml` (applied only when the project is trusted: `projects."<path>".trust_level`) | `.codex/agents/`, `.codex/skills/`, `AGENTS.md` |
| Copilot (SDK runtime) | `.mcp.json` | `hooks.json` | `.github/copilot/settings.json`; a `trustedFolders` list | `.github/copilot-instructions.md`, `.github/skills/`, `.github/extensions/` |

## Requirements

- **FR-001 Find it.** When a folder is added (and once for each folder already saved, after this ships), Durbar reads that folder's agent setup files for every installed agent app, read-only with size caps, never executing anything: the MCP servers (name, command or URL; secret values masked as in spec 019 FR-021/FR-022), the hooks (event and command), the permission rules (allow, deny, ask), and the agents and skills (names only).
- **FR-002 Show it** (Q1, Q3). A dialog **"This folder brings its own agent setup"** lists what was found, grouped by agent app, then by kind. Everything is **on by default**. Each group and each item has a switch to turn it off for this folder. The dialog says plainly:
  - "**Hooks** run commands on your computer when the agent does something, **without asking you, even in Read-only.**"
  - "**Allow rules** let the agent use these tools **without asking, even in Read-only.**" Deny rules: "the agent can never use these, even in Allow all."
  - "MCP servers start with the session."

  The dialog has **Use these** (primary) and **Turn all off**. Nothing runs before the dialog is answered.
- **FR-003 Remember it, notice changes.** The choices are saved per folder (paths and choices only, constitution III). When a setup file changes later (size and hash of each file), the dialog shows again before the next session in that folder, with what changed marked.
- **FR-004 Apply it per agent app** (Q4):
  - Claude: `--setting-sources project,local` (the user's own settings stay out, as today) when the folder's settings are on; the folder's `.mcp.json` servers that are on are added to Durbar's `--mcp-config`, keeping `--strict-mcp-config`; a hook or rule turned off is left out through a generated settings override (R1 decides the mechanism).
  - Codex: the project is passed as trusted for this session (`-c projects."<path>".trust_level="trusted"`, R2), so Codex reads `.codex/config.toml` and `.codex/hooks.json`; opt-outs through `-c` overrides.
  - Copilot: the folder is passed as trusted to the runtime (R3), so it reads the folder's settings, hooks and MCP servers; opt-outs through the session config.
- **FR-005 Permission modes stay visible.** Durbar's mode (Read-only, Ask first, Allow all) still decides everything the folder's own rules do not. In the chat header and the folder's room, a small **"folder rules"** chip shows when a folder's hooks or allow rules are on, and opens the same list. The activity log records a hook run when the runtime reports one.
- **FR-006 Honest limits.** Each agent app's support is recorded as `real:` per item kind after R1-R3; anything a runtime does not support is shown as "not supported by <app>" in the dialog, never silently dropped.

## Research before the plan

- **R1 Claude:** with `--setting-sources project,local`, do hooks and `permissions` from `.claude/settings*.json` apply in `-p` stream-json mode, and how do "allow" rules interact with Durbar's `--permission-prompt-tool stdio`? How can one hook or rule be turned off without editing the user's files (a generated `--settings` JSON)? One tiny real session.
- **R2 Codex:** does a `-c projects."<path>".trust_level="trusted"` override make Codex load `.codex/config.toml` and `.codex/hooks.json` under the app-server? Does it read the folder's `.mcp.json`?
- **R3 Copilot:** does the SDK runtime read a folder's `.github/copilot/settings.json`, `hooks.json` and `.mcp.json`, and how is a folder made trusted (the `trustedFolders` setting)?

## Constitution

**Done: Amendment 1, constitution v1.1.0 (owner, 2026-10-20: "amend the constitution as proposed in spec 061").** Principle III (non-negotiable) says the default mode is Read-only and that everything which can change state is denied unless the user allows it. Folder hooks and allow rules, **on by default** (Q1-Q3), act **outside** Durbar's mode. So this spec **requires an amendment of principle III by the maintainer** (`.specify/memory/constitution.md` is owned by the maintainer, CODEOWNERS). Proposed text, for the owner to approve or change:

> A folder's own agent setup (its MCP servers, hooks and permission rules) applies after the user has seen it listed when the folder was added, and stays on unless the user turns it off. The UI says plainly that hooks and allow rules act without asking, even in Read-only. Durbar's own mode governs everything else.

## Out of scope

The user's own global settings (`~/.claude/settings.json`, `~/.codex/config.toml`, Copilot's user config): unchanged. Durbar keeps its own MCP extras and modes as they are.

# Spec 061: A folder's own agent setup is used, and shown

**Status:** draft. Owner decisions recorded (issue #289, 2026-10-20). Constitution **Amendment 1** (principle III, v1.1.0) is in force (#395). Review requirements FR-010..FR-014 added (Paco, Ruben, #394). **Blocked on owner question Q5** (hooks in folders the user did not write), then research R1-R3, then plan and tasks.
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

## Review requirements (Paco and Ruben on #394, 2026-10-20)

Added as requirements before anything is built (review findings are fixed in the work, not left as notes).

- **FR-010 Consent per item, re-asked on change** (Paco 1). Each item has its own digest: a hook's event and command, a rule's text, a server's command, URL and env names. After a `git pull` or any edit, an item that is new or changed is **off until the person accepts it again**. The dialog marks it as *new* or *changed*. Unchanged items keep their choice. Removed items are dropped. This is the same rule as folder MCP imports (`mcp:importApply` with a digest, spec 019) and custom agents (`agenttrust.ts`, spec 043). **Reuse those**; do not write a third digest store.
- **FR-011 Hooks in folders the user did not write** (Paco 2). **Open, owner question Q5 below.** Until it is answered, the plan must not pick a default for hooks.
- **FR-012 Read-only still means something** (Paco 3). Whenever a folder's hooks or allow rules are on, the session's mode chip reads **"Read-only + folder rules"** (or "Ask first + folder rules"), not just the mode. The chat shows a line when a folder hook ran or a folder allow rule let a tool through without asking, when the runtime reports it. Where the runtime does not report it, the spec records `[KNOWN GAP]` and the chip still shows.
- **FR-013 Only a person in Durbar's window accepts the list** (Paco 4). Accepting or changing the folder setup is an IPC that only Durbar's own window can call (`fromApp`). It is never reachable from:
  - the Durbar MCP server's change tools (spec 041);
  - remote control (spec 054);
  - schedules (spec 044);
  - any agent-driven path.

  A unit test pins this the way `test-prevsessions` pins `sessions:delete` (#379): one registration, through `ipcHandle`, and no other caller.
- **FR-014 Show what each item does, secrets masked** (Ruben, Paco 5). The dialog lists each item in full, never only a count:
  - **hooks:** the event (`PreToolUse`, `SessionStart`…), the matcher, and the exact command;
  - **allow, deny and ask rules:** the tool and pattern as written (`Bash(npm test:*)` is not `Bash(*)`). A wildcard rule such as `Bash(*)` or a bare tool name is marked *broad*;
  - **MCP servers:** command and args, or URL, and the names of env and header keys.

  Values are masked with the existing helpers: `maskSecretCommand`, `maskSecretArgs` and `maskSecretUrl` (`src/shared/redact.ts`), and `mcpmask.ts` (#362) for env and header values. Never show a secret value, and never store one. A unit test feeds a hook command, a rule and an `.mcp.json` with tokens and checks that none reach the window.

## Open question for the owner

- **Q5 (Paco 2, Ruben +1): hooks in a folder the user did not write.** Q2 says folder hooks run. Paco and Ruben point out that a cloned repository with a hostile hook (for example `curl … | sh` on `SessionStart`) would then run commands even in Read-only, as soon as the user clicks *Use these*. Options:
  - **a)** Keep Q2: hooks on by default everywhere. The dialog shows each hook's exact command (FR-014), and changes are re-asked (FR-010).
  - **b)** Hooks off by default everywhere. Each hook has its own switch to turn it on (MCP servers and rules stay on, as decided).
  - **c)** Hooks on by default only in a folder the user marks as their own: one checkbox in the dialog, "I wrote or trust this folder's hooks", remembered per folder. Otherwise off, with each hook's own switch.

  *Recommendation: c.* It keeps Q2 for the user's own projects and closes the cloned-repo door with one click. Durbar cannot tell reliably who wrote a folder (git remotes and authors can be faked), so it asks the person instead of guessing.

## Research before the plan

- **R1 Claude:** with `--setting-sources project,local`, do hooks and `permissions` from `.claude/settings*.json` apply in `-p` stream-json mode, and how do "allow" rules interact with Durbar's `--permission-prompt-tool stdio`? How can one hook or rule be turned off without editing the user's files (a generated `--settings` JSON)? One tiny real session.
- **R2 Codex:** does a `-c projects."<path>".trust_level="trusted"` override make Codex load `.codex/config.toml` and `.codex/hooks.json` under the app-server? Does it read the folder's `.mcp.json`?
- **R3 Copilot:** does the SDK runtime read a folder's `.github/copilot/settings.json`, `hooks.json` and `.mcp.json`, and how is a folder made trusted (the `trustedFolders` setting)?

## Constitution

**Done: Amendment 1, constitution v1.1.0 (owner, 2026-10-20: "amend the constitution as proposed in spec 061").** Principle III (non-negotiable) says the default mode is Read-only and that everything which can change state is denied unless the user allows it. Folder hooks and allow rules, **on by default** (Q1-Q3), act **outside** Durbar's mode. So this spec **requires an amendment of principle III by the maintainer** (`.specify/memory/constitution.md` is owned by the maintainer, CODEOWNERS). Proposed text, for the owner to approve or change:

> A folder's own agent setup (its MCP servers, hooks and permission rules) applies after the user has seen it listed when the folder was added, and stays on unless the user turns it off. The UI says plainly that hooks and allow rules act without asking, even in Read-only. Durbar's own mode governs everything else.

## Out of scope

The user's own global settings (`~/.claude/settings.json`, `~/.codex/config.toml`, Copilot's user config): unchanged. Durbar keeps its own MCP extras and modes as they are.

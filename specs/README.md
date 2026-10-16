# Specs

Every behavior of Agent Durbar is specified here, one folder per feature, in the [GitHub Spec Kit](https://github.com/github/spec-kit)
layout (`spec.md` what and why, `plan.md` how, `tasks.md` work). The rules are in
[`.specify/memory/constitution.md`](../.specify/memory/constitution.md); the workflow is in
[CONTRIBUTING.md](../CONTRIBUTING.md#spec-kit-workflow-is-mandatory).

## Features 001-010: reverse-engineered from the shipped code

These were written **after** the code (milestones 1-6 and packaging), from the code, README, docs and screenshots. They describe
what exists today, not what was originally intended. Each requirement carries a status and, where it matters, how it was checked:

| Tag | Meaning |
| --- | --- |
| `[IMPLEMENTED]` | The behavior exists in the code (file references are in the plan). |
| `[KNOWN GAP]` | Missing, partial, wrong or contradicting the README/constitution. Has an open task. |
| `test:` | An automated test in `scripts/` (run by `npm test`, no credits) covers it. |
| `sim:` | Seen on the simulator (`DURBAR_SIM`) or in screenshots; manual, no automated assertion. |
| `real:` | Seen once on a real Copilot session, as recorded in the README (not re-run when these specs were written). |
| `read:` | Read in the code only; never exercised. Treat as unverified. |
| `re-verified 2026-10-16` | Re-checked by running the app headless (xvfb) while writing these specs. |

## Index

| # | Feature | Status |
| --- | --- | --- |
| [001](001-office-view-and-densities/spec.md) | Office view, densities, list view, filters | implemented |
| [002](002-copilot-adapter-and-events/spec.md) | Copilot adapter and normalized events | implemented |
| [003](003-permissions-and-approvals/spec.md) | Permission modes, approvals, session grants | implemented |
| [004](004-attachments/spec.md) | Attachments (pick, drop, paste) and caps | implemented |
| [005](005-chat-fullscreen-and-agent-strip/spec.md) | Full-screen chat and agent strip | implemented |
| [006](006-folders-workspaces-sessions-history/spec.md) | Folders, workspaces, sessions, history | implemented |
| [007](007-models-and-effort/spec.md) | Model and reasoning-effort pickers | implemented |
| [008](008-packaging-and-release/spec.md) | Packaging, CI, draft releases | implemented (unsigned) |
| [009](009-vscode-integration/spec.md) | Open in VS Code, VS Code chat history (read-only) | implemented |
| [010](010-simulator/spec.md) | Simulator and dev/test hooks | implemented |

## Features 011-014: 011 built, 012-014 backlog drafts

Spec drafts only (no plan or tasks yet); they must go through `/speckit.clarify`, `/speckit.plan`, `/speckit.tasks` before any code.

| # | Feature | Status |
| --- | --- | --- |
| [011](011-credit-caps-and-usage-display/spec.md) | AI-credit caps and usage display | per-session cap slice built (exhausted flow unverified on a real account); office totals and persisted usage still backlog |
| [012](012-claude-codex-adapters/spec.md) | Claude Code and Codex adapters | draft |
| [013](013-live-verification-stop-resume-thinking/spec.md) | Live verification of Stop, resume and thinking | draft |
| [014](014-signing-and-notarization/spec.md) | Code signing and notarization | draft, **needs approval (purchase)** |

## Features 015-018: milestone 7 (spec first, then code)

| # | Feature | Status |
| --- | --- | --- |
| [015](015-thinking-and-subagent-activity/spec.md) | Thinking that shows up, sub-agent activity | milestone 7 |
| [016](016-markdown-in-chat/spec.md) | Safe Markdown in the chat | milestone 7 |
| [017](017-room-doors/spec.md) | Room doors (collapse/expand) | milestone 7 |
| [018](018-permission-mode-switch/spec.md) | Change permission mode any time | milestone 7 |

## Feature 019: milestone 8

| # | Feature | Status |
| --- | --- | --- |
| [019](019-mcp-tools-and-context/spec.md) | Global MCP servers, tool usage per agent, models and context window | milestone 8 |

## Feature 020: milestone 10

| # | Feature | Status |
| --- | --- | --- |
| [020](020-tools-all-time-and-mcp-cli-primary/spec.md) | Tools "This session / All time", Copilot CLI MCP list first, MCP extras per folder | milestone 10 (implemented, simulator + unit tests) |

New features take the next number (`/speckit.specify` picks it automatically from this folder).

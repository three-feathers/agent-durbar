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

## Features 011-014: 011 built, 012 planned, 013-014 backlog drafts

013 and 014 are spec drafts only (no plan or tasks yet); they must go through `/speckit.clarify`, `/speckit.plan`, `/speckit.tasks` before any code. 012 has been through them (2026-10-17); only T010 (interface deltas), T011 (descriptors and registry), T012 (CLI detection), T013 (adapter id per saved folder), T014 (per-agent routing, `adapters:list`), T015 (FakeAdapter and the adapter contract suite) and T016 (the contract also runs on Copilot) are built; only Copilot is registered.

| # | Feature | Status |
| --- | --- | --- |
| [011](011-credit-caps-and-usage-display/spec.md) | AI-credit caps and usage display | per-session cap slice and office/folder usage totals built, totals kept across restarts with a reset (2026-10-17, issue #21); exhausted flow unverified on a real account; multiplier estimate covered by spec 030 |
| [012](012-claude-codex-adapters/spec.md) | Claude Code and Codex adapters | planned: clarified, [research](012-claude-codex-adapters/research.md), [plan](012-claude-codex-adapters/plan.md), [tasks](012-claude-codex-adapters/tasks.md); **T010 interface deltas (#30), T011 registry (#31), T012 CLI detection (#32), T013 saved adapter id (#33), T014 routing (#34), T015 contract suite (#35), T016 Copilot contract (#36) and T022 Codex mode mapping (#41, pure, not wired) built 2026-10-18 (sim/unit; only Copilot registered); no Claude or Codex adapter yet, nothing verified on a real account**; real-account tasks need owner approval; umbrella issue #2 |
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
| [020](020-tools-all-time-and-mcp-cli-primary/spec.md) | Tools "This session / All time", Copilot CLI MCP list first, MCP extras per folder, per-folder import from VS Code `mcp.json` (delta 2026-10-17, issue #7) | milestone 10 (implemented, simulator + unit tests); import delta implemented (simulator + unit tests) |

## Feature 021: collaboration harness

| # | Feature | Status |
| --- | --- | --- |
| [021](021-collaboration-harness/spec.md) | Collaboration harness: Claude + Copilot Spec Kit, labels/issues/board, CODEOWNERS, stricter spec gate, ruleset | built (tooling only): harness, board, ruleset in place; open: T010 (board workflows, web UI) and T013 (gate review) |

New features take the next number (`/speckit.specify` picks it automatically from this folder).

## Feature 023: release v0.1.0-alpha.2

| # | Feature | Status |
| --- | --- | --- |
| [023](023-release-alpha2/spec.md) | Release v0.1.0-alpha.2 as a draft pre-release (version bump, changelog, download notes) | built; draft was removed, never published (superseded by 026) |

## Feature 024: places in the office

| # | Feature | Status |
| --- | --- | --- |
| [024](024-office-places/spec.md) | Places in a shared lobby (Library, Software library, Terminal, Web, Other tools); main agents walk to the place of the tool they use; place per MCP server in Settings | built 2026-10-17 (issue #18); simulator and unit tests, plus one short real check (3 prompts, 0.84 AIU: Terminal and Software library walks only); delta 2026-10-18 *one GitHub server in Settings > Places* (issue #117, T012) built (T012-T015); delta 2026-10-18 *per-folder extras listed before use* (issue #116, T011) built (T016-T018); delta 2026-10-18 *custom places* (issue #115) built (T019-T026); both unit tests and simulator, not checked on a real session |

## Feature 025: docs in sync

| # | Feature | Status |
| --- | --- | --- |
| [025](025-docs-sync/spec.md) | "Keep docs in sync" rule, PR template Docs box, warning-only Docs check, catch-up of README/CHANGELOG/spec statuses | built; stale screenshots regenerated (T006, T008) |

## Feature 026: release v0.1.0-alpha.3

| # | Feature | Status |
| --- | --- | --- |
| [026](026-release-alpha3/spec.md) | Release v0.1.0-alpha.3 (version bump, changelog, download notes) | built; **published as a pre-release** by the maintainer (2026-10-17); alpha.2 draft removed |

## Feature 031: release v0.1.0-alpha.4

| # | Feature | Status |
| --- | --- | --- |
| [031](031-release-alpha4/spec.md) | Release v0.1.0-alpha.4 as a pre-release (version bump, changelog, download notes) | built; **published as a pre-release** (2026-10-17) |

## Feature 030: change model and context window inside a session

| # | Feature | Status |
| --- | --- | --- |
| [030](030-switch-model-context/spec.md) | Switch model, effort and context tier of a live session (chat header and office card menu), see window and % full, compact, start-fresh hint, per-folder default; simulator first, adapter-neutral | **Phases 1 and 2 built** (T010..T035). Phase 1 on the simulator (logic, types, mapper, folder store, main IPC, header menu, confirm/Undo, Compact, start-fresh note, card menu). Phase 2: the Copilot adapter's `setModel`, `cancelQueuedModel`, `compact`, resume with the saved model/effort/tier, price fields, tested on a **fake session** only; real controls are flagged "not verified on a real account yet", an adapter without them stays disabled with New session. Spec, [research](030-switch-model-context/research.md), [plan](030-switch-model-context/plan.md), [tasks](030-switch-model-context/tasks.md). Phase 3 run on a free plan (`auto` only): T040, T042, T043, T046 done, T041 partly, T044/T045 open (need a plan that lists more models), T047/T048 wait for the owner; 0.56 AIU spent, results in the research file; SDK facts read from types and docs only, **nothing run on a real account**; open questions Q1-Q8 for Vikram |

## Feature 034: agents show how they are doing

| # | Feature | Status |
| --- | --- | --- |
| [034](034-agent-health/spec.md) | The figure follows the context window (heavy 70-90%, grumpy monster above 90%), trouble signals (ambulance, faint, dizzy, impatient), Serious mode | **built** 2026-10-17 (issue #20): simulator and unit tests, `scripts/shots-034.js`; not checked on a real session; follow-up T009 (walking figure, List view); delta 2026-10-17 *rooms darken with their worst agent, sirens* (issue #135) **built** (simulator, `scripts/shots-034.js`; T015 room path contrast done too) |

## Feature 033: floors

| # | Feature | Status |
| --- | --- | --- |
| [033](033-floors/spec.md) | Floors: group rooms (folders) and switch a whole floor off so it leaves the office, the lobby and the status counts | built 2026-10-17 on branch `033-floors` ([plan](033-floors/plan.md), [research](033-floors/research.md), [tasks](033-floors/tasks.md)); simulator and unit tests, 0 AI credits |

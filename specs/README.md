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
| [001](001-office-view-and-densities/spec.md) | Office view, densities, list view, filters | implemented; delta 2026-10-18: main agents show their session title (issue #126); delta 2026-10-18: room headers fit with many one-agent folders (FR-023/FR-024) |
| [002](002-copilot-adapter-and-events/spec.md) | Copilot adapter and normalized events | implemented; delta 2026-10-18: normalized `title` event from `session.title_changed`, `name.get` fallback (issue #126) |
| [003](003-permissions-and-approvals/spec.md) | Permission modes, approvals, session grants | implemented |
| [004](004-attachments/spec.md) | Attachments (pick, drop, paste) and caps | implemented |
| [005](005-chat-fullscreen-and-agent-strip/spec.md) | Full-screen chat and agent strip | implemented |
| [006](006-folders-workspaces-sessions-history/spec.md) | Folders, workspaces, sessions, history | implemented; delta 2026-10-18: warning for a home folder or a root (issue #170) |
| [007](007-models-and-effort/spec.md) | Model and reasoning-effort pickers | implemented |
| [008](008-packaging-and-release/spec.md) | Packaging, CI, draft releases | implemented (unsigned) |
| [009](009-vscode-integration/spec.md) | Open in VS Code, VS Code chat history (read-only) | implemented |
| [010](010-simulator/spec.md) | Simulator and dev/test hooks | implemented |

## Features 011-014: 011 built, 012 planned, 013-014 backlog drafts

013 and 014 are spec drafts only (no plan or tasks yet); they must go through `/speckit.clarify`, `/speckit.plan`, `/speckit.tasks` before any code. 012 has been through them (2026-10-17); Phase 1 (T010-T019) is built, plus the pure Phase 2/3 pieces T021-T024 and T042, simulator/fixtures and unit tests only; a Codex adapter is in review; the **Claude Code adapter is built and experimental** (`DURBAR_CLAUDE=1`, T090-T094, checked once on a real Claude Code with `haiku`, about $0.015).

| # | Feature | Status |
| --- | --- | --- |
| [011](011-credit-caps-and-usage-display/spec.md) | AI-credit caps and usage display | per-session cap slice and office/folder usage totals built, totals kept across restarts with a reset (2026-10-17, issue #21); exhausted flow unverified on a real account; multiplier estimate covered by spec 030 |
| [012](012-claude-codex-adapters/spec.md) | Claude Code and Codex adapters | **Claude Code adapter built, experimental** (`DURBAR_CLAUDE=1`; CLI transport, SDK transport by dynamic import; real check 2026-10-18, T090-T094; offering it to everyone is T095); planned: clarified, [research](012-claude-codex-adapters/research.md), [plan](012-claude-codex-adapters/plan.md), [tasks](012-claude-codex-adapters/tasks.md); **Phase 1 built 2026-10-18 (T010-T019: interface, registry, CLI detection, saved adapter id, routing, contract suite on a fake and on Copilot, kind picker, mixed simulator roster, docs) and Phase 2/3 groundwork (T021/T022 mode mappings, T023/T024 event mappers with synthetic fixtures, T042 Codex JSON-RPC client, T051 debug-log redaction, T027 no Claude settings files (Q8), T026 SC-004 parity across mode mappings, T084 Codex reads limited to the session folders, T028 Phase 2 docs, T025 usage/context tests and Claude usage dedupe), all simulator/fixtures and unit tests, not wired to a real Claude or Codex; only Copilot is registered; nothing verified on a real account**; real-account tasks need owner approval; umbrella issue #2 |

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

## Feature 042: release v0.1.0-alpha.5

| # | Feature | Status |
| --- | --- | --- |
| [042](042-release-alpha5/spec.md) | Release v0.1.0-alpha.5 as a pre-release (version bump, changelog, download notes) | built; **published as a pre-release** (2026-10-18) |

## Feature 031: release v0.1.0-alpha.4

| # | Feature | Status |
| --- | --- | --- |
| [031](031-release-alpha4/spec.md) | Release v0.1.0-alpha.4 as a pre-release (version bump, changelog, download notes) | built; **published as a pre-release** (2026-10-17) |

## Feature 030: change model and context window inside a session

| # | Feature | Status |
| --- | --- | --- |
| [030](030-switch-model-context/spec.md) | Switch model, effort and context tier of a live session (chat header and office card menu), see window and % full, compact, start-fresh hint, per-folder default; simulator first, adapter-neutral | **Phases 1 and 2 built** (T010..T035). Phase 1 on the simulator (logic, types, mapper, folder store, main IPC, header menu, confirm/Undo, Compact, start-fresh note, card menu). Phase 2: the Copilot adapter's `setModel`, `cancelQueuedModel`, `compact`, resume with the saved model/effort/tier, price fields, tested on a **fake session** only; real controls are flagged "not verified on a real account yet", an adapter without them stays disabled with New session. Spec, [research](030-switch-model-context/research.md), [plan](030-switch-model-context/plan.md), [tasks](030-switch-model-context/tasks.md). Phase 3 run on a free plan (`auto` only): T040, T042, T043, T046 done, T041 partly, T044/T045 open (need a plan that lists more models), T047/T048 wait for the owner; 0.56 AIU spent, results in the research file; SDK facts read from types and docs only, **nothing run on a real account**; open questions Q1-Q8 for Vikram |

## Feature 035-040: themes (data-only packs)

| # | Feature | Status |
| --- | --- | --- |
| [035](035-theme-foundation/spec.md) | Theme foundation: data-only theme packs, manifest, token map, art slot registry, UI styles (2026-10-18), Clean Office fallback | **built** on branch `035-theme-foundation` (PR #137): loader, sanitizer, fallback, `test:theme` |
| [036](036-clean-office-pack/spec.md) | Clean Office pack: every scene colour a semantic token, scene words, `data-*` ids, per-theme motion presets | **built** (scene output byte-identical to main; `shots-024` reads data ids) |
| [037](037-corporate-theme/spec.md) | Corporate theme (glass/steel) + Settings theme picker with live switch | **built** |
| [038](038-retro-pixel-theme/spec.md) | Retro pixel theme: 8-bit palette, palette pixel maps in art slots, arcade motion | **built**; dark arcade page allowed (FR-001 amended 2026-10-18) |
| [039](039-durbar-theme/spec.md) | Durbar court styles: Indian, European, Japanese (head accessory slots, court words) | **built**; word lists await owner review in PR #137 |
| [040](040-user-themes/spec.md) | User themes: `userData/themes/<id>/manifest.json`, import/export, validation | **built** (`test:userthemes`) |

## Feature 034: agents show how they are doing

| # | Feature | Status |
| --- | --- | --- |
| [034](034-agent-health/spec.md) | The figure follows the context window (heavy 70-90%, grumpy monster above 90%), trouble signals (ambulance, faint, dizzy, impatient), Serious mode | **built** 2026-10-17 (issue #20): simulator and unit tests, `scripts/shots-034.js`; not checked on a real session; follow-up T009 (walking figure, List view); delta 2026-10-17 *rooms darken with their worst agent, sirens* (issue #135) **built** (simulator, `scripts/shots-034.js`; T015 room path contrast done too) |

## Feature 033: floors

| # | Feature | Status |
| --- | --- | --- |
| [033](033-floors/spec.md) | Floors: group rooms (folders) and switch a whole floor off so it leaves the office, the lobby and the status counts | built 2026-10-17 on branch `033-floors` ([plan](033-floors/plan.md), [research](033-floors/research.md), [tasks](033-floors/tasks.md)); simulator and unit tests, 0 AI credits |
| [041](041-durbar-mcp/spec.md) | Durbar MCP server: read the office and change settings (mode, caps, folders, MCP extras) from the user's own MCP client; off by default, local only, every change confirmed in Durbar's window, never exposed to Durbar's own agents | **planned** (2026-10-18): owner accepted the Q1-Q12 defaults; [plan](041-durbar-mcp/plan.md) and [tasks](041-durbar-mcp/tasks.md) drafted, analyze fixes done (FR-057..FR-064); no code yet; nothing verified |

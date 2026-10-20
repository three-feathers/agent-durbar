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
| [001](001-office-view-and-densities/spec.md) | Office view, densities, list view, filters | implemented; delta 2026-10-18: main agents show their session title (issue #126); delta 2026-10-18: room headers fit with many one-agent folders (FR-023/FR-024); short names not cut by a long status (FR-025); delta 2026-10-19: arrow keys between desks (FR-019); delta 2026-10-19: first-run welcome (FR-026) |
| [002](002-copilot-adapter-and-events/spec.md) | Copilot adapter and normalized events | implemented; delta 2026-10-18: normalized `title` event from `session.title_changed`, `name.get` fallback (issue #126); delta 2026-10-19: questions from Copilot (`ask_user`, FR-058) |
| [003](003-permissions-and-approvals/spec.md) | Permission modes, approvals, session grants | implemented; delta 2026-10-19: Windows grant keys, request ids (FR-088, FR-089) |
| [004](004-attachments/spec.md) | Attachments (pick, drop, paste) and caps | implemented; delta 2026-10-19: FR-009/010/012/013/015 closed |
| [005](005-chat-fullscreen-and-agent-strip/spec.md) | Full-screen chat and agent strip | implemented; delta 2026-10-19: copy buttons (FR-015), FR-011 closed by 016; delta 2026-10-19: Stop and End session in the card menu (FR-017, T026) |
| [006](006-folders-workspaces-sessions-history/spec.md) | Folders, workspaces, sessions, history | implemented; delta 2026-10-18: warning for a home folder or a root (issue #170); delta 2026-10-18: remove one session, rename a folder (FR-017/FR-018); delta 2026-10-19: a workspace's other folders given to the session (FR-019, T020); delta 2026-10-19: a folder continues its last session after a restart (FR-020/FR-021, T021, owner decision); delta 2026-10-19: Remove folder from a room's ⋯ menu and a single-session chat header (FR-022); delta 2026-10-19: search box in Previous sessions (FR-023, T031, issue #252) built |
| [007](007-models-and-effort/spec.md) | Model and reasoning-effort pickers | implemented |
| [008](008-packaging-and-release/spec.md) | Packaging, CI, draft releases | implemented (unsigned) |
| [009](009-vscode-integration/spec.md) | Open in VS Code, VS Code chat history (read-only) | implemented; delta 2026-10-19: FR-016..017 (opens at latest message, question kinds, Continue in VS Code) built |
| [010](010-simulator/spec.md) | Simulator and dev/test hooks | implemented; delta 2026-10-19: one event shape check for the simulator and adapters (FR-021) |

## Features 011-014: 011 and 012 built, 013 run, 014 backlog draft

014 is a spec draft only (no plan or tasks yet) and needs the owner's approval (a purchase). 013 was run on a real Copilot session on 2026-10-19. 012 is built: Claude Code and OpenAI Codex are offered next to Copilot when installed; what is still open is listed in its row.

| # | Feature | Status |
| --- | --- | --- |
| [011](011-credit-caps-and-usage-display/spec.md) | AI-credit caps and usage display | per-session cap slice and office/folder usage totals built, totals kept across restarts with a reset (2026-10-17, issue #21); exhausted flow unverified on a real account; multiplier estimate covered by spec 030 |
| [012](012-claude-codex-adapters/spec.md) | Claude Code and Codex adapters | **built**: Claude Code (FR-135) and OpenAI Codex (FR-145) are offered next to Copilot when installed and signed in, each checked on a real account and in the full app. Covered: permission modes and switching, models and effort, previous sessions and resume, continue after a restart, questions from the agent, MCP servers and switches, helpers, the context window, Claude's dollar estimate apart from AIU and its dollar cap (FR-150, issue #75). MCP elicitation with form fields or a URL is shown in the question card (FR-151..FR-155, issue #290; sim and fakes, real check open as T118). Packaged check on macOS, Windows and Linux in CI (T044, issue #52). Sign-in checked with the service after detection, and a refused session offers Sign in and Send again in the chat (FR-156, FR-157; fakes and simulator, real check open as T124). The decision record Q1-Q9 is complete (T060). Open: T070 (real macOS and Windows machines, issue #72), T083 (repo `.claude` hooks, agents and `.mcp.json` are not run). [research](012-claude-codex-adapters/research.md), [plan](012-claude-codex-adapters/plan.md), [tasks](012-claude-codex-adapters/tasks.md) |
| [013](013-live-verification-stop-resume-thinking/spec.md) | Live verification of Stop, resume and thinking | run 2026-10-19: C1-C7 pass on a real Copilot session (9 prompts, 0.31 AIU); several models, real cap, VS Code and macOS/Windows still open |
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
| [043](043-custom-agents/spec.md) | Custom agent per session (issue #127) | Phase 1 built: Agent chip and menu, repository-agent confirmation, Copilot `rpc.agent.*` (simulator, unit tests, real check 2026-10-19); Phase 2: the agent in the New session dialog built (FR-007); Claude agents built (FR-008); per-folder default built (FR-009); Codex not started |
| [044](044-scheduled-prompts/spec.md) | Scheduled prompts while the app is open (issue #125) | Phase 1 built: per-folder schedules, once or every N minutes, busy and missed runs skipped, pause all (unit tests, simulator, real check 2026-10-19). Phase 2 built 2026-10-20 (#291): calendar rules without DST drift, per-session schedules (pause when the session ends), a per-schedule limit, Copilot's own schedules read-only (unit tests, simulator; no real check; not available from Claude Code or Codex) |

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
| [037](037-corporate-theme/spec.md) | Corporate theme (glass/steel) + Settings theme picker with live switch | **built**; delta 2026-10-19: each swatch shows its own theme (FR-014) |
| [038](038-retro-pixel-theme/spec.md) | Retro pixel theme: 8-bit palette, palette pixel maps in art slots, arcade motion | **built**; dark arcade page allowed (FR-001 amended 2026-10-18) |
| [039](039-durbar-theme/spec.md) | Durbar court styles: Indian, European, Japanese (head accessory slots, court words) | **built**; word lists await owner review in PR #137 |
| [040](040-user-themes/spec.md) | User themes: `userData/themes/<id>/manifest.json`, import/export, validation | **built** (`test:userthemes`); delta 2026-10-19: make a theme with AI, light or dark with art, several passes, ideas (FR-014..FR-021, issue #182), and Export fixed (FR-019) built; delta 2026-10-20: the AI theme maker on Copilot (FR-015, T026, #301) built on a fake SDK, real check open (T027) |

## Feature 034: agents show how they are doing

| # | Feature | Status |
| --- | --- | --- |
| [034](034-agent-health/spec.md) | The figure follows the context window (heavy 70-90%, grumpy monster above 90%), trouble signals (ambulance, faint, dizzy, impatient), Serious mode | **built** 2026-10-17 (issue #20): simulator and unit tests, `scripts/shots-034.js`; not checked on a real session; T009 built 2026-10-19: List view mood words and the walking figure's mood (FR-014/FR-015, `scripts/shots-034-list.js`); delta 2026-10-17 *rooms darken with their worst agent, sirens* (issue #135) **built** (simulator, `scripts/shots-034.js`; T015 room path contrast done too) |

## Feature 033: floors

| # | Feature | Status |
| --- | --- | --- |
| [033](033-floors/spec.md) | Floors: group rooms (folders) and switch a whole floor off so it leaves the office, the lobby and the status counts | built 2026-10-17 on branch `033-floors`; follow-ups of issue #133 (empty-state wording, retaken screenshots) 2026-10-19 ([plan](033-floors/plan.md), [research](033-floors/research.md), [tasks](033-floors/tasks.md)); simulator and unit tests, 0 AI credits |
| [041](041-durbar-mcp/spec.md) | Durbar MCP server: read the office and change settings (mode, caps, folders, MCP extras) from the user's own MCP client; off by default, local only, every change confirmed in Durbar's window, never exposed to Durbar's own agents | **in progress** (2026-10-19): owner accepted the Q1-Q12 defaults; [plan](041-durbar-mcp/plan.md) and [tasks](041-durbar-mcp/tasks.md). T010-T012 built (paths, key file and handshake, JSON-RPC layer; unit tests, nothing listens yet), T013-T015 built (read-only tool registry, agent state in main, main-process simulator; unit tests); T016 (read tools) merged in #245; T053 (secret masking and outside paths in read results, #275) merged in #300; T054 built (per-string result cap, #277, PR pending; it must land before T017 listens); server and bridge (T017-T018) not merged; no server runs in the app yet; unit tests only (Linux and CI); nothing verified by hand on Windows or macOS |

## Feature 045: security and quality sweep

| # | Feature | Status |
| --- | --- | --- |
| [045](045-security-sweep/spec.md) | Security and quality sweep before alpha.6: uniform place ids, one-pass unescape, Windows `cmd.exe` from SystemRoot, window navigation and web-permission hardening, alert triage | built 2026-10-19 (unit tests, Electron check on the simulator) |

## Feature 046: release v0.1.0-alpha.6

| # | Feature | Status |
| --- | --- | --- |
| [046](046-release-alpha6/spec.md) | Release v0.1.0-alpha.6 as a pre-release (version bump, changelog, download notes) | built; **published as a pre-release** (2026-10-19) |
| [047](047-release-alpha7/spec.md) | Release v0.1.0-alpha.7 (pre-release): Codex offered, the Claude dollar cap, new session with a summary, the Schedules starter kit | **published as a pre-release 2026-10-19** (tag on `05b2783`, CI fully green) |
| [048](048-office-assistant/spec.md) | Office assistant: ask the whole office (who waits, what finished, usage by folder and harness) through a free local query layer, plus an optional model layer with no tools (issue #130) | **draft for the owner's review** (spec, plan, tasks; no code) |
| [049](049-profiles/spec.md) | Profiles: separate offices per profile (Phase 1), then separate sign-ins through each harness's own home folder (`COPILOT_HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`), never a token in Durbar (issue #131) | **draft for the owner's review**; Phase 2 needs research R1 |
| [050](050-project-site/spec.md) | Project website on GitHub Pages, generated from the README, the specs index, screenshots, the CHANGELOG and the latest release; deployed by CI (issue #293) | **built and live** at https://three-feathers.github.io/agent-durbar/; delta 2026-10-20: a curated landing page from `docs/site/landing.json` (checked against the README) plus a docs page with the whole README (FR-006..FR-010) built |
| [051](051-harness-setup/spec.md) | Harness setup inside the app: Settings > Harnesses with install, update and sign-in (issue #299) | **built** (unit, simulator; real sign-in flows started and cancelled) |
| [052](052-usability-pass/spec.md) | Usability pass from eleven rounds of AI persona reviews (about 37 personas): answer bar and inbox, Simple/Expert, restore strip, palette and Cost view, one word per concept, interaction polish, accessibility, calmer visuals, notifications, activity log, Windows first run, house rules, plain words, macOS conventions, daily use, pre-release fixes, a one-row top bar | **built** through round 11 (simulator, unit; OS notifications, badge, High Contrast, macOS menu and window behaviour, window restore not checked on a real OS) |
| [053](053-release-alpha8/spec.md) | Release v0.1.0-alpha.8 (pre-release): agent app setup inside the app, five usability rounds, AI themes | **published as a pre-release 2026-10-20** (tag on `dd9de65`, CI fully green) |
| [055](055-release-alpha9/spec.md) | Release v0.1.0-alpha.9 (pre-release): remote control, scheduled prompts Phase 2, MCP forms, Copilot AI themes, usability rounds 6-9, new website | **published as a pre-release 2026-10-20** (tag on `df06619`) |
| [054](054-remote-control/spec.md) | Remote control and chat channels: Copilot remote steering from github.com and GitHub Mobile per session (Phase 1); Claude Code channels wizard and Codex mobile planned (issue #298) | **Phase 1 built** (unit, simulator driver written; not run on a real account); Phases 2-3 planned |

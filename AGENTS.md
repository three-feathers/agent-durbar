# Instructions for coding agents

This repository is **spec-driven** with [GitHub Spec Kit](https://github.com/github/spec-kit). Read this before touching anything.
Humans: see [CONTRIBUTING.md](CONTRIBUTING.md#spec-kit-workflow-is-mandatory). This file is the same rule for agents (Copilot, Claude Code, Codex, Cursor and others).

## The rule

**Do not write or change code in `src/` until the spec, plan and tasks for that change exist and are committed.** Use the Spec Kit commands first, in this order:

1. `/speckit.specify` (new behavior) or a dated *spec delta* under `## Changes` in the owning `specs/NNN-name/spec.md` (bug fix or tweak to something already built).
2. `/speckit.clarify` when anything is ambiguous. Ask the user; do not guess.
3. `/speckit.plan`, then `/speckit.tasks`, then `/speckit.analyze`.
4. Only then `/speckit.implement`, ticking tasks as you go.
5. After: `/speckit.converge` so spec, plan and tasks match what you built.

Claude Code uses the same commands as skills with a hyphen (`/speckit-specify`, `/speckit-plan`, ...; in `.claude/skills/`); Copilot uses dots (`.github/prompts/`, `.github/agents/`). Run `specify integration status` to check both are intact (it exits 1 with the single, accepted finding `unsafe-multi-install`; any other finding is drift to fix). If your tool has no slash commands, follow the templates in `.specify/templates/` by hand and the prompts in `.github/prompts/speckit.*.prompt.md`. Skills-style tools can read those files directly. The artifacts are what count.

CI (`.github/workflows/spec-kit.yml`) fails a pull request that changes `src/` without changing `specs/`. Exemption only for changes with no behavior change: a `Spec-Exempt: <reason>` line in the PR description. Do not use it to skip the workflow. A second, **warning-only** job (*Docs check*) reminds you when `src/` changes without a docs change; it never blocks and is not a required check (see "Keep docs in sync").

## Where things are

- `.specify/memory/constitution.md`: the rules (I-VIII). Read it first. Principles I and III are non-negotiable.
- `specs/README.md`: index; `specs/001..010` describe what is built, `011` is partly built (caps and usage totals), `012` is built (Claude Code and OpenAI Codex are offered next to Copilot when installed, checked on real accounts; open: T070 real macOS/Windows, T083), `013` (live verification) was run on 2026-10-19 (C1-C7 on a real Copilot session; several models, a real cap, VS Code and macOS/Windows still open), `014` stays a backlog draft that needs the owner's approval before any plan or purchase, `015..021`, `023`, `024` (places in the office, simulator and unit tests, one short real check), `025`, `026` (release alpha.3) and `031` (release alpha.4, published as a pre-release 2026-10-17) are built (`022` and `027..029` have no spec folder; the next free spec number is 032, check the index), `030` (change model and context window inside a session) has Phases 1-2 built (simulator, and the Copilot adapter tested on a fake session; real controls are flagged unverified); Phase 3 was run on a free plan (`auto` only, 0.56 AIU): switching between two real models, the long tier and `confirmation_required` are still unverified. Check the index and `origin` branches for the next free number. Evidence tags: `[IMPLEMENTED]`, `[KNOWN GAP]`, `test:`, `sim:`, `real:`, `read:`.
- `src/main`, `src/preload`, `src/renderer` (plain HTML/CSS/JS), `src/adapters`, `src/shared`; tests in `scripts/test-*.ts`.

## Non-negotiables (details in the constitution)

- **Adapters are plug-ins.** Agent specifics stay behind `AgentAdapter` and its normalized events; no Copilot types in the renderer or `src/shared`.
- **Safe by default, no secrets.** Default permission mode is read-only. Never store, log or commit tokens, `.env`, Copilot config or session data. Do not spawn processes through a shell with user-controlled strings.
- **Do not spend AI credits.** Develop and test on the simulator (`DURBAR_SIM=15 npm start`) and `npm test`. Do not run `npm run smoke`, `scripts/capture-raw.ts` or any real Copilot session unless the user explicitly asks, and say how many prompts it will cost first.
- **Calm, legible UI.** Minimum 10.5px text; 15 agents must fit on 1440x900 and 1280x800 without overlap or scrolling the office.
- **Windows, macOS and Linux parity.** No POSIX-only paths or shell assumptions.
- **Honest limits.** If you did not verify it, say so in the spec (`[KNOWN GAP]`, `read:`) and the README. Never claim a platform, feature or test you did not run.
- **Needs approval:** spending money (signing certificates), publishing a release, changing repo settings, inviting people, posting anywhere. Draft it and stop and ask your human owner.

## Working as a team

Several people, each with their own agent (Claude Code, Copilot, others), work here at once. These rules keep them from colliding. Details and first-day steps: [docs/collaboration.md](docs/collaboration.md).

- **Claim before you start.** Pick an open issue nobody has. Assign yourself **and** add the label `status:claimed`. If the issue already has an assignee, or you are the second one assigned, back off and pick another.
- **One issue = one Spec Kit task** (a `Tnnn` line in `specs/NNN-*/tasks.md`). Do not widen it; open a new issue instead.
- **Branch name `NNN-slug`**, where `NNN` is the spec number (for example `003-grant-scope-windows`). One branch per issue, ideally in its own `git worktree` (Claude Code: `claude --worktree <name>`).
- **Specs live in `specs/NNN-*/`** with `spec.md`, `plan.md` and `tasks.md`. A change to `src/` must change that folder in the same PR (CI: *Spec Kit gate*). New feature: next free number.
- **PRs say `Closes #N`**, fill in the template (spec link, *Agent used*, what you did not verify), and stay small.
- **Never push to `main`.** Always a branch and a pull request.
- **Never print, log or commit secrets** (tokens, `.env`, `~/.copilot`, `~/.claude`, session data). Do not paste command output that may contain them.
- **No cloud or paid runs without asking your human owner**: no real Copilot/Claude sessions for tests, no cloud agents, no Actions you did not ask for, no purchases (issues labelled `needs-owner-approval` are blocked until the owner says yes in writing).
- **Reviews and merge (owner decision 2026-10-19):** humans set the roadmap and strategy; agents review and merge. An agent may merge its PR **without waiting for a human** when all of these hold:
  1. CI is green;
  2. it ran `npm run typecheck && npm run build && npm test` and the checks its change needs (simulator screenshots for UI; real sessions only within its owner's budget);
  3. the spec, tasks and docs are updated;
  4. it did a **final review of the whole diff as a reviewer**, not only trusting CI: correctness, security (secrets, shell, paths, permissions), the constitution and honest limits. It writes in the PR what it checked.
  5. it read the PR's **GitHub security results** and handled every new finding as an expert in code quality and security would: CodeQL / code scanning, Dependabot and secret scanning. **Look at the PR itself, not only the repository's alert list**, because a finding on a PR does not show among `main`'s alerts until it merges:
     - `gh pr checks <N>` (the *Analyze* and *CodeQL* checks);
     - the review comments that bots such as `github-advanced-security[bot]` post on the changed lines (`gh api repos/{owner}/{repo}/pulls/<N>/comments`);
     - the alerts for the PR's merge ref (`gh api "repos/{owner}/{repo}/code-scanning/alerts?ref=refs/pull/<N>/merge&state=open"`).
     - **Fix the cause in code.** Do not silence a finding.
     - Dismiss an alert only when it is a real false positive or applies only to test code, and write the reason in the dismissal and in the PR.
     - Existing open alerts on `main` that the change touches are fixed in the same PR, or get an issue.

  A review by another team's agent is welcome, and its approval (posted through its human's account) counts as the one GitHub asks for.

  **Merging someone else's PR** (owner, 2026-10-19), when its author's agent seems to have forgotten. Any agent may merge another team's PR when all of these hold:
  - it is not a draft and not marked WIP, and has no unanswered question or requested change;
  - CI is green and the PR's own security results are clean (point 5);
  - it has an approval;
  - it has been **quiet for at least 2 hours**: no new commit, review or comment.

  Leave a comment saying it was merged for that reason.

  **Before any merge, check the linked issue** (owner, 2026-10-19). Read the issue the PR works on (`Closes #N`, or the issue named in the spec or tasks), check every point it asks for against what the PR did, and handle both:
  - Everything is covered: let `Closes #N` close it.
  - Part is still open: change `Closes` to `Refs` (or reopen the issue after the merge), say on the issue what is done and what is left, and keep it open, or open a follow-up issue for the rest and link it.
  - Never leave an issue closed with work pending, or open with nothing left. Never merge a PR that something else is stacked on before checking its base, and never one marked `needs-owner-approval`. Each agent's own human may still read or revert anything. The "Needs approval" list above still applies.
- **Before this decision:** each human reviewed only their own agent's PRs, and one *other* human approved before merge. Owned paths (`.specify/`, `.claude/`, `.github/`, `AGENTS.md`, `CLAUDE.md`) also need the maintainer (CODEOWNERS).
- Stuck or blocked? Add `status:blocked` and a comment saying what you need; do not guess requirements.

## Keep docs in sync

Docs are part of the change, not a follow-up. **When a PR changes user-visible behaviour, scripts, permissions, settings, MCP or tool behaviour, release status or contributors, it updates the docs in the same PR.** Check each of these and change what is affected:

- `README.md`: status block and feature list, the *Safety model* (permission mode names: **Read-only / Ask first / Allow all**), MCP and Tools text (Copilot CLI list `~/.copilot/mcp-config.json`, per-folder extras with trust prompt, *This session / All time*), credit caps and usage totals, *Install from releases* (release status, unsigned), *Development* (the `npm run ...` names in `package.json`), roadmap, known limits, credits and links (repo, [board](https://github.com/orgs/three-feathers/projects/1)).
- `CHANGELOG.md`: one line under *Unreleased*; the release entry when a release is cut.
- The website (spec 050) is generated from these files, so it follows them by itself. Edit `docs/site/gallery.json` only to show a new key screenshot or to drop a replaced one; `npm test` (`test:site`) fails on a broken link.
- `docs/` (`collaboration.md`, `research.md`), `CONTRIBUTING.md`, `SECURITY.md`: only the pages the change touches (workflow, setup, mode names, reporting).
- The spec in `specs/NNN-*/`: tick the task in `tasks.md`, update `spec.md` status and `[IMPLEMENTED]`/`[KNOWN GAP]` tags, and the row in `specs/README.md`.
- `docs/screenshots/` and the images the README links: replace a picture that shows old wording or a changed screen (simulator, 1440x900 and 1280x800). If you cannot capture it, say so in the PR under "Screenshots" and open an issue.
- Contributors or owner: `src/shared/about.ts`, `package.json` (`contributors`), `LICENSE`, README *Credits*; `npm run test:about` keeps them in step.
- Agent rules or templates (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.github/pull_request_template.md`, `docs/collaboration.md`): when the process changes, change all of them together. `AGENTS.md` is the canonical file; `CLAUDE.md` only imports it.

No docs impact? Tick the PR template's *no docs impact* box and write `Docs: n/a <reason>` in the PR description (a reason of a few words). The *Docs check* job reads that line; it only warns, so do not use it to hide a real change.

**If you cannot do the docs yourself** (no way to take the screenshot, unsure what the change means for users, or the page needs an owner's decision): do not skip it silently. Open an issue (form *Task*, label `area:docs`), **assign it** (the human owner of your agent, or yourself) and link it from the PR, then say in the PR description what is left. Pending docs debt is tracked on the board like any other task.

## Before you finish

```bash
npm run typecheck && npm run build && npm test
```

**Fast checks, same quality** (owner, 2026-10-19): make checks faster by building once, running in parallel and checking an animation once rather than in every run, never by dropping checks. Your own computer must stay usable: keep the limits in `scripts/run-tests.js` and `scripts/check-parallel.js` (they leave CPU free, watch memory and run at low priority), run long checks in the background, and leave big matrices to CI's parallel runners. Prove an invariant cheaply instead of repeating a big matrix (for example `check:geometry`: every theme lays out like Clean Office, so the full layout check runs in one theme). Before you stop a check, find its processes by PID or with a `[c]har` pattern: `pkill -f <pattern>` also matches the shell that runs it.

For UI changes also take screenshots at 1440x900 and 1280x800 with `DURBAR_SIM=15` (see `specs/001-office-view-and-densities/quickstart.md`). Commit small and focused, with the spec, plan, tasks and docs changes in the same pull request. Fill in the pull request template honestly, including what you did not verify.

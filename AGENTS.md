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

CI (`.github/workflows/spec-kit.yml`) fails a pull request that changes `src/` without changing `specs/`. Exemption only for changes with no behavior change: a `Spec-Exempt: <reason>` line in the PR description. Do not use it to skip the workflow.

## Where things are

- `.specify/memory/constitution.md`: the rules (I-VIII). Read it first. Principles I and III are non-negotiable.
- `specs/README.md`: index; `specs/001..011` describe what is built (011: only the cap slice), `012..014` are backlog drafts. Evidence tags: `[IMPLEMENTED]`, `[KNOWN GAP]`, `test:`, `sim:`, `real:`, `read:`.
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
- **Reviews:** each human reviews only their own agent's PRs, and one *other* human approves before merge. Owned paths (`.specify/`, `.claude/`, `.github/`, `AGENTS.md`, `CLAUDE.md`) also need the maintainer (CODEOWNERS).
- Stuck or blocked? Add `status:blocked` and a comment saying what you need; do not guess requirements.

## Before you finish

```bash
npm run typecheck && npm run build && npm test
```

For UI changes also take screenshots at 1440x900 and 1280x800 with `DURBAR_SIM=15` (see `specs/001-office-view-and-densities/quickstart.md`). Commit small and focused, with the spec, plan and tasks changes in the same pull request. Fill in the pull request template honestly, including what you did not verify.

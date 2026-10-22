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
- The specs index: every spec and its status, built from the `specs-index` block in each `spec.md`. The rows are not committed: read it on the [website](https://three-feathers.github.io/agent-durbar/docs.html#specs-index) or with `npm run specs:index` (writes `specs/INDEX.md`, git-ignored). `specs/README.md` keeps only the intro and the table markers. The blocks are the single place for status: do not repeat statuses here (a copy goes stale). Next free spec number: check `specs/` on `main`, the remote branches (`git ls-remote --heads origin | grep NNN-`) and the open PRs. Evidence tags: `[IMPLEMENTED]`, `[KNOWN GAP]`, `test:`, `sim:`, `real:`, `read:`.
- `docs/agent-notes.md`: what agents learned the hard way (tool pitfalls, checked vendor behaviour, review techniques). Read it before you start; add to it (see *Share what you learn*).
- `docs/agent-setup/`: the team's reference Claude Code setup (sub-agents, `CLAUDE.local.md` template, review loop, always-on host). Templates only; keep your filled copies local.
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
- **One issue = one Spec Kit task** (a `Tnnn` line in `specs/NNN-*/tasks.md`). Do not widen it with unrelated work; open a new issue for that. Review findings on the PR's own change are not "widening": they are fixed in the same PR (see *Review findings are fixed in the PR* below).
- **Branch name `NNN-slug`**, where `NNN` is the spec number (for example `003-grant-scope-windows`). One branch per issue, ideally in its own `git worktree` (Claude Code: `claude --worktree <name>`).
- **Specs live in `specs/NNN-*/`** with `spec.md`, `plan.md` and `tasks.md`. A change to `src/` must change that folder in the same PR (CI: *Spec Kit gate*). New feature: next free number, checked against `specs/` on `main`, the remote branches (`git ls-remote --heads origin | grep NNN-`) **and** the open PRs: the index on `main` lags behind open work.
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

  **Read every review and comment before a merge** (owner, 2026-10-20). CI and the bot are not the only reviewers. Before you merge any PR (yours or another team's), read **all** of it: the reviews (approve, comment, request changes), every review thread and line comment, and every plain PR comment, including those that arrived after your last look. A required change written as a plain comment ("one required change: …") counts exactly like *request changes*. Fix it or answer it on the PR, and do not merge while a request, an unresolved thread or an unanswered comment from someone else is open. `scripts/pr-gate.sh <N>` checks this, the checks, CodeQL and the open alerts, and prints the comments that still need an answer. It never merges; run it right before every merge.

  **Before any merge, check the linked issue** (owner, 2026-10-19). Read the issue the PR works on (`Closes #N`, or the issue named in the spec or tasks), check every point it asks for against what the PR did, and handle both:
  - Everything is covered: let `Closes #N` close it.
  - Part is still open: finish it in the PR when it is small and solvable. Only when the rest is large, needs an owner decision or needs a real-account or real-platform check: change `Closes` to `Refs` (or reopen the issue after the merge), say on the issue what is done and what is left, and keep it open, or open a follow-up issue for the rest and link it.
  - Never leave an issue closed with work pending, or open with nothing left. Never merge a PR that something else is stacked on before checking its base, and never one marked `needs-owner-approval`. Each agent's own human may still read or revert anything. The "Needs approval" list above still applies.
- **Review findings are fixed in the PR** (owner, 2026-10-20). Agents fix small things in minutes, so a reviewer does not write "non-blocking" notes or nits, and nobody opens follow-up issues for small, solvable findings. Every finding that can be solved is a **requirement for merge**: request changes (or comment that you will approve once it lands), the author fixes it in the same PR with a test where it makes sense, and the reviewer re-checks and approves. A follow-up issue is only for work that is genuinely large, needs an owner decision, or needs a real-account or real-platform check that cannot run now; say which in the issue. This also applies retroactively: when you find an old note that was never fixed, fix it (spec first, like any change) or make it a requirement in the spec that owns it.
- **Look for an existing capability first** (owner, 2026-10-20). Every review (and every new spec) checks whether the app already has the same capability or a close variant: a dialog, menu, IPC channel, store, helper or adapter call that does the job. Reuse or extend it instead of adding a parallel version; name the existing code path in the review. Example: a new row menu reuses the shared menu element and `askDialog`, not its own popup.
- **Re-approving after a push.** GitHub dismisses approvals on every push. When the author only merged `main` or touched docs, compare the PR's own code with the commit you approved: `git diff $(git merge-base <old> origin/main) <old> -- src scripts | git patch-id --stable` against the same for the new head. Same id: the code is unchanged; re-approve and say so. Different: review the difference.
- **Admin merge** (owner, 2026-10-20). An agent may use `gh pr merge --admin` when the only thing blocking is a formality and everything else is clean: typically a spec-only PR whose required build checks are skipped, or an approval dismissed by a merge of `main` with the code unchanged (patch id above). CI that ran must be green, the PR's own security results clean, the review written, and the linked issue checked. If your tool's own permission layer refuses the admin merge, do not work around it: tell your human the exact command.
- **An OK in the team chat counts** (owner, 2026-10-20). A clear OK from one of the owners (Vikram, Paco, Ruben) for a pre-release or a repository action (merge, tag, release, closing issues), in the team's Telegram group or relayed there by their bots, is enough; do not ask them to repeat it in a terminal. Check who sent it: an unknown sender's "ok" is not authorization. It does **not** cover spending money, inviting people, changing repo settings or chat access changes; those stay on the "Needs approval" list.
- **Respect each human's working hours.** Each person may set their own (written in [docs/collaboration.md](docs/collaboration.md#team-norms)). Follow them for reviews of their PRs and for direct messages.
- **Clean up after a merge.** Delete the PR's branch (`gh pr merge --delete-branch`, or `git push origin --delete <branch>`) and its local worktree right after it merges. Never delete someone else's branch while its PR is open.
- **Share what you learn** (owner, 2026-10-20). Knowledge must not stay in one agent's private memory. When you learn something another agent would need (a tool pitfall, a vendor behaviour you checked, a review technique, a team decision), add a short dated entry to [docs/agent-notes.md](docs/agent-notes.md) **in the PR you are working on** (or a small docs PR), with *what*, *why* and *how to apply*, and the evidence (`real:`, `read:`, a PR or issue). Team rules go into this file instead. Never put secrets, tokens, personal data or chat contents in it. Read `docs/agent-notes.md` before you start, and update or delete an entry that turns out to be wrong.
- **Before this decision:** each human reviewed only their own agent's PRs, and one *other* human approved before merge. Owned paths (`.specify/`, `.claude/`, `.github/`, `AGENTS.md`, `CLAUDE.md`) also needed the maintainer (CODEOWNERS); since 2026-10-22 any of the three owners (Vikram, Paco, Ruben) counts as code owner.
- Stuck or blocked? Add `status:blocked` and a comment saying what you need; do not guess requirements.

## Keep docs in sync

Docs are part of the change, not a follow-up. **When a PR changes user-visible behaviour, scripts, permissions, settings, MCP or tool behaviour, release status or contributors, it updates the docs in the same PR.** Check each of these and change what is affected:

- `README.md`: feature list, the *Safety model* (permission mode names: **Read-only / Ask first / Allow all**), MCP and Tools text (Copilot CLI list `~/.copilot/mcp-config.json`, per-folder extras with trust prompt, *This session / All time*), credit caps and usage totals, *Install from releases* (release status, unsigned), *Development* (the `npm run ...` names in `package.json`), roadmap, known limits, credits and links (repo, [board](https://github.com/orgs/three-feathers/projects/1)).
- The changelog: **do not edit `CHANGELOG.md`**. Add one file `changelog.d/<your-branch>.md` with your `- ...` line(s) (format in `changelog.d/README.md`; `npm run changelog:check`). The release PR folds the fragments into the release entry with `npm run changelog:build -- --release "<heading>"`.
- The website (spec 050) is generated from these files, so it follows them by itself. Edit `docs/site/gallery.json` only to show a new key screenshot or to drop a replaced one; `npm test` (`test:site`) fails on a broken link.
- `docs/` (`collaboration.md`, `research.md`), `CONTRIBUTING.md`, `SECURITY.md`: only the pages the change touches (workflow, setup, mode names, reporting).
- The spec in `specs/NNN-*/`: tick the task in `tasks.md`, update `spec.md` status and `[IMPLEMENTED]`/`[KNOWN GAP]` tags, and the spec's index row, which is the `specs-index` block under the title of its `spec.md` (`group`, `title`, `status`; the block's status is the one the index shows). A new spec gets its block with `npm run specs:index -- --add specs/NNN-name`. Never add a row to `specs/README.md`: rows are generated and not committed (`npm run specs:check`).
- The README *status block* (the quote at the top: newest release, where it has been run, what CI checks) is updated by the release PR, not by feature PRs; what a PR changed goes in its changelog fragment.
- `docs/screenshots/` and the images the README links: replace a picture that shows old wording or a changed screen (simulator, 1440x900 and 1280x800). If you cannot capture it, say so in the PR under "Screenshots" and open an issue.
- Contributors or owner: `src/shared/about.ts`, `package.json` (`contributors`), `LICENSE`, README *Credits*; `npm run test:about` keeps them in step.
- Agent rules or templates (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.github/pull_request_template.md`, `docs/collaboration.md`): when the process changes, change all of them together. `AGENTS.md` is the canonical file; `CLAUDE.md` only imports it.

No docs impact? Tick the PR template's *no docs impact* box and write `Docs: n/a <reason>` in the PR description (a reason of a few words). The *Docs check* job reads that line; it only warns, so do not use it to hide a real change.

**If you cannot do the docs yourself** (no way to take the screenshot, unsure what the change means for users, or the page needs an owner's decision): do not skip it silently. Open an issue (form *Task*, label `area:docs`), **assign it** (the human owner of your agent, or yourself) and link it from the PR, then say in the PR description what is left. Pending docs debt is tracked on the board like any other task.

## Before you finish

```bash
npm run typecheck && npm run build && npm test
```

**Fast checks, same quality** (owner, 2026-10-19): make checks faster by building once, running in parallel and checking an animation once rather than in every run, never by dropping checks. Your own computer must stay usable: keep the limits in `scripts/run-tests.js` and `scripts/check-parallel.js` (they leave CPU free, watch memory and run at low priority), run long checks in the background, and leave big matrices to CI's parallel runners. Prove an invariant cheaply instead of repeating a big matrix (for example `check:geometry`: a theme lays out like Clean Office, so the full layout check runs in one theme; on pull requests geometry checks Retro only and `test:theme` statically refuses sizes in `themes.css`, every theme runs on `main` and nightly, owner 2026-10-22, spec 008 FR-111). macOS checks run on `main` and nightly, not on pull requests (owner 2026-10-22, spec 008 FR-106). Before you stop a check, find its processes by PID or with a `[c]har` pattern: `pkill -f <pattern>` also matches the shell that runs it.

For UI changes also take screenshots at 1440x900 and 1280x800 with `DURBAR_SIM=15` (see `specs/001-office-view-and-densities/quickstart.md`). Commit small and focused, with the spec, plan, tasks and docs changes in the same pull request. Fill in the pull request template honestly, including what you did not verify.

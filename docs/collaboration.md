# Working together (humans and their coding agents)

For a new contributor and their Claude agent. Plain steps; the full rules are in [AGENTS.md](../AGENTS.md) (section "Working as a team") and the [constitution](../.specify/memory/constitution.md). This is spec 021 ([specs/021-collaboration-harness](../specs/021-collaboration-harness/spec.md)).

## The idea in five lines

- Work is tracked as **issues**; one issue is one Spec Kit task (a `Tnnn` line in `specs/NNN-*/tasks.md`).
- You **claim** an issue (assign yourself + label `status:claimed`) before you start, so two agents never do the same thing.
- **Spec, plan and tasks come before code.** Your agent does this with the Spec Kit skills.
- Work on a **branch `NNN-slug`**, open a **pull request** with `Closes #N`. Nobody pushes to `main`.
- A human other than the agent's owner approves. CI must pass.

## First day

1. **Accept the invitation** to the `three-feathers` organization (email, or https://github.com/three-feathers). Sign in to GitHub; you get write access to `agent-durbar`. Turn on two-factor authentication.
2. **Install the tools**: Git, Node 22 (20.19+ works), the GitHub CLI `gh` (`gh auth login`), `uv`, and Claude Code (macOS/Linux/WSL: `curl -fsSL https://claude.ai/install.sh | bash`; Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`; or `brew install --cask claude-code` / `winget install Anthropic.ClaudeCode`). Check with `claude --version`. You use your own Claude account; this project never asks for or stores your login.
3. **Clone and build**:
   ```bash
   git clone https://github.com/three-feathers/agent-durbar.git
   cd agent-durbar
   npm ci
   npm run typecheck && npm run build && npm test     # no AI credits spent
   ```
4. **Spec Kit check**: `uv tool install specify-cli`, then `specify integration status`. Expected: `Installed integrations: copilot, claude`, no modified or missing files, and one finding `unsafe-multi-install` (exit code 1). That one finding is accepted: Claude and Copilot share the repo on purpose. Anything else means a broken setup: tell the maintainer, do not "fix" `.specify/` or `.claude/` yourself.
5. **Start Claude Code in the repo**: `claude`. It reads `CLAUDE.md`, which imports `AGENTS.md`. Type `/` and you should see `speckit-specify`, `speckit-plan`, `speckit-tasks` and the rest. Read `AGENTS.md` yourself too, once.

## For each piece of work

1. **Pick an issue** from the [board](https://github.com/orgs/three-feathers/projects/1) or the [issue list](https://github.com/three-feathers/agent-durbar/issues): no assignee, not `status:blocked`, not `needs-owner-approval`. Ask your human owner if unsure. Good first picks have `area:docs` or `area:platform`.
2. **Claim it**: assign yourself and add `status:claimed`:
   ```bash
   gh issue edit N --add-assignee @me --add-label status:claimed
   ```
   Check the issue has exactly one assignee (you). If someone else is also there, back off.
3. **Branch** `NNN-slug`, where NNN is the spec number from the issue label `spec:NNN`, in its own worktree:
   ```bash
   git switch main && git pull
   git worktree add ../durbar-003-grant-scope -b 003-grant-scope-windows
   cd ../durbar-003-grant-scope && npm ci && claude
   ```
   (Claude Code also has `claude --worktree <name>`, but then rename the branch to `NNN-slug` before pushing.)
4. **Spec first**: in the spec folder `specs/NNN-*/` make sure `spec.md`, `plan.md` and `tasks.md` exist. Missing: `/speckit-specify`, `/speckit-clarify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-analyze`. Fix to something built: a dated spec delta under `## Changes`. Commit these first.
5. **Implement** the one task (`/speckit-implement`), small commits, tick the task in `tasks.md`. Test on the simulator (`DURBAR_SIM=15 npm start`) and `npm test`. **Do not run real agent sessions, `npm run smoke` or `scripts/capture-raw.ts`**: they spend AI credits. Never paste tokens or `.env` into a chat or a commit.
6. **Before the PR**: `npm run typecheck && npm run build && npm test`; screenshots for UI changes (see AGENTS.md); `/speckit-converge`.
   **Docs too**: update README, CHANGELOG, `docs/`, the spec's `tasks.md` and screenshots in the same PR (the list is in AGENTS.md, "Keep docs in sync"). Cannot do one of them? Open an issue with label `area:docs` and assign it; say so in the PR.
7. **Open the PR** (`git push -u origin <branch>`, then `gh pr create`). Fill the template: `Closes #N`, spec link, *Agent used*, what you did not verify. Move the issue on the board to *In review*.
8. **Review**: you read your own agent's diff before asking anyone. A *different* human approves. Files under `.specify/`, `.claude/`, `.github/`, `AGENTS.md`, `CLAUDE.md` also need the maintainer. You review your own agent's PRs only, plus the approval you give for someone else's.
9. **Merge** when CI is green and approvals are in; delete the branch; the issue closes itself.

## Stuck or blocked

Add the label `status:blocked` and comment what you need. Something costs money, publishes a release, creates an account or touches repo settings? Stop and ask the maintainer (`needs-owner-approval`).

## When the gate fails

The *Spec Kit gate* check explains itself. Common causes: branch is not `NNN-slug`; `src/` changed but the PR does not touch `specs/NNN-*/`; the folder lacks `spec.md`, `plan.md` or `tasks.md`. A change with **no behavior change** (typo, comment, formatting, dependency bump, CI-only) may add a line `Spec-Exempt: <reason>` to the PR description; the reviewer must agree. "It is small" is not a reason.

## When the Docs check warns

*Docs check (warning only)* shows a yellow warning when `src/` changed but `README.md`, `CHANGELOG.md` and `docs/` did not, or when `package.json` scripts changed but `README.md` did not. It never fails the PR and is not a required check. Fix it by updating the docs, or write `Docs: n/a <reason>` in the PR description (or ask a maintainer for the `docs-n/a` label) when there is truly no docs impact. Script: `.github/scripts/docs-check.sh`, tested by `.github/scripts/test-docs-check.sh`.

## For the maintainer

- Labels: `bash .github/scripts/sync-labels.sh` (creates `spec:NNN` per spec folder, `area:*`, `status:*`).
- Issues from a spec: `bash .github/scripts/tasks-to-issues.sh specs/NNN-name [--task T020] [--area x] --create` (dry run without `--create`), or `/speckit-taskstoissues` in Claude / `/speckit.taskstoissues` in Copilot (needs the GitHub MCP server). Open backlog: `.github/scripts/backlog-issues.sh`.
- After adding Spec Kit extensions or presets, run `specify integration use claude` and `specify integration use copilot` once each and commit the result; they only register for the default integration.
- Board: <https://github.com/orgs/three-feathers/projects/1> (public, linked to the repo; created and refreshed by `bash .github/scripts/create-board.sh`, safe to re-run, needs `gh` scope `project`). Fields: Status (Todo, Claimed, In progress, In review, Done), Spec ID, Owner, Area.
- Board automation (auto-add new issues, auto-set Status when a PR is linked or merged or an issue closes) is switched on in the Project's web settings (Workflows); GitHub has no API for it. Steps are in `specs/021-collaboration-harness/notes.md`.
- Ruleset on `main`: see `.github/ruleset-main.json` and spec 021 T012.

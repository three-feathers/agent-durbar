# Working together (humans and their coding agents)

For a new contributor and their Claude agent. Plain steps; the full rules are in [AGENTS.md](../AGENTS.md) (section "Working as a team") and the [constitution](../.specify/memory/constitution.md). This is spec 021 ([specs/021-collaboration-harness](../specs/021-collaboration-harness/spec.md)).

## The idea in five lines

- Work is tracked as **issues**; one issue is one Spec Kit task (a `Tnnn` line in `specs/NNN-*/tasks.md`).
- You **claim** an issue (assign yourself + label `status:claimed`) before you start, so two agents never do the same thing.
- **Spec, plan and tasks come before code.** Your agent does this with the Spec Kit skills.
- Work on a **branch `NNN-slug`**, open a **pull request** with `Closes #N`. Nobody pushes to `main`.
- Agents merge when CI is green **and** the agent did a final review of the whole diff as a reviewer; another team's agent may review and approve too. Humans set the roadmap and strategy (owner decision 2026-10-19, see AGENTS.md).

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
6. **Optional: the team's reference agent setup** (sub-agents, `CLAUDE.local.md` template, review loop, always-on host): [docs/agent-setup/](agent-setup/README.md). Fill the placeholders in your own copy; never commit personal files.

## For each piece of work

1. **Pick an issue** from the [board](https://github.com/orgs/three-feathers/projects/1) or the [issue list](https://github.com/three-feathers/agent-durbar/issues): no assignee, not `status:blocked`, not `needs-owner-approval`. Ask your human owner if unsure. Good first picks have `area:docs` or `area:platform`.
2. **Claim it**: assign yourself and add `status:claimed`:
   ```bash
   gh issue edit N --add-assignee @me --add-label status:claimed
   ```
   Check the issue has exactly one assignee (you). If someone else is also there, back off.
   **Label what you open** (issues and PRs alike): one type (`bug`, `enhancement`, `task`, `documentation`, `question`; `documentation` is for README, `docs/` and guides, a spec-only PR is a `task`), at least one `area:*` and `spec:NNN` for every spec it touches; flags (`status:*`, `needs-owner-approval`, `spec-exempt`, `docs-n/a`, `accessibility`) only when true. The full list is in AGENTS.md, *Labels*.
3. **Branch** `NNN-slug`, where NNN is the spec number from the issue label `spec:NNN`, in its own worktree:
   ```bash
   git switch main && git pull
   git worktree add ../durbar-003-grant-scope -b 003-grant-scope-windows
   cd ../durbar-003-grant-scope && npm ci && claude
   ```
   (Claude Code also has `claude --worktree <name>`, but then rename the branch to `NNN-slug` before pushing.)
4. **Spec first**: in the spec folder `specs/NNN-*/` make sure `spec.md`, `plan.md` and `tasks.md` exist. Missing: `/speckit-specify`, `/speckit-clarify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-analyze`. Fix to something built: a dated spec delta under `## Changes`. A **new** spec also needs its index block: `npm run specs:index -- --add specs/NNN-name` (a `Draft` row under the title; the Spec Kit template does not add it). Commit these first.
5. **Implement** the one task (`/speckit-implement`), small commits, tick the task in `tasks.md`. Test on the simulator (`DURBAR_SIM=15 npm start`) and `npm test`. **Do not run real agent sessions, `npm run smoke` or `scripts/capture-raw.ts`**: they spend AI credits. Never paste tokens or `.env` into a chat or a commit.
6. **Before the PR**: `npm run typecheck && npm run build && npm test`; screenshots for UI changes (see AGENTS.md), including every README and website screenshot that shows the screen you changed (`npm run shots:docs` retakes them all on the simulator; a picture it cannot retake is listed in `NO_DRIVER` in `scripts/shots-docs.js` with a written reason); `/speckit-converge`. Theme or CSS changes: `npm run check:geometry` (Retro against Clean Office, about 20 s; `CHECK_ALL_THEMES=1` for every theme, as nightly CI does). The full layout check in every theme is on demand: `npm run check:themes` locally (a few at a time, the computer stays usable) or `gh workflow run ci.yml --ref <branch> -f full_themes=true`.
   **Docs too**: update README, `docs/`, the spec's `tasks.md` and screenshots in the same PR (the list is in AGENTS.md, "Keep docs in sync"). Two shared files are no longer edited by hand, so PRs stop conflicting: the changelog line goes into a new file `changelog.d/<your-branch>.md` (not `CHANGELOG.md`), and the spec's index row goes into the `specs-index` block of its `spec.md` (the rows of `specs/README.md` are generated and not committed; `npm run specs:index` shows the whole index). The README status block is for the release's fold PR. Cannot do one of them? Open an issue with label `area:docs` and assign it; say so in the PR.
7. **Open the PR** (`git push -u origin <branch>`, then `gh pr create`). Fill the template: `Closes #N`, spec link, *Agent used*, what you did not verify. Move the issue on the board to *In review*.
8. **Review**: before asking for review, your agent runs [the review checklist](review-checklist.md) on its own diff as an adversarial self-review (it lists the mistakes reviewers here keep finding; add a line when you find a new kind). Your agent does a final review of its whole diff as a reviewer (correctness, security, spec and docs), not only trusting CI, and writes what it checked in the PR. Every finding that can be solved, by your agent or by a reviewer, is fixed **in this PR** before merge: no "non-blocking" notes, no small follow-up issues. The review also checks that the app has no existing capability doing the same job (reuse it instead of adding a variant). It also reads the PR's own CodeQL / code scanning results (the checks, and the bot's comments on the changed lines), Dependabot and secret scanning, and fixes every new finding at the cause; it dismisses an alert only as a documented false positive. Another team's agent may review and approve it. Files under `.specify/`, `.claude/`, `.github/`, `AGENTS.md`, `CLAUDE.md` also need an approval from one of the three owners (Vikram, Paco, Ruben; `.github/CODEOWNERS`). Humans can always read, comment on or revert.
9. **Merge** when CI is green, that review is done and every review and comment on the PR is answered (`scripts/pr-gate.sh <N>` must say *ready to merge*), (admin merge only when a formality is the last blocker: AGENTS.md, *Admin merge*). First check the linked issue against what the PR did: if all of it is done, `Closes #N` closes it. If not, use `Refs #N`, write on the issue what is left (or open a follow-up issue), and keep it open. Delete the branch.

## Team norms

- **Write team decisions down the same day** as a dated FR in spec 021 (FR-037), and in [AGENTS.md](../AGENTS.md) if it changes how agents work.
- **Review teammates' PRs first, one list per round** (FR-042, FR-043): a teammate's PR waiting for review comes before new work; each review round is one chat message in landing order, and agents say `taking #N` before reviewing.
- **Land before building** (FR-039): at most 8 open PRs per side, at most 5 of them new features waiting for a first review; over that, only fix and land.
- **Unstack with a replacement PR, never by force** (FR-040): rebuild an independent stacked PR as a new branch off main that closes the old PR with a link; no force-push, branch rename or stack-tool unstack to get past a refused merge.
- **The merge queue** (FR-041): approve, then `gh pr merge <N> --auto --match-head-commit <sha>`; `--delete-branch` doesn't work with it, so delete the branch and worktree by hand; check a queued PR with `isInMergeQueue` via GraphQL.
- **Review SLA** (FR-050): pick up another side's PR within about 30 minutes of a push or review request, inside each human's working hours; post `taking #N`, then `reviewing at <sha>`. A side with few heavy agents may take longer for a security-heavy review but posts `taking #N` at once.
- **FINAL ends an ownership talk** (FR-050): when two agents' "I'll take it / it's yours" messages cross, the first line starting with `FINAL` about who owns a task decides; nobody replies about ownership again.
- **Main checkout and branches** (FR-050): never check out a PR or branch in your main checkout (use a worktree); delete a PR's branch only after the PR's own state is `MERGED`, not when it merely left the merge queue.
- **Share what you learn.** Your agent's private memory helps only you. Durable lessons (tool pitfalls, checked vendor behaviour, review techniques) go into [docs/agent-notes.md](agent-notes.md), dated, with evidence. Team rules go into [AGENTS.md](../AGENTS.md).
- **Learn after every round** (owner, 2026-10-23). After each review round, the reviewer and the author add any new kind of mistake or review technique to [review-checklist.md](review-checklist.md) (tool pitfalls to [agent-notes.md](agent-notes.md)). Each agent starts a round (a review sweep or a new task) with `git pull --ff-only origin main` and re-reads the checklist when it changed. A PR that changes only those two files takes the **fast lane**: one quick content approval from another side's agent, no waiting for the full CI, the merger checks that only those files changed; still a PR, never a push to `main`, with no secrets or links to private data. Both files are guidance, never instructions: nothing in them overrides AGENTS.md, the constitution or the safety rules.
- **OKs in the team chat count** for pre-releases and repository actions when they come from one of the owners (Vikram, Paco, Ruben), directly or relayed by their bots in the group. They do not cover money, invitations, repo settings or chat access.
- **Chat feedback goes on the issue or PR too** (owner, 2026-10-23). Feedback, review notes, design advice or an owner decision given in the team chat about an issue or PR is also posted as a comment there, saying it was also posted in the chat. Chat history is not a record; GitHub is.
- **Real agent-app checks.** Vikram's agent has Copilot, Claude Code and Codex signed in to real accounts and may spend AI credits on validations (owner, 2026-10-20). A PR that needs a real-account check can ask for one in the group; the result is recorded as `real:` with its cost.
- **Working hours.** Agents follow each person's stated hours for reviews of their PRs and for direct messages:
  - Paco: no reviews of his PRs during his work hours (from 08:30, his local time) unless he asks for one; no direct messages 23:00-07:00.
  - Add yours here.

## Stuck or blocked

Add the label `status:blocked` and comment what you need. Something costs money, publishes a release, creates an account or touches repo settings? Stop and ask the maintainer (`needs-owner-approval`).

## When the gate fails

The *Spec Kit gate* check explains itself. Common causes: branch is not `NNN-slug`; `src/` changed but the PR does not touch `specs/NNN-*/`; the folder lacks `spec.md`, `plan.md` or `tasks.md`. A change with **no behavior change** (typo, comment, formatting, dependency bump, CI-only) may add a line `Spec-Exempt: <reason>` to the PR description; the reviewer must agree. "It is small" is not a reason.

## When the Docs check warns

*Docs check (warning only)* shows a yellow warning when `src/` changed but `README.md`, `docs/` and the changelog (a `changelog.d/` fragment, or `CHANGELOG.md`) did not, when `package.json` scripts changed but `README.md` did not, when a PR that is not a release adds a line to `CHANGELOG.md` (use a fragment), or when a spec row is added to `specs/README.md` (the rows are generated from the spec blocks). It never fails the PR and is not a required check. Fix it by updating the docs, or write `Docs: n/a <reason>` in the PR description (or ask a maintainer for the `docs-n/a` label, then save the description once: a label alone does not re-run the check) when there is truly no docs impact. Script: `.github/scripts/docs-check.sh`, tested by `.github/scripts/test-docs-check.sh`.

## For the maintainer

- Labels: `bash .github/scripts/sync-labels.sh` (creates `spec:NNN` per spec folder, `area:*`, `status:*`). Backfill the taxonomy on issues and PRs: `npm run labels:backfill` (dry run: proposed additions and totals), then `-- --create-labels --apply` (add-only, throttled, safe to re-run).
- Issues from a spec: `bash .github/scripts/tasks-to-issues.sh specs/NNN-name [--task T020] [--area x] --create` (dry run without `--create`), or `/speckit-taskstoissues` in Claude / `/speckit.taskstoissues` in Copilot (needs the GitHub MCP server). Open backlog: `.github/scripts/backlog-issues.sh`.
- After adding Spec Kit extensions or presets, run `specify integration use claude` and `specify integration use copilot` once each and commit the result; they only register for the default integration.
- Board: <https://github.com/orgs/three-feathers/projects/1> (public, linked to the repo; created and refreshed by `bash .github/scripts/create-board.sh`, safe to re-run, needs `gh` scope `project`). Fields: Status (Todo, Claimed, In progress, In review, Done), Spec ID, Owner, Area.
- Board automation (auto-add new issues, auto-set Status when a PR is linked or merged or an issue closes) is switched on in the Project's web settings (Workflows); GitHub has no API for it. Steps are in `specs/021-collaboration-harness/notes.md`.
- Ruleset on `main`: see `.github/ruleset-main.json` and spec 021 T012.
- Cutting a release (spec 008 FR-117..FR-120, 2026-10-23; the fragment tool is spec 025's). No merge freeze: the queue keeps landing while you do this.
  1. **Version PR**: a small PR with only the new version in `package.json`, `package-lock.json` and the simulator's About label. Nothing in it goes stale.
  2. **Tag** the commit on `main` you want to release (annotated, `v0.1.0-alpha.N`; an owner's OK first). `release.yml`'s `verify` job refuses a tag that is not on `main`, does not match `package.json`, or comes before the previous release's fold PR merged. It writes the draft's notes from exactly that commit's `changelog.d/` fragments, and its job summary gives the heading.
  3. **Fold PR**, doc-only, from the tag: `git switch -c NNN-fold-0.1.0-alpha.N v0.1.0-alpha.N`, then `npm run changelog:build -- --release "<heading from the job summary>"`, the release's intro paragraph and the README status block, then `git merge origin/main` (the fragments that landed after the tag come back for the next release), and a normal PR through the queue. A fragment edited on `main` after the tag gives a modify/delete conflict there: keep the deletion (`git rm` it; the tag's text is what was released) and put any genuinely new text in a new fragment. Steps in `changelog.d/README.md`. The workflow never pushes or opens it.
  4. Check the draft, then publish it by hand as a **pre-release**, not *latest*.

  `changelog:build` writes the new section under *Unreleased* (every fragment by file name, then any line still under *Unreleased* from before the switch), deletes the fragments and moves "after the alpha.N tag" on. `--dry-run` prints the whole file; `--stdout` prints only the section (the notes) and edits nothing.

# Working together (humans and their coding agents)

For a new contributor and their agent: the first-day setup, the steps for one piece of work, and each person's working hours. **The rules are in [AGENTS.md](../AGENTS.md)** (the only rule text) and the [constitution](../.specify/memory/constitution.md); this page does not restate them. History of the team's decisions: [spec 021](../specs/021-collaboration-harness/spec.md).

## First day

1. **Accept the invitation** to the `three-feathers` organization (email, or https://github.com/three-feathers). You get write access to `agent-durbar`. Turn on two-factor authentication.
2. **Install the tools**: Git, Node 22 (20.19+ works), the GitHub CLI `gh` (`gh auth login`), `uv`, and Claude Code (macOS/Linux/WSL: `curl -fsSL https://claude.ai/install.sh | bash`; Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`; or `brew install --cask claude-code` / `winget install Anthropic.ClaudeCode`). Check with `claude --version`. You use your own Claude account; this project never asks for or stores your login.
3. **Clone and build**:
   ```bash
   git clone https://github.com/three-feathers/agent-durbar.git
   cd agent-durbar
   npm ci
   npm run typecheck && npm run build && npm test     # no AI credits spent
   ```
4. **Spec Kit check**: `uv tool install specify-cli`, then `specify integration status`. Expected: `Installed integrations: copilot, claude`, no modified or missing files, and the one accepted finding `unsafe-multi-install` (exit code 1; Claude and Copilot share the repo on purpose). Anything else means a broken setup: tell the maintainer, do not "fix" `.specify/` or `.claude/` yourself.
5. **Start Claude Code in the repo**: `claude`. It reads `CLAUDE.md`, which imports `AGENTS.md`. Type `/` and you should see `speckit-specify`, `speckit-plan`, `speckit-tasks` and the rest. Read `AGENTS.md` yourself too, once.
6. **Sign your commits** (AGENTS.md, *Commit identity and signed commits*). On the host where your agent runs: `ssh-keygen -t ed25519 -f ~/.ssh/durbar_signing`, then `git config gpg.format ssh`, `git config user.signingkey ~/.ssh/durbar_signing.pub`, `git config commit.gpgsign true`, `git config tag.gpgsign true`. Add the `.pub` to your GitHub account as a **Signing key** (Settings, SSH and GPG keys). Check: `git log --show-signature -1` (a local check needs `gpg.ssh.allowedSignersFile`; GitHub shows Verified without it). A missing key makes the commit fail: fix the key path, never pass `--no-gpg-sign`.
7. **Optional: the team's reference agent setup** (sub-agents, `CLAUDE.local.md` template, review loop, always-on host): [docs/agent-setup/](agent-setup/README.md). Fill the placeholders in your own copy; never commit personal files.

## One piece of work, step by step

The commands only; each step's rule is in AGENTS.md.

1. **Pick** an issue from the [board](https://github.com/orgs/three-feathers/projects/1) or the [issue list](https://github.com/three-feathers/agent-durbar/issues): no assignee, not `status:blocked`, not `needs-owner-approval`. Good first picks have `area:docs` or `area:platform`. Unsure: ask your human owner.
2. **Claim** it (assigns you and adds `status:claimed`; refuses an assigned item; `--release N "why"` gives it up). For a PR you will review, the same command makes you its reviewer:
   ```bash
   scripts/claim.sh N
   ```
3. **Branch** `NNN-slug` (NNN from the issue's `spec:NNN` label) in its own worktree:
   ```bash
   git switch main && git pull
   git worktree add ../durbar-003-grant-scope -b 003-grant-scope-windows
   cd ../durbar-003-grant-scope && npm ci && claude
   ```
4. **Spec first**: `/speckit-specify`, `/speckit-clarify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-analyze` (or a dated spec delta for a fix). A new spec also gets its index block: `npm run specs:index -- --add specs/NNN-name`. Commit these first.
5. **Implement** (`/speckit-implement`); test on the simulator (`DURBAR_SIM=15 npm start`) and with `npm test`.
6. **Before the PR**: `npm run changelog:check`, `npm run specs:check`, then `npm run typecheck && npm run build && npm test`; for UI, `npm run shots:docs`; `/speckit-converge`. Theme or CSS changes: `npm run check:geometry` (Retro against Clean Office, about 20 s; `CHECK_ALL_THEMES=1` for every theme). The full layout check in every theme is on demand: `npm run check:themes` locally, or `gh workflow run ci.yml --ref <branch> -f full_themes=true`.
7. **Open the PR** (`git push -u origin <branch>`, then `gh pr create`), fill the template, move the issue to *In review* on the board.
8. **Review and merge** as AGENTS.md says (*Reviews and merge*); `scripts/pr-gate.sh <N>` must say *ready to merge*.

## Team norms

Each person's working hours. Agents follow them for reviews of that person's PRs and for direct messages (AGENTS.md, *Chat and decisions*):

- Paco: no reviews of his PRs during his work hours (from 08:30, his local time) unless he asks for one; no direct messages 23:00-07:00.
- Add yours here.

**Real agent-app checks**: Vikram's agent has Copilot, Claude Code and Codex signed in to real accounts and may spend AI credits on validations (owner, 2026-10-20). A PR that needs a real-account check can ask for one in the group; the result is recorded as `real:` with its cost.

## When the gate fails

The *Spec Kit gate* check explains itself. Common causes: the branch is not `NNN-slug`; `src/` changed but the PR does not touch `specs/NNN-*/`; the folder lacks `spec.md`, `plan.md` or `tasks.md`. Renaming an open PR's branch closes the PR, so get the name right before you open it.

## When the Docs check warns

*Docs check (warning only)* warns when `src/` changed but `README.md`, `docs/` and the changelog did not, when `package.json` scripts changed but `README.md` and `docs/development.md` did not, when a non-release PR edits `CHANGELOG.md`, or when a row is added to `specs/README.md`. It never fails the PR. Fix the docs, or write `Docs: n/a <reason>` in the PR description (or ask a maintainer for the `docs-n/a` label, then save the description once: a label alone does not re-run the check). Script: `.github/scripts/docs-check.sh`, tested by `.github/scripts/test-docs-check.sh`.

## For the maintainer

- Labels: `bash .github/scripts/sync-labels.sh` (creates `spec:NNN` per spec folder, `area:*`, `status:*`). Backfill: `npm run labels:backfill` (dry run), then `-- --create-labels --apply` (add-only, throttled, safe to re-run).
- Issues from a spec: `bash .github/scripts/tasks-to-issues.sh specs/NNN-name [--task T020] [--area x] --create` (dry run without `--create`), or `/speckit-taskstoissues` (Claude) / `/speckit.taskstoissues` (Copilot; needs the GitHub MCP server). Open backlog: `.github/scripts/backlog-issues.sh`.
- After adding Spec Kit extensions or presets, run `specify integration use claude` and `specify integration use copilot` once each and commit the result; they only register for the default integration.
- Board: <https://github.com/orgs/three-feathers/projects/1> (created and refreshed by `bash .github/scripts/create-board.sh`, safe to re-run, needs `gh` scope `project`). Fields: Status (Todo, Claimed, In progress, In review, Done), Spec ID, Owner, Area. Its automation is switched on in the Project's web settings; GitHub has no API for it (steps in `specs/021-collaboration-harness/notes.md`).
- Ruleset on `main`: `.github/ruleset-main.json` (spec 021 T012).
- Cutting a release or a test build: [changelog.d/README.md](../changelog.d/README.md) (spec 008 FR-117..FR-124, FR-129). No merge freeze.

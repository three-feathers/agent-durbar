<!-- This repo is spec-driven (GitHub Spec Kit) and shared by several people and agents. Read AGENTS.md ("Working as a team") and CONTRIBUTING.md. Branch name must be NNN-slug. Never push to main. -->

## What and why

<!-- One or two sentences. -->

Closes #<!-- issue number: one issue = one Spec Kit task -->

## Spec and agent

- **Spec**: `specs/NNN-name/` (the NNN of your branch name) — link:
- **Task(s)**: `Tnnn` in that `tasks.md`:
- **Agent used** (which agent wrote this, and who is its human owner): <!-- e.g. Claude Code (fjcabello), Copilot CLI (vikramgorla), none -->
- [ ] I claimed the issue (assigned + `status:claimed`) before starting
- [ ] Every point of the linked issue is done (`Closes #N`), or what is left is written on the issue and it stays open (`Refs #N`)
- [ ] The agent did a final review of the whole diff as a reviewer (not only CI) and says below what it checked; another team's agent or a human may review too
- [ ] Before merging: every review, review thread and PR comment is read and answered, and `scripts/pr-gate.sh <N>` says *ready to merge*
- [ ] Every solvable review finding is fixed in this PR (no "non-blocking" notes or small follow-up issues left behind; AGENTS.md, *Review findings are fixed in the PR*)
- [ ] I checked that the app has no existing capability doing the same job, or this PR reuses/extends it (name it below)
- [ ] Anything I learned that other agents need is in `docs/agent-notes.md` (or: nothing new)
- [ ] CodeQL / code scanning (this PR's checks and the bot's line comments), Dependabot and secret scanning have no new finding on this PR, or each one is fixed at the cause, or dismissed as a false positive with the reason written down

## Spec Kit

- [ ] **Spec**: `specs/NNN-name/spec.md` created or updated (new feature: `/speckit.specify`; bug fix: a dated spec delta under `## Changes`) — link:
- [ ] **Plan**: `plan.md` updated or confirmed unchanged (architecture) — link:
- [ ] **Tasks**: `tasks.md` has the new/closed tasks ticked, `[KNOWN GAP]` items updated — link:
- [ ] `/speckit.analyze` showed no unresolved spec/plan/tasks conflicts, and `/speckit.converge` found nothing left open
- [ ] **Constitution check**: I re-read `.specify/memory/constitution.md` and this change follows it (or the plan's Complexity Tracking explains why not)
  - [ ] I Spec Kit · [ ] II adapter boundary · [ ] III safe by default, no stored tokens · [ ] IV no AI credits in tests
  - [ ] V calm UI (>= 10.5px, 15 agents on 1440x900 and 1280x800) · [ ] VI Windows/macOS/Linux · [ ] VIII limits documented

<!--
Only for changes with NO behavior change (typo, comment, formatting, dependency bump, CI-only fix, revert), replace this
comment with a line like the next one (or ask a maintainer for the `spec-exempt` label, then save the description once: a label alone does not re-run the check). "Small" is not a reason.

Spec-Exempt: <reason>
-->

## Docs

- [ ] **Docs updated** in this PR: whichever of `README.md`, `docs/`, `CHANGELOG.md`, the spec's `tasks.md` and the screenshots it shows are affected (list in [AGENTS.md](../AGENTS.md#keep-docs-in-sync)) — links:
- [ ] ...or **no docs impact**: I wrote a `Docs: n/a <reason>` line below (only a reminder check reads it; it never blocks)

<!--
No user-visible change, no script, permission, setting, MCP/tool, release-status or contributor change? Replace this comment
with a line like the next one. A CI check only warns when src/ changes without a docs change; it does not block.

Docs: n/a <reason>
-->

## Verification

- [ ] `npm run typecheck && npm run build && npm test` pass locally (no AI credits spent)
- [ ] Tests added or updated in `scripts/` (permission broker, attachments, launcher, history/VS Code readers, folder store, adapter mapping)
- [ ] UI change: screenshots at **1440x900** and **1280x800** with 15 simulated agents (`DURBAR_SIM=15`), added under `docs/screenshots/` and linked below
- [ ] Real-session check, if any (state the prompt count and the AI credits it used) — otherwise "simulator only"
- [ ] README/docs claims match the code; anything unverified is worded as unverified
- [ ] Screenshots I changed or that now show old wording (for example a renamed button) are replaced, or listed below as needing a real run

<!-- Screenshots / notes -->

<!-- This repo is spec-driven (GitHub Spec Kit). Read CONTRIBUTING.md "Spec Kit workflow is mandatory". -->

## What and why

<!-- One or two sentences. Link the issue if there is one. -->

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
comment with a line like the next one (or ask a maintainer for the `spec-exempt` label). "Small" is not a reason.

Spec-Exempt: <reason>
-->

## Verification

- [ ] `npm run typecheck && npm run build && npm test` pass locally (no AI credits spent)
- [ ] Tests added or updated in `scripts/` (permission broker, attachments, launcher, history/VS Code readers, folder store, adapter mapping)
- [ ] UI change: screenshots at **1440x900** and **1280x800** with 15 simulated agents (`DURBAR_SIM=15`), added under `docs/screenshots/` and linked below
- [ ] Real-session check, if any (state the prompt count and the AI credits it used) — otherwise "simulator only"
- [ ] README/docs claims match the code; anything unverified is worded as unverified

<!-- Screenshots / notes -->

# Plan: 021 Collaboration harness

## Approach
Process and tooling only, in small commits on branch `021-collab-harness`. No `src/` change, so no constitution principle II/V/VI risk; III and IV are respected (no secrets, no paid runs).

The review-efficiency proposal extends the existing checklist, PR template and agent guidance; it does not add a CI workflow or weaken existing gates. It makes pre-review readiness explicit (current-base mergeability, acceptance cases and low-cost local checks), asks authors to prepare adversarial cases early for high-risk changes, and limits repeat review work to changed deltas while retaining full checks for each new head. The evidence is case-based, not a representative measurement: #675 had the same changelog-format failure on Ubuntu and Windows, #631 had the same UI expectation failure on Linux and Windows, and #669 found new parser edge cases over multiple review rounds.

## Pieces
- **Spec Kit Claude skills**: `specify integration install claude --force` (CLI 1.2.0). Verified first on a throwaway branch: Copilot files untouched, `.claude/skills/speckit-*` (10 skills), `.specify/integrations/claude.manifest.json`, `integration.json` lists both, default stays `copilot`. `status` then exits 1 with the single finding `unsafe-multi-install` (accepted). Claude commands use hyphens (`/speckit-plan`), Copilot dots (`/speckit.plan`). `.claude/settings.local.json` is git-ignored.
- **Agent instructions**: `AGENTS.md` (+ "Working as a team"), `CLAUDE.md` (`@AGENTS.md`), copilot pointer.
- **GitHub scaffolding** (`.github/`): `ISSUE_TEMPLATE/{task,bug}.yml` + `config.yml`, `labels.tsv` + `scripts/sync-labels.sh`, `CODEOWNERS`, updated PR template.
- **Gate**: `scripts/spec-gate.sh` gains `HEAD_REF`, `PR_AUTHOR_LOGIN`, `PR_AUTHOR_TYPE`; workflow passes them and runs `scripts/test-spec-gate.sh` (throwaway git repos, Linux only, not part of `npm test`) before the gate. The job's display name stays `Spec Kit gate` (that is the status-check name).
- **Backlog**: `scripts/tasks-to-issues.sh`, `scripts/backlog-issues.sh`; run once by the maintainer's agent.
- **Board and ruleset**: board by `.github/scripts/create-board.sh` (needs scope `project`); ruleset by `gh api` after merge (bypass for the repository admin role in `pull_request` mode, i.e. admin can merge a PR without approval but not push directly). Ruleset JSON kept in `.github/ruleset-main.json` for the record.
- **Docs**: `docs/collaboration.md`, CONTRIBUTING pointer, specs index row.

## Constitution check
I yes (this spec, plan, tasks first). II n/a. III yes (no secrets; scripts read the user's own `gh` login only). IV yes. V n/a. VI scripts are bash and need git bash/WSL on Windows (documented; CI runs them on Linux). VII CI unchanged except the gate step. VIII limits listed in the spec.

## Risks
The gate is stricter (spec folder per branch number): a legitimate PR may need `Spec-Exempt`. Review after two weeks. A ruleset requiring one approval blocks the sole admin only if bypass is missing; bypass is configured.

For this proposal, avoid turning the readiness checklist into a second blocking gate: judgment remains with authors and reviewers. Push batching is advisory only, and no required platform, CI or security check is removed.

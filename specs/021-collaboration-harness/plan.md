# Plan: 021 Collaboration harness

## Approach
Process and tooling only, in small commits on branch `021-collab-harness`. No `src/` change, so no constitution principle II/V/VI risk; III and IV are respected (no secrets, no paid runs).

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

## Delta: proposed DORA evidence and review-ready preflight

- Extend the existing Bug issue form with optional deployment context, version/tag, user impact and immediate-intervention status (`Yes`, `No` or `Unknown`). Define `incident` as a flag for confirmed user impact caused by a published release, not a replacement for the `bug` type.
- Preserve explicit unknowns for the affected release, suspected introducing PR, immediate intervention, fix and recovery release. Classify corrective releases by purpose and count published user-accessible releases (including prereleases) once; exclude drafts/unpublished tags and keep pre-merge review revisions out of deployment rework.
- Make review readiness explicit in `AGENTS.md`, `docs/collaboration.md`, the PR template, reference agent prompts and the checklist: current-base mergeability, acceptance cases, inexpensive preflight checks, and exact-head CI. Encourage early adversarial cases for high-risk work and changed-delta focus in later rounds.
- These are advisory process/documentation changes: no runtime code, new service, CI workflow or blocking gate. Required platform, CI and security coverage remains unchanged.

### Constitution check

Principle I: spec, plan and tasks are updated before guidance. Principle III: no secrets or credentials are added; the issue form warns against sharing them. Principle IV: no AI-credit spending or real agent checks. Principles II, V, VI and VII are not affected. Principle VIII: historical metrics are qualified as proxies, causal unknowns are preserved, and the limits of available evidence are stated.

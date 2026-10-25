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

## Delta: DORA evidence and review-ready preflight

- Extend the existing Bug issue form with optional deployment context, version/tag, user impact and immediate-intervention status (`Yes`, `No` or `Unknown`). Define `incident` as a flag for confirmed user impact caused by a published release, not a replacement for the `bug` type.
- Preserve explicit unknowns for the affected release, suspected introducing PR, immediate intervention, fix and recovery release. Classify corrective releases by purpose and count published user-accessible releases (including prereleases) once; exclude drafts/unpublished tags and keep pre-merge review revisions out of deployment rework.
- Make review readiness explicit in `AGENTS.md`, `docs/collaboration.md`, the PR template, reference agent prompts and the checklist: current-base mergeability, acceptance cases, inexpensive preflight checks, and exact-head CI. Encourage early adversarial cases for high-risk work and changed-delta focus in later rounds.
- These are advisory process/documentation changes: no runtime code, new service, CI workflow or blocking gate. Required platform, CI and security coverage remains unchanged.

### Constitution check

Principle I: spec, plan and tasks are updated before guidance. Principle III: no secrets or credentials are added; the issue form warns against sharing them. Principle IV: no AI-credit spending or real agent checks. Principles II, V, VI and VII are not affected. Principle VIII: historical metrics are qualified as proxies, causal unknowns are preserved, and the limits of available evidence are stated.

## Delta: weekly test audit (FR-058)

- **Where:** system units on the owner's VPS (Friday 06:30 Europe/Madrid), not GitHub Actions: it runs on the owner's Claude Code plan and needs no secret in the repo.
- **Two phases, two unix users** (review of PR #756): the audit phase (`durbar-weekly-audit.service`, user `durbar-audit`, `ProtectHome=yes`, own clone, own Claude login, no token) runs Claude and the mutation helper and writes the answer to an outbox; the filing phase (`durbar-weekly-audit-file.service`, the owner, `OnSuccess=` of the audit) runs a filer installed from reviewed `main` outside the audit's reach, validates the answer and files with the token. User units were probed and do not sandbox on this host (`real:` in the spec), hence system units.
- **Pieces:** `scripts/weekly-test-audit.sh` (`audit` and `install-filer`); `scripts/weekly-test-audit.ts` (Claude argv and allow-listed environment, `launch`, prompt rendering, strict JSON validation with no links, fingerprints, dedupe, cap, issue text, `gh` through an injected runner); `scripts/weekly-test-audit-mutate.ts` (the only Bash command Claude may run: one small edit with no forbidden words, one `test:*` suite, restore); `scripts/weekly-test-audit.prompt.md`; the three unit templates and the install section in `docs/agent-setup/README.md`.
- **Security choices:** the boundary is the unix user; Claude's flags, the allow-listed environment and the helper's limits are defence in depth. The filer treats the outbox as untrusted. What the sandbox does not stop is listed in the spec.
- **Tests:** `scripts/test-weekly-audit.ts` in `npm test`: validator and filer with an injected `gh`, the helper on a scratch folder, `launch` with a fake `claude` that dumps its environment, the script's refusals, and the unit templates. Mutations planted for each guard; each fails the test.

### Constitution check

I: spec, plan and task first, in the same PR. III: no secret in the repo, logs or the audit user's reach; the token file is the owner's, 0600, visible only to the filing unit. IV: no credits spent to build or test it (fakes only); the weekly run is one session on the owner's plan, approved by the owner. VI: a Linux-only VPS tool, said so; the unit test runs on every OS and skips only its POSIX parts on Windows. VIII: limits in the spec (`[KNOWN GAP]`), including the probe result.

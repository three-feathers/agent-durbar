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

## Delta: untrusted content (FR-060)

- **Pieces:** the rule in `AGENTS.md` (canonical) with pointers in the other agent and contributor docs; one trusted list (`scripts/trusted-authors.txt`) and one set of jq helpers (`scripts/trusted-lib.sh`) used by `scripts/pr-gate.sh` and the new `scripts/gh-trusted.sh`, so the filter exists once.
- **Choice:** hide by default and show only the trusted, rather than block-list known outsiders: an unknown account is outside. Hidden items still count as asks in `pr-gate.sh`, so a PR with an outside comment waits for a human.
- **Tests:** `scripts/test-trusted-content.ts` runs the real scripts with a fake `gh` that applies each `--jq` program with jq; planted payloads must not appear.

## Delta: hot files become fragments (FR-086, accepted by both sides 2026-11-09)

- **Accepted** by Ruben's side (2026-11-08) and Paco's side (2026-11-09), decisions (a) to (d) in FR-086. One migration PR per file, in the order 5, 1, 2, 4, 3; the CI half (T071) lands after the page migrations, and the scan goes last and only if its shards pass in name order: `package.json` `test:*` order (T068), `docs/features.d/` (T069), `docs/feature-inventory.d/` (T070), the timings rule and the CI half (T071), the `ui-suite.js` scan (T072), the rule text and the README warning (T073).
- **Reuse:** `scripts/changelog.js`'s name rule and bullet parser move to a shared module used by a new `scripts/fragments.js` (`build`, `--check` offline in `npm test`, `--pr-check` in the existing `spec-numbers` job of `spec-kit.yml`); the daily fold PR runs `fragments:build` beside `changelog:build`; `scripts/feature-inventory.js` reads fragments; `test-ui-suite.ts`'s FR-057 scan becomes `DRIVERS`.
- **Each migration PR shows equivalence:** the assembled page equals today's byte for byte, `--list` prints the same labels, the parsed `package.json` is equal.
- **Constitution:** I (spec first, this PR); III (no secret, no PR text in a shell; paths through `safe-print.js`); IV (no credits); VI (plain Node, LF-normalised reads, lower-case names, code-unit sort); VIII (counts are a replay, gaps in the spec).

## Delta: parity checklists tick themselves (FR-088, 2026-11-09)

- An `issues` workflow, not a merge-skill step: it fires on every close, whoever closes the issue and however (a `Closes #N` merge, the merge queue, by hand), so nobody has to remember. Each run reconciles every tracker line with the live issue states instead of acting on the triggering issue, because GitHub cancels a pending run when a newer one queues in the same concurrency group; `workflow_dispatch` and a daily schedule are backstops. Pure text transform in `scripts/parity-tick.js` (unit-tested), GitHub calls in the same file through `gh` with `execFileSync`. Tracker numbers in `.github/parity-trackers.json` (CODEOWNERS). Existing capability (FR-031): `weekly-retro.yml` and `scripts/weekly-retro.js` are the pattern (same permission style, pinned checkout, `gh` without a shell); `scripts/trusted-authors.txt` is the trust list reused.

## Delta: no shared append points, no merge of main without a reason, PR size (FR-383, 2026-11-22; proposal, waits for all three owners)

- **Measured first** (spec FR-383): of 442 merge-main commits in the last 300 merged PRs, 259 conflicted, 183 only in `spec.md`/`tasks.md`; the other 183 had no conflict (82 shared no file with `main`'s side), asked for by the *Review-ready* line, not by the ruleset (not strict; the merge queue tests against `main`); 29 renumber commits on `main` in 11 days; 9 of 442 merge-mains followed an approval. Test registration hardly conflicts any more (`package.json` 1, `test-suites.txt` 0): not proposed.
- **Order:** readers before writers. T448 (fragment readers, `specs:view`) and T451 (dotted ids read) change nothing for anyone and can land before the decisions; T452 (the *Review-ready* line) needs only D3 and D5 and nothing built; T449/T450 (fold, rule, CI half) after D1 and D5 and after FR-086's CI half (T071); T453 (old-style refused) after D2 and D5; T454 (PR size words) after D4 and D5, nothing built. T452, T453 and T454 touch AGENTS.md and go in one rule-text PR when decided together.
- **Reuse:** `changelog.js`'s name rule and fold pattern, FR-086's `fragments.js` (`--check`, `--pr-check`, page-hash guard), `spec-numbers.js`'s definition parser, the `durbar-fold` skill, the merge queue and `pr-gate.sh`. One fold function serves both `specs:fold` and `specs:view`.
- **Each migration PR shows equivalence:** `specs:view` of an unchanged spec equals `spec.md` byte for byte; the fold of a fixture spec equals the hand-appended version.
- **Constitution:** I (spec first; this PR is spec-only); III (no token in the CI half, PR paths through `safe-print.js`); IV (no credits); VI (plain Node, LF reads, lower-case names, code-unit sort); VIII (counts are a replay; gaps in the spec).

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

## Delta: a PR preflight for authors (FR-384, 2026-11-22)

- One Node script, not bash: the repo needs Windows parity, so `scripts/pr-preflight.js` calls `git` and `gh` with argument arrays (`execFileSync`, `spawnSync`, no shell); `scripts/pr-preflight.sh` only forwards to it. Reuse (FR-031): the spec-number parser and `collect` of `scripts/spec-numbers.js`, `scripts/safe-print.js` for every printed line, `scripts/trusted-authors.js` (the one loader of the trusted list, FR-092) for the author check.
- `preflight(n, { gh, root, fetch, trusted })` takes `gh` as a function, so the test drives it with fixture answers and a throwaway repository (`git commit-tree` with a temporary index, no working tree), offline.
- Merge-only: `git merge-tree --write-tree --name-only` gives the plain merge's tree and the conflicted paths; `git diff --name-only` against the merge commit names what changed beyond it.
- **Constitution:** I (spec first, this PR); III (no PR text in a shell, nothing of the body printed, read-only); IV (no credits: `gh` reads only); VI (Node, no POSIX path or shell).

## Delta: delivery speed rule text and the no-shared-append-points proposal (FR-383, 2026-11-23)

- **Only decided words land:** *Review-ready* and *PR size* in `docs/rules/review-rounds.md` (three owners, records on #2029), spec 117 O4's line word for word (three owners, records on #1995), the FR-087 job-limit case in the `durbar-ci-rerun` skill (Vikram, #1983). No other rule sentence is reworded or trimmed; the budgets hold (AGENTS.md 1,999 of 2,000, `review-rounds.md` 679 of 680, total 3,522 of 3,525).
- **D1 order, if decided:** readers before writers. T448 and T451 change nothing for anyone and may land before the answer; T486 (fold, CI half, AGENTS.md step 1) only after the three owners' yes and after FR-086's CI half (T071). Reuse: `changelog.js`'s name rule and fold pattern, `scripts/fragments.js`, `spec-numbers.js`'s definition parser, the `durbar-fold` skill; one assemble function serves `specs:view` and `specs:fold`.
- **Constitution:** I (spec, plan and tasks first in this PR); III (no secret; the planned CI half needs no token and prints PR paths through `safe-print.js`); IV (no credits); VI (plain Node, LF reads, lower-case names, code-unit sort); VIII (gaps written as `[KNOWN GAP]`).

## 2026-11-25: `npm run pr:ready` (FR-422)

- `scripts/pr-ready.js`: a list of guards, each a function of one context (`run(cmd, args)`, the changed files, the merge-base); the runner is injectable, so `scripts/test-pr-ready.ts` drives it without a repository, and real git only in three cases. Mutants drop one guard line each and read the test's own `PR-READY-<guard>` tags.
- Reuse (FR-031): `pr-preflight.js` exports `shapeHits`, `AI_LINE`, `linesByFile`; the checks themselves are the existing scripts, called by the Node binary with a fixed argv, so no `npm` shim and no shell (Windows).
- **Constitution:** I (spec first, this PR); III (no PR text in a shell, a commit message matched and never printed); IV (no credits: git and node only); VI (Node, `path.join`, no shell).

## 2026-11-25: reference checks in `rules:check` (FR-423)

- `scripts/harness-refs.js` exports `check(root, budgets)` and returns problem lines; `scripts/rules-check.js` appends them in `main()`, so the word-budget fixtures stay unchanged. Plain Node, `path.join`, lines split on `\r?\n` only; missing files are skipped (the budget check reports them). The pointer scope is the set of files whose change already runs `npm test` (adversarial check of the harness plan), because the docs-only CI skip would let a dead pointer in another `docs/` file merge green and break `main` later.
- Reuse (FR-031): `markersIn` of `scripts/specs-index.js`, the budget table and rule-file list of `rules-check.js`, `.github/labels.tsv`; tests extend `scripts/test-rules-check.js`, whose mutants rewrite a copy of the checker and must make the fixture's own assert text fail.
- **Constitution:** I (spec first, this PR); III (reads repository text only, prints paths and line numbers, never the matched text beyond a section or label name); IV (no credits: Node only); VI (Node, no shell, no POSIX-only path, CRLF-safe); VIII (a limit is written: the scope above, the check reads rule text and never edits it).

## 2026-11-25: `rules:fresh` and the stale gate (FR-424, FR-425)

- One Node script for the question "which rule files moved on main" (`scripts/rules-fresh.js`: `git` through `execFileSync` with fixed arguments, no shell, `--root` for tests) and one shell function for the gate's own files (`gate_stale` in `scripts/trusted-lib.sh`, the library `pr-gate.sh` and `gh-trusted.sh` already source), because the gate is bash and must not start Node for a compare that two `git` calls answer. `claim.sh` calls the Node script, so the file list exists once (`FRESH_PATHS` in `scripts/rules-check.js`).
- The gate compares blobs (`git hash-object` of the file on disk against `origin/main:<file>`), not `HEAD`: an uncommitted edit of the gate also refuses. Reuse (FR-031): `rules-check.js`' rule-file knowledge, `trusted-lib.sh`, the tests' fake-`gh` folders on PATH; the tests add one fake `git` (`scripts/fake-git.js`) instead of a bypass variable in the scripts, so the code under test is the code that runs.
- Review round 1 (Paco's side): the fetch names its refspec (`+refs/heads/main:refs/remotes/origin/main`) in the shell function and in `rules-fresh.js`; "not a checkout" means no `.git` entry at all, a git failure where a `.git` exists refuses; `gh-trusted.sh` compares itself and refuses on a failed fetch; the gate inputs and `scripts/*.sh` are pinned to LF in `.gitattributes` (the existing file, appended, not reordered).
- Shell edits are minimal: one line each in `pr-gate.sh` (block reason), `gh-trusted.sh` (refusal), `claim.sh` (note); their existing behaviour and cases are unchanged.
- **Constitution:** I (spec first, this PR); III (no outside text in a command: the file list is fixed, no commit subject is ever printed (it can be an outsider's text): `rules:fresh` prints the file name, through `safe-print.js`, and a short sha; nothing secret is read); IV (no credits: git and node only, one fetch); VI (plain Node with `path.join`, bash only where the scripts already are, CRLF-safe line splits and a CRLF-normalised read in the test); VIII (the limits are written in the spec: the fixtures are not the real remote, a running session's old import is invisible).

## 2026-11-26: `gh-trusted.sh --list` (FR-426)

- One more reader of the same trust filter, not a second one: the list is a second GraphQL query in `scripts/gh-trusted.sh` that reuses `JQ_TRUST` (`who`, `trusted`) and adds one local def (`lg`) for gh's `app/<slug>` form. Rows are built by `--jq` only; the title is a JSON string, so a newline cannot start a second line, and the output passes through `scripts/safe-print.js` (given a small stdin command) for bidi, `::` and `##[`. `--state` and `--label` are validated and sent as GraphQL variables; nothing from GitHub enters a shell string.
- Reuse (FR-031): `trusted-lib.sh`, `safe-print.js`, `gate_stale`, the existing fake `gh` and fake `git`. One name is added to `GATE_FILES` (an owner path, minimal change, said in the PR).
- **Constitution:** I (spec first, this PR); III (the whole point: an outsider's text is never printed, only its link; no secret read); IV (no credits: `gh` reads and Node only); VI (bash only where the script already is, node for the printer, LF-pinned, line-ending-normalised mutants); VIII (limits written: 50 items, a fixture for the fork case, no Windows run).

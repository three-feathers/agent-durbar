# Tasks: 103 Pre-review bot

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: required (constitution VII). Node tests with fakes; 0 credits, no network. Only T011, T012 spend, and only after the owner's ask.

**Format**: `- [ ] Tnnn [P?] description [requirements]`, then its test. Numbers taken: spec 103, FR-001..FR-025, SC-001..SC-004, T001..T014; in spec 021, FR-069.

## Phase 0: Spec (this PR)

- [x] T001 Spec, plan, tasks, `specs-index` block, spec 021 FR-069. Test: `npm run specs:check`, `rules:check`, `changelog:check`.

## Phase 1: Core, no SDK, no key

- [ ] T002 `scripts/prereview-core.ts`: `refusal(pr, commits, trusted)`, `confine(toolCall, worktree, realpath)`, `minimalEnv`, `keyFileProblems`, `diffProblems`, ledger with `mayRun(ledger, ceilings, now)`, report validation, allow-list and masking (`maskTokenShapes`, then cut). Test: `test:prereview`: exact-cap diff, unicode and `..` paths, link to the key, `.git`, absolute Grep and Glob patterns; unknown cost counted at the ceiling; CRLF files [FR-004, FR-009, FR-011, FR-013, FR-015..FR-018, FR-023]
- [ ] T003 `scripts/gh-trusted.sh <N> --pr-text`. Test: `test:trustedcontent` with its fake `gh`: outside title and body hidden, no comment text at all, payload absent [FR-005]
- [ ] T004 `prereview.sh` and `run.mts` with `query` injected; worktree without hooks or filters; lock, cleanup, sweep; `scripts/fakes/agent-sdk.ts`. Test: `test:prereview` end to end: a fake on `PATH` for `gh`, `git` and `sudo` records each call; a planted marker hook does not fire; `gh` saw no write; a killed run is swept; merged PR refused without `--replay`, replay sha off the PR refused [FR-001..FR-003, FR-006, FR-007]

## Phase 2: The SDK, no real call

- [ ] T005 `scripts/prereview/package.json`, exact pin, lockfile; `test:supplychain` reads it; root `npm ci`, `tsc -p tsconfig.scripts.json` and `electron-builder` `files` stay free of it; `outputFormat` and `init` fields checked against the pinned types. Test: `test:supplychain` with a bad entry in the second lockfile; `grep` of the root lockfile [FR-022]
- [ ] T006 The box: options as in the plan; the `init` check; statuses `ok`, `declined`, `stopped`, `unusable`, `misconfigured`. Test: `test:prereview`, a fake `init` per wrong field aborts before a prompt; a refusal and a budget stop are reported, never as clean [FR-008, FR-010, FR-018, FR-020]
- [ ] T007 Prompts in `scripts/prereview/prompts/`; `--help` prints FR-025's limits. Test: `test:prereview`: prompts come from the install folder even when the fixture PR changes them [FR-007, FR-019, FR-025]
- [ ] T008 `install` step from reviewed `main`, refused otherwise (as `weekly-test-audit.sh install-filer`). Test: `test:prereview` on a dirty and an off-main checkout [FR-007]
- [ ] T009 `docs/agent-setup/README.md`, `scripts/prereview/README.md`, CODEOWNERS, `docs/agent-notes.md` entry, one line in `AGENTS.md` that a pre-review is not a review, naming what it replaces (FR-063). Test: `rules:check`, `test:docsscripts` [FR-003, FR-013, FR-014]
- [ ] T010 Mutants, listed in the PR: refusal removed; hook allows outside; symlink kept; env inherits; `--pr-text` shows a comment; a `gh` write; unknown cost is 0; ceiling raised; an extra send; mask after cut. Each fails `test:prereview` or `test:trustedcontent`. Test: SC-001 [SC-001]

## Phase 2b: Added 2026-11-01 (owner's order, FR-026..FR-029)

- [ ] T015 Codex runner (`--runner codex|both`): diff-only prompt, read-only sandbox, refusal when the account holds credential folders. Test: `test:prereview` with a fake `codex` on `PATH`, outside text never on its stdin [FR-026]
- [ ] T016 `post` as the App behind the off-by-default gate; JWT signed inside one function; token in memory. Test: gate cases (flag off, Paco missing), generated key, fake `fetch`, no other write call [FR-027]
- [ ] T017 Results folder and `--out`. Test: file modes, `unusable` raw kept local only [FR-028]
- [ ] T018 Adversarial text in title, body, diff, file contents and model answer stays data. Test: mutants in the PR list [FR-029]

## Phase 3: Real, owner's ask (spends credits)

- [ ] T011 **Owner:** the key steps in the plan; Q1 to Q3 answered. Then one run, on the smallest open trusted PR. Say the cost first. Check the `init` line, a denial from a planted path, the ledger against the Console, **and that the credit balance is what fell**. Stop if not. Test: `real:` recorded [FR-010, FR-013, FR-014, FR-021]
- [ ] T012 The rest of FR-021's five uses, within the ceilings. Test: `real:` [FR-021]
- [ ] T013 Dated delta with the measured numbers, and the report to the owner; a log and report scan for secrets; `/speckit.converge`. Test: `real:`, SC-002, SC-003 [FR-021, SC-002, SC-003]
- [ ] T014 Owner's decision on v1: keep, change model, or stop and revoke the key. Test: dated FR in spec 021 [SC-004]

`[P]`: T003 with T002. Each phase is one PR.

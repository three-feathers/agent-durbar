# Tasks: 103 Pre-review bot

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: required (constitution VII). Node tests with fakes; 0 credits, no network. Only T011, T012 spend, and only after the owner's ask.

**Format**: `- [ ] Tnnn [P?] description [requirements]`, then its test. Numbers taken: spec 103, FR-001..FR-025, SC-001..SC-004, T001..T014; in spec 021, FR-069.

## Phase 0: Spec (this PR)

- [x] T001 Spec, plan, tasks, `specs-index` block, spec 021 FR-069. Test: `npm run specs:check`, `rules:check`, `changelog:check`.

## Phase 1: Core, no SDK, no key

- [x] T002 `scripts/prereview-core.ts`: `refusal(pr, commits, trusted)`, `confine(toolCall, worktree, realpath)`, `minimalEnv`, `keyFileProblems`, `diffProblems`, ledger with `mayRun(ledger, ceilings, now)`, report validation, allow-list and masking (`maskTokenShapes`, then cut). Test: `test:prereview`: exact-cap diff, unicode and `..` paths, link to the key, `.git`, absolute Grep and Glob patterns; unknown cost counted at the ceiling; CRLF files [FR-004, FR-009, FR-011, FR-013, FR-015..FR-018, FR-023]
- [x] T003 `scripts/gh-trusted.sh <N> --pr-text`. Test: `test:trustedcontent` with its fake `gh`: outside title and body hidden, no comment text at all, payload absent [FR-005]
- [x] T004 `prereview.sh` and `run.mts` with `query` injected; worktree without hooks or filters; lock, cleanup, sweep; `scripts/fakes/agent-sdk.ts`. Test: `test:prereview` end to end: a fake on `PATH` for `gh`, `git` and `sudo` records each call; a planted marker hook does not fire; `gh` saw no write; a killed run is swept; merged PR refused without `--replay`, replay sha off the PR refused [FR-001..FR-003, FR-006, FR-007]

## Phase 2: The SDK, no real call

- [x] T005 `scripts/prereview/package.json`, exact pin, lockfile; `test:supplychain` reads it; root `npm ci`, `tsc -p tsconfig.scripts.json` and `electron-builder` `files` stay free of it; `outputFormat` and `init` fields checked against the pinned types. Test: `test:supplychain` with a bad entry in the second lockfile; `grep` of the root lockfile [FR-022]
- [x] T006 The box: options as in the plan; the `init` check; statuses `ok`, `declined`, `stopped`, `unusable`, `misconfigured`. Test: `test:prereview`, a fake `init` per wrong field aborts before a prompt; a refusal and a budget stop are reported, never as clean [FR-008, FR-010, FR-018, FR-020]
- [x] T007 Prompts in `scripts/prereview/prompts/`; `--help` prints FR-025's limits. Test: `test:prereview`: prompts come from the install folder even when the fixture PR changes them [FR-007, FR-019, FR-025]
- [x] T008 `install` step from reviewed `main`, refused otherwise (as `weekly-test-audit.sh install-filer`). Test: `test:prereview` on a dirty and an off-main checkout [FR-007]
- [x] T009 (done except the AGENTS.md line: not edited, owner's order; docs/agent-notes.md is at its word budget, so the pitfalls are in scripts/prereview/README.md) `docs/agent-setup/README.md`, `scripts/prereview/README.md`, CODEOWNERS, `docs/agent-notes.md` entry, one line in `AGENTS.md` that a pre-review is not a review, naming what it replaces (FR-063). Test: `rules:check`, `test:docsscripts` [FR-003, FR-013, FR-014]
- [x] T010 Mutants, listed in the PR: refusal removed; hook allows outside; symlink kept; env inherits; `--pr-text` shows a comment; a `gh` write; unknown cost is 0; ceiling raised; an extra send; mask after cut. Each fails `test:prereview` or `test:trustedcontent`. Test: SC-001 [SC-001]

## Phase 2b: Added 2026-11-01 (owner's order, FR-026..FR-029)

- [x] T015 [REMOVED 2026-11-01, FR-034] Codex runner (`--runner codex|both`): diff-only prompt, read-only sandbox, refusal when the account holds credential folders. Test: `test:prereview` with a fake `codex` on `PATH`, outside text never on its stdin [FR-026]
- [x] T016 `post` as the App behind the off-by-default gate; JWT signed inside one function; token in memory. Test: gate cases (flag off, Paco missing), generated key, fake `fetch`, no other write call [FR-027]
- [x] T017 Results folder and `--out`. Test: file modes, `unusable` raw kept local only [FR-028]
- [x] T018 Adversarial text in title, body, diff, file contents and model answer stays data. Test: mutants in the PR list [FR-029]

- [x] T019 Review fixes of #997 (FR-030..FR-033): Codex key-readability refusal and no `both`, runnable `--run-as` command, signed gate payload, safe results writes, glob and `~` allow-list, post gate limits, killed-run needs-look and `ack`, gh-config env refusals, Dependabot entry, tsx upgrade. Test: `test:prereview` (each case fails when its fix is removed), `test:supplychain` [FR-030..FR-033]

- [x] T020 Second review round (FR-034..FR-038): Codex runner removed; hook whitespace, quote and control refusal; real `init` allow-list incl. StructuredOutput; the real binary against a loopback mock in `test:prereview` (+ the Ubuntu CI install step); `ack` needs a terminal and a typed word, `--run-as` for the bot user's ledger. Test: `test:prereview` [FR-034..FR-038]

- [x] T021 Third review round (FR-039..FR-042): strip-then-mask and `renderReport` masking, ignore files removed and tested against the real Grep, CI fails instead of skipping the real-SDK test, the key to the claude process on fd 3. Test: `test:prereview` [FR-039..FR-042]

- [x] T022 Fourth review round (FR-043, FR-044): glued key and every private-key-block spelling masked, not-searched paths named in the report. Test: `test:prereview` [FR-043, FR-044]

- [x] T023 Review of Paco's side (FR-045..FR-047): root-owned top folder, ancestor-ownership check for code, trust list, `gh-trusted.sh`, gate key and install; operator writes nothing into the bot's folders; one repository constant, signed; title-rename count; FR-013 text. Test: `test:prereview`, `test:trustedcontent` [FR-045..FR-047]

## Phase 3: Real, owner's ask (spends credits)

- [ ] T011 **Owner:** the key steps in the plan; Q1 to Q3 answered. Then one run, on the smallest open trusted PR. Say the cost first. Check the `init` line, a denial from a planted path, the ledger against the Console, **and that the credit balance is what fell**. Stop if not. Test: `real:` recorded [FR-010, FR-013, FR-014, FR-021]
- [ ] T012 The rest of FR-021's five uses, within the ceilings. Test: `real:` [FR-021]
- [ ] T013 Dated delta with the measured numbers, and the report to the owner; a log and report scan for secrets; `/speckit.converge`. Test: `real:`, SC-002, SC-003 [FR-021, SC-002, SC-003]
- [ ] T014 Owner's decision on v1: keep, change model, or stop and revoke the key. Test: dated FR in spec 021 [SC-004]

`[P]`: T003 with T002. Each phase is one PR.

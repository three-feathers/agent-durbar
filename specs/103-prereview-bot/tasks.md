# Tasks: 103 Pre-review bot

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: required (constitution VII). Node tests with fakes; 0 credits, no network. Only T011, T012 spend, and only after the owner's ask.

**Format**: `- [ ] Tnnn [P?] description [requirements]`, then its test. Numbers taken: spec 103, FR-001..FR-025, SC-001..SC-004, T001..T014; in spec 021, FR-069. Delta 2026-11-12: FR-048..FR-068, SC-005..SC-007, Q6..Q14, T025..T042.

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

- [x] T024 Re-review of Paco's side (amends FR-045): install empties its destination, plain-file read by one open, ancestors as written, no `|| true` assertions. Test: `test:prereview`

## Phase 3: Real, owner's ask (spends credits)

- [ ] T011 **Owner:** the key steps in the plan; Q1 to Q3 answered. Then one run, on the smallest open trusted PR. Say the cost first. Check the `init` line, a denial from a planted path, the ledger against the Console, **and that the credit balance is what fell**. Stop if not. Test: `real:` recorded [FR-010, FR-013, FR-014, FR-021]
- [ ] T012 The rest of FR-021's five uses, within the ceilings. Test: `real:` [FR-021]
- [ ] T013 Dated delta with the measured numbers, and the report to the owner; a log and report scan for secrets; `/speckit.converge`. Test: `real:`, SC-002, SC-003 [FR-021, SC-002, SC-003]
- [ ] T014 Owner's decision on v1: keep, change model, or stop and revoke the key. Test: dated FR in spec 021 [SC-004]

`[P]`: T003 with T002. Each phase is one PR.

## Phase 4: Samikshak as an official reviewer (delta 2026-11-12; DRAFT, nothing enabled)

Order is the dependency order. No task here starts before the owners' answers it names; none spends credits before switch 1 is confirmed and its ceilings are set (FR-057, Q8). Every code task is reviewed under the `scripts/prereview*` CODEOWNERS lines (an owner account).

- [ ] T025 **Owners:** answer Q6..Q14 of the delta; Vikram sets the ceilings (FR-057) and the Console limit; Q14's Actions setting off. Test: dated owner decisions in this spec and spec 021 [FR-048, FR-049, FR-057]
- [ ] T026 **Owner check, read-only first, then one test (owner's call):** settle Q12. Read-only: the App's permissions (`gh api /repos/three-feathers/agent-durbar/installation` with an App JWT, by the operator; or the App's settings page) and GitHub's docs on who counts toward required approvals. Test, only on a scratch repository of the org with the same ruleset (1 approval, code-owner review on): the App approves a PR by another account; `gh pr view <N> --json reviewDecision,mergeStateStatus` shows `APPROVED` or `REVIEW_REQUIRED`. Never on this repository. Test: `real:` recorded [FR-063, Q12]
- [ ] T027 FR-042's strong form (FR-056): the key proxy under a third uid, `POST /v1/messages` only, server-side ceilings and per-run log; the bot's uid cannot read the key. Depends on T025. Test: `test:prereview` with a loopback API mock (fake key): a request other than `POST /v1/messages` is refused, a ceiling stops a send, the bot's uid gets `EACCES` on the key file, `/proc/<pid>/environ` holds no key [FR-056, FR-042]
- [ ] T028 Sandbox runner (FR-055): container or namespace per run as `durbar-prereview`, memory, CPU, process and time caps, no network but the proxy socket, offline `npm ci` cache built operator-side from reviewed lockfiles, own-PID cleanup, Electron `flock`, throwaway worktree. Depends on T027. Test: `test:prereview` (Linux, skipped with a printed line elsewhere): a planted `curl`, a read of the key path, a write outside the tree, a fork bomb and an over-time run each fail inside the box and are reported; nothing remains after the run [FR-055, FR-058]
- [ ] T029 Classifier (FR-060, FR-061): `scripts/prereview-classify.ts` and its data file; renames (both names), mode, symlink, submodule, binary, unreadable and content-match cases; the renderer permission-card files named from the code. Independent of T027/T028. Test: `test:prereview`: one fixture per class; a mutant per class (drop the pattern) fails a named assert; unknown input is sensitive [FR-060, FR-061, SC-007]
- [ ] T030 Recipe prompts (FR-050..FR-054) as reviewed files in `scripts/prereview/prompts/`, derived from the two sides' setups (ask each side's agent to check the derived text against its own setup and say so on the PR): the risk-list pass, the run plan, the review, the delta round; model choice by class and size. Changes need an owner account (CODEOWNERS). Depends on T025. Test: `test:prereview`: prompts come from the installed copy; a PR changing them is reviewed with the old ones [FR-050..FR-054, FR-007]
- [ ] T031 Output schema and gate-side state computation (FR-053): numbered required fixes with `input -> output`, `path:line`, fix, how shown; Checked / Not checked; mutants with killing asserts; still no verdict field. Test: `test:prereview`: a verdict field is dropped; a finding without `path:line` is rejected; an `injection` finding forces COMMENT [FR-053, FR-018, FR-065]
- [ ] T032 Rounds (FR-054): resume the same session for delta rounds; merge-only heads by patch id of `src` and `scripts`, no model call. Test: `test:prereview` with fixtures of a merge-only head and a real change [FR-054]
- [ ] T033 Ledger and the findings map (FR-066): one line per run; the coordinating session's map of later human fixes to bot findings; a report command printing precision and recall per class. Test: `test:prereview`: no diff, prompt or secret in a line (scan), unknown cost counts at the ceiling [FR-066, SC-005]
- [ ] T034 **Switch 1, shadow (needs T025, T027, T028, T030..T033 merged and Vikram's OK for the ceilings):** run on eligible PRs in parallel with the human-account reviews; nothing posted. Test: `real:` ledger lines; cost per run against the proxy log and the Console [FR-049, FR-057, FR-066]
- [ ] T035 Acceptance report (FR-067): a dated delta with the shadow numbers per class, false positives and cost; the owners decide. Depends on T034. Test: `real:`, SC-006 [FR-067, SC-006]
- [ ] T036 Deterministic approve gate (FR-064): operator-side script, every condition re-read at one moment, `commit_id` pinned, tripwire (FR-065), refusal reasons in the review's first line. Depends on T029, T031. Test: `test:prereview` with a fake `gh` and fake `fetch`: each failed condition alone yields COMMENT or no post; a moved head refuses; a sensitive PR never APPROVE; the tripwire stops the fourth approval for one author; the only write calls are the three allowed ones (FR-027's allow-list extended to `POST .../pulls/<N>/reviews`) [FR-064, FR-065, SC-007]
- [ ] T037 `pr-gate.sh` reads the App's review **state**, never its body, behind the same switch; outside-text handling unchanged. Depends on Q6. Test: `test:trustedcontent` with a fake `gh`: the App's APPROVE counts only with the switch on; its body is never printed [FR-068, Q6]
- [ ] T038 **Owner:** the structural backstop of FR-063 (Q11): `CODEOWNERS` extended to the FR-060 classes not yet in it, or ruleset `required_reviewers`. Test: `read:` the ruleset or `CODEOWNERS` after the change [FR-063, Q11]
- [ ] T039 Switch 2, comment, per Paco's conditions and Q6 (FR-027 gate with the three dated confirmations). Depends on T027, T036 (COMMENT path only). Test: `real:` one comment on one of our PRs, read back [FR-049, FR-027]
- [ ] T040 Rule text of FR-068, applied in one PR that names each replaced line (spec 021 FR-063), with `rules:check`; only after the owners' yes for switch 3. Test: `rules:check`, owner review via CODEOWNERS [FR-068]
- [ ] T041 Switch 3, approve: needs T026 (counts), T035 (gate met), T036, T037, T038, T040 and the three dated confirmations. Test: `real:` the first bot approval on a non-sensitive PR, and a ledger scan for SC-007 [FR-049, FR-059..FR-064, SC-007]
- [ ] T042 Record the owners' decisions as a dated FR in spec 021 (chat-and-decisions, FR-037) and `/speckit.converge` this spec and plan (architecture section for the sandbox and proxy). Test: `specs:check` [FR-048]

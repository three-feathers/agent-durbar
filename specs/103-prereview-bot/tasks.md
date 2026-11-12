# Tasks: 103 Pre-review bot

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: required (constitution VII). Node tests with fakes; 0 credits, no network. Only T011, T012 spend, and only after the owner's ask.

**Format**: `- [ ] Tnnn [P?] description [requirements]`, then its test. Numbers taken: spec 103, FR-001..FR-025, SC-001..SC-004, T001..T014; in spec 021, FR-069. Delta 2026-11-12: FR-048..FR-071, SC-005..SC-007, Q6..Q15, T025..T046.

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

- [ ] T025 **Owners:** answer Q6..Q13 and Q15; Vikram sets the ceilings (FR-057) and the Console limit. (Q14, the Actions setting, is Vikram's own action now and waits for nothing.) Test: dated owner decisions in this spec and spec 021 [FR-048, FR-049, FR-057]
- [ ] T026 **Owner check, read-only first, then one test (owner's call):** settle Q12. Read-only: the App's installation permissions (App settings page, or `gh api /repos/three-feathers/agent-durbar/installation` with an App JWT by the gate) and GitHub's docs on whose approvals count. Test, only on a scratch repository of the org with the same ruleset (1 approval, code-owner review on, a CODEOWNERS catch-all with a no-owner allow-list line): the App approves a PR by another account touching only an allow-listed path, then one touching an owned path; `gh pr view <N> --json reviewDecision,mergeStateStatus` shows `APPROVED` or `REVIEW_REQUIRED` for each. Never on this repository. Test: `real:` recorded [FR-063, FR-070, Q12]
- [ ] T027 Key proxy (FR-056) under its own uid: `POST /v1/messages` only, ceilings, per-run log; no other uid reads the key. Depends on T025. Test: `test:prereview` with a loopback API mock (fake key): another method or path refused, a ceiling stops a send, `EACCES` for the model uid on the key file, no key in `/proc/<pid>/environ` [FR-056, FR-042]
- [ ] T028 Four-user layout (FR-055): exec namespace per run with caps, no network, private Xvfb, read-only npm cache from reviewed lockfiles, own Electron lock with timeout, own-PID cleanup; model uid with a read-only copy; gate uid with one `sudo` entry point taking only a PR number. Depends on T027. Test: `test:prereview` (Linux; a printed skip elsewhere): from the exec uid a planted `curl`, a write to the model's copy, the report path or the ledger, a read of either key, a fork bomb, a lock held past its timeout and an over-time run each fail and are reported; nothing remains after the run [FR-055, FR-058]
- [ ] T029 Classifier (FR-060, FR-061): `scripts/prereview-classify.ts` and its data file; renames (both names), new files, mode, symlink, submodule, binary, `.svg`, unreadable, CSS `url(`/`@import`/`expression(`. Independent of T027/T028. Test: `test:prereview`: a fixture per allow-list line and per refusal; a mutant per line (widen or drop it) fails a named assert; unknown input is `owner-review` [FR-060, FR-061, SC-007]
- [ ] T030 Recipe prompts (FR-050..FR-054) as reviewed files in `scripts/prereview/prompts/`, derived from the two sides' setups (each side's agent checks the derived text against its own setup on the PR): risk-list pass, run plan, review, delta round; model choice by class and size. Depends on T025. Test: `test:prereview`: prompts come from the installed copy; a PR changing them is reviewed with the old ones [FR-050..FR-054, FR-007]
- [ ] T031 `run_check` (FR-052): fixed kinds only, executed in the exec uid, output capped, masked and marked as data; installs `--offline --ignore-scripts`; a PR touching `package.json`, a lockfile or `.npmrc` runs nothing; the runner's own log of commands and exit codes. Depends on T028. Test: `test:prereview`: an unknown kind or extra argument refused; a dependency PR runs no command; a test that prints "0 required fixes" changes nothing in the gate's view [FR-052, FR-065]
- [ ] T032 Output schema and rounds (FR-053, FR-054): required fixes with `input -> output`, `path:line`, fix, how shown; Checked / Not checked with paths; no verdict field; resume the same session; merge-only heads by the whole-diff patch id; classifier on every head. Test: `test:prereview`: a verdict field dropped; a finding without `path:line` rejected; an `injection` finding forces COMMENT; a merge that also changes `package.json` is not merge-only [FR-053, FR-054, FR-018]
- [ ] T033 Gate-side ledger and the findings map (FR-066): written by the gate uid only; tripwire counted from GitHub's reviews API; a report command printing precision and recall per class. Test: `test:prereview` with a fake `gh`: the tripwire refuses the fourth approval for one author from API data alone; a ledger line holds no diff, prompt or secret (scan) [FR-066, SC-005]
- [ ] T034 **Switch 1, shadow** (needs T025, T027..T033 merged and Vikram's OK for the ceilings; another side's PRs only on that owner's yes): run on eligible PRs alongside owner-account reviews; nothing posted. Test: `real:` ledger lines; cost against the proxy log and the Console [FR-049, FR-057, FR-066]
- [ ] T035 Acceptance report (FR-067): replay recall per class, red-team results, shadow numbers per class, false positives, cost; the owners decide. Depends on T034, T043, T044. Test: `real:`, SC-006 [FR-067, SC-006]
- [ ] T036 Deterministic approve gate (FR-064): each of its ten inputs re-read at one moment by the gate uid; sha from the signed payload; five named checks; `commit_id` pinned; COMMENT with numbered fixes, never REQUEST_CHANGES. Depends on T029, T032, T033, T045. Test: `test:prereview` with a fake `gh` and `fetch`: **one refusal test per input** (each failed alone yields COMMENT or no post); a report naming another sha is ignored; an outside-list PR never APPROVE; the only write calls are FR-027's three plus `POST .../pulls/<N>/reviews` [FR-064, FR-065, SC-007]
- [ ] T037 `pr-gate.sh` (FR-071): recognise the App by login and id; its APPROVE counts only with switch 3 on; its COMMENT answered by a later head's run or an owner-account reply; its body never printed; `--json` verdict. Depends on Q6. Test: `test:trustedcontent` with a fake `gh`: no deadlock on an App review, the body never appears, `--json` matches the text verdict [FR-071, FR-068]
- [ ] T038 **Owner:** the `CODEOWNERS` change of FR-063 (catch-all, no-owner allow-list, re-owned rule files, the named supply-chain and gate scripts), or ruleset `required_reviewers` (Q11). Hard precondition of T041. Test: `read:` `CODEOWNERS` after the change, and T026's scratch result [FR-063, Q11]
- [ ] T039 Switch 2, comment, per Paco's conditions and Q6, through the gate. Depends on T027, T028, T036 (COMMENT path), T037, T045. Test: `real:` one comment on one of our PRs; `pr-gate.sh` does not block on it [FR-049, FR-027, FR-071]
- [ ] T040 Rule text of FR-068, applied in one PR that names each replaced line (spec 021 FR-063), with `rules:check`; only after the owners' yes for switch 3. Test: `rules:check`, owner review via CODEOWNERS [FR-068]
- [ ] T041 Switch 3, approve: needs T026 (counts), T035 (gate met), T036, T037, T038, T040, T046 (red-team pass) and the three owners' entries in FR-069's record. Test: `real:` the first bot approval on an allow-listed PR; a scan of GitHub's reviews for SC-007 [FR-049, FR-059..FR-064, SC-007]
- [ ] T042 Record the owners' decisions as a dated FR in spec 021 (spec 021 FR-037) and `/speckit.converge` this spec and the plan (architecture: four users, proxy, `run_check`, gate). Test: `specs:check` [FR-048]
- [ ] T043 Replay corpus (FR-067): the PRs of #1551's record at the head before each later fix, the later findings labelled by class, run through `--replay` in shadow. Depends on T034's prerequisites. Test: `real:` recall per class in the T035 delta [FR-067]
- [ ] T044 Red-team suite (FR-067): scratch-branch PRs never merged, with planted instructions (diff, file, test output, `node_modules` README), a forged-report test, path disguises (allow-listed name for code, CSS `url(`, rename into the list, symlink, new file outside the list) and seeded bugs; fixture copies in `test:prereview` for the deterministic parts. Test: `test:prereview` (gate refuses each fixture), `real:` 0 approvals in shadow [FR-067, FR-065]
- [ ] T045 Owner-held switch record (FR-069): `.github/samikshak-switches.json` format and the gate's reader (entry accepted only from a verified commit on `main` authored by that owner's login). Test: `test:prereview` with a fake `gh`: unverified commit, wrong author, entry on a branch, missing owner each refuse [FR-069]
- [ ] T046 Red-team step before switch 3: an owner-account reviewer from another side (Paco's or Ruben's) tries to get an approval out of the shadow bot with new disguises not in T044; each success becomes a T044 fixture and a fix. Test: `real:` findings recorded in the T035 delta [FR-067]

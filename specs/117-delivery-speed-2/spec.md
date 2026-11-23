# Feature Specification: Delivery speed 2 (CI by risk and by diff, lighter UI reviews, world packs, bigger slices)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Delivery speed 2 (owner 2026-11-22): measured CI and review cost per PR; lighter review profile for UI/feature PRs (never for masking, IPC, secrets, permissions, user files); Linux-first CI by diff on top of 021 FR-084 / 008 T130; Windows npm test split (#1983); world packs with one contract suite; bigger feature slices
status: draft
note: merged: spec, T002, T003, T011, T022, P8 fast lane, T012 split, T045 gate; O2, O3 (three owners yes 2026-11-23) in #2039; O1, O4 open
-->

**Feature Branch**: `117-delivery-speed-2` (spec, plan, tasks only); build branches `117-pN-slug`, one per rollout step

**Created**: 2026-11-22

**Status**: Draft. Merged from this spec so far: the spec itself and T002, T003 (#2005, CI stats); T011 suite times in the job summary, T012 first half (heavy five first), T022 required-suites guard (#2004). #2031: T012's split (delta 2026-11-22). O5 (paid runners: no) and O6 (separate repos: not now) are decided by the owner (2026-11-22); O1..O4 are open (*Owner decisions*).

**Input**: Owner request (Vikram, team chat, 2026-11-22 09:06-09:11 UTC, relayed by his coordinating agent): another agent's audit says the pace has massively slowed and we write more test fixes and docs than code. Coordinator's figures from `main` (first-parent merges, lines added; code = `src/` non-test, tests = `scripts/` checks, docs = `specs/` and `docs/`): W43 353 PRs, 50k / 64k / 32k; W44 149, 14k / 25k / 14k; W45 218, 20k / 49k / 11k; W46 235, 11k / 33k / 8k; W47 so far 140, 5k / 14k / 4k (with a 40 h outage). Vikram: "Implement all your recommendations": **A** a lighter review profile for UI/feature PRs; **B** CI by diff for real and fewer jobs per PR; **C** worlds and characters as data packs with one contract suite in core; **D** bigger feature slices; **E** measure and fix CI (issue #1983). He also asked about separate repos for worlds and characters; the coordinator advised packages in this repo first (a repo in the same organization shares the same concurrency cap).

Team input folded in (2026-11-22, relayed by the coordinator): **Paco's side** (via his bot): build B on 021 FR-084 point 4 (tasks 021 T063 / 008 T130 in draft PR #1247) and spec only the delta; the heavy profile covers masking, IPC, secrets, permissions **and anything that writes user files**; proposed every-PR baseline: Linux build and `npm test`, the Spec Kit gate, CodeQL, the rules and specs checks; which macOS and Windows legs stay required is the owners' call, with the measured cost and benefit of each leg. **Ruben's side** (via his bot): no CI by diff of its own; audit every workflow for concurrency groups and `cancel-in-progress`; which checks stay required is an owner call that Ruben answers himself.

## Why a new spec and not a delta

CI is owned by spec 008 and the team rules by spec 021; 021 FR-084 (draft #1247) already decides "CI by diff" (point 4) and a 3-PR limit (point 3). This request adds measurement, a risk-based review profile, a Linux-first job policy, a test-suite split, a world-pack contract suite and a slicing guideline across four owners (008, 021, 102, 103). A delta in each would scatter one decision; so it is a new spec, **117**. Checked 2026-11-22: `specs/` on `origin/main` (`d0dce8669`) ends at 113; remote branches `114-floor-rules`, `115-sound-library`, `116-durbar-brain` exist; no open PR head adds `specs/117-*`. This spec's FR, T and Q numbers start at 001 (a new spec numbers from 001; `scripts/spec-numbers.js`). Each build PR adds a pointer delta to the owning spec (008 for workflows, 021 for rule text, 102 for packs).

**What this spec does NOT redo** (spec 021 FR-031, reuse first):

| Already decided or built | Where | This spec |
|---|---|---|
| One concurrency group per PR, `cancel-in-progress` on `pull_request` | 008 FR-107; every PR workflow (table E2) | audits it, adds a guard (FR-010); does not re-decide it |
| `code` / `ui` / `themes` / `macos` decision, base-branch copy, fail open | 008 FR-104, FR-191; `.github/scripts/ci-changes.js` | extends the same file (one decision), never a second decider |
| macOS not on PR / merge queue (Linux stub for the required name) | 008 FR-106 | O1 asks whether the path-filtered real macOS PR job (FR-135) stays |
| File-to-driver map, touched drivers only, unmapped file = all, missing driver fails, nightly and `main` full | 021 FR-084 point 4, tasks 021 T063 = 008 T130 (draft #1247) | builds on it: FR-011..FR-014 are only the delta; FR-012 (Linux-first, Windows by map) and FR-014 (`main` collapse) **amend** point 4 and say so |
| 3 open PRs per side, thin slices behind a default-off flag | 021 FR-084 point 3 (#1247) | D (FR-040) is consistent: one complete vertical slice per PR, not a stack of layer PRs |
| `npm run dora` weekly delivery numbers | 021 FR-084 point 6, T064 (#1247) | FR-001's CI numbers feed the same retro; `dora` stays the delivery-number script |
| "Sensitive" list (secrets, user files, IPC, redaction, permissions, spending) | `docs/rules/review-rounds.md` *Sub-agents by size* (FR-038) | A keeps this line's name and load clause and rewrites its body (O4); heavy is everything not on an explicit light list (FR-020) |
| Set format and `checkSet`, shared with `worldpack.ts` | 102 T100 (issue #1877), FR-204..FR-206 | C builds the contract suite on it (FR-030) |

## Evidence (measured 2026-11-22)

**Method.** Read-only GitHub REST and GraphQL calls with `gh api`, metadata only: run and job names, events, conclusions, timestamps, runner labels; PR numbers, authors, labels, dates, review and commit counts, file paths and line counts. No PR, issue or comment body or title was read. Raw files stayed in the session scratchpad (not committed).

- **Runs**: every workflow run created 2026-11-15T09:16Z .. 2026-11-22T09:07Z (3,783 runs).
- **Jobs** (`/runs/{id}/jobs?filter=all`, re-run attempts included) for **every** run of CI, UI on three OSes, macOS on pull requests, World matrix and Mac title bar (1,540 runs), plus random samples: Spec Kit 60 of 612, Project site 60 of 526, Nightly watch 20 of 373, CodeQL (`dynamic/github-code-scanning/codeql`) 80 of ~300 PR runs and 30 of 145 pushes: **8,737 jobs**. Queue wait = job `started_at` − `created_at`; duration = `completed_at` − `started_at`; percentiles are nearest-rank.
- **PRs**: the last 100 merged PRs (merged 2026-11-17T12:59Z .. 2026-11-22T01:21Z), chosen from the 200 most recently updated merged PRs. Lines added per file class: code = `src/` except test files; tests = `scripts/**` (of which `test-*`, `check-*`, `shots-*`, `ui-*`, `fuzz*` are 7,019 of 8,243 lines; the rest is tooling); docs = `specs/`, `docs/`, `changelog.d/`, root `*.md`; other = the rest. No PR had over 100 files (no truncation).

**Limits.** `[KNOWN GAP]` Spec Kit, Project site, Nightly watch and CodeQL jobs are sampled, so concurrency figures are a lower bound; a job's `created_at` for a job behind `needs:` may be when the run was created, which inflates its queue wait a little. `[KNOWN GAP]` Whether a Windows-only or macOS-only failure was a real platform bug or a flake is not measured (it needs log reading per failure). `[KNOWN GAP]` Review "rounds" are approximated by the count of review objects (a comment-only review counts). `[KNOWN GAP]` 95 of the 100 PRs are authored by `vikramgorla`'s account (agents of more than one side push from it), so per-side numbers are not measurable from authors. The 40 h outage in W47 is inside the run window (low-load hours pull medians down).

**Later `ci:stats` run (2026-11-22, `read:` from the PR #2005 comments; the command lands in #2005).** One real `npm run ci:stats` run 2026-11-22 14:00-14:33 CET (4,207 runs, 10,656 jobs) gave the same picture within about 5 % (UI-shard share of runner minutes 68.4 % PR / 68.2 % push against 70 % / 70 %; queue wait and the code/tests/docs split close) and two figures that differ, both kept beside the hand measurement above: minutes with at least 10 jobs queued **24.4 %** (hand: 18.8 %; a different, busier week, so the two are not the same window); jobs that ran per PR head p50 **15** (hand: 12; the script counts every non-skipped job and has no 15 s floor, so the definitions differ). Neither run is marked the more reliable one: the comment gives the window and counting reasons, not a ranking. `[KNOWN GAP]` No FR or target changes: FR-016 and FR-012 use absolute thresholds and quote 18.8 % and 12 only as "today".

### E1. The runner pool is saturated, and the UI suite is most of the load

| Fact | Value |
|---|---|
| Plan | GitHub Free organization (`gh api orgs/three-feathers`: `plan.name = free`): 20 concurrent jobs, 5 macOS |
| Peak jobs running at once (fetched jobs) | 40 for a moment (minute rounding); Windows 20, macOS 5, Linux 24 |
| Minutes with ≥20 jobs running | 1,369 of 10,077 (13.6 %) |
| Minutes with ≥10 jobs **queued** | 1,894 (18.8 %, about 31 h of the week); max queued at once 76 |
| Jobs running while ≥10 were queued | median 19: the cap, not a slow runner, is the wait |
| Share of runner time in the UI shards (`UI on three OSes`) | **70 %** of `pull_request` runner minutes (33,307 of 47,774) and 70 % of `push` (17,425 of 24,900) |
| Is `UI on three OSes` a required check? | **No** (ruleset `main`: required = Spec Kit gate, Build and test ×3, Office layout check) |
| PR UI runs where FR-191 skipped every shard | 63 of 336 (19 %) |
| UI runs on pushes to `main` | 126 in 7 days, 8 shards each, never cancelled (FR-107 / #286: `main` runs always finish); created-to-done p50 35 min, p90 100 min, max 190 min |

### E2. Concurrency settings, per workflow (read 2026-11-22 at `d0dce8669`)

| Workflow | PR trigger | Group | `cancel-in-progress` |
|---|---|---|---|
| CI (`ci.yml`) | yes (+ merge_group, push, nightly) | workflow + PR number or run id | on `pull_request` |
| UI on three OSes (`ui-platforms.yml`) | yes, `paths:` | same | on `pull_request` |
| macOS on pull requests (`macos-pr.yml`) | yes, `paths:` | same | on `pull_request` |
| Mac title bar on pull requests | yes, `paths:` | same | on `pull_request` |
| World matrix | yes, `paths:` | same | on `pull_request` |
| Spec Kit (`spec-kit.yml`) | yes (+ merge_group) | same | on `pull_request` |
| Project site (`pages.yml`) | yes, `paths:` | workflow + PR number or ref | on `pull_request` |
| Packaged check, Installed app, Install check | yes, `paths:` | workflow + PR number or run id | on `pull_request` |
| Release, Nightly watch, Branch cleanup, Parity tick, Weekly retro, E2E real, MCP OAuth real, Electron cache | no | fixed name | `false` (by design: they must finish) |
| CodeQL | default setup (a repo setting, no file) | not configurable in a file | `[KNOWN GAP]` not readable from the repo |

**Every PR-triggered workflow file already cancels superseded PR runs.** The first rollout step the coordinator expected (add concurrency) is therefore already built; what is left is a guard so it stays so (FR-010) and the `main` push runs, which are kept on purpose (O3). Cancelled jobs took 8 % of PR runner minutes (3,813 of 47,774): that is superseded work already being stopped, not waste still to cut.

### E3. Jobs and runs per PR

| Fact | Value |
|---|---|
| Job rows per PR head (all PR workflows, skipped included) | p50 16, p90 19 |
| Jobs that actually ran (>15 s) per PR head | p50 12, p90 14: Linux 6, Windows 5, macOS 1 (p50) |
| Runner minutes per PR head | p50 170, p90 195 |
| Workflows started per PR head | p50 5 (Spec Kit, CI, Project site, UI on three OSes, macOS on PRs on most heads) |
| Pushes (distinct heads with a CI run) per PR | p50 2, p90 5, max 8; one manual re-run attempt in 7 days |
| Merge queue CI runs per PR | 169 runs for 159 PRs: 149 once, 10 twice; 163 success, 3 failure, 1 cancelled |
| Merge queue settings | ALLGREEN, build 5, merge 5, check timeout 60 min, min wait 5 min; it runs CI and Spec Kit only (no UI suite) |

### E4. Queue wait and durations

Queue wait, minutes (all fetched jobs that ran):

| Slice | n | p50 | p90 | max |
|---|---|---|---|---|
| Linux | 4,978 | 1.7 | 23.4 | 88 |
| Windows | 2,275 | 2.4 | 23.1 | 93 |
| macOS | 483 | 0.6 | 9.2 | 24 |
| `pull_request` | 4,832 | 1.8 | 22.0 | |
| `merge_group` | 686 | 1.4 | 19.6 | |
| `push` (main) | 1,884 | 2.5 | 25.4 | |
| UI shards on PRs | 2,114 | 3.7 | 26.6 | 75 |
| UI shards on `main` pushes | 1,008 | 4.9 | 30.9 | 93 |

By hour of day (UTC, job created): the worst hours are 20-21 (p50 5.0 and 9.9, p90 33.8 and 40.6), 00 (p50 8.5, p90 31.0) and 11-13 (p50 3.8-4.4, p90 20-29); the calm hours are 02-07 (p50 0.1, p90 2-14). Windows follows the same curve (p50 10.3 at 21 UTC).

Durations, minutes (jobs that ended in success or failure):

| Job | n | p50 | p90 |
|---|---|---|---|
| UI shard, Windows (×4 per run) | 1,452 | 18.0 | 20.9 |
| UI shard, Linux (×4 per run) | 1,445 | 16.2 | 18.8 |
| Build and test (windows-latest) | 657 real | 15.7 | 20.1 (max 25.1; 4 cancelled at the 25-min limit, 72 runs ≥20 min) |
| Build and test (ubuntu-latest) | 658 real | 12.1 | 16.2 |
| Build and test (macos-latest), real runs on `main` and nightly | 177 | 15.6 | 18.9 |
| macOS build and test (path-filtered, PRs) | 251 | 15.0 | 18.9 |
| Office layout check (xvfb) | 662 | 5.3 | 6.0 |
| CodeQL javascript-typescript (`main`) | 27 | 9.7 | 11.2 |
| CI run on a PR, created to last job | | 20 | 38 |
| CI run in the merge queue, created to last job | | 21 | 36 (max 64) |

### E5. What each OS leg caught that Linux missed (7 days, same run or head)

| Leg | Compared | Failed only there | Failed on both |
|---|---|---|---|
| Windows Build and test (required) | 498 runs with Linux and Windows both real | **10** (2 %) | 12 (Linux-only failures: 5) |
| Windows UI shards (not required) | 273 PR runs | **4** (1.5 %) | 17 (Linux-only: 10) |
| macOS build and test on PRs (FR-135, not required) | 241 heads with Linux B&T too | **0** | 11 |
| macOS Build and test on `main` pushes | 149 real runs | 0 failures (142 success, 7 cancelled) | |
| macOS UI shards, nightly | 21 jobs | 2 failures, **18 cancelled** (timeout), 1 success | |

`[KNOWN GAP]` 7 days, not the last 100 PRs (job history per PR beyond the window was not fetched), and real-bug versus flake is not separated.

### E6. PRs: cycle time, reviews, commits and the code/tests/docs split (last 100 merged)

| Type label | PRs | Created → merged p50 / p90 (h) | Reviews p50 / p90 | Commits p50 / p90 | Lines added: code / tests / docs |
|---|---|---|---|---|---|
| bug | 36 | 2.9 / 134 | 2 / 4 | 6 / 15 | 1,251 / 4,355 / 638 |
| enhancement | 12 | 5.3 / 72 | 2 / 6 | 9 / 24 | 1,343 / 1,720 / 404 |
| task | 52 | 1.2 / 114 | 1 / 3 | 2 / 7 | 323 / 2,168 / 1,518 |
| **all** | 100 | 1.7 / 116 | 1 / 4 | 3 / 12 | **2,917 / 8,243 / 2,560** (other 25) |

- Code is **21 %** of added lines; tests 60 %, docs 19 %. Tests are 2.8× code, matching the coordinator's 2.5-3×.
- **55 of 100 PRs add no `src/` line.** By paths touched: docs + scripts + src 41, docs + scripts 30, docs only 16, docs + other + scripts 5, other mixes 8.
- Only 12 of 100 carry `enhancement`: features are a small share of what lands.
- Median code lines per PR: 0; median test lines 43, docs 15.

### E7. Windows `npm test` (issue #1983, read with `scripts/gh-trusted.sh 1983`, author `vikramgorla`)

The Windows leg of PR #1978 was cancelled at the 25-minute limit with 277 of 278 suites done; suite seconds 4,107 against 2,265 on a 14-minute leg; the slowdown was uniform (median ratio 1.83), so a slow runner, not the PR. The five heaviest suites (runtime-redact, brainstate, redact-monotone, -b, -c) are 1,748 s, about 43 %. E4 confirms the margin is thin: p90 20.1 min against a 25-min limit, 4 limit cancels in 7 days.

### What the evidence says (read, not measured further)

1. The queue, not the job length, is the wait: at the worst hours a job waits as long as it runs. The pool is 20 jobs and one PR head starts ~12.
2. The UI suite (a non-required check) is 70 % of runner time, on PRs and on every push to `main`. Cutting UI shard-minutes is the one lever that moves the queue; concurrency cancel is already in place.
3. The real macOS PR job caught nothing Linux missed in 241 heads; Windows caught 2 % (B&T) and 1.5 % (UI).
4. Pace: most PRs are check and doc fixes; feature PRs take ~9 commits and 2 review rounds at the median.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A UI feature PR gets through CI and review faster (Priority: P1)

An agent opens a PR that changes one renderer feature and its driver. CI runs the Linux build and test, the Spec Kit gate, the office check, CodeQL and only the UI drivers the map ties to the changed files, on Linux; Windows UI runs only when the map says a touched file is OS-sensitive. The review is a whole-diff read plus the CI record and screenshots, with no mutant or fuzz request.

**Independent Test**: on a test PR that touches one renderer file, `gh api` lists the jobs for its head: Linux UI shards for the mapped drivers only, no Windows UI shard, no macOS job; `scripts/review-profile.js` prints `light`.

**Acceptance Scenarios**:

1. **Given** a PR touching only `src/renderer/notes.js` and its driver, **When** CI runs, **Then** at most 7 jobs start (target FR-012) and no Windows UI shard runs.
2. **Given** a PR touching `src/shared/redact.ts`, **When** the profile is computed, **Then** it is `heavy` and the PR template line asks for mutants and differential fuzz.
3. **Given** a PR touching a file not in the map, **When** CI runs, **Then** every driver runs on Linux (021 FR-084 point 4's fail-open condition).

### User Story 2 - Security-relevant PRs keep the full standard (Priority: P1)

A PR is `light` only when every path is on FR-020's explicit light list; anything else (masking, IPC, secrets, permissions, user-file writes, shell spawn, spending, the prompt-injection tooling, any unlisted path) is `heavy`, whatever else it touches; an unreadable diff is heavy.

**Independent Test**: `test-review-profile.ts` (FR-021): an unlisted file under `src/main`, `src/shared`, `src/preload`, `scripts/*trusted*` or `.github` is heavy; `src/main/ipc/x.ts` is heavy; mutants widening the light list fail.

### User Story 3 - Windows `npm test` finishes with margin (Priority: P2)

The Windows leg runs under 15 minutes at p90 and is never cancelled at the limit on a slow runner, with no suite dropped.

**Independent Test**: CI history after the change: 7 days of Windows Build and test, p90 duration and limit cancels (FR-001's script).

### User Story 4 - A world is a data pack checked by one contract suite (Priority: P3)

Adding or changing a world touches its pack folder and its own small test; the contract suite in core checks every built-in pack; PR CI runs world drivers only for the world the diff touches.

**Independent Test**: a fixture pack added under the packs folder is checked by `test:world-contract` without any core check file changing; a pack missing a required pose fails with the pose named.

### User Story 5 - The team sees the numbers each week (Priority: P2)

`npm run ci:stats` prints E1..E6's tables for the last 7 days (metadata only), and the weekly retro quotes them, so the targets below are measured, not felt.

### Edge Cases

- A PR touching both a heavy path and UI files: heavy profile; CI by diff is unchanged by the profile (the profile is about review, the map about jobs).
- A PR that edits `ci-changes.js` or the driver map itself: the base branch's copy decides (008 FR-191's rule), so a PR cannot skip its own checks.
- The merge queue: runs everything it runs today (CI and Spec Kit in full); nothing in this spec reduces queue or `main` coverage without O3.
- A docs-only PR: unchanged (FR-104 already skips build/test steps; jobs still report).
- A world pack that a PR changes and that also changes core files: the contract suite plus that world's drivers plus the drivers the core files map to.
- Fork PRs: none of this changes `pull_request_target` (none exists) or gives a fork job secrets.

## Requirements *(mandatory)*

### E: measure (first, so every other target is checkable)

- **FR-001** `npm run ci:stats [--days N]` (read-only, `gh api` metadata only, never a body or title; trusted-author filtering not needed because no text is read) prints, for the window: jobs per PR head (by workflow/job and OS), runs per PR, cancelled share, queue wait p50/p90 by OS, event and hour of day, durations p50/p90 per job name, minutes with ≥10 queued, merge-queue runs per PR, and, for the last 100 merged PRs, cycle time, review and commit counts by type label and the code/tests/docs split with E's classes. Output is plain text, scrubbed through `scripts/safe-print.js`; no token is printed. The weekly retro (`weekly-retro.js`) quotes it next to 021 T064's `npm run dora` (one retro section, two scripts: `dora` for delivery, `ci:stats` for CI cost). Not in `npm test` (network); its parser and percentile code are (`test-ci-stats.ts`, offline fixture).
- **FR-002** Baseline = this spec's tables (2026-11-22). Each rollout PR states the FR-001 numbers 7 days after it lands, in this spec's *Changes*.

### B: CI by risk and by diff (delta on 021 FR-084 point 4 / 008 T130)

- **FR-010** Guard: a check in `npm test` (`test-workflow-concurrency.ts`) reads every `.github/workflows/*.yml` with a `pull_request` trigger and fails unless it has a `concurrency` group keyed on the PR number and `cancel-in-progress` true for `pull_request`. Today all pass (E2); the guard keeps it so.
- **FR-011** The driver map of 008 T130 lives in the one decider, `.github/scripts/ci-changes.js` (new outputs `drivers=<names>|all` and `os_sensitive=true|false`), never a second file that decides: **there is no `ci-drivers.json`** (2026-11-22 delta below; `ci-changes.js` is the one decider today, 008 FR-104/FR-191, and has no driver map yet). The map is derived where possible and hand-listed only for the reviewed renderer-module-to-drivers table, which sits inside `ci-changes.js`. Rule: **an unknown path selects ALL drivers; a guard fails when a driver or module is in any rule's gap** (a driver in `ui-suite.js` `DRIVERS`, or a renderer module, that no rule can reach). Conditions of 021 FR-084 point 4 hold.
- **FR-012** Linux first. On a pull request, `UI on three OSes` runs the mapped drivers on Linux. Windows UI shards run on a PR only when the map marks a touched file `os-sensitive` (process, path, shell, font, packaging, window chrome; the `macos-pr.yml` path list is the starting set) or someone runs the full matrix by hand on the branch (`gh workflow run ui-platforms.yml --ref <branch>`, which exists today; no new label, since AGENTS.md *Labels* allows no new family) (O2). The full three-OS matrix still runs nightly, by hand, and on `main` pushes (on the newest one only once FR-014 lands). **Amends 021 FR-084 point 4** (#1247, draft head `c49411191`): point 4 shards the three-OS UI job and runs the touched drivers on every OS; FR-012 runs them on Linux only unless a touched file is OS-sensitive. FR-063 accounting: it replaces point 4's "shards the three-OS UI job" for PRs; nothing else in point 4 changes (map, fail-open, missing-driver check). **Target**: a UI feature PR touching ≤3 drivers starts ≤7 jobs (E3 today: 12) and ≤60 runner minutes per head (today p50 170).
- **FR-013** Shard count follows the work: with `drivers` not `all`, the Linux UI job runs the mapped drivers in one job when their recorded time sum is under 15 minutes, else in `ceil(sum/15)` shards (time-balanced as FR-183 does); the "UI suite complete" job keeps one stable name.
- **FR-014** `main` pushes (O3, agreed by the three owners 2026-11-23, recorded on #1995, on Paco's condition: the release UI gate, T045, #2038): UI runs on `main` share one group `ui-main` with `cancel-in-progress: true`, so a newer merge cancels the older `main` UI run; the run that finishes is the full three-OS matrix, Windows shards included (Linux 4 + Windows 4 today, E1) (the newest commit is tested; `release.yml`'s first job `ui-gate` refuses a tag unless the latest *UI on three OSes* run of exactly the tagged commit, a `main` push, by-hand or nightly run, is green on its Linux and Windows UI shards and its decision job (macOS shards are not read: owner pick, Vikram 2026-11-23), so a commit whose run a newer merge cancelled is not released: T045, `scripts/release-ui-gate.js`, `test:` `test:releaseuigate`). This reverses FR-107's "main runs always finish" for the UI workflow only (#286); CI on `main` keeps finishing every run. Today's cost: 126 runs × 8 shards in 7 days (E1). **Amends 021 FR-084 point 4** ("Nightly runs and `main` keep the full three-OS matrix"): `main` keeps the full matrix for the newest push, not every push; nightly is unchanged. FR-063 accounting: it replaces "`main` keeps the full three-OS matrix" with "the newest `main` push keeps the full three-OS matrix"; it also replaces 008 FR-107's "main runs always finish" for `ui-platforms.yml` only. The merge queue does not gain the UI suite (O3).
- **FR-015** Every-PR baseline (Paco's proposal): Linux Build and test (its `npm test` includes `rules:check` and `changelog:check`), Spec Kit gate, Office layout check, CodeQL, and the Spec Kit workflow's "Spec numbers and picture budget" job. Each currently required check and each candidate is a line of O1 with a keep/change proposal; nothing in the ruleset changes without O1's written yes (T021).
- **FR-016** **Targets** (measured with FR-001 over 7 days, weekdays and weekends): PR job queue wait p90 ≤ 8 min (today 22.0); minutes with ≥10 queued ≤ 5 % (today 18.8 %); UI-shard share of PR runner minutes ≤ 40 % (today 70 %); merge-queue CI run created-to-done p90 ≤ 25 min (today 36).

### E (continued): Windows `npm test` (#1983)

- **FR-017** Measure first, with work counters (agent-notes: CPU time, not wall time): `scripts/run-tests.js` writes each suite's CPU and wall seconds to the job summary on every OS. `[IMPLEMENTED in #2004]` test: `test:runtests` (a row per suite as it ends, so a cut-short run keeps the finished suites; CPU is each suite's node step main process only: forks and Electron children are not counted); macOS and Windows runs `[KNOWN GAP]` (CI is the record).
- **FR-018** Every suite, the masking and redaction suites above all, **stays under a required check name** (`Build and test (<os>)`) on every OS it runs on today. First, inside the same job, `run-tests.js` starts the five heavy suites #1983 names first (longest first). Only if that misses the target, the Windows leg splits into time-balanced shards whose summary job carries the required name `Build and test (windows-latest)` and fails when any shard failed, was skipped or was cancelled, or when the union of the shards' suite lists differs from `test-suites.txt`. A non-required job for any suite is not allowed; moving one there would be an O1 change. No suite is dropped, no assertion weakened, the 25-minute limit is not raised first (#1983). Guard: T022. `[IMPLEMENTED in #2004]` heavy five first (`HEAVY_FIRST`), same suites, no split; guard `scripts/test-ci-required-suites.ts` (test: `test:ci-required-suites`, `test:runtests`); the 7-day Windows measurement is `[KNOWN GAP]` (SC-003, not measured). **Target**: Windows Build and test p90 ≤ 15 min (today 20.1), zero limit cancels in 7 days (today 4). *Amended by the delta 2026-11-22 (split brought forward)*: the split does not wait for the 7-day measurement; it lands now on all three OSes, see *Changes*.

### F: fast lane and the docs-only skip (2026-11-22 delta)

- **FR-386** **Fast lane** (advisory, owner order 2026-11-22). A separate workflow, `.github/workflows/fast-lane.yml`, on `pull_request` only, with a three-OS matrix (`ubuntu-latest`, `windows-latest`, `macos-latest`), runs ONLY the `npm test` suites the PR's diff touches, so a platform-only failure shows in minutes, not at the end of a 14-25 minute Build and test leg. Which suites: the one decider, `.github/scripts/ci-changes.js --suites` (FR-011's one deciding file), run as the base branch's copy through `ci-changes.sh` (a base without the option makes the PR's own copy pick, which is harmless: the lane only adds runs). A suite is picked when it is new on `scripts/test-suites.txt` or its `package.json` line changed, when one of its step files changed, when a step file names a changed file (or a folder at least two levels deep holding one) by a string literal, one level deep, relative to the step file or the repo root (so `../src/shared/api` maps `src/shared/api.ts` to its tests: the derived map; `package.json`, its lock and the list pick only by the line rule), (a bare word also names a file at the repo root exactly, so `'LICENSE'` picks `test:about`), or by a two-line docs table (`specs/**` to `test:specsindex`, `changelog.d/**` to `test:changelog`; rule text needs no row, `rules-check.js` names `AGENTS.md` and `docs/rules`). Nothing picked: the job stops after the decision. `scripts/fast-lane.js` runs the picked suites with `run-tests.js`'s runner, compiles only the picked test files, and builds the app only for a suite that reads `dist/`. **Not a required check**, never `pull_request_target`, no secrets, a read-only token, `persist-credentials: false`, a PR-number concurrency group that cancels (FR-010), suite names only through `env:` and checked against the list. The required jobs still run every suite; the lane can make nothing skip. **Target**: work time (setup through the last suite) under 3 minutes on each OS for a PR touching a few suites; a change to a module many tests import (e.g. `src/shared/redact.ts`, about 50 suites) is slower, capped by the 10-minute job limit. Queue wait is not counted (FR-016 measures it), and the lane adds up to three short jobs per PR head to the 20-job pool: FR-001 measures that cost after it lands (T042).
- **FR-387** **The docs-only skip fails closed** (rewritten after Paco's review of #2032). `ci-changes.js` gives `code=false` (Build and test, Office layout and package smoke report success without running, 008 FR-104) only when the diff is not empty, every path is in plain form (no backslash, no `.`/`..`/empty segment, no edge blank or control character, not absolute), every path is on a small **allow list** (Markdown only under `specs/` and `docs/`, never another file type there, except `docs/rules/`, `docs/agent-setup/` and `docs/site/`; and two named root files, `CHANGELOG.md` and `CONTRIBUTING.md`; prefixes lower case, exclusions in any case, so `Src/`, `Docs/`, `docs/RULES/` run; `changelog.d/` is not on it, so a changelog fragment always runs everything), **and no `npm test` suite names any of them** (a string literal in a step file, read as FR-386 reads them, bare root words such as `'LICENSE'` included; an unreadable suite list counts as named). Anything else runs everything. `ci-changes.sh` replaces the output with "everything runs" unless the decision wrote exactly one `code=` line holding `true` or `false`, so ci.yml's `code == 'true'` cannot read empty (ci.yml itself is not edited: #2004's guard pins that condition). Before this delta a lone `.md` anywhere skipped: `scripts/prereview/prompts/*.md` (read by `test:prereview`), `src/renderer/**/ASSETS.md`, `.github/*.md`, `AGENTS.md`, `LICENSE`. Guard: `test-ci-changes.ts` walks every live file under `src/`, `scripts/`, `.github/` and a fixture list (rule text, site code, README, LICENSE, case tricks, odd paths, a doc a suite names, a folder a suite names), alone and beside a doc, plus an empty diff and a tree with no suite list; fourteen mutants (the old rule, the deny list case-sensitive or missing rules/site/agent-setup, the allow list in any case, taking any root Markdown, any file type or changelog fragments, odd paths accepted, an empty diff, a missing list, the named-by-a-suite check dropped, "some" for "every") and four wrapper mutants (no guard, presence only, any one line, a valid value anywhere) each fail at their own assert; fixtures include `SECURITY.md`, `docs/x.js`, `.sh`, `.svg`, `docs/CODEOWNERS`, a picture, a spec's JSON sample, `code=` empty, `code=maybe` and two code lines. Unchanged: the Spec Kit gate, CodeQL and the number check run on a docs-only PR; `npm test` runs in the merge queue; the fast lane runs `test:specsindex` on such a PR. `[KNOWN GAP]` `specs-index.js` reads `specs/` by listing, not by a literal, so a spec-only PR still skips Build and test; its specs index check runs in the fast lane (advisory) and the merge queue.
- **FR-390** **The fast lane stays fast** (bug, 2026-11-23: the lane hit its 10-minute job limit on #2002 and #2037). (a) A folder literal picks a suite only when the folder holds at most 40 files (`scripts/fixtures`, 84 files, and `src/shared`, 74, name too much: one new fixture picked 23 suites); the docs-only skip (FR-387) still counts every folder (fail closed). (b) `fast-lane.js` plans by recorded time (`scripts/test-suite-timings.json`, Windows medians; a missing suite counts as the median): a suite recorded over 120 s is left to Build and test; then suites are taken in the decider's order (suites whose own file or list line changed first, then those picked by a literal) while the recorded total stays within 480 s; the rest are named as left out. With no readable time at all (a missing or broken timings file) the lane runs nothing and says so (fail closed: never "every suite is free"). (c) The suites get 300 s of wall time; at the deadline every running suite's process tree is stopped (process group or `taskkill /T`, as `run-tests.js --bail` does) and the lane ends **green with a note** naming the suites stopped or not started (advisory: they run in Build and test); a failing suite still fails the lane; SIGINT, SIGTERM and SIGHUP stop the trees the same way and exit 128 + n (the handlers are removed after the run). (d) The job summary keeps FR-017's row per suite and the slowest suites, the plan lines ("N suite(s) picked, all over the time limits: left to Build and test" when nothing fits), and, when a big folder was the only link, says so (`capped` output) instead of "no suite is touched". The 10-minute job limit stays as a backstop.

### A: review profile by risk

- **FR-020** Two profiles. **Light is an explicit list; everything else is heavy** (fail closed). **Light** paths: `specs/**`, `changelog.d/**`, `docs/**` except `docs/rules/**`, `docs/agent-setup/**` and the public site's code (`docs/site/**/*.{js,html,css,svg}`), `README.md`, `CHANGELOG.md`; raster pictures, audio and fonts (`.png`, `.webp`, `.jpg`, `.gif`, `.mp3`, `.ogg`, `.woff2`; not `.svg`); `src/renderer/**/*.css`; `src/renderer/**/*.js` **only when** no added or removed line touches an HTML sink or escape (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `srcdoc`, `href`/`src` from data, an escape or mask helper such as `esc*`, `safeMask`, `mask*`), a link or URL guard (`openExternal`, `new URL(`, a scheme check such as `protocol` or a `http:`/`https:`/`file:` literal, `lookalike`), or the preload bridge (`agentDurbar.`, the name `src/preload/preload.ts` exposes); simulator UI drivers and shots (`scripts/check-*.js`, `scripts/shots-*.js`, `scripts/ui-suite.js`) and `scripts/test-*.ts`, **only when** every `src/` file they load is itself light and the name has none of `redact`, `mask`, `trust`, `permiss`, `url`, `path`, `ipc`, `token`, `secret`, `fuzz`, `gate`, `claim`, `safe-print`, `spawn`, `shell`, `credit`, `spend`. **Heavy** is everything else, which includes (named so nobody reads them as light): masking or redaction, IPC (`src/main/ipc/**`, `src/preload/**`, every handler), secrets and tokens (`mcptoken.ts`, `*mask.ts`), trust and permissions (`agenttrust.ts`, `src/adapters/permissions.ts`), links and paths (`src/shared/url.ts`, `browserurl.ts`, `contactlinks.ts`, `mcp/paths.ts`), **anything that writes user files** (Paco's side), shell or process spawn, spending or credits, the prompt-injection tooling (`scripts/gh-trusted.sh`, `pr-gate.sh`, `trusted-authors.txt`, `claim.sh`, `safe-print.js`), the Content-Security-Policy pages (`src/renderer/index.html`, `charencoder.html`, every `src/renderer/**/*.html`), renderer code that gates links or calls the preload bridge (the content rule above), the public site's code (`docs/site/**/*.{js,html,css,svg}`: `pages.yml` publishes it, so the public-text and secrets rules apply to it; its prose and data, `.md`, `.json`, `.txt`, `.vtt`, stay light because the docs-sync and public-text rules already cover them and no code runs from them), `.github/**`, `package.json`, `package-lock.json`, `build/**`, `AGENTS.md`, `CLAUDE.md`, `docs/rules/**`, every other `src/main`, `src/shared`, `src/adapters`, `scripts/*.sh` file, any `.svg`, any path not listed. Measured against the last 100 merged PRs with the path list alone (the content rules not applied, so an upper bound): **43** would be light, 57 heavy (recounted after Paco's round 2; the first count, 47, wrongly took `scripts/test-*.js` as light). Heavy keeps today's standard: analyst, implementer, reviewer (*Sub-agents by size*), mutants and differential fuzz (`scripts/fuzz/` once 021 T061 lands), Opus-class reviewer. **Light**: one implementer, review = whole-diff read against the checklist, CI record at the head sha, screenshots at both sizes for UI; no mutant or fuzz is asked. Constitution I and III stay non-negotiable: **the light profile never applies to masking, IPC, secrets, permissions or user-file writes**, whatever the PR's size or label.
- **FR-021** `scripts/review-profile.js <base> <head>` prints `heavy` or `light` and every path that is not on the light list, from one list in one file; a path not on the light list, an unreadable diff, a rename into or out of a heavy path, a deletion of a heavy file and a renderer line touching a sink or escape are heavy (fail closed). `ci-changes.js` emits the same result as output `profile` (one decision), so the PR's checks page shows it. Tests: `test-review-profile.ts` table: an unlisted file under each of `src/main`, `src/shared`, `src/preload`, `src/adapters`, `scripts/*trusted*`, `scripts/*.sh`, `.github` is heavy; `src/main/ipc/x.ts` is heavy; a renderer line adding `innerHTML` is heavy; a mixed light and heavy PR is heavy; a docs-only and a CSS-only PR are light. Mutants: widening the light list to `src/**`, ignoring renames, dropping the sink rule, each fail.
- **FR-022** The rule text is an owner proposal (*Owner decisions* O4): exact words below, in `docs/rules/review-rounds.md`, rewriting the body of the *Sub-agents by size* line and keeping its name (three pointers use it). Until the owners say yes, nothing changes in how PRs are reviewed.
- **FR-023** **Target**: light-profile PRs with `enhancement`: review objects p50 ≤ 1 (today 2) and created-to-merged p50 ≤ 3 h (today 5.3). Heavy-profile PRs: no target on rounds (quality first).

### C: worlds and characters as data packs, one contract suite

- **FR-030** One contract suite, `npm run test:world-contract`, iterates every built-in pack (worlds and character sets) and runs, per pack, the checks every world must pass: `worldpack.ts` manifest rules, `checkSet` (102 T100, FR-204..FR-206), `momentCoverage` against `docs/experience/world-moments.json`, the feature-inventory parity row (FR-078), the catalogue card. It reuses those functions; it adds no second rule. It replaces per-world copies of the same assertions where they exist (named per world in the plan's inventory).
- **FR-031** Each world keeps only its own small test for what is unique to it. World UI drivers run as one parameterised driver per behaviour (`DRIVER_WORLD=<id>`, as the 21 `retro` and 1 `cave` entries of `ui-suite.js` do today), and the driver map (FR-011) runs a world's entries only when the diff touches that world's pack or the shared world engine.
- **FR-032** Blocked on 102 T100 (issue #1877, `checkSet`). Packages in this repo; a separate repository is not now (owner, O6, 2026-11-22), because a repo in the same organization shares the same 20-job cap and adds a second CI to keep green.
- **FR-033** **Target**: a PR that adds or changes one world touches no core check file other than the registry, and runs ≤ its own drivers plus the contract suite on PR CI.

### D: bigger feature slices

- **FR-040** A UI feature is planned as **one vertical slice per PR** (UI, logic, driver, docs together, behind a default-off flag when unfinished, per 021 FR-084 point 3), not a stack of layer PRs; a spec's tasks group into phases that are one PR each (as spec 113 does). Fixes to checks a feature PR breaks are made in that PR, not a follow-up PR. This is planning guidance, not new rule text: `.specify/templates/*` are managed by `specify integration` (`.specify/integrations/speckit.manifest.json` hashes them), so the guidance goes into `docs/review-checklist.md`'s *Slice size* line, word-neutral (T019).
- **FR-041** **Target** (indicator, never a gate, never per person): in the last 100 merged PRs, `src/` lines are ≥ 35 % of added lines (today 21 %) and PRs adding no `src/` line are ≤ 40 (today 55). Measured by FR-001 for the retro.
- **FR-382** `[KNOWN GAP]` Not started, own spec needed: split `src/renderer/app.js` into modules so that CI by diff and review get narrower (today a change to `app.js` alone selects all drivers, FR-011 delta; 18 of the last 200 merges). Not designed here; a later spec owns its design. Tracked by T024.

### Key Entities

- **Driver map**: path pattern → driver names (or `all`), plus an `os-sensitive` flag; lives in `ci-changes.js`'s data.
- **Review profile**: `heavy` | `light` with the paths that decided it.
- **Pack**: a folder with a manifest that `worldpack.ts` reads; checked by the contract suite.

## Owner decisions

**Recorded** (Vikram, team chat, 2026-11-22 09:31 UTC, posted on #1995): "No paid runners, everything else which allows us to go fast not compromising quality." **O5 paid runners: NO. O6 separate repos: not now.** O1..O4 delegated to that criterion; the coordinator's proposed picks are on #1995 for Paco and Ruben to confirm, because they are settings and rule text that need all three owners. Until then O1..O4 are open, and each task they gate waits for a written yes.

| # | Decision | Who | Evidence | Spec's recommendation | Coordinator's pick (#1995, to confirm) |
|---|---|---|---|---|---|
| O1 | Required checks (ruleset = repo setting); one line per check below | Vikram, Paco, Ruben (Ruben answers in the group) | E4, E5 | see table O1 | see table O1 |
| O2 | Windows UI shards on PRs only by map (`os-sensitive`) or a by-hand full run; amends 021 FR-084 point 4 | three owners | E5: Windows UI caught 4 of 273; E1: Windows UI shards are 33 % of all runner time | yes | yes; **agreed by the three owners 2026-11-23** (recorded on #1995); built in #2039 |
| O3 | `main` UI runs collapse to the newest (FR-014), amending 021 FR-084 point 4 and 008 FR-107; no UI in the merge queue | three owners | E1: 126 `main` UI runs, p90 100 min; the queue runs no UI today | yes; full matrix stays nightly and on the newest `main` push; **not** in the merge queue (5 entries × 8+ shards against a 60-min timeout) | yes; **agreed by the three owners 2026-11-23** (recorded on #1995); built in #2039 |
| O4 | Review profile rule text (FR-022) | three owners | E6 | the words below | yes |
| O5 | Paid runners or plan | owner (money) | E1 | not proposed | **NO** (owner, 2026-11-22) |
| O6 | Separate repos for worlds/characters | owners | FR-032 | not now | **not now** (owner, 2026-11-22) |

**O1, one line per check** (required list read from the `main` ruleset on 2026-11-22):

| Check | Required today | Cost (E4) / catch (E5) | Spec's proposal | Coordinator's pick |
|---|---|---|---|---|
| Spec Kit gate | yes | 0.2 min | keep | keep |
| Build and test (ubuntu-latest) | yes | p50 12.1 / p90 16.2 min | keep | keep |
| Build and test (windows-latest) | yes | p50 15.7 / p90 20.1; caught 10 of 498 Linux missed | keep; split per FR-018 under the same name | keep |
| Build and test (macos-latest) | yes (a Linux stub on PRs and in the queue, 008 FR-106) | 0.1 min stub; real on `main`: 149 runs, 0 failures | keep as is | keep as is |
| Office layout check (xvfb) | yes | p50 5.3 min | keep | keep |
| CodeQL (javascript-typescript, actions) | no | p50 9.7 min on `main`; `[KNOWN GAP]` PR success rate not measured | add as required after 7 days of FR-001 show its PR runs reliable | add |
| Spec numbers and picture budget (Spec Kit workflow) | no | p50 0.5 min | add as required | add (as "specs checks") |
| UI suite complete (UI on three OSes) | no | 70 % of runner time | stay not required (FR-012 makes it cheaper first) | not required unless the change touches what it tests |
| macOS build and test (path-filtered, 008 FR-135) | no, but runs on matching PRs | p50 15.0 min; caught 0 of 241 Linux missed | stop it on PRs; macOS stays on every `main` push and nightly. **This reverses spec 008 FR-135** (owner decision 2026-10-29) and needs its own written yes and a spec 008 delta | **keep** (FR-135 stays) |

Every change in this table is applied by an owner (repo settings) after the written yes (T021); an agent changes no ruleset.

**O4, exact words.** In `docs/rules/review-rounds.md`, replace the line

> - **Sub-agents by size** (FR-038): small = one smaller-model agent; medium = implementer that mutation-checks; sensitive (secrets, user files, IPC, redaction, permissions, spending) = analyst, implementer, reviewer. Two heavy agents per machine at most.

with

> - **Sub-agents by size** (FR-038): `review-profile.js` light = implementer, diff read, CI record; heavy (masking, IPC, secrets, permissions, user-file writes, spending) = analyst, implementer, reviewer, mutants, fuzz. Two heavy agents per machine at most.

Word count (`scripts/rules-check.js` counts whitespace-separated words): old line 34, new line 34, **net 0**. The line keeps its name, so its three pointers stay valid (`docs/rules/review-rounds.md` *One full review*, `docs/agent-setup/README.md` *Sub-agents by size*, spec 103's "at most 2 heavy agents"), and keeps "Two heavy agents per machine at most" word for word. **Words replaced**: "small = one smaller-model agent; medium = implementer that mutation-checks; sensitive (secrets, user files, IPC, redaction, permissions, spending) = analyst, implementer, reviewer." become "`review-profile.js` light = implementer, diff read, CI record; heavy (masking, IPC, secrets, permissions, user-file writes, spending) = analyst, implementer, reviewer, mutants, fuzz." (that is the change: no mutants or fuzz asked of a light PR; "redaction" is said as "masking"; "user files" becomes "user-file writes"; heavy is whatever `review-profile.js` does not call light, so the list in brackets names examples, not the boundary). **Budget, relative to #1247** (draft, head `c49411191`, its trim table pending Paco's yes): on `main` today `review-rounds.md` is 664 of 680 and the line fits. With #1247's head merged onto `main` (measured 2026-11-22 with `node scripts/rules-check.js`), AGENTS.md is 2,012 of 2,000, `review-rounds.md` 678 of 680 and AGENTS.md + `docs/rules/` 3,602 of 3,525: #1247 must trim before it lands whatever this spec does. This proposal adds 0 words on either base, so it does not make #1247's trim larger. #1247 does not edit this line. AGENTS.md is not changed. FR-063 (one rule in, one rule out): it rewrites FR-038's line in place and adds no rule. Screenshots for UI stay required by constitution VII and *Before you finish*. Until `review-profile.js` exists, the author applies FR-020's light list by hand, and anything not on it is heavy.

## Not decided

- The exact sink and escape pattern list of FR-020's renderer content rule (the plan proposes; a reviewer from another side checks it).
- The `os-sensitive` list beyond the `macos-pr.yml` starting set (the plan proposes; a reviewer from another side checks it). *(2026-11-22: the built list is in the delta of that date and in `ci-changes.js`; a reviewer from another side still checks it.)*
- Whether a light-profile PR still needs a second-side approval when its author's side has no reviewer free (today's rules apply; unchanged here).
- Character sets: whether they become packs in the same contract suite in the first step or after worlds (plan proposes after).

## Success Criteria *(mandatory)*

- **SC-001** FR-001 runs and reproduces this spec's E1..E6 tables within ±5 % on the same window.
- **SC-002** FR-016 targets met over 7 consecutive days after rollout steps P1..P3 land.
- **SC-003** FR-018: Windows Build and test p90 ≤ 15 min, 0 limit cancels in 7 days, same suite list and assertion count. Since the split (delta 2026-11-22) the time is the longest `Build and test (windows-latest) part i/2` job per run, never the summary job (`ci:stats`, *npm test per OS*).
- **SC-004** FR-023 targets met for light-profile `enhancement` PRs over the 30 PRs after O4's yes; no heavy-path PR was classified light (audit of the 30 by FR-021's output).
- **SC-005** FR-033 met by the first world PR after P5.

## Rollout (small PRs, in order of benefit per cost)

| Step | PR | FRs | Needs |
|---|---|---|---|
| P0 | this spec, plan, tasks, measurements | all | nothing |
| P1 | `ci:stats` script + concurrency guard | FR-001, FR-002, FR-010 | nothing (no workflow behaviour change) |
| P2 | driver map + Linux-first UI on PRs | FR-011..FR-013 | #1247 landed (008 T130 defined there); O2 for the Windows part (Linux part can land first) |
| P3 | `main` UI collapse | FR-014 | O3 |
| P4 | Windows `npm test` split (#1983) | FR-017, FR-018 | nothing (no limit change, every suite stays under the required name) |
| P5 | review profile script, then the rule text | FR-020..FR-023 | script: nothing; rule: O4 (word-neutral on `main` and on #1247's head) |
| P6 | world-pack contract suite | FR-030..FR-033 | 102 T100 (#1877) |
| P7 | slicing guidance in the checklist | FR-040, FR-041 | nothing (guidance, word-neutral) |
| O1 | ruleset changes | FR-015 | O1's written yes; applied by an owner (T021) |

The coordinator's suggested first step (concurrency groups and `cancel-in-progress`) is already built for every PR workflow (E2); P1's guard is all that is left of it, so P2 (the UI shards, 70 % of runner time) is the first step that cuts load.

## Assumptions

- The Free plan's 20-job and 5-macOS caps are as GitHub documents them; E1's "19 running while ≥10 queued" agrees, the plan page itself was not read.
- 7 days is representative; the W47 outage lowers the medians (honest limit above).
- 021 FR-084 (#1247) lands as drafted; if it changes, P2 and P5 follow the merged text.

## Changes

### 2026-11-22: FR-018 split brought forward (owner order, Vikram, 2026-11-22: "raise delivery speed 5-10x without losing quality; act now")

**Why now, not after 7 days**: the 25-minute job limit cancelled `Build and test (windows-latest)` on #1978 (run 44748219643, 277 of 278 suites done), #1994 (run 45006804089), #1972 and #1996 (twice, macOS too) in two days (#1983), with no code cause: each cost a new head, a re-approval and a CI run, and nobody may rerun to green (FR-087). The five heavy suites are about 43 % of the Windows leg. `main` push runs on 2026-11-22 (45017392470 .. 45038881385) took 13-24 min on Windows, 7-22 on macOS and 12-20 on Linux, so the thin margin is on every OS, not only Windows.

**FR-018, amended** `test:` `test:runtests`, `test:ci-shards`, `test:uisuite` `[IMPLEMENTED]` (this branch; before/after job times: the PR's own CI runs, `read:`): `npm test` runs in **2 parts per OS** as parallel jobs (`test-ubuntu`, `test-windows`, `test-macos`, each a `shard: [1, 2]` matrix setting `TEST_SHARD=<i>/2`; macOS parts only where FR-106 runs macOS). `run-tests.js --shard i/n` (or `TEST_SHARD`) splits `test-suites.txt` by the recorded seconds in `scripts/test-suite-timings.json` (Windows medians of three `main` runs; a suite with no entry counts as the median) with the same greedy split the UI suite uses, now one helper `scripts/time-shard.js` (008 FR-183's `shard()` calls it; no behaviour change there). The two heaviest suites land in different parts; recorded seconds per part 1588 / 1588. Before a part runs, the runner computes **every** part and refuses (exit 2, so the part job fails) unless each suite of the list is in exactly one part and no part is empty: the union of the parts is `test-suites.txt`, checked on the commit being tested. The required checks keep their names: `build-test` is a short Linux **summary job per OS** named `Build and test (<os>)` that `needs` the three part jobs, runs under `${{ always() && !github.event.pull_request.draft }}` with `permissions: {}`, as FR-183's *UI suite complete* (a failed or cancelled part cannot skip it) and fails unless its own OS's parts' result is `success`; a failed, cancelled or skipped part fails it; on pull requests and merge queue entries it reports for macOS as before (FR-106) and fails if the macOS parts did anything but skip. Every suite, the masking and redaction suites included, runs exactly once per OS inside a job whose result decides a required check; no suite is dropped, no assertion changed, the ruleset is not changed. Limit: the T025 stop-gap (45 min, #2026) stays on every part job for now; this PR's run measured the Windows parts at 11.9 and 13.9 min (run of `bfa9a7ecb`), too few runs to trust 25 on a slow runner (1.83x in #1983), so T025 lowers it after the parts are measured. Ubuntu's prereview SDK install runs in both Linux parts; the art build selftest in Linux part 1. In every part the `changes` step (the reviewed script, no condition, env `EVENT_NAME` only) and the `npm test` step's env (`TEST_SHARD`, plus `PREREVIEW_REQUIRE_REAL_SDK=1` on Linux) are pinned, and no job or workflow `env` or `defaults` is allowed (`test:ci-shards`; review of #2031: a `changes` step under `if: matrix.shard == 1` let part 2 go green with no suites). FR-193's no-typecheck check reads every part job (`test:citypecheck`).

**SC-003, measured on the parts**: after the split, `Build and test (<os>)` is a seconds-long summary, so its duration says nothing. SC-003's Windows time is, per run, the **longest** of the `Build and test (windows-latest) part i/2` jobs, counted when every part of the run finished; a part cancelled at the limit counts as a limit cancel. `npm run ci:stats` prints it (*npm test per OS (SC-003)*, `test:` `test:ci-stats`).

**Amends spec 008 FR-104** ("no `needs:`" in `ci.yml`): one exception, the `Build and test (<os>)` summaries wait for the npm test parts; the parts start at once, as every other job. **Cost**: a pull request starts 4 part jobs and 3 short summary jobs where it started 3 Build and test jobs (macOS still starts no macOS runner on PRs).

**Guard**: T022's `scripts/test-ci-required-suites.ts` (merged in #2004) is extended here to the split: one part job per required OS on that OS, `shard: [1..n]` with `TEST_SHARD` `${{ matrix.shard }}/n`, the `changes` step with no condition, pinned env and pre-test steps per part, and one summary job carrying the required names, needing exactly the parts, under `always()` with `permissions: {}`, whose script is run (`scripts/ci-summary-probe.ts`, shared with `test:ci-shards`) and must fail on a failed, cancelled, skipped or missing part. `test:citypecheck` asserts the jobs that run `npm test` are exactly the three part jobs. `[KNOWN GAP]` the summary's script is not run on the Windows leg of `npm test` (no bash assumed there; the wiring checks run). SC-003's 7-day Windows p90 is still to be measured.

### 2026-11-22: status after Paco's review of #2004

Merged: the spec and #2005 (T002, T003). Open and not merged: #2008 (T004), #2004 (T011, T012 first half, T022). Review fixes in #2004: the guard parses the workflow with js-yaml and fails closed on shapes it does not read, reads CRLF files, the summary is written as each suite ends, the CPU temp folder is removed on signals, forks and Electron children are not counted (stated).

### 2026-11-22: created (owner request, Vikram, team chat 09:06-09:11 UTC)

Spec, plan, tasks and the measurements above (at `4c962b39b`). Paco's input (heavy list adds user-file writes; build B on 021 T063 / 008 T130; baseline checks; macOS/Windows legs as an owner decision with cost and benefit) and Ruben's (audit every workflow's concurrency; required checks are an owner call) are folded in. Nothing built.

### 2026-11-22: Paco's review of #1995 (CHANGES_REQUESTED, six findings) and the owner's answer

- FR-020/FR-021: the light profile is an explicit list and everything else is heavy (it missed `src/main/ipc/*.ts`, the mask, trust, permission, URL and path modules and the prompt-injection tooling); test sketch with unlisted paths under `src/main`, `src/shared`, `src/preload`, `scripts/*trusted*`, `.github`.
- O4: word accounting redone against `main` and #1247's head `c49411191`; the line keeps its name (three pointers) and "Two heavy agents per machine at most"; the exact words replaced are named.
- FR-012 and FR-014 are named as amendments of 021 FR-084 point 4, with FR-063 accounting; the full matrix still runs nightly, by hand and on the newest `main` push.
- FR-018: every suite, the masking suites above all, stays under the required name; no non-required job; summary job fails on a failed, skipped or cancelled shard; guard T022.
- O1: one line per required check and candidate; the macOS item is marked as reversing 008 FR-135; ruleset changes gated on T021.
- T015, T019: word budgets named (checklist line rewritten word-neutral; no agent-notes text).
- Owner (Vikram, 2026-11-22 09:31 UTC): O5 NO, O6 not now; O1..O4 delegated to "faster without losing quality", coordinator's picks recorded beside the spec's for Paco and Ruben to confirm.

### 2026-11-22: Paco's round 2 on #1995 (eight items)

- N1: the CSP pages (`src/renderer/*.html`), renderer link and URL guards and preload-bridge calls are heavy (FR-020 content rule and heavy list).
- N2: the public site's code (`docs/site/**/*.{js,html,css,svg}`) is heavy; its prose and data stay light (reason in FR-020).
- N3: light count recounted: 43 of 100, not 47.
- N4: T022 covers the summary job itself being skipped (`if: ${{ !cancelled() }}`), with a mutant.
- N5: T015 waits for T014.
- N6: the Windows-on-`main` question left *Not decided*; FR-014 decides it (the newest `main` push runs the full matrix, Windows included).
- N7: T019 is word-neutral and keeps "changed".
- N8: T023 updates `docs/agent-setup/README.md` *Sub-agents by size* (its *Medium* tier) with T015.

### 2026-11-22: T004 built, how the guard reads a workflow (Mac lane)

- FR-010 is read exactly as written: a workflow is "PR-triggered" when its `on:` block names `pull_request` (a comment that says "never on pull_request" does not count). Its top-level `concurrency:` must have a `group` that contains `github.event.pull_request.number` and a `cancel-in-progress` that is `true` or an expression naming `github.event_name == 'pull_request'`. The test reads the text by lines (no YAML dependency) and says which file and which of the three parts is missing. Mutants on a copy of `ui-platforms.yml` (group without the PR number, `cancel-in-progress: false`, the `concurrency:` block removed) each fail at a labelled assert. Not verified: that GitHub itself cancels the run (a hosted-runner fact; E2 of this spec records it).

### 2026-11-22: reconcile T007 and FR-011 (one deciding file, not two); spec delta, no code

Found by a plan-only note of the Mac session; Paco's bot agreed in the team group (2026-11-22 13:50 UTC): a small spec delta first, the build after #1247 lands; keep "unknown path = all drivers" strict, not trading safety for a thin win; splitting `app.js` is a separate spec item.

- **Problem.** FR-011 and 021 FR-084 point 4 / 008 T130 (#1247 head, `021-delivery-speed`, T063/T130) say one decider, no second file that decides; T007 and the P2 plan named a new `.github/scripts/ci-drivers.json` that `ci-changes.js` would read.
- **Read, who decides today.** `.github/scripts/ci-changes.js` is "the ONE place that decides" (008 FR-104, FR-191): it computes `ui` from the closure of `ui-suite.js`'s `DRIVERS`; `ui-platforms.yml` only consumes `ui`. No driver map exists on `main`; #1247's T130 is only a task line (no code). `macos-pr.yml` decides by GitHub `paths:` (008 FR-135) and is not touched.
- **Decision.** ONE deciding file: `ci-changes.js`. **`ci-drivers.json` is not created.** The reviewed table (renderer module to drivers, `os_sensitive` patterns) is data inside `ci-changes.js` (a clearly named const), so the rule and its table change in one file and one review; `ui-suite.js` keeps `DRIVERS` (names, recorded times) and is read, not duplicated. T007 and the P2 plan are rewritten to match. Rule: an unknown path selects ALL drivers; a guard fails when a driver or module is in any rule's gap.
- **Plan (the Mac session's measured design; see the evidence block next).** Every driver loads the whole app, so the map narrows only by feature. Core paths select ALL drivers: `src/main`, `src/preload`, `src/shared`, `src/adapters`, `app.js`, `index.html`, styles, `sim.ts`, build, `package*.json`, CI files, driver helpers. Otherwise a diff picks drivers by (a) the driver file's own `scripts/` closure, (b) `dist/src` path literals in a driver, (c) world names (FR-031), (d) a reviewed table from renderer module to drivers. `os_sensitive` (starts Windows): `src/main`, `src/preload`, build, packaging, dependencies, `appmenu.ts`, `keys.js`, `browserpane.js`, and any `src/shared` or `src/adapters` file that uses `path`, `fs`, `os` or `child_process`.
- **`[evidence, from a read-only plan note, not verified here]`** Over the last 200 merges: only 33 % of UI PRs pick a strict subset of drivers; 24 % pick 15 drivers or fewer; `app.js` alone forces all drivers in 18 merges; `os_sensitive` would start Windows on about 19 % of UI PRs. Not re-measured in this PR; the build PR re-measures (T006 fixture, then FR-001 after landing). So the FR-016 target for this lever is a thin win: the strict rule is kept anyway.
- **New spec item, FR-382 / T024:** split `app.js` into modules (not started, own spec needed, not designed).
- **Dependencies.** Only the 021 FR-084 point 4 amendment wording (T008) and the 008 T130 tick (T007) wait for #1247 to land; T006 (test first) and the pure data part can be written against `main` today but merge after #1247 so T130 exists.

### 2026-11-22: option C waits for vocabulary profiles (spec 102 *Changes 2026-11-22*, last entry; issue #1877; no new FR)

Spec 102 T100's first step found that no built-in pack meets 102 FR-204 and FR-205 as written and none goes through the user-pack part table (evidence table in spec 102). FR-030's "`checkSet` on every built-in" holds through a vocabulary profile: one `checkSet`, user packs always on the user profile, built-ins on their declared 097 vocabulary, caps the same (spec 102 T100, T433, T434). T016's inventory (Mac session, plan-only, static reads, about plus or minus 10 %): 71 files, about 190 world-specific asserts.

- **R1** built-in part files pass the part table and `checkSet` (about 32, new checks: the six validator tests never read a built-in; only `test-realoffice-assets.ts` does).
- **R2** moment coverage per built-in (2).
- **R3** the inventory's Worlds marker (0: `scripts/feature-inventory.js` already checks it).
- **R4** picker card name, picture and label per world (about 16).
- **R5** a missing required pose fails naming it (about 16, new).
- **R6** the driver map: 34 `ui-suite` entries change only when they run (T018); `test-release-video.js` pins a second copy of the `DRIVER_WORLD` id list, replaced first.
- **Stays** (about 124): built-in `world.css` rules (no blend or blur, own-folder URLs, the cave bezel), flag runtime, lazy load, plain-tile fallback, layout, contrast and accessibility asserts.
- **`loft`**: listed by `test:momentsregistry` and `world-moments.json` with no pack folder; reported "no pack" (spec 102 OP-14 (c)).

T016, T017 and T018 amended; T017 waits for 102 T100, T433 and T434.

### 2026-11-22: stop-gap, `build-test` `timeout-minutes` 25 to 45 (#1983)

FR-018 says the 25-minute limit is not raised first. The queue is blocked now (#1978, #1994, #1972, #1996 twice, #1533 cut at the limit with no assert failing; each costs a new head, a re-approval and a rerun), and Paco's bot suggested a stop-gap. Decision: raise the one `build-test` limit (it is a matrix, so all three legs) to 45 until T012's shard split lands, then T025 lowers it again. This is a stop-gap only: it changes no suite, name or job structure, and the target stays Windows Build and test p90 at or under 15 min, zero limit cancels in 7 days (SC-003, FR-018). A cut run now ends as a slow green or a real failure instead of a cancel. `test-electron-cache` item 10 (work plus npm ci retries within the limit) still holds. Not verified: the new Windows p90 until the next runs are measured.

### 2026-11-22: fast lane and a fail-closed docs-only skip (owner order, Vikram: delivery 5-10x faster without losing quality)

- **Problem.** Windows-only failures (CRLF in a `.sh` read, 8.3 short paths against git's long paths, `Stats.blocks` 0) and a macOS-only one (the require cache under the `/private/var` realpath) on PRs #1535, #1996 and #2004 each showed only after the full Windows or macOS leg (14-25 min), one per round, 3-4 rounds per PR. And the docs-only skip took any lone `.md`, so a PR changing only `scripts/prereview/prompts/system.md` ran no test.
- **Decision.** FR-386 (fast lane, advisory) and FR-387 (docs-only skip fails closed), tasks T040..T042. The lane is a new workflow file, not a ci.yml job: FR-018's suite guard (#2004, T022) treats every `npm test` in ci.yml as the required one, and a separate file keeps clear of the Windows shard work (T012). The plan's "no new workflow file" is amended for this one file. FR-063: no rule text added.
- **Reuse** (021 FR-031): the one decider `ci-changes.js` and its base-copy wrapper `ci-changes.sh`, `run-tests.js`'s `loadSuites` and `runMain`, the `npm-ci` action, `safe-print.js`.
- `[KNOWN GAP]` The fast-lane time is measured on this PR's own runs (T042 records it); on its own PR the base copy predates `--suites`, so the PR's copy picks (the fallback above).

### 2026-11-22: Paco's review of #2032 (CHANGES_REQUESTED, six findings)

- 1, 6: the skip is an allow list plus "no suite names the path" (rule text, the site's code, README and LICENSE now run); the fast lane resolves bare root words (`'LICENSE'` picks `test:about`).
- 2: exclusions match in any case; the allow-list prefixes are lower case only.
- 3: an empty diff, odd paths and a missing suite list run everything; `ci-changes.sh` writes everything when the decision wrote nothing (ci.yml unchanged to stay disjoint from #2004).
- 4: `--suites` on every non-PR event picks nothing, tested in a repo with a suite list and a changed step file.
- 5: the `test:rules` row of the docs table was redundant (the literal rule picks it) and is removed; a new rule file is tested.

### 2026-11-22: Paco's round 2 on #2032 (two items and a text fix)

- The wrapper accepts only exactly one `code=true` or `code=false` line; anything else (empty, another value, two lines) is replaced by "everything runs".
- The allow list is narrowed: Markdown only under `specs/` and `docs/`, two named root files (`CHANGELOG.md`, `CONTRIBUTING.md`); `SECURITY.md`, scripts, SVGs, pictures and `CODEOWNERS` run everything. `changelog.d/` is off the list (a fragment always runs everything), and the text above now says so.

### 2026-11-23: TEST_JOBS 4 on the ubuntu and windows parts (delivery-speed review; Paco's review of #2030)

- FR-017: `scripts/run-tests.js` defaults to CPUs minus one. The ubuntu and windows part jobs have 4 vCPU (the #2031 run's logs print "3 at a time"), so their `npm test` step sets `TEST_JOBS: 4`. macOS is left at the default (its logs show 2 and 4 at a time, the runner size varies; 4 could oversubscribe), as is `macos-pr.yml`. The guard (T022) requires `TEST_JOBS: 4` on ubuntu and windows and forbids it on macOS, with a removal mutant and a macOS mutant. T500 measures it; revert if flakes rise (wall-time-sensitive UI suites first).

### 2026-11-23: bug, the fast lane timed out (FR-390, T076, T077)

- **Seen** (job logs read 2026-11-23): #2002 at `61ee8f4c8` picked 62 suites (it changes `src/shared/redact.ts`), among them `test:runtime-redact` (378 s on ubuntu, 455 s on Windows) and the three `test:redact-monotone*` suites (about 250 s each, 380 s on Windows); ubuntu, Windows and macOS were cut at 10 minutes. #2037 at `c085aa7be` picked 33 suites: its new `scripts/fixtures/selfupdate/` file matched every test naming the `scripts/fixtures` folder (23 suites, the heavy redact ones included); Windows was cut at 10 minutes, ubuntu passed in 262 s of suites. The runner's "Cleaning up orphan processes" step stopped the suites left running.
- **Cause.** No time bound in the lane (FR-386 said a widely imported module "is slower, capped by the 10-minute job limit", and a cut job is red), and the folder rule took shared folders.
- **Fix.** FR-390. Affected: every open PR whose diff names a widely shared module or folder (any `src/shared` file the redact suites import, any new fixture); a red Fast lane is advisory and blocks no merge, but it cost review rounds.

### 2026-11-23: Paco's review of #2049 (CHANGES_REQUESTED, six findings)

- 1: the deadline delay, `main`'s path (asked, plan, the plan's suites only: `prepareRun`) and the plan are tested on a fake runner and clock, plus one real run with a sleeping suite and its grandchild (both stopped).
- 2: SIGINT, SIGTERM and SIGHUP are handled in `runLane` (abort, 128 + n, handlers removed after the run).
- 3: the per-suite summary rows and the slowest-suites table are back; the deadline note names the suites stopped or not started.
- 4: a missing or broken timings file runs nothing (fail closed).
- 5: the docs-only skip's big-folder fixture and its mutant are added (T076 named them).
- 6: the summary says when a big folder was the only link and when every pick was over the limits.
- Not built: a separate "small base" for heads with no suites of their own. Both reported heads changed sources and fixtures (the base picked big lists from real links); a head with no own change picks nothing already, so the time plan and the folder cap are the whole fix.

### 2026-11-23: Paco's round 2 on #2049 (four findings)

- The Windows failure was the test: its pid list counted the `taskkill` that run-tests.js starts through the same spawn. Only the suite's node process is counted now, and an emulated win32 run (a stand-in `taskkill`) runs on every OS. `runLane` also waits (bounded, 10 s) for any `taskkill` it started to exit before it returns.
- The broken-timings summary line is tested.
- `main` is a thin wrapper around `laneMain`, which runs only the suites `prepareRun` returns and nothing on an empty plan (tested, two mutants).
- `capped=1` is tested through the CLI and the wrapper on a 41-file folder, and the workflow's summary line for it is checked.

### 2026-11-23: bug, the path-filtered macOS job hit its 25-minute limit (T078, T079)

- **Seen.** #2002 at `0731cca70`: *macOS build and test (path-filtered)* ("macOS on pull requests", `macos-pr.yml`, spec 008 FR-135) was cut by "exceeded the maximum execution time of 25m0s" with every other check green. A job timeout cannot be rerun (spec 021 FR-087), so the remedy was a new head: a lost round. The T025 stop-gap (2026-11-22) raised only `ci.yml` `build-test`; `macos-pr.yml` still had 25.
- **Measured** (job start to completion, `gh run view --json jobs`, last 12 finished jobs on pull requests 2026-11-23, logs read as data): 23.8, 22.6, 20.4, 20.0, 18.7, 20.2, 21.2, 20.8, 17.0, 21.6, 18.9 (a real failure, not a cut), 21.4 min. 8 of 12 ran over 20 min, median 20.8, max 23.8: the job runs within a minute or two of the limit, so any slow runner day cuts it. The estimate in `test-electron-cache.ts` (8.8 min) was stale.
- **Fix (stop-gap, T078).** `macos-pr.yml` `macos-test` `timeout-minutes` 25 to 45, same comment style as `ci.yml`. No suite, name or job structure changes. `test-electron-cache.ts` pins the limit at exactly 45 (a limit of 25 or above 45 fails at its own assert: a pinned stop-gap, to be lowered by T025 with the guard) and `TYPICAL_MIN` for the job is 23.8, so the npm-ci retry budget check (item 10) is honest.
- **Follow-up (T079, not built).** Split the job into two parts and set `TEST_JOBS` (the macOS runner has 2 to 4 cores, #2030); T025 then lowers both limits. Evidence: 8 of 12 runs over 20 min.
- **Not verified.** The new macOS duration distribution until runs on the 45 limit are measured; no real macOS run in this PR beyond its own path-filtered job.

### 2026-11-23: bug, the fast lane's compile differed from the full one (#2052; T080)

- **Seen** (job log read 2026-11-23): on #2052 at `04549335b` all three Fast lane jobs failed at "compile 40 test file(s)" with TS2345 in `scripts/demo-oauth-mcp.ts` ("`import("http").IncomingMessage` is not assignable to `import("http").IncomingMessage`"), while the required Build and test jobs compiled the same head cleanly.
- **Cause.** `fast-lane.js` wrote its temporary tsconfig (which extends `tsconfig.scripts.json` and lists the picked files) under the OS temp folder. TypeScript looks for automatic types (`node_modules/@types`) from the config's own folder upwards; from the temp folder it found none, so `node` types came in through imports, and Electron's nested copy (`node_modules/electron/node_modules/@types/node`) was loaded beside the root one: two `http` modules (`tsc --listFiles`: two `@types/node/http.d.ts` from the temp folder, one from the repo).
- **Fix.** The temporary config is written in a folder inside the repository root (`.fast-lane-*/`, git-ignored, removed after the compile), so type resolution is the full compile's; same `tsconfig.scripts.json` options, no type loosened. `test-fast-lane.ts` lists the program of a picked set that imports `demo-oauth-mcp.ts` (`tsc --listFilesOnly`, no type check) and asserts one `@types/node` copy, the root one, as in the full project; the mutant that writes the config under the OS temp folder dies at that assert.

### 2026-11-22: the release UI gate (T045; condition for O3)

- **Why.** Paco's condition for O3 (relayed by his bot in the team chat 2026-11-22 17:53 UTC, recorded on #1995; Vikram already said yes to O3): O3 may land only if `release.yml` requires the tagged commit's UI run to have finished green, before or together with O3. FR-014 said `release.yml` already checks it; it did not (read 2026-11-22, found in #2033 and filed there as T044 `[KNOWN GAP]`; built here as T045, since `specs:numbers` refuses a number another open PR adds).
- **What** (superseded in part by the two review deltas below: the runs and jobs that decide are policy (a), and no message suggests re-running a UI run). `release.yml` gains a first job `ui-gate` (`permissions: contents: read, actions: read`, quoted `env:` only); `verify` and `draft-release` need it, `build` needs `verify`, so nothing is built or drafted before it passes. It runs `scripts/release-ui-gate.js`, which lists `ui-platforms.yml` runs with `head_sha` = the tagged commit. Counting runs: this repository, event `push` on `main`, `workflow_dispatch` or `schedule` (a dispatch on a ref whose head is that commit runs the commit's own workflow file); never `pull_request` (it tests a merge ref, not the commit). The **latest** counting run decides, by `run_started_at` (a re-run attempt moves it), then the higher run id: an older green run does not outvote a newer red, cancelled or running one (fail closed; a red result is re-run, not hidden). No run yet: wait up to 15 minutes, then fail naming `gh workflow run ui-platforms.yml --ref <tag>`. Running: wait up to 150 minutes in all (job limit 160; main UI runs p90 about 100 min, E1), then fail. Completed: only `success` passes; `cancelled` fails saying to re-run it or dispatch on the tag, or tag a newer green commit; then `gh run rerun <release run> --failed`. API errors count as a wait and fail at the limit, never pass. A `-test.M` tag on a branch needs a by-hand run on the tag first. No existing release check changed (tag on `main`, notes, fold check, signing settings, `SHA256SUMS.txt`, attestations, draft only).
- **Checked.** `test:` `test:releaseuigate` (rules R1-R6 on fixtures, 23 source mutants each dying at its own assert, 8 wiring mutants on `release.yml`). `real:` read-only API (no workflow started), 2026-11-22: the script passes on the commits of v0.1.23..v0.1.27 (their main push UI runs were green). `[KNOWN GAP]` not run inside `release.yml` until the next tag.

### 2026-11-22: Paco's review of #2038 (CHANGES_REQUESTED, seven items)

- **Item 1, owner decision:** a red macOS shard of a nightly or by-hand run vetoed a green main push run under the gate as first built (Paco's dry run on real data refused three commits that way). Which runs and jobs decide is ONE named policy, `POLICY` in `scripts/release-ui-gate.js`, each option tested: `latest-run` (as first built), (a) `linux-windows-jobs` (the same runs judged on their Linux and Windows shards and the decision job; macOS not read; the run's jobs are read with `actions: read`), (b) `push-or-dispatch-without-macos` (only main push runs, and by-hand runs with no macOS job, decide). **In force: (a)**, owner pick Vikram 2026-11-23 11:51 UTC (option 1, recorded on #1995; Paco's bot recommended (a); Paco's and Ruben's own yes not recorded here). Its remedy: start a by-hand UI run on the tag. (b) stays tested as the alternative.
- **Item 2:** no message suggests re-running a UI run (after O3 a push re-run joins `ui-main` and cancels `main`'s newest UI run); the remedy is a by-hand run on the tag or a newer green tag, then re-running the release run's failed jobs. The cancel message no longer blames O3: it says what can cancel a run and points to its page.
- **Item 3:** the guard refuses `continue-on-error` and any `if:` in `release.yml`, and requires the gate's run line exactly (no `|| true`); the CLI exit codes (0 pass, 1 fail, 2 bad input) are tested by running the script; each with a mutant.
- **Item 4:** an API answer of 401, 403, 404 or another 4xx fails at once; only 429, 5xx and network errors wait (gh's stderr carries the status).
- **Item 5:** spec 021 FR-087 delta 2026-11-22 (re-running a release run stopped only by the gate) and a line in the `durbar-release` and `durbar-ci-rerun` skills.
- **Items 6, 7:** an assert label in `test-changelog.js` corrected; the CRLF cases can now fail (without the LF normalisation they do, asserted).
- `test:` `test:releaseuigate`, 44 source mutants and 14 wiring mutants. `real:` read-only (no workflow started), 2026-11-23, policy (a): v0.1.24..v0.1.27 pass; **v0.1.28 would have been refused**: its commit `5f0381446` has no UI run at all, because the merge queue pushed it to `main` together with the next merge (`c2131ce10`) and a push run is made for the newest commit of a push only. `[KNOWN GAP]` so a release commit the queue batches needs a by-hand UI run at that commit before the tag (or after it, then a re-run of the release's failed jobs); the `durbar-release` skill says so. Not changed: the gate still requires exactly the tagged commit.

### 2026-11-23: Paco's round 2 on #2038 (CHANGES_REQUESTED, six findings)

- **F1:** policy (a) now requires the complete set of Linux and Windows shards the run defines (`k/n`: 1..n each exactly once, one n per OS) and exactly one decision job; a missing, doubled, skipped, neutral or cancelled shard fails. The run's jobs are paged through (`total_count`); a short answer is not decided (it counts as a wait and fails at the limit).
- **F2:** fixtures and mutants for a skipped and a neutral shard and for no Linux shard.
- **F3:** the guard reads `continue-on-error`, `if:`, the gate's permissions and run line from the parsed YAML (js-yaml, reused from `test-ci-required-suites.ts`; FR-031), so a quoted key or a flow-style step cannot slip past.
- **F4:** the API-error limit, a bad input in the loop and the dry run's "every wait over" each have their own assert.
- **F5:** a 403 that names a rate limit (primary or secondary) waits within the limit; a permission 403 still fails at once.
- **F6:** T045 and the first delta updated; the no-run message names the merge-queue cause (v0.1.28) and says to start a by-hand UI run at that exact commit.
- `test:` `test:releaseuigate`, 59 source mutants and 17 wiring mutants.


### 2026-11-22: O2 and O3 built: Windows UI shards on a pull request only when `os_sensitive`, `main` UI runs collapse to the newest (T402, T403, T010)

Owner decision (Vikram, team chat, 2026-11-22 17:56 UTC, relayed by his coordinating agent, with Paco's variant): **O2 yes** in the map form: the Windows UI shards run on a pull request **only** when it touches OS-sensitive files; otherwise they run nightly, on `main` after the merge and by hand. **O3 yes** (as asked earlier that day), **on Paco's condition**: `release.yml` must require the tagged commit's UI run to have finished green (#2038, T045, the build of #2033's T044) before a newer `main` push may cancel an older `main` UI run; schedule and `workflow_dispatch` never cancel. The order is guarded in the repo: `test:uievents` fails while `ui-platforms.yml` cancels `main` pushes and `release.yml` has no `ui-gate` job running `scripts/release-ui-gate.js` with every other job behind it (mutants: gate removed, gate running another script, draft or verify not behind it). #2038 landed 2026-11-23 (`bffdef34e`), so the guard passes on its own and T010 is ticked. **2026-11-23: O2 and O3 agreed by the three owners** (Vikram, Paco, Ruben; recorded on #1995). This PR supersedes draft PR #2033 (the simple form: no Windows UI on any PR), whose O3 workflow part, `test:uievents` and spec 008 delta it takes and extends; #2033 is to be closed after this merges.

- **Scope.** Only the `os_sensitive` half of T006/T007 (new T402) and the Windows half of T008 (new T403) are built; the driver map (`drivers=`, the Linux shard sizing of FR-013, the gap guard and the 008 T130 tick) stays in T006, T007 and T008, waiting on #1247 as before. T009's by-hand run line is in `docs/development.md`.
- **The decision (`ci-changes.js`, the one decider; the base branch's copy runs, FR-191).** New output `os_sensitive=true|false`. It **fails closed**: a path is OS-neutral only when it is a plain path (no backslash, no `.`, `..` or empty segment, no blank at either end, no control character, not absolute) on the neutral list and on no sensitive line; the diff is neutral only when it is not empty and every path is. Neutral list (lower-case prefixes, matched case-sensitively, so `Src/renderer/x.js` is not neutral): `docs/`, `specs/`, `changelog.d/`, top-level `*.md`, `src/renderer/`, `scripts/fixtures/`, `scripts/test-*`, `scripts/shots-*` and `scripts/check-*` (`.ts`/`.js`), and `src/shared/` or `src/adapters/` `.ts`/`.js` files that neither on the base nor on the head, nor in any file they import by a relative path (followed, base and head), use `fs`, `path`, `os`, `child_process`, `net`, `tls`, `dgram`, `worker_threads`, `cluster`, `readline` or `electron` (with or without `node:`, any subpath) or `process.platform`, `env`, `arch`, `cwd`, `execPath`, `kill`, `pid`; a file unreadable on both sides, or an import that resolves to no source file in `src/` (a `.json`, a folder, a path out of `src/`), counts as sensitive. Sensitive lines inside the neutral prefixes, matched in any case: `src/renderer/keys.js`, `src/renderer/browserpane.js`, fonts (`.ttf`, `.otf`, `.woff`, `.woff2`, `.ttc`), the UI run's plumbing and font-sensitive checks (`driver-helpers.js`, `ui-suite.js`, `check-parallel.js`, `check-office-overlap.js`, `check-theme-geometry.js`, `check-mac-titlebar.js`), shell scripts (`.sh`, `.ps1`, `.cmd`, `.bat`). Everything else is sensitive by default: `src/main/` (`appmenu.ts` with it), `src/preload/`, `build/`, `package.json`, `package-lock.json`, `electron-builder` config, `tsconfig*`, every `.github/` file (workflows, actions, this decision), packaging and other `scripts/` helpers, `scripts/fakes/`, any unknown path. Every event but `pull_request` says true.
- **The wrapper (`ci-changes.sh`).** Its "everything runs" line writes `os_sensitive=true`; the base copy writes into a file in the temp folder, and the wrapper writes each of `code`, `themes`, `ui`, `macos`, `os_sensitive` to `$GITHUB_OUTPUT` **exactly once** (review of #2039: GitHub does not document which line wins for a repeated name): when the base copy wrote each once as exactly `true` or `false` they pass; when it left one out (a base copy older than `os_sensitive`, which is `main` until this lands), repeated one or wrote another value (`FALSE`, `false `, empty), everything runs (all five `true`, once each). This takes in #2032's single-`code=` guard (FR-387) as one rule for every name; `--suites` output is passed on as written. GitHub's `==` ignores case, so the exact check is the wrapper's.
- **The workflow (`ui-platforms.yml`, T403).** The `changes` job passes `os_sensitive` on. Matrix: schedule and `workflow_dispatch` Linux, macOS and Windows; a `pull_request` whose `os_sensitive` is `'false'` Linux only; every other case (a `pull_request` with `true`, a missing or other value; a `main` push whatever it says) Linux and Windows. "UI suite complete" keeps its name and its check: the decision job succeeded, then ui=false passes (its one early pass), else `needs.ui.result` must be `success`; with Windows left out on purpose that result is the Linux shards' alone, so the absent Windows shards cannot block the PR, a Windows shard that ran and failed or was cancelled fails it, and a failed, cancelled or skipped Linux shard fails it. It also prints when Windows was skipped. Concurrency (O3, #2033's text): `main` pushes share `UI on three OSes-ui-main` with `cancel-in-progress`; PR runs keep their per-PR group; schedule and dispatch keep `github.run_id` groups and never cancel. Spec 008 *Changes* (same date) amends FR-107 and FR-108.
- **021 FR-084 point 4.** Its text is in open PR #1247, not on `main`; the spec 021 *Changes* line amending it (FR-063 accounting of FR-012 and FR-014 as written above) waits for #1247, as T008 and T010 said.
- **Review of #2039 (Paco, heavy, 2026-11-22).** `OS_USE` now also catches `process[...]`, a destructured `process`, the platform words (`win32`, `darwin`, `platform` as a parameter, `isMac`, `IS_MAC`, `isWindows`), `os` calls that differ per OS, the `url`, `module` and `process` modules, a `require` or `import()` of a variable, `process.env` and friends, and `__dirname`/`__filename`; the drivers (`scripts/check-*`, `scripts/shots-*`) are read too, by the platform lines only (nearly every driver reads `process.env`, `__dirname` and `path` the same way on every OS: 198 of 239 stay neutral); `crew.js` and `profileeditor.js` (Windows path rules) are sensitive by name. "UI suite complete"'s `always()` and `permissions: {}` are pinned. The wrapper writes each output name exactly once (see below). FR-014 no longer reads "proposal".
- **Corrected:** FR-014 said `release.yml` checks a tagged commit's run is green; it does not (read 2026-11-22). Closed 2026-11-23 by #2038 (the release UI gate, T045).
- `test:` `test:ciossensitive` (`scripts/test-ci-os-sensitive.ts`): 79 sensitive fixtures (each path class: main process, `appmenu.ts`, preload, build, package files, electron-builder config, `tsconfig`, workflows, the decision, CI actions, packaging scripts, fakes, the test runner, unknown paths; keys, browser pane, fonts, plumbing, shell scripts; OS-using, importing, `node:`, subpath, `process.platform`, unresolvable, out-of-`src/`, base-only and unreadable shared files; case tricks; `..`, `./`, `//`, absolute, blanks, backslashes, control characters, an empty name), alone and beside a doc; 14 neutral fixtures; empty and non-list diffs; the real tree (`appmenu.ts`, `keys.js`, `browserpane.js`, `pathdirs.ts`, preload, `package.json` true; a renderer feature with its driver and docs false); 42 mutants of `ci-changes.js`, each dying at its own labelled assert; on throwaway repositories the wrapper: a renderer-only PR false, a PR that edits `ci-changes.js` to say false while changing `src/main` still true (mutant: a wrapper running the PR copy says false), a base copy writing no `os_sensitive` true, inexact values true, exact values kept, a repeated name, a silent base copy: everything runs; mutants: the raw output passed through leaves a missing name missing and a repeat repeated, no exact-value test lets `FALSE` through, every non-PR event true. `test:uievents` (`scripts/test-ui-platforms-events.ts`, from #2033, extended) evaluates the workflow's expressions per event and `os_sensitive` value, pins the summary's `always()` and `permissions: {}`, and checks `release.yml`'s UI gate whenever `main` pushes cancel; 20 mutants (Windows never on a PR, Windows on every PR, fail open on a missing value, `main` pushes reading `os_sensitive`, the output not passed on, an early pass when Windows was skipped, and #2033's concurrency and summary mutants). `test:uisuite` pins the new lines; `test:cichanges` expects the new output line.
- `[KNOWN GAP]` a renderer CSS or layout change that lays out differently with Windows fonts is found on `main` or overnight, not on the PR (styles are on the neutral list, as the spec's list had them); a `src/shared` file reaching an OS module through a non-relative import (a package) is not followed; the wrapper is the PR's own copy (as before, CODEOWNERS on `.github/` guards it). Not verified on a real run here: the first PRs and `main` merges after this lands show the matrix and the cancels; `read:` 7-day `ci:stats` after landing stays with T008.

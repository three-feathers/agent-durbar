# Tasks: 117 Delivery speed 2

**Input**: [spec.md](spec.md), [plan.md](plan.md). Tests first, 0 AI credits. One PR per rollout step (P1..P7), in order of benefit per cost. Numbers: a new spec numbers from 001 (`scripts/spec-numbers.js`); checked with `npm run specs:numbers` on 2026-11-22 against `origin/main` (`d0dce8669`) and the open PR heads.

## P0: spec

- [x] T001 Spec, plan, tasks, the 2026-11-22 measurements (E1..E7) and the `specs-index` block. Check: `npm run specs:check`, `npm run specs:numbers`, `npm run rules:check`, `npm run changelog:check`.

## P1: measure and guard (no workflow behaviour change)

- [ ] T002 [P] `scripts/test-ci-stats.ts` first, on a fixture of runs, jobs and PRs: percentiles (nearest rank), queue wait, minutes with ≥N queued, the code/tests/docs path classes of spec *Evidence*, by-label cycle time; the GraphQL query string contains no `body` or `title` field (mutant: add `title`, the test fails) [FR-001]
- [ ] T003 `scripts/ci-stats.js` and `npm run ci:stats [--days N]`: `gh` through `execFileSync` with an argument array, per-day pagination, `filter=all` jobs, sampling flags, output through `safe-print.js`; passes T002. `read:` run once and compare with spec E1..E6 (SC-001) [FR-001, FR-002]
- [ ] T004 [P] `scripts/test-workflow-concurrency.ts` in `test-suites.txt`: every `pull_request`-triggered workflow has a PR-number concurrency group and `cancel-in-progress` on `pull_request`; mutant on a copy of `ui-platforms.yml` fails [FR-010]
- [ ] T005 `weekly-retro.js` quotes `ci:stats` beside 021 T064's `dora` once both exist; until T064 lands, `ci:stats` alone [FR-001]

## P2: driver map and Linux-first UI (with 008 T130, after #1247)

- [ ] T006 `test-ci-changes.ts` cases first: `drivers` for a renderer-only diff, `all` for an unmapped file, a driver missing from the map fails, `os_sensitive` for a `src/main` file, every non-PR event gives `all` and `true` [FR-011, FR-012]
- [ ] T007 `.github/scripts/ci-drivers.json` and `ci-changes.js` outputs `drivers`, `os_sensitive` (base-branch copy decides, as FR-191); implements 008 T130's map in the same PR and ticks it there [FR-011]
- [ ] T008 `ui-platforms.yml`: Linux shards from the mapped drivers' recorded times (`ceil(sum/15)`), Windows shards only with `os_sensitive` (needs O2's yes; until then Windows keeps today's shards), "UI suite complete" unchanged; `ui-suite.js --only` if missing. Spec 008 pointer delta. `read:` 7-day `ci:stats` after landing in spec *Changes* [FR-012, FR-013, FR-016]
- [ ] T009 `docs/development.md` (CI section): the by-hand full run (`gh workflow run ui-platforms.yml --ref <branch>`) for a PR whose risk the map does not see [FR-012]

## P3: `main` UI collapse (after O3)

- [ ] T010 `ui-platforms.yml` push group `ui-main` with `cancel-in-progress: true`; schedule and dispatch unchanged; spec 008 delta reversing FR-107 for this workflow; `read:` `release.yml`'s green-run check named in the delta [FR-014]

## P4: Windows `npm test` (#1983)

- [ ] T011 `run-tests.js` writes per-suite CPU and wall seconds to the job summary; test in `test-run-tests` (or the existing runner test) on a fake suite list [FR-017]
- [ ] T012 Longest-first order for the five heavy suites inside the job; measure 7 days; if Windows p90 > 15 min, a 2-way Windows split behind one summary job named `Build and test (windows-latest)` (no ruleset change); same suite list and assertion count before and after, printed in the PR; Closes #1983 only when SC-003 holds [FR-018]

## P5: review profile

- [ ] T013 `scripts/test-review-profile.ts` first: every heavy pattern alone and mixed with UI files gives `heavy`; rename into and out of a heavy path, a deletion, an unreadable diff give `heavy`; a docs/renderer-only diff gives `light`; mutants (one pattern dropped, rename ignored) fail [FR-021]
- [ ] T014 `scripts/review-profile.js`; `ci-changes.js` output `profile`; PR template line for the profile [FR-020, FR-021]
- [ ] T015 After O4's written yes from the three owners: the `review-rounds.md` line exactly as spec O4 (net 0 words, `rules:check`), a spec 021 *Changes* pointer (FR-063 accounting), `docs/review-checklist.md` light/heavy note [FR-022, FR-023]

## P6: world-pack contract suite (after 102 T100, #1877)

- [ ] T016 Inventory (in the PR): per-world assertions in `scripts/` that the contract suite replaces, by file [FR-030]
- [ ] T017 `scripts/test-world-contract.ts`: every built-in pack through `worldpack.ts`, `checkSet`, `momentCoverage`, the feature-inventory row and the card check; a fixture pack missing a required pose fails naming it; the replaced per-world assertions removed in the same PR; spec 102 pointer delta [FR-030, FR-033]
- [ ] T018 Driver map entries per world (`DRIVER_WORLD=<id>` entries run only when that world's files or the shared engine change) [FR-031]

## P7: slicing guidance

- [ ] T019 `read:` whether `.specify/templates/tasks-template.md` is managed by `specify integration`; write FR-040's guidance there if not, else in `docs/review-checklist.md` and `docs/agent-notes.md` within their budgets [FR-040]
- [ ] T020 `ci:stats` reports FR-041's indicator (src share, PRs with no `src/` line) for the retro; never per person [FR-041]

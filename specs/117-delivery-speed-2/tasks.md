# Tasks: 117 Delivery speed 2

**Input**: [spec.md](spec.md), [plan.md](plan.md). Tests first, 0 AI credits. One PR per rollout step (P1..P7), in order of benefit per cost. Numbers: a new spec numbers from 001 (`scripts/spec-numbers.js`); checked with `npm run specs:numbers` on 2026-11-22 against `origin/main` (`d0dce8669`) and the open PR heads.

## P0: spec

- [x] T001 Spec, plan, tasks, the 2026-11-22 measurements (E1..E7) and the `specs-index` block. Check: `npm run specs:check`, `npm run specs:numbers`, `npm run rules:check`, `npm run changelog:check`.

## P1: measure and guard (no workflow behaviour change)

- [x] T002 [P] `scripts/test-ci-stats.ts` first, on a fixture of runs, jobs and PRs: percentiles (nearest rank), queue wait, minutes with ≥N queued, the code/tests/docs path classes of spec *Evidence*, by-label cycle time; the GraphQL query string contains no `body` or `title` field (mutant: add `title`, the test fails) [FR-001]
- [x] T003 `scripts/ci-stats.js` and `npm run ci:stats [--days N]`: `gh` through `execFileSync` with an argument array, per-day pagination, `filter=all` jobs, sampling flags, output through `safe-print.js`; passes T002. `read:` run once and compared with spec E1..E6 (SC-001) on 2026-11-22: queue wait, UI share (68 % vs 70 %), Windows build time, code/tests/docs split and merge-queue runs within ~5 %; minutes with >=10 queued 24 % vs 18.8 % (a busier week), jobs per head 15 vs 12 (no 15 s floor) and PR cycle p90 (newer window) differ [FR-001, FR-002]
- [ ] T004 [P] `scripts/test-workflow-concurrency.ts` in `test-suites.txt`: every `pull_request`-triggered workflow has a PR-number concurrency group and `cancel-in-progress` on `pull_request`; mutant on a copy of `ui-platforms.yml` fails [FR-010]
- [ ] T005 `weekly-retro.js` quotes `ci:stats` beside 021 T064's `dora` once both exist; until T064 lands, `ci:stats` alone [FR-001]

## P2: driver map and Linux-first UI (with 008 T130, after #1247)

- [ ] T006 (after #1247 landed, so 008 T130 exists) `test-ci-changes.ts` cases first: `drivers` for a renderer-only diff, `all` for an unknown path and for each core path (`src/main`, `src/preload`, `src/shared`, `src/adapters`, `app.js`, `index.html`, styles, `sim.ts`, build, `package.json`, a workflow file, a driver helper), guard fails when a `DRIVERS` entry or renderer module is in any rule's gap, `os_sensitive` for `src/main`, `appmenu.ts`, `keys.js`, `browserpane.js` and a `src/shared` file using `fs`, every non-PR event gives `all` and `true` [FR-011, FR-012]
- [ ] T007 (after T006; depends on #1247 for the 008 T130 tick) `ci-changes.js` only, no `ci-drivers.json`: outputs `drivers`, `os_sensitive` (base-branch copy decides, as FR-191); the reviewed table is a const in the same file; ticks 008 T130 in the same PR [FR-011]
- [ ] T008 (after T007; O2's yes for the Windows part) `ui-platforms.yml`: Linux shards from the mapped drivers' recorded times (`ceil(sum/15)`), Windows shards only with `os_sensitive` (until O2's yes Windows keeps today's shards), "UI suite complete" unchanged; `ui-suite.js --only` if missing. Spec 008 pointer delta and a spec 021 *Changes* line naming the amendment of FR-084 point 4 (**waits on #1247**: it amends that text; FR-063 accounting as spec FR-012). `read:` 7-day `ci:stats` after landing in spec *Changes* [FR-012, FR-013, FR-016]
- [ ] T009 (with T008) `docs/development.md` (CI section): the by-hand full run (`gh workflow run ui-platforms.yml --ref <branch>`) for a PR whose risk the map does not see [FR-012]
- [ ] T024 `[KNOWN GAP]` Not started, own spec needed (`/speckit.specify`): split `src/renderer/app.js` into modules so CI by diff and review get narrower; separate from P2, does not block it (FR-382). Not designed here

## P3: `main` UI collapse (after O3)

- [ ] T010 (after O3's written yes) `ui-platforms.yml` push group `ui-main` with `cancel-in-progress: true`; schedule and dispatch unchanged; spec 008 delta reversing FR-107 for this workflow and a spec 021 *Changes* line amending FR-084 point 4 ("`main` keeps the full three-OS matrix" becomes "the newest `main` push keeps it"); `read:` `release.yml`'s green-run check named in the delta [FR-014]

## P4: Windows `npm test` (#1983)

- [ ] T011 `run-tests.js` writes per-suite CPU and wall seconds to the job summary; test in `test-run-tests` (or the existing runner test) on a fake suite list [FR-017]
- [ ] T012 Longest-first order for the five heavy suites inside the job; measure 7 days; if Windows p90 > 15 min, a 2-way Windows split behind one summary job named `Build and test (windows-latest)` (no ruleset change); every suite, the masking suites included, stays under a required name; same suite list and assertion count before and after, printed in the PR; Closes #1983 only when SC-003 holds [FR-018]
- [ ] T025 Stop-gap (2026-11-22 delta): `ci.yml` `build-test` `timeout-minutes` 25 to 45 while #1983 is open; when T012's split lands, set it back to a limit that fits one shard and remove the stop-gap comment; the target stays Windows p90 at or under 15 min [FR-018]
- [ ] T022 (with T012, before any split lands) Guard test `scripts/test-ci-required-suites.ts`: every suite in `test-suites.txt`, and by name every redact or mask suite, runs in a job whose name is in the ruleset's required list as recorded in the spec (or a summary job carrying that name); the summary job fails on a failed, skipped or cancelled shard and on a suite-list mismatch, and the summary job itself carries `if: ${{ !cancelled() }}` (or `always()`) so that a failed shard cannot skip it (GitHub counts a skipped required check as passing). Mutants: a masking suite moved to an unrequired job, a summary that ignores `skipped`, one that ignores `cancelled`, the summary's `if:` removed, a dropped suite: each fails [FR-018]

## P5: review profile

- [ ] T013 `scripts/test-review-profile.ts` first: an unlisted file under each of `src/main`, `src/shared`, `src/preload`, `src/adapters`, `scripts/*trusted*`, `scripts/*.sh`, `.github` is `heavy`; `src/main/ipc/x.ts`, `src/main/convmask.ts`, `src/shared/url.ts`, `scripts/gh-trusted.sh`, `scripts/pr-gate.sh`, `scripts/safe-print.js` each `heavy`; a renderer line adding `innerHTML` or editing an escape helper `heavy`; rename into and out of a heavy path, a heavy deletion, an unreadable diff `heavy`; docs-only and CSS-only `light`; mutants (light list widened to `src/**`, rename ignored, sink rule dropped) fail [FR-020, FR-021]
- [ ] T014 `scripts/review-profile.js`; `ci-changes.js` output `profile`; PR template line for the profile [FR-020, FR-021]
- [ ] T015 After T014 has landed (the line names `review-profile.js`) and O4's written yes from the three owners: the *Sub-agents by size* line body exactly as spec O4, name kept. **Word budget**: the replaced words are named in spec O4; 34 out, 34 in, net 0 in `docs/rules/review-rounds.md` on `main` and on #1247's head (`rules:check`). A spec 021 *Changes* pointer (FR-063 accounting). No `docs/review-checklist.md` text (it is at 2,447 of 2,450) [FR-022, FR-023]

- [ ] T023 (with T015, same PR, same gates: T014 landed and O4's yes) `docs/agent-setup/README.md` *Sub-agents by size* (heading kept, it is a pointer target): the *Small* and *Medium* bullets become one *Light* bullet (`review-profile.js` says light: one `implementer`, diff read, CI record, no mutants or fuzz asked) and *Large or sensitive* becomes *Heavy* (everything `review-profile.js` does not call light, the list of FR-020); no net growth in words, counted in the PR (the file has no `rules:check` budget) [FR-022]

## P6: world-pack contract suite (after 102 T100, T433 and T434, #1877)

- [ ] T016 Inventory, committed in full in T017's PR: per-world assertions in `scripts/` that the contract suite replaces, by file. **Amended 2026-11-22** (spec *Changes 2026-11-22*, vocabulary profiles): the Mac session's plan-only read (71 files, about 190 world-specific asserts, about 66 replaceable, about 124 stay) sorted by rule R1..R6 of that entry [FR-030]
- [ ] T017 `scripts/test-world-contract.ts`: every built-in pack through `worldpack.ts`, `checkSet`, `momentCoverage`, the feature-inventory row and the card check; a fixture pack missing a required pose fails naming it; the replaced per-world assertions removed in the same PR; spec 102 pointer delta . **Amended 2026-11-22:** after 102 T100, T433 and T434; built-ins go through `checkSet` and the part machinery with their declared vocabulary profiles, user fixtures with the user profile; R1 and R5 are new checks on built-ins, not moved asserts; a registry world with no pack (`loft`, 102 OP-14 (c)) is reported "no pack", not passed; `world.css` rules and the flag, lazy-load, plain-tile, layout, contrast and accessibility asserts stay where they are [FR-030, FR-033]
- [ ] T018 Driver map entries per world (`DRIVER_WORLD=<id>` entries run only when that world's files or the shared engine change) ; first replaces the second copy of the `DRIVER_WORLD` id list pinned in `scripts/test-release-video.js` (R6) [FR-031]

## P7: slicing guidance

- [ ] T019 `docs/review-checklist.md` line 75 "- [ ] **Slice size**: about 800 changed lines, pictures excluded." (11 words) becomes "- [ ] **One vertical slice**: ~800 changed lines, pictures excluded." (11 words; no other file points to *Slice size*, checked with `grep` 2026-11-22). **Word budget**: net 0, stays 2,447 of 2,450; no `docs/agent-notes.md` text; `.specify/templates/*` not edited (managed by `specify integration`) [FR-040]
- [ ] T020 `ci:stats` reports FR-041's indicator (src share, PRs with no `src/` line) for the retro; never per person [FR-041]

## Owner settings (O1)

- [ ] T021 (after O1's written yes from the three owners, line by line as spec *O1, one line per check*) The owners apply the ruleset changes (an agent changes no repo setting); for the macOS line, if the owners choose to stop the PR job, a spec 008 delta reversing FR-135 and `macos-pr.yml` change in the same PR; record each answer in spec *Changes* [FR-015]

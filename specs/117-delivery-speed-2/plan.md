# Implementation Plan: Delivery speed 2 (spec 117)

**Branch**: `117-delivery-speed-2` | **Date**: 2026-11-22 | **Spec**: [spec.md](spec.md)

## Summary

Measure first (`npm run ci:stats`), then cut the one big cost: the UI shards are 70 % of runner time on PRs and on `main` pushes, in a 20-job pool that has ≥10 jobs queued 19 % of the week. Concurrency cancel is already in place everywhere (spec E2), so the order is: stats + guard (P1), driver map and Linux-first UI on PRs (P2, on 008 T130), `main` UI collapse (P3, owner), Windows `npm test` split (P4, #1983), review profile script and rule proposal (P5), world-pack contract suite (P6, after 102 T100), slicing guidance (P7).

## Technical context

- Workflows: `.github/workflows/ci.yml` (Build and test ×3, Office layout), `ui-platforms.yml` (UI shards: Linux 4, Windows 4 on PR and push; macOS 3 nightly), `macos-pr.yml` (path-filtered real macOS), `spec-kit.yml`, `pages.yml`, `world-matrix.yml`.
- The one decider: `.github/scripts/ci-changes.js` (run as the base branch's copy, fail open toward running; outputs `code`, `ui`, `themes`, `macos`). New outputs go here: `drivers`, `os_sensitive`, `profile`.
- UI suite: `scripts/ui-suite.js` (`DRIVERS`, 256 entries, 22 world-parameterised: 21 `retro`, 1 `cave`; `--shard i/n` time-balanced, FR-183).
- Unit tests: `scripts/run-tests.js` (compiles once, runs suites in parallel), `scripts/test-suites.txt` (280 lines).
- Packs: `src/shared/worldpack.ts` (manifest, caps), `worldmoments.ts`, `scripts/test-world-packs.ts`, `scripts/fixtures/worlds/`; `checkSet` is 102 T100 (not built, issue #1877).
- No AI credits anywhere: Node scripts, `gh api` reads, simulator drivers.

## Constitution check

| Principle | How this plan holds it |
|---|---|
| I Spec Kit (non-negotiable) | This PR is spec, plan, tasks only; each build PR adds a pointer delta to the owning spec (008, 021, 102). |
| II Adapters | No adapter or renderer type change. |
| III Safe, no secrets (non-negotiable) | `ci:stats` reads metadata only and prints through `safe-print.js`; no body or title of anyone is read. The light review profile never applies to masking, IPC, secrets, permissions, user-file writes, shell or spending; the classifier fails closed. No job gains secrets; no `pull_request_target`. |
| IV No credits | Everything is local Node or GitHub metadata. |
| V Calm UI | No UI change. |
| VI Three OSes | Windows Build and test stays on every PR (O1 recommendation); macOS and the full 3-OS UI matrix stay on every `main` push (one run per newest commit under O3) and nightly. The parity rule still holds on `main`; PRs read "not verified on macOS" as today. |
| VII Quality gates | No suite dropped, no assertion weakened; the merge queue keeps running what it runs. |
| VIII Honest limits | Every table in the spec names its window, method and `[KNOWN GAP]`s. |

## Design per step

### P1: `ci:stats` and the concurrency guard (FR-001, FR-002, FR-010)

- `scripts/ci-stats.js`: `gh api` via `execFileSync('gh', [...args])` (array, no shell), paginated per day (the runs list caps at 1,000 per query), jobs with `filter=all`. Pure functions (`percentile`, `classifyPath`, `queueWait`, `concurrencyProfile`) exported for `scripts/test-ci-stats.ts` on a fixture JSON. Never requests `body` or `title` fields (GraphQL query lists fields explicitly; a test asserts the query string has neither). Sampling flags for the cheap workflows to stay within the API rate limit (the 2026-11-22 run used ~1,800 calls).
- `npm run ci:stats` in `package.json`; not in `npm test` (network). `weekly-retro.js` calls it beside `dora` (021 T064) when both exist.
- `scripts/test-workflow-concurrency.ts`: YAML read as text with a small line parser (no new dependency), every file with `pull_request:` under `on:` must have `concurrency:` with a group containing `github.event.pull_request.number` and `cancel-in-progress` true on `pull_request`. Mutant: remove the block from a copy of `ui-platforms.yml`, the test fails.

### P2: driver map and Linux-first UI (FR-011..FR-013), on 008 T130

- Wait for #1247 so 008 T130 is defined; P2 implements T130 and this spec's delta in one PR (one vertical slice).
- One decider (2026-11-22 delta): the map is a const inside `.github/scripts/ci-changes.js`; no `ci-drivers.json`. Rules in order: core paths (src/main, preload, shared, adapters, app.js, index.html, styles, sim.ts, build, package, CI files, driver helpers) select ALL; else a driver's own `scripts/` closure, `dist/src` literals in a driver, world names, then the reviewed renderer-module-to-drivers table; an unknown path selects ALL. A guard in `test-ci-changes.ts` fails when a `DRIVERS` entry or a renderer module is in any rule's gap. `os_sensitive`: src/main, preload, build, packaging, dependencies, appmenu.ts, keys.js, browserpane.js, and a shared/adapters file using path, fs, os or child_process.
- `ci-changes.js` outputs `drivers=all|name,name` and `os_sensitive=true|false` (as above); on any event but `pull_request`, `drivers=all` and `os_sensitive=true` (unchanged full runs).
- `ui-platforms.yml`: the matrix comes from the `changes` job's output (`fromJSON`): Linux shards = `ceil(sum/15 min)` of the mapped drivers' recorded times (time table already used by `--shard`); Windows only when `os_sensitive` (a by-hand `workflow_dispatch` run stays the full matrix, as today; no label, AGENTS.md *Labels* allows no new family). `ui-suite.js --only <names>` (exists? if not, added) runs the subset. "UI suite complete" keeps its name.
- Risk: a renderer file wrongly mapped to too few drivers; mitigations: fail open on unmapped files, full runs on `main` and nightly, the map reviewed by another side.

### P3: `main` UI collapse (FR-014), after O3

- `ui-platforms.yml` concurrency group for `push`: `ui-main`, `cancel-in-progress: true`; PR groups unchanged; schedule and dispatch keep their own run-id groups. Spec 008 delta reverses FR-107 for this workflow only. `release.yml` already requires a green `main` run of the tagged commit: `read:` check in the build PR, and if it only requires CI, say so in the delta (the UI run was never a release gate).

### P4: Windows `npm test` split (FR-017, FR-018, #1983)

- `run-tests.js` records CPU and wall seconds per suite into `$GITHUB_STEP_SUMMARY` (all OSes).
- First try: start the five heavy suites first (longest-processing-time order) inside the same job, so they do not end the job alone; measure. If p90 is still over 15 min, split `npm test` into two time-balanced halves as a 2-entry matrix on Windows only (`TEST_SHARD=1/2`). The summary job takes the required name `Build and test (windows-latest)` (no ruleset change) and fails when a shard failed, was skipped or was cancelled, or when the shards' suite lists together differ from `test-suites.txt` (so a suite cannot fall out). Masking and redaction suites never move to a job without a required name (FR-018); Linux and the macOS leg keep their single job. Guard test with mutants: T022.
- The heavy suites' own cost (redact fuzz loops) is left to their owner spec (012) unless the counters show a single hot loop; then a spec 012 delta first.

### P5: review profile (FR-020..FR-023)

- `scripts/review-profile.js`: one **light** list (FR-020's paths and the two content rules: renderer lines touching an HTML sink or escape helper, and tests or drivers loading a non-light `src/` file or carrying a security word in the name); every path not on it is heavy. Read by `ci-changes.js` as output `profile`. Input: `git diff --name-status -M` plus `git diff -U0` for the renderer content rule; R/D on a heavy path is heavy; an unreadable diff is heavy. Sink patterns proposed: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `srcdoc`, `setAttribute('href'|'src'`, `.href =`, `.src =`, and calls or definitions of `esc*`, `safeMask`, `mask*`.
- `test-review-profile.ts` table plus mutants. PR template line: "Profile (`review-profile.js`): heavy/light". Rule text only after O4.

### P6: world-pack contract suite (FR-030..FR-033), after 102 T100

- `scripts/test-world-contract.ts` iterates built-in packs (worlds catalogue + `src/renderer/worlds/*` registry), calls `worldpack.ts` readers, `checkSet`, `momentCoverage`, the feature-inventory row reader and the card check. Inventory in the build PR: which per-world assertions it replaces (named per test file), removed in the same PR (no duplicate rule, spec 021 FR-031).
- Driver map entries per world: `src/renderer/worlds/<id>/**` and `worlds/<id>/**` → that world's `DRIVER_WORLD=<id>` entries.
- Character sets after worlds (Not decided in the spec).

### P7: slicing guidance (FR-040, FR-041)

- `.specify/templates/*` are managed by `specify integration` (hashes in `.specify/integrations/speckit.manifest.json`, `read:` 2026-11-22), so they are not edited. The guidance is one word-neutral rewrite of `docs/review-checklist.md`'s *Slice size* line (T019); `docs/agent-notes.md` gets nothing (4,597 of 4,600).

### P8: fast lane and the docs-only skip (FR-383, FR-384), 2026-11-22 delta

- `ci-changes.js`: `NEVER_DOCS` (`src/`, `scripts/`, `.github/` are never docs) in front of the old docs pattern; `fastSuites(files, io)` and the `--suites` mode (writes `fast=yes` and `suites=<names>` only, so the existing outputs and their tests stay as they are). The literal targets of each step file are read once per tree (a `WeakMap` cache), so the decision takes about a second.
- `fast-lane.yml` (one job, three-OS matrix): checkout (`fetch-depth: 2`, no kept credential), `ci-changes.sh --suites` (base copy), the PR's copy only when the base has no `fast` output, then setup-node, `npm-ci` (one 30 s retry) and `node scripts/fast-lane.js` only when a suite was picked.
- `scripts/fast-lane.js`: a temporary tsconfig extending `tsconfig.scripts.json` with the picked test files and every other `scripts/test-*.ts` excluded (about 10 s instead of about 36 s locally), `tsc -p tsconfig.json` and `copy-assets.js` only when a step file reads `dist/`, `ensureElectron` for `checkfuses`/`macos` suites, then `runMain`; phase times to the job summary.

## Complexity tracking

No new dependency, one decider kept. One new workflow file, `fast-lane.yml` (P8): a ci.yml job would fall under FR-018's guard of the required `npm test` job (T022) and collide with the Windows shard work (T012).

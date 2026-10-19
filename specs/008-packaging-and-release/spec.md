# Feature Specification: Packaging, CI and draft releases

**Feature Branch**: `008-packaging-and-release` (reverse-engineered; packaging milestone)
**Created**: 2026-10-16
**Status**: Implemented, **unsigned** alpha (reverse-engineered from `package.json` build config, `scripts/prepare-runtime.js`, `after-pack.js`, `.github/workflows/*.yml`, README, CONTRIBUTING)
**Input**: "Ship installable builds for macOS, Windows and Linux without paying for certificates yet, built by CI, published by hand."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install a build for my OS (Priority: P1)

From the GitHub Releases page I download a file for my system and run it; the README explains the OS warnings for unsigned apps.

**Acceptance Scenarios**:

1. **Given** macOS Apple Silicon / Intel, **When** I download the `.dmg` or `.zip`, **Then** I get `Agent-Durbar-<version>-arm64|x64.<ext>`. *(read:; the draft release exists, CI run succeeded 2026-10-16 per `gh run list`; **never installed on a Mac**)*
2. **Given** Windows 10/11 x64, **When** I download, **Then** I get an NSIS installer (`Agent-Durbar-Setup-<v>.exe`, per-user, choose folder) or `Agent-Durbar-<v>-portable.exe`. *(read:; never installed on Windows)*
3. **Given** Linux x64, **When** I download the AppImage and `chmod +x`, **Then** it runs (maybe with `--no-sandbox`). *(sim: built here; launching the packaged app was not recorded)*

---

### User Story 2 - The packaged app can actually start Copilot (Priority: P1)

The bundled Copilot runtime must be reachable at run time: it is unpacked from the asar and located by path. A build without it fails.

**Acceptance Scenarios**:

1. **Given** `npm run pack:dir` on Linux, **When** it finishes, **Then** `afterPack` has verified `app.asar.unpacked/node_modules/@github/copilot-sdk-linux-x64/prebuilds/linux-x64/copilot-runtime` and `runtime.node` exist and no other platform's runtime is bundled. *(re-verified 2026-10-16: exit 0)*
2. **Given** a packaged app, **When** the adapter starts, **Then** it passes that unpacked path to the SDK. *(test: path logic; real start of a packaged app not recorded)*

---

### User Story 3 - A tag makes a draft release; I publish by hand (Priority: P2)

Pushing a tag `v*` that matches `package.json` builds all platforms on GitHub Actions, uploads artifacts and creates or updates a **draft** (pre-)release with `SHA256SUMS.txt`. Nothing is published automatically.

**Acceptance Scenarios**:

1. **Given** tag `v0.1.0-alpha.1`, **When** pushed, **Then** the workflow builds macOS (arm64, then x64), Windows and Linux and creates a draft pre-release. *(real: run 38908947850 succeeded; draft "Agent Durbar v0.1.0-alpha.1" exists)*
2. **Given** a tag that differs from `package.json` version, **When** pushed, **Then** the workflow fails before building. *(read:)*

---

### User Story 4 - CI on every push and PR (Priority: P2)

Typecheck, build and `npm test` run on Ubuntu, macOS and Windows; a Linux job also packs the app and checks the runtime is unpacked.

**Acceptance Scenarios**:

1. **Given** a push to `main` or any pull request, **When** CI runs, **Then** the 3-OS matrix and the packaging smoke run. *(real: last run on main, success)*

---

### Edge Cases

- Each installer carries **only its own** platform's runtime (`prepare-runtime.js` downloads the target's package if missing, removes others). `[IMPLEMENTED]` real: (CI)
- Release job never signs or publishes; `CSC_IDENTITY_AUTO_DISCOVERY=false`. `[IMPLEMENTED]` read:
- macOS arm64 needs at least an ad-hoc signature to run: the config uses `identity: "-"` (ad-hoc), `hardenedRuntime: false`, `dmg.sign: false`. So macOS builds are **ad-hoc signed, not Developer ID signed, not notarized**. `[IMPLEMENTED]` read:
- All third-party actions are pinned by commit SHA with a version comment. `[IMPLEMENTED]` read: (SHA of checkout v7.0.1 re-checked against the GitHub API 2026-10-16)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** `[IMPLEMENTED]` real: `electron-builder` 26 config in `package.json`: appId `io.github.three-feathers.agentdurbar`, product "Agent Durbar", output `release/`, files `dist/**` + `package.json`, `asar: true`, `asarUnpack` for `@github/copilot-sdk-*` and `koffi`, `npmRebuild: false`.
- **FR-002** `[IMPLEMENTED]` real: Targets: mac `dmg` + `zip` (arm64 and x64 built in separate runs), Windows `nsis` + `portable` (x64), Linux `AppImage` (x64); artifact names fixed by config.
- **FR-003** `[IMPLEMENTED]` real: `scripts/prepare-runtime.js <platform-arch>` makes `node_modules/@github` hold exactly one runtime package for the build target (fetches it with `npm pack` when missing).
- **FR-004** `[IMPLEMENTED]` real: `scripts/after-pack.js` fails the build when the runtime executable or `runtime.node` is missing/empty or a stray platform runtime is present; it `chmod 755` the runtime on non-Windows.
- **FR-005** `[IMPLEMENTED]` read: `unpackedRuntimePath()` resolves `process.resourcesPath/app.asar.unpacked/node_modules/@github/copilot-sdk-<plat>/prebuilds/<plat>/copilot-runtime[.exe]` only when running from an asar, and the file exists; otherwise the SDK finds it. Unit-tested for all three OSes.
- **FR-006** `[IMPLEMENTED]` real: CI (`ci.yml`): on `pull_request` and `push` to `main`, least-privilege `contents: read`, `concurrency` cancel; job `build-test` (matrix ubuntu/macos/windows, Node 22, `npm ci`, `typecheck`, `build`, `test`); job `package-smoke` (Linux, `npm run pack:dir`).
- **FR-007** `[IMPLEMENTED]` real: Release (`release.yml`): on tag `v*`; checks tag == `package.json` version; typecheck + tests per OS; unsigned package; upload artifacts (14 days); `draft-release` job with `contents: write` creates/updates a **draft**, `--prerelease` when the tag has a `-`, attaches artifacts + `SHA256SUMS.txt`.
- **FR-008** `[IMPLEMENTED]` read: No auto-update; README says so and documents the macOS Gatekeeper, Windows SmartScreen and Linux AppImage first-run steps.
- **FR-009** `[KNOWN GAP]` **Not code-signed or notarized** (macOS Developer ID + notarization, Windows Authenticode). Needs paid certificates: feature 014, **needs approval**.
- **FR-010** `[KNOWN GAP]` Installed builds were never run on macOS or Windows by a person; CI only proves they build and that unit tests pass there. The Linux packaged app was built here; no recorded launch of the packaged binary talking to Copilot. (Feature 013/014.)
- **FR-011** `[KNOWN GAP]` Only x64 for Windows and Linux; no arm64 builds, no `.deb`/`.rpm`, no Flatpak/Snap/winget/Homebrew. `read:`
- **FR-012** `[KNOWN GAP]` No provenance: no build attestation, and checksums are uploaded by the same workflow that builds the files. `read:`
- **FR-013** `[IMPLEMENTED]` (2026-10-19) `package.json` has `engines.node` `^20.19.0 || >=22.12.0`, matching CONTRIBUTING; CI builds with Node 22 (20.19 is not run in CI). Was: no `engines` field. (Task T022.)
- **FR-014** `[KNOWN GAP]` `.github/workflows/spec-kit.yml` ("Spec Kit gate") fails PRs that change `src/` without `specs/` or a `Spec-Exempt` reason; it checks presence only, not that each spec has plan/tasks, and it is not a required status check unless the maintainer sets it in branch protection.
- **FR-015** `[KNOWN GAP]` `package-smoke` runs `pack:dir` for Linux only; macOS/Windows packaging is first exercised by the tag workflow. `read:`
- **FR-016** `[KNOWN GAP]` Dependency updates are manual (no Dependabot). `read:`

### Key Entities

- **Build target**: `<platform>-<arch>`; **Runtime package**: `@github/copilot-sdk-<target>`; **Artifact**: file attached to the draft release.

## Success Criteria *(mandatory)*

- **SC-001**: A tag that matches `package.json` produces a draft release with artifacts for all three OSes and a checksum file (real: v0.1.0-alpha.1).
- **SC-002**: A build lacking the runtime fails in CI instead of shipping (read: `afterPack`; re-verified positive path 2026-10-16).

## Assumptions

- GitHub-hosted runners and `npm pack` can fetch `@github/copilot-sdk-<target>` for a non-native architecture.
- Users accept first-run OS warnings for an unsigned alpha.

## Changes

### 2026-10-16: layout check in CI (closes spec 001 FR-015 / spec 010 FR-007 for the office layout)

- **FR-017** CI job `office-check` (Ubuntu only): `npm ci`, `npm run build`, then `xvfb-run -a npm run check:office` (95 combinations, simulator only, no AI credits). Measured on the maintainer's Linux box 2026-10-16: 65 s including the build, 95/95 passed, repeated runs identical. Not run on macOS/Windows (needs xvfb semantics; font metrics differ and would make the density expectations flaky). The step has `timeout-minutes: 10`.
- `[KNOWN GAP]` The check measures layout in headless Chromium with the runner's fonts; it asserts no overlap/clipping/overflow and the 10.5px floor, **not** which density is chosen, so font differences between runners do not make it flaky.

### 2026-10-16: owner, credits and app id (Three Feathers)

- **FR-018** `[IMPLEMENTED]` `test:` The app names **Three Feathers** as author/owner and credits three key contributors: `vikramgorla`, `fjcabello`, `rubenlupi` (GitHub handles are used as the names, decided by Vikram 2026-10-16). They are defined once in `src/shared/about.ts` and used by: `app.setAboutPanelOptions` (applicationName, version, copyright, credits for macOS/Windows, authors for Linux, website); Settings > About (via `settings:get`); `package.json` `author` (Three Feathers) and `contributors`; electron-builder `copyright` (macOS `NSHumanReadableCopyright`, Windows file legal copyright) = `Copyright (c) 2026 Three Feathers contributors`; `LICENSE` (same line, text stays MIT); README credits. `scripts/test-about.ts` asserts the About options contain `Three Feathers` and all three handles, and that package.json, `copyright`, LICENSE and README agree with the constants.
- **FR-019** `[IMPLEMENTED]` `test:` appId changed to `io.github.three-feathers.agentdurbar` (was `io.github.vikramgorla.agentdurbar`; changes FR-001). Hyphens are valid in macOS bundle ids and Windows AppUserModelIDs. Nothing was released to users, so no migration; an earlier test install is a separate app. Saved data lives in the Electron user-data folder, named after the app name (not the id), so it is unaffected (`read:` and checked by printing `app.getPath('userData')`, see the pull request).
- To use real names later, change `CONTRIBUTORS` (and `package.json` `contributors`). `[KNOWN GAP]` The macOS/Windows About panel and installer metadata were not looked at on those OSes (`read:`); only Linux was run.

### 2026-10-19: faster CI (owner: "ci is the new bottleneck")

*Measured on `main` before the change:* the slowest job, the office check, took 6.7 min (381 s of it in `check:office`). `npm test` took about 240 s on each of the three OSes, and about 200 s of that was 40 copies of the same `tsc -p tsconfig.scripts.json`: every `test:*` script compiles on its own. The package smoke waited for the build-and-test jobs before starting.

- **FR-020** `npm test` runs `scripts/run-tests.js`. It compiles the test scripts **once**, then runs the suites named in `test:serial` (the old chain, kept as the single list and still runnable) **in parallel**, each suite's steps in order. The worker count is `TEST_JOBS`, by default the number of CPUs up to 8. Each suite's output is printed whole when it ends, with every line of a failing suite. A name filter is allowed: `npm test -- folders`. `test:` on Linux, all 40 suites passed in about 16 s, against about 240 s before, in four runs at 4 and 8 workers; a deliberately broken suite fails the run.
- **FR-021** `check:office` can be sharded: `OFFICE_SHARDS=n OFFICE_SHARD=k` runs every n-th unit (one window size of one block), starting at k. CI runs **4 shard jobs** in parallel. The required check **Office layout check (xvfb)** keeps its name: it waits for the shards and passes only when all of them passed, so the repository ruleset does not change. `test:` 3 shards locally gave 127 + 92 + 83 = 302 checks, the same total as one full run.
- **FR-022** The **package smoke** no longer waits for build-and-test. It builds by itself.
- **FR-023** A pull request that changes only `docs/`, `specs/` or Markdown files skips the build, test, package and office jobs. A small **What changed** job decides; a skipped required job counts as passed, and the office aggregator passes on "skipped". Pushes to `main` always run everything.
- **FR-024** `.github/workflows/branch-cleanup.yml` deletes branches whose pull request was **merged more than a day ago**. It runs daily (03:17 UTC) or by hand; a hand run defaults to a dry run. It never deletes:
  - a fork's branch;
  - the default branch;
  - a branch an open pull request still uses;
  - a branch that no longer points at the commit its pull request merged (new work after the merge is kept).
  
  It uses the workflow's own token (`contents: write`). A deleted branch can be restored from its pull request page. `test:` the same script dry-run locally against the repository listed 7 branches to delete and skipped the ones already gone. Not yet run as a workflow.
- **Measured after the change** (PR #250's own run, 2026-10-19):
  - wall time **2.5 min**, against about 7 min;
  - build and test: ubuntu 26 s, macOS 36 s, Windows 87 s (each about 270 s before);
  - office shards 122-129 s each, in parallel; package smoke 25 s;
  - the What changed job 7 s and the aggregator 2 s.
- The branch cleanup workflow had not run yet when this was written.

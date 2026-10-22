# Feature Specification: Packaging, CI and draft releases

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: index
title: Packaging, CI, draft releases
status: implemented (unsigned); 2026-10-20 delta: app name and profile folder (#353, T037) built (unit tests, Linux simulator, a dev run on a real Mac by Paco; a packaged Mac build and Windows not run); 2026-10-21 delta: packaged display names (#384, T039) built on Linux (unit tests, `dist:linux`); Windows and macOS asserted only in CI; T094 (2026-10-21, #414): the simulator drivers share `scripts/driver-helpers.js` (FR-097); T095/T097 (2026-10-22): merge-queue-ready CI (FR-098..FR-102); owner decision: no gate job, one office job, UI one job per OS, macOS on `main`/nightly with an issue on failure, drafts skipped, no label triggers, timeouts everywhere (FR-104..FR-110); T096 (2026-10-22): a test run keeps drawing when another window covers it (FR-103; Linux shared-display run, Windows runner pending); T098: theme layout checks on PRs in Clean Office and Retro only, every theme on `main`/nightly (FR-111); T099: ui-suite fails at once on a driver syntax error (FR-112), in review; T100 (2026-10-22, flake on #535): `check:geometry` captures wait for a steady simulator (FR-113), Linux simulator only
-->

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
- **FR-010** `[KNOWN GAP]` (narrowed 2026-10-21, see Changes) Installed builds were never run on macOS or Windows by a person; CI only proves they build and that unit tests pass there. The Linux packaged app was built here; no recorded launch of the packaged binary talking to Copilot. (Feature 013/014.)
- **FR-011** `[KNOWN GAP]` Only x64 for Windows and Linux; no arm64 builds, no `.deb`/`.rpm`, no Flatpak/Snap/winget/Homebrew. `read:`
- **FR-012** `[KNOWN GAP]` No provenance: no build attestation, and checksums are uploaded by the same workflow that builds the files. `read:`
- **FR-013** `[IMPLEMENTED]` (2026-10-19) `package.json` has `engines.node` `^20.19.0 || >=22.12.0`, matching CONTRIBUTING; CI builds with Node 22 (20.19 is not run in CI). Was: no `engines` field. (Task T022.)
- **FR-014** `[KNOWN GAP]` `.github/workflows/spec-kit.yml` ("Spec Kit gate") fails PRs that change `src/` without `specs/` or a `Spec-Exempt` reason; it checks presence only, not that each spec has plan/tasks, and it is not a required status check unless the maintainer sets it in branch protection.
- **FR-015** ~~`[KNOWN GAP]`~~ closed 2026-10-21 (see Changes): `package-smoke` runs `pack:dir` for Linux only; macOS/Windows packaging is first exercised by the tag workflow. `read:`
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

### 2026-10-19: the running window shows the app icon on Linux (issue #247)

*Found* (after the new icon, #246):
- `BrowserWindow` got no `icon`, so `npm start` on Linux showed Electron's default icon.
- `package.json` had no `desktopName`, so a desktop could not link the running AppImage window to its `.desktop` entry, and showed a generic icon in the dock.
- Windows and macOS take the icon from the `.exe` and `.icns`.

- **FR-025** `[IMPLEMENTED]` On Linux the window is created with `icon` set to the app icon (`build/icon.png`, copied to `dist/icon.png` by the build, so the packaged app has it in `app.asar`). Other platforms are unchanged.
- **FR-026** `[IMPLEMENTED]` `package.json` has `"desktopName": "agent-durbar.desktop"` and `build.linux.syncDesktopName: true`. Electron then uses `agent-durbar` as the window's app_id / WM_CLASS, and the AppImage's desktop entry has the same name and `StartupWMClass`. Without it, electron-builder warned.
- `test:` (2026-10-19, Linux, xvfb):
  - the AppImage built from this branch has `agent-durbar.desktop` with `StartupWMClass=agent-durbar`; the published alpha.6 AppImage has `StartupWMClass=Agent Durbar`, which does not match the window, so that was the bug;
  - the running packaged window has `WM_CLASS` `agent-durbar` and a `_NET_WM_ICON`; on main, `_NET_WM_ICON` was missing;
  - `dist/icon.png` is in `app.asar`.
  
  Not checked by eye on a GNOME or KDE dock.

### 2026-10-19: CI on `main` no longer cancels itself

*Found:* `ci.yml` had `cancel-in-progress: true` for every ref. When two PRs merged a few minutes apart, the release commit of alpha.7 (`d90fcd4`) had its CI cancelled twice, by the next merge and again during a re-run. Nothing proved that commit green, although the packaged check passed on it.

*Corrected:* `cancel-in-progress` is true only for pull requests, where a newer push supersedes the old run. On `main`, every merge commit's run finishes, so a release can be tagged on a commit with a complete CI run. Runs on `main` now overlap a little more; the cost is runner minutes, which are free for this public repository.


### 2026-10-19: checks that keep the machine usable, and the theme matrix in CI

*Owner:* "i dont want tests and ci to slow down our development - have the principle of super optimization and parallelization while not compromising on the quality". Then, after a first parallel version: "tests bombarded system, cpu and memory were at max and everything became unresponsive - I had to do a powercycle".

*Found:*
- `check:themes` ran `check:office` 7 times in a row (6 built-in themes and a user-theme fixture), and each run rebuilt the app first; locally it took more than 30 minutes. CI never ran it.
- A first parallel runner started 4 Electrons on a 4-core laptop with about 2 GB of memory available, while a stray earlier check was probably still running. It froze the machine. Measured afterwards: one office-check Electron needs about 0.6 GB and **more than two cores** (it draws the animated office in software under xvfb), so 2 jobs already load 4 cores to about 5.
- `check-office-overlap.js` wrote its result to one fixed file in the temp folder, so two checks at once could read each other's result.

*Decision:*
- **FR-027** ~~A Theme layout job in CI on every PR: the full office check in the 5 other themes and the user fixture, 2 shards each.~~ Built and green (12 jobs of 2.3-3.9 min), then replaced the same day by FR-031: the owner asked "should we really test all themes everytime... test one theme and enforce ui on theme... and we test multiple themes only on demand". The matrix stays, on demand only.
- **FR-028** `scripts/check-parallel.js` runs the office check locally in parallel, **without taking the machine**: one build; at most half the CPUs at once (at most 4; `CHECK_JOBS`); a new job starts only while 1.5 GB of memory is available; under 600 MB the newest job is stopped (its whole process group) and queued again; everything at nice 10; a job that takes longer than 15 minutes fails (`CHECK_TIMEOUT`); Ctrl-C stops every job. `npm run check:themes` and `npm run check:office:fast` use it. Each office-check run writes its result to its own file (`OFFICE_FAIL_MARKER` in its own user-data folder).
- **FR-029** `npm test` leaves a core free (workers = CPUs minus one, at most 8) and runs at nice 10.
- **FR-030** **Animation checked once, the rest without it.** *Owner:* "can we check animation once and have no animation mode to check other functionalities?" `OFFICE_REDUCED_MOTION=1` starts the office check's Electron with `--force-prefers-reduced-motion`, the app's own reduced-motion mode: walks to the lobby are instant and the office does not animate. The plain `npm run check:office` (CI's 4 office shards) keeps motion on, so walking figures and animated states are still checked there. The theme matrix in CI and the local parallel runner use reduced motion (`CHECK_MOTION=1` turns it back on). Each run prints `check:office: motion on|reduced`. `test:` the same quarter of the quick matrix, one job: 79/79 checks in 83 s with motion, 58 s reduced.
- **FR-031** **One theme in full, the others proven equal.** FR-010 of spec 035 already says a theme may change colours, borders, textures and display fonts, never sizes. So:
  - the full office layout check runs in **Clean Office** only (CI's 4 office shards, motion on);
  - `scripts/check-theme-geometry.js` (`npm run check:geometry`, CI job **Theme geometry**, about a minute for all themes) loads every other theme and the user fixture at 1440x900 and 1280x800 with 15 and 12 agents, and again with a `+N more` chip expanded, then checks two things:
    1. **Geometry:** the display text is neutralised for the measurement (one font family, weight, style, case, letter spacing and font variant). Then the box of **every** element of the office, the lobby and the top bar (SVG art excluded) and the font size of every text element must equal Clean Office's within 0.5px. Place names are the theme's own words, so their width and the seats beside them may differ; their top and height may not.
    2. **Real fonts:** the office check's own rules (overlap, clipping, room headers, text at least 10.5px) on the same layouts in the theme's own fonts, where a wider display font or a longer place name could push something out.
  - The pointer is moved off the window before measuring, since Retro nudges a hovered card by 1px.
  - The required **Office layout check (xvfb)** waits for this job.
  - **On demand:** the full office check in every theme runs from `gh workflow run ci.yml --ref <branch> -f full_themes=true` (12 parallel jobs, reduced motion), or locally with `npm run check:themes`.
  - `test:`
    - all themes pass, 60/60 checks in 66 s locally;
    - three violations injected into the built CSS are all caught: 2px padding on Retro cards (180 differences), a 14px name in the Indian court (45) and a wider room-header gap in the Japanese court (62);
    - before display text was neutralised, every theme "failed" on room-name and brand widths, which is how the rule for display fonts was found and written down here.
- **Rule** (`AGENTS.md`, *Before you finish*): make checks fast by building once and running in parallel, never by dropping checks. On your own machine keep the default limits; long matrices belong in CI.

*Measured* (Linux, 4 cores, 15 GB), for FR-028 and FR-030: `OFFICE_QUICK=1 node scripts/check-parallel.js` with 2 jobs passed 242 checks in 150 s; available memory never fell below 10 GB; the 1-minute load peaked at 5.4. The CI timings are in the PR.

### 2026-10-19: the redact ReDoS test without child processes (issue #303)

*Found:* on PR #302, macOS CI failed `test:runtime` with "adversarial urlLong: child hung twice (ETIMEDOUT)". `redact()` itself takes about 38 ms on that input. What hung was the child process fed 1 MB on stdin, twice for 30 s, on a 3-core runner that runs 3 suites at once.

- **FR-032** `scripts/test-redact.ts` section 9 runs each adversarial case in a **worker thread**: no process start, no stdin pipe. The worker times `redact()` and writes the result to shared memory, and the test waits with `Atomics.wait` (still synchronous), keeping the 30 s hang guard and one retry. The 1 s limit, the real ReDoS check, is unchanged. `test:` the whole file runs in 1.2 s locally. Stand-in modules confirm the guard: a 1.5 s function is measured at 1,499 ms and fails the limit; an endless loop times out; a throw is reported.

### 2026-10-20: the packaged app refuses debuggers and run-as-node (Electron fuses, issue #355)

*Found* (real Mac, alpha.9, #9): the packaged app accepts `--inspect` and `--remote-debugging-port`, so any process running as the user can attach a debugger to the main process or the renderer. That process could already read the user's files, but the app also holds agent sessions and permission grants, so release builds should not offer this. No fuses are set (no `electronFuses`, no `@electron/fuses` call).

Decided by the coordinator under Ruben's delegation (D1-D4):

- **FR-037 Fuses on every packaged build** (D1). Set in `package.json` `build.electronFuses`; electron-builder 26 flips them on the packed binary before signing, so later code signing (spec 014) signs the flipped binary. Dev runs (`npm start`, the simulator, `DURBAR_DEV`) use the unflipped Electron from `node_modules` and are unchanged.
  - `runAsNode`: off (`ELECTRON_RUN_AS_NODE` is ignored). Nothing in `src/` runs the app as plain Node; the planned Durbar MCP bridge (spec 041, Q2 (a)) uses the app with a flag, not run-as-node.
  - `enableNodeOptionsEnvironmentVariable`: off (`NODE_OPTIONS` is ignored).
  - `enableNodeCliInspectArguments`: off (`--inspect`, `--inspect-brk` and similar are ignored).
  - `onlyLoadAppFromAsar`: on (the app is already packed with `asar: true`; the unpacked Copilot runtime and `koffi` are native files loaded by path, not app code).
  - `enableEmbeddedAsarIntegrityValidation`: on. Electron validates it on macOS and Windows only; on Linux the fuse is set but has no effect (`[KNOWN GAP]`, Electron limitation).
  - Not changed: cookie encryption and file-protocol privileges (the window is loaded with `loadFile`), to keep this change to what the issue asks.
- **FR-038 No remote debugging in a packaged build** (D2). No fuse covers `--remote-debugging-port` or `--remote-debugging-pipe`. A packaged build that is started with either switch must not expose a DevTools endpoint: the app quits with a short message on stderr before it opens any window, or the switch is removed before Chromium uses it. Which one works must be shown on a packaged Linux build (the endpoint `http://127.0.0.1:<port>/json/version` does not answer). Dev runs are not touched (the layout checks drive dev Electron in-process through `DURBAR_DRIVER`, not over remote debugging).
  - *Result* (2026-10-20, `real:` packed Linux build): `app.commandLine.removeSwitch` before ready is enough; no early quit is needed. Without it the packed app answered `/json/version` and printed "DevTools listening"; with it, nothing answered and the window opened. **The switches are removed every time the app is packaged, without reading argv** (decided after the review): Chromium also accepts a single `-` on POSIX (and `/` and any case on Windows), and `-remote-debugging-port=<P>` got past a first version that matched only `--`. Chromium stores switches without their prefix, so removing them by name blocks every spelling. Checked on Linux: `--`, `-`, upper case, `=0`, the switch twice, with `--remote-debugging-address`, and `--remote-debugging-pipe` (a control without the guard shows the probe sees the endpoint). Windows spellings (`/`, case) are not tried (`[KNOWN GAP]`, #9).
- **FR-039 Checked on every package build** (D3). `scripts/check-fuses.js` reads the fuse wire of the packed binary (`@electron/fuses`, already a dependency of electron-builder) and fails unless every FR-037 value is as listed. `npm run pack:dir` runs it after electron-builder, so CI's *Package smoke* job checks Linux on every code PR without a workflow change. A launch probe (`npm run check:fuses-launch`, under `xvfb-run` on Linux) starts the packed app in 7 cases (`--inspect=<free port>` and `--inspect-brk=<free port>` with a connect attempt; `--remote-debugging-port` with two dashes, one dash and upper case; `--remote-debugging-pipe`; `ELECTRON_RUN_AS_NODE=1` with `NODE_OPTIONS=--inspect`), and checks that no inspector or DevTools endpoint answers and that the window still opens. The upper-case case proves nothing on Linux (Chromium switch names are case-sensitive there) and is kept for Windows (so `onlyLoadAppFromAsar` did not break loading). It is run by hand, not in CI, so the `main.ts` wiring is also pinned by a static check in the unit test, and `check-fuses.js` has a self-test in `npm test` (it must fail on the unflipped `node_modules` Electron).
- *Layout check:* `npm run check:office` failed intermittently here, a different case each run, with "a walking figure is not on a slot". The same flake shows on clean `main` (2ce02ad: 353/356), so it is not caused by this change; this branch passed 356/356 in the review run.
- **D4 Platforms.** Linux is checked here (real: packed and probed on this machine). macOS and Windows: the same config applies, and the hand check belongs to #9 (`[KNOWN GAP]` until then).
- **D5 The fuse wire is checked on all three OSes** (after Paco's review of #423). `check-fuses.js` finds the packed binary for the platform it runs on (`release/linux-unpacked/agent-durbar`, `release/win-unpacked/<productName>.exe`, every `release/mac*/<productName>.app/Contents/MacOS/<productName>`), and every package script runs it: `pack:dir` (CI's *Package smoke* on Linux for every code PR, and the *Packaged check* workflow on macOS, Windows and Linux on `main`) and the `dist:*` release scripts (the release workflow on each OS). No workflow file changes. ASAR integrity: Electron enforces `EnableEmbeddedAsarIntegrityValidation` on macOS and Windows only, so on Linux the app relies on `OnlyLoadAppFromAsar` alone (see FR-037).

### 2026-10-21: known gaps revalidated

- **FR-015** closed. `.github/workflows/packaged-check.yml` packages the app (`--dir`) on ubuntu, macOS and Windows runners and runs the ESM check inside each packaged main process. It runs on `main` (green, latest run 39497504364).
- **FR-010** narrowed. What CI now runs on macOS and Windows runners:
  - the packaged check above;
  - the UI checks (#389, in review): theme geometry, the 15-agent office layout at both sizes and the Mac title bar pass on macOS; on Windows all 18 simulator drivers pass too (run 39492231461);
  - real installs of the three agent apps as a standard user and as admin (#393);
  - the real-account e2e, 9/9 (#402, run 39496442403).

  **Still open:** a person installing and using the packaged app on their own Mac or Windows PC (issues #9, #10).
- Still open, unchanged: FR-009 signing (needs a purchase), FR-011 (arm64, `.deb`), FR-012 (no build attestation), FR-014 (the Spec Kit gate checks presence only), FR-016 (no `.github/dependabot.yml`). The About panel and installer metadata on macOS and Windows are tracked in #384.

### 2026-10-20: app name and profile folder (#353)

*Status:* built 2026-10-20 (T037): unit tests and the Linux simulator; macOS and Windows not run. D1-D3 decided by the coordinator under Ruben's delegation.

*Found* (issue #353, @fjcabello on a real Mac; the rest checked by reading the code and on Linux): the Mac app menu says "About agent-durbar", "Hide agent-durbar", "Quit agent-durbar". `productName` exists only under `build` (`package.json:141`), which electron-builder reads, but Electron does not: at run time the app name is `name` = `agent-durbar` (`package.json:2`). The user-data folder is named after that run-time name, so **a packaged app and `npm start` share one profile** (folders, settings, MCP extras with their secrets, activity, schedules, usage, themes, window state). `DURBAR_USER_DATA` (spec 010 FR-004, `src/main/main.ts:73`) is the only way out today.

*Measured* (Linux, Electron 44.8, a throw-away probe app with `XDG_CONFIG_HOME` in a temp folder, no Durbar data touched): `build.productName` only: name and folder = `name`. Top-level `productName`: name **and** folder become the product name (`~/.config/Probe Product`). `app.setName()` at the top of the main script: the name changes, the folder does **not** move (it stays on `name`). macOS and Windows not run.

*Today, by platform* (`read:` Electron docs; Linux measured as above): name `agent-durbar` packaged and dev; folder `~/Library/Application Support/agent-durbar` (macOS), `%APPDATA%\agent-durbar` (Windows), `$XDG_CONFIG_HOME/agent-durbar` or `~/.config/agent-durbar` (Linux), the same for dev and packaged. The About panel already says "Agent Durbar" (`src/shared/about.ts:49`), the window title too (`src/renderer/index.html:7`). There is no `requestSingleInstanceLock`, no `setAppUserModelId`, no `setAsDefaultProtocolClient` and no `getPath('logs')` in `src/`, so a dev run and the installed app can run at once on the same folder today: last writer wins in the JSON stores, and Chromium's own storage (`Local Storage`, used by the renderer) is locked by the first process (`read:`).

*Secrets* (`read:` Electron source `shell/browser/electron_browser_main_parts.cc`, `main` branch, not the 44.8 tag): on macOS the safeStorage key is a Keychain item named `<app name> Safe Storage`, account `<app name>`, set while the main script starts, before `ready`. **Changing the name makes a new key**, so the MCP secrets already saved in `durbar-mcp.json` (`src/main/mcpipc.ts:21`) no longer decrypt, whichever folder is used. `McpStore` then keeps the key name and drops the value (`src/main/mcpstore.ts:87-95`): the server shows the secret as missing and the user enters it again; nothing crashes. On Windows the key is DPAPI-protected in the folder's `Local State` file, so keeping the folder keeps the secrets (`read:`). On Linux (libsecret/kwallet) whether the key is tied to the name is **not known** (`[KNOWN GAP]`).

- **FR-033** `[IMPLEMENTED]` test: `scripts/test-profiledir.ts`, `scripts/test-macos.ts`. The **display** name is **Agent Durbar** on every platform: explicit labels in the Mac app menu (`About Agent Durbar`, `Hide Agent Durbar`, `Quit Agent Durbar`, `MENU_APP_NAME` in `src/main/appmenu.ts`) and the About panel (`aboutPanelOptions().applicationName`). `MENU_APP_NAME` (the only display-name constant; display only, never passed to `app.setName`) equals `build.productName` and the About panel's name (tested). There is **no `app.setName` call**: the run-time identity `app.getName()` stays `agent-durbar` on purpose (Keychain item `agent-durbar Safe Storage`, libsecret, the Linux WM_CLASS; D2). `package.json` `name` stays `agent-durbar` (npm, `desktopName`, FR-026); no top-level `productName` (it would move the folder, see *Measured*).
- **FR-034** `[IMPLEMENTED]` test: `scripts/test-profiledir.ts`; sim: `xvfb-run` with `DURBAR_SIM=15` and a temp `XDG_CONFIG_HOME` wrote to `<temp>/agent-durbar-dev`, and to `DURBAR_USER_DATA` when set (2026-10-20). The folder is set with `app.setPath('userData', profileDir(...))` at the top of `src/main/main.ts`, before the first `getPath('userData')` (today `UserThemeStore` reads it at top level) and before `app.whenReady`. The profile folder is chosen in code, never from the name: a pure `profileDir({ packaged, platform, appData, env })` (no Electron import) returns, in this order:
  1. `DURBAR_USER_DATA` when the dev hooks are on (`devEnv`, spec 010 FR-017: always in dev, in a packaged build only with `DURBAR_DEV=1`), unchanged;
  2. packaged: `<appData>/agent-durbar`, **the folder installed users already have** (no move, no copy, no migration);
  3. not packaged (`npm start`, the simulator): `<appData>/agent-durbar-dev`, so a dev run never reads or writes the installed app's data.
  `main.ts` calls `app.setPath('userData', profileDir(...))` right after FR-033 and before anything reads `userData`. Paths are joined with `path.win32` or `path.posix` by platform; `appData` is `app.getPath('appData')`.
- **FR-035** `[IMPLEMENTED]` (no `--profile` code, as specified). Spec 049 (profiles, still a draft) builds on FR-034: `--profile <id>` nests under the folder `profileDir` returns (049 FR-001 `profiles/<id>/`), and `DURBAR_USER_DATA` still wins over both. No `--profile` code in this change.
- **FR-036** `[IMPLEMENTED]` read: README, CONTRIBUTING, spec 010 FR-004, CHANGELOG. Docs: README (*Install* or *Known limits*: where the data lives on each OS, that `npm start` uses its own `agent-durbar-dev` folder; saved MCP secrets are unaffected, because the run-time name does not change, D2), CONTRIBUTING (*Development*), spec 010 FR-004 (a cross-reference), CHANGELOG.

*Decisions* (by the coordinator under Ruben's delegation; open until marked):
- **D1** *(decided by the coordinator under Ruben's delegation)* Option i: keep the installed folder `agent-durbar` (option i), rather than letting it move to `Agent Durbar` with a copy on first start (option ii). Why: no copy code, no half-copied folder, no two folders to explain, Windows secrets and Chromium state stay put, and the run-time name stays `agent-durbar` (D2), so the Keychain item and saved MCP secrets are untouched as well. Option ii would copy about 10 small files plus Chromium's folders and must never delete; it buys only a nicer folder name.
- **D2** *(rewritten; decided by the coordinator under Ruben's delegation, after Paco's real-Mac check on #377)* **No `app.setName` at all.** With `setName` running before `new McpStore(..., safeStorageCodec)`, Electron 44 may create a new Keychain item `Agent Durbar Safe Storage` and every saved MCP secret would stop decrypting; nobody verified when Electron fixes that name (Paco's Keychain has `agent-durbar Safe Storage`). So the identity stays as today and only the display text changes, through explicit menu labels and the About panel. The secrets are unaffected because the name does not change.
- **D3** *(decided by the coordinator under Ruben's delegation)* Existing dev data (for example Ruben's own `npm start` profile, which is today's `agent-durbar` folder): no automatic copy into `agent-durbar-dev` (a dev run must never read the installed folder). Who wants the old data runs once with `DURBAR_USER_DATA=<old folder>` or copies the folder by hand; the README says how.

*Out of scope* (follow-ups, not in T037): a single-instance lock; the Windows AppUserModelId for notifications in dev; the Durbar MCP socket and pipe names (`src/main/mcp/paths.ts`: `<XDG_RUNTIME_DIR>/agent-durbar`, `<tmp>/agent-durbar-<uid>`, `\\.\pipe\agent-durbar-mcp-<id>`), which are fixed and would collide between dev and installed once spec 041 wires them in (no caller in `src/` today).

- `real:` Paco's checks on a real Mac (macOS 26.7.1, M1 Pro; PR #377, dev run as `npm start`). On 08e90e8 (with `setName`): the dev folder and the menu. On 11a0fb7 (labels only, this version): the menu items read About / Hide / Quit Agent Durbar (the first menu's title still says `agent-durbar` in a dev run, from the app name; a packaged build's bundle name from `productName` was not checked by eye); `userData` is `~/Library/Application Support/agent-durbar-dev` and `lsof` shows 0 files under `agent-durbar`; the Keychain has `agent-durbar Safe Storage` before and after, and `Agent Durbar Safe Storage` never appears, even after one `safeStorage` encrypt/decrypt round trip. `[KNOWN GAP]` A packaged build on a Mac (folder `agent-durbar`, bundle name) was not run. Not run on Windows: the folder chosen there and the DPAPI `Local State` claim are `read:` only.
- Keychain: the saved MCP secrets are unaffected, because the app name (the safeStorage identity) does not change (D2); `real:` on a Mac, see above. `[KNOWN GAP]` Linux keyring (libsecret/kwallet): unchanged by the same reason, not run here (no desktop keyring on this server).
- `[KNOWN GAP]` The *Measured* probe was a plain Electron app in dev mode, not a packaged Durbar build; that a packaged build reads `name` from `app.asar/package.json` the same way is `read:`.

### 2026-10-21: the installed app on macOS, Windows and Linux (T021), and a stale gap closed (T025)

- **FR-015** `[IMPLEMENTED]`. The stale `[KNOWN GAP]` is closed: `.github/workflows/packaged-check.yml` (spec 012 T044) packages the app on macOS, Windows and Linux runners and runs the packaged main process (`scripts/pack-esm-ci.js`). `real:` it passed on all three, for example run 39497504364 (2026-10-20). So macOS and Windows packaging is no longer first exercised by the tag workflow.
- **FR-010 delta** `[IMPLEMENTED]`, `.github/workflows/installed-app.yml` + `scripts/installed-app-ci.js` + `scripts/installed-app-check.js`. On each OS it builds the real release package (`dist:win`, `dist:mac:arm64`, `dist:linux`; unsigned, nothing published) and installs it the way a user does:
  - **Windows:** the NSIS installer `/S`, per user. The installed exe and the Start menu entry are recorded, then the uninstaller runs `/S`.
  - **macOS:** the `.dmg` is mounted, `Agent Durbar.app` is copied to `~/Applications`, and the `Info.plist` names are recorded.
  - **Linux:** the AppImage, with its `.desktop` `Name=` and `StartupWMClass`.

  Then it starts the **installed** app on the simulator (`DURBAR_DEV=1`, no account, no credits). It checks that the office renders the 15 agents and records the app's name and window title, with a screenshot artifact. It runs on demand, on `main` when packaging changes, and on a PR that changes the check. `real:` see the PR's first run.

  `real:` run 39498528735 (2026-10-21), **passed on all three**:
  - **Windows:** `Agent-Durbar-Setup-0.1.0-alpha.9.exe /S` installed to `%LOCALAPPDATA%\Programs\Agent Durbar`, with the Start menu entry `Agent Durbar.lnk`; the uninstaller `/S` exited 0.
  - **macOS (arm64):** the `.dmg` installed to `~/Applications`, with `CFBundleName` and `CFBundleDisplayName` both `Agent Durbar` and `CFBundleIdentifier` `io.github.three-feathers.agentdurbar`.
  - **Linux:** the AppImage, with `.desktop` `Name=Agent Durbar` and `StartupWMClass=agent-durbar`.
  - On each OS the installed app rendered the office with 15 agents, window title "(5) Agent Durbar". Its run-time name is `agent-durbar` on purpose (D2).
- Not covered, still `[KNOWN GAP]`: a person's own Mac or PC (Gatekeeper and SmartScreen on a downloaded, unsigned build: the runner's copy is not quarantined), and code signing (spec 014, needs a purchase).

### 2026-10-20: the UI checks run on macOS, Windows and Linux in GitHub Actions (owner)

The owner asked for full tests on macOS and Windows (and Linux) directly in GitHub Actions. Until now the unit tests ran on all three, but every check of the real Electron UI (office layout, theme geometry and the simulator drivers) ran on Linux only, under xvfb; the Mac title bar check forced `data-platform="darwin"` on Linux.

- **FR-090** A failing driver makes Electron exit with code 1 (dev hooks only, `DURBAR_DRIVER`); before, it printed "DRIVER FAILED" and exited 0, so only a log grep caught it.
- **FR-091** `scripts/ui-suite.js` runs every assertion-bearing simulator driver one after another on any OS: it starts the Electron binary (`require('electron')`) with an argument array and no shell, under `xvfb-run` only on Linux without a display; each driver gets a fresh `DURBAR_USER_DATA`, its own settings (for example `DURBAR_SIM_FLOORS=1` for floors) and one output folder for every screenshot variable; a driver fails on a non-zero exit, a "DRIVER FAILED" line or a timeout. It prints one line per driver and a summary, and exits 1 when any failed. `--only a,b` runs a subset; `--list` prints the drivers.
- **FR-092** Workflow `ui-platforms.yml`: on `ubuntu-latest`, `macos-latest` and `windows-latest`, it builds, runs `check:geometry`, `check:office` (the 15-agent layout at 1440x900 and 1280x800 with that OS's fonts), the Mac title bar check, and `ui-suite.js`, and uploads the screenshots as an artifact per OS (kept 14 days) so the real Mac and Windows rendering can be looked at. It runs on pull requests, on pushes to `main`, nightly and by hand; it is not a required check until it has been green for a while (making it required is a repo setting: the owner's call). No real agent session and no account: simulator only (constitution IV).
- `[KNOWN GAP]` What the GitHub runners show is not a user's machine: no Retina scaling on the macOS runner, Windows Server fonts, no real traffic lights in a frameless window under a CI session. A green run says the layout and the flows hold with those fonts and that renderer, not that a person has looked at it.
- **FR-093** A driver or screenshot run (`DURBAR_DRIVER`, `DURBAR_SHOT`) opens its window with `enableLargerThanScreen` (macOS only; ignored elsewhere), so the checks get the exact size they ask for. `real:` the first run of the workflow (PR #389): every macOS screenshot was 677 px tall whatever size was asked (the runner's screen is short and macOS clamps a window to it), so `check:office` failed 5 "solo" cases with the floor overflowing by about 23 px. That was the CI screen, not the app. Windows and Linux passed everything on that first run.
- `real:` the same run, `shots-052-ux` on macOS: the driver pressed Ctrl+Shift+A, but on a Mac the shortcut is Cmd+Shift+A (spec 052 FR-084), as the app does. The driver now presses Cmd on darwin.
- `real:` second run (PR #389): with `enableLargerThanScreen`, macOS passes theme geometry and the office layout. One more driver pressed Ctrl where the app wants Cmd on a Mac: `shots-052-ux` (Ctrl+K, palette) and `check-mac-titlebar` (Ctrl+K). All of them now use Cmd on darwin; Ctrl+` stays Control everywhere (spec 052 FR-091).
- **FR-094** `ui-suite.js` runs drivers in parallel (`UI_SUITE_JOBS`, default 2, at most 6); each has its own profile and, on Linux, its own `xvfb-run -a` display. `real:` 2026-10-20 on Linux: 18/18 pass in 222 s at 3 at a time, against about 560 s one after another. CI: 3 on Linux and Windows, 2 on macOS. Next (owner question, 2026-10-20): replace the drivers' fixed sleeps (about 150 s per pass) with conditions and run them with reduced motion.
- **FR-095** `UI_SUITE_RETRY=1` reruns each failed driver once, alone, after the others. A pass then is reported as **FLAKY** in the log, the final line and the GitHub job summary; it is never counted as a clean pass silently. CI uses it on macOS only, with one driver at a time (`real:` macOS runners, 2026-10-20: different drivers lost races against fixed delays on each run, while Linux and Windows passed). The lasting fix is that drivers wait for what they need instead of sleeping (spec 008 follow-up).
- **FR-096** `[IMPLEMENTED]` The 18 drivers in `ui-suite.js` wait for what they need instead of sleeping a fixed time. The shared `scripts/driver-helpers.js` provides `until(expr)`, `settle()`, `office(n)` and `chatOf(name)`; `ctx.waitFor` now polls every 50 ms instead of 300. `until` never throws: on a timeout it logs `[waits] timed out …` and the driver's own assertion reports the failure, so no check was weakened or removed. Fixed sleeps remain only where a check is that **nothing** happens (a disabled item, no announcement), as 150 ms settles before a screenshot, and in existing polling loops. Race-prone checks were made exact:
  - the delete busy state in `shots-006-prevmarks` is recorded by a MutationObserver from before the click;
  - the SC-003 floor-switch time budget in `shots-033` is measured in a quiet office (no figure walking), as the best of up to three tries, with the 500 ms budget unchanged.
- `test:` Linux, this machine, before → after:
  - 3 at a time: 18/18 in **223 s** → 18/18 in **138 s**, no wait timed out;
  - 6 at a time (overloaded): 17/18 in 138 s → 17/18 in **109 s**. The one failure is in both runs: `shots-033`'s 500 ms budget (SC-003) cannot be met with six Electron apps on this machine (845 ms before, 856 ms best of three after). That is a performance limit under overload, not a driver race; CI runs at most 3 at a time.

  `[KNOWN GAP]` macOS is checked only through CI.

### 2026-10-21: packaged display names on Windows, Linux and macOS (#384)

*Status:* decided by the coordinator under Ruben's delegation (D1-D3 below); Linux checked on a real local build, Windows by reading electron-builder 26.15.3 / Electron 44.8.0 and a `--win --dir` cross-build, macOS by reading and CI run 39498528735. Built: see T039.

*Found* (follow-up of #353 point 3, left open by #377). The run-time identity is still `agent-durbar` on every OS, on purpose (D2 of #353): `app.getName()`, the Keychain item, libsecret and WM_CLASS. The packed `app.asar/package.json` has `name: agent-durbar` and `desktopName: agent-durbar.desktop` but no `productName`, so Electron's `init.ts` sets `app.name` from `name`. `real:` on the packed Linux app, `app.getName()` returned `agent-durbar`. This closes the #353 `[KNOWN GAP]` "a packaged build reads `name` from `app.asar/package.json` the same way" for Linux. The display names come from `build.productName` = `Agent Durbar` (`package.json:155`):

- **Linux** (`real:` `npm run dist:linux` on 911118d, then the AppImage extracted with `--appimage-extract`, plus the packed app started under `xvfb-run -a` with the simulator, a temp HOME and `DURBAR_USER_DATA`):
  - the file is `Agent-Durbar-0.1.0-alpha.9-x86_64.AppImage`;
  - the embedded `agent-durbar.desktop` has `Name=Agent Durbar`, `Exec=AppRun --no-sandbox %U`, `Icon=agent-durbar` and `StartupWMClass=agent-durbar`;
  - the main window's WM_CLASS is `("agent-durbar", "agent-durbar")` and `CHROME_DESKTOP` is `agent-durbar.desktop`.

  `syncDesktopName: true` only renames the desktop *file* to `desktopName` (default would be the executable name, also `agent-durbar`). `StartupWMClass` comes from `desktopName` whether `syncDesktopName` is on or off, and `Name=` always comes from `productName`. (read: `app-builder-lib/out/targets/LinuxTargetHelper.js:203-219,250-275`; `AppImageTarget.js:23-31,59`; Electron `lib/browser/init.ts` ~127-136 `app.setDesktopName(packageJson.desktopName ...)`; `shell/browser/native_window_views.cc` ~291-304 `wm_class_name = ToLower(GetXdgAppId() or name)`; `shell/common/platform_util_linux.cc` ~518-529.)
- **Windows** (read: `app-builder-lib/out/targets/nsis/NsisTarget.js:160-166,461,473`, `out/options/CommonWindowsInstallerConfiguration.js:28`, `templates/nsis/common.nsh:14-17,93,104-106`, `templates/nsis/include/installer.nsh:106,119,133,197-200,217-240`, `out/winPackager.js:139-148,235`):
  - the Start menu and desktop shortcuts are `Agent Durbar.lnk`. `shortcutName` defaults to the sanitized `productName`, there is no menu folder, and the desktop shortcut is made on a fresh install. The Start menu entry is `real:` in run 39498528735.
  - The Add/Remove Programs DisplayName is `Agent Durbar 0.1.0-alpha.9` (`uninstallDisplayName` defaults to `${productName} ${version}`), and the Publisher is `Three Feathers`. The key is `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\1a945027-3b42-502e-829b-879c9ab6622e`, which is UUID v5 of `appId`.
  - The installer is titled `Agent Durbar` (NSIS `Name`). The uninstaller is `Uninstall Agent Durbar.exe`.
  - The exe is `Agent Durbar.exe`. `real:` on a `--win --dir` cross-build on Linux, read with `resedit`: `ProductName`, `FileDescription` and `InternalName` are `Agent Durbar`, and `CompanyName` is `Three Feathers`.
  - The shortcuts get AppUserModelId `io.github.three-feathers.agentdurbar` (`WinShell::SetLnkAUMI ... ${APP_ID}`). The uninstaller removes that AUMID (`uninstaller.nsh:191`).
  - The portable exe is `Agent-Durbar-0.1.0-alpha.9-portable.exe`. It makes no shortcut and sets no AUMID: it unpacks to `%TEMP%\<random>` and runs `Agent Durbar.exe` (`templates/nsis/portable.nsi:33-39,86`).
- **Windows AUMID at run time.** Before T039, `src/` never called `app.setAppUserModelId` (grep). Electron sets no AUMID at start. The first call that needs one sets the explicit AUMID `electron.app.agent-durbar` for the process (read: `shell/common/application_info_win.cc` ~24 `kAppUserModelIDFormat = L"electron.app.$1"`, ~53-68 `GetRawAppUserModelID` with the app name). One such call is the first toast (`shell/browser/notifications/win/windows_toast_notification.cc` ~215); others are a jump list and a recent document. Durbar does show OS notifications: `new Notification(...)` at `src/renderer/app.js:1522` (spec 052 "Needs you"). So on an installed build:
  - the toast goes out under an AUMID that no Start menu shortcut has. Windows may drop it or show it without the app's name and icon.
  - From that moment the taskbar button may stop grouping with the pinned `Agent Durbar.lnk` (AUMID `io.github...`).
  - `[KNOWN GAP]` not seen on a real PC (#9).
- **macOS** (read: `app-builder-lib/out/macPackager.js:359,366-367`; `real:` run 39498528735):
  - `CFBundleName` and `CFBundleDisplayName` are both `Agent Durbar`, `CFBundleExecutable` is `Agent Durbar`, and `CFBundleIdentifier` is `io.github.three-feathers.agentdurbar`.
  - The menu-bar title is still open. Before T039, Durbar's app menu was `{ role: 'appMenu' }` with no label (`src/main/appmenu.ts:26`). Electron fills it with `app.name` = `agent-durbar`. Paco's dev run showed `agent-durbar` there (#377). Whether macOS shows the bundle name or that label in a packaged build was not seen by eye.

*Requirements:*

- **FR-040 Linux display name** `[IMPLEMENTED]` `real:` (above). Fields of the AppImage's desktop entry:
  - `Name=` = `build.productName`;
  - `StartupWMClass=` and the desktop file name = `desktopName` without `.desktop` (`agent-durbar`);
  - `Icon=agent-durbar`.

  The window's WM_CLASS stays `agent-durbar`. The AppImage file name is `Agent-Durbar-<version>-x86_64.AppImage`. The launcher name comes from `Name=` when the AppImage is integrated (AppImageLauncher, Gear Lever, appimaged). `[KNOWN GAP]` The dock or launcher label on a real Linux desktop (GNOME, KDE) was not seen, because this server has no desktop.
- **FR-041 No forced `--no-sandbox` in the desktop entry** (D2) `[IMPLEMENTED]` `real:` (`dist:linux`: the embedded desktop entry has `Exec=AppRun %U`; the built AppRun adds `--no-sandbox` itself when `unshare -Ur true` fails) `test:` `scripts/test-checknames.ts`. The AppImage desktop entry has `Exec=AppRun %U`, not `Exec=AppRun --no-sandbox %U`. Set `build.appImage.executableArgs: []`; electron-builder only adds `--no-sandbox` when that option is unset (`targets/appimage/AppImageTarget.js:26-27`). `AppRun` still adds `--no-sandbox` by itself when `unshare -Ur true` fails (`AppRun` lines 38-58 in the built image). So a launcher that copies `Exec` would no longer turn off Chromium's sandbox on systems where it works. Constitution III: sandbox on. README *Install from releases* (`README.md:148`) then says that AppRun adds the switch by itself when needed.
- **FR-042 Windows display names** `read:` + `real:` (above; and CI *Installed app* run 39561893292 on windows-latest: Start menu and desktop `Agent Durbar.lnk`, DisplayName `Agent Durbar 0.1.0-alpha.10`, shortcut AUMID `io.github.three-feathers.agentdurbar`, exe version resource ok). The names are:
  - Start menu and desktop shortcuts: `Agent Durbar.lnk`;
  - Add/Remove Programs DisplayName: `Agent Durbar <version>`, Publisher `Three Feathers`;
  - installed exe: `Agent Durbar.exe`, with `ProductName` and `FileDescription` = `Agent Durbar`;
  - shortcut AUMID: `build.appId`.

  The installed-app check asserts the Start menu name, the DisplayName and the shortcut AUMID (FR-045). `[KNOWN GAP]` The taskbar label, the jump list, and the name in Settings > Apps on a person's own PC were not seen (#9).
- **FR-043 Windows AppUserModelId at run time** (D1) `[IMPLEMENTED]` `test:` `scripts/test-checknames.ts` (decision `aumidToSet` in `src/main/aumid.ts`, value equals `build.appId`, the static order check in `main.ts`); not run on Windows. On `win32`, `main.ts` calls `app.setAppUserModelId('io.github.three-feathers.agentdurbar')` at top level, before `app.whenReady` and before any window. The value equals `build.appId` (a unit test reads `package.json`). This applies to the packaged build, NSIS and portable alike. Then toasts and the taskbar button use the same AUMID as the Start menu shortcut. Dev runs (`!app.isPackaged`) do not call it, (D1), so a dev run never groups with or posts toasts as the installed app (same reason as FR-034). The portable build has no shortcut, so its toasts may still not show. With this change the portable build uses `io.github.three-feathers.agentdurbar` instead of `electron.app.agent-durbar`; neither has a shortcut carrying it, so it should be no worse off, but that is not seen on a real PC. `[KNOWN GAP]` until a real PC shows toast and taskbar behaviour for NSIS, portable and dev (#9).
- **FR-044 macOS bundle and menu title** `real:` (bundle keys, run 39498528735) + D3 `[IMPLEMENTED]` `test:` `scripts/test-macos.ts` (the label). The app menu item carries `label: MENU_APP_NAME` next to `role: 'appMenu'`, as a harmless hint: `read:` Electron's docs (`docs/api/menu.md`, *Main Menu's Name*) say that on macOS the application menu's first label is always the app's name whatever label is set, and is changed through the bundle's `Info.plist`. So the packaged menu-bar title rests on `CFBundleName` = `Agent Durbar`, which `check-names.js` and the *Installed app* CI assert on every Mac build (`real:` run 39561893292). Display only; `app.setName` is still never called. `scripts/test-macos.ts` checks the label. `[KNOWN GAP]` The packaged menu-bar title by eye on a real Mac, and the dev-run title (most likely still `agent-durbar`, as in #377, since a dev run has no bundle `Info.plist` of its own), are for Paco's Mac.
- **FR-045 Names checked on every package build.** `[IMPLEMENTED]` `real:` Linux (`pack:dir`, `dist:linux`, `installed-app-ci.js` on the real AppImage under xvfb); macOS and Windows asserts run in CI: `real:` *Installed app* run 39561893292 passed on all three OSes with empty `nameFailures` (check-names on the Windows exe version resource and the `mac-arm64` `Info.plist`). `scripts/check-names.js` runs after `check-fuses.js` in `pack:dir` and every `dist:*` script (`package.json:48-55`), with no workflow change. CI's *Package smoke* (Linux) runs it on every code PR, and *Packaged check* runs it on macOS, Windows and Linux on `main`. It takes the expected values from `package.json` (`build.productName`, `build.appId`, `name`, `desktopName`) and fails on any difference:
  - all OSes: the packed `app.asar/package.json` has `name` = `agent-durbar` and no `productName`. A top-level `productName` would move the profile folder and the Keychain name (#353 *Measured*). It is read with `@electron/asar`, a dependency of electron-builder (as with `@electron/fuses` in FR-039).
  - Linux: `release/linux-unpacked/<name>` exists. When `release/*.AppImage` exists (`dist:linux`), it extracts `*.desktop` into a temp folder (`--appimage-extract`, fixed arguments, no shell) and checks the FR-040 fields plus FR-041.
  - Windows: `release/win-unpacked/<productName>.exe` exists, and its version resource has `ProductName` and `FileDescription` = `productName`. It is read with `resedit`, a dependency of electron-builder.
  - macOS: for every `release/mac*/<productName>.app/Contents/Info.plist`, `CFBundleName` and `CFBundleDisplayName` = `productName`, `CFBundleExecutable` = `productName`, and `CFBundleIdentifier` = `appId`. It is read with `plist`, a dependency of electron-builder.
  - The pure comparison functions get a self-test in `npm test`. Changing `productName`, adding a top-level `productName` or changing `desktopName` in the test's copy of the config must fail.

  The NSIS names are not in the `--dir` output, so `scripts/installed-app-ci.js` asserts what it records today on Windows and adds the rest:
  - `Agent Durbar.lnk` in the Start menu and on the desktop;
  - the uninstall key's `DisplayName` (`reg query`, fixed arguments);
  - the shortcut's `System.AppUserModel.ID` = `appId` (PowerShell with a fixed script, no user text);
  - on macOS and Linux, the `CFBundle*` and `.desktop` fields.

  A PR that changes `scripts/installed-app-*.js` already triggers `installed-app.yml` on all three OSes, with no workflow edit.

*Decisions* (coordinator, under Ruben's delegation, 2026-10-21):
- **D1** AUMID in dev: (a) no call in dev runs, so a dev run never groups with or posts toasts as the installed app (same reason as FR-034); dev toasts may not show on Windows, accepted.
- **D2** FR-041 is done in this change: one config line, a safer default (Chromium's sandbox stays on where it works; AppRun still adds `--no-sandbox` itself when `unshare -Ur true` fails), and the team rule asks small solvable findings to be fixed in the same PR.
- **D3** FR-044 label added now as a harmless hint; per Electron's docs it is not what sets the macOS title (`CFBundleName` does), so the claim rests on the asserted bundle name; the packaged title by eye stays a `[KNOWN GAP]` for Paco's Mac.

*Not covered:* a person's own Windows PC (taskbar grouping, toasts, Settings > Apps, SmartScreen; #9); a Linux desktop launcher or dock; the Mac menu-bar title by eye; signed builds (spec 014).

### 2026-10-21: the simulator drivers share one helper module (issue #414)

Tech debt from the 2026-10-21 audit. Decided by the coordinator under Ruben's delegation.

*Found:* about 30 `scripts/shots-*.js` and `scripts/check-*.js` drivers each define the same small helpers (`js`, `shot`, `key`, `clickText`, load-and-wait). #401 added `scripts/driver-helpers.js` with the waits (FR-096) and 18 drivers use it; the rest still carry their own copies, which drift (different timeouts, different escaping of values spliced into page code).

- **FR-097** `[IMPLEMENTED]` (2026-10-21, T094) The helpers that drivers repeat live in `scripts/driver-helpers.js` and every driver uses them instead of its own copy. Every string value spliced into page code goes through `jsLiteral` (CodeQL `js/bad-code-sanitization`, already the rule); typed numbers, booleans and ready-made code strings may stay raw, from an allow-list in `scripts/test-ui-suite.ts`. The guard there checks one line at a time, so a splice on a continuation line of a multi-line template without a page marker on that line is not seen, nor is string concatenation (`"…'" + x + "'…"`) or a template without a page marker (`document`, `window`, `localStorage`, `getComputedStyle`, `querySelector`) (`[KNOWN GAP]`, heuristic). It also fails if a page driver brings back its own `loadFile`, toast-hiding style or `jsLiteral`. No driver's assertions change: each driver checks exactly what it checked before, with the same thresholds; only the plumbing moves. Where two copies differed (a timeout, a wait), the shared helper keeps the stricter or the condition-based one (FR-096), and the difference is noted in the PR.
- *Built:* `helpers(ctx)` in `scripts/driver-helpers.js` gives `js`, `click`, `clickText`, `exists`, `text`, `idOf`, `key`, `calm`, `clearToasts`, `load`, `shot` and the FR-096 waits; `jsLiteral` now lives there too (`check-office-overlap.js` re-exports it). All page drivers use it; `e2e-driver.js` (a real session) and `installed-app-check.js` (the packaged app) were left alone. Where copies differed the shared helper keeps the stricter or condition-based one: `js` names the code of a failing call; `idOf` requires a name element; `calm` hides toasts with one id-guarded style; fixed sleeps after a page load became `settle()` (a driver whose page is not frozen keeps its sleep); the second load in `shots-030-handover` now waits for the 15 desks; `shots-themes*` splice the theme through `jsLiteral`. `test-ui-suite.ts` checks the helpers on a fake page and fails if a driver brings back its own `loadFile`, toast style or `jsLiteral`. `[KNOWN GAP]` Fixed sleeps that are not part of loading (after a click, before a picture) were not touched; `shots-033`'s 500 ms switch-off timing assertion fails at random on a loaded host (it failed before this change too).
- **Done when** every migrated driver passes as before: `node scripts/ui-suite.js` (all drivers) after each batch, `npm run check:office`, `npm run check:geometry`, the Mac title bar check, and `npm run typecheck && npm run build && npm test`. A driver that is not in `ui-suite` (a screenshot-only `shots-*`) is run once by hand and its screenshots compared by size and a visual look. Drivers that only run on a real account (none should be touched) are listed and left alone.

### 2026-10-22: landing many pull requests: merge queue and shorter UI runs (owner, issue: none, T095)

Owner (Vikram, 2026-10-22): landing ~18 open PRs one by one was estimated at 10-12 hours ("how can we improve the efficiency of our CI?"). Owner decision the same night: a GitHub merge queue (repository setting, approved by him), cancel superseded runs, build once and cache, more and balanced shards; no self-hosted or paid runners. Rule kept: faster by parallelising and removing duplicate work, never by dropping a check (AGENTS.md *Fast checks, same quality*).

*Measured before the change* (`gh api`, the last 45 finished runs of each workflow, 2026-10-20 13:51 to 2026-10-21 22:27 UTC):

- **CI** (`ci.yml`, required): wall time median **6.4 min**, p90 25.8. Job run times are short (build and test 1.4-2.1 min, office shards 2.3-3.3 min, package smoke 0.5); the p90 is **queue wait** (macOS build and test: median 2.5, p90 23.4 min). `npm ci` takes 6-13 s and the build 5-7 s on every OS: the npm cache already hits, so more caching or a shared build artifact would save seconds, not minutes.
- **UI on three OSes** (`ui-platforms.yml`, not required, but `scripts/pr-gate.sh` waits for every check): wall median **16.9 min**, p90 32.5. macOS run 15.0 min (office layout 6.1, drivers 5.6 one at a time, Mac title bar 1.5, theme geometry 1.1), Linux 12.4 (office layout 8.8), Windows 9.7 (office layout 5.6). It is the critical path of every code PR.
- **Duplicate work:** the Linux UI job runs the full office layout (8.8 min) that `ci.yml`'s office shards already run on the same runner image with the same script and the same motion.
- **Reruns:** 2.7 CI runs per PR branch on average (up to 17); 6 of 300 CI runs were manual reruns.
- **Why PRs have to merge `main` again:** the ruleset does **not** require branches to be up to date (`strict_required_status_checks_policy: false`). The rebase loop comes from real conflicts: 9 of 21 open PRs were `CONFLICTING`, and 8 of those 9 only because `CHANGELOG.md`, `README.md` or `specs/README.md` changed on both sides. `.gitattributes` sets `CHANGELOG.md merge=union`, which local git honours but GitHub's merge button and merge queue do not (custom merge drivers are not run on GitHub).
- The organisation is on the Free plan (public repository): 20 concurrent jobs, 5 of them macOS. In a burst of PRs, macOS jobs wait for each other.

Requirements:

- **FR-098** **Merge queue ready.** `ci.yml` and `spec-kit.yml` also run on `merge_group`, so every required check reports on a queue entry (a required check that never reports would hang the queue). In `ci.yml` a `merge_group` run is treated like a push to `main`: *What changed* sets code and themes, and every job runs. The Spec Kit gate passes on `merge_group` with a note: the branch name, the spec folder and the PR description were checked on the pull request, and a queue entry has no PR description to read; the warning-only Docs check does not run there. A queue run is never cancelled by another (its ref is unique; `cancel-in-progress` stays for pull requests only).
- **FR-099** *(superseded 2026-10-22 by FR-105: one office job)* **Six office shards.** `ci.yml` runs the office layout in 6 shard jobs instead of 4 (every 6th unit each, same units in all). The required check *Office layout check (xvfb)* keeps its name and still passes only when all shards passed.
- **FR-100** *(superseded 2026-10-22 by FR-108: one job per OS, macOS nightly)* **UI checks split per OS.** `ui-platforms.yml` runs three jobs per OS instead of one:
  - *layout 1/2*: theme geometry and the first half of the office layout (`OFFICE_SHARDS=2`);
  - *layout 2/2*: the second half of the office layout, and the Mac title bar check on macOS;
  - *drivers*: `scripts/ui-suite.js` (same `UI_SUITE_JOBS` and retry as before).

  Every check that ran before still runs on every OS. One exception removes duplicate work only: on Linux, for pull requests and pushes to `main`, the office layout is not run a second time here because `ci.yml`'s office shards run it in the same event (same script, same runner image, same motion). Nightly and by-hand runs keep the Linux office layout here too. Screenshots are uploaded per OS and part (`ui-shots-<os>-<part>`). On Linux, for pull requests and pushes, both layout parts are left out and theme geometry runs in the drivers job, before the drivers: on this PR's first three runs the first Electron on a fresh Linux runner failed its first frame capture (`shots-001-welcome`, `UnknownVizError`), even when it started alone; with geometry first, as in the old single job, it passes. (`[KNOWN GAP]` the cause in Chromium was not found; a driver run as the very first Electron on a fresh Linux runner can still hit it.)
- **FR-101** **Landing procedure.** Once the workflows above are on `main`, the owner-approved ruleset change adds a merge queue to `main` (merge commits, build up to 5 entries at once, at least 1, wait up to 5 minutes for more, 60 minute check timeout, all entries must be green), with every existing rule and required check unchanged. Agents then land a PR with `scripts/pr-gate.sh <N>` followed by `gh pr merge <N> --merge --auto` (it joins the queue) instead of merging `main` into the branch and waiting for a full rerun. A PR needs `main` merged only when it really conflicts. Admin merge stays for formalities only (AGENTS.md). The ruleset change and the AGENTS.md / `docs/collaboration.md` wording are the maintainer's (repository setting and agent rules; the agent's tooling refused to edit AGENTS.md on a relayed approval): the PR description carries the exact `gh api` body and the text to paste.
- **FR-102** `[KNOWN GAP]` Conflicts in `CHANGELOG.md`, `README.md` and `specs/README.md` still take a PR out of the queue. A changelog-fragments scheme (one file per PR, joined at release) would remove most of them; it changes the docs rule for every agent and the release step, so it is proposed to the owner, not built here. *Update 2026-10-22:* built by spec 025 (PR #534): changelog fragments in `changelog.d/` and a generated `specs/README.md` index, so those two files no longer conflict; `README.md` still can.

*Expected:* a code PR's slowest check falls from about 17 min (UI macOS) to about 6-7; CI's slowest shard from about 3.3 to about 2.3 min. macOS runner minutes per PR rise by about 1 (two more job setups of about 30 s).

*Measured after the change* (PR #507's own green run, head `f6df7232`, 2026-10-21 23:30-00:20 UTC, during a burst of about 20 open PRs):

- Job **run** times: UI slowest job **6.2 min** (macOS drivers; macOS layout halves 4.3 and 5.4; Windows 3.1-4.7; Linux drivers with geometry 3.4), against 15.0 min for the single macOS job. CI office shards **1.4-2.5 min** (were 2.3-3.3); build and test 1.4-2.1 as before.
- Runner minutes: UI 31.5 per run (was about 37: Linux no longer repeats the office layout); CI 19.5.
- **Wall** time was not better on this run: CI 37 min and UI 48 min, almost all of it **queue wait** (macOS jobs waited 14-43 min, Linux shards 20-30 min) because the Free plan's 20 concurrent jobs (5 macOS) were shared with the other PRs' reruns. When runners are free, the critical path is about 3 min for CI and about 7 min for UI. The queue wait is what the merge queue (fewer reruns per PR) and fewer `main` merges reduce; it cannot be fixed inside a workflow.

### 2026-10-22: a test run's window keeps drawing when another window covers it (FR-103)

*Found:* simulator drivers failed only on the Windows CI runner, a few times a night, at changing places (`check-question-options` "an agent has the question in its chat", `shots-052-ux` "J moves to the next row", earlier `check-codex-file-card`, `shots-051-setup`). `ui-suite.js` runs 2-3 drivers at once; on Windows they share one desktop, so a driver's window is often fully covered by another. Chromium then marks the page hidden: animation frames stop and timers are throttled, so `scheduleRender()` (one `requestAnimationFrame`) never draws and the page stops updating mid-check. Linux CI gives each driver its own xvfb display, so it never happened there. Reproduced on Linux by putting four drivers on one X display (`UI_SUITE_JOBS=4 xvfb-run -a node scripts/ui-suite.js`): 7 of 22 drivers passed, with `document.visibilityState` "hidden" and 0 desks drawn in the failure message; with the change below, 22 of 22.

- **FR-103** `[IMPLEMENTED]` (2026-10-22, T096) A test run (`DURBAR_DRIVER` or `DURBAR_SHOT`, both developer hooks ignored in packaged builds, spec 010) is never backgrounded when covered: the window has `backgroundThrottling: false` and Chromium gets `--disable-backgrounding-occluded-windows`. The app itself is unchanged and still saves power when hidden. `sim:` `ui-suite.js` with four drivers on one X display, 22/22 (7/22 without). `[KNOWN GAP]` not yet seen on the Windows runner itself: the PR's own *UI on three OSes* run is the first check there.

### 2026-10-22: out of the CI bottleneck: fewer runner tickets per PR, macOS after the merge (owner decision, T097)

**Owner decision** (Vikram, maintainer and CODEOWNER of `.github/`, team chat 2026-10-22 05:37 UTC), on an audit of the queue: *"implement them immediately including strategy to cancel pending ones and run them in a new efficient manner; you can add your improvements as well to come out of this CI bottleneck"*. This decision overrides, for this change, the earlier recommendation to keep macOS on pull requests and the AGENTS.md *Fast checks, same quality* wording "never by dropping checks": macOS checks are **moved** off pull requests to `main`, nightly and by hand, not deleted, and a failed nightly run is reported in an issue. Shards FR-099 and FR-100 above made things slower and are replaced. A second owner decision the same morning narrowed the theme layout checks on pull requests (FR-111).

*Measured before* (`gh api .../actions/runs/<id>/jobs`, the last 5 finished CI runs and 3 UI runs, 2026-10-22 04:13-05:23 UTC, a burst of about 20 open PRs):

- Every job's **queue wait is far longer than its run**: CI jobs run 0.3-3.4 min (build and test 1.0-2.7, office shards 1.4-3.4, theme geometry 1.5-1.8, package smoke 0.3-0.5) but wait 1-33 min for a runner. UI jobs run 3.7-15.5 min and wait 10-66 min (macOS 16-66, Linux 27-32, Windows 10-21).
- **Two queue waits in a row**: *What changed* (a 10 s job) waited up to 33 min, and only then did the 12 other CI jobs ask for a runner (`needs: changes`) and wait again (up to 26 min). The summary job *Office layout check (xvfb)* is a third ticket after the shards.
- **Tickets per code PR**: CI 13 (1 macOS), UI 7 (3 macOS), Spec Kit 2: **22 runner tickets, 4 on macOS**, against the Free plan's 20 concurrent jobs (5 macOS) for the whole organisation. Windows waited the least of the three OSes (5-10 min in CI, 10-21 in UI), so it is not the bottleneck and stays on pull requests.
- CodeQL is GitHub's *default setup* (repository setting: pull requests, pushes to `main`, weekly); there is no CodeQL workflow in the repository and no duplicate run to remove.

Requirements:

- **FR-104** **No gate job.** `ci.yml` has no *What changed* job and no `needs:`: each job checks out GitHub's test merge commit with `fetch-depth: 2` and runs `.github/scripts/ci-changes.sh`, which diffs `HEAD^1..HEAD` on a pull request (exactly the PR's change) and says `code` and `themes`. A docs-, specs- or Markdown-only PR skips the steps and the job passes, so every required check still reports (a workflow-level `paths-ignore` would leave the required checks "expected" forever). Any other event runs everything.
- **FR-105** **One office job.** The required check *Office layout check (xvfb)* is one job: theme geometry (when the look or the checks can change, FR-031), then the whole office layout in 3 parts, 3 at a time, each in its own Electron and xvfb display (`scripts/check-parallel.js`, `CHECK_SHARDS=3 CHECK_JOBS=3 CHECK_MOTION=1`, motion on as before). No shard jobs, no summary job. The on-demand full theme matrix (`full_themes`) is unchanged.
- **FR-106** **macOS after the merge.** No macOS runner on pull requests or merge queue entries. The required check *Build and test (macos-latest)* reports from a short Linux job that says where macOS runs (the ruleset is not changed). Real macOS runs: CI build and test on every push to `main`, nightly (02:41 UTC) and by hand; UI checks, installed app and packaged check nightly and by hand; install check weekly (Monday) and by hand. Pull requests that touch the installed-app, packaged-check or install-check files still run them on Linux and Windows. `nightly-watch.yml` opens an issue *Nightly CI failing* (label `area:ci`), or comments on the open one, with the run link and the failed jobs, whenever a scheduled run of CI, UI on three OSes, Installed app, Packaged check or Install check fails. It runs from `main` only (`workflow_run`), checks nothing out and never runs PR code. `[KNOWN GAP]` a macOS-only regression is now found after the merge (on `main` or overnight), not before.
- **FR-107** **Drafts and superseded runs.** Every pull-request workflow (`ci.yml`, `ui-platforms.yml`, `spec-kit.yml`, `install-check.yml`, `installed-app.yml`, `packaged-check.yml`, `pages.yml`) skips its jobs on a draft (`!github.event.pull_request.draft`) and runs again on `ready_for_review`; its concurrency group is `<workflow>-<PR number>` with `cancel-in-progress` on pull requests only. Runs on `main`, merge queue entries, nightly and by hand get their own group (`github.run_id`), so they never cancel or wait for each other (the Pages deploy keeps one group per ref). `[KNOWN GAP]` a draft shows its required checks as skipped (GitHub counts that as passed); a draft cannot be merged, and marking it ready starts a full run.
- **FR-108** **UI checks: one job per OS.** `ui-platforms.yml` runs one job per OS with every check in it: theme geometry first, the whole office layout (one Electron at a time: windows share one desktop on Windows and macOS, and a covered test window can stop drawing, FR-103 in PR #516), the Mac title bar on macOS, then `scripts/ui-suite.js`. Pull requests and pushes to `main` run Linux and Windows; macOS runs nightly and by hand. Linux still leaves out the office layout for pull requests and pushes, where `ci.yml`'s office job runs it in the same event. Screenshots: `ui-shots-<os>`.
- **FR-109** **Fewer Spec Kit runs.** `spec-kit.yml` runs on `opened, synchronize, reopened, edited, ready_for_review` (and `merge_group`): `edited` stays because the gate reads the `Spec-Exempt:` line in the description; `labeled`/`unlabeled` are gone (every label change cost a runner). The gate reads labels from the event, so after a maintainer adds `spec-exempt` (or `docs-n/a`), the description is saved once (or a commit pushed) to re-run it; the gate's message, the PR template, CONTRIBUTING and `docs/collaboration.md` say so.
- **FR-110** **Time limits everywhere.** Every job of every workflow has `timeout-minutes` (a hung runner no longer holds a ticket for 6 hours).
- **FR-111** **Theme layout checks: Clean Office and Retro on pull requests** (owner decision, Vikram, team chat 2026-10-22 06:17 UTC: "run theme layout/geometry/screenshot checks only for the main theme (Clean Office) and Retro (dark, different font/layout); the other themes are safe because they only use theme-controlled tokens like main"). On pull requests and merge queue entries `check-theme-geometry.js` checks Retro against Clean Office (was all 5 other styles and the user-theme fixture) and `shots-052-addleft.js` checks Clean Office and Retro (was all 6). On `main`, nightly and by hand both run every theme (`CHECK_ALL_THEMES=1`); the full theme layout matrix (`full_themes`) stays on demand. The cheap guard on every PR is `test:theme` (in `npm test`): `themes.css` may set no size, padding, margin, gap, font size, line height or border width, and now also no size inside a shorthand (`font`, `border*`, `inset`, `flex-basis`, `grid-template*`, `zoom`, `outline-offset`); manifests keep only known tokens and a known UI style and scene kit (`test:theme`, `test:userthemes`). The per-theme **contrast** check (`check-ui-text`, spec 052 FR-169) still runs in every built-in theme: it tests each theme's own colour values, which the layout argument does not cover. `[KNOWN GAP]` a layout difference that the static guard cannot see (a selector that shows or hides an element only in one style, for example) is found on `main` or overnight, not on the PR. Saved per code PR: about 35 s of theme geometry in the CI office job and in each UI job (Linux, Windows), and 16 of 24 page loads in `shots-052-addleft` per OS.
- **FR-112** **A driver that does not parse fails at once.** Before any Electron starts, `scripts/ui-suite.js` runs `node --check` (no shell) on every selected driver and on `scripts/driver-helpers.js`, prints the file and node's message, and exits 1 without starting a driver. Before, a syntax error made Electron hang with no `DRIVER FAILED` line until the 10-minute time limit (seen 2026-10-22). The pass takes well under a second. `test:` `test-ui-suite.ts` checks a good and a broken file, that every listed driver parses, and that the pass comes before the first driver; `sim:` a broken copy of `shots-052-addleft.js` stopped the runner in 0 s with exit 1 and the SyntaxError. `[KNOWN GAP]` a syntax error in another module a driver requires (not `driver-helpers.js`) is still found only when Electron loads it.
- *Guards* (`scripts/test-ui-suite.ts`): no `needs:` and no changes job in `ci.yml`; the three required check names still exist, with all three OS entries; the macOS entry is a Linux report on PR and queue only; the office job runs geometry and `check-parallel.js`; `ui-platforms.yml` has one job per OS with all four checks and macOS only on schedule and dispatch; `merge_group` on both required workflows; every PR workflow skips drafts, reruns on `ready_for_review` and cancels PR runs only; no macOS on PRs in the installed-app, packaged-check and install-check workflows; `nightly-watch.yml` watches real workflow names and never runs PR code; every job has a time limit.

*Expected* (estimate, to be replaced by the PR's own measured run): runner tickets per code PR **22 → 9** (CI 5, UI 2, Spec Kit 2), macOS tickets **4 → 0**; one queue wait instead of two or three. CI's longest job becomes the office job (about 6-8 min run: setup 1.5, geometry 1.5, three parts of about 2.5 min side by side), UI's the Windows job (about 15-17 min run: setup 2, geometry 1, office layout 5.5, drivers 7.5). With the same burst as above, a code PR's checks should finish in roughly 15-25 min instead of 35-75 min (most of the gain is the shorter queue for everyone, since each PR asks for less than half the runners).

*Measured after* (PR #507's own run at `58fd5b02`, 2026-10-22 ~06:00 UTC, before FR-111; the queue had drained by then, so this shows run times, not a burst): every job started within 3-4 s. **CI wall 4.7 min** (office job 4.7 min: theme geometry 55 s for 6 themes, office layout in 3 parallel parts 3.3 min; build and test 1.4 min Linux, 2.1 min Windows; macOS report 3 s; package smoke 0.5 min). **UI wall 17 min**: Windows job 17.0 min (geometry 74 s, office layout 5.9 min, drivers 8.8 min), Linux 9.6 min. Spec Kit 0.3 min. 9 runner tickets, none on macOS. The UI Windows job is now the slowest check; it is not required. Splitting it into office and drivers would bring it to about 10 min for one more ticket (not done: fewer tickets first). FR-111 takes about 55 s off it (geometry in Retro only: 29 s locally against 2 min 42 s for every theme).

### 2026-10-22: theme geometry captures wait for a steady simulator (flake on PR #535)

*Found:* on PR #535's CI (run 39768472450, first attempt) every theme failed `check:geometry` at sim15-1440x900 the same way (455 differences, "+expanded present in only one"). The Clean Office reference had the top bar of a page whose agents had been added but whose simulated events had not been drawn yet: 5 counters at 0, no cost chip, no `+N more` chip, and the inbox button shown only by its own 3 s timer. The page draws through `requestAnimationFrame`; on that first, cold capture no frame ran for over 3 s, so the DOM stayed stale and stable, the 300 ms "two snapshots agree" settle passed, and the `.place.busy` wait timed out without a word (`ctx.waitFor` returns false). A rerun passed. A retry alone would hide the cause. *With FR-103 (review of PR #537, rubenlupi):* FR-103 (T096, on `main` since 2026-10-22) is for the same symptom, animation frames that stop so `scheduleRender()` never draws, and it now applies to `check:geometry` too, because the geometry driver sets `DURBAR_DRIVER` (window `backgroundThrottling: false`, Chromium `--disable-backgrounding-occluded-windows`). Run 39768472450 was on a head without FR-103. FR-103's cause does not explain it, though: in CI's *Theme geometry* job the driver runs alone on its own xvfb display, so no other window covers it. The stall on that cold first capture is **still unexplained** with FR-103, and FR-113 keeps the capture independent of it.

- **FR-113** `[IMPLEMENTED]` (T100) A comparison driver captures only a steady simulator. The simulator page offers a test hook (simulator only, `window.__durbarSimUi.settleNow()`): it is false until the agents are listed, the frozen simulator has replayed every agent's script and the saved usage totals have been read; then it draws any queued frame at once (the same `renderAll` the next animation frame would run) and is true. `check:geometry` waits for it before **every** capture, the Clean Office reference included, and again with the `.place.busy` wait, so a stalled animation frame can no longer leave a stale page. Each page is a fresh load, so no menu or `+N more` chip is left open from an earlier capture. A wait that times out (theme applied, steady page, somebody at a place) now fails the run with its reason instead of measuring anyway. The comparison is unchanged: same combinations, same 0.5px tolerance, no retry of the reference. *Intent of the drawn frame:* `settleNow()` draws any queued frame synchronously (simulator only), on purpose, and keeps doing so: that is what makes the capture deterministic, whatever the frame loop does. `check:geometry` compares layout between themes, not whether the renderer's frame loop runs, so a real renderer stall (frames that never come) is measured here as if the page had drawn. That stall is the job of the other drivers, which wait for the page to draw on its own (FR-096 waits) and run with FR-103; `settleNow()` is never used outside this comparison driver and the simulator.
  - `sim:` `npm run check:geometry` 5 times in a row on Linux (niced, alone); a mutation (one theme's top bar 2px wider) still fails only that theme. Not reproduced: the stalled frame itself (CI's cold start); the fix makes the capture independent of it.

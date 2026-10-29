# Tasks: Packaging, CI and draft releases

## Done (as built)

- [x] T001 electron-builder config for dmg/zip, nsis/portable, AppImage [FR-001, FR-002]
- [x] T002 `prepare-runtime.js` single-runtime per target [FR-003]
- [x] T003 `after-pack.js` verification [FR-004]
- [x] T004 Packaged runtime path resolution + test [FR-005]
- [x] T005 CI workflow: 3-OS build/test + Linux packaging smoke, SHA-pinned actions [FR-006]
- [x] T006 Tag-driven draft release with checksums [FR-007, SC-001]
- [x] T007 README/CONTRIBUTING install, unsigned steps and release notes [FR-008]
- [x] T008 Electron 44 / electron-builder 26 upgrade (Electron 33 out of support)
- [x] T009 Re-ran `pack:dir` on 2026-10-16 (pass)

## Open

- [ ] T020 Signing and notarization: see feature 014 (**needs approval, purchase**). [FR-009]
- [ ] T021 Install and run the built packages on macOS and Windows; record results in the README. [FR-010] 2026-10-21: `installed-app.yml` installs and starts them on CI runners, passed on all 3 (run 39498528735, see spec `## Changes`); a person's own machine (Gatekeeper, SmartScreen) stays open.
- [x] T022 Add `engines` (Node >= 20.19) to `package.json` and align CONTRIBUTING/CI. [FR-013] (2026-10-19: `engines.node` is `^20.19.0 || >=22.12.0` in `package.json`, as CONTRIBUTING says; CI uses Node 22)
- [ ] T023 Decide on arm64 Windows/Linux and other package formats (clarify demand first). [FR-011]
- [ ] T024 Build attestations (`actions/attest-build-provenance`), pinned by SHA. [FR-012]
- [x] T025 Pack-smoke on macOS and Windows runners. [FR-015] Done by spec 012 T044 (`packaged-check.yml`, 3 OSes, passing); gap closed 2026-10-21.
- [ ] T026 Dependabot for npm and Actions (SHA-pinned). [FR-016]
- [x] T027 CI job `office-check`: `npm run check:office` under xvfb on Ubuntu (timeout 10 min, ~70 s measured). [FR-017]
- [x] T028 Owner/credits in one place (`src/shared/about.ts`), About panel + Settings > About, package.json author/contributors, copyright, LICENSE, README, `test:about` [FR-018]
- [x] T029 appId `io.github.three-feathers.agentdurbar` in package.json, spec, test, README note [FR-019]
- [x] T030 Contributor names are the GitHub handles (decided by Vikram 2026-10-16); change `CONTRIBUTORS` + package.json `contributors` to use real names later. [FR-018]
- [ ] T031 Look at the About panel and installer metadata on macOS and Windows builds. [FR-018]
- [x] T032 (2026-10-19) Faster CI: compile tests once and run suites in parallel (FR-020), shard `check:office` with the required check kept as an aggregator (FR-021), package smoke without `needs` (FR-022), skip code jobs for docs-only PRs (FR-023)
- [x] T033 (2026-10-19) Branch cleanup workflow: merged more than a day ago, same repo, not the default, no open PR, tip = merged head; daily and by hand with a dry run (FR-024)
- [x] T034 (2026-10-19) Linux window icon and desktopName/syncDesktopName (#247) [FR-025, FR-026]
- [x] T035 (2026-10-19) Theme geometry check per PR, the full theme matrix in CI on demand (FR-031, replacing FR-027); a local parallel runner with CPU, memory and priority limits and per-run result files (FR-028); `npm test` leaves a core and runs niced (FR-029); reduced motion outside the plain office check (FR-030)
- [x] T036 (2026-10-19, #303) Redact ReDoS test in worker threads instead of child processes (FR-032)
- [x] T037 (2026-10-20, #353, D1-D3 decided) Display name "Agent Durbar" (no `setName`) and a chosen profile folder [FR-033, FR-034, FR-035, FR-036]. Done when:
  1. a pure module (no Electron import, for example `src/main/profiledir.ts`) exports `profileDir({ packaged, platform, appData, env })`;
  2. a new `scripts/test-profiledir.ts`, in its own `test:profiledir` script and in the `test:serial` list (not in `test:runtime`), asserts on `win32`, `darwin` and `linux` sample `appData` paths: packaged = `<appData>/agent-durbar`; not packaged = `<appData>/agent-durbar-dev`; `DURBAR_USER_DATA` wins in dev and in a packaged build with `DURBAR_DEV=1`, and is ignored in a packaged build without it (through `devEnv`); Windows paths use backslashes; the dev folder is never equal to the installed one;
  3. the same test (or `test-about`) asserts `MENU_APP_NAME === pkg.build.productName === aboutPanelOptions('x').applicationName`, that `pkg.name` is still `agent-durbar` and that there is no top-level `productName`;
  4. a source check (like `test-macos` reads `main.ts`) asserts that `app.setPath('userData', profileDir(` comes before the first `getPath('userData')` and before `app.whenReady` in `src/main/main.ts`, that there is NO `app.setName(` in `main.ts` (D2), and `test-macos` asserts the menu labels `About/Hide/Quit Agent Durbar`, and that the old bare `DURBAR_USER_DATA` line is gone;
  5. `xvfb-run -a` simulator run with `DURBAR_SIM=15` and a temp `XDG_CONFIG_HOME` shows the files under `<temp>/agent-durbar-dev`, and with `DURBAR_USER_DATA=<temp2>` under `<temp2>` (no real data touched, no AI credits);
  6. a mutation check: changing the dev folder to `agent-durbar` or adding an `app.setName(` call makes the new test fail;
  7. README, CONTRIBUTING, spec 010 FR-004 cross-reference and a CHANGELOG line (Unreleased) as in FR-036; this spec's FR-033..FR-036 tagged `[IMPLEMENTED]`/`test:`/`sim:` and the `[KNOWN GAP]`s kept;
  8. `npm run typecheck && npm run build && npm test` pass.

  Built 2026-10-21 on Linux (`test:checknames`, `test:macos`, `pack:dir`, `dist:linux` with `Exec=AppRun %U`, `installed-app-ci.js` on the packed AppImage with the simulator). Criterion 5 done: `real:` CI *Installed app* run 39561893292 (Windows: Start menu and desktop `.lnk`, DisplayName, shortcut AUMID; macOS: `CFBundle*`; Linux: `.desktop`; check-names on the Windows exe and the macOS `Info.plist`). Still open: criterion 6 (*Packaged check* on `main`, run id to note after the merge).
- [x] T038 (2026-10-20, #355) Electron fuses and no remote debugging in packaged builds (FR-037..FR-039). Files: `package.json` (`build.electronFuses`, `pack:dir` runs `scripts/check-fuses.js`, new `check:fuses-launch`), `scripts/check-fuses.js`, `scripts/check-fuses-launch.js`, `src/main/main.ts` (the FR-038 guard, packaged only), a unit test for the guard's decision function, README *Install from releases* / known limits, CHANGELOG. Rows: (a) the fuse wire of the Linux unpacked build matches FR-037; (b) changing one value in the config makes `check-fuses.js` fail; (c) launch probe on the packed Linux app: `--inspect=0` opens no inspector, `--remote-debugging-port` gives no `/json/version`, `ELECTRON_RUN_AS_NODE=1` starts the app (not Node), and the window opens; (d) the guard does nothing in dev runs (unit test, and `npm run check:office` still passes); (e) `npm run typecheck && npm run build && npm test` pass.

## 2026-10-20: UI checks on three OSes in Actions

- [x] T090 A failing driver exits 1 (dev hooks only) [FR-090]
- [x] T091 `scripts/ui-suite.js`: cross-platform driver runner (no shell, xvfb only on Linux without a display), list of drivers with their settings, `--only`, `--list`; `npm run check:ui` [FR-091]
- [x] T092 `.github/workflows/ui-platforms.yml` on ubuntu, macOS and Windows: geometry, office, Mac title bar, ui-suite, screenshots as artifacts [FR-092]
- [ ] T093 (first run: Windows and Linux all green; macOS: window clamped to the screen, FR-093, and the driver pressed Ctrl not Cmd; both fixed) First runs on all three OSes; every failure fixed at the cause or recorded; docs (README Development, CONTRIBUTING, CHANGELOG, agent notes) [FR-090..FR-092]

- [x] T039 (2026-10-21, #384) Packaged display names on Windows, Linux and macOS [FR-040..FR-045]. Files:
  - `src/main/main.ts` (FR-043, packaged win32 only);
  - `src/main/appmenu.ts` (FR-044 label);
  - `scripts/check-names.js` (new) and its self-test `scripts/test-checknames.ts`;
  - `package.json`: `pack:dir` and `dist:*` run `check-names.js`, `test:serial` adds `test:checknames`, and `build.appImage.executableArgs: []` (FR-041);
  - `scripts/installed-app-ci.js` (Windows, macOS and Linux asserts);
  - `scripts/test-macos.ts`;
  - README (*Install from releases*, known limits), CHANGELOG, this spec and `specs/README.md`.

  Done when:
  1. `npm run pack:dir` on Linux runs `check-names.js` and it passes. A copy of the config with `productName` changed, a top-level `productName` added, or `desktopName` changed makes it fail (self-test in `npm test`).
  2. `npm run dist:linux` passes `check-names.js`, with the AppImage's `.desktop` `Name=Agent Durbar`, `StartupWMClass=agent-durbar`, `Icon=agent-durbar` and `Exec=AppRun %U`.
  3. A static check in a unit test:
     - `main.ts` calls `app.setAppUserModelId` with a value equal to `build.appId`, only when `process.platform === 'win32'` and the app is packaged (or as D1 decides), and before `app.whenReady`;
     - there is still no `app.setName(` call.
  4. `scripts/test-macos.ts` checks that the `appMenu` item has `label` = `MENU_APP_NAME` = `build.productName`.
  5. `installed-app.yml` (started by the PR's change to `scripts/installed-app-ci.js`) passes on all three OSes, and asserts:
     - Windows: Start menu and desktop `Agent Durbar.lnk`, DisplayName `Agent Durbar <version>`, shortcut AUMID = `appId`;
     - macOS: the `CFBundle*` names;
     - Linux: the `.desktop` names.
  6. *Packaged check* on `main` runs `check-names.js` on macOS and Windows (`--dir`) and passes. This is checked after the merge and noted here with the run id.
  7. The spec records `[KNOWN GAP]` for: taskbar and toasts on a real PC (#9), the Mac menu-bar title by eye, and the Linux launcher name on a desktop.
  8. `npm run typecheck && npm run build && npm test` pass.
- [x] T094 (2026-10-21, #414) Simulator drivers share `scripts/driver-helpers.js` (FR-097): `js`, `shot`, `key`, `clickText`, load-and-wait move there; every driver uses them; no assertion changes. Done: `ui-suite` all green after each batch, `check:office`, `check:geometry`, Mac title bar check, `npm run typecheck && npm run build && npm test`; screenshot-only drivers run once by hand.
- [x] T095 (2026-10-22, owner; item 3, the ruleset, is the maintainer's step after the merge) Merge-queue-ready CI and shorter UI runs [FR-098..FR-102]. Files: `.github/workflows/ci.yml` (`merge_group`, 6 office shards), `.github/workflows/spec-kit.yml` (`merge_group`), `.github/workflows/ui-platforms.yml` (three parts per OS), `scripts/test-ui-suite.ts` (guards: the three parts cover every check, shard counts match, `merge_group` on required workflows), `docs/agent-notes.md`; AGENTS.md and `docs/collaboration.md` wording drafted in the PR for the maintainer, CHANGELOG, this spec and `specs/README.md`. Done when:
  1. the PR's own runs are green, and their measured times are written in the spec next to the numbers before;
  2. the UI run on the PR shows every check that ran before on every OS (theme geometry, office layout, Mac title bar, ui-suite) except the Linux office layout, which the same PR's CI office shards ran;
  3. after the merge, the ruleset has the merge queue rule and every earlier rule and required check (read back with `gh api`);
  4. `npm run typecheck && npm run build && npm test` pass.
- [x] T096 (2026-10-22) Test runs are never backgrounded when another window covers them (FR-103): `backgroundThrottling: false` and `--disable-backgrounding-occluded-windows` under `DURBAR_DRIVER`/`DURBAR_SHOT` in `src/main/main.ts`. Done when `UI_SUITE_JOBS=4 xvfb-run -a node scripts/ui-suite.js` (all drivers on one display) passes, the PR's Windows UI run is green, and `npm run typecheck && npm run build && npm test` pass.
- [x] T097 (2026-10-22, owner decision in the team chat; supersedes T095's 6 shards and 3 UI jobs per OS) Fewer runner tickets per PR, macOS after the merge [FR-104..FR-110]. Files: `.github/workflows/ci.yml` (no changes job, inline `ci-changes.sh`, one office job, macOS report job on PR and queue, nightly), `.github/scripts/ci-changes.sh`, `.github/workflows/ui-platforms.yml` (one job per OS, macOS nightly), `spec-kit.yml` (no label triggers), `install-check.yml`, `installed-app.yml`, `packaged-check.yml`, `pages.yml` (drafts, concurrency, macOS nightly or weekly), `nightly-watch.yml` (issue on a failed nightly run), timeouts in every workflow, `scripts/test-ui-suite.ts` (guards), `.github/scripts/spec-gate.sh` message, PR template, CONTRIBUTING, `docs/collaboration.md`, README, CHANGELOG, `docs/agent-notes.md`, this spec and `specs/README.md`. Done when:
  1. the PR's own runs are green and report all six required check names; their queue and run times are written in the spec next to the before numbers;
  2. no macOS runner is used by the PR's runs;
  3. `npm run typecheck && npm run build && npm test` pass.
- [x] T098 (2026-10-22, owner decision in the team chat 06:17 UTC) Theme layout checks on pull requests: Clean Office and Retro [FR-111]. Files: `scripts/check-theme-geometry.js` (Retro by default, `CHECK_ALL_THEMES=1` for all), `scripts/shots-052-addleft.js` (Clean and Retro by default), `ci.yml` and `ui-platforms.yml` (`CHECK_ALL_THEMES` off on PRs only), `scripts/test-theme.ts` (no sizes in shorthands either, mutation-checked with `font:600 14px` and `border-top:solid 3px`), `scripts/test-ui-suite.ts` (wiring guards), spec 035 delta, AGENTS.md *Fast checks* wording, README, `docs/collaboration.md`, `docs/design-rules.md`, CHANGELOG. Done when the PR's runs are green, `check:geometry` passes locally in both modes, and `npm run typecheck && npm run build && npm test` pass.
- [x] T099 (2026-10-22, coordinator for the owner) `ui-suite.js` checks every selected driver and `driver-helpers.js` with `node --check` before starting Electron and fails at once on a syntax error [FR-112]. Files: `scripts/ui-suite.js` (exports `syntaxErrors`, runs `main` only as a script), `scripts/test-ui-suite.ts`. Done: test passes; a broken driver stops the runner in 0 s with exit 1.

## 2026-10-22: steady geometry captures (flake on PR #535)

- [x] T100 `settleNow()` simulator hook in `src/renderer/app.js` (listed + replayed + usage totals read; draws a queued frame), replay flag in `src/renderer/sim.ts`; `scripts/check-theme-geometry.js` waits for it before every capture and fails on a timed-out wait; 5 local runs and a one-theme mutation; `docs/agent-notes.md`, CHANGELOG [FR-113]

## 2026-10-22: Electron installed once before the office parts start (CI flake on PR #546)

- [x] T101 (2026-10-22, reported by fjcabello on PR #546) Install Electron once before any fan-out [FR-114]. Files: `scripts/ensure-electron.js` (new, the #424 step moved out of `run-tests.js`), `scripts/run-tests.js`, `scripts/check-parallel.js` and `scripts/ui-suite.js` (call it before the first job; export their runners for the test; side effects only when run as a script), `scripts/test-ui-suite.ts`, `docs/agent-notes.md`, `changelog.d/008-shard-electron-once.md`. Done when the test shows one install before the first job in both runners, a local repro of the race (parallel first runs of a copy of `node_modules/electron` with no binary) fails without the step and passes with it, a quick `check-parallel.js` run (`OFFICE_QUICK=1`) and the PR's CI office job pass, and `npm run typecheck && npm run build && npm test` pass.

## 2026-10-22: `npm test -- --bail` (issue #563)

- [x] T102 (2026-10-22, issue #563) Opt-in fail-fast for `npm test` [FR-115]. Files: `scripts/run-tests.js` (`parseArgs`, `loadSuites`, `stopChild`, `runSuites` exported; detached spawn, group kill / `taskkill /T /F`), `scripts/test-run-tests.ts` and `scripts/test-run-tests-real.ts` (new), `package.json` (`test:runtests`, `test:runtestsreal`, in `test:serial`), `README.md`, `docs/agent-notes.md`, `changelog.d/008-test-bail.md`. Done when the unit test passes and fails with the stop removed, and `npm run typecheck && npm run build && npm test` pass.

## 2026-10-23: nightly-watch branch filter

- [x] T103 (2026-10-23, owner question) `branches: [main]` on `workflow_run` in `.github/workflows/nightly-watch.yml` [FR-116]. Files: that workflow, `changelog.d/008-nightly-watch-filter.md`. Done when the YAML parses and, after the merge, `gh run list --workflow nightly-watch.yml` shows no more runs for PR branches.

## 2026-10-23: release notes folded at tag time

- [x] T104 (2026-10-23, owner-approved in the team chat by Paco and Vikram) Fold at tag time [FR-117..FR-120]. Files: `.github/workflows/release.yml` (`verify` job, notes file, always a draft pre-release, never latest), `scripts/release-notes.js` (new), `scripts/changelog.js` (`notes`, `build --stdout`, `--previous`), `scripts/test-changelog.js`, `changelog.d/README.md`, `docs/collaboration.md`, `AGENTS.md`, `README.md`, `changelog.d/008-fold-at-tag.md`. Review on #648 (8 fixes: full main ref, the hostile-writer gap, final releases sort above pre-releases, draft-only `--clobber`, no token in any checkout and only `matrix.*` in `run:`, the fold conflict, the test-build mutant, text). Done when the tests pass and each planted mutation of a guard fails them, a dry run of `release-notes.js` on a local scratch tag (never pushed) gives the notes, and `npm run typecheck && npm run build && npm test` pass. After the merge: the next tag's run is the first real check (`[KNOWN GAP]` until then).

## 2026-10-23: test builds from branches

- [x] T105 (2026-10-23, owner decision by Vikram, issue #658) Test builds from branches [FR-121..FR-124]. Files: `scripts/release-notes.js` (`TEST_TAG_RE`, `tagKind`, `loadRedact`, `testNotes`, `--title-out`), `.github/workflows/release.yml` (title from `verify`), `scripts/test-changelog.js`, `docs/collaboration.md`, `changelog.d/README.md`, `README.md`, `changelog.d/008-test-builds.md`. Done when the classifier, the off-`main` refusal of a regular tag, the accepted test tag, its masked notes, the cap, the version rule and the previous-release filter are tested, each planted mutation fails the tests, a dry run on a scratch clone with a local test tag (never pushed) gives the notes, and `npm run typecheck && npm run build && npm test` pass. After the merge: the first pushed test tag is the first real check (`[KNOWN GAP]` until then).

## 2026-10-24: check-parallel on macOS (issue #670)

- [x] T106 (2026-10-24) macOS memory from `vm_stat` and a bounded wait [FR-125, FR-126]. Files: `scripts/check-parallel.js` (`parseVmStat`, `darwinAvailable`, `makeAvailable` with a 1 s cache, `waitForMemory`, the `active` count), `scripts/test-check-parallel.js` (new), `package.json` (`test:checkparallel`), `changelog.d/008-parallel-mac.md`. Done when the parse, the fallback and the bound are tested, each planted mutation fails, and `npm run typecheck && npm run build && npm test` pass. Ran on Paco's Mac (`check:themes` 14/14, vm_stat 2848 MB vs freemem 186 MB); the 120 s fallback was not exercised there (`test:` only).

## 2026-10-24: macOS nightly UI regression (#683)

- [x] T107: correct the macOS-only native text-editing assertions in `scripts/shots-074-navigator.js`: synthetic ⌘⌫ and ⌘A must reach the editable field without being prevented or closing the chat; verify normal Backspace edits text, while Windows/Linux continue to assert Ctrl+Backspace deletes a word and Ctrl+A selects all. Add the platform limitation to `docs/agent-notes.md` and a changelog fragment. Done: the navigator driver passes locally on macOS at both sizes, the planted app-interception mutation fails it, and `npm run typecheck && npm run build && npm test` pass. A post-merge nightly UI run on `main` remains required to close issue #683.
- [x] T109 (2026-10-25, #738) `check-ui-text` split into `check-ui-text light` and `check-ui-text dark` in `scripts/ui-suite.js` (`UITEXT_PART` in `scripts/check-ui-text.js`, `UITEXT_TIMING=1` for per-surface times) [FR-128]. Done: the union of the two parts' `[ui-text]` lines equals the one run's (420 surfaces, 0 violations), two planted text mutants (an early and a late surface) are still caught, and the two parts together take about half the time. Typecheck, build and test pass.


## 2026-10-25: fold branch names without dots

- [x] T108: fold branch name `NNN-fold-alpha-N` in `scripts/release-notes.js` (`foldSlug`) and its test in `scripts/test-changelog.js`; docs in `changelog.d/README.md` and `docs/collaboration.md`; notes on the historical plans of 082, 086, 088; `docs/agent-notes.md` entry [FR-127]

## 2026-10-26: stable release tag

- [x] T110: `releaseKind`/`publishCommand`/`STABLE_PREAMBLE` and `--github-output` in `scripts/release-notes.js`, stable heading in `scripts/changelog.js`, `release.yml` reads the kind from `verify`, tests in `scripts/test-changelog.js`, docs in `changelog.d/README.md` [FR-129]

## 2026-10-26: release notes name every agent app

- [x] T111: `AGENTS_CLAUSE` in `scripts/release-notes.js` for both intros (agent apps, four-company non-affiliation) and its asserts in `scripts/test-changelog.js` [FR-130]

## 2026-10-27: the nightly macOS UI job gets 80 minutes

- [x] T112: macOS UI job `timeout-minutes` 80 in `ui-platforms.yml` (FR-131, 2026-10-27)

## 2026-10-27: release provenance, verified runtime download, exact pins

- [x] T113: attest-build-provenance in `draft-release` (SHA-pinned, job-level `id-token`/`attestations` write) and README "Verify a download" [FR-132]
- [x] T114: `scripts/verify-tarball.js` used by `prepare-runtime.js`, with `scripts/test-verify-tarball.js` [FR-133]
- [x] T115: exact `electron` and `electron-builder` pins [FR-134]

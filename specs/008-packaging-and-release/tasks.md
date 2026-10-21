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

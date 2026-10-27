# Tasks: 094 Terminal tab

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md)

**Tests**: required by the constitution (VII.3) and SC-001..SC-006. All in Node with a fake PTY or on the simulator; 0 AI credits. Drivers wait with `until()`. The only real process in CI is the packaged check's fixed command (T013).

**Format**: `- [ ] Tnnn [P?] [USn?] description (files) [requirements]`. `[P]` = can run in parallel. One task = one small, testable step; a phase = one PR.

## Phase 0: Spec (this PR)

- [ ] T001 Spec, plan, research, tasks and the specs-index block committed (`specs/094-terminal-tab/`)
- [x] T002 Owner answers Q1-Q8 on issue #807 recorded under *Clarifications* (defaults: all a); spec, plan and tasks updated where an answer differs
- [ ] T003 `/speckit-analyze` pass: every FR has a task, every task an FR; fix drift before Phase 1

## Phase 1: Dependency and packaging spike (PR 1, no UI)

- [ ] T010 Re-check node-pty's latest versions; pin the first with Linux prebuilds exactly (Q7), plus `@xterm/xterm` 6.0.0 and `@xterm/addon-fit` 0.11.0 in `dependencies` (`package.json`, `package-lock.json`) [plan 2]
- [ ] T011 `build.asarUnpack` + `build.files` exclusions (sources, `.pdb`, `node-addon-api`, `@xterm`); `npmRebuild`/`nodeGypRebuild` stay false (`package.json`) [plan 2]
- [ ] T012 `prepare-runtime.js`: keep only the target's `node-pty/prebuilds/<target>/`, restore it with `npm pack` when missing; Windows `conpty/` rule; unit test of the prune plan as a pure function (`scripts/prepare-runtime.js`; new `scripts/test-prepare-runtime.ts`, none exists today) [plan 2]
- [ ] T013 `after-pack.js`: fail on a missing target `pty.node`, a stray prebuild dir, or (macOS) a missing or non-executable `spawn-helper` (`scripts/after-pack.js`) [plan 2]
- [ ] T014 Packaged check: load node-pty in the packaged main and run one fixed command that exits 0 (POSIX `-c 'exit 0'`, PowerShell `-NoProfile -Command 'exit 0'`) within 10 s (`scripts/pack-esm-check.js`); run `packaged-check.yml` by hand on the branch for Windows, macOS, Linux [FR-042, SC-006]
- [ ] T015 Record measured installer sizes per target and the loaded module version in spec *Changes*; revise the spec if any target fails [plan 2]

## Phase 2: Main process (PR 2)

- [ ] T020 [P] `src/main/terminal/shell.ts` `chooseShell()` pure + `scripts/test-terminal-shell.ts` (`test:terminalshell`, add to `npm test`) [FR-010, FR-011]
- [ ] T021 [P] `src/main/terminal/env.ts` `terminalEnv()` pure + `scripts/test-terminal-env.ts` (`test:terminalenv`) [FR-013]
- [ ] T022 Env snapshot at the top of `main.ts`, before the simulator clock and adapters load; passed to the controller (`src/main/main.ts`) [FR-013]
- [ ] T023 [P] `src/main/terminal/busy.ts` `isBusy()` pure + tests (Windows always busy while open) [FR-031]
- [ ] T024 [P] `src/main/terminal/kill.ts` `endTree()` with injected kill/timer; POSIX SIGHUP then group SIGKILL after 2 s; Windows `killChildTree`; tests with fakes [FR-033]
- [ ] T025 `src/main/terminal/controller.ts` `makeTerminalController()`: one per folder key, lazy `require('node-pty')`, spawn argv + cwd, tid, state, input/resize validation, batching, flow control, replay buffer, close, folderGone, busyCount, disposeAll [FR-007..FR-009, FR-020..FR-025]
- [ ] T026 `scripts/test-terminal-controller.ts` (`test:terminal`) with a fake PTY: every rule of T025, plus "never logs data" (spy on an injected logger and `console`) and "never requires node-pty under the simulator flag" [FR-014, FR-041]
- [ ] T027 `src/main/terminal/simpty.ts` fake shell (prompt, echo, `ls`, `git status`, `sleep 30`, `exit`); used when `SIMULATOR` [FR-040]
- [ ] T028 `src/main/ipc/terminal.ts` `register(deps)`: channels of plan 4 with `ipcHandle`/`ipcOn`, agent id -> folder key and cwd via `wsKey` and `resolveWorkspaceCwd` rule (first root), missing folder refused; simulator `simKey` path [FR-012, FR-020, FR-021, FR-040]
- [ ] T029 Preload `terminal*` members and `onTerminalData`/`onTerminalState`; optional types in `src/shared/api.ts` (`src/preload/preload.ts`) [FR-020]
- [ ] T030 `SIM_OPEN_CHANNELS` entries with reasons; `test:simguard` and `test:ipcchannels` (fromApp list) updated (`src/main/simguard.ts`, `scripts/test-ipcchannels.ts`) [FR-040, FR-042]
- [ ] T031 Folder removal ends the terminal: `deps.terminalGone(key)` in `folders:remove` (`src/main/ipc/folders.ts`, `main.ts` wiring) [FR-034]
- [ ] T032 Quit: `quitMessage(n, busyTerminals)` and the count in `confirmQuit`, `before-quit` and the window's `close`; `disposeAll()` in `will-quit`; unit test of the message words (`src/main/daily.ts`, `src/main/main.ts`, `scripts/test-daily.ts`) [FR-032, FR-033; SC-003]
- [ ] T033 [P] `scripts/test-terminal-useronly.ts` (`test:terminaluseronly`): the static import and no-logging rules of plan 7 [FR-015, FR-014]

## Phase 3: Window (PR 3)

- [ ] T040 `src/renderer/paneltabs.js` (UMD; pure `tabsFor`, roving next, label words) + `scripts/test-termpane.ts` cases for it; move the tablist out of `browserpane.js` with Browser as a tab owner; `test:browserpane`, `check:browser-tab`, `check:browser-dialogs` stay green [FR-001, FR-003]
- [ ] T041 Vendor xterm: copy `xterm.js`, `xterm.css`, `addon-fit.js`, `LICENSE` to `dist/renderer/vendor/`; add `paneltabs.js`, `termpane.js` to the copy list; tags in `index.html`, CSP line unchanged; `test:globals` knows the new globals (`scripts/copy-assets.js`, `src/renderer/index.html`) [plan 3]
- [ ] T042 `src/renderer/termpane.js` DOM: pane and bar (folder, shell, "Your shell; agents can't see it. The folder's mode does not apply.", Close terminal, leave-key hint), xterm per folder key re-attached on mount, `fit` on resize, ack of received bytes, Start terminal, ended state [FR-002, FR-004, FR-005, FR-009, FR-050]
- [ ] T043 Pure `keyGoesToShell(e, isMac)` + guard at the top of the global key handler so Esc, Tab, plain Ctrl/Alt keys and F2 reach the shell; F6 leaves; tests for every FR-051 row (`src/renderer/termpane.js`, `src/renderer/app.js:3060`, `scripts/test-termpane.ts`) [FR-051, FR-052]
- [ ] T044 Wire into the panel: template spots, `mount`/`hide` in `openPanel`/`closePanel`, `chatShownNow` reads the shared tab, `notes.js showChatTab` leaves Terminal, `removeFolder()` words name a running command (`src/renderer/app.js`, `src/renderer/notes.js`) [FR-001, FR-006, FR-034]
- [ ] T045 Close-terminal question through `askDialog` (Cancel focused) when busy [FR-030]
- [ ] T046 Styles: `.tpane`, `.tbar`, `.tview`, `:not(.on-chat)` rules replacing `.on-browser`; tokens only; xterm theme from computed tokens, re-read on theme change; contrast check per built-in theme (`src/renderer/styles.css`, `scripts/test-termpane.ts` or `test:theme`) [FR-050, FR-054]
- [ ] T047 Accessibility: `screenReaderMode: true`, accessible name "Terminal in <folder>", tab state in the tab's name, `preventScroll` focus (`test:innerscroll`) [FR-050, FR-052; US4]
- [ ] T048 Simulator: `sim.ts` passes a simulated folder key with `terminalOpen`; driver hook to read `busyCount` [FR-040]
- [ ] T049 Driver `scripts/check-terminal-tab.js` (cases 1-9 of plan 7) at 1440x900, 1280x800 and the narrow panel; `check:terminal-tab` script; entry in `scripts/ui-suite.js`; fails on a CSP violation in the console [SC-001..SC-005]
- [ ] T050 Screenshots `docs/screenshots/094-terminal-tab-{1440x900,1280x800,narrow}.png`; `DOC_SHOTS` entry if linked from the README (`scripts/shots-docs.js`) [FR-043]
- [ ] T051 `check:office` run unchanged (no office change) [FR-053]

## Phase 4: Docs and converge (PR 4, or with PR 3)

- [ ] T060 README: feature line, *Safety model* sentence (your own shell; the modes are for agents), *Known limits* (spec gaps), keyboard help rows; `npm run shots:docs` for every linked picture that shows the chat tablist [FR-043]
- [ ] T061 `changelog.d/094-terminal-tab.md`; spec 080 and spec 052 `## Changes` dated lines (three tabs; quit question and keyboard sheet) [FR-043]
- [ ] T062 `docs/agent-notes.md` entries learned in phases 1-3 (packaging, keys, xterm in a strict CSP) with evidence
- [ ] T063 Spec housekeeping: tick tasks, `[IMPLEMENTED]` tags, specs-index status, `/speckit-converge`
- [ ] T064 Real-machine checks by the owners, each recorded as `real:` in the spec (research R7): macOS zsh from Finder, Windows PowerShell and cmd, Linux bash, one screen reader per OS; open an issue for each one that cannot be done now [Known gaps]

## Dependencies

- Phase 1 before Phase 2 (the module must load on every target before main code depends on it); Phase 2 before Phase 3 (the window needs the IPC); Phase 4 last.
- Inside Phase 2: T020, T021, T023, T024, T033 in parallel; T025 needs them; T026 with T025; T028 needs T025; T029-T032 after T028.
- Inside Phase 3: T040 and T041 first; T042-T048 after; T049-T051 last.

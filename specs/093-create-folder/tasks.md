# Tasks: 093 create a folder from + Folder

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: required (constitution VII.3; SC-002..SC-006). Node tests and the simulator only; 0 AI credits; no network. Driver waits use `until()`.

**Format**: `- [ ] Tnnn [P?] [USn?] description (file) [requirements]`. `[P]` = can run in parallel. One task = one small testable step; a phase = one PR.

## Phase 0: Spec (this PR)

- [x] T001 Spec, plan, tasks and specs-index block (`specs/093-create-folder/`); cross-reference lines under `## Changes` in specs 006 (FR-001) and 063 (FR-008)
- [x] T002 Owner answers recorded under *Clarifications* (Paco, 2026-10-27, in the terminal): Q1 = a, Q2 = b (top bar's mode), Q3 = a, Q4 = a; Q5 not asked, agent default (a), owner may change
- [x] T003 Post the owner's answers on issue #805 as a comment, saying they were given in the terminal (AGENTS.md: feedback given outside GitHub goes on the issue too)

## Phase 1: Empty folder and new repository (PR 1)

- [x] T010 [P] `src/shared/newfolder.ts`: `checkNewFolderName`, `NEW_FOLDER_LIMITS`, `WINDOWS_RESERVED_NAME` moved here (with `COM¹²³`/`LPT¹²³`) and re-exported from `src/main/profilefiles.ts` (profile tests stay green) [FR-010]
- [x] T011 [P] `scripts/test-newfolder.ts` + `test:newfolder` in `package.json` and the `npm test` list: the name corpus of plan *Testing* 1 (at least 30 refused, accepted names), one message per rule [FR-010; SC-002]
- [x] T012 `gitstatus.ts`: `gitCreateCall({kind:'init'}, …)` (argv and env of FR-031..FR-033 for init) and `runGitCreate` (spawn read at call time, `shell:false`, `windowsHide`, `detached` on POSIX, stdin ignored, `killChildTree` for cancel); read-only runner unchanged [FR-030..FR-034]
- [x] T013 `test-gitstatus.ts`: init argv/env pinned; spawn options through a fake `spawn`; the source test that no other file in `src/` starts git covers `spawn` [FR-030, FR-031, FR-034]
- [x] T014 `src/main/newfolderop.ts` (deps injected): parent token (one use, 10 min), lock, Windows 200-character rule, non-recursive `mkdir` and error mapping, private hooks folder, init/empty, cleanup with retries, `addMany(..., validMode(mode), opts)`, save `newFolderParent` on success only [FR-005, FR-006, FR-012, FR-013, FR-042, FR-050, FR-051, FR-060..FR-062]
- [x] T015 `scripts/test-newfolderop.ts`: plan *Testing* 4 for init and empty (incl. git missing, each `mkdir` error, removal retries then the by-hand message, the window's mode through `validMode` (unknown = Read-only), parent saved only on success) [FR-005, FR-012, FR-013, FR-050, FR-060..FR-062]
- [x] T016 `SettingsStore`/`parseSettings`: `newFolderParent` (absolute, ≤ 4096, no control chars); header comment; test [FR-006]
- [x] T017 `src/main/ipc/newfolder.ts`: `folders:createPickParent` (system picker at the remembered parent), `folders:createCheck`, `folders:create`, each with `fromApp(e)` and typed checks; `sessionOpts` shared with `agents:addFolder`; wiring in `main.ts`; `test-ipcchannels.ts` owner-only list [FR-004, FR-005, FR-080]
- [x] T018 IPC wiring test on a stand-in `electron`: not-`fromApp` refused; refused names never reach `mkdir`; the mode reaches `addMany` through `validMode` (`allow`, `ask`, `read-only`, junk = Read-only) [FR-061, FR-080]
- [x] T019 Preload and `DurbarApi`: `createPickParent`, `createCheck`, `createFolder` (no channel on `SIM_OPEN_CHANNELS`; `test:simguard` green) [FR-081]
- [x] T020 `src/renderer/newfolder.js` + `index.html`: choice dialog (`askDialog`, *Add existing* focused), picker, name dialog with *Change place…*, errors from main shown with `input.error` and the typed text kept; only the button and the welcome screen open the choice, Ctrl+O and the palette's *Add folder* keep the picker; the *Allow all* confirmation as in `addVia`; `addVia` options split into `addOptions()` [FR-001..FR-003, FR-082]
- [x] T020a File > New Folder… menu item (`src/main/appmenu.ts`, sent to the window like File > Add Folder…, spec 052 FR-164) and palette entries *Clone a repository*, *New repository*, *New empty folder*; File > Add Folder… and Ctrl+O unchanged; keyboard and menu docs [FR-001, FR-001a]
- [x] T021 Simulator fakes in `src/renderer/sim.ts` (picker, check, create; canned refusals; a fake room in the mode passed in; no process) [FR-081]
- [x] T022 Driver `scripts/shots-093.js` (phase 1 cases): chooser (button and welcome screen), Ctrl+O still opens the picker directly, File > New Folder… and the palette entries open the flow, name refused, new repository and empty folder rooms in the top bar's mode (Read-only, and Allow all after its confirmation), Escape at each step; screenshots at 1440x900 and 1280x800 [US3; FR-082]
- [x] T023 Real-git test `scripts/test-newfolder-git.ts` + `test:newfoldergit`: init (no remote, no hook marker, parent repository's planted config not run), git missing; skipped without git except under `CI` [US3; D4, D5]
- [x] T024 Docs: README (feature, entry points, the top bar's mode as for Add existing, known limits), `changelog.d/093-create-folder-p1.md`, spec ticks and `[IMPLEMENTED]` tags; `npm run shots:docs` for linked pictures that show + Folder [FR-090]

## Phase 2: Clone (PR 2)

- [x] T030 [P] `newfolder.ts`: `checkCloneUrl`, `suggestedName`, `gitFailureText`, `parseCloneProgress` [FR-011, FR-020..FR-023, FR-040, FR-071]
- [x] T031 [P] `test-newfolder.ts`: the URL corpus (at least 40 refused, the accepted list), suggested names, failure texts, progress parsing [FR-020..FR-023; SC-002]
- [x] T032 `gitCreateCall({kind:'clone'})`: argv (`--progress --no-recurse-submodules -- <url> .`), the `-c` list, env (`GIT_ALLOW_PROTOCOL=https:ssh`, `GIT_TERMINAL_PROMPT=0`, conditional `GIT_SSH_COMMAND`), `protocols` parameter defaulting to https/ssh (the seam); `readUserSshCommand` [FR-031..FR-033, FR-095]
- [x] T033 `test-gitstatus.ts`: clone argv/env pinned, both `core.sshCommand` cases, default protocols [FR-031..FR-033, FR-095]
- [x] T034 Op: clone path, progress throttle (250 ms, last 6 lines, masked with `maskSecretUrl` + `maskHomePaths`, 300 chars), cancel after `close`, quit during a clone, submodule note, the user's filter drivers left on (Q5 agent default) [FR-036, FR-037, FR-040..FR-043, FR-070, FR-071]
- [x] T035 `test-newfolderop.ts`: clone cases incl. masking (`https://u:secret@h` never in an event or error), cancel order, quit [FR-040..FR-043, FR-070]
- [x] T036 IPC: `folders:createCancel` and the `folders:createProgress` event; wiring test: a refused URL never reaches `mkdir` or `spawn`; the handler's call uses https/ssh only [FR-080, FR-095]
- [x] T037 Real-git tests of plan *Testing* 3 for clone: seam clone, hooks, parent config, submodule, production call refuses `file://` and `ext::`, closed port, cancel against a silent local listener, ssh stub (POSIX), all leaving no folder [US1, US2, US4; SC-003..SC-005]
- [x] T038 Window: URL dialog with early check, progress dialog (`.hs-log`, live region, elapsed time, Cancel/Escape), result toast; simulator fakes for progress and cancel [FR-003, FR-040, FR-041, FR-082]
- [x] T039 Driver `shots-093.js` phase 2 cases: refused URL message, progress, Cancel, cloned room; screenshots at both sizes [US1, US2, US4]
- [x] T042 Real-git protocol layer test (plan *Testing* 3, R1): global `protocol.file/ext.allow=always` and `insteadOf` rewrites in the test `HOME`; the production call refused (i) as built, (ii) without `GIT_ALLOW_PROTOCOL`, (iii) without the per-transport nevers; `foo::` helper case [FR-032, FR-033; SC-003]
- [x] T043 Real-git cleanup-through-links test (POSIX): symlinks to an outside folder and file survive a failed or cancelled clone; `[KNOWN GAP]` Windows junctions [FR-050]
- [x] T044 Env pass-through of `GIT_SSL_CAINFO`/`GIT_SSL_CAPATH` (absolute only), the D11 `BatchMode` rule for a user `core.sshCommand`, `transfer.bundleURI=false`, the TLS/proxy hint, the 30 s waiting line; tests [FR-032, FR-033, FR-044, FR-071]
- [x] T045 Clone + *Allow all*: the confirmation, shown after the URL dialog, adds "This code comes from <host>; agents can run it without asking." (host from `checkCloneUrl`, never the user part); empty folder and new repository unchanged; driver case and an escaping test with a hostile host-like string [FR-061; Q6 = a, owner 2026-10-27]
- [ ] T040 Plant the mutants of plan *Mutants*; each fails a test; list them in the PR [SC-006]
- [ ] T041 Docs: README *Safety model* (what clone runs, the user's credentials, hooks note, BatchMode, the dropped `GIT_*` variables and the two that pass, "keep git up to date" and no version floor), `changelog.d/093-create-folder-p2.md` (named after the branch, as `changelog.d/README.md` asks), spec ticks, screenshots [FR-035, FR-090]

## Phase 3: Real check and converge (PR 3)

- [ ] T050 Hand check on each OS available (no AI credits; owner's OK for the accounts used): https clone through the OS credential helper, ssh clone with an agent, a cancel; record as `real:` with git version and OS [Assumptions]
- [ ] T051 `/speckit-converge`; `[KNOWN GAP]`s carried to the README; specs-index status

# Feature Specification: Simulator and developer/test hooks

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: index
title: Simulator and dev/test hooks
status: implemented; delta 2026-10-19: one event shape check for the simulator and adapters (FR-021)
-->

**Feature Branch**: `010-simulator` (reverse-engineered; milestones 2-6)
**Created**: 2026-10-16
**Status**: Implemented (reverse-engineered from `src/renderer/sim.ts`, `main.ts`, `scripts/e2e-driver.js`, README, CONTRIBUTING)
**Input**: "Develop and test the whole UI with 10-15 fake agents and no AI credits, through the same code path as real agents."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 15 simulated agents, zero credits (Priority: P1)

`DURBAR_SIM=15 npm start` (or `dist/renderer/index.html?sim=15` in a browser) shows 15 agents in several rooms with working/thinking/waiting/error/done/idle states, helpers, usage and canned chat turns; no session starts.

**Acceptance Scenarios**:

1. **Given** `DURBAR_SIM=15`, **When** the app starts, **Then** 15 desks show and the badge reads "Simulated agents" with the tooltip "Fake events, no sessions started, no AI credits used". *(re-verified 2026-10-16: 15 desks, Electron under xvfb)*
2. **Given** `DURBAR_SIM_FREEZE=1`, **When** running, **Then** no background activity ticks (stable screenshots). *(read:; frozen runs were used for the 2026-10-16 measurements)*
3. **Given** `?seed=N`, **When** loaded, **Then** the roster activity is reproducible (seeded `mulberry32`, default 7). *(read:)*

---

### User Story 2 - Exercise every UI feature without a login (Priority: P1)

The simulated bridge implements the whole `DurbarApi`: send (canned turn), stop, end, permission approve/deny/remember/revoke, attachment staging, model list, new session, hide/remove folders, previous sessions, resume, VS Code chat list/view.

**Acceptance Scenarios**:

1. **Given** a simulated agent waiting for permission, **When** I Approve for this session, **Then** the chip appears and the next matching request is auto-approved. *(sim:, screenshots m5-perm-*)*
2. **Given** "Resume" on the sample folder, **When** pressed, **Then** a canned history replays. *(sim:)*

---

### User Story 3 - Repeatable screenshots and scripted UI runs (Priority: P2)

Developers capture screenshots at fixed sizes and drive the real window with scripts.

**Acceptance Scenarios**:

1. **Given** `DURBAR_SHOT=/tmp/out.png DURBAR_SHOT_SIZE=1280x800 [DURBAR_SHOT_CLICK=sim-1] DURBAR_SIM=15 npm start`, **When** run, **Then** a PNG of the window is written and the app quits. *(read:; same hook family re-verified through `DURBAR_DRIVER`)*
2. **Given** `DURBAR_DRIVER=<script>`, **When** the window has loaded, **Then** the script receives `{ win, addMany, js, sleep, shot, waitFor }` and the app exits when it finishes. *(re-verified 2026-10-16 with `specs/001-.../quickstart.md`)*

---

### Edge Cases

- `?sim=` values are clamped to 1-40; the demo `n` parameter to 8-15. `[IMPLEMENTED]` read:
- Under `prefers-reduced-motion` or `simfreeze` no timers animate. `[IMPLEMENTED]` read:
- Simulated attachments never touch the disk in the simulator; staging is faked. `[IMPLEMENTED]` read:
- The **Demo** toggle (static sample office) still works next to the simulator. `[IMPLEMENTED]` read:

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** `[IMPLEMENTED]` re-verified 2026-10-16: The simulator emits **normalized `AgentEvent`s** through the same `onLiveEvent` path as the Copilot adapter (it implements `DurbarApi`); no Electron main logic, SDK or network is involved.
- **FR-002** `[IMPLEMENTED]` read: Options: `sim=N`, `simfreeze=1`, `simrooms=solo`, `seed=N`, `density=full|roomy|card|mini|micro` (forces a density), `open=<agent id>`, `view=list`, `n=` (demo roster size).
- **FR-003** `[IMPLEMENTED]` read: Electron env mapping: `DURBAR_SIM`, `DURBAR_SIM_FREEZE`, `DURBAR_SIM_ROOMS` -> query string.
- **FR-004** `[IMPLEMENTED]` read: Other hooks: `DURBAR_USER_DATA` (isolate userData/saved folders; it wins over the default profile folder, spec 008 FR-034, where a dev run otherwise uses `agent-durbar-dev`), `DURBAR_OPEN=a:b` and `DURBAR_PERM` (start agents on launch), `DURBAR_PICK=a:b` (answer the attach picker), `DURBAR_LOG=file.jsonl` (every normalized event and what is handed to the SDK), `DURBAR_VSCODE_USER_DIR` (point the chat reader at fixtures), `DURBAR_DRIVER` with `PHASES=dry|fake|ask|ro|att|m5|real`.
- **FR-005** `[IMPLEMENTED]` test: Synthetic fixtures for history and VS Code chat readers live in `scripts/fixtures/`; none contains real user data.
- **FR-006** `[IMPLEMENTED]` read: Real-session driver phases (`ask`, `ro`, `att`, `real`) spend credits and are run by hand only; `fake` and `m5` use synthetic events through the real main process and spend none.
- **FR-007** ~~`[KNOWN GAP]`~~ closed 2026-10-21 (see Changes): The simulator and e2e driver are **not run by `npm test` or CI**; UI regressions are caught only by hand. (Same gap as feature 001 FR-015.) (Task T020.)
- **FR-008** `[IMPLEMENTED]` (2026-10-19, T021) `scripts/e2e-driver.js` takes its paths from `E2E_DIR` (default `<temp>/durbar-e2e`), `E2E_SHOTS`, `E2E_LOGS`, `E2E_HELLO` and `E2E_NOTES`, and creates the shot and log folders. Before, it hard-coded `/workspace/...` paths. `read:`
- **FR-009** ~~`[KNOWN GAP]`~~ closed by FR-020 (see Changes): The dev hooks are compiled into **release builds** (they are environment-variable driven, with no `app.isPackaged` guard). `DURBAR_DRIVER` loads an arbitrary module into the main process and `DURBAR_LOG` writes event content to a file; anyone who can set the app's environment can already run code as the user, so the risk is low, but constitution III prefers dev-only hooks. `read:` (Task T022.)
- **FR-010** `[KNOWN GAP]` The simulator's behavior is hand-written and can drift from what the real adapter emits (for example it never reproduces real timing, SDK errors or sub-agent identity quirks). Real behavior is covered only in feature 013. `read:`
- **FR-011** `[IMPLEMENTED]` (2026-10-19, T021) `smoke.ts` defaults to `<temp>/durbar-test/{hello-app,notes-app}` (overridable with `SMOKE_FOLDERS`); before, it hard-coded `/workspace/durbar-test/...`. `read:` (not run: the smoke costs a prompt)

### Key Entities

- **SimAgent**: info, room, state, intent, prompt, helpers, files, pending permission, grants.
- **Driver context**: `{ win, addMany, js, sleep, shot, waitFor, createdAdapters }` (`createdAdapters()`, 2026-10-22: the adapters main has created, each `{ id, simBlocked }`).

## Success Criteria *(mandatory)*

- **SC-001**: Starting the app with `DURBAR_SIM=15` creates no Copilot, Claude Code or Codex adapter, client or session, and no IPC call from the window (simulator bridge or real preload API) reaches one (2026-10-22: FR-022..FR-026; `test:` `test:simguard`, `sim:` `check:sim-guard`). Before that delta: read only, the adapter was created and `getClient` was lazy.
- **SC-002**: A developer can reproduce the 1440x900 and 1280x800 screenshots in the README with the documented commands (sim:).

## Assumptions

- Developers have `xvfb-run` on Linux for headless runs; macOS/Windows developers use a visible window.

## Changes

- **2026-10-17, spec 033 (floors), cross-reference.** `DURBAR_SIM_FLOORS=1` (`?simfloors=1`) seeds three floors and spreads the rooms over them; `DURBAR_SIM_FLOORS_OFF=<names>` (`?floorsoff=`) starts them off. The simulator's `+ Folder` now registers the new folder as a simulated (idle) agent so it has a floor and can be moved; it still sends no events until you write to it.

### 2026-10-16: dev/test hooks are ignored in packaged builds (audit gap 2; closes FR-009 and T022)

**What was wrong.** Every `DURBAR_*` environment variable was honored by release builds. `DURBAR_DRIVER` loads an arbitrary module into the main process, `DURBAR_LOG` writes event content to a file, `DURBAR_OPEN`/`DURBAR_PERM` start agents (with a chosen permission mode) on launch, `DURBAR_PICK` answers the attachment picker without a dialog, `DURBAR_USER_DATA` redirects the profile. Anyone who can set the app's environment already runs code as the user, so the risk is low, but a shipped app should not carry a back door (constitution III).

**What is now required.**

- **FR-017** Dev/test hooks are the variables `DURBAR_SIM`, `DURBAR_SIM_FREEZE`, `DURBAR_SIM_ROOMS`, `DURBAR_USER_DATA`, `DURBAR_OPEN`, `DURBAR_PERM`, `DURBAR_PICK`, `DURBAR_LOG`, `DURBAR_DRIVER`, `DURBAR_SHOT`, `DURBAR_SHOT_SIZE`, `DURBAR_SHOT_CLICK`, `DURBAR_VSCODE_USER_DIR`, `DURBAR_COPILOT_DIR` (every `DURBAR_*` name; the list is not an allow-list, so new hooks are covered automatically).
- **FR-018** When `app.isPackaged` is true, **all** `DURBAR_*` variables are ignored, unless the explicit opt-in `DURBAR_DEV=1` (exactly the string `1`) is set. When the app is not packaged (`npm start`, `electron .`), behavior is unchanged and `DURBAR_DEV` is not needed.
- **FR-019** One module, `src/main/devhooks.ts` (pure, no Electron import), decides: `devEnv(env, isPackaged)` returns the variables the app may read. Main-process code reads hooks only from that object (never `process.env.DURBAR_*` directly). A packaged app started with `DURBAR_DEV=1` writes one line to stderr saying that developer hooks are active.
- **FR-020** Test: `npm run test:devhooks` (in `npm test`) checks the matrix (packaged/unpackaged x `DURBAR_DEV` unset/`1`/`true`/`0`) and scans `src/main` and `src/adapters` so that no file except `devhooks.ts` reads `process.env.DURBAR_*`. `[KNOWN GAP]` The simulator in a **plain browser** (`?sim=15` on `dist/renderer/index.html`) is not an Electron hook and stays available; it has no Node or bridge access.
- **Documented**: README "Developer hooks" and CONTRIBUTING say that packaged builds ignore the hooks, and how to turn them on (`DURBAR_DEV=1`) for debugging a release build. This is a developer switch, not a user feature.

### 2026-10-17: spec 024 simulator changes (cross-reference)

For spec [024](../024-office-places/spec.md): `bash`, `github`, `playwright` and `my-notes` calls take 1.5-4 s (seeded) unless the simulator is frozen, and the calls agents leave open take turns between those four. A simulator-only test hook `window.__durbarSimEmit(event)` lets a driver send one normalized event (used by `scripts/shots-024.js`); it exists only in simulator mode, which packaged builds do not start without `DURBAR_DEV=1`.

### 2026-10-19: one event shape check for the simulator and the adapters (sweep; task T023)

- **FR-021** `[IMPLEMENTED]` `src/adapters/eventguard.ts` (`eventProblems`) checks the normalized events: a known type, `sessionId`, `timestamp`, and the fields the renderer relies on per type (status values, tool call phases, non-negative usage numbers, a dollar figure only as an `estimate`, question and agent-profile shapes, and so on). `test:` `npm run test:simevents` runs the real simulator (three rosters, a question, a title, an unreported folder, one-agent folders) with fast timers, drives sends, mode switches and agent profiles, and requires every event to pass (11,210 events, 14 types, on 2026-10-19); the adapter contract suite applies the same check to every event of every registered adapter (fakes, Copilot, Claude, Codex). This narrows FR-010 (drift between the simulator and real adapters) to timing and behaviour; event shapes can no longer drift silently.

### 2026-10-21: known gaps revalidated

- **FR-007** closed. The simulator runs in CI:
  - `check:office` (15 agents at 1440x900 and 1280x800) and the theme geometry check run on every PR on Linux;
  - with #389 (in review), they also run on macOS and Windows runners, together with 18 simulator drivers (`scripts/ui-suite.js`).
- **FR-009** closed by FR-020: `npm run test:devhooks`, in `npm test`, checks that a packaged build ignores the dev hooks.
- **FR-010** narrowed. The real-account e2e (spec 062) now runs the real adapters on three OSes, which catches drift in the events those turns produce. Timing, errors and long sessions are still the simulator's own.

### 2026-10-22: the simulator never reaches a real agent app (incident on PR #505; tasks T024..T028)

**What was wrong.** Under `DURBAR_SIM` only the renderer is simulated: `app.js` swaps its `bridge` for the simulator, but the Electron main process keeps answering every IPC channel with the real adapters. On 2026-10-22 a simulator driver for PR #505 ran `bridge.generateProfile(...)` through the driver's `js()`. A page expression from a driver does not see `app.js`'s `const bridge`; the name resolved to the real preload API (`window.agentDurbar`), so main ran the real `profiles:generate` and spent 3-6 unintended Claude haiku prompts (`real:`; see `docs/agent-notes.md`). Every channel that starts or talks to an agent app had the same hole (`theme:generate`, sessions, resume, sign-in, installs, MCP calls, ...). The same was true outside IPC: the scheduler started on the profile's saved schedules, and `DURBAR_OPEN` started real sessions, under the simulator too. Constitution IV (no AI credits in development and tests) was only kept by the renderer's good behaviour.

**What is now required.** Defense in depth, decided in main, so that a page script, a driver or a future feature cannot get around it:

- **FR-022** `[IMPLEMENTED]` One definition of simulator mode for the main process: `simulatorOn(dev)` in `src/main/simguard.ts` (pure, no Electron) is true when the dev hook `DURBAR_SIM` (read through `devEnv`, FR-019) is a whole number above 0, the same rule the window uses to start the simulator (`main.ts` puts `?sim=N` on the page only then). A packaged build without `DURBAR_DEV=1` never has it (FR-018). `test:` `test:simguard`.
- **FR-023** `[IMPLEMENTED]` **IPC: default deny.** In simulator mode `ipcHandle` refuses every channel (it throws `The simulator never starts or talks to a real agent app ("<channel>" is refused under DURBAR_SIM). Run a real check without DURBAR_SIM.`) and `ipcOn` drops every message, **before** the handler runs, except the channels on the short allow list `SIM_OPEN_CHANNELS` in `simguard.ts`, each with its reason. Today the list holds one channel: `harness:plans` (the simulator asks main for this OS's install routes, spec 060 FR-002; main answers from the simulated managers and runs nothing). The check sits in `src/main/ipcguard.ts` next to the sender check (spec 045 FR-004), so a new channel is covered without anyone remembering it. A default deny was chosen over a list of "spending" channels because a handler reaches an agent app through helpers whose names do not show it (`stopTurnOp`, `prevSessions.delete`, `explain`, ...), and the simulator's window does not call main at all (it has its own canned answers in `sim.ts`).
  Channels that start or talk to an agent app, its account, its CLI or its session files, all refused (the list `test:simguard` checks one by one; profiles from PR #505 are covered automatically when they land):
  `theme:generate`, `folderSetup:explain` (one-shot `generateText` prompts); `agents:addFolder`, `agents:addWorkspaceFile`, `agents:newSession`, `agents:send`, `agents:wake`, `sessions:resume` (start or resume a session); `agents:stop`, `agents:end`, `agents:compact`, `agents:handoff`, `agents:setModel`, `agents:cancelQueuedModel`, `agents:setMode`, `agents:setCap`, `agents:resolvePermission`, `agents:resolvePlan`, `agents:resolveLimit`, `agents:revokeGrant`, `agents:answerQuestion`, `agents:answerElicitation`, `agents:listProfiles`, `agents:selectProfile`, `agents:mcp`, `agents:setMcp`, `agents:setRemote`, `agents:openRemote` (talk to a live session); `sessions:listPrevious`, `sessions:rename`, `sessions:delete` (the agent app's own session store); `adapters:list`, `models:list` (run the CLIs and their sign-in check); `harness:run`, `harness:paste`, `harness:cancel`, `harness:copilotAuth`, `harness:openSignIn` (installs and sign-in); `schedules:runNow` (sends a prompt).
  Every other channel (settings, floors, MCP lists, usage, themes on disk, ...) is refused too: under the simulator it would change the real profile behind a simulated window.
- **FR-024** `[IMPLEMENTED]` **Adapters: never constructed.** In simulator mode `main.ts` builds its adapter registry through `simGuardDescriptors(descriptors, on)`: each descriptor's `create` returns an inert stand-in (same `id`, `displayName`, `capabilities`; `isLive` false; `onEvent` and `dispose` do nothing) whose every other member throws the FR-023 refusal. The real `create` (Copilot client, Claude Code, Codex) is never called, so a path that does not come through IPC (a restored folder, a future timer, a driver's `addMany`) cannot start a real agent app either. `test:` `test:simguard` (a spy descriptor's `create` is never called; every method of the stand-in throws).
- **FR-025** `[IMPLEMENTED]` **No real work on launch under the simulator:** the scheduler is created (its saved list is read) but not started, and `DURBAR_OPEN` is ignored, with one line on stderr for each.
- **FR-026** `[IMPLEMENTED]` **Tests that make it impossible to forget.** `npm run test:simguard` (in `npm test`, no Electron, no credits): (1) loads the real `ipcguard.ts` with a stand-in `electron`, registers every channel the preload calls, and checks that under `DURBAR_SIM=15` each one except `SIM_OPEN_CHANNELS` is refused without its handler running, while without `DURBAR_SIM` (and with `DURBAR_SIM=0` or text) the same calls reach their handlers; (2) checks that every channel in the FR-023 list is registered and not on the allow list, and that an allowed channel's handler names no adapter, router, `addWorkspace`, `generateText`, `spawn` or install run; (3) checks `main.ts` builds the registry through `simGuardDescriptors` and gates the scheduler and `DURBAR_OPEN` on `simulatorOn`; (4) the stand-in adapter (FR-024). The driver `scripts/check-sim-guard.js` (in `scripts/ui-suite.js`, so CI runs it on Linux, macOS and Windows; `npm run check:sim-guard`) calls the **real** preload API from the page under `DURBAR_SIM=15`: `generateTheme`, `explainFolderSetup`-style one-shots, `addFolder`, `newSession`, `resumeSession`, `harnessRun`, `send` and `listAdapters` are refused with the FR-023 message, `harnessPlans` still answers, and the main process has created no adapter (`ctx.createdAdapters()` is empty or holds only stand-ins).
- **FR-027** `[IMPLEMENTED]` **Real checks are unaffected.** The deliberate real-check scripts (`scripts/*-real.ts`, `smoke.ts`, `capture-raw.ts`, the `e2e-driver.js` phases that spend credits) never set `DURBAR_SIM`, so nothing changes for them. There is **no override** that lets a simulator run reach a real agent app: a real check runs without `DURBAR_SIM`, and says how many prompts it costs first (constitution IV). `read:` (grep of `scripts/`; the real scripts were not run for this change).
- **Documented**: `docs/agent-notes.md` (the driver trap: a page expression's `bridge` is the real preload API; it is now refused in main, but drivers should still drive the UI), README *Development*.

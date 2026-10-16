# Feature Specification: Simulator and developer/test hooks

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
- **FR-004** `[IMPLEMENTED]` read: Other hooks: `DURBAR_USER_DATA` (isolate userData/saved folders), `DURBAR_OPEN=a:b` and `DURBAR_PERM` (start agents on launch), `DURBAR_PICK=a:b` (answer the attach picker), `DURBAR_LOG=file.jsonl` (every normalized event and what is handed to the SDK), `DURBAR_VSCODE_USER_DIR` (point the chat reader at fixtures), `DURBAR_DRIVER` with `PHASES=dry|fake|ask|ro|att|m5|real`.
- **FR-005** `[IMPLEMENTED]` test: Synthetic fixtures for history and VS Code chat readers live in `scripts/fixtures/`; none contains real user data.
- **FR-006** `[IMPLEMENTED]` read: Real-session driver phases (`ask`, `ro`, `att`, `real`) spend credits and are run by hand only; `fake` and `m5` use synthetic events through the real main process and spend none.
- **FR-007** `[KNOWN GAP]` The simulator and e2e driver are **not run by `npm test` or CI**; UI regressions are caught only by hand. (Same gap as feature 001 FR-015.) (Task T020.)
- **FR-008** `[KNOWN GAP]` `scripts/e2e-driver.js` hard-codes `/workspace/...` paths (`SHOTS`, `HELLO`, `NOTES`, log file) and is therefore not runnable elsewhere without edits. `read:` (Task T021.)
- **FR-009** `[KNOWN GAP]` The dev hooks are compiled into **release builds** (they are environment-variable driven, with no `app.isPackaged` guard). `DURBAR_DRIVER` loads an arbitrary module into the main process and `DURBAR_LOG` writes event content to a file; anyone who can set the app's environment can already run code as the user, so the risk is low, but constitution III prefers dev-only hooks. `read:` (Task T022.)
- **FR-010** `[KNOWN GAP]` The simulator's behavior is hand-written and can drift from what the real adapter emits (for example it never reproduces real timing, SDK errors or sub-agent identity quirks). Real behavior is covered only in feature 013. `read:`
- **FR-011** `[KNOWN GAP]` `smoke.ts` hard-codes `/workspace/durbar-test/...` default folders (overridable with `SMOKE_FOLDERS`). `read:`

### Key Entities

- **SimAgent**: info, room, state, intent, prompt, helpers, files, pending permission, grants.
- **Driver context**: `{ win, addMany, js, sleep, shot, waitFor }`.

## Success Criteria *(mandatory)*

- **SC-001**: Starting the app with `DURBAR_SIM=15` creates no Copilot client or session (read: the adapter is created but `getClient` is lazy and the simulator replaces the bridge in the renderer).
- **SC-002**: A developer can reproduce the 1440x900 and 1280x800 screenshots in the README with the documented commands (sim:).

## Assumptions

- Developers have `xvfb-run` on Linux for headless runs; macOS/Windows developers use a visible window.

## Changes

### 2026-10-16: dev/test hooks are ignored in packaged builds (audit gap 2; closes FR-009 and T022)

**What was wrong.** Every `DURBAR_*` environment variable was honored by release builds. `DURBAR_DRIVER` loads an arbitrary module into the main process, `DURBAR_LOG` writes event content to a file, `DURBAR_OPEN`/`DURBAR_PERM` start agents (with a chosen permission mode) on launch, `DURBAR_PICK` answers the attachment picker without a dialog, `DURBAR_USER_DATA` redirects the profile. Anyone who can set the app's environment already runs code as the user, so the risk is low, but a shipped app should not carry a back door (constitution III).

**What is now required.**

- **FR-017** Dev/test hooks are the variables `DURBAR_SIM`, `DURBAR_SIM_FREEZE`, `DURBAR_SIM_ROOMS`, `DURBAR_USER_DATA`, `DURBAR_OPEN`, `DURBAR_PERM`, `DURBAR_PICK`, `DURBAR_LOG`, `DURBAR_DRIVER`, `DURBAR_SHOT`, `DURBAR_SHOT_SIZE`, `DURBAR_SHOT_CLICK`, `DURBAR_VSCODE_USER_DIR`, `DURBAR_COPILOT_DIR` (every `DURBAR_*` name; the list is not an allow-list, so new hooks are covered automatically).
- **FR-018** When `app.isPackaged` is true, **all** `DURBAR_*` variables are ignored, unless the explicit opt-in `DURBAR_DEV=1` (exactly the string `1`) is set. When the app is not packaged (`npm start`, `electron .`), behavior is unchanged and `DURBAR_DEV` is not needed.
- **FR-019** One module, `src/main/devhooks.ts` (pure, no Electron import), decides: `devEnv(env, isPackaged)` returns the variables the app may read. Main-process code reads hooks only from that object (never `process.env.DURBAR_*` directly). A packaged app started with `DURBAR_DEV=1` writes one line to stderr saying that developer hooks are active.
- **FR-020** Test: `npm run test:devhooks` (in `npm test`) checks the matrix (packaged/unpackaged x `DURBAR_DEV` unset/`1`/`true`/`0`) and scans `src/main` and `src/adapters` so that no file except `devhooks.ts` reads `process.env.DURBAR_*`. `[KNOWN GAP]` The simulator in a **plain browser** (`?sim=15` on `dist/renderer/index.html`) is not an Electron hook and stays available; it has no Node or bridge access.
- **Documented**: README "Developer hooks" and CONTRIBUTING say that packaged builds ignore the hooks, and how to turn them on (`DURBAR_DEV=1`) for debugging a release build. This is a developer switch, not a user feature.

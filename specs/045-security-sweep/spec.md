# Feature Specification: Security and quality sweep before v0.1.0-alpha.6

**Feature Branch**: `045-security-sweep`
**Created**: 2026-10-19
**Status**: Built (2026-10-19)
**Input**: Vikram, 2026-10-19: "look at all security and quality issues and add it to pre release". The sources were GitHub code scanning (30 open CodeQL alerts), Dependabot (1 open alert) and `npm audit` (8 moderate findings, all one chain).

## Triage

| Source | Alerts | Where | Decision |
| --- | --- | --- | --- |
| CodeQL `js/biased-cryptographic-random` (high) | #32 | `src/main/settings.ts` `randomPlaceId` | **Fix** (FR-001) |
| CodeQL `js/double-escaping` (high) | #1 | `src/renderer/app.js` remove-folder confirm | **Fix** (FR-002) |
| CodeQL `js/shell-command-injection-from-environment` (medium) | #31 | `src/main/vscode.ts` (and the same pattern in `src/adapters/detect.ts`) | **Fix** (FR-003). The scan still flags that the path to Windows' own `cmd.exe` comes from `SystemRoot`, as Windows itself uses it. Dismissed as "won't fix" with that reason. |
| CodeQL `js/incomplete-url-substring-sanitization` (high) | #33 | `scripts/test-codex-modes.ts` | False positive: a test assertion that a summary string mentions a host, not a URL check. Dismissed with that reason. |
| CodeQL `js/bad-code-sanitization` (medium) | #2-#30 | `scripts/e2e-driver.js`, `scripts/shots-*.js` | Dev-only simulator drivers. They build page code from constants with `JSON.stringify` and run it in the local test window; nothing comes from outside. Dismissed as "used in tests". |
| Own review: Electron window | - | `src/main/main.ts` | `will-navigate` let the window load **any** `file://` page, which would get the preload bridge; Electron **grants** web permissions (camera, microphone, notifications, ...) unless a handler says no. **Fix** (FR-004, FR-005). Already right: `contextIsolation`, `sandbox`, no `nodeIntegration`, new windows denied, a CSP without remote sources, `openExternal` only for http(s). |
| Dependabot / `npm audit`: `sprintf-js` 1.1.3 DoS (moderate) | Dependabot #1, 8 audit lines | build-time only: `electron-builder` > `app-builder-lib` > `@electron/get` > `global-agent` > `roarr` > `sprintf-js` | **Not shipped in the app** and **no patched version exists**. The suggested `electron-builder` "fix" is an old major. Kept, recorded here and in the release notes; dismissed as tolerable risk. |

## Requirements

- **FR-001** `randomPlaceId` draws each of its six characters with `crypto.randomInt(36)`, which is uniform. Before, `randomBytes` modulo 36 favoured the first 4 characters (256 = 7 × 36 + 4). The id shape is unchanged (`c-` + 6 of `[a-z0-9]`). `test:` shape and alphabet over many draws.
- **FR-002** The remove-folder confirmation turns its escaped text back into plain text in **one pass** (`&amp;`, `&lt;`, `&gt;`, `&quot;` each read once). Before, four chained replacements turned `&amp;lt;`, a folder name with `&lt;` in it, into `<`. `test:` the unescape helper on such names.
- **FR-003** On Windows, the `cmd.exe` used for a `.cmd` shim (VS Code's `code.cmd`, spec 009; agent CLIs' `.cmd` shims, spec 012 FR-036) is `%SystemRoot%\System32\cmd.exe` when `SystemRoot` is an absolute path. `ComSpec` is used only when it is an absolute path to a file named `cmd.exe`; otherwise plain `cmd.exe`. Before, any `ComSpec` value from the environment was run. `test:` the choice for each of these inputs.

- **FR-004** The window navigates (`will-navigate`, `will-redirect`) only to the app's own `index.html`, with any query or hash. Any other `file://` page and any web page is refused. `test:` allowed and refused URLs on Linux and Windows paths. `sim:` in Electron, `location.href = 'file:///tmp/…html'` left the app on its own page.
- **FR-005** Web permission requests and checks are refused, except `clipboard-sanitized-write`, which the Copy buttons need (spec 005 FR-015). `test:` the allow list. `sim:` in Electron, the microphone gave `NotAllowedError`, notifications gave `denied`, and a reply's Copy button still put the reply on the clipboard. *Amended 2026-10-20 by spec 052 FR-059:* `notifications` is allowed too, for the "needs you" notification (agent name and a short summary only).

## Honest limits

- FR-003 and FR-004's Windows paths are unit-tested only; Windows was not run by hand (as for every Windows path in this project).
- The dismissed alerts stay listed here, so the reasons are in the repository, not only on GitHub.

## Changes

- **2026-10-20 (issue #332, from the round-7 security review):** **FR-008** every IPC handler in the main process is registered through `ipcHandle` / `ipcOn` (`src/main/ipcguard.ts`), which answer only the app's own page in the window's main frame (`senderAllowed`). A call from anywhere else is rejected before it reaches the handler, so a new handler cannot forget the check. This is defense in depth: the sandbox, the navigation guard, the deny-all window-open handler and the CSP already keep other pages and frames out. `test:` `scripts/test-wincmd.ts` fails if any file in `src/main` registers on `ipcMain` directly; `sim:` the welcome driver passes on the real bridge. `[KNOWN GAP]` The check itself needs Electron, so it is not unit-tested; the rule it applies (`senderAllowed`) is.

- **2026-10-21, `main.ts` split into IPC modules (issue #411, task T021).** Tech debt from the 2026-10-21 audit; decided by the coordinator under Ruben's delegation. `src/main/main.ts` is about 1,600 lines with about 93 `ipcHandle` registrations next to window, store and adapter setup.
  - **FR-060** Each IPC group moves out of `main.ts` into `src/main/ipc/<area>.ts`, exporting one `register(deps)` (the pattern `src/main/mcpipc.ts` already uses): sessions and agents (start, send, stop, mode, cap, limit), schedules, harness setup, remote control, previous sessions, settings and themes, usage, and any other cohesive group found. `main.ts` keeps app start-up, windows, stores and the calls to each `register`.
  - **No behaviour change.** Every handler keeps its channel name, its arguments and its result, and every `fromApp(e)` check stays exactly where it is (the checkpoint, schedule and other owner-only paths: FR-005 of 065 and similar). Registration stays through `ipcHandle` / `ipcOn` (FR-008); the existing `test-wincmd` check that nothing in `src/main` registers a raw `ipcMain.handle` / `ipcMain.on` keeps passing, now also over `src/main/ipc/`.
  - **Test:** a new unit test lists every channel the renderer can call (from `src/preload`), checks that each is registered exactly once across `src/main` (no channel lost or registered twice by the move), and that every registration in `src/main/ipc/` goes through `ipcHandle`/`ipcOn` (like `test-prevsessions` does for `sessions:delete`). The channels whose handler calls `fromApp(e)` before the move still call it after (a static list in the test, compared by channel).

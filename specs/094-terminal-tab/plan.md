# Implementation Plan: A Terminal tab in the chat, one shell per folder

**Branch**: spec on `094-terminal-tab`; code on `094-pN-slug`, one PR per phase | **Date**: 2026-10-27 | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)

## Summary

Add a third tab, **Terminal**, to the chat's tablist (spec 080). Main owns one PTY per folder key (`workspaceFile ?? cwd`) through `node-pty`, spawned with an argument array in the folder (first listed root for a workspace), with an environment built from a start-up snapshot minus Durbar's and Electron's internals. The window draws it with xterm.js (vendored from npm into `dist/renderer/vendor/`, CSP unchanged) through a narrow, `fromApp`-checked IPC keyed by agent id. Terminals outlive the tab, the chat and the office view, and end by their close button, folder removal or quit (the existing quit question counts busy terminals). Nothing is logged or saved. The simulator uses a fake PTY in main; every rule is tested in Node with an injected PTY factory.

## Technical Context

**Language/Version**: TypeScript (main, preload, shared), plain-script JavaScript (renderer, UMD pure helpers like `browserpane.js`).
**Primary Dependencies (new, runtime)**: `node-pty` (exact pin, spec Q7; why: Node has no PTY, and a shell without a PTY has no prompt, line editing, colours or job control), `@xterm/xterm` 6.0.0 and `@xterm/addon-fit` 0.11.0 (exact pins; why: a terminal emulator for the page, the de facto standard, MIT, no dependencies). Constitution "new runtime dependencies need a line in the plan": these three lines.
**Storage**: none. Memory only (xterm buffer 5,000 lines; main's replay buffer 256 KB per terminal). No settings key in this version.
**Testing**: Node unit tests with a fake PTY (`scripts/test-terminal*.ts`), a simulator driver (`scripts/check-terminal-tab.js`), `test:ipcchannels`, `test:simguard`, `test:globals`, `test:innerscroll`, `test:theme`; packaged check loads the real module (nightly/on demand). 0 AI credits.
**Target Platform**: Electron 44 on Windows (x64), macOS (arm64, x64), Linux (x64 AppImage).
**Performance Goals**: prompt visible within 1 s of selecting the tab (simulator); output batched at 16 ms; a `yes` flood keeps the window responsive (flow control).
**Constraints**: constitution III (argv only, no secrets, IPC validated, sandboxed renderer), V (10.5px, office unchanged), VI (parity), VIII (honest limits).

## Constitution Check

- **I Spec first**: this folder (spec, plan, research, tasks) is committed before any `src/` change; each phase PR changes `specs/094-*`.
- **II Adapters**: nothing in `src/adapters` or `AgentAdapter` changes; the terminal is not an agent. A static test keeps terminal modules out of adapters, the MCP server and other IPC modules (spec FR-015).
- **III Safe by default, no secrets** (non-negotiable):
  - "Never spawn a process through a shell with user-controlled text": Durbar spawns the user's shell with a fixed argument array chosen by a pure, tested function (spec FR-010, FR-011); it never builds a command line and never types into the terminal. What the user types goes into a PTY as keystrokes, as in any terminal app; that is the user acting, not Durbar running user text. No amendment needed.
  - The permission modes and the agent apps' OS sandbox (spec 087) govern agents; the pane and the README say plainly that neither applies to the user's own shell, and that "agents can't see it" is about Durbar only: the shell may keep its own history file and its processes are visible like any other (spec FR-004, FR-017), as issue #807 asked.
  - What a program prints cannot reach the app, the clipboard or the window, and a paste cannot break out of bracketed paste (spec FR-060).
  - No secrets: env from a start-up snapshot minus `DURBAR_*`, `ELECTRON_*`, `CHROME_*`, Chromium's Google keys (spec FR-013); output never logged or stored (FR-014).
  - IPC: `fromApp` on every channel, agent id looked up in main, values validated and capped (FR-020); events only to the app window, never a broadcast or a browser view (FR-026); the renderer stays `contextIsolation`, `sandbox`, no Node, CSP unchanged.
- **IV No credits**: simulator fake PTY and unit tests; the only real process in CI is the packaged check's fixed command (no agent, no credits).
- **V Calm UI**: text at least 10.5px, tokens only, office untouched (the panel covers it), focus rules with `preventScroll`.
- **VI Parity**: one code path; OS differences isolated in pure functions (shell, busy, end, key policy) with injected platform and env (spec FR-055, tested statically).
- **VII Gates**: typecheck, build, `npm test`; screenshots at 1440x900 and 1280x800; new main logic tested.
- **VIII Honest limits**: `[KNOWN GAP]`s in the spec carried to the README; real-machine checks listed (research R7).

## 1. Code paths reused (file:line on `origin/main` 0f57c58f)

Full table in [research.md R1](research.md#r1-what-the-repo-already-has-for-this). The decisive ones:

| Need | Reuse | Change |
|---|---|---|
| Tablist and roving focus | `src/renderer/browserpane.js:14` `tabKey` (already takes a count), `:87` `tabsHTML`, `:108` `setSelected`, `:158` `select`, `:106` `startTab`, `:271` `mount`, `:308` `hide`, `:315` `current` | Move the tablist out of `browserpane.js` into a small `src/renderer/paneltabs.js` (pure model + DOM: which tabs exist for a chat, which is selected, roving focus, `on-<tab>` class on `.panel-in`). `browserpane.js` and the new `termpane.js` register as tab owners with `show()` and `leave()`. Spec 080's behaviour and `test-browserpane.ts` stay green; its `select('chat')` becomes "leave Browser". |
| Panel template | `src/renderer/app.js:2287` (tablist), `:2291` (pane), `:2302` `BP.mount(a)`, `:3008-3009` `closePanel` / `BP.hide()` | `PT.tabsHTML(a)`, `TP.paneHTML(a)`, `TP.mount(a)`, `TP.hide()` at the same spots |
| Chat log hidden off the Chat tab | `src/renderer/styles.css:862-863` | `.panel-in:not(.on-chat) #chat`, same for `.prev` |
| Tab-aware unread and Notes | `app.js:2228` `chatShownNow`, `notes.js:92` `showChatTab` | Read the tab from `paneltabs.js` |
| Global keys | every `document`/`window` keydown listener: `app.js:477` (capture), `:3060` (global keys; Esc at `:3119`, navigator `:3067`), `:3940` (spec 092 PageUp/PageDown), `:5762`, `:7341`, `:7411`; `dialog.js:76`, `screens.js:559`, `:780` (capture, only while their UI is open) | Not a guard inside `:3060`: xterm's `attachCustomKeyEventHandler` lets the app's keys through, and a bubble-phase listener on `#termView` stops propagation of every key that goes to the shell (pure `TP.keyGoesToShell(e, isMac, navCombo)`), spec FR-051, FR-056; a static test lists the global listeners |
| Main IPC shape | `src/main/ipc/browser.ts` (`register(deps)` + controller), `src/main/main.ts:746` | `src/main/ipc/terminal.ts` + `src/main/terminal/controller.ts` |
| Folder removal | `src/main/ipc/folders.ts:46` (`deps.browserGone`) | `deps.terminalGone(key)` |
| Quit | `main.ts:847` `workingCount`, `:859` `confirmQuit`, `:930` window close, `:1112` `before-quit` (its 3 s `capped` wait, `:1138`), `:1144` `will-quit`; `daily.ts:106` `quitMessage(n)` | `quitMessage(n, terminals)`; `terminals.endAll()` in `before-quit` after the confirm, inside the capped wait (2 s); `terminals.killRemaining()` (synchronous, guarded, no timer) in `will-quit` (spec FR-035) |
| Shell and env helpers | `loginpath.ts:28` `loginShellCommand`, `wincmd.ts:14` `windowsCmd`, `pathdirs.ts:8` `pathDirs`, `codex.ts:132` `codexChildEnv` (pattern), `detect.ts:423` `killChildTree` (Windows `taskkill /t /f`, and the exited guard before its `SIGKILL`, #721) | Called from `src/main/terminal/shell.ts`, `env.ts`, `kill.ts`; `killChildTree` gets the terminal wrapper `{pid, kill, exitCode, signalCode}` so its guard sees the PTY's exit |
| Events to the window | `main.ts:217` `toRenderer` (the app window's `webContents.send`); browser views get no preload (`hardening.ts:71` `viewWebPreferences`) | The terminal IPC module's only way out is an injected `send` that main wires to `toRenderer` (spec FR-026) |
| Dialog | `dialog.js:25` `askDialog` | Close-terminal question |
| Simulator gate | `ipcguard.ts:50` `ipcHandle`, `simguard.ts:28` `SIM_OPEN_CHANNELS` | Terminal channels with reasons |
| Vendored libs | `scripts/copy-assets.js` (marked, dompurify) | xterm files |
| Packaging | `package.json` `build` (`asarUnpack`, `files`, `npmRebuild: false`), `scripts/prepare-runtime.js`, `scripts/after-pack.js`, `scripts/pack-esm-check.js` | See section 2 |

**Lobby *Terminal* place**: stays decorative (spec Q6, recommended a). Reason: it shows agents running shell tools; it is one lobby for all folders, so it has no folder to open; and making it open the user's shell would mix the agents' picture with a user-only tool. If the owner picks (b), it opens the selected chat's Terminal tab and does nothing with no chat open.

**Not found (so new)**: a PTY, a terminal emulator, per-folder state in the window, a tablist with more than two tabs.

## 2. PTY dependency and packaging (decision: spec Q7, recommended a)

Facts in [research.md R2, R4, R5](research.md#r2-the-pty-package). What changes exactly:

| File | Change |
|---|---|
| `package.json` `dependencies` | `"node-pty": "1.2.0-beta.18"` (or the stable `1.2.0`), `"@xterm/xterm": "6.0.0"`, `"@xterm/addon-fit": "0.11.0"`, all exact |
| `package.json` `build.asarUnpack` | add `node_modules/node-pty/**` |
| `package.json` `build.files` | add `!node_modules/node-pty/{src,deps,third_party,scripts,typings}/**`, `!node_modules/node-pty/binding.gyp`, `!**/*.pdb`, `!node_modules/node-addon-api/**`, `!node_modules/@xterm/**` (the page loads the copies in `dist/renderer/vendor/`) |
| `package.json` `build` | `npmRebuild: false` and `nodeGypRebuild: false` **stay** (N-API: no Electron ABI rebuild) |
| `scripts/prepare-runtime.js` | after the Copilot step: keep only `node_modules/node-pty/prebuilds/<target>/`; when the target's dir is missing (a previous target's run removed it), restore it from `npm pack node-pty@<pinned>` like the Copilot package; Windows: keep or drop `conpty/` by the result of T016 (spec Q9 (c): kept only if `useConptyDll: true` is chosen) (R2) |
| `scripts/after-pack.js` | fail when `app.asar.unpacked/node_modules/node-pty/prebuilds/<target>/pty.node` is missing, another prebuild dir is present, (macOS) `spawn-helper` is missing or not executable, or (Windows, when T016 chose `useConptyDll: true`) `conpty/conpty.dll` or `conpty/OpenConsole.exe` is missing |
| `scripts/pack-esm-check.js` | inside the packaged main: `require('node-pty')`, spawn the platform shell from `shell.ts` with a fixed argv that exits at once (`['-c', 'exit 0']` POSIX, `['-NoLogo', '-NoProfile', '-Command', 'exit 0']` PowerShell), assert exit code 0 within 10 s. Then **end a terminal running a child** through the real `kill.ts` path (spec FR-037, T016): POSIX `['-c', 'sleep 30']`, Windows `cmd.exe` `['/d', '/c', 'ping', '-n', '30', '127.0.0.1']`; assert the shell exits within 10 s, the child's pid is gone, and (Windows) the number of app processes did not grow (no second instance from a fork) |
| `scripts/copy-assets.js` | copy `@xterm/xterm/lib/xterm.js`, `@xterm/xterm/css/xterm.css`, `@xterm/addon-fit/lib/addon-fit.js` to `dist/renderer/vendor/`; add `termpane.js`, `paneltabs.js` to the renderer list (agent note: a new renderer script needs this line) |
| `src/renderer/index.html` | `<link rel="stylesheet" href="vendor/xterm.css">`, `<script src="vendor/xterm.js">`, `<script src="vendor/addon-fit.js">`, `<script src="paneltabs.js">`, `<script src="termpane.js">`; **CSP line unchanged** |
| `.github/workflows/*` | **none required** with the recommended pin (every runner OS has a prebuild). With option (b) `1.1.0`, Linux developer machines need `python3`, `make`, `g++`; CI's `ubuntu-latest` has them |
| Licence notices | the repo has no third-party notice file today (`marked` and `dompurify` are not listed in `src/shared/about.ts` or the README). node-pty's `LICENSE` ships inside its package folder; `copy-assets.js` also copies `@xterm/xterm/LICENSE` next to the vendored file, as MIT asks for copies |

**Costs**: native module (N-API, prebuilt for six targets, nothing to compile with the pin); no Electron rebuild; electron-builder: one `asarUnpack` line, exclusions and a per-target prune; CI: no workflow change, one more assertion in the nightly packaged check; licence MIT for all three; size: estimated +0.7 MB on macOS and Linux, +1.1 to 2.2 MB on Windows (R2, R3), measured in phase 1 and recorded in the spec.

**Where the PTY lives**: in the main process, loaded lazily (`require` on the first terminal, never at start, never under the simulator), so a broken binary shows "The terminal could not start: <reason>" in the pane and nothing else breaks. A separate `utilityProcess` (VS Code's pty host model) is not needed for one terminal per folder; revisit if a PTY crash ever takes main down (recorded as a risk).

## 3. xterm.js in the renderer

- **Vendored from npm** (exact pin, copied by `copy-assets.js`), not committed: the same rule as `marked` and `dompurify`; no CDN; no bundler.
- **CSP** stays `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`: xterm's script and stylesheet are `'self'`; its runtime `<style>` elements are allowed by `'unsafe-inline'` for styles; no eval, workers or fonts (R3). The driver fails on any CSP violation in the console.
- **Options** (one pure `terminalOptions(tokens, textPx)`, spec FR-060): `screenReaderMode: true`, `scrollback: 5000`, `fontSize` max(13, chat text size) and never under 10.5, `fontFamily` the theme's monospace token, `theme` from computed CSS tokens (re-read on theme change), `allowProposedApi: false`, `macOptionIsMeta: false`, `rightClickSelectsWord: false`, `linkHandler: { activate() {}, allowNonHttpProtocols: false }` (OSC 8 inert; the default would `confirm()` then `window.open()`), `windowOptions` not set (all off), no addon but `FitAddon` (no web-links, no clipboard: no OSC 52), `onTitleChange` and `onBell` never subscribed.
- **Paste**: a `paste` listener on `#termView` with `{capture: true}` calls `preventDefault()` **and** `stopPropagation()`, then `term.paste(cleanPaste(text))`. xterm's own paste handlers are bubble-phase listeners on its textarea and its root element, both inside `#termView` (`CoreBrowserTerminal.ts:342-344`, `:421`), and they ignore `defaultPrevented`: without `stopPropagation()` xterm would paste the raw text too (double paste, and the breakout is back; review on #811); `cleanPaste` removes `ESC[200~`/`ESC[201~` and their 8-bit forms until none is left, because xterm 6.0.0 brackets the text without cleaning it (research R3).
- **Keys** (spec FR-051, FR-056): `attachCustomKeyEventHandler(e => !appKey(e))` so the app's keys (⌘ on a Mac, Ctrl+Shift elsewhere, F6/Shift+F6, a navigator combination of that kind) are not taken by xterm; a bubble-phase `keydown` listener on `#termView` stops propagation of every key that goes to the shell, so the `document` handlers never see it.
- **One xterm instance per folder key** in `termpane.js` (a `Map`), its element re-attached into `#termView` on every `mount()` (pattern of `getChat()`); `fit()` on `ResizeObserver` (one per frame), sending `terminal:resize` only when cols/rows change.
- **Copy/paste**: copy with `navigator.clipboard.writeText` (the window already allows `clipboard-sanitized-write`, `src/main/hardening.ts:24`); paste by the native paste event (⌘V, Ctrl+Shift+V) which xterm handles. The window does **not** get `clipboard-read`.

## 4. IPC and preload (the renderer stays sandboxed)

Preload (`src/preload/preload.ts`, types in `src/shared/api.ts`), all optional members so the plain page and demo have none:

| Preload | Channel | Main checks |
|---|---|---|
| `terminalOpen(agentId, simKey?)` | `terminal:open` | `fromApp`; agent known and top-level; folder exists; returns `{ok, state}` or `{ok:false, reason}`. Opens or returns the folder's terminal. `simKey` only under the simulator (FR-040) |
| `terminalInput(tid, data)` | `terminal:input` (invoke-less `send`) | tid known; string; at most 64 KB |
| `terminalResize(tid, cols, rows)` | `terminal:resize` | integers 2-500 by 1-300 |
| `terminalAck(tid, n)` | `terminal:ack` | non-negative integer; drives pause/resume |
| `terminalClose(tid)` | `terminal:close` | tid known; ends the terminal (spec FR-033, FR-037) |
| `terminalState(agentId)` | `terminal:state` | the folder's state or `{open:false}` |

Only `terminalOpen` and `terminalState` take an agent id (spec FR-020); `input`, `resize`, `ack` and `close` take the `tid` that open returned, and main refuses an unknown one.
| `onTerminalData(cb)` | event `terminal:data` `{tid, data}` | batched 16 ms, 64 KB |
| `onTerminalState(cb)` | event `terminal:state` `{tid, open, busy, processName, exited, exitCode, shell}` (no folder identification; base names only) | sent on start, busy change (polled every 1 s while open, only when changed), exit |

- `tid` is `randomBytes(8).toString('hex')`; paths never cross to the window (the pane shows the folder from the room the window already has, and keys its xterm by that room).
- **Events go only to the app window** (spec FR-026): `register(deps)` gets `send: toRenderer` (`main.ts:217`, the app window's `webContents.send`) as its only way out; no `getAllWindows`, `getAllWebContents` or broadcast; the spec 080 browser views load web pages and get no preload (`viewWebPreferences`, `hardening.ts:71`), so they have no terminal API, and their senders fail `fromApp`.
- **Attach and flow control** (spec FR-024): data is sent only to a window that called `terminal:open` since its last load; main listens to the app window's `did-start-navigation` (main frame, `isSameDocument` false only) and `render-process-gone` and then marks every terminal not attached, resets its outstanding bytes and resumes a paused PTY; acks are clamped to the bytes outstanding.
- **`simKey`** (spec FR-040): read only when `SIMULATOR`; outside it the field is ignored and the agent id alone decides the folder (unknown id: refused).
- `contextIsolation`, `sandbox`, `nodeIntegration: false` unchanged; no new `webPreferences`.
- `test:ipcchannels`: new channels registered once; every handler calls `fromApp` (added to its static list).
- `SIM_OPEN_CHANNELS`: the six channels, each with "spec 094: fake shell in main under the simulator; no process, no file, no agent".

## 5. Main modules

```text
src/main/terminal/shell.ts       pure: chooseShell({platform, env, isFile, isExecutable, readEtcShells, pathLookup}) -> {file, args, name}
src/main/terminal/env.ts         pure: terminalEnv(snapshot, {platform, loginPath, appVersion, simTz}) -> env
src/main/terminal/busy.ts        pure: isBusy({platform, shellName, processName}) -> boolean
src/main/envsnapshot.ts          NEW, imports nothing: export const ENV_SNAPSHOT = Object.freeze({ ...process.env }); the FIRST import of main.ts (spec FR-013)
src/main/terminal/kill.ts        endTree(term, platform, deps): POSIX destroy() (hang-up), SIGKILL to -pid after 2 s unless exited; Windows killChildTree on the wrapper, then the close path T016 proves (spec Q9 (c); never a forking node-pty call); endAll() for the quit (2 s cap) and killRemaining() (synchronous) for will-quit (spec FR-033, FR-035, FR-037)
src/main/terminal/controller.ts  makeTerminalController({spawnPty, now, setTimer, endTree, send, folderOf}) : open, input, resize, ack, close, state, folderGone, busyCount, windowGone, endAll, killRemaining
src/main/terminal/simpty.ts      fake PTY for DURBAR_SIM (prompt, echo, ls, git status, sleep 30, exit)
src/main/ipc/terminal.ts         register(deps) -> controller; channels of section 4
src/main/main.ts                 `import { ENV_SNAPSHOT } from './envsnapshot'` as line 1, register with send: toRenderer, terminalGone in folders, quit count, endAll in before-quit's capped wait, killRemaining in will-quit
src/main/daily.ts                quitMessage(n, busyTerminals)
```

## 6. Renderer modules

```text
src/renderer/paneltabs.js   NEW UMD: pure tabsFor(a, caps), next tab for a key, label words; DOM: the tablist, on-<tab> class, roving focus
src/renderer/termpane.js    NEW UMD: pure keyGoesToShell(e, isMac, navCombo), terminalOptions(tokens, textPx), cleanPaste(text), stateWords(state), fontSizeFor(textPx); DOM: pane, xterm per folder, key and paste listeners on #termView, mount/hide/show/leave, close question, bar
src/renderer/browserpane.js tab code moves to paneltabs.js; Browser registers as a tab owner (behaviour unchanged)
src/renderer/app.js         template spots, guard in the global key handler, chatShownNow, removeFolder words, keyboard help rows
src/renderer/notes.js       showChatTab leaves any non-chat tab
src/renderer/styles.css     .tpane, .tbar, .tview; :not(.on-chat) rules; tokens only
src/renderer/sim.ts         simulated folder key for terminalOpen (FR-040)
```

## 7. Test plan

**Unit (Node, no real shell, in `npm test` on three OSes):**

- `scripts/test-terminal-shell.ts` (`test:terminalshell`): every branch of FR-010 with injected env and file checks: valid `$SHELL`, listed only in `/etc/shells`, unknown name, relative path, missing file, newline in value; macOS `-l`, Linux none; Windows pwsh on PATH, no pwsh, no SystemRoot, `cmd.exe` fallback; result is always `{file, args[]}` with no shell metacharacter interpretation.
- `scripts/test-terminal-env.ts` (`test:terminalenv`): drops `DURBAR_*`, `ELECTRON_*`, `CHROME_*`, Google keys, sim `TZ`; restores `XDG_CURRENT_DESKTOP`; sets `TERM`, `COLORTERM`, `TERM_PROGRAM(_VERSION)`; macOS `LANG` only when missing; keeps user variables; a variable added to `process.env` after the snapshot does not appear.
- `scripts/test-envsnapshot.ts` (`test:envsnapshot`): the first `import` line of `src/main/main.ts` is `./envsnapshot`'s (and, when `dist/main/main.js` exists, its first `require(` is too); `src/main/envsnapshot.ts` contains no `import` or `require`; `ENV_SNAPSHOT` is frozen; a mutant that moves the import to line 2 fails the test.
- `scripts/test-terminal-kill.ts` (`test:terminalkill`): fake PTY, kill and clock: POSIX `destroy()` first, `SIGKILL` to `-pid` at 2 s only when not exited, none after an exit at 1.9 s (#721 guard); Windows calls `killChildTree` with the wrapper and never the PTY's forking `kill()`/`destroy()` (a fake that throws when called), the tree kill skipped once exited; `endAll()` resolves when every shell exited or at 2 s and then sends the guarded `SIGKILL`; `killRemaining()` runs no timer.
- `scripts/test-terminal-controller.ts` (`test:terminal`): fake PTY factory: one terminal per folder key; two agent ids of one folder share it; another folder gets its own; nothing spawns before `open`; input cap and type checks; resize bounds; output batching (16 ms, 64 KB); flow control pause above 256 KB unacked and resume below 64 KB; replay buffer capped at 256 KB and sent on attach; `close` ends the terminal through `kill.ts`; `folderGone` ends it; shell exit sets `exited/exitCode`; `busyCount` per platform rule; `endAll`; ack clamped to outstanding bytes and negative or non-integer acks refused; a window reload (`did-start-navigation` with `isSameDocument` false, `render-process-gone`) while paused resets the count and resumes, and a same-document navigation changes nothing; no data is sent while not attached and the replay buffer stays capped; the replay cut starts after a line break; the state has no folder field; events leave only through the injected `send`; an injected logger and `console` spy never receive data; the real `node-pty` is never required under the simulator flag.
- `scripts/test-terminalipc.ts` (`test:terminalipc`): on a stand-in `electron` (checklist: *a tested op is not tested wiring*): every channel calls `fromApp`; `simKey` is ignored when `SIMULATOR` is false (an unknown agent id with a `simKey` is refused and nothing spawns) and used when true; `main.ts` passes `send: toRenderer` (static); `viewWebPreferences()` has no `preload` key.
- `scripts/test-termpane.ts` (`test:termpane`): `keyGoesToShell` for every row of FR-051 on macOS and others (Esc, Tab, Ctrl+K, Ctrl+F, Ctrl+Backquote, Alt+A, F2, F6, Shift+F6, PageUp, PageDown, ⌘K, ⌘F, Ctrl+Shift+A/C/V, an unused Ctrl+Shift+Y), and with user-set navigator combinations (Ctrl+G and Alt+G go to the shell, Ctrl+Shift+G and ⌘G stay the app's, spec Q12); `terminalOptions()` (inert `linkHandler`, no `windowOptions` entry true, `screenReaderMode`, font never under 10.5); `cleanPaste` hostile matrix (spec FR-060); static: `termpane.js` never subscribes `onTitleChange`/`onBell` and loads no addon but `FitAddon`; static: every `document`/`window` `keydown` listener in `src/renderer/**` is in the test's list with a reason (spec FR-056); static: `process.platform` and `navigator.platform` are not read in `termpane.js` or `src/main/terminal/**` outside the injection point (spec FR-055); `tabsFor` (Chat only, Chat+Terminal, all three; helpers none); state words; `fontSizeFor` never under 10.5.
- `scripts/test-terminal-useronly.ts` (`test:terminaluseronly`): static: `src/main/terminal/*` imported only by `src/main/ipc/terminal.ts` and `src/main/main.ts`; no `terminal` reference in `src/adapters/**`, `src/main/mcp/**`, `src/main/remoteops.ts`, `src/main/sessionsummary.ts`, `src/main/activitystore.ts`, `src/main/notesops.ts`; no `console.*`/sink call in `src/main/terminal/*` with the data argument.
- Updated: `test:ipcchannels`, `test:simguard`, `test:globals`, `test:innerscroll`, `test:theme`, `test:browserpane` (tab move), `test:uisuite` (new driver and pictures).

**Simulator driver** `scripts/check-terminal-tab.js` (in `scripts/ui-suite.js`, script `check:terminal-tab`; `DURBAR_SIM=15 DURBAR_SIM_FREEZE=1`, waits with `until()`), at 1440x900, 1280x800 and the 480px narrow panel:

1. tablist Chat, Browser, Terminal; roving keys over three tabs; no terminal before selection;
2. select Terminal: prompt, folder line, focus in the terminal, text at least 10.5px, at least 8 rows at 1280x800, no page overflow;
3. type `ls` + Enter: echoed output; Esc stays in the terminal and the chat stays open; F6 returns to the tab;
3a. keys (spec FR-056, SC-008): with floors on (spec 092, `simfloors`), PageUp and PageDown in the terminal reach the fake shell's input log and the floor does not change; Ctrl+Backquote reaches the shell and the previous chat does not open; Ctrl+F (Linux and Windows) reaches the shell and the palette stays closed; Tab keeps the focus in the terminal; Ctrl+Shift+A from the terminal still opens the inbox;
3b. escapes (spec FR-060, SC-007): the fake `escapes` command prints an OSC 8 link, OSC 52, OSC 0/2, CSI 14 t, CSI 18 t and a bell; with `window.confirm` replaced by a counter and a clipboard marker set by the driver, clicking the link changes nothing (counter 0, no window-open request in main's handler hook), the clipboard still holds the marker, `document.title` and the tab name are unchanged, and the fake PTY received no reply; a paste of `a<ESC[201~>b` with bracketed paste on reaches the fake PTY exactly once, as one bracketed paste with the inner marker removed, and the raw text never arrives (catches a guard without `stopPropagation()`: double paste and breakout);
4. a second session of the same folder shows the same screen; another folder's Terminal is not started;
5. `sleep 30` (fake), then Chat tab, close chat, office, back: still running, label "running a command";
6. Close terminal while busy: question, Cancel keeps it, Close ends it; Start terminal starts a new one;
7. quit count: main's `busyCount` read through a driver hook equals 1 while the fake command runs;
8. Remove folder: the terminal ends;
9. a marker string printed in the terminal is absent from every file in the profile folder and from the captured stderr (SC-004);
10. `check:office` unchanged (the suite's own run).

Pictures: `docs/screenshots/094-terminal-tab-1440x900.png`, `094-terminal-tab-1280x800.png`, `094-terminal-tab-narrow.png`; any linked picture showing the chat tablist is retaken with `npm run shots:docs`.

**Packaged check** (nightly, on main for `src/main/**`, on demand; not on pull requests): the real module loads from `app.asar.unpacked` and one fixed command exits 0 on Windows, macOS and Linux (FR-042, SC-006).

**Only on a real machine** (research R7; recorded as `real:` in the spec when done, never in CI): real shells and their start-up files, IME, copy and paste, VoiceOver/NVDA/Orca with screen-reader mode, the Finder-launched environment, ConPTY on Windows 10 and 11, the AppImage on an older glibc, `spawn-helper` from a quarantined ad-hoc signed app, busy detection per OS.

## Phases (one PR each; each leaves the app working)

1. **P1 Dependency spike and packaging** (no UI): pins, packaging lines, prepare/after-pack, packaged-check assertion, measured sizes recorded in the spec. Riskiest part first: if a target cannot load the module, the spec is revised before UI work.
2. **P2 Main**: shell, env, busy, kill, controller with fake PTY tests, sim PTY, IPC and preload, simguard, folder removal, quit count, `will-quit`.
3. **P3 Window**: `paneltabs.js` (with `browserpane.js` moved onto it, spec 080 checks green), `termpane.js`, xterm vendoring, keys and focus, styles, driver and screenshots.
4. **P4 Docs and converge**: README, keyboard help, changelog fragment, spec 080/052 `## Changes`, `shots:docs`, honest limits; real-machine checks by the owners as they can.

## Risks to check in review

- Esc and Tab must never leave the terminal by accident, and no global listener may act on a key meant for the shell: all nine `document`/`window` keydown listeners (spec FR-056), not only `app.js:3060`.
- A program's output must not reach the app: OSC 8, OSC 52, titles, CSI t, bracketed-paste breakout (spec FR-060).
- Windows: no node-pty call that forks from the packaged main (spec FR-037, Q9 (c)); the packaged check T016 is the proof and picks the path.
- The env snapshot must stay the first import of `main.ts` (spec FR-013, `test:envsnapshot`).
- `browserpane.js` refactor must not change spec 080 behaviour (`check:browser-tab`, `check:browser-dialogs`, `test:browserpane`).
- A PTY crash in main: lazy load and try/catch around spawn; a native crash would still take main down (no pty host process).
- Flow control and batching under a flood; memory caps.
- Prebuild pruning across the two macOS builds on one runner.
- The `node-pty` pin is a beta today (Q7).

## Complexity Tracking

| Addition | Why | Simpler option rejected because |
|---|---|---|
| A native dependency (`node-pty`) | A real terminal needs a PTY | `child_process` pipes give no prompt, no line editing, no job control, no colours; FFI `forkpty` is unsafe in a threaded process (R2) |
| `paneltabs.js` | Three tab owners share one tablist | Adding a third branch inside `browserpane.js` would tie the terminal to the browser's module and its two-tab `select(i?'browser':'chat')` |

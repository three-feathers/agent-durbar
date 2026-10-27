# Research: Terminal tab (spec 094)

Everything here was read on 2026-10-27 from the npm registry metadata and from the package tarballs (listed with `tar -tzv` and read with `tar -xzO`, nothing extracted, installed or run), and from this repository at `origin/main` 0f57c58f. Evidence tag: `read:` unless stated otherwise. Sizes are bytes as listed in the tarballs; installer growth is an estimate until phase 1 measures it.

## R1 What the repo already has for this

| Need | Existing code | Use |
|---|---|---|
| Chat-level tablist, roving focus, start tab, keep tab on rebuild | `src/renderer/browserpane.js:14` `tabKey`, `:87` `tabsHTML`, `:106` `startTab`, `:108` `setSelected`, `:158` `select`, `:255` `wantTab`, `:271` `mount`, `:308` `hide`, `:315` `current` | Generalise to N tabs (plan step 1); the terminal pane registers as one tab |
| Tab and pane insertion in the panel | `src/renderer/app.js:2287` (tablist), `:2291` (pane), `:2302` `BP.mount(a)`, `:3009` `BP.hide()` in `closePanel()` (`:3008`) | Same spots for the terminal pane |
| Hide chat log on a non-chat tab | `src/renderer/styles.css:862-863` (`.panel-in.on-browser #chat`, `.prev`) | Generalise the class to "not on Chat" |
| Unread logic aware of the tab | `src/renderer/app.js:2228` `chatShownNow` (reads `BP.current().tab`), `:2245` `syncSeen` | Must read the shared tab state, so Terminal counts as "chat not shown" |
| "Show the Chat tab first" before Notes | `src/renderer/notes.js:92` `showChatTab(bp)`, called at `app.js:2751` | Must also leave Terminal |
| Keep a view per key across panel rebuilds | `src/renderer/app.js:1926` `getChat(a)` (`chats[a.id]`) | Same pattern: one xterm instance per folder key |
| Global keys (Esc closes chat, Ctrl+K, Ctrl+F, Ctrl+O, Ctrl+Backquote, Alt keys, F2) | `src/renderer/app.js:3060` handler; Esc branch `:3119`; the other `document`/`window` keydown listeners: `app.js:477` (capture), `:3940` (spec 092 PageUp/PageDown), `:5762`, `:7341`, `:7411`, `dialog.js:76`, `screens.js:559`, `:780` (capture, while their UI is open) | None may act on a key meant for the shell (FR-051, FR-056) |
| Shared dialog | `src/renderer/dialog.js:25` `askDialog` | Close-terminal question |
| Folder removal | `src/main/ipc/folders.ts:46` `folders:remove` (calls `deps.browserGone`), renderer `src/renderer/app.js:6872` `removeFolder()` (confirm text) | Add `terminalGone(folderKey)` and the running-command words |
| Quit question | `src/main/main.ts:847` `workingCount`, `:859` `confirmQuit`, `:1112` `before-quit`, `:1144` `will-quit` (calls `destroyAllViews()`), `src/main/daily.ts:106` `quitMessage(n)` | Count busy terminals; end all terminals in `will-quit` |
| Window close asks too (Windows, Linux) | `src/main/main.ts:930` `w.on('close')` | Same count |
| Sender check, simulator deny | `src/main/ipcguard.ts:44` `fromAppFrame`, `:50` `ipcHandle`; `src/main/simguard.ts:28` `SIM_OPEN_CHANNELS` | All terminal channels |
| IPC module layout and its test | `src/main/ipc/browser.ts` (`register(deps)` returning a controller), registered at `src/main/main.ts:746`; `scripts/test-ipcchannels.ts` | Same shape: `src/main/ipc/terminal.ts` |
| Preload API | `src/preload/preload.ts:199-217` (`browser*`), types `src/shared/api.ts:1062-1078` | Same style: `terminal*` |
| Renderer sandbox | `src/main/main.ts:891-893` (`contextIsolation`, `nodeIntegration: false`, `sandbox: true`); CSP `src/renderer/index.html:6` | Unchanged |
| Folder key and cwd | `src/main/main.ts:161` `wsKey`; `src/adapters/workspace.ts:44` `resolveWorkspaceCwd` (first listed folder) | Terminal key and cwd |
| Shell choice (POSIX) | `src/main/loginpath.ts:28` `loginShellCommand` (`$SHELL` checked, `/bin/sh` fallback, argv only) | Reuse its check, widen the known set (spec FR-010) |
| Windows `cmd.exe` | `src/shared/wincmd.ts:14` `windowsCmd` | Last Windows fallback |
| PATH folders lookup | `src/shared/pathdirs.ts:8` `pathDirs` | Find `pwsh.exe` |
| Env for a child | `src/adapters/codex.ts:132` `codexChildEnv` (drops credentials), `src/main/harnesssetup.ts:100` `setupEnv`; login PATH `src/main/main.ts:628`; sim clock `TZ` `src/main/main.ts:172` | Model for the terminal's env builder; snapshot taken before line 172 and before adapters load |
| Kill a process tree | `src/adapters/detect.ts:423` `killChildTree` (`taskkill /T /F` on Windows; skips its `SIGKILL` once the child exited, #721) | Windows end of a terminal (FR-037), with the terminal wrapper's `exited` flag |
| Dev hooks | `src/main/devhooks.ts` (`DURBAR_*` only through `devEnv`) | Env builder drops `DURBAR_*` |
| Vendored renderer libraries | `scripts/copy-assets.js` (copies `marked`, `dompurify` from `node_modules` into `dist/renderer/vendor/`) | Same for xterm |
| Packaged native module | `package.json` `build.asarUnpack` (`node_modules/koffi/**`), `npmRebuild: false`, `nodeGypRebuild: false`; fuses `onlyLoadAppFromAsar`, asar integrity | Same for node-pty |
| Per-target runtime pruning | `scripts/prepare-runtime.js` (fetches a missing target package with `npm pack`, removes the others), `scripts/after-pack.js` (fails on a missing or stray runtime) | Extend for node-pty prebuilds |
| Packaged smoke in each OS | `.github/workflows/packaged-check.yml` runs `scripts/pack-esm-ci.js` inside the packaged main (nightly, main, on demand) | Add "load node-pty, run one fixed command" |
| UI driver pattern | `scripts/check-browser-tab.js`, listed in `scripts/ui-suite.js:111`, script `check:browser-tab` in `package.json` | `scripts/check-terminal-tab.js` |

**The lobby *Terminal* place** (`src/shared/places.ts:10`, `src/renderer/places.js:11`, classification `:39`/`:100`; spec 024 FR-001..FR-003) is where an agent's figure stands while it runs a shell tool. It is one shared lobby for all folders. It is not clickable today (lobby tiles have no open action; only the *Add a place* button, `app.js:371`). Recommendation: it stays decorative (spec Q6).

## R2 The PTY package

| Option | Version (2026-10-27) | Licence | Prebuilt binaries in the package | Install script | Notes |
|---|---|---|---|---|---|
| `node-pty` (Microsoft) | `latest` 1.1.0 (2025-12-22) | MIT | darwin-arm64, darwin-x64, win32-arm64, win32-x64. **No Linux.** Also winpty and `.pdb` files | `node scripts/prebuild.js \|\| node-gyp rebuild` | On Linux `npm ci` compiles (Python, make, g++ and Node headers from the network). Unpacked 64 MB, 286 files (mostly `.pdb` and sources) |
| `node-pty` (Microsoft) | `beta` 1.2.0-beta.18 (2026-10-23) | MIT | darwin-arm64, darwin-x64, **linux-arm64, linux-x64**, win32-arm64, win32-x64; no winpty (ConPTY only: Windows 10 1809+) | same | Unpacked 26.9 MB, 49 files. With a prebuild present `prebuild.js` exits 0 and nothing compiles |
| `@lydell/node-pty` | 1.2.0-beta.18 | MIT | Per-platform optional packages (`@lydell/node-pty-<os>-<arch>`), like `@github/copilot-sdk-*` | none | A repack by one maintainer; win32-x64 package 12.3 MB |
| `@homebridge/node-pty-prebuilt-multiarch` | 0.14.1 | MIT | via `prebuild-install` (downloads binaries at install time from GitHub) | yes, downloads | Network download at install; rejected |
| FFI through the bundled `koffi` (forkpty / ConPTY by hand) | n/a | MIT | already shipped | n/a | `forkpty` from a multi-threaded Electron main is unsafe (only async-signal-safe calls after fork); rejected |

All node-pty builds are **N-API** (`node-addon-api` dependency): one binary works across Node and Electron versions, so **no Electron ABI rebuild** (`@electron/rebuild`) is needed and `npmRebuild: false` stays. *[unverified until phase 1: the module loads in Electron 44's main process.]*

Loading (`lib/utils.js`, 1.1.0 and beta): `build/Release`, `build/Debug`, then `prebuilds/<platform>-<arch>/`. `lib/unixTerminal.js` rewrites the `spawn-helper` path from `app.asar` to `app.asar.unpacked` itself, so the module and helper must be unpacked.

Per-target files that ship (beta.18, without `.pdb`):

- macOS arm64: `pty.node` 86,904 + `spawn-helper` 50,480; macOS x64: 58,656 + 9,248.
- Linux x64: `pty.node` 71,784.
- Windows x64: `pty.node`/`conpty.node` 293,376, `conpty_console_list.node` 134,656, `conpty/conpty.dll` 110,152, `conpty/OpenConsole.exe` 1,062,472. The last two are only used with `useConptyDll: true`; with the default (the OS's ConPTY) they could be left out, but that default's `kill()` forks (below), so spec Q9 (a) keeps them and sets `useConptyDll: true`. *[unverified: that either setting works on every Windows 10/11 build Durbar supports.]*
- plus `lib/*.js` (tens of KB).

**Ending a terminal, read from 1.2.0-beta.18 `lib/` (2026-10-27, `read:`, from `npm pack` into a scratch folder; nothing installed or run; review on #811):**

- POSIX: `UnixTerminal.destroy()` closes the master socket, then sends `SIGHUP` to the shell pid (`lib/unixTerminal.js:217-226`); `kill(sig)` is `process.kill(pid, sig)` on the shell only (`:228-233`). Neither signals the jobs' own process groups (spec FR-033).
- Windows, default `useConptyDll: false`: `WindowsPtyAgent.kill()` calls `_getConsoleProcessList()`, which runs `child_process.fork(path.join(__dirname, 'conpty_console_list_agent'), [innerPid])`, waits up to 5 s for the list, then `process.kill`s each pid (`lib/windowsPtyAgent.js:193-240`). `WindowsTerminal.destroy()` calls `kill()` (`lib/windowsTerminal.js:156-170`). In Durbar's packaged main `fork` runs the Electron binary; with the `runAsNode` fuse off it cannot act as Node, and Durbar has no single-instance lock, so it may start a second app instance. *[unverified: what the fork does in the packaged app; the packaged check of spec T016 must show it.]*
- Windows, `useConptyDll: true`: `kill()` destroys the input socket and calls the native kill, with no fork (`lib/windowsPtyAgent.js:214-221`). This needs `conpty/conpty.dll` and `conpty/OpenConsole.exe` in the package (spec Q9 a).
- Windows natural exit with `useConptyDll: false`: `_$onProcessExit` then `_cleanUpProcess` close the sockets only; the native kill is not called on that path (`lib/windowsPtyAgent.js:255-280`). *[unverified: whether the pseudoconsole and its console host then stay until the app quits (spec Q9 b).]*
- `lib/windowsConoutConnection.js:66` uses a `worker_threads` `Worker`, not a process, so it does not depend on `runAsNode`. *[unverified until phase 1.]*
- `IPty` exposes `onExit` but no `exitCode`/`signalCode`; Durbar's wrapper keeps its own `exited` flag (spec FR-033).

Estimated installer growth: about 0.2 MB (macOS, Linux) and 0.6-1.7 MB (Windows) for the PTY, plus about 0.5 MB for xterm (R3). The `.pdb` files (about 26 MB per Windows arch in 1.1.0), `src/`, `deps/`, `third_party/`, `binding.gyp`, `typings/` and `node-addon-api` must be excluded from the package.

**Recommendation (spec Q7 a)**: `node-pty`, exact pin of the first version with Linux prebuilds (today `1.2.0-beta.18`; `1.2.0` if stable by phase 1). Upstream maintainer (Microsoft, the VS Code terminal team), MIT, N-API, prebuilds for all six targets, no compile on any developer machine. *[unverified: which node-pty version VS Code ships today.]*

## R3 The terminal emulator in the page

- `@xterm/xterm` 6.0.0 (2025-12-22), MIT, no dependencies. Ships `lib/xterm.js` (UMD, 488,663 bytes), `lib/xterm.mjs`, `css/xterm.css` (7,112). `@xterm/addon-fit` 0.11.0 (MIT, `lib/addon-fit.js` 1,521 bytes) sizes the terminal to its box.
- `lib/xterm.js` contains no `eval(` or `new Function(` and no `Worker` or `WebAssembly`; it creates `<style>` elements (4 places). The page's CSP (`default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`) allows exactly this: scripts and styles from the app, inline styles. **No CSP change.** No `font-src` is needed (system monospace fonts). *[unverified until phase 3: no CSP report in the simulator.]*
- `screenReaderMode` is an option of 6.0.0 (found in `lib/xterm.js`).
- **Vendored from npm, not copied into the repo**: `devDependencies` would not ship it; it goes in `dependencies` (exact pin), and `scripts/copy-assets.js` copies `xterm.js`, `xterm.css` and `addon-fit.js` to `dist/renderer/vendor/`, like `marked` and `dompurify`. The renderer stays plain scripts; no bundler. `test:globals` learns the UMD globals (`Terminal`, `FitAddon`) or the copy step wraps them. *[unverified: the exact global names of the 6.0.0 UMD builds.]*
- **Escape sequences and paste, read from 6.0.0 `src/` (2026-10-27, `read:`; review on #811)**, for spec FR-060:
  - OSC 8 hyperlinks: with the default `linkHandler: null`, activating a link calls `defaultActivate`, which runs `confirm("Do you want to navigate to <uri>?...")` and then `window.open()` (`src/browser/OscLinkProvider.ts:89`, `:114-120`); non-http(s) links are dropped unless `allowNonHttpProtocols` (`:72-75`). An inert `linkHandler` replaces both.
  - OSC handlers in the core: 0, 1, 2 (title, icon name), 4, 10, 11, 12 (colours, also reports), 8 (links), 104, 110-112 (`src/common/InputHandler.ts:292-331`). **No OSC 52**: clipboard writes need the clipboard addon, which Durbar does not load.
  - Titles reach the embedder only through `onTitleChange` (`InputHandler.ts:157-158`), and CSI 22/23 t push and pop titles (`:2859-2884`); not subscribing is enough.
  - CSI t window reports run only when the matching `windowOptions` entry is true (`InputHandler.ts:2840-2843`); the default is `{}` (`src/common/services/OptionsService.ts:51`). There is no title report (CSI 21 t).
  - Paste: `paste()` does `prepareTextForTerminal` (newlines to CR) then `bracketTextForPaste`, which wraps the text in `ESC[200~`...`ESC[201~` **without removing markers inside it** (`src/browser/Clipboard.ts`). Durbar cleans the text itself (spec FR-060).
  - `screenReaderMode` defaults to `false` (`OptionsService.ts:38`); Durbar sets it.
- The default DOM renderer is enough (no WebGL addon: fewer GPU paths, and the office's "no blur in compact scenes" rule is not involved).

## R4 Packaging and signing

- `build.asarUnpack` gains `node_modules/node-pty/**` (the `.node` files and `spawn-helper` must be real files; `spawn-helper` must keep its executable bit).
- `build.files` gains exclusions: `!node_modules/node-pty/{src,deps,third_party,scripts,typings}/**`, `!node_modules/node-pty/binding.gyp`, `!**/*.pdb`, `!node_modules/node-addon-api/**`.
- Per target, only one `prebuilds/<platform>-<arch>/` may ship. The release builds macOS arm64 then x64 **on the same arm64 runner** (`release.yml`, `dist:mac:arm64 && dist:mac:x64`), so pruning in place must restore the other arch for the second build: `prepare-runtime.js` already does "fetch the target's package with `npm pack` when missing, remove the others" for the Copilot runtime; extend it to node-pty's `prebuilds/` (both darwin dirs are in the one package, so a re-fetch is only needed if a previous step deleted it). `after-pack.js` fails when the target's `pty.node` is missing, a stray prebuild dir is present, or `spawn-helper` is not executable.
- macOS: electron-builder ad-hoc signs every Mach-O in `app.asar.unpacked` (`docs/agent-notes.md`, 2026-10-23). `pty.node` and `spawn-helper` carry no vendor signature Durbar must keep, so no `signIgnore` entry. *[unverified: `spawn-helper` from a quarantined, ad-hoc signed app on a real Mac.]*
- Fuses: `runAsNode` false, `onlyLoadAppFromAsar` true, asar integrity on: unchanged; `koffi` proves an unpacked N-API module loads with these fuses.
- Windows: ConPTY needs Windows 10 1809 or later; Electron 44 needs Windows 10 or later. *[unverified: the oldest Windows 10 build Durbar claims.]*

## R5 CI

- `npm ci` runs node-pty's install script on every runner (`ci.yml`, `release.yml`, `packaged-check.yml`, `ui-platforms.yml`, `install-check.yml`, `installed-app.yml`, `e2e-real.yml`, `mcp-oauth-real.yml`). With beta.18 every runner OS has a prebuild, so nothing compiles and no network is used beyond `npm ci` itself. With 1.1.0 the Ubuntu runners would compile (toolchain present on `ubuntu-latest`; Node headers downloaded by node-gyp). `pages.yml` uses `npm ci --ignore-scripts`: fine, the prebuilds are in the tarball.
- No workflow needs a new step for `npm test`: tests use a fake PTY (spec FR-041).
- `packaged-check.yml` (nightly, on main for `src/main/**` and `package.json` changes, on demand): `scripts/pack-esm-check.js` gains "require node-pty from the packaged app and run one fixed command" (the platform's shell with a constant `exit 0`-style argument array, no user text). This is the only CI step that starts a real shell; it spends no credits.
- `release.yml`: no new job; `prepare-runtime.js` and `after-pack.js` carry the per-target rule.
- Actions stay pinned by SHA; no new action.

## R6 Environment of the main process

- Writes to `process.env` in `src/`: the login PATH (`main.ts:628`) and the simulator clock's `TZ` (`main.ts:172`). Nothing else (`read:` grep). Durbar stores secrets with `safeStorage` (MCP sign-ins, spec 019), never in the environment.
- What else can be in Electron's environment: `ELECTRON_*` (for example `ELECTRON_RUN_AS_NODE` from a developer shell), `ORIGINAL_XDG_CURRENT_DESKTOP` (Electron on Linux), `DURBAR_*` dev hooks, `CHROME_*`. *[unverified: whether `@github/copilot-sdk` or the Claude SDK writes to `process.env` at runtime; the start-up snapshot (spec FR-013) makes it irrelevant.]*
- An app opened from Finder has no `LANG`; shells then print non-ASCII badly. Terminal apps set a UTF-8 `LANG` in that case (spec FR-013). *[unverified on a real Mac.]*

## R7 What only a real machine can show

What survives Close terminal and quit per shell (spec FR-033), the Windows end path and a main crash on Windows (FR-036, FR-037), real shells (zsh, bash, fish, PowerShell 7, Windows PowerShell, cmd), `-l` start-up files, IME and dead keys, copy and paste per OS, VoiceOver, NVDA and Orca with `screenReaderMode`, the Finder-launched environment, ConPTY on Windows 10 and 11, the AppImage on an older glibc, `spawn-helper` in a quarantined ad-hoc signed app, the busy detection per OS (spec FR-031).

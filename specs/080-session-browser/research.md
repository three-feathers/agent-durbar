# Research: Each session gets its own built-in browser (spec 080)

**Date**: 2026-10-23 | **Issue**: #556 | **Cost**: 0 AI credits. Findings are `read:` (official docs, READMEs or source files) unless it says otherwise. Only R1a (the T010 simulator probe) ran anything; no CDP proxy or MCP server was built or tried.

## R1. Electron: the embedded view, partitions, the in-process debugger, fuses

- **WebContentsView** is a main-process view that shows a `WebContents`; it is added with `win.contentView.addChildView(view)` and placed with `setBounds`. "Calling `addChildView` on an existing view reorders it to the top." `BrowserView` "has been deprecated since Electron 30 and is replaced by WebContentsView." `read:` <https://www.electronjs.org/docs/latest/api/web-contents-view>, <https://www.electronjs.org/blog/migrate-to-webcontentsview>. The app is on Electron `^44.8.0` (`package.json:192`), so the view is available.
- **A native view is drawn over the page, not inside it.** The view is a separate surface on top of the window's own page, so Durbar's HTML menus, dialogs and toasts cannot be drawn over it. `read:` the API shape above (a child view of `contentView`, ordered by `addChildView`); not shown in a doc sentence and not tried here. Design consequence: FR-008 (hide the view and show a still picture while a Durbar overlay covers it). Check on the simulator first (T010).
- **Partitions.** "If `partition` starts with `persist:`, the page will use a persistent session ... if there is no `persist:` prefix, the page will use an in-memory session." `session.clearStorageData()` with no options clears every storage type; `clearCache()` clears the HTTP cache; `will-download` can be cancelled with `event.preventDefault()`; `setPermissionRequestHandler` answers each web permission. `read:` <https://www.electronjs.org/docs/latest/api/session>, <https://www.electronjs.org/docs/latest/api/structures/web-preferences> (`partition`; `sandbox` default true since Electron 20; `contextIsolation` default true; `nodeIntegration` and `webviewTag` default false).
- **`webContents.debugger`** is "an alternate transport for Chrome's remote debugging protocol": `attach([protocolVersion])`, `sendCommand(method[, params, sessionId])`, a `message` event with `sessionId`, and a `detach` event when "`webContents` is closed or DevTools is invoked for the attached `webContents`." The `sessionId` argument routes a command to a child target attached with `Target.attachToTarget` (flatten mode). A command sent before the first navigation "may not resolve until navigation occurs." `read:` <https://www.electronjs.org/docs/latest/api/debugger>. Same pitfall, `sim:` on Electron 44: `docs/agent-notes.md:102` (load `about:blank` first).
  - It opens **no port** and no pipe: it is an API of the main process. A process outside Durbar cannot reach it.
- **Session objects live until quit.** `read:` (review of PR #647; Electron's `session` docs give no way to destroy a session object): each `session.fromPartition` name keeps its session object for the app's lifetime, so never-reused names (spec FR-020) leave one cleared object per started session. T013 measures it.
- **Input events.** `before-input-event` is "Emitted before dispatching the `keydown` and `keyup` events" (keys only). `input-event` is "Emitted when an input event is sent to the WebContents", and `InputEvent.type` covers mouse, touch, pointer, gesture and keyboard types. Unhandled `select-bluetooth-device`: "the first available device will be automatically selected". `will-prevent-unload` with `preventDefault()` "will ignore the `beforeunload` event handler". `read:` <https://www.electronjs.org/docs/latest/api/web-contents>, <https://www.electronjs.org/docs/latest/api/structures/input-event>. Whether CDP-dispatched input fires `input-event`: unknown (T010).
- **Cookie encryption and Linux keyrings.** The `cookieEncryption` fuse encrypts the on-disk cookie store with OS-level keys and is one-way (<https://www.electronjs.org/docs/latest/tutorial/fuses>). `safeStorage.getSelectedStorageBackend()` returns `basic_text` on Linux when no secret store is available, and then data is "unprotected" (<https://www.electronjs.org/docs/latest/api/safe-storage>). Spec FR-085 refuses saved logins in that case.
- **Fuses.** Nine fuses; none covers `--remote-debugging-port` or `webContents.debugger`. `nodeCliInspect` only covers `--inspect`-style flags and `SIGUSR1`. `read:` <https://www.electronjs.org/docs/latest/tutorial/fuses>. Durbar already removes the remote-debugging switches from every packaged build (spec 008 FR-038, `specs/008-packaging-and-release/spec.md:209-210`, `real:` packed Linux). In-process debugging does not touch either, so #423 stays closed.

### R1a. Simulator probe (T010, 2026-10-24)

Throwaway probe, not merged, not wired into any npm script. `sim:` Electron 44.8.0, Chromium 152.0.7977.167, Linux, `xvfb-run -a` (never the `:99` display), a local `http` server on 127.0.0.1, 0 AI credits, no network beyond localhost. Every view used FR-010's exact `webPreferences` (`sandbox`, `contextIsolation`, `webSecurity`, `safeDialogs`, `spellcheck: false`, `autoplayPolicy`, `devTools: false`, an in-memory `partition`). **Limits:** the probe ran with `--no-sandbox` (the repo's `chrome-sandbox` is not set up here, as in CI), so `sandbox: true` is requested but the OS sandbox is off; user input was simulated with `webContents.sendInputEvent` (no `xdotool`); one run per case, so the timing ones (hang or not) are single observations; Linux/X11 only (macOS and Windows not run).

| AC | Result | Evidence |
|---|---|---|
| AC0 | ok | all views built with FR-010's options, `devTools: false` included |
| AC1 | ok: the view covers the HTML | `sim:` a blue view over a green HTML block of the app page: 20,000 of 20,000 blue pixels showed in a root screenshot, so FR-008's still picture is needed |
| AC2 | ok | `debugger.attach` after `about:blank`; `Page.enable` alone; `Accessibility.getFullAXTree` (11 nodes); `DOM.scrollIntoViewIfNeeded`, `getContentQuads`, `focus`; `Overlay.highlightNode` (after `DOM.enable` + `Overlay.enable`, on a node from the current document: a stale node id gives "Could not find node with given id"); `Fetch.enable` with a Document pattern paused the form POST (`GET:Document`, `POST:Document`); `Page.setInterceptFileChooserDialog` gave `Page.fileChooserOpened` |
| AC3 | ok | in-memory partition: 1 cookie and a `localStorage` value; a second view of the same partition still saw both; after `clearStorageData()` 0 cookies, and a new view sent no cookie and read no `localStorage` |
| AC4 | ok: it fires | `input-event` fires for `Input.dispatchMouseEvent` (`mouseMove`, `mouseDown`, `mouseUp`) and for `Input.dispatchKeyEvent` (`keyDown`, `keyUp`); it does **not** fire for `Input.insertText`. FR-061's rule (ignore input while a `drive` call runs) is needed, and typing through `insertText` is invisible to the detector |
| AC5 | confirmed | with permissions allowed, a click that calls `requestFullscreen()` made `enter-html-full-screen` fire, `win.isFullScreen()` became true and the window's `enter-full-screen` fired: the whole window goes fullscreen. With the deny-all handlers (FR-025) nothing happened (no event, no fullscreen). FR-025 stays as written |
| AC6 | ok | `Fetch` at the request stage paused each hop of `/r1 -> /r2 -> /final` (the last two with `redirectedRequestId`) |
| AC7 | **fails** | with `Input.setIgnoreInputEvents{ignore:true}` a `sendInputEvent` click was ignored (as wanted) **but a CDP `Input.dispatchMouseEvent` click was ignored too** (the page's counter stayed 0); both worked again after `ignore:false`. FR-066 (Watch-only) cannot use it as written: the agent's own input is blocked as well |
| AC8 | partly | `alert` and `confirm` arrive as `Page.javascriptDialogOpening` and `Page.handleJavaScriptDialog` answers them (`confirm` gave `true` on accept, `false` on dismiss); `beforeunload` arrives as a dialog, accepting lets the navigation go, dismissing keeps the page; with `will-prevent-unload` and `preventDefault()` the navigation went ahead. **`prompt()` throws in Electron ("prompt() is not supported."), so there is no prompt dialog at all.** **But the native dialog is still shown (see AC13), so "no native dialog ever blocks" does not hold** |
| AC9 | ok, with one unexplained file | `kill -9` of the main process: 0 processes left. User-data tree (names and sizes only): no `Partitions/` folder and nothing named after the in-memory partition. Two files appear in a run that has a view and not in one that has none: `Cache/Cache_Data/<hash>_0` (456,073 bytes in every run) and a temporary `.org.chromium.Chromium.Network Persistent State.<random>` (476 or 477 bytes). They also appear for a view that loaded nothing, for a view in the default partition, and (the cache file only) for a second window in an in-memory partition, and the cache file's size never changed, so they are not page data (the test pages are a few hundred bytes), but what they are was not identified (contents not read, by rule). A control view in a `persist:` partition wrote a full `Partitions/probe-persist/` tree (cache, code cache, GPU caches, DIPS) |
| AC10 | not run | no `codex` binary here and the check needs a Codex session; stays with T060 `[KNOWN GAP]` |
| AC11 | **fails by default** | a view attached but `setVisible(false)`: `Page.captureScreenshot` ok (same size as a shown view's) and `Accessibility.getFullAXTree` ok with and without `backgroundThrottling: false`; `Input.dispatchMouseEvent` **timed out** with the default and worked with `backgroundThrottling: false`; `requestAnimationFrame` ran 0 frames in 500 ms by default and 30 with `false` (a shown view: 30). So FR-010 needs `backgroundThrottling: false` for views an agent drives |
| AC12 | **fails** | a view never added to a window: pages load and `getFullAXTree` works, but `Page.captureScreenshot` times out (also with `fromSurface: false`, with `backgroundThrottling: false`), `Input.dispatchMouseEvent` timed out in one run (the first mouse event, `mouseMoved`, hangs; a press and release counted in one run and not in another), and no animation frames run (0). `offscreen: true` gives frames but no screenshot and no counted click. A view attached with bounds outside the window or with zero size: no screenshot. What did work (one run each): a view attached to a **hidden window** (`show: false`) with `backgroundThrottling: false`, with `Page.captureScreenshot` `{ fromSurface: false }` (the default screenshot timed out there), and clicks. FR-110's "never added to the window" is not supported; a hidden helper window is the candidate |
| AC13 | **native dialog shows** | a `confirm` in a shown view, in a hidden view, and in a hidden view with `Page` enabled: a GTK dialog (OK/Cancel) was drawn at the top-left of the screen in all three (screenshot difference of the same box, about 9,000 pixels), the script stayed pending, and the app page stayed responsive. With `Page` enabled `Page.javascriptDialogOpening` arrives **and** the native dialog is shown anyway; `Page.handleJavaScriptDialog` released the script (`true`), but the dialog window was still mapped and drawn 1.5 s later. A hidden session's dialog therefore pops over whatever is shown. (Xvfb without a window manager; not seen on a real desktop) |
| AC14 | not run | Local Network Access needs a page in the public address space; offline everything is loopback; stays a `[KNOWN GAP]` for FR-058 |
| AC15 | ok | the probe processes and their Xvfb displays were checked by PID (none left); the 4 `kill -9` children left none |
| AC16 | done (spec delta 2026-10-24) | FR-025d, FR-010, FR-011, FR-061, FR-066a, FR-023a, FR-058 and FR-110..FR-113 changed; options in R1b; follow-up probe T007, file identification T008 |

**FRs at risk (as found by the probe; the 2026-10-24 spec deltas have since changed them, see spec.md `## Changes`):**

- **FR-025d** (AC8, AC13): CDP does not replace the native dialog; it is shown and stays after `Page.handleJavaScriptDialog`. `prompt()` does not exist. Needs a way to keep the dialog from showing (none found yet) or the FR must be rewritten.
- **FR-066** (AC7): `Input.setIgnoreInputEvents` blocks CDP input too; Watch-only needs another way (for example drop the user's events in the page area before they reach the view).
- **FR-010** (AC11): `backgroundThrottling: false` is needed for driven views (the spec's own condition is met).
- **FR-110** (AC12): a detached view cannot be screenshotted or reliably clicked; use an attached hidden view in a shown window, or a hidden helper window with `fromSurface: false` (one run).
- **FR-023a** (AC9): holds for the partition; two unidentified files in the default profile appear whenever any view exists.
- **FR-061** (AC4): the detector works for mouse and keys; `Input.insertText` is not reported.

### R1b. Mechanisms after the probe (2026-10-24, for the spec delta)

Nothing here ran; each choice is checked by T007 before the task that builds it.

**JS dialogs (FR-025d).** Facts: Electron has no documented `webContents` event for `alert`/`confirm`/`prompt` (`read:` <https://www.electronjs.org/docs/latest/api/web-contents>, whole page; only `will-prevent-unload` for `beforeunload`). Electron's own handler is the private `-run-dialog` listener in `lib/browser/api/web-contents.ts` (`read:` `electron/electron` `main`, 2026-10-24): `if (!prefs || prefs.disableDialogs) return callback(false, '')`, `if (info.dialogType === 'prompt') return callback(false, '')`, and otherwise `dialog.showMessageBox(parent, options)` with `parent = this.getOwnerBrowserWindow()` (no parent: a free-standing box, which matches the top-left GTK box of T010 AC13). `webPreferences.disableDialogs`: "Whether to disable dialogs completely. Overrides `safeDialogs`" (`read:` <https://www.electronjs.org/docs/latest/api/structures/web-preferences>).

| Option | Safety | Calm UI | FR-046 (no main-world `Runtime`) | Verdict |
|---|---|---|---|---|
| A. `disableDialogs: true` on every view; CDP event only for a bar note | No page code; nothing pops over another chat; no call hangs | Nothing drawn, but the user can never answer a dialog | Fits | Chosen first, then **rejected by the owner** (Vikram, 2026-10-24, team chat and PR #682: "a deal breaker, because it takes dialogs away from humans") |
| B. Main-world shim via `Page.addScriptToEvaluateOnNewDocument` replacing `alert`/`confirm`, reporting through `Runtime.addBinding` | The page sees and can call the binding; bypassable (new frames or realms), and then the native dialog shows anyway; a synchronous `confirm` cannot wait for the user | Same as A when it works | An exception: main-world script plus a `Runtime` binding | Rejected |
| C. Native dialogs for the user; `Page.handleJavaScriptDialog` closes them with `accept: false` only while the agent drives (never OK), with a note in the bar and the tool result (`beforeunload` is not a dialog in Electron; FR-025e handles it) | No page code; the user keeps every dialog | `[KNOWN GAP]`s: a hidden session's dialog can show over another chat, and a CDP-answered dialog may stay drawn briefly (T010 AC13); FR-041's confirmation says so | Fits: only `Page` | **Chosen** (owner decision, 2026-10-24) |
| D. Override the private `-run-dialog` listener | Undocumented, internal, can change in any Electron release | Could draw an in-bar answer | Fits | Rejected (unsupported API) |

`prompt()` is unsupported in either case: the renderer throws "prompt() is not supported." (T010 AC8 `sim:`) and the main-process handler refuses the `prompt` type (`read:`). T007 AC1-AC2 measure C's two gaps.

**Watch-only (FR-066a).**

| Option | Works for | Cost | Verdict |
|---|---|---|---|
| A. `Input.setIgnoreInputEvents` on, lifted only around Durbar's own `Input.*` commands on the view's serial queue (FR-049), plus `before-input-event` `preventDefault()` for keys outside that span | Mouse, touch, keys; the agent's commands go through | A few-millisecond window per action in which user input also passes (accepted: Watch-only is not a security boundary); T007 AC4 checks the order holds and whether `insertText` is blocked while ignoring | **Chosen** |
| B. Transparent input-shield `WebContentsView` above the shown view | Mouse (and keys if it takes focus) | One more renderer process; must follow bounds, FR-008 and focus; accessibility of a shielded page | Fallback |
| C. Main interception only | `before-input-event` covers keys only; `input-event` documents no `preventDefault` (`read:` web-contents docs) | Mouse not blockable | Rejected |
| D. HTML overlay in the app page | Nothing: the native view covers the page (T010 AC1) | | Rejected |

**Throttling (FR-010).** `webContents.setBackgroundThrottling(allowed)` exists, and since 28.0.0 "`WebContents.backgroundThrottling` set to false affects all `WebContents` in the host `BrowserWindow`" (`read:` web-contents docs). So "always off" would unthrottle the app page and every view all the time; off only while agent control is on limits that to when an agent can drive. T007 AC3 checks the runtime call on a hidden view.

## R2. Which MCP browser servers can attach to an existing browser

| Server | How it attaches | Where the secret would go | `read:` |
|---|---|---|---|
| `@playwright/mcp` (v0.0.83, 2026-09-28) | `--cdp-endpoint <endpoint>` + `--cdp-header`; or the config file's `browser.cdpEndpoint`, `browser.cdpHeaders`, `browser.cdpTimeout` (`--config <path>`). `--extension`: "Connect to a running browser instance (Edge/Chrome only). Requires the 'Playwright Extension' to be installed." | A 0600 config file; only its path on the command line. | <https://raw.githubusercontent.com/microsoft/playwright-mcp/main/README.md>, `config.d.ts:72-82` (repo `microsoft/playwright-mcp`) |
| `chrome-devtools-mcp` | `--browserUrl` ("a running, debuggable Chrome instance (e.g. `http://127.0.0.1:9222`)"), `--wsEndpoint` + `--wsHeaders` ("Only works with --wsEndpoint"), `--autoConnect` (Chrome 144+, needs remote debugging started in `chrome://inspect`). | `--wsHeaders` on the command line. Whether a config file can carry the headers: not found. | <https://raw.githubusercontent.com/ChromeDevTools/chrome-devtools-mcp/main/docs/configuration.md> |
| Others (Browserbase, Puppeteer-based servers, `mcp-server-browser`) | Not checked. Most launch their own browser or need a hosted service. | | none |

Neither server can attach to an Electron `WebContents` by itself. Each needs a **CDP endpoint**. Durbar would have to serve one itself (R3).

## R3. Core feasibility: a Durbar-served CDP websocket backed by `webContents.debugger`

**What a CDP client needs from a browser-level endpoint.**

- **Playwright `connectOverCDP`** (`read:` `packages/playwright-core/src/server/chromium/chromium.ts` and `crBrowser.ts`, `microsoft/playwright` `main`, 2026-10-23):
  - An `http` endpoint is turned into the websocket URL through `GET <endpoint>/json/version/` (`webSocketDebuggerUrl`). A `ws` endpoint is used as is. Headers go on both requests.
  - On the browser session, `CRBrowser.connect` sends `Browser.getVersion`, then `Target.setAutoAttach {autoAttach:true, waitForDebuggerOnStart:true, flatten:true}`, then a dummy `Target.getTargetInfo`.
  - It finds pages **only** from `Target.attachedToTarget` events (type `page`; `browserContextId` maps to a context, else the default one). It listens for `Target.detachedFromTarget`, `Browser.downloadWillBegin` and `Browser.downloadProgress`.
  - Later calls: `Target.createTarget` (new page), `Target.closeTarget`, `Target.createBrowserContext` and `disposeBrowserContext` (new contexts), `Browser.setDownloadBehavior`, `Browser.grantPermissions` and `resetPermissions`, `Browser.cancelDownload`, `Storage.getCookies`, `setCookies` and `clearCookies`.
  - Each page then gets its page-level domains (`Page`, `Runtime`, `Network`, `DOM`, `Input`, `Emulation`, `Fetch`, ...) on that page's session.
  - Playwright MCP connects with `noDefaults: true` (`packages/playwright-core/src/tools/mcp/browserFactory.ts:131-139`), which skips `Browser.setDownloadBehavior`. It reuses the context's existing pages (`backend/context.ts:479`, `_onPageCreated` for `browserContext.pages()`) and only calls `newPage()` when it has no tab (`ensureTab`, `context.ts:222-229`).
- **Puppeteer** (chrome-devtools-mcp is built on it; `read:` `packages/puppeteer-core/src/cdp/TargetManager.ts`, `Browser.ts`):
  - It also needs `Target.setDiscoverTargets {discover:true}` with `targetCreated`, `targetDestroyed` and `targetInfoChanged`.
  - Its `Target.setAutoAttach {flatten:true, waitForDebuggerOnStart:true}` uses a filter that **excludes pages**, so it attaches to pages itself (`Target.attachToTarget`) and sends `Runtime.runIfWaitingForDebugger`.

**What `webContents.debugger` gives.** A debugger attached to **one page target**. There is no browser target: `Browser.*` and the browser-level `Target.*` (create, close or dispose targets and contexts, discover targets) are not there as a browser would offer them. Child targets of that page (out-of-process iframes, workers) can be auto-attached with `sessionId` routing. The routing is `read:` from the Electron docs; no CDP method was tried on an Electron view.

**Precedent: Playwright already does this emulation.** Its extension mode (`--extension`) runs a relay that faces Playwright as a browser-level CDP endpoint and drives a Chrome tab through `chrome.debugger`. `chrome.debugger` is also a single-page-target transport, like `webContents.debugger`. `read:` `packages/playwright-core/src/tools/mcp/cdpRelay.ts:273-290`, `cdpRelayV2.ts:96-118`, `browserModel.ts:160-247`. What the relay does:

- answers `Browser.getVersion` with a fixed product and `Browser.setDownloadBehavior` with `{}` itself;
- handles `Target.setAutoAttach` by attaching to each known tab and **emitting a synthetic `Target.attachedToTarget`** with its own session id (`pw-tab-N`, `waitingForDebugger:false`);
- answers `Target.createTarget`, `Target.closeTarget` and `Target.getTargetInfo` from its own model;
- forwards a command on a `pw-tab-N` session to that tab with **no** session id, and a command on a child session (OOPIF, worker) to the owning tab **with** its session id;
- sends browser-level commands that carry no session id (`Storage.*`, `Browser.*`) through any attached tab.

**Verdict.**

- **Feasible in principle for Playwright MCP.** Playwright ships the same emulation for the same kind of transport. Durbar would need:
  - a loopback websocket (`/json/version` and one ws path);
  - a per-session token in a header, from a 0600 Playwright MCP config file;
  - that emulation over `webContents.debugger`.
- **Probably feasible for chrome-devtools-mcp**, with more emulation (target discovery, `attachToTarget`). Its token header would sit on the command line (`--wsHeaders`), which breaks the 072 FR-031 rule (no secret in argv).
- **Not verified at all.** No code ran.
- **Coupled to undocumented client internals.** The calls above are what today's `main` sends, not a stable contract. The relay is internal to Playwright and changes with it.

**Why it is not the v1 design.**

1. **Raw CDP hands the agent everything**, and Durbar cannot gate it per permission mode:
   - `Runtime.evaluate` (any script);
   - `Storage.getCookies` and `Network.getCookies` (the HttpOnly session cookies of logins the *user* typed);
   - `DOM.setFileInputFiles` (uploads any local file to any site);
   - `Fetch.*` (rewrites requests).

   A method allow-list strong enough to stop these breaks the clients, which call several of them at start.
2. **"Is this a form submit?" cannot be decided per CDP message.** It is an `Input.dispatchMouseEvent`, like any click.
3. **A TCP port, even on 127.0.0.1 with a token, is reachable by every local user and by web pages.** Pages can open websockets to localhost, so it needs Origin checks as well. A Unix socket or named pipe is per user.
4. **It needs `@playwright/mcp` on the machine.** Either `npx` downloads it at session start (network, version drift, supply chain) or it becomes a large bundled dependency.

So the CDP endpoint is recorded as a later, separate option (spec FR-100 `[OUT OF SCOPE]`, Q3).

## R4. How each agent app takes a per-session MCP server (what Durbar already does)

All three already get a per-session server list from Durbar through `StartOptions.mcpServers` (`src/adapters/types.ts:69`; `McpServerSpec` in `src/shared/mcp.ts:12-24`):

- **Copilot (SDK 1.0.22):** `createSession({ mcpServers, disabledMcpServers })` (`src/adapters/copilot.ts:733-734`; SDK `dist/types.d.ts:1609`, `2403`, `2496`). The runtime also loads `~/.copilot/mcp-config.json` by itself; Durbar can only switch those entries off by name. A tool its server marks `readOnlyHint: true` runs without a permission request (`docs/agent-notes.md:136`, `real:` spec 044).
- **Claude Code:** `--mcp-config` JSON, passed in a **private file**, never on the command line (`src/adapters/claude.ts:186-198`, `:210`), with `--strict-mcp-config`. Docs: "`--mcp-config` Load MCP servers from JSON files or strings", "`--strict-mcp-config` Only use MCP servers from `--mcp-config`" (`read:` <https://code.claude.com/docs/en/cli-reference>). Every MCP call reaches the broker as kind `mcp` (`docs/agent-notes.md:136`, `read:`).
- **Codex (codex-cli 0.163):** `thread/start` / `thread/resume` `config.mcp_servers` overrides (`src/adapters/codex.ts:646-647`, `src/adapters/codexMcp.ts:12-37`). Docs: `[mcp_servers.<name>]` with `command`, `args`, `env`, `env_vars`, `cwd`, `enabled_tools`, `disabled_tools`, `startup_timeout_sec` (default 10) (`read:` <https://learn.chatgpt.com/docs/extend/mcp?surface=cli>). Every MCP call reaches the broker as `mcp`.
- **A live session gets a new server only by restarting it** (spec 072 Q7 (a), spec 058 *Restart session with these servers*). Whether any app takes a new server without a restart is not checked (072 `[KNOWN GAP]`).
- **Secrets.** On Claude's CLI transport, `env` and `args` of a server spec become part of the `--mcp-config` JSON. The JSON is a private file today, but the rule from spec 072 FR-031 holds: the token goes in a 0600 file, and only its path goes in `args`.

## R5. The design compared: Durbar's own per-session `durbar-browser` tools vs a CDP endpoint

| | A. `durbar-browser` server (chosen) | B. CDP endpoint for the user's own Playwright / DevTools MCP (later) |
|---|---|---|
| Transport | Durbar's executable as a stdio relay, then a per-user socket or named pipe into main (spec 041 `paths.ts`, `McpSession`, `McpConnection`; 072's relay). No TCP port. | A loopback TCP websocket per session. |
| Secret | 256-bit token in a 0600 file; only its path in `args` (072 FR-031). | Token header in a 0600 Playwright MCP config file. Not possible for chrome-devtools-mcp without argv. |
| What the agent can do | A fixed set of tools (navigate, snapshot, click, type, press key, screenshot, back, wait). Durbar's own code runs each one through `webContents.debugger`. | Anything CDP can do. |
| Per-mode gating | Per tool, plus Durbar's own checks inside the tool: document POST, downloads, file chooser. | Per CDP method only; submits cannot be told from clicks. |
| Show and log each action | Built in: Durbar highlights the target and writes the chat note. | Durbar would have to infer actions from CDP traffic. |
| Dependencies | None new. The relay and socket building blocks are shared with 041 and 072. | `@playwright/mcp` at runtime, plus version coupling. |
| Agent familiarity | Playwright-style names (`browser_navigate`, `browser_snapshot`, ...), so models already know the shape. | The real Playwright tools. |
| Feasibility evidence | Each tool maps to documented CDP page-domain methods on one page target (`Page.navigate`, `Accessibility.getFullAXTree`, `DOM.getBoxModel`, `Input.dispatchMouseEvent`, `Input.insertText`, `Input.dispatchKeyEvent`, `Page.captureScreenshot`, `Overlay.highlightNode`). Nothing browser-level is needed. | Needs browser-level emulation (R3). |
| Owner input | Matches Vikram's and Paco's comments on #556 (2026-10-22: a per-session `durbar-browser` server, the 072 pattern, driven in-process through `webContents.debugger`, no debugging port). | Not discussed. |

## R6. Repo facts the plan reuses

- **No tabs in the chat panel today.** `openPanel` builds a header, *Previous sessions*, `#chat`, the answer bar and the composer (`src/renderer/app.js:1866-1895`).
- **Chat links.** A click on a chat Markdown link calls `bridge.openExternal`. Only http(s) URLs leave the app, and main checks them again (`src/renderer/app.js:2245-2250`, `src/main/ipc/app.ts:22-26`).
- **Main window hardening:** no popups, a navigation guard, a web-permission allow-list (`src/main/main.ts:774-785`, `src/main/hardening.ts:9-29`; spec 045 FR-004, FR-005). Privileged IPC is answered only for the app's own main frame (`senderAllowed`, `hardening.ts:32-34`). A view with no preload cannot call IPC at all.
- **Spec 041:** Durbar never gives its own control server to its agents (FR-030), and its bridge refuses a caller with the agent marker (FR-034). So the browser tools need their own server, like 072's `durbar-loop` (072 FR-030, FR-031, `specs/072-self-paced-loops/spec.md:222-234`).
- **Not built yet:** the relay core (041 T018, 072 T033) and the 072 loop host (072 T032). This spec shares them.
- **Grants already have an `mcp:<server>/<tool>` scope** (`src/adapters/permissions.ts:138-141`), and a `url` scope by host (`:129`).

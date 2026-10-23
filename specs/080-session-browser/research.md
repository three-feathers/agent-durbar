# Research: Each session gets its own built-in browser (spec 080)

**Date**: 2026-10-23 | **Issue**: #556 | **Cost**: 0 AI credits. Nothing was run: every finding below is `read:` (official docs, READMEs or source files) unless it says otherwise. No CDP proxy, view or MCP server was built or tried.

## R1. Electron: the embedded view, partitions, the in-process debugger, fuses

- **WebContentsView** is a main-process view that shows a `WebContents`; it is added with `win.contentView.addChildView(view)` and placed with `setBounds`. "Calling `addChildView` on an existing view reorders it to the top." `BrowserView` "has been deprecated since Electron 30 and is replaced by WebContentsView." `read:` <https://www.electronjs.org/docs/latest/api/web-contents-view>, <https://www.electronjs.org/blog/migrate-to-webcontentsview>. The app is on Electron `^44.8.0` (`package.json:192`), so the view is available.
- **A native view is drawn over the page, not inside it.** The view is a separate surface on top of the window's own page, so Durbar's HTML menus, dialogs and toasts cannot be drawn over it. `read:` the API shape above (a child view of `contentView`, ordered by `addChildView`); not shown in a doc sentence and not tried here. Design consequence: FR-008 (hide the view and show a still picture while a Durbar overlay covers it). Check on the simulator first (T012).
- **Partitions.** "If `partition` starts with `persist:`, the page will use a persistent session ... if there is no `persist:` prefix, the page will use an in-memory session." `session.clearStorageData()` with no options clears every storage type; `clearCache()` clears the HTTP cache; `will-download` can be cancelled with `event.preventDefault()`; `setPermissionRequestHandler` answers each web permission. `read:` <https://www.electronjs.org/docs/latest/api/session>, <https://www.electronjs.org/docs/latest/api/structures/web-preferences> (`partition`; `sandbox` default true since Electron 20; `contextIsolation` default true; `nodeIntegration` and `webviewTag` default false).
- **`webContents.debugger`** is "an alternate transport for Chrome's remote debugging protocol": `attach([protocolVersion])`, `sendCommand(method[, params, sessionId])`, a `message` event with `sessionId`, and a `detach` event when "`webContents` is closed or DevTools is invoked for the attached `webContents`." The `sessionId` argument routes a command to a child target attached with `Target.attachToTarget` (flatten mode). A command sent before the first navigation "may not resolve until navigation occurs." `read:` <https://www.electronjs.org/docs/latest/api/debugger>. Same pitfall, `sim:` on Electron 44: `docs/agent-notes.md:102` (load `about:blank` first).
  - It opens **no port** and no pipe: it is an API of the main process. A process outside Durbar cannot reach it.
- **Fuses.** Nine fuses; none covers `--remote-debugging-port` or `webContents.debugger`. `nodeCliInspect` only covers `--inspect`-style flags and `SIGUSR1`. `read:` <https://www.electronjs.org/docs/latest/tutorial/fuses>. Durbar already removes the remote-debugging switches from every packaged build (spec 008 FR-038, `specs/008-packaging-and-release/spec.md:209-210`, `real:` packed Linux). In-process debugging does not touch either, so #423 stays closed.

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

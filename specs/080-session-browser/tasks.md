---
description: "Tasks for spec 080: each session gets its own built-in browser"
---

# Tasks: Each session gets its own built-in browser

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md)

**Prerequisites**:

- Q1-Q5 and the four review questions are decided by the coordinator under Ruben's delegation (spec.md *Clarifications*). No task waits for an owner answer.
- **Phase 2 depends on the shared relay core**, 041 T018's `bridgecore.ts`, which 072 T033 and 080 T033 reuse (proposed on #556). Until it is merged, Phase 2 waits; it does not build a second core.
- **Phase 3 depends on T005** (the cookie-encryption fuse, a spec 008 delta).

**Rules for every task**:

- simulator and `npm test` only; zero AI credits;
- no `--remote-debugging-*` switch;
- no fuse change, except `enableCookieEncryption` in T005 (FR-029);
- no shell;
- never log page content, typed text, URL userinfo or tokens;
- `npm run typecheck && npm run build && npm test` green;
- UI tasks: `check:office` plus screenshots at 1440x900 and 1280x800 with `DURBAR_SIM=15`, and `npm run shots:docs -- --only <drivers>` for linked pictures.

## Format: `[ID] [P?] [Story] Description [FRs]` then the acceptance criteria

---

## Phase 0: Spec deltas and research checks

- [ ] T001 [P] Spec 041 delta. [FR-040, FR-047]
  - FR-030 covers 041's control server only; `durbar-browser` is a separate per-session server, like 072's `durbar-loop`.
  - `isDurbarBridge` (041 T040) learns the browser flag.
  - The browser helper does **not** inherit FR-034's refusal of callers carrying `AGENT_DURBAR_RUNTIME`, because an agent app always starts it; it authenticates by token instead.
  - The relay core is T018's `bridgecore.ts`, shared by three flags.
  - AC1: a dated `## Changes` entry in `specs/041-durbar-mcp/spec.md` names the server, flag, scope, token rule, the FR-034 exception and the shared core.
  - AC2: `npm run specs:check` passes.
- [ ] T002 [P] Spec 045 delta. [FR-010, FR-024, FR-025]
  - The app window rules (FR-004, FR-005) stay as they are.
  - The session browser view has its own rules (080 FR-010, FR-024..FR-028), in the same `src/main/hardening.ts`.
  - AC1: a dated entry in `specs/045-security-sweep/spec.md` points to 080.
  - AC2: that entry lists `viewNavigationAllowed`, the view permission check and the handler builder as 045-owned.
- [ ] T003 [P] Spec 005 delta: the chat panel gets *Chat* and *Browser* tabs. [FR-002, FR-090]
  - AC1: a dated entry in `specs/005-chat-fullscreen-and-agent-strip/spec.md`.
  - AC2: FR-040's 480px rule applies to the tab bar too.
- [ ] T004 [P] Spec 003 delta. [FR-050..FR-056]
  - `durbar-browser` calls are classified as read / url / drive.
  - Read-only denies every `durbar-browser` call (Q1 (a)).
  - Host grants cover url and drive.
  - Main's host enforces the mode too (FR-055) and re-checks the host at run time (FR-056).
  - AC1: a dated entry in `specs/003-permissions-and-approvals/spec.md` quoting the Q1 decision and its delegation line.
- [ ] T005 Spec 008 delta, before T050: turn on the `enableCookieEncryption` fuse. [FR-029, FR-085, Q5]
  - AC1: a dated entry in `specs/008-packaging-and-release/spec.md` adds the fuse to FR-037's list, with the reason (US5), the one-way note and the Linux `basic_text` refusal.
  - AC2: `scripts/check-fuses.js`'s expected values include it (a task in 008's `tasks.md`, done in the PR that flips it).
  - AC3: the delta records what turning it on does to the app window's own cookie store (it is believed empty; to confirm by reading the code).
- [ ] T010 Simulator probe of the Electron assumptions (throwaway branch code, not merged). Results go into research.md R1 as `sim:`, with the Electron version. [Assumptions, FR-008, FR-025, FR-046, FR-061, FR-070, FR-073]
  - AC0: the probe uses **FR-010's exact `webPreferences`, `devTools: false` included**. A dev build with DevTools on proves nothing for packaged builds.
  - AC1: records whether a `WebContentsView` covers an HTML menu drawn by the app's page.
  - AC2: records whether these work through `webContents.debugger` on a view after `about:blank`, with `devTools: false`:
    - `debugger.attach` itself;
    - `Accessibility.getFullAXTree`;
    - `DOM.scrollIntoViewIfNeeded`, `DOM.getContentQuads`, `DOM.focus`;
    - `Overlay.highlightNode`;
    - `Fetch.enable` with a Document pattern, plus `Fetch.requestPaused` for a form POST;
    - `Page.setInterceptFileChooserDialog`.
  - AC3: records whether an in-memory partition's cookie is gone after `clearStorageData()` and a new view.
  - AC4: records whether `input-event` fires for CDP-dispatched input (`Input.dispatchMouseEvent`, `Input.insertText`). If it does, FR-061's detector ignores input while a Durbar `drive` action is in flight.
  - AC5: records whether HTML fullscreen from a view takes the whole window fullscreen (FR-025 keeps it denied unless it can be contained).
  - AC6: zero credits; no process is left (checked by PID).
  - AC7: if any check fails, a spec delta changes the FR that relies on it before Phase 2.

**Checkpoint**: T001-T004 merged, T010 recorded. T005 is needed only before Phase 3.

---

## Phase 1: US1 + US2, the Browser tab and links (MVP, no agent control)

- [ ] T011 [P] [US1] Address parsing in `src/shared/browserurl.ts` and the view navigation predicate `viewNavigationAllowed(url, isMainFrame)` in `src/main/hardening.ts`, with `scripts/test-browserurl.ts` and the 045 hardening tests. [FR-005, FR-024]
  - AC1: `localhost:3000` and `127.0.0.1:8080` become `http://`; `example.com` becomes `https://`.
  - AC2: the frame rules of FR-024:
    - the main frame allows `http:`, `https:` and `about:blank`;
    - subframes also allow `about:srcdoc`, `blob:` and `data:`;
    - `file:`, `chrome:`, `devtools:`, `view-source:`, `filesystem:`, `javascript:` and custom schemes are refused at every level;
    - `data:` and `blob:` are refused in the main frame.
  - AC3: the non-web scheme deny-list (`search-ms:`, `ms-msdt:` and the rest of FR-024) is refused with no *Open* offer. Other custom schemes get the offer only.
  - AC4: text over 2048 characters and text with spaces is refused without a search.
  - AC5: host extraction uses `new URL().hostname`, with userinfo dropped.
  - AC6: linear time on 1 MB input (CPU-time check, `docs/agent-notes.md` timing rule).
- [ ] T012 [US1] `src/main/browser/views.ts`: lazy view per session, partition, hardening, teardown. [FR-001, FR-004, FR-010, FR-012, FR-020, FR-021, FR-023, FR-025..FR-029]
  - AC1: `webPreferences` are exactly FR-010's, from a pure options builder with a unit test:
    - `sandbox`, `contextIsolation`, `webSecurity`, `safeDialogs` true;
    - `nodeIntegration`, `webviewTag`, `allowRunningInsecureContent`, `experimentalFeatures`, `navigateOnDragDrop`, `spellcheck` false;
    - `autoplayPolicy: 'user-gesture-required'`;
    - `devTools` false when packaged;
    - no preload.
  - AC2: the partition name matches `durbar-browser-[0-9a-f]{32}`, never starts with `persist:`, and is never reused (test).
  - AC3: the navigation guard uses T011's predicate, on `will-navigate`, `will-redirect` and `will-frame-navigate`, with the frame passed in.
  - AC4: one pure handler-list builder in `src/main/hardening.ts` installs every handler, and a unit test asserts each one is present and refuses:
    - `setWindowOpenHandler` denies, and a `_blank` link loads in the same view;
    - permission request and check handlers deny all, **fullscreen included**;
    - `setDevicePermissionHandler` returns false, and `setDisplayMediaRequestHandler` denies;
    - `certificate-error` calls `callback(false)`;
    - `select-client-certificate` calls `preventDefault()` and `callback()` with no certificate;
    - `select-bluetooth-device`, `select-hid-device`, `select-serial-port` and `select-usb-device` call `preventDefault()` with an empty choice;
    - `login` is cancelled;
    - JS dialogs are dismissed, with a bar note;
    - `will-prevent-unload` is ignored.
  - AC5: each view gets the Chrome user agent of FR-028 via `setUserAgent`, with no `Electron/` or `agent-durbar/` token (unit test on the UA builder); `app.userAgentFallback` is untouched.
  - AC6: each view starts with `setAudioMuted(true)` (FR-012); the bar toggle is in T015.
  - AC7: teardown on end, remove, folder remove and quit: detach, close, `clearStorageData`, `clearCache`.
  - AC8: no change to `package.json` `electronFuses` or to spec 008's switch removal (diff check). The **one stated exception** is T005's `enableCookieEncryption`, which lands in its own PR.
- [ ] T013 [US1] Soft view cap and memory. [FR-011, FR-023]
  - AC1: a unit test of the unload picker. It never picks:
    - a view whose page was reached by POST;
    - a view with a form field edited since load;
    - a view whose driver is `agent`.
  - AC2: with no candidate, the new view is loaded over the cap and the bar note is shown (test).
  - AC3: sim driver: open 6 browsers with no forms; 4 are loaded, and the 2 others reload with *Reloaded to save memory*.
  - AC4: sim driver: open 6 with an edited form in 5 of them; nothing with an edited form is unloaded.
  - AC5: memory of main plus the view processes with 4 views, measured on Linux and recorded in research.md (`sim:`).
  - AC6: main's memory after 50 sessions start and end, each opening a view, recorded in research.md (`sim:`). Electron keeps each partition's session object until quit (FR-023 `read:` note).
- [ ] T014 [US1] `src/main/ipc/browser.ts` plus preload `DurbarApi` additions: open, navigate, back, forward, reload, stop, bounds, visible, overlay, mute, openSystem. [FR-003]
  - AC1: every handler is `fromApp`-checked, takes a session id looked up in main, and validates bounds (finite, inside the window).
  - AC2: `test:ipcchannels` lists the new channels.
  - AC3: the renderer never receives the view's DOM, text, cookies or storage, only URL, title, loading, muted and driver state. The only pixels it gets are FR-008's still picture, as an in-memory image, never written to disk, logged or copied (a test checks the IPC payload types).
- [ ] T015 [US1] Renderer: tabs, browser bar and pane (`src/renderer/browserpane.js`, `app.js` `openPanel`, `styles.css`, `index.html` script tag). [FR-002, FR-006, FR-007, FR-009, FR-012, FR-090]
  - AC1: `role=tablist` with arrow keys; Chat is the default; Esc behaves as today.
  - AC2: bar text is at least 10.5px; icon plus word for loading, error and *Sound on/off*; `prefers-reduced-motion` is respected.
  - AC3: a `ResizeObserver` sends bounds; full-screen chat works; the tab bar fits a 480px panel.
  - AC4: `check:office` passes with 15 agents, chat open on the Browser tab, at 1440x900 and 1280x800.
  - AC5: screenshots `docs/screenshots/080-browser-*.png` at both sizes, with a driver in `scripts/shots-docs.js` `DOC_SHOTS` if linked.
- [ ] T016 [US1] Overlays win. [FR-008]
  - AC1: one `overlayOpen` / `overlayClose` helper in `app.js`, called by the shared menu, `askDialog`, toasts, the slash list and tooltips over the panel.
  - AC2: main hides the view and the pane shows a `capturePage` still picture, kept in memory only.
  - AC3: a sim driver opens the More menu, a dialog, a toast and the slash list over the browser, and checks each is visible (`elementFromPoint` plus a screenshot).
- [ ] T017 [US2] Chat links open in the session browser. [FR-030, FR-031, FR-033]
  - AC1: an `.md a` http(s) click calls `browser:open` for `ui.selected`'s root session; the URL is checked with `isHttpUrl` (`src/shared/url.ts`) in main.
  - AC2: Ctrl/Cmd+click and the context-menu item *Open in system browser* (shared menu element) go to the existing `app:openExternal`, unchanged.
  - AC3: Settings *Open chat links in* (default Session browser), saved in `SettingsStore` with `parseSettings`.
  - AC4: a test asserts that every other `shell.openExternal` path in FR-033 is untouched:
    - `agents:openElicitationUrl` (`src/main/ipc/questions.ts:46-51`);
    - remote control (`src/main/ipc/remote.ts:24`);
    - harness pages (`src/main/ipc/harness.ts:99`, `:105`);
    - `openRepo` (`src/main/main.ts:866`);
    - MCP sign-in `openUrl` (`src/main/main.ts:162`, `src/main/mcpipc.ts:69-70`);
    - the profile editor preview (`src/renderer/profileeditor.js:302`).
  - AC5: a non-web scheme's *Open* uses a native `dialog.showMessageBox` confirmation with Cancel as the default (spec 054's `confirm` pattern), naming the scheme and host. Deny-listed schemes never get the button.
  - AC6: a sim driver checks that session A's link never loads in B.
- [ ] T018 [US1] [US2] Simulator: test pages and links. [FR-091]
  - AC1: a simulator-only scheme is registered on each view partition only when `DURBAR_SIM` is set, and refused otherwise (test).
  - AC2: bundled pages for a form (POST), links, a download, a file input, a password and a card-number field, a `beforeunload` page, an `alert`, a basic-auth challenge and a slow load.
  - AC3: simulated agents print links to them.
  - AC4: a sim driver covers US1 scenarios 1-5 and US2 scenarios 1-3, including SC-002 and SC-004.
- [ ] T019 [US1] [US2] Docs for Phase 1. [all Phase 1 FRs]
  - AC1: README feature list and *Safety model*: session browser isolation, wiped at the end, no debugging port, muted, the refused permissions and choosers, known limits.
  - AC2: a `changelog.d/080-session-browser.md` fragment.
  - AC3: the spec's `specs-index` status; tasks ticked; `[IMPLEMENTED]` tags with `sim:`/`test:` evidence.

**Checkpoint**: MVP: a browser per session, links open there, nothing new for agents.

---

## Phase 2: US3 + US4, the agent drives its session's browser

**Depends on**: Phase 1 merged, and 041 T018's `bridgecore.ts` merged (the shared relay core).

- [ ] T030 [P] [US3] `src/adapters/permissions.ts`: classification and host grants. [FR-050..FR-054]
  - AC1: `durbar-browser` tools map to read / url / drive by name; an unknown tool of that server is denied.
  - AC2: Read-only denies **every** `durbar-browser` call, read tools included, with FR-051's text (Q1 (a)).
  - AC3: Ask first:
    - read calls ask once, and *Allow for this session* covers every read call of the session;
    - url and drive calls ask, and a host grant (`browser:<host>`) covers later calls to that host only;
    - FR-070 and FR-071 still ask.
  - AC4: Allow all allows.
  - AC5: tests run for the broker paths of all three adapters (SC-005).
- [ ] T031 [P] [US3] `src/shared/browserserver.ts`: reserved name, flag, token-file argument, frozen `ToolDef`s and input schemas. [FR-040, FR-045, FR-050]
  - AC1: the schemas enforce FR-045's limits.
  - AC2: a test freezes names and schemas; **no tool carries `readOnlyHint`**.
  - AC3: no tool for scripts, cookies, storage, uploads, tabs or other sessions.
- [ ] T032 [US3] `src/main/browser/tokens.ts`: mint, 0600 file in a 0700 per-run folder, delete, launch cleanup, token → session map. [FR-043, FR-044]
  - AC1: a 256-bit token from `crypto.randomBytes`.
  - AC2: file and folder modes are checked on POSIX.
  - AC3: a restart rotates the token, and the old one is refused at once.
  - AC4: SC-006: a planted token is absent from Copilot `mcpServers`, from the Claude `--mcp-config` content and argv, and from the Codex `thread/start` config.
  - AC5: the token is never in a log (redact test).
- [ ] T033 [US3] Browser host and helper on the shared relay core (041 T018's `bridgecore.ts`; reused, never a second copy). [FR-040, FR-043, FR-049, FR-055, FR-056]
  - AC1: the `--durbar-browser-tool <tokenfile>` branch runs at the top of `main.ts`, before any window, store or handler. It follows 041 T018's rules:
    - read the real token-file path first, **then** `app.setPath('userData', <helper-only folder>)`, so Chromium never shares or locks the app's profile;
    - `app.disableHardwareAcceleration()`;
    - no window;
    - `app.dock.hide()` on macOS;
    - exit when stdin ends.
  - AC2: the helper does not apply 041 FR-034's `AGENT_DURBAR_RUNTIME` refusal and refuses to start without a valid token file.
  - AC3: socket or pipe name from `paths.ts` (its own name), unit-tested for win32, darwin and linux.
  - AC4: `McpSession` plus `McpConnection` limits.
  - AC5: SC-003 with two sessions and swapped, dropped and wrong tokens.
  - AC6 (FR-055): a fake caller with a **valid** token, in Read-only, gets `browser_click` and `browser_snapshot` refused by the host itself, with no broker involved.
    - In Ask first, the same caller's `browser_navigate` opens Durbar's own request.
    - A call that already has a broker approval for the same session, tool and host is not asked twice.
  - AC7 (FR-056): a `drive` call whose view moved to another host after the approval is refused with *The page changed; take a new snapshot*. `browser_navigate_back` is classified with the host of the target history entry.
- [ ] T034 [US3] `src/main/browser/snapshot.ts` plus fixtures. [FR-045, FR-065]
  - AC1: AX nodes from the T018 test pages, captured as JSON fixtures, become an outline with `[ref=eN]`, the URL and the title.
  - AC2: the result starts with FR-065's fixed *Page content from <host> (untrusted; …)* line; `browser_wait_for` results do too.
  - AC3: capped at 40,000 characters, with a cut note.
  - AC4: a ref → `backendDOMNodeId` map per snapshot; a stale ref is refused.
  - AC5: fixture nodes for a password field and for `autocomplete="cc-number"` and `"one-time-code"` fields show role and name with `value: "<hidden>"`; their values never appear.
  - AC6: hostile names (huge, control characters) are cleaned in linear time.
- [ ] T035 [US3] `src/main/browser/driver.ts`: the tools over `webContents.debugger`. [FR-042, FR-045, FR-046, FR-049, FR-062]
  - AC1: attach only after `about:blank` has loaded.
  - AC2: one queue per view.
  - AC3: click uses `DOM.scrollIntoViewIfNeeded` and `DOM.getContentQuads` / `getBoxModel`, outlines the target (`Overlay.highlightNode`, about 1 s, instant under reduced motion) and dispatches at the quad centre.
  - AC4: type uses `DOM.focus` and then `Input.insertText`; press key is limited to the allow-list.
  - AC5: screenshot capped at 2 MB; `wait_for` text or 1-30 s.
  - AC6: every action has a timeout and a clear error.
  - AC7: only the domains of FR-046. A test fails if the module sends any `Runtime.*` method, or uses `Page.createIsolatedWorld` without a spec-named case.
- [ ] T036 [US3] Form posts, downloads, uploads. [FR-070..FR-073]
  - AC1: `Fetch` pauses Document non-GET/HEAD requests whenever `driver = agent` and the switch is on, whatever the timing (a test posts 6 s after a click). Ask first asks with the host (`askDialog`); Allow all goes ahead with a chat note. If T010 showed `Fetch` does not work, the plan's fallback is used and a spec delta is written first.
  - AC2: `will-download` is gated by mode and driver state.
  - AC3: allowed agent downloads go to `<Downloads>/Agent Durbar/<session>-<id>/`. Names are sanitised, a path-containment test runs on win32 and posix paths, and downloaded files are never opened.
  - AC4: the file chooser is intercepted and cancelled while `driver = agent`.
  - AC5: unit tests of `policy.ts` cover every mode × driver × event.
- [ ] T037 [US3] Main wiring of the server and the switch. [FR-041, FR-047, FR-048, FR-065]
  - AC1: the server is added to `StartOptions.mcpServers` only while the switch is on.
  - AC2: switching on a live session uses spec 058's restart when idle and is refused while busy.
  - AC3: the folder default setting.
  - AC4: `McpStore` refuses the reserved name and the helper command, through the existing `reserved` lists of `McpStore.upsert(…, reserved)` and `extraNames(reserved)` (`src/main/mcpstore.ts:364`, `:344`). The ambient Copilot entry is disabled.
  - AC5: the MCP dialogs list it as a built-in, with no edit or remove.
  - AC6: adapter option tests for all three apps.
  - AC7: turning the switch on in Allow all, or switching such a session to Allow all, shows FR-065's one-line warning.
- [ ] T038 [US4] Driver state, indicator, takeover, hand back, show-on-use. [FR-060, FR-061, FR-063]
  - AC1: a pure driver state machine with unit tests:
    - it starts as `agent` when the switch is turned on;
    - user input or *Take over* sets `user`;
    - only *Hand back* sets `agent`;
    - no timer changes it.
  - AC2: the indicator text and icon from that state, `aria-live` polite; the 5 s "working" animation only.
  - AC3: user input is detected with the view's `input-event` (mouse, touch and keys), and a sim driver checks that a mouse click takes over. Per T010 AC4, input that arrives while a Durbar `drive` action is in flight is ignored.
  - AC4: while `driver = user`, agent calls wait 3 s, then get the takeover text, with no queue.
  - AC5: *Show the browser when the agent uses it* (default off) switches only on the first url or drive call of a turn.
  - AC6: a desk and strip marker with an accessible name; `check:office` with 15 agents and 5 driving.
- [ ] T039 [US3] [US4] Logging and masking. [FR-022, FR-064]
  - AC1: activity log rows hold the tool name, the host (from `new URL().hostname`) and the result only.
  - AC2: the debug log never has `browser_type` text, snapshots, screenshots or page text (test with planted values).
  - AC3: chat tool-call rows show masked arguments, as today.
  - AC4: a planted `https://u:p@h.example/?code=abc&state=xyz&access_token=` + a `ghp_` shape built at run time loses the userinfo, and its token shapes are masked, in the chat row, the bar's last-action text, the activity row and the debug log.
- [ ] T040 [US3] [US4] Simulator fake agent and driver. [FR-091]
  - AC1: the main-process simulator scripts a session that calls every tool against the test pages.
  - AC2: a sim driver covers US3 scenarios 1-8 and US4 scenarios 1-3, in each mode.
  - AC3: screenshots `docs/screenshots/080-agent-driving-*.png` at both sizes.
- [ ] T041 [US3] Hint for the user's own browser MCP servers (Q2, decided). [Q2]
  - AC1: when a session with `durbar-browser` also has an ambient or extra server whose command or args match `@playwright/mcp` or `chrome-devtools-mcp`, the Browser tab shows the hint with *Turn off for this session* (058's per-session switch).
  - AC2: there is no automatic switch-off.
- [ ] T042 [US3] [US4] Docs for Phase 2. [Phase 2 FRs]
  - AC1: README:
    - *Safety model*: Read-only gives the agent no browser; Ask first is the browse mode; form posts, downloads and uploads; the untrusted-page warning;
    - MCP and Tools text: the built-in `durbar-browser`;
    - known limits, prompt injection included.
  - AC2: a changelog fragment.
  - AC3: tags, the index status, and a `docs/agent-notes.md` entry with T010's findings.

**Checkpoint**: the agent drives only its own session's browser, gated per mode in main as well as in the agent app, visible and interruptible.

---

## Phase 3: US5, keep logins per folder

**Depends on**: Phase 2 merged and **T005** (the `enableCookieEncryption` fuse) merged.

- [ ] T050 [US5] Folder partition id and setting. [FR-080, FR-083, FR-084, FR-085]
  - AC1: a random id saved in `durbar-folders.json` (`FolderStore`, `cleanSchedule`-style validation), `persist:durbar-folder-<id>`, never derived from the path.
  - AC2: two folders never share a partition (test).
  - AC3: removing a folder clears its partition and deletes its folder on disk.
  - AC4: on Linux with `safeStorage.getSelectedStorageBackend() === 'basic_text'`, and in dev runs without fuses (unless `DURBAR_SIM`), turning it on is refused with FR-085's text (unit test with an injected backend).
- [ ] T051 [US5] Confirm, chip, clear, turn off. [FR-081, FR-082]
  - AC1: `askDialog` with **No** focused and FR-081's text.
  - AC2: a folder chip with icon and word.
  - AC3: *Clear browser logins* and *Turn off* clear at once.
  - AC4: a sim driver checks that two sessions of one folder share a cookie and that another folder's session does not.
  - AC5: screenshots at both sizes.
- [ ] T052 [US5] Docs for Phase 3. [Phase 3 FRs]
  - AC1: README *Safety model*: what keeping logins means for agents, cookie encryption, and the Linux keyring refusal.
  - AC2: a changelog fragment; tags and index status.

---

## Real-session check (needs the owner's OK; not CI)

- [ ] T060 One real session per app with `durbar-browser` on, Ask first, against a local test page. Steps: navigate, snapshot, one click, one `type`. Budget: Copilot about 0.5 AI credits, Claude Code `haiku` about $0.01, Codex a few cents (unverified).
  - AC1: costs are announced to the owner before the run.
  - AC2: the spec records `real:` per app: the tools listed, the broker requests seen (and that the host did not ask twice), that the view moved, the usage reported, and the size of the tool definitions in the prompt.

---

## Dependencies and order

- **Phase 0:**
  - T001-T004 can run in parallel;
  - T010 comes before T012 and before any Phase 2 task;
  - T005 comes before T050.
- **Phase 1:**
  - T011 → T012 → T013, then T014 → T015 → T016;
  - T017 needs T014 and T015;
  - T018 can start after T012 and must pass before T019.
- **Phase 2:** needs Phase 1 and **041 T018 `bridgecore.ts`** (shared with 072 T033; proposed on #556).
  - T031 → T032 → T033 → T035 (T030 and T034 run in parallel) → T036 → T037 → T038 → T039 → T040 → T042;
  - T041 any time after T037.
- **Phase 3:** T005 and Phase 2, then T050 → T051 → T052.
- **T060:** last, with the owner's OK.

## Coverage

| Requirement | Tasks |
|---|---|
| FR-001..FR-012 | T012, T013, T014, T015, T016 |
| FR-020..FR-029 (FR-025a..e included) | T002, T011, T012, T017, T019 |
| FR-030..FR-033 | T017, T018 |
| FR-040..FR-049 | T001, T031, T032, T033, T035, T037 |
| FR-050..FR-056 | T004, T030, T033 |
| FR-060..FR-065 | T034, T035, T037, T038, T039 |
| FR-070..FR-073 | T036 |
| FR-080..FR-085 | T005, T050, T051 |
| FR-090..FR-093 | T015, T018, T033, T040 |
| FR-100..FR-102 | none (out of scope) |
| SC-001 | T015, T038 |
| SC-002, SC-004 | T018 |
| SC-003 | T033 |
| SC-005 | T030, T033, T036 |
| SC-006 | T032 |
| SC-007 | T040 |

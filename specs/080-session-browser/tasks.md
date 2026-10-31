---
description: "Tasks for spec 080: each session gets its own built-in browser"
---

# Tasks: Each session gets its own built-in browser

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md)

**Prerequisites**:

- Q1-Q5, Q-P1..Q-P3 and the review questions are decided (spec.md *Clarifications*: Vikram's owner input and the coordinator under Ruben's delegation). No task waits for an answer.
- **T030 merges with `BROWSER_READONLY_READS = false`.** Only the later PR that sets it to `true` needs T006, the constitution amendment for the Read-only read exception (an owner PR on an owned path).
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

- [x] T001 [P] Spec 041 delta. [FR-040, FR-047]
  - FR-030 covers 041's control server only; `durbar-browser` is a separate per-session server, like 072's `durbar-loop`.
  - `isDurbarBridge` (041 T040) learns the browser flag.
  - The browser helper does **not** inherit FR-034's refusal of callers carrying `AGENT_DURBAR_RUNTIME`, because an agent app always starts it; it authenticates by token instead.
  - The relay core is T018's `bridgecore.ts`, shared by three flags.
  - AC1: a dated `## Changes` entry in `specs/041-durbar-mcp/spec.md` names the server, flag, scope, token rule, the FR-034 exception and the shared core.
  - AC2: `npm run specs:check` passes.
- [x] T002 [P] Spec 045 delta. [FR-010, FR-024, FR-025]
  - The app window rules (FR-004, FR-005) stay as they are.
  - The session browser view has its own rules (080 FR-010, FR-024..FR-028), in the same `src/main/hardening.ts`.
  - AC1: a dated entry in `specs/045-security-sweep/spec.md` points to 080.
  - AC2: that entry lists `viewNavigationAllowed`, the view permission check and the handler builder as 045-owned.
- [x] T003 [P] Spec 005 delta: the chat panel gets *Chat* and *Browser* tabs. [FR-002, FR-090]
  - AC1: a dated entry in `specs/005-chat-fullscreen-and-agent-strip/spec.md`.
  - AC2: FR-040's 480px rule applies to the tab bar too.
- [ ] T004 [P] Spec 003 delta. [FR-050..FR-056]
  - `durbar-browser` calls are classified as read / url / drive.
  - Read-only runs only the read tools on the open page and denies url and drive (Q1 (b), after T006).
  - Host grants cover url and drive.
  - Main's host enforces the mode too (FR-055) and re-checks the host at run time (FR-056).
  - AC1: a dated entry in `specs/003-permissions-and-approvals/spec.md` quoting the Q1 decision and its delegation line.
- [ ] T005 Spec 008 delta, before T050: turn on the `enableCookieEncryption` fuse. [FR-029, FR-085, Q5]
  - AC1: a dated entry in `specs/008-packaging-and-release/spec.md` adds the fuse to FR-037's list, with the reason (US5), the one-way note and the Linux `basic_text` refusal.
  - AC2: `scripts/check-fuses.js`'s expected values include it (a task in 008's `tasks.md`, done in the PR that flips it).
  - AC3: the delta records what turning it on does to the app window's own cookie store (it is believed empty; to confirm by reading the code).
- [ ] T006 Constitution amendment: the **Read-only** exception for `durbar-browser` read tools. Ask first needs no exception, because reads ask per host there (FR-052). [FR-051, Q1 (b)]
  - **Opened by an owner;** Ruben's coordinator drafts it for an owner to open.
  - Outline for principle III, with Paco's limits: in Read-only, Durbar's own per-session browser server may run
    - only its three read tools (snapshot, screenshot, wait), never navigate, click, type or press keys;
    - only on the page already open in that session's browser;
    - only while the session's *Let the agent use this browser* switch is on (default off);
    - never on link-local, metadata or private-network pages, or pages with such frames (FR-058);
    - enforced in Durbar's main process whatever the agent app decides (FR-055);
    - with page text labelled as untrusted (FR-065) and a visible note in the bar.

    Every other MCP call is still denied in Read-only.
  - AC1: an owner PR on `.specify/memory/constitution.md` (an owned path, CODEOWNERS) through `/speckit.constitution`, with a MINOR version bump and the Sync Impact Report. It cites Vikram's approval (PR #647 comment) and Ruben's delegation (#556).
  - AC2: T030 may merge before it, with `BROWSER_READONLY_READS = false`. The PR that sets the constant to `true` (a one-line change plus its tests) does not merge before T006.
- [x] T007 Follow-up simulator probe of the mechanisms the 2026-10-24 delta chose (throwaway code, not merged, as T010: FR-010's `webPreferences` (no `disableDialogs`), `xvfb-run -a`, never `:99`, localhost only). Results go into research.md R1a/R1b as `sim:`, with the Electron version and T010's limits. [FR-010, FR-025d, FR-066a]
  - AC1 (before T012 merges; FR-025d as the owner decided, no `disableDialogs`): a `confirm` in a **hidden** view while another view is shown: is the native dialog drawn over the shown chat, where, does it stay until answered, and **does the box show the page's origin or anything else that names the session** (FR-025d's wrong-session risk) (window list of the Xvfb root plus the screenshot diff T010 AC13 used); and in a shown view, that the user's answer (OK and Cancel, through simulated input on the dialog if possible) reaches the page.
  - AC2 (before T012 merges): while the agent drives, `alert` and `confirm` are closed through `Page.handleJavaScriptDialog` `accept: false`: the script is released, and **how long the native dialog stays drawn** after the answer (several runs; T010 saw 1.5 s or more), and whether `-cancel-dialogs` closes it.
  - AC2c (before T012 merges; FR-025e): with `Page` on, a `beforeunload` page, user activation, and `will-prevent-unload` **not** prevented: no native box is mapped (window list and screenshot, as AC1), so Durbar's box is the only one.
  - AC2b (before T012 merges; FR-025e): on a `beforeunload` page, a link click inside the page: does `will-navigate` (with the target URL) arrive **before** `will-prevent-unload`? Without `preventDefault()` the page stays; after a repeated navigation with `preventDefault()` it leaves; `webContents.close()` without `waitForBeforeUnload` closes with no event. If `will-navigate` comes after, FR-025e's page-started leave stays a `[KNOWN GAP]`.
  - AC3 (before T035): `webContents.setBackgroundThrottling(false)` called **at run time** on an attached, hidden view makes `Input.dispatchMouseEvent` answer and `requestAnimationFrame` run; record whether it also changes the app page's frame rate (Electron's "affects all `WebContents` in the host `BrowserWindow`" note) and whether `setBackgroundThrottling(true)` afterwards restores throttling.
  - AC4 (before T038): Watch-only: with `Input.setIgnoreInputEvents{ignore:true}` a `sendInputEvent` click is ignored; the sequence `ignore:false`, `Input.dispatchMouseEvent` press and release, `ignore:true` on one debugger session counts the CDP click; record whether `Input.insertText` is blocked while ignoring, and whether `before-input-event` `preventDefault()` stops `sendInputEvent` keys and fires for `Input.dispatchKeyEvent`.
  - AC5: zero credits; no process left (checked by PID).
  - Done 2026-10-24 (research R1a-2), with these honest gaps: AC1's user answer reaching the page and the box's text were not checked (no `xdotool`), AC2's `-cancel-dialogs` was not tried, and the dialog stay time is one run `[KNOWN GAP]`. AC2b: `will-navigate` comes after `will-prevent-unload`, so a page-started leave is "Leave, then click again".
  - AC6: a failed AC gets a spec delta before the task named in it (AC1-AC2: T012, AC3: T035, AC4: T038; FR-066a's fallback is the input-shield view). AC1-AC2 results update FR-025d's two `[KNOWN GAP]`s.
- [ ] T008 Identify the two default-profile files of T010 AC9 **without reading their contents** (throwaway probe as T010). [FR-022, FR-023a]
  - AC1: names, sizes and modification times of `Cache/Cache_Data/<hash>_0` and `.org.chromium.Chromium.Network Persistent State.<random>` (and the final `Network Persistent State` file, if any) for: no view; a view that loads nothing; views that load test pages on hosts whose names differ in length by at least 40 characters (`a.localhost` against a long `*.localhost` name). A size that follows the host name length means the file holds host data.
  - AC2: whether they come from the default session's network context (a run with only the app window and a `session.defaultSession` request, no view), recorded.
  - AC3: Chromium's own documentation or source for both names, `read:` with links (for example the network service's persisted server properties and the simple disk cache entry naming).
  - AC4: contents are never opened, printed, hashed or copied; only `stat` data.
  - AC5: research.md R1a records the answer; FR-023a's `[KNOWN GAP]` is closed with `sim:`/`read:` or kept with the reason; if either file carries anything from the pages or hosts visited, a FR-022 spec delta comes first. Before T019.
- [x] T010 Simulator probe of the Electron assumptions (throwaway branch code, not merged). Results go into research.md R1 as `sim:`, with the Electron version. [Assumptions, FR-008, FR-025, FR-046, FR-061, FR-070, FR-073]
  - AC0: the probe uses **FR-010's exact `webPreferences`, `devTools: false` included**. A dev build with DevTools on proves nothing for packaged builds.
  - AC1: records whether a `WebContentsView` covers an HTML menu drawn by the app's page.
  - AC2: records whether these work through `webContents.debugger` on a view after `about:blank`, with `devTools: false`:
    - `debugger.attach` itself, and attaching at view creation with only `Page` enabled (FR-042);
    - `Accessibility.getFullAXTree`;
    - `DOM.scrollIntoViewIfNeeded`, `DOM.getContentQuads`, `DOM.focus`;
    - `Overlay.highlightNode`;
    - `Fetch.enable` with a Document pattern, plus `Fetch.requestPaused` for a form POST;
    - `Page.setInterceptFileChooserDialog`.
  - AC3: records whether an in-memory partition's cookie is gone after `clearStorageData()` and a new view.
  - AC4: records whether `input-event` fires for CDP-dispatched input (`Input.dispatchMouseEvent`, `Input.insertText`). If it does, FR-061's detector ignores input while a Durbar `drive` action is in flight.
  - AC5: records whether HTML fullscreen from a view takes the whole window fullscreen (FR-025 keeps it denied unless it can be contained).
  - AC6: records whether `Fetch` request-stage pausing also pauses each redirect hop of a main-frame navigation (FR-057).
  - AC7: records whether `Input.setIgnoreInputEvents` blocks user input but not `Input.dispatch*` from the debugger (FR-066).
  - AC8: records whether `Page.javascriptDialogOpening` plus `Page.handleJavaScriptDialog` answers `alert`, `confirm`, `prompt` and `beforeunload` with no native dialog shown, both dismissing and passing the user's answer (FR-025d).
  - AC9: `kill -9` of the probe's main process with a view that loaded pages: the user-data tree (file list and sizes, no contents read) is compared before and after, and nothing of the in-memory partition is left (FR-023a).
  - AC10: if it can be done offline with zero credits (codex-cli `app-server`, a temp `CODEX_HOME`, no model call), records whether a Codex-started stdio MCP helper reaches a per-user socket or named pipe from inside Codex's sandbox. Otherwise this check moves to T060 (`[KNOWN GAP]`).
  - AC11: on a **hidden** view (attached, not visible; another chat open): `Page.captureScreenshot`, `Input.dispatchMouseEvent` and `Accessibility.getFullAXTree` work, with and without `backgroundThrottling: false`. If it is needed, FR-010 gets it (a spec delta).
  - AC12: on a **detached** view (never added to the window, FR-110): the same three, plus page loads. If any fails, `webPreferences.offscreen` is tried as the fallback and the result is recorded.
  - AC13: dialogs in a **shown vs a hidden** view, before and with `Page` enabled: does Electron's default dialog block the whole window, and does a hidden session's dialog pop over another chat? The answer is recorded; FR-025d's "held while hidden" rule is checked to work with `Page.handleJavaScriptDialog`.
  - AC14: Chromium's Local Network Access (private network requests from a public page) under FR-025's deny-all permission handlers: is the request blocked, prompted or allowed? Recorded for FR-058.
  - AC15: zero credits; no process is left (checked by PID).
  - AC16: if any check fails, a spec delta changes the FR that relies on it before Phase 2. Done: spec delta 2026-10-24 (FR-010, FR-011, FR-023a, FR-025d, FR-058, FR-061, FR-066a, FR-110..FR-113); the new mechanisms are checked by T007, the unidentified files by T008; AC10 moves to T060 AC3 and AC14 to T043 AC7, both `[KNOWN GAP]`.

**Checkpoint**: T001-T004 merged, T010 recorded and its delta (2026-10-24) written. T007 AC1-AC2 before T012 merges; T008 before T019. T005 is needed only before Phase 3.

---

## Phase 1: US1 + US2, the Browser tab and links (MVP, no agent control)

**What the 2026-10-24 delta (T010 results) changes in Phase 1 now:**

- **T012** builds FR-025d as the owner decided (Vikram, 2026-10-24): no `disableDialogs`; the user answers native dialogs, shown or hidden view. Phase 1 has no agent control, so main never closes a dialog in Phase 1; the `Page.javascriptDialogOpening` handler is built and unit-tested now (it closes with Cancel only when the driver is `agent`), and for a hidden view it raises the toast and marker. T012 also builds FR-025e's *Leave this page?* flow and FR-024's `navigateView()` helper (Paco's review of PR #682). T007 AC1, AC2 and AC2b must be recorded before T012 merges. The builder does **not** set `backgroundThrottling` (Phase 1 views stay throttled).
- **T013**'s unload picker carries the `browser_type`-since-load flag (FR-011), always false in Phase 1, so Phase 2 does not reopen the picker.
- **T015** has the bar's dialog note ready (icon and word, page text); it shows only when main answered a dialog for the agent (Phase 2).
- **T015** AC6 also builds the owner's Q1-Q3: the once-per-app `askDialog` consent, the hidden-dialog toast that brings the session's chat forward with its marker, and the *Leave this page?* box (owner decisions, Vikram, 2026-10-24, relayed on PR #682).
- **T011** is reopened for FR-005's delta (userinfo, control characters, the not-an-address reason, `isHttpUrl` reuse) and its Windows-safe timing test.
- **T018** adds `confirm` and `prompt` test pages next to the `alert` one; its driver checks that a native dialog appears for the user and that `prompt()` throws.
- **T019**: the README's known limits say a hidden session's system dialog shows no session name (Durbar's toast names it and brings its chat forward), a dialog answered for the agent may stay drawn (about 10 s on Xvfb, T007), and `prompt()` is unsupported; they do not claim "nothing on disk" beyond the session's partition until T008 closes FR-023a's gap. T008 comes before T019.
- **Not Phase 1:** FR-066a's Watch-only mechanism (T038), FR-061's in-flight rule and `insertText` note (T038), the throttling toggle (FR-041's switch, T037), headless (FR-110, Phase 4), and T010 AC10 and AC14 (T060 AC3, T043 AC7).

- [x] T011 [P] [US1] Address parsing in `src/shared/browserurl.ts` and the view navigation predicate `viewNavigationAllowed(url, isMainFrame)` in `src/main/hardening.ts`, with `scripts/test-browserurl.ts` (which also covers the 045-owned `viewNavigationAllowed`, spec 045 FR-061). [FR-005, FR-024]
  - AC1: `localhost:3000` and `127.0.0.1:8080` become `http://`; `example.com` becomes `https://`.
  - AC2: the frame rules of FR-024:
    - the main frame allows `http:`, `https:` and `about:blank`;
    - subframes also allow `about:srcdoc`, `blob:` and `data:`;
    - `file:`, `chrome:`, `devtools:`, `view-source:`, `filesystem:`, `javascript:` and custom schemes are refused at every level;
    - `data:` and `blob:` are refused in the main frame.
  - AC3: only `mailto:` gets the *Open* offer. A hostile list (`ms-msdt:`, `search-ms:`, `search:`, `ms-officecmd:`, `ms-settings:`, `smb:`, `file:`, `vscode:`, `slack:`, `tel:`, mixed case, leading spaces) is refused with no offer (SC-008).
  - AC4: text over 2048 characters and text with spaces is refused without a search.
  - AC5: host extraction uses `new URL().hostname`, with userinfo dropped.
  - AC6: linear time on 1 MB input (CPU-time check, `docs/agent-notes.md` timing rule). Each case repeats until the small input reaches about 40 ms of CPU, and the big input runs the same count, so a coarse timer (Windows, about 15.6 ms) still measures it; no floor that skips the check and no wall-clock limit (Paco's review of PR #682, items 1 and 9).
  - **Reopened 2026-10-24 by Paco's review of PR #682 (FR-005 delta):**
  - AC7: addresses with userinfo are refused with FR-005's reason: `https://user:pw@example.com`, `https://google.com@evil.com`, `user:pw@example.com` (the test that accepted userinfo is flipped).
  - AC8: `https://a.com/\x01` and `https://a.com/\x7f` are refused (the control-character check is covered by a test, so removing it fails the suite).
  - AC9: `http:example.com` and `https:/example.com` get the not-an-address reason, not the scheme reason.
  - AC10: the web branch of the link classifier calls the existing `isHttpUrl` (`src/shared/url.ts`) instead of its own check.
- [x] T012 [US1] `src/main/browser/views.ts`: lazy view per session, partition, hardening, teardown. [FR-001, FR-004, FR-010, FR-012, FR-020, FR-021, FR-023, FR-025..FR-029] `[KNOWN GAP]` an instant Leave answer is not repeated in real Electron (T007 `sim:`, ERR_FAILED); askDialog is never instant.
  - **Status 2026-10-24 (PR for issue #556, slices 2 and 3):** built and tested (`test:browserviews`, `test:browseripc`): AC1-AC6, AC8, and AC7's teardown at quit (`will-quit`) and, since slice 3, on End session, Remove session, Remove folder and a replaced session (`browserGone` in `src/main/ipc/agents.ts`, `folders.ts`, `previous.ts`; `sim:` `check-browser-tab` covers the view, not the teardown, because the simulator refuses `agents:end`).
  - AC1: `webPreferences` are exactly FR-010's, from a pure options builder with a unit test:
    - `sandbox`, `contextIsolation`, `webSecurity`, `safeDialogs` true;
    - no `disableDialogs` key (FR-025d, owner decision 2026-10-24);
    - no `backgroundThrottling` key (Electron's default; FR-010's run-time toggle is Phase 2);
    - `nodeIntegration`, `webviewTag`, `allowRunningInsecureContent`, `experimentalFeatures`, `navigateOnDragDrop`, `spellcheck` false;
    - `autoplayPolicy: 'user-gesture-required'`;
    - `devTools` false when packaged;
    - no preload.
  - AC2: the partition name matches `durbar-browser-[0-9a-f]{32}`, never starts with `persist:`, and is never reused (test).
  - AC3: the navigation guard uses T011's predicate, on `will-navigate`, `will-redirect` and `will-frame-navigate`, with the frame passed in. Every navigation main starts (`loadURL`, history back, forward and go-to-index, `reload`, `Page.navigate`) goes through one `navigateView()` helper that checks `viewNavigationAllowed(url, true)` first (FR-024; Electron fires no `will-navigate` for them). Tests: `navigateView(view, 'file:///etc/passwd')` is refused and `loadURL` is never called; a grep test finds no other `loadURL`, `navigationHistory.go*`, `reload` or `Page.navigate` call on a view outside the helper.
  - AC4: one pure handler-list builder in `src/main/hardening.ts` installs every handler, and a unit test asserts each one is present and refuses:
    - `setWindowOpenHandler` denies, and a `_blank` link loads in the same view;
    - permission request and check handlers deny all, **fullscreen included**;
    - `setDevicePermissionHandler` returns false, and `setDisplayMediaRequestHandler` denies;
    - `certificate-error` calls `callback(false)`;
    - `select-client-certificate` calls `preventDefault()` and `callback()` with no certificate;
    - `select-bluetooth-device`, `select-hid-device`, `select-serial-port` and `select-usb-device` call `preventDefault()` with an empty choice;
    - `login` is cancelled;
    - the debugger is attached at creation after `about:blank`, with only `Page` enabled (FR-042); the `Page.javascriptDialogOpening` handler closes `alert`/`confirm` through `Page.handleJavaScriptDialog` `accept: false` **only when the driver is `agent`** (never `accept: true`) and otherwise leaves the native dialog to the user (FR-025d); for a **hidden** view (driver not `agent`) it tells the renderer to raise FR-025d's toast, bring that session's chat forward on its Browser tab and set the *Dialog open* marker until `Page.javascriptDialogClosed` (owner decision Q3); dialogs of type `beforeunload` are never answered through CDP (T007 AC2); a unit test covers driver `agent`, `user` and `none`, and a test checks the builder sets no `disableDialogs`;
    - `will-prevent-unload` (FR-025e, owner decision Q1): for the user or `none`, no `preventDefault()` (the navigation is cancelled) and a *Leave this page?* request to the renderer; on Leave, the one-shot 10 s flag plus, when the target is known, a repeated navigation through `navigateView()`; `preventDefault()` only when the flag is set; for the agent and for teardown, `preventDefault()` at once. A unit test covers each driver, Stay, Leave with a known and an unknown target, the flag's expiry, and that Stay never calls `preventDefault()`.
  - AC5: each view gets the Chrome user agent of FR-028 via `setUserAgent`, with no `Electron/` or `agent-durbar/` token (unit test on the UA builder); `app.userAgentFallback` is untouched.
  - AC6: each view starts with `setAudioMuted(true)` (FR-012); the bar toggle is in T015.
  - AC7: teardown on end, remove, folder remove and quit: detach, close, `clearStorageData`, `clearCache`.
  - AC8: no change to `package.json` `electronFuses` or to spec 008's switch removal (diff check). The **one stated exception** is T005's `enableCookieEncryption`, which lands in its own PR.
- [ ] T013 [US1] Soft view cap and memory. [FR-011, FR-023]
  - **Status 2026-10-30:** AC1-AC2 built; AC3 and AC4 built and driven (`check-browser-cap`, `test:browseripc`): the picker is wired in `controller.ts`, typing seen through `input-event`, form pages through the history's `transitionType`. **AC5 and AC6 (memory measurements) are `[KNOWN GAP]`: not measured yet**, so this task stays open.
  - AC1: a unit test of the unload picker. It never picks:
    - a view whose page was reached by POST;
    - a view with any character key input since its page loaded (from `input-event`);
    - a view with a `durbar-browser` call in flight or one in the current turn of its session;
    - a view where a `browser_type` call ran since its page loaded (`Input.insertText` fires no `input-event`, T010 AC4; always false in Phase 1).

    A view whose driver is `agent` but has no call in the current turn **can** be picked.
  - AC2: with no candidate, the new view is loaded over the cap and the bar note is shown (test).
  - AC3: sim driver: open 6 browsers with no forms; 4 are loaded, and the 2 others reload with *Reloaded to save memory*.
  - AC4: sim driver: open 6 views and type characters into 5 of them after load; none of those 5 is unloaded.
  - AC5: memory of main plus the view processes with 4 and with **15 live views, three of them driven at once** by fake agents (FR-013), measured on Linux and recorded in research.md (`sim:`).
  - AC6: main's memory after 50 sessions start and end, each opening a view, recorded in research.md (`sim:`). Electron keeps each partition's session object until quit (FR-023 `read:` note).
- [x] T014 [US1] `src/main/ipc/browser.ts` plus preload `DurbarApi` additions: open, navigate, back, forward, reload, stop, bounds, visible, overlay, mute, openSystem. [FR-003]
  - **Status 2026-10-24 (slice 3):** built (`src/main/ipc/browser.ts`, `src/main/browser/controller.ts`, `src/preload/preload.ts`, `src/shared/api.ts`), tested in `test:browseripc` and `test:ipcchannels`; fifteen channels plus `onBrowserState`; AC3's still picture is T016.
  - AC1: every handler is `fromApp`-checked, takes a session id looked up in main, and validates bounds (finite, inside the window).
  - AC2: `test:ipcchannels` lists the new channels.
  - AC3: the renderer never receives the view's DOM, text, cookies or storage, only URL, title, loading, muted and driver state. The only pixels it gets are FR-008's still picture, as an in-memory image, never written to disk, logged or copied (a test checks the IPC payload types).
- [x] T015 [US1] Renderer: tabs, browser bar and pane (`src/renderer/browserpane.js`, `app.js` `openPanel`, `styles.css`, `index.html` script tag). [FR-002, FR-006, FR-007, FR-009, FR-012, FR-090]
  - AC1: `role=tablist` with arrow keys; Chat is the default; Esc behaves as today.
  - AC2: bar text is at least 10.5px; icon plus word for loading, error, *Sound on/off* and the dialog note of FR-025d (shown only when main answered a dialog for the agent; the user answers the native dialog); `prefers-reduced-motion` is respected.
  - AC3: a `ResizeObserver` sends bounds; full-screen chat works; the tab bar fits a 480px panel.
  - AC4: `check:office` passes with 15 agents, chat open on the Browser tab, at 1440x900 and 1280x800.
  - AC5: screenshots `docs/screenshots/080-browser-*.png` at both sizes, with a driver in `scripts/shots-docs.js` `DOC_SHOTS` if linked.
  - AC6 (FR-025d, FR-025e; owner decisions Q1-Q3, Vikram, 2026-10-24, relayed on PR #682):
    - the **once-per-app** consent through the existing `askDialog` pattern (as `src/renderer/app.js:4892`), no new component: FR-025d's text, *Not now* / *Open the browser*, remembered in `SettingsStore` (parsed by `parseSettings`) and never asked again for any tab, session or launch; *Not now* opens nothing and a chat link goes to the system browser that time (test of the setting, sim driver);
    - a hidden session's dialog: the toast *A page in <session> is asking: "…"* (masked), the session's chat brought forward on its Browser tab with the other chat's composer draft kept, and the *Dialog open* marker until the dialog closes (sim driver);
    - the *Leave this page?* box through `askDialog`, *Leave* / *Stay*, **Stay** focused, and the *Leave, then click again* line when the target is unknown (sim driver).
- [x] T016 [US1] Overlays win. [FR-008]
  - **Status 2026-10-24 (slice 3):** built: one `overlayOpen`/`overlayClose` pair in `app.js` and an observer that finds the shared menu, `askDialog`, toasts, the slash list and popovers (instead of a call at every site); main hides the view, the pane shows the `capturePage` still picture (in memory only). `sim:` `check-browser-tab` opens the More menu, a dialog, a toast and the slash list over the page and checks each (`elementFromPoint`, the picture fills the area, the view is back after); picture `080-browser-overlay-1440x900.png`.
  - AC1: one `overlayOpen` / `overlayClose` helper in `app.js`, called by the shared menu, `askDialog`, toasts, the slash list and tooltips over the panel.
  - AC2: main hides the view and the pane shows a `capturePage` still picture, kept in memory only.
  - AC3: a sim driver opens the More menu, a dialog, a toast and the slash list over the browser, and checks each is visible (`elementFromPoint` plus a screenshot).
- [x] T017 [US2] Chat links open in the session browser. [FR-030, FR-031, FR-033]
  - **Status 2026-10-30:** AC1-AC6 built (`src/main/ipc/browser.ts` `browser:openLink` / `browser:openMail`, `controller.ts` `openLink`, `app.js` `openChatLink`, `openLinkMenu`; `test:chatlinks`, `test:browseripc`, `check-browser-links`). **AC7 moved to T043 AC9** (it needs T043's classifier, Phase 2): a chat-link click while agent control is on is not gated by network class yet; Phase 1 has no agent control, so nothing is exposed now.
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
  - AC5: only a `mailto:` link gets *Open*, which calls `shell.openExternal` after the click; every other non-web scheme gets the refusal text and no button (a test with the T011 hostile list counts zero `shell.openExternal` calls).
  - AC6: a sim driver checks that session A's link never loads in B.
  - AC7 **moved to T043 AC9** (2026-10-30; it needs T043's classifier, Phase 2): the chat-link click while agent control is on. T017 is ticked for AC1-AC6.
- [x] T018 [US1] [US2] Simulator: test pages and links. [FR-091]
  - **Status 2026-10-24 (slice 3):** AC1 and part of AC2 built (`src/main/browser/simpages.ts`: index, links, form POST, GET form, download, file input, slow load, `beforeunload`, and `alert` (delay and count from the query, with a fake token built at run time), `confirm` and `prompt` pages; `test:browseripc` covers the guard; `check-browser-dialogs` uses the `beforeunload` and `alert` pages; no driver answers a `confirm` or `prompt` yet). The password, `one-time-code` and `cc-number` fields, the sliding element, the script redirect and the basic-auth challenge, AC3 and AC4 are open.
  - **Status 2026-10-30:** all ACs built: the pages (fields, sliding element, script redirect to a second host, basic-auth 401, storage, `confirm`/`prompt` answered in `check-browser-scenarios`), simulated agents print links (`links` reply), `check-browser-scenarios` covers US1 1-5 and US2 1-3 with SC-002 and SC-004 (SC-002's cookie half unproven, see the spec).
  - AC1: a simulator-only scheme is registered on each view partition only when `DURBAR_SIM` is set, and refused otherwise (test).
  - AC2: bundled pages for a form (POST), a GET form and a script redirect to another test host, links, a download, a file input, password, `one-time-code` and `cc-number` fields, an element that slides over a button, a `beforeunload` page, an `alert`, a `confirm` and a `prompt` page, a basic-auth challenge and a slow load. The driver checks that each `alert`/`confirm` page raises a native dialog the user can answer (the answer reaches the page) and that `prompt()` throws.
  - AC3: simulated agents print links to them.
  - AC4: a sim driver covers US1 scenarios 1-5 and US2 scenarios 1-3, including SC-002 and SC-004.
- [x] T019 [US1] [US2] Docs for Phase 1. [all Phase 1 FRs]
  - **Status 2026-10-24 (slice 3):** README features, Safety model and Known limits written (AC1), changelog fragment `changelog.d/080-browser-tab.md` (AC2), spec index status (AC3). The README claims only what the simulator checks showed; chat links (T017) and FR-023a's two files are named as open. T008 (identifying the two files) is still open, and the README says so.
  - AC1: README feature list and *Safety model*: session browser isolation, wiped at the end, no debugging port, muted, the refused permissions and choosers, only `mailto:` leaves; known limits, including that downloads may not carry Mark-of-the-Web or quarantine, FR-025d's dialog limits (a hidden session's system dialog shows no session name (Durbar's toast names it and brings its chat forward); a dialog answered for the agent may stay drawn (about 10 s on Xvfb, T007); `prompt()` is unsupported), and, until T008 closes it, that two Chromium files appear in the app's default profile when a view exists (the session's own partition writes nothing).
  - AC2: a `changelog.d/080-browser-tab.md` fragment.
  - AC3: the spec's `specs-index` status; tasks ticked; `[IMPLEMENTED]` tags with `sim:`/`test:` evidence.

**Checkpoint**: MVP: a browser per session, links open there, nothing new for agents.

---

## Phase 1b: US6, page tabs (spec delta 2026-10-31, issue #910)

Owner decisions (Vikram, 2026-10-31 05:17 UTC): *Open chat links in a new tab* is a toggle in the session browser, default off (FR-123); with it on, the same link focuses the tab that has it (FR-124); at most 10 tabs per session, background tabs unloaded first (FR-126). Decided by Vikram's agent (suggested defaults the owner did not change): pages' `target=_blank` opens a tab (FR-125); the agent's own tab in Phase 2 (FR-131). Each task writes its test first where the test can exist before the code. Needs Phase 1 (T012-T017); does not need Phase 2.

- [x] T020 [P] [US6] Pure tab model in `src/main/browser/tabs.ts`, test first (`scripts/test-browsertabs.ts`, a `test:browsertabs` script in `test:serial`). [FR-120, FR-124, FR-126, FR-129]
  - AC1: tab ids are minted only here (`t` + 8 hex, unique per session) and `validTabId` accepts only that shape (test with hostile ids: `''`, `t123`, `T0000000a`, `../`, numbers, objects, 9 hex digits).
  - AC2: the reuse rule: normalised address (`URL.href`, fragment dropped) against committed, `pendingUrl` and `unloadedUrl` addresses of `user` tabs only; the most recently shown match wins; the agent's tab never matches; an unparsable address never matches (tests, including `#top`, trailing slash as WHATWG gives it, userinfo, case of the host).
  - AC3: `MAX_TABS_PER_SESSION = 10` refuses an 11th tab on every path (+, chat link, page request, agent tab), and a chat link at the limit falls back to the active tab (test).
  - AC4: insertion to the right of the active tab; closing the active tab activates right, else left; closing the last tab leaves one empty *New tab* with no view (tests).
  - Done 2026-10-31: `test:` `test:browsertabs` (AC1-AC4, and the tab keys agree in main and the window); AC3/AC4 through the controller in `test:browseripc`. The tests were written in the same change as the module, not committed before it.
- [x] T021 [US6] The cap with tabs: `viewcap.ts` gets `MAX_TABS_PER_SESSION` and a `background` flag in `CapView`; `pickUnload` picks safe background tabs first, then hidden sessions' active tabs; tests first in `test:browseripc` (or the existing viewcap tests). [FR-011, FR-126, SC-010]
  - AC1: SC-010: 3 sessions x 10 tabs, pages loading in turn: never more than `MAX_LIVE_VIEWS` loaded except counted over-cap pages; no 11th tab; background tabs picked first while one is safe.
  - AC2: every FR-011 never-pick rule holds per tab (`byForm`, `charKey`, call in flight or this turn, `browser_type`).
  - AC3: the #891 rule per tab: a main-started navigation of tab A clears only A's `unloadedUrl`/`memory`/`memoryHold`; a restore keeps them as today; tab B's kept address is untouched (test).
  - Done 2026-10-31: `test:` `test:browsertabs` (AC1 as a model, AC2), `test:browseripc` (AC1 through the controller with 3 sessions x 10 tabs, AC3); mutation-checked (the PR lists it).
- [x] T022 [US6] `views.ts`: one partition per session, shared by its tabs; one view per tab from the same builder; closing a tab closes only its `webContents`; session teardown closes every tab, cancels their downloads and clears the partition once after the last view. Tests first in `test:browserviews`. [FR-121, FR-128, FR-023]
  - AC1: two tabs of one session share the partition object; two sessions never do (test with the fakes).
  - AC2: closing one tab never calls `clearStorageData`/`clearCache`; teardown calls each exactly once, after every view is closed (test).
  - AC3: sim driver: a value set in tab 1 is read in tab 2 of the same session and not in another session (extends `check-browser-scenarios`, SC-002); after *End session* no process of any tab is left (SC-004).
  - AC4: a dropped background tab's `webContents` is closed and its process gone; the active tab of a hidden session keeps the `about:blank` drop (sim driver, `check-browser-cap`).
  - Done 2026-10-31: `test:` `test:browserviews` (AC1, AC2, a build in flight at teardown, the last tab closed keeps the partition, the user's close with *Leave this page?* and a hung page); `sim:` `check-browser-tabs` (AC3's teardown with no process left, AC4's closed `webContents`), `check-browser-cap` unchanged and green. AC3's cookie shared between two tabs is `test:` only (the shared partition object), not driven in a page.
- [x] T023 [US6] Controller and IPC: `Tracked` per `(session, tab)`; `browser:newTab`, `selectTab`, `closeTab`, `setLinksNewTab`, `openLink(…, how)`, the `browser:tabs` push and `BrowserState.tabId`; the toggle in `SettingsStore` (`parseSettings` keeps only `chatLinksNewTab: true`); `buildViewHandlers.windowOpen` opens a tab through main (FR-125). Tests first in `test:browseripc`, `test:ipcchannels` and the settings parse test. [FR-123, FR-124, FR-125, FR-127, FR-128, FR-132]
  - AC1: every new channel is `fromApp`-checked, in `SIM_OPEN_CHANNELS` with its reason, and refuses a tab id of another session, a malformed id, an unknown `how`, and a non-boolean toggle, with no effect (tests).
  - AC2: the existing channels act on the active tab only; only the shown session's active tab is attached (test with two tabs: bounds and visible never attach a background tab).
  - AC3: `browser:tabs` and `BrowserState` carry only the listed fields (key-set and type test, as T014 AC3); titles cleaned, URLs through `displayUrl`.
  - AC4: FR-125: a same-origin http(s) `foreground-tab` opens an active tab, `background-tab` an inactive one; a cross-origin or empty referrer, a popup with features, the 6th request in one page load, or any request at 10 tabs gets only the offer; the T011 hostile list makes zero tabs and zero `shell.openExternal` calls; `setWindowOpenHandler` still always returns `deny` (tests).
  - AC5: a tab closed while loading: its late `did-navigate`, `did-fail-load` and dialog events change nothing, its `navigate` promise settling later changes nothing (test with the fake clock and queue).
  - AC6: FR-132: a dialog in a hidden session's background tab marks the tab, raises the toast and selects that tab when the chat is brought forward (once per session); in the shown session's background tab, marker and toast only (test).
  - Done 2026-10-31: `test:` `test:browseripc` (AC1-AC6), `test:ipcchannels`, `test:simguard`, `test:browserviews` (AC4's handler), `test:browserpane` (AC6's window side); `sim:` `check-browser-tabs`.
- [x] T024 [US6] Renderer: the tab strip, the bar's **More** menu with the toggle, and the link menu's *Open in a new tab* (`browserpane.js`, `app.js` `openChatLink`/`openLinkMenu`, `styles.css`); the shared menu element `#modeMenu` is reused, no new menu component. Tests first in `test:browserpane`. [FR-122, FR-123, FR-124, FR-129, FR-133, SC-011]
  - AC1: `role="tablist"` (`aria-label="Pages"`), `role="tab"` with `aria-selected`, `aria-controls`, roving `tabindex`; close buttons are siblings named *Close <title>*; + named *New tab* and disabled at 10 with the limit text (test of the HTML builder).
  - AC2: arrows, Home, End, Enter, Space and Delete on the strip; focus rules of FR-129 (sim driver `check-browser-tabs`, new, with `until()` waits only).
  - AC3: text at least 10.5 px, icon plus word for every state, no motion under `prefers-reduced-motion`; tabs shrink to 72 px, then the strip scrolls inside itself with the active tab in view.
  - AC4: SC-011: `check:office` with 15 agents and one Browser tab holding 10 tabs, at 1440x900 and 1280x800.
  - AC5: the toggle: off by default; on in one session shows checked in another; a plain chat link with it off loads in the active tab (US6.1), on opens a tab (US6.2) and reuses (US6.3); *System browser* in Settings wins (sim driver `check-browser-links`, extended).
  - AC6: screenshots `docs/screenshots/080-browser-tabs-*.png` at both sizes, registered in `scripts/shots-docs.js` `DOC_SHOTS` if linked, and looked at.
  - Done 2026-10-31: `test:` `test:browserpane` (AC1, AC3, the More menu on `#modeMenu`); `sim:` `check-browser-tabs` (AC2, AC5) and `check:office` with 10 tabs (AC4) at both sizes; AC6 `docs/screenshots/080-browser-tabs-1440x900.png` and `-1280x800.png` from `check-browser-tabs`, in `DOC_SHOTS`, linked from the README.
- [x] T025 [US6] Shortcuts: the view's `before-input-event` handles Ctrl/Cmd+T, Ctrl/Cmd+W, Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+PageDown/PageUp with `preventDefault()`; the window's handler does the same in the strip and the bar only; `TAKEN` in `navigator.js` gains the new lines. Tests first in `test:navigator` (the clash sentences) and a pure key-match helper test. [FR-130]
  - AC1: the navigator's key recorder refuses `mod+KeyT`, `ctrl+Tab`, `ctrl+shift+Tab` with their sentence (test).
  - AC2: sim driver: with the focus inside a test page that logs its own `keydown`s, the keys switch, open and close tabs and the page logs none of them; with the focus in the chat composer, Ctrl+W does what it did before.
  - AC3: macOS: whether the app menu's *Close Window* fires first when the focus is in the browser bar is checked on the CI macOS runner or recorded `[KNOWN GAP]` (FR-130); a fix there needs a spec 052 delta first.
  - Done 2026-10-31 on Linux: `test:` `test:navigator` (AC1), `test:browsertabs`, `test:browserviews`; `sim:` `check-browser-tabs` (AC2). AC3 is `[KNOWN GAP]`: not checked on a Mac (the driver skips the Cmd+W composer step there); Windows not run either.
- [x] T026 [US6] Simulator pages and scenarios for tabs (FR-091): a page with same-origin `target=_blank` links (one `rel=noreferrer`), a `window.open` loop of 7, a cross-origin frame that calls `window.open`, and links to each T011 hostile scheme with `target=_blank`; `check-browser-scenarios` (or `check-browser-tabs`) covers US6 scenarios 1-12. [FR-091, FR-125, US6]
  - AC1: every US6 scenario has a named step in a driver, with `sim:` evidence in the spec once green.
  - Done 2026-10-31: `/tabs` and `/keys` in `simpages.ts`; `check-browser-tabs` (new, both sizes) steps US6.1-US6.12. Chromium sends no referrer from the `durbar-sim:` scheme, so the driver serves the same pages on loopback http for FR-125.
- [x] T027 [US6] Docs for tabs. [FR-120..FR-133]
  - AC1: README features and Known limits (the delta's `[KNOWN GAP]`s, no favicons, history lost on a dropped background tab), and *Development* if a new `npm run` name appears.
  - AC2: a `changelog.d/080-browser-tabs.md` fragment.
  - AC3: spec tags `[IMPLEMENTED]` with `sim:`/`test:` evidence, tasks ticked, the `specs-index` note current; T013 AC5 measures 15 sessions with 10 tabs in one of them.
  - Done 2026-10-31: README (features, safety model, known limits, the two screenshots), the shortcut sheet (?) and `changelog.d/080-browser-tabs-build.md` (named after the build branch); spec tags and the `specs-index` note. The memory measurement stays with T013 AC5 (open).

**Checkpoint**: tabs per session; chat links in the active tab by default or a new tab by choice; the cap unchanged in meaning.

---

## Phase 2: US3 + US4, the agent drives its session's browser

**Depends on**: Phase 1 merged; 041 T018's `bridgecore.ts` merged (the shared relay); T030 merges with `BROWSER_READONLY_READS = false`; flipping it to `true` waits for T006.

- [ ] T030 [US3] Classification and modes in `src/adapters/permissions.ts` (shared with main's host). Merges with `BROWSER_READONLY_READS = false`; the flip to `true` is a separate PR after T006. [FR-050..FR-054]
  - AC1: `durbar-browser` tools map to read / url / drive by name; an unknown tool of that server is denied.
  - AC2: Read-only runs `read` tools on the open page and shows *Agent can read this page (Read-only)*; url and drive are denied with FR-051's text. Read calls on metadata, link-local or private LAN pages, or on pages with private or loopback frames, are refused; a loopback page the user opened can be read (FR-051, FR-058). The constant `BROWSER_READONLY_READS` in `src/shared/browserserver.ts` (default `false` until T006 merges) keeps every Read-only read denied and removes `readOnlyHint`; a test covers both settings, including FR-041's two Read-only texts.
  - AC3: Ask first:
    - every call asks, read included, naming the current host (read, drive) or the masked target URL (url), with the label shown as page text;
    - *Allow for this session* writes `browser:<kind>:<host>`, which covers later calls of that kind to that host only; there is no session-wide read grant;
    - FR-070 and FR-071 still ask.
  - AC4: Allow all browses, clicks, types and submits without asking, except FR-058's private LAN ask and the metadata and link-local refusals.
  - AC5: tests run for the broker paths of all three adapters (SC-005).
- [ ] T031 [P] [US3] `src/shared/browserserver.ts`: reserved name, flag, token-file argument, frozen `ToolDef`s and input schemas. [FR-040, FR-045, FR-050]
  - AC1: the schemas enforce FR-045's limits.
  - AC2: a test freezes names and schemas; exactly the three read tools carry `readOnlyHint: true` when `BROWSER_READONLY_READS` is on, and none when it is off.
  - AC3: no tool for scripts, cookies, storage, uploads, tabs or other sessions.
- [ ] T032 [US3] Shared token store `src/main/toolserver/tokens.ts`, **one copy for 072 and 080** (if 072 T032 landed first, reuse it and add only what is missing). [FR-040, FR-043, FR-044]
  - AC1: a 256-bit token from `crypto.randomBytes`; tokens compared with `crypto.timingSafeEqual` on equal-length buffers (a test checks there is no `===` on tokens).
  - AC2: a 0600 file in a 0700 per-run folder, deleted when done, and the folder emptied at launch; modes checked on POSIX.
  - AC3: a restart rotates the token, and the old one is refused at once.
  - AC4: SC-006: a planted token is absent from Copilot `mcpServers`, from the Claude `--mcp-config` content and argv, and from the Codex `thread/start` config.
  - AC5: the token is never in a log (redact test).
  - AC6: no second token store exists under `src/main/browser/` or `src/main/loop/` (a grep test).
- [ ] T033 [US3] Shared tool-server host (`src/main/toolserver/host.ts`, one copy for 072 and 080) plus the browser tools host (`src/main/browser/host.ts`) and the helper flag, on 041 T018's `bridgecore.ts` (reused, never a second copy). [FR-040, FR-043, FR-049, FR-055..FR-058]
  - AC1: the `--durbar-browser-tool <tokenfile>` branch runs at the top of `main.ts`, before any window, store or handler. It follows 041 T018's rules:
    - read the real token-file path first, **then** `app.setPath('userData', <helper-only folder>)`, so Chromium never shares or locks the app's profile;
    - `app.disableHardwareAcceleration()`;
    - no window;
    - `app.dock.hide()` on macOS;
    - exit when stdin ends.
  - AC2: the `AGENT_DURBAR_RUNTIME` refusal is per flag: the 041 bridge flag refuses, and the loop and browser flags do not (a test for each flag). The helper refuses to start without a valid token file.
  - AC3: socket or pipe name from `paths.ts` (its own name), unit-tested for win32, darwin and linux.
  - AC4: `McpSession` plus `McpConnection` limits.
  - AC5: SC-003 with two sessions and swapped, dropped and wrong tokens.
  - AC6 (FR-055): a fake caller with a **valid** token, in Read-only, gets `browser_click` refused by the host itself, with no broker involved; `browser_snapshot` runs only on the open page (after T006).
    - In Ask first, the same caller's `browser_navigate` and `browser_snapshot` each raise a normal `permission` event (`PermissionInfo`, answered through 003 FR-008's IPC), not a new dialog.
    - A broker *approve once* creates a single-use ticket: the first matching host call runs without a second ask; a second call, a different host or a call after 30 s asks again (fake clock).
    - A broker *approve for this session* and the host read the same grant store (one key, one chip).
    - Codex: a `durbar-browser` call is approved at the vendor level and asked once by the host with the host name (test on the Codex permission mapping), or, if that skip is not built, the test documents the double ask.
  - AC7 (FR-056): a `drive` call whose view moved to another host after the approval is refused with *The page changed; take a new snapshot*. `browser_navigate_back` is classified with the host of the target history entry.
- [ ] T034 [US3] `src/main/browser/snapshot.ts` plus fixtures. [FR-045, FR-065]
  - AC1: AX nodes from the T018 test pages, captured as JSON fixtures, become an outline with `[ref=eN]`, the URL and the title.
  - AC2: the result starts with FR-065's fixed *Page content from <host> (untrusted; …)* line; `browser_wait_for` results do too.
  - AC3: capped at 40,000 characters, with a cut note.
  - AC4: a ref → `backendDOMNodeId` map per snapshot; a stale ref is refused.
  - AC5: fixture nodes for a password field and for `autocomplete="cc-number"` and `"one-time-code"` fields show role and name with `value: "<hidden>"`; their values never appear.
  - AC6: hostile names (huge, control characters) are cleaned in linear time.
- [ ] T035 [US3] `src/main/browser/driver.ts`: the tools over `webContents.debugger`. [FR-025d, FR-042, FR-045, FR-046, FR-049, FR-052, FR-062]
  - AC1: attach only after `about:blank` has loaded.
  - AC2: one queue per view.
  - AC3: click:
    - it uses `DOM.scrollIntoViewIfNeeded` and `DOM.getContentQuads` / `getBoxModel`;
    - it outlines the target (`Overlay.highlightNode`, about 1 s, instant under reduced motion);
    - it **hit-tests with `DOM.getNodeForLocation`** at the point and refuses when another element covers it (the T018 sliding-element page);
    - it dispatches at the quad centre.
  - AC4: type uses `DOM.focus` and then `Input.insertText`; press key is limited to the allow-list.
  - AC5: `browser_type` and `browser_press_key` on a password, `one-time-code` or `cc-*` field are refused with *This is a sensitive field; take over to enter it* (fixture page from T018, checked through `DOM.describeNode`).
  - AC6: while the driver is `agent`, every `Page.javascriptDialogOpening` is answered with `Page.handleJavaScriptDialog`: `accept: false` for `alert` and `confirm` (never OK); a `beforeunload` on the agent's navigation is left through FR-025e's `preventDefault()`; the note goes into the bar and the tool result; no call hangs on an `alert`, `confirm` or `beforeunload` page (sim driver). With the driver `user` or `none`, main does not answer (test).
  - AC7: Ask-first requests show the element label as *Page text: "…"*, quoted, cut and masked.
  - AC8: screenshot capped at 2 MB; `wait_for` text or 1-30 s.
  - AC9: every action has a timeout and a clear error.
  - AC10: only the domains of FR-046. A test fails if the module sends any `Runtime.*` method, or uses `Page.createIsolatedWorld` without a spec-named case.
  - AC11: while agent control is on, the view runs with `setBackgroundThrottling(false)`, and `true` again when it is turned off or the session ends (FR-010; per T007 AC3); a sim driver drives a hidden view.
- [ ] T036 [US3] Form posts, downloads, uploads. [FR-070..FR-073]
  - AC1: `Fetch` pauses Document non-GET/HEAD requests whenever the switch is on and the driver is not `user`, whatever the timing (a test posts 6 s after a click, and one between turns). Ask first asks with the host through the existing permission request card (`permission` event, `PermissionInfo`, 003 FR-008 IPC), not `askDialog`; Allow all goes ahead with a chat note. If T010 showed `Fetch` does not work, the plan's fallback is used and a spec delta is written first.
  - AC2: `will-download` is gated by mode and driver state (`none` and `agent` are gated, `user` is not); the Ask-first ask uses the same permission card.
  - AC3: allowed agent downloads go to `<Downloads>/Agent Durbar/<session>-<id>/` under `.durbar-partial-<id>`, renamed when complete. Session and file names are sanitised as FR-023a says (`:`, `<>"/\|?*`, control characters, trailing dots and spaces, `CON`/`PRN`/`AUX`/`NUL`/`COM1-9`/`LPT1-9` with any extension and case, at most 120 characters), and a path-containment test runs on win32 and posix paths. Downloaded files are never opened.
  - AC6: launch cleanup deletes `.durbar-partial-*` files under `<Downloads>/Agent Durbar/` using `lstat`, following no symlink or junction and deleting only regular files with that prefix. Tests with a temp folder: a symlinked session folder pointing elsewhere and a symlink named `.durbar-partial-x` are left alone, and the target files survive (a junction on Windows CI).
  - AC4: the file chooser is intercepted and cancelled whenever the switch is on and the driver is not `user`.
  - AC5: unit tests of `policy.ts` cover every mode × driver × event.
- [ ] T037 [US3] Main wiring of the server and the switch. [FR-041, FR-047, FR-048, FR-065]
  - AC1: the server is added to `StartOptions.mcpServers` only while the switch is on.
  - AC2: switching on a live session uses spec 058's restart when idle and is refused while busy.
  - AC3: the folder default setting.
  - AC4: `McpStore` refuses the reserved name and the helper command, through the existing `reserved` lists of `McpStore.upsert(…, reserved)` and `extraNames(reserved)` (`src/main/mcpstore.ts:364`, `:344`). The ambient Copilot entry is disabled.
  - AC5: the MCP dialogs list it as a built-in, with no edit or remove.
  - AC6: adapter option tests for all three apps.
  - AC7: turning the switch on asks in every mode with FR-041's confirmation, **No** focused (`askDialog`), with the text for the session's current mode and the dialog sentence of FR-041 (a test per mode); the switch turns on only after **Yes**.
  - AC8: switching on in Allow all, or switching such a session to Allow all, shows FR-065's one-line warning.
- [ ] T038 [US4] Driver state, indicator, takeover, hand back, Watch-only, show-on-use (`src/main/browser/driverstate.ts`). [FR-060, FR-061, FR-063, FR-066]
  - AC1: a pure `none`/`agent`/`user` state machine with unit tests:
    - `none` at switch-on, at each turn start only if it was `agent` (never from `user`), and after *Hand back*;
    - `agent` from the first url or drive call until takeover or the end of the turn or session;
    - `user` after input (Co-browsing) or *Take over*;
    - no timer changes it;
    - a turn start resets `agent` to `none` but never `user` (a test: the user takes over, a new turn starts, the driver is still `user` and the page is not gated);
    - the gates are open for `none` and `agent`.
  - AC2: the indicator text and icon from that state, `aria-live` polite; the 5 s "working" animation only.
  - AC3: in Co-browsing, user input (mouse, touch, keys, from `input-event`) takes over; a sim driver checks a mouse click. Per T010 AC4, input that arrives while a Durbar `drive` action is in flight is ignored.
  - AC4: in Watch-only, user input is ignored while the driver is `agent` by FR-066a's rule: `Input.setIgnoreInputEvents{ignore:true}`, lifted only around Durbar's own `Input.*` commands on the view's queue, plus `before-input-event` `preventDefault()` for keys outside that span (per T007 AC4; T010 AC7 showed `ignore:true` alone blocks the agent too). A sim driver checks that a user click is ignored and the agent's click counts; only the bar's *Take over* button takes over. The per-session switch defaults to Co-browsing.
  - AC5: while `driver = user`, agent calls wait 3 s, then get the takeover text, with no queue.
  - AC6: *Show the browser when the agent uses it* (default off) switches only on the first url or drive call of a turn.
  - AC7: a desk and strip marker with an accessible name; `check:office` with 15 agents and 5 driving at once (FR-013).
- [ ] T039 [US3] [US4] Logging and masking. [FR-022, FR-064]
  - AC1: activity log rows hold the tool name, the host (from `new URL().hostname`) and the result only.
  - AC2: the debug log never has `browser_type` text, snapshots, screenshots or page text (test with planted values).
  - AC3: chat tool-call rows show masked arguments, as today.
  - AC4: a planted `https://u:p@h.example/?code=abc&state=xyz&access_token=` + a `ghp_` shape built at run time loses the userinfo, and its token shapes are masked, in the chat row, the bar's last-action text, the activity row and the debug log.
- [ ] T040 [US3] [US4] Simulator fake agent and driver. [FR-091]
  - AC1: the main-process simulator scripts a session that calls every tool against the test pages.
  - AC2: a sim driver covers US3 scenarios 1-11 and US4 scenarios 1-4, in each mode.
  - AC2b: **three fake agents drive three session browsers in parallel**, two of them hidden; no call reaches another view, and no view's call waits on another view's queue (SC-009, FR-013, FR-049).
  - AC3: screenshots `docs/screenshots/080-agent-driving-*.png` at both sizes.
- [ ] T041 [US3] Hint for the user's own browser MCP servers (Q2, decided). [Q2]
  - AC1: when a session with `durbar-browser` also has an ambient or extra server whose command or args match `@playwright/mcp` or `chrome-devtools-mcp`, the Browser tab shows the hint with *Turn off for this session* (058's per-session switch).
  - AC2: there is no automatic switch-off.
- [ ] T043 [P] [US3] `src/shared/netclass.ts` plus `scripts/test-netclass.ts`: the literal host classifier and its use. [FR-058, SC-008]
  - AC1: `169.254.169.254`, `169.254.170.2`, `[fd00:ec2::254]`, `100.100.100.200`, `metadata.google.internal`, `metadata.goog`, `metadata`, `instance-data`, `[fe80::1]` → metadata or link-local. `10.0.0.1`, `172.16.5.4`, `192.168.1.1`, `100.64.0.1`, `[fd12::1]`, `nas.local` → private. `localhost`, `app.localhost`, `127.0.0.2`, `[::1]`, `0.0.0.0`, `0`, `[::]` → loopback. Others → public. Mixed case, trailing dots, decimal and hex IPv4 forms (`2852039166`, `0xA9FEA9FE`) and IPv4-mapped IPv6 are normalised first.
  - AC2: no DNS lookup (the module imports no `dns` or `net` resolver).
  - AC3: while agent control is on, `session.webRequest.onBeforeRequest` on the view's partition cancels every request, of any resource type, to a metadata or link-local host (unit test on the filter builder).
  - AC4: private hosts ask once per host per session in every mode (Read-only denies); loopback does not ask in Allow all.
  - AC5: iframes: with agent control on and a public top-level test page that frames a private and a loopback test host (simulated hosts in the filter test), the subframe and subresource requests are cancelled, and a read call on a page with such a frame is refused, unless the top-level page is that host and the user opened it.
  - AC6: the metadata list matches FR-058's sourced entries plus the three marked own additions.
  - AC8: the classifier extends `blockedAuthHost` (`src/main/mcpsignin.ts`), moved into `src/shared/netclass.ts` and still used by spec 058's sign-in path, whose tests keep passing; there is no second IP-literal parser (a grep test).
  - AC7: Local Network Access (T010 AC14, not run): in a throwaway probe, try marking a loopback test server as public with Chromium's `--ip-address-space-overrides` switch (probe only, never the app; whether Electron 44 honours it is not known), and record whether a private request from that page is blocked, prompted or allowed under FR-025's deny-all handlers. If it cannot be done offline, FR-058's `[KNOWN GAP]` stays and the README says so.
  - AC9 (moved from T017 AC7): while agent control is on, a chat-link click (FR-058): link-local or metadata is refused with only *Open in system browser*; private asks with the mode's text; loopback opens. Uses this classifier; the click path is `openLink` in `src/main/browser/controller.ts`.
- [ ] T044 [US3] Agent-caused navigations count as `url`. [FR-057]
  - AC1: while the switch is on and the driver is not `user`, every main-frame Document request (any method, redirects included per T010 AC6) is paused and checked against host grants and FR-058.
  - AC2: Ask first asks with the full masked URL (userinfo removed, token shapes masked, cut to 300 characters).
  - AC3: a sim driver: a grant for test host A, then a click on a link, a GET form and a script redirect to test host B; each asks and none leaves before the answer.
- [ ] T028 [US3] The agent's own tab (Phase 2, after T035). [FR-131, FR-060, FR-061, FR-066a]
  - AC1: the first `url` or `drive` call makes a tab of kind `agent`, labelled *Agent* with an icon; at 10 tabs the call answers *The browser has too many tabs open; ask the user to close one.* (test).
  - AC2: every tool acts on that tab only; no tool schema has a tab argument and no result carries a tab id (test on the frozen `ToolDef`s, T031); `read` with no agent tab reads the active tab (FR-051).
  - AC3: takeover, Watch-only and the driver state apply to the agent's tab only; input in another tab takes nothing over (sim driver with the fake agent, T040).
  - AC4: a `target=_blank` in the agent's tab loads in that tab; the agent never makes a second tab; FR-124 never reuses its tab (test).
  - AC5: closing the agent's tab: the next `url`/`drive` call makes a new one; a call in flight on it is answered with an error, never moved to another tab (test).
  - AC6: (found while building Phase 1b, 2026-10-31) the tab keys of FR-130 caught in the view's `before-input-event` are ignored while a Durbar `drive` action is in flight (CDP input fires that event, T010 AC4), so the agent can never open, close or switch the user's tabs by typing (test).
- [ ] T042 [US3] [US4] Docs for Phase 2. [Phase 2 FRs]
  - AC1: README:
    - *Safety model*: Read-only lets the agent read only the open page (once T006 is in; before that, no browser), never private-network pages; while agent control is on, private and loopback frames and subresources inside a public page are blocked, also on pages you opened yourself; Ask first is the browse mode and asks per site; form posts, downloads and uploads; the untrusted-page warning;
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
  - AC5: launch cleanup deletes `Partitions/durbar-folder-*` folders whose id no saved folder holds (FR-023a; test with a temp user-data folder).
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

## Phase 4 (later): headless session browsers (owner input)

- [ ] T070 Measure first (sim, Linux; CI for macOS and Windows): a view in a hidden helper window (`show: false`, FR-110). The result goes into research.md before T071. [FR-110, FR-113]
  - AC1: several runs of T010 AC12's working case: `Page.captureScreenshot` `{ fromSurface: false }`, `Accessibility.getFullAXTree`, `Input.dispatchMouseEvent` clicks, with throttling off; how often it fails.
  - AC2: one helper window shared by three headless views against one window per view: does each view still capture and take clicks?
  - AC3: moving a view from the helper window into Durbar's window and back keeps its page, partition and debugger.
  - AC4: CPU and memory against a shown view; if it saves nothing worth having, FR-110..FR-113 are dropped by a spec delta.
- [ ] T071 Headless mode: per-session *Run the browser without a view* (default off), with FR-110's hidden helper window (hardened like the app window, never shown); every rule of the spec holds (shared tests run with the view in the helper window). [FR-110, FR-111, FR-113]
- [ ] T072 The Browser tab and the desk show a headless browser (*Running without a view*, the host, the last action) with *Show* / *Hide*; `check:office`; screenshots. [FR-112]

---

## Real-session check (needs the owner's OK; not CI)

- [ ] T060 One real session per app with `durbar-browser` on, Ask first, against a local test page. Steps: navigate, snapshot, one click, one `type`. Budget: Copilot about 0.5 AI credits, Claude Code `haiku` about $0.01, Codex a few cents (unverified).
  - AC1: costs are announced to the owner before the run.
  - AC2: the spec records `real:` per app: the tools listed, the broker requests seen and whether the user was asked once or twice per call (on Codex, whether `browser_navigate` asked twice or the vendor ask was skipped, FR-055), that the view moved, the usage reported, and the size of the tool definitions in the prompt.
  - AC3: Codex: whether its sandboxed MCP helper reached the per-user socket, if T010 AC10 could not check it offline.

---

## Dependencies and order

- **Phase 0:**
  - T001-T004 can run in parallel;
  - T010 comes before T012 and before any Phase 2 task (done; delta 2026-10-24);
  - T007 AC1-AC2 before T012 merges, AC3 before T035, AC4 before T038;
  - T008 before T019;
  - T005 comes before T050;
  - T006 (owner PR) comes before the PR that sets `BROWSER_READONLY_READS` to `true`, not before T030.
- **Phase 1:**
  - T011 → T012 → T013, then T014 → T015 → T016;
  - T017 needs T014 and T015;
  - T018 can start after T012 and must pass before T019.
- **Phase 1b (tabs, 2026-10-31):** needs T012-T017; T020 and T021 first (tests), then T022 → T023 → T024; T025 and T026 after T023; T027 last. Independent of Phase 2.
- **Phase 2:** needs Phase 1 and **041 T018 `bridgecore.ts`** (shared with 072 T033; proposed on #556).
  - T031 → T032 → T033 → T035 (T030, T034 and T043 run in parallel) → T044 → T036 → T037 → T038 → T039 → T040 → T042;
  - T041 any time after T037.
  - T028 after T035, before T040's driver covers it.
- **Phase 3:** T005 and Phase 2, then T050 → T051 → T052.
- **Phase 4 (later):** Phase 2, then T070 → T071 → T072.
- **T060:** last, with the owner's OK.

## Coverage

| Requirement | Tasks |
|---|---|
| FR-001..FR-013 | T007, T012, T013, T014, T015, T016, T035, T038, T040 |
| FR-020..FR-029 (FR-023a, FR-025a..e included) | T002, T007, T008, T010, T011, T012, T015, T017, T018, T019, T035, T036, T050 |
| FR-030..FR-033 | T017, T018 |
| FR-040..FR-049 | T001, T031, T032, T033, T035, T037 |
| FR-050..FR-058 | T004, T006, T030, T033, T043, T044 |
| FR-060..FR-066 (FR-066a included) | T007, T034, T035, T037, T038, T039 |
| FR-070..FR-073 | T036 |
| FR-080..FR-085 | T005, T050, T051 |
| FR-090..FR-093 | T015, T018, T033, T040 |
| FR-100..FR-103 | none (out of scope or later) |
| FR-110..FR-113 | T070, T071, T072 (later) |
| FR-120..FR-130, FR-132, FR-133 | T020, T021, T022, T023, T024, T025, T026, T027 |
| FR-131 | T028 |
| SC-001 | T015, T038 |
| SC-002, SC-004 | T018 |
| SC-003 | T033 |
| SC-005 | T030, T033, T036 |
| SC-006 | T032 |
| SC-007 | T040 |
| SC-008 | T011, T017, T043 |
| SC-009 | T040 |
| SC-010 | T021 |
| SC-011 | T024 |

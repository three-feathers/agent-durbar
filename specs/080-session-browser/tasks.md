---
description: "Tasks for spec 080: each session gets its own built-in browser"
---

# Tasks: Each session gets its own built-in browser

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md)

**Prerequisites**:

- **Q1 needs an owner answer before T030.** The Read-only rule shapes the broker work.
- Phase 1 (T010-T018) does not depend on Q1-Q3.

**Rules for every task**:

- simulator and `npm test` only; zero AI credits;
- no `--remote-debugging-*` switch, no fuse change;
- no shell;
- never log page content, typed text or tokens;
- `npm run typecheck && npm run build && npm test` green;
- UI tasks: `check:office` plus screenshots at 1440x900 and 1280x800 with `DURBAR_SIM=15`, and `npm run shots:docs -- --only <drivers>` for linked pictures.

## Format: `[ID] [P?] [Story] Description [FRs]` then the acceptance criteria

---

## Phase 0: Spec deltas and research checks

- [ ] T001 [P] Spec 041 delta: FR-030 covers 041's control server only. `durbar-browser` is a separate per-session server, like 072's `durbar-loop`. `isDurbarBridge` (041 T040) learns the browser flag. [FR-040, FR-047]
  - AC1: a dated `## Changes` entry in `specs/041-durbar-mcp/spec.md` names the server, flag, scope and token rule.
  - AC2: `npm run specs:check` passes.
- [ ] T002 [P] Spec 045 delta: the app window rules (FR-004, FR-005) stay as they are. The session browser view has its own rules (080 FR-010, FR-024..FR-028). [FR-010, FR-024]
  - AC1: a dated entry in `specs/045-security-sweep/spec.md` points to 080.
- [ ] T003 [P] Spec 005 delta: the chat panel gets *Chat* and *Browser* tabs. [FR-002, FR-090]
  - AC1: a dated entry in `specs/005-chat-fullscreen-and-agent-strip/spec.md`.
  - AC2: FR-040's 480px rule applies to the tab bar too.
- [ ] T004 [P] Spec 003 delta: `durbar-browser` calls are classified as read / url / drive, and host grants cover url and drive (after Q1). [FR-050..FR-053]
  - AC1: a dated entry in `specs/003-permissions-and-approvals/spec.md` with the Q1 answer quoted.
- [ ] T010 Simulator probe of the Electron assumptions (throwaway branch code, not merged). Results go into research.md R1 as `sim:` with the Electron version. [Assumptions, FR-008, FR-046, FR-070, FR-073]
  - AC1: records whether a `WebContentsView` covers an HTML menu drawn by the app's page.
  - AC2: records whether these work through `webContents.debugger` on a view after `about:blank`: `Accessibility.getFullAXTree`, `Overlay.highlightNode`, `Fetch.enable` with a Document pattern plus `Fetch.requestPaused` for a form POST, and `Page.setInterceptFileChooserDialog`.
  - AC3: records whether an in-memory partition's cookie is gone after `clearStorageData()` and a new view.
  - AC4: zero credits; no process is left (checked by PID).
  - AC5: if any check fails, a spec delta changes the FR that relies on it before Phase 2.

**Checkpoint**: T001-T004 merged, T010 recorded.

---

## Phase 1: US1 + US2, the Browser tab and links (MVP, no agent control)

- [ ] T011 [P] [US1] `src/shared/browserurl.ts` plus `scripts/test-browserurl.ts`: address parsing and the scheme policy. [FR-005, FR-024]
  - AC1: `localhost:3000` and `127.0.0.1:8080` become `http://`; `example.com` becomes `https://`.
  - AC2: `file:`, `chrome:`, `devtools:`, `javascript:`, `data:` and custom schemes are refused with a reason; `about:blank` is allowed.
  - AC3: text over 2048 characters and text with spaces is refused without a search.
  - AC4: linear time on 1 MB input (CPU-time check, `docs/agent-notes.md` timing rule).
- [ ] T012 [US1] `src/main/browser/views.ts`: lazy view per session, partition, hardening, teardown. [FR-001, FR-004, FR-010, FR-020, FR-021, FR-023, FR-025..FR-029]
  - AC1: `webPreferences` exactly as FR-010, with no preload; a unit test on the options builder.
  - AC2: the partition name matches `durbar-browser-[0-9a-f]{32}`, never starts with `persist:`, and is never reused (test).
  - AC3: the navigation guard uses T011, on `will-navigate`, `will-redirect` and `will-frame-navigate`.
  - AC4: `setWindowOpenHandler` denies; a `_blank` link loads in the same view; permission handlers refuse all except fullscreen; `certificate-error` is not overridden.
  - AC5: teardown on end, remove, folder remove and quit (detach, close, `clearStorageData`, `clearCache`).
  - AC6: no change to `package.json` `electronFuses` or to the switch removal in spec 008 (diff check).
- [ ] T013 [US1] View cap and memory: `MAX_LIVE_VIEWS` = 4 with an LRU unload. [FR-011]
  - AC1: a unit test of the LRU picker, which never picks an agent-driven view.
  - AC2: sim driver: open 6 browsers; 4 are loaded, and the 2 others reload with *Reloaded to save memory*.
  - AC3: main process plus view process memory with 4 views is measured on Linux and recorded in research.md (`sim:`).
- [ ] T014 [US1] `src/main/ipc/browser.ts` plus preload `DurbarApi` additions: open, navigate, back, forward, reload, stop, bounds, visible, overlay, openSystem. [FR-003]
  - AC1: every handler is `fromApp`-checked, takes a session id looked up in main, and validates bounds (finite, inside the window).
  - AC2: `test:ipcchannels` lists the new channels.
  - AC3: the renderer never receives page content (only URL, title, loading and driver state).
- [ ] T015 [US1] Renderer: tabs, browser bar and pane (`src/renderer/browserpane.js`, `app.js` `openPanel`, `styles.css`, `index.html` script tag). [FR-002, FR-006, FR-007, FR-009, FR-090]
  - AC1: `role=tablist` with arrow keys; Chat is the default; Esc behaves as today.
  - AC2: bar text is at least 10.5px; icon plus word for loading and error; `prefers-reduced-motion` respected.
  - AC3: a `ResizeObserver` sends bounds; full-screen chat works; the tab bar fits a 480px panel.
  - AC4: `check:office` passes with 15 agents, chat open on the Browser tab, at 1440x900 and 1280x800; screenshots `docs/screenshots/080-browser-*.png` at both sizes, with a driver in `scripts/shots-docs.js` `DOC_SHOTS` if linked.
- [ ] T016 [US1] Overlays win. [FR-008]
  - AC1: one `overlayOpen` / `overlayClose` helper in `app.js`, called by the shared menu, `askDialog`, toasts, the slash list and tooltips over the panel.
  - AC2: main hides the view and the pane shows a `capturePage` still picture (kept in memory only).
  - AC3: a sim driver opens the More menu, a dialog, a toast and the slash list over the browser, and checks each is visible (elementFromPoint plus a screenshot).
- [ ] T017 [US2] Chat links open in the session browser. [FR-030, FR-031, FR-033]
  - AC1: `.md a` http(s) click → `browser:open` for `ui.selected`'s root session.
  - AC2: Ctrl/Cmd+click and the context-menu item *Open in system browser* (shared menu element) → the existing `app:openExternal`, unchanged.
  - AC3: Settings *Open chat links in* (default Session browser), saved in `SettingsStore` with `parseSettings`.
  - AC4: 058 sign-in and 051 setup pages still use `shell.openExternal` (test that their call sites are untouched).
  - AC5: a sim driver checks session A's link never loads in B.
- [ ] T018 [US1] [US2] Simulator: test pages and links. [FR-091]
  - AC1: a simulator-only scheme registered on each view partition only when `DURBAR_SIM` is set; refused otherwise (test).
  - AC2: pages for a form (POST), links, a download, a file input and a slow load, bundled under `src/renderer/sim-pages/` or similar.
  - AC3: simulated agents print links to them.
  - AC4: a sim driver covers US1 scenarios 1-5 and US2 scenarios 1-3, including SC-002 and SC-004.
- [ ] T019 [US1] [US2] Docs for Phase 1. [all Phase 1 FRs]
  - AC1: README feature list and *Safety model* (session browser isolation, wiped at end, no debugging port) and known limits.
  - AC2: a `changelog.d/080-session-browser.md` fragment.
  - AC3: the spec's `specs-index` status; tasks ticked; `[IMPLEMENTED]` tags with `sim:`/`test:` evidence.

**Checkpoint**: MVP: a browser per session, links open there, nothing new for agents.

---

## Phase 2: US3 + US4, the agent drives its session's browser

- [ ] T030 [P] [US3] `src/adapters/permissions.ts`: classification and host grants, per the Q1 answer. [FR-050..FR-054]
  - AC1: `durbar-browser` tools map to read / url / drive by name; an unknown tool of that server is denied.
  - AC2: Read-only allows read and denies url and drive with FR-051's text. Ask first asks for url and drive, and a host grant (`browser:<host>`) covers later calls to that host only. Allow all allows.
  - AC3: tests run for the broker paths of all three adapters (SC-005).
- [ ] T031 [P] [US3] `src/shared/browserserver.ts`: reserved name, flag, token-file argument, frozen `ToolDef`s with `readOnlyHint` and input schemas. [FR-040, FR-045]
  - AC1: the schemas enforce FR-045's limits.
  - AC2: a test freezes names and schemas.
  - AC3: no tool for scripts, cookies, storage, uploads, tabs or other sessions.
- [ ] T032 [US3] `src/main/browser/tokens.ts`: mint, 0600 file in a 0700 per-run folder, delete, launch cleanup, token → session map. [FR-043, FR-044]
  - AC1: a 256-bit token from `crypto.randomBytes`.
  - AC2: file and folder modes checked on POSIX.
  - AC3: the restart rotates the token, and the old one is refused at once.
  - AC4: SC-006: a planted token is absent from Copilot `mcpServers`, the Claude `--mcp-config` content and argv, and the Codex `thread/start` config.
  - AC5: the token is never in a log (redact test).
- [ ] T033 [US3] Relay core and host. Reuse 041 T018 / 072 T033 if merged, else build the shared core here. [FR-040, FR-043, FR-049]
  - AC1: the `--durbar-browser-tool <tokenfile>` branch runs at the top of `main.ts` before any window or store.
  - AC2: socket or pipe name from `paths.ts` (its own name), unit-tested for win32, darwin and linux.
  - AC3: `McpSession` plus `McpConnection` limits.
  - AC4: SC-003 with two sessions and swapped, dropped and wrong tokens.
  - AC5: the helper exits when stdin closes and refuses without a valid token file.
- [ ] T034 [US3] `src/main/browser/snapshot.ts` plus fixtures. [FR-045]
  - AC1: AX nodes from the T018 test pages, captured as JSON fixtures, become an outline with `[ref=eN]`, the URL and the title.
  - AC2: capped at 40,000 characters with a cut note.
  - AC3: a ref → `backendDOMNodeId` map per snapshot; a stale ref is refused.
  - AC4: hostile names (huge, control characters) are cleaned in linear time.
- [ ] T035 [US3] `src/main/browser/driver.ts`: the tools over `webContents.debugger`. [FR-042, FR-045, FR-046, FR-049, FR-062]
  - AC1: attach only after `about:blank` has loaded.
  - AC2: one queue per view.
  - AC3: click scrolls into view, outlines the target (`Overlay.highlightNode`, about 1 s, instant under reduced motion) and dispatches at the box centre.
  - AC4: type uses `Input.insertText`; press key is limited to the allow-list.
  - AC5: screenshot capped at 2 MB; `wait_for` text or 1-30 s.
  - AC6: every action has a timeout and a clear error.
  - AC7: only the domains of FR-046; `Runtime` only with Durbar's fixed expressions (a test greps the module for agent text reaching `Runtime.evaluate`).
- [ ] T036 [US3] Form posts, downloads, uploads. [FR-070..FR-073]
  - AC1: `Fetch` pauses Document non-GET/HEAD requests only while the agent drives. Ask first asks with the host (`askDialog`); Allow all goes ahead with a chat note. If T010 showed `Fetch` does not work, the fallback from the plan is used and a spec delta is written first.
  - AC2: `will-download` is gated by mode and driver.
  - AC3: allowed agent downloads go to `<Downloads>/Agent Durbar/<session>-<id>/`, with names sanitised and a path-containment test on win32 and posix paths; downloaded files are never opened.
  - AC4: the file chooser is intercepted and cancelled while the agent drives.
  - AC5: unit tests of `policy.ts` cover every mode × driver × event.
- [ ] T037 [US3] Main wiring of the server and the switch. [FR-041, FR-047, FR-048]
  - AC1: the server is added to `StartOptions.mcpServers` only while the switch is on.
  - AC2: switching on a live session uses spec 058's restart when idle and is refused while busy.
  - AC3: the folder default setting.
  - AC4: `McpStore` refuses the reserved name and the helper command; the ambient Copilot entry is disabled.
  - AC5: the MCP dialogs list it as a built-in with no edit or remove.
  - AC6: adapter option tests for all three apps.
- [ ] T038 [US4] Driving indicator, takeover, hand back, show-on-use. [FR-060, FR-061, FR-063]
  - AC1: the indicator text and icon, `aria-live` polite.
  - AC2: `before-input-event` on the view makes the user the driver; while the user drives, agent calls wait 3 s and then get the takeover text, with no queue.
  - AC3: *Hand back*.
  - AC4: *Show the browser when the agent uses it* (default off) switches only on the first url or drive call of a turn.
  - AC5: desk and strip marker with an accessible name; `check:office` with 15 agents and 5 driving.
- [ ] T039 [US3] [US4] Logging and masking. [FR-022, FR-064]
  - AC1: the activity log rows hold the tool name, host and result only.
  - AC2: the debug log never has `browser_type` text, snapshots, screenshots or page text (test with planted values).
  - AC3: chat tool-call rows show masked arguments, as today.
- [ ] T040 [US3] [US4] Simulator fake agent and driver. [FR-091]
  - AC1: the main-process simulator scripts a session that calls every tool against the test pages.
  - AC2: a sim driver covers US3 scenarios 1-6 and US4 scenarios 1-3 in each mode.
  - AC3: screenshots `docs/screenshots/080-agent-driving-*.png` at both sizes.
- [ ] T041 [US3] Q2 hint (after the owner's answer). [Q2]
  - AC1: when a session with `durbar-browser` also has an ambient or extra server whose command or args match `@playwright/mcp` or `chrome-devtools-mcp`, the Browser tab shows the hint with *Turn off for this session* (058 per-session switch).
  - AC2: there is no automatic switch-off.
- [ ] T042 [US3] [US4] Docs for Phase 2. [Phase 2 FRs]
  - AC1: README *Safety model* (what each mode allows in the browser, form posts, downloads, uploads), MCP and Tools text (the built-in `durbar-browser`), known limits.
  - AC2: a changelog fragment.
  - AC3: tags, the index status and an `docs/agent-notes.md` entry with T010's findings.

**Checkpoint**: the agent drives only its own session's browser, gated per mode, visible and interruptible.

---

## Phase 3: US5, keep logins per folder

- [ ] T050 [US5] Folder partition id and setting. [FR-080, FR-083, FR-084]
  - AC1: a random id saved in `durbar-folders.json` (`FolderStore`, `cleanSchedule`-style validation), `persist:durbar-folder-<id>`, never derived from the path.
  - AC2: two folders never share a partition (test).
  - AC3: removing a folder clears it and deletes its partition folder.
- [ ] T051 [US5] Confirm, chip, clear, turn off. [FR-081, FR-082]
  - AC1: `askDialog` with **No** focused and FR-081's text.
  - AC2: a folder chip with icon and word.
  - AC3: *Clear browser logins* and *Turn off* clear at once.
  - AC4: a sim driver checks that two sessions of one folder share a cookie and another folder's session does not.
  - AC5: screenshots at both sizes.
- [ ] T052 [US5] Docs for Phase 3. [Phase 3 FRs]
  - AC1: README *Safety model*: what keeping logins means for agents.
  - AC2: a changelog fragment; tags and index status.

---

## Real-session check (needs the owner's OK; not CI)

- [ ] T060 One real session per app with `durbar-browser` on, Ask first, against a local test page. Steps: navigate, snapshot, one click, one `type`. Budget: Copilot about 0.5 AI credits, Claude Code `haiku` about $0.01, Codex a few cents (unverified).
  - AC1: costs are announced to the owner before the run.
  - AC2: the spec records `real:` per app (tools listed, broker requests seen, the view moved), the usage reported, and the size of the tool definitions in the prompt.

---

## Dependencies and order

- **Phase 0:** T001-T004 can run in parallel. T010 comes before T012 and before any Phase 2 task.
- **Phase 1:**
  - T011 → T012 → T013, then T014 → T015 → T016;
  - T017 needs T014 and T015;
  - T018 can start after T012 and must pass before T019.
- **Phase 2:**
  - T030 needs Q1;
  - T031 → T032 → T033 → T035 (T034 runs in parallel) → T036 → T037 → T038 → T039 → T040 → T042;
  - T041 after Q2.
- **Phase 3:** T050 → T051 → T052.
- **T060:** last, with the owner's OK.

## Coverage

| Requirement | Tasks |
|---|---|
| FR-001..FR-011 | T012, T013, T014, T015, T016 |
| FR-020..FR-029 | T011, T012, T019 |
| FR-030..FR-033 | T017, T018 |
| FR-040..FR-049 | T001, T031, T032, T033, T035, T037 |
| FR-050..FR-054 | T004, T030 |
| FR-060..FR-064 | T035, T038, T039 |
| FR-070..FR-073 | T036 |
| FR-080..FR-084 | T050, T051 |
| FR-090..FR-093 | T015, T018, T033, T040 |
| FR-100..FR-102 | none (out of scope) |
| SC-001 | T015, T038 |
| SC-002, SC-004 | T018 |
| SC-003 | T033 |
| SC-005 | T030, T036 |
| SC-006 | T032 |
| SC-007 | T040 |

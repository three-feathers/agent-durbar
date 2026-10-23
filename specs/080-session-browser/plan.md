# Implementation Plan: Each session gets its own built-in browser

**Branch**: `080-session-browser` | **Date**: 2026-10-23 | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)

**Input**: Feature specification from `specs/080-session-browser/spec.md` (issue #556)

## Summary

Each session gets a session browser: one main-owned Electron `WebContentsView` in a **Browser** tab of its chat panel. It has its own in-memory partition, wiped when the session ends.

- **Phase 1 (MVP, no agent control):** the user browses there, and links the agent prints open there.
- **Phase 2:** the agent can drive its own session's browser through a per-session `durbar-browser` MCP server (the 072 `durbar-loop` pattern: a stdio relay, then a per-user socket or pipe, plus a token in a 0600 file).
  - The tools run inside main through `webContents.debugger`, so no debugging port is ever opened.
  - The broker classifies each tool (read / url / drive).
  - Form posts and downloads are paused and gated, uploads refused.
  - The bar shows who is driving, and the user can take over.
- **Phase 3:** the per-folder *Keep browser logins* opt-in, after the `enableCookieEncryption` fuse is on (spec 008 delta, T005; refused on Linux without a keyring).

A CDP endpoint for the user's own Playwright MCP is researched (feasible in principle, R3) but left out (FR-100).

## Technical Context

**Language/Version**: TypeScript (main, shared, adapters), plain JS renderer; Electron `^44.8.0` (`package.json:192`)

**Primary Dependencies**: none new. Electron `WebContentsView`, `session.fromPartition`, `webContents.debugger`; the spec 041 building blocks (`src/main/mcp/paths.ts`, `protocol.ts`, `connection.ts`, `jsonrpc.ts`); the relay core planned in 041 T018 / 072 T033.

**Storage**: none for page data. In memory: views, tokens, downloads list. One 0600 token file per session with agent control (deleted at the end). Phase 3: one partition id per folder in `durbar-folders.json` (an id, no content), plus Chromium's own `persist:` partition folder.

**Testing**: `npm test`, with new pure-module suites plus driver checks under `DURBAR_SIM` (Xvfb on Linux), `check:office`, screenshots at 1440x900 and 1280x800. No real sessions, except T060 with the owner's OK.

**Target Platform**: Windows, macOS, Linux (CI on all three; on-device Linux only)

**Project Type**: desktop app (Electron)

**Performance Goals**: tool overhead ≤ 200 ms excluding page loads (SC-007); at most 4 loaded views (FR-011).

**Constraints**:

- constitution III: no secrets, Read-only denies URL;
- constitution V: 15 agents fit;
- no remote-debugging switch;
- no shell;
- zero credits in tests.

**Scale/Scope**: up to 15 sessions, each with one view; one tab per view.

## Constitution Check

| Principle | How this plan complies |
|---|---|
| I Spec Kit | Spec, plan, research and tasks first. Spec deltas in 041 (FR-030 scope), 045 (view hardening), 005 (panel tabs) and 003 (broker kinds) are tasks (T001-T004) before code. |
| II Adapters are plug-ins | The view, partition and tools live in `src/main/browser/`. Adapters get only a plain `McpServerSpec`, plus the shared pure classification in `permissions.ts` (FR-050, FR-093). The renderer gets typed `browser:*` IPC with no vendor types. |
| III Safe by default | Default off per session (FR-041). Read-only denies every `durbar-browser` call (FR-051, Q1 (a)); main's host enforces the mode itself, whatever the vendor broker said (FR-055), and re-checks the host at run time (FR-056). Page text is labelled untrusted (FR-065). Snapshots hide password, card and one-time-code values; URLs lose userinfo before any log (FR-045, FR-064). The full web-hardening list (FR-010, FR-025..FR-025e). Grants are per host and per session. Form posts, downloads and uploads are gated (FR-070..FR-073). No page content is stored (FR-022). The token is never in argv or env (FR-043). The view has no preload or Node and its own partition (FR-010, FR-020). Remote debugging stays closed (FR-029). |
| III Safe by default, US5 (saved logins) | Saved cookies are credentials. They are written only with the `enableCookieEncryption` fuse on (Q5 (a), FR-085), which is the single stated exception to FR-029's "no fuse change" and lands as a spec 008 delta (T005) before T050. On Linux without a keyring (`basic_text`) the opt-in is refused, never weak. Opt-in per folder, with a confirmation that has **No** focused, and *Clear* at any time (FR-080..FR-084). |
| IV No credits | Simulator test scheme, fake agent in the main-process simulator (FR-091). T060 (real check) is separate and needs the owner's OK. |
| V Calm UI | The tab never opens by itself (FR-007, FR-063). 10.5px minimum, icon plus word (FR-006, FR-060). Overlays win (FR-008). `check:office` (FR-090). No emoji (the issue's "🌐" badge becomes an icon). |
| VI Parity | Paths and pipes in one place, unit-tested for all three OSes (FR-092). The Windows token ACL `[KNOWN GAP]` is inherited from 072. |
| VII Quality gates | Every pure module gets a `scripts/test-*.ts` suite. Driver checks and screenshots for every UI task. |
| VIII Honest limits | `[KNOWN GAP]`s in the spec: shell-opened URLs, popups, cert errors, fetch posts, same-user token. CDP feasibility is marked unverified. |

No violations; Complexity Tracking is empty.

## Architecture

```text
renderer (app.js, new browserpane.js)            main                                       agent app
 Chat | Browser tabs ── browser:* IPC ──►  src/main/browser/views.ts  (one WebContentsView per session,
 bar, indicator, downloads              ◄── browser:state push         partition, nav guard, permissions,
 still picture while overlays open                                      downloads, overlay hide/show)
                                                    │ webContents.debugger (in-process, page target only)
                                         src/main/browser/driver.ts  (tools over CDP: snapshot/refs,
                                                    ▲                   click, type, key, screenshot, Fetch
                                                    │                   pause for POSTs, file chooser block)
                                         src/main/browser/host.ts  (per-user socket/pipe, token→session,
                                                    ▲                McpSession + McpConnection limits)
                                                    │ local socket / named pipe
                                         relay (Durbar exe --durbar-browser-tool <tokenfile>) ◄── stdio ── agent app
```

### Modules

**Pure (unit-tested, no Electron):**

- `src/shared/browserserver.ts`: the reserved name `durbar-browser`, the helper flag `--durbar-browser-tool`, the frozen `ToolDef`s (no `readOnlyHint`, FR-050), and limits.
- `src/shared/browserurl.ts`: address-field parsing (FR-005) and host extraction (`new URL().hostname`, userinfo stripped) only.
- `src/main/hardening.ts` (spec 045's module, extended): `viewNavigationAllowed(url, isMainFrame)` (FR-024 frame rules and scheme deny-list), a deny-all view permission check, and a pure handler-list builder for FR-025..FR-025e, so 045's tests cover the window and the view.
- `src/main/browser/policy.ts`: mode × kind → allow / ask / deny (FR-050..FR-053); the POST and download gate (FR-070, FR-071); downloads folder and file name sanitising (FR-071).
- `src/main/browser/snapshot.ts`: CDP `Accessibility.getFullAXTree` nodes → capped outline text with refs, and a ref → `backendDOMNodeId` map (FR-045). Tested on captured JSON fixtures from the simulator's test pages.
- `src/main/browser/tokens.ts`: token mint, file write and delete (0600 / 0700), token → session map, launch cleanup (FR-043, FR-044).
- `src/adapters/permissions.ts`: the `durbar-browser` classification and the host grant scope (FR-050, FR-052).

**Electron-bound (thin, driver-checked):**

- `src/main/browser/views.ts`:
  - create the view lazily (FR-004) and give it `webPreferences` (FR-010);
  - partition per session (FR-020);
  - wires the `hardening.ts` predicates: `will-navigate` / `will-redirect` / `will-frame-navigate`, `setWindowOpenHandler`, permission, device-permission and display-media handlers, `certificate-error`, `select-client-certificate`, the four device choosers, `login`, JS dialogs, `will-prevent-unload`;
  - per-view Chrome user agent (FR-028) and `setAudioMuted(true)` (FR-012);
  - the `will-download` gate;
  - `setBounds` and visibility from IPC, `capturePage` for FR-008;
  - soft-cap unload (FR-011): never a POSTed page, an edited form or an agent-driven view;
  - teardown (FR-023).
- `src/main/browser/driver.ts`: attach after `about:blank` (FR-042); one queue per view (FR-049); the tools; `Overlay.highlightNode` (FR-062); `Fetch.enable` for Document non-GET only while the agent drives (FR-070); `Page.setInterceptFileChooserDialog` (FR-073); the driver state machine (FR-060) and the takeover detector (FR-061), using the view's `input-event` (mouse, touch and keys; `before-input-event` is keys only), ignoring input while a Durbar `drive` action is in flight if T010 shows CDP input fires it. No `Runtime` in the main world (FR-046): `DOM.scrollIntoViewIfNeeded`, `DOM.getContentQuads`, `DOM.focus`, `DOM.resolveNode`. Host re-check at run time (FR-056).
- `src/main/browser/host.ts`: token → session, and **its own mode and grant check before every call** (FR-055), with the Durbar dialog for Ask first when no broker approval for that call exists. It uses the shared relay core: 041 T018's `bridgecore.ts`, reused by 072 T033 and here (one core, three flags; the coordinator proposes this order on #556). 080 Phase 2 waits for it. The helper follows 041 T018's start rules (FR-040).
- `src/main/ipc/browser.ts`: `browser:open`, `navigate`, `back`, `forward`, `reload`, `stop`, `bounds`, `visible`, `overlay`, `takeover`, `handBack`, `setAgentControl`, `openSystem`, `downloads`. All are `fromApp`-checked, the session is looked up by id, and the inputs are validated. Plus `test:ipcchannels`.

**Renderer:**

- `src/renderer/browserpane.js`: tab bar, browser bar, indicator, downloads list, still picture, and a `ResizeObserver` → `browser:bounds`.
- `app.js`: `openPanel` gets the tabs; the `.md a` click handler routes to the session browser (FR-030, FR-031); every overlay opener calls one `overlayOpen` / `overlayClose` helper that tells main (FR-008).
  - **Reuse:** the shared menu element and `askDialog` for the link context menu and confirmations. The existing grant chips (`renderGrants`) show host grants. Spec 058's restart path is used for FR-041.

**Main wiring** (`main.ts`): add `durbar-browser` to `StartOptions.mcpServers` while the switch is on (FR-041); disabled names and the `McpStore` reserved name (FR-047); teardown hooks on end, remove and quit.

**Simulator** (`src/renderer/sim.ts`, `src/main/mcp/simmain.ts`): links to the test pages; the test-page scheme under `DURBAR_SIM` only (FR-091); a scripted fake agent for the tools.

### Phases

| Phase | Stories | What ships | Gate |
|---|---|---|---|
| 0 Research checks | — | T010: one simulator probe (not committed as a feature). It checks that a view is drawn over the page; that `Fetch`, `Accessibility`, `Page.setInterceptFileChooserDialog` and `Overlay` work through `webContents.debugger` on a `WebContentsView`; and that an in-memory partition is cleared. The results go into research R1 as `sim:`. | Spec deltas T001-T004 merged |
| 1 MVP | US1, US2 | Browser tab, view, partition, hardening, overlays, LRU, links open there, system-browser choice. **No agent control, no new MCP server.** | T010 results |
| 2 Agent control | US3, US4 | `durbar-browser` server, tokens, tools, broker kinds and host-side enforcement, POST/download/upload gates, driver state, takeover, highlight, log, untrusted-content label | Phase 1 merged; 041 T018 `bridgecore.ts` merged |
| 3 Folder logins | US5 | Per-folder persistent partition with confirm, chip, clear, turn off; refused without a keyring | Phase 2 merged; T005 (fuse) merged |
| Later | — | FR-100 CDP endpoint (Q3; needs FR-029 and spec 008 FR-037/FR-038 amended), FR-101 `BROWSER` helper, FR-102 tabs and split (#452) | A new spec |

### Risks

- **Overlay handling (FR-008)** touches every overlay opener in `app.js`. Mitigation: one helper, plus a driver check that opens each overlay kind over the browser.
- **A CDP method missing on a view's debugger.** T010 checks it before Phase 2 is built. If `Fetch` does not work through the debugger, FR-070 falls back to `session.webRequest.onBeforeRequest` filtered on `resourceType: mainFrame/subFrame` and `method`. That hook can cancel a request but cannot ask and resume it, so in that case Ask first would cancel and re-ask: a spec delta.
- **Memory with many views.** FR-011 caps it; T013 measures it on the simulator.
- **Shared relay with 041/072.** Order (decided by the coordinator under Ruben's delegation): 041 T018 builds `bridgecore.ts` first; 072 T033 and 080 T033 reuse it. If 041 T018 stalls, 080 Phase 2 waits; it does not build a second core.
- **Fuse change (Phase 3).** `enableCookieEncryption` is one-way, and it also encrypts the app window's own cookie store. The spec 008 delta (T005) checks that turning it on loses nothing the app needs (the app keeps no cookies of its own today; to confirm in T005).
- **Conflicts:** `package.json` `test:runtime` and `test:serial` lines; `app.js` `openPanel` (PRs touching the chat header). Merge `main` often.

## Project Structure

### Documentation (this feature)

```text
specs/080-session-browser/
├── spec.md
├── plan.md
├── research.md
└── tasks.md
```

### Source Code (planned)

```text
src/shared/browserserver.ts, browserurl.ts
src/main/browser/views.ts, driver.ts, host.ts, policy.ts, snapshot.ts, tokens.ts
src/main/ipc/browser.ts
src/renderer/browserpane.js   (+ app.js, styles.css, index.html, sim.ts)
src/adapters/permissions.ts   (classification only)
scripts/test-browserurl.ts, test-browserpolicy.ts, test-browsersnapshot.ts, test-browsertokens.ts, test-browserhost.ts
scripts/shots-080-browser.js  (driver checks and screenshots)
```

**Structure Decision**: the existing single-project layout. The new main code goes under `src/main/browser/`, like `src/main/mcp/`.

## Complexity Tracking

None.

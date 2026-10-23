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
- **Phase 3:** the per-folder *Keep browser logins* opt-in.

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
| III Safe by default | Default off per session (FR-041). Read-only denies url/drive (FR-051, Q1). Grants are per host and per session. Form posts, downloads and uploads are gated (FR-070..FR-073). No page content is stored (FR-022). The token is never in argv or env (FR-043). The view has no preload or Node and its own partition (FR-010, FR-020). Remote debugging stays closed (FR-029). |
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

- `src/shared/browserserver.ts`: the reserved name `durbar-browser`, the helper flag `--durbar-browser-tool`, the frozen `ToolDef`s with `readOnlyHint` (FR-045), and limits.
- `src/shared/browserurl.ts`: address-field parsing (FR-005), the scheme policy (FR-024), host extraction for grants.
- `src/main/browser/policy.ts`: mode × kind → allow / ask / deny (FR-050..FR-053); the POST and download gate (FR-070, FR-071); downloads folder and file name sanitising (FR-071).
- `src/main/browser/snapshot.ts`: CDP `Accessibility.getFullAXTree` nodes → capped outline text with refs, and a ref → `backendDOMNodeId` map (FR-045). Tested on captured JSON fixtures from the simulator's test pages.
- `src/main/browser/tokens.ts`: token mint, file write and delete (0600 / 0700), token → session map, launch cleanup (FR-043, FR-044).
- `src/adapters/permissions.ts`: the `durbar-browser` classification and the host grant scope (FR-050, FR-052).

**Electron-bound (thin, driver-checked):**

- `src/main/browser/views.ts`:
  - create the view lazily (FR-004) and give it `webPreferences` (FR-010);
  - partition per session (FR-020);
  - `will-navigate` / `will-redirect` / `will-frame-navigate` guard, `setWindowOpenHandler`, permission handlers, `certificate-error`;
  - the `will-download` gate;
  - `setBounds` and visibility from IPC, `capturePage` for FR-008;
  - unload by LRU (FR-011);
  - teardown (FR-023).
- `src/main/browser/driver.ts`: attach after `about:blank` (FR-042); one queue per view (FR-049); the tools; `Overlay.highlightNode` (FR-062); `Fetch.enable` for Document non-GET only while the agent drives (FR-070); `Page.setInterceptFileChooserDialog` (FR-073); the user-input detector for takeover (FR-061), using `before-input-event` on the view's `webContents`.
- `src/main/browser/host.ts` plus the shared relay: like 072 T032/T033. **Coordinate with Ruben and the 041/072 owners: one relay core, three flags.** Build it here if neither lands first.
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
| 2 Agent control | US3, US4 | `durbar-browser` server, tokens, tools, broker kinds, POST/download/upload gates, indicator, takeover, highlight, log | Phase 1 merged; relay core available |
| 3 Folder logins | US5 | Per-folder persistent partition with confirm, chip, clear, turn off | Phase 2 merged |
| Later | — | FR-100 CDP endpoint (Q3), FR-101 `BROWSER` helper, FR-102 tabs and split (#452) | Owner decision |

### Risks

- **Overlay handling (FR-008)** touches every overlay opener in `app.js`. Mitigation: one helper, plus a driver check that opens each overlay kind over the browser.
- **A CDP method missing on a view's debugger.** T010 checks it before Phase 2 is built. If `Fetch` does not work through the debugger, FR-070 falls back to `session.webRequest.onBeforeRequest` filtered on `resourceType: mainFrame/subFrame` and `method`. That hook can cancel a request but cannot ask and resume it, so in that case Ask first would cancel and re-ask: a spec delta.
- **Memory with many views.** FR-011 caps it; T013 measures it on the simulator.
- **Shared relay with 041/072.** Order is undecided. Plan: whoever lands first builds the core, and the others reuse it.
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

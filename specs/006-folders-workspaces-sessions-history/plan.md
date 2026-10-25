# Implementation Plan (as built): Folders, workspaces, sessions and history

**Spec**: [spec.md](spec.md) | **Date**: 2026-10-16 | **Kind**: reverse-engineered

## Summary

The Electron main process owns the map of agents and the saved folder list; the adapter owns runtime sessions. Pure helpers (`folders.ts`, `history.ts`, `workspace.ts`) hold the logic that can be unit tested; the renderer shows rooms, the folders popover, the new-session dialog and the previous-sessions panel.

## Technical Context

- **Language**: TypeScript (main/adapters), JS (renderer).
- **Storage**: `<userData>/durbar-folders.json` (override userData with `DURBAR_USER_DATA` for tests).
- **Testing**: `npm run test:folders`, `npm run test:history` (synthetic fixtures). No test for main-process handlers or the renderer panel.
- **Constraints**: no network, no credits for listing sessions (`listSessions` reads local metadata); history replay is capped.

## Constitution Check

| Principle | Result |
| --- | --- |
| III Safe by default | Saved file holds paths and choices only, mode 0600; IPC takes ids not paths; resume re-validated. Gap: saved `allow` (FR-012). **Partial** |
| IV No credits | Listing/resume UI testable on the simulator. Real resume untested (FR-009). **Partial** |
| VI Parity | `normDir/sameDir` handle win32/darwin case rules; tested with injected platforms. Real macOS/Windows untested. **Partial** |
| VIII Honest limits | README says VS Code visibility is "documented, not verified end to end"; FR-009..011 are new. **Partial** |

## As-built architecture

```text
main.ts: agents Map<id, AgentInfo>  <-> FolderStore (folders.ts)  <-> durbar-folders.json
  add:     dialog -> addMany -> addWorkspace -> adapter.start -> agents.set -> 'agent:added'; persist (upsert)
  restore: app ready -> restoreFolders -> lazy AgentInfo (random UUID id, no session)
  send:    ensureLive(a) -> adapter.start({sessionId: a.id, quiet}) [resume if metadata exists else create with that id] -> adapter.send
  new:     agents:newSession -> addWorkspace (not persisted)       hide/remove: folders:setHidden / folders:remove
  prev:    sessions:listPrevious -> adapter.listPreviousSessions(cwd, exclude open) -> previousSessionsFor(listSessions())
           sessions:resume -> validate id in list -> addWorkspace({resumeSessionId}) -> adapter.history(id) -> eventsToHistory -> (replace pristine agent)
```

Renderer: `addLiveAgent` (rooms keyed by `cwd`), `newSession` dialog, `renderFolders`, `hideFolder`, `removeFolder`, `loadPrev/renderPrev/resumePrev/replayHistory`, `announcePrevious`.

## Project Structure (documentation)

```text
specs/006-folders-workspaces-sessions-history/
├── spec.md
├── plan.md
└── tasks.md
```

## Verification status

| Claim | How | Result |
| --- | --- | --- |
| Folder store behavior | `npm run test:folders` | pass 2026-10-16 |
| Matching and history conversion | `npm run test:history` | pass 2026-10-16 (synthetic fixtures) |
| Lazy start, resume, replace-untouched, hide/remove UI | simulator, screenshots `m6-*` | `sim:` recorded, not re-run |
| Real Copilot resume / lazy start | none | **not verified** |
| macOS/Windows | none | untested |

## Changes 2026-10-20: Pin, Hide and Delete in Previous sessions (issue #368, FR-024..FR-032)

**Data model.** `SavedFolder` (`src/main/folders.ts:16`) gets `prevPinned?: Array<{src, id}>` and `prevHidden?: Array<{src, id}>` (ids only, at most 200 each, tolerant parse like `parseOpenSessions`, `folders.ts:99`). `FolderStore` gets `markPrevious(key, src, id, mark)` (pin clears hide and the reverse; no write when nothing changes) and `dropPrevious(key, src, id)`. Same file, same version; no migration.

**IPC (main, ids only).**

```text
sessions:listPrevious(agentId)       -> { ok, sessions, pinned: id[], hidden: id[] }   exclude = agent ids ∪ resumeIdFor(ids)  (FR-032)
vschat:list(agentId)                 -> { ...as today, pinned: key[], hidden: key[] }
sessions:mark(agentId, src, id, mark) -> { ok }       src ∈ {adapterId of the agent, 'vscode'}; mark ∈ pin|unpin|hide|unhide
sessions:delete(agentId, sessionId)  -> { ok } | { ok:false, error, code?: 'in-office', agentId? }
```

`sessions:delete` body in a new `src/main/prevsessions.ts` (deps: agents, router, store, resumeIdFor, log, inFlight set), tested by `scripts/test-prevsessions.ts` with `FakeAdapter`. `sessions:resume` checks the same in-flight set.

**Adapters.** `capabilities.deleteSession` + `deleteSession?()` (`src/adapters/capabilities.ts`, `types.ts`), router helper `deleteSessionOf`. Copilot: `(await this.getClient()).deleteSession(id)`, refusing `this.sessions.has(id)`. Codex: `this.probe((rpc) => rpc.request('thread/delete', { threadId: id }))`, refusing live ids and live thread ids. Claude: nothing (flag false). Fake: option `deleteSession` with a call log. Contract check C2: member ⇔ flag.

**Renderer.** Pure arranging in `src/renderer/sessionsearch.js` (`arrangeSessions(list, {pinned, hidden, showHidden, query, timeKey})` → `{rows:[{item, pinned, hidden}], hiddenCount, total}`), so ordering, hiding and search are unit-tested in `scripts/test-sessionsearch.ts`. `prevListsHtml` (`app.js:3722`) renders rows with the ⋯ button; a `openPrevMenu(row)` reuses the `#modeMenu` element and keyboard of `openFolderMenu` (`app.js:2871`). `prevOf()` state gains `showHidden` (not saved). Delete uses `askDialog` (danger primary, Cancel focused). The *Previous (N)* count and `announcePrevious` use the visible count.

**Activity.** `session-deleted` in `src/shared/activity.ts` and its word in `activitytable.js`; `test:activity` covers the sanitizer and word.

**Simulator.** `src/renderer/sim.ts` keeps marks in memory per folder, offers `deleteSession` on the `mcp-swiss` rows (removes them from its list) and a hook that makes the next delete answer `code: 'in-office'`, for screenshots. One sim agent kind without delete shows the disabled item.

**Review notes (Vikram, PR #373).** (1) `sessions:delete` is reachable only from the window's IPC: one `ipcHandle` registration in `main.ts`, no import of `prevsessions.ts` elsewhere, no MCP tool, remote, channel or schedule path; a source-reading test in `scripts/test-prevsessions.ts` pins it. (2) Session ids use a strict per-adapter allow-list (`src/shared/sessionid.ts`: letters, digits, `_`, `-`; no `/`, `\\`, `.`, `:`, NUL, control characters, drive letters or absolute paths), applied in the store, in both IPC calls and inside the Copilot and Codex adapters, with tests for `../x`, `..\\x`, `C:\\x`, absolute paths, empty, overlong and control characters (the fake adapter is never called).

**Constitution check.** I (adapters as plug-ins): delete behind `AgentAdapter`, renderer sees a boolean. III (safe, no secrets): ids only in the store; Durbar deletes no files; confirmation with Cancel focused; refusal for open sessions; IPC takes ids, re-checked against the folder's list; the window reads the flag from the capabilities it already gets (`capsFor`, `app.js:2947`). IV (no credits): fake adapter, simulator; no real delete in tests. V (calm UI): one ⋯ per row, fits 1280x800. VI (parity): no paths, no shell. VIII (honest limits): real deletes, concurrent use by another process and macOS/Windows are `[KNOWN GAP]` until run.

**Verification plan.** `npm run typecheck && npm run build && npm test` (`test:folders`, `test:sessionsearch`, `test:prevsessions`, `test:activity`, adapter contract, Copilot/Codex adapter unit tests on fakes); `npm run check:office`; `scripts/shots-006-prevmarks.js` at 1440x900 and 1280x800.

## Changes 2026-10-21: Previous sessions as a collapsible section (owner request, FR-033..FR-037)

**Renderer only** (`src/renderer/app.js`, `styles.css`). No IPC, store, adapter or simulator data change.

- Markup: `#prevBtn` leaves `.ph .actions`. `#prev` (region "Previous sessions") becomes `.prev-bar` (one `<button id="prevBtn" class="prev-toggle" data-pv="toggle" aria-expanded aria-controls="prevPanel">` with `ICON('chev')`, `.prev-l` label, `.prev-c` count pill, `.prev-sub` breakdown) plus `#prevPanel.prev-body` (search and lists, rendered only when open, as today).
- `#prevBtn` is built once per panel in `openPanel` and only updated afterwards, so a click never loses focus. `prevButton(a)` fills its label, count, breakdown, title and `aria-expanded`; `renderPrev` shows `#prev` when `prevShows(st)` says so (FR-034) and renders the search and lists into `#prevPanel` only while open.
- Preference: `prevPref()` / `setPrevPref(open)` on `localStorage['durbar.prevOpen']` in try/catch, like `durbar.detail`. `initPrev` applies a saved choice (and marks the state touched so FR-002's auto-open does not override it); the toggle saves it.
- Shortcut: in the global keydown handler, `KEYS.modDown(e,IS_MAC)&&e.shiftKey&&e.code==='KeyH'` → `togglePrevByKey()`; a palette item and a keyboard sheet row. `setPrevOpen(ra,open,byKey)` is shared by the click and the key (saves the choice, moves focus only for the key). While `loadPrev` runs (`st.loading`), the key sets `st.wantOpen` and toasts "Looking…"; `loadPrev` then opens the section or says "none" (FR-036).
- CSS: `.prev` padding `2px … 1px` around a 28px `.prev-toggle` (the section is 32px with its border); the shadow only on `.prev.open`; `.prev-toggle` spans the header's 1240px column; the chevron rotates on `[aria-expanded="true"]` like `.think-toggle`; `.prev-q` background `--raised`, `.prev-row` border `--line`. Tokens only.
- Simulator: `simprevdelay=<ms>` (at most 10 s) delays `listPrevious` and `listVsChats`, for the loading check.
- Drivers: keep `#prevBtn` and `.prev-toggle` so every existing click path works unchanged; in `shots-006-prevmarks.js` the "Previous (N)" text assertions move to the count pill (`#prevBtn .prev-c`) and a new block covers FR-033..FR-037, with `meta` instead of `control` on macOS. The dark fixture `scripts/fixtures/themes/dark-audit.json` is the same file as PR #479's.
- Stacked on PR #498 (spec 005 FR-037..FR-043, composer toolbar), which moves Stop and the chat chips out of the header; the two changes touch the same header line only where #498 rewrote it, so #497 takes #498's line without the old button.

**Constitution.** I: no adapter specifics. III: the preference holds no session data. V: one slim row (32px), T4/T5 text, no overlap at 1280x800/1440x900 (`check:office`, driver fit checks). VI: no platform code; ⇧⌘H through `DurbarKeys`. VIII: macOS, Windows and screen readers not checked (spec `[KNOWN GAP]`).

## Changes 2026-10-25: resume interrupted sessions after a crash (issue #606, FR-038..FR-046)

- **Marker module** `src/main/crashmarker.ts` (pure helpers plus a small class over `fs`): `parseMarker` (strict, `sessionIdOk`, cap 24), `serializeMarker`, `interruptedFrom(marker, restored)`, and `CrashMarker(dir)` with `begin()` (read the markers of runs whose process is gone, skip a live one's unless it predates this boot (`os.uptime()`), sweep dead runs' temp files, at most 64 files, write this process's `durbar-running.<pid>.json`; size checked with `fstat` before a bounded read), `setBusy(list)` (changed set only, 250 ms coalescing, injectable timer), `clear()` (sync remove) and `flush()`. Atomic temp file + rename, mode 0600, same pattern as `AppStateStore`.
- **Main** (`src/main/main.ts`): after `restoreFolders()` call `begin()` and keep the interrupted list; a status listener (the same events as `lastStatus`) feeds `setBusy`; `installCrashMarker({ simulator, dir, onWillQuit, onExit })` (unit tested, and its call in `main.ts` checked by source) skips the simulator and installs `process.once('exit')` and `will-quit`, which call `clear()`. IPC `app:interrupted` / `app:dismissInterrupted` in `src/main/ipc/app.ts` beside `app:sinceAway` (same `fromApp` guard); the list is re-filtered on every call to the agents that are still lazy.
- **Reuse:** resuming is `bridge.wake` -> `agents:wake` -> `ensureLive` (FR-021): own mode, caps and history replay; the renderer's `wakeLast` gains a `crash` flag for the note and state line. The card is the `notice-strip` family (`#crashStrip` next to `#awayStrip`) with `busy()` buttons and the toast.
- **Simulator:** `simcrash=N` in `sim.ts` marks the first N main agents lazy + `resumeLast` and answers `interrupted()`; `DURBAR_SIM_CRASH` in main puts it on the page address. Under `simcrash` the bridge keeps `window.__durbarSimCrash` (wakes, how many at once with a 150 ms wake, prompts sent, mode changes, each session's mode and lazy flags) for the driver.
- **Constitution.** I: no adapter specifics (ids only, `resumeLast` is the existing flag). III: ids only in the marker, mode 0600. V: one strip, text >= 10.5px, no scrolling the office. VI: no platform code. VIII: honest limits in FR-045/FR-046.


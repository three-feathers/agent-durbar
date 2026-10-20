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
sessions:delete(agentId, sessionId)  -> { ok } | { ok:false, error, code?: 'open', agentId? }
```

`sessions:delete` body in a new `src/main/prevsessions.ts` (deps: agents, router, store, resumeIdFor, log, inFlight set), tested by `scripts/test-prevsessions.ts` with `FakeAdapter`. `sessions:resume` checks the same in-flight set.

**Adapters.** `capabilities.deleteSession` + `deleteSession?()` (`src/adapters/capabilities.ts`, `types.ts`), router helper `deleteSessionOf`. Copilot: `(await this.getClient()).deleteSession(id)`, refusing `this.sessions.has(id)`. Codex: `this.probe((rpc) => rpc.request('thread/delete', { threadId: id }))`, refusing live ids and live thread ids. Claude: nothing (flag false). Fake: option `deleteSession` with a call log. Contract check C2: member ⇔ flag.

**Renderer.** Pure arranging in `src/renderer/sessionsearch.js` (`arrangeSessions(list, {pinned, hidden, showHidden, query, timeKey})` → `{rows:[{item, pinned, hidden}], hiddenCount, total}`), so ordering, hiding and search are unit-tested in `scripts/test-sessionsearch.ts`. `prevListsHtml` (`app.js:3722`) renders rows with the ⋯ button; a `openPrevMenu(row)` reuses the `#modeMenu` element and keyboard of `openFolderMenu` (`app.js:2871`). `prevOf()` state gains `showHidden` (not saved). Delete uses `askDialog` (danger primary, Cancel focused). The *Previous (N)* count and `announcePrevious` use the visible count.

**Activity.** `session-deleted` in `src/shared/activity.ts` and its word in `activitytable.js`; `test:activity` covers the sanitizer and word.

**Simulator.** `src/renderer/sim.ts` keeps marks in memory per folder, offers `deleteSession` on the `mcp-swiss` rows (removes them from its list) and a hook that makes the next delete answer `code: 'open'`, for screenshots. One sim agent kind without delete shows the disabled item.

**Constitution check.** I (adapters as plug-ins): delete behind `AgentAdapter`, renderer sees a boolean. III (safe, no secrets): ids only in the store; Durbar deletes no files; confirmation with Cancel focused; refusal for open sessions; IPC takes ids, re-checked against the folder's list; the window reads the flag from the capabilities it already gets (`capsFor`, `app.js:2947`). IV (no credits): fake adapter, simulator; no real delete in tests. V (calm UI): one ⋯ per row, fits 1280x800. VI (parity): no paths, no shell. VIII (honest limits): real deletes, concurrent use by another process and macOS/Windows are `[KNOWN GAP]` until run.

**Verification plan.** `npm run typecheck && npm run build && npm test` (`test:folders`, `test:sessionsearch`, `test:prevsessions`, `test:activity`, adapter contract, Copilot/Codex adapter unit tests on fakes); `npm run check:office`; `scripts/shots-006-prevmarks.js` at 1440x900 and 1280x800.

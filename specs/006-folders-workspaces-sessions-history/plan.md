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

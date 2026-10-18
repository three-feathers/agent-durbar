# Feature Specification: Folders, workspaces, sessions and history

**Feature Branch**: `006-folders-workspaces-sessions-history` (reverse-engineered; milestones 1 and 6)
**Created**: 2026-10-16
**Status**: Implemented (reverse-engineered from `src/main/main.ts`, `src/main/folders.ts`, `src/adapters/history.ts`, `workspace.ts`, `app.js`, README)
**Input**: "Add folders or `.code-workspace` files, run one or more sessions per folder, remember my folders, hide or remove them, and pick up earlier Copilot sessions where I left off."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add a folder or workspace (Priority: P1)

With **+ Folder** (multi-select) or **+ Workspace** (a `.code-workspace` file) I add folders; each becomes a room with an agent whose session runs in that folder.

**Acceptance Scenarios**:

1. **Given** a folder, **When** added, **Then** a room named after it and an agent in `Ready` appear, using the permission mode, model and effort chosen in the top bar. *(real: m1-m3; sim:)*
2. **Given** a `.code-workspace` file, **When** added, **Then** the agent's working directory is its **first** listed folder and its name is the file name without the extension. *(read:; the parser is unit-tested only through VS Code chat matching)*
3. **Given** a path that is neither folder nor workspace file, **When** added, **Then** a toast "Could not add: <name>: <error>" shows. *(read:)*

---

### User Story 2 - Folders are remembered (Priority: P1)

Folders I add come back after a restart as "Not started" agents; nothing runs until I send the first message.

**Acceptance Scenarios**:

1. **Given** a saved folder, **When** the app starts, **Then** a lazy agent appears with the saved mode, model, effort and hidden flag, and no runtime session starts. *(test: store; read: restore)*
2. **Given** a lazy agent, **When** I send a message, **Then** the main process starts the session (resuming it if it has history, otherwise creating it under the same id) and then sends. *(read:; not verified on a real session)*
3. **Given** a saved folder that no longer exists on disk, **When** the app starts, **Then** it is skipped but stays in the saved list. *(read:)*
4. **Given** a corrupt or hand-edited folder file, **When** loaded, **Then** bad entries are dropped, unknown modes fall back to read-only, duplicates collapse and nothing throws. *(test:)*

---

### User Story 3 - More than one session per folder (Priority: P2)

I can start another agent with its own chat in a folder (the **+** on a room, **+ New session** in the chat header, or Folders > New session), choosing permission mode, model and effort. Names get a suffix (`Ada #2`).

**Acceptance Scenarios**:

1. **Given** a room, **When** I confirm the dialog, **Then** a second agent appears in the same room and its chat opens. *(sim:; real: not verified)*

---

### User Story 4 - Hide and remove folders (Priority: P2)

**Folders** lists every folder with **New session**, **Hide** (agents keep running; the room leaves office, list, filter and strip; remembered) and **Remove** (asks first if anything is working; ends its sessions; forgets the folder; earlier Copilot sessions stay on disk).

**Acceptance Scenarios**:

1. **Given** Hide, **When** applied, **Then** the room disappears everywhere, a toast says the sessions keep running, and Show brings it back. *(sim:)*
2. **Given** Remove with a working agent, **When** I click it, **Then** a confirm names how many agents are working. *(read:)*

---

### User Story 5 - Resume an earlier Copilot session (Priority: P2)

For a folder that has not been used yet in this run, a "Previous sessions" panel lists earlier Copilot CLI/SDK sessions whose working folder matches (newest first, title, time, branch). **Resume** continues the very same session and replays the last messages and tool calls.

**Acceptance Scenarios**:

1. **Given** a folder with earlier sessions, **When** I add it, **Then** a toast says how many were found and the panel opens. *(sim:; fixtures test:)*
2. **Given** Resume on an untouched agent, **When** it succeeds, **Then** the untouched agent is replaced by the resumed one (a failed resume leaves everything as it was). *(read:)*
3. **Given** a session id that is not in this folder's list, **When** the IPC asks to resume it, **Then** it is refused ("That session is no longer available for this folder."). *(read:)*

---

### Edge Cases

- Folder paths differing by case or trailing slash (Windows/macOS case-insensitive), symlinks (via realpath), remote/cloud sessions and sessions already open here are handled in matching. `[IMPLEMENTED]` test:
- History replay keeps the **last 300** items, caps text at 20,000 chars and tool output at 2,000, skips sub-agent chatter, reasoning, usage and system-injected user messages. `[IMPLEMENTED]` test:
- The runtime does not list sessions without events, so a brand-new empty session is not offered for resume. `[IMPLEMENTED]` read: (comment in code)
- Two simultaneous starts of the same lazy agent share one start. `[IMPLEMENTED]` read:
- Disk full / read-only profile: the folder list is just not remembered; the app keeps working. `[IMPLEMENTED]` test:

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** `[IMPLEMENTED]` real: Add folder(s) and `.code-workspace` through native dialogs; one agent per folder; `DURBAR_OPEN=a:b` starts agents at launch for development.
- **FR-002** `[IMPLEMENTED]` test: Saved folder list = one JSON file (`durbar-folders.json`, version 1) in the app's user-data folder: `workspace`, `permMode`, `hidden`, optional `model`, `effort`; max 200; absolute paths only; mode 0600; atomic write (temp + rename); tolerant load; no tokens or chat content.
- **FR-003** `[IMPLEMENTED]` read: Restored agents are `lazy` (label "Not started"); the first send starts or resumes the session (`ensureLive`, `quiet` start).
- **FR-004** `[IMPLEMENTED]` read: New session creates another agent in the same folder; model, effort and mode are chosen in a dialog; names are de-duplicated with `#n`.
- **FR-005** `[IMPLEMENTED]` read: Hide/Show are remembered; Remove ends the folder's sessions and forgets it (confirm when agents are working).
- **FR-006** `[IMPLEMENTED]` test: Previous-session matching (`sameDir`, `previousSessionsFor`) and history conversion (`eventsToHistory`) are pure and unit tested with synthetic fixtures.
- **FR-007** `[IMPLEMENTED]` read: `sessions:resume` re-checks that the id belongs to the agent's folder, resumes with the agent's permission mode, replays history, and retires the untouched agent only afterwards.
- **FR-008** `[IMPLEMENTED]` read: Agents in a folder that has earlier sessions get a toast and the panel auto-opens once.
- **FR-009** `[KNOWN GAP]` Resume, lazy start and `ensureLive` were built and tested on the simulator, fixtures and unit tests; they have **not been run against a real Copilot session** (README: milestone 6 used no real prompts). The `events.jsonl`/`getEvents()` shape used by `eventsToHistory` comes from SDK docs and synthetic fixtures, not from a captured real session. (Feature 013.)
- **FR-010** `[KNOWN GAP]` A `.code-workspace` runs one session in its **first** folder only; the other roots are not given to the session (they are used only to match VS Code chats). `read:` (Task T020.)
- **FR-011** `[KNOWN GAP]` Only folders are persisted, not individual sessions: after a restart a folder returns as **one** lazy agent even if it had several sessions; the others are reachable only through Previous sessions. `read:` (Task T021.)
- **FR-012** `[KNOWN GAP]` A saved `allow` mode is restored without confirmation (see feature 003 FR-012).
- **FR-013** `[KNOWN GAP]` Previous sessions are matched by working directory only; sessions started in a subfolder or from another checkout path are not listed. `read:`
- **FR-014** `[KNOWN GAP]` The panel is offered only for root agents that have not been used (`pristine`) for auto-open; once used, it must be opened manually. `read:`
- **FR-015** `[KNOWN GAP]` The main-process handlers (`addWorkspace`, `restoreFolders`, resume, hide/remove) have no automated test; only the pure parts do. `read:` (Task T022.)

### Key Entities

- **AgentInfo**: id (session id), name, cwd, optional workspace file, folders, permission mode, model, effort, `lazy`, `hidden`.
- **SavedFolder**: persisted subset (see FR-002). Key = workspace file or folder path.
- **PreviousSession**: id, title (<= 120 chars), start/modified time, branch.
- **HistoryItem**: user | output | tool (with failed flag, capped output).

## Success Criteria *(mandatory)*

- **SC-001**: `npm test` proves the saved list survives restart, hide state is kept on refresh, corrupt files give an empty list and an unwritable location never throws.
- **SC-002**: Previous sessions of other folders, remote sessions, sessions already open and malformed entries are never listed (test:).

## Assumptions

- The SDK's `listSessions()` returns metadata with `context.workingDirectory`, `modifiedTime`, `summary`, `isRemote`.
- `getSessionMetadata(id)` rejects or returns nothing for an id with no history.

## Changes

- **2026-10-17, spec 033 (floors), cross-reference.** Folders now belong to a floor (`floor` in `durbar-folders.json`, absent = Ground floor). **Hide (US4, FR-005) is unchanged** and combines with floors: a room shows only when it is not hidden and its floor is on; the Floors panel marks hidden folders. `+ Folder` / `+ Workspace` add to the floor chosen in the Floors panel. No requirement of this spec changes.

### 2026-10-18: a calm warning when the folder is your home, a parent of it, or a root (issue #170)

*Missing:* adding `~`, a parent of it (`/home`, `C:\Users`) or a filesystem or drive root (`/`, `C:\`) is allowed, and then everything under it, `~/.ssh` and other credentials included, counts as "inside the session's folders" for every adapter (Copilot permission broker, the Claude and Codex read rules). Nothing told the user. Found in Paco's review of #169.

*Corrected:*
- **FR-016** `[IMPLEMENTED]` When a folder that is the user's home, a parent of it, or a filesystem or drive root is added (directly, or as one of the folders of a `.code-workspace` file), the app shows one calm line after adding it: "*name*: agents in this folder can read everything under your home folder, including SSH keys and saved credentials." (for a root: "…everything on this drive…"). Adding is still allowed; nothing else changes. The check is a pure function with the home folder and the path flavour injected, so Windows paths (`C:\`, `\\server\share\`, `C:\Users`) are unit-tested from any OS; paths are compared case-insensitively on Windows and macOS (constitution VI).
- The warning is shown once per add, not on every start; restored folders are not re-warned.

### 2026-10-18: remove one session, rename a folder (Telegram request from the owner: "add but not remove", "allow edits")

*Missing:* a session added with **+** (US3) could only be ended (its card stays) or taken away with the whole folder (US4). And a room was always named after its folder: there was no way to tell two `app` folders apart or to give a folder a clearer name.

*Corrected:*
- **FR-017** `[IMPLEMENTED]` A main session in a folder that has **another** main session has **Remove session** in its chat header. It asks first when the session is working, thinking or waiting for you. It ends the session, takes its card and its helpers out of the office and the list, and closes its chat; the Copilot history stays on disk and is listed under Previous sessions. The last session of a folder has no Remove session (Folders > Remove takes the folder away). Main refuses to remove the last main session of a folder or a helper, whatever the renderer sends.
- **FR-018** `[IMPLEMENTED]` Folders > **Rename** sets a folder's display name (trimmed, 1 to 40 characters; an empty name goes back to the folder's own name). The room header, door plate, filter, Folders panel, list and tooltips use it; the folder path is unchanged and still shown. It is saved as `label` in `durbar-folders.json` and restored; a saved label that is not a string of 1 to 40 characters is ignored.
- Both run on the simulator (no credits); `test:folders` covers the saved label; the main handlers are not unit-tested (FR-015). `sim:` `docs/screenshots/006-remove-session-*.png`, `006-rename-folder-*.png`, `006-folders-panel-*.png` (1440x900 and 1280x800). `[KNOWN GAP]` Not run against a real Copilot session (the remove path is the same `stop()` as End session).


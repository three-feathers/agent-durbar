# Feature Specification: Folders, workspaces, sessions and history

**Feature Branch**: `006-folders-workspaces-sessions-history` (reverse-engineered; milestones 1 and 6)
**Created**: 2026-10-16
**Status**: Implemented (reverse-engineered from `src/main/main.ts`, `src/main/folders.ts`, `src/adapters/history.ts`, `workspace.ts`, `app.js`, README)
**Input**: "Add folders or `.code-workspace` files, run one or more sessions per folder, remember my folders, hide or remove them, and pick up earlier Copilot sessions where I left off."

## Clarifications

### Session 2026-10-20

- Q: (issue #368, Q1) Can a session that still has a card in the office (open, lazy or ended) be deleted? → A: No. Delete is never offered on an office card; it lives only in Previous sessions, where a session appears once it has no card. The path is End → Remove from office (exists, deletes nothing) → Previous sessions → Delete… (red confirmation). A Delete attempted for a session that still has a card is refused with "This session is still in the office. End it and remove it from the office first." and the buttons Go to session and Remove from office. (Owner, Paco, 2026-10-20.)
- Q: (issue #368, Q2) What does the activity-log row of a delete show? → A: "Session deleted · <agent app> · <short id> · last used <date>", no title (titles can hold prompt text and the log can be exported). Once session rename exists (issue #372) the user's own alias may be shown. (Owner, Paco, 2026-10-20.)

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
- **FR-009** `[IMPLEMENTED]` real: (2026-10-19, spec 013 C3 and C4) lazy start and `ensureLive` on a real Copilot session: a restored folder showed "Not started" and its first message started the session; an ended agent resumed with its context on the next message. Resume from Previous sessions by id was run in spec 002 T030 (2026-10-18). The `events.jsonl`/`getEvents()` replay shape is still checked on synthetic fixtures only (T023). Earlier text: Resume, lazy start and `ensureLive` were built and tested on the simulator, fixtures and unit tests; they have **not been run against a real Copilot session** (README: milestone 6 used no real prompts). The `events.jsonl`/`getEvents()` shape used by `eventsToHistory` comes from SDK docs and synthetic fixtures, not from a captured real session. (Feature 013.)
- **FR-010** `[IMPLEMENTED]` (2026-10-19, FR-019: the other folders are now given to the session; Copilot and Claude) Was a known gap: a `.code-workspace` runs one session in its **first** folder only; the other roots are not given to the session (they are used only to match VS Code chats). `read:` (Task T020.)
- **FR-011** `[KNOWN GAP]` Only folders are persisted, not individual sessions: after a restart a folder returns as **one** lazy agent even if it had several sessions (since FR-021, the last used one, resumed); the others are reachable only through Previous sessions. `read:` (Task T021.)
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

### 2026-10-19: search box in Previous sessions (issue #252, task T031)

*Missing:* a folder's *Previous sessions* panel lists earlier Copilot sessions and VS Code chats newest first, with no way to find one when there are many (for example 2 Copilot sessions and 14 VS Code chats).

*Corrected:*
- **FR-023** `[IMPLEMENTED]` (`test:` `scripts/test-sessionsearch.ts`; `sim:` `check:office` case at 1440x900 and 1280x800; screenshots `docs/screenshots/006-previous-sessions-search-*.png`) *Previous sessions* has a search box above the lists, shown when there are at least 2 entries in total. Typing filters both groups (Copilot sessions and VS Code chats) by **title**, ignoring case and accents; the newest-first order is kept. Each group header shows "N of M" while a query is active, and a group with no match says "No sessions match". **Escape** clears the box. The query is per panel, not saved, and never sent anywhere. Only titles are searched, not conversation content (that would read more data; out of scope).
- Simulator and unit tests (the matcher), `check:office` at 1440x900 and 1280x800 with the box shown; no AI credits.

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


### 2026-10-19: a workspace's other folders are given to the session (T020)

- **FR-019** `[IMPLEMENTED]` A `.code-workspace` session still runs in its **first** folder, but now the agent is also told about the workspace's other folders, so it can work in all of them:
  - Copilot gets them as `additionalDirectories` (SDK 1.0.22 `SessionConfig`, "additional directories the agent may access beyond the working directory"; given again on resume, as the SDK asks).
  - Claude Code gets them as `--add-dir <folder>`, once per folder (argv, no shell).
  - The permission broker already counts every workspace folder as a session root (spec 003 FR-023), so the modes behave the same in each folder: Read-only still denies writes there, and Ask first still asks.
  - A plain folder adds nothing.
  - This closes the known gap in FR-010 for these two kinds. `test:` `npm run test:wsroots`: the Copilot config on a fake session (create and resume), the Claude argv and the SDK options. `real:` 2026-10-19, Claude Code 2.1.303 with `haiku` on a two-folder workspace in Read-only, through the adapter. Asked to list its working directories without tools, the agent named only `app` before this change and `app` and `lib` after it. Reading `lib/word.txt` by its absolute path worked both before and after, because the broker already counted it as a root. About $0.009 in all. Copilot was not run on a real account.

### 2026-10-19: after a restart a folder continues its last session (T021, owner decision)

*Owner decision (Vikram, 2026-10-19, in the session):* "after a restart we continue with last session in folder". Before this, a restored folder started a **new** session at its first message (FR-011); the earlier one was only reachable through Previous sessions.

- **FR-020** `[IMPLEMENTED]` The folder list remembers, per folder, the **last used session**: its id and harness (`lastSession: {id, adapterId}` in the folders file; an id only, never content). It is updated when a main agent of that folder sends a message, typed or scheduled (spec 044). It is cleared when that session is removed from the folder (FR-017), and it goes away with the folder.
- **FR-021** `[IMPLEMENTED]` After a restart the folder's agent comes back under that session's id. It is still lazy: nothing runs until it is needed. When its chat is opened, or a message is sent first, Durbar resumes that session; resuming sends no prompt. It resumes only after checking that the session is still among the folder's previous sessions of that harness (constitution: resumed sessions must belong to the agent's folder). The chat then shows the earlier conversation (the same replay as Resume, FR-009) and a note "Continued after restart: <title>." A session that is gone (deleted, or not in this folder) gives a new session under the same id, with the note "The last session is no longer available; this is a new session." A folder without a remembered session behaves as before.
- Only the last session comes back; a folder's other sessions stay under Previous sessions (FR-011 otherwise unchanged).
- `test:` the folder store (parse, set, no rewrite when unchanged, clear on remove, bad ids dropped). `sim:` a restored agent that continues its session when opened (`simresume=1`), at both sizes. `sim:` `scripts/shots-006-continue.js`. `real:` 2026-10-19, the built app with a fresh profile and two launches per harness. First launch: a read-only folder was added and asked to remember a code word. Second launch: the card said "Your last session here"; opening it showed the earlier turn and the "Continued after restart" note; asked for the word, the agent answered `marmalade`. The folders file held only `lastSession: {id, adapterId}`. Done for Claude Code 2.1.303 (`haiku`, 2 prompts, about $0.005) and Copilot (`auto`, 2 prompts). The fallback was checked too: with the remembered id changed to one that does not exist, opening the agent said "The last session is no longer available; this is a new session." and it was Ready, with no prompt sent. Not checked: macOS/Windows.

### 2026-10-19: removing a folder is easy to find (owner: "i still dont find a way to remove a folder/workspace from the durbar")

*Found:* Remove existed only in the **Folders** panel (top bar), and nothing in the office or the chat pointed there. A folder with a single session had no remove action in its chat header: Remove session is hidden for the last session (FR-017).

- **FR-022** `[IMPLEMENTED]` Removing a folder (or a `.code-workspace`) is offered where the user already is, through the same `removeFolder` flow as the Folders panel (its confirmation, ending the sessions):
  - **Chat header:** when the agent is its folder's only session, the slot of Remove session shows **Remove folder** (danger style).
  - **Office:** right-click on a room's header (or Shift+F10 / the context-menu key while its door has focus) opens a **folder menu**: New session, Rename…, Hide, Remove folder…. It uses the same menu element, keyboard handling (arrows, Escape) and focus return as the mode menu. A **⋯** button next to the room's **+** (title "Folder actions") opens the same menu, so it can be found without knowing about right-click. In a narrow room (340 px or less) the ⋯ button stands in for **+**, since the menu has New session, so the header keeps fitting (spec 001 FR-023).
  - Nothing changes in the Folders panel.
- `sim:` `scripts/shots-006-remove.js` at 1440x900 and 1280x800: right-click and the ⋯ button both open the menu with the four actions; Remove folder from the menu and from a single-session chat header both remove the room after confirming; Cancel keeps it. `check:office` 302/302, including one-agent rooms. Screenshots: `docs/screenshots/remove-folder-*.png`.

### 2026-10-19: history replay tested on a real `getEvents()` stream (T023)

- `test:` `scripts/fixtures/events/real-getevents-restart.json` holds the 18 events of the throwaway Copilot session from the FR-021 real check. They were read by resuming that session, without a prompt. Redaction: ids are placeholders, the API call id and `transformedContent` are dropped, the system prompt is omitted, and the folder is `/work/demo`. `test:history` replays it to exactly its two turns (prompt, "OK", prompt, "marmalade"); session events, the system prompt and usage are not shown.

### 2026-10-20: every open session comes back (spec 052 FR-088)

*Missing:* after a restart, each folder brought back only its last session (FR-020/FR-021); a folder with three sessions open came back with one.

*Corrected:*
- **FR-020** (extended) `[IMPLEMENTED]` (`test:` `scripts/test-folders.ts`; `read:` `restoreFolders` in `src/main/main.ts`) A saved folder also keeps `openSessions`: the sessions open in it that got a message or were resumed, at most 6, oldest first. Remove from office and a session replaced by a resumed one take it out; End session keeps it (the card stays). `lastSession` is kept as before, so older builds still read the file.
- **FR-021** (extended) `[IMPLEMENTED]` On start each of them comes back lazily under its own id, exactly as the last session did, the last session first. A file with only `lastSession` restores that one; nothing saved, one fresh agent. Not run in Electron or on a real session.

### 2026-10-20: Pin, Hide and Delete in Previous sessions (issue #368)

*Owner decisions (Paco, 2026-10-20, issue #368):* each row of *Previous sessions* gets **Pin to top**, **Hide** (reversible, the default way to tidy the list) and, for agent sessions only, **Delete…** through the agent app's own API. A session open or running in Durbar is refused for Delete ("no, don't delete it"). Simulator and `npm test` only; no credits; no real deletes in tests.

*Missing:* today a row has only **Resume** (agent sessions, `src/renderer/app.js:3734`) or **View** (VS Code chats, `app.js:3739`). Nothing can be pinned, hidden or deleted, and Durbar stores nothing about these rows. The list comes from `sessions:listPrevious` (`src/main/main.ts:396`, the agent's own adapter through `previousSessionsOf`, `src/adapters/router.ts:100`) and `vschat:list` (`main.ts:442`); open sessions are left out by Durbar id (`main.ts:401`).

*Research: can each runtime delete one session?* (read-only; nothing was deleted, no session was started)

| Agent app | Delete API | Evidence | Durbar offers |
| --- | --- | --- | --- |
| GitHub Copilot (SDK 1.0.22) | **Yes.** `CopilotClient.deleteSession(sessionId): Promise<void>`: "Permanently deletes a session and all its data from disk, including conversation history, planning state, and artifacts … irreversible … @throws Error if the session does not exist or deletion fails". Sends JSON-RPC `session.delete` to the runtime. Durbar already calls it for its own throwaway one-shot sessions. | `read:` `node_modules/@github/copilot-sdk/dist/client.d.ts:336-351`; `dist/client.js:2076-2090`; `dist/session.d.ts:268-276` (disconnect keeps data, delete removes it); `src/adapters/copilot.ts:760` | Delete… |
| OpenAI Codex (app-server, min 0.163.0) | **Yes.** `thread/delete {threadId}` → `{}`, then a `thread/deleted` notification per id. Upstream: "permanently removing a thread … hard delete for active and archived rollout files", and it also deletes the thread's spawned sub-agent threads, goals and logs. It refuses a thread that is not persisted and a live internal worker (`-32600`). `thread/archive` / `thread/unarchive` exist too: **archive is reversible** (the thread leaves Codex's normal list), **delete is not**. The commit that added `thread/delete` (a19d43a40a, #25018, 2026-06-10) is an ancestor of tag `rust-v0.163.0` (GitHub compare). | `read:` upstream `codex-rs/app-server-protocol/src/protocol/common.rs` (`ThreadDelete => "thread/delete"`), `schema/typescript/v2/ThreadDeleteParams.ts`, `ThreadDeleteResponse.ts`, `codex-rs/app-server/src/request_processors/thread_delete.rs`, `codex-rs/app-server/README.md`; Codex is not installed here, so not run (`[KNOWN GAP]`) | Delete… (hard delete, not archive) |
| Claude Code (CLI 2.1.304, stream-json transport) | **No per-session delete.** `claude --help` has `rm <id>` ("Delete a background session, and its worktree"; the docs add that "its transcript stays on disk and remains available through `claude --resume`") and `purge [path]` ("Delete all Claude Code state for a project"), which is far wider than one session. The docs' "Delete session data" section names only the retention sweep and `claude purge`. The Agent SDK reference mentions functions that "rename, tag, and delete sessions", but the SDK is not a dependency (spec 012, owner decision Q3), the default transport is the CLI, and the signature was not read (`unverified`). Durbar never deletes the `.jsonl` files itself. | `read:` `claude --help`, `claude rm --help`, `claude purge --help` (2.1.304, local); https://code.claude.com/docs/en/sessions ("Delete session data"); https://code.claude.com/docs/en/agent-sdk/typescript | Hide only; Delete… shown disabled with the reason |
| VS Code chats (spec 009) | Not ours: read-only. | owner decision | Pin and Hide only; no Delete… |

*Corrected:*

- **FR-024** `[IMPLEMENTED]` **Pin to top.** Every row of both groups (agent sessions and VS Code chats) can be pinned and unpinned. Pinned rows come first in their group, newest first among the pinned (agent sessions by `modifiedTime`, VS Code chats by `updated`), then the other rows newest first, as today. A pinned row shows a small pin mark with the text "Pinned" for screen readers. Pins survive restarts (FR-026). The search box (FR-023) filters pinned rows like any other; "N of M" counts them. Pin is not offered on a hidden row (unhide first); hiding a pinned row unpins it, so a row is exactly one of pinned, normal or hidden.
- **FR-025** `[IMPLEMENTED]` **Hide (reversible).** Every row of both groups can be hidden. A hidden row leaves Durbar's list only: the session stays on disk and in the agent app, VS Code and the CLI. A **Show hidden (N)** toggle at the bottom of the lists (shown only when N > 0; N = hidden rows present in the current lists of both groups) brings hidden rows back in place, muted and tagged "Hidden", with **Unhide** in their menu. The toggle is per panel and not saved (off when the panel is rebuilt). Hidden rows are left out of the header's *Previous (N)* count, of the "N of M" counts while the toggle is off, of the toast after adding a folder (FR-008) and of the auto-open (spec 052 FR-002); the *Previous* button's tooltip adds "K hidden" when K > 0. Search applies to what is shown: with the toggle on, hidden rows are searched too.
- **FR-026** `[IMPLEMENTED]` **Stored as ids only.** Each saved folder in `durbar-folders.json` (FR-002, same file, version 1, key = workspace file or folder path) gets two optional lists: `prevPinned` and `prevHidden`, each an array of `{ src, id }`. `src` is an adapter id (`copilot`, `claude`, `codex`, the same rule as `adapterId`) or `vscode`; `id` is the runtime's session id (Codex: the thread id) or, for VS Code, the chat's opaque key (`<storage hash>/<session id>`, `src/adapters/vscodeChat.ts:239-240`). No titles, no dates, no content, no paths. **Strict id allow-list** (review note, Vikram, PR #373; `src/shared/sessionid.ts`): an agent session's `id` is `^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$`, one rule per adapter, so no `/`, `\`, `.` (so no `..`), `:` (so no drive letter), NUL or other control character, no absolute path, not empty, at most 100 characters; a VS Code key is exactly two such parts joined by one `/`. The runtime may map `deleteSession(id)` to a path, so this holds in the folder store, in `sessions:mark`, in `sessions:delete` and again inside the Copilot and Codex adapters. At most 200 entries per list per folder (oldest dropped). Tolerant load: entries that are not `{src, id}` with a valid `src` and an `id` that passes the strict allow-list (given further down in this item) are dropped; duplicates collapse; nothing throws. Pin and Hide of the same entry are exclusive (FR-024). The lists go away with the folder (Remove folder) and lose an entry when Durbar deletes that session (FR-029). Ids that no longer appear in the list are kept (inert) until the cap pushes them out; they are never shown or counted. **No migration:** a file without the lists means nothing pinned or hidden; an older build ignores the fields (and drops them if it rewrites the file, which only loses pins and hides). The renderer never sends a path: `sessions:mark(agentId, src, id, mark)` with `mark` one of `pin`, `unpin`, `hide`, `unhide`; main checks the agent exists, `src` is the agent's adapter id or `vscode`, and the id's shape, then writes through `FolderStore` (atomic, 0600). The list results carry `pinned` and `hidden` id arrays, filtered to the ids present in that result.
- **FR-027** `[IMPLEMENTED]` **Row menu, keyboard, fit.** Each row keeps its **Resume** or **View** button and gets one more control after it: a **⋯** button (`.btn.sm`, 28 px; `aria-label` "Actions for <title>", `aria-haspopup="menu"`, `title` "Pin, hide or delete"; on agent-session rows "Pin, rename, hide or delete", spec 059 FR-006). It opens the shared menu element of the folder menu (FR-022, `openFolderMenu`, `app.js:2871`): role `menu`, arrows move, Escape or Tab closes and returns focus to the ⋯. Shift+F10 or the context-menu key on a row, and right-click on a row, open the same menu. Items, one short line each with the explanation in the tooltip and the small line: **Pin to top** / **Unpin**; then, for agent sessions only, **Rename…** (added by spec 059 FR-006, issue #372; first on a hidden row, so a hidden session can be renamed without unhiding it; VS Code chats have none); **Hide** ("Only in Durbar; it stays in VS Code and the CLI") / **Unhide**; then, for agent sessions only, **Delete…** in the danger style. After Hide or Delete, focus moves to the next row's ⋯ (else the previous row's, else the search box, else the *Previous* button), and a polite live announcement says "Hidden. Show hidden brings it back.", "Pinned to top.", "Unpinned." or "Deleted.". **Simple and Expert** show the same actions and words. The row must fit the chat panel at 1280x800 and 1440x900: the title ellipsizes first (full title in its tooltip); Resume/View and ⋯ never wrap, overlap or leave the row. Design rules hold (`docs/design-rules.md` 1, 4, 6, 8, 9).
- **FR-028** `[IMPLEMENTED]` **Adapter capability.** `AdapterCapabilities` gets `deleteSession?: boolean` (missing = false) and `AgentAdapter` gets `deleteSession?(sessionId: string): Promise<void>`, present exactly when the flag is true (spec 012 FR-027; contract check C2 in `scripts/test-adapter-contract.ts`). It removes an earlier session that is **not** open in the adapter, through the runtime only:
  - Copilot: `client.deleteSession(id)` on the shared client. Refuses an id that is live in this adapter.
  - Codex: `thread/delete { threadId: id }` on a short-lived app-server (`probe`, `src/adapters/codex.ts:312`), as `listPreviousSessions` does. Refuses an id that is live in this adapter (by Durbar id or thread id).
  - Claude Code: no member, flag false (no per-session API, see the table). The menu shows **Delete…** disabled with the tooltip "Claude Code cannot delete one session. Hide it instead." (`aria-disabled`, focusable, not actionable).
  - The fake adapter (`src/adapters/fake.ts`) can be built with or without it and records calls; tests use only the fake. Durbar never removes, moves or rewrites a session file itself (constitution III).
- **FR-029** `[IMPLEMENTED]` **Delete, main side.** `sessions:delete(agentId, sessionId)` is the only path. In order:
  - 2026-10-20 (review of PR #379): the in-office refusal (step 3) runs again right before the adapter call, after the list re-check's await, so a card that appears meanwhile (for example a lazy restore) still stops the delete. `test:` `test-prevsessions` ("a card that appears while the list is being re-read"); mutation: without the second check the test fails. The ⋯ clearance from the scroller's edge is 18px: on Paco's Mac the overlay scrollbar's click zone is 16px wide (real, measured on 1d1076b), so the check asserts ≥16px.
  1. The agent exists and its adapter has `deleteSession`; else "This agent app cannot delete sessions. Hide it instead."
  2. `sessionId` passes the FR-026 strict allow-list for that adapter (checked before the id is used for anything else; the adapter is not called otherwise).
  3. **Refused while the session has a card in the office** (Clarifications Q1): any agent in the office (live, *Not started*/lazy, or ended with its card still there) whose Durbar id or resume id (`resumeIdFor`, `main.ts:1215`) equals `sessionId`, or `adapter.isLive(sessionId)`. The answer is `{ ok: false, code: 'in-office', agentId, error: 'This session is still in the office. End it and remove it from the office first.' }`. Main never ends or removes the session itself.
  4. The id is still among this folder's previous sessions of that adapter (`previousSessionsOf`, the same re-check as resume, FR-007); else "That session is no longer available for this folder."
  5. A delete of an id already being deleted is refused ("Already deleting this session."); a delete of an id being resumed is refused ("This session is being opened."); `sessions:resume` also refuses an id being deleted ("Already deleting this session.") or already being resumed ("This session is being opened.").
  6. `await adapter.deleteSession(sessionId)`. An error is returned as `{ ok: false, error: <short message> }`; nothing else changes and no activity row is written. A session the runtime no longer has counts as an error with the runtime's message; the list is reloaded.
  7. On success: the id is dropped from the folder's `prevPinned`/`prevHidden` (and from `lastSession`/`openSessions` if somehow present), one activity row is written (FR-031), and `{ ok: true }` is returned.
  **Reachability** (review note, Vikram, PR #373): `sessions:delete` is registered only through `ipcHandle` in `main.ts`, i.e. only for the app's own window. The Durbar MCP tools (spec 041), remote control and channels (spec 054), schedules (spec 044) and any agent-driven path have no way to call it; `scripts/test-prevsessions.ts` reads the sources and fails if another module names it, or if `main.ts` names the delete on any line but its one registration. Known limit (R2): a source-text test cannot see an obfuscated call (a computed property name, a string built at run time); review catches those.
  The logic lives in a module with injected agents, router, store, `resumeIdFor` and log (no Electron), so it is unit-tested with the fake adapter (also a step for FR-015).
- **FR-030** `[IMPLEMENTED]` **Delete, in the window.** **Delete…** opens a red confirmation (`.btn.primary.danger`, focus starts on **Cancel**, `src/renderer/dialog.js:27-28`; Escape cancels). Title: **Delete this session?** Body, in this order:
  1. "“<title>” will be deleted from <app> on this computer." (`<app>` = "GitHub Copilot" or "Codex").
  2. "It will also be gone from VS Code and the <CLI> (Copilot CLI / Codex CLI), and it cannot be resumed again."
  3. Codex only: "Its helper threads are deleted too."
  4. "This cannot be undone. To only take it out of this list, use Hide."
  Buttons: **Cancel**, **Delete** (no "…", design rule 6). While it runs, the row's ⋯ shows the shared busy state and the row's buttons are disabled. Success: the row leaves the list, counts update, toast "Session deleted.", announcement "Deleted.". Error: toast "Could not delete: <error>" (error style), the row stays. Delete… is **never offered on an office card** (desk card, list row, chat header or card menu); it exists only in *Previous sessions*, where a session appears once it has no card. The path is End → **Remove from office** (FR-017, deletes nothing) → *Previous sessions* → **Delete…**. Refusal (`code: 'in-office'`, a race or a stale list): a dialog **This session is still in the office** with "This session is still in the office. End it and remove it from the office first." Buttons: **Cancel**, **Go to session** (opens that agent's chat) and **Remove from office** (the existing FR-017 flow with its own confirmation when the session is busy). When the session is its folder's only main session, FR-017 has no Remove from office; the button is then left out and the dialog adds "It is the only session in this folder: start a new session there first." Durbar never ends, removes or deletes a session by itself as part of this dialog; after Remove from office the user deletes again from the list.
- **FR-031** `[IMPLEMENTED]` **Activity log row.** `ACTIVITY_DECISIONS` (`src/shared/activity.ts:14`) gets `session-deleted`, shown as "Session deleted" (`src/renderer/activitytable.js`). The row is recorded in main, never by the window: agent = the agent whose panel was used, folder base name, app display name, current mode, action "Session deleted · <agent app> · <short id> · last used <date>" (`<short id>` = the first 8 characters of the session id; `<date>` = the session's last-used date from the list). No title (Clarifications Q2: titles can hold prompt text and the log can be exported). Once session rename exists (issue #372) the user's own alias may be shown instead of nothing; that is a later change.
- **FR-032** `[IMPLEMENTED]` **Open sessions are left out by resume id too.** `sessions:listPrevious` and the resume/delete re-checks exclude both Durbar ids and resume ids (`resumeIdFor`) of the agents in the office. `read:` a Codex session started under a Durbar id other than its thread id (`codex.ts:594`, resume and restore) is excluded today only by Durbar id, so its thread may be listed while open (not observed; the Codex adapter also adds its live ids, which are Durbar ids). This makes the FR-029 refusal a last guard, not the usual path.
- **Evidence (2026-10-20):** `test:` `scripts/test-folders.ts` (lists, strict ids, cap, exclusive, no rewrite), `scripts/test-sessionsearch.ts` (`arrangeSessions`, `applyMark`, words of FR-030), `scripts/test-prevsessions.ts` (delete order, every refusal, in flight, marks, list by resume id, Copilot on a fake client, reachability and Q1 source checks), `scripts/test-codex-adapter.ts` (`thread/delete` on the fake app-server), `scripts/test-adapter-contract.ts` C2, `scripts/test-activity.ts`. `sim:` `scripts/shots-006-prevmarks.js` at 1440x900 and 1280x800, Expert and Simple (row fit asserted, menu, pins, Show hidden, confirmation with Cancel focused, refusal with and without Remove from office, Delete… disabled on a Claude Code agent with `simkinds=mixed`): `docs/screenshots/006-prev-*.png`. Mutation checks on the refusal (card id, resume id, `isLive`), on the Codex thread-id refusal and on the id allow-list (dots, slash, no check) fail the tests. `[KNOWN GAP]`: a real delete on Copilot and Codex (needs the owner's OK and a throwaway session), another process holding the same session, macOS/Windows, and the keyboard path (Shift+F10, context-menu key) was not driven in Electron on Linux (it was on macOS, see the real check below).
- **Real check, macOS (2026-10-20):** `real:` macOS 26, Apple M1 Pro, Electron 44, Paco's Mac session on the simulator, on commit 87c4182, with trusted CDP key and mouse events. Passed: ⋯ by click, Enter and ArrowDown, Escape returning focus to the ⋯; Shift+F10 and the ContextMenu key open the row menu; right-click; Pin and Unpin with focus kept; Hide moves focus to the next row's ⋯, "Previous (5)" with the tooltip "· 1 hidden", **Show hidden (1)** and **Hide hidden again**; the search filters pinned rows; Delete confirmation (Cancel focused, red Delete, Escape returns focus); the in-office refusal (Go to session focused) and the only-session variant; `simprev=error` toast with no row lost; Claude Code Delete… `aria-disabled` with the reason; VS Code rows offer only Pin and Hide; rows 41 px high at 1280x800, 1440x900 and 800x800, Simple and Expert; `FolderStore` persistence of a pin, a hide and a VS Code pin as ids only, with `../x` refused (real store, temp file). **Bug found and fixed:** macOS's overlay scrollbar of `.prev-body` (no gutter) was drawn over the right half of the ⋯ buttons and for about a second after a scroll took their clicks (a real click on ⋯ right after `scrollIntoView` did not open the menu). Fix: `.prev-body` has `scrollbar-gutter: stable` and 14 px right padding, so no ⋯ reaches the scroller's last 12 px; `scripts/shots-006-prevmarks.js` asserts the ⋯ right edge is at least 12 px inside the scroller at both sizes. Also fixed: the ⋯ glyph is centred (`justify-content:center`). Not covered: the context-menu key on Windows and Linux; real deletes (by design).
- **Constraints:** ids only in Durbar's store; agent specifics stay behind `AgentAdapter` (the renderer sees only the capability flag via the agent's features); no file is deleted by Durbar; no shell, no paths over IPC; simulator and unit tests; **no real delete in any test** (fake adapter and fake RPC/client only); screenshots at 1440x900 and 1280x800 (`DURBAR_SIM=15`). `[KNOWN GAP]` until checked: a real delete on Copilot and Codex (needs a throwaway session, so at least one prompt each; ask the owner first), behaviour when another process (Copilot CLI or VS Code, Codex app) has the same session open, and macOS/Windows.
- **Owner decisions:** Q1 and Q2 were answered on 2026-10-20; see *Clarifications, Session 2026-10-20* at the top of this spec.
- **2026-10-20: search fold written with escapes** (FR-023, T047; retro sweep of the review notes on PR #273, owner rule 2026-10-20). `sessionsearch.js` stripped accents with literal combining characters in the regex class; it now uses `\u0300-\u036f` (the same range), so an editor that normalises the file cannot change it. No behaviour change. test: `test:sessionsearch` (accents, case, word order).

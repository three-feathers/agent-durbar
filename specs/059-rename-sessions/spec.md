# Feature Specification: Rename sessions

**Feature Branch**: `059-rename-sessions`
**Created**: 2026-10-20
**Status**: Draft for the owner's answers (spec, research, plan, tasks; **no code**). Open questions Q1-Q9 below; the tasks
assume the recommended option of each and name the question they rest on.
**Input**: Issue #372. Owner (Paco, 2026-10-20): "it would be nice to be able to rename sessions". Rename in the agent app's own
store where it has an API (so VS Code and the CLI see the new name too), else a Durbar-only name kept locally; **Rename…** in the
chat header's More menu, the agent card menu and the Previous sessions row menu (spec 006, issue #368); the new name everywhere the
session's name is shown.

## Summary

Today a main agent's name is the runtime's session title (spec 001 and 002 deltas 2026-10-18, issue #126): often the first prompt,
long, and it can hold private content. It shows on the desk card, in the list view, the chat header, the full-screen strip, the
Needs you inbox, notifications, Previous sessions, and the Schedules *Send to* option and list. The user cannot change it.

This feature lets the user give any main session a short name of their own. Where the agent app has a rename API the name is also
written there; otherwise it stays in Durbar only. Evidence for each agent app is in [research.md](research.md).

| Agent app | Rename API | Durbar uses it for | Shows in the app's CLI | Shows in VS Code |
| --- | --- | --- | --- | --- |
| GitHub Copilot (SDK 1.0.22) | **Yes**, `session.rpc.name.set({ name })` (@experimental), on a session object | a session that is **live** in Durbar (Q2) | yes, the same field the CLI's `/rename` writes (`read:` SDK types, runtime strings) | unverified |
| OpenAI Codex (app-server 0.163+) | **Yes**, `thread/name/set { threadId, name }`, works on a stored thread that is not loaded | every Codex session, open or not | yes, the same name the Codex TUI's `/rename` writes (`read:` upstream source) | unverified |
| Claude Code (CLI 2.1.304, stream-json) | **No** for the CLI transport Durbar uses (`--name` names a *new* session; renaming an existing one needs the Agent SDK's `renameSession()`, not a dependency) | Durbar-only name | n/a | n/a |
| VS Code chats (spec 009) | not ours (read-only) | no Rename (Q5) | n/a | n/a |

## Clarifications

### Session 2026-10-20

Open. The owner answers Q1-Q9 (section *Open questions*); the answers are recorded here.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Give a session a short name (Priority: P1)

The user has three sessions in one folder whose names are long first prompts. They open one session's More menu, choose
**Rename…**, type "Billing refactor", press Enter. The card, the chat header, the strip, the inbox and the Schedules option all say
"Billing refactor".

**Why this priority**: it is the whole ask; it also removes private prompt text from the screen.

**Independent Test**: simulator (`DURBAR_SIM=15`), a titled agent: Rename… from the chat header, the card menu and the list row; the
new name appears on every surface listed in FR-001; Esc changes nothing; an empty name brings the runtime title back.

**Acceptance Scenarios**:

1. **Given** a live main agent titled with a long prompt, **When** the user renames it "Billing refactor" and presses Enter,
   **Then** every surface in FR-001 shows "Billing refactor", the folder name stays in the room header and the tooltip, and the
   runtime title is no longer shown in tooltips (FR-003).
2. **Given** the Rename dialog is open, **When** the user presses Esc, **Then** nothing changes and focus returns to the control that
   opened it.
3. **Given** a renamed session, **When** the user opens Rename…, clears the field and saves, **Then** the session shows the runtime's
   title again (or the folder name when it has none).
4. **Given** the user types a name with a control character or one that looks like a token, **Then** Save is refused with the reason
   under the field and nothing is stored.
5. **Given** Durbar restarts, **Then** the session comes back with the user's name.

### User Story 2 - The name reaches the agent app where it can (Priority: P2)

The user renames a Codex session in Durbar. Later, in a terminal, the Codex CLI's resume picker shows the same name.

**Why this priority**: the owner asked for it "where possible"; it needs adapter work and has no real check yet.

**Independent Test**: fake Copilot session and fake Codex RPC record `name.set` / `thread/name/set` with the cleaned name; a Claude
agent stores a Durbar-only name; the dialog says which one will happen before the user saves.

**Acceptance Scenarios**:

1. **Given** a live Copilot session, **When** it is renamed, **Then** Durbar calls the runtime's rename once with the cleaned name and
   the dialog said "Also renames it in GitHub Copilot".
2. **Given** a Codex session listed in Previous sessions (not open), **When** it is renamed from its row menu, **Then** Durbar calls
   `thread/name/set` on a short-lived app-server and the row shows the new name.
3. **Given** a Claude Code session, **When** it is renamed, **Then** only Durbar stores the name and the dialog said "Only in Durbar".
4. **Given** the agent app refuses the rename (error, too long, not found), **Then** Durbar keeps the name as a Durbar-only name, says so
   in a toast, and nothing else changes (FR-010).

### User Story 3 - Rename from Previous sessions (Priority: P3)

The user tidies Previous sessions: each agent-session row's ⋯ menu (spec 006 FR-027, issue #368) has **Rename…**; the row shows the
new name, search finds it, and resuming the session keeps it.

**Independent Test**: simulator Previous sessions rows: Rename… from the ⋯ menu; the row title, its tooltip and the search (spec 006
FR-023) use the new name; Resume opens an agent with that name.

### Edge Cases

- A helper (sub-agent) has no Rename; it keeps its own name.
- A *Not started* (lazy) or ended card can be renamed; the Copilot path is Durbar-only for it (Q2).
- Two sessions get the same name: allowed (names are labels, not ids); the folder in the tooltip tells them apart.
- The runtime later sends a new title (Copilot `session.title_changed`, a resume, a Previous sessions list): FR-011 decides.
- The session is deleted (spec 006 FR-029): its name entry goes with it. The folder is removed: all its names go.
- A session renamed while it is working: allowed; the rename does not touch the turn.
- A 60-character name on a mini or micro desk card: ellipsized like any long title; the office still fits (constitution V).
- The schedules file already holds the first 80 characters of a title as a target name (spec 044): FR-008.
- Right-to-left and other scripts are allowed; invisible direction and zero-width characters are refused (FR-002).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** `[KNOWN GAP]` **One display name, everywhere.** A main session's display name is, in order: the user's name for it (FR-005),
  else the runtime's title (as today), else the folder label with `#2`, `#3` (as today). It is used on the desk card at every density,
  the list view row, the chat header title, the full-screen agent strip, the lobby visitor label, toasts, the Needs you inbox row, OS
  notifications, the Schedules dialog's *This session (…)* option and its schedule list (FR-008), Previous sessions rows (FR-009), and
  the activity log's agent column (FR-012). Sub-agents keep their own names. The folder stays in the room header and in the card's
  tooltip and accessible name ("name, in folder"), as spec 001 (2026-10-18) says for titles.
- **FR-002** `[KNOWN GAP]` **The name rule** (one shared, pure function, also used by floor names, spec 033 FR-003): whitespace runs
  become one space and the ends are trimmed; then 1 to **60** characters (code points; Q3); no control characters (C0, DEL, C1); no
  invisible direction, zero-width or filler characters (the floor rule's list; ZWJ, ZWNJ, LRM and RLM stay allowed); refused when
  `redact()` would change it (it looks like a token or a key: "That looks like a secret. Use another name."). Errors, one line each:
  "Use 1 to 60 characters." / "Remove control or hidden characters." / "That looks like a secret. Use another name." An empty field is
  not an error: it means reset (FR-004). The same rule runs in main on every IPC call; the renderer only pre-checks.
- **FR-003** `[KNOWN GAP]` **The runtime title stops showing once a session has the user's name.** Card and header tooltips, the
  inbox and the strip use the user's name, never "runtime title · folder". The runtime title is shown only inside the Rename dialog
  ("Name in <app>: …", cut to 80) so the user can go back to it. Chat history is unchanged (it is the conversation).
- **FR-004** `[KNOWN GAP]` **Rename dialog.** A small dialog (the shared `askDialog`, as Rename folder and Rename floor; Q6):
  - Title **Rename session**. Body: "A short name for this session in Agent Durbar, 1 to 60 characters. Leave it empty to use
    <app>'s title again." plus one line on where the name goes (FR-007): "Also renames it in GitHub Copilot: the Copilot CLI shows the
    new name." / "Also renames it in Codex: the Codex CLI shows the new name." / "Only in Agent Durbar. <app> keeps its own name."
    For a session that already has an app-side name, the line "Name in <app>: <name>".
  - One text field, label **Name**, prefilled with the current display name (cut to 60) and fully selected, `maxlength` 60.
  - Buttons **Cancel**, **Rename** (primary, last; no "…", design rule 6). **Enter in the field saves**, **Esc cancels** (both
    keyboard paths return focus to the opener). `askDialog` gets an option for Enter-to-submit on its input; today Enter does nothing
    in a dialog field (`read:` `src/renderer/dialog.js:40-55`).
  - Validation errors show under the field (`aria-describedby`, `role="alert"` once), the dialog stays open.
  - Success: polite announcement "Renamed." (or "Name reset."), toast only on a partial result (FR-010).
  - Same words and controls in Simple and Expert (spec 052). Fits 1280x800 and 1440x900 (the dialog is the existing size).
- **FR-005** `[KNOWN GAP]` **Where the user's name is kept.** Each saved folder in `durbar-folders.json` (spec 006 FR-002; same file,
  same version, key = workspace file or folder path) gets an optional list `sessionNames`: entries `{ src, id, name, inApp? }`.
  `src` = adapter id (the `adapterId` rule); `id` = the runtime's session id (Codex: the thread id; the same id Previous sessions and
  `resumeIdFor` use, `src/main/main.ts:1215`), shape `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$` (spec 006 FR-026); `name` passes FR-002;
  `inApp: true` when the agent app accepted the same name (FR-007). At most 200 entries per folder (least recently set dropped).
  Tolerant load: bad entries dropped, duplicates collapse (last wins), nothing throws. **No migration**: no list = no names; an older
  build ignores the field. The entry is never sent to the agent app (except as the rename call itself, FR-007), never put in tool
  usage labels or usage totals (spec 020 / 011 keys stay the folder name), and never logged except as FR-012 says. Written through
  `FolderStore` (atomic, 0600). Gone with Remove folder; dropped when Durbar deletes the session (spec 006 FR-029).
- **FR-006** `[KNOWN GAP]` **Where Rename… is offered.** Main sessions only, never helpers, never VS Code chats (Q5):
  1. the chat header's **More** menu, above the separator (before End session), for a main agent that is live, not started or ended;
  2. the agent **card menu** (office desk card and list-view row; spec 005 FR-017, `cardMenuActions` in
     `src/renderer/modelswitch.js:208`), as one more item in its actions group;
  3. the **Previous sessions** row menu (spec 006 FR-027, issue #368) for agent-session rows, between Pin/Unpin and Hide.
  The item is **Rename…** (it asks for input), tooltip "Give this session a short name". All three open the same dialog; focus returns
  to the menu button that opened it. Keyboard: the menus' existing arrows, Enter, Escape, Shift+F10.
- **FR-007** `[KNOWN GAP]` **The app-side rename** (Q1). `AdapterCapabilities` gets `renameSession?: 'live' | 'any'` (missing = none);
  `AgentAdapter` gets `renameSession?(sessionId: string, name: string): Promise<void>`, present exactly when the flag is set (spec 012
  FR-027, contract check C2). `'live'`: only a session live in this adapter; `'any'`: also a stored session that is not open.
  - Copilot: `'live'`; `session.rpc.name.set({ name })` on the live session. Copilot's own rule is stricter than FR-002 (no double
    quotes, at most 100 UTF-16 units, `read:` SDK `types.d.ts:2662`); a name with `"` is kept Durbar-only with the FR-010 note (Q8).
  - Codex: `'any'`; `thread/name/set { threadId, name }` on the session's own app-server when live, else on a short-lived one
    (`probe`, `src/adapters/codex.ts:312`), as `listPreviousSessions` does. An archived thread is refused by Codex (FR-010).
  - Claude Code: no member (no per-session rename on the CLI transport; research R3).
  - The fake adapter can be built with either flag and records calls. Tests use only fakes; no real store is touched.
  Main decides: if the adapter has the member and the flag allows this session, it calls it after the name passed FR-002; on success the
  entry is saved with `inApp: true`; otherwise (no member, flag `'live'` and the session is not live) the entry is Durbar-only. The
  dialog's FR-004 line is computed from the same rule before the user saves, so it never promises what will not happen.
- **FR-008** `[KNOWN GAP]` **Schedules** (spec 044 FR-014, FR-021). The *This session (…)* option shows the display name (FR-001), cut
  to 40 characters on a word boundary with "…" (spec 044 FR-021), full name in its `title`. A new schedule stores as `target.name` that
  short display name, never a longer title. The schedule list shows the **current** display name of the target session when that
  session is known (by `target.session`), else the stored name, else "one session" (today: the stored name, `src/renderer/app.js:3502`).
  Stored names in existing files are not rewritten (Q7).
- **FR-009** `[KNOWN GAP]` **Previous sessions.** `sessions:listPrevious` results carry `names: { [id]: name }` for the ids present in
  that result (from FR-005). A row with a user name shows it as the title (its tooltip too, FR-003), and the search box (spec 006 FR-023)
  matches the user name; the runtime title is not searched for that row. Resume gives the new agent that name (`AgentInfo.alias`).
  A Copilot or Codex row renamed in the app shows the app's name anyway (the list already prefers it: `src/adapters/history.ts:99`,
  `src/adapters/codexHistory.ts:41`).
- **FR-010** `[KNOWN GAP]` **Partial results and errors.** When the app-side rename throws or refuses, the name is still saved as a
  Durbar-only name, and a toast says "Renamed in Agent Durbar only. <App> did not accept the name: <short reason>." (reason cut to 120,
  passed through `redact()`). When saving the folder file fails, nothing changes on screen and the toast says "Could not rename the
  session." A second rename of the same session while one is in flight is refused ("Already renaming this session.").
- **FR-011** `[KNOWN GAP]` **When the runtime title changes later** (Copilot `session.title_changed` or `name.get`, a resumed session's
  list title, the Previous sessions list, a Codex `thread/name/updated`):
  - a Durbar-only entry (`inApp` absent) **wins**: the display name does not change; the new runtime title is kept only for the dialog's
    "Name in <app>" line;
  - an `inApp` entry whose app name now differs from the entry (renamed elsewhere, for example in the CLI) is **dropped**: the app's
    new name shows. Equal names change nothing;
  - with no entry, the runtime title shows (today's behaviour).
  `applyTitle` (`src/renderer/app.js:2604`) and main's title handler (`src/main/main.ts:147`) follow this; a pure function decides it
  (`displayNameOf(entry, runtimeTitle, folderLabel)` plus `syncEntry(entry, runtimeTitle)`), unit-tested.
- **FR-012** `[KNOWN GAP]` **Activity log** (owner decision on #368 Q2: "the user's own alias may be shown"; Q4). New rows of a session
  with a user name show that name in the `agent` column (sanitized and cut to 80 as today, `src/shared/activity.ts:12`); other rows keep
  today's value (`a.label || a.name`, the folder label, `src/main/main.ts:166`). The runtime title never goes into the log. Rows
  already written are not rewritten. A rename itself is **not** logged (it changes no permission or state; Q4). Spec 006 FR-031's
  "Session deleted" row may then name the session with its user name.
- **FR-013** `[KNOWN GAP]` **IPC (main validates everything).** `sessions:rename(agentId, sessionId | null, name)`:
  `sessionId` null = the agent's own session (`resumeIdFor(agentId)`); else it must be among this agent folder's previous sessions of
  the same adapter (`previousSessionsOf`, the re-check resume uses, `src/main/main.ts:413`) or the resume id of another office agent of
  the same folder. `name` is a string (empty = reset). Answer `{ ok: true, name?: string, inApp: boolean, note?: string }` or
  `{ ok: false, error }`. Office agents of that session get `AgentInfo.alias` and an `agents:renamed` event so every window updates;
  a reset clears `alias`. The renderer never sends a path or an adapter id.
- **FR-014** `[KNOWN GAP]` **Restore.** On start, agents restored from `lastSession` / `openSessions` (spec 006 FR-020/021, spec 052
  FR-088) get their `alias` from the folder's `sessionNames` by resume id. A resumed session (Previous sessions) gets it too.
- **FR-015** `[KNOWN GAP]` **Simulator.** `src/renderer/sim.ts` implements `renameSession` in memory, with one sim agent kind that has
  `'any'`, one with `'live'` and one without (so the three dialog lines and the partial-result toast can be shown), and a hook that makes
  the next app-side rename fail. Previous sessions rows (`prev-1`, `prev-2`) can be renamed.
- **FR-016** `[KNOWN GAP]` **Fit and legibility.** Names are escaped wherever shown; 60-character names ellipsize on cards, strip, inbox,
  header and rows with the full name in the tooltip; `check:office` passes with 15 agents carrying 60-character names at 1440x900 and
  1280x800; 10.5px floor; design rules 1, 4, 5, 6, 8, 9 hold.
- **Constraints:** agent specifics stay behind `AgentAdapter` (the renderer gets a capability value and a computed "where it goes"
  line); no shell; no paths over IPC; Durbar never edits another tool's files (Claude's `.jsonl`, Copilot's session state, Codex's
  store); simulator, fakes and unit tests only; no real session in tests; Windows, macOS and Linux behave the same (no paths involved).

### Key Entities

- **Session name entry** `{ src, id, name, inApp? }` in a saved folder's `sessionNames` (FR-005).
- **AgentInfo.alias** (main and window): the user's name for an office agent's session, display only (FR-013).
- **Capability `renameSession`**: `'live' | 'any'` or missing (FR-007).

## Success Criteria *(mandatory)*

- **SC-001** Every surface in FR-001 shows the user's name within one render after Rename, in the simulator, at both sizes, Simple and
  Expert (`scripts/check-rename.js`).
- **SC-002** No surface shows the runtime title of a renamed session outside the Rename dialog and the chat history (same check).
- **SC-003** The name rule refuses every case in its test table (controls, hidden characters, 61 characters, tokens) and accepts
  scripts and emoji up to 60 code points.
- **SC-004** Fakes prove: Copilot live → one `name.set`; Copilot not live → no call, Durbar-only; Codex open or not → one
  `thread/name/set`; Claude → no call; an adapter error → Durbar-only plus the note.
- **SC-005** `check:office` still passes with 60-character names; `npm run typecheck && npm run build && npm test` green; 0 AI credits.

## Assumptions

- Copilot SDK pinned at 1.0.22 (`name.set` is @experimental and may change; the adapter catches and falls back, FR-010).
- Codex 0.163.0 or later (`CODEX_MIN_VERSION`, `src/adapters/detect.ts:47`) has `thread/name/set` (`read:` the `rust-v0.163.0` tag).
- Claude Code stays on the CLI transport; if the optional Agent SDK transport is present (`src/adapters/claudeSdk.ts`), it is still not
  used for rename (Q1, research R3).
- Spec 006's per-row ⋯ menu (issue #368, T036) lands before US3; US1 and US2 do not depend on it.

## Open questions (for the owner)

Each has a recommended option; the plan and tasks assume it until answered.

- **Q1 Where does a rename go when the agent app has an API?**
  A. **(recommended)** In the app too (Copilot live sessions, Codex always) and in Durbar; elsewhere Durbar only. The dialog says which
  before saving. Note: an app-side name **cannot be removed** again (Copilot needs 1-100 characters, Codex refuses empty); an empty name
  clears only Durbar's name, and the app keeps the last one.
  B. Durbar only, for every app (simplest, fully reversible, private; the CLI and VS Code never see it).
  C. Durbar always, plus a checkbox "Also rename in <app>", off by default.
- **Q2 A Copilot session that is not live in Durbar** (Previous sessions row, not started, ended):
  A. **(recommended)** Durbar-only name; the dialog says "Open the session to rename it in GitHub Copilot too."
  B. Durbar resumes it quietly (no prompt, no credits), renames it in Copilot, and closes it again (changes its last-used time and
  "last client", and is more moving parts).
  C. Send `session.name.set` with that session id on the shared connection without resuming (not in the SDK's public surface; unverified).
- **Q3 Length cap** of a name: A. **(recommended)** 60. B. 40 (as folders and floors). C. 100 (Copilot's own limit).
- **Q4 Activity log**: A. **(recommended)** new rows of a renamed session show its user name in the agent column; renames are not
  logged. B. Only spec 006's "Session deleted" row shows it. C. Also log each rename as a row ("Session renamed").
- **Q5 VS Code chats in Previous sessions**: A. **(recommended)** no Rename (they are read-only, spec 009). B. A Durbar-only name for
  them too (same store, `src: 'vscode'`).
- **Q6 Dialog or inline edit**: A. **(recommended)** the small dialog everywhere (same as Rename folder / floor; one path to test).
  B. Inline edit of the chat header title and the Previous row title, dialog from the card menu.
- **Q7 Names already in the schedules file** (up to 80 characters of a title): A. **(recommended)** leave them; show the current display
  name when the session is known (FR-008). B. Also shorten stored names to 40 on the next save of that file.
- **Q8 Copilot refuses double quotes in names**: A. **(recommended)** keep such a name Durbar-only with the FR-010 note. B. Refuse `"`
  in every name (one rule for all apps). C. Replace `"` with `'` before sending to Copilot.
- **Q9 Real check** (after the simulator and fakes, outside CI): A. **(recommended)** one check per app with the owner's go-ahead at that
  time: Copilot, rename a session Durbar already has open (0 prompts if a resumed session is used) and look at `copilot --resume`;
  Codex, rename an existing thread and look at the Codex CLI's resume picker (0 prompts). VS Code is looked at in the same run. B. No
  real check now; keep the `[KNOWN GAP]` lines.

## Changes

(none yet)

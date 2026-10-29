# Feature Specification: Rename sessions

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Rename sessions (issue #372): a short name of the user's own for any main session, shown on every surface (card, list, chat header, strip, inbox, notifications, Schedules, Previous sessions, activity log) instead of the runtime title; also saved in the agent app (Copilot `name.set`, also for a session that is not open through a prompt-free resume; Codex `thread/name/set`; Claude Code `--name` at the next message); **Rename…** in the chat header More menu and the card menu, and the Previous sessions row menu (spec 006, #379)
status: built
note: T050 real checks wait for the owner's go-ahead
-->

**Feature Branch**: `059-rename-sessions`
**Created**: 2026-10-20
**Status**: Built on the simulator and fakes (T010-T040, T060; evidence tags below; T050 real checks open: VS Code, macOS/Windows). The owner answered Q1-Q9 on 2026-10-20 (all A) and changed Q2 to B plus
added Q10 (Claude `--name`) the same day (see *Changes*). 2026-10-23: rename in place (FR-020..FR-027, issue #636) specified by the coordinator under Ruben's delegation and built on the simulator the next day (T070..T078; see *Changes*).
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
| GitHub Copilot (SDK 1.0.22) | **Yes**, `session.rpc.name.set({ name })` (@experimental), on a session object | every session: a live one directly, one that is not live through a prompt-free resume, then released (Q2 B, 2026-10-20) | `real:` yes, `copilot --resume` lists the name (Vikram's agent, CLI 1.0.98, 0 credits) | unverified |
| OpenAI Codex (app-server 0.163+) | **Yes**, `thread/name/set { threadId, name }`, works on a stored thread that is not loaded | every Codex session, open or not | `real:` yes, `codex resume` lists the name, but only a thread that has had a turn (Vikram's agent, Codex 0.163.0) | unverified |
| Claude Code (CLI 2.1.304, stream-json) | **Yes, at the next launch**: `--name <name>` together with `--resume <id>` keeps the session id and appends a `custom-title` that Claude writes itself (`real:` Vikram's agent, issue #372) | the next time Durbar starts that session's CLI (the next message); until then a Durbar name | `real:` yes in the prompt box of `claude --resume <id>`, and in the `/resume` picker **since spec 012 FR-159** (PR #386, `CLAUDE_CODE_ENTRYPOINT=agent-durbar`; before it the picker never listed `-p` sessions, named or not; undocumented variable, `[KNOWN GAP]`) | `real:` **not** shown (Paco's Mac: the session is not listed at all; `[KNOWN GAP]`, untested with #386's entrypoint) |
| VS Code chats (spec 009) | not ours (read-only) | no Rename (Q5 A) | n/a | n/a |

## Clarifications

### Session 2026-10-20

Answered by the owner (Paco, about 10:55 CEST, through the coordinator). He chose the recommended option A for all nine.

- Q1 Where a rename goes when the agent app has an API → A: in the app too (Copilot live sessions, Codex always) and in Durbar; elsewhere
  Durbar only. The dialog says which before saving. An empty name clears only Durbar's copy; the app keeps its last name (FR-004, FR-007).
- Q2 A Copilot session that is not live in Durbar → ~~A: Durbar-only name~~ **changed to B on 2026-10-20** (owner, after Vikram's
  requirements on #372): Durbar resumes it without a prompt (0 credits), calls `session.rpc.name.set`, and releases it again; if that
  fails, the name stays a Durbar name with the FR-010 note (FR-007).
- Q3 Length cap → A: 60 characters (FR-002).
- Q4 Activity log → A: new rows of a renamed session show its user name in the agent column; a rename is not logged (FR-012).
- Q5 VS Code chats in Previous sessions → A: no Rename (FR-006).
- Q6 Dialog or inline edit → A: the small dialog everywhere (FR-004). **Changed 2026-10-23** (coordinator under Ruben's delegation, issue #636): in place everywhere, the dialog stays as a second way in (FR-020..FR-027, D6).
- Q7 Names already in the schedules file → A: left as they are; the current display name is shown when the session is known (FR-008).
- Q8 Copilot refuses double quotes → A: such a name stays Durbar-only for Copilot, with the FR-010 note (FR-007).
- Q10 (2026-10-20, owner, Vikram's requirements) Claude Code → the CLI's own `--name` on the session's next launch (FR-007); Durbar
  never writes the session file. The dialog says the name is also saved in the agent app and may sync (FR-004).
- Q9 Real check → A: one check per app, 0 prompts, only with the owner's go-ahead at that time (T050).

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
- A *Not started* (lazy) or ended card can be renamed; Copilot resumes it quietly for the call (Q2 B), Claude applies the name at its next launch.
- Two sessions get the same name: allowed (names are labels, not ids); the folder in the tooltip tells them apart.
- The runtime later sends a new title (Copilot `session.title_changed`, a resume, a Previous sessions list): FR-011 decides.
- The session is deleted (spec 006 FR-029): its name entry goes with it. The folder is removed: all its names go.
- A session renamed while it is working: allowed; the rename does not touch the turn.
- A 60-character name on a mini or micro desk card: ellipsized like any long title; the office still fits (constitution V).
- The schedules file already holds the first 80 characters of a title as a target name (spec 044): FR-008.
- Right-to-left and other scripts are allowed; invisible direction and zero-width characters are refused (FR-002).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** `[IMPLEMENTED]` **One display name, everywhere.** A main session's display name is, in order: the user's name for it (FR-005),
  else the runtime's title (as today), else the folder label with `#2`, `#3` (as today). It is used on the desk card at every density,
  the list view row, the chat header title, the full-screen agent strip, the lobby visitor label, toasts, the Needs you inbox row, OS
  notifications, the Schedules dialog's *This session (…)* option and its schedule list (FR-008), Previous sessions rows (FR-009), and
  the activity log's agent column (FR-012). Sub-agents keep their own names. The folder stays in the room header and in the card's
  tooltip and accessible name ("name, in folder"), as spec 001 (2026-10-18) says for titles.
- **FR-002** `[IMPLEMENTED]` **The name rule** (one shared, pure function, also used by floor names, spec 033 FR-003): whitespace runs
  become one space and the ends are trimmed; then 1 to **60** characters (code points; Q3 A); no control characters (C0, DEL, C1); no
  invisible direction, zero-width or filler characters (the floor rule's list; ZWJ, ZWNJ, LRM and RLM stay allowed); refused when
  `redact()` would change it (it looks like a token or a key: "That looks like a secret. Use another name."). Errors, one line each:
  "Use 1 to 60 characters." / "Remove control or hidden characters." / "That looks like a secret. Use another name." An empty field is
  not an error: it means reset (FR-004). The same rule runs in main on every IPC call; the renderer only pre-checks.
- **FR-003** `[IMPLEMENTED]` **The runtime title stops showing once a session has the user's name.** Card and header tooltips, the
  inbox and the strip use the user's name, never "runtime title · folder". The runtime title is shown only inside the Rename dialog
  ("Name in <app>: …", cut to 80) so the user can go back to it. Chat history is unchanged (it is the conversation).
- **FR-004** `[IMPLEMENTED]` **Rename dialog.** A small dialog (the shared `askDialog`, as Rename folder and Rename floor; Q6 A):
  - Title **Rename session**. Body: "A short name for this session in Agent Durbar, 1 to 60 characters. Leave it empty to use
    <app>'s title again." plus one line on where the name goes (FR-007, FR-017): "Also saved in GitHub Copilot: its CLI shows the new name, and
    it may sync with your account." / the same for Codex / "Also saved in Claude Code at your next message: it then shows in its /resume list and when you resume this session by its id; it may sync with your account." /
    "Only in Agent Durbar. <app> keeps its own name."
    For a session that already has an app-side name, the line "Name in <app>: <name>".
  - One text field, label **Name**, prefilled with the current display name (cut to 60) and fully selected, `maxlength` 60.
  - Buttons **Cancel**, **Rename** (primary, last; no "…", design rule 6). **Enter in the field saves**, **Esc cancels** (both
    keyboard paths return focus to the opener). `askDialog` gets an option for Enter-to-submit on its input; today Enter does nothing
    in a dialog field (`read:` `src/renderer/dialog.js:40-55`).
  - Validation errors show under the field (`aria-describedby`, `role="alert"` once), the dialog stays open.
  - Success: polite announcement "Renamed." (or "Name reset."), toast only on a partial result (FR-010).
  - Same words and controls in Simple and Expert (spec 052). Fits 1280x800 and 1440x900 (the dialog is the existing size).
- **FR-005** `[IMPLEMENTED]` **Where the user's name is kept.** Each saved folder in `durbar-folders.json` (spec 006 FR-002; same file,
  same version, key = workspace file or folder path) gets an optional list `sessionNames`: entries `{ src, id, name, inApp?, pending? }`.
  `src` = adapter id (the `adapterId` rule); `id` = the runtime's session id (Codex: the thread id; the same id Previous sessions and
  `resumeIdFor` use), shape `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$` when loading the file (tolerant); a rename accepts only the strict `sessionIdOk(adapter, id)` of spec 006 FR-026 (letters, digits, `_`, `-`; main and each adapter check it before any call); `name` passes FR-002;
  `inApp: true` when the agent app accepted the same name (FR-007); `pending: true` for Claude Code between the rename and the next
  launch that carries `--name` (FR-011). At most 200 entries per folder (least recently set dropped).
  Tolerant load: bad entries dropped, duplicates collapse (last wins), nothing throws. **No migration**: no list = no names; an older
  build ignores the field. The entry is never sent to the agent app (except as the rename call itself, FR-007), never put in tool
  usage labels or usage totals (spec 020 / 011 keys stay the folder name), and never logged except as FR-012 says. Written through
  `FolderStore` (atomic, 0600). Gone with Remove folder; dropped when Durbar deletes the session (spec 006 FR-029).
- **FR-006** `[IMPLEMENTED]` **Where Rename… is offered.** Main sessions only, never helpers, never VS Code chats (Q5 A):
  1. the chat header's **More** menu, above the separator (before End session), for a main agent that is live, not started or ended;
  2. the agent **card menu** (office desk card and list-view row; spec 005 FR-017, `cardMenuActions` in
     `src/renderer/modelswitch.js:208`), as one more item in its actions group;
  3. the **Previous sessions** row menu (spec 006 FR-027, issue #368) for agent-session rows, between Pin/Unpin and Hide.
  The item is **Rename…** (it asks for input), tooltip "Give this session a short name". All three open the same dialog; focus returns
  to the menu button that opened it. Keyboard: the menus' existing arrows, Enter, Escape, Shift+F10.
  A **hidden** row in Previous sessions also offers Rename… (first, since no Pin is shown: `Rename…, Unhide, Delete…`), so a hidden
  session can be renamed without unhiding it. The ⋯ tooltip on agent-session rows reads "Pin, rename, hide or delete".
- **FR-007** `[IMPLEMENTED]` **The app-side rename** (Q1 A, Q2 B, Q8 A, Q10; changed 2026-10-20). `AdapterCapabilities` gets
  `renameSession?: 'any' | 'next-turn'` (missing = none); `AgentAdapter` gets `renameSession?(sessionId: string, name: string): Promise<void>`,
  present exactly when the flag is set (spec 012 FR-027, contract check C2). `'any'`: the call renames the session now, open or stored.
  `'next-turn'`: the call remembers the name and the adapter applies it the next time it starts that session's CLI. There is no `'live'`
  value any more.
  - Copilot: `'any'`. A session live in the adapter: `session.rpc.name.set({ name })`. A session that is not live: the adapter resumes it
    **without sending a prompt** (0 credits, `resumeSession` only), calls `name.set`, and releases it (disconnect); a session id that cannot
    be resumed, or any error, is a failure (FR-010). It must not leave the session open. Copilot's own rule is stricter than FR-002 (no
    double quotes, at most 100 UTF-16 units, `read:` SDK `types.d.ts:2662`); such a name is kept Durbar-only with the FR-010 note (Q8 A).
  - Copilot details (review 2026-10-20): the prompt-free resume runs in the folder Copilot stored for that session (`getSessionMetadata().context.workingDirectory`; none = refused),
    with `suppressResumeEvent: true` and `allowTranscriptRecovery: false`. One lock per session id: a start or resume of the same session waits for a rename in flight
    and the other way round, so a card waking up is never disconnected by the rename's release. After a rename of a live session the adapter keeps the name it set; while the session is open a
    `session.title_changed` with any other title (Copilot's auto title, also after a compaction; not cleared on idle) is not passed on, and the same title is a confirmation.
    Only that one event is skipped: usage, cap and idle events always go on. `[KNOWN GAP]` until T050: a rename made elsewhere (the CLI) while the session is open in Durbar is not seen until the
    session is reconnected, because the runtime does not mark an explicit rename apart from an auto title.
    T050a (`real:` 2026-10-21) showed that Copilot keeps the `name.set` name across a resume (`rpc.name.get`), so after a reconnect or a restart the first `session.title_changed` is expected to equal the user's name and confirm it (FR-011).
  - Codex: `'any'`; `thread/name/set { threadId, name }` on the session's own app-server when live, else on a short-lived one
    (`probe`, `src/adapters/codex.ts:312`), as `listPreviousSessions` does. An archived thread is refused by Codex (FR-010).
  - Claude Code: `'next-turn'`. The adapter keeps `{ sessionId -> name }` and adds `--name <name>` to the next CLI start of that session
    (`--resume <id> --name <name>` keeps the session id and appends a `custom-title`, `real:` below); a running session is relaunched
    before its next message, as for a mode change (`needsRelaunch`, no extra prompt). When the first turn after that launch finishes, the
    adapter reports the name as the session's `title`, and Durbar clears `pending` and sets `inApp` (FR-011). Durbar never writes the
    session file. If the CLI is not started again (Durbar closes first), main asks again on the next start (FR-014). Until then the
    name is Durbar's, and the dialog says so. The name is shown in the prompt box when the session is resumed by id, and in the CLI's `/resume` list
    because spec 012 FR-159 (PR #386) starts Durbar's Claude sessions with `CLAUDE_CODE_ENTRYPOINT=agent-durbar` (`real:` Vikram's agent: the picker lists
    the session by its `--name`; the picker's Ctrl+R rename writes the CLI's own title, which FR-011 then treats as a rename elsewhere). Durbar does
    not set that variable here. **Copy resume command** (the More menu item) gives the id.
  - Claude on the SDK transport (dev opt-in `DURBAR_CLAUDE_TRANSPORT=sdk`) does not apply `--name`: the adapter and its descriptor then report no `renameSession`
    (Durbar-only name there).
  - The fake adapter can be built with either flag and records calls. Tests use only fakes; no real store is touched.
  Main decides: if the adapter has the member, it calls it after the name passed FR-002 (any session, open or stored: the adapter
  decides how); on success the entry is saved with `inApp: true` (`pending: true` for `'next-turn'`); on error the entry is Durbar-only
  (FR-010). The dialog's FR-004 line is computed from the capability before the user saves, so it never promises what will not happen.
  `real:` evidence (Vikram's agent, Vikram's accounts, 2026-10-20, issue #372, docs/agent-notes.md). Claude Code 2.1.304, haiku, 2 tiny prompts, USD 0.0037:
  `claude -p … --name A` wrote `{"type":"custom-title","customTitle":"A"}` into the session; `claude -p … --resume <id> --name B` kept the
  same session id and appended `B` (the last one wins). With 4 prompts (USD 0.007) and the `CLAUDE*` variables unset: `claude --resume <id>` shows the
  latest name in the prompt box; the `/resume` picker said "No conversations found in this project" (sessions of `-p` have `entrypoint: sdk-cli`).
  Without the variable the picker listed nothing (`sdk-cli` entrypoint); with FR-159 it lists the named session (`real:` Vikram's agent, about $0.03). `real:` (Paco's Mac, 2026-10-20, Claude Code 2.1.304, 1 prompt, USD 0.137): `claude -p "say hi" --name durbar-test-name` wrote `custom-title: durbar-test-name` (entrypoint `sdk-cli`), but the VS Code Claude Code extension's session list did **not** show that session at all (likely it hides `-p` / `sdk-cli` sessions; not verified). `[KNOWN GAP]`: VS Code visibility of Claude names is not achieved for `-p` sessions; untested whether #386's `CLAUDE_CODE_ENTRYPOINT=agent-durbar` changes that, or whether the extension reads `custom-title` at all. The dialog says so. The variable is undocumented by Anthropic (recheck after Claude updates). Copilot (CLI 1.0.98):
  `name.set` works live or after `resumeSession(id)` with no prompt, `copilot --resume` lists the name, 0 AI credits. Codex 0.163.0:
  `thread/name/set` works before or after a turn, `codex resume` lists the name only for a thread that has had a turn (1 tiny turn in the test): a
  thread with no turn keeps the name but is not listed until its first turn.
- **FR-008** `[IMPLEMENTED]` **Schedules** (spec 044 FR-014, FR-021). The *This session (…)* option shows the display name (FR-001), cut
  to 40 characters on a word boundary with "…" (spec 044 FR-021, merged with #388: the one shared cutter `src/renderer/cuttext.js`, code points, at most `max` including the "…"; 059's `SN().shortName` calls it with `wordBoundary` and has no cut rule of its own), full name in its `title`. The hint line under *Send to* (#388) shows the session's display name `ag.name` (the user's rename), full text with its `title`, cut by CSS only. A new schedule stores as `target.name` that
  short display name, never a longer title. The schedule list shows the **current** display name of the target session when that
  session is known (by `target.session`), else the stored name, else "one session" (today: the stored name, `src/renderer/app.js:3502`).
  Stored names in existing files are not rewritten (Q7 A).
- **FR-009** `[IMPLEMENTED]` **Previous sessions.** `sessions:listPrevious` results carry `names: { [id]: name }` for the ids present in
  that result (from FR-005). A row with a user name shows it as the title (its tooltip too, FR-003), and the search box (spec 006 FR-023)
  matches the user name; the runtime title is not searched for that row. Resume gives the new agent that name (`AgentInfo.alias`).
  A Copilot or Codex row renamed in the app shows the app's name anyway (the list already prefers it: `src/adapters/history.ts:99`,
  `src/adapters/codexHistory.ts:41`).
- **FR-010** `[IMPLEMENTED]` **Partial results and errors.** When the app-side rename throws or refuses, the name is still saved as a
  Durbar-only name, and a toast says "Renamed in Agent Durbar only. <App> did not accept the name: <short reason>." (reason cut to 120,
  passed through `redact()`). When saving the folder file fails, nothing changes on screen and the toast says "Could not rename the
  session." A second rename of the same session while one is in flight is refused ("Already renaming this session.").
- **FR-011** `[IMPLEMENTED]` **When the runtime title changes later** (Copilot `session.title_changed` or `name.get`, a resumed session's
  list title, the Previous sessions list, a Codex `thread/name/updated`):
  - a Durbar-only entry (`inApp` absent) or a `pending` one **wins**: the display name does not change; the new runtime title is kept only for the dialog's
    "Name in <app>" line;
  - an `inApp` entry whose app name now differs from the entry (renamed elsewhere, for example in the CLI) is **dropped**: the app's
    new name shows. Equal names change nothing;
  - a `pending` entry whose title arrives equal to its name becomes `inApp` (the CLI stored it);
  - with no entry, the runtime title shows (today's behaviour).
  `applyTitle` (`src/renderer/app.js:2604`) and main's title handler (`src/main/main.ts:147`) follow this; a pure function decides it
  (`displayNameOf(entry, runtimeTitle, folderLabel)` plus `syncEntry(entry, runtimeTitle)`), unit-tested.
- **FR-012** `[IMPLEMENTED]` **Activity log** (owner decision on #368 Q2: "the user's own alias may be shown"; Q4 A). New rows of a session
  with a user name show that name in the `agent` column (sanitized and cut to 80 as today, `src/shared/activity.ts:12`); other rows keep
  today's value (`a.label || a.name`, the folder label, `src/main/main.ts:166`). The runtime title never goes into the log. Rows
  already written are not rewritten. A rename itself is **not** logged (it changes no permission or state; Q4 A). Spec 006 FR-031's
  "Session deleted" row may then name the session with its user name.
- **FR-013** `[IMPLEMENTED]` **IPC (main validates everything).** `sessions:rename(agentId, sessionId | null, name)`:
  `sessionId` null = the agent's own session (`resumeIdFor(agentId)`); else it must be among this agent folder's previous sessions of
  the same adapter (`previousSessionsOf`, the re-check resume uses, `src/main/main.ts:413`) or the resume id of another office agent of
  the same folder. `name` is a string (empty = reset). Answer `{ ok: true, name?: string, inApp: boolean, pending?: boolean, note?: string }` or
  `{ ok: false, error }`. Office agents of that session get `AgentInfo.alias` and an `agents:renamed` event so every window updates;
  a reset clears `alias`. The renderer never sends a path or an adapter id.
- **FR-014** `[IMPLEMENTED]` **Restore.** On start, agents restored from `lastSession` / `openSessions` (spec 006 FR-020/021, spec 052
  FR-088) get their `alias` from the folder's `sessionNames` by resume id. A resumed session (Previous sessions) gets it too. A `pending` entry makes main call `renameSession` again for that session so a
  `'next-turn'` adapter applies it at that launch.
- **FR-015** `[IMPLEMENTED]` **Simulator.** `src/renderer/sim.ts` implements `renameSession` in memory, with one sim agent kind that has
  `'any'`, one with `'next-turn'` and one without (so the three dialog lines and the partial-result toast can be shown), and a hook that makes
  the next app-side rename fail. Previous sessions rows (`prev-1`, `prev-2`) can be renamed.
- **FR-016** `[IMPLEMENTED]` **Fit and legibility.** Names are escaped wherever shown; 60-character names ellipsize on cards, strip, inbox,
  header and rows with the full name in the tooltip; `check:office` passes with 15 agents carrying 60-character names at 1440x900 and
  1280x800; 10.5px floor; design rules 1, 4, 5, 6, 8, 9 hold.
- **FR-017** `[IMPLEMENTED]` **The dialog says where the name goes and that it may sync** (Vikram's requirement on #372 and PR #376). For
  Copilot, Codex and Claude Code the dialog's second line (FR-004) says the name is also saved in the app and may sync (for example with
  Copilot remote control on, spec 054); a name saved in an app cannot be removed again from Durbar (an empty name resets only Durbar's copy).
- **FR-018** `[IMPLEMENTED]` **Escaping is tested on every display path.** `npm run check:rename` renders a name such as `<img src=x onerror=...> & "q"` in the
  simulator on the desk card (text and tooltip), list row, chat header (text, tooltip, aria-label), strip item, Schedules option and Previous
  sessions row and its search, and fails if an element or a script results. `test:sessionname` guards the templates: no `alias`, agent name or title
  may be interpolated into a template without `esc()` (mutation: removing `esc()` from the Schedules option fails `npm test`). The Needs you inbox
  and OS notification text are **read, not rendered**: the inbox uses the same display name through `esc()`, notifications are plain text through the
  Notification API. The Durbar MCP read tools show the folder label, not the session name; a test pins that. The repo has no Telegram list
  (`[KNOWN GAP]`: if one is added it must use `displayNameOf` and the same escape).
- **Constraints:** agent specifics stay behind `AgentAdapter` (the renderer gets a capability value and a computed "where it goes"
  line); no shell; no paths over IPC; Durbar never edits another tool's files (Claude's `.jsonl`, Copilot's session state, Codex's
  store); simulator, fakes and unit tests only; no real session in tests; Windows, macOS and Linux behave the same (no paths involved).
- **FR-019** `[IMPLEMENTED]` **A name that is one long unbroken token stays inside its box** (issue #536; owner report 2026-10-22: a session with no name of its own
  shows its first prompt, and a URL in it ran out of the desk card). On every surface that shows a session or agent name (desk card in full, roomy and compact,
  list view, chat header, strip, Needs you inbox, Schedules rows, Previous sessions rows) the name never leaves its box. On full desk cards it wraps to
  at most 2 lines and then ends in "…" (line clamp), and a token with no space may break anywhere (`overflow-wrap:anywhere`); this is the one exception to the
  "words move whole to the next line" rule of spec 052 FR-165, which is for help text, because a name is data the user does not control. The other surfaces (roomy and compact cards included) keep one line
  with an ellipsis. The full name stays in the existing tooltip (`nameTipAttr`, spec 052 FR-168). Card widths do not change; a full card's name stops at 2 lines, so a card with a long name can only get shorter. `simnames=long`
  (FR-016) gives the third agent (it waits for you, so it is also in the inbox) no alias and a long first-prompt **title** (over 60 characters, which a title may be) that holds one URL-like token (no real address, `example.invalid`); the full-layout cases force `density=full` so they do not depend on grown desks (spec 001, #532), and `check:office` fails when any `.name` on a card overflows
  its box or takes more than 2 lines on a full card (explicit `line-height:18px`) at 1440x900 and 1280x800.

### Key Entities

- **Session name entry** `{ src, id, name, inApp?, pending? }` in a saved folder's `sessionNames` (FR-005).
- **AgentInfo.alias** (main and window): the user's name for an office agent's session, display only (FR-013).
- **Capability `renameSession`**: `'any' | 'next-turn'` or missing (FR-007).

## Success Criteria *(mandatory)*

- **SC-001** Every surface in FR-001 shows the user's name within one render after Rename, in the simulator, at both sizes, Simple and
  Expert (`scripts/check-rename.js` (run by hand, not in CI: `NOT_IN_SUITE`, spec 021 FR-057)).
- **SC-002** No surface shows the runtime title of a renamed session outside the Rename dialog and the chat history (same check).
- **SC-003** The name rule refuses every case in its test table (controls, hidden characters, 61 characters, tokens) and accepts
  scripts and emoji up to 60 code points.
- **SC-004** Fakes prove: Copilot live → one `name.set`; Copilot not live → no call, Durbar-only; Codex open or not → one
  `thread/name/set`; Claude → no call; an adapter error → Durbar-only plus the note.
- **SC-005** `check:office` still passes with 60-character names; `npm run typecheck && npm run build && npm test` green; 0 AI credits.

## Assumptions

- Copilot SDK pinned at 1.0.22 (`name.set` is @experimental and may change; the adapter catches and falls back, FR-010). That a prompt-free
  `resumeSession` of a stored session works and costs nothing is `real:` (T050a, 2026-10-21, 0 prompts, 0 credits; see research.md).
- Codex 0.163.0 or later (`CODEX_MIN_VERSION`, `src/adapters/detect.ts:47`) has `thread/name/set` (`read:` the `rust-v0.163.0` tag).
- Claude Code stays on the CLI transport; the optional Agent SDK transport (`src/adapters/claudeSdk.ts`) is not used for rename (research R3).
  Whether the VS Code Claude extension lists the `--name` title is `[KNOWN GAP]` (check on a Mac).
- Spec 006's per-row ⋯ menu (issue #368, PR #373, T036) lands before US3; US1 and US2 do not depend on it.

## Open questions (answered 2026-10-20)

All answered with option A (see *Clarifications*); kept here for the record of the alternatives.

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

### 2026-10-29: index status text kept from before the fixed status words (spec 021 FR-063)

The `status:` of the specs-index block used to read (moved here unchanged; the block now has one status word and a short note):

> **Built, simulator and fakes** (name rule, store, IPC, three adapters, dialog, surfaces, `check:rename`); `real:` app calls by Vikram's agent (Copilot, Codex, Claude CLI lists); open: VS Code visibility, macOS/Windows, T050; delta 2026-10-23: rename in place (#636, #595: click the chat title, a pencil by each name, F2; FR-020..FR-027, T070..T078) built on the simulator 2026-10-24, not run on a real Mac or Windows


### 2026-10-20: owner changes Q2; Vikram's requirements (issue #372)

Owner (Paco, 2026-10-20, about 14:35 CEST): accept Vikram's requirements on issue #372 and **change Q2** to B.
- **Q2 → B.** A Copilot session that is not live is renamed in the app too, through a prompt-free resume + `session.rpc.name.set`
  (0 credits, no message sent), then released; if that fails, the Durbar name stays with a note. Reason: names set in the app are found
  outside Durbar (the CLI, VS Code), also for earlier sessions. FR-007 and the table are rewritten; the capability value `'live'` is gone.
- **Claude Code** is renamed by Claude itself through `--name` on the session's next launch (Q10; FR-007; `real:` evidence from Vikram's
  agent, see FR-007 and research R3). Capability `'next-turn'`; entry flag `pending` (FR-005, FR-011, FR-014). VS Code visibility stays
  `[KNOWN GAP]`, to be checked on the owner's Mac.
- **Dialog words** say the name is also saved in the app and may sync (FR-004, new FR-017). **Escape test** on every display path (new
  FR-018). Tasks: T031 Copilot (resume + name.set), T032 Codex, new T035 Claude (`--name`), T030/T033/T034 adapted, T051 real checks
  extended; see tasks.md. Research R1 and R3 are updated; plan follows.


### 2026-10-20 (later): built; #379 and #386 merged

- Spec 006's row menu (#379) is on `main`: **Rename…** is in it (FR-006, T040), and a deleted session's name goes with it (`dropSessionName`).
  Cross-links: spec 006 FR-027 gets this item; #371 (spec 044 FR-021, pending when this was built) says the short name will come from the rename: that is FR-008 here (the Schedules option
  and a new schedule use `SN().shortName(ag.name, 40)`, which is `cuttext.js`; the hint shows `ag.name`). #371/#388 is merged: `check:sched-sendto` and `check:rename` both pass.
- Spec 012 FR-159 (#386): Claude's `--name` titles now show in the CLI's `/resume` list (FR-007 above).
- Not rendered by any test: the Needs you inbox row and OS notification text. They were **read**: the inbox uses the display name like the other surfaces, notifications
  go through the Notification API as plain text; `test:sessionname` guards that no agent name or title is put into a template without `esc()`.
- A card that was never started (no session in the agent app yet) is renamed in Durbar only.
- Review 2026-10-20: Copilot rename-resume folder, flags and per-id lock; strict id rule; auto-title ignore; Claude SDK transport reports no rename (FR-007).

### 2026-10-22: a long unbroken name overflowed the desk card (issue #536, FR-019)

Spec 001 owns the card layout, but this spec owns where names are shown and `simnames=long` (FR-016), so the rule is here (FR-019) and spec 001 only
gets a pointer. Fix: line clamp on full cards, ellipsis elsewhere, simulator name and `check:office` assertion. Task T061.
- `test:` built 2026-10-22 (simulator only). The roomy and compact cards (`.l1 .name`), the chat header, strip, list row and Previous sessions row already cut a long name to one line;
  the full card (`.who .name`) was the only one that did not, so only it got the 2-line clamp (a roomy card keeps its one line so card sizes do not change). `check:office` (new `sim=3` full-layout case
  and the 12 and 15 agent offices) and `check:rename` (step 7, a 60-character token on the header, strip, card, list row and a Previous sessions row) fail when a name leaves its box; `scripts/shots-059-long-url.js`
  took `docs/screenshots/059-long-url-name-{before,after}-{1440x900,1280x800}.png` (and `-inbox-` after). Before the fix the name ran 4 lines and out of its card.
- `test:` the Needs you inbox row (`.ib-n`), the Schedules dialog (row and the "Send to" hint) and the Settings schedule row were checked with the URL-like first prompt (agent 3, which waits for you) and a schedule whose prompt is one long token, at both sizes, by `scripts/shots-059-long-url.js` (in `check:ui`). It guards the Schedules list rows against a prompt that is one long token: that overflow was already fixed on main by spec 044 T047 (`.sched-dlg .sc-list{grid-template-columns:minmax(0,1fr)}`, #531); removing that rule makes this driver fail.
- `[KNOWN GAP]` The OS notification text and the activity log were read, not rendered (plain text, no layout).

### 2026-10-23: rename in place (issue #636, absorbs #595; FR-020..FR-027)

Owner request (Ruben, 2026-10-23, issues #636 and #595): rename where the name is, not through a menu and a dialog. The decisions below
(D1..D9) were **decided by the coordinator under Ruben's delegation**. They change **Q6** from A (the dialog everywhere) to "in place
everywhere, the dialog stays as a second way in" (D6). FR-004 (the dialog) and FR-006 (the menu items) are unchanged and stay
`[IMPLEMENTED]`; spec 006 FR-018 (folder display name) gets a cross-reference delta, because this spec owns the shared editor. Status of
FR-020..FR-027: built 2026-10-24 on the simulator (T070..T078): `[IMPLEMENTED]` with `test:` and `sim:` evidence below; not run on a real Mac or Windows.

**Decisions (coordinator, under Ruben's delegation):**

- **D1** Chat header (`#panelTitle`): a single click on the title edits it in place; **F2** and **Enter** on the focused title do the same.
  Focusing the title when a chat opens (spec 074 FR-019 fallback, `remoteBack`, `openPanel(id,'title')`) never starts an edit.
- **D2** Desk cards, list-view rows, Previous sessions rows and folder names (on the floor and in the lists): a single click still
  **opens** the item. A small pencil button next to the title starts the edit; it is visible on hover or focus-within, and always present for
  keyboard and screen readers. **F2** on a focused card, row or folder also starts it. No double-click anywhere.
- **D3** Enter saves, blur saves, Esc cancels and restores. An empty or all-spaces name resets to the default name, as the dialog does.
  Same length limit and validation as today.
- **D4** Same bridge calls (`bridge.renameSession`, `bridge.renameFolder`): no new IPC, no change to storage. Helpers' names are not editable
  (FR-006): no pencil there.
- **D5** One shared inline-edit helper for every place, reusing what exists (`renameSessionUi` / `renameFolder` logic, `SN().nameError`); no
  second copy of the validation.
- **D6** The **Rename…** menu items (FR-006) and the Folders panel's **Rename** button stay, opening the existing dialog.
- **D7** Accessibility: where a click edits, the title is announced as a button "Rename <kind> <name>"; the pencil has `aria-label`
  "Rename <name>"; the field has an `aria-label`; after save or cancel, focus returns to the title or the pencil.
- **D8** The header and the card do not change height while editing; text at least 10.5px; 15 agents still fit at 1440x900 and 1280x800.
- **D9** #595 is closed as a duplicate of #636 when the PR opens; its *Note for #587* is kept (D1, FR-023 item 7).

**Requirements:**

- **FR-020** `[IMPLEMENTED]` **Where a name is renamed in place, and how it starts.**
  1. **Chat header** (`#panelTitle`, main sessions that `canRenameSession` allows): the heading keeps the name as its text and its
     accessible name (`aria-label` = the display name); inside it the name is a button (`aria-label` "Rename session <name>"). A single
     click on it, or F2 / Enter while the heading or the button has focus, starts the edit. A decorative pencil (`aria-hidden`) shows on
     hover and focus as the cue. Tooltip: the FR-003 tip followed by " Click or press F2 to rename." (a data tooltip, at most 300 characters,
     spec 052 FR-168). A click whose `detail` is above 1, or that comes within 400 ms after the chat opened, does not start an edit (the
     second click of a double-click on a desk lands on the header of a full-screen chat).
  2. **Desk card** (every density) and **list-view row**: a pencil button, a **sibling** of the card or row button (never nested inside a
     `<button>`), placed by the name. F2 on the focused card or row starts the same edit. A click on the card or row (outside the pencil)
     opens the chat as today.
  3. **Previous sessions rows** (agent-session rows only, FR-006 item 3; also hidden rows): a pencil button after the row title
     (`.prev-t`), before Resume. F2 on any control of the row starts it. VS Code chat rows get none (Q5 A).
  4. **Folder names**: the room header on the floor (after `.room-name`, open rooms), the Folders panel rows (`#foldersPop .fp-row` name);
     not the list view's Folder cell (`.lfold`), which repeats on every row (Q-B, plan). F2 on a focused door, closed-room plate (`[data-door]`) or folder ⋯ button
     (`[data-foldermenu]`) starts the folder edit. Only when `bridge.renameFolder` exists, not in the demo (`demoOn`), and the folder has a main
     agent (as `renameFolder` requires today).
  5. **Never** for helpers (FR-006), VS Code chats, demo agents, or a session `canRenameSession` refuses. The full-screen strip has no
     pencil (the header above it does the job). Double-click does nothing new anywhere.
  6. The pencil is a real `<button type="button">` with `aria-label` "Rename <name>" (folders: "Rename folder <name>"), drawn with an
     SVG pencil icon (not the emoji character: constitution V, "no emoji in compact scenes"). Hidden with `opacity:0` (never `display:none`
     or `visibility:hidden`, which would drop it from Tab order and screen readers); shown on `:hover`, `:focus-within` and
     `@media (hover:none)`. On cards and list rows it takes no layout space (positioned); it never covers the status word, pill, badge,
     chat number, draft mark or mode icon.
- **FR-021** `[IMPLEMENTED]` **The field.** One single-line text field over the name (positioned on top of the name's box, not inserted into
  the card, row or heading markup), with the name's own font size and weight (never under 10.5px), prefilled with the current display name
  (sessions: cut to 60 with `SN().shortName`, as the dialog; folders: `r.name`) and fully selected. `maxlength` as the dialog (sessions 60,
  folders 40). Keys and events:
  1. **Enter** saves; when the text breaks the rule (`SN().nameError` for sessions; folders: the dialog's rule today, `maxlength` 40 only,
     main's `parseLabel` decides), the field stays open with the reason in a small line under it (`role="alert"`, 12px) and nothing is
     sent. A refusal from main with one of the rule's reasons (the `renameSessionUi` pattern `^(Use 1 to|Remove control|That looks like a
     secret)`) is shown the same way.
  2. **Blur** (focus moves elsewhere in the window) saves. Blur because the **window** lost focus (`document.hasFocus()` false) keeps the
     field open. A blur save whose text breaks the rule does not save: the old name comes back and a toast says "Not renamed: <reason>".
  3. **Tab / Shift+Tab** save like blur and put focus back on the title or pencil (the field sits outside the normal Tab order).
  4. **Esc** cancels: the current name is shown again and focus returns (FR-024). Esc never reaches the global handler (it must not close
     the chat, the Folders panel or the inbox) and never cancels an IME composition's edit (see 6).
  5. **Unchanged** text (equal, after whitespace collapse and trim, to the prefill) closes the field with **no bridge call** and no
     announcement. In particular Enter or blur on a session that has no user name does not turn its runtime title into a user name.
  6. **IME:** a key event with `isComposing` (or `keyCode` 229) never saves or cancels; Enter during composition only commits the
     composition.
  7. **Paste:** line breaks and tabs in pasted text (CR, LF, CRLF, TAB) become one space each before they reach the field (a text input
     would otherwise drop them and glue the words); everything else is left to the rule (U+2028 / U+2029 and other hidden characters are
     refused with the rule's reason).
  8. **Empty or all spaces** resets: sessions call `bridge.renameSession(id, sessionId|null, '')` (the runtime title comes back, "Name
     reset."), folders call `bridge.renameFolder(id, '')` (the folder's own name).
  9. While the call runs the field is read-only with `aria-busy="true"`; a second Enter or a blur does not send again.
  10. Only one inline edit at a time: starting another (F2 elsewhere, another pencil) first saves the open one, as blur does.
- **FR-022** `[IMPLEMENTED]` **One helper, the existing paths.** A small renderer module (`src/renderer/inlinename.js`, pure key and text
  logic plus a thin DOM part with an injected `document`) is used by every surface of FR-020. What happens on save is the **existing** code,
  split out so the dialog and the field share it, not copied:
  - sessions: the submit part of `renameSessionUi` (call `bridge.renameSession`, the rule-reason check, `a.alias` + `repaintName` for the
    agent's own session, `onDone` for a Previous sessions row as `renamePrevRow` does, "Renamed." / "Name reset." announcements, the FR-010
    note toast, the error toast);
  - folders: the submit part of `renameFolder` (call `bridge.renameFolder`, set `r.name`, `renderFilter`, `renderFolders`, `scheduleRender`,
    refresh the open panel), with the same "Could not rename the folder." toast.
  The dialog paths (D6) call the same submit parts, so the two ways in cannot drift. No new IPC channel, no change to `durbar-folders.json`,
  `sessionNames`, `AgentInfo` or the adapters; main's validation (FR-013, spec 006 FR-018) is unchanged.
- **FR-023** `[IMPLEMENTED]` **When something changes while the field is open.**
  1. **A late runtime title** (`applyTitle`, a `session.title_changed`) while a session without a user name is being edited: the field
     keeps what the user typed; `repaintName` updates the name under the field and the button's labels, never the field's value. Unchanged
     text then makes no call (FR-021 item 5) and the new title shows; typed text is saved as the user's name and wins.
  2. **Renamed elsewhere** while editing (`agents:renamed` from main, an FR-011 sync that clears the alias, the folder's `r.name` changed by
     another path): same rule: the typed text is kept; Esc restores the **current** name, not the one at the start; saving sends the typed
     text (the newest act wins). Unchanged text makes no call.
  3. **The session ends** while editing (status `ended`): the edit stays open and saving works (FR-006 allows renaming an ended session).
  4. **The item leaves the window** (the session is removed from the office, the folder is removed or hidden, its floor is turned off): the
     field closes **without saving**, and focus goes to the nearest place that still exists (the room header, the office, or the chat title).
  5. **Re-render** (status ticks, morph of the office, the list's `innerHTML`, a density change, a resize): the field is not part of that
     markup, stays open with its text, selection and IME state, and follows the name's new box; if the name is no longer on screen (the room
     was closed, the view switched to List or Office, the chat closed), the field saves as blur does.
  6. **A dialog opens** over it (a permission request, the inbox): the focus move is a blur and saves (item 2 of FR-021).
  7. **Note for #587 (kept):** opening a chat may focus `#panelTitle` (spec 074 FR-019 fallback when there is no usable message box,
     `focus==='title'`, `remoteBack`); focus alone never starts an edit, and the Enter that opened the chat from a desk is not seen by the
     header (the edit starts only on a keydown whose target is the title).
- **FR-024** `[IMPLEMENTED]` **Accessibility and words.** The field's `aria-label` is "Name of session <name>" / "Name of folder <name>",
  `aria-describedby` points to a short hint (sr-only) "Enter saves, Escape cancels. Empty uses <app>'s title again." (folders: "...uses the
  folder name."). After save or cancel, focus returns to the control that started the edit (the title button, the pencil, or the card / row /
  door where F2 was pressed); if it was re-rendered, the same control is found again by its key (`data-id`, `data-door`, `data-pk`), as
  `refocusAnchor` does. Announcements are the polite ones of FR-004 ("Renamed.", "Name reset."). Same words and controls in Simple and
  Expert. The shortcut sheet (spec 052 FR-043, `openKbdHelp`) gets one row: "F2: rename the focused session or folder (Fn+F2 on a Mac)" (plain F2 is a media key on many Mac keyboards; the click on the title, Enter on the focused title and the pencil work without it). The pencil's tooltip
  is its `aria-label` (at most 120 characters, spec 052 FR-168). F2 does nothing under a dialog (`modalOpen()`), in a text field, or on an
  item that cannot be renamed.
- **FR-025** `[IMPLEMENTED]` **Fit (constitution V).** Opening the field changes no element's size or position: the chat header, the card,
  the row and the room header keep their height and width (the field is drawn over the name's box, at least the box's width and at most the
  card's or row's inner width, scrolling its text inside). Nothing under 10.5px. With 15 agents and 60-character names (`simnames=long`) the
  office fits at 1440x900 and 1280x800 with the pencils shown (hover and focus-within) and with a field open. The header title on macOS is
  outside the window drag region (the chat header `.ph` is not a drag region today, `styles.css:1592`); a check pins it.
- **FR-026** `[IMPLEMENTED]` **Docs and help text.** README (feature list "Rename a session (More menu, the card menu)" and "A room's ⋯ menu
  offers ... Rename"): say that a click on the chat title, the pencil next to a name, or F2 renames in place, and that the menus still do. The
  More menu item tooltip "Give this session a short name" and the folder menu hint stay. A `changelog.d/059-rename-in-place.md` fragment.
- **FR-027** `[IMPLEMENTED]` **Checks.** Unit test of the pure part (keys, IME, paste, unchanged, empty) in `scripts/test-inlinename.ts`; a
  simulator driver `scripts/check-rename-inline.js` (`npm run check:rename-inline`, in `check:ui`) for every surface of FR-020 and every
  item of FR-021 and FR-023, at 1440x900 and 1280x800, Simple and Expert; a `check:ui-text` surface with the field open; screenshots of the
  edit state for the header, a card, a Previous sessions row and a folder; the linked pictures retaken where they changed.

**Acceptance scenarios (US4, rename in place, P1):**

1. **Given** an open chat of a main session, **When** the user clicks its title, types "Billing refactor" and presses Enter, **Then**
   `bridge.renameSession` is called once with that text, every FR-001 surface shows it, "Renamed." is announced and focus is on the title
   button. The header did not change height.
2. **Given** the same, **When** the user presses Esc instead, **Then** no call is made, the old name shows, the chat stays open and focus is
   on the title button.
3. **Given** a chat opened from a desk with Enter and no usable message box (focus on `#panelTitle`), **Then** no field is open; **When**
   the user presses F2 (or Enter again), **Then** the field opens with the name selected.
4. **Given** a desk card in the office (any density), **When** the user clicks the card, **Then** the chat opens (no edit). **When** the
   user hovers or tabs to the card, **Then** the pencil shows; clicking it opens the field over the name and the chat does not open.
5. **Given** a focused desk card or list row, **When** the user presses F2, types a name and Tabs away, **Then** the name is saved and focus
   is back on the card or row.
6. **Given** an open field, **When** the user clears it (or types only spaces) and presses Enter, **Then** the session shows its runtime
   title again (folders: the folder's own name) and "Name reset." is announced.
7. **Given** a session without a user name, **When** the user opens the field and presses Enter or clicks away without typing, **Then** no
   call is made and the session still has no user name.
8. **Given** an open field with a 61-character or hidden-character name, **When** the user presses Enter, **Then** the field stays open
   with the rule's reason under it; **When** the user clicks away instead, **Then** the old name comes back and a toast says
   "Not renamed: <reason>".
9. **Given** an IME composition in the field, **When** the user presses Enter to pick a candidate, **Then** the composition is committed
   and nothing is saved; a second Enter saves.
10. **Given** the clipboard holds "Billing\nrefactor\r\n", **When** it is pasted into the field, **Then** the field reads "Billing
    refactor " and Enter saves "Billing refactor".
11. **Given** a session being edited, **When** the runtime sends a late title, **Then** the typed text stays in the field; saving keeps the
    typed name; Esc shows the new title.
12. **Given** a session being edited, **When** it ends, **Then** the field stays and saving works; **When** instead it is removed from the
    office, **Then** the field closes without a call and focus is not lost to the page.
13. **Given** a folder being edited, **When** its name changes by another path, **Then** the typed text stays; Esc shows the new name.
14. **Given** a Previous sessions agent row (shown or hidden), **When** the user clicks its pencil, renames it and presses Enter, **Then**
    the row title, its tooltip and the search use the new name and focus is on the row's pencil. A VS Code chat row has no pencil.
15. **Given** a helper (sub-agent) card or a helper chat, **Then** there is no pencil and its title is not a button; F2 does nothing.
16. **Given** a 60-character name, **When** the field is open on a mini desk card at 1280x800 with 15 agents, **Then** nothing moves, the
    field's text is at least 10.5px and scrolls inside the field.
17. **Given** the field is open in the chat header, **When** the user presses Esc, **Then** the chat does not close; a second Esc (field
    closed) closes it as before.

**Edge cases added:** a second click of a double-click on a desk that lands on a full-screen chat header (FR-020 item 1); the window losing
focus (FR-021 item 2); a dialog opening over the field (FR-023 item 6); two edits at once (FR-021 item 10); the draft mark already uses a
pencil icon on cards (`draftHTML`, `ICON('edit')`): the rename pencil must not look like it (open question for the coordinator, plan *Rename
in place*).

**Evidence (built 2026-10-24):**

- `test:` `scripts/test-inlinename.ts` (keys, IME, paste, unchanged, empty, blur rule, and the field's logic in jsdom); `scripts/test-sessionname.ts` (escaped labels, one `bridge.renameSession` and one `bridge.renameFolder` call site).
- `sim:` `scripts/check-rename-inline.js` (`npm run check:rename-inline`, in `check:ui`), 1440x900 and 1280x800, Expert and Simple: scenarios 1-17 except those listed below; `check:ui-text` surfaces `rename-inline-card`, `rename-inline-header` (and `-long`) with the rule `inline-edit-fit`; `check:office` forces every pencil visible and checks none covers the status word, pill, badge, chat number, draft mark or mode icon.
- Screenshots: `docs/screenshots/059-rename-inline-{header,card,prev,folder}-{1440x900,1280x800}.png`.
- Mutations that make the driver print `DRIVER FAILED`: no `stopPropagation` on Esc, the input inside the name, no `detail` guard, submit on unchanged text, `visibility:hidden` on the pencil; `check:ui-text` fails with a 10px field font or a field that moves the header by 1px.
- `sim:` a room hidden or removed while its field is open (hooks `hideRoom`, `removeRoom`) closes the field with no `renameFolder` call and focus stays on a real control; a save still running when another edit opens leaves one field, and its late answer does not take focus (unit test and driver).
- `[KNOWN GAP]` Not driven: FR-023 item 6 (a dialog opening over the field; the blur path is unit-tested); the demo (`demoOn`) shows no pencil by construction, not driven; the macOS drag region is read in the simulator with `data-platform="darwin"` only, not on a real Mac or on Windows.
- Linked pictures retaken with `npm run shots:docs -- --only shots-hero,shots-003-011,shots-005-cardmenu,shots-006-prevmarks,shots-052-ux,shots-074-navigator`: none shows a pencil (hidden until hover or focus) and the committed ones already differ from this machine's rendering; none was replaced.
(no agent call changes; FR-007 is untouched).

### 2026-10-24: one rule for folder names (review of PR #708)

Decided by the coordinator under Ruben's delegation, after Paco's review. A folder's display name (spec 006 FR-018) now follows the SAME rule as a session name, in the dialog, the inline field and main:

- **FR-028** `[IMPLEMENTED]` The rule is `checkDisplayName(v, MAX_FOLDER_LABEL)` (`src/shared/names.ts`): whitespace collapsed, trimmed, 1 to `MAX_FOLDER_LABEL` (40, also `MAX_LABEL` in `src/main/folders.ts`) characters, no control, C1 or hidden characters (bidi overrides, zero width, ...), nothing that looks like a secret. The page mirrors it: `SN().folderError`, `SN().MAX_FOLDER` (`sessionname.js`, compared with the shared rule by `test:sessionname`). `startFolderEdit` and the folder dialog use it (the dialog loops with the reason under its field, as the session dialog does); the literal 40 and `check:()=>''` are gone.
- **FR-029** `[IMPLEMENTED]` `folders:rename` refuses an invalid non-empty name with `{ ok: false, error }` (the rule's reason) instead of clearing the label and answering `ok:true`; an empty name still resets. `parseLabel` (also used when the file is read back) is the same rule and stays tolerant (an invalid saved label is ignored, the folder kept). The page shows the reason under the field (Enter) or as "Not renamed: ..." (blur, Tab), and under the dialog's input.
- Evidence: `test:` `scripts/test-folders.ts` (`'Proj\x07x'`, `'Proj\u202eexe'`, `'zero\u200bwidth'`, C1, 41 characters, a token, empty, a static check that the IPC handler refuses), `scripts/test-sessionname.ts` (page mirror); `sim:` `check:rename-inline` (the field and the dialog refuse the three strings and send nothing; the fake `renameFolder` applies main's rule).
- `[KNOWN GAP]` Not run against real main (the IPC handler is covered by the static check and the store tests, not by an Electron main process).

### 2026-10-25: the focused-pencil driver step is deterministic on Windows CI (issue #715)

Decided by the coordinator under Ruben's delegation. Product behaviour is unchanged: a keyboard-focused pencil is shown (`.unit:focus-within>.ren`,
`.ren:focus`, opacity 1). `check-rename-inline` failed on Windows CI at "a focused pencil is shown" (the window did report OS focus), so the
cause is the 0.12 s opacity transition not advancing in a CI window, not the rule. The driver now gives the window real focus for that step
(`show`, `focus`, `webContents.focus`, wait for `document.hasFocus()`) and reads the rule's target opacity with the transition switched off for the
read; the message says whether the OS gave focus. Task T079. `[KNOWN GAP]` Not re-run on Windows before the merge; Windows CI on the PR is the check.

### 2026-10-26: the pencil of a wide card follows the name, not a wrapped mode icon (issue #781)

On a wide desk card the line of name, mode icon and role wraps: the name fills line 1 and the mode icon (`.modeic`/`.modebadge`) wraps to line 2 beside
the role. `placeRen` took the mode icon as the end of the name and used its x with the name's y, so the pencil sat about 30px in, over the name
("Co✎rol Panel"). The pencil is now anchored on the mode icon only when the icon is on the name's line (its box overlaps the name's box vertically);
otherwise it is anchored on the name itself. The fallback (over the end of the name, never more than its right half) and the protected-element
checks are unchanged. `check-office-overlap` now also fails a desk pencil that covers the first half of its name. Task T080 [FR-020, FR-025].
`[IMPLEMENTED]` `sim:` on Linux (xvfb, DejaVu), 1440x900 and 1280x800: the simulator's own cards already wrap the mode icon (19 and 13 pencils in sim 15 failed the new check with the old `placeRen`, 61 failures in all); with the fix `check:office` passes 460/460, `check:rename-inline` and `check:geometry` pass. Not run on macOS, where the bug was first seen (system fonts are narrower, so the wrap point differs; the check measures the real boxes, so it applies there too).

### 2026-10-26: the folder pencil is never over the folder name (FR-169, issue #788, owner decision)

*Problem*: `placeRen` protected every room-header part except the door, the name and the path, so with the floor tag right after the name the pencil fell back to "over the end of the name" (about 20px over the name in every room, at both sizes, with floors on). Hovering showed "Rename folder ..." instead of the name.

- **FR-169** `[IMPLEMENTED]` `sim:` `check:office` ("the folder pencil is over the name", both sizes, floors cases) A room header's pencil is in the header's flow, right after the name (`ren-in`, as in the Folders panel), not positioned over it, and `placeRen` no longer places folder pencils (the fallback over the end of the name stays for desk cards and rows, FR-025). When the name would be squeezed, the pencil is the first thing to go (`no-ren`, spec 001 FR-179); **Rename…** in the folder's ⋯ menu always remains.

Numbers taken: FR-169 and T081 (checked against `main` and the open PRs on 2026-10-26).


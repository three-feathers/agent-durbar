# Feature Specification: Search every session's conversation from the top bar

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Search conversations (issue #877): a search box in the top bar finds the text of open and previous sessions (title, your messages, the agent's replies; no tool output); results are List rows with the matching line highlighted; opening one jumps to that message; local only, masked, streamed with cancel
status: draft
note: spec, plan and tasks drafted; owner answered Q1-Q9 (2026-10-30); nothing built
-->

**Feature Branch**: `095-search-conversations` (spec); code branches `095-pN-slug`, one per phase

**Created**: 2026-10-29

**Status**: Draft (2026-10-29). Owner decisions D1-D3 are recorded, and the owner answered Q1-Q9 on 2026-10-30 (*Clarifications*). Nothing is built.

**Input**: Issue #877 (Paco, 2026-10-29): "I often cannot find in which session I talked about something. Today only titles can be searched, and only in Previous sessions. A search box in the top bar: typing switches to the List view and shows the sessions whose conversation contains the word or text."

## Why a new spec and not a delta

The title search belongs to spec 006 (FR-023, `src/renderer/sessionsearch.js`) and the List view to spec 052 (FR-100..FR-104, J/K rows). This feature adds things neither owns: **reading the content of every session on disk** (a new privacy surface), a **new main-side scan with its own IPC channels, cancel and progress**, a new top-bar control and shortcut, and a jump to a message. A delta would bury that in 006's 170+ requirements. So it is a new spec, number **095**, as the issue says. Checked 2026-10-29: `specs/` on `origin/main` ends at 094; no remote branch `095-*` (`git ls-remote --heads origin`); no open PR uses 095; 095 is not in `RETIRED` (`scripts/specs-index.js:48`: 023, 026, 031, 042, 046, 047, 053, 055, 067, 071, 078, 079, 082, 086, 088..091). Specs 006 (FR-023) and 052 get a short cross-reference under their `## Changes` when built (T003).

## Context: what exists today

- **Title search**: `src/renderer/sessionsearch.js` (`DurbarSessionSearch`: `fold` = NFD, accents removed, lower case, `terms`, `filterSessions` = every word in the title, any order, `arrangeSessions` with pin/hide, `applyMark`, dialog texts). Pure, no DOM; used by the Previous sessions panel (`app.js:7227`, `7302`). Test `scripts/test-sessionsearch.ts` (`test:sessionsearch`). Spec 006 FR-023 says "Only titles are searched, not conversation content (that would read more data; out of scope)": this spec lifts that for the new box. The Previous sessions box stays titles-only.
- **List view**: `renderList()` (`app.js:1826`), `setView('list'|'office')` (`app.js:3827`, `#vOffice`, `#vList` in `index.html`), rows `.lrow` (a `<button>` with `data-id`, `aria-pressed`), sort headers, J/K/arrow keys (spec 052 FR-100..FR-104). It lists **open** agents only (`roomShown`, floors that are off are left out, spec 033 FR-008).
- **Previous sessions**: `sessions:listPrevious` (`src/main/ipc/previous.ts:59`, `listPreviousOp` in `src/main/prevsessions.ts:64`): per open agent, `previousSessionsOf(adapter, a.cwd, openIdsOf(d))` (`src/adapters/router.ts:108`), with the user's names, pins and hides (`marksFor`). `sessions:resume` (`previous.ts:65`) resumes one and returns its masked history (`maskHistory`). VS Code chats: `vschat:list` / `vschat:read` (`previous.ts:109-125`, `listChats`, `readChat` in `src/adapters/vscodeChat.ts:489,538`), read-only (View, not Resume).
- **History readers** (each returns `HistoryResult { items: HistoryItem[]; total; truncated }`, `src/adapters/history.ts:111-129`, `HistoryItem` = `user` | `output` | `tool`; default cap `maxItems: 300`, `maxTextChars: 20_000`):
  - Claude Code: `readClaudeHistory(sessionId, cwd, configDir)` / `claudeHistoryFromText` (`src/adapters/claudeHistory.ts:86,187`); reads a whole file, refuses > `MAX_FILE_BYTES` (50 MB, line 15); lists at most `MAX_FILES` = 200 per folder; works for a session that is **not** open.
  - Codex: `codexHistory(thread)` (`src/adapters/codexHistory.ts:55`) over `thread/read {includeTurns:true}`; `CodexAdapter.history` (`codex.ts:446`) starts a short-lived app-server through `this.probe` for a session that is not open.
  - Copilot CLI/SDK: `eventsToHistory(await session.getEvents())` (`copilot.ts:708`), but `mustGet(sessionId)` needs a **live** session. **There is no reader today for the content of a Copilot session that is not open.** `[KNOWN GAP]` (Q4).
  - VS Code chat: `readChat(ref)` gives a `VsChatTranscript` of blocks (`vscodeChat.ts:267-294`).
- **Masking**: `redact`, `redactMarkdown`, `maskHomePaths`, `maskSecretUrl` (`src/shared/redact.ts:150,172,1210,1230`; `REDACT_MAX_CHARS` 1 000 000, `MASK_INPUT_MAX` 12 288). In the window `DurbarSafeText` (`src/renderer/safetext.js`: `excerpt` masks **before** it cuts, spec 041 FR-065, the "late split" lesson of PR #614). Spec 058 FR-067: `maskHistory` for replayed history.
- **Palette / navigator**: Ctrl+K palette (spec 052 FR-042) and Go-to mode on **Ctrl+F** by default, configurable (spec 074 FR-002, `app.js:3128-3135`). Both are taken, so the new shortcut cannot be either of them (Q2).
- **IPC guard**: `ipcHandle` (`src/main/ipcguard.ts`: only the app's own page; under `DURBAR_SIM` every channel not on `SIM_OPEN_CHANNELS`, `src/main/simguard.ts:28`, is refused); the simulator fakes the bridge in `src/renderer/sim.ts`.
- **Missing**: any search over message text; any content reader for a not-open Copilot session; a top-bar search control; a way to name a message so the chat can scroll to it; a main-side use of `fold` (it lives in a renderer script).

## Clarifications

### Owner decisions, issue #877 (Paco, 2026-10-29)

- **D1 Scope**: open sessions (the office) **and** previous sessions of Copilot CLI, Claude Code, Codex and VS Code, through the existing history readers. A previous session in the results opens with the existing Resume (VS Code chats: View).
- **D2 Content**: the title, the user's messages and the agent's replies. **Tool output (commands, files read) is not searched.**
- **D3 Results**: each result is the session's List row plus a short excerpt around the match, highlighted. Opening it jumps to that message.

### Owner answers to the open questions (Paco, 2026-10-30, in the coordinator's terminal)

Each picked the recommended option except Q3:
- **Q1** (a): a compact field after the view toggle, collapsing to a magnifier button on narrow widths.
- **Q2** (a): Ctrl+Shift+F (⌘⇧F on a Mac), configurable.
- **Q3** (b): **3 characters** minimum, not the recommended 2.
- **Q4** (a): earlier Copilot sessions are searched by title only, and the end state says so.
- **Q5** (a): hidden sessions are searched only when that folder's Show hidden is on.
- **Q6** (a): a streamed scan only, with no index.
- **Q7** (a): up to 3 excerpts, then "+N more".
- **Q8** (a): pinned sessions are ranked by recency.
- **Q9** (a): sessions on floors that are off are skipped.

### Owner requirements from the issue (binding)

Reuse `DurbarSessionSearch`, the List view, the readers and Resume, and the palette where it fits; **no parallel path**. Local only: nothing is sent anywhere. Nothing new stored, or the spec says where an index lives, what it holds and how to clear it. Excerpts go through the existing masking (spec 041). Streamed search with cancel or a local index (decide here), UI responsive, results progressive, a clear "Searching... N of M" state. A shortcut to focus the box, Escape clears it and returns to the previous view, results announced, minimum text 10.5px, fits 1440x900 and 1280x800. Windows, macOS and Linux paths for every reader.

### Decisions taken by this spec (change them under *Open questions*)

- **A1 No stored index in v1.** A streamed scan with cancel. Nothing new is written to disk (the Constitution III default); an index would hold conversation text on disk, which is a bigger privacy decision. The scan is incremental and capped (FR-020..FR-024). An index is a later spec if the scan is too slow (Q6).
- **A2 The text that is searched is the text that is shown.** Matching runs on the **masked** text (FR-030), so a secret cannot be found by its value and the highlighted line is always the matched line. A hit whose only match disappears under the mask is dropped.

## User Scenarios & Testing

### User Story 1 - Find the session where I talked about something (Priority: P1)

I type "invoice export" in the top-bar box. The window switches to the List view and, a moment later, shows the sessions (open or earlier, any folder) whose title or messages contain both words, newest first, each with a line such as "...fix the **invoice** **export** to CSV when the..." and the match marked.

**Why this priority**: it is the whole point of the issue.

**Independent Test**: on the simulator with a fixed corpus of 3 open sessions and 5 previous ones (fake readers), typing a two-word query lists exactly the expected sessions, each with an excerpt containing the words, in newest-first order.

**Acceptance Scenarios**:

1. **Given** the office has sessions A and B and Previous sessions of folder F has C, **When** I type a word that occurs in A's reply, in C's first prompt and in B's tool output only, **Then** A and C are listed, B is not (D2).
2. **Given** a query of two words, **When** one word is in a user message and the other in a reply of the same session, **Then** the session matches (every word, any order, like `filterSessions`); the excerpt is the line with the first word found, and a second excerpt, if the other word is in another message.
3. **Given** "explicacion", **Then** "Explicación" matches (case and accents folded).
4. **Given** a session whose title matches but no message does, **Then** it is listed with the title match marked and no excerpt line (the row itself is the result).
5. **Given** no session matches, **Then** the area says "No conversation matches" with the query, and the box keeps focus.

### User Story 2 - Open a result and land on the message (Priority: P1)

**Independent Test**: simulator, each of the four kinds: click (or Enter on) a result; the right chat opens and the matching message is in view, marked for a moment.

**Acceptance Scenarios**:

1. **Given** a result in an open session, **When** I press Enter on it, **Then** that chat opens (as a click on its List row does) and the matching message is scrolled into view and marked (focus ring plus a short background, not animation-only: reduced motion is respected).
2. **Given** a result in a previous session of Claude Code, Codex or Copilot, **When** I press Enter, **Then** it is resumed with the existing Resume (`sessions:resume`, its mode rule, the "already open" refusal, the in-flight guard), and when its history is shown the matching message is scrolled into view.
3. **Given** a VS Code chat result, **Then** it opens in the read-only viewer (View), at the matching block.
4. **Given** the message is older than what the chat shows (the replay cap), **Then** the chat opens at the end and a note says "That message is older than the chat shows" (never a silent miss).
5. **Given** the session is already open or being opened, **Then** the existing refusal text is shown; nothing is resumed twice.

### User Story 3 - Keyboard and screen reader (Priority: P1)

**Acceptance Scenarios**:

1. **Given** any view, **When** I press the shortcut (Q2), **Then** the box is focused and its text selected; it works from text fields except an open dialog.
2. **Given** the box has a query, **When** I press Escape, **Then** the box is cleared, a running scan is cancelled, and the view I came from (Office or List) comes back; a second Escape does nothing special. Focus returns to where it was before the search.
3. **Given** results, **When** I press Down or Tab from the box, **Then** focus goes to the first result; J/K and arrows move between results like the List view; Enter opens; Shift+F10 or the menu key opens the row's menu where the List view has one.
4. **Given** a screen reader, **Then** a polite live region says "Searching, 3 of 12 folders" (at most every 2 s), then "5 results in 4 sessions" or "No conversation matches", and each result's accessible name is "title, app, folder, open or previous, match: excerpt" with the highlight announced as plain text (a `<mark>` carries no extra speech).

### User Story 4 - Large histories stay calm (Priority: P2)

**Independent Test**: node test with a generated 40 MB corpus of fake sessions: the scan yields to the event loop (longest slice under the budget of FR-022), can be cancelled within one slice, and never holds more than the cap in memory.

**Acceptance Scenarios**:

1. **Given** hundreds of sessions, **When** I type, **Then** the first results show within 1 s on the simulator corpus, the rest arrive progressively, and the state "Searching... N of M sessions" stays visible until done; typing again cancels the old scan.
2. **Given** a session file over the reader's cap, **Then** it is skipped with a count ("2 sessions too large to search"), not read.
3. **Given** the window is in the background, **Then** the scan keeps its pace limits (no busy loop).

### User Story 5 - Sessions I cannot read (Priority: P3)

**Acceptance Scenarios**:

1. **Given** an agent app that is not installed or signed out (its previous sessions cannot be listed), **Then** the scan skips it and the end state says "Not searched: Codex (not installed)" once, with no error dialog.
2. **Given** a Copilot previous session (Q4), **Then** per the owner's answer it is searched by title only, with that said in the end state, or by its content.
3. **Given** a hidden previous session, **Then** it is left out unless Show hidden is on in that folder's panel (Q5).

## Edge Cases

- **Query**: trimmed; fewer than 3 characters (Q3) searches nothing and says "Type at least 3 letters"; at most 200 characters and 8 words (the rest is cut and said); control characters removed; the query is data (never a regex: plain substring of folded words). A query of only spaces clears the results.
- **Huge or hostile text**: a single message is searched up to 20 000 characters (the reader's `maxTextChars`); an item over that is cut by the reader and a note says so only if the match could lie beyond (not claimed otherwise). The masking step is bounded (FR-031).
- **Masked matches**: a query that matches only inside a masked span (a token, a URL password, a home path user name) finds nothing (A2). The query `~` or `[redacted]` is just text.
- **Same text in many messages**: at most 3 excerpts per session in the row and "+N more" with the count; at most 200 sessions in the result list ("200 shown; narrow your search").
- **Duplicate**: a session open in the office is never also listed as previous (`openIdsOf` already removes it by Durbar id and resume id).
- **Floors off, hidden folders**: sessions of a floor that is off are not searched (spec 033 FR-008). Folders hidden in the office (a door) are searched.
- **A session ends or is deleted during the scan**: its reader returns empty; skipped.
- **Search while an agent writes**: the open session's history is read once per scan; a message that arrives later is found by the next query.
- **Paths**: the window never sends or receives a path; excerpts have home folders masked (`maskHomePaths`, `/home/<user>`, `/Users/<user>`, `C:\Users\<user>`, also `\\`-doubled JSON); readers resolve their stores with `path` and the existing per-OS roots (`claudeConfigDir`, `vscodeUserDirs`, the Copilot/Codex runtimes), no new path code.
- **Layout**: a long title or excerpt ellipsizes in the row (never wraps the row taller than 2 lines), the result list scrolls inside the List area only; the office with 15 agents at 1440x900 and 1280x800 is unchanged when the box is empty (geometry and office checks stay green).
- **Theme**: all themes use the same sizes; no text below 10.5px.
- **Simulator**: `DURBAR_SIM` serves a canned corpus through the faked bridge; no real store is read and no channel is added to `SIM_OPEN_CHANNELS` (T033).

## Requirements

### Functional Requirements

**Box, view and keyboard**

- **FR-001** A search field in the top bar (`#convSearch`, `type="search"`, visible label "Search conversations" via `aria-label`, placeholder "Search conversations", `title` with the shortcut). It lives with the view controls; at the width where the top bar would wrap or overlap (1280x800 with the longest labels), it collapses to a magnifier button that opens the field (Q1). The box is available in Simple and Expert and when no session is open (it then searches previous sessions of saved folders).
- **FR-002** Typing (after a 250 ms pause) switches to the List view (`setView('list')`), remembering the view it came from, and starts a scan (FR-020). Clearing the box, or Escape (FR-003), cancels the scan, restores the remembered view and the normal List.
- **FR-003** Escape in the box (or in the result list) clears the query, cancels any scan and goes back to the previous view and focus. With a query empty already, Escape behaves as before (blur). The shortcut that focuses the box is Q2's answer; it is added to the keyboard sheet (`?`), Settings > Keyboard and the palette's actions as "Search conversations". The palette entry only focuses the box (the palette is not a second search UI).
- **FR-004** While a query is active, the List area shows the **results view** in place of the agent rows: the same container (`#list`), list header and styling; the agent rows come back when the query is cleared. Sort headers sort the results by their own columns (name, app, folder, when).

**Results**

- **FR-010** Two groups, in this order: **In the office** (open sessions, each a List row built by the same cell helpers as `renderList()` so the status dot, mode icon and name look identical) and **Earlier sessions** (previous sessions: name or title, app, folder, "last active", and a **Resume** or **View** button as in the Previous sessions panel). Each group header says "N sessions". Within a group, newest first; pinned previous sessions are not moved to the top (a search ranks by recency).
- **FR-011** Under each row, one to three **excerpt** lines (D3): about 140 characters, the match centred, cut at word boundaries with "…", every query word found in the line marked with `<mark>` (built from offsets returned by main, text set with `esc()`, never from raw HTML). A marked word has a non-colour cue too (bold plus the background), so it holds in high contrast. Whether it was said by "You", the agent or the title is shown as a short prefix (`You:`, `Agent:`, `Title:`), text 10.5px or more.
- **FR-012** Opening a result: Enter or click on the row. Open sessions: select the agent and open its chat, as a List row click does (`app.js` List click handler). Previous sessions: `sessions:resume(agentId, sessionId, false)` and then show the history, as the Previous sessions Resume button does; VS Code chats: the read-only transcript viewer. No new resume path (Constitution, "look for an existing capability first").
- **FR-013** **Jump to the message** (D3). Every excerpt carries an **anchor**: `{ n }`, the 0-based ordinal among the text messages (user and agent items, tool items not counted) in the order the reader returns them, plus the first 60 folded characters of that message. After the chat is built, the window scrolls to the nth message element if its text begins with those characters (so a different replay cap or a changed history is detected), marks it for about 2 s (respecting reduced motion) and sets focus to it (innerscroll.js rules, spec 052 FR-176: no bare `scrollIntoView`). If it is not found, the note of US2 scenario 4 is shown. `[KNOWN GAP]` until T040 finds out how the chat marks its messages (unverified: the chat panel renders from live events and from replay; whether both give every message a stable element is not read yet).
- **FR-014** The end state is one line under the group headers: "Searched N sessions in M folders. Not searched: ..." listing only what applies: apps not installed or signed out, sessions too large (count), unreadable (count), Copilot previous sessions (Q4), floors that are off (count of sessions skipped), results capped.
- **FR-015** While scanning, the state line says "Searching... N of M sessions" (`role="status"`, `aria-live="polite"`, updated at most every 250 ms visually, announced at most every 2 s) with a **Stop** button (also Escape). Results already found stay while it scans; a result never moves under the pointer while it is being clicked (new rows are appended in newest-first order within a group; the list does not re-sort the rows already shown, only "load more" ordering at the end).

**Scan**

- **FR-020** One scan per window at a time. `search:start` cancels the previous scan. The scan is **streamed**: open sessions first (cheap, in memory), then, folder by folder in the office's order, the previous sessions newest first; each session's text is read, matched and released before the next. No transcript is kept after its session is done (A1).
- **FR-021** Titles first: a session whose title matches is a hit at once, before its messages are read. The title match uses the user's name for the session (spec 059) when there is one, else the title.
- **FR-022** **Budgets** (constants in one file, tested): the scan yields to the event loop at least every 15 ms of work; reads are one at a time per source (Codex `thread/read` starts an app-server: one at a time, at most 100 threads per scan, skipped past that with the FR-014 note); at most 200 listed sessions per folder (the readers' `MAX_FILES` / `MAX_LISTED`); at most 400 sessions per scan; a reader's size cap (Claude 50 MB) applies; at most 20 000 characters per message; a scan stops after 60 s with "Stopped after 60 s; narrow your search". Results are sent in batches of at most 20 hits, at most one batch per 250 ms.
- **FR-023** **Cancel**: `search:cancel(searchId)`, a new `search:start`, Escape, leaving the List view and closing the window all stop the scan before the next session; a session being read finishes its slice (no process is killed; the Codex probe is the existing short-lived app-server, left to end by itself).
- **FR-024** Content is read **only through the existing readers** (`history`, `readClaudeHistory`, `codexHistory`, `readChat`). A search-only option on them, `{ textOnly: true, maxItems: Infinity within the byte caps }`, drops tool items before they are stored and lifts the 300-item cap, because the default cap would hide old messages (what is searched must be what exists, not the replay's last 300). The replay for the chat itself is unchanged.
- **FR-025** No network: nothing in the scan or the IPC calls a URL; the module imports no network API (a source test lists the imports, like `test:gitstatus`' no-other-git check). No process other than what the readers already start (the Codex probe); no shell.

**Masking and privacy**

- **FR-030** Every candidate text is masked in main **before** it is matched or cut (spec 041 FR-065 order): for a message, `redactMarkdown` then `maskHomePaths` on a window around each raw hit (±600 characters, widened to the nearest whitespace, never cut inside a token), then the query is looked for again in the masked window (A2), then the excerpt is cut from the masked window. Per-message work is bounded by `MASK_INPUT_MAX` and `REDACT_MAX_CHARS`; if masking throws or returns a non-string, the hit is dropped (fail closed, as `DurbarSafeText` does).
- **FR-031** The result sent to the window holds only: agent id (open) or agent id plus session id / chat key (previous), the title as the Previous list shows it, app, folder display name, times, group, and per hit the **masked** excerpt (≤ 180 characters), the mark offsets in it, the speaker, and the anchor. No full transcript, no file path, no raw text. The window masks nothing more but renders with `esc()`.
- **FR-032** Nothing new is stored: no index, no cache file, no setting that holds a query. The query and the results live in the window's memory and in the scan in main, and are dropped on clear, on Escape and on quit. The query is never logged and never written to the activity log or to `DURBAR_LOG` (the debug sink gets no `search:*` payloads; a test checks). The spec 041 MCP tools and remote control have **no** access to this search (not registered; test).
- **FR-033** IPC (all `ipcHandle`, only the app's own page): `search:start(query)` returns `{ ok, searchId }`; main sends `search:batch` `{ searchId, hits[], progress: { done, total }, groups }` and `search:done` `{ searchId, notes }`; `search:cancel(searchId)`. The only value the window sends is the query (string, ≤ 200 characters, control characters removed, ≤ 8 words) and a `searchId` that main issued (a random 128-bit token, one live at a time; a stale or unknown one is ignored). Scope is decided in main from its own agents and folder store: the window cannot name a folder, a path or a session to read. Opening a result uses the existing `sessions:resume`, `vschat:read` and the agent-select calls with ids main already knows.

**Matching**

- **FR-040** Same rule as `DurbarSessionSearch.filterSessions`: fold = NFD with accents removed and lower case; every word of the query must occur in the session's searchable text (title plus all its user and agent messages, as one set), any order; each excerpt line contains at least one word and the lines together show every word where possible. Main uses the same `fold` and `terms` (one source of truth, tested for parity, see the plan); offsets are mapped back to the unfolded text with an index map (folding can change lengths).
- **FR-041** The Previous sessions panel's title box keeps working exactly as today (titles only, per panel, spec 006 FR-023).

**Layout and accessibility**

- **FR-050** Minimum text 10.5px, WCAG AA contrast for the mark in every theme, focus rings as elsewhere, tab order: top bar, then the box in its place (after the view toggle), then the results. The collapsed magnifier has `aria-expanded`. `prefers-reduced-motion`: no scroll animation, no flash.
- **FR-051** With the box empty and no scan, nothing about the office, the geometry or the List view changes at 1440x900 and 1280x800 with 15 agents (the existing `check:office` and geometry checks stay green; a new case covers the box at both sizes).
- **FR-052** The results view fits at both sizes: rows never overlap, the excerpt wraps to at most two lines and ellipsizes; the list scrolls inside its area, not the page.

## Success Criteria

- **SC-001** A two-word query over the simulator corpus returns exactly the sessions whose title or messages contain both words and none whose tool output only does (node test over all four readers' fakes).
- **SC-002** No excerpt, anchor, id or note in a `search:batch` contains a planted secret (every redact fixture class), a home path, or a full path (node test with a corpus of secrets in messages).
- **SC-003** The scan over a 40 MB generated corpus never blocks the loop for more than 50 ms in one slice, is cancelled within one slice, and holds less than 64 MB above its start (node test with injected clock).
- **SC-004** Driver on the simulator at 1440x900 and 1280x800: type, results appear, Enter opens the right chat at the right message, Escape returns to the previous view, the live region text is as specified; screenshots of the box, results and the end state.
- **SC-005** No network or credit use: the module's imports contain no network API; every test runs on the fake adapter and fake backends (0 credits).

## Assumptions and honest limits

- `[KNOWN GAP]` Copilot previous sessions have no content reader (Q4). `[KNOWN GAP]` Codex previous content costs one app-server start per thread (FR-022 cap).
- `[KNOWN GAP]` Jumping to a message depends on T040 (unverified: how the chat and the replay mark messages).
- `[KNOWN GAP]` The formats of the real stores (Claude JSONL, Codex threads, VS Code chat files) are tested on fixtures only; no real session is run (Constitution IV). Windows and macOS paths are not checked by hand; PR CI runs Linux and Windows, macOS on `main`.
- Tool output, attachments, images and thinking text are not searched (D2). Sessions of an agent app that is not installed cannot be searched.
- The mask can hide text that you typed: you cannot search for a secret by its value (A2).
- Not verified: the cost of a scan over a real store with thousands of sessions; the constants of FR-022 are starting values to be checked on real data by the owner (`real:` entry later).

## Open questions (answered 2026-10-30, see *Clarifications*; kept for the options)

1. **Q1 Where does the box sit at 1280x800?** (a) A compact field after the view toggle, collapsing to a magnifier button on narrow widths **(recommended)**; (b) only a magnifier button everywhere; (c) only the palette (Ctrl+K) with a "Search conversations" mode and no new top-bar control.
2. **Q2 Shortcut.** Ctrl+K (palette) and Ctrl+F (navigator, configurable) are taken. (a) **Ctrl+Shift+F** (⌘⇧F on a Mac), configurable like the navigator's **(recommended)**; (b) "/" when no field has focus; (c) none, only the box and the palette entry.
3. **Q3 Minimum query length.** (a) 2 characters (recommended); (b) **3, chosen by the owner**; (c) 1.
4. **Q4 Copilot previous sessions have no content reader without starting them.** (a) Title only for Copilot earlier sessions in v1, said in the end state, until a read-only reader is verified **(recommended)**; (b) read the SDK's session store files directly, read-only (spec 006 FR-028 says deletes go "through the runtime only"; reading is a different risk but the store layout is unverified); (c) resume each one in the background (starts processes, may cost; not recommended).
5. **Q5 Hidden previous sessions.** (a) Not searched unless that folder's "Show hidden" is on **(recommended)**; (b) always searched and tagged "Hidden"; (c) never.
6. **Q6 Index later?** (a) Streamed scan only now; revisit with real timings **(recommended)**; (b) build a local index now (stores conversation text on disk: needs its own privacy decision, location and Clear).
7. **Q7 Several excerpts per session.** (a) Up to 3 lines, "+N more" **(recommended)**; (b) only the best line.
8. **Q8 Pinned earlier sessions in results.** (a) Ranked by recency like the rest **(recommended)**; (b) pinned first.
9. **Q9 Searching sessions of floors that are off.** (a) Skipped (spec 033 FR-008) **(recommended)**; (b) searched and tagged with the floor.

## Constitution check

- **I**: spec, plan and tasks are committed before any `src/`; each code PR changes `specs/095-search-conversations/`. **II**: only adapter readers (`history`, the history modules) are used; no agent type in the renderer or `src/shared`; the `textOnly` option is on the shared `HistoryLimits`. **III**: local only, masked before matching and cutting, nothing stored, window sends only the query, IPC validated, no shell. **IV**: fakes only. **V**: List view reuse, 10.5px, reduced motion, live region. **VI**: readers' own per-OS roots; no new path code. **VII**: pure matcher, bounded scan and masking tested with planted mutations. **VIII**: gaps above.

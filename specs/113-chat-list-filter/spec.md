# Feature Specification: Filter the chat list, and Search conversations, with a chat open

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Chat list filter (issue #1870, owner 2026-11-18): with a chat open, a field in the agent rail narrows the list as you type (session name, folder, agent app, chat number) and reaches Search conversations (spec 095) without the office top bar
status: draft
note: spec, plan, tasks; Q1..Q8 decided by the owner (Paco, 2026-11-19, every recommended option); nothing built
-->

**Feature Branch**: `113-chat-list-filter` (spec, plan and tasks; the analyst's worktree branch is `1870-chat-filter`, renamed before push); code branches `113-pN-slug`, one per phase

**Created**: 2026-11-18

**Status**: Draft. Nothing built. Q1..Q8 (*Clarifications*) are decided by the owner (Paco, terminal, 2026-11-19): every recommended option was accepted.

**Issue**: #1870 (fjcabello, owner request, 2026-11-18). Refs, not Closes, until the last phase.

**Input**: "With a chat open, the window shows the session list on the left (grouped by folder, with an *Office* back button) and the chat on the right. In that layout: (1) Search conversations is not there: the box (`#convSearch`, spec 095) lives in the office top bar, which this layout replaces; (2) there is no way to filter the chat list: with 20+ sessions, type a few letters and narrow the list to the matching chats (title, and probably folder name), like a sidebar filter."

## Why a new spec and not a delta

The chat-open list is the agent rail of spec 005 (FR-190, FR-194, FR-216; delta 2026-11-03), and the conversation search is spec 095. This feature adds behaviour neither owns: a new control in the rail with its own matcher, states (count, no match), keys, lifetime and driver, plus a new entry point into spec 095 from a layout where its results cannot show today (`csPaint` refuses to paint while `body.panel-open`, `app.js:2355`). A delta would split one feature over two specs' `## Changes`. So, as for spec 112 (the sibling Settings search), it is a new spec, **113**. Checked 2026-11-18: `specs/` on `origin/main` (`e35ebf76a`) ends at 112; no remote branch `113-*` (`git ls-remote --heads origin`); no open PR adds a `specs/113-*` file (the ten open PRs' file lists); 113 is not in `RETIRED` (`scripts/specs-index.js:48`). The build PRs add **pointer deltas**: spec 005 (FR-190's rows, FR-195's scroll limit, Q3) and spec 095 (FR-002/FR-003: the shortcut and the way back with a chat open, Q2, Q5). Spec 074 is not changed (Q5 a: ⌘F stays the navigator's).

## Context: what exists today (spec 021 FR-031, reuse first)

All references are `origin/main` at `e35ebf76a` (2026-11-18), `read:` unless tagged otherwise.

- **The rail.** `openPanel(id)` (`src/renderer/app.js:3077`) rebuilds the whole `#panel` with `innerHTML` on **every** chat switch (`:3090`), the rail included (`railHTML()`, `:8084-8089`): a top row with **Office** (`#backBtn`), a row with **Your door N** (`#railDoor`, 052 FR-216), the list `#stripList`, and the width grip `#railGrip`. Only the list's `scrollTop` is carried over (`stripScroll`, `:3087`, `:3123`). `renderStrip()` (`:8112`) paints the list from `railGroups()` (`:8078`: main agents on shown floors, `roomShown`, `:234`) through the pure `DurbarRail.group` (`src/renderer/railorder.js`), keyed rows via `morphHTML` (`data-sw`, `data-key`, `.sel`, `aria-current`), folder headings `button.rg-h[data-rgfold]` in an `h3` with `aria-expanded` and a count, collapsed folders in `RAIL_FOLDS` (`:8065-8076`, saved only when `rememberOn()`), and keeps the focused row or heading by key across repaints. It repaints on every render. Rows show the session name (`a.name`, the renamable title, spec 059), status dot and word; tall rows (needs you) add age and request. Helpers are not rows.
- **Rail CSS**: `styles.css:855-901` (`.rail`, `.rail-top` 40 px, `.rail-door` 28 px + 4 px, `.rail-list`, `.rg-h`, `.sitem` 30/52 px). Width `--rail-w`: 220 px default, 180 px to 40 % of the window (`composersize.js:18`, `:58-60`; spec 005 FR-236). No world or theme file restyles the rail (`read:` grep of `themes.css`, `realoffice*.css`): one set of token rules for every world.
- **Fit today** (spec 005 FR-195, the 2026-11-03 delta): with 15 agents the rail list does not scroll at 1440x900 and scrolls 21 px at 1280x800 with the restore notice bar on, limit **34 px** (`check-rail.js:97`). Any new row in the rail costs that budget (Q3).
- **Not built in the rail** (spec 005 delta 2026-11-03): arrow keys between rows (FR-197, `[KNOWN GAP]`, Tab moves), the Plan view (R2), collapsing the rail (R3).
- **Search conversations (spec 095)**: the top-bar box `#convSearch` / `#convSearchBtn` (`index.html:49-52`), `.topbar` is `display:none` while a chat is open (`styles.css:410`). The shortcut ⇧⌘F / Ctrl+Shift+F (`SEARCH_KEY`, `app.js:36`; `SEARCH_COMBO`, `navigator.js:221`; in `TAKEN`, `:168`) is handled in the bubbling `document` keydown (`app.js:4586-4589`) and calls `csFocusBox()` (`:2446`), which **closes the open chat** and remembers it in `CS.panel`; Escape with nothing typed opens it again (`:2458-2466`, spec 095 delta 2026-11-13), but once a search starts the chat is dropped (`csRun`, `:2313`) and Escape returns to the Office or List view. Results show only in the List view (`renderConvResults`, FR-004). The query goes to main only through `bridge.convSearchStart` (FR-033: at least 3 characters, ≤ 200, masked hits).
- **Go-to navigator** (spec 074): ⌘F / Ctrl+F from anywhere, text fields included (`app.js:4581-4584`, `DEFAULT_COMBO` `navigator.js:130`); its Go-to mode already lists folders, agents and chats with `DurbarNav.rank` (`navigator.js:12-18`). It is the keyboard way to jump to a chat today; the new filter is the visible, mouse-friendly one. Spec 112 (draft, not built) takes the first ⌘F press inside Settings only.
- **Matching in the window**: `DurbarSessionSearch.fold`, `terms` (`sessionsearch.js:8-10`), `locate` (spec 095 FR-040, ranges in the original text), `filterSessions` (every word, any order).
- **Filter fields in the window**: Previous sessions `#prevQ` (`app.js:9998`, Escape clears first `:4642`, focus and selection kept across a repaint `:9993`, `:10004`); Notes drawer `#ntSearch` (`:3665`, Escape clears first `:4649`) and Notes screen `#nsSearch`; `.nt-find` field style (`styles.css:2189-2190`); the masked, cut no-match line `noMatch(query, mask)` (`notes.js:139-144`). Spec 112 FR-007 specifies (not built) a CSS Custom Highlight `durbar-find` over `locate` ranges.
- **List view filters** (office, not the rail): the folder filter `#wsFilter` (`ui.ws`) and the status pill (`ui.status`, `matchStatus` `app.js:988`, `filterNote` `:992`, `announceFilterNote` `:1005`); `renderList()` (`:2270`) applies them. The rail ignores both today.
- **Announcer**: `announce(text, prio)` (`app.js:4852`) into `#srAnnounce` (`index.html:117`, polite, masks what it says).
- **Leaving the chat layout**: `closePanel()` (`app.js:4287`) empties `#panel` and focuses the desk or row.
- **Missing**: any filter of the rail; any way to start or see Search conversations while a chat is open; any "back to the chat" after a search started from a chat.

## Clarifications

**Decided by the owner (Paco, terminal, 2026-11-19, relayed by the coordinator): every recommended option was accepted** (Q1 a, Q2 a, Q3 a, Q4 a, Q5 a, Q6 a, Q7 a, Q8 a). The options not taken are kept under *Open questions (answered)* only as the record of what was weighed; the FRs carry the decided behaviour.

- **Q1 One field or two.** **Decided: (a)** one field "Filter chats" in the rail: typing filters at once (local, no scan); Enter opens the first match; a last row "Search messages for "…"" runs spec 095 with the same words (FR-001, FR-010, FR-020).
- **Q2 Where 095 results show from a chat, and the way back.** **Decided: (a)** the existing List-view results (the chat closes for them), and Escape or clearing returns to the chat you came from, even after the scan started; a pointer delta to spec 095 FR-002/FR-003 (FR-021, FR-022).
- **Q3 Placement and fit.** **Decided: (a)** its own row under *Your door*, full rail width; the rail's scroll is measured first and spec 005 FR-195's limit at 1280x800 (34 px) is raised to the measured value by a pointer delta (FR-001, FR-030, T007, T015).
- **Q4 What the filter matches.** **Decided: (a)** session name, folder name, agent app and chat number (C3), matched words marked with spec 112's highlight (FR-002, FR-007). Status words and task text are not matched.
- **Q5 Keys.** **Decided: (a)** with a chat open, the Search conversations shortcut (⇧⌘F / Ctrl+Shift+F, or the recorded one) focuses the rail field and keeps the chat; elsewhere unchanged; ⌘F / Ctrl+F stays the navigator, so spec 074 is not changed (FR-011).
- **Q6 Lifetime.** **Decided: (a)** kept while you stay in the chat layout (chat switches keep it), cleared on Back to the office (FR-008).
- **Q7 Collapsed folders and the open chat's row.** **Decided: (a)** collapsed folders with a match show their matching rows during the filter, saved folds untouched; the open chat's row always stays, marked "open, does not match" when it does not (FR-004).
- **Q8 The office List view.** **Decided: (a)** not in v1: the office keeps the top-bar search, the folder filter and the status pill (FR-031).
- **Q9 What "recent" means in the Recent order.** **Decided: (a)** the last time *you* sent a message to that session; an agent finishing on its own does not move it (FR-041).
- **Q10 Sessions that need you in the Recent order.** **Decided: (a)** they stay on top, as in the folder order (spec 005 FR-194), then the rest by Q9 (FR-041).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Narrow the chat list by typing (Priority: P1)

Paco has 22 sessions in 9 folders. With a chat open he types `durb` into the rail's field and the rail shows only the sessions whose name or folder holds `durb`.

**Why this priority**: it is the issue's second point and the one with no workaround on screen.

**Independent Test**: simulator (`DURBAR_SIM=15`), a chat open, type in the field, read which rows and folder headings stay.

**Acceptance Scenarios**:

1. **Given** a chat is open, **When** Paco types a folder's name (or part of it), **Then** every session of that folder stays, the other folders are hidden, and "N chats match" is announced once the typing settles.
2. **Given** the words `fix login`, **Then** a row stays only when its searchable text (Q4) holds both words, any order, case and accents folded (`DurbarSessionSearch.fold`).
3. **Given** a match inside a folder Paco collapsed by hand, **Then** that folder shows its matching rows while the filter lasts, and is collapsed again when the filter is cleared; the saved folds (`durbar.railFolds`) never change because of the filter (Q7 a).
4. **Given** the open chat does not match, **Then** the chat stays open on the right, and its row stays in the rail marked "open, does not match" (Q7 a).
5. **Given** an agent starts waiting while a filter is on, **Then** its row appears or not by the same rule (needs-you order inside the filtered list unchanged, FR-194).

### User Story 2 - Search the conversations from a chat (Priority: P1)

**Acceptance Scenarios** (Q1 a, Q2 a, Q5 a):

1. **Given** a chat is open and the field holds `invoice export`, **When** Paco presses ArrowDown to the last row "Search messages for "invoice export"" and Enter (or clicks it), **Then** spec 095's search runs with those words, its results show in the List view (the chat closes for them, Q2 a), and Escape brings back the chat he came from.
2. **Given** fewer than 3 characters, **Then** the "Search messages" row is disabled with "Type at least 3 characters" (095 FR-033).
3. **Given** the results came from a chat, **When** he presses Escape in the results (or the box), **Then** the search ends and the chat he came from opens again, focus in it (Q2).
4. **Given** a chat is open, **When** he presses ⇧⌘F (Ctrl+Shift+F), **Then** the focus goes to the rail field and the chat stays open (Q5).

### User Story 3 - Keyboard and screen reader (Priority: P1)

1. **Given** the field has text, **When** Escape, **Then** it clears, every row is back, "All chats shown" is announced, and the chat stays open; with the field empty Escape does what it does today (closes the chat).
2. **Given** results, **When** ArrowDown in the field, **Then** the focus goes to the first visible row (or heading); Tab moves as today.
3. **Given** Enter in the field with at least one match, **Then** the first matching chat opens (Q1); with no match, Enter does nothing but announce "No chats match".
4. A screen reader hears the field's name ("Filter chats"), the count after the typing settles, and each row's accessible name unchanged.

### User Story 4 - Nothing matches (Priority: P2)

1. **Given** `zzz`, **Then** the list shows one line "No chats match "zzz"" (masked, cut to 60 characters, `noMatch` pattern) and, under it, the "Search messages" row (Q1), and "No chats match" is announced.
2. **Given** a pasted token-shaped string, **Then** the line shows it masked; a hostile string (`<img src=x onerror=…>`) is drawn as text.

### User Story 5 - Every world, both sizes (Priority: P2)

1. **Given** Flat, Retro, and Real office photo, cave and loft, 15 agents, at 1440x900 and 1280x800, **Then** the field's text is at least 10.5 px, nothing overlaps or scrolls sideways, the rail's scroll stays within the limit FR-030 sets, and the chat column is unchanged.
2. **Given** the rail at its minimum width (180 px) and a 640x480 window, **Then** the field and its placeholder fit (placeholder may ellipsize, never overflow).
3. **Given** macOS (`data-platform="darwin"`), **Then** the field is a `no-drag` control inside the rail's drag area (052 FR-215).

### Edge Cases

- **Chat switch**: `openPanel` rebuilds the rail; the field's words, caret and focus (only if it had it) survive the rebuild (FR-008, Q6).
- **Repaints**: `renderStrip` runs on every render; the filter is applied inside it, so a status change, a new session or a removed one is filtered at once; the focused row keeps its focus by key as today.
- **Folder off a floor or hidden**: already not in the rail (`roomShown`); not searched.
- **Helpers**: not rows today; not searched.
- **Very long input**: the field keeps at most 200 characters (095's limit, so the handoff never cuts).
- **Session or folder names holding secrets**: the rail already shows names; matching runs on the same text; only the no-match line echoes the query, masked (FR-006).
- **Simple and Expert**: the same rail; no difference.
- **Reduced motion**: nothing animates (rows appear and go, no transition).
- **Demo mode / no bridge**: the filter works; the "Search messages" row is absent when `csAvailable()` is false (`app.js:2300`).

## Requirements *(mandatory)*

### Functional Requirements

**Field and filter**

- **FR-001** **A filter field in the rail.** An `<input type="search">` with accessible name and placeholder "Filter chats", `autocomplete="off"`, `spellcheck="false"`, `maxlength="200"`, styled with the `.nt-find` rules (`styles.css:2189`; tokens only, `test:theme-tokens` ratchet), in its own row under *Your door*, full rail width (Q3 a), shown whenever the rail is, in every world. *Acceptance:* `check-rail-filter`: the field exists, has its name, lies inside `.rail` at both sizes, every world, rail at 180 px and 640x480.
- **FR-002** **What is matched** (Q4 a). Per row, one folded string: the session name (`a.name`), the folder name (`roomOf(a).name`), the agent app word (`appOf`, `app.js:2256`) and the chat number (`C<n>`, `chatNoOf`, `:53`), joined with a space so two fields never form a word in neither. The folder heading matches through its rows only. The text comes from the same agents `railGroups()` lists, never from a second list. *Acceptance:* `test:railfilter` over a fixture of agents.
- **FR-003** **Matching.** `DurbarSessionSearch.fold` and `terms`; a row matches when every word is contained in its string, any order. Blank matches everything (the rail as today). No minimum length. *Acceptance:* `test:railfilter`: case, accents, two words over two fields (`durbar claude`), a word in the folder only, blank, linear time on 500 rows x 200-character query (CPU time, two sizes 8x apart, `docs/agent-notes.md`).
- **FR-004** **Filtering the rail.** While the field holds words, `renderStrip` paints only matching rows; a folder with no matching row is not painted; a folder with matches shows its count as "k of n" (accessible: "k of n sessions match"); a folder the person collapsed shows its matching rows while the filter lasts (Q7 a) without touching `RAIL_FOLDS` or `durbar.railFolds`; order is `DurbarRail.group`'s, unchanged (in the Folders order; Recent: FR-044). The open chat's row is always shown, marked "open, does not match" (visible text and accessible name) when it does not match (Q7 a). Clearing paints the rail as before, folds as they were. *Acceptance:* driver counts painted rows and folders for three queries, compares with the expected set from the simulator's seed, reads `localStorage['durbar.railFolds']` unchanged (with `railstore=1`).
- **FR-005** **Count.** 150 ms after the last key the count is announced through `announce()`: "1 chat matches", "N chats match", "No chats match"; clearing announces "All chats shown" once. Only when the count changed or the words changed; a status repaint never re-announces. *Acceptance:* driver reads `#srAnnounce` (one announcement per settle, the `until` on a `MutationObserver` list, agent-notes).
- **FR-006** **No match.** One line "No chats match "<words>"", the words masked with the window's one mask (`safeMask`, DurbarSafeText, `app.js:447`) and cut to 60 characters (the `notes.js:139-144` rule; the rail module has its own `noMatch` with an equality test against `notes.js`), built with `textContent` or `esc()`. *Acceptance:* driver: token-shaped query shown masked; `<img src=x onerror=window.__pwn=1>` creates no `img`, leaves `__pwn` unset.
- **FR-007** **Highlight** (Q4 a): the matched words in shown row names and folder headings are marked with the CSS Custom Highlight `durbar-find` from `locate` ranges, the same name, colours and contrast pairs as spec 112 FR-007 (one rule in CSS, shared if 112 is built first, added here otherwise); feature-detected. No node is rewritten (rows are morphed by key). *Acceptance:* driver reads the highlight ranges; contrast in every world.
- **FR-008** **Lifetime** (Q6 a). The words live in renderer memory only (no storage): kept across chat switches (`openPanel` writes the field back with its value; focus and selection only if it held them, the `#prevQ` pattern `app.js:9993`, `:10004`) and across repaints; cleared by `closePanel` (back to the office) and by Escape. *Acceptance:* driver: filter, click a row, the words and the filtered rail remain; Office, open a chat again: field empty.

**Keys**

- **FR-010** **In the field.** Escape with text clears (stopping the event, so the chat does not close) and keeps the focus in the field; Escape with an empty field falls through to today's Escape (closes the chat). ArrowDown moves the focus to the first visible row or heading; Enter opens the first matching chat (Q1 a) and keeps the filter. Escape branch placed beside `#prevQ`'s (`app.js:4642`). *Acceptance:* driver, real key events.
- **FR-011** **Focus key** (Q5 a). While a chat is open and no dialog is, the Search conversations shortcut (`SEARCH_KEY`, default ⇧⌘F / Ctrl+Shift+F, whatever the person recorded) focuses and selects the rail field instead of closing the chat (`csFocusBox`, `app.js:2446`); with no chat open it does what spec 095 does today. ⌘F / Ctrl+F stays the navigator. `TAKEN` is unchanged. The palette's "Search conversations" item behaves the same. The `?` sheet and Settings > Keyboard's note say so. *Acceptance:* driver: shortcut in a chat keeps `body.panel-open` and focuses the field; in the office it opens `#convSearch` as before; a recorded other combo works the same; spec 095's `shots-095` passes unchanged in the office.

**Search conversations from a chat** (Q1 a, Q2 a)

- **FR-020** **Entry.** When `csAvailable()`, the filtered list ends with one button row "Search messages for "<words>"" (masked, cut like FR-006), shown whenever the field holds words; it is the last ArrowDown stop. Below 3 characters (`DurbarConvSearch.longEnough`) it is `aria-disabled` with "Type at least 3 characters". *Acceptance:* driver.
- **FR-021** **Run.** Activating it hands the words to spec 095 through its own path: `#convSearch`'s value and `csRun` (no new IPC, no second scan path; FR-033 checks in main unchanged). Results show in the existing List results (Q2 a); the chat closes and is remembered as the place to return to. *Acceptance:* driver with the simulator's corpus: the 095 results appear for a query that matches message text only.
- **FR-022** **Back to the chat** (Q2 a; a pointer delta to spec 095 FR-002/FR-003). A search started from the rail remembers the chat (`CS.panel`) even after the scan starts; Escape in the box or the results, or clearing the box, ends the search and opens that chat again (focus in its message box as opening a chat does), if it still exists; else the view before. Opening a result goes to that result's chat as today. A search started from the office is unchanged. *Acceptance:* driver: rail search, Escape: the same chat is open; `shots-095` unchanged for an office start; mutant "chat dropped on scan start" fails.

**Calm UI and parity**

- **FR-030** Text at least 10.5 px; at 1440x900 and 1280x800 with 15 agents in Flat, Retro, Real office photo, cave and loft: no overlap, no sideways scroll; the rail's list scroll within spec 005 FR-195's limit, raised to the value measured first (T007) by a pointer delta in 005 (Q3 a); the field fits at 180 px rail width and in a 640x480 window; on macOS the field is `no-drag`. Works on Windows, macOS and Linux alike (only key labels differ, from `keys.js`). *Acceptance:* `check-rail-filter` and `check-rail` (updated limit) both sizes, every world; screenshots `113-rail-filter-{1440x900,1280x800}.png`.
- **FR-031** **Office List view** (Q8 a): unchanged in v1; the office keeps `#convSearch`, `#wsFilter` and the status pill.
- **FR-032** **Tests.** Pure: `scripts/test-rail-filter.ts` (`npm run test:railfilter`, in `scripts/test-suites.txt`), mutants: AND to OR, fold removed, folder ignored. Driver `scripts/check-rail-filter.js` in `ui-suite.js`, mutants: filter off; Escape closes the chat with text in the field; folds written by the filter; shortcut closes the chat; no way back to the chat after a rail search; no-match line without `esc`/`textContent`; announcement on every repaint. Simulator only, zero AI credits.

- **FR-040** **Order switch** (owner request 2026-11-19, Q9, Q10). A two-option control "Folders | Recent" in the rail's filter row (FR-001), a `role="radiogroup"` of two buttons with `aria-checked` (or the existing segmented control if one exists, FR-031 check first), keyboard reachable, at least 10.5 px. *Folders* is today's rail (`DurbarRail.group`). *Recent* paints one flat list with no folder headings. *Acceptance:* driver: the control exists in every world at both sizes, switches the painted list, keyboard only.
- **FR-041** **Recent order** (Q9 a, Q10 a). Pure `DurbarRail.recent(items)` in `railorder.js`: rows that need you first, in FR-194's order (`needs`, then `since`); then rows by `youAt` descending (the last time you sent a message to the session); rows with no `youAt` last, in the office order (`group`'s order flattened). Ties keep the office order. Agent events never reorder rows (spec 005 FR-194's "time never reorders" holds for agent time; only your own sends do). *Acceptance:* `test:railorder` (or `test:railfilter`): needs first, `youAt` order, unstamped last, a later agent event does not move a row; mutant "order by `lastEventAt`" fails.
- **FR-042** **`youAt`.** Set by the window when a message you typed is sent to the session (the existing send path, also queued sends; not slash commands that run nothing, not a permission answer), `Date.now()`. Kept per session id in `localStorage['durbar.railYouAt']` only when `rememberOn()` and not in demo, as the chat numbers are (`CHATNO_KEY`, `app.js:47-51`), capped at 500 ids (oldest dropped), ids of sessions that no longer exist dropped on load. Without storage it lives for the window's life. No message text is stored. *Acceptance:* unit test of the load/save helper (cap, unknown ids, bad JSON); driver: send in the simulator, the row moves to the top under the needs-you rows; reload with `railstore=1`: order kept.
- **FR-043** **Folder shown in Recent.** Each row in *Recent* shows its folder's name in small secondary text after the session name (cut with an ellipsis, the full folder name and masked path in the row's tooltip and accessible name), since the headings are gone. Two folders with the same name show their parent folder too (`parent/name`), the rule of issue #1905. *Acceptance:* driver: the folder text is present, ≥ 10.5 px, two same-name folders differ.
- **FR-044** **Remembered and combined.** The chosen order is kept in `localStorage['durbar.railOrder']` when `rememberOn()` (default *Folders*). The filter (FR-002..FR-007) applies to *Recent* too: matching rows only, in Recent order; the folder name is matched as in FR-002; folds (`RAIL_FOLDS`) are not used or changed in *Recent*. The open chat's row rule (FR-004) holds. *Acceptance:* driver: filter in Recent, folds unchanged, order kept across a chat switch and a reload (`railstore=1`).

### Key Entities

- **Rail filter state** (renderer memory only): the words, whether the field had focus, and, for FR-022, the chat a rail-started search returns to. Nothing is written to disk; nothing new is sent to main (the 095 handoff sends what `#convSearch` already sends).

## Success Criteria *(mandatory)*

- **SC-001**: With 15 simulator agents, typing a folder's name leaves exactly that folder's sessions (and any other row whose text holds the words), in every world, at both sizes.
- **SC-002**: From an open chat, reaching another chat by name takes the focus key, a few letters and Enter (3 steps), with no mouse and without leaving the chat layout.
- **SC-003**: Filtering after a key costs under one frame with 40 simulator agents at 1440x900 (`performance.measure`, median of 20).
- **SC-004**: `check-rail` and `shots-095` pass with an empty filter (only `check-rail`'s scroll limit changes, to T007's measured value, Q3 a).
- **SC-005**: In *Recent*, the session you last wrote to is the first row below any that need you, from the next paint after you send, in every world at both sizes.

## Assumptions

- The UI is English only.
- The rail's Plan view (spec 005 R2) is not built; when it is, the filter's place in it is R2's to decide (the field stays above both views).
- `[KNOWN GAP]` until a person checks: screen readers (VoiceOver, NVDA), a real Mac keyboard, the Custom Highlight in the packaged app.
- Unverified: the exact extra rail scroll the field costs at 1280x800 (estimated +32 px from `.rail-door`'s row height, `styles.css:863-864`; P2 measures it first, T007).

## Open questions (answered 2026-11-19, see *Clarifications*; kept for the options weighed)

1. Options weighed for Q1, One field or two. (a) **(recommended; chosen by the owner 2026-11-19)** One field "Filter chats" in the rail: typing filters at once (local, no scan); Enter opens the first match; a last row "Search messages for "…"" runs spec 095 with the same words. (b) One field where Enter runs spec 095 and the filter is only as-you-type. (c) Two controls: the filter field plus a magnifier button in the rail that opens a separate 095 box.
2. Options weighed for Q2, Where 095 results show when started from a chat, and the way back. (a) **(recommended; chosen by the owner 2026-11-19)** The existing List-view results (the chat closes for them, as ⇧⌘F does today), and Escape or clearing returns to the chat you came from, even after the scan started (a delta to 095 FR-003). (b) Results inside the rail, replacing the list, chat stays open (a new results view: larger build, rows of 220 px). (c) As today: the chat closes and Escape goes back to the office.
3. Options weighed for Q3, Placement and fit. (a) **(recommended; chosen by the owner 2026-11-19)** Its own row under *Your door*, full rail width; it costs about 32 px of rail list, so spec 005 FR-195's scroll limit at 1280x800 (34 px) is re-measured and raised to the measured value. (b) A magnifier in the top row beside *Office* that opens the field over that row (no height cost; one more click, hidden until used). (c) The field and *Your door* share one row (door becomes a compact count button; changes 052 FR-216's look).
4. Options weighed for Q4, What the filter matches, and marks. (a) **(recommended; chosen by the owner 2026-11-19)** Session name, folder name, agent app and chat number (C3); matched words marked (spec 112's highlight). (b) a plus status words ("waiting", "error") — rows then appear and vanish as statuses change under you. (c) b plus the current task text. Option: no highlight.
5. Options weighed for Q5, Keys. (a) **(recommended; chosen by the owner 2026-11-19)** With a chat open, the Search conversations shortcut (⇧⌘F / Ctrl+Shift+F) focuses the rail field and keeps the chat; elsewhere unchanged; ⌘F stays the navigator. (b) ⌘F / Ctrl+F's first press with a chat open focuses the field, the second opens the navigator (spec 112's pattern; a spec 074 delta). (c) No key: Tab from *Your door* only.
6. Options weighed for Q6, Lifetime. (a) **(recommended; chosen by the owner 2026-11-19)** Kept while you stay in the chat layout (switching chats keeps it), cleared on Back to the office. (b) Kept until cleared, across trips to the office (memory only). (c) Cleared on every chat switch.
7. Options weighed for Q7, Collapsed folders and the open chat's row while filtering. (a) **(recommended; chosen by the owner 2026-11-19)** Collapsed folders with a match show their matching rows during the filter (saved folds untouched); the open chat's row always stays, marked "open, does not match" when it does not. (b) Collapsed folders stay collapsed showing only "k matches"; the open chat's row is hidden when it does not match. (c) a for folders, b for the open chat's row.
8. Options weighed for Q8, The office List view. (a) **(recommended; chosen by the owner 2026-11-19)** Not in v1: the office keeps the top-bar search, folder filter and status pill. (b) The same filter field above the List view's rows too (same matcher). (c) b and the field replaces the top-bar folder filter.

## Changes

### 2026-11-19: Q1..Q8 decided (owner)

Paco (owner, terminal, 2026-11-19, relayed by the coordinator) accepted every recommended option: Q1 a, Q2 a, Q3 a, Q4 a, Q5 a, Q6 a, Q7 a, Q8 a. *Clarifications* records them; the FRs, plan and tasks follow them, and the branches for options not chosen are removed (no spec 074 delta, no results view inside the rail, no List view filter in v1).

### 2026-11-19: Recent order in the rail (owner request; Q9, Q10)

Paco (owner, terminal, 2026-11-19, relayed by the coordinator) asked for a "chat" mode in the chat-open layout: the sessions he works in most, by his own recent activity, whatever their folder. He accepted Q9 a (the last time *you* sent a message) and Q10 a (sessions that need you stay on top). Added FR-040..FR-044, SC-005, tasks T031..T037 (phase P6). The Folders order stays the default and unchanged.


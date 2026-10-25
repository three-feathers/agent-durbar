# Feature Specification: Keyboard navigator (Spotlight-style "Go to")

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Keyboard navigator (issue #548): one configurable shortcut (default Ctrl+F, ⌘F on a Mac; Ctrl+J until 2026-10-23) opens the command palette in "Go to" mode; floor, F folder, agent, or C and a number for a numbered chat; the chat opens with the cursor in the message box; follow-up #587: opening any chat puts the cursor in its message box, Ctrl+A (⌘A) opens Needs you and Ctrl+Backspace (⌘⌫) goes back to the office, both only outside text
status: **built** 2026-10-22: unit tests, simulator driver and screenshots at both sizes; defaults D1-D7 chosen by Vikram's agent, for the owners to confirm; not tried on a real Mac or Windows machine; follow-up #587 (Ctrl+F, cursor in the message box, Ctrl+A, Ctrl+Backspace, unsent text kept) built 2026-10-23: unit tests and simulator driver, mutation-checked; the macOS simulator does not model native ⌘⌫ editing or ⌘A selection, so the driver checks non-interception and ordinary Backspace editing instead
-->

**Feature Branch**: `074-keyboard-navigator`
**Created**: 2026-10-22
**Status**: Built (simulator, unit tests); defaults D1-D7 open for the owners
**Input**: Issue #548, owner request by Ruben (2026-10-22, priority high): "A keyboard-first navigator, like macOS Spotlight: one configurable shortcut opens a small box from anywhere in the app, and you jump anywhere and type into a chat without touching the mouse." Levels: floor (spec 033), **F** folder, agent, **C** chat with numbered chats (`C 1`). Choosing an agent opens its chat with the cursor in the message box; Enter sends; Escape steps back a level or closes; type-to-filter, arrows and numbers at every level. Reuse the command palette (spec 052 FR-042) and the shortcut sheet (FR-043) rather than a second unrelated box.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Jump to a numbered chat and type (Priority: P1)

Mia has 12 sessions open. Each one shows a small chat number ("C3") on its desk card, its list row and its chat header. She presses the navigator shortcut, types `c` and `3`, and chat 3 opens with the cursor in its message box. She types a message and presses Enter; it is sent exactly as if she had clicked into the box.

**Why this priority**: it is the shortest path from anywhere to "talking to that agent", and it is what makes the numbers worth showing.

**Independent Test**: on the simulator with 15 agents, from the office with nothing focused, press the shortcut, `c`, `3`, type "hello", Enter: chat 3 has the message and the composer is empty again.

**Acceptance Scenarios**:

1. **Given** the office is shown, **When** the user presses the shortcut, then `c`, then `3`, **Then** the chat numbered 3 opens and the message box has focus.
2. **Given** chats 3 and 31 both exist, **When** the user types `c` `3`, **Then** chat 3 is highlighted but nothing opens until Enter (or until `1` is typed, which opens 31).
3. **Given** the navigator opened a chat, **When** the user types and presses Enter, **Then** the message goes out with that session's own agent app, permission mode, model and spending limit; no new approval path exists.
4. **Given** no chat has number 7, **When** the user types `c` `7`, **Then** the list says "No chat 7" and nothing opens.

---

### User Story 2 - Step down: floor, folder, agent (Priority: P1)

Raj keeps work and personal folders on two floors. He presses the shortcut: the box lists his floors that are on (numbered 1, 2, ...), plus a "Folders" and a "Chats" row. He presses `2` (or arrows and Enter) for the second floor, sees its folders, types "api" to filter, presses Enter, sees the two agents in that folder, presses `1`, and that chat opens with the cursor in the message box.

**Why this priority**: the step-by-step path is the other half of the request, and works without remembering numbers.

**Independent Test**: simulator with floors (`DURBAR_SIM_FLOORS=1`): shortcut, pick a floor, filter a folder, pick an agent: the right chat is open and its message box focused.

**Acceptance Scenarios**:

1. **Given** two or more floors are on, **When** the navigator opens, **Then** it starts at the floor level; **Given** only one floor is on (or floors are not used), **Then** it starts at the folder level of the whole office.
2. **Given** any level, **When** the user types letters, **Then** only matching items stay (same matching as the palette); arrows move; Enter picks; a number picks the item with that number.
3. **Given** a folder with one agent, **When** the folder is picked, **Then** its chat opens directly (the agent level is skipped).
4. **Given** the start level, **When** the user types `f` and a space (or picks the "Folders" row), **Then** the folder level of every folder on a floor that is on is shown; `c` and a space (or the "Chats" row) shows the chat level.

---

### User Story 3 - Escape steps back (Priority: P1)

At any level, Escape goes back one level (with that level's filter as it was); at the start level it closes the box and focus goes back where it was. Backspace in an empty filter also goes back one level.

**Independent Test**: shortcut, floor, folder, then Esc, Esc, Esc: agent level, folder level, floor level, closed; focus is back on the element that had it.

**Acceptance Scenarios**:

1. **Given** the agent level reached through floor and folder, **When** Escape is pressed three times, **Then** the box shows the folder level, then the floor level, then closes.
2. **Given** fewer than two floors are on (the start level lists folders), **When** Escape is pressed at the agent level, **Then** it goes back to the start level, and Escape again closes.

---

### User Story 4 - Choose my own shortcut (Priority: P2)

Lena already uses Ctrl+F in another tool. In **Settings > Keyboard** she presses **Change…**, presses Ctrl+Shift+G, and it is saved. A combination the app or the operating system already uses (Ctrl+K, Ctrl+C, ⌘Space, Alt+Tab, ...) is refused with a sentence naming what uses it. **Reset** brings back the default.

**Independent Test**: on the simulator, change the shortcut, check the old one no longer opens the navigator and the new one does; try Ctrl+K and see it refused.

**Acceptance Scenarios**:

1. **Given** Settings > Keyboard, **When** the user records a combination that is free, **Then** it is saved for this window, and the shortcut sheet, the palette and Settings all show the new one.
2. **Given** recording, **When** the user presses a combination used by the app, by text editing or by a known OS shortcut, **Then** it is not saved and the reason is shown.
3. **Given** recording, **When** the user presses Escape (or a key without Ctrl/⌘ or Alt), **Then** recording stops (Escape) or asks for a modifier, and nothing is saved.

---

### User Story 5 - Discover it (Priority: P3)

The `?` shortcut sheet lists the navigator shortcut and the in-box keys; the Ctrl+K palette has a "Go to… (navigator)" action showing the shortcut; the box itself has a short key line at its foot.

### Edge Cases

- No agents in the office: the box opens and says there is nothing to go to yet (and names + Folder), instead of an empty list.
- A chat number belongs to a session in a hidden folder or on a floor that is off: it is not listed and `c` + its number says "No chat N here" (it may be in a hidden folder or a floor that is off). Its number stays reserved.
- A session ends and is removed from the office: its number is freed for the next new session; numbers of the other sessions never change.
- The navigator shortcut is pressed while the navigator is open: the box closes (toggle, like Spotlight). Pressed while the Ctrl+K palette is open: the palette switches to the navigator's start level.
- Another modal dialog is open (a confirmation, a question, Settings while recording): the shortcut does nothing there; that dialog keeps its focus.
- The chosen agent is a helper (sub-agent) or not a live session: helpers are never listed; a non-live demo agent opens its chat with focus on the chat title.
- The open chat's unsent text is kept when the navigator opens another chat and comes back when that chat is opened again (FR-022, 2026-10-23; before that date the text was dropped, although this line said otherwise). Nothing is sent by the navigator itself.
- Simple and Expert detail levels behave the same.
- Text in the box and the chat-number badges is never smaller than 10.5px; with 15 agents the office still fits at 1440x900 and 1280x800.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** One box: the navigator MUST be the existing command palette (spec 052 FR-042) opened in a "Go to" mode with levels, not a second, separate dialog. It keeps the palette's look, focus trap, ARIA combobox/listbox roles, live result count and focus return.
- **FR-002** Shortcut: a configurable keyboard shortcut MUST open the navigator from anywhere in the app (office, list, an open chat, text fields included), except while another modal dialog is open. Default: **Ctrl+F** on Windows and Linux, **⌘F** on a Mac (FR-084 of spec 052; "F for floor", issue #587; it was Ctrl+J / ⌘J until 2026-10-23, see Changes). Pressing it again closes the box.
- **FR-003** Levels: the box MUST show one level at a time, named in a breadcrumb line above the input (for example "Go to › Upstairs › api"):
  - **Start**: the floors that are on (when two or more are on), or else every folder on a floor that is on; plus two rows, **Folders** (`F`) and **Chats** (`C`).
  - **Folders**: folders on floors that are on and not hidden, in office order (on a picked floor: that floor's folders only).
  - **Agents**: the main sessions of the picked folder, each with its chat number.
  - A folder or chat level that has no items says so ("No chat 7", "No sessions in this folder"); an office with no agents says there is nothing to go to yet.
  - **Chats**: every visible main session in chat-number order, labelled "C3 · name · folder".
- **FR-004** Letters: at the start level, typing `f` or `c` followed by a space jumps to the Folders or Chats level; `c` followed directly by digits (`c3`, or `c 3`) picks that chat number. Typing `f` or `c` followed by any other letter is ordinary filter text, so folders whose names start with those letters can still be filtered. The **Folders** and **Chats** rows also match `f` and `c` first, so `f` then Enter works too.
- **FR-005** Filter: at every level, typed text filters the items with the palette's matching (start of name, start of a word, anywhere, then hint words), case-insensitive.
- **FR-006** Numbers: at the floor and folder levels every item shows its position number; typing a filter made only of digits picks by number. At the agent and chat levels the number is the chat number ("C3" is picked with `3`). A number opens its item straight away when no other number starts with the typed digits; otherwise it is highlighted and Enter opens it.
- **FR-007** Keys inside the box: ↑/↓ move, Enter picks the highlighted item, Escape goes back one level (closes at the start level), Backspace in an empty filter goes back one level, Tab stays in the box. Going back restores that level's filter text and highlight.
- **FR-008** Single choice: picking a folder that has exactly one main session MUST open that chat directly (the box closes, as for any opened chat).
- **FR-009** Open a chat: picking an agent or a chat MUST open its chat (the same path as clicking its desk) and put the cursor at the end of its message box. If the session has no message box (not live), focus goes to the chat title. Since 2026-10-23 (FR-019) every way of opening a chat does the same.
- **FR-010** Sending: the navigator MUST NOT send anything itself. Enter in the message box sends through the existing composer, so the folder's permission mode, the spending limit, the plan-first and attachment rules and every approval stay exactly as they are. The navigator adds no way to approve tools.
- **FR-011** Chat numbers: every main session in the office MUST have a chat number, a positive integer:
  - a new session gets the lowest number not held by another session in the office;
  - a session keeps its number while it is in the office, whatever else is added, removed, hidden, filtered or sorted;
  - numbers are kept on this computer by session id (ids only, no names or content), so a restored session keeps its number after a restart; a session that is no longer in the office frees its number once the office has loaded;
  - helpers (sub-agents) and previous sessions have no number;
  - in the simulator nothing is saved; numbers follow the order agents appear.
- **FR-012** Numbers visible: the chat number MUST be shown as a small text badge "C3" (accessible name "chat 3") on each main desk card (in the card densities roomy, card, mini and micro on the corner of the desk's scene, never in the name row; in full density, which has room, inline in the name row; 2026-10-23), on each list-view row, in the chat header next to the title, in the full-screen chat strip's tooltips and in the palette's agent hints. Text at least 10.5px; not colour only.
- **FR-013** Settings: **Settings > Keyboard** MUST show the navigator shortcut, a **Change…** button that records the next key combination, and **Reset to default**. The choice is a display preference of this window, saved like the detail level.
- **FR-014** Clash check: a recorded combination MUST be refused, with a sentence naming its owner, when it:
  - has no Ctrl/⌘ or Alt/Option modifier, or uses the Windows/Super key on Windows and Linux;
  - would type a character: Option with a letter, digit or punctuation key alone on a Mac (accents), and Ctrl+Alt with one of those without Shift on Windows and Linux (AltGr on many layouts); Ctrl+Alt with a function key on Windows and Linux (Linux console switching);
  - is one of the app's own shortcuts (Ctrl/⌘+K, Ctrl/⌘+O, Ctrl/⌘+Shift+O, Ctrl/⌘+Shift+A, Ctrl/⌘+Shift+N, Ctrl+`, ⌘, on a Mac, the chat answer keys Alt/⌥⌘+A/S/D/N);
  - is a text-editing or window key (Ctrl/⌘ + A, C, V, X, Z, Y, Shift+Z, W, Q, R; ⌘H, ⌘M on a Mac; Alt+F4);
  - is a Mac text-editing Control key (⌃ with A, B, D, E, F, H, K, L, N, O, P, T, V or Y, with or without Shift), IBus Unicode or emoji input on Linux (Ctrl+Shift+U, Ctrl+Shift+E), or Ctrl/⌘+Shift+S (Schedules, PR #560) (2026-10-23);
  - is a known OS shortcut (Ctrl+Space, Ctrl+Shift+Space, Super/⌘+Space, ⌥⌘Space, ⌃⌘Space, Alt+Tab, ⌘Tab, Ctrl+Alt+Delete, Ctrl+Alt+T, Ctrl+Alt+L, Ctrl+Alt+arrow keys).
- **FR-015** Discovery: the `?` shortcut sheet MUST list the navigator shortcut (the current one) and the in-box keys (`F`, `C` + number, numbers, Esc back); the Ctrl+K palette MUST have a "Go to… (navigator)" action showing it; the box's foot line names ↑↓, Enter, Esc back, and F / C.
- **FR-016** Accessibility: the box is a modal dialog with a combobox input (`aria-activedescendant`), a listbox with options, the breadcrumb as the dialog's description, and a polite announcement of the level and result count on every change; with no items, the announcement says why ("No chat 7 here…") and the empty text has no role inside the listbox (2026-10-23). Everything reachable without a mouse; options also respond to a click.
- **FR-017** Platforms: the same on Windows, macOS and Linux; ⌘ replaces Ctrl on a Mac in matching and in every label; keys are matched by their position (`code`), so keyboard layouts do not move the shortcut; the letter a key types (`key`) counts too: recording refuses a combination whose position or typed letter is taken, and a press whose typed letter is another shortcut's is left to it (2026-10-23). Known limit, stated in Settings and the README: on a Mac with Dvorak, ⌘J types H and macOS takes ⌘H (Hide) before the page sees it, so ⌘J cannot be Go to there; pick another key (2026-10-23, review round 2). Since the default became ⌘F (2026-10-23) this matters only to a Mac Dvorak user who picks ⌘J; with ⌘F, Go to follows the key's position, so on Dvorak it is the key that types U.
- **FR-018** Simulator: everything works with `DURBAR_SIM=15` (and with floors), with zero AI credits.
- **FR-019** Cursor in the message box (2026-10-23, issue #587): every time the user opens a chat (a click or Enter on a desk, a list row or the strip, the Ctrl+K palette, the navigator, the Needs you inbox's Open and Answer in chat, Ctrl+\`), the cursor MUST land at the end of that chat's message box, so typing and Enter send at once. No usable message box (a helper, a chat that is not live): the chat title, as before. A chat that waits for a permission answer is no exception: focus goes to the message box, **never** to the answer bar, so no Enter or Space can approve anything by accident; the answer bar stays visible and its keys (Alt/⌥⌘ + A, S, D) and buttons work as before. Chats the app opens by itself (restoring the last chat at start, a session that just started) keep their current focus. **Next agent that needs you** (N, Ctrl+Shift+N, Alt+N / ⌥⌘N) keeps focusing the chat title: with the cursor in the message box a second N would be typed there instead of walking the queue (spec 052 FR-014; found by `shots-052-ux`). The request bubbles that open a chat at its pending request (spec 001 FR-034, `data-pvopen`) keep focusing that request, as they did.
- **FR-020** Back to the office (2026-10-23, issue #587): **Ctrl+Backspace** on Windows and Linux, **⌘⌫** on a Mac, MUST close the open chat (and a full-screen view or Settings screen) and show the office, the same as the chat's Office button, but only when:
  - focus is not in an editable field (a text box, the message box, a search box, a select, anything `contenteditable`), **even an empty one** (holding the key to delete words would otherwise close the chat the moment the box is empty); in a field the key keeps its text meaning (delete a word, delete to the start of the line);
  - no text is selected on the page, and no dialog (`aria-modal`) is open;
  In the message box, Esc goes back to the office as before.
- **FR-021** Needs you with Ctrl+A (2026-10-23, issue #587): **Ctrl+A** (⌘A) MUST open the Needs you inbox under the same conditions as FR-020 (not in an editable field, no text selected, no dialog) and also not while focus is in the chat log, where Ctrl+A selects the conversation to copy it. Everywhere else it stays Select all. **Ctrl+Shift+A** (⇧⌘A) and **I** keep working as before; Ctrl+Shift+A is the one that works from the message box too.
- **FR-022** Unsent drafts are kept (2026-10-23, issues #587 and #612): the text typed in a chat's message box and the attachments picked for it, not yet sent, MUST be kept for that chat when the chat is closed (Esc, the Office button, Ctrl+Backspace) or another chat is opened by any route, and MUST come back when that chat opens again, with the cursor at the end of the text. Sending empties the box, so the draft is gone; emptying the box by hand drops it too; ending the session (End session, End all sessions) or removing it from the office drops it, also from its open message box (2026-10-23, review on #597, following issue #612). Drafts live **in memory only**, for this window: never written to disk, never logged, never sent anywhere until the user sends them (see *Clarifications*: a draft can hold a pasted token or password).
- **FR-024** Draft marker (2026-10-23, issue #612): a chat with an unsent draft (FR-022) that is not the open chat MUST show a small pencil on its desk (desk card: on the scene's corner under the chat number; full desk: inline; a lounge resident: the free top corner, or bottom left on a nap bed), on its list row and on its item in the chat strip. The pencil is an icon (12px, theme tokens only, no text, so the desk's text still starts with its name), with the tooltip "Unsent draft"; screen readers hear ", unsent draft" in the desk's, row's and strip item's name. It goes away when the draft is sent or emptied.
- **FR-025** Dialogs (2026-10-23, review on #597): "a dialog is open" (FR-002, FR-020, FR-021) means any element with `aria-modal="true"`, the app's confirmations (`askDialog`, `role="alertdialog"`) included. Under such a dialog the Go-to shortcut, Ctrl+A and Ctrl+Backspace do nothing of ours.
- **FR-023** Clash list (2026-10-23): Ctrl/⌘+Backspace is in the list of taken shortcuts ("Back to the office"), and Ctrl/⌘+A names Select all and Needs you; Ctrl/⌘+F is free (it is the default) and Ctrl/⌘+J is no longer taken by anything in the app. The `?` sheet, the Needs you button's tooltip and `aria-keyshortcuts`, Settings > Keyboard and the README show the new keys with the platform's names (Ctrl, Backspace on Windows and Linux; ⌘, ⌫ on a Mac).

### Key Entities

- **Navigator level**: kind (start, folders, agents, chats), the floor or folder it belongs to, its filter text and highlighted item.
- **Chat number**: session id → positive integer, unique among the sessions in the office.
- **Navigator shortcut**: modifiers (Ctrl/⌘, Alt, Shift) and one key position; default Ctrl/⌘+F (Ctrl/⌘+J until 2026-10-23).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From any screen, a message reaches chat N in at most 4 key presses plus the message itself (shortcut, `c`, the number, Enter after typing) for N ≤ 9 with no number starting with N's digits beyond it.
- **SC-002**: From any screen, any agent is reachable by floor → folder → agent without the mouse, in at most 4 key presses with 9 or fewer items per level.
- **SC-003**: Chat numbers never change for a session while it stays in the office (checked by adding, removing and hiding other sessions), and are the same after a restart.
- **SC-004**: With 15 agents, the office (with the new badges) has no overlap or page overflow at 1440x900 and 1280x800, and every new text is ≥ 10.5px.
- **SC-005**: Zero AI credits spent in every check of this feature.

## Assumptions

Defaults chosen by Vikram's agent, each changeable by the owners (listed for review in the PR):

- **D1 Shortcut**: Ctrl+F / ⌘F since 2026-10-23 (owner request, issue #587: "F for floor"; checks in the Changes entry of that date). Until then Ctrl+J / ⌘J ("J for jump"). Not used by the app, by text fields, or by Windows, GNOME/KDE or macOS globally. Rejected: Ctrl+Space (input-method switching on Linux and Windows, previous input source on a Mac), Ctrl/⌘+Shift+Space (input-method and IME toggles on some setups), ⌘Space (Spotlight), Ctrl/⌘+K (the palette itself), Ctrl+P (print expectations).
- **D2 One box**: the navigator is the palette in a "Go to" mode (FR-001), so there is one focus trap, one look and one set of keys to learn; Ctrl+K keeps its current mixed search.
- **D3 One floor**: with fewer than two floors on, the floor level is skipped and the start level lists the folders.
- **D4 Letters**: `f`/`c` need a following space or digit (FR-004), so filtering folders named "core" or "frontend" still works.
- **D5 Chat numbers**: lowest free number, kept per session id on this computer, shown as "C3".
- **D6 Single agent**: a folder with one session opens its chat directly.
- **D7 Off floors and hidden folders**: not listed in the navigator (as everywhere else, spec 033 FR-008); their numbers stay reserved.

Out of scope: VS Code chats (spec 009) and previous sessions (spec 006) are not numbered or listed; global (system-wide) shortcuts when the app is not focused; searching message text (issue #430).

## Clarifications

### Session 2026-10-23 (issue #587, owner feedback by Ruben; defaults chosen by Vikram's agent, for the owners to confirm)

The issue asked to settle each conflict in the spec. Where a choice may need an owner, the default below is what is built:

- Q: Should Ctrl+J / ⌘J stay as an alias of Go to for a while? → A (default): **no**. One shortcut, shown everywhere (FR-002); a hidden second key would also keep Ctrl+J away from users who want it for their own shortcut. Go to shipped in v0.1.0-alpha.13, a pre-release, one day before; the changelog says the key moved. Anyone who had set their own shortcut keeps it (it is saved; the default never was).
- Q: May Ctrl+Backspace (⌘⌫) go back from an **empty** message box? → A (default): **no** (FR-020). Holding the key to delete words would close the chat the moment the box empties; Esc already goes back from the message box.
- Q: Does Ctrl+A (⌘A) open Needs you while focus is in the chat log? → A (default): **no** (FR-021): there it selects the conversation, which people copy.
- Q: "Start screen" for Ctrl+Backspace: the office or the navigator's start level? → A: **the office** (the issue says "the start screen (the office / home view)"); the navigator's own start level is reached with Esc or Backspace in its empty box (FR-007).
- Q: Do drafts survive an app restart (#612)? → A: **no**. They stay in memory for this window only, because a draft can hold a secret pasted on its way to the agent (a token, a password); writing it to disk would keep that secret around unasked. A restart starts with empty boxes.
- Q: Does ending a session drop its draft (#612 says ending or removing)? → A: **yes, ending and removing both drop it** (2026-10-23, following issue #612 after review on #597; the first version kept it on End). A resumed session must not pick up a half-written message into the same box as if nothing had happened; End empties its open box too.
- Q: Focus when the opened chat waits for a permission answer? → A: the message box, never the answer bar (FR-019): a focused Allow button would approve on Enter.

## Changes

### 2026-10-24: macOS synthetic text-editing key in the navigator driver (#683)

`real:` The nightly run `40076601038` failed in `shots-074-navigator` on macOS. Local reproduction showed that the
synthetic ⌘⌫ event sent by Electron's `webContents.sendInputEvent` leaves the message-box text unchanged, and synthetic
⌘A does not select the text. The app's text-field guard leaves these keys to native editing; the unchanged text and
selection are simulator-input limitations, not evidence that the app intercepted either key.

`sim:` On macOS, verify ⌘⌫ and ⌘A are not prevented by the app, the message box remains focused, and the chat stays
open; separately verify that ordinary Backspace edits the field. On Windows/Linux, retain the assertions that
Ctrl+Backspace deletes a word and Ctrl+A selects all. `read:` a real Mac's native ⌘⌫ editing and ⌘A selection behavior
have not been verified. The post-merge nightly run remains required to close issue #683.

### 2026-10-23: Ctrl+F, cursor in the message box, Ctrl+Backspace and Ctrl+A (issue #587)

Owner feedback (Ruben, after a test drive, filed by his agent): four tweaks, each with a rule that never takes a key away from text editing. New: FR-019 to FR-023; amended: FR-002 (default key), FR-009, FR-017 (Dvorak note), D1, the draft edge case (it claimed a per-chat draft that did not exist).

Checks before choosing (`read:` the code at main 1336a79c):

- **Ctrl+F / ⌘F** is free: the page has no find (no `findInPage`, no Ctrl+F handler), the Mac menu (`appmenu.ts`: app, File, Edit role, View, Window, Help) has no Find item, Windows and Linux have no menu, and Ctrl+F / ⌘F edits nothing in a text field. ⌃⌘F (full screen on a Mac) stays taken, and ⌃F on a Mac stays a text key (FR-014). Chat search (#430) does not exist yet; if it wants Ctrl+F, that spec decides then, and Go to moves or the search takes another key. No open pull request uses Ctrl+F, Ctrl+J or Ctrl+Backspace.
- **Ctrl+J / ⌘J** was used only by Go to; it becomes free (Settings may record it).
- **Ctrl+Backspace / ⌘⌫** deletes a word (Windows, Linux) or to the start of the line (Mac) in a text field, and does nothing elsewhere; the app used Backspace only inside the Go-to box.
- **Ctrl+A / ⌘A** is Select all everywhere (the Mac Edit menu has it too); the app used only Ctrl+Shift+A for Needs you.
- Opening a chat focused the title after a keyboard open, nothing after a mouse click, and the message box only from the navigator; closing a chat or opening another dropped the unsent text.

Rules (FR-019 to FR-023): the cursor goes to the message box on every user open (never to the answer bar); Ctrl+Backspace and Ctrl+A act only outside editable fields, with no text selected and no dialog, and Ctrl+A also not in the chat log; unsent text is kept per chat in memory (and, after #612 the same day, its attachments, with a pencil marker: FR-022, FR-024; the first version kept Ctrl+Backspace from leaving a chat with attachments waiting). The key decisions are in *Clarifications* above (Session 2026-10-23), each with the default built.

- `test:` `test-navigator`: the default Ctrl/⌘+F on Mac and elsewhere, Ctrl/⌘+J no longer opens Go to and is free to record, a saved Ctrl+J is kept, Mac Dvorak ⌘ at F (types U) matches; `textSafeKey` on both platforms: Ctrl/⌘+A → Needs you and Ctrl/⌘+Backspace → office outside text; nothing in an editable field, with a selection or under a dialog; Ctrl/⌘+A not in the chat log; not with Shift, Alt, both Ctrl and ⌘, or while composing; ⌃A / ⌃⌫ on a Mac and Super+A elsewhere are not ours; Caps Lock, a Cyrillic layout (position A) and AZERTY (position A types q: not ours; position Q types a: ours); `TAKEN` names both; the global handler calls `textSafeKey`.
- `sim:` `shots-074-navigator` at 1440x900 and 1280x800: Ctrl+J does nothing; the cursor is at the end of an empty message box after a real mouse click on a desk, Enter on a desk, a Ctrl+K pick, a mouse click on a list row and on another agent in the chat strip, and Needs you's *Answer in chat* (that chat waits for a permission; focus is not on the request or the answer bar, and it still waits 400 ms later); in the message box Ctrl+Backspace deleted text the normal way (a prefix is left) and the chat stayed **on Windows/Linux**; Ctrl+A selected all and Needs you stayed closed **on Windows/Linux**; an empty box kept the chat; unsent text came back (cursor at its end) after Esc, and after going back with Ctrl+Backspace; outside text Ctrl+A opened Needs you, but not from the chat log or with a selection, and Ctrl+Backspace went back to the office. `shots-052-ux` (the `?` sheet, N, N walking the queue) passes; it found that N opening the next agent with the cursor in the message box typed the second N there, so the next-agent route keeps the title (FR-019).
- Mutation check (each edit failed a check; files restored): `test-navigator`: the default back to `KeyJ`, dropping the editable, selection, dialog, chat-log or composing guard, accepting both Ctrl and ⌘, matching AZERTY's position A, dropping `mod+Backspace` from `TAKEN`. `shots-074-navigator`: passing `editable:false`, `log:false` or `selected:false` from `app.js`, the desk/list click and the strip click back to `e.detail===0`, focusing the title instead of the message box, not keeping the text on close, dropping the Needs you line.
- Screenshots retaken: `074-navigator-*` and `052-shortcuts-*` (the `?` sheet with Ctrl+F, Ctrl+A and Ctrl+Backspace) at both sizes.
- 2026-10-23, issue #612 (folded in by the coordinator): attachments are kept with the text, so Ctrl+Backspace no longer refuses to leave a chat with attachments (the `attached` case of `textSafeKey` is gone); the pencil marker (FR-024). `sim:` `shots-074-navigator` at both sizes: no pencil before a draft; type in chat A, open B from the strip: A's strip item has the pencil ("Unsent draft" tooltip and name), B's (open) none, B's box is empty; type in B, back to the office: both desks show the pencil (12px, inside the desk, not covered: hit-tested; one of them a lounge resident) and say "unsent draft", the names keep their room and their text; the list rows too; A again: its text intact with the cursor at the end, its own strip item without the pencil while open, B's with; send A: A's pencil gone, B's stays; B's text intact; empty it: B's pencil gone. Screenshot `074-navigator-drafts-*`. Mutation check: `draftHTML` returning nothing, `draftWords` returning nothing, `hasDraft` without the open-chat exception, not restoring the text on open, and the lounge marker back at `top:20px` (covered there) each failed the driver.
### 2026-10-23: review on #597 (fjcabello)

- **Bug found by the review's mutation:** the dialog guard looked for `role="dialog"` only, but the app's confirmations (`askDialog`, `dialog.js`) are `role="alertdialog"`, so under a confirmation Ctrl+A opened Needs you, Ctrl+Backspace closed the chat and Ctrl+F opened Go to. Now any `aria-modal="true"` counts (FR-025), for those three keys. `sim:` `shots-074-navigator`: with *End all sessions?* open and focus on its button, Ctrl/⌘+A, Ctrl/⌘+Backspace and Ctrl/⌘+F do nothing; Esc cancels. Mutation: the guard switched off (`dialog:false`), and the Go-to guard back to `role="dialog"`, each fail it. Other global shortcuts of spec 052 (Ctrl+O, Ctrl+\`, Ctrl+Shift+H) use the same `role="dialog"` selector and were not changed here.
- **Ending drops the draft** (Clarification above): `dropDraft` on End session and End all sessions. `sim:`: type in the open box, End session: the box is empty, and no pencil is shown on its desk. Mutation: not calling `dropDraft` in `endLive` fails it.
- **#592 resizable box** (now on main): a restored draft goes through `autoGrow` → `sizeComposer`, so it keeps the height chosen with the handle (one value for the whole app).
- **Focus return on Windows CI** (4f6cadb7): "focus is back on the desk" still failed there with a wait. Closing the box now returns focus to the shown element with the same `data-id` when the office was drawn again while the box was open (`liveBack`; before, the old node was gone and focus fell to the page). The driver waits up to 8 s for every focus it checks (`focusOn`) and names where the focus is when it fails. `[KNOWN GAP]` that redraw is the likely cause; it was not reproduced on Linux, and Windows CI is the check.
- **Drivers:** `check-done-desk-mask` opens Go to with Ctrl+F (⌘F on a Mac); `check-grant-chips` expects the cursor in the message box after opening the other desk (FR-019) and keeps its intent: with focus moved to the title, nothing moves it later and nothing is announced. The flaky step in `shots-074-navigator` (focus back on the desk) and the other focus reads now wait for their condition (`until`) instead of a fixed pause.

- `[KNOWN GAP]` Not tried on a real Mac or Windows machine. On a Mac, ⌘A is also the Edit menu's Select all: Electron gives the page the key first and the page cancels it outside text (`read:`, not seen on a Mac); macOS CI runs the driver with ⌘. Attachments kept with a draft are not driver-tested (the simulator driver attaches no files), nor is dropping a draft when a session is removed.


### 2026-10-22: built

- `test:` `scripts/test-navigator.ts` (`npm run test:navigator`): the shared matching; chat numbers (lowest free, never changed, restart with a saved map, prune frees, damaged or hostile saved data, 500 cap); every level, the start letters (`f `, `c3`, `c 3`, and `core`/`fro` staying filter text), number picks (unique opens, `3` with `31` waits, `7` none), picks (one session opens), the stack and breadcrumb; the shortcut on Mac and elsewhere (by `code`, ⌘ vs Ctrl, Super ignored, IME composing ignored); 35 refused combinations with their reasons and the allowed ones; saved-shortcut fallback; the page loads the module and Ctrl+K uses the shared matching.
- `sim:` `scripts/shots-074-navigator.js` (in `npm run check:ui`), real key presses at 1440x900 and 1280x800 with floors: every desk has a unique `C` badge ≥ 10.5px inside its desk with "chat N" for screen readers; floor → folder (filter, arrows, Enter) → agent by number → the cursor in the message box → typed text and Enter sent it; `c`, `c `, Esc back to the start, `c` `3` opens chat 3 (header, desk); `f `, Esc and Backspace chain with focus back on the desk; the shortcut toggles; inside Ctrl+K it switches mode; list rows show the numbers; Settings > Keyboard refuses Ctrl+K, saves Ctrl+Shift+G (Ctrl+J then does nothing), Reset restores it. Screenshots: `docs/screenshots/074-navigator-*`.
- `sim:` office check (`check-office-overlap.js`, quick matrix, DejaVu fonts as in CI): 303/303. It found two problems, both fixed: in mini and micro density the badge took the room a name needs for three characters, so there it sits on the corner of the desk's scene ([screenshot](../../docs/screenshots/074-navigator-micro-1280x800.png)); and badge text before the name broke the drivers that find a desk by the start of its text, so the number is CSS content (`data-n`) that stays out of the desk's text (the driver asserts this).
- `[KNOWN GAP]` FR-017: ⌘ matching is unit-tested and the driver uses ⌘ on macOS CI runners, but no one has used it on a real Mac or Windows machine; the operating-system shortcut list (FR-014) is a known list, not exhaustive.

### 2026-10-23: review round 2 (fjcabello, PR #552, re-review at 438f9045)

- **FR-012 (corrected)** The amendment below says "every card density" and the code does exactly that (`.stage .desk.card .chatno`); the main text said "every office density", which was wrong: full density still shows the badge in the name row, where it has room (the earlier `check:office` run, 303/303, covered full density; rerun on the final head). The main text of FR-012 now says so.
- **FR-017 (amended)** The Mac Dvorak limit (⌘J types H, macOS reads ⌘H as Hide) is now in FR-017, the README's Go to bullet and the Settings > Keyboard note, and `research.md` R4/R5 no longer claim that matching by code makes every layout work.
- **Test (T027)** The `app.js` handler scan in `test:navigator` reads the file with CRLF turned into LF (Windows checks it out with CRLF), also finds shortcuts matched only by `e.key` (`e.key==='g'`, `e.key.toLowerCase()==='g'`), and fails when a `mod&&` or `e.ctrlKey&&` line yields neither a code nor a key letter. Unit cases: CRLF input, a planted `e.key`-only Ctrl+Shift+G.

### 2026-10-23: review round 1 (fjcabello, PR #552)

Paco's agent requested changes at 9f577dd7. Each point is a requirement here:

- **FR-012 (amended)** On a desk card, in **every** card density (roomy, card, mini, micro), the chat number sits on the corner of the desk's scene, never in the name row, so it cannot squeeze the name. Found by `shots-074-navigator` on windows-latest: in card density at 1280x800, with Windows fonts, a name shrank to 19px (one or two letters). The list row and the chat header keep the inline badge (they have room).
- **FR-014 (added)** Also refused, with a reason:
  - on a Mac, Control (⌃) with A, B, D, E, F, H, K, L, N, O, P, T, V or Y, with or without Shift and without ⌘ or ⌥: the text-editing keys of every Mac text field (Emacs style: ⌃A line start, ⌃E line end, ⌃K delete to end…). The handler prevents the default in text fields, so they would break editing in the composer;
  - on Windows and Linux, Ctrl+Shift+U (Unicode input) and Ctrl+Shift+E (emoji input) of IBus on Linux;
  - Ctrl/⌘+Shift+S, reserved for Schedules (PR #560), like Ctrl/⌘+Shift+H for Previous sessions. A unit test reads the global keydown handler in `app.js` and checks that every Ctrl/⌘ shortcut it handles is refused.
- **FR-017 (amended)** Keys are matched by position (`code`), and the typed letter (`key`) counts too, the way the app's other shortcuts match (`e.key==='k'||e.code==='KeyK'`): recording refuses a combination when either its position or the letter it types on this keyboard layout is taken (with Dvorak, Ctrl and the key labelled C is the position of I: it is refused as Copy). At use, a press whose typed letter belongs to another shortcut is left to that shortcut, so another layout never takes Copy or Paste away.
- **FR-016 (amended)** When a level has no items, the reason ("No chat 7 here…", "No matches.", "Nothing to go to yet…") is in the polite announcement itself, not only "0 results". The empty text in the list has no role of its own (a `status` inside a `listbox` is not a valid child).
- `sim:` `shots-074-navigator` sets a hostile agent name (`<img src=x onerror=…>"'&<b>bold</b>`, through `window.__durbarSimUi`) and asserts that Go to shows it as literal text, with no element created inside `#palDlg` and nothing run; it asserts that every desk card's badge sits on its scene clear of the name, that `c 99` announces "Chats: No chat 99 here…", and that no `role="status"` is inside the listbox.
- `test:` `test-navigator`: the 14 Mac Control text keys with and without Shift (and ⌃G, ⌃J, ⌃⌘E allowed), Ctrl+Shift+U / E, Ctrl/⌘+Shift+S, a Dvorak press (position I typing "c": recorded with its letter, refused as Copy, and not matched at use), Mac Dvorak ⌘ at J typing H left to Hide, and a scan of `app.js`'s global keydown handler: every Ctrl/⌘ shortcut it handles is refused.
- Mutation check: each of these edits fails a check, and the files were restored: dropping `mod+shift+KeyS`, the Mac text-key rule, either IBus entry, the typed-letter clash, the typed-letter guard at use, recording the typed letter, `mod+shift+KeyH` or `mod+KeyO` (`test:navigator`); putting the badge back in the name row in card density, dropping `esc()` on the palette label, and announcing only "0 results" (`shots-074-navigator`).
- `[KNOWN GAP]` Windows fonts were not run here (Linux, DejaVu); the badge no longer shares the name row in any card density, so the name has the same room it had before spec 074. Windows CI (`shots-074-navigator`, `check:office`) is the check. A Mac Dvorak user cannot use ⌘J as Go to (macOS reads it as ⌘H, Hide) and picks another key in Settings.

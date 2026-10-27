# Feature Specification: Floors as places

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Floors as places (issue #782): each floor that is on is one whole screen of a vertical building; a lift button panel slides the view to another floor (about 300 ms, instant with reduced motion); attention from other floors shows on the lift buttons; PageUp/PageDown and jump-to-floor from the inbox and notifications
status: **in progress** 2026-10-27: phase 1 (floor screens, PageUp/PageDown, instant) built on `092-floor-screens`; the lift panel, badges, slide and jumps (phases 2-4) are not built; owner answers Q1-Q7 of issue #782 and Q-A, Q-B (both a) recorded
-->

**Feature Branch**: spec on `033-floors-as-places`; the code branches are named `092-...` per phase (amends 033 floors FR-011 and FR-012; uses 024 shared lobby, 001 office layout, 052 inbox and notifications, 074 keyboard navigator)

**Created**: 2026-10-27

**Status**: In progress. Phase 1 (floor screens: FR-001, FR-002, FR-004, FR-005, FR-020..FR-023, FR-025 in part) is built, with PageUp/PageDown as the only way to change floor and no slide; phases 2-4 are not built.

**Input**: Issue #782 (asked 2026-10-26): "Floors as places: each floor one screen of a larger building, a lift button panel that slides to another floor." The owner (Paco) answered all seven questions on the issue (recorded under *Clarifications*).

## Why a new spec and not a delta to 033

Spec 033 says what a floor *is* (a named group of rooms you switch on and off) and that is unchanged: names, order, on/off, Move to floor, Settings > Floors, the saved file and the IPC are all reused as they are. This spec adds a different thing: a **navigation model** (one floor per screen, a lift, a slide, keys, a jump) with its own layout rule, accessibility and motion rules, checks and five phases. As a delta it would bury 033's 24 requirements under a second feature. So it is a new spec, number **092** (next free: `specs/` on `origin/main` ends at 091; no remote branch has a number above 091; the only open PR is #710 on `054-codex-mobile-research`; checked 2026-10-27). Spec 033 gets a short cross-reference under its `## Changes` for the two requirements this spec changes (FR-011, FR-012).

## Context: what exists today

- Floors (spec 033, built): `FLOORS={floors:[{id,name,on,ground}],lastFloor,byAgent}` in `src/renderer/app.js`; `floorOn`, `roomShown`, `floorsOnList`, `roomsInOrder` (floor order first), `floorTag` (the small floor name in a room header, only with two or more floors on). `applyFloors`/`afterFloorsChange` re-render everything when the state changes. The top-bar **Floors n/m** button and panel (`renderFloorsBtn`, `renderFloorsPanel`) and Settings > Floors (`renderFloorsSettings`) switch floors on and off and manage them. The data and IPC are in `src/shared/floors.ts`, `src/main/folders.ts` and the `floors:*` channels (spec 033 contracts).
- **Today every floor that is on is drawn on one single screen**: `renderOffice()` (`app.js`) builds one `officeModel()` from all rooms that are shown, `chooseLayout()` picks one density for all of them and `stageParts()` writes the rooms in floor order with floor tags. The 15-agent rule (spec 001) is therefore shared by all floors that are on: more floors on means poorer density (033 FR-011).
- Attention from a floor that is **off** is plain text on its row in the Floors panel and Settings (033 FR-010, `offFloorAttention`, `app.js`). Attention from a floor that is **on** is simply visible in the one office.
- Status pills count every agent that is shown (floors on); the office usage total counts every floor (033 FR-008, FR-016).
- The shared lobby (spec 024 FR-020, 033 FR-020) is part of the office stage: one lobby for all floors that are on, `lobbyOn()` (`app.js`), tiles from `lobbyPlaces()`, visitors filtered by `roomShown`.
- Opening an agent: `openPanel(id,focus)` (`app.js`) shows the chat over the office (`body.panel-open` hides `#stage-host`); the inbox's *Open* and *Answer in chat* call it; an OS notification opens the inbox on its agent's row (`openInbox(id)`). The keyboard navigator (spec 074, `src/renderer/navigator.js`) already lists floors and folders by floor, but picking a floor only narrows the folder list.
- Screen-reader announcements go through `announce(text)` (`app.js`, `#srAnnounce`). Reduced motion: `reducedMotion()` (`app.js`; the module constant `REDUCED` is read once) and the shared `motion(el, frames, opts)` helper.
- There is no PageUp/PageDown handling in the office (only the composer height uses them, `composersize.js`).
- Not verified by running code: the exact cost of `chooseLayout()` per floor with 15 agents (033 SC-003 shows the whole switch is about 135 ms today).

## Clarifications

### Session 2026-10-26 (Paco, owner, on issue #782)

- Q1: Which direction? -> A: **Vertical**: floors stack like a building and the view slides up and down.
- Q2: Do floors keep switching on and off? -> A: **Yes.** The lift skips floors that are off.
- Q3: Do the lift buttons show attention from other floors? -> A: **Yes**: waiting, error, limit and a New reply, so nothing that needs you is missed.
- Q4: Lobby? -> A: **Shared**: one lobby for all floors that are on (as spec 024 FR-020 and 033 FR-020 today).
- Q5: Do the status pills count the current floor or the whole building? -> A: **The whole building**, as today.
- Q6: Keyboard and jumping? -> A: **PageUp and PageDown** move between floors. **Opening an agent from the inbox or a notification slides the view to its floor.**
- Q7: Motion? -> A: A short, calm slide of **about 300 ms**; **instant with reduced motion**.

### Session 2026-10-27 (Paco, owner, in the terminal with his agent)

- Q-A: Which end is the top of the building? -> A: **(a) Floor-list order, top to bottom**: the first floor in the Floors panel is at the top; PageUp goes to the floor above it in the list.
- Q-B: How are lift buttons labelled? -> A: **(a) The floor's position number** (1, 2, 3), the full name in the tooltip and accessible name; the floor name is already on screen as the floor tag in room headers (033 FR-012).

### Design choices that follow from the answers (no new product decision)

- **D1, the lobby is drawn on every floor screen.** Q4 says one shared lobby. It is one set of places and one set of visitors (all floors that are on); each floor screen draws it at the same place, so the layout rules of specs 001/024 are reused unchanged. **Why the lobby slides with the rooms and is not kept still like the lift:** spec 024 puts the lobby in the middle of the office stage, between the rooms, so it is part of each floor's layout and height budget (it was measured to cost a density step); keeping it still would mean splitting it out of the stage, a second layout path for the lobby and for the walkers that cross between desks and tiles. Because the content is identical on both floors, the slide shows it leaving and arriving; that is the accepted look (`[KNOWN GAP]`: judged by hand, FR-009). Visitors from another floor sit in the tile without a walk (FR-021).
- **D2, only floors that are on have a screen.** Off floors have no screen and no lift button; their attention stays plain text in the Floors panel and Settings (033 FR-010, unchanged).
- **D3, the first floor of the list is the top of the building; PageUp goes up.** *(Owner, Paco, 2026-10-27: Q-A = a.)* Q-B = a: buttons carry the position number.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See one floor at a time at a readable size (Priority: P1)

Mia has three floors on (Ground floor, Client A, Client B) and 15 agents spread over them. Today all three floors share one office and the desks get small. With this feature the office shows **one floor, the whole screen**: only that floor's rooms, at the best density for those agents. The other floors are one lift button away.

**Why this priority**: it is the point of the issue and the only part that changes how the office looks.

**Independent Test**: simulator with `DURBAR_SIM=15` and `DURBAR_SIM_FLOORS=1` (several floors on): the office shows only the current floor's rooms; `check:office` passes for each floor at 1440x900 and 1280x800.

**Acceptance Scenarios**:

1. **Given** two or more floors are on, **When** I open the office, **Then** I see exactly one floor's rooms (plus the shared lobby), a lift panel with one button per floor that is on, and no other floor's desks.
2. **Given** I click the button of another floor, **When** the slide ends, **Then** that floor fills the screen, its button is marked as the current floor (a state a screen reader reads, and a shape cue, not colour only) and focus stays on the button I used.
3. **Given** only one floor is on, **Then** the office is exactly as before this feature: no lift panel, no slide, no change in layout or density.
4. **Given** a floor holds a single room with 3 agents, **Then** the room is laid out as in spec 001 for that many agents on the whole screen, not squeezed to share the screen with other floors.

### User Story 2 - Notice what needs me on another floor (Priority: P1)

Mia is on Client A. An agent on Client B asks for approval. The Client B lift button shows a small badge with a count and a word cue ("1 waiting"). She presses it and lands in the room that needs her. When an agent on Ground floor finishes and has a New reply, that floor's button shows it too.

**Why this priority**: Q3. Without it, one floor per screen would hide the work that needs the user, which the calm-UI rule and the inbox work (spec 052) exist to prevent.

**Independent Test**: simulator: make an agent of floor B wait; the lift button for B shows the badge within one render; clearing the wait clears the badge.

**Acceptance Scenarios**:

1. **Given** I am on floor A and an agent of floor B waits for approval, **Then** B's lift button shows a badge, its accessible name says "Client B, floor 3 of 3: 1 waiting" and its tooltip lists the kinds (waiting, error, limit reached, new reply) with counts.
2. **Given** floor B has one waiting and one error, **Then** the badge counts agents that need me (each agent once) and the tooltip separates the kinds.
3. **Given** I am on floor B, **Then** B's own button shows no badge (the office already shows it); the other floors do.
4. **Given** the attention is answered or the agent finishes, **Then** the badge goes away without a reload.
5. **Given** a floor is off, **Then** it has no lift button and its attention stays plain text in the Floors panel and Settings (033 FR-010).

### User Story 3 - Move between floors with the keyboard (Priority: P1)

Mia presses **PageDown** and the view slides to the next floor that is on; **PageUp** goes back. At the last floor PageDown does nothing (no wrap), and a screen reader says which floor is now shown.

**Why this priority**: Q6, and accessibility: a slide that only the mouse can start would be a regression for keyboard users.

**Independent Test**: unit test of the key rule; simulator driver presses PageDown/PageUp with focus on the office and with focus in the composer.

**Acceptance Scenarios**:

1. **Given** the office is shown and focus is not in a text field, select, dialog or menu, **When** I press PageDown (PageUp), **Then** the view moves to the next (previous) floor that is on, skipping floors that are off.
2. **Given** I am on the last (first) floor, **When** I press PageDown (PageUp), **Then** nothing happens and nothing is announced.
3. **Given** focus is in a text box, the composer, a select or an open dialog, menu or palette, **When** I press PageUp/PageDown, **Then** the key keeps its own meaning there and the floor does not change.
4. **Given** a floor change by any means, **Then** a screen reader hears "Floor Client B, 2 of 3" once, and the lift button of the new floor is `aria-current`.
5. **Given** the lift panel has focus, **Then** Up/Down arrows move between its buttons, Enter/Space go to the floor, Tab leaves the panel (a toolbar with one tab stop).

### User Story 4 - Opening an agent takes me to its floor (Priority: P2)

Mia opens an agent from the inbox or from an OS notification. The chat opens; when she goes **Back to the office** she is on that agent's floor, with its room in view. Picking a floor, folder or chat in the keyboard navigator does the same.

**Why this priority**: Q6. It keeps "where am I" true; the office behind the chat must match the agent she just worked with.

**Independent Test**: simulator: agent on floor C waits; with the office on floor A, open it from the inbox, press Back: the office shows floor C.

**Acceptance Scenarios**:

1. **Given** I am on floor A, **When** I open an agent of floor B from the inbox (*Open* or *Answer in chat*), a notification, the navigator, the list view or the chat strip, **Then** the current floor becomes B (no slide is drawn while the chat covers the office) and **Back to the office** shows floor B.
2. **Given** I am in the office on floor A, **When** I pick floor B in the navigator, or a folder filter that is on B, **Then** the view slides to B (instant with reduced motion).
3. **Given** the agent's floor is off, **Then** the current floor does not change (the agent is not reachable from the office: 033 FR-008, unchanged).
4. **Given** the agent is already on the current floor, **Then** there is no slide and no announcement.

### User Story 5 - Calm motion (Priority: P2)

The slide is short and soft. It never blocks input and never hides a waiting agent: a badge already shows what needs me while it runs.

**Acceptance Scenarios**:

1. **Given** normal motion, **When** I change floor, **Then** the view slides vertically for about 300 ms with an ease-in-out curve, the lift panel stays still, and I can press another lift button while it runs (the slide retargets from where it is, without a jump).
2. **Given** the system setting *reduce motion*, **When** I change floor, **Then** the new floor appears at once with no animation; announcements and badges are unchanged.
3. **Given** the window is resized or a floor's layout changes during a slide, **Then** the slide ends at once and the final position is right.

## Edge Cases

- **One floor only, or only one floor on**: no lift panel, no slide, no PageUp/PageDown effect (FR-004). The Floors button (033 FR-007) keeps its own rule.
- **All floors off**: the existing empty-state message of 033 FR-013; no lift. Switching a floor on shows it directly (no slide).
- **A floor with 0 agents (or 0 folders) that is on**: it has a screen and a lift button; the screen shows a short empty-state line naming the floor ("Nothing on Client B yet. Move a folder here from its ... menu.") and the shared lobby. The lift does not skip it (only off floors are skipped).
- **The current floor is switched off, deleted or removed**: the view moves at once (no slide) to the nearest floor that is on (the next, else the previous) and says so (FR-012). An open chat is unaffected (033's `afterFloorsChange` already closes it only when its own floor is off).
- **Another floor is switched on**: the current floor stays; a button appears. **Only** on a floor (033 FR-022) makes that floor the only one on and current; no lift remains.
- **An agent's folder moves to another floor** (033 FR-005, FR-024): if it was on the current floor, the room leaves the screen, and the empty-state line shows if the floor is now empty. The user is not moved. If the agent needed attention, the destination button shows the badge. (The lift ride of #553 is out of scope.)
- **A floor is created, or the order changes** (033): the user stays where they are; the lift order follows 033's order at once and the current floor stays current.
- **Window resize**: each screen is exactly the office area high; positions are recomputed without animation (FR-009).
- **Many floors**: the lift panel scrolls inside itself past the available height (033 allows many floors); the current button is kept in view and pinned edge rows summarize badges out of view (FR-028); the office never scrolls because of it.
- **Floor names that look alike or are very long**: buttons show the position number; the full name is in the tooltip and the accessible name (Q-B).
- **Filters**: the status-pill filter and folder filter apply inside the current floor; the pills' counts stay whole-building (Q5). A folder filter set to a room on another floor slides to that floor (US4). A pill whose matches are all on other floors takes the user to them (FR-027); a floor with no match shows the line and button of FR-027, never a bare empty screen.
- **Hidden folders (spec 006)**: a floor whose rooms are all hidden is empty; it keeps its button.
- **Rooms with a closed door (spec 017)**: unchanged, per floor. A closed room that is waiting keeps its highlight and counts in the badge.
- **List view and the chat strip**: unchanged. The list shows every floor that is on, as today, and is not paged by floor. The lift is part of the office view only.
- **Settings, Tools, MCP screens**: not floors-aware (033 assumption, unchanged).
- **Lobby visitors**: a visitor from another floor shows in the tile with the floor named in its label; no walk is drawn for it (FR-021).
- **Walkers mid-walk when the floor changes**: the walk is not drawn off screen; on arrival figures are placed at their place without a long re-walk (spec 024 layout-change rule).
- **First start / restart**: the current floor is restored from a local display preference if that floor is still on; otherwise the first floor that is on.
- **Scrolling floor screen**: PageUp/PageDown scroll it first and change floor only from an edge (FR-011).
- **VS Code**: a `.code-workspace` file is one room on one floor (033 assumption), so it is on one screen. The read-only VS Code chat-history view (spec 009, *Open in VS Code, VS Code chat history*) is not part of the office and is not floored (reading confirmed by the reviewer of PR #801).
- **Demo mode and an older bridge without floors** (`floorsLive()` false): one floor, no lift.
- **Themes** (specs 035-040): the lift panel uses semantic tokens only; no theme-specific size (`test:theme`).

## Requirements *(mandatory)*

### Functional Requirements

**Floor screens and layout**

- **FR-001**: With **two or more floors on**, the office MUST show exactly one **floor screen** at a time: the rooms of the current floor (`roomShown` and floor equal to current), the shared lobby, and nothing from other floors. With zero or one floor on the office is unchanged (FR-004). `[IMPLEMENTED]` (phase 1) test: `test:floornav`; sim: `shots-092`, `check:office` floor screens.
- **FR-002**: The office density (spec 001) MUST be chosen **per floor screen** from that floor's agents (and the lobby), not from all floors on. This replaces 033 FR-011 ("from the agents of floors that are on only") when two or more floors are on: the 15-agent legibility rule holds **on each floor**, at 1440x900 and 1280x800, with 15 agents on one floor and with 15 spread over several floors. `[IMPLEMENTED]` (phase 1) sim: `check:office` floor screens compare each floor's density with the same agents as the whole office, at 1440x900 and 1280x800 (15 spread and 15 on one floor).
- **FR-003**: The floors that are on are one vertical building in floor order (033 order, Up/Down), each as high as the office area. Only the current floor and, during a slide, the floor it slides to are in the DOM and the tab order; other floors are not rendered (no hidden focusable controls, no layout cost for floors out of sight). `[IMPLEMENTED]` in part (phase 1): only the current floor is rendered; the second floor during a slide comes with the slide (phase 3).
- **FR-004**: With **one floor on** (or none, or no floors support) there MUST be no lift panel, no slide, no PageUp/PageDown behaviour and no floor tags, and the office MUST look and measure as before (existing `check:office` cases unchanged). `[IMPLEMENTED]` (phase 1) sim: `shots-092` (one floor on), the unchanged single-floor `check:office` cases.
- **FR-005**: The floor tag in room headers (033 FR-012) stays as the on-screen floor name, shown when two or more floors are on, and gives way first when a name would be squeezed (spec 001 FR-179, unchanged). Rooms are no longer interleaved across floors because only one floor is drawn. 033 FR-012's "order rooms by floor" stays true inside the building. `[IMPLEMENTED]` (phase 1) sim: `check:office` (floor tag on every header of every floor screen).

**The lift panel**

- **FR-006**: With two or more floors on, a **lift panel** MUST sit at the right edge of the office area, in the office view only: a vertical `role="toolbar"` (`aria-label="Floors"`, `aria-orientation="vertical"`) with one button per floor that is on, in floor order from top to bottom (Q-A), each at least 28x28 px, text at least 10.5 px, with the floor's position number as its visible label (Q-B). The panel is not part of the sliding content: it stays still while floors slide.
- **FR-007**: Each button MUST have the accessible name "<floor name>, floor <n> of <m>" plus the attention words of FR-015 when present, a tooltip with the full floor name, and `aria-current="true"` on the current floor. The current floor is also shown with a shape or weight cue, not only colour.
- **FR-008**: The lift panel reserves its width only while it is shown (two or more floors on), and that width MUST be counted in the layout so the 15-agent rule and `check:office` hold with it. *[KNOWN GAP until measured: how much density the width costs at 1280x800; target at most one density step with 15 agents on one floor and none with 6.]*

**Sliding and keys**

- **FR-009**: Choosing a floor (lift button, keyboard, navigator, filter, jump) MUST slide the office vertically to it in **about 300 ms** (280-320 ms) with a calm ease-in-out, using the shared `motion()` helper and only `transform` and `opacity` (no layout work inside the slide). It MUST NOT block input; a second request during a slide retargets from the current position. A resize, a relayout or a theme change during a slide ends it at once at the right position.
- **FR-010**: With `prefers-reduced-motion: reduce` (read live through `reducedMotion()`, not once at start) the change MUST be instant: no slide, no fade.
- **FR-011**: PageDown MUST go to the next floor that is on and PageUp to the previous one, in the office view, when the key has no modifier and is not typed into a text field, textarea, select, contenteditable, an open dialog, menu or palette. **When the floor screen itself scrolls** (`#floor.scrolls`, spec 001: a floor with more agents than fit at the poorest density), the browser's scrolling wins first: PageDown/PageUp scroll the screen, and change the floor only when the screen is already at the bottom/top edge before the key is pressed (a press that scrolls to the edge does not also change floor). `keyEligible` takes the scroll position as an input. At the first or last floor nothing happens and nothing is announced. The keys are listed in the keyboard help table in `app.js` (as spec 052 FR-084 lists others), with the note that on a Mac laptop they are Fn+Up / Fn+Down. The navigator (spec 074) is unchanged except FR-019. `[IMPLEMENTED]` in part (phase 1): the keys, the eligibility rule and the scroll rule (`test:floornav`, `shots-092` incl. T038); the shortcut-sheet rows are phase 4 (T032). **Changed 2026-10-27 (phase 1):** see *Changes*: the page scrolls the screen itself.
- **FR-012**: Every floor change that the office shows MUST be announced once through `announce()` as "Floor <name>, <n> of <m>", whether made with a button, a key, a navigator choice, or by the app (FR-023). A jump made while a chat covers the office (FR-018) is **not** announced then, so it does not compete with the chat taking focus; it is announced once when the user returns with *Back to the office* and the floor differs from the one last shown. No announcement when the floor does not change. `[IMPLEMENTED]` in part (phase 1): one announcement per change through `announce()` (`shots-092`, text only); the jump under a chat and *Back to the office* is phase 4 (T042).
- **FR-013**: The lift buttons MUST be one tab stop (roving tabindex); Up/Down move between buttons, Home/End go to the first/last, Enter/Space select. Focus stays on the button after the slide and is not moved into the office.

**Attention on the lift**

- **FR-014**: A lift button of a floor that is **not** the current floor MUST show a **badge** when any agent (a main agent, as `needsMe()` counts it: helpers are not counted by the inbox or the pills) on that floor needs the user: waiting for approval or a question, error, credit or rate limit reached (coffee-break state, spec 068), or a New reply (unread state, spec 052). It reuses the predicate of the inbox and the pills (`needsMe()`, and the unread marker `DurbarUnread`), not a new attention model, and counts per floor of the agent's room. **Hidden folders:** `needsMeOrder()` lists every agent with no `roomShown` filter, so the inbox counts agents of hidden folders today; the badge follows the inbox (floors that are on, hidden folders included) so the badge and the inbox agree, and its tooltip adds "(in a hidden folder)" when every counted agent is in one. *[unverified: whether the Waiting pill counts hidden folders; task T040 checks it and, if it differs, this rule is restated with the measured fact rather than guessed.]* **New reply:** it follows spec 001's unread marker exactly (the one of #774): set when the agent finishes with an unseen reply, cleared only when that chat is shown or by *Mark as read*, not kept across a restart; so the badge's New clears at the same moment as the inbox's New and the desk's own mark.
- **FR-015**: The badge MUST be readable without colour: a count (each agent once; `9+` past nine) and the words in the tooltip and accessible name ("2 waiting, 1 error, 1 new reply"). It MUST NOT use sound, toast or OS-notification paths (spec 052, unchanged) and MUST NOT reorder buttons.
- **FR-016**: The current floor's button MUST NOT show a badge. A floor that is off has no button (033 FR-010 text stays its only signal).
- **FR-017**: Status pills (Working, Waiting, Idle, Errors, Done), the inbox count, the window-title count and the office usage total MUST keep counting the **whole building** (floors on), exactly as today (Q5). A status-pill filter filters the screen of the current floor; its counts do not change with the current floor. **A filter never hides what it counts (FR-027).**

**Jumping**

- **FR-018**: Opening an agent by any route (inbox *Open* / *Answer in chat* / `openPanel`, an OS notification via the inbox, the navigator, the list view, the chat strip, the folder filter) MUST set the current floor to the agent's floor if that floor is on, **before** the chat shows, so Back to the office shows that floor; no slide is drawn while the chat covers the office. One function `goToFloor(id, {animate})` does it; `openPanel()` (`app.js`) and the navigator call it.
- **FR-019**: Choosing a **floor** row in the navigator (spec 074) still steps down to that floor's folders with the palette open, as today; the office does **not** move behind the palette. When the palette closes after a floor was entered (Esc included), the office slides to the last floor entered; choosing a folder or chat goes to its floor first (FR-018) and the chat then opens. Reason: moving the page behind an open palette is motion the user is not looking at and would be announced over the palette's own announcements.

**Lobby and the building**

- **FR-020**: The shared lobby (Q4; spec 024 FR-020, 033 FR-020) MUST be drawn on every floor screen at the same place with the same tiles and visitors (agents of **all** floors that are on, never of a floor that is off). Places keep their rules (`+N`, custom places, busy state). `[IMPLEMENTED]` (phase 1) sim: `shots-092` (the same visitors on every floor screen).
- **FR-021**: A visitor whose agent is on a floor other than the current one MUST be shown in the tile without a walk, with its floor named in the tile label ("Terminal: Dana (Client B)"). An agent of the current floor walks as in spec 024. A walk is never drawn across a floor change. `[IMPLEMENTED]` (phase 1) sim: `shots-092` (label names the floor, no walk, no walk across a floor change).

**Persistence, data and safety**

- **FR-022**: The current floor is a display preference of this window (like the detail level): its id in `localStorage`, restored at start if that floor is on, otherwise the first floor that is on. No change to the saved floors file, no IPC, no main-process change, no secrets (033 FR-014/FR-015 unchanged). `[IMPLEMENTED]` (phase 1) sim: `shots-092` (reload, a saved floor that is off).
- **FR-023**: When the current floor is switched off, deleted or stops existing, the view MUST move to the nearest floor that is on (next, else previous) without a slide, announced by FR-012. Switching a floor on, creating one, reordering and moving a folder MUST NOT move the user; **Only** (033 FR-022) makes the chosen floor current. `[IMPLEMENTED]` (phase 1) test: `test:floornav` (nearest floor, a deleted floor); sim: `shots-092` (off, on, Show only, a floor skipped).
- **FR-024** (checked in every phase PR, T037 and the phase tasks): Adapters, permission modes, sessions, approvals and credit caps MUST NOT change. Floors and the lift are renderer-only; nothing Copilot-specific is added (constitution II). `[IMPLEMENTED]` for phase 1: the diff changes no adapter, permission, IPC, preload, saved file or `src/shared` code; the one stored value is the `durbar.floor` key in `localStorage` (checked by `test:floornav`).

- **FR-027**: **Clicking a status pill goes to where its agents are.** When the pill's matches exist on the current floor, nothing moves. When **all** matches are on other floors, the office goes to the floor of the first match in `needsMeOrder()` order (oldest first) and announces the floor (FR-012). The pill filter then stays on while the user changes floors; a floor with no match shows a line "No <status> agents on this floor" with the building-wide count and a *Next floor with <status>* button, never an empty screen. Reason for choosing the jump and not only a message: the click is an explicit request to see those agents, so one click should end on them, and the same two controls (line and button) cover the case after a floor change.
- **FR-028**: **No badge is hidden by the panel's own scrolling.** When the lift panel scrolls (more floors than fit), a badged button outside the visible part is summarized at the panel's top or bottom edge as a pinned row "▲ 1 waiting" / "▼ 2 waiting" (count of badged agents above/below, same words as FR-015); activating it scrolls the nearest badged floor into view and focuses its button. The current button is also kept in view. No limit on the number of floors is introduced by this.
- **FR-029**: **Changes to other specs.** Each spec this one changes gets a dated line under its `## Changes` (done with this spec, T001): 024 (lobby drawn on every floor screen, visitors of other floors without a walk and with the floor in the tile label), 001 (the lift's width comes out of the office area; density and `check:office` work per floor screen), 074 (activating a floor row moves the office), 052 (shortcut sheet rows; inbox *Open* sets the floor). When a phase is built, each line is updated to say so.
- **FR-030**: **Reuse before adding.** The slide is built on `motion()` and `reducedMotion()`; `swapView()` (spec 052 FR-070, the theme cross-fade) is **not** used, for these reasons: a view transition snapshots and cross-fades the whole page, so the lift panel, top bar and focus ring would need `view-transition-name` handling to stay still; starting a second transition skips the first, so FR-009's retarget from the current position is impossible; and its updates are all-or-nothing DOM swaps, whereas a slide needs two mounted floors. `swapView` stays the right tool for the theme change only. (Phase 3 may revisit this with a measured spike; any change is recorded here.)

**Tests and docs**

- **FR-025**: A pure module `src/renderer/floornav.js` (no DOM; same pattern as `places.js`) MUST hold the rules (next/previous floor that is on, nearest floor after a change, key eligibility, badge counts, announcement text) with a Node test `scripts/test-floornav.ts`. A simulator driver `scripts/shots-092.js` MUST cover the scenarios; `check:office` MUST be extended for floor screens (FR-002) at both sizes. `[IMPLEMENTED]` in part (phase 1): `floornav.js` with `test:floornav` (floor and key rules, announcement text; badge counts and edge summary come with phase 2), `shots-092.js` phase-1 cases, `check:office` floor screens.
- **FR-026**: Docs are part of the change: README floors text and screenshots (the lift changes the office picture), `docs/` floors pages if any, the keyboard help table, a `changelog.d/` fragment, 033's `## Changes` cross-reference, and `npm run shots:docs` for every linked picture that shows the office.

### Key Entities

- **Floor screen**: the office content of one floor that is on: its rooms and the shared lobby, laid out for the full office area.
- **Lift panel**: the vertical toolbar of buttons, one per floor that is on, with attention badges.
- **Current floor**: a renderer-only id; always a floor that is on while two or more are on.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With 15 simulated agents on one floor, and with 15 spread over two or three floors, each floor screen passes `check:office` (no overlap, no clipped text, no scrolling of the office, no text under 10.5 px) at 1440x900 and 1280x800 (FR-002, FR-008).
- **SC-002**: A user reaches a floor with a waiting agent through its badge in under 5 seconds without documentation (tried by the owners by hand).
- **SC-003**: The slide itself takes 280-320 ms (read from the animation's own timing, not a wall-clock guess), and in one frame with reduced motion. The cost of the switch (layout and render of the target floor, without the slide) is checked like 033 SC-003 after #454: as a ratio to a same-run yardstick, below the ratio 033 uses (named in `scripts/shots-092.js` when T026 is done), never a fixed millisecond limit on a loaded machine.
- **SC-004**: 100% of badges match the agents that need the user on other floors in the simulator checks (no missed waiting/error/limit/new-reply agent, no badge on the current floor, none for an off floor).
- **SC-005**: PageUp/PageDown change the floor in 100% of office-view cases outside text fields and never inside them; a screen reader gets exactly one announcement per change.
- **SC-006**: With one floor on, `check:office` results and screenshots are identical to before this feature (no regression for the single-floor user).
- **SC-007**: Opening an agent of another floor from the inbox, a notification or the navigator and going Back shows that agent's floor in 100% of simulator cases.

## Assumptions

- Floor management (create, rename, reorder, delete, on/off, Move to floor, Settings > Floors, saved data, IPC) is spec 033 and unchanged.
- If even the best density does not fit one floor's agents, the existing scroll behaviour of spec 001 (`#floor.scrolls`) applies to that screen, per floor.
- #553 (agents ride the lift) and #555 (special floors) are **out of scope** and not blocked: a floor screen is a clean place to hang a per-floor scene, and the lift panel is where a future indicator or ding would go. Nothing here assumes them.
- Verification is on the simulator and with unit tests, 0 AI credits.
- Windows, macOS and Linux behave the same; PageUp/PageDown exist on all three (Fn+Up/Down on a Mac laptop). *[unverified on a real Mac or Windows keyboard.]*

## Changes

### 2026-10-27, phase 1 (floor screens; branch `092-floor-screens`)

- **FR-011, the scroll rule: the page scrolls the screen, not the browser.** Measured in the simulator: with the focus on the page body Chromium does not scroll `#floor` on PageDown (the office area is not the page's scroller), so "the browser's scrolling wins first" would leave a floor screen that scrolls stuck. The key handler therefore scrolls `#floor` itself by 87.5% of its height (the browser's page step) while the screen is not at the edge in the key's direction, and changes floor only when it was already at the edge before the press (`floornav.keyAction`: `{scroll}` or `{go}`). The rule the user sees is unchanged; `read:` + `sim:` (`shots-092` T038 scrolls a 1100x430 screen with 15 agents to its bottom, then PageDown changes floor).
- **FR-011, a held key never changes floor** (`e.repeat` is ignored by the rule), so a long press does not rush through the building. Arriving by PageUp lands at the bottom edge of the floor above (by PageDown at the top), so the next PageUp scrolls up through that floor first.
- **Close all / Open all** (the door bar) and its enabled state apply to the rooms of the floor screen shown, not to rooms the user cannot see.
- **A floor screen with a filter that matches nothing** shows "Nothing on <floor> matches the current filter." and the lobby (never a bare empty screen); the pill-filter jump and the *Next floor with <status>* button stay phase 4 (FR-027).
- **Simulator:** `simfloors=1` (`DURBAR_SIM_FLOORS=1`) already spread the folders over three floors; `simfloors=ground` (`DURBAR_SIM_FLOORS=ground`) keeps every folder on the Ground floor with the other two floors on and empty (T010).
- **Existing drivers changed because the office now shows one floor:** `shots-033`, `shots-033-move`, `shots-074-navigator` walk the floor screens (`H.eachFloor`, `H.goToFloor`, PageDown) instead of reading the whole building from one screen; `check-ui-text` uses `simfloors=ground` (three floors on, every agent on the first, so its agent-by-name lookups still find desks); `shots-074-navigator`'s badge-on-scene rule only requires the badge to stay clear of the name on a grown desk (a floor screen with few agents gets grown desks).

## Known gaps (honest limits)

- `[KNOWN GAP]` Phase 1 only is built. The lift panel, badges, slide and jumps are not; the width cost of the lift panel on density (FR-008) is a target, not a result. Until phase 2 the feature is usable by keyboard only (PageUp/PageDown), and `Back to the office` after opening an agent of another floor shows the floor that was current, not the agent's (phase 4).
- `[KNOWN GAP]` The feel of the slide (300 ms, ease) can only be judged by hand in a real window; the simulator checks the duration, not the feel.
- `[KNOWN GAP]` Not tried on a real Mac or Windows machine, nor with a screen reader (announcements are verified only as text sent to `#srAnnounce`).
- `[KNOWN GAP]` The Waiting pill's treatment of hidden folders is not verified (FR-014, T040).
- `[KNOWN GAP]` A floor holding more agents than fit even at the poorest density scrolls, as the office does today.
- Out of scope: #553, #555, per-floor lobbies, horizontal paging, changing what floors group or how they are saved.

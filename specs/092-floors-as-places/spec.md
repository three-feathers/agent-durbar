# Feature Specification: Floors as places

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Floors as places (issue #782): each floor that is on is one whole screen of a vertical building; a lift button panel slides the view to another floor (about 300 ms, instant with reduced motion); attention from other floors shows on the lift buttons; PageUp/PageDown and jump-to-floor from the inbox and notifications
status: **draft** 2026-10-27: spec, plan and tasks written, no code yet; owner answers Q1-Q7 of issue #782 recorded below; Q-A and Q-B answered by the owner 2026-10-27 (both option a)
-->

**Feature Branch**: spec on `033-floors-as-places`; the code branches are named `092-...` per phase (amends 033 floors FR-011 and FR-012; uses 024 shared lobby, 001 office layout, 052 inbox and notifications, 074 keyboard navigator)

**Created**: 2026-10-27

**Status**: Draft. Spec, plan and tasks only; no `src/` change yet.

**Input**: Issue #782 (asked 2026-10-26): "Floors as places: each floor one screen of a larger building, a lift button panel that slides to another floor." The owner (Paco) answered all seven questions on the issue (recorded under *Clarifications*).

## Why a new spec and not a delta to 033

Spec 033 says what a floor *is* (a named group of rooms you switch on and off) and that is unchanged: names, order, on/off, Move to floor, Settings > Floors, the saved file and the IPC are all reused as they are. This spec adds a different thing: a **navigation model** (one floor per screen, a lift, a slide, keys, a jump) with its own layout rule, accessibility and motion rules, checks and four phases. As a delta it would bury 033's 24 requirements under a second feature. So it is a new spec, number **092** (next free: `specs/` on `origin/main` ends at 091; no remote branch has a number above 091; the only open PR is #710 on `054-codex-mobile-research`; checked 2026-10-27). Spec 033 gets a short cross-reference under its `## Changes` for the two requirements this spec changes (FR-011, FR-012).

## Context: what exists today

- Floors (spec 033, built): `FLOORS={floors:[{id,name,on,ground}],lastFloor,byAgent}` in `src/renderer/app.js:141`; `floorOn`, `roomShown` (`:144-145`), `floorsOnList` (`:146`), `roomsInOrder` (floor order first, `:150`), `floorTag` (the small floor name in a room header, only with two or more floors on, `:147`, `:151`). `applyFloors`/`afterFloorsChange` (`:3881-3893`) re-render everything when the state changes. The top-bar **Floors n/m** button and panel (`renderFloorsBtn`, `renderFloorsPanel`, `:3899-3975`) and Settings > Floors (`renderFloorsSettings`, `:3976`) switch floors on and off and manage them. The data and IPC are in `src/shared/floors.ts`, `src/main/folders.ts` and the `floors:*` channels (spec 033 contracts).
- **Today every floor that is on is drawn on one single screen**: `renderOffice()` (`app.js:1563`) builds one `officeModel()` from all rooms that are shown, `chooseLayout()` (`:1419`) picks one density for all of them and `stageParts()` writes the rooms in floor order with floor tags. The 15-agent rule (spec 001) is therefore shared by all floors that are on: more floors on means poorer density (033 FR-011).
- Attention from a floor that is **off** is plain text on its row in the Floors panel and Settings (033 FR-010, `offFloorAttention`, `app.js:3930`). Attention from a floor that is **on** is simply visible in the one office.
- Status pills count every agent that is shown (floors on); the office usage total counts every floor (033 FR-008, FR-016).
- The shared lobby (spec 024 FR-020, 033 FR-020) is part of the office stage: one lobby for all floors that are on, `lobbyOn()` (`app.js:289`), tiles from `lobbyPlaces()` (`:288`), visitors filtered by `roomShown`.
- Opening an agent: `openPanel(id,focus)` (`app.js:2247`) shows the chat over the office (`body.panel-open` hides `#stage-host`); the inbox's *Open* and *Answer in chat* call it (`:3362-3363`); an OS notification opens the inbox on its agent's row (`:3207`, `openInbox(id)`, `:3286`). The keyboard navigator (spec 074, `src/renderer/navigator.js`) already lists floors (`:54-68`) and folders by floor, but picking a floor only narrows the folder list.
- Screen-reader announcements go through `announce(text)` (`app.js:3285`, `#srAnnounce`). Reduced motion: `reducedMotion()` (`app.js:785`; `REDUCED` at `:5` is read once) and the shared `motion(el, frames, opts)` helper.
- There is no PageUp/PageDown handling in the office (only the composer height uses them, `composersize.js:37`).
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

### Design choices that follow from the answers (no new product decision)

- **D1, the lobby is drawn on every floor screen.** Q4 says one shared lobby. It is one set of places and one set of visitors (all floors that are on); each floor screen draws it at the same place, so the layout rules of specs 001/024 are reused unchanged and the lobby never has to be a fixed overlay while floors slide. Visitors from another floor sit in the tile without a walk (FR-021).
- **D2, only floors that are on have a screen.** Off floors have no screen and no lift button; their attention stays plain text in the Floors panel and Settings (033 FR-010, unchanged).
- **D3, the first floor of the list is the top of the building; PageUp goes up.** *(Owner, Paco, 2026-10-27: Q-A = a.)*

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
- **Many floors**: the lift panel scrolls inside itself past the available height (033 allows many floors); the current button is kept in view; the office never scrolls because of it.
- **Floor names that look alike or are very long**: buttons show the position number; the full name is in the tooltip and the accessible name (Q-B).
- **Filters**: the status-pill filter and folder filter apply inside the current floor; the pills' counts stay whole-building (Q5). A folder filter set to a room on another floor slides to that floor (US4). A filter that leaves the current floor empty shows the existing "nothing matches" state, not another floor.
- **Hidden folders (spec 006)**: a floor whose rooms are all hidden is empty; it keeps its button.
- **Rooms with a closed door (spec 017)**: unchanged, per floor. A closed room that is waiting keeps its highlight and counts in the badge.
- **List view and the chat strip**: unchanged. The list shows every floor that is on, as today, and is not paged by floor. The lift is part of the office view only.
- **Settings, Tools, MCP screens**: not floors-aware (033 assumption, unchanged).
- **Lobby visitors**: a visitor from another floor shows in the tile with the floor named in its label; no walk is drawn for it (FR-021).
- **Walkers mid-walk when the floor changes**: the walk is not drawn off screen; on arrival figures are placed at their place without a long re-walk (spec 024 layout-change rule).
- **First start / restart**: the current floor is restored from a local display preference if that floor is still on; otherwise the first floor that is on.
- **VS Code**: a `.code-workspace` file is one room on one floor (033 assumption), so it is on one screen. The read-only VS Code chat-history view (spec 080) is not part of the office and is not floored. *[unverified: the brief names a "VS Code view" edge case; this reading is the analyst's, to confirm in review.]*
- **Demo mode and an older bridge without floors** (`floorsLive()` false): one floor, no lift.
- **Themes** (specs 035-040): the lift panel uses semantic tokens only; no theme-specific size (`test:theme`).

## Requirements *(mandatory)*

### Functional Requirements

**Floor screens and layout**

- **FR-001**: With **two or more floors on**, the office MUST show exactly one **floor screen** at a time: the rooms of the current floor (`roomShown` and floor equal to current), the shared lobby, and nothing from other floors. With zero or one floor on the office is unchanged (FR-004).
- **FR-002**: The office density (spec 001) MUST be chosen **per floor screen** from that floor's agents (and the lobby), not from all floors on. This replaces 033 FR-011 ("from the agents of floors that are on only") when two or more floors are on: the 15-agent legibility rule holds **on each floor**, at 1440x900 and 1280x800, with 15 agents on one floor and with 15 spread over several floors.
- **FR-003**: The floors that are on are one vertical building in floor order (033 order, Up/Down), each as high as the office area. Only the current floor and, during a slide, the floor it slides to are in the DOM and the tab order; other floors are not rendered (no hidden focusable controls, no layout cost for floors out of sight).
- **FR-004**: With **one floor on** (or none, or no floors support) there MUST be no lift panel, no slide, no PageUp/PageDown behaviour and no floor tags, and the office MUST look and measure as before (existing `check:office` cases unchanged).
- **FR-005**: The floor tag in room headers (033 FR-012) stays as the on-screen floor name, shown when two or more floors are on, and gives way first when a name would be squeezed (spec 001 FR-179, unchanged). Rooms are no longer interleaved across floors because only one floor is drawn. 033 FR-012's "order rooms by floor" stays true inside the building.

**The lift panel**

- **FR-006**: With two or more floors on, a **lift panel** MUST sit at the right edge of the office area, in the office view only: a vertical `role="toolbar"` (`aria-label="Floors"`, `aria-orientation="vertical"`) with one button per floor that is on, in floor order from top to bottom (Q-A), each at least 28x28 px, text at least 10.5 px, with the floor's position number as its visible label (Q-B). The panel is not part of the sliding content: it stays still while floors slide.
- **FR-007**: Each button MUST have the accessible name "<floor name>, floor <n> of <m>" plus the attention words of FR-015 when present, a tooltip with the full floor name, and `aria-current="true"` on the current floor. The current floor is also shown with a shape or weight cue, not only colour.
- **FR-008**: The lift panel reserves its width only while it is shown (two or more floors on), and that width MUST be counted in the layout so the 15-agent rule and `check:office` hold with it. *[KNOWN GAP until measured: how much density the width costs at 1280x800; target at most one density step with 15 agents on one floor and none with 6.]*

**Sliding and keys**

- **FR-009**: Choosing a floor (lift button, keyboard, navigator, filter, jump) MUST slide the office vertically to it in **about 300 ms** (280-320 ms) with a calm ease-in-out, using the shared `motion()` helper and only `transform` and `opacity` (no layout work inside the slide). It MUST NOT block input; a second request during a slide retargets from the current position. A resize, a relayout or a theme change during a slide ends it at once at the right position.
- **FR-010**: With `prefers-reduced-motion: reduce` (read live through `reducedMotion()`, not once at start) the change MUST be instant: no slide, no fade.
- **FR-011**: PageDown MUST go to the next floor that is on and PageUp to the previous one, in the office view, when the key has no modifier and is not typed into a text field, textarea, select, contenteditable, an open dialog, menu or palette. At the first or last floor nothing happens and nothing is announced. The keys are listed in the keyboard help table in `app.js` (as spec 052 FR-084 lists others), with the note that on a Mac laptop they are Fn+Up / Fn+Down. The navigator (spec 074) is unchanged except FR-019.
- **FR-012**: Every floor change MUST be announced once through `announce()` as "Floor <name>, <n> of <m>", whether made with a button, a key, a jump, or by the app (FR-023). No announcement when the floor does not change.
- **FR-013**: The lift buttons MUST be one tab stop (roving tabindex); Up/Down move between buttons, Home/End go to the first/last, Enter/Space select. Focus stays on the button after the slide and is not moved into the office.

**Attention on the lift**

- **FR-014**: A lift button of a floor that is **not** the current floor MUST show a **badge** when any agent (main agent or helper, hidden rooms excluded as in the office) on that floor needs the user: waiting for approval or a question, error, credit or rate limit reached (coffee-break state, spec 068), or a New reply (unread state, spec 052). It reuses the sources of the status pills and the inbox (`needsMeOrder()`, `UNREAD_AT`), not a new attention model.
- **FR-015**: The badge MUST be readable without colour: a count (each agent once; `9+` past nine) and the words in the tooltip and accessible name ("2 waiting, 1 error, 1 new reply"). It MUST NOT use sound, toast or OS-notification paths (spec 052, unchanged) and MUST NOT reorder buttons.
- **FR-016**: The current floor's button MUST NOT show a badge. A floor that is off has no button (033 FR-010 text stays its only signal).
- **FR-017**: Status pills (Working, Waiting, Idle, Errors, Done), the inbox count, the window-title count and the office usage total MUST keep counting the **whole building** (floors on), exactly as today (Q5). A status-pill filter filters the current floor's screen only; its counts do not change with the current floor.

**Jumping**

- **FR-018**: Opening an agent by any route (inbox *Open* / *Answer in chat* / `openPanel`, an OS notification via the inbox, the navigator, the list view, the chat strip, the folder filter) MUST set the current floor to the agent's floor if that floor is on, **before** the chat shows, so Back to the office shows that floor; no slide is drawn while the chat covers the office. One function `goToFloor(id, {animate})` does it; `openPanel()` (`app.js:2247`) and the navigator call it.
- **FR-019**: Choosing a **floor** row in the navigator (spec 074) MUST go to that floor (slide) when the row is activated, as well as narrowing the folder list as today; choosing a folder or chat goes to its floor first (FR-018).

**Lobby and the building**

- **FR-020**: The shared lobby (Q4; spec 024 FR-020, 033 FR-020) MUST be drawn on every floor screen at the same place with the same tiles and visitors (agents of **all** floors that are on, never of a floor that is off). Places keep their rules (`+N`, custom places, busy state).
- **FR-021**: A visitor whose agent is on a floor other than the current one MUST be shown in the tile without a walk, with its floor named in the tile label ("Terminal: Dana (Client B)"). An agent of the current floor walks as in spec 024. A walk is never drawn across a floor change.

**Persistence, data and safety**

- **FR-022**: The current floor is a display preference of this window (like the detail level): its id in `localStorage`, restored at start if that floor is on, otherwise the first floor that is on. No change to the saved floors file, no IPC, no main-process change, no secrets (033 FR-014/FR-015 unchanged).
- **FR-023**: When the current floor is switched off, deleted or stops existing, the view MUST move to the nearest floor that is on (next, else previous) without a slide, announced by FR-012. Switching a floor on, creating one, reordering and moving a folder MUST NOT move the user; **Only** (033 FR-022) makes the chosen floor current.
- **FR-024**: Adapters, permission modes, sessions, approvals and credit caps MUST NOT change. Floors and the lift are renderer-only; nothing Copilot-specific is added (constitution II).

**Tests and docs**

- **FR-025**: A pure module `src/renderer/floornav.js` (no DOM; same pattern as `places.js`) MUST hold the rules (next/previous floor that is on, nearest floor after a change, key eligibility, badge counts, announcement text) with a Node test `scripts/test-floornav.ts`. A simulator driver `scripts/shots-092.js` MUST cover the scenarios; `check:office` MUST be extended for floor screens (FR-002) at both sizes.
- **FR-026**: Docs are part of the change: README floors text and screenshots (the lift changes the office picture), `docs/` floors pages if any, the keyboard help table, a `changelog.d/` fragment, 033's `## Changes` cross-reference, and `npm run shots:docs` for every linked picture that shows the office.

### Key Entities

- **Floor screen**: the office content of one floor that is on: its rooms and the shared lobby, laid out for the full office area.
- **Lift panel**: the vertical toolbar of buttons, one per floor that is on, with attention badges.
- **Current floor**: a renderer-only id; always a floor that is on while two or more are on.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With 15 simulated agents on one floor, and with 15 spread over two or three floors, each floor screen passes `check:office` (no overlap, no clipped text, no scrolling of the office, no text under 10.5 px) at 1440x900 and 1280x800 (FR-002, FR-008).
- **SC-002**: A user reaches a floor with a waiting agent through its badge in under 5 seconds without documentation (tried by the owners by hand).
- **SC-003**: A floor change completes (slide included) in at most 400 ms with 15 simulated agents, and in one frame with reduced motion; measured in the app like 033 SC-003 (a ratio to a same-run yardstick, never a fixed millisecond limit on a loaded machine).
- **SC-004**: 100% of badges match the agents that need the user on other floors in the simulator checks (no missed waiting/error/limit/new-reply agent, no badge on the current floor, none for an off floor).
- **SC-005**: PageUp/PageDown change the floor in 100% of office-view cases outside text fields and never inside them; a screen reader gets exactly one announcement per change.
- **SC-006**: With one floor on, `check:office` results and screenshots are identical to before this feature (no regression for the single-floor user).
- **SC-007**: Opening an agent of another floor from the inbox, a notification or the navigator and going Back shows that agent's floor in 100% of simulator cases.

## Assumptions

- Floor management (create, rename, reorder, delete, on/off, Move to floor, Settings > Floors, saved data, IPC) is spec 033 and unchanged.
- Q-A and Q-B below were answered by the owner (Paco, 2026-10-27, in the terminal with his agent): both option (a).
- If even the best density does not fit one floor's agents, the existing scroll behaviour of spec 001 (`#floor.scrolls`) applies to that screen, per floor.
- #553 (agents ride the lift) and #555 (special floors) are **out of scope** and not blocked: a floor screen is a clean place to hang a per-floor scene, and the lift panel is where a future indicator or ding would go. Nothing here assumes them.
- Verification is on the simulator and with unit tests, 0 AI credits.
- Windows, macOS and Linux behave the same; PageUp/PageDown exist on all three (Fn+Up/Down on a Mac laptop). *[unverified on a real Mac or Windows keyboard.]*

## Open questions for the owner

- **Q-A, which end is the top of the building?** (a) **Floor-list order, top to bottom**: the first floor in the Floors panel is at the top; PageUp goes to the floor above it in the list. Recommended: no second ordering to learn; what you reorder in the Floors panel is what the lift shows. (b) Building order: the first floor at the **bottom**, like a real lift panel (Ground at the bottom). More literal, but the panel's list and the lift would read in opposite directions.
- **Q-B, how are lift buttons labelled?** (a) **The floor's position number** (1, 2, 3), full name in the tooltip and accessible name; the floor name is already on screen in each room header as the floor tag (033 FR-012). Recommended: the cheapest in width, so the 15-agent rule keeps its room. (b) A short name next to the number: friendlier, but costs width at 1280x800 and may lose a density step.

## Known gaps (honest limits)

- `[KNOWN GAP]` Nothing is built or measured yet; the width cost of the lift panel on density (FR-008) is a target, not a result.
- `[KNOWN GAP]` The feel of the slide (300 ms, ease) can only be judged by hand in a real window; the simulator checks the duration, not the feel.
- `[KNOWN GAP]` Not tried on a real Mac or Windows machine, nor with a screen reader (announcements are verified only as text sent to `#srAnnounce`).
- `[KNOWN GAP]` A floor holding more agents than fit even at the poorest density scrolls, as the office does today.
- Out of scope: #553, #555, per-floor lobbies, horizontal paging, changing what floors group or how they are saved.

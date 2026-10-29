# Feature Specification: Floors (groups of rooms you can switch on and off)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 033
title: Floors: group rooms (folders) and switch a whole floor off so it leaves the office, the lobby and the status counts
status: built
-->

**Feature Branch**: `033-floors` (amends 001 office view and filters, 006 folders, 017 room doors; touches 011 usage totals)

**Created**: 2026-10-17

**Status**: Built 2026-10-17 on branch `033-floors` (T001-T039): simulator and unit tests only, 0 AI credits. Evidence per requirement: see *Verification* at the end.

**Input**: User description (Francisco Javier Cabello, in Spanish): "Salas (rooms) propias de Agent Durbar: hoy una room = una carpeta o un .code-workspace (concepto de VS Code; con varias carpetas solo se usa la primera como cwd y las demás no se ven). Queremos un concepto propio de 'sala' que agrupe varias carpetas (cada carpeta con sus agentes) para compartimentar espacios de trabajo. El usuario puede crear, renombrar y borrar salas, y mover carpetas entre salas. Cada sala se puede activar o desactivar: una sala desactivada no aparece en la oficina ni cuenta en las estadísticas de la barra superior (Working, Waiting, Idle, Errors, Done), ni en los avisos de atención. Debe persistir entre reinicios. Funciona en el simulador sin créditos."

## Context: what exists today

- A **room** in the office is one folder or one `.code-workspace` file (spec 006). For a workspace file with several folders, only the first folder is the agents' working folder and the others are not shown anywhere in the office.
- A folder can already be **hidden** one by one (spec 006, User Story 4): its room leaves the office, the list, the folder filter and the strip, and it no longer counts in the status pills; its agents keep running.
- A room's **door** can be closed (spec 017): it becomes a compact plate but still counts in the pills, and waiting or error rooms stay highlighted.
- There is no way to group several folders and switch the whole group off or on with one action.

This feature adds a level above rooms. It is called a **floor** (the user's word: *sala*; see Clarifications): the office has floors, a floor holds rooms. A floor groups several folders; each folder keeps its own room, agents, door, mode and settings.

## Clarifications

### Session 2026-10-17 (Francisco Javier Cabello)

- Q: What is the new grouping called in the app? → A: **Floor**. "Room" keeps meaning one folder or workspace file; a floor holds rooms. The built-in floor is called "Ground floor".
- Q: What happens to the agents of a floor that is switched off? → A: **They keep running**, exactly like a hidden folder today (spec 006). Switching a floor off does not pause, stop or end anything, so those agents can still spend AI credits.
- Q: Is attention from a floor that is off signalled? → A: **No, nothing at all.** An agent of a floor that is off that waits for an approval or hits an error is not shown or counted anywhere until its floor is on again. Its request stays pending. *(Superseded on 2026-10-17 by the maintainer's decision below, issue #122.)*
- Q: How do floors combine with the shared lobby of spec 024 (PR #109, places in the office)? → A: There is **one lobby for all floors that are on**; agents of a floor that is off never appear in the lobby (they are treated like agents hidden by a filter in spec 024).
- Q: Where are floors switched on and off? → A: A **Floors** button in the top bar showing how many are on (for example "Floors 2/3"); it opens a panel with an on/off switch per floor and the management actions (create, rename, reorder, delete, move folders).
- Q: With more than one floor on, how does the office show which floor a room belongs to? → A: No extra band: rooms are ordered by floor (floor order, then the usual room order) and each room header shows a small label with its floor's name.
- Q: Do we keep hiding a single folder (Folders → Hide) now that floors exist? → A: Yes, keep both. Hide still works per folder, and the Floors panel marks hidden folders so it is clear why a room is not shown.
- Q: Is there a one-click "only this floor" shortcut? → A: Yes: each floor in the Floors panel has an **Only** action that switches that floor on and every other floor off. No "All on" action.
- Q: Does the office AI-credit total count spend by agents on floors that are off? → A: Yes, it counts everything spent on every floor; its tooltip says how much of it comes from floors that are off. (Status counts stay compartmentalized; money spent is always visible.)
- Q: (Vikram, maintainer, issue #122, 2026-10-17) Should attention from a floor that is off be shown somewhere? → A: **Yes, only inside the Floors controls**: plain text on that floor's row, for example "Off, 1 waiting, 1 error". Nothing else: no pill, no toast, no sound, no sorting, no change to the top-bar counts or to "Floors n/m".

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Group folders into floors (Priority: P1)

As someone who runs agents for several projects or clients, I create floors (for example "Client A", "Personal", "Agent Durbar") and put each folder in one of them, so my office is organized the way I think about my work, not the way VS Code files happen to be.

**Why this priority**: Without floors nothing else in this feature exists; on its own it already makes a busy office easier to read.

**Independent Test**: On the simulator (`DURBAR_SIM=15`), create two floors, move folders into them, restart the app, and see the same floors with the same folders.

**Acceptance Scenarios**:

1. **Given** no floors have been created yet, **When** the app starts, **Then** every folder is in one built-in floor (working name "Ground floor") and the office looks exactly as it does today.
2. **Given** the Floors panel, **When** I create a floor named "Client A", **Then** it appears in the list of floors, empty and on.
3. **Given** a folder in "Ground floor", **When** I move it to "Client A", **Then** its room (with its agents, door state, mode, model, cap and MCP extras) is now shown under "Client A", and nothing about its agents changes.
4. **Given** more than one floor exists, **When** I am about to add a folder or workspace file, **Then** I can pick the target floor beforehand in the Floors panel ("New folders go to: <floor>"), and the tooltips of **+ Folder** / **+ Workspace** name it; by default it is the floor I added a folder to last time (or "Ground floor"). With only one floor, the choice is not shown and new folders go to it.
5. **Given** floors and folder assignments, **When** I restart the app, **Then** floors, their names, order, on/off state and each folder's floor are restored.

---

### User Story 2 - Switch a floor off to stop seeing it (Priority: P1)

As someone who focuses on one project at a time, I switch off the floors I am not working on, so they disappear from the office and from the top-bar counts. Only the floors that are on are what I see and count.

**Why this priority**: This is the reason the user asked for floors: to separate work areas so that what is going on in another area does not distract or count.

**Independent Test**: On the simulator, with folders in two floors, switch one off: its rooms leave the office, the list and the folder filter, and the Working / Waiting / Idle / Errors / Done pills only count agents in floors that are on. Switch it back on: everything returns as it was.

**Acceptance Scenarios**:

1. **Given** floors "Client A" (3 agents working) and "Personal" (1 agent waiting), **When** I switch "Personal" off, **Then** the pills show Working 3, Waiting 0, and no room of "Personal" is in the office, the list view, the folder filter or the full-screen chat strip.
2. **Given** a floor is off, **When** I switch it on, **Then** its rooms come back with the same door state and agents, and the pills include them again.
3. **Given** a floor is off, **When** I restart the app, **Then** it is still off.
4. **Given** several floors, **When** I switch some off, **Then** the office picks its density from the agents in floors that are on only, so fewer visible agents can get a roomier layout (spec 001 rules still apply).
5. **Given** every floor is off, **Then** the office shows a short message saying all floors are off and how to switch one on (instead of an empty office).
6. **Given** floors "Client A", "Personal" and "Ground floor" are on, **When** I choose **Only** on "Client A", **Then** "Client A" stays on, the other two are off, and the button shows "1/3" (Floors: 1 of 3 on).
7. **Given** I am in the full-screen chat of an agent, **When** I switch its floor off, **Then** the chat closes and I go back to the office, even if that agent is waiting for me (its request stays pending).

---

### User Story 3 - Rename, reorder and delete floors (Priority: P2)

As my projects change, I rename a floor, change the order of floors, and delete a floor I no longer need, without losing the folders in it.

**Why this priority**: Needed to keep floors useful over time, but the first two stories already deliver value without it.

**Independent Test**: On the simulator, rename a floor, move it up, delete another one, and check where its folders went.

**Acceptance Scenarios**:

1. **Given** a floor, **When** I rename it, **Then** the new name shows everywhere at once and after a restart.
2. **Given** I try to name a floor with an empty name or with the name of another floor, **Then** the app refuses with a short message.
3. **Given** a floor with folders, **When** I delete it, **Then** the app asks first, says how many folders it has, and moves them to "Ground floor"; no folder is removed and no session is ended.
4. **Given** the built-in "Ground floor", **Then** it can be renamed and switched off, but not deleted.
5. **Given** several floors, **When** I change their order, **Then** the office shows floors that are on in that order.

---

### User Story 4 - See which floor a room belongs to (Priority: P3)

When more than one floor is on, I can tell at a glance which floor each room belongs to.

**Why this priority**: Nice for orientation; with a single floor on it is not needed at all.

**Independent Test**: On the simulator with two floors on, each room header shows its floor label and rooms are ordered by floor, at 1440x900 and 1280x800 with 15 agents, without overlap.

**Acceptance Scenarios**:

1. **Given** two floors on, **Then** the rooms of each floor are next to each other, in the floor order, and each room header (and closed door plate) shows a small label with its floor's name; no extra band or heading is added.
2. **Given** only one floor on, **Then** no extra floor label or grouping takes room on screen.

### Edge Cases

- A folder belongs to exactly one floor. A saved folder whose floor no longer exists (for example a damaged settings file) goes to "Ground floor".
- Hiding a single folder (spec 006) still works inside a floor and is independent of the floor being on or off: a hidden folder in a floor that is on stays hidden; showing it again in a floor that is off does not make it visible until the floor is on.
- Closing a room's door (spec 017) still works and is remembered per folder, independent of the floor.
- Removing a folder (spec 006) removes it from its floor.
- A floor with no folders is allowed and shows nothing in the office (it is still listed in the Floors panel).
- The folder filter in the top bar lists only folders of floors that are on; if the selected folder's floor is switched off, the filter goes back to "All folders".
- A status filter (spec 001) that is on when a floor is switched off keeps working on what remains.
- Sub-agents (helpers) always follow their parent agent's floor.
- New sessions in a folder (the room **+**) land in that folder's floor.
- Long, unusual or non-Latin floor names are shown escaped and shortened with a full-name tooltip; the UI never breaks the 10.5px minimum.
- Usage totals (spec 011): the office total in the header still counts every floor, including floors that are off, and its tooltip says how much comes from floors that are off. A room's own total is unchanged.
- A floor is switched off while one of its agents is in the lobby (spec 024): the figure disappears at once, without walking back.
- The Tools view (spec 019/020) is not filtered by floor in this feature (stated as a limit).
- Demo mode (sample data) has no floors: everything behaves as one "Ground floor" that is on.
- Closing and reopening the app behaves exactly as today for agents on floors that are off: nothing new is paused, resumed, ended or hidden differently; saved folders come back as "not started" agents on their floor, and the floor keeps its on/off state.
- A model switch (spec 030) queued on an agent whose floor is off just waits, as today; switching floors never changes, applies or cancels it.
- The longest allowed floor name (40 characters) fits: it is shortened with an ellipsis (full name in the tooltip) in room tags, door plates, the Floors panel and Settings, and never pushes top-bar controls out at 1280x800.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST have a concept of a **floor**: a named, ordered group of folders (folders or `.code-workspace` files as defined in spec 006). Every folder belongs to exactly one floor.
- **FR-002**: There MUST be one built-in floor ("Ground floor") that holds every folder not assigned elsewhere; it can be renamed and switched off but not deleted.
- **FR-003**: Users MUST be able to create a floor with a name that is not already used (compared ignoring case and surrounding spaces); 1 to 40 characters after trimming, no control characters (C0, DEL, C1) and no hidden direction, zero-width, separator or filler characters (U+00AD, U+034F, U+115F, U+180E, U+200B, U+2028, U+2029, U+202A–U+202E, U+2060–U+2064, U+2066–U+2069, U+3164, U+FEFF, U+FFF9–U+FFFB; see the 2026-10-18 delta); ZWNJ/ZWJ (U+200C/U+200D, needed by Indic and Persian scripts and emoji) and LRM/RLM stay allowed. At most 40 floors; creating a 41st is refused with a short message.
- **FR-004**: Users MUST be able to rename, reorder and delete floors. Deleting a floor MUST ask for confirmation, MUST move its folders to "Ground floor", and MUST NOT remove any folder or end any session.
- **FR-005**: Users MUST be able to move a folder from one floor to another; moving MUST NOT change the folder's agents, sessions, permission mode, model, effort, credit cap, door state, hidden flag or MCP extras.
- **FR-006**: When more than one floor exists, users MUST be able to choose the floor for a new folder or workspace file before the system picker opens: a "New folders go to" choice in the Floors panel, named in the tooltips of **+ Folder** / **+ Workspace**; the default is the floor used for the last addition, or "Ground floor". With one floor, no choice is shown. (The top bar has no room for one more control at 1280x800, see research R7.)
- **FR-007**: When **two or more floors** exist, the top bar MUST have a compact **Floors** button that shows how many floors are on out of the total (an icon and "2/3"; its accessible name and tooltip say "Floors: 2 of 3 on"). With only the Ground floor the top bar MUST look exactly as before (no button); the first extra floor is created in Settings > Floors (FR-023). The button MUST open a panel with one on/off switch per floor (one action per floor) and the management actions of FR-003 to FR-005 (create, rename, reorder, delete, move folders). The top bar MUST fit at 1280x800 with the CI font set (DejaVu Sans) as well as the macOS fonts, and Office / List MUST never leave the window.
- **FR-008**: Agents in a floor that is off MUST NOT appear in the office, the list view, the folder filter or the full-screen chat strip, and MUST NOT be counted in the top-bar status pills (Working, Waiting, Idle, Errors, Done) or in the "needs attention" ordering.
- **FR-009**: Switching a floor off MUST NOT pause, interrupt, stop or end any of its agents' sessions; they keep running exactly like the agents of a hidden folder (spec 006). Messages already sent keep being answered and can spend AI credits.
- **FR-010**: Attention from a floor that is off (waiting for approval, error, limit reached) MUST be shown **only** as plain text on that floor's row in the Floors panel and in Settings > Floors, for example "Off, 1 waiting, 1 error" (counts of main agents and helpers in those states; none = no text). It MUST NOT be shown or counted anywhere else: no pill, no mark on the top-bar button, no change to "Floors n/m", no toast, no sound, no sort order. A pending approval MUST stay pending: switching a floor off or on never approves or denies anything. When the floor is switched on again, its waiting and error agents show and sort first as usual.
- **FR-011**: The office density (spec 001) MUST be chosen from the agents of floors that are on only; the 15-agent legibility rule at 1440x900 and 1280x800 MUST hold with one or several floors on.
- **FR-012**: When more than one floor is on, the office MUST order rooms by floor (floor order first, then the existing room order) and MUST show a small floor-name label in each room header and closed door plate, using no extra vertical space (no band or heading per floor). The label MUST be text (not colour only) and at least 10.5px. With one floor on, no label is shown.
- **FR-013**: When every floor is off, the office MUST show an empty-state message that says so and how to switch a floor on. The message MUST name only a control that is on screen at that moment: with two or more floors, the top-bar **Floors** button or **Settings > Floors**; with only one floor (no Floors button, FR-007), **Settings > Floors**. The same holds for the mixed message shown when every folder is hidden or on a floor that is off. (Changed 2026-10-19, issue #133.)
- **FR-014**: Floors (names, order, on/off state) and each folder's floor MUST be saved locally and restored after a restart, together with the existing saved folder list. A missing or damaged file MUST fall back to everything in a "Ground floor" that is on, never to an error that blocks the app.
- **FR-015**: Saved floor data MUST hold only names, order, on/off state and folder paths already saved today; no tokens, prompts, chat content or other secrets.
- **FR-016**: The office usage total (spec 011) MUST keep counting spend by agents on every floor, on or off. When part of it comes from floors that are off, its tooltip MUST say how much. Each room's own total is unchanged.
- **FR-017**: The whole feature MUST work on the simulator with zero AI credits, including a way to start the simulator with several floors and some of them off.
- **FR-018**: Floor controls MUST be usable with the keyboard and named for screen readers; on/off state MUST be shown with a word or icon, not by colour only.
- **FR-019**: Behaviour MUST be the same on Windows, macOS and Linux; folder paths in floors MUST be matched the same way the saved folder list matches them today.
- **FR-020**: With the shared lobby of spec 024, there MUST be one lobby for all floors that are on, and agents of a floor that is off MUST NOT appear in it (no figure, no walk, no name in a place's label).
- **FR-021**: The per-folder Hide of spec 006 MUST keep working unchanged. In the Floors panel, each folder that is hidden MUST be marked as hidden (with a word, not colour only), so a user can tell a hidden folder from a floor that is off.
- **FR-022**: Each floor in the Floors panel MUST have an **Only** action that, in one step, switches that floor on and every other floor off. It follows the same rules as switching floors off one by one (FR-008 to FR-010: nothing is paused or ended).
- **FR-023**: The Settings screen MUST have a **Floors** section with the same controls and rules as the Floors panel (On/Off, Only, Rename, Up/Down, Delete, Move to, *hidden* tag, New floor, New folders go to). A change made in one place MUST show in the other at once. The top-bar Floors button and panel stay.
- **FR-024** (added 2026-10-23, issue #590): When **two or more floors** exist, the folder menu (right-click a room header, its **⋯** button, or the context-menu key / Shift+F10 on its door; spec 006 FR-022) MUST have **Move to floor ▸** after *Rename…*. Choosing it shows the floors in the same menu element, in floor order, with **‹ Back** first: the folder's current floor is ticked and disabled ("Here now"); a floor that is off says so ("Off: the folder leaves the office"). Choosing a floor moves the whole folder exactly like *Move to* in the Floors panel (FR-005: same bridge call, the folder's agents and helpers go with it, nothing else about them changes). A note then says "*folder* moved to *floor*." with an **Undo** button (the existing action toast, about 8 s); Undo moves it back to the floor it came from. Keyboard: Enter, Space or Right arrow opens the floors; Left arrow or Escape goes back; Escape at the top or Tab closes the menu and returns focus to where it was opened. With **one floor** (or no floors: the demo, an older bridge) the item is **not shown**, so the menu looks exactly as before (FR-007's rule). In the **List view**, right-clicking a row's *Folder* cell opens the same folder menu for that row's folder (the rest of the row keeps the agent's menu). The agents do not visibly walk between floors: taking the lift (issue #553) is a future item.

### Key Entities

- **Floor**: a named group of folders. Attributes: name (unique), position in the order, on/off state, whether it is the built-in "Ground floor". Has zero or more folders.
- **Folder (room)**: as in spec 006 (a folder or `.code-workspace` file with its agents, mode, model, effort, cap, hidden flag, door state). New attribute: the floor it belongs to.
- **Agent**: unchanged; belongs to a folder, so to that folder's floor. Helpers follow their parent.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can create a floor, move three folders into it and switch it off in under one minute, without reading documentation.
- **SC-002**: With a floor switched off, the top-bar counts match exactly the agents visible in the office in 100% of the simulator checks (no agent of a floor that is off is counted, no visible agent is missing).
- **SC-003**: Switching a floor on or off updates the office and the counts in under half a second with 15 simulated agents.
- **SC-004**: After a restart, 100% of floors, their order, their on/off state and every folder's floor are as the user left them.
- **SC-005**: With 15 simulated agents spread over two or three floors that are on, the office stays readable at 1440x900 and 1280x800: no overlap, no clipped text, no page scroll, no text under 10.5px (checked like spec 001 / `check:office`).
- **SC-006**: Switching a floor off or deleting it never ends a session or loses a folder (verified by automated tests on the saved data and on the simulator).

## Assumptions

- "Room" keeps its current meaning (one folder or workspace file); a floor groups rooms.
- Accepted trade-off (see Clarifications): an agent in a floor that is off can keep spending AI credits and can sit waiting for an approval; the signs are its spend in the office credit total (FR-016) and the plain-text count on its floor's row in the Floors panel and Settings (FR-010). The docs and the Floors panel's help text say so plainly.
- Spec 024 (lobby, PR #109) is merged on `main` (2026-10-17); this feature builds on it.
- Several floors can be on at the same time; switching one on does not switch others off. The **Only** action (FR-022) is the one shortcut; there is no "All on".
- The existing per-folder Hide (spec 006) and room doors (spec 017) stay as they are and combine with floors as described in Edge Cases.
- `.code-workspace` support is unchanged: a workspace file is still one folder entry (one room) whose agents work in its first folder. Making agents work across several folders is out of scope.
- Floors are local to this computer and this user, like the saved folder list; they are not shared or synced.
- The Tools view, the Settings screen and MCP settings are not filtered by floor in this feature.
- Floors apply to every adapter the same way (they belong to the office, not to Copilot), so a future Claude Code or Codex adapter (spec 012) needs nothing extra.
- Verification is on the simulator and with unit tests only; no real Copilot session is needed or planned for this feature.

## Changes

### 2026-10-29: index status text kept from before the fixed status words (spec 021 FR-063)

The `status:` of the specs-index block used to read (moved here unchanged; the block now has one status word and a short note):

> built 2026-10-17 on branch `033-floors`; Move to floor in the folder menu 2026-10-23 (issue #590); follow-ups of issue #133 (empty-state wording, retaken screenshots) 2026-10-19; SC-003 timed in the app (issue #454) 2026-10-21 ([plan](033-floors/plan.md), [research](033-floors/research.md), [tasks](033-floors/tasks.md)); simulator and unit tests, 0 AI credits


- **2026-10-27, floors as places (issue #782, new spec 092).** With two or more floors on, the office will show one floor at a time with a lift panel (spec 092). This refines **FR-011** (the density is chosen per floor screen from that floor's agents, not from all floors on) and **FR-012** (rooms are ordered by floor inside one building; the floor tag stays). FR-008, FR-010, FR-016 and FR-020 are unchanged: the pills and the usage total count the whole building, an off floor has no screen and no lift button, and the lobby is shared. Phase 1 of spec 092 (floor screens, `092-floor-screens`) is built: with two or more floors on the office shows one floor's rooms and the density is chosen per floor screen; the lift panel, the slide and the jumps come in later phases. With one floor on FR-011 and FR-012 apply as written.
- **2026-10-28, All floors view (spec 092 FR-031..FR-037, owner Vikram, issue #782).** The lift panel of spec 092 gets an *All* button that shows every floor that is on in one screen, as before 092 phase 1. In that view **FR-011 and FR-012 apply as written**: one density for all floors on, the 15-agent rule for all floors on together at 1440x900 and 1280x800 (now with the lift panel's width taken out, 092 FR-033), rooms in floor order with floor tags. **Only** (FR-022) does not change the chosen view (092 FR-035). Built on `092-lift-all-floors` (2026-10-28): `check:office` passes the All floors view at both sizes with the panel, with no density step lost (092 FR-033).
- **2026-10-26, the floor tag gives way before the room name is squeezed (issue #788, spec 001 FR-179).** In a narrow room header the floor tag (after the schedule and MCP chips) is hidden so the folder name keeps at least 8 characters; the folder menu's **Move to floor** item already says which floor the folder is on. No other floor rule changes.
- **2026-10-26, SC-003 checked as a ratio to a same-run yardstick (issue #454, reopened).** SC-003 is unchanged for the user: the office and the counts show a floor switch in well under half a second with 15 simulated agents. What changed is what the simulator check can prove. The 2026-10-21 check still failed on a busy 4-core server (Ruben's agent, load 4.7-7.5: 4 of 5 runs, own time 515-557 ms after the CPU-wait subtraction), because a fixed millisecond limit measures the machine as much as the app. `scripts/shots-033.js` now (1) times a fixed DOM + layout + string workload in the same page (the yardstick, best of 3, at least 2 ms), (2) judges the switch's own time (clock time minus the renderer's CPU wait on Linux, best of up to 3 tries, as before) as a ratio to it: **ratio < 16**, and (3) keeps an absolute sanity cap of 2000 ms only to catch a hang. Honestly measured now: "the switch costs less than 16 yardsticks (about 35-50 ms on the test machine, so about 560-800 ms there)", not a hard 500 ms on every machine; the 500 ms figure stays the product goal and is what the unloaded numbers show (the app's own time 225-430 ms in this session's runs on a 4-core Xvfb box, ratio 5.2-8.3). The limit sits about 2x above the worst ratio seen (8.3 unloaded, 7.7 loaded) and about 2x below what two planted bugs measure (a delay of 40 ms per agent: ratio 38; the layout search run three times, as a re-render of everything: ratio 20). No change to the app. Task T051.
- **2026-10-23, Move to floor from the folder menu (issue #590, Ruben).** Moving a folder needed the Floors panel or Settings > Floors (FR-005's *Move to* select). New requirement **FR-024**: the folder menu gets **Move to floor ▸** (a second level in the same menu element, current floor ticked and disabled), the move reuses `moveRoomToFloor` / `bridge.moveFolderToFloor` so FR-005 holds, and an action toast offers **Undo**. Shown only with two or more floors; with one floor the menu is unchanged (the item is hidden, not disabled: there is nowhere to move to and FR-007 keeps the one-floor app as before). The List view gets the folder menu on the *Folder* cell. Out of scope, future items: agents taking the lift (#553); the issue's optional "New floor…" entry (create a floor and move into it) is not built (Settings > Floors creates floors). Tasks T047-T050.
- **2026-10-21, the layout search made faster (spec 001 FR-033, finding in PR #457).** SC-003 is unchanged. Most of a floor switch was the office's layout search; spec 001 FR-033 makes each trial cheaper with the same result. Measured on the simulator (Linux, 4 cores, Xvfb): the app's own time for a switch went from 438-526 ms to 134-146 ms (medians at 1440x900 and 1280x800). See spec 001's 2026-10-21 change for the cause and the method. Ruben's agent had measured 534 ms on a busy server before this change.
- **2026-10-21, SC-003 measured as the app's own work (issue #454).** The simulator check of SC-003 (`scripts/shots-033.js`) failed now and then on a loaded machine (4 cores, load 5-7): it timed with `performance.now()` in the page from the click to the first animation frame where its own polling saw the new office, so time the renderer spent waiting for a CPU taken by other processes counted as the app's. SC-003 itself is unchanged: under half a second with 15 simulated agents, from the click until the office and the counts show the switch. What is measured now: (1) the app times the switch itself with one User Timing entry, `durbar:floor-switch`, from the click on a floor's On/Off or Show only control to the end of the office render that shows the new set of floors (that render measures the stage, so its layout is done); the driver's polling is no longer counted. (2) On Linux the driver subtracts the time the renderer's main thread was ready to run but waited for a CPU during that switch (run-queue wait from `/proc/<pid>/schedstat`), and the log gives both figures ("230 ms (640 ms on the clock, 410 ms of it waiting for a CPU on a busy machine)"). Time the app waits for itself (IPC to the main process, timers) still counts, and so does all of its own CPU work; where the file is missing (macOS, Windows) the clock time counts as before. (3) The best of up to three tries counts, as before; the 500 ms budget is not raised. No user-visible change. Tasks T045-T046.
- **2026-10-19, follow-ups after PR #124 (issue #133).** (1) FR-013 refined: with only the Ground floor, switching it off in Settings > Floors showed "All floors are off. Open "Floors" above to switch one on.", but that button exists only with two or more floors (FR-007 as changed on 2026-10-17). The empty-state message now names a control that is on screen: Settings > Floors with one floor; the Floors button or Settings > Floors with two or more. The mixed message ("every folder is hidden or on a floor that is off") follows the same rule. Text size unchanged (inherits 14px; the 10.5px minimum holds). (2) Docs: the alpha.5 CHANGELOG entry says "Top-bar *Floors n/m* panel" without the two-floor condition; a new *Unreleased* line states it (released entries are not rewritten). (3) Screenshots taken before PR #124 that show the top bar (narrower folder filter, 112 px instead of 150, and 4 px gaps instead of 6) and are linked as current from the README, the website gallery or a spec are retaken on the simulator at 1440x900 and 1280x800; the spec 025 FR-006 current-state set and spec 020's `i7-*` are retaken even though `docs/feature-history.md` links them; the `m2`..`m8` milestone pictures and `m10-agent-mcp-*` are left alone as history. (4) The PR #124 body still says `check:office` 132/132; the Verification section below already records 142 cases, so nothing changes here. No new FR. Tasks T042-T044.
- **2026-10-18, post-merge review of T040 (issue #167).** FR-003 refined: (1) the hidden-character rule also refuses U+2028/U+2029 (line and paragraph separators), U+2061–U+2064 (invisible math operators, as place names already do), U+00AD (soft hyphen), U+034F, U+180E, U+115F, U+3164 and U+FFF9–U+FFFB; ZWNJ/ZWJ and LRM/RLM stay allowed. (2) Loading a saved file removes C1 controls as well as the hidden characters from a name, so a floor saved before T040 with a C1 character is kept with its folders (only a name that is then empty or taken falls back, as before). (3) Every such character is written as a `\u` escape in the source, never literally, and a test fails if one appears literally in the floor files. (4) The simulator's copy of the rule is tested against the shared one. `[KNOWN GAP]`, unchanged: the 40-character limit counts UTF-16 units (place names count code points), and names are not NFC-normalised. Task T041.
- **2026-10-18, hidden characters in floor names (review of PR #141, custom places).** FR-003 tightened: besides C0 controls and DEL, a floor name also refuses C1 controls and the invisible characters that can make one name look like another (bidi embeddings, overrides and isolates, zero-width space, word joiner, BOM), with the same message. ZWNJ/ZWJ and LRM/RLM stay allowed because real names in Indic and Persian scripts and emoji sequences need them. A saved file is read tolerantly: these hidden characters are removed from a saved name (the floor and its folders are kept); a name that is then empty or taken falls back as before. Task T040.
- **2026-10-17, maintainer review of PR #124 (Vikram, changes requested).** CI's `check:office` (Linux, DejaVu Sans) failed at 1280x800: the `Floors n/m` button pushed the top bar to 1306 px and cut off Office / List; with one floor it also changed the top bar for every user. FR-007 changed: the button shows **only with two or more floors**, is compact (icon and count), and the top bar must fit with the CI fonts too; the first extra floor is made in Settings > Floors. US2 scenario wording follows.
- **2026-10-17, maintainer review (Vikram, issue #122).** FR-010 changed: attention from a floor that is off is shown as plain text **only** on that floor's row in the Floors panel and Settings ("Off, 1 waiting, 1 error"); nothing else changes (no pill, toast, sound, sorting, top-bar change). This replaces the owner's earlier "nothing at all" (Q3). Also added: app quit behaves as today, a queued model switch on an off floor just waits (spec 030), the 40-character floor name is checked at 1280x800, and the office total's off-floor amount uses the since-reset totals of spec 011 (PR #121).
- **2026-10-17, owner request (fjcabello): floors in Settings too.** Trying the built feature, the owner asked to switch floors on and off from **Settings** as well. Decision (option A of two): **add** a *Floors* section to Settings with the same controls as the Floors panel; the top-bar button stays for quick access (option B, moving everything to Settings, was rejected: switching is frequent). New requirement **FR-023**. No other requirement changes.

## Verification (2026-10-17, simulator and unit tests; no real Copilot session)

- `[IMPLEMENTED]` test: FR-001..FR-005, FR-014, FR-015, FR-022 (operations, refusals, persistence, damaged and pre-floors files): `test:floors`, `test:folders`.
- `[IMPLEMENTED]` test: FR-016 (office total and tooltip): `test:usagetotals`.
- `[IMPLEMENTED]` sim: FR-006..FR-013, FR-018, FR-020, FR-021, FR-022, SC-002, SC-003 (switch off in 55-84 ms with 15 agents): `scripts/shots-033.js` at 1440x900 and 1280x800, plus a manual browser pass on the simulator.
- `[IMPLEMENTED]` sim: FR-011, FR-012, SC-005: `npm run check:office` floors cases (3, 2, 1 floors on, with closed doors; top bar at 1280x800).
- `[IMPLEMENTED]` sim: FR-023 (Settings > Floors; a switch there updates the office, the pills, the button and the panel): `scripts/shots-033.js`, screenshot `033-settings-floors`.
- `[IMPLEMENTED]` sim: FR-010 as changed on 2026-10-17 (issue #122): the off floor's row reads "Off, 1 waiting, 1 at credit limit" in the simulator; the button and the pills do not change: `check:office` (off-floor attention, both sizes) and `scripts/shots-033.js`, screenshot `033-floor-off-panel`. read: no handler touches a session; pending approvals are not resolved by a floor change.
- `[IMPLEMENTED]` sim: FR-007 as changed after the PR #124 review: no Floors button with one floor (`check:office`, every base case); compact button (icon + "2/3"); the whole `check:office` (142 cases) passes with the macOS fonts **and** with DejaVu Sans forced through `OFFICE_FONT_FILE` (the font CI uses). With DejaVu the controls row is 1201 px of 1252 at 1280x800; CI renders it about 30 px wider. The folder filter is 112 px (was 150) and the gaps in the left group 4 px (were 6), so the top bar changes slightly for everyone; the row may wrap as a last resort instead of cutting Office / List.
- `[IMPLEMENTED]` sim: 40-character floor name renamed through the panel at 1440x900 and 1280x800 (tags, plates, room headers, top bar): `check:office`.
- `[IMPLEMENTED]` test + sim: after merging PR #121 the off-floor amount in the office tooltip uses the since-reset totals (folder key), like the room headers.
- `[IMPLEMENTED]` sim: FR-013 as changed on 2026-10-19 (issue #133, T042): with one floor switched off the office says "Your only floor is off. Switch it on in Settings > Floors." and the Floors button is hidden; with three floors all off it says "All floors are off. Open \"Floors\" above or Settings > Floors to switch one on." and the button is visible; both at 1440x900 and 1280x800: `check:office` (4 new checks; the whole run is 314/314 checks on Linux with DejaVu Sans, after merging alpha.8) and `scripts/shots-033.js` (all-off assertion). read: after alpha.8 the Folders button is hidden in Simple mode (spec 052), so the mixed message leaves "Folders" out there; the Floors button and Settings are on screen in both modes. `[KNOWN GAP]` main's own "All folders are hidden. Open "Folders" above" message still names that button in Simple mode (not changed here). read: the mixed message cannot appear with one floor (every folder hidden is caught first, a floor that is off is the all-off message), but its code names Floors only with two or more floors. Issue #133 item 4 (the PR #124 body said `check:office` 132/132): recorded here, the earlier 142-case line stands for that PR; nothing else changes.
- `[IMPLEMENTED]` sim: spec 033 delta point 3 (T043): the README hero, website gallery, spec 011, 020 and 025 pictures that showed the pre-PR #124 top bar were retaken on the simulator (Linux, DejaVu Sans; the earlier ones used macOS fonts): drivers `shots-hero.js`, `shots-024.js`, `shots-i7.js`, `shots-m9.js`, `shots-m10.js`, `shots-about.js` (removed in #748, spec 021 FR-057: a one-off picture script) and the new `shots-003-011.js`. `[KNOWN GAP]` `shots-024.js` stops at its place-mapping assertion in the 1280x800 pass in this environment (the lobby pictures are written before it); it fails the same way on `origin/main` 0294b65, so it is not caused by this change. `shots-m10.js` now scrolls the CLI list into view and asserts it is in the window before the `settings-cli-list` picture.
- `[IMPLEMENTED]` sim: SC-003 as changed on 2026-10-21 (issue #454, T045): Linux (4 cores, Xvfb) on the simulator, `shots-033` alone 10 of 10 passed before and 13 of 13 after the change (the app's own time 199-311 ms at both sizes; most of it is the layout search, `chooseLayout`, about 180-285 ms); under 6 CPU-bound processes 1 of 5 passed before (526-892 ms on the clock) and 8 of 8 after (217-343 ms counted, 399-996 ms on the clock); inside a 6-at-a-time `ui-suite` run 3 of 3 passed. Checked that it still fails for real: 600 ms of extra work in the render failed (798 ms), and a 600 ms wait before the switch failed under the same load (789 ms counted). read: macOS and Windows count the clock time as before (no run-queue figure there), not run here.
- `[IMPLEMENTED]` sim: SC-003 as changed on 2026-10-26 (issue #454, T051): `scripts/shots-033.js`, 5 runs unloaded (xvfb, one Electron at a time): ratio 5.2-8.3 (limit 16), 5 of 5 passed; 5 runs under 6 niced busy loops (load average up to 9.5): ratio 3.4-7.7, 5 of 5 passed. Mutants (planted in `dist/renderer/app.js`, then restored): 40 ms of work per agent in `afterFloorsChange` failed (ratio 38.5), `layoutKey=''; renderAll()` twice more failed (ratio 20.2). `[KNOWN GAP]` the ratio guards against a switch that costs many times today's; a 50 percent slowdown passes. macOS and Windows not run (no run-queue figure there, the clock time counts).
- `[IMPLEMENTED]` sim: SC-003 after spec 001 FR-033 (2026-10-21): floor switch 134-146 ms (median, `durbar:floor-switch`, both sizes, 15 agents, Linux 4 cores) instead of 438-526 ms on the same machine; `shots-033` passes and logs 84 ms (1440x900) and 108 ms (1280x800), against 199-311 ms before. Not re-timed on macOS, Windows or Ruben's server.
- `[IMPLEMENTED]` sim: FR-024 (2026-10-23, issue #590): `scripts/shots-033-move.js` (in `npm run check:ui`) at 1440x900 and 1280x800 on the simulator with three floors: the context-menu key on a door opens the folder menu with Move to floor after Rename…; Right arrow opens the floors (‹ Back, the current floor ticked and `aria-disabled`), Left arrow and Escape go back; Enter moves the room, its tag changes and the same agents are at its desks; the toast says "*folder* moved to *floor*." with Undo, and Undo moves the room and its agents back; the List view's Folder cell opens the same menu; with one floor there is no Move to floor. Mutation check (T049): skipping the move call failed the driver ("the room is now on Client A"), skipping the Undo's call failed it ("Undo: the room is back on its floor"). Screenshots `033-move-menu-*`, `033-move-toast-*` ([1440x900](../../docs/screenshots/033-move-menu-1440x900.png), [1280x800](../../docs/screenshots/033-move-menu-1280x800.png)). read: the move is the same `moveRoomToFloor` / `floors:moveFolder` call as the panel's select, so FR-005's "nothing else changes" is covered by `test:floors`. `[KNOWN GAP]` In the List view the folder menu opens by mouse only (Shift+F10 on a row is the agent's menu); keyboard users use the room's ⋯ button or door in the office, or Settings > Floors. Not looked at on macOS or Windows. Agents do not walk to the lift (#553, future).
- FR-019: CI runs `npm test` on Windows, macOS and Linux; the layout was looked at on macOS only.
- Deviation from the first design: the floor for new folders is chosen in the Floors panel, not in the top bar (no room at 1280x800; research R7, FR-006 updated).
- `[KNOWN GAP]` The Tools view is not filtered by floor (out of scope). An older build that saves the folder file drops floors (folders kept).

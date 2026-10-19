# Feature Specification: Floors (groups of rooms you can switch on and off)

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

- **2026-10-19, follow-ups after PR #124 (issue #133).** (1) FR-013 refined: with only the Ground floor, switching it off in Settings > Floors showed "All floors are off. Open "Floors" above to switch one on.", but that button exists only with two or more floors (FR-007 as changed on 2026-10-17). The empty-state message now names a control that is on screen: Settings > Floors with one floor; the Floors button or Settings > Floors with two or more. The mixed message ("every folder is hidden or on a floor that is off") follows the same rule. Text size unchanged (inherits 14px; the 10.5px minimum holds). (2) Docs: the alpha.5 CHANGELOG entry says "Top-bar *Floors n/m* panel" without the two-floor condition; a new *Unreleased* line states it (released entries are not rewritten). (3) Screenshots taken before PR #124 that show the top bar (narrower folder filter, 112 px instead of 150, and 4 px gaps instead of 6) and are linked as current from the README, the website gallery or a spec are retaken on the simulator at 1440x900 and 1280x800; milestone pictures kept as history (spec 025 FR-006, `docs/feature-history.md`) are left alone. (4) The PR #124 body still says `check:office` 132/132; the Verification section below already records 142 cases, so nothing changes here. No new FR. Tasks T042-T044.
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
- `[IMPLEMENTED]` sim: FR-013 as changed on 2026-10-19 (issue #133, T042): with one floor switched off the office says "Your only floor is off. Switch it on in Settings > Floors." and the Floors button is hidden; with three floors all off it says "All floors are off. Open \"Floors\" above or Settings > Floors to switch one on." and the button is visible; both at 1440x900 and 1280x800: `check:office` (4 new checks; the whole run is 318/318 checks on Linux with DejaVu Sans) and `scripts/shots-033.js` (all-off assertion). read: the mixed message cannot appear with one floor (every folder hidden is caught first, a floor that is off is the all-off message), but its code names Floors only with two or more floors. Issue #133 item 4 (the PR #124 body said `check:office` 132/132): recorded here, the earlier 142-case line stands for that PR; nothing else changes.
- `[IMPLEMENTED]` sim: spec 033 delta point 3 (T043): the README hero, website gallery, spec 011, 020 and 025 pictures that showed the pre-PR #124 top bar were retaken on the simulator (Linux, DejaVu Sans; the earlier ones used macOS fonts): drivers `shots-hero.js`, `shots-024.js`, `shots-i7.js`, `shots-m9.js`, `shots-m10.js`, `shots-about.js` and the new `shots-003-011.js`. `[KNOWN GAP]` `shots-024.js` stops at its place-mapping assertion in the 1280x800 pass in this environment (the lobby pictures were written before it); not caused by this change.
- FR-019: CI runs `npm test` on Windows, macOS and Linux; the layout was looked at on macOS only.
- Deviation from the first design: the floor for new folders is chosen in the Floors panel, not in the top bar (no room at 1280x800; research R7, FR-006 updated).
- `[KNOWN GAP]` The Tools view is not filtered by floor (out of scope). An older build that saves the folder file drops floors (folders kept).

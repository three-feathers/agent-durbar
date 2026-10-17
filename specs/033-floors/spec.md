# Feature Specification: Floors (groups of rooms you can switch on and off)

**Feature Branch**: `033-floors` (amends 001 office view and filters, 006 folders, 017 room doors; touches 011 usage totals)

**Created**: 2026-10-17

**Status**: Built 2026-10-17 on branch `033-floors` (T001-T026): simulator and unit tests only, 0 AI credits. Evidence per requirement: see *Verification* at the end.

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
- Q: Is attention from a floor that is off signalled? → A: **No, nothing at all.** An agent of a floor that is off that waits for an approval or hits an error is not shown or counted anywhere until its floor is on again. Its request stays pending.
- Q: How do floors combine with the shared lobby of spec 024 (PR #109, places in the office)? → A: There is **one lobby for all floors that are on**; agents of a floor that is off never appear in the lobby (they are treated like agents hidden by a filter in spec 024).
- Q: Where are floors switched on and off? → A: A **Floors** button in the top bar showing how many are on (for example "Floors 2/3"); it opens a panel with an on/off switch per floor and the management actions (create, rename, reorder, delete, move folders).
- Q: With more than one floor on, how does the office show which floor a room belongs to? → A: No extra band: rooms are ordered by floor (floor order, then the usual room order) and each room header shows a small label with its floor's name.
- Q: Do we keep hiding a single folder (Folders → Hide) now that floors exist? → A: Yes, keep both. Hide still works per folder, and the Floors panel marks hidden folders so it is clear why a room is not shown.
- Q: Is there a one-click "only this floor" shortcut? → A: Yes: each floor in the Floors panel has an **Only** action that switches that floor on and every other floor off. No "All on" action.
- Q: Does the office AI-credit total count spend by agents on floors that are off? → A: Yes, it counts everything spent on every floor; its tooltip says how much of it comes from floors that are off. (Status counts stay compartmentalized; money spent is always visible.)

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
6. **Given** floors "Client A", "Personal" and "Ground floor" are on, **When** I choose **Only** on "Client A", **Then** "Client A" stays on, the other two are off, and the button shows "Floors 1/3".
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

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST have a concept of a **floor**: a named, ordered group of folders (folders or `.code-workspace` files as defined in spec 006). Every folder belongs to exactly one floor.
- **FR-002**: There MUST be one built-in floor ("Ground floor") that holds every folder not assigned elsewhere; it can be renamed and switched off but not deleted.
- **FR-003**: Users MUST be able to create a floor with a name that is not already used (compared ignoring case and surrounding spaces); 1 to 40 characters after trimming, no control characters. At most 40 floors; creating a 41st is refused with a short message.
- **FR-004**: Users MUST be able to rename, reorder and delete floors. Deleting a floor MUST ask for confirmation, MUST move its folders to "Ground floor", and MUST NOT remove any folder or end any session.
- **FR-005**: Users MUST be able to move a folder from one floor to another; moving MUST NOT change the folder's agents, sessions, permission mode, model, effort, credit cap, door state, hidden flag or MCP extras.
- **FR-006**: When more than one floor exists, users MUST be able to choose the floor for a new folder or workspace file before the system picker opens: a "New folders go to" choice in the Floors panel, named in the tooltips of **+ Folder** / **+ Workspace**; the default is the floor used for the last addition, or "Ground floor". With one floor, no choice is shown. (The top bar has no room for one more control at 1280x800, see research R7.)
- **FR-007**: The top bar MUST have a **Floors** button that shows how many floors are on out of the total (for example "Floors 2/3"). It MUST open a panel with one on/off switch per floor (one action per floor) and the management actions of FR-003 to FR-005 (create, rename, reorder, delete, move folders). The button MUST fit the top bar at 1280x800 without overlapping other controls.
- **FR-008**: Agents in a floor that is off MUST NOT appear in the office, the list view, the folder filter or the full-screen chat strip, and MUST NOT be counted in the top-bar status pills (Working, Waiting, Idle, Errors, Done) or in the "needs attention" ordering.
- **FR-009**: Switching a floor off MUST NOT pause, interrupt, stop or end any of its agents' sessions; they keep running exactly like the agents of a hidden folder (spec 006). Messages already sent keep being answered and can spend AI credits.
- **FR-010**: Attention from a floor that is off (waiting for approval, error, limit reached) MUST NOT be shown or counted anywhere in the app (no pill, no mark, no toast, no sort order). A pending approval MUST stay pending: switching a floor off or on never approves or denies anything. When the floor is switched on again, its waiting and error agents show and sort first as usual.
- **FR-011**: The office density (spec 001) MUST be chosen from the agents of floors that are on only; the 15-agent legibility rule at 1440x900 and 1280x800 MUST hold with one or several floors on.
- **FR-012**: When more than one floor is on, the office MUST order rooms by floor (floor order first, then the existing room order) and MUST show a small floor-name label in each room header and closed door plate, using no extra vertical space (no band or heading per floor). The label MUST be text (not colour only) and at least 10.5px. With one floor on, no label is shown.
- **FR-013**: When every floor is off, the office MUST show an empty-state message that says so and how to switch a floor on.
- **FR-014**: Floors (names, order, on/off state) and each folder's floor MUST be saved locally and restored after a restart, together with the existing saved folder list. A missing or damaged file MUST fall back to everything in a "Ground floor" that is on, never to an error that blocks the app.
- **FR-015**: Saved floor data MUST hold only names, order, on/off state and folder paths already saved today; no tokens, prompts, chat content or other secrets.
- **FR-016**: The office usage total (spec 011) MUST keep counting spend by agents on every floor, on or off. When part of it comes from floors that are off, its tooltip MUST say how much. Each room's own total is unchanged.
- **FR-017**: The whole feature MUST work on the simulator with zero AI credits, including a way to start the simulator with several floors and some of them off.
- **FR-018**: Floor controls MUST be usable with the keyboard and named for screen readers; on/off state MUST be shown with a word or icon, not by colour only.
- **FR-019**: Behaviour MUST be the same on Windows, macOS and Linux; folder paths in floors MUST be matched the same way the saved folder list matches them today.
- **FR-020**: With the shared lobby of spec 024, there MUST be one lobby for all floors that are on, and agents of a floor that is off MUST NOT appear in it (no figure, no walk, no name in a place's label).
- **FR-021**: The per-folder Hide of spec 006 MUST keep working unchanged. In the Floors panel, each folder that is hidden MUST be marked as hidden (with a word, not colour only), so a user can tell a hidden folder from a floor that is off.
- **FR-022**: Each floor in the Floors panel MUST have an **Only** action that, in one step, switches that floor on and every other floor off. It follows the same rules as switching floors off one by one (FR-008 to FR-010: nothing is paused or ended).

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
- Accepted trade-off (user's choice, see Clarifications): an agent in a floor that is off can keep spending AI credits and can sit waiting for an approval; the only sign in the app is its spend in the office credit total (FR-016). The docs and the Floors panel's help text say so plainly.
- Spec 024 (lobby, PR #109) is merged on `main` (2026-10-17); this feature builds on it.
- Several floors can be on at the same time; switching one on does not switch others off. The **Only** action (FR-022) is the one shortcut; there is no "All on".
- The existing per-folder Hide (spec 006) and room doors (spec 017) stay as they are and combine with floors as described in Edge Cases.
- `.code-workspace` support is unchanged: a workspace file is still one folder entry (one room) whose agents work in its first folder. Making agents work across several folders is out of scope.
- Floors are local to this computer and this user, like the saved folder list; they are not shared or synced.
- The Tools view, the Settings screen and MCP settings are not filtered by floor in this feature.
- Floors apply to every adapter the same way (they belong to the office, not to Copilot), so a future Claude Code or Codex adapter (spec 012) needs nothing extra.
- Verification is on the simulator and with unit tests only; no real Copilot session is needed or planned for this feature.

## Verification (2026-10-17, simulator and unit tests; no real Copilot session)

- `[IMPLEMENTED]` test: FR-001..FR-005, FR-014, FR-015, FR-022 (operations, refusals, persistence, damaged and pre-floors files): `test:floors`, `test:folders`.
- `[IMPLEMENTED]` test: FR-016 (office total and tooltip): `test:usagetotals`.
- `[IMPLEMENTED]` sim: FR-006..FR-013, FR-018, FR-020, FR-021, FR-022, SC-002, SC-003 (switch off in 55-84 ms with 15 agents): `scripts/shots-033.js` at 1440x900 and 1280x800, plus a manual browser pass on the simulator.
- `[IMPLEMENTED]` sim: FR-011, FR-012, SC-005: `npm run check:office` floors cases (3, 2, 1 floors on, with closed doors; top bar at 1280x800).
- `[IMPLEMENTED]` read: FR-009, FR-010 (no handler touches a session; pending approvals are not resolved by a floor change).
- FR-019: CI runs `npm test` on Windows, macOS and Linux; the layout was looked at on macOS only.
- Deviation from the first design: the floor for new folders is chosen in the Floors panel, not in the top bar (no room at 1280x800; research R7, FR-006 updated).
- `[KNOWN GAP]` The Tools view is not filtered by floor (out of scope). An older build that saves the folder file drops floors (folders kept).

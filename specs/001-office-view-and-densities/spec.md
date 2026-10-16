# Feature Specification: Office view, densities, list view and filters

**Feature Branch**: `001-office-view-and-densities` (reverse-engineered; shipped on `main`, milestones 2, 4 and 5)
**Created**: 2026-10-16
**Status**: Implemented (reverse-engineered from code, README and screenshots)
**Input**: "See every running coding agent at a glance, as an office, with 10-15 agents readable on one screen." (README "Vision")

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See 10-15 agents at once without noise (Priority: P1)

As someone running many agents, I open the app and see every agent as a small person at a desk, grouped into one room per
folder, readable on a laptop screen without scrolling, with each agent's status and current intent visible.

**Why this priority**: it is the product's differentiator over the Copilot app and the VS Code Agents window (README "Known limits").

**Independent Test**: `DURBAR_SIM=15 npm start` at 1440x900 and 1280x800; count desks, check for overflow and text size
(see the check script in plan.md "Verification").

**Acceptance Scenarios**:

1. **Given** 15 simulated agents (with helpers) at 1440x900, **When** the office renders, **Then** all 15 desks are visible, the page
   does not scroll, the floor does not scroll, and no text is below 10.5px. *(re-verified 2026-10-16: density `roomy`, min font 11px)*
2. **Given** the same agents at 1280x800, **When** the office renders, **Then** the same holds. *(re-verified 2026-10-16: density `mini`, min font 10.5px)*
3. **Given** 12 agents, **When** rendered at either size, **Then** the `roomy` density is used. *(re-verified 2026-10-16)*
4. **Given** a handful of agents, **When** rendered, **Then** the `full` density (illustrated desks, role, usage) is used.

---

### User Story 2 - Know who needs me (Priority: P1)

I see which agents are working, thinking, waiting for me, idle, done or in error, by colour *and* icon *and* word, and the ones that need
me (waiting, error) come first.

**Independent Test**: simulator with `DURBAR_SIM_FREEZE=1`; check the order inside a room and the top-bar counts.

**Acceptance Scenarios**:

1. **Given** a room with agents in mixed states, **When** rendered, **Then** waiting agents come first, then errors, then the rest in stable order.
2. **Given** a status pill (Working, Waiting, Idle, Errors, Done) is clicked, **When** the office re-renders, **Then** only matching
   agents show and the density does not change (it is chosen from the unfiltered set).
3. **Given** a room, **When** its header renders, **Then** it shows counts of waiting/error/working/done/idle agents in that room.

---

### User Story 3 - Helpers (sub-agents) next to their parent (Priority: P2)

When an agent spawns sub-agents, they appear as smaller figures on a strip under (or beside, in `full`) the parent, joined by a connector. If there
are more than fit, a `+N more` chip with status dots expands them in place.

**Independent Test**: `DURBAR_SIM=15` (Elif has 6 helpers); open `m5-sim15-expanded-helpers-1280x800.png` for the expected look.

**Acceptance Scenarios**:

1. **Given** an agent with 6 helpers in `card`/`mini`/`micro`, **When** rendered, **Then** 1 or 3 helpers show (3 when the floor has room), then `+N more`.
2. **Given** `+N more` is clicked, **When** expanded, **Then** all helpers show in place and a "Show fewer" control collapses them.
3. **Given** helpers in waiting/error, **When** the strip is truncated, **Then** those are the ones shown first.

---

### User Story 4 - List view and folder filter (Priority: P3)

I can switch to a table (Agent, Role, Workspace, Current task, Status) and filter everything by folder.

**Acceptance Scenarios**:

1. **Given** the **List** toggle, **When** selected, **Then** a row per agent (helpers indented) with the same ordering and status filter is shown.
2. **Given** the folder dropdown, **When** a folder is selected, **Then** only its agents show in office and list.

---

### User Story 5 - Calm, cheap motion (Priority: P3)

Animations are subtle, CSS-only in compact densities and stop under reduced-motion. Status updates do not make desks flicker or restart animations.

**Acceptance Scenarios**:

1. **Given** live ticks at SIM=15, **When** only some agents change status, **Then** only those agents' scenes are replaced and running animations of the others continue. *(sim: README measures 24 s, no desk node replaced; not re-run)*
2. **Given** `prefers-reduced-motion: reduce`, **When** rendering, **Then** animations stop.

---

### Edge Cases

- No agents: the floor says "No agents yet. Use + Folder or + Workspace above." `[IMPLEMENTED]` read:
- All folders hidden: "All folders are hidden. Open Folders above to show them again." `[IMPLEMENTED]` read:
- A status filter that matches nothing: an empty-state message. `[IMPLEMENTED]` read:
- More than ~15 agents plus many helpers, or 15 single-agent folders with the chat open at 1280x800: the layout falls to `micro`, and past that the floor scrolls
  **inside itself** (page never scrolls). `[IMPLEMENTED]` sim: (README; `?sim=30` stress check)
- The simulator clamps `N` to 1-40. `[IMPLEMENTED]` read:
- Long names and intents truncate with a tooltip holding the full text. `[IMPLEMENTED]` sim:
- Window resize / opening the chat re-runs the layout search (about 150-200 ms at 15 agents in headless software rendering per README); cached otherwise. `[IMPLEMENTED]` sim:

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** `[IMPLEMENTED]` re-verified 2026-10-16: The office renders one **room** per folder/workspace file (nameplate, path, status dots) and one **desk** per top-level agent.
- **FR-002** `[IMPLEMENTED]` re-verified 2026-10-16: The renderer picks the richest density that fits at scale 1 from `full`, `roomy`, `card`, `mini`, `micro` (candidate list in that order, each with 3 or 1 helpers shown), by rendering trial layouts into a hidden probe.
- **FR-003** `[IMPLEMENTED]` read: The density is computed from the unfiltered agent set so status filters do not change card shapes.
- **FR-004** `[IMPLEMENTED]` re-verified 2026-10-16: No declared font size is below 10.5px (`styles.css`: smallest is 10.5px); measured minimum in the rendered office at SIM=15 was 10.5px (1280x800) and 11px (1440x900).
- **FR-005** `[IMPLEMENTED]` re-verified 2026-10-16: At SIM=12 and SIM=15, at 1440x900 and 1280x800, there is no page overflow and the floor does not scroll.
- **FR-006** `[IMPLEMENTED]` sim: Status is shown by the desk scene (typing hands, thought bubble, waving hand, `!` screen, check, mug), a coloured status word and a badge icon; never colour alone.
- **FR-007** `[IMPLEMENTED]` sim: Waiting-for-you agents sort first, then errors, then stable order; the same for helpers inside a strip and for the agent strip in the chat (feature 005).
- **FR-008** `[IMPLEMENTED]` sim: Top-bar status pills count top-level agents and toggle a status filter; a folder dropdown filters by room.
- **FR-009** `[IMPLEMENTED]` sim: Helpers: `full` shows up to 3 beside the parent; compact densities show 1 or 3 (3 chosen when the layout fits, otherwise leftover space boosts agents with the most helpers) then a `+N more` chip that expands in place.
- **FR-010** `[IMPLEMENTED]` read: List view: table of agents with helpers indented, honoring status and folder filters.
- **FR-011** `[IMPLEMENTED]` sim: Updates are keyed: rooms, units, desks and helper tiles are matched by id; only changed text/attributes are patched; a desk scene is replaced only when status or look changes.
- **FR-012** `[IMPLEMENTED]` read: Compact scenes use CSS-only animation (no blur filter, no SMIL); `prefers-reduced-motion` stops animation.
- **FR-013** `[IMPLEMENTED]` read: A **Demo** toggle shows a static sample office (`demo.js`) next to live/simulated agents.
- **FR-014** `[IMPLEMENTED]` read: Each room has a **+** to start another session in that folder (feature 006).
- **FR-015** `[KNOWN GAP]` The 10.5px floor and the "no overflow at 15 agents" guarantees are checked by hand with screenshots/scripts, **not** by an automated test; a regression would not fail `npm test` or CI. (Task T020.)
- **FR-016** `[KNOWN GAP]` README milestone-5 table says SIM=15 at 1280x800 with the chat closed uses `card`; running it on 2026-10-16 (xvfb, frozen and unfrozen) chose `mini`. Both fit; the README table (or the layout search) drifted. Not investigated (font metrics of the headless environment may differ). (Task T021.)
- **FR-017** `[KNOWN GAP]` In `micro` the helper figures are very small (~34px wide), and long folder names truncate the nameplate when narrow (README "Remaining").
- **FR-018** `[KNOWN GAP]` No record exists of 15 real live sessions running at once (cost); the layout is verified on simulated agents only.
- **FR-019** `[KNOWN GAP]` Keyboard navigation of the office (arrow keys between desks) is not implemented; desks are focusable buttons only. `read:`

### Key Entities

- **Room**: folder or workspace file; has name, path, tint, hidden flag.
- **Agent (desk)**: id, name, role, room, state (`working|thinking|waiting|idle|error|done`), intent/task, usage, helpers.
- **Helper**: a sub-agent card owned by an agent (`parent`), created from `subagent` events.
- **Density**: one of `full | roomy | card | mini | micro` plus helpers-shown (1 or 3).

## Success Criteria *(mandatory)*

- **SC-001**: 15 simulated agents fit on 1440x900 and 1280x800 with no page/floor scroll and no text under 10.5px (re-verified 2026-10-16).
- **SC-002**: Waiting and error agents are first in every room and in the strip.
- **SC-003**: A tick that changes one agent replaces at most that agent's scene (README measurement, `sim:`).

## Assumptions

- Simulated agents (10-15 with 0-6 helpers) are representative of real ones; real helper counts and intents may be longer.
- Chromium (Electron 44) text metrics are consistent across OSes; this is **not verified** on macOS/Windows.

## Changes

### 2026-10-16: helper strips overlapped desk cards; closed rooms left the floor half empty (bug, m7b)

**What was wrong.** At SIM=15, 1440x900, with three rooms closed (`?closed=mcp-swiss,blog,infra-notes`), the helper strip under Elif (`Types / Tag / Diff / +3 more`) was drawn over Priya's and Tomas's desk cards, and the strip under Kenji (`Tests`) had a stray background box. Cause: a CSS class collision. The compact helper strip used the class `strip` (`.helpers.strip`), and the full-screen chat's agent bar (feature 005) also defines a global `.strip{height:64px;background:var(--surface-2);border-bottom:1px solid var(--line);align-items:center}`. The helper strip therefore got a fixed 64px height, a filled background, a bottom border and vertically centred content. A strip with one row of helpers (44px) fitted by luck; once the layout search chose 3 helpers shown (`roomy`, helper cap 3, i.e. two rows plus `+N more`) the strip kept 64px, overflowed its unit and the next grid row started underneath it. The probe that measures whether a layout fits used the same CSS, so it measured the same wrong height and reported `fit: ok`. m5/m6 screenshots had no two-row strips at that size, so nothing overlapped.

Second problem: with rooms closed (only 2 of 5 rooms open) the best candidate was `roomy`, because `full` missed the floor by a few pixels with 3 helpers per parent and there was no `full` candidate with fewer helpers. The lower half of the 1440x900 floor stayed empty.

**What is now required.**

- **FR-020** Helper strips (class `hstrip`) must not share class names with other components; a strip is as tall as its content (rows of `--hh` plus gaps) and has no background, border or fixed height. The layout probe measures the real height.
- **FR-021** In the office, no bounding box of a desk card, helper tile, `+N more` / `Show fewer` chip, helper strip or door plate may intersect another one (tolerance 0.5px), none may extend outside its room (or the floor, for plates), and the floor must not scroll or overflow, for SIM=12 and SIM=15 at 1440x900 and 1280x800 with 0, 1, 3 and all rooms closed and with `?closed=` variants. Checked by `npm run check:office` (T025).
- **FR-022** When rooms are closed the open rooms use the freed space: the layout search is run for the open rooms only (plates take one short row), and the candidates are `full` with 3 helpers, `full` with 2, `roomy` with 3, then the existing smaller ones. `full` shows its parameter number of helpers (3 or 2), then `+N more`.

**Acceptance scenarios that would have caught it.**

1. Given SIM=15 at 1440x900 with `?closed=mcp-swiss,blog,infra-notes`, when the office is laid out, then `npm run check:office` reports 0 overlaps and 0 clipped boxes, and the stage height is greater than the `roomy` layout's (the freed space is used).
2. Given any combination listed in FR-021, the check reports 0 overlaps, no floor scroll and no helper strip with a computed background or fixed height.

Tasks: T020 (automated office checks) is delivered together with T025; T026 fixes the class collision; T027 adds the `full`/2 candidate. Spec text for FR-002 and FR-009 is amended accordingly in the converge step below.

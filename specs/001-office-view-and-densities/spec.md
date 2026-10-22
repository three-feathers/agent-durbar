# Feature Specification: Office view, densities, list view and filters

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: index
title: Office view, densities, list view, filters
status: implemented; delta 2026-10-18: main agents show their session title (issue #126); delta 2026-10-18: room headers fit with many one-agent folders (FR-023/FR-024); short names not cut by a long status (FR-025); delta 2026-10-19: arrow keys between desks (FR-019); delta 2026-10-19: first-run welcome (FR-026); delta 2026-10-21: live activity on the desks (FR-028..FR-032: thinking, tool or reply on the desk, side panel when there is room); delta 2026-10-21: faster layout search, same layout (FR-033, SC-004); delta 2026-10-22: grown desks when there are few agents (FR-041..FR-046, simulator-checked; owner decisions 2026-10-22: grown desks before the side panel, a wide grown desk shows more in columns, FR-047..FR-050); T024 closed 2026-10-21 by the owner's hand-check on macOS (daily) and Windows (with a colleague), not a scripted check, no real-machine screenshots
-->

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
- **FR-002** `[IMPLEMENTED]` re-verified 2026-10-16: The renderer picks the richest density that fits at scale 1 from `full`, `roomy`, `card`, `mini`, `micro` (candidate list in that order: `full` with 3 or 2 helpers shown, `roomy`/`card`/`mini`/`micro` with 3 or 1 helpers shown), by rendering trial layouts into a hidden probe.
- **FR-003** `[IMPLEMENTED]` read: The density is computed from the unfiltered agent set so status filters do not change card shapes.
- **FR-004** `[IMPLEMENTED]` re-verified 2026-10-16: No declared font size is below 10.5px (`styles.css`: smallest is 10.5px); measured minimum in the rendered office at SIM=15 was 10.5px (1280x800) and 11px (1440x900).
- **FR-005** `[IMPLEMENTED]` re-verified 2026-10-16: At SIM=12 and SIM=15, at 1440x900 and 1280x800, there is no page overflow and the floor does not scroll.
- **FR-006** `[IMPLEMENTED]` sim: Status is shown by the desk scene (typing hands, thought bubble, waving hand, `!` screen, check, mug), a coloured status word and a badge icon; never colour alone.
- **FR-007** `[IMPLEMENTED]` sim: Waiting-for-you agents sort first, then errors, then stable order; the same for helpers inside a strip and for the agent strip in the chat (feature 005).
- **FR-008** `[IMPLEMENTED]` sim: Top-bar status pills count top-level agents and toggle a status filter; a folder dropdown filters by room.
- **FR-009** `[IMPLEMENTED]` sim: Helpers: `full` shows up to 3 beside the parent; `full` shows 3 or 2 when 3 does not fit; compact densities show 1 or 3 (3 chosen when the layout fits); leftover floor space then boosts the agents with the most helpers one step (1 -> 3, 2 -> 3, 3 -> 6 shown); the rest go behind a `+N more` chip that expands in place.
- **FR-010** `[IMPLEMENTED]` read: List view: table of agents with helpers indented, honoring status and folder filters.
- **FR-011** `[IMPLEMENTED]` sim: Updates are keyed: rooms, units, desks and helper tiles are matched by id; only changed text/attributes are patched; a desk scene is replaced only when status or look changes.
- **FR-012** `[IMPLEMENTED]` read: Compact scenes use CSS-only animation (no blur filter, no SMIL); `prefers-reduced-motion` stops animation.
- **FR-013** `[IMPLEMENTED]` read: A **Demo** toggle shows a static sample office (`demo.js`) next to live/simulated agents.
- **FR-014** `[IMPLEMENTED]` read: Each room has a **+** to start another session in that folder (feature 006).
- **FR-015** `[IMPLEMENTED]` partly, 2026-10-16: `npm run check:office` (`scripts/check-office-overlap.js`, Electron under xvfb) automates overlap/clipping/floor-overflow/10.5px checks (FR-021) over SIM=12/15 x 1440x900/1280x800 x closed-room variants. It is not part of `npm test` (needs a display); it runs in CI as job `office-check` (Ubuntu, xvfb, ~70 s, spec 008 FR-017). (Task T020.)
- **FR-016** `[IMPLEMENTED]` (resolved 2026-10-16, Task T021) The README milestone-5 table had drifted. Re-measured with `npm run check:office` (xvfb, all rooms open, chat closed): SIM=12 -> `roomy` at 1440x900 and 1280x800; SIM=15 -> `card` at both (the table's `roomy` at 1440x900 predates the door row; the docked-panel columns predate the full-screen chat). An earlier run that saw `mini` at 1280x800 was not reproduced. Which density is chosen depends on font metrics; the check asserts only that the chosen one fits. The README states the new numbers. test: `scripts/check-office-overlap.js`
- **FR-017** `[KNOWN GAP]` In `micro` the helper figures are very small (~34px wide), and long folder names truncate the nameplate when narrow (README "Remaining").
- **FR-018** ~~`[KNOWN GAP]`~~ closed 2026-10-21 (see Changes): No record exists of 15 real live sessions running at once (cost); the layout is verified on simulated agents only.
- **FR-019** `[IMPLEMENTED]` (2026-10-19, T023) In the office, arrow keys move the focus between desks, helper tiles and closed door plates: Left and Right to the nearest one on the same row (at the end of a row, the next or previous one in reading order), Up and Down to the nearest one above or below; Enter opens the focused desk as before. Arrow keys with a modifier, and in text fields, are left alone. `sim:` a driver pressed the keys and checked the focus (1440x900 and 1280x800).

### Key Entities

- **Room**: folder or workspace file; has name, path, tint, hidden flag.
- **Agent (desk)**: id, name, role, room, state (`working|thinking|waiting|idle|error|done`), intent/task, usage, helpers.
- **Helper**: a sub-agent card owned by an agent (`parent`), created from `subagent` events.
- **Density**: one of `full | roomy | card | mini | micro` plus helpers-shown (1 or 3).

## Success Criteria *(mandatory)*

- **SC-001**: 15 simulated agents fit on 1440x900 and 1280x800 with no page/floor scroll and no text under 10.5px (re-verified 2026-10-16).
- **SC-002**: Waiting and error agents are first in every room and in the strip.
- **SC-003**: A tick that changes one agent replaces at most that agent's scene (README measurement, `sim:`).
- **SC-004** (2026-10-21, FR-033): With 15 simulated agents on three floors, at 1440x900 and 1280x800, a full layout search (`chooseLayout`) takes at most 150 ms (median) and a floor switch (User Timing `durbar:floor-switch`, spec 033 SC-003) at most 200 ms on the reference machine (4-core Linux, Xvfb), and the search picks exactly the layout it picked before.

## Assumptions

- Simulated agents (10-15 with 0-6 helpers) are representative of real ones; real helper counts and intents may be longer.
- Chromium (Electron 44) text metrics are consistent across OSes; this is **not measured** on macOS/Windows (the owner's hand-check of 2026-10-21 reported no layout problem, but sizes were not measured there).

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

Tasks: T020 (automated office checks) is delivered together with T025; T026 fixes the class collision; T027 adds the `full`/2 candidate. 

**Converged 2026-10-16** (what was built): class `hstrip` replaces `strip` for compact helper strips (`styles.css`, `app.js` unitHTML). `CANDIDATES` is `full/3, full/2, roomy/3, card/3, card/1, mini/3, mini/1, micro/3, micro/1`; the helper cap is per layout (`HCAP`) with a per-agent boost map (`HBOOST`), grown one step at a time while the probe still fits. `npm run check:office` over 4 combinations of sim/size and every 0/1/2/3/4/all-closed room subset sample (95 checks incl. Close all / Open all clicks and an expanded `+N more`) passes; the same check run against the pre-fix `app.js`/`styles.css` fails (overlaps, helpers outside their room/unit). Screenshots: `docs/screenshots/m7b-*.png`. Not verified: macOS/Windows rendering, real (non-simulated) agents, the check in CI.

### 2026-10-17: lobby from spec 024 (cross-reference, no change to this spec's requirements)

Spec [024](../024-office-places/spec.md) adds a one-row **lobby** band between the first and second half of the open rooms. It is part of the HTML that the density search probes, so the fit counts it; `npm run check:office` also checks it. With 15 simulated agents this moves 1280x800 from `card` to `mini` desks (1440x900 stays `card`, fewer helper rows). Desks of agents at a place show an empty chair and `At <Place>: <tool>`.

### 2026-10-18: main agents show their session title (issue #126)

*Symptom:* sub-agents show their names, but a main agent's card shows the folder name (with `#2`, `#3` for more sessions in the same folder), so several sessions in one folder look alike. *Corrected:* when a main agent has a session title (spec 002, 2026-10-18), its card at every density, the chat header, the list view, the full-screen strip, the lobby visitor labels and toasts show the title instead of the folder name; the folder stays visible in the room header and in the card's tooltip and accessible name ("title, in folder"). Without a title nothing changes. Titles are escaped and ellipsized, never wrapped; the full title is in the tooltip. The simulator gives some main agents a title (opt-in `simtitles=1`, so default simulator pictures do not change) so the office check and the screenshots cover it.

### 2026-10-18: one-agent folders: room headers overflowed and the office fell back to scrolling (sweep, owner's request)

*Symptom.* With 15 folders of one agent each (`simrooms=solo`) at 1440x900 and 1280x800, the narrow rooms (226 px, header 206 px) needed 247-302 px for their header controls: the "+" and MCP buttons and the status dots spilled past the room, the plant sat on top of the "+" button, the MCP button was cut off, and room names were cut while other headers had room. The overflow also made the stage wider than the floor, so the layout search rejected every density and the office was marked `scroll` although it fitted vertically. `check:office` never tried one-agent folders and only checked header controls for sticking out with floor tags on.

*Violated.* FR-021 (no overlapping or clipped text; the office fits at 1440x900 and 1280x800), constitution V.

*Corrected.*
- **FR-023** `[IMPLEMENTED]` A room header fits its room at every width: the room name gives way first (ellipsis, full name in its tooltip, after the folder path); in a room narrower than 340 px the plant is hidden and the MCP button is tighter; narrower than 280 px the folder's credit total leaves the header and is shown in the room name's tooltip (spec 011 FR-020 delta). Controls never overlap each other or the plant, and never leave the header; in `full` density the header keeps room for the plant after its last control (before, the plant covered the MCP button). `test:` `npm run check:office` (215 checks, CI fonts), `sim:` `docs/screenshots/001-solo-folders-1440x900.png` and `-1280x800.png`.
- **FR-024** `[IMPLEMENTED]` `check:office` adds one-agent folders (`simrooms=solo`) for 12 and 15 agents at both sizes, and in every combination fails when two header controls (or a control and the plant) overlap, or a control leaves its header.

### 2026-10-18: a short agent name was cut to one letter next to a long status word (sweep)

*Missing:* in `mini` and `micro` density the status word (`Limit reached`, `Waiting for you`) never shrank, so in a narrow card the agent's name gave way alone and could end as `O…`.

*Corrected:*
- **FR-025** `[IMPLEMENTED]` In `mini` and `micro` the name and the status word share the line: the status word gives way first (down to about two characters and an ellipsis); the name is not shrunk by the status and is cut only when it is longer than the line minus the mode icon and that short status. So a short name stays whole (`Omar  Limit r…`, before `O…  Limit reached`) and a long one keeps far more than three characters. The full status is still on the card's tooltip and colour. `check:office` fails, in every combination, when a cut desk name shows fewer than three characters (measured in the page with the same font).

### 2026-10-19: a first-run welcome (sweep)

*Found:* with no folder yet, the office showed one grey line ("No agents yet. Use \"+ Folder\"…"), with nothing about signing in to Copilot, what a folder becomes, or the Read-only default.

*Corrected:*
- **FR-026** `[IMPLEMENTED]` With no agents (and the demo off), the office shows a welcome card: three steps (sign in to Copilot once with `copilot login`; add a project folder, which becomes a room whose agent starts in Read-only; send a message, and use Ask first or Allow all only for trusted folders), **+ Add a folder** (the toolbar's own action) and **Look around in the demo** (switches the Demo toggle on), and one line that agents run as you and use your plan's AI credits. Other empty states (all folders hidden, all floors off) are unchanged. `sim:` the real app with a fresh user-data folder at 1440x900 and 1280x800.


### 2026-10-19: positioning, many harnesses and anyone with agents (owner)

*Owner, 2026-10-19:* "our target is muti harness and not only for coders/developers - anybody can use it for their agents".

- **FR-027** `[IMPLEMENTED]` Everything that describes the app says the same thing: Agent Durbar is a calm command center for **AI agents**, across **several harnesses** (GitHub Copilot, Claude Code, Codex in progress), for **anyone who works with agents**, not only developers. A room is any folder an agent works in: code, documents, research or notes.
  - The welcome card (FR-026) names the harnesses: sign in to one of them. It says "folder", not "project folder", and the note speaks of "your own plan", not only Copilot's AI credits.
  - The "About agent kinds" dialog says "agent harness", not "coding agent".
  - The README tagline, intro and Vision follow this, as do `package.json` `description` and the GitHub repository description and topics.
  - Honest limits stay: Codex is not offered yet, and agents still act on files in the folders you add.
  - The header badge says **Live**, with the ready harnesses in its tooltip; it no longer says "Live - Copilot". The harness select is 128 px wide, so "GitHub Copilot" is no longer cut to "GitHub Cc".
- `sim:` `scripts/shots-001-welcome.js` (new; a real app with an empty profile, no prompt) at 1440x900 and 1280x800 checks the wording and that the card fits; the screenshots are replaced. `check:office` 302/302.

### 2026-10-21: known gaps revalidated

- **FR-018** closed. `real:` 2026-10-21, Linux, the built app with an isolated profile: **15 real Copilot sessions** (`auto`, Read-only, 15 throw-away folders) in the office at once. Each answered a one-line prompt, and all 15 cards ended *Done*. Then the simulator office check's own page rules (`pageCheck`: overlap, clipping, text at least 10.5px) ran on the real page: **no problems at 1440x900 or 1280x800** (smallest text 11px, density `roomy`). Durbar showed about $0.01 in total.
- `[KNOWN GAP]`: on that real page at 1280x800, the bottom row's wider cards cut a small icon at the card's right edge, which `pageCheck` does not flag. Handed to the usability pass.
- **FR-017** still open, unchanged (the `micro` density is used only with many agents in a narrow window).

### 2026-10-21: live activity on the desks (owner)

*Owner, 2026-10-21 (team chat):* "When an agent is working, thinking, can we stream thinking and updates to the office screen? I don't like going inside the chat just to see what is happening. When we have enough space on the side of the desk (when there are not many agents horizontally) show it there, else show it in the space where we have the name of the agent."

*Found (existing capability):* the desk already has a text line under the name (`taskOf(a)`: `.task` in `full`, `.intent` in the card densities) that the live event path in `app.js` (`onLiveEvent` -> `setState`) sets to "Thinking" or `<tool> <argument>` when a tool starts. Thinking text, the reply as it streams and plain tool words reach only the chat (`tThink`, `tText`, `tTool`). The normalized events already carry everything needed (`thinking` deltas, `output` deltas, `toolCall` start with `args`), so no adapter changes: this is renderer-only and adapter-neutral (constitution II).

*Added:*
- **FR-028** `[IMPLEMENTED]` **Live readout.** While a main agent is busy (Working or Thinking), its desk shows one live readout built from its own normalized events (helpers' events do not change it):
  - thinking: `Thinking: <latest sentence>` of the current reasoning block (Markdown removed, whitespace collapsed, cut with the shared cutter);
  - a tool that starts: a verb phrase from the existing tool words (`toolKind`, `toolLabel`): `Reading src/x.ts`, `Editing src/x.ts`, `Running npm test`, `Searching registerTool`, `Opening https://…`, else `Using <tool>`; in **Simple** the plain chat words (`plainChip`, spec 052 FR-081: `Reading x.ts`, `Running a command`), so Simple never shows a command;
  - the reply as it streams: `Replying: <latest sentence>`.
  The newest event wins. Waiting, Error, Done and Idle keep today's text (a request for you is never hidden by the readout). It is cleared when the turn ends, is stopped or the session ends.
- **FR-029** `[IMPLEMENTED]` **Where it shows.** Grown desks (FR-041..FR-043) come first whenever they fit at *f* 1.1 or more (owner decision 2026-10-22, below). Otherwise the layout search (FR-022) first tries `full` desks with a **side panel** to the right of every main desk (about 200 px, fixed size, reserved whether or not the agent is busy, so the office never shifts when an agent starts or stops). It is used only when that layout fits the floor like any other candidate (no extra threshold: few agents across, wide window). The panel shows the readout over up to five lines (the latest sentences of thinking or the reply, a tool phrase) under a small kind word (Thinking, Working, Replying). When the side panel does not fit (many agents, or a narrow window), the readout takes the desk's text line under the name (`full` `.task`, card `.intent`), in the same clamp and box, so nothing moves. The **name stays visible** on the desk in both cases, and is also in the desk's tooltip and accessible name.
- **FR-030** `[IMPLEMENTED]` **Calm updates.** The readout is repainted at most 4 times a second per desk (text only, by `textContent`; no re-layout of the office), only when its text changed, with no animation (no typing effect or fade, so `prefers-reduced-motion` and Serious mode need nothing more). Text is at least 10.5 px, uses theme tokens only (`--ink-2`, `--muted`, the status colours), and 15 agents still fit at 1440x900 and 1280x800 with no overlap (`check:office`, `check:geometry`).
- **FR-031** `[IMPLEMENTED]` **No secrets.** Every readout goes through the shared masking in `src/shared/redact.ts` before it is shown: a command through `maskSecretCommand`, a URL through `maskSecretUrl`, everything else (paths, thinking and reply text) through `redact`. The page loads the compiled `dist/shared/redact.js` (it has no imports), so there is one masking code path, not a renderer copy. The readout is display only: never stored, logged or sent anywhere. `[KNOWN GAP]` The page does not know the agent's environment values, so a secret that matches no `redact` pattern (a plain password in prose, say) is not masked; the chat shows the same text unmasked today.
- **FR-032** `[IMPLEMENTED]` **Setting.** Settings > General has **Live activity on desks** (on by default), kept per computer like Spacing (`localStorage` `durbar.liveActivity`). Off: the desk text is exactly today's, and the layout search never tries the side panel.
- **Owner decisions** (Vikram, Telegram 2026-10-21): the four defaults asked in PR #458 are kept. (1) In a busy office the desk keeps the agent's **name**; the readout goes in the line(s) under it (FR-029). (2) The side panel is used **whenever it fits**, with no fixed threshold (FR-029); *replaced 2026-10-22 by the owner*: grown desks come first when they fit, then the side panel whenever it fits. (3) The side-panel layout is **preferred over showing more helper tiles** (FR-029). (4) **Waiting and Error** desks keep their request text, with no readout in the panel (FR-028).
- `test:` `npm run test:liveact` (the readout rules, masking, throttle); `sim:` `scripts/shots-001-live-activity.js` (simulator, `DURBAR_SIM=15` and 3 agents, 1440x900 and 1280x800: side panel in the sparse office, the text line in the dense one, no overlap, text at least 10.5 px, the setting off restores today's text). `check:office` (360/360; it now also checks side panels for overlap) and `check:geometry` (66/66) pass on Linux. Not checked on a real session (no credits spent): the readout uses the same normalized events the chat already shows for Copilot, Claude Code and Codex.

### 2026-10-21: a faster layout search (finding in PR #457, owner: "snappy and flicker-free")

*Finding.* PR #457 timed a floor switch (spec 033 SC-003) at about 220-310 ms of the app's own work on a 4-core Linux box, most of it in the layout search (`chooseLayout`), against 55-84 ms recorded in spec 033 on 2026-10-17. Ruben's agent measured 534 ms on a busy server, already without the CPU wait (#454), so the app's own work is near the 500 ms budget on slower machines. On a quiet 4-core server (issue #454, Ruben's comment of 2026-10-21) `shots-033` on `main` failed 3 of 3 runs, always at 1280x800: 536, 624 and 817 ms there (CPU wait 2-20 ms, already subtracted), against 322-350 ms at 1440x900.

*Cause (measured, `sim:`, same machine, an instrumented build).* Not one regression. The search renders every candidate (about 16 trials at 1440x900, 19 at 1280x800) into the hidden `#probe` and measures it, and each trial parsed, styled and laid out the whole stage again, desk drawings included. Its cost grew with the app: at the spec 033 merge (`a48c05a`) a search already took 289-396 ms here (median of 9), at 841 style rules and 1301 stage elements; on `main` (`2e80f94`) 450-530 ms, at 1597 style rules and 1366-1531 elements (largest step: the usability pass, `de14af9` to `3018627`, +35%). The 55-84 ms of 2026-10-17 cannot be reproduced on this machine with that commit, so it was measured another way or on a faster machine (`read:` its Verification line does not say). Per trial on `main`: style recalculation about 7 ms, layout about 1.5 ms, parsing 5 ms, the HTML 1 ms; two thirds of the elements are the SVG drawings inside the desks. 1280x800 is slower because the search goes further down the candidate list: with 15 agents on three floors `card` does not fit there, so it tries `full` x2, `roomy`, `card` with 3 and with 1 helper (4 column counts each), then `mini` (19 trials), where 1440x900 stops at `card` with 1 helper (14 trials plus 2 helper boosts); the compact trials after the first of each density are the ones FR-033 makes cheap, so after the change both sizes take about the same time. A status change does not run the search (its result is kept until the office's shape changes); such a render takes 2-4 ms.

- **FR-033** `[IMPLEMENTED]` The layout search measures the same boxes with less work, and picks exactly the layout it picked before:
  - a trial keeps every `<svg>` tag with its attributes and leaves out what is inside it (`src/renderer/probe.js`, `svgHollow`); an `<svg>`'s box comes from its attributes and CSS, never from its children;
  - a trial that differs from the one before only in style attributes (the compact search changes only each room's `--w`, `--min` and `--cols` from one column count to the next) sets those values in place instead of parsing the stage again (`styleSplit`, `probeSet` in `app.js`); anything else replaces the probe's content as before;
  - `--w`, `--min` and `--cols` are registered as not inherited (`@property ... inherits:false`); only the element that carries them reads them, so a new value restyles the rooms, not every desk inside them. `test:probe` fails if another rule or file starts reading them.
- `sim:` before and after on the same machine, run alternately (8 switches each way per size, an instrumented copy of the build): floor switch (`durbar:floor-switch`, median) **438-445 ms -> 139-146 ms** at 1440x900 and **520-526 ms -> 134-142 ms** at 1280x800; `chooseLayout` **388-401 -> 97-105 ms** and **474-480 -> 97-102 ms**. Same layout: 54 cases (6 window sizes x all floors, one off, Show only on two floors, 2 and 5 rooms closed, reopened, a status filter, an expanded `+N more`), 22 different layouts among them (every density, boosts, one that does not fit), gave the same chosen layout and the same box (to 0.5 px) for every room, plate, desk, helper and `+N more` before and after. Re-measured after merging PR #458 (live activity, which adds side-panel `full` candidates and makes the search slower on `main`), alternately, 2 rounds: floor switch **496-598 ms -> 167-174 ms** at 1440x900 and **548-646 ms -> 164-182 ms** at 1280x800; `chooseLayout` **455-554 -> 129-135 ms** and **506-594 -> 126-137 ms**; the 54 cases (23 different layouts) again identical to `main`, box by box; `shots-033` 114 ms (1440x900) and 113 ms (1280x800). `check:office` 360/360 and `check:geometry` 66/66 pass (before the merge); `shots-033` passes with the switch at 84 ms (1440x900) and 108 ms (1280x800) of the app's own time, against 199-311 ms recorded in PR #457. Not timed on macOS, Windows or a slower server.

### 2026-10-22: the office uses the space when there are few agents (owner)

*Owner, Vikram, Telegram 2026-10-22 09:32 UTC:* "We are wasting a lot of space and not showing thinking,.. when we don't have many agents like this. Can we have efficient use of space?" His screenshot (his own data, not stored anywhere) showed a 1280x744 window with 2 folders and 6 desks: small fixed tiles in one row per folder, the lower half of the office empty, a thinking desk cut to its first words, done desks with two cut lines and titles cut on one line.

*Found:* the layout search (FR-002, FR-022, FR-029) only chooses among fixed sizes. When `full` does not fit (with or without the side panel), it falls to `roomy` cards of a fixed 92 px height, so a handful of agents leaves most of the floor empty and each card shows one or two cut lines. Where `full` with the side panel fits (1440x900), the desks are fixed illustrations and the lower part of the floor still stays empty. Nothing grows.

*Existing capabilities reused (no parallel layout system):* the layout search `chooseLayout` in the hidden `#probe` with `probeSet` (FR-033), the `roomy` card (`cardHTML`) and its column search (`--cols`, `--cmax`), the desk text line and the live readout (FR-028..FR-031: `liveact.js`, `paintLive`, the bottom-anchored fade `fitSide` of the side panel), the usage line and its fitting (`fitUsage`).

*Added (owner defaults, stated and not asked: desks grow up to about 2.5x; the stream shows the newest lines; the layout picks the largest size where everything fits without scrolling):*
- **FR-041** `[IMPLEMENTED]` **Grown desks.** A `roomy` card can grow by a factor *f* from 1.0 to 2.5 in steps of 0.1: its height is 92 px x *f*, its column may be up to 400 px x *f* wide (the grid still stretches columns to the room's width), and its drawing is up to 1.6x wider. Text keeps its size (calm; never under 10.5 px). *f* = 1.0 is today's `roomy` card exactly.
- **FR-042** `[IMPLEMENTED]` **Picking the size.** After the existing search (FR-002, FR-022, FR-029) has picked a layout, and only when it picked `full` or `roomy`, the search tries grown `roomy` desks: for each column count it finds the largest *f* (binary search over the 0.1 steps) at which the whole office still fits the floor with no page or floor scroll, measured in the same hidden probe. The largest *f* wins; at the same *f*, the layout that fills more of the floor's height, then the one with fewer columns (wider desks, rows of equal length). Grown desks replace `full` or `roomy` when they fit at *f* 1.1 or more. `card`, `mini` and `micro` never grow, so the simulator's 15 agents (5 folders with helpers) at 1440x900 and 1280x800 lay out exactly as before (FR-005, SC-001); fewer folders or a larger window may leave room to grow, and then they do; a forced density (`?density=`, a developer setting) never grows. As agents are added, *f* never grows and ends at 1.0 (today's `roomy`), then the existing densities follow; it can drop several steps at once when a new row or column is needed (amended by the review delta below). The helper boost (FR-009) runs after the size is chosen, with what is left. Only the layout search's cost changes, and only when it picked `full` or `roomy` (few agents): SC-004 (15 agents) is unchanged.
- **FR-043** `[IMPLEMENTED]` **A grown desk shows more.** Its title (the agent's name or session title) takes up to 2 lines once *f* is at least 1.4; the status pill with tokens and cost stays on its own line (`fitUsage` as before); the text area fills the rest of the card, at most 8 lines:
  - a busy main agent with a readout (FR-028): its kind word and the newest sentences of the current thinking block or reply (up to 600 characters, masked by `redact` as in FR-031), or the tool phrase; the newest words stay at the bottom and older lines leave at the top with a fade (the side panel's rule);
  - a Done or Idle agent with a reply in this session: an excerpt of its last reply, from its start (masked by `redact` on the raw text, then Markdown removed, cut at 600 characters; without the mask, `Finished.` or `Ready.`: see the review delta below);
  - otherwise (Waiting, Error, a request, no reply yet): today's desk text, now with room for all of it.
  The card's height never depends on its text, so text that streams never moves anything (FR-030: painted by `textContent` at most 4 times a second, no re-layout, no animation). With *Live activity on desks* off (FR-032) there is no readout; the rest still applies.
- **FR-044** `[IMPLEMENTED]` **Folders share the space.** Rooms keep the existing flex rows: because the column search runs over grown desks too, a folder with one or two agents takes one or two columns and sits next to another folder instead of a full-width row of small tiles, when that gives larger desks. The lobby (spec 024) and closed rooms' door plates stay one compact row and never grow. `[KNOWN GAP]` With exactly two open folders the lobby sits between them (spec 024 FR-004), so those two never share a row; a folder with one agent then has one wide grown desk on its row rather than small tiles. Moving the lobby is left to the lobby's own spec (open PR #511 changes it).
- **FR-045** `[IMPLEMENTED]` **Calm and legible at every size.** Text is at least 10.5 px, colours are theme tokens only, the size changes only when the office's shape or the window changes (as the layout already did), with no animation, so reduced motion needs nothing more. No desk, helper, chip, plate or side panel overlaps another and nothing leaves its room at any window from 1024x700 to 2560x1440 (checked at 1024x700, 1280x800, 1440x900, 1920x1080 and 2560x1440).
- **FR-046** `[IMPLEMENTED]` **Checks.** `npm run test:probe` (pure: `src/renderer/probe.js` `pick` picks the largest *f* that fits, never above 2.5 or below the minimum, in 0.1 steps, with the tie rules; and a box model of 1, 2, 4, 6, 10 and 15 agents in 1 to 3 folders at 1280x800, 1440x900 and 1920x1080 shows *f* never grows when agents are added). `npm run check:office-fill` (simulator driver, also in `check:ui`): the same counts, folders and sizes plus 1024x700 and 2560x1440 in the real page: the office fits with no scroll, the office page rules hold (overlap, clipping, text at least 10.5 px), 1 and 2 agents get grown desks, the size never grows when agents are added, and the simulator's 15 agents (5 folders, helpers) never get grown desks at 1440x900 and 1280x800. The simulator gains `simrooms=1..5` (agents spread over that many folders) and `simhelpers=0` (no helpers).
- **Changed:** FR-029's order. Grown desks come before `full` and its side panel whenever they fit at *f* 1.1 or more: they show the same readout inside the desk with more lines (up to 8, against the panel's 5) plus the title, tokens and cost. `full` and the side panel remain for offices where grown desks do not fit but `full` does (many helpers beside few desks), and with `?density=full`. This changes the owner's decision (2) of 2026-10-21 ("the side panel whenever it fits"); the owner confirmed it on 2026-10-22 (see *Owner decisions* in the delta below).
- *Result (2026-10-22, Linux, Xvfb, simulator only, no credits):* `check:office-fill` passes 64 layouts (for example 6 agents in 2 folders: `roomy` *f* 2.5 at 1440x900, 76% of the floor, against `full` with side panels before; 6 agents with the simulator's helpers at 1280x800: *f* 2.0, 95% of the floor, against 92 px `roomy` cards before; the simulator's 15 agents: `card` at 1440x900 and `mini` at 1280x800, as before); `check:office` 386/386; `check:geometry` 72/72 (SIM=12 grows the same in every theme); `shots-001-live-activity` and `shots-033` pass (floor switch 133-167 ms); `test:probe` (with two mutations killed: the height tie-break reversed, growth from 1.0); `test:liveact` 84 checks; `npm test`. Screenshots: `docs/screenshots/001-fill-{4,6,15}-{1440x900,1280x800}.png`. Not checked: a real session (the text uses the same normalized events as FR-028), macOS and Windows fonts (the size is measured in the page, so a different font gives a different but fitting *f*), the owner's own office.

### 2026-10-22: review of PR #532 (rubenlupi): masking order, cost per delta, honest sizing

*Found (review of #532, head 1283afd8):*
1. The grown desk's reply excerpt (FR-043) ran `redact(plain(lastOutput))`. `plain` strips `_`, `*` and backticks first, so `ghp_…` became `ghp…`, `github_pat_…` became `githubpat…` and the mask no longer matched: a token showed on the desk. Checked further while fixing it: even masking first, a token wrapped in Markdown underscores (`_ghp_…_`, `__sk-…__`) slipped past `redact`, because its patterns started at `\b`, and there is no word boundary between `_` and a letter.
2. Every thinking or reply delta computed the grown readout (`long`) too, even when no desk is grown: about 1.5x slower than before on 4000 deltas.
3. After a grown render `GROW` stayed 1 into the next layout search, so its `full`, `roomy` and `card` trials built grown text.
4. FR-042 said *f* "falls one step at a time" and "goes down smoothly". It does not: *f* is the largest size that fits, so it jumps when the number of rows or columns changes (2 folders at 1280x800: 2.5 with 6 agents, 1.4 with 10).
5. Without the redact module, or when it returned nothing, `grownLine` fell back to the desk text, which for a Done agent is the unmasked start of the reply (`taskOf`; issue #541, which the reviewer is fixing on `main`).

*Changed:*
- **FR-043** (amends the Done/Idle bullet): the excerpt is built by `DurbarLiveAct.excerpt(raw, redact)`: masked on the **raw** text first, and only then made plain (Markdown removed) and cut, the order the readout already used (FR-031) and the one #541 uses for the desk text. Without a working `redact` it is empty, and a grown Done desk then shows `Finished.` (Idle: `Ready.`), never text built from the reply (fail closed). The readout's `long` is computed only when a grown desk asks for it (`of()`), once per change of the text.
- **FR-042** (amends the last sentences): *f* is the largest size that fits, recomputed whenever the office's shape or the window changes, with no transition. It never grows when agents are added, but it can drop several steps at once when a new row or column is needed (for example 2 folders at 1280x800: 2.5 with 6 agents, 1.4 with 10; 8 agents: 2.5 at 1200x760, 1.1 at 1100x720, not grown at 1024x700). Limiting the drop would leave floor empty, which is what the owner asked to fix. Each layout search starts with `GROW` off.
- **Spec 012 FR-080 (cross-reference; the change is PR #543's, not this PR's, and #532 merges after it):** the key-shape patterns of `src/shared/redact.ts` (`Authorization`, URL credentials, `gh[pousr]_`, `github_pat_`, `sk-`, `Bearer`, AWS keys) start where no letter or digit precedes them instead of at `\b`, so a leading `_` (Markdown emphasis, `snake_case`) no longer hides a token; an AWS key also ends where no letter or digit follows.
- *Checks:* `test:liveact` cases put `ghp_`, `github_pat_`, `sk-` and `Bearer` tokens through `excerpt` plain, in backticks, bold, `_…_`, `__…__`, a code block and a link, and assert none of the token survives; `test:redact` gains the underscore-wrapped shapes (in #543); `check:office-fill` puts a `ghp_` and a `github_pat_` token in a done reply on a grown desk; `test:probe` checks `chooseLayout` resets `GROW` first. Mutation-checked (plain before redact; `\b` back in redact, before that fix moved to #543).
- *Result (2026-10-22, Linux, Xvfb, simulator only, no credits):* `npm run typecheck && npm run build && npm test` 82/82 suites; `check:office-fill` 64 layouts. Mutations, each killed: `excerpt` masking after `plain` (`test:liveact`); `\b` back on the `gh[pousr]_`, `github_pat_`, `sk-`, `Bearer` shapes (`test:redact`, `test:liveact`); `grownLine` back to `redact(plain(…))` (`test:liveact`, and `check:office-fill` shows `ghpFill0Tok…` on the desk); the fallback back to `taskOf` (`test:liveact`); no `GROW` reset (`test:probe`). 4000 thinking deltas, 3 runs each: 352-495 ms now, 781-814 ms at 1283afd8, 401-557 ms on `main`. Laziness itself has no unit check (an eager `long` gives the same values); the timing covers it.

### 2026-10-22: owner decisions on PR #532; a wide grown desk shows more, in columns (owner)

*Owner, Vikram, terminal 2026-10-22 about 17:50 UTC*, answering the two questions of PR #532:
1. "yes, grown desks take precedence" over the side panel of FR-029 when they fit. **Decided:** FR-029's order as changed by FR-042 above (grown desks first, at *f* 1.1 or more; `full` and its side panel when grown desks do not fit, and with `?density=full`) is the owner's decision of 2026-10-22 and replaces decision (2) of 2026-10-21. FR-029's first sentence now reads with this order.
2. "single desk can stretch across room for additional info of the desk like thinking,.. without make it look ugly". **Decided:** a grown desk may take the whole width of its room when the row has spare width (one agent, or a row with few desks); the extra width carries **more information, not longer lines**.

*Found:* a grown desk's column was capped at 400 px x *f* (1000 px at *f* 2.5), and its text line ran the full width of that column: with one agent at 1440x900 a 1000 px desk showed lines of about 130 characters, and the rest of the room stayed empty.

*Existing capabilities reused (no parallel layout system):* the grown `roomy` card (`cardHTML`, `--gf`, `data-grow`), `grownLine` (FR-043), `DurbarLiveAct.excerpt` (reply masked on the raw text), `fitLines`/`fitSide` (whole lines, bottom-anchored fade), `usageLong` (the chat's usage words), `DurbarScreens.ctxChip` (the chat header's context figure), `ACT.agoLong` (last activity), `DurbarLiveAct.phrase` (tool phrase, masked) and the pure helpers in `src/renderer/probe.js`.

*Added:*
- **FR-047** `[IMPLEMENTED]` **Columns on a wide grown desk.** A grown desk is laid out in up to four columns, chosen from its own width by a pure helper (`DurbarProbe.grownCols`): the illustration on the left; a **main column** with the title, the live thinking or activity stream (FR-043) and the status pill with tokens and cost; a **reply column** with the start of the last reply (masked by `excerpt`, as in FR-043; heading *Last reply*); and a **facts column**: the current or last tool or file this turn (the readout's tool phrase, masked), the usage in the chat's words (calls, tokens in and out, cost), the context window (`Context N%`, Simple: `Memory N% full`; left out while unknown) and the time (*On this task N min* while busy, else *Last activity …*). One column (as before) below about 456 px of text room; two (main, then reply above facts in one side column) from there; three (main, reply, facts) from about 812 px (the main column keeps at least 360 px beside two others). The reply column is left out when there is no reply, or when the main column already shows that reply (a Done or Idle desk, FR-043), and then its space goes to the facts. The columns collapse back to the single-column grown desk as the desk gets narrower.
- **FR-048** `[IMPLEMENTED]` **A readable measure.** No text line on a grown desk is longer than about 85 characters: the main column is at most 450 px wide (a single column stays under 456 px) and the reply column at most 420 px (12 px and 11.5 px text, about 80-85 characters), the facts column at most 320 px (one line each, cut with an ellipsis). A grown desk is at most as wide as its columns need (about 1430 px with the largest illustration); a desk in a wider room keeps that width, aligned left like the rooms. A grown column may be up to that width (so one or two desks can span the room), replacing the 400 px x *f* cap of FR-041.
- **FR-049** `[IMPLEMENTED]` **Still a desk.** The height stays 92 px x *f* (at most 230 px, FR-041), the same for every column count, so the layout search (FR-042) is unchanged and the columns never change the fit. Every column clips to whole lines (the reply ends with an ellipsis, facts are one line each with an ellipsis, the stream keeps its newest lines at the bottom with the fade), text is at least 10.5 px, colours are theme tokens only, no animation (reduced motion needs nothing). The columns are chosen after each render from the desk's measured width and do not change while text streams (FR-030: only text is painted).
- **FR-050** `[IMPLEMENTED]` **Checks.** `test:probe`: `grownCols` (thresholds, widths never above the measure, the reply column only with a separate reply, never more width than given). `check:office-fill`: 1 and 2 agents at 1440x900, 1280x800 and 1920x1080 show the multi-column desk, every grown text line is at most 90 characters (measured per line in the page), nothing overlaps or clips (the office page rules), text at least 10.5 px; streaming text moves no box; the reply column shows the masked reply.
- *Result (2026-10-22, Linux, Xvfb, simulator only, no credits):* `check:office-fill` 70 layouts pass: 1 and 2 agents at 1440x900, 1280x800 and 1920x1080 get *f* 2.5 desks with 3 columns (1376, 1214 and 1417 px wide, 230 px tall), longest line 81-87 characters; the 6-agent and 15-agent layouts are as before. `check:office` 386/386; `npm run typecheck && npm run build && npm test` 86/86 suites. `test:probe` `grownCols` cases. Mutations, each killed: main column max 520 px, a reply column without a reply, the width share unclamped, the two-column side at the reply's range without a reply (`test:probe`); the last tool kept after a new message, the last tool not kept (`test:liveact`); the main column stretched to the rest of the desk (`check:office-fill`: lines of 97-113 characters, columns overlapping). Screenshots: `docs/screenshots/001-fill-1-1440x900.png`, `001-fill-1-1920x1080.png`, `001-fill-{4,6,15}-{1440x900,1280x800}.png`. `check:geometry` and `shots-001-live-activity` were not run again for this delta.
- `[KNOWN GAP]` *Time on task* starts when the page sees the agent turn busy (`busySince`); after a restart in the middle of a turn it counts from then. Not checked on a real session or on macOS or Windows fonts (the columns are chosen from the measured width, so another font gives the same columns with different line breaks).

### 2026-10-21: owner hand-check on macOS and Windows (T024, issue #10)

- `real:` 2026-10-21, owner (Vikram) hand-check, closed by the owner's decision: macOS in daily use; Windows looked at with a colleague on 2026-10-21. Findings filed from that Windows session: #467 (Settings > Agent apps offered no install option; Copilot was not detected or installable without Node.js; PowerShell/winget commands in PR #469) and the MCP sign-in sharing (#471, merged; real check in PR #478).
- Owner decision (Vikram, team chat 2026-10-21): "You can close issue #10 as we hand-checked them already many times, I am using it daily on macOS and I looked at everything today with my colleague on Windows and you already have feedback."
- **Not covered** (honest limits): the owner reported use, not a scripted check. The T024 items (15 agents at 1440x900 and 1280x800, no overlap, text at least 10.5px, fonts, window chrome) were not measured one by one on a real Mac or Windows PC, and no screenshots from real machines are in `docs/screenshots/` (the simulator screenshots and the CI *UI on three OSes* runs are the measured evidence). Text metrics across OSes stay unmeasured (Assumptions).

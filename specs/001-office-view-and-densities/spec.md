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
- **FR-029** `[IMPLEMENTED]` **Where it shows.** The layout search (FR-022) first tries `full` desks with a **side panel** to the right of every main desk (about 200 px, fixed size, reserved whether or not the agent is busy, so the office never shifts when an agent starts or stops). It is used only when that layout fits the floor like any other candidate (no extra threshold: few agents across, wide window). The panel shows the readout over up to five lines (the latest sentences of thinking or the reply, a tool phrase) under a small kind word (Thinking, Working, Replying). When the side panel does not fit (many agents, or a narrow window), the readout takes the desk's text line under the name (`full` `.task`, card `.intent`), in the same clamp and box, so nothing moves. The **name stays visible** on the desk in both cases, and is also in the desk's tooltip and accessible name.
- **FR-030** `[IMPLEMENTED]` **Calm updates.** The readout is repainted at most 4 times a second per desk (text only, by `textContent`; no re-layout of the office), only when its text changed, with no animation (no typing effect or fade, so `prefers-reduced-motion` and Serious mode need nothing more). Text is at least 10.5 px, uses theme tokens only (`--ink-2`, `--muted`, the status colours), and 15 agents still fit at 1440x900 and 1280x800 with no overlap (`check:office`, `check:geometry`).
- **FR-031** `[IMPLEMENTED]` **No secrets.** Every readout goes through the shared masking in `src/shared/redact.ts` before it is shown: a command through `maskSecretCommand`, a URL through `maskSecretUrl`, everything else (paths, thinking and reply text) through `redact`. The page loads the compiled `dist/shared/redact.js` (it has no imports), so there is one masking code path, not a renderer copy. The readout is display only: never stored, logged or sent anywhere. `[KNOWN GAP]` The page does not know the agent's environment values, so a secret that matches no `redact` pattern (a plain password in prose, say) is not masked; the chat shows the same text unmasked today.
- **FR-032** `[IMPLEMENTED]` **Setting.** Settings > General has **Live activity on desks** (on by default), kept per computer like Spacing (`localStorage` `durbar.liveActivity`). Off: the desk text is exactly today's, and the layout search never tries the side panel.
- **Owner decisions** (Vikram, Telegram 2026-10-21): the four defaults asked in PR #458 are kept. (1) In a busy office the desk keeps the agent's **name**; the readout goes in the line(s) under it (FR-029). (2) The side panel is used **whenever it fits**, with no fixed threshold (FR-029). (3) The side-panel layout is **preferred over showing more helper tiles** (FR-029). (4) **Waiting and Error** desks keep their request text, with no readout in the panel (FR-028).
- `test:` `npm run test:liveact` (the readout rules, masking, throttle); `sim:` `scripts/shots-001-live-activity.js` (simulator, `DURBAR_SIM=15` and 3 agents, 1440x900 and 1280x800: side panel in the sparse office, the text line in the dense one, no overlap, text at least 10.5 px, the setting off restores today's text). `check:office` (360/360; it now also checks side panels for overlap) and `check:geometry` (66/66) pass on Linux. Not checked on a real session (no credits spent): the readout uses the same normalized events the chat already shows for Copilot, Claude Code and Codex.

### 2026-10-21: a faster layout search (finding in PR #457, owner: "snappy and flicker-free")

*Finding.* PR #457 timed a floor switch (spec 033 SC-003) at about 220-310 ms of the app's own work on a 4-core Linux box, most of it in the layout search (`chooseLayout`), against 55-84 ms recorded in spec 033 on 2026-10-17. Ruben's agent measured 534 ms on a busy server, already without the CPU wait (#454), so the app's own work is near the 500 ms budget on slower machines. On a quiet 4-core server (issue #454, Ruben's comment of 2026-10-21) `shots-033` on `main` failed 3 of 3 runs, always at 1280x800: 536, 624 and 817 ms there (CPU wait 2-20 ms, already subtracted), against 322-350 ms at 1440x900.

*Cause (measured, `sim:`, same machine, an instrumented build).* Not one regression. The search renders every candidate (about 16 trials at 1440x900, 19 at 1280x800) into the hidden `#probe` and measures it, and each trial parsed, styled and laid out the whole stage again, desk drawings included. Its cost grew with the app: at the spec 033 merge (`a48c05a`) a search already took 289-396 ms here (median of 9), at 841 style rules and 1301 stage elements; on `main` (`2e80f94`) 450-530 ms, at 1597 style rules and 1366-1531 elements (largest step: the usability pass, `de14af9` to `3018627`, +35%). The 55-84 ms of 2026-10-17 cannot be reproduced on this machine with that commit, so it was measured another way or on a faster machine (`read:` its Verification line does not say). Per trial on `main`: style recalculation about 7 ms, layout about 1.5 ms, parsing 5 ms, the HTML 1 ms; two thirds of the elements are the SVG drawings inside the desks. 1280x800 is slower because the search goes further down the candidate list: with 15 agents on three floors `card` does not fit there, so it tries `full` x2, `roomy`, `card` with 3 and with 1 helper (4 column counts each), then `mini` (19 trials), where 1440x900 stops at `card` with 1 helper (14 trials plus 2 helper boosts); the compact trials after the first of each density are the ones FR-033 makes cheap, so after the change both sizes take about the same time. A status change does not run the search (its result is kept until the office's shape changes); such a render takes 2-4 ms.

- **FR-033** `[IMPLEMENTED]` The layout search measures the same boxes with less work, and picks exactly the layout it picked before:
  - a trial keeps every `<svg>` tag with its attributes and leaves out what is inside it (`src/renderer/probe.js`, `svgHollow`); an `<svg>`'s box comes from its attributes and CSS, never from its children;
  - a trial that differs from the one before only in style attributes (the compact search changes only each room's `--w`, `--min` and `--cols` from one column count to the next) sets those values in place instead of parsing the stage again (`styleSplit`, `probeSet` in `app.js`); anything else replaces the probe's content as before;
  - `--w`, `--min` and `--cols` are registered as not inherited (`@property ... inherits:false`); only the element that carries them reads them, so a new value restyles the rooms, not every desk inside them. `test:probe` fails if another rule or file starts reading them.
- `sim:` before and after on the same machine, run alternately (8 switches each way per size, an instrumented copy of the build): floor switch (`durbar:floor-switch`, median) **438-445 ms -> 139-146 ms** at 1440x900 and **520-526 ms -> 134-142 ms** at 1280x800; `chooseLayout` **388-401 -> 97-105 ms** and **474-480 -> 97-102 ms**. Same layout: 54 cases (6 window sizes x all floors, one off, Show only on two floors, 2 and 5 rooms closed, reopened, a status filter, an expanded `+N more`), 22 different layouts among them (every density, boosts, one that does not fit), gave the same chosen layout and the same box (to 0.5 px) for every room, plate, desk, helper and `+N more` before and after. Re-measured after merging PR #458 (live activity, which adds side-panel `full` candidates and makes the search slower on `main`), alternately, 2 rounds: floor switch **496-598 ms -> 167-174 ms** at 1440x900 and **548-646 ms -> 164-182 ms** at 1280x800; `chooseLayout` **455-554 -> 129-135 ms** and **506-594 -> 126-137 ms**; the 54 cases (23 different layouts) again identical to `main`, box by box; `shots-033` 114 ms (1440x900) and 113 ms (1280x800). `check:office` 360/360 and `check:geometry` 66/66 pass (before the merge); `shots-033` passes with the switch at 84 ms (1440x900) and 108 ms (1280x800) of the app's own time, against 199-311 ms recorded in PR #457. Not timed on macOS, Windows or a slower server.

### 2026-10-21: owner hand-check on macOS and Windows (T024, issue #10)

- `real:` 2026-10-21, owner (Vikram) hand-check, closed by the owner's decision: macOS in daily use; Windows looked at with a colleague on 2026-10-21. Findings filed from that Windows session: #467 (Settings > Agent apps offered no install option; Copilot was not detected or installable without Node.js; PowerShell/winget commands in PR #469) and the MCP sign-in sharing (#471, merged; real check in PR #478).
- Owner decision (Vikram, team chat 2026-10-21): "You can close issue #10 as we hand-checked them already many times, I am using it daily on macOS and I looked at everything today with my colleague on Windows and you already have feedback."
- **Not covered** (honest limits): the owner reported use, not a scripted check. The T024 items (15 agents at 1440x900 and 1280x800, no overlap, text at least 10.5px, fonts, window chrome) were not measured one by one on a real Mac or Windows PC, and no screenshots from real machines are in `docs/screenshots/` (the simulator screenshots and the CI *UI on three OSes* runs are the measured evidence). Text metrics across OSes stay unmeasured (Assumptions).

### 2026-10-22: who is where, who waits, what is scheduled (owner)

*Owner, Vikram, Telegram 2026-10-21 22:19 UTC,* after seeing an illustration of the office: "I like how you show 'waiting on people', 'scheduled' and the Terminal/GitHub/Telegram blocks where we can clearly see who is where and who is waiting. Can we have our office view like this?" *And at 22:21 UTC:* "For lobby places, also say who — when more than one person is out of their desk, we don't know who it is."

*Owner, Vikram, Telegram 2026-10-22 06:53 and 06:59 Zurich,* on the first build (a rail on the right with Needs you, Scheduled and a legend, PR #511): the right-side rail "makes the layout not feel like an office". Replace it with office metaphors in the lobby row: a **Boss** (the manager's office, in the centre of the lobby) where agents that need you for a question or a permission walk to and queue; a **Bank** where agents that hit a spending limit wait; a **Postbox** with the next scheduled runs. Keep the names and activity under the figures at every place and the room header counts in words; remove the rail and the legend. *And at 07:00 Zurich ("yes"):* questions **also** go to the Boss (with permissions); Durbar's own spending cap goes to the **Bank**, provider usage-window limits stay in the **coffee corner** (spec 068).

*Found (existing capabilities, reused, not duplicated):* the **lobby** and its walking figures (spec 024: `lobbyPlaces`, `lobbyHTML`, `VISITS` with `pin`/`unpin` from spec 068, `placeVisitors`, `syncWalkers` and `RETURNING`: a figure walks from the desk to its `.slot`, the desk keeps an empty chair, the figure walks back; no walk under reduced motion); the **Needs you** inbox (spec 052 FR-027: `needsMe`, `needsMeOrder`, `NEED_SINCE`, `pendingCardOf`, the top-bar badge, `openPanel`, the answer bar that brings the request into view); the **coffee break** (spec 068: `BREAKS`, `startCoffee`/`endCoffee`, the cap break of kind `cap`); the spending-limit card and its raise action (spec 011 FR-009..FR-017: `showLimit`, `settleLimit`, the cap chip); the **scheduled prompts** in the page (spec 044: `SCHED`, `whenOf`, `clock`, `recurringS`, `bridge.onScheduleRan`, Settings > Schedules); the live readout per agent (FR-028, masked); the room header dots and `fitUsage`; the shared pop-up menu element (`#modeMenu`); theme words (`CLEAN_WORDS`, spec 035/036) and the generated-theme word list (`GEN_WORDS`).

*Added (FR-034..FR-040; the rail of the first build, PR #511 2026-10-22 morning, is removed: no `#rail`, no strip, no legend):*
- **FR-034** `[IMPLEMENTED]` **Boss (manager's office).** A lobby tile, in the **centre** of the lobby row, named by the theme word `place-boss` ("Boss" in Clean Office; each theme may rename it, the plain name stays in the tooltip, spec 052 FR-013). A main agent whose pending request in its chat is a **question** or a **permission** (`pendingCardOf`: a card that is not the spending limit or a coffee break) gets up and **walks** to the Boss (the spec 024 walker, about 1 s; it simply appears there under reduced motion) and stands in the **queue**: a pinned visit (`VISITS.pin`, no debounce; tools and statuses do not move it). Its desk keeps an **empty chair** and its desk text starts with a small note, "Went to see the boss" (theme word `boss-note`), followed by the request text. Queue order is **who came first** (the inbox's `NEED_SINCE`, oldest first). Each entry in the queue shows the figure, a tiny **badge** on it (**?** for a question, a **key** for a permission; the words "question" / "asks for your OK" in its tooltip and accessible name) and, when names fit (FR-036 rule), the name and how long it has waited. The tile header shows the count and the **longest wait** ("12 min", `ATT.waitLabel`). **Click** (or Enter) on an entry opens that agent's chat with the request in view (`openPanel`, then the pending card is scrolled into view and focused like the answer bar's "show"). Once the request is answered (or the agent stops, ends or goes on), the visit ends and the figure **walks back** to its desk. More visitors than entries: the last is "+N", a button that lists everyone (the shared menu element; choosing one opens its chat at the request). The top-bar inbox count stays the global badge; errors stay at the desk (they are in the inbox, not at the Boss).
- **FR-035** `[IMPLEMENTED]` **Bank.** A lobby tile (theme word `place-bank`, "Bank") where an agent that reached **Durbar's own spending limit** (spec 011: the AIU or dollar cap; the `limit` event `exhausted`) walks to and waits. Its card state is *Waiting* with the label **Limit reached** (spec 011's words) and the text "Limit reached — until you raise the limit"; no cup. Its entry says "until you raise the limit". Click on the entry opens that agent's chat with the existing spending-limit card (raise, add, remove or stop: spec 011 `settleLimit`); answering it ends the visit and the figure walks back. Internally the cap is still spec 068's break of kind `cap` (schedules skip the agent, it never resumes by itself); only where it waits and its words change. **Owner decision (2026-10-22 07:00 Zurich): Durbar's spending cap → Bank; provider usage-window limits (a plan window, a premium quota, a rate limit: spec 068 kind `provider`) → coffee corner.**
- **FR-036** `[IMPLEMENTED]` **Who is at a place (lobby).** (Kept from the first build.) Each place tile shows its name, the number of agents there (when any) and, under the name, one entry per visitor: the figure (the walking figure stands on it), the agent's **name** and under it **what it does there**: its tool call in the live readout's words without the verb (`npm test`, `github list_pull_requests`; `DurbarLiveAct.phrase` with the FR-031 masking, fail closed), else the tool or MCP server of the visit, and in Simple the plain place words (never a command). With *Live activity on desks* off (FR-028) the entry shows the tool or server name, not the command (review on #511). At the Boss it is the kind of request and the wait, at the Bank and the coffee corner "until …". Full name, folder and activity are in the entry's tooltip and the tile's accessible name; "nobody" (muted) when empty. Entry rule (pure, `places.js` `chipsIn`/`chipsFor`): **names** when every visitor fits by name or at least two named entries fit (the last becomes +N), else two-letter **initials**. "+N" opens the list of everyone there (click opens the chat). The lobby is 58 px tall whether or not anybody is there.
- **FR-037** `[IMPLEMENTED]` **Room header summary in words.** (Kept.) The room header's counts show their word when the header has room ("5 working", "1 waiting"); where it is too narrow the words go first, then the folder path (`fitUsage`). The words are never part of the layout search's trial (`#probe .rdw{display:none}`).
- **FR-038** `[IMPLEMENTED]` **Postbox.** A lobby tile (theme word `place-postbox`, "Postbox") that shows the **next 3 scheduled runs**, soonest first, one line each: time · folder · prompt ("09:14 · mcp-swiss · Morning summary"; cut with an ellipsis, the full lines in the tooltip; the folder is dropped first where the tile is narrow), the **letters for today** ("4 today": the runs still due before midnight, local time, counted from each active schedule's next run and its interval or rule; paused schedules and Pause all count none) and a small **flag** when a schedule's last run was **missed** or **failed** (`last.outcome`; "1 missed" in its tooltip and accessible name). Nothing scheduled: "No letters". With Pause all: "All paused". **Click** (or Enter) opens Settings > Schedules. When a schedule **fires** (`onScheduleRan` with the agent), a **letter flies once** from the Postbox to that agent's desk (about 0.9 s, one element, removed after; none under reduced motion, none when the desk or the Postbox is not on screen) and the agent starts as before. Not in the demo (no schedules there): the tile is absent.
- **FR-039** `[IMPLEMENTED]` **Lobby order and widths.** Order: the places (built-in, then custom) with the **Boss inserted in the middle** of the whole row, then the coffee corner, the Bank and the Postbox, then the Add button. The Boss, coffee corner, Bank and Postbox have their own widths; the other places share the rest equally. Rule (pure, `places.js` `lobbyFit(aw, places, addButton)`): start from the preferred widths (Boss 230, Postbox 280, coffee corner 160, Bank 130 px) and shrink the four together, proportionally, toward their minimums (190, 180, 96, 96 px: the Boss keeps room for a queue of three) until every other place is at least 118 px wide (room for two visitor entries); if even the minimums leave less, the other places get narrower (one entry and "+N"). In initials mode "+N" is a bare 22 px circle, so a narrow tile shows one figure and "+1" rather than only "+2" (`initialSpots`). The coffee corner shows its name from 148 px (icon only below, never a cut name; the name stays in its tooltip and label), the Postbox shows its name and the folder in its lines from 240 px. Measured lobby widths: 1408 px at 1440x900 (Boss 216, corner 138 icon only, Bank 118, Postbox 246, places 118), 1248 px at 1280x800 (Boss 190, corner 96, Bank 96, Postbox 180, places 118). At the Boss, names show only when the whole queue fits by name; otherwise initials, so more of the queue is visible. The tiles stay in one row inside the floor; text at least 10.5 px; colours from theme tokens.
- **FR-040** `[IMPLEMENTED]` **Checks.** A simulator driver (`scripts/shots-001-lobby.js`) asserts, at 1440x900 and 1280x800, 15 agents and a sparse office, Clean Office and Retro Pixel (the built-in theme with a dark page): the Boss is the centre tile; the agents with a pending question or permission walk there (figure transform transition seen, then standing on a Boss slot), in arrival order, with the ? or key badge and the longest wait; their desks are empty with "Went to see the boss"; a click on an entry opens that chat with the request in view, and answering it sends the figure back to its desk; a simulated cap puts that agent at the Bank and a click opens its limit card; the Postbox lists the next 3 seeded schedules soonest first with "today" and a missed flag, a simulated schedule fire flies one letter to that desk and the click opens Settings > Schedules; reduced motion: no walk, no letter; no overlap or clipping (`pageCheck`), text at least 10.5 px. `check:office` (`pageCheck`) expects the four special tiles (Boss in the middle, then coffee corner, Bank and Postbox last), the entry rules and the 58 px lobby; `check:geometry` runs it in every theme; `check:ui-text` covers the words.
- *Result (2026-10-22, Linux, Xvfb, simulator only):* `sim:` `scripts/shots-001-lobby.js` passes at 1440x900 and 1280x800, 15 and 3 agents, Clean Office and Retro Pixel, `simnames=long`, and again with `--force-prefers-reduced-motion` (no walk, no letter); `test:` `test:places` (`lobbyFit`, `lobbyOrder`, `initialSpots`, `postNext`, `lettersToday`, `postMissed`, the reserve gap), `test:liveact` (fail-closed guard, Live activity setting); `check:office` 371/371, `check:geometry` 70/70 (it caught the Postbox column following the theme word's width: now fixed), `check:ui-text` passes, `shots-068-coffee.js` (Omar at the Bank), `shots-024.js` (it was already failing on the coffee corner before this change; now passes); `npm test` all suites. Measured lobby: see FR-039. Found while building: `syncWalkers` put a figure on the "+N" circle (it counted every `.slot`), the initials "+N" was 46 px wide and stuck out of a 96 px tile, a figure that only moved into "+N" walked back to an empty desk, and one that came out of "+N" walked from its desk again; all fixed (`docs/agent-notes.md`). Not seen on a real session, a Mac or a Windows PC; the flying letter and the walks are not checked under a real schedule run.
- **Owner decisions** (Vikram, Telegram): 2026-10-21 22:19 and 22:21 UTC: the office shows who waits, what is scheduled and who is where (the illustration). 2026-10-22 06:53 and 06:59 Zurich: no right rail and no legend; Boss, Bank and Postbox in the lobby; names and activity at every place and header words kept. 2026-10-22 07:00 Zurich: questions and permissions both go to the Boss; Durbar's spending cap to the Bank, provider usage-window limits to the coffee corner. Decided here (stated, owner may change): the Boss is inserted at the middle index of the whole tile row; "letters for today" counts the runs still due today (not the ones already sent: the page keeps only each schedule's last run); errors stay at their desks; the Bank card label is spec 011's *Limit reached* (not themed, a status word); the theme words for the three tiles (below).
- Theme words (`place-boss` / `place-bank` / `place-postbox`, plus `boss-note`): Clean Office Boss / Bank / Postbox; Corporate Corner office / Finance / Mailroom; Retro Pixel Boss level / Coin bank / Mailbox; Durbar · Indian Court Diwan-e-Khas / Khazana / Dak ghar; Durbar · European Court The Chancellor / The Treasury / The Post; Durbar · Japanese Court Tono / Kura / Yūbinkyoku. Generated themes may rename them (`GEN_WORDS`).

### 2026-10-22: review on #511 (Ruben's agent, 08:35 UTC): short lobby tooltips, a racy driver wait, saved places named like a built-in tile

*Found:* (A) `check:ui-text` (spec 052 FR-168: a static tooltip is at most 120 characters, a data tooltip at most 300 characters and 8 lines) failed on CI with 182 `tooltip-length` violations, all from the lobby with `simnames=long`: a visitor entry's title was the whole "name (folder): activity" (up to 276 characters), the "+N" button listed every hidden visitor on its own line, a place tile's title listed every visitor in full (up to 592 characters at the Boss) and a desk card's title (name, role, status, the "At …" or "Went to see the boss" text, usage) reached 349 characters. (B) `shots-001-lobby.js` timed out on Windows CI at "Mira walks to the Boss": its wait needed the walk (`.walker.walking`, about 1 s) and the empty desk to be seen in the same poll, so a slow runner that polled after the walk ended never saw both. The covered-window throttling fix (spec 008 FR-103, `backgroundThrottling:false` and `--disable-backgrounding-occluded-windows` for driver runs) is already on this branch; this was the wait itself. (C) `parseCustomPlaces` (spec 024 FR-018) dropped a saved custom place whose name is reserved: since this PR "Boss", "Bank" and "Postbox" (and since spec 068 "Coffee corner") are reserved, so a user's own place with one of those names vanished at startup and its MCP mappings fell back to the default rules. The built-in tiles already use fixed ids (`boss`, `bank`, `postbox`, `coffee`; custom ids are always `c-xxxxxx`) and folder (room) names are never compared with place names, so only the read of the saved list was wrong. The simulator's copy of the rules (`sim.ts`) did not reserve the three new names at all. (D) `test:places` did not pin that `VISITS.pin` to the same place with a new label (a question that becomes a permission) changes the label (mutation M19 survived). (E) `tileSlots` and `tileChips` (`places.js`) are no longer called by the app since FR-039's `lobbyFit`; only tests used them, and the reserve-gap mutation M5 survived because no case sat on a capacity boundary.

*Changed:*
- **FR-036** (addition) **Lobby tooltips are short and plain** (spec 052 FR-168). A visitor entry's title is its name, folder and activity cut with `DurbarCutText` (name 30, folder 22, activity 40 characters), plus "Open the chat." at the Boss and the Bank: at most 120 characters. The "+N" button's title is "N more here. Open the list." (the menu and the accessible name say who). A place tile's title names at most 4 visitors (each name cut to 30 characters), then "and N more", then the longest wait at the Boss: at most 300 characters and one line. The accessible names keep every visitor in full words (they are not tooltips). A desk card's title: its name, role, status and desk text are cut to 200 characters with an ellipsis (the chat has the full text), then the mood, usage and last activity; at most 300.
- **FR-040** (addition) The driver's walk check records the walk when it starts (a `MutationObserver` on the walkers layer, installed before the event) and then waits for the end state (the desk is empty at the Boss and the agent is in the Boss queue); it no longer needs both in the same poll. A failure message includes `document.visibilityState`, the reduced-motion state and the number of figures. Whether a walk is expected comes from the page's own `prefers-reduced-motion` (read after the first load and printed), not only from `LOBBY_REDUCED`: on the next CI run the Windows runner reached the end state with no walk at all, which is what a desktop that reports reduced motion does (FR-034: no walk under reduced motion). Reproduced on Linux with `--force-prefers-reduced-motion` and no `LOBBY_REDUCED`: the old driver fails at "walks to the Boss" and the new one passes in its reduced-motion branch. That the Windows runner reports reduced motion is inferred, not read from the runner (`read:` the log line it prints on a failure).
- **Spec 024 FR-018** (cross-reference, owned there): reading the saved list never drops a place for its name. A saved name that is reserved or already used by an earlier entry (ignoring case) is kept and renamed with the first free " (2)", " (3)", … suffix (the base name is cut so the whole stays within 24 code points), so the place keeps its id and its mappings ("Bank" → "Bank (2)"). Adding or renaming a place still refuses a reserved or used name (`name-taken`). The simulator reserves "Boss", "Bank" and "Postbox" too, and `test:places` runs them through both.
- `tileSlots` and `tileChips` are removed from `places.js` with their tests (`lobbyFit` and `chipsIn` replace them; `chipsIn` and `chipsFor` keep their cases).
- *Result (2026-10-22, Linux, Xvfb, simulator only):* `test:` `test:places` (rename on read, the `parseSettings` migration with mappings, simulator parity of the reserved names, M19, `chipsIn` boundaries), `test:credits`; `npm test` 91/91. `sim:` `shots-001-lobby.js` passes; `check:ui-text` passes for the office, palette, inbox, list, send-several and place surfaces, with and without `simnames=long`, light and dark, 1440x900 and 1280x800. Mutations killed: the old drop on read, no suffix cut, a reserved name missing in `sim.ts`, `pin` not updating the label, `TILE_PAD` 20→19, the full tooltips back (`check:ui-text` fails), walks switched off (the driver fails at "walks to the Boss"). Measured for the review question: with 15 agents at 1440x900 the office is `card` with the 58 px lobby; the driver's `simbreak=8` scenario shows 9 helpers instead of 5, and that makes it `mini`. Not run: `shots-024-custom.js` (not in the UI suite), the Windows runner (CI).

### 2026-10-22: review on #511 (Paco's agent, 15:41 UTC): Postbox opens Schedules without scrollIntoView, flag counts a missed one-time run

*Found:* (A) the Postbox click opened Settings and then called `scrollIntoView` on the Schedules list, which spec 052 FR-055 forbids (it also scrolls the outer page, hiding the top bar). (B) The Postbox flag skipped every `done` schedule, so a one-time schedule that was missed while the app was closed (main marks it `done` with `last.outcome: 'missed'` at start) never raised the flag.

*Changed:*
- **FR-038** (amendment) **Click opens Settings at Schedules** through the shared `openSettings('schedules')` (screens.js), like `openSettings('harnesses')` and `'mcp'`: Settings opens, the Schedules heading is brought to the top of the screen's own scroller with `scrollInBody` (spec 052 FR-055) and gets the focus. No `scrollIntoView`. Issue #523 (a top-bar Schedules button, Ctrl+Shift+S, Ctrl+K) uses the same entry point.
- **FR-038** (amendment) **The flag counts** a schedule whose last run was `missed` or `failed` when it is still active, **and a done one-time schedule** (no interval, no rule) with that last outcome. A done repeating schedule is not counted. Same rule as #523's badge.
- `openSettings(section)` (shared, also used by spec 051's Agent apps and spec 058's MCP entry points): when a section was asked for, its heading keeps the focus; the screen's `h2` no longer takes it right after (before, `hsH`/`mcpH` were focused and then lost the focus to the `h2`).
- *Result (2026-10-22, Linux, Xvfb, simulator only):* `test:` `test:places` (a done one-time schedule with a missed last run counts, a done one-time run that went fine, done repeating and done rule schedules do not; mutation back to `!s.done` fails it). `sim:` `shots-001-lobby.js` clicks the Postbox and asserts the Schedules heading is focused, 12 px from the top of the screen's scroller, and the page did not scroll (passes at 1440x900 and 1280x800, Clean Office and Retro Pixel); mutation (the old `scrollIntoView` path) fails it with the page scrolled by 128 px and the focus lost. `[KNOWN GAP]` The simulator seed has no done one-time missed schedule, so the driver's flag check still covers the active case only; the done case is unit-tested.

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

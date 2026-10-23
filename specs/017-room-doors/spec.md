# Feature Specification: Room doors (collapse / expand a room)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 015-018
title: Room doors (collapse/expand)
status: milestone 7; delta 2026-10-23 (owner): meeting-room door signs on session desks (FR-003..FR-010, simulator-checked; closing a single session's door is an open owner question)
-->

**Feature Branch**: `017-room-doors` (milestone 7; amends 001, 006)
**Created**: 2026-10-16
**Status**: Implemented (milestone 7)
**Input**: Vikram: each room can be closed/opened with a door; closed rooms become a compact door plate with a one-line status; closed rooms free space for bigger densities.

## Acceptance
1. Each room header has a **door** button (keyboard focusable, `aria-expanded`). Click/Enter/Space toggles the room.
2. A closed room is a compact **door plate**: door SVG, room name, one-line summary: `Needs attention - error` > `Waiting for you - N` > `Meeting in progress` (an agent in the room has a working sub-agent) > `Busy - N working` > `All done` > `Available` . Waiting rooms are amber, error rooms red; they still count in the top-bar pills.
3. The density fit is re-run with **open rooms only**; door plates are laid out in a compact strip, so open rooms can get richer densities.
4. Closed state persists in `userData` (saved folder list, `closed` flag), survives new/removed agents and restarts.
5. Top bar: **Close all / Open all** buttons. Closing all keeps waiting/error rooms highlighted (and still counted).
6. Subtle open/close animation, none with `prefers-reduced-motion`.

## Requirements
- **FR-001** Pure `roomSummary(agents)` in `src/renderer/roomsummary.js` (UMD) with unit tests (`scripts/test-rooms.ts`).
- **FR-002** `closed` is stored per folder key in `durbar-folders.json` (tolerant parse); API `setRoomClosed(id, closed)`.
- **LIMIT** Filtering by status pill hides door plates of rooms without matches like open rooms; the list view ignores doors.

## Changes

- **2026-10-17, spec 033 (floors), cross-reference.** With two or more floors on, door plates (and open room headers) show a small floor tag; Close all / Open all act only on rooms that are shown (not hidden, floor on). A room on a floor that is off has no plate. Door state stays per folder.

### 2026-10-17: lobby from spec 024 (cross-reference)

A closed room keeps its agents in the lobby of spec [024](../024-office-places/spec.md) until their call ends; they then disappear into the door plate (no walk to a plate). With every room closed the lobby sits above the door plates.

### 2026-10-23: meeting-room door signs for sessions (owner request, issue #616)

**Input** (Vikram, team chat, 2026-10-23 09:54 UTC): "Opening and closing door feature what we have for folders / let's have it for sessions in folder as well - where we show the status like in a meeting room - busy, available,.. with colors".

Each session (a main agent's desk) shows a **door sign**, like the sign beside a meeting-room door: the room door's own door glyph (open or closed), an icon and a word, in a coloured plate. The sign is the desk's status pill restyled: it replaces the plain status word on the desk, it is **derived** from the normalized agent state that the desks, pills and list already use (no second status system) and it reuses the state colour tokens (`.st-*`).

#### Requirements

- **FR-003** [IMPLEMENTED] `test: test-rooms` Pure `doorSign(x)` in `src/renderer/roomsummary.js` (next to `summarizeRoom`, same tone names), with `x = {state, paused, coffee, limit, ended, resting, failing, helpers}` where `state` is the shown state (`vis`). It returns `{key, word, tone, door, icon}`. Priority, first match wins:

  | Sign (`key`) | Word | When | Door | Icon | Colour (existing `.st-*`) |
  |---|---|---|---|---|---|
  | `attention` | Needs attention | state `error` | closed | triangle with ! | `st-error` |
  | `waiting` | Waiting for you | state `waiting` (a question, a permission, or Durbar's spending limit) | closed | hourglass | `st-waiting` |
  | `dnd` | Do not disturb | paused (the chat's Pause), or on a coffee break (spec 068) that is not the spending limit | closed | circle with a bar | `st-idle` |
  | `away` | Away | the session ended, or the agent rests in the lounge (spec 001 FR-051) | closed | clock | `st-idle`, dashed edge |
  | `meeting` | In a meeting | `working`/`thinking` while one of its helpers works (the room plate's "Meeting in progress") | closed | two people | the state's own (`st-working`/`st-thinking`) |
  | `busy` | Busy | `working` or `thinking` | closed | filled dot | the state's own; `st-failing` while tool calls fail in a row (spec 052 FR-062) |
  | `available` | Available | `idle` or `done` | **open** | check | `st-done` |

  Words are the room plate's words where one exists ("Waiting for you", "Needs attention", "Available"). Unknown or missing input reads `available` (never throws).
- **FR-004** [IMPLEMENTED] `sim: shots-017-signs` On every main desk (full desk pill, card and roomy pill, the mini and micro status word), the sign shows door glyph + icon + word. The door glyph is `doorSvg()` (the room door's paths and viewBox) drawn in the sign's ink (`currentColor`), so it keeps contrast on every plate; the icon is drawn in the same ink. Helpers keep their plain status word (a helper is not a session).
- **FR-005** [IMPLEMENTED] `sim: shots-017-signs` Colour is never the only cue: each sign has its own icon and word; the plate is filled with the tone's `--pb-*` and its text and glyphs use the tone's ink. Text and glyph contrast against the plate is at least **3:1 in all 6 themes** (the driver measures it; 4.5:1 is reported, not required), and the sign's text is at least 10.5px.
- **FR-006** [IMPLEMENTED] `sim: shots-017-signs` The plain state word stays everywhere else: the desk's accessible name (`stWord`), its tooltip, the list view, the chat header, the top-bar counters and the inbox. The sign's own `title` names both ("Busy: Working"). The desk keeps `data-state` and its `is-*` class, so filters, drivers and counts are unchanged. The sign carries `data-sign="<key>"`.
- **FR-007** [IMPLEMENTED] `sim: shots-017-signs` Layout: the sign takes the pill's place and size class, so the density search is unchanged; 15 agents still fit at 1440x900 and 1280x800 without overlap or office scroll (`check-office-overlap` rules) and the word gives way (ellipsis) before the name, as the status word does (spec 001 FR-025), with the full word in the tooltip. On cards the sign keeps its full word and the usage line gives way: the token count is dropped whole (spec 052's usage fitting), never cut to a misleading first digit; the cost stays. The mini and micro status word uses the short word (Alert, Waiting, DND, Away, Meeting, Busy, Available).
- **FR-008** [IMPLEMENTED] `sim: shots-017-signs` Settings > Detail level: a switch **Meeting-room signs on desks** (on by default, kept per computer like "Finished agents rest in the lounge"). Off shows the plain status word pill exactly as before.
- **FR-009** [IMPLEMENTED] `sim: shots-017-signs` A resting agent's peek in the lounge says **Away** with the sign's icon (FR-003), in place of the plain word.
- **FR-010** Safe default for the door itself: the sign is **not a toggle**. Clicking a desk (or its sign) opens the chat as before; nothing about a session's prompts, schedules or remote messages changes. See Clarifications Q1.

#### Clarifications (open, for the owner)

- **Q1: what does closing a single session's door do?** Options: (a) visual only, like a room: the desk folds into a small door plate with its sign and frees space; (b) "do not disturb": scheduled prompts (spec 044) and remote messages (spec 054) wait until the door opens again; (c) both. **Recommended default: (a)**, because it matches the folder doors and holds nothing back silently; (b) changes when prompts run and needs its own spec delta in 044 and 054. **Built now:** the sign only (FR-010); no session door toggle until the owner chooses.
- **Q2: Durbar's spending limit: "Waiting for you" or "Do not disturb"?** The owner's note suggested DND "?". **Default: Waiting for you**, because the agent stops until you raise the limit (it is in the inbox, spec 011); an agent-app usage window (spec 068 coffee break) that resumes by itself is DND.
- **Q3: colour of Do not disturb.** Chat apps use red. **Default: the idle grey**, so red stays for trouble (Needs attention); the icon (circle with a bar) and the word tell it apart. Say if red is wanted.
- **Q4: "Done" desks.** A finished agent at its desk is **Available** (it takes the next prompt); in the lounge it is **Away** (owner list: "Away / Closed (ended or resting)").

#### Limits

- [KNOWN GAP] Not checked on Windows or macOS (simulator on Linux only); not checked with a real agent session (constitution IV).
- [KNOWN GAP] The list view keeps its plain status pills (no signs there): the list is for exact states.

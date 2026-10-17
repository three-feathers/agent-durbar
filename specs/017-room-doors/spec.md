# Feature Specification: Room doors (collapse / expand a room)

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

### 2026-10-17: lobby from spec 024 (cross-reference)

A closed room keeps its agents in the lobby of spec [024](../024-office-places/spec.md) until their call ends; they then disappear into the door plate (no walk to a plate). With every room closed the lobby sits above the door plates.

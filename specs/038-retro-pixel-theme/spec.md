# Feature Specification: Retro pixel theme (spec 038)

**Feature Branch**: `035-theme-foundation` (issue #129)
**Created**: 2026-10-18
**Status**: Spec phase
**Input**: Vikram (issue #129): 8-bit palette pixel characters.

## Clarifications (binding)

- Characters become **palette pixel art**: hair and accessories are blocky slot art; the body/head use the same slot geometry with `shape-rendering:crispEdges`-friendly rect-based art slots. Palette pixel maps (string grid → `<rect>`s) are a supported art-slot format.
- Retro renames scene words only: Library→Arcade, Software library→Cartridge Bay, Terminal→Console, Web→Modem, Other tools→Gadgets; lobby label "Game lobby". Status words unchanged.

## Requirements

- **FR-001** `[PLANNED]` `retro` pack: 8-bit palette (dark ink background is **not** allowed for the page chrome — the office stays light enough for 10.5px text and 4.5:1 pills; pixel flavour comes from characters/props) — chunky monitors, cup → mug, plant → potted cactus, blocky hair styles via pixel maps.
- **FR-002** `[PLANNED]` Pixel maps in art slots: `{palette:{a:'#…'},rows:['…']}` compile to sanitized `<rect>` grid SVG (validated cell size/colours).
- **FR-003** `[PLANNED]` Motion preset `arcade`: stepped animations (steps() already used for compact scenes; the preset shortens durations).
- **FR-004** `[PLANNED]` The 15-agent fit and text sizes are untouched; `check:themes` covers `retro`.

## Success Criteria
- Retro scene distinctly 8-bit on both densities; all contrast pairs pass; office check green.

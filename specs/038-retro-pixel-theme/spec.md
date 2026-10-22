# Feature Specification: Retro pixel theme (spec 038)

<!-- specs-index (the row in specs/README.md; after an edit run `npm run specs:index`)
group: 035-040
title: Retro pixel theme: 8-bit palette, palette pixel maps in art slots, arcade motion
status: **built**; dark arcade page allowed (FR-001 amended 2026-10-18)
-->

**Feature Branch**: `035-theme-foundation` (issue #129)
**Created**: 2026-10-18
**Status**: Implemented on branch `035-theme-foundation` (PR #137): simulator and unit tests, 0 AIU; not released
**Input**: Vikram (issue #129): 8-bit palette pixel characters.

## Clarifications (binding)

- Characters become **palette pixel art**: hair and accessories are blocky slot art; the body/head use the same slot geometry with `shape-rendering:crispEdges`-friendly rect-based art slots. Palette pixel maps (string grid → `<rect>`s) are a supported art-slot format.
- Retro renames scene words only: Library→Arcade, Software library→Cartridge Bay, Terminal→Console, Web→Modem, Other tools→Gadgets; lobby label "Game lobby". Status words unchanged.

## Requirements

- **FR-001** `[IMPLEMENTED]` `retro` pack: 8-bit palette (amended 2026-10-18, owner decision: the page and the top bar may be dark, but **no small text sits on a dark surface** except the top bar title and labels at 4.5:1 or more; cards, pills, tiles and plates stay light so 10.5px text and 4.5:1 pills hold) — chunky monitors, cup → mug, plant → potted cactus, blocky hair styles via pixel maps.
- **FR-002** `[IMPLEMENTED]` Pixel maps in art slots: `{palette:{a:'#…'},rows:['…']}` compile to sanitized `<rect>` grid SVG (validated cell size/colours).
- **FR-003** `[IMPLEMENTED]` Motion preset `arcade`: stepped animations (steps() already used for compact scenes; the preset shortens durations).
- **FR-004** `[IMPLEMENTED]` The 15-agent fit and text sizes are untouched; `check:themes` covers `retro`.

## Success Criteria
- Retro scene distinctly 8-bit on both densities; all contrast pairs pass; office check green.

## Changes

### 2026-10-18: a UI style of its own (spec 035 FR-009..FR-012)

- `[IMPLEMENTED]` The pack sets `ui` and stronger core colours: 8-bit arcade: a dark blue page and a black top bar with a yellow monospace title, light rooms in a fixed game palette with thick black outlines and hard offset shadows, square corners everywhere (cards, pills, buttons, tiles), monospace uppercase display text. Sizes are unchanged; `check:themes` covers it. Owner review of the look requested in PR #137.

- 2026-10-18 FR-001 amended (Vikram, PR #137 review): a dark arcade page and top bar are allowed; the contrast rule is kept as "no small text on a dark surface".
- `[IMPLEMENTED]` (2026-10-18, spec 035 FR-013) Its own people and furniture: 8-bit people on a 3px grid (square heads, block hair, square hands), a stepped wooden desk, a beige CRT with scanlines and a pixel mug (`pixel` kit).

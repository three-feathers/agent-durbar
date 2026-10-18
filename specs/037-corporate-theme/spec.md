# Feature Specification: Corporate theme + theme picker (spec 037)

**Feature Branch**: `035-theme-foundation` (builds on 035/036, issue #129)
**Created**: 2026-10-18
**Status**: Spec phase
**Input**: Vikram (issue #129): sleek glass-and-steel corporate office in blues and grays, and the user picks a theme in Settings.

## Clarifications (binding)

- Same data-only rules as 035/036: tokens, slots, words, motion presets only.
- The picker lives in **Settings** (no restart): choosing another theme applies it live (tokens re-applied, scene cache cleared, re-render).
- Layout, 15-agent fit and status/credit wording are unchanged.

## User Scenarios & Testing

### Story 1 — Corporate look
1. **Given** the Corporate theme, **Then** walls/tints move to cool blues and grays (glass), desks/monitors to steel tones, room plants become understated, and pill colours keep their status meaning (blue/amber/red/green accents stay readable).
2. **Given** Corporate, **Then** scene words are tasteful corporate: Library→Records, Software library→Repository, Terminal→Server room, Web→Network, Other tools→Facilities; lobby label uses "Reception".

### Story 2 — Picker
1. **Given** Settings, **Then** a *Theme* section lists every available theme (built-ins now; user packs later) by name and id, with the active one ticked.
2. **Given** a click on another theme, **Then** it applies at once, is saved to settings via a new `settings:setTheme` bridge call, a toast confirms, and `SC_CACHE` is cleared so scenes redraw with the new tokens/words. Unknown ids fall back to Clean Office.

## Requirements

- **FR-001** `[PLANNED]` `corporate` pack in `theme.js` built-ins: full token map, art slots for plant/doors/monitor bezel, word map, motion preset (`calm`: slower, low-amplitude animations).
- **FR-002** `[PLANNED]` Settings Theme section in `screens.js`: list from `THEME.list()`, current from settings; a select (or button list) calls `setTheme` through the bridge (new IPC `settings:setTheme`, validated `id` string) and then `THEME.setTheme(id)` + `SC_CACHE.clear()` + `scheduleRender()`.
- **FR-003** `[PLANNED]` Contrast: every themed pill ink keeps ≥4.5:1 on its pill background (checked in tests per pack).
- **FR-004** `[PLANNED]` `check:themes` covers `corporate`.

## Success Criteria
- **SC-001**: live switch without restart; setting survives relaunch; fallback works.
- **SC-002**: Corporate passes the per-theme office check at both sizes.

## Assumptions / out of scope
- Settings model gains one string key `theme` only; no per-room theming.

## Changes

### 2026-10-18: a UI style of its own (spec 035 FR-009..FR-012)

- `[IMPLEMENTED]` The pack sets `ui` and stronger core colours: glass-and-steel office: a dark navy top bar, white rooms with a coloured accent bar on the left edge, square-cornered cards with a thin border and a soft shadow, rectangular tag-style pills and buttons, room names as small uppercase labels. Sizes are unchanged; `check:themes` covers it. Owner review of the look requested in PR #137.

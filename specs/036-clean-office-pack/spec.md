# Feature Specification: Clean Office pack — today's office as a theme (spec 036)

**Feature Branch**: `035-theme-foundation` (builds on spec 035; one PR for 035-040, issue #129)
**Created**: 2026-10-18
**Status**: Implemented on branch `035-theme-foundation` (PR #137): simulator and unit tests, 0 AIU; not released
**Input**: Vikram (issue #129): Clean Office (today) is the first built-in pack. Everything it draws is exactly what the office draws today.

## Clarifications (binding, from issue #129)

- A theme is a **data-only pack**: manifest, colour tokens, art slots (sanitized SVG or palette pixel maps), fixed motion presets. **No scripts, no raw CSS, no code plugins.**
- Themes may rename **scene words only** — desk, lobby, door, helper, place names. Status, permission and credit wording never change.
- Layout and the 15-agent fit at 1280x800 are **not** theme-controlled.
- **Always falls back to Clean Office** (a malformed or unknown theme never leaves the office broken).
- `check:office` must pass **per theme**.

## User Scenarios & Testing

### User Story 1 — Clean Office is the default and exact
1. **Given** no theme setting, **Then** the office uses Clean Office: every colour, every scene shape and all wording are byte-equivalent to `main` before 035.
2. **Given** any other theme, **Then** a scene element the theme does not fill falls back to the Clean Office value for that token or slot.

### User Story 2 — Scene colours come from semantic tokens
1. **Given** `scene()`, `avatar()` and `hairFront()`, **Then** every hard-coded colour is a `THEME.token('--…')` semantic token; with Clean Office active the rendered scene is identical to before.
2. **Given** a token a theme does not set, **Then** the Clean Office value is used.

### User Story 3 — Scene words can be renamed, scripts do not read them
1. **Given** themeable scene words (place names, "door" in aria strings, lobby label), **Then** they flow through `THEME.word(key)` and scene elements carry stable `data-*` ids for checks and scripts.

## Requirements

- **FR-001** `[IMPLEMENTED]` Extend `CLEAN_TOKENS` in `theme.js` with all scene/office domains: `--scene-*` (shadow, chair, desk, desk-front, desk-drawer, monitor, monitor-stand, laptop, screen frames and per-status screens, cup, steam, bubble, sweat, mouth, monster-horn, stars, ambulance…), `--tint-*`/`--wall-*` room tints (both densities), `--pill-*` pill backgrounds/inks, `--pb-*`/`--pc-*` pairs, word and accessory colours.
- **FR-002** `[IMPLEMENTED]` `scene()`, `avatar()`, `hairFront()`, `badgeSVG`, the plant, the doors and `linksSVG` read all colours from `THEME.token()`; the per-person `skin/hair/shirt` stay look data (token defaults, theme-overridable via art slots).
- **FR-003** `[IMPLEMENTED]` Scene-word keys: `place-library/software/terminal/web/other` (place tiles, settings defaults and "At X:" visit text), `lobby`, `door-close`, `door-open`, `plus-more` chip wording stays English (layout text, not a scene word).
- **FR-004** `[IMPLEMENTED]` `scripts/shots-024.js` stops parsing English place names; it reads `data-place` ids (added to away-desks) instead. No other script reads scene words.
- **FR-005** `[IMPLEMENTED]` Theme override hook in main: `DURBAR_THEME=<id>` dev hook seeds the theme for checks; the office layout check runs per built-in theme (`check:themes`).
- **FR-006** `[IMPLEMENTED]` Per-theme motion presets (`motion` in the manifest) selected at theme time; `prefers-reduced-motion` is honoured on every switch (a `reduced` preset is applied when the media query matches), not only at startup.
- **FR-007** `[IMPLEMENTED]` Calm: with Clean Office active there is no pixel change; `check:office` passes byte-identical scenes; `test:theme` gains per-pack defaults/fallback checks.

## Success Criteria

- **SC-001**: Clean Office output identical to `main` (scene SVG strings byte-identical, screenshots unchanged).
- **SC-002**: `shots-024` and `check:office` pass reading `data-*` ids only.
- **SC-003**: `test:theme` covers token fallback and scene words.

## Key Entities

- **SceneToken**: a `--…` CSS custom property name with a Clean Office default value.
- **SceneWord**: a renameable scene word key → text (never status/permission/credit wording).

## Assumptions / scope

- No new visual theme here (that is 037-039). The picker UI is spec 037 delta; the user-theme folder is 040.
- `scene.js` stays inside `app.js` (the file is cohesive); no new build steps.

## Verification

- `npm run typecheck && npm test` pass; `check:office` passes; `check:themes` (new) passes for Clean Office.

# Feature Specification: Clean Office pack — today's office as a theme (spec 036)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 035-040
title: Clean Office pack: every scene colour a semantic token, scene words, `data-*` ids, per-theme motion presets
status: built
note: T008 stage D check ran as a one-off harness, not a script
-->

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

### 2026-10-18: `check:themes` never applied the theme (found while preparing alpha.5)

**Symptom.** In simulator runs (`DURBAR_SIM`) the renderer takes its settings from the simulator bridge, which had no theme, and `check-office-overlap.js` builds its own page addresses without one. So `DURBAR_THEME=<id>` changed nothing: every "per-theme" `check:office` run (`check:themes`, the PR #137 description and review replies) measured **Clean Office** six times. Probe: `DURBAR_THEME=retro DURBAR_SIM=15` opened with `data-ui` unset and `THEME.current().id === 'clean-office'`.

**Violated.** FR-005 ("the office layout check runs per built-in theme") and the #129 decision "`check:office` runs per theme".

**Corrected wording.**
- **FR-005** `[IMPLEMENTED]` In simulator runs the theme travels as the page address parameter `theme=<id>` (main adds `DURBAR_THEME` to it next to `sim=`); the simulator bridge returns it as the saved theme, so the normal start-up path applies it. `check-office-overlap.js` adds `theme=$OFFICE_THEME` to every combination and **fails** when the theme on screen (`THEME.current().id` and `data-ui`) is not the one asked for, so a check can never again pass on the wrong theme. A user theme for the check travels as `usertheme=<manifest JSON>` (simulator only) and goes through the same validation as an imported pack (spec 040 T005).

### 2026-10-31: fewer built-in packs (spec 035 FR-017)

- The built-in packs are now Clean Office and Retro Pixel; the motion preset `court` is gone (a user theme that names it gets `default`, the rule for an unknown preset). Everything else here stands. Specs 037 and 039 are marked `deprecated` and `superseded`.

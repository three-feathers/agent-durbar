# Feature Specification: Theme foundation — data-only theme packs

**Feature Branch**: `035-theme-foundation` (touches `src/renderer/app.js`, `src/renderer/styles.css`, `src/renderer/index.html`; reads `003` settings, `011` settings store, `017` room doors, `024` places, `033` floors)
**Created**: 2026-10-18
**Status**: Spec phase 0; implementation starting after agent health (spec 034) merged into `main`
**Input**: Vikram (issue #129): themes for the office — Clean Office (today), Corporate office, Retro pixel characters, Durbar court styles (Indian, European, Japanese). Other users must be able to make their own.

## Clarifications (Vikram, 2026-10-18)

- **Q: What do we call it?** **Theme** ("mode" already means permission mode).
- **Q: What is a theme?** A **data-only pack**: a manifest, colour tokens, and art slots as sanitized SVG or palette pixel maps. Fixed motion presets. No scripts, no code plugins, no raw CSS injection. Always falls back to Clean Office.
- **Q: What can a theme rename?** **Scene words only** — desk, lobby, door, helper, place names. Status, permission, credit and UI wording never change.
- **Q: What can a theme NOT change?** Layout, the 15-agent fit at 1280x800, status/permission/credit wording, adapter events, the settings model, IPC shape, the store format, window management, or anything in `main`/`renderer.ts`.
- **Q: How many themes ship?** Foundation only in this spec. Clean Office as the first built-in pack will follow in spec 036. Corporate (037), Retro (038), Durbar (039), user themes (040), AI maker (041) come later.
- **Q: What is the verification?** No visible change on `main` after this spec. `npm run check:office` must still pass for the Clean Office fallback. `npm run typecheck && npm test` pass. New unit tests for the token loader and manifest parser.

## User Scenarios & Testing

### User Story 1 — Theme loader exists (no visible change)

**Independent Test**: the app boots with a `theme` setting that resolves to the built-in Clean Office fallback; no pixel changes to the office.

**Acceptance Scenarios**:
1. **Given** no `theme` value in settings, **Then** the app uses Clean Office tokens and art.
2. **Given** an unknown or malformed theme id, **Then** the app falls back to Clean Office and logs a warning to the renderer console.
3. **Given** a future valid theme id, **Then** the manifest is loaded, but if the theme declares unsupported keys they are ignored and a warning is logged.

### User Story 2 — Tokens replace hard-coded colours in styles

1. **Given** the foundation is applied, **Then** the CSS variables that drive room tints, wall colours, status pills, text colours, and scene fills come from the active theme's token map instead of literal hex values.
2. **Given** a missing token, **Then** the Clean Office value is used.

### User Story 3 — Art slots replace hard-coded scene parts

1. **Given** the foundation is applied, **Then** `scene()` composes a figure from named art slots (`body`, `head`, `hair`, `eyes`, `mouth`, `desk`, `chair`, `laptop`, etc.) instead of inline SVG strings.
2. **Given** an art slot is missing, **Then** the Clean Office default SVG for that slot is used.

## Requirements

### Functional Requirements

- **FR-001** `[PLANNED]` Theme manifest schema (JSON): `id`, `name`, `author`, `version`, `extends` (only `"clean-office"` allowed for now), `tokens` (object), `art` (object of slot name → SVG string or pixel-map object), `motion` (object of preset name → CSS animation string), `words` (object of scene word key → string). Unknown keys are ignored. Malformed manifests fall back to Clean Office.
- **FR-002** `[PLANNED]` Token map: semantic names grouped by domain (`--room-*`, `--agent-*`, `--status-*`, `--text-*`, `--ui-*`, `--scene-*`). The active map is injected as CSS custom properties on the root element. Missing tokens fall back to Clean Office.
- **FR-003** `[PLANNED]` Art slot registry: a required set of slots used by `scene()` today (`body`, `head`, `hair-front`, `hair-back`, `eyes`, `mouth`, `shirt`, `pants`, `desk`, `chair`, `laptop`, `phone`). Slots are referenced by id; the loader returns the Clean Office default if the slot is missing or not a valid SVG subset.
- **FR-004** `[PLANNED]` Sanitization: theme SVG strings are parsed and only `<g>`, `<path>`, `<rect>`, `<circle>`, `<ellipse>`, `<line>`, `<polyline>`, `<polygon>`, `<text>` with explicit `fill`/`stroke` (or token references) are allowed. `<script>`, `<style>`, `on*`, `href`, and foreign objects are rejected. Invalid slots fall back to Clean Office.
- **FR-005** `[PLANNED]` Settings: a `theme` string in the renderer settings store (same file as `seriousMode`). No IPC change in this spec; the renderer reads it at startup and on `settings:changed`. Default `"clean-office"`.
- **FR-006** `[PLANNED]` Scene builder: `scene(a, d)` in `app.js` composes the figure from art slots and applies token fills/strokes. The output must be byte-identical to today's Clean Office output when the active theme is Clean Office.
- **FR-007** `[PLANNED]` Calm: no visible change when Clean Office is active. `npm run check:office` passes. `npm run typecheck && npm test` passes. Reduced motion still read once at load; no change.
- **FR-008** `[PLANNED]` Tests: unit tests for `src/renderer/theme.js` (manifest validation, token fallback, slot sanitization, unknown theme fallback). No simulator screenshots required in this spec.

### Key Entities

- **Theme**: `{id, manifest, tokens, art, motion, words}`.
- **ArtSlot**: sanitized SVG fragment or pixel map.
- **TokenMap**: flat object of semantic CSS variable names to values.

## Success Criteria

- **SC-001**: Booting the app with no `theme` setting or with `theme: "clean-office"` produces the same office pixels as `main` before this spec.
- **SC-002**: Loading a manifest with a missing token or missing slot falls back to Clean Office for that token/slot, with a console warning.
- **SC-003**: `npm run typecheck`, `npm test`, and `npm run check:office` all pass.

## Assumptions

- The settings file already exists (specs 011/024); only a new key is added.
- The renderer currently builds scene strings in `app.js` and has CSS literals in `styles.css`.
- No adapter, main process, or VS Code changes in this spec.
- Out of scope: user theme folders, import/export, AI maker, Corporate/Retro/Durbar packs, scene word renaming side effects.

## Verification

- `test:` new `scripts/test-theme.ts` covering manifest parsing, token fallback, slot sanitization, unknown theme fallback.
- `typecheck && build && npm test` pass.
- `check:office` passes with no pixel change (Clean Office fallback).
- No real-session check required (0 AIU).

## Known blockers and follow-ups

- Scene drawing is currently a string builder with about 60 hard-coded colours; this spec turns those into token references without changing the visuals.
- About 200 more colours in `styles.css` will be tokenized; some will stay literal if they are not theme-relevant.
- The five places are fixed in three files; spec 024 places may need token hooks later.
- `SC_CACHE` currently has no theme id; this spec adds `themeId` to the cache key.
- Reduced motion is read once; themes will use fixed motion presets in later specs.
- Some Clean Office state colours have low contrast alone; the gate will test colour plus icon/word cue.

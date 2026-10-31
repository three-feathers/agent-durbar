# Feature Specification: Theme foundation — data-only theme packs

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 035-040
title: Theme foundation: data-only theme packs, manifest, token map, art slot registry, UI styles (2026-10-18), Clean Office fallback
status: built
note: T013 owner review of the five looks
-->

**Feature Branch**: `035-theme-foundation` (touches `src/renderer/app.js`, `src/renderer/styles.css`, `src/renderer/index.html`; reads `003` settings, `011` settings store, `017` room doors, `024` places, `033` floors)
**Created**: 2026-10-18
**Status**: Implemented on branch `035-theme-foundation` (PR #137): simulator and unit tests, 0 AIU; not released
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

- **FR-001** `[IMPLEMENTED]` Theme manifest schema (JSON): `id`, `name`, `author`, `version`, `extends` (only `"clean-office"` allowed for now), `tokens` (object), `art` (object of slot name → SVG string or pixel-map object), `motion` (object of preset name → CSS animation string), `words` (object of scene word key → string). Unknown keys are ignored. Malformed manifests fall back to Clean Office. (plus `ui`, FR-009)
- **FR-002** `[IMPLEMENTED]` Token map: semantic names grouped by domain (`--room-*`, `--agent-*`, `--status-*`, `--text-*`, `--ui-*`, `--scene-*`). The active map is injected as CSS custom properties on the root element. Missing tokens fall back to Clean Office. The names are the ones in `CLEAN_TOKENS` (`--bg`, `--tint-*`, `--pb-*`, scene names such as `--chair`), not the domain prefixes above.
- **FR-003** `[IMPLEMENTED]` Art slot registry: a required set of slots used by `scene()` today (`body`, `head`, `hair-front`, `hair-back`, `eyes`, `mouth`, `shirt`, `pants`, `desk`, `chair`, `laptop`, `phone`). Slots are referenced by id; the loader returns the Clean Office default if the slot is missing or not a valid SVG subset. The slots are the ones in `CLEAN_SLOTS` and the stage D list (`chair-back`, `desk`, `monitor`, `plant`, `char-*`, `room-*`, `desk-art`, `door-art`, `lobby-art`, `place-*`, `hair-acc`), not the names above.
- **FR-004** `[IMPLEMENTED]` Sanitization: theme SVG strings are parsed and only `<g>`, `<path>`, `<rect>`, `<circle>`, `<ellipse>`, `<line>`, `<polyline>`, `<polygon>`, `<text>` with explicit `fill`/`stroke` (or token references) are allowed. `<script>`, `<style>`, `on*`, `href`, and foreign objects are rejected. Invalid slots fall back to Clean Office. Tightened on 2026-10-18 (spec 040 FR-005): fragments are rebuilt, not passed through.
- **FR-005** `[IMPLEMENTED]` Settings: a `theme` string in the renderer settings store (same file as `seriousMode`). No IPC change in this spec; the renderer reads it at startup and on `settings:changed`. Default `"clean-office"`. An IPC `settings:setTheme` was added for the picker (spec 037 FR-002).
- **FR-006** `[IMPLEMENTED]` Scene builder: `scene(a, d)` in `app.js` composes the figure from art slots and applies token fills/strokes. The output must be byte-identical to today's Clean Office output when the active theme is Clean Office. Checked 2026-10-18: with animations frozen, Clean Office on the simulator matches `main` within rendering noise at 1280x800 (0 pixels) and 1440x900 (max channel difference 4/255).
- **FR-007** `[IMPLEMENTED]` Calm: no visible change when Clean Office is active. `npm run check:office` passes. `npm run typecheck && npm test` passes. Reduced motion still read once at load; no change. Same check as FR-006.
- **FR-008** `[IMPLEMENTED]` Tests: unit tests for `src/renderer/theme.js` (manifest validation, token fallback, slot sanitization, unknown theme fallback). No simulator screenshots required in this spec.

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

## Changes

### 2026-10-18: UI styles, so a theme looks like its name (owner review of PR #137)

**Symptom.** Vikram, looking at screenshots of every pack at 1280x800: the themes "don't vary much". The cause is structural: every token is a **colour**; card and room shape, borders, shadows, the top bar, buttons, pills, lobby tiles and heading fonts are fixed in `styles.css`, and many surfaces are literal (`#fff` buttons, `rgba(255,253,249,.78)` cards), so a pack could only nudge the scene colours and rename places. Also found: the room and lobby art showed through transparent pieces (the `+N more` chip, lobby tiles), making their text hard to read (constitution V).

**Corrected wording.**
- **FR-009** `[IMPLEMENTED]` A manifest may name a **UI style**, `ui`, from a fixed list owned by the app: `clean`, `corporate`, `retro`, `court-indian`, `court-european`, `court-japanese`. Unknown or missing = `clean`. The style is set as `data-ui` on `<html>`; its CSS lives in the app (`src/renderer/themes.css`), never in the manifest, so this stays data-only (like the motion presets, 036 FR-006). A user theme may pick any listed style and give its own colour tokens; the style reads them through the same `var(--...)` names.
- **FR-010** `[IMPLEMENTED]` A UI style may change colours, borders, corner radii, shadows, textures (CSS gradients) and the font family of **display text** (brand, room names, place names, door plates, dialog titles). It must not change sizes, padding, gaps or the font size of anything the layout measures, so the 15-agent fit is the same in every style (enforced by `check:geometry` on every PR that touches the renderer, spec 008 FR-031, which since 2026-10-22 lays out Retro against Clean Office on pull requests and every style on `main` and nightly (spec 008 FR-111, owner decision); `test:theme` refuses any size property or size-carrying shorthand in `themes.css` on every PR; the full `check:themes` on demand). Display text that could get wider under another font is ellipsized, never wrapped.
- **FR-011** `[IMPLEMENTED]` Fonts are generic system stacks (serif, monospace); no font files are shipped. What a user sees depends on the fonts installed on their OS (documented as a limit).
- **FR-013** `[IMPLEMENTED]` (2026-10-18, owner: "let characters change with my theme, also desks") A manifest may name a **scene kit**, `scene`, from a fixed list owned by the app: `office`, `corporate`, `pixel`, `court-indian`, `court-european`, `court-japanese`. Unknown or missing = `office`. A kit draws the people (body, head, hair, clothes), the chair, the desk, the monitor frame and the desk props in its own style (`src/renderer/scenekits.js`); the theme's colour tokens still colour it. Every kit keeps the status cues in the same place and the same animation hooks: the screen content for each status, the waving hand, the thinking bubble, the idle cup, the mood signs (heavy, monster, faint, dizzy, ambulance, impatient) and the `.pp` group hidden while an agent is at a place. The `office` kit is the scene in `app.js` itself, so Clean Office does not change. The stage D overlay slots (`char-*`, `desk-*`, `monitor-art`, `hair-acc`) are drawn only by the `office` kit, so built-in packs no longer carry them; they remain for user themes on the `office` kit.
- **FR-012** `[IMPLEMENTED]` Theme art never covers text: everything with text in a room or the lobby (the `+N more` / `Show fewer` chips, lobby tiles and their slots) has an opaque background and sits above the art layers.

### 2026-10-22: theme layout checks on pull requests: Clean Office and Retro (owner decision, spec 008 FR-111)

Owner (Vikram, team chat 2026-10-22 06:17 UTC): run theme layout, geometry and screenshot checks on pull requests only for Clean Office and Retro (dark, its own display font and art); the other styles change only what FR-010 allows, which `test:theme` checks statically on every PR. Nothing in FR-009..FR-013 changes; only where the FR-010 layout proof runs (spec 008 FR-111).

### 2026-10-23: the kit list gains `crew` (spec 077)

FR-013's fixed kit list is now `office`, `corporate`, `pixel`, `court-indian`, `court-european`, `court-japanese` and `crew` (the Cheeky Crew theme's kit, spec 077); a user theme may name it like any other kit.

### 2026-10-25: three asserts that could not fail (issue #749, found by Paco's agent's test audit)

**Symptom.** `test-theme` compared the default pixel-map cell size with itself; `test-profilefiles` ran "a link is never written" only `if (r.ok)`, so a failed read skipped the security check; `test-markdown` ("hooks added once") could not see a hook added on every render. Each passed whatever the code did (mutation-verified).

- **FR-014** `[IMPLEMENTED]` (tests only, no behaviour change) The tests assert the real value: the default cell size is 3 (`test:theme`); the link read must succeed before the write refusal is checked (`test:profilefiles`); one hook at creation and none per render, one sanitizer call per render, counted through a spy (`test:markdown`). Mutations that now fail: default cell 3 to 4; `readProfileFile` failing on a link; `addHook` inside `render`.

### 2026-10-25: `test:theme` allows a list of properties instead of refusing a list of sizes (issue #747)

**Symptom.** The check for FR-010 was a denylist of size properties and shorthands. It missed `flex` (`flex: 0 0 120px`), `transform` (`scale`, large `translate`), `position` with `top`/`left`/`right`/`bottom`, and lengths inside custom properties. Spec 008 FR-111 lays out only Clean Office and Retro on pull requests and trusts this check for the other styles, so the hole mattered.

**Corrected wording.**
- **FR-015** `[IMPLEMENTED]` `test:theme` parses every declaration in `themes.css` and accepts only an **allow-list of properties**: colours, backgrounds and background size, border and outline colours, `border-radius`, `box-shadow`, `text-shadow`, `font-family`, `text-transform`, `z-index`; plus properties allowed with one exact value (`letter-spacing` up to `.1em`, since it widens text; today's uses are `.01em`-`.08em`; `position: relative`, `min-width: 0`, `overflow: hidden` (auto or scroll would add scrollbars), `text-overflow: ellipsis` or `clip`, `flex: 0 1 auto`, `transform: translate(Npx,Npx)` with N from -2 to 2 (today's Retro nudges), no scale or rotate; `font-weight` normal, bold or 400-800); plus the custom properties `--ui-display`, `--ui-top-ink`, `--ui-top-ink-2` and `--st-glyph`, whose values may carry no length. Anything else (an unknown property, `width`, `top`, `flex-basis`, a new `--*`) fails, so a new way to size or move something is refused by default. `border-radius` stays allowed because FR-010 allows corner radii. `DURBAR_THEMES_CSS` points the test at a mutant copy for mutation checks. Does not change FR-010 or spec 008 FR-111. **Structure** (review on #751): declarations are accepted only inside a plain rule. A rule nested in a rule (CSS nesting), a declaration directly in an `@`-block, and any top-level statement ending in `;` (`@import`, `@namespace`, `@charset`) are refused, so the per-rule check sees every declaration. `background-size` stays any-value: it sizes a background texture tile, never a box.

### 2026-10-28: Characters, separate from themes (spec 077, issue #814)

- **FR-016** `[IMPLEMENTED]` A theme's `scene` (FR-013) is now **the theme's own** characters and furniture: it is drawn while Settings > **Characters** is *The theme's own* (the default). A Characters choice (*Minimalist*: the `office` kit; *Cheeky*: the `crew` kit) replaces it on any theme, built-in or user. Everything else in FR-009..FR-015 is unchanged: the tokens still colour the kit, the art slots are still drawn over it, the layout is the same. Cheeky Crew is no longer a built-in theme (the kit list keeps `crew`). Details, the migration of the old theme and the checks: spec 077 FR-064..FR-070.

### 2026-10-31: built-in Corporate and court themes removed (owner decision, spec 021 FR-067)

Built by T083..T088 in one PR (spec 021 FR-068).

- **FR-017** `[IMPLEMENTED]` `test: test:theme, test:scenekits, test:userthemes` **Removed.** The built-in themes `corporate`, `durbar-indian`, `durbar-european`, `durbar-japanese`: their packs in `theme.js`, UI styles (`corporate`, `court-*`) and `themes.css` blocks, scene kits (`corporate`, `court-*` in `SCENE_KITS`, `scenekits.js`), `motion` preset `court`, and their entries in `src/shared/themes.ts`, `src/shared/themegen.ts`, `src/main/ipc/themes.ts`, `src/renderer/screens.js` and `src/renderer/sim.ts`. Clean Office and Retro Pixel stay (spec 102 OP-12). The kingdom worlds of spec 102 are new art and reuse none of this.
- **FR-018** `[IMPLEMENTED]` `test: test:characters, test:userthemes, test:theme` **Migration, once** (the 077 FR-067 pattern, in main on read). A stored `theme` with a removed id is cleared to Clean Office, once, and the file written. `characters` is untouched. Removed ids stay reserved in `BUILT_IN_THEME_IDS`, so no import takes them (077 FR-066). **A saved theme that names a removed `ui` or `scene`** keeps working: that one value falls back to `clean` or `office` (FR-013's rule for unknown), with 070's per-value note. A shipped test asserts each path. An organisation's theme key (076, draft) naming a removed id is an unknown id there.
- **FR-019** `[IMPLEMENTED]` **Retro Pixel is not in this removal.** It waits for spec 102's Retro game (OP-12).
- **FR-020** `[IMPLEMENTED]` **Status.** Spec 037 becomes `deprecated` (removed, no replacement; the note gives the merge date) and spec 039 `superseded` (by spec 102's kingdom worlds), each with a note, in T088, which needs spec 021 T053 first. Spec 035 and 036 stay `built`.
- **Helpers that stay**, because specs 096 and 102 reuse them: `checkUserManifest`, `USER_THEME_LIMITS`; `themeIssues`, `CONTRAST_PAIRS`, `contrastFix`; `validateManifest`, `resolveTokens`; `UserThemeStore`, `pickFolder`; `oneShotCostLine`, `pickIdeas`, `askDialog`; `crew` and `office` kits, `pixel` while Retro stays. Only the id lists inside them shrink.

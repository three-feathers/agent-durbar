# Feature Specification: User themes — personal packs with import/export (spec 040)

**Feature Branch**: `035-theme-foundation` (issue #129)
**Created**: 2026-10-18
**Status**: Implemented on branch `035-theme-foundation` (PR #137): simulator and unit tests, 0 AIU; not released
**Input**: Vikram (issue #129): other users must be able to make their own theme.

## Clarifications (binding)

- A user theme is a **folder under per-user data**: `userData/themes/<id>/manifest.json` (+ nothing else required; the manifest carries tokens, art and words inline). No zip support, no network.
- Import = copy a folder (chosen with the system folder picker) **into** `userData/themes/`; export = copy the theme's folder **out** to a picked directory. A manifest is validated with the same schema and SVG sanitizer as built-ins; a malformed pack is rejected with a toast and never applied.

## User Scenarios & Testing

### Story 1 — My theme appears next to the built-ins
1. **Given** `userData/themes/ocean/manifest.json` with a valid manifest, **Then** Settings > Theme lists "Ocean" and I can switch to it like a built-in.
2. **Given** a broken manifest, **Then** the pack is ignored, a console warning names the file, and Clean Office stays.

### Story 2 — Import/export
1. **Given** Settings > Theme > Import, **Then** after picking a folder whose `manifest.json` validates, the folder is copied to `userData/themes/<id>/`, the theme is applied and appears on restart.
2. **Given** Export on the active user theme, **Then** the folder is copied to the picked directory unchanged.
3. **Given** an invalid folder (no manifest / malformed / unsafe SVG), **Then** a toast says what was wrong and nothing is copied or applied.
4. **Given** a user theme id equal to a built-in, **Then** import is refused ("id is a built-in").

## Requirements

- **FR-001** `[IMPLEMENTED]` Main: `theme:listUser` scans `userData/themes/*/manifest.json`, validates (id pattern, size caps: manifest ≤ 64 KB, ≤ 40 tokens, ≤ 24 slots, ≤ 24 words, folder name = id), returns `{id,name}` per valid pack plus `{folder,error}` per invalid one.
- **FR-002** `[IMPLEMENTED]` Main: `theme:getUser(id)` returns the manifest JSON (validated again) for renderer application; unknown/invalid → `null`.
- **FR-003** `[IMPLEMENTED]` Main: `theme:import` (folder picker) validates, refuses built-in ids and path escapes, copies the folder (flat, ≤ 8 files, ≤ 64 KB each) to `userData/themes/<id>/`; `theme:export` copies the active user theme's folder out. Both return `{ok,error?}`.
- **FR-004** `[IMPLEMENTED]` Renderer: Theme section lists built-ins + user themes (tagged "yours"); picking a user theme applies its manifest via `THEME.setTheme(manifest object)` and persists the id; invalid picks toast and stay on the old theme.
- **FR-005** `[SUPERSEDED 2026-10-18]` ~~Sanitizer unchanged (same whitelist); pixel maps allowed as in spec 038.~~ See `## Changes`: the sanitizer now rebuilds fragments.

## Success Criteria
- Import a hand-made pack on disk → appears, applies, survives restart, exports byte-identical; a tampered manifest is refused with a clear toast; `npm test` covers the store/validate paths without Electron.

## Changes

### 2026-10-18: imported themes are untrusted input (review of PR #137)

**Symptom.** Paco's review found that the art-slot sanitizer checks a fragment with regexes and then returns the **original string**, which goes into `innerHTML`. An unquoted attribute value (`\S+`) also matches `<` and `>`, so `<rect fill=x><style>…</style>` passed and injected CSS into the whole window (`style-src 'unsafe-inline'`). While fixing it, two more holes of the same kind were found: theme **tokens** were copied without checks, `applyTokens` set *any* manifest key as an inline style on `<html>` (`{"display":"none"}` hides the app), and token values are inlined unescaped into SVG attributes (`fill="${token}"`), so a value with a `"` breaks out of the attribute. Words were already escaped where shown, but any key and any length was kept.

**Violated.** #129 invariants "data-only, no raw CSS" and "status, permission and credit wording never change"; FR-005 assumed the sanitizer was safe for untrusted input.

**Corrected wording.**
- **FR-005** `[IMPLEMENTED]` The sanitizer **rebuilds** each art fragment from allowed elements and attributes instead of passing the input through: every attribute value must be quoted, may not contain `<`, `>` or a backtick, and is re-serialized with `&`, `<`, `>`, `"` escaped; `url(...)` is allowed only as a local reference `url(#id)`. Anything else rejects the slot (the default drawing is used). Built-in slots are already in this canonical form and come out byte-identical.
- **FR-006** `[IMPLEMENTED]` Tokens: only the keys of Clean Office (`--name` custom properties) are kept, and each value must be a colour (`#hex`, `rgb()`/`rgba()`/`hsl()`/`hsla()` with numbers only), a number with an optional unit, or a single keyword, at most 64 characters. Other keys and values are dropped (the Clean Office value is used). The main process refuses to import a manifest with a token key that is not `--name` or a value outside this grammar, and says which token.
- **FR-007** `[IMPLEMENTED]` Words: only the scene-word keys of Clean Office are kept, each a string of at most 60 characters without control characters (the longest built-in, an accessible lobby label, is 42); others are dropped. They stay escaped wherever they are shown.
- **FR-009** `[IMPLEMENTED]` A user theme may name a `scene` kit from the fixed list (spec 035 FR-013); main refuses an unknown one with a message.
- **FR-010** `[IMPLEMENTED]` Art keys are limited to the slots the renderer draws (`ART_SLOTS`: plant, the three room layers, lobby, door, the five place icons and the office-kit overlays); the renderer drops any other key and main refuses it on import, naming the slot.
- **FR-008** `[IMPLEMENTED]` Review follow-ups: `theme:listUser` sends only id, name, ok and error to the renderer (no folder path); a failed import removes its temporary folder and returns `{ok:false}` instead of throwing; the `DURBAR_PICK` dev hook takes the whole value (Windows `C:\…` paths); `DURBAR_THEME` applies a theme for the run without saving it.

**Tests.** `test:theme` adds Paco's bypass strings and the token and word cases; `test:userthemes` adds a refused token and a failed copy that leaves no temporary folder.

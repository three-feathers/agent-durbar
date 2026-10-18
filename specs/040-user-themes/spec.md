# Feature Specification: User themes — personal packs with import/export (spec 040)

**Feature Branch**: `035-theme-foundation` (issue #129)
**Created**: 2026-10-18
**Status**: Spec phase
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

- **FR-001** `[PLANNED]` Main: `theme:listUser` scans `userData/themes/*/manifest.json`, validates (id pattern, size caps: manifest ≤ 64 KB, ≤ 40 tokens, ≤ 24 slots, ≤ 24 words, folder name = id), returns `{id,name}` per valid pack plus `{folder,error}` per invalid one.
- **FR-002** `[PLANNED]` Main: `theme:getUser(id)` returns the manifest JSON (validated again) for renderer application; unknown/invalid → `null`.
- **FR-003** `[PLANNED]` Main: `theme:import` (folder picker) validates, refuses built-in ids and path escapes, copies the folder (flat, ≤ 8 files, ≤ 64 KB each) to `userData/themes/<id>/`; `theme:export` copies the active user theme's folder out. Both return `{ok,error?}`.
- **FR-004** `[PLANNED]` Renderer: Theme section lists built-ins + user themes (tagged "yours"); picking a user theme applies its manifest via `THEME.setTheme(manifest object)` and persists the id; invalid picks toast and stay on the old theme.
- **FR-005** `[PLANNED]` Sanitizer unchanged (same whitelist); pixel maps allowed as in spec 038.

## Success Criteria
- Import a hand-made pack on disk → appears, applies, survives restart, exports byte-identical; a tampered manifest is refused with a clear toast; `npm test` covers the store/validate paths without Electron.

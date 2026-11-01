# Implementation Plan: Experience contract (spec 098)

**Branch**: `098-experience-contract` (spec) | **Date**: 2026-10-31 | **Spec**: [spec.md](spec.md)

## Summary

A small registry of world moments (`docs/experience/world-moments.json`), a static check that keeps the registry and the renderer's `data-surface` markers in step, a block contract for world packs with its own test, an extension of the existing theme-token lint for tool surfaces, two simulator drivers (the world matrix and the tool-surface scenes) run weekly in full and as a small path-filtered pull-request subset, and one rolling "World coverage" issue. No `AGENTS.md` line; one Spec Kit override template line and one PR template checkbox.

## Technical Context

- **Language**: plain Node for the static checks and drivers (`scripts/*.js`, like `rules-check.js` and the `ui-suite.js` drivers); TypeScript for the block test, compiled with `tsconfig.scripts.json` like `test-crew-assets.ts`.
- **Dependencies**: none new.
- **Storage**: the registry JSON in `docs/experience/`; matrix output in `out/world-matrix/` (git-ignored, uploaded as an artifact).
- **Testing**: `test:surfaces` (registry check and its fixtures), `test:world-packs` (block contract), `test:theme-tokens` (extended), simulator drivers through `ui-suite.js`.
- **Performance**: `test:surfaces` reads text files only (well under a second); the PR subset fits a 12-minute timeout (one Electron per world, scenes switched by URL options).
- **Constraints**: no AI credits; no secrets or write permissions in the PR run; Windows/macOS/Linux for the static checks (paths with `path.join`, no shell).

## Architecture

```
docs/experience/world-moments.json        registry: worlds, blocks, 26 moments, cell states
        │
        ├─ scripts/check-surfaces.js      test:surfaces (npm test): schema, markers <-> registry, shippable, no styling on markers,
        │                                  PR filter covers moment files, matrix not in DOC_SHOTS, out/ ignored
        ├─ scripts/world-matrix.js         driver: present moments x worlds x sizes -> out/world-matrix/*.png + matrix.json
        ├─ scripts/check-world-tools.js    driver: Settings, New session dialog, List view per world
        └─ scripts/world-coverage.js       weekly: matrix.json + registry -> the "World coverage" issue body
src/renderer/**                            data-surface="<id>" on world-moment roots (literal ids only)
src/renderer/realoffice/worlds/<id>/       world.json (blocks, anchors, tokens, light-slot shapes), world.css, pictures
        └─ scripts/test-world-packs.ts     test:world-packs (npm test): block contract FR-030..FR-033
scripts/test-theme-tokens.ts               + realoffice files under the ratchet; world.css: 0 literals, no size props outside moment roots
.github/workflows/world-matrix.yml         schedule (weekly, full, issues: write) + pull_request (paths, subset, contents: read)
.github/workflows/nightly-watch.yml        + "World matrix" in its workflow list (red means owned)
.specify/templates/overrides/spec-template.md   managed template + Experience line; pinned by test:surfaces
.github/pull_request_template.md          + one Experience checkbox
```

- **Existing capabilities reused** (spec 021 FR-031): `test:theme-tokens` and its ratchet (070 FR-040) instead of a new lint; `ui-suite.js` `runOne` and `until()` for both drivers; `check-office-overlap.js` overlap, clip and 10.5 px helpers for the per-root checks; `theme.js` `contrastCheck` for text pairs; `scripts/webpinfo.ts` (097 P1) for WebP facts in the block test; `weekly-retro.js`'s find-by-title-and-author pattern for the coverage issue; `nightly-watch.yml` for red-means-owned; Spec Kit's override stack (`resolve_template`) for the template line.
- **Marker scan**: a regular expression over `src/renderer/**/*.{html,js}` for `data-surface=`, `dataset.surface` and `setAttribute('data-surface'`; the value must be a quoted literal of `[a-z0-9-]`, anything else is a failure. CSS files are scanned for `[data-surface`; JS for reads of `dataset.surface` or `getAttribute('data-surface')`.
- **Workflow file parse**: `check-surfaces.js` reads the `paths:` list under `pull_request` from `world-matrix.yml` with a small line parser (no YAML dependency) and matches moment `files` with glob-to-regex (`**`, `*`).
- **Subset selection**: the job computes changed files with `git diff --name-only` against the PR base (numbers and paths only, passed through `env:`, never interpolated into `run:`); `worlds/<id>/**` only → that world; anything else in the filter → all worlds.
- **Coverage issue**: `gh issue list --author app/github-actions --search '"World coverage" in:title'`, exact title match on the result, then `gh issue edit --body-file` or `gh issue create`; body from files written by the script, never from issue text.
- **Template override**: a copy of `spec-template.md` with one inserted section; `test:surfaces` removes that section and compares with the managed file byte for byte.

## Phases

- **P1 Registry check** (T010-T012): `check-surfaces.js`, markers on the built moments, PR template and override template.
- **P2 Tool surfaces** (T020-T021): lint extension and the tool-surface driver.
- **P3 Block contract** (T030-T031): `test:world-packs`; the photo pack's `world.json` (after 097 P1 merges and the worlds delta's pack move).
- **P4 Matrix and coverage** (T040-T043): the matrix driver, the workflow, nightly-watch, the coverage script.

## Constitution Check

No violation. I: spec first (this PR). III: the PR job has no secrets or write permission; the issue body is generated from repository data. IV: simulator only. V: the drivers enforce 10.5 px and contrast. VI: static checks on every OS; the drivers run on Linux runners (`[KNOWN GAP]`). VIII: limits in the spec.

## Risks

- **Subset time** (Ruben's condition): if the first runs approach the timeout, the subset drops to the touched world only, never to fewer moments; measured on the first PR that matches.
- **Scene coverage**: some moments need simulator states that do not exist yet (a pending elicitation at Other tools, a coffee break with a visitor); those moments stay `planned` until the simulator can show them.

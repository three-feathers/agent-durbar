# Tasks: 098 Experience contract

**Input**: [spec.md](spec.md), [plan.md](plan.md)

**Tests**: required (constitution VII; SC-001..SC-006). Node tests and the simulator only; 0 AI credits; no network. Driver waits use `until()`, never a fixed sleep; no wall-clock assertion.

**Format**: `- [ ] Tnnn [P?] [USn?] description (file) [requirements]`, then a `Test:` line. `[P]` = can run in parallel. A phase = one PR. Numbers taken: spec 098, FR-001..FR-080 (sparse by group), T001..T050.

## Phase 0: Spec (this PR)

- [x] T001 Spec, plan, tasks and specs-index block (`specs/098-experience-contract/`). Test: `npm run specs:check`, `npm run rules:check`.
- [x] T002 Registry seeded from the inventory: 26 world moments, worlds `photo`, `cave`, `loft` (none shippable), every moment `code: "planned"`, 9 `missing` per world (`docs/experience/world-moments.json`). Test: `read:` counts checked by the seeding script (26 moments; 9 missing in each world) [FR-010, FR-011, FR-012]

## Phase 1: Registry check (PR P1) - US1, US4

- [ ] T010 [US1] `scripts/check-surfaces.js` + `test:surfaces` in `npm test` (`package.json`, `scripts/run-tests.js` limits): schema, markers ↔ registry, literal ids only, shippable has no `missing` and no `fallback-flat`, `built` needs `present`, no styling on markers, moment `files` covered by the PR filter, no matrix driver in `shots-docs.js`, `out/` git-ignored; fixtures under `scripts/fixtures/surfaces/`. Test: `test:surfaces` green on the repo; red on each fixture (unregistered marker, present moment without marker, planned moment with marker, template-string marker, shippable world with a missing or fallback-flat cell, `[data-surface` in CSS, `dataset.surface` read, a moment file outside the filter, a matrix driver in `DOC_SHOTS`) [FR-014, FR-020..FR-026, FR-054, SC-001]
- [ ] T011 [US1] `data-surface` markers on the roots of the built moments (lobby, places, desk, lounge, walkers, empty office, welcome, lift panel, All floors, inbox, chat panel, header, cards, answer bar, coffee bar; the P1 Real office roots after 097 P1 merges), each flipped to `code: "present"` in the same change. Test: `test:surfaces`; `sim:` `check:ui` drivers that touch those screens unchanged (no style or behaviour on the attribute) [FR-014, FR-022]
- [ ] T012 [P] [US4] `.specify/templates/overrides/spec-template.md` (managed template + the *Experience* line) and the PR template checkbox; `test:surfaces` compares the override with the managed template minus the section. Test: `test:surfaces` red when the managed template changes or the line is removed; `specify integration status` shows only the accepted finding [FR-070, FR-071, FR-072]

## Phase 2: Tool surfaces (PR P2) - US2

- [ ] T020 [P] [US2] `scripts/test-theme-tokens.ts`: add `src/renderer/realoffice/**/*.{css,js}` to the ratchet files; world-pack CSS: zero colour and `font-family` literals outside its token block, no size or spacing property outside a registered moment root. Test: `test:theme-tokens` red on a fixture `world.css` with `color: #fff` in a rule, with `padding: 4px` on `.dlg`, and green with `padding` on a moment root class [FR-040, SC-002]
- [ ] T021 [US2] `scripts/check-world-tools.js` (a `ui-suite.js` driver, not in `DOC_SHOTS`): each world, Settings (Office layout), New session dialog, List view; 10.5 px, contrast pairs, overflow, no picture behind text, same accessible names across worlds; output to `out/world-matrix/tools/`. Test: `sim:` green on the photo world; red with a fixture world whose `--ink` fails contrast [FR-041, FR-042, FR-043]

## Phase 3: Block contract (PR P3)

- [ ] T030 [P] `scripts/test-world-packs.ts` + `test:world-packs` in `npm test`: every block filled, sizes and caps in range, anchors 0..1, `realHeight` present for fixtures and standing frames, files listed ↔ present, tokens valid by type and passing contrast, no layout fields; reuse `scripts/webpinfo.ts`. Test: green on a minimal fixture pack; red on a missing block, an anchor of 1.2, a 90 KB frame, an unlisted file, a `x`/`top` field, a fixture without `realHeight`, a token that fails contrast [FR-030..FR-033]
- [ ] T031 `world.json` for the photo world (P1 art as blocks; after 097 P1 merges and the 097 worlds pack move, 097 T101). Test: `test:world-packs` green on it [FR-031, FR-033]
- [ ] T032 Design the 9 missing moments for the photo world (first run, empty office, lounge/asleep, inbox (Boss-door queue), limit card, coffee break, MCP elicitation, floor jumps, desk-to-lobby walk): a design per moment recorded in the registry as `designed`, with the decided ones (lounge: Q5 desk with lamp off; walk: 097 FR-073 cross-fade) as the start. Test: `read:` registry has no `missing`/`fallback-flat` cell for `photo`; pictures await Vikram's approval [FR-024, Q1]
- [ ] T033 Same for `cave` and `loft` before either is marked shippable (Paco's side designs; pictures await his approval). Test: `test:surfaces` passes with `shippable: true` only when no cell is `missing` or `fallback-flat` [FR-024, Q1]

## Phase 4: Matrix and coverage (PR P4) - US3

- [ ] T040 [US3] `scripts/world-matrix.js`: scenes per moment via simulator URL options, `until()` on `[data-surface=<id>]`, per-root 10.5 px, overlap and contrast; `--size`, `--worlds`, `--forced-colors`; writes `out/world-matrix/` and `matrix.json`; `out/` in `.gitignore`. Test: `sim:` run at 1280x800 writes one picture per present moment × world and nothing under `docs/`; `designed`/`missing` cells reported, not failed [FR-051, FR-054, FR-056]
- [ ] T041 [US3] `.github/workflows/world-matrix.yml`: weekly schedule (full, 2 sizes, forced colours, `issues: write`) and `pull_request` with the FR-052 paths (subset at 1280x800, touched worlds, `contents: read`, `timeout-minutes: 12`); artifact upload (14 days); pinned action SHAs as the other workflows; changed files via `env:`. Test: `test:surfaces` checks the filter covers moment files; `test:platforms` (or the existing workflow checks) for pinned actions; `real:` one `workflow_dispatch` run on the branch (Actions minutes only, no AI credits) [FR-050, FR-052, FR-053, FR-054, FR-063, SC-003]
- [ ] T042 [P] `nightly-watch.yml`: add "World matrix" to its workflow list. Test: `read:` the list; the first scheduled failure opens its issue [FR-055]
- [ ] T043 [US3] `scripts/world-coverage.js`: body from the registry and `matrix.json` only; find the issue by exact title and author `github-actions[bot]`, edit or create; never opens other issues. Test: unit test with a fake `gh` runner: creates once, edits on the second run, ignores a same-titled issue by another author, body has no path outside the repo [FR-060..FR-063, SC-005]

## Phase 5: Docs and convergence

- [ ] T050 README *Development* (`test:surfaces`, `test:world-packs`, the matrix workflow and where its artifacts are), changelog fragment per build PR, spec tags, `/speckit.converge`. Test: `npm run changelog:check`, `specs:check`, `test:docsscripts`

## Delta 2026-11-01: monitor part and arrangement (FR-081, FR-082)

- [ ] T147 `test:world-packs` and the block list: monitor and `focus` parts, `arrangement`, through spec 102's validator (102 T171). Test: `test:world-packs` with bad fixtures [FR-081]
- [ ] T148 World matrix runs each world in its arrangement, and one row past its fall-back. Test: `sim:` `world-matrix.js` on a fixture world [FR-082]

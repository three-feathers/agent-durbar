# Tasks: 025

- [x] T001 Spec, plan, tasks (this folder) + specs index row
- [x] T002 Catch-up audit of README, CHANGELOG, CONTRIBUTING, SECURITY, specs index, stale task ticks [FR-004]
- [x] T003 `AGENTS.md` "Keep docs in sync", pointers in CLAUDE.md, copilot-instructions, docs/collaboration.md, CONTRIBUTING.md [FR-001]
- [x] T004 PR template: Docs section, screenshots line [FR-002]
- [x] T005 `docs-check.sh`, `test-docs-check.sh`, non-blocking `docs-check` job, `docs-n/a` label in `labels.tsv` [FR-003]
- [x] T006 Regenerate the screenshots that still show "Allow edits" (`m7-mode-confirm.png`, `m7-mode-context.png`, and `m7-mode-switch.png`, which the audit also found) from the simulator with `scripts/shots-mode.js` [FR-005]
- [x] T008 Refresh the README hero pictures and the current-state pictures that predate usage totals, the Tools/Settings buttons and the folder import (`scripts/shots-hero.js`, `shots-m9.js`, `shots-m10.js`, `shots-about.js`); link the About picture [FR-006]
- [ ] T007 Review the check after two weeks: keep as a warning, or propose making it required (maintainer decision)

## Delta 2026-10-22: fewer merge conflicts

- [x] T009 Spec delta FR-007..FR-016, plan, tasks (this folder)
- [x] T010 `scripts/changelog.js` (check, preview, build, migrate), `changelog.d/README.md`, this change's own fragment, npm scripts, `test:changelog` in `npm test` [FR-007..FR-010]
- [x] T011 `scripts/specs-index.js` (generate, check, import), group markers in `specs/README.md`, blocks backfilled into all 62 `spec.md` files, `test:specsindex` in `npm test` [FR-011..FR-013]
- [x] T012 Docs check accepts fragments, warns on hand edits of CHANGELOG *Unreleased* and `specs/README.md`; `test-docs-check.sh` cases [FR-015]
- [x] T013 Rules and docs: AGENTS.md, copilot-instructions, PR template, CONTRIBUTING, collaboration (release step), agent-notes, README, specs intro; README status block is release-only [FR-014, FR-016]
- [ ] T014 At merge time (after the 2026-10-22 stack): merge `main`, `npm run specs:index -- --import`, `npm run specs:index`, `npm run changelog:migrate`, `npm test` [FR-010, FR-013]
- [ ] T015 First release with `npm run changelog:build` (alpha.12 or later) writes the cut-over marker; check that the release notes read well

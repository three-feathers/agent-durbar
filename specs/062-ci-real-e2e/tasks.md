# Tasks 062

- [x] T001 `.github/platforms.json` + matrix from it in `e2e-real.yml` and `install-check.yml`; `scripts/test-platforms.ts` [FR-004]
- [x] T002 `scripts/e2e-real.ts` (install → detect → sign-in → models → one turn; redacted output; table + JSON) [FR-002, FR-003]
- [x] T003 `.github/workflows/e2e-real.yml` (no `pull_request`; secrets in one step) [FR-001, FR-002]
- [x] T004 First real runs on 3 OSes; record results and known gaps; README, CHANGELOG, `specs/README` [FR-005]

## 2026-10-22: cheaper runs (owner)

- [x] T005 Workflow: no `push` trigger, daily schedule, input `full_turn`; `--no-turn` on macOS and Windows except Mondays or `full_turn: true`; `test:platforms` checks it [FR-006, FR-007]
- [x] T006 `scripts/e2e-real.ts`: `--no-turn`; Codex on a small model (`E2E_CODEX_MODEL`, else a listed `mini`/`nano`, else default) and effort `low` (`E2E_CODEX_EFFORT`); `Model` column [FR-007, FR-008]
- [ ] T007 Check the first daily run's table: which Codex model ran and what it cost; update FR-008 with the `real:` result [FR-008]

## 2026-10-29: schedule paused (owner, #856)

- [x] T008 Workflow: `schedule:` commented out, `workflow_dispatch` kept, pointer comment; `test:platforms` checks it [FR-009]
- [ ] T009 Find the cause of the red runs (#856), get a manual run green on all 3 OSes, restore the schedule and the cron check in `test-platforms.ts`, drop the `[KNOWN GAP]` [FR-009]

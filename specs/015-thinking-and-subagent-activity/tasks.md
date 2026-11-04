# Tasks: 015
- [x] T001 Capture raw events (auto, 2 tiny prompts); sanitise into fixtures
- [x] T002 Pure mapper + tests (reasoning delta/complete, no-reasoning, sub-agent attribution)
- [x] T003 Timeline chat: thinking blocks, no-reasoning note, intent/progress
- [x] T004 Sub-agent nested block + helper transcript view
- [x] T005 Simulator scenarios; screenshots m7-*.png
- [x] T006 README + spec 002 amendments

## 2026-10-25 delta: compaction on the desk (issue #601)

- [x] T007 Spec delta, plan, tasks (FR-006..FR-015 and T007..T013 taken; checked against `main`, remote branches and open PRs on 2026-10-25)
- [x] T008 Types, event guard; Claude, Codex and Copilot mapping [FR-006..FR-009]
- [x] T009 Renderer: `compactingNow`, pill/desk line/card/list/strip/ring, `ctxWaiting` after a compaction without numbers [FR-010..FR-012]
- [x] T010 Simulator `simcompact=1` [FR-014]
- [x] T011 `scripts/test-compaction.ts` in `npm test`, mutation checks [FR-013, FR-015]
- [x] T012 Driver `scripts/shots-015-compact.js` in the UI suite and `shots:docs`; screenshots at both sizes; `check:office` [FR-014]
- [x] T013 README, changelog fragment, specs-index block, agent notes, `[KNOWN GAP]` kept honest [all]

## 2026-10-28 delta: forward sub-agent text (Claude)

- [x] T014 `--forward-subagent-text` / SDK `forwardSubagentText`, gated on Claude Code 2.1.211+ [FR-016]
- [x] T015 Tests (argv, version gate, adapter launch, SDK option, forwarded-message mapping) with mutation checks; changelog fragment; `[KNOWN GAP]` kept (no real session) [FR-017]
- [x] T016 Real compaction shapes (#731): real Claude and Codex orders in `scripts/test-compaction.ts`; Codex: the first usage after a compaction gives no context figure; Copilot manual compaction ends from the `history.compact` answer; stale `read:` text updated; `[KNOWN GAP]` kept (automatic, failed, truncation, cost) [FR-007, FR-008, FR-009b, FR-012]
- [x] T020 Issue #1142 (FR-020): `.sub-ro` sticky at the top of a helper's chat on an opaque surface. Test: `check-helper-bar` (ui-suite), mutant: remove `position: sticky`; pictures at both sizes.

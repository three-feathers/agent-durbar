# Tasks: Full-screen chat and agent strip

## Done (as built)

- [x] T001 Full-screen panel, Office button, Esc ordering [FR-001, FR-003]
- [x] T002 Agent strip (64px, sorted, accessible names, scroll kept) [FR-002]
- [x] T003 Header with status, model chip, folder, task, usage, grant chips, actions [FR-004]
- [x] T004 Thinking block with timer and auto-collapse; empty-reasoning note [FR-005]
- [x] T005 Tool chips with expand and "+N earlier" [FR-006]
- [x] T006 Composer: Enter/Shift+Enter, auto-grow, send disabled when empty [FR-008]
- [x] T007 Stop, End session, Copy resume command [FR-009, FR-010]
- [x] T008 Screenshots at both sizes (`m6-fullchat-*`) and headless overflow re-check 2026-10-16 [SC-001]

## Open

- [x] T020 Render assistant Markdown (sanitized, no HTML, links open externally) after a spec delta and clarification on scope. [FR-011]
- [x] T021 Verify on a real session what a second message during a turn does; then block, queue or label it. [FR-012]
- [x] T022 Real verification of Stop/End/resume (feature 013). [FR-013] (2026-10-19: done in spec 013 on a real Copilot session, issue #3)
- [ ] T023 Decide whether chat history should persist across restarts (clarify; privacy implications). [FR-014]
- [x] T024 Copy message / copy code buttons. [FR-015]
- [x] T025 Automated overflow test for the chat view (same harness as feature 001 T020). [SC-001] (2026-10-19: the chat checks in `check:office`, #221)
- [x] T026 Card menu Stop and End session for live main agents (interrupt / end, confirm End when busy, disabled Stop when the kind cannot interrupt), simulator and `check:office` at both sizes, docs (issue #251) [FR-017]

## 2026-10-21 delta: file edits stream into the chat (FR-018..FR-026)

- [x] T027 Shared edit helpers `src/shared/edits.ts` (types, `editFile`, `patchFiles`, `finishEdit` with redact and caps, `partialJson`) and adapter normalizer `src/adapters/edits.ts` (`editOf`, `ArgStream`); unit tests `test:edits` [FR-018, FR-024]
- [x] T028 Claude Code mapper: `content_block_start`/`input_json_delta` for file-changing tools, early start, partial updates, complete block as update; fixture tests [FR-019]
- [x] T029 Copilot mapper: `assistant.tool_call_delta` (JSON and raw patch), `tool.execution_start` of a started call as update; tests [FR-019]
- [x] T030 Codex mapper: `item/fileChange/patchUpdated`, diffs into `edit`, object or string `kind`; fixture tests [FR-019]
- [x] T031 Event guard checks the optional `edit` [FR-018]
- [x] T032 Renderer `editview.js` (verbs, plain words, display path, counts, visible lines) and `test:editview` [FR-020, FR-023, FR-025]
- [x] T033 Chat edit row, inline diff with Show all, Simple toggle, frame-throttled repaint, waiting line names the action [FR-020..FR-023]
- [x] T034 Simulator edit calls with streamed arguments [FR-026]
- [x] T035 Driver `check:edits` and screenshots at 1440x900 and 1280x800, Expert and Simple; README, CHANGELOG, specs index [FR-020..FR-026]
- [x] T036 Real check of the three argument streams (Claude Code `input_json_delta`, Copilot `assistant.tool_call_delta`, Codex `item/fileChange/patchUpdated`) on one small edit each, within the owner's budget (about 3 prompts) [FR-019] (2026-10-21, `scripts/edit-stream-real.ts`: Claude Code and Copilot stream and pass; Codex 0.163.0 sends the patch at once with `item/started` and passes on the no-stream path, `[KNOWN GAP]` its `patchUpdated` branch; 6 prompts in all, results in spec.md)
- [x] T037 A partial edit whose new text has not started shows the file only, no diff or counts (seen in T036); `test:edits` [FR-027]

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

## Delta 2026-10-21: readable JSON tool results and saved outputs (issue #361)

One PR per line where possible; each with `npm run typecheck && npm run build && npm test`. IDs start after PR #463's T037.

- [ ] T038 Decoder `src/renderer/tooljson.js` (UMD) and `scripts/test-tool-json.ts` (`npm run test:tooljson`, added to `test:serial`): whole JSON, nested strings 1-3 levels and a 4th left as text, scalars in strings kept, cut and invalid JSON fall back, limits (1,000,000 in, 50,000 values, output cut) give "Too large to format", 200-level nesting, linear time from 20k to 200k characters including one long string, timed over decode **and** `redact` together, masking after decoding (a planted token in escaped and double-escaped JSON), no `redact` gives text [FR-028, FR-029, FR-031, FR-032]
- [ ] T039 Main masking (after PR #466 merges): widen `maskMcpEvent` in `src/main/mcpmask.ts` (reusing `maskMcpText`) to every `toolCall` `output` in every phase and to `savedOutput.preview`, with JSON-escaped forms of the session values (1-3 levels); `outward` in `src/main/main.ts` passes `mcp.secretValuesFor` for every such event; the resume replies in `src/main/ipc/agents.ts` and `src/main/ipc/previous.ts` mask `HistoryItem.output` (Q6). Test in `scripts/test-mcp-errormask.ts` (or a new `test:toolmask` in `test:serial`): an env secret value and a session MCP header value never reach the window or the `DURBAR_LOG` copy, also inside nested and double-escaped JSON, in a complete non-MCP output, a saved preview and a history item; a `ghp_` token in the raw output; a value straddling the cut leaves no prefix; time on 1 MB of worst-case text recorded (Q5); the wiring check reads `outward` [FR-030, FR-036]
- [ ] T040 `src/adapters/savedoutput.ts` and `scripts/test-saved-output.ts` (`npm run test:savedoutput`, added to `test:serial`): both Copilot forms, the telemetry flag alone, Claude's two `<persisted-output>` forms, sizes "33.8 KB"/"49.4KB"/"1.2 MB"/missing, POSIX, macOS and Windows paths, a look-alike text without the runtime's file name, path never in the result's public part [FR-033]
- [ ] T041 `ToolCallEvent.savedOutput` in `src/adapters/types.ts`, the event guard, the Copilot mapper (`map.ts`) and Claude mapper (`claudeMap.ts`, before `cap()`); fixture tests in `test:events` and `test:claudeadapter` [FR-033]
- [ ] T042 Chip: formatted block, Show raw/Show formatted, Copy of the view shown (raw Copy is the text main sent, unchanged), decoded-count line, closed-chip "JSON · size" and saved line with the existing `fmtSize`, preview, Simple without raw; `styles.css` [FR-028, FR-031, FR-034]
- [ ] T043 Simulator: one nested-JSON MCP result (with a fake token) and one saved output, made-up data; `test:simevents` stays green [FR-036]
- [ ] T044 Driver `scripts/shots-005-tooljson.js` on `scripts/driver-helpers.js`, in `scripts/ui-suite.js`; the fake token is masked in the formatted view and in its Copy; screenshots at 1440x900 and 1280x800, Expert and Simple [FR-036]
- [ ] T045 Permission hint: `PermissionInfo.savedOutput`, set by the Copilot adapter from the mapper's remembered file names; the card, inbox row and refusal note line; unit test in `test:permissions` (exact base-name match for `read`, `/` and `\`; a `read` path whose base name only contains the remembered name does not match; a shell command that contains the name matches; no regex built from or run over the command), driver case in T044 [FR-035]
- [ ] T046 Docs: README feature line, the masking sentence and known limit (real wording unverified), CHANGELOG *Unreleased*, `specs/README.md` row 005, FR tags to `[IMPLEMENTED]` [FR-036]
- [ ] T047 Real check, **only with the owner's approval and a stated cost**: one Copilot and one Claude Code tool call with a large output, to confirm the event text or telemetry and the permission flow; record `real:` [FR-033, FR-035]

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

## 2026-10-21 delta: file edits stream into the chat (FR-018..FR-027)

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
- [x] T060 Review on PR #463 (was T049 until 2026-10-22: #498 uses T049..T059): linear `partialJson`/`patchFiles`/`bodyOf`/`cut()` with timing cases (old code fails each); failed or refused edit worded as not done, in `test:editview`, the simulator and `check:edits`; `edit` masked in main's `outward` with the session values (`maskEditInfo`); event guard negative cases; early `start` path through `cleanPath`; waiting line names the tool still running and says "Waiting for your OK" while a permission card waits (`check:edits`); UUID check in `scripts/edit-stream-real.ts`; spec text [FR-018, FR-020, FR-022, FR-024, FR-026]
- [x] T061 Review on PR #463 (rubenlupi's agent, 2026-10-22), Codex: `codexEdit` builds on spec 052's `codexFileChanges` (`src/adapters/codexModes.ts`, #470) and `diffFile` follows the kind, never the text (add = the new file's text, delete = the old text, update = a hunk); the guess `looksLikeDiff` is dropped; `test:edits` cases: a new file whose lines start with `- `, a new file whose lines are all indented, a delete whose lines start with `+` [FR-019]
- [x] T062 Review on PR #463: a Copilot `apply_patch` call whose arguments are JSON (`{"input": "*** Begin Patch…"}`) starts early once the `*** … File:` line inside the string is complete (`ArgStream.path()`); `test:edits` streams it in small pieces (also a half-written path line gives no start, and an escaped newline `\n` ends the line) [FR-019]
- [x] T063 Review on PR #463: `test-mcp-errormask` requires `e.edit` in main's `outward` condition (removing it fails) [FR-024]; `check:edits` scroll steps while the simulated Edit streams: pinned at the bottom the chat stays at the bottom, scrolled up its `scrollTop` does not move; pinned, Show all on the last diff keeps the bottom (removing `stickyScroll` from `edDiff` fails the Show all step, removing the `dataset.pin` check fails the scrolled-up step; a streamed update is also followed by `tTool`'s own `tScroll`) [FR-021]
- [ ] T064 Review on PR #463: merge main (#515: no light allow-list), `check:ui-text` on the merged tree including `chat-edits` [FR-024]

## Delta 2026-10-21: readable JSON tool results and saved outputs (issue #361)

One PR per line where possible; each with `npm run typecheck && npm run build && npm test`. IDs start after PR #463's T037.

- [ ] T038 Decoder `src/renderer/tooljson.js` (UMD) and `scripts/test-tool-json.ts` (`npm run test:tooljson`, added to `test:serial`): whole JSON, nested strings 1-3 levels and a 4th left as text, scalars in strings kept, cut and invalid JSON fall back, limits (1,000,000 in, 50,000 values, output cut) give "Too large to format", 200-level nesting, linear time from 20k to 200k characters including one long string, timed over decode **and** `redact` together, masking after decoding (a planted token in escaped and double-escaped JSON), no `redact` gives text [FR-028, FR-029, FR-031, FR-032]
- [ ] T039 Main masking (after PR #466 merges and after T048): widen `maskMcpEvent` in `src/main/mcpmask.ts` (reusing `maskMcpText`) from MCP cards after their start to every `toolCall` `output` in every phase, MCP or not, and to `savedOutput.preview`, cut to `MCP_CARD_MAX_CHARS` (50,000) for all (Q5 (b)); `maskMcpText` expands the session values with `secretForms`, order unchanged (values and `redact()` on the whole text, cut, URL and flag masks); `outward` in `src/main/main.ts` passes `mcp.secretValuesFor` for every such event; widen `maskMcpHistory` from failed items to every tool item (both resume replies already use it through `maskHistory`, Q6). Test in `scripts/test-mcp-errormask.ts`: an env secret value and a session MCP header value, each with `"` and `\`, never reach the window or the `DURBAR_LOG` copy, plain and escaped 1 to 4 times in nested JSON, in a complete non-MCP output, a saved preview and a history item that did not fail; a `ghp_` token in the raw output; an env value, a session value and a token straddling the 50,000 cut leave no head; time on 50,000 and on 1 MB of worst-case text recorded in the spec (Q5); the wiring check reads `outward`. Update 058 FR-067's `[IMPLEMENTED]` note in the same PR [FR-030, FR-036]
- [ ] T040 `src/adapters/savedoutput.ts` and `scripts/test-saved-output.ts` (`npm run test:savedoutput`, added to `test:serial`): both Copilot forms, the telemetry flag alone, Claude's two `<persisted-output>` forms, sizes "33.8 KB"/"49.4KB"/"1.2 MB"/missing, POSIX, macOS and Windows paths, a look-alike text without the runtime's file name, path never in the result's public part [FR-033]
- [ ] T041 `ToolCallEvent.savedOutput` in `src/adapters/types.ts`, the event guard, the Copilot mapper (`map.ts`) and Claude mapper (`claudeMap.ts`, before `cap()`); fixture tests in `test:events` and `test:claudeadapter` [FR-033]
- [ ] T042 Chip: formatted block, Show raw/Show formatted, Copy of the view shown (raw Copy is the text main sent, unchanged), decoded-count line, closed-chip "JSON · size" and saved line with the existing `fmtSize`, preview, Simple without raw; `styles.css` [FR-028, FR-031, FR-034]
- [ ] T043 Simulator: one nested-JSON MCP result (with a fake token) and one saved output, made-up data; `test:simevents` stays green [FR-036]
- [ ] T044 Driver `scripts/shots-005-tooljson.js` on `scripts/driver-helpers.js`, in `scripts/ui-suite.js`; the fake token is masked in the formatted view and in its Copy; screenshots at 1440x900 and 1280x800, Expert and Simple [FR-036]
- [ ] T045 Permission hint: `PermissionInfo.savedOutput`, set by the Copilot adapter from the mapper's remembered file names; the card, inbox row and refusal note line; unit test in `test:permissions` (exact base-name match for `read`, `/` and `\`; a `read` path whose base name only contains the remembered name does not match; a shell command that contains the name matches; no regex built from or run over the command), driver case in T044 [FR-035]
- [ ] T046 Docs: README feature line, the masking sentence and known limit (real wording unverified), CHANGELOG *Unreleased*, `specs/README.md` row 005, FR tags to `[IMPLEMENTED]` [FR-036]
- [ ] T047 Real check, **only with the owner's approval and a stated cost**: one Copilot and one Claude Code tool call with a large output, to confirm the event text or telemetry and the permission flow; record `real:` [FR-033, FR-035]
- [ ] T048 Escaped forms of secret values (before T039): export `secretForms(value)` from `src/shared/redact.ts` (the value, JSON-escaped 1 to 4 times, URL-encoded, no duplicates) and use it in `envSecrets` instead of its `j1`/`j2` lines; cases in `scripts/test-redact.ts`: an env secret with `"` and `\` escaped 3 and 4 times is removed, a value with neither has one form, the env snapshot is still built once [FR-030]

## Delta 2026-10-21: settings under the message box, one Send / Stop button (owner request)

IDs start after the readable-JSON delta's T048.

- [x] T049 Toolbar under the message box: move the profile, mode, model, context chips, MCP (from More) and the attach buttons from the header / box into `.ctoolbar`; header keeps identity, limit, remote, folder and its actions [FR-037, FR-039]
- [x] T050 Model chip shows the context window size; context chip opens a context menu with Compact (`#compactBtn`) and Models and context of all agents [FR-037]
- [x] T051 MCP chip with an MCP icon and the count of servers switched on; opens the existing MCP dialog [FR-037]
- [x] T052 One Send / Stop slot inside the box's right edge, spinner left of Stop, Send beside Stop when a live agent has text, reduced-motion static dot [FR-038]
- [x] T053 Menus open above a toolbar control; overflow "⋯" with the collapse order; mode never collapses [FR-037, FR-040]
- [x] T054 Simple shows mode, memory (from 70%), attachments and Send/Stop [FR-041]
- [x] T055 Driver `scripts/check-composer-toolbar.js` in `ui-suite` (positions, order, Send↔Stop with spinner in a simulated turn, window size, MCP count and dialog, context menu, overflow at a 480px panel, no overlap, 10.5px) and the toolbar in `check-office-overlap.js`'s chat check [FR-043]
- [x] T056 Update drivers that looked for these controls in the header (`shots-017`, `shots-018`, `shots-model`, `shots-052-ux`, `check-grant-chips`) [FR-043]
- [x] T057 Screenshots Expert and Simple, light and dark, 1440x900 and 1280x800 (`docs/screenshots/005-composer-*.png`); README chat screenshots and text, CHANGELOG, `specs/README.md` row [FR-043]
- [x] T058 Coordination: comment on #453 (composer placeholder) for Ruben; reviewers rubenlupi and fjcabello [FR-043]
- [x] T059 Review fixes on PR #498: Simple memory chip without Compact opens an info-only popup (matching `aria-haspopup` and title), demo Stop cancels the canned turn; driver cases in `check-composer-toolbar` [FR-037, FR-038]

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
- [x] T064 Review on PR #463: merge main (#515: no light allow-list), `check:ui-text` on the merged tree including `chat-edits` [FR-024]

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
- [x] T070 Review on #498 (Ruben): the context chip's tooltip has one full stop, never ".."; driver assertion for an unknown context and for the breakdown [FR-037]
- [x] T071 Review on #498: the model chip's accessible name built from parts ("…, 128k tokens context window; next: …"); `shots-model` step 8 asserts it [FR-037]
- [x] T072 Review on #498: driver step: switching an MCP server off drops the chip's count by one when the dialog closes (and back) [FR-037]
- [x] T073 Review on #498: driver step: two clicks on Stop call `bridge.stop` once (`aria-busy` guard); `__durbarSimUi.bridge` under `DURBAR_SIM` only [FR-038]
- [x] T074 Review on #498: the spinner is decorative; the turn's start and end are announced through `#srAnnounce`; driver asserts it [FR-038]
- [x] T075 Review on #498: the macOS demo Stop failure: Send, read and Stop in one page task (the canned turn is a transient); the stopped reply never arrives; CHANGELOG's doubled merge-queue line removed; after merging main (#515): spec 070's literal ratchet lowered (styles 156, screens 16, themes 52) and `theme.js` takes main's three button-text pairs (`test:theme-tokens`) [FR-043]

## Delta 2026-10-23: the message box grows, resizes and remembers its size (issue #592)

IDs start after T075.

- [x] T076 Tests first: `scripts/test-composer-size.ts` (`test:composersize`, in `test:serial`) for `limits`, `clamp`, `keyStep`, `parse` (cap 40% with the 110px floor, the 140px transcript floor, a stored size too tall clamped, junk stored values ignored) [FR-044, FR-046, FR-048]
- [x] T077 Tests first: resize steps in `scripts/check-composer-toolbar.js` at both sizes: a long prompt grows past 110px to the cap and then scrolls; dragging the handle changes the height and is clamped (transcript ≥ 140px, box ≥ 36px); a reload keeps the size; double-click resets to automatic; keys (Arrow, Page, Home/End, Enter) and the ARIA name and values [FR-044..FR-048]
- [x] T078 `src/renderer/composersize.js` (UMD), loaded in `index.html`, copied by `scripts/copy-assets.js` [FR-044, FR-046]
- [x] T079 `app.js`: `sizeComposer()` replaces `autoGrow`'s fixed 110px; `#composerGrip` markup and `wireComposerGrip()` (pointer capture, double-click, keys, `localStorage` `durbar.composerHeight`); `ResizeObserver` on the chat; `styles.css` `.cgrip` with tokens, no `max-height:110px` [FR-044..FR-049]
- [x] T080 Mutation checks: undo the cap, the transcript floor, the store and the reset by hand and see the unit test or the driver fail; record in the PR [FR-044..FR-048] (2026-10-23: the cap fixed at 110px, no transcript floor and Enter not resetting each fail `test:composersize`; the cap, the floor and the store fail the driver at both sizes; no double-click handler fails the driver's reset step)
- [x] T081 Screenshots at 1440x900 and 1280x800 (`DURBAR_SIM=15`): `005-composer-resized-*.png`; retake the linked pictures that show the composer with `npm run shots:docs -- --only shots-hero,shots-003-011,check-composer-toolbar,check-edits,shots-006-prevmarks,shots-009-vschat,shots-063-folder-status,check-slash-suggest`; README feature line; `changelog.d/005-composer-resize.md` [FR-049]
- [ ] T082 `[KNOWN GAP]` not tried with a real screen reader (NVDA, VoiceOver) or a touch screen; Windows and macOS through CI's drivers only [FR-045, FR-048]
- [x] T083 Review on PR 599 (Paco's agent): driver step for a stored size: `durbar.composerHeight='3900'` and a reload show the box clamped (height and `aria-valuenow` equal `aria-valuemax`, transcript ≥ 140px, the stored value kept); `'abc'` and `'99999'` give automatic growth. Mutations: showing the stored size without the clamp fails the 3900 step; `parse()` without its range fails the 99999 step, at both sizes [FR-046, FR-047]

## Delta 2026-10-23: compact composer toolbar (owner request, issue #627)

IDs start after T083.

- [x] T084 Tests first: `scripts/test-ctx-breakdown.ts` (`test:ctxbreakdown`, in `test:serial`): each adapter's real mapper (Copilot `EventMapper` `session.usage_info`, `ClaudeMapper` assistant + result, `CodexMapper` `thread/tokenUsage/updated`) fed fake raw events, then `toolstats`' kept shape, then `DurbarCtxBreakdown.summary`: Copilot gives System / Tool definitions / Chat bars (+ Other only for a positive rest), Claude Code and Codex give no bars and "Breakdown not reported by <app>.", no event gives "not known yet"; levels at 69/70/90/91%; unknown window shares of the used total; junk values (negative, NaN, strings) ignored [FR-052, FR-056]
- [x] T085 Tests first: `scripts/check-composer-toolbar.js`: model chip text is the name only (no window, effort or "long"); the ring has a name and the "Context N% of …" tooltip, no visible text, opens the summary (dialog, bars for the Copilot agent, Compact, Escape back); a Claude Code agent (`simkinds=mixed`) shows "Breakdown not reported by Claude Code."; MCP chip `n/m` with the accessible name; MCP in the row at both sizes and at a 760px panel, `⋯` hidden there; 480px panel keeps the mode; the six built-in themes and the dark user theme lay out without overlap; `shots-model` reads the chips' names instead of their text [FR-050..FR-055]
- [x] T086 `src/renderer/ctxbreakdown.js` (UMD `window.DurbarCtxBreakdown`), `index.html`, `scripts/copy-assets.js` [FR-052]
- [x] T087 `app.js`: `modelChipHTML` name only; `openModelMenu` Context window heading and the single-window line [FR-050]
- [x] T088 `app.js`: `ctxChipBtn` ring in Expert (SVG, level class, name, tooltip), `openCtxMenu` token summary in Expert; `styles.css` ring and bars with tokens [FR-051, FR-052, FR-055]
- [x] T089 `app.js`: `MCP_N` keeps on and total, `mcpChipHTML` `MCP n/m`; new overflow ranks [FR-053, FR-054]
- [x] T090 Simulator: the breakdown fields only for Copilot-kind agents (Claude Code and Codex report a total, like the real adapters) [FR-056]
- [x] T091 Mutation checks: break the Other row, the "not reported" note, the name-only chip, the MCP total and the overflow order by hand and see the unit test or the driver fail; record in the PR [FR-050..FR-054] (2026-10-23: no Other row, no "not reported" note and junk parts let through each fail `test:ctxbreakdown`; the chip with effort and window, a total equal to the on count and the old overflow ranks each fail the driver at both sizes)
- [x] T092 Screenshots at 1440x900 and 1280x800 (`DURBAR_SIM=15`): retake the linked composer pictures (`npm run shots:docs -- --only check-composer-toolbar,shots-hero,...`), plus `005-composer-ctxsummary-1440x900.png` (linked, in `DOC_SHOTS`); README line; `changelog.d/005-composer-compact.md` [FR-055]
- [ ] T093 `[KNOWN GAP]` no real session: Copilot's parts adding up and the real Claude Code / Codex totals are `read:` / earlier `real:` only; no real screen reader [FR-056]
- [x] T094 Review on PR 632 (Paco's agent): `ctxSummary` takes the window from the existing `modelWindow(a)` (reported, else the model list's for the tier in use) instead of a second, tier-less lookup; `test:ctxbreakdown` asserts the event's `limit` beats `o.limit` (swapping them fails it); the Expert summary (a dialog) holds plain buttons, no `role="menuitem"` (driver asserts it, and that the ring's window equals the model chip's); `005-composer-ctxsummary-1280x800.png` added and linked; merged `main` (#630's failed-server dot kept on the `MCP n/m` chip, its name "N of M MCP servers on, K failed. Open the list") [FR-051..FR-053]
- [x] T095 (done 2026-10-26) `DurbarUnread.isShown` (panel open on the agent, window visible, Chat tab, Notes drawer closed) used by `openPanel`, `visibilitychange`, the Chat tab and the Notes drawer; closing the chat or going to the office does not clear [FR-176]
- [x] T096 (done 2026-10-26) Card menu item **Mark as read** (`data-op="read"`) for an unread main agent, announced, focus back to the anchor [FR-177]
- [x] T097 (done 2026-10-26) Driver steps (in `scripts/check-unread.js`): open chat clears, closing does not, the Browser tab and the Notes drawer do not count as shown, Mark as read by keyboard [FR-176, FR-177]
- [x] T098 (done 2026-10-26, issue #789, requirement in spec 052 FR-180 / T192) Chat header: `.ph-id` takes the free room up to the buttons, cut only when the row is full; `scripts/check-chat-title.js` at 1440x900 and 1280x800

## 2026-10-29 delta: order the chat strip by hand, and favourites (issue #880, FR-178..FR-189)

- [ ] T099 `src/renderer/striporder.js` `orderStrip`: not manual = favourites then `prio`; manual = saved order; new ids to the end of the non-favourites; ended ids pruned only when `listed`; hidden-floor ids kept; a needs-you session never moves in manual mode. Test: `scripts/test-striporder.ts` rule table [FR-179, FR-180, FR-185]
- [ ] T100 `moveBy` / `moveTo` / `toggleFav` / `reset`: within-group moves, no-ops at the ends, the `says` sentences, idempotent star, unstar puts the item at the start of the non-favourites, reset keeps favourites. Test: `test:striporder` [FR-178, FR-181, FR-182, FR-183, FR-189]
- [ ] T101 Read (and write in the spec) what *End session* does to `agents` (removed or labelled `Ended`) and how long a real session's id is stable; make the prune rule match; a test on the chosen rule [FR-185, Q-strip-4]
- [ ] T102 `loadStrip` / `saveStrip`: version, caps (500 ids, 200 chars), duplicates, non-strings, `__proto__`/`constructor` ids, unparsable JSON, storage that throws; empty state removes the key. Test: `test:striporder` adversarial cases [FR-184]
- [ ] T103 Wire `stripAgents()` to `orderStrip` and the page state `STRIP` (load once, save on change, only when `rememberOn()`); source-check test that the manual branch has no `prio` sort [FR-179, FR-184]
- [ ] T104 `renderStrip` markup: `.sgrp` with `button.sitem` plus `button.sstar[aria-pressed]` (name "Favourite: <name>"), star mark on favourites, `data-key` stable; CSS with tokens, 10.5px floor, 48px strip. Test: driver step "markup and sizes at both sizes" [FR-180, FR-181, FR-187]
- [ ] T105 Keyboard: Alt+Left/Alt+Right on a focused `.sitem` (no Ctrl/Meta/Shift, AltGr ignored), refocus and reveal, announcement; shortcut sheet row and the strip's accessible description. Test: driver step (keys, focus, text of the live region) and a `test:striporder` source check that the sheet row exists [FR-182, FR-183]
- [ ] T106 Pointer drag: threshold, make room, drop, cancel with Esc/outside, edge auto-scroll, swallow the click after a drag, no repaint during a drag, group boundary stops. Test: driver steps with real pointer events (mouse; pen/touch via pointer type) [FR-186]
- [ ] T107 Star toggle by click and by the strip item's menu (**Add to / Remove from favourites**, Shift+F10 and the Menu key included); announcements. Test: driver step [FR-181, FR-183]
- [ ] T108 **Reset strip order** menu item (only when manual), announcement. Test: driver step + rule test [FR-189]
- [ ] T109 Needs you with a manual order: a session starts waiting and does not move; its colour/word stay; `N`, the inbox and the strip click open it and scroll it into view; no new cue (Q-strip-2: the owner chose none). Test: driver step [FR-179, FR-188]
- [ ] T110 Persistence: simulator-only `stripstore=1` option; reload keeps order and favourites; an ended agent's id is gone from the saved key. Test: driver step with `until()` after reload [FR-184, FR-185]
- [ ] T111 15 agents with 4 favourites at 1440x900 and 1280x800: favourites are the first four, no overlap, the office/chat/header boxes equal the baseline, reduced motion has no drag animation, the six themes alike (`check:geometry` stays as is). Test: driver + `check:office` unchanged [FR-187]
- [ ] T112 Docs and shots: README (feature + shortcut), changelog fragment, retake `m6-fullchat-sim15-*.png` with `npm run shots:docs`, tick tasks, spec status and `[IMPLEMENTED]` tags, `npm run specs:check` and `changelog:check` [FR-178..FR-189]

## 2026-11-01 delta: the agent rail, chat density and width (design sweep, FR-190..FR-208)

PRs, gates and line-count goals: `plan.md`. Each PR measures on `main` first and writes the numbers in its description. All wait for T209 (052) and #1011. **No rail task starts before T125:** the rail's form is pending the owner's look.

- [ ] T117 [PR C1] Measure first, today's 103 + 31 + 32 = 166 px. Goal: header, tabs and *Previous sessions* on one row, 61 px with the task line under it. Fallback only if the one row fails at 1280x800 by FR-199's test: header 61 px and one 31 px row. State the measurement in the PR (free width, what was cut, which form shipped); also record the free width at a chat 1060 px wide, for the rail's look. Test: new `check-chat-density` header steps at both sizes, longest name, mutant that cuts a control; `check-chat-title`, `check-composer-toolbar` still pass [FR-199]
- [ ] T118 [PR C1] Composer 122 to 91 px with Stop visible at both sizes; hint on the chips' row. Test: `check-chat-density`, `check-composer-toolbar` [FR-200]
- [ ] T119 [PR C2] Measure first, targets 575 to 442, 649 to 509, 1358 to 1167 px. Then plain answers; the person's bubble stays; agent meta clipped, not removed. Test: heights within 16 px, accessible text unchanged, Compact and Simple [FR-201, FR-203, FR-205]
- [ ] T120 [PR C2] Quiet tool rows and thinking with a left rule; failed, waiting and open states keep a box. Test: `check-chat-density`, `check-edits`, tool chip keyboard; mutant: a failed call with no box [FR-202]
- [ ] T121 [PR C2] Copy and message menu on hover and focus, always in the tab order, visible for `hover:none` and an open menu; FR-173 and 052 FR-010 rewritten. Test: real pointer and Tab; `check-notes`; mutant: `display:none` [FR-204]
- [ ] T122 [PR W] Measure first, targets 126 letters a line at 1440, 1920 and 2560 (146, 149 and 149 today). Then `--chat-prose`; 880 px and following 1240 px rules go. Test: new `check-chat-width`; `check-ui-text`; mutant: cap removed [FR-206]
- [ ] T123 After T125, Paco's answer on manual order: record it in FR-198; if yes, rewrite FR-178..FR-188 and T099..T112 for the rail; if no, the owner decides [FR-198]
- [ ] T124 [PR W] Last chat PR: `check-chat-density` asserts the log without a rail, 669 and 569 px (638 and 538 on FR-199's fallback) within 8 px with the restore bar still there (calculated; measure first), Flat and Real; pictures retaken at both sizes (`npm run shots:docs`), docs (`features.md`, README), older FRs changed in place [FR-195, FR-208]

### The rail: nothing here starts before T125

- [ ] T125 The owner looks at the mocks and picks the rail's form, list or floor plan. Record it in the spec; if not the list, rewrite FR-190..FR-197, 052 FR-215 and the rail tasks below before any build [FR-190..FR-197]
- [ ] T113 [PR R1] Measure first: `scripts/check-rail.js` on `main` records log, share, characters, strip and chrome rows at both sizes and fails on the rail's assertions. Targets for this PR: FR-195's rail columns (717 and 617 px) [FR-195, FR-207]
- [ ] T114 [PR R1] `renderStrip` becomes the rail, `.strip` goes: `stripAgents()` extended to groups and order; keyed rows kept; `body.panel-open` lays out rail plus panel; Office in the top row. Test: `check-rail` order and fit, `.sitem`-reading drivers follow [FR-190, FR-191]
- [ ] T115 [PR R1] Two heights and age in words; try tall rows at 52 px (else 60 px and 34 px of scroll, FR-196); measure text contrast on tall rows and set the tint to 4.5:1. Test: `check-rail` heights by clock, contrast; mutants: a third height, a wait-driven height [FR-192, FR-193, FR-196, FR-197]
- [ ] T116 [PR R2] Collapse under about 1100 px, hide and bring back, palette command, per-window memory, moving the Office, amber and lock controls when hidden. Test: `check-rail` at 1024x768, keyboard route, names kept; mutant: hiding drops the amber count [FR-194]

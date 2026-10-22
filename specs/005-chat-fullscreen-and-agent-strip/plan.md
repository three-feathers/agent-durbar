# Implementation Plan (as built): Full-screen chat and agent strip

**Spec**: [spec.md](spec.md) | **Date**: 2026-10-16 | **Kind**: reverse-engineered

## Summary

`openPanel(id)` renders a `.panel-in` into `<aside id="panel">`; CSS makes `body.panel-open` hide `.topbar`, `#stage-host` and `#list` so the panel is full screen. The strip (`renderStrip`) is part of the panel. Live events are applied by `onLiveEvent` to a per-agent turn object.

## Technical Context

- **Language**: JS in `src/renderer/app.js` (`openPanel`, `closePanel`, `renderStrip`, `onLiveEvent`, `ensureTurn`/`closeTurn`, `makeChip`/`refreshChips`, `sendLive`, `stopLive`, `endLive`, `copyResume`), CSS `.strip`, `.panel-in`, `.chip`, `.think`.
- **Testing**: none automated. Manual/e2e driver and screenshots (`m6-fullchat-sim15-*.png`); headless overflow check re-run 2026-10-16.
- **Constraints**: fonts >= 10.5px; strip must not push content off-screen at 1280x800.

## Constitution Check

| Principle | Result |
| --- | --- |
| II Adapter plug-in | Chat reads normalized events only. OK |
| V Calm UI | Strip highlights only waiting/error; motion is a small typing indicator. Overflow re-verified. **Partial** (not automated) |
| VII Gates | Screenshots exist; no automated test. **Partial** |
| VIII Honest limits | FR-011..FR-013 are partly in the README (thinking, Stop). **Partial** |

## As-built architecture

```text
#panel  (aside, only visible with body.panel-open)
└── .panel-in
    ├── .strip: [Office button] [#stripList: .sitem per root agent]
    ├── #panelHead: avatar, name, role, status pill, model chip, folder, actions, task, usage, #grants
    ├── #prev: previous sessions (feature 006)
    ├── #chat (role=log): .chat-inner per agent -> .msg.user | .msg.agent (.think, .chips, .bubble) | .note (permissions, stop, errors)
    └── .composer: #attNote, #attached, textarea#msgInput, buttons (feature 004), .drop-ov
```

State per live agent (`LIVE.agents[]`): `state`, `label`, `task`, `intent`, `turn`, `worked`, `usage`, `pend` (pending permission notes), `settled`, `grants`, `sent`, `resumed`.
Turn lifecycle: `status working` (or a local send) -> `ensureTurn`; `thinking` appends; `output` streams into a bubble; `session.idle` -> `closeTurn` + state `done` (or `idle/Ready` if nothing happened); `Aborted` -> note + `Ready`; `stopped` -> `Ended`.
The strip is morphed (`morphHTML`) with keyed items so scroll position and focus are stable; `renderAll()` refreshes header and strip on every state change.

## Project Structure (documentation)

```text
specs/005-chat-fullscreen-and-agent-strip/
├── spec.md
├── plan.md
└── tasks.md
```

## Verification status

| Claim | How | Result |
| --- | --- | --- |
| Chat opens, strip has all agents, no page/chat overflow at both sizes | headless Electron driver, SIM=12 and 15 | pass 2026-10-16 |
| Look and layout | screenshots `m6-fullchat-sim15-1440x900/1280x800.png` | `sim:` recorded |
| Stop/End/resume behavior | broker unit test; simulator | **not verified on a real running session** |
| Thinking from a real reasoning model | none | **not verified** (README) |
| Keyboard behavior (Esc order, Enter/Shift+Enter, focus) | read against code | `read:` only |

## 2026-10-21 delta: file edits stream into the chat (FR-018..FR-027)

**Existing code reused** (AGENTS.md *Look for an existing capability first*): `simpleDiff` and `clipDiff` (`src/shared/diff.ts`, spec 052 FR-063) build and cut the diffs; `redact` (`src/shared/redact.ts`) masks them; the permission card's `ACT.diffLines` (`activity.js`) splits diff text into typed lines and its `.pdiff` colours style them; `plainChip`, `toolKind`, `makeChip`, `refreshChips` and the 1-second waiting-line timer in `app.js` carry the row and the timer. PR #458 (desk live activity) reads the same `toolCall` start through `toolLabel`; the edit row gives `toolLabel` the edit's path, so the desk readout says "Editing app.js" with no change of its own.

**Layers:**

1. `src/shared/edits.ts` (pure, no provider types): the `EditInfo`/`EditFile` types, `editFile()` (old/new or whole text to a diff with counts), `patchFiles()` (the `*** Begin Patch` text format and plain unified diffs, split per file), `finishEdit()` (redact paths and diffs, clip each diff, at most 20 files) and `partialJson()` (a tolerant parse of a JSON prefix: closes an open string, drops a dangling key, closes brackets; linear time).
2. `src/adapters/edits.ts` (adapter side, knows tool names and argument shapes of the three apps): `editOf(tool, args)` and an `ArgStream` per call (append, cap at 1 MB, re-parse after growth of an eighth, report the path as soon as it is known).
3. Mappers: `claudeMap.ts` maps `content_block_start` (`tool_use`) and `input_json_delta` for file-changing tools (index -> call id per stream); the complete `assistant` block of an already started call becomes an `update` with the full `args` and `edit`. `map.ts` (Copilot) maps `assistant.tool_call_delta` the same way and turns `tool.execution_start` of a started call into an `update`. `codexMap.ts` maps `item/fileChange/patchUpdated` and puts the changes' diffs into `edit` on `item/started`/`item/completed`.
4. `eventguard.ts`: checks the optional `edit` shape.
5. Renderer: `src/renderer/editview.js` (UMD like `cuttext.js`, unit-tested in Node): verbs and plain words, display path relative to the folder (FR-025), line counts, the lines to show (12/400). `app.js`: `tTool` makes an edit row and a sibling `.ediff` block (hidden with its chip by `refreshChips`), repaints it once per frame on `update`, and sets the waiting line's current action (`T.typing.dataset.act`, `dataset.a0`). `styles.css`: `.chip.editchip`, `.ediff` (theme tokens, 10.5px minimum kept, 11px monospace like `.pdiff`).
6. Simulator (`sim.ts`): streamed edit, new file, two-file patch (FR-026).
7. Review on PR #463 (T049): main's `outward` (`src/main/main.ts`) also asks `mcp.secretValuesFor` for a `toolCall` with an `edit`, and `maskMcpEvent` (`src/main/mcpmask.ts`, spec 058 FR-067's hook, reused) masks it with `maskEditInfo` (values, then `redact()`; no URL pass, no cut). Linear code on streamed text: `partialJson` trims once and builds the closing suffix apart; `patchFiles` uses a greedy `(.+)` and `trimEnd()`; `bodyOf` and `cut()` drop trailing newlines/blanks with a loop. `editview.summary` takes `failed`; `app.js` passes it, names the newest open tool when the named one ends (`tActNext`, the chip's `seen` time) and says "Waiting for your OK" while a `.note.perm.pending` card is in the turn.

**Tests:** `scripts/test-edits.ts` (shared helpers and adapter normalizers: Claude stream and complete, Copilot JSON and raw patch deltas, Codex patchUpdated, masking in the adapter and in main, caps, partial JSON fuzz, timing cases for hostile text, event guard good and bad edits), fixtures for `test-claude-map.ts` and `test-codex-map.ts` (`test:runtime`), `scripts/test-editview.ts`, and the driver `scripts/check-edits.js` (sim, both sizes, Expert and Simple) with screenshots `docs/screenshots/005-edit-*.png`.

**Constitution:** II (shapes stay in adapters; the event carries a neutral payload), III (redacted in the adapter, text only in the DOM), IV (simulator and fixtures, 0 credits), V (12 lines, throttled, reduced motion, 10.5px), VI (FR-025 path rules tested with Windows and POSIX paths), VIII (real streams not recorded: `[KNOWN GAP]`).

## Delta 2026-10-21: readable JSON tool results and saved outputs (issue #361, FR-028..FR-036)

**Shape.** Main masks every tool card's text in its existing `outward` hook (and the two resume replies) with the masker of PR #466; the page has one pure decoder that formats already-masked text, one normalized optional field on `ToolCallEvent` (and one on `PermissionInfo`), and a chip change. No new IPC channel, no new process, no file access: Durbar never touches the agent app's saved file.

| Piece | Where | Notes |
| --- | --- | --- |
| Main masking | `src/shared/redact.ts` (`envSecrets`, new `secretForms`), `src/main/mcpmask.ts` (`maskMcpText`, `maskMcpEvent`, `maskMcpHistory`, `MCP_CARD_MAX_CHARS`, from #466), `src/main/main.ts:142` (`outward`; #466's `maskHistory` dependency) | First (T048) `secretForms(v)` in `redact.ts`: the value, its JSON-escaped forms 1 to 4 times (each `JSON.stringify(x).slice(1, -1)` of the one before) and `encodeURIComponent(v)`, deduplicated; `envSecrets` (`:29-43`) uses it instead of its own `j1`/`j2` lines, so the env snapshot gains the 3rd and 4th forms once per env. Then (T039) widen `maskMcpEvent` from MCP cards after their start to every `toolCall` with an `output` or a `savedOutput.preview`, any phase, MCP or not; `outward` passes `mcp.secretValuesFor(e.sessionId)` for every such event (only when there is text to mask, so the store is not read for events without output). `maskMcpText` expands the session values with `secretForms` (longest first, like `envSecrets`), and keeps #466's order: session values and `redact()` on the whole text, then `cut(s, MCP_CARD_MAX_CHARS)` (50,000, for every tool card, Q5), then only `maskSecretUrl` and `maskFlagValues`. Widen `maskMcpHistory` from failed items to every `type: 'tool'` item with an `output`; both resume replies already call it through `maskHistory`, so no reply site changes. The `DURBAR_LOG` sink already goes through `outward` (`src/main/main.ts:225`). |
| Decoder | `src/renderer/tooljson.js` (new, UMD like `cuttext.js`: `window.DurbarToolJson` in the page, `module.exports` in Node) | `format(text, {redact, maxIn, maxNodes, maxNest, maxOut})` returns `{kind:'json', text, decoded}` or `{kind:'text', reason?}`. Walks the parsed value with an explicit stack (no recursion, so 200 levels of `[` cannot overflow), parses a nested string only when its trimmed text starts with `{`/`[` and ends with `}`/`]`, counts visited values and parse work against the limits before doing the work, then `JSON.stringify(v, null, 2)` and `redact` on the result (FR-031). `redact` is injected (like `liveact.js` takes `mask`), so the module has no import and the page passes `window.DurbarRedact.redact`; missing `redact` returns `{kind:'text'}` (fail closed). It does not mask anything else: the input was masked by main. |
| Size words | `fmtSize` in `src/renderer/app.js:1178` (existing) | Reused as it is for the saved line and the closed-chip text ("34 KB", "1.2 MB"); no second formatter. The chip lives in `app.js`, so no move is needed. FR-034's examples follow `fmtSize`'s output. |
| Event field | `src/adapters/types.ts` `ToolCallEvent.savedOutput?`, `PermissionInfo.savedOutput?` | Shape in FR-033; no path. Guarded in `src/adapters/eventguard.ts`. |
| Detection | `src/adapters/savedoutput.ts` (new, pure) | `copilotSaved(text, telemetry?)` and `claudeSaved(text)` return `{bytes?, place, preview?, fileName?}`; `parseSize("33.8 KB")`; base-name split on `/` and `\`; Copilot's file-name pattern copied from the runtime (`copilot-tool-output`, `original-output-<n>-`). `fileName` stays in the mapper's per-session memory for FR-035 and is stripped before the event is emitted. Linear, anchored patterns only. |
| Copilot mapper | `src/adapters/map.ts` (`tool.execution_complete`) | Reads `result.content` and `toolTelemetry`; adds `savedOutput`. The permission path (`src/adapters/copilot.ts` / `permissions.ts`) asks the mapper whether a read path's base name equals a flagged one, or a shell command `includes` one (no regex). |
| Claude mapper | `src/adapters/claudeMap.ts` (`tool_result`) | Detects `<persisted-output>` on the full text **before** `cap()`. |
| Chip | `src/renderer/app.js` `makeChip` / `tTool`, `styles.css` | Formatted block with Show raw / Show formatted and Copy (the view shown), "N nested values decoded" line, saved line and preview, closed-chip text; Simple hides the raw toggle for a saved output. Text only (`textContent`/`esc`), never `innerHTML` of decoded content. |
| Permission hint | `app.js` permission card, Needs you row, refusal note | One muted line when `permission.savedOutput` is true. |
| Simulator | `src/renderer/sim.ts` | One MCP call with made-up nested JSON (`{"rawResponse":"{\"value\":[{\"searchTerms\":\"...\"}]}"}`, plus a fake `Bearer` token inside the nested string to show the page's FR-031 masking) and one call with `savedOutput: {bytes: 34611, place: 'temp', preview: '{"value":[{"id":1,'}` (a preview cut mid-JSON, so it falls back to text). No real data. The simulator runs in the page, so main's FR-030 masking is not exercised here. |
| Driver | `scripts/shots-005-tooljson.js` (new) on `scripts/driver-helpers.js`, listed in `scripts/ui-suite.js` | Opens both chips, asserts the formatted block, the masked token, the saved line text and that no `copilot-tool-output` text or path is in the Simple DOM; screenshots at 1440x900 and 1280x800, Expert and Simple. Values put into page code go through `jsLiteral`. |

**Constitution check.** I (adapters are plug-ins): app-specific text is matched only in `src/adapters`; main's masker and the renderer read normalized fields. III (safe, no secrets): every tool card's text is masked in main, where env and session values are known, before any IPC send or log line; no file is read; the path never reaches the page outside the masked raw view in Expert; text only. IV (no credits): simulator and unit tests; the real wording stays `read:`. V (calm UI): one muted line, existing block sizes, 10.5px minimum. VI (parity): `/` and `\` paths; Windows `AppData\Local\Temp`, macOS `/var/folders/…/T/` and Linux `/tmp` fixtures. VIII (honest limits): FR-033's real event shape is `[KNOWN GAP]` until a real session; FR-030 is `test:` only (the simulator bypasses main).

**Risks.**
- PR #463 (`005-chat-edit-stream`) also changes `makeChip`/`tTool`, `ToolCallEvent` and the event guard, and uses FR-018..FR-027 and T027..T037 (and T049, its review fixes) in this spec; this delta starts after them. Its FR-024 masks diffs in the adapter layer, and (review on #463) `maskMcpEvent` also masks a `toolCall`'s `edit` with the session values in every phase (`maskEditInfo`, linear steps only); T039's widening keeps that branch. Masking is idempotent: `[redacted]` is not re-matched.
- PR #466 (`058` FR-067, open, head `e0bb4ee`) adds `maskMcpText`, `maskMcpHistory`, the `maskHistory` dependency and the `outward` change for MCP cards after their start; this delta widens them to non-MCP cards and to history items that did not fail. T039 waits for it to merge, and updates 058 FR-067's `[IMPLEMENTED]` note in the same PR (every tool card and every history item, not only MCP ones and failed ones).
- Cost in main: `outward` now masks every tool output. Measured 2026-10-21 (4-core Linux, `node`, `redact.ts` from `main`): `redact()` 5-7 ms per MB; `maskSecretUrl` 640 ms per MB of `?a=&` (390 ms on Vikram's machine), 46 ms on 50,000 characters, 11 ms on 20,000; 73 ms per MB and 3.6 ms per 50,000 on ordinary JSON. Hence the 50,000 cut (Q5 (b)). T039 times 50,000 worst-case characters through the whole `maskMcpText`; if streaming `update` events lag, cut `update` outputs at 20,000 first, then consider Q5 (d). `secretValuesFor` reads the MCP store per call; call it only for events with text to mask, and cache per session (with its `secretForms`) if T039's timing asks for it.
- Not in this delta (`read:` only, unverified): the tool's arguments, which the chip shows as a command (`toolFull`, `src/renderer/app.js:2527`), are not changed by FR-030; whether they are masked elsewhere was not checked.
- A runtime update can change Copilot's wording: the detection then simply stops (no line shown), it never misreports.

## Delta 2026-10-21: settings under the message box, one Send / Stop button (FR-037..FR-043)

**Shape.** Renderer only (`src/renderer/app.js`, `src/renderer/styles.css`): `openPanel` renders the existing chips into a new `.ctoolbar` under `.inbox` instead of `.ph-meta`; `#stopBtn` moves from the header actions into `.inbox` beside `#sendBtn`; `#mcpBtn` moves from More into the toolbar. No IPC, main, adapter or shared change.

| Piece | Where | Notes |
| --- | --- | --- |
| Toolbar markup | `openPanel` | Same `agentChipHTML`, `modeChipHTML`, `modelChipHTML`, `ctxChipHTML` (now without Compact), `#mcpBtn`, `#attFile`, `#attImg`; each wrapped item has `data-ct` (its overflow rank). |
| Send / Stop | `setSend` → also `syncRunState()`, called from `updatePanelHeader` (every render) | Shows `#stopBtn`/`#runSpin` while `running(a)` (live `busyNow`, demo chat busy); `#sendBtn` hidden while running unless live and text typed. Toggles attributes only when they change. |
| Model window | `modelChipHTML` | Window: `STATS.agent(id).ctx.limit` if reported, else `DM.windowOf(model, tier)`; `DM.fmtTokens`. |
| Context menu | new `openCtxMenu` beside `openModeMenu` | Same `.mode-menu` element, keyboard and close rules; Compact item calls `compactDialog`. |
| MCP count | `refreshMcpCount(a)` | `bridge.agentMcp(id)` (cheap: reads stores, no spawn); on open, on `mcp` event, after the dialog. |
| Menus above | `placeMenu(m,x,y,anchor)` used by the mode, model, profile and context menus | Inside `.ctoolbar`/overflow: placed above the anchor. |
| Overflow | `fitToolbar()`; `ResizeObserver` on the toolbar, `MutationObserver` (records taken while fitting) | Moves `data-ct` items into `#ctMorePop` by rank until the row fits; back when it fits again. |
| Styles | `styles.css` | Tokens only; 28px controls; spinner `@keyframes` (the global reduced-motion rule stops it; a static dot instead). |
| Drivers | new `scripts/check-composer-toolbar.js` (in `ui-suite`), `check-office-overlap.js` chat check, `shots-017`, `shots-018`, `shots-model`, `shots-052-ux` | |

**Constitution check.** I: no adapter types in the renderer (capabilities through `feat`). II/III: no new permission path; the mode is never hidden in the overflow; Allow all stays red. IV: simulator only. V: 10.5px floor, 28px controls, no overlap at both sizes; the office is untouched. VI: CSS and DOM only. VIII: decisions and gaps written in the spec.

**Risks.** PR #479 (Ruben, `check:ui-text`) changes `styles.css` and dialogs: rebase and run its check once it is on `main`. PR #463 touches `app.js` chat code (different functions). Issue #452 (dockable panel) will reuse FR-040.

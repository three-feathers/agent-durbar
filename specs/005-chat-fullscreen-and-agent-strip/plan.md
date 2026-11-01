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
7. Review on PR #463 (T060): main's `outward` (`src/main/main.ts`) also asks `mcp.secretValuesFor` for a `toolCall` with an `edit`, and `maskMcpEvent` (`src/main/mcpmask.ts`, spec 058 FR-067's hook, reused) masks it with `maskEditInfo` (values, then `redact()`; no URL pass, no cut). Linear code on streamed text: `partialJson` trims once and builds the closing suffix apart; `patchFiles` uses a greedy `(.+)` and `trimEnd()`; `bodyOf` and `cut()` drop trailing newlines/blanks with a loop. `editview.summary` takes `failed`; `app.js` passes it, names the newest open tool when the named one ends (`tActNext`, the chip's `seen` time) and says "Waiting for your OK" while a `.note.perm.pending` card is in the turn.

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
- PR #463 (`005-chat-edit-stream`) also changes `makeChip`/`tTool`, `ToolCallEvent` and the event guard, and uses FR-018..FR-027 and T027..T037 (and T060, its review fixes; T049 until 2026-10-22) in this spec; this delta starts after them. Its FR-024 masks diffs in the adapter layer, and (review on #463) `maskMcpEvent` also masks a `toolCall`'s `edit` with the session values in every phase (`maskEditInfo`, linear steps only); T039's widening keeps that branch. Masking is idempotent: `[redacted]` is not re-matched.
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

## Delta 2026-10-23: the message box grows, resizes and remembers its size (issue #592, FR-044..FR-049)

**Shape.** Renderer only. The arithmetic is a new pure UMD helper `src/renderer/composersize.js` (`window.DurbarComposerSize`, Node `module.exports`), unit-tested by `scripts/test-composer-size.ts` (`npm run test:composersize`, in `test:serial`): `limits({panelH, chatH, boxH})` → `{min, max, auto}`, `clamp`, `keyStep(key, h, limits)`, `parse(stored)`. `app.js` keeps one `sizeComposer()` (replaces the body of `autoGrow`) that measures the panel, the chat and the box, applies the chosen size or the automatic one, and updates the handle's ARIA values; `wireComposerGrip()` in `openPanel` wires pointer, double-click and keys. `styles.css`: `.inbox textarea` loses `max-height:110px` (the cap is set inline), `.cgrip` handle (tokens only).

| Piece | Where | Notes |
| --- | --- | --- |
| Limits | `composersize.js` | min 36; max = box + chat − 140 (transcript floor); auto = clamp(max(110, 0.4 × panel)) ≤ max. |
| Apply | `sizeComposer()` in `app.js` | Chosen size: height = clamp(chosen). Automatic: height = min(scrollHeight, auto). `overflow-y` auto only when the text is taller. Called on input, open, send, and from a `ResizeObserver` on `#chat` (idempotent: the box + chat sum does not change). |
| Handle | `#composerGrip` at the top of `.composer` | `role=separator`, `tabindex=0`; `pointerdown` (preventDefault: the box keeps focus) + `setPointerCapture`; `dblclick` and Enter reset; arrows/Page/Home/End through `keyStep`. |
| Store | `localStorage['durbar.composerHeight']` | `try`/`catch` like `durbar.detail`; removed on reset. |
| Driver | `scripts/check-composer-toolbar.js` | Long prompt grows to the cap then scrolls; drag changes and clamps; reload remembers; double-click resets; keys; both sizes. |

**Constitution check.** I: no adapter code. III: no new data stored beyond a pixel number. IV: simulator and unit test only. V: no text added, toolbar unchanged, the transcript keeps 140px. VI: pointer events and CSS only. VIII: no real screen reader or touch screen tried (`[KNOWN GAP]` in the tasks).

## Delta 2026-10-23: compact composer toolbar (issue #627, FR-050..FR-056)

**Shape.** Renderer only, plus the simulator's context event. No IPC, main, adapter or shared change: the breakdown is read from the `ContextEvent` fields the adapters already send (`system`, `conversation`, `toolDefinitions`).

| Piece | Where | Notes |
| --- | --- | --- |
| Breakdown helper | `src/renderer/ctxbreakdown.js` (new, UMD like `composersize.js`) | `summary(ctx, {limit, app})` → `{known, tokens, limit, pct, level, bars:[{key,label,tokens,share}], note}`; `level` uses the same steps as `toolstats.js` `ctxLevel`; parts only when finite and ≥ 0; *Other* = used − parts when > 0; never estimates. |
| Model chip | `modelChipHTML`, `modelLabel` (adds `name`) | Visible text `name` (+ `→ next`); tooltip and name keep effort, tier, window. |
| Model menu | `openModelMenu` | A *Context window* heading; the Long context item as today, else one info line with the single window. |
| Context ring | `ctxChipBtn` (Expert) | Inline SVG `circle` with `pathLength="100"` and `stroke-dasharray`; class `ok`/`warn`/`high`/`unk`; same id `#ctxChip`. Simple unchanged. |
| Token summary | `openCtxMenu` (Expert) | Same `#ctxMenu`, `role="dialog"`, rows from `summary()`, Compact and Tools items unchanged. |
| MCP | `MCP_N`, `mcpChipHTML`, `refreshMcpCount` | `{on,total}`. |
| Overflow | `composerToolbarHTML` ranks | Profile 1, Attach image 2, Attach file 3, Model 4, MCP 5, Context 6; mode 0. |
| Simulator | `src/renderer/sim.ts` | Breakdown fields only for Copilot-kind agents. |
| Tests | `scripts/test-ctx-breakdown.ts`, `check-composer-toolbar.js`, `shots-model.js` | |

**Constitution check.** I: the renderer reads normalized fields only; the agent app's name comes from the kinds list (`kindWord`). III: nothing new stored or sent. IV: fakes and the simulator. V: smaller row, 28px controls, 10.5px floor. VI: SVG and CSS. VIII: the per-adapter table and the gaps in the spec.

**Risks.** Open PRs touching `app.js` (#626, #622, #620, #614, #597, #560) are in other functions; merge `main` before the merge.

## 2026-10-29 delta: order the chat strip by hand, and favourites (issue #880, FR-178..FR-189)

**Existing capability reused (no parallel system):** the strip renderer `renderStrip` and its keyed `morphHTML` (`app.js:5705`; a reorder is a re-render with the new list), `stripAgents` (`app.js:5702`, the filter and the `prio` sort stay as the "not ordered" branch), `prio` (`app.js:607`), the per-window `localStorage` pattern with `rememberOn()` and id pruning (`syncChatNos`, `CHATNO_KEY`, `NAV.loadNumbers`/`pruneNumbers`, `app.js:33`), the item click (`app.js:3112`), `announce` (`app.js:3373`), `SCROLL.reveal` (`app.js:2432`), the card menu and its `data-op` items (`openModeMenu`, `Mark as read`), the shortcut sheet rows (`openKbdHelp`, `app.js:3636`), the global keydown (`app.js:3136..3211`). **New, because nothing exists:** a pure module `src/renderer/striporder.js` (like `unread.js` and `navigator.js`: no DOM, tested alone) and a small pointer-drag helper inside it or in `app.js`. No `src/main`, preload, IPC or adapter change (constitution I and III: the renderer holds ids only, nothing sensitive).

**Data model.** `state = {manual:boolean, order:string[], favs:string[]}` in the page (`STRIP`), loaded once (`loadStrip(raw)` validates: arrays of unique strings, lengths capped, else empty state) and saved (`saveStrip(state)` returns JSON or null when empty) on every change when `rememberOn()`. `orderStrip(agents, state, {listed, prio})` returns `{list, state}` (state with pruned and appended ids); `moveBy(state, id, delta, visibleIds)`, `moveTo(state, id, index)`, `toggleFav(state, id)`, `reset(state)` are pure and return the new state plus a `says` sentence for `announce`.

**Wiring.** `stripAgents()` calls `orderStrip`; `renderStrip()` renders each group as `<span class="sgrp">` containing the existing `button.sitem` and, next to it, the star `button.sstar[aria-pressed]` (a button is never nested in a button); `data-key` stays `sw:<id>` so `morphHTML` keeps nodes and focus; after a keyboard move the code refocuses `[data-sw=<id>]` and reveals it. A keydown branch (before the generic ones, `e.target.closest('#stripList .sitem')`, no Ctrl/Meta/Shift, `e.altKey`) handles Alt+Left/Right. Pointer handlers on `#stripList` (delegated) implement FR-186. Menu items **Add to / Remove from favourites** and **Reset strip order** are added to the strip item's context menu (right-click, Shift+F10, Menu key). CSS in `styles.css` next to `.sitem`: `.sgrp`, `.sstar`, `.sitem.dragging`, a favourite mark; theme tokens only; `themes.css` untouched (a theme never changes sizes). Docs: README feature list and shortcut line, `docs/` shortcut mention if any, screenshots `docs/screenshots/m6-fullchat-sim15-*.png` (retaken with `npm run shots:docs`), `changelog.d/096`-style fragment named after the branch, the spec's index block unchanged (status text only if the status changes).

**Tests and drivers.** `scripts/test-striporder.ts` (new, `npm run test:striporder`, registered like `test:unread`): the order rule (T099), move/toggle/reset (T100), storage load/save/validation and adversarial input (T102), source checks that `renderStrip` uses `orderStrip` and no `prio` sort remains in the manual branch (mutation-checkable). `scripts/check-strip-order.js` (new simulator driver, `until()` waits, 1440x900 and 1280x800, SIM=15): drag, Alt+arrows, star, menu items, announcements, needs-you does not jump, favourites first with 15 agents, strip height 48 and no overlap, 10.5px floor, reduced motion, and a reload that keeps the order using an opt-in simulator query (`stripstore=1`, simulator only, writes the same key so a reload can be tested; without it the simulator does not store, like the chat numbers).

**Constitution check.** I (adapters): untouched. III (safe, no secrets): ids only in `localStorage`, no logging. IV/V (calm, legible): 10.5px, 48px strip, no new motion beyond the drag. VI (parity): Alt on Windows/Linux, Option on a Mac; no POSIX assumptions. VII (gates): test + driver + shots. VIII (honest limits): the gaps in the spec.

**Risks.** `app.js` is shared with other open work: merge `main` first. The keyed morph must not drop focus or a drag in progress during the 30 s repaint tick and on status events: the renderer defers a strip repaint while a drag is active (T106).

## 2026-11-01 delta: the design sweep's build order (one table for specs 005, 006, 052, 070, 097; FR-190..FR-208 here)

**This table is the order.** The sweep's order, after D1 and K2, each row one small PR with a driver test. "Measure first" means the PR's first commit runs its driver on `main`, writes the numbers in the PR description and only then builds to the target. If a measurement disagrees with a target by more than the tolerance in the spec, the PR says so and asks; it does not move the target. Numbers from `main` at the sweep (`c5f039a1`). **Net** says whether the PR should remove more lines than it adds, counting `src/` only, with new drivers and tests apart.

**Gates.** D1 and K2 go first. **Retro arcade (spec 102: #1005, #1006, #1007 and what its plan builds next) stays ahead** unless the owner says otherwise. **The rail's form, list or floor plan, is pending the owner's look (T125), and no rail build comes before it,** so its rows are last and rows 3 to 10 do not depend on it. The token and control track runs alongside. Settings waits for spec 102 to remove themes.

| # | PR, branch | Tasks | Driver | Measure first, target | Net |
|---|---|---|---|---|---|
| 1 | **D1** `052-needs-you-text` | 052 T209 | new, plus pure test | Reproduce "search_companies)Allow…" on `main`; none left | No: a small fix |
| 2 | **K2** #1011 (open, stacked on #987) | 052 T210; #1011's own | `shots-033` | `.swt.on` 2.47:1 to 6.08:1 and 6.92:1 | Yes: `.fl-sw` goes |
| | *Gate: Retro arcade lands* | | | | |
| 3 | **C1** `005-chat-header` | 005 T117, T118, 006 T066 | new `check-chat-density` | Header 103 to 61; tabs and Previous one row 31; composer 122 to 91 | Yes: overrides and wrap rules go |
| 4 | **C2** `005-chat-density` | 005 T119..T121 | `check-chat-density` | 575 to 442, 649 to 509, 1358 to 1167 px | Yes: box rules go |
| 5 | **W** `005-chat-width` | 005 T122, T124 | new `check-chat-width`, full FR-195 | 126 letters at 3 widths; log 638 and 538 px without a rail (calculated) | Yes: 880 and 1240 px rules go, one token |
| 6 | **N1** `052-notices-card` | 052 T212, T213 | new `check-notices` | Three bars 93 px, desks move; no desk moves; red lock | No, until row 7: the surface first |
| 7 | **N2** `052-notices-out` | 052 T214, 006 T065 | `check-notices`, `shots-006-crash` | No `.notice-strip` left; log 669 and 569 px (calculated) | Yes: three painters and their CSS go; rows 6 and 7 together remove more than they add |
| 8 | **Needs you** #1002's build | 052 T196..T202, T215 | `check-needs-panel` | Composer hidden 44 and 204 to 0 px; chat keeps window less 360 px, less the rail if one comes | No: a feature, itself gated on Retro and #994 |
| 9 | **#1001, what is left** | 097 T171, T172 | `shots-097-chat` | Header 139 to 61 px; log 669 and 569 px | Yes: a smaller portrait, moved words, literals gone |
| 10 | **S** `052-settings-nav`, after spec 102 removes themes | 052 T219 | new `check-settings-nav` | 7238 px, 22 headings re-measured; each section one jump | Yes with themes gone; no alone |
| | *Gate: the owner's look at the rail's form, T125. Rows below are the list form and are rewritten if he picks a floor plan* | | | | |
| 11 | **R1** `005-rail` | 005 T113..T115, 052 T211 | new `check-rail`, `test-macos` | Log to FR-195's rail columns; two heights; 1280: scroll 34 px or none; contrast 4.5:1 | No: about 22 strip rules go, groups and tall rows arrive. Ceiling +120 lines |
| 12 | **R2** `005-rail-collapse` | 005 T116 | `check-rail` | 52 px under 1100 px; nothing lost when hidden | No: small addition |

*Alongside, any time after row 2 (spec 070's Phase 3 and spec 052's controls):*

| # | PR, branch | Tasks | Driver | Measure first, target | Net |
|---|---|---|---|---|---|
| A1 | `070-token-lint` | 070 T022 | `test:theme-tokens` with mutants | Commit real counts (386, 114, 221; 570, 291, 344; 305; 127; 99) | No: adds a script, no visual change |
| A2 | `070-wb-registry` | 070 T023 | fixture pack in `test:theme-tokens` | Confirm the drop first; 0 dropped after | No: registry grows |
| A3 | `052-toggle-rule` | 052 T216 | `check-ui-text`, screen drivers | 17 checkboxes, 9 switches: immediate ones moved | Yes, with `sw()` |
| A4 | `070-component-tokens` | 070 T024 | `test:theme-tokens`, `check:perf` | World switch row unchanged | Yes, once literals fold |
| A5 | `052-accent` | 052 T217 | `check-ui-text` | No browser blue; ratchet lowered | No: a few lines either way |
| A6 | `052-info-notes` | 052 T218 | `check-ui-text` | `.note.info` not amber | No: small |
| A7 | `070-shadows` | 070 T025 | `check-ui-text`, `check:office` | 34 shadows to 4 on screen | Yes |
| A8 | `070-type-scale` | 070 T026 | `check-ui-text`, `check:geometry` | 14 sizes to 6, 8 weights to 3, chrome only | Yes |
| A9 | `070-control-heights` | 070 T027 | `check-ui-text`, top bar fit | 7 heights to 4 | Yes |
| A10 | `070-radii` | 070 T028 | `check-ui-text` | 21 radii to 6 | Yes |
| A11 | `070-ui-helpers` | 070 T029 | existing drivers | 99 button class sets falling | Yes over time; not its first PR |
| A12 | `070-font-smoothing`, no new font (FR-058 of spec 070) | 070 T030 | `test-macos` pins the choice | Real Mac at 2x and 1x: `antialiased` against `auto`; the Mac owner picks | No: one line either way |

**Risks.** `app.js` is shared with many open PRs: merge `main` first, and small PRs help. About 23 drivers read `.sitem` or `.strip`; R1 updates them in one go and keeps `data-sw` so most need only a selector. The rail's rows change if the owner picks a floor plan; FR-198 waits for that and for Paco; no other row waits for either. Numbers here come from a mock on one Linux machine: a measure-first run may disagree, which is why it comes first. A list rail removes the Mac's drag strip, and no one here can test that: 052 FR-215.

**Constitution check.** I: this spec-only PR comes first. II: renderer only, plus a registry entry. III: no safety rule changes; 003 FR-026 stands and 052 FR-219 keeps a warning findable. IV: simulator only. V: text never smaller, 10.5 px floor, 15 agents fit both sizes, and, if the list rail is picked, a rail scroll limited as FR-196 says. VI: Mac rules in 052 FR-215; Windows and Mac rendering unverified here (`[KNOWN GAP]`). VIII: each number says measured, mock, calculated or reasoned.

**Existing capability check (FR-031 of spec 021).** No new tool, library or component: `renderStrip`, `toastActions`, `mountToast`, `holdTimer`, `sw()`, `requestText`, `needsMe`, `test:theme-tokens`, `check-ui-text`. New files: drivers, `scripts/inventory.js`, and later `src/renderer/ui.js` (FR-056 of spec 070).

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

## Delta 2026-10-21: readable JSON tool results and saved outputs (issue #361, FR-027..FR-034)

**Shape.** One pure decoder in the page, one normalized optional field on `ToolCallEvent` (and one on `PermissionInfo`), and a chip change. No new IPC, no new process, no file access: Durbar never touches the agent app's saved file.

| Piece | Where | Notes |
| --- | --- | --- |
| Decoder | `src/renderer/tooljson.js` (new, UMD like `cuttext.js`: `window.DurbarToolJson` in the page, `module.exports` in Node) | `format(text, {redact, maxIn, maxNodes, maxNest, maxOut})` returns `{kind:'json', text, decoded, bytes}` or `{kind:'text', reason?}`. Walks the parsed value with an explicit stack (no recursion, so 200 levels of `[` cannot overflow), parses a nested string only when its trimmed text starts with `{`/`[` and ends with `}`/`]`, counts visited values and parse work against the limits before doing the work, then `JSON.stringify(v, null, 2)` and `redact` on the result. `redact` is injected (like `liveact.js` takes `mask`), so the module has no import and the page passes `window.DurbarRedact.redact`; missing `redact` returns `{kind:'text'}` (fail closed). |
| Size words | same module, `sizeWords(bytes)` | "812 B", "33.8 KB", "1.2 MB" (1024 base, one decimal), used by the saved line and the closed-chip text. |
| Event field | `src/adapters/types.ts` `ToolCallEvent.savedOutput?`, `PermissionInfo.savedOutput?` | Shape in FR-031; no path. Guarded in `src/adapters/eventguard.ts`. |
| Detection | `src/adapters/savedoutput.ts` (new, pure) | `copilotSaved(text, telemetry?)` and `claudeSaved(text)` return `{bytes?, place, preview?, fileName?}`; `parseSize("33.8 KB")`; base-name split on `/` and `\`; Copilot's file-name pattern copied from the runtime (`copilot-tool-output`, `original-output-<n>-`). `fileName` stays in the mapper's per-session memory for FR-033 and is stripped before the event is emitted. Linear, anchored patterns only. |
| Copilot mapper | `src/adapters/map.ts` (`tool.execution_complete`) | Reads `result.content` and `toolTelemetry`; adds `savedOutput`. The permission path (`src/adapters/copilot.ts` / `permissions.ts`) asks the mapper whether a read path's base name was flagged. |
| Claude mapper | `src/adapters/claudeMap.ts` (`tool_result`) | Detects `<persisted-output>` on the full text **before** `cap()`. |
| Chip | `src/renderer/app.js` `makeChip` / `tTool`, `styles.css` | Formatted block with Show raw / Show formatted and Copy (formatted), "N nested values decoded" line, saved line and preview, closed-chip text; Simple hides the raw toggle for a saved output. Text only (`textContent`/`esc`), never `innerHTML` of decoded content. |
| Permission hint | `app.js` permission card, Needs you row, refusal note | One muted line when `permission.savedOutput` is true. |
| Simulator | `src/renderer/sim.ts` | One MCP call with made-up nested JSON (`{"rawResponse":"{\"value\":[{\"searchTerms\":\"...\"}]}"}`, plus a fake `Bearer` token inside the nested string to show masking) and one call with `savedOutput: {bytes: 34611, place: 'temp', preview: '{"value":[{"id":1,'}` (a preview cut mid-JSON, so it falls back to text). No real data. |
| Driver | `scripts/shots-005-tooljson.js` (new) on `scripts/driver-helpers.js`, listed in `scripts/ui-suite.js` | Opens both chips, asserts the formatted block, the masked token, the saved line text and that no `copilot-tool-output` text or path is in the Simple DOM; screenshots at 1440x900 and 1280x800, Expert and Simple. Values put into page code go through `jsLiteral`. |

**Constitution check.** I (adapters are plug-ins): app-specific text is matched only in `src/adapters`; the renderer reads `savedOutput`. III (safe, no secrets): no file is read; the path never reaches the page; decoded text is masked; text only. IV (no credits): simulator and unit tests; the real wording stays `read:`. V (calm UI): one muted line, existing block sizes, 10.5px minimum. VI (parity): `/` and `\` paths; Windows `AppData\Local\Temp`, macOS `/var/folders/…/T/` and Linux `/tmp` fixtures. VIII (honest limits): FR-031's real event shape is `[KNOWN GAP]` until a real session.

**Risks.** PR #463 (`005-chat-edit-stream`, open) also changes `makeChip`/`tTool`, `ToolCallEvent` and the event guard, and uses FR-018..FR-026 and T027..T036 in this spec; land after it or rebase on it. A runtime update can change Copilot's wording: the detection then simply stops (no line shown), it never misreports.

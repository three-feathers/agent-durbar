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

## 2026-10-21 delta: file edits stream into the chat (FR-018..FR-026)

**Existing code reused** (AGENTS.md *Look for an existing capability first*): `simpleDiff` and `clipDiff` (`src/shared/diff.ts`, spec 052 FR-063) build and cut the diffs; `redact` (`src/shared/redact.ts`) masks them; the permission card's `ACT.diffLines` (`activity.js`) splits diff text into typed lines and its `.pdiff` colours style them; `plainChip`, `toolKind`, `makeChip`, `refreshChips` and the 1-second waiting-line timer in `app.js` carry the row and the timer. PR #458 (desk live activity) reads the same `toolCall` start through `toolLabel`; the edit row gives `toolLabel` the edit's path, so the desk readout says "Editing app.js" with no change of its own.

**Layers:**

1. `src/shared/edits.ts` (pure, no provider types): the `EditInfo`/`EditFile` types, `editFile()` (old/new or whole text to a diff with counts), `patchFiles()` (the `*** Begin Patch` text format and plain unified diffs, split per file), `finishEdit()` (redact paths and diffs, clip each diff, at most 20 files) and `partialJson()` (a tolerant parse of a JSON prefix: closes an open string, drops a dangling key, closes brackets; linear time).
2. `src/adapters/edits.ts` (adapter side, knows tool names and argument shapes of the three apps): `editOf(tool, args)` and an `ArgStream` per call (append, cap at 1 MB, re-parse after growth of an eighth, report the path as soon as it is known).
3. Mappers: `claudeMap.ts` maps `content_block_start` (`tool_use`) and `input_json_delta` for file-changing tools (index -> call id per stream); the complete `assistant` block of an already started call becomes an `update` with the full `args` and `edit`. `map.ts` (Copilot) maps `assistant.tool_call_delta` the same way and turns `tool.execution_start` of a started call into an `update`. `codexMap.ts` maps `item/fileChange/patchUpdated` and puts the changes' diffs into `edit` on `item/started`/`item/completed`.
4. `eventguard.ts`: checks the optional `edit` shape.
5. Renderer: `src/renderer/editview.js` (UMD like `cuttext.js`, unit-tested in Node): verbs and plain words, display path relative to the folder (FR-025), line counts, the lines to show (12/400). `app.js`: `tTool` makes an edit row and a sibling `.ediff` block (hidden with its chip by `refreshChips`), repaints it once per frame on `update`, and sets the waiting line's current action (`T.typing.dataset.act`, `dataset.a0`). `styles.css`: `.chip.editchip`, `.ediff` (theme tokens, 10.5px minimum kept, 11px monospace like `.pdiff`).
6. Simulator (`sim.ts`): streamed edit, new file, two-file patch (FR-026).

**Tests:** `scripts/test-edits.ts` (shared helpers and adapter normalizers: Claude stream and complete, Copilot JSON and raw patch deltas, Codex patchUpdated, masking, caps, partial JSON fuzz and linear time), additions to `test-claude-map.ts` and `test-codex-map.ts` fixtures, `scripts/test-editview.ts`, and the driver `scripts/check-edits.js` (sim, both sizes, Expert and Simple) with screenshots `docs/screenshots/005-edit-*.png`.

**Constitution:** II (shapes stay in adapters; the event carries a neutral payload), III (redacted in the adapter, text only in the DOM), IV (simulator and fixtures, 0 credits), V (12 lines, throttled, reduced motion, 10.5px), VI (FR-025 path rules tested with Windows and POSIX paths), VIII (real streams not recorded: `[KNOWN GAP]`).

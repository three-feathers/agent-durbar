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

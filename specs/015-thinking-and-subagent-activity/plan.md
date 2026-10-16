# Plan: 015 thinking and sub-agent activity

- `src/adapters/map.ts` (new, pure): `createMapper(emit)` keeps `toolNames`, `reasoningSeen`, `instanceToCall`; `map(ev)` replaces `CopilotAdapter.map`. Tests: `scripts/test-events.ts` replays `scripts/fixtures/events/*.json`.
- `src/adapters/types.ts`: extended `ThinkingEvent`, `SubagentEvent`, `UserEvent` (see spec).
- `src/renderer/app.js`: live turn = ordered timeline (`.tl` children: thinking block, chip group, text bubble, sub-agent block) instead of fixed think/chips/bubble. Helper agents get a `sub` model (events, prompt, result); `openPanel(helperId)` shows `renderSubTranscript`. Thinking and text go through the markdown module (spec 016).
- `src/renderer/sim.ts`: scripted markdown thinking, sub-agent runs, a no-reasoning turn.
- `scripts/capture-raw.ts`: dev tool that records raw SDK events (uses credits, not in `npm test`).

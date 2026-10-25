# Plan: 015 thinking and sub-agent activity

- `src/adapters/map.ts` (new, pure): `createMapper(emit)` keeps `toolNames`, `reasoningSeen`, `instanceToCall`; `map(ev)` replaces `CopilotAdapter.map`. Tests: `scripts/test-events.ts` replays `scripts/fixtures/events/*.json`.
- `src/adapters/types.ts`: extended `ThinkingEvent`, `SubagentEvent`, `UserEvent` (see spec).
- `src/renderer/app.js`: live turn = ordered timeline (`.tl` children: thinking block, chip group, text bubble, sub-agent block) instead of fixed think/chips/bubble. Helper agents get a `sub` model (events, prompt, result); `openPanel(helperId)` shows `renderSubTranscript`. Thinking and text go through the markdown module (spec 016).
- `src/renderer/sim.ts`: scripted markdown thinking, sub-agent runs, a no-reasoning turn.
- `scripts/capture-raw.ts`: dev tool that records raw SDK events (uses credits, not in `npm test`).

## 2026-10-25 delta: compaction on the desk (issue #601)

- Types: `CompactionEvent.trigger` += `truncation`, `unknown` (`src/adapters/types.ts`); `eventguard.ts` checks trigger and numbers.
- Adapters (normalized events only): `claudeMap.ts` (`system/status`, `compact_boundary`, open-compaction state, ended by `result` and `reset`), `codexMap.ts` (`contextCompaction` item), `map.ts` (`session.truncation`). Shared helper for a safe count lives next to each mapper's existing `num`.
- Renderer: `modelswitch.js` gets `compactingNow` and the `unknown`/`truncation` wording; `app.js` extends `pillSt`/`stWord`/`deskLine`/card class/list dot/strip item/ring name and repaints from `onCompaction`; `styles.css` reuses the Thinking palette for `st-compacting`.
- Simulator: `simcompact=1`.
- Tests: `scripts/test-compaction.ts` (in `npm test`), driver `scripts/shots-015-compact.js` (UI suite, `shots:docs`), mutation checks listed in the PR.
- Docs: README (feature text), changelog fragment, specs-index block, `docs/agent-notes.md` entry.

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

## 2026-11-04 delta: background helpers (issue #1141)

- Types: `SubagentEvent.background?: boolean` (`src/adapters/types.ts`); `eventguard.ts` refuses a non-boolean.
- Adapters: `claudeMap.ts` keeps a set of background call ids from the `Agent` / `Task` input (`run_in_background === true`); `user()` closes only calls not in it; `task_notification` closes both; `reset` clears it. `map.ts` sets `background: true` on `subagent.started` when `executionMode === 'background'`.
- Renderer (`app.js`): `onSubagent` stores `s.background`; `onTaskTool` on `complete` of a background record that is still running changes nothing (no status, no result, no card change); `failed` still ends it; the session `stopped` branch ends running helpers as failed ("Stopped with its session").
- Simulator: `simbghelper=1` in `subRun`. Tests: `scripts/test-claude-map.ts`, `scripts/test-events.ts` (or the Copilot mapper test), a case in `scripts/check-office-fill.js` next to the Claude-shaped helper case.

## 2026-11-08 delta: one helper mask (issue #1330)

- Renderer (`app.js`): `homeMask` (`DurbarRedact.maskHomePaths`, kept text when it is missing) and `helperMask = deskMask(homeMask(t))`, the names and order of PR #1322; used by `onSubagent` / `onTaskTool` (stored name, agent name), `buildSubTranscript` (title, task line), `subPaintView` (error line), `subBlock` (task line), `helperTileHTML`, the `DurbarHelperCard` deps, and before every helper card `setState` excerpt. No change to `src/shared/redact.ts`.
- Tests: `scripts/test-helpercard.ts` (the two lines from the page's source, real modules), `scripts/check-015-bg-helper.js` step 4.

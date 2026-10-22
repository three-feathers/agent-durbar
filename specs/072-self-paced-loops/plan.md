# Implementation Plan: Self-paced loops

**Branch**: `072-self-paced-loops` | **Date**: 2026-10-22 | **Spec**: [spec.md](spec.md)
**Status**: Draft. It follows the owner's answers to Q1-Q9 (2026-10-22): the recommended defaults, except Q6 (b): no broker exception for the loop tools.

## Summary

Loops extend spec 044's `Scheduler` with a `loop` kind on a session target. The next wake is set at the end of each pass from the agent's pace request, clamped to the user's limits. Phase 1 reads the request from a `LOOP:` line in the final assistant message (normalized `output` event), so it is adapter-neutral and needs no MCP. Phase 2 adds a per-session `durbar-loop` MCP server with two tools. It is built from spec 041's merged pure building blocks, but it is a separate server.

## Technical Context

**Language/Version**: TypeScript (main, shared, adapters), plain JS renderer, Electron (as in `package.json`)
**Primary Dependencies**: none new
**Storage**: `durbar-schedules.json` (spec 044); no new file. The Phase 2 tokens are in memory only.
**Testing**: `scripts/test-loops.ts` (new: fake clock, fake sender, scripted events), `test:schedules` extended, `test:activity` extended; Phase 2 adds `scripts/test-looptool.ts`. Simulator driver `scripts/shots-072-loop.js`; `check:office` for the desk chip.
**Target Platform**: Windows, macOS, Linux (timers and JSON only in Phase 1; Phase 2 uses `paths.ts` socket and pipe names per OS)
**Constraints**: zero AI credits in tests; prompts and replies are never logged; the 10.5 px minimum; 15 agents at 1440x900 and 1280x800.

## Constitution Check

- **I Spec Kit**: spec, plan and tasks first; deltas for 044, 041, 052 and 001 are their own tasks. Pass.
- **II Adapters**:
  - Phase 1 reads only normalized `output`/`status`/`usage`/`question`/`limit` events, and later `usageLimit` (#462). There is no adapter change.
  - Phase 2 passes one more `McpServerSpec` through the existing `mcpServers` option. Each adapter already maps it (`copilot.ts:586`, `claude.ts:159`, `codexMcp.ts:13`).

  Pass.
- **III Safe by default**:
  - Passes use the user's send path and the current mode. Limits are enforced in main, and IPC input is validated (044 FR-017 style).
  - No shell. The reason text is cleaned and redacted. The token is never on disk.
  - **Phase 2 (owner Q6 (b)):** no broker exception. The loop tools are ordinary MCP calls (denied in Read-only, asked in Ask first), so constitution III is unchanged.

  Pass for both phases.
- **IV No credits in tests**: fake clock and simulator only. Real checks are separate tasks with the cost stated (spec, *Cost of verification*). Pass.
- **V Calm UI**: one desk chip (icon and word), rows in the existing Schedules views, and the Postbox reused; `check:office` at both sizes. Pass, to be verified.
- **VI Parity**: durations, not wall-clock times; no OS scheduler. Phase 2 uses `paths.ts` per-OS names and the `win32`/`posix` tests. Pass.
- **VII Quality gates**: unit tests for the core and the parser; a driver and screenshots for the UI. Pass.
- **VIII Honest limits**: the gaps are listed in the spec and go to the README. Pass.

## Design

### Phase 1

1. **`src/shared/looppace.ts`** (new, pure).
   - `parsePace(text): { kind: 'next'; minutes; reason? } | { kind: 'stop'; reason? } | undefined`: last non-empty line only, linear-time parsing, at most 200 characters.
   - `clampPace(minutes, loop) -> { minutes, source }`.
   - `cleanReason(s)`: one line, no control, bidi or zero-width characters, `redact()`, at most 120 characters.
   - `loopFooter(loop, pass, mode: 'line' | 'tool')`: fixed text, at most 400 characters.

   Shared, so the simulator uses the same code.
2. **`src/main/schedules.ts`**.
   - `Schedule.loop?: LoopSpec`; `cleanSchedule` validates it (FR-003). A loop requires a `target` and has no `every`/`at`/`rule`.
   - Main-owned fields are stripped in `save()` as today (line 337), and also `loop.passes`, `inPass`, `lastAsk`, `noPaceStreak`, `ended`.
   - `dueAt` returns `undefined` for a loop that is `inPass`, held or ended.
   - New outcomes: `skipped-busy` (reused), `held`, `ended`.
   - `start()`: a loop not yet ended becomes `ended: { reason: 'app-closed' }` (FR-008).
   - `tick()` for a loop:
     - Pause all: hold;
     - the session is gone: end;
     - the loop's cap is reached: end;
     - a person-wait, a break or Durbar's cap: hold;
     - busy: skip and re-arm;
     - else send, with `inPass = true` and `passes++`.
   - New deps: `waitOf(session): 'person' | 'break' | 'cap' | undefined`.
   - `turnEnded(session, info)` becomes the loop's pass end. It takes the pace request that main collected for that pass and sets `next` or `ended`. `noteFinalText(session, text)` keeps only the last final message seen while `inPass`.
   - `holdReleased(session)` sets `next = now + lastAsk.minutes`.
   - `stopLoop(id, reason)` and `restartLoop(id)`.
3. **`src/main/main.ts`**.
   - In the existing `router.onEvent` hook (163-170), main feeds `noteFinalText` for `output` events with `final` and no `agentId`.
   - Holds are computed from `agentState` (`question`/`limit` flags, `needs-permission`) and, once #462 is in, from `usageLimit`. Main calls `holdReleased` when they clear.
   - Stop: the existing stop and end handlers call `scheduler.stopLoopFor(session, 'user')`.
   - The loop footer is appended inside `scheduleDeps.send` for loop schedules only.
   - `logActivity` rows for pass, skip, hold, start and end.
4. **`src/shared/activity.ts`**: the new decisions `loop-start`, `loop-pass`, `loop-skip`, `loop-hold`, `loop-end` (FR-024). `test:activity` covers them.
5. **IPC** `src/main/ipc/schedules.ts`: `schedules:stopLoop(id)` and `schedules:restartLoop(id)`, with `fromApp` checks and id checks. `save` accepts `loop`. Update `ScheduleInfo` in `src/shared/api.ts` and the preload.
6. **Renderer** `src/renderer/app.js`:
   - the **Loop this…** menu item beside *Plan first* (3191);
   - the dialog kind **Loop** in `openSchedules` (4008) with the limits and the worst-case line;
   - loop rows in `schedRow`/`schedBtns` (3974-3977) and Settings (4085-4103);
   - the desk chip in the card renderer;
   - chat notes on a new `loop:pass` push (next to `schedule:ran`, 4143).

   The Postbox (PR #511 `postNext`) gets a "loop" label.
7. **Simulator** `src/renderer/sim.ts`: loops in `simSched` (433-440); a simulated reply ends with a scripted `LOOP:` line (a `simloop=` hook: next, stop, none, low).

### Phase 2

1. **`src/shared/loopserver.ts`**: the reserved name `durbar-loop`, the helper flag `--durbar-loop-tool`, the token-file path argument, and the two frozen `ToolDef`s (the `tools.ts` pattern).
2. **`src/main/loop/host.ts`**: a per-run local socket or named pipe (from `paths.ts`, its own name). Each connection must present a session token (read by the helper from the 0600 token file whose path is in its server spec; FR-031), and main maps token to session (FR-031). It uses `McpSession` (`protocol.ts`), `McpConnection` limits (`connection.ts`) and a registry with exactly the two tools. Handlers call `scheduler.paceFromTool(session, req)`.
3. **The relay** (`src/main/loop/relay.ts`, pure core): stdio to socket, launched by the agent runtime as Durbar's executable with `--durbar-loop-tool`. **Share it with 041 T018** (one relay core, two flags). Coordinate with Ruben before building.
4. **Adapters**: no new code beyond receiving one more `mcpServers` entry. Main adds it in the start options of a looping session (Q7 (a): a looping live session is restarted or resumed with it, refused while busy).
5. **Broker** (owner Q6 (b)): no change. `durbar-loop` calls go through the normal `mcp` rule; Copilot's tools carry no `readOnlyHint` override. A Read-only loop is paced by the reply line.
6. **Guards**: `McpStore` refuses a user extra with the reserved name or pointing at the helper. The ambient Copilot CLI list entry with that name is disabled (`disabledMcpServers`). This extends 041 T040's `isDurbarBridge` to know both flags.

## Risks

- **The agent never writes the line** (models ignore footers): FR-012 stops the loop after two passes, so it is safe but less useful. The real check measures this.
- **The per-session token (Phase 2)** is the most security-sensitive part: how it reaches the loop helper on each app without being on a command line or in an environment variable (a 0600 file whose path is in the server spec, FR-031), and that a token from one session never moves another session's loop (SC-004).
- **Restarting a live session to add the server (Q7)** costs the session's warm state on some apps; it is unverified per app.
- **Dependencies on open PRs** #462 (coffee break) and #511 (Postbox): their tasks are separate and wait. If #462's design changes, FR-016 follows it.
- **The 044 busy check** (`main.ts:443`) may miss questions and limits; loops use the agentstate flags, and 044 may need its own delta (outside this spec).

## Project Structure

```text
specs/072-self-paced-loops/
├── spec.md
├── plan.md
└── tasks.md
src/shared/looppace.ts            (new, Phase 1)
src/main/schedules.ts             (loop kind)
src/main/main.ts                  (wiring)
src/main/ipc/schedules.ts         (stopLoop, restartLoop)
src/shared/api.ts, src/preload/preload.ts
src/shared/activity.ts            (decisions)
src/renderer/app.js, sim.ts, places.js (Postbox label, after #511)
src/shared/loopserver.ts, src/main/loop/{host,relay}.ts   (Phase 2)
(no broker change: owner Q6 (b))
scripts/test-loops.ts, scripts/test-looptool.ts, scripts/shots-072-loop.js
```

## Complexity Tracking

None. The owner chose no broker exception (Q6 (b)).

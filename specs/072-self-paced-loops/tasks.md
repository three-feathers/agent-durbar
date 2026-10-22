# Tasks: Self-paced loops (072)

**Input**: [spec.md](spec.md), [plan.md](plan.md). One task per issue and per branch (`072-slug`). No task runs a real agent session unless it says so and the owner agreed to its cost.

Owner answered Q1-Q9 on 2026-10-22 (see spec.md); Q6 is (b), no Read-only exception.

## Phase 1: loop as a schedule, paced by the reply line (no spec 041)

### Foundation

- [ ] T001 `src/shared/looppace.ts`: `parsePace`, `clampPace`, `cleanReason`, `loopFooter`; unit tests (forms, last line only, sub-agent text ignored by the caller, long or hostile lines, linear time, bidi and control characters, `redact`) [FR-009, FR-010, FR-011]
- [ ] T002 `src/main/schedules.ts`: `loop` field in `Schedule`, validation of the limits in `cleanSchedule`, main-owned fields stripped in `save`; `test:schedules` cases (ranges, target required, no `every`/`at`/`rule`, 50-schedule cap, one loop per session) [FR-001..FR-004]
- [ ] T003 Scheduler loop core: `tick` order for loops (Pause all, ended, cap, hold, busy, send), `inPass`, `turnEnded` taking the pace request, clamping, default delay and the two-pass stop, two errors stop, max passes and end time; `scripts/test-loops.ts` with a fake clock including the SC-002 fuzz [FR-011..FR-014, FR-018, SC-002]
- [ ] T004 Holds: the `waitOf` dep, person-wait hold and release (next = release + last delay), Pause all hold and release without a burst, Durbar's cap pause needing Resume; tests [FR-015, FR-017, FR-019, SC-003]
- [ ] T005 Restart rule: `start()` ends running loops "when Durbar closed"; `restartLoop` resets passes and spend; tests [FR-008]

### Wiring

- [ ] T006 `main.ts`: feed final assistant text to the scheduler during a pass, the loop footer in `scheduleDeps.send`, holds from `agentState`, Stop and End session end the loop; a `loop:pass` push to the window [FR-006, FR-007, FR-009, FR-015]
- [ ] T007 IPC `schedules:stopLoop` and `schedules:restartLoop` (validated, `fromApp`), `ScheduleInfo.loop` in `src/shared/api.ts`, preload; `test:ipcchannels` [FR-005, FR-007, FR-008]
- [ ] T008 Activity log: decisions `loop-start|pass|skip|hold|end`, rows recorded in main with cleaned reasons and never the prompt; `test:activity` [FR-024, SC-005]

### UI (simulator only)

- [ ] T010 Renderer: **Loop this…** in the session menu and the **Loop** kind in the Schedules dialog from a chat, one form with the defaults and the worst-case line [FR-005]
- [ ] T011 Renderer: loop rows in the Schedules dialog and Settings > Schedules (next, reason, source, pass N of M, spend, end reason, Stop loop / Start again / Delete) [FR-021]
- [ ] T012 Renderer: desk chip (icon and word, compact = icon with label), chat notes per pass; `check:office` at 1440x900 and 1280x800 with 15 agents and 5 loops [FR-020, FR-023, SC-006]
- [ ] T013 Simulator: loops in `simSched`, scripted `LOOP:` replies (`simloop=` next, stop, none, low); driver `scripts/shots-072-loop.js` and screenshots `docs/screenshots/072-*` at both sizes [FR-040, FR-041]

### Depends on open PRs

- [ ] T020 Coffee-break hold from the `usageLimit` event and 068's resume turn (after PR #462 is merged); tests [FR-016]
- [ ] T021 Postbox lists loop wakes labelled "loop", letter on a wake (after PR #511 is merged); driver check [FR-022]

### Docs and cross-references

- [ ] T022 Spec deltas: 044 (a loop is a schedule kind; the possible busy-check gap at `main.ts:443` noted for a separate check), 052 (new activity decisions), 001 (Postbox label); specs index row status [R1]
- [ ] T023 README (feature, *Safety model*: loops keep the mode, limits, restart rule; known limits), changelog entry (fragment or *Unreleased*, whichever is on `main` then) [all]

### Real check (owner's OK and budget first)

- [ ] T040 One real loop per app, 2 passes, `minDelay` 5, a tiny read-only prompt: Copilot (about 0.4 AI credits), Claude Code `haiku` (about $0.01), Codex (a few cents, unverified). Record whether each model writes the `LOOP:` line. Not in CI. [Assumptions]

## Phase 2: per-session loop tools (Q6 (b), Q7 (a))

- [ ] T030 Spec 041 delta: FR-030 is about 041's control server; the `durbar-loop` server is separate, scoped to one session, two tools; T040's `isDurbarBridge` learns both flags (coordinate with Ruben) [FR-030]
- [ ] T031 `src/shared/loopserver.ts`: reserved name, flag, env names, two frozen tool definitions; tests [FR-030]
- [ ] T032 `src/main/loop/host.ts`: socket or pipe from `paths.ts`, token-to-session map in memory, `McpSession` + `McpConnection` limits, handlers that call the scheduler; tests with two sessions and swapped or unknown tokens [FR-031, FR-032, SC-004]
- [ ] T033 Relay core (stdio to socket) and the `--durbar-loop-tool` branch, shared with 041 T018 if that lands first; test of the pure core [FR-031]
- [ ] T034 Main: the server in a looping session's `mcpServers`, the token dropped at the end; a live session restarted with it per Q7, refused while busy; adapter option tests for all three apps (present only while looping); a test for all three apps that the token is not in the built `mcpServers`, the Claude CLI argv (`--mcp-config`) or Codex's `thread/start` config; the token file is 0600 in a 0700 folder and deleted at loop end [FR-031, US4]
- [ ] T035 Broker: no exception (owner Q6 (b)); a test that `durbar-loop` tool calls are denied in Read-only and asked in Ask first like any `mcp` call, and that a Read-only loop is still paced by the reply line [FR-033]
- [ ] T036 Guards: `McpStore` refuses the reserved name and the helper command; the ambient Copilot CLI entry is disabled; tests [FR-033]
- [ ] T037 Tool wins over the reply line in the same pass; the footer switches to the tool wording; tests [FR-035]
- [ ] ~~T038~~ Out of scope (owner Q8 (b)): offer card for `schedule_next` without a loop, No focused, one refusal per session; driver check [FR-034]
- [ ] T041 Real check of the tools, one per app, the same budget as T040 (owner's OK first)

## Order

T001 → T002 → T003 → T004/T005 → T006 → T007/T008 → T010..T013. T020 and T021 after their PRs. T022/T023 with the last Phase 1 PR. Phase 2: T030 first, then T031 → T032 → T033 → T034 → T035/T036 → T037.

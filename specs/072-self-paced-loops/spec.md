# Feature Specification: Self-paced loops (the agent decides when its next turn runs)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Self-paced loops (issue #526): a prompt looped on one session; the agent says when its next pass runs or stops it, within Durbar's limits (min/max delay, passes, end time, credit cap); a kind of scheduled prompt (044), shown in Schedules, on the desk and in the Postbox
status: building
note: phase 1 foundation only (T001-T005); loops refused by save
-->

**Feature Branch**: `072-self-paced-loops` (touches 044 scheduled prompts, 001 lobby Postbox, 011 caps, 041 Durbar MCP, 052 activity log, 068 coffee break)
**Created**: 2026-10-22
**Status**: Phase 1 foundation built (T001-T005: pace parser, `Schedule.loop`, scheduler core, holds, restart rule; unit tests only, not wired to `main.ts`, no UI yet; until T006 wires it, `Scheduler.save` refuses a `loop` with "Loops are not available yet." through the `loopSupport.enabled` switch in `schedules.ts`, so no loop can run unwired). Before that: spec, plan and tasks only. Owner answers Q1-Q9 recorded at the end (Paco, fjcabello, 2026-10-22). A requirement not tagged otherwise is `[PLANNED]`; what exists today is cited as `read:`.
**Input**: Issue #526 (owner idea, Paco, 2026-10-22), inspired by Claude Code's `/loop` dynamic mode: on a loop, the agent itself says when its next turn runs ("wake me in 25 min, I'm waiting for CI") or that it is done. Input from Vikram's agent on Telegram (2026-10-22; Vikram decides for his side), folded in as requirements R1-R5 below.

## Summary

A **loop** is a prompt sent again and again to **one session**. After each pass the agent asks for the next wake-up (a delay and a reason) or stops the loop. Durbar enforces the limits: minimum and maximum delay, a maximum number of passes, an end time and a credit cap. The agent can only ask within them. A loop is a new kind of **scheduled prompt** (spec 044): the same store, the same scheduler, the same Schedules views and the same Postbox in the lobby. There is no second scheduler.

Phase 1 needs neither spec 041 nor any MCP server. The agent paces the loop with **one fixed line at the end of its reply** (`LOOP: next 25 min - waiting for CI` or `LOOP: stop - all merged`). Main reads that line from the normalized `output` event, so it works the same on Copilot, Claude Code and Codex. Phase 2 adds real tools, `schedule_next(minutes, reason)` and `stop_loop(reason)`. They come from a small **per-session loop server**, not from spec 041's control server, because spec 041 forbids giving Durbar's own agents that server (see *Context*).

## Context: what exists today

- **Scheduler** (spec 044), `src/main/schedules.ts`. `read:`
  - A pure core with an injected clock, timer, busy check and sender (`SchedulerDeps`, lines 181-196). One timer for all schedules (`arm`, 262-269).
  - `tick` (272-302) applies the order: Pause all, then session ended, then cap reached, then busy. A busy run is skipped and never queued (`skipped-busy`).
  - Per-session `target` (FR-014, lines 14-18, 89-98). An ended session pauses its schedule (`pauseEnded`, 223-232).
  - Per-schedule `cap` and `spent` (FR-015). Spend counts from a scheduled send until the turn ends (`noteUsage`/`turnEnded`, 240-254). A full cap pauses the schedule with `pausedReason: 'cap'`.
  - Intervals are fixed: 5-1440 min (`MIN_EVERY`/`MAX_EVERY`, 55-56). The next run comes only from `every`, `at` or `rule` (`nextAfter`, 77-78). Nothing lets a run set its own next time.
  - Stored in `durbar-schedules.json`, at most 50 schedules (`MAX_SCHEDULES`, 53), saved with mode 0600 (`saveSchedules`, 410-416).
- **Main wiring**, `src/main/main.ts`. `read:`
  - Each main agent's `lastStatus` (163-170), which also feeds `noteUsage`/`turnEnded`.
  - `busyStatus` counts only `working` and `needs-permission` (line 443). Spec 044 FR-002 also names "a question or limit waiting". Whether a pending question or a credit-limit request leaves the status at `working` was **not verified**. The `AgentStateTracker` (`src/main/mcp/agentstate.ts`) keeps `question` and `limit` flags (lines 131-152); this spec uses them.
  - Scheduled sends go through `scheduleDeps.send` (444-477): `ensureLive`, a `user` event to the window, `schedule:ran`, then `ad.send`. This is the user's own path, so the session's permission mode applies.
  - The scheduler is created when the app is ready, and `start()` marks missed runs (838-840).
- **IPC** `src/main/ipc/schedules.ts`: `schedules:list|save|remove|runNow|setPausedAll`, with `fromApp` checks. **API types**: `ScheduleInfo` (`src/shared/api.ts:176-205`) and the bridge methods (`api.ts:518-529`). `read:`
- **Renderer** `src/renderer/app.js`. `read:`
  - `SCHED` (3953), the row and buttons (`schedRow`/`schedBtns`, 3974-3977), the dialog `openSchedules(room, from)` (4008), Settings > Schedules (about 4085-4103), the chat note on `onScheduleRan` (4143) and the room clock chip (about 736).
  - The chat header **Schedules** button (1421) opens the dialog with *Send to: This session*.
  - The card/mode menu already has a one-shot **Plan first (next message)** item (3191, spec 066), which is a model for a "Loop this…" entry.
  - The simulator keeps its own in-memory schedules (`src/renderer/sim.ts:433-440`, spec 044 FR-018).
- **Postbox** (open PR #511, spec 001 FR-038, not merged): the lobby shows the next 3 scheduled runs from `SCHED` (`postNext` in `places.js`). A loop stored as a schedule with a `next` time would show there with no new path. `read:` (PR description only)
- **Coffee break** (open PR #462, spec 068, not merged): a normalized `usageLimit` event. The break logic is in the renderer (`coffeebreak.js`). Durbar's own cap is a break of kind `cap`, which "schedules skip" and which "never resumes by itself". `read:` (PR description only)
- **Caps** (spec 011): the runtime's `limit` event with phase `exhausted`/`resolved` (agentstate.ts:131-141). 1 AI credit = USD 0.01 (`src/shared/credits.ts:12`). `read:`
- **Activity log** (spec 052 FR-071): `ActivityStore` rows with a fixed `decision` list (`src/shared/activity.ts:14`). The action text goes through `redact()` and is cut to 160 characters. Scheduled runs are not logged there today. `read:`
- **Normalized events**: `output` with `final: true` carries the full assistant message (`src/adapters/types.ts:160-167`). Main receives every event through `router.onEvent`. `read:`
- **MCP servers given to a session**: `AgentStartOptions.mcpServers` (`types.ts:66`) as `McpServerSpec` (stdio with `env`, or http with `headers`, `src/shared/mcp.ts:13-23`). Each adapter maps it: Copilot `copilot.ts:586`, Claude `mcpConfigOf` (`claude.ts:159`), Codex `codexMcpConfig` (`codexMcp.ts:13`). No adapter has in-process custom tools. `read:`
- **Spec 041** (Durbar MCP server). `read:`
  - Only the building blocks are in: T010-T016 and the masking work (JSON-RPC framing `src/main/mcp/jsonrpc.ts`, MCP subset `protocol.ts` `McpSession`, `connection.ts` rate limits, the frozen tool registry `tools.ts:179`, the HMAC handshake `auth.ts`, socket paths `paths.ts`).
  - No server listens yet (T017, not built), and there is no bridge (T018, not built).
  - **041 FR-030 and US4: "Durbar MUST NOT add its MCP server to any agent's MCP configuration".** The 041 bridge refuses a caller that carries the agent marker (FR-034). So the loop tools **cannot** live on 041's server. They need their own server, scoped to one session, with two tools.
- **Permissions on MCP calls** (spec 044, *Changes* 2026-10-20, real check). Read-only denies an MCP tool call on Claude Code and Codex: the broker sees kind `mcp`. On Copilot, a call runs without asking only when the tool is marked `readOnlyHint`. Read-only is the default mode. A loop tool needs a decision here (Q6). The Phase 1 reply line needs none. `read:` and `real:` (Copilot only)
- **Copilot's own `every`/`after` scheduler** is shown read-only (044 FR-016) and is not used here: it is per runtime, has no busy rule and no cap. `read:`

## Requirements from the owner and the team (R1-R5)

- **R1 Reuse.** Loops live in the scheduled-prompts store and the Schedules views (spec 044), and the next wake shows in the Postbox (spec 001, PR #511). No parallel scheduler.
- **R2 Off by default.** A loop starts only from a user action, or after the user's explicit OK. Its passes keep the session's permission mode and never raise it.
- **R3 Pauses, never wakes into a wait.** A loop holds while the agent waits for a person (a question or a permission), during a coffee break (a usage limit, spec 068) and at Durbar's spending cap. It never sends a pass into any of these.
- **R4 Visible and ends cleanly.** Every wake shows its reason on the desk and in Schedules. Quitting the app or pressing Stop ends the loop. It does not come back after a restart unless the user says so.
- **R5 Durbar holds the limits.** Durbar enforces the minimum delay, maximum delay, maximum passes and a credit cap. The agent can only ask within them.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Loop a session and let the agent pace it (Priority: P1)

I am babysitting a PR. In the session's chat I choose **Loop this…**, type "Check CI and the review comments on PR #500; fix what you can", and keep the suggested limits. The agent works, then ends its reply with `LOOP: next 25 min - CI is still running`. Durbar wakes the same session 25 minutes later. The session still remembers the last pass. When everything is green the agent ends with `LOOP: stop - merged`, and the loop ends.

**Why this priority**: This is the feature. Without the self-paced wake there is nothing beyond a fixed schedule (spec 044).

**Independent Test**: Unit tests on the pure loop core with a fake clock, a fake sender and scripted `output` events. Simulator: a simulated agent that answers with a `LOOP:` line. No AI credits.

**Acceptance Scenarios**:

1. **Given** an idle session and a loop started with *default delay 30 min, min 5, max 60, 12 passes, limit 50 AI credits*, **When** I press **Start loop**, **Then** the first pass is sent at once through the user's send path, and the chat shows the note "Loop pass 1 of 12". *(test:, sim:)*
2. **Given** pass 1 ends with `LOOP: next 25 min - waiting for CI`, **When** the turn ends, **Then** the next wake is 25 min later, and Schedules and the desk show "next 10:45 · waiting for CI · 1 of 12". *(test:, sim:)*
3. **Given** a reply asks for `next 2 min` while the minimum is 5, **Then** the wake is set to 5 min, and the row says "asked 2 min, waited 5 (minimum)". The same happens above the maximum. *(test:)*
4. **Given** a reply ends with `LOOP: stop - all green`, **Then** the loop ends with "Stopped by the agent: all green" and nothing more is sent. *(test:, sim:)*
5. **Given** a reply has no `LOOP:` line, **Then** the loop's default delay applies, with the reason "the agent did not say". Two passes in a row with no line end the loop: "Stopped: the agent did not pace the loop". *(test:)* (Q3)

---

### User Story 2 - Never surprise spend, never wake into a wait (Priority: P1)

**Why this priority**: The constitution forbids surprise spend (III, IV) and requires an honest UI (VIII). A loop that runs unattended is exactly where spend can run away.

**Independent Test**: Unit tests with fake agent states, fake usage events and a fake clock.

**Acceptance Scenarios**:

1. **Given** a wake is due and the session is working (for example I am chatting with it), **Then** that pass is skipped, not queued, and recorded as "skipped: the agent was busy". The next wake is now + the last delay asked. *(test:)*
2. **Given** the session has a pending question or permission, **When** a wake is due, **Then** nothing is sent and the loop shows "Waiting for you". When the request is answered, the next wake is that moment + the last delay asked. It never fires at once and never in a burst. *(test:)*
3. **Given** the session is on a coffee break (spec 068) or has reached Durbar's spending cap (spec 011), **Then** nothing is sent. A coffee break holds the loop until the break ends, then waits the last delay asked. At Durbar's spending cap the loop pauses and resumes only when I press **Resume** (Q5). *(test:)*
4. **Given** the loop's own limit is reached (what its passes spent ≥ its cap), **Then** no further pass is sent and the loop ends with "Stopped: reached its limit". The pass that went over is not interrupted (same rule as 044 FR-015). *(test:)*
5. **Given** max passes or the end time is reached, **Then** the loop ends with that reason. *(test:)*
6. **Given** **Pause all schedules** is on, **Then** no loop pass is sent. When it is turned off, every loop waits its last delay again; nothing fires in a burst. *(test:)*
7. **Given** any pass, **Then** it runs in the session's current permission mode. A loop never changes the mode, never approves anything and never lifts a cap. *(test:, read:)*

---

### User Story 3 - See it, stop it, and it is gone after a restart (Priority: P1)

**Independent Test**: A simulator driver at 1440x900 and 1280x800 with 15 agents, plus unit tests on the restart rule.

**Acceptance Scenarios**:

1. **Given** a running loop, **Then** the desk shows a small loop chip (icon and word, not colour alone) with the next wake time. Its tooltip, and the line in Schedules, give the agent's last reason and "pass 3 of 12 · spent 4.20 of 50 AI credits". *(sim:)*
2. **Given** a running loop, **Then** the lobby Postbox lists its next wake like any scheduled run (PR #511). *(sim:)*
3. **Given** a running loop, **When** I click **Stop loop** (on the chip, in Schedules or in the chat) or press **Stop** during a pass, **Then** the loop ends at once; a pass in progress is stopped by the normal Stop. *(test:, sim:)*
4. **Given** I quit Durbar with a loop running, **When** I start it again, **Then** the loop is shown as "Ended when Durbar closed" with **Start again**, and nothing is sent until I press it. *(test:)*
5. **Given** any pass, skip, hold or end, **Then** the activity log (spec 052) has one row with the agent, the folder's base name, the app, the mode and a short redacted summary (for example "Loop pass 3 of 12 · next in 25 min: waiting for CI"). It never holds the prompt or the reply. *(test:)*

---

### User Story 4 - The agent paces the loop through a tool, on all three apps (Priority: P2, Phase 2)

The agent gets two tools, `schedule_next(minutes, reason)` and `stop_loop(reason)`, from a Durbar loop server that is given **only to a session with a loop running**. Copilot, Claude Code and Codex get the tools the same way, through each adapter's existing `mcpServers` option.

**Independent Test**: Unit tests on the loop server's tool handlers and the session binding, with a fake socket and a fake adapter. Adapter option tests show the server is present only on a looping session. No real session.

**Acceptance Scenarios**:

1. **Given** session A is looping, **When** its agent calls `schedule_next(25, "waiting for CI")`, **Then** A's next wake is set (clamped to A's limits), and the tool answers "Next pass at 10:45 (pass 2 of 12)". *(test:)*
2. **Given** sessions A and B, **When** A's agent calls a loop tool, **Then** only A's loop can change. No argument names a session; the binding is fixed per session (FR-031). *(test:)*
3. **Given** a session with no loop, **Then** it has no loop server and no loop tools. *(test:)*
4. **Given** a tool call with bad input (minutes not a number, not a whole number or out of range; a reason too long or with control characters), **Then** main refuses it or clamps it, and says so in the result. Nothing is executed through a shell. *(test:)*

---

### User Story 5 - The agent proposes a loop and I say yes (out of scope: owner Q8 (b))

**Acceptance Scenarios**:

1. **Given** a session with no loop, **When** the agent offers one (Q8), **Then** Durbar shows a card "The agent asks to loop this: about every 25 min, at most 12 passes, limit 50 AI credits" with **Start loop** and **No** (No has the focus). Nothing loops until I click Start. *(test:, sim:)*

### Edge Cases

- **The session ends or is removed:** the loop ends ("the session has ended"). It is never moved to another session (same rule as 044 FR-014).
- **The folder is removed:** its loops are removed with its schedules (044, `removeFolder`).
- **A `LOOP:` line inside a quote or a code block, or the line repeated:** only the **last non-empty line of the last final assistant message of the pass** counts. A line from a sub-agent (`agentId` set) never counts.
- **The user sends a message between passes:** that turn is not a pass. Its spend and any `LOOP:` line do not count. If it is still running when a wake is due, the pass is skipped (busy).
- **The user sends a message during a pass:** the spend still counts toward the loop until the turn ends (044 FR-015 over-counts on the safe side).
- **The app does not report spend in the cap's unit** (`capUnitOf` undefined, `schedules.ts:189`): the loop can still start, bounded by passes and the end time, and says "This app does not report what a pass costs; the loop is bounded by passes and time only" (Q4).
- **The computer sleeps through a wake:** on wake there is no catch-up. If the end time has passed, the loop ends. Otherwise one pass runs (the next timer tick), then normal pacing continues. 044's `[KNOWN GAP]` on sleep and wake applies.
- **Clock or time-zone change:** delays are durations (minutes from the end of a pass), not wall-clock times. Daylight saving does not matter.
- **50 schedules already exist:** starting a loop is refused with 044's message ("At most 50 schedules."). Each loop counts as one schedule.
- **Two loops on the same session:** refused: one loop per session.
- **A loop on a helper (sub-agent):** not offered. Loops are for main sessions only.
- **Simulator (`DURBAR_SIM`):** loops run against simulated agents in the window, like 044 FR-018.
- **Prompt injection:** a web page or tool result may tell the agent to "loop every minute forever". This is bounded: the minimum delay, max passes, end time and credit cap hold whatever the agent asks. Nothing the agent says can change the limits, the mode or the target.

## Requirements *(mandatory)*

### Functional Requirements

**Loop as a schedule (R1)**

- **FR-001** `[PLANNED]` A loop is a `Schedule` (spec 044) with a `loop` field. It needs a session `target` (FR-014) and a `prompt` (at most 2,000 characters). It is stored in `durbar-schedules.json`, counts toward `MAX_SCHEDULES`, and uses the same `Scheduler`, its single timer and its `send` path. No second scheduler, timer list or store.
- **FR-002** `[IMPLEMENTED]` (test: `scripts/test-schedules.ts`) `loop` holds the user's limits: `minDelay`, `maxDelay`, `defaultDelay` (minutes), `maxPasses`, `endAt` (epoch ms), and the optional `cap` that 044 FR-015 already defines. It also holds main's own state, which is never taken from the renderer: `passes`, `inPass`, `lastAsk` {`minutes`, `reason`, `source`: `agent` | `default` | `clamped`}, `noPaceStreak`, `hold` (not saved), and `ended` {`at`, `reason`}.
- **FR-003** `[IMPLEMENTED]` (test: `scripts/test-schedules.ts`) Limits, checked in main:
  - `minDelay` is at least 5 (the 044 floor);
  - `maxDelay` is at most 1440;
  - `minDelay` ≤ `defaultDelay` ≤ `maxDelay`;
  - `maxPasses` is from 1 to 100;
  - `endAt` is later than now and at most 24 h after the start;
  - the cap uses 044 FR-017's ranges.

  Defaults (Q1, Q2): 30 / 5 / 60 min, 12 passes, end 8 h after the start, cap 50 AI credits or $0.50.
- **FR-004** `[IMPLEMENTED]` (test: `scripts/test-schedules.ts`, `scripts/test-loops.ts`) A loop has no `every`, `at` or `rule`. Its `next` is set only by FR-010/FR-011 from the end of a pass, or by a hold being released (FR-015). `dueAt` returns `undefined` while a pass is in progress or the loop has ended. A loop never wakes later than its `endAt`, held or not (`dueAt` is at most `endAt`; a held loop wakes at `endAt`), so a loop past its end time ends with "reached its end time" and does not stay shown as running. A send in flight when Pause, Resume or an edit replaces the schedule acts on the current copy, and only if it is still the same pass.

**Start and stop (R2, R4)**

- **FR-005** `[PLANNED]` A loop starts only from a user action:
  - **Loop this…** in the session's card/mode menu (beside *Plan first*, `app.js:3191`), or
  - the Schedules dialog opened from that session's chat (`schedHdrBtn`, `app.js:1421`), kind **Loop**.

  Both open the same form: the prompt (taken from the composer if there is text), the limits with their defaults, and a one-line summary of the worst case ("at most 12 passes, at most 50 AI credits, ends by 18:30"). **Start loop** saves the loop and sends pass 1 at once if the session is idle. Otherwise the first wake is in `minDelay`.
- **FR-006** `[PLANNED]` Passes keep the session's permission mode. A loop never sets or raises the mode, approves pending requests, keeps grants or lifts a cap. The pass goes through `scheduleDeps.send` (`main.ts:444-477`), the same as a scheduled prompt.
- **FR-007** `[PLANNED]` **Stop loop** is on the desk chip, in the Schedules row (dialog and Settings) and in the chat. It ends the loop at once (`ended.reason: 'user'`). The session's own **Stop** during a pass also ends the loop. **Stop** on a turn the user sent between passes stops only that turn; the loop goes on. **End session**, removing the session or removing the folder ends it ("the session has ended").
- **FR-008** `[IMPLEMENTED]` (test: `scripts/test-loops.ts` (core: `start()` and `restartLoop`; the Start again form is T011)) When the app starts (`Scheduler.start`), every loop that had not ended is marked ended "when Durbar closed". Nothing is sent. The row offers **Start again**, which opens the form with the old limits and starts a new run (passes and spend from zero) only when the user confirms. A loop is never resumed by itself after a restart.
- **FR-009** `[IMPLEMENTED]` (test: `scripts/test-loops.ts` (`loopFooter`; appended in `send` by T006)) Each pass's prompt is the user's prompt plus a fixed, short **loop footer** written by Durbar (not user-editable, at most 400 characters). It tells the agent:
  - the pass number;
  - the limits;
  - how to ask for the next wake: Phase 1 the `LOOP:` line, Phase 2 the tools;
  - that it should stop when the work is done.

  The footer never holds a path, a secret or text from outside the app.

**Pacing (R5)**

- **FR-010** `[IMPLEMENTED]` (test: `scripts/test-loops.ts` (parser; main feeding the final text is T006)) **Phase 1: the reply line.** When a pass's turn ends (`idle`, `error` or `stopped` for that session, the same events as `turnEnded`), main reads the last non-empty line of the last `output` event with `final: true` and no `agentId`, seen during that pass. Accepted forms (case-insensitive, at most 200 characters):
  - `LOOP: next <N> min[utes] [- <reason>]`;
  - `LOOP: next <H> h[ours] [- <reason>]`;
  - `LOOP: stop [- <reason>]`.

  The line may be wrapped in `**...**`, `*...*` or backticks and may end with a full stop (models do this); the 200 characters count the wrapping. Anything else is "no line". The parser is pure and has no shell and no regular expression with catastrophic backtracking. The reason is cleaned to one line of at most 120 characters (bidi and zero-width characters removed, controls turned into a space, whitespace collapsed and redacted before the cut) and passed through `redact()` before it is shown or logged.
- **FR-011** `[IMPLEMENTED]` (test: `scripts/test-loops.ts`) The next wake = the end of the pass + the asked delay, clamped to [`minDelay`, `maxDelay`]. The monotonic backstop (a wall-clock jump never shortens the minimum) also counts from the end of the pass, not from the send. A clamped ask is recorded with `source: 'clamped'` and shown ("asked 2 min, waited 5"). `stop` ends the loop with `ended.reason: 'agent'` and the agent's reason.
- **FR-012** `[IMPLEMENTED]` (test: `scripts/test-loops.ts`) A pass with no line (or, in Phase 2, no tool call) uses `defaultDelay` with the reason "the agent did not say". Two such passes in a row end the loop: "Stopped: the agent did not pace the loop" (Q3). A pass that ends in `error` (FR-013) counts only toward the error streak: it neither adds to nor resets this no-line streak.
- **FR-013** `[IMPLEMENTED]` (test: `scripts/test-loops.ts`) A pass that ends in `error` counts as a pass. The loop waits `defaultDelay`. Two errors in a row end the loop: "Stopped after two failed passes".

**Holds and skips (R3, the 044 busy rule)**

- **FR-014** `[IMPLEMENTED]` (test: `scripts/test-loops.ts`) A wake that finds the session **working** skips the pass (never queued). It is recorded as `skipped-busy`, and the next wake is now + the last asked delay (clamped). A skip does not count as a pass.
- **FR-015** `[IMPLEMENTED]` (test: `scripts/test-loops.ts` (core and the `waitOf` dep; reading `agentState` is T006)) A wake that finds the session **waiting for a person**, or a person-wait that starts between passes, puts the loop **on hold**. A person-wait means: a pending permission (`needs-permission`), an open question (agentstate `question`), or a credit-limit request (agentstate `limit`). On hold, `dueAt` is undefined and the desk shows "Loop waits for you". When the wait clears, the next wake is that moment + the last asked delay. Nothing fires at once.
- **FR-016** `[PLANNED]` **Coffee break** (spec 068, a `usageLimit` event): the loop is on hold until the break ends. A pass is never sent into a break. If 068's own resume message goes out, the loop's next wake is counted from the end of that turn. Main reads the normalized `usageLimit` event itself and holds the loop there, so main stays the one place that enforces limits (R5); it does not wait for the renderer's `coffeebreak.js`. Depends on PR #462 being merged.
- **FR-017** `[IMPLEMENTED]` (test: `scripts/test-loops.ts` (the `waitOf` dep returns `cap`; main computing it is T006)) **Durbar's spending cap** (spec 011 `limit` exhausted, the Bank in PR #511): the loop pauses (`pausedReason: 'cap'`, the 044 wording) and continues only on the user's **Resume** (Q5).
- **FR-018** `[IMPLEMENTED]` (test: `scripts/test-loops.ts`) **The loop's own cap** (044 FR-015 attribution): when `spent` ≥ `cap.amount` at the end of a pass or at a wake, the loop ends: "Stopped: reached its limit". **Max passes** and **end time** end it the same way, each with its reason. These are ends, not pauses: a new run needs **Start again**.
- **FR-019** `[IMPLEMENTED]` (test: `scripts/test-loops.ts`) **Pause all schedules** also holds every loop. When it is turned off, each loop's next wake is now + its last asked delay (no burst, like `setPausedAll`, `schedules.ts:386-394`).

**Visible (R4)**

- **FR-020** `[PLANNED]` Desk chip on a looping main agent:
  - a loop icon plus the word "Loop" and the next wake time ("Loop · 10:45"), or a hold word ("Loop · waits for you", "Loop · on a break");
  - in compact densities, the icon only, with the same text in its `title` and `aria-label`;
  - at least 10.5 px; 15 agents still fit at 1440x900 and 1280x800 with the chat closed and open (constitution V);
  - a click opens the loop's row in Schedules.
- **FR-021** `[PLANNED]` Schedules (the folder dialog and Settings > Schedules) show a loop row: the prompt (cut), "loop on <session name>", the next wake and its reason, `source`, "pass N of M", the spend "of" the cap, the end time, and the end reason once it has ended. The buttons are **Stop loop** while running, and **Start again** and **Delete** once ended.
- **FR-022** `[PLANNED]` The lobby Postbox (PR #511) lists a loop's next wake like any scheduled run, labelled "loop". A wake that fires flies a letter like a scheduled run.
- **FR-023** `[PLANNED]` The chat shows one calm note per pass: "Loop pass 3 of 12", and after the pass "Next pass at 10:45: waiting for CI" or "Loop stopped: <reason>".
- **FR-024** `[PLANNED]` Activity log (spec 052): new decisions `loop-start`, `loop-pass`, `loop-skip`, `loop-hold`, `loop-end`. One row each, recorded in main. The action holds the pass number, the next delay and the cleaned reason, never the prompt or the reply.

**Phase 2: tools on a per-session loop server (US4)**

- **FR-030** `[PLANNED]` A **loop server** (reserved name `durbar-loop`) exposes exactly two tools:
  - `schedule_next` {`minutes`: integer 1-1440, `reason`: string ≤ 120};
  - `stop_loop` {`reason`: string ≤ 120}.

  It has no other tool, and no tool that reads the office, changes settings, starts sessions or sends prompts. It is **not** spec 041's server: it has its own flag, its own socket name and no 041 switch. 041 FR-030 still holds for 041's server. A spec delta in 041 records the difference.
- **FR-031** `[PLANNED]` **One session only.**
  - Durbar adds the loop server to a session's `mcpServers` only while that session has a running loop (Q7 decides how a live session gets it).
  - Each session gets its own random 256-bit token, kept in main's memory. The token is **never** put in `McpServerSpec.env` or `args`: on Claude Code's CLI transport those become the `--mcp-config <json>` command-line argument (`claude.ts:163`, `:241`), which any local user can read with `ps` or `/proc/<pid>/cmdline`.
  - Instead main writes the token to a per-loop file with mode 0600 inside a per-run folder with mode 0700 under Durbar's user-data folder (on Windows, Node cannot set an ACL, so the file relies on the per-user ACL that `%APPDATA%`, where Durbar's user-data folder lives, already inherits: the user, SYSTEM and Administrators; `[KNOWN GAP]` not checked on a real Windows profile, and a profile moved outside `%APPDATA%` with `DURBAR_USER_DATA` gets whatever that folder inherits). Only that file's **path** goes into the server spec. The helper reads the token from the file at start. The file is deleted when the loop ends, and the folder is emptied at launch.
  - The token is never logged or shown. A test checks, for all three apps, that the token is not in the built `mcpServers` config, the CLI argv (`--mcp-config`) or Codex's `thread/start` config.
  - Main maps token to session. A tool call can only affect the loop of the session its token belongs to.
  - Tool arguments never name a session.
  - The token is dropped when the loop ends.
- **FR-032** `[PLANNED]` All input is validated in main (types, integer, ranges, length, one line). An out-of-range `minutes` is clamped as in FR-011, and the result says so. A call with no running loop answers "No loop is running in this session" and starts nothing. There is no shell; the server process is Durbar's own executable with a fixed flag and fixed arguments.
- **FR-033** `[PLANNED]` (owner, Q6 (b)) The loop tools are ordinary MCP calls for the permission broker: denied in Read-only, asked in Ask first, allowed in Allow all. No broker exception. A loop in Read-only is paced only by the reply line (FR-010..FR-012), which needs no permission. A user's own MCP extra or Copilot CLI entry with the name `durbar-loop`, or one that points to the loop helper, is refused or disabled, as 041 FR-031/FR-032 do for `agent-durbar`.
- **FR-034** `[OUT OF SCOPE]` (US5; owner Q8 (b): loops start only from the user's menu; kept here for a later decision) A `schedule_next` call in a session without a loop shows an offer card with the proposed delay and the default limits. **No** has the focus. Only **Start loop** starts it. A refusal is remembered for that session until it ends, so the agent cannot re-ask on every turn.
- **FR-035** `[PLANNED]` In Phase 2 the reply line of FR-010 stays as a fallback. A tool call during a pass wins over a reply line in the same pass.

**Simulator and tests (constitution IV)**

- **FR-040** `[PLANNED]` The simulator has loops: simulated agents answer a loop pass with a `LOOP:` line (next N, stop, none, or a request below the minimum), so the dialog, chip, Postbox and holds can be checked with no credits.
- **FR-041** `[PLANNED]` Unit tests use a fake clock, a fake sender and scripted events. No real agent session, no `npm run smoke`, no `capture-raw.ts`.

### Key Entities

- **Loop** (a `Schedule` with `loop`): one session, one prompt, the limits (min/max/default delay, max passes, end time, cap), and main's state (passes, in pass, last ask, hold, end).
- **Pace request**: what the agent asked at the end of a pass: `next` with minutes and a reason, `stop` with a reason, or none. Its source is the reply line or (Phase 2) a tool call.
- **Loop token** (Phase 2): a random per-session secret in main's memory that binds a loop-server connection to one session.

## Success Criteria *(mandatory)*

- **SC-001**: A user can start a loop on a session in under a minute, with the default limits, from the chat.
- **SC-002**: Under any sequence of agent requests (fuzzed in a unit test, including "next 0", "next 1", "next 99999" and no line at all), no loop sends more than `maxPasses` passes, two passes closer than `minDelay`, or a pass after `endAt` or after its cap is reached.
- **SC-003**: No pass is ever sent while the session is working, waits for a person, is on a coffee break or is at Durbar's cap. Nothing is sent twice, and no pass is sent after a restart without the user's click.
- **SC-004**: In Phase 2 a loop tool call from session A never changes session B's loop (unit test with two sessions and swapped tokens).
- **SC-005**: Every pass, skip, hold and end has exactly one activity row and one visible reason (desk or Schedules).
- **SC-006**: 15 agents with 5 loops fit at 1440x900 and 1280x800, chat closed and open, with no overlap (`check:office`).

## Phases

- **Phase 1** (no spec 041, no MCP): FR-001..FR-024 and FR-040/FR-041.
  - The loop is a schedule kind, started by the user, paced by the `LOOP:` reply line, with every limit, hold and visible state.
  - It is useful on its own and works the same on Copilot, Claude Code and Codex, because it reads only normalized `output` and `status` events.
  - It needs no permission change: a reply line is not a tool call.
  - FR-016 (coffee break) and FR-022 (Postbox) wait for PRs #462 and #511. Until they land, those tasks stay open and the rest ships.
- **Phase 2** (per-session tool): FR-030..FR-035.
  - It reuses spec 041's merged building blocks (`jsonrpc.ts`, `protocol.ts` `McpSession`, `connection.ts` limits, the `tools.ts` registry pattern, `paths.ts`). It does **not** need 041's server host (T017) or its Settings switch.
  - It needs a stdio relay inside Durbar's executable. That is the same kind of code as 041 T018 (bridge, not built), so the two should share one pure relay core, written once by whichever lands first (coordination with spec 041's owner, Ruben).
  - Owner decisions: Q6 (b) no Read-only exception, Q7 (a) only looping sessions get the server.
- **Later, out of scope**: wakes on an event (a PR comment, a CI result) instead of a delay; quiet hours (Q9); loops on a folder's agent rather than one session.

## Assumptions

- A pass is one prompt and the turn it starts. The session keeps its own history between passes; Durbar adds only the footer.
- The `LOOP:` line stays visible in the chat. It is the agent's own words, and hiding it would hide why the loop waits.
- Agents follow the footer's instruction most of the time. FR-012 and the limits cover the rest. How often each app's models really end with the line is **unverified** until the real check (T040).
- 044's single timer handles many short loop wakes. The 50-schedule cap bounds it.

## Honest limits and gaps (to keep in the README when built)

- `[KNOWN GAP]` (T006) **Usage after `idle`.** The scheduler keeps a running loop's attribution of the session's `usage` events after the pass ends, until the next pass starts or the loop ends (`turnEnded` does not clear it for a loop; test: `scripts/test-loops.ts`). Over-counting is accepted: anything the session spends between passes, including the user's own turns, counts toward the loop's cap. What is not verified is the order of `usage` and `idle` per adapter (Copilot, Claude, Codex). T006 must route every `usage` event of the loop's session to `noteUsage` (also when it arrives after `idle`) and check the order per adapter; a spend that only arrives after the next pass has started is counted for that next pass. Related: late usage of the **final** pass (it arrives after the loop has ended) is attributed to the session but is not shown in the ended loop's spend; T006 must decide whether to add it to the `ended` spend.
- `[KNOWN GAP]` The spend of a pass is known only from the app's `usage` events. A pass that starts under the cap can end over it, and Claude's dollar figure is an estimate (044 FR-015, spec 012 FR-150).
- `[KNOWN GAP]` Phase 2 token secrecy is best effort against the **same** OS user. Other local users cannot read it: it is never on a command line or in an environment variable, and its file is mode 0600 in a 0700 folder (FR-031). Another process of the same OS user (for example an agent in Allow all with a shell) could read it. The damage is bounded: it can only re-pace or stop that one loop, within its limits. This is the same same-user limit 041 states in FR-035.
- `read:` `busyStatus` (`main.ts:443`) may not count a pending question or a credit-limit request as busy. This spec uses the agentstate flags instead. Whether spec 044 has a real gap there is **unverified**; worth a separate check.
- Not verified on any real session: how each app's model follows the footer; whether Codex and Claude Code accept a new MCP server on a live session without a restart (Q7).

## Cost of verification (constitution IV)

- Development and CI: zero credits (unit tests, simulator, simulator driver).
- One later real check per app, only with the owner's OK (T040, T041). A loop with `minDelay` 5, 2 passes, a tiny read-only prompt ("Reply with one line: LOOP: next 5 min - test", then "LOOP: stop - test").
  - Estimate from 044's real runs: Copilot free plan about 0.16 AI credits per pass, about 0.4 AI credits for the check; Claude Code `haiku` about $0.005 per pass, about $0.01; Codex: no recorded figure, expected a few cents at most (**unverified**).
  - Each check takes at least 5 minutes of wall time.
  - Phase 2 repeats this with the tool instead of the line: the same cost again.

## Owner answers (Paco, 2026-10-22)

- **Q1 Delays (default / min / max):** (a) 30 / 5 / 60 min; the user may raise the max up to 1440 per loop.
- **Q2 Passes, end time, cap:** (a) 12 passes, end 8 h after the start, cap 50 AI credits or $0.50, all required and editable within FR-003.
- **Q3 A pass with no pace request:** (a) wait the default delay once; two passes in a row with no request end the loop (FR-012).
- **Q4 Apps that report no spend in the cap's unit:** (a) allow the loop, bounded by passes and end time, with a clear note in the form and the row.
- **Q5 After Durbar's spending cap:** (a) the loop pauses and needs **Resume**; raising the cap does not restart it (FR-017).
- **Q6 Phase 2 tool calls in Read-only:** (b) the loop tools are ordinary MCP calls (denied in Read-only, asked in Ask first); no broker exception (FR-033). A Read-only loop is paced by the reply line.
- **Q7 How a live session gets the loop server (Phase 2):** (a) only looping sessions get it; starting a loop on a live session restarts it with the server (as spec 058's *Restart session with these servers*), refused while busy.
- **Q8 May the agent propose a loop:** (b) no, loops start only from the user's menu. US5, FR-034 and T038 are out of scope.
- **Q9 Where "Loop this…" lives, and quiet hours:** (a) the session's card/mode menu (beside *Plan first*) and the chat's Schedules dialog, one shared form; quiet hours later.

## Changes

### 2026-10-31: a pass uses its schedule's mode (open for the owner; spec 044 FR-180)

The owners' ruling that a schedule has its own mode reaches loops, which are schedules: spec 044's *Open, proposed* has a loop use the field per pass for Read-only, Ask first and Allow all, with no Autopilot on a loop. If the owner keeps that, FR-006 and R2 ("passes keep the session's permission mode") are replaced by it. Built on the Scheduler only (spec 044 T143); loops stay off in this build (`loopSupport`).

### 2026-10-29: index status text kept from before the fixed status words (spec 021 FR-063)

The `status:` of the specs-index block used to read (moved here unchanged; the block now has one status word and a short note):

> **Phase 1 foundation built** (T001-T005: pace parser, `Schedule.loop`, scheduler core, holds, restart; unit tests only, loops refused by `save` until T006 wires them; no UI yet); owner answered Q1-Q9 2026-10-22 (Q6 (b): no broker exception); Phase 1 needs no spec 041

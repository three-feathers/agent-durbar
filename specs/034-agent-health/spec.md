# Feature Specification: Agents show how they are doing (context size, trouble signals, serious mode)

**Feature Branch**: `034-agent-health` (amends 001 office view; reads 011 caps, 019 context, 003 permissions)
**Created**: 2026-10-17
**Status**: Built 2026-10-17 (issue #20): T001-T008 done; unit tests (`test:mood`, `test:credits`), simulator driver `scripts/shots-034.js` at 1440x900 and 1280x800, `check:office` 105/105. Not checked on a real Copilot session (0 AIU).
**Input**: Ruben (issue #20, from the ideas discussion): the agent figure gets bigger as its context window fills and turns into a grumpy monster near the limit (a "start a fresh session" signal); trouble gets its own visual: an ambulance when a session errors or dies, the agent faints at its credit cap, looks dizzy after several failed tool calls, taps the desk when it has waited too long for approval. Guardrails from the issue: the figure never grows past its desk or card, at most one ambulance at a time, text and percentage stay, a "serious mode" switch turns it all off, no effect on the density fit.

## Clarifications (Ruben, 2026-10-17)

- **Q: How does the figure follow the context window?** **Three steps, the same as the context chip** (spec 019): normal below 70%, **heavy** (bigger, sweating) from 70% to 90%, **grumpy monster** above 90%.
- **Q: What does the monster look like?** **The same figure, "monsterised"**: green-grey skin, two small horns, a frown and messy hair, flat like the rest of the office, no animation. The agent stays recognisable.
- **Q: The ambulance?** **Parked next to the desk**, a small ambulance with a gentle blinking light. **At most one at a time**: the agent with the most recent error gets it; others keep today's error state.
- **Q: Serious mode?** **Fun on by default**; Settings has a **Serious mode** switch, saved, that turns every drawing of this feature off. With `prefers-reduced-motion` nothing moves, but the drawings stay.
- Decided by default and recorded here (open to change in review):
  - **Dizzy** after **3 failed tool calls in a row** (main agent only); a successful tool call or the end of the turn clears it.
  - **Impatient** (taps the desk) when a permission request has waited **60 s or more**; the time comes from the event's timestamp when it is plausible (not in the future, not older than a day), else from when the window received it.
  - **Faint** while the credit limit is reached (spec 011 *Limit reached*).
  - **Priority** when several apply: ambulance (error) > faint (limit) > impatient > dizzy. The context step (normal, heavy, monster) is the body and combines with any of them.
  - **Small densities**: the same rules in the compact desk scenes (`card`, `mini`, `micro`); the drawings scale with the scene, so nothing grows past the scene box. Helpers (sub-agents) stay as they are.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See at a glance which agent needs a fresh session (Priority: P1)

**Independent Test**: on the simulator, agents whose context is 70-90% look heavy and those above 90% look like monsters; the context chip in the chat header still shows the percentage.

**Acceptance Scenarios**:

1. **Given** an agent at 65% of its context window, **Then** it looks as today.
2. **Given** 75%, **Then** it is heavy (wider body, a sweat drop) inside the same scene box.
3. **Given** 93%, **Then** it is the grumpy monster (green-grey, horns, frown) inside the same scene box; its card's accessible label and tooltip add "context nearly full (93%)".
4. **Given** an unknown context window (no event yet, or limit 0), **Then** it looks as today.

### User Story 2 - Trouble is visible without reading (Priority: P1)

1. **Given** an agent in Error, **Then** a small ambulance is parked by its desk; **given** two agents in Error, **Then** only the most recent one has the ambulance.
2. **Given** an agent at its credit limit (*Limit reached*), **Then** it has fainted (lying back, eyes closed).
3. **Given** a permission request waiting 60 s or more, **Then** the agent taps the desk (impatient); before 60 s it waits as today.
4. **Given** 3 failed tool calls in a row, **Then** the agent is dizzy (little stars); a successful call clears it.
5. In every case the card text, the status pill and the percentage stay as today, and the accessible label names the trouble ("needs help: error", "fainted: credit limit reached", "impatient: waiting 2 min for you", "dizzy: 3 failed tool calls in a row").

### User Story 3 - Serious mode (Priority: P2)

1. **Given** Settings > Serious mode on, **Then** every figure looks as today (no heavy, monster, ambulance, faint, dizzy or impatient drawing) and the choice is kept after a restart.
2. **Given** `prefers-reduced-motion`, **Then** the drawings stay but nothing blinks or moves.

### Edge Cases

- An agent leaves Error (new turn): the ambulance goes; if another agent is still in Error, the ambulance moves to the most recent of them.
- The context window shrinks (compaction, a new model with a larger window, spec 030): the body follows the new percentage at once.
- An agent at a place in the lobby (spec 024): its desk shows the empty chair as today; the walking figure is not changed by this feature.
- Demo mode (sample data): the rules apply only to what the sample data says (no context events: normal bodies).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** `[IMPLEMENTED]` Pure `src/renderer/mood.js` (UMD): `bodyOf(ctxPct)` → `normal | heavy | monster` (70 and 90 like `ctxLevel`); `troubleOf({state, ambulance, limit, waitingMs, failStreak})` (`ambulance`: this agent got the single ambulance) with the priority above; `pickAmbulance(agents)` → the id of the agent in Error with the latest error time, or none; a tracker `createMoodTracker({now})` with `onTool(id, e)` (`failed` → streak + 1, `complete` → 0; a call that only starts changes nothing, because calls start before they fail; found in analyze), `onStatus(id, status)` (error time; end of turn clears the streak), `onPermission(id, p, ts)` (pending since, cleared when resolved; a pending request also arrives inside a `needs-permission` status event), `waitingMs(id)`, `failStreak(id)`.
- **FR-002** `[IMPLEMENTED]` Scene drawing (`scene()` in `app.js`, every density): a heavy body (wider torso and a sweat drop) and a monster variant of the same figure (green-grey skin, two horns, frown, messy hair) inside the existing viewBox; trouble overlays: ambulance (small, parked by the desk, light blinks unless reduced motion), faint (leaning back, closed eyes), dizzy (three small stars), impatient (hand tapping the desk). The scene cache key includes body and trouble. Nothing changes the size of the scene box or the card.
- **FR-003** `[IMPLEMENTED]` Card text: the accessible label and tooltip add the context phrase from 90% and the trouble phrase (User Story 2.5); the visible text is unchanged.
- **FR-004** `[IMPLEMENTED]` Serious mode: `seriousMode` in the app settings file (spec 011/024 settings store), IPC `settings:setSeriousMode(bool)`, a switch in Settings; when on, `bodyOf`/`troubleOf` are not applied. Default off (fun on).
- **FR-005** `[IMPLEMENTED]` Calm: at most one ambulance; `prefers-reduced-motion` disables the blink and the dizzy/impatient animation; text at least 10.5px; `npm run check:office` stays green at 1440x900 and 1280x800 with 15 agents (no layout change).
- **FR-006** `[IMPLEMENTED]` Simulator: agents whose context is in the heavy and monster bands; one agent with 3 failed calls in a row; query parameter `simwaitold=1` stamps the waiting permission requests 2 minutes in the past so "impatient" can be seen without waiting.
- **FR-007** `[IMPLEMENTED]` Tests, no credits: `scripts/test-mood.ts` (bands at 69/70/90/91, unknown context, priority order, one ambulance and its hand-over, streak reset, waiting time from timestamps incl. future and very old ones, serious mode); settings tests for `seriousMode`; screenshots with every state at both sizes and one with Serious mode.

### Key Entities

- **Mood**: body (`normal | heavy | monster`), trouble (`null | ambulance | faint | impatient | dizzy`).
- **MoodTracker state** per main agent: failed-call streak, pending-permission since, last error time.

## Success Criteria *(mandatory)*

- **SC-001**: On the simulator every state above can be seen at 1440x900 and 1280x800 with 15 agents and `npm run check:office` passes.
- **SC-002**: Serious mode on: every figure looks as on `main` before this feature (pixel-level difference not required; no extra drawing element present).

## Assumptions

- Context, errors, limit and permission events already reach the renderer (specs 011, 019, 003); no adapter or main-process change beyond the settings switch.
- Coordination: spec 033 (floors, another contributor) changes the room model in `app.js`; this feature only changes the desk scene and card text, so overlap is expected to be small.
- Out of scope: sounds, a drive-in ambulance animation, helpers' moods, real-session verification.

## Verification (phase 3, 2026-10-17)

- `test:` `scripts/test-mood.ts` (bands, priority, one ambulance and its hand-over, streak, waiting time from timestamps), `scripts/test-credits.ts` (`seriousMode`). Mutation check: 19 deliberate breaks of `mood.js` and 4 of the settings code, each fails a test.
- `sim:` `scripts/shots-034.js` at 1440x900 and 1280x800: heavy and monster with their words, exactly one ambulance and its hand-over to a newer error and back, faint at the limit (no waving), impatient only with `simwaitold=1`, dizzy after 3 failed calls and cleared by a successful one, Serious mode on (no drawing, no words) and off, reduced motion (nothing animates), the `mini` density, every scene box the same size. `check:office` 105/105.
- Fixed in review: "impatient" now counts only while the figure is in Waiting (a request answered elsewhere without a `permission` event must not leave it tapping); a fainted agent no longer waves; the faint tilt turns around the neck (`.scene *{transform-box:fill-box}` moved the head down to the chest).
- `[KNOWN GAP]` An agent away at a place (spec 024) shows an empty chair, so its mood drawing is hidden (the walking figure is not changed, as specified); the card words stay. In the simulator Sven is dizzy but away, so the driver makes another agent dizzy with `window.__durbarSimEmit`. Tested in the driver; follow-up T009.
- `[KNOWN GAP]` The List view has no mood words (the spec covers the office cards). Follow-up T009.
- `[KNOWN GAP]` Not run on a real Copilot session: the events it reads (`status`, `toolCall`, `permission`, context, limit) are the ones the adapter already sends (specs 003, 011, 019).

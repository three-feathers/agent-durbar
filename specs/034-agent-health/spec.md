# Feature Specification: Agents show how they are doing (context size, trouble signals, serious mode)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 034
title: The figure follows the context window (heavy 70-90%, grumpy monster above 90%), trouble signals (ambulance, faint, dizzy, impatient), Serious mode
status: **built** 2026-10-17 (issue #20): simulator and unit tests, `scripts/shots-034.js`; not checked on a real session; T009 built 2026-10-19: List view mood words and the walking figure's mood (FR-014/FR-015, `scripts/shots-034-list.js`); delta 2026-10-17 *rooms darken with their worst agent, sirens* (issue #135) **built** (simulator, `scripts/shots-034.js`; T015 room path contrast done too); delta 2026-10-23 *Retrying while the agent app retries the model API* (issue #600) **built** (simulator `simretry=1`, `scripts/shots-034-retry.js`, `test:retry`; vendor shapes read only, no real retry seen)
-->

**Feature Branch**: `034-agent-health` (amends 001 office view; reads 011 caps, 019 context, 003 permissions)
**Created**: 2026-10-17
**Status**: Built 2026-10-17 (issue #20): T001-T008 done; unit tests (`test:mood`, `test:credits`), simulator driver `scripts/shots-034.js` at 1440x900 and 1280x800, `check:office` green (105/105 before spec 033 floors added its cases). Not checked on a real Copilot session (0 AIU).
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
- An agent in a hidden folder or on a floor that is off (spec 033): it never takes the ambulance, so the one ambulance is always on screen (added 2026-10-17 when merging spec 033).
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
- `sim:` `scripts/shots-034.js` at 1440x900 and 1280x800: heavy and monster with their words, exactly one ambulance and its hand-over to a newer error and back, faint at the limit (no waving), impatient only with `simwaitold=1`, dizzy after 3 failed calls and cleared by a successful one, Serious mode on (no drawing, no words) and off, reduced motion (nothing animates), the `mini` density, every scene box the same size. `check:office` 105/105 (before the merge with spec 033).
- Fixed in review: "impatient" now counts only while the figure is in Waiting (a request answered elsewhere without a `permission` event must not leave it tapping); a fainted agent no longer waves; the faint tilt turns around the neck (`.scene *{transform-box:fill-box}` moved the head down to the chest).
- Merged with spec 033 (floors): the ambulance is chosen among agents whose room is shown (not hidden, floor on); checked in the driver with `simfloors=1&floorsoff=Client A`.
- `[KNOWN GAP]` An agent away at a place (spec 024) shows an empty chair, so its mood drawing is hidden (the walking figure is not changed, as specified); the card words stay. In the simulator Sven is dizzy but away, so the driver makes another agent dizzy with `window.__durbarSimEmit`. Tested in the driver; follow-up T009.
- `[KNOWN GAP]` ~~The List view has no mood words~~ Closed 2026-10-19 by FR-014. The walking figure shows its mood too since FR-015 (2026-10-19).
- `[KNOWN GAP]` Not run on a real Copilot session: the events it reads (`status`, `toolCall`, `permission`, context, limit) are the ones the adapter already sends (specs 003, 011, 019).

## Changes

### 2026-10-17: rooms darken with their worst agent, sirens (issue #135)

**Input**: Ruben, after PR #134: "la habitación también vaya cambiando de color a más oscuro para que sea más evidente, y con sirenas cuando ya sea súper evidente". Trouble should be visible from across the office, not only at the desk.

#### Clarifications (Ruben, 2026-10-17)

- **Q: What makes a room darker?** **Its worst agent.** One room, one tone, taken from the main agent that is doing worst (helpers are not counted, as in the rest of this spec).
- **Q: How does it darken?** **The room's own colour, darker** (sage, blue, sand, clay stay recognisable): a little darker when the worst agent is heavy, clearly darker when it is a monster or in trouble.
- **Q: The sirens?** **A small light next to the room name** that blinks red/blue, and the same light on the door plate when the room is closed. *(Amended 2026-10-20 by spec 052 FR-069: the light breathes slowly in red for about 10 s, then stays on; no red/blue strobe. Same for the ambulance light.)*
- **Q: When do the sirens come on?** **While the room has the ambulance or a fainted agent** (the two strongest signals of this spec).
- Decided by default and recorded here (open to change in review):
  - **Tone steps**: `calm` (every agent normal and without trouble: the room looks as today), `uneasy` (worst agent heavy), `alarm` (a monster, an agent in Error, or any trouble: ambulance, faint, impatient, dizzy). An agent in Error without the ambulance counts as `alarm` too.
  - **Closed rooms**: the door plate keeps its own status colours (spec 017); only the siren is added.
  - **Words**: the room's accessible label (open room section and door plate) adds "Alert: an agent needs help" while the siren is on; the tone itself is not spoken (each card already names its agent's state).
  - Serious mode turns tones and sirens off; reduced motion: the siren is shown but does not blink; a floor that is off (spec 033) or a hidden folder shows nothing, as before.

#### User scenarios

1. **Given** a room whose agents are all normal and without trouble, **Then** it looks as today.
2. **Given** a room whose worst agent is heavy (70-90%), **Then** its floor colour is a little darker, still its own colour.
3. **Given** a room with a monster, an agent in Error, or an agent fainted, impatient or dizzy, **Then** its floor colour is clearly darker.
4. **Given** the room has the ambulance, or a fainted agent, **Then** a small siren blinks next to its name (and on its door plate when closed); the room's label says "Alert: an agent needs help". When the ambulance moves to another room, the siren moves with it.
5. **Given** Serious mode, **Then** every room and plate looks as today. **Given** reduced motion, **Then** the siren does not blink.

#### Edge cases

- The worst agent gets better (new turn, compaction, limit raised): the room's tone follows at once (the same 5 s mood timer as the figures).
- An agent away at a place in the lobby still counts for its room (its mood is known even though its chair is empty).
- Text in the room header (path, usage total) keeps a contrast of at least 4.5:1 at every tone. It turns darker with the floor in a darkened room, and in calm rooms the path is a little darker than before (T015). The cards keep their own background.

#### Requirements

- **FR-008** `[IMPLEMENTED]` Pure `roomAlertOf(moods)` in `src/renderer/mood.js`: list of `{state, body, trouble}` of a room's main agents → `{tone: 'calm'|'uneasy'|'alarm', siren: boolean}` with the rules above; unknown or empty input → calm, no siren.
- **FR-009** `[IMPLEMENTED]` Open rooms (every density): `data-alert="uneasy|alarm"` on the room section and darker `--tint`/`--wall` per room colour in `styles.css`; the siren (small inline SVG, red/blue) in the room header next to the name; door plates get the siren only. No change to sizes: `check:office` stays green at 1440x900 and 1280x800.
- **FR-010** `[IMPLEMENTED]` Words: the room section's and door plate's `aria-label` add "Alert: an agent needs help" while the siren is on.
- **FR-011** `[IMPLEMENTED]` Calm: Serious mode removes tones and sirens; reduced motion stops the blink; header text contrast at least 4.5:1 at every tone, measured on the real pixels in the driver.
- **FR-012** `[IMPLEMENTED]` Simulator: one room whose worst agent is heavy only, so all three tones can be seen at once.
- **FR-013** `[IMPLEMENTED]` Tests, no credits: `roomAlertOf` cases in `scripts/test-mood.ts` (each tone, priority, siren for ambulance and faint only, garbage input); driver `scripts/shots-034.js` extended (tones, siren moves with the ambulance, closed plate, Serious mode, reduced motion, contrast, floor off); screenshots at both sizes.

#### Success criteria

- **SC-003**: On the simulator, calm, uneasy and alarm rooms and at least one siren are visible at 1440x900 and 1280x800 with 15 agents, and `npm run check:office` passes.
- **SC-004**: Serious mode on: no room has `data-alert` and no siren is in the page.

#### Verification (phase 3, 2026-10-17)

- `test:` `roomAlertOf` cases in `scripts/test-mood.ts`. Mutation check: 10 deliberate breaks, 9 fail a test; the 10th removed a redundant type check (numbers and text have no fields), so that check was removed from the code.
- `sim:` `scripts/shots-034.js` at 1440x900 and 1280x800:
  - every room's tone: `mcp-swiss` alarm, `swisscontract-ai` and `command-center` alarm with siren, `infra-notes` uneasy, `blog` calm;
  - the alert words only with the siren;
  - the siren moves with the ambulance to another room and back;
  - a closed plate with the siren keeps its size;
  - Serious mode: no tone, siren or words;
  - reduced motion: the siren does not blink;
  - a floor that is off;
  - full density without the inner ring.
  - Header contrast measured on screen pixels: darkened rooms 5.9-6.7:1, calm rooms 5.17:1 (path) and 5.35:1 (usage). `check:office` passes with no layout change: 141/141 on macOS, 142/142 on CI (Linux). The count depends on the machine: with 15 agents at 1440x900 and three rooms closed, Linux fonts let the office pick the full density instead of roomy, and full runs one more check (found in review).
- Fixed in review:
  - On door plates the siren first took its own row and made plates 18 px taller (`check:office` on macOS went from 141 to 140 checks); it now sits on the corner of the door icon.
  - The tone rule gave full-density rooms the compact rooms' inner white ring.
  - In darkened rooms the path fell to 3.5:1, so the header text now gets darker with the floor.
- T015, done in this PR after Vikram's review (Ruben chose to do it now): the folder path in every room's header was about 4.2:1 on `main` (`--muted` on the room floor). It is now `#5c635e`, measured at 5.17:1 in a calm room. The driver holds every tone to 4.5:1, so the old colour fails it.
- `[KNOWN GAP]` Not run on a real Copilot session (it only reads the moods of spec 034).


### 2026-10-19: mood words in the List view (T009, first half)

- **FR-014** `[IMPLEMENTED]` The List view has no figures, so each main agent's row shows the mood words of FR-003 (the same `phrases()`: context nearly full, needs help, fainted, impatient, dizzy) at the start of its *Current task* cell, in a small amber text, and adds them to the row's accessible label. They show only when there are words. Serious mode shows none, as on the cards, and helpers show none. The walking figure while an agent is at a place stays as specified (unchanged); that is the other half of T009, not built. `sim:` `scripts/shots-034-list.js` in List view at 1440x900 and 1280x800 (five rows with words: two nearly full, needs help, fainted, dizzy; no helper rows; the words are in the label; row height kept); screenshots `docs/screenshots/mood-list-*.png`.
- **FR-015** `[IMPLEMENTED]` The walking figure (spec 024, a 22 px head while an agent visits a place) shows its mood in a small form:
  - heavy: an amber ring;
  - monster: a grey-green ring and two small horns;
  - a trouble: a dot at its top right, red for needs help or fainted, amber for impatient or dizzy.
  
  It follows the agent's mood on every render while the figure is away. The figure stays `aria-hidden`; the words are on the card and in the List view. Serious mode shows none of it. This closes the other half of T009. `sim:` `scripts/shots-034-list.js` in the office view at both sizes: in the simulator's lobby a dizzy walker shows its dot, a monster and a heavy one show their rings, and no figure without a trouble has a dot. Screenshots `docs/screenshots/mood-walker-*.png`.

- **2026-10-21, spec 068 (coffee break), supersedes the faint look.** An agent at its credit limit, or at a usage limit of its agent app, is on a coffee break: no trouble drawing (`troubleOf` returns null for `coffee`), a calm room without a siren, and the words "On a coffee break". User Story 2 scenario 2 (fainted at *Limit reached*) no longer happens in the app; the faint drawing stays in the code for any caller that passes `limit` without `coffee`. `test:` mood.

### 2026-10-23: "Retrying" while the agent app retries the model API (issue #600)

**Input**: Vikram (owner go, 2026-10-23, issue #600): when the model API errors or hits a rate limit, the agent apps retry quietly and the desk looks frozen. Show "Retrying (attempt N) – <reason>" on the desk and in the chat, and "Gave up" with the reason if the retries run out. Sources named in the issue (`read:` spec 076 research on PR #575): Claude Code's `api_retry` stream message (ignored until now in `claudeMap.ts`), Copilot's failed model calls, Codex's API request status. Normalized adapter event, no vendor types in the renderer, reason text masked.

#### Clarifications (decided by default and recorded here; open to change in review)

- **Q: What is the reason?** **A short fixed label chosen by the adapter**, never the provider's message: rate limit, servers busy, server error, connection problem, timed out, sign-in problem, API error; plus the HTTP status number when the agent app gives one ("rate limit (HTTP 429)"). No vendor text crosses the adapter, which is stricter than masking it; the task line still goes through the renderer's mask (spec 041 FR-065) like every task line.
- **Q: What is N?** **The number of the retry**: 1 is the first retry after the first failed call. "of M" only when the agent app says how many retries it will make (Claude Code's `max_retries`).
- **Q: Which word on the pill?** **Retrying**, one word (spec 052 FR-076), in the waiting colours like *Failing* (spec 052 FR-062), with the full line ("Retrying (attempt 3 of 10) – servers busy (HTTP 529)") as the desk's task line and the pill's tooltip. It is information, not mood: it shows in Serious mode too. *Retrying* wins over *Failing* while both apply (the model call is what is stuck).
- **Q: When does it end?** At the agent's next sign of progress (output, thinking, a tool call, a permission request, usage) or at the end of the turn. A turn that ends in an error after retries **gave up**: the pill says Error as before and the task line "Gave up after 4 retries – rate limit (HTTP 429)". A usage limit (spec 068 coffee break) or a stop by the user is not "gave up".
- **Q: The chat?** **One note per run of retries, updated in place** (not one note per attempt): "Retrying (attempt 2 of 10) – rate limit. The agent app tries again by itself.", then "The request went through after 2 retries." or "Gave up after 10 retries – rate limit." No timer, no countdown.
- **Q: Helpers?** Main agents only (the events of a helper are not used), like the rest of this spec.

#### User scenarios

1. **Given** a working agent whose agent app reports a retry (attempt 3 of 10, servers busy, HTTP 529), **Then** its pill says *Retrying* (desk, card, list, chat header, chat strip) and its task line says "Retrying (attempt 3 of 10) – servers busy (HTTP 529)"; the chat has one note with the same words.
2. **Given** the next retry, **Then** the same note and line show the new attempt (no second note).
3. **Given** the agent then answers (output, thinking or a tool call), **Then** the pill goes back to its status and the note says "The request went through after 3 retries."
4. **Given** the turn ends in an error after retries, **Then** the pill says *Error*, the task line "Gave up after 4 retries – rate limit (HTTP 429)", and the note says the same; the error note of the turn follows as before.
5. **Given** Serious mode, **Then** all of the above still shows (it is a status, not a drawing).

#### Edge cases

- An agent app that reports no retries: nothing changes (see the gaps below).
- A retry event of a helper: ignored.
- A retry while the agent waits for a permission or is on a coffee break: the line is not shown over the waiting request or the break; a permission request or a break ends the retry mark.
- Malformed values (attempt 0 or negative, a status outside 100-599, a reason outside the list): the event guard rejects the event in tests; the renderer shows "API error" for an unknown reason and leaves out a bad number.

#### Requirements

- **FR-016** `[IMPLEMENTED]` Normalized event `retry` in `src/adapters/types.ts` (`RetryEvent`): `phase: 'retrying' | 'gave-up'`, `attempt` (a positive whole number: the retry number, or on `gave-up` the number of retries made), `maxAttempts?`, `reason: 'rate-limit' | 'overloaded' | 'server' | 'network' | 'timeout' | 'auth' | 'other'`, `httpStatus?` (100-599), `delayMs?`. No vendor field, no provider text. `src/adapters/eventguard.ts` checks it.
- **FR-017** `[IMPLEMENTED]` Adapters (`src/adapters/retry.ts`, pure: a per-turn `RetryTracker` and one reason mapper per agent app; main agent only):
  - Claude Code: `system` / `api_retry` (`attempt`, `max_retries`, `retry_delay_ms`, `error_status`, `error`: `rate_limit`, `overloaded`, `server_error`, `authentication_failed`, `cloud_credential_error`, `unknown`; `no_response`) → `retrying`. `read:` the Claude Code 2.1.309 binary's stream-json writer (the shape above), not a real run.
  - Codex: the `error` notification with `willRetry: true` (`error.codexErrorInfo`: `rateLimitExceeded`, `serverOverloaded`, `internalServerError`, `httpConnectionFailed`, `responseStreamConnectionFailed`, `responseStreamDisconnected`, with `httpStatusCode`) → `retrying`, numbered by the tracker. `read:` `codex app-server generate-ts` for codex-cli 0.163.0 (`ErrorNotification`, `CodexErrorInfo`), not a real run.
  - Copilot: `model.call_failure` of the top-level agent (`source: 'top_level'`) with a status a client retries (none, 408, 409, 425, 429, 5xx) or `failureKind: 'transport'` → `retrying`, numbered from `retryAttempt` (zero-based index of the failed call) + 1. `read:` `@github/copilot-sdk` 1.0.22 typings (`ModelCallFailureData`), not a real run. `[KNOWN GAP]` The event is described as telemetry; whether the runtime sends it to an SDK client, and whether a retry always follows it, was not seen. If none follows, the error that ends the turn shows "Gave up after 1 retry".
  - Gave up: a turn that ends in an error status after at least one `retrying` of that turn emits `gave-up` (same reason and status, the last attempt) just before the error status. Not after a usage limit (spec 068), an abort or a sign-in failure, and never twice.
  - Progress clears the tracker in each mapper (an answer, thinking, a tool call, usage, the end of the turn).
- **FR-018** `[IMPLEMENTED]` Renderer: pure `src/renderer/retry.js` (`DurbarRetry`, UMD): the reason words, `retryLine`, `gaveUpLine`, `wentThroughLine`, and `next(state, event)`, the rule of the clarifications (which event starts, updates, ends or gives up a retry mark). `app.js` keeps `a.retry` per main agent; `pillSt`/`stWord` give `retrying`/*Retrying* while it is set and the agent is Working or Thinking; `.st-retrying`, `.dot.retrying` and `.desk.card.is-retrying` reuse the *Failing* rules (no new colour, no size change); the status order puts it with *Failing*; the pill's tooltip and the task line carry the line. The lines are Durbar's own words, so they are kept when no redact module is loaded (`FIXED_TASK_FORMAT`). Nothing changes size: `check:office` stays green.
- **FR-019** `[IMPLEMENTED]` Chat: one note per run of retries (`.note.retry`), updated in place, then "went through" or "gave up" as in the clarifications. A gave-up turn's error keeps the line "Gave up after N retries – reason" as the task line (the pill says Error).
- **FR-020** `[IMPLEMENTED]` Simulator, `simretry=1`: Clara (working) is retrying (attempt 3 of 10, servers busy, HTTP 529) and stays so (the background ticks skip her); Tomas (error) retries twice for a rate limit (HTTP 429) and gives up before his error. A driver sends further events with `window.__durbarSimEmit`.
- **FR-021** `[IMPLEMENTED]` Tests, no credits: `scripts/test-retry.ts` (each app's mapping from synthetic messages shaped like the sources above, the tracker's numbering and gave-up rules, the renderer's lines and `next`, the event guard), each case mutation-checked; driver `scripts/shots-034-retry.js` at 1440x900 and 1280x800 (the pill, the line, the one note updated in place, went through, gave up, Serious mode, `check:office` unchanged), screenshots `docs/screenshots/retry-*.png`.

#### Verification (2026-10-23)

- `test:` `scripts/test-retry.ts` (`test:retry`): the three readers, the tracker, the three mappers end to end (retrying, gave up before the error, no gave-up after progress, a usage limit, a sign-in failure, a helper or an unknown thread), the event guard, `retry.js` lines, `LINE_RE` and `next`. Mutation check: 22 deliberate breaks of the mapping, the tracker, the guard and `retry.js`, 21 failed a test; the 22nd (the Claude gave-up condition's `!limited`) was redundant, because the usage-limit, abort and sign-in paths return before the gave-up is emitted, so the condition was removed. `scripts/fixtures/claude/init.json` used `api_retry` as an ignored message; it now expects the retry event (`test-claude-map`). `test-mcp-agentstate` pins the error line's new fragment.
- `sim:` `scripts/shots-034-retry.js` (in the UI suite) at 1440x900 and 1280x800 with `simretry=1`: every step asserted on an `until()` result. Mutation check on the renderer: making a note per retry, dropping the retry line from the desk line, and dropping Retrying from the chat strip's attention each fail it. `check:office` 392/392 (default simulator). Screenshots `docs/screenshots/retry-office-*.png`, `retry-chat-*.png`, `retry-gaveup-*.png`.
- Found while building: a closed chat's element is not in the page, so the first build added a new note for each retry (the note is now found in the chat's own element); the desk line showed the live readout or the place instead of the retry line (the retry line now wins, FR-018).
- The README, website and landing pictures (`shots:docs`) are taken without `simretry`, so none of them shows this change; they were not retaken.

#### Known gaps

- `[KNOWN GAP]` Not run on a real session of any agent app: no retry was provoked (it needs a failing or rate-limited model API). The shapes are `read:` only (above).
- `[KNOWN GAP]` Claude Code's `api_retry` carries no sub-agent id, so a helper's retries (if Claude Code reports them) show on its main agent.
- `[KNOWN GAP]` The Durbar MCP server's agent state (spec 041) does not report *Retrying* (it does not report *Failing* either).

# Feature Specification: Agents show how they are doing (context size, trouble signals, serious mode)

<!-- specs-index (the row in specs/README.md; after an edit run `npm run specs:index`)
group: 034
title: The figure follows the context window (heavy 70-90%, grumpy monster above 90%), trouble signals (ambulance, faint, dizzy, impatient), Serious mode
status: **built** 2026-10-17 (issue #20): simulator and unit tests, `scripts/shots-034.js`; not checked on a real session; T009 built 2026-10-19: List view mood words and the walking figure's mood (FR-014/FR-015, `scripts/shots-034-list.js`); delta 2026-10-17 *rooms darken with their worst agent, sirens* (issue #135) **built** (simulator, `scripts/shots-034.js`; T015 room path contrast done too)
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

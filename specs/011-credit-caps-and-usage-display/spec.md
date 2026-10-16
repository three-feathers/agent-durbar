# Feature Specification: AI-credit caps and usage display

**Feature Branch**: `011-credit-caps-and-usage-display`
**Created**: 2026-10-16
**Status**: Draft (backlog). Not clarified, no plan, no tasks yet. Run `/speckit.clarify` first.
**Input**: README roadmap "AI-credit counter and caps" (unchecked). Today usage is only a read-only line per agent; `maxAiCredits` exists in `StartOptions` but nothing uses it.

## What exists today (verified 2026-10-16 by reading code and the installed SDK)

- `[IMPLEMENTED]` `usage` events carry `inputTokens`, `outputTokens`, `model`, `nanoAiu` (from `assistant.usage` → `copilotUsage.totalNanoAiu`, feature 002); the renderer sums them per agent and shows "N calls · X in / Y out tokens · Z AIU" (`usageLong` in `app.js`). *(sim:; the real field was seen on the free plan only)*
- `[KNOWN GAP]` `StartOptions.maxAiCredits` (`src/adapters/types.ts`) is accepted and ignored (feature 002 FR-017).
- `[KNOWN GAP]` No total across agents, no per-folder total, no history across restarts, no warning, no cap.
- Installed `@github/copilot-sdk` 1.0.22 offers (read in its `.d.ts`, **never called by this app**): `SessionConfig.sessionLimits?: { maxAiCredits?: number }` ("maximum AI Credits allowed across the session's current accounting window"), an event `session_limits_exhausted.requested` answered with `session.ui.handlePendingSessionLimitsExhausted()` (actions such as add credits / set a new maximum), `session.quota` / `quota_observation` events and `errorType: "quota"` errors. `[UNVERIFIED]` what they do on a real session, whether the cap is hard or soft ("post-paid ceiling is soft" is documented for workflow limits), and whether `AIU` equals "AI credits" shown on GitHub billing pages.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what each agent and the whole office have spent (Priority: P1)

As someone running many agents I want a running total of credits per agent and for the office, in the header and in each chat, so I notice an expensive agent early.

**Why this priority**: the app's selling point is many agents at once; spend is the main risk of that (constitution IV, III).

**Independent Test**: on the simulator (`DURBAR_SIM=15`, fake `nanoAiu`) the office total equals the sum of the per-agent values; on a restart the saved total is kept.

**Acceptance Scenarios**:

1. **Given** 15 simulated agents with usage, **When** I look at the header, **Then** I see the office total in AIU and the unit is explained in a tooltip.
2. **Given** an agent whose usage events carry no `nanoAiu`, **When** I look at its line, **Then** it shows tokens only and says "credits not reported", not 0.000.
3. **Given** I restart the app, **When** it opens, **Then** [NEEDS CLARIFICATION: are totals persisted, per day/session/forever, and where; privacy: counts only, never content].

### User Story 2 - Set a cap per session that stops runaway agents (Priority: P2)

I can set a maximum number of credits when I add a folder or new session; when it is reached the agent stops and tells me, and I can raise the cap or end the session.

**Acceptance Scenarios**:

1. **Given** a session with cap 0.05, **When** usage reaches it, **Then** the agent shows "Credit cap reached", does not continue silently, and offers "Add credits", "Set new cap", "End session". *(needs real verification: feature 013)*
2. **Given** a cap and a pending permission request, **When** the cap is reached, **Then** the request is denied and the state is consistent (no stuck "working").
3. **Given** no cap is set, **When** I start a session, **Then** behavior is unchanged and the UI says "no cap" (constitution III: say what is and is not limited).

### User Story 3 - Understand the multiplier (Priority: P3)

Next to the model picker I see the credit multiplier and an estimate of cost relative to `auto` (feature 007 task T024).

### Edge Cases

- A usage event arrives after the agent was stopped or removed: ignore without throwing.
- `nanoAiu` is absent, negative, non-numeric or huge: show "not reported"; never `NaN`.
- Two sessions in one folder: totals are per session and per folder.
- Cap lower than one model call: the first call already exceeds it; the message must say the cap is soft if the SDK says so.
- The user changes the cap mid-turn.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** The office header shows the total AIU of all agents since launch, with tooltip explaining AIU and that figures are as reported by the Copilot runtime.
- **FR-002** Per agent: calls, tokens and AIU as today, plus "credits not reported" when the runtime gives none.
- **FR-003** A per-session cap can be set when adding a folder or session (default: none); it is passed to the adapter through `StartOptions.maxAiCredits` and mapped by the Copilot adapter to the SDK's `sessionLimits` (after verification, feature 013).
- **FR-004** Reaching a cap emits a normalized event (name to be decided in `/speckit.plan`, for example `limit`) that the UI renders as an attention state with the choices in User Story 2; the adapter implements the SDK's exhausted-request handshake.
- **FR-005** Adapters that cannot enforce a cap must say so (`capabilities`), and the UI must not offer a cap for them (spec 012).
- **FR-006** Honest wording: the UI and README state whether a cap is hard or soft once verified; until verified it is documented as unverified.
- **FR-007** No usage or credit data leaves the machine; persisted totals contain numbers only.
- **FR-008** Tests: credit-free unit tests with a fake adapter emitting `usage` and limit events; simulator emits limit events so the UI states can be screenshotted (spec 010).

### Key Entities

- **UsageTotals**: calls, inTokens, outTokens, nanoAiu, creditsReported (boolean), per agent, per folder, per office.
- **SessionCap**: optional number of AI credits, applies to one session.

## Success Criteria *(mandatory)*

- **SC-001**: On the simulator, header total equals the sum of agents to the displayed precision.
- **SC-002**: A real session with a tiny cap is stopped or asked about by the SDK and the UI reaches a consistent state (recorded in feature 013 with the number of prompts spent).
- **SC-003**: The README no longer lists "AI-credit counter and caps" as open and states what is and is not enforced.

## Assumptions and open questions

- The SDK `sessionLimits` is the right mechanism; otherwise the app would have to stop sessions itself from usage events, which is only approximate (a call in flight cannot be recalled).
- [NEEDS CLARIFICATION] Unit shown to users: AIU, "AI credits", or money? How is AIU converted for plans with premium requests?
- [NEEDS CLARIFICATION] Default cap for new sessions: none (today) or a conservative one?
- Depends on: 002 (events), 007 (multipliers), 013 (real verification), 012 (capability flag).

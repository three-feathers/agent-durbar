# Feature Specification: AI-credit caps and usage display

**Feature Branch**: `011-credit-caps-and-usage-display`
**Created**: 2026-10-16
**Status**: Partly specified for implementation 2026-10-16 (per-session cap + global default + usage-vs-cap display + limit-exhausted handling: see Clarifications, `plan.md`, `tasks.md`). Office-wide totals, persistence of usage and the multiplier estimate (User Stories 1 and 3) stay backlog.
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

1. **Given** a session with cap 30, **When** usage reaches it, **Then** the agent shows "Credit cap reached", does not continue silently, and offers "Add credits", "Set new cap", "End session". *(needs real verification: feature 013)*
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


## Clarifications (2026-10-16, audit gap 1; decided by the maintainer's brief, no open questions left for this slice)

- **Q: Unit shown?** AIU, as the runtime reports it in `assistant.usage` (`totalNanoAiu / 1e9`). The SDK names its cap "AI Credits". GitHub's docs say 1 AI credit = USD 0.01 and show `totalNanoAiu / 1e9` as the credit count (with the caveat that billing is the source of truth), so the app treats **1 AIU = 1 AI Credit** and says "as reported by the Copilot runtime" in tooltips. `[UNVERIFIED]` against a real bill.
- **Q: Minimum cap?** **30 AI credits**, enforced by the runtime ("Minimum session limit is 30 AI credits", seen on a real `session.create` and `session.options.update`, and in GitHub's docs). The app enforces the same minimum in `parseCap` (UI inputs, saved caps, default cap) so a cap can never fail session creation; the *Add credits* amount only has to be above 0 (the resulting cap is above 30).
- **Q: Default cap?** None (unchanged behavior). A **global default** can be set in Settings; it is applied when a session is created (new folder, new session, restored folder without its own cap). Empty = no cap.
- **Q: Persisted?** The per-folder cap and the global default are persisted as plain numbers (FR-007). Usage totals are not persisted (stay backlog).
- **Q: Hard or soft?** **Soft**, per GitHub's docs: usage is checked after each model response returns, so one response can overshoot, and the runtime blocks the *next* model call (FR-006). The UI says "limit reached", never "never exceeds".
- **Q: Which events?** SDK 1.0.22: `SessionConfig.sessionLimits.maxAiCredits`, event `session_limits_exhausted.requested {requestId, maxAiCredits, usedAiCredits}`, answered with `session.rpc.ui.handlePendingSessionLimitsExhausted({requestId, response:{action: add|set|unset|cancel, additionalAiCredits?, maxAiCredits?}})`, `session.session_limits_changed`, and `session.rpc.options.update({sessionLimits})` to change the cap on a live session. A consumer must `rpc.events.registerInterest({eventType:'session_limits_exhausted.requested'})` or the runtime does not wait for one.

## Changes

### 2026-10-16: implement the credit cap slice (audit gap 1)

New or changed requirements (they extend FR-003, FR-004, FR-006, FR-008 and User Story 2; numbering continues):

- **FR-009** `StartOptions.maxAiCredits` is mapped by the Copilot adapter to `sessionLimits: { maxAiCredits }` on create **and** resume. Values must be finite, > 0 and <= 1,000,000 (validated in main with `parseCap`; the renderer cannot send anything else); otherwise no cap.
- **FR-010** A normalized event `limit` (`phase: 'exhausted' | 'changed' | 'resolved'`, `requestId?`, `maxAiCredits?: number | null`, `usedAiCredits?`, `action?`) is emitted by the mapper from `session_limits_exhausted.requested`, `session.session_limits_changed`, `session_limits_exhausted.completed`. Sub-agent tagging is ignored: a limit is the session's.
- **FR-011** The adapter registers interest in `session_limits_exhausted.requested` (best effort; failure is logged to the debug sink only) and exposes `setCap(sessionId, credits | null)` (live session: `options.update`) and `resolveLimit(sessionId, requestId, action)` (`add` N, `set` N, `unset`, `cancel`). Stop (interrupt) and End answer a pending limit request with `cancel` so nothing waits forever.
- **FR-012** The main process keeps a per-agent cap (`AgentInfo.maxAiCredits`), a global default in `durbar-settings.json` (numbers only, in userData) and the per-folder cap in the saved folder list. IPC: `settings:get`, `settings:setDefaultCap`, `agents:setCap`, `agents:resolveLimit`. All arguments are validated; unknown agents are ignored.
- **FR-013** UI: agent cards show `used/cap AIU` (for example `12.40/50 AIU`) next to the token count; with no cap they show `used AIU` as before. The chat header shows a **cap chip** (`12.40 / 50 AIU` or `No cap`, with a bar when capped) that opens a small dialog to set or remove the cap. The new-session dialog has a cap field pre-filled with the global default. Settings has a "Credit cap" section for the global default.
- **FR-014** When the limit is exhausted the agent card state is **Limit reached** (attention state, listed first like Waiting), the chat shows an inline notice "Credit limit reached: used X of Y AIU. The agent waits for you." with **Add credits** (amount field, default = current cap), **Remove cap** and **Stop here** (cancel). After Add/Remove the agent continues (`working`); after Stop here it is Ready again with a note. Sending a message while a limit request is pending is refused with a clear message.
- **FR-015** `[UNVERIFIED]` What the real runtime does after `cancel` (assumed: the blocked model request is cancelled and the turn ends) and the real shape of the exhausted event. Reaching the minimum cap of 30 credits costs about USD 0.30 (~150 tiny prompts), so it was **not** exercised (see Verification).
- **FR-016** The simulator supports caps: some agents start with a cap (`DURBAR_SIM=15`: Ada 50, Mira 30, Omar 30 with 11 AIU per simulated call, so he exhausts it during his first turn), enforce it from simulated usage, and emit `limit` events; `setCap`, `resolveLimit` and the settings bridge work in memory. No credits are spent.
- **FR-017** Tests (no credits): mapper fixtures for the three events (`scripts/test-events.ts`), `parseCap` and the settings parser (`scripts/test-credits.ts`), saved-folder cap round trip (`scripts/test-folders.ts`).
- **Packaging**: the SDK dependency is pinned **exactly** (`"@github/copilot-sdk": "1.0.22"`, no caret) because `sessionLimits` and the `ui.handlePending*` calls are marked `@experimental`; upgrading is a deliberate step documented in CONTRIBUTING.md ("Upgrading the Copilot SDK").

Still backlog: office-wide total in the header, per-folder totals, persisted usage, multiplier estimate, capability flag for other adapters (spec 012).

### Verification

Run 2026-10-16 (Europe/Madrid) with `npm run verify:cap` against the real runtime (SDK 1.0.22, `auto` model, no prompt sent, **0 AIU spent**):

- `session.create` with `maxAiCredits: 0.001` failed: `Minimum session limit is 30 AI credits.` (so the minimum, FR-009/Q above, is a fact, not an assumption).
- A real session with cap 30 starts; `setCap(60)` and `setCap(null)` each produced one `session.session_limits_changed` event, normalized to `limit {phase:'changed', max:60}` and `max:null`; `setCap(5)` is refused by the runtime with the same minimum message (the app never sends it: `parseCap`).
- **Not verified, on purpose:** the exhausted flow (`session_limits_exhausted.requested`, the answers add/set/unset/cancel, behaviour after `cancel`). It needs 30 real credits (about USD 0.30, ~150 tiny prompts). The handshake is implemented from the SDK types and GitHub's documentation and covered by mapper fixtures and the simulator only. The single real prompt allowed for this task was therefore **not used**. Re-run once someone is willing to spend that, and record the result here.

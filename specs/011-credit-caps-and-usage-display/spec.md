# Feature Specification: AI-credit caps and usage display

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 011-014
title: AI-credit caps and usage display
status: built
note: exhausted flow unverified on a real account
-->

**Feature Branch**: `011-credit-caps-and-usage-display`
**Created**: 2026-10-16
**Status**: Partly specified for implementation 2026-10-16 (per-session cap + global default + usage-vs-cap display + limit-exhausted handling: see Clarifications, `plan.md`, `tasks.md`). Office-wide and per-folder totals built 2026-10-17 (FR-018..FR-023). Persistence of usage and the multiplier estimate (User Stories 1 and 3) stay backlog. Totals kept across restarts with a reset: built 2026-10-17 (second delta, issue #21), simulator and unit tests; User Story 3 (multiplier) is covered by spec 030.
**Input**: README roadmap "AI-credit counter and caps" (unchecked). Today usage is only a read-only line per agent; `maxAiCredits` exists in `StartOptions` but nothing uses it.

## What exists today (verified 2026-10-16 by reading code and the installed SDK)

- `[IMPLEMENTED]` `usage` events carry `inputTokens`, `outputTokens`, `model`, `nanoAiu` (from `assistant.usage` → `copilotUsage.totalNanoAiu`, feature 002); the renderer sums them per agent and shows "N calls · X in / Y out tokens · Z AIU" (`usageLong` in `app.js`). *(sim:; the real field was seen on the free plan only)*
- `[KNOWN GAP]` `StartOptions.maxAiCredits` (`src/adapters/types.ts`) is accepted and ignored (feature 002 FR-017).
- `[KNOWN GAP]` ~~No total across agents, no per-folder total~~ (built 2026-10-17, FR-018..FR-023), no history across restarts, no warning, ~~no cap~~ (cap slice 2026-10-16).
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

### User Story 3 - Understand the multiplier (Priority: P3) — covered by spec 030 (2026-10-17 second delta)

Next to the model picker I see the credit multiplier and an estimate of cost relative to `auto` (feature 007 task T024).

### Edge Cases

- A usage event arrives after the agent was stopped or removed: ignore without throwing.
- `nanoAiu` is absent, negative, non-numeric or huge: show "not reported"; never `NaN`.
- Two sessions in one folder: totals are per session and per folder.
- Cap lower than one model call: the first call already exceeds it; the message must say the cap is soft if the SDK says so.
- The user changes the cap mid-turn.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (implemented 2026-10-17, FR-018..FR-023) The office header shows the total AIU of all agents since launch, with tooltip explaining AIU and that figures are as reported by the Copilot runtime.
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

### 2026-10-29: index status text kept from before the fixed status words (spec 021 FR-063)

The `status:` of the specs-index block used to read (moved here unchanged; the block now has one status word and a short note):

> per-session cap slice and office/folder usage totals built, totals kept across restarts with a reset (2026-10-17, issue #21); exhausted flow unverified on a real account; multiplier estimate covered by spec 030; 2026-10-20: Copilot cap enforced by Durbar (the runtime does not stop at it; real check)


- **2026-10-17, spec 033 (floors), cross-reference.** The office total keeps counting rooms on floors that are off; its tooltip adds "Includes X AIU from floors that are off" (`tooltip(t, {offFloors})`, `sum()` in `usagetotals.js`, `test:usagetotals`). Room totals are unchanged.

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

### 2026-10-17: office-wide and per-folder usage totals (User Story 1 FR-001; issue #8)

**Clarifications (Ruben, 2026-10-17).**

- **Q: Scope?** Totals only: an office total in the header and a total per folder, **in memory since the app opened**. Persisting usage across restarts (User Story 1 scenario 3) and the multiplier estimate (User Story 3) stay backlog, as separate issues.
- **Q: Where is the office total?** A chip after the status counters in the header (`1.23 AIU`), with a tooltip for the breakdown.
- **Q: Where is the folder total?** In the open room header next to the status dots, and on the closed door plate.
- **Q: What counts?** Everything since the app opened, **including ended sessions and removed agents** (that spend has happened). Helpers (sub-agents) count **once**: their usage is already part of their parent agent and is not added again.
- Decided by default (recorded here, no open questions): the header chip counts the **whole office**, ignoring the folder/status filters (spend is not filtered away). Two decimals on the chip and plate, three in tooltips (same as cards and the chat header). A folder that is removed takes its folder total with it, but its spend stays in the office total; the tooltip then says "includes folders no longer shown".

**Requirements (numbering continues).**

- **FR-018** `[IMPLEMENTED]` (test: usagetotals; sim:) A pure usage ledger (`src/renderer/usagetotals.js`, UMD like `roomsummary.js`, tested in Node) records each `usage` event once, keyed by folder (room id): `calls`, `inTokens`, `outTokens`, `nano` (sum of valid `nanoAiu`), `unreported` (calls whose `nanoAiu` is missing, non-numeric, negative or above 1e15). It is never decreased when an agent or session goes away. Events from helpers are recorded once, for the parent's folder.
- **FR-019** `[IMPLEMENTED]` (sim:) **Header chip** after the status counters: `N.NN AIU` for the office total. Tooltip: total AIU with three decimals, calls, input/output tokens, "since Agent Durbar opened; ended sessions included", "as reported by the Copilot runtime (1 AIU = 1 AI credit, unverified against billing)", and, when relevant, "N calls did not report credits" and "includes folders no longer shown". The chip is not a filter button and is hidden while no `usage` event has arrived (fresh start, demo/sample data).
- **FR-020** `[IMPLEMENTED]` (sim:) **Folder total** in the open room header next to the status dots (`0.42 AIU`, tooltip with the same breakdown for that folder) and on the closed door plate (appended to the plate's aria-label and shown as short text). Hidden for folders with no usage yet.
- **FR-021** `[IMPLEMENTED]` (test: usagetotals; **not seen on screen**: the simulator always reports credits, so the not-reported chip/plate text is unit-tested only) **Not reported, never zero:** when every recorded call of the scope lacks credits, the chip/folder total shows `credits not reported` (short form on the plate: `n/r`), not `0.00 AIU`. When only some lack them, the value is shown and the tooltip says how many calls did not report.
- **FR-022** `[IMPLEMENTED]` (sim:; check:office 95/95) Calm UI (constitution V): text at least 10.5px, the header and room headers still fit at 1440x900 and 1280x800 with 15 simulated agents (`npm run check:office` stays green); the chip uses the existing neutral pill style, no new colors for spend.
- **FR-023** `[IMPLEMENTED]` (test: usagetotals; sim: screenshots) Tests (no credits): `scripts/test-usagetotals.ts` (sums per folder and office, helpers once, removal does not decrease, invalid `nanoAiu` counted as unreported, formatting incl. not-reported) wired into `npm test`; simulator screenshots at both sizes.
- SC-001 applies: on the simulator the header total equals the sum of the folder totals (when no folder was removed) to the displayed precision.

Still backlog after this delta: persisted usage across restarts, multiplier estimate (User Story 3), capability flag for other adapters (spec 012).

### 2026-10-17 (second delta): usage totals kept across restarts, a reset, the multiplier left to spec 030 (issue #21)

**Clarifications (Ruben, 2026-10-17).**

- **Q: The multiplier estimate (User Story 3)?** **Left to spec 030** (switch model and context window), which shows the price per million tokens per model in its model menu and says the legacy multiplier only exists on annual plans. User Story 3 of this spec is therefore covered by spec 030, not built here.
- **Q: What does the header chip show after a restart?** The **total since the last reset**, saved on disk; the tooltip also gives the amount spent since the app opened (or since the reset, if that was later). The same for each folder (room header and door plate).
- **Q: How is it reset?** A **"Reset usage totals"** button in Settings, with a confirmation. It is separate from the tool-count reset of Tools > All time (spec 020).
- **Q: How is a folder identified on disk without storing paths?** By a **hash of its path** (the folder or `.code-workspace` key the folder list uses), plus its display name. Two folders with the same name stay separate; the file never holds a path.
- Decided by default (recorded here): the main process records the totals from the adapter's `usage` events (like the all-time tool counts, spec 020 FR-006), so nothing depends on a window being open; one record per event, helpers included in their agent's folder; the file is `durbar-usage-totals.json` in userData, written atomically, debounced and flushed on quit, tolerant on read (missing, corrupt or oversized = empty); folders that are no longer in the list keep their saved total in the office figure (the tooltip already says "includes folders no longer shown").

**Requirements (numbering continues).**

- **FR-024** `[IMPLEMENTED]` (test: usagedoc) Pure `src/shared/usagedoc.ts`: document `{ version: 1, since, folders: { [key]: { name, calls, inTokens, outTokens, nano, unreported } } }`; `recordUsage(doc, key, name, event)` with the same validation as FR-018 (`nanoAiu` missing, non-numeric, negative or above 1e15 counts as unreported; bad token fields count as 0); `sanitizeUsageDoc(raw)` (drops anything else, caps 2000 folders and name length 200, numbers finite and >= 0); `officeTotals(doc)`; `normaliseFolderKey(path, platform)` input normalisation (separators unified, trailing separators removed, case-folded on Windows; the hash itself is computed in main).
- **FR-025** `[IMPLEMENTED]` (test: usagedoc) `src/main/usagetotalsstore.ts` (`UsageTotalsStore`, same shape as `UsageStore`): load, record, debounced atomic save, flush on quit, `reset()` (empty document, `since` = now), `lastError` when the disk refuses. The key is the first 32 hex characters of SHA-256 of the normalised folder key, computed in main (Node `crypto`).
- **FR-026** `[IMPLEMENTED]` (real IPC without a session, see below; sim: shots-021.js) Main: every `usage` event of a known agent is recorded under its folder key and display name. IPC `usage:totals` returns `{ since, office, folders: [{ path, name, ...totals }] }` where `folders` lists only the folders of the current agents (the path is resolved in memory from the agents, never read from disk) and `office` sums every saved folder; `usage:resetTotals` resets and returns the same view. Preload and `api.ts` get `usageTotals()` and `usageResetTotals()`.
- **FR-027** `[IMPLEMENTED]` (test: usagetotals; sim: shots-021.js) Renderer: at start (and after a reset) it asks `usageTotals()` once and keeps it as the **baseline**; the chip and the folder totals show baseline + what this run recorded (the existing ledger, FR-018). The tooltip adds "since the app opened: N.NNN AIU" (or "since the reset"), keeps "as reported by the Copilot runtime" and "ended sessions included". Folders are matched by their folder key (`workspaceFile ?? cwd`), never by room id (room ids change between runs).
- **FR-028** `[IMPLEMENTED]` (sim: shots-021.js) Settings: a "Usage totals" part in the Credit cap section: the office total and since when it counts, and **Reset usage totals** with a confirmation dialog ("This sets the saved office and folder totals to zero. Tool counts in Tools > All time are not changed."). After the reset the chip and folder totals start from zero.
- **FR-029** `[IMPLEMENTED]` (sim: shots-021.js) Simulator: an in-memory `usageTotals`/`usageResetTotals` bridge (empty by default; **`simtotals=1`** seeds a previous run with totals for two folders plus one folder that is no longer listed, so the header shows more than this run's spend and existing simulator pictures stay as they are); a query parameter `simunreported=<room name>` makes that room's agents and their helpers report usage without `nanoAiu`, so the "credits not reported" text can be seen and photographed (issue #21).
- **FR-030** `[IMPLEMENTED]` (test: usagedoc, usagetotals; sim: screenshots) Tests, no credits: document validation, recording, reset, `since`, caps, corrupt and oversized files, hash key (no path in the written file), office sum including folders no longer listed; the store's debounce and flush; screenshots at 1440x900 and 1280x800: the chip after a "restart" (seeded baseline), the "credits not reported" room, the Settings part and its confirmation.
- Privacy (FR-007 still holds): the file holds numbers, folder display names and path hashes only; nothing is sent anywhere.
- Platforms: CI already runs `npm test` on Linux, macOS and Windows and the office layout check on Linux (issue #21 asked about the chip's rendering there); the Windows layout stays unchecked.

Backlog after this delta: capability flag for other adapters (spec 012). User Story 3 (multiplier) is covered by spec 030.
- `[KNOWN GAP]` (accepted, documented in the README) A reset while a usage event is in flight can leave this run's figure one call apart from the file until the next restart (main empties the file, the window clears its run when the reply arrives).
- FR-026 partly run for real (2026-10-17, no session, 0 AIU): the packaged-style app without the simulator read a seeded `durbar-usage-totals.json` from userData through `usage:totals` (a path key in the file was dropped), and `usage:resetTotals` emptied the file on disk.
- `[KNOWN GAP]` Not run end to end: recording from real `usage` events in `main.ts` (needs a real session that spends credits); covered by the store's unit tests and the simulator.

### 2026-10-18: usage units per agent kind (cross-reference to spec 012; T028, issue #47)

Spec 012 adds two agent kinds that do not report AI credits. The units stay separate and are never mixed:

- **Copilot**: AIU (`nanoAiu`), as in this spec. Unchanged.
- **Claude Code**: a USD amount that is the vendor's own **estimate**, never a bill: `UsageEvent.costUsd` with `costBasis: 'estimate'` (spec 012 FR-029, `read:` `src/adapters/claudeMap.ts` `result` handling; test: `scripts/test-claude-map.ts`). It is **never added to AIU**: `recordUsage` (`src/shared/usagedoc.ts`) and the renderer ledger (`src/renderer/usagetotals.js`) sum `nanoAiu` only, and a call with only `costUsd` counts as "did not report credits" (test: `scripts/test-usagedoc.ts`). `[KNOWN GAP]` (spec 012 T085): no screen shows the dollar estimate yet (`read:` `src/renderer/`, no `costUsd` display).
- **Codex CLI**: tokens only, no credits and no money (`read:` `src/adapters/codexMap.ts`; test: `scripts/test-codex-map.ts`). Its calls count as "credits not reported" under FR-021; never `0.00 AIU`.
- **Caps stay Copilot-only.** Claude and Codex are planned with `caps: false` (spec 012 C9), so the cap chip and the cap field are hidden for them (spec 012 FR-061 gating; sim: `scripts/shots-018.js` with `simkinds=mixed`, no cap chip on the claude, codex and basic agents). A separate dollar cap for Claude (`maxBudgetUsd`) is open question Q7, task T081 (needs the owner's approval); if it is accepted it gets its own delta here first.
- `[KNOWN GAP]` (spec 012 T043, T045, T067): no Claude or Codex adapter exists on `main`; the mappers run on synthetic fixtures only, never on a real account. The tooltips still say "as reported by the Copilot runtime" (`src/renderer/app.js`), which is true while only Copilot runs; per-kind wording is spec 012 T085.

### 2026-10-18: a very narrow room header shows the folder total in its tooltip (spec 001 FR-023)

- **FR-020** (delta) `[IMPLEMENTED]` In a room header narrower than 280 px (many one-agent folders on one screen) the folder total is not drawn in the header; it is in the room name's tooltip (`blog · 0.06 AIU`) and on the closed door plate as before, and the office header total still counts it. Wider headers are unchanged.

### 2026-10-20: Durbar enforces the Copilot cap itself (spec 013 C9, issue #288)

`real:` 2026-10-20, Copilot Pro (spec 013 `## Changes`, about 75 AIU): the Copilot runtime does **not** stop a running session at `sessionLimits.maxAiCredits`, and it never sent `session_limits_exhausted.requested`, although Durbar registers interest in it. It checks the cap only when a session is created or resumed ("This session has already used 42.63 AI credits. The session limit must be above 42.63."). A 30-credit session reached 42.6, and a turn that **started** over its cap still ran. FR-015's assumption (from GitHub's docs) that "the runtime blocks the next model call" is wrong for this runtime. So the Copilot adapter enforces the cap itself, behind the same `limit` events, dialog and IPC (no new UI):

- **FR-070** `[IMPLEMENTED]` **Used credits.** The adapter tracks each live session's used credits:
  - the last `session.usage_checkpoint.totalNanoAiu` (the runtime's own session total, resume included);
  - plus the `assistant.usage` `copilotUsage.totalNanoAiu` that arrived after it.

  The cap in force is the start cap, changed by `setCap`, by a runtime `session_limits_changed` event or by an answer below.
- **FR-071** `[IMPLEMENTED]` **Before a send.** When a cap is set and used ≥ cap:
  - the message is **held**, not sent;
  - the adapter emits `limit {phase: 'exhausted', requestId: 'durbar-cap-<n>', maxAiCredits, usedAiCredits}`, so the window shows *Spending limit reached* with *Raise limit / Remove limit / Stop here*;
  - `resolveLimit` with that id: `add N` raises the cap by N, `set N` sets it, `unset` removes it (each also sent to the runtime with `options.update`). Then `limit resolved`, and the held message is sent if the new cap is above what was used; otherwise a new `exhausted` follows;
  - `cancel` drops the message, then `limit resolved` and `status idle`.
- **FR-072** `[IMPLEMENTED]` **During a turn.** When a usage report makes used ≥ cap while a turn runs, the adapter stops the turn (`abort`; what the call in flight already spent stays, as before: the cap is soft by one call) and emits the same `exhausted`, with nothing held. After *Raise* or *Remove*, the agent is idle and the next message goes through.
- **FR-073** `[IMPLEMENTED]` Stop and End answer a Durbar-raised limit like a runtime one: the held message is dropped.
- **FR-074** `[IMPLEMENTED]` A runtime-raised limit (`session_limits_exhausted.requested`), should a future runtime send one, still goes through `handlePendingSessionLimitsExhausted` as before.
- `test:` `scripts/test-copilot-cap.ts` on a fake session: held send, add, set, unset and cancel, still over after add, mid-turn stop, Stop dropping the held message, and the runtime path unchanged. Also covered: a resumed session's first checkpoint over the cap during a turn.
- `real:` 2026-10-20, Copilot Pro, **1.46 AIU**. The over-cap session from spec 013 C9 (75.73 used) was resumed on `gpt-6-luna` with a cap of 75.83:
  - one tiny prompt crossed it, to 77.18. The adapter raised `limit exhausted` (`durbar-cap-1`, max 75.83, used 77.18) once the runtime's checkpoint arrived;
  - after *Stop here*, the next message was **held**: `exhausted` `durbar-cap-2`, **no model call, 0 usage events**;
  - *Stop here* dropped it.
- `[KNOWN GAP]`: a long agentic turn is stopped only after the call that crosses the cap; that call's own cost is never cut. Durbar learns a resumed session's earlier spending only from the runtime's first checkpoint, so the first message after a resume is never held.

- **2026-10-21, spec 068 (coffee break), cross-reference.** When the cap is reached the agent now shows a coffee break "until you raise the limit" (card label *Coffee break* instead of *Limit reached*, figure in the lobby's coffee corner). The limit notice, its choices and the `limit` events are unchanged, and it never resumes by itself. `sim:` `scripts/shots-068-coffee.js` (Omar).

### 2026-10-22: tooltip wording of the totals (spec 052 FR-168, issue #464)

A data tooltip is at most 300 characters and 8 lines (spec 052), so the text of FR-019, FR-020 and spec 033 FR-016 is shortened and built in `usagetotals.js` `tooltip()`:

- **FR-019 (wording).** "Office total: X AIU", "N calls · 12k in / 3.4k out" (the word "tokens" is gone), "Saved since 2026-10-01 (reset in Settings); ended sessions included." (or "Since Agent Durbar opened; ended sessions included."), "This run: X AIU in N calls." (replaces "Since the app opened (or the last reset): ..."), "N calls without credits" (replaces "N calls did not report credits"), "Copilot's figure: 1 AIU = 1 credit, not a bill." (replaces "As reported by the Copilot runtime (1 AIU = 1 AI credit, not verified against billing)."). The office chip adds one more line, built there too (`opts.estimate`): "≈ $X = N AIU + $Y Claude (est.). Codex: no cost." (replaces "Estimated cost: ..."). `[IMPLEMENTED]` (test: usagetotals, worst case 300 characters and 8 lines).
- **Priority.** When the lines would pass 300 characters, the lowest priority go first: "Includes folders no longer shown", "This run", "N calls without credits". The head, the calls, the since line, the off-floor spend (spec 033 FR-016), the estimate and the footer always stay. The `aria-label` of the chip has every line (`opts.full`).

## Changes 2026-10-31: doors removed (pointer, spec 017 T024)

Spec 017 FR-029 (owner decision, no doors) removed the Office with cabins layout, the desk door button, meeting-room signs, room door plates, **Close all** / **Open all**, door-held schedules and the door refusal of remote control, and `door-art`, `--door-*` and the door words of the theme contract. Any requirement in this spec about those (door plates, plate totals or siren, door signs, collapse, Close all / Open all, the `door` field) no longer applies and is kept as a record; Hide folder, floors and the plain status word stay. See spec 017's table of what was lost and what remains.

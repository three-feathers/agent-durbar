# Feature Specification: AI-credit caps and usage display

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 011-014
title: AI-credit caps and usage display
status: building
note: exhausted flow unverified on a real account; FR-096 (near-limit words, SDK 1.0.32) specified, not built
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

- 2026-11-01 (sweep of the build): Escape closes a session dialog over Settings first, then Settings.

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

### 2026-10-31: account quota per agent app, read-only (issue #690; FR-080..FR-094)

Spec 011's totals are **session and app usage**, never an account balance. This delta adds a separate, read-only view of what each provider itself reports about the account's limits, under Settings > Agent apps (spec 051), through a bounded adapter call (spec 012). Existing pieces reused (FR-031): the Codex `account/rateLimits/read` and Copilot `account.getQuota` calls and their probes (spec 012 FR-156, spec 068 FR-002), the time parsing in `usagelimit.ts`, `isAuthError`, the account block and *Check again* of spec 051, **Continue in another app…** (spec 030 FR-042). Nothing is saved.

**Research matrix** (2026-10-31; read only. `real:` T059 done 2026-11-02, see *Changes*).

| | GitHub Copilot | Codex | Claude Code |
|---|---|---|---|
| Call | `client.rpc.account.getQuota({})`, `@experimental`; no session, no prompt | `account/rateLimits/read` on the short-lived app-server of FR-156; no thread, no turn | none found. `claude auth status --json` has account and plan only (spec 051 FR-011). `rate_limit_event` arrives only inside a paid turn (spec 068) |
| Spends credits? | no. `read:` SDK typings, spec 068 "free read"; `real:` earlier (2026-10-23, spec 051 FR-022) the count did not move around a throw-away session, and spec 012 FR-156 calls it on every sign-in check | no. `read:` spec 012 FR-156 "read-only call"; `real:` earlier in `verifySignIn` (spec 012 Changes), figures never looked at | no call is made, so nothing is spent. A call that could spend is **never** made automatically |
| Units | requests per snapshot (`entitlementRequests`, `usedRequests`), `remainingPercentage` | percent of a window (`usedPercent`, `windowDurationMins`) | not reported |
| Remaining / limit | both reported; `isUnlimitedEntitlement` (entitlement -1) | used percent only; no absolute limit | not reported |
| Reset | `resetDate` (ISO 8601) only: `read:` `AccountQuotaSnapshot` in SDK 1.0.24 has no epoch or estimated field (spec 068's `copilotQuotaReset` still looks for them; not read here) | `resetsAt` (seconds, no zone) | not reported through a free call |
| Freshness | no timestamp; `real:` it lagged minutes (spec 030 research, agent-apps), so "can lag" is shown | no timestamp; unknown | n/a |
| API-key or other sign-in | n/a | `real:` the call refuses an API-key sign-in (spec 012 FR-156 delta): "not reported", not signed out | n/a |
| Unknown, recorded | whether `getQuota` always reaches the server; overage semantics | `read:` the app-server's generated schema also has `rateLimitsByLimitId`, `credits` (a balance as a string), `ordinaryUsageAllowed`, `rateLimitReachedType`, `rateLimitUpsell` and `accountId`: not mapped; only `primary`/`secondary` are, and `accountId` and the upsell banner never leave the adapter. Its note says not to infer recovery from percentages or reset times, so a passed reset reads "not current", never "recovered". When the windows move is unknown | whether any free figure exists: `read:` none found |

The checked time is **when Durbar asked**, never a provider timestamp.

- **FR-080** `[IMPLEMENTED]` **Contract.** `src/shared/quota.ts` (pure, no imports, no vendor types): `QuotaBucket` (`id`, `label`, `unit`: `requests` or `percent`; optional `used`, `limit`, `remaining`, `usedPercent`, `remainingPercent`, `unlimited`, `resetsAt`, `resetZone`, `resetEstimated`, `windowMins`, `overageAllowed`), `QuotaRead` (what an adapter answers: `ok` with `source` and buckets, `not-reported` with a fixed reason, `failed` with a fixed failure kind) and `QuotaView` (what the window gets). An absent field stays absent and reads "not reported", never zero; a reported 0 reads 0.
- **FR-081** `[IMPLEMENTED]` **Adapter member.** Optional `accountQuota(): Promise<QuotaRead>` behind `capabilities.accountQuota` (Copilot, Codex; Claude Code has neither). Vendor shapes are mapped in `src/adapters/quotamap.ts`. Failure text from a vendor never leaves the adapter: only a fixed kind.
- **FR-082** `[IMPLEMENTED]` **Sanitising.** Every read passes `sanitiseQuotaRead` in main, and the simulator's fixtures too: numbers must be finite and non-negative (bound 1e12; percents capped at 100); text is one line, without control or bidi characters, at most 40 characters; at most 8 buckets; reset times more than 400 days ahead or unparsable are dropped; a shape that is not understood is a `malformed` failure, and so is an answer where no bucket has a usable figure. A bucket with none, beside others that have one, stays as a row reading "not reported", so the card never looks complete when it is not. Copilot's `remainingPercentage` below zero reads as 0 left, used up. The window escapes all of it again.
- **FR-083** `[IMPLEMENTED]` **Bounded refresh.** `src/main/quota.ts`. No timer and no polling: a read happens only when Settings opens or the New session dialog shows an app, if the last ask is older than 2 minutes (`open`), on *Check again*, if it is older than 30 s (`check`), or never (`cached`). One read per app at a time (a refresh joins it); each has an 8 s limit whose timer is cleared; a provider's rate-limit answer stops asks for that app for 5 minutes, also on *Check again*, and says so. An answer that comes after its time limit or after a newer ask is dropped.
- **FR-084** `[IMPLEMENTED]` **Errors are not success-shaped, and do not wipe.** A failed read (`unavailable`, `timeout`, `malformed`, `rate-limited`) keeps the last good figures but marks them **Last reading, not current**, with the failure, its time and the time of the reading. `signed-out` drops the figures, since they may belong to an account that left; so does a finished sign-in (`forget`) and an app that is no longer ready. A later `not-reported` answer replaces them.
- **FR-085** `[IMPLEMENTED]` **Stale is never current.** A reading is stale 15 minutes after its check, or once a bucket's reset time has passed (the figures are from before it, and that bucket is not called near or used up). The window works this out when it paints, with one timer armed for the next change while Settings is on screen, stopped when it closes.
- **FR-086** `[IMPLEMENTED]` **Display.** In each ready card of Settings > Agent apps, a block titled **Account limits**, with "From the provider; not a bill and not this session's usage": per bucket its label, used, limit and left with their units, the reset time in the viewer's zone (with the zone name, the zone the provider gave, and "estimated"), the source, the checked time, and a state word (*Current*, *Last reading, not current*, *Could not read*, *Not reported*, *Not checked yet*). All text at least 10.5px. Units are never added up or compared across apps, and no total exists.
- **FR-087** `[IMPLEMENTED]` **Near a limit.** Only from reported values: at or under 10 % left (`NEAR_PERCENT`, reported left percent, else 100 minus used percent, else used over limit) or used up at 0. Not for unlimited, a limit of 0 or a passed reset. **Warn and let people override** (owner, 2026-10-31): it is a note. It never blocks a start, a send or an app, and it sets no limit on a person's own money.
- **FR-088** `[IMPLEMENTED]` **Suggestion only.** Near a limit, the card names other apps that are ready, known to be signed in and not near their own reported limit, says limits are separate and not interchangeable, and, per live session of this app (at most 3), offers **Continue <name> in another app…**, the existing dialog with its review step (spec 030). A click finds the session again by id; one that has ended gets a note and no dialog. Nothing switches, routes or starts a prompt by itself, and permission modes are unchanged.
- **FR-089** `[IMPLEMENTED]` **The New session dialog** (also as Continue in another app) has one line for the chosen app (`quotaLine`): the reported state, "you can still start". An answer for an app no longer chosen, or a closed dialog, is dropped.
- **FR-090** `[IMPLEMENTED]` **Reusable channel.** IPC `harness:quota` (`ipcHandle`, in the allow lists, from the app's window only) takes `cached`, `open` or `check` and an optional app id, validated in main, and answers `{ ok: true, apps }` or `{ ok: false, error }`, never an empty success. Refused under the simulator, whose window has its own fake. Bridge `harnessQuota`; `window.exports.quotaLine(view, now)` gives one honest line for another screen. Spec 096 T041's plan line can use exactly these.
- **FR-091** `[IMPLEMENTED]` **No secrets, no per-session state.** No credential file is read and no token is asked for, collected or forwarded; Codex's fallback asks `getAuthStatus` with `includeToken: false`. The state is per app, in memory, with no session id; nothing is saved, logged or exported.
- **FR-092** `[IMPLEMENTED]` **Simulator.** `simquota=<mode>` or `simquota=copilot:near,codex:failed` (modes `current`, `near`, `exhausted`, `stale`, `failed`, `failagain`, `ratelimited`, `notreported`, `signedout`, `malformed`, `hostile`, `resetpast`, `unlimited`, `agingsoon`, `resetsoon`, `noread`, `partial`, `switched`, `nokey`, `usagebilled`), through the same pure functions as main. `simkinds=ready` has all three apps ready. Claude Code is always not reported, unless a fixture asks otherwise to test the window.
- **FR-093** `[IMPLEMENTED]` **Tests.** `scripts/test-quota.ts` (`test:quota`), `scripts/shots-011-quota.js` at 1440x900 and 1280x800.
- **FR-095** `[IMPLEMENTED]` **Another account's figures** (review of 7a179ce4; awaiting owner review). A sign-in changed in a terminal is not announced to Durbar. A read may carry `accountKey`, a salted one-way fingerprint (SHA-256, salt per run, 32 hex characters; `sanitiseQuotaRead` refuses any other shape), from Codex's `accountId` when the backend sends it and Copilot's local `getAuthStatus` login and host (`getQuota` names no account). It stays in main's memory: never stored, logged or sent to the window. A failed read of another account drops the kept figures; a good read replaces them anyway. With no fingerprint to compare, the window says "These figures may be from before a sign-in change."
- **FR-094** **Awaiting owner review.** Choices taken on the safer side (issue #690 asks for a product decision on the first):
  1. the near-limit threshold is **10 % left**, a note only, not a setting;
  2. Claude Code shows "not reported" rather than parsing limits from paid turns;
  3. Settings opening and the New session line read at most once per 2 minutes per app, so a sign-in change is seen soon;
  4. `signed-out` drops the last figures;
  5. the suggestion offers a session's existing dialog, never a new one by itself;
  6. FR-095's fingerprint and its label.
- `test:` `scripts/test-quota.ts` (`test:quota`), including the adapters on the fake SDK and fake app-server. `sim:` `scripts/shots-011-quota.js`, both sizes. `read:` the shapes, from SDK typings, the Codex app-server schema and earlier entries.
- `[KNOWN GAP]` Real shapes: `real:` T059 2026-11-02 (below); the Claude Code path has no call. A sign-in changed in a terminal is only seen at the next read (FR-095): up to 2 minutes after a read, or for as long as Settings stays open without Check again, the earlier account's figures can still read *Current*. Codex's `accountId` is optional and a failed Codex read carries none. `real:` T059 done.
- 2026-11-02 (`real:` T059, owner's OK 2026-11-02; Copilot CLI 1.0.98 / SDK 1.0.22, codex-cli 0.163.0, Linux, one Codex prompt of the shared check; no other prompt for this task). **Both reads are free and their shapes are as mapped.** *Codex* `account/rateLimits/read` on the probe child: 5 reads in a row (about 1.1 s each) gave identical figures, started no thread (the rollout count did not change), left no `codex app-server` child behind, and a read during a running turn answered the same; one tiny `gpt-6-luna` turn moved neither window (whole percents). The answer is `{rateLimits {limitId, primary, secondary {usedPercent, windowDurationMins, resetsAt (seconds)}, credits, planType, ...}, rateLimitsByLimitId, rateLimitResetCredits, accountId, ...}`: the mapping reads the real answer (5-hour and Weekly windows, reset times right). *Copilot* `account.getQuota` (about 0.25 s, no session): `quotaSnapshots` `premium_interactions`, `chat`, `completions`, each with `entitlementRequests`, `usedRequests`, `remainingPercentage`, `isUnlimitedEntitlement`, `resetDate`, `overage*` and **`tokenBasedBilling`**. *Claude Code* has no adapter call (confirmed: nothing is asked). **Finding for the owner (not changed):** this Pro account's snapshots say `tokenBasedBilling: true`, and `usedRequests` (premium) did not move over 5 real prompts and about 35 minutes (the session's own `totalPremiumRequestCost` was 0.33 per prompt). A card line "N of 1500 requests" can therefore read far below real use; whether to hide request counts when `tokenBasedBilling` is true is an owner decision. Not seen: an API-key Codex account, a signed-out Codex, Windows, macOS.
- 2026-11-02 (owner ruling, Vikram 06:25 UTC, after the real check above; changes FR-080 and FR-082 for Copilot): Copilot bills by usage (credits), not by request. A `getQuota` snapshot with `tokenBasedBilling === true` (exactly `true`; `real:` seen on every snapshot of the Copilot Pro test login, Copilot CLI 1.0.98) becomes a bucket with `billing: 'usage'` and **no count**: `used`, `limit`, `remaining` and the percents are dropped in the adapter and again by the contract, the premium bucket is labelled *Usage* (chat: *Chat*), and the card, the New session line and the near-limit check say *billed by usage, see GitHub* (never near or used up: there is no count to compare). The snapshot gives no credits figure, so none is shown or guessed; if a later runtime adds one it is a new spec line. A snapshot without the flag, or with any other value, keeps today's "requests" text. Also reworded as what is billed: the coffee-break source `Copilot premium requests` is now `Copilot usage` (`map.ts`, the simulator, `test-coffeebreak`), `docs/features.md` and `docs/harnesses.md`. Tests: `test:quota` both ways, four mutants killed; `shots-011-quota` `copilot:usagebilled` at both sizes, pictures looked at. **Still saying "premium requests" or "requests", not changed (listed for the owner):** specs 030, 051, 054, 068, 076, 099 and 013 in prose, `specs/030-*/research.md`, `specs/068-*/plan.md`, `docs/research.md` (already says credits), `docs/agent-apps.md` (the 2026-10-20 Copilot Pro entry), the spec 011 research matrix row "Units" (above), and the `FR-081` simulator buckets for a flag-less snapshot (kept on purpose).

## Changes 2026-10-31: doors removed (pointer, spec 017 T024)

Spec 017 FR-029 (owner decision, no doors) removed the Office with cabins layout, the desk door button, meeting-room signs, room door plates, **Close all** / **Open all**, door-held schedules and the door refusal of remote control, and `door-art`, `--door-*` and the door words of the theme contract. Any requirement in this spec about those (door plates, plate totals or siren, door signs, collapse, Close all / Open all, the `door` field) no longer applies and is kept as a record; Hide folder, floors and the plain status word stay. See spec 017's table of what was lost and what remains.
- 2026-11-02 (review of b639ed4a, Paco's side): **FR-084** a read still running when an app signs out or stops being ready is ignored, as after a sign-in (the generation is bumped through `forget`; before, its answer could land and show the old account's figures as Current after a new sign-in: the documented 2-minute gap does not cover this). **FR-082** a time string over 64 characters is not read (`quotaTimeMs`, `quotaZoneOf`; the zone pattern was quadratic on a long `resetDate`). Tests: `test:quota` both held-read cases and four hostile strings under 100 ms, three mutants killed; `shots-011-quota` proves no polling by recording every timer the page registers instead of sleeping, and waits with `until()`. Text that said T059 was not done corrected (changelog, limits, agent-apps). This branch still carries #1063's agent-apps trim until #1063 lands.

### 2026-11-02: every settings setter checks its save (issue #1023, FR-012)

`SettingsStore` (`durbar-settings.json`, FR-012) used to update memory and ignore the result of `save()` in most setters, so a failed write (read-only profile, full disk) was reported as done and the choice was lost at the next start. One private `commit(next, keep?)` now stores every change, and **what a failed save does depends on what the value is**:

- **Truth values roll back** (the default): the window shows the value, so memory must hold what is on screen and on disk: Serious mode, Notifications, Coffee break, Check for updates at start, Chat links (both), Characters, Places, the MCP warning levels, *Always continue* turned **on**, a looser or no default cap. Memory keeps the old value, the setter returns the value in force, and the `settings:*` reply says `ok: true` only when that is the value asked for.
- **Convenience and bookkeeping values stay in memory for the run** (nothing the person must be asked twice, nothing safer to lose): the session browser's one-time note (the browser must open on an unwritable profile), the announced version of an agent app (an update is announced once, spec 081 FR-016), the new-folder parent, and the theme (the window already shows it; the reply says `ok: false` and the window warns).
- **Safer changes stay in memory for the run:** the OS-sandbox *always continue* choice turned **off** (spec 087 FR-007c) and a tighter default cap (none to a cap, or lower). A failed save never leaves something less safe than the person asked for.

What is kept for the run is listed per setting (`isUnsaved(key)`, `unsavedKeys`, also in `settings:get`); the next save that works writes all of memory and clears the list, and a failed change of another setting never marks this one. Where a kept change matters to the person it says so: the spending limit reads "Applied for this run only: the limit of N AIU could not be saved and may be lost when Agent Durbar restarts." (again when Settings is reopened), the Agent apps undo says the choice is off for this run only and may be back after a restart, and *Always continue* that cannot be saved (rolled back) says "Continuing without the OS sandbox for this session only: Always continue could not be saved, so this note comes back." The window follows the same rule for the rows that roll back (one shared `saveFailed` in `screens.js`): on `ok: false` the control stays at, or goes back to, the value in force and the row reads "Could not save this setting. It stays on." (or off, or the value in words): Serious mode, Notifications, Coffee break, Chat links, the default spending limit, Check for updates at start (a rejected call too), and the Browser bar's *Open chat links in a new tab* (a toast; `browser:setLinksNewTab` is `ok` only when saved and in force, also with no store). PR #968 words its own row the same way with its own copy; whichever merges second swaps that copy for `saveFailed`. `[IMPLEMENTED]` `test: test-credits` (each setter on an unwritable path by the rule above, the flags per setting, a later successful save clears them, the IPC `ok` and `unsaved`), `test: test-sandbox-ops`, `test: test-browseripc` (`makeLinksToggle`, the browser note on an unwritable profile); `sim:` `check-settings-save` (both sizes; the rows above, the kept limit reaching the new-session dialog and Settings reopened, the Agent apps checkbox and undo, mutation-checked per row). `[KNOWN GAP]` Windows: a save can fail for a moment (antivirus or the indexer holds the file), which now undoes a truth value and says so; not verified on Windows. Fixed 2026-11-04 (issues #1094, #1047): see the next delta.

### 2026-11-04: `ok` comes from the write, and a failed save leaves no `.tmp` (issues #1094, #1047, FR-012)

- **`ok` is the write's own answer.** The "value now in force equals the value asked for" test of #1023 answered `ok: true` for a failed write of a value that was already in force (the rollback restores that same value), so the window said "Saved" for something that never reached disk. Every setter behind `setting()` (Serious mode, Notifications, Check for updates at start, Refresh MCP sign-ins, Coffee break, Chat links, the default cap) and the two used elsewhere as a success test (`setChatLinksNewTab` for the Browser bar's toggle, `setSandboxAlwaysContinue` for the sandbox note and the Agent apps undo; their callers read `ok`, and "still in force" stays `value`) now returns `{ ok, value }` (the type `Saved<T>`): `ok` is true only when `commit()` wrote the file, `value` is the one in force. A refused value is `ok: false`. The IPC reply is `ok: r.ok && !kept`; the `unsaved` flag of a tighter cap kept for the run is unchanged (set only when the value asked for is the one kept). The same shape as #968's Still highlights setter (`{ ok, stillHighlights }`), which keeps its own reply.
- **No `.tmp` left behind.** `SettingsStore.save()` removes `durbar-settings.json.<pid>.tmp` in a `finally` when the write or the rename failed (best effort; a failing removal is ignored). Failure is still reported: `save()` returns false and the setter's `ok` is false.
- `[IMPLEMENTED]` `test: test-credits` (each setter, on an unwritable path, answers `ok: false` for the value already in force, over the store and over the IPC handlers; the `.tmp` is gone after an injected partial write and after an injected failed rename; the kept-for-this-run cases of #1023 unchanged); mutation-checked per setter and for both temp-file paths. `[KNOWN GAP]` Windows: a `.tmp` held open by antivirus may survive the removal; not verified on Windows.

### 2026-11-10: the simulator's monthly reset does not move with the minute (FR-092)

- The FR-092 Copilot fixtures' monthly reset (`current` and the other request modes, `usagebilled`) is the next UTC midnight 12 days on, not `now + 12 days` to the minute. Settings shows it to the minute, so two pages loaded seconds apart across a minute boundary read "06:10" and "06:11"; in the sans-serif the geometry check forces they are 182.8 and 182.0 px wide, and the Photo/Retro Settings comparison (spec 102 T220) failed on merge-queue run 42766660661 (PR #1440, unrelated to the change). The reset text now changes only at a UTC midnight. `[IMPLEMENTED]` `read:` the two widths measured in Electron on Linux xvfb with the Resets text set to each minute; `test: check:geometry` passes.

### 2026-11-13: the runtime's limit prompt can come at 90% (SDK 1.0.32; spec 058 delta 2026-11-13, issue #1667; FR-096)

**Status**: specified, not built; lands with the SDK bump (spec 058 FR-244, task T216 there, T074 here). Numbers checked with `npm run specs:numbers`.

**Why.** SDK 1.0.32's notes say interactive clients with a session-limits listener "are offered a top-up at 90% of the limit" (`read:`
bot-written release notes, data). It arrives as the same `session_limits_exhausted.requested` event with `usedAiCredits < maxAiCredits`; today
the mapper (`src/adapters/map.ts`, `case 'session_limits_exhausted.requested'`) turns every such event into `limit` `phase: 'exhausted'`, so the
window would say *Spending limit reached* while 10% is left. **Durbar's own cap is affected too** (`read:` code): Durbar sends the person's
cap to the runtime as `sessionLimits.maxAiCredits` (`setCap`, and on resume) and registers interest in `session_limits_exhausted.requested`
(`src/adapters/copilot.ts`), so on 1.0.32 the runtime's 90% offer most likely comes for a cap set in Durbar too: the agent waits at about 90%
of the person's cap with FR-096's words, where today it waits when used reaches the cap. Durbar's own `durbar-cap-<n>` request at 100%
(FR-071/FR-072) is unchanged. `[KNOWN GAP]` not seen on a real session; there is no "go on to the cap" choice at the 90% prompt (raise,
remove or stop only); if the prompt shows on Durbar caps in real use, a later delta adds one.

- **FR-096** **Close to the limit, not reached.** A runtime limit request whose used credits are below the cap (`used < max`, both finite
  numbers) is shown as **close to the limit**: the note reads "Close to the spending limit: used X of Y AIU. The agent waits for you." with the
  same choices (FR-014: raise, remove, stop here) and the same answer path (`resolveLimit`, `handlePendingSessionLimitsExhausted`); the card state
  and the office signs say "Close to spending limit" where they say "Spending limit reached" today. `used >= max`, or a missing or non-finite
  number, keeps today's *reached* words (fail safe: the stronger words). The normalized event gains one vendor-free field (`near?: true`) or an
  equivalent the plan picks; no new phase, so every consumer of `exhausted` still pauses the agent. `test:` the mapper with used 90/100 (near),
  100/100 and 101/100 (reached), missing used (reached), a missing or `Infinity` max with used 50 (reached), used `NaN` (reached); the window's
  note, the card state and the office sign for both. **Mutants:** `<=` for `<` (100/100 reads near); the finite check dropped (an `Infinity` max
  reads near); the card sign ignoring `near` (it says reached at 90/100).
  `[KNOWN GAP]` the runtime's 90% offer was not seen (no real session reached a cap; FR-015 stays unverified).

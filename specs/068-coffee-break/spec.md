# Feature Specification: Coffee break when a usage limit is reached

**Feature Branch**: `068-coffee-break` (amends 011/012 limit display, 024 places, 034 agent health, 052 wording and notifications)
**Created**: 2026-10-21
**Status**: Draft for the owner's review (spec only; no plan, tasks or code). Four open questions, each with a recommended default.
**Input**: Owner (Vikram, Telegram 2026-10-21): "Let's add a capability for coffee break when tokens are exhausted".

## Summary

When an agent cannot go on because a usage limit is used up (its agent app's plan window, a quota, or the spending limit the user set in Durbar), it does not sit in the office as an error. Its figure walks to a **coffee corner** in the lobby, its desk shows a cup, and its card and List row say **"Coffee break — resumes at 14:30"** when the reset time is known, or **"Coffee break — until you raise the limit"** for Durbar's own spending limit (with today's raise-limit action). When the limit resets, the agent comes back to its desk and, following the user's setting, **continues the turn it was in**. It never spends past a Durbar limit without the user, and it never retries on its own to find out whether a limit has reset.

## What already exists (reused, not rebuilt)

Checked on `main` 2026-10-21 (`read:` the code and specs named).

| Need | Existing capability | Where |
| --- | --- | --- |
| Durbar's own limit stops a session | normalized `limit` event (`exhausted` / `changed` / `resolved`), `resolveLimit` (add, set, unset, cancel), card state *Limit reached*, chat notice "Spending limit reached", cap chip | spec 011 FR-009..FR-017; Claude dollar cap spec 012 FR-150 (`src/adapters/claude.ts`); `src/adapters/map.ts`, `src/renderer/app.js` `showLimit` |
| Simple-mode wording for the limit and for a 429 | `taskText` ("Paused: reached the spending limit you set…", "The AI service is busy. Try again in a minute.") | spec 052 FR-057, `src/renderer/app.js` |
| The figure looks different at the limit | `faint` trouble (eyes closed, tilted head), room tone `alarm` with a siren | spec 034, `src/renderer/mood.js` |
| A cup on the desk | idle desks already draw a cup with steam (`--cup`, `--cup-line`, `--steam` tokens, themeable) | spec 036 FR-001, `src/renderer/app.js` desk scene |
| Walk to a place and back | lobby, places, visit state machine, walk animation (max 3 at once, reduced motion), `+N`, accessible labels | spec 024 FR-001..FR-011, `src/renderer/places.js`, `src/shared/places.ts` |
| Themed place names | scene words (`place-*`, `lobby-label`) per theme, AI-generated themes may rename them | spec 035/036 FR-003, `src/renderer/theme.js`, `src/shared/themegen.ts` `GEN_WORDS` |
| Send a message later, with a clock | scheduler core with an injected clock, one timer, busy-skip, missed-run rules, anchored times, daylight saving | spec 044, `src/main` scheduler |
| Re-send the last prompt | prompt memory (memory only, never written) and "Send again" on the sign-in card | spec 012 FR-157, `src/renderer/signin.js` |
| Needs you inbox, OS notification, badge | inbox item for a limit; one notification when the window is in the background | spec 052 (notifications), `src/renderer/attention.js` |
| Rate limit is not a sign-in problem | `NOT_AUTH` classifier | `src/adapters/autherrors.ts` |
| Simulator limit cases | Omar exhausts a 30 AIU cap in his first turn; Tomas fails with "provider rate limit reached (429)" | spec 010/011 FR-016, `src/renderer/sim.ts` |

What the agent apps already tell us, and what Durbar does with it today:

| Agent app | Signal | Reset time | Durbar today |
| --- | --- | --- | --- |
| Claude Code | `rate_limit_event` (`status`, `resetsAt`, `utilization`, `errorCode: "credits_required"`), claude.ai subscription sessions only | `resetsAt` (`read:` spec 012 research; field location unverified, spec 012 FR-077 `[KNOWN GAP]`) | only `credits_required` → error "Claude usage limit reached"; `resetsAt` dropped |
| Codex | failed turn with `codexErrorInfo: "UsageLimitExceeded"`; `account/rateLimits/updated` and `account/rateLimits/read` (`usedPercent`, `windowDurationMins`, `resetsAt` per bucket, ChatGPT plans) | `resetsAt` (`read:` spec 012 research) | error "Codex usage limit reached"; rate-limit buckets not read during a session |
| Copilot | `session.error` with `errorType: "quota"` (`quota_exceeded`, `session_quota_exceeded`, `billing_not_configured`) or `"rate_limit"` (`user_weekly_rate_limited`, `user_global_rate_limited`, `rate_limited`, `user_model_rate_limited`, `integration_rate_limited`); `auto_mode_switch.requested` (`retryAfterSeconds`); `session.quota_observation`; `account.getQuota` (`resetDate`, `resetDateEpochMs`, `resetDateEstimated`, `overageAllowedWithExhaustedQuota`) | `retryAfterSeconds` or the quota's reset date (`read:` `@github/copilot-sdk` typings) | error "<errorType>: <message>"; `auto_mode_switch` and `quota_observation` not handled |
| Durbar's own cap | `limit exhausted` (Copilot AIU cap, Claude dollar cap) | none: it lasts until the user raises the limit | *Limit reached* (waiting), faint figure |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A limit reads as a calm pause, not an error (Priority: P1)

As someone running many agents on a plan with usage windows, when an agent runs out of its window I see it on a coffee break with the time it comes back, instead of a red error and an ambulance.

**Independent Test**: simulator only (`DURBAR_SIM=15`, an agent configured to hit a plan limit with a reset 3 minutes ahead; no credits).

**Acceptance Scenarios**:

1. **Given** a Claude Code session on a subscription reports its usage window is used up with a reset time, **When** I look at the office, **Then** the figure walks to the coffee corner, the desk shows an empty chair and a cup, and the card says "Coffee break — resumes at 14:30" (local time, the user's 12/24-hour format; a day name when the reset is not today, a date when it is more than 6 days away).
2. **Given** the same for Codex `UsageLimitExceeded` or a Copilot `quota` / `rate_limit` error that stops the turn, **Then** the same coffee break shows, with the reset time when the agent app gave one.
3. **Given** a limit with no reset time, **Then** the card says "Coffee break — the limit resets later" and offers **Try now**; nothing retries on its own (see FR-007).
4. **Given** an agent on a coffee break, **Then** it is not counted as Error, gets no ambulance or siren, and its room keeps a calm tone.
5. **Given** the List view, Simple mode, the chat header and the Needs you inbox, **Then** each says the same words (FR-012).

### User Story 2 - Coming back when the limit resets (Priority: P1)

As the user, when the window resets the agent comes back and continues the turn it was in, without me watching the clock, and without spending more than I allowed.

**Acceptance Scenarios**:

1. **Given** an agent on a coffee break with a known reset time and *When a break ends* set to **Resume by itself**, **When** the reset time passes (plus a short margin), **Then** the agent walks back to its desk and Durbar sends one message to the same session: "The usage limit has reset. Please continue where you stopped." The chat shows a note "Back from the coffee break (resumed by itself)".
2. **Given** the setting is **Ask me**, **Then** at the reset time the agent walks back, the card says "Back from the coffee break — Resume?", an inbox item offers **Resume** and **Not now**, and nothing is sent until I choose.
3. **Given** the resumed turn hits the limit again within 2 minutes, **Then** it goes back on the break, and Durbar does not resume it on its own again until I do (no retry loop).
4. **Given** several agents of the same agent app are on a break with the same reset, **Then** they resume one after another, about 20 s apart, and the rest stay on the break if the first one hits the limit again.
5. **Given** the agent has a Durbar spending limit or its schedule has a per-run cap, **Then** a resume never raises or skips it; reaching it stops the turn exactly as today.
6. **Given** I send a message, stop, end or restart the session while it is on a break, **Then** the break ends and nothing is sent later on its own.

### User Story 3 - Durbar's own spending limit (Priority: P2)

As the user who set a spending limit, I see the agent on a coffee break "until you raise the limit", with today's choices.

**Acceptance Scenarios**:

1. **Given** an agent reaches its Durbar limit (Copilot AIU or Claude dollars), **Then** it goes on a coffee break, the card says "Coffee break — until you raise the limit", and the existing limit notice in the chat (raise, set, remove, cancel) stays the way to go on.
2. **Given** I raise or remove the limit, **Then** the blocked request continues exactly as today (spec 011), and the agent walks back. Nothing ever resumes on its own after a Durbar limit.

### Edge Cases

- **Short retries are not a break.** A 429 that the agent app retries by itself and recovers from, or a Copilot rate limit with an automatic switch to another model (spec 030 FR-015, `rate-limit` cause), is not a coffee break. Only a limit that **ends or blocks the turn** counts.
- **Copilot overage allowed**: when the account allows paid usage past the quota (`overageAllowedWithExhaustedQuota`), the agent app keeps going and bills; no break, and Durbar never turns overage on.
- **`billing_not_configured`** and other quota errors that no wait will fix: an error as today, not a break (FR-002).
- **The app is closed or the computer sleeps through the reset**: on the next start, a pending resume is **not** sent by itself; the agent shows "Back from the coffee break — Resume?" (same rule as spec 044 missed runs).
- **The reset time is in the past or absurd** (more than 31 days away, not a number): treated as unknown.
- **The window was reset early, or the reset time was an estimate** (`resetDateEstimated`): **Try now** is always offered.
- **A helper (sub-agent) hits the limit**: its parent's turn is what stops; only main agents walk.
- **A room is closed or its floor is off** while an agent is on a break: same as a lobby visit today (spec 024, 033): no figure, the door plate and counts still say coffee break.
- **15 agents all on a break**: the coffee corner shows as many figures as fit and `+N` (spec 024 FR-004); the layout does not grow.
- **Clock changes and daylight saving**: the resume time is an absolute instant (epoch ms); only the display follows local time.
- **The resume message itself**: it is a normal user message on the session's own permission mode; it costs credits like any message. After a long break the agent app's prompt cache has expired, so the first resumed call can cost more than a usual one (`real:` docs/agent-notes.md, cost trap). The resume tooltip says so.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** **One normalized event for provider limits.** Adapters emit a new normalized event (name decided in the plan, for example `usageLimit`) when the agent app reports that a usage limit stopped or blocked the turn: `{ scope: 'plan' | 'quota' | 'rate', resetsAt?: number (epoch ms), estimated?: boolean, source: string }`, where `source` is a short, safe label (for example "5-hour window", "weekly limit", "monthly premium requests"), never a raw provider message, account name or id. Agent specifics stay in the adapters (constitution II); the renderer and `src/shared` see only this event.
- **FR-002** **Which limits count** (mapping per adapter, unit-tested on fixtures):
  - Claude Code: a `rate_limit_event` whose status says the limit is reached (including `credits_required`), with `resetsAt`.
  - Codex: a failed turn with `UsageLimitExceeded`; `resetsAt` from the latest `account/rateLimits/updated` bucket that is at 100%, else none.
  - Copilot: `session.error` with `errorType: 'rate_limit'` (all `RateLimitErrorCode`s) when the runtime does not switch models by itself, and `errorType: 'quota'` with `quota_exceeded` or `session_quota_exceeded`; reset from `retryAfterSeconds`, else from `account.getQuota` (`resetDateEpochMs`, `resetDateEstimated`), asked at most once per break and only when free (it is a read call that spends nothing, spec 012 FR-156).
  - Durbar's own cap: the existing `limit exhausted` event; no new event (FR-010).
  - Not a break: `billing_not_configured`, authentication, policy, context-window limits, and any limit the agent app recovered from on its own.
- **FR-003** **Coffee corner.** A built-in place `coffee` in the lobby (spec 024), with its own icon (a cup) and the scene word `place-coffee` (default "Coffee corner"; [NEEDS CLARIFICATION: Q3] whether it is always shown). An agent on a break stands there; its desk shows the empty chair and a cup. The visit lasts for the whole break (not the 600 ms / 2 s tool rules); a tool walk never moves an agent that is on a break.
- **FR-004** **State and words.** A break is shown as its own attention state, **Coffee break**, listed with *Waiting* (it is something the user may act on), never as *Error*. Card and List sub-label: "Coffee break — resumes at HH:MM" / "— resumes Fri 09:00" / "— resumes 1 Nov" / "— the limit resets later" / "— until you raise the limit". The tooltip names the source ("Claude Code: 5-hour window") and whether the time is an estimate.
- **FR-005** **Figure and room tone.** On a break the figure has a calm look (holding a cup, eyes open); no faint, ambulance, dizzy or impatient trouble while on a break; the room tone stays `calm` for that agent (amends spec 034 `troubleOf` and `roomAlertOf`). [NEEDS CLARIFICATION: Q2] whether Durbar's own spending limit also switches from the faint look to the coffee break.
- **FR-006** **When a break ends** (Settings > Usage, per user, stored in `durbar-settings.json` and validated in main): **Resume by itself** or **Ask me**. [NEEDS CLARIFICATION: Q1] which is the default and whether it differs by kind of limit. The folder can override it like its cap (spec 011 FR-012).
- **FR-007** **Resume rules** (safety, constitution III and IV):
  - Only a break with a known reset time can resume by itself, at `resetsAt` plus 60 s; never before.
  - Durbar never probes: no message, no retry and no model call is sent to find out whether a limit reset. **Try now** is a user action. [NEEDS CLARIFICATION: Q4] what an unknown reset time does.
  - A resume sends exactly one message, the fixed sentence in User Story 2, to the same session, with the session's own permission mode and caps. It does not re-send the user's last prompt (that would repeat work) and never starts a new session.
  - Never after a Durbar spending limit, a per-schedule cap (spec 044 Phase 2), a stop, an end, a user message, or an app restart.
  - At most one automatic resume per break; a new limit within 2 minutes of a resume ends automatic resumes for that agent until the user acts.
  - Agents of the same agent app resume one at a time, 20 s apart, in desk order; when one hits the limit again, the others' automatic resume is cancelled and they show **Resume?**.
  - The timer lives in the main process, reuses the spec 044 scheduler core (injected clock, one timer, missed-run rules), and is kept in memory only: no break or resume is written to disk.
- **FR-008** **Scheduled prompts during a break.** A schedule due while its agent is on a break is skipped and recorded as "skipped: on a coffee break" (spec 044 busy rule); it is not queued.
- **FR-009** **Actions on a break**: **Try now** (sends the resume message now), **Stay on break** (cancels the automatic resume), and, for Durbar's limit, today's raise/set/remove/cancel. The chat composer stays usable; sending a message ends the break.
- **FR-010** **Durbar's own cap** keeps the spec 011 flow and events unchanged; only its presentation changes (coffee corner, words in FR-004) once Q2 is answered. It never resumes by itself.
- **FR-011** **Notifications.** Going on a break adds one Needs you item and one OS notification when the window is in the background (spec 052), worded "<Name> is on a coffee break until 14:30". An automatic resume adds a quiet chat note and no notification; **Ask me** adds an inbox item and one notification at the reset time.
- **FR-012** **Wording, Simple mode and themes.** The words "Coffee break" and "Coffee corner" are scene words a theme may rename (added to `CLEAN_WORDS` and `GEN_WORDS`; for example Durbar theme "Chai break" / "Chai stall"); status text, times and safety words stay plain English in every theme (spec 035). Simple mode shows the same sentence without the source detail; Expert adds the source and the agent app's exact limit name in the tooltip. Spec 052 FR-057's "The AI service is busy" stays only for short rate limits that are not a break.
- **FR-013** **Calm UI and layout** (constitution V): text at least 10.5px; with 15 agents (several on a break) at 1440x900 and 1280x800 the lobby with the coffee corner fits without overlap or scrolling the office (`npm run check:office` and `check:geometry` extended); no new strong colours; `prefers-reduced-motion` places the figure without a walk.
- **FR-014** **Accessibility.** The card and List row carry the full text; the coffee corner's label lists who is there and until when ("Coffee corner: Ada until 14:30, Omar until you raise the limit"); figures stay `aria-hidden`.
- **FR-015** **Platform parity** (constitution VI): times come from epoch ms and `Intl.DateTimeFormat` with the system locale; no OS scheduler, no shell, no wake-from-sleep timers; the same on Windows, macOS and Linux. A computer that slept through the reset follows the "app closed" rule.
- **FR-016** **Privacy** (constitution III): only the event fields in FR-001 leave the adapter; no account name, plan name, e-mail or raw provider text reaches the renderer, logs or notifications.
- **FR-017** **Simulator** (constitution IV, spec 010): the simulator can put agents on a break with a reset time a few minutes ahead (Claude-like and Codex-like), with no reset time (Copilot-like), and on a Durbar cap (Omar, as today), and resets them on its fake clock so both settings can be screenshotted and driven. A URL or env switch shortens the wait for drivers.
- **FR-018** **Tests, no credits**: adapter mapping fixtures for each signal in FR-002 (including "not a break" cases); the break/resume state machine with a fake clock (margin, one resume, 2-minute re-hit, staggered resume and cancel, missed while closed, stop/send/end cancel, Durbar cap never resumes); the scene words; the layout checks; a simulator driver with screenshots at 1440x900 and 1280x800.

### Key Entities

- **UsageLimit** (normalized event): scope, resetsAt?, estimated?, source.
- **Break** (per main agent, memory only): kind (`provider` | `durbar-cap`), since, resetsAt?, estimated, resumePolicy (`auto` | `ask`), autoResumeUsed, state (`on-break` | `back-ask` | `resuming` | `ended`).
- **Setting**: `breakResume: 'auto' | 'ask'` per user, optional per folder.

## Success Criteria *(mandatory)*

- **SC-001** On the simulator, an agent that hits a plan limit is shown in the coffee corner with "Coffee break — resumes at HH:MM" within 1 s, and is never counted as Error.
- **SC-002** With **Resume by itself**, the agent is back at its desk and working within 90 s after the simulated reset; with **Ask me**, nothing is sent until the user chooses Resume.
- **SC-003** In every unit-tested path, Durbar sends no message to an agent app during a break except the single resume (automatic or user-chosen): zero probes.
- **SC-004** A Durbar spending limit never resumes on its own (unit test and simulator driver).
- **SC-005** `npm run check:office` passes with 15 agents, five of them on a break, at 1440x900 and 1280x800.

## Open questions (max 4, each with a recommended default)

- **Q1 [NEEDS CLARIFICATION] Default for "When a break ends".** Options: (A) **Resume by itself** for plan and rate windows (no extra money: a subscription window just reopens), **Ask me** for quotas that may lead to paid usage (Copilot monthly premium requests); (B) Resume by itself for all; (C) Ask me for all. **Recommended: A.**
- **Q2 [NEEDS CLARIFICATION] Durbar's own spending limit.** Options: (A) also a coffee break ("until you raise the limit"), replacing today's faint figure and siren, still in Needs you; (B) keep the faint figure for Durbar's limit and use the coffee break only for provider limits. **Recommended: A** (one calm picture for "out of budget"; the inbox still asks).
- **Q3 [NEEDS CLARIFICATION] Coffee corner in the lobby.** Options: (A) a sixth place tile, always shown (the tiles do not shift when the first agent goes on a break); (B) shown only while someone is on a break; (C) no lobby tile: the figure stays at its desk with a cup. **Recommended: A**, if `check:office` still fits 15 agents at 1280x800; else C.
- **Q4 [NEEDS CLARIFICATION] A limit with no reset time** (some Copilot errors, a Claude event without `resetsAt`). Options: (A) coffee break with **Try now** only, no automatic resume, one reminder notification after 1 hour; (B) treat it as an error as today; (C) try again by itself every 30 minutes (spends credits). **Recommended: A** (C breaks "no surprise spending").

## Assumptions

- Decided by default here, open to change in review: the resume message is a fixed sentence, not a re-send of the last prompt; 60 s margin after the reset; 20 s between agents of one app; 2-minute re-hit rule; breaks are memory-only.
- `read:` only. No real session has been driven into a usage limit for this spec, and none will be without the owner's go-ahead (it spends a whole window or quota). The real shape and field location of Claude's `rate_limit_event`, Codex's `account/rateLimits/updated` during a turn, and Copilot's `retryAfterSeconds` / `resetDateEpochMs` are `[KNOWN GAP]` until a recorded run replaces the fixtures. Until then the README must say the reset time is shown "when the agent app gives one".
- Copilot's `auto_mode_switch.requested` (offer to switch to auto on a rate limit) is not handled by Durbar today; handling it is out of scope here (spec 030 owns model switches), so such an offer is not answered and the runtime's own default applies.
- Out of scope: an office-wide or daily budget across sessions; predicting a limit before it is hit (from `utilization`); sounds; helpers walking.

## Changes

(none yet)

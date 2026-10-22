# Feature Specification: Live verification of Stop, End/resume, lazy start, thinking, models and VS Code visibility

<!-- specs-index (the row in specs/README.md; after an edit run `npm run specs:index`)
group: 011-014
title: Live verification of Stop, resume and thinking
status: run 2026-10-19: C1-C7 pass on a real Copilot session (9 prompts, 0.31 AIU); several models, real cap, VS Code and macOS/Windows still open (2026-10-20: C8 still blocked, the login lists no models; C9 estimated and skipped); C8 and C9 run on Copilot Pro 2026-10-20 (C9: the runtime did not stop at the cap, see spec 011)
-->

**Feature Branch**: `013-live-verification-stop-resume-thinking`
**Created**: 2026-10-16
**Status**: Run 2026-10-19 (Linux, free plan, `auto` only): C1-C7 of [checklist.md](checklist.md) passed; C8-C10 recorded as not possible on this account and box. A verification plan, not a feature: its output is evidence (recordings, fixtures, spec updates), plus bug-fix spec deltas where reality differs.
**Input**: Features 002, 005, 006, 007, 009 each list behavior that was built on the simulator, fixtures and unit tests but **never run on a real Copilot session**. This feature closes those gaps once, deliberately, with a capped budget.

## Why this exists

The constitution (IV and VIII) forbids spending AI credits in `npm test` and forbids claiming what was not verified. So real checks must be separate, small, manual, budgeted and recorded. Until this runs, the specs and README say "unverified".

## Cost and approval

- Each check sends tiny prompts to a real session and uses the user's Copilot AI credits. **This feature needs approval before it is run**: the maintainer states the prompt budget (suggested ceiling: 15 prompts on a cheap model, `auto`/lowest multiplier) and the account to use.
- Nothing here runs in CI. Results are written into the specs (changing `[KNOWN GAP]` marks to `real:` with the date and the Copilot CLI/SDK versions) and into redacted fixtures under `scripts/fixtures/`.
- A raw-event capture dev tool exists in the working tree of this repository, untracked and not written by this spec work: `scripts/capture-raw.ts` (sends one prompt, records raw SDK events as JSON lines; `LISTONLY=1` lists models without inference). It spends credits; if kept, it must be specified (this feature, or 010) and reviewed before it is committed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Stop and End/resume behave as specified on a real session (Priority: P1)

**Acceptance Scenarios** (each: record SDK version, prompt count, result, and a redacted event fixture):

1. **Given** a real agent mid-turn, **When** I press Stop, **Then** the turn ends within a few seconds, the agent shows idle with the note, a pending permission (if any) is resolved as denied, and the next message works in the same session. (005 FR-013, 002 interrupt)
2. **Given** an agent I End, **When** I resume it from Previous sessions, **Then** the conversation continues with context (ask it to recall a word from before). (006 FR-009)
3. **Given** a lazily restored folder agent, **When** I send the first message, **Then** the session starts then and works; no session is created before. (006)
4. **Given** I send a second message while a turn runs, **Then** record what happens (queued, steered, error) and decide the product behavior. (005 FR-012, task T021)

### User Story 2 - Thinking and events look right (Priority: P2)

1. **Given** a model that emits reasoning, **Then** the thinking block streams and collapses; given one that does not, the "No reasoning summary was provided" note shows. (005)
2. **Given** a prompt that triggers a sub-agent, **Then** helper tiles appear and finish; record which events arrive (002 FR-013). Also record unmapped events (002 FR-014: shell output, user input, plan mode).
3. Capture one real `assistant.usage` event with `copilotUsage` to confirm the AIU field and units. (011)

### User Story 3 - Models, effort, caps (Priority: P2)

1. On an account with several models: list, multipliers and an effort-capable model; one tiny prompt with a non-default effort. (007 FR-006, T020) `LISTONLY` needs no inference.
2. A tiny `sessionLimits.maxAiCredits` cap: does the SDK stop or ask, and is it soft or hard? (011)

### User Story 4 - VS Code visibility and history on a real machine (Priority: P3)

1. A session this app created appears in VS Code's session list under the "External" filter and resumes in the terminal with `copilot --resume <id>`. (009 FR-012; needs a signed-in VS Code)
2. A real VS Code `chatSessions` store of a folder is read correctly by "VS Code chat history"; redacted copy added as a fixture. (009 FR-011)
3. Run the packaged app (not just `npm start`) on macOS and Windows once, with a real session. (008 FR-010)

### Edge Cases

- Free plan only offers `auto`: the multi-model checks need another account; record "not verified" rather than skipping silently.
- The runtime changes between runs: always record the CLI/SDK versions.
- Fixtures must be redacted (paths, usernames, prompts, tokens) before commit (constitution III).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** A written, numbered checklist (`checklist.md` via `/speckit.checklist`) lists every real check above with expected result, prompt cost and the spec FR it closes.
- **FR-002** A budget and account are approved before running; the actual prompt count and credits used are recorded.
- **FR-003** Evidence: for every check, date, OS, Copilot CLI and SDK versions, result (pass / fail / differs), and where applicable a redacted fixture or screenshot.
- **FR-004** Each finding updates the owning spec: `[KNOWN GAP]` → `real:` on pass; on fail/differs a spec delta under `## Changes` plus a task, then a fix through the normal workflow.
- **FR-005** Recorded fixtures are used to add credit-free tests (event mapping for 002 FR-011; history for 006; models for 007).
- **FR-006** The README's "Known limits" and status sections are updated to match.
- **FR-007** No tokens, session content or personal paths in committed evidence.

## Success Criteria *(mandatory)*

- **SC-001**: Every `[KNOWN GAP]` in 002/005/006/007/009 that says "never verified on a real session" is either `real:` (with date and versions) or explicitly deferred with a reason.
- **SC-002**: At least one redacted real event stream is in `scripts/fixtures/` and used by a credit-free test.
- **SC-003**: Total real prompts stayed within the approved budget.

## Assumptions and open questions

- [NEEDS CLARIFICATION] Which account and how many credits may be used; is a paid plan available for the multi-model checks?
- [NEEDS CLARIFICATION] Is a macOS/Windows machine available for the packaged-app check?
- Depends on: none for the checks; 011 and 012 consume the findings.

### 2026-10-19: results of the run (issue #3)

Real app driven by script (`DURBAR_DRIVER`), one real Copilot session in a throwaway folder (two small files), Read-only, model `auto`, Linux, Agent Durbar `main` at 0.1.0-alpha.5+. Approval: the owner's standing instruction quoted in [checklist.md](checklist.md). **Spent: 8 prompts, 0.309 AIU** in run A, plus 1 prompt in run B (well under the 12-prompt / 3 AIU budget).

- **C1 Stop (US1.1): pass.** Five seconds into "count from 1 to 300", Stop set the agent to Ready **0.3 s** after the click, with the note "Stopped by you. The agent is ready for your next message."; the next message ("Reply with the single word: ready") was answered in the same session.
- **C2 second message during a turn (US1.4): recorded.** While the agent was thinking about a 250-word story, a second message ("what is 2 plus 2?") was sent: it appeared in the chat at once, the runtime **queued** it, finished the story and then answered "4" (not steered, no error). The send button shows disabled while busy but the message still went out. Product decision recorded in 005 FR-012.
- **C3 End, then resume (US1.2): pass.** After "Remember the word pineapple", End set the agent to Ended; the next message resumed the same session and the answer was "pineapple".
- **C4 lazy restore (US1.3): pass.** After a restart with the same user data the folder's card said "Not started"; the first message started the session and the answer was "started".
- **C5 thinking (US2.1): pass.** A "Thought for 7s" block streamed and collapsed on one turn; on turns without reasoning the note "This model does not send reasoning for this step" was shown.
- **C6 sub-agent (US2.2): pass.** Asked to use its task tool, Copilot started a helper ("folder-file-count", listing README.md and notes.txt, Done, with Open), and the main agent answered "There are 2 files in the current folder."
- **C7 usage (US2.3): pass.** Usage reached the header as "10 calls · 112k in / 2.6k out tokens · 0.309 AIU" (AIU from `nanoAiu`).
- **C8-C10: not run** (only `auto` on this account; the minimum cap is 30 AIU; no VS Code and no macOS/Windows on this box). They stay open in 007, 011, 009 and 008.
- Also seen: the session title Copilot set from the first prompt ("Count from 1 to 300, one number per line, nothing else.") replaced the folder name on the card, as spec 002's title delta says.

### 2026-10-20: C8 and C9 still open (issue #288)

- `real:` 2026-10-20, 0 prompts: The Copilot login on the test machine is still a **free plan** on 2026-10-20: `listModels()` returned **no models at all** (it listed `auto` on 2026-10-17; the runtime now signs in through `gh`, `authType: gh-cli`), and the quota shows `premium_interactions` entitlement 0. `auto` sessions still run. So **C8** (several models and effort) cannot run.
- **C9** (a real cap of at least 30 AIU being reached) was estimated and skipped: on this plan a tiny `auto` prompt costs 0.07-0.26 AIU (measured the same day), so reaching 30 AIU needs more than 100 prompts, or a few long ones that would use most of the free plan's monthly chat quota. The runtime refuses a cap under 30 ("Minimum session limit is 30 AI credits", seen again on 2026-10-20). Both wait for the paid plan.

### 2026-10-20: C8 and C9 run on Copilot Pro (issue #288)

- **C8** `real:` (spec 030 `## Changes`, 0.43 AIU with T041/T044): two models in one session (`gpt-6-luna`, `mai-code-1.1-flash`), and effort low, medium and high applied through the model menu's `setModel`. The history was kept across the switches.
- **C9** `real:` (`scripts/paid-models-real.ts cap` and `capresume`, `claude-haiku-4.5` with ~60k-token fillers, then `gpt-6-luna`). A session created with `maxAiCredits: 30`:
  - **no limit event, and no refusal.** It passed 27.5 credits after two prompts; the third prompt started below 30 and ended at 42.6;
  - resuming it with a cap of 30 failed: *"This session has already used 42.63 AI credits. The session limit must be above 42.63."*;
  - resumed with a cap of 43 and later 58.6, a turn that started below the cap overshot it (to 58.3, then 74.05; near the 128k window each turn also compacted, about 15.7 credits for a "tiny" prompt);
  - resumed with a cap of 74.3 on `gpt-6-luna`, the **second prompt started at 75.6 credits, over the cap, and still ran**. No `limit` event in any run.

  So, on this runtime, the session limit is checked when a session is created or resumed, not before each turn, and it does not stop a running session. GitHub's docs say the next model call is blocked; that did not happen. **Durbar must enforce the cap itself** (spec 011 change, same day).
- Credits: C8 0.43 AIU; C9 about 75.7 AIU (the capped session's own total). All Copilot Pro checks of the day: about **81.8 AIU, about USD 0.82**, inside spec 030's Q8 budget of USD 1.

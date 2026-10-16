# Feature Specification: Live verification of Stop, End/resume, lazy start, thinking, models and VS Code visibility

**Feature Branch**: `013-live-verification-stop-resume-thinking`
**Created**: 2026-10-16
**Status**: Draft (backlog). A verification plan, not a feature: its output is evidence (recordings, fixtures, spec updates), plus bug-fix spec deltas where reality differs.
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

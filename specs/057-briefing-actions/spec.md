# Feature Specification: Briefing follow-through (safe mail reads and an action list)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Briefing follow-through (issue #128): safe mail and calendar reads for *Start my day* (the template says Read-only, but Read-only denies MCP), proposed actions in the Needs you inbox (Approve, Edit, Reject, Later, Hand to…) and their progress
status: draft
note: outline only, awaiting the owner's pick
-->

**Feature Branch**: `057-briefing-actions`

**Created**: 2026-10-20

**Status**: Draft: awaiting the owner's pick. Outline only: no `plan.md`, no `tasks.md`, no code. The open questions at the end come first (`/speckit-clarify`).

**Input**: Issue #128 (idea from @fjcabello, "Morning Briefing"), research of 2026-10-20. Phase 1 of the issue is already built as the *Start my day* starter template of Scheduled prompts (spec 044 FR-006..FR-008, owner decision 2026-10-19). This spec covers only what is still open: (1) the briefing cannot really read mail in the mode it says it works in, and (2) Phases 2-3 of the issue (proposed actions you approve, edit, reject, postpone or hand on, and see the progress of).

## What exists already (do not rebuild)

- **Start my day, Summarize my day, Plan my day** templates, daily or on a calendar rule, per folder or per session, with a per-schedule limit (spec 044 FR-006, FR-012..FR-015).
- **A decision at the end**: the agent asks with its own question tool, the agent shows *Waiting for you*, and does only what was chosen within its permission mode (spec 044 FR-008; `real:` on Claude only).
- **Needs you inbox** and **answer bar** (spec 052 FR-001, FR-027, FR-033): one queue of everything that waits for the user.
- **Since you were away** strip with missed scheduled runs (spec 052 FR-089); **OS notifications** that name only what is needed (spec 054 FR-011).
- **Activity log** of permission answers, mode and limit changes (spec 052 FR-071): the audit trail for "why was this allowed".
- **MCP**: the Copilot CLI list plus per-folder extras with a trust prompt (specs 019, 020); MCP forms and URL requests (spec 012 FR-151..FR-155). Mail and calendar come only through the user's own MCP servers; Durbar has no connector and holds no OAuth token (constitution III).

## Found during research (a gap in what is built)

`read:` `src/renderer/schedtemplates.js` says *Start my day* "Works in Read-only", but in Read-only the permission broker denies every MCP call (`src/adapters/permissions.ts`, spec 003 SC-001; Claude's Read-only hook denies MCP tools too, spec 003). So in Read-only the briefing cannot read mail or calendar at all; in Ask first it stops at the first mail read until the user approves. Not checked on a real session (spec 044 already lists *Start my day* against real mail servers as `[KNOWN GAP]`).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The briefing can read my mail without being able to send it (Priority: P1)

I schedule *Start my day* in a folder. At 08:30 it reads my mail and calendar through my MCP servers, and it can never send, change or delete anything there unless I approve it.

**Why this priority**: without it the briefing's core promise (read my inbox) does not work in the mode it recommends.

**Independent Test**: on the simulator, a sim MCP server with a `list_threads` tool (marked read) and a `send_mail` tool; the briefing's read calls succeed, `send_mail` is denied or asked.

**Acceptance Scenarios**:
1. **Given** the template note, **Then** it says truthfully what the mode must be (option A) or names the reads the user allowed (option B); never "Works in Read-only" while MCP reads are denied.
2. **Given** option B and a folder with `mail › list_threads` and `calendar › list_events` on its **Reads allowed in Read-only** list, **When** a Read-only agent calls them, **Then** they are approved and logged in the Activity log as `auto-read-allow`; **When** it calls `mail › send_mail`, **Then** it is denied as today.
3. **Given** an MCP server marks a tool read-only (Copilot's `readOnly` field on MCP permission requests, `read:` SDK `session-events.d.ts`), **Then** Durbar may *suggest* it for the list, but never approves a call on the server's word alone.

### User Story 2 - Proposed actions I approve one by one (Priority: P1)

The briefing ends with up to 10 proposals ("Reply to Ana about the contract: draft below", "Ask the api folder's agent to fix the failing test"). Each shows in the **Needs you** inbox under **Proposed**, with the full text and **Approve**, **Edit**, **Reject**, **Later** and **Hand to…**.

**Why this priority**: it is the "supervised actions" half of the issue, and it reuses the inbox instead of a new screen.

**Independent Test**: a sim agent ends its reply with a proposals block; the inbox lists them; Approve sends the instruction to the same agent; nothing else happens.

**Acceptance Scenarios**:
1. **Given** 3 proposals, **When** I press **Approve** on one, **Then** Durbar sends one message to the agent that proposed it ("Do proposal 2: <text>"), as if I had typed it. The agent's permission mode still asks before anything that writes or sends.
2. **Given** **Edit**, **Then** the text opens in the composer of that agent's chat, and nothing is sent until I press Send.
3. **Given** **Later**, **Then** the row hides until a time I pick (1 h, this afternoon, tomorrow 08:30) and comes back to the inbox.
4. **Given** **Hand to…**, **Then** I pick a folder's agent and the text opens in *that* agent's composer, not sent; Durbar never routes a proposal by itself.
5. **Given** **Reject**, **Then** the row goes away and nothing is sent.
6. **Given** the agent wrote no proposals block, **Then** the existing question card (spec 044 FR-008) is used, as today.

### User Story 3 - See how approved actions are going (Priority: P2)

Each approved row stays in **Proposed** with a state taken from the target agent: *Sent*, *Working*, *Waiting for you*, *Done* or *Error*, and links to the chat. The briefing agent's room shows a small count ("2 of 5 done").

**Acceptance Scenarios**:
1. **Given** an approved proposal, **When** the agent's turn ends with idle, **Then** the row reads *Done*; with an error, *Error*; while it waits on a permission, *Waiting for you* (the same request is also in the inbox's normal rows).

### User Story 4 - Reply drafts stay drafts (Priority: P3)

A proposal of kind `reply` carries a draft. Approving it asks the agent to save the draft in my mail app through my MCP server (a write: Ask first applies). Durbar never sends mail itself and has no mail code.

### Edge Cases

- A proposal's text came from mail the agent read: it is untrusted. Approving turns it into a message from me, so the row shows the **whole** text, marked "Written by the agent from your mail and files. Read before approving."
- Two briefings in two folders: proposals are grouped by agent.
- The proposing session ended: Approve and Hand to… still work as "open in a composer"; Approve on an ended session is replaced by **Open in a new session**.
- Profiles (spec 049): proposals belong to the profile they were made in.

## Requirements *(mandatory)*

### Safe reads (US1)

- **FR-001** **Option A (no behaviour change, a spec 044 delta):** the *Start my day* note says it needs **Ask first**, and that approving each mail or calendar tool *for this session* (the existing narrow grant, spec 003) lets later runs of the same session read without asking. The `test:schedules` template check asserts no template claims "Read-only" while it needs MCP.
- **FR-002** **Option B (needs the owner, it widens what Read-only means in constitution III):** per folder, a list **Reads allowed in Read-only** of exact `server › tool` names, edited in the folder's MCP extras dialog. In Read-only, an MCP request whose server and tool match exactly is approved; everything else stays denied. The list is shown as chips on the room's MCP button, is revocable, and is kept per folder (names only).
- **FR-003** A server's own read-only claim (Copilot `readOnly`, MCP `readOnlyHint`) is shown as a hint when picking tools for FR-002, and is never a gate on its own.
- **FR-004** Each auto-approved read is an Activity log row (new decision `auto-read-allow`), with the server and tool names only: never arguments or results.

### Proposals (US2, US3)

- **FR-010** A template may be marked `proposes`. Its prompt asks the agent to end with a fenced block ` ```durbar-proposals ` holding JSON: up to 10 items `{ "title": ≤120 chars, "detail": ≤2000 chars, "kind": "reply" | "task" | "delegate" | "other" }`.
- **FR-011** Durbar reads the block only from the **final reply of a scheduled run** of a `proposes` schedule (spec 044 FR-015 already knows the run's turn), parses it tolerantly with size caps (16 KB block, extra fields dropped, bad items skipped), and never executes, fetches or links anything from it. All text is set with `textContent`.
- **FR-012** The inbox gets a **Proposed** section below the requests that block an agent, oldest briefing first. Each row: agent and folder, title, the detail (folded after 6 lines, with *Show all*), the untrusted-content note, and **Approve / Edit / Reject / Later / Hand to…**. Keyboard: the inbox keys of spec 052 FR-033 plus **E** (edit), **L** (later), **H** (hand to).
- **FR-013** **Approve** sends one message through the normal send path (`agents:send`), with the agent's own mode and limit; it never changes a mode, grants a permission or raises a limit. **Edit** and **Hand to…** only fill a composer.
- **FR-014** State of an approved row (US3) comes from the target agent's normalized status after the send, the way spec 044 FR-015 attributes a turn. No new adapter event (constitution II).
- **FR-015** Storage: proposals live in memory only (lost on restart), unless the owner answers Q3 otherwise. They are never written to logs, usage files or the Activity log (only "proposal approved/rejected" with the agent name, if Q5 says yes).
- **FR-016** Simulator: a sim agent that ends a scheduled run with a proposals block, a sim MCP server with read and write tools, all at 1440x900 and 1280x800 with the inbox open (`check:office` unaffected: nothing new in the office itself except the count in FR-017).
- **FR-017** The room of an agent with open proposals shows a text count in its header ("Proposed 3"), opening the inbox at that agent. No new desk-card size (constitution V).

## Non-goals

- No mail, calendar or document connector inside Durbar, no OAuth flow, no token (constitution III). The user's own MCP servers only.
- No action runs without a click. No automatic routing to other agents. No proactive monitoring (scheduled runs already cover "every morning").
- No new room, floor or agent kind: the briefing is an ordinary session; proposals live in the inbox.

## Success Criteria *(mandatory)*

- **SC-001** On the simulator, a scheduled briefing produces proposals in the inbox, and Approve/Edit/Reject/Later/Hand to… each do exactly one thing, asserted by a driver.
- **SC-002** Unit tests: the proposals parser (caps, bad JSON, extra fields, more than 10 items, HTML in text), the exact-match read list (FR-002), and that a non-listed MCP call in Read-only is still denied.
- **SC-003** One real check per harness with a real mail MCP server the owner chooses (needs the owner's servers and approval), recorded as `real:` with its cost.

## Honest limits

- Proposals are only as good as the model; a malicious mail can make the agent propose a harmful step. The human reads the full text, and the step still runs under the agent's mode; that is the whole defence, and the UI says so.
- Option B trusts the user's list of tool names; a server that does something harmful under a "read" name is not caught. That is why the list is exact names chosen by the user, not the server's claim.
- Corporate mail often needs an admin-approved MCP app; Durbar cannot help with that.

## Open questions for the owner

1. **Q1** Safe reads: option A only (text fix, now), or also option B (a per-folder read list in Read-only, a narrow amendment of what Read-only denies)?
2. **Q2** Proposals as a structured block in the inbox (this spec), or keep only the question card of spec 044 FR-008 and stop there?
3. **Q3** Keep proposals across a restart (their text comes from mail, so in memory only is proposed)?
4. **Q4** **Hand to…** in scope for the first version, or Approve/Edit/Reject/Later only?
5. **Q5** Should approving or rejecting a proposal be an Activity log row (names only)?

## Assumptions and dependencies

- Builds on spec 044 (schedules, templates, turn attribution), 052 (inbox, Activity log), 003 (modes and grants), 019/020 (MCP extras), 012 (question tools on all three harnesses).
- Independent of spec 048 (office assistant) and spec 041 (Durbar MCP); neither is needed.

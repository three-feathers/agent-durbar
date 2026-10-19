# Feature Specification: Morning briefing ("Start my day")

**Feature Branch**: `050-morning-briefing`
**Created**: 2026-10-19
**Status**: Draft for the owner's review. No code until the owner answers the open questions below.
**Input**: Issue #128 (idea from @fjcabello, "Morning Briefing"). The owner asked for a spec on 2026-10-19.

## Summary

A **"Start my day"** button runs a briefing agent. The agent reads the user's own sources: mail, calendar, documents, GitHub issues, and the office itself. It produces a short, prioritised **briefing**: what needs a reply, what waits on others, what is blocked, what is due. It then **proposes** actions (draft replies, tasks, work to hand to other agents) that the user approves one by one.

**Durbar adds no connector, account or server of its own.** The briefing is an ordinary agent session in a folder the user chooses, on any harness. It reaches mail and calendar only through **MCP servers the user already configured** (for example Gmail, Google Calendar or Outlook servers), with the existing permission modes. That keeps constitution III (no secrets in Durbar) and keeps Durbar harness-neutral.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start my day (Priority: P1, Phase 1)

In Settings > Morning briefing I choose a folder for the briefing room (for example `~/briefing`), a harness and model, and which MCP servers it may use. Each morning I click **Start my day** in the top bar. A briefing agent starts in that room in **Read-only** mode, gets a fixed briefing prompt, and works like any agent: I see its tool calls and thinking. Its reply is the briefing.

**Acceptance Scenarios**:
1. **Given** the briefing is not set up, **When** I click Start my day, **Then** a short setup dialog asks for the folder, harness and MCP servers, and says that Durbar only uses servers I already configured.
2. **Given** it is set up, **Then** the agent runs in Read-only: it may read mail and calendar through MCP but cannot send, write or change anything. Every tool call shows in the chat like any other agent's.
3. **Given** the briefing finishes, **Then** a **briefing card** pins at the top of the room's chat with these sections:
   - *Needs your reply*;
   - *Waiting on others*;
   - *Blocked*;
   - *Due today*;
   - *From the office*: Durbar's own agents waiting, in error or finished overnight, taken from the local query layer of spec 048, with no model needed.

   Each item has its source link.
4. **Given** no MCP server for mail is configured, **Then** the briefing still runs on what is available (calendar, GitHub, the office) and says which sources were missing.

### User Story 2 - Proposals I approve (Priority: P2, Phase 2)

The briefing ends with **proposed actions**: a draft reply, a task, or "ask the api agent to fix the failing test". Each proposal is a row with **Approve**, **Edit**, **Skip**.

- Approving a reply or task runs it as **one message to the briefing agent in Ask first for that action only**. The agent then calls the MCP tool (for example `gmail.send_draft`), and the existing permission card asks once more with the exact tool and arguments.
- Approving a hand-off to another agent sends a message to that agent through the normal chat path (spec 048 Phase 3 rules).
- Nothing is sent, created or changed without these two clicks.

### User Story 3 - Every morning, by itself (Priority: P3, Phase 3)

A scheduled prompt (spec 044) can run Start my day at a set time while the app is open. It stays Read-only, so the proposals wait for me.

### Edge Cases

- **A mail body asks the agent to do something** ("forward this to …"). It is untrusted data: the briefing prompt says so, and in Read-only nothing can be sent anyway. Proposals always show their exact action.
- **A big inbox:** the prompt limits the briefing to the last 24 hours and 50 threads by default, set in Settings.
- **The briefing room is a normal room:** it can be hidden, put on its own floor (spec 033), or removed.

## Requirements *(mandatory)*

- **FR-001** Settings > Morning briefing:
  - folder, harness, model, effort;
  - the allowed MCP servers (from the user's own list and the folder's extras, spec 020);
  - time window, thread limit and a cost cap (AIU or $, spec 011 and spec 012 FR-150).

  They are stored in the settings file. No secrets.
- **FR-002** **Start my day** (top bar, and the room's ⋯ menu) starts or reuses the briefing agent in **Read-only** with the fixed prompt from FR-003.
- **FR-003** The prompt is shown in Settings and editable. It asks for:
  - the five sections, each item with its source link;
  - no actions in Phase 1;
  - all mail and document content treated as untrusted data;
  - no secrets repeated.
- **FR-004** The **briefing card** is the agent's final reply, shown pinned. Durbar does not parse mail itself. *From the office* comes from Durbar's own state (spec 048 FR-002).
- **FR-005** Phase 2: proposals are lines in a fixed, simple format that the prompt asks for, rendered as rows. Approve sends one message that turns Ask first on for that turn only and names the action. The existing permission card is the second confirmation.
- **FR-006** Nothing new is stored on disk beyond the vendor's session history and the settings. No mail content goes into logs, usage files or Durbar's data.
- **FR-007** Simulator: a simulated briefing agent with canned MCP tool calls and a canned briefing, at 1440x900 and 1280x800.

## Success Criteria *(mandatory)*

- **SC-001** Start my day works on the simulator with no AI credits, and the card fits both sizes (`check:office`).
- **SC-002** A test asserts that Phase 1 starts the agent in Read-only and that its prompt contains the untrusted-data rule.
- **SC-003** A real check with the owner's own mail or calendar MCP server and a tiny window (the last hour), recorded as `real:` with its cost, only with the owner's approval.

## Open questions for the owner

1. **Q1** Which mail and calendar sources do you use (Gmail, Google Calendar, Outlook/M365), and do you already have MCP servers for them? Durbar will not ship connectors.
2. **Q2** Should the briefing room be a folder you choose (proposed), or a private folder Durbar creates?
3. **Q3** Phase 2 actions: in scope, and is the two-click rule (Approve, then the permission card) right?
4. **Q4** Should *From the office* be part of Phase 1? It needs spec 048's query layer, so 048 Phase 1 would come first.

## Assumptions and dependencies

- It builds on:
  - spec 020 (MCP lists and extras), 003 (permission modes and cards), 044 (scheduled prompts);
  - 048 (office query layer), 033 (floors), 012 (harnesses), 011 and 012 FR-150 (caps).
- It depends on MCP servers that the user configures and trusts. Their security is theirs; Durbar shows every call.

# Feature Specification: Office assistant (ask the whole office)

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Office assistant: ask the whole office (who waits, what finished, usage by folder and harness) through a free local query layer, plus an optional model layer with no tools (issue #130)
status: **draft for the owner's review** (spec, plan, tasks; no code); research 2026-10-20 (*Changes*): most asks are covered by 052 (inbox, Cost, Activity log), 041 (MCP read tools) and 054 (remote); slim slice proposed: a status timeline, a Today tab and one 041 read tool; the panel with its own model parked (Q6)
-->

**Feature Branch**: `048-office-assistant`
**Created**: 2026-10-19
**Status**: Draft for the owner's review. No code until the owner answers the open questions below (Spec Kit: clarify, then plan and tasks).
**Input**: Issue #130 (idea from @fjcabello, "Global Assistant Chat"). The owner asked for a spec on 2026-10-19 ("all those 3").

## Summary

Today you learn what the office is doing by looking at cards, door plates and the Tools view, and by opening one chat per agent. The **office assistant** is one chat, not tied to any folder, where you ask the whole office a question: "what is everyone working on", "who is waiting for me", "which folder used the most this week". Every answer links to the agents it is based on.

**Two layers, cheap first:**
1. A **local query layer** answers the common questions exactly and for free, from data Durbar already has: the normalized events, the usage totals and the tool counts. It needs no model and works on the simulator.
2. An **optional model layer** is used only for free-form questions and summaries. It runs as a visible session of its own, on a harness and model the user picks, with its own cap and usage, and it only sees a snapshot that Durbar builds.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See what needs me, across all agents (Priority: P1)

I open **Office assistant** (a button in the top bar) and pick or type "Who is waiting for me?". It lists every agent that is waiting:
- for a permission, a question or a limit;
- in an error;
- or idle with an unread reply.

Each row has the folder, the reason and how long it has waited, and opens that agent's chat when clicked.

**Acceptance Scenarios**:
1. **Given** 15 simulated agents, 3 of them waiting, **When** I ask "Who is waiting for me?", **Then** exactly those 3 are listed, longest wait first, each with a link that opens its chat.
2. **Given** an agent on a floor that is switched off, **When** it waits, **Then** it is listed with "(floor Personal, off)".
3. **Given** no agent waits, **Then** the answer says so in one line.

### User Story 2 - Ask about work and usage in plain words (Priority: P1)

Built-in questions, offered as chips, are answered by the local layer with no model call:
- "What is everyone working on?" (each main agent's current intent or session title);
- "What finished today?" (agents that went from working to idle with a final reply since midnight);
- "What happened in the last hour?" (a timeline of status changes);
- "Usage today / this week, by folder / by harness";
- "Longest running", "Most tokens today".

**Acceptance Scenarios**:
1. **Given** Copilot, Claude and Codex agents, **When** I ask for usage by harness, **Then** Copilot shows AIU, Claude shows `≈ $… est.` and Codex shows tokens. **Units are never added together.** A comparison across harnesses compares tokens only and says so.
2. **Given** a figure a harness did not report, **Then** it shows "not reported", never 0.
3. Every number is labelled *measured* or *estimate* (constitution VIII).

### User Story 3 - Free-form questions with a model (Priority: P2)

I type a question the chips don't cover ("Summarize what the api folder did today and what is left"). With the model layer on, Durbar starts or reuses an **assistant session**. It sends that session the question plus a **snapshot**: per agent, its folder, harness, state, intent, session title, last N status changes, usage numbers, and the last reply of each main agent, cut short. The answer streams into the assistant chat, with links to the agents it names.

**Acceptance Scenarios**:
1. **Given** the model layer is off (the default), **When** I type a free-form question, **Then** Durbar says which built-in questions exist and how to turn the model layer on. Nothing is sent.
2. **Given** the model layer is on, **Then** the assistant session shows in the office as a separate agent ("Assistant"), with its own permission mode (Read-only, fixed), cap and usage, never hidden.
3. **Given** the snapshot contains text from agents' replies, **Then** it is wrapped as untrusted data, and the assistant has **no tools** in Phase 1, so it cannot act on anything it read.

### User Story 4 (Phase 3, later) - Supervised actions

"Ask the api agent to run the tests again." The assistant **proposes** one action at a time: send a message, Stop, End or Resume. It shows exactly what it would do, and only the user's click runs it, through the same paths as the chat. It never approves a permission, never switches a mode to Allow all, and never raises a cap.

### Edge Cases

- 0 agents: the assistant says the office is empty and offers Add folder.
- A helper's activity counts towards its main agent.
- Restarted app: "finished today" only knows what Durbar saw while it ran (the usage totals survive, the event timeline does not in Phase 1). The answer says "since Durbar started at 09:12".
- Multiple profiles (spec 049): the assistant answers inside the active profile only.
- The "Start my day" briefing is a starter template of Scheduled prompts (spec 044, issue #128), not part of this spec. It can use this query layer later for its *From the office* part.

## Requirements *(mandatory)*

- **FR-001** An **Office assistant** panel opens from the top bar, as a full-screen chat like an agent's chat with the agent strip. Built-in question chips sit above the composer.
- **FR-002** A pure **query layer** (`src/shared/officequery.ts`) answers the built-in questions from:
  - the normalized events of the live agents;
  - the usage totals (spec 011) and tool counts (spec 020);
  - the folder and floor data.

  It returns structured rows (agent id, folder, text, numbers with unit and basis), and the renderer formats them. It needs no adapter types (constitution II).
- **FR-003** Durbar keeps an in-memory, bounded **event timeline** per agent: the last 200 status changes with timestamps, no message text. "What happened" and "finished today" read it.
- **FR-004** Units: AIU, USD estimate and tokens are kept apart in every answer. A missing figure is "not reported".
- **FR-005** The **model layer** is off by default, and is switched on in Settings > Office assistant with a harness and model choice.
  - The assistant session runs in a private folder of Durbar's (an empty working directory, never a user folder), in Read-only, with **no tools and no MCP servers**.
  - It is capped by default at 30 AIU for Copilot or $0.25 for Claude. For Codex there is no cap, and the toggle says so.
- **FR-006** The **snapshot** sent to the model is built by Durbar:
  - per agent: folder name, harness, state, intent, title, the last 10 status changes, usage numbers, and the last reply cut to 1,000 characters;
  - at most 40,000 characters in all;
  - wrapped in a fixed preamble that says it is untrusted data from other agents. It never includes attachments, file contents or tool outputs.
- **FR-007** Every answer row that names an agent is a link that opens that agent's chat. In model answers, Durbar links agent names it finds in the text.
- **FR-008** Nothing new is stored on disk in Phases 1 and 2, except the assistant session's own vendor history (like any session). No assistant content goes into logs or usage files.
- **FR-009** Simulator: the query layer and the panel work on `DURBAR_SIM=15` with every harness kind. A simulated model answer is used for the model layer.

## Success Criteria *(mandatory)*

- **SC-001** On the simulator, every built-in question answers in under 100 ms with 15 agents, at 1440x900 and 1280x800, with no overlap (`check:office`).
- **SC-002** Unit tests for the query layer cover every question, mixed units, "not reported", floors that are off, and an empty office.
- **SC-003** With the model layer off, no question ever starts a model call (asserted by a test).
- **SC-004** One real check per harness of the model layer, recorded as `real:` with its cost.

## Open questions for the owner

1. **Q1 Model layer:** worth having in Phase 1, or ship the local query layer first and add the model later?
2. **Q2 Which harness and model** for the assistant by default: the cheapest the user has (proposed), or a fixed one?
3. **Q3 Mobile (Phase 2):** answer from Telegram through the user's own bot? A Durbar-side bot would need a token in Durbar, which goes against constitution III. Proposed instead: a local web view on the LAN after pairing. Or none.
4. **Q4 Persist the timeline** across restarts (status changes only, no text), so "what finished today" survives a restart?
5. **Q5 Actions (Phase 3):** in scope at all?

## Assumptions and dependencies

- It builds on spec 002 (normalized events), 011 (usage totals), 020 (tool usage), 033 (floors), 012 (harnesses) and 030 FR-034 (a session in a chosen harness).
- It is independent of spec 041 (the Durbar MCP server). The two could share the query layer later.

## Changes

### 2026-10-20: research for issue #130: what is already covered, and a slimmer first slice

*Status of this spec is unchanged: draft, awaiting the owner's pick.* Since this draft was written (2026-10-19), other specs built much of what it asks for. Nothing here should be built twice:

| Ask in #130 / this spec | Already covered by |
| --- | --- |
| "Who is waiting for me?" (US1) | **Needs you** inbox and answer bar, spec 052 FR-001, FR-027, FR-033 (built) |
| Usage by folder, periods (US2) | **Cost** tab in Tools with periods and CSV, spec 052 FR-044 (built); usage totals, spec 011 |
| What was approved, mode and limit changes | **Activity log**, spec 052 FR-071 (built) |
| Free-form questions about the office with a model (US3) | **Durbar MCP server**, spec 041: the user's own MCP client (Claude Code, Copilot CLI, Claude Desktop, VS Code) reads folders, agents with their state, floors and usage totals, read-only, with no prompts or chat text (FR-010..FR-013). In progress: read tools built, the server does not listen yet (T017). The user's client pays for the model, so Durbar needs no assistant session, cap or snapshot of its own. |
| Mobile access (Phase 2, Q3) | **Remote control**, spec 054 (Copilot per session, built; Claude channels and Codex planned). A phone can also reach spec 041 through a client that has its own remote route. |
| Notifications | OS notifications, spec 052 and spec 054 FR-011 (built) |
| Missed runs while away | **Since you were away**, spec 052 FR-089 (built) |

**Still missing (the slim slice proposed to the owner):**
- FR-003, the bounded per-agent **status timeline** (status changes and times only, no text), so "what finished today" and "what happened in the last hour" can be answered.
- A small part of FR-002: the query functions *working on*, *finished today*, *last hour*, *longest running*, as pure code in `src/shared`.
- Shown in two places only: a **Today** tab in Tools next to Activity (rows link to the chat), and one more read tool in spec 041 (*office timeline*), so the user's own MCP client can answer "what finished today?".

**Proposed to park:** the Office assistant panel with its own model session (FR-001, FR-005, FR-006; open question Q1), and supervised actions (US4, Q5). Revisit after spec 041 ships and someone has used it from a real client.

**New open question Q6:** is the slim slice above (timeline + Today tab + a spec 041 read tool) the version to build, instead of the panel?

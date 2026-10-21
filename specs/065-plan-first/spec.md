# Feature Specification: Plan first (the agent proposes, you approve)

**Feature Branch**: `065-plan-mode`
**Created**: 2026-10-21
**Status**: Built (adapters, UI, simulator, tests); real checks recorded under `## Changes`.
**Input**: Issue #429 (overnight research, 2026-10-21); owner: "go ahead with those features" (Vikram, terminal, 2026-10-21).

## Summary

For one message, the user can ask the agent to **plan first**. The agent reads what it needs and proposes a plan without changing anything. The plan appears in the chat with **Approve**, **Revise…** and **Reject**. On Approve the agent carries the plan out under the folder's normal permission mode. It is **not a fourth permission mode**: Read-only, Ask first and Allow all keep their meaning, and an approved plan in Read-only still cannot change files (constitution III).

## User Scenarios

### Story 1 - Plan before acting (P1)
In a chat, the user opens the mode menu and picks **Plan first (next message)**; a small chip "Plan first ×" sits above the composer. They send "Refactor the login module". The agent answers with a plan card (rendered Markdown). They press **Approve**; the agent implements it, asking for permissions exactly as the folder's mode says.

**Acceptance**:
1. Nothing is edited and no command is run while the plan is being made: the agent app's own plan mode is used (Copilot `mode.set plan`, Claude Code permission mode `plan`, Codex `collaborationMode: plan`).
2. The card shows the full plan text, the buttons are keyboard reachable, and text is at least 10.5px.
3. **Approve** continues in the folder's mode. In Read-only the card says: "It then runs in Read-only: changes will be refused."
4. **Revise…** asks for feedback, and the agent sends a new plan. **Reject** ends it; nothing runs.
5. Stop and End answer an open plan as rejected.

### Story 2 - Only where the app can do it (P2)
"Plan first" appears only for agent apps whose adapter reports `capabilities.planMode`; elsewhere it is not offered.

## Requirements

- **FR-001** `AdapterCapabilities.planMode?: boolean`. `AgentMessage.plan?: boolean` asks for a plan-first turn, and is honoured only when the capability is set (main checks it).
- **FR-002** A normalized event `plan {phase: 'proposed' | 'resolved', requestId, text?, action?}`. `AgentAdapter.resolvePlan?(sessionId, requestId, answer)` takes `{kind: 'approve' | 'reject' | 'revise', feedback?}`, with feedback of at most 4000 characters.
- **FR-003 Copilot:**
  - `session.rpc.mode.set({mode: 'plan'})` before the message, and the session's `onExitPlanModeRequest` emits `proposed` with `planContent` (or `summary`);
  - approve → `{approved: true, selectedAction: 'interactive'}` (never `autopilot`, which would widen the mode);
  - reject → `{approved: false}`; revise → `{approved: false, feedback}`;
  - afterwards `mode.set({mode: 'interactive'})`.
- **FR-004 Claude Code:**
  - a `set_permission_mode` control request to `plan` before the message;
  - Claude's `ExitPlanMode` tool call is answered by the plan card. The PreToolUse hook lets exactly `ExitPlanMode` through while a plan-first turn is open, and nothing else;
  - approve → allow, then `set_permission_mode` back to the launch mode of the folder's permission mode;
  - reject → deny ("The user rejected the plan. Stop and wait."); revise → deny with the feedback.
- **FR-005 Codex:**
  - `turn/start` with the experimental `collaborationMode: {mode: 'plan', settings: {model, developer_instructions: null}}`;
  - when the turn ends with a `plan` item, `proposed` is emitted with its text;
  - approve → the next turn in `default` mode, "Go ahead with the plan above.";
  - revise → a new plan turn with the feedback; reject → nothing is sent.
- **FR-006 UI:**
  - **Plan first (next message)** in the chat's mode menu sets a one-shot flag, with a chip above the composer to clear it;
  - the plan card has Approve, Revise… (multiline dialog) and Reject, keyboard first, with focus on Approve;
  - the desk shows "Waiting for your OK on a plan" (attention, like a question).
- **FR-007 Main and IPC:** the window-only `agents:resolvePlan` (`fromApp`) validates the id, the request id and the answer. `agents:send` takes `{plan: true}` only for an adapter with `planMode`.
- **FR-008 Simulator:** every simulated kind reports `planMode`. A plan-first send proposes a short plan after a moment; approve runs a normal turn.

## Constitution
- III: plan mode only narrows, so nothing runs while planning. Approve uses the folder's mode, and Allow all is never chosen for the user. Copilot `autopilot` is never selected.
- I/II: the capability sits behind `AgentAdapter`. No vendor types in the renderer.

## Changes

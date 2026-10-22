# Feature Specification: Plan first (the agent proposes, you approve)

<!-- specs-index (the row in specs/README.md; after an edit run `npm run specs:index`)
group: 046
title: Plan first: for one message, the agent proposes a plan in its app's own plan mode and you Approve, Revise or Reject; the approved plan still runs in the folder's mode (issue #429)
status: **built**; real 2026-10-21 on Copilot, Claude Code and Codex (reject: nothing changed; Copilot approve in Read-only: the change was refused)
-->

**Feature Branch**: `066-plan-mode`
**Created**: 2026-10-21
**Status**: Built, and checked on real Copilot, Claude Code and Codex sessions (2026-10-21, `## Changes`).
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

### 2026-10-21: built and checked on real accounts

- `test:` `scripts/test-plan-mode.ts`:
  - the helpers and the event guard;
  - **Copilot** on the fake SDK: `mode.set plan` before the message; approve → `{approved: true, selectedAction: 'interactive'}` (never `autopilot`, even when the runtime recommends it); revise → feedback; reject → `{approved: false}` and back to `interactive`; Stop rejects an open plan;
  - **Codex** on the fake app-server: `collaborationMode {mode: 'plan', settings: {model, developer_instructions: null}}`; the `plan` item becomes the proposal; approve sends "Go ahead with the plan above." in `default` mode; a later normal turn sends no collaboration mode;
  - a source pin: the answer IPC is window-only, and plan first needs `planMode`.
- `sim:` `scripts/check-plan-mode.js`, 1440x900 and 1280x800: the menu item (a checkbox, at least 10.5px), the one-shot chip, the card with Approve / Revise… / Reject and focus on Approve, Revise → a new plan, Approve → settled. Screenshots `docs/screenshots/066-plan-*`.
- `real:` 2026-10-21, one tiny request per app in an empty read-only folder ("create hello.txt"), then **Reject**; `hello.txt` was never created:
  - **Copilot** `gpt-6-luna`: a plan in 12 s, 0.25 AIU. With **Approve** instead, the agent tried to create the file and **Read-only refused it** (one permission event; no file), 0.24 AIU.
  - **Claude Code 2.1.305 (haiku):** a plan in 6 s, $0.049. Two findings fixed on the way:
    1. `ExitPlanMode` is a deferred tool loaded through `ToolSearch`, which Read-only's hook denied. During a plan-first turn only `ExitPlanMode` and `ToolSearch` (which loads definitions only) pass.
    2. `ExitPlanMode`'s input is **empty**: the plan lives in Claude's plan file, which Read-only rightly cannot write. The plan is then the text Claude wrote in the turn, and the plan-first message adds one sentence: "write the full plan in your reply, not in a file, then call ExitPlanMode".

    The two failed tries cost $0.14 and $0.058.
  - **Codex 0.163:** a plan in 7 s, about 16k input tokens on a ChatGPT plan.
- `[KNOWN GAP]`:
  - Claude's plan text depends on Claude following that sentence; if it writes nothing, the card says the plan is empty, and Reject or Revise still work;
  - Copilot `planContent` versus `summary` was seen only with `gpt-6-luna`;
  - macOS and Windows by hand.

### 2026-10-21: review fixes (reviewer pass on #441)

- **FR-003 delta** `[IMPLEMENTED]`: Copilot left plan mode only when a plan was approved or rejected. A plan-first turn that ended without a plan (the model just answered) left the runtime in plan mode, so later normal messages could never act. The adapter now remembers that it set plan mode, and the next normal message switches back to `interactive` first. `test:` `scripts/test-plan-mode.ts`.
- **FR-004 delta** `[IMPLEMENTED]`: Claude's plan draft (the turn's own text, used when `ExitPlanMode` carries no plan) is now bounded as it grows, keeping the last 40,000 characters; the card shows at most 20,000.
- Checked and unchanged:
  - approve restores the folder's own mode before the plan runs (Claude), and Codex runs it as a normal turn, so Read-only is never weakened;
  - Copilot approves with `interactive`, never `autopilot`;
  - `ToolSearch` and `ExitPlanMode` pass only while a plan-first turn is open;
  - sending plan-first and answering a plan are window-only (`fromApp`).
- `[KNOWN GAP]`: a Codex plan turn that ends with an empty plan shows no card; the chat shows Codex's reply as usual.

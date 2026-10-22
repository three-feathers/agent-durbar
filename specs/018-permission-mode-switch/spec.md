# Feature Specification: Change the permission mode at any time

<!-- specs-index (the row in specs/README.md; after an edit run `npm run specs:index`)
group: 015-018
title: Change permission mode any time
status: milestone 7
-->

**Feature Branch**: `018-permission-mode-switch` (milestone 7; amends 003)
**Created**: 2026-10-16
**Status**: Implemented (milestone 7)
**Input**: Vikram: Read-only / Ask first / Allow edits must be switchable per agent after creation, from the chat header and the office card.

## Acceptance
1. Chat header has a **mode chip** (dropdown); the office card has a small mode icon and a context menu (right-click / Shift+F10 / the icon button) with the same choices.
2. The change applies to the **next** permission request without restarting the session (the broker reads the mode dynamically).
3. Switching to **Allow edits** asks for confirmation ("Edits and commands will run without asking"). If requests are pending, the dialog offers to approve them now.
4. Switching **away from Allow edits** (or any switch while session grants exist) offers: keep or clear this session's grants.
5. The mode is persisted per saved folder and used when a restored (lazy) agent starts. The top-bar selector remains the default for *new* sessions.

## Requirements
- **FR-001** `PermissionBroker.setMode(mode)`, `approvePending()`; `CopilotAdapter.setPermMode(sessionId, mode, {clearGrants, approvePending})`.
- **FR-002** `AgentInfo.permMode` updates are pushed to the renderer (`agent:mode` event); IPC `agents:setMode`.
- **FR-003** Unit tests in `test-permissions.ts` (dynamic mode, pending + switch, grants).

## Changes

### 2026-10-18: live switch per agent kind (cross-reference to spec 012; T028, issue #47)

Mode names here follow spec 003 FR-028: the `allow` mode is shown as **Allow all** (this spec's acceptance text above still says "Allow edits", its older name).

- Each adapter declares whether its mode can change in a running session: capability `permModeSwitch: 'live' | 'next-message' | 'none'` (`read:` `src/adapters/capabilities.ts:22`; spec 012 FR-009).
- **Copilot**: `live`, as built here (FR-001 to FR-003; `read:` `src/adapters/copilot.ts:62`). Unchanged.
- **Claude Code**: planned `live` through the SDK's `setPermissionMode`; **Codex CLI**: planned `next-message`, applied from the next `turn/start`. Both are spec 012 T046, **not built**; there is no Claude or Codex adapter on `main` (`[KNOWN GAP]` T043, T045, T046).
- `[IMPLEMENTED]` (test: `scripts/test-modelswitch.ts`; sim: `scripts/shots-018.js` with `simkinds=mixed`, spec 012 T018) When a kind declares `none`, the renderer shows the mode as a plain label (tooltip "Set when the session starts") with no menu, and the switch does nothing (`read:` `src/renderer/app.js:1665-1669`, `src/renderer/modelswitch.js:192`); the menu lists only the kind's `permissionModes`. For `next-message` the toast says "Applies from the next message." instead of "from the next request" (`read:` `src/renderer/app.js:1714`; seen only on the simulator roster).

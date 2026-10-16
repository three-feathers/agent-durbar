# Feature Specification: Change the permission mode at any time

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

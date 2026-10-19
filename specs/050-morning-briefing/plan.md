# Implementation Plan: Morning briefing (050)

**Status**: Draft. Waits for the owner's answers in spec.md.

## Technical Context

The briefing is an ordinary agent session (any harness, spec 012) in a room the user picks. It uses the user's MCP servers (spec 020) and the existing permission modes and cards (spec 003). Scheduling uses spec 044.

## Constitution Check

- **III.** Durbar ships no connector and keeps no mail or calendar secrets: the MCP servers are the user's own. Phase 1 is Read-only, so nothing can be sent.
- **II.** Harness-neutral: the briefing is a prompt to a normal session.
- **IV.** Simulator first, with a canned briefing. Any real check uses a tiny window, only with the owner's approval.
- **V.** The briefing card is pinned, calm and fits both sizes.
- **VIII.** Missing sources are named in the briefing.

## Design

1. Settings > Morning briefing: folder, harness, model, MCP allow-list, window, limit, cap, and the editable prompt.
2. **Start my day**: `addWorkspace` (or reuse the room's agent) in Read-only with the allowed MCP servers only, then send the prompt.
3. Briefing card: the final reply of a turn started by Start my day, pinned in the room's chat. *From the office* comes from spec 048's query layer.
4. Phase 2: proposal rows parsed from a fixed line format. Approve sends a one-turn Ask-first message naming the action, and the permission card confirms the exact tool call.

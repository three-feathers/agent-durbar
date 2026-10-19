# Feature Specification: Full-screen chat and agent strip

**Feature Branch**: `005-chat-fullscreen-and-agent-strip` (reverse-engineered; milestone 6, built on the chat panel of milestones 1-5)
**Created**: 2026-10-16
**Status**: Implemented (reverse-engineered from `src/renderer/app.js`, `styles.css`, README)
**Input**: "Opening an agent replaces the office with the chat; every other agent stays visible in a slim strip so I never lose the overview."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Talk to an agent full screen (Priority: P1)

I click an agent; the chat fills the window. I see its status, task line, usage, model chip and folder, a thinking block, tool chips, the answer, and a composer.

**Independent Test**: `DURBAR_SIM=15`, click a desk, at 1440x900 and 1280x800; check for horizontal/page overflow (re-verified 2026-10-16: none).

**Acceptance Scenarios**:

1. **Given** the office, **When** I click a desk or press Enter on it, **Then** the chat opens full screen (top bar, floor and list are hidden) and focus moves to the agent's name. *(re-verified: panel opens; focus read:)*
2. **Given** the chat, **When** I press **Esc** or **Office**, **Then** the office returns and the desk I came from gets focus. *(read:)*
3. **Given** Enter in the message box, **When** the message is non-empty or has attachments, **Then** it sends; **Shift+Enter** adds a line; the box grows up to 110px. *(read:)*

---

### User Story 2 - Keep the overview in a strip (Priority: P1)

A 64px strip at the top shows every other visible agent (avatar, name, status dot and word, a short intent), scrolls horizontally, lists waiting and error agents first and highlights them. Clicking one switches the chat.

**Acceptance Scenarios**:

1. **Given** 15 agents, **When** a chat is open, **Then** the strip lists all 15 (the open one marked current). *(re-verified 2026-10-16: 15 strip items at both sizes)*
2. **Given** an agent starts waiting for me while I chat with another, **When** its status changes, **Then** it moves to the front of the strip and is highlighted. *(sim:)*
3. **Given** I switch agents, **When** the strip re-renders, **Then** its scroll position is kept and the current item is scrolled into view. *(read:)*

---

### User Story 3 - See the work (thinking, tools, approvals) (Priority: P2)

The turn shows a collapsible Thinking block (live counter "Waiting for the model · 4s" until text arrives, auto-collapses when the turn ends unless I touched it), tool chips (icon, name, one-line label, result; click to expand full command and output; latest 6 shown, `+N earlier`), the answer bubble with a caret while streaming, and permission notes inline (feature 003).

**Acceptance Scenarios**:

1. **Given** a turn with no reasoning text, **When** it ends, **Then** the block is replaced with "No reasoning summary was provided for this step." *(read:; real model behavior unverified, feature 013)*
2. **Given** 9 tool calls, **When** shown, **Then** 6 chips show with `+3 earlier`, expandable. *(read:)*

---

### User Story 4 - Stop, End, New session, Open in VS Code (Priority: P2)

Header actions: **Stop** (interrupt the turn; the agent stays ready), **End session** (frees it; sending resumes it), **+ New session** (feature 006), **Open in VS Code** (feature 009), **Copy resume command** (`copilot --resume <id>`).

**Acceptance Scenarios**:

1. **Given** a working agent, **When** I press Stop, **Then** the note "Stopped by you. The agent is ready for your next message." shows and the agent goes to Ready. *(test: broker part; sim:; **not verified on a real running turn**, feature 013)*
2. **Given** an ended agent, **When** I send a message, **Then** its session resumes and the message is delivered. *(read:; not verified on a real session)*

---

### Edge Cases

- A sub-agent's `thinking`/`output`/`status` events are ignored in the chat; its tool calls are shown in the parent chat. `[IMPLEMENTED]` read:
- Send failure: a red note "Send failed: ..." and the agent shows `error`. `[IMPLEMENTED]` read:
- Hidden folder while its chat is open: the chat closes. `[IMPLEMENTED]` read:
- A message typed in a simulated agent plays a canned turn; **Pause** exists only for demo/simulated agents (hidden for live agents). `[IMPLEMENTED]` read:
- Assistant and user text is inserted with `textContent` (no HTML injection). `[IMPLEMENTED]` read:

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** `[IMPLEMENTED]` re-verified 2026-10-16: While a chat is open the top bar, office floor and list are hidden (`body.panel-open`); the chat plus strip use the whole window with no page overflow and no horizontal overflow in the chat at 1440x900 and 1280x800 (SIM=12 and 15).
- **FR-002** `[IMPLEMENTED]` read: The strip is 64px high, horizontally scrollable, shows every visible top-level agent, orders waiting, then error, then stable order, marks the current one (`aria-current`), and each item has an accessible name with status.
- **FR-003** `[IMPLEMENTED]` read: **Esc** closes in this order: new-session dialog, folders popover, VS Code history view, then the chat. The **Office** button also closes the chat.
- **FR-004** `[IMPLEMENTED]` read: Header shows name, role, status pill, model/effort chip (live agents), folder, task line (full text in tooltip), usage line (calls, tokens, AIU), session-grant chips, and the action buttons above.
- **FR-005** `[IMPLEMENTED]` read: Thinking block as described in User Story 3, with a 1-second timer on streaming blocks; `thinking` deltas append live; the complete block is not repeated (feature 002).
- **FR-006** `[IMPLEMENTED]` read: Tool chips are focusable buttons (`aria-expanded`), expand on click/Enter/Space, show the first 2000 characters of output, and failed calls are marked.
- **FR-007** `[IMPLEMENTED]` read: Typing indicator while a turn runs; answer bubble with a caret until the final message.
- **FR-008** `[IMPLEMENTED]` read: Send is disabled (`aria-disabled`) when the box and attachments are empty.
- **FR-009** `[IMPLEMENTED]` read: Stop calls `interrupt` (feature 003 semantics); End session calls `end`; both toast what happened.
- **FR-010** `[IMPLEMENTED]` read: Copy resume command copies `copilot --resume <session id>` and explains to end the session here first (one process should drive a session at a time).
- **FR-011** `[IMPLEMENTED]` Closed by [spec 016](../016-markdown-in-chat/spec.md): assistant text is rendered as safe Markdown (code blocks, links that open outside, no raw HTML). Was: plain text only. (Task T020.)
- **FR-012** `[IMPLEMENTED]` real: (2026-10-19, spec 013 C2) a second message sent while a turn runs is shown at once and **queued** by the Copilot runtime: it is answered after the running turn finishes (not steered, no error). Product decision: keep it (queueing is useful); the disabled look of the send button while busy is only a hint. (Task T021.)
- **FR-013** `[IMPLEMENTED]` real: (2026-10-19, spec 013 C1 and C3) on a real Copilot turn, Stop set the agent to Ready 0.3 s after the click with the "Stopped by you" note and the next message worked in the same session; End set it to Ended and the next message resumed the same session with its context (it recalled a word given before End).
- **FR-014** `[KNOWN GAP]` Chat history lives only in renderer memory for the run; reopening the app shows an empty chat for a restored folder (earlier turns are available only through Previous sessions, feature 006). `read:`
- **FR-015** Partly `[IMPLEMENTED]` (2026-10-19, T024): each agent reply has a **Copy** button (the reply's Markdown as written) and each code block its own (the code only); they show on hover or keyboard focus and say "Copied". `[KNOWN GAP]` still no search or export in the chat. `sim:` `docs/screenshots/005-copy-buttons-1280x800.png`, the clipboard read back from the main process.
- **FR-016** `[KNOWN GAP]` The open-chat densities noted in the README (`card` at 1440x900, `mini` at 1280x800 for the office behind it) are not exercised by this feature's checks; only the chat layout was re-measured. See feature 001.

### Key Entities

- **Chat**: DOM tree per agent (`chats[id]`), a current **turn** (`thinking` block, chips, bubble) and a `busy` flag (non-live only).
- **Strip item**: root agents only, helpers are not listed.

## Success Criteria *(mandatory)*

- **SC-001**: With 15 agents the open chat shows all 15 in the strip and does not overflow the page at 1440x900 and 1280x800 (re-verified 2026-10-16).
- **SC-002**: Waiting and error agents are the first items of the strip (sim:).

## Assumptions

- Chat content is not persisted by Agent Durbar; the Copilot runtime keeps the session history on disk.

## Changes

### 2026-10-19: Stop and End session from the office card menu (issue #251, task T026)

*Missing:* Stop and End session were only in the chat header (FR-009), so stopping or ending an agent meant opening its chat first. The office card menu (right-click on a card or a list row, spec 030 FR-022) offered only the permission modes and *Model and context…*.

*Corrected:*
- **FR-017** The card menu of a **live main agent** (office card or list row, not a helper, not the chat panel) also offers:
  - **Stop**: interrupts the running turn and keeps the session, the same `interrupt` as the header (FR-009). Shown only while the agent is working or thinking. When the agent's kind cannot interrupt (spec 012 FR-050), it is shown disabled with the reason.
  - **End session**: frees the session, the same `end` as the header. When the agent is working, thinking or waiting for you, it asks for confirmation first (the same rule as *Remove session*, spec 006 FR-017). An agent that is not started or already ended does not get it.
  - The same toasts as the header buttons. The items are separated from the mode items, keep the menu's keyboard focus rules (arrows, Escape, focus returns to the card), and use the 10.5px minimum.
- Simulator only (`DURBAR_SIM=15`): `check:office` opens the menu at 1440x900 and 1280x800 and checks it fits; no AI credits. `[KNOWN GAP]` not run against a real Copilot session (the calls are the same `interrupt`/`end` as the header).


### 2026-10-19: the chat view is checked automatically (task T025)

- `test:` `npm run check:office` now opens the chat of every main agent at 1440x900 and 1280x800 for three rosters (Copilot only, mixed kinds, session titles) and fails when the page overflows sideways or a chip or button of the chat header leaves the window or overlaps another (84 more checks; 302/302 with the CI fonts on 2026-10-19). This keeps SC-001 checked as the header gains controls (agent chip, Remove session, estimates).


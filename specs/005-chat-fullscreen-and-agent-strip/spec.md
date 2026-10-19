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
- **FR-011** `[KNOWN GAP]` Assistant text is shown as **plain text**: no Markdown, code blocks or links are rendered. `read:` (Task T020.)
- **FR-012** `[IMPLEMENTED]` real: (2026-10-19, spec 013 C2) a second message sent while a turn runs is shown at once and **queued** by the Copilot runtime: it is answered after the running turn finishes (not steered, no error). Product decision: keep it (queueing is useful); the disabled look of the send button while busy is only a hint. (Task T021.)
- **FR-013** `[IMPLEMENTED]` real: (2026-10-19, spec 013 C1 and C3) on a real Copilot turn, Stop set the agent to Ready 0.3 s after the click with the "Stopped by you" note and the next message worked in the same session; End set it to Ended and the next message resumed the same session with its context (it recalled a word given before End).
- **FR-014** `[KNOWN GAP]` Chat history lives only in renderer memory for the run; reopening the app shows an empty chat for a restored folder (earlier turns are available only through Previous sessions, feature 006). `read:`
- **FR-015** `[KNOWN GAP]` The chat has no search, copy-message button or export. `read:`
- **FR-016** `[KNOWN GAP]` The open-chat densities noted in the README (`card` at 1440x900, `mini` at 1280x800 for the office behind it) are not exercised by this feature's checks; only the chat layout was re-measured. See feature 001.

### Key Entities

- **Chat**: DOM tree per agent (`chats[id]`), a current **turn** (`thinking` block, chips, bubble) and a `busy` flag (non-live only).
- **Strip item**: root agents only, helpers are not listed.

## Success Criteria *(mandatory)*

- **SC-001**: With 15 agents the open chat shows all 15 in the strip and does not overflow the page at 1440x900 and 1280x800 (re-verified 2026-10-16).
- **SC-002**: Waiting and error agents are the first items of the strip (sim:).

## Assumptions

- Chat content is not persisted by Agent Durbar; the Copilot runtime keeps the session history on disk.

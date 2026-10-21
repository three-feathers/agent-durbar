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
- **FR-014** ~~`[KNOWN GAP]`~~ closed 2026-10-21 (see Changes): Chat history lives only in renderer memory for the run; reopening the app shows an empty chat for a restored folder (earlier turns are available only through Previous sessions, feature 006). `read:`
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
- **FR-017** `[IMPLEMENTED]` (`test:` `cardMenuActions` in `test:modelswitch`; `sim:` `check:office` card menu case at both sizes) The card menu of a **live main agent** (office card or list row, not a helper, not the chat panel) also offers:
  - **Stop**: interrupts the running turn and keeps the session, the same `interrupt` as the header (FR-009). Shown only while the agent is working or thinking. When the agent's kind cannot interrupt (spec 012 FR-050), it is shown disabled with the reason.
  - **End session**: frees the session, the same `end` as the header. When the agent is working, thinking or waiting for you, it asks for confirmation first (the same rule as *Remove session*, spec 006 FR-017). An agent that is not started or already ended does not get it.
  - The same toasts as the header buttons. The items are separated from the mode items, keep the menu's keyboard focus rules (arrows, Escape, focus returns to the card), and use the 10.5px minimum.
- Simulator only (`DURBAR_SIM=15`): `check:office` opens the menu at 1440x900 and 1280x800 and checks it fits; no AI credits. `[KNOWN GAP]` not run against a real Copilot session (the calls are the same `interrupt`/`end` as the header).


### 2026-10-19: the chat view is checked automatically (task T025)

- `test:` `npm run check:office` now opens the chat of every main agent at 1440x900 and 1280x800 for three rosters (Copilot only, mixed kinds, session titles) and fails when the page overflows sideways or a chip or button of the chat header leaves the window or overlaps another (84 more checks; 302/302 with the CI fonts on 2026-10-19). This keeps SC-001 checked as the header gains controls (agent chip, Remove session, estimates).

### 2026-10-21: known gaps revalidated

- **FR-014** closed by spec 006 FR-020/FR-021. After a restart a folder continues its last session, and opening its chat replays the earlier turns (`real:` 2026-10-19, two launches per harness, recorded in spec 006). Only that last session comes back; the folder's others stay under Previous sessions.

### 2026-10-21: file edits stream into the chat (owner report, Telegram 2026-10-21)

*Symptom (owner):* "Whenever an agent is editing files, nothing is shown in the chat. I have no clue what the agent is doing while I wait; only the number of seconds grows." The chat showed only "Working · 34s" while the model wrote an edit, and after it at best a chip with a bare tool name.

*Root cause (`read:` code, SDK typings and fixtures; no real session run):*
1. **The tool row appears only after the model has written the whole edit.** All three agent apps stream a tool call's arguments while the model writes them, and the adapters dropped that stream: Claude Code's `content_block_start` (`tool_use`) and `input_json_delta` stream events (`claudeMap.ts` read only text and thinking deltas, and emitted the tool `start` from the complete `assistant` message), Copilot's `assistant.tool_call_delta` (not mapped in `map.ts`; `tool.execution_start` comes after the arguments are complete), and Codex's `item/fileChange/patchUpdated` (not mapped in `codexMap.ts`). Writing a large file or a long `old_string`/`new_string` takes the model many seconds, and that is exactly the wait the owner saw.
2. **When the row did appear, it often had no file name.** The chat label takes the first string argument; Copilot's `apply_patch` sends one string (the patch, `real:` tool names and argument key names counted in local Copilot session logs, no content read), and Codex's `fileChange` was mapped to `{files: [...]}`, so both showed a bare `apply_patch`.
3. **No change was ever shown.** The edit's old/new text, patch or file content reached the renderer only as raw `args` (and was dropped for Codex). The only diff view is the permission card's *Show the change* (spec 052 FR-063), which a request in Allow all or a session grant never shows.
4. **The waiting line did not say what is going on.** "Working · Ns" counts the turn, whatever the agent does.

*Corrected (requirements):*

- **FR-018** Normalized edit payload (spec 002 event model, adapter-neutral): a `toolCall` event of a file-changing tool MAY carry `edit: { files: [{ path, kind, diff?, added?, removed?, movedTo? }], partial?, truncated? }`, where `kind` is `edit | create | write | delete | move`, `diff` is unified-diff text (`@@`, `+`, `-`, ` ` lines), `added`/`removed` are line counts and `partial` marks arguments still being written. Each adapter builds it behind the adapter boundary from its own shapes: Claude Code `Edit`, `MultiEdit`, `Write`, `NotebookEdit`; Copilot `edit`, `create`, `str_replace_editor`, `apply_patch` (JSON or raw patch text); Codex `fileChange` changes. No provider type reaches `src/shared` or the renderer. Other tools never carry `edit`.
- **FR-019** Streaming start: the moment an adapter learns from the argument stream that a file-changing tool started **and which file** it touches, it emits the tool's `start` (with the path as `args`), then `update` events with `edit` (`partial: true`) as the arguments grow, and the complete arguments as an `update` (or `complete`/`failed` as usual). The later "whole call" message of the agent app does not add a second row. Adapters that give no argument stream show the row at the app's own start event (as before) and the change at that point. Only file-changing tools start early (other consumers of `start`, such as places and tool usage, keep the arguments they read today).
- **FR-020** The chat shows a file-changing tool as an **edit row**: a verb in the present tense while it runs and the past tense when done ("Editing", "Creating", "Writing", "Deleting", "Moving"; "Edited", ...), the **file name in bold**, its folder in small text **relative to the agent's folder** (absolute only when the file is outside it), and the line counts "+12 −3". Several files: "Editing 3 files" with every file listed in the diff block, each with its own counts. The file name is **not** clickable: Durbar has no open-file action yet (spec 063 lists changed files read-only), so none is added here (decision D1).
- **FR-021** Inline diff: when the payload has a diff, a compact unified diff follows the row: removed and added lines coloured with the theme's tokens (the permission card's `.pdiff` colours), `@@` lines muted, monospace 11px, at most **12 lines** shown with a **Show all (N lines)** button, at most 400 lines rendered, longer text cut with "… N more lines not shown". It updates as the arguments stream in, at most once per animation frame per row, with no animation when reduced motion is asked for, and keeps the chat scrolled to the bottom only when it was there. A whole-file write shows the new text as added lines (Durbar does not read the file to compare).
- **FR-022** The waiting line names the current action: "Editing app.js · 12s" (seconds since that action started), "Running a command · 4s", "Reading notes.md · 1s"; back to "Working · Ns" when no tool is open, and "Waiting for the model · Ns" as before when nothing came yet.
- **FR-023** Simple mode: plain words on the row and the waiting line ("Changing app.js", "Changing 2 files", "Creating a file"), the counts kept, and the diff **behind a toggle** "See what changes (+12 −3)" (closed by default), as in the permission card. Expert shows the diff open (12 lines, Show all). The level can switch live.
- **FR-024** Safety and size: every diff and path passes `redact()` from `src/shared/redact.ts` in the adapter layer before it leaves for the window; a diff is cut at 20,000 characters per file (`clipDiff`) and at most 20 files are listed per call ("and N more files"); the argument stream kept per call is capped at 1 MB and parsed incrementally (re-parsed only after it grew by an eighth), so a huge write costs linear time. The text is set with `textContent` only (never HTML).
- **FR-025** Paths display the same on Windows, macOS and Linux: `\` and `/` both split, a Windows drive letter and the folder prefix compare case-insensitively on Windows-style paths, and the separator shown is the one the path came with.
- **FR-026** The simulator (`DURBAR_SIM`) emits realistic edit calls: a streamed `Edit` (start with the path, two partial updates, then complete), a new file, and a two-file patch, with diffs, so the rows can be checked without an agent app.

*Decisions (defaults taken, the owner may change them):* D1 no clickable file names until an open-file action exists (a follow-up can add "Open in VS Code at this file" through spec 009). D2 only file-changing tools start early. D3 a whole-file write shows the new text as added lines. D4 12 lines open in Expert; Simple keeps the diff closed.

*Verification:* `test:` normalizers per adapter from fixtures and SDK typings (`test:edits`, `test:claudemap` additions, `test:codexmap` additions, `test:events` additions), the diff view helper (`test:editview`); `sim:` driver `check:edits` (row at tool start, diff rendered, Show all, masking, Simple toggle, no overflow at 1440x900 and 1280x800) and screenshots. `[KNOWN GAP]` not run on a real session of any agent app (0 credits): the argument streams of Claude Code (`input_json_delta`), Copilot (`assistant.tool_call_delta`, which the SDK types as ephemeral and "when known" for the tool name) and Codex (`item/fileChange/patchUpdated`) are taken from the SDK typings and the generated Codex types (`codex app-server generate-ts`, codex-cli 0.163.0), not from recordings.

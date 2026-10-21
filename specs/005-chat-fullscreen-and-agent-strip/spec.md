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

### 2026-10-21: readable JSON tool results, and outputs the agent app saved to a file (issue #361, tasks T037..T045)

*Found by the owner* (2026-10-20, a Copilot session with an MCP tool that returns JSON): an open tool chip (FR-006, widened by spec 052 FR-063) shows the result as raw text. When the tool returns JSON whose string fields are themselves JSON (`{"rawResponse":"{\"value\":[...`), the text is full of `\"` and hard to read. When the output was larger than the runtime's limit, Copilot wrote it to a temporary file and gave the model only a short preview; the chip does not say so, and in Read-only or Ask first the agent's attempt to read that file (outside the session's folders, spec 003 FR-023) is refused or asks, so the agent can look stuck.

*What exists today* (`read:` the code on `main`, 2026-10-21):
- The chip shows `ToolCallEvent.output` as escaped text: `makeChip` in `src/renderer/app.js` (20000 characters shown, "Show all" up to 1,000,000; closed line `SHORT(output, 60)` from `tTool`). Nothing is parsed as JSON.
- Tool output is **not masked** on its way to the chat: `outward()` in `src/main/main.ts` masks only `mcp` events (`maskMcpEvent`, `src/main/mcpmask.ts`), and `makeChip` only escapes. The page already loads `src/shared/redact.ts` as `window.DurbarRedact` (spec 001 FR-031, used by the live-activity readout through `liveact.js`).
- Adapters: Copilot takes `result.content` (`contentOf` in `src/adapters/map.ts`), Claude Code keeps the first 4000 characters of the `tool_result` text (`TOOL_OUTPUT_CAP`, `src/adapters/claudeMap.ts`), Codex the first 2000 (`CODEX_OUTPUT_CAP`, `src/adapters/codexMap.ts`). So a long JSON result often reaches the page cut in the middle.

*What the agent apps send when they save a large output* (research 2026-10-21, no session run, 0 credits):
- **Copilot** (`read:` the SDK types and the runtime binary of `@github/copilot-sdk` 1.0.22 / `@github/copilot-sdk-linux-x64` 1.0.22). `tool.execution_complete` has **no** dedicated field for it (`ToolExecutionCompleteData`, `dist/generated/session-events.d.ts:7489`); `result.content` is "potentially truncated" model-facing text (`:7605`), `detailedContent` is for display (`:7613`), and `toolTelemetry` is a free-form map (`:7553`). The runtime's strings contain the model-facing text "Output too large to read at once (*size*). Saved to: *path*", "Consider using tools like … or jq (for JSON) to examine portions of the output.", "Preview (first *N* chars):", a second form "[Truncated … full output (*size*) temporarily saved to *path*", the telemetry names `largeOutputWrittenToFile`, `largeOutputJsonFormatted` and `large_output_file`, and its own file-name pattern `(?:^|/)(?:\d+-copilot-tool-output-|copilot-tool-output(?:-original)?-|original-output-\d+-)`. Which of these reach Durbar's event (text in `content`, a telemetry flag, or both) is **unverified**: no recorded fixture in `scripts/fixtures/` has one.
- **Claude Code** (`read:` strings of the 2.1.304 binary; the wrapper was also seen in a Claude Code session's own tool results, not through Durbar). It replaces a large result with `<persisted-output>` … "Output too large (*size*). Full output saved to: *path*" … "Preview (first *size*):" … `</persisted-output>`, and also "Output exceeded the *size* persist limit; only the first *size* were saved to: *path*". The file is in Claude Code's own folder (`<config home>/projects/<project>/tool-results/`), not a temporary folder. Whether Durbar's `stream-json` `tool_result` carries this text, and whether Claude Code asks before reading its own `tool-results` file, is **unverified**.
- **Codex**: no saved-to-file behaviour found; it cuts long output instead (`read:` only what Durbar maps; the CLI was not installed on the research machine). `[KNOWN GAP]`: unverified.

*Specified* (not built; `[KNOWN GAP]` until T037..T044 are done; T045 is the real check):

- **FR-027** **JSON results are shown formatted.** When the output of a finished tool call (`complete` or `failed`), or the preview of a saved output (FR-031), is a whole JSON object or array (after trimming spaces; it starts with `{` or `[` and `JSON.parse` accepts all of it), the open chip shows it pretty-printed (2-space indent, monospace, the same scrollable block, 20000 characters and "Show all" as spec 052 FR-063) instead of the raw text. A small **Show raw** / **Show formatted** toggle switches to the text as received, and **Copy** copies the formatted text. The closed chip line says `JSON` and the size (for example "JSON · 12.4 KB") instead of the first 60 raw characters. Plain text, Markdown and anything that is not a whole JSON value is shown exactly as today. `update` events (streaming output) are never parsed.
- **FR-028** **Nested JSON strings are decoded, within limits.** Inside a parsed result, a string value whose trimmed text is itself a whole JSON object or array is replaced by its parsed value, and so on inside it, **up to 3 levels** of string-in-string. Strings that are not whole JSON, numbers in strings and JSON scalars in strings (`"true"`, `"12"`) stay strings. A line above the block says how many values were decoded ("2 nested values decoded from text"). Limits, all checked before work is done: input at most 1,000,000 characters (the chip's existing keep limit); each level only parses strings found by the level above, so the total parse work is at most 4 times the input; at most 50,000 values (objects, arrays and scalars) are visited; the formatted text is cut at 1,000,000 characters. When a limit is reached the chip shows the raw text with the note "Too large to format" (never a half-formatted view). The decoder is linear in its input: no regular expression runs over the whole text, and one long string or deep nesting (200 levels of `[`) does not make it slow or throw.
- **FR-029** **Masking.** The formatted text passes through `redact()` from `src/shared/redact.ts` (the page's `window.DurbarRedact`, the same module the live-activity readout uses, spec 001 FR-031) **after** decoding, so a key that was hidden behind escaped quotes (`\"Authorization: Bearer …\"`) is masked in the formatted view. No masking rule is copied into the renderer. Fail closed: when `DurbarRedact` is missing the formatted view is off and the chip shows the raw text as today. Whether the raw text is also masked is open (Q1).
- **FR-030** **Invalid or cut JSON falls back to text.** A result that only looks like JSON (cut at 4000 or 2000 characters by an adapter, a 500-character preview cut in the middle, a trailing log line, invalid escapes) is shown as plain text, unchanged, with no error and no partial formatting. A value nested in a string that fails to parse stays the string it was.
- **FR-031** **Normalized "saved to a file" flag.** `ToolCallEvent` gets an optional `savedOutput?: { bytes?: number; place: 'temp' | 'app'; preview?: string }` (`src/adapters/types.ts`), set by an adapter on the `complete` or `failed` event when its agent app reports that the full output was written to a file and the model got only part of it. `bytes` is the full size when the app states it (parsed from "33.8 KB", "49.4KB", "1.2 MB"); `place` is `temp` for a temporary folder (Copilot) and `app` for the agent app's own folder (Claude Code); `preview` is the part the app showed the model (the text after its "Preview" line), cut at the adapter's output cap. The **file path is never put in the flag**, and Durbar **never opens, reads, copies or lists the file**. Detection lives only in the adapter's mapper: Copilot (`src/adapters/map.ts`) from the "too large to read at once … Saved to:" text whose path's file name matches the runtime's own `copilot-tool-output` pattern, or from a `largeOutputWrittenToFile` telemetry flag if it is present; Claude Code (`src/adapters/claudeMap.ts`) from the `<persisted-output>` wrapper, read before the 4000-character cap; Codex sets nothing. The detection accepts both `/` and `\` separators (a Windows path such as `C:\Users\me\AppData\Local\Temp\…-copilot-tool-output-….txt`). The event guard (`src/adapters/eventguard.ts`, spec 010 FR-021) checks the field's shape. A tool whose own output imitates the marker only changes this one display line (it grants nothing and opens nothing).
- **FR-032** **One plain line for a saved output.** When `savedOutput` is set, the open chip starts with one line: "The full output (33.8 KB) was saved to a temporary file; the agent may ask to read it." (`place: 'app'`: "…was saved to a file in the agent app's own folder; …"; no size known: "The full output was saved to …"). The size is formatted by the renderer from `bytes`. The closed chip line says "Saved to a file (33.8 KB)". Below the line the chip shows the `preview` (formatted per FR-027 when it is whole JSON, else as text). In **Simple** mode the raw text with the app's instructions and the full path is not shown; in **Expert** the **Show raw** toggle shows the output exactly as the model received it (path included, because that is what the agent saw). No string of any one agent app is matched in `src/renderer`; the renderer reads only the normalized field.
- **FR-033** **Hint on the permission card (optional).** `PermissionInfo` gets an optional `savedOutput?: true`, set by the adapter on a `read` request (or a shell request whose command names the file) for a file it flagged under FR-031 in the same session, matched by the file name the adapter kept in memory (never sent to the page). The pending card, the Needs you inbox row and the Read-only refusal note then add one muted line: "This is the file where the agent app saved a large tool output earlier." It changes no decision: Read-only still refuses, Ask first still asks, nothing is approved for it automatically (Q4). Copilot first; Claude Code only if its own read of `tool-results` reaches Durbar's broker (unverified).
- **FR-034** **Checks and honest limits.** Unit tests cover the decoder (FR-027..FR-030), the mappers' flag (FR-031) on made-up fixtures for both Copilot forms, the Claude wrapper, a Windows path and a look-alike output, and the event guard. The simulator gets one MCP call that returns made-up nested JSON and one whose output was "saved to a file" (no real data); a driver built on `scripts/driver-helpers.js` checks both chips and takes screenshots at 1440x900 and 1280x800, Expert and Simple. The real text Copilot and Claude Code send for a saved output stays `[KNOWN GAP]` (`read:` only) until a real session is run with the owner's approval; Codex has no flag.

*Owner answers* (Paco, 2026-10-21: "Ok todo", option (a) for Q1-Q4; the tasks follow them):
- **Q1** Mask the raw output too? (a) **Yes: every tool output in the chip passes `redact()`, raw and formatted** (recommended: the same cost, and today nothing is masked); (b) only the formatted view, as the issue asks.
- **Q2** How does an open chip show JSON? (a) **Formatted at once, with Show raw** (recommended; the chip itself is already closed by default, so "collapsed by default" holds); (b) a closed "Formatted JSON" block inside the open chip; (c) a foldable tree per object (more code, later if asked).
- **Q3** Wording for Claude Code, whose file is not temporary: (a) **"…saved to a file in the agent app's own folder; the agent may ask to read it."** (recommended); (b) the same "temporary file" line for every app.
- **Q4** Should Durbar let the agent read the runtime's own saved-output file without asking, as it does for attached files (spec 003)? (a) **No, the hint only (FR-033)** (recommended: safe by default; the file can hold anything a tool returned); (b) yes, a read-only exception for that one file name in the same session.

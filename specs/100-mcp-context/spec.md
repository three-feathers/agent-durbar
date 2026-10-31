# Feature Specification: Warn when MCP tool definitions take too much of a session's context window

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: MCP context cost (owner 2026-10-31): each MCP server's tool-definition tokens (the agent app's own figure where it reports one, else estimated) in the MCP chip and dialogs, a calm warning at 15 % / 30 % of the session's window naming the heaviest servers, a compaction hint, never changes anything by itself
status: draft
note: spec, research, plan and tasks only; open questions Q1-Q6; nothing built
-->

**Feature Branch**: `100-mcp-context` (spec); code branches `100-pN-slug`, one per phase

**Created**: 2026-10-31

**Status**: Draft. Nothing is built. Open questions Q1-Q6 wait for the owner (*Clarifications*).

**Input**: Owner (Vikram, Telegram 2026-10-31 11:16 UTC): "I had an issue this week, I selected 200k context on Claude opus and it
compacted like 200 times in a session. And then realized that majority was taken by MCP servers in the context - can you raise warning
when MCP server list is taking too much context".

**Builds on**: [019](../019-mcp-tools-and-context/spec.md) (MCP servers, context chip), [030](../030-switch-model-context/spec.md)
(window, compaction events), [015](../015-thinking-and-subagent-activity/spec.md) and [005](../005-chat-fullscreen-and-agent-strip/spec.md)
FR-051..FR-056 (the context ring and its token summary), [058](../058-mcp-session-controls/spec.md) (the per-agent MCP dialog and
masking), [069](../069-mcp-global-controls/spec.md) (a server's tools, `listMcpTools`, per-folder single tools off).

## Why a new spec and not a delta

The MCP dialog belongs to 058/069 and the context ring to 005/030. This feature adds what none owns: a **per-server token cost**, a
**threshold warning**, and a **compaction-rate hint** that joins the two. Each touched spec gets a one-line dated pointer here.

## Research summary ([research.md](research.md))

| | Copilot (SDK 1.0.22) | Claude Code (2.1.309) | Codex (0.163.0) |
| --- | --- | --- | --- |
| Per-server MCP tokens | **Reported**: `metadata.getContextAttribution()` entries `kind: mcpServer` (experimental) | **Reported**: `get_context_usage` → `mcpTools[{serverName, tokens, isLoaded}]` | **Not reported**: estimated from `mcpServerStatus/list` tool schemas |
| Deferred tools (tool search) | `deferTools: auto`; counts exclude deferred | on by default; `isLoaded` per tool | unknown for MCP (`[KNOWN GAP]`) |
| Window | `limit` | `maxTokens` / `rawMaxTokens`, `modelUsage.contextWindow` | `modelContextWindow` |
| Compactions | events + `compactions.count` | `compact_boundary` | `contextCompaction` item |

All `read:` from types, schemas and CLI strings; nothing run on a real account.

## User Scenarios & Testing

### User Story 1 - See what each MCP server costs (Priority: P1)

In a running session the MCP chip reads "MCP 4/5 · ≈38k". The per-agent MCP dialog shows, on each server row, "≈12k tokens" (or
"12k tokens" when the agent app reported it), and a total line: "Tool definitions of these servers: ≈38k tokens, 19 % of the
200k window". Deferred servers say "loaded on demand: ≈0.4k".

**Why this priority**: the owner could not see where the window went; the number alone answers it.

**Independent Test**: in the simulator, a Copilot, a Claude and a Codex agent with fixture servers show the figures and labels.

**Acceptance Scenarios**:

1. **Given** a Copilot session whose attribution reports `mcpServer` entries, **When** the dialog opens, **Then** each row shows the
   reported tokens without "≈", and the footnote says "Reported by Copilot".
2. **Given** a Codex session, **When** the dialog opens, **Then** each row shows "≈N tokens (estimated)" and the footnote says how.
3. **Given** a server that failed or is off, **Then** its row shows no figure ("not loaded") and it is not in the total.

### User Story 2 - A calm warning when MCP takes too much (Priority: P1)

When the enabled servers' tool definitions exceed 15 % of the session model's window, one line appears in the chat: "MCP tool
definitions take 31 % of this 200k window (github ≈41k, jira ≈12k). This can make the conversation compact often." with
**Switch off for this session…**, **Open MCP servers** and **Dismiss**. The MCP chip turns amber (15 %) or red (30 %), with the
reason in its name and tooltip, never colour alone.

**Why this priority**: the owner asked for a warning; it must come before the window fills.

**Independent Test**: simulator fixtures at 10 %, 20 % and 35 % show no line, an amber line and a red line.

**Acceptance Scenarios**:

1. **Given** MCP at 20 % of the window, **When** the first figure arrives, **Then** one warning line shows; **When** Dismiss is
   pressed, **Then** it does not come back in this session unless the share crosses the strong level (30 %).
2. **Given** MCP at 20 % with a 1M window (200k tokens), **Then** the same rule applies (share, not absolute).
3. **Given** the warning, **When** nothing is pressed, **Then** nothing changes: no server is switched off.
4. **Given** Read-only mode, **Then** the warning and its actions are the same (they change Durbar's MCP choices, not the folder).

### User Story 3 - "It keeps compacting, and MCP is why" (Priority: P2)

When a session completes more than 3 compactions within 30 minutes and MCP tool definitions are at least the warning level, the
compaction line gains: "MCP tool definitions take 31 % of the window, so each compaction frees less. Switching off github would free
≈41k." with the same actions.

**Independent Test**: simulator script emits 4 compactions in 10 simulated minutes at 31 % MCP share: the hint shows once.

### User Story 4 - Change the levels (Priority: P3)

Settings → MCP servers: "Warn when MCP tool definitions take more than [15] % of a session's window, strongly above [30] %",
and "Off". Kept in Durbar's settings.

### Edge Cases

- **Huge server** (hundreds of tools, schemas of many kB): the estimate is computed in main on the tool list already fetched (spec 069
  FR-032 caps at 500 tools); a server over the cap shows "≥" and the figure of the part counted.
- **A server fails to list its tools**: its row says "size not known" and the total says "of the servers that answered"; no warning
  is raised from a partial total that is below the level, and one that is above is raised as "at least".
- **Window unknown** (before the first message on Claude and Codex): the figure shows in tokens, no percentage and no warning until the
  window is known; the share is then computed once.
- **1M window**: the same percentages; the line also shows the absolute tokens so a large but small-share cost is still visible.
- **Tool search on** (Claude Code, Copilot `deferTools: auto`): deferred tools count with their reported (small) cost, and the dialog
  says "loaded on demand". A warning on Claude Code with tool search on is therefore rare, which is correct.
- **Model or tier change** (spec 030): the share is recomputed against the new window when it is reported.
- **Sub-agents**: only the main agent's window counts (as the context ring).
- **Servers switched on or off live**: the figure is asked again after the agent app reports the new list (spec 058 FR-190 refresh).
- **Simulator** (`DURBAR_SIM`): fixture figures per app, no agent app call.
- **Agent app too old** (no attribution call, no `get_context_usage`): Copilot and Claude fall back to the estimate when tool schemas
  are available, else "size not reported by <app>" (`[KNOWN GAP]`).

## Requirements

### Measuring

- **FR-001** `AgentAdapter.mcpContext?(sessionId): Promise<McpContextReport>` with capability `mcpContext?: 'reported' |
  'estimated'`. `McpContextReport = {servers: {name, tokens?, deferredTokens?, tools?, source: 'reported' | 'estimated' | 'unknown',
  error?}[], window?: number, total?: number, partial?: boolean}`. Names and numbers only.
  - Copilot: `session.rpc.metadata.getContextAttribution()`; entries `kind === 'mcpServer'` summed per server (children by
    `parentId`), `limit` as the window; unknown kinds ignored. On error or `null`: `source: 'unknown'` (no listTools-based estimate,
    it has no schemas; Q4).
  - Claude Code: control request `get_context_usage` with `detail: 'summary'` (no extra network requests; Q2); `mcpTools` grouped by
    `serverName` (normalised names matched to `mcp_status` names as `claudeMap.ts` does), `isLoaded === false` counted as deferred;
    the window from `rawMaxTokens`, else `maxTokens`, else `modelUsage.contextWindow`. Labelled "reported by Claude Code".
  - Codex: `mcpServerStatus/list {threadId, detail: 'toolsAndAuthOnly'}` (the spec 069 call) and the estimate of FR-002;
    `source: 'estimated'`.
- **FR-002** Estimate (pure, `src/shared/mcpcost.ts`): per tool `ceil((name + description + JSON.stringify(inputSchema)).length / 4) +
  8`; per server the sum. No tokenizer dependency. Unit-tested on fixtures, including a 500-tool server and non-ASCII descriptions.
- **FR-003** When asked: once after the session's servers are first reported loaded, after any MCP switch or restart in that session,
  after a model or tier change, and when the per-agent MCP dialog opens (at most once a minute per session, as spec 058 FR-190). Never
  on a timer, never while a turn streams on Claude Code if the control channel is busy (queued to the turn's end). Time limit 10 s.
- **FR-004** Main holds the last report per agent in memory. Only server names, token numbers and the time persist (Q3); tool names,
  descriptions and schemas are never stored or logged. Server names pass the existing masking (`maskMcpError`) where shown in text.

### Showing

- **FR-010** MCP chip: "MCP on/total · ≈38k" (no "≈" when reported); the accessible name and tooltip say "MCP tool definitions:
  about 38 thousand tokens, 19 % of the window, estimated". At 1280x800 the token part may drop before the count (no overlap).
- **FR-011** Per-agent MCP dialog: each server row shows its tokens and label (`reported` / `estimated` / `loaded on demand` /
  `size not known`); a footnote names the source and, for estimates, "about 4 characters per token; the real figure can differ by a
  third". Sorted as today; the heaviest is marked in words ("largest").
- **FR-012** Settings → MCP servers: the last known figure per server and agent app ("≈12k in Codex, 0.4k on demand in Claude Code,
  measured 10:21"), or nothing when never measured. Durbar does not start servers to measure them (Q5).
- **FR-013** The context ring's token summary (spec 005 FR-052) adds an "MCP tools" bar when a report exists, labelled as estimated
  when it is.

### Warning

- **FR-020** Levels: warn above 15 %, strong above 30 % of the window (defaults, Q1); configurable 5-90 % in Settings, or off. The
  share uses only the tokens in the window (deferred tools count at their reported cost).
- **FR-021** Chip colour: amber at warn, red at strong; level also in the name and tooltip.
- **FR-022** One chat line per session at the first crossing (session start included: shown with the first figure), calm style
  (`note info`, the existing compaction-line look), naming at most the three heaviest servers with their figures, and actions:
  **Switch off for this session…** (opens the per-agent MCP dialog with the heaviest server focused; uses the existing
  `agents:setMcp`), **Open MCP servers** (Settings), **Dismiss**. Dismissed = not shown again this session unless the level rises from
  warn to strong. Not a notification, not a modal, not on the office card beyond the chip colour.
- **FR-023** Never changes anything by itself: no server, tool or model is switched.
- **FR-024** Partial or unknown: no line from estimates of a server that failed to list; "at least" when the counted part is already
  above the level; no line while the window is unknown.

### Compaction hint

- **FR-030** Per session, in memory: the times of completed compactions (`CompactionEvent` `complete`, any trigger except
  `truncation`). When more than 3 fall within 30 minutes (defaults) and the MCP share is at least the warn level, the compaction line
  (spec 052 FR-163) gets one extra sentence with the heaviest server and what switching it off would free, and the same actions.
  Once per session per level, dismissible.

### Safety, privacy, parity, limits

- **FR-040** Only server names and numbers reach the window; no env, header, URL, command, or secret value; no tool schema is stored.
- **FR-041** Read-only mode: same behaviour; the actions change Durbar's MCP choices only (as today's switch).
- **FR-042** No credits: the Copilot attribution and Claude `summary` reads make no model call (`read:`); Claude `full` is not used
  (Q2). The simulator and unit tests cover the feature; a real check needs the owner (`[KNOWN GAP]` until run).
- **FR-043** Adapter-neutral: vendor calls stay in adapters; `src/shared` and the renderer see `McpContextReport` only.
- **FR-044** `[KNOWN GAP]` Codex figures are estimates only, and whether Codex defers MCP tools is unknown. Copilot's call is
  experimental and may be missing on some plans. Claude `summary` figures are Claude Code's own estimates.
- **FR-045** UI: text at least 10.5px; the chip and dialog fit 1440x900 and 1280x800 with 15 agents; Windows, macOS, Linux alike.

## Success Criteria

- **SC-001** In the owner's case (MCP over 30 % of a 200k window) the warning shows with the first context figure of the session,
  before any compaction.
- **SC-002** Every figure says whether it is reported or estimated.
- **SC-003** No server is ever switched off without the person pressing a button.

## Clarifications

Open, each with a recommendation:

- **Q1 Levels.** Warn at 15 % and strong at 30 %? (Claude Code itself turns tool search on at 10 %.) **Recommend: yes, 15 / 30,
  configurable.**
- **Q2 Claude Code `detail`.** `summary` (Claude Code's local estimate, no requests) or `full` (token-count API requests: free, rate
  limited, network)? **Recommend: `summary`; `full` only behind a "Measure exactly" button later.**
- **Q3 Persist the last figures** (names, numbers, time) for Settings before a session starts? **Recommend: yes, in the MCP store
  file, numbers only.**
- **Q4 Copilot fallback** when attribution is missing: estimate from `listTools` names and descriptions (undercounts, no schemas) or
  show "not reported"? **Recommend: "not reported".**
- **Q5 Measure before a session** by having Durbar start each server and call `tools/list` itself? **Recommend: no** (Durbar would run
  the user's commands outside the agent app, with their secrets and sign-in; keep it to running sessions).
- **Q6 "Turn off for this folder"** for servers that are not folder extras (today only global or per session)? **Recommend: a
  follow-up spec delta to 069 (a per-folder off list fed into `forSession`); this spec offers per session and Settings.**

## Changes

- 2026-10-31: spec, research, plan and tasks drafted (owner report of 2026-10-31).

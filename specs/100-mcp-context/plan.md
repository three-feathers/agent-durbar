# Implementation Plan: 100 MCP context cost and warning

**Spec**: [spec.md](spec.md) · **Research**: [research.md](research.md)

## Constitution check

- I Spec Kit: spec, research, plan and tasks committed before `src/`; open questions Q1-Q6 answered before phase 2.
- II Adapters: one optional member `mcpContext?` with a capability; vendor calls (`getContextAttribution`, `get_context_usage`,
  `mcpServerStatus/list`) stay in `src/adapters/`; `src/shared` gets a neutral `McpContextReport` and the pure estimator.
- III Safe by default: read-only measurement; the warning never changes anything; names and numbers only reach the window; no schema
  stored; masking reused (`src/main/mcpmask.ts`).
- IV No credits: no model call (`read:`); unit tests on fake SDK, fake CLI and fake app-server; simulator fixtures.
- V Calm UI: one dismissible line, chip colour with words, text at least 10.5px, both sizes.
- VI Parity: no paths or shell involved.
- VIII Honest limits: every figure labelled; `[KNOWN GAP]` for Codex estimates, Copilot experimental call, Claude `summary`.

## Existing capabilities reused (FR-031 of spec 021)

- `agents:mcp`, `agents:setMcp`, `agents:mcpRefresh`, `agents:mcpTools` (`src/main/mcpipc.ts`) and the per-agent MCP dialog.
- `listMcpTools` adapters (spec 069) for the Codex tool list; Claude's control-request plumbing (`mcp_status`) for `get_context_usage`.
- `CompactionEvent` and `onCompaction` (`app.js`) for the rate; `ctxbreakdown.js` for the summary bar; `mcpChipHTML` for the chip.
- Settings store for the two levels (as other numeric settings).

## Design

1. `src/shared/mcpcost.ts` (pure): `estimateTools(tools)`, `shareOf(report, window)`, `levelOf(share, levels)`,
   `heaviest(report, n)`, `compactionBurst(times, now, {count: 3, minutes: 30})`. Unit test `test:mcpcost`.
2. `src/adapters/types.ts`: `McpContextReport`, `mcpContext?`, capability.
3. Adapters:
   - `copilot.ts`: call `session.rpc.metadata.getContextAttribution()` guarded (missing method or `null` → `unknown`); group
     `mcpServer` entries.
   - `claude.ts`: control request `{subtype: 'get_context_usage', detail: 'summary'}`; parse with bounds (at most 2000 tools, names
     cut at 128, tokens finite and < 1e9); group by server name using the init list.
   - `codex.ts`: reuse the spec 069 list call with schemas kept in memory only for the estimate, then dropped.
4. `src/main/mcpipc.ts`: `agents:mcpContext(id)` (known agent, running session, 10 s, once a minute unless forced by a switch);
   pushes `mcp-context` updates to the window after a switch, restart, model change or first load; channel in the allow list and
   `test-ipcchannels`.
5. Renderer: chip text and level class; dialog row figures and footnote; Settings levels; the warning line and the compaction hint
   (`app.js` next to `onCompaction`); `ctxbreakdown.js` adds the `mcp` part when given.
6. Simulator: fixtures per app (10 %, 20 %, 35 %, failed server, deferred tools, 1M window) and a compaction burst script.

## Phases

- **P1** (`100-p1-measure`): shared estimator, types, adapters, IPC, chip and dialog figures (US1).
- **P2** (`100-p2-warn`): levels in Settings, chip colour, warning line, compaction hint (US2-US4).
- **P3** (`100-p3-docs`): README *MCP servers* and *Known limits*, screenshots both sizes, agent-notes, owner real check (optional,
  0 credits expected: reads only).

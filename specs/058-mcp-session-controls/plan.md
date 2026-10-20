# Implementation Plan: MCP servers in a session (status words, Restart, last error, log folder)

**Branch**: `058-mcp-session-controls` | **Date**: 2026-10-20 | **Spec**: [spec.md](spec.md) | **Issue**: #349

**Clarified**: the owner answered Q1-Q11 on 2026-10-20, option A for each (spec.md *Clarifications*). The plan follows those answers;
there are no open questions.

## Summary

Make the per-agent *MCP servers* dialog explain itself (plain state words, how servers start, masked failure reason with a hint),
add per-server Restart where the agent app has a real one (Copilot `rpc.mcp.restartServer`, Claude `mcp_reconnect`), add *Restart
session with these servers* (End plus the existing resume path, conversation kept, no prompt), and *Open log folder* (reveal only).
Simulator and fakes first; real checks are no-prompt and need the owner's go-ahead.

## Technical Context

- Electron main (TypeScript), preload (typed bridge), renderer (plain JS), adapters behind `AgentAdapter` (constitution II).
- Reuses: the optional-capability pattern (spec 054 `remote` / `setRemote`, spec 030 `handoff`), `ipcHandle` with main-side validation,
  `redact` / `maskSecretUrl` (`src/shared/redact.ts`), `McpStore` secret values (main only), `ensureLive` and the End path
  (`src/main/main.ts:284-305, 587-591`), `remoteOps.release`, the activity log (`logActivity`), the `dialog()` helper and live region in
  the renderer, the fakes `scripts/fakes/{copilot-sdk,claude-cli,codex-app-server}.ts`, contract test `scripts/test-adapter-contract.ts`.
- Electron API for the log folder: `shell.showItemInFolder(fullPath)` (all three OSes, no shell).
- No new dependency.
- Testing: unit tests in `scripts/test-*.ts` added to `test:serial` (read by `scripts/run-tests.js`); a screenshot driver for the dialog.

## Constitution Check

- **I Spec Kit**: spec, research, plan, tasks before `src/`; Q1-Q11 clarified by the owner on 2026-10-20 (all A).
- **II Adapters are plug-ins**: new capability fields and optional members on `AgentAdapter`; vendor calls (`restartServer`,
  `mcp_reconnect`) and vendor log locations stay in `src/adapters/`. The renderer sees words and booleans only. `errorClass` is a
  normalized set; vendor strings are mapped inside the adapter.
- **III Safe by default, no secrets**: failure text masked in main with the session's own MCP secret values before the renderer gets it
  (fixes an existing gap); log folders are revealed, never read, listed, copied or uploaded; no path to the renderer; IPC validated in
  main; Restart session needs confirmation when the agent is busy and states that grants are cleared; no permission mode changes.
- **IV No AI credits**: simulator, fakes and unit tests only. The real checks (Phase 6) send no prompt and wait for the owner.
- **V Calm UI**: words plus icons (not colour alone), 10.5px minimum, the list scrolls inside the dialog, polite live region, Esc closes.
  The office view is not touched.
- **VI Parity**: log folders per OS from one pure function with injected env, `path.win32` / `path.posix` in tests; `showItemInFolder`
  works on all three. Hand checks on macOS and Windows are not claimed.
- **VII Quality gates**: typecheck, build, test; screenshots at 1440x900 and 1280x800.
- **VIII Honest limits**: Restart and log folders are labelled "not checked on a real account yet" until Phase 6; stderr in logs and
  MCP sign-in are `[KNOWN GAP]`s.

## Design

1. **Pure word table** `src/renderer/mcpwords.js` (UMD, `window.DurbarMcpWords` / `module.exports`): `stateWord(status, pending?)`,
   `startLine(app, start, toggleApplies)`, `hint(status, errorClass, text)`. Unit test `scripts/test-mcpwords.ts`.
2. **Capabilities and types** (`capabilities.ts`, `types.ts`): `mcpStart`, `mcpToggleApplies`, `mcpRestart`, `mcpLogs`;
   `McpServerStatus.errorClass` / `needsRestart`; `restartMcpServer?`, `mcpLogFolder?`. Contract C2 lines. `fake.ts` gets the members
   behind its capability switches.
3. **Mappers**: Copilot `map.ts` reads `errorClassification` (known values to `errorClass`; unknown ignored) and maps
   `session.mcp_server_needs_reconnect` to `needsRestart: true`; Codex `codexMcp.ts` / `codex.ts` read `failureReason` and `authStatus`;
   Claude `claudeMap.ts` turns `init.mcp_server_errors` into `failed` rows. Tests in the existing mapper suites.
4. **Copilot adapter** (`copilot.ts`): capability values; `restartMcpServer` = `rpc.mcp.restartServer({serverName})` when it is a
   function, else `disable` then `enable` (Q3); never `stopServer` (Q2) or `reload`; record the toggle state so FR-158's reconnect still
   re-applies switches. `mcpLogFolder` from `mcplogdirs.ts`. Fake SDK gains `restartServer` and a mode without it.
5. **Claude adapter** (`claude.ts`): capability values; `restartMcpServer` = `mcp_reconnect` then `mcp_status` (emit `mcp`); a server in
   `launchedOff` rejects with the "switch it on first" message; not live rejects. `mcpLogFolder(name)` per server.
6. **Codex adapter** (`codex.ts`): `mcpStart: 'session'`, `mcpToggleApplies: 'next-message'`, `mcpRestart: false`, `mcpLogs: 'session'`
   (Q7: shown only when the folder exists). No `config/mcpServer/reload` button (Q8).
7. **Log folders** `src/adapters/mcplogdirs.ts` (pure): Copilot `join(env.COPILOT_HOME || home/.copilot, 'logs')`; Codex
   `join(env.CODEX_HOME || home/.codex, 'log')`; Claude cache root per OS (`$XDG_CACHE_HOME` or `~/.cache` on Linux,
   `~/Library/Caches` on macOS, `%LOCALAPPDATA%` + `\claude-cli-nodejs\Cache` on Windows) + sanitized project + `mcp-logs-` + sanitized
   server; names over 200 characters give `undefined`. Unit test for each OS.
8. **Main** (`mcpipc.ts`, `agentops.ts`, `main.ts`):
   - `agents:mcp`: add the fields of data-model.md; mask `error` with `maskMcpError(text, secretValues)` (new pure helper next to
     `redact` in `src/shared/redact.ts`, unit-tested), where `secretValues` comes from `McpStore.forSession(...)` for that agent's folder
     (env and header values of the extras actually passed) and the process env; `fs.statSync(dir).isDirectory()` for `logFolder`.
   - `agents:mcpRestart`: validation, one-at-a-time guard, adapter call, masked error, activity row.
   - `agents:mcpRestartSession`: validation, busy check from main's agent state tracker, `remoteOps.release`, `adapter.stop`,
     `ensureLive(a)` with the same id (Q4; no new-session variant); for Claude `ensureLive` does not launch the CLI, so its servers start
     with the next message (Q11); result to the renderer. Shares the End path with `agents:end` (extract a small `endSession(a)` helper so both stay
     the same).
   - `agents:mcpRevealLogs`: adapter folder, stat check, `shell.showItemInFolder`.
   - Preload and `DurbarApi`: `mcpRestart`, `mcpRestartSession`, `mcpRevealLogs`.
9. **Renderer** (`screens.js` `agentMcp`): new row layout and footer (FR-030..FR-033); words and hints from `mcpwords.js`; live refresh
   by re-rendering the list when an `mcp` event for the agent arrives (hook from `app.js` where `a.mcp` is set, `app.js:2582`), keeping
   focus by server name; confirmation through the existing `askDialog` with Cancel focused. *Restart session* is only in this dialog,
   not in the More or card menus (Q10). Claude's per-server log link is labelled "not documented by Anthropic" (Q6). `index.html` loads `mcpwords.js`.
10. **Simulator** (`sim.ts`): real capability values per kind; states for every word; canned Restart, Restart session and a toast for
    the log folder.
11. **Docs**: README MCP section (dialog controls, "not checked on a real account yet"), CHANGELOG line, specs index, screenshots.

## Project Structure

```text
specs/058-mcp-session-controls/
├── spec.md
├── research.md
├── data-model.md
├── plan.md
├── quickstart.md
├── tasks.md
└── checklists/requirements.md

src/adapters/   capabilities.ts, types.ts, copilot.ts, map.ts, claude.ts, claudeMap.ts, codex.ts, codexMcp.ts, fake.ts, mcplogdirs.ts (new)
src/shared/     api.ts, redact.ts (maskMcpError)
src/main/       mcpipc.ts, agentops.ts, main.ts
src/preload/    preload bridge
src/renderer/   screens.js, mcpwords.js (new), app.js (event hook), index.html, sim.ts, screens.css
scripts/        test-mcpwords.ts, test-mcplogdirs.ts, test-mcp-session.ts (new); fakes and existing adapter/mapper/contract tests extended; shots-058-mcp.js (new)
```

## Complexity Tracking

None. The Copilot and Claude calls are experimental or undocumented (`read:`); feature detection and honest labels cover that, and
Phase 6 removes the labels once checked. No log viewer (Q5).

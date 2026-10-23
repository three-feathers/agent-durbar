# Implementation Plan: 069 global MCP servers, controls and tools

**Spec**: [spec.md](spec.md) · **Research**: [research.md](research.md)

## Constitution check

- I Spec Kit: spec, research, plan and tasks in this folder before `src/`.
- II Adapters: tool listing is an optional `AgentAdapter` member with a capability; vendor file formats live in `src/main/mcpglobal.ts`
  (main, config files, not session behaviour) and nothing vendor-specific reaches `src/shared` beyond the app ids already used.
- III Safe by default: nothing is written without a per-file confirmation; secret values never reach the window or a log; reference
  mode is the default; backups before every write; parse failures refuse. Writing other apps' configs is the owner's decision (21:06).
- IV No credits: unit tests and simulator fixtures only; the real check (T060) needs no prompt and waits for the owner.
- V UI: chips and buttons at least 10.5px; the dialogs fit 1280x800.
- VI Parity: paths through `path` and `os.homedir()`; CRLF-safe readers; file modes skipped on Windows.
- VIII Honest limits: FR-050/FR-051, README *Known limits*.

## Design

### Part 1

1. `src/main/mcpglobal.ts` (pure, no Electron):
   - `globalFiles(env, home)` -> `{copilot, claude, codex}` paths and labels.
   - `readGlobal(app, text)` -> `{ok, servers: GlobalEntry[], error?}`; JSON for Copilot and Claude, extended line reader for Codex.
   - `entryFor(app, input, secretMode)` -> the JSON object or the TOML block text; `maskedEntry` for the window.
   - `addToText(app, text|undefined, name, entry)` / `removeFromText(app, text, name)` -> `{ok, text}` or `{ok: false, error}`.
2. `src/main/mcpglobalio.ts`: `readFileSafe` (2 MiB, utf8), `backupAndWrite(file, text, expectHash, now)` (backup, prune to 3, tmp +
   rename, mode), the pending-token map (5 min, single use).
3. `src/main/ipc/mcpglobal.ts`: `mcp:globalState`, `mcp:globalPreview`, `mcp:globalApply`, `mcp:globalRemovePreview`,
   `mcp:globalRemoveApply`; registered from `main.ts`; channels added to the IPC allow list and `test-ipcchannels`.
4. `mcpipc.ts`: `optionsFor` adds the Claude user list for Claude agents (FR-009); `agents:mcp` adds `sources`.
5. Preload and `api.ts` types; dev hooks `DURBAR_CLAUDE_CONFIG_DIR`, `DURBAR_CODEX_HOME` (tests and screenshots only, like
   `DURBAR_COPILOT_DIR`).
6. Renderer `screens.js`: the add form's *Add to* choice, app ticks or radio, secret mode; the confirmation dialog; Settings global list
   with source chips and *Remove…*.
7. Simulator: an in-memory bridge for the new calls (`sim.ts`), fixtures for three apps.

### Part 2

`mcp:globalDiff`, the Harmonize section, the copy preview reusing part 1's pipeline (values read from the source file in main).

### Part 3 (after #473)

`listMcpTools` in the three adapters and the fake; `agents:mcpTools`; the row's expand and Remove buttons in `agentMcp`, on spec 058's row (its switch, state words, Details and repaint; delta 2026-10-22).

## Tests

`scripts/test-mcp-global.ts` (new, in `npm test`), additions to `test-mcp.ts` for FR-009, `test-ipcchannels`, the adapter tests for
part 3; driver `scripts/shots-069-mcp-global.js` in `ui-suite.js`.

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
   server; names over 200 characters give `undefined`. Each result also returns its vendor root. Unit test for each OS.
   `insideRoot(realRoot, realFolder, pathImpl)` (pure, FR-026): `path.relative` non-empty, not `..`-prefixed, not absolute.
8. **Main** (`mcpipc.ts`, `agentops.ts`, `main.ts`):
   - `agents:mcp`: add the fields of data-model.md; mask `error` with `maskMcpError(text, secretValues)` (new pure helper next to
     `redact` in `src/shared/redact.ts`, unit-tested), where `secretValues` comes from `McpStore.forSession(...)` for that agent's folder
     (env and header values of the extras actually passed) and the process env; `fs.statSync(dir).isDirectory()` for `logFolder`.
   - `agents:mcpRestart`: validation, one-at-a-time guard, adapter call, masked error, activity row.
   - `agents:mcpRestartSession`: validation, busy check from main's agent state tracker, `remoteOps.release`, `adapter.stop`,
     `ensureLive(a)` with the same id (Q4; no new-session variant); for Claude `ensureLive` does not launch the CLI, so its servers start
     with the next message (Q11); result to the renderer. A thrown resume error that `isAuthError` classifies (or an adapter `auth`
     error status) gives `errorKind: 'auth'` and `markSignedOut`, and the renderer shows the spec 012 FR-157 card from `signin.js`
     (FR-027). Shares the End path with `agents:end` (extract a small `endSession(a)` helper so both stay
     the same).
   - `agents:mcpRevealLogs`: adapter `{root, folder}`, `fs.realpathSync` on both, `insideRoot` (FR-026), stat check,
     `shell.showItemInFolder`; refuse otherwise.
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

## Delta: MCP OAuth sign-in (issue #364, 2026-10-20)

**Spec**: [spec.md](spec.md) *Changes* > 2026-10-20 (FR-060..FR-074, SC-010..SC-012). **Research**: [research.md](research.md) section 7.
**Clarified**: the owner answered Q12-Q19 on 2026-10-20 (Q12 B persistent, Q13-Q19 A; spec.md *Clarifications*, T090 done). Tasks
that rest on an answer name it.

### Summary

Turn every MCP "needs sign-in" signal (runtime status, Codex `failureReason`, and the Copilot tool error of the issue) into the server's
needs-auth state; keep that text out of the app sign-in classifier; let the user start the agent app's own OAuth flow from the MCP dialog
(main holds the authorization address, the window sees the host, https only, opened after a click); show exact terminal steps when that
cannot run; offer *Switch off for this session* next to each signal; mask failed MCP tool cards. No token ever passes through Durbar.

### Constitution Check (delta)

- **I**: spec delta, research, plan and tasks first; Q12-Q19 asked and answered by the owner, not guessed.
- **II**: vendor calls (`oauth.login`, `mcp_authenticate`, `mcpServer/oauth/login`) and vendor phrases (`mcpauth.ts`) stay in
  `src/adapters/`; the window gets `needs-auth`, `mcpAuth: true`, `canSignIn`, a host and plain steps text.
- **III**: sign-in belongs to the vendor runtime: Durbar never calls a token-carrying method or registers `onMcpAuthRequest`; the address
  lives in main memory only (10 minutes), is never logged or saved, and is opened only after a click, https only; IPC validated in main;
  failed tool cards masked.
- **IV**: fakes, simulator and unit tests; the real checks send no prompt and wait for the owner (needs-owner-approval).
- **V**: words plus icons, polite live region, two-step open (Q13), 10.5px, fits 1280x800.
- **VI**: no OS-specific code (`shell.openExternal`; each runtime opens its own callback listener).
- **VIII**: everything `read:` until T105-T107; README and the row's *Details* say "not checked on a real account yet".

### Design

1. **Classifier** `src/adapters/mcpauth.ts` (pure): `isMcpAuthChallenge(text)` with the phrases of research 7.2 (issue text `real:`,
   runtime strings `read:`). `src/adapters/autherrors.ts`: `isAuthError` returns false when `isMcpAuthChallenge` matches (checked before
   `AUTH`, like `NOT_AUTH`). Tests: `scripts/test-mcpauth.ts` (`test:mcpauth`), new cases in `scripts/test-autherrors.ts`.
2. **Types** (`types.ts`, `capabilities.ts`): `mcpSignIn?: boolean`, `mcpSignInSteps?: string` (plain text with `{name}`);
   `startMcpSignIn?(sessionId, name)`; `ToolCallEvent.mcpAuth?: true`; event guard accepts `mcpAuth` only on a failed `toolCall` with
   `mcpServer`. Contract C2 lines; `fake.ts` members behind the flags. Builds on T010 (`errorClass`).
3. **Mappers**:
   - Copilot `map.ts` `tool.execution_complete` (not `success`, `mcpServer` known, `isMcpAuthChallenge(error.message)`): emit the card
     with `mcpAuth: true`, set `this.mcp[server]` to `{...prev, status: 'needs-auth', errorClass: 'auth', error: <text>}` and `emitMcp()`;
     the next `session.mcp_server_status_changed` for that server replaces it. `remediation` is not read.
   - Codex `codex.ts` startup notification: `failureReason === 'reauthenticationRequired'` -> `needs-auth` + `errorClass: 'auth'`; a failed
     MCP tool item with challenge text -> `mcpAuth` and `refreshMcp(live)`.
   - Claude `claudeMap.ts`: a failed `mcp__<server>__<tool>` result with challenge text -> `mcpAuth`; `claude.ts` asks `mcp_status` once.
4. **Adapters' `startMcpSignIn`**:
   - Copilot: `const fn = session.rpc.mcp.oauth?.login`; not a function -> `McpSignInManual`; call with `{ serverName, clientName:
     'Agent Durbar', callbackSuccessMessage: 'Signed in. You can go back to Agent Durbar.' }`; `authorizationUrl` -> `{kind:'browser'}`,
     else `{kind:'connected'}`. Session config (create and resume) adds `mcpOAuthTokenStorage: 'persistent'` (Q12 B). Fake SDK: `oauth.login`
     recorder, a mode without it, a mode that returns no URL; asserts `handlePendingRequest` is never called and no `onMcpAuthRequest`.
   - Claude: `transport.request({ subtype: 'mcp_authenticate', serverName }, 30_000)`; reply `authUrl` + `requiresUserAction` ->
     browser; `requiresUserAction: false` -> connected; an error containing "not supported in this context" -> manual. Poll `mcp_status`
     every 3 s while main says the sign-in is open (stop on `connected`, Cancel, 10 minutes, End). Fake CLI gains the subtype.
   - Codex: `rpc.request('mcpServer/oauth/login', { name, threadId })`; method-not-found -> manual; keep `loginId`; on
     `mcpServer/oauthLogin/completed` (by `loginId`, else name + thread) success -> mark `relaunch` (FR-147 path) and emit the row as
     `pending` with a note; failure -> masked error. Cancel -> `account/login/cancel` when known. Fake app-server gains both.
5. **Main** (`mcpipc.ts`, `main.ts`, preload, `src/shared/api.ts`):
   - `signIns: Map<agentId, Map<server, { url, host, until, timer }>>` in a small pure module `src/main/mcpsignin.ts` (inject clock and
     `openExternal`) so it is unit-tested without Electron.
   - `agents:mcpSignIn(id, name)` -> validation (FR-065) -> adapter -> `elicitHttpsUrl` -> store -> `{ ok, host }` | `{ ok, connected }` |
     `{ ok: false, manual: true, steps }` | `{ ok: false, error }` (masked).
   - `agents:mcpOpenSignIn(id, name)` -> `shell.openExternal(stored.url)`; `agents:mcpCancelSignIn(id, name)` -> forget (+ adapter cancel).
   - Drop on `mcp` event with `connected` for that server, End, Restart session (`endSession`, T040), app quit.
   - `agents:mcp` adds per server `canSignIn` and `signIn?: { host }` (an open sign-in), per agent `signInSteps?` (filled).
   - The router's renderer hook (`main.ts:123`) also masks `toolCall` events with `mcpServer` and `phase: 'failed'` (FR-067), with a
     `maskMcpText` variant of `maskMcpError` that keeps the card's own length limit.
   - The `DURBAR_LOG` sink sees normalized events only; no address is ever put in an event, so nothing extra is needed there (tested).
6. **Renderer** (`screens.js` `agentMcp`, `app.js` card, `mcpwords.js`): the needs-auth row (FR-069), two-step open (Q13), steps block with
   **Copy** (FR-068), **Switch off for this session** (calls the existing `setMcp`), the tool card line with **Sign in…** that opens the
   dialog at that row (Q14). Words and hints in `mcpwords.js` (T011).
7. **Simulator** (`sim.ts`): `simmcpauth=1` and `simmcpauth=manual` (FR-071).
8. **Docs**: README MCP section ("Needs sign-in", Sign in, terminal steps, "not checked on a real account yet"), CHANGELOG, spec 019
   pointer (done in this spec PR), specs index.

9. **Real check on CI** (T116, owner request 2026-10-21): a dependency-free demo MCP server that requires OAuth
   (`scripts/demo-oauth-mcp.ts`, MCP part reuses `src/main/mcp/protocol.ts` `McpSession`), a check script through the Copilot adapter
   (`scripts/mcp-oauth-real.ts`, `scripts/e2e-real.ts` pattern: secrets from env, every line through `redact`), and a manual workflow
   (`.github/workflows/mcp-oauth-real.yml`, `e2e-real.yml` pattern, `workflow_dispatch` only). No browser dependency: the demo
   auto-approves, so the "browser" is two HTTP requests (authorize, then the runtime's loopback callback). The SDK's own OAuth demo
   (`@modelcontextprotocol/sdk` examples) was not reused: it is not a dependency here and needs `express` and the SDK.

### Order

Phase 8a (no answers needed): T091-T097. Phase 8b (T090 done): T098-T104. Phase 8c (owner go-ahead): T105-T107. Then T108-T109.
Depends on 058 Phase 1-2 for `errorClass`, the word table and the new dialog rows (T010, T011, T020, T026).

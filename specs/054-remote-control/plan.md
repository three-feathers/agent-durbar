# Implementation Plan: Remote control and chat channels (Phase 1)

**Branch**: `054-remote-control` | **Spec**: [spec.md](spec.md) | **Issue**: #298

## Technical context

- Electron main (TypeScript), preload (typed bridge), renderer (plain JS), as elsewhere.
- Reuses: the optional-capability pattern (`handoff` / `handoffSummary`, spec 030 FR-034), the `agents:*` IPC style with main-side validation, `shell.openExternal` behind a host allowlist (as `allowedSignInUrl`, spec 051 FR-005), the `askDialog` helper (`dialog.js`), the chat More menu (`wireMenu`, spec 052 FR-003), the command palette (spec 052 FR-042), the `mchip` header chip style and the fake Copilot SDK (`scripts/fakes/copilot-sdk.ts`).
- SDK surface: `session.rpc.remote.enable/disable` and `session.rpc.visibility.get` (`@experimental`, see the spec's Research).
- No new dependency.

## Constitution check

- **I Spec Kit:** spec, plan and tasks come before `src/`.
- **II Adapter boundary:** the capability flag and `setRemote` live on `AgentAdapter`; the state is a plain shape in `src/shared/remote.ts`; the Copilot RPC names stay inside `src/adapters/copilot.ts`. Feature detection, not version checks.
- **III Safe by default, no secrets:**
  - remote is never on by default: no `remoteSession` on create/resume, no `enableRemoteSessions` on the shared client;
  - turning it on needs an explicit dialog that says messages go to GitHub and that anyone who can see the session can steer it; Cancel has the first focus;
  - the URL that is opened is the one main stored for that agent, after a `github.com`-only https check; the page cannot open an arbitrary URL through this route;
  - IPC input is validated in main; nothing is logged.
- **IV No AI credits:** unit tests use a fake session; the simulator has a canned answer. The real check is a separate task that needs the owner (it exports data to GitHub).
- **V Calm UI:** the desk card gets text in its existing role line (no new element, no size change); the header chip uses the existing `mchip` style; text at least 10.5px.
- **VI Windows/macOS/Linux:** nothing OS-specific.
- **VIII Honest limits:** Phase 1 is marked sim and unit only; Q1..Q4 and the unmapped `remote_steerable_changed` event are `[KNOWN GAP]`s. Phases 2 and 3 are planned, with their questions written down.

## Design

1. `src/shared/remote.ts` (pure): `RemoteState`, `RemoteVisibility`, `allowedRemoteUrl(url)`, `cleanRemoteError(err)`.
2. `src/adapters/capabilities.ts`: `remote?: boolean`. `types.ts`: `setRemote?(sessionId, on)`.
3. `src/adapters/copilot.ts`: `COPILOT_CAPABILITIES.remote = true`; `setRemote` maps `enable({ mode: 'on' })` + `visibility.get()` or `disable()` to `RemoteState`, with feature detection on `rpc.remote`.
4. `src/main/remoteops.ts` (no Electron, unit-tested): validation, the stored state by agent id, `openRemote` and `forget`. `src/main/main.ts` wires `agents:setRemote(id, on)` and `agents:openRemote(id)` to it and calls `forget` on every top-level `status: stopped` event (End session, Remove and quit all stop the session first).
5. Preload and `DurbarApi`: `setRemote`, `openRemote`.
6. Renderer:
   - `modelswitch.js` `shows(caps,'remote')`;
   - `app.js`: `canRemote(a)`, the More menu item, the palette action, `remoteOn(a)` (dialog → bridge → link dialog), `remoteOff(a)`, `remoteLinkDialog(a)`, the header chip and the desk-card role text; state on the agent object (`a.remote`), cleared on `status: stopped`.
7. `src/renderer/sim.ts`: `remote: true` on the Copilot sim kind (off for the others), canned `setRemote` / `openRemote`.
8. Tests: `scripts/test-remote.ts` (`test:remote` in `package.json`'s `test:serial`, which `scripts/run-tests.js` reads); fake session gains `rpc.remote` / `rpc.visibility`; contract C2 line. Driver `scripts/shots-054-remote.js` (not run here).

## Phase 3 research disposition (2026-10-24, issue #490)

`read:` OpenAI documents ChatGPT mobile access through a connected desktop or SSH host ([Remote connections](https://learn.chatgpt.com/docs/remote-connections)) backed by a managed app-server. The daemon ([app-server-daemon README](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/app-server-daemon/README.md)) exposes lifecycle controls (`bootstrap --remote-control`, `enable-remote-control`, `disable-remote-control`); these are host/daemon controls, not a per-thread `setRemote` call. Durbar currently owns one stdio app-server child per Codex session (`read:` `src/adapters/codex.ts:346`). Do not add these daemon controls as the existing `remote` adapter capability: that would imply a per-session operation and lifetime that the protocol does not provide. A future integration needs a separate design for managed-daemon ownership, connecting Durbar sessions, mobile access and permission boundaries.

`real:` 2026-10-24, Codex CLI 0.164.0: a single read-only prompt through `CodexAdapter`'s own per-session stdio app-server returned the expected response. The owner confirmed an existing mobile pairing but could not see the Durbar conversation. The managed daemon was running, but the desktop UI was closed and its remote-control state was not changed or verified. One prompt was used; usage was not measured. This is evidence about that setup only, not a test of an active connected-desktop workflow. Do not repeat a live prompt to retry the same path; any further check needs a verified active host connection and an explicit prompt budget.

## Complexity tracking

None. Phase 2 is built. Phase 3 documentation research and the bounded live check are complete; any integration is deferred to a separate design and owner decision.

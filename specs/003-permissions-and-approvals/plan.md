# Implementation Plan (as built): Permission modes, approvals and session grants

**Spec**: [spec.md](spec.md) | **Date**: 2026-10-16 | **Kind**: reverse-engineered

## Summary

A pure class, `PermissionBroker` (`src/adapters/permissions.ts`, no Electron, no SDK), decides each SDK permission request according to the agent's mode and its session grants and
emits `BrokerEvent`s. `CopilotAdapter` creates one broker per session, maps broker events to normalized `status`/`permission`/`grants` events, and the renderer renders them.

## Technical Context

- **Language**: TypeScript; renderer JS (`showPerm`, `settlePerm`, `renderGrants` in `app.js`).
- **Testing**: `npm run test:permissions` (`scripts/test-permissions.ts`): scopes, read/read-only, ask/approve-once, approve-for-session + auto-approve + revoke, deny never remembers, stop with several pending, interrupt keeps grants.
- **Constraints**: nothing stored; grants live in memory for the session.

## Constitution Check

| Principle | Result |
| --- | --- |
| III Safe by default | Default read-only; narrow revocable grants; no storage. Gaps: FR-010..FR-013. **Partial** |
| IV No credits | Broker is pure and tested without Copilot. OK |
| VII Gates | Test exists and runs on 3 OSes in CI. Windows path case untested (FR-016). **Partial** |
| VIII Honest limits | README documents narrow grants; FR-010/011/012 are *not* in the README. **Partial** |

## As-built architecture

```text
SDK onPermissionRequest(req) -> CopilotAdapter -> broker.request(req) -> Decision {approve-once | reject+feedback}
                                              \-> BrokerEvent -> adapter.emit(status/permission/grants) -> IPC -> renderer
renderer button -> IPC agents:resolvePermission(id, requestId, approve, remember) -> adapter.resolvePermission -> broker.resolve
Stop -> adapter.interrupt -> broker.denyPending (+ session.abort)      End session -> adapter.stop -> broker.stop
```

Decision order in `request()`: (1) `kind === 'read'` or `allow` -> approve; (2) broker stopped -> reject; (3) not `ask` -> reject (policy) + `denied-policy` event;
(4) matching grant -> approve + `resolved(via: session)`; (5) else pending: emit `pending`, await `resolve()`; on approve+remember store the grant and emit `grants`; emit `resolved`.

Renderer rules: a click settles the note locally and the adapter's `permission` event is de-duplicated through `a.settled`; a grant-auto-approved request shows a settled note in timeline order;
`status stopped`/`Aborted` settles every pending note as denied (`via: stopped`).

Modes are chosen in the top bar (default Read-only) or the new-session dialog; they map to `StartOptions { ask, allow }` in `startOptionsFor` (`main.ts`) and are saved with the folder (feature 006).

## Project Structure (documentation)

```text
specs/003-permissions-and-approvals/
├── spec.md
├── plan.md
└── tasks.md
```

## Verification status

| Claim | How | Result |
| --- | --- | --- |
| Broker behavior (FR-001..005, 009) | `npm run test:permissions` | pass 2026-10-16 |
| Ask/deny/approve, read-only denial, one Approve-for-session covering two edits | README m3/m5 real sessions | `real:` recorded, not re-run |
| Inline notes, chips, stop-while-pending UI | screenshots m5-perm-* + e2e driver `PHASES=m5` | `sim:` recorded, not re-run |
| Allow-all naming, reads ungated, persisted allow | read against code | confirmed as gaps (FR-010..012) |
| macOS/Windows | none | untested |

## Delta 2026-10-16 (FR-021..FR-024)

- `permissions.ts`: `BrokerOptions.roots` (+ `allowReadPaths(paths)` for attachments, injectable `realpath` for tests), `isInsideRoots`, read policy per mode, shell scope split into `exact` (default) and `broad` (`anyArgsScope`), `PermissionInfo.broadScopeKey/broadScopeLabel`, `resolve(requestId, approve, remember, broad)`.
- `copilot.ts`: roots from `resolveWorkspaceCwd().folders`, attachments allowed in `send`; IPC `agents:resolvePermission(id, requestId, approve, remember, broad)`.
- `folders.ts`: `restoreMode()`; `setPermMode`/`upsert` never persist `allow`. `main.ts`: `restoreFolders` uses it and flags `AgentInfo.permDowngraded`.
- `app.js`: 4th button "Approve for session: any <name> arguments", confirmation when adding a folder / new session in Allow edits, toast on downgrade.

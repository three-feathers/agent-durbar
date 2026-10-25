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
- `folders.ts`: `restoreMode()`; ~~`setPermMode`/`upsert` never persist `allow`~~ (superseded below). `main.ts`: `restoreFolders` uses it.
- `app.js`: 4th button "Approve for session: any <name> arguments", confirmation when adding a folder / new session in Allow edits.

### Second delta 2026-10-16 (FR-025..FR-027)
- `folders.ts`: `persistable` removed; `upsert`/`setPermMode` persist the mode as chosen; `restoreMode(saved)` returns `{ mode: saved, restored: saved === 'allow' }`.
- `api.ts`: `permDowngraded` replaced by `permRestored`. `main.ts`: `restoreFolders` sets it for Allow edits; `agents:setMode` clears it.
- `app.js`/`styles.css`: "restored" note in the header mode chip and card icon tooltip, cleared on a switch; startup toast; `sim.ts`: one simulated folder restored in Allow edits.

## Third delta (2026-10-16): "Allow all" naming (FR-028..FR-030, T020)

- `index.html`, `app.js`: display name `MODE_NAME.allow = 'Allow all'`, selectors "Allow all (no prompts)", help text, confirmation titles/body/button, toasts, startup toast; role text `no prompts`; the chat hint uses `MODE_NAME` and its after-switch regex accepts the display name.
- `styles.css`: `#liveBar #permMode{max-width:180px}` so the label fits.
- `README.md`: "Allow edits" → "Allow all".
- Checked on the simulator at 1440x900 and 1280x800 (driver kept outside the repo): selector label, chip, menu, hint, confirmation text, no "Allow edits" in the page text, no top-bar overlap; `npm run check:office` 95/95. Not checked: macOS/Windows native select rendering beyond this Mac, a real Copilot session (text only, no behavior change).
- Screenshots: `docs/screenshots/003-allow-all-topbar-{1440x900,1280x800}.png`, `docs/screenshots/003-allow-all-menu-{1440x900,1280x800}.png`.
- `/speckit-analyze` (read by hand from `.claude/skills/`, feature dir 003): only terminology drift found (US5 AC1 and code comments/test messages still said "Allow edits"), fixed; CHANGELOG left as released. `/speckit-converge`: converged for FR-028..FR-030, no tasks appended.

## Delta 2026-10-17: Windows paths in grant scopes (FR-031/FR-032, T025)

- `src/adapters/permissions.ts`: `grantScope(req, flavor = path)` uses `flavor.dirname` for write/read; `PermissionBroker.request` passes `this.opts.pathCheck?.flavor`. No other caller changes (default keeps host behavior).
- `scripts/test-permissions.ts`: `grantScope` with `path.win32` (drive folder, drive root, UNC, same folder shares a key, subfolder does not) and an explicit `path.posix` check; a broker built with `pathCheck.flavor = path.win32` remembers a Windows folder grant and reuses it for a second file there.
- Grant keys stay exact strings (case-sensitive), documented as a conservative limit in the spec.
- Checked: `npm run typecheck && npm run build && npm test` on macOS. `/speckit-analyze` and `/speckit-converge` followed by hand from `.claude/skills/` (feature dir 003): no drift, converged for FR-031/FR-032, no tasks appended.

## Delta 2026-10-17: keyboard focus in the confirmation (FR-033, T029)

- `src/renderer/dialog.js` (new, plain script like `markdown.js`; `window.DurbarDialog(document)` in the page, `require` in tests): the shared `askDialog` moved out of `app.js`. A capture-phase `keydown` on the document while it is open handles Escape (cancel) and Tab/Shift+Tab (wrap); a `focusin` guard pulls focus back if something outside takes it; on close focus goes to `returnFocus` (element or function) or the element focused when it opened.
- `app.js`: `changeMode(a, mode, anchor)` passes `anchor` as `returnFocus` and no longer calls `anchor.focus()` itself (that was the bug); `refocusAnchor` re-focuses the chip (or card) after the chip is re-rendered, only when focus was lost. `index.html` loads `dialog.js`; `scripts/copy-assets.js` copies it.
- Tests: `scripts/test-dialog.ts` (jsdom; in `npm test` as `test:dialog`); `scripts/check-dialog-focus.js` + `npm run check:dialog-focus` (Electron under xvfb, simulator, real key events via `sendInputEvent`; fails on the old code with focus on `modeChip`). The latter needs xvfb, so it is a manual check like `check:office`, not part of `npm test`.
- Checked: `npm run typecheck`, `npm run build`, `npm test`, `npm run check:office`, `npm run check:dialog-focus` on Linux. `/speckit-analyze` and `/speckit-converge` followed by hand from `.claude/skills/` (feature dir 003): no drift beyond the FR-033 text above.

## 2026-10-21 (second delta): per-session mode, visible on return (T030, FR-090..FR-093)

- `src/main/folders.ts`: `SavedFolder.sessionModes` (`parseSessionModes`, cap 50), `FolderStore.setSessionMode`, pure `modeForSession(folder, ids, fallback)`.
- `src/main/agentops.ts`: `setModeOp` also writes the session's mode (`OpsDeps.sessionKey`, main passes `resumeIdFor`); pure `resumeModeOp(saved, sessionId, openerMode)` gives mode, `permFrom`, `permRestored`, `modeWas` and the activity-log line.
- `src/main/main.ts`: `restoreFolders` uses `modeForSession` per restored session and sets `permFrom`; `sessions:resume` uses `resumeModeOp` and returns `modeWas`; `noteLastSession` writes the session's current mode.
- `src/shared/api.ts`: `AgentInfo.permFrom`, `ResumeResult.modeWas`. `src/renderer/app.js`: `modeBackNote` after a wake or a resume; chip tooltip. `src/renderer/sim.ts`: the same rule with a canned remembered mode (`prev-1` = Allow all).
- Tests: `scripts/test-folders.ts`, `scripts/test-agentops.ts`; driver `scripts/shots-003-mode-back.js` (in `check:ui`).

## 2026-10-23 delta: a Read-only refusal opens the mode menu (T031, FR-094..FR-098)

- Reuse, no new popup: `openModeMenu(a, x, y, anchor, {modesOnly:true})` in `src/renderer/app.js` (spec 018's menu; the new option leaves out Model, Plan first and This folder's setup) and `changeMode` (its Allow all confirmation and grants dialog). The same menu spec 012 FR-087's **Change mode…** opens.
- `roAskHint(a, note)`: one button per agent (`a.roHint`), moved to the newest denial; `aria-haspopup`/`aria-expanded`; toggles the menu. `showPerm`: the denied text drops "Switch it to Ask first…" when the button is shown.
- `roAskAfterSwitch(a, mode, anchor)` called from `changeModeInner` after a successful switch: removes the button; when the switch came from it, adds the "Ask <name> to try again" line and focuses `#msgInput`. Replaces `a.roHintShown`.
- Needs you (`paintInbox`): a copied `ro-ask` button closes the inbox, opens the chat and clicks the chat's button.
- Test: `scripts/check-ro-ask.js` in `scripts/ui-suite.js`: a synthetic `needs-permission` denial and a real simulator denial (a Read-only agent asked to edit), the menu's items and ticks, Ask first chosen, the mode changed (chip and `#modeChip` text), keyboard path (Enter, Arrow, Enter; Escape returns focus), Allow all cancel keeps Read-only. Mutation check: the old FR-074 button (switch at once, no menu) fails it.

## 2026-10-25 delta: "Why was this allowed?" tag and undo (T032..T036, FR-099..FR-106)

- Types: `PermissionInfo.allowedBy` (`AllowedBy`) and `via: 'quiet'` in `src/adapters/types.ts`; `eventguard.ts` validates `allowedBy`.
- Broker (`src/adapters/permissions.ts`): `request()` sets `allowedBy` on the session-grant `resolved` event (the matching grant), on the Allow all `auto` event, and emits one quiet event for a read it approves silently; `cleanGrantKey` for the IPC. `src/main/ipc/agents.ts` `agents:revokeGrant` uses it. `decisionOf` (`src/shared/activity.ts`) ignores `quiet`.
- Reuse, no new channel: the undo is the existing `bridge.revokeGrant` -> `agents:revokeGrant` -> adapter `revokeGrant` -> `broker.revoke`, the same call as the grant chips' x.
- Renderer: `src/renderer/whyallowed.js` (pure: reason -> pill word, sentence, undo key; `DurbarWhyAllowed`), `app.js` (`a.why` by request id, the chip's `c.why`, `whyPaint`, undo click, `grants` event refresh), `styles.css` (`.chip .why`, `.whybody`). Simulator (`sim.ts`) emits the same reasons (its edit's request id is the tool call id).
- Tests: `scripts/test-permissions.ts` (reasons per path, hostile ids, `cleanGrantKey`, the pure module), `scripts/test-events.ts`-style guard cases, `scripts/check-why-allowed.js` in `scripts/ui-suite.js` (simulator: session rule, Undo, Allow all, folder read, no tag after a user approval; both sizes). Mutation checks in the PR.


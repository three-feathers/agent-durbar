---
description: "Tasks for spec 087: each agent app's OS sandbox as the floor under Read-only and Ask first"
---

# Tasks: OS sandbox floor (issue #611)

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md)

**Prerequisites**: the owner's answers to Q1-Q5 in spec.md. T001 records them; no implementation task starts before it.

**Rules for every task**:

- simulator and `npm test` only; zero AI credits; no real session, no `npm run smoke`, no `scripts/capture-raw.ts` (except the
  Phase 6 tasks, which need the owner's OK and state their cost first);
- argv only, no shell; no path from the window; never log settings JSON or vendor reasons unmasked;
- the floor only narrows: a test proves no cell sends an auto-approve or bypass setting;
- `npm run typecheck && npm run build && npm test` green; UI tasks also `npm run check:office`, screenshots at 1440x900 and
  1280x800 with `DURBAR_SIM=15`, and `npm run shots:docs -- --only <drivers>` for linked pictures that show the chip.

## Format: `[ID] [P?] [Story] Description [FRs]` then the acceptance criteria

## Phase 0: Decisions and spec deltas

- [ ] T001 Record the owner's answers to Q1-Q5 in spec.md (*Changes*, dated) and adjust FR-003, FR-004, FR-007, FR-009, FR-019. [Q1-Q5]
  - AC1: every FR that names a question says the answer; no FR still reads "proposal".
- [ ] T002 [P] Spec deltas pointing to 087: 003 (the floor under the three modes), 012 (Claude `--settings` sandbox block; Codex state reporting), 018 (the chip segment), 061 (folder `sandbox` keys cannot widen), 076 (`permissions.requireOsSandbox`, FR-173 closed by FR-012). [FR-001, FR-003, FR-009, FR-012, FR-019]
  - AC1: `npm run specs:check` passes.

## Phase 1: Pure modules (blocks every story)

- [ ] T010 [P] `src/adapters/sandboxRoots.ts` shared with Codex (`codexWorkspaceRoots` moves or calls it). [FR-015]
  - AC1: filesystem roots, UNC share roots, `..`, control characters and quotes are dropped; an empty result refuses; Windows-form paths compare case-insensitively; existing `test-codex-modes` still passes.
- [ ] T011 [P] [US1] [US2] [US3] `src/adapters/claudeSandbox.ts`: `claudeSandboxSettings` and `claudeSandboxState`. [FR-001..FR-003, FR-006, FR-007]
  - AC1: Read-only and Ask first give `enabled: true`, `failIfUnavailable: true`, `allowUnsandboxedCommands: false`, `autoAllowBashIfSandboxed: false`, `excludedCommands: []`, the read rules (Q4) and network rules (Q2); Read-only adds `denyWrite` = roots; Allow all gives `undefined`.
  - AC2: pre-checks: version below 2.1.219 or unreadable → `off` (too old); `win32` → `off` with the Windows reason; `linux` without `bwrap` or `socat` → `off` naming the missing package; otherwise `unknown` (never `on`).
  - AC3: `startExit` = a sandbox exit → `off` with the masked reason; a start that survives → `on`; no input gives `on` without a surviving start.
- [ ] T012 [P] [US1] [US2] `src/adapters/copilotSandbox.ts`: `copilotSandboxConfig` and `copilotSandboxState` (structural types, no SDK import). [FR-001, FR-002, FR-004, FR-006, FR-014]
  - AC1: Read-only: roots in `readonlyPaths`, `addCurrentWorkingDirectory: false`, network off; Ask first: roots in `readwritePaths`, protected paths in `deniedPaths` only with the `denied_paths` capability; both: `allowDevToolAccess: false`, never `allowBypass`, `auth` off.
  - AC2: the `PATH` folders become `readonlyPaths` after FR-015's normalisation; the home folder itself, a filesystem root and a relative entry are dropped.
  - AC3: `supported: false` → `off` with the masked, clipped reason; missing method → `off` "this Copilot cannot report its sandbox"; a `session.warning` of type `sandbox` → `off`.
- [ ] T013 [P] `SandboxState` in `src/shared/api.ts` next to `AgentInfo`, optional. [FR-011]
  - AC1: the type has no vendor name or vendor key (a test greps `src/shared/api.ts` for `autoAllowBash`, `sandboxConfig`, `durbar_ro`, `allowBypass` and finds none).
  - AC2: an `AgentInfo` without `sandbox` renders the chip exactly as today (renderer unit or driver check).
- [ ] T014 `scripts/test-sandbox-floor.ts` (added to `test:runtime`): every app × OS × mode cell (27), the unavailable cells, the required-policy cells, a scan that no cell has an auto-approve or bypass value, every Claude limited cell has `failIfUnavailable: true`, every Copilot cell has `allowDevToolAccess: false`, and none turns on credential injection (`auth.git`, `auth.gh`, `credentials`). [SC-001, SC-002, FR-016, FR-018]
  - AC1: a planted mutation (`autoAllowBashIfSandboxed: true`, `allowBypass: true`, `allowDevToolAccess: true` or `failIfUnavailable: false`) fails the test.

## Phase 2: Adapters

- [ ] T020 [US1] [US2] [US3] Claude adapter: pre-checks, the block set on the `--settings` JSON in `claude.ts` (not in `src/shared`), state `unknown` → `on` after the start; a sandbox exit → policy required: refusal; otherwise one relaunch without the block, a chat note and `off`. [FR-003, FR-006, FR-007, FR-013]
  - AC1: `test-claude-adapter`: in Read-only and Ask first the `sandbox` key of the `--settings` JSON in argv is exactly Durbar's block; in Allow all there is no `sandbox` key; the folder-setup part of the JSON is unchanged.
  - AC2: with a fake CLI that exits with a sandbox error: no policy → exactly one relaunch without the block and a note containing "runs Not sandboxed"; policy required → no relaunch and a refusal containing "Read-only and Ask first need".
- [ ] T021 [US1] [US2] [US3] Copilot adapter: `getHostSupport()` once per runtime start; `options.update` after create/resume, before the first send; refusal when required; `session.warning` type `sandbox` updates the state; a switch to Allow all sends nothing and sets `untilNewSession`. [FR-004, FR-006, FR-007, FR-008, FR-013]
  - AC1: the fake client records the update before the first `send`; a rejected update gives *Not sandboxed* with a note (or a refusal containing "Read-only and Ask first need" when required).
  - AC2: after a switch to Allow all the fake client records no second update and the state has `untilNewSession: true`.
- [ ] T022 [P] [US1] [US2] Codex adapter: `SandboxState` from its existing checks; the FR-021 sentence on `commandExecution` and `fileChange` approval cards in Ask first. [FR-005, FR-011, FR-021]
  - AC1: `test-codex-modes`: `codexPermission` summaries for both kinds end with "If you approve, Codex may run this outside its sandbox."; the Read-only path declines as before.
  - AC2: the state is `on` with `approvedMayLeave: true` in Ask first, `false` in Read-only; a refused start keeps today's refusal (no new path).

## Phase 3: Window and simulator

- [ ] T030 [US1] [US3] Mode chip segment and tooltip text; card mode icon tooltip; mode menu note. [FR-009, FR-010, FR-013]
  - AC1: sim driver waits with `until()` for *Read-only · Sandboxed*, *Read-only · Sandbox: checking*, *Ask first · Not sandboxed*, *Allow all · Sandboxed (managed)* and *Allow all · Sandboxed (until a new session)*; `check:office` unchanged at both sizes.
  - AC2: with `verified: false` the tooltip ends with "Requested; not verified on a real session."; the Claude tooltip says MCP servers are not covered; the Codex Ask first tooltip has the FR-021 sentence.
- [ ] T031 [P] Settings > Agent apps line per app. [FR-012]
  - AC1: the spec 081 driver waits with `until()` for *OS sandbox: available (…)* and *not available: <reason>* rows from the sim table; the reason is masked and at most 200 characters; Organization page FR-173 text links to it.
- [ ] T032 [P] Simulator states table and `simsendfail=sandbox` for Claude and Copilot sim agents. [FR-017, FR-007]
  - AC1: `DURBAR_SIM=15` shows at least one agent in each state; with `simsendfail=sandbox` a Claude and a Copilot sim agent show the refusal note with the existing *Change mode…* button (`modeRefusalAction`); no real call (`test:simguard` passes).

## Phase 4: Docs

- [ ] T040 README *Safety model* and known limits (per app and OS, what is covered, "not verified on a real session"); `changelog.d/087-os-sandbox-floor.md`; screenshots via `npm run shots:docs`; spec status and index block. [FR-020]
  - AC1: `npm run changelog:check`, `npm run specs:check` and `test:site` pass; the README names, per app, the OS it is sandboxed on and that file tools are checked by Durbar.
  - AC2: every linked picture that shows the mode chip is retaken (`npm run shots:docs -- --only <drivers>`) and looked at.

## Phase 5: Policy

- [ ] T050 `permissions.requireOsSandbox` in the spec 076 loader (narrow-only; bad value → `true`). [FR-019]
  - AC1: policy tests: absent → `false`; `true` → refusals in T020/T021 fakes; `"yes"`, `1`, `null` → `true` (fail closed); a user layer cannot set it back to `false`.

## Phase 6: Real checks (owner's OK and budget first; constitution IV)

Total cost: **about 5 tiny prompts** (Linux 2, macOS 2, Windows 1), plus 1 for T063 only if Q2 is answered "ask". Each check uses
a throw-away folder with an accepted folder allow rule (`Bash(touch:*)`, spec 061) so the command passes Durbar's check and only
the OS sandbox can stop it.

- [ ] T060 Linux: one tiny Read-only prompt each for Claude Code and Copilot that asks to `touch` a file in the folder; record that the OS refuses it (or the gap); record usage. [FR-020, SC-004, K1, K2, K4, K8]
  - AC1: the result and usage are written in spec.md (`real:`), and the verified list gets the Linux entry only for an app whose write was refused.
- [ ] T061 macOS: the same for both apps. [FR-020, SC-004]
  - AC1: as T060 AC1, macOS entry.
- [ ] T062 Windows: Copilot on a Windows 11 build with ProcessContainer (one prompt), and Claude's *Not sandboxed* note recorded with no prompt. [FR-020, SC-004, K9]
  - AC1: as T060 AC1, Windows entry for Copilot only.
- [ ] T063 Ask first network prompt shape for Claude (K3), only if Q2 is answered "ask". [K3]
  - AC1: the request shape is written in research.md R2 with `real:`; one prompt.

## Dependencies

T001 → everything. T010-T013 → T014 → T020-T022 → T030-T032 → T040. T050 any time after T001. Phase 6 after Phase 2, with the
owner's OK.

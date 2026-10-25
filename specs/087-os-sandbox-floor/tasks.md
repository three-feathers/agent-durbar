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
- [ ] T011 [P] [US1] [US2] `src/adapters/claudeSandbox.ts`: `claudeSandboxSettings` and `claudeSandboxState`. [FR-001..FR-003, FR-006, FR-007]
  - AC1: Read-only and Ask first give `enabled: true`, `allowUnsandboxedCommands: false`, `autoAllowBashIfSandboxed: false`, `excludedCommands: []`, the read rules (Q4) and network rules (Q2); Read-only adds `denyWrite` = roots; Allow all gives `undefined`.
  - AC2: `failIfUnavailable` is `true` only when policy requires the sandbox.
  - AC3: `win32` → off with the Windows reason; `linux` without `bwrap` or `socat` → off naming the missing package; `darwin` → on (seatbelt).
- [ ] T012 [P] [US1] [US2] `src/adapters/copilotSandbox.ts`: `copilotSandboxConfig` and `copilotSandboxState` (structural types, no SDK import). [FR-001, FR-002, FR-004, FR-006, FR-014]
  - AC1: Read-only: roots in `readonlyPaths`, `addCurrentWorkingDirectory: false`, network off; Ask first: roots in `readwritePaths`, protected paths in `deniedPaths` only with the `denied_paths` capability; never `allowBypass`; `auth` off.
  - AC2: `supported: false` → off with the masked, clipped reason; missing method → off "this Copilot cannot report its sandbox".
- [ ] T013 [P] `SandboxState` in `src/adapters/types.ts` and on `AgentInfo`; optional, renderer shows nothing when missing. [FR-011]
- [ ] T014 `scripts/test-sandbox-floor.ts` (added to `test:runtime`): every app × OS × mode cell (27), the unavailable cells, the required-policy cells, a scan that no cell has an auto-approve or bypass value, and none turns on credential injection (`auth.git`, `auth.gh`, `credentials`). [SC-001, SC-002, FR-016, FR-018]
  - AC1: a planted mutation (`autoAllowBashIfSandboxed: true`, or `allowBypass: true`) fails the test.

## Phase 2: Adapters

- [ ] T020 [US1] [US2] [US3] Claude adapter: state at launch, the block merged by `claudeSettingsJson` with Durbar's keys last; a start that exits for the sandbox maps to a plain reason; refusal when required. [FR-003, FR-006, FR-007, FR-013]
  - AC1: `test-claude-adapter`: argv carries `--settings` with the block in Read-only and Ask first, not in Allow all; a folder setup `sandbox.allowUnsandboxedCommands: true` does not survive the merge.
- [ ] T021 [US1] [US2] [US3] Copilot adapter: `getHostSupport()` once per runtime start; `options.update` after create/resume, before the first send; refusal when required; `session.warning` type `sandbox` updates the state. [FR-004, FR-006, FR-007, FR-008]
  - AC1: the fake client records the update before the first `send`; a rejected update gives *Not sandboxed* (or a refusal when required).
- [ ] T022 [P] [US1] Codex adapter reports `SandboxState` from its existing checks. [FR-005, FR-011]

## Phase 3: Window and simulator

- [ ] T030 [US1] [US3] Mode chip segment and tooltip text; card mode icon tooltip; mode menu note. [FR-009, FR-010, FR-013]
  - AC1: sim driver waits with `until()` for *Read-only · Sandboxed*, *Ask first · Not sandboxed* and *Allow all · Sandboxed (managed)*; `check:office` unchanged at both sizes.
- [ ] T031 [P] Settings > Agent apps line per app. [FR-012]
- [ ] T032 [P] Simulator states table. [FR-017]

## Phase 4: Docs

- [ ] T040 README *Safety model* and known limits (per app and OS, what is covered, "not verified on a real session"); `changelog.d/087-os-sandbox-floor.md`; screenshots via `npm run shots:docs`; spec status and index block. [FR-020]

## Phase 5: Policy

- [ ] T050 `permissions.requireOsSandbox` in the spec 076 loader (narrow-only; bad value → `true`). [FR-019]

## Phase 6: Real checks (owner's OK and budget first; constitution IV)

- [ ] T060 Linux: one tiny Read-only prompt each for Claude Code and Copilot that asks to `touch` a file; record that it is refused by the OS (or the gap); record usage. [FR-020, SC-004, K1, K2, K8]
- [ ] T061 macOS: the same. [FR-020, SC-004]
- [ ] T062 Windows: Copilot on a Windows 11 build with ProcessContainer, and record Claude's *Not sandboxed*. [FR-020, SC-004, K9]
- [ ] T063 Ask first network prompt shape for Claude (K3), only if Q2 is answered "ask".

## Dependencies

T001 → everything. T010-T013 → T014 → T020-T022 → T030-T032 → T040. T050 any time after T001. Phase 6 after Phase 2, with the
owner's OK.

# Implementation Plan: OS sandbox floor under Read-only and Ask first

**Branch**: `087-os-sandbox-floor` | **Date**: 2026-10-25 | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)

## Summary

Add a pure "floor" mapping per adapter (Claude Code: a `sandbox` block in the `--settings` JSON; Copilot: `sandboxConfig` through
the SDK's experimental `session.options.update`; Codex: unchanged), a normalized `SandboxState` that each adapter reports, and its
display in the chat header chip, the card's mode tooltip and Settings > Agent apps. Durbar's own checks do not change. Built and
checked on the simulator and with fakes; the real per-OS checks are separate, budgeted tasks. Blocked on Q1-Q5.

## Technical Context

**Language/Version**: TypeScript (Electron main + plain renderer), as the rest of the app
**Primary Dependencies**: `@github/copilot-sdk` 1.0.22 (pinned; the sandbox RPCs are `@experimental`); Claude Code CLI (not a
dependency, located at run time); Codex app-server (not a dependency)
**Storage**: none (the state is shown, never saved)
**Testing**: `scripts/test-*.ts` unit tests with injected platform facts; simulator driver for the chip; zero credits
**Target Platform**: Windows, macOS, Linux (each fact per OS in research R5)
**Constraints**: constitution II (no vendor type outside `src/adapters`), III (fail toward stricter, no secrets, argv only),
IV (no credits), V (layout unchanged), VI (per-OS logic in pure functions), VIII (honest wording)

## Reused capabilities (AGENTS.md: look for an existing capability first)

- Claude's `--settings` JSON: `claudeSettingsJson` (`src/shared/foldersetup.ts`, spec 061) is left as is; the Claude adapter
  (`claude.ts`) parses its result and sets the `sandbox` key to the block from `src/adapters/claudeSandbox.ts`, so no vendor key is
  added to `src/shared` (constitution II).
- Claude's relaunch on a mode change (spec 012 FR-115/FR-116): carries the new floor; no new switch path.
- Codex's root normalisation `codexWorkspaceRoots` and `codexReadRoot` (`src/adapters/codexModes.ts`): moved or shared into
  `src/adapters/sandboxRoots.ts` so all three use one rule (FR-015).
- Codex's start hints `linuxSandboxHint`/`macSandboxHint` (`src/adapters/codex.ts`): same style and the same README section
  (Ubuntu AppArmor) for Claude's and Copilot's Linux reasons.
- The mode chip and its tooltip (spec 018, spec 003 FR-026's *restored* note): one more text segment, no new control.
- Settings > Agent apps rows (spec 081): one more line per app.
- Redaction `redact` (spec 012) for vendor reasons; executable lookup from spec 012 detection (`src/adapters/detect.ts`) for
  `bwrap`/`socat` on `PATH`, no shell.
- Organization policy loader and narrow-only rule (spec 076) for `permissions.requireOsSandbox`.
- Refusals: spec 012's `MODE_REFUSAL` / `modeRefusalAction` (`src/renderer/app.js`) adds *Change mode…* to a refusal note whose
  text contains "Read-only and Ask first need"; the simulator fault `simsendfail=sandbox` (`src/renderer/sim.ts`) is extended to
  Claude and Copilot sim agents. No new refusal path.
- Codex approval cards: `codexPermission` (`src/adapters/codexModes.ts`) fills a separate `sandboxNote` field (FR-021) that the
  existing permission card shows on its own line, so the one-line `summary` is not lengthened.
- The *Continue without the OS sandbox* confirmation uses the shared `askDialog`; the note's buttons sit in the same `note-actions`
  row `modeRefusalAction` builds.

## Constitution Check

| Principle | How this plan holds it |
| --- | --- |
| I Spec Kit | spec, plan, research, tasks first; no `src/` change in this PR |
| II Adapters are plug-ins | `SandboxState` is a normalized optional field; vendor names stay in `src/adapters`; the UI shows nothing when it is missing |
| III Safe by default | the floor only narrows; `autoAllowBashIfSandboxed: false`, no bypass, no credential injection; unknown → treated as off and shown; bad policy value → fail closed |
| IV No credits | sim and fakes; real checks are separate tasks with a stated cost |
| V Calm UI | words in the chat header chip and tooltips only; 15-agent layout unchanged |
| VI Parity | per-OS decisions in pure functions with injected `platform` and `PATH` lookup; Windows gaps written as `[KNOWN GAP]` |
| VII Quality gates | unit tests for every mapping; sim screenshots for the chip; docs |
| VIII Honest limits | the tooltip says file tools are checked by Durbar, not the OS; every vendor fact `read:`; K1-K11 open |

## Design

### Pure modules (new, `src/adapters/`)

- `sandboxRoots.ts`: `sandboxRoots(cwd, folders, platform)` → normalised roots or `undefined` (refuse); shared with Codex.
- `claudeSandbox.ts`: `claudeSandboxSettings({ mode, roots, platform, require })` → the `sandbox` object or `undefined` (Allow
  all); `claudeSandboxState({ platform, haveBwrap, haveSocat, startError })` → `SandboxState`.
- `copilotSandbox.ts`: `copilotSandboxConfig({ mode, roots, host })` → `SandboxConfig`-shaped object (local structural type, no SDK
  import in the pure module); `copilotSandboxState(host, source?)` → `SandboxState`.
- `SandboxState` type in `src/shared/api.ts` next to `AgentInfo` (normalized: no vendor name or key), filled by the adapters.

### Adapters

- **Claude** (`claude.ts`): at launch, the pre-checks (version ≥ 2.1.219, platform, `bwrap`/`socat`) decide whether to try; when
  trying, `--settings` carries the block with `failIfUnavailable: true` and the state is `unknown`. Surviving the start sets `on`.
  `on` is set at the `system`/`init` message (`initSeen`). An exit before `init` that the pure classifier recognises as the
  sandbox's is mapped to a plain reason (K4); others go to the existing `onExit` crash path. Then policy required → refusal
  (FR-007); otherwise nothing is re-sent and the note offers *Continue* / *Change mode…*; *Continue* relaunches with the same argv
  minus the `sandbox` key and sets the per-session "unavailable, continued" flag (FR-007a, FR-007b). Version from `detectClaude` /
  `parseVersion` (`src/adapters/detect.ts`; PR #698 hardens it).
- **Copilot** (`copilot.ts`): one `getHostSupport()` per runtime start (cached, refreshed on *Check again*); after
  `createSession`/`resumeSession` and before the first `send`, `session.rpc.options.update(...)` with `allowDevToolAccess: false`
  and the session's `PATH` folders as `readonlyPaths`. A thrown or `false` result → state off with reason; refusal when required.
  Listen for `session.warning` type `sandbox` (FR-008). A switch to Allow all sends nothing (`untilNewSession`).
- **Codex**: report `SandboxState` from the existing checks (`on`, mechanism by platform, `covers: ['shell','files']`,
  `approvedMayLeave: true` in Ask first); the FR-021 sentence on its approval cards.
- **Verified list**: a constant per adapter of `(platform)` entries with a recorded real check (empty until T060-T062); `verified`
  in `SandboxState` comes from it and drives the tooltip's "Requested; not verified" ending (FR-010).

### Window

- Mode chip text segment and tooltip (FR-009, FR-010); card mode icon tooltip; Settings > Agent apps line (FR-012).

### Simulator

- Sim agents get a `sandbox` state from a fixed table (on/seatbelt, on/bubblewrap, off/"no OS sandbox on Windows", managed),
  no real call.

## Project Structure

```text
specs/087-os-sandbox-floor/   spec.md plan.md research.md tasks.md checklists/requirements.md
src/adapters/                 sandboxRoots.ts claudeSandbox.ts copilotSandbox.ts (new); claude.ts (sandbox key of --settings) copilot.ts codex.ts codexModes.ts
src/shared/api.ts             SandboxState type (normalized, next to AgentInfo)
src/renderer/                 chip, tooltip, Settings > Agent apps line
scripts/                      test-sandbox-floor.ts (new), driver check for the chip
```

## Phases

1. Spec deltas in 003, 012, 018, 061, 076 (cross references) once Q1-Q5 are answered.
2. Pure modules and their tests (all OS × mode × app cells, SC-001/SC-002).
3. Adapters (Claude, Copilot, Codex state).
4. Window and simulator; screenshots.
5. Docs (README safety model and known limits, changelog fragment).
6. Real checks per OS (budgeted, owner's OK; constitution IV).

## Complexity Tracking

| Item | Why it is needed | Simpler option rejected because |
| --- | --- | --- |
| Copilot via an `@experimental` RPC | the high-level `createSession` of SDK 1.0.22 does not forward a sandbox field | waiting for a stable field leaves Copilot with no floor |
| Per-app coverage text | each sandbox covers different tools | one generic "Sandboxed" would overclaim (constitution VIII) |

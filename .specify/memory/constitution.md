# Agent Durbar Constitution

<!--
Sync Impact Report
Version change: (template) -> 1.0.0
Added principles: I Spec Kit workflow is mandatory; II Agent adapters are plug-ins; III Safe by default, no stored secrets;
  IV No AI-credit spend in tests; V Calm, legible UI; VI Windows, macOS and Linux parity; VII Quality gates; VIII Honest limits
Templates reviewed: .specify/templates/plan-template.md (Constitution Check is generated from this file, no edit needed),
  spec-template.md, tasks-template.md (no edit needed)
Follow-ups: none
-->

Agent Durbar is a small, MIT-licensed Electron + TypeScript app that shows many coding agents (Copilot first) as an office,
lets you chat with them and approve what they do. It starts real agents on a user's machine that can edit files and run
commands, and it can spend the user's AI credits. That is why these rules exist.

## Core Principles

### I. The Spec Kit workflow is mandatory for every change (NON-NEGOTIABLE)

Every change to behavior goes through GitHub Spec Kit, in order:
`/speckit.constitution` (once, then on amendment) -> `/speckit.specify` -> `/speckit.clarify` -> `/speckit.plan` ->
`/speckit.tasks` -> `/speckit.analyze` -> `/speckit.implement` (then `/speckit.converge`).

- No code under `src/` (or behavior-changing code in `scripts/`, `.github/workflows/`, `package.json` build config)
  without a `specs/NNN-name/` folder holding `spec.md`, `plan.md` and `tasks.md`, linked from the pull request.
- Specs describe what and why; plans describe how. Do not mix them.
- **Bug fixes** need a *spec delta*, not a full new spec: add a dated entry under `## Changes` in the owning feature's
  `spec.md` (symptom, the requirement or scenario it violated or was missing, the corrected wording), add the fix and
  its regression test as tasks in that feature's `tasks.md`, and tick them when done. A plan changes only if the
  architecture does.
- The specs of everything already built were reverse-engineered from the code (features 001-010). Each requirement is marked
  `[IMPLEMENTED]` or `[KNOWN GAP]`, and tests are marked as present or missing. When code and spec disagree, fix one of
  them in the same pull request; never leave them drifting.
- Allowed exemption, narrow: a pull request may declare `Spec-Exempt: <reason>` (PR body line or the `spec-exempt` label)
  only for changes with no behavior change: typo/comment/formatting fixes, dependency bumps with no code change, CI-only
  fixes, and reverting a broken commit. The reason is read by the reviewer; "small" or "quick" is not a reason.
- Work that needs spending money or an external account (for example code-signing certificates) is specified first and
  marked `needs-approval`; nothing is bought or created before the owner approves it.

Rationale: the app is hard to test end to end (real agents cost credits), so the spec is the contract that tests and
reviews check against.

### II. Agent adapters are plug-ins

Everything runtime-specific (Copilot today; Claude Code and Codex later) lives behind the `AgentAdapter` interface in
`src/adapters/types.ts`, which speaks only normalized `AgentEvent`s (`status`, `thinking`, `output`, `toolCall`,
`subagent`, `usage`, `permission`, `grants`, `user`).

- The renderer and the Electron main process (other than choosing an adapter) must not import an SDK or know a vendor's
  event names. Mapping vendor events to normalized events happens inside the adapter.
- Capabilities an adapter may lack (`interrupt`, `resolvePermission`, `revokeGrant`) are optional in the interface and
  the UI degrades when they are missing; it must not assume them.
- Pure logic (permission broker, history conversion, path matching) stays in dependency-free modules with unit tests so a
  second adapter can reuse it.
- Pin the vendor SDK/runtime version; protocols here are still changing.

### III. Safe by default; secrets are never stored (NON-NEGOTIABLE)

- Default permission mode is **read-only**: reads are approved, everything that can change state (write, shell, URL,
  MCP, custom tools) is denied. **Ask** leaves each such request pending for the user. **Allow all** approves everything
  and must remain an explicit, per-agent opt-in, named honestly in the UI and docs.
- "Approve for this session" grants are narrow (a folder, a simple command name, a host, a tool), visible as chips,
  revocable, and dropped when the session ends. Deny never remembers.
- Agent Durbar never reads, stores, logs or transmits tokens or credentials. Sign-in belongs to the vendor runtime.
  No telemetry. Saved state (folder list) holds paths and choices only.
- Never spawn a process through a shell with user-controlled text; the renderer only gets a narrow, typed preload
  bridge (context isolation on, sandbox on, no Node in the renderer, strict CSP).
- Anything crossing the IPC boundary is validated in the main process, not trusted from the UI (file paths are looked up
  by agent id, attachments are re-checked, resumed sessions must belong to the agent's folder).
- Untrusted files (attachments, VS Code chat stores, session files) are parsed tolerantly with size caps and are never
  executed or uploaded.

### IV. No AI-credit spend in tests (simulator first)

- `npm test`, CI and every development loop run with **zero** AI credits and no Copilot login. The simulator
  (`DURBAR_SIM=N`, `?sim=N`) and synthetic fixtures feed the same renderer path as a real adapter.
- A feature is built and verified on the simulator first. Real-session verification is a deliberate, separate task:
  one tiny prompt, read-only unless the test is about writes, the usage reported by the runtime is recorded in the spec,
  and it is never part of CI.
- Specs say which requirements were verified on a real session and which only on the simulator or fixtures.

### V. Calm, legible UI

- Text is never smaller than **10.5px** in any density, and the office is never scaled down to fit.
- **15 agents (with sub-agents) must be readable on one 1440x900 and one 1280x800 screen**, with the chat closed and open,
  with no page overflow, no overlapping or clipped text and no layout jumps when status changes. The density is chosen
  automatically (full, roomy, card, mini, micro); the floor may scroll inside itself only past that scale.
- State is never shown by colour alone (icon/word too). Agents that need the user (waiting, error) sort first.
- Motion is CSS-only, coarse and cheap, and stops under `prefers-reduced-motion`. No emoji, no blur filters in compact scenes.
- Keyboard and screen-reader basics hold: focusable controls with names, Esc closes the chat, live regions for toasts.

### VI. Windows, macOS and Linux parity

- Every feature works on all three, or the spec states the gap under a `[KNOWN GAP]`.
- Paths are handled with `path` (including `win32`/`posix` variants for pure code under test), compared case-insensitively
  on Windows and macOS, never concatenated with `/`. File locations differ per OS and are resolved in one place.
- OS-specific behavior is isolated in small pure functions with an injected environment so it can be unit-tested from any OS
  (see `planVSCodeLaunch`, `vscodeUserDirs`, `unpackedRuntimePath`).
- CI runs build + tests on `ubuntu-latest`, `macos-latest` and `windows-latest`. Packaging is built for all three on release.
- Be honest about verification: on-device checks done so far are Linux only; macOS and Windows are covered by unit
  tests and CI, not by a person using the app, until a spec records otherwise.

### VII. Quality gates

A change is done only when:

1. `npm run typecheck`, `npm run build` and `npm test` pass (CI runs them on three OSes).
2. Behavior that changes the UI has fresh screenshots at 1440x900 and 1280x800 (simulator, 15 agents where the office is
   affected) committed under `docs/screenshots/` and linked from the spec or README.
3. New or changed logic in the permission broker, attachments, launcher, history/VS Code readers or the folder store has a
   test in `scripts/`.
4. The pull request has the spec, plan and tasks linked, a Constitution Check, and the `Spec Kit` CI check is green
   (or `Spec-Exempt` with a reason).
5. README / docs claims match the code (limits included). A claim that cannot be verified is worded as unverified.

### VIII. Honest limits, documented

- Say what is not verified, not done or not possible, in the README and in the spec, next to the feature.
  Examples already true: VS Code chat history is read-only and its format is undocumented; sub-agent identity is
  best effort; builds are unsigned and not notarized; reasoning output depends on the model.
- No marketing claims the code cannot back. No "works on macOS/Windows" without a recorded check.
- An independent project: no implication of affiliation with GitHub or Microsoft; trademarks are respected.
- Known gaps are tracked as `[KNOWN GAP]` requirements and open tasks, not in someone's memory.

## Additional Constraints

- Stack: Electron, TypeScript (`src/main`, `src/adapters`, `src/shared`, `src/preload`), plain HTML/CSS/JS renderer,
  dependency-light. New runtime dependencies need a line in the plan explaining why.
- Releases: tag-triggered, built by GitHub Actions into a **draft** pre-release; the owner publishes by hand.
  Actions are pinned by commit SHA.
- License MIT; contributions are MIT.
- Personal project of Vikram Gorla under his personal GitHub account; no org infrastructure or credentials are used.

## Development Workflow

1. Idea or bug -> `/speckit.specify` (new feature) or a spec delta (bug in an existing feature).
2. `/speckit.clarify`, `/speckit.plan` (with a Constitution Check), `/speckit.tasks`, `/speckit.analyze`.
3. `/speckit.implement` on a branch; simulator and unit tests while developing; screenshots for UI.
4. Pull request from the template; CI (`CI` and `Spec Kit`) green; `/speckit.converge` to confirm nothing is left open.
5. Update `tasks.md` checkboxes and any `[KNOWN GAP]` that was closed, in the same pull request.

Commands are installed in the Copilot *commands* layout (`.github/prompts/speckit.*.prompt.md`,
`.github/agents/speckit.*.agent.md`), so they are invoked as `/speckit.<name>` in Copilot Chat. Coding agents other than
Copilot must read `AGENTS.md` and follow the same steps by hand.

## Governance

This constitution outranks other practices in the repository. Amendments are made with `/speckit.constitution`, in a pull
request that states the reason and bumps the version (MAJOR: a principle removed or redefined; MINOR: a principle or rule
added; PATCH: wording). Every plan's Constitution Check and every pull request review verifies compliance; a violation
needs a written, time-boxed justification in the plan's Complexity Tracking table.

**Version**: 1.0.0 | **Ratified**: 2026-10-16 | **Last Amended**: 2026-10-16

# Feature Specification: Second and third agent adapters (Claude Code, Codex CLI)

**Feature Branch**: `012-adapters-plan` (planning), later `012-<slug>` per task
**Created**: 2026-10-16
**Updated**: 2026-10-17 (clarify, plan, tasks and research done; **no code yet**)
**Status**: Planned. Spec, [research](research.md), [plan](plan.md) and [tasks](tasks.md) exist. Phase 1 (simulator and fakes only) can start. Anything that needs a real account or spends credits is marked `needs-owner-approval` and is blocked until the owner says yes in writing.
**Input**: README roadmap "Second adapter (Claude or Codex CLI)" and constitution principle II (adapters are plug-ins). Umbrella issue: [#2](https://github.com/three-feathers/agent-durbar/issues/2).

## What exists today

- `[IMPLEMENTED]` `AgentAdapter` (`src/adapters/types.ts`): `start`, `send`, optional `interrupt`, `stop`, `resolvePermission`, `revokeGrant`, `setCap`, `resolveLimit`, `setMcpEnabled`, and `onEvent` of normalized events (spec 002). One implementation: `CopilotAdapter` (`copilot.ts`). `read:`
- `[KNOWN GAP]` The interface has **never been implemented twice**, so it is unproven for other agents.
- `[KNOWN GAP]` `main.ts` builds one `CopilotAdapter` and also calls members that are **not** on the interface: `isLive`, `dispose`, `listModelOptions`, `listPreviousSessions`, `history`, `setPermMode`, `debug`. `read:` (found while writing the plan)
- `[KNOWN GAP]` There is no adapter registry: choosing an adapter per folder or agent does not exist.
- `[KNOWN GAP]` The simulator (spec 010) is renderer-side (`src/renderer/sim.ts`); it is not an `AgentAdapter`. A main-side scripted fake does not exist yet.
- `[KNOWN GAP]` `ensureLive` starts a session with `sessionId = agent id`. Codex chooses its own thread id, so a vendor session id must be stored next to the agent id.
- Copilot-shaped parts to generalise: `StartOptions` (credit cap in AIU, `autoTier`), `UsageEvent.nanoAiu`, the model list, the history readers (`history.ts` reads Copilot's `events.jsonl`).
- Research (this feature, `docs:` only, nothing run on a real account): see [research.md](research.md).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Add a folder and choose which agent works in it (Priority: P1)

When I add a folder I can pick Copilot (default), Claude Code or Codex; its agent appears in the office, chats, asks permission and shows usage like any other.

**Independent Test**: a scripted `FakeAdapter` (no vendor process) passes the same credit-free adapter contract suite as the Copilot fake client and, later, the Claude and Codex mappers.

**Acceptance Scenarios**:

1. **Given** Claude Code or Codex is not installed, **When** I open the picker, **Then** it is shown as unavailable with the install hint and nothing is spawned except a version probe.
2. **Given** a Claude or Codex agent running, **When** it asks to edit a file, **Then** the same approval card appears and the same three modes apply (Read-only by default), or the adapter says it cannot enforce a mode and refuses to start in it (constitution III).
3. **Given** an adapter without helper or sub-agent events, **When** it works, **Then** the desk shows no helper tiles and nothing breaks.
4. **Given** the CLI is installed but I am not signed in, **When** I start an agent, **Then** I see "Sign in with the `claude` / `codex` command in a terminal" and no model call is made. Durbar has no login button in v1.

### User Story 2 - Capabilities are declared, not guessed (Priority: P2)

Each adapter declares what it can do (interrupt, resume, images, models, effort, permission modes, live mode switch, usage kinds, context, caps, helpers, history, MCP status and switch) and the UI hides or disables what is missing. Honest limits are shown next to the control ("Codex: applies from the next message").

### User Story 3 - Contract tests for every adapter (Priority: P2)

One adapter contract suite runs against Copilot (fake SDK client), the `FakeAdapter` and, once they exist, the Claude and Codex adapters on fake processes, without AI credits or accounts.

### User Story 4 - Honest permission modes per agent (Priority: P1)

Read-only, Ask first and Allow all mean the same promise on every agent, or the difference is stated in the UI and README. Where a vendor cannot honour a mode, the agent does not start in it.

### User Story 5 - Honest usage and context (Priority: P2)

Tokens and context size show for every agent when the runtime reports them. Money is shown only as the vendor reports it, labelled, and never added to Copilot's AIU.

### User Story 6 - Resume and previous sessions (Priority: P3)

I can resume an agent's session after restart, and see earlier sessions of that agent type in the same folder, read through the vendor's own list/read API.

### Edge Cases

- The CLI is installed but too old, a different version, or prints unexpected output: show the version and what is needed; ignore unknown events.
- Two agents of different kinds in the same folder.
- An adapter or its child process crashes: that agent becomes `error`; the others keep running (constitution II).
- Credentials: signing in stays in the vendor tool; Durbar never reads, stores or forwards tokens (constitution III). A GUI app does not see variables exported in a shell profile (research 2.5, 3.5): say so.
- The folder carries its own hooks or MCP servers (`.claude/settings.json`, `.mcp.json`, `.codex/config.toml`): not loaded until the folder is trusted in Durbar (FR-025).
- A permission request is pending when the user stops the agent: it is answered deny/cancel and the status leaves `needs-permission`.
- Windows: `.cmd` shims and paths with spaces; the Codex Windows sandbox may need a setup step.

## Requirements *(mandatory)*

### Functional Requirements

Original (kept):

- **FR-001** An adapter registry in the main process maps adapter id → descriptor and factory; `agents:add` takes an adapter id (default `copilot`); persisted folders store it (migration keeps old files working).
- **FR-002** `AgentAdapter` gains `capabilities` (a declared object); the renderer reads it through IPC types in `src/shared` that contain no vendor types.
- **FR-003** Claude Code adapter and Codex adapter in `src/adapters/`, each behind the interface. Transports: **decided** (clarification C1, C2): Claude Agent SDK, Codex `app-server`. Trade-offs are in [research.md](research.md) and [plan.md](plan.md).
- **FR-004** Permission mapping: each adapter maps its own approval prompts to `PermissionRequest` kinds and to the three modes; anything it cannot enforce is declared and refused, never silently weakened.
- **FR-005** Normalized events are extended only when needed, by a dated spec delta in 002. The deltas this feature needs are listed in the plan (optional `costUsd`, `costBasis`, `creditsStatus` use, `externalSessionId`).
- **FR-006** Spawning follows the repo rules: argv array, absolute path resolved per OS, no shell with user-controlled strings, no logging of environment values.
- **FR-007** Tests: adapter contract suite plus per-adapter mapping tests with fixtures; no real sessions in `npm test`. Fixtures are labelled `synthetic` (written from vendor docs and types) until a recording is approved; only recorded ones may carry `real:`.
- **FR-008** The README documents what each adapter supports and what was verified on a real session (spec 013 style).

New:

- **FR-009** `AdapterCapabilities` (plan, section "Capabilities"): at least `interrupt`, `resume`, `images`, `models`, `effort`, `permissionModes` (subset of read-only/ask/allow), `liveModeSwitch` (`immediate` | `next-message` | `none`), `usage` (`tokens`, `costUsd`, `nanoAiu`), `context`, `caps`, `helpers`, `history`, `mcpStatus`, `mcpToggle`.
- **FR-010** `detect()` per adapter: availability probe with an injected exec. It finds the binary (PATH, then a configured path; Windows shims included), reads `--version`, compares with the supported minimum and, when the vendor offers a free call, the sign-in state. It never sends a prompt. Result: `ready | not-installed | too-old | not-signed-in | unknown` plus a short hint.
- **FR-011** The persisted folder entry keeps the adapter id and, when the vendor assigns its own session id, a vendor session id (migration: existing entries are Copilot, id = agent id).
- **FR-012** Authentication: the vendor runtime signs in. Durbar never reads, copies, stores, logs or forwards credentials, and has no in-app login in v1. Sign-in state is shown read-only when the vendor gives it without a model call.
- **FR-013** Permission modes per agent follow the mapping tables in the plan. The default is Read-only. The adapter sets the vendor's mode **explicitly** every time (Claude Code can otherwise start in `auto`). Enforcement is layered (mode plus an interception point that denies), and a mode the adapter cannot enforce is refused at start.
- **FR-014** Tool events: `toolCall` carries `tool` and, for MCP, `mcpServer` and `mcpTool` as the vendor gives them (Codex: direct fields; Claude: parsed from `mcp__<server>__<tool>` against the server names of the init message). When the origin cannot be told, only `tool` is set. Never guess a server name.
- **FR-015** Usage: tokens when reported. Dollar cost only as the vendor's estimate, in an optional `costUsd` with `costBasis: 'estimate'`. `nanoAiu` stays Copilot's. Totals never add different units; an agent whose runtime reports no money shows "credits not reported" (spec 011).
- **FR-016** Context: a `context` event from the vendor's own numbers; unknown stays unknown (`limit: 0`).
- **FR-017** Interrupt keeps the session; stop ends it and the child process; resume continues by vendor session id. A pending permission is answered deny/cancel when the agent is stopped.
- **FR-018** Sub-agents: map to `subagent` events with `subagentId` = the spawning tool call id where the vendor gives it; where not, no helper tiles (User Story 1.3).
- **FR-019** Previous sessions of the same folder and agent type are listed read-only through the vendor's list/read API, with size caps and tolerant parsing. Durbar does not parse the vendor's transcript files itself unless the vendor offers no API, and then only after a spec delta.
- **FR-020** The vendor SDK/CLI version is pinned or range-checked, recorded in the session, and unknown events or fields are ignored, never fatal.
- **FR-021** Packaging: Durbar does **not** bundle the Claude Code or Codex binaries by default (about 286 MB and 430 MB unpacked per platform on npm). It uses the user's installed CLI. Open question Q4 covers the Claude SDK package itself.
- **FR-022** Real-account verification (one tiny prompt per check, Read-only unless the check is about writes, usage recorded in the spec) is a separate task set, marked `needs-owner-approval`, never part of CI (constitution IV).
- **FR-023** Capabilities and the contract suite decide what the UI shows; no adapter-name checks in the renderer.
- **FR-024** `[KNOWN GAP]` Per-session injection of Durbar's global MCP servers (spec 019/020) into Codex, and per-session switch-off, are unverified; until verified, Codex declares `mcpToggle: false` and shows MCP status read-only.
- **FR-025** Folder trust: project-level vendor settings (`.claude/settings.json`, `.mcp.json`, `.codex/config.toml`) are not loaded for a folder until the user has trusted that folder in Durbar (reuses the spec 020 trust prompt). Claude: `settingSources` defaults to `['user']`; Codex: its own project trust applies.

### Key Entities

- **AdapterDescriptor**: id, display name, install hint, `detect()`, `capabilities`, factory.
- **AdapterCapabilities**: see FR-009.
- **VendorSession**: Durbar agent id, adapter id, vendor session id, folder, last mode.

## Success Criteria *(mandatory)*

- **SC-001**: Two adapters of different kinds run side by side in the office on fakes (no vendor process) with no renderer change beyond the picker and capability gating.
- **SC-002**: The contract suite passes for every adapter on Windows, macOS and Linux CI.
- **SC-003**: Unsupported capabilities never show a dead button.
- **SC-004**: The same scripted "try to write a file" case is denied in Read-only on every adapter, held in Ask first, and approved in Allow all (fake processes).
- **SC-005**: The README table of what is verified per adapter says `simulator/fixtures only` until a recorded real run exists.

## Clarifications

### Session 2026-10-17 (written by an agent from research; the owner reads it in the pull request)

Spec Kit says to ask the owner when something is ambiguous. The owner was not asked live. So each answer below is one of: **Decided** (follows from the constitution or from the research, cheap to change later), **Proposed** (a recommendation the owner should confirm or overturn in the PR review), or **Open** (needs the owner; blocks the tasks that depend on it).

- **C1 Transport for Claude Code.** **Decided:** the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`, exact version pinned) in streaming-input mode. It has the approval callback, hooks, interrupt, live mode switch, MCP status, sub-agent ids, usage and session helpers; headless `claude -p` has no approval callback and ACP hides the MCP server name and sub-agent identity. ACP stays the fallback.
- **C2 Transport for Codex.** **Decided:** `codex app-server` over stdio JSON-RPC with our own small client (no new dependency). `codex exec --json` and `@openai/codex-sdk` cannot ask for approval; `codex mcp-server` has been removed. ACP stays the fallback.
- **C3 Which adapter first?** **Proposed:** shared Phase 1 and 2 for both. Then **Codex first** for the transport (supported pattern for a local rich client, Apache-2.0, no new dependency, user's own login), **Claude second** (best technical fit, but see Q1 and Q3). Owner may reverse.
- **C4 Where do binaries come from?** **Decided:** the user's installed `claude` / `codex`, found by `detect()`. Durbar does not bundle them (installer size). The Claude SDK package is a separate question (Q4).
- **C5 Authentication.** **Decided:** no in-app login, no token handling, no key entry in v1. The user signs in with the vendor CLI. Durbar reads only what the vendor gives for free (version, sign-in state) and shows it. A GUI limitation (shell-profile variables are not visible) is documented.
- **C6 Permission modes.** **Decided** by FR-013 and the plan's tables. Claude: Read-only = `dontAsk` with a read-only allow list plus a `PreToolUse` deny hook; Ask first = `default` with `canUseTool`; Allow all = `bypassPermissions`. Codex: Read-only = OS sandbox `read-only` with approval policy `never`; Ask first = sandbox `read-only` with `on-request` (every write or escalation asks); Allow all = `danger-full-access` with `never`. **Codex Read-only differs in kind:** shell commands may run inside the read-only sandbox (Codex reads files through the shell). It is shown as "OS-enforced read-only" and recorded as a difference in the README (Q6).
- **C7 "Approve for this session".** **Decided:** Durbar's own revocable grants (spec 003) are used; Codex's `acceptForSession` is not, because it cannot be revoked or shown as a chip.
- **C8 Live mode switch (spec 018).** **Decided:** declared per adapter: Claude `immediate` (`setPermissionMode`), Codex `next-message` (the new policy is sent with the next `turn/start`).
- **C9 Credit caps (spec 011).** **Decided:** Claude and Codex declare `caps: false` in v1. The cap is AIU; Claude's `maxBudgetUsd` is a dollar estimate and a different thing. A dollar cap is Q7.
- **C10 Usage units.** **Decided:** tokens everywhere they exist; optional `costUsd` (estimate, Claude only); no office total mixing units; per-agent card shows tokens and a labelled estimate in the tooltip.
- **C11 Previous sessions of other tools.** **Proposed:** yes, same folder and same agent type only, read-only, through `listSessions`/`getSessionMessages` (Claude) and `thread/list`/`thread/turns/list` (Codex), after live sessions work.
- **C12 Folder trust.** **Proposed:** FR-025. Claude `settingSources: ['user']` by default; project settings only after Durbar's trust prompt.
- **C13 Interface changes.** **Decided:** promote what `main.ts` already uses (`isLive`, `dispose`, `listModelOptions`, `listPreviousSessions`, `history`, `setPermMode`) to optional interface members gated by capabilities, in Phase 1, with Copilot behaviour unchanged (existing tests must stay green).

### Open questions for the owner

- **Q1 (blocks any real Claude run) Subscription login.** Anthropic's docs say third-party developers may not offer claude.ai login or rate limits for products built on the Agent SDK, "unless previously approved", and that developers should use API-key (or cloud provider) authentication. They also say they do not stop a user signing in to the unmodified Claude Code binary with their own plan. Does Durbar (a) support API key / cloud-provider users only, (b) also run on the user's own `claude` login as an unmodified local binary, accepting the grey area, or (c) ask Anthropic first? Same question, milder, for Codex: its docs say app-server auth is not permitted for commercial or hosted services; Durbar is local and non-commercial.
- **Q2 (blocks Phase 4) Budget for real checks.** How many prompts, on which plan, with which accounts, and who runs them? Until the owner says so, every real-session task stays blocked (`needs-owner-approval`).
- **Q3 New dependency with a non-OSI licence.** The Claude Agent SDK is under Anthropic's Commercial Terms, not MIT/Apache. Accept it as a runtime dependency of an MIT project? (Codex needs none.)
- **Q4 Claude SDK and the CLI binary.** Use the SDK's bundled binary (about 286 MB per platform, bigger installer) or `pathToClaudeCodeExecutable` pointing at the user's own `claude` (small, but the SDK and the CLI versions must be compatible)? Proposal: the user's own binary, with a minimum-version check.
- **Q5 Order.** Confirm or reverse C3.
- **Q6 Codex Read-only wording.** Accept that Codex's Read-only is an OS sandbox in which shell reads can run, shown as such? The alternative (deny all shell) would make Codex unable to read files.
- **Q7 Dollar cap for Claude.** Add a `maxBudgetUsd` cap later as a separate setting, or leave caps Copilot-only?
- **Q8 Trust for project settings.** Confirm FR-025 (project settings only after trust), which costs some convenience (a repo's own `.claude` hooks and agents will not run until trusted).
- **Q9 Windows.** Is a Windows check of the Codex sandbox (it may need an elevated setup step) acceptable as a later, owner-run task, with Windows Read-only declared `[KNOWN GAP]` meanwhile?

## Assumptions and dependencies

- Depends on 002 (interface), 003 (permissions), 006 (folders, history), 007 (models), 011 (usage, caps), 018 (mode switch), 019/020 (MCP), 010 (simulator), 013 (real recordings for fixtures).
- Vendor documentation read on 2026-10-17 is the only evidence so far. It is not a test.
- The SDK or CLI of either vendor may change or be withdrawn; pinned versions and a minimum-version check are part of every adapter task.

## Changes

- **2026-10-18, T010 scope restated against today's code (issue #30; built 2026-10-18 on the simulator and in unit tests, not checked on a real account).** The plan was written on 2026-10-17. Since then spec 030 added optional `setModel`, `cancelQueuedModel` and `compact` to `AgentAdapter`, `ModelEvent`/`CompactionEvent`, a `ModelControl` object in `AgentInfo` derived from member presence (`modelControlFor`), and `main.ts` now holds a second, typed reference `generic: AgentAdapter` for those members. `read:` `src/adapters/types.ts:279-308`, `src/main/main.ts:56-58`, `src/shared/modelswitch.ts:54-80`.
  - **What T010 is now.** A pure interface and plumbing change in `src/adapters/types.ts`, `src/adapters/copilot.ts`, `src/adapters/copilotmodel.ts`, `src/shared/modelswitch.ts`, `src/main/main.ts` and `src/main/mcpipc.ts`. No new adapter, no registry (T011), no `AdapterInfo` or IPC (T011/T014), no change to `src/shared/api.ts`, the preload or the renderer, no new dependency. Copilot behaviour is unchanged and every existing test stays green.
  - **Stale text corrected.**
    - The model list member is `listModelOptions?()`, not `listModels?()` (plan "Interface changes" item 2, tasks T010). `CopilotAdapter.listModels()` already exists with the SDK's `ModelInfo[]` (a vendor type, used by `scripts/smoke.ts`), so an interface member of that name would either clash or leak a Copilot type. C13 already used the right name. `read:` `src/adapters/copilot.ts:83-91`.
    - `isLive` and `dispose` become **required**, not optional: `main.ts` calls `isLive` on every start, cap, limit, model and MCP path and `dispose` on quit, so every adapter needs them. `read:` `src/main/main.ts:200,429,440,471,503,696,711`, `src/main/mcpipc.ts:142,151`.
    - The instance does not carry a full `descriptor`: `detect()` and the factory belong to the registry record (T011, T012), not to an object the factory made. T010 adds `displayName` and `capabilities` only; `AdapterDescriptor` is defined in T011.
    - `ModelOption` moves to `src/shared/modelswitch.ts` (with the other spec 030 model types), not to `src/shared/api.ts`.
    - `debug` (the `DURBAR_LOG` sink, `src/main/main.ts:138`) is also a non-interface member `main.ts` uses; it becomes an optional interface member.
    - The live model switch already has capability data (`ModelControl`, spec 030 FR-017). `AdapterCapabilities` does not repeat it; the permission-mode switch field uses the same words as `ModelControl.switch` (`'live' | 'next-message' | 'none'`) instead of the plan's `'immediate'`.
  - **FR-026** `[IMPLEMENTED]` (test: `scripts/test-copilot-model.ts`) `AgentAdapter` gains `readonly displayName: string` and `readonly capabilities: AdapterCapabilities` (FR-009 shape, plain data, in `src/adapters/capabilities.ts`), and the required members `isLive(sessionId): boolean` and `dispose(): Promise<void>`; and the optional members `listModelOptions?()`, `listPreviousSessions?(cwd, excludeIds?)`, `history?(sessionId)`, `setPermMode?(sessionId, mode, opts?)` and `debug?`. Shapes are today's Copilot ones..
  - **FR-027** `[IMPLEMENTED]` (test: `scripts/test-copilot-model.ts`) Every optional member and its capability agree: `interrupt` ⇔ `interrupt()`, `models` ⇔ `listModelOptions()`, `history` ⇔ `listPreviousSessions()` and `history()`, `caps` ⇔ `setCap()` and `resolveLimit()`, `mcpToggle` ⇔ `setMcpEnabled()`, `permModeSwitch !== 'none'` ⇔ `setPermMode()`. A unit test checks it for `CopilotAdapter`; T015 runs the same check on every adapter..
  - **FR-028** `[IMPLEMENTED]` (test: `scripts/test-copilot-model.ts`) `StartOptions.permissionMode?: 'read-only' | 'ask' | 'allow'` is the one source of truth when present. Absent: the old `allow`/`ask` booleans decide (kept for scripts and tests). Present together with the booleans: `permissionMode` wins. An unknown value is Read-only (constitution III). `main.ts` sends `permissionMode` only. `resumeSessionId` is documented as the vendor's session id..
  - **FR-029** `[IMPLEMENTED]` (test: `scripts/test-usagedoc.ts`) `UsageEvent` gains `costUsd?: number` (the vendor's own estimate for this call, never a bill) and `costBasis?: 'estimate'`. Copilot never sets them. No total adds `costUsd` to AIU: `recordUsage` and the renderer's sums read `nanoAiu` only (FR-015). Spec 002 gets the matching `## Changes` line in the same pull request (FR-005)..
  - `[KNOWN GAP]` (T015) The presence-guard fallbacks in `src/main/main.ts` and `src/main/mcpipc.ts` (an adapter without `listPreviousSessions`, `history`, `listModelOptions`, `setPermMode` or `setMcpEnabled`) are checked by reading the code and by TypeScript, not by a test: no unit test drives the IPC handlers. The adapter contract suite with a `FakeAdapter` (T015) will cover them.
  - Copilot's declared capabilities (from the code, `read:`; nothing here is newly verified on a real session): interrupt, resume, images, models, effort, the three permission modes, `permModeSwitch: 'live'` (the broker reads the mode on every request, spec 018), usage `tokens` and `nanoAiu` (no `costUsd`), context, caps, helpers, history, MCP status and toggle. `read:` `src/adapters/copilot.ts:191-275,341-376`, `src/adapters/map.ts:59,126,168,194`.

- **2026-10-18, T011 scope: capabilities, descriptor, registry and `AdapterInfo` (issue #31; built 2026-10-18: pure types, registry and tests, no runtime wiring until T014; not checked on a real account).** After T010, `AdapterCapabilities` and `PermissionMode` exist in `src/adapters/capabilities.ts`, and `CopilotAdapter` carries `id`, `displayName` and an instance `capabilities` literal. `read:` `src/adapters/capabilities.ts`, `src/adapters/copilot.ts:63-81`. There is no descriptor, no registry and no `AdapterInfo`; `main.ts` still does `new CopilotAdapter()` itself.
  - **Boundaries.** T011 is pure types and functions plus tests. It does not touch `main.ts`, the preload, `src/shared/api.ts` or the renderer, and it adds no IPC (T014: `adapters:list`, per-agent routing, one instance per id). It does no real detection: no binary lookup, no `--version`, no spawn (T012 `detect.ts` plugs in through the injected function below). It does not touch the folder store (T013 `adapterId`/`vendorSessionId`).
  - **Plan text corrected.** `AdapterInfo` lives in a new `src/shared/adapters.ts`, not in `src/shared/api.ts` (plan "Interface changes" item 6), so the shared IPC types stay out of the files open PRs edit; T014 re-exports it from `api.ts` when it adds the IPC. `registry.ts` takes an injected detect function, not an injected exec: exec belongs to `detect.ts` (T012).
  - **FR-030** `[IMPLEMENTED]` (test: `scripts/test-copilot-model.ts`, T011 block) `src/adapters/capabilities.ts` adds `AdapterState = 'ready' | 'not-installed' | 'too-old' | 'not-signed-in' | 'unknown'` (FR-010), `DetectResult { state; version?; hint? }` (the type T012 returns), and `AdapterDescriptor { id; displayName; installHint?; capabilities; create(): AgentAdapter }`. Plain data apart from `create`; no SDK import..
  - **FR-031** `[IMPLEMENTED]` (test: `scripts/test-copilot-model.ts`, T011 block) `src/adapters/registry.ts` (pure): `createRegistry(descriptors)` rejects an empty list, duplicate ids and ids that do not match `^[a-z][a-z0-9-]{0,31}$`; it offers `list()` (registration order), `get(id)` (undefined for an unknown id, never a fallback to Copilot), `has(id)`, `defaultId` (the first entry; `copilot` in v1) and `create(id)` (calls the factory; throws on an unknown id). The registry never creates an adapter on its own: it only does so when `create` is called..
  - **FR-032** `[IMPLEMENTED]` (test: `scripts/test-copilot-model.ts`, T011 block) `detectAll(registry, detect)` with `detect: (d: AdapterDescriptor) => Promise<DetectResult>` returns one `AdapterInfo` per descriptor, in registry order. A detect call that throws or returns an unknown state gives `state: 'unknown'` for that adapter only; the others are unaffected. `hint` and `version` are plain strings capped at 200 characters; anything else is dropped. No model call, no prompt..
  - **FR-033** `[IMPLEMENTED]` (test: `scripts/test-copilot-model.ts`, T011 block) `AdapterInfo { id; displayName; state; version?; hint?; capabilities }` in `src/shared/adapters.ts` holds plain data only (no functions, no vendor types) and survives `JSON.parse(JSON.stringify(x))` unchanged, as IPC needs..
  - **FR-034** `[IMPLEMENTED]` (test: `scripts/test-copilot-model.ts`; read: `src/adapters/copilot.ts`) Copilot's descriptor is `COPILOT_DESCRIPTOR`, exported from `src/adapters/copilot.ts`. The instance's `capabilities` is the same object (one constant, not two literals), and `create()` returns a new `CopilotAdapter` whose `id` and `displayName` match the descriptor. `create()` starts no runtime (the client starts lazily, as today)..
  - **Implementation notes (T011):** a detect result with a state outside the five becomes `unknown` and its `version`/`hint` are dropped; empty strings after trimming are omitted; `has`/`get` with a non-string id simply return false/undefined; `COPILOT_CAPABILITIES` is frozen at run time only (the type stays `AdapterCapabilities`).

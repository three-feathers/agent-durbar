# Implementation Plan: Claude Code and Codex adapters

**Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md) | **Tasks**: [tasks.md](tasks.md) | **Date**: 2026-10-17 | **Kind**: forward plan (nothing built)

## Summary

Add two adapters behind the existing `AgentAdapter` interface: **Claude Code** through the Claude Agent SDK, **Codex** through `codex app-server` (JSON-RPC over stdio). First make the interface honest for more than one adapter (registry, capabilities, vendor session id, the members `main.ts` already uses), prove it with a scripted `FakeAdapter` and a contract suite, then add each vendor's pure mapper with synthetic fixtures, then the transports on fake processes. Anything that needs a real account or spends credits comes last and is marked `needs-owner-approval`.

## Technical Context

- **Language**: TypeScript, CommonJS main process (`tsconfig.json`), Node 20.19+/22.12+ (Electron 44). Both vendor SDK-ish packages are ESM-only: load with dynamic `import()`. **Unverified in a packaged asar.**
- **Dependencies**: Codex: none new (own JSON-RPC client over `child_process.spawn`). Claude: `@anthropic-ai/claude-agent-sdk`, exact version pinned (0.3.302 at the time of writing), Anthropic Commercial Terms licence (spec Q3). Tests need neither.
- **Binaries**: the user's installed `claude` and `codex`. Not bundled (about 286 MB and 430 MB unpacked per platform).
- **Testing**: `npm test` only, zero credits, no logged-in vendor. Pure mappers and mode tables, a scripted `FakeAdapter`, an adapter contract suite, and a scripted stdio fake for the Codex client.
- **Constraints**: no token handling; no shell; no vendor type in `src/shared` or the renderer; 15 agents of mixed kinds still fit the office.

## Constitution Check

| Principle | Result |
| --- | --- |
| I Spec Kit | This plan, tasks and research exist before any `src/` change. OK |
| II Adapter plug-ins | Vendor names stay in `src/adapters/`. New optional interface members are gated by `capabilities`. The renderer reads capabilities only. **Improves** the current state (Copilot-only members in `main.ts`). |
| III Safe by default, no secrets | Read-only default; mode set explicitly; layered enforcement; no token, key or `auth.json` read; no in-app login; no key entry. Folder trust before project settings run. OK, with the two policy questions Q1 and Q3 open. |
| IV No credits in tests | Phases 1 to 3 need no account. Phase 4 is separate, one tiny prompt per check, `needs-owner-approval`. OK |
| V Calm UI | Picker and capability gating only; a small agent-kind label on the desk. Needs the usual 1440x900 and 1280x800 screenshots in the UI tasks. |
| VI Parity | Paths via `path`; `.cmd` shims handled in `detect()`; Codex Windows sandbox is a `[KNOWN GAP]` until checked on Windows. |
| VII Quality gates | Each task keeps typecheck, build and tests green; mapper tests ship with the mappers. |
| VIII Honest limits | Per-adapter verified table in the README, synthetic fixtures labelled, grey-area policy stated. |

**Complexity Tracking** (new runtime dependency): `@anthropic-ai/claude-agent-sdk`. Why: it is the only supported way to get the approval callback, hooks, live mode switch and sub-agent ids from Claude Code; the alternatives (headless JSON, ACP) lose approval or identity. Cost: non-OSI licence, ESM-only, fast-moving. Time box: decided by the owner in Q3 before task T040; if refused, Claude falls back to the ACP adapter route and this plan is revised.

## Architecture

```text
Renderer (capabilities only) <-- IPC 'agent:event' -- main.ts -- AdapterRegistry -- CopilotAdapter  -- @github/copilot-sdk
                              --> IPC invoke ...    (per-agent adapter id)      |-- ClaudeAdapter   -- Claude Agent SDK -- user's `claude`
                                                                                |-- CodexAdapter    -- JSON-RPC client  -- user's `codex app-server`
                                                                                '-- FakeAdapter     -- scripted events (tests, simulator-in-main)
```

One adapter instance per id (one shared child process where the vendor allows: Codex one app-server for all threads; Claude one `query()` per session). `main.ts` routes an agent's calls to the adapter named in its folder entry.

### Files (flat, like `copilot.ts` and `map.ts` today)

| New file | What | Pure? |
| --- | --- | --- |
| `src/adapters/capabilities.ts` | `AdapterCapabilities`, `AdapterDescriptor`, `AdapterState` | yes |
| `src/adapters/registry.ts` | id → descriptor/factory, `detectAll()` | yes (injected detect function; exec is injected in `detect.ts`) |
| `src/adapters/detect.ts` | find binary (configured path, PATH, known folders), `--version`, min-version compare, Windows `.exe`/`.cmd` rules, `detectCopilot` (spec `## Changes` 2026-10-18, T012) | yes (injected env/exec; `nodeExec` is the one real wrapper) |
| `src/adapters/fake.ts` | `FakeAdapter`: plays a script of normalized events, honours the broker, for tests and `DURBAR_SIM_MAIN` | yes |
| `src/adapters/claudeModes.ts` | mode → SDK options, tool name → permission kind, Read-only hook decision | yes |
| `src/adapters/claudeMap.ts` | `SDKMessage` → `AgentEvent` (stateful mapper like `EventMapper`) | yes |
| `src/adapters/claude.ts` | `ClaudeAdapter`: `query()` lifecycle, input queue, `canUseTool`, hooks, resume | no (SDK) |
| `src/adapters/claudeHistory.ts` | `listSessions`/`getSessionMessages` → `PreviousSession`/history | thin |
| `src/adapters/codexRpc.ts` | line-delimited JSON-RPC client: spawn, id table, notifications, server requests, close | no (child process) but tested with a scripted fake stream |
| `src/adapters/codexModes.ts` | mode → `approvalPolicy` + `sandbox`, approval kind → permission kind | yes |
| `src/adapters/codexMap.ts` | notifications and items → `AgentEvent` | yes |
| `src/adapters/codex.ts` | `CodexAdapter`: thread and turn lifecycle, approvals, resume | no |
| `src/adapters/codexHistory.ts` | `thread/list`/`thread/turns/list` → history | thin |
| `scripts/test-adapter-contract.ts`, `test-claude-map.ts`, `test-codex-map.ts`, `test-modes.ts`, `test-detect.ts` | tests | |
| `scripts/fixtures/claude/*.json`, `scripts/fixtures/codex/*.json` | **synthetic** until recorded; each file has `"provenance": "synthetic" | "recorded"` | |

## Interface changes (spec deltas to 002, made in Phase 1, Copilot behaviour unchanged)

> **Note 2026-10-18 (T010, issue #30):** items 1 and 2 below are restated against today's code in [spec.md `## Changes` 2026-10-18](spec.md#changes) (FR-026 to FR-029): `listModelOptions?()` instead of `listModels?()`, `isLive` and `dispose` required, `displayName` + `capabilities` on the instance (the full descriptor is T011), `ModelOption` in `src/shared/modelswitch.ts`, `debug?` added, and the mode-switch capability named `permModeSwitch: 'live' | 'next-message' | 'none'` to match spec 030's `ModelControl`. Item 4 (persisted `adapterId`) stays T013 and item 6 (`AdapterInfo`) stays T011.

1. `AgentAdapter.descriptor` / `capabilities` (readonly).
2. Optional members promoted from `CopilotAdapter`: `isLive(id)`, `dispose()`, `listModels?()` (returns the existing `ModelOption` shape, moved to `src/shared`), `listPreviousSessions?()`, `history?()`, `setPermMode?()`. UI uses them only when `capabilities` says so.
3. `StartOptions`: `resumeSessionId` stays the **vendor** id; add `permissionMode: 'read-only' | 'ask' | 'allow'` as the one source of truth (`allow`/`ask` booleans stay for Copilot until migrated). `maxAiCredits` and `autoTier` are ignored by adapters whose `caps` is false.
4. Persisted folder entry: `adapterId` (default `copilot`) (never written for Copilot). `vendorSessionId` is deferred (spec `## Changes` 2026-10-18 T013, FR-045): the store saves no session id today, so there is nothing to migrate.
5. `UsageEvent`: add optional `costUsd?: number` and `costBasis?: 'estimate'`; `creditsStatus: 'unavailable'` where the runtime gives no money. No existing field changes.
6. `AdapterInfo` (in `src/shared/adapters.ts`, re-exported from `src/shared/api.ts` by T014; see spec `## Changes` 2026-10-18, T011): id, displayName, state, version, hint, capabilities (plain data, no vendor types).

## Capabilities

```ts
interface AdapterCapabilities {
  interrupt: boolean; resume: boolean; images: boolean;
  models: boolean; effort: boolean;
  permissionModes: Array<'read-only' | 'ask' | 'allow'>;
  liveModeSwitch: 'immediate' | 'next-message' | 'none';
  usage: { tokens: boolean; costUsd: boolean; nanoAiu: boolean };
  context: boolean; caps: boolean; helpers: boolean; history: boolean;
  mcpStatus: boolean; mcpToggle: boolean;
}
```

Planned values (all unverified until Phase 4): Claude: everything true except `nanoAiu`, `caps`; `liveModeSwitch: 'immediate'`. Codex: `costUsd: false`, `caps: false`, `helpers: false` until child-thread routing is recorded, `mcpToggle: false` (FR-024), `liveModeSwitch: 'next-message'`, `images: true` (`localImage`), `permissionModes` all three on Linux and macOS, **Windows Read-only/Ask declared as gap until checked**.

## Permission mode mapping

Durbar's promise (constitution III): **Read-only** approves reads and denies everything that can change state; **Ask first** leaves each such request pending for the user; **Allow all** approves everything and is an explicit per-agent opt-in. The adapter sets the vendor mode on every start and resume.

### Claude Code

| Durbar mode | SDK options | Enforcement layers |
| --- | --- | --- |
| Read-only | `permissionMode: 'dontAsk'`, `allowedTools: ['Read','Glob','Grep']`, `disallowedTools` for shell/write/web tools as a backstop | (1) mode; (2) programmatic `PreToolUse` hook that returns `deny` for every tool not in the read set, whatever the user's settings say (hooks run first and can deny even in bypass); (3) `canUseTool` denies anything that still reaches it. Sub-agents inherit `dontAsk`; the hook also fires inside them (`agent_id`). |
| Ask first | `permissionMode: 'default'`, `allowedTools: ['Read','Glob','Grep']`, `canUseTool` set | `canUseTool` creates a pending request (status `needs-permission`) and resolves the promise when the user answers. Reads inside the folder never prompt (spec 003). |
| Allow all | `permissionMode: 'bypassPermissions'`, `allowDangerouslySkipPermissions: true` | Mode. `canUseTool` still approves what the vendor insists on asking (`AskUserQuestion` is answered by the user, see "needs the user" below). |
| (never) | `auto`, `acceptEdits`, `plan` | Not offered in v1. `auto` is what a session picks when no mode is set, so omission is a bug. |

Tool name → `PermissionInfo.kind` (`claudeModes.ts`): `Read, Glob, Grep, NotebookRead, LS` → `read`; `Write, Edit, MultiEdit, NotebookEdit` → `write`; `Bash, BashOutput, KillBash` → `shell` (`fullCommandText` = `input.command`); `WebFetch, WebSearch` → `url`; `mcp__<server>__<tool>` → `mcp` (`serverName` from `options.mcpServer.name` when present, else parsed against the init server list); `Agent`/`Task` → `custom-tool`; everything else → `custom-tool`. **Names are from docs; the list is incomplete and must be checked on a real run.** An unknown tool name is treated as non-read.

Needs the user: `AskUserQuestion` and MCP tools that require interaction always reach `canUseTool`, even in `bypassPermissions`. Plan: show them as a normal pending request in v1 with the question text as `summary`, answer by deny until a question UI exists (`[KNOWN GAP]`, task T052).

Session grants: `canUseTool` result `allow` + Durbar's own grant (spec 003 broker, same `scopeKey` rules). `updatedPermissions` from the vendor's `suggestions` are **not** passed back (they can write rules to the user's `.claude/settings.local.json`).

### Codex

| Durbar mode | `thread/start` and `turn/start` | Notes |
| --- | --- | --- |
| Read-only | `sandbox: 'read-only'`, `approvalPolicy: 'never'` | OS-enforced. Writes and escalations fail without asking. **Shell commands that only read run** (inside the sandbox). Difference from Claude and Copilot, stated in UI and README (Q6). Any approval request that still arrives is answered `decline`. |
| Ask first | `sandbox: 'read-only'`, `approvalPolicy: 'on-request'` | Every write and escalation reaches us as an approval request (**unverified** that file edits do so in a read-only sandbox; the retired `untrusted` policy is not available). Pending until the user answers. |
| Allow all | `sandbox: 'danger-full-access'`, `approvalPolicy: 'never'` | No sandbox, no prompts. Named honestly. A lesser `workspace-write` + `never` is not offered (Q6). |

Approval request → kind: `item/commandExecution/requestApproval` → `shell` (`fullCommandText` = `command`; with `networkApprovalContext` → `url`, host); `item/fileChange/requestApproval` → `write` (`fileName` = first changed path, summary lists the count); `item/permissions/requestApproval` → `custom-tool` (`request_permissions`) with the requested subset in the summary; `mcpServer/elicitation/request` and `tool/requestUserInput` for MCP tool side effects → `mcp` (`serverName`, `toolName`). Answers: approve → `accept`; approve + remember → `accept` plus **Durbar's own grant** (not `acceptForSession`); deny → `decline`; stop → `cancel`.

Live switch: the chosen policy is sent with the next `turn/start`; a turn already running keeps the old one (`next-message`). The toast says so.

Windows: sandbox needs a setup step (`windowsSandbox/setupStart`); until checked on a Windows machine, Codex `read-only` and Ask first are declared as `[KNOWN GAP]` there and the adapter refuses to start in them when the vendor reports the sandbox is not set up (refuse, never weaken).

## Event mapping

### Claude (`claudeMap.ts`; needs `includePartialMessages: true`, `forwardSubagentText: true`)

| SDK message | Normalized | Notes |
| --- | --- | --- |
| `system/init` | `status idle "Ready in <cwd>"`, `mcp` (servers), remember `model`, CLI version, `apiKeySource` | `quiet` start skips the status |
| (adapter) user message pushed | `status working "Thinking"` | like Copilot's adapter |
| `stream_event` `text_delta` | `output` delta | |
| `stream_event` `thinking_delta` | `thinking` delta, `reasoningId` = message id + block index | complete `thinking` block only if no delta was seen |
| `assistant` text block (complete) | `output final:true` with `text` | skip empty |
| `assistant` `tool_use` | `toolCall start` (`callId` = tool_use id, `tool` = name, `args` = input; `mcpServer`/`mcpTool` parsed from `mcp__s__t`) | remembers name by id |
| `user` `tool_result` | `toolCall complete` or `failed` (`is_error`), `output` = text, capped | |
| tool_use named `Agent`/`Task` | `subagent started` (`subagentId` = tool_use id, `task` = prompt/description, `agentName` = `subagent_type`) | |
| messages with `parent_tool_use_id` / `agent_id` | same mapping with `agentId` = the spawning tool_use id | `task_id` ↔ tool_use id table from `task_started` |
| `system/task_progress` | `subagent` update fields (`totalTokens`, `totalToolCalls`, `durationMs`) | needs a spec delta if no `update` phase exists: emit nothing in v1 |
| `system/task_notification` | `subagent completed | failed` (`stopped` → `failed` with `error: 'stopped'`) | |
| `assistant.message.usage` (once per `message.id`) | `usage` (tokens, `model`, `cacheReadTokens`) | no `nanoAiu` |
| `result` | `usage.costUsd` delta from `total_cost_usd`, `costBasis:'estimate'`; then `status idle` (success) or `status error "<subtype>"`; `context` from `getContextUsage({detail:'summary'})` | streaming mode: totals are running; compute the delta. `permission_denials` shown in the error text only |
| `canUseTool` | `status needs-permission` + `PermissionInfo` (broker) | answered with allow/deny |
| `rate_limit_event` (`credits_required`) | `status error "Claude usage limit reached"` | other values ignored in v1 |
| `aborted: true` assistant, interrupt | `status idle "Aborted"` | |
| anything else | ignored | FR-020 |

### Codex (`codexMap.ts`)

| Codex message | Normalized | Notes |
| --- | --- | --- |
| `thread/started` | `status idle "Ready in <cwd>"`, store vendor session id | |
| `turn/started` | `status working "Thinking"` | |
| `turn/plan/updated` | `status working` with `intent` = the in-progress step | |
| `item/agentMessage/delta`, `item/completed` agentMessage | `output` delta; `final:true` with `text` | `phase` `commentary` may be shown as thinking later (unverified) |
| `item/reasoning/summaryTextDelta` (`textDelta` if present) | `thinking` delta, `reasoningId` = item id + `summaryIndex` | |
| `item/started` commandExecution | `toolCall start`, `tool: 'shell'`, `args: {command, cwd}` | |
| `item/commandExecution/outputDelta` | `toolCall update` | capped |
| `item/completed` commandExecution | `complete`/`failed` (`exitCode`, `status declined` → failed with "declined") | `output` = `aggregatedOutput`, capped |
| `fileChange` item | `toolCall`, `tool: 'apply_patch'`, `args: {files: [...paths]}`, `output` = diff summary | diffs are not sent whole |
| `mcpToolCall` item | `toolCall` with **`mcpServer` = `server`, `mcpTool` = `tool`**, `tool` = `<server>.<tool>` | direct, no parsing |
| `dynamicToolCall`, `webSearch`, `imageView` | `toolCall` with the item type as `tool` | |
| `collabAgentToolCall` (spawn), `subAgentActivity` | `subagent started/completed` (`subagentId` = item id, `model`, `task` = prompt) | child-thread event routing unverified: **no helper tiles until recorded** (`helpers: false`) |
| `thread/tokenUsage/updated` | `usage` from `last` (tokens, cached) and `context` {`tokens` = `last.inputTokens`, `limit` = `modelContextWindow ?? 0`} | meaning of `last.inputTokens` unverified |
| `turn/completed` completed | `status idle` | |
| `turn/completed` interrupted | `status idle "Aborted"` | |
| `turn/completed` failed | `status error "<codexErrorInfo>: <message>"` | `UsageLimitExceeded` gets its own wording |
| approval server requests | `status needs-permission` + `PermissionInfo` | see above |
| `mcpServer/startupStatus/updated`, `mcpServerStatus/list` | `mcp` | read-only |
| `warning`, `configWarning`, `model/rerouted`, unknown | ignored (debug log with `DURBAR_LOG`) | |

## Lifecycle

- **detect** (no model call): locate binary → `--version` → compare minimum → Claude: nothing more (sign-in is learned at first start from `accountInfo()`/init, unverified); Codex: spawn `app-server`, `initialize`, `account/read` (needs no model call) → `ready | not-signed-in`. Cached for the app run, re-run on demand.
- **start**: Claude: build options (`cwd`, explicit mode, `sessionId` = agent id as UUID when creating, or `resume`; `settingSources: ['user']` unless the folder is trusted; `mcpServers` from Durbar's store; `env` = process env, never logged; `includePartialMessages`, `forwardSubagentText`), open the input queue, start `query()`, read until `init`. Codex: ensure the shared app-server is up, `thread/start` or `thread/resume` with mode, `cwd`, model; store the returned thread id as the vendor session id.
- **send**: Claude: push `SDKUserMessage` (images as content blocks); Codex: `turn/start` with text and `localImage` items and the current mode policy.
- **interrupt**: Claude `query.interrupt()`; Codex `turn/interrupt`. Pending permissions answered deny/cancel first.
- **stop**: Claude `query.close()`; Codex `thread/unsubscribe` and, when no thread is left, end the child. Status `stopped`.
- **resume**: by vendor session id; the folder must match (spec 003 rule "resumed sessions must belong to the agent's folder"); history through the vendor API.
- **crash**: child exit or stream error → `status error` for the sessions on it; others untouched; restart on the next send.
- **environment**: spawn with argv array, absolute path from `detect()`, no shell; never print env values or tokens; vendor stderr goes to `DURBAR_LOG` only after a redaction pass.

## Folder trust

Project-level vendor settings can run code (Claude runs project hooks and `.mcp.json` servers in headless mode with no prompt). Durbar loads `settingSources: ['user']` for Claude until the folder is trusted in Durbar (reusing the spec 020 trust dialog and storage), and relies on Codex's own project trust (it keeps project config off for an untrusted project). Cost: a repo's own agents and hooks do not run before trust. Owner confirms in Q8.

## Phased approach

| Phase | Needs | Content | Credits / accounts |
| --- | --- | --- | --- |
| **1 Simulator-only foundation** | nothing | Interface deltas, registry, capabilities, `detect()` skeleton with injected exec, persisted `adapterId`/`vendorSessionId` migration, `FakeAdapter`, contract suite (run on `FakeAdapter` and the Copilot fake), picker UI with unavailable state, capability gating, README table, screenshots on the simulator | none |
| **2 Pure vendor logic** | Phase 1 | `claudeModes`, `codexModes`, `claudeMap`, `codexMap`, kind mapping, detect parsers, with **synthetic** fixtures from vendor docs/types and tests; SC-004 on fakes | none |
| **3 Transports on fake processes** | Phase 2, Q3/Q4 for Claude | `codexRpc` against a scripted stdio fake; `CodexAdapter`; `ClaudeAdapter` against a fake `query()` object; history readers on fixtures; packaging notes (asar, ESM import) tested by a build check that does not run a vendor | none (a free `--version` probe on a developer's own machine is allowed; no prompt) |
| **4 Real-account verification** | owner approval (Q1, Q2) | one tiny Read-only prompt per check per vendor: start, one turn, interrupt, stop, resume, permission denied in Read-only, permission asked in Ask first, MCP tool event, sub-agent event, context and usage numbers, sign-in state calls; record redacted fixtures (`recorded`), update spec evidence tags and the README table | **spends the owner's credits** |
| **5 Rollout** | Phase 4 | Previous sessions UI for both, model/effort lists, README "verified" wording, changelog | none beyond Phase 4 |

Phases 1 to 3 can be reviewed and merged with no vendor installed. Nothing in Phase 4 runs in CI or by default.

## Risks

| Risk | Likelihood | Effect | Mitigation |
| --- | --- | --- | --- |
| Anthropic's rules on third-party apps and subscription login are read the wrong way | medium | account or policy trouble for users | Q1 before any Claude real run; API-key/cloud users only as the safe default; no login UI; no token access; say it in README |
| Vendor protocols change (SDK versions weekly, Codex weekly) | high | mapper breaks | pin SDK, min CLI version, tolerant readers, fixtures per version, converge task after each bump |
| Read-only is weaker than promised (user allow rules, Codex shell-in-sandbox) | medium | constitution III | layered enforcement, tests on fakes, Codex wording, real check in Phase 4, refuse to start when unsure |
| Codex Ask first does not ask for edits in a read-only sandbox | medium | Ask first is silent or blocks | verify in Phase 4; fall back to `workspace-write` + `on-request` is **not** acceptable (edits would run unasked): refuse Ask first for Codex until verified |
| Child-thread / sub-agent events cannot be attributed | medium | helper tiles wrong | `helpers: false` until recorded |
| ESM-only packages and asar break at runtime | medium | adapter fails in release builds | dynamic import test in a packaged-build check (T044) |
| Installer size if someone bundles the binaries | low | 700 MB more per platform | C4: not bundled; a test asserts `asarUnpack` does not list them |
| API keys invisible to a GUI app | high | "not signed in" confusion | detect message and README; no key entry (constitution III) |
| Hooks/MCP in the user's repo run on open | medium | code execution | folder trust (FR-025) |
| No real fixtures for months | high | mappers drift from reality | label synthetic, keep them minimal, Phase 4 replaces them |
| Cost shown as USD is mistaken for a bill | medium | trust | "estimate" label, vendor's own warning quoted, never summed |

## Open items that need the owner before a task can start

Q1 (Claude real run, subscription use), Q2 (any real run), Q3 (Claude SDK dependency, T040), Q4 (binary source, T041). Phases 1 and 2 are not blocked.

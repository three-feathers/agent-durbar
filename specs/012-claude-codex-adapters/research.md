# Research: 012 Claude Code and Codex adapters

Written 2026-10-17 from vendor documentation, vendor type definitions and this repository's code. **No Claude Code or Codex session was started, no account was signed in, no credit was spent.** Neither CLI is installed on the machine where this was written. Every row below is therefore `docs:` (read in vendor docs or types) or `read:` (read in this repo). Nothing is `real:`. Where a doc was unclear it says so.

Versions looked at: `@anthropic-ai/claude-agent-sdk` 0.3.302 (the SDK version tracks the bundled Claude Code version), Codex CLI `rust-v0.163.0` (released 2026-10-15), `@openai/codex-sdk` (wraps the CLI), ACP adapters `@agentclientprotocol/claude-agent-acp` 0.93.0 and `@agentclientprotocol/codex-acp` 2.2.2. These change weekly. Re-check before building.

Legend: **docs** = stated in vendor docs or types, not exercised. **unclear** = the docs do not settle it. **gap** = a limit that affects Durbar.

Sources (all read 2026-10-17):
- Claude: `code.claude.com/docs/en/agent-sdk/` (typescript, permissions, user-input, hooks, subagents, cost-tracking, sessions, streaming-output), `.../en/headless`, `.../en/legal-and-compliance`.
- Codex: `developers.openai.com/codex/` (sdk, noninteractive, app-server, agent-approvals-security), `github.com/openai/codex` (`sdk/typescript`, `codex-rs/app-server-protocol/schema/typescript/v2`).
- ACP: `agentclientprotocol.com/protocol/` (prompt-turn, tool-calls), the two adapter repositories.
- Repo: `src/adapters/types.ts`, `copilot.ts`, `map.ts`, `permissions.ts`, `src/main/main.ts`, `src/renderer/sim.ts`, specs 002, 003, 010, 011, 018, 019, 020.

## 1. What the current interface really assumes

| Finding | Evidence | Consequence |
| --- | --- | --- |
| `main.ts` builds one `CopilotAdapter` and calls members that are **not** in `AgentAdapter`: `isLive`, `dispose`, `listModelOptions`, `listPreviousSessions`, `history`, `setPermMode`, `debug`. | `src/main/main.ts` (grep `adapter.`), `src/main/mcpipc.ts` | The interface is leakier than spec 012 said. Phase 1 must promote these to optional members or capabilities before a second adapter can exist. |
| The simulator is **renderer-side** (`src/renderer/sim.ts`, an in-memory `DurbarApi` bridge). It is not an `AgentAdapter` and the main process never sees it. | `sim.ts`, `main.ts` (`DURBAR_SIM` only sets a query string) | "Wrap the simulator as an adapter" is not free. A main-side scripted adapter (`FakeAdapter`) is a new, small piece. |
| `ensureLive` starts a session with `sessionId: a.id`: Durbar's agent id is the session id. Copilot lets us choose the id. | `main.ts` line ~150, `StartOptions.sessionId` | Codex assigns its own thread id. The persisted folder entry needs a vendor session id next to the agent id. Claude accepts a UUID `sessionId`. |
| `UsageEvent` has `nanoAiu` and `costMultiplier` (Copilot units). Usage totals (spec 011) add AIU only. | `types.ts`, spec 011 FR-018 | Neither vendor reports AIU. Tokens fit. Money does not fit without a new optional field and a rule that units are never added together. |
| Permission kinds are strings `write | shell | read | url | mcp | custom-tool` and the broker needs `fileName`, `fullCommandText`, `url`, `serverName`, `toolName`. | `permissions.ts` | Both vendors can fill these. Mapping is table work, not new design. |
| Tests feed recorded Copilot events to a pure mapper (`map.ts`), no SDK import. | `scripts/test-events.ts`, `scripts/fixtures/events/` | Same pattern works for both vendors, with **synthetic** fixtures until a recording is approved. |

## 2. Claude Code

### 2.1 Ways to drive it

| Option | What it gives | What it lacks | Verdict |
| --- | --- | --- | --- |
| **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`): `query()` returns an async generator of `SDKMessage` and a `Query` object. It spawns a Claude Code process (bundled binary, or `pathToClaudeCodeExecutable`). | Streaming input (multi-turn), partial messages, `canUseTool` callback, programmatic hooks, `interrupt()`, `setPermissionMode()`, `setModel()`, `mcpServerStatus()`, `toggleMcpServer()`, `getContextUsage()`, `accountInfo()`, `resume`, `sessionId`, `forkSession`, session list/read helpers, sub-agent ids on messages and hooks. | Pinned to a fast-moving CLI version (many options say "requires Claude Code v2.1.xxx"). ESM-only package. See 2.7 for licence and size. | **Chosen transport.** docs |
| Headless CLI: `claude -p --output-format stream-json --verbose --include-partial-messages` | Same message stream, no extra dependency. | One shot per process; no `canUseTool`; Ask-first would need `--permission-prompt-tool` through an MCP tool we would have to host. | Rejected for the adapter. Useful as a fallback probe. docs |
| ACP adapter `@agentclientprotocol/claude-agent-acp` (wraps the same SDK) | One protocol for several agents. Permissions, terminals, MCP, nested sub-agent transcripts listed in its README. | ACP v1 tool calls carry `kind`, title, `rawInput`: no field for the MCP server name (we would parse the title). Sub-agent sessions are still an RFD in ACP. Cost/context arrive in `usage_update`. Extra process and a version matrix (SDK, adapter, ACP). | Fallback if the SDK path proves too heavy. Not verified. docs |

### 2.2 Observing a session (events)

`query()` yields `SDKMessage`. The ones Durbar needs:

| Message | Fields we use | Notes |
| --- | --- | --- |
| `system` `subtype:"init"` | `session_id`, `cwd`, `model`, `permissionMode`, `tools`, `mcp_servers[{name,status,source}]`, `apiKeySource`, `claude_code_version`, `capabilities` | One per session start. Gives the MCP server list and the CLI version. docs |
| `stream_event` (only with `includePartialMessages: true`) | raw API stream events: `content_block_delta` with `text_delta`, `thinking_delta`, `input_json_delta` | Needed for live typing and live reasoning. docs |
| `assistant` | `message.content[]` blocks: `text`, `thinking`, `tool_use{id,name,input}`; `message.usage`; `message.id`; `parent_tool_use_id`; `agent_id` (v0.3.292+); `aborted` | Several messages can share one `message.id` (count usage once per id). docs |
| `user` | `tool_result` blocks (`tool_use_id`, `is_error`, content); `tool_use_result` structured output; `agent_id` | Tool end. docs |
| `system` `task_started` / `task_progress` / `task_notification` | `task_id`, `tool_use_id`, `task_type` (`local_agent` = sub-agent), `parent_task_id`, `usage{total_tokens,tool_uses,duration_ms}`, `status` | Sub-agent lifecycle and cost. `summary` only with `agentProgressSummaries`. docs |
| `result` | `subtype` (`success`, `error_max_turns`, `error_during_execution`, `error_max_budget_usd`, ...), `is_error`, `total_cost_usd`, `usage`, `modelUsage{model: {inputTokens, outputTokens, cacheReadInputTokens, costUSD, contextWindow}}`, `permission_denials`, `terminal_reason` | End of turn. In streaming-input mode `total_cost_usd` and `modelUsage` are running totals for the call, `usage` is per turn and excludes sub-agents. docs |
| `rate_limit_event` | `status`, `resetsAt`, `utilization`, `errorCode:"credits_required"` | Only for claude.ai subscription sessions. Durbar has no event for it today. docs |
| `system` `status`, `compact_boundary`, `api_retry`, `session_state_changed`, hook events | | Optional. Ignore unknown types. docs |

Hooks (`options.hooks`, programmatic callbacks in our process): `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStart`, `SubagentStop`, `PermissionRequest`, `PermissionDenied`, `Notification`, `Stop`, `SessionStart/End`, `PreCompact` and more. Hook input carries `agent_id` and `agent_type`, so hooks fire inside sub-agents too. A `PreToolUse` hook runs **before** the permission flow and can return `deny` even in `bypassPermissions`. docs

### 2.3 Controlling a session

| Need | How | Notes |
| --- | --- | --- |
| Start / resume | `query({prompt, options:{cwd, sessionId?, resume?}})`. `resume: id` continues; `forkSession` branches; `persistSession:false` disables transcripts. | Streaming input mode (`prompt` as an async iterable, `streamInput`) is needed for multi-turn, `interrupt()`, `setPermissionMode()`, `setModel()`. docs |
| Send a message | push a `SDKUserMessage` into the input iterable. Images go in `message.content`. `priority: 'now' | 'next' | 'later'` while a turn runs. | docs |
| Stop the turn | `query.interrupt()` (streaming mode only). Newer CLIs return a receipt of queued messages. | Keeps the session. docs |
| End the session | `query.close()` terminates the process. | docs |
| Permission prompts | `canUseTool(toolName, input, {signal, suggestions, blockedPath, mcpServer?, toolUseID, agentID?, requestId})` returns `{behavior:'allow', updatedInput?, updatedPermissions?}` or `{behavior:'deny', message, interrupt?}`. Called only when the flow reaches a prompt. A pending request does **not** time out. `mcpServer{name,source}` needs SDK 0.3.274+. | `reinitialize()` re-delivers pending requests after a transport gap. docs |
| Modes | `PermissionMode`: `default`, `acceptEdits`, `bypassPermissions` (needs `allowDangerouslySkipPermissions: true`), `plan`, `dontAsk` (deny anything not pre-approved, never prompt), `auto` (model classifier). **If omitted, a session can start in `auto`.** Change live with `setPermissionMode()`. | We must always set the mode explicitly. docs |
| Rules | `allowedTools`, `disallowedTools` (a scoped rule such as `Bash(rm *)` denies in every mode), settings-file rules. Settings `allow` rules still apply in `dontAsk`. | A user's own allow rules could widen Read-only. See 2.5. docs |
| MCP | `mcpServers` option (stdio, sse, http, in-process `sdk`); `strictMcpConfig` ignores `.mcp.json`, user settings, plugins and claude.ai connectors; `mcpServerStatus()`, `toggleMcpServer(name, enabled)`, `setMcpServers()`, `reconnectMcpServer()`. | Status values and `source` are reported. docs |
| Sub-agents | Built in tool named `"Agent"` (older CLIs and the init tool list say `"Task"`; match both). Programmatic `agents` option. `forwardSubagentText: true` is needed to see a foreground sub-agent's text and thinking. | Messages carry `parent_tool_use_id` (the spawning tool call) and, from 0.3.292, `agent_id` (= `task_id`). docs |
| Models and effort | `supportedModels()`, `model`, `effort: low|medium|high|xhigh|max`, `setModel()`, `applyFlagSettings({effortLevel})`. | docs |
| Context window | `getContextUsage({detail:'summary'})` returns `totalTokens`, `maxTokens`, `percentage`, per category; `'summary'` uses local estimates and sends no token-count request, `'full'` (default) does. Also `modelUsage[model].contextWindow` on every result. | A real per-turn number needs a call after each result. docs |
| Settings sources | `settingSources: ['user','project','local']` by default (like the CLI). `[]` loads none. | **A headless session runs the project's hooks and connects its `.mcp.json` servers without any trust prompt.** See 2.5. docs |

### 2.4 Cost, credits, context

- `result.total_cost_usd` and `modelUsage[].costUSD` are **client-side estimates in US dollars**, from a price table bundled in the CLI. The docs say plainly not to use them for billing or financial decisions. docs
- With a claude.ai subscription there is no per-call money at all; the signal is `rate_limit_event.utilization`. docs
- `maxBudgetUsd` stops a query when the estimate reaches a value; it can overshoot. It is USD, so it is not the AIU cap of spec 011. docs
- Per-call tokens: `assistant.message.usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`). docs
- Context window size: `modelUsage[].contextWindow` and `getContextUsage().maxTokens`. Current use: `getContextUsage().totalTokens`. docs
- **gap**: nothing here is in AIU. Durbar's office total is AIU only (spec 011). Claude shows tokens, and a labelled dollar estimate at most.

### 2.5 Authentication and the rules around it (important)

- Claude Code signs in with OAuth (claude.ai plans) or an API key / Bedrock / Vertex / Foundry. Credentials live in the user's Claude config (`~/.claude`, OS keychain). Durbar must never read them (constitution III). The SDK does not load `.env` files. docs
- The SDK docs state: *"Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods."* The legal page says developers must not route requests through Free/Pro/Max credentials on behalf of their users, nor collect or store claude.ai credentials, but also that this does not prevent an end user from signing in to **the unmodified Claude Code binary** with their own subscription. docs
- **What this means for Durbar (our reading, not legal advice):** an app built on the Agent SDK that runs on a user's own `claude` login is in a grey zone that the docs do not clearly allow. The safe lines are: never show a claude.ai login button, never read or store a token, never bundle our own credentials, run the user's own unmodified binary where possible, and let an API-key / cloud-provider user work normally. **The owner has to decide how far to go** (open question Q1).
- **gap**: a GUI app launched from Finder or the Start menu does not see variables exported in a shell profile, so `ANTHROPIC_API_KEY` set there is invisible to it. Durbar will not store a key (constitution III). Options: launch from a terminal, `apiKeyHelper` in the user's own Claude settings, a cloud provider, or the user's own CLI login. This is a real usability limit to document.
- Sign-in state without a model call: `accountInfo()` and the init message's `apiKeySource` (`ANTHROPIC_API_KEY`, `apiKeyHelper`, `/login managed key`, ...). unclear whether `accountInfo()` needs a model call: it comes from the initialize handshake, which the docs describe separately from prompts. Treat as unverified.

### 2.6 Sessions and history

- Transcripts: `~/.claude/projects/<cwd with every non-alphanumeric char replaced by "-">/<session-id>.jsonl`; `CLAUDE_CONFIG_DIR` moves the root; names over 200 characters are truncated with a hash. The line format is **not documented** as a contract. docs
- Supported read path: SDK helpers `listSessions({dir, limit})` (id, summary, lastModified, cwd, gitBranch, firstPrompt), `getSessionInfo`, `getSessionMessages(id, {dir, limit, offset})` (user/assistant messages with `parent_tool_use_id`, `parent_agent_id`), `renameSession`, `tagSession`, `forkSession`. They are in the SDK root entry. docs
- `cleanupPeriodDays` in the user's settings deletes old transcripts; history can be gone. docs
- Decision follows: read history **through those helpers**, not by parsing the files ourselves.

### 2.7 Packaging, licence, size

- The SDK is ESM-only (`"type":"module"`); Durbar's main process is CommonJS, so it loads with dynamic `import()`. **unverified** inside a packaged asar.
- The SDK ships the CLI as a per-platform optional dependency. npm reports about **286 MB** unpacked for `@anthropic-ai/claude-agent-sdk-linux-x64` (the Copilot runtime is about 160 MB). Bundling it would add a lot to every installer. `pathToClaudeCodeExecutable` lets us use the user's own installed `claude` instead (then the SDK and the CLI must be compatible: many options name a minimum CLI version).
- Licence on npm is "SEE LICENSE IN README.md" and use is governed by Anthropic's Commercial Terms: **not an OSI licence**, unlike the MIT project and unlike the Apache-2.0 Codex pieces. Constitution: a new runtime dependency needs a line in the plan; this one also needs the owner's yes (open question Q3).

## 3. Codex

### 3.1 Ways to drive it

| Option | What it gives | What it lacks | Verdict |
| --- | --- | --- | --- |
| **`codex app-server`** (JSON-RPC 2.0 over stdio, one JSON object per line; the interface the VS Code extension uses) | Threads, turns, items, streamed deltas, **server-initiated approval requests**, `turn/interrupt`, `turn/steer`, `thread/resume`, `thread/list` with `cwd` filter, `model/list`, `account/read`, rate limits, `mcpServerStatus/list`, token usage notification with `modelContextWindow`. Schema generated per version: `codex app-server generate-ts` / `generate-json-schema`. | The docs call the `app-server` command and its WebSocket transport experimental; stdio is the default. Protocol changes per release; some methods need `capabilities.experimentalApi`. | **Chosen transport.** docs |
| `codex exec --json` and the TypeScript SDK `@openai/codex-sdk` (it spawns the CLI and exchanges JSONL) | Simple. Events: `thread.started`, `turn.started`, `turn.completed{usage}`, `turn.failed`, `item.started/updated/completed`, `error`. Items: agent message, reasoning, command execution, file change, MCP tool call, web search, plan update. `resume`, `--output-schema`, images. | Non-interactive: runs with a fixed sandbox and approval policy, **no approval callback**, so no "Ask first". No text deltas (whole items). | Rejected for the adapter; fine as a probe. docs |
| `codex mcp-server` | | The docs say the `codex mcp-server` command and standalone `codex-mcp-server` binary **have been removed**; use app-server. | Not an option. docs |
| ACP adapter `@agentclientprotocol/codex-acp` | Starts the app-server itself and maps to ACP. `INITIAL_AGENT_MODE`: `read-only`, `workspace-write`, `agent`, `agent-full-access`. | Same ACP limits as above (no MCP server field on tool calls, sub-agents not stable). | Fallback. Not verified. docs |

### 3.2 Observing a session

Notifications (JSON-RPC, no id) after `thread/start` or `thread/resume`:

| Notification / item | Fields we use |
| --- | --- |
| `thread/started`, `thread/status/changed` (`active` with `activeFlags` such as `waitingOnApproval`) | thread id, runtime status |
| `turn/started`, `turn/completed` (`status: completed | interrupted | failed`, `error{message, codexErrorInfo}`) | turn id, outcome. `codexErrorInfo` includes `UsageLimitExceeded`, `ContextWindowExceeded`, `Unauthorized`, `SandboxError`. |
| `turn/plan/updated` (`plan[{step,status}]`), `turn/diff/updated` | plan step in progress can be the card's intent |
| `item/started`, `item/completed` | `ThreadItem` union (below) |
| `item/agentMessage/delta` | text delta |
| `item/reasoning/summaryTextDelta` (and raw `item/reasoning/textDelta` when the model supports it) | reasoning delta, `summaryIndex` |
| `item/commandExecution/outputDelta` | stdout/stderr chunks |
| `thread/tokenUsage/updated` | `tokenUsage{total, last: {totalTokens, inputTokens, cachedInputTokens, cacheWriteInputTokens, outputTokens, reasoningOutputTokens}, modelContextWindow: number | null}` |
| `account/rateLimits/updated` | `usedPercent`, `windowDurationMins`, `resetsAt` per bucket (ChatGPT plans) |
| `mcpServer/startupStatus/updated` | name, status, error |
| `warning`, `configWarning`, `model/rerouted`, `hook/*` | optional |

`ThreadItem` (from the generated TypeScript types): `userMessage`, `agentMessage` (with `phase`), `reasoning{summary, content}`, `plan`, `commandExecution{command, cwd, status, commandActions, aggregatedOutput, exitCode, durationMs}`, `fileChange{changes[{path, kind, diff}], status}`, **`mcpToolCall{server, tool, status, arguments, readOnlyHint, result, error, durationMs}`**, `dynamicToolCall{namespace, tool, ...}`, `collabAgentToolCall{tool, senderThreadId, receiverThreadIds, prompt, model, reasoningEffort, agentsStates}`, `subAgentActivity{agentThreadId, agentPath, model, kind}`, `webSearch`, `imageView`, `contextCompaction`, review items. So an MCP tool call names its **server and tool as separate fields**, which is the best fit for `ToolCallEvent.mcpServer/mcpTool` of all three agents. docs

Sub-agents: `thread/list` has a `subAgent*` source kinds and experimental `parentThreadId` / `ancestorThreadId` filters; `collabAgentToolCall` and `subAgentActivity` items link a parent to child thread ids. Whether child-thread events arrive on the parent's connection with their own `threadId`, and whether that is enough for the helper tiles, is **unclear** and must be recorded once on a real run.

### 3.3 Controlling a session

| Need | How | Notes |
| --- | --- | --- |
| Handshake | `initialize{clientInfo{name,title,version}}` then `initialized`. Set `clientInfo.name` to a stable id; OpenAI uses it for compliance logs and asks enterprise integrations to contact them. | docs |
| Start / resume | `thread/start{cwd, model, approvalPolicy, sandbox, serviceName}` returns `thread.id`. `thread/resume{threadId, excludeTurns:true}`. `thread/fork`. The id is **assigned by Codex**; we cannot choose it. | docs |
| Send | `turn/start{threadId, input:[{type:'text',text},{type:'localImage',path}], model?, effort?, approvalPolicy?, sandboxPolicy?, cwd?}`. Overrides become the defaults for later turns. `turn/steer` appends to a running turn. | docs |
| Stop the turn | `turn/interrupt{threadId, turnId}`; the turn ends with `status:"interrupted"`. | docs |
| End | `thread/unsubscribe`; the server unloads an idle thread after about 30 minutes. Closing the child process ends everything. | docs |
| Approvals | Server request `item/commandExecution/requestApproval` (command, cwd, reason, `commandActions`, optional `networkApprovalContext{host,protocol}`, `availableDecisions`) and `item/fileChange/requestApproval` (reason, `grantRoot`). Answer `accept`, `acceptForSession`, `decline`, `cancel` (commands also `acceptWithExecpolicyAmendment`). Also `item/permissions/requestApproval` (network/filesystem subset, scope `turn` or `session`), `tool/requestUserInput` and `mcpServer/elicitation/request` (MCP side effects and forms). `serverRequest/resolved` confirms. | A pending request is held until we answer. docs |
| Approval policy | `AskForApproval`: `untrusted` (**retired**: Codex no longer supports it), `on-request`, `never`, or a `granular` object (`sandbox_approval`, `rules`, `skill_approval`, `request_permissions`, `mcp_elicitations`). | docs |
| Sandbox | `SandboxMode`: `read-only`, `workspace-write`, `danger-full-access`. OS enforced: Seatbelt on macOS, bubblewrap + seccomp on Linux, "MXC" (with legacy elevated/unelevated fallbacks that need a setup step, `windowsSandbox/setupStart`) on Windows. Network is off by default. `.git`, `.codex`, `.agents` stay read-only inside writable roots. | docs |
| Models, effort | `model/list` (`supportedReasoningEfforts`, `defaultReasoningEffort`, `inputModalities`); per-turn `model` and `effort`. | No context window in `model/list`; it comes from `tokenUsage.modelContextWindow`. docs |
| MCP | Servers come from the user's `config.toml` (and project `.codex/config.toml` for trusted projects). `mcpServerStatus/list`, `config/mcpServer/reload`, `mcpServer/oauth/login`. The CLI accepts `-c key=value` overrides. | **unclear**: a per-thread way to add Durbar's own MCP servers or to switch one off for one session. Process-wide `-c` overrides at launch work in principle; per-session control is unverified. |
| Git | `codex exec` refuses to run outside a Git repository unless `--skip-git-repo-check`. The SDK has `skipGitRepoCheck`. | unclear for app-server threads. |

### 3.4 Cost, credits, context

- No money and no credit figure per call. Turn usage is tokens only. docs
- ChatGPT plans have rate-limit windows (`account/rateLimits/read`, `usedPercent`), not credits; API-key use is billed by the API and Codex reports tokens. `UsageLimitExceeded` is an error code on a failed turn. docs
- Context: `modelContextWindow` (may be null) and `last.inputTokens` give size and a good estimate of use. Whether `last.inputTokens` equals the current window fill is **unverified**.
- **gap**: Codex rows in Durbar show tokens and "credits not reported", the same wording as spec 011 already uses when a runtime sends no figure.

### 3.5 Authentication

- `codex login` (ChatGPT sign-in, device code) or an API key (`CODEX_API_KEY`, per run). Tokens are kept in `~/.codex/auth.json` or the OS keyring; the docs say to treat `auth.json` like a password. Durbar never reads it. docs
- `account/read` reports `{account: null | {type:'apiKey'} | {type:'chatgpt', email, planType} | {type:'amazonBedrock'}, requiresOpenaiAuth}` and needs no model call. That is the sign-in check. docs (unverified on a real install)
- The app-server doc says: *"App-server authentication has never been permitted for commercial or hosted services."* and recommends "Sign in with ChatGPT" for such uses. Durbar is a local, non-commercial, MIT app that starts the user's own binary with the user's own login; that matches how the VS Code extension uses app-server, but the owner should confirm (Q1). We will **not** call `account/login/start` in v1: the user signs in with the CLI in a terminal. docs
- Same GUI-environment limit as Claude: `CODEX_API_KEY` exported in a shell profile is invisible to a Finder-launched app. The ChatGPT login lives in a file and works.

### 3.6 Sessions and history

- Rollouts are JSONL under `~/.codex/sessions/` (the SDK README says so), archived ones in an archive folder. The format is not a public contract. `--ephemeral` and `history.persistence` mean some runs leave nothing. docs
- Supported read path: `thread/list{cwd, sourceKinds, archived, searchTerm, limit, cursor}` (filter by folder), `thread/read`, `thread/turns/list`, `thread/items/list` (paged), `thread/name/set`. Needs a running app-server (a process, no model call). docs
- `thread/list` defaults to interactive sources (`cli`, `vscode`); sessions started by `exec` or by sub-agents need `sourceKinds`. docs

### 3.7 Packaging and licence

- The CLI is a native binary per platform (`@openai/codex`, Apache-2.0). npm reports about **430 MB** unpacked for the linux-x64 package. Bundling is not sensible for an installer; use the user's installed `codex` (a version probe, `codex --version`, costs nothing). The app-server types are generated by the same binary, so a minimum version and a tolerant reader (ignore unknown notifications and fields) are required.
- No new npm runtime dependency is needed: a small line-delimited JSON-RPC client over `child_process.spawn` (absolute path, argv array, no shell) is enough.

## 4. What both vendors share, and what differs

| Topic | Claude Code (SDK) | Codex (app-server) | Durbar consequence |
| --- | --- | --- | --- |
| Approval model | Per tool call, `canUseTool`; modes decide what reaches it | Per escalation: the **sandbox** decides what is allowed without asking; approval policy decides when to ask | Same `PermissionInfo` card; different meaning of "Read-only". See the plan's mode table. |
| Shell in read-only | `dontAsk` + allow list: shell is denied | Shell runs inside a read-only OS sandbox | **Differs.** Codex cannot read files without shell, so denying shell would make it useless. Honest wording needed. |
| Tool event with MCP origin | tool name `mcp__<server>__<tool>`; `canUseTool.mcpServer.name` for permission | `mcpToolCall.server` and `.tool` fields | Claude: parse using the init server list; Codex: direct. |
| Sub-agent identity | `parent_tool_use_id`, `agent_id`, task events | child thread ids in `collabAgentToolCall` / `subAgentActivity`; routing unclear | Claude good, Codex unverified. |
| Cost | USD estimate, tokens | tokens only, rate-limit percent | Add optional `costUsd` (estimate); never mix with AIU. |
| Context window | `getContextUsage`, `modelUsage.contextWindow` | `modelContextWindow` (nullable) | `ContextEvent` fits both. |
| Resume | `resume: id`, id can be chosen (`sessionId`) | `thread/resume`, id assigned by Codex | Persist a vendor session id. |
| Interrupt | `interrupt()` (streaming mode) | `turn/interrupt` | Both fit `interrupt?`. |
| Live mode switch (spec 018) | `setPermissionMode()` *(not enough alone: see the findings below; built as FR-115/FR-116)* | next `turn/start` overrides, applies from the next turn | Claude: the broker and the `PreToolUse` hook at once, the CLI flags from the next message; Codex from the next turn (declare it). |
| Auth risk | **Policy restricts third-party use of subscription login** | App-server auth not for commercial/hosted; local use matches the VS Code extension | Q1. |

## 5. What cannot be known without real accounts

Everything here needs a real, signed-in session and therefore the owner's approval (and, for Claude, an answer to Q1):

1. That the Claude SDK starts at all from Electron's packaged app (asar, ESM import, spawn of the unpacked binary).
2. That `permissionMode: 'dontAsk'` plus our `PreToolUse` deny hook really stops writes and shell when the user's own settings contain allow rules.
3. The exact event order of a real turn for each vendor (these are the fixtures the mappers need; until then fixtures are synthetic and labelled so).
4. What `canUseTool` receives for a sub-agent's tool call, and what text/thinking arrives with `forwardSubagentText`.
5. Whether `getContextUsage({detail:'summary'})` and `accountInfo()` are free (no model call).
6. For Codex: that a read-only sandbox plus `on-request` really raises an approval for `fileChange`; how child-thread events are routed; whether `last.inputTokens` is the window fill; per-session MCP control; Git-repo requirement on app-server; the Windows sandbox setup step.
7. Whether a sign-in check really costs nothing on either vendor.
8. Windows and macOS behaviour of anything above (everything runs on Linux at best today).

## 6. Sources of risk worth repeating

- Both runtimes change weekly. Pin the SDK, record the CLI version in the session, set a minimum version, ignore what you do not know.
- Neither vendor's transcript format is a contract; use their list/read APIs.
- Project folders can carry their own hooks and MCP servers (`.claude/settings.json`, `.mcp.json`, `.codex/config.toml`). Claude runs them in headless mode without a trust prompt. Durbar must decide what to load (plan, section "Folder trust").

## Findings from the build and real runs (2026-10-18 and 2026-10-19, Claude Code 2.1.302-2.1.303)

What the Claude adapter's build and its real checks showed against the claims above (each is recorded with its evidence in [spec.md](spec.md) under *Changes*):

- **The SDK is not needed** for what Durbar does: the CLI's stream-json control protocol covers it (`initialize`, `can_use_tool`, `hook_callback`, `interrupt`, `set_permission_mode`, `mcp_status`, `mcp_toggle`). The SDK stays an optional transport (FR-113), not a dependency (Q3); its ESM `import()` from the CommonJS main process works in a packaged build (T044 part).
- **Live mode switch:** `setPermissionMode()` alone is not safe, because Read-only's pre-approved read tools and Allow all's `bypassPermissions` are launch flags. Built instead: the broker and the `PreToolUse` hook (which **does run under `bypassPermissions`**, real) take the new mode at once; the CLI is relaunched with the new flags and `--resume` on the next message (FR-115, FR-116).
- **Models:** the `initialize` reply already lists the models with their effort levels (`models[].value`, `displayName`, `supportedEffortLevels`); no prompt and no `supportedModels()` call are needed (FR-118).
- **Sessions on disk:** without the SDK's `listSessions`/`getSessionMessages`, Durbar reads Claude's own `projects/<folder slug>/<id>.jsonl` read-only (FR-125, FR-126); the format is internal and undocumented.
- **`AskUserQuestion`:** answered from the `PreToolUse` hook with `updatedInput.answers` keyed by the question text; accepted in every mode, `dontAsk` and `bypassPermissions` included (FR-129, real).
- **Sub-agents:** Claude's sub-agent tool is now called **`Agent`** (`Task` is the older name); both are mapped (T069, real).
- **Custom agents:** with `--setting-sources ""` Claude does not load the folder's `.claude/agents`; `--agents <json>` with `--agent <name>` works, but **`--agent` is ignored with `--resume`**: the agent is fixed when a session is created (FR-008 of spec 043, real).
- **Sign-in:** `claude auth status --json` gives `loggedIn` without a prompt (FR-132).
- **Usage:** `input_tokens` excludes cache writes and reads; Durbar adds them to match the other adapters (FR-124).
- **MCP:** `mcp_toggle` (`serverName`, `enabled`) and `mcp_status` (`mcpServers`) are control requests of the CLI (read from the 2.1.303 bundle; undocumented); checked with a local stdio server without a prompt (FR-133).

## Findings from the Codex build and real runs (2026-10-19, Codex CLI 0.163.0, ChatGPT Plus, Linux)

What the real `codex app-server` showed against the claims above (the evidence is in [spec.md](spec.md) under *Changes*, FR-137..FR-149):

- **Sign-in:** `codex login status` prints `Logged in using ChatGPT` and exits 0, or prints `Not logged in` and exits 1. `account/read` gives `{account: {type, email, planType}, requiresOpenaiAuth}`. Durbar reads only the phrase and the exit code (FR-137).
- **Permission profile:** a config that defines `[permissions]` profiles must also set `default_permissions`, or the app-server does not start (FR-138). Inside the profile Codex runs its own binary again, so its install folder must be readable (FR-138).
- **Linux sandbox:** Read-only and Ask first run commands in bubblewrap. On Ubuntu 24.04+ (`kernel.apparmor_restrict_unprivileged_userns=1`) it fails with `RTM_NEWADDR: Operation not permitted` unless an AppArmor profile allows `/usr/bin/bwrap` and Codex's bundled `bwrap` (FR-140, README).
- **Read-only (Q6, answered by the build):** reads inside the session folders work; writes fail (read-only file system); a file outside the folders is not visible at all. The mode is shown as plain Read-only.
- **Interrupt:** `turn/interrupt` ends the turn, but a command that already started runs to its end. `command/exec/terminate` covers only client-started commands; closing the app-server (End session) stops it (FR-139).
- **Resume:** `thread/resume` with a `cwd` **rewrites the thread's stored folder**, so the folder check must read the thread first (`thread/read`) (FR-093). The response reports `sandbox: {type: "readOnly"}` in the read-limited profile.
- **Sessions and models:** `thread/list` (filter by `cwd`, timestamps in seconds) and `thread/read {includeTurns}` give previous sessions and replay. `model/list` gives 7 models with `supportedReasoningEfforts` (some include `ultra`) and a default. `turn/start` takes `model` and `effort` per turn (FR-141, FR-142).
- **Questions:** the server request is `item/tool/requestUserInput` (not `tool/requestUserInput`), answered `{answers: {<id>: {answers: [...]}}}`. Codex offers the tool only with the "under development" feature `default_mode_request_user_input` (FR-146).
- **MCP:** servers can be given per thread as `config.mcp_servers`. States come from `mcpServerStatus/list` and `mcpServer/startupStatus/updated`. A tool call is approved through `mcpServer/elicitation/request` (`_meta.codex_approval_kind: mcp_tool_call`), answered `{action, content}` (FR-147, FR-148).
- **Sub-agents:** one `subAgentActivity` item per activity (`kind` started or completed), linked by `agentThreadId`. `collabAgentToolCall` with `wait` and the like is coordination, not a helper (FR-149).

## 6. Secret masking against public lists (2026-11-01, T137)

The coverage table for FR-080 (c), its method, the licences and where the mask applies: [secret-coverage.md](secret-coverage.md).

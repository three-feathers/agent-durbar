# Agent Command Center – technical research (as of 2026-10-16)
Labels: [CONFIRMED] = read in official docs/source today; [UNCLEAR] = not verified / conflicting; [MY INFERENCE] = my judgment.
Method: WebSearch/WebFetch only. Nothing was run, purchased, or posted.

## 0. Biggest finding: the space is already partly occupied by GitHub/VS Code
- [CONFIRMED] GitHub Copilot app (desktop, GA 2026-06-17, mac/Win/Linux): parallel sessions per git worktree, CLI sessions show up in it. https://github.blog/changelog/2026-06-17-github-copilot-app-generally-available/
- [CONFIRMED] VS Code 1.141 "Agents window" can show agent sessions side by side in a grid; sessions run in an "Agent Host" and are shared across windows. https://github.blog/changelog/2026-10-09-github-copilot-weekly-releases-october-5/ , https://code.visualstudio.com/docs/agents/concepts/agent-host
- [MY INFERENCE] Your differentiator must be the "office view" (who does what incl. sub-agents, 10-15 at once, animated), not generic session listing.

## 1. Copilot CLI (headless / programmatic)
- [CONFIRMED] `copilot -p PROMPT` non-interactive; `--output-format=json` emits JSONL; `-s` silent; `--allow-all`/`--allow-all-tools` (required for programmatic use); `--attachment PATH` (files/images, only in non-interactive); `--agent`, `--model`, `--resume[=ID]`, `--continue`, `--session-id`, `-n NAME`, `--log-dir`, `-C DIR`, `--add-dir`. https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference , https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference
- [CONFIRMED] State in `~/.copilot` (override `COPILOT_HOME`): `session-state/<session-id>/events.jsonl` (+ plans, checkpoints, files), `session-store.db` (SQLite), `logs/process-{timestamp}-{pid}.log`, `settings.json`, `mcp-config.json`, `agents/*.agent.md`, `permissions-config.json`. https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference
- [CONFIRMED] Event type names persisted/emitted (SDK doc): assistant.reasoning(_delta), assistant.message(_delta), tool.execution_start/complete, subagent.started/completed/failed, permission.requested, session.idle, user.message (with attachments). Ephemeral deltas are NOT written to disk -> tailing events.jsonl gives completed blocks, not live token streaming. https://github.com/github/copilot-sdk/blob/main/docs/features/streaming-events.md
- [UNCLEAR] Exact on-disk events.jsonl schema is not separately documented as stable; assume it mirrors the persisted SDK events but verify against a real file.
- [CONFIRMED] Custom agents: `.agent.md` in repo or `~/.copilot/agents/`; sub-agents via the `task` tool; `/tasks` UI; `COPILOT_SUBAGENT_MAX_CONCURRENT` default 32, depth default 4. `/fleet` = parallel sub-agents (not supported in ACP mode).
- [CONFIRMED] Server modes: `--acp`, `--headless/--server` (JSON-RPC server, `--port`), `--ui-server` (TUI + embedded server, SDK foreground-session APIs). (headless doc: https://github.com/github/copilot-sdk/blob/main/docs/setup/backend-services.md; the CLI reference also mentions `--server` and `--ahp-host` but I did not find their own docs page.)

## 2. SDK / ACP
- [CONFIRMED] Official Copilot SDK GA 2026-06-02 (Node/TS, Python, Go, .NET, Java, Rust). JSON-RPC to the CLI runtime; spawns CLI over stdio by default (bundled runtime via optional npm platform packages) or connects to a running server (`RuntimeConnection.forUri`). https://github.blog/changelog/2026-06-02-copilot-sdk-is-now-generally-available/ , https://github.com/github/copilot-sdk (nodejs/README.md)
- [CONFIRMED] SDK gives: `createSession({workingDirectory, model, streaming, onPermissionRequest, ...})`, `resumeSession`, `listSessions` (cwd/gitRoot/branch), `session.on(...)` typed events incl. `assistant.reasoning_delta`, `tool.shell_output`, `subagent.*`, envelope field `agentId` for sub-agent attribution, `send({prompt, attachments:[file|blob(base64 image)]})`, `abort()`, `getEvents()`, permission + user-input + plan-mode request/response, hooks (onSubagentStart/Stop), client lifecycle events (session.created/updated).
- [CONFIRMED] ACP: `copilot --acp [--stdio | --port N]`, NDJSON, public preview ("subject to change"). Supports initialize, session/new (cwd), session/prompt with text/images/resources, streaming updates, permission requests, cancel, slash commands, session/list + session/load across processes (disk-backed since v1.0.19; no live co-sharing). https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server , https://github.blog/changelog/2026-01-28-acp-support-in-copilot-cli-is-now-in-public-preview/ , https://github.com/github/copilot-cli/issues/1767
- [CONFIRMED] ACP update types incl. `agent_message_chunk`, `agent_thought_chunk`, `tool_call(_update)`, `plan`, `usage_update`. https://agentclientprotocol.com/protocol/prompt-turn
- [CONFIRMED, important gap] Open bug: over ACP, sub-agent streamed text arrives as plain `agent_message_chunk` with NO agent identity, so parallel sub-agents interleave (CLI 1.0.71, July 2026). Only the `task` tool_call ids distinguish them. https://github.com/github/copilot-cli/issues/4106
- [MY INFERENCE] For an "office with sub-agents" view the SDK (agentId + subagent.* events) is a better fit than raw ACP.
- [CONFIRMED] Alternative: Agent Host Protocol (AHP): `code agent host` starts a standalone host; clients in TS/Rust/Go/Kotlin/Swift (`@microsoft/agent-host-protocol`); observe/approve/cancel the same live sessions VS Code shows; `code agent ps/stop/kill`. https://code.visualstudio.com/blogs/2026/08/26/agent-host-architecture . Copilot SDK also has experimental `startAhpHost()`. [UNCLEAR] AHP maturity ("under active development"); sub-agent/attachment fidelity not verified.

## 3. VS Code Copilot Chat / agent mode
- [CONFIRMED] Stable extension APIs: chat participants, language model API, tools. These do not let you read/control other sessions of built-in agent mode. https://code.visualstudio.com/api/extension-guides/ai/chat (general; not re-fetched today)
- [CONFIRMED] Chat-sessions provider API (`vscode.chat.createChatSessionItemController`) is a PROPOSED API (v3): not publishable on Marketplace. It is for contributing your own session type, not for observing built-in ones. https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.chatSessionsProvider.d.ts
- [UNCLEAR] No stable public API found to enumerate/observe built-in agent sessions of other windows. Absence is my finding, not a doc statement.
- [CONFIRMED, third-party source] Disk: `User/workspaceStorage/<hash>/chatSessions/*.jsonl` (older `.json`), UI reads index key `chat.ChatSessionStore.index` in state.vscdb; newer extension also writes `workspaceStorage/<hash>/GitHub.copilot-chat/transcripts/*.jsonl` (type-discriminated events: session.start, user.message, assistant.message, tool.execution_*). `workspace.json` maps hash->folder. Layout differs by version/remote (VS Code Server 1.137 had no chatSessions dir). https://vshulcz.github.io/deja-vu/registry/copilot-chat.html . Internal formats, undocumented, can change anytime.
- [CONFIRMED] Agent Host sessions: shared across windows, survive window close; VS Code discovers Copilot CLI sessions and can resume them. https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions/
- [CONFIRMED] Open VS Code: `code <folder>` (`-n` new window, `-r` reuse, `--profile`), `code chat -m agent -a file "prompt"`, URIs `vscode://file/<path>`, `vscode://agents/new?prompt=..&workspace=<folder-uri>` (opens draft, does not submit). Insiders: `code-insiders`, `vscode-insiders://`. https://code.visualstudio.com/docs/editor/command-line . Opening VS Code on a folder is easy; deep-linking to a specific existing session is [UNCLEAR] (no documented URI).

## 4. Cloud coding agent
- [CONFIRMED] REST (public preview): `GET /agents/tasks`, `GET /agents/repos/{o}/{r}/tasks`, `GET /agents/tasks/{id}` (sessions, state queued|in_progress|completed|failed|idle|waiting_for_user|timed_out|cancelled, usage, model), `POST /agents/repos/{o}/{r}/tasks` to start. https://docs.github.com/en/rest/agent-tasks/agent-tasks
- [CONFIRMED] `gh agent-task list|view --log --follow|create` (gh >= 2.80, preview). https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-from-cli
- [UNCLEAR] Mid-run steering/follow-up message endpoint: not seen in REST docs I read (only list/get/start). Cloud sessions are also creatable via SDK/CLI `--remote`/`--cloud` and `--connect` (account-gated).
- [CONFIRMED, changed] Premium requests were replaced by usage-based GitHub AI Credits on 2026-06-01 (1 credit = $0.01; Pro 1,500, Pro+ 7,000, Max 20,000/month; CLI, cloud agent, chat all consume). 10-15 concurrent agents can burn this fast. CLI has `--max-ai-credits`, `/limits`, SDK `assistant.usage` + `session.usage_checkpoint` events. https://docs.github.com/en/copilot/concepts/billing-and-usage/individuals/billing

## 5. MCP
- [CONFIRMED by design/ docs] MCP exposes tools/resources/prompts TO an agent (Copilot CLI loads MCP servers via `mcp-config.json`/`--additional-mcp-config`). It has no session-list/observe/steer surface. Not the integration path; at most you could add an MCP tool the agents call to report status to your app (optional, nice for "who does what").

## 6. Packaging (mostly general knowledge, not re-verified today)
- VS Code extension: pro: opens VS Code natively, one install. con: cannot observe built-in sessions (see 3), webview limited, proposed APIs not publishable, a window per folder = awkward for multi-workspace dashboard. Poor fit.
- Electron: pro: Node-native -> use `@github/copilot-sdk` directly in main process (bundles runtime packages per platform), identical Chromium rendering Win/Mac (good for many CSS/canvas animations), mature child-process + file-drop. con: 150-300 MB installs, RAM per app.
- Tauri: pro: small shell, Rust core. con: system WebViews differ (WebView2 vs WKWebView), SDK needs a Node sidecar or Rust SDK (Rust SDK exists, bundles CLI) -> more glue; animation perf varies by webview.
- [MY INFERENCE] Electron is the lower-risk first build because the TS SDK is the best-supported path; Tauri is viable if you accept Rust SDK or Node sidecar.

## Recommendation (one path)
Electron (TypeScript) app, one `CopilotClient` (or one runtime per folder if you need isolation / `COPILOT_HOME`) using the official Copilot SDK, one session per folder/agent; render office view from SDK events (`agentId`, `subagent.*`, `assistant.intent`, `tool.*`); chat input -> `session.send` with attachments (file/blob); open VS Code via `code <folder>`; seed list by `listSessions()` and tail `~/.copilot/session-state/*/events.jsonl` to also show sessions started elsewhere in a terminal. Skip ACP unless you need non-Copilot agents (sub-agent identity bug #4106).

## Limits / risks
1. Sessions you start in VS Code chat are NOT controllable from your app (no API); only read-only via fragile disk parsing.
2. CLI sessions started in a terminal are resumable (disk-backed) but not live-shared; live control needs sessions your app owns (or `--ui-server`/AHP).
3. Permission prompts: must implement approve/deny UI or run allow-all (risky x15 agents).
4. Cost: AI-credit burn; show `assistant.usage` per agent, set `--max-ai-credits`.
5. Duplication risk with Copilot app / VS Code Agents window grid.
6. ACP + AHP + SDK extension points are preview/evolving; pin CLI/SDK versions.
7. Org policy: Copilot CLI must be enabled for Business/Enterprise.

## Minimum viable first milestone
Electron app that (a) picks N folders, (b) starts one SDK session per folder with streaming, (c) shows a grid of 10-15 cards with state (idle/working/needs-permission/error), current `assistant.intent`, last tool, and nested sub-agent chips from `subagent.*`, (d) click card -> chat panel with live reasoning/message deltas + send box + image/file attach, (e) "Open in VS Code" button (`code <folder>`), (f) per-agent AI-credit counter. Defer: office animation polish, disk-watching external sessions, cloud agent tasks, Tauri.

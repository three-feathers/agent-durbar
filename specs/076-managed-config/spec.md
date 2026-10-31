# Feature Specification: Managed configuration for organizations

<!-- specs-index (the row of the generated specs index; npm run specs:index shows it)
group: 046
title: Managed configuration for organizations: one admin-only config folder (policy.json, MCP list, icon, theme pack) sets the display name and icon, allowed agent apps, MCP lists and endpoints, an agent/profile/skill registry, OpenTelemetry, theme and custom LLMs with admin token pricing, plus the accepted additions (mode lock, proxy and CA, feature switches, installers, signing, spend caps, folder rules, updates, registry/MDM sources, signed config, audit log, retention, rebrand build, legal notice, version pins, endpoint auth, sign-in, vendor settings view); everything set there is locked; a narrow-only user layer; bad config fails closed and visibly
status: draft
note: spec only; decisions recorded, signing purchase needs the owner's OK
-->

**Feature Branch**: `076-managed-config`
**Created**: 2026-10-23
**Status**: Draft. Section O (FR-198..FR-207, phase P27, issue #602) is built (PR 644; `[IMPLEMENTED]` tags there); everything else is spec only, nothing built. Q1-Q12 answered by Vikram on 2026-10-23 (defaults, except Q10: admin token pricing). A1-A19 accepted by Vikram on 2026-10-23 as requirements (section N); the code-signing certificate purchase still needs his explicit OK at purchase time. Security review by Paco's agent (2026-10-23, 17 items) folded in; R1-R8 answered by Vikram on 2026-10-23 (recommended defaults).
**Input**: Owner request by Vikram (2026-10-23): "Durbar must be packageable and usable in corporate environments. All of it is driven by a config folder (config files plus icons), and anything set there is locked, i.e. not editable in the UI (shown as *Set by your organization*):
1. change the app display name and icon (the original name stays in About and credits);
2. restrict which agent apps (harnesses) are allowed;
3. restrict and also complement the MCP list, including a custom endpoint that serves an MCP list as JSON (with a sample JSON and a schema);
4. a source for an agent/profile and skill registry, from which users load agents, profiles and skills, with automatic change checks and updates;
5. OpenTelemetry endpoints, per agent app as far as its CLI supports them;
6. set a theme (a custom theme pack or a bundled one);
7. a custom LLM config for agent apps that support it, so a company can use its own hosted models.
Research what else companies need for packaging, and suggest additions."

## Summary

An IT department drops one folder (a `policy.json`, optional MCP list, optional theme pack and icon) into a fixed, admin-only place on
each machine. Durbar reads it at start, validates it against a published JSON schema, and applies it **above** the user's own settings.
Every control a policy key covers is shown disabled with a lock and the words **Set by your organization**. An optional per-user
folder can only make things stricter and is labelled *Set in your user config (not managed)*. A broken folder never silently loosens
anything: Durbar fails closed (no new turns) with a visible banner, at least as strict as the strictest valid layer. A new **Settings > Organization** page shows the
effective policy, where each value came from, and every error.

Durbar does **not** become a second enforcement layer for the agent apps' own enterprise controls. Where a vendor has its own managed
settings (Claude Code `managed-settings.json`, Codex `requirements.toml`, GitHub's Copilot policies), Durbar's policy configures the
sessions **Durbar** starts and the spec says plainly that hard enforcement for a terminal user is the vendor's mechanism (FR-131).

## Threat model

**Defends against** (each with the FR that does it):
- a standard user, or any process running as that user, loosening the organization's rules: the machine folder is admin-owned and
  checked (FR-002, FR-005), packaged builds ignore dev variables under a policy (FR-004), the user layer can only narrow (FR-003), every
  writer in main refuses locked keys (FR-016);
- a compromised or spoofed **remote** list or registry: remote MCP lists cannot carry commands, env references or `required` (FR-040,
  FR-041), registry files must match their hash and the index's origin and are never executed (FR-061, FR-066), `auto` updates need a
  local file or a signature (FR-063, FR-178), fetches refuse local and metadata addresses (FR-120);
- secrets leaking through config: no secret fields, env names allow-listed and bound to a host (FR-121, FR-121a), detection through
  `redact.ts` on every file and response (FR-013, FR-121);
- a broken or truncated policy silently loosening rules: fail closed (FR-010..FR-012);
- prompts going to the public vendor endpoint when the company wanted its own: a missing token or a bad `llm` key stops the app, and
  the user's own vendor credentials are stripped (FR-012, FR-100a).

**Does not defend against** (stated in the docs, `[KNOWN GAP]` where it is work):
- a local administrator or root: they can change the machine folder, Durbar's binary or the agent apps;
- direct use of `claude`, `copilot` or `codex` in a terminal: Durbar's policy covers Durbar's sessions; vendor managed settings cover the
  rest (FR-131);
- what an agent app does with what it is given: env-passed secrets can be read by the agent's own shell tool (FR-121), and Durbar cannot
  redact what an app exports over OTel (FR-086);
- the fetch cache and bookkeeping files in the user's profile: a user can edit them, so they are only caches. A cache entry that fails
  its hash or (with signing) its signature is ignored, and nothing in them can widen the policy (FR-120, FR-061);
- DNS rebinding between Durbar's address check and Chromium's connection (FR-120, `[KNOWN GAP]`);
- a malicious remote MCP server that the organization's own list offers (it is the organization's choice; signatures, FR-178, help
  only against a tampered list).

## Research (`read:` evidence, 2026-10-23)

Every row was read in the vendor's own documentation on 2026-10-23 unless marked *unconfirmed*.

| Product | Where managed config lives | Lock / precedence | Diagnostics / UI | Source |
|---|---|---|---|---|
| VS Code | Windows registry `Software\Policies\Microsoft\VSCode` set by GPO/Intune via shipped ADMX/ADML; macOS configuration profile (sample `.mobileconfig` in the bundle, 1.99+); Linux `/etc/vscode/policy.json` (1.106+, root:root 0644) | Computer beats user; a policy beats default, user and workspace values. A Linux syntax error means the policy does not apply (logged) | Lock icon, "managed by your organization" on the setting | `read:` https://code.visualstudio.com/docs/enterprise/policies |
| VS Code policies relevant here | `AllowedExtensions`, `UpdateMode`, `ChatMCP` (`chat.mcp.access`), `ChatAllowedMcpServers`/`ChatDeniedMcpServers` (deny wins), `ChatAllowManagedMcpServersOnly`, `McpGalleryServiceUrl`, `ExtensionGalleryServiceUrl` | | | same |
| Chrome | Linux `/etc/opt/chrome/policies/managed/*.json` (mandatory) and `.../recommended/` (user may change); Windows registry through Group Policy; macOS managed preferences (exact plist path *unconfirmed* in the pages read) | Platform policy > machine cloud > OS user > cloud user; machine beats user; mandatory beats recommended; the same policy in two files is undefined | `chrome://policy`: Reload, status OK/error per policy, "show policies with no value" | `read:` https://chromium.googlesource.com/chromium/src/+/main/docs/enterprise/policies.md, https://support.google.com/chrome/a/answer/9027408, https://support.google.com/chrome/a/answer/9037717 |
| Claude Code | macOS `/Library/Application Support/ClaudeCode/managed-settings.json`; Linux/WSL `/etc/claude-code/managed-settings.json`; Windows `C:\Program Files\ClaudeCode\managed-settings.json` (the old `C:\ProgramData\ClaudeCode` is **no longer read**); `managed-settings.d/` drop-ins; `managed-mcp.json`. MDM: macOS domain `com.anthropic.claudecode`; Windows `HKLM\SOFTWARE\Policies\ClaudeCode` value `Settings` (JSON); `HKCU` only when no admin source exists; re-read every 30 min | Managed > command line > project local > project > user; lists merge; a present but unparseable managed file makes Claude Code **refuse to start** | | `read:` https://code.claude.com/docs/en/managed-settings, https://code.claude.com/docs/en/settings |
| Claude Code, MCP | `allowedMcpServers`, `deniedMcpServers`, `allowManagedMcpServersOnly`, `managed-mcp.json` | | | same (`managed-mcp` page referenced, not read) |
| Claude Code, OTel | Off until `CLAUDE_CODE_ENABLE_TELEMETRY=1`. Exporters: `OTEL_METRICS_EXPORTER` (`console`, `otlp`, `prometheus`, `none`), `OTEL_LOGS_EXPORTER` (`console`, `otlp`, `none`); traces are **beta** and need `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` plus `OTEL_TRACES_EXPORTER`. `OTEL_EXPORTER_OTLP_PROTOCOL` (`grpc`, `http/json`, `http/protobuf`) has **no default** and must be set; `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` (static); per-signal `OTEL_EXPORTER_OTLP_{METRICS,LOGS,TRACES}_{ENDPOINT,PROTOCOL,HEADERS}` (per-signal headers are merged); `OTEL_METRIC_EXPORT_INTERVAL` (60000 ms), `OTEL_LOGS_EXPORT_INTERVAL` (5000 ms); `OTEL_RESOURCE_ATTRIBUTES` (`k=v,k=v`; `"`, `,`, `;`, `\`, spaces and non-ASCII must be percent-encoded). Dynamic headers: the `otelHeadersHelper` setting (a script, http protocols only; on failure exports stop with a warning). mTLS: `CLAUDE_CODE_CLIENT_CERT`/`_KEY` (http), `OTEL_EXPORTER_OTLP_CLIENT_KEY`/`_CLIENT_CERTIFICATE`/`OTEL_EXPORTER_OTLP_CERTIFICATE` (grpc). **Content gates, all off by default:** `OTEL_LOG_USER_PROMPTS` (prompt text), `OTEL_LOG_ASSISTANT_RESPONSES` (**follows `OTEL_LOG_USER_PROMPTS` when unset**), `OTEL_LOG_TOOL_DETAILS` (Bash commands, tool input, MCP/skill names), `OTEL_LOG_TOOL_CONTENT` (tool output, traces only), `OTEL_LOG_RAW_API_BODIES` (full API bodies; implies all the others), `OTEL_LOG_MANAGED_SETTINGS`. Identity on by default: `session.id`, `user.account_uuid`, `user.account_id`, `organization.id`, `user.email` when available (`OTEL_METRICS_INCLUDE_SESSION_ID`, `OTEL_METRICS_INCLUDE_ACCOUNT_UUID` turn the metric ones off). Metrics: `claude_code.session.count`, `.lines_of_code.count`, `.pull_request.count`, `.commit.count`, `.cost.usage` (USD, approximate), `.token.usage` (`input`, `output`, `cacheRead`, `cacheCreation`), `.code_edit_tool.decision`, `.active_time.total`. Events: `claude_code.user_prompt`, `.assistant_response`, `.tool_result`, `.api_request` (tokens, `cost_usd`), `.api_error`, `.api_refusal`, `.tool_decision`, `.safety_event`, `.mcp_server_connection`, `.hook_*`, `.compaction`, `.managed_settings_resolved`, `.api_request_body`/`.api_response_body` (raw bodies only) | Managed `env` locks endpoint, protocol and headers and removes developer-set per-signal values; exporter selectors are locked only when managed settings set them (2.1.223+); OTel exporter variables in `.claude/settings.json`/`settings.local.json` are ignored; `OTEL_*` is not passed to Bash, hooks, MCP or language servers | `claude --debug-file <path>`: `[3P telemetry]` lines | `read:` https://code.claude.com/docs/en/monitoring-usage 2026-10-23 |
| Claude Code, network and LLM | `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` (no SOCKS); bundled CAs plus the OS store (`CLAUDE_CODE_CERT_STORE`); `NODE_EXTRA_CA_CERTS`; mTLS `CLAUDE_CODE_CLIENT_CERT`/`_KEY`; gateway: `ANTHROPIC_BASE_URL` plus `ANTHROPIC_AUTH_TOKEN` (sent as `Authorization: Bearer <value>`); `allowedProviders: ["customEndpoint"]` (2.1.285+) pins it. **Bedrock:** `CLAUDE_CODE_USE_BEDROCK=1`, `AWS_REGION` (optional when the AWS profile has one), optional `ANTHROPIC_BEDROCK_BASE_URL`; credentials from the AWS chain, or `AWS_BEARER_TOKEN_BEDROCK` (an API key; when set, the chain is not used). **Vertex** (now "Google Cloud's Agent Platform"): `CLAUDE_CODE_USE_VERTEX=1`, `CLOUD_ML_REGION` (e.g. `global`), `ANTHROPIC_VERTEX_PROJECT_ID` (wins over `GOOGLE_CLOUD_PROJECT`), optional `ANTHROPIC_VERTEX_BASE_URL`, per-model `VERTEX_REGION_CLAUDE_*`; credentials from Google ADC. **Microsoft Foundry:** `CLAUDE_CODE_USE_FOUNDRY=1`, `ANTHROPIC_FOUNDRY_RESOURCE` or `ANTHROPIC_FOUNDRY_BASE_URL`, `ANTHROPIC_FOUNDRY_API_KEY` or `ANTHROPIC_FOUNDRY_AUTH_TOKEN` (else the Azure credential chain). Models: `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL`; `ANTHROPIC_SMALL_FAST_MODEL` is **deprecated** (use `ANTHROPIC_DEFAULT_HAIKU_MODEL`). An empty value in a settings `env` block counts as unset. `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` (for embedding hosts) makes Claude Code ignore provider, endpoint and auth variables in settings files **and model pins in managed settings**, and skips the third-party telemetry opt-out | Managed > CLI > project > user | | `read:` https://code.claude.com/docs/en/network-config, https://code.claude.com/docs/en/llm-gateway, https://code.claude.com/docs/en/amazon-bedrock, https://code.claude.com/docs/en/google-vertex-ai, https://code.claude.com/docs/en/microsoft-foundry, https://code.claude.com/docs/en/env-vars 2026-10-23 |
| Copilot CLI, custom models (BYOK) | Env vars: `COPILOT_PROVIDER_BASE_URL` (required), `COPILOT_PROVIDER_TYPE` (`openai` default, `azure`, `anthropic`), `COPILOT_PROVIDER_API_KEY` or `COPILOT_PROVIDER_BEARER_TOKEN`, `COPILOT_PROVIDER_WIRE_API`, `COPILOT_PROVIDER_AZURE_API_VERSION`, `COPILOT_PROVIDER_MODEL_ID`, `COPILOT_PROVIDER_WIRE_MODEL` (Azure: the deployment name), `COPILOT_PROVIDER_MAX_PROMPT_TOKENS`, `COPILOT_PROVIDER_MAX_OUTPUT_TOKENS`, `COPILOT_MODEL` (required); `COPILOT_OFFLINE=true` avoids GitHub contact. Also `COPILOT_PROVIDERS_CONFIG` (a `providers.json` registry, default `~/.copilot/providers.json`, which **takes precedence** over the env provider when it declares any) and `COPILOT_PROVIDER_API_KEY_COMMAND` (a shell command printing a key) | Models need tool calling and streaming | | `read:` https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models, https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#environment-variables, https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference 2026-10-23 |
| Copilot, MCP registry | Org setting points at an HTTPS registry implementing MCP registry API **v0.1** (`GET /v0.1/servers`, `/v0.1/servers/{name}/versions/latest`), CORS open for GET; public preview; GitHub calls managed settings the more secure option | | | `read:` https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-mcp-usage/configure-mcp-registry |
| Copilot CLI, config | `COPILOT_HOME` moves `~/.copilot`; `--disable-client-telemetry` does not affect a user-configured OTel export | | | `read:` https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/configure-copilot-cli, https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference |
| Copilot CLI, OTel | Off by default; on with `COPILOT_OTEL_ENABLED=true`, or when `OTEL_EXPORTER_OTLP_ENDPOINT` or `COPILOT_OTEL_FILE_EXPORTER_PATH` is set. `COPILOT_OTEL_EXPORTER_TYPE` (`otlp-http` default, `file`), `OTEL_EXPORTER_OTLP_PROTOCOL` (`http/json` default, `http/protobuf`; **no gRPC**), `OTEL_EXPORTER_OTLP_{TRACES,METRICS}_PROTOCOL`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME` (`github-copilot`), `OTEL_RESOURCE_ATTRIBUTES` (percent-encoded), `COPILOT_OTEL_SOURCE_NAME`, `OTEL_LOG_LEVEL`, and `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` (default false; **all or nothing**: prompts, responses, system prompt, tool schemas, tool arguments and results). Dynamic headers: `telemetry.headersProvider` (`path`, `args`, `refreshIntervalMs`; user or managed settings, never repository settings; not a shell). Signals: **traces and metrics only** (no OTel logs signal; lifecycle events are span events). Spans `invoke_agent` > `chat`, `execute_tool` (GenAI semantic conventions: `gen_ai.usage.input_tokens`/`output_tokens`/`cache_read.input_tokens`/`cache_creation.input_tokens`, `gen_ai.conversation.id` = session id, `github.copilot.nano_aiu`, `github.copilot.cost` = a billing multiplier, **not money**, `enduser.pseudo.id`). Metrics: `gen_ai.client.operation.duration`, `gen_ai.client.token.usage`, `gen_ai.client.operation.time_to_first_chunk`, `.time_per_output_chunk`, `gen_ai.invoke_agent.duration`/`.inference_calls`/`.tool_calls`, `gen_ai.invoke_workflow.duration`, `github.copilot.tool.call.count`/`.duration`, `github.copilot.agent.turn.count`, `github.copilot.mcp.server.connection.count`, `github.copilot.code.lines_added`/`lines_removed`. Span events: `github.copilot.hook.start`/`end`/`error`, `session.truncation`, `session.compaction_start`/`_complete`, `skill.invoked`, `session.shutdown` (premium requests, lines, files), `session.abort`, `exception` | Managed `telemetry` beats SDK config and environment variables | | `read:` https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#opentelemetry-monitoring, https://docs.github.com/en/copilot/concepts/enterprise/opentelemetry 2026-10-23 |
| Copilot SDK, OTel and env | `new CopilotClient({ telemetry: { otlpEndpoint, otlpProtocol ("http/json" or "http/protobuf"), filePath, exporterType ("otlp-http" or "file"), sourceName, captureContent } })` sets `COPILOT_OTEL_ENABLED=true` and the matching variables on the spawned runtime; there is **no header option** (headers go through env). The client `env` option is the runtime child's environment (inherits `process.env` when not set) | | | `read:` https://docs.github.com/en/copilot/how-tos/copilot-sdk/observability/opentelemetry 2026-10-23; `read:` installed `@github/copilot-sdk` 1.0.22 `dist/types.d.ts` (`TelemetryConfig`, `env`) and `dist/client.js` (the env it sets), 2026-10-23 |
| Copilot, managed settings | Files `/etc/github-copilot/managed-settings.json`, `/Library/Application Support/GitHubCopilot/managed-settings.json`, `%ProgramFiles%\GitHubCopilot\managed-settings.json` (POSIX: refused if a symlink, not root-owned or world-writable); MDM plist `com.github.copilot`, registry `HKLM\SOFTWARE\Policies\GitHubCopilot`; server-managed from an enterprise `.github-private` repo `copilot/managed-settings.json` with `{ "overridable": v }` team overrides; policy hooks in `/etc/github-copilot/policy.d/*.json` or `C:\ProgramData\GitHub\Copilot\policy.d\*.json`. Keys (CLI column): `permissions.disableBypassPermissionsMode` (`disable`, `allow-auto-only`), `permissions.deny/ask/allow` (`Shell(...)`, `Read(...)`, `Edit(...)`, `Domain(...)`), `features.computerUse`, `model`, `autoTier`, `enabledPlugins`, `extraKnownMarketplaces`, `strictKnownMarketplaces`, `telemetry` (`enabled`, `endpoint`, `protocol` `http/json`/`http/protobuf`, `capture.identity/prompts/responses/toolArguments/toolOutput/policyDetail` all false by default, legacy `captureContent`, `lockCaptureContent`, `serviceName`, `resourceAttributes`, `headers`, `headersProvider`), `remoteControl`, `forceRemoteSettingsRefresh`, `allowedMcpServers`/`deniedMcpServers` (`serverName`, `serverUrl`, `serverCommand`), `sandbox` (`enabled`, `failIfUnavailable`, `allowBypass`, `userPolicy.filesystem`/`network`/`proxy.url`, ...) | MDM beats server per key; managed beats local, SDK and env; for `telemetry` the top managed source supplies the **whole** object; re-fetched hourly; an unreadable device policy fails closed (sandbox at its strictest) | | `read:` https://docs.github.com/en/copilot/reference/enterprise-administrators/enterprise-managed-settings, https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference#mdm-managed-settings, https://docs.github.com/en/copilot/how-tos/administer-copilot/manage-for-enterprise/use-managed-settings/get-started, https://docs.github.com/en/copilot/reference/hooks-reference 2026-10-23 |
| Codex CLI, providers | `~/.codex/config.toml` `model_provider = "<id>"` and `model_providers.<id>`: `name`, `base_url`, `env_key`, `wire_api = "responses"`, `query_params` (Azure `api-version`), `http_headers`, `env_http_headers`, `request_max_retries`, `stream_max_retries`, `stream_idle_timeout_ms`, `auth.{command,args,timeout_ms,refresh_interval_ms}` (not with `env_key`); ids `openai`, `ollama`, `lmstudio` reserved; `openai_base_url` moves the built-in provider; **Bedrock**: `model_provider = "amazon-bedrock"` with `[model_providers.amazon-bedrock.aws]` `profile`, `region`. Env: `CODEX_HOME`, `CODEX_API_KEY`, `CODEX_CA_CERTIFICATE` (else `SSL_CERT_FILE`). Project config **ignores** `model_provider`, `model_providers`, `openai_base_url`, `notify`, `profile(s)`, `otel` | `-c key=value` (TOML) overrides; precedence user < profile < project < CLI; managed layers override `--config` | | `read:` https://learn.chatgpt.com/docs/config-file/config-advanced, https://learn.chatgpt.com/docs/config-file/config-reference, https://learn.chatgpt.com/docs/config-file/environment-variables 2026-10-23 |
| Codex CLI, OTel | `[otel]` only in user or managed config (no OTel environment variables in the env-var reference). `environment` (default `dev`), `exporter` (log events: `none`, `otlp-http`, `otlp-grpc`), `trace_exporter` (same values), `metrics_exporter` (`none`, `statsig`, `otlp-http`, `otlp-grpc`), `log_user_prompt` (default false); per exporter `endpoint`, `protocol` (`binary` or `json`, http only), `headers` (static map; the docs' example uses `"${OTLP_TOKEN}"`), `tls.ca-certificate`/`client-certificate`/`client-private-key`. Events: `codex.conversation_starts` (model, reasoning, sandbox and approval policy), `codex.api_request`, `codex.sse_event` (token counts on `response.completed`), `codex.websocket_request`/`_event`, `codex.user_prompt` (length; text only with `log_user_prompt`), `codex.tool_decision` (config or user), `codex.tool_result` (**includes an output snippet by default**). Metrics: `codex.api_request` (+`.duration_ms`), `codex.sse_event`, `codex.websocket.request`/`.event`, `codex.tool.call` (+`.duration_ms`), tags `auth_mode`, `originator`, `session_source`, `model`, `app.version`. `[analytics] enabled = false` also turns off custom OTLP metrics exporters | Managed config can pin `[otel]`; docs advise keeping `log_user_prompt = false` | | `read:` https://learn.chatgpt.com/docs/config-file/config-advanced, https://learn.chatgpt.com/docs/config-file/config-reference, https://learn.chatgpt.com/docs/enterprise/managed-configuration 2026-10-23 |
| Codex, managed | `/etc/codex/requirements.toml` (Linux, macOS), `%ProgramData%\OpenAI\Codex\requirements.toml` (Windows); legacy `managed_config.toml`; macOS MDM domain `com.openai.codex` keys `config_toml_base64`, `requirements_toml_base64`; locks `allowed_approval_policies`, `allowed_sandbox_modes` | Managed layers override `--config` | | `read:` https://learn.chatgpt.com/docs/enterprise/managed-configuration.md |
| MCP registry | Official registry (preview) stores `server.json` metadata (schema draft in the registry repo); not for private servers, "not designed for self-hosting"; an OpenAPI spec for others to implement; hosts should consume downstream registries | | | `read:` https://modelcontextprotocol.io/registry/about |
| OpenTelemetry | `OTEL_EXPORTER_OTLP_ENDPOINT` (http appends `/v1/<signal>`), `OTEL_EXPORTER_OTLP_HEADERS` (`k=v,k=v`), `OTEL_EXPORTER_OTLP_PROTOCOL` (`grpc`, `http/protobuf` default, `http/json`), per-signal overrides | | | `read:` https://opentelemetry.io/docs/specs/otel/protocol/exporter/ |
| Electron | `session.setProxy` modes `direct`, `auto_detect`, `pac_script`, `fixed_servers`, `system`; with no config Electron uses the system proxy | | | `read:` https://www.electronjs.org/docs/latest/api/structures/proxy-config, https://www.electronjs.org/docs/latest/api/session |
| macOS MDM | Configuration profile payload `com.apple.ManagedClient.preferences` with *Forced* values; apps read them through CFPreferences; `CFPreferencesAppValueIsForced` says the user cannot change a key and the UI should be disabled | | | `read:` https://developer.apple.com/documentation/devicemanagement/managedpreferences (search extract only) |

*Not read (general knowledge, to be checked before the phase that needs it):* electron-builder MSI/PKG/per-machine targets and
electron-updater generic feeds (the docs URLs tried returned 404); Chrome's exact Windows key and macOS plist path; Copilot CLI
proxy/CA support. Copilot CLI OTel and Claude Code's Bedrock/Vertex variables were read on 2026-10-23 (rows above), after Vikram's
comment on PR #575 linking the three vendors' OTel pages.

**What the research says for Durbar.** (1) Every product uses a root/admin-owned location per OS and a "machine beats user" order;
JSON on Linux, registry/MDM on Windows/macOS. A folder of JSON files works on all three today with no native code; registry and MDM
are a later source (FR-176, former A9). (2) Products disagree on a broken policy: VS Code ignores it, Claude Code refuses
to start. Durbar takes a third, visible path (FR-010). (3) Windows `C:\ProgramData` is writable by standard users for new folders;
Claude Code moved off it. Durbar's machine folder lives under `%ProgramFiles%` (FR-002). (4) The three agent apps already accept
proxy, CA, OTel and custom-model settings through environment variables or config overrides, so Durbar's job is to **pass** them into
the sessions it starts, not to reimplement them.

## Existing capabilities reused (AGENTS.md: look first)

| Need | Existing code path (reuse or extend, no parallel version) |
|---|---|
| Settings and their IPC | `src/main/settings.ts` `SettingsStore`, `src/shared/credits.ts` `AppSettings`/`parseSettings`, `src/main/ipc/settings.ts` `settings:get` (adds `about` today; adds `policy` here), `src/shared/api.ts` `AppSettingsView` |
| Display name and About | `src/shared/about.ts` (`aboutView`), `src/main/appmenu.ts` `MENU_APP_NAME`, window title `src/main/main.ts` (BrowserWindow and quit dialog), spec 008 FR-033/FR-034 (no `app.setName`; profile folder chosen in code) |
| Icons | `build/icon.{png,ico,icns,svg}`; `BrowserWindow` `icon`; `app.dock.setIcon` on macOS |
| Theme | `src/renderer/theme.js` (bundled ids, e.g. `clean-office`, `corporate`, `retro`), `src/shared/themes.ts` `checkUserManifest` and `USER_THEME_LIMITS`, `src/main/themes.ts` `UserThemeStore`, theme maker `src/shared/themegen.ts` / `src/main/ipc/themes.ts` (specs 035, 040, 070) |
| Agent apps | `src/adapters/descriptors.ts`, `src/adapters/registry.ts` `createRegistry`/`detectAll`, `src/main/ipc/adapters.ts` `adapters:list`, harness setup `src/main/harnesssetup.ts`, `src/main/ipc/harness.ts`, `src/renderer/harnesses.js` (spec 051) |
| MCP | `src/main/mcpfiles.ts`, global lists `src/main/mcpglobal.ts`/`mcpglobalio.ts`/`ipc/mcpglobal.ts` (spec 069), session controls `src/main/mcpsession.ts` (spec 058), extras `src/main/mcpstore.ts`/`mcpipc.ts`, folder setup `src/main/foldersetup.ts` (spec 061), the adapters' `mcpServers`/`disabledMcpServers` options (`copilot.ts`, `codexMcp.ts` `codexMcpConfig`, Claude `--strict-mcp-config`). The catalog idea is issue #539 |
| Agent profiles and skills | `src/main/profilefiles.ts` (`profileDirs`, `userAgentDirs`, `saveProfileFile`), `src/main/ipc/profiles.ts`, `src/adapters/claudeAgents.ts` (spec 043); skills and prompts discovery from spec 073 (PR #535, open) |
| Child process environment | Claude `src/adapters/claude.ts` `deps.env`; Codex `codexChildEnv` (`src/adapters/codex.ts`); Copilot `createClient()` in `src/adapters/copilot.ts` (inherits `process.env`; needs an `env` option); profile homes from spec 049 |
| Trust prompts | `src/main/agenttrust.ts` `AgentTrustStore`/`hashAgentFile`, folder setup dialog (spec 061), `askDialog` in `src/renderer/dialog.js` |
| Network fetch | none in main today for arbitrary URLs; use Electron `net.fetch` (Chromium stack: system proxy and OS certificate store) |
| Things that change settings from outside the window | Durbar MCP server (spec 041), remote control (spec 054), office assistant (spec 048): all must refuse a locked key (FR-016) |

Not present today (so nothing to reuse): an auto-updater (`package.json` `"publish": null`), a log file, time-based retention, a
stored default permission mode (the `#permMode` select chooses per folder), an app-wide remote-control switch, MSI/PKG/deb targets.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - IT rolls out a locked setup (Priority: P1)

Priya in IT copies a `managed` folder (policy, MCP list, icon, theme pack) to `C:\Program Files\AgentDurbar\managed\` on 400 laptops
with her usual software-deployment tool. Ana opens Durbar: the window says *Acme Agents*, the icon is Acme's, only Claude Code and
Copilot are offered, the MCP catalog lists Acme's servers first, and the theme picker is greyed with a lock and *Set by your
organization*. About still says *based on Agent Durbar* with the original credits.

**Independent Test**: simulator with `DURBAR_MANAGED_DIR=specs/076-managed-config/samples/managed` (dev hooks only): the window
title, the agent-app list, the theme and Settings > Organization match the sample; every covered control is disabled with the words.

**Acceptance Scenarios**:
1. **Given** the sample folder, **When** Durbar starts, **Then** the title is *Acme Agents* and About shows *Acme Agents, based on Agent Durbar* and the unchanged credits.
2. **Given** `agentApps.allowed: ["claude","copilot"]`, **When** Ana opens New session, **Then** Codex is not offered and Settings > Agent apps shows Codex as *Turned off by your organization*.
3. **Given** a locked theme, **When** Ana opens Settings > Look, **Then** the picker is disabled, shows a lock icon and *Set by your organization*, and Import / Make with AI are hidden when `allowUserThemes`/`allowThemeMaker` are false.

### User Story 2 - A broken policy fails safe and visibly (Priority: P1)

Priya's script truncates `policy.json`. Durbar starts with a red banner: *Your organization's settings could not be read
(policy.json, line 12: unexpected end). No agent can start or take a new message until this is fixed. Contact IT:
it-help@acme.example.* Ana can still read her agents, chats and history.

**Acceptance Scenarios**:
1. **Given** an unparseable or schema-invalid `policy.json`, **When** Durbar starts, **Then** closed mode (FR-011) applies and the banner names the file, the place and the error.
2. **Given** one invalid key in an otherwise valid file, **When** Durbar starts, **Then** only that key's area is put in its safe state (FR-012), the rest of the policy applies, and Settings > Organization lists the error.
3. **Given** the folder is fixed, **When** Ana chooses **Reload organization settings** (or restarts), **Then** closed mode ends.

### User Story 3 - The company's MCP list from an endpoint (Priority: P1)

Acme publishes `https://mcp-catalog.acme.example/durbar/mcp-servers.json`. With `mcp.mode: "allowlist"`, Ana's **Add an MCP server**
catalog shows only Acme's servers; a pasted config for an unknown server is refused with *Not on your organization's list*. A
folder's own `.mcp.json` server that is not on the list is shown in the folder dialog as *Blocked by your organization* and not
started. A server marked `required` is in every session and its switch is locked on.

### User Story 4 - Agents and skills from the company registry (Priority: P2)

Acme's registry index lists a *Code reviewer* agent profile and a *Release notes* skill. Settings > Agents and skills shows them with
**Install**. Two days later the index has version 1.5.0 of the reviewer; Durbar shows *Update available* (or, with `updates: "auto"`,
updates it and says so). A file whose SHA-256 does not match is refused. A skill that ships a script is never run by Durbar; the
script is listed and needs the user's tick the first time (FR-066).

### User Story 5 - Telemetry to the company's collector (Priority: P2)

With `telemetry.otel` set, every Claude Code, Codex and Copilot session Durbar starts exports to Acme's collector, with the
`Authorization` header taken from the `ACME_OTEL_AUTH_HEADER` environment variable. Settings > Organization says per agent app what
it exports (*Claude Code: metrics, logs; Codex: logs, metrics; Copilot CLI: metrics, traces (no logs signal)*). Prompt text is not
exported unless `logPrompts` is true, and then the chip says *with prompt text*; no other content is ever turned on by Durbar (FR-080a).

### User Story 6 - The company's own models (Priority: P2)

With `llm.claude.provider: "gateway"` and `baseUrl`, Claude Code sessions talk to Acme's gateway with the token from `ACME_LLM_TOKEN`;
Codex sessions use the `acme` provider. The model picker shows the configured model, locked. Costs and caps use the prices the admin
gave in `llm.pricing` (FR-106), so Ana's dollar cap still stops a runaway session. A model with no price shows *price unknown* rather than a
wrong number.

### Edge Cases

- The machine folder exists but is writable by a standard user (POSIX: not root-owned or group/world-writable). Durbar treats it as invalid (FR-005) and enters closed mode, because a user could otherwise loosen it.
- An icon that is not a PNG, too large or not square: the default icon is kept, the error is listed; the display name still applies.
- `agentApps.allowed` names no app that is installed: the office shows *No allowed agent app is installed. Contact IT* with the support link; nothing else breaks.
- A session that was started with an app that is now disallowed: it stays in the list, its history is readable, Send and Resume are disabled with *Turned off by your organization*.
- The MCP endpoint is down or slow: the last good copy (cached with its fetch time) is used and marked *Last updated 3 days ago*; with no copy yet, `allowlist` means no org servers are offered and user additions stay refused (fail closed).
- An endpoint redirects to `http://` or another host on a non-https scheme: refused.
- A registry file was edited by the user after install: the update does not overwrite it; it is flagged *Changed locally* with **Replace** and **Keep**.
- The user sets `ANTHROPIC_BASE_URL` in their own shell while a policy sets `llm.claude`: the policy value wins for Durbar's sessions.
- Two layers set the same key: the higher layer wins (FR-007); Settings > Organization shows the losing value as *overridden*.

## Requirements *(mandatory)*

### A. Config folder, format and precedence

- **FR-001 One folder, plain files.** Managed configuration is a folder holding `policy.json` (required when the folder exists) and
  any files it names by relative path: an MCP list (`mcp-servers.json`), icons, theme packs under `themes/<id>/`, a local registry
  index. Paths in `policy.json` are relative, may not be absolute, contain `..` or leave the folder (checked after resolving links).
- **FR-002 Machine folder per OS** (resolved in one pure function with an injected environment, constitution VI):
  - Windows: `<Program Files>\AgentDurbar\managed\`, where `<Program Files>` comes from `SHGetKnownFolderPath(FOLDERID_ProgramFiles)`
    (through `koffi`, which becomes a direct, pinned dependency: today it is only a transitive dependency of `@github/copilot-sdk`, 3.2.1; plan *Technical context*) and **never** from the `%ProgramFiles%` environment variable, which a user can set when
    starting the app. Not `%ProgramData%` (standard users can create folders there);
  - macOS: `/Library/Application Support/AgentDurbar/managed/`;
  - Linux: `/etc/agent-durbar/managed/`.
  The same path for an installed build and for a portable or AppImage build.
- **FR-003 User folder: off by default, narrow only.** `<appData>/AgentDurbar/managed/` per user (`appData` from Electron). It is read
  only when there is **no** machine policy, or the machine policy says `allowUserConfig: true` (default **false**). It uses the same
  format but may only make the effective policy **stricter**; it can never widen a machine value:
  - keys it may set: `agentApps.allowed` (intersected with the machine list), `agentApps.allowInAppInstall: false`, `mcp.mode` (only
    towards `off`: `open` < `allowlist` < `off`), `mcp.deny` (added), `mcp.allowFolderServers: false`, `permissions` (only lower),
    `caps` (only lower), `folders.blocked` (added), `features.*: false`, and `appearance` (cosmetic);
  - keys it may **not** set (machine only): `organization`, `branding`, `llm`, `telemetry`, `registries`, `secrets`, `network`,
    `signing`, `updates`, `legal`, `audit`, `dataRetention`, `signIn`, `allowUserConfig`, `allowDevHooks`, `mcp.lists`, `mcp.allow`.
    This includes every key under `network`, in particular **`network.trustedHosts`**: a user layer that sets it is refused with an
    error naming the key (it would let any process running as the user open private, proxied or unresolvable hosts to fetches and to
    MCP server URLs, FR-040, FR-120); the machine value stays (fixture `policy-user-trustedhosts`);
  - a key it may not set, or a value that would widen the machine value, is an error for that key: the key is ignored (the machine or
    default value stays) and the error is listed.
  Its controls are labelled **Set in your user config (not managed)**, never "your organization", and Settings > Organization says it is
  not tamper-proof. Support links, the organization name and the legal notice come only from the machine layer. (R1)
- **FR-004 Dev variables are ignored under a policy.** Today a packaged build honours every `DURBAR_*` hook when `DURBAR_DEV=1` is set
  (`src/main/devhooks.ts:13` `hooksEnabled`, by design for a user's own machine; this includes `DURBAR_DRIVER`, which `main.ts`
  `require`s as code in main, `DURBAR_USER_DATA` and `DURBAR_PERM`). When **any machine policy is present**, a packaged build ignores
  `DURBAR_DEV` and every `DURBAR_*` variable (`DURBAR_DRIVER`, `DURBAR_MANAGED_DIR`, `DURBAR_USER_DATA`, `DURBAR_PERM`, `DURBAR_SIM`, ...),
  unless the machine policy sets `allowDevHooks: true`; then the existing stderr warning stays and Settings > Organization shows
  *Developer hooks allowed by your organization*. `DURBAR_MANAGED_DIR` is never honoured by a packaged build, even with `allowDevHooks`.
  **"A machine policy is present"** means any of: the machine folder exists (whether or not `policy.json` parses or passes its trust
  check), a Windows `HKLM\SOFTWARE\Policies\ThreeFeathers\AgentDurbar` `PolicyJson` value exists, or a forced macOS managed preference
  `PolicyJson` exists (FR-176). A broken or untrusted machine policy (closed mode) counts as present, and `allowDevHooks` is honoured
  only from a machine policy that is valid and trusted.
  The machine folder is therefore resolved before `devEnv` is computed (plan D1). Without a machine policy, today's behaviour is unchanged.
  This is former A19, moved into P1.
- **FR-005 Folder trust check.**
  - POSIX: every file Durbar reads from the machine folder (including list files, icons and theme packs), the folder, its subfolders and
    **every parent directory up to `/`**, after `realpath`, must be owned by root (uid 0) and not group- or world-writable. Otherwise the
    layer is invalid (FR-010).
  - Windows: `fs.access` ignores ACLs, so Durbar probes as the running user: it opens `policy.json` with `r+` (no byte is written) and
    tries to create and delete a temp file (`wx`) in the folder and in each subfolder. If either succeeds, the folder is user-writable
    and the layer is invalid. When Durbar itself runs elevated the probe cannot tell; Settings > Organization then says *Folder write
    check skipped (running as administrator)*. `[KNOWN GAP]` a full ACL read (owner, inherited ACEs) needs native code and is not done.
- **FR-006 Format.** JSON (UTF-8, optional BOM, CRLF or LF), `version: 1`, validated against
  [samples/managed/schema/policy.schema.json](samples/managed/schema/policy.schema.json) (JSON Schema 2020-12). The schemas are
  published with the app and on the website. JSON is chosen because it needs no new dependency, maps onto the Windows registry and
  macOS plists later (FR-176), and is what VS Code, Chrome and Claude Code use. Unknown top-level keys are an error (a typo must not pass
  as "unset"); unknown keys inside an object are errors too (the schema is closed).
- **FR-007 Precedence, per key path:** machine folder > user folder (narrow only, FR-003) > the user's own setting in Durbar >
  Durbar's default. Lists are **not** merged across layers, except the user layer's narrowing lists (`mcp.deny`, `folders.blocked`),
  which are added, and `agentApps.allowed`, which is intersected. Session-level choices (a mode, a model, a cap) stay within the
  effective policy at all times.
- **FR-008 When it is read.** At start, before the first window and before any adapter starts; again on **Reload organization
  settings** (Settings > Organization) and when the folder changes (a file watcher, debounced to 2 s). A reload that tightens a rule
  applies to new sessions at once and to running sessions at their next launch or resume; a running session that now breaks a rule
  (a disallowed app, a disallowed MCP server) is marked *Restart needed by your organization's settings* and its Send is disabled
  until it is restarted. Durbar never kills a turn mid-way.
- **FR-009 Limits.** `policy.json` at most 256 KiB; each named file at most 1 MiB (theme packs keep `USER_THEME_LIMITS`); the folder
  at most 200 files and 20 MiB in total. Larger is an error (FR-010/FR-012).

### B. Validation and failure behaviour (fail safe and visibly)

- **FR-010 Whole-file failure fails closed.** For a layer that is in use (FR-003), `policy.json` missing while its folder exists,
  unreadable, not JSON, failing the trust check (FR-005), over the size limit, or with an unknown `version`: **closed mode** (FR-011).
  This holds for the user layer too when it is in use: a user who broke their own config sees the same banner, naming their file.
  (Q2, refined by the security review: closed, not merely Read-only; R3)
- **FR-011 Closed mode is at least as strict as the strictest valid layer.** No session starts, resumes or sends a new turn (a turn
  already running finishes; Durbar never kills one mid-way); every MCP server is stopped with its session's turn; in-app installs and
  updates, registry fetches and installs, remote control, the Durbar MCP server and schedules are off. Because no agent can act, no valid
  policy is looser than this. Agents, chats, history, usage and settings stay **readable**. A red, non-dismissable banner names the file,
  line and column when known, the error, and the support link or address from the machine layer when that layer could be read (else
  *Contact your IT department*). A fixed folder and **Reload organization settings** (or a restart) end it. A last-known-good copy is
  **not** used: it would live in the user's profile and could be edited (threat model; R3).
- **FR-012 Key-level failure takes that key's strictest state.** When the file parses but a key fails, only that key's area is
  affected, and its state is at least as strict as any valid value of that key; the rest applies:
  - `branding`, `appearance`: the default name, icon and theme, locked (cosmetic);
  - `agentApps`: no agent app starts; `permissions`: every session capped at Read-only;
  - `mcp`: no MCP server starts (`required` ones included) and none can be added;
  - `registries`: no fetch, install or update; installed items stay;
  - `telemetry`: the apps it names (all three if that cannot be read) do not start, because the organization asked for their activity
    to be exported and running them without it would break that;
  - `llm.<app>`: that app does not start; `llm.pricing` or `llm.tokenCap`: custom-model sessions do not start;
  - `caps`, `folders`, `audit`, `legal`, `network`, `signIn`: no session starts (the limit, the folder rule, the audit trail, the
    notice, the network path or the sign-in rule cannot be applied);
  - `features`: every switch in FR-158 off; `updates`: off; `signing`: everything that would need a signature is refused;
  - `secrets`: every `*FromEnv` reference is unresolved, so whatever uses one follows its own rule above;
  - `dataRetention`: nothing is deleted (deleting on a bad value cannot be undone);
  - `allowUserConfig`, `allowDevHooks`: false.
  Each failure is listed in Settings > Organization and in a yellow banner.
- **FR-013 Errors are readable and never echo a value.** Every message names the file, the JSON path (`/mcp/lists/1/url`) and what
  was expected, in plain words ("must start with https://"), never the offending value itself (it may be a secret pasted in the wrong
  place) and never a stack trace. The validator is a small, dependency-free module driven by the same rules as the published schemas.
  A test runs `ajv` (installed as a dependency of electron-builder; test only, never shipped) on the samples and on every fixture in
  [samples/hostile/](samples/hostile/) and asserts the verdict each fixture's `probes.json` row expects: `schema` rows are refused by
  both, `validator` rows (which need the source, the layer or another file) are refused by Durbar's validator. (plan D2)
### C. Locked UI

- **FR-014 Locked controls.** Every control a policy key covers is shown, disabled (`aria-disabled` and not focusable as an input),
  with a lock icon **and** the words *Set by your organization* (colour is never the only signal, constitution V). Hovering or focusing
  the words names the key (`agentApps.allowed`) and the layer (machine or user). Hidden is used only where the policy turns a feature
  off entirely (`allowThemeMaker: false` hides *Make with AI*); a short line says *Turned off by your organization* where the feature
  used to be, so a user knows why it is gone.
- **FR-015 Settings > Organization.** A page (shown only when a policy is in force, or in closed mode) with: the organization name and
  support links; each layer's folder, file hashes (SHA-256, first 12 hex) and load time; the effective value of every key and its
  source; overridden values; errors and warnings; per agent app what was passed (OTel on/off, custom model on/off, never a secret
  value); and **Reload organization settings**. This is the diagnostics view (like `chrome://policy`). **Copy as text** copies the
  same, with env-var names but no values.
- **FR-016 Every writer and every starter respects the policy.** Settings IPC, the Durbar MCP server (spec 041), remote control (spec
  054), the office assistant (spec 048), schedules (spec 044) and the command palette refuse a change to a locked key in main with the
  error *Set by your organization*. Sessions started or steered through specs 041, 054 and 048 are bound by the same rules as sessions
  started in the window (allowed apps FR-030, modes FR-017, MCP FR-042, caps, folders). The window is not trusted to enforce anything
  (constitution III).
- **FR-017 No key can widen a permission mode.** No policy key, in any layer, can raise a session above what the user chose or above
  Durbar's defaults: policy keys only cap modes (FR-150) and set a default that is never *Allow all* (FR-151). The schema has no value
  that means Allow all.
### D. Owner item 1: display name and icon

- **FR-020 Display name.** `branding.displayName` (1-40 characters, no control characters or `<`/`>`) replaces *Agent Durbar* in the
  window title, the quit dialog, the macOS app-menu labels (`MENU_APP_NAME`, display only), OS notifications' title and the first-run
  text. It never changes `app.setName`, the app id, the profile folder or the safeStorage key (spec 008 FR-033/FR-034; agent-notes:
  a name change makes a new macOS Keychain key and old MCP secrets stop decrypting).
- **FR-021 Original name kept.** About shows *<displayName>, based on Agent Durbar*, the version, the unchanged Three Feathers
  copyright, the contributors from `src/shared/about.ts` and the MIT licence; Help and the website link still point at the project.
  The test that keeps credits in step (`test:about`) also checks they are present under a policy name.
- **FR-022 Icon.** `branding.icon`: a square PNG, 256-1024 px, at most 1 MiB, checked by its header (magic bytes, width, height) before
  use. Applied to the window (`BrowserWindow` icon; Windows taskbar and Linux window), the macOS Dock at run time (`app.dock.setIcon`)
  and the About panel. `[KNOWN GAP]` installer, Start-menu shortcut, `.desktop` file, Finder and the macOS menu bar's bold app name
  come from the packaged app and do not change at run time; FR-184 (rebrand build) covers them.
- **FR-023 Theme words that name the app** (scene signs, the lobby) use the display name when set.

### E. Owner item 2: allowed agent apps

- **FR-030** `agentApps.allowed` (subset of `copilot`, `claude`, `codex`) filters `adapters:list` in main: a disallowed app is not
  detected, not offered in New session, the office assistant, profile AI, theme maker or *Continue VS Code chat*, and not started by
  schedules (a schedule for it is shown paused with *Turned off by your organization*). The simulator honours the same list.
- **FR-031** Settings > Agent apps lists a disallowed app with the lock line and no Install, Update or Sign-in button.
- **FR-032** `agentApps.allowInAppInstall: false` disables Install and Update in Settings > Agent apps (spec 051) for every app; the
  line says the IT department installs agent apps. Sign-in still works (it is the vendor's own flow).
- **FR-033** Existing sessions of a disallowed app follow FR-008 (readable, not resumable).

### F. Owner item 3: MCP lists (restrict and complement)

- **FR-040 Org MCP lists.** `mcp.lists` names up to 8 sources, each a local `file` in the machine folder or an https `url`, in one of
  two formats: `durbar-mcp-list-v1` ([schema](samples/managed/schema/mcp-list.schema.json), [sample](samples/managed/mcp-servers.json)),
  or `mcp-registry-v0.1` (an MCP registry implementing `GET /v0.1/servers`, the API GitHub's Copilot registry setting and VS Code use).
  Entries are de-duplicated by id (the first source wins) and shown in the MCP catalog of issue #539 under the organization's name,
  `recommended` ones first. **Complement**: users pick an org server instead of typing its command or URL.
  - **Commands only from the machine folder.** `stdio` entries (a `command`) are accepted only from a list **file in the machine
    folder**. A list fetched from a URL may carry only `http`/`sse` servers with `auth` `none` or `oauth`; a stdio entry, an env
    reference or `required` in a URL list refuses that entry with a listed error (a compromised endpoint must not be able to start a
    command anywhere).
  - **Server URLs from URL lists pass the fetch host rules.** Every `http`/`sse` URL from a URL list (both formats, v0.1 `remotes`
    included) must pass FR-120's host rules (https; no loopback, unspecified, link-local, multicast or metadata address; private ranges
    and names that do not resolve locally only for `network.trustedHosts`) when the list is loaded and again right before Durbar passes
    it to an agent app at session start; a refused entry is listed and never reaches an app. A tampered list therefore cannot point
    sessions at `127.0.0.1` or `169.254.169.254`. Entries from list files in the machine folder are the admin's own and are not
    address-checked.
  - **`mcp-registry-v0.1` mapping.** From each server, only `remotes[]` entries of type `streamable-http` or `sse` with an https URL
    are used (→ `http` / `sse`); `packages[]` (commands) are ignored; a remote that declares required headers or variables is listed as
    *Needs setup; not offered*. The id is the server `name` lower-cased with every character outside `[a-z0-9_-]` replaced by `-`, cut
    to 64; two names that map to one id are both refused. `description` and `version` are shown. At most 10 pages, 2 MiB per page,
    5 MiB and 500 servers in total.
- **FR-041 No secrets in a list; env references only from the machine folder.** An entry names a secret only by environment
  variable (`auth.valueFromEnv`, `env.X.fromEnv`), and only in a list file in the machine folder; the name must be in
  `secrets.envAllow` and bound there to the entry's host (`hosts`, for a header) or the entry's id (`mcpServers`, for a stdio
  environment) (FR-121a). Otherwise the entry is refused. A literal `Authorization` value, a URL with `user:pass@`, a query parameter
  named like a secret (`token`, `key`, `secret`, `password`, `sig`) or anything `redact.ts` detects is refused with the JSON path, never
  the value.
- **FR-042 Modes and matching.** `mcp.mode`:
  - `open` (default when only `lists` is set, Q6): users may add any server; `deny` still applies;
  - `allowlist`: only servers **defined in the org lists** (or matching an `allow` URL rule) can be added, accepted from a folder
    (spec 061) or started; the add form and *Paste a config* refuse others with *Not on your organization's list*;
  - `off`: no MCP server starts except `required` ones.
  `deny` always wins. Matching:
  - `allow` by `name` refers to an org list entry and matches only a server whose **definition equals that entry** (same transport
    and URL, or same command and arguments): a user's or a cloned repository's own server called `github` with another URL does not
    match;
  - `deny` by `name` matches any server with that name, and the org entry's definition;
  - `url`: exact, or a prefix ending in `/*`, compared after normalisation (scheme and host lower case, default port dropped);
  - `command`: base name without `.exe`, `.cmd`, `.bat`, `.ps1`; for the launchers `npx`, `bunx`, `pnpm dlx`, `yarn dlx`, `uvx` the
    package argument is matched with any `@version` removed. Deny by command is **best effort** (`[KNOWN GAP]`: a renamed binary, a
    wrapper script or another launcher gets past it); use `allowlist` when it must hold.
- **FR-043 Enforcement points**, all in main: the extras store (`mcpstore.ts`), global add and harmonize (spec 069, which also refuses to
  write a disallowed server into another app's file), folder setup (spec 061: a blocked server is listed as *Blocked by your
  organization* and not offered), the session start options (`startopts.ts`: every server Durbar knows about that is not allowed is
  passed as disabled: Copilot `disabledMcpServers`, Codex `mcp_servers.<n>.enabled = false`, Claude not passed at all since
  `--strict-mcp-config`), and the session MCP switches (spec 058/069; a required server's switch is locked on). **Every stdio server,
  whatever its source (the machine folder included), goes through the existing per-folder trust prompt** (spec 061, `AgentTrustStore`,
  keyed by a hash of its command, arguments and env names) before it first starts in a folder.
- **FR-044 Required servers.** `required: true` is honoured only on an entry from a **list file in the machine folder**; it adds the
  server to every session of the apps in its `apps` (default all), switch locked on. From a URL list or the user layer it is refused with
  a listed error. A required **stdio** server still needs the per-folder trust prompt (FR-043); if the user declines, it does not start
  in that folder, its row says *Required by your organization; not accepted in this folder*, and Settings > Organization lists it.
  Sessions still start (R8).
- **FR-045 `mcp.allowFolderServers: false`** turns off folder MCP servers (spec 061) for every folder, with the lock line in the folder
  dialog.
- **FR-046 Endpoint fetches** follow FR-120. A list is refreshed at start and every `refreshHours` (default 24); the catalog shows when
  it was last fetched and, when no signature was checked, *Unsigned list*. A fetch failure keeps the last good copy, re-validated on every
  start (a cached copy that fails validation, its hash or a required signature is dropped). With `signing.requireFor` containing
  `remoteMcpLists`, an unsigned or badly signed list is refused (FR-178). `[KNOWN GAP]` until an organization signs its lists, a
  tampered URL list in `allowlist` mode can offer an attacker's remote server (never a command, FR-040) (R2).
- **FR-047 Sample and schema** are part of this spec and are published with the docs: `samples/managed/mcp-servers.json` and
  `samples/managed/schema/mcp-list.schema.json`.

### G. Owner item 4: agent, profile and skill registry

- **FR-060 Sources.** `registries.items` (machine layer only) names up to 8 registries (an https `url` or a local `file` in the folder)
  serving an index in the format of [samples/managed/schema/registry-index.schema.json](samples/managed/schema/registry-index.schema.json)
  ([sample](samples/endpoint/registry-index.json)). Item kinds: `agent-profile` (spec 043), `skill` and `prompt` (spec 073), each for
  one agent app. `registries.allowUserRegistries` (default **false**) lets users add their own registry URL in Settings; a user registry
  goes through the trust step (FR-066) for every item. (Q1: "profile" means an agent profile file of spec 043.)
- **FR-061 Install.** **Install** downloads each file (FR-120 limits; at most 16 files, 256 KiB each) from a URL with the **same
  origin** (scheme, host, port) as its index, checks its SHA-256 against the index **before** writing, and writes it into the agent
  app's user-level place that Durbar already uses: Claude Code `<CLAUDE_CONFIG_DIR or ~/.claude>/agents/` and `.../skills/<id>/`,
  Copilot `~/.copilot/agents/` (and the skills and prompts places of spec 073 when it lands); Codex where spec 073 defines one, else *not
  supported* (`[KNOWN GAP]` until then). The install dialog says these files are also used when the app runs in a terminal (Q7, R5).
  Writes reuse spec 043's safe writer (temp file plus rename, owner-only mode). Paths are refused when they contain a Windows reserved
  name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9`, with or without an extension), a trailing dot or space, an empty, `.` or
  `..` segment, a drive letter or a backslash. A file that exists and was not installed by Durbar, or that another registry or item
  owns (FR-062), is never overwritten.
- **FR-062 Bookkeeping.** `<userData>/registry-installs.json` records per registry and item: registry, id, version, and for each file
  its path and installed SHA-256 (ownership). No content, no secrets. It is a user-editable cache (threat model): Durbar trusts it only
  to decide what it may overwrite or remove, and re-checks each file's hash before doing either.
- **FR-063 Change checks.** Each registry is checked at start and every `checkHours` (default 24, 1-168) with `If-None-Match`/
  `If-Modified-Since`. A newer `version` of an installed item shows *Update available* on Settings > Agents and skills and a quiet badge.
  `updates: "auto"` (machine layer only) installs it and posts a toast *Updated Code reviewer to 1.5.0*, but only for a registry given as
  a local `file` in the machine folder, or a URL registry whose index is signed with a key in `signing.publicKeys` (FR-178); the schema
  refuses `auto` on a URL registry, and a signed one is accepted by the validator. Otherwise updates are `notify` (Q8, R2).
- **FR-064 Local edits are kept.** Before an update, each installed file's current hash is compared with the recorded one; a file the
  user changed is not replaced; the item shows *Changed locally* with **Replace with 1.5.0** and **Keep mine**.
- **FR-065 Removal and deprecation.** An item removed from its registry, or `deprecated: true`, is marked *No longer offered* and is not
  removed by itself; **Uninstall** removes only files whose hash still matches what Durbar installed.
- **FR-066 Never run code from a registry.** Durbar never executes a downloaded file. An item is **powerful** when it holds anything other
  than Markdown or plain text (`.md`, `.txt`, `.json`, `.yaml`), or its front matter:
  - has no `tools` key on an agent profile (which means all tools), or lists tools that write or run commands;
  - for a skill, has `allowed-tools` with such tools; for a prompt file, `tools` with such tools;
  - sets `permissionMode`, `hooks` or `mcpServers`.
  A powerful item is shown in full before install, with the list of what it can do, and always needs the user's tick, whatever the
  registry. A plain item from a machine registry is trusted by the admin's choice (shown, no tick); from a user registry it needs the
  tick too. The tick is remembered per file hash (reusing `AgentTrustStore`); a new version is a new hash.
- **FR-067 Locked items.** An item from a machine registry may be marked managed: the profile editor (spec 043) opens it read-only with
  the lock line. Users can still copy it to a new profile.

### H. Owner item 5: OpenTelemetry

- **FR-080 One setting, mapped per agent app.** `telemetry.otel` (`endpoint` https, `protocol`, `signals`, `headersFromEnv`,
  `resourceAttributes`, `logPrompts` default false, `apps`) is turned into each app's own settings in the environment or config of
  the sessions Durbar starts. Durbar itself sends nothing. **The constitution III amendment (Q4) is a hard prerequisite: no P12 code merges
  before it.** Header variables must be in `secrets.envAllow` and bound to the endpoint's host (FR-121a). What each app can do, as read in
  its documentation on 2026-10-23 (research table):

  | | Claude Code | Codex | Copilot CLI (through the SDK) |
  |---|---|---|---|
  | Signals | metrics, logs; traces **beta** | logs (events), traces, metrics | traces, metrics (no logs signal) |
  | Protocols | `grpc`, `http/protobuf`, `http/json` | `otlp-http` (`binary`/`json`), `otlp-grpc` | `http/protobuf`, `http/json` (no gRPC) |
  | Where it is set | environment variables | `[otel]` config (no env variables) | SDK `telemetry` option plus env |
  | Prompt text | `OTEL_LOG_USER_PROMPTS` | `log_user_prompt` | only with all content (`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT`) |
  | Other content | responses, tool details, tool output, raw API bodies: separate flags, all off | `codex.tool_result` carries an **output snippet by default** | none unless all content is on |

  A `signals` or `protocol` value an app cannot honour is not approximated: that app's export stays off and Settings > Organization
  says why (*Copilot CLI does not support gRPC*; *Copilot CLI has no logs signal*). An app that gets at least one signal exports it.
- **FR-080a Content stays off unless the admin opts in, and the user sees it.** v1 has exactly **two** content switches: `logPrompts`,
  which means **prompt text only** (Claude Code, Codex), and `copilotAllContent`, which means **Copilot's full conversation** (R9,
  below). Nothing else turns content export on. For every app Durbar removes from the child environment every content flag the policy did not ask for,
  including ones the user set (FR-085). When `logPrompts` is true, the top-bar chip reads *Telemetry (with prompt text): <host>* and
  the first-start notice says so in its first line. An app that cannot export prompt text without exporting more (Copilot) does not
  export content because of `logPrompts`; the notice says *Copilot CLI: prompt text not exported (it can only export all content)*.
  **Copilot's full content only through `copilotAllContent`** (R9, owner 2026-10-23): a separate machine-only key
  `telemetry.otel.copilotAllContent: true`, independent of `logPrompts`, turns on Copilot's content capture
  (`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`, SDK `captureContent: true`). Then the chip reads *Telemetry (with all
  content): <host>* and the notice's first line says *Copilot CLI exports the full conversation: your prompts, its responses, the
  system prompt, and tool arguments and results*. Without the key Copilot exports no content, whatever `logPrompts` says.
- **FR-081 Claude Code** (all `read:` https://code.claude.com/docs/en/monitoring-usage 2026-10-23): `CLAUDE_CODE_ENABLE_TELEMETRY=1`;
  `OTEL_METRICS_EXPORTER=otlp` or `none` and `OTEL_LOGS_EXPORTER=otlp` or `none` for the signals chosen; for `traces`,
  `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` and `OTEL_TRACES_EXPORTER=otlp` (the notice says *traces: beta*);
  `OTEL_EXPORTER_OTLP_PROTOCOL` is **always** set (Claude Code has no default); `OTEL_EXPORTER_OTLP_ENDPOINT`;
  `OTEL_EXPORTER_OTLP_HEADERS` built from `headersFromEnv` with each value **percent-encoded** (the OTel format is `k=v,k=v`, so a `,`
  or `=` in a value must not split it), values read from Durbar's own environment at launch and never written to disk or logs;
  `OTEL_RESOURCE_ATTRIBUTES` from `resourceAttributes` (the schema refuses `,` and `=` in values; Durbar percent-encodes the rest as
  the docs require). Content: `OTEL_LOG_USER_PROMPTS=1` only when `logPrompts` is true, and then always `OTEL_LOG_ASSISTANT_RESPONSES=0`
  (unset, it follows `OTEL_LOG_USER_PROMPTS` and would export replies); `OTEL_LOG_TOOL_DETAILS`, `OTEL_LOG_TOOL_CONTENT`,
  `OTEL_LOG_RAW_API_BODIES`, `OTEL_LOG_MANAGED_SETTINGS`, every per-signal `OTEL_EXPORTER_OTLP_*_{ENDPOINT,HEADERS,PROTOCOL}` and
  `BETA_TRACING_ENDPOINT`/`ENABLE_BETA_TRACING_DETAILED` are removed from the child environment. Durbar does **not** use
  `otelHeadersHelper` (it runs a script; FR-122) and does **not** set `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` (it would make Claude
  Code ignore model pins in the organization's Claude managed settings, against FR-195). Claude Code's own managed-settings `env`
  still wins over what Durbar passes (FR-195).
- **FR-082 Codex** (`read:` https://learn.chatgpt.com/docs/config-file/config-reference and config-advanced 2026-10-23): config
  overrides on the thread, in the same way `codexMcpConfig` passes MCP overrides today: `logs` -> `otel.exporter`, `traces` ->
  `otel.trace_exporter`, `metrics` -> `otel.metrics_exporter`, each `{ otlp-http = { endpoint, protocol, headers } }` for
  `http/protobuf` (`protocol = "binary"`) or `http/json` (`"json"`), or `{ otlp-grpc = { endpoint, headers } }` for `grpc`; signals not
  chosen are `"none"`. For http the endpoint gets `/v1/logs`, `/v1/traces` or `/v1/metrics` appended (the docs' example gives the full
  path). `headers` carries the values read at launch (sent over the app-server pipe, never on a command line or in a file);
  `otel.log_user_prompt` from `logPrompts`. All of it is sent as a **structured** config object over the app-server protocol (like
  `codexMcpConfig`), never as concatenated `-c key=value` strings; if a command-line fallback is ever needed, each value is serialised
  by a TOML encoder (quoted and escaped) and passed as its own argument array element, never through a shell. Codex has no content switch for `codex.tool_result`'s output snippet, so the notice says
  *Codex: tool output snippets are exported*. `[KNOWN GAP]` until checked offline (T111): whether `codex app-server` accepts `otel.*` as a
  per-thread override (project config ignores `otel`; the CLI layer may set it), and the sub-keys of `metrics_exporter` (the reference
  lists `endpoint`/`protocol`/`headers` only for `exporter` and `trace_exporter`). If the override is refused, Durbar writes nothing to
  the user's `config.toml` and reports *Codex: set by your organization's Codex config* when `/etc/codex` already sets it, else *not
  supported from Durbar*. A user's `[analytics] enabled = false` turns off Codex's OTLP metrics; the notice says metrics may be missing
  for that reason.
- **FR-083 Copilot** (`read:` https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#opentelemetry-monitoring
  and the SDK observability page 2026-10-23; `read:` installed `@github/copilot-sdk` 1.0.22): the SDK client's `telemetry` option
  `{ otlpEndpoint, otlpProtocol, exporterType: "otlp-http", captureContent: false }` (the SDK turns it into `COPILOT_OTEL_ENABLED=true`,
  `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_PROTOCOL`, `COPILOT_OTEL_EXPORTER_TYPE`,
  `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=false`); `OTEL_EXPORTER_OTLP_HEADERS` (percent-encoded) and
  `OTEL_RESOURCE_ATTRIBUTES` through the same new `env` option on `createClient` as FR-102. `grpc` is not supported by Copilot CLI:
  export off for Copilot, said in Settings > Organization. Copilot exports traces and metrics together (no per-signal switch is
  documented); the notice says so when `signals` lists only one of them. `COPILOT_OTEL_FILE_EXPORTER_PATH` is removed from the child
  environment. An organization's Copilot managed `telemetry` object beats SDK config and env (FR-195). `[KNOWN GAP]` (T111): the bundled
  runtime exporting to a local fake collector on session start, checked without a prompt; if spans appear only after a turn, the check
  that needs a turn asks the owner first.
- **FR-084** A header variable that is missing from the environment at launch: that app's session does **not** start, with *Your
  organization's telemetry is not set up on this computer (ACME_OTEL_AUTH_HEADER is not set). Contact IT.* Durbar never starts without
  the export the organization asked for, and never exports without the header.
- **FR-085** User-level OTel variables already in the user's environment are left as they are when no policy sets `telemetry`; when a
  policy sets it, the policy's values replace them for Durbar's sessions: every `OTEL_*`, `CLAUDE_CODE_ENABLE_TELEMETRY`,
  `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA`, `COPILOT_OTEL_*` and `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` are removed and only
  the policy's values are set.
- **FR-086 Visible and honest.** While telemetry is in force, the top bar shows a chip *Telemetry: otel.acme.example* and each affected
  session's header shows it too; the first start after the policy appears (or after the endpoint, `logPrompts` or `copilotAllContent` changes) shows a notice
  naming the host and, per app, what that app exports according to its documentation (2026-10-23):
  - Claude Code: usage metrics (sessions, tokens, cost estimate, lines changed, commits, pull requests, active time, edit decisions) and
    events (prompts as length only, API requests and errors, tool results and decisions, MCP connections, hooks, compaction), with the
    account id, organization id and the account e-mail when known (the vendor default, kept as is and stated in the notice: *Claude
    Code sends your account id, organization id and e-mail with this data*; R11, owner 2026-10-23; no switch in v1, and
    `OTEL_METRICS_INCLUDE_ACCOUNT_UUID`, which affects metrics only, is a possible later key); prompt text only with `logPrompts`;
  - Codex: events (conversation start with model and sandbox policy, API requests, stream events with token counts, prompts as length
    only, tool decisions, tool results **with an output snippet**), metrics (request, stream and tool counts and durations); prompt text
    only with `logPrompts`;
  - Copilot CLI: traces (agent invocations, model calls, tool calls with token counts and AI units) and metrics (durations, token use,
    tool calls, lines changed); a pseudonymous user id; no content unless `copilotAllContent` is set, and then the full conversation
    (FR-080a, R9).
  The notice says that Durbar cannot filter or redact what an agent app exports itself.
### I. Owner item 6: theme

- **FR-090** `appearance.theme` is a bundled theme id or `{ "pack": "themes/<id>" }`, a data-only pack checked by `checkUserManifest`
  (spec 040, same limits; never code). The theme applies at start and the picker is locked (FR-014).
- **FR-091** `allowUserThemes: false` hides Import and the user themes list; `allowThemeMaker: false` hides *Make with AI* (spec 040).
  Without `appearance.theme`, these two keys still apply and the user picks among the remaining themes.
- **FR-092** A pack that fails the check: the default theme (Clean Office), locked, with the error listed (FR-012).
- **FR-093** Serious mode and density stay user choices unless a later key covers them.

### J. Owner item 7: custom LLM per agent app

- **FR-100 Claude Code.** `llm.claude.provider` (all `read:` 2026-10-23; pages in the research table):
  - `gateway`: `ANTHROPIC_BASE_URL=<baseUrl>` and `ANTHROPIC_AUTH_TOKEN` (Claude Code sends it as `Authorization: Bearer <value>`)
    taken at launch from the variable named in `authTokenFromEnv` (in `secrets.envAllow`, bound to the gateway's host, FR-121a);
  - `bedrock`: `CLAUDE_CODE_USE_BEDROCK=1`, `AWS_REGION=<region>` when set, `ANTHROPIC_BEDROCK_BASE_URL=<baseUrl>` when set; credentials
    from the AWS SDK chain (profile, SSO, workload identity), or `AWS_BEARER_TOKEN_BEDROCK` from `authTokenFromEnv` when the admin names
    one (then the chain is not used);
  - `vertex` (Google Cloud's Agent Platform, formerly Vertex AI): `CLAUDE_CODE_USE_VERTEX=1`, `CLOUD_ML_REGION=<region>` (e.g.
    `global`), `ANTHROPIC_VERTEX_PROJECT_ID=<projectId>` (Claude Code uses it even when `GOOGLE_CLOUD_PROJECT` differs),
    `ANTHROPIC_VERTEX_BASE_URL=<baseUrl>` when set; credentials from Google Application Default Credentials;
  - models for every provider: `ANTHROPIC_MODEL` from `model`, `ANTHROPIC_DEFAULT_HAIKU_MODEL` from `smallFastModel`
    (`ANTHROPIC_SMALL_FAST_MODEL` is deprecated and is not set).
  - `foundry` (Microsoft Foundry; R10, owner 2026-10-23): `CLAUDE_CODE_USE_FOUNDRY=1`, `ANTHROPIC_FOUNDRY_RESOURCE=<resource>` or
    `ANTHROPIC_FOUNDRY_BASE_URL=<baseUrl>` (one is required), and `ANTHROPIC_FOUNDRY_API_KEY` from `apiKeyFromEnv` or
    `ANTHROPIC_FOUNDRY_AUTH_TOKEN` from `authTokenFromEnv` (at most one; each name in `secrets.envAllow`, bound to the Foundry host).
    With neither, Claude Code's own Azure credential handling applies; `[KNOWN GAP]` which Azure credential chain that is, until
    checked in T100. Durbar does not set `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` (FR-081).
- **FR-100a No fallback to the vendor.** When a policy sets a provider for an app, the user's own credentials and provider switches for
  that app are **removed** from the child environment (Claude: `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, `AWS_BEARER_TOKEN_BEDROCK`
  and any `ANTHROPIC_*`, `CLAUDE_CODE_USE_*`, `CLAUDE_CODE_SKIP_*_AUTH`, `CLOUD_ML_REGION` and `VERTEX_REGION_CLAUDE_*` the policy did not
  set; Codex: `OPENAI_API_KEY` and `CODEX_API_KEY` unless one is the provider's `env_key`, `CODEX_ACCESS_TOKEN`; Copilot: any
  `COPILOT_PROVIDER_*` the policy did not set and `COPILOT_PROVIDER_API_KEY_COMMAND` (a shell command); the user's
  `COPILOT_PROVIDERS_CONFIG` is replaced by a Durbar-owned path holding no providers, so a user `~/.copilot/providers.json`, which would
  take precedence over the env provider, is not read; `[KNOWN GAP]` until T100 checks that an empty registry falls back to the env
  provider), and a missing token variable stops the session from starting
  with *Your organization's model is not set up on this computer (ACME_LLM_TOKEN is not set)*. A session never silently falls back to
  the public endpoint. The session header shows *Model: <provider name> (<host>)*, and the first start after the policy appears shows a
  notice naming the host.
- **FR-101 Codex.** `llm.codex.provider` becomes `model_providers.<id>` (`name`, `base_url`, `env_key` = `apiKeyFromEnv`, `wire_api =
  "responses"`) and `model_provider = <id>` plus `model` as **structured** thread config overrides (same rule as FR-082: no
  concatenated `-c` strings; a TOML-encoded, argument-array fallback only), never written into the user's
  `config.toml`. Model ids match `^[A-Za-z0-9._:/@+-]{1,128}$` in the schema, so a value cannot carry quotes, `=` or new lines.
  Reserved ids (`openai`, `ollama`, `lmstudio`) are refused. **Codex's built-in Bedrock provider** (R10, owner 2026-10-23):
  `llm.codex.bedrock` (`region` required, `profile` optional, an AWS profile name, not a secret) sets `model_provider =
  "amazon-bedrock"` with `aws.region`/`aws.profile`, structured like the rest; credentials come from the AWS SDK chain; `provider` and
  `bedrock` cannot both be set (schema). Both new providers are custom-provider sessions for pricing and caps (FR-106..FR-109). `[KNOWN GAP]` until T100: the
  app-server accepting `model_providers` as a per-thread override (project config ignores it; the CLI layer may set it).
- **FR-102 Copilot (BYOK).** `COPILOT_PROVIDER_BASE_URL`, `COPILOT_PROVIDER_TYPE`, `COPILOT_PROVIDER_API_KEY` or
  `COPILOT_PROVIDER_BEARER_TOKEN` (from the named variables), `COPILOT_PROVIDER_AZURE_API_VERSION`, `COPILOT_MODEL`, and
  `COPILOT_OFFLINE=true` when `offline` is set, passed through the SDK client's `env` option on `createClient` (confirmed in the installed
  SDK 1.0.22: it is the runtime child's environment). `[KNOWN GAP]` until T100: the SDK-started (`--headless`) runtime reading the
  `COPILOT_PROVIDER_*` variables like the interactive CLI (no prompt needed: the model list and the error on a dummy endpoint show it).
- **FR-103 Locked model.** When a policy sets a model, the model picker (spec 030) shows it locked; switching is refused in main.
- **FR-104 Costs.** A session on a custom provider is priced from `llm.pricing` (FR-106). Its cost appears in Cost views, usage totals
  and caps exactly like a vendor-priced session, in the pricing's currency. A session whose model has no matching price shows *price
  unknown* in Cost views and usage totals (its tokens are still counted and shown) and follows FR-108. Durbar never guesses a price.
  (Q10, changed by the owner 2026-10-23)
- **FR-105 Sign-in checks.** Durbar's sign-in check (spec 012 `authcheck.ts`) treats an app with a policy provider as *Using your
  organization's model* instead of asking the user to sign in to the vendor.

- **FR-106 Token pricing in the policy.** `llm.pricing` gives per-model prices for custom models:
  `currency` (ISO 4217 code, e.g. `USD`, `EUR`) and `models`, a list of up to 100 entries, each with
  `match` (a model id, exact or a glob with `*` and `?`, matched case-insensitively against the model id the session reports, else
  the configured model), `inputPer1M`, `outputPer1M`, `cachedInputPer1M` and an optional `reasoningPer1M` (price per one million
  tokens; when `reasoningPer1M` is absent, reasoning tokens are priced as output). Matching: the first entry whose `match` equals the id
  exactly wins; otherwise the first glob that matches, in list order. Cost of a turn = input x inputPer1M + cached input x
  cachedInputPer1M + output x outputPer1M + reasoning x reasoningPer1M, divided by 1,000,000, using the token counts the adapter
  reports in its `usage` events (spec 011). Locked in the UI: Cost views show *Price set by your organization* next to the rate, and no
  control edits it (FR-014, FR-016).
- **FR-107 Validation of pricing.** Every price is a finite number, at least 0 and at most 10,000 per 1M tokens; `currency` matches
  `^[A-Z]{3}$`; `match` is 1-128 characters of letters, digits, `.`, `-`, `_`, `:`, `/`, `@`, `*` and `?`; duplicate `match` values are an
  error; `maxTokensPerSession` (FR-108) is an integer from 1,000 to 1,000,000,000. A failure makes `llm.pricing` invalid as a whole and
  custom-model sessions do not start (FR-012, fail closed; changed after the security review: a broken price list must not silently
  remove the caps it was there to keep); the error is listed. Durbar does not keep part of a broken price list.
- **FR-108 Caps on custom models.**
  - *With a price:* the user's, folder's and default caps (spec 011) work as usual. A cap in the same currency as the pricing is
    enforced on the computed cost. A cap in another unit (AI credits, or dollars when the pricing is in euros) is not converted: it is
    shown as *not available for this model (priced in EUR)* and the session runs under the token cap if one is set.
  - *Without a price:* a cap that needs a price cannot be computed. Durbar says so before the session starts (*No price for model
    acme-coder: your spending limit cannot be applied*) and on the session's cap chip, and the session runs **without** that cap
    unless the admin set one of the two rules below. Durbar never silently treats an unpriced model as free.
  - *Forced token cap:* `llm.tokenCap.maxTokensPerSession` caps every custom-model session at that many tokens (input + cached input +
    output + reasoning, as reported), whether or not it has a price; with `llm.tokenCap.force: true` it is also the only cap a user can
    see for those sessions (locked), else the lower of the two applies when both exist. It is enforced on the same path as spec 011's
    caps: checked on each `usage` event; when reached, the turn is stopped where the adapter can interrupt (else at the end of the turn,
    `[KNOWN GAP]` per adapter as in spec 011) and the next Send is refused with *Token limit set by your organization reached*.
  - *Require a price:* `llm.requirePricing: true` refuses to start (or resume) a custom-model session whose model has no price, with
    *Your organization has not set a price for model X; contact IT*.
- **FR-109** Pricing and token caps apply only to sessions on a custom provider (`llm.claude`, `llm.codex`, `llm.copilot`). Vendor-priced
  sessions keep the vendor's prices and spec 011's behaviour.

### K. Security (constitution III)

- **FR-120 Fetching.** Every fetch (MCP lists, registry indexes and files, the update feed) runs in main with Electron `net.fetch` on a
  dedicated, **non-persistent, cookie-less session partition** (`credentials: 'omit'`, no cache shared with the window, no ambient
  NTLM/Kerberos to endpoints: `allowNTLMCredentialsForDomains('')` on that session; the only endpoint credential is FR-190's bearer
  token; authentication **to the proxy** is FR-155's). Rules:
  - `https:` only, at most 3 redirects, each hop `https:` and re-checked;
  - before each hop the host is resolved and refused if any address is loopback (`127.0.0.0/8`, `::1`), unspecified, link-local
    (`169.254.0.0/16`, `fe80::/10`), multicast, or a cloud metadata address (`169.254.169.254`, `fd00:ec2::254`, `100.100.100.200`);
    private ranges (`10/8`, `172.16/12`, `192.168/16`, `100.64/10`, `fc00::/7`) only for hosts listed in `network.trustedHosts`
    (machine layer). `[KNOWN GAP]` DNS rebinding between this check and Chromium's own resolution; the partition has no resolver
    pinning;
  - **behind a proxy** (`session.resolveProxy(url)` is not `DIRECT`, which includes most PAC setups), the proxy connects, so Durbar
    cannot see the final address: an IP-literal host and the names `localhost`, `*.localhost`, `*.local` and known metadata names
    (`metadata.google.internal`, `metadata`) are always refused; a name that resolves locally is checked as above; a name that does
    **not** resolve locally is allowed only when it is in `network.trustedHosts` (the admin vouches for it), else refused with
    *Cannot check this address behind your proxy; your IT department can add it to network.trustedHosts*. The same rule applies to
    MCP server URLs from URL lists (FR-040);
  - 10 s connect and 30 s total timeout; size caps enforced while streaming (lists and indexes 2 MiB, registry files 256 KiB,
    `mcp-registry-v0.1` 2 MiB per page, 10 pages, 5 MiB in total);
  - `Accept: application/json`, no credentials in the URL, no `Authorization` header unless FR-190 applies;
  - responses are parsed with the same validators and scanned with `redact.ts` (FR-121), never evaluated.
  The last good copy is cached under `<userData>/managed-cache/` with its fetch time, hash and (when signed) signature; it is a
  user-editable cache, re-validated on every use, and never able to widen the policy.
- **FR-121 No secrets in config files.** No schema field takes a secret value. Secrets are named by environment variable (`*FromEnv`)
  or come from the agent app's own sign-in or the OS credential store it uses. Secret detection **reuses `src/shared/redact.ts`** (which
  already covers GitHub `ghp_`/`gho_`/`ghs_`/`ghr_`/`github_pat_`, JWTs, GitLab `glpat-`, PEM blocks and more) rather than a second list,
  and runs on every managed file and every remote response; a hit is an error naming the JSON path. Values read from env vars at launch
  are passed only to the child process, never stored, logged, sent to the window or shown; Settings > Organization shows the variable
  name and *set* / *not set*, and MCP `env` values are masked with `mcpmask`. **Helpers, named once:** in main, `src/shared/redact.ts`
  (detection and redaction) and `src/main/mcpmask.ts` (MCP env and headers); for organization or remote text shown in the window (names,
  descriptions, notices, errors), `DurbarSafeText` (PR #567) if it has merged when the phase is built, otherwise today's renderer path
  (text inserted as text, never as HTML; Markdown only through the sanitised renderer of spec 016). `[KNOWN GAP]` a secret passed in a child's environment can
  be read by that agent's own shell tool (for example `env`); this is how the agent apps take credentials, and the docs say so.
- **FR-121a Env names are allow-listed and bound.** Only names in the machine layer's `secrets.envAllow` may be referenced by any
  `*FromEnv` field, anywhere. Each entry binds the name to the exact hosts (`hosts`, `host[:port]`) its value may be sent to (an MCP
  header, an OTLP header, an LLM gateway, an endpoint token) or to stdio MCP server ids (`mcpServers`). A reference to an unlisted
  name, or to a listed name for another host or server, is an error for that key or entry. A URL list never references env vars
  (FR-041).
  **The destination host** of each reference is the host of the URL it goes with (`baseUrl`, a server `url`, the OTLP `endpoint`, the
  list or registry `url`). Where a field has no URL, the host is **derived only from a documented pattern**, else a URL is required:
  - Claude `foundry` with `resource` and no `baseUrl`: `<resource>.services.ai.azure.com` (`read:`
    https://code.claude.com/docs/en/microsoft-foundry.md 2026-10-23: Claude Code builds the endpoint from the resource name, example
    `ANTHROPIC_FOUNDRY_BASE_URL=https://{resource}.services.ai.azure.com/anthropic`, and refuses a URL or host name in
    `ANTHROPIC_FOUNDRY_RESOURCE`). Reliable: the resource name is a single DNS label (schema pattern), so the host is fixed by it.
  - Claude `bedrock` with `authTokenFromEnv` and no `baseUrl`: `bedrock-runtime.<region>.amazonaws.com` and
    `bedrock.<region>.amazonaws.com` (`read:` https://docs.aws.amazon.com/general/latest/gr/bedrock.html 2026-10-23, the regional
    endpoint list; https://code.claude.com/docs/en/amazon-bedrock.md 2026-10-23, example
    `ANTHROPIC_BEDROCK_BASE_URL=https://bedrock-runtime.us-east-1.amazonaws.com`). This needs `region` in the policy (the schema requires
    `region` or `baseUrl` when a token is named): without it the region would come from the user's AWS configuration, which the user
    controls. Regions outside the standard `amazonaws.com` partition (`cn-*`, `us-gov-*`) and FIPS endpoints need an explicit `baseUrl`,
    because their host names differ. `[KNOWN GAP]` which of the two hosts Claude Code sends the token to is checked in T100.
  - Everything else that names a variable has a URL (`gateway`, Codex `provider`, Copilot BYOK, MCP headers, OTLP, endpoint tokens).
  Chosen this way, rather than always requiring `baseUrl`, because both patterns are documented and fixed by values the schema already
  constrains; anything outside them falls back to requiring `baseUrl`. Fixtures: `policy-foundry-wrong-host`,
  `policy-bedrock-wrong-host`, `policy-bedrock-token-no-region`.
- **FR-122 Nothing runs from the folder or a registry.** Durbar never executes a file from the managed folder, a list or a registry.
  `command` entries in MCP lists are started like any other stdio MCP server (no shell, argument array, spec 019), only after they pass
  FR-042 and the existing trust steps.
- **FR-123 Paths stay inside.** Every relative path in the policy and every registry `path` is resolved and checked to stay inside its
  folder (no `..`, no absolute path, no drive letter, no backslash, links resolved with `realpath` before the check).
- **FR-124 Children get only what they need.** Policy env vars are added per app (Claude's to Claude, Codex's to Codex); Codex keeps
  `codexChildEnv`'s stripping of other tools' credentials.
- **FR-125 Read-only for the window.** The policy is computed in main; the window gets a view (values, sources, errors) with secret
  variable values never included; all checks happen in main.
### L. Windows, macOS and Linux parity (constitution VI)

- **FR-130** Folder paths (FR-002/FR-003), the trust check (FR-005), icon handling (FR-022) and env injection are pure functions with an
  injected platform, tested for all three from any OS. macOS Dock icon and Windows taskbar behaviour are `[KNOWN GAP]` (not run on a real
  Mac or Windows PC) until a person checks them; the Windows ACL check is `[KNOWN GAP]` (FR-005).
- **FR-131 Honest scope.** Durbar's policy governs what Durbar does and the sessions Durbar starts. A user with a terminal can still run
  `claude`, `copilot` or `codex` directly; for that, the docs point admins to each vendor's own managed settings (Claude Code
  `managed-settings.json` / `managed-mcp.json`, Codex `requirements.toml`, GitHub Copilot enterprise policies). Settings > Organization
  shows when a vendor's own managed file exists on the machine (FR-194).
- **FR-132** The sample folder is valid on all three (forward slashes in relative paths; Durbar accepts `/` on Windows).

### N. Additions accepted by the owner (Vikram, 2026-10-23: "I agree to add all those")

The former *Proposed additions* A1-A19, in the build order of Q12 (A1, A2, A5, A4, A3, then the rest). Every rule above applies to them
too: machine layer only unless FR-003 lists the key as narrowing, https and FR-120 for every fetch, env names only through FR-121a,
fail closed per FR-012, locked UI per FR-014.

**A1 Permission mode lock**
- **FR-150** `permissions.maxMode` (`read-only` or `ask`) caps every session, in every starter (FR-016): the mode menu shows higher
  modes disabled with the lock line; a stored folder mode above the cap is clamped at session start and shown as *Capped by your
  organization*; switching above it is refused in main. Spec 054's existing rule (no remote control in Allow all) still applies.
- **FR-151** `permissions.defaultMode` (`read-only` or `ask`, never Allow all, FR-017) is the preselected mode for new folders;
  `permissions.allowAll: false` removes Allow all everywhere (implied when `maxMode` is set). The user layer may only lower these.
- **FR-152** Grants "approve for this session" (constitution III) stay as they are within the capped mode; a cap of `read-only` denies
  every grant request, like Read-only does today.

**A2 Proxy and custom CA**
- **FR-155** `network.proxy` sets Durbar's own session proxy (`system` default, `pac` with an https `pacUrl`, `fixed` with `server`
  and `bypass`, `direct`) through `session.setProxy` for the window's session and the fetch partition (FR-120), and passes
  `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` to the agent apps (for `pac`, the apps get the proxy Chromium resolves for their endpoint at
  launch; `[KNOWN GAP]` a PAC that picks different proxies per URL is approximated). No proxy credentials in config. **Proxy**
  authentication (an HTTP 407) is negotiated by Chromium with the OS (Kerberos/NTLM/Negotiate) for the proxy only; endpoints never get
  ambient credentials (FR-120, FR-191). `[KNOWN GAP]` that `allowNTLMCredentialsForDomains('')` leaves proxy authentication working is
  to be checked in T090 against a local authenticating test proxy.
- **FR-156** `network.caCertFile` (a PEM bundle in the machine folder, certificates only: a private key block is an error) is passed as
  `NODE_EXTRA_CA_CERTS` to every agent app; `network.useSystemCertStore` (default true) sets `CLAUDE_CODE_CERT_STORE=bundled,system` for
  Claude Code and the equivalent where an app documents one. Durbar's own fetches use the OS store through Chromium; a CA in the bundle
  is not added to Chromium (`[KNOWN GAP]`: install it in the OS store, which IT does anyway).
- **FR-157** `network.clientCert` (mTLS) passes `CLAUDE_CODE_CLIENT_CERT`/`CLAUDE_CODE_CLIENT_KEY` as paths in the machine folder and
  the passphrase only by env name (FR-121a). Other apps: `[KNOWN GAP]` until their docs are read. The key file must pass FR-005 and be
  readable only by admins and the user group IT chooses; Durbar never copies it.

**A5 Feature switches**
- **FR-158** `features.<name>: false` turns off, in main and in the window (hidden with *Turned off by your organization*):
  `remoteControl` (spec 054), `durbarMcpServer` (spec 041), `officeAssistantModel` (spec 048's model layer; the free local layer stays),
  `profileAi` (spec 043 Create with AI), `themeMaker` (spec 040, same as `appearance.allowThemeMaker`), `vscodeChat` (specs 009/056),
  `chatChannels` (future chat channels such as Telegram, idea 485: any such feature must read this switch from its first version),
  `scheduledPrompts` (spec 044), `agentAppUpdateCheck` (spec 081: the update check for the agent apps). A running remote-control link or MCP server stops at once when its switch turns off on reload.
- **FR-159** Every new feature that sends data off the machine or lets something outside the window act must add a switch here in its
  own spec (a rule for future specs, checked in review).

**A4 Installers and silent, per-machine install**
- **FR-160** Release builds add a Windows MSI (electron-builder `msi`, per-machine) or an NSIS per-machine installer with documented
  silent flags (`/S`, `/D=`), a macOS `.pkg` (installable by MDM), and Linux `.deb` and `.rpm` next to the AppImage. Which Windows format
  is chosen is decided in the implementing phase after reading electron-builder's docs (`[KNOWN GAP]` today: the docs URLs returned 404).
- **FR-161** Each installer can lay down the `managed` folder from a path given at install time (MSI property / NSIS switch / pkg
  choice), with admin-only permissions (FR-005).
- **FR-162** Air-gapped use: Durbar needs no network to start; agent apps come from IT (`agentApps.allowInAppInstall: false`); the docs
  list each app's offline install source. Durbar's own update check is off with `updates.mode: "off"` (FR-174).

**A3 Code signing and notarization**
- **FR-164** Release builds are signed on Windows (Authenticode) and signed and notarized on macOS (spec 014), so AppLocker/WDAC,
  Gatekeeper and endpoint tools can allow them by publisher, and MDM can deploy the `.pkg`. **The certificate purchase needs Vikram's
  explicit OK at purchase time** (`needs-owner-approval`, constitution I); no account is created and nothing is bought before that.
- **FR-165** Linux packages are signed (repository or detached signatures) and the release lists SHA-256 sums; spec 014 owns the details.

**A6 Spend caps**
- **FR-170** `caps.maxSessionAiCredits` / `caps.maxSessionUsd` cap every session's cap (a user may set lower, not higher);
  `defaultSessionAiCredits` / `defaultSessionUsd` set the default (locked); `requireCap: true` means no session starts without a cap it
  can enforce (a vendor price, an `llm.pricing` price, or `llm.tokenCap`). Units follow spec 011 and FR-108 (no conversion).
- **FR-171** `caps.dailyUsd` / `caps.monthlyUsd` stop new turns once the user's usage totals (spec 011 totals, kept per day and month)
  reach the limit, with *Your organization's daily limit is reached*. `[KNOWN GAP]` totals are per machine and per Durbar profile, not
  per person across machines.

**A7 Allowed and blocked folders**
- **FR-172** `folders.allowedRoots` (absolute paths, `~/` or `%USERPROFILE%\`) and `folders.blocked` (globs; blocked wins) are checked in
  main when a folder or workspace is added and at every session start, after `realpath`, case-insensitively on Windows and macOS. A
  refused folder says which rule refused it. `~/` and `%USERPROFILE%\` are expanded from the **OS account record, never from the
  environment** (a user could start the app with `USERPROFILE=C:\` or `HOME=/`): `os.userInfo().homedir`, not `os.homedir()`.
  `read:` https://nodejs.org/api/os.md (2026-10-23): "The value of `homedir` returned by `os.userInfo()` is provided by the operating
  system. This differs from the result of `os.homedir()`, which queries environment variables for the home directory before falling
  back to the operating system response"; and `os.homedir()` "On Windows ... uses the `USERPROFILE` environment variable if defined".
  `real:` on Linux (Node 24, 2026-10-23) `HOME=/tmp` changed `os.homedir()` but not `os.userInfo().homedir`. **`[KNOWN GAP]`
  unverified on Windows and macOS:** that `os.userInfo().homedir` ignores `USERPROFILE` (and `HOME`) there is taken from the Node docs
  only, not run; T137 checks it on the Windows and macOS CI runners with the variables overridden. If Windows does not hold, the
  fallback is `SHGetKnownFolderPath(FOLDERID_Profile)` through `koffi`. A root that would cover a drive or filesystem root after expansion is an error.
- **FR-173** `[KNOWN GAP]` an agent app's own tools can still reach outside its folder unless its sandbox enforces it; Durbar passes the
  blocked paths to apps that accept deny rules (Claude Code permission deny rules, Codex sandbox writable roots) where documented, and
  says so per app on the Organization page.

**A8 Updates**
- **FR-174** `updates.mode` (`off`, `notify`, `auto`) and `updates.feedUrl` (https, FR-120) govern Durbar's own updater from its first
  version; there is none today, so this key is reserved and listed as *No updater in this version* until one exists. `auto` with a
  `feedUrl` needs the updater to verify the package signature (FR-164).
  `updates.mode: "off"` also turns off spec 081's agent-app update check (the start check, the *Check for updates* button, the per-card *Check*, the *Latest* lines and the start-check switch; owner decision Q6 = A, delta 2026-10-25). A value that is not `off`, `notify` or `auto` is treated as `off` (fail closed).
- **FR-175** Agent-app updates follow `agentApps.allowInAppInstall` and the version range (FR-188).

**A9 OS-native policy sources**
- **FR-176** Windows: `HKLM\SOFTWARE\Policies\ThreeFeathers\AgentDurbar`, value `PolicyJson` (REG_SZ, the same JSON as `policy.json`;
  files it names are still read from the machine folder), with ADMX/ADML templates for Group Policy and Intune. `HKCU` is the user
  layer (narrow only). macOS: managed preferences domain `io.github.three-feathers.agentdurbar`, key `PolicyJson`, read through
  CFPreferences, honoured only when `CFPreferencesAppValueIsForced` is true (a value the user can change is the user layer). Linux:
  the folder only.
- **FR-177** Precedence: registry/MDM > machine folder > user layer, per key path. Both sources go through the same validator and the
  same fail-closed rules; Settings > Organization names the source (*Group Policy*, *MDM profile*, *folder*).

**A10 Signed config and lists**
- **FR-178** `signing.publicKeys` (Ed25519, up to 4, for rotation) and `signing.requireFor` (`remoteMcpLists`, `registries`,
  `userLayer`). A signed file has a detached `<file>.sig` (base64 Ed25519 over the exact bytes) next to it (for URLs, `<url>.sig`, same
  origin). When a kind is required, an unsigned or badly signed one is refused and listed; when signed, `updates: "auto"` is allowed for
  URL registries (FR-063). Verification uses Node `crypto` (no new dependency).
- **FR-179** Key rotation: any listed key verifies; a removed key stops verifying at the next reload. The keys live only in the machine
  layer.

**A11 Audit log**
- **FR-180** `audit.enabled` writes a local append-only JSONL under `<userData>/audit/` (one file per day): approvals, denials, mode
  changes, grants, MCP servers added, accepted, blocked or started, registry installs, policy reloads and errors, session starts with
  their app and provider host; prompt text only with `includePromptText`. **Every field is passed through `src/shared/redact.ts`
  before it is written** (commands, paths, URLs and prompt text can hold tokens), and MCP env values through `mcpmask`. Each line holds
  a hash of the previous one so truncation and edits are detectable (not prevented: a user-writable file, threat model). Kept
  `retentionDays`. **Visible like telemetry (FR-086):** while it is on, the top bar shows *Audit log on* (*Audit log on (with prompt
  text)* when `includePromptText`), and the first start after it is turned on (or after `includePromptText` changes) shows a notice
  saying what is recorded, where, and for how long.
- **FR-181** Export: Settings > Organization **Export audit log** (a date range, JSON Lines). `audit.exportOtel` also sends the same
  events as OTel logs to `telemetry.otel` from Durbar itself, which needs its own constitution amendment (beyond Q4) before it is built.

**A12 Data retention and locations**
- **FR-182** `dataRetention.activityDays`, `checkpointDays`, `usageHistoryDays`, `logDays` delete older entries at start and daily (on top
  of today's count caps); deletion is listed on the Organization page.
- **FR-183** The profile folder location stays chosen in code (spec 008 FR-034); `[KNOWN GAP]` a policy-set profile location (roaming
  profiles, VDI) needs a move/migration design and is a separate change; a log file location applies once logging exists.

**A13 Rebrand build**
- **FR-184** `npm run dist:rebrand -- --config <managed folder>` builds installers with the policy's display name as `productName`,
  its icons (PNG converted to `.ico`/`.icns`), shortcut names and an app id suffix, keeping the profile folder name and the safeStorage
  identity (spec 008 FR-033/FR-034) so a switch between builds keeps the user's data. About still credits Agent Durbar (FR-021).
- **FR-185** A rebranded build is the organization's build: unsigned unless the organization signs it; the docs say so.

**A14 Legal notice and terms**
- **FR-186** `legal.noticeFile` (text or Markdown in the machine folder, at most 32 KiB, rendered with the chat's sanitised Markdown
  renderer) or `legal.noticeUrl` (opened in the system browser) is shown at first start; with `requireAcceptance` (default true) no
  session starts until the user accepts. Accepted hash and time are kept in the profile.
- **FR-187** A changed notice (new hash) is shown again. The notice is reachable from Help at any time.

**A15 Agent-app versions**
- **FR-188** `agentApps.versions.<app>.min` / `.max` (semver): an installed version outside the range is shown *Version not allowed by
  your organization* and does not start; in-app updates (if allowed) never go past `max`.
- **FR-189** The version is the one detection already reads (spec 051); an unreadable version counts as outside the range.

**A16 Authenticated endpoints**
- **FR-190** A list or registry may name `tokenFromEnv` (in `secrets.envAllow`, bound to that endpoint's host, FR-121a); Durbar sends it
  as `Authorization: Bearer <value>` to that host only, never across a redirect to another host.
- **FR-191** Integrated Windows/Kerberos authentication **to endpoints** stays off on the fetch partition (FR-120); `[KNOWN GAP]` a later
  key may allow it for listed hosts. Proxy authentication is separate and works (FR-155).
**A17 Sign-in passthrough**
- **FR-192** `signIn.claude.forceLoginMethod`, `signIn.codex.forcedLoginMethod`/`workspaceId` and `signIn.copilot.host` (GitHub
  Enterprise or a data-residency host) are passed to the apps through their documented settings so users sign in with the company
  account. Durbar still never sees or stores a token (constitution III). Names read on 2026-10-23: Claude Code `forceLoginMethod` and
  `forceLoginOrgUUID` (settings keys; `read:` https://code.claude.com/docs/en/managed-settings), Codex `forced_login_method` and
  `forced_chatgpt_workspace_id` (`read:` https://learn.chatgpt.com/docs/config-file/config-reference), Copilot CLI `COPILOT_GH_HOST`
  (overrides `GH_HOST` for Copilot only; `read:` https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#environment-variables).
  `[KNOWN GAP]` how each is passed per session (a `--settings` JSON for Claude, a thread override for Codex, the client `env` for
  Copilot) until checked without a prompt in that phase.
- **FR-193** A session whose app reports a different account type than the forced one does not start, with the vendor's own message.

**A18 Vendor managed settings shown**
- **FR-194** Settings > Organization lists, read-only, whether Claude Code `managed-settings.json` / `managed-mcp.json`, Codex
  `requirements.toml` / `managed_config.toml`, and Copilot CLI `managed-settings.json` (`/etc/github-copilot/`,
  `/Library/Application Support/GitHubCopilot/`, `%ProgramFiles%\GitHubCopilot\`) exist at their documented machine paths, and shows their top-level keys (values of keys
  that `redact.ts` flags are masked). Durbar never writes them.
- **FR-195** Where a vendor's managed setting and Durbar's policy disagree for Durbar's sessions, the stricter one is what happens (the
  vendor enforces its own); the page says which. Known cases (`read:` 2026-10-23): Claude Code's managed `env` and `allowedProviders`;
  Codex managed `[otel]` and `model_providers`; Copilot's managed `telemetry` object, which replaces SDK config and env as a whole, and
  its server-managed settings, which Durbar cannot see on disk (the page says *may also be set by your GitHub enterprise*).

**A19 Dev and debug switches**
- **FR-197** FR-004 (dev variables ignored under a policy, `allowDevHooks`) plus: under a machine policy without `allowDevHooks`, a
  packaged build also refuses DevTools (no menu item, no shortcut) on top of spec 008 FR-038.

### O. The vendors' own policies greyed out before a session starts (issue #602, owner go 2026-10-23)

Today Durbar offers a mode, model or MCP server that the company's Claude Code, Copilot or Codex policy blocks, and the session fails
halfway. This section reads the vendors' **own** machine policy files (read-only), and greys out what they block, with the reason, before
anything starts. It needs nothing of P1 (Durbar's own `policy.json`) and is the first slice of P26 (FR-194, FR-195). Vendor evidence:
the research rows above, plus `read:` 2026-10-23 of https://code.claude.com/docs/en/managed-settings.md,
https://code.claude.com/docs/en/settings-reference.md (`availableModels`, `availableModelsMatch`, `deniedModels`,
`permissions.disableBypassPermissionsMode`, `allowedMcpServers`, `deniedMcpServers`), https://code.claude.com/docs/en/permissions.md (the
`mcp__<server>__<tool>` rules), GitHub's *Enterprise managed settings* reference (`permissions.disableBypassPermissionsMode`,
`allowedMcpServers`, `deniedMcpServers`, URL canonicalization, `{ "overridable": v }`) and
https://learn.chatgpt.com/docs/enterprise/managed-configuration.md (`allowed_approval_policies`, `allowed_sandbox_modes`,
`[allowed_permission_profiles]`, locations).

- **FR-198 What is read, and from where.** Each adapter reads its own app's policy, read-only, never written, through
  `AgentAdapter.readOrgPolicy()` (one file per app in `src/adapters/<app>OrgPolicy.ts`); `src/main`, `src/shared` and the window see only
  FR-199's normalized shape.
  - **Copilot** (changed 2026-10-23, review on PR 644): first the Copilot runtime's own `managedSettings.resolve` (`read:` SDK 1.0.22
    `dist/generated/rpc.d.ts`), which merges MDM, the registry, the machine file, the enterprise's server-managed settings and team
    overrides exactly as Copilot enforces them: `resolved.bypassPermissionsDisabled` and the MCP lists of `resolved.settings`. One
    shared reader, `resolveCopilotManaged` in `src/adapters/copilotOrgPolicy.ts` (capped in time), is the only way Durbar reads Copilot
    policy; spec 007's Auto tier (PR 642) uses the same helper. Only when the runtime cannot answer (not installed, no such call, an
    error, late) the machine file `managed-settings.json` is read as a fallback, in `/Library/Application Support/GitHubCopilot/`,
    `/etc/github-copilot/` and `%ProgramFiles%\GitHubCopilot\` (on POSIX a file that is a symlink, not owned by root or writable by
    others is ignored, as Copilot does).
  - **Claude Code**: `managed-settings.json` and `managed-settings.d/*.json` in `/Library/Application Support/ClaudeCode/` (macOS),
    `/etc/claude-code/` (Linux, WSL) and `C:\Program Files\ClaudeCode\` (Windows).
  - **Codex**: `requirements.toml` in `/etc/codex/` (Linux, macOS) and `%ProgramData%\OpenAI\Codex\` (Windows).

  The Windows folders come from the `ProgramFiles` / `ProgramData` environment values when they are drive paths (a relative, UNC or
  empty value is ignored), else `C:\Program Files` / `C:\ProgramData`.
- **FR-199 One normalized shape.** `src/shared/orgpolicy.ts` `OrgPolicy`: the app's name, whether a policy applies, whether part of it
  could not be read, a mark per permission mode (`read-only`, `ask`, `allow`), a model allow-list and deny-list, an MCP server
  allow-list and deny-list (each entry exactly one of name, command with its arguments, URL pattern), MCP tool deny rules, where it came
  from and what was wrong (paths and kinds only). Each question answers a **verdict**: the words and whether main refuses it. A mark is
  `blocked` (a rule of the policy; refused), `fatal` (the app does not start with this policy at all; refused) or `doubt` (Durbar
  cannot know how the vendor reads it; shown as advice, **never refused**).
  `[IMPLEMENTED]` test: `test-orgpolicy.ts` (a, b, c: paths per OS, drop-ins, Copilot runtime first and the file as fallback, ownership rule). `[KNOWN GAP]` no real managed machine (FR-206).
  `[IMPLEMENTED]` test: `test-orgpolicy.ts` (a-e: every key through the one shape and its verdicts).
- **FR-200 Mapping (only these keys are read; every other key is ignored).**

  | Durbar thing | Claude Code | Copilot | Codex |
  |---|---|---|---|
  | **Allow all** | `permissions.disableBypassPermissionsMode` = `"disable"` (Durbar's Allow all is `bypassPermissions`) | runtime: `resolved.bypassPermissionsDisabled`; file fallback: `permissions.disableBypassPermissionsMode` = `"disable"` or `"allow-auto-only"` (`{ "overridable": v }` is advice: a team file may set `unmanaged`) | `allowed_approval_policies` without `never`, `allowed_sandbox_modes` without `danger-full-access` (the first `[[remote_sandbox_config]]` whose `hostname_patterns` match this machine replaces it), or `[allowed_permission_profiles]` without `":danger-full-access" = true` |
  | **Read-only / Ask first** | never blocked by these keys | never blocked by these keys | `allowed_approval_policies` without `never` (Read-only) or `on-request` (Ask first); `[allowed_permission_profiles]` without `durbar_ro = true` (both use that profile) |
  | **Models** | `availableModels` (allow-list; family aliases `opus`, `sonnet`, `haiku`; a model id also allows ids that extend it unless `availableModelsMatch` = `"exact"`; `best`, `opusplan`, `default` ignored) and `deniedModels` (an id without a minor version also blocks later minor versions); the Default/`auto` choice is never greyed | none: `model` is a default, not a lock | none documented |
  | **MCP servers** | `allowedMcpServers`, `deniedMcpServers` (`serverName`, `serverCommand`, `serverUrl`); built-in servers skip the allow-list | the same keys (runtime: from `resolved.settings`); deny wins; built-in servers skip both lists | `[KNOWN GAP]` (FR-206) |
  | **MCP tools** | `permissions.deny` rules `mcp__*`, `*`, `mcp__<server>`, `mcp__<server>__*`, `mcp__<server>__<tool>` and `mcp__<server>__<prefix>*` (server names with other characters than letters, digits, `_`, `-` read as `_`; rules with parentheses are skipped, as Claude Code does) | none: `permissions.deny` has no MCP tool selector | none |

  **Claude Code drop-ins combine as Claude Code documents it** (`read:` managed-settings, *Split a file-based policy across teams*):
  `managed-settings.json` first, then the drop-ins in name order (only lower-case `*.json`, no hidden files, exactly what Claude Code
  reads); a later single value replaces an earlier one, **lists combine with
  duplicates removed** (allow-lists and deny-lists alike), nested blocks merge key by key. **Codex host overrides**: Durbar matches
  `hostname_patterns` (case-insensitive, `*` and `?`) against the local host name; Codex prefers the fully qualified name, which Durbar
  does not resolve, so when no override matches the local name but one would change the verdict, the result is advice (`doubt`). An
  MCP server Durbar knows only by name (reported by the running session, no command or URL known) is refused only by a name rule; an
  allow-list with URL or command rules it cannot check gives advice. URL patterns are matched after the canonicalization GitHub
  documents (lower-case scheme and host, default port and fragment dropped, credentials ignored, `*` in the host never crosses `/`),
  one pass, no regular expressions built from the file.
  `[IMPLEMENTED]` test: `test-orgpolicy.ts` (a-c: the mapping per app, model, URL and glob matching, a rule Durbar cannot check is advice).
- **FR-201 Hostile input, read the vendor's way (changed 2026-10-23, review on PR 644).** Only the keys of FR-200 are read, as **own
  properties** of plain objects (merged drop-ins go into prototype-free objects, depth capped). Each bad value gets **the vendor's own
  documented fallback**, never a stricter one, and is refused only where the vendor itself refuses:
  - Claude Code (`read:` managed-settings, *Keys that fail closed* and the fallback table): a file that is not a JSON object, or a
    read that fails for another reason than the system's refusal, makes Claude Code refuse to start: every start is refused (`fatal`,
    *Claude Code will not start: …*). A read the system refuses (`EACCES`, `EPERM`, a root-only file or drop-in folder) is skipped, as
    Claude Code skips it. An empty file is `{}`. `null` removes a key. An invalid `permissions.disableBypassPermissionsMode` reads as
    `"disable"`. An `availableModels` or `allowedMcpServers` that is not a list is enforced as empty; a bad entry in it is stripped and
    the rest enforced. A `deniedModels` or `deniedMcpServers` that is not a list is dropped (blocks nothing); a bad entry is stripped.
    A bad `permissions.deny` entry is skipped; an invalid `availableModelsMatch` reads as `"exact"`. A `permissions` value that is not an
    object is not documented: advice.
  - Copilot: the runtime's answer is used as is; `resolved.failClosed` (policy not determined) is advice for Allow all, because Copilot
    says it does not disable bypass by itself. In the file fallback, everything Durbar cannot know is advice: `{ "overridable": v }`, a
    value it cannot read, a file that is not JSON, an allow-list that lost entries.
  - Codex: its docs do not say what Codex does with a `requirements.toml` or value it cannot parse (question on PR 644), so Durbar does
    not guess a refusal: a file or key it cannot read is advice for the modes that key governs.
  - **Durbar's own limits (changed 2026-10-25, review on PR 644 item 3).** Policy files are hostile input and are read on the main
    thread, so every limit is a cap on **count and bytes**, and every pass over the input is linear (duplicates are removed with a `Set`
    of keys, never a pairwise scan; a 4,096-name, 93 KB `managed-settings.json` and a 900 KB URL list read in milliseconds, tested with
    a time bound). Counts: 64 drop-ins, 4,096 entries per list, 256 command parts, nesting 32. Bytes: 1 MiB per file, **4 MiB over all
    files of one app** (and of the Copilot runtime's answer), 2,048 characters per entry, **256 KiB of characters per list**, and
    64 KiB of model, server and tool rules in total. **The fail-closed rule:** over any cap Durbar does not read the area partly, and does
    not read it as permissive: that area (the whole policy for a file or total cap, that one list for a list cap) becomes advice
    (`doubt`: every choice in it shows *may be blocked by your organization* and stays selectable), the problem is named by path and kind,
    and nothing is refused on a guess. Mode locks that were read before the cap keep their verdict, and `fatal` stays `fatal`. A whole
    verdict stays cheap and verdicts are remembered per policy read, so a repaint of the MCP list does not work them out again.
  - **Unchanged input is not parsed again (changed 2026-10-25, review on PR 644 item 2).** The last parse of a source is kept with a
    SHA-256 of the **text that was read** (after the size caps; for Claude Code the texts of all files with their paths and the read
    problems, for Codex also the host names, for the Copilot runtime its answer as JSON). The same key gives back the same policy object
    (so the verdict memo stays); any other text, whatever its size and file times, is parsed again. A file is always read (at most
    1 MiB), so a link swapped to another file with the same size and times, a same-size edit or a reset time cannot keep a stale policy.
    A runtime answer that cannot be serialised (a cycle) is not read: the file fallback answers. `[KNOWN GAP]` none beyond the vendors'
    own sources (FR-206); the cache holds the last parse only, and the 60-second read of FR-204 still applies.

  Nothing from a policy is ever logged or put in an error; a problem names the path and what was wrong (*not valid JSON*,
  *`allowedMcpServers` has 2 invalid entries (stripped)*).
  `[IMPLEMENTED]` test: `test-orgpolicy.ts` (d hostile matrix, e nothing leaves, g and i the caps, the linear read and the skip of an unchanged file).
- **FR-202 Greyed out, with the reason, before a start.** The window shows each **refused** choice disabled with the words **Blocked by
  your organization's <app> policy** (or *<app> will not start: …*) as visible small text or the option's label, and as its tooltip:
  the permission mode menu of a session (`#modeChip` menu), the defaults' mode select (`#permMode`) and the new-session dialog's
  (`#sdPerm`); the model choices of the new-session dialog and the model menu (`models:list` marks them `orgBlocked`; the current model
  shows its reason too); each MCP server row (the chat's MCP panel and Settings' live MCP list of spec 058 FR-082, through `agents:mcp`),
  whose switch shows off and is disabled, described by the reason line; and each tool in a server's tools list (`agents:mcpTools`),
  unticked and `aria-disabled` with the reason next to it, left out of the header's count and tri-state. **Advice** (`doubt`) shows
  *Your organization's <app> policy may block this (Agent Durbar could not read all of it)* the same way (`orgDoubt`, *(may be blocked
  by your organization)* in a select) but stays selectable. A blocked menu item stays focusable like the menus' other `aria-disabled`
  items (spec 069 FR-064) and does nothing when chosen; a select never holds a refused value and falls back to the first allowed one,
  the most restrictive (Read-only first).
  `[IMPLEMENTED]` sim: `scripts/shots-076-orgpolicy.js` (every surface at 1440x900 and 1280x800, the run without a policy; a blocked mode menu item sends no `setPermMode`); test: `test-orgwiring.ts` (`models:list`, `agents:mcp`, `agents:mcpTools` carry the reasons).
- **FR-203 Main refuses as well (the window is not the guard), only `blocked` and `fatal`.**
  - **Starts and resumes.** `startGuardOp(deps, adapter, startOptions)` in `agentops.ts` is the only code in main that calls an adapter's
    `start`; both start paths of main.ts (`addWorkspace` and the lazy start/resume) hand it the adapter and the options only. It checks
    exactly what is started: the adapter's own id, the options' mode (`permissionMode`, else `allow`/`ask`, an unknown value read-only,
    as the adapters read it) and the options' model. A refused mode or model throws FR-202's words before `start`, so nothing is
    started or saved.
  - **Advice at start.** Advice does not stop the start. Once the session has started, its words are shown once as a toast in the
    window (`agents:orgNote`).
  - **Switches.** `agents:setMode` (`setModeOp`), `agents:setModel` (`setModelOp`) and switching a refused MCP server on (`setMcpOp`) are
    refused the same way; nothing is changed. Switching a server off is never refused, and advice is never refused. The user picks
    another mode or model, which applies at the next start (spec 018).
  - **A blocked MCP server does not stop the session** (re-check on PR 644): the session starts, the server's row is off and
    disabled, and the agent app skips that server itself (the vendors document it as not loaded).
  `[IMPLEMENTED]` test: `test-orgpolicy.ts` (f: the start guard, `setModeOp`, `setModelOp`, `setMcpOp`, each refusal and what is not changed), `test-orgwiring.ts` (the registered `agents:setModel` and `agents:setMcp` channels and the lines of main.ts that hand each dependency over).
- **FR-204 Fresh enough, cheap.** Each app's policy is read when first needed and again when the last read is older than 60 seconds
  (monotonic clock; a vendor changes it rarely: Claude re-reads every 30 minutes, Copilot hourly); one read at a time per app. Starts,
  `setModel`, `setMcp` and the window's view wait for a fresh read; the mode switch and the often repainted MCP list use the last read
  and start a new one in the background. **Until the first read has landed the mode switch is not refused** (`refusalNow` answers
  nothing, the read starts); the window's view, fetched at start, already greys the choice, and the next start, which waits for a fresh
  read, is refused by main. No watcher, no write. Copilot's runtime may fetch the enterprise's server policy over the
  network (its own cache, at most hourly).
  `[IMPLEMENTED]` test: `test-orgpolicy.ts` (f: TTL, a clock that went back, one read at a time, no refusal before the first read).
- **FR-205 The simulator.** `?simorgpolicy=1` gives the simulator a canned policy (Claude Code and Copilot: Allow all blocked; Claude
  Code: model `haiku` blocked and the `create_issue` tool of `github` blocked; Copilot: MCP server `my-notes` blocked; Codex: Allow all
  advice) so the greyed and advice states can be checked and pictured with no agent app and no policy file. The simulator answers
  `orgpolicy:view` from its own canned bridge (main refuses every channel under `DURBAR_SIM`).
  `[IMPLEMENTED]` sim: `?simorgpolicy=1`, `scripts/shots-076-orgpolicy.js`.
- **FR-206 Honest limits.** `[KNOWN GAP]` Not read directly: macOS MDM profiles and the Windows registry for Claude Code and Codex
  (`com.anthropic.claudecode`, `HKLM\SOFTWARE\Policies\ClaudeCode`, `com.openai.codex`) need native code (FR-176, P17); Copilot's
  come through its runtime. Claude Code's server-managed settings and Codex's cloud requirements are not on disk; Codex
  `managed_config.toml` and its `mcp_servers` identities (command and argument rules with regular expressions) are not evaluated;
  Codex's fully qualified host name is not resolved; Claude Code's `managed-mcp.json` exclusive mode, `allowManagedPermissionRulesOnly`
  and non-MCP tool rules (Durbar lists no built-in tools); Copilot's `sandbox` and `permissions.deny/ask` rules (they block single
  operations, not a Durbar choice). Where these apply, the session still fails the vendor's way, as before. `[KNOWN GAP]` **Claude's stand-alone one-shot** (`generateText` through `oneShotArgs`: the AI theme maker and the folder setup) is pinned to `--model haiku` (`claude.ts`); a policy that
  denies or does not allow `haiku` makes it fail with Claude Code's own message, and Durbar does not check it. It is not a
  user choice that can be greyed; the failure text is the vendor's. `[KNOWN GAP]` No real
  managed machine was used: the mapping is `read:` from the vendors' docs and the SDK's types, and `test:` on fixtures and a fake
  runtime, not checked against a real Claude Code, Copilot or Codex refusing a start.
  `[KNOWN GAP]` as listed; the one-shot above is the newest.
- **FR-207 For the Organization page.** `orgpolicy:view` returns, per app: whether a policy applies, whether part of it could not be
  read, where it came from (`paths`: file paths, or *the Copilot runtime*), what was wrong (`problems`: path and kind, never a value),
  the mode verdicts (words and whether refused), and counts of the model, server and tool rules (no values). The window uses it for the
  mode menus; Settings > Organization (FR-208) lists it.
  `[IMPLEMENTED]` test: `test-orgpolicy.ts` (e: no value of any list, valid or not, reaches the view). The Organization page is FR-208 (built; FR-194's key list is not).

- **FR-208 Settings > Organization (issue #602, spec delta 2026-10-31).** A read-only section of Settings, built only from `orgpolicy:view` (FR-207; no
  new read, nothing written, no values of any rule). One row per agent app in the view: its name, one status line, where it came from
  (`paths`), the mode verdicts in FR-202's words, the counts of model, server and tool rules, and each problem (path and kind). The status
  line keeps three states apart, and **a failed read is never "no policy"**: *No policy file found on this computer* (found: no, unreadable:
  no; with the note that a company profile, registry value or server-managed setting can still apply, FR-206); *Policy applies* (found,
  fully read); *Policy found, but Agent Durbar could not read all of it, so what it blocks is unknown* (unreadable, in any case of found).
  If `orgpolicy:view` itself fails, the section says the policies are unknown and shows no row as clear. Apps absent from the view have no
  reader and are not listed. The text is escaped, at least 10.5px, and the section is not shown when the bridge has no view or the view is
  empty. Not built here: showing top-level keys of the vendor files (FR-194's key list), FR-195's "which one wins" line, macOS MDM and the
  Windows registry (P17), server-managed settings, Codex `mcp_servers` identity rules and a real managed machine (`[KNOWN GAP]`, FR-206).
  Section O's phase P27 stays open for those. `[IMPLEMENTED]` `test:` `test-orgwords.ts`; `sim:` `shots-076-orgpolicy.js` (`?simorgpolicy=1`).

### M. Testing

- **FR-140** Unit tests (no credits): folder resolution (Windows Known Folder, not the env var), trust check (POSIX parents, Windows
  probe), precedence and narrow-only user layer, dev variables ignored under a policy, validator vs the schema on the samples and every
  hostile fixture in `samples/hostile/probes.json`, every closed and key-level state of FR-010..FR-012, MCP matching by definition,
  list readers (both formats, URL-source refusals), env allow-list binding, secret detection through `redact.ts`, path containment,
  env mapping and credential stripping per app, OTLP header encoding, fetch limits and address refusals with a local fake server
  (`http://127.0.0.1` allowed **only** in tests through an injected fetch and address check), registry origin, update and local-edit
  rules.
- **FR-141** Simulator: `DURBAR_MANAGED_DIR=specs/076-managed-config/samples/managed` shows branding, theme, locked controls, the
  Organization page and closed mode (a broken-fixtures folder); screenshots at 1440x900 and 1280x800.
- **FR-142** Real checks, each needing **no prompt** and listed per phase: Codex `otel.*` (including `metrics_exporter` sub-keys) and
  `model_providers` override acceptance (offline `codex app-server generate-json-schema`), Copilot BYOK and OTel through the SDK runtime
  (`copilot help monitoring` / `copilot help providers`, a dummy provider endpoint, a local fake OTLP collector), Claude Code variables
  against a local fake gateway and a local fake OTLP collector with a request log (no real model call). Any check that needs a model call asks the owner first and states its cost.

## Phases (each a small PR, spec first)

Build order: the loader first, then the owner's order for the accepted additions (A1, A2, A5, A4, A3), then the seven original items,
then the rest. Phases after P1 that do not depend on each other may run in parallel.

| Phase | Content | Depends on |
|---|---|---|
| P0 | This spec, samples, schemas and hostile fixtures (this PR) | |
| P1 | Loader (Known Folder path, trust check, parse, validator, precedence, narrow-only user layer, reload, watcher), closed mode and key-level states, lock plumbing in every writer and starter, Settings > Organization, dev variables ignored under a policy (FR-004, A19/FR-197), env allow-list (FR-121a), `DURBAR_MANAGED_DIR` dev hook, simulator, tests (FR-001..FR-017, FR-120..FR-125, FR-130..FR-132, FR-140/141) | |
| P2 | A1 permission mode lock (FR-150..FR-152) | P1 |
| P3 | A2 proxy, CA and mTLS (FR-155..FR-157) | P1 |
| P4 | A5 feature switches (FR-158, FR-159) | P1 |
| P5 | A4 installers and silent per-machine install (FR-160..FR-162) | P1 |
| P6 | A3 signing and notarization (FR-164, FR-165): **certificate purchase needs Vikram's explicit OK** | spec 014 |
| P7 | Branding and theme (FR-020..FR-023, FR-090..FR-093) | P1 |
| P8 | Allowed agent apps and in-app install (FR-030..FR-033) | P1 |
| P9 | MCP restrict and complement, local lists, trust prompt for every command (FR-040..FR-045, FR-047) | P1; catalog UI after issue #539's spec |
| P10 | MCP endpoints: fetch, address rules, cache, both list formats (FR-046, FR-120) | P9 |
| P11 | Custom LLM per app, credential stripping, pricing and token caps (FR-100..FR-109) | P1 |
| P12 | OpenTelemetry per app, marker and notice (FR-080..FR-086) | P1; **the Q4 constitution amendment first (hard prerequisite)** |
| P13 | Agent, profile and skill registry (FR-060..FR-067) | P1, P10 (fetch), spec 073 for skills |
| P14 | A6 spend caps (FR-170, FR-171) | P11 |
| P15 | A7 allowed and blocked folders (FR-172, FR-173) | P1 |
| P16 | A8 updates key (FR-174, FR-175) | P1 (updater itself: its own spec) |
| P17 | A9 Windows registry/ADMX and macOS MDM sources (FR-176, FR-177) | P1 |
| P18 | A10 signed config and lists (FR-178, FR-179) | P10, P13 |
| P19 | A11 audit log (FR-180, FR-181) | P1 |
| P20 | A12 retention (FR-182, FR-183) | P1 |
| P21 | A13 rebrand build (FR-184, FR-185) | P5, P7 |
| P22 | A14 legal notice (FR-186, FR-187) | P1 |
| P23 | A15 agent-app versions (FR-188, FR-189) | P8 |
| P24 | A16 authenticated endpoints (FR-190, FR-191) | P10 |
| P25 | A17 sign-in passthrough (FR-192, FR-193) | P1 |
| P26 | A18 vendor managed settings view (FR-194, FR-195) | P1 |
| P27 | Vendor policies greyed out before a start (FR-198..FR-207, issue #602); first slice of P26, built ahead of P1 (owner go 2026-10-23) | none |

## Clarifications

### Session 2026-10-23 (owner: Vikram, 06:07 UTC, relayed by his coordinator agent: "Defaults ok except for Q10 - let admin provide token pricing so that caps,.. still work")

- **Q1** Is a *profile* in item 4 an agent profile file (spec 043) or a Durbar profile (spec 049)? → **Answered: agent profile files
  (spec 043).** Durbar profiles are not distributed by a registry. (FR-060)
- **Q2** A broken machine policy: safe mode or refuse to start? → **Answered: safe mode** with a red banner (FR-010, FR-011). Refined by the security review: "safe" is **closed** (no new turns, at least as strict as the strictest valid layer; R3).
- **Q3** A per-user config folder? → **Answered: yes**, below the machine layer, labelled not tamper-proof, turned off by
  `allowUserConfig: false` (FR-003). Refined by the security review: off by default when a machine policy exists, narrow only, labelled *your user config (not managed)* (R1).
- **Q4** Amend constitution III ("No telemetry") for OTel export that the admin configures and the agent apps send to the
  organization's own collector, Durbar sending nothing itself? → **Answered: yes**, a MINOR amendment before P12 (T110); Durbar's own
  OTel (FR-181, former A11) needs its own amendment.
- **Q5** Display name at run time only, installer and shortcut names through a rebrand build (A13)? → **Answered: yes** (FR-020..FR-022).
- **Q6** `mcp.lists` set but no `mcp.mode`? → **Answered: `open`** (complement by default; restrict only when the admin says so) (FR-042).
- **Q7** Where registry items are installed? → **Answered: each agent app's user-level folders**, with Durbar's bookkeeping, never
  overwriting a file Durbar did not install (FR-061, FR-062).
- **Q8** Registry updates by default? → **Answered: `notify`**; `auto` allowed from the machine layer (FR-063).
- **Q9** OS-native sources in the first version? → **Answered: the folder first** (P1-P16; registry and MDM are P17); Windows registry/ADMX and macOS MDM later
  as FR-176 (P17), same schema.
- **Q10** Costs on a custom model? → **Answered, changed from the default:** the admin gives per-model token pricing in the policy
  (`llm.pricing`: input, output, cached-input and optional reasoning price per 1M tokens, a currency, a model match by exact id or glob),
  and Durbar uses it for cost totals and caps, so caps keep working on in-house models. Without a price: *price unknown*, caps that need
  a price cannot be computed and Durbar says so; the admin can force a token-based cap (`llm.tokenCap`) or require a price
  (`llm.requirePricing`). Locked in the UI. (FR-104, FR-106..FR-109)
- **Q11** Folder name `AgentDurbar` (no space) on all three OSes? → **Answered: yes** (FR-002, FR-003).
- **Q12** Which proposed additions first? → **Answered: A1 (mode lock), A2 (proxy and CA), A5 (feature switches), A4 (installers), A3
  (signing, needs the purchase)**, then the rest as asked. Each still gets its own spec section (or spec) before any code.

### Session 2026-10-23, later (owner: Vikram, 06:11 UTC, relayed by his coordinator agent: "I agree to add all those")

- **A1-A19** → **Accepted** as requirements: section N (FR-150..FR-197), phases P2-P26 in the Q12 order. A3's certificate purchase still
  needs his explicit OK at purchase time (`needs-owner-approval`).

### Security review by Paco's agent (2026-10-23, review on PR #575, 17 items)

All 17 items are folded into this spec: 1 FR-040/FR-043/FR-044; 2 FR-041/FR-121a; 3 FR-061/FR-063/FR-178; 4 FR-061/FR-062/FR-066;
5 FR-120; 6 FR-004/FR-197; 7 FR-002/FR-005; 8 FR-005; 9 FR-003/FR-007; 10 FR-042; 11 FR-010..FR-012, SC-003; 12 FR-016/FR-017/FR-151;
13 schemas and `samples/hostile/`; 14 FR-013/FR-121; 15 FR-081/FR-084/FR-100a/FR-121; 16 FR-080/FR-086/FR-100a; 17 *Threat model*.
The schema cases from the review's ajv probe are fixtures in `samples/hostile/probes.json` (tasks T018, T019).

### Owner answers to R1-R8 (Vikram, 2026-10-23 06:22 UTC, relayed by his coordinator agent: "Ok")

All eight are **answered with the recommended default** below; the spec already follows them.

- **R1** (answered 2026-10-23, owner: recommended default) The user layer: off by default when a machine policy exists, and only able to narrow? *Recommended:* yes (applied, FR-003).
- **R2** (answered 2026-10-23, owner: recommended default) Signatures (A10) required in the first version for URL lists in `allowlist` mode and for `updates: auto`? *Recommended:* `auto`
  from a URL registry is refused unless signed (applied, FR-063); URL MCP lists may be unsigned, marked *Unsigned list*, with
  `signing.requireFor` available to require it (FR-046, `[KNOWN GAP]`).
- **R3** (answered 2026-10-23, owner: recommended default) A broken policy: block new turns (history readable) or fall back to the last-known-good policy? *Recommended:* block new turns
  (applied, FR-010/FR-011); a last-known-good copy would sit in the user's profile, where it can be edited.
- **R4** (answered 2026-10-23, owner: recommended default) Move A1 (mode lock) and A19 (dev hooks) into P1? *Recommended:* A19 in P1 (applied, FR-004); A1 as P2 right after, per the
  owner's order.
- **R5** (answered 2026-10-23, owner: recommended default) Registry items installed into `~/.claude/agents` and the like also affect terminal sessions: acceptable? *Recommended:* yes,
  said in the install dialog (FR-061).
- **R6** (answered 2026-10-23, owner: recommended default) On a custom model without a price, money caps are shown as not applicable: acceptable, or require a price? *Recommended:*
  shown plainly by default, with `llm.requirePricing`, `llm.tokenCap` and `caps.requireCap` for admins who need enforcement (FR-108,
  FR-170).
- **R7** (answered 2026-10-23, owner: recommended default) Should the vendor-specific `llm` and `telemetry` validation and mapping live in the adapter modules rather than
  `src/shared/policy.ts` (constitution II)? *Recommended:* yes: one published schema, but `src/shared/policy.ts` validates only the
  vendor-neutral parts and delegates `llm.<app>` and the telemetry mapping to `src/adapters/<app>Policy.ts` (plan D1).
- **R8** (answered 2026-10-23, owner: recommended default) A required stdio MCP server that a user declines at the trust prompt: start sessions without it, or block that folder's
  sessions? *Recommended:* start without it and show it (FR-044); an organization that needs it enforced uses a remote server.

### Questions from the OTel and LLM research (2026-10-23), answered by Vikram

All three answered on PR #575 (09:03-09:06 UTC) with option a, the recommended one.

- **R9** (answered 2026-10-23, owner Vikram 09:03-09:06 UTC: option a) Copilot CLI can export prompt text only together with all other content (responses, system prompt, tool arguments and
  results). With `logPrompts: true`, should Copilot export nothing (recommended, FR-080a), or should a separate admin key
  (`telemetry.otel.copilotAllContent`, shown as *Telemetry (with all content)*) allow it? → **Copilot exports no content unless
  `copilotAllContent: true` is set; the notice then says the full conversation is exported** (FR-080a, schema, fixtures
  `policy-copilot-all-content-string`, `policy-user-copilot-all-content`).
- **R10** (answered 2026-10-23, owner: option a; applied in FR-100 and FR-101, schema, `samples/variants/`, P11) Add the providers the vendors document but v1 leaves out: Claude Code `foundry` (Microsoft Foundry) and Codex
  `amazon-bedrock`? *Recommended:* yes, as a small follow-up schema change in P11, same rules (no secrets, env names bound to hosts).
- **R11** (answered 2026-10-23, owner: option a; FR-086) Claude Code sends the account UUID, organization id and, when known, the account e-mail with its OTel data by default.
  Keep the vendor default and say it in the notice (recommended, FR-086), or add `telemetry.otel.identity: false`, which sets
  `OTEL_METRICS_INCLUDE_ACCOUNT_UUID=false` (events keep the ids; the docs give no switch for them)? → **Keep the vendor default and
  say so in the notice; no identity switch in v1.** `OTEL_METRICS_INCLUDE_ACCOUNT_UUID` (metrics only) is recorded as a possible later
  key.

## Success Criteria

- **SC-001** An admin can configure all seven owner items with only the files in `samples/managed/` changed, without rebuilding Durbar.
- **SC-002** Every policy key that is set is visibly locked in the UI and refused in main from every writer (tested per key).
- **SC-003** No broken or partial folder makes Durbar less restrictive than the strictest valid layer would be (tested with the broken and hostile fixtures).
- **SC-004** No secret value appears in any config file, cache, log, IPC message or the Organization page (tested).
- **SC-006** With `llm.pricing` set, a custom-model session's cost appears in totals and a cap in the pricing's currency stops it; with no price, the user is told the cap cannot be applied, and a forced token cap still stops it (tested).
- **SC-005** All policy tests run with zero AI credits on Windows, macOS and Linux CI.

## Changes

### 2026-10-31: Settings > Organization, the part of issue #602 that needs no native code (FR-208)

Issue #602 asks for the Organization page that lists `orgpolicy:view`. FR-208 adds it, read-only, from the view that already exists; the
sources that still need native code or a managed machine stay `[KNOWN GAP]` (FR-206). Tasks T206..T209.

### 2026-10-29: index status text kept from before the fixed status words (spec 021 FR-063)

The `status:` of the specs-index block used to read (moved here unchanged; the block now has one status word and a short note):

> **draft** 2026-10-23 (spec only): samples, JSON schemas and hostile test fixtures included; Q1-Q12 answered by Vikram (Q10: admin token pricing); A1-A19 accepted by Vikram as requirements FR-150..FR-197 (signing certificate purchase still needs his OK); Paco's security review (17 items) and re-review (10 items) folded in; R1-R8 answered by Vikram with the recommended defaults; R9-R11 answered by Vikram (copilotAllContent, Claude foundry and Codex amazon-bedrock, Claude identity stated in the notice); P27 (issue #602, FR-198..FR-207): vendor policies greyed out before a start, built (fixture tests, simulator; no real managed machine)


- **2026-10-23** OTel and custom-LLM facts confirmed in the vendors' documentation after Vikram's comment on PR #575 (Copilot CLI
  OTel page, Claude Code monitoring page, Codex advanced config and their neighbouring pages): research rows for Claude Code OTel and
  providers, Copilot CLI OTel, SDK, BYOK and managed settings, Codex providers and OTel; FR-080 per-app capability table, new FR-080a
  (content only on explicit opt-in, visible), FR-081..FR-086, FR-100..FR-102, FR-142, FR-192, FR-194, FR-195 rewritten with the exact
  variables and keys; the former `[KNOWN GAP]`s for Copilot OTel and Claude Bedrock/Vertex names are closed; per-session acceptance
  checks stay `[KNOWN GAP]` (T100, T111); R9-R11 answered by Vikram the same day (option a each).
- **2026-10-23** Issue #602 (owner go, Vikram): section O, FR-198..FR-207 and phase P27: the vendors' own machine policy files
  (Claude Code `managed-settings.json` and drop-ins, Copilot `managed-settings.json`, Codex `requirements.toml`) are read, normalized
  and the blocked modes, models, MCP servers and MCP tools are greyed out with the reason and refused in main before a start. Built
  ahead of P1. MDM, registry and server-managed sources stay `[KNOWN GAP]` (FR-206). Spec 018 gets a cross-reference.
- **2026-10-23** Review on PR 644 (Paco's agent, 8 required fixes): FR-198, FR-199, FR-200, FR-201, FR-202, FR-203, FR-204, FR-205,
  FR-206 and FR-207 rewritten. Each key now reads the vendor's own documented way, and only `blocked` and `fatal` are refused. What
  Durbar cannot know is advice (`doubt`). The changes:
  - Claude drop-in lists combine;
  - invalid deny-lists are dropped;
  - bad entries are stripped;
  - `EACCES` is skipped;
  - Copilot `overridable` is advice;
  - Codex host overrides are read;
  - unreadable Codex files are advice.

  Copilot is now read through its runtime's `managedSettings.resolve` (one shared reader, used by spec 007's Auto tier as well), with
  the file as a fallback. The main-side refusals moved behind injectable ops (`setModelOp`, `setMcpOp`, `startGuardOp`,
  `withOrgModels`) and are tested by behaviour.

- **2026-10-25** Review on PR 644 (Ruben's agent, 11 items): FR-201 now states the caps on count **and** bytes (per list, per source, the
  Copilot answer), the **fail-closed rule** (over a cap the area is advice, never read as permissive, never half-read) and that an
  unchanged source is not read again; the dedupe is linear. FR-204 says the mode switch is not refused before the first read. FR-206 adds
  the `[KNOWN GAP]` for Claude's haiku one-shot. FR-198..FR-207 carry `[IMPLEMENTED]`, `test:` and `sim:` tags. Tasks T203, T204; round 2: T205.
  `permissions.requireOsSandbox` (spec 087, PR 733) is Durbar's own policy key, read from Durbar's `policy.json` (P1), not from a vendor's
  managed file: this section's readers are not its home.

### 2026-10-25: FR-158/FR-159 and FR-174 cover spec 081's agent-app update check (owner decision Q6 = A)

- **FR-174** `updates.mode: "off"` now also turns off spec 081's agent-app update check. The check at Durbar's start, the *Check for updates* button, the per-card *Check*, the *Latest* lines and the start-check switch are hidden, with *Turned off by your organization*, and no update host is contacted.
  - Owner decision Q6 = A on spec 081, Vikram, 2026-10-25. The hidden-button reading follows FR-158.
  - `notify` and `auto` keep their meaning for Durbar's own updater. Neither one starts an automatic agent-app update.
- **FR-158/FR-159**: a new feature switch, `features.agentAppUpdateCheck: false`, with the same effect as above (spec 081 FR-022).
- **FR-032/FR-175** are unchanged. `agentApps.allowInAppInstall: false` turns off the start check and hides Update, and the read-only *Check for updates* stays.
- **Unreadable policy**: a policy that cannot be read or validated turns spec 081's start check off (fail closed, spec 081 FR-022).
- Status: `[PLANNED]` (spec 081 T033, T036). Nothing is built here.

### 2026-10-25: `permissions.requireOsSandbox` and FR-173 (spec 087)

New key `permissions.requireOsSandbox` (boolean, default `false`; [spec 087](../087-os-sandbox-floor/spec.md) FR-019): when set, an agent app
whose OS sandbox cannot start is refused in Read-only and Ask first, every time (a session's *Continue* and a stored *Always continue* are
ignored, FR-007d). Narrow-only; a value that is not a boolean, a malformed `permissions` section or an unreadable policy count as `true`.
The rule is built and tested (`requireOsSandboxFrom`, `src/main/sandboxpolicy.ts`), but this spec has no policy reader yet, so it is not
reachable in the app (`[KNOWN GAP]`, as `updatepolicy.ts`). FR-173's open point is answered by spec 087: Claude Code's and Copilot's
OS sandboxes now hold their shell commands in Read-only and Ask first, and Settings > Agent apps shows each app's sandbox line (spec 087
FR-012); there is no Organization page yet for the pointer FR-012 asks for.

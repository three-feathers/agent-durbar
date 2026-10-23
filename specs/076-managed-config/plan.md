# Implementation Plan: 076 managed configuration for organizations

**Spec**: [spec.md](spec.md) · **Samples**: [samples/](samples/) · **Status**: plan for P1-P26; nothing built. Q1-Q12 answered by Vikram 2026-10-23 (Q10: admin token pricing); A1-A19 accepted (section N); security review by Paco's agent folded in; R1-R8 answered by Vikram 2026-10-23 with the recommended defaults.

## Constitution check

- **I Spec Kit**: spec, plan, tasks and samples in this folder before any `src/` change; each phase is its own PR that ticks its tasks.
- **II Adapters are plug-ins** (R7): one published schema, but `src/shared/policy.ts` validates only the vendor-neutral parts (app ids
  `copilot`/`claude`/`codex` only, as `GlobalApp` already does). Validation of `llm.<app>`, `signIn.<app>` and the mapping of
  `telemetry`, `network` and `llm` to an app's variables or config overrides live in `src/adapters/<app>Policy.ts`, behind one optional
  hook, `AgentAdapter.policyEnv?(p, env)`; no vendor names in the renderer.
- **III Safe by default, no secrets**: fail closed (FR-010..FR-012), narrow-only user layer (FR-003), dev variables ignored under a
  policy (FR-004), env names allow-listed and bound to hosts (FR-121a), commands only from the machine folder and always behind the
  trust prompt (FR-040, FR-043); no secret field in any schema; env values read at launch and
  passed only to children (FR-121); https-only fetches with caps (FR-120); nothing executed from the folder or a registry (FR-122);
  registry scripts need the user's tick (FR-066, Amendment 1). **Q4**: OTel export from the agent apps needs a principle III amendment
  (MINOR) before P12 lands (hard prerequisite); Durbar's own OTel audit export (FR-181) needs a further amendment.
- **IV No credits**: unit tests, a local fake HTTP server through an injected fetch, simulator; real checks need no prompt (FR-142).
- **V Calm UI**: the lock is an icon plus words, >= 10.5px; the Organization page and banners fit 1280x800; screenshots per phase.
- **VI Parity**: paths per OS in one pure function; POSIX trust check, Windows ACL `[KNOWN GAP]`; tests run the three platforms'
  branches from any OS.
- **VII Quality gates**: typecheck, build, `npm test`; new tests listed below.
- **VIII Honest limits**: `[KNOWN GAP]`s in the spec (Windows ACL, run-time icon limits, Copilot BYOK and OTel export through the
  SDK's headless runtime, Codex per-thread `otel.*`/`model_providers` and `metrics_exporter` sub-keys, vendor enforcement outside
  Durbar) and the README *Known limits*. The OTel and provider variable names themselves are confirmed (`read:` 2026-10-23, D7).

## Technical context

TypeScript, Electron main + plain JS renderer. **One dependency becomes direct: `koffi`** (today only a transitive dependency of
`@github/copilot-sdk`, 3.2.1, already unpacked from the asar). Main code will call it for `SHGetKnownFolderPath` (FR-002, FR-172
fallback), `RegGetValueW` and `CFPreferences*` (FR-176), so it is added to `dependencies`, pinned to the version the SDK uses, in P1's
PR, with this line as the reason; no other code path is possible without native code or a shell (a `reg.exe` or `powershell` call
would read the same values through a process and environment the user controls). Everything else adds nothing: JSON parsing is built
in, the validator is a small hand-written module, fetches use Electron `net.fetch`, hashing and Ed25519 use `crypto`. Tests use `ajv` (2020 draft), already installed as a
dependency of electron-builder, only to prove the hand-written validator agrees with the published schemas; if electron-builder ever
drops it, add `ajv` as a devDependency in that PR (dev only, never shipped).

## Design

### D1 Modules

| Module | Role |
|---|---|
| `src/shared/policy.ts` (pure, no imports from Electron) | `Policy` types, `validatePolicy(doc) -> {policy, errors[], warnings[]}` (closed schema, readable messages with JSON paths), `mergeLayers(machine, user)`, `safeState(area)`, `isLocked(policy, key)`, the secret scan through `src/shared/redact.ts` (no second detector), MCP matcher (`mcpAllowed(policy, entry)`), path containment helper |
| `src/shared/policymcp.ts` | `durbar-mcp-list-v1` and `mcp-registry-v0.1` readers -> one `OrgMcpEntry[]` |
| `src/shared/policyregistry.ts` | registry index reader, update decision (`installed`, `updateAvailable`, `changedLocally`, `noLongerOffered`) |
| `src/main/policydir.ts` (pure, injected env) | `managedDirs({platform, knownProgramFiles, appData, packaged, devHooks})` (Windows: `SHGetKnownFolderPath(FOLDERID_ProgramFiles)` via `koffi`, never `%ProgramFiles%`), `posixTrust(chainOfStats)` (every file and every parent to `/` after `realpath`), `windowsWriteProbe(dir)` (`r+` open of `policy.json`, `wx` temp file per folder) |
| `src/main/devhooks.ts` (existing) | `devEnv(env, packaged, policyPresent, allowDevHooks)`: with a machine policy and no `allowDevHooks`, a packaged build returns `{}` and ignores `DURBAR_DEV`; `main.ts` resolves the machine folder (a cheap existence check plus the validator) **before** computing `dev` (FR-004) |
| `src/adapters/<app>Policy.ts` | per-app validation of `llm.<app>`/`signIn.<app>`, env and config mapping (OTel, proxy, CA, LLM), credential stripping (FR-100a), OTLP header percent-encoding (R7) |
| `src/main/policystore.ts` | reads layers (size caps, BOM/CRLF), runs the trust check and validator, keeps the effective policy, watcher (2 s debounce), `reload()`, emits `policy:changed` |
| `src/main/policyfetch.ts` | `fetchJson(url, {maxBytes, timeouts, redirects, token?})` over an injected `fetch` (Electron `net.fetch` on a non-persistent partition `durbar-policy-fetch` with `credentials: 'omit'` and `allowNTLMCredentialsForDomains('')`) and an injected address check (`dns.lookup` all addresses, refuse loopback/link-local/metadata/unspecified/multicast, private only for `network.trustedHosts`; behind a proxy from `session.resolveProxy`, literal and local-name hosts refused and unresolvable names only for `network.trustedHosts`, FR-120), per hop with `redirect: 'manual'`; the same `hostAllowed(url)` check is used for MCP server URLs from URL lists before a session start (FR-040); ETag cache in `<userData>/managed-cache/`, re-validated on use; Ed25519 `.sig` check when `signing` applies |
| `src/main/registryinstall.ts` | download, hash check, safe write (reuse spec 043's writer), bookkeeping `registry-installs.json`, uninstall |
| `src/main/ipc/policy.ts` | `policy:get` (view without secret values), `policy:reload`, `policy:copyText`; registry `registry:list/install/update/uninstall` |
| Renderer `organization.js` | Settings > Organization page, banners (red safe mode, yellow key errors), a shared `lockLine(key)` helper used by every locked control |

### D2 Validation

The schema files in `samples/managed/schema/` are the published contract. `httpsUrl` and `text` are the same definition in all three
files (a test asserts it). `samples/hostile/probes.json` lists every hostile case from the security review with `refusedBy: schema` or
`validator`; the test runs both on each and asserts the expected verdicts (`validator` rows give the source `url`, the layer `user`, or
the index origin as context). `validatePolicy` implements the same rules by hand (types,
enums, patterns, closed objects, limits). `scripts/test-policy.ts` runs both on `samples/` and on `scripts/fixtures/policy-bad/*.json`
(one fixture per rule) and asserts the same verdicts. The one documented exception: duplicate `llm.pricing.models[].match` values (FR-107) cannot be expressed in JSON Schema, so only `validatePolicy` refuses them; the test lists that fixture as an expected difference. The website copies the schemas (spec 050 generator) at
`/schema/policy.v1.json`, `/schema/mcp-list.v1.json`, `/schema/registry-index.v1.json` (the `$id`s).

### D3 Precedence and locks

`effective = default <- user setting <- user layer <- machine layer`, per key path. `isLocked(key)` is true when a layer sets the key
(or its parent object). `settings:get` returns `policy: { locked: string[], values, sources }`; every setter in `ipc/settings.ts` and
the other writers (spec 041 server ops, `remoteops.ts`, schedules, assistant) calls one guard `refuseIfLocked(key)` first (FR-016).

### D4 Fail safe

`policystore` returns `{mode: 'none' | 'ok' | 'closed', layers, errors}`. `closed` is one guard, `canAct() === false`, checked by every
starter and sender (session start, resume, send, schedules, specs 041/054/048) and by the MCP, harness, registry and remote paths; reads
stay open. No last-known-good copy (R3). Key-level failures set that area's strictest state (FR-012 table) through
`strictState(area)`; a test asserts for each area that the strict state is at least as strict as every valid sample value.

### D5 Applying each owner item

- **Branding**: `main.ts` title and quit dialog, `appmenu.ts` labels and `aboutPanelOptions`, notification titles read
  `displayName()`; `about.ts` `aboutView` adds `basedOn: 'Agent Durbar'` when a display name is set. Icon: header check
  (`pngSize(buf)`), then `nativeImage.createFromPath` for the window and `app.dock.setIcon`.
- **Agent apps**: `createRegistry`/`adapters:list` filter by `allowed`; harness IPC refuses install/update when `allowInAppInstall` is
  false; schedules check before starting.
- **MCP**: `mcpAllowed` is called in `mcpstore` (add), `ipc/mcpglobal.ts` (preview/apply/copy), `foldersetup.ts` (scan marks blocked),
  `startopts.ts` (build `mcpServers` + `disabledMcpServers` with blocked names, add required ones), and the session switch handlers.
  The catalog (#539) gets org entries as a source.
- **Registry**: Settings > Agents and skills lists items from `policyregistry`; install writes through `registryinstall`.
- **OTel and LLM**: a pure `policyEnvFor(app, policy, env) -> {env: Record<string,string>, config?: object, missing: string[]}` per
  app in the adapter folder; Claude merges into `deps.env`; Codex merges config overrides into `thread/start` beside
  `codexMcpConfig`; Copilot gets a new `env` option in `createClient()`. `missing` feeds Settings > Organization.
- **Pricing and token caps** (FR-106..FR-109): `priceFor(policy, modelId)` and `costOf(usage, price)` in `src/shared/policy.ts`
  (pure); the existing cost path (`src/renderer/costtable.js`, `usagetotalsstore.ts`) and the cap path (`startCap` in
  `src/shared/credits.ts`, `agentops.ts` `setCapOp`, the adapters' cap enforcement from spec 011) take a policy price source next to
  the vendor prices, and a `tokens` cap unit for the forced token cap. No second cost or cap mechanism.
- **Accepted additions (section N)**: each reuses an existing path: modes `folders.ts` `modeForSession` and the mode menu (A1); `session.setProxy`
  and the per-app env hook (A2); one `featureEnabled(name)` guard in main used by specs 054/041/048/043/040/009/044 (A5); electron-builder
  targets in `package.json` `build` (A4, A13); spec 014 (A3); spec 011 caps and totals (A6); `addMany`/folder IPC with `realpath` (A7);
  `policyfetch` for the feed (A8); `RegGetValueW` on `HKLM`/`HKCU` and
  `CFPreferencesCopyAppValue`/`CFPreferencesAppValueIsForced`, both through `koffi` (no shell, no new dependency) (A9); Node `crypto.verify` Ed25519 (A10); a small JSONL writer
  with a hash chain (A11); the stores' existing pruning (A12); `askDialog` and the sanitised Markdown renderer (A14); spec 051 detection
  versions (A15); `policyfetch` `token` (A16); the per-app env hook (A17); read-only file reads with `redact.ts` masking (A18).
- **Theme**: `theme.js` start reads `policy.appearance`; a pack goes through `checkUserManifest` in main and is served like a user
  theme (`theme:getUser`), marked managed.

### D6 Fetching

`net.fetch` with `redirect: 'manual'` to check each hop is https; an `AbortController` for timeouts; a byte counter on the body stream
aborts past the cap; JSON parsed only after the whole body is in. In tests the injected fetch may target `http://127.0.0.1`; the app's
own fetch refuses anything but `https:`.

### D7 Adapter mapping (policy key -> each app's real variable, flag or key)

Every cell was read in the vendor's documentation on 2026-10-23 (spec research table, `read:` URLs there) unless marked `[KNOWN GAP]`.
"env" means the child's environment (Claude: `deps.env`; Copilot: the SDK client's `env` option; Codex: the app-server child's env).
"override" means a Codex thread config override sent beside `codexMcpConfig`. Values from `*FromEnv` names are read at launch, passed
only to the child and never logged (FR-121).

| Policy key | Claude Code | Codex | Copilot CLI (SDK) |
|---|---|---|---|
| `telemetry.otel` present | env `CLAUDE_CODE_ENABLE_TELEMETRY=1` | override `otel.*` (`[KNOWN GAP]` per-thread acceptance, T111) | SDK `telemetry: {...}` -> `COPILOT_OTEL_ENABLED=true` |
| `.endpoint` | env `OTEL_EXPORTER_OTLP_ENDPOINT` | `otel.<exporter>.<otlp-http or otlp-grpc>.endpoint`, http: `+ /v1/logs`, `/v1/traces`, `/v1/metrics` | SDK `telemetry.otlpEndpoint` |
| `.protocol` `http/protobuf` | env `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` (always set: no default) | `otlp-http`, `protocol = "binary"` | SDK `otlpProtocol: "http/protobuf"` |
| `.protocol` `http/json` | `=http/json` | `otlp-http`, `protocol = "json"` | `otlpProtocol: "http/json"` |
| `.protocol` `grpc` | `=grpc` | `otlp-grpc` | not supported: Copilot export off, shown |
| `.signals` `metrics` | env `OTEL_METRICS_EXPORTER=otlp` (else `none`) | `otel.metrics_exporter` (`[KNOWN GAP]` sub-keys, T111) | always on with traces (no per-signal switch) |
| `.signals` `logs` | env `OTEL_LOGS_EXPORTER=otlp` (else `none`) | `otel.exporter` (else `"none"`) | no logs signal: shown |
| `.signals` `traces` | env `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1` + `OTEL_TRACES_EXPORTER=otlp` (beta) | `otel.trace_exporter` (else `"none"`) | always on with metrics |
| `.headersFromEnv` | env `OTEL_EXPORTER_OTLP_HEADERS` (percent-encoded `k=v,k=v`) | `otel.<exporter>.<kind>.headers` map | env `OTEL_EXPORTER_OTLP_HEADERS` |
| `.resourceAttributes` | env `OTEL_RESOURCE_ATTRIBUTES` (percent-encoded) | none documented (not passed; shown) | env `OTEL_RESOURCE_ATTRIBUTES` |
| `.logPrompts` true | env `OTEL_LOG_USER_PROMPTS=1` and `OTEL_LOG_ASSISTANT_RESPONSES=0` | `otel.log_user_prompt = true` | **not passed** (all-or-nothing; R9); SDK `captureContent: false` |
| `.copilotAllContent` true (R9) | | | env `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`, SDK `captureContent: true`; chip *with all content* |
| `.logPrompts` false (default) | no `OTEL_LOG_*` content variable in env | `otel.log_user_prompt = false` | SDK `captureContent: false` |
| removed from env when `telemetry` is set (FR-085) | every `OTEL_*` not set above, incl. `OTEL_LOG_TOOL_DETAILS`, `OTEL_LOG_TOOL_CONTENT`, `OTEL_LOG_RAW_API_BODIES`, `OTEL_LOG_MANAGED_SETTINGS`, per-signal endpoint/headers/protocol, `BETA_TRACING_ENDPOINT`, `ENABLE_BETA_TRACING_DETAILED` | (config only) | every `OTEL_*` and `COPILOT_OTEL_*` not set above, incl. `COPILOT_OTEL_FILE_EXPORTER_PATH` |
| `llm.claude.provider` `gateway` | env `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` (from `authTokenFromEnv`) | | |
| `llm.claude.provider` `bedrock` | env `CLAUDE_CODE_USE_BEDROCK=1`, `AWS_REGION` (`region`), `ANTHROPIC_BEDROCK_BASE_URL` (`baseUrl`), `AWS_BEARER_TOKEN_BEDROCK` (`authTokenFromEnv`, optional) | | |
| `llm.claude.provider` `vertex` | env `CLAUDE_CODE_USE_VERTEX=1`, `CLOUD_ML_REGION` (`region`), `ANTHROPIC_VERTEX_PROJECT_ID` (`projectId`), `ANTHROPIC_VERTEX_BASE_URL` (`baseUrl`) | | |
| `llm.claude.provider` `foundry` (R10) | env `CLAUDE_CODE_USE_FOUNDRY=1`, `ANTHROPIC_FOUNDRY_RESOURCE` (`resource`) or `ANTHROPIC_FOUNDRY_BASE_URL` (`baseUrl`), `ANTHROPIC_FOUNDRY_API_KEY` (`apiKeyFromEnv`) or `ANTHROPIC_FOUNDRY_AUTH_TOKEN` (`authTokenFromEnv`) | | |
| `llm.claude.model` / `.smallFastModel` | env `ANTHROPIC_MODEL` / `ANTHROPIC_DEFAULT_HAIKU_MODEL` | | |
| `llm.codex.provider` | | override `model_provider = <id>`, `model_providers.<id>.{name, base_url, env_key, wire_api = "responses"}` (`[KNOWN GAP]` per-thread acceptance, T100) | |
| `llm.codex.bedrock` (R10) | | override `model_provider = "amazon-bedrock"`, `aws.region`, `aws.profile` (structured) | |
| `llm.codex.model` | | override `model` | |
| `llm.copilot.*` | | | env `COPILOT_PROVIDER_BASE_URL`, `COPILOT_PROVIDER_TYPE`, `COPILOT_PROVIDER_API_KEY` / `COPILOT_PROVIDER_BEARER_TOKEN` (from the named vars), `COPILOT_PROVIDER_AZURE_API_VERSION`, `COPILOT_MODEL`, `COPILOT_OFFLINE` (`[KNOWN GAP]` headless runtime, T100) |
| stripped when `llm.<app>` is set (FR-100a) | `ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, other `ANTHROPIC_*`, `CLAUDE_CODE_USE_*`, `CLAUDE_CODE_SKIP_*_AUTH`, `AWS_BEARER_TOKEN_BEDROCK`, `CLOUD_ML_REGION`, `VERTEX_REGION_CLAUDE_*` not set above | `OPENAI_API_KEY`, `CODEX_API_KEY` (unless the `env_key`), `CODEX_ACCESS_TOKEN` | other `COPILOT_PROVIDER_*`, `COPILOT_PROVIDER_API_KEY_COMMAND`; `COPILOT_PROVIDERS_CONFIG` -> a Durbar-owned empty registry (`[KNOWN GAP]`, T100) |
| `signIn.*` (FR-192) | `forceLoginMethod`, `forceLoginOrgUUID` (settings) | `forced_login_method`, `forced_chatgpt_workspace_id` | env `COPILOT_GH_HOST` |
| never set by Durbar | `otelHeadersHelper` (a script), `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST` (would override the organization's Claude model pins) | `model_providers.<id>.auth.command` (a command) | `telemetry.headersProvider`, `COPILOT_PROVIDER_API_KEY_COMMAND` (commands) |

The vendor's own managed settings (Claude `managed-settings.json` `env`, Codex `requirements.toml`/`managed_config.toml`, Copilot
`managed-settings.json` `telemetry`) win over what Durbar passes; FR-194/FR-195 show it.

### D8 Vendor policies greyed out (section O, phase P27, issue #602)

- `src/shared/orgpolicy.ts` (no imports, pure): the `OrgPolicy` type with a mark per thing (`blocked`, `fatal`, `doubt`),
  `emptyOrgPolicy`, `wholeOrgPolicy`, and the questions `modeVerdict`, `modelVerdict`, `mcpVerdict`, `toolVerdict`, each answering
  `{ why, refuse }` or `undefined`; the hostile-input helpers (`ownValue`, and `ownStrings` / `ownMcpRules`, which strip a bad entry the
  way the vendors do) and the URL and host matchers (canonicalize, then one pass over `*`/`?`; no `RegExp` from file text).
- `src/adapters/claudeOrgPolicy.ts`: `mergeClaudeSettings` (Claude Code's documented drop-in merge), `parseClaudeOrgPolicy` (each key's
  documented fallback) and `readClaudeOrgPolicy` (paths, `EACCES` skipped, a non-JSON file `fatal`).
- `src/adapters/copilotOrgPolicy.ts`: `resolveCopilotManaged` (the runtime's `managedSettings.resolve`, capped in time; the one shared
  Copilot policy reader, also for spec 007's Auto tier), `copilotOrgPolicyFromResolve`, and the file fallback `readCopilotFileOrgPolicy`.
- `src/adapters/codexOrgPolicy.ts`: the TOML subset (top-level `allowed_approval_policies` / `allowed_sandbox_modes`,
  `[allowed_permission_profiles]`, `[[remote_sandbox_config]]` with `hostname_patterns`), via a strict one-pass statement splitter.
- `AgentAdapter.readOrgPolicy?(): OrgPolicy | Promise<OrgPolicy>` on the three real adapters; `fake.ts` and the simulator's stand-ins have
  none.
- `src/main/orgpolicy.ts` `OrgPolicyCache`: per adapter id, 60 s TTL on a monotonic clock, one read at a time (FR-204), never throws
  (a reader error is `doubt`); `refusal` (fresh) and `refusalNow` (last read), `assertOrgAllows` for the starters, `view()` for
  `orgpolicy:view` (FR-207).
- Wiring, each behind an op with injectable deps and tested by behaviour:
  - `assertOrgAllows` in `addWorkspace` and the lazy start in `main.ts`;
  - `setModeOp` `orgRefusal` (`agentops.ts`);
  - `setMcpOp` `orgMcpRefusal` (`agentops.ts`), with the server definitions from the same lists `serverUrlOf` reads;
  - `setModelOp` and `withOrgModels` (`ipc/model.ts`);
  - `agentMcpReply`'s `orgBlocked(name)` hook (`mcpsession.ts`);
  - `mcpToolsOp`'s `orgTool` (`mcptoolsop.ts`).
- Window: one `orgMode` helper in `app.js` fed by `orgpolicy:view` (read at start and when the window regains focus), used by
  `fillPermSelect` / `markOrgModes`, the mode menu and `fillModelSelect`; `screens.js` shows `orgBlocked` / `orgDoubt` on MCP rows,
  the live list and tools.
- Reused, not duplicated:
  - the mode lists (`DurbarModels.modesFor` / `fallbackMode`);
  - the MCP row and tools list of spec 058/069;
  - `codextoml.ts`'s approach;
  - for Copilot, its own runtime instead of a second parser.

## Testing

- `scripts/test-policy.ts`: dirs per OS (Known Folder, not env), trust check (POSIX parent chain, Windows probe), dev variables
  ignored under a policy, validator vs `ajv` on the samples and `samples/hostile/`, precedence and narrow-only user layer, locks,
  closed and strict states, env allow-list binding, secret detection through `redact.ts`, path containment.
- `scripts/test-policy-mcp.ts`: matcher, modes, list readers (both formats), required servers, enforcement in start options.
- `scripts/test-policy-env.ts`: per-app env/config mapping for OTel and LLM, missing variables, no secret in outputs other than the
  child env.
- `scripts/test-policy-fetch.ts`: limits, redirects, timeouts, cache, failures with a local fake server.
- `scripts/test-registry.ts`: index reader, install with hash check, local edits, uninstall, never overwriting foreign files.
- `scripts/test-orgpolicy.ts` (P27): per-app parsing on fixture text, the mapping table of FR-200, the hostile matrix of FR-201
  (wrong types, inherited and `__proto__` keys, oversized files and lists, partial lists, multi-line TOML, symlinked or user-owned
  Copilot files), URL and model matching, main's refusals; mutation-checked. `scripts/shots-076-orgpolicy.js`: the greyed states in
  the simulator (`?simorgpolicy=1`).
- Simulator drivers and screenshots per phase at 1440x900 and 1280x800 (`DURBAR_MANAGED_DIR`).

## Complexity tracking

| Item | Why | Simpler option rejected |
|---|---|---|
| Hand-written validator next to a published JSON Schema | No runtime dependency; readable messages | Shipping `ajv` (a new runtime dependency for one file) |
| Two MCP list formats | Our format is simple and holds stdio servers and env-var references; v0.1 is what GitHub and VS Code already point at, so a company with a registry need not publish twice | One format only |

# Implementation Plan: 076 managed configuration for organizations

**Spec**: [spec.md](spec.md) · **Samples**: [samples/](samples/) · **Status**: plan for P1-P8; nothing built. Defaults of Q1-Q12 assumed.

## Constitution check

- **I Spec Kit**: spec, plan, tasks and samples in this folder before any `src/` change; each phase is its own PR that ticks its tasks.
- **II Adapters are plug-ins**: the policy is vendor-neutral in `src/shared/policy*.ts` (app ids `copilot`/`claude`/`codex` only, as
  `GlobalApp` already does). Mapping a policy to an app's variables or config overrides lives in each adapter's module
  (`claude*.ts`, `codex*.ts`, `copilot.ts`) behind one optional hook, `AgentAdapter.policyEnv?(p)` / start options; no vendor names
  in the renderer.
- **III Safe by default, no secrets**: fail-safe states (FR-010..FR-012); no secret field in any schema; env values read at launch and
  passed only to children (FR-121); https-only fetches with caps (FR-120); nothing executed from the folder or a registry (FR-122);
  registry scripts need the user's tick (FR-066, Amendment 1). **Q4**: OTel export from the agent apps needs a principle III amendment
  (MINOR) before P7 lands.
- **IV No credits**: unit tests, a local fake HTTP server through an injected fetch, simulator; real checks need no prompt (FR-142).
- **V Calm UI**: the lock is an icon plus words, >= 10.5px; the Organization page and banners fit 1280x800; screenshots per phase.
- **VI Parity**: paths per OS in one pure function; POSIX trust check, Windows ACL `[KNOWN GAP]`; tests run the three platforms'
  branches from any OS.
- **VII Quality gates**: typecheck, build, `npm test`; new tests listed below.
- **VIII Honest limits**: `[KNOWN GAP]`s in the spec (Windows ACL, run-time icon limits, Copilot OTel/BYOK through the SDK, Codex
  per-thread `[otel]`, Bedrock/Vertex names, vendor enforcement outside Durbar) and the README *Known limits*.

## Technical context

TypeScript, Electron main + plain JS renderer. **No new runtime dependency**: JSON parsing is built in, the validator is a small
hand-written module, fetches use Electron `net.fetch`, hashing uses `crypto`. Tests use `ajv` (2020 draft), already installed as a
dependency of electron-builder, only to prove the hand-written validator agrees with the published schemas; if electron-builder ever
drops it, add `ajv` as a devDependency in that PR (dev only, never shipped).

## Design

### D1 Modules

| Module | Role |
|---|---|
| `src/shared/policy.ts` (pure, no imports from Electron) | `Policy` types, `validatePolicy(doc) -> {policy, errors[], warnings[]}` (closed schema, readable messages with JSON paths), `mergeLayers(machine, user)`, `safeState(area)`, `isLocked(policy, key)`, secret-literal detector, MCP matcher (`mcpAllowed(policy, entry)`), path containment helper |
| `src/shared/policymcp.ts` | `durbar-mcp-list-v1` and `mcp-registry-v0.1` readers -> one `OrgMcpEntry[]` |
| `src/shared/policyregistry.ts` | registry index reader, update decision (`installed`, `updateAvailable`, `changedLocally`, `noLongerOffered`) |
| `src/main/policydir.ts` (pure, injected env) | `managedDirs({platform, env, programFiles, appData, devHooks})`, `posixTrust(stat)` |
| `src/main/policystore.ts` | reads layers (size caps, BOM/CRLF), runs the trust check and validator, keeps the effective policy, watcher (2 s debounce), `reload()`, emits `policy:changed` |
| `src/main/policyfetch.ts` | `fetchJson(url, {maxBytes, timeouts, redirects})` over an injected `fetch` (Electron `net.fetch` in the app, a fake in tests), ETag cache in `<userData>/managed-cache/` |
| `src/main/registryinstall.ts` | download, hash check, safe write (reuse spec 043's writer), bookkeeping `registry-installs.json`, uninstall |
| `src/main/ipc/policy.ts` | `policy:get` (view without secret values), `policy:reload`, `policy:copyText`; registry `registry:list/install/update/uninstall` |
| Renderer `organization.js` | Settings > Organization page, banners (red safe mode, yellow key errors), a shared `lockLine(key)` helper used by every locked control |

### D2 Validation

The schema files in `samples/managed/schema/` are the published contract. `validatePolicy` implements the same rules by hand (types,
enums, patterns, closed objects, limits). `scripts/test-policy.ts` runs both on `samples/` and on `scripts/fixtures/policy-bad/*.json`
(one fixture per rule) and asserts the same verdicts. The website copies the schemas (spec 050 generator) at
`/schema/policy.v1.json`, `/schema/mcp-list.v1.json`, `/schema/registry-index.v1.json` (the `$id`s).

### D3 Precedence and locks

`effective = default <- user setting <- user layer <- machine layer`, per key path. `isLocked(key)` is true when a layer sets the key
(or its parent object). `settings:get` returns `policy: { locked: string[], values, sources }`; every setter in `ipc/settings.ts` and
the other writers (spec 041 server ops, `remoteops.ts`, schedules, assistant) calls one guard `refuseIfLocked(key)` first (FR-016).

### D4 Fail safe

`policystore` returns `{mode: 'none' | 'ok' | 'safe', layers, errors}`. `safe` sets: `maxMode = read-only` (session start and mode
switch clamp, `folders.ts` `modeForSession`), MCP additions off, folder MCP off, harness install off, registry off, remote control off.
Key-level failures set only that area's safe value (FR-012 table) through `safeState(area)`.

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
- **Theme**: `theme.js` start reads `policy.appearance`; a pack goes through `checkUserManifest` in main and is served like a user
  theme (`theme:getUser`), marked managed.

### D6 Fetching

`net.fetch` with `redirect: 'manual'` to check each hop is https; an `AbortController` for timeouts; a byte counter on the body stream
aborts past the cap; JSON parsed only after the whole body is in. In tests the injected fetch may target `http://127.0.0.1`; the app's
own fetch refuses anything but `https:`.

## Testing

- `scripts/test-policy.ts`: dirs per OS, trust check, validator vs `ajv`, precedence, locks, safe states, secret detector, path
  containment.
- `scripts/test-policy-mcp.ts`: matcher, modes, list readers (both formats), required servers, enforcement in start options.
- `scripts/test-policy-env.ts`: per-app env/config mapping for OTel and LLM, missing variables, no secret in outputs other than the
  child env.
- `scripts/test-policy-fetch.ts`: limits, redirects, timeouts, cache, failures with a local fake server.
- `scripts/test-registry.ts`: index reader, install with hash check, local edits, uninstall, never overwriting foreign files.
- Simulator drivers and screenshots per phase at 1440x900 and 1280x800 (`DURBAR_MANAGED_DIR`).

## Complexity tracking

| Item | Why | Simpler option rejected |
|---|---|---|
| Hand-written validator next to a published JSON Schema | No runtime dependency; readable messages | Shipping `ajv` (a new runtime dependency for one file) |
| Two MCP list formats | Our format is simple and holds stdio servers and env-var references; v0.1 is what GitHub and VS Code already point at, so a company with a registry need not publish twice | One format only |

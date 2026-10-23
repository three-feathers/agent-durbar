# Implementation Plan: 076 managed configuration for organizations

**Spec**: [spec.md](spec.md) · **Samples**: [samples/](samples/) · **Status**: plan for P1-P26; nothing built. Q1-Q12 answered by Vikram 2026-10-23 (Q10: admin token pricing); A1-A19 accepted (section N); security review by Paco's agent folded in; R1-R8 follow their recommended defaults until answered.

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
| `src/main/policydir.ts` (pure, injected env) | `managedDirs({platform, knownProgramFiles, appData, packaged, devHooks})` (Windows: `SHGetKnownFolderPath(FOLDERID_ProgramFiles)` via `koffi`, never `%ProgramFiles%`), `posixTrust(chainOfStats)` (every file and every parent to `/` after `realpath`), `windowsWriteProbe(dir)` (`r+` open of `policy.json`, `wx` temp file per folder) |
| `src/main/devhooks.ts` (existing) | `devEnv(env, packaged, policyPresent, allowDevHooks)`: with a machine policy and no `allowDevHooks`, a packaged build returns `{}` and ignores `DURBAR_DEV`; `main.ts` resolves the machine folder (a cheap existence check plus the validator) **before** computing `dev` (FR-004) |
| `src/adapters/<app>Policy.ts` | per-app validation of `llm.<app>`/`signIn.<app>`, env and config mapping (OTel, proxy, CA, LLM), credential stripping (FR-100a), OTLP header percent-encoding (R7) |
| `src/main/policystore.ts` | reads layers (size caps, BOM/CRLF), runs the trust check and validator, keeps the effective policy, watcher (2 s debounce), `reload()`, emits `policy:changed` |
| `src/main/policyfetch.ts` | `fetchJson(url, {maxBytes, timeouts, redirects, token?})` over an injected `fetch` (Electron `net.fetch` on a non-persistent partition `durbar-policy-fetch` with `credentials: 'omit'` and `allowNTLMCredentialsForDomains('')`) and an injected address check (`dns.lookup` all addresses, refuse loopback/link-local/metadata/unspecified/multicast, private only for `network.allowPrivateHosts`), per hop with `redirect: 'manual'`; ETag cache in `<userData>/managed-cache/`, re-validated on use; Ed25519 `.sig` check when `signing` applies |
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

## Testing

- `scripts/test-policy.ts`: dirs per OS (Known Folder, not env), trust check (POSIX parent chain, Windows probe), dev variables
  ignored under a policy, validator vs `ajv` on the samples and `samples/hostile/`, precedence and narrow-only user layer, locks,
  closed and strict states, env allow-list binding, secret detection through `redact.ts`, path containment.
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
